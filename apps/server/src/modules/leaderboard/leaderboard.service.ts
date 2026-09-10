import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { LeaderboardRow, PublicBoard, StorageStatus } from '@repo/types';
import { RANKING_POLICY } from './ranking-policy.js';
import { createRankingStore, type RankingStore } from './ranking-store.js';
import { buildEntry, maskRow, type RunResult } from './leaderboard.util.js';

/** 원자적 파일 쓰기나 재시도하는 Redis 큐가 뒤를 받치는 동기 랭킹 뷰.
 *  결과 화면은 즉시 그려지고, 저장이 따라잡았는지는 /health 가 알려준다. */
@Injectable()
export class LeaderboardService implements OnModuleInit, OnApplicationShutdown {
  private readonly store: RankingStore<LeaderboardRow>;

  constructor(store?: RankingStore<LeaderboardRow>) {
    this.store =
      store ??
      createRankingStore<LeaderboardRow>({
        file:
          process.env.GIMBAP_LEADERBOARD ||
          path.join(process.cwd(), 'data', 'leaderboard.json'),
        redisUrl: (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''),
        redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
        redisKey: process.env.GIMBAP_LEADERBOARD_KEY || RANKING_POLICY.redisKey,
        // 로그에 URL · 토큰 · 파일명 · 플레이어 이름을 남기지 않는다.
        onError: (code) => console.error('[leaderboard]', code),
      });
  }

  /** 첫 손님이 빈 랭킹을 보지 않도록 미리 읽어 캐시에 올린다 */
  async onModuleInit(): Promise<void> {
    await this.store.init();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.store.flush();
    this.store.close();
  }

  init(): ReturnType<RankingStore['init']> {
    return this.store.init();
  }

  status(): StorageStatus {
    return this.store.health();
  }

  flush(): Promise<boolean> {
    return this.store.flush();
  }

  close(): void {
    this.store.close();
  }

  /** 서버가 판정한 완료된 판 하나를 올린다. 재시도는 같은 UUID 를 재사용한다. */
  add(result: RunResult): { rank: number | null; total: number; entry: LeaderboardRow } {
    const entry = buildEntry(result, randomUUID(), new Date().toISOString());
    this.store.add(entry);
    const list = this.store.read();
    const rank = list.findIndex((r) => r.id === entry.id) + 1;
    return { rank: rank || null, total: list.length, entry };
  }

  top(n: number = RANKING_POLICY.topCount): LeaderboardRow[] {
    return this.store.read().slice(0, n);
  }

  size(): number {
    return this.store.read().length;
  }

  publicTop(n?: number): LeaderboardRow[] {
    return this.top(n).map(maskRow);
  }

  board(highlightId?: string, n: number = RANKING_POLICY.topCount): PublicBoard {
    const list = this.store.read();
    const head = list.slice(0, n);
    const mine = list.find((r) => r.id === highlightId);
    return {
      top: head,
      myRank: mine ? list.findIndex((r) => r.id === highlightId) + 1 : null,
      total: list.length,
      outside: mine && !head.some((r) => r.id === highlightId) ? mine : null,
    };
  }

  publicBoard(highlightId?: string, n?: number): PublicBoard {
    const b = this.board(highlightId, n);
    return { ...b, top: b.top.map(maskRow), outside: b.outside ? maskRow(b.outside) : null };
  }
}
