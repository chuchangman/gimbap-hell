import type { Panel } from '@/features/world/panel';
import type * as THREE from 'three';

/* 레거시 world.js 의 모듈 전역 D 를 그대로 옮긴 것.
   설비별로 만든 메시와 패널을 들고 있다가 sync* 가 매 프레임 갱신한다.
   충실한 이식(A)이라 구조를 바꾸지 않는다 — 바꾸면 sync 쪽이 전부 흔들린다. */

export interface BurnerSlot {
  [key: string]: unknown;
}

export interface Registry {
  burners: Record<string, unknown>[];
  boards: Record<string, unknown>[];
  mats: Record<string, unknown>[];
  brooms: Record<string, unknown>[];
  cookers: Record<string, unknown>[];
  fridge: Record<string, unknown>[];
  sink: Record<string, unknown> | null;
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
  customers: Map<string, unknown>;
  remotes: Map<string, unknown>;
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

/** 테스트 전용 — 다시 지을 수 있게 비운다 */
export function __resetRegistry(): void {
  D.burners.length = 0;
  D.boards.length = 0;
  D.mats.length = 0;
  D.brooms.length = 0;
  D.cookers.length = 0;
  D.fridge.length = 0;
  D.sink = null;
  D.outside.cars.length = 0;
  D.outside.people.length = 0;
  D.customers.clear();
  D.remotes.clear();
  D.hand = null;
  D.handBase = null;
  D.handKey = null;
  delete D.arm;
  delete D.armBase;
  delete D.armSpeed;
}

/** Panel 을 담는 자리 — 설비마다 하나씩 */
export type StationPanel = Panel;
