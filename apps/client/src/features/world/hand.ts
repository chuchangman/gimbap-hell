/* 1인칭 오른손: 사진 텍스처 + 연속 인체 메시. 관절 포즈는 GLB morph로 보간한다. */
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

let skin: THREE.Mesh | null = null;
let grip = 0;

export function buildArm(): void {
  const model = assetOrNull('hand/fps-right');
  if (!model) {
    console.error(
      '[hand] 실사형 오른손 GLB를 불러오지 못했습니다. /assets/hand/fps-right-realistic.glb를 확인하세요.',
    );
    return;
  }
  const arm = new THREE.Group();
  arm.name = 'FirstPersonRightHand';
  arm.add(model);
  model.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.morphTargetDictionary?.Grip !== undefined) skin = obj;
    if (obj instanceof THREE.Mesh) obj.frustumCulled = false;
  });
  // GLB: 미터 크기, 손목 원점, +Y 손가락, +Z 손등. 우하단 카메라 전용 배율.
  arm.scale.setScalar(2.6);
  arm.position.set(0.55, -0.44, -0.93);
  arm.rotation.set(-0.4, -0.42, 0.65);
  camera.add(arm);
  D.arm = arm;
  D.armBase = { pos: arm.position.clone(), rot: arm.rotation.clone() };
  grip = 0;
}

/** 걸을 때 팔이 같이 흔들린다 — player.js 가 매 프레임 알려준다 */
let armBob = 0;
export function setArmBob(speed: number, dt: number): void {
  const held = myHand();
  const targetGrip = held ? (held.id === 'broom' ? 1 : 0.65) : 0;
  grip = THREE.MathUtils.damp(grip, targetGrip, 12, dt);
  if (skin?.morphTargetInfluences && skin.morphTargetDictionary) {
    const index = skin.morphTargetDictionary.Grip;
    if (index !== undefined) skin.morphTargetInfluences[index] = grip;
  }
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
