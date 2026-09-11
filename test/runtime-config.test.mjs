import { test } from 'node:test';
import assert from 'node:assert/strict';

test('runtime config preserves PORT conversion including zero, empty string, and invalid bounds', async () => {
  const { loadRuntimeConfig } = await import('../legacy/server/runtime-config.mjs');
  for (const [env, expected] of [[{}, 3211], [{ PORT: '0' }, 0], [{ PORT: '' }, 0],
    [{ PORT: '65535' }, 65535], [{ PORT: '  4321 ' }, 4321], [{ PORT: '0xC8' }, 200]])
    assert.equal(loadRuntimeConfig(env).port, expected);
  for (const port of ['-1', '65536', '1.5', 'NaN', 'abc', 'Infinity'])
    assert.throws(() => loadRuntimeConfig({ PORT: port }), { message: 'Invalid PORT' });
});

test('recovery config preserves Number-or-default followed by one to sixty second clamp', async () => {
  const { loadRuntimeConfig } = await import('../legacy/server/runtime-config.mjs');
  for (const [value, expected] of [[undefined, 30000], ['', 30000], ['0', 30000], ['NaN', 30000],
    ['-1', 1000], ['100', 1000], ['1500.5', 1500.5], ['45000', 45000], ['99999', 60000],
    ['Infinity', 60000], ['-Infinity', 1000]])
    assert.equal(loadRuntimeConfig({ GIMBAP_RECOVERY_MS: value }).recoveryMs, expected, String(value));
});

test('server operational defaults remain unchanged and injected environment does not mutate', async () => {
  const { loadRuntimeConfig } = await import('../legacy/server/runtime-config.mjs');
  const env = Object.freeze({ PORT: '0', GIMBAP_ALLOWED_ORIGINS: 'https://example.invalid' });
  const config = loadRuntimeConfig(env);
  assert.equal(config.maxRooms, 64);
  assert.equal(config.maxConnections, 384);
  assert.equal(config.loopLagResolutionMs, 10);
  assert.equal(config.gameTickMs, 200);
  assert.equal(config.heartbeatMs, 2000);
  assert.equal(config.shutdownTimeoutMs, 5000);
  assert.equal(config.allowedOrigins, 'https://example.invalid');
  assert.deepEqual(config.http, { requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 });
  assert.deepEqual(config.socket, { maxHttpBufferSize: 8192, connectTimeout: 10000, pingInterval: 5000, pingTimeout: 5000 });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.http));
  assert.ok(Object.isFrozen(config.socket));
});

test('ranking policy keeps capped exponential retry semantics and the same JS and Redis limit', async () => {
  const { RANKING_POLICY, rankingRetryDelay } = await import('../legacy/server/ranking-policy.mjs');
  const { mergeRankings, MERGE_RANKINGS_LUA } = await import('../legacy/server/ranking-store.mjs');
  assert.equal(RANKING_POLICY.maxEntries, 200);
  assert.equal(RANKING_POLICY.timeoutMs, 3000);
  assert.equal(RANKING_POLICY.retryMs, 1000);
  assert.equal(RANKING_POLICY.redisKey, 'gimbap:leaderboard');
  assert.equal(RANKING_POLICY.topCount, 10);
  assert.equal(RANKING_POLICY.publicApiCount, 50);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => rankingRetryDelay(1000, i)),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(rankingRetryDelay(10, 100), 320);
  assert.equal(rankingRetryDelay(100000, 0), 30000);
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: String(i), shop: '가게', score: i }));
  assert.equal(mergeRankings(rows).length, RANKING_POLICY.maxEntries);
  assert.ok(MERGE_RANKINGS_LUA.includes(`while #merged > ${RANKING_POLICY.maxEntries} do table.remove(merged) end`));
});
