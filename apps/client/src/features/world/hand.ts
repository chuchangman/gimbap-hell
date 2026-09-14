/* 1인칭 오른손: 누끼 사진을 그대로 붙인 얕은 입체 메시. 정밀 인체 리그는 아니다. */
import { assetOrNull } from '@/features/assets/assets';
import { myHand } from '@/features/net/net';
import { makeItemMesh } from '@/features/world/items';
import { disposeObject } from '@/features/world/primitives';
import { D } from '@/features/world/registry';
import { camera } from '@/features/world/scene';
import * as THREE from 'three';

/* ────────────────────────────────────────────────────────────
   손에 든 것 (1인칭)
   ──────────────────────────────────────────────────────────── */
export function updateHand(): void {
  const h = myHand();
  syncHandPose(Boolean(h));
  const key = h ? h.uid + h.stage : 'none';
  if (D.handKey === key) return;
  D.handKey = key;

  if (D.hand) {
    camera.remove(D.hand);
    disposeObject(D.hand);
    D.hand = null;
  }
  if (!h) return;

  const g = makeItemMesh(h);
  if (h.id === 'broom') {
    g.position.set(0.43, -0.28, -0.99);
    g.rotation.set(-0.12, 0.18, Math.PI - 0.5);
    g.scale.setScalar(0.8);
  } else {
    g.position.set(0.4, -0.24, -1.02);
    g.rotation.set(0.26, 0.36, 0.12);
    g.scale.setScalar(0.66);
  }
  camera.add(g);
  D.hand = g;
  D.handBase = { pos: g.position.clone(), rot: g.rotation.clone() };
}

let skinMeshes: THREE.Mesh[] = [];
let grip = 0;
let openHand: THREE.Object3D | null = null;
let grippingHand: THREE.Object3D | null = null;

function syncHandPose(holding: boolean): void {
  // 주먹 사진을 독립된 모델로 사용한다. 두 손이 동시에 겹쳐 보이지 않게 한다.
  if (openHand) openHand.visible = !holding || !grippingHand;
  if (grippingHand) grippingHand.visible = holding;
}

export function buildArm(): void {
  const model = assetOrNull('hand/fps-right');
  if (!model) {
    console.error(
      '[hand] 사진 오른손 GLB를 불러오지 못했습니다. /assets/hand/fps-right-photo.glb를 확인하세요.',
    );
    return;
  }
  const arm = new THREE.Group();
  arm.name = 'FirstPersonRightHand';
  openHand = model;
  grippingHand = assetOrNull('hand/fps-right-grip');
  arm.add(model);
  if (grippingHand) arm.add(grippingHand);
  else console.warn('[hand] 주먹 사진 모델이 없어 기존 굽힘 포즈를 사용합니다.');
  skinMeshes = [];
  arm.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj.morphTargetDictionary?.Grip !== undefined) skinMeshes.push(obj);
      obj.frustumCulled = false;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((material) => {
        // 사진 앞면은 조명/톤매핑으로 다시 칠하지 않는다. 옆·뒷면만 조명을 받는다.
        if (material instanceof THREE.MeshBasicMaterial) material.toneMapped = false;
      });
    }
  });
  // GLB: 미터 크기, 손목 원점, +Y 손가락, +Z 손등. 우하단 카메라 전용 배율.
  arm.scale.setScalar(2.4);
  arm.position.set(0.47, -0.57, -0.86);
  arm.rotation.set(-0.16, -0.14, 0.45);
  camera.add(arm);
  D.arm = arm;
  D.armBase = { pos: arm.position.clone(), rot: arm.rotation.clone() };
  grip = 0;
  syncHandPose(Boolean(myHand()));
}

/** 걸을 때 팔이 같이 흔들린다 — player.js 가 매 프레임 알려준다 */
let armBob = 0;
export function setArmBob(speed: number, dt: number): void {
  const held = myHand();
  syncHandPose(Boolean(held));
  // 주먹 GLB가 있을 때는 사진 자체의 포즈를 보존한다. 실패 시에만 기존 morph.
  const targetGrip = !grippingHand && held ? (held.id === 'broom' ? 1 : 0.65) : 0;
  grip = THREE.MathUtils.damp(grip, targetGrip, 12, dt);
  skinMeshes.forEach((skin) => {
    if (skin.morphTargetInfluences && skin.morphTargetDictionary) {
      const index = skin.morphTargetDictionary.Grip;
      if (index !== undefined) skin.morphTargetInfluences[index] = grip;
    }
  });
  D.armSpeed = speed;
  armBob += dt * (speed > 0.1 ? (speed > 5 ? 13 : 8.5) : 1.5);
}

let swingT = 0;
let handBumpAt = -10000;
export function bumpHand(): void {
  handBumpAt = performance.now();
}

export function animateArm(swinging: boolean): void {
  const a = D.arm,
    base = D.armBase;
  if (!a || !base) return;

  const amp = (D.armSpeed || 0) > 0.1 ? 0.05 : 0.012;
  a.position.x = base.pos.x + Math.sin(armBob) * amp * 0.6;
  a.position.y = base.pos.y + Math.abs(Math.cos(armBob)) * amp - amp * 0.5;
  a.rotation.z = base.rot.z + Math.sin(armBob) * amp * 0.8;

  // 빗자루를 휘두르면 팔도 같이 내려친다
  if (swinging && swingT > 0) {
    const p =
      swingT < 0.35 ? Math.pow(swingT / 0.35, 0.6) : 1 - Math.pow((swingT - 0.35) / 0.65, 1.4);
    a.rotation.x = base.rot.x - p * 1.1;
    a.position.y = base.pos.y - p * 0.18;
    return;
  }

  // 상호작용하면 손을 한 번 툭 내민다
  const b = (performance.now() - handBumpAt) / 260;
  if (b < 1) {
    const p = Math.sin(b * Math.PI);
    a.rotation.x = base.rot.x - p * 0.45;
    a.position.z = base.pos.z - p * 0.1;
  } else {
    a.rotation.x = base.rot.x;
    a.position.z = base.pos.z;
  }
}

export function setSwingProgress(t: number): void {
  swingT = t;
  const g = D.hand,
    base = D.handBase;
  if (!g || !base || t <= 0) return;
  const DOWN = 0.35;
  const p = t < DOWN ? Math.pow(t / DOWN, 0.6) : 1 - Math.pow((t - DOWN) / (1 - DOWN), 1.4);
  g.rotation.z = base.rot.z + p * 3.3;
  g.rotation.x = base.rot.x + p * 0.55;
  g.position.x = base.pos.x - p * 0.55;
  g.position.y = base.pos.y - p * 0.3;
  g.position.z = base.pos.z - p * 0.22;
}

export function animateHand(swinging: boolean): void {
  if (!D.hand || !D.handBase || swinging) return;
  const t = (performance.now() - handBumpAt) / 260;
  if (t >= 1) {
    D.hand.position.copy(D.handBase.pos);
    D.hand.rotation.copy(D.handBase.rot);
    return;
  }
  const p = Math.sin(t * Math.PI);
  D.hand.position.y = D.handBase.pos.y - p * 0.12;
  D.hand.position.z = D.handBase.pos.z - p * 0.1;
  D.hand.rotation.x = D.handBase.rot.x + p * 0.5;
}
