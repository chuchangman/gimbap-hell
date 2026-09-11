/* 재료와 공정 시간. 서버 판정과 클라이언트 안내 문구가 같은 정의를 읽는다. */

/** 공정 시간 (초) */
export const TIME = {
  riceRinse: 5, // 싱크대에서 쌀 헹구는 횟수 (E 연타)
  riceCook: 10, // 밥솥 취사 시간
  riceYield: 5, // 한 솥에서 나오는 밥 (= 김밥 5줄 분량)
  fryHam: 5, // 가스렌지 — 햄 볶기
  blanchSpinach: 5, // 가스렌지 — 시금치 데치기
  fryEgg: 6, // 가스렌지 — 계란 지단 부치기
  fryCarrot: 4, // 가스렌지 — 당근 볶기
  fryFishcake: 5, // 가스렌지 — 어묵 볶기
  cutDanmuji: 3, // 도마 — 단무지 자르기
  cutCucumber: 3, // 도마 — 오이 자르기
  roll: 3, // 조립대 — 말기
  cutRoll: 3, // 도마 — 김밥 자르기
} as const;

/** 'pot'(냄비) · 'pan'(프라이팬) · 'board'(도마). null 이면 손질이 필요 없다. */
export type Station = 'pot' | 'pan' | 'board';
export type ItemStage = 'raw' | 'washed' | 'done' | 'burnt';

export interface ItemDef {
  name: string;
  emoji: string;
  fridge?: boolean;
  fill?: boolean;
  station?: Station | null;
  /** 도마 손질 시간 (초) */
  dur?: number;
  /** 불 조절이 필요한 재료: quality = 100 - |경과 - target| / tol * 100 */
  target?: number;
  tol?: number;
  burn?: number;
  label: Partial<Record<ItemStage, string>>;
}

/* stage: raw → done (→ burnt) */
const ITEM_DEFS = {
  gim: {
    name: '김',
    emoji: '🟫',
    fridge: true,
    label: { raw: '김' },
  },
  rice: {
    name: '쌀',
    emoji: '🌾',
    fridge: true,
    label: { raw: '쌀', washed: '씻은 쌀' },
  },
  bap: {
    name: '밥',
    emoji: '🍚',
    label: { done: '밥' },
  },

  /* ── 기본 속재료 3종 ── */
  danmuji: {
    name: '단무지',
    emoji: '🟡',
    fridge: true,
    fill: true,
    station: 'board',
    dur: TIME.cutDanmuji,
    label: { raw: '단무지', done: '썬 단무지' },
  },
  ham: {
    name: '햄',
    emoji: '🥓',
    fridge: true,
    fill: true,
    station: 'pan',
    target: TIME.fryHam,
    tol: 3.2,
    burn: 11,
    label: { raw: '햄', done: '볶은 햄', burnt: '탄 햄' },
  },
  spinach: {
    name: '시금치',
    emoji: '🥬',
    fridge: true,
    fill: true,
    station: 'pot',
    target: TIME.blanchSpinach,
    tol: 2.6,
    burn: 9,
    label: { raw: '시금치', done: '데친 시금치', burnt: '물러진 시금치' },
  },

  /* ── 웨이브가 지나며 해금되는 추가 재료 5종 ── */
  crab: {
    name: '맛살',
    emoji: '🦀',
    fridge: true,
    fill: true,
    station: null, // 손질 없이 바로 사용
    label: { raw: '맛살', done: '맛살' },
  },
  cucumber: {
    name: '오이',
    emoji: '🥒',
    fridge: true,
    fill: true,
    station: 'board',
    dur: TIME.cutCucumber,
    label: { raw: '오이', done: '썬 오이' },
  },
  egg: {
    name: '계란',
    emoji: '🥚',
    fridge: true,
    fill: true,
    station: 'pan',
    target: TIME.fryEgg,
    tol: 3.0,
    burn: 12,
    label: { raw: '계란', done: '계란 지단', burnt: '탄 계란' },
  },
  carrot: {
    name: '당근',
    emoji: '🥕',
    fridge: true,
    fill: true,
    station: 'pan',
    target: TIME.fryCarrot,
    tol: 2.6,
    burn: 9,
    label: { raw: '당근', done: '볶은 당근', burnt: '탄 당근' },
  },
  fishcake: {
    name: '어묵',
    emoji: '🍢',
    fridge: true,
    fill: true,
    station: 'pan',
    target: TIME.fryFishcake,
    tol: 3.0,
    burn: 10,
    label: { raw: '어묵', done: '볶은 어묵', burnt: '탄 어묵' },
  },

  roll: {
    name: '김밥',
    emoji: '🌯',
    label: { done: '만 김밥' },
  },
  gimbap: {
    name: '김밥 한 줄',
    emoji: '🍣',
    label: { done: '완성된 김밥' },
  },
  broom: {
    name: '빗자루',
    emoji: '🧹',
    label: { done: '빗자루' },
  },
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEM_DEFS;
export const ITEMS: Record<ItemId, ItemDef> = ITEM_DEFS;

/** 손에 든 것 한 개. 서버가 uid 를 매기고 그대로 스냅샷에 실린다. */
export interface HeldItem {
  uid: number;
  id: ItemId;
  stage: ItemStage;
  quality: number;
  /** 김밥·만 김밥에만 있다 */
  fills?: { id: ItemId; quality: number }[];
  /** 빗자루에만 있다 — 어느 거치대에서 가져왔는지 */
  rack?: number;
}

/* 냉장고 진열 — 아래 칸(집는 칸) / 위 칸(집는 칸) 두 줄 */
export const FRIDGE_ROW_A: ItemId[] = ['gim', 'rice', 'danmuji', 'ham', 'spinach'];
export const FRIDGE_ROW_B: ItemId[] = ['crab', 'cucumber', 'egg', 'carrot', 'fishcake'];
export const FRIDGE_ITEMS: ItemId[] = [...FRIDGE_ROW_A, ...FRIDGE_ROW_B];

/* 모든 김밥의 기본이 되는 3종 */
export const BASE_FILLINGS: ItemId[] = ['danmuji', 'ham', 'spinach'];
/* 웨이브가 지나며 해금되는 추가 재료 */
export const EXTRA_FILLINGS: ItemId[] = ['crab', 'cucumber', 'egg', 'carrot', 'fishcake'];
export const ALL_FILLINGS: ItemId[] = [...BASE_FILLINGS, ...EXTRA_FILLINGS];

/* 재료 해금 — 이 웨이브가 시작될 때 풀린다 (쉬운 것부터) */
export const UNLOCKS: Record<number, ItemId> = {
  2: 'crab', // 손질 불필요
  3: 'cucumber', // 도마
  4: 'egg', // 팬
  6: 'carrot', // 팬
  8: 'fishcake', // 팬
};

/** 해당 웨이브까지 쓸 수 있는 추가 재료 */
export function unlockedExtras(wave: number): ItemId[] {
  return EXTRA_FILLINGS.filter((id) => {
    const w = Number(Object.keys(UNLOCKS).find((k) => UNLOCKS[Number(k)] === id));
    return wave >= w;
  });
}

/** 이 웨이브에서 새로 풀리는 재료 (없으면 null) */
export function unlockAt(wave: number): ItemId | null {
  return UNLOCKS[wave] || null;
}

/** 이 재료가 풀리는 웨이브 — 기본 재료와 김·쌀은 1 */
export function itemUnlockWave(id: string): number {
  const w = Object.keys(UNLOCKS).find((k) => UNLOCKS[Number(k)] === id);
  return w ? Number(w) : 1;
}

/** 손에 든 재료의 표시 이름 */
export function itemLabel(
  item: { id: string; stage: ItemStage } | null | undefined,
): string | null {
  if (!item) return null;
  const def = ITEMS[item.id as ItemId];
  if (!def) return '?';
  return def.label?.[item.stage] || def.name;
}

/** 조리 품질 (0~100) — target 에 가까울수록 높다 */
export function cookQuality(def: ItemDef, elapsed: number): number {
  if (!def.target) return 100;
  if (elapsed >= def.burn!) return 0;
  return Math.max(0, Math.round(100 - (Math.abs(elapsed - def.target) / def.tol!) * 100));
}

/** 조리 상태 문구 */
export function cookStatus(
  def: ItemDef,
  elapsed: number,
): { label: string; color: string; q: number } {
  if (elapsed >= def.burn!) return { label: '탔다!', color: '#e05252', q: 0 };
  const q = cookQuality(def, elapsed);
  if (q >= 85) return { label: '딱 좋다!', color: '#58c07a', q };
  if (q >= 55)
    return { label: elapsed < def.target! ? '거의 다 됨' : '살짝 과함', color: '#8fd17a', q };
  if (elapsed < def.target!) return { label: '아직 덜 됐다', color: '#63a8e8', q };
  return { label: '너무 익는다', color: '#f5b942', q };
}

/** 넣은 속재료들의 평균 조리 품질 */
export function cookAverage(fills: { quality: number }[] | null | undefined): number {
  if (!fills || !fills.length) return 0;
  return Math.round(fills.reduce((s, f) => s + f.quality, 0) / fills.length);
}
