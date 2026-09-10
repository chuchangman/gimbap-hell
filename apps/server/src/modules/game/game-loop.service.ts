import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NET } from '@repo/game-core';
import type { RuntimeConfig } from '../../config/runtime.config.js';
import { GameGateway } from './game.gateway.js';
import { RoomsService } from './rooms.service.js';

/**
 * 두 개의 타이머가 방을 굴린다.
 *   · gameTickMs (200ms) — 웨이브·주방 진행과 상태 브로드캐스트
 *   · NET.tickMs (67ms) — 위치 브로드캐스트. 클라이언트가 이 t 를 기준으로 보간한다.
 *
 * 위치는 volatile 로 보낸다: 소켓 버퍼가 밀려 있으면 큐에 쌓지 말고 버리라는 뜻이다.
 * 50ms 뒤 새 값이 덮으므로 밀린 옛 좌표는 가치가 없고, 오히려 느린 클라이언트
 * 하나가 서버 메모리와 이벤트 루프를 붙잡는 걸 막는다. 토스트·상태·웨이브
 * 종료처럼 한 번 놓치면 복구가 안 되는 것들은 그대로 신뢰성 있게 보낸다.
 */
@Injectable()
export class GameLoopService implements OnModuleInit, OnApplicationShutdown {
  private readonly runtime: RuntimeConfig;
  private gameTimer?: NodeJS.Timeout;
  private positionsTimer?: NodeJS.Timeout;

  constructor(
    config: ConfigService,
    private readonly gateway: GameGateway,
    private readonly rooms: RoomsService,
  ) {
    this.runtime = config.getOrThrow<RuntimeConfig>('runtime');
  }

  onModuleInit(): void {
    this.gameTimer = setInterval(() => this.gateway.runGameTick(), this.runtime.gameTickMs);
    this.positionsTimer = setInterval(() => {
      for (const room of this.rooms.values()) {
        if (room.phase === 'playing' && !room.paused) this.gateway.pushVolatilePositions(room);
      }
    }, NET.tickMs);
  }

  onApplicationShutdown(): void {
    if (this.gameTimer) clearInterval(this.gameTimer);
    if (this.positionsTimer) clearInterval(this.positionsTimer);
  }
}
