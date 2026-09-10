import { MOVEMENT } from '@repo/game-core';
import { describe, expect, it } from 'vitest';
import { loadLegacy } from '../testing/legacy.js';
import {
  grantKnockback,
  movementState,
  validateMove,
  type MoveRequest,
} from './movement.js';

const legacy = await loadLegacy('movement.mjs');

/* 이동 검증은 서버 권위의 핵심이라 레거시와 한 프레임도 다르면 안 된다.
   같은 시각·같은 요청을 두 구현에 넣고 판정과 보정 위치를 대조한다.
   test/spatial.test.mjs 의 시나리오(점프 · 넉백 · 벽 통과 · 적립)를 그대로 포함한다. */

interface Pose {
  x: number;
  y: number;
  z: number;
  ry: number;
}

const spawn = (): Pose => ({ x: -1.6, y: 0, z: 5.6, ry: 0 });

/** 두 구현에 각자의 플레이어 객체를 주고 같은 요청 열을 흘린다 */
const bothPlayers = () => ({
  mine: { ...spawn(), motion: movementState(0) },
  theirs: { ...spawn(), motion: legacy.movementState(0) },
});

const step = (
  players: ReturnType<typeof bothPlayers>,
  d: MoveRequest,
  now: number,
  label: string,
) => {
  const a = validateMove(players.mine, d, now);
  const b = legacy.validateMove(players.theirs, d, now);
  expect(a, label).toEqual(b);
  expect(
    { x: players.mine.x, y: players.mine.y, z: players.mine.z, ry: players.mine.ry },
    label + ' pose',
  ).toEqual({
    x: players.theirs.x,
    y: players.theirs.y,
    z: players.theirs.z,
    ry: players.theirs.ry,
  });
  expect(players.mine.motion, label + ' motion').toEqual(players.theirs.motion);
};

describe('movementState', () => {
  it('초기 상태가 레거시와 같다', () => {
    expect(movementState(1234)).toEqual(legacy.movementState(1234));
  });
});

describe('validateMove', () => {
  it('보통 달리기는 두 구현 모두 통과시킨다', () => {
    const p = bothPlayers();
    let now = 0;
    for (let i = 1; i <= 40; i++) {
      now += 67;
      step(p, { x: -1.6, y: 0, z: 5.6 - i * 0.2, ry: 0, version: 0 }, now, 'run#' + i);
    }
  });

  it('version 이 어긋난 요청은 두 구현 모두 stale 로 버린다', () => {
    const p = bothPlayers();
    step(p, { x: -1.6, y: 0, z: 5.4, ry: 0, version: 7 }, 100, 'stale');
    step(p, { x: -1.6, y: 0, z: 5.4, ry: 0 }, 200, 'no version');
  });

  it('순간이동 · 벽 통과 · 방 밖은 같은 이유로 거절되고 같은 보정 위치를 준다', () => {
    const cases: [MoveRequest, string][] = [
      [{ x: 7, y: 0, z: 5.6, ry: 0 }, 'teleport'],
      [{ x: -1.6, y: 0, z: -1.2, ry: 0 }, 'through boards'],
      [{ x: -20, y: 0, z: 0, ry: 0 }, 'outside'],
      [{ x: NaN, y: 0, z: 0, ry: 0 }, 'nan'],
      [{ x: 0, y: -1, z: 0, ry: 0 }, 'below floor'],
      [{ x: 0, y: MOVEMENT.maxY + 1, z: 0, ry: 0 }, 'too high'],
    ];
    for (const [d, label] of cases) {
      const p = bothPlayers();
      step(p, { ...d, version: 0 }, 100, label);
    }
  });

  it('점프 궤적은 통과하고 공중에 계속 떠 있으면 같은 시점에 보정된다', () => {
    const p = bothPlayers();
    let now = 0;
    for (let i = 0; i < 30; i++) {
      now += 67;
      step(p, { x: -1.6, y: 0.5, z: 5.6, ry: 0, version: p.mine.motion.version }, now, 'hover#' + i);
    }
  });

  it('서버가 확인한 넉백만 추가 이동을 허락한다', () => {
    const p = bothPlayers();
    grantKnockback(p.mine, 1000);
    legacy.grantKnockback(p.theirs, 1000);
    expect(p.mine.motion).toEqual(p.theirs.motion);
    let now = 1000;
    for (let i = 1; i <= 12; i++) {
      now += 67;
      step(p, { x: -1.6 + i * 0.35, y: 0, z: 5.6, ry: 0, version: 0 }, now, 'knockback#' + i);
    }
  });

  it('가만히 있던 시간을 순간이동으로 적립할 수 없다', () => {
    const p = bothPlayers();
    step(p, { x: -1.6, y: 0, z: 5.6, ry: 0, version: 0 }, 60000, 'idle then jump');
    step(p, { x: 3.2, y: 0, z: 5.6, ry: 0, version: p.mine.motion.version }, 60001, 'banked');
  });

  it('회전값을 레거시와 같은 방식으로 정규화한다', () => {
    for (const ry of [0, 3.2, -3.2, 7, -7, Math.PI, -Math.PI]) {
      const p = bothPlayers();
      step(p, { x: -1.6, y: 0, z: 5.6, ry, version: 0 }, 100, 'ry=' + ry);
    }
  });
});
