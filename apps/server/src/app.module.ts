import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { runtimeConfig } from './config/runtime.registration.js';
import { GameModule } from './modules/game/game.module.js';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [runtimeConfig],
    }),
    LeaderboardModule,
    GameModule,
  ],
})
export class AppModule {}
