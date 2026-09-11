import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/* 레거시 initWorld 는 WebGLRenderer 를 먼저 만든다. jsdom 에는 WebGL 이 없으니
   렌더러만 가짜로 바꾼다 — initWorld 가 쓰는 것은 setPixelRatio · toneMapping ·
   shadowMap · setSize · render 뿐이라 씬 구축에는 영향이 없다. */
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeRenderer {
    /* 레거시 syncCustomers 가 renderer.domElement.clientHeight 로 테두리
       두께를 환산한다. 비워 두면 Math.max(1, undefined) 가 NaN 이 되어
       손님 테두리 배율이 통째로 NaN 이 된다 — 이식본과 같은 값을 준다. */
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

const legacyMod = await import('@legacy/world.js');
const { buildWorld, stepWorld } = await import('@/features/world/build');
const { scene: mineScene } = await import('@/features/world/scene');
const { interactables: mineInteractables } = await import('@/features/world/scene');
const { describeObject, countMeshes, firstDifference } = await import('@/testing/mesh-snapshot');
const { S } = await import('@/features/net/net');
const { S: legacyS } = await import('@legacy/net.js');
const { setViewportHeight } = await import('@/features/world/scene');

/* 방과 설비를 통째로 지어 놓고 레거시와 씬 트리를 비교한다.
   800줄 가까운 기하 코드를 눈으로 확인할 방법은 없다 — 정점으로 본다. */

describe('방 · 설비 씬 구축', () => {
  beforeAll(() => {
    legacyMod.initWorld(document.createElement('canvas'));
    buildWorld();
  });

  it('두 씬은 서로 다른 객체다 (같으면 비교가 자기 자신과의 비교다)', () => {
    expect(mineScene).not.toBe(legacyMod.scene);
    expect(mineInteractables).not.toBe(legacyMod.interactables);
  });

  it('실제로 씬이 들어찬다 (양쪽이 나란히 비면 비교가 무의미하다)', () => {
    expect(countMeshes(mineScene)).toBeGreaterThan(300);
    expect(countMeshes(legacyMod.scene)).toBeGreaterThan(300);
    // 얼마나 되는지 기록해 둔다 — 나중에 확 줄면 뭔가 빠진 것이다
    expect(countMeshes(mineScene)).toBe(countMeshes(legacyMod.scene));
  });

  it('씬 트리가 레거시와 정점까지 같다', () => {
    expect(describeObject(mineScene)).toEqual(describeObject(legacyMod.scene));
  });

  it('배경색과 안개가 레거시와 같다', () => {
    expect((mineScene.background as THREE.Color).getHexString()).toBe(
      (legacyMod.scene.background as THREE.Color).getHexString(),
    );
    const mine = mineScene.fog as THREE.Fog;
    const theirs = legacyMod.scene.fog as THREE.Fog;
    expect([mine.color.getHexString(), mine.near, mine.far]).toEqual([
      theirs.color.getHexString(),
      theirs.near,
      theirs.far,
    ]);
  });

  it('조준 가능한 설비가 레거시와 같은 순서·같은 데이터로 등록된다', () => {
    expect(mineInteractables.length).toBe(legacyMod.interactables.length);
    expect(mineInteractables.map((m) => m.userData.station)).toEqual(
      legacyMod.interactables.map((m) => m.userData.station),
    );
    // 설비 9종이 모두 있어야 한다
    const kinds = new Set(
      mineInteractables.map((m) => (m.userData.station as { kind?: string }).kind),
    );
    for (const kind of [
      'fridge',
      'sink',
      'cooker',
      'burner',
      'board',
      'mat',
      'bin',
      'broom',
      'serve',
    ])
      expect(kinds, kind).toContain(kind);
  });

  it('그림자는 어느 메시에도 켜져 있지 않다', () => {
    let shadowed = 0;
    mineScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o.castShadow || o.receiveShadow)) shadowed++;
    });
    expect(shadowed).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────
   한 프레임 갱신 — 손님 · 동료 아바타 · 설비 동기화 · 손/팔
   레거시 render() 에서 renderer.render 만 빠진 것이 stepWorld 다.
   같은 스냅샷을 양쪽 S 에 심고 한 프레임 돌린 뒤 씬을 통째로 비교한다.
   ──────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;

function seedBoth(state: unknown, kitchen: unknown, positions: unknown[]): void {
  for (const store of [S as unknown as Record<string, unknown>, legacyS]) {
    store.meId = 'me';
    store.connection = 'connected';
    store.offset = 0;
    store.state = state;
    store.kitchen = kitchen;
    store.positions = positions;
  }
}

const customer = (over: Record<string, unknown>) => ({
  id: 'c1',
  kind: 'counter',
  name: '진상 아저씨',
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
  hpMax: 5,
  ...over,
});

describe('한 프레임 갱신', () => {
  let mono = 5_000;

  beforeAll(() => {
    setViewportHeight(900);
  });

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    mono = 5_000;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
  });
  afterEach(() => {
    /* 정리 프레임을 "가짜 시계를 되돌리기 전에" 돌려야 한다.
       먼저 useRealTimers/restoreAllMocks 를 하면 stepWorld 와 render 가
       실제 시각 몇 마이크로초 차이로 각각 animateStreet(serverNow()) 를
       타서 두 씬이 갈린 채 다음 테스트로 넘어간다 — 그 어긋남이 그대로
       남아 간헐적으로 터졌다. */
    seedBoth(null, null, []);
    mono += 16;
    vi.advanceTimersByTime(16);
    stepWorld(false);
    legacyMod.render(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const state = (customers: unknown[], over: Record<string, unknown> = {}) => ({
    now: NOW,
    code: 'ABCD',
    shop: '검사 김밥',
    phase: 'playing',
    paused: false,
    pausedAt: 0,
    hostId: 'me',
    players: [
      { id: 'me', slot: 0, name: '나', color: '#f5b942', look: {}, connected: true, spawn: {} },
      { id: 'p2', slot: 1, name: '동료', color: '#63a8e8', look: {}, connected: true, spawn: {} },
    ],
    wave: {
      now: NOW,
      wave: 3,
      totalWaves: 10,
      phase: 'wave',
      phaseEndsAt: NOW + 30000,
      waiting: 0,
      unlocked: ['danmuji', 'ham', 'spinach', 'crab'],
      nextUnlock: null,
      customers,
      targetId: 'c1',
      reputation: 90,
      score: 100,
      servedRolls: 1,
      avgQuality: 80,
      happy: 1,
      angry: 0,
      kicked: 0,
      result: null,
    },
    result: null,
    history: [],
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

  it('손님 · 설비 · 손이 있는 프레임이 레거시와 같다', () => {
    seedBoth(
      state([customer({}), customer({ id: 'c2', kind: 'kiosk', slot: 1, emoji: '🎒', seed: 3 })]),
      kitchen({
        hands: [
          {
            id: 'me',
            holding: {
              uid: 1,
              id: 'gimbap',
              stage: 'done',
              quality: 90,
              fills: [{ id: 'ham', quality: 90 }],
            },
          },
        ],
        sink: { rinses: 2 },
        cookers: [
          { state: 'cooking', at: NOW - 4000, servings: 0 },
          { state: 'ready', at: 0, servings: 3 },
        ],
        burners: [{ id: 'spinach', at: NOW - 3000 }, null, null, null, null],
        boards: [{ id: 'danmuji', at: NOW - 1000, dur: 3, quality: 100 }, null, null],
        mats: [
          { gim: true, bap: true, fills: [{ id: 'ham', quality: 90 }], rolling: false, rollAt: 0 },
          { gim: true, bap: true, fills: [], rolling: true, rollAt: NOW - 1000 },
          { gim: false, bap: false, fills: [], rolling: false, rollAt: 0 },
        ],
        brooms: ['p2', null, null],
      }),
      [[1, 2.5, -1.5, 0, 0.4]],
    );
    for (const frame of [0, 1, 2]) {
      mono += 16;
      vi.advanceTimersByTime(16);
      stepWorld(false);
      legacyMod.render(false);
      expect(
        firstDifference(describeObject(mineScene), describeObject(legacyMod.scene)),
        'frame ' + frame,
      ).toBe(null);
    }
    // 손님이 실제로 씬에 들어왔는지
    expect(countMeshes(mineScene)).toBeGreaterThan(300);
  });

  it('손님 상태(입장 · 만족 · 화남 · 쫓겨남)마다 레거시와 같다', () => {
    for (const st of ['walkin', 'wait', 'happy', 'angry', 'kicked']) {
      seedBoth(state([customer({ state: st, since: NOW - 800 })]), kitchen(), []);
      mono += 16;
      vi.advanceTimersByTime(16);
      stepWorld(false);
      legacyMod.render(false);
      expect(
        firstDifference(describeObject(mineScene), describeObject(legacyMod.scene)),
        'state=' + st,
      ).toBe(null);
    }
  });

  it('빗자루를 휘두르는 프레임도 레거시와 같다', () => {
    seedBoth(
      state([customer({})]),
      kitchen({
        hands: [
          { id: 'me', holding: { uid: 9, id: 'broom', stage: 'done', quality: 100, rack: 0 } },
        ],
      }),
      [[1, 2.5, -1.5, 0, 0.4]],
    );
    for (const swinging of [true, false]) {
      mono += 16;
      vi.advanceTimersByTime(16);
      stepWorld(swinging);
      legacyMod.render(swinging);
      expect(
        firstDifference(describeObject(mineScene), describeObject(legacyMod.scene)),
        'swinging=' + swinging,
      ).toBe(null);
    }
  });

  it('손님이 사라지면 양쪽 모두 씬에서 걷어낸다', () => {
    seedBoth(state([customer({})]), kitchen(), []);
    mono += 16;
    stepWorld(false);
    legacyMod.render(false);
    const withCustomer = countMeshes(mineScene);

    seedBoth(state([]), kitchen(), []);
    mono += 16;
    stepWorld(false);
    legacyMod.render(false);
    expect(countMeshes(mineScene)).toBeLessThan(withCustomer);
    expect(countMeshes(mineScene)).toBe(countMeshes(legacyMod.scene));
    expect(firstDifference(describeObject(mineScene), describeObject(legacyMod.scene))).toBe(null);
  });
});
