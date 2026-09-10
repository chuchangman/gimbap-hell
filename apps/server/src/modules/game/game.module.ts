import { Module } from '@nestjs/common';
import { LeaderboardModule } from '../leaderboard/leaderboard.module.js';
import { CommonModule } from '../../common/common.module.js';
import { GameGateway } from './game.gateway.js';
import { GameLoopService } from './game-loop.service.js';
import { RoomsService } from './rooms.service.js';

@Module({
  imports: [LeaderboardModule, CommonModule],
  providers: [RoomsService, GameGateway, GameLoopService],
  exports: [RoomsService, GameGateway],
})
export class GameModule {}
