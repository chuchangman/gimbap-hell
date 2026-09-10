/* 서버가 뿌리는 스냅샷. 지금 나가고 있는 페이로드를 그대로 옮긴 것이라
 * 필드를 빼거나 이름을 바꾸면 그 순간 프로토콜이 깨진다. */
import type { CustomerKind, HeldItem, ItemId, Look } from '@repo/game-core';

export type RoomPhase = 'lobby' | 'playing' | 'result';
export type WavePhase = 'prep' | 'wave' | 'over';
export type CustomerState = 'pending' | 'walkin' | 'wait' | 'happy' | 'angry' | 'kicked';
export type GameResultKind = 'victory' | 'defeat';
export type ToastKind = 'good' | 'warn' | 'bad';

export interface Pose {
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface PlayerView {
  id: string;
  slot: number;
  name: string;
  color: string;
  look: Look;
  connected: boolean;
  spawn: Pose;
}

export interface CustomerView {
  id: string;
  kind: CustomerKind;
  name: string;
  emoji: string;
  color: number;
  fills: ItemId[];
  need: number;
  done: number;
  slot: number;
  state: CustomerState;
  since: number;
  seed: number;
  patienceMax: number;
  deadline: number;
  hp: number;
  hpMax: number;
}

export interface WaveSnapshot {
  now: number;
  wave: number;
  totalWaves: number;
  phase: WavePhase;
  phaseEndsAt: number;
  waiting: number;
  unlocked: ItemId[];
  nextUnlock: { wave: number; id: ItemId; name: string } | null;
  customers: CustomerView[];
  targetId: string | null;
  reputation: number;
  score: number;
  servedRolls: number;
  avgQuality: number;
  happy: number;
  angry: number;
  kicked: number;
  result: GameResultKind | null;
}

export interface HistoryEntry {
  kind: GameResultKind;
  wave: number;
  score: number;
  rank: number | null;
  at: number;
}

export interface StorageStatus {
  ready: boolean;
  error?: string | null;
  [key: string]: unknown;
}

export interface LeaderboardRow {
  id: string;
  shop: string;
  score: number;
  wave: number;
  totalWaves: number;
  kind: GameResultKind;
  players: string[];
  rolls: number;
  avgQuality: number;
  /** ISO-8601 UTC — 예: "2026-09-10T06:14:22.031Z" */
  at: string;
}

export interface PublicBoard {
  top: LeaderboardRow[];
  myRank: number | null;
  total: number;
  outside: LeaderboardRow | null;
}

export interface ResultView {
  kind: GameResultKind;
  shop: string;
  wave: number;
  totalWaves: number;
  score: number;
  rawScore: number;
  messPenalty: number;
  mess: number;
  reputation: number;
  reputationMax: number;
  servedRolls: number;
  avgQuality: number;
  happy: number;
  angry: number;
  players: { name: string; color: string }[];
  rank: number | null;
  board: PublicBoard;
  entryId: string;
  storage: StorageStatus;
}

export interface PublicState {
  now: number;
  code: string;
  shop: string;
  phase: RoomPhase;
  paused: boolean;
  pausedAt: number;
  hostId: string | null;
  players: PlayerView[];
  wave: WaveSnapshot | null;
  result: ResultView | null;
  history: HistoryEntry[];
}

export interface CookerState {
  state: 'empty' | 'cooking' | 'ready';
  at: number;
  servings: number;
}

export interface BurnerCell {
  id: ItemId;
  at: number;
}

export interface BoardCell {
  id: ItemId | 'roll';
  at: number;
  dur: number;
  quality: number;
  fills?: { id: ItemId; quality: number }[];
}

export interface MatState {
  gim: boolean;
  bap: boolean;
  fills: { id: ItemId; quality: number }[];
  rolling: boolean;
  rollAt: number;
}

export interface KitchenSnapshot {
  now: number;
  hands: { id: string; holding: HeldItem | null }[];
  sink: { rinses: number } | null;
  cookers: CookerState[];
  burners: (BurnerCell | null)[];
  boards: (BoardCell | null)[];
  mats: MatState[];
  /** 거치대 → 들고 있는 사람의 socket id */
  brooms: (string | null)[];
  mess: number;
  wasted: number;
}

/** 자리번호와 반올림한 좌표만 싣는다 — 가장 자주 나가는 패킷이라 크기가 곧 대역폭이다.
 *  [slot, x, z, y, ry] */
export type PositionTuple = [number, number, number, number, number];

export interface PositionsPacket {
  t: number;
  list: PositionTuple[];
}
