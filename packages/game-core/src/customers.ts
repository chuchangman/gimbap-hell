/* ────────────────────────────────────────────────────────────
   손님 — 웨이브 디펜스
     kiosk   : 키오스크로 주문만 넣는 일반 손님. 가게에 나타나지 않는다.
               기본 3종 + 해금된 추가 재료를 얹는 주문.
     counter : 카운터에 직접 오는 진상 손님. 커스텀 조합을 요구하고
               인내심이 훨씬 빨리 닳으며 말풍선으로 궁시렁댄다.
   ──────────────────────────────────────────────────────────── */

export const KIND = { KIOSK: 'kiosk', COUNTER: 'counter' } as const;
export type CustomerKind = (typeof KIND)[keyof typeof KIND];

export const QUEUE_SLOTS = 6; // 카운터에 동시에 설 수 있는 손님 수 (넘치면 밖에서 대기)
export const QUEUE_Z = -8.2; // 손님이 서는 줄의 z (서버도 타격 사거리 계산에 쓴다)
/** 자리 번호 → 손님이 서는 x */
export const slotX = (i: number): number => -3.1 + i * 1.25;

/* 🧹 손님 체력 — 빗자루로 이만큼 때리면 쫓겨난다 */
export const CUSTOMER_HP = { normal: 3, special: 5 } as const;
export const WALK_IN_MS = 2200; // 문에서 자리까지 걸어오는 시간
export const WALK_OUT_MS = 1800; // 자리에서 문까지 나가는 시간
export const PREP_FIRST = 25; // 1웨이브 전 준비 시간 (초)
export const PREP_BETWEEN = 18; // 웨이브 사이 준비 시간 (초)
export const REPUTATION_MAX = 100; // 매장 평판 (= 목숨)

/* 진상 손님 인내심 배율 — 낮을수록 빨리 닳는다 */
export const SPECIAL_PATIENCE = 0.62;
/* 전체 손님 중 카운터로 오는 진상 비율 */
export const SPECIAL_RATIO = 0.2;
/* 진상 손님이 요구하는 재료 개수 범위 */
export const SPECIAL_FILLS: [number, number] = [3, 5];

/** 일반 손님이 기본 3종 위에 얹을 수 있는 재료 수 — 웨이브가 갈수록 늘어난다.
 *  `[이 웨이브부터, 몇 개까지]` 를 큰 웨이브부터 적는다. */
export const KIOSK_EXTRA_BY_WAVE: [number, number][] = [
  [7, 2],
  [3, 1],
];

/** 그 웨이브에서 얹을 수 있는 최대 개수 */
export const kioskExtraMax = (wave: number): number =>
  KIOSK_EXTRA_BY_WAVE.find(([from]) => wave >= from)?.[1] ?? 0;

export interface WaveDef {
  n: number;
  orders: number[];
  patience: number;
  gap: number;
}

/* 10개 웨이브.
   기준은 3인 플레이. 인원수에 따라 손님 수가 자동으로 늘고 준다 (scaleCount).

   난이도는 두 축으로 올라간다.
     · 손님 수(n)와 주문량(orders) 이 늘고
     · 인내심(patience) 이 줄어든다
   설비가 늘어난 만큼(화구5·도마3·조립대3·밥솥2) 처리량도 올라가지만
   재료가 8종으로 늘어 한 줄에 드는 손이 많아졌으므로 간격을 넉넉히 잡았다.
   주문은 모두 김밥 1줄. 대신 손님 수가 늘고 들어오는 간격이 좁아진다. */
export const WAVES: WaveDef[] = [
  { n: 2, orders: [1], patience: 110, gap: 20 },
  { n: 3, orders: [1], patience: 105, gap: 18 },
  { n: 5, orders: [1], patience: 100, gap: 14 },
  { n: 6, orders: [1], patience: 95, gap: 11 },
  { n: 7, orders: [1], patience: 90, gap: 11 },
  { n: 9, orders: [1], patience: 84, gap: 8 },
  { n: 10, orders: [1], patience: 78, gap: 8 },
  { n: 12, orders: [1], patience: 72, gap: 8 },
  { n: 14, orders: [1], patience: 66, gap: 7 },
  { n: 16, orders: [1], patience: 58, gap: 6 },
];

/** 인원수에 따른 손님 수 배율 — 3인이 기준(1.0) */
export function scaleCount(n: number, players: number): number {
  const k = 0.3 + 0.235 * Math.max(1, players);
  return Math.max(1, Math.round(n * k));
}

export interface CustomerLook {
  name: string;
  emoji: string;
  color: number;
}

/* 평범한 손님 외형/이름 */
export const NORMAL_LOOKS: CustomerLook[] = [
  { name: '교복 학생', emoji: '🎒', color: 0x4a6fa5 },
  { name: '택배 기사', emoji: '📦', color: 0xc4763a },
  { name: '동네 아주머니', emoji: '👜', color: 0xb5548a },
  { name: '회사원', emoji: '💼', color: 0x5b5f6b },
  { name: '등산객', emoji: '🥾', color: 0x4f8f58 },
  { name: '유치원 선생님', emoji: '🎈', color: 0xd96a6a },
  { name: '편의점 알바', emoji: '🧃', color: 0x3f8f8a },
  { name: '운동하는 형', emoji: '🏋️', color: 0x9a6ad0 },
];

/* 카운터에서 진상 부리는 손님 외형/이름 */
export const CUSTOMER_LOOKS: CustomerLook[] = [
  { name: '진상 아저씨', emoji: '🧔', color: 0x8a5a3a },
  { name: '까다로운 손님', emoji: '🕶️', color: 0x4a4f5a },
  { name: '단골 할머니', emoji: '👵', color: 0xb5548a },
  { name: '유튜버', emoji: '🎥', color: 0x4a6fa5 },
  { name: '리뷰 폭격기', emoji: '⭐', color: 0xd9a441 },
  { name: '배달 대행', emoji: '🛵', color: 0x4f8f58 },
];

/* 인내심 구간별 궁시렁 — 남은 비율이 높은 순서 */
export const GRUMBLES: { over: number; lines: string[] }[] = [
  { over: 0.66, lines: ['언제 나와요~?', '김밥 하나에 몇 분이야', '여기 원래 이렇게 느려요?'] },
  {
    over: 0.38,
    lines: ['아니 진짜 몇 분째야', '저기요, 제 거 잊은 거 아니죠?', '다른 데 갈 걸 그랬나'],
  },
  {
    over: 0.15,
    lines: [
      '장난해요 지금? 사장 불러요',
      '이름값 하네 진짜, 여기가 지옥이야',
      '이럴 거면 환불해줘요',
    ],
  },
  { over: -1, lines: ['됐어요! 별점 1개다', '다시는 안 와 진짜', '리뷰에 다 쓸 거예요'] },
];

/** 남은 인내심 비율(0~1) → 궁시렁 대사 */
export function grumbleFor(pct: number, seed: number): string {
  const band = GRUMBLES.find((g) => pct > g.over) || GRUMBLES[GRUMBLES.length - 1];
  return band.lines[Math.abs(seed || 0) % band.lines.length];
}
