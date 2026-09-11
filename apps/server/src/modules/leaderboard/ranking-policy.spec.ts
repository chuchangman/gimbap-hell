import { describe, expect, it } from 'vitest';
import { loadLegacy } from '../../testing/legacy.js';
import { RANKING_POLICY, rankingRetryDelay } from './ranking-policy.js';

const legacy = await loadLegacy('ranking-policy.mjs');

describe('랭킹 저장 정책', () => {
  it('정책 값이 레거시와 같다', () => {
    expect(RANKING_POLICY).toEqual(legacy.RANKING_POLICY);
  });

  it('재시도 지연이 상한까지 지수적으로 늘고 레거시와 같다', () => {
    expect(Array.from({ length: 8 }, (_, i) => rankingRetryDelay(1000, i))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    for (const retryMs of [10, 100, 1000, 100000]) {
      for (let i = 0; i <= 100; i++) {
        expect(rankingRetryDelay(retryMs, i), retryMs + '#' + i).toBe(
          legacy.rankingRetryDelay(retryMs, i),
        );
      }
    }
  });
});
