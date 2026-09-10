/* ────────────────────────────────────────────────────────────
   소켓 + 공유 상태
   서버가 보내주는 스냅샷을 S 에 담아두고, 나머지 모듈은 여기서 읽는다.
   ──────────────────────────────────────────────────────────── */
import { samplePath, NET } from './config.js';
import {DEFAULT_RECOVERY_MS} from './game-rules.js';

const listeners = new Map();

export const S = {
  socket: null,
  meId: null,
  meName: '',
  state: null,       // 방/웨이브 공개 상태
  kitchen: null,     // 주방 스냅샷
  positions: [],     // 다른 플레이어 위치
  offset: 0,         // 서버 시계 - 내 시계 (ms)
  connection: 'connecting',
  frozenAt: 0,
  restorePose: null,
  recoveryMs: DEFAULT_RECOVERY_MS,
  motionVersion: 0
};

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, []);
  listeners.get(evt).push(fn);
}

function fire(evt, data) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(data); } catch (err) { console.error('[net] ' + evt, err); }
  }
}

/** 서버 기준 현재 시각 (ms) */
export const serverNow = () => {
  if (S.connection !== 'connected' && S.frozenAt) return S.frozenAt;
  if (S.state && S.state.paused && S.state.pausedAt) return S.state.pausedAt;
  return Date.now() + S.offset;
};

/* ── 원격 플레이어 위치 보간 ──────────────────────────────
   S.positions 는 "방금 받은 값" 그대로다 (내 위치를 찾는 데 쓴다).
   화면에 그릴 남들의 위치는 remotePositions() 로 받는다 — 표본을
   쌓아두고 INTERP_MS 만큼 과거를 재생해 등속으로 흐르게 한다.
   ──────────────────────────────────────────────────────── */
const INTERP_MS = NET.interpMs;   // config.js 의 NET 에서 온다
const KEEP_MS = 1000;       // 이보다 오래된 표본은 버린다
const snaps = new Map();    // 자리번호 → [{ t, x, z, y, ry }, ...] 시간순
const owner = new Map();    // 자리번호 → 표본을 쌓을 때의 주인 id

/** 위치 항목은 [자리번호, x, z, y, ry] 배열로 온다 (옛 객체 형식도 받아준다) */
function unpack(e) {
  return Array.isArray(e)
    ? { slot: e[0], x: e[1], z: e[2], y: e[3] || 0, ry: e[4] }
    : { slot: e.slot, x: e.x, z: e.z, y: e.y || 0, ry: e.ry };
}

/** 자리번호 → socket.id — 상태 스냅샷의 players[].slot 이 알려준다 */
function idOfSlot(slot) {
  const list = (S.state && S.state.players) || [];
  const p = list.find((x) => x.slot === slot);
  return p ? p.id : null;
}

function pushSnapshot(t, list) {
  const seen = new Set();
  for (const e of list) {
    const p = unpack(e);
    seen.add(p.slot);
    /* 나간 자리를 새 사람이 물려받으면, 옛 좌표와 섞여 미끄러져 온다 */
    const who = idOfSlot(p.slot);
    if (who && owner.get(p.slot) !== who) {
      owner.set(p.slot, who);
      snaps.set(p.slot, []);
    }
    let buf = snaps.get(p.slot);
    if (!buf) snaps.set(p.slot, (buf = []));
    const last = buf[buf.length - 1];
    if (last && t <= last.t) continue;        // 뒤늦게 온 패킷은 버린다
    buf.push({ t, x: p.x, z: p.z, y: p.y, ry: p.ry });
    while (buf.length > 2 && buf[1].t < t - KEEP_MS) buf.shift();
  }
  for (const slot of [...snaps.keys()]) {
    if (!seen.has(slot)) { snaps.delete(slot); owner.delete(slot); }
  }
}

/** 지금 화면에 그릴 남들의 위치 (나는 뺀다) */
export function remotePositions() {
  const at = serverNow() - INTERP_MS;
  const out = [];
  for (const [slot, buf] of snaps) {
    const id = idOfSlot(slot);
    if (!id || id === S.meId) continue;       // 아직 누군지 모르면 그리지 않는다
    const s = samplePath(buf, at);
    if (s) out.push({ id, x: s.x, z: s.z, y: s.y || 0, ry: s.ry });
  }
  return out;
}

/** 내가 지금 손에 들고 있는 것 */
export function myHand() {
  if (!S.kitchen || !S.kitchen.hands) return null;
  const h = S.kitchen.hands.find((x) => x.id === S.meId);
  return h ? h.holding : null;
}

export function handOf(id) {
  if (!S.kitchen || !S.kitchen.hands) return null;
  const h = S.kitchen.hands.find((x) => x.id === id);
  return h ? h.holding : null;
}

export const isHost = () => !!S.state && S.state.hostId === S.meId;
export const isPaused = () => !!S.state && !!S.state.paused;
export const wave = () => (S.state && S.state.wave) || null;
export const phase = () => (S.state ? S.state.phase : 'lobby');
export const isPlaying = () => S.connection === 'connected' && phase() === 'playing' && !isPaused();

export function emit(evt, data, cb) {
  // Socket.IO buffers ordinary emits offline. Replaying old cooking/movement
  // commands on reconnect would mutate a different point in the game timeline.
  if (!S.socket?.connected || S.connection !== 'connected') {
    if (typeof cb === 'function') cb({ok:false,err:'연결 복구 중입니다. 잠시 기다려 주세요.'});
    return false;
  }
  if (typeof cb === 'function') S.socket.timeout(8000).emit(evt,data,(error,response) =>
    cb(error ? {ok:false,err:'응답이 늦어지고 있습니다. 연결 상태를 확인해 주세요.'} : response));
  else S.socket.emit(evt,data);
  return true;
}

/** 주방 동작 — 서버가 다시 검사한다 */
export function act(action, payload) {
  emit('kitchen:act', { action, payload: payload || {} });
}

export function connect() {
  const socket = window.io({ timeout:8000, reconnectionDelay:500, reconnectionDelayMax:3000 });
  S.socket = socket;

  const clearSession = () => {
    S.state = null; S.kitchen = null; S.positions = []; S.restorePose = null;
    snaps.clear(); owner.clear();
  };
  socket.on('hello', (d) => {
    const hadSession = !!S.state;
    if (!d.restored) clearSession();
    S.meId = d.id; S.connection = 'connected'; S.frozenAt = 0;
    S.motionVersion=d.motionVersion||0;
    S.recoveryMs = d.recoveryMs || 30000;
    S.restorePose = d.restored ? d.pose : null;
    fire('hello', d); fire('connection',S.connection);
    if (hadSession && !d.restored) fire('toast',{msg:'이전 연결을 복구하지 못했습니다. 방 코드로 다시 입장해 주세요.',kind:'warn'});
    if (d.restored) fire('toast',{msg:'연결을 복구했습니다. 같은 자리에서 이어갑니다.',kind:'good'});
  });

  socket.on('state', (st) => {
    if (S.connection !== 'connected') return; // ignore replayed stale packets; hello precedes fresh state
    S.offset = st.now - Date.now();
    const prev = S.state && S.state.phase;
    const prevWave = S.state && S.state.wave && S.state.wave.wave;
    S.state = st;
    if(st.phase==='playing' && prev!=='playing')S.motionVersion=0;
    fire('state', st);
    if (prev !== st.phase) fire('phase', st.phase);
    const w = st.wave && st.wave.wave;
    if (w && w !== prevWave) fire('wave', st.wave);
  });

  socket.on('kitchen', (k) => {
    if (S.connection !== 'connected') return;
    S.offset = k.now - Date.now();
    S.kitchen = k;
    fire('kitchen', k);
  });

  socket.on('positions', (d) => {
    if (S.connection !== 'connected') return;
    const raw = d.list || d;
    const t = typeof d.t === 'number' ? d.t : serverNow();
    pushSnapshot(t, raw);
    /* S.positions 는 예전처럼 id 가 붙은 객체로 둔다 — 내 스폰 자리를 찾는 데 쓴다 */
    S.positions = raw.map(unpack).map((e) => ({ id: idOfSlot(e.slot), ...e }));
    fire('positions', S.positions);
  });
  socket.on('position:correct',d=>{
    if(S.connection!=='connected' || !Number.isInteger(d.version) || d.version<S.motionVersion)return;
    S.motionVersion=d.version;fire('position:correct',d);
  });
  for (const event of ['toast','waveEnd','swing','hit']) {
    socket.on(event, d => { if(S.connection === 'connected') fire(event,d); });
  }
  socket.on('disconnect', () => {
    S.frozenAt = serverNow(); S.connection = 'reconnecting';
    fire('connection',S.connection);
  });
  socket.on('connect_error', () => { S.connection = 'reconnecting'; fire('connection',S.connection); });
  socket.on('server:closing', d => fire('toast',{msg:d.msg,kind:'warn'}));

  return new Promise((resolve) => {
    // Show usable controls and connection feedback even if the first attempt
    // fails; background reconnection can then recover without a dead fatal page.
    socket.once('hello', resolve);
    socket.once('connect_error', resolve);
  });
}
