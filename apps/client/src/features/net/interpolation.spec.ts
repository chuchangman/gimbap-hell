import { createPositionBuffer, unpack } from '@/features/net/interpolation';
import { NET } from '@repo/game-core';
import { describe, expect, it } from 'vitest';

/* 보간 버퍼는 눈에 잘 안 보이는 규칙이 세 개 있다.
     · 자리를 새 사람이 물려받으면 옛 표본을 버린다 (안 버리면 미끄러져 온다)
     · 뒤늦게 도착한 패킷은 버린다
     · 오래된 표본은 정리하되 앞뒤 두 개는 항상 남긴다 (없는 미래를 지어내지 않도록)
   레거시 net.js 안에서는 모듈 전역이라 테스트가 닿지 못했다. */

const tuple = (slot: number, x: number, z: number, y = 0, ry = 0) =>
  [slot, x, z, y, ry] as [number, number, number, number, number];

describe('unpack', () => {
  it('배열 형식과 옛 객체 형식을 모두 받는다', () => {
    expect(unpack(tuple(2, 1.5, -3, 0.5, 1))).toEqual({ slot: 2, x: 1.5, z: -3, y: 0.5, ry: 1 });
    expect(unpack({ slot: 1, x: 1, z: 2, y: 0, ry: 0 })).toEqual({
      slot: 1,
      x: 1,
      z: 2,
      y: 0,
      ry: 0,
    });
    // y 가 빠진 옛 패킷은 0 으로 채운다
    expect(unpack([0, 1, 2, undefined as never, 0.5])).toEqual({
      slot: 0,
      x: 1,
      z: 2,
      y: 0,
      ry: 0.5,
    });
  });
});

describe('createPositionBuffer', () => {
  it('두 표본 사이를 등속으로 지나간다', () => {
    const buf = createPositionBuffer(() => 'other');
    buf.push(1000, [tuple(0, 0, 0)]);
    buf.push(1100, [tuple(0, 1, 2)]);
    // sample 은 at - interpMs 시점을 재생한다
    const mid = buf.sample(1050 + NET.interpMs, null);
    expect(mid).toHaveLength(1);
    expect(mid[0].x).toBeCloseTo(0.5, 10);
    expect(mid[0].z).toBeCloseTo(1, 10);
  });

  it('내 자리는 그리지 않는다', () => {
    const buf = createPositionBuffer((slot) => (slot === 0 ? 'me' : 'other'));
    buf.push(1000, [tuple(0, 0, 0), tuple(1, 5, 5)]);
    buf.push(1100, [tuple(0, 1, 1), tuple(1, 6, 6)]);
    const out = buf.sample(1100 + NET.interpMs, 'me');
    expect(out.map((p) => p.id)).toEqual(['other']);
  });

  it('누군지 모르는 자리는 그리지 않는다', () => {
    const buf = createPositionBuffer(() => null);
    buf.push(1000, [tuple(0, 0, 0)]);
    expect(buf.sample(1000 + NET.interpMs, null)).toEqual([]);
  });

  it('자리를 새 사람이 물려받으면 옛 표본을 버린다', () => {
    let occupant = 'first';
    const buf = createPositionBuffer(() => occupant);
    buf.push(1000, [tuple(0, -5, -5)]);
    buf.push(1100, [tuple(0, -5, -5)]);
    expect(buf.size(0)).toBe(2);

    // 같은 자리에 다른 사람이 들어왔다
    occupant = 'second';
    buf.push(1200, [tuple(0, 5, 5)]);
    expect(buf.size(0), '옛 좌표가 남으면 새 사람이 미끄러져 온다').toBe(1);
    const out = buf.sample(1200 + NET.interpMs, null);
    expect(out[0]).toMatchObject({ id: 'second', x: 5, z: 5 });
  });

  it('뒤늦게 온 패킷은 버린다', () => {
    const buf = createPositionBuffer(() => 'other');
    buf.push(1000, [tuple(0, 0, 0)]);
    buf.push(1100, [tuple(0, 1, 1)]);
    buf.push(1050, [tuple(0, 99, 99)]); // 늦게 도착
    buf.push(1100, [tuple(0, 88, 88)]); // 같은 시각도 버린다
    expect(buf.size(0)).toBe(2);
    const out = buf.sample(1100 + NET.interpMs, null);
    expect(out[0]).toMatchObject({ x: 1, z: 1 });
  });

  it('오래된 표본을 정리하되 앞뒤 두 개는 남긴다', () => {
    const buf = createPositionBuffer(() => 'other');
    for (let i = 0; i <= 40; i++) buf.push(1000 + i * 100, [tuple(0, i, 0)]);
    // 4초를 흘렸으므로 1초 창 안의 표본만 남아야 한다 (최소 2개는 보장)
    expect(buf.size(0)).toBeGreaterThanOrEqual(2);
    expect(buf.size(0)).toBeLessThanOrEqual(12);
    // 범위 밖을 물으면 없는 미래를 지어내지 않고 끝값을 준다
    const future = buf.sample(9_999_999, null);
    expect(future[0]).toMatchObject({ x: 40 });
  });

  it('패킷에서 사라진 자리는 버퍼에서도 지운다', () => {
    const buf = createPositionBuffer(() => 'other');
    buf.push(1000, [tuple(0, 0, 0), tuple(1, 1, 1)]);
    expect(buf.size(1)).toBe(1);
    buf.push(1100, [tuple(0, 0, 0)]);
    expect(buf.size(1)).toBe(0);
    expect(buf.sample(1100 + NET.interpMs, null)).toHaveLength(1);
  });

  it('clear 가 전부 비운다', () => {
    const buf = createPositionBuffer(() => 'other');
    buf.push(1000, [tuple(0, 0, 0)]);
    buf.clear();
    expect(buf.size(0)).toBe(0);
    expect(buf.sample(1000 + NET.interpMs, null)).toEqual([]);
  });
});
