import type { Fill } from '@repo/game-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLegacy } from '../testing/legacy.js';
import { WaveRunner } from './waves.js';

const legacy = await loadLegacy('waves.mjs');

/* 웨이브는 손님 생성에 난수가 들어간다. 그래서 두 구현이 난수를 **같은 순서로
   같은 횟수** 소비하는지가 곧 이식 정확도다. 같은 씨앗의 독립 생성기를 둘
   만들어 하나는 새 구현에 주입하고 하나는 전역 Math.random 에 꽂는다.
   순서가 한 번이라도 어긋나면 손님 외형·주문 조합부터 갈라진다. */

const START = 1_700_000_000_000;

const lcg = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/** 같은 씨앗의 독립 생성기 두 개 */
const pairedRandom = (seed: number) => ({ forMine: lcg(seed), forLegacy: lcg(seed) });

describe('WaveRunner 차분 테스트', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const makePair = (players: number, seed: number) => {
    const { forMine, forLegacy } = pairedRandom(seed);
    // Math 를 통째로 갈아끼우면 안 된다 — 메서드가 열거 불가라 전개(spread)로
    // 복사되지 않고 Math.max 부터 사라진다. random 만 바꿔 끼운다.
    vi.spyOn(Math, 'random').mockImplementation(forLegacy);
    const mine = new WaveRunner(players, () => Date.now(), forMine);
    const theirs = new legacy.WaveRunner(players);
    return { mine, theirs };
  };

  it('인원별로 10웨이브를 끝까지 돌려도 이벤트와 스냅샷이 레거시와 같다', () => {
    for (const players of [1, 3, 6]) {
      vi.setSystemTime(START);
      const { mine, theirs } = makePair(players, 4242 + players);
      const seen = new Set<string>();

      for (let step = 0; step < 3000; step++) {
        vi.advanceTimersByTime(200);
        const a = mine.tick();
        const b = theirs.tick();
        const where = 'players=' + players + ' step=' + step;
        expect(a, where).toEqual(b);
        expect(mine.snapshot(), where + ' snapshot').toEqual(theirs.snapshot());
        for (const e of a) seen.add(e.type);
        if (mine.phase === 'over') break;
      }

      // 끝까지 갔는지 — 양쪽이 나란히 멈춰 있어도 toEqual 은 통과한다
      expect(mine.phase, 'players=' + players).toBe('over');
      expect([...seen].sort()).toEqual([
        'gameOver',
        'leave',
        'refresh',
        'spawn',
        'waveClear',
        'waveStart',
      ]);
      expect(mine.result).toBe(theirs.result);
      expect(mine.angry).toBeGreaterThan(0);
    }
  });
});

describe('WaveRunner 서빙과 타격', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const makePair = (players: number, seed: number) => {
    const { forMine, forLegacy } = pairedRandom(seed);
    vi.spyOn(Math, 'random').mockImplementation(forLegacy);
    const mine = new WaveRunner(players, () => Date.now(), forMine);
    const theirs = new legacy.WaveRunner(players);
    return { mine, theirs };
  };

  /** 주문대로 만든 김밥 */
  const exactRoll = (fills: string[]): Fill[] => fills.map((id) => ({ id, quality: 100 }) as Fill);

  it('주문대로 · 재료 빠짐 · 더 넣음 세 경우의 점수와 문구가 레거시와 같다', () => {
    const { mine, theirs } = makePair(3, 777);
    const seen = new Set<string>();

    // 서빙하면 평판이 버티므로 10웨이브를 다 도는 데 게임 시간 20분이 넘게 걸린다.
    for (let step = 0; step < 12000; step++) {
      vi.advanceTimersByTime(200);
      const a = mine.tick();
      const b = theirs.tick();
      const where = 'step=' + step;
      expect(a, where).toEqual(b);
      for (const e of a) seen.add(e.type);

      /* 서빙과 타격은 배타적으로 돈다. 서빙을 먼저 하면 주문이 1줄이라
         손님이 그 자리에서 'happy' 가 되어 때릴 대상이 남지 않는다. */
      const hitStep = step % 37 === 0;
      const waiting = mine.active.filter((c) => c.state === 'wait' && c.done < c.need);
      if (!hitStep && waiting.length) {
        const target = waiting[0];
        const mode = step % 4;
        const roll =
          mode === 0
            ? exactRoll(target.fills) // 주문대로
            : mode === 1
              ? exactRoll(target.fills.slice(1)) // 하나 빠짐
              : mode === 2
                ? exactRoll([...target.fills, 'egg']) // 쓸데없이 더
                : exactRoll(target.fills);
        const byId = mode === 3 ? target.id : undefined;
        expect(mine.serve(roll, byId), where + ' serve').toEqual(theirs.serve(roll, byId));
        expect(mine.snapshot(roll), where + ' snapshot').toEqual(theirs.snapshot(roll));
        seen.add('served');
      }

      /* 가끔 빗자루로 후려친다. 한 대씩만 때리면 서빙이 먼저 끝나 버려서
         체력이 0이 되는 격퇴 경로(점수 -25 · 평판 -6)를 전혀 밟지 못한다.
         같은 손님을 체력 이상으로 연속 때려 쫓아내는 데까지 간다. */
      if (hitStep) {
        const victim = mine.active.find((c) => c.state === 'wait');
        if (victim) {
          for (let i = 0; i < 6; i++) {
            expect(mine.hit(victim.id), where + ' hit#' + i).toEqual(theirs.hit(victim.id));
          }
          seen.add('hit');
        }
      }

      expect(mine.snapshot(), where + ' snapshot(no roll)').toEqual(theirs.snapshot());
      if (mine.phase === 'over') break;
    }

    expect(mine.phase).toBe('over');
    expect(mine.result).toBe(theirs.result);
    // 실제로 만족·격퇴가 일어났는지 — 나란히 아무 일도 없어도 toEqual 은 통과한다
    expect(mine.happy).toBeGreaterThan(0);
    expect(mine.kicked).toBeGreaterThan(0);
    expect(mine.servedRolls).toBeGreaterThan(0);
    expect([...seen]).toContain('served');
    expect([...seen]).toContain('hit');
    expect(mine.score).toBe(theirs.score);
    expect(mine.reputation).toBe(theirs.reputation);
  });

  it('일시정지 시간 밀기와 주문 조합 생성이 레거시와 같다', () => {
    const { mine, theirs } = makePair(4, 31337);
    for (let step = 0; step < 500; step++) {
      vi.advanceTimersByTime(300);
      expect(mine.tick(), 'step=' + step).toEqual(theirs.tick());
      if (step % 20 === 0) {
        const ms = 1000 + (step % 7) * 500;
        mine.shiftTime(ms);
        theirs.shiftTime(ms);
        expect(mine.snapshot(), 'shift step=' + step).toEqual(theirs.snapshot());
      }
      if (mine.phase === 'over') break;
    }
    // 웨이브별 주문 생성도 직접 대조한다 (난수 소비 순서까지 같아야 한다)
    for (let w = 1; w <= 10; w++) {
      expect(mine.available(w)).toEqual(theirs.available(w));
      expect(mine.kioskOrder(w), 'kioskOrder ' + w).toEqual(theirs.kioskOrder(w));
      expect(mine.counterOrder(w), 'counterOrder ' + w).toEqual(theirs.counterOrder(w));
    }
  });
});
