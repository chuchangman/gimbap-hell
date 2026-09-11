import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import type {
  HealthResponse,
  HelloPayload,
  KitchenSnapshot,
  PoseCorrection,
  PublicState,
  RoomAck,
} from '@repo/types';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

/* 레거시 test/server.integration.test.mjs 를 새 서버 기준으로 옮겼다.
   실제 자식 프로세스를 띄우고 실제 소켓으로 붙는다 — 이벤트 이름·페이로드·
   레이트 리밋·오리진 검사·연결 복구가 와이어에서 그대로 동작하는지 본다.
   여기가 "레거시 클라이언트가 새 서버에 그대로 붙는다" 의 합격 기준이다. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(HERE, '..', 'dist', 'main.js');
const REPO_ROOT = path.join(HERE, '..', '..', '..');

let child: ChildProcess;
let url: string;
let folder: string;
let logs = '';
const sockets = new Set<TestSocket>();

/* 와이어 페이로드에 @repo/types 를 그대로 붙인다. 억제하는 것보다 이게 낫다 —
   서버가 보내는 형태가 바뀌면 이 테스트가 컴파일 단계에서 먼저 깨진다. */
type TestSocket = Socket & {
  lastState: PublicState | null;
  lastKitchen: KitchenSnapshot | null;
  hello: HelloPayload | null;
  motionVersion: number;
  corrections: PoseCorrection[];
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** socket.io-client 의 Socket 은 Node EventEmitter 가 아니라
 *  @socket.io/component-emitter 다. node:events 의 once 를 쓸 수 없다. */
const onceSocket = (target: TestSocket, event: string): Promise<unknown[]> =>
  new Promise((resolve) => target.once(event, (...args: unknown[]) => resolve(args)));

async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await delay(25);
  }
  throw new Error('Timed out waiting for observed condition');
}

const health = async (): Promise<HealthResponse> =>
  (await fetch(url + '/health')).json() as Promise<HealthResponse>;

const request = (
  pathname: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { path: pathname, headers, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });

async function client(options = {}): Promise<TestSocket> {
  const s = io(url, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    timeout: 1500,
    ...options,
  }) as TestSocket;
  sockets.add(s);
  s.lastState = null;
  s.lastKitchen = null;
  s.hello = null;
  s.motionVersion = 0;
  s.corrections = [];
  s.on('state', (d: PublicState) => (s.lastState = d));
  s.on('kitchen', (d: KitchenSnapshot) => (s.lastKitchen = d));
  s.on('hello', (d: HelloPayload) => (s.hello = d));
  s.on('position:correct', (d: PoseCorrection) => {
    s.motionVersion = d.version;
    s.corrections.push(d);
  });
  const connected = onceSocket(s, 'connect');
  s.connect();
  await connected;
  await until(() => s.hello);
  return s;
}

const emit = <T = RoomAck>(s: TestSocket, event: string, data?: unknown): Promise<T> =>
  new Promise<T>((resolve, reject) =>
    s
      .timeout(2000)
      .emit(event, data, (err: unknown, res: unknown) =>
        err ? reject(err instanceof Error ? err : new Error('ack 실패')) : resolve(res as T),
      ),
  );

/** ack 를 성공으로 좁힌다. 실패하면 서버가 준 메시지를 그대로 보여준다. */
function expectOk(ack: RoomAck): { ok: true; code: string; youId: string } {
  if (!ack.ok) expect.fail('ack 실패: ' + ack.err);
  return ack;
}

async function create(s: TestSocket): Promise<RoomAck> {
  const result = await emit(s, 'room:create', { name: '검사방장', shop: '격리된 QA 가게' });
  // ACK 는 입장을 확인해 줄 뿐, 뒤따르는 스냅샷이 도착했다는 뜻은 아니다.
  if (result.ok) await until(() => s.lastState?.code === result.code && !!s.lastKitchen);
  return result;
}

const close = (s: TestSocket) => {
  s.disconnect();
  sockets.delete(s);
};

/** 스폰에서 목표까지 걸어간다. 보정이 한 번이라도 오면 실패다. */
async function walk(s: TestSocket, points: { x: number; z: number; ry?: number }[]) {
  let p: Record<string, number> = {
    ...s.lastState!.players.find((x) => x.id === s.id)!.spawn,
  };
  for (const target of points) {
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const steps = Math.ceil(Math.hypot(dx, dz) / 0.32);
    const start = { ...p };
    for (let i = 1; i <= steps; i++) {
      p = {
        x: start.x + (dx * i) / steps,
        z: start.z + (dz * i) / steps,
        y: 0,
        ry: target.ry || 0,
      };
      s.emit('player:move', { ...p, version: s.motionVersion });
      await delay(65);
    }
  }
  expect(s.corrections.length, '정상 보행이 거절되었다').toBe(0);
  return p;
}

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gimbap-protocol-'));
  child = fork(SERVER_ENTRY, [], {
    silent: true,
    env: {
      ...process.env,
      PORT: '0',
      NODE_ENV: 'test',
      GIMBAP_RECOVERY_MS: '1500',
      GIMBAP_LEADERBOARD: path.join(folder, 'leaderboard.json'),
      GIMBAP_PUBLIC_ROOT: path.join(REPO_ROOT, 'public'),
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      GIMBAP_ALLOWED_ORIGINS: '',
    },
  });
  child.stdout?.on('data', (d) => (logs += d));
  child.stderr?.on('data', (d) => (logs += d));
  let startupTimer: NodeJS.Timeout;
  const ready = (await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(() => {
      throw Error('Server startup failed: ' + logs);
    }),
    new Promise((_resolve, reject) => {
      startupTimer = setTimeout(() => reject(Error('Server startup timeout: ' + logs)), 20000);
    }),
  ]).finally(() => clearTimeout(startupTimer))) as [{ type: string; port: number }];
  expect(ready[0].type).toBe('ready');
  url = 'http://localhost:' + ready[0].port;
}, 40000);

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  if (child?.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  // mkdtemp 로 만든 검사용 폴더만 지운다
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});

afterEach(async () => {
  for (const socket of [...sockets]) close(socket);
  if (url && child.exitCode === null) await until(async () => (await health()).rooms === 0, 5000);
});

it('잘못된 HTTP 요청이 서버를 죽이거나 비공개 파일을 노출하지 않는다', async () => {
  for (const p of [
    '/%',
    '/%E0%A4%A',
    '/..%5cserver%5cindex.mjs',
    '/.env',
    '/%00',
    '/../server/index.mjs',
  ])
    expect((await request(p)).status, p).toBe(400);
  expect((await request('/server/index.mjs')).status).toBe(404);
  expect((await request('/', {}, 'POST')).status).toBe(405);
  expect((await health()).ok).toBe(true);
  expect((await health()).rejected.invalidHttp).toBeGreaterThanOrEqual(6);
});

it('정적 응답의 캐시 · 압축 · MIME · 스크립트 정책이 그대로다', async () => {
  const first = await request('/js/world.js');
  expect(first.status).toBe(200);
  expect(first.headers['x-content-type-options']).toBe('nosniff');
  expect(first.headers['content-security-policy']).toMatch(/script-src 'self' 'sha256-/);
  expect((await request('/js/world.js', { 'If-None-Match': String(first.headers.etag) })).status).toBe(304);
  const zipped = await request('/js/world.js', { 'Accept-Encoding': 'gzip' });
  expect(zipped.headers['content-encoding']).toBe('gzip');
  expect(zipped.body.length).toBeLessThan(first.body.length / 2);
  /* GLB 의 MIME 은 static.client.spec.ts 가 본다 — 게임 에셋은 이제
     apps/client/public/assets 에 있고 여기서 서빙하는 레거시 트리에는 없다. */
  const head = await request('/js/world.js', {}, 'HEAD');
  expect(head.body.length).toBe(0);
  expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
  expect((await request('/ready')).status).toBe(200);
});

it('망가진 소켓 데이터와 콜백이 아닌 인자가 프로세스를 죽일 수 없다', async () => {
  const s = await client();
  for (const name of [{}, [], 42, null, 'a'])
    expect((await emit(s, 'room:create', { name })).ok).toBe(false);
  s.emit('room:create', { name: { toString: 'not a function' } }, 'not a callback');
  s.emit('kitchen:act', { action: 'mat:roll', payload: { mat: '__proto__' } });
  await until(async () => (await health()).rejected.invalidEvents >= 3);
  expect((await health()).ok).toBe(true);
  close(s);
});

it('한 소켓이 방을 흘리거나 중복 입장으로 다른 방을 받지 못한다', async () => {
  const a = await client();
  const b = await client();
  const ra = expectOk(await create(a));
  const rb = expectOk(await create(b));
  expect((await create(a)).ok).toBe(false);
  expect((await emit(a, 'room:join', { name: '중복입장', code: rb.code })).ok).toBe(false);
  expect((await health()).rooms).toBe(2);
  b.emit('game:start');
  await until(() => b.lastState?.phase === 'playing');
  expect(a.lastState!.code).toBe(ra.code);
  expect(a.lastState!.phase).toBe('lobby');
  close(a);
  close(b);
  await until(async () => (await health()).rooms === 0);
});

it(
  '6인 정원 · 방장 권한 · 해금 · 인덱스 검증이 와이어에서 동작한다',
  async () => {
    const host = await client();
    const room = expectOk(await create(host));
    const guests: TestSocket[] = [];
    for (let i = 0; i < 6; i++) {
      const g = await client();
      guests.push(g);
      const result = await emit(g, 'room:join', { name: '동료' + i, code: room.code });
      expect(result.ok, 'guest ' + i).toBe(i < 5);
    }
    guests[0].emit('game:start');
    await delay(100);
    expect(host.lastState!.phase).toBe('lobby');
    host.emit('game:start');
    await until(() => host.lastState!.phase === 'playing');
    guests[0].emit('game:pause');
    await delay(50);
    expect(host.lastState!.paused).toBe(false);
    host.emit('kitchen:act', { action: 'fridge:take', payload: { item: 'fishcake' } });
    await delay(75);
    expect(host.lastKitchen!.hands.find((h) => h.id === host.id)!.holding).toBe(null);
    host.emit('kitchen:act', { action: 'mat:roll', payload: { mat: 'constructor' } });
    await walk(host, [
      { x: -4.4, z: 5.6 },
      { x: -4.4, z: -5.4 },
    ]);
    host.emit('kitchen:act', { action: 'fridge:take', payload: { item: 'gim' } });
    await until(
      () => host.lastKitchen!.hands.find((h) => h.id === host.id)!.holding?.id === 'gim',
    );
    host.emit('game:lobby');
    await delay(50);
    expect(host.lastState!.phase).toBe('playing');
    close(host);
    for (const g of guests) close(g);
    await until(async () => (await health()).rooms === 0);
  },
  30000,
);

it(
  '짧은 방장 끊김이 신원 · 자세 · 손을 지키고 타이머를 멈췄다 재개한다',
  async () => {
    const host = await client();
    const guest = await client();
    const r = expectOk(await create(host));
    await emit(guest, 'room:join', { name: '복구동료', code: r.code });
    host.emit('game:start');
    await until(() => host.lastState!.phase === 'playing');
    const expected = await walk(host, [
      { x: -4.4, z: 5.6 },
      { x: -4.4, z: -4.25, ry: 1 },
    ]);
    host.emit('kitchen:act', { action: 'fridge:take', payload: { item: 'rice' } });
    await until(
      () => host.lastKitchen!.hands.find((h) => h.id === host.id)!.holding?.id === 'rice',
    );
    const id = host.id!;
    const prepEnd = host.lastState!.wave!.phaseEndsAt;
    const disconnected = onceSocket(host, 'disconnect');
    host.io.engine.close();
    await disconnected;
    await until(
      () =>
        guest.lastState!.paused === true &&
        guest.lastState!.players.find((p) => p.id === id)!.connected === false,
    );
    await delay(150);
    const reconnected = onceSocket(host, 'connect');
    host.connect();
    await reconnected;
    await until(() => host.hello!.restored === true && host.lastState!.paused === false);
    expect(host.id).toBe(id);
    expect(host.hello!.pose!.x).toBe(expected.x);
    expect(host.hello!.pose!.ry).toBe(1);
    expect(host.lastKitchen!.hands.find((h) => h.id === id)!.holding!.id).toBe('rice');
    if (prepEnd) expect(host.lastState!.wave!.phaseEndsAt).toBeGreaterThanOrEqual(prepEnd + 100);
    expect((await health()).rejected.recovered).toBeGreaterThanOrEqual(1);
    close(host);
    close(guest);
    await until(async () => (await health()).rooms === 0);
  },
  30000,
);

it(
  '만료된 방장 예약이 권한을 넘기고 남은 사람을 묶어두지 않는다',
  async () => {
    const host = await client();
    const guest = await client();
    const r = expectOk(await create(host));
    await emit(guest, 'room:join', { name: '새로운방장', code: r.code });
    host.emit('game:start');
    await until(() => guest.lastState?.phase === 'playing');
    host.io.engine.close();
    await until(() => guest.lastState!.paused);
    await until(
      () => guest.lastState!.players.length === 1 && guest.lastState!.hostId === guest.id,
      6000,
    );
    guest.emit('game:pause');
    await until(() => guest.lastState!.paused === false);
    expect((await health()).recoveryPending).toBe(0);
    close(host);
    close(guest);
    await until(async () => (await health()).rooms === 0);
  },
  30000,
);

it('레이트 리밋과 오리진 검사가 정상 클라이언트를 막지 않고 적용된다', async () => {
  const s = await client();
  const before = (await health()).rejected.rateLimited;
  for (let i = 0; i < 30; i++) s.emit('room:create', { name: '요청검사' });
  await until(async () => (await health()).rejected.rateLimited > before);
  expect((await health()).rooms).toBe(1);
  const attacker = io(url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Origin: 'https://untrusted.example' },
  }) as TestSocket;
  sockets.add(attacker);
  await onceSocket(attacker, 'connect_error');
  expect(attacker.connected).toBe(false);
  close(attacker);
  expect((await health()).ok).toBe(true);
  close(s);
  await until(async () => (await health()).rooms === 0);
});

it('원격 아이템 요청과 순간이동 좌표가 서버 근접 검사를 우회하지 못한다', async () => {
  const s = await client();
  await create(s);
  s.emit('game:start');
  await until(() => s.lastState!.phase === 'playing');
  const before = (await health()).rejected.rejectedDistance || 0;
  s.emit('kitchen:act', { action: 'fridge:take', payload: { item: 'rice' } });
  await until(async () => ((await health()).rejected.rejectedDistance || 0) > before);
  expect(s.lastKitchen!.hands.find((h) => h.id === s.id)!.holding).toBe(null);
  s.emit('player:move', { x: -4.4, z: -4.25, y: 0, ry: 0, version: 0 });
  await until(() => s.corrections.length === 1);
  expect(s.corrections[0].x).toBe(-1.6);
  expect(s.corrections[0].z).toBe(5.6);
  s.emit('player:move', { x: -4.4, z: -4.25, y: 0, ry: 0, version: 0 }); // 보정 전에 큐에 들어간 패킷
  s.emit('kitchen:act', { action: 'fridge:take', payload: { item: 'rice', kind: 'serve' } });
  await until(async () => ((await health()).rejected.rejectedDistance || 0) > before + 1);
  expect(s.lastKitchen!.hands.find((h) => h.id === s.id)!.holding).toBe(null);
  s.emit('player:move', { x: -1.7, z: 5.6, y: 0, ry: 0, version: s.motionVersion });
  await delay(90);
  expect(s.corrections.length, '새로운 정상 이동은 보정되면 안 된다').toBe(1);
});
