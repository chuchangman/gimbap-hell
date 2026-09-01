/* ────────────────────────────────────────────────────────────
   에셋 이음매 — 직접 만든 모델을 코드 수정 없이 끼우는 자리

   지금 게임의 모든 형태는 world.js 가 코드로 만든다.
   나중에 Blender 등으로 만든 모델을 public/assets/ 에 넣으면
   그 자리만 모델로 바뀌고, 넣지 않은 자리는 계속 코드로 만든다.
   그래서 하나씩 갈아끼울 수 있다 — 전부 만들 때까지 기다릴 필요가 없다.

   쓰는 법
     1. public/assets/manifest.json 에  "이름": "파일경로"  를 적는다
     2. 그 경로에 .glb 나 .gltf 를 둔다
     3. 새로고침. 끝.
     크기·원점·노드 이름 규격은 public/assets/README.md 에 있다.

   ⚠ 코드가 부품을 직접 움직이는 모델이 있다.
     손님은 팔·다리·눈썹을 코드가 돌리고, 밥솥은 뚜껑을 연다.
     노드 이름이 안 맞으면 모델은 보이는데 안 움직인다 — 그것도 조용히.
     그래서 불러올 때 CONTRACT 와 대조해 빠진 이름을 콘솔에 찍어준다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/vendor/loaders/GLTFLoader.js';

const MANIFEST_URL = '/assets/manifest.json';

/**
 * 모델이 지켜야 할 규격.
 *   size  : 대략의 크기 (m). 두 배 넘게 어긋나면 경고한다
 *   origin: 원점을 어디 두는가
 *   parts : 코드가 이름으로 찾아 쓰는 노드. 없으면 그 기능만 죽는다
 *
 * 속재료(fill/*)는 길이 1 로 만든다. 김밥 단면(두께 0.12)과
 * 손에 든 재료(0.44)가 같은 모델을 늘여 쓰기 때문이다 —
 * 덕분에 단면에서 본 모양과 손에 든 모양이 저절로 이어진다.
 */
export const CONTRACT = {
  /* ── 속재료 — 길이 1.0 (y축), 원점 한가운데, 단면은 xz 평면 ── */
  'fill/danmuji':  { size: [0.056, 1, 0.056], origin: '한가운데', parts: [] },
  'fill/ham':      { size: [0.074, 1, 0.040], origin: '한가운데', parts: [] },
  'fill/egg':      { size: [0.088, 1, 0.043], origin: '한가운데', parts: [] },
  'fill/crab':     { size: [0.060, 1, 0.060], origin: '한가운데', parts: [] },
  'fill/cucumber': { size: [0.052, 1, 0.061], origin: '한가운데', parts: [] },
  'fill/spinach':  { size: [0.086, 1, 0.064], origin: '한가운데', parts: [] },
  'fill/carrot':   { size: [0.111, 1, 0.041], origin: '한가운데', parts: [] },
  'fill/fishcake': { size: [0.096, 1, 0.053], origin: '한가운데', parts: [] },

  /* ── 손질 전 원물 — 원점 한가운데, 긴 쪽이 x ── */
  'raw/danmuji':  { size: [0.50, 0.15, 0.15], origin: '한가운데', parts: [] },
  'raw/ham':      { size: [0.34, 0.11, 0.24], origin: '한가운데', parts: [] },
  'raw/egg':      { size: [0.26, 0.33, 0.26], origin: '한가운데', parts: [] },
  'raw/cucumber': { size: [0.50, 0.16, 0.16], origin: '한가운데', parts: [] },
  'raw/spinach':  { size: [0.52, 0.15, 0.30], origin: '한가운데', parts: [] },
  'raw/carrot':   { size: [0.48, 0.17, 0.17], origin: '한가운데', parts: [] },
  'raw/fishcake': { size: [0.40, 0.06, 0.32], origin: '한가운데', parts: [] },

  /* ── 그 밖의 손에 드는 것 ── */
  'item/gim':   { size: [0.64, 0.02, 0.52], origin: '한가운데', parts: [] },
  'item/rice':  { size: [0.42, 0.14, 0.42], origin: '한가운데', parts: ['water'] },
  'item/bap':   { size: [0.40, 0.22, 0.34], origin: '한가운데', parts: [] },
  'item/roll':  { size: [0.68, 0.28, 0.28], origin: '한가운데, 긴 쪽 x', parts: [] },
  'item/plate': { size: [0.70, 0.07, 0.70], origin: '한가운데', parts: [] },
  'item/broom': { size: [0.34, 1.60, 0.14], origin: '자루 한가운데', parts: [] },
  'item/knife': { size: [0.08, 0.08, 0.58], origin: '칼 한가운데', parts: [] },

  /* ── 사람 — 발바닥 한가운데가 원점(y=0), 얼굴은 +z ── */
  'char/customer': {
    size: [0.98, 2.13, 0.84], origin: '발바닥 한가운데 (y=0), 얼굴 +z · 눈은 y 1.82',
    parts: ['torso', 'head', 'legL', 'legR', 'armL', 'armR',
            'browL', 'browR', 'eyeL', 'eyeR', 'mouth']
  },
  'char/avatar': {
    size: [0.98, 2.24, 0.84], origin: '발바닥 한가운데 (y=0), 얼굴 +z · 눈은 y 1.82',
    parts: ['torso', 'head', 'legL', 'legR', 'armL', 'armR',
            'browL', 'browR', 'eyeL', 'eyeR', 'mouth']
  },

  /* ── 설비 — 바닥 한가운데가 원점(y=0). 충돌·상호작용·이름표는 코드가 맡는다 ── */
  'station/counter': { size: [1.00, 1.04, 1.00], origin: '바닥 한가운데', parts: [] },
  'station/fridge': { size: [1.15, 2.90, 5.90], origin: '바닥 한가운데', parts: [] },
  'station/sink':   { size: [1.30, 1.25, 2.10], origin: '바닥 한가운데', parts: ['water'] },
  'station/cooker': { size: [1.30, 1.45, 2.10], origin: '바닥 한가운데', parts: ['lid'] },
  'station/stove':  { size: [1.30, 1.10, 6.80], origin: '바닥 한가운데', parts: [] },
  'station/board':  { size: [1.05, 0.07, 0.85], origin: '판 한가운데', parts: [] },
  'station/mat':    { size: [0.72, 0.06, 0.72], origin: '판 한가운데', parts: [] },
  'station/bin':    { size: [0.95, 1.02, 0.95], origin: '바닥 한가운데', parts: [] },
  'station/kiosk':  { size: [0.80, 1.80, 0.60], origin: '바닥 한가운데', parts: [] },
  'station/pot':    { size: [0.60, 0.30, 0.54], origin: '바닥 한가운데', parts: ['water'] },
  'station/pan':    { size: [0.60, 0.10, 0.90], origin: '바닥 한가운데', parts: [] }
};

const models = new Map();          // 이름 → 원본 Object3D (씬에는 넣지 않는다)
const loadedNames = [];

/** 모델 하나가 규격을 지켰는지 본다. 어겨도 막지는 않고 콘솔에 남긴다 */
function checkContract(name, root) {
  const c = CONTRACT[name];
  if (!c) { console.warn('[assets] ' + name + ' — 규격에 없는 이름이다. 오타인가?'); return; }

  const missing = c.parts.filter((p) => !partOf(root, p));
  if (missing.length) {
    console.error('[assets] ' + name + ' — 노드가 없다: ' + missing.join(', ')
      + '\n  이 이름들은 코드가 직접 움직인다. 없으면 모델은 보여도 그 동작이 죽는다.'
      + '\n  규격: public/assets/README.md');
  }

  const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const want = c.size;
  const axes = ['x', 'y', 'z'];
  const off = axes.filter((ax, i) => {
    const got = s[ax];
    return want[i] > 0.001 && (got > want[i] * 2 || got < want[i] / 2);
  });
  if (off.length) {
    console.warn('[assets] ' + name + ' — 크기가 많이 다르다 (' + off.join(',') + ' 축).'
      + ' 규격 ' + want.map((v) => v.toFixed(2)).join(' × ')
      + ' · 받은 것 ' + axes.map((ax) => s[ax].toFixed(2)).join(' × '));
  }
}

/**
 * 모델을 미리 받아둔다. initWorld 보다 먼저 불러야 한다.
 * manifest.json 이 없으면 아무것도 안 하고 조용히 넘어간다 — 그게 지금 상태다.
 */
export async function preloadAssets() {
  let manifest;
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) return;                       // 아직 모델이 없다. 전부 코드로 만든다
    manifest = await res.json();
  } catch (err) {
    return;                                    // 파일이 없거나 깨졌다 — 코드로 만든다
  }

  const names = Object.keys(manifest || {});
  if (!names.length) return;

  const loader = new GLTFLoader();
  await Promise.all(names.map(async (name) => {
    const url = '/assets/' + String(manifest[name]).replace(/^\/+/, '');
    try {
      const gltf = await loader.loadAsync(url);
      /* clone(true)는 노드와 메시만 복제하고 재질은 원본을 계속 공유한다.
         색을 바꾸는 설비가 자기 재질만 떼어낼 수 있도록 공유 상태를 표시한다. */
      gltf.scene.traverse((o) => {
        const materials = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        materials.forEach((m) => { m.userData.shared = true; });
      });
      checkContract(name, gltf.scene);
      models.set(name, gltf.scene);
      loadedNames.push(name);
    } catch (err) {
      console.error('[assets] ' + name + ' 을(를) 못 읽었다: ' + url, err);
    }
  }));

  if (loadedNames.length) {
    console.info('[assets] 모델 ' + loadedNames.length + '개를 코드 대신 쓴다: '
      + loadedNames.join(', '));
  }
}

/** 이 이름의 모델이 준비돼 있나 */
export function hasAsset(name) { return models.has(name); }

/**
 * 모델이 있으면 그 사본을, 없으면 build() 가 만든 것을 돌려준다.
 * 사본을 주는 이유 — 같은 재료가 화면에 여러 개 나오는데 원본을 그대로 주면
 * 하나를 옮길 때 전부 같이 움직인다.
 */
export function asset(name, build) {
  const src = models.get(name);
  if (!src) return build();
  const g = src.clone(true);
  g.userData.fromAsset = name;
  return g;
}

/** 모델 안에서 이름으로 부품을 찾는다. 없으면 null */
export function partOf(root, name) {
  if (!root) return null;
  let hit = null;
  root.traverse((o) => { if (!hit && o.name === name) hit = o; });
  return hit;
}

/** 지금 코드 대신 모델을 쓰고 있는 이름들 (확인용) */
export function loadedAssets() { return loadedNames.slice(); }
