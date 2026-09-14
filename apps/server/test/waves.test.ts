/* 웨이브 진행과 서빙 정산. 손님이 언제 들어오고 언제 화내는지,
   김밥 한 줄이 누구에게 가고 몇 점이 되는지가 전부 여기 있다. */
import { WaveRunner, type Customer } from '@/domain/waves.js';
import {
  focusPick,
  matchScore,
  PREP_BETWEEN,
  PREP_FIRST,
  QUEUE_SLOTS,
  REPUTATION_MAX,
  scaleCount,
  SCORE,
  SPECIAL_RATIO,
  WALK_IN_MS,
  WALK_OUT_MS,
  WAVES,
  type Fill,
  type ItemId,
} from '@repo/game-core';
import { beforeEach, describe, expect, it } from 'vitest';

const T0 = 1_700_000_000_000;

/** 시드 난수 — 같은 시드면 같은 게임이 돌아간다 */
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let now = T0;
let r: WaveRunner;

const wait = (sec: number) => {
  now += sec * 1000;
};
const waitMs = (ms: number) => {
  now += ms;
};

/** 1웨이브를 시작하고 손님이 주문을 받는 상태까지 끌고 간다 */
const toWave = (players = 3, seed = 1) => {
  now = T0;
  r = new WaveRunner(players, () => now, seeded(seed));
  wait(PREP_FIRST);
  r.tick(); // 웨이브 시작
  r.tick(); // 첫 손님 입장
  waitMs(WALK_IN_MS);
  r.tick(); // 자리에 선다
  return r;
};

beforeEach(() => {
  now = T0;
  r = new WaveRunner(3, () => now, seeded(1));
});

describe('처음 상태', () => {
  it('준비 단계로 시작하고 아직 웨이브가 아니다', () => {
    expect(r.phase).toBe('prep');
    expect(r.wave).toBe(0);
    expect(r.result).toBeNull();
  });

  it('평판이 가득 차 있다', () => {
    expect(r.reputation).toBe(REPUTATION_MAX);
    expect(r.score).toBe(0);
  });

  it('첫 준비 시간이 웨이브 사이보다 길다 — 처음엔 배울 게 많다', () => {
    expect(r.phaseEndsAt).toBe(T0 + PREP_FIRST * 1000);
    expect(PREP_FIRST).toBeGreaterThan(PREP_BETWEEN);
  });

  it('인원수를 최소 1로 잡는다', () => {
    expect(new WaveRunner(0, () => now).players).toBe(1);
    expect(new WaveRunner(-3, () => now).players).toBe(1);
  });
});

describe('웨이브 구성', () => {
  it('인원수에 따라 손님 수가 는다', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const runner = new WaveRunner(n, () => now, seeded(7));
      expect(runner.buildWave(1).count, `${n}인`).toBe(scaleCount(WAVES[0].n, n));
    }
  });

  it('진상 손님이 정해진 비율만큼 섞인다', () => {
    const built = r.buildWave(10);
    expect(built.specials).toBe(Math.round(built.count * SPECIAL_RATIO));
    expect(built.list.filter((c) => c.kind === 'counter')).toHaveLength(built.specials);
  });

  it('진상이 앞쪽에만 몰리지 않는다', () => {
    // 섞지 않으면 언제나 앞 n 명이 진상이다. 여러 시드에서 위치가 갈리는지 본다
    const positions = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const runner = new WaveRunner(6, () => now, seeded(seed));
      runner.buildWave(10).list.forEach((c, i) => {
        if (c.kind === 'counter') positions.add(i);
      });
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it('진상은 체력이 많고 인내심이 짧다', () => {
    const built = r.buildWave(10);
    const special = built.list.find((c) => c.kind === 'counter')!;
    const normal = built.list.find((c) => c.kind === 'kiosk')!;
    expect(special.hpMax).toBeGreaterThan(normal.hpMax);
    expect(special.patienceMax).toBeLessThan(normal.patienceMax);
  });

  it('일반 손님 주문은 기본 3종을 반드시 담는다', () => {
    for (let w = 1; w <= 10; w++) {
      for (const c of r.buildWave(w).list.filter((x) => x.kind === 'kiosk')) {
        for (const base of ['danmuji', 'ham', 'spinach'] as ItemId[]) {
          expect(c.fills, `웨이브 ${w}`).toContain(base);
        }
      }
    }
  });

  it('아직 안 풀린 재료는 주문에 안 나온다', () => {
    for (let w = 1; w <= 10; w++) {
      const allowed = new Set(r.available(w));
      for (const c of r.buildWave(w).list) {
        for (const id of c.fills) expect(allowed, `웨이브 ${w} / ${id}`).toContain(id);
      }
    }
  });

  it('주문에 같은 재료가 두 번 들어가지 않는다', () => {
    for (let w = 1; w <= 10; w++) {
      for (const c of r.buildWave(w).list) {
        expect(new Set(c.fills).size, `웨이브 ${w}`).toBe(c.fills.length);
      }
    }
  });

  it('손님마다 id 가 다르다', () => {
    const ids = [...r.buildWave(1).list, ...r.buildWave(2).list].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('같은 시드면 같은 손님이 나온다', () => {
    const a = new WaveRunner(3, () => now, seeded(42)).buildWave(5);
    const b = new WaveRunner(3, () => now, seeded(42)).buildWave(5);
    expect(a.list).toEqual(b.list);
  });
});

describe('웨이브 진행', () => {
  it('준비 시간이 지나면 웨이브가 시작된다', () => {
    expect(r.tick()).toEqual([]); // 아직 준비 중
    wait(PREP_FIRST);
    const events = r.tick();
    expect(events[0]).toMatchObject({ type: 'waveStart', wave: 1 });
    expect(r.phase).toBe('wave');
  });

  it('손님이 간격을 두고 들어온다', () => {
    now = T0;
    r = new WaveRunner(6, () => now, seeded(3)); // 손님을 넉넉히
    wait(PREP_FIRST);
    r.tick();
    expect(r.tick().filter((e) => e.type === 'spawn')).toHaveLength(1);
    expect(r.tick().filter((e) => e.type === 'spawn')).toHaveLength(0); // 아직 간격 전
    wait(WAVES[0].gap);
    expect(r.tick().filter((e) => e.type === 'spawn')).toHaveLength(1);
  });

  it('카운터가 꽉 차면 밖에서 기다린다', () => {
    now = T0;
    r = new WaveRunner(6, () => now, seeded(5));
    wait(PREP_FIRST);
    r.tick();
    for (let i = 0; i < QUEUE_SLOTS + 4; i++) {
      wait(WAVES[0].gap);
      r.tick();
    }
    expect(r.active.length).toBeLessThanOrEqual(QUEUE_SLOTS);
  });

  it('자리에 서야 인내심이 돌기 시작한다', () => {
    now = T0;
    r = new WaveRunner(3, () => now, seeded(1));
    wait(PREP_FIRST);
    r.tick();
    r.tick();
    expect(r.active[0].state).toBe('walkin');
    expect(r.active[0].deadline).toBe(0); // 아직 안 돈다
    waitMs(WALK_IN_MS);
    r.tick();
    expect(r.active[0].state).toBe('wait');
    expect(r.active[0].deadline).toBe(now + r.active[0].patienceMax * 1000);
  });

  it('자리 번호가 겹치지 않는다', () => {
    now = T0;
    r = new WaveRunner(6, () => now, seeded(9));
    wait(PREP_FIRST);
    r.tick();
    for (let i = 0; i < QUEUE_SLOTS; i++) {
      wait(WAVES[0].gap);
      r.tick();
    }
    const slots = r.active.map((c) => c.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });
});

describe('인내심이 다하면', () => {
  const expire = () => {
    toWave();
    const c = r.active[0];
    wait(c.patienceMax + 1);
    return { c, events: r.tick() };
  };

  it('손님이 화내며 나가고 점수와 평판이 깎인다', () => {
    const { events } = expire();
    expect(events.some((e) => e.type === 'leave')).toBe(true);
    expect(r.angry).toBe(1);
    expect(r.score).toBe(SCORE.leave);
    expect(r.reputation).toBe(REPUTATION_MAX - SCORE.repLoss);
  });

  it('진상을 놓치면 더 크게 깎인다', () => {
    expect(SCORE.repLossSpecial).toBeGreaterThan(SCORE.repLoss);
  });

  it('나가는 연출이 끝나야 자리가 빈다', () => {
    const { c } = expire();
    expect(r.active).toContain(c);
    waitMs(WALK_OUT_MS);
    r.tick();
    expect(r.active).not.toContain(c);
  });

  it('평판이 0이 되면 진다', () => {
    toWave();
    r.reputation = SCORE.repLoss; // 한 번만 더 놓치면 끝
    wait(r.active[0].patienceMax + 1);
    const events = r.tick();
    expect(events.some((e) => e.type === 'gameOver')).toBe(true);
    expect(r.result).toBe('defeat');
    expect(r.phase).toBe('over');
  });

  it('끝난 뒤에는 더 진행하지 않는다', () => {
    toWave();
    r.phase = 'over';
    expect(r.tick()).toEqual([]);
  });
});

describe('🧹 빗자루로 쫓아내기', () => {
  it('체력이 닳을 때까지는 버틴다', () => {
    toWave();
    const c = r.active[0];
    for (let i = 1; i < c.hpMax; i++) {
      expect(r.hit(c.id), `${i}대`).toMatchObject({ kicked: false });
    }
    expect(r.hit(c.id)).toMatchObject({ kicked: true });
  });

  it('쫓아내면 시간 초과보다 손해가 적다', () => {
    expect(SCORE.kick).toBeGreaterThan(SCORE.leave); // 둘 다 음수, 쫓아내는 쪽이 덜 깎인다
    expect(SCORE.repLossKick).toBeLessThan(SCORE.repLoss);
  });

  it('쫓아낸 수를 따로 센다', () => {
    toWave();
    const c = r.active[0];
    for (let i = 0; i < c.hpMax; i++) r.hit(c.id);
    expect(r.kicked).toBe(1);
    expect(r.angry).toBe(1);
    expect(r.score).toBe(SCORE.kick);
    expect(r.reputation).toBe(REPUTATION_MAX - SCORE.repLossKick);
  });

  it('없는 손님이나 이미 나간 손님은 못 때린다', () => {
    toWave();
    expect(r.hit('없는손님')).toBeNull();
    const c = r.active[0];
    for (let i = 0; i < c.hpMax; i++) r.hit(c.id);
    expect(r.hit(c.id)).toBeNull(); // 이미 쫓겨났다
  });

  it('아직 걸어오는 손님은 못 때린다', () => {
    now = T0;
    r = new WaveRunner(3, () => now, seeded(1));
    wait(PREP_FIRST);
    r.tick();
    r.tick();
    expect(r.active[0].state).toBe('walkin');
    expect(r.hit(r.active[0].id)).toBeNull();
  });
});

describe('🍣 서빙', () => {
  const fills = (...ids: ItemId[]): Fill[] => ids.map((id) => ({ id, quality: 100 }));

  it('웨이브가 아니면 낼 수 없다', () => {
    expect(r.serve(fills('ham')).ok).toBe(false); // 준비 단계
  });

  it('기다리는 손님이 없으면 낼 수 없다', () => {
    toWave();
    r.active = [];
    expect(r.serve(fills('ham'))).toMatchObject({ ok: false });
  });

  it('주문대로 내면 완료되고 점수가 오른다', () => {
    toWave();
    const c = r.active[0];
    const res = r.serve(fills(...c.fills));
    expect(res).toMatchObject({ ok: true, completed: true, quality: 100, kind: 'good' });
    expect(res.gain).toBeGreaterThan(0);
    expect(r.happy).toBe(1);
    expect(c.state).toBe('happy');
  });

  it('재료가 빠지면 품질이 떨어지고 무엇이 빠졌는지 알려준다', () => {
    toWave();
    const c = r.active[0];
    const res = r.serve(fills(...c.fills.slice(1)));
    expect(res.kind).toBe('warn');
    expect(res.msg).toContain('빠짐');
    expect(res.quality!).toBeLessThan(100);
  });

  it('재료를 더 넣어도 알려준다', () => {
    toWave();
    const c = r.active[0];
    const extra = (['crab', 'cucumber', 'egg'] as ItemId[]).find((id) => !c.fills.includes(id))!;
    const res = r.serve(fills(...c.fills, extra));
    expect(res.msg).toContain('더 들어감');
  });

  it('여러 줄 주문은 다 채워야 완료된다', () => {
    toWave();
    const c = r.active[0];
    c.need = 2;
    c.done = 0;
    const first = r.serve(fills(...c.fills));
    expect(first).toMatchObject({ ok: true, completed: false });
    expect(first.msg).toContain('1/2');
    expect(r.serve(fills(...c.fills))).toMatchObject({ completed: true });
  });

  it('인내심이 많이 남을수록 더 많이 받는다', () => {
    const gainAt = (leftRatio: number) => {
      toWave();
      const c = r.active[0];
      c.deadline = now + c.patienceMax * 1000 * leftRatio;
      return r.serve(fills(...c.fills)).gain!;
    };
    expect(gainAt(0.9)).toBeGreaterThan(gainAt(0.1));
  });

  it('진상 배수가 일반 손님보다 크다', () => {
    expect(SCORE.specialBonus).toBeGreaterThan(1);
  });

  it('지목한 손님에게 낼 수 있다', () => {
    toWave();
    const c = r.active[0];
    expect(r.serve(fills(...c.fills), c.id)).toMatchObject({ ok: true });
  });

  it('이미 간 손님을 지목하면 거절한다', () => {
    toWave();
    const c = r.active[0];
    c.state = 'happy';
    expect(r.serve(fills(...c.fills), c.id)).toMatchObject({ ok: false });
  });

  it('낸 줄 수와 품질 합을 기록한다', () => {
    toWave();
    const c = r.active[0];
    c.need = 2;
    r.serve(fills(...c.fills));
    expect(r.servedRolls).toBe(1);
    expect(r.qualitySum).toBe(100);
  });
});

describe('서빙 대상 고르기 — 화면과 서버가 같은 답을 내야 한다', () => {
  /* 화면은 game-core 의 focusPick 으로 윤곽선과 취소선을 그리고,
     서버는 bestMatch 로 실제 서빙 대상을 고른다. 둘이 갈리면
     "조준한 손님과 실제로 받은 손님이 다른" 버그가 된다. */
  const POOL: ItemId[] = ['danmuji', 'ham', 'spinach', 'crab', 'cucumber', 'egg', 'carrot'];

  const makeCustomers = (rng: () => number, n: number): Customer[] =>
    Array.from({ length: n }, (_, i) => {
      const count = 1 + Math.floor(rng() * 4);
      const picked: ItemId[] = [];
      const pool = POOL.slice();
      for (let j = 0; j < count && pool.length; j++) {
        picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      }
      return {
        id: 'c' + i,
        state: rng() < 0.85 ? 'wait' : 'happy',
        done: rng() < 0.2 ? 1 : 0,
        need: 1,
        deadline: T0 + Math.floor(rng() * 60000),
        fills: picked,
      } as Customer;
    });

  it('맞춤도가 가장 높은 손님을 고른다', () => {
    toWave();
    r.active = makeCustomers(seeded(1), 4);
    for (const c of r.active) {
      c.state = 'wait';
      c.done = 0;
    }
    const want = r.active[2].fills;
    const held: Fill[] = want.map((id) => ({ id, quality: 100 }));
    expect(matchScore(r.bestMatch(held)!.fills, held)).toBe(1);
  });

  it('무작위 판에서 focusPick 과 같은 손님을 고른다', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = seeded(seed);
      toWave();
      r.active = makeCustomers(rng, 1 + Math.floor(rng() * 6));

      const held: Fill[] = POOL.slice(0, 1 + Math.floor(rng() * 4)).map((id) => ({
        id,
        quality: 100,
      }));

      const server = r.bestMatch(held);
      const client = focusPick(r.active, held);

      if (!client.focus) {
        expect(server, `시드 ${seed}`).toBeNull();
        continue;
      }
      // 동점이 여럿일 수 있으므로 "점수가 같고 마감도 같은가" 로 본다
      expect(server, `시드 ${seed}`).not.toBeNull();
      expect(matchScore(server!.fills, held), `시드 ${seed} 점수`).toBeCloseTo(client.score, 10);
      expect(server!.deadline, `시드 ${seed} 마감`).toBe(client.focus.deadline);
    }
  });

  it('김밥이 없으면 양쪽 다 가장 급한 손님을 가리킨다', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = seeded(seed);
      toWave();
      r.active = makeCustomers(rng, 1 + Math.floor(rng() * 6));

      const server = r.nextTarget(null);
      const client = focusPick(r.active, null);
      expect(server?.id ?? null, `시드 ${seed}`).toBe(client.focusId);
    }
  });

  it('이미 다 받은 손님과 나간 손님은 고르지 않는다', () => {
    toWave();
    const c = r.active[0];
    c.done = c.need;
    expect(r.bestMatch([{ id: c.fills[0], quality: 100 }])).toBeNull();
    c.done = 0;
    c.state = 'happy';
    expect(r.bestMatch([{ id: c.fills[0], quality: 100 }])).toBeNull();
  });
});

describe('웨이브 클리어', () => {
  it('손님이 다 빠지면 다음 준비 단계로 넘어간다', () => {
    toWave();
    r.pending = [];
    r.active = [];
    const events = r.tick();
    expect(events.some((e) => e.type === 'waveClear')).toBe(true);
    expect(r.phase).toBe('prep');
    expect(r.phaseEndsAt).toBe(now + PREP_BETWEEN * 1000);
  });

  it('마지막 웨이브를 넘기면 이긴다', () => {
    toWave();
    r.wave = WAVES.length;
    r.pending = [];
    r.active = [];
    const events = r.tick();
    expect(events.some((e) => e.type === 'gameOver')).toBe(true);
    expect(r.result).toBe('victory');
  });

  it('클리어 자체로는 점수를 주지 않는다 — 손님을 만족시켜야 한다', () => {
    toWave();
    const before = r.score;
    r.pending = [];
    r.active = [];
    r.tick();
    expect(r.score).toBe(before);
  });

  it('웨이브별 기록을 남긴다', () => {
    toWave();
    r.pending = [];
    r.active = [];
    r.tick();
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ wave: 1 });
  });
});

describe('일시정지', () => {
  it('멈춘 만큼 인내심 마감이 밀린다', () => {
    toWave();
    const c = r.active[0];
    const deadline = c.deadline;
    wait(60);
    r.shiftTime(60 * 1000);
    expect(c.deadline).toBe(deadline + 60 * 1000);
    expect(r.tick().some((e) => e.type === 'leave')).toBe(false);
  });

  it('준비 시간도 밀린다', () => {
    const ends = r.phaseEndsAt;
    r.shiftTime(5000);
    expect(r.phaseEndsAt).toBe(ends + 5000);
  });

  it('음수나 0 은 아무것도 하지 않는다', () => {
    const ends = r.phaseEndsAt;
    r.shiftTime(0);
    r.shiftTime(-100);
    expect(r.phaseEndsAt).toBe(ends);
  });
});

describe('다음 해금 안내', () => {
  it('앞으로 풀릴 재료를 알려준다', () => {
    r.wave = 1;
    expect(r.nextUnlock()).toMatchObject({ wave: 2, id: 'crab' });
  });

  it('다 풀렸으면 없다고 한다', () => {
    r.wave = WAVES.length;
    expect(r.nextUnlock()).toBeNull();
  });
});
