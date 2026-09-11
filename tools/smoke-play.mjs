/* 실제 Chrome 으로 한 판 돌려 본다 — 리팩토링 뒤 화면이 살아 있는지 확인용.
 *
 * 테스트를 걷어냈으니 이게 유일한 자동 확인 수단이다. 픽셀을 비교하지는
 * 않는다. "붙고 · 방이 생기고 · 게임이 시작되고 · HUD 에 값이 들어차고 ·
 * 3D 가 돌고 · 콘솔 오류가 없다" 까지만 본다.
 *
 *   npm run build && npm run smoke
 *
 * 스크린샷은 artifacts/smoke/ 에 남는다.
 */
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts', 'smoke');
const BUNDLED = path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);

/* playwright 는 CommonJS 라 디렉터리 지정자를 import() 로는 못 읽는다 */
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const tried = [];
  for (const id of [process.env.PLAYWRIGHT_PATH, 'playwright', BUNDLED].filter(Boolean)) {
    try {
      return require(id);
    } catch (err) {
      tried.push(id + ': ' + (err instanceof Error ? err.message.split('\n')[0] : err));
    }
  }
  throw Error(
    'Playwright 를 못 찾았다. 설치하거나 PLAYWRIGHT_PATH 를 지정할 것\n  ' + tried.join('\n  '),
  );
}

/** 서버를 임시 랭킹 파일로 띄운다 — 실제 기록을 건드리지 않는다 */
async function startServer() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gimbap-smoke-'));
  const child = fork(path.join(ROOT, 'apps/server/dist/main.js'), [], {
    cwd: ROOT,
    silent: true,
    env: {
      ...process.env,
      PORT: '0',
      NODE_ENV: 'test',
      GIMBAP_LEADERBOARD: path.join(folder, 'leaderboard.json'),
      GIMBAP_PUBLIC_ROOT: path.join(ROOT, 'apps/client/dist'),
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
    },
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('서버 기동 시간 초과:\n' + log)), 30000);
    child.once('exit', () => reject(Error('서버가 먼저 죽었다:\n' + log)));
    child.on('message', (m) => {
      if (m?.type === 'ready') {
        clearTimeout(timer);
        resolve(m.port);
      }
    });
  });
  return {
    url: 'http://localhost:' + port,
    async close() {
      child.kill();
      await fs.rm(folder, { recursive: true, force: true });
    },
  };
}

const checks = [];
const ok = (label, cond) => {
  checks.push({ label, cond: !!cond });
  console.log((cond ? '  OK  ' : '  X   ') + label);
};

const { chromium } = loadPlaywright();
await fs.mkdir(OUT, { recursive: true });
const server = await startServer();
let browser;
const errors = [];

try {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(server.url);

  // 1) 붙는다
  await page.waitForFunction(() => document.querySelector('#screen-join.active'), null, {
    timeout: 30000,
  });
  await page.waitForSelector('#btn-create:not([disabled])', { timeout: 30000 });
  ok('입장 화면이 뜨고 연결되면 버튼이 열린다', true);

  // 2) 캐릭터 미리보기가 실제로 그려진다
  const preview = await page.evaluate(() => {
    const c = document.getElementById('cz-canvas');
    return { w: c?.width ?? 0, rows: document.querySelectorAll('.cz-row .cz-name').length };
  });
  ok('미리보기 캔버스가 크기를 갖는다 (' + preview.w + 'px)', preview.w > 0);
  ok('파츠 이름이 칠해졌다 (' + preview.rows + '줄)', preview.rows >= 5);
  await page.screenshot({ path: path.join(OUT, '1-join.png'), fullPage: true });

  // 3) 방을 만든다
  await page.locator('#input-name').fill('스모크');
  await page.locator('#input-shop').fill('스모크 김밥');
  await page.locator('#btn-create').click();
  await page.waitForFunction(() => document.querySelector('#screen-lobby.active'), null, {
    timeout: 20000,
  });
  const lobby = await page.evaluate(() => ({
    code: document.getElementById('lobby-code')?.textContent ?? '',
    shop: document.getElementById('lobby-shop')?.textContent ?? '',
    players: document.querySelectorAll('#player-list li').length,
  }));
  ok('방 코드가 4글자다 (' + lobby.code.trim() + ')', lobby.code.trim().length === 4);
  ok('가게 이름이 보인다 (' + lobby.shop.trim() + ')', lobby.shop.includes('스모크'));
  ok('참가자 목록에 내가 있다', lobby.players === 1);
  await page.screenshot({ path: path.join(OUT, '2-lobby.png'), fullPage: true });

  // 4) 게임을 시작한다
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => document.querySelector('#screen-game.active'), null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => !document.getElementById('hud')?.classList.contains('hidden'),
    null,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => (document.getElementById('score')?.textContent ?? '').includes('점'),
    null,
    { timeout: 20000 },
  );
  const hud = await page.evaluate(() => ({
    wave: document.getElementById('wave-chip')?.textContent ?? '',
    score: document.getElementById('score')?.textContent ?? '',
    hand: document.getElementById('hand')?.textContent ?? '',
    queue: document.getElementById('queue')?.textContent ?? '',
    say: document.getElementById('say')?.textContent ?? '',
    rep: document.getElementById('rep-num')?.textContent ?? '',
  }));
  ok('웨이브 칩에 글자가 있다 (' + hud.wave.trim() + ')', hud.wave.trim().length > 0);
  ok('점수가 표시된다 (' + hud.score.trim() + ')', hud.score.includes('점'));
  ok('손 상태가 표시된다 (' + hud.hand.trim() + ')', hud.hand.trim().length > 0);
  ok('주문서가 그려졌다', hud.queue.includes('주문서'));
  ok('밥 상태가 표시된다', hud.say.trim().length > 0);
  ok('평판이 숫자다 (' + hud.rep.trim() + ')', /^\d+$/.test(hud.rep.trim()));
  await page.screenshot({ path: path.join(OUT, '3-game.png') });

  // 5) 3D 가 실제로 돌고 있나
  const view = await page.evaluate(() => {
    const c = document.getElementById('gl');
    return {
      pixels: c ? c.width * c.height : 0,
      hasCrosshair: !!document.getElementById('crosshair'),
    };
  });
  ok('3D 캔버스가 픽셀을 갖는다 (' + view.pixels + ')', view.pixels > 100000);
  ok('조준점이 있다', view.hasCrosshair);

  // 6) 도움말 오버레이
  await page.keyboard.press('h');
  await page.waitForFunction(
    () => !document.getElementById('overlay-help')?.classList.contains('hidden'),
    null,
    { timeout: 5000 },
  );
  ok('H 로 도움말이 열린다', true);
  await page.screenshot({ path: path.join(OUT, '4-help.png') });
  await page.keyboard.press('h');

  ok(
    '브라우저 오류가 없다' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''),
    errors.length === 0,
  );
} finally {
  if (browser) await browser.close();
  await server.close();
}

const failed = checks.filter((c) => !c.cond);
console.log('\n' + '─'.repeat(50));
console.log('  통과 ' + (checks.length - failed.length) + ' / ' + checks.length);
console.log('  스크린샷: ' + path.relative(ROOT, OUT));
console.log('─'.repeat(50));
if (failed.length) {
  for (const f of failed) console.error('  실패: ' + f.label);
  process.exitCode = 1;
}
