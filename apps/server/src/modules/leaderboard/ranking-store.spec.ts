import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLegacy } from '../../testing/legacy.js';
import { RANKING_POLICY } from './ranking-policy.js';
import { createRankingStore, MERGE_RANKINGS_LUA, mergeRankings } from './ranking-store.js';

const legacy = await loadLegacy('ranking-store.mjs');

/* 레거시 test/ranking-store.test.mjs 의 9개 시나리오를 그대로 옮겼다.
   여기는 차분 테스트로 묶지 않는다 — 파일 원자성 · 재시도 타이머 · 저널이
   섞여 있어 두 인스턴스를 나란히 돌리면 같은 경로를 두 번 쓰게 된다.
   대신 각 시나리오가 요구하는 동작을 직접 단정하고, 순수 함수와 Lua 만
   레거시와 대조한다. */

const row = (id: string, score = 100) => ({
  id,
  shop: '검사 가게',
  score,
  wave: 1,
  at: '2026-09-08T00:00:00.000Z',
});

const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function fixture(): Promise<string> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gimbap-ranking-'));
  cleanups.push(() => fs.rm(folder, { recursive: true, force: true }));
  return path.join(folder, 'leaderboard.json');
}

interface MockRedis {
  rows: ReturnType<typeof row>[];
  failRead: boolean;
  failWrite: boolean;
  loseReply: boolean;
  commands: string[];
  active: number;
  maxActive: number;
  fetch: typeof globalThis.fetch;
}

function mockRedis(initial: ReturnType<typeof row>[] = []): MockRedis {
  const state = {
    rows: initial,
    failRead: false,
    failWrite: false,
    loseReply: false,
    commands: [] as string[],
    active: 0,
    maxActive: 0,
  } as MockRedis;
  state.fetch = (async (_url: string, options: { body: string }) => {
    const cmd = JSON.parse(options.body) as string[];
    state.commands.push(cmd[0]);
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (cmd[0] === 'GET') {
        if (state.failRead) throw Error('secret response must not be logged');
        return { ok: true, json: () => Promise.resolve({ result: JSON.stringify(state.rows) }) };
      }
      expect(cmd[0]).toBe('EVAL');
      if (state.failWrite) throw Error('secret response must not be logged');
      const incoming = JSON.parse(cmd[4]) as ReturnType<typeof row>[];
      state.rows = mergeRankings(state.rows, incoming);
      if (state.loseReply) {
        state.loseReply = false;
        throw Error('Lost response after commit');
      }
      return { ok: true, json: () => Promise.resolve({ result: JSON.stringify(state.rows) }) };
    } finally {
      state.active--;
    }
  }) as unknown as typeof globalThis.fetch;
  return state;
}

async function remote(mock: { fetch: typeof globalThis.fetch }, extra = {}) {
  const file = await fixture();
  const store = createRankingStore({
    file,
    redisUrl: 'http://isolated-test.invalid',
    redisToken: 'test-only',
    fetchImpl: mock.fetch,
    retryMs: 100000,
    ...extra,
  });
  cleanups.push(() => store.close());
  return store;
}

describe('파일 저장소', () => {
  it('원자적 저장이 새 인스턴스에서도 읽히고 상위 200건만 남는다', async () => {
    const file = await fixture();
    const a = createRankingStore({ file });
    cleanups.push(() => a.close());
    expect((await a.init()).ready).toBe(true);
    for (let i = 0; i < 205; i++) a.add(row('run-' + i, i));

    const b = createRankingStore({ file });
    cleanups.push(() => b.close());
    await b.init();
    expect(b.read().length).toBe(200);
    expect(b.read()[0].score).toBe(204);
    expect(b.read().at(-1)!.score).toBe(5);
    expect(b.health().pending).toBe(0);
    // 임시 파일이 남지 않아야 한다
    expect(await fs.readdir(path.dirname(file))).toEqual(['leaderboard.json']);
  });

  it('깨진 파일을 조용히 덮지 않고, 사람이 고친 뒤 복구된다', async () => {
    const file = await fixture();
    await fs.writeFile(file, '{incomplete');
    const store = createRankingStore({ file, retryMs: 100000 });
    cleanups.push(() => store.close());

    expect((await store.init()).ready).toBe(false);
    store.add(row('pending'));
    // 읽히지 않는 파일을 빈 캐시로 덮지 않는다
    expect(await fs.readFile(file, 'utf8')).toBe('{incomplete');
    expect(store.health().pending).toBe(1);

    await fs.writeFile(file, JSON.stringify([row('preserved', 500)]));
    expect(await store.flush()).toBe(true);
    expect(
      (JSON.parse(await fs.readFile(file, 'utf8')) as { id: string }[]).map((r) => r.id),
    ).toEqual(['preserved', 'pending']);
    expect(store.health().error).toBe(null);
  });
});

describe('Redis 저장소', () => {
  it('첫 읽기 실패가 아직 못 본 기록을 덮어쓰지 않는다', async () => {
    const redis = mockRedis([row('existing', 1000)]);
    redis.failRead = true;
    const store = await remote(redis);
    expect((await store.init()).ready).toBe(false);

    store.add(row('new'));
    expect(await store.flush()).toBe(false);
    expect(redis.commands.includes('EVAL')).toBe(false);
    expect(redis.rows.length).toBe(1);

    redis.failRead = false;
    expect(await store.flush()).toBe(true);
    expect(store.read().map((r) => r.id)).toEqual(['existing', 'new']);
    expect(store.health().ready).toBe(true);
  });

  it('쓰기가 직렬화되고 요청 중에 추가된 기록도 잃지 않는다', async () => {
    const redis = mockRedis();
    const store = await remote(redis);
    await store.init();
    store.add(row('one'));
    store.add(row('two', 200));
    store.add(row('three', 300));
    expect(await store.flush()).toBe(true);
    expect(redis.maxActive).toBe(1);
    expect(redis.rows.map((r) => r.id)).toEqual(['three', 'two', 'one']);
    expect(store.health().pending).toBe(0);
  });

  it('응답을 잃은 요청은 같은 ID 로 재시도되어 랭킹이 중복되지 않는다', async () => {
    const redis = mockRedis();
    const logs: string[] = [];
    const store = await remote(redis, { onError: (code: string) => logs.push(code) });
    await store.init();

    redis.loseReply = true;
    store.add(row('same-id'));
    expect(await store.flush()).toBe(false);
    expect(store.health().ready).toBe(false);
    expect(store.health().pending).toBe(1);

    expect(await store.flush()).toBe(true);
    expect(redis.rows.length).toBe(1);
    expect(logs).toEqual(['storage_write_failed']);
    expect(store.health().ready).toBe(true);
  });

  it('자동 재시도가 런타임 오류와 대기 중 쓰기를 정리한다', async () => {
    const redis = mockRedis();
    const store = await remote(redis, { retryMs: 10 });
    await store.init();
    redis.failWrite = true;
    store.add(row('retry'));
    expect(await store.flush()).toBe(false);

    redis.failWrite = false;
    const end = Date.now() + 2000;
    while (store.health().pending && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(store.health().pending).toBe(0);
    expect(store.health().ready).toBe(true);
    expect(redis.rows.length).toBe(1);
  });

  it('멈춘 REST 요청은 설정한 시간 안에 중단된다', async () => {
    const mock = {
      fetch: ((_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(Error('aborted'))),
        )) as unknown as typeof globalThis.fetch,
    };
    const store = await remote(mock, { timeoutMs: 30 });
    const start = Date.now();
    expect((await store.init()).ready).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
    expect(store.health().error).toBe('storage_read_failed');
  });

  it('대기 중이던 판이 프로세스 상태 소실을 저널로 넘긴다', async () => {
    const file = await fixture();
    const redis = mockRedis();
    redis.failWrite = true;
    const options = {
      file,
      redisUrl: 'http://isolated-test.invalid',
      redisToken: 'test-only',
      fetchImpl: redis.fetch,
      retryMs: 100000,
    };
    const first = createRankingStore(options);
    cleanups.push(() => first.close());
    await first.init();
    first.add(row('survives-restart'));
    expect(await first.flush()).toBe(false);
    first.close();
    expect(
      (JSON.parse(await fs.readFile(file + '.pending.json', 'utf8')) as unknown[]).length,
    ).toBe(1);

    redis.failWrite = false;
    const restarted = createRankingStore(options);
    cleanups.push(() => restarted.close());
    expect((await restarted.init()).ready).toBe(true);
    expect(redis.rows[0].id).toBe('survives-restart');
    expect(restarted.health().pending).toBe(0);
    expect(JSON.parse(await fs.readFile(file + '.pending.json', 'utf8'))).toEqual([]);
  });
});

describe('순수 병합과 Lua', () => {
  it('병합이 멱등하고 순서가 결정적이며 레거시와 같다', () => {
    expect(mergeRankings([row('b'), row('a')], [row('a')]).map((r) => r.id)).toEqual(['a', 'b']);
    // 무작위 열로 레거시와 대조한다
    let seed = 987654321;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 200; round++) {
      const make = (n: number) =>
        Array.from({ length: n }, () => ({
          id: 'r' + Math.floor(rnd() * 30),
          shop: '가게',
          score: Math.floor(rnd() * 10),
          wave: Math.floor(rnd() * 3),
          at: '2026-09-0' + (1 + Math.floor(rnd() * 8)) + 'T00:00:00.000Z',
        }));
      const a = make(Math.floor(rnd() * 12));
      const b = make(Math.floor(rnd() * 12));
      expect(
        mergeRankings(a, b).map((r) => r.id),
        'round ' + round,
      ).toEqual(legacy.mergeRankings(a, b).map((r) => r.id));
    }
  });

  it('Lua 스크립트가 레거시와 한 글자도 다르지 않다', () => {
    expect(MERGE_RANKINGS_LUA).toBe(legacy.MERGE_RANKINGS_LUA);
    expect(MERGE_RANKINGS_LUA).toContain(
      'while #merged > ' + RANKING_POLICY.maxEntries + ' do table.remove(merged) end',
    );
  });
});
