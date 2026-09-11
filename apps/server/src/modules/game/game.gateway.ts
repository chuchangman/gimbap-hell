/* ────────────────────────────────────────────────────────────
   Socket.IO 멀티플레이 게이트웨이
     · 방 만들기 / 방 코드로 입장
     · 5Hz 로 방 상태(웨이브·손님·주방)를 뿌린다
     · NET.tickMs 마다 플레이어 위치를 뿌린다 (volatile)

   이벤트 이름과 페이로드는 레거시 server/index.mjs 와 한 글자도 다르면 안 된다.
   레거시 클라이언트가 그대로 붙어 돌아가는 것이 이 단계의 합격 기준이다.
   ──────────────────────────────────────────────────────────── */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { PLAYER_LIMIT, WAVES } from '@repo/game-core';
import type { ClientToServerEvents, ServerToClientEvents, ToastKind } from '@repo/types';
import type { Server, Socket } from 'socket.io';
import { MetricsService } from '../../common/metrics.service.js';
import { createEventLimiter, validEvent } from '../../common/protocol.js';
import type { RuntimeConfig } from '../../config/runtime.config.js';
import { nameError, type Room } from '../../domain/room.js';
import { RoomsService } from './rooms.service.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents> & { recovered?: boolean };

interface PendingRecovery {
  until: number;
  autoPaused: boolean;
}

@Injectable()
@WebSocketGateway()
export class GameGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server<ClientToServerEvents, ServerToClientEvents>;

  private readonly runtime: RuntimeConfig;
  /** socketId → roomCode */
  private readonly socketRoom = new Map<string, string>();
  private readonly pendingRecovery = new Map<string, PendingRecovery>();
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly rooms: RoomsService,
    private readonly metrics: MetricsService,
  ) {
    this.runtime = config.getOrThrow<RuntimeConfig>('runtime');
  }

  afterInit(): void {
    // 어댑터가 io 를 만든 뒤에야 server 가 채워진다. 지금은 확인만 한다.
  }

  markStopping(): void {
    this.stopping = true;
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  get recoveryPending(): number {
    return this.pendingRecovery.size;
  }

  get playerCount(): number {
    return this.server?.engine?.clientsCount ?? 0;
  }

  /* ──────────────── 브로드캐스트 ──────────────── */
  private pushState(room: Room): void {
    this.server.to(room.code).emit('state', room.publicState());
  }
  private pushKitchen(room: Room): void {
    this.server.to(room.code).emit('kitchen', room.kitchenState());
  }
  private toast(room: Room, msg: string, kind?: ToastKind): void {
    this.server.to(room.code).emit('toast', { msg, kind: kind || 'good' });
  }
  private pushPositions(room: Room): void {
    this.server.to(room.code).emit('positions', {
      t: room.paused ? room.pausedAt : Date.now(),
      list: room.positions(),
    });
  }
  /** 위치는 50ms 뒤 새 값이 덮으므로 밀린 옛 좌표는 버린다 (volatile) */
  pushVolatilePositions(room: Room): void {
    this.server.to(room.code).volatile.emit('positions', { t: Date.now(), list: room.positions() });
  }

  private roomOf(socket: GameSocket): Room | undefined {
    const code = this.socketRoom.get(socket.id);
    return code ? this.rooms.get(code) : undefined;
  }

  private acknowledge(cb: unknown, value: unknown): void {
    if (typeof cb === 'function') (cb as (v: unknown) => void)(value);
  }

  private removeMembership(id: string): void {
    const code = this.socketRoom.get(id);
    this.socketRoom.delete(id);
    this.pendingRecovery.delete(id);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room || !code) return;
    const wasHost = room.isHost(id);
    room.removePlayer(id);
    if (!room.size) {
      this.rooms.delete(code);
      this.lastSig.delete(code);
      this.lastSent.delete(code);
    } else {
      if (wasHost)
        this.toast(room, '방장이 나갔습니다. 다음 참가자가 방장을 이어받았습니다.', 'warn');
      this.pushState(room);
      this.pushKitchen(room);
      this.pushPositions(room);
    }
  }

  /* 방마다 마지막으로 보낸 상태 서명 — 안 바뀌었으면 다시 안 보낸다 */
  private readonly lastSig = new Map<string, string>();
  private readonly lastSent = new Map<string, number>();

  /* ──────────────── 연결 ──────────────── */
  handleConnection(socket: GameSocket): void {
    const previous = this.pendingRecovery.get(socket.id);
    const recoveredRoom = this.roomOf(socket);
    const restored = !!(
      socket.recovered &&
      previous &&
      recoveredRoom?.players.has(socket.id) &&
      previous.until > Date.now()
    );
    if (socket.recovered && !restored) {
      // 어댑터가 방금 만료된 세션을 아직 들고 있을 수 있다. 옛 방 구독을 남기지 않는다.
      // join/leave 는 기본 인메모리 어댑터에서 동기다. 커스텀 어댑터에서만
      // Promise 를 돌려주므로 void 로 의도를 표시한다 (레거시도 무시했다).
      for (const code of socket.rooms) if (code !== socket.id) void socket.leave(code);
      this.removeMembership(socket.id);
    }
    /* restored 는 두 값의 존재를 이미 함축하지만, 조건식이 옵셔널 체이닝을
       쓰기 때문에 TS 가 recoveredRoom 을 좁혀 주지 못한다. 단정(!) 대신
       조건을 명시한다 — 런타임 비용은 없고 타입과 린트가 둘 다 조용해진다. */
    if (restored && previous && recoveredRoom) {
      this.pendingRecovery.delete(socket.id);
      const player = recoveredRoom.players.get(socket.id)!;
      player.connected = true;
      player.motion.at = performance.now();
      player.motion.airAt = null;
      if (previous.autoPaused && recoveredRoom.isHost(socket.id) && recoveredRoom.paused)
        recoveredRoom.togglePause(socket.id);
      this.metrics.count('recovered');
    }
    const player = restored ? recoveredRoom?.players.get(socket.id) : undefined;
    socket.emit('hello', {
      id: socket.id,
      waves: WAVES.length,
      restored,
      recoveryMs: this.runtime.recoveryMs,
      motionVersion: restored ? player!.motion.version : 0,
      pose: player ? { x: player.x, z: player.z, y: player.y, ry: player.ry } : null,
    });
    if (restored && recoveredRoom) {
      this.pushState(recoveredRoom);
      this.pushKitchen(recoveredRoom);
      this.pushPositions(recoveredRoom);
    }

    const permit = createEventLimiter();
    socket.use(([event, ...args]: [string, ...unknown[]], next) => {
      const cb = args.at(-1);
      const d = typeof args[0] === 'function' ? undefined : args[0];
      if (!permit(event)) {
        this.metrics.count('rateLimited');
        this.acknowledge(cb, {
          ok: false,
          err: '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }
      if (!validEvent(event, d)) {
        this.metrics.count('invalidEvents');
        this.acknowledge(cb, { ok: false, err: '입력 형식이 올바르지 않습니다.' });
        return;
      }
      next();
    });

    /* 리스너 이름을 handleDisconnect 로 두면 안 된다 — Nest 가 메서드 이름을
       덕타이핑으로 잡아 OnGatewayDisconnect 로 간주하고 자기 리스너를 하나 더
       붙인다. 그러면 한 번의 끊김에 핸들러가 두 번 돌고, 두 번째 호출이
       pendingRecovery 를 autoPaused=false 로 덮어써 복귀할 때 방장 일시정지가
       풀리지 않는다. 우리는 reason 이 필요하므로 직접 등록하고 이름을 피한다. */
    socket.on('disconnect', (reason: string) => this.onSocketDisconnect(socket, reason));
  }

  private onSocketDisconnect(socket: GameSocket, reason: string): void {
    const room = this.roomOf(socket);
    if (!room) return;
    if (!this.stopping && ['transport close', 'transport error', 'ping timeout'].includes(reason)) {
      const autoPaused = room.isHost(socket.id) && room.phase === 'playing' && !room.paused;
      if (autoPaused) room.togglePause(socket.id);
      room.players.get(socket.id)!.connected = false;
      this.pendingRecovery.set(socket.id, {
        until: Date.now() + this.runtime.recoveryMs,
        autoPaused,
      });
      this.toast(
        room,
        '참가자의 연결을 복구하고 있습니다.' + (autoPaused ? ' 방장 복귀까지 일시정지합니다.' : ''),
        'warn',
      );
      this.pushState(room);
      this.pushKitchen(room);
    } else this.removeMembership(socket.id);
  }

  /* ──────────────── 방 ──────────────── */
  @SubscribeMessage('room:create')
  onRoomCreate(socket: GameSocket, d: { name?: unknown; shop?: unknown }, cb?: unknown): void {
    const bad = nameError(d?.name);
    if (bad) return this.acknowledge(cb, { ok: false, err: bad });
    if (this.roomOf(socket))
      return this.acknowledge(cb, { ok: false, err: '이미 가게에 입장해 있습니다.' });
    const room = this.rooms.create(d?.shop);
    if (!room)
      return this.acknowledge(cb, { ok: false, err: '가게가 많아 잠시 후 다시 시도해 주세요.' });
    room.addPlayer(socket.id, d?.name, d && (d as { look?: never }).look);
    room.resolveShop(); // 이름을 안 정했으면 "방장닉의 가게"
    void socket.join(room.code);
    this.socketRoom.set(socket.id, room.code);
    this.acknowledge(cb, { ok: true, code: room.code, youId: socket.id });
    this.pushState(room);
    this.pushKitchen(room);
    this.pushPositions(room);
  }

  @SubscribeMessage('room:join')
  onRoomJoin(socket: GameSocket, d: { name?: unknown; code?: string }, cb?: unknown): void {
    const bad = nameError(d?.name);
    if (bad) return this.acknowledge(cb, { ok: false, err: bad });
    if (this.roomOf(socket))
      return this.acknowledge(cb, { ok: false, err: '이미 가게에 입장해 있습니다.' });
    const room = this.rooms.find(d?.code ?? '');
    if (!room) return this.acknowledge(cb, { ok: false, err: '그런 방이 없습니다.' });
    if (this.rooms.isFull(room))
      return this.acknowledge(cb, {
        ok: false,
        err: `방이 가득 찼습니다. (최대 ${PLAYER_LIMIT}명)`,
      });
    room.addPlayer(socket.id, d?.name, d && (d as { look?: never }).look);
    void socket.join(room.code);
    this.socketRoom.set(socket.id, room.code);
    this.acknowledge(cb, { ok: true, code: room.code, youId: socket.id });
    this.pushState(room);
    this.pushKitchen(room);
    this.pushPositions(room);
  }

  @SubscribeMessage('room:leave')
  onRoomLeave(socket: GameSocket, d: unknown, cb?: unknown): void {
    const code = this.socketRoom.get(socket.id);
    if (code) void socket.leave(code);
    this.removeMembership(socket.id);
    this.acknowledge(typeof d === 'function' ? d : cb, { ok: true });
  }

  /* ──────────────── 게임 ──────────────── */
  @SubscribeMessage('game:start')
  onGameStart(socket: GameSocket): void {
    const room = this.roomOf(socket);
    if (!room || !room.isHost(socket.id)) return;
    if (!room.start()) return;
    this.pushPositions(room);
    this.pushState(room);
    this.pushKitchen(room);
    this.toast(room, '영업 시작! 첫 손님이 오기 전에 밥부터 안치세요.', 'good');
  }

  @SubscribeMessage('game:pause')
  onGamePause(socket: GameSocket): void {
    const room = this.roomOf(socket);
    if (!room) return;
    const changed = room.togglePause(socket.id);
    if (!changed) return;
    this.pushState(room);
    this.pushKitchen(room);
    this.toast(
      room,
      changed.paused ? '⏸ 방장이 게임을 일시정지했습니다.' : '▶ 게임을 재개했습니다.',
      changed.paused ? 'warn' : 'good',
    );
  }

  @SubscribeMessage('game:lobby')
  onGameLobby(socket: GameSocket): void {
    const room = this.roomOf(socket);
    if (!room || !room.isHost(socket.id)) return;
    if (room.phase !== 'result') return;
    room.toLobby();
    this.pushState(room);
  }

  @SubscribeMessage('kitchen:act')
  onKitchenAct(socket: GameSocket, d: { action?: string; payload?: never }): void {
    const room = this.roomOf(socket);
    if (!room || !d) return;
    const r = room.act(socket.id, d.action!, d.payload);
    if (r?.rejected) this.metrics.count('rejectedDistance');
    if (r && r.msg) {
      if (r.broadcast) this.toast(room, r.msg, r.kind);
      else socket.emit('toast', { msg: r.msg, kind: r.kind ?? 'good' });
    }
    if (r?.ok) this.pushKitchen(room);
    if (r && r.broadcast) this.pushState(room);
  }

  @SubscribeMessage('player:move')
  onPlayerMove(socket: GameSocket, d: never): void {
    const room = this.roomOf(socket);
    const result = room?.move(socket.id, d);
    if (result?.pose) {
      this.metrics.count('rejectedMovement');
      socket.emit('position:correct', result.pose);
    }
  }

  @SubscribeMessage('player:swing')
  onPlayerSwing(
    socket: GameSocket,
    d?: { targetId?: string | null; targetKind?: string | null } | null,
  ): void {
    const room = this.roomOf(socket);
    if (!room) return;
    const out = room.swing(socket.id, d?.targetId, d?.targetKind);
    if (!out) return;
    this.server.to(room.code).emit('swing', out.swing);
    if (out.hit) {
      this.server.to(room.code).emit('hit', out.hit);
      this.pushKitchen(room);
    }
    if (out.customerHit) {
      if (out.customerHit.msg) this.toast(room, out.customerHit.msg, 'warn');
      this.pushState(room);
    }
  }

  /* ──────────────── 틱 ──────────────── */
  /** GameLoopService 가 gameTickMs 마다 부른다 */
  runGameTick(): void {
    const t = Date.now();
    for (const [id, pending] of this.pendingRecovery) {
      if (t >= pending.until) {
        this.metrics.count('expired');
        this.removeMembership(id);
      }
    }
    for (const room of this.rooms.values()) {
      const events = room.tick();
      for (const e of events) {
        switch (e.type) {
          case 'toast':
            this.toast(room, e.msg, e.kind);
            break;
          case 'waveStart':
            this.toast(
              room,
              '🌊 웨이브 ' +
                e.wave +
                '/' +
                e.total +
                ' — 주문 ' +
                e.count +
                '건' +
                (e.specials ? ' (카운터 손님 ' + e.specials + '명)' : '') +
                ' · 김밥 ' +
                e.rolls +
                '줄 · 인내심 ' +
                e.patience +
                '초',
              'warn',
            );
            if (e.unlockedName) {
              this.toast(
                room,
                '🔓 새 재료 해금 — ' + e.unlockedName + ' 이(가) 냉장고에 들어왔습니다!',
                'good',
              );
            }
            break;
          case 'waveClear':
            // 토스트 대신 화면 중앙 상단에 크게 띄운다
            this.server.to(room.code).emit('waveEnd', {
              wave: e.wave,
              happy: e.happy,
              angry: e.angry,
              victory: e.victory,
            });
            break;
          case 'leave':
            this.toast(room, e.msg, 'bad');
            break;
          case 'gameOver':
            this.toast(
              room,
              e.result === 'victory' ? '🎉 10웨이브 완주!' : '💀 평판이 바닥났습니다...',
              e.result === 'victory' ? 'good' : 'bad',
            );
            break;
        }
      }
      if (events.length) this.pushKitchen(room);

      // 바뀐 게 없으면 상태 브로드캐스트를 건너뛴다
      const sig = room.stateSignature();
      const stale = t - (this.lastSent.get(room.code) || 0) >= this.runtime.heartbeatMs;
      if (sig !== this.lastSig.get(room.code) || stale) {
        this.lastSig.set(room.code, sig);
        this.lastSent.set(room.code, t);
        this.pushState(room);
      }
    }
  }

  /** 종료 안내를 모두에게 보낸다 */
  announceClosing(): void {
    this.server?.emit('server:closing', {
      msg: '서버 점검으로 연결을 종료합니다. 잠시 후 다시 입장해 주세요.',
    });
  }
}
