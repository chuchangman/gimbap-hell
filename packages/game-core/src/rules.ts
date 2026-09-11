/* 클라이언트와 서버가 함께 지키는 공개 계약만 둔다.
 * 운영 설정과 비밀값은 apps/server 안에 남는다. */
export const PLAYER_LIMIT = 6;
export const NAME_MIN = 2;
export const NAME_MAX = 12;
export const SHOP_MAX = 16;
/** 와이어는 더 긴 원본 이름을 받아준다. 표시·저장은 여전히 SHOP_MAX 로 자른다. */
export const SHOP_INPUT_MAX = 64;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const DEFAULT_RECOVERY_MS = 30000;

/** 자리번호 순서대로 돌려 쓴다. 서로 구분되는 색이어야 한다 */
export const PLAYER_COLORS = ['#f5b942', '#63a8e8', '#58c07a', '#e0728f', '#a98ae0', '#e08a4a'];

/** 라운드 시작 위치 — 주방 가운데 통로에 흩어놓는다 */
export const SPAWN_POINTS = [
  { x: -1.6, z: 5.6 },
  { x: 1.6, z: 5.6 },
  { x: 0, z: 6.6 },
  { x: -3.2, z: 5.0 },
  { x: 3.2, z: 5.0 },
  { x: 0, z: 4.4 },
];
