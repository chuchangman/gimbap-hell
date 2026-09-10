import {
  BOARD_COUNT,
  BURNERS,
  COOKER_COUNT,
  FRIDGE_ITEMS,
  MAT_COUNT,
  type ItemId,
} from '@repo/game-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLegacy } from '../testing/legacy.js';
import { Kitchen } from './kitchen.js';

const legacy = await loadLegacy('kitchen.mjs');

/* 주방은 분기가 많은 상태 머신이라 손으로 쓴 사례로는 다 덮이지 않는다.
   레거시 Kitchen 과 새 Kitchen 을 같은 동작 열로 나란히 돌리고
   매 단계마다 반환값과 스냅샷 전체를 비교한다 (차분 테스트).
   시계는 가짜 타이머로 묶어 양쪽이 같은 Date.now 를 읽게 한다. */

const PLAYERS = ['p1', 'p2'];
const START = 1_700_000_000_000;

/** 재현 가능한 의사난수 — 실패하면 같은 열이 다시 나온다 */
const lcg = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const ACTIONS = [
  'fridge:take',
  'sink:put',
  'sink:rinse',
  'sink:take',
  'cooker:put',
  'cooker:take',
  'burner:put',
  'burner:take',
  'board:put',
  'board:take',
  'mat:put',
  'mat:undo',
  'mat:roll',
  'mat:take',
  'bin:drop',
  'drop',
  'broom:take',
];

/** 액션에 맞는 payload — 가끔 범위를 벗어난 값을 섞는다 */
function payloadFor(action: string, rnd: () => number): Record<string, unknown> {
  const pick = (n: number) => {
    const r = rnd();
    return r < 0.12 ? Math.floor(rnd() * (n + 3)) - 1 : Math.floor(rnd() * n);
  };
  if (action === 'fridge:take') {
    const r = rnd();
    return {
      item: r < 0.1 ? 'nope' : FRIDGE_ITEMS[Math.floor(rnd() * FRIDGE_ITEMS.length)],
    };
  }
  if (action.startsWith('cooker')) return { cooker: pick(COOKER_COUNT) };
  if (action.startsWith('burner')) return { slot: pick(BURNERS.length) };
  if (action.startsWith('board')) return { board: pick(BOARD_COUNT) };
  if (action.startsWith('mat')) return { mat: pick(MAT_COUNT) };
  if (action === 'broom:take') return { rack: pick(3) };
  return {};
}

describe('Kitchen 차분 테스트', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('무작위 동작 4천 회에서 반환값과 스냅샷이 레거시와 같다', () => {
    const mine = new Kitchen();
    const theirs = new legacy.Kitchen();
    for (const id of PLAYERS) {
      mine.join(id);
      theirs.join(id);
    }
    const rnd = lcg(20260910);
    /* 퍼즈가 실제로 무엇을 밟았는지 센다. 두 구현이 나란히 전부 거절해도
       toEqual 은 통과하므로, 열이 의미 있게 돌았다는 것부터 못 박는다. */
    const accepted = new Set<string>();
    const rejected = new Set<string>();
    const reached = new Set<string>();

    /* 무작위 열은 김밥을 못 만든다 — 밥이 나오려면 쌀·헹굼 5회·취사 10초가
       한 조립대에 정확히 모여야 하고, 무작위로는 그 정렬이 사실상 안 생긴다.
       1000 스텝마다 실제 공정 한 줄을 큐에 밀어 넣어 깊은 상태까지 밟는다.
       큐를 소비하는 동안에도 매 단계 두 구현을 그대로 비교한다. */
    const queue: [string, string, Record<string, unknown>, number][] = [];
    const enqueueRoll = () => {
      const s: [string, Record<string, unknown>, number][] = [
        ['fridge:take', { item: 'rice' }, 0],
        ['sink:put', {}, 0],
        ...Array.from(
          { length: 5 },
          () => ['sink:rinse', {}, 0] as [string, Record<string, unknown>, number],
        ),
        ['sink:take', {}, 0],
        ['cooker:put', { cooker: 0 }, 10_000],
        ['fridge:take', { item: 'gim' }, 0],
        ['mat:put', { mat: 0 }, 0],
        ['cooker:take', { cooker: 0 }, 0],
        ['mat:put', { mat: 0 }, 0],
        ['fridge:take', { item: 'crab' }, 0],
        ['mat:put', { mat: 0 }, 0],
        ['mat:roll', { mat: 0 }, 3_000],
        ['mat:take', { mat: 0 }, 0],
        ['board:put', { board: 0 }, 3_000],
        ['board:take', { board: 0 }, 0],
        ['bin:drop', {}, 0],
      ];
      for (const [a, pl, wait] of s) queue.push(['p1', a, pl, wait]);
    };

    for (let step = 0; step < 4000; step++) {
      if (step % 1000 === 0) enqueueRoll();
      const scripted = queue.shift();
      const pid = scripted ? scripted[0] : PLAYERS[Math.floor(rnd() * PLAYERS.length)];
      const action = scripted ? scripted[1] : ACTIONS[Math.floor(rnd() * ACTIONS.length)];
      const payload = scripted ? scripted[2] : payloadFor(action, rnd);

      const a = mine.act(pid, action, payload);
      const b = theirs.act(pid, action, payload);
      const where = 'step ' + step + ' ' + pid + ' ' + action + ' ' + JSON.stringify(payload);
      expect(a, where).toEqual(b);
      expect(mine.snapshot(), where + ' snapshot').toEqual(theirs.snapshot());
      if (a.ok) accepted.add(action);
      else rejected.add(action);
      const snap = mine.snapshot();
      if (snap.cookers.some((c) => c.state === 'cooking')) reached.add('cooking');
      if (snap.cookers.some((c) => c.state === 'ready')) reached.add('riceReady');
      if (snap.burners.some(Boolean)) reached.add('burner');
      if (snap.boards.some(Boolean)) reached.add('board');
      if (snap.mats.some((m) => m.rolling)) reached.add('rolling');
      if (snap.mats.some((m) => m.fills.length)) reached.add('fills');
      if (snap.brooms.some(Boolean)) reached.add('broom');

      if (scripted && scripted[3]) {
        vi.advanceTimersByTime(scripted[3]);
        expect(mine.tick(), where + ' scripted tick').toEqual(theirs.tick());
      }
      // 시간을 흘려 취사·조리·말기 완료를 밟는다
      if (!scripted && rnd() < 0.3) {
        vi.advanceTimersByTime(Math.floor(rnd() * 4000));
        expect(mine.tick(), where + ' tick').toEqual(theirs.tick());
        expect(mine.snapshot(), where + ' tick snapshot').toEqual(theirs.snapshot());
      }
      // 일시정지 후 재개 — 진행 중인 공정의 기준 시각을 뒤로 민다
      if (!scripted && rnd() < 0.05) {
        const ms = Math.floor(rnd() * 5000);
        mine.shiftTime(ms);
        theirs.shiftTime(ms);
        expect(mine.snapshot(), where + ' shiftTime').toEqual(theirs.snapshot());
      }
    }
    expect(mine.uid).toBe(theirs.uid);

    // 17개 액션 전부가 최소 한 번은 성공하고 한 번은 거절돼야 한다.
    // (mat:roll 처럼 조건이 까다로운 것도 4천 회면 반드시 밟힌다)
    expect([...accepted].sort()).toEqual([...ACTIONS].sort());
    expect([...rejected].sort()).toEqual([...ACTIONS].sort());
    // 주요 상태가 전부 등장했는지
    expect([...reached].sort()).toEqual([
      'board',
      'broom',
      'burner',
      'cooking',
      'fills',
      'riceReady',
      'rolling',
    ]);
    expect(mine.uid).toBeGreaterThan(200);
  });

  it('입·퇴장과 빗자루 반납이 레거시와 같다', () => {
    const mine = new Kitchen();
    const theirs = new legacy.Kitchen();
    for (const id of [...PLAYERS, 'p3']) {
      mine.join(id);
      theirs.join(id);
    }
    for (const rack of [0, 1, 2]) {
      expect(mine.act('p1', 'broom:take', { rack })).toEqual(
        theirs.act('p1', 'broom:take', { rack }),
      );
    }
    expect(mine.hasBroom('p1')).toBe(theirs.hasBroom('p1'));
    expect(mine.dropFor('p1')).toEqual(theirs.dropFor('p1'));
    expect(mine.snapshot()).toEqual(theirs.snapshot());

    // 빗자루를 든 채로 나가면 거치대가 비어야 한다
    expect(mine.act('p2', 'broom:take', { rack: 1 })).toEqual(
      theirs.act('p2', 'broom:take', { rack: 1 }),
    );
    mine.leave('p2');
    theirs.leave('p2');
    expect(mine.snapshot()).toEqual(theirs.snapshot());

    // 방에 없는 사람의 동작은 거절된다
    expect(mine.act('p2', 'sink:rinse', {})).toEqual(theirs.act('p2', 'sink:rinse', {}));
  });
});

describe('Kitchen 실제 공정', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 한 줄을 끝까지 만들어 손에 완성 김밥을 남긴다 */
  const buildOneRoll = (k: Kitchen | ReturnType<typeof makeLegacy>) => {
    const steps: [string, Record<string, unknown>, number][] = [
      ['fridge:take', { item: 'rice' }, 0],
      ['sink:put', {}, 0],
      ['sink:rinse', {}, 0],
      ['sink:rinse', {}, 0],
      ['sink:rinse', {}, 0],
      ['sink:rinse', {}, 0],
      ['sink:rinse', {}, 0],
      ['sink:take', {}, 0],
      ['cooker:put', { cooker: 0 }, 10_000],
      ['cooker:take', { cooker: 0 }, 0],
      ['mat:put', { mat: 0 }, 0], // 밥 — 김이 없어 거절된다
      ['drop', {}, 0],
      ['fridge:take', { item: 'gim' }, 0],
      ['mat:put', { mat: 0 }, 0],
      ['cooker:take', { cooker: 0 }, 0],
      ['mat:put', { mat: 0 }, 0],
      ['fridge:take', { item: 'ham' }, 0],
      ['burner:put', { slot: 1 }, 5_000],
      ['burner:take', { slot: 1 }, 0],
      ['mat:put', { mat: 0 }, 0],
      ['mat:roll', { mat: 0 }, 3_000],
      ['mat:take', { mat: 0 }, 0],
      ['board:put', { board: 0 }, 3_000],
      ['board:take', { board: 0 }, 0],
    ];
    const out: unknown[] = [];
    for (const [action, payload, wait] of steps) {
      out.push(k.act('p1', action, payload));
      if (wait) vi.advanceTimersByTime(wait);
      out.push(k.tick());
    }
    return out;
  };

  const makeLegacy = () => new legacy.Kitchen();

  it('쌀 → 밥 → 김밥 한 줄 공정이 레거시와 한 단계도 다르지 않다', () => {
    const mine = new Kitchen();
    mine.join('p1');
    const mineLog = buildOneRoll(mine);
    const mineSnap = mine.snapshot();
    const mineHand = mine.hand('p1');

    vi.setSystemTime(START);
    const theirs = makeLegacy();
    theirs.join('p1');
    const theirLog = buildOneRoll(theirs);

    // 두 구현이 나란히 실패해도 toEqual 은 통과한다. 공정이 실제로
    // 끝났는지부터 못 박는다 — 손에 완성 김밥이 있고 속에 햄이 들어 있어야 한다.
    expect(mineHand).toMatchObject({ id: 'gimbap', stage: 'done' });
    expect(mineHand?.fills?.map((f) => f.id)).toEqual(['ham']);
    expect(mineSnap.mats[0]).toEqual({
      gim: false,
      bap: false,
      fills: [],
      rolling: false,
      rollAt: 0,
    });
    // 밥은 5인분 나와 한 그릇만 썼으므로 3인분이 남아 있다 (거절된 mat:put 이 하나 있었다)
    expect(mineSnap.cookers[0]).toMatchObject({ state: 'ready', servings: 3 });
    expect(mineSnap.mess).toBe(1); // 김 없이 올리려다 실패해 바닥에 버린 밥 한 그릇

    expect(mineLog).toEqual(theirLog);
    expect(mineSnap).toEqual(theirs.snapshot());
    expect(mineHand).toEqual(theirs.hand('p1'));
    expect(mine.takeGimbap('p1')).toEqual(theirs.takeGimbap('p1'));
  });

  it('불 조절 품질과 탄 재료 처리가 레거시와 같다', () => {
    // ham: target 5초 · tol 3.2 · burn 11초
    for (const wait of [0, 1_000, 3_000, 5_000, 6_000, 8_000, 10_900, 11_000, 20_000]) {
      vi.setSystemTime(START);
      const mine = new Kitchen();
      mine.join('p1');
      vi.setSystemTime(START);
      const theirs = makeLegacy();
      theirs.join('p1');

      for (const k of [mine, theirs]) {
        vi.setSystemTime(START);
        k.act('p1', 'fridge:take', { item: 'ham' });
        k.act('p1', 'burner:put', { slot: 1 });
        vi.advanceTimersByTime(wait);
      }
      // 두 구현이 같은 시각을 보도록 각각 같은 지점에서 꺼낸다
      vi.setSystemTime(START + wait);
      const a = mine.act('p1', 'burner:take', { slot: 1 });
      const b = theirs.act('p1', 'burner:take', { slot: 1 });
      expect(a, 'wait=' + wait).toEqual(b);
      expect(mine.hand('p1'), 'wait=' + wait + ' hand').toEqual(theirs.hand('p1'));
    }
  });

  it('조립대 되돌리기가 넣은 역순으로 레거시와 같이 돌려준다', () => {
    const run = (k: Kitchen | ReturnType<typeof makeLegacy>) => {
      const log: unknown[] = [];
      const put = (item: ItemId) => {
        log.push(k.act('p1', 'fridge:take', { item }));
        log.push(k.act('p1', 'mat:put', { mat: 1 }));
      };
      put('gim');
      log.push(k.act('p1', 'fridge:take', { item: 'rice' }));
      log.push(k.act('p1', 'mat:put', { mat: 1 })); // 씻지 않은 쌀은 못 들어간다
      log.push(k.act('p1', 'drop', {}));
      put('crab'); // 손질 불필요 — 바로 들어간다
      log.push(k.act('p1', 'mat:put', { mat: 1 }));
      for (let i = 0; i < 5; i++) log.push(k.act('p1', 'mat:undo', { mat: 1 }));
      return log;
    };
    vi.setSystemTime(START);
    const mine = new Kitchen();
    mine.join('p1');
    const mineLog = run(mine);
    const mineSnap = mine.snapshot();

    vi.setSystemTime(START);
    const theirs = makeLegacy();
    theirs.join('p1');
    expect(mineLog).toEqual(run(theirs));
    expect(mineSnap).toEqual(theirs.snapshot());
  });
});
