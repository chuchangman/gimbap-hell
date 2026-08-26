/* ────────────────────────────────────────────────────────────
   김밥 시뮬레이터 — 공용 설정
   서버(server/*.mjs)와 클라이언트가 이 파일 하나를 같이 읽는다.
   수치를 바꾸면 양쪽에 동시에 반영된다.
   ※ DOM 을 절대 건드리지 말 것 (Node 에서도 import 된다).
   ──────────────────────────────────────────────────────────── */

/* 공정 시간 (초) */
export const TIME = {
  riceRinse: 5,      // 싱크대에서 쌀 헹구는 횟수 (E 연타)
  riceCook: 10,      // 밥솥 취사 시간
  riceYield: 5,      // 한 솥에서 나오는 밥 (= 김밥 5줄 분량)
  fryHam: 5,         // 가스렌지 — 햄 볶기
  blanchSpinach: 5,  // 가스렌지 — 시금치 데치기
  fryEgg: 6,         // 가스렌지 — 계란 지단 부치기
  fryCarrot: 4,      // 가스렌지 — 당근 볶기
  fryFishcake: 5,    // 가스렌지 — 어묵 볶기
  cutDanmuji: 3,     // 도마 — 단무지 자르기
  cutCucumber: 3,    // 도마 — 오이 자르기
  roll: 3,           // 조립대 — 말기
  cutRoll: 3         // 도마 — 김밥 자르기
};

/* ────────────────────────────────────────────────────────────
   재료
   stage: raw → done (→ burnt)
   station: 'pot'(냄비) | 'pan'(프라이팬) | 'board'(도마) | null(손질 불필요)
   target/tol/burn 이 있는 재료는 불 조절이 필요하다.
     quality = 100 - |경과 - target| / tol * 100
   ──────────────────────────────────────────────────────────── */
export const ITEMS = {
  gim: {
    name: '김', emoji: '🟫', fridge: true,
    label: { raw: '김' }
  },
  rice: {
    name: '쌀', emoji: '🌾', fridge: true,
    label: { raw: '쌀', washed: '씻은 쌀' }
  },
  bap: {
    name: '밥', emoji: '🍚',
    label: { done: '밥' }
  },

  /* ── 기본 속재료 3종 ── */
  danmuji: {
    name: '단무지', emoji: '🟡', fridge: true, fill: true,
    station: 'board', dur: TIME.cutDanmuji,
    label: { raw: '단무지', done: '썬 단무지' }
  },
  ham: {
    name: '햄', emoji: '🥓', fridge: true, fill: true,
    station: 'pan', target: TIME.fryHam, tol: 3.2, burn: 11,
    label: { raw: '햄', done: '볶은 햄', burnt: '탄 햄' }
  },
  spinach: {
    name: '시금치', emoji: '🥬', fridge: true, fill: true,
    station: 'pot', target: TIME.blanchSpinach, tol: 2.6, burn: 9,
    label: { raw: '시금치', done: '데친 시금치', burnt: '물러진 시금치' }
  },

  /* ── 웨이브가 지나며 해금되는 추가 재료 5종 ── */
  crab: {
    name: '맛살', emoji: '🦀', fridge: true, fill: true,
    station: null,                        // 손질 없이 바로 사용
    label: { raw: '맛살', done: '맛살' }
  },
  cucumber: {
    name: '오이', emoji: '🥒', fridge: true, fill: true,
    station: 'board', dur: TIME.cutCucumber,
    label: { raw: '오이', done: '썬 오이' }
  },
  egg: {
    name: '계란', emoji: '🥚', fridge: true, fill: true,
    station: 'pan', target: TIME.fryEgg, tol: 3.0, burn: 12,
    label: { raw: '계란', done: '계란 지단', burnt: '탄 계란' }
  },
  carrot: {
    name: '당근', emoji: '🥕', fridge: true, fill: true,
    station: 'pan', target: TIME.fryCarrot, tol: 2.6, burn: 9,
    label: { raw: '당근', done: '볶은 당근', burnt: '탄 당근' }
  },
  fishcake: {
    name: '어묵', emoji: '🍢', fridge: true, fill: true,
    station: 'pan', target: TIME.fryFishcake, tol: 3.0, burn: 10,
    label: { raw: '어묵', done: '볶은 어묵', burnt: '탄 어묵' }
  },

  roll: {
    name: '김밥', emoji: '🌯',
    label: { done: '만 김밥' }
  },
  gimbap: {
    name: '김밥 한 줄', emoji: '🍣',
    label: { done: '완성된 김밥' }
  },
  broom: {
    name: '빗자루', emoji: '🧹',
    label: { done: '빗자루' }
  }
};

/* 냉장고 진열 — 아래 칸(집는 칸) / 위 칸(집는 칸) 두 줄 */
export const FRIDGE_ROW_A = ['gim', 'rice', 'danmuji', 'ham', 'spinach'];
export const FRIDGE_ROW_B = ['crab', 'cucumber', 'egg', 'carrot', 'fishcake'];
export const FRIDGE_ITEMS = [...FRIDGE_ROW_A, ...FRIDGE_ROW_B];

/* 모든 김밥의 기본이 되는 3종 */
export const BASE_FILLINGS = ['danmuji', 'ham', 'spinach'];
/* 웨이브가 지나며 해금되는 추가 재료 */
export const EXTRA_FILLINGS = ['crab', 'cucumber', 'egg', 'carrot', 'fishcake'];
export const ALL_FILLINGS = [...BASE_FILLINGS, ...EXTRA_FILLINGS];

/* 재료 해금 — 이 웨이브가 시작될 때 풀린다 (쉬운 것부터) */
export const UNLOCKS = {
  2: 'crab',       // 손질 불필요
  3: 'cucumber',   // 도마
  4: 'egg',        // 팬
  6: 'carrot',     // 팬
  8: 'fishcake'    // 팬
};

/** 해당 웨이브까지 쓸 수 있는 추가 재료 */
export function unlockedExtras(wave) {
  return EXTRA_FILLINGS.filter((id) => {
    const w = Number(Object.keys(UNLOCKS).find((k) => UNLOCKS[k] === id));
    return wave >= w;
  });
}

/** 이 웨이브에서 새로 풀리는 재료 (없으면 null) */
export function unlockAt(wave) { return UNLOCKS[wave] || null; }

/* ────────────────────────────────────────────────────────────
   주방 설비 — 늘리면 3D 배치도 따라간다
   ──────────────────────────────────────────────────────────── */
export const BURNERS = [
  { kind: 'pot', label: '냄비' },
  { kind: 'pan', label: '프라이팬' },
  { kind: 'pot', label: '냄비' },
  { kind: 'pan', label: '프라이팬' },
  { kind: 'pan', label: '프라이팬' }
];
export const BOARD_COUNT = 3;     // 도마
export const MAT_COUNT = 3;       // 조립대(김발)
export const COOKER_COUNT = 2;    // 밥솥
export const BROOM_COUNT = 3;     // 빗자루

/* 🧹 빗자루 난투 — 서버가 재검사하는 값 */
export const COMBAT = {
  range: 2.6,        // 사거리 (m)
  cone: 0.35,        // 정면 판정 (dot 값, 약 ±70도)
  cooldown: 650,     // 쿨다운 (ms)
  knockback: 5.4     // 밀려나는 속도
};

/* ────────────────────────────────────────────────────────────
   손님 — 웨이브 디펜스
     kiosk   : 키오스크로 주문만 넣는 일반 손님. 가게에 나타나지 않는다.
               기본 3종 + 해금된 추가 재료를 얹는 주문.
     counter : 카운터에 직접 오는 진상 손님. 커스텀 조합을 요구하고
               인내심이 훨씬 빨리 닳으며 말풍선으로 궁시렁댄다.
   ──────────────────────────────────────────────────────────── */
export const KIND = { KIOSK: 'kiosk', COUNTER: 'counter' };

export const QUEUE_SLOTS = 6;        // 카운터에 동시에 설 수 있는 손님 수 (넘치면 밖에서 대기)
export const QUEUE_Z = -8.2;         // 손님이 서는 줄의 z (서버도 타격 사거리 계산에 쓴다)
/** 자리 번호 → 손님이 서는 x */
export const slotX = (i) => -3.1 + i * 1.25;

/* 🧹 손님 체력 — 빗자루로 이만큼 때리면 쫓겨난다 */
export const CUSTOMER_HP = { normal: 3, special: 5 };
export const WALK_IN_MS = 2200;      // 문에서 자리까지 걸어오는 시간
export const WALK_OUT_MS = 1800;     // 자리에서 문까지 나가는 시간
export const PREP_FIRST = 25;        // 1웨이브 전 준비 시간 (초)
export const PREP_BETWEEN = 18;      // 웨이브 사이 준비 시간 (초)
export const REPUTATION_MAX = 100;   // 매장 평판 (= 목숨)

/* 진상 손님 인내심 배율 — 낮을수록 빨리 닳는다 */
export const SPECIAL_PATIENCE = 0.62;
/* 전체 손님 중 카운터로 오는 진상 비율 */
export const SPECIAL_RATIO = 0.2;
/* 진상 손님이 요구하는 재료 개수 범위 */
export const SPECIAL_FILLS = [3, 5];

/* 10개 웨이브.
   기준은 3인 플레이. 인원수에 따라 손님 수가 자동으로 늘고 준다 (scaleCount).

   난이도는 두 축으로 올라간다.
     · 손님 수(n)와 주문량(orders) 이 늘고
     · 인내심(patience) 이 줄어든다
   설비가 늘어난 만큼(화구5·도마3·조립대3·밥솥2) 처리량도 올라가지만
   재료가 8종으로 늘어 한 줄에 드는 손이 많아졌으므로 간격을 넉넉히 잡았다. */
/* 주문은 모두 김밥 1줄. 대신 손님 수가 늘고 들어오는 간격이 좁아진다. */
export const WAVES = [
  { n: 2,  orders: [1], patience: 110, gap: 20 },
  { n: 3,  orders: [1], patience: 105, gap: 18 },
  { n: 5,  orders: [1], patience: 100, gap: 14 },
  { n: 6,  orders: [1], patience: 95,  gap: 11 },
  { n: 7,  orders: [1], patience: 90,  gap: 11 },
  { n: 9,  orders: [1], patience: 84,  gap: 8 },
  { n: 10, orders: [1], patience: 78,  gap: 8 },
  { n: 12, orders: [1], patience: 72,  gap: 8 },
  { n: 14, orders: [1], patience: 66,  gap: 7 },
  { n: 16, orders: [1], patience: 58,  gap: 6 }
];

/** 인원수에 따른 손님 수 배율 — 3인이 기준(1.0) */
export function scaleCount(n, players) {
  const k = 0.30 + 0.235 * Math.max(1, players);
  return Math.max(1, Math.round(n * k));
}

/* 방장이 고르는 난이도 — 인내심과 등장 간격에 곱한다 */
export const PACES = {
  easy:   { name: '여유', patience: 1.3, gap: 1.2 },
  normal: { name: '보통', patience: 1.0, gap: 1.0 },
  hard:   { name: '전쟁', patience: 0.8, gap: 0.85 }
};
export const DEFAULT_PACE = 'normal';

/* 평범한 손님 외형/이름 */
export const NORMAL_LOOKS = [
  { name: '교복 학생', emoji: '🎒', color: 0x4a6fa5 },
  { name: '택배 기사', emoji: '📦', color: 0xc4763a },
  { name: '동네 아주머니', emoji: '👜', color: 0xb5548a },
  { name: '회사원', emoji: '💼', color: 0x5b5f6b },
  { name: '등산객', emoji: '🥾', color: 0x4f8f58 },
  { name: '유치원 선생님', emoji: '🎈', color: 0xd96a6a },
  { name: '편의점 알바', emoji: '🧃', color: 0x3f8f8a },
  { name: '운동하는 형', emoji: '🏋️', color: 0x9a6ad0 }
];

/* 카운터에서 진상 부리는 손님 외형/이름 */
export const CUSTOMER_LOOKS = [
  { name: '진상 아저씨', emoji: '🧔', color: 0x8a5a3a },
  { name: '까다로운 손님', emoji: '🕶️', color: 0x4a4f5a },
  { name: '단골 할머니', emoji: '👵', color: 0xb5548a },
  { name: '유튜버', emoji: '🎥', color: 0x4a6fa5 },
  { name: '리뷰 폭격기', emoji: '⭐', color: 0xd9a441 },
  { name: '배달 대행', emoji: '🛵', color: 0x4f8f58 }
];

/* 인내심 구간별 궁시렁 — 남은 비율이 높은 순서 */
export const GRUMBLES = [
  { over: 0.66, lines: ['언제 나와요~?', '김밥 하나에 몇 분이야', '여기 원래 이렇게 느려요?'] },
  { over: 0.38, lines: ['아니 진짜 몇 분째야', '저기요, 제 거 잊은 거 아니죠?', '다른 데 갈 걸 그랬나'] },
  { over: 0.15, lines: ['장난해요 지금? 사장 불러요', '이름값 하네 진짜, 여기가 지옥이야', '이럴 거면 환불해줘요'] },
  { over: -1,   lines: ['됐어요! 별점 1개다', '다시는 안 와 진짜', '리뷰에 다 쓸 거예요'] }
];

/** 남은 인내심 비율(0~1) → 궁시렁 대사 */
export function grumbleFor(pct, seed) {
  const band = GRUMBLES.find((g) => pct > g.over) || GRUMBLES[GRUMBLES.length - 1];
  return band.lines[Math.abs(seed || 0) % band.lines.length];
}

/* 점수 */
export const SCORE = {
  perRoll: 10,        // 김밥 한 줄 낼 때마다 (품질 비례)
  complete: 60,       // 손님 주문을 다 채웠을 때
  timeBonus: 40,      // + 남은 인내심 비율 × 이 값
  specialBonus: 1.5,  // 진상 손님을 만족시키면 배수
  leave: -60,         // 손님이 인내심 0으로 돌아갔을 때
  repLoss: 12,        // 그때 깎이는 평판
  repLossSpecial: 18, // 진상 손님을 놓치면 더 크게
  kick: -25,          // 빗자루로 쫓아냈을 때 점수 (그냥 놓치는 것보단 낫다)
  repLossKick: 6,     // 그때 깎이는 평판 (시간 초과보다 적다 — 손절 선택지)
  messPenalty: 5      // 재료를 바닥에 버릴 때마다
};

/* ──────────────── 계산 헬퍼 (양쪽에서 같이 쓴다) ──────────────── */

/** 손에 든 재료의 표시 이름 */
export function itemLabel(item) {
  if (!item) return null;
  const def = ITEMS[item.id];
  if (!def) return '?';
  return (def.label && def.label[item.stage]) || def.name;
}

/** 조리 품질 (0~100) — target 에 가까울수록 높다 */
export function cookQuality(def, elapsed) {
  if (!def.target) return 100;
  if (elapsed >= def.burn) return 0;
  return Math.max(0, Math.round(100 - (Math.abs(elapsed - def.target) / def.tol) * 100));
}

/** 조리 상태 문구 */
export function cookStatus(def, elapsed) {
  if (elapsed >= def.burn) return { label: '탔다!', color: '#e05252', q: 0 };
  const q = cookQuality(def, elapsed);
  if (q >= 85) return { label: '딱 좋다!', color: '#58c07a', q };
  if (q >= 55) return { label: elapsed < def.target ? '거의 다 됨' : '살짝 과함', color: '#8fd17a', q };
  if (elapsed < def.target) return { label: '아직 덜 됐다', color: '#63a8e8', q };
  return { label: '너무 익는다', color: '#f5b942', q };
}

/** 넣은 속재료들의 평균 조리 품질 */
export function cookAverage(fills) {
  if (!fills || !fills.length) return 0;
  return Math.round(fills.reduce((s, f) => s + f.quality, 0) / fills.length);
}

/* ────────────────────────────────────────────────────────────
   주문 ↔ 김밥 맞춤도
   빠진 재료는 크게, 쓸데없이 더 넣은 재료는 조금 깎는다.
   ──────────────────────────────────────────────────────────── */
export function matchScore(orderFills, rollFills) {
  const want = new Set(orderFills || []);
  const have = new Set((rollFills || []).map((f) => f.id));
  if (!want.size) return 1;
  let missing = 0, extra = 0;
  for (const id of want) if (!have.has(id)) missing++;
  for (const id of have) if (!want.has(id)) extra++;
  return Math.max(0, 1 - (missing * 0.28 + extra * 0.14));
}

/* 부동소수 동점 판정 여유 — 서버 waves.bestMatch 와 같은 값을 쓴다 */
export const FOCUS_EPS = 1e-9;

/**
 * 지금 들고 있는(또는 만들고 있는) 김밥이 어느 주문에 맞는지 고른다.
 *   best   — 최고점 동점자 전부 (3D 윤곽선 대상, 복수 가능)
 *   focusId— 그 중 가장 급한 한 명 (주문서 취소선 대상)
 * 속재료가 하나도 없으면 비교할 게 없으므로 그냥 가장 급한 주문을 가리킨다.
 * 서버 waves.bestMatch / nextTarget 과 같은 규칙이라 화면과 실제 서빙 결과가 어긋나지 않는다.
 */
export function focusPick(customers, fills) {
  const list = (customers || []).filter((c) => c.state === 'wait' && c.done < c.need);
  const soonest = (arr) => arr.reduce((a, b) => (!a || b.deadline < a.deadline ? b : a), null);
  const none = { best: [], bestIds: new Set(), focus: null, focusId: null, score: 0 };
  if (!list.length) return none;

  // 재료를 아직 아무것도 안 넣었으면 "제일 비슷한 사람"은 뜻이 없다 → 급한 순
  if (!fills || !fills.length) {
    const urgent = soonest(list);
    return { best: [], bestIds: new Set(), focus: urgent, focusId: urgent.id, score: 0 };
  }

  let top = -Infinity;
  const scored = list.map((c) => {
    const s = matchScore(c.fills, fills);
    if (s > top) top = s;
    return { c, s };
  });
  const best = scored.filter((x) => x.s >= top - FOCUS_EPS).map((x) => x.c);
  const focus = soonest(best);
  return {
    best,
    bestIds: new Set(best.map((c) => c.id)),
    focus,
    focusId: focus.id,
    score: top
  };
}

/** 최종 품질 = 조리 평균 × 주문 맞춤도 */
export function servedQuality(orderFills, rollFills) {
  return Math.round(cookAverage(rollFills) * matchScore(orderFills, rollFills));
}

/* ──────────────── 색 ──────────────── */
export const C = {
  gim: 0x1f3a26, gimEdge: 0x2c5236,
  riceRaw: 0xefe7d2, riceWashed: 0xf7f2e4, bap: 0xfbf7ec,
  danmuji: 0xf0c53a, danmujiCut: 0xf5d451,
  hamRaw: 0xe89a97, hamDone: 0xd4685f, burnt: 0x30231a,
  spinachRaw: 0x4f8f38, spinachDone: 0x3f7a2c,
  crab: 0xf2f0ea, crabRed: 0xe0574a,
  cucumber: 0x5aa03c, cucumberSkin: 0x2f6b28,
  eggWhite: 0xfaf6e6, eggYolk: 0xf2c03a,
  carrot: 0xe8802f,
  fishcake: 0xe8d8b8, fishcakeDone: 0xd8b98a,
  wood: 0xd8ad74, steel: 0xb9bec4, steelDark: 0x7e858c,
  counter: 0xd9d4c6, counterTop: 0xf1ece1,
  fridge: 0xe6eaee, fire: 0xff8a3d, water: 0x74c0e8,
  broomStick: 0xb98b46, broomHead: 0xd9b45a
};
