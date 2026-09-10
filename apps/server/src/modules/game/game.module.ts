import { Module } from '@nestjs/common';
import { LeaderboardModule } from '../leaderboard/leaderboard.module.js';
import { RoomsService } from './rooms.service.js';

@Module({
  imports: [LeaderboardModule],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class GameModule {}
