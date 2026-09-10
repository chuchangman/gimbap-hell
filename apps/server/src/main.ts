import os from 'node:os';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PLAYER_LIMIT, ROOM_CODE_LENGTH, WAVES } from '@repo/game-core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { GameIoAdapter } from './common/adapters/game-io.adapter.js';
import { MetricsService } from './common/metrics.service.js';
import { createStaticMiddleware } from './common/static/static.middleware.js';
import type { RuntimeConfig } from './config/runtime.config.js';
import { GameGateway } from './modules/game/game.gateway.js';
import { LeaderboardService } from './modules/leaderboard/leaderboard.service.js';

function lanAddress(): string | null {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const runtime = app.get(ConfigService).getOrThrow<RuntimeConfig>('runtime');
  const metrics = app.get(MetricsService);
  const gateway = app.get(GameGateway);
  const leaderboard = app.get(LeaderboardService);

  /* 정적 서버를 Nest 라우터보다 먼저 건다. 보안 헤더를 모든 응답에 붙이고,
     컨트롤러가 맡는 /health · /ready · /leaderboard.json 만 통과시킨다.
     NestFactory.create 는 아직 라우터를 붙이지 않았으므로 여기가 앞이다. */
  app.use(createStaticMiddleware(runtime.publicRoot, metrics));

  app.useWebSocketAdapter(
    new GameIoAdapter(app, runtime, metrics, () => gateway.isStopping),
  );

  // 느린 클라이언트 하나가 이벤트 루프를 붙잡지 못하게 한다.
  Object.assign(app.getHttpServer(), runtime.http);

  /* 랭킹을 먼저 읽어 캐시에 올린다 — 첫 손님이 빈 랭킹을 보지 않도록 */
  const store = await leaderboard.init();

  app.enableShutdownHooks();
  await app.listen(runtime.port);

  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : runtime.port;
  const lan = lanAddress();
  console.log('');
  console.log(`  🍣 김밥지옥 — 웨이브 디펜스 (최대 ${PLAYER_LIMIT}인)`);
  console.log('  ─────────────────────────────────────────');
  console.log('  ➜ http://localhost:' + port);
  if (lan) console.log('  📡 팀원에게: http://' + lan + ':' + port + '   (같은 Wi-Fi)');
  console.log('');
  console.log('  웨이브 ' + WAVES.length + '개');
  console.log('  🏆 가게 랭킹 ' + store.count + '건 기록됨 (' + store.where + ')');
  if (store.error) console.log('  ⚠  저장소 연결 실패 — 이번 판 기록이 남지 않습니다');
  console.log('  📂 정적 파일 ' + runtime.publicRoot);
  console.log(`  한 명이 [새 가게 열기] → 나머지는 방 코드 ${ROOM_CODE_LENGTH}글자로 입장`);
  console.log('');
  // 테스트 하네스가 이 신호를 기다린다 (레거시와 같은 형태).
  process.send?.({ type: 'ready', port });

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    gateway.markStopping();
    gateway.announceClosing();
    const deadline = setTimeout(() => process.exit(1), runtime.shutdownTimeoutMs);
    deadline.unref();
    const saved = await leaderboard.flush();
    await app.close();
    clearTimeout(deadline);
    if (!saved) console.error('[shutdown] ranking_flush_incomplete');
    process.exit(saved ? 0 : 1);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

await bootstrap();
