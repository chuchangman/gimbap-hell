/* HTTP 엔드포인트 응답. /health 는 운영이 밖에서 긁어 간다. */
import type { LeaderboardRow, StorageStatus } from './snapshot.js';

export interface HealthResponse {
  ok: boolean;
  uptimeSec: number;
  rooms: number;
  players: number;
  rssMB: number;
  /** 이벤트 루프 지연 p99 (ms) — 숫자가 커지면 응답이 늦다는 뜻 */
  lagP99ms: number;
  store: 'file' | 'redis';
  entries: number;
  storeError?: string;
  storage: StorageStatus;
  recoveryPending: number;
  rejected: Record<string, number>;
}

export interface ReadyResponse {
  ready: boolean;
}

export type LeaderboardResponse = LeaderboardRow[];
