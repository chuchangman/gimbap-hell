import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LeaderboardRow, PublicBoard, StorageStatus } from '@repo/types';
import { randomUUID } from 'node:crypto';
import type { RuntimeConfig } from '../../config/runtime.config.js';
import { buildEntry, cleanShopName, maskRow, type RunResult } from './leaderboard.util.js';
import { RANKING_POLICY } from './ranking-policy.js';
import { createRankingStore, type RankingStore } from './ranking-store.js';

/** 저장소 주입 토큰. 인터페이스는 런타임에 없으므로 Nest 가 타입만으로는
 *  못 찾는다. { provide: RANKING_STORE, useValue: … } 로 갈아끼울 수 있다. */
export const RANKING_STORE = Symbol('RANKING_STORE');

/** 원자적 파일 쓰기나 재시도하는 Redis 큐가 뒤를 받치는 동기 랭킹 뷰.
 *  결과 화면은 즉시 그려지고, 저장이 따라잡았는지는 /health 가 알려준다. */
@Injectable()
export class LeaderboardService implements OnModuleInit, OnApplicationShutdown {
  private readonly store: RankingStore<LeaderboardRow>;

  constructor(
    config: ConfigService,
    @Optional() @Inject(RANKING_STORE) store?: RankingStore<LeaderboardRow>,
  ) {
    const runtime = config.getOrThrow<RuntimeConfig>('runtime');
    this.store =
      store ??
      createRankingStore<LeaderboardRow>({
        file: runtime.leaderboardFile,
        redisUrl: runtime.redis.url,
        redisToken: runtime.redis.token,
        redisKey: runtime.redis.key,
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

  /** 가게 이름 정리. Room 이 방을 만들 때 쓴다 — 레거시 모듈과 같은 표면이다. */
  cleanShopName(name: unknown, fallback?: string): string {
    return cleanShopName(name, fallback);
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
