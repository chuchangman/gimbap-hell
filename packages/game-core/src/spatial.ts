// 게임플레이 기하. 렌더러/DOM 의존이 없다 — 서버는 UI 와 완전히 같은
// 충돌 사각형과 상호작용 박스로 검증한다.
import { EYE } from './appearance.js';
import { QUEUE_Z, slotX } from './customers.js';
import { FRIDGE_ROW_A, FRIDGE_ROW_B, type ItemId } from './items.js';
import { boardX, burnerZ, cookerZ, fridgeZ, KITCHEN_LAYOUT, matX } from './layout.js';
import { BOARD_COUNT, BURNERS, COOKER_COUNT, MAT_COUNT } from './stations.js';

export const MOVEMENT = Object.freeze({
  radius: 0.34,
  walk: 3.6,
  run: 6.2,
  reach: 2.9,
  gravity: -24,
  jump: 6.2,
  hitLaunch: 5,
  airControl: 2.4,
  maxY: 0.95,
  minX: -7.6,
  maxX: 7.6,
  minZ: -10.6,
  maxZ: 8.6,
});

export const SERVE_Z = KITCHEN_LAYOUT.serve.z;
export const BROOM_SPOTS = KITCHEN_LAYOUT.brooms;

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}
export interface Size {
  w: number;
  h: number;
  d: number;
}
export interface Point {
  x: number;
  z: number;
  y?: number;
}

const rect = (x: number, z: number, w: number, d: number): Rect =>
  Object.freeze({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

export const WORLD_SOLIDS: readonly Rect[] = Object.freeze([
  rect(0, 9.4, 18, 0.8),
  rect(0, -11.4, 18, 0.8),
  rect(-8.4, -1, 0.8, 22),
  rect(8.4, -1, 0.8, 22),
  rect(
    KITCHEN_LAYOUT.fridge.x,
    KITCHEN_LAYOUT.fridge.z,
    KITCHEN_LAYOUT.fridge.width,
    KITCHEN_LAYOUT.fridge.depth,
  ),
  rect(
    KITCHEN_LAYOUT.sink.x,
    KITCHEN_LAYOUT.sink.z,
    KITCHEN_LAYOUT.sink.solid.w,
    KITCHEN_LAYOUT.sink.solid.d,
  ),
  ...Array.from({ length: COOKER_COUNT }, (_, i) =>
    rect(
      KITCHEN_LAYOUT.cookers.x,
      cookerZ(i),
      KITCHEN_LAYOUT.cookers.solid.w,
      KITCHEN_LAYOUT.cookers.solid.d,
    ),
  ),
  rect(
    KITCHEN_LAYOUT.stove.x,
    KITCHEN_LAYOUT.stove.z,
    KITCHEN_LAYOUT.stove.width,
    KITCHEN_LAYOUT.stove.depth,
  ),
  rect(0, KITCHEN_LAYOUT.boards.z, KITCHEN_LAYOUT.boards.solid.w, KITCHEN_LAYOUT.boards.solid.d),
  rect(0, KITCHEN_LAYOUT.mats.z, KITCHEN_LAYOUT.mats.solid.w, KITCHEN_LAYOUT.mats.solid.d),
  rect(
    KITCHEN_LAYOUT.bin.x,
    KITCHEN_LAYOUT.bin.z,
    KITCHEN_LAYOUT.bin.solid.w,
    KITCHEN_LAYOUT.bin.solid.d,
  ),
  rect(KITCHEN_LAYOUT.serve.x, SERVE_Z, KITCHEN_LAYOUT.serve.solid.w, KITCHEN_LAYOUT.serve.solid.d),
]);

const box = (x: number, y: number, z: number, w: number, h: number, d: number): Box =>
  Object.freeze({ x, y, z, w, h, d });
const boxFrom = ({ x, y, z, w, h, d }: Box): Box => box(x, y, z, w, h, d);
const boxAt = (x: number, y: number, z: number, { w, h, d }: Size): Box => box(x, y, z, w, h, d);

export interface StationBoxes {
  fridge: Record<string, Box>;
  sink: Box;
  cooker: readonly Box[];
  burner: readonly Box[];
  board: readonly Box[];
  mat: readonly Box[];
  bin: Box;
  broom: readonly Box[];
  serve: Box;
}

export const STATION_BOXES: StationBoxes = Object.freeze({
  fridge: Object.freeze(
    Object.fromEntries(
      [FRIDGE_ROW_A, FRIDGE_ROW_B].flatMap((row, r) =>
        row.map((id, i) => [
          id,
          boxAt(
            KITCHEN_LAYOUT.fridge.hitX,
            KITCHEN_LAYOUT.fridge.rowY[r],
            fridgeZ(i),
            KITCHEN_LAYOUT.fridge.hitSize,
          ),
        ]),
      ),
    ),
  ) as Record<string, Box>,
  sink: boxFrom(KITCHEN_LAYOUT.sink.hit),
  cooker: Object.freeze(
    Array.from({ length: COOKER_COUNT }, (_, i) =>
      boxAt(
        KITCHEN_LAYOUT.cookers.hitX,
        KITCHEN_LAYOUT.cookers.hitY,
        cookerZ(i),
        KITCHEN_LAYOUT.cookers.hitSize,
      ),
    ),
  ),
  burner: Object.freeze(
    Array.from({ length: BURNERS.length }, (_, i) =>
      boxAt(
        KITCHEN_LAYOUT.stove.burnerX,
        KITCHEN_LAYOUT.stove.hitY,
        burnerZ(i),
        KITCHEN_LAYOUT.stove.hitSize,
      ),
    ),
  ),
  board: Object.freeze(
    Array.from({ length: BOARD_COUNT }, (_, i) =>
      boxAt(
        boardX(i),
        KITCHEN_LAYOUT.boards.hitY,
        KITCHEN_LAYOUT.boards.z,
        KITCHEN_LAYOUT.boards.hitSize,
      ),
    ),
  ),
  mat: Object.freeze(
    Array.from({ length: MAT_COUNT }, (_, i) =>
      boxAt(matX(i), KITCHEN_LAYOUT.mats.hitY, KITCHEN_LAYOUT.mats.z, KITCHEN_LAYOUT.mats.hitSize),
    ),
  ),
  bin: boxFrom(KITCHEN_LAYOUT.bin.hit),
  broom: Object.freeze(BROOM_SPOTS.map((s) => box(s.x, 1, s.z, 0.9, 1.9, 0.9))),
  serve: boxFrom(KITCHEN_LAYOUT.serve.hit),
});

/** 액션 payload 에 kind 를 붙인 형태. 신뢰하지 않는 값이 들어올 수 있다. */
export interface StationRef {
  kind: string;
  item?: ItemId | string;
  cooker?: number;
  slot?: number;
  board?: number;
  mat?: number;
  rack?: number;
  [key: string]: unknown;
}

export function stationBox(data: StationRef): Box | null {
  const { kind } = data;
  if (kind === 'fridge')
    return Object.hasOwn(STATION_BOXES.fridge, data.item as string)
      ? STATION_BOXES.fridge[data.item as string]
      : null;
  if (['sink', 'bin', 'serve'].includes(kind))
    return STATION_BOXES[kind as 'sink' | 'bin' | 'serve'];
  const field = { cooker: 'cooker', burner: 'slot', board: 'board', mat: 'mat', broom: 'rack' }[
    kind
  ] as 'cooker' | 'slot' | 'board' | 'mat' | 'rack' | undefined;
  if (!field) return null;
  const index = data[field];
  if (!Number.isInteger(index)) return null;
  const list = STATION_BOXES[kind as 'cooker' | 'burner' | 'board' | 'mat' | 'broom'];
  return list?.[index as number] || null;
}

export function actionBox(
  action: string,
  payload: Record<string, unknown> = {},
  customer: { slot: number } | null = null,
): Box | null {
  if (action === 'drop') return null;
  if (action === 'serve' && payload.customerId)
    return customer ? box(slotX(customer.slot), 1.08, QUEUE_Z, 0.95, 2.16, 0.95) : null;
  return stationBox({ ...payload, kind: action.split(':')[0] } as StationRef);
}

export function interactionDistance(p: Point, b: Box | null): number {
  if (!b) return Infinity;
  return Math.hypot(
    Math.max(0, Math.abs(p.x - b.x) - b.w / 2),
    Math.max(0, Math.abs(EYE + (p.y || 0) - b.y) - b.h / 2),
    Math.max(0, Math.abs(p.z - b.z) - b.d / 2),
  );
}

export function clearPosition(p: Point, radius: number = MOVEMENT.radius - 0.012): boolean {
  if (p.x < MOVEMENT.minX || p.x > MOVEMENT.maxX || p.z < MOVEMENT.minZ || p.z > MOVEMENT.maxZ)
    return false;
  return WORLD_SOLIDS.every(
    (s) =>
      Math.hypot(
        p.x - Math.max(s.minX, Math.min(p.x, s.maxX)),
        p.z - Math.max(s.minZ, Math.min(p.z, s.maxZ)),
      ) >= radius,
  );
}

export function clearPath(a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.035));
  for (let i = 1; i <= steps; i++)
    if (
      !clearPosition({
        x: a.x + ((b.x - a.x) * i) / steps,
        z: a.z + ((b.z - a.z) * i) / steps,
      })
    )
      return false;
  return true;
}
