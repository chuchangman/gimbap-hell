import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────
   새 서버가 새 클라이언트 빌드를 제대로 내보내는지.

   5단계 브라우저 QA 를 돌리려면 먼저 이게 돼야 한다. 브라우저 없이도
   확인할 수 있는 것이 대부분이다 — 경로 · MIME · CSP · 에셋.
   특히 CSP 는 브라우저에서만 터지고 서버 로그에는 안 남아서, index.html 이
   부르는 모든 자원을 훑어 `script-src 'self'` 로 실제 실행 가능한지 본다.
   ──────────────────────────────────────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(HERE, '..', 'dist', 'main.js');
const CLIENT_DIST = path.join(HERE, '..', '..', 'client', 'dist');

let child: ChildProcess;
let url: string;
let folder: string;
let indexHtml = '';
let logs = '';

const request = (
  pathname: string,
  method = 'GET',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { path: pathname, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });

beforeAll(async () => {
  indexHtml = await fs.readFile(path.join(CLIENT_DIST, 'index.html'), 'utf8');
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gimbap-static-'));
  child = fork(SERVER_ENTRY, [], {
    silent: true,
    env: {
      ...process.env,
      PORT: '0',
      NODE_ENV: 'test',
      GIMBAP_LEADERBOARD: path.join(folder, 'leaderboard.json'),
      // 레거시 public/ 이 아니라 Vite 빌드 산출물을 내보낸다
      GIMBAP_PUBLIC_ROOT: CLIENT_DIST,
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      GIMBAP_ALLOWED_ORIGINS: '',
    },
  });
  child.stdout?.on('data', (d) => (logs += d));
  child.stderr?.on('data', (d) => (logs += d));
  let timer: NodeJS.Timeout;
  const ready = (await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(() => {
      throw Error('서버가 뜨기 전에 죽었다: ' + logs);
    }),
    new Promise((_r, reject) => {
      timer = setTimeout(() => reject(Error('서버 기동 시간 초과: ' + logs)), 20000);
    }),
  ]).finally(() => clearTimeout(timer))) as [{ type: string; port: number }];
  expect(ready[0].type).toBe('ready');
  url = 'http://localhost:' + ready[0].port;
}, 40000);

afterAll(async () => {
  if (child?.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (folder) await fs.rm(folder, { recursive: true, force: true });
});

it('첫 화면이 Vite 빌드 산출물로 나간다', async () => {
  const res = await request('/');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  const body = res.body.toString('utf8');
  expect(body).toBe(indexHtml);
  // React 가 붙을 자리와 번들이 실제로 들어 있어야 한다
  expect(body).toContain('<div id="app">');
  expect(body).toMatch(/<script type="module" crossorigin src="\/bundle\/index-\w+\.js">/);
});

it('index.html 이 부르는 자원이 전부 같은 출처에서 실제로 나온다', async () => {
  const refs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  expect(refs.length, '참조를 하나도 못 긁었다').toBeGreaterThan(1);
  const local = refs.filter((r) => r.startsWith('/'));
  // 파비콘 data: URL 말고는 전부 같은 출처여야 한다 (CSP default-src 'self')
  expect(refs.filter((r) => !r.startsWith('/') && !r.startsWith('data:'))).toEqual([]);
  expect(local.length, '번들 참조가 없다').toBeGreaterThan(1);
  for (const ref of local) {
    const res = await request(ref);
    expect(res.status, ref).toBe(200);
    expect(res.headers['content-type'], ref).toMatch(
      ref.endsWith('.css') ? /^text\/css/ : /^text\/javascript/,
    );
    expect(res.body.length, ref).toBeGreaterThan(0);
  }
});

it('CSP 가 이 페이지를 막지 않는다', async () => {
  const csp = String((await request('/')).headers['content-security-policy']);
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain('img-src');

  /* 인라인 <script> 와 <style> 은 해시가 없으면 브라우저가 막는다.
     Vite 빌드는 둘 다 안 만들지만, 설정이 바뀌면 화면이 통째로 죽는다. */
  const inlineScript = [...indexHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  expect(inlineScript, '인라인 스크립트는 CSP 가 막는다').toEqual([]);
  expect(indexHtml).not.toMatch(/<style[\s>]/);
  // 레거시가 쓰던 importmap 이 없으니 해시도 붙지 않아야 한다
  expect(csp).not.toContain('sha256-');
});

it('게임 에셋이 Vite 번들과 섞이지 않고 /assets 에서 나온다', async () => {
  const res = await request('/assets/manifest.json');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  const manifest = JSON.parse(res.body.toString('utf8')) as Record<string, string>;
  const names = Object.keys(manifest);
  expect(names.length, '매니페스트가 비었다').toBeGreaterThan(10);

  // 실제 모델 파일도 나가야 한다 — 매니페스트만 있고 파일이 없으면 소용없다
  const glb = names.map((n) => manifest[n]).find((f) => f.endsWith('.glb'));
  expect(glb, 'glb 항목이 없다').toBeTruthy();
  const url = '/assets/' + String(glb).replace(/^\/+/, '');
  const model = await request(url);
  expect(model.status).toBe(200);
  expect(model.headers['content-type']).toBe('model/gltf-binary');
  expect(model.body.length).toBeGreaterThan(100);
  // HEAD 는 길이만 알려주고 본문을 보내지 않는다
  const head = await request(url, 'HEAD');
  expect(head.body.length).toBe(0);
  expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
});

it('컨트롤러 경로는 정적 서빙이 가로채지 않는다', async () => {
  for (const [route, type] of [
    ['/health', /^application\/json/],
    ['/ready', /^application\/json/],
    ['/leaderboard.json', /^application\/json/],
  ] as const) {
    const res = await request(route);
    expect(res.status, route).toBe(200);
    expect(res.headers['content-type'], route).toMatch(type);
  }
});

it('없는 경로와 디렉터리 탈출은 404 다', async () => {
  // 경로는 ASCII 로 둔다 — node:http 가 이스케이프 안 된 문자를 거절한다
  for (const p of [
    '/missing.js',
    '/bundle/missing.js',
    '/../package.json',
    '/assets/../../package.json',
    '/%2e%2e/package.json',
    '/bundle/',
  ]) {
    const res = await request(p);
    expect(res.status, p).toBeGreaterThanOrEqual(400);
    expect(res.body.toString('utf8'), p).not.toContain('"name": "gimbap');
  }
});
