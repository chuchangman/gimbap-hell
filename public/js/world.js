/* ────────────────────────────────────────────────────────────
   3D 김밥집 — 주방 · 카운터 손님 · 동료 아바타 · 빗자루
   상태는 서버 스냅샷(net.js)에서 읽어오기만 한다.

   키오스크 손님이든 카운터 진상이든 모두 문에서 걸어 들어와 줄을 선다.
   말풍선으로 궁시렁대는 것은 진상 손님뿐이다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from '/vendor/three.module.min.js';
import {
  ITEMS, FRIDGE_ROW_A, FRIDGE_ROW_B, TIME, C,
  BURNERS, BOARD_COUNT, MAT_COUNT, COOKER_COUNT, BROOM_COUNT,
  QUEUE_SLOTS, WALK_IN_MS, WALK_OUT_MS, KIND, grumbleFor,
  QUEUE_Z, slotX, CUSTOMER_HP
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
const mat = (color, opts) => new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {}));

function box(w, h, d, color, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

function cyl(r, h, color, x, y, z, parent, seg, r2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 === undefined ? r : r2, h, seg || 16), mat(color));
  m.position.set(x, y, z);
  (parent || scene).add(m);
  return m;
}

/** 씬에서 뺀 메시의 GPU 자원을 실제로 놓아준다 (안 하면 계속 쌓인다) */
function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
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
   ──────────────────────────────────────────────────────────── */
export function makeItemMesh(item) {
  const g = new THREE.Group();
  if (!item) return g;
  const id = item.id;
  const st = item.stage;
  const burnt = st === 'burnt';

  if (id === 'gim') {
    const sheet = box(0.62, 0.014, 0.5, C.gim, 0, 0, 0, g);
    sheet.material.side = THREE.DoubleSide;
    box(0.64, 0.004, 0.52, C.gimEdge, 0, -0.01, 0, g);

  } else if (id === 'rice') {
    const bowl = cyl(0.21, 0.14, C.steel, 0, 0, 0, g, 18, 0.15);
    cyl(0.185, 0.03, st === 'washed' ? C.riceWashed : C.riceRaw, 0, 0.06, 0, bowl, 18);
    if (st === 'washed') {
      const w = cyl(0.19, 0.05, C.water, 0, 0.075, 0, bowl, 18);
      w.material.transparent = true; w.material.opacity = 0.55;
    }

  } else if (id === 'bap') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat(C.bap));
    m.scale.set(1, 0.55, 0.85);
    g.add(m);
    for (let i = 0; i < 5; i++) {
      const grain = cyl(0.014, 0.05, 0xffffff, (i - 2) * 0.06, 0.1, ((i % 2) - 0.5) * 0.18, g, 6);
      grain.rotation.z = i * 0.7;
    }

  } else if (id === 'danmuji') {
    if (st === 'raw') {
      const d = cyl(0.075, 0.5, C.danmuji, 0, 0, 0, g, 14);
      d.rotation.z = Math.PI / 2;
    } else {
      for (let i = 0; i < 4; i++) box(0.44, 0.035, 0.035, C.danmujiCut, 0, 0, -0.06 + i * 0.04, g);
    }

  } else if (id === 'ham') {
    const col = burnt ? C.burnt : (st === 'raw' ? C.hamRaw : C.hamDone);
    if (st === 'raw') box(0.34, 0.11, 0.24, col, 0, 0, 0, g);
    else for (let i = 0; i < 4; i++) box(0.42, 0.045, 0.045, col, 0, 0, -0.07 + i * 0.045, g);

  } else if (id === 'spinach') {
    const col = burnt ? 0x4a5238 : (st === 'raw' ? C.spinachRaw : C.spinachDone);
    if (st === 'raw') {
      for (let i = 0; i < 4; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(col, { flatShading: true }));
        leaf.position.set((i - 1.5) * 0.13, (i % 2) * 0.05, ((i % 3) - 1) * 0.08);
        leaf.scale.set(1, 0.4, 0.8);
        g.add(leaf);
      }
    } else {
      const b1 = cyl(0.055, 0.42, col, 0, 0, 0, g, 10);
      b1.rotation.z = Math.PI / 2;
      const b2 = cyl(0.045, 0.4, col, 0, 0.05, 0.06, g, 10);
      b2.rotation.z = Math.PI / 2;
    }

  /* ── 추가 재료 5종 ── */
  } else if (id === 'crab') {
    for (let i = 0; i < 3; i++) {
      const s = cyl(0.05, 0.42, C.crab, 0, 0, -0.06 + i * 0.06, g, 10);
      s.rotation.z = Math.PI / 2;
      const skin = cyl(0.052, 0.42, C.crabRed, 0, 0.03, 0, s, 10);
      skin.scale.set(1, 1, 0.45);
    }

  } else if (id === 'cucumber') {
    if (st === 'raw') {
      const c = cyl(0.075, 0.5, C.cucumber, 0, 0, 0, g, 12);
      c.rotation.z = Math.PI / 2;
      const skin = cyl(0.078, 0.5, C.cucumberSkin, 0, 0, 0, g, 12);
      skin.rotation.z = Math.PI / 2;
      skin.scale.set(1, 1, 0.55);
    } else {
      for (let i = 0; i < 4; i++) {
        const s = box(0.42, 0.035, 0.035, C.cucumber, 0, 0, -0.06 + i * 0.04, g);
        box(0.42, 0.012, 0.037, C.cucumberSkin, 0, 0.018, 0, s);
      }
    }

  } else if (id === 'egg') {
    if (st === 'raw') {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), mat(0xf6efdc));
      e.scale.set(1, 1.28, 1);
      g.add(e);
    } else {
      for (let i = 0; i < 3; i++) {
        box(0.42, 0.03, 0.09, burnt ? C.burnt : C.eggYolk, 0, i * 0.032, -0.05 + i * 0.05, g);
      }
      if (!burnt) box(0.42, 0.012, 0.28, C.eggWhite, 0, -0.03, 0, g);
    }

  } else if (id === 'carrot') {
    const col = burnt ? C.burnt : C.carrot;
    if (st === 'raw') {
      const c = cyl(0.085, 0.42, col, 0, 0, 0, g, 12, 0.03);
      c.rotation.z = Math.PI / 2;
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(0x4f8f38, { flatShading: true }));
      top.position.set(-0.23, 0.02, 0);
      g.add(top);
    } else {
      for (let i = 0; i < 5; i++) box(0.4, 0.028, 0.028, col, 0, (i % 2) * 0.03, -0.08 + i * 0.04, g);
    }

  } else if (id === 'fishcake') {
    const col = burnt ? C.burnt : (st === 'raw' ? C.fishcake : C.fishcakeDone);
    if (st === 'raw') {
      box(0.4, 0.02, 0.3, col, 0, 0, 0, g).rotation.y = 0.15;
      box(0.4, 0.02, 0.3, col, 0, 0.03, 0.03, g).rotation.y = -0.1;
    } else {
      for (let i = 0; i < 4; i++) {
        const s = box(0.4, 0.03, 0.055, col, 0, 0, -0.07 + i * 0.05, g);
        s.rotation.y = (i % 2 ? 1 : -1) * 0.06;
      }
    }

  } else if (id === 'roll') {
    const r = cyl(0.14, 0.68, C.gim, 0, 0, 0, g, 20);
    r.rotation.z = Math.PI / 2;
    const capL = cyl(0.115, 0.02, C.bap, -0.345, 0, 0, g, 18);
    capL.rotation.z = Math.PI / 2;
    const capR = cyl(0.115, 0.02, C.bap, 0.345, 0, 0, g, 18);
    capR.rotation.z = Math.PI / 2;

  } else if (id === 'gimbap') {
    const plate = cyl(0.34, 0.03, 0xf3efe6, 0, -0.04, 0, g, 22, 0.3);
    plate.userData.noTint = true;
    const fills = (item.fills || []).map((f) => f.id);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(gimbapSlice(Math.cos(a) * 0.17, 0.03, Math.sin(a) * 0.17, fills));
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

/* 속재료별 단면 색 */
const SLICE_COLOR = {
  danmuji: C.danmujiCut, ham: C.hamDone, spinach: C.spinachDone,
  crab: C.crabRed, cucumber: C.cucumber, egg: C.eggYolk,
  carrot: C.carrot, fishcake: C.fishcakeDone
};

/** 김밥 한 조각 — 옆은 김, 위는 밥과 실제로 넣은 속재료 단면 */
function gimbapSlice(x, y, z, fills) {
  const s = new THREE.Group();
  cyl(0.105, 0.11, C.gim, 0, 0, 0, s, 18);
  cyl(0.092, 0.115, C.bap, 0, 0.002, 0, s, 18);
  const list = (fills && fills.length ? fills : ['danmuji', 'ham', 'spinach']).slice(0, 6);
  list.forEach((id, i) => {
    const a = (i / list.length) * Math.PI * 2;
    cyl(0.022, 0.125, SLICE_COLOR[id] || 0xcccccc,
      Math.cos(a) * 0.04, 0.003, Math.sin(a) * 0.04, s, 8);
  });
  s.position.set(x, y, z);
  return s;
}

/* ────────────────────────────────────────────────────────────
   가게 짓기 — x −8..8, z −11..9
   ──────────────────────────────────────────────────────────── */
function buildRoom() {
  scene.background = new THREE.Color(0xbfe0ea);
  scene.add(new THREE.AmbientLight(0xffffff, 1.55));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.35);
  d1.position.set(6, 12, 4);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffeedd, 0.65);
  d2.position.set(-8, 8, -8);
  scene.add(d2);

  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#efece4'; cx.fillRect(0, 0, 64, 64);
  cx.fillStyle = '#ddd8cc'; cx.fillRect(0, 0, 32, 32); cx.fillRect(32, 32, 32, 32);
  cx.strokeStyle = '#c8c2b4'; cx.lineWidth = 2; cx.strokeRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 20);
  tex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -1;
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 20), mat(0xf5f3ee));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 3.4, -1);
  scene.add(ceil);

  const wall = (w, x, z, ry, color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.4), mat(color));
    m.position.set(x, 1.7, z); m.rotation.y = ry; scene.add(m);
  };
  wall(16, 0, 9, Math.PI, 0xe9e3d6);
  wall(16, 0, -11, 0, 0xf0e6d2);
  wall(20, -8, -1, Math.PI / 2, 0xdfe8e2);
  wall(20, 8, -1, -Math.PI / 2, 0xdfe8e2);

  const skirt = (w, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), mat(0xcfe3dc));
    m.position.set(x, 0.6, z); m.rotation.y = ry; scene.add(m);
  };
  skirt(15.9, 0, 8.96, Math.PI);
  skirt(15.9, 0, -10.96, 0);
  skirt(19.9, -7.96, -1, Math.PI / 2);
  skirt(19.9, 7.96, -1, -Math.PI / 2);

  addSolid(0, 9.4, 18, 0.8);
  addSolid(0, -11.4, 18, 0.8);
  addSolid(-8.4, -1, 0.8, 22);
  addSolid(8.4, -1, 0.8, 22);

  const sign = box(4.6, 1.5, 0.1, 0x2c2620, 0, 2.4, 8.9);
  box(4.3, 1.25, 0.02, 0x3a332b, 0, 0, -0.07, sign);
  wallLabel('🍣 김밥지옥', 0.44, 0, 0.36, -0.09, Math.PI, '#f5b942', sign);
  wallLabel('한 줄 한 줄 정성껏', 0.24, 0, -0.14, -0.09, Math.PI, '#e8e0d2', sign);

  const door = box(1.9, 2.3, 0.12, 0x6c93a8, DOOR.x, 1.15, -10.94);
  box(1.5, 1.5, 0.04, 0xd7ecf5, 0, 0.28, 0.07, door);
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
    '⑥ 도마에서 썰고 손님에게!'
  ].forEach((line, i) => {
    wallLabel(line, 0.21, 7.86, 2.48 - i * 0.30, 5.2, -Math.PI / 2, '#f3ead9');
  });
}

/* ──────────────── 바닥 구역 ──────────────── */
/* 바닥 색으로만 구역을 나눈다 — 글로 된 구역 안내는 없앴다.
   그 자리(화면 아래 가운데)는 이제 손에 든 재료의 지시문이 쓴다. */
export const ZONES = [
  { id: 'prep', color: 0x58c07a, rects: [[-7.9, -6.4, -4.4, 8.4]] },
  { id: 'fire', color: 0xe05252, rects: [[4.4, -5.2, 7.9, 2.6]] },
  { id: 'work', color: 0x63a8e8, rects: [[-3.5, -3.0, 3.5, 4.4]] },
  { id: 'pass', color: 0xf5b942, rects: [[-3.5, -6.3, 3.5, -4.6]] }
];

function buildZones() {
  for (const zone of ZONES) {
    for (const [x1, z1, x2, z2] of zone.rects) {
      const w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.13, depthWrite: false })
      );
      fill.rotation.x = -Math.PI / 2;
      fill.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
      scene.add(fill);

      const pts = [
        new THREE.Vector3(x1, 0.02, z1), new THREE.Vector3(x2, 0.02, z1),
        new THREE.Vector3(x2, 0.02, z2), new THREE.Vector3(x1, 0.02, z2),
        new THREE.Vector3(x1, 0.02, z1)
      ];
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.6 })
      ));
    }
  }
}

function counterTop(x, z, w, d, color) {
  box(w, 0.95, d, color || C.counter, x, 0.475, z);
  box(w + 0.06, 0.09, d + 0.06, C.counterTop, x, 0.99, z);
  addSolid(x, z, w, d);
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

  /* 몸통 — 홈이 들어갈 자리는 비워두고 뒤·아래·위만 채운다 */
  const backW = 1.15 - DEPTH;
  box(backW, H, 5.9, C.fridge, back - backW / 2, H / 2, Z);              // 뒤판
  box(1.15, rows[0].floorY, 5.9, C.fridge, X, rows[0].floorY / 2, Z);    // 아래 몸통
  box(1.15, H - topY, 5.9, C.fridge, X, (H + topY) / 2, Z);              // 윗단
  box(DEPTH, BOARD, 5.9, C.fridgeEdge, inX, rows[1].floorY - BOARD / 2, Z);  // 가운데 선반
  addSolid(X, Z, 1.15, 5.9);

  /* 세로 칸막이 6개 — 다섯 칸을 갈라준다 */
  for (let i = 0; i <= 5; i++) {
    box(DEPTH, topY - rows[0].floorY, WALL, C.fridgeEdge,
      inX, (topY + rows[0].floorY) / 2, Z - 2.875 + i * 1.15);
  }

  rows.forEach((r) => r.ids.forEach((id, i) => {
    const z = Z - 2.3 + i * 1.15;
    const y = r.floorY + 0.12;
    const def = ITEMS[id];

    /* 홈 안쪽 벽 — 어두워야 재료가 도드라진다 */
    box(0.03, CUB_H, 1.15 - WALL, C.fridgeIn, back + 0.02, r.floorY + CUB_H / 2, z);

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
  counterTop(X, Z, 1.3, 2.1, 0xc9cfd4);
  const basin = box(0.86, 0.3, 1.3, 0xa9b1b8, X + 0.05, 1.06, Z);
  box(0.72, 0.26, 1.16, 0x8d959c, X + 0.05, 1.1, Z);
  cyl(0.045, 0.5, C.steel, X - 0.4, 1.26, Z, scene, 10);
  const spout = cyl(0.038, 0.42, C.steel, X - 0.22, 1.48, Z, scene, 10);
  spout.rotation.z = Math.PI / 2;

  const water = cyl(0.035, 0.42, C.water, X - 0.02, 1.26, Z, scene, 8);
  water.material.transparent = true; water.material.opacity = 0.55;
  water.visible = false;

  hitProxy(X + 0.4, 1.4, Z, 1.1, 1.0, 1.6, { kind: 'sink' });

  const panel = new Panel(256, 96, 0.8);
  panel.sprite.position.set(X + 0.25, 1.85, Z);
  panel.sprite.visible = false;
  scene.add(panel.sprite);

  labelSprite('🚰 싱크대 — 쌀 씻기', 1.45, 0, scene, '#9fd8ff').sprite.position.set(X + 0.3, 2.2, Z);
  D.sink = { basin, water, panel, riceMesh: null };
}

/* ──────────────── 🍚 밥솥 ×2 ──────────────── */
function buildCookers() {
  const X = -6.7;
  for (let i = 0; i < COOKER_COUNT; i++) {
    const Z = 4.0 + i * 2.4;
    counterTop(X, Z, 1.3, 2.1, 0xd3cdc0);
    const body = cyl(0.36, 0.44, 0xf0eee9, X + 0.05, 1.24, Z, scene, 20);
    const lid = cyl(0.37, 0.12, 0xdcd8d0, 0, 0.27, 0, body, 20);
    cyl(0.07, 0.06, C.steelDark, 0, 0.08, 0, lid, 10);
    const face = box(0.22, 0.16, 0.02, 0x2b2f33, 0, 0.02, 0.36, body);
    box(0.18, 0.1, 0.01, 0x5ad07a, 0, 0, 0.02, face);

    const steam = [];
    for (let s = 0; s < 5; s++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
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
  counterTop(X, Z, 1.3, 6.8, 0x55514b);
  box(1.16, 0.06, 6.6, 0x33302c, X, 1.02, Z);

  BURNERS.forEach((b, i) => {
    const z = -3.8 + i * 1.3;
    const grate = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.026, 6, 16), mat(0x24211e));
    grate.rotation.x = Math.PI / 2;
    grate.position.set(X - 0.05, 1.08, z);
    scene.add(grate);

    const flame = cyl(0.16, 0.14, C.fire, X - 0.05, 1.09, z, scene, 12, 0.04);
    flame.material.transparent = true; flame.material.opacity = 0.85;
    flame.visible = false;

    const vessel = new THREE.Group();
    vessel.position.set(X - 0.05, 1.14, z);
    if (b.kind === 'pot') {
      cyl(0.27, 0.26, C.steel, 0, 0.13, 0, vessel, 20);
      cyl(0.245, 0.24, 0x9aa2a8, 0, 0.14, 0, vessel, 20);
      box(0.08, 0.04, 0.1, C.steelDark, 0.3, 0.2, 0, vessel).userData.noTint = true;
      box(0.08, 0.04, 0.1, C.steelDark, -0.3, 0.2, 0, vessel).userData.noTint = true;
      const w = cyl(0.235, 0.02, C.water, 0, 0.2, 0, vessel, 20);
      w.material.transparent = true; w.material.opacity = 0.6;
      w.userData.noTint = true;
      vessel.userData.water = w;
    } else {
      cyl(0.29, 0.07, 0x2f2c29, 0, 0.035, 0, vessel, 22);
      cyl(0.265, 0.05, 0x413c37, 0, 0.045, 0, vessel, 22);
      const handle = cyl(0.03, 0.42, 0x241f1b, 0, 0.05, 0.42, vessel, 8);
      handle.rotation.x = Math.PI / 2;
      handle.userData.noTint = true;
    }
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
  counterTop(0, Z, 4.4, 1.7, 0xd9c7a8);

  for (let i = 0; i < BOARD_COUNT; i++) {
    const x = -1.4 + i * 1.4;
    box(1.05, 0.07, 0.85, C.wood, x, 1.06, Z);
    box(1.0, 0.01, 0.8, 0xe2bc84, x, 1.1, Z);

    const knife = new THREE.Group();
    box(0.06, 0.02, 0.42, 0xd8dde1, 0, 0, 0, knife);
    box(0.05, 0.045, 0.16, 0x2f2a25, 0, 0, 0.29, knife);
    knife.position.set(x + 0.42, 1.14, Z);
    scene.add(knife);

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
  counterTop(0, Z, 5.2, 1.7, 0xe0c79a);

  for (let i = 0; i < MAT_COUNT; i++) {
    const X = -1.6 + i * 1.6;

    const group = new THREE.Group();
    group.position.set(X, 1.05, Z);
    for (let s = 0; s < 12; s++) {
      const stick = cyl(0.026, 0.72, 0xc99a52, -0.33 + s * 0.06, 0, 0, group, 8);
      stick.rotation.x = Math.PI / 2;
    }
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
  cyl(0.42, 0.9, 0x3f7a4a, X, 0.45, Z, scene, 16);
  cyl(0.45, 0.08, 0x2f5c38, X, 0.94, Z, scene, 16);
  cyl(0.2, 0.06, 0x24472b, X, 0.99, Z, scene, 12);
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
  counterTop(0, SERVE_Z, 7.0, 0.9, 0xd98b3f);

  for (const side of [-1, 1]) {
    const x = side * 5.55;
    box(4.1, 1.55, 0.5, 0xcf9a58, x, 0.78, SERVE_Z);
    box(4.16, 0.08, 0.58, C.counterTop, x, 1.57, SERVE_Z);
    addSolid(x, SERVE_Z, 4.1, 0.5);
  }

  box(1.4, 0.06, 0.7, 0xf0ece2, 1.8, 1.05, SERVE_Z);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe8c14a));
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
  const k = new THREE.Group();
  k.position.set(KIOSK.x, 0, KIOSK.z);
  box(0.7, 1.25, 0.45, 0x2f3338, 0, 0.62, 0, k);
  const screen = box(0.62, 0.72, 0.06, 0x1b7fa8, 0, 1.42, 0.06, k);
  screen.rotation.x = -0.24;
  box(0.54, 0.6, 0.02, 0x63d0f0, 0, 0, 0.05, screen);
  box(0.8, 0.06, 0.55, 0x3c4247, 0, 1.02, 0, k);
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
    d.riceMesh.position.set(d.basin.position.x, 1.1, d.basin.position.z);
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
      d.mesh = makeItemMesh({ id: info.cell.id, stage: 'raw' });
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
        m.fills.forEach((f, j) => {
          const g = makeItemMesh({ id: f.id, stage: 'done' });
          g.position.set(0, 0, -0.16 + j * 0.055);
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

function makeOutline(parent) {
  // depthTest 는 반드시 켠 채로 둔다. 볼록 셸의 BackSide 는 실루엣 전체를 덮으므로
  // 깊이 검사를 끄면 테두리가 아니라 손님이 통째로 단색 덩어리가 되고 벽까지 뚫는다.
  const skin = () => new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR, side: THREE.BackSide,
    transparent: true, opacity: 0.9, depthWrite: false
  });
  const g = new THREE.Group();

  // 몸통·머리가 재질을 따로 갖는다 — 손님이 나갈 때 disposeObject 가 같은 걸 두 번 놓지 않게
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.0, 14), skin());
  body.position.y = 0.5;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), skin());
  head.position.y = 1.26;

  g.add(body, head);
  g.visible = false;
  parent.add(g);
  return { group: g, body, head };
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
  g.position.set(0, 2.14, 0.33);
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
  const g = new THREE.Group();
  cyl(0.3, 1.0, info.color, 0, 0.5, 0, g, 14);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), mat(0xf6d9b0));
  head.position.y = 1.26;
  g.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat(0x222));
  eye.position.set(-0.09, 1.3, 0.23); g.add(eye);
  const eye2 = eye.clone(); eye2.position.x = 0.09; g.add(eye2);
  // 아바타는 얼굴이 로컬 +z 를 향한다. 손님은 카운터(자기보다 +z 쪽)를 본다.
  g.rotation.y = 0;

  const name = fittedPanel(info.emoji + ' ' + info.name, 1.0, false);
  name.text(info.emoji + ' ' + info.name,
    { color: info.kind === KIND.COUNTER ? '#ff9b9b' : '#cfe9f5' });
  name.sprite.position.set(0, 2.36, 0);
  g.add(name.sprite);

  const order = new Panel(384, 132, 1.5, false);
  order.sprite.position.set(0, 1.86, 0);
  g.add(order.sprite);

  // 조준용 히트박스 — 이 손님을 겨냥해 서빙한다
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 1.75, 0.95),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hit.position.y = 0.9;
  hit.renderOrder = -1;
  hit.userData.station = { kind: 'customer', id: info.id };
  g.add(hit);
  interactables.push(hit);

  const bubble = new Panel(320, 76, 1.35, false);
  bubble.sprite.position.set(0, 2.72, 0);
  bubble.sprite.visible = false;
  g.add(bubble.sprite);

  const hpMax = info.hpMax || CUSTOMER_HP[info.kind === KIND.COUNTER ? 'special' : 'normal'] || 3;
  const hp = makeHpBar(hpMax, g);
  const outline = makeOutline(g);

  scene.add(g);
  return { group: g, name, order, bubble, hit, hp, outline, body: g.children[0],
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
    d.group.position.y = pos.walking ? Math.abs(Math.sin(t / 110)) * 0.06 : 0;

    const leaving = c.state === 'happy' || c.state === 'angry' || c.state === 'kicked';
    d.group.rotation.y = leaving ? Math.PI : 0;
    if (d.body) d.body.material.emissive.setHex(flinch > 0 ? 0x882020 : 0x000000);

    /* 🎯 내가 든 김밥과 제일 잘 맞는 손님만 테두리를 두른다.
       동점이 여럿이면 전부 켜되, 실제로 나갈 한 명만 밝게 숨쉰다. */
    const lit = c.state === 'wait' && focus.outline.has(c.id);
    d.outline.group.visible = lit;
    if (lit) {
      const far = Math.hypot(pos.x - camera.position.x, pos.z - camera.position.z);
      const o = c.id === focus.focusId ? glow : OUTLINE_TIE;
      d.outline.body.material.opacity = o;
      d.outline.head.material.opacity = o;
      const bs = rimScale(kk, far, 0.3, 1.40);
      d.outline.body.scale.set(bs, 1.05, bs);    // y 는 1.05 고정 — 1.0 이면 어깨 테두리가 끊긴다
      d.outline.head.scale.setScalar(rimScale(kk, far, 0.26, 1.28));
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
        d.bubble.sprite.position.y = 2.72 + Math.sin(t / 420) * 0.03;
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
function makeAvatar(name, color) {
  const g = new THREE.Group();
  cyl(0.3, 1.0, new THREE.Color(color).getHex(), 0, 0.5, 0, g, 14);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), mat(0xf6d9b0));
  head.position.y = 1.26; g.add(head);
  cyl(0.28, 0.09, 0xffffff, 0, 1.46, 0, g, 14);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), mat(0x222));
  eye.position.set(-0.09, 1.3, 0.23); g.add(eye);
  const eye2 = eye.clone(); eye2.position.x = 0.09; g.add(eye2);
  const p = fittedPanel(name, 1.5, false);
  p.text(name, { color: '#fff' });
  p.sprite.position.y = 1.85;
  g.add(p.sprite);
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
      av = makeAvatar(info ? info.name : '알바', info ? info.color : '#f5b942');
      D.remotes.set(pos.id, av);
    }
    /* 보간이 이미 부드러우므로 그대로 놓는다.
       여기서 또 감쇠를 걸면 두 번 늦어지고 방향 전환이 뭉개진다. */
    av.position.set(pos.x, pos.y || 0, pos.z);
    av.rotation.y = pos.ry + Math.PI;

    const holding = handOf(pos.id);
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
          m.position.set(0.3, 1.05, 0.28);
          m.rotation.set(0, 0, Math.PI - 0.45);
          m.scale.setScalar(0.9);
        } else {
          m.position.set(0, 0.95, 0.45);
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
  resize();
  window.addEventListener('resize', resize);

  camera.position.set(0, 1.62, 6);
  scene.add(camera);

  buildRoom();
  buildZones();
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
