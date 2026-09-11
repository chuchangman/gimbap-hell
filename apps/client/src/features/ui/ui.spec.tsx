import { Shell } from '@/features/ui/Shell';
import { countElements, describeElement } from '@/testing/dom-snapshot';
import { firstDifference } from '@/testing/mesh-snapshot';
import { render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import INDEX_HTML from '../../../../../legacy/public/index.html?raw';

/* ────────────────────────────────────────────────────────────
   DOM UI 동등성 검사

   같은 상태 스냅샷을 레거시 `S` 와 새 `S` 에 심고, 레거시(index.html body +
   `ui.js`) 와 새 스택(React 뼈대 + `ui.ts`) 에 **같은 순서로 같은 호출**을
   먹인 뒤 단계마다 화면을 통째로 대조한다. 두 구현이 같은 element id 를
   잡으므로 동시에는 못 띄운다 — 차례로 돌린다.
   ──────────────────────────────────────────────────────────── */

/* `initUI` 끝에서 캐릭터 꾸미기가 켜진다. jsdom 에 WebGL 이 없으니 렌더러만
   가짜로 바꾼다 — 안 바꾸면 양쪽이 나란히 "미리보기 없음" 으로 빠진다. */
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeRenderer {
    domElement: HTMLCanvasElement;
    toneMapping = 0;
    toneMappingExposure = 1;
    constructor(p: { canvas: HTMLCanvasElement }) {
      this.domElement = p.canvas;
    }
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);
// 미리보기 애니메이션은 이 검사와 무관하다 — 첫 프레임만 돌고 멈추게 둔다
vi.stubGlobal('requestAnimationFrame', () => 1);
vi.stubGlobal('cancelAnimationFrame', () => {});

const legacyUi = await import('@legacy/ui.js');
const legacyNet = await import('@legacy/net.js');
const legacyPlayer = await import('@legacy/player.js');
const legacyCustomize = await import('@legacy/customize.js');
const portUi = await import('@/features/ui/ui');
const portNet = await import('@/features/net/net');
const portPlayer = await import('@/features/player/player');
const portCustomize = await import('@/features/customize/customize');

const LEGACY_BODY = (() => {
  const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
  for (const s of doc.body.querySelectorAll('script')) s.remove();
  return doc.body.innerHTML;
})();

type Ui = typeof legacyUi;
type Store = Record<string, unknown>;

interface Side {
  name: string;
  ui: Ui;
  S: Store;
  P: Store;
  mount: () => Element;
  stop: () => void;
}

const SIDES: Side[] = [
  {
    name: '레거시',
    ui: legacyUi,
    S: legacyNet.S,
    P: legacyPlayer.state as unknown as Store,
    mount: () => {
      document.body.innerHTML = LEGACY_BODY;
      return document.body;
    },
    stop: () => legacyCustomize.stopCustomizer(),
  },
  {
    name: '이식본',
    ui: portUi as unknown as Ui,
    S: portNet.S as unknown as Store,
    P: portPlayer.state as unknown as Store,
    mount: () => {
      document.body.innerHTML = '';
      return render(<Shell />).container;
    },
    stop: () => portCustomize.stopCustomizer(),
  },
];

/* ──────────────── 심을 스냅샷 ──────────────── */

const NOW = 1_700_000_000_000;

const player = (i: number, over: Record<string, unknown> = {}) => ({
  id: i === 0 ? 'me' : 'p' + i,
  slot: i,
  name: ['나', '동료', '알바', '사장', '손님'][i] || '플레이어' + i,
  color: ['#f5b942', '#63a8e8', '#58c07a', '#e05252', '#b07ae0'][i] || '#fff',
  look: {},
  connected: true,
  spawn: { x: 0, y: 0, z: 6.2, ry: 0 },
  ...over,
});

const customer = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'counter',
  name: '김손님',
  emoji: '🧔',
  color: 0x8a5a3a,
  fills: ['danmuji', 'ham'],
  need: 1,
  done: 0,
  slot: 0,
  state: 'wait',
  since: NOW - 5000,
  seed: 7,
  patienceMax: 60,
  deadline: NOW + 40000,
  hp: 3,
  hpMax: 3,
  ...over,
});

const wave = (over: Record<string, unknown> = {}) => ({
  now: NOW,
  wave: 3,
  totalWaves: 10,
  phase: 'wave',
  phaseEndsAt: NOW + 30000,
  waiting: 0,
  unlocked: ['danmuji', 'ham', 'spinach', 'crab'],
  nextUnlock: { wave: 4, id: 'egg', name: '계란' },
  customers: [customer()],
  targetId: 'c1',
  reputation: 90,
  score: 1200,
  servedRolls: 7,
  avgQuality: 86,
  happy: 5,
  angry: 1,
  kicked: 0,
  result: null,
  ...over,
});

const kitchen = (over: Record<string, unknown> = {}) => ({
  now: NOW,
  hands: [{ id: 'me', holding: null }],
  sink: null,
  cookers: [
    { state: 'empty', at: 0, servings: 0 },
    { state: 'empty', at: 0, servings: 0 },
  ],
  burners: [null, null, null, null, null],
  boards: [null, null, null],
  mats: [0, 1, 2].map(() => ({ gim: false, bap: false, fills: [], rolling: false, rollAt: 0 })),
  brooms: [null, null, null],
  mess: 0,
  wasted: 0,
  ...over,
});

const state = (over: Record<string, unknown> = {}) => ({
  now: NOW,
  code: 'ABCD',
  shop: '검사 김밥',
  phase: 'lobby',
  paused: false,
  pausedAt: 0,
  hostId: 'me',
  players: [player(0)],
  wave: null,
  result: null,
  history: [],
  ...over,
});

const row = (i: number, over: Record<string, unknown> = {}) => ({
  id: 'e' + i,
  shop: '김' + i,
  score: 3000 - i * 100,
  wave: 10 - i,
  totalWaves: 10,
  kind: i === 0 ? 'victory' : 'defeat',
  players: ['나'],
  rolls: 30 - i,
  avgQuality: 95 - i,
  at: '2026-09-0' + ((i % 9) + 1) + 'T06:14:22.031Z',
  ...over,
});

const result = (over: Record<string, unknown> = {}) => ({
  kind: 'defeat',
  shop: '검사 김밥',
  wave: 6,
  totalWaves: 10,
  score: 1840,
  rawScore: 1900,
  messPenalty: 60,
  mess: 4,
  reputation: 0,
  reputationMax: 100,
  servedRolls: 18,
  avgQuality: 72,
  happy: 14,
  angry: 5,
  players: [
    { name: '나', color: '#f5b942' },
    { name: '동료', color: '#63a8e8' },
  ],
  rank: 12,
  board: {
    top: [0, 1, 2, 3].map((i) => row(i)),
    myRank: 12,
    total: 40,
    outside: row(11, { id: 'mine', shop: '검' }),
  },
  entryId: 'mine',
  storage: {
    mode: 'file',
    ready: true,
    pending: 0,
    error: null,
    lastReadAt: NOW,
    lastWriteAt: NOW,
    failures: 0,
  },
  ...over,
});

/* ──────────────── 조작 대본 ──────────────── */

let boardRows: unknown[] = [];
let boardFails = false;
vi.stubGlobal('fetch', () =>
  boardFails
    ? Promise.reject(new Error('네트워크'))
    : Promise.resolve({ json: () => Promise.resolve(boardRows) }),
);

/** 이번 판에 화면이 실제로 바뀌었는지 보려고 단계마다 한 번씩 훑는다 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const hold = (over: Record<string, unknown>) => ({
  uid: 1,
  id: 'gimbap',
  stage: 'done',
  quality: 90,
  /* 품질 색이 갈리는 세 구간을 한 줄에 다 태운다 — 90 이상 · 60~89 · 60 미만 */
  fills: [
    { id: 'danmuji', quality: 100 },
    { id: 'spinach', quality: 85 },
    { id: 'ham', quality: 55 },
  ],
  ...over,
});

interface Step {
  name: string;
  run: (s: Side) => void | Promise<void>;
}

const STEPS: Step[] = [
  { name: '상태 없음 → 입장 화면', run: (s) => s.ui.route() },
  {
    name: '로비 · 혼자 · 방장',
    run: (s) => {
      s.S.state = state();
      s.ui.route();
    },
  },
  {
    name: '로비 · 5명 · 손님 · 끊긴 사람 · 지난 영업',
    run: (s) => {
      s.S.state = state({
        hostId: 'p1',
        players: [player(0), player(1), player(2, { connected: false }), player(3), player(4)],
        history: [
          { kind: 'victory', wave: 10, score: 3000, rank: 1, at: NOW - 10000 },
          { kind: 'defeat', wave: 4, score: 800, rank: null, at: NOW - 20000 },
        ],
      });
      s.ui.route();
    },
  },
  {
    name: '게임 화면 · HUD 준비 시간 · 빈손 · 밥솥 빔',
    run: (s) => {
      s.S.state = state({
        phase: 'playing',
        wave: wave({ phase: 'prep', wave: 0, customers: [], nextUnlock: null }),
      });
      s.S.kitchen = kitchen();
      s.ui.route();
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 웨이브 · 손님 4명(진상 · 입장 중 · 급함)',
    run: (s) => {
      s.S.state = state({
        phase: 'playing',
        wave: wave({
          waiting: 2,
          customers: [
            customer(),
            customer({
              id: 'c2',
              kind: 'kiosk',
              name: '진상 아저씨',
              emoji: '😤',
              slot: 1,
              fills: ['danmuji', 'ham', 'spinach'],
              hp: 2,
              hpMax: 5,
              patienceMax: 30,
              // 초가 딱 떨어지지 않는다 — 올림/내림이 갈리는 자리
              deadline: NOW + 4500,
            }),
            customer({ id: 'c3', slot: 2, state: 'walkin', deadline: NOW + 60000 }),
            customer({ id: 'c4', slot: 3, state: 'happy', deadline: NOW + 9000 }),
            // 바 색 경계 — 45%(warn) 와 51%(보통) 를 나란히 둔다
            customer({ id: 'c5', slot: 4, name: '반쯤 기다린 손님', deadline: NOW + 27000 }),
            customer({ id: 'c6', slot: 5, name: '아직 여유', deadline: NOW + 30600 }),
            customer({ id: 'c7', slot: 6, name: '거의 끝', deadline: NOW + 14400 }),
          ],
        }),
      });
      s.S.kitchen = kitchen({
        cookers: [
          { state: 'ready', at: 0, servings: 3 },
          { state: 'cooking', at: NOW - 2000, servings: 0 },
        ],
      });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 김밥 들고 포커스',
    run: (s) => {
      s.S.kitchen = kitchen({ hands: [{ id: 'me', holding: hold({}) }] });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 속재료 없는 김밥',
    run: (s) => {
      s.S.kitchen = kitchen({ hands: [{ id: 'me', holding: hold({ fills: [] }) }] });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 탄 재료',
    run: (s) => {
      s.S.kitchen = kitchen({
        hands: [{ id: 'me', holding: { uid: 2, id: 'ham', stage: 'burnt', quality: 0 } }],
      });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 빗자루',
    run: (s) => {
      s.S.kitchen = kitchen({
        hands: [
          { id: 'me', holding: { uid: 3, id: 'broom', stage: 'done', quality: 100, rack: 0 } },
        ],
      });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 해금 웨이브의 재료 힌트',
    run: (s) => {
      s.S.state = state({
        phase: 'playing',
        wave: wave({ wave: 2, customers: [customer()] }),
      });
      s.S.kitchen = kitchen({
        hands: [{ id: 'me', holding: { uid: 4, id: 'crab', stage: 'done', quality: 100 } }],
      });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 조준 문구 (보통 · 막힘 · 위험)',
    run: (s) => {
      s.P.prompt = { text: '집기', key: 'E' };
      s.ui.renderHUD(true);
      s.P.prompt = { text: '손이 가득합니다', disabled: true };
      s.ui.renderHUD(true);
      s.P.prompt = { text: '태워먹기 직전', danger: true };
      s.ui.renderHUD(true);
      s.P.prompt = null;
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 손님 조준',
    run: (s) => {
      s.P.target = { userData: { station: { kind: 'customer', id: 'c1' } } };
      s.S.state = state({ phase: 'playing', wave: wave() });
      s.ui.renderHUD(true);
      s.P.target = null;
    },
  },
  {
    name: 'HUD · 평판 낮음',
    run: (s) => {
      s.S.state = state({ phase: 'playing', wave: wave({ reputation: 22, score: 10 }) });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 일시정지 (방장)',
    run: (s) => {
      s.S.state = state({ phase: 'playing', paused: true, pausedAt: NOW, wave: wave() });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 일시정지 (손님)',
    run: (s) => {
      s.S.state = state({
        phase: 'playing',
        paused: true,
        pausedAt: NOW,
        hostId: 'p1',
        players: [player(0), player(1)],
        wave: wave(),
      });
      s.ui.renderHUD(true);
    },
  },
  {
    name: 'HUD · 일시정지 해제',
    run: (s) => {
      s.S.state = state({ phase: 'playing', wave: wave() });
      s.ui.renderHUD(true);
    },
  },
  { name: '웨이브 팝업 · 클리어', run: (s) => s.ui.wavePop({ wave: 3, happy: 4, angry: 1 }) },
  { name: '웨이브 팝업 · 손님 없음', run: (s) => s.ui.wavePop({ wave: 4, happy: 0, angry: 0 }) },
  {
    name: '웨이브 팝업 · 완주',
    run: (s) => s.ui.wavePop({ wave: 10, happy: 9, angry: 0, victory: true }),
  },
  {
    name: '토스트 7개 (5개까지만 남는다)',
    run: (s) => {
      for (let i = 1; i <= 7; i++) s.ui.toast('알림 ' + i, i % 2 ? 'good' : 'bad');
    },
  },
  {
    /* 이름과 가게 이름은 사용자가 적는다. esc() 가 빠지면 innerHTML 로
       실제 태그가 되어 화면이 통째로 달라진다 — 그 자리를 짚는다. */
    name: '특수문자 이름 · HTML 이스케이프',
    run: (s) => {
      const nasty = '<img src=x onerror="alert(1)">';
      /* `&` 는 뒤에 엔티티 이름이 붙을 때만 드러난다 — 그냥 `&` 하나로는
         escape 를 빼도 같은 글자가 나와서 검사가 헛돈다.
         `"` 는 속성값(색)으로 들어가는 자리에서만 드러난다.
         `>` 와 `'` 는 이스케이프를 빼도 DOM 이 같다 — 맨 `>` 는 그냥 글자로
         파싱되고, 생성되는 속성은 전부 큰따옴표라 `'` 가 끼어들 자리가 없다.
         레거시와 같은 표를 쓰는 것으로 족하다. */
      s.S.state = state({
        shop: '&lt;김&gt; &amp; "밥"',
        phase: 'playing',
        players: [
          player(0, { name: nasty, color: 'red" onload="boom' }),
          player(1, { name: "오'라이언 &amp; <b>굵게</b>" }),
        ],
        wave: wave({
          nextUnlock: { wave: 4, id: 'egg', name: '<계란 & "지단">' },
          customers: [customer({ name: nasty + ' &amp;', emoji: '<b>' })],
        }),
      });
      s.P.prompt = { text: '<script>alert(1)</script> & "집기"', key: 'E' };
      s.ui.renderHUD(true);
      s.S.state = state({
        shop: '&lt;김&gt; &amp; "밥"',
        players: [player(0, { name: nasty, color: 'red" onload="boom' })],
      });
      s.ui.renderLobby();
      s.P.prompt = null;
    },
  },
  {
    name: '결과 · 특수문자 가게 이름',
    run: (s) => {
      s.S.state = state({
        phase: 'result',
        result: result({
          shop: '<b>김&amp;밥</b>',
          players: [{ name: '<i>나</i>', color: 'gold" onload="boom' }],
          board: {
            top: [row(0, { shop: '"따" &amp;' }), row(1, { shop: '<김>' })],
            myRank: 2,
            total: 9,
            outside: null,
          },
        }),
      });
      s.ui.route();
    },
  },
  { name: '도움말 열기', run: (s) => s.ui.toggleHelp() },
  { name: '도움말 닫기', run: (s) => s.ui.toggleHelp() },
];

STEPS.push(
  {
    name: '결과 · 폐업 · 10위 밖',
    run: (s) => {
      s.S.state = state({ phase: 'result', result: result() });
      s.ui.route();
    },
  },
  {
    name: '결과 · 완주 · 1위 · 깨끗',
    run: (s) => {
      s.S.state = state({
        phase: 'result',
        result: result({
          kind: 'victory',
          wave: 10,
          rank: 1,
          mess: 0,
          messPenalty: 0,
          angry: 0,
          avgQuality: 96,
          board: { top: [row(0, { id: 'mine' })], myRank: 1, total: 40, outside: null },
        }),
      });
      s.ui.route();
    },
  },
  {
    name: '결과 · 랭킹 기록 없음 · 저장 대기',
    run: (s) => {
      s.S.state = state({
        phase: 'result',
        result: result({
          rank: null,
          board: { top: [], myRank: null, total: 0, outside: null },
          storage: {
            mode: 'redis',
            ready: false,
            pending: 2,
            error: null,
            lastReadAt: null,
            lastWriteAt: null,
            failures: 0,
          },
        }),
      });
      s.ui.route();
    },
  },
  {
    name: '결과 · 저장 실패',
    run: (s) => {
      s.S.state = state({
        phase: 'result',
        result: result({
          storage: {
            mode: 'redis',
            ready: false,
            pending: 1,
            error: 'ECONNRESET',
            lastReadAt: null,
            lastWriteAt: null,
            failures: 3,
          },
        }),
      });
      s.ui.route();
    },
  },
  {
    name: '로비 랭킹 · 10줄 넘게 와도 10줄만',
    run: async (s) => {
      boardRows = Array.from({ length: 12 }, (_, i) => row(i));
      await s.ui.loadLobbyBoard(true);
    },
  },
  {
    name: '로비 랭킹 · 기록 없음',
    run: async (s) => {
      boardRows = [];
      await s.ui.loadLobbyBoard(true);
    },
  },
  {
    name: '로비 랭킹 · 불러오기 실패',
    run: async (s) => {
      boardFails = true;
      await s.ui.loadLobbyBoard(true);
      boardFails = false;
    },
  },
  {
    name: '입장 · 이름이 짧으면 막는다',
    run: () => {
      (document.getElementById('input-name') as HTMLInputElement).value = '김';
      (document.getElementById('btn-create') as HTMLButtonElement).click();
    },
  },
  {
    name: '입장 · 이름을 치면 가게 이름 미리보기가 따라온다',
    run: () => {
      const name = document.getElementById('input-name') as HTMLInputElement;
      name.value = '김알바';
      name.dispatchEvent(new Event('input', { bubbles: true }));
    },
  },
  {
    name: '입장 · 연결 전에 누르면 안내가 뜬다',
    run: () => (document.getElementById('btn-create') as HTMLButtonElement).click(),
  },
  {
    name: '입장 · 방 코드가 짧으면 막는다',
    run: () => {
      (document.getElementById('input-code') as HTMLInputElement).value = 'AB';
      (document.getElementById('btn-join') as HTMLButtonElement).click();
    },
  },
);

/* ──────────────── 한 판 돌리기 ──────────────── */

interface Shot {
  step: string;
  dom: unknown;
}

interface Run {
  shots: Shot[];
  elements: number;
}

async function runTrace(side: Side): Promise<Run> {
  const root = side.mount();
  localStorage.clear();
  // 레거시와 이식본이 같은 시계를 본다
  Object.assign(side.S, {
    socket: null,
    meId: 'me',
    meName: '나',
    state: null,
    kitchen: null,
    positions: [],
    offset: 0,
    connection: 'connecting',
    frozenAt: 0,
    restorePose: null,
    recoveryMs: 20000,
  });
  Object.assign(side.P, { target: null, prompt: null, overlayOpen: false, enabled: false });
  boardRows = [row(0), row(1)];
  boardFails = false;

  side.ui.initUI();
  const shots: Shot[] = [{ step: '초기화', dom: describeElement(root).children }];
  await flush();
  shots.push({ step: '초기화 · 랭킹 도착', dom: describeElement(root).children });

  for (const step of STEPS) {
    await step.run(side);
    await flush();
    shots.push({ step: step.name, dom: describeElement(root).children });
  }
  side.stop();
  return { shots, elements: countElements(describeElement(root)) };
}

/* ──────────────── 검사 ──────────────── */

describe('DOM UI — 레거시 동등성', () => {
  let legacy: Run;
  let port: Run;
  let mono = 5_000;

  beforeAll(async () => {
    vi.useFakeTimers({ now: NOW });
    // renderHUD 의 15Hz 제한이 양쪽에서 같은 자리에 걸리게 한다
    vi.spyOn(performance, 'now').mockImplementation(() => (mono += 200));
    legacy = await runTrace(SIDES[0]);
    mono = 5_000;
    port = await runTrace(SIDES[1]);
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('두 구현은 서로 다른 모듈이다 (같으면 자기 자신과의 비교다)', () => {
    expect(portUi.renderHUD).not.toBe(legacyUi.renderHUD);
    expect(legacy.shots.length).toBe(STEPS.length + 2);
    expect(port.shots.length).toBe(STEPS.length + 2);
  });

  it('화면이 실제로 들어찬다 (빈 화면끼리면 비교가 무의미하다)', () => {
    expect(legacy.elements).toBeGreaterThan(150);
    expect(port.elements).toBe(legacy.elements);
  });

  it('단계마다 화면이 실제로 바뀐다 (안 바뀌면 호출이 안 먹은 것이다)', () => {
    const seen = new Set(legacy.shots.map((s) => JSON.stringify(s.dom)));
    expect(seen.size).toBeGreaterThan(STEPS.length - 6);
  });

  it('단계마다 화면이 태그 · 속성 · 글자까지 같다', () => {
    for (let i = 0; i < legacy.shots.length; i++) {
      const a = legacy.shots[i];
      const b = port.shots[i];
      expect(b.step).toBe(a.step);
      expect(firstDifference(b.dom, a.dom), a.step).toBe(null);
    }
  });
});
