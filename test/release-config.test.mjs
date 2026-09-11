/* 배포 설정이 서로 어긋나지 않는지.
 *
 * Node 버전은 package.json · CI 워크플로 · render.yaml 세 군데에 적힌다.
 * 하나만 뒤처지면 CI 는 초록인데 배포가 죽거나, 그 반대가 된다.
 * 워크플로가 부르는 npm 스크립트가 실제로 있는지도 함께 본다 —
 * 오타 하나면 CI 가 통째로 건너뛴다.
 *
 * YAML 파서를 새로 들이지 않고, 실제로 의미 있는 줄만 정규식으로 집는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const ci = read('.github/workflows/ci.yml');
const render = read('render.yaml');

/** '22.12.0' → [22, 12, 0] */
const parts = (v) => v.split('.').map(Number);
const atLeast = (v, min) => {
  const a = parts(v), b = parts(min);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
};

test('Node 버전이 engines · CI · Render 에서 같은 값을 가리킨다', () => {
  const required = pkg.engines.node.match(/>=\s*([\d.]+)/)?.[1];
  assert.ok(required, 'package.json engines.node 에서 최소 버전을 못 읽었다');

  const ciVersion = ci.match(/NODE_VERSION:\s*'([\d.]+)'/)?.[1];
  assert.ok(ciVersion, 'CI 워크플로에서 NODE_VERSION 을 못 읽었다');

  const renderVersion = render.match(/key:\s*NODE_VERSION[\s\S]{0,80}?value:\s*'([\d.]+)'/)?.[1];
  assert.ok(renderVersion, 'render.yaml 에서 NODE_VERSION 을 못 읽었다');

  assert.ok(atLeast(ciVersion, required), `CI 의 Node ${ciVersion} 이 engines ${required} 보다 낮다`);
  assert.ok(
    atLeast(renderVersion, required),
    `Render 의 Node ${renderVersion} 이 engines ${required} 보다 낮다`,
  );
  // 둘이 다르면 "CI 는 통과했는데 배포만 죽는" 자리가 생긴다
  assert.equal(renderVersion, ciVersion);
});

test('CI 가 Node 버전을 한 곳에서만 정한다', () => {
  // 잡마다 직접 적으면 한쪽만 올리고 잊는다
  const hardcoded = [...ci.matchAll(/node-version:\s*(.+)/g)].map((m) => m[1].trim());
  assert.ok(hardcoded.length >= 2, '워크플로에 setup-node 가 없다');
  for (const value of hardcoded) assert.equal(value, '${{ env.NODE_VERSION }}');
});

test('같은 액션이 잡마다 다른 버전을 쓰지 않는다', () => {
  /* 한 잡만 올리고 잊으면 어느 잡이 어느 런타임에서 도는지 알 수 없게 된다.
     버전을 고정하지 않은 `uses:` 도 막는다 — 말없이 바뀌면 원인을 못 찾는다. */
  const uses = [...ci.matchAll(/uses:\s*([\w./-]+)@([\w.-]+)/g)].map((m) => [m[1], m[2]]);
  assert.ok(uses.length >= 4, '워크플로에서 액션을 못 긁었다');
  const byAction = new Map();
  for (const [name, version] of uses) {
    assert.match(version, /^v\d+/, name + ' 의 버전이 고정돼 있지 않다: ' + version);
    const seen = byAction.get(name);
    if (seen) assert.equal(version, seen, name + ' 이 잡마다 다른 버전을 쓴다');
    byAction.set(name, version);
  }
});

test('CI 가 부르는 npm 스크립트가 전부 존재한다', () => {
  const called = [...ci.matchAll(/- run:\s*npm (?:run )?([\w:-]+)/g)].map((m) => m[1]);
  assert.ok(called.length > 4, `워크플로에서 npm 실행을 못 긁었다 (${called.length}개)`);
  for (const name of called) {
    if (name === 'ci') continue; // `npm ci` 는 스크립트가 아니다
    if (name === 'test') continue; // `npm test` 는 예약어
    assert.ok(pkg.scripts[name], `package.json 에 "${name}" 스크립트가 없다`);
  }
  // 워크스페이스까지 검증해야 의미가 있다
  for (const name of ['build', 'typecheck', 'lint', 'format:check', 'verify'])
    assert.ok(called.includes(name), `CI 가 ${name} 을 돌리지 않는다`);
});

test('Render 가 빌드한 뒤 새 서버를 띄우고 새 화면을 서빙한다', () => {
  const build = render.match(/buildCommand:\s*(.+)/)?.[1] ?? '';
  assert.match(build, /npm run build/, '클라이언트를 빌드하지 않으면 화면이 없다');

  const start = render.match(/startCommand:\s*([^#\n]+)/)?.[1].trim() ?? '';
  assert.equal(start, 'npm start');
  assert.ok(
    pkg.scripts.start.includes('apps/server/dist/main.js'),
    'npm start 가 새 서버를 가리키지 않는다: ' + pkg.scripts.start,
  );

  /* 이게 빠지면 서버가 레거시 public/ 을 서빙한다 — 배포는 성공하는데
     옛 화면이 나가서 알아채기 어렵다. */
  const publicRoot = render.match(/key:\s*GIMBAP_PUBLIC_ROOT[\s\S]{0,80}?value:\s*(.+)/)?.[1].trim();
  assert.equal(publicRoot, 'apps/client/dist');
});

test('Render 배포는 CI 검증 잡을 통과해야 나간다', () => {
  assert.match(render, /autoDeploy:\s*false/, '푸시만으로 배포되면 CI 게이트가 무의미하다');
  const needs = ci.match(/needs:\s*\[([^\]]+)\]/)?.[1] ?? '';
  for (const job of ['verify', 'redis-test'])
    assert.ok(needs.includes(job), `deploy 가 ${job} 을 기다리지 않는다`);
});
