import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* 레거시 world 를 띄우려면 렌더러가 필요하다 — build.spec 과 같은 가짜를 쓴다. */
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeRenderer {
    domElement: unknown = { clientHeight: 900, clientWidth: 1600 };
    shadowMap = { enabled: false };
    info = { memory: { geometries: 0, textures: 0 }, render: { calls: 0, triangles: 0 } };
    toneMapping = 0;
    toneMappingExposure = 1;
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

const legacyWorld = await import('@legacy/world.js');
const legacyPlayer = await import('@legacy/player.js');
const { S: legacyS } = await import('@legacy/net.js');
const { buildWorld } = await import('@/features/world/build');
const { camera: mineCamera, setViewportHeight } = await import('@/features/world/scene');
const { S } = await import('@/features/net/net');
const mine = await import('@/features/player/player');

/* 1인칭 컨트롤러는 메시가 아니라 "같은 입력에 같은 자세" 로 검증한다.
   두 구현이 같은 jsdom document 에 리스너를 달므로 키 이벤트 한 번에
   양쪽이 함께 반응한다 — 입력 경로까지 같이 검증된다. */

const NOW = 1_700_000_000_000;
let mono = 5_000;
const minePackets: unknown[] = [];
const legacyPackets: unknown[] = [];

function seedBoth(state: unknown, kitchen: unknown, positions: unknown[]): void {
  const pairs: [Record<string, unknown>, unknown[]][] = [
    [S as unknown as Record<string, unknown>, minePackets],
    [legacyS, legacyPackets],
  ];
  for (const [store, sink] of pairs) {
    store.meId = 'me';
    store.connection = 'connected';
    store.offset = 0;
    store.motionVersion = 0;
    store.state = state;
    store.kitchen = kitchen;
    store.positions = positions;
    store.socket = {
      connected: true,
      emit: (evt: string, data: unknown) => sink.push([evt, data]),
    };
  }
}

const playingState = (customers: unknown[] = []) => ({
  now: NOW,
  code: 'ABCD',
  shop: '검사 김밥',
  phase: 'playing',
  paused: false,
  pausedAt: 0,
  hostId: 'me',
  players: [
    { id: 'me', slot: 0, name: '나', color: '#f5b942', look: {}, connected: true, spawn: {} },
  ],
  wave: {
    now: NOW,
    wave: 3,
    totalWaves: 10,
    phase: 'wave',
    phaseEndsAt: NOW + 30000,
    waiting: 0,
    unlocked: ['danmuji', 'ham', 'spinach'],
    nextUnlock: null,
    customers,
    targetId: null,
    reputation: 90,
    score: 0,
    servedRolls: 0,
    avgQuality: 0,
    happy: 0,
    angry: 0,
    kicked: 0,
    result: null,
  },
  result: null,
  history: [],
});

const emptyKitchen = () => ({
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
});

/** 두 구현의 관측 가능한 상태를 전부 비교한다 */
function samePose(label: string): void {
  expect(mine.getPose(), label + ' pose').toEqual(legacyPlayer.getPose());
  expect(
    [mineCamera.position.x, mineCamera.position.y, mineCamera.position.z],
    label + ' camera',
  ).toEqual([
    legacyWorld.camera.position.x,
    legacyWorld.camera.position.y,
    legacyWorld.camera.position.z,
  ]);
  expect((mine.state.target?.userData.station as unknown) ?? null, label + ' target').toEqual(
    ((legacyPlayer.state.target as { userData?: { station?: unknown } } | null)?.userData
      ?.station as unknown) ?? null,
  );
  expect(mine.state.prompt?.text ?? null, label + ' prompt').toBe(
    legacyPlayer.state.prompt?.text ?? null,
  );
  expect(mine.isSwinging(), label + ' swinging').toBe(legacyPlayer.isSwinging());
}

const key = (code: string, down: boolean) =>
  document.dispatchEvent(
    new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }),
  );

/** 두 구현을 같은 dt 로 한 프레임 굴린다 */
function step(dt: number): void {
  mono += dt * 1000;
  vi.advanceTimersByTime(dt * 1000);
  mine.updatePlayer(dt);
  legacyPlayer.updatePlayer(dt);
}

describe('1인칭 컨트롤러', () => {
  beforeAll(() => {
    setViewportHeight(900);
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    legacyWorld.initWorld(canvas);
    buildWorld();
    legacyPlayer.initPlayer(canvas);
    mine.initPlayer(canvas);
  });

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    /* mono 는 테스트마다 되돌리지 않는다. player 모듈의 lastSent 는 모듈 상태라
       테스트를 넘어 남는데, 시계를 되감으면 t - lastSent 가 음수가 되어
       이동 패킷이 영원히 안 나간다 (양쪽 다 안 나가서 조용히 통과한다). */
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    minePackets.length = 0;
    legacyPackets.length = 0;
    seedBoth(playingState(), emptyKitchen(), []);
    for (const st of [mine.state, legacyPlayer.state]) {
      st.enabled = true;
      st.overlayOpen = false;
    }
    mine.resetPose({ x: -1.6, z: 5.6, y: 0, ry: 0 });
    legacyPlayer.resetPose({ x: -1.6, z: 5.6, y: 0, ry: 0 });
    mine.setLook(0, 0);
    legacyPlayer.setLook(0, 0);
  });

  afterEach(() => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft']) key(code, false);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('같은 자리에서 시작한다', () => {
    samePose('reset');
    expect(mine.getPose()).toMatchObject({ x: -1.6, z: 5.6, yaw: 0 });
  });

  it('WASD 이동이 프레임마다 레거시와 같다', () => {
    for (const [code, label] of [
      ['KeyW', '앞'],
      ['KeyS', '뒤'],
      ['KeyA', '왼'],
      ['KeyD', '오른'],
    ] as const) {
      mine.resetPose({ x: -1.6, z: 5.6, y: 0, ry: 0 });
      legacyPlayer.resetPose({ x: -1.6, z: 5.6, y: 0, ry: 0 });
      key(code, true);
      for (let i = 0; i < 20; i++) {
        step(1 / 60);
        samePose(label + ' #' + i);
      }
      key(code, false);
      // 실제로 움직였는지 — 안 움직이면 비교가 무의미하다
      const moved = Math.hypot(mine.getPose().x + 1.6, mine.getPose().z - 5.6);
      expect(moved, label + ' 이동 거리').toBeGreaterThan(0.5);
    }
  });

  it('달리기 · 점프 · 대각 이동도 레거시와 같다', () => {
    key('KeyW', true);
    key('KeyD', true);
    key('ShiftLeft', true);
    for (let i = 0; i < 12; i++) {
      step(1 / 60);
      samePose('run-diag #' + i);
    }
    key('Space', true);
    for (let i = 0; i < 40; i++) {
      step(1 / 60);
      samePose('jump #' + i);
    }
    // 실제로 떴다가 내려왔는지
    expect(mineCamera.position.y).toBeCloseTo(legacyWorld.camera.position.y, 10);
  });

  it('시점을 돌린 채 움직여도 레거시와 같다', () => {
    for (const [y, p] of [
      [0.8, 0.3],
      [-1.7, -0.6],
      [3.1, 1.34],
      [-3.1, -1.34],
    ]) {
      mine.setLook(y, p);
      legacyPlayer.setLook(y, p);
      key('KeyW', true);
      for (let i = 0; i < 10; i++) {
        step(1 / 60);
        samePose('look ' + y + ' #' + i);
      }
      key('KeyW', false);
    }
  });

  it('벽과 설비에 부딪혀도 같은 자리에서 멈춘다', () => {
    // 왼쪽 벽으로 계속 밀어붙인다
    mine.setLook(Math.PI / 2, 0);
    legacyPlayer.setLook(Math.PI / 2, 0);
    key('KeyW', true);
    for (let i = 0; i < 120; i++) {
      step(1 / 60);
      samePose('wall #' + i);
    }
    // 벽을 뚫지 않았는지
    expect(mine.getPose().x).toBeGreaterThan(-8);
  });

  it('넉백이 포물선을 그리며 같은 궤적으로 날아간다', () => {
    mine.applyKnockback(1, 0, 5.4);
    legacyPlayer.applyKnockback(1, 0, 5.4);
    for (let i = 0; i < 60; i++) {
      step(1 / 60);
      samePose('knock #' + i);
    }
    expect(mine.getPose().x).toBeGreaterThan(-1.6);
  });

  it('서버 보정을 같은 방식으로 반영한다', () => {
    key('KeyW', true);
    for (let i = 0; i < 5; i++) step(1 / 60);
    const pose = { x: -1.6, z: 5.6, y: 0, version: 1 };
    mine.correctPose(pose);
    legacyPlayer.correctPose(pose);
    samePose('corrected');
    for (let i = 0; i < 5; i++) {
      step(1 / 60);
      samePose('after correct #' + i);
    }
  });

  it('이동 패킷이 같은 시점에 같은 내용으로 나간다', () => {
    key('KeyW', true);
    for (let i = 0; i < 40; i++) step(1 / 60);
    expect(minePackets.length, '패킷이 하나도 안 나갔다').toBeGreaterThan(3);
    expect(minePackets).toEqual(legacyPackets);
  });

  it('영업 전 · 오버레이 중에는 양쪽 모두 움직이지 않는다', () => {
    seedBoth({ ...playingState(), phase: 'lobby' }, emptyKitchen(), []);
    key('KeyW', true);
    for (let i = 0; i < 10; i++) step(1 / 60);
    samePose('lobby');
    expect(mine.getPose()).toMatchObject({ x: -1.6, z: 5.6 });

    seedBoth(playingState(), emptyKitchen(), []);
    for (const st of [mine.state, legacyPlayer.state]) st.overlayOpen = true;
    for (let i = 0; i < 10; i++) step(1 / 60);
    samePose('overlay');
    for (const st of [mine.state, legacyPlayer.state]) st.overlayOpen = false;
  });

  it('동료를 통과하지 못한다', () => {
    seedBoth(
      {
        ...playingState(),
        players: [
          { id: 'me', slot: 0, name: '나', color: '#f5b942', look: {}, connected: true, spawn: {} },
          {
            id: 'p2',
            slot: 1,
            name: '동료',
            color: '#63a8e8',
            look: {},
            connected: true,
            spawn: {},
          },
        ],
      },
      emptyKitchen(),
      [[1, -1.6, 4.2, 0, 0]],
    );
    key('KeyW', true);
    for (let i = 0; i < 60; i++) {
      step(1 / 60);
      samePose('vs player #' + i);
    }
  });
});
