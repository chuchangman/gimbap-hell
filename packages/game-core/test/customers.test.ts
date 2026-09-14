/* 웨이브 표와 손님. cb55f4a 에서 서버 조건식을 표로 옮겼으므로
   표의 순서가 뒤집히면 조용히 틀리는 자리가 생겼다. */
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_HP,
  grumbleFor,
  GRUMBLES,
  KIOSK_EXTRA_BY_WAVE,
  kioskExtraMax,
  QUEUE_SLOTS,
  scaleCount,
  slotX,
  SPECIAL_FILLS,
  SPECIAL_PATIENCE,
  SPECIAL_RATIO,
  WAVES,
} from '../src/customers.js';

describe('kioskExtraMax — 웨이브별로 얹을 수 있는 추가 재료 수', () => {
  it('초반에는 기본 3종뿐이다', () => {
    expect(kioskExtraMax(1)).toBe(0);
    expect(kioskExtraMax(2)).toBe(0);
  });

  it('3웨이브부터 하나, 7웨이브부터 둘', () => {
    for (const w of [3, 4, 5, 6]) expect(kioskExtraMax(w), `웨이브 ${w}`).toBe(1);
    for (const w of [7, 8, 9, 10]) expect(kioskExtraMax(w), `웨이브 ${w}`).toBe(2);
  });

  it('표는 큰 웨이브부터 적어야 한다 — find 가 첫 매치를 쓴다', () => {
    // 오름차순으로 뒤집히면 7웨이브가 1을 받는다. 눈에 안 띄므로 여기서 못 박는다.
    const froms = KIOSK_EXTRA_BY_WAVE.map(([from]) => from);
    expect(froms).toEqual([...froms].sort((a, b) => b - a));
  });

  it('웨이브가 올라가면 줄지 않는다', () => {
    for (let w = 2; w <= 10; w++) {
      expect(kioskExtraMax(w), `웨이브 ${w}`).toBeGreaterThanOrEqual(kioskExtraMax(w - 1));
    }
  });
});

describe('scaleCount — 인원수에 따른 손님 수', () => {
  it('3인이 기준이라 거의 그대로 나온다', () => {
    for (const n of [2, 5, 10, 16]) expect(scaleCount(n, 3)).toBe(n);
  });

  it('혼자 하면 줄고 여섯이면 늘어난다', () => {
    expect(scaleCount(10, 1)).toBeLessThan(10);
    expect(scaleCount(10, 6)).toBeGreaterThan(10);
  });

  it('인원이 늘수록 줄지 않는다', () => {
    for (let p = 2; p <= 6; p++) {
      expect(scaleCount(10, p), `${p}인`).toBeGreaterThanOrEqual(scaleCount(10, p - 1));
    }
  });

  it('0명이나 음수는 1인으로 친다 — 0으로 나눌 일을 만들지 않는다', () => {
    expect(scaleCount(10, 0)).toBe(scaleCount(10, 1));
    expect(scaleCount(10, -5)).toBe(scaleCount(10, 1));
  });

  it('아무리 줄여도 최소 한 명은 온다 — 웨이브가 손님 0으로 끝나지 않는다', () => {
    expect(scaleCount(1, 1)).toBeGreaterThanOrEqual(1);
    expect(scaleCount(1, 0)).toBeGreaterThanOrEqual(1);
  });

  it('정수를 돌려준다', () => {
    for (const p of [1, 2, 3, 4, 5, 6]) expect(Number.isInteger(scaleCount(7, p))).toBe(true);
  });
});

describe('grumbleFor — 남은 인내심에 따른 궁시렁', () => {
  it('여유로울 때와 다 됐을 때 대사가 다르다', () => {
    expect(GRUMBLES[0].lines).toContain(grumbleFor(1, 0));
    expect(GRUMBLES[GRUMBLES.length - 1].lines).toContain(grumbleFor(0, 0));
  });

  it('구간 경계는 아래쪽에 속한다 — pct > over 이므로', () => {
    expect(GRUMBLES[1].lines).toContain(grumbleFor(0.66, 0));
    expect(GRUMBLES[2].lines).toContain(grumbleFor(0.38, 0));
    expect(GRUMBLES[3].lines).toContain(grumbleFor(0.15, 0));
  });

  it('같은 seed 면 같은 대사 — 손님이 말을 바꾸지 않는다', () => {
    for (const seed of [0, 1, 7, 123]) expect(grumbleFor(0.5, seed)).toBe(grumbleFor(0.5, seed));
  });

  it('음수 seed 도 정상 대사를 고른다', () => {
    const line = grumbleFor(0.5, -7);
    expect(GRUMBLES[1].lines).toContain(line);
  });

  it('범위를 벗어난 pct 도 대사를 돌려준다', () => {
    expect(typeof grumbleFor(-1, 0)).toBe('string');
    expect(typeof grumbleFor(99, 0)).toBe('string');
  });

  it('모든 구간에 대사가 들어 있다', () => {
    for (const g of GRUMBLES) expect(g.lines.length).toBeGreaterThan(0);
  });
});

describe('WAVES — 난이도 곡선', () => {
  it('10개 웨이브다', () => {
    expect(WAVES).toHaveLength(10);
  });

  it('손님 수가 계속 늘어난다', () => {
    for (let i = 1; i < WAVES.length; i++) {
      expect(WAVES[i].n, `웨이브 ${i + 1}`).toBeGreaterThan(WAVES[i - 1].n);
    }
  });

  it('인내심이 계속 줄어든다', () => {
    for (let i = 1; i < WAVES.length; i++) {
      expect(WAVES[i].patience, `웨이브 ${i + 1}`).toBeLessThan(WAVES[i - 1].patience);
    }
  });

  it('손님 간격이 늘어나지는 않는다', () => {
    for (let i = 1; i < WAVES.length; i++) {
      expect(WAVES[i].gap, `웨이브 ${i + 1}`).toBeLessThanOrEqual(WAVES[i - 1].gap);
    }
  });

  it('주문량은 최소 한 줄이다', () => {
    for (const [i, w] of WAVES.entries()) {
      expect(w.orders.length, `웨이브 ${i + 1}`).toBeGreaterThan(0);
      for (const o of w.orders) expect(o).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('손님 수치', () => {
  it('진상은 체력이 더 많고 인내심이 더 짧다', () => {
    expect(CUSTOMER_HP.special).toBeGreaterThan(CUSTOMER_HP.normal);
    expect(SPECIAL_PATIENCE).toBeLessThan(1);
  });

  it('진상 비율은 0~1 사이다', () => {
    expect(SPECIAL_RATIO).toBeGreaterThan(0);
    expect(SPECIAL_RATIO).toBeLessThan(1);
  });

  it('진상 주문 재료 수는 최소 ≤ 최대다', () => {
    expect(SPECIAL_FILLS[0]).toBeLessThanOrEqual(SPECIAL_FILLS[1]);
  });
});

describe('slotX — 카운터 대기줄 자리', () => {
  it('자리마다 x 가 다르다', () => {
    const xs = Array.from({ length: QUEUE_SLOTS }, (_, i) => slotX(i));
    expect(new Set(xs).size).toBe(QUEUE_SLOTS);
  });

  it('왼쪽에서 오른쪽으로 일정 간격으로 선다', () => {
    const gap = slotX(1) - slotX(0);
    for (let i = 1; i < QUEUE_SLOTS; i++) expect(slotX(i) - slotX(i - 1)).toBeCloseTo(gap, 10);
    expect(gap).toBeGreaterThan(0);
  });

  it('대기줄이 카운터 가운데를 기준으로 퍼진다', () => {
    expect(slotX(0)).toBeLessThan(0);
    expect(slotX(QUEUE_SLOTS - 1)).toBeGreaterThan(0);
  });
});
