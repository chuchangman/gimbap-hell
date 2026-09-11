import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import type { RuntimeConfig } from './config/runtime.config.js';

describe('AppModule', () => {
  it('뜨고, 운영 설정을 주입한다', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const runtime = moduleRef.get(ConfigService).getOrThrow<RuntimeConfig>('runtime');
    expect(runtime.gameTickMs).toBe(200);
    expect(runtime.maxRooms).toBe(64);
    await moduleRef.close();
  });
});
