/* Untrusted wire data is validated before touching game state. No coercion of
 * objects, arrays or prototype property names into indices/identifiers. */
import { ITEMS, BURNERS, BOARD_COUNT, MAT_COUNT, COOKER_COUNT, BROOM_COUNT } from '../public/js/config.js';
import { NAME_MIN, NAME_MAX, SHOP_INPUT_MAX, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from '../public/js/game-rules.js';

export const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const index = (v, count) => Number.isInteger(v) && v >= 0 && v < count;
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const roomCodePattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`, 'i');

const stationActions = new Map([
  ...['cooker:put', 'cooker:take'].map(a => [a, ['cooker', COOKER_COUNT]]),
  ...['burner:put', 'burner:take'].map(a => [a, ['slot', BURNERS.length]]),
  ...['board:put', 'board:take'].map(a => [a, ['board', BOARD_COUNT]]),
  ...['mat:put', 'mat:undo', 'mat:roll', 'mat:take'].map(a => [a, ['mat', MAT_COUNT]]),
  ['broom:take', ['rack', BROOM_COUNT]]
]);
const emptyActions = new Set(['sink:put', 'sink:rinse', 'sink:take', 'bin:drop', 'drop']);

export function validKitchenAction(action, payload = {}) {
  if (typeof action !== 'string' || !record(payload)) return false;
  const spec = stationActions.get(action);
  if (spec) return index(payload[spec[0]], spec[1]);
  if (emptyActions.has(action)) return true;
  if (action === 'serve') return payload.customerId === undefined || text(payload.customerId, 64);
  return action === 'fridge:take' && text(payload.item, 32)
    && Object.hasOwn(ITEMS, payload.item) && !!ITEMS[payload.item].fridge;
}

export function validEvent(event, d) {
  switch (event) {
    case 'room:create': case 'room:join':
      return record(d) && text(d.name, NAME_MAX) && d.name.trim().length >= NAME_MIN
        && (d.look === undefined || record(d.look))
        && (d.look === undefined || Object.values(d.look).every(v => typeof v === 'number' && Number.isFinite(v)))
        && (event !== 'room:create' || d.shop === undefined || text(d.shop, SHOP_INPUT_MAX))
        && (event !== 'room:join' || (typeof d.code === 'string' && roomCodePattern.test(d.code.trim())));
    case 'game:start': case 'game:pause': case 'game:lobby': case 'room:leave':
      return d === undefined || d === null;
    case 'kitchen:act':
      return record(d) && validKitchenAction(d.action, d.payload === undefined ? {} : d.payload);
    case 'player:move':
      return record(d) && ['x', 'y', 'z', 'ry'].every(k => typeof d[k] === 'number' && Number.isFinite(d[k]))
        && (d.version===undefined || (Number.isSafeInteger(d.version) && d.version>=0));
    case 'player:swing':
      return d === undefined || d === null || (record(d)
        && (d.targetId === undefined || d.targetId === null || text(d.targetId, 64))
        && (d.targetKind === undefined || d.targetKind === null || ['player', 'customer'].includes(d.targetKind)));
    default: return false;
  }
}

export const EVENT_BUDGET = {
  'room:create': [3, 0.2], 'room:join': [6, 0.5], 'room:leave': [3, 0.5],
  'game:start': [3, 1], 'game:pause': [3, 1], 'game:lobby': [3, 1],
  'kitchen:act': [20, 12], 'player:move': [60, 40], 'player:swing': [4, 3]
};

/** Bounded lifetime: one limiter per socket, discarded on disconnect. */
export function createEventLimiter(now = () => performance.now()) {
  const buckets = new Map();
  return event => {
    const spec = EVENT_BUDGET[event];
    if (!spec) return false;
    const [capacity, rate] = spec, t = now();
    const old = buckets.get(event) || { tokens: capacity, at: t };
    const tokens = Math.min(capacity, old.tokens + Math.max(0, t - old.at) * rate / 1000);
    const allowed = tokens >= 1;
    buckets.set(event, { tokens: Math.max(0, tokens - (allowed ? 1 : 0)), at: t });
    return allowed;
  };
}

/** Browser origin protection also applies to WebSocket (CORS alone does not). */
export function allowedOrigin(req, configured = '') {
  const origin = req.headers.origin;
  if (!origin) return true; // native clients / local diagnostics; not authentication
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
    const allowed = configured.split(',').map(s => s.trim()).filter(Boolean);
    return allowed.length ? allowed.includes(origin) : parsed.host === req.headers.host;
  } catch { return false; }
}
