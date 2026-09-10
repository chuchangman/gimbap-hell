import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import type { RuntimeConfig } from './config/runtime.config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const runtime = app.get(ConfigService).getOrThrow<RuntimeConfig>('runtime');

  // 느린 클라이언트 하나가 이벤트 루프를 붙잡지 못하게 한다.
  const server = app.getHttpServer() as Server;
  Object.assign(server, runtime.http);

  app.enableShutdownHooks();
  await app.listen(runtime.port);
}

await bootstrap();
