import { Module } from '@nestjs/common';
import { GameModule } from '../modules/game/game.module.js';
import { LeaderboardModule } from '../modules/leaderboard/leaderboard.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [LeaderboardModule, GameModule],
  controllers: [HealthController],
})
export class HealthModule {}
