import type { StationRef } from '@/features/kitchen/kitchen';
import * as mine from '@/features/kitchen/kitchen';
import { S } from '@/features/net/net';
import * as legacyKitchen from '@legacy/kitchen.js';
import { S as legacyS } from '@legacy/net.js';
import { BURNERS, type ItemId } from '@repo/game-core';
import type { KitchenSnapshot, PublicState } from '@repo/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* resolveAction 은 조준한 설비 × 손에 든 것 × 주방 상태의 곱이다.
   문구 한 줄이 달라지면 플레이어가 다른 행동을 하게 되므로 전부 훑는다.

   두 구현이 각자의 net 모듈에서 S 를 읽으므로 같은 스냅샷을 양쪽에 심는다. */

const NOW = 1_700_000_000_000;

/** 양쪽 S 에 같은 상태를 심는다 */
function setState(state: Partial<PublicState> | null, kitchen: KitchenSnapshot | null): void {
  for (const store of [S as unknown as Record<string, unknown>, legacyS]) {
    store.meId = 'me';
    store.connection = 'connected';
    store.offset = 0;
    store.state = state;
    store.kitchen = kitchen;
  }
}

const hand = (id: string, stage: string, fills?: { id: ItemId; quality: number }[]) => ({
  uid: 1,
  id,
  stage,
  quality: 100,
  ...(fills ? { fills } : {}),
});

function kitchenSnapshot(over: Partial<KitchenSnapshot> = {}): KitchenSnapshot {
  return {
    now: NOW,
    hands: [{ id: 'me', holding: null }],
    sink: null,
    cookers: [
      { state: 'empty', at: 0, servings: 0 },
      { state: 'empty', at: 0, servings: 0 },
    ],
    burners: BURNERS.map(() => null),
    boards: [null, null, null],
    mats: [0, 1, 2].map(() => ({ gim: false, bap: false, fills: [], rolling: false, rollAt: 0 })),
    brooms: [null, null, null],
    mess: 0,
    wasted: 0,
    ...over,
  } as KitchenSnapshot;
}

function waveState(over: Record<string, unknown> = {}): Partial<PublicState> {
  return {
    phase: 'playing',
    paused: false,
    now: NOW,
    wave: {
      now: NOW,
      wave: 3,
      totalWaves: 10,
      phase: 'wave',
      phaseEndsAt: NOW + 30000,
      waiting: 0,
      unlocked: ['danmuji', 'ham', 'spinach', 'crab', 'cucumber'],
      nextUnlock: { wave: 4, id: 'egg', name: '🥚 계란' },
      customers: [
        {
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
        },
        {
          id: 'c2',
          kind: 'kiosk',
          name: '교복 학생',
          emoji: '🎒',
          color: 0x4a6fa5,
          fills: ['danmuji', 'ham', 'spinach'],
          need: 2,
          done: 1,
          slot: 1,
          state: 'wait',
          since: NOW - 2000,
          seed: 3,
          patienceMax: 90,
          deadline: NOW + 70000,
          hp: 3,
          hpMax: 3,
        },
      ],
      targetId: 'c1',
      reputation: 88,
      score: 120,
      servedRolls: 2,
      avgQuality: 80,
      happy: 1,
      angry: 0,
      kicked: 0,
      result: null,
      ...over,
    },
  } as unknown as Partial<PublicState>;
}

/** run 은 함수라 비교할 수 없다. 있다/없다만 맞추고 나머지를 견준다. */
const strip = (h: Record<string, unknown> | null) =>
  h ? { ...h, run: typeof h.run === 'function' } : null;

const HANDS: (ReturnType<typeof hand> | null)[] = [
  null,
  hand('rice', 'raw'),
  hand('rice', 'washed'),
  hand('bap', 'done'),
  hand('gim', 'raw'),
  hand('ham', 'raw'),
  hand('ham', 'done'),
  hand('ham', 'burnt'),
  hand('spinach', 'raw'),
  hand('danmuji', 'raw'),
  hand('crab', 'done'),
  hand('roll', 'done', [{ id: 'ham', quality: 90 }]),
  hand('gimbap', 'done', [
    { id: 'danmuji', quality: 100 },
    { id: 'ham', quality: 90 },
  ]),
  hand('gimbap', 'done', [{ id: 'egg', quality: 50 }]),
  hand('broom', 'done'),
];

const STATIONS: StationRef[] = [
  { kind: 'sink' },
  { kind: 'bin' },
  { kind: 'serve' },
  { kind: 'cooker', cooker: 0 },
  { kind: 'cooker', cooker: 1 },
  { kind: 'burner', slot: 0 },
  { kind: 'burner', slot: 1 },
  { kind: 'board', board: 0 },
  { kind: 'mat', mat: 0 },
  { kind: 'mat', mat: 1 },
  { kind: 'broom', rack: 0 },
  { kind: 'broom', rack: 1 },
  { kind: 'customer', id: 'c1' },
  { kind: 'customer', id: 'c2' },
  { kind: 'customer', id: 'nope' },
  ...(['gim', 'rice', 'danmuji', 'ham', 'crab', 'egg'] as ItemId[]).map((item): StationRef => ({
    kind: 'fridge',
    item,
  })),
];

const KITCHENS: KitchenSnapshot[] = [
  kitchenSnapshot(),
  kitchenSnapshot({ sink: { rinses: 2 } }),
  kitchenSnapshot({ sink: { rinses: 5 } }),
  kitchenSnapshot({
    cookers: [
      { state: 'cooking', at: NOW - 4000, servings: 0 },
      { state: 'ready', at: 0, servings: 3 },
    ],
  }),
  kitchenSnapshot({
    burners: BURNERS.map((_b, i) => (i === 0 ? { id: 'spinach' as ItemId, at: NOW - 3000 } : null)),
  }),
  kitchenSnapshot({
    burners: BURNERS.map((_b, i) => (i === 1 ? { id: 'ham' as ItemId, at: NOW - 20000 } : null)),
  }),
  kitchenSnapshot({
    boards: [{ id: 'danmuji' as ItemId, at: NOW - 1000, dur: 3, quality: 100 }, null, null],
  }),
  kitchenSnapshot({
    boards: [{ id: 'roll' as ItemId, at: NOW - 9000, dur: 3, quality: 90, fills: [] }, null, null],
  }),
  kitchenSnapshot({
    mats: [
      { gim: true, bap: false, fills: [], rolling: false, rollAt: 0 },
      {
        gim: true,
        bap: true,
        fills: [{ id: 'ham' as ItemId, quality: 90 }],
        rolling: false,
        rollAt: 0,
      },
      { gim: true, bap: true, fills: [], rolling: true, rollAt: NOW - 1000 },
    ],
  }),
  kitchenSnapshot({ brooms: ['other', null, null] }),
];

describe('resolveAction', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    setState(null, null);
  });

  it('설비 × 손 × 주방 상태 조합에서 레거시와 같은 문구를 만든다', () => {
    let compared = 0;
    for (const k of KITCHENS) {
      for (const h of HANDS) {
        const snapshot = { ...k, hands: [{ id: 'me', holding: h }] } as KitchenSnapshot;
        setState(waveState(), snapshot);
        for (const st of STATIONS) {
          const label = st.kind + ' / ' + (h ? h.id + ':' + h.stage : '빈손');
          expect(strip(mine.resolveAction(st) as Record<string, unknown> | null), label).toEqual(
            strip(legacyKitchen.resolveAction(st)),
          );
          compared++;
        }
      }
    }
    // 정말 훑었는지 — 조합 수를 못 박는다
    expect(compared).toBe(KITCHENS.length * HANDS.length * STATIONS.length);
    expect(compared).toBeGreaterThan(3000);
  });

  it('영업 전 · 일시정지에도 레거시와 같이 막는다', () => {
    for (const phase of ['lobby', 'result'] as const) {
      setState({ ...waveState(), phase }, kitchenSnapshot());
      for (const st of STATIONS.slice(0, 12)) {
        expect(strip(mine.resolveAction(st) as never), phase + ' ' + st.kind).toEqual(
          strip(legacyKitchen.resolveAction(st)),
        );
      }
    }
    setState({ ...waveState(), paused: true }, kitchenSnapshot());
    for (const st of STATIONS.slice(0, 12)) {
      expect(strip(mine.resolveAction(st) as never), 'paused ' + st.kind).toEqual(
        strip(legacyKitchen.resolveAction(st)),
      );
    }
  });

  it('주방 스냅샷이 없으면 양쪽 모두 null 이다', () => {
    setState(waveState(), null);
    for (const st of STATIONS) {
      expect(mine.resolveAction(st)).toBe(null);
      expect(legacyKitchen.resolveAction(st)).toBe(null);
    }
  });

  it('실제로 쓸 수 있는 동작이 나온다 (전부 disabled 면 비교가 무의미하다)', () => {
    setState(waveState(), kitchenSnapshot());
    const usable = STATIONS.map((st) => mine.resolveAction(st)).filter((h) => h?.key === 'E');
    expect(usable.length).toBeGreaterThan(3);
  });
});

describe('조회 함수', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    setState(null, null);
  });

  it('진행도 · 해금 · 서빙 대상이 레거시와 같다', () => {
    for (const k of KITCHENS) {
      for (const h of HANDS) {
        setState(waveState(), { ...k, hands: [{ id: 'me', holding: h }] } as KitchenSnapshot);
        expect(mine.bapReady()).toEqual(legacyKitchen.bapReady());
        expect(mine.unlockedFills()).toEqual(legacyKitchen.unlockedFills());
        for (let i = 0; i < 2; i++)
          expect(mine.cookerProgress(i), 'cooker' + i).toBe(legacyKitchen.cookerProgress(i));
        for (let i = 0; i < 3; i++) {
          expect(mine.rollProgress(i), 'roll' + i).toBe(legacyKitchen.rollProgress(i));
          expect(mine.missingFills(i), 'missing' + i).toEqual(legacyKitchen.missingFills(i));
          expect(mine.broomTaken(i), 'broom' + i).toBe(legacyKitchen.broomTaken(i));
        }
        for (let i = 0; i < BURNERS.length; i++)
          expect(mine.burnerInfo(i), 'burner' + i).toEqual(legacyKitchen.burnerInfo(i));
        for (let i = 0; i < 3; i++)
          expect(mine.boardInfo(i), 'board' + i).toEqual(legacyKitchen.boardInfo(i));

        const t = mine.serveTarget();
        expect(t?.id).toBe((legacyKitchen.serveTarget() as { id?: string } | null)?.id);
        expect(mine.targetMatch(t as never)).toBe(legacyKitchen.targetMatch(t));

        const f = mine.focusNow();
        const lf = legacyKitchen.focusNow();
        expect([f.focusId, [...f.outline], f.held]).toEqual([lf.focusId, [...lf.outline], lf.held]);
      }
    }
  });

  it('진행도가 실제로 0 과 1 사이를 움직인다', () => {
    setState(
      waveState(),
      kitchenSnapshot({
        cookers: [
          { state: 'cooking', at: NOW - 4000, servings: 0 },
          { state: 'ready', at: 0, servings: 3 },
        ],
      }),
    );
    expect(mine.cookerProgress(0)).toBeGreaterThan(0);
    expect(mine.cookerProgress(0)).toBeLessThan(1);
    expect(mine.cookerProgress(1)).toBe(1);
  });
});
