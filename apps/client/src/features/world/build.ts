import { S, serverNow } from '@/features/net/net';
import { syncCustomers, updateRemotes } from '@/features/world/customers';
import { animateArm, animateHand, buildArm, updateHand } from '@/features/world/hand';
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
import { animateStreet } from '@/features/world/street';
import {
  syncBoards,
  syncBrooms,
  syncBurners,
  syncCookers,
  syncFridge,
  syncMats,
  syncSink,
} from '@/features/world/sync';
import * as THREE from 'three';

/**
 * 씬을 짓는다. 레거시 initWorld 에서 **렌더러 생성만 뺀** 것이다.
 *
 * 렌더러는 R3F 의 <Canvas> 가 맡는다 — 그래서 여기는 순수하게 씬 그래프만
 * 만든다 — 브라우저 없이도 씬 그래프를 그대로 지어 볼 수 있다.
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

/**
 * 한 프레임 갱신. 레거시 render 에서 **renderer.render 만 뺀** 것이다.
 * 실제 그리기는 R3F 의 <Canvas> 가 useFrame 뒤에 알아서 한다.
 */
export function stepWorld(swinging: boolean): void {
  animateStreet(serverNow());
  updateHand();
  animateHand(swinging);
  animateArm(swinging);
  if (S.kitchen) {
    syncFridge();
    syncSink();
    syncCookers();
    syncBurners();
    syncBoards();
    syncMats();
    syncBrooms();
  }
  syncCustomers();
  updateRemotes();
}
