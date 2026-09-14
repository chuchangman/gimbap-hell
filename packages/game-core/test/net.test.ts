/* 원격 플레이어 보간. 여기가 틀리면 남의 아바타가 벽을 뚫거나
   한 바퀴 팽 돌아버린다 — 스모크로는 절대 안 잡히는 종류다. */
import { describe, expect, it } from 'vitest';
import { NET, samplePath, shortestTurn, type PathSample } from '../src/net.js';

const s = (t: number, x = 0, z = 0, ry = 0, y?: number): PathSample => ({ t, x, z, ry, y });

describe('shortestTurn — 두 각도 사이 최단 회전', () => {
  it('경계를 넘을 때 한 바퀴 돌지 않는다', () => {
    // 3.1 → -3.1 은 실제로 0.083 만큼만 돌면 된다
    expect(shortestTurn(3.1, -3.1)).toBeCloseTo(Math.PI * 2 - 6.2, 10);
    expect(Math.abs(shortestTurn(3.1, -3.1))).toBeLessThan(0.2);
  });

  it('반대 방향도 마찬가지다', () => {
    expect(Math.abs(shortestTurn(-3.1, 3.1))).toBeLessThan(0.2);
    expect(shortestTurn(-3.1, 3.1)).toBeCloseTo(-shortestTurn(3.1, -3.1), 10);
  });

  it('결과는 언제나 -π ~ π 안이다', () => {
    for (let from = -10; from <= 10; from += 0.37) {
      for (let to = -10; to <= 10; to += 0.53) {
        const d = shortestTurn(from, to);
        expect(d, `${from} → ${to}`).toBeGreaterThanOrEqual(-Math.PI);
        expect(d, `${from} → ${to}`).toBeLessThanOrEqual(Math.PI);
      }
    }
  });

  it('같은 각도면 0', () => {
    expect(shortestTurn(1.2, 1.2)).toBe(0);
  });

  it('한 바퀴 차이는 0으로 본다', () => {
    expect(shortestTurn(0, Math.PI * 2)).toBeCloseTo(0, 10);
    expect(shortestTurn(0, -Math.PI * 2)).toBeCloseTo(0, 10);
  });

  it('회전을 더한 값이 실제로 목표 각도와 같은 방향을 가리킨다', () => {
    for (const [from, to] of [
      [3.1, -3.1],
      [0, 3],
      [-2, 2],
      [1, -1],
    ]) {
      const landed = from + shortestTurn(from, to);
      expect(Math.cos(landed)).toBeCloseTo(Math.cos(to), 10);
      expect(Math.sin(landed)).toBeCloseTo(Math.sin(to), 10);
    }
  });
});

describe('samplePath — 표본 사이에서 위치 뽑기', () => {
  it('표본이 없으면 null', () => {
    expect(samplePath([], 0)).toBeNull();
    expect(samplePath(null, 0)).toBeNull();
    expect(samplePath(undefined, 0)).toBeNull();
  });

  it('첫 표본보다 이른 시각은 첫 표본 그대로 — 없는 과거를 지어내지 않는다', () => {
    const buf = [s(100, 1), s(200, 2)];
    expect(samplePath(buf, 0)).toEqual(buf[0]);
    expect(samplePath(buf, 100)).toEqual(buf[0]);
  });

  it('마지막 표본보다 늦은 시각은 마지막 표본 그대로 — 없는 미래를 지어내지 않는다', () => {
    // 외삽하면 벽을 뚫고 나갔다가 되돌아오는 것처럼 보인다
    const buf = [s(100, 1), s(200, 2)];
    expect(samplePath(buf, 200)).toEqual(buf[1]);
    expect(samplePath(buf, 9999)).toEqual(buf[1]);
  });

  it('중간 시각은 선형 보간한다', () => {
    const buf = [s(0, 0, 0), s(100, 10, 20)];
    const r = samplePath(buf, 50)!;
    expect(r.t).toBe(50);
    expect(r.x).toBeCloseTo(5, 10);
    expect(r.z).toBeCloseTo(10, 10);
  });

  it('표본이 셋 이상이면 맞는 구간을 고른다', () => {
    const buf = [s(0, 0), s(100, 10), s(200, 30)];
    expect(samplePath(buf, 150)!.x).toBeCloseTo(20, 10);
    expect(samplePath(buf, 50)!.x).toBeCloseTo(5, 10);
  });

  it('y 가 없는 표본은 0으로 친다 — undefined 가 NaN 으로 번지지 않게', () => {
    const buf = [s(0, 0, 0, 0), s(100, 0, 0, 0)];
    const r = samplePath(buf, 50)!;
    expect(r.y).toBe(0);
    expect(Number.isNaN(r.y!)).toBe(false);
  });

  it('y 가 있으면 같이 보간한다 — 점프가 끊기지 않도록', () => {
    const buf = [s(0, 0, 0, 0, 0), s(100, 0, 0, 0, 2)];
    expect(samplePath(buf, 50)!.y).toBeCloseTo(1, 10);
  });

  it('같은 시각 표본이 겹쳐도 0으로 나누지 않는다', () => {
    const buf = [s(100, 1), s(100, 5), s(200, 9)];
    const r = samplePath(buf, 100)!;
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isNaN(r.x)).toBe(false);
  });

  it('회전도 최단 경로로 보간한다 — 중간에 한 바퀴 돌지 않는다', () => {
    const buf = [s(0, 0, 0, 3.1), s(100, 0, 0, -3.1)];
    const mid = samplePath(buf, 50)!;
    // 3.1 과 -3.1 의 중간은 0 이 아니라 π 근처여야 한다
    expect(Math.abs(mid.ry)).toBeGreaterThan(3.1);
  });

  it('구간 안에서 x 가 단조롭게 흐른다', () => {
    const buf = [s(0, 0), s(100, 10)];
    let prev = -Infinity;
    for (let t = 0; t <= 100; t += 10) {
      const x = samplePath(buf, t)!.x;
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });
});

describe('NET — 동기화 주기', () => {
  it('보간 지연이 송신 주기보다 길다 — 한 번 빠져도 버티려면', () => {
    expect(NET.interpMs).toBeGreaterThan(NET.tickMs);
  });

  it('주기가 양수다', () => {
    expect(NET.tickMs).toBeGreaterThan(0);
    expect(NET.interpMs).toBeGreaterThan(0);
  });
});
