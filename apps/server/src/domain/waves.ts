/* ────────────────────────────────────────────────────────────
   웨이브 디펜스 — 손님이 밀려온다
     준비(prep) → 웨이브(wave) → 준비 → ... → 10웨이브 → 클리어

   손님은 두 종류다.
     · kiosk   — 키오스크로 주문만 넣는 일반 손님. 가게에 나타나지 않는다.
                 기본 3종 + 해금된 추가 재료를 얹은 주문.
     · counter — 카운터에 직접 오는 진상 손님. 커스텀 조합을 요구하고
                 인내심이 훨씬 빨리 닳는다.

   난이도는 웨이브가 갈수록 손님 수·주문량이 늘고 인내심이 줄어든다.
   인내심이 0이 되면 손님은 그냥 돌아가고 점수와 평판이 깎인다.
   ──────────────────────────────────────────────────────────── */
import {
  BASE_FILLINGS,
  CUSTOMER_HP,
  CUSTOMER_LOOKS,
  ITEMS,
  KIND,
  kioskExtraMax,
  matchScore,
  NORMAL_LOOKS,
  PREP_BETWEEN,
  PREP_FIRST,
  QUEUE_SLOTS,
  REPUTATION_MAX,
  scaleCount,
  SCORE,
  servedQuality,
  SPECIAL_FILLS,
  SPECIAL_PATIENCE,
  SPECIAL_RATIO,
  unlockAt,
  unlockedExtras,
  WALK_IN_MS,
  WALK_OUT_MS,
  WAVES,
  type CustomerKind,
  type CustomerLook,
  type Fill,
  type ItemId,
} from '@repo/game-core';
import type { CustomerState, CustomerView, GameResultKind, WaveSnapshot } from '@repo/types';

export { WALK_IN_MS, WALK_OUT_MS };

export interface Customer {
  id: string;
  kind: CustomerKind;
  look: CustomerLook;
  fills: ItemId[];
  need: number;
  done: number;
  patienceMax: number;
  hpMax: number;
  hp: number;
  seed: number;
  enteredAt: number;
  deadline: number;
  slot: number;
  state: CustomerState;
  since: number;
}

export type WaveEvent =
  | {
      type: 'waveStart';
      wave: number;
      total: number;
      count: number;
      specials: number;
      patience: number;
      rolls: number;
      unlocked: ItemId | null;
      unlockedName: string | null;
    }
  | { type: 'spawn'; customer: CustomerView }
  | { type: 'leave'; customer: CustomerView; msg: string }
  | { type: 'refresh' }
  | { type: 'waveClear'; wave: number; happy: number; angry: number; victory: boolean }
  | { type: 'gameOver'; result: GameResultKind };

export interface HitResult {
  kicked: boolean;
  customer: CustomerView;
  msg?: string;
}

export interface ServeResult {
  ok: boolean;
  msg: string;
  kind: 'good' | 'warn' | 'bad';
  completed?: boolean;
  customer?: CustomerView;
  gain?: number;
  quality?: number;
}

/** 방마다 하나씩 만든다. 시계와 난수를 주입할 수 있어 테스트가 둘을 묶는다. */
export class WaveRunner {
  players: number;
  uid!: number;
  wave!: number;
  phase!: 'prep' | 'wave' | 'over';
  phaseEndsAt!: number;
  gap!: number;
  pending!: Customer[];
  active!: Customer[];
  nextSpawnAt!: number;
  reputation!: number;
  score!: number;
  servedRolls!: number;
  qualitySum!: number;
  happy!: number;
  angry!: number;
  kicked!: number;
  result!: GameResultKind | null;
  log!: { wave: number; happy: number; angry: number; score: number }[];

  constructor(
    playerCount: number,
    private readonly clock: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {
    this.players = Math.max(1, playerCount || 1);
    this.reset();
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(this.random() * arr.length)];
  }

  /** 배열에서 n 개를 겹치지 않게 뽑는다 */
  private sample<T>(arr: T[], n: number): T[] {
    const pool = arr.slice();
    const out: T[] = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0]);
    }
    return out;
  }

  reset(): void {
    this.uid = 1;
    this.wave = 0; // 0 = 아직 시작 전, 1..10
    this.phase = 'prep'; // prep | wave | over
    this.phaseEndsAt = this.clock() + PREP_FIRST * 1000;
    this.gap = 10;
    this.pending = []; // 아직 안 들어온 손님
    this.active = []; // 주문이 살아 있는 손님
    this.nextSpawnAt = 0;
    this.reputation = REPUTATION_MAX;
    this.score = 0;
    this.servedRolls = 0;
    this.qualitySum = 0;
    this.happy = 0;
    this.angry = 0;
    this.kicked = 0;
    this.result = null; // 'victory' | 'defeat'
    this.log = [];
  }

  get totalWaves(): number {
    return WAVES.length;
  }

  /** 일시정지 동안 흐른 실제 시간을 모든 웨이브 기준 시각에서 제외한다. */
  shiftTime(ms: number): void {
    if (!(ms > 0)) return;
    if (this.phase === 'prep' && this.phaseEndsAt) this.phaseEndsAt += ms;
    if (this.phase === 'wave' && this.nextSpawnAt) this.nextSpawnAt += ms;
    for (const c of this.active) {
      if (c.since) c.since += ms;
      if (c.enteredAt) c.enteredAt += ms;
      if (c.deadline) c.deadline += ms;
    }
  }

  /** 이 웨이브에서 쓸 수 있는 속재료 전부 */
  available(wave: number): ItemId[] {
    return [...BASE_FILLINGS, ...unlockedExtras(wave)];
  }

  /* ──────────────── 주문 만들기 ──────────────── */
  /** 일반 손님 — 기본 3종 위에 해금된 재료를 얹는다 */
  kioskOrder(wave: number): ItemId[] {
    const extras = unlockedExtras(wave);
    const maxAdd = Math.min(extras.length, kioskExtraMax(wave));
    const add = maxAdd > 0 ? this.sample(extras, 1 + Math.floor(this.random() * maxAdd)) : [];
    return [...BASE_FILLINGS, ...add];
  }

  /** 진상 손님 — 기본 3종 규칙을 무시한 커스텀 조합 */
  counterOrder(wave: number): ItemId[] {
    const pool = this.available(wave);
    const [lo, hi] = SPECIAL_FILLS;
    const n = Math.min(pool.length, lo + Math.floor(this.random() * (hi - lo + 1)));
    return this.sample(pool, n);
  }

  /* ──────────────── 웨이브 준비 ──────────────── */
  buildWave(n: number): {
    list: Customer[];
    gap: number;
    patience: number;
    count: number;
    specials: number;
  } {
    const w = WAVES[n - 1];
    const count = scaleCount(w.n, this.players);
    const patience = w.patience;
    const gap = w.gap;

    // 전체의 SPECIAL_RATIO 만큼이 카운터로 오는 진상 손님
    const specials = Math.min(count, Math.round(count * SPECIAL_RATIO));

    const kinds: CustomerKind[] = Array.from({ length: count }, (_, i) =>
      i < specials ? KIND.COUNTER : KIND.KIOSK,
    );
    // 진상이 앞쪽에 몰리지 않도록 섞는다
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }

    const list = kinds.map((kind, i): Customer => {
      const counter = kind === KIND.COUNTER;
      /* 속성 평가 순서가 곧 난수·uid 소비 순서다. id 가 uid 를 올린 뒤
         seed 가 올라간 uid 를 읽는다 — 순서를 바꾸면 손님 외형이 달라진다. */
      return {
        id: 'c' + this.uid++,
        kind,
        look: this.pick(counter ? CUSTOMER_LOOKS : NORMAL_LOOKS),
        fills: counter ? this.counterOrder(n) : this.kioskOrder(n),
        need: w.orders[i % w.orders.length],
        done: 0,
        patienceMax: counter ? Math.round(patience * SPECIAL_PATIENCE) : patience,
        hpMax: counter ? CUSTOMER_HP.special : CUSTOMER_HP.normal,
        hp: counter ? CUSTOMER_HP.special : CUSTOMER_HP.normal,
        seed: this.uid * 7 + i,
        enteredAt: 0,
        deadline: 0,
        slot: -1,
        state: 'pending', // pending | walkin | wait | happy | angry
        since: 0,
      };
    });

    return { list, gap, patience, count, specials };
  }

  startWave(n: number): WaveEvent {
    const built = this.buildWave(n);
    this.wave = n;
    this.phase = 'wave';
    this.pending = built.list;
    this.gap = built.gap;
    this.nextSpawnAt = this.clock();
    const unlocked = unlockAt(n);
    return {
      type: 'waveStart',
      wave: n,
      total: this.totalWaves,
      count: built.count,
      specials: built.specials,
      patience: built.patience,
      rolls: built.list.reduce((s, c) => s + c.need, 0),
      unlocked,
      unlockedName: unlocked ? ITEMS[unlocked].emoji + ' ' + ITEMS[unlocked].name : null,
    };
  }

  /* ──────────────── 카운터 자리 ────────────────
     일반 손님이든 진상이든 모두 카운터에 줄을 선다.
     ──────────────────────────────────────────────────────────── */
  freeSlot(): number {
    const used = new Set(this.active.map((c) => c.slot));
    for (let i = 0; i < QUEUE_SLOTS; i++) if (!used.has(i)) return i;
    return -1;
  }

  /* ──────────────── 매 틱 ──────────────── */
  tick(): WaveEvent[] {
    const events: WaveEvent[] = [];
    if (this.phase === 'over') return events;
    const t = this.clock();

    if (this.phase === 'prep') {
      if (t >= this.phaseEndsAt) events.push(this.startWave(this.wave + 1));
      return events;
    }

    /* 손님 입장 — 모두 문으로 걸어 들어와 카운터에 선다 */
    while (this.pending.length && t >= this.nextSpawnAt) {
      const slot = this.freeSlot();
      if (slot < 0) break; // 카운터가 꽉 찼으면 밖에서 기다린다
      const c = this.pending.shift()!;
      c.slot = slot;
      c.state = 'walkin';
      c.since = t;
      this.active.push(c);
      this.nextSpawnAt = t + this.gap * 1000;
      events.push({ type: 'spawn', customer: this.pub(c) });
    }

    /* 자리에 서면 인내심이 돌기 시작한다 */
    for (const c of this.active) {
      if (c.state === 'walkin' && t - c.since >= WALK_IN_MS) {
        c.state = 'wait';
        c.enteredAt = t;
        c.deadline = t + c.patienceMax * 1000;
      }
    }

    /* 인내심 0 → 돌아간다 */
    for (const c of this.active) {
      if (c.state === 'wait' && t >= c.deadline) {
        const counter = c.kind === KIND.COUNTER;
        c.state = 'angry';
        c.since = t;
        this.angry++;
        this.score += SCORE.leave;
        const loss = counter ? SCORE.repLossSpecial : SCORE.repLoss;
        this.reputation = Math.max(0, this.reputation - loss);
        events.push({
          type: 'leave',
          customer: this.pub(c),
          msg:
            c.look.emoji +
            ' ' +
            c.look.name +
            (counter ? ' 이(가) 화내며 나갔습니다!' : ' 이(가) 그냥 나갔습니다.') +
            ' (평판 -' +
            loss +
            ')',
        });
      }
    }

    /* 정리 — 나가는 연출 시간을 준다 */
    const before = this.active.length;
    this.active = this.active.filter((c) => {
      if (c.state !== 'happy' && c.state !== 'angry' && c.state !== 'kicked') return true;
      return t - c.since < WALK_OUT_MS;
    });
    if (this.active.length !== before) events.push({ type: 'refresh' });

    if (this.reputation <= 0) {
      this.phase = 'over';
      this.result = 'defeat';
      events.push({ type: 'gameOver', result: 'defeat' });
      return events;
    }

    if (!this.pending.length && !this.active.length) {
      // 클리어 자체에는 점수를 주지 않는다 — 점수는 손님을 만족시켜야만 나온다
      const prev = this.log[this.log.length - 1];
      const happy = this.happy - (prev ? prev.happy : 0);
      const angry = this.angry - (prev ? prev.angry : 0);
      this.log.push({ wave: this.wave, happy: this.happy, angry: this.angry, score: this.score });

      const victory = this.wave >= this.totalWaves;
      events.push({ type: 'waveClear', wave: this.wave, happy, angry, victory });

      if (victory) {
        this.phase = 'over';
        this.result = 'victory';
        events.push({ type: 'gameOver', result: 'victory' });
      } else {
        this.phase = 'prep';
        this.phaseEndsAt = this.clock() + PREP_BETWEEN * 1000;
      }
    }
    return events;
  }

  /* ────────────────────────────────────────────────────────────
     서빙 — 자동 최적 매칭
     손에 든 김밥의 속재료 조합과 가장 잘 맞는 주문으로 나간다.
     맞춤도가 같으면 인내심이 적게 남은 쪽 먼저.
     ──────────────────────────────────────────────────────────── */
  bestMatch(rollFills: Fill[] | null | undefined): Customer | null {
    let best: Customer | null = null;
    let bestScore = -1;
    for (const c of this.active) {
      if (c.state !== 'wait' || c.done >= c.need) continue;
      const s = matchScore(c.fills, rollFills);
      if (
        s > bestScore + 1e-9 ||
        (Math.abs(s - bestScore) < 1e-9 && best && c.deadline < best.deadline)
      ) {
        best = c;
        bestScore = s;
      }
    }
    return best;
  }

  /** 다음에 서빙될 대상 (HUD 표시용) — 김밥이 없으면 가장 급한 주문 */
  nextTarget(rollFills?: Fill[] | null): Customer | null {
    if (rollFills && rollFills.length) return this.bestMatch(rollFills);
    let best: Customer | null = null;
    for (const c of this.active) {
      if (c.state !== 'wait' || c.done >= c.need) continue;
      if (!best || c.deadline < best.deadline) best = c;
    }
    return best;
  }

  /**
   * 🧹 빗자루로 손님을 한 대 때린다.
   * 체력이 다 닳으면 쫓겨나며, 시간 초과로 나가는 것보다는 손해가 적다.
   */
  hit(id: string): HitResult | null {
    const c = this.active.find((x) => x.id === id && x.state === 'wait');
    if (!c) return null;
    c.hp = Math.max(0, c.hp - 1);
    if (c.hp > 0) {
      return { kicked: false, customer: this.pub(c) };
    }
    c.state = 'kicked';
    c.since = this.clock();
    this.angry++;
    this.kicked = (this.kicked || 0) + 1;
    this.score += SCORE.kick;
    this.reputation = Math.max(0, this.reputation - SCORE.repLossKick);
    return {
      kicked: true,
      customer: this.pub(c),
      msg:
        c.look.emoji +
        ' ' +
        c.look.name +
        ' 을(를) 쫓아냈습니다! (평판 -' +
        SCORE.repLossKick +
        ')',
    };
  }

  /** 지목한 손님이 지금 받을 수 있는가 */
  waitingById(id: string): Customer | null {
    return this.active.find((c) => c.id === id && c.state === 'wait' && c.done < c.need) || null;
  }

  /**
   * 김밥 한 줄을 낸다 → { ok, msg, kind, completed }
   * customerId 를 주면 그 손님에게, 안 주면 조합이 가장 잘 맞는 주문으로 나간다.
   */
  serve(rollFills: Fill[], customerId?: string): ServeResult {
    if (this.phase !== 'wave') return { ok: false, msg: '지금은 주문이 없습니다.', kind: 'bad' };
    const c = customerId ? this.waitingById(customerId) : this.bestMatch(rollFills);
    if (!c) {
      return {
        ok: false,
        msg: customerId ? '그 손님은 이미 갔습니다.' : '기다리는 주문이 없습니다.',
        kind: 'bad',
      };
    }

    const quality = servedQuality(c.fills, rollFills);
    const match = matchScore(c.fills, rollFills);
    const who = c.look.emoji + ' ' + c.look.name;

    c.done++;
    this.servedRolls++;
    this.qualitySum += quality;
    this.score += Math.round(SCORE.perRoll * (quality / 100));

    const missing = c.fills.filter((id) => !rollFills.some((f) => f.id === id));
    const note =
      match >= 0.999
        ? '주문대로!'
        : missing.length
          ? missing.map((id) => ITEMS[id].name).join('·') + ' 빠짐'
          : '재료가 더 들어감';

    if (c.done >= c.need) {
      const left = Math.max(0, (c.deadline - this.clock()) / (c.patienceMax * 1000));
      const mult = c.kind === KIND.COUNTER ? SCORE.specialBonus : 1;
      const gain = Math.round((SCORE.complete + SCORE.timeBonus * left) * (quality / 100) * mult);
      this.score += gain;
      this.happy++;
      c.state = 'happy';
      c.since = this.clock();
      return {
        ok: true,
        completed: true,
        customer: this.pub(c),
        gain,
        quality,
        msg: who + ' 완료! ' + note + ' +' + gain + '점',
        kind: match >= 0.999 ? 'good' : 'warn',
      };
    }
    return {
      ok: true,
      completed: false,
      customer: this.pub(c),
      quality,
      msg: who + ' — ' + c.done + '/' + c.need + '줄 (' + note + ')',
      kind: match >= 0.999 ? 'good' : 'warn',
    };
  }

  /* ──────────────── 스냅샷 ──────────────── */
  pub(c: Customer): CustomerView {
    return {
      id: c.id,
      kind: c.kind,
      name: c.look.name,
      emoji: c.look.emoji,
      color: c.look.color,
      fills: c.fills,
      need: c.need,
      done: c.done,
      slot: c.slot,
      state: c.state,
      since: c.since,
      seed: c.seed,
      patienceMax: c.patienceMax,
      deadline: c.deadline,
      hp: c.hp,
      hpMax: c.hpMax,
    };
  }

  nextUnlock(): { wave: number; id: ItemId; name: string } | null {
    for (let w = this.wave + 1; w <= this.totalWaves; w++) {
      const id = unlockAt(w);
      if (id) return { wave: w, id, name: ITEMS[id].emoji + ' ' + ITEMS[id].name };
    }
    return null;
  }

  snapshot(rollFills?: Fill[] | null): WaveSnapshot {
    const target = this.nextTarget(rollFills);
    return {
      now: this.clock(),
      wave: this.wave,
      totalWaves: this.totalWaves,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      waiting: this.pending.length,
      unlocked: this.available(this.wave),
      nextUnlock: this.nextUnlock(),
      customers: this.active.map((c) => this.pub(c)),
      targetId: target ? target.id : null,
      reputation: this.reputation,
      score: this.score,
      servedRolls: this.servedRolls,
      avgQuality: this.servedRolls ? Math.round(this.qualitySum / this.servedRolls) : 0,
      happy: this.happy,
      angry: this.angry,
      kicked: this.kicked || 0,
      result: this.result,
    };
  }
}
