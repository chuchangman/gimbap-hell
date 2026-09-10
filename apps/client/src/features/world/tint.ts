import type * as THREE from 'three';

/* 레거시 public/js/render-utils.js 를 그대로 옮겼다.
   three.js 객체를 받으므로 공용 패키지(@repo/game-core)가 아니라 여기 둔다 —
   서버는 이 함수를 쓰지 않는다. */

interface TintTarget extends THREE.Mesh {
  material: THREE.Material & { color: THREE.Color };
  userData: { base?: THREE.Color; noTint?: boolean };
}

/** 색을 입힐 메시를 한 번만 모아 둔다 (매 프레임 traverse 하지 않도록) */
export function collectTintTargets(root: THREE.Object3D | null | undefined): TintTarget[] {
  const targets: TintTarget[] = [];
  root?.traverse?.((object) => {
    const mesh = object as TintTarget;
    if (mesh.isMesh && mesh.material?.color && !mesh.userData?.noTint) targets.push(mesh);
  });
  return targets;
}

/** 타는 진행도(0~1)만큼 어둡게 */
export function applyBurnTint(targets: TintTarget[], progress: number): void {
  const multiplier = 1 - Math.min(1, Math.max(0, progress)) * 0.68;
  for (const object of targets) {
    if (!object.userData.base) object.userData.base = object.material.color.clone();
    object.material.color.copy(object.userData.base).multiplyScalar(multiplier);
  }
}
