/* 점수 정산. 서버 결산과 화면 미리보기가 같은 함수를 쓰므로
   여기가 틀리면 "보이는 점수"와 "받는 점수"가 갈린다. */
import { describe, expect, it } from 'vitest';
import type { ItemId } from '../src/items.js';
import {
  FOCUS_EPS,
  focusPick,
  handHint,
  matchScore,
  servedQuality,
  type Fill,
  type FocusCandidate,
} from '../src/scoring.js';

const fill = (id: ItemId, quality = 100): Fill => ({ id, quality });

describe('matchScore — 주문 ↔ 김밥 맞춤도', () => {
  it('정확히 일치하면 1', () => {
    expect(matchScore(['ham', 'spinach'], [fill('ham'), fill('spinach')])).toBe(1);
  });

  it('빠진 재료 하나당 0.28 깎는다', () => {
    expect(matchScore(['ham', 'spinach'], [fill('ham')])).toBeCloseTo(0.72, 10);
  });

  it('더 넣은 재료 하나당 0.14 깎는다 — 빠뜨린 것의 절반', () => {
    expect(matchScore(['ham'], [fill('ham'), fill('crab')])).toBeCloseTo(0.86, 10);
  });

  it('빠짐과 더넣음이 함께 있으면 둘 다 깎는다', () => {
    expect(matchScore(['ham', 'spinach'], [fill('ham'), fill('crab')])).toBeCloseTo(0.58, 10);
  });

  it('주문에 속재료가 없으면 뭘 넣든 1 — 비교할 대상이 없다', () => {
    expect(matchScore([], [fill('ham'), fill('crab')])).toBe(1);
    expect(matchScore(null, [fill('ham')])).toBe(1);
    expect(matchScore(undefined, [fill('ham')])).toBe(1);
  });

  it('많이 틀려도 음수로 내려가지 않고 0에서 멈춘다', () => {
    const want: ItemId[] = ['danmuji', 'ham', 'spinach', 'crab'];
    expect(matchScore(want, [])).toBe(0);
  });

  it('김밥 쪽이 비어 있으면 주문 전체가 빠진 것으로 친다', () => {
    expect(matchScore(['ham'], null)).toBeCloseTo(0.72, 10);
    expect(matchScore(['ham'], undefined)).toBeCloseTo(0.72, 10);
  });

  it('같은 재료를 두 번 넣어도 한 번으로 센다 — 집합으로 비교한다', () => {
    expect(matchScore(['ham', 'ham'], [fill('ham'), fill('ham')])).toBe(1);
  });
});

/* focusPick 이 훑는 손님. 실제 스냅샷의 부분집합만 만든다. */
const cust = (over: Partial<FocusCandidate> & { id: string }): FocusCandidate => ({
  state: 'wait',
  done: 0,
  need: 1,
  deadline: 1000,
  fills: [],
  ...over,
});

describe('focusPick — 지금 만드는 김밥이 누구 주문인지', () => {
  it('기다리지 않는 손님과 이미 다 받은 손님은 후보에서 뺀다', () => {
    const list = [
      cust({ id: 'gone', state: 'leave' }),
      cust({ id: 'full', done: 2, need: 2 }),
      cust({ id: 'ok' }),
    ];
    expect(focusPick(list, [fill('ham')]).focusId).toBe('ok');
  });

  it('후보가 없으면 전부 빈 값', () => {
    const r = focusPick([], [fill('ham')]);
    expect(r.focus).toBeNull();
    expect(r.focusId).toBeNull();
    expect(r.best).toEqual([]);
    expect(r.bestIds.size).toBe(0);
    expect(r.score).toBe(0);
  });

  it('재료를 아직 안 넣었으면 맞춤도를 보지 않고 가장 급한 손님을 가리킨다', () => {
    const list = [
      cust({ id: 'late', deadline: 9000, fills: ['ham'] }),
      cust({ id: 'urgent', deadline: 1000, fills: ['crab'] }),
    ];
    for (const fills of [[], null, undefined]) {
      const r = focusPick(list, fills);
      expect(r.focusId).toBe('urgent');
      expect(r.best).toEqual([]); // 비교를 안 했으므로 윤곽선 대상도 없다
      expect(r.score).toBe(0);
    }
  });

  it('최고점 동점자를 전부 best 에 담는다 — 윤곽선은 여러 명에게 켜진다', () => {
    const list = [
      cust({ id: 'a', fills: ['ham'], deadline: 2000 }),
      cust({ id: 'b', fills: ['ham'], deadline: 3000 }),
      cust({ id: 'c', fills: ['crab'], deadline: 1000 }),
    ];
    const r = focusPick(list, [fill('ham')]);
    expect(r.bestIds).toEqual(new Set(['a', 'b']));
    expect(r.score).toBe(1);
  });

  it('동점자 중에서는 deadline 이 가장 빠른 쪽이 focus 다', () => {
    const list = [
      cust({ id: 'a', fills: ['ham'], deadline: 3000 }),
      cust({ id: 'b', fills: ['ham'], deadline: 2000 }),
    ];
    expect(focusPick(list, [fill('ham')]).focusId).toBe('b');
  });

  it('점수가 낮은 손님은 best 에서 빠진다', () => {
    const list = [cust({ id: 'a', fills: ['ham'] }), cust({ id: 'b', fills: ['ham', 'spinach'] })];
    const r = focusPick(list, [fill('ham')]);
    expect(r.bestIds).toEqual(new Set(['a']));
  });

  it('계산 경로가 달라도 같은 점수면 동점으로 묶는다 — FOCUS_EPS 의 목적', () => {
    // a: 든 것을 다 원하는데 2개가 더 필요(2×0.28) — 빠짐 2, 더넣음 0
    // b: 하나만 원하는데 4개를 더 넣었다(4×0.14) — 빠짐 0, 더넣음 4
    // 두 경로 모두 0.56 만큼 깎여 같은 double 이 된다
    const list = [
      cust({
        id: 'a',
        fills: ['ham', 'crab', 'cucumber', 'egg', 'carrot', 'spinach', 'danmuji'],
        deadline: 2000,
      }),
      cust({ id: 'b', fills: ['ham'], deadline: 3000 }),
    ];
    const r = focusPick(list, [
      fill('ham'),
      fill('crab'),
      fill('cucumber'),
      fill('egg'),
      fill('carrot'),
    ]);
    expect(r.bestIds).toEqual(new Set(['a', 'b']));
    expect(FOCUS_EPS).toBeLessThan(1e-6); // 진짜 차이는 못 덮을 만큼 작아야 한다
  });
});

describe('servedQuality — 최종 품질', () => {
  it('조리 평균 × 맞춤도를 반올림한다', () => {
    // 평균 90, 맞춤도 0.72 → 64.8 → 65
    const r = servedQuality(['ham', 'spinach'], [fill('ham', 80), fill('crab', 100)]);
    expect(r).toBe(Math.round(90 * (1 - 0.28 - 0.14)));
  });

  it('속재료가 없으면 조리 평균이 0이라 결과도 0', () => {
    expect(servedQuality(['ham'], [])).toBe(0);
    expect(servedQuality(['ham'], null)).toBe(0);
  });

  it('완벽하면 조리 평균 그대로', () => {
    expect(servedQuality(['ham'], [fill('ham', 100)])).toBe(100);
  });
});

describe('handHint — 손에 든 것으로 다음에 할 일', () => {
  it('빗자루와 모르는 물건은 안내하지 않는다', () => {
    expect(handHint({ id: 'broom', stage: 'done' })).toBeNull();
    expect(handHint({ id: '없는재료', stage: 'raw' })).toBeNull();
    expect(handHint(null)).toBeNull();
    expect(handHint(undefined)).toBeNull();
  });

  it('탄 재료는 버리라고 한다 — 재료 종류보다 먼저 본다', () => {
    expect(handHint({ id: 'ham', stage: 'burnt' })).toContain('버리세요');
  });

  it('쌀은 씻기 전후로 안내가 다르다', () => {
    expect(handHint({ id: 'rice', stage: 'raw' })).toContain('씻어주세요');
    expect(handHint({ id: 'rice', stage: 'washed' })).toContain('밥솥');
  });

  it('밥과 김은 조립대로 보낸다', () => {
    expect(handHint({ id: 'bap', stage: 'done' })).toContain('조립대');
    expect(handHint({ id: 'gim', stage: 'raw' })).toContain('조립대');
  });

  it('속재료가 아닌 것은 안내하지 않는다', () => {
    expect(handHint({ id: 'roll', stage: 'done' })).toBeNull();
    expect(handHint({ id: 'gimbap', stage: 'done' })).toBeNull();
  });

  it('손질이 끝난 속재료는 조립대로 보낸다', () => {
    expect(handHint({ id: 'ham', stage: 'done' })).toContain('조립대');
  });

  it('손질 전 속재료는 설비별로 다르게 안내한다', () => {
    expect(handHint({ id: 'ham', stage: 'raw' })).toContain('프라이팬'); // pan
    expect(handHint({ id: 'spinach', stage: 'raw' })).toContain('냄비'); // pot
    expect(handHint({ id: 'danmuji', stage: 'raw' })).toContain('도마'); // board
    expect(handHint({ id: 'crab', stage: 'raw' })).toContain('손질 없이'); // station null
  });
});
