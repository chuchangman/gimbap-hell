/* ────────────────────────────────────────────────────────────
   소켓 + 공유 상태
   서버가 보내주는 스냅샷을 S 에 담아두고, 나머지 모듈은 여기서 읽는다.
   ──────────────────────────────────────────────────────────── */
import { samplePath, NET } from './config.js';

const listeners = new Map();

export const S = {
  socket: null,
  meId: null,
  meName: '',
  state: null,       // 방/웨이브 공개 상태
  kitchen: null,     // 주방 스냅샷
  positions: [],     // 다른 플레이어 위치
  offset: 0          // 서버 시계 - 내 시계 (ms)
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
export const serverNow = () => Date.now() + S.offset;

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
export const wave = () => (S.state && S.state.wave) || null;
export const phase = () => (S.state ? S.state.phase : 'lobby');
export const isPlaying = () => phase() === 'playing';

export function emit(evt, data, cb) {
  if (S.socket) S.socket.emit(evt, data, cb);
}

/** 주방 동작 — 서버가 다시 검사한다 */
export function act(action, payload) {
  emit('kitchen:act', { action, payload: payload || {} });
}

export function connect() {
  const socket = window.io();
  S.socket = socket;

  socket.on('hello', (d) => { S.meId = d.id; fire('hello', d); });

  socket.on('state', (st) => {
    S.offset = st.now - Date.now();
    const prev = S.state && S.state.phase;
    const prevWave = S.state && S.state.wave && S.state.wave.wave;
    S.state = st;
    fire('state', st);
    if (prev !== st.phase) fire('phase', st.phase);
    const w = st.wave && st.wave.wave;
    if (w && w !== prevWave) fire('wave', st.wave);
  });

  socket.on('kitchen', (k) => {
    S.offset = k.now - Date.now();
    S.kitchen = k;
    fire('kitchen', k);
  });

  socket.on('positions', (d) => {
    const raw = d.list || d;
    const t = typeof d.t === 'number' ? d.t : serverNow();
    pushSnapshot(t, raw);
    /* S.positions 는 예전처럼 id 가 붙은 객체로 둔다 — 내 스폰 자리를 찾는 데 쓴다 */
    S.positions = raw.map(unpack).map((e) => ({ id: idOfSlot(e.slot), ...e }));
    fire('positions', S.positions);
  });
  socket.on('toast', (d) => fire('toast', d));
  socket.on('waveEnd', (d) => fire('waveEnd', d));
  socket.on('swing', (d) => fire('swing', d));
  socket.on('hit', (d) => fire('hit', d));
  socket.on('disconnect', () => fire('toast', { msg: '서버와 연결이 끊겼습니다.', kind: 'bad' }));

  return new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', (e) => reject(new Error(e.message || '연결 실패')));
  });
}
