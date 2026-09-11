/* 주방 설비 — 늘리면 3D 배치도 따라간다 */

export interface BurnerDef {
  kind: 'pot' | 'pan';
  label: string;
}

export const BURNERS: BurnerDef[] = [
  { kind: 'pot', label: '냄비' },
  { kind: 'pan', label: '프라이팬' },
  { kind: 'pot', label: '냄비' },
  { kind: 'pan', label: '프라이팬' },
  { kind: 'pan', label: '프라이팬' },
];

export const BOARD_COUNT = 3; // 도마
export const MAT_COUNT = 3; // 조립대(김발)
export const COOKER_COUNT = 2; // 밥솥
export const BROOM_COUNT = 3; // 빗자루

/* 🧹 빗자루 난투 — 서버가 재검사하는 값 */
export const COMBAT = {
  range: 2.6, // 사거리 (m)
  cone: 0.35, // 정면 판정 (dot 값, 약 ±70도)
  cooldown: 650, // 쿨다운 (ms)
  knockback: 5.4, // 밀려나는 속도
} as const;
