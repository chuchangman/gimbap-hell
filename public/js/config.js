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

/** 이 재료가 풀리는 웨이브 — 기본 재료와 김·쌀은 1 */
export function itemUnlockWave(id) {
  const w = Object.keys(UNLOCKS).find((k) => UNLOCKS[k] === id);
  return w ? Number(w) : 1;
}

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

/**
 * 지금 손에 든 것으로 다음에 뭘 해야 하는지 한 줄. 없으면 null.
 * 재료마다 문구를 따로 적지 않고 station 에서 끌어낸다 —
 * 재료를 추가해도 여기 손댈 일이 없도록.
 */
export function handHint(item) {
  if (!item || item.id === 'broom') return null;
  const def = ITEMS[item.id];
  if (!def) return null;

  if (item.stage === 'burnt') return '🗑 못 쓰게 됐습니다 — 음쓰통에 버리세요';
  if (item.id === 'rice') {
    return item.stage === 'washed' ? '🍚 밥솥에 넣어 밥을 지어주세요'
                                   : '🚰 싱크대에서 씻어주세요';
  }
  if (item.id === 'bap') return '🍙 조립대에서 김 위에 밥을 펴주세요';
  if (item.id === 'gim') return '🍙 조립대에 김을 깔아주세요';
  if (!def.fill) return null;                       // 만 김밥·완성 김밥 등
  if (item.stage === 'done') return '🍙 조립대의 김밥에 올려주세요';

  switch (def.station) {
    case 'pan':   return '🔥 프라이팬에 올려 구워주세요';
    case 'pot':   return '🔥 냄비에 넣어 데쳐주세요';
    case 'board': return '🔪 도마에서 썰어주세요';
    default:      return '🍙 손질 없이 바로 김밥에 올려주세요';
  }
}

/* 위치 동기화 주기 — 서버와 클라이언트가 같은 값을 봐야 한다.
   예전엔 서버 브로드캐스트 · 클라 송신 · 보간 지연이 세 파일에 따로
   박혀 있어서 한쪽만 고치면 조용히 어긋났다. 여기 하나만 고치면 된다. */
export const NET = {
  tickMs: 67,      // 약 15Hz — 클라가 보내는 주기이자 서버가 뿌리는 주기
  interpMs: 135    // 받는 쪽이 재생하는 지연. 주기의 2배 — 한 번 빠져도 버틴다
};

/* ────────────────────────────────────────────────────────────
   원격 플레이어 위치 보간

   위치는 초당 20번만 오는데 화면은 60Hz 이상이다. 받은 좌표를 그대로
   그리면 초당 20번만 움직여 뚝뚝 끊긴다. 표본을 잠깐 쌓아두고 "조금
   과거"를 그리면 항상 앞뒤 두 표본 사이를 지나가므로 등속으로 흐른다.
   대신 남의 아바타가 그만큼 늦게 보인다 — 같이 요리하는 게임이라
   이 정도 지연은 눈에 안 띈다.
   ──────────────────────────────────────────────────────────── */

/** 두 각도 사이 최단 회전량 (-π ~ π) — 3.1 → -3.1 이 한 바퀴 돌지 않도록 */
export function shortestTurn(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * 시간순 표본 buf 에서 at 시점의 위치를 뽑는다.
 * 범위 밖이면 양 끝 값을 그대로 쓴다 — 없는 미래를 지어내면
 * 벽을 뚫고 나갔다가 되돌아오는 것처럼 보인다.
 */
export function samplePath(buf, at) {
  if (!buf || !buf.length) return null;
  if (at <= buf[0].t) return buf[0];
  const last = buf[buf.length - 1];
  if (at >= last.t) return last;

  for (let i = 1; i < buf.length; i++) {
    const a = buf[i - 1], b = buf[i];
    if (at > b.t) continue;
    const span = b.t - a.t;
    const k = span > 0 ? (at - a.t) / span : 1;
    return {
      t: at,
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * k,
      ry: a.ry + shortestTurn(a.ry, b.ry) * k
    };
  }
  return last;
}

/* ──────────────── 색 ──────────────── */
/* 속재료 색은 눈대중이 아니라 CIEDE2000 으로 벌려 놓은 값이다.
   예전 팔레트는 햄↔맛살 ΔE 4.8, 단무지↔계란 ΔE 6.1 로 사실상 같은 색이었다.
   지금은 최소 ΔE 13.2 — 손대기 전에 거리부터 다시 재 볼 것.
   ※ 그래도 적록색약에서는 8종이 한 대역에 몰려 색으로는 안 갈린다.
     실제 구분은 world.js 의 fillPiece 가 형태로 한다. */
export const C = {
  gim: 0x1f3a26, gimEdge: 0x2c5236,
  riceRaw: 0xefe7d2, riceWashed: 0xf7f2e4, bap: 0xfbf7ec,
  danmuji: 0xf5d020, danmujiCut: 0xf5d020,
  hamRaw: 0xf3c0c2, hamDone: 0xf09a9e, burnt: 0x30231a,
  spinachRaw: 0x3f8f38, spinachDone: 0x1f6b3a,
  crab: 0xf7f3ec, crabRed: 0xdc3c26,
  cucumber: 0x8cc63f, cucumberSkin: 0x2b6b26,
  eggWhite: 0xfdf6e4, eggYolk: 0xf7a815,
  carrot: 0xe2661a,
  fishcake: 0xe8d8b8, fishcakeDone: 0xa77762,
  wood: 0xd8ad74, steel: 0xb9bec4, steelDark: 0x7e858c,
  counter: 0xcfc7b0, counterTop: 0xf5f0e2,
  fridge: 0xd6e6f2, fridgeIn: 0x4d5760, fridgeEdge: 0xd2d9df, fire: 0xff8a3d, water: 0x74c0e8,
  broomStick: 0xb98b46, broomHead: 0xd9b45a
};

/* ────────────────────────────────────────────────────────────
   캐릭터 파츠 — 머리카락 · 얼굴 · 상의

   플레이어가 고른 조합을 서버가 그대로 들고 있다가 모두에게 뿌린다.
   손님은 따로 보내지 않는다 — 이미 있는 seed 로 뽑는다.
   조합을 네트워크에 실으면 손님 한 명당 5바이트가 늘어나는데,
   seed 만 있으면 양쪽이 같은 값을 계산해 낼 수 있어서 0바이트다.

   고른 값은 인덱스로만 주고받는다 (h, hc, f, t, tc — 작은 정수 다섯 개).
   ──────────────────────────────────────────────────────────── */
/* 플레이어 눈높이(m).
   캐릭터 몸도 이 값에 눈을 맞춘다 — 서로 마주 봤을 때 눈높이가 어긋나면
   한쪽이 상대를 내려다보게 되어 어색하다.
   player.js 가 카메라 높이로, world.js 가 몸 배율로 쓴다. */
export const EYE = 1.82;

export const PARTS = {
  hair: [
    { id: 'short', name: '짧은 머리' },
    { id: 'bob',   name: '단발' },
    { id: 'bun',   name: '쪽머리' },
    { id: 'spiky', name: '삐죽머리' },
    { id: 'long',  name: '긴 머리' },
    { id: 'chef',  name: '요리사 모자' },
    { id: 'crab',  name: '게 후드' },
    { id: 'cap',   name: '야구모자' },
    { id: 'bald',  name: '민머리' }
  ],
  face: [
    { id: 'plain',   name: '기본' },
    { id: 'glasses', name: '안경' },
    { id: 'freckle', name: '주근깨' },
    { id: 'beard',   name: '수염' },
    { id: 'blush',   name: '볼터치' }
  ],
  /* 표정 — 눈·눈썹·입을 어떤 각도와 배율로 둘지 고른다.
     손님 얼굴은 상태에 따라 계속 바뀌지만(setFace) 내 캐릭터는 바뀔 일이 없어,
     여기서 고른 표정이 그대로 남는다. id 는 world.js FACE_POSE 의 키다. */
  expression: [
    { id: 'neutral', name: '기본' },
    { id: 'smile',   name: '미소' },
    { id: 'happy',   name: '활짝' },
    { id: 'smug',    name: '새침' },
    { id: 'annoyed', name: '뚱함' },
    { id: 'angry',   name: '매서움' },
    { id: 'shocked', name: '놀람' },
    { id: 'sleepy',  name: '졸림' }
  ],
  top: [
    { id: 'tee',    name: '티셔츠' },
    { id: 'apron',  name: '앞치마' },
    { id: 'stripe', name: '줄무늬' },
    { id: 'hoodie', name: '후드' },
    { id: 'vest',   name: '조끼' },
    { id: 'scout',  name: '스카우트 장비' }
  ],
  bottom: [
    { id: 'shorts', name: '반바지' }
  ]
};

export const PART_COLORS = {
  hair: [0x2a2320, 0x4a3128, 0x8a6a3a, 0xe4e0da, 0xa8442f, 0x3d4a6b],
  top:  [0x4a6fa5, 0xc4763a, 0xb5548a, 0x5b5f6b, 0x4f8f58, 0xd96a6a, 0x3f8f8a, 0x9a6ad0],
  bottom: [0x314b32, 0x3f4550, 0x4a6fa5, 0x8a4f3a, 0x7a4a6b, 0xd96a6a, 0x3f8f8a, 0x9a6ad0]
};

export const DEFAULT_LOOK = { h: 0, hc: 0, f: 0, t: 0, tc: 0, b: 0, bc: 0, e: 0 };

/** 범위를 벗어난 값은 잘라낸다. 클라이언트가 보낸 값은 믿지 않는다 */
export function sanitizeLook(look) {
  const pick = (v, n) => {
    const i = Math.floor(Number(v));
    return Number.isFinite(i) && i >= 0 && i < n ? i : 0;
  };
  const L = look || {};
  return {
    h:  pick(L.h,  PARTS.hair.length),
    hc: pick(L.hc, PART_COLORS.hair.length),
    f:  pick(L.f,  PARTS.face.length),
    t:  pick(L.t,  PARTS.top.length),
    tc: pick(L.tc, PART_COLORS.top.length),
    b:  pick(L.b,  PARTS.bottom.length),
    bc: pick(L.bc, PART_COLORS.bottom.length),
    // 표정은 나중에 생긴 항목이라, 저장해 둔 옛 조합에는 없다. pick 이 0 으로 떨군다.
    e:  pick(L.e,  PARTS.expression.length)
  };
}

/**
 * 손님 조합 — seed 하나에서 결정적으로 뽑는다.
 * 서버와 클라이언트가 같은 값을 얻으므로 네트워크로 보낼 필요가 없다.
 */
export function lookFromSeed(seed) {
  const r = (n) => {
    const x = Math.sin((seed + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    h:  Math.floor(r(1) * PARTS.hair.length),
    hc: Math.floor(r(2) * PART_COLORS.hair.length),
    f:  Math.floor(r(3) * PARTS.face.length),
    t:  Math.floor(r(4) * PARTS.top.length),
    tc: Math.floor(r(5) * PART_COLORS.top.length),
    b:  Math.floor(r(6) * PARTS.bottom.length),
    bc: Math.floor(r(7) * PART_COLORS.bottom.length)
  };
}
