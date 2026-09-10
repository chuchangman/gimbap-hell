import { DEFAULT_RECOVERY_MS } from '../public/js/game-rules.js';

// Server-only tuning: these are not sent to clients or read from public assets.
const DEFAULTS = Object.freeze({
  maxRooms: 64,
  maxConnections: 384,
  loopLagResolutionMs: 10,
  gameTickMs: 200,
  heartbeatMs: 2000,
  shutdownTimeoutMs: 5000,
  http: Object.freeze({ requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 }),
  socket: Object.freeze({ maxHttpBufferSize: 8192, connectTimeout: 10000, pingInterval: 5000, pingTimeout: 5000 })
});
const PORT_DEFAULT = 3211;
const PORT_MAX = 65535;
const RECOVERY_MIN_MS = 1000;
const RECOVERY_MAX_MS = 60000;

/** Pure parsing for startup and tests; preserve zero PORT and legacy recovery fallback. */
export function loadRuntimeConfig(env = process.env) {
  const port = Number(env.PORT ?? PORT_DEFAULT);
  if (!Number.isInteger(port) || port < 0 || port > PORT_MAX) throw new Error('Invalid PORT');
  const recoveryMs = Math.max(RECOVERY_MIN_MS,
    Math.min(RECOVERY_MAX_MS, Number(env.GIMBAP_RECOVERY_MS) || DEFAULT_RECOVERY_MS));
  return Object.freeze({ ...DEFAULTS, port, recoveryMs, allowedOrigins: env.GIMBAP_ALLOWED_ORIGINS || '' });
}
