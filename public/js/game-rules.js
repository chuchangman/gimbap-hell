// Public client/server contract only. Operational settings and secrets stay in server/.
export const PLAYER_LIMIT = 6;
export const NAME_MIN = 2;
export const NAME_MAX = 12;
export const SHOP_MAX = 16;
// The wire accepts a longer source name; display/storage still truncate to SHOP_MAX.
export const SHOP_INPUT_MAX = 64;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const DEFAULT_RECOVERY_MS = 30000;
