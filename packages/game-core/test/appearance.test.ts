/* 외형 조합. sanitizeLook 은 클라이언트가 보낸 값을 믿지 않는 방어선이고,
   lookFromSeed 는 서버와 클라가 손님을 똑같이 그리게 하는 근거다. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOK,
  lookFromSeed,
  PART_COLORS,
  PARTS,
  sanitizeLook,
  type Look,
} from '../src/appearance.js';

/** 각 칸이 가질 수 있는 값의 개수 */
const LIMITS: Record<keyof Look, number> = {
  h: PARTS.hair.length,
  hc: PART_COLORS.hair.length,
  f: PARTS.face.length,
  t: PARTS.top.length,
  tc: PART_COLORS.top.length,
  b: PARTS.bottom.length,
  bc: PART_COLORS.bottom.length,
  e: PARTS.expression.length,
  sc: PART_COLORS.skin.length,
  shc: PART_COLORS.shoes.length,
};
const SLOTS = Object.keys(LIMITS) as (keyof Look)[];

describe('sanitizeLook — 남이 보낸 값을 믿지 않는다', () => {
  it('아무것도 안 주면 전부 0', () => {
    for (const look of [null, undefined, {}]) {
      const r = sanitizeLook(look);
      for (const slot of SLOTS) expect(r[slot], slot).toBe(0);
    }
  });

  it('범위를 벗어나면 0으로 떨군다', () => {
    for (const slot of SLOTS) {
      expect(sanitizeLook({ [slot]: LIMITS[slot] })[slot], slot).toBe(0); // 딱 하나 초과
      expect(sanitizeLook({ [slot]: 9999 })[slot], slot).toBe(0);
      expect(sanitizeLook({ [slot]: -1 })[slot], slot).toBe(0);
    }
  });

  it('숫자로 읽을 수 없는 값은 0으로 떨군다', () => {
    for (const bad of ['abc', NaN, Infinity, -Infinity, {}, [1, 2]]) {
      expect(sanitizeLook({ h: bad as never }).h, JSON.stringify(bad)).toBe(0);
    }
  });

  it('숫자로 읽히는 값은 받아준다 — Number() 를 거치므로', () => {
    // 문자열로 와도 범위 안 정수가 되면 통과한다. 방어선의 목적은
    // "형식"이 아니라 "범위" 라서 이대로 문제가 없다.
    expect(sanitizeLook({ h: '2' as never }).h).toBe(2);
    expect(sanitizeLook({ h: '99' as never }).h).toBe(0); // 범위 밖은 여전히 막는다
  });

  it('소수는 내림한다', () => {
    expect(sanitizeLook({ h: 2.9 }).h).toBe(2);
    expect(sanitizeLook({ h: 0.9 }).h).toBe(0);
  });

  it('표정이 없는 옛 조합도 받아준다 — 0으로 채운다', () => {
    const old = { h: 1, hc: 1, f: 1, t: 1, tc: 1, b: 1, bc: 1, sc: 1, shc: 1 };
    expect(sanitizeLook(old).e).toBe(0);
    expect(sanitizeLook(old).h).toBe(1); // 나머지는 살아남는다
  });

  it('유효한 값은 그대로 통과시킨다', () => {
    const ok: Look = { h: 1, hc: 2, f: 3, t: 4, tc: 5, b: 2, bc: 6, e: 7, sc: 6, shc: 4 };
    expect(sanitizeLook(ok)).toEqual(ok);
  });

  it('각 칸의 마지막 값까지 쓸 수 있다', () => {
    for (const slot of SLOTS) {
      const last = LIMITS[slot] - 1;
      expect(sanitizeLook({ [slot]: last })[slot], slot).toBe(last);
    }
  });

  it('결과는 언제나 열 칸을 다 갖는다', () => {
    expect(Object.keys(sanitizeLook(null)).sort()).toEqual([...SLOTS].sort());
  });

  it('DEFAULT_LOOK 은 그대로 통과한다', () => {
    expect(sanitizeLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
  });

  it('두 번 통과시켜도 같다', () => {
    const once = sanitizeLook({ h: 99, e: 2, sc: -1 });
    expect(sanitizeLook(once)).toEqual(once);
  });
});

describe('lookFromSeed — 손님 외형은 seed 에서 결정적으로 나온다', () => {
  it('같은 seed 면 언제나 같은 조합 — 서버와 클라가 따로 계산해도 맞는다', () => {
    for (const seed of [0, 1, 42, 12345, -7]) {
      expect(lookFromSeed(seed)).toEqual(lookFromSeed(seed));
    }
  });

  it('seed 가 다르면 조합도 갈린다', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(lookFromSeed(i))));
    expect(seen.size).toBeGreaterThan(20); // 전부 같은 얼굴이면 안 된다
  });

  it('모든 인덱스가 범위 안이고 정수다', () => {
    for (let seed = 0; seed < 300; seed++) {
      const look = lookFromSeed(seed);
      for (const [slot, v] of Object.entries(look)) {
        expect(Number.isInteger(v), `seed ${seed} ${slot}`).toBe(true);
        expect(v, `seed ${seed} ${slot}`).toBeGreaterThanOrEqual(0);
        expect(v, `seed ${seed} ${slot}`).toBeLessThan(LIMITS[slot as keyof Look]);
      }
    }
  });

  it('sanitizeLook 을 지나도 값이 바뀌지 않는다', () => {
    for (let seed = 0; seed < 100; seed++) {
      const look = { ...lookFromSeed(seed), e: 0 };
      expect(sanitizeLook(look), `seed ${seed}`).toEqual(look);
    }
  });

  it('손님은 자연스러운 피부색 5종만 쓴다 — 뒤 2종은 플레이어 전용', () => {
    // appearance.ts 의 lookFromSeed 는 sc 를 `r(8) * 5` 로 뽑는다. PART_COLORS.skin 은
    // 7종이고 커스터마이저는 .length 를 쓰므로, 손님에게는 마지막 두 색이 안 나온다.
    // 지금 동작을 그대로 못 박아 둔다 — 의도를 바꾸려면 이 테스트부터 고칠 것.
    const seen = new Set<number>();
    for (let seed = 0; seed < 2000; seed++) seen.add(lookFromSeed(seed).sc);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(PART_COLORS.skin.length).toBe(7);
  });

  it('표정은 만들지 않는다 — 손님 표정은 상태에 따라 따로 정해진다', () => {
    expect('e' in lookFromSeed(1)).toBe(false);
  });
});

describe('PARTS · PART_COLORS — 조합표', () => {
  it('빈 칸이 없다', () => {
    for (const [slot, list] of Object.entries(PARTS)) expect(list.length, slot).toBeGreaterThan(0);
    for (const [slot, list] of Object.entries(PART_COLORS))
      expect(list.length, slot).toBeGreaterThan(0);
  });

  it('부품 id 가 중복되지 않는다', () => {
    for (const [slot, list] of Object.entries(PARTS)) {
      expect(new Set(list.map((p) => p.id)).size, slot).toBe(list.length);
    }
  });

  it('색이 중복되지 않는다 — 골라도 달라 보여야 한다', () => {
    for (const [slot, list] of Object.entries(PART_COLORS)) {
      expect(new Set(list).size, slot).toBe(list.length);
    }
  });

  it('색은 전부 24비트 RGB 범위 안이다', () => {
    for (const [slot, list] of Object.entries(PART_COLORS)) {
      for (const c of list) {
        expect(c, slot).toBeGreaterThanOrEqual(0);
        expect(c, slot).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});
