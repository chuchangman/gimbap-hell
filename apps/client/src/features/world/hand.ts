/* 손에 든 것 (1인칭) 과 1인칭 팔.
   레거시 world.js 1558-1672 줄을 그대로 옮겼다. */
import { myHand } from '@/features/net/net';
import { makeItemMesh } from '@/features/world/items';
import { box, disposeObject } from '@/features/world/primitives';
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
    g.position.set(0.54, -0.4, -0.9);
    g.rotation.set(-0.12, 0.18, Math.PI - 0.5);
    g.scale.setScalar(0.8);
  } else {
    g.position.set(0.5, -0.37, -0.97);
    g.rotation.set(0.26, 0.36, 0.12);
    g.scale.setScalar(0.66);
  }
  camera.add(g);
  D.hand = g;
  D.handBase = { pos: g.position.clone(), rot: g.rotation.clone() };
}

/* ──────────────── 🖐️ 1인칭 팔 (마인크래프트식) ────────────────
   화면 오른쪽 아래에서 팔이 올라온다. 빈손이어도 항상 보인다.
   ──────────────────────────────────────────────────────────── */
export function buildArm(): void {
  const arm = new THREE.Group();
  box(0.13, 0.13, 0.13, 0xf6d3a8, 0, 0, 0, arm); // 주먹
  box(0.135, 0.035, 0.135, 0xe3b489, 0, -0.055, 0, arm); // 손등 그림자
  box(0.115, 0.22, 0.115, 0xf6d3a8, 0, -0.18, 0.01, arm); // 팔뚝
  box(0.14, 0.035, 0.14, 0xd9dee3, 0, -0.29, 0.02, arm); // 소매 끝단
  box(0.135, 0.2, 0.135, 0xf7f9fb, 0, -0.4, 0.02, arm); // 위생복 소매

  // 소매(로컬 -y)가 화면 우하단, 주먹(원점)이 좌상향으로 오게 z 를 +로 튼다
  arm.position.set(0.9, -0.46, -0.92);
  arm.rotation.set(-0.2, -0.16, 0.52);
  camera.add(arm);
  D.arm = arm;
  D.armBase = { pos: arm.position.clone(), rot: arm.rotation.clone() };
}

/** 걸을 때 팔이 같이 흔들린다 — player.js 가 매 프레임 알려준다 */
let armBob = 0;
export function setArmBob(speed: number, dt: number): void {
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
