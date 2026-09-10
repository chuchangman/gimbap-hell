import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import type { RuntimeConfig } from '../../config/runtime.config.js';
import { MetricsService } from '../metrics.service.js';
import { allowedOrigin } from '../protocol.js';

/**
 * 게이트웨이 데코레이터는 정적이라 설정값을 읽지 못한다.
 * 오리진 검사 · 연결 복구 · 수용량 제한을 여기서 건다.
 *
 * 레거시 server/index.mjs 의 io 옵션을 그대로 옮긴 것이다. 경로는 기본값
 * (/socket.io) 을 유지한다 — 레거시 클라이언트가 그 경로로 붙는다.
 */
export class GameIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly runtime: RuntimeConfig,
    private readonly metrics: MetricsService,
    /** 종료 중이면 새 연결을 받지 않는다 */
    private readonly isStopping: () => boolean,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      ...this.runtime.socket,
      connectionStateRecovery: {
        maxDisconnectionDuration: this.runtime.recoveryMs,
        skipMiddlewares: false,
      },
      allowRequest: (req, cb) => {
        const originOk = allowedOrigin(req, this.runtime.allowedOrigins);
        if (!originOk) this.metrics.count('rejectedOrigins');
        cb(
          null,
          originOk && !this.isStopping() && server.engine.clientsCount < this.runtime.maxConnections,
        );
      },
    } as ServerOptions);
    return server;
  }
}
