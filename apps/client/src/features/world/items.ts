/* ────────────────────────────────────────────────────────────
   재료 메시

   ⚠ 색만으로는 속재료 8종을 가를 수 없다.
   CIEDE2000 으로 재보니 예전 팔레트는
     햄 ↔ 맛살 ΔE 4.8 · 단무지 ↔ 계란 ΔE 6.1
   로 사실상 같은 색이었다. 색을 벌려 최소 ΔE 를 13 까지 올렸지만
   적록색약에서는 8종이 전부 노랑–주황–빨강–초록 한 대역에 몰려
   무슨 색을 고르든 ΔE 3 까지 붙는다 — 색은 근본 해결책이 못 된다.

   그래서 구분은 형태가 1차, 색이 2차다.
     단무지 굵은 사각 · 햄 넓적한 사각 · 계란 아주 납작한 판(흰자 층)
     맛살 둥근 기둥(빨간 겉) · 오이 사각+껍질 한 면
     시금치 불규칙 뭉치 · 당근 가는 채 다발 · 어묵 물결 띠
   ──────────────────────────────────────────────────────────── */
import { asset, partOf } from '@/features/assets/assets';
import { mat, ownMat } from '@/features/world/materials';
import { box, cyl } from '@/features/world/primitives';
import { C, type HeldItem, type ItemId } from '@repo/game-core';
import * as THREE from 'three';

/** 속재료로 쓰이는 id — 손질이 끝난 형태는 fillPiece 가 맡는다 */
const FILL_IDS = new Set<string>([
  'danmuji',
  'ham',
  'spinach',
  'crab',
  'cucumber',
  'egg',
  'carrot',
  'fishcake',
]);

/** 기본 조합 — 주문 정보가 없을 때 단면에 채울 속 */
const DEFAULT_FILLS = ['danmuji', 'ham', 'spinach'];

/** 색이 있는 메시의 색을 어둡게 (탄 것) */
function darken(root: THREE.Object3D, factor: number): void {
  ownMat(root).traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as (THREE.Material & { color?: THREE.Color }) | undefined;
    if (mesh.isMesh && m?.color) m.color.multiplyScalar(factor);
  });
}

/**
 * 속재료 한 덩이 — 세로(y)로 len 만큼 뻗은 조각.
 *
 * 김밥 단면(len 0.12)과 손에 든 재료(len 0.44)가 이 함수 하나를 같이 쓴다.
 * 그래서 단면에서 외운 모양이 손에 든 모양과 그대로 이어진다 —
 * 색이 아니라 이 대응이 재료를 구분하는 실제 단서다.
 *
 * simple 은 접시 위 김밥처럼 조각이 일곱 개씩 깔리는 자리에서 쓴다.
 * 실루엣은 그대로 두고 메시 수만 줄인다.
 */
export function fillPiece(id: string, len: number, burnt: boolean, simple: boolean): THREE.Group {
  /* 직접 만든 모델이 있으면 그것을 쓴다.
     모델은 길이 1 로 만들어 두고 여기서 len 만큼 늘인다 —
     그래서 김밥 단면(0.12)과 손에 든 재료(0.44)가 같은 모델을 공유한다. */
  const wrap = new THREE.Group();
  const model = asset('fill/' + id, () => null as unknown as THREE.Object3D);
  if (model) {
    model.scale.y = len;
    if (burnt) darken(model, 0.32);
    wrap.add(model);
    return wrap;
  }

  const g = new THREE.Group();
  const dim = (c: number): number => (burnt ? C.burnt : c);

  if (id === 'danmuji') {
    // 굵은 정사각 — 속재료 중 가장 두툼하다
    box(0.056, len, 0.056, dim(C.danmujiCut), 0, 0, 0, g);
  } else if (id === 'ham') {
    // 넓적한 직사각 — 단무지보다 납작하고 넓다
    box(0.074, len, 0.04, dim(C.hamDone), 0, 0, 0, g);
  } else if (id === 'egg') {
    // 지단 — 아주 납작하고 넓은 판. 흰자 층이 다른 노란 재료와 갈라주는 표시다
    box(0.088, len, 0.022, dim(C.eggYolk), 0, 0, -0.008, g);
    if (!burnt) box(0.088, len, 0.011, C.eggWhite, 0, 0, 0.013, g);
  } else if (id === 'crab') {
    // 맛살 — 여덟 종 중 혼자 둥글다. 겉만 빨갛고 속은 희다
    cyl(0.03, len, dim(C.crabRed), 0, 0, 0, g, simple ? 8 : 12);
    cyl(0.023, len * 1.004, dim(C.crab), 0, 0, 0, g, simple ? 8 : 12);
  } else if (id === 'cucumber') {
    // 오이 — 사각인데 한 면만 진한 껍질
    box(0.05, len, 0.048, dim(C.cucumber), 0, 0, 0, g);
    box(0.052, len, 0.013, dim(C.cucumberSkin), 0, 0, -0.024, g);
  } else if (id === 'spinach') {
    // 시금치 — 각진 재료들 사이에서 혼자 불규칙하다
    const n = simple ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.03, 0),
        mat(dim(C.spinachDone), { flatShading: true }),
      );
      b.position.set(
        ((i % 2) - 0.5) * 0.026,
        (i / (n - 1) - 0.5) * len * 0.6,
        ((i % 3) - 1) * 0.017,
      );
      b.scale.set(1, Math.max(1, (len * 0.75) / 0.06), 1);
      b.rotation.y = i * 1.1;
      g.add(b);
    }
  } else if (id === 'carrot') {
    // 당근 — 하나가 아니라 가는 채 여러 가닥
    const n = simple ? 3 : 5;
    for (let i = 0; i < n; i++) {
      box(
        0.019,
        len,
        0.019,
        dim(C.carrot),
        (i - (n - 1) / 2) * 0.023,
        0,
        ((i % 2) - 0.5) * 0.022,
        g,
      );
    }
  } else if (id === 'fishcake') {
    // 어묵 — 얇고 넓은 띠가 물결친다
    const n = simple ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const off = (i % 2 ? 1 : -1) * 0.014;
      const s = box(0.068, len, 0.015, dim(C.fishcakeDone), off, 0, (i - (n - 1) / 2) * 0.019, g);
      s.rotation.y = (i % 2 ? 1 : -1) * 0.26;
    }
  } else {
    box(0.05, len, 0.05, dim(0xcccccc), 0, 0, 0, g);
  }
  return g;
}

/**
 * 손에 들거나 조립대에 놓인, 손질 끝난 속재료 — 눕혀 놓은 fillPiece.
 *
 * 회전이 두 번인 이유: z 회전만 주면 길이는 눕지만 넓은 면이 옆을 본다.
 * 계란 지단의 흰자 층이나 당근 채 다발처럼 "폭"으로 알아보는 재료가
 * 그러면 옆날만 보여서 죄다 비슷한 막대가 된다.
 *   z 회전 — 길이(local y) 를 x 로
 *   x 회전 — 폭(local x) 을 z 로, 두께(local z) 를 y 로
 * 결과적으로 넓은 면이 하늘을 본다.
 */
export function fillLaid(id: string, burnt: boolean): THREE.Group {
  const g = new THREE.Group();
  const flat = new THREE.Group();
  const p = fillPiece(id, 0.44, burnt, false);
  p.rotation.z = Math.PI / 2;
  flat.add(p);
  flat.rotation.x = Math.PI / 2;
  g.add(flat);
  return g;
}

/**
 * 썬 단면 — 겉의 김 + 밥 + 실제로 넣은 속재료.
 * 접시 위 조각과 안 썬 김밥의 양 끝이 같이 쓴다.
 */
export function rollFace(fills: string[] | undefined, simple: boolean): THREE.Group {
  const s = new THREE.Group();
  const list = (fills && fills.length ? fills : DEFAULT_FILLS).slice(0, 6);
  const T = 0.12; // 조각 두께
  cyl(0.105, T, C.gim, 0, 0, 0, s, 18); // 겉의 김
  cyl(0.092, T * 1.03, C.bap, 0, 0.002, 0, s, 18); // 밥
  // 속은 가운데로 모은다 — 실제 김밥처럼 뭉쳐야 재료끼리 겹쳐 보이지 않는다
  const R = list.length === 1 ? 0 : 0.042;
  list.forEach((id, i) => {
    const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
    const p = fillPiece(id, T * 1.06, false, simple);
    p.position.set(Math.cos(a) * R, 0.003, Math.sin(a) * R);
    p.rotation.y = -a; // 납작한 재료가 중심을 향해 눕는다
    s.add(p);
  });
  return s;
}

/** 김밥 한 조각 — 옆은 김, 위는 밥과 속재료 단면 */
export function gimbapSlice(x: number, y: number, z: number, fills: string[]): THREE.Group {
  const s = rollFace(fills, true);
  s.position.set(x, y, z);
  return s;
}

/** 레거시는 { id, stage } 만 든 부분 객체도 넘긴다 (냉장고 진열용 샘플 등) */
export interface ItemLike {
  id: string;
  stage: string;
  quality?: number;
  fills?: { id: string; quality: number }[];
}

export function makeItemMesh(item: ItemLike | HeldItem | null | undefined): THREE.Group {
  const g = new THREE.Group();
  if (!item) return g;
  const id: string = item.id;
  const st = item.stage as string;
  const burnt = st === 'burnt';

  /* 손질이 끝난 속재료는 여덟 종이 모두 같은 형태 언어를 쓴다 */
  // 맛살은 별도 손질이 없으므로 냉장고에서 꺼낸 순간부터 완성 형태를 쓴다.
  if ((st !== 'raw' || id === 'crab') && FILL_IDS.has(id)) return fillLaid(id, burnt);

  /* 손질 전 원물 — 모델이 있으면 통째로 대체한다 */
  if (st === 'raw' && FILL_IDS.has(id)) {
    const raw = asset('raw/' + id, () => null as unknown as THREE.Object3D);
    if (raw) {
      if (burnt) darken(raw, 0.32);
      g.add(raw);
      return g;
    }
  }

  /* 김·밥·쌀·빗자루도 이름만 맞으면 대체된다 */
  if (['gim', 'bap', 'rice', 'broom'].includes(id)) {
    const m = asset('item/' + id, () => null as unknown as THREE.Object3D);
    if (m) {
      // 쌀 모델의 물 표면은 씻은 상태에서만 보인다. GLB에는 런타임에서
      // 재사용할 수 있도록 water 노드를 남기되 마른쌀을 파랗게 덮지 않는다.
      if (id === 'rice') {
        const water = partOf(m, 'water');
        if (water) water.visible = st === 'washed';
      }
      g.add(m);
      return g;
    }
  }

  if (id === 'gim') {
    const sheet = box(0.62, 0.014, 0.5, C.gim, 0, 0, 0, g);
    (ownMat(sheet).material as THREE.Material).side = THREE.DoubleSide;
    box(0.64, 0.004, 0.52, C.gimEdge, 0, -0.01, 0, g);
  } else if (id === 'rice') {
    const bowl = cyl(0.21, 0.14, C.steel, 0, 0, 0, g, 18, 0.15);
    cyl(0.185, 0.03, st === 'washed' ? C.riceWashed : C.riceRaw, 0, 0.06, 0, bowl, 18);
    if (st === 'washed') {
      const w = ownMat(cyl(0.19, 0.05, C.water, 0, 0.075, 0, bowl, 18));
      const wm = w.material as THREE.Material;
      wm.transparent = true;
      wm.opacity = 0.55;
    }
  } else if (id === 'bap') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 7), mat(C.bap));
    m.scale.set(1, 0.55, 0.85);
    g.add(m);
    for (let i = 0; i < 5; i++) {
      const grain = cyl(0.014, 0.05, 0xffffff, (i - 2) * 0.06, 0.1, ((i % 2) - 0.5) * 0.18, g, 6);
      grain.rotation.z = i * 0.7;
    }

    /* ── 손질 전 재료 — 원물 그대로라 서로 안 헷갈린다 ── */
  } else if (id === 'danmuji') {
    const d = cyl(0.075, 0.5, C.danmuji, 0, 0, 0, g, 14);
    d.rotation.z = Math.PI / 2;
  } else if (id === 'ham') {
    box(0.34, 0.11, 0.24, burnt ? C.burnt : C.hamRaw, 0, 0, 0, g);
  } else if (id === 'spinach') {
    const col = burnt ? 0x4a5238 : C.spinachRaw;
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.13, 0),
        mat(col, { flatShading: true }),
      );
      leaf.position.set((i - 1.5) * 0.13, (i % 2) * 0.05, ((i % 3) - 1) * 0.08);
      leaf.scale.set(1, 0.4, 0.8);
      g.add(leaf);
    }
  } else if (id === 'cucumber') {
    const c = cyl(0.075, 0.5, C.cucumber, 0, 0, 0, g, 12);
    c.rotation.z = Math.PI / 2;
    const skin = cyl(0.078, 0.5, C.cucumberSkin, 0, 0, 0, g, 12);
    skin.rotation.z = Math.PI / 2;
    skin.scale.set(1, 1, 0.55);
  } else if (id === 'egg') {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.13, 9, 6), mat(0xf6efdc));
    e.scale.set(1, 1.28, 1);
    g.add(e);
  } else if (id === 'carrot') {
    const c = cyl(0.085, 0.42, burnt ? C.burnt : C.carrot, 0, 0, 0, g, 12, 0.03);
    c.rotation.z = Math.PI / 2;
    const top = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.07, 0),
      mat(0x4f8f38, { flatShading: true }),
    );
    top.position.set(-0.23, 0.02, 0);
    g.add(top);
  } else if (id === 'fishcake') {
    const col = burnt ? C.burnt : C.fishcake;
    box(0.4, 0.02, 0.3, col, 0, 0, 0, g).rotation.y = 0.15;
    box(0.4, 0.02, 0.3, col, 0, 0.03, 0.03, g).rotation.y = -0.1;

    /* ── 김밥 ── */
  } else if (id === 'roll') {
    // 만 김밥 한 줄 — 아직 안 썰었다. 양 끝으로 속이 비친다
    const fills = (item.fills || []).map((f) => f.id as string);
    const r = cyl(0.14, 0.68, C.gim, 0, 0, 0, g, 22);
    r.rotation.z = Math.PI / 2;
    // 김을 만 이음매 — 이 한 줄이 있어야 매끈한 원기둥이 아니라 만 것으로 보인다
    const seam = box(0.66, 0.006, 0.032, C.gimEdge, 0, 0.137, 0, g);
    seam.rotation.x = 0.12;
    // rollFace 는 반지름 0.105 로 짜여 있다. 몸통이 0.14 이므로 맞춰 키운다
    for (const s of [-1, 1]) {
      const face = rollFace(fills, true);
      face.rotation.z = Math.PI / 2;
      face.scale.setScalar(0.14 / 0.105);
      face.position.x = s * 0.335;
      g.add(face);
    }
  } else if (id === 'gimbap') {
    // 접시에 담은 완성 김밥 — 썬 단면이 위를 본다
    const plate = cyl(0.34, 0.03, 0xf3efe6, 0, -0.04, 0, g, 22, 0.3);
    plate.userData.noTint = true;
    const rim = cyl(0.348, 0.014, 0xe6dfd0, 0, -0.03, 0, g, 22);
    rim.userData.noTint = true;
    const fills = (item.fills || []).map((f) => f.id as string);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = gimbapSlice(Math.cos(a) * 0.17, 0.03, Math.sin(a) * 0.17, fills);
      s.rotation.y = a * 0.7; // 조각마다 속이 조금씩 다르게 놓이도록
      g.add(s);
    }
    g.add(gimbapSlice(0, 0.03, 0, fills));
  } else if (id === 'broom') {
    const stick = cyl(0.035, 1.25, C.broomStick, 0, 0.25, 0, g, 10);
    stick.userData.noTint = true;
    const head = box(0.34, 0.3, 0.14, C.broomHead, 0, -0.48, 0, g);
    head.rotation.z = 0.05;
    for (let i = 0; i < 5; i++) box(0.045, 0.2, 0.1, 0xc79a3f, -0.12 + i * 0.06, -0.7, 0, g);
  } else {
    box(0.2, 0.2, 0.2, 0xcccccc, 0, 0, 0, g);
  }
  return g;
}

/** ItemId 로 좁혀지지 않는 자리가 있어 문자열로 받는다 */
export type { ItemId };
