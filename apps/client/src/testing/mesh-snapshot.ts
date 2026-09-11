import * as THREE from 'three';

/* 이식한 메시가 레거시와 같은지 보려면 눈이 아니라 값으로 봐야 한다.
   객체 트리를 좌표·회전·배율·지오메트리 정점·재질 색까지 통째로 뽑아
   deepEqual 로 비교한다. world.js 남은 부분도 전부 이 도구로 검증한다.

   부동소수는 6자리에서 반올림한다 — 같은 식을 다른 순서로 계산하면
   마지막 비트가 갈릴 수 있는데, 그건 화면에서 의미가 없다. */

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

interface DescribedGeometry {
  type: string;
  parameters?: Record<string, unknown>;
  /** BufferGeometry 처럼 매개변수가 없는 것은 정점을 직접 본다 */
  position?: number[];
  index?: number[];
}

interface DescribedMaterial {
  type: string;
  color: string | null;
  flatShading: boolean | null;
  transparent: boolean;
  opacity: number;
  side: number;
  depthWrite: boolean;
}

export interface DescribedObject {
  type: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  renderOrder: number;
  userData: Record<string, unknown>;
  geometry: DescribedGeometry | null;
  material: DescribedMaterial | DescribedMaterial[] | null;
  children: DescribedObject[];
}

function describeGeometry(g: THREE.BufferGeometry | undefined): DescribedGeometry | null {
  if (!g) return null;
  const params = (g as unknown as { parameters?: Record<string, unknown> }).parameters;
  if (params) return { type: g.type, parameters: { ...params } };
  const pos = g.getAttribute('position');
  const out: DescribedGeometry = { type: g.type };
  if (pos) out.position = Array.from(pos.array as ArrayLike<number>, (v) => r6(v));
  const idx = g.getIndex();
  if (idx) out.index = Array.from(idx.array as ArrayLike<number>);
  return out;
}

function describeMaterial(m: THREE.Material): DescribedMaterial {
  const colored = m as THREE.Material & { color?: THREE.Color; flatShading?: boolean };
  return {
    type: m.type,
    color: colored.color ? '#' + colored.color.getHexString() : null,
    flatShading: colored.flatShading ?? null,
    transparent: m.transparent,
    opacity: r6(m.opacity),
    side: m.side,
    depthWrite: m.depthWrite,
  };
}

/** 비교에 의미 있는 userData 만 남긴다 (자원 공유 표시 등은 뺀다) */
const USERDATA_KEYS = ['noTint', 'fromAsset', 'station'];

export function describeObject(o: THREE.Object3D): DescribedObject {
  const holder = o as unknown as {
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  };
  const userData: Record<string, unknown> = {};
  for (const k of USERDATA_KEYS) if (k in o.userData) userData[k] = o.userData[k];
  return {
    type: o.type,
    name: o.name,
    position: [r6(o.position.x), r6(o.position.y), r6(o.position.z)],
    rotation: [r6(o.rotation.x), r6(o.rotation.y), r6(o.rotation.z)],
    scale: [r6(o.scale.x), r6(o.scale.y), r6(o.scale.z)],
    visible: o.visible,
    renderOrder: o.renderOrder,
    userData,
    geometry: describeGeometry(holder.geometry),
    material: holder.material
      ? Array.isArray(holder.material)
        ? holder.material.map(describeMaterial)
        : describeMaterial(holder.material)
      : null,
    children: o.children.map(describeObject),
  };
}

/** 트리에 들어 있는 메시 수 — 테스트가 헛돌지 않았는지 보는 데 쓴다 */
export function countMeshes(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) n++;
  });
  return n;
}

/** 두 값이 처음으로 갈리는 지점을 경로와 함께 알려준다.
 *  씬 트리는 5만 줄이 넘어 vitest 의 diff 가 잘린다 — 어디가 다른지 짚어야 한다. */
export function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return path + ': 타입 ' + typeof a + ' vs ' + typeof b;
  if (a === null || b === null || typeof a !== 'object')
    return path + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);

  if (Array.isArray(a) !== Array.isArray(b)) return path + ': 배열 여부가 다르다';
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return path + ': 길이 ' + a.length + ' vs ' + b.length;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], path + '[' + i + ']');
      if (d) return d;
    }
    return null;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
  for (const k of keys) {
    if (!(k in ao)) return path + '.' + k + ': 왼쪽에 없다';
    if (!(k in bo)) return path + '.' + k + ': 오른쪽에 없다';
    const d = firstDifference(ao[k], bo[k], path + '.' + k);
    if (d) return d;
  }
  return null;
}
