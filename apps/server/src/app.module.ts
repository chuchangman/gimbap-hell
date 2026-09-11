import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module.js';
import { runtimeConfig } from './config/runtime.registration.js';
import { HealthModule } from './health/health.module.js';
import { GameModule } from './modules/game/game.module.js';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [runtimeConfig],
    }),
    CommonModule,
    LeaderboardModule,
    GameModule,
    HealthModule,
  ],
})
export class AppModule {}
