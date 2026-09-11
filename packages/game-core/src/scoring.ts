/* 점수와 주문 맞춤도. 화면 미리보기와 서버 정산이 같은 함수를 쓴다. */
import { cookAverage, ITEMS, type ItemId, type ItemStage } from './items.js';

export const SCORE = {
  perRoll: 10, // 김밥 한 줄 낼 때마다 (품질 비례)
  complete: 60, // 손님 주문을 다 채웠을 때
  timeBonus: 40, // + 남은 인내심 비율 × 이 값
  specialBonus: 1.5, // 진상 손님을 만족시키면 배수
  leave: -60, // 손님이 인내심 0으로 돌아갔을 때
  repLoss: 12, // 그때 깎이는 평판
  repLossSpecial: 18, // 진상 손님을 놓치면 더 크게
  kick: -25, // 빗자루로 쫓아냈을 때 점수 (그냥 놓치는 것보단 낫다)
  repLossKick: 6, // 그때 깎이는 평판 (시간 초과보다 적다 — 손절 선택지)
  messPenalty: 5, // 재료를 바닥에 버릴 때마다
} as const;

export interface Fill {
  id: ItemId;
  quality: number;
}

/* ────────────────────────────────────────────────────────────
   주문 ↔ 김밥 맞춤도
   빠진 재료는 크게, 쓸데없이 더 넣은 재료는 조금 깎는다.
   ──────────────────────────────────────────────────────────── */
export function matchScore(
  orderFills: ItemId[] | null | undefined,
  rollFills: Fill[] | null | undefined,
): number {
  const want = new Set(orderFills || []);
  const have = new Set((rollFills || []).map((f) => f.id));
  if (!want.size) return 1;
  let missing = 0;
  let extra = 0;
  for (const id of want) if (!have.has(id)) missing++;
  for (const id of have) if (!want.has(id)) extra++;
  return Math.max(0, 1 - (missing * 0.28 + extra * 0.14));
}

/* 부동소수 동점 판정 여유 — 서버 waves.bestMatch 와 같은 값을 쓴다 */
export const FOCUS_EPS = 1e-9;

/** focusPick 이 훑는 손님. 실제 스냅샷 타입의 부분집합이다. */
export interface FocusCandidate {
  id: string;
  state: string;
  done: number;
  need: number;
  deadline: number;
  fills: ItemId[];
}

export interface FocusResult<T extends FocusCandidate> {
  best: T[];
  bestIds: Set<string>;
  focus: T | null;
  focusId: string | null;
  score: number;
}

/**
 * 지금 들고 있는(또는 만들고 있는) 김밥이 어느 주문에 맞는지 고른다.
 *   best   — 최고점 동점자 전부 (3D 윤곽선 대상, 복수 가능)
 *   focusId— 그 중 가장 급한 한 명 (주문서 취소선 대상)
 * 속재료가 하나도 없으면 비교할 게 없으므로 그냥 가장 급한 주문을 가리킨다.
 * 서버 WaveRunner 의 bestMatch / nextTarget 과 같은 규칙이라
 * 화면과 실제 서빙 결과가 어긋나지 않는다.
 */
export function focusPick<T extends FocusCandidate>(
  customers: T[] | null | undefined,
  fills: Fill[] | null | undefined,
): FocusResult<T> {
  const list = (customers || []).filter((c) => c.state === 'wait' && c.done < c.need);
  const soonest = (arr: T[]): T | null =>
    arr.reduce<T | null>((a, b) => (!a || b.deadline < a.deadline ? b : a), null);
  const none: FocusResult<T> = {
    best: [],
    bestIds: new Set<string>(),
    focus: null,
    focusId: null,
    score: 0,
  };
  if (!list.length) return none;

  // 재료를 아직 아무것도 안 넣었으면 "제일 비슷한 사람"은 뜻이 없다 → 급한 순
  if (!fills || !fills.length) {
    const urgent = soonest(list)!;
    return { best: [], bestIds: new Set<string>(), focus: urgent, focusId: urgent.id, score: 0 };
  }

  let top = -Infinity;
  const scored = list.map((c) => {
    const s = matchScore(c.fills, fills);
    if (s > top) top = s;
    return { c, s };
  });
  const best = scored.filter((x) => x.s >= top - FOCUS_EPS).map((x) => x.c);
  const focus = soonest(best)!;
  return {
    best,
    bestIds: new Set(best.map((c) => c.id)),
    focus,
    focusId: focus.id,
    score: top,
  };
}

/** 최종 품질 = 조리 평균 × 주문 맞춤도 */
export function servedQuality(
  orderFills: ItemId[] | null | undefined,
  rollFills: Fill[] | null | undefined,
): number {
  return Math.round(cookAverage(rollFills) * matchScore(orderFills, rollFills));
}

/**
 * 지금 손에 든 것으로 다음에 뭘 해야 하는지 한 줄. 없으면 null.
 * 재료마다 문구를 따로 적지 않고 station 에서 끌어낸다 —
 * 재료를 추가해도 여기 손댈 일이 없도록.
 */
export function handHint(item: { id: string; stage: ItemStage } | null | undefined): string | null {
  if (!item || item.id === 'broom') return null;
  const def = ITEMS[item.id as ItemId];
  if (!def) return null;

  if (item.stage === 'burnt') return '🗑 못 쓰게 됐습니다 — 음쓰통에 버리세요';
  if (item.id === 'rice') {
    return item.stage === 'washed' ? '🍚 밥솥에 넣어 밥을 지어주세요' : '🚰 싱크대에서 씻어주세요';
  }
  if (item.id === 'bap') return '🍙 조립대에서 김 위에 밥을 펴주세요';
  if (item.id === 'gim') return '🍙 조립대에 김을 깔아주세요';
  if (!def.fill) return null; // 만 김밥·완성 김밥 등
  if (item.stage === 'done') return '🍙 조립대의 김밥에 올려주세요';

  switch (def.station) {
    case 'pan':
      return '🔥 프라이팬에 올려 구워주세요';
    case 'pot':
      return '🔥 냄비에 넣어 데쳐주세요';
    case 'board':
      return '🔪 도마에서 썰어주세요';
    default:
      return '🍙 손질 없이 바로 김밥에 올려주세요';
  }
}
