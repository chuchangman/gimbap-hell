/* ────────────────────────────────────────────────────────────
   에셋 이음매 — 직접 만든 모델을 코드 수정 없이 끼우는 자리

   게임 형태는 에셋을 우선 사용하고, 없는 것은 월드 코드가 만든다.
   Blender 등으로 만든 모델을 public/assets/ 에 넣으면
   그 자리만 모델로 바뀌고, 넣지 않은 자리는 계속 코드로 만든다.
   그래서 하나씩 갈아끼울 수 있다 — 전부 만들 때까지 기다릴 필요가 없다.

   쓰는 법
     1. public/assets/manifest.json 에  "이름": "파일경로"  를 적는다
     2. 그 경로에 .glb 나 .gltf 를 둔다
     3. 새로고침. 끝.
     크기·원점·노드 이름 규격은 public/assets/README.md 에 있다.

   ⚠ 코드가 부품을 직접 움직이는 모델이 있다 — 밥솥은 뚜껑을 연다.
     노드 이름이 안 맞으면 모델은 보이는데 안 움직인다 — 그것도 조용히.
     그래서 불러올 때 CONTRACT 와 대조해 빠진 이름을 콘솔에 찍어준다.
     사람은 char/base 위에 char/hair/*, char/top/* 파츠를 조합한다.
     얼굴과 표정은 조합 수가 많아서 계속 코드가 얹는다.

   레거시와 다른 점은 import 경로뿐이다 — vendor 사본 대신 three 패키지를 쓴다.
   ──────────────────────────────────────────────────────────── */
import { PATHS } from '@/config';
import { CONTRACT, CUSTOMER_CONTRACT, type AssetSpec } from '@/features/assets/contract';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export { CONTRACT, type AssetSpec };

const MANIFEST_URL = PATHS.assetManifest;

/** 이름 → 원본 Object3D (씬에는 넣지 않는다) */
const models = new Map<string, THREE.Object3D>();
const loadedNames: string[] = [];

/** 모델 안에서 이름으로 부품을 찾는다. 없으면 null */
export function partOf(
  root: THREE.Object3D | null | undefined,
  name: string,
): THREE.Object3D | null {
  if (!root) return null;
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && o.name === name) hit = o;
  });
  return hit;
}

/** 모델 하나가 규격을 지켰는지 본다. 어겨도 막지는 않고 콘솔에 남긴다 */
export function checkContract(name: string, root: THREE.Object3D): void {
  const c: AssetSpec | null =
    CONTRACT[name] || (name.startsWith('char/character-') ? CUSTOMER_CONTRACT : null);
  if (!c) {
    console.warn('[assets] ' + name + ' — 규격에 없는 이름이다. 오타인가?');
    return;
  }

  const missing = c.parts.filter((p) => !partOf(root, p));
  if (missing.length) {
    console.error(
      '[assets] ' +
        name +
        ' — 노드가 없다: ' +
        missing.join(', ') +
        '\n  이 이름들은 코드가 직접 움직인다. 없으면 모델은 보여도 그 동작이 죽는다.' +
        '\n  규격: public/assets/README.md',
    );
  }

  const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const want = c.size;
  const axes = ['x', 'y', 'z'] as const;
  const off = axes.filter((ax, i) => {
    const got = s[ax];
    return want[i] > 0.001 && (got > want[i] * 2 || got < want[i] / 2);
  });
  if (off.length) {
    console.warn(
      '[assets] ' +
        name +
        ' — 크기가 많이 다르다 (' +
        off.join(',') +
        ' 축).' +
        ' 규격 ' +
        want.map((v) => v.toFixed(2)).join(' × ') +
        ' · 받은 것 ' +
        axes.map((ax) => s[ax].toFixed(2)).join(' × '),
    );
  }
}

/**
 * 모델을 미리 받아둔다. 월드를 세우기 전에 불러야 한다.
 * manifest.json 이 없으면 아무것도 안 하고 조용히 넘어간다 — 전부 코드로 만든다.
 */
export async function preloadAssets(): Promise<void> {
  let manifest: Record<string, string> | undefined;
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) return; // 아직 모델이 없다. 전부 코드로 만든다
    manifest = (await res.json()) as Record<string, string>;
  } catch {
    return; // 파일이 없거나 깨졌다 — 코드로 만든다
  }

  const names = Object.keys(manifest || {});
  if (!names.length) return;

  const loader = new GLTFLoader();
  await Promise.all(
    names.map(async (name) => {
      const url = '/assets/' + String(manifest[name]).replace(/^\/+/, '');
      try {
        const gltf = await loader.loadAsync(url);
        /* clone(true)는 노드와 메시만 복제하고 재질은 원본을 계속 공유한다.
           색을 바꾸는 설비가 자기 재질만 떼어낼 수 있도록 공유 상태를 표시한다. */
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.userData.shared = true;
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : mesh.material
              ? [mesh.material]
              : [];
          materials.forEach((m) => {
            m.userData.shared = true;
          });
        });
        checkContract(name, gltf.scene);
        models.set(name, gltf.scene);
        loadedNames.push(name);
      } catch (err) {
        console.error('[assets] ' + name + ' 을(를) 못 읽었다: ' + url, err);
      }
    }),
  );

  if (loadedNames.length) {
    console.info(
      '[assets] 모델 ' + loadedNames.length + '개를 코드 대신 쓴다: ' + loadedNames.join(', '),
    );
  }
}

/**
 * 모델이 있으면 그 사본을, 없으면 build() 가 만든 것을 돌려준다.
 * 사본을 주는 이유 — 같은 재료가 화면에 여러 개 나오는데 원본을 그대로 주면
 * 하나를 옮길 때 전부 같이 움직인다.
 */
export function asset(name: string, build: () => THREE.Object3D): THREE.Object3D {
  const src = models.get(name);
  if (!src) return build();
  // Object3D.clone(true)는 SkinnedMesh의 뼈를 원본에 그대로 물린다.
  // 손님이 여러 명일 때 각자 독립적으로 걷게 하려면 전용 복제가 필요하다.
  const g = cloneSkeleton(src);
  g.userData.fromAsset = name;
  return g;
}

/** 모델이 있으면 사본을, 없으면 null.
 *  레거시의 `asset(name, () => null)` 관용구를 그대로 옮긴 것이다. */
export function assetOrNull(name: string): THREE.Object3D | null {
  return models.has(name) ? asset(name, () => new THREE.Object3D()) : null;
}
