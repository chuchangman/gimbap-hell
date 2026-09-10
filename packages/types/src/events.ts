/* 소켓 이벤트 계약. 이름·페이로드는 지금 돌고 있는 서버와 한 글자도 다르면 안 된다. */
import type { HeldItem, ItemId, Look } from '@repo/game-core';
import type { KitchenSnapshot, Pose, PositionsPacket, PublicState, ToastKind } from './snapshot.js';

/** 성공/실패를 한 모양으로 돌려주는 ack */
export type Ack<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; err: string };

export type RoomAck = Ack<{ code: string; youId: string }>;

export interface HelloPayload {
  id: string;
  waves: number;
  restored: boolean;
  recoveryMs: number;
  motionVersion: number;
  pose: Pose | null;
}

export interface ToastPayload {
  msg: string;
  kind: ToastKind;
}

export interface WaveEndPayload {
  wave: number;
  happy: number;
  angry: number;
  victory: boolean;
}

export interface SwingPayload {
  by: string;
}

export interface HitPayload {
  target: string;
  by: string;
  dirX: number;
  dirZ: number;
  power: number;
  dropped: ItemId | null;
}

export type PoseCorrection = Pose & { version: number };

/* ──────────────── 주방 동작 ──────────────── */
export type KitchenActionName =
  | 'fridge:take'
  | 'sink:put'
  | 'sink:rinse'
  | 'sink:take'
  | 'cooker:put'
  | 'cooker:take'
  | 'burner:put'
  | 'burner:take'
  | 'board:put'
  | 'board:take'
  | 'mat:put'
  | 'mat:undo'
  | 'mat:roll'
  | 'mat:take'
  | 'bin:drop'
  | 'drop'
  | 'broom:take'
  | 'serve';

export interface KitchenActionPayload {
  item?: ItemId;
  cooker?: number;
  slot?: number;
  board?: number;
  mat?: number;
  rack?: number;
  customerId?: string;
}

export interface KitchenActMessage {
  action: KitchenActionName;
  payload?: KitchenActionPayload;
}

/** 주방 동작 결과 — 토스트 문구와 브로드캐스트 여부를 함께 돌려준다 */
export interface ActionResult {
  ok: boolean;
  msg?: string;
  kind?: ToastKind;
  broadcast?: boolean;
  rejected?: string;
  completed?: boolean;
  gain?: number;
  quality?: number;
}

/* ──────────────── 이벤트 맵 ──────────────── */
export interface ServerToClientEvents {
  hello: (payload: HelloPayload) => void;
  state: (state: PublicState) => void;
  kitchen: (kitchen: KitchenSnapshot) => void;
  positions: (packet: PositionsPacket) => void;
  toast: (payload: ToastPayload) => void;
  waveEnd: (payload: WaveEndPayload) => void;
  swing: (payload: SwingPayload) => void;
  hit: (payload: HitPayload) => void;
  'position:correct': (payload: PoseCorrection) => void;
  'server:closing': (payload: { msg: string }) => void;
}

export interface ClientToServerEvents {
  'room:create': (
    data: { name: string; shop?: string; look?: Partial<Look> },
    ack?: (result: RoomAck) => void,
  ) => void;
  'room:join': (
    data: { name: string; code: string; look?: Partial<Look> },
    ack?: (result: RoomAck) => void,
  ) => void;
  'room:leave': (data: null | undefined, ack?: (result: Ack) => void) => void;
  'game:start': () => void;
  'game:pause': () => void;
  'game:lobby': () => void;
  'kitchen:act': (data: KitchenActMessage) => void;
  'player:move': (data: Pose & { version?: number }) => void;
  'player:swing': (
    data?: { targetId?: string | null; targetKind?: 'player' | 'customer' | null } | null,
  ) => void;
}

/** 손에 든 것 — @repo/game-core 의 정의를 그대로 쓴다 */
export type { HeldItem };
