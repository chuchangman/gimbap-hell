import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PLAYER_LIMIT, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@repo/game-core';
import type { RuntimeConfig } from '../../config/runtime.config.js';
import { Room } from '../../domain/room.js';
import { LeaderboardService } from '../leaderboard/leaderboard.service.js';

/** 방 목록을 들고 있는 유일한 싱글턴. Room 자체는 방마다 하나씩 만드는 순수 클래스다. */
@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, Room>();
  private readonly runtime: RuntimeConfig;

  constructor(
    config: ConfigService,
    private readonly leaderboard: LeaderboardService,
  ) {
    this.runtime = config.getOrThrow<RuntimeConfig>('runtime');
  }

  get size(): number {
    return this.rooms.size;
  }

  values(): IterableIterator<Room> {
    return this.rooms.values();
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** 이미 쓰는 코드는 다시 뽑는다 */
  makeCode(): string {
    let code: string;
    do {
      code = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  /** 수용량을 넘으면 null — 호출한 쪽이 사람이 읽을 메시지를 만든다 */
  create(shopName: unknown): Room | null {
    if (this.rooms.size >= this.runtime.maxRooms) return null;
    const code = this.makeCode();
    const room = new Room(code, shopName, this.leaderboard);
    this.rooms.set(code, room);
    return room;
  }

  /** 방 코드는 대소문자를 가리지 않는다.
   *  문자열이라는 보장은 게이트웨이의 validEvent('room:join') 이 먼저 한다. */
  find(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase().trim());
  }

  isFull(room: Room): boolean {
    return room.size >= PLAYER_LIMIT;
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }
}
