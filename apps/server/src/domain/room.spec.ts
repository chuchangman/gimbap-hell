import { NAME_MAX, NAME_MIN, PLAYER_LIMIT } from '@repo/game-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLegacy } from '../testing/legacy.js';
import { nameError, Room, type RoomLeaderboard } from './room.js';

const legacyRoom = await loadLegacy('room.mjs');
const legacyBoard = await loadLegacy('leaderboard.mjs');

/* Room 은 주방 · 웨이브 · 이동 · 전투 · 랭킹을 한데 묶는 조립점이다.
   두 구현에 같은 조작 열을 흘리고 매 단계 publicState · kitchenState ·
   positions · stateSignature 를 전부 비교한다.

   시계는 가짜 타이머로, performance.now 는 스파이로, 난수는 같은 씨앗의
   독립 생성기 두 개로 묶는다. 레거시 Room 은 leaderboard 모듈 싱글턴을
   직접 쓰므로, 새 Room 에도 같은 모듈을 주입해 가게 이름 정리를 일치시킨다. */

const START = 1_700_000_000_000;
const MONO_START = 5_000;

/* validateMove 는 performance.now() 를 기본 인자로 읽어 이동 토큰을 회복시킨다.
   이걸 상수로 스파이하면 elapsed 가 언제나 0이 되어 다섯 걸음 만에 속도
   제한에 걸린다 — 그리고 두 구현이 나란히 막히므로 조용히 통과해 버린다.
   가짜 타이머와 같은 양만큼 함께 전진시킨다. */
let mono = MONO_START;
const advance = (ms: number) => {
  mono += ms;
  vi.advanceTimersByTime(ms);
};

const lcg = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const board = legacyBoard as unknown as RoomLeaderboard;

/* 같은 씨앗의 독립 생성기 두 개 — 하나는 새 Room 에 주입하고 하나는
   전역 Math.random 에 꽂는다. 레거시 Room 은 WaveRunner 를 통해 전역을 쓴다.
   한 테스트에서 방을 두 개 만들면 나중 것이 전역을 다시 덮으므로,
   난수를 쓰는(= start 하는) 방은 마지막에 만들어야 한다. */
const makePair = (code: string, shop: unknown, seed: number) => {
  vi.spyOn(Math, 'random').mockImplementation(lcg(seed));
  return {
    mine: new Room(code, shop, board, () => Date.now(), lcg(seed)),
    theirs: new legacyRoom.Room(code, shop),
  };
};

/** 두 방의 관측 가능한 상태를 전부 비교한다 */
const same = (mine: Room, theirs: ReturnType<typeof makePair>['theirs'], where: string) => {
  expect(mine.publicState(), where + ' publicState').toEqual(theirs.publicState());
  expect(mine.kitchenState(), where + ' kitchenState').toEqual(theirs.kitchenState());
  expect(mine.positions(), where + ' positions').toEqual(theirs.positions());
  expect(mine.stateSignature(), where + ' signature').toBe(theirs.stateSignature());
  expect(mine.hostId, where + ' hostId').toBe(theirs.hostId);
  expect(mine.size, where + ' size').toBe(theirs.size);
  expect(mine.shop, where + ' shop').toBe(theirs.shop);
};

describe('nameError', () => {
  it('닉네임 판정이 레거시와 같다', () => {
    const ctrl = (c: number) => String.fromCharCode(c);
    const names: unknown[] = [
      undefined,
      null,
      7,
      {},
      [],
      '',
      ' ',
      'a',
      'ab',
      '  ab  ',
      '김밥',
      'x'.repeat(NAME_MAX),
      'x'.repeat(NAME_MAX + 1),
      '  ' + 'x'.repeat(NAME_MAX) + '  ',
      ...[0, 1, 9, 10, 13, 27, 31, 127].map((c) => 'ab' + ctrl(c)),
    ];
    for (const name of names) {
      expect(nameError(name), JSON.stringify(String(name))).toBe(legacyRoom.nameError(name));
    }
    expect(NAME_MIN).toBe(legacyRoom.NAME_MIN);
    expect(NAME_MAX).toBe(legacyRoom.NAME_MAX);
  });
});

describe('Room 차분 테스트', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
    mono = MONO_START;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('입장 · 정원 초과 · 자리 물려받기 · 방장 인계가 레거시와 같다', () => {
    const { mine, theirs } = makePair('ABCD', undefined, 11);
    const ids = Array.from({ length: PLAYER_LIMIT + 2 }, (_, i) => 's' + i);
    for (const id of ids) {
      const a = mine.addPlayer(id, '알바' + id, { h: 1, t: 2 });
      const b = theirs.addPlayer(id, '알바' + id, { h: 1, t: 2 });
      expect(!!a, id).toBe(!!b);
      same(mine, theirs, 'join ' + id);
    }
    // 가게 이름 확정 — 방장 닉네임을 딴다
    expect(mine.resolveShop()).toBe(theirs.resolveShop());
    same(mine, theirs, 'resolveShop');

    // 같은 id 로 다시 들어오면 기존 플레이어를 그대로 돌려준다
    expect(mine.addPlayer('s0', '다른이름')?.name).toBe(
      (theirs.addPlayer('s0', '다른이름') as { name: string } | null)?.name,
    );

    // 방장이 나가면 다음 사람이 이어받고, 빈 자리는 다음 입장자가 물려받는다
    for (const id of ['s0', 's2', 's4']) {
      mine.removePlayer(id);
      theirs.removePlayer(id);
      same(mine, theirs, 'leave ' + id);
    }
    expect(mine.freeSlot()).toBe(theirs.freeSlot());
    mine.addPlayer('late', '늦둥이');
    theirs.addPlayer('late', '늦둥이');
    same(mine, theirs, 'late join');
  });

  it('이름 없는 방과 이상한 가게 이름도 레거시와 같이 정리된다', () => {
    for (const shop of [undefined, null, '', '   ', '김밥천국', 'x'.repeat(80), 42, true]) {
      const { mine, theirs } = makePair('WXYZ', shop, 5);
      expect(mine.shop, JSON.stringify(String(shop))).toBe(theirs.shop);
      mine.addPlayer('h', '방장');
      theirs.addPlayer('h', '방장');
      expect(mine.resolveShop(), 'resolve ' + String(shop)).toBe(theirs.resolveShop());
    }
  });
});

describe('Room 실제 플레이', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
    mono = MONO_START;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** 목표 좌표까지 조금씩 걸어간다. 매 걸음 두 구현의 판정을 비교하고,
   *  실제로 도착했는지까지 단정한다 — 도착하지 못하면 그 뒤 모든 동작이
   *  양쪽에서 나란히 '가까이 오세요' 로 거절되며 조용히 통과해 버린다. */
  const walkTo = (
    mine: Room,
    theirs: ReturnType<typeof makePair>['theirs'],
    pid: string,
    tx: number,
    tz: number,
  ) => {
    for (let i = 0; i < 200; i++) {
      const p = mine.players.get(pid)!;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) break;
      const stride = Math.min(0.3, dist);
      const d = {
        x: p.x + (dx / dist) * stride,
        z: p.z + (dz / dist) * stride,
        y: 0,
        ry: Math.atan2(-dx, -dz),
        version: p.motion.version,
      };
      advance(100);
      expect(mine.move(pid, d), 'walk#' + i).toEqual(theirs.move(pid, d));
      expect(mine.positions(), 'walk#' + i + ' positions').toEqual(theirs.positions());
    }
    const p = mine.players.get(pid)!;
    expect(
      Math.hypot(tx - p.x, tz - p.z),
      '(' + tx + ',' + tz + ') 에 도착하지 못했다 — 현재 (' + p.x + ',' + p.z + ')',
    ).toBeLessThan(0.15);
  };

  /* 스폰(-1.6, 5.6)에서 왼쪽 설비로 가는 길은 조립대 테이블(x -2.6..2.6,
     z 1.75..3.45)에 막힌다. 통로 x=-4.5 로 빠져 내려간다. */
  const AISLE_X = -4.5;

  const act = (
    mine: Room,
    theirs: ReturnType<typeof makePair>['theirs'],
    pid: string,
    action: string,
    payload: Record<string, unknown>,
    label: string,
  ) => {
    const a = mine.act(pid, action, payload);
    const b = theirs.act(pid, action, payload);
    expect(a, label).toEqual(b);
    same(mine, theirs, label);
    return a;
  };

  it('영업 시작부터 김밥 한 줄 서빙까지 모든 판정이 레거시와 같다', () => {
    // 영업 전 동작이 거절되는지 볼 로비 방을 먼저 만든다 (전역 난수를 덮으므로 순서가 중요하다)
    const lobby = makePair('LOBB', undefined, 1);
    lobby.mine.addPlayer('x', 'x');
    lobby.theirs.addPlayer('x', 'x');
    expect(lobby.mine.act('x', 'sink:rinse', {})).toEqual(lobby.theirs.act('x', 'sink:rinse', {}));

    const { mine, theirs } = makePair('PLAY', '검사 김밥', 909);
    for (const id of ['p1', 'p2']) {
      mine.addPlayer(id, id);
      theirs.addPlayer(id, id);
    }
    expect(mine.start()).toBe(theirs.start());
    same(mine, theirs, 'start');

    /* 두 구현이 나란히 실패해도 toEqual 은 통과한다. 각 단계가 실제로
       의도한 결과를 냈는지 함께 못 박는다 — 걷기가 도착하지 못했으면
       전부 '가까이 오세요' 로 조용히 통과해 버린다. */

    // 멀리서 집으려 하면 거리로 거절된다
    expect(act(mine, theirs, 'p1', 'fridge:take', { item: 'rice' }, 'far fridge')).toMatchObject({
      ok: false,
      rejected: 'distance',
    });

    // 냉장고까지 걸어간다 — 조립대를 피해 통로로 돌아간다
    walkTo(mine, theirs, 'p1', AISLE_X, 5.6);
    walkTo(mine, theirs, 'p1', AISLE_X, -3.1);
    expect(act(mine, theirs, 'p1', 'fridge:take', { item: 'rice' }, 'take rice').ok).toBe(true);
    expect(mine.kitchen.hand('p1')).toMatchObject({ id: 'rice', stage: 'raw' });
    // 아직 해금되지 않은 재료는 1웨이브에서 거절된다
    expect(
      act(mine, theirs, 'p2', 'fridge:take', { item: 'fishcake' }, 'locked item'),
    ).toMatchObject({ ok: false, msg: '아직 해금되지 않은 재료입니다.' });

    // 싱크대에서 씻고
    walkTo(mine, theirs, 'p1', AISLE_X, 1.1);
    expect(act(mine, theirs, 'p1', 'sink:put', {}, 'sink put').ok).toBe(true);
    for (let i = 0; i < 6; i++) {
      const r = act(mine, theirs, 'p1', 'sink:rinse', {}, 'rinse#' + i);
      // 5번 헹구면 완료 문구가 뜨고, 6번째는 거절된다
      if (i < 4) expect(r, 'rinse#' + i).toMatchObject({ ok: true, msg: undefined });
      else if (i === 4)
        expect(r, 'rinse#4').toMatchObject({
          ok: true,
          msg: '쌀을 다 씻었습니다. 밥솥에 안치세요.',
        });
      else expect(r, 'rinse#5').toMatchObject({ ok: false, msg: '이미 다 씻었습니다.' });
    }
    expect(act(mine, theirs, 'p1', 'sink:take', {}, 'sink take').ok).toBe(true);
    expect(mine.kitchen.hand('p1')).toMatchObject({ id: 'rice', stage: 'washed' });

    // 밥솥에 안치고 취사를 기다린다
    walkTo(mine, theirs, 'p1', AISLE_X, 4);
    expect(act(mine, theirs, 'p1', 'cooker:put', { cooker: 0 }, 'cooker put')).toMatchObject({
      ok: true,
      msg: '취사 시작 — 10초',
    });
    for (let i = 0; i < 12; i++) {
      advance(1000);
      expect(mine.tick(), 'cook tick#' + i).toEqual(theirs.tick());
      same(mine, theirs, 'cook tick#' + i);
    }
    expect(mine.kitchen.cookers[0]).toMatchObject({ state: 'ready', servings: 5 });
    expect(act(mine, theirs, 'p1', 'cooker:take', { cooker: 0 }, 'cooker take').ok).toBe(true);
    expect(mine.kitchen.hand('p1')).toMatchObject({ id: 'bap', stage: 'done' });

    // 김 없이 밥을 올리려 하면 거절된다
    walkTo(mine, theirs, 'p1', -1.6, 4.0);
    expect(act(mine, theirs, 'p1', 'mat:put', { mat: 0 }, 'mat bap first')).toMatchObject({
      ok: false,
      msg: '김부터 깔아야 합니다.',
    });
    // 아무 데나 버리면 바닥이 더러워진다 (결과 점수에서 깎인다)
    expect(act(mine, theirs, 'p1', 'drop', {}, 'drop bap').ok).toBe(true);
    expect(mine.kitchen.mess).toBe(1);
  });

  it('일시정지 · 재개 · 로비 복귀가 레거시와 같다', () => {
    const { mine, theirs } = makePair('PAUS', undefined, 4321);
    for (const id of ['h', 'g']) {
      mine.addPlayer(id, id);
      theirs.addPlayer(id, id);
    }
    // 방장이 아니면 일시정지할 수 없다
    expect(mine.togglePause('g')).toEqual(theirs.togglePause('g'));
    // 영업 전에는 방장도 할 수 없다
    expect(mine.togglePause('h')).toEqual(theirs.togglePause('h'));

    mine.start();
    theirs.start();
    advance(3000);
    expect(mine.tick()).toEqual(theirs.tick());

    expect(mine.togglePause('h')).toEqual(theirs.togglePause('h'));
    same(mine, theirs, 'paused');
    // 멈춘 동안에는 동작이 거절되고 틱이 아무 일도 하지 않는다
    expect(mine.act('h', 'sink:rinse', {})).toEqual(theirs.act('h', 'sink:rinse', {}));
    advance(7000);
    expect(mine.tick()).toEqual(theirs.tick());
    same(mine, theirs, 'paused tick');

    expect(mine.togglePause('h')).toEqual(theirs.togglePause('h'));
    same(mine, theirs, 'resumed');

    mine.toLobby();
    theirs.toLobby();
    same(mine, theirs, 'lobby');
  });

  it('평판이 바닥나 폐업할 때까지 결과의 결정적 부분이 레거시와 같다', () => {
    const { mine, theirs } = makePair('OVER', '폐업 김밥', 24680);
    for (const id of ['p1', 'p2', 'p3']) {
      mine.addPlayer(id, id);
      theirs.addPlayer(id, id);
    }
    mine.start();
    theirs.start();

    let over = false;
    for (let step = 0; step < 6000 && !over; step++) {
      advance(200);
      const a = mine.tick();
      const b = theirs.tick();
      // gameOver 틱에서는 buildResult 가 랭킹에 두 번 올라가 total/board 가 갈린다.
      // 그 전까지는 스냅샷 전체를 비교하고, 결과는 아래에서 결정적 필드만 본다.
      over = a.some((e) => e.type === 'gameOver');
      if (over) {
        expect(
          a.map((e) => (e.type === 'gameOver' ? e : e)),
          'gameOver events',
        ).toEqual(b);
        break;
      }
      expect(a, 'step=' + step).toEqual(b);
      same(mine, theirs, 'step=' + step);
    }

    expect(over, '6000틱 안에 폐업해야 한다').toBe(true);
    expect(mine.phase).toBe('result');
    expect(theirs.phase).toBe('result');

    /* 랭킹에서 온 값(entryId · rank · board · total · storage)은 두 방이 각각
       add() 를 호출해 UUID 가 달라지므로 비교 대상이 아니다.
       점수 계산과 집계는 여기서 전부 못 박는다. */
    const deterministic = (r: Record<string, unknown>) => {
      const { entryId, rank, board: b, storage, ...rest } = r;
      void entryId;
      void rank;
      void b;
      void storage;
      return rest;
    };
    expect(deterministic(mine.result as unknown as Record<string, unknown>)).toEqual(
      deterministic(theirs.result as Record<string, unknown>),
    );
    expect(mine.result!.kind).toBe('defeat');
    expect(mine.result!.reputation).toBe(0);
    expect(mine.result!.angry).toBeGreaterThan(0);
    expect(mine.result!.score).toBe(Math.max(0, mine.result!.rawScore - mine.result!.messPenalty));
    // 기록은 최근 5판만 남는다
    expect(mine.history.length).toBe(1);
    expect(mine.history[0].kind).toBe('defeat');
  });
});
