import { FRIDGE_ROW_A, FRIDGE_ROW_B } from './items.js';
import { BOARD_COUNT, BURNERS, COOKER_COUNT, MAT_COUNT } from './stations.js';

export interface Line {
  start: number;
  gap: number;
}
export const lineAt = (line: Line, index: number): number => line.start + index * line.gap;

const freeze = <T>(value: T): T => Object.freeze(value);

// 렌더러와 서버 충돌 검사가 이 기준점을 함께 쓴다. 모델 내부 오프셋은
// 렌더러 쪽에 남는다 — 그건 게임플레이가 아니라 제작된 GLB 에 속한 값이다.
export const KITCHEN_LAYOUT = freeze({
  fridge: freeze({
    x: -7.05,
    z: -3.1,
    width: 1.15,
    depth: 5.9,
    hitX: -6.5,
    rowZ: freeze({ start: -5.4, gap: 1.15 }),
    rowY: freeze([1.24, 2.16]),
    hitSize: freeze({ w: 0.9, h: 0.82, d: 1.1 }),
  }),
  sink: freeze({
    x: -6.7,
    z: 1.1,
    solid: freeze({ w: 1.7, d: 1.3 }),
    hit: freeze({ x: -6.35, y: 1.4, z: 1.1, w: 1.6, h: 1, d: 1.1 }),
  }),
  cookers: freeze({
    x: -6.7,
    z: freeze({ start: 4, gap: 2.4 }),
    solid: freeze({ w: 2.1, d: 1.3 }),
    hitX: -6.3,
    hitY: 1.45,
    hitSize: freeze({ w: 1.8, h: 1.2, d: 1.2 }),
  }),
  stove: freeze({
    x: 6.7,
    z: -1.2,
    width: 1.3,
    depth: 6.8,
    burnerX: 6.78,
    hitY: 1.45,
    hitSize: freeze({ w: 1.1, h: 1, d: 1.24 }),
  }),
  boards: freeze({
    z: -1.2,
    x: freeze({ start: -1.4, gap: 1.4 }),
    solid: freeze({ w: 4.4, d: 1.7 }),
    hitY: 1.45,
    hitSize: freeze({ w: 1.3, h: 1, d: 1.5 }),
  }),
  mats: freeze({
    z: 2.6,
    x: freeze({ start: -1.6, gap: 1.6 }),
    solid: freeze({ w: 5.2, d: 1.7 }),
    hitY: 1.5,
    hitSize: freeze({ w: 1.5, h: 1.1, d: 1.5 }),
  }),
  bin: freeze({
    x: 5.6,
    z: 5.6,
    solid: freeze({ w: 0.9, d: 0.9 }),
    hit: freeze({ x: 5.6, y: 1.1, z: 5.6, w: 1.1, h: 1.5, d: 1.1 }),
  }),
  serve: freeze({
    x: 0,
    z: -6.8,
    solid: freeze({ w: 7, d: 0.9 }),
    // 부동소수 결과까지 레거시와 같아야 한다. -6.9 로 적지 않는다.
    hit: freeze({ x: 0, y: 1.45, z: -6.8 - 0.1, w: 7, h: 1.1, d: 0.9 }),
  }),
  brooms: freeze([
    freeze({ x: -2.6, z: 7.9, ry: Math.PI }),
    freeze({ x: 2.6, z: 7.9, ry: Math.PI }),
    freeze({ x: 6.9, z: 3.4, ry: -Math.PI / 2 }),
  ]),
});

export function burnerZ(index: number): number {
  const stove = KITCHEN_LAYOUT.stove;
  return stove.z + (index - (BURNERS.length - 1) / 2) * (stove.depth / BURNERS.length);
}
export const cookerZ = (index: number): number => lineAt(KITCHEN_LAYOUT.cookers.z, index);
export const boardX = (index: number): number => lineAt(KITCHEN_LAYOUT.boards.x, index);
export const matX = (index: number): number => lineAt(KITCHEN_LAYOUT.mats.x, index);
export const fridgeZ = (index: number): number => lineAt(KITCHEN_LAYOUT.fridge.rowZ, index);

// 게임플레이 개수가 제작된 주방 배치와 안 맞으면 그 자리에서 터뜨린다.
if (
  COOKER_COUNT < 0 ||
  BOARD_COUNT < 0 ||
  MAT_COUNT < 0 ||
  FRIDGE_ROW_A.length !== FRIDGE_ROW_B.length ||
  BURNERS.length < 1
)
  throw new Error('Invalid kitchen layout configuration');
