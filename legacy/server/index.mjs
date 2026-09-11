/* ────────────────────────────────────────────────────────────
   정적 파일 서버 + Socket.IO 멀티플레이
     · 방 만들기 / 방 코드로 입장
     · 5Hz 로 방 상태(웨이브·손님·주방)를 뿌린다
     · NET.tickMs 마다 플레이어 위치를 뿌린다 (volatile)
   ──────────────────────────────────────────────────────────── */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomInt } from 'node:crypto';

import { Room, nameError } from './room.mjs';
import * as leaderboard from './leaderboard.mjs';
import { WAVES, NET } from '../public/js/config.js';
import { createHttpHandler } from './http.mjs';
import { validEvent, createEventLimiter, allowedOrigin } from './protocol.mjs';
import { PLAYER_LIMIT, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from '../public/js/game-rules.js';
import { loadRuntimeConfig } from './runtime-config.mjs';
import { RANKING_POLICY } from './ranking-policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'public');
const runtime = loadRuntimeConfig();
const RECOVERY_MS = runtime.recoveryMs;
const metrics = { invalidHttp:0, httpErrors:0, invalidEvents:0, rateLimited:0, rejectedOrigins:0, recovered:0, expired:0 };
const count = key => { metrics[key] = (metrics[key] || 0) + 1; };
let stopping = false;

/* 이벤트 루프가 밀리는지 재둔다 — /health 로 밖에서 확인한다.
   CPU 가 모자라면 여기부터 티가 난다 (숫자가 커지면 응답이 늦다는 뜻). */
const loopLag = monitorEventLoopDelay({ resolution: runtime.loopLagResolutionMs });
loopLag.enable();

const server = http.createServer(createHttpHandler({
  root: ROOT, count,
  health: () => ({
      ok: leaderboard.status().ready && !stopping,
      uptimeSec: Math.round(process.uptime()),
      rooms: rooms.size,
      players: io.engine.clientsCount,
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      lagP99ms: Math.round(loopLag.percentile(99) / 1e5) / 10,   // 이벤트 루프 지연
      store: store.mode,              // 'file' | 'redis' — 어느 저장소를 쓰는지
      entries: leaderboard.size(),
      storeError: leaderboard.status().error || undefined,
      storage: leaderboard.status(),
      recoveryPending: pendingRecovery.size,
      rejected: metrics
    }),
  ready: () => !stopping && leaderboard.status().ready,
  board: () => leaderboard.publicTop(RANKING_POLICY.publicApiCount)
}));
Object.assign(server, runtime.http);
const io = new Server(server, {
  ...runtime.socket,
  connectionStateRecovery: { maxDisconnectionDuration: RECOVERY_MS, skipMiddlewares: false },
  allowRequest: (req, cb) => {
    const originOk = allowedOrigin(req, runtime.allowedOrigins);
    if (!originOk) count('rejectedOrigins');
    cb(null, originOk && !stopping && io.engine.clientsCount < runtime.maxConnections);
  }
});

/** @type {Map<string, Room>} */
const rooms = new Map();
const socketRoom = new Map();   // socketId → roomCode
const pendingRecovery = new Map(); // socketId -> { until, autoPaused }
const lastSig = new Map();
const lastSent = new Map();

function makeCode() {
  const letters = ROOM_CODE_ALPHABET;
  let code;
  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () => letters[randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const roomOf = (socket) => rooms.get(socketRoom.get(socket.id));
const pushState = (room) => io.to(room.code).emit('state', room.publicState());
const pushKitchen = (room) => io.to(room.code).emit('kitchen', room.kitchenState());
const toast = (room, msg, kind) => io.to(room.code).emit('toast', { msg, kind: kind || 'good' });
const pushPositions = room => io.to(room.code).emit('positions', { t: room.paused ? room.pausedAt : Date.now(), list:room.positions() });
const acknowledge = (cb, value) => { if (typeof cb === 'function') cb(value); };

function removeMembership(id) {
  const code = socketRoom.get(id);
  socketRoom.delete(id);
  pendingRecovery.delete(id);
  const room = rooms.get(code);
  if (!room) return;
  const wasHost = room.isHost(id);
  room.removePlayer(id);
  if (!room.size) {
    rooms.delete(code); lastSig.delete(code); lastSent.delete(code);
  } else {
    if (wasHost) toast(room, '방장이 나갔습니다. 다음 참가자가 방장을 이어받았습니다.', 'warn');
    pushState(room); pushKitchen(room); pushPositions(room);
  }
}

/* ──────────────── 소켓 ──────────────── */
io.on('connection', (socket) => {
  const previous = pendingRecovery.get(socket.id);
  const recoveredRoom = roomOf(socket);
  const restored = !!(socket.recovered && previous && recoveredRoom?.players.has(socket.id) && previous.until > Date.now());
  if (socket.recovered && !restored) {
    // The adapter can still hold a just-expired session. Never keep its old room subscription.
    for (const code of socket.rooms) if (code !== socket.id) socket.leave(code);
    removeMembership(socket.id);
  }
  if (restored) {
    pendingRecovery.delete(socket.id);
    recoveredRoom.players.get(socket.id).connected = true;
    const motion=recoveredRoom.players.get(socket.id).motion;
    motion.at=performance.now();motion.airAt=null;
    if (previous.autoPaused && recoveredRoom.isHost(socket.id) && recoveredRoom.paused) recoveredRoom.togglePause(socket.id);
    count('recovered');
  }
  socket.emit('hello', { id: socket.id, waves: WAVES.length, restored, recoveryMs: RECOVERY_MS,
    motionVersion:restored?recoveredRoom.players.get(socket.id).motion.version:0,
    pose: restored ? recoveredRoom.players.get(socket.id) && {
      x: recoveredRoom.players.get(socket.id).x, z: recoveredRoom.players.get(socket.id).z,
      y: recoveredRoom.players.get(socket.id).y, ry: recoveredRoom.players.get(socket.id).ry
    } : null });
  if (restored) { pushState(recoveredRoom); pushKitchen(recoveredRoom); pushPositions(recoveredRoom); }

  const permit = createEventLimiter();
  socket.use(([event, ...args], next) => {
    const cb = args.at(-1);
    const d = typeof args[0] === 'function' ? undefined : args[0];
    if (!permit(event)) {
      count('rateLimited');
      acknowledge(cb,{ok:false,err:'요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.'});
      return;
    }
    if (!validEvent(event,d)) {
      count('invalidEvents');
      acknowledge(cb,{ok:false,err:'입력 형식이 올바르지 않습니다.'});
      return;
    }
    next();
  });

  socket.on('room:create', (d, cb) => {
    const bad = nameError(d && d.name);
    if (bad) return acknowledge(cb,{ ok: false, err: bad });
    const existing = roomOf(socket);
    if (existing) return acknowledge(cb,{ok:false,err:'이미 가게에 입장해 있습니다.'});
    if (rooms.size >= runtime.maxRooms) return acknowledge(cb,{ok:false,err:'가게가 많아 잠시 후 다시 시도해 주세요.'});
    const code = makeCode();
    const room = new Room(code, d && d.shop);
    rooms.set(code, room);
    room.addPlayer(socket.id, d && d.name, d && d.look);
    room.resolveShop();                 // 이름을 안 정했으면 "방장닉의 가게"
    socket.join(code);
    socketRoom.set(socket.id, code);
    acknowledge(cb,{ ok: true, code, youId: socket.id });
    pushState(room);
    pushKitchen(room);
    pushPositions(room);
  });

  socket.on('room:join', (d, cb) => {
    const bad = nameError(d && d.name);
    if (bad) return acknowledge(cb,{ ok: false, err: bad });
    if (roomOf(socket)) return acknowledge(cb,{ok:false,err:'이미 가게에 입장해 있습니다.'});
    const code = String((d && d.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return acknowledge(cb,{ ok: false, err: '그런 방이 없습니다.' });
    if (room.size >= PLAYER_LIMIT) return acknowledge(cb,{ ok: false, err: `방이 가득 찼습니다. (최대 ${PLAYER_LIMIT}명)` });
    room.addPlayer(socket.id, d && d.name, d && d.look);
    socket.join(code);
    socketRoom.set(socket.id, code);
    acknowledge(cb,{ ok: true, code, youId: socket.id });
    pushState(room);
    pushKitchen(room);
    pushPositions(room);
  });

  socket.on('room:leave', (_d, cb) => {
    const code = socketRoom.get(socket.id);
    if (code) socket.leave(code);
    removeMembership(socket.id);
    acknowledge(typeof _d === 'function' ? _d : cb,{ok:true});
  });

  socket.on('game:start', () => {
    const room = roomOf(socket);
    if (!room || !room.isHost(socket.id)) return;
    if (!room.start()) return;
    pushPositions(room);
    pushState(room);
    pushKitchen(room);
    toast(room, '영업 시작! 첫 손님이 오기 전에 밥부터 안치세요.', 'good');
  });

  socket.on('game:pause', () => {
    const room = roomOf(socket);
    if (!room) return;
    const changed = room.togglePause(socket.id);
    if (!changed) return;
    pushState(room);
    pushKitchen(room);
    toast(room, changed.paused ? '⏸ 방장이 게임을 일시정지했습니다.' : '▶ 게임을 재개했습니다.',
      changed.paused ? 'warn' : 'good');
  });

  socket.on('game:lobby', () => {
    const room = roomOf(socket);
    if (!room || !room.isHost(socket.id)) return;
    if (room.phase !== 'result') return;
    room.toLobby();
    pushState(room);
  });

  socket.on('kitchen:act', (d) => {
    const room = roomOf(socket);
    if (!room || !d) return;
    const r = room.act(socket.id, d.action, d.payload);
    if(r?.rejected)count('rejectedDistance');
    if (r && r.msg) {
      if (r.broadcast) toast(room, r.msg, r.kind);
      else socket.emit('toast', { msg: r.msg, kind: r.kind });
    }
    if (r?.ok) pushKitchen(room);
    if (r && r.broadcast) pushState(room);
  });

  socket.on('player:move', (d) => {
    const room = roomOf(socket);
    const result=room?.move(socket.id,d);
    if(result?.pose){count('rejectedMovement');socket.emit('position:correct',result.pose);}
  });

  socket.on('player:swing', (d) => {
    const room = roomOf(socket);
    if (!room) return;
    const out = room.swing(socket.id, d && d.targetId, d && d.targetKind);
    if (!out) return;
    io.to(room.code).emit('swing', out.swing);
    if (out.hit) {
      io.to(room.code).emit('hit', out.hit);
      pushKitchen(room);
    }
    if (out.customerHit) {
      if (out.customerHit.msg) toast(room, out.customerHit.msg, 'warn');
      pushState(room);
    }
  });

  socket.on('disconnect', (reason) => {
    const room = roomOf(socket);
    if (!room) return;
    if (!stopping && ['transport close','transport error','ping timeout'].includes(reason)) {
      const autoPaused = room.isHost(socket.id) && room.phase === 'playing' && !room.paused;
      if (autoPaused) room.togglePause(socket.id);
      room.players.get(socket.id).connected = false;
      pendingRecovery.set(socket.id,{until:Date.now()+RECOVERY_MS,autoPaused});
      toast(room, '참가자의 연결을 복구하고 있습니다.' + (autoPaused ? ' 방장 복귀까지 일시정지합니다.' : ''), 'warn');
      pushState(room); pushKitchen(room);
    } else removeMembership(socket.id);
  });
});

/* ──────────────── 틱 ──────────────── */
/* 방마다 마지막으로 보낸 상태 서명 — 안 바뀌었으면 다시 안 보낸다 */
const gameTimer = setInterval(() => {
  const t = Date.now();
  for (const [id, pending] of pendingRecovery) {
    if (t >= pending.until) { count('expired'); removeMembership(id); }
  }
  for (const room of rooms.values()) {
    const events = room.tick();
    for (const e of events) {
      switch (e.type) {
        case 'toast':
          toast(room, e.msg, e.kind); break;
        case 'waveStart':
          toast(room, '🌊 웨이브 ' + e.wave + '/' + e.total + ' — 주문 ' + e.count + '건' +
            (e.specials ? ' (카운터 손님 ' + e.specials + '명)' : '') +
            ' · 김밥 ' + e.rolls + '줄 · 인내심 ' + e.patience + '초', 'warn');
          if (e.unlockedName) {
            toast(room, '🔓 새 재료 해금 — ' + e.unlockedName + ' 이(가) 냉장고에 들어왔습니다!', 'good');
          }
          break;
        case 'waveClear':
          // 토스트 대신 화면 중앙 상단에 크게 띄운다
          io.to(room.code).emit('waveEnd', {
            wave: e.wave, happy: e.happy, angry: e.angry, victory: e.victory
          });
          break;
        case 'leave':
          toast(room, e.msg, 'bad'); break;
        case 'gameOver':
          toast(room, e.result === 'victory' ? '🎉 10웨이브 완주!' : '💀 평판이 바닥났습니다...',
            e.result === 'victory' ? 'good' : 'bad');
          break;
      }
    }
    if (events.length) pushKitchen(room);

    // 바뀐 게 없으면 상태 브로드캐스트를 건너뛴다
    const sig = room.stateSignature();
    const stale = t - (lastSent.get(room.code) || 0) >= runtime.heartbeatMs;
    if (sig !== lastSig.get(room.code) || stale) {
      lastSig.set(room.code, sig);
      lastSent.set(room.code, t);
      pushState(room);
    }
  }
}, runtime.gameTickMs);

/* 위치 브로드캐스트 (NET.tickMs) — 클라이언트가 이 t 를 기준으로 보간한다.
   시각을 안 실어주면 받은 시각으로 보간해야 하는데, 네트워크가 한 번
   막혔다 몰아 오면 아바타가 순간이동한다.

   volatile 로 보낸다: 소켓 버퍼가 밀려 있으면 큐에 쌓지 말고 버리라는 뜻이다.
   위치는 50ms 뒤 새 값이 덮어쓰므로 밀린 옛 좌표는 가치가 없고, 오히려
   느린 클라이언트 하나가 서버 메모리와 이벤트 루프를 붙잡는 걸 막는다.
   토스트·상태·웨이브 종료처럼 한 번 놓치면 복구가 안 되는 것들은
   그대로 신뢰성 있게 보낸다. */
const positionsTimer = setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === 'playing' && !room.paused) {
      io.to(room.code).volatile.emit('positions', { t: Date.now(), list: room.positions() });
    }
  }
}, NET.tickMs);

/* ──────────────── 시작 ──────────────── */
function lanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

/* 랭킹을 먼저 읽어 캐시에 올린다 — 첫 손님이 빈 랭킹을 보지 않도록 */
const store = await leaderboard.init();

server.listen(runtime.port, () => {
  const port = server.address().port;
  const lan = lanAddress();
  console.log('');
  console.log(`  🍣 김밥지옥 — 웨이브 디펜스 (최대 ${PLAYER_LIMIT}인)`);
  console.log('  ─────────────────────────────────────────');
  console.log('  ➜ http://localhost:' + port);
  if (lan) console.log('  📡 팀원에게: http://' + lan + ':' + port + '   (같은 Wi-Fi)');
  console.log('');
  console.log('  웨이브 ' + WAVES.length + '개');
  console.log('  🏆 가게 랭킹 ' + leaderboard.size() + '건 기록됨 (' + store.where + ')');
  if (store.error) console.log('  ⚠  저장소 연결 실패 — 이번 판 기록이 남지 않습니다');
  console.log(`  한 명이 [새 가게 열기] → 나머지는 방 코드 ${ROOM_CODE_LENGTH}글자로 입장`);
  console.log('');
  process.send?.({type:'ready',port});
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(gameTimer); clearInterval(positionsTimer); loopLag.disable();
  io.emit('server:closing', {msg:'서버 점검으로 연결을 종료합니다. 잠시 후 다시 입장해 주세요.'});
  const deadline=setTimeout(() => process.exit(1),runtime.shutdownTimeoutMs);
  deadline.unref();
  const closed=new Promise(resolve=>io.close(resolve));
  const saved=await leaderboard.flush();
  leaderboard.close();
  await closed;
  clearTimeout(deadline);
  if(!saved) console.error('[shutdown] ranking_flush_incomplete');
  process.exit(saved?0:1);
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
