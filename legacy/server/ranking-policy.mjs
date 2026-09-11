// Shared by local merge, Redis Lua, storage retries, and ranking presentation.
export const RANKING_POLICY = Object.freeze({
  maxEntries: 200,
  redisKey: 'gimbap:leaderboard',
  timeoutMs: 3000,
  retryMs: 1000,
  maxRetryMs: 30000,
  maxRetryExponent: 5,
  topCount: 10,
  publicApiCount: 50
});

export function rankingRetryDelay(retryMs, consecutiveFailures) {
  return Math.min(RANKING_POLICY.maxRetryMs,
    retryMs * 2 ** Math.min(RANKING_POLICY.maxRetryExponent, consecutiveFailures));
}
