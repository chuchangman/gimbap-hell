import type { Panel } from '@/features/world/panel';
import type * as THREE from 'three';

/* 레거시 world.js 의 모듈 전역 D 를 그대로 옮긴 것.
   설비별로 만든 메시와 패널을 들고 있다가 sync* 가 매 프레임 갱신한다.
   충실한 이식(A)이라 구조를 바꾸지 않는다 — 바꾸면 sync 쪽이 전부 흔들린다.
   다만 형태는 실제로 담기는 값 그대로 적었다 (레거시는 전부 무형이었다). */

export interface TintTarget extends THREE.Mesh {
  material: THREE.Material & { color: THREE.Color };
  userData: { base?: THREE.Color; noTint?: boolean };
}

export interface SinkEntry {
  basinX: number;
  basinZ: number;
  water: THREE.Object3D;
  panel: Panel;
  riceMesh: THREE.Object3D | null;
}

export interface CookerEntry {
  lid: THREE.Object3D | null;
  panel: Panel;
  steam: { mesh: THREE.Mesh; t: number }[];
  x: number;
  z: number;
}

export interface BurnerEntry {
  vessel: THREE.Object3D & { userData: { water?: THREE.Object3D } };
  flame: THREE.Mesh;
  panel: Panel;
  mesh: THREE.Object3D | null;
  tintTargets: TintTarget[];
  key: string | null;
  kind: 'pot' | 'pan';
}

export interface BoardEntry {
  knife: THREE.Object3D;
  panel: Panel;
  mesh: THREE.Object3D | null;
  key: string | null;
  x: number;
  z: number;
  knifeHome: THREE.Vector3;
}

export interface MatEntry {
  group: THREE.Object3D;
  gim: THREE.Object3D;
  bap: THREE.Object3D;
  fillGroup: THREE.Object3D;
  roll: THREE.Object3D;
  panel: Panel;
  x: number;
  z: number;
  fillKey: string | null;
}

export interface BroomEntry {
  mesh: THREE.Object3D;
  label: Panel;
}

export interface FridgeEntry {
  id: import('@repo/game-core').ItemId;
  sample: THREE.Object3D;
  label: Panel;
  locked?: boolean;
}

/** 손님 한 명이 화면에 갖는 것 전부 */
export interface CustomerEntry {
  group: THREE.Group;
  name: Panel;
  order: Panel;
  bubble: Panel;
  hit: THREE.Mesh;
  hp: { group: THREE.Group; segs: THREE.Mesh[]; shown?: number };
  outline: { group: THREE.Group; body: THREE.Mesh; head: THREE.Mesh; r: number };
  body: THREE.Object3D;
  limbs: unknown;
  face: unknown;
  lastLine: string | null;
  lastBand: number;
  lastHp: number;
  hitAt: number;
}

export interface Registry {
  burners: BurnerEntry[];
  boards: BoardEntry[];
  mats: MatEntry[];
  brooms: BroomEntry[];
  cookers: CookerEntry[];
  fridge: FridgeEntry[];
  sink: SinkEntry | null;
  outside: {
    cars: {
      mesh: THREE.Group;
      wheels: THREE.Mesh[];
      direction: number;
      offset: number;
      speed: number;
    }[];
    people: {
      mesh: THREE.Group;
      legL: THREE.Mesh;
      legR: THREE.Mesh;
      direction: number;
      offset: number;
      period: number;
      active: number;
    }[];
  };
  customers: Map<string, CustomerEntry>;
  remotes: Map<string, THREE.Group>;
  hand: THREE.Object3D | null;
  handBase: { pos: THREE.Vector3; rot: THREE.Euler } | null;
  handKey: string | null;
  arm?: THREE.Group;
  armBase?: { pos: THREE.Vector3; rot: THREE.Euler };
  armSpeed?: number;
}

export const D: Registry = {
  burners: [],
  boards: [],
  mats: [],
  brooms: [],
  cookers: [],
  fridge: [],
  sink: null,
  outside: { cars: [], people: [] },
  customers: new Map(),
  remotes: new Map(),
  hand: null,
  handBase: null,
  handKey: null,
};

/** Panel 을 담는 자리 — 설비마다 하나씩 */
export type StationPanel = Panel;
