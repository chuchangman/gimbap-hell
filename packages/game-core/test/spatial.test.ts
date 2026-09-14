/* 충돌과 상호작용 거리. 서버가 이 함수들로 검증하므로
   여기가 틀리면 벽을 뚫거나 멀리서 설비를 만지게 된다. */
import { describe, expect, it } from 'vitest';
import {
  actionBox,
  clearPath,
  clearPosition,
  interactionDistance,
  MOVEMENT,
  STATION_BOXES,
  stationBox,
  WORLD_SOLIDS,
  type Box,
} from '../src/spatial.js';

const center = (r: (typeof WORLD_SOLIDS)[number]) => ({
  x: (r.minX + r.maxX) / 2,
  z: (r.minZ + r.maxZ) / 2,
});
const inBounds = (p: { x: number; z: number }) =>
  p.x > MOVEMENT.minX && p.x < MOVEMENT.maxX && p.z > MOVEMENT.minZ && p.z < MOVEMENT.maxZ;

describe('clearPosition — 설 수 있는 자리인가', () => {
  it('이동 범위 밖은 막는다', () => {
    expect(clearPosition({ x: MOVEMENT.minX - 0.1, z: 0 })).toBe(false);
    expect(clearPosition({ x: MOVEMENT.maxX + 0.1, z: 0 })).toBe(false);
    expect(clearPosition({ x: 0, z: MOVEMENT.minZ - 0.1 })).toBe(false);
    expect(clearPosition({ x: 0, z: MOVEMENT.maxZ + 0.1 })).toBe(false);
  });

  it('설비·벽 한가운데에는 설 수 없다', () => {
    const inside = WORLD_SOLIDS.map(center).filter(inBounds);
    expect(inside.length).toBeGreaterThan(0); // 검사할 대상이 실제로 있어야 한다
    for (const p of inside) {
      expect(clearPosition(p), `(${p.x}, ${p.z})`).toBe(false);
    }
  });

  it('빈 통로에는 설 수 있다', () => {
    expect(clearPosition({ x: 0, z: 6.6 })).toBe(true);
  });

  it('반지름을 키우면 통과하던 자리가 막힐 수 있다', () => {
    const p = { x: 0, z: 6.6 };
    expect(clearPosition(p, 0.01)).toBe(true);
    expect(clearPosition(p, 99)).toBe(false); // 반지름이 방보다 크면 어디도 못 선다
  });

  it('몸 반지름만큼 벽에서 떨어져야 한다', () => {
    const wall = WORLD_SOLIDS.map(center).filter(inBounds)[0];
    // 벽 중심에서 아주 조금 떨어진 자리는 여전히 막힌다
    expect(clearPosition({ x: wall.x + 0.01, z: wall.z })).toBe(false);
  });
});

describe('clearPath — 두 점 사이를 지나갈 수 있는가', () => {
  it('설비를 가로지르면 막는다', () => {
    const solid = WORLD_SOLIDS.map(center).filter(inBounds)[0];
    const a = { x: solid.x - 3, z: solid.z };
    const b = { x: solid.x + 3, z: solid.z };
    expect(clearPath(a, b)).toBe(false);
  });

  it('빈 통로는 지나갈 수 있다', () => {
    expect(clearPath({ x: -1.6, z: 6.6 }, { x: 1.6, z: 6.6 })).toBe(true);
  });

  it('제자리는 그 자리가 비어 있으면 통과다', () => {
    expect(clearPath({ x: 0, z: 6.6 }, { x: 0, z: 6.6 })).toBe(true);
  });

  it('막힌 자리로 가는 길은 길이에 상관없이 막는다', () => {
    const solid = WORLD_SOLIDS.map(center).filter(inBounds)[0];
    expect(clearPath({ x: 0, z: 6.6 }, solid)).toBe(false);
  });

  it('방향을 뒤집어도 같은 답이다', () => {
    const a = { x: -1.6, z: 6.6 };
    const b = { x: 1.6, z: 6.6 };
    expect(clearPath(a, b)).toBe(clearPath(b, a));
  });
});

describe('interactionDistance — 설비까지 거리', () => {
  const b: Box = { x: 0, y: 1.82, z: 0, w: 1, h: 1, d: 1 }; // 눈높이에 걸친 상자

  it('상자가 없으면 무한대 — 절대 닿지 않는다', () => {
    expect(interactionDistance({ x: 0, z: 0 }, null)).toBe(Infinity);
  });

  it('상자 안이면 0', () => {
    expect(interactionDistance({ x: 0, z: 0 }, b)).toBe(0);
  });

  it('멀어지면 커진다', () => {
    const near = interactionDistance({ x: 1, z: 0 }, b);
    const far = interactionDistance({ x: 5, z: 0 }, b);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('상자 표면까지의 거리를 잰다 — 중심까지가 아니다', () => {
    expect(interactionDistance({ x: 5, z: 0 }, b)).toBeCloseTo(5 - b.w / 2, 10);
  });

  it('좌우 대칭이다', () => {
    expect(interactionDistance({ x: 3, z: 0 }, b)).toBeCloseTo(
      interactionDistance({ x: -3, z: 0 }, b),
      10,
    );
  });

  it('점프하면 높이 차이도 센다', () => {
    const ground = interactionDistance({ x: 0, z: 0, y: 0 }, b);
    const air = interactionDistance({ x: 0, z: 0, y: 3 }, b);
    expect(air).toBeGreaterThan(ground);
  });
});

describe('stationBox — 설비 이름으로 상호작용 상자 찾기', () => {
  it('모르는 설비는 null', () => {
    expect(stationBox({ kind: '없는설비' })).toBeNull();
  });

  it('단일 설비는 바로 찾는다', () => {
    for (const kind of ['sink', 'bin', 'serve']) {
      expect(stationBox({ kind }), kind).not.toBeNull();
    }
  });

  it('여러 개인 설비는 번호로 찾는다', () => {
    const numbered: [string, string, readonly Box[]][] = [
      ['cooker', 'cooker', STATION_BOXES.cooker],
      ['burner', 'slot', STATION_BOXES.burner],
      ['board', 'board', STATION_BOXES.board],
      ['mat', 'mat', STATION_BOXES.mat],
      ['broom', 'rack', STATION_BOXES.broom],
    ];
    for (const [kind, field, list] of numbered) {
      expect(list.length, kind).toBeGreaterThan(0);
      for (let i = 0; i < list.length; i++) {
        expect(stationBox({ kind, [field]: i }), `${kind} ${i}`).not.toBeNull();
      }
      expect(stationBox({ kind, [field]: list.length }), `${kind} 범위 밖`).toBeNull();
      expect(stationBox({ kind, [field]: -1 }), `${kind} 음수`).toBeNull();
      expect(stationBox({ kind, [field]: 0.5 }), `${kind} 소수`).toBeNull();
      expect(stationBox({ kind }), `${kind} 번호 없음`).toBeNull();
    }
  });

  it('냉장고는 재료 이름으로 찾는다', () => {
    expect(stationBox({ kind: 'fridge', item: 'gim' })).not.toBeNull();
    expect(stationBox({ kind: 'fridge', item: '없는재료' })).toBeNull();
    expect(stationBox({ kind: 'fridge' })).toBeNull();
  });
});

describe('actionBox — 행동 이름으로 상자 찾기', () => {
  it('버리기는 상자가 없다 — 아무 데서나 된다', () => {
    expect(actionBox('drop')).toBeNull();
  });

  it('서빙은 손님 자리로 상자를 만든다', () => {
    expect(actionBox('serve', { customerId: 'c1' }, { slot: 0 })).not.toBeNull();
    expect(actionBox('serve', { customerId: 'c1' }, null)).toBeNull();
  });

  it('설비 행동은 콜론 앞을 설비 이름으로 읽는다', () => {
    expect(actionBox('sink:rinse')).toEqual(STATION_BOXES.sink);
    expect(actionBox('board:cut', { board: 0 })).toEqual(STATION_BOXES.board[0]);
  });
});

describe('MOVEMENT — 이동 수치', () => {
  it('뛰는 게 걷는 것보다 빠르다', () => {
    expect(MOVEMENT.run).toBeGreaterThan(MOVEMENT.walk);
  });

  it('중력은 아래로 당긴다', () => {
    expect(MOVEMENT.gravity).toBeLessThan(0);
  });

  it('이동 범위가 뒤집혀 있지 않다', () => {
    expect(MOVEMENT.minX).toBeLessThan(MOVEMENT.maxX);
    expect(MOVEMENT.minZ).toBeLessThan(MOVEMENT.maxZ);
  });
});
