import { bevelBoxGeometry, sharedGeo } from '@/features/world/geometry';
import { mat } from '@/features/world/materials';
import { interactables, scene } from '@/features/world/scene';
import { stationBox } from '@repo/game-core';
import * as THREE from 'three';

export function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
  parent?: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(
    sharedGeo('b' + w + '_' + h + '_' + d, () => bevelBoxGeometry(w, h, d)),
    mat(color),
  );
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

export function cap(
  r: number,
  h: number,
  color: number,
  x: number,
  y: number,
  z: number,
  parent?: THREE.Object3D,
  seg?: number,
): THREE.Mesh {
  /* 캡슐은 끝이 이미 둥글어서 팔다리 끝에 공을 따로 붙이지 않아도 된다.
     분할은 cyl 과 같은 이유로 낮춰 각을 남긴다. */
  const sg = Math.min(seg || 10, 10);
  const m = new THREE.Mesh(
    sharedGeo('k' + r + '_' + h + '_' + sg, () => new THREE.CapsuleGeometry(r, h, 3, sg)),
    mat(color),
  );
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

export function cyl(
  r: number,
  h: number,
  color: number,
  x: number,
  y: number,
  z: number,
  parent?: THREE.Object3D,
  seg?: number,
  r2?: number,
): THREE.Mesh {
  /* 분할을 낮춰 옆면 각이 보이게 한다. 20 각이면 그냥 매끈한 원기둥이라
     flatShading 을 켜도 로우폴리로 안 읽힌다. 10 이면 각이 또렷하다. */
  const rb = r2 === undefined ? r : r2;
  const sg = Math.min(seg || 12, 10);
  const m = new THREE.Mesh(
    sharedGeo(
      'c' + r + '_' + rb + '_' + h + '_' + sg,
      () => new THREE.CylinderGeometry(r, rb, h, sg),
    ),
    mat(color),
  );
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

interface DisposableHolder {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

/** 씬에서 뺀 메시의 GPU 자원을 실제로 놓아준다 (안 하면 계속 쌓인다) */
export function disposeObject(obj: THREE.Object3D | null | undefined): void {
  if (!obj) return;
  obj.traverse((o) => {
    const holder = o as unknown as DisposableHolder;
    // 공유 자원은 다른 메시가 아직 쓰고 있다 — 놓아주면 그쪽이 깨진다
    if (holder.geometry && !holder.geometry.userData.shared) holder.geometry.dispose();
    if (holder.material) {
      const mats = Array.isArray(holder.material) ? holder.material : [holder.material];
      for (const m of mats) {
        if (m.userData.shared) continue;
        const textured = m as THREE.Material & { map?: THREE.Texture | null };
        if (textured.map) textured.map.dispose();
        m.dispose();
      }
    }
  });
}

/** 씬에서 제거 + 자원 해제 */
export function kill(obj: THREE.Object3D | null | undefined, parent?: THREE.Object3D): null {
  if (!obj) return null;
  (parent || scene).remove(obj);
  disposeObject(obj);
  return null;
}

export function station<T extends THREE.Object3D>(mesh: T, data: unknown): T {
  mesh.userData.station = data;
  interactables.push(mesh);
  return mesh;
}

export function hitProxy(data: Parameters<typeof stationBox>[0]): THREE.Mesh {
  const shared = stationBox(data);
  if (!shared) throw new Error('Missing interaction box for ' + JSON.stringify(data));
  const { x, y, z, w, h, d } = shared;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  m.position.set(x, y, z);
  m.renderOrder = -1;
  scene.add(m);
  return station(m, data);
}
