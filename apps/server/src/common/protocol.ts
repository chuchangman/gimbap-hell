/* 신뢰할 수 없는 와이어 데이터는 게임 상태에 닿기 전에 검증한다.
 * 객체·배열·프로토타입 속성 이름을 인덱스나 식별자로 강제 변환하지 않는다. */
import {
  BOARD_COUNT,
  BROOM_COUNT,
  BURNERS,
  COOKER_COUNT,
  ITEMS,
  MAT_COUNT,
  NAME_MAX,
  NAME_MIN,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SHOP_INPUT_MAX,
  type ItemId,
} from '@repo/game-core';
import type { IncomingMessage } from 'node:http';

export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const index = (v: unknown, count: number): boolean =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < count;
/** 제어문자(U+0000-U+001F, U+007F)를 하나라도 담고 있는가.
 *  이름·가게 이름에 섞여 들어오면 화면과 로그가 깨진다. */
const hasControlChar = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max && !hasControlChar(v);
const roomCodePattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`, 'i');

type StationSpec = [field: string, count: number];
const stationEntries: [string, StationSpec][] = [
  ...['cooker:put', 'cooker:take'].map((a): [string, StationSpec] => [a, ['cooker', COOKER_COUNT]]),
  ...['burner:put', 'burner:take'].map((a): [string, StationSpec] => [a, ['slot', BURNERS.length]]),
  ...['board:put', 'board:take'].map((a): [string, StationSpec] => [a, ['board', BOARD_COUNT]]),
  ...['mat:put', 'mat:undo', 'mat:roll', 'mat:take'].map((a): [string, StationSpec] => [
    a,
    ['mat', MAT_COUNT],
  ]),
  ['broom:take', ['rack', BROOM_COUNT]],
];
const stationActions = new Map<string, StationSpec>(stationEntries);
const emptyActions = new Set(['sink:put', 'sink:rinse', 'sink:take', 'bin:drop', 'drop']);

export function validKitchenAction(action: unknown, payload: unknown = {}): boolean {
  if (typeof action !== 'string' || !record(payload)) return false;
  const spec = stationActions.get(action);
  if (spec) return index(payload[spec[0]], spec[1]);
  if (emptyActions.has(action)) return true;
  if (action === 'serve') return payload.customerId === undefined || text(payload.customerId, 64);
  return (
    action === 'fridge:take' &&
    text(payload.item, 32) &&
    Object.hasOwn(ITEMS, payload.item) &&
    !!ITEMS[payload.item as ItemId].fridge
  );
}

export function validEvent(event: string, d: unknown): boolean {
  switch (event) {
    case 'room:create':
    case 'room:join': {
      if (!record(d) || !text(d.name, NAME_MAX) || d.name.trim().length < NAME_MIN) return false;
      if (d.look !== undefined && !record(d.look)) return false;
      if (
        d.look !== undefined &&
        !Object.values(d.look).every((v) => typeof v === 'number' && Number.isFinite(v))
      )
        return false;
      if (event === 'room:create' && d.shop !== undefined && !text(d.shop, SHOP_INPUT_MAX))
        return false;
      if (
        event === 'room:join' &&
        !(typeof d.code === 'string' && roomCodePattern.test(d.code.trim()))
      )
        return false;
      return true;
    }
    case 'game:start':
    case 'game:pause':
    case 'game:lobby':
    case 'room:leave':
      return d === undefined || d === null;
    case 'kitchen:act':
      return record(d) && validKitchenAction(d.action, d.payload === undefined ? {} : d.payload);
    case 'player:move':
      return (
        record(d) &&
        (['x', 'y', 'z', 'ry'] as const).every(
          (k) => typeof d[k] === 'number' && Number.isFinite(d[k]),
        ) &&
        (d.version === undefined || (Number.isSafeInteger(d.version) && (d.version as number) >= 0))
      );
    case 'player:swing':
      return (
        d === undefined ||
        d === null ||
        (record(d) &&
          (d.targetId === undefined || d.targetId === null || text(d.targetId, 64)) &&
          (d.targetKind === undefined ||
            d.targetKind === null ||
            ['player', 'customer'].includes(d.targetKind as string)))
      );
    default:
      return false;
  }
}

export const EVENT_BUDGET: Record<string, [number, number]> = {
  'room:create': [3, 0.2],
  'room:join': [6, 0.5],
  'room:leave': [3, 0.5],
  'game:start': [3, 1],
  'game:pause': [3, 1],
  'game:lobby': [3, 1],
  'kitchen:act': [20, 12],
  'player:move': [60, 40],
  'player:swing': [4, 3],
};

/** 수명이 소켓 하나에 묶인다 — 연결이 끊기면 함께 버린다. */
export function createEventLimiter(
  now: () => number = () => performance.now(),
): (event: string) => boolean {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (event: string) => {
    const spec = EVENT_BUDGET[event];
    if (!spec) return false;
    const [capacity, rate] = spec;
    const t = now();
    const old = buckets.get(event) || { tokens: capacity, at: t };
    const tokens = Math.min(capacity, old.tokens + (Math.max(0, t - old.at) * rate) / 1000);
    const allowed = tokens >= 1;
    buckets.set(event, { tokens: Math.max(0, tokens - (allowed ? 1 : 0)), at: t });
    return allowed;
  };
}

/** 브라우저 오리진 보호는 WebSocket 에도 적용해야 한다 (CORS 만으로는 안 막힌다). */
export function allowedOrigin(req: IncomingMessage, configured = ''): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // 네이티브 클라이언트 · 로컬 진단용. 인증이 아니다.
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
    const allowed = configured
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return allowed.length ? allowed.includes(origin) : parsed.host === req.headers.host;
  } catch {
    return false;
  }
}
