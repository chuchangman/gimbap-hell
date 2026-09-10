/* 가게 짓기 — x -8..8, z -11..9
   레거시 world.js 932-1144 줄을 그대로 옮겼다. */
import { assetOrNull } from '@/features/assets/assets';
import { m1, mat, ownMat } from '@/features/world/materials';
import { wallLabel } from '@/features/world/panel';
import { box } from '@/features/world/primitives';
import { DOOR, scene } from '@/features/world/scene';
import { buildStorefrontAndStreet } from '@/features/world/street';
import { C, TIME } from '@repo/game-core';
import * as THREE from 'three';

export function buildRoom(): void {
  /* ASTRONEER 가 쓰는 방식 — 멀수록 하늘색으로 바래게 한다.
     안개 색을 배경과 똑같이 맞춰야 먼 것이 "흐려지는" 게 아니라
     "공기에 녹아드는" 것으로 보인다. 회색 안개를 쓰면 그냥 뿌옇기만 하다. */
  const SKY = 0xbfe0ea;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 12, 38);

  /* 중성 주변광을 충분히 둬 흰 음식과 그릇의 암부가 회색으로 죽지 않게 한다.
     방향광은 형태를 읽을 정도만 남겨 로우폴리 면이 과하게 번쩍이지 않게 한다. */
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  /* 따뜻한 주광 — 형태만 읽히게 하고 실시간 그림자는 만들지 않는다 */
  const key = new THREE.DirectionalLight(0xfff7e9, 1.45);
  key.position.set(6, 13, 8);
  key.castShadow = false;
  scene.add(key);

  /* 차가운 보조광 — 주광과 색이 반대라야 평평한 면이 입체로 읽힌다 */
  const fill = new THREE.DirectionalLight(0xddeeff, 0.42);
  fill.position.set(-8, 6, -7);
  scene.add(fill);

  /* 바닥 반사 — 아래를 보는 면(턱 밑·선반 밑)이 새까맣게 죽는 걸 막는다 */
  const bounce = new THREE.DirectionalLight(0xfff1d6, 0.18);
  bounce.position.set(-2, -6, 3);
  scene.add(bounce);

  const floorModel = assetOrNull('room/floor');
  if (floorModel) {
    floorModel.position.set(0, -0.05, -1);
    scene.add(floorModel);
  } else {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), mat(0xdce8ee));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -1;
    scene.add(floor);
  }

  const ceilingModel = assetOrNull('room/ceiling');
  if (ceilingModel) {
    ceilingModel.position.set(0, 3.45, -1);
    scene.add(ceilingModel);
  } else {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), mat(0xf8f6f0));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.4, -1);
    scene.add(ceiling);
  }

  const roomWalls: [string, number, number, number, number, number, number, number, number][] = [
    ['room/wall-back', 0, 1.7, 9, 16, 0, 9, Math.PI, 0xf2e2c4],
    ['room/wall-left', -8, 1.7, -1, 20, -8, -1, Math.PI / 2, 0xcbe6da],
    ['room/wall-right', 8, 1.7, -1, 20, 8, -1, -Math.PI / 2, 0xe9d9c8],
  ];
  for (const [name, x, y, z, w, fx, fz, ry, color] of roomWalls) {
    const model = assetOrNull(name);
    if (model) {
      model.position.set(x, y, z);
      scene.add(model);
    } else {
      const fallback = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.4), mat(color));
      fallback.position.set(fx, 1.7, fz);
      fallback.rotation.y = ry;
      scene.add(fallback);
    }
  }
  buildStorefrontAndStreet();

  /* 천장 형광등 — 예전엔 천장이 통짜 흰 판이라 실내로 안 읽혔다.
     빛을 실제로 쏘지는 않는다(방향광 두 개로 충분하다). 형태만 준다. */
  for (let i = 0; i < 3; i++) {
    for (const lx of [-3.6, 3.6]) {
      const lz = -7.4 + i * 6.2;
      box(1.5, 0.1, 0.44, 0xe4e6e2, lx, 3.33, lz); // 등 몸체
      const tube = box(1.34, 0.05, 0.3, 0xfffdf2, lx, 3.26, lz); // 발광면
      m1(ownMat(tube)).emissive = new THREE.Color(0xfff6d8);
      tube.userData.noTint = true;
    }
  }

  /* 환풍 덕트 — 가스렌지 위 */
  box(1.5, 0.34, 6.4, 0xc9ccc8, 6.9, 3.1, -1.2);
  box(1.62, 0.1, 6.5, 0xa8ada9, 6.9, 2.9, -1.2);
  for (let i = 0; i < 6; i++) box(1.3, 0.03, 0.06, 0x8f948f, 6.9, 2.84, -3.9 + i * 1.1);

  const sign = box(4.6, 1.5, 0.1, 0x2c2620, 0, 2.4, 8.9);
  box(4.3, 1.25, 0.02, 0x3a332b, 0, 0, -0.07, sign);
  wallLabel('🍣 김밥지옥', 0.44, 0, 0.36, -0.09, Math.PI, '#f5b942', sign);
  wallLabel('한 줄 한 줄 정성껏', 0.24, 0, -0.14, -0.09, Math.PI, '#e8e0d2', sign);

  const door = box(1.9, 2.3, 0.12, 0x6c93a8, DOOR.x, 1.15, -10.94);
  box(1.5, 1.5, 0.04, 0xd7ecf5, 0, 0.28, 0.07, door);
  box(0.07, 0.34, 0.05, 0xd8dde1, 0.62, -0.15, 0.09, door); // 문 손잡이
  wallLabel('🚪 출입문', 0.26, DOOR.x, 2.65, -10.8, 0, '#cfe9f5');

  // 공정 안내판 (오른쪽 벽) — 벽을 향한 고정 평면이라 각도가 틀어져도 안 잘린다
  box(0.08, 2.1, 3.6, 0x2c2620, 7.92, 2.05, 5.2);
  wallLabel('📋 김밥 만드는 순서', 0.28, 7.86, 2.86, 5.2, -Math.PI / 2, '#ffd88a');
  [
    '① 쌀 씻기 → 밥솥 취사 ' + TIME.riceCook + '초',
    '② 시금치 데치기 ' + TIME.blanchSpinach + '초 (냄비)',
    '③ 햄·계란·당근·어묵 볶기 (팬)',
    '④ 단무지·오이 썰기 ' + TIME.cutDanmuji + '초 (도마)',
    '⑤ 김 → 밥 → 속재료 → 말기 ' + TIME.roll + '초',
    '⑥ 도마에서 썰고 손님에게!',
  ].forEach((line, i) => {
    wallLabel(line, 0.21, 7.86, 2.48 - i * 0.3, 5.2, -Math.PI / 2, '#f3ead9');
  });
}

/**
 * 조리대 한 짝 — 싱크대·밥솥·가스렌지·도마·조립대·서빙대가 전부 이걸 쓴다.
 *
 * 예전엔 상자 하나에 얇은 판 한 장이라, 주방 어디를 봐도 같은 덩어리였다.
 * 업소용 작업대처럼 세 층으로 나눈다 —
 *   굽도리 : 바닥에서 안으로 들어가 그림자 선을 만든다. 이 선 하나가 가구처럼 보이게 한다
 *   몸통   : 문짝 이음매와 손잡이
 *   상판   : 앞으로 튀어나오고 아래 테두리가 진하다
 *
 * 문짝은 긴 면에 붙인다. 설비는 전부 벽이나 통로를 등지고 놓이므로
 * 긴 쪽이 사람이 서는 면이다. 상판 윗면(y 0.99)과 충돌 상자는 예전 그대로 —
 * 재료를 올리는 높이가 여기 맞춰져 있어서 건드리면 안 된다.
 */
export function counterTop(x: number, z: number, w: number, d: number, color?: number): void {
  /* 도마대·조립대·서빙대는 각각 KitchenTable 한 개를 전체 길이에 맞춰 쓴다.
     같은 테이블을 여러 개 붙였을 때 생기던 상판 이음매와 과한 다리를 없앤다. */
  const table = assetOrNull('station/table');
  if (table) {
    table.scale.set(w / 1.0, 1.04 / 0.67, d / 1.5);
    table.position.set(x, 0, z);
    scene.add(table);
  } else {
    counterBody(x, z, w, d, color, scene);
  }
}

/** 자연 크기의 가구를 긴 방향으로 반복해 지정한 받침대 영역을 채운다. */
export function tiledStation(
  name: string,
  natural: [number, number, number],
  x: number,
  z: number,
  w: number,
  d: number,
  height: number,
  parent: THREE.Object3D,
): boolean {
  const first = assetOrNull(name);
  if (!first) return false;

  const alongX = w >= d;
  const span = alongX ? w : d;
  const nativeSpan = alongX ? natural[0] : natural[2];
  const count = Math.max(1, Math.round(span / nativeSpan));
  const segment = span / count;

  for (let i = 0; i < count; i++) {
    // first 가 있으면 모델이 이미 올라와 있다 — 이후 사본도 반드시 나온다
    const model = i === 0 ? first : assetOrNull(name)!;
    model.scale.set(
      (alongX ? segment : w) / natural[0],
      height / natural[1],
      (alongX ? d : segment) / natural[2],
    );
    const offset = -span / 2 + segment * (i + 0.5);
    model.position.set(x + (alongX ? offset : 0), 0, z + (alongX ? 0 : offset));
    parent.add(model);
  }
  return true;
}

/**
 * 조리대의 형태만. 충돌 상자는 넣지 않는다 —
 * 모델이 형태를 대신해도 충돌은 언제나 코드가 놓아야 하므로 갈라두었다.
 */
export function counterBody(
  x: number,
  z: number,
  w: number,
  d: number,
  color: number | undefined,
  parent: THREE.Object3D,
): void {
  const col = color || C.counter;
  const KICK = 0.13; // 굽도리 높이

  /* 밥솥대와 긴 가스렌지 아래는 Cabinet3을 반복한다. 문짝 한 개를 길게
     늘이지 않아 각 수납장 폭과 손잡이 비율이 유지된다. */
  if (tiledStation('station/cabinet', [0.9, 0.67, 1.0], x, z, w, d, 1.04, parent)) return;

  /* 같은 받침대 모델을 모든 조리대가 공유하고 몸통 색만 바꾼다.
     파일 하나를 고치면 싱크대·밥솥대·렌지대·도마대·조립대·서빙대가 함께 바뀐다. */
  const base = assetOrNull('station/counter');
  if (base) {
    base.position.set(x, 0, z);
    base.scale.set(w, 1, d);
    ownMat(base).traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mm = mesh.material as (THREE.Material & { color?: THREE.Color }) | undefined;
      if (!mesh.isMesh || !mm?.color) return;
      if (o.name === 'tint_body') mm.color.setHex(col);
      else if (o.name === 'tint_kick') mm.color.set(new THREE.Color(col).multiplyScalar(0.42));
      else if (o.name === 'tint_trim') mm.color.set(new THREE.Color(col).multiplyScalar(0.7));
    });
    parent.add(base);
  } else {
    box(w - 0.15, KICK, d - 0.15, 0x4c4740, x, KICK / 2, z, parent); // 굽도리
    box(w, 0.95 - KICK, d, col, x, KICK + (0.95 - KICK) / 2, z, parent); // 몸통
    box(w + 0.07, 0.024, d + 0.07, 0x9a938a, x, 0.945, z, parent); // 상판 밑 선
    box(w + 0.06, 0.09, d + 0.06, C.counterTop, x, 0.99, z, parent); // 상판
  }

  /* 문짝 — 긴 면을 몇 칸으로 나눈다 */
  const alongX = w >= d;
  const span = alongX ? w : d;
  const n = Math.max(1, Math.round(span / 1.6));
  const seam = new THREE.Color(col).multiplyScalar(0.7).getHex();
  const grip = new THREE.Color(col).multiplyScalar(1.2).getHex();
  const off = (alongX ? d : w) / 2 + 0.008;

  for (const s of [-1, 1]) {
    for (let i = 1; i < n; i++) {
      // 칸 사이 이음매
      const t = -span / 2 + (span / n) * i;
      if (alongX) box(0.022, 0.7, 0.012, seam, x + t, 0.55, z + s * off, parent);
      else box(0.012, 0.7, 0.022, seam, x + s * off, 0.55, z + t, parent);
    }
    for (let i = 0; i < n; i++) {
      // 손잡이
      const t = -span / 2 + (span / n) * (i + 0.5);
      const len = (span / n) * 0.4;
      if (alongX) box(len, 0.036, 0.028, grip, x + t, 0.8, z + s * off, parent);
      else box(0.028, 0.036, len, grip, x + s * off, 0.8, z + t, parent);
    }
  }
}
