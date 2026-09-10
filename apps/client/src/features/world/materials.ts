/* ────────────────────────────────────────────────────────────
   재질 공유

   색이 같으면 재질을 하나로 같이 쓴다.

   ⚠ 재질을 직접 바꾸면 그 재질을 쓰는 메시가 전부 같이 바뀐다
     → 바꾸기 전에 ownMat() 으로 떼어낸다 (복사 후 수정)
   ──────────────────────────────────────────────────────────── */
import * as THREE from 'three';

const matCache = new Map<string, THREE.MeshLambertMaterial>();

export type MaterialOptions = THREE.MeshLambertMaterialParameters;

/**
 * 램버트 재질. 같은 색·같은 옵션이면 하나를 돌려 쓴다.
 * 텍스처처럼 값으로 비교할 수 없는 옵션이 끼면 캐시하지 않는다.
 */
export const mat = (color: number, opts?: MaterialOptions): THREE.MeshLambertMaterial => {
  let key: string | null = null;
  if (!opts) key = color + '|flat';
  else if (Object.values(opts).every((v) => v === null || typeof v !== 'object'))
    key = color + '|' + JSON.stringify(opts);

  /* flatShading 이 기본이다. 끄면 원기둥·구가 매끈하게 뭉개져
     면 분할이 안 보이고, 그러면 로우폴리가 아니라 그냥 플라스틱 덩어리가 된다. */
  const base: MaterialOptions = { color, flatShading: true };
  if (key === null) return new THREE.MeshLambertMaterial(Object.assign(base, opts));
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial(Object.assign(base, opts || {}));
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
};

interface MaybeMaterial {
  material?: THREE.Material | THREE.Material[];
}

/**
 * 공유 재질을 이 메시(또는 그 아래 전부)만의 것으로 떼어낸다.
 * material.color / opacity / emissive 를 건드리기 전에 반드시 부른다.
 * 안 부르면 같은 색을 쓰는 주방 설비까지 같이 물든다.
 */
export function ownMat<T extends THREE.Object3D>(obj: T): T {
  if (!obj) return obj;
  obj.traverse((o) => {
    const holder = o as unknown as MaybeMaterial;
    if (!holder.material) return;
    const own = (m: THREE.Material): THREE.Material => {
      if (!m.userData.shared) return m;
      const clone = m.clone();
      clone.userData.shared = false;
      return clone;
    };
    holder.material = Array.isArray(holder.material)
      ? holder.material.map(own)
      : own(holder.material);
  });
  return obj;
}

/**
 * GLB 한 벌에서 고른 재질만 이 인스턴스의 색으로 바꾼다.
 * 텍스처가 있는 원본 의상은 흰색에 가까운 틴트를 써서 무늬를 보존한다.
 */
export function tintAssetMaterials<T extends THREE.Object3D>(
  root: T,
  color: number,
  match?: (o: THREE.Object3D, m: THREE.Material) => boolean,
): T {
  if (!root) return root;
  ownMat(root);
  root.traverse((o) => {
    const holder = o as unknown as MaybeMaterial;
    if (!holder.material) return;
    const materials = Array.isArray(holder.material) ? holder.material : [holder.material];
    materials.forEach((m) => {
      const colored = m as THREE.Material & { color?: THREE.Color };
      if (colored.color && (!match || match(o, m))) colored.color.set(color);
    });
  });
  return root;
}

/** 메시의 단일 재질을 램버트로 좁혀 준다.
 *  레거시는 `o.material.color` 처럼 바로 짚었다 — 배열 재질을 쓰는 곳이 없다. */
export function m1(o: THREE.Object3D): THREE.MeshLambertMaterial {
  return (o as THREE.Mesh).material as THREE.MeshLambertMaterial;
}

/** 테스트 전용 — 재질 캐시를 비운다 */
export function __resetMaterialCache(): void {
  matCache.clear();
}
