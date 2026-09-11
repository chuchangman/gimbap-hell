import { clearPath, MOVEMENT } from '@repo/game-core';

/** 예측·지터 허용량. 가만히 있던 시간이 무한한 이동으로 적립되지 않는다. */
const BURST = 1.6;
const SPEED = MOVEMENT.run * 1.04;

export interface MotionState {
  at: number;
  tokens: number;
  version: number;
  airAt: number | null;
  impulseUntil: number;
}

export interface MovablePlayer {
  x: number;
  y: number;
  z: number;
  ry: number;
  motion: MotionState;
}

export interface MoveRequest {
  x: number;
  y: number;
  z: number;
  ry: number;
  version?: number;
}

export type MoveRejectReason = 'stale' | 'nonfinite' | 'height' | 'speed' | 'collision' | 'airtime';

export interface MoveResult {
  ok: boolean;
  reason?: MoveRejectReason;
  pose?: { x: number; y: number; z: number; ry: number; version: number };
}

export function movementState(now: number = performance.now()): MotionState {
  return { at: now, tokens: BURST, version: 0, airAt: null, impulseUntil: 0 };
}

export function grantKnockback(p: { motion: MotionState }, now: number = performance.now()): void {
  // 서버가 확인한 타격만 추가 이동을 허락한다. 클라이언트의 주장으로는 안 된다.
  p.motion.impulseUntil = now + 1100;
  p.motion.airAt = null;
}

export function validateMove(
  p: MovablePlayer,
  d: MoveRequest | null | undefined,
  now: number = performance.now(),
): MoveResult {
  const m = p.motion || (p.motion = movementState(now));
  if ((d?.version ?? 0) !== m.version) return { ok: false, reason: 'stale' };
  const elapsed = Math.max(0, now - m.at) / 1000;
  m.at = now;
  const impulse = now < m.impulseUntil ? 5.4 : 0;
  m.tokens = Math.min(BURST, m.tokens + elapsed * (SPEED + impulse));
  const reject = (reason: MoveRejectReason): MoveResult => {
    m.version++;
    if (reason === 'height' || reason === 'airtime') {
      p.y = 0;
      m.airAt = null;
    }
    return {
      ok: false,
      reason,
      pose: { x: p.x, y: p.y, z: p.z, ry: p.ry, version: m.version },
    };
  };
  if (!d || !(['x', 'y', 'z', 'ry'] as const).every((k) => Number.isFinite(d[k])))
    return reject('nonfinite');
  if (d.y < 0 || d.y > MOVEMENT.maxY) return reject('height');
  const distance = Math.hypot(d.x - p.x, d.z - p.z);
  if (distance > m.tokens + 0.001) return reject('speed');
  if (!clearPath(p, d)) return reject('collision');
  if (d.y > 0.03) {
    if (m.airAt === null) m.airAt = now;
    if (now - m.airAt > 1100) return reject('airtime');
  } else m.airAt = null;
  m.tokens = Math.max(0, m.tokens - distance);
  p.x = d.x;
  p.z = d.z;
  p.y = d.y;
  p.ry = Math.atan2(Math.sin(d.ry), Math.cos(d.ry));
  return { ok: true };
}
