import { DEFAULT_RECOVERY_MS } from '@repo/game-core';

// 서버 전용 튜닝값. 클라이언트로 나가지 않고 공개 디렉터리에서 읽지도 않는다.
const DEFAULTS = Object.freeze({
  maxRooms: 64,
  maxConnections: 384,
  loopLagResolutionMs: 10,
  gameTickMs: 200,
  heartbeatMs: 2000,
  shutdownTimeoutMs: 5000,
  http: Object.freeze({ requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 }),
  socket: Object.freeze({
    maxHttpBufferSize: 8192,
    connectTimeout: 10000,
    pingInterval: 5000,
    pingTimeout: 5000,
  }),
});
const PORT_DEFAULT = 3211;
const PORT_MAX = 65535;
const RECOVERY_MIN_MS = 1000;
const RECOVERY_MAX_MS = 60000;

export interface RuntimeConfig {
  readonly maxRooms: number;
  readonly maxConnections: number;
  readonly loopLagResolutionMs: number;
  readonly gameTickMs: number;
  readonly heartbeatMs: number;
  readonly shutdownTimeoutMs: number;
  readonly http: { readonly requestTimeout: number; readonly headersTimeout: number; readonly keepAliveTimeout: number };
  readonly socket: {
    readonly maxHttpBufferSize: number;
    readonly connectTimeout: number;
    readonly pingInterval: number;
    readonly pingTimeout: number;
  };
  readonly port: number;
  readonly recoveryMs: number;
  readonly allowedOrigins: string;
}

/** 시작과 테스트가 함께 쓰는 순수 파싱. PORT 0 과 옛 recovery fallback 의미를 보존한다. */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const port = Number(env.PORT ?? PORT_DEFAULT);
  if (!Number.isInteger(port) || port < 0 || port > PORT_MAX) throw new Error('Invalid PORT');
  const recoveryMs = Math.max(
    RECOVERY_MIN_MS,
    Math.min(RECOVERY_MAX_MS, Number(env.GIMBAP_RECOVERY_MS) || DEFAULT_RECOVERY_MS),
  );
  return Object.freeze({
    ...DEFAULTS,
    port,
    recoveryMs,
    allowedOrigins: env.GIMBAP_ALLOWED_ORIGINS || '',
  });
}
