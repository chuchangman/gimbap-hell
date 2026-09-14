/* 이동 검증. 클라이언트가 보낸 좌표를 서버가 여기서 되짚는다 —
   뚫고 지나가기·순간이동·무한 점프를 막는 유일한 자리다. */
import {
  grantKnockback,
  movementState,
  validateMove,
  type MovablePlayer,
} from '@/domain/movement.js';
import { MOVEMENT } from '@repo/game-core';
import { describe, expect, it } from 'vitest';

const T0 = 1_000_000;

/** 통로 한가운데에 선 플레이어 */
const player = (over: Partial<MovablePlayer> = {}): MovablePlayer => ({
  x: 0,
  y: 0,
  z: 6.6,
  ry: 0,
  motion: movementState(T0),
  ...over,
});

/** 토큰이 찰 만큼 시간을 준다 */
const LATER = T0 + 1000;

describe('validateMove — 버전', () => {
  it('버전이 어긋나면 되돌린다 — 이미 한 번 튕긴 뒤의 늦은 보고', () => {
    const p = player();
    p.motion.version = 3;
    const r = validateMove(p, { x: 0, y: 0, z: 6.6, ry: 0, version: 1 }, LATER);
    expect(r).toEqual({ ok: false, reason: 'stale' });
  });

  it('버전이 없으면 0으로 친다', () => {
    const p = player();
    expect(validateMove(p, { x: 0, y: 0, z: 6.6, ry: 0 }, LATER).ok).toBe(true);
  });

  it('되돌릴 때마다 버전이 올라간다 — 늦게 온 보고를 구분하려고', () => {
    const p = player();
    const before = p.motion.version;
    const r = validateMove(p, { x: 99, y: 0, z: 6.6, ry: 0, version: before }, LATER);
    expect(r.ok).toBe(false);
    expect(p.motion.version).toBe(before + 1);
    expect(r.pose?.version).toBe(before + 1);
  });
});

describe('validateMove — 값 자체가 이상한 경우', () => {
  it('숫자가 아니면 거부하고 원래 자리를 돌려준다', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const p = player();
      const r = validateMove(p, { x: bad, y: 0, z: 6.6, ry: 0, version: 0 }, LATER);
      expect(r.reason, String(bad)).toBe('nonfinite');
      expect(r.pose).toMatchObject({ x: 0, z: 6.6 });
    }
  });

  it('요청이 아예 없어도 버틴다', () => {
    expect(validateMove(player(), null, LATER).reason).toBe('nonfinite');
    expect(validateMove(player(), undefined, LATER).reason).toBe('nonfinite');
  });

  it('ry 도 검사한다', () => {
    const r = validateMove(player(), { x: 0, y: 0, z: 6.6, ry: NaN, version: 0 }, LATER);
    expect(r.reason).toBe('nonfinite');
  });
});

describe('validateMove — 높이', () => {
  it('땅 아래로는 못 간다', () => {
    const r = validateMove(player(), { x: 0, y: -1, z: 6.6, ry: 0, version: 0 }, LATER);
    expect(r.reason).toBe('height');
  });

  it('점프 최고점보다 높이 못 뜬다', () => {
    const r = validateMove(
      player(),
      { x: 0, y: MOVEMENT.maxY + 0.1, z: 6.6, ry: 0, version: 0 },
      LATER,
    );
    expect(r.reason).toBe('height');
  });

  it('높이로 거부당하면 땅으로 내려놓는다', () => {
    const p = player({ y: 0.5 });
    validateMove(p, { x: 0, y: 99, z: 6.6, ry: 0, version: 0 }, LATER);
    expect(p.y).toBe(0);
    expect(p.motion.airAt).toBeNull();
  });

  it('최고점까지는 허용한다', () => {
    const p = player();
    expect(validateMove(p, { x: 0, y: MOVEMENT.maxY, z: 6.6, ry: 0, version: 0 }, LATER).ok).toBe(
      true,
    );
  });
});

describe('validateMove — 속도', () => {
  it('한 번에 너무 멀리 가면 거부한다', () => {
    const p = player();
    const r = validateMove(p, { x: 0, y: 0, z: -5, ry: 0, version: 0 }, T0 + 16);
    expect(r.reason).toBe('speed');
  });

  it('가만히 있었다고 이동이 무한히 적립되지는 않는다', () => {
    const p = player();
    // 한 시간을 가만히 있어도 한 번에 건널 수 있는 거리는 제한된다
    const r = validateMove(p, { x: 0, y: 0, z: -9, ry: 0, version: 0 }, T0 + 3_600_000);
    expect(r.reason).toBe('speed');
  });

  it('걸을 만한 거리는 통과한다', () => {
    const p = player();
    const r = validateMove(p, { x: 0.5, y: 0, z: 6.6, ry: 0, version: 0 }, T0 + 200);
    expect(r.ok).toBe(true);
    expect(p.x).toBe(0.5);
  });

  it('움직인 만큼 토큰이 줄어든다', () => {
    const p = player();
    validateMove(p, { x: 0, y: 0, z: 6.6, ry: 0, version: 0 }, T0); // 토큰만 채운다
    const before = p.motion.tokens;
    validateMove(p, { x: 0.5, y: 0, z: 6.6, ry: 0, version: 0 }, T0);
    expect(p.motion.tokens).toBeCloseTo(before - 0.5, 6);
  });

  it('넉백은 상한을 올리는 게 아니라 재충전을 빠르게 한다', () => {
    // 토큰을 다 쓴 직후 50ms 동안 얼마나 차오르는지로 갈린다.
    // 상한(BURST)은 그대로라 "넉백 받았다고 순간이동" 은 여전히 막힌다.
    const drain = (p: MovablePlayer) =>
      validateMove(p, { x: 0, y: 0, z: 5.0, ry: 0, version: 0 }, T0); // 1.6 만큼 소모
    const step = { x: 0, y: 0, z: 4.55, ry: 0, version: 0 }; // 0.45 만큼 더

    const plain = player();
    expect(drain(plain).ok).toBe(true);
    expect(plain.motion.tokens).toBeCloseTo(0, 6);
    expect(validateMove(plain, step, T0 + 50).reason).toBe('speed');

    const knocked = player();
    expect(drain(knocked).ok).toBe(true);
    grantKnockback(knocked, T0);
    expect(validateMove(knocked, step, T0 + 50).ok).toBe(true);
  });

  it('넉백을 받아도 한 번에 방을 가로지르지는 못한다', () => {
    const p = player();
    grantKnockback(p, T0);
    const r = validateMove(p, { x: 0, y: 0, z: -9, ry: 0, version: 0 }, T0 + 3000);
    expect(r.reason).toBe('speed');
  });

  it('넉백은 서버가 확인한 타격에만 준다 — 공중 판정을 함께 푼다', () => {
    const p = player();
    p.motion.airAt = T0;
    grantKnockback(p, T0);
    expect(p.motion.impulseUntil).toBeGreaterThan(T0);
    expect(p.motion.airAt).toBeNull();
  });
});

describe('validateMove — 충돌', () => {
  /* 양끝은 설 수 있는데 사이가 막힌 자리. 거리 1.2 라 속도로는 안 걸린다 —
     토큰을 손으로 넣어봐야 BURST 로 다시 깎이므로 이렇게 잡아야 한다. */
  const NEAR = { x: -3.8, z: -7.4 };
  const ACROSS = { x: -3.8, z: -6.2 };

  it('사이에 설비가 있으면 거리가 짧아도 거부한다', () => {
    const p = player({ ...NEAR });
    const r = validateMove(p, { ...ACROSS, y: 0, ry: 0, version: 0 }, T0);
    expect(r.reason).toBe('collision');
  });

  it('거부해도 플레이어는 원래 자리에 남는다', () => {
    const p = player({ ...NEAR });
    validateMove(p, { ...ACROSS, y: 0, ry: 0, version: 0 }, T0);
    expect({ x: p.x, z: p.z }).toEqual(NEAR);
  });

  it('돌아가는 길이 비어 있으면 통과한다 — 무조건 막는 게 아니다', () => {
    const p = player();
    expect(validateMove(p, { x: 0.4, y: 0, z: 6.6, ry: 0, version: 0 }, T0).ok).toBe(true);
  });
});

describe('validateMove — 공중에 떠 있는 시간', () => {
  it('오래 떠 있으면 끌어내린다', () => {
    const p = player();
    const up = { x: 0, y: 0.5, z: 6.6, ry: 0, version: 0 };
    expect(validateMove(p, up, T0 + 100).ok).toBe(true); // 뜬 순간
    const r = validateMove(p, up, T0 + 1500); // 1.1초를 넘겼다
    expect(r.reason).toBe('airtime');
    expect(p.y).toBe(0);
  });

  it('땅에 닿으면 공중 시계를 지운다', () => {
    const p = player();
    validateMove(p, { x: 0, y: 0.5, z: 6.6, ry: 0, version: 0 }, T0 + 100);
    expect(p.motion.airAt).not.toBeNull();
    validateMove(p, { x: 0, y: 0, z: 6.6, ry: 0, version: 0 }, T0 + 200);
    expect(p.motion.airAt).toBeNull();
  });

  it('짧게 뛰는 것은 막지 않는다', () => {
    const p = player();
    const up = { x: 0, y: 0.5, z: 6.6, ry: 0, version: 0 };
    expect(validateMove(p, up, T0 + 100).ok).toBe(true);
    expect(validateMove(p, up, T0 + 600).ok).toBe(true);
  });
});

describe('validateMove — 통과했을 때', () => {
  it('좌표를 그대로 반영한다', () => {
    const p = player();
    const r = validateMove(p, { x: 0.3, y: 0.2, z: 6.5, ry: 1.2, version: 0 }, LATER);
    expect(r.ok).toBe(true);
    expect(r.pose).toBeUndefined(); // 되돌릴 게 없으면 자세를 안 돌려준다
    expect({ x: p.x, y: p.y, z: p.z }).toEqual({ x: 0.3, y: 0.2, z: 6.5 });
  });

  it('시야각을 -π ~ π 로 정규화한다 — 돌고 돌아 커진 값이 쌓이지 않게', () => {
    const p = player();
    validateMove(p, { x: 0, y: 0, z: 6.6, ry: 100, version: 0 }, LATER);
    expect(p.ry).toBeGreaterThanOrEqual(-Math.PI);
    expect(p.ry).toBeLessThanOrEqual(Math.PI);
    expect(Math.cos(p.ry)).toBeCloseTo(Math.cos(100), 10);
  });

  it('통과할 때는 버전이 그대로다', () => {
    const p = player();
    validateMove(p, { x: 0, y: 0, z: 6.6, ry: 0, version: 0 }, LATER);
    expect(p.motion.version).toBe(0);
  });
});

describe('movementState — 처음 상태', () => {
  it('토큰을 갖고 시작한다 — 접속 직후 첫 걸음이 튕기지 않도록', () => {
    expect(movementState(T0).tokens).toBeGreaterThan(0);
  });

  it('땅에 서 있고 버전은 0이다', () => {
    const m = movementState(T0);
    expect(m.airAt).toBeNull();
    expect(m.version).toBe(0);
    expect(m.impulseUntil).toBe(0);
  });
});
