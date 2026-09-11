// 로컬 병합 · Redis Lua · 저장 재시도 · 랭킹 표시가 이 정의 하나를 같이 쓴다.
export const RANKING_POLICY = Object.freeze({
  maxEntries: 200,
  redisKey: 'gimbap:leaderboard',
  timeoutMs: 3000,
  retryMs: 1000,
  maxRetryMs: 30000,
  maxRetryExponent: 5,
  topCount: 10,
  publicApiCount: 50,
});

export function rankingRetryDelay(retryMs: number, consecutiveFailures: number): number {
  return Math.min(
    RANKING_POLICY.maxRetryMs,
    retryMs * 2 ** Math.min(RANKING_POLICY.maxRetryExponent, consecutiveFailures),
  );
}
