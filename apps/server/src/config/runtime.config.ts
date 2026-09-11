import path from 'node:path';
import { DEFAULT_RECOVERY_MS } from '@repo/game-core';
import { RANKING_POLICY } from '../modules/leaderboard/ranking-policy.js';

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
  /** 랭킹 저장 위치. 레거시는 모듈 위치 기준(= 저장소 루트/data)이라 cwd 와
   *  무관했지만, 여기는 cwd 기준이다. 서버를 저장소 루트에서 띄우면 같은
   *  파일이고, 다른 데서 띄우면 다른 파일이 된다 —
   *  그래서 시작 로그에 실제 경로를 찍는다. GIMBAP_LEADERBOARD 로 고정할 수 있다. */
  readonly leaderboardFile: string;
  /** 정적 파일 루트. 기본값은 Vite 빌드 산출물이다 — `npm run build` 를
   *  먼저 돌려야 한다. 레거시 화면을 띄워 보려면 GIMBAP_PUBLIC_ROOT=public.
   *  cwd 기준이라 저장소 루트에서 띄워야 맞는다. */
  readonly publicRoot: string;
  readonly redis: { readonly url: string; readonly token: string; readonly key: string };
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
    leaderboardFile:
      env.GIMBAP_LEADERBOARD || path.join(process.cwd(), 'data', 'leaderboard.json'),
    publicRoot: env.GIMBAP_PUBLIC_ROOT || path.join(process.cwd(), 'apps', 'client', 'dist'),
    redis: Object.freeze({
      url: (env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''),
      token: env.UPSTASH_REDIS_REST_TOKEN || '',
      key: env.GIMBAP_LEADERBOARD_KEY || RANKING_POLICY.redisKey,
    }),
  });
}
