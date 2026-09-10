import { CAMERA_VIEW, WORLD_SOLIDS } from '@repo/game-core';
import * as THREE from 'three';

/* 씬과 카메라는 모듈 싱글턴으로 둔다. 레거시 world.js 와 같은 구조다 —
   충실한 이식(A)이므로 명령형으로 지은 씬 그래프를 그대로 들고 있다가
   R3F 에는 <primitive object={scene} /> 로 붙인다. */
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(
  CAMERA_VIEW.fov,
  1,
  CAMERA_VIEW.near,
  CAMERA_VIEW.far,
);
/** 조준 가능한 메시 */
export const interactables: THREE.Object3D[] = [];
/** 서버와 동일한 충돌 영역 */
export const solids = WORLD_SOLIDS;

/* ──────────────── 좌표 ──────────────── */
/** 출입문 */
export const DOOR = { x: -6, z: -10.4 };
/** 빗자루에 맞고 움찔거리는 시간 */
export const HIT_FLINCH_MS = 260;
