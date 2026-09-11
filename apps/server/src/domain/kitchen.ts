/* ────────────────────────────────────────────────────────────
   주방 상태 머신 (서버 권위)
   공정 규칙은 전부 여기 있다. 클라이언트는 같은 규칙으로 안내 문구만 만들고,
   실제 판정은 항상 이쪽에서 다시 한다.
   시간 값(at)은 전부 밀리초 epoch — 클라이언트가 서버 시계에 맞춰 계산한다.
   ──────────────────────────────────────────────────────────── */
import {
  BOARD_COUNT,
  BROOM_COUNT,
  BURNERS,
  COOKER_COUNT,
  cookQuality,
  itemLabel,
  ITEMS,
  MAT_COUNT,
  TIME,
  type HeldItem,
  type ItemDef,
  type ItemId,
} from '@repo/game-core';
import type {
  ActionResult,
  BoardCell,
  BurnerCell,
  CookerState,
  KitchenActionPayload,
  KitchenSnapshot,
  MatState,
} from '@repo/types';
import { validKitchenAction } from '../common/protocol.js';

export const nowMs = (): number => Date.now();

const ok = (msg?: string, kind?: 'good' | 'warn' | 'bad'): ActionResult => ({
  ok: true,
  msg,
  kind: kind || 'good',
});
const no = (msg: string): ActionResult => ({ ok: false, msg, kind: 'bad' });

/** 손질이 필요 없는 재료인가 (맛살) */
const isReadyToUse = (id: string): boolean =>
  !!(ITEMS[id as ItemId] && ITEMS[id as ItemId].fill && !ITEMS[id as ItemId].station);

export interface BurnerInfo {
  cell: BurnerCell;
  def: ItemDef;
  el: number;
  burnt: boolean;
  q: number;
}

export interface BoardInfo {
  b: BoardCell;
  el: number;
  done: boolean;
}

export class Kitchen {
  uid = 1;
  hands!: Map<string, HeldItem | null>;
  sink!: { rinses: number } | null;
  cookers!: CookerState[];
  burners!: (BurnerCell | null)[];
  boards!: (BoardCell | null)[];
  mats!: MatState[];
  brooms!: (string | null)[];
  mess!: number;
  wasted!: number;

  /** 시계를 주입할 수 있게 둔다. 기본값은 실제 시각이다. */
  constructor(private readonly clock: () => number = nowMs) {
    this.reset();
  }

  private secSince(at: number): number {
    return (this.clock() - at) / 1000;
  }

  reset(): void {
    this.hands = new Map(); // playerId → item | null
    this.sink = null; // { rinses }
    this.cookers = Array.from({ length: COOKER_COUNT }, () => ({
      state: 'empty' as const,
      at: 0,
      servings: 0,
    }));
    this.burners = BURNERS.map(() => null); // { id, at }
    this.boards = Array.from({ length: BOARD_COUNT }, () => null);
    this.mats = Array.from({ length: MAT_COUNT }, () => this.emptyMat());
    this.brooms = Array.from({ length: BROOM_COUNT }, () => null); // 거치대 → 든 사람 id
    this.mess = 0; // 바닥에 버린 횟수
    this.wasted = 0;
  }

  /** 일시정지한 실제 시간만큼 진행 중인 공정의 기준 시각을 뒤로 민다. */
  shiftTime(ms: number): void {
    if (!(ms > 0)) return;
    for (const c of this.cookers) if (c.state === 'cooking' && c.at) c.at += ms;
    for (const cell of this.burners) if (cell && cell.at) cell.at += ms;
    for (const board of this.boards) if (board && board.at) board.at += ms;
    for (const mat of this.mats) if (mat.rolling && mat.rollAt) mat.rollAt += ms;
  }

  emptyMat(): MatState {
    return { gim: false, bap: false, fills: [], rolling: false, rollAt: 0 };
  }

  mk(id: ItemId, stage: HeldItem['stage'], quality?: number): HeldItem {
    return { uid: this.uid++, id, stage, quality: quality === undefined ? 100 : quality };
  }

  /* ──────────────── 플레이어 ──────────────── */
  join(id: string): void {
    if (!this.hands.has(id)) this.hands.set(id, null);
  }

  leave(id: string): void {
    this.hands.delete(id);
    for (let i = 0; i < this.brooms.length; i++) if (this.brooms[i] === id) this.brooms[i] = null;
  }

  hand(id: string): HeldItem | null {
    return this.hands.get(id) || null;
  }

  setHand(id: string, item: HeldItem | null): void {
    this.hands.set(id, item || null);
  }

  /** 빗자루를 들고 있는가 (들면 재료를 못 든다) */
  hasBroom(id: string): boolean {
    const h = this.hand(id);
    return !!h && h.id === 'broom';
  }

  /** 빗자루에 맞았다 — 들고 있던 것을 놓친다 (빗자루면 제자리로) */
  dropFor(id: string): HeldItem | null {
    const h = this.hand(id);
    if (!h) return null;
    if (h.id === 'broom' && this.brooms[h.rack!] === id) this.brooms[h.rack!] = null;
    this.setHand(id, null);
    return h;
  }

  /* ──────────────── 조회 ──────────────── */
  burnerInfo(slot: number): BurnerInfo | null {
    const cell = this.burners[slot];
    if (!cell) return null;
    const def = ITEMS[cell.id];
    const el = this.secSince(cell.at);
    return { cell, def, el, burnt: el >= def.burn!, q: cookQuality(def, el) };
  }

  boardInfo(i: number): BoardInfo | null {
    const b = this.boards[i];
    if (!b) return null;
    const el = this.secSince(b.at);
    return { b, el, done: el >= b.dur };
  }

  rollDone(m: MatState): boolean {
    return m.rolling && this.secSince(m.rollAt) >= TIME.roll;
  }

  /** 매 틱 — 취사 완료 처리. 완료된 게 있으면 알림 문구를 돌려준다 */
  tick(): { msg: string; kind: 'good' | 'warn' | 'bad' }[] {
    const notes: { msg: string; kind: 'good' | 'warn' | 'bad' }[] = [];
    this.cookers.forEach((c, i) => {
      if (c.state === 'cooking' && this.secSince(c.at) >= TIME.riceCook) {
        c.state = 'ready';
        c.servings = TIME.riceYield;
        notes.push({
          msg: '밥솥 ' + (i + 1) + ' — 밥이 다 됐습니다! (' + TIME.riceYield + '인분)',
          kind: 'good',
        });
      }
    });
    return notes;
  }

  /** 서빙 — 손에 든 완성 김밥을 꺼내온다 (손님 처리는 Room 이 한다) */
  takeGimbap(pid: string): HeldItem | null {
    const h = this.hand(pid);
    if (!h || h.id !== 'gimbap') return null;
    this.setHand(pid, null);
    return h;
  }

  /* ──────────────── 클라이언트로 보낼 스냅샷 ──────────────── */
  snapshot(): KitchenSnapshot {
    return {
      now: this.clock(),
      hands: [...this.hands.entries()].map(([id, holding]) => ({ id, holding })),
      sink: this.sink,
      cookers: this.cookers,
      burners: this.burners,
      boards: this.boards,
      mats: this.mats,
      brooms: this.brooms,
      mess: this.mess,
      wasted: this.wasted,
    };
  }

  /* ──────────────── 액션 ──────────────── */
  act(pid: string, action: string, p?: KitchenActionPayload): ActionResult {
    return this.runAction(pid, action, p || {});
  }

  private runAction(pid: string, action: string, p: KitchenActionPayload): ActionResult {
    if (!this.hands.has(pid)) return no('방에 없습니다.');
    if (!validKitchenAction(action, p)) return no('올바르지 않은 동작입니다.');
    const h = this.hand(pid);

    switch (action) {
      case 'fridge:take':
        return this.fridgeTake(pid, h, p);
      case 'sink:put':
      case 'sink:rinse':
      case 'sink:take':
        return this.sinkAction(pid, h, action);
      case 'cooker:put':
      case 'cooker:take':
        return this.cookerAction(pid, h, action, p);
      case 'burner:put':
      case 'burner:take':
        return this.burnerAction(pid, h, action, p);
      case 'board:put':
      case 'board:take':
        return this.boardAction(pid, h, action, p);
      case 'mat:put':
      case 'mat:undo':
      case 'mat:roll':
      case 'mat:take':
        return this.matAction(pid, h, action, p);
      case 'bin:drop':
        return this.binDrop(pid, h);
      case 'drop':
        return this.dropAnywhere(pid, h);
      case 'broom:take':
        return this.broomTake(pid, h, p);
    }
    return no('알 수 없는 동작입니다.');
  }

  /* 🧊 냉장고 */
  private fridgeTake(pid: string, h: HeldItem | null, p: KitchenActionPayload): ActionResult {
    if (h) return no('손이 차 있습니다. (Q: 버리기)');
    const def = ITEMS[p.item as ItemId];
    if (!def || !def.fridge) return no('그건 냉장고에 없습니다.');
    // 맛살처럼 손질이 필요 없는 재료는 집는 순간 바로 쓸 수 있다
    this.setHand(pid, this.mk(p.item as ItemId, isReadyToUse(p.item as string) ? 'done' : 'raw'));
    return ok();
  }

  /* 🚰 싱크대 */
  private sinkAction(pid: string, h: HeldItem | null, action: string): ActionResult {
    if (action === 'sink:put') {
      if (this.sink) return no('싱크대에 이미 쌀이 있습니다.');
      if (!h || h.id !== 'rice' || h.stage !== 'raw') return no('쌀을 들고 오세요.');
      this.sink = { rinses: 0 };
      this.setHand(pid, null);
      return ok();
    }
    if (action === 'sink:rinse') {
      if (!this.sink) return no('씻을 쌀이 없습니다.');
      if (this.sink.rinses >= TIME.riceRinse) return no('이미 다 씻었습니다.');
      this.sink.rinses++;
      if (this.sink.rinses >= TIME.riceRinse) return ok('쌀을 다 씻었습니다. 밥솥에 안치세요.');
      return ok();
    }
    if (h) return no('손이 차 있습니다.');
    if (!this.sink || this.sink.rinses < TIME.riceRinse) return no('아직 덜 씻었습니다.');
    this.sink = null;
    this.setHand(pid, this.mk('rice', 'washed'));
    return ok();
  }

  /* 🍚 밥솥 */
  private cookerAction(
    pid: string,
    h: HeldItem | null,
    action: string,
    p: KitchenActionPayload,
  ): ActionResult {
    const c = this.cookers[p.cooker!];
    if (!c) return no('그런 밥솥이 없습니다.');
    if (action === 'cooker:put') {
      if (!h || h.id !== 'rice' || h.stage !== 'washed') return no('씻은 쌀을 들고 오세요.');
      if (c.state !== 'empty') return no('밥솥이 비어 있지 않습니다.');
      c.state = 'cooking';
      c.at = this.clock();
      c.servings = 0;
      this.setHand(pid, null);
      return ok('취사 시작 — ' + TIME.riceCook + '초');
    }
    if (h) return no('손이 차 있습니다.');
    if (c.state !== 'ready' || c.servings <= 0) return no('아직 밥이 없습니다.');
    c.servings--;
    if (c.servings === 0) c.state = 'empty';
    this.setHand(pid, this.mk('bap', 'done'));
    return ok();
  }

  /* 🔥 가스렌지 */
  private burnerAction(
    pid: string,
    h: HeldItem | null,
    action: string,
    p: KitchenActionPayload,
  ): ActionResult {
    if (action === 'burner:put') {
      const b = BURNERS[p.slot!];
      if (!b) return no('그런 화구가 없습니다.');
      if (this.burners[p.slot!]) return no('이미 조리 중입니다.');
      if (!h || h.stage !== 'raw') return no('생재료를 들고 오세요.');
      const def = ITEMS[h.id];
      if (def.station !== b.kind) {
        const where =
          def.station === 'pot'
            ? '냄비'
            : def.station === 'pan'
              ? '프라이팬'
              : def.station === 'board'
                ? '도마'
                : '조립대';
        return no(def.name + ' 은(는) ' + where + ' 에 올려야 합니다.');
      }
      this.burners[p.slot!] = { id: h.id, at: this.clock() };
      this.setHand(pid, null);
      return ok();
    }
    if (h) return no('손이 차 있습니다.');
    const info = this.burnerInfo(p.slot!);
    if (!info) return no('화구가 비어 있습니다.');
    this.burners[p.slot!] = null;
    if (info.burnt) {
      this.setHand(pid, this.mk(info.cell.id, 'burnt', 0));
      return ok(ITEMS[info.cell.id].name + ' 이(가) 못 쓰게 됐습니다. 음쓰통에 버리세요.', 'bad');
    }
    this.setHand(pid, this.mk(info.cell.id, 'done', info.q));
    return ok();
  }

  /* 🔪 도마 */
  private boardAction(
    pid: string,
    h: HeldItem | null,
    action: string,
    p: KitchenActionPayload,
  ): ActionResult {
    if (action === 'board:put') {
      if (this.boards[p.board!] === undefined) return no('그런 도마가 없습니다.');
      if (this.boards[p.board!]) return no('도마가 차 있습니다.');
      if (!h) return no('썰 재료를 들고 오세요.');
      const def = ITEMS[h.id];
      if (def && def.station === 'board' && h.stage === 'raw') {
        this.boards[p.board!] = { id: h.id, at: this.clock(), dur: def.dur!, quality: 100 };
      } else if (h.id === 'roll') {
        this.boards[p.board!] = {
          id: 'roll',
          at: this.clock(),
          dur: TIME.cutRoll,
          quality: h.quality,
          fills: h.fills || [],
        };
      } else {
        return no(itemLabel(h) + ' 은(는) 도마에서 할 게 없습니다.');
      }
      this.setHand(pid, null);
      return ok();
    }
    if (h) return no('손이 차 있습니다.');
    const info = this.boardInfo(p.board!);
    if (!info) return no('도마가 비어 있습니다.');
    if (!info.done) return no('아직 다 안 썰었습니다.');
    const b = this.boards[p.board!]!;
    this.boards[p.board!] = null;
    if (b.id === 'roll') {
      const g = this.mk('gimbap', 'done', b.quality);
      g.fills = b.fills || [];
      this.setHand(pid, g);
    } else {
      this.setHand(pid, this.mk(b.id, 'done', 100));
    }
    return ok();
  }

  /* 🍙 조립대 */
  private matAction(
    pid: string,
    h: HeldItem | null,
    action: string,
    p: KitchenActionPayload,
  ): ActionResult {
    const m = this.mats[p.mat!];
    if (!m) return no('그런 조립대가 없습니다.');

    if (action === 'mat:put') {
      if (m.rolling) return no('말고 있는 중입니다.');
      if (!h) return no('재료를 들고 오세요.');

      if (h.id === 'gim') {
        if (m.gim) return no('김이 이미 깔려 있습니다.');
        m.gim = true;
        this.setHand(pid, null);
        return ok();
      }
      if (!m.gim) return no('김부터 깔아야 합니다.');
      if (h.id === 'bap') {
        if (m.bap) return no('밥이 이미 올라가 있습니다.');
        m.bap = true;
        this.setHand(pid, null);
        return ok();
      }
      if (!m.bap) return no('김 위에 밥부터 펴세요.');

      const def = ITEMS[h.id];
      if (!def || !def.fill) return no(itemLabel(h) + ' 은(는) 김밥에 넣을 수 없습니다.');
      if (h.stage === 'raw') return no('손질하지 않은 ' + def.name + ' 은(는) 넣을 수 없습니다.');
      if (h.stage === 'burnt')
        return no('못 쓰게 된 ' + def.name + ' 은(는) 넣을 수 없습니다. 음쓰통으로!');
      if (m.fills.some((f) => f.id === h.id)) return no(def.name + ' 은(는) 이미 들어갔습니다.');
      m.fills.push({ id: h.id, quality: h.quality });
      this.setHand(pid, null);
      return ok();
    }

    if (action === 'mat:undo') {
      if (h) return no('손이 차 있습니다.');
      if (m.rolling) return no('말고 있는 중입니다.');
      if (m.fills.length) {
        const f = m.fills.pop()!;
        this.setHand(pid, this.mk(f.id, 'done', f.quality));
        return ok();
      }
      if (m.bap) {
        m.bap = false;
        this.setHand(pid, this.mk('bap', 'done'));
        return ok();
      }
      if (m.gim) {
        m.gim = false;
        this.setHand(pid, this.mk('gim', 'raw'));
        return ok();
      }
      return no('조립대가 비어 있습니다.');
    }

    if (action === 'mat:roll') {
      if (m.rolling) return no('이미 말고 있습니다.');
      if (!m.gim || !m.bap) return no('김과 밥이 있어야 말 수 있습니다.');
      if (!m.fills.length) return no('속재료를 하나라도 넣으세요.');
      m.rolling = true;
      m.rollAt = this.clock();
      return ok();
    }

    if (h) return no('손이 차 있습니다.');
    if (!this.rollDone(m)) return no('아직 다 말지 않았습니다.');
    const roll = this.mk('roll', 'done', 100);
    roll.fills = m.fills.map((f) => ({ id: f.id, quality: f.quality }));
    this.mats[p.mat!] = this.emptyMat();
    this.setHand(pid, roll);
    return ok();
  }

  /* 🗑️ 음쓰통 */
  private binDrop(pid: string, h: HeldItem | null): ActionResult {
    if (!h) return no('손에 든 게 없습니다.');
    if (h.id === 'broom') return no('빗자루는 제자리에 두세요. (Q)');
    const nm = itemLabel(h);
    this.setHand(pid, null);
    this.wasted++;
    return ok(nm + ' 을(를) 음쓰통에 버렸습니다.', 'warn');
  }

  /* Q — 아무 데나 버리기 / 빗자루 반납 */
  private dropAnywhere(pid: string, h: HeldItem | null): ActionResult {
    if (!h) return no('손에 든 게 없습니다.');
    if (h.id === 'broom') {
      if (this.brooms[h.rack!] === pid) this.brooms[h.rack!] = null;
      this.setHand(pid, null);
      return ok('빗자루를 제자리에 두었습니다.', 'warn');
    }
    const nm = itemLabel(h);
    this.setHand(pid, null);
    this.mess++;
    this.wasted++;
    return ok(nm + ' 을(를) 바닥에 버렸습니다. 음쓰통을 쓰세요!', 'bad');
  }

  /* 🧹 빗자루 */
  private broomTake(pid: string, h: HeldItem | null, p: KitchenActionPayload): ActionResult {
    const rack = p.rack!;
    if (this.brooms[rack] === undefined) return no('그런 거치대가 없습니다.');
    if (this.brooms[rack]) return no('누가 이미 들고 갔습니다.');
    if (h) return no('손이 차 있습니다. (Q: 내려놓기)');
    this.brooms[rack] = pid;
    const b = this.mk('broom', 'done', 100);
    b.rack = rack;
    this.setHand(pid, b);
    return ok('빗자루를 들었습니다 — 좌클릭으로 후려칩니다', 'warn');
  }
}
