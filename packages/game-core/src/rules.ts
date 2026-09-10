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
