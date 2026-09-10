/* 마이그레이션 기간에만 쓰는 레거시 모듈 로더.
 *
 * 동등성 테스트가 읽는 server/*.mjs 에는 타입 선언이 없다. 정적 import 는
 * strict 모드에서 TS7016 으로 막히므로 지정자를 변수로 넘겨 불러온다.
 *
 * 아래 인터페이스는 "동등성 테스트가 레거시의 어느 표면에 의존하는가" 를
 * 그대로 적은 목록이다. 이 목록이 곧 3단계에서 이식을 끝내야 하는 범위다.
 * 5단계에서 레거시 스택이 사라질 때 이 파일도 함께 사라진다. */
import type { IncomingMessage } from 'node:http';
import type { MotionState, MovablePlayer, MoveResult } from '../domain/movement.js';

const LEGACY_ROOT = new URL('../../../../server/', import.meta.url).href;

export interface LegacyProtocol {
  validKitchenAction(action: unknown, payload?: unknown): boolean;
  validEvent(event: string, d: unknown): boolean;
  EVENT_BUDGET: Record<string, [number, number]>;
  createEventLimiter(now?: () => number): (event: string) => boolean;
  allowedOrigin(req: IncomingMessage, configured?: string): boolean;
}

export interface LegacyMovement {
  movementState(now?: number): MotionState;
  grantKnockback(p: { motion: MotionState }, now?: number): void;
  validateMove(p: MovablePlayer, d: unknown, now?: number): MoveResult;
}

export interface LegacyKitchenInstance {
  uid: number;
  hands: Map<string, unknown>;
  mess: number;
  wasted: number;
  reset(): void;
  shiftTime(ms: number): void;
  join(id: string): void;
  leave(id: string): void;
  hand(id: string): unknown;
  setHand(id: string, item: unknown): void;
  hasBroom(id: string): boolean;
  dropFor(id: string): unknown;
  rollDone(m: unknown): boolean;
  tick(): { msg: string; kind: string }[];
  act(pid: string, action: string, p?: unknown): unknown;
  takeGimbap(pid: string): unknown;
  snapshot(): unknown;
}

export interface LegacyKitchen {
  Kitchen: new () => LegacyKitchenInstance;
  nowMs(): number;
}

export interface LegacyWaveInstance {
  uid: number;
  wave: number;
  phase: string;
  phaseEndsAt: number;
  active: { id: string; state: string; fills: string[]; done: number; need: number }[];
  pending: unknown[];
  reputation: number;
  score: number;
  happy: number;
  angry: number;
  kicked: number;
  result: string | null;
  reset(): void;
  shiftTime(ms: number): void;
  tick(): unknown[];
  serve(rollFills: unknown, customerId?: string): unknown;
  hit(id: string): unknown;
  bestMatch(rollFills: unknown): unknown;
  nextTarget(rollFills?: unknown): unknown;
  waitingById(id: string): unknown;
  snapshot(rollFills?: unknown): unknown;
  buildWave(n: number): unknown;
  startWave(n: number): unknown;
  available(wave: number): string[];
  kioskOrder(wave: number): string[];
  counterOrder(wave: number): string[];
  nextUnlock(): unknown;
}

export interface LegacyWaves {
  WaveRunner: new (playerCount: number) => LegacyWaveInstance;
}

export interface LegacyRankingPolicy {
  RANKING_POLICY: Record<string, number | string>;
  rankingRetryDelay(retryMs: number, consecutiveFailures: number): number;
}

interface LegacyModules {
  'protocol.mjs': LegacyProtocol;
  'movement.mjs': LegacyMovement;
  'kitchen.mjs': LegacyKitchen;
  'waves.mjs': LegacyWaves;
  'ranking-policy.mjs': LegacyRankingPolicy;
}

export async function loadLegacy<K extends keyof LegacyModules>(
  fileName: K,
): Promise<LegacyModules[K]> {
  return (await import(/* @vite-ignore */ LEGACY_ROOT + fileName)) as LegacyModules[K];
}
