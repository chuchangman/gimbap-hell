/* ────────────────────────────────────────────────────────────
   방 — 플레이어 · 주방 · 웨이브 · 빗자루 난투를 한데 묶는다.
   판정은 전부 여기(서버)에서 한다. 클라이언트를 고쳐도 뚫리지 않는다.
   ──────────────────────────────────────────────────────────── */
import {
  COMBAT, SCORE, REPUTATION_MAX, QUEUE_Z, slotX
} from '../public/js/config.js';
import { Kitchen, nowMs } from './kitchen.mjs';
import { WaveRunner } from './waves.mjs';
import * as leaderboard from './leaderboard.mjs';

/* 닉네임 규칙 — 서버가 최종 판정자다. 클라이언트 검사는 거들 뿐 */
export const NAME_MIN = 2;
export const NAME_MAX = 12;

/** 문제가 있으면 사람이 읽을 메시지, 없으면 null */
export function nameError(name) {
  const s = String(name == null ? '' : name).trim();
  if (s.length < NAME_MIN) return '이름은 ' + NAME_MIN + '글자 이상이어야 합니다.';
  if (s.length > NAME_MAX) return '이름은 ' + NAME_MAX + '글자를 넘을 수 없습니다.';
  return null;
}

const COLORS = ['#f5b942', '#63a8e8', '#58c07a', '#e0728f', '#a98ae0', '#e08a4a'];

/* 라운드 시작 위치 — 주방 가운데 통로에 흩어놓는다 */
const SPAWNS = [
  { x: -1.6, z: 5.6 }, { x: 1.6, z: 5.6 }, { x: 0, z: 6.6 },
  { x: -3.2, z: 5.0 }, { x: 3.2, z: 5.0 }, { x: 0, z: 4.4 }
];

export class Room {
  constructor(code, shopName) {
    this.code = code;
    this.rawShop = shopName;                     // 방장이 입력한 원본 (안 적었으면 빈 값)
    this.shop = leaderboard.cleanShopName(shopName, code + ' 김밥집');
    this.players = new Map();       // id → { id, name, color, x, z, y, ry, lastSwing }
    this.hostId = null;
    this.phase = 'lobby';           // lobby | playing | result
    this.kitchen = new Kitchen();
    this.waves = null;
    this.result = null;
    this.history = [];              // 지난 판 기록
  }

  /* ──────────────── 플레이어 ──────────────── */
  /** 안 쓰는 가장 작은 자리 번호 — 나간 자리는 다음 사람이 물려받는다 */
  freeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < 6; i++) if (!used.has(i)) return i;
    return this.players.size;
  }

  addPlayer(id, name) {
    const i = this.freeSlot();
    const spawn = SPAWNS[i % SPAWNS.length];
    this.players.set(id, {
      id,
      slot: i,
      name: (name || '').trim().slice(0, 12) || ('알바' + (i + 1)),
      color: COLORS[i % COLORS.length],
      x: spawn.x, z: spawn.z, y: 0, ry: 0,
      lastSwing: 0
    });
    this.kitchen.join(id);
    if (!this.hostId) this.hostId = id;
    return this.players.get(id);
  }

  removePlayer(id) {
    this.players.delete(id);
    this.kitchen.leave(id);
    if (this.hostId === id) this.hostId = this.players.keys().next().value || null;
  }

  get size() { return this.players.size; }
  isHost(id) { return this.hostId === id; }

  /**
   * 가게 이름 확정 — 방장이 들어온 뒤에 부른다.
   * 이름을 안 정했으면 방장 닉네임을 따서 "○○의 가게" 가 된다.
   */
  resolveShop() {
    const host = this.players.get(this.hostId);
    const fallback = host
      ? (host.name + '의 가게').slice(0, leaderboard.SHOP_MAX)
      : this.code + ' 김밥집';
    this.shop = leaderboard.cleanShopName(this.rawShop, fallback);
    return this.shop;
  }

  /* ──────────────── 라운드 ──────────────── */
  start() {
    if (this.phase === 'playing') return false;
    this.kitchen.reset();
    for (const id of this.players.keys()) this.kitchen.join(id);
    this.waves = new WaveRunner(this.players.size);
    this.phase = 'playing';
    this.result = null;
    let i = 0;
    for (const p of this.players.values()) {
      const s = SPAWNS[i++ % SPAWNS.length];
      p.x = s.x; p.z = s.z; p.y = 0; p.ry = 0;
    }
    return true;
  }

  toLobby() {
    this.phase = 'lobby';
    this.result = null;
  }

  /** 5Hz 로 호출된다 → 밖으로 내보낼 이벤트 목록 */
  tick() {
    if (this.phase !== 'playing') return [];
    const events = [];
    for (const n of this.kitchen.tick()) events.push({ type: 'toast', msg: n.msg, kind: n.kind });

    for (const e of this.waves.tick()) {
      events.push(e);
      if (e.type === 'gameOver') {
        this.phase = 'result';
        this.result = this.buildResult(e.result);
      }
    }
    return events;
  }

  /* ──────────────── 주방 동작 ──────────────── */
  act(pid, action, payload) {
    if (this.phase !== 'playing') return { ok: false, msg: '아직 영업 전입니다.', kind: 'bad' };
    if (!this.players.has(pid)) return { ok: false, msg: '방에 없습니다.', kind: 'bad' };
    if (action === 'serve') return this.serve(pid, payload && payload.customerId);
    return this.kitchen.act(pid, action, payload);
  }

  /**
   * 🛎️ 서빙
   * customerId 를 주면 그 손님에게 (조준해서 서빙),
   * 안 주면 속재료 조합이 가장 잘 맞는 주문으로 나간다 (창구 서빙).
   */
  serve(pid, customerId) {
    if (!this.waves) return { ok: false, msg: '아직 영업 전입니다.', kind: 'bad' };

    const hand = this.kitchen.hand(pid);
    if (!hand || hand.id !== 'gimbap') return { ok: false, msg: '완성된 김밥을 들고 오세요.', kind: 'bad' };

    const target = customerId
      ? this.waves.waitingById(customerId)
      : this.waves.bestMatch(hand.fills || []);
    if (!target) {
      return {
        ok: false,
        msg: customerId ? '그 손님은 이미 갔습니다.' : '기다리는 주문이 없습니다.',
        kind: 'bad'
      };
    }

    const item = this.kitchen.takeGimbap(pid);
    const r = this.waves.serve(item.fills || [], customerId);
    if (!r.ok) {
      // 주문이 그 사이에 사라졌다 — 김밥은 돌려준다
      this.kitchen.setHand(pid, item);
      return r;
    }
    return { ok: true, msg: r.msg, kind: r.kind, broadcast: true };
  }

  /* ──────────────── 🧹 빗자루 ────────────────
     사거리·정면 판정·쿨다운을 서버가 다시 검사한다.
     ──────────────────────────────────────────────────────────── */
  swing(pid, targetId, targetKind) {
    if (this.phase !== 'playing') return null;
    const me = this.players.get(pid);
    if (!me) return null;
    if (!this.kitchen.hasBroom(pid)) return null;

    const t = nowMs();
    if (t - me.lastSwing < COMBAT.cooldown) return null;
    me.lastSwing = t;

    const out = { swing: { by: pid }, hit: null, customerHit: null };
    if (!targetId) return out;

    /* 사거리 + 정면(±70도) 판정 — 클라이언트를 고쳐도 뚫리지 않는다 */
    const reach = (x, z) => {
      const dx = x - me.x, dz = z - me.z;
      const d = Math.hypot(dx, dz);
      if (d > COMBAT.range || d < 0.001) return null;
      const fx = -Math.sin(me.ry), fz = -Math.cos(me.ry);   // yaw=0 은 -z 방향
      if ((dx / d) * fx + (dz / d) * fz < COMBAT.cone) return null;
      return { dx: dx / d, dz: dz / d };
    };

    /* 👤 손님 때리기 */
    if (targetKind === 'customer') {
      if (!this.waves) return out;
      const c = this.waves.active.find((x) => x.id === targetId && x.state === 'wait');
      if (!c) return out;
      if (!reach(slotX(c.slot), QUEUE_Z)) return out;
      const r = this.waves.hit(targetId);
      if (r) out.customerHit = r;
      return out;
    }

    /* 🧑‍🍳 동료 때리기 */
    const other = this.players.get(targetId);
    if (!other || other.id === pid) return out;
    const dir = reach(other.x, other.z);
    if (!dir) return out;

    const dropped = this.kitchen.dropFor(other.id);
    out.hit = {
      target: other.id, by: pid,
      dirX: dir.dx, dirZ: dir.dz,
      power: COMBAT.knockback,
      dropped: dropped ? dropped.id : null
    };
    return out;
  }

  /* ──────────────── 위치 ──────────────── */
  move(pid, d) {
    const p = this.players.get(pid);
    if (!p || !d) return;
    if (typeof d.x === 'number') p.x = Math.max(-8, Math.min(8, d.x));
    if (typeof d.z === 'number') p.z = Math.max(-11, Math.min(9, d.z));
    if (typeof d.y === 'number') p.y = Math.max(0, Math.min(3, d.y));
    if (typeof d.ry === 'number') p.ry = d.ry;
  }

  /* 위치 패킷 — [자리번호, x, z, y, ry] 배열.
     가장 자주 나가는 패킷이라 크기가 곧 대역폭이다. socket.id 문자열
     20자와 소수점 15자리를 그대로 실으면 6인 방 한 번에 586B 인데,
     자리 번호와 반올림한 좌표만 남기면 145B 다 (-75%).
     자리 번호 → socket.id 는 상태 스냅샷의 players[].slot 이 알려준다. */
  positions() {
    return [...this.players.values()].map((p) => [
      p.slot,
      Math.round(p.x * 100) / 100,      // 1cm — 플레이어 반지름이 0.3m 다
      Math.round(p.z * 100) / 100,
      Math.round(p.y * 100) / 100,
      Math.round(p.ry * 1000) / 1000    // 0.001rad ≈ 0.06°
    ]);
  }

  /* ──────────────── 스냅샷 ──────────────── */
  publicState() {
    return {
      now: nowMs(),
      code: this.code,
      shop: this.shop,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({ id: p.id, slot: p.slot, name: p.name, color: p.color })),
      wave: this.waves ? this.waves.snapshot() : null,
      result: this.result,
      history: this.history
    };
  }

  kitchenState() { return this.kitchen.snapshot(); }

  /** 브로드캐스트 최적화 — 시각(now)만 다른 스냅샷은 다시 보내지 않는다 */
  stateSignature() {
    const s = this.publicState();
    s.now = 0;
    if (s.wave) s.wave.now = 0;
    return JSON.stringify(s);
  }

  buildResult(kind) {
    const w = this.waves.snapshot();
    const mess = this.kitchen.mess;
    const penalty = mess * SCORE.messPenalty;
    const total = Math.max(0, w.score - penalty);
    const res = {
      kind,                                    // 'victory' | 'defeat'
      shop: this.shop,
      wave: w.wave,
      totalWaves: w.totalWaves,
      score: total,
      rawScore: w.score,
      messPenalty: penalty,
      mess,
      reputation: w.reputation,
      reputationMax: REPUTATION_MAX,
      servedRolls: w.servedRolls,
      avgQuality: w.avgQuality,
      happy: w.happy,
      angry: w.angry,
      players: [...this.players.values()].map((p) => ({ name: p.name, color: p.color }))
    };
    // 가게 랭킹에 올리고, 이번 판이 몇 위인지 결과에 붙인다
    const rec = leaderboard.add({
      shop: this.shop, score: total, kind,
      wave: w.wave, totalWaves: w.totalWaves,
      players: res.players, servedRolls: w.servedRolls, avgQuality: w.avgQuality
    });
    res.rank = rec.rank;
    res.board = leaderboard.publicBoard(rec.entry.id, 10);
    res.entryId = rec.entry.id;

    this.history.unshift({ kind, wave: w.wave, score: total, rank: rec.rank, at: nowMs() });
    this.history = this.history.slice(0, 5);
    return res;
  }
}
