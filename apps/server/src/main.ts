import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import { LeaderboardService } from './modules/leaderboard/leaderboard.service.js';
import type { RuntimeConfig } from './config/runtime.config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const runtime = app.get(ConfigService).getOrThrow<RuntimeConfig>('runtime');

  // 느린 클라이언트 하나가 이벤트 루프를 붙잡지 못하게 한다.
  const server = app.getHttpServer() as Server;
  Object.assign(server, runtime.http);

  app.enableShutdownHooks();
  await app.listen(runtime.port);

  /* 랭킹이 어디에 저장되는지 반드시 찍는다. 레거시는 모듈 위치를 기준으로
     저장소 루트의 data/ 를 썼고 여기는 cwd 기준이다 — 다른 데서 띄우면
     조용히 다른 파일에 쌓이므로, 눈에 보이게 남긴다. */
  const leaderboard = app.get(LeaderboardService);
  const store = await leaderboard.init();
  console.log('  🏆 가게 랭킹 ' + store.count + '건 (' + store.where + ')');
  if (store.error) console.log('  ⚠  저장소 연결 실패 — 이번 판 기록이 남지 않습니다');
}

await bootstrap();
