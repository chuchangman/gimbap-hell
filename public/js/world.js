/* ────────────────────────────────────────────────────────────
   3D 김밥집 — 주방 · 카운터 손님 · 동료 아바타 · 빗자루
   상태는 서버 스냅샷(net.js)에서 읽어오기만 한다.

   키오스크 손님이든 카운터 진상이든 모두 문에서 걸어 들어와 줄을 선다.
   말풍선으로 궁시렁대는 것은 진상 손님뿐이다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from '/vendor/three.module.min.js';
import { asset, partOf } from './assets.js';
import {
  ITEMS, FRIDGE_ROW_A, FRIDGE_ROW_B, TIME, C,
  BURNERS, BOARD_COUNT, MAT_COUNT, COOKER_COUNT, BROOM_COUNT,
  QUEUE_SLOTS, WALK_IN_MS, WALK_OUT_MS, KIND, grumbleFor,
  QUEUE_Z, slotX, CUSTOMER_HP,
  PARTS, PART_COLORS, sanitizeLook, lookFromSeed, EYE
} from './config.js';
import { S, serverNow, myHand, handOf, remotePositions } from './net.js';
import {
  burnerInfo, boardInfo, cookerAt, cookerProgress, rollProgress,
  matAt, sinkAt, broomTaken, unlockedFills, focusNow
} from './kitchen.js';

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 140);
export const interactables = [];   // 조준 가능한 메시
export const solids = [];          // 충돌용 AABB {minX,maxX,minZ,maxZ}

let renderer;
const D = {
  burners: [], boards: [], mats: [], brooms: [], cookers: [], fridge: [],
  sink: null,
  customers: new Map(),
  remotes: new Map(),
  hand: null, handBase: null, handKey: null
};

/* ──────────────── 좌표 ──────────────── */
export const SERVE_Z = -6.8;                 // 서빙 카운터
export const DOOR = { x: -6, z: -10.4 };     // 출입문
export const KIOSK = { x: 4.2, z: -9.3 };    // 키오스크
export { QUEUE_Z, slotX };                   // 줄 좌표는 config 가 갖고 있다 (서버와 공유)
const HIT_FLINCH_MS = 260;                   // 빗자루에 맞고 움찔거리는 시간

export const BROOM_SPOTS = [
  { x: -2.6, z: 7.9, ry: Math.PI },
  { x: 2.6, z: 7.9, ry: Math.PI },
  { x: 6.9, z: 3.4, ry: -Math.PI / 2 }
];

/* ──────────────── 헬퍼 ──────────────── */
/* ────────────────────────────────────────────────────────────
   지오메트리·재질 공유

   같은 크기 상자와 같은 색을 쓰는 메시가 수백 개인데 전부 제 것을 따로
   들고 있었다 — 메시 510개에 재질 510개, 지오메트리 510개.
   모양이 같으면 지오메트리를, 색이 같으면 재질을 하나로 같이 쓴다.

   ⚠ 공유하면 두 가지가 위험해진다. 둘 다 아래에서 막는다.
     1. 재질을 직접 바꾸면 그 재질을 쓰는 메시가 전부 같이 바뀐다
        → 바꾸기 전에 ownMat() 으로 떼어낸다 (복사 후 수정)
     2. dispose() 하면 아직 그 자원을 쓰는 메시가 깨진다
        → disposeObject 가 공유 자원은 건너뛴다
   ──────────────────────────────────────────────────────────── */
const geoCache = new Map();
const matCache = new Map();

/* ────────────────────────────────────────────────────────────
   모서리 깎은 상자

   그냥 BoxGeometry 를 쓰면 모서리가 완벽한 90도라, 어느 각도에서 봐도
   면과 면 사이가 한 픽셀 선으로만 갈린다. 로우폴리 렌더가 또렷해 보이는 건
   모서리를 살짝 깎아 그 자리에 좁은 면이 하나 더 생기고,
   그 면이 주광을 받아 밝은 테두리처럼 빛나기 때문이다.

   만드는 법 — 면마다 안으로 물린 네 귀퉁이, 모두 24점.
   그 볼록 껍질이 곧 깎인 상자다.
   껍질의 삼각형 연결은 크기와 무관하게 늘 같으므로 딱 한 번만 구해 돌려 쓴다.
   ──────────────────────────────────────────────────────────── */
const BEVEL = 0.012;          // 깎는 폭 (m). 너무 크면 둥근 비누처럼 보인다
let bevelIndex = null;        // 한 번 구한 삼각형 연결

/** 면마다 안으로 물린 24점 */
function bevelPoints(w, h, d) {
  const b = Math.min(BEVEL, Math.min(w, h, d) * 0.28);
  const H = [w / 2, h / 2, d / 2];
  const P = [];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    for (const sn of [-1, 1])
      for (const su of [-1, 1])
        for (const sv of [-1, 1]) {
          const p = [0, 0, 0];
          p[a] = sn * H[a];
          p[u] = su * (H[u] - b);
          p[v] = sv * (H[v] - b);
          P.push(p);
        }
  }
  return P;
}

/** 24점의 볼록 껍질 — 한 평면에 놓인 점은 모아서 한 번만 부채꼴로 자른다 */
function bevelHull(P) {
  const n = P.length;
  const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];

  const planes = new Map();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nv = cross(sub(P[j], P[i]), sub(P[k], P[i]));
    const L = Math.hypot(nv[0], nv[1], nv[2]);
    if (L < 1e-9) continue;
    nv = [nv[0] / L, nv[1] / L, nv[2] / L];
    let hi = 0, lo = 0;
    for (let m = 0; m < n; m++) {
      const s = dot(nv, sub(P[m], P[i]));
      if (s > 1e-7) hi++; else if (s < -1e-7) lo++;
      if (hi && lo) break;
    }
    if (hi && lo) continue;                        // 바깥 면이 아니다
    if (hi) nv = [-nv[0], -nv[1], -nv[2]];         // 법선을 바깥으로
    const off = dot(nv, P[i]);
    const key = nv.map((x) => x.toFixed(4)).join(',') + '|' + off.toFixed(4);
    if (!planes.has(key)) planes.set(key, { nv, off });
  }

  const idx = [];
  for (const { nv, off } of planes.values()) {
    const on = [];
    for (let m = 0; m < n; m++) if (Math.abs(dot(nv, P[m]) - off) < 1e-6) on.push(m);
    if (on.length < 3) continue;
    const c = [0, 0, 0];
    for (const m of on) for (let t = 0; t < 3; t++) c[t] += P[m][t] / on.length;
    let ux = sub(P[on[0]], c);
    const uL = Math.hypot(ux[0], ux[1], ux[2]);
    ux = [ux[0] / uL, ux[1] / uL, ux[2] / uL];
    const vy = cross(nv, ux);
    on.sort((a, c2) => {
      const pa = sub(P[a], c), pb = sub(P[c2], c);
      return Math.atan2(dot(pa, vy), dot(pa, ux)) - Math.atan2(dot(pb, vy), dot(pb, ux));
    });
    for (let t = 1; t < on.length - 1; t++) idx.push(on[0], on[t], on[t + 1]);
  }
  return idx;
}

/** 모서리 깎은 상자 지오메트리 */
function bevelBoxGeometry(w, h, d) {
  const P = bevelPoints(w, h, d);
  if (!bevelIndex) bevelIndex = bevelHull(P);      // 연결은 크기와 무관 — 최초 1회만
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(P.length * 3);
  for (let i = 0; i < P.length; i++) { arr[i * 3] = P[i][0]; arr[i * 3 + 1] = P[i][1]; arr[i * 3 + 2] = P[i][2]; }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.setIndex(bevelIndex.slice());
  g.computeVertexNormals();
  return g;
}

function sharedGeo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; geoCache.set(key, g); }
  return g;
}

/**
 * 램버트 재질. 같은 색·같은 옵션이면 하나를 돌려 쓴다.
 * 텍스처처럼 값으로 비교할 수 없는 옵션이 끼면 캐시하지 않는다.
 */
const mat = (color, opts) => {
  let key = null;
  if (!opts) key = color + '|flat';
  else if (Object.values(opts).every((v) => v === null || typeof v !== "object"))
    key = color + "|" + JSON.stringify(opts);

  /* flatShading 이 기본이다. 끄면 원기둥·구가 매끈하게 뭉개져
     면 분할이 안 보이고, 그러면 로우폴리가 아니라 그냥 플라스틱 덩어리가 된다. */
  const base = { color, flatShading: true };
  if (key === null) return new THREE.MeshLambertMaterial(Object.assign(base, opts));
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial(Object.assign(base, opts || {}));
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
};

/**
 * 공유 재질을 이 메시(또는 그 아래 전부)만의 것으로 떼어낸다.
 * material.color / opacity / emissive 를 건드리기 전에 반드시 부른다.
 * 안 부르면 같은 색을 쓰는 주방 설비까지 같이 물든다.
 */
function ownMat(obj) {
  if (!obj) return obj;
  obj.traverse((o) => {
    if (!o.material) return;
    const own = (m) => {
      if (!m.userData.shared) return m;
      const clone = m.clone();
      clone.userData.shared = false;
      return clone;
    };
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
  });
  return obj;
}

/**
 * GLB 한 벌에서 고른 재질만 이 인스턴스의 색으로 바꾼다.
 * 텍스처가 있는 원본 의상은 흰색에 가까운 틴트를 써서 무늬를 보존한다.
 */
function tintAssetMaterials(root, color, match) {
  if (!root) return root;
  ownMat(root);
  root.traverse((o) => {
    if (!o.material) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    materials.forEach((m) => {
      if (m.color && (!match || match(o, m))) m.color.set(color);
    });
  });
  return root;
}

function box(w, h, d, color, x, y, z, parent) {
  const m = new THREE.Mesh(
    sharedGeo("b" + w + "_" + h + "_" + d, () => bevelBoxGeometry(w, h, d)),
    mat(color)
  );
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

function cap(r, h, color, x, y, z, parent, seg) {
  /* 캡슐은 끝이 이미 둥글어서 팔다리 끝에 공을 따로 붙이지 않아도 된다.
     분할은 cyl 과 같은 이유로 낮춰 각을 남긴다. */
  const sg = Math.min(seg || 10, 10);
  const m = new THREE.Mesh(
    sharedGeo("k" + r + "_" + h + "_" + sg, () => new THREE.CapsuleGeometry(r, h, 3, sg)),
    mat(color)
  );
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

function cyl(r, h, color, x, y, z, parent, seg, r2) {
  /* 분할을 낮춰 옆면 각이 보이게 한다. 20 각이면 그냥 매끈한 원기둥이라
     flatShading 을 켜도 로우폴리로 안 읽힌다. 10 이면 각이 또렷하다. */
  const rb = r2 === undefined ? r : r2, sg = Math.min(seg || 12, 10);
  const m = new THREE.Mesh(
    sharedGeo("c" + r + "_" + rb + "_" + h + "_" + sg,
      () => new THREE.CylinderGeometry(r, rb, h, sg)),
    mat(color)
  );
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

/** 씬에서 뺀 메시의 GPU 자원을 실제로 놓아준다 (안 하면 계속 쌓인다) */
function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    // 공유 자원은 다른 메시가 아직 쓰고 있다 — 놓아주면 그쪽이 깨진다
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData.shared) continue;
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

/** 씬에서 제거 + 자원 해제 */
function kill(obj, parent) {
  if (!obj) return null;
  (parent || scene).remove(obj);
  disposeObject(obj);
  return null;
}

function addSolid(x, z, w, d) {
  solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

function station(mesh, data) {
  mesh.userData.station = data;
  interactables.push(mesh);
  return mesh;
}

function hitProxy(x, y, z, w, h, d, data) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  m.position.set(x, y, z);
  m.renderOrder = -1;
  scene.add(m);
  return station(m, data);
}

/* 캔버스 텍스처 라벨/게이지
   그릴 내용이 바뀌지 않으면 캔버스도 텍스처도 건드리지 않는다.
   (안 그러면 매 프레임 GPU 로 텍스처를 다시 올린다) */
class Panel {
  /**
   * flat=true 면 빌보드가 아니라 고정 평면으로 만든다.
   * 벽·냉장고에 붙는 안내는 회전하면 몸통을 파고들어 잘리므로 평면이어야 한다.
   */
  constructor(w, h, scale, depthTest, flat) {
    this.cv = document.createElement('canvas');
    this.cv.width = w; this.cv.height = h;
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;

    if (flat) {
      this.sprite = new THREE.Mesh(
        new THREE.PlaneGeometry(scale, scale * h / w),
        new THREE.MeshBasicMaterial({
          map: this.tex, transparent: true, depthTest: !!depthTest, depthWrite: false
        })
      );
    } else {
      this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex, transparent: true, depthTest: !!depthTest
      }));
      this.sprite.scale.set(scale, scale * h / w, 1);
    }
    this.sprite.renderOrder = depthTest ? 5 : 10;
    this.sig = null;
  }
  clear() { this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); }

  /** 주어진 폭에 들어가도록 글자 크기를 낮춰 잡는다 */
  fitFont(str, maxW, weight, baseSize) {
    let size = baseSize;
    const set = () => { this.ctx.font = weight + ' ' + size + 'px system-ui, sans-serif'; };
    set();
    while (size > 9 && this.ctx.measureText(str).width > maxW) { size -= 1; set(); }
    return size;
  }

  text(str, opts) {
    const o = opts || {};
    const sig = 'T' + str + (o.color || '') + (o.bg || '');
    if (this.sig === sig) return;
    this.sig = sig;
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    this.clear();
    if (o.bg !== false) {
      ctx.fillStyle = o.bg || 'rgba(18,15,12,.82)';
      ctx.beginPath(); ctx.roundRect(2, 2, W - 4, H - 4, 14); ctx.fill();
    }
    ctx.fillStyle = o.color || '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 캔버스를 넘치면 글자를 줄인다 — 어떤 문구가 와도 잘리지 않는다
    let size = Math.round(H * (o.scale || 0.44));
    const maxW = W - 16;
    ctx.font = '600 ' + size + 'px system-ui, sans-serif';
    while (size > 9 && ctx.measureText(str).width > maxW) {
      size -= 1;
      ctx.font = '600 ' + size + 'px system-ui, sans-serif';
    }
    ctx.fillText(str, W / 2, H / 2);
    this.tex.needsUpdate = true;
  }

  gauge(title, pct, color, sub) {
    // 1% 단위로만 다시 그린다 — 프레임마다 텍스처를 올리지 않기 위해
    const q = Math.round(Math.min(1, Math.max(0, pct)) * 100);
    const sig = 'G' + title + q + color + (sub || '');
    if (this.sig === sig) return;
    this.sig = sig;

    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    this.clear();
    ctx.fillStyle = 'rgba(18,15,12,.86)';
    ctx.beginPath(); ctx.roundRect(2, 2, W - 4, H - 4, 12); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.fitFont(title, W - 16, '700', 30);
    ctx.fillText(title, W / 2, H * 0.3);
    const bx = 18, bw = W - 36, by = H * 0.52, bh = 18;
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 9); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(bx, by, Math.max(6, bw * (q / 100)), bh, 9); ctx.fill();
    if (sub) {
      ctx.fillStyle = '#d8c8ae';
      this.fitFont(sub, W - 16, '600', 23);
      ctx.fillText(sub, W / 2, H * 0.84);
    }
    this.tex.needsUpdate = true;
  }

  /** 주문 내용을 재료 이름으로 (손님 머리 위) */
  order(title, names, pct, color, sub) {
    const q = Math.round(Math.min(1, Math.max(0, pct)) * 100);
    const sig = 'O' + title + names + q + color + (sub || '');
    if (this.sig === sig) return;
    this.sig = sig;
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    this.clear();
    ctx.fillStyle = 'rgba(18,15,12,.88)';
    ctx.beginPath(); ctx.roundRect(2, 2, W - 4, H - 4, 14); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    this.fitFont(title, W - 16, '700', 24);
    ctx.fillText(title, W / 2, H * 0.17);

    // 재료 이름 — 폭에 맞춰 두 줄까지 접는다
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#ffe6b0';
    const words = String(names).split(' · ');
    const lines = []; let cur = '';
    for (const wd of words) {
      const test = cur ? cur + ' · ' + wd : wd;
      if (ctx.measureText(test).width > W - 28 && cur) { lines.push(cur); cur = wd; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    const show = lines.slice(0, 2);
    show.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.42 + i * 24 - (show.length - 1) * 12));

    const bx = 16, bw = W - 32, by = H * 0.74, bh = 13;
    ctx.fillStyle = '#3a2f24';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(bx, by, Math.max(5, bw * (q / 100)), bh, 7); ctx.fill();
    if (sub) {
      ctx.fillStyle = '#d8c8ae';
      this.fitFont(sub, W - 16, '600', 21);
      ctx.fillText(sub, W / 2, H * 0.91);
    }
    this.tex.needsUpdate = true;
  }
}

/* 글자 폭을 재는 공용 캔버스 */
const scratch = document.createElement('canvas').getContext('2d');

/**
 * 글자가 들어갈 만큼 캔버스를 넓혀서 Panel 을 만든다.
 * 월드 폭도 같은 비율로 키우므로 글자 높이는 라벨마다 일정하게 유지된다.
 */
function fittedPanel(text, worldWidth, depthTest, baseH, flat) {
  const H = baseH || 64;
  const size = Math.round(H * 0.44);
  scratch.font = '600 ' + size + 'px system-ui, sans-serif';
  const need = scratch.measureText(String(text)).width + 34;   // 좌우 여백
  const W = Math.max(256, Math.ceil(need / 32) * 32);
  return new Panel(W, H, (worldWidth || 0.9) * (W / 256), depthTest, flat);
}

/**
 * 벽·냉장고 같은 면에 붙이는 안내판.
 * 빌보드가 아니라 고정 평면이라 어느 각도에서 봐도 몸통에 파묻히지 않는다.
 *   rotY: 0 = +z 를 향함, PI/2 = +x, -PI/2 = -x, PI = -z
 */
function wallLabel(text, rowHeight, x, y, z, rotY, color, parent) {
  const H = 64;
  scratch.font = '600 ' + Math.round(H * 0.44) + 'px system-ui, sans-serif';
  const need = scratch.measureText(String(text)).width + 30;
  const W = Math.max(160, Math.ceil(need / 16) * 16);
  // 세로 높이를 고정하고 가로는 글자 길이만큼 — 판마다 글자 크기가 같아진다
  const p = new Panel(W, H, rowHeight * (W / H), true, true);
  p.text(text, { color: color || '#fff' });
  p.sprite.position.set(x, y, z);
  p.sprite.rotation.y = rotY;
  (parent || scene).add(p.sprite);
  return p;
}

function labelSprite(text, scale, y, parent, color) {
  const p = fittedPanel(text, scale || 0.9, true);
  p.text(text, { color: color || '#fff' });
  p.sprite.position.y = y;
  (parent || scene).add(p.sprite);
  return p;
}

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

/* 속재료로 쓰이는 id — 손질이 끝난 형태는 fillPiece 가 맡는다 */
const FILL_IDS = new Set(['danmuji', 'ham', 'spinach', 'crab', 'cucumber', 'egg', 'carrot', 'fishcake']);

/** 기본 조합 — 주문 정보가 없을 때 단면에 채울 속 */
const DEFAULT_FILLS = ['danmuji', 'ham', 'spinach'];

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
function fillPiece(id, len, burnt, simple) {
  /* 직접 만든 모델이 있으면 그것을 쓴다.
     모델은 길이 1 로 만들어 두고 여기서 len 만큼 늘인다 —
     그래서 김밥 단면(0.12)과 손에 든 재료(0.44)가 같은 모델을 공유한다. */
  const wrap = new THREE.Group();
  const model = asset('fill/' + id, () => null);
  if (model) {
    model.scale.y = len;
    if (burnt) ownMat(model).traverse((o) => {
      if (o.isMesh && o.material.color) o.material.color.multiplyScalar(0.32);
    });
    wrap.add(model);
    return wrap;
  }

  const g = new THREE.Group();
  const dim = (c) => (burnt ? C.burnt : c);

  if (id === 'danmuji') {
    // 굵은 정사각 — 속재료 중 가장 두툼하다
    box(0.056, len, 0.056, dim(C.danmujiCut), 0, 0, 0, g);

  } else if (id === 'ham') {
    // 넓적한 직사각 — 단무지보다 납작하고 넓다
    box(0.074, len, 0.040, dim(C.hamDone), 0, 0, 0, g);

  } else if (id === 'egg') {
    // 지단 — 아주 납작하고 넓은 판. 흰자 층이 다른 노란 재료와 갈라주는 표시다
    box(0.088, len, 0.022, dim(C.eggYolk), 0, 0, -0.008, g);
    if (!burnt) box(0.088, len, 0.011, C.eggWhite, 0, 0, 0.013, g);

  } else if (id === 'crab') {
    // 맛살 — 여덟 종 중 혼자 둥글다. 겉만 빨갛고 속은 희다
    cyl(0.030, len, dim(C.crabRed), 0, 0, 0, g, simple ? 8 : 12);
    cyl(0.023, len * 1.004, dim(C.crab), 0, 0, 0, g, simple ? 8 : 12);

  } else if (id === 'cucumber') {
    // 오이 — 사각인데 한 면만 진한 껍질
    box(0.050, len, 0.048, dim(C.cucumber), 0, 0, 0, g);
    box(0.052, len, 0.013, dim(C.cucumberSkin), 0, 0, -0.024, g);

  } else if (id === 'spinach') {
    // 시금치 — 각진 재료들 사이에서 혼자 불규칙하다
    const n = simple ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.030, 0),
        mat(dim(C.spinachDone), { flatShading: true })
      );
      b.position.set(((i % 2) - 0.5) * 0.026, (i / (n - 1) - 0.5) * len * 0.6, ((i % 3) - 1) * 0.017);
      b.scale.set(1, Math.max(1, len * 0.75 / 0.06), 1);
      b.rotation.y = i * 1.1;
      g.add(b);
    }

  } else if (id === 'carrot') {
    // 당근 — 하나가 아니라 가는 채 여러 가닥
    const n = simple ? 3 : 5;
    for (let i = 0; i < n; i++) {
      box(0.019, len, 0.019, dim(C.carrot),
        (i - (n - 1) / 2) * 0.023, 0, ((i % 2) - 0.5) * 0.022, g);
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
function fillLaid(id, burnt) {
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
function rollFace(fills, simple) {
  const s = new THREE.Group();
  const list = (fills && fills.length ? fills : DEFAULT_FILLS).slice(0, 6);
  const T = 0.12;                                   // 조각 두께
  cyl(0.105, T, C.gim, 0, 0, 0, s, 18);             // 겉의 김
  cyl(0.092, T * 1.03, C.bap, 0, 0.002, 0, s, 18);  // 밥
  // 속은 가운데로 모은다 — 실제 김밥처럼 뭉쳐야 재료끼리 겹쳐 보이지 않는다
  const R = list.length === 1 ? 0 : 0.042;
  list.forEach((id, i) => {
    const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
    const p = fillPiece(id, T * 1.06, false, simple);
    p.position.set(Math.cos(a) * R, 0.003, Math.sin(a) * R);
    p.rotation.y = -a;                              // 납작한 재료가 중심을 향해 눕는다
    s.add(p);
  });
  return s;
}

/** 김밥 한 조각 — 옆은 김, 위는 밥과 속재료 단면 */
function gimbapSlice(x, y, z, fills) {
  const s = rollFace(fills, true);
  s.position.set(x, y, z);
  return s;
}

export function makeItemMesh(item) {
  const g = new THREE.Group();
  if (!item) return g;
  const id = item.id;
  const st = item.stage;
  const burnt = st === 'burnt';

  /* 손질이 끝난 속재료는 여덟 종이 모두 같은 형태 언어를 쓴다 */
  // 맛살은 별도 손질이 없으므로 냉장고에서 꺼낸 순간부터 완성 형태를 쓴다.
  if ((st !== 'raw' || id === 'crab') && FILL_IDS.has(id)) return fillLaid(id, burnt);

  /* 손질 전 원물 — 모델이 있으면 통째로 대체한다 */
  if (st === 'raw' && FILL_IDS.has(id)) {
    const raw = asset('raw/' + id, () => null);
    if (raw) {
      if (burnt) ownMat(raw).traverse((o) => {
        if (o.isMesh && o.material.color) o.material.color.multiplyScalar(0.32);
      });
      g.add(raw);
      return g;
    }
  }

  /* 김·밥·쌀·빗자루도 이름만 맞으면 대체된다 */
  if (['gim', 'bap', 'rice', 'broom'].includes(id)) {
    const m = asset('item/' + id, () => null);
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
    ownMat(sheet).material.side = THREE.DoubleSide;
    box(0.64, 0.004, 0.52, C.gimEdge, 0, -0.01, 0, g);

  } else if (id === 'rice') {
    const bowl = cyl(0.21, 0.14, C.steel, 0, 0, 0, g, 18, 0.15);
    cyl(0.185, 0.03, st === 'washed' ? C.riceWashed : C.riceRaw, 0, 0.06, 0, bowl, 18);
    if (st === 'washed') {
      const w = ownMat(cyl(0.19, 0.05, C.water, 0, 0.075, 0, bowl, 18));
      w.material.transparent = true; w.material.opacity = 0.55;
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
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(col, { flatShading: true }));
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
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(0x4f8f38, { flatShading: true }));
    top.position.set(-0.23, 0.02, 0);
    g.add(top);

  } else if (id === 'fishcake') {
    const col = burnt ? C.burnt : C.fishcake;
    box(0.4, 0.02, 0.3, col, 0, 0, 0, g).rotation.y = 0.15;
    box(0.4, 0.02, 0.3, col, 0, 0.03, 0.03, g).rotation.y = -0.1;

  /* ── 김밥 ── */
  } else if (id === 'roll') {
    // 만 김밥 한 줄 — 아직 안 썰었다. 양 끝으로 속이 비친다
    const fills = (item.fills || []).map((f) => f.id);
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
    const fills = (item.fills || []).map((f) => f.id);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = gimbapSlice(Math.cos(a) * 0.17, 0.03, Math.sin(a) * 0.17, fills);
      s.rotation.y = a * 0.7;                  // 조각마다 속이 조금씩 다르게 놓이도록
      g.add(s);
    }
    g.add(gimbapSlice(0, 0.03, 0, fills));

  } else if (id === 'broom') {
    const stick = cyl(0.035, 1.25, C.broomStick, 0, 0.25, 0, g, 10);
    stick.userData.noTint = true;
    const head = box(0.34, 0.30, 0.14, C.broomHead, 0, -0.48, 0, g);
    head.rotation.z = 0.05;
    for (let i = 0; i < 5; i++) box(0.045, 0.20, 0.1, 0xc79a3f, -0.12 + i * 0.06, -0.70, 0, g);

  } else {
    box(0.2, 0.2, 0.2, 0xcccccc, 0, 0, 0, g);
  }
  return g;
}

/* ────────────────────────────────────────────────────────────
   가게 짓기 — x −8..8, z −11..9
   ──────────────────────────────────────────────────────────── */
function buildRoom() {
  /* ASTRONEER 가 쓰는 방식 — 멀수록 하늘색으로 바래게 한다.
     안개 색을 배경과 똑같이 맞춰야 먼 것이 "흐려지는" 게 아니라
     "공기에 녹아드는" 것으로 보인다. 회색 안개를 쓰면 그냥 뿌옇기만 하다. */
  const SKY = 0xbfe0ea;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 12, 38);

  /* 중성 주변광을 충분히 둬 흰 음식과 그릇의 암부가 회색으로 죽지 않게 한다.
     방향광은 형태를 읽을 정도만 남겨 로우폴리 면이 과하게 번쩍이지 않게 한다. */
  scene.add(new THREE.AmbientLight(0xffffff, 0.90));

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

  const floorModel = asset('room/floor', () => null);
  if (floorModel) {
    floorModel.position.set(0, -.05, -1);
    scene.add(floorModel);
  } else {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), mat(0xdce8ee));
    floor.rotation.x = -Math.PI / 2; floor.position.z = -1; scene.add(floor);
  }

  const ceilingModel = asset('room/ceiling', () => null);
  if (ceilingModel) {
    ceilingModel.position.set(0, 3.45, -1);
    scene.add(ceilingModel);
  } else {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), mat(0xf8f6f0));
    ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, 3.4, -1); scene.add(ceiling);
  }

  const roomWalls = [
    ['room/wall-back',  0, 1.7,   9, 16, 0, 9, Math.PI, 0xf2e2c4],
    ['room/wall-front', 0, 1.7, -11, 16, 0,-11, 0,       0xf6ead0],
    ['room/wall-left', -8, 1.7,  -1, 20,-8, -1, Math.PI/2, 0xcbe6da],
    ['room/wall-right', 8, 1.7,  -1, 20, 8, -1,-Math.PI/2, 0xe9d9c8]
  ];
  for (const [name,x,y,z,w,fx,fz,ry,color] of roomWalls) {
    const model = asset(name, () => null);
    if (model) {
      model.position.set(x,y,z);
      scene.add(model);
    } else {
      const fallback = new THREE.Mesh(new THREE.PlaneGeometry(w,3.4), mat(color));
      fallback.position.set(fx,1.7,fz); fallback.rotation.y=ry; scene.add(fallback);
    }
  }

  addSolid(0, 9.4, 18, 0.8);
  addSolid(0, -11.4, 18, 0.8);
  addSolid(-8.4, -1, 0.8, 22);
  addSolid(8.4, -1, 0.8, 22);

  /* 천장 형광등 — 예전엔 천장이 통짜 흰 판이라 실내로 안 읽혔다.
     빛을 실제로 쏘지는 않는다(방향광 두 개로 충분하다). 형태만 준다. */
  for (let i = 0; i < 3; i++) {
    for (const lx of [-3.6, 3.6]) {
      const lz = -7.4 + i * 6.2;
      box(1.5, 0.10, 0.44, 0xe4e6e2, lx, 3.33, lz);                   // 등 몸체
      const tube = box(1.34, 0.05, 0.30, 0xfffdf2, lx, 3.26, lz);     // 발광면
      ownMat(tube).material.emissive = new THREE.Color(0xfff6d8);
      tube.userData.noTint = true;
    }
  }

  /* 환풍 덕트 — 가스렌지 위 */
  box(1.5, 0.34, 6.4, 0xc9ccc8, 6.9, 3.1, -1.2);
  box(1.62, 0.10, 6.5, 0xa8ada9, 6.9, 2.90, -1.2);
  for (let i = 0; i < 6; i++) box(1.3, 0.03, 0.06, 0x8f948f, 6.9, 2.84, -3.9 + i * 1.1);

  const sign = box(4.6, 1.5, 0.1, 0x2c2620, 0, 2.4, 8.9);
  box(4.3, 1.25, 0.02, 0x3a332b, 0, 0, -0.07, sign);
  wallLabel('🍣 김밥지옥', 0.44, 0, 0.36, -0.09, Math.PI, '#f5b942', sign);
  wallLabel('한 줄 한 줄 정성껏', 0.24, 0, -0.14, -0.09, Math.PI, '#e8e0d2', sign);

  const door = box(1.9, 2.3, 0.12, 0x6c93a8, DOOR.x, 1.15, -10.94);
  box(1.5, 1.5, 0.04, 0xd7ecf5, 0, 0.28, 0.07, door);
  box(0.07, 0.34, 0.05, 0xd8dde1, 0.62, -0.15, 0.09, door);           // 문 손잡이
  wallLabel('🚪 출입문', 0.26, DOOR.x, 2.65, -10.8, 0, '#cfe9f5');

  /* 벽시계 — 손님 쪽 벽이 넓게 비어 있다 */
  const clock = cyl(0.30, 0.06, 0xf4f1ea, 3.4, 2.55, -10.88, scene, 18);
  clock.rotation.x = Math.PI / 2;
  cyl(0.255, 0.075, 0x2f2b26, 0, 0, 0, clock, 18);
  box(0.028, 0.09, 0.17, 0xe8e4da, 0, 0.01, -0.075, clock);
  box(0.13, 0.09, 0.028, 0xe8e4da, 0.055, 0.01, 0, clock);

  // 공정 안내판 (오른쪽 벽) — 벽을 향한 고정 평면이라 각도가 틀어져도 안 잘린다
  box(0.08, 2.1, 3.6, 0x2c2620, 7.92, 2.05, 5.2);
  wallLabel('📋 김밥 만드는 순서', 0.28, 7.86, 2.86, 5.2, -Math.PI / 2, '#ffd88a');
  [
    '① 쌀 씻기 → 밥솥 취사 ' + TIME.riceCook + '초',
    '② 시금치 데치기 ' + TIME.blanchSpinach + '초 (냄비)',
    '③ 햄·계란·당근·어묵 볶기 (팬)',
    '④ 단무지·오이 썰기 ' + TIME.cutDanmuji + '초 (도마)',
    '⑤ 김 → 밥 → 속재료 → 말기 ' + TIME.roll + '초',
    '⑥ 도마에서 썰고 손님에게!'
  ].forEach((line, i) => {
    wallLabel(line, 0.21, 7.86, 2.48 - i * 0.30, 5.2, -Math.PI / 2, '#f3ead9');
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
function counterTop(x, z, w, d, color) {
  /* 도마대·조립대·서빙대는 각각 KitchenTable 한 개를 전체 길이에 맞춰 쓴다.
     같은 테이블을 여러 개 붙였을 때 생기던 상판 이음매와 과한 다리를 없앤다. */
  const table = asset('station/table', () => null);
  if (table) {
    table.scale.set(w / 1.00, 1.04 / 0.67, d / 1.50);
    table.position.set(x, 0, z);
    scene.add(table);
  } else {
    counterBody(x, z, w, d, color, scene);
  }
  addSolid(x, z, w, d);
}

/** 자연 크기의 가구를 긴 방향으로 반복해 지정한 받침대 영역을 채운다. */
function tiledStation(name, natural, x, z, w, d, height, parent) {
  const first = asset(name, () => null);
  if (!first) return false;

  const alongX = w >= d;
  const span = alongX ? w : d;
  const nativeSpan = alongX ? natural[0] : natural[2];
  const count = Math.max(1, Math.round(span / nativeSpan));
  const segment = span / count;

  for (let i = 0; i < count; i++) {
    const model = i === 0 ? first : asset(name, () => null);
    model.scale.set(
      (alongX ? segment : w) / natural[0],
      height / natural[1],
      (alongX ? d : segment) / natural[2]
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
function counterBody(x, z, w, d, color, parent) {
  const col = color || C.counter;
  const KICK = 0.13;                                                  // 굽도리 높이

  /* 밥솥대와 긴 가스렌지 아래는 Cabinet3을 반복한다. 문짝 한 개를 길게
     늘이지 않아 각 수납장 폭과 손잡이 비율이 유지된다. */
  if (tiledStation('station/cabinet', [0.90, 0.67, 1.00], x, z, w, d, 1.04, parent))
    return;

  /* 같은 받침대 모델을 모든 조리대가 공유하고 몸통 색만 바꾼다.
     파일 하나를 고치면 싱크대·밥솥대·렌지대·도마대·조립대·서빙대가 함께 바뀐다. */
  const base = asset('station/counter', () => null);
  if (base) {
    base.position.set(x, 0, z);
    base.scale.set(w, 1, d);
    ownMat(base).traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.color) return;
      if (o.name === 'tint_body') o.material.color.setHex(col);
      else if (o.name === 'tint_kick') o.material.color.set(new THREE.Color(col).multiplyScalar(.42));
      else if (o.name === 'tint_trim') o.material.color.set(new THREE.Color(col).multiplyScalar(.70));
    });
    parent.add(base);
  } else {
    box(w - 0.15, KICK, d - 0.15, 0x4c4740, x, KICK / 2, z, parent);          // 굽도리
    box(w, 0.95 - KICK, d, col, x, KICK + (0.95 - KICK) / 2, z, parent);      // 몸통
    box(w + 0.07, 0.024, d + 0.07, 0x9a938a, x, 0.945, z, parent);            // 상판 밑 선
    box(w + 0.06, 0.09, d + 0.06, C.counterTop, x, 0.99, z, parent);          // 상판
  }

  /* 문짝 — 긴 면을 몇 칸으로 나눈다 */
  const alongX = w >= d;
  const span = alongX ? w : d;
  const n = Math.max(1, Math.round(span / 1.6));
  const seam = new THREE.Color(col).multiplyScalar(0.70).getHex();
  const grip = new THREE.Color(col).multiplyScalar(1.20).getHex();
  const off = (alongX ? d : w) / 2 + 0.008;

  for (const s of [-1, 1]) {
    for (let i = 1; i < n; i++) {                                     // 칸 사이 이음매
      const t = -span / 2 + (span / n) * i;
      if (alongX) box(0.022, 0.70, 0.012, seam, x + t, 0.55, z + s * off, parent);
      else        box(0.012, 0.70, 0.022, seam, x + s * off, 0.55, z + t, parent);
    }
    for (let i = 0; i < n; i++) {                                     // 손잡이
      const t = -span / 2 + (span / n) * (i + 0.5);
      const len = (span / n) * 0.40;
      if (alongX) box(len, 0.036, 0.028, grip, x + t, 0.80, z + s * off, parent);
      else        box(0.028, 0.036, len, grip, x + s * off, 0.80, z + t, parent);
    }
  }
}

/* ──────────────── 🧊 냉장고 (2단 · 10칸) ────────────────
   칸마다 진짜로 파인 홈을 만든다. 예전엔 평평한 앞판에 얇은 받침만 대고
   재료를 얹었더니 벽과 재료가 같은 밝기라, 어느 칸에 뭐가 있는지 구분이
   안 됐다. 뒤를 어둡게 깔고 칸막이·선반으로 격자를 세워 칸을 따로 떼어
   보이게 하고, 이름표는 칸 아래 선반 앞면에 붙인다 (진열대 가격표처럼). */
function buildFridge() {
  const X = -7.05, Z = -3.1;

  const DEPTH = 0.55;                    // 홈이 파인 깊이 (재료가 앞으로 안 튀어나올 만큼)
  const CUB_H = 0.80;                    // 홈 높이
  const BOARD = 0.12;                    // 선반 두께
  const WALL  = 0.09;                    // 칸막이 두께
  const front = X + 0.575;               // 냉장고 앞면
  const back  = front - DEPTH;           // 홈 안쪽 끝
  const inX   = (front + back) / 2;      // 홈 한가운데

  /* 재료는 각 칸 바닥에 얹힌다 */
  const rows = [
    { ids: FRIDGE_ROW_A, floorY: 1.02 },
    { ids: FRIDGE_ROW_B, floorY: 1.94 }
  ];
  const topY = rows[1].floorY + CUB_H;   // 홈 위끝
  const H    = topY + 0.16;              // 몸통 높이

  /* 몸통 — 모델이 있으면 통째로 대신한다.
     칸에 놓는 재료·조준 상자·이름표는 언제나 코드가 맡는다. */
  const shell = asset('station/fridge', () => {
    const g = new THREE.Group();
    const backW = 1.15 - DEPTH;
    box(backW, H, 5.9, C.fridge, back - backW / 2 - X, H / 2, 0, g);            // 뒤판
    box(1.15, rows[0].floorY, 5.9, C.fridge, 0, rows[0].floorY / 2, 0, g);      // 아래 몸통
    box(1.15, H - topY, 5.9, C.fridge, 0, (H + topY) / 2, 0, g);                // 윗단
    box(DEPTH, BOARD, 5.9, C.fridgeEdge, inX - X, rows[1].floorY - BOARD / 2, 0, g);  // 선반
    for (let i = 0; i <= 5; i++)                                                // 세로 칸막이
      box(DEPTH, topY - rows[0].floorY, WALL, C.fridgeEdge,
        inX - X, (topY + rows[0].floorY) / 2, -2.875 + i * 1.15, g);
    rows.forEach((r) => r.ids.forEach((id, i) => {                              // 홈 안쪽 벽
      box(0.03, CUB_H, 1.15 - WALL, C.fridgeIn, back + 0.02 - X, r.floorY + CUB_H / 2, -2.3 + i * 1.15, g);
    }));
    return g;
  });
  shell.position.set(X, 0, Z);
  scene.add(shell);
  addSolid(X, Z, 1.15, 5.9);

  rows.forEach((r) => r.ids.forEach((id, i) => {
    const z = Z - 2.3 + i * 1.15;
    const y = r.floorY + 0.12;
    const def = ITEMS[id];

    const sample = makeItemMesh({ id, stage: 'raw' });
    sample.position.set(inX + 0.03, y, z);
    sample.rotation.y = Math.PI / 2;   // 긴 쪽을 칸 면에 나란히 — 앞으로 찌르지 않게
    sample.scale.setScalar(1.45);
    scene.add(sample);
    hitProxy(X + 0.55, y + 0.1, z, 0.9, 0.82, 1.1, { kind: 'fridge', item: id });

    const p = wallLabel(def.emoji + ' ' + def.name, 0.17,
      front + 0.05, r.floorY - BOARD / 2 - 0.01, z, Math.PI / 2, '#fff');
    D.fridge.push({ id, sample, label: p });
  }));

  wallLabel('🧊 냉장고', 0.30, front + 0.05, H + 0.22, Z, Math.PI / 2, '#a8e6ff');
}

/* 해금 안 된 재료는 흐릿하게 */
function syncFridge() {
  const open = unlockedFills();
  for (const f of D.fridge) {
    const def = ITEMS[f.id];
    const locked = !!def.fill && !open.includes(f.id);
    if (f.locked === locked) continue;
    f.locked = locked;
    f.sample.visible = !locked;
    f.label.text(locked ? '🔒 ' + def.name : def.emoji + ' ' + def.name,
      { color: locked ? '#7d8b93' : '#fff' });
  }
}

/* ──────────────── 🚰 싱크대 ──────────────── */
function buildSink() {
  const X = -6.7, Z = 1.1;
  const BW = 0.92, BD = 1.36, WALL2 = 0.055, LIP = 0.20;
  const bx = 0.05;                       // 개수대 한가운데 (조리대 기준 국소좌표)

  /* 껍데기 — 몸통·개수대·수도꼭지. 국소좌표로 짓고 그룹을 통째로 옮긴다.
     그래야 모델로 갈아끼울 때 원점 규격(바닥 한가운데)이 그대로 맞는다. */
  const shell = asset('station/sink', () => {
    const g = new THREE.Group();
    counterBody(0, 0, 1.3, 2.1, 0x8fb4c4, g);   // 싱크대 — 청록 스틸

    /* 개수대 — 속 상자를 겹쳐 놓으면 아무리 어둡게 해도 뚜껑처럼 보인다.
       상자가 서로 뚫고 지나갈 뿐이라 안이 안 비기 때문이다.
       벽 네 장과 바닥으로 실제로 빈 통을 짓는다. */
    const rim = 0xbcc3c9, deep = 0x646d75;
    box(WALL2, LIP, BD, rim, bx - BW / 2, 1.14, 0, g);                 // 왼벽
    box(WALL2, LIP, BD, rim, bx + BW / 2, 1.14, 0, g);                 // 오른벽
    box(BW + WALL2, LIP, WALL2, rim, bx, 1.14, -BD / 2, g);            // 앞벽
    box(BW + WALL2, LIP, WALL2, rim, bx, 1.14, BD / 2, g);             // 뒷벽
    box(BW, 0.03, BD, deep, bx, 1.055, 0, g);                          // 바닥 (어둡게)
    cyl(0.075, 0.016, 0x49515a, bx, 1.072, 0, g, 12);                  // 배수구

    /* 수도꼭지 — 기둥·굽은 목·주둥이·손잡이 두 개로 나눠야 수도로 읽힌다 */
    cyl(0.052, 0.30, C.steel, -0.44, 1.19, 0, g, 12);                  // 기둥 밑동
    cyl(0.042, 0.30, C.steel, -0.44, 1.46, 0, g, 12);                  // 목
    const neck = cyl(0.038, 0.30, C.steel, -0.30, 1.60, 0, g, 12);
    neck.rotation.z = Math.PI / 2;                                     // 앞으로 꺾인 목
    cyl(0.032, 0.10, C.steel, -0.16, 1.55, 0, g, 10);                  // 아래로 떨어지는 주둥이
    for (const s2 of [-1, 1]) {                                        // 냉·온수 손잡이
      const h = cyl(0.026, 0.13, 0xd8dde1, -0.44, 1.30, s2 * 0.15, g, 8);
      h.rotation.x = Math.PI / 2;
      cyl(0.045, 0.02, s2 < 0 ? 0x4f8fd0 : 0xd06060, -0.44, 1.30, s2 * 0.21, g, 10).rotation.x = Math.PI / 2;
    }
    return g;
  });
  shell.position.set(X, 0, Z);
  scene.add(shell);
  addSolid(X, Z, 1.3, 2.1);

  /* 물줄기 — 모델이 water 노드를 들고 있으면 그걸 쓴다 */
  const fromModel = partOf(shell, 'water');
  const water = fromModel || ownMat(cyl(0.035, 0.42, C.water, X - 0.02, 1.26, Z, scene, 8));
  if (!fromModel) { water.material.transparent = true; water.material.opacity = 0.55; }
  water.visible = false;

  hitProxy(X + 0.4, 1.4, Z, 1.1, 1.0, 1.6, { kind: 'sink' });

  const panel = new Panel(256, 96, 0.8);
  panel.sprite.position.set(X + 0.25, 1.85, Z);
  panel.sprite.visible = false;
  scene.add(panel.sprite);

  labelSprite('🚰 싱크대 — 쌀 씻기', 1.45, 0, scene, '#9fd8ff').sprite.position.set(X + 0.3, 2.2, Z);
  // 씻는 쌀은 개수대 한가운데 놓는다 (예전엔 왼쪽 벽 메시 위치를 썼다)
  D.sink = { basinX: X + bx, basinZ: Z, water, panel, riceMesh: null };
}

/* ──────────────── 🍚 밥솥 ×2 ──────────────── */
function buildCookers() {
  const X = -6.7;
  for (let i = 0; i < COOKER_COUNT; i++) {
    const Z = 4.0 + i * 2.4;
    const shell = asset('station/cooker', () => {
      const g = new THREE.Group();
      counterBody(0, 0, 1.3, 2.1, 0xe0cfa8, g);   // 밥솥 — 크림
      const body = cyl(0.36, 0.44, 0xf0eee9, 0.05, 1.24, 0, g, 20);
      const lid = cyl(0.37, 0.12, 0xdcd8d0, 0, 0.27, 0, body, 20);
      lid.name = 'lid';
      cyl(0.375, 0.022, 0xb8b3ab, 0, 0.20, 0, body, 20);                   // 뚜껑 이음매
      cyl(0.07, 0.06, C.steelDark, 0, 0.08, 0, lid, 10);
      const face = box(0.22, 0.16, 0.02, 0x2b2f33, 0, 0.02, 0.36, body);
      box(0.18, 0.1, 0.01, 0x5ad07a, 0, 0, 0.02, face);
      cyl(0.05, 0.045, 0xc8c3ba, 0, 0.12, 0, lid, 10);            // 김 빠지는 구멍
      for (const s3 of [-1, 1]) {                                  // 양쪽 손잡이
        const hh = box(0.07, 0.05, 0.16, 0xd8d3ca, s3 * 0.39, 0.02, 0, body);
        hh.userData.noTint = true;
      }
      box(0.20, 0.035, 0.02, 0x9aa0a6, 0, -0.10, 0.36, body);      // 버튼 줄
      return g;
    });
    shell.position.set(X, 0, Z);
    scene.add(shell);
    addSolid(X, Z, 1.3, 2.1);

    /* 뚜껑 — 취사 중에 들썩인다. 모델이 lid 노드를 들고 있으면 그걸 쓴다 */
    const lid = partOf(shell, 'lid');

    const steam = [];
    for (let s = 0; s < 5; s++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      m.position.set(X + 0.05, 1.6, Z);
      m.visible = false;
      scene.add(m);
      steam.push({ mesh: m, t: s / 5 });
    }

    hitProxy(X + 0.35, 1.45, Z, 1.2, 1.2, 1.4, { kind: 'cooker', cooker: i });

    const panel = new Panel(256, 96, 0.85);
    panel.sprite.position.set(X + 0.05, 1.92, Z);
    panel.sprite.visible = false;
    scene.add(panel.sprite);

    labelSprite('🍚 밥솥 ' + (i + 1), 1.3, 0, scene, '#ffd88a').sprite.position.set(X + 0.3, 2.3, Z);
    D.cookers.push({ lid, panel, steam, x: X + 0.05, z: Z });
  }
}

/* ──────────────── 🔥 가스렌지 5구 ──────────────── */
function buildStove() {
  const X = 6.7, Z = -1.2;
  /* 껍데기 — 몸통·조리면·화구 오덕·조절 손잡이.
     불꽃과 냄비·팬은 상태에 따라 변하므로 아래에서 따로 만든다. */
  const shell = asset('station/stove', () => {
    const g = new THREE.Group();
    counterBody(0, 0, 1.3, 6.8, 0x3a3734, g);   // 가스렌지 — 짙은 차콜
    box(1.16, 0.06, 6.6, 0x33302c, 0, 1.02, 0, g);
    BURNERS.forEach((b, i) => {
      const z = -3.8 + i * 1.3 - Z;
      const grate = new THREE.Group();
      grate.position.set(-0.05, 1.08, z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.026, 6, 16), mat(0x24211e));
      ring.rotation.x = Math.PI / 2;
      grate.add(ring);
      for (let k = 0; k < 4; k++) {
        const bar = box(0.44, 0.022, 0.045, 0x2b2724, 0, 0, 0, grate);
        bar.rotation.y = k * Math.PI / 4;
      }
      cyl(0.105, 0.05, 0x3a3531, 0, -0.02, 0, grate, 12);      // 버너캡 받침
      cyl(0.075, 0.035, 0x1e1b19, 0, 0.015, 0, grate, 12);     // 버너캡
      g.add(grate);
      /* 조절 손잡이 — 상판이 앞으로 나오므로 그보다 앞, 문짝 손잡이보다 위 */
      const knob = cyl(0.062, 0.055, 0x2b2724, -0.68, 0.88, z, g, 12);
      knob.rotation.z = Math.PI / 2;
      cyl(0.042, 0.015, 0x4a443f, -0.71, 0.88, z, g, 10).rotation.z = Math.PI / 2;
      box(0.016, 0.010, 0.052, 0xe4ded2, -0.72, 0.88, z + 0.028, g);
    });
    return g;
  });
  shell.position.set(X, 0, Z);
  scene.add(shell);
  addSolid(X, Z, 1.3, 6.8);

  BURNERS.forEach((b, i) => {
    const z = -3.8 + i * 1.3;

    const flame = ownMat(cyl(0.16, 0.14, C.fire, X - 0.05, 1.09, z, scene, 12, 0.04));
    flame.material.transparent = true; flame.material.opacity = 0.85;
    flame.visible = false;
    // 속의 파란 심지 — 겉불꽃만 있으면 주황 원뿔로만 보인다
    const core = ownMat(cyl(0.085, 0.075, 0x6bb8f0, 0, -0.03, 0, flame, 10, 0.02));
    core.material.transparent = true; core.material.opacity = 0.75;
    core.userData.noTint = true;

    const vessel = asset('station/' + b.kind, () => {
      const v = new THREE.Group();
      if (b.kind === 'pot') {
        cyl(0.27, 0.26, C.steel, 0, 0.13, 0, v, 20);
        cyl(0.245, 0.24, 0x9aa2a8, 0, 0.14, 0, v, 20);
        box(0.08, 0.04, 0.1, C.steelDark, 0.3, 0.2, 0, v).userData.noTint = true;
        box(0.08, 0.04, 0.1, C.steelDark, -0.3, 0.2, 0, v).userData.noTint = true;
        const w = ownMat(cyl(0.235, 0.02, C.water, 0, 0.2, 0, v, 20));
        w.material.transparent = true; w.material.opacity = 0.6;
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
    vessel.position.set(X - 0.05, 1.14, z);
    // 끓는 물 — 코드로 만들었든 모델에서 왔든 water 라는 이름으로 찾는다
    vessel.userData.water = partOf(vessel, 'water');
    scene.add(vessel);

    hitProxy(X - 0.15, 1.45, z, 1.1, 1.0, 1.24, { kind: 'burner', slot: i });

    const panel = new Panel(256, 96, 0.68);
    panel.sprite.position.set(X - 0.05, 1.78, z);
    panel.sprite.visible = false;
    scene.add(panel.sprite);

    labelSprite((b.kind === 'pot' ? '🥬 ' : '🍳 ') + b.label, 0.8, 0, scene, '#ffc9a0')
      .sprite.position.set(X - 0.05, 1.52, z);

    D.burners.push({ vessel, flame, panel, mesh: null, key: null, kind: b.kind });
  });

  labelSprite('🔥 가스렌지', 1.5, 0, scene, '#ff9c5b').sprite.position.set(X - 0.2, 2.5, Z);
  labelSprite('냄비=데치기 · 팬=볶기/지단', 1.5, 0, scene, '#f0c9a0').sprite.position.set(X - 0.2, 2.2, Z);
}

/* ──────────────── 🔪 도마 ×3 ──────────────── */
function buildBoards() {
  const Z = -1.2;
  counterTop(0, Z, 4.4, 1.7, 0xc07d3a);   // 도마 — 진한 나무

  for (let i = 0; i < BOARD_COUNT; i++) {
    const x = -1.4 + i * 1.4;
    const bm = asset('station/board', () => null);
    if (bm) bm.position.set(x, 1.06, Z), scene.add(bm);
    if (!bm) {
    box(1.05, 0.07, 0.85, C.wood, x, 1.06, Z);
    box(1.0, 0.01, 0.8, 0xe2bc84, x, 1.1, Z);
    for (let g2 = 0; g2 < 4; g2++)                                 // 나무결
      box(0.96, 0.004, 0.012, 0xd0a870, x, 1.107, Z - 0.30 + g2 * 0.20, scene);
    cyl(0.035, 0.012, 0xbf9a63, x - 0.44, 1.107, Z - 0.34, scene, 8);  // 걸이 구멍
    }

    /* 칼 — 예전엔 납작한 막대 두 개였다. 날·등·슴베·손잡이로 나눈다 */
    const knifeFromModel = bm ? partOf(bm, 'knife') : null;
    const knifeAsset = knifeFromModel ? null : asset('item/knife', () => null);
    const knife = knifeFromModel || knifeAsset || new THREE.Group();
    if (!knifeFromModel && !knifeAsset) {
    box(0.055, 0.016, 0.40, 0xdfe4e8, 0, 0, 0, knife);             // 날
    box(0.055, 0.022, 0.10, 0xc9ced3, 0, 0.006, -0.16, knife);     // 날 끝 쪽 두께
    box(0.022, 0.030, 0.42, 0xb9bec4, 0, 0.016, 0.01, knife);      // 칼등
    box(0.03, 0.03, 0.05, 0x8d949a, 0, 0.006, 0.22, knife);        // 슴베
    box(0.05, 0.045, 0.16, 0x2f2a25, 0, 0, 0.29, knife);           // 손잡이
    box(0.054, 0.012, 0.16, 0x1f1b17, 0, 0.024, 0.29, knife);      // 손잡이 등
    }
    knife.position.set(x + 0.42, 1.14, Z);
    if (!knifeFromModel) scene.add(knife);

    hitProxy(x, 1.45, Z, 1.3, 1.0, 1.5, { kind: 'board', board: i });

    const panel = new Panel(256, 96, 0.7);
    panel.sprite.position.set(x, 1.72, Z);
    panel.sprite.visible = false;
    scene.add(panel.sprite);

    D.boards.push({ knife, panel, mesh: null, key: null, x, z: Z, knifeHome: knife.position.clone() });
  }
  labelSprite('🔪 도마 3대', 1.4, 0, scene, '#ffe6b0').sprite.position.set(0, 1.98, Z);
}

/* ──────────────── 🍙 조립대 ×3 ──────────────── */
function buildMats() {
  const Z = 2.6;
  counterTop(0, Z, 5.2, 1.7, 0xd99a4e);   // 조립대 — 밝은 나무

  for (let i = 0; i < MAT_COUNT; i++) {
    const X = -1.6 + i * 1.6;

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
    group.rotation.y = Math.PI / 2;
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

    hitProxy(X, 1.5, Z, 1.5, 1.1, 1.5, { kind: 'mat', mat: i });

    const panel = new Panel(256, 96, 0.9);
    panel.sprite.position.set(X, 1.75, Z);
    panel.sprite.visible = false;
    scene.add(panel.sprite);

    labelSprite('🍙 조립대 ' + (i + 1), 1.0, 0, scene, '#ffe08a').sprite.position.set(X, 2.02, Z);

    D.mats.push({ group, gim, bap, fillGroup, roll, panel, x: X, z: Z, fillKey: null });
  }
}

/* ──────────────── 🗑️ 음쓰통 · 🧹 빗자루 ──────────────── */
function buildBin() {
  const X = 5.6, Z = 5.6;
  const model = asset('station/bin', () => null);
  if (model) { model.position.set(X, 0, Z); scene.add(model); }
  if (!model) {
  cyl(0.42, 0.9, 0x3f7a4a, X, 0.45, Z, scene, 16, 0.36);          // 아래로 좁아지는 몸통
  cyl(0.435, 0.05, 0x356b41, X, 0.62, Z, scene, 16);              // 몸통 띠
  cyl(0.45, 0.08, 0x2f5c38, X, 0.94, Z, scene, 16);               // 뚜껑
  cyl(0.2, 0.06, 0x24472b, X, 0.99, Z, scene, 12);                // 뚜껑 손잡이
  box(0.30, 0.05, 0.16, 0x4a4f55, X - 0.34, 0.09, Z, scene);      // 발판
  cyl(0.022, 0.85, 0x6b7178, X - 0.44, 0.5, Z, scene, 6);         // 발판 연결대
  }
  // 충돌·상호작용·이름표는 모델을 넣어도 언제나 코드가 맡는다
  addSolid(X, Z, 0.9, 0.9);
  hitProxy(X, 1.1, Z, 1.1, 1.5, 1.1, { kind: 'bin' });
  labelSprite('🗑️ 음쓰통', 1.25, 0, scene, '#a8e0b0').sprite.position.set(X, 1.5, Z);
}

function buildBrooms() {
  for (let i = 0; i < BROOM_COUNT && i < BROOM_SPOTS.length; i++) {
    const s = BROOM_SPOTS[i];
    cyl(0.16, 0.1, 0x6b6660, s.x, 0.05, s.z, scene, 12).userData.noTint = true;
    const broom = makeItemMesh({ id: 'broom', stage: 'done' });
    broom.position.set(s.x, 0.78, s.z);
    broom.rotation.set(0.22, s.ry, 0.12);
    scene.add(broom);
    hitProxy(s.x, 1.0, s.z, 0.9, 1.9, 0.9, { kind: 'broom', rack: i });
    const label = labelSprite('🧹 빗자루', 1.1, 0, scene, '#ffe08a');
    label.sprite.position.set(s.x, 1.75, s.z);
    D.brooms.push({ mesh: broom, label });
  }
}

/* ──────────────── 🛎️ 카운터 + 🖥️ 키오스크 ──────────────── */
function buildServe() {
  counterTop(0, SERVE_Z, 7.0, 0.9, 0xe08434);  // 서빙 — 가장 강한 주황

  for (const side of [-1, 1]) {
    const x = side * 5.55;
    box(4.1, 1.55, 0.5, 0xcf9a58, x, 0.78, SERVE_Z);
    box(4.16, 0.08, 0.58, C.counterTop, x, 1.57, SERVE_Z);
    addSolid(x, SERVE_Z, 4.1, 0.5);
  }

  box(1.4, 0.06, 0.7, 0xf0ece2, 1.8, 1.05, SERVE_Z);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe8c14a));
  bell.position.set(1.15, 1.06, SERVE_Z);
  scene.add(bell);

  hitProxy(1.8, 1.45, SERVE_Z - 0.1, 1.8, 1.1, 0.9, { kind: 'serve' });
  labelSprite('🛎️ 서빙 창구', 1.5, 0, scene, '#ffd27a').sprite.position.set(1.8, 1.68, SERVE_Z);

  for (let i = 0; i < QUEUE_SLOTS; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.4, 20),
      new THREE.MeshBasicMaterial({ color: 0xe0728f, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(slotX(i), 0.02, QUEUE_Z);
    scene.add(ring);
  }

  // 🖥️ 키오스크 — 일반 손님 주문이 들어오는 곳
  const k = asset('station/kiosk', () => {
  const k = new THREE.Group();
  box(0.7, 1.25, 0.45, 0x2f3338, 0, 0.62, 0, k);
  const screen = box(0.62, 0.72, 0.06, 0x1b7fa8, 0, 1.42, 0.06, k);
  screen.rotation.x = -0.24;
  box(0.54, 0.6, 0.02, 0x63d0f0, 0, 0, 0.05, screen);
  box(0.8, 0.06, 0.55, 0x3c4247, 0, 1.02, 0, k);
  return k;
  });
  k.position.set(KIOSK.x, 0, KIOSK.z);
  scene.add(k);
  addSolid(KIOSK.x, KIOSK.z, 0.8, 0.6);
  hitProxy(KIOSK.x, 1.3, KIOSK.z, 1.0, 1.8, 0.9, { kind: 'kiosk' });
  labelSprite('🖥️ 키오스크', 1.4, 0, scene, '#9fe8ff').sprite.position.set(KIOSK.x, 2.25, KIOSK.z);
  labelSprite('일반 주문은 여기로', 1.5, 0, scene, '#8fb9c9').sprite.position.set(KIOSK.x, 2.0, KIOSK.z);

  const menu = box(3.0, 1.05, 0.08, 0x2f2b26, -2.6, 2.0, -10.9);
  box(2.8, 0.9, 0.02, 0x3d3830, 0, 0, -0.06, menu);
  wallLabel('김밥 3,000원', 0.30, 0, 0.20, 0.08, 0, '#f5b942', menu);
  wallLabel('주문은 키오스크에서', 0.22, 0, -0.20, 0.08, 0, '#e8e0d2', menu);
}

/* ────────────────────────────────────────────────────────────
   손에 든 것 (1인칭)
   ──────────────────────────────────────────────────────────── */
function updateHand() {
  const h = myHand();
  const key = h ? h.uid + h.stage : 'none';
  if (D.handKey === key) return;
  D.handKey = key;

  if (D.hand) { camera.remove(D.hand); disposeObject(D.hand); D.hand = null; }
  if (!h) return;

  const g = makeItemMesh(h);
  if (h.id === 'broom') {
    g.position.set(0.54, -0.40, -0.9);
    g.rotation.set(-0.12, 0.18, Math.PI - 0.5);
    g.scale.setScalar(0.8);
  } else {
    g.position.set(0.50, -0.37, -0.97);
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
function buildArm() {
  const arm = new THREE.Group();
  box(0.13, 0.13, 0.13, 0xf6d3a8, 0, 0, 0, arm);            // 주먹
  box(0.135, 0.035, 0.135, 0xe3b489, 0, -0.055, 0, arm);    // 손등 그림자
  box(0.115, 0.22, 0.115, 0xf6d3a8, 0, -0.18, 0.01, arm);   // 팔뚝
  box(0.14, 0.035, 0.14, 0xd9dee3, 0, -0.29, 0.02, arm);    // 소매 끝단
  box(0.135, 0.20, 0.135, 0xf7f9fb, 0, -0.40, 0.02, arm);   // 위생복 소매

  // 소매(로컬 -y)가 화면 우하단, 주먹(원점)이 좌상향으로 오게 z 를 +로 튼다
  arm.position.set(0.9, -0.46, -0.92);
  arm.rotation.set(-0.20, -0.16, 0.52);
  camera.add(arm);
  D.arm = arm;
  D.armBase = { pos: arm.position.clone(), rot: arm.rotation.clone() };
}

/** 걸을 때 팔이 같이 흔들린다 — player.js 가 매 프레임 알려준다 */
let armBob = 0;
export function setArmBob(speed, dt) {
  D.armSpeed = speed;
  armBob += dt * (speed > 0.1 ? (speed > 5 ? 13 : 8.5) : 1.5);
}

let swingT = 0;
let handBumpAt = -10000;
export function bumpHand() { handBumpAt = performance.now(); }

function animateArm(swinging) {
  const a = D.arm, base = D.armBase;
  if (!a || !base) return;

  const amp = (D.armSpeed || 0) > 0.1 ? 0.05 : 0.012;
  a.position.x = base.pos.x + Math.sin(armBob) * amp * 0.6;
  a.position.y = base.pos.y + Math.abs(Math.cos(armBob)) * amp - amp * 0.5;
  a.rotation.z = base.rot.z + Math.sin(armBob) * amp * 0.8;

  // 빗자루를 휘두르면 팔도 같이 내려친다
  if (swinging && swingT > 0) {
    const p = swingT < 0.35
      ? Math.pow(swingT / 0.35, 0.6)
      : 1 - Math.pow((swingT - 0.35) / 0.65, 1.4);
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

export function setSwingProgress(t) {
  swingT = t;
  const g = D.hand, base = D.handBase;
  if (!g || !base || t <= 0) return;
  const DOWN = 0.35;
  const p = t < DOWN ? Math.pow(t / DOWN, 0.6) : 1 - Math.pow((t - DOWN) / (1 - DOWN), 1.4);
  g.rotation.z = base.rot.z + p * 3.3;
  g.rotation.x = base.rot.x + p * 0.55;
  g.position.x = base.pos.x - p * 0.55;
  g.position.y = base.pos.y - p * 0.30;
  g.position.z = base.pos.z - p * 0.22;
}

function animateHand(swinging) {
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

/* ────────────────────────────────────────────────────────────
   서버 상태 → 3D
   ──────────────────────────────────────────────────────────── */
function syncSink() {
  const d = D.sink;
  const s = sinkAt();
  if (!s) {
    if (d.riceMesh) d.riceMesh = kill(d.riceMesh);
    d.water.visible = false;
    d.panel.sprite.visible = false;
    return;
  }
  if (!d.riceMesh) {
    d.riceMesh = makeItemMesh({ id: 'rice', stage: 'raw' });
    d.riceMesh.position.set(d.basinX, 1.1, d.basinZ);
    scene.add(d.riceMesh);
  }
  const washing = s.rinses < TIME.riceRinse;
  d.water.visible = washing;
  if (washing) {
    d.water.scale.y = 0.8 + Math.sin(performance.now() / 60) * 0.2;
    d.riceMesh.position.y = 1.1 + Math.sin(performance.now() / 90) * 0.012;
    d.panel.gauge('쌀 씻기', s.rinses / TIME.riceRinse, '#63a8e8', '헹굼 ' + s.rinses + ' / ' + TIME.riceRinse);
  } else {
    d.panel.gauge('다 씻었다', 1, '#58c07a', 'E 로 집기');
  }
  d.panel.sprite.visible = true;
}

function syncCookers() {
  for (let i = 0; i < D.cookers.length; i++) {
    const d = D.cookers[i];
    const c = cookerAt(i);
    if (!c) continue;
    const cooking = c.state === 'cooking';
    const p = cookerProgress(i);

    d.panel.sprite.visible = c.state !== 'empty';
    if (cooking) {
      d.panel.gauge('취사 중', p, '#f5b942', (TIME.riceCook * (1 - p)).toFixed(1) + '초 남음');
      d.lid.position.y = 0.27 + Math.sin(performance.now() / 70) * 0.006;
    } else if (c.state === 'ready') {
      d.panel.gauge('밥 완성', 1, '#58c07a', '남은 밥 ' + c.servings + '인분');
      d.lid.position.y = 0.27;
    }

    d.steam.forEach((s, j) => {
      if (!cooking) { s.mesh.visible = false; return; }
      s.mesh.visible = true;
      s.t += 0.006 + j * 0.0004;
      if (s.t > 1) s.t = 0;
      s.mesh.position.y = 1.6 + s.t * 0.9;
      s.mesh.position.x = d.x + Math.sin(s.t * 6 + j) * 0.12;
      s.mesh.position.z = d.z + Math.cos(s.t * 5 + j) * 0.1;
      s.mesh.material.opacity = 0.45 * (1 - s.t);
      s.mesh.scale.setScalar(0.6 + s.t * 1.1);
    });
  }
}

function syncBurners() {
  for (let i = 0; i < D.burners.length; i++) {
    const d = D.burners[i];
    const info = burnerInfo(i);

    if (!info) {
      if (d.mesh) d.mesh = kill(d.mesh, d.vessel);
      d.key = null;
      d.flame.visible = false;
      d.panel.sprite.visible = false;
      if (d.vessel.userData.water) d.vessel.userData.water.scale.y = 1;
      continue;
    }

    if (d.key !== info.cell.id + info.cell.at) {
      if (d.mesh) kill(d.mesh, d.vessel);
      // 타는 색을 입히려고 재질 색을 직접 바꾼다 — 공유 재질이면 같은 색 설비가 다 탄다
      d.mesh = ownMat(makeItemMesh({ id: info.cell.id, stage: 'raw' }));
      d.mesh.position.set(0, d.kind === 'pot' ? 0.2 : 0.08, 0);
      d.mesh.scale.setScalar(0.8);
      d.vessel.add(d.mesh);
      d.key = info.cell.id + info.cell.at;
    }

    d.flame.visible = true;
    d.flame.scale.y = 0.8 + Math.sin(performance.now() / 55 + i) * 0.25;
    d.flame.material.color.setHex(info.burnt ? 0xff4d2e : C.fire);

    const k = Math.min(1, info.el / info.def.burn);
    d.mesh.traverse((o) => {
      if (o.isMesh && o.material && o.material.color && !o.userData.noTint) {
        if (!o.userData.base) o.userData.base = o.material.color.clone();
        o.material.color.copy(o.userData.base).multiplyScalar(1 - k * 0.68);
      }
    });

    if (d.vessel.userData.water) d.vessel.userData.water.scale.y = 1 + Math.sin(performance.now() / 80 + i) * 0.35;
    if (d.kind === 'pan') d.mesh.position.y = 0.08 + Math.abs(Math.sin(performance.now() / 200 + i)) * 0.02;

    d.panel.sprite.visible = true;
    d.panel.gauge(info.def.name, info.el / info.def.burn, info.color, info.label);
  }
}

function syncBoards() {
  for (let i = 0; i < D.boards.length; i++) {
    const d = D.boards[i];
    const info = boardInfo(i);

    if (!info) {
      if (d.mesh) d.mesh = kill(d.mesh);
      d.key = null;
      d.panel.sprite.visible = false;
      d.knife.position.copy(d.knifeHome);
      d.knife.rotation.set(0, 0, 0);
      continue;
    }

    const wantStage = info.done ? 'done' : 'raw';
    const key = info.b.id + info.b.at + wantStage;
    if (d.key !== key) {
      if (d.mesh) kill(d.mesh);
      d.mesh = makeItemMesh(info.b.id === 'roll'
        ? { id: info.done ? 'gimbap' : 'roll', stage: 'done', fills: info.b.fills }
        : { id: info.b.id, stage: wantStage });
      d.mesh.position.set(d.x, 1.14, d.z);
      scene.add(d.mesh);
      d.key = key;
    }

    if (!info.done) {
      const swing = Math.abs(Math.sin(performance.now() / 110));
      d.knife.position.set(d.x - 0.3 + info.pct * 0.6, 1.14 + swing * 0.18, d.z);
      d.knife.rotation.z = -0.5 - swing * 0.5;
    } else {
      d.knife.position.copy(d.knifeHome);
      d.knife.rotation.set(0, 0, 0);
    }

    d.panel.sprite.visible = true;
    const nm = info.b.id === 'roll' ? '김밥 썰기' : ITEMS[info.b.id].name + ' 썰기';
    d.panel.gauge(nm, info.pct, info.done ? '#58c07a' : '#f5b942',
      info.done ? '다 썰었다 — E' : Math.round(info.pct * 100) + '%');
  }
}

function syncMats() {
  for (let i = 0; i < D.mats.length; i++) {
    const d = D.mats[i];
    const m = matAt(i);
    if (!m) continue;
    const rolling = m.rolling;
    const p = rollProgress(i);

    d.gim.visible = m.gim && !rolling;
    d.bap.visible = m.bap && !rolling;

    const key = m.fills.map((f) => f.id).join(',') + (rolling ? 'R' : '');
    if (d.fillKey !== key) {
      d.fillKey = key;
      while (d.fillGroup.children.length) {
        const c = d.fillGroup.children[0];
        d.fillGroup.remove(c);
        disposeObject(c);
      }
      if (!rolling) {
        /* 재료를 밥 위에 나란히 눕힌다.
           간격을 고정하면 두 문제가 생긴다 — 개수가 적을 때 한쪽으로 쏠리고,
           당근 채 다발(폭 0.08)처럼 넓은 재료끼리는 서로를 덮는다.
           그래서 밥 폭(z 0.4) 안에서 개수에 맞춰 나누고 가운데로 모은다. */
        const n = m.fills.length;
        const gap = n > 1 ? Math.min(0.082, 0.40 / n) : 0;
        m.fills.forEach((f, j) => {
          const g = makeItemMesh({ id: f.id, stage: 'done' });
          g.position.set(0, 0, (j - (n - 1) / 2) * gap);
          g.scale.setScalar(0.72);
          d.fillGroup.add(g);
        });
      }
    }

    if (rolling) {
      d.roll.visible = true;
      d.roll.scale.set(0.35 + p * 0.65, 1, 0.35 + p * 0.65);
      d.roll.rotation.x = -p * Math.PI * 2;
      d.group.rotation.x = -p * 0.5;
    } else {
      d.roll.visible = false;
      d.group.rotation.x = 0;
    }

    const any = m.gim || m.bap || m.fills.length || rolling;
    d.panel.sprite.visible = !!any;
    if (rolling) {
      d.panel.gauge('말고 있다', p, p >= 1 ? '#58c07a' : '#f5b942', p >= 1 ? '완성! — E' : Math.round(p * 100) + '%');
    } else if (any) {
      const names = m.fills.map((f) => ITEMS[f.id].emoji).join('');
      d.panel.gauge('조립 중',
        (Number(m.gim) + Number(m.bap) + Math.min(4, m.fills.length)) / 6, '#63a8e8',
        (m.gim ? '김' : '─') + '·' + (m.bap ? '밥' : '─') + ' ' + (names || '속재료 없음'));
    }
  }
}

function syncBrooms() {
  for (let i = 0; i < D.brooms.length; i++) {
    const taken = broomTaken(i);
    const d = D.brooms[i];
    if (d.mesh.visible === !taken) continue;
    d.mesh.visible = !taken;
    d.label.sprite.visible = !taken;
  }
}

/* ────────────────────────────────────────────────────────────
   🎯 대상 손님 윤곽선
   벤더링한 three 에는 postprocessing 애드온이 없어 OutlinePass 를 못 쓴다.
   대신 역방향 헐 — 몸통·머리를 조금 키워 BackSide 로 그리면
   실루엣 바깥으로 삐져나온 부분만 테두리처럼 남는다.
   이 메시는 내 클라이언트에서만 만들기 때문에 동료 화면에는 보이지 않는다.
   ──────────────────────────────────────────────────────────── */
/* 테두리는 언제나 몸통 "바깥" 이라 배경 위에 얹힌다.
   손님 뒤 배경은 크림색 뒷벽(0xf0e6d2)과 옅은 걸레받이(0xcfe3dc) 뿐이라
   밝은 색을 쓰면 묻힌다 — 하늘색은 대비 1.17:1 로 조리 거리에서 안 보였다.
   짙은 보라는 뒷벽 대비 약 6.4:1 이고, 금색(조준)·분홍(자리 링)·빨강(진상) 과도 겹치지 않는다. */
const OUTLINE_COLOR = 0x5b21d6;
const OUTLINE_PX = 4;                                     // 화면에서 유지할 테두리 두께(px)
const OUTLINE_TAN = Math.tan((72 * Math.PI / 180) / 2);   // 카메라 fov 72 의 절반 탄젠트
const OUTLINE_TIE = 0.4;                                  // 동점자는 이만큼 흐리게

/* ────────────────────────────────────────────────────────────
   사람 — 손님과 동료 아바타가 같은 뼈대를 쓴다

   예전에는 원기둥 하나에 구 하나가 전부라
   걷는지 서 있는지, 화났는지, 누가 진상인지 알 수가 없었다.
   뼈대를 팔·다리 피벗으로 나누고 얼굴을 붙여 그 셋을 다 보이게 한다.

   ⚠ 실루엣은 반지름 0.30 · 높이 0~1.0 안에 들어와야 한다.
     손님 테두리(makeOutline)가 딱 그 크기의 역방향 헐이라
     팔이 그 밖으로 나가면 테두리가 팔만 빼먹고 그려진다.
   ──────────────────────────────────────────────────────────── */

const SKIN = 0xf6d9b0;
const PANTS = 0x3f4550;

/* 코드로 세운 몸은 눈이 y 1.302 에 온다 (얼굴 그룹 1.26 + 눈 0.042).
   플레이어 카메라는 EYE 높이에 있으므로, 그대로 두면 서로 눈높이가 어긋나
   상대를 내려다보게 된다. 몸 전체를 이 배율로 키워 눈을 맞춘다.
   ⚠ 이름표·체력바·말풍선은 같이 커지면 안 된다 — 배율 그룹 바깥에 둔다. */
/**
 * 몸의 기준점 — 머리카락·상의·소품·테두리가 전부 이 표를 보고 자리를 잡는다.
 *
 * PEAK처럼 머리가 크고 무게중심이 낮은 2등신이다. 머리 지름이 전체 키의
 * 40%쯤 되고, 몸과 팔다리는 짧고 묵직하게 이어진다.
 * 얼굴이 화면에서 크게 잡히므로 눈·눈썹만으로도 표정이 멀리서 읽힌다 —
 * 이게 이 비율을 고른 이유다.
 *
 * 예전 몸은 작게 세운 뒤 rig 를 통째로 1.398 배 키워 눈을 EYE 에 맞췄다.
 * 지금은 처음부터 실제 크기로 세운다. 소품 좌표를 그대로 눈으로 읽을 수 있고,
 * 배율이 끼어들지 않아 "여기 붙였는데 왜 저기 있지" 가 없어진다.
 */
const BODY = {
  /* 눈은 EYE(1.82)에 고정이다 — 카메라가 거기 있으니 못 옮긴다.
     그래서 머리를 얼마나 높이 두느냐가 곧 "눈이 얼굴의 어디쯤 오는가" 다.
     머리 중심을 눈보다 살짝 위(1.84)에 두면 눈이 얼굴 한가운데에 오고,
     이마에 머리카락과 모자가 들어갈 자리가 생긴다. 1.70 이면 눈이 얼굴 위쪽에
     붙어서 머리카락을 얹을 데가 없어진다 — 한 번 그렇게 만들어 봤다. */
  headY: 1.76, headR: 0.43, headFlat: 0.94,
  faceZ: 0.370,                                // 눈·눈썹·입이 놓이는 얼굴 앞면
  browUp: 0.125, mouthDown: 0.175,             // 눈 기준 위아래 간격
  torsoY: 1.05, torsoR: 0.295, torsoH: 0.32,
  shoulderY: 1.32, shoulderX: 0.33,
  armR: 0.088, upperArmH: 0.14, forearmR: 0.066, forearmH: 0.17,
  hipY: 0.70, hipX: 0.145,
  thighR: 0.098, thighH: 0.10, calfR: 0.074, calfH: 0.13,
  shoeR: 0.115
};
const HEAD_TOP = BODY.headY + BODY.headR * 0.98;   // 모자·머리카락이 얹히는 꼭대기
const EYE_LOCAL = EYE - BODY.headY;                // 얼굴 그룹 안에서의 눈 높이

/** 표정 기본값 — setFace 의 표가 비어 있을 때 쓰는 값 */
const FACE_NEUTRAL = [-0.06, 0.125, 1.0, Math.PI, 0.75, 0.35];

/**
 * 얼굴 한 벌 = [눈썹 안쪽 기울기, 눈썹 높이, 눈 세로배율, 입 뒤집기, 입 가로배율, 입 세로배율]
 *
 * 부호 규칙 — 잘못 넣으면 만족이 분노로 보인다. 한 번 데였다.
 *   눈썹 기울기 +  : 안쪽 끝이 내려간다 (화남)
 *   눈썹 기울기 −  : 안쪽 끝이 올라간다 (순함·놀람)
 *   입 뒤집기 π    : ∪ 웃는 입
 *   입 뒤집기 0    : ∩ 찡그린 입
 *   ⚠ 입 뒤집기는 0 또는 π 만 쓴다 — setFace 가 이 값으로 입 높이를 보정한다.
 *
 * 손님의 감정(neutral·annoyed·angry·happy·shocked)과 유저가 고르는 표정이
 * 같은 표를 쓴다. 손님은 상태가 바뀔 때마다 갈아끼우고, 내 캐릭터는 고른 것을
 * 그대로 둔다 — 그래서 표를 나눌 이유가 없다. 키는 config.js PARTS.expression 의 id.
 *
 * ⚠ Hodaart 캐릭터는 입이 메시에 칠해져 있어 뒤 세 칸(입)이 아무 일도 하지 않는다.
 *   앞 세 칸만으로 여덟 표정이 서로 구별돼야 한다. 코드로 세운 몸은 여섯 칸을 다 쓴다.
 */
const FACE_POSE = {
  neutral: FACE_NEUTRAL,
  smile:   [-0.20, 0.132, 0.86, Math.PI, 1.05, 0.62],  // 눈은 그대로, 입만 살짝 올라간다
  happy:   [-0.34, 0.140, 0.55, Math.PI, 1.30, 1.10],  // 웃는 눈, 활짝 올라간 입
  smug:    [ 0.26, 0.158, 0.46, Math.PI, 0.58, 0.42],  // 눈썹은 올리고 안쪽은 내려 내려다본다
  annoyed: [ 0.30, 0.108, 0.85, 0,       0.80, 0.55],  // 눈썹 안쪽이 내려오고 입이 살짝 굳는다
  angry:   [ 0.62, 0.095, 0.60, 0,       0.95, 1.00],  // 눈을 부라리고 입이 확 뒤집힌다
  shocked: [-0.10, 0.170, 1.30, Math.PI, 0.55, 1.80],  // 눈썹이 뜨고 입이 벌어진다
  sleepy:  [ 0.14, 0.104, 0.24, 0,       0.66, 0.30]   // 눈이 거의 감기고 눈썹이 처진다
};

/** 고른 표정의 이름. sanitizeLook 을 거친 값만 들어오므로 범위는 이미 안전하다 */
const characterMood = (index) => PARTS.expression[index].id;

/**
 * 사람 한 명.
 * 팔·다리를 피벗 그룹에 담아 돌려주는 게 핵심 — 걷기 모션이 이 피벗을 돌린다.
 */
function makeBody(color, opts) {
  const o = opts || {};

  /* Blender 베이스가 있으면 몸·옷·간단 리그를 통째로 사용한다.
     파일을 못 읽는 환경에서는 아래 코드 모델이 그대로 비상 대체가 된다. */
  const model = asset('char/base', () => null);
  if (model) {
    ownMat(model);
    const g = new THREE.Group();
    g.add(model);
    const w = o.build || 1;
    model.scale.set(w, 1, w);

    const rig = partOf(model, 'rig') || model;
    const torso = partOf(model, 'body') || partOf(model, 'torso') || model;
    const head = partOf(model, 'head') || model;
    const skinColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.12);
    tintAssetMaterials(model, skinColor,
      (part) => /^(body|head|skinArm[LR]|skinHand[LR])$/i.test(String(part.name || '')));
    const legs = [partOf(model, 'legL'), partOf(model, 'legR')].filter(Boolean);
    const arms = [partOf(model, 'armL'), partOf(model, 'armR')].filter(Boolean);
    return { group: g, rig, torso, head, legs, arms,
      legRest: legs.map((bone) => bone.quaternion.clone()),
      armRest: arms.map((bone) => bone.quaternion.clone()),
      fromAsset: true, baseModel: model };
  }

  /* 바깥(g)에는 이름표·체력바처럼 크기가 고정돼야 하는 것, 안쪽(rig)에는 몸.
     소품과 옷은 rig 에 들어가므로 덩치 배율을 함께 받는다. */
  const g = new THREE.Group();
  const rig = new THREE.Group();
  g.add(rig);
  const w = o.build || 1;                    // 덩치 배율

  // 소매는 몸통보다 한 톤 어둡게 — 같은 색이면 팔이 몸통에 묻혀 안 보인다
  const sleeve = new THREE.Color(color).multiplyScalar(0.82).getHex();

  const torso = cap(BODY.torsoR * w, BODY.torsoH, color, 0, BODY.torsoY, 0, rig);

  /* 목은 없다. 2등신에서 목을 넣으면 머리가 떠 보이고, 머리 구가 몸통 위쪽을
     충분히 덮어서 이음매도 안 보인다. */
  const head = new THREE.Mesh(
    sharedGeo('head_sphere', () => new THREE.SphereGeometry(BODY.headR, 16, 12)),
    mat(SKIN)
  );
  head.position.y = BODY.headY;
  head.scale.set(1, 0.98, BODY.headFlat);
  rig.add(head);

  /* 큰 머리와 짧은 몸 사이가 비어 보이지 않게 작은 칼라/목을 숨겨 넣는다.
     정면에서는 거의 안 보이지만 옆으로 돌 때 머리가 공중에 뜨는 느낌을 없앤다. */
  cap(0.105 * w, 0.10, SKIN, 0, 1.40, -0.015, rig, 9);

  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    // 다리 — 반바지, 종아리, 신발을 한 피벗에 묶어 함께 걷는다.
    const hip = new THREE.Group();
    hip.position.set(s * BODY.hipX, BODY.hipY, 0);
    const thighTotal = BODY.thighH + BODY.thighR * 2;
    const calfTotal = BODY.calfH + BODY.calfR * 2;
    cap(BODY.thighR * w, BODY.thighH, o.pants || PANTS,
      0, -thighTotal / 2, 0, hip);
    const calfTop = -thighTotal + 0.04;
    cap(BODY.calfR * w, BODY.calfH, SKIN,
      0, calfTop - calfTotal / 2, 0.005, hip);

    /* PEAK 실루엣의 핵심인 넓은 신발. 앞쪽(+z)으로 살짝 내밀어 서 있을 때도
       발 방향이 읽히며, 걷는 중에는 다리 피벗과 함께 자연스럽게 따라간다. */
    const shoe = new THREE.Mesh(
      sharedGeo('character_shoe', () => new THREE.SphereGeometry(BODY.shoeR, 9, 6)),
      mat(new THREE.Color(o.pants || PANTS).multiplyScalar(0.64).getHex())
    );
    shoe.position.set(0, calfTop - calfTotal + 0.035, 0.055);
    shoe.scale.set(1.05 * w, 0.68, 1.48);
    hip.add(shoe);
    rig.add(hip);
    legs.push(hip);

    // 팔 — 소매에서 맨팔로 가늘어졌다가 손에서 다시 둥글어지는 형태다.
    const sh = new THREE.Group();
    sh.position.set(s * BODY.shoulderX * w, BODY.shoulderY, 0);
    const upperR = BODY.armR * w;
    const foreR = BODY.forearmR * w;
    const upperTotal = BODY.upperArmH + upperR * 2;
    const foreTotal = BODY.forearmH + foreR * 2;
    cap(upperR, BODY.upperArmH, sleeve, 0, -upperTotal / 2, 0, sh);
    const foreTop = -upperTotal + 0.035;
    cap(foreR, BODY.forearmH, SKIN, 0, foreTop - foreTotal / 2, 0, sh);
    const hand = new THREE.Mesh(
      sharedGeo('character_hand', () => new THREE.SphereGeometry(0.092, 9, 6)),
      mat(SKIN)
    );
    hand.position.set(0, foreTop - foreTotal + 0.052, 0.012);
    hand.scale.set(0.98 * w, 1.08, 0.92);
    sh.add(hand);
    rig.add(sh);
    arms.push(sh);
  }

  return { group: g, rig, torso, head, legs, arms,
    legRest: legs.map((part) => part.quaternion.clone()),
    armRest: arms.map((part) => part.quaternion.clone()) };
}

/**
 * 얼굴 — 눈·눈썹·입.
 * 표정은 지오메트리를 새로 만들지 않고 각도와 배율만 바꿔서 낸다.
 * 손님이 열몇 명씩 서 있으므로 표정 하나 바뀔 때마다 메시를 새로 짜면 안 된다.
 */
function makeFace(parent, opts) {
  const o = opts || {};
  /* 처음 지을 때의 표정. 손님은 안 넘겨서 neutral 로 시작하고 곧 상태가 덮어쓴다.
     내 캐릭터·동료 아바타는 유저가 고른 것을 넘기고, 그대로 남는다. */
  const mood = o.mood || 'neutral';

  /* 얼굴 그룹은 머리 한가운데에 둔다. 아래 좌표는 전부 머리 중심 기준이라
     BODY.headY 를 옮겨도 얼굴이 따라온다. */
  const f = new THREE.Group();
  f.position.set(0, BODY.headY, 0);
  parent.add(f);

  const eyes = [], brows = [];
  for (const s of [-1, 1]) {
    /* PEAK처럼 흰자와 동공을 분리한다. 검은 구 하나만 붙이면 멀리서 구멍처럼
       보여서 표정이 죽는다. 눈 전체를 그룹으로 묶어 실눈/놀란 눈 변형은 유지한다. */
    const e = new THREE.Group();
    e.position.set(s * 0.15, EYE_LOCAL, BODY.faceZ);
    const white = new THREE.Mesh(
      sharedGeo('eye_white', () => new THREE.SphereGeometry(0.078, 10, 8)),
      mat(0xf8f3e7)
    );
    white.scale.set(0.92, 1.08, 0.55);
    e.add(white);
    const pupil = new THREE.Mesh(
      sharedGeo('eye_pupil', () => new THREE.SphereGeometry(0.037, 9, 7)),
      mat(0x241f1c)
    );
    pupil.position.set(-s * 0.008, -0.003, 0.061);
    pupil.scale.z = 0.72;
    e.add(pupil);
    f.add(e); eyes.push(e);

    const b = box(0.13, 0.028, 0.03, o.brow || 0x3a2f28,
      s * 0.15, EYE_LOCAL + BODY.browUp, BODY.faceZ + 0.010, f);
    b.userData.side = s;
    brows.push(b);
  }

  // 입은 반원 토러스 — z 로 뒤집으면 그대로 찡그린 입이 된다
  const mouth = new THREE.Mesh(
    sharedGeo('mouth_arc', () => new THREE.TorusGeometry(0.085, 0.017, 6, 14, Math.PI)),
    mat(0x8a4a44)
  );
  mouth.position.set(0, EYE_LOCAL - BODY.mouthDown, BODY.faceZ);
  f.add(mouth);

  const face = { group: f, eyes, brows, mouth, mood: null,
    browBaseY: brows[0].position.y, mouthBaseY: mouth.position.y };
  setFace(face, mood);
  return face;
}

/** 표정 — 각도와 배율만 건드린다 */
function setFace(face, mood) {
  if (!face || face.mood === mood) return;   // 안 바뀌었으면 손대지 않는다
  face.mood = mood;

  const [tilt, browY, eyeY, mRot, mX, mY] = FACE_POSE[mood] || FACE_NEUTRAL;

  /* 눈썹 높이는 표의 값을 그대로 쓰지 않고 기본값과의 차이만 더한다.
     그래야 얼굴을 위아래로 옮겨도 표가 그대로 살아 있다. */
  face.brows.forEach((b) => {
    b.rotation.z = tilt * b.userData.side;
    b.position.y = face.browBaseY + (browY - FACE_NEUTRAL[1]) * 1.15;
  });
  face.eyes.forEach((e) => e.scale.set(1, 1.08 * eyeY, 1));

  face.mouth.rotation.z = mRot;
  face.mouth.scale.set(mX, mY, 1);
  // 찡그린 입(∩)은 호가 위로 볼록해서, 같은 자리에 두면 웃는 입보다 높아 보인다
  face.mouth.position.y = face.mouthBaseY + (mRot === 0 ? -0.028 : 0);
}

/* ────────────────────────────────────────────────────────────
   캐릭터 파츠 그리기 — 머리카락 · 얼굴 · 상의

   플레이어가 고른 조합과 손님이 seed 로 받은 조합이 같은 함수를 쓴다.
   그래서 손님이 입은 옷을 플레이어도 그대로 고를 수 있다.

   ⚠ 머리카락은 이마를 가리면 안 된다.
     눈썹이 표정의 절반을 맡는데 머리와 눈썹이 둘 다 짙어서,
     닿는 순간 표정이 통째로 안 보인다. 그래서 앞쪽을 z −0.06 뒤로 물린다.
   ──────────────────────────────────────────────────────────── */

/** 머리카락 — 큰 머리 위에 얕은 돔처럼 얹는다 */
function buildHair(kind, color, g) {
  if (kind !== 'bald') {
    const model = asset('char/hair/' + kind, () => null);
    if (model) {
      // 직접 만든 머리 파츠(custom)만 색을 바꾸고 원본 모자 텍스처는 유지한다.
      tintAssetMaterials(model, color,
        (o, m) => String(m.name || '').toLowerCase().includes('custom'));
      g.add(model);
      return model;
    }
  }

  /* 앞머리가 눈썹에 닿으면 표정이 통째로 죽는다 — 둘 다 짙어서 붙는 순간 구분이
     안 된다. 그래서 통짜 구가 아니라 위쪽만 남긴 돔을 쓴다. 돔의 아래 끝이
     눈썹 위에서 끊기므로, 머리를 아무리 키워도 이마를 덮지 않는다.

     ⚠ 돔 반지름은 반드시 머리보다 커야 한다. 작으면 머리 속에 들어가 한 올도
     안 보인다 — 오류도 안 나고 그냥 대머리가 된다. */
  const dome = (r, above, flat) => {
    // above = 돔의 아래 끝이 머리 중심보다 몇 m 위인가. 이 값이 클수록 얕은 모자
    const t = Math.acos(Math.max(-1, Math.min(1, above / (r * 0.98))));
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 9, 0, Math.PI * 2, 0, t), mat(color)
    );
    m.position.set(0, BODY.headY, -0.012);
    m.scale.set(1, 0.98, flat || 0.95);
    g.add(m);
    return m;
  };
  const R = BODY.headR + 0.014;                       // 머리보다 조금 크게 씌운다
  const CLEAR = EYE_LOCAL + BODY.browUp + 0.035;     // 눈썹 윗변보다 3.5cm 위에서 끊는다

  switch (kind) {
    case 'short': dome(R, CLEAR); break;
    case 'bob':
      dome(R + 0.004, CLEAR);
      for (const s of [-1, 1])                                  // 귀 옆으로 내려오는 단
        box(0.11, 0.34, 0.32, color, s * 0.415, 1.84, -0.04, g);
      break;
    case 'bun':
      dome(R, CLEAR);
      { const b = new THREE.Mesh(new THREE.SphereGeometry(0.145, 8, 6), mat(color));
        b.position.set(0, 2.02, -0.36); g.add(b); }             // 뒤로 묶은 쪽
      break;
    case 'spiky':
      dome(R, CLEAR + 0.02);
      for (let i = 0; i < 5; i++) {                              // 위로 삐죽삐죽
        const p = cyl(0.072, 0.24, color, (i - 2) * 0.115, 2.30, -0.05, g, 5, 0.006);
        p.rotation.z = (i - 2) * 0.20;
      }
      break;
    case 'long':
      dome(R + 0.004, CLEAR);
      box(0.58, 0.64, 0.27, color, 0, 1.52, -0.30, g);           // 등까지 내려오는 머리
      for (const s of [-1, 1]) box(0.12, 0.50, 0.30, color, s * 0.412, 1.78, -0.03, g);
      break;
    case 'bald': default: break;                                 // 아무것도 안 얹는다
  }
}

/** 얼굴 소품 — makeFace 가 만든 눈·눈썹·입 위에 더한다 */
function buildFaceStyle(kind, g) {
  const FZ = BODY.faceZ;
  switch (kind) {
    case 'glasses':
      for (const s of [-1, 1]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.014, 5, 14), mat(0x2f2b26));
        rim.position.set(s * 0.145, EYE, FZ + 0.022);
        g.add(rim);
      }
      box(0.11, 0.014, 0.014, 0x2f2b26, 0, EYE, FZ + 0.024, g);       // 코걸이
      break;
    case 'freckle':
      for (let i = 0; i < 6; i++) {
        const s = i < 3 ? -1 : 1, k = i % 3;
        cyl(0.015, 0.006, 0xc98a6a, s * (0.155 + k * 0.048), EYE - 0.085 + (k % 2) * 0.03,
          FZ + 0.005, g, 5).rotation.x = Math.PI / 2;
      }
      break;
    case 'beard':
      // 입 아래에서 시작해 턱을 감싼다. 더 키우면 입까지 먹어 표정이 죽는다
      { const b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 6), mat(0x4a3a30));
        b.position.set(0, EYE - BODY.mouthDown - 0.16, 0.14);
        b.scale.set(1, 0.52, 0.84); g.add(b); }
      break;
    case 'blush':
      for (const s of [-1, 1])
        cyl(0.062, 0.008, 0xe8907f, s * 0.245, EYE - 0.10, FZ - 0.075, g, 10)
          .rotation.x = Math.PI / 2;
      break;
    case 'plain': default: break;
  }
}

/** 상의 — 짧고 둥근 몸통 위에 덧입힌다 */
function buildTop(kind, color, g, w) {
  const model = asset('char/top/' + kind, () => null);
  if (model) {
    // 앞치마의 흰 천은 유지하고 custom 재질로 만든 부분만 선택 색을 쓴다.
    tintAssetMaterials(model, color,
      (o, m) => String(m.name || '').toLowerCase().includes('custom'));
    g.add(model);
    return model;
  }

  const R = (BODY.torsoR + 0.006) * (w || 1);
  const TOP = BODY.shoulderY + 0.025;              // 실제 어깨선
  switch (kind) {
    case 'apron':
      box(0.34 * (w || 1), 0.52, 0.03, 0xf2eee4, 0, BODY.torsoY - 0.04, R, g);   // 앞치마 천
      box(0.38 * (w || 1), 0.035, 0.03, 0xd8d2c4, 0, TOP - 0.03, R, g);          // 목끈
      break;
    case 'stripe':
      for (let i = 0; i < 3; i++)
        cyl(R, 0.06, color, 0, BODY.torsoY - 0.20 + i * 0.20, 0, g, 12);         // 가로 줄
      break;
    case 'hoodie':
      { const hd = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 5), mat(color));
        hd.position.set(0, TOP - 0.02, -0.13); hd.scale.set(1, 0.62, 0.75); g.add(hd); }
      box(0.05, 0.26, 0.03, 0xe8e2d6, 0, BODY.torsoY, R, g);                     // 앞 끈
      break;
    case 'vest':
      for (const s of [-1, 1])                                                    // 앞섶 두 짝
        box(0.11, 0.46, 0.03, color, s * 0.10, BODY.torsoY - 0.02, R, g);
      cyl(R + 0.006, 0.05, color, 0, TOP - 0.04, 0, g, 12);                       // 어깨 선
      break;
    case 'tee': default:
      cyl(R + 0.005, 0.055, color, 0, TOP - 0.03, 0, g, 12);                      // 목둘레
      break;
  }
}

/* 모자·헬멧을 쓰는 손님 — 머리카락을 지운다. 안 그러면 모자를 뚫고 나온다 */
const HEAD_COVER = new Set(['📦', '🥾', '🧃', '🎥', '🛵']);
const BALD = PARTS.hair.findIndex((p) => p.id === 'bald');

/* 그 손님을 그 손님이게 하는 부분은 seed 에 맡기지 않고 고정한다 */
const LOOK_FIX = {
  '👵': { h: 2, hc: 3 },        // 단골 할머니 — 흰 쪽머리
  '🧔': { f: 3 },               // 진상 아저씨 — 수염
  '🕶️': { f: 1 },              // 까다로운 손님 — 선글라스 자리에 안경
  '🧃': { t: 1 }                // 편의점 알바 — 앞치마
};

/**
 * 손님 조합 — seed 에서 뽑되 위 규칙으로 손본다.
 * 서버가 보내주는 값이 아니라 양쪽이 같은 seed 로 계산해 낸다.
 */
function customerLook(emoji, seed) {
  const L = lookFromSeed(seed || 0);
  const fix = LOOK_FIX[emoji];
  if (fix) Object.assign(L, fix);
  if (HEAD_COVER.has(emoji)) L.h = BALD;
  return L;
}

/**
 * 고른 조합을 몸에 입힌다.
 * 머리카락·상의는 몸에, 얼굴 소품은 얼굴이 붙은 그룹에 얹는다.
 */
function applyLook(b, look, build) {
  if (!b || !look) return;
  const L = sanitizeLook(look);
  const into = b.rig || b.group;
  if (b.baseModel) {
    const white = new THREE.Color(0xffffff);
    const topTint = new THREE.Color(PART_COLORS.top[L.tc]).lerp(white, 0.45);
    const bottomTint = new THREE.Color(PART_COLORS.bottom[L.bc]).lerp(white, 0.28);
    tintAssetMaterials(b.baseModel, topTint,
      (o) => String(o.name || '').toLowerCase() === 'basetop');
    tintAssetMaterials(b.baseModel, bottomTint,
      (o) => String(o.name || '').toLowerCase() === 'basebottom');
  }
  buildHair(PARTS.hair[L.h].id, PART_COLORS.hair[L.hc], into);
  buildTop(PARTS.top[L.t].id, PART_COLORS.top[L.tc], into, build || 1);
  buildFaceStyle(PARTS.face[L.f].id, into);
}

/**
 * 손님 종류별 소품 — 이모지 하나로 갈린다.
 * 머리카락·얼굴·상의는 파츠(applyLook)가 맡고, 여기서는 진짜 소품만 붙인다.
 * 둘 다 머리에 얹으면 모자를 뚫고 머리가 솟는다.
 */
function accessorize(emoji, b, color) {
  const g = b.rig || b.group;
  const cap = (c) => {
    cyl(0.30, 0.13, c, 0, HEAD_TOP - 0.06, 0, g, 12);
    box(0.38, 0.035, 0.26, c, 0, HEAD_TOP - 0.10, 0.30, g);          // 챙
  };
  const pack = (c) => box(0.38, 0.42, 0.18, c, 0, 0.92, -0.30, g);
  const ball = (c, r, x, y, z, sy) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(c));
    m.position.set(x, y, z); if (sy) m.scale.set(1, sy, 1); g.add(m);
    return m;
  };

  switch (emoji) {
    /* ── 일반 손님 8종 ── */
    case '🎒': pack(0x8a4f3a); break;
    case '📦': box(0.36, 0.30, 0.28, 0xc9a26b, 0, 1.16, 0.34, g); cap(0x3f6b8f); break;
    case '👜': box(0.20, 0.17, 0.10, 0x7a4a6b, 0.34, 0.86, 0.06, g); break;
    case '💼': box(0.09, 0.44, 0.02, 0x8a2f38, 0, 1.06, 0.24, g);          // 넥타이
               box(0.23, 0.18, 0.08, 0x3a2f28, 0.34, 0.72, 0, g); break;   // 서류가방
    case '🥾': cap(0x4f8f58); pack(0x3f6b4a); break;
    case '🎈': cyl(0.006, 0.70, 0xbbbbbb, 0.30, 1.30, 0.10, g, 4);         // 풍선 끈
               ball(0xd96a6a, 0.15, 0.30, 1.78, 0.10, 1.2); break;
    case '🧃': cap(0x3f8f8a); break;                                       // 앞치마는 상의 파츠가 맡는다
    case '🏋️': b.torso.scale.set(1.10, 1, 1.10); break;                    // 떡 벌어진 어깨

    /* ── 카운터 진상 6종 ── */
    case '🧔': ball(color, 0.26, 0, 0.80, 0.10, 0.9); break;               // 배 (수염은 얼굴 파츠)
    case '🕶️': break;                                                     // 선글라스는 얼굴 파츠가 맡는다
    case '👵': g.scale.setScalar(0.88); break;                             // 작은 키 (흰 쪽머리는 머리 파츠)
    case '🎥': cap(0x2f3540);
               box(0.19, 0.15, 0.22, 0x2a2a2e, 0, 1.30, 0.42, g);          // 카메라
               cyl(0.06, 0.06, 0x14141a, 0, 1.30, 0.53, g, 10); break;
    case '⭐': ball(0xf0c53a, 0.085, 0.19, 1.14, 0.24);                    // 별 뱃지
               box(0.12, 0.20, 0.02, 0x24242a, -0.26, 0.98, 0.22, g); break;  // 들고 있는 폰
    case '🛵': ball(0xd8443c, 0.448, 0, BODY.headY, 0);                    // 헬멧
               box(0.48, 0.17, 0.03, 0x1a1a20, 0, EYE, BODY.faceZ + 0.03, g); break;
    default:  break;
  }
}

/**
 * 걷기 — 다리를 서로 반대로, 팔은 그 반대쪽으로 흔든다.
 * 뭘 들고 있으면 팔은 앞으로 모아 둔다. 안 그러면 든 물건이 팔에서 떨어져 나간다.
 * 돌려주는 값은 걸을 때 몸이 들썩이는 높이다.
 */
const LIMB_AXIS_X = new THREE.Vector3(1, 0, 0);
const LIMB_DELTA = new THREE.Quaternion();

function poseLimbs(b, phase, walking, holding) {
  if (!b) return 0;
  const sw = walking ? Math.sin(phase) * 0.62 : 0;
  /* GLB 뼈에는 Blender→glTF 축 변환용 기본 회전(현재 X축 180°)이 있다.
     rotation.x를 바로 대입하면 그 보정이 사라져 다리가 몸통 안으로 접힌다.
     원래 쿼터니언을 되살린 뒤 로컬 X축 보행 각도만 곱한다. */
  const pose = (part, rest, angle) => {
    if (!part) return;
    if (rest) part.quaternion.copy(rest).multiply(LIMB_DELTA.setFromAxisAngle(LIMB_AXIS_X, angle));
    else part.rotation.x = angle;
  };
  pose(b.legs[0], b.legRest && b.legRest[0], sw);
  pose(b.legs[1], b.legRest && b.legRest[1], -sw);
  if (holding) {
    pose(b.arms[0], b.armRest && b.armRest[0], -0.95);
    pose(b.arms[1], b.armRest && b.armRest[1], -0.95);
  } else {
    pose(b.arms[0], b.armRest && b.armRest[0], -sw * 0.72);
    pose(b.arms[1], b.armRest && b.armRest[1], sw * 0.72);
  }
  return walking ? Math.abs(Math.sin(phase)) * 0.063 : 0;
}

function makeOutline(parent, build) {
  // depthTest 는 반드시 켠 채로 둔다. 볼록 셸의 BackSide 는 실루엣 전체를 덮으므로
  // 깊이 검사를 끄면 테두리가 아니라 손님이 통째로 단색 덩어리가 되고 벽까지 뚫는다.
  const skin = () => new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR, side: THREE.BackSide,
    transparent: true, opacity: 0.9, depthWrite: false
  });
  const g = new THREE.Group();

  // 몸통·머리가 재질을 따로 갖는다 — 손님이 나갈 때 disposeObject 가 같은 걸 두 번 놓지 않게
  const R = (BODY.shoulderX + BODY.armR + 0.055) * (build || 1);
  const bodyH = BODY.shoulderY + 0.10;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyH, 14), skin());
  body.position.y = bodyH / 2;

  const head = new THREE.Mesh(new THREE.SphereGeometry(BODY.headR + 0.035, 12, 8), skin());
  head.position.y = BODY.headY;

  g.add(body, head);
  g.visible = false;
  parent.add(g);
  return { group: g, body, head, r: R };
}

/**
 * 거리가 멀어져도 테두리가 화면에서 같은 두께로 보이게 배율을 구한다.
 * 고정 배율로 두면 조리대(10m 남짓)에서 2px 로 녹아버린다.
 */
const rimScale = (kk, dist, r, max) => Math.min(max, 1 + (kk * dist) / r);

/**
 * 손님 머리 위 체력바 — 칸 하나가 빗자루 한 대다.
 * 손님은 카운터(+z)를 보고 서 있으니 평면을 그대로 붙이면 정면으로 보인다.
 */
function makeHpBar(hpMax, parent) {
  const W = 0.86, H = 0.09, GAP = 0.022;
  const sw = (W - GAP * (hpMax - 1)) / hpMax;
  const g = new THREE.Group();

  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.07, H + 0.07),
    new THREE.MeshBasicMaterial({ color: 0x140f0b, transparent: true, opacity: 0.72, depthWrite: false })
  );
  g.add(bg);

  const segs = [];
  for (let i = 0; i < hpMax; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, H), new THREE.MeshBasicMaterial({ color: 0x58c07a }));
    m.position.set(-W / 2 + sw / 2 + i * (sw + GAP), 0, 0.003);
    g.add(m);
    segs.push(m);
  }
  g.position.set(0, 2.42, 0.46);   // 몸(2.13) 위
  parent.add(g);
  return { group: g, segs, shown: -1 };
}

/** 남은 칸 수에 따라 색을 바꾼다 — 한 대 남으면 빨강 */
function paintHp(bar, hp) {
  if (bar.shown === hp) return;      // 안 바뀌었으면 건드리지 않는다
  bar.shown = hp;
  const live = hp <= 1 ? 0xe05252 : hp <= 2 ? 0xf5b942 : 0x58c07a;
  bar.segs.forEach((m, i) => m.material.color.setHex(i < hp ? live : 0x3a2f28));
}

function makeCustomer(info) {
  const counter = info.kind === KIND.COUNTER;
  const look = customerLook(info.emoji, info.seed);
  // 진상은 덩치부터 다르게 — 색만 다르면 줄 서 있을 때 누가 진상인지 모른다
  const b = makeBody(info.color, { build: counter ? 1.12 : 1 });
  const g = b.group;
  /* 고른 조합 — 손님은 seed 에서 뽑는다. 네트워크로 오는 값이 아니다.
     소품(백팩·헬멧 등)은 그 위에 덧붙는다. */
  applyLook(b, look, counter ? 1.12 : 1);
  // 직접 만든 모델은 소품까지 들고 있다고 본다 — 코드가 또 붙이면 겹친다
  accessorize(info.emoji, b, info.color);
  const face = makeFace(b.rig, counter ? { brow: 0x5a2f28 } : null);
  // 아바타는 얼굴이 로컬 +z 를 향한다. 손님은 카운터(자기보다 +z 쪽)를 본다.
  g.rotation.y = 0;

  const name = fittedPanel(info.emoji + ' ' + info.name, 1.0, false);
  name.text(info.emoji + ' ' + info.name,
    { color: counter ? '#ff9b9b' : '#cfe9f5' });
  name.sprite.position.set(0, 2.72, 0);
  g.add(name.sprite);

  const order = new Panel(384, 132, 1.5, false);
  order.sprite.position.set(0, 2.14, 0);
  g.add(order.sprite);

  // 조준용 히트박스 — 이 손님을 겨냥해 서빙한다
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 2.16, 0.95),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hit.position.y = 1.08;
  hit.renderOrder = -1;
  hit.userData.station = { kind: 'customer', id: info.id };
  g.add(hit);
  interactables.push(hit);

  const bubble = new Panel(320, 76, 1.35, false);
  bubble.sprite.position.set(0, 3.06, 0);
  bubble.sprite.visible = false;
  g.add(bubble.sprite);

  const hpMax = info.hpMax || CUSTOMER_HP[counter ? 'special' : 'normal'] || 3;
  const hp = makeHpBar(hpMax, g);
  const outline = makeOutline(b.rig, counter ? 1.12 : 1);

  scene.add(g);
  return { group: g, name, order, bubble, hit, hp, outline,
    body: ownMat(b.torso), limbs: b, face,     // 피격 번쩍임이 emissive 를 바꾼다
    lastLine: null, lastBand: -1, lastHp: hpMax, hitAt: -9999 };
}

function customerPos(c, t) {
  const tx = slotX(c.slot), tz = QUEUE_Z;
  if (c.state === 'walkin') {
    const p = Math.min(1, (t - c.since) / WALK_IN_MS);
    return { x: DOOR.x + (tx - DOOR.x) * p, z: DOOR.z + (tz - DOOR.z) * p, walking: p < 1 };
  }
  if (c.state === 'happy' || c.state === 'angry' || c.state === 'kicked') {
    const p = Math.min(1, (t - c.since) / WALK_OUT_MS);
    return { x: tx + (DOOR.x - tx) * p, z: tz + (DOOR.z - tz) * p, walking: true };
  }
  return { x: tx, z: tz, walking: false };
}

function syncCustomers() {
  const w = S.state && S.state.wave;
  // 일반 손님이든 진상이든 모두 카운터에 세운다
  const list = (w && w.customers) || [];
  const t = serverNow();
  const seen = new Set();
  const focus = focusNow();                        // 🎯 내 화면에서만 쓰는 대상 표시
  const glow = 0.84 + Math.sin(t / 190) * 0.14;    // 0.70~0.98 — 항상 OUTLINE_TIE 보다 밝다
  // 거리 → 배율 환산 계수. 프레임당 한 번만 구한다
  const kk = (OUTLINE_PX * 2 * OUTLINE_TAN) /
    Math.max(1, renderer ? renderer.domElement.clientHeight : 900);

  for (const c of list) {
    seen.add(c.id);
    let d = D.customers.get(c.id);
    if (!d) {
      d = makeCustomer(c);
      D.customers.set(c.id, d);
    }

    /* 🧹 맞았나? — 체력이 줄어든 프레임에 움찔거리게 한다 */
    const hp = c.hp == null ? d.lastHp : c.hp;
    if (hp < d.lastHp) d.hitAt = t;
    d.lastHp = hp;
    const sinceHit = t - d.hitAt;
    const flinch = sinceHit < HIT_FLINCH_MS ? 1 - sinceHit / HIT_FLINCH_MS : 0;

    const pos = customerPos(c, t);
    d.group.position.x = pos.x + (flinch ? Math.sin(sinceHit / 22) * 0.12 * flinch : 0);
    d.group.position.z = pos.z;
    // 다리가 걷고, 몸은 그 보폭만큼만 들썩인다
    d.group.position.y = poseLimbs(d.limbs, t / 128, pos.walking, false);

    const leaving = c.state === 'happy' || c.state === 'angry' || c.state === 'kicked';
    d.group.rotation.y = leaving ? Math.PI : 0;
    if (d.body) d.body.material.emissive.setHex(flinch > 0 ? 0x882020 : 0x000000);

    /* 표정 — 맞았으면 놀란 얼굴이 먼저다.
       기다리는 동안에는 남은 인내심이 그대로 얼굴에 나온다. */
    let mood;
    if (flinch > 0 || c.state === "kicked") mood = "shocked";
    else if (c.state === "happy") mood = "happy";
    else if (c.state === "angry") mood = "angry";
    else if (c.patienceMax) {
      const p = Math.max(0, Math.min(1, ((c.deadline - t) / 1000) / c.patienceMax));
      mood = p > 0.5 ? (c.kind === KIND.COUNTER ? "annoyed" : "neutral")
           : p > 0.25 ? "annoyed" : "angry";
    } else mood = c.kind === KIND.COUNTER ? "annoyed" : "neutral";
    setFace(d.face, mood);

    /* 🎯 내가 든 김밥과 제일 잘 맞는 손님만 테두리를 두른다.
       동점이 여럿이면 전부 켜되, 실제로 나갈 한 명만 밝게 숨쉰다. */
    const lit = c.state === 'wait' && focus.outline.has(c.id);
    d.outline.group.visible = lit;
    if (lit) {
      const far = Math.hypot(pos.x - camera.position.x, pos.z - camera.position.z);
      const o = c.id === focus.focusId ? glow : OUTLINE_TIE;
      d.outline.body.material.opacity = o;
      d.outline.head.material.opacity = o;
      const bs = rimScale(kk, far, d.outline.r, 1.40);
      d.outline.body.scale.set(bs, 1.05, bs);    // y 는 1.05 고정 — 1.0 이면 어깨 테두리가 끊긴다
      d.outline.head.scale.setScalar(rimScale(kk, far, BODY.headR, 1.28));
    }

    /* 체력바 — 기다리는 동안에만 보여준다 */
    const showHp = c.state === 'wait' && c.hp != null;
    d.hp.group.visible = showHp;
    if (showHp) paintHp(d.hp, c.hp);

    d.group.updateMatrixWorld(true);      // 조준(레이캐스트)이 한 프레임 밀리지 않게

    if (c.state === 'wait') {
      const left = Math.max(0, (c.deadline - t) / 1000);
      const pct = Math.max(0, Math.min(1, left / c.patienceMax));
      const color = pct > 0.5 ? '#58c07a' : pct > 0.25 ? '#f5b942' : '#e05252';
      // 서버의 targetId 는 내 손에 뭐가 들렸는지 모른다 — 내 기준으로 다시 고른다
      const isTarget = focus.focusId === c.id;
      d.order.order(
        '🍣 김밥 ' + c.need + '줄' + (isTarget ? '  ◀ 다음' : ''),
        c.fills.map((id) => ITEMS[id].name).join(' · '),
        pct, color, Math.ceil(left) + '초'
      );
      d.order.sprite.visible = true;

      // 궁시렁은 진상 손님만 — 인내심 구간이 바뀔 때만 대사를 새로 뽑는다
      if (c.kind === KIND.COUNTER) {
        const band = pct > 0.66 ? 0 : pct > 0.38 ? 1 : pct > 0.15 ? 2 : 3;
        if (d.lastBand !== band) {
          d.lastBand = band;
          d.lastLine = grumbleFor(pct, c.seed + band);
        }
        d.bubble.text(d.lastLine, band >= 2
          ? { color: '#b32020', bg: 'rgba(255,235,235,.95)', scale: 0.4 }
          : { color: '#2a2118', bg: 'rgba(255,255,255,.92)', scale: 0.4 });
        d.bubble.sprite.visible = true;
        d.bubble.sprite.position.y = 3.06 + Math.sin(t / 420) * 0.03;
      } else {
        d.bubble.sprite.visible = false;
      }
    } else if (c.state === 'happy') {
      d.order.text('😋 잘 먹을게요!', { color: '#8fe6a8' });
      d.order.sprite.visible = true;
      if (c.kind === KIND.COUNTER) {
        d.bubble.text('오, 이건 인정', { color: '#2f6b41', bg: 'rgba(235,255,240,.95)', scale: 0.4 });
        d.bubble.sprite.visible = true;
      } else d.bubble.sprite.visible = false;
    } else if (c.state === 'kicked') {
      d.order.text('🤬 알았어, 간다고!', { color: '#ffb0b0' });
      d.order.sprite.visible = true;
      d.bubble.text('여기 두 번 다시 안 와',
        { color: '#b32020', bg: 'rgba(255,235,235,.95)', scale: 0.4 });
      d.bubble.sprite.visible = true;
    } else if (c.state === 'angry') {
      d.order.text('😡 됐어요, 갈게요!', { color: '#ff8a8a' });
      d.order.sprite.visible = true;
      if (c.kind === KIND.COUNTER) {
        d.bubble.text('별점 1개다 진짜', { color: '#b32020', bg: 'rgba(255,235,235,.95)', scale: 0.4 });
        d.bubble.sprite.visible = true;
      } else d.bubble.sprite.visible = false;
    } else {
      d.order.sprite.visible = false;
      d.bubble.sprite.visible = false;
    }
  }

  for (const [id, d] of D.customers) {
    if (seen.has(id)) continue;
    const at = interactables.indexOf(d.hit);
    if (at >= 0) interactables.splice(at, 1);      // 조준 대상에서 빼준다
    scene.remove(d.group);
    disposeObject(d.group);
    D.customers.delete(id);
  }
}

/* ────────────────────────────────────────────────────────────
   동료 아바타
   ──────────────────────────────────────────────────────────── */
function makeAvatar(name, color, look) {
  const L = sanitizeLook(look);
  const b = makeBody(new THREE.Color(color).getHex());
  const g = b.group;
  applyLook(b, look, 1);
  makeFace(g, { mood: characterMood(L.e) });
  const p = fittedPanel(name, 1.5, false);
  p.text(name, { color: "#fff" });
  p.sprite.position.y = 2.52;
  g.add(p.sprite);
  g.userData.limbs = b;                             // 걷기 모션이 쓴다
  scene.add(g);
  return g;
}

const SWING_MS = 260;
const swingAt = new Map();

export function remoteSwing(playerId) { swingAt.set(playerId, performance.now()); }

function applyRemoteSwing(av, id) {
  const m = av.userData.handMesh;
  const base = av.userData.handBase;
  if (!m || !base) return;
  const started = swingAt.get(id);
  const t = started === undefined ? 1.1 : (performance.now() - started) / SWING_MS;
  if (t >= 1) {
    if (av.userData.swinging) {
      m.position.copy(base.pos);
      m.rotation.copy(base.rot);
      av.userData.swinging = false;
    }
    return;
  }
  av.userData.swinging = true;
  const DOWN = 0.35;
  const p = t < DOWN ? Math.pow(t / DOWN, 0.6) : 1 - Math.pow((t - DOWN) / (1 - DOWN), 1.4);
  m.rotation.z = base.rot.z + p * 3.3;
  m.rotation.x = base.rot.x - p * 0.5;
  m.position.x = base.pos.x - p * 0.5;
  m.position.y = base.pos.y - p * 0.35;
  m.position.z = base.pos.z + p * 0.25;
}

function updateRemotes() {
  const seen = new Set();
  const players = (S.state && S.state.players) || [];

  for (const pos of remotePositions()) {
    seen.add(pos.id);
    const info = players.find((p) => p.id === pos.id);
    let av = D.remotes.get(pos.id);
    if (!av) {
      av = makeAvatar(info ? info.name : '알바', info ? info.color : '#f5b942', info && info.look);
      D.remotes.set(pos.id, av);
    }
    /* 보간이 이미 부드러우므로 그대로 놓는다.
       여기서 또 감쇠를 걸면 두 번 늦어지고 방향 전환이 뭉개진다. */
    /* 서버가 속도를 보내주지 않으므로 위치가 얼마나 움직였는지로 걸음을 만든다.
       걸음 위상을 이동 거리로 굴리면 빨리 갈수록 보폭이 빨라진다. */
    const last = av.userData.lastPos;
    const moved = last ? Math.hypot(pos.x - last.x, pos.z - last.z) : 0;
    av.userData.lastPos = { x: pos.x, z: pos.z };
    av.userData.phase = (av.userData.phase || 0) + moved * 9;

    const holding = handOf(pos.id);
    const bob = poseLimbs(av.userData.limbs, av.userData.phase, moved > 0.004, !!holding);
    av.position.set(pos.x, (pos.y || 0) + bob, pos.z);
    av.rotation.y = pos.ry + Math.PI;
    const key = holding ? holding.uid : 'none';
    if (av.userData.handKey !== key) {
      av.userData.handKey = key;
      if (av.userData.handMesh) {
        av.remove(av.userData.handMesh);
        disposeObject(av.userData.handMesh);
        av.userData.handMesh = null;
      }
      if (holding) {
        const m = makeItemMesh(holding);
        if (holding.id === 'broom') {
          m.position.set(0.42, 1.47, 0.39);
          m.rotation.set(0, 0, Math.PI - 0.45);
          m.scale.setScalar(0.9);
        } else {
          m.position.set(0, 1.33, 0.63);
        }
        av.add(m);
        av.userData.handMesh = m;
        av.userData.handBase = { pos: m.position.clone(), rot: m.rotation.clone() };
        av.userData.swinging = false;
      }
    }
  }

  for (const [id, av] of D.remotes) applyRemoteSwing(av, id);

  for (const [id, av] of D.remotes) {
    if (seen.has(id)) continue;
    scene.remove(av);
    disposeObject(av);
    D.remotes.delete(id);
    swingAt.delete(id);
  }
}

/* ────────────────────────────────────────────────────────────
   부트 / 렌더
   ──────────────────────────────────────────────────────────── */
export function initWorld(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  /* 선형 출력 그대로 내보내면 밝은 면이 다 하얗게 뜨고 대비가 죽는다.
     필름 톤매핑을 씌워야 면마다 톤 차이가 살아난다 — 로우폴리는 그 차이가 전부다. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = false;
  resize();
  window.addEventListener('resize', resize);

  camera.position.set(0, 1.82, 6);   // player.js 의 EYE 와 같게
  scene.add(camera);

  buildRoom();
  buildFridge();
  buildSink();
  buildCookers();
  buildStove();
  buildBoards();
  buildMats();
  buildBin();
  buildBrooms();
  buildServe();
  buildArm();

  /* 그림자는 사용하지 않는다. 외부 GLB가 자체 플래그를 들고 와도 여기서 확실히 끈다. */
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
  });
}

function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function render(swinging) {
  updateHand();
  animateHand(swinging);
  animateArm(swinging);
  if (S.kitchen) {
    syncFridge();
    syncSink();
    syncCookers();
    syncBurners();
    syncBoards();
    syncMats();
    syncBrooms();
  }
  syncCustomers();
  updateRemotes();
  renderer.render(scene, camera);
}

/** 렌더러 통계 (최적화 확인용) */
export function stats() {
  if (!renderer) return null;
  const i = renderer.info;
  return {
    geometries: i.memory.geometries,
    textures: i.memory.textures,
    calls: i.render.calls,
    triangles: i.render.triangles
  };
}



/**
 * 입장 화면 미리보기용 몸 한 채.
 * 게임에서 쓰는 makeBody / applyLook 을 그대로 타므로
 * 여기서 보이는 모습이 실제로 보일 모습과 같다.
 */
export function previewBody(look) {
  const L = sanitizeLook(look);
  const b = makeBody(0xc9c2b4);
  makeFace(b.group, { mood: characterMood(L.e) });
  applyLook(b, look, 1);
  return b.group;
}
