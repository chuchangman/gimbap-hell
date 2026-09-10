import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { Controller, Get, Res, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthResponse, LeaderboardResponse, ReadyResponse } from '@repo/types';
import type { Response } from 'express';
import type { RuntimeConfig } from '../config/runtime.config.js';
import { RANKING_POLICY } from '../modules/leaderboard/ranking-policy.js';
import { LeaderboardService } from '../modules/leaderboard/leaderboard.service.js';
import { GameGateway } from '../modules/game/game.gateway.js';
import { RoomsService } from '../modules/game/rooms.service.js';
import { MetricsService } from '../common/metrics.service.js';

/* 응답 형태는 레거시 server/index.mjs 와 같아야 한다 — 운영이 밖에서 긁어 간다.
   /health · /ready · /leaderboard.json 모두 캐시하지 않는다. */
@Controller()
export class HealthController implements OnApplicationShutdown {
  /** 이벤트 루프가 밀리는지 재둔다. CPU 가 모자라면 여기부터 티가 난다. */
  private readonly loopLag: IntervalHistogram;

  constructor(
    config: ConfigService,
    private readonly leaderboard: LeaderboardService,
    private readonly rooms: RoomsService,
    private readonly gateway: GameGateway,
    private readonly metrics: MetricsService,
  ) {
    const runtime = config.getOrThrow<RuntimeConfig>('runtime');
    this.loopLag = monitorEventLoopDelay({ resolution: runtime.loopLagResolutionMs });
    this.loopLag.enable();
  }

  onApplicationShutdown(): void {
    this.loopLag.disable();
  }

  private noStore(res: Response): void {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }

  @Get('health')
  health(@Res() res: Response): void {
    const storage = this.leaderboard.status();
    const body: HealthResponse = {
      ok: storage.ready && !this.gateway.isStopping,
      uptimeSec: Math.round(process.uptime()),
      rooms: this.rooms.size,
      players: this.gateway.playerCount,
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      lagP99ms: Math.round(this.loopLag.percentile(99) / 1e5) / 10, // 이벤트 루프 지연
      store: storage.mode, // 'file' | 'redis' — 어느 저장소를 쓰는지
      entries: this.leaderboard.size(),
      storeError: storage.error || undefined,
      storage,
      recoveryPending: this.gateway.recoveryPending,
      rejected: this.metrics.snapshot(),
    };
    this.noStore(res);
    res.status(200).send(JSON.stringify(body));
  }

  @Get('ready')
  ready(@Res() res: Response): void {
    const ok = !this.gateway.isStopping && this.leaderboard.status().ready;
    const body: ReadyResponse = { ready: ok };
    this.noStore(res);
    res.status(ok ? 200 : 503).send(JSON.stringify(body));
  }

  @Get('leaderboard.json')
  board(@Res() res: Response): void {
    const body: LeaderboardResponse = this.leaderboard.publicTop(RANKING_POLICY.publicApiCount);
    this.noStore(res);
    res.status(200).send(JSON.stringify(body));
  }
}
