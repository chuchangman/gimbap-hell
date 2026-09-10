import { buildArm } from '@/features/world/hand';
import { buildRoom } from '@/features/world/room';
import { camera, scene } from '@/features/world/scene';
import {
  buildBin,
  buildBoards,
  buildBrooms,
  buildCookers,
  buildFridge,
  buildMats,
  buildServe,
  buildSink,
  buildStove,
} from '@/features/world/stations';
import * as THREE from 'three';

/**
 * 씬을 짓는다. 레거시 initWorld 에서 **렌더러 생성만 뺀** 것이다.
 *
 * 렌더러는 R3F 의 <Canvas> 가 맡는다 — 그래서 여기는 순수하게 씬 그래프만
 * 만들고, 그 덕분에 테스트가 브라우저 없이 결과를 레거시와 대조할 수 있다.
 */
export function buildWorld(): void {
  camera.position.set(0, 1.82, 6); // 플레이어 EYE 와 같게
  scene.add(camera);

  buildRoom();
  buildFridge();
  buildSink();
  buildCookers();
  buildStove();
  buildBoards();
  buildMats();
  buildBin();
  buildBrooms();
  buildServe();
  buildArm();

  /* 그림자는 사용하지 않는다. 외부 GLB가 자체 플래그를 들고 와도 여기서 확실히 끈다. */
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
  });
}
