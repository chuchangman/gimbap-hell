/* ────────────────────────────────────────────────────────────
   정적 파일 서버 + Socket.IO 멀티플레이
     · 방 만들기 / 방 코드로 입장
     · 5Hz 로 방 상태(웨이브·손님·주방)를 뿌린다
     · NET.tickMs 마다 플레이어 위치를 뿌린다 (volatile)
   ──────────────────────────────────────────────────────────── */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { Room, nameError } from './room.mjs';
import * as leaderboard from './leaderboard.mjs';
import { WAVES, NET } from '../public/js/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'public');
const PORT = Number(process.env.PORT) || 3211;

/* 이벤트 루프가 밀리는지 재둔다 — /health 로 밖에서 확인한다.
   CPU 가 모자라면 여기부터 티가 난다 (숫자가 커지면 응답이 늦다는 뜻). */
const loopLag = monitorEventLoopDelay({ resolution: 10 });
loopLag.enable();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/health') {
    /* HTTP 코드는 문제가 있어도 200 을 유지한다 — Render 가 이 경로를
       헬스체크로 쓰기 때문이다. 랭킹 저장소가 죽었다고 서비스를 내리면
       게임은 멀쩡한데 다 같이 못 하게 된다. 대신 본문의 ok 를 false 로
       내리니, 외부 모니터는 '"ok":true' 키워드로 감시하면 된다. */
    return send(res, 200, JSON.stringify({
      ok: !store.error,
      uptimeSec: Math.round(process.uptime()),
      rooms: rooms.size,
      players: io.engine.clientsCount,
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      lagP99ms: Math.round(loopLag.percentile(99) / 1e5) / 10,   // 이벤트 루프 지연
      store: store.mode,              // 'file' | 'redis' — 어느 저장소를 쓰는지
      entries: leaderboard.size(),
      storeError: store.error || undefined
    }), MIME['.json']);
  }
  if (urlPath === '/leaderboard.json') return send(res, 200, JSON.stringify(leaderboard.publicTop(50)), MIME['.json']);

  // 경로 탈출 방지 — '..' 과 '.' 을 아예 걸러낸다
  const parts = urlPath.split('/').filter((p) => p && p !== '.' && p !== '..');
  const filePath = path.join(ROOT, ...parts);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, '404 — ' + urlPath);
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
});

const io = new Server(server, { cors: { origin: '*' } });

/** @type {Map<string, Room>} */
const rooms = new Map();
const socketRoom = new Map();   // socketId → roomCode

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const roomOf = (socket) => rooms.get(socketRoom.get(socket.id));
const pushState = (room) => io.to(room.code).emit('state', room.publicState());
const pushKitchen = (room) => io.to(room.code).emit('kitchen', room.kitchenState());
const toast = (room, msg, kind) => io.to(room.code).emit('toast', { msg, kind: kind || 'good' });

/* ──────────────── 소켓 ──────────────── */
io.on('connection', (socket) => {
  socket.emit('hello', { id: socket.id, waves: WAVES.length });

  socket.on('room:create', (d, cb) => {
    const bad = nameError(d && d.name);
    if (bad) return cb && cb({ ok: false, err: bad });
    const code = makeCode();
    const room = new Room(code, d && d.shop);
    rooms.set(code, room);
    room.addPlayer(socket.id, d && d.name, d && d.look);
    room.resolveShop();                 // 이름을 안 정했으면 "방장닉의 가게"
    socket.join(code);
    socketRoom.set(socket.id, code);
    if (cb) cb({ ok: true, code, youId: socket.id });
    pushState(room);
    pushKitchen(room);
  });

  socket.on('room:join', (d, cb) => {
    const bad = nameError(d && d.name);
    if (bad) return cb && cb({ ok: false, err: bad });
    const code = String((d && d.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, err: '그런 방이 없습니다.' });
    if (room.size >= 6) return cb && cb({ ok: false, err: '방이 가득 찼습니다. (최대 6명)' });
    room.addPlayer(socket.id, d && d.name, d && d.look);
    socket.join(code);
    socketRoom.set(socket.id, code);
    if (cb) cb({ ok: true, code, youId: socket.id });
    pushState(room);
    pushKitchen(room);
  });

  socket.on('game:start', () => {
    const room = roomOf(socket);
    if (!room || !room.isHost(socket.id)) return;
    if (!room.start()) return;
    pushState(room);
    pushKitchen(room);
    toast(room, '영업 시작! 첫 손님이 오기 전에 밥부터 안치세요.', 'good');
  });

  socket.on('game:lobby', () => {
    const room = roomOf(socket);
    if (!room || !room.isHost(socket.id)) return;
    room.toLobby();
    pushState(room);
  });

  socket.on('kitchen:act', (d) => {
    const room = roomOf(socket);
    if (!room || !d) return;
    const r = room.act(socket.id, d.action, d.payload);
    if (r && r.msg) {
      if (r.broadcast) toast(room, r.msg, r.kind);
      else socket.emit('toast', { msg: r.msg, kind: r.kind });
    }
    pushKitchen(room);
    if (r && r.broadcast) pushState(room);
  });

  socket.on('player:move', (d) => {
    const room = roomOf(socket);
    if (room) room.move(socket.id, d);
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

  socket.on('disconnect', () => {
    const code = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    room.removePlayer(socket.id);
    if (room.size === 0) rooms.delete(code);
    else { pushState(room); pushKitchen(room); }
  });
});

/* ──────────────── 틱 ──────────────── */
/* 방마다 마지막으로 보낸 상태 서명 — 안 바뀌었으면 다시 안 보낸다 */
const lastSig = new Map();
const lastSent = new Map();
const HEARTBEAT_MS = 2000;      // 시계 동기화를 위해 이 간격으로는 무조건 한 번

setInterval(() => {
  const t = Date.now();
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
    const stale = t - (lastSent.get(room.code) || 0) >= HEARTBEAT_MS;
    if (sig !== lastSig.get(room.code) || stale) {
      lastSig.set(room.code, sig);
      lastSent.set(room.code, t);
      pushState(room);
    }
  }
}, 200);

/* 위치 브로드캐스트 (NET.tickMs) — 클라이언트가 이 t 를 기준으로 보간한다.
   시각을 안 실어주면 받은 시각으로 보간해야 하는데, 네트워크가 한 번
   막혔다 몰아 오면 아바타가 순간이동한다.

   volatile 로 보낸다: 소켓 버퍼가 밀려 있으면 큐에 쌓지 말고 버리라는 뜻이다.
   위치는 50ms 뒤 새 값이 덮어쓰므로 밀린 옛 좌표는 가치가 없고, 오히려
   느린 클라이언트 하나가 서버 메모리와 이벤트 루프를 붙잡는 걸 막는다.
   토스트·상태·웨이브 종료처럼 한 번 놓치면 복구가 안 되는 것들은
   그대로 신뢰성 있게 보낸다. */
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === 'playing') {
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

server.listen(PORT, () => {
  const lan = lanAddress();
  console.log('');
  console.log('  🍣 김밥지옥 — 웨이브 디펜스 (최대 6인)');
  console.log('  ─────────────────────────────────────────');
  console.log('  ➜ http://localhost:' + PORT);
  if (lan) console.log('  📡 팀원에게: http://' + lan + ':' + PORT + '   (같은 Wi-Fi)');
  console.log('');
  console.log('  웨이브 ' + WAVES.length + '개');
  console.log('  🏆 가게 랭킹 ' + leaderboard.size() + '건 기록됨 (' + store.where + ')');
  if (store.error) console.log('  ⚠  저장소 연결 실패 — 이번 판 기록이 남지 않습니다');
  console.log('  한 명이 [새 가게 열기] → 나머지는 방 코드 4글자로 입장');
  console.log('');
});
