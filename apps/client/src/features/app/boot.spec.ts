import { beforeAll, describe, expect, it, vi } from 'vitest';
/* 브라우저 QA 도구가 window.GB 의 무엇을 읽는지는 그 소스가 정답이다 */
import CHARACTER_QA from '../../../../../tools/character-preview-qa.cjs?raw';
import RELEASE_QA from '../../../../../tools/release-browser-qa.cjs?raw';

/* ────────────────────────────────────────────────────────────
   조립점 동등성 검사

   `main.js` 는 DOM 도 3D 도 아니라 "순서와 배선" 이다. 그래서 양쪽의
   잎 모듈을 전부 가짜로 바꿔 놓고 레거시 `main.js` 와 새 `boot()` 를
   차례로 돌린 뒤 (1) 호출 순서와 인자, (2) 등록한 소켓 이벤트와 그
   핸들러의 동작, (3) `window.GB` 표면, (4) 실패 경로의 `.fatal` 마크업,
   (5) 한 프레임의 호출 순서를 대조한다.
   ──────────────────────────────────────────────────────────── */

interface Call {
  side: string;
  fn: string;
  args: unknown[];
}

const rec = vi.hoisted(() => {
  const calls: Call[] = [];
  const handlers: Record<string, Record<string, (d: unknown) => void>> = { L: {}, P: {} };
  const fail = { renderer: false, connect: false };
  const flags = { swinging: false, enabled: false, meId: 'me' };
  /** 호출을 적어 두는 가짜 함수 */
  const spy =
    (side: string, fn: string, impl?: (...a: never[]) => unknown) =>
    (...args: unknown[]): unknown => {
      calls.push({ side, fn, args });
      return impl?.(...(args as never[]));
    };
  /** `on(evt, handler)` — 핸들러를 붙잡아 둔다 */
  const on = (side: string) =>
    spy(side, 'on', ((evt: string, handler: (d: unknown) => void) => {
      handlers[side][evt] = handler;
    }) as never);
  return { calls, handlers, fail, flags, spy, on };
});

/* ──────────────── 레거시 잎 모듈 ──────────────── */

const legacyScene = { tag: 'legacy-scene' };
const legacyCamera = { tag: 'legacy-camera' };
const legacyInteractables: unknown[] = [];
const legacyPlayerState = { enabled: false };
const legacyS = { meId: 'me' };

vi.mock('@legacy/assets.js', () => ({
  preloadAssets: rec.spy('L', 'preloadAssets', (() => Promise.resolve()) as never),
}));
vi.mock('@legacy/world.js', () => ({
  initWorld: rec.spy('L', 'initWorld', ((): void => {
    if (rec.fail.renderer) throw new Error('WebGL 없음');
  }) as never),
  render: rec.spy('L', 'render'),
  remoteSwing: rec.spy('L', 'remoteSwing'),
  previewBody: rec.spy('L', 'previewBody'),
  animatePreviewBody: rec.spy('L', 'animatePreviewBody'),
  disposePreviewBody: rec.spy('L', 'disposePreviewBody'),
  scene: legacyScene,
  camera: legacyCamera,
  interactables: legacyInteractables,
}));
vi.mock('@legacy/player.js', () => ({
  initPlayer: rec.spy('L', 'initPlayer'),
  updatePlayer: rec.spy('L', 'updatePlayer'),
  applyKnockback: rec.spy('L', 'applyKnockback'),
  isSwinging: rec.spy('L', 'isSwinging', (() => rec.flags.swinging) as never),
  setLook: rec.spy('L', 'setLook'),
  getPose: rec.spy('L', 'getPose'),
  correctPose: rec.spy('L', 'correctPose'),
  state: legacyPlayerState,
}));
vi.mock('@legacy/ui.js', () => ({
  initUI: rec.spy('L', 'initUI'),
  renderHUD: rec.spy('L', 'renderHUD'),
  route: rec.spy('L', 'route'),
  toast: rec.spy('L', 'toast'),
  wavePop: rec.spy('L', 'wavePop'),
}));
vi.mock('@legacy/kitchen.js', () => ({ resolveAction: rec.spy('L', 'resolveAction') }));
vi.mock('@legacy/net.js', () => ({
  connect: rec.spy('L', 'connect', (() =>
    rec.fail.connect ? Promise.reject(new Error('서버 없음')) : Promise.resolve()) as never),
  emit: rec.spy('L', 'emit', (() => true) as never),
  on: rec.on('L'),
  S: legacyS,
}));

/* ──────────────── 새 잎 모듈 ──────────────── */

const portScene = { tag: 'port-scene' };
const portCamera = { tag: 'port-camera' };
const portInteractables: unknown[] = [];
const portPlayerState = { enabled: false };
const portS = { meId: 'me' };
const fakeRoot = { tag: 'r3f-root' };

vi.mock('@/features/assets/assets', () => ({
  preloadAssets: rec.spy('P', 'preloadAssets', (() => Promise.resolve()) as never),
}));
vi.mock('@/features/world/build', () => ({
  buildWorld: rec.spy('P', 'buildWorld'),
  stepWorld: rec.spy('P', 'stepWorld'),
}));
vi.mock('@/features/world/customers', () => ({ remoteSwing: rec.spy('P', 'remoteSwing') }));
vi.mock('@/features/world/character', () => ({
  previewBody: rec.spy('P', 'previewBody'),
  animatePreviewBody: rec.spy('P', 'animatePreviewBody'),
  disposePreviewBody: rec.spy('P', 'disposePreviewBody'),
}));
vi.mock('@/features/world/scene', () => ({
  scene: portScene,
  camera: portCamera,
  interactables: portInteractables,
  setViewportHeight: rec.spy('P', 'setViewportHeight'),
}));
/* 렌더러는 붙이는 부분만 가짜로 바꾸고 `frameStep` 은 진짜를 쓴다 —
   한 프레임의 순서가 바로 이 검사의 대상이다. */
vi.mock('@/features/world/renderer', async (importActual) => ({
  ...(await importActual<typeof import('@/features/world/renderer')>()),
  startRenderer: rec.spy('P', 'startRenderer', (() =>
    rec.fail.renderer
      ? Promise.reject(new Error('WebGL 없음'))
      : Promise.resolve(fakeRoot)) as never),
  startLoop: rec.spy('P', 'startLoop'),
}));
vi.mock('@/features/player/player', () => ({
  initPlayer: rec.spy('P', 'initPlayer'),
  updatePlayer: rec.spy('P', 'updatePlayer'),
  applyKnockback: rec.spy('P', 'applyKnockback'),
  isSwinging: rec.spy('P', 'isSwinging', (() => rec.flags.swinging) as never),
  setLook: rec.spy('P', 'setLook'),
  getPose: rec.spy('P', 'getPose'),
  correctPose: rec.spy('P', 'correctPose'),
  state: portPlayerState,
}));
vi.mock('@/features/ui/ui', () => ({
  initUI: rec.spy('P', 'initUI'),
  renderHUD: rec.spy('P', 'renderHUD'),
  route: rec.spy('P', 'route'),
  toast: rec.spy('P', 'toast'),
  wavePop: rec.spy('P', 'wavePop'),
}));
vi.mock('@/features/kitchen/kitchen', () => ({ resolveAction: rec.spy('P', 'resolveAction') }));
vi.mock('@/features/net/net', () => ({
  connect: rec.spy('P', 'connect', (() =>
    rec.fail.connect ? Promise.reject(new Error('서버 없음')) : Promise.resolve()) as never),
  emit: rec.spy('P', 'emit', (() => true) as never),
  on: rec.on('P'),
  S: portS,
}));

/* ──────────────── 한 판 돌리기 ──────────────── */

let rafCallbacks: FrameRequestCallback[] = [];
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
});
vi.stubGlobal('cancelAnimationFrame', () => {});

let mono = 1_000;
vi.spyOn(performance, 'now').mockImplementation(() => mono);

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

interface Snap {
  seq: string[];
  args: Record<string, unknown[]>;
  events: string[];
  gb: string[];
  fatal: string | null;
}

function prepare(): void {
  document.body.innerHTML = '<canvas id="gl"></canvas>';
  rec.calls.length = 0;
  rafCallbacks = [];
  mono = 1_000;
  delete (window as { GB?: unknown }).GB;
}

function snap(side: string): Snap {
  const mine = rec.calls.filter((c) => c.side === side);
  const args: Record<string, unknown[]> = {};
  for (const c of mine) if (!(c.fn in args)) args[c.fn] = c.args;
  return {
    seq: mine.map((c) => c.fn),
    args,
    events: Object.keys(rec.handlers[side]),
    gb: Object.keys((window as { GB?: object }).GB || {}).sort(),
    fatal: document.querySelector('.fatal')?.outerHTML ?? null,
  };
}

async function runLegacy(): Promise<Snap> {
  prepare();
  rec.handlers.L = {};
  vi.resetModules();
  await import('@legacy/main.js');
  await flush();
  return snap('L');
}

async function runPort(): Promise<Snap> {
  prepare();
  rec.handlers.P = {};
  vi.resetModules();
  const { boot } = await import('@/features/app/boot');
  await boot();
  await flush();
  return snap('P');
}

/** 레거시 `initWorld` 하나 = 새 쪽 `startRenderer` + `buildWorld` (렌더러가 R3F 로 갔다) */
function canonHead(seq: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === 'startRenderer' && seq[i + 1] === 'buildWorld') {
      out.push('initWorld');
      i++;
      continue;
    }
    out.push(seq[i]);
  }
  // 레거시는 boot() 끝에서 loop() 를 바로 한 번 돌린다 — 거기까지만 본다
  return out.slice(0, out.indexOf('route') + 1);
}

describe('조립점 — 레거시 main.js 동등성', () => {
  let legacy: Snap;
  let port: Snap;

  beforeAll(async () => {
    rec.fail.renderer = false;
    rec.fail.connect = false;
    legacy = await runLegacy();
    port = await runPort();
  });

  it('실제로 부팅이 돌았다 (아무것도 안 불렸으면 비교가 무의미하다)', () => {
    expect(legacy.seq.length).toBeGreaterThan(8);
    expect(port.seq.length).toBeGreaterThan(8);
    expect(legacy.fatal).toBe(null);
    expect(port.fatal).toBe(null);
  });

  it('부팅 순서가 레거시와 같다', () => {
    expect(canonHead(port.seq)).toEqual(canonHead(legacy.seq));
    expect(canonHead(legacy.seq)).toEqual([
      'preloadAssets',
      'initWorld',
      'connect',
      'initPlayer',
      'initUI',
      'on',
      'on',
      'on',
      'on',
      'route',
    ]);
  });

  it('같은 캔버스를 넘긴다', () => {
    const canvas = document.getElementById('gl');
    expect(legacy.args.initWorld).toEqual([canvas]);
    expect(port.args.startRenderer).toEqual([canvas]);
    expect(port.args.initPlayer).toEqual(legacy.args.initPlayer);
  });

  it('같은 소켓 이벤트를 같은 순서로 등록한다', () => {
    expect(port.events).toEqual(legacy.events);
    expect(legacy.events).toEqual(['position:correct', 'waveEnd', 'swing', 'hit']);
  });

  it('window.GB 표면이 레거시와 같다', () => {
    expect(port.gb).toEqual(legacy.gb);
    expect(legacy.gb.length).toBeGreaterThan(9);
  });

  it('브라우저 QA 도구가 읽는 항목이 전부 있다', () => {
    /* 하드코딩한 목록이 아니라 도구 소스에서 긁어낸다 —
       5단계 브라우저 QA 가 여기서 조용히 깨지면 안 된다. */
    const used = [
      ...new Set([...(RELEASE_QA + CHARACTER_QA).matchAll(/GB\.(\w+)/g)].map((m) => m[1])),
    ].sort();
    expect(used.length, '정규식이 헛돌았다').toBeGreaterThan(3);
    expect(used.filter((k) => !port.gb.includes(k))).toEqual([]);
  });

  it('루프를 시작한다', () => {
    // 레거시는 loop() 안에서 requestAnimationFrame 을 걸고, 새 쪽은 R3F 가 건다
    expect(rafCallbacks.length + port.seq.filter((f) => f === 'startLoop').length).toBeGreaterThan(
      0,
    );
    expect(port.seq[port.seq.length - 1]).toBe('startLoop');
  });
});

/* ──────────────── 소켓 핸들러가 하는 일 ──────────────── */

/** 순서·이름·인자만 남긴다 — 어느 쪽인지는 지운다 */
const plain = (side: string): Array<[string, unknown[]]> =>
  rec.calls.filter((c) => c.side === side).map((c) => [c.fn, c.args]);

function driveHandlers(side: string): Array<[string, unknown[]]> {
  const h = rec.handlers[side];
  rec.calls.length = 0;
  h['position:correct']({ x: 1, y: 0, z: 2, ry: 0.5, version: 3 });
  h.waveEnd({ wave: 3, happy: 2, angry: 1, victory: false });
  h.swing({ by: 'me' }); // 내가 휘두른 건 무시해야 한다
  h.swing({ by: 'other' });
  h.hit({ target: 'other', by: 'me', dirX: 1, dirZ: 0, power: 2, dropped: 'ham' }); // 남이 맞았다
  h.hit({ target: 'me', by: 'other', dirX: 1, dirZ: 0, power: 2, dropped: 'ham' });
  h.hit({ target: 'me', by: 'other', dirX: -1, dirZ: 0.5, power: 3, dropped: null });
  return plain(side);
}

describe('소켓 핸들러', () => {
  it('같은 이벤트를 먹이면 같은 일을 한다', () => {
    const legacy = driveHandlers('L');
    const port = driveHandlers('P');
    expect(port).toEqual(legacy);
    // 헛돌지 않았는지 — 내 스윙 1건은 무시되고 남의 것만 재생돼야 한다
    expect(legacy.filter(([fn]) => fn === 'remoteSwing')).toHaveLength(1);
    expect(legacy.filter(([fn]) => fn === 'applyKnockback')).toHaveLength(2);
    expect(legacy.filter(([fn]) => fn === 'toast')).toHaveLength(1);
    expect(legacy.filter(([fn]) => fn === 'correctPose')).toHaveLength(1);
    expect(legacy.filter(([fn]) => fn === 'wavePop')).toHaveLength(1);
  });
});

/* ──────────────── 더 갈 수 없을 때 ──────────────── */

describe('실패 경로', () => {
  it('3D 를 못 켜면 같은 안내를 붙이고 멈춘다', async () => {
    rec.fail.renderer = true;
    const legacy = await runLegacy();
    const port = await runPort();
    rec.fail.renderer = false;

    expect(legacy.fatal).toContain('3D 를 켤 수 없습니다.');
    expect(port.fatal).toBe(legacy.fatal);
    // 멈춰야 한다 — 연결도 UI 도 건드리지 않는다
    expect(legacy.seq).not.toContain('connect');
    expect(port.seq).not.toContain('connect');
    expect(port.seq).not.toContain('initUI');
    expect(port.gb).toEqual([]);
  });

  it('서버에 연결하지 못하면 같은 안내를 붙이고 멈춘다', async () => {
    rec.fail.connect = true;
    const legacy = await runLegacy();
    const port = await runPort();
    rec.fail.connect = false;

    expect(legacy.fatal).toContain('서버에 연결하지 못했습니다.');
    expect(port.fatal).toBe(legacy.fatal);
    expect(legacy.seq).toContain('connect');
    expect(port.seq).toContain('connect');
    expect(port.seq).not.toContain('initPlayer');
    expect(port.gb).toEqual([]);
  });
});

/* ──────────────── 한 프레임 ──────────────── */

describe('프레임 루프', () => {
  it('같은 프레임에서 같은 순서로 같은 dt 를 넘긴다', async () => {
    await runLegacy();
    const legacyLoop = rafCallbacks[rafCallbacks.length - 1];
    expect(legacyLoop, '레거시 루프를 못 잡았다').toBeTypeOf('function');
    const { frameStep } = await import('@/features/world/renderer');

    /** 레거시 한 프레임 — dt 는 performance.now 의 차이에서 나온다 */
    const legacyFrame = (advanceMs: number): Array<[string, unknown[]]> => {
      rec.calls.length = 0;
      mono += advanceMs;
      legacyLoop(mono);
      return plain('L').filter(([fn]) => fn !== 'requestAnimationFrame');
    };
    /** 새 한 프레임 — dt 는 R3F 가 준다. setViewportHeight 는 레거시에 짝이 없다 */
    const portFrame = (dt: number): Array<[string, unknown[]]> => {
      rec.calls.length = 0;
      frameStep(dt, 900);
      return plain('P').filter(([fn]) => fn !== 'setViewportHeight');
    };
    const canonRender = (seq: Array<[string, unknown[]]>): Array<[string, unknown[]]> =>
      seq.map(([fn, args]) => [fn === 'stepWorld' ? 'render' : fn, args]);

    // 조작이 꺼져 있으면 플레이어와 HUD 는 건드리지 않는다
    legacyPlayerState.enabled = false;
    portPlayerState.enabled = false;
    rec.flags.swinging = false;
    expect(canonRender(portFrame(0.016))).toEqual(legacyFrame(16));
    expect(legacyFrame(16).map(([fn]) => fn)).toEqual(['isSwinging', 'render']);

    // 켜져 있으면 updatePlayer → renderHUD → render 순서
    legacyPlayerState.enabled = true;
    portPlayerState.enabled = true;
    rec.flags.swinging = true;
    const on16 = legacyFrame(16);
    expect(canonRender(portFrame(0.016))).toEqual(on16);
    expect(on16).toEqual([
      ['updatePlayer', [0.016]],
      ['renderHUD', []],
      ['isSwinging', []],
      ['render', [true]],
    ]);

    // 탭이 쉬었다 돌아와도 dt 는 0.1 초로 잘린다
    expect(canonRender(portFrame(0.5))).toEqual(legacyFrame(500));
    expect(legacyFrame(500)[0]).toEqual(['updatePlayer', [0.1]]);

    legacyPlayerState.enabled = false;
    portPlayerState.enabled = false;
  });

  it('손님 테두리 두께 기준을 매 프레임 화면 높이로 갱신한다', async () => {
    const { frameStep } = await import('@/features/world/renderer');
    rec.calls.length = 0;
    frameStep(0.016, 1234);
    expect(plain('P')[0]).toEqual(['setViewportHeight', [1234]]);
  });
});
