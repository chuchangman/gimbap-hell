/* 주방 설비 — 냉장고 · 싱크대 · 밥솥 · 가스렌지 · 도마 · 조립대 ·
   음쓰통 · 빗자루 · 서빙대. 레거시 world.js 1145-1557 줄을 그대로 옮겼다.
   (매 프레임 갱신하는 sync* 는 다음 슬라이스에서 옮긴다) */
import { asset, assetOrNull, partOf } from '@/features/assets/assets';
import { makeItemMesh } from '@/features/world/items';
import { m1, mat, ownMat } from '@/features/world/materials';
import { labelSprite, stationPanel, wallLabel } from '@/features/world/panel';
import { box, cyl, hitProxy } from '@/features/world/primitives';
import { D } from '@/features/world/registry';
import { counterBody, counterTop } from '@/features/world/room';
import { scene } from '@/features/world/scene';
import {
  BOARD_COUNT,
  boardX,
  BROOM_COUNT,
  BROOM_SPOTS,
  BURNERS,
  burnerZ,
  C,
  COOKER_COUNT,
  cookerZ,
  FRIDGE_ROW_A,
  FRIDGE_ROW_B,
  fridgeZ,
  ITEMS,
  KITCHEN_LAYOUT,
  MAT_COUNT,
  matX,
  QUEUE_SLOTS,
  QUEUE_Z,
  SERVE_Z,
  slotX,
} from '@repo/game-core';
import * as THREE from 'three';

/* ──────────────── 🧊 냉장고 (2단 · 10칸) ────────────────
   칸마다 진짜로 파인 홈을 만든다. 예전엔 평평한 앞판에 얇은 받침만 대고
   재료를 얹었더니 벽과 재료가 같은 밝기라, 어느 칸에 뭐가 있는지 구분이
   안 됐다. 뒤를 어둡게 깔고 칸막이·선반으로 격자를 세워 칸을 따로 떼어
   보이게 하고, 이름표는 칸 아래 선반 앞면에 붙인다 (진열대 가격표처럼). */
export function buildFridge(): void {
  const { x: X, z: Z } = KITCHEN_LAYOUT.fridge;

  const DEPTH = 0.55; // 홈이 파인 깊이 (재료가 앞으로 안 튀어나올 만큼)
  const CUB_H = 0.8; // 홈 높이
  const BOARD = 0.12; // 선반 두께
  const WALL = 0.09; // 칸막이 두께
  const front = X + 0.575; // 냉장고 앞면
  const back = front - DEPTH; // 홈 안쪽 끝
  const inX = (front + back) / 2; // 홈 한가운데

  /* 재료는 각 칸 바닥에 얹힌다 */
  const rows = [
    { ids: FRIDGE_ROW_A, floorY: 1.02 },
    { ids: FRIDGE_ROW_B, floorY: 1.94 },
  ];
  const topY = rows[1].floorY + CUB_H; // 홈 위끝
  const H = topY + 0.16; // 몸통 높이

  /* 몸통 — 모델이 있으면 통째로 대신한다.
     칸에 놓는 재료·조준 상자·이름표는 언제나 코드가 맡는다. */
  const shell = asset('station/fridge', () => {
    const g = new THREE.Group();
    const backW = 1.15 - DEPTH;
    box(backW, H, 5.9, C.fridge, back - backW / 2 - X, H / 2, 0, g); // 뒤판
    box(1.15, rows[0].floorY, 5.9, C.fridge, 0, rows[0].floorY / 2, 0, g); // 아래 몸통
    box(1.15, H - topY, 5.9, C.fridge, 0, (H + topY) / 2, 0, g); // 윗단
    box(DEPTH, BOARD, 5.9, C.fridgeEdge, inX - X, rows[1].floorY - BOARD / 2, 0, g); // 선반
    for (let i = 0; i <= 5; i++)
      // 세로 칸막이
      box(
        DEPTH,
        topY - rows[0].floorY,
        WALL,
        C.fridgeEdge,
        inX - X,
        (topY + rows[0].floorY) / 2,
        -2.875 + i * 1.15,
        g,
      );
    rows.forEach((r) =>
      r.ids.forEach((_id, i) => {
        // 홈 안쪽 벽
        box(
          0.03,
          CUB_H,
          1.15 - WALL,
          C.fridgeIn,
          back + 0.02 - X,
          r.floorY + CUB_H / 2,
          -2.3 + i * 1.15,
          g,
        );
      }),
    );
    return g;
  });
  shell.position.set(X, 0, Z);
  scene.add(shell);

  rows.forEach((r) =>
    r.ids.forEach((id, i) => {
      const z = fridgeZ(i);
      const y = r.floorY + 0.12;
      const def = ITEMS[id];

      const sample = makeItemMesh({ id, stage: 'raw' });
      sample.position.set(inX + 0.03, y, z);
      sample.rotation.y = Math.PI / 2; // 긴 쪽을 칸 면에 나란히 — 앞으로 찌르지 않게
      sample.scale.setScalar(1.45);
      scene.add(sample);
      hitProxy({ kind: 'fridge', item: id });

      const p = wallLabel(
        def.emoji + ' ' + def.name,
        0.17,
        front + 0.05,
        r.floorY - BOARD / 2 - 0.01,
        z,
        Math.PI / 2,
        '#fff',
      );
      D.fridge.push({ id, sample, label: p });
    }),
  );

  wallLabel('🧊 냉장고', 0.3, front + 0.05, H + 0.22, Z, Math.PI / 2, '#a8e6ff');
}

/* ──────────────── 🚰 싱크대 ──────────────── */
export function buildSink(): void {
  const { x: X, z: Z } = KITCHEN_LAYOUT.sink;
  const BW = 0.92,
    BD = 1.36,
    WALL2 = 0.055,
    LIP = 0.2;
  const bx = 0.05; // 개수대 한가운데 (조리대 기준 국소좌표)

  /* 껍데기 — 몸통·개수대·수도꼭지. 국소좌표로 짓고 그룹을 통째로 옮긴다.
     그래야 모델로 갈아끼울 때 원점 규격(바닥 한가운데)이 그대로 맞는다. */
  const shell = asset('station/sink', () => {
    const g = new THREE.Group();
    counterBody(0, 0, 1.3, 2.1, 0x8fb4c4, g); // 싱크대 — 청록 스틸

    /* 개수대 — 속 상자를 겹쳐 놓으면 아무리 어둡게 해도 뚜껑처럼 보인다.
       상자가 서로 뚫고 지나갈 뿐이라 안이 안 비기 때문이다.
       벽 네 장과 바닥으로 실제로 빈 통을 짓는다. */
    const rim = 0xbcc3c9,
      deep = 0x646d75;
    box(WALL2, LIP, BD, rim, bx - BW / 2, 1.14, 0, g); // 왼벽
    box(WALL2, LIP, BD, rim, bx + BW / 2, 1.14, 0, g); // 오른벽
    box(BW + WALL2, LIP, WALL2, rim, bx, 1.14, -BD / 2, g); // 앞벽
    box(BW + WALL2, LIP, WALL2, rim, bx, 1.14, BD / 2, g); // 뒷벽
    box(BW, 0.03, BD, deep, bx, 1.055, 0, g); // 바닥 (어둡게)
    cyl(0.075, 0.016, 0x49515a, bx, 1.072, 0, g, 12); // 배수구

    /* 수도꼭지 — 기둥·굽은 목·주둥이·손잡이 두 개로 나눠야 수도로 읽힌다 */
    cyl(0.052, 0.3, C.steel, -0.44, 1.19, 0, g, 12); // 기둥 밑동
    cyl(0.042, 0.3, C.steel, -0.44, 1.46, 0, g, 12); // 목
    const neck = cyl(0.038, 0.3, C.steel, -0.3, 1.6, 0, g, 12);
    neck.rotation.z = Math.PI / 2; // 앞으로 꺾인 목
    cyl(0.032, 0.1, C.steel, -0.16, 1.55, 0, g, 10); // 아래로 떨어지는 주둥이
    for (const s2 of [-1, 1]) {
      // 냉·온수 손잡이
      const h = cyl(0.026, 0.13, 0xd8dde1, -0.44, 1.3, s2 * 0.15, g, 8);
      h.rotation.x = Math.PI / 2;
      cyl(0.045, 0.02, s2 < 0 ? 0x4f8fd0 : 0xd06060, -0.44, 1.3, s2 * 0.21, g, 10).rotation.x =
        Math.PI / 2;
    }
    return g;
  });
  shell.position.set(X, 0, Z);
  shell.rotation.y = Math.PI / 2;
  scene.add(shell);
  // 90° 회전한 실제 GLB 바닥 크기(1.70 × 1.30)에 충돌 영역도 맞춘다.

  /* 물줄기 — 모델이 water 노드를 들고 있으면 그걸 쓴다 */
  const fromModel = partOf(shell, 'water');
  // 회전된 수전 주둥이의 바로 아래. 이전 좌표는 개수대 중앙이라 물줄기가
  // 관 옆에서 솟는 것처럼 보였다.
  const water = fromModel || ownMat(cyl(0.035, 0.18, C.water, X - 0.31, 1.19, Z - 0.1, scene, 8));
  if (!fromModel) {
    m1(water).transparent = true;
    m1(water).opacity = 0.55;
  }
  water.visible = false;

  hitProxy({ kind: 'sink' });

  const panel = stationPanel(0.8, X + 0.25, 1.85, Z);

  labelSprite('🚰 싱크대 — 쌀 씻기', 1.45, 0, scene, '#9fd8ff').sprite.position.set(
    X + 0.3,
    2.2,
    Z,
  );
  // 씻는 쌀은 개수대 한가운데 놓는다 (예전엔 왼쪽 벽 메시 위치를 썼다)
  D.sink = { basinX: X + bx, basinZ: Z, water, panel, riceMesh: null };
}

/* ──────────────── 🍚 밥솥 ×2 ──────────────── */
export function buildCookers(): void {
  const X = KITCHEN_LAYOUT.cookers.x;
  for (let i = 0; i < COOKER_COUNT; i++) {
    const Z = cookerZ(i);
    const shell = asset('station/cooker', () => {
      const g = new THREE.Group();
      counterBody(0, 0, 1.3, 2.1, 0xe0cfa8, g); // 밥솥 — 크림
      const body = cyl(0.36, 0.44, 0xf0eee9, 0.05, 1.24, 0, g, 20);
      const lid = cyl(0.37, 0.12, 0xdcd8d0, 0, 0.27, 0, body, 20);
      lid.name = 'lid';
      cyl(0.375, 0.022, 0xb8b3ab, 0, 0.2, 0, body, 20); // 뚜껑 이음매
      cyl(0.07, 0.06, C.steelDark, 0, 0.08, 0, lid, 10);
      const face = box(0.22, 0.16, 0.02, 0x2b2f33, 0, 0.02, 0.36, body);
      box(0.18, 0.1, 0.01, 0x5ad07a, 0, 0, 0.02, face);
      cyl(0.05, 0.045, 0xc8c3ba, 0, 0.12, 0, lid, 10); // 김 빠지는 구멍
      for (const s3 of [-1, 1]) {
        // 양쪽 손잡이
        const hh = box(0.07, 0.05, 0.16, 0xd8d3ca, s3 * 0.39, 0.02, 0, body);
        hh.userData.noTint = true;
      }
      box(0.2, 0.035, 0.02, 0x9aa0a6, 0, -0.1, 0.36, body); // 버튼 줄
      return g;
    });
    shell.position.set(X, 0, Z);
    // 왼쪽 벽 설비의 전면은 주방 안쪽(+x)을 향한다.
    shell.rotation.y = Math.PI / 2;
    scene.add(shell);

    /* 뚜껑 — 취사 중에 들썩인다. 모델이 lid 노드를 들고 있으면 그걸 쓴다 */
    const lid = partOf(shell, 'lid');

    const steam = [];
    for (let s = 0; s < 5; s++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 4),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
      );
      m.position.set(X + 0.05, 1.6, Z);
      m.visible = false;
      scene.add(m);
      steam.push({ mesh: m, t: s / 5 });
    }

    hitProxy({ kind: 'cooker', cooker: i });

    const panel = stationPanel(0.85, X + 0.05, 1.92, Z);

    labelSprite('🍚 밥솥 ' + (i + 1), 1.3, 0, scene, '#ffd88a').sprite.position.set(
      X + 0.3,
      2.3,
      Z,
    );
    D.cookers.push({ lid, panel, steam, x: X + 0.05, z: Z });
  }
}

/* ──────────────── 🔥 가스렌지 5구 ──────────────── */
export function buildStove(): void {
  const { x: X, z: Z } = KITCHEN_LAYOUT.stove;
  // clay 스토브 모델의 실제 화구 중심은 로컬 x=0.08이다.
  const burnerX = KITCHEN_LAYOUT.stove.burnerX;
  /* 껍데기 — 몸통·조리면·화구 오덕·조절 손잡이.
     불꽃과 냄비·팬은 상태에 따라 변하므로 아래에서 따로 만든다. */
  const shell = asset('station/stove', () => {
    const g = new THREE.Group();
    counterBody(0, 0, 1.3, 6.8, 0x3a3734, g); // 가스렌지 — 짙은 차콜
    box(1.16, 0.06, 6.6, 0x33302c, 0, 1.02, 0, g);
    BURNERS.forEach((_b, i) => {
      const z = -3.8 + i * 1.3 - Z;
      const grate = new THREE.Group();
      grate.position.set(-0.05, 1.08, z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.026, 6, 16), mat(0x24211e));
      ring.rotation.x = Math.PI / 2;
      grate.add(ring);
      for (let k = 0; k < 4; k++) {
        const bar = box(0.44, 0.022, 0.045, 0x2b2724, 0, 0, 0, grate);
        bar.rotation.y = (k * Math.PI) / 4;
      }
      cyl(0.105, 0.05, 0x3a3531, 0, -0.02, 0, grate, 12); // 버너캡 받침
      cyl(0.075, 0.035, 0x1e1b19, 0, 0.015, 0, grate, 12); // 버너캡
      g.add(grate);
      /* 조절 손잡이 — 상판이 앞으로 나오므로 그보다 앞, 문짝 손잡이보다 위 */
      const knob = cyl(0.062, 0.055, 0x2b2724, -0.68, 0.88, z, g, 12);
      knob.rotation.z = Math.PI / 2;
      cyl(0.042, 0.015, 0x4a443f, -0.71, 0.88, z, g, 10).rotation.z = Math.PI / 2;
      box(0.016, 0.01, 0.052, 0xe4ded2, -0.72, 0.88, z + 0.028, g);
    });
    return g;
  });
  shell.position.set(X, 0, Z);
  scene.add(shell);

  BURNERS.forEach((b, i) => {
    // GLB의 6.8m 상판을 5등분한 실제 화구 간격(1.36m)을 그대로 쓴다.
    const z = burnerZ(i);

    const flame = ownMat(cyl(0.16, 0.14, C.fire, burnerX, 1.09, z, scene, 12, 0.04));
    m1(flame).transparent = true;
    m1(flame).opacity = 0.85;
    flame.visible = false;
    // 속의 파란 심지 — 겉불꽃만 있으면 주황 원뿔로만 보인다
    const core = ownMat(cyl(0.085, 0.075, 0x6bb8f0, 0, -0.03, 0, flame, 10, 0.02));
    m1(core).transparent = true;
    m1(core).opacity = 0.75;
    core.userData.noTint = true;

    const vessel = asset('station/' + b.kind, () => {
      const v = new THREE.Group();
      if (b.kind === 'pot') {
        cyl(0.27, 0.26, C.steel, 0, 0.13, 0, v, 20);
        cyl(0.245, 0.24, 0x9aa2a8, 0, 0.14, 0, v, 20);
        box(0.08, 0.04, 0.1, C.steelDark, 0.3, 0.2, 0, v).userData.noTint = true;
        box(0.08, 0.04, 0.1, C.steelDark, -0.3, 0.2, 0, v).userData.noTint = true;
        const w = ownMat(cyl(0.235, 0.02, C.water, 0, 0.2, 0, v, 20));
        m1(w).transparent = true;
        m1(w).opacity = 0.6;
        w.userData.noTint = true;
        w.name = 'water';
      } else {
        cyl(0.29, 0.07, 0x2f2c29, 0, 0.035, 0, v, 22);
        cyl(0.265, 0.05, 0x413c37, 0, 0.045, 0, v, 22);
        const handle = cyl(0.03, 0.42, 0x241f1b, 0, 0.05, 0.42, v, 8);
        handle.rotation.x = Math.PI / 2;
        handle.userData.noTint = true;
      }
      return v;
    });
    vessel.position.set(burnerX, 1.14, z);
    // 끓는 물 — 코드로 만들었든 모델에서 왔든 water 라는 이름으로 찾는다
    vessel.userData.water = partOf(vessel, 'water');
    scene.add(vessel);

    hitProxy({ kind: 'burner', slot: i });

    const panel = stationPanel(0.68, burnerX, 1.78, z);

    labelSprite(
      (b.kind === 'pot' ? '🥬 ' : '🍳 ') + b.label,
      0.8,
      0,
      scene,
      '#ffc9a0',
    ).sprite.position.set(burnerX, 1.52, z);

    D.burners.push({ vessel, flame, panel, mesh: null, tintTargets: [], key: null, kind: b.kind });
  });

  labelSprite('🔥 가스렌지', 1.5, 0, scene, '#ff9c5b').sprite.position.set(X - 0.2, 2.5, Z);
  labelSprite('냄비=데치기 · 팬=볶기/지단', 1.5, 0, scene, '#f0c9a0').sprite.position.set(
    X - 0.2,
    2.2,
    Z,
  );
}

/* ──────────────── 🔪 도마 ×3 ──────────────── */
export function buildBoards(): void {
  const Z = KITCHEN_LAYOUT.boards.z;
  counterTop(0, Z, 4.4, 1.7, 0xc07d3a); // 도마 — 진한 나무

  for (let i = 0; i < BOARD_COUNT; i++) {
    const x = boardX(i);
    const bm = assetOrNull('station/board');
    // 레거시는 쉼표 연산자를 썼다 (if (bm) a, b;). 동작은 같고 읽기만 낫다.
    if (bm) {
      bm.position.set(x, 1.06, Z);
      scene.add(bm);
    }
    if (!bm) {
      box(1.05, 0.07, 0.85, C.wood, x, 1.06, Z);
      box(1.0, 0.01, 0.8, 0xe2bc84, x, 1.1, Z);
      for (let g2 = 0; g2 < 4; g2++)
        // 나무결
        box(0.96, 0.004, 0.012, 0xd0a870, x, 1.107, Z - 0.3 + g2 * 0.2, scene);
      cyl(0.035, 0.012, 0xbf9a63, x - 0.44, 1.107, Z - 0.34, scene, 8); // 걸이 구멍
    }

    /* 칼 — 예전엔 납작한 막대 두 개였다. 날·등·슴베·손잡이로 나눈다 */
    const knifeFromModel = bm ? partOf(bm, 'knife') : null;
    const knifeAsset = knifeFromModel ? null : assetOrNull('item/knife');
    const knife = knifeFromModel || knifeAsset || new THREE.Group();
    if (!knifeFromModel && !knifeAsset) {
      box(0.055, 0.016, 0.4, 0xdfe4e8, 0, 0, 0, knife); // 날
      box(0.055, 0.022, 0.1, 0xc9ced3, 0, 0.006, -0.16, knife); // 날 끝 쪽 두께
      box(0.022, 0.03, 0.42, 0xb9bec4, 0, 0.016, 0.01, knife); // 칼등
      box(0.03, 0.03, 0.05, 0x8d949a, 0, 0.006, 0.22, knife); // 슴베
      box(0.05, 0.045, 0.16, 0x2f2a25, 0, 0, 0.29, knife); // 손잡이
      box(0.054, 0.012, 0.16, 0x1f1b17, 0, 0.024, 0.29, knife); // 손잡이 등
    }
    knife.position.set(x + 0.42, 1.14, Z);
    if (!knifeFromModel) scene.add(knife);

    hitProxy({ kind: 'board', board: i });

    const panel = stationPanel(0.7, x, 1.72, Z);

    D.boards.push({
      knife,
      panel,
      mesh: null,
      key: null,
      x,
      z: Z,
      knifeHome: knife.position.clone(),
    });
  }
  labelSprite('🔪 도마 3대', 1.4, 0, scene, '#ffe6b0').sprite.position.set(0, 1.98, Z);
}

/* ──────────────── 🍙 조립대 ×3 ──────────────── */
export function buildMats(): void {
  const Z = KITCHEN_LAYOUT.mats.z;
  counterTop(0, Z, 5.2, 1.7, 0xd99a4e); // 조립대 — 밝은 나무

  for (let i = 0; i < MAT_COUNT; i++) {
    const X = matX(i);

    /* 대나무 발 — 조립대 세 대가 상판 하나를 나눠 쓰므로
       교체 단위는 상판이 아니라 발 한 장이다. 발만 90° 돌린다. */
    const group = asset('station/mat', () => {
      const g = new THREE.Group();
      for (let s = 0; s < 12; s++) {
        const stick = cyl(0.026, 0.72, 0xc99a52, -0.33 + s * 0.06, 0, 0, g, 8);
        stick.rotation.x = Math.PI / 2;
      }
      return g;
    });
    group.position.set(X, 1.05, Z);
    // 새 클레이 GLB는 모델 자체의 대나무 봉을 이미 90° 돌려 내보낸다.
    // 코드 폴백만 예전처럼 여기서 회전시켜 이중 회전을 피한다.
    group.rotation.y = group.userData.fromAsset ? 0 : Math.PI / 2;
    scene.add(group);

    const gim = box(0.62, 0.016, 0.5, C.gim, X, 1.08, Z);
    gim.visible = false;
    const bap = box(0.54, 0.07, 0.4, C.bap, X, 1.12, Z);
    bap.visible = false;

    const fillGroup = new THREE.Group();
    fillGroup.position.set(X, 1.17, Z);
    scene.add(fillGroup);

    const roll = cyl(0.14, 0.62, C.gim, X, 1.15, Z, scene, 20);
    roll.rotation.z = Math.PI / 2;
    roll.visible = false;

    hitProxy({ kind: 'mat', mat: i });

    const panel = stationPanel(0.9, X, 1.75, Z);

    labelSprite('🍙 조립대 ' + (i + 1), 1.0, 0, scene, '#ffe08a').sprite.position.set(X, 2.02, Z);

    D.mats.push({ group, gim, bap, fillGroup, roll, panel, x: X, z: Z, fillKey: null });
  }
}

/* ──────────────── 🗑️ 음쓰통 · 🧹 빗자루 ──────────────── */
export function buildBin(): void {
  const { x: X, z: Z } = KITCHEN_LAYOUT.bin;
  const model = assetOrNull('station/bin');
  if (model) {
    model.position.set(X, 0, Z);
    scene.add(model);
  }
  if (!model) {
    cyl(0.42, 0.9, 0x3f7a4a, X, 0.45, Z, scene, 16, 0.36); // 아래로 좁아지는 몸통
    cyl(0.435, 0.05, 0x356b41, X, 0.62, Z, scene, 16); // 몸통 띠
    cyl(0.45, 0.08, 0x2f5c38, X, 0.94, Z, scene, 16); // 뚜껑
    cyl(0.2, 0.06, 0x24472b, X, 0.99, Z, scene, 12); // 뚜껑 손잡이
    box(0.3, 0.05, 0.16, 0x4a4f55, X - 0.34, 0.09, Z, scene); // 발판
    cyl(0.022, 0.85, 0x6b7178, X - 0.44, 0.5, Z, scene, 6); // 발판 연결대
  }
  // 충돌·상호작용·이름표는 모델을 넣어도 언제나 코드가 맡는다
  hitProxy({ kind: 'bin' });
  labelSprite('🗑️ 음쓰통', 1.25, 0, scene, '#a8e0b0').sprite.position.set(X, 1.5, Z);
}

export function buildBrooms(): void {
  for (let i = 0; i < BROOM_COUNT && i < BROOM_SPOTS.length; i++) {
    const s = BROOM_SPOTS[i];
    cyl(0.16, 0.1, 0x6b6660, s.x, 0.05, s.z, scene, 12).userData.noTint = true;
    const broom = makeItemMesh({ id: 'broom', stage: 'done' });
    broom.position.set(s.x, 0.78, s.z);
    broom.rotation.set(0.22, s.ry, 0.12);
    scene.add(broom);
    hitProxy({ kind: 'broom', rack: i });
    const label = labelSprite('🧹 빗자루', 1.1, 0, scene, '#ffe08a');
    label.sprite.position.set(s.x, 1.75, s.z);
    D.brooms.push({ mesh: broom, label });
  }
}

/* ──────────────── 서빙 테이블 ──────────────── */
export function buildServe(): void {
  /* 안내판·벨·접시·양옆 칸막이 없이 공용 테이블 한 개만 둔다.
     보이지 않는 상호작용 면은 테이블 전체에 남겨 기존 서빙 조작을 유지한다. */
  counterTop(0, SERVE_Z, 7.0, 0.9, 0xe08434);
  hitProxy({ kind: 'serve' });

  for (let i = 0; i < QUEUE_SLOTS; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 20),
      new THREE.MeshBasicMaterial({
        color: 0xe0728f,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(slotX(i), 0.02, QUEUE_Z);
    scene.add(ring);
  }
}
