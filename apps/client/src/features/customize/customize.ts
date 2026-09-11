/* ────────────────────────────────────────────────────────────
   캐릭터 꾸미기 — 입장 화면

   캐릭터를 고른다. 고른 값은 작은 정수 인덱스뿐이라
   방에 들어갈 때 함께 보내고, 서버가 잘라낸 뒤 모두에게 뿌린다.

   미리보기는 게임과 다른 작은 캔버스에 따로 그린다.
   character.ts 의 makeBody / applyLook 을 그대로 쓰므로
   여기서 보이는 모습이 실제 게임에서 보일 모습과 같다.

   레거시 customize.js 를 그대로 옮겼다. DOM 은 React 가 그리고
   (입장 화면 컴포넌트), 이 모듈은 그 위에서 값을 칠한다 —
   3D 미리보기가 three 명령형 코드라 R3F 로 다시 짜면 화면이 달라진다.
   ──────────────────────────────────────────────────────────── */
import { PATHS, RENDER } from '@/config';
import { animatePreviewBody, disposePreviewBody, previewBody } from '@/features/world/character';
import {
  DEFAULT_LOOK,
  type Look,
  PART_COLORS,
  PARTS,
  type PartSlot,
  sanitizeLook,
} from '@repo/game-core';
import * as THREE from 'three';

const STORE_KEY = PATHS.lookStore;

type ColorSlot = keyof typeof PART_COLORS;

let look: Look = Object.assign({}, DEFAULT_LOOK);
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let cam: THREE.OrthographicCamera | null = null;
let model: THREE.Group | null = null;
let raf = 0;
let resizeObserver: ResizeObserver | undefined;
let yaw = 0.22;
let walking = false;
let dragX: number | null = null;

/** 지난번에 고른 조합을 되살린다. 안 되면 기본값 */
function loadSaved(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) look = sanitizeLook(JSON.parse(raw));
  } catch {
    /* 저장이 막힌 브라우저 — 기본값으로 간다 */
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(look));
  } catch {
    /* 무시 */
  }
}

/* ──────────────── 미리보기 ──────────────── */

function initPreview(canvas: HTMLCanvasElement): void {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatioCap));
  renderer.setSize(canvas.clientWidth || 280, canvas.clientHeight || 376, false);
  /* 게임과 같은 톤매핑·노출을 쓴다. 안 맞추면 여기서 고른 색이
     실제로는 다르게 보여서 고르는 의미가 없어진다. */
  renderer.toneMapping = RENDER.toneMapping;
  renderer.toneMappingExposure = RENDER.toneMappingExposure;

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const a = new THREE.DirectionalLight(0xfff7e9, 1.45);
  a.position.set(3, 6, 5);
  scene.add(a);
  const b = new THREE.DirectionalLight(0xddeeff, 0.42);
  b.position.set(-4, 3, -3);
  scene.add(b);
  const c = new THREE.DirectionalLight(0xfff1d6, 0.18);
  c.position.set(-1, -3, 2);
  scene.add(c);

  /* PEAK 계열의 캐릭터는 머리뿐 아니라 짧은 팔다리와 큰 신발이 실루엣의
     절반이다. 전신을 보여줘야 고른 상의와 몸 비율을 게임에 들어가기 전에
     확인할 수 있다. */
  cam = new THREE.OrthographicCamera(-0.66, 0.66, 1.25, -1.25, 0.1, 20);
  cam.position.set(0, 1.22, 4);
  cam.lookAt(0, 1.22, 0);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.59, 0.62, 0.055, 48),
    new THREE.MeshStandardMaterial({ color: 0xd5c4a6, roughness: 0.9 }),
  );
  stand.position.y = -0.036;
  scene.add(stand);
  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !canvas.clientWidth || !canvas.clientHeight) return;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    fitPreview();
  });
  resizeObserver.observe(canvas);
}

/* 캔버스 조작은 렌더러와 수명이 다르다 — 미리보기를 껐다 켜도 한 번만 붙인다.
   다시 붙이면 드래그 한 번에 yaw 가 두 배로 돈다. */
function wireCanvas(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('pointerdown', (event) => {
    dragX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragX === null) return;
    yaw += (event.clientX - dragX) * 0.012;
    dragX = event.clientX;
  });
  const endDrag = (): void => {
    dragX = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('keydown', (event) => {
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
    event.preventDefault();
    yaw += event.code === 'ArrowLeft' ? -0.25 : 0.25;
  });
}

/** 큰 모자나 게 후드도 잘리지 않도록 현재 조합의 실제 크기로 카메라를 맞춘다. */
function fitPreview(): void {
  if (!model || !cam || !renderer) return;
  const rotation = model.rotation.y;
  model.rotation.y = 0;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  model.rotation.y = rotation;
  const canvas = renderer.domElement;
  const aspect = Math.max(0.4, (canvas.clientWidth || 280) / (canvas.clientHeight || 376));
  // 기본 몸은 너무 작아지지 않게 하고, 큰 파츠가 붙었을 때만 필요한 만큼 물러난다.
  const height = Math.max(2.52, size.y + 0.24, Math.max(size.x, size.z) / aspect + 0.24);
  const halfH = height / 2;
  const halfW = halfH * aspect;
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfH;
  cam.bottom = -halfH;
  cam.position.set(center.x, center.y, 4);
  cam.lookAt(center.x, center.y, 0);
  cam.updateProjectionMatrix();
}

function rebuild(): void {
  if (!renderer || !scene) return;
  if (model) {
    scene.remove(model);
    disposePreviewBody(model);
    model = null;
  }
  model = previewBody(look);
  scene.add(model);
  fitPreview();
}

function loop(time = 0): void {
  raf = requestAnimationFrame(loop);
  if (!document.getElementById('screen-join')!.classList.contains('active')) return;
  if (model) {
    model.rotation.y = yaw;
    animatePreviewBody(model, time / 1000, walking);
  }
  renderer!.render(scene!, cam!);
}

/* ──────────────── 조작 ──────────────── */

const KEY: Record<PartSlot, keyof Look> = {
  hair: 'h',
  face: 'f',
  top: 't',
  bottom: 'b',
  expression: 'e',
};
const COLOR_KEY: Record<ColorSlot, keyof Look> = {
  hair: 'hc',
  top: 'tc',
  bottom: 'bc',
  skin: 'sc',
  shoes: 'shc',
};

function paint(root: Element): void {
  for (const row of root.querySelectorAll<HTMLElement>('.cz-row')) {
    const part = row.dataset.part as PartSlot;
    row.querySelector('.cz-name')!.textContent = PARTS[part][look[KEY[part]]].name;
  }
  for (const box of root.querySelectorAll<HTMLElement>('.cz-swatches')) {
    const part = box.dataset.swatch as ColorSlot;
    const sel = look[COLOR_KEY[part]];
    [...box.children].forEach((sw, i) => sw.setAttribute('aria-pressed', String(i === sel)));
  }
  rebuild();
  save();
}

const SWATCH_LABEL: Record<ColorSlot, string> = {
  hair: '머리색 ',
  bottom: '하의색 ',
  top: '상의색 ',
  skin: '피부색 ',
  shoes: '신발색 ',
};

function buildSwatches(root: Element): void {
  for (const box of root.querySelectorAll<HTMLElement>('.cz-swatches')) {
    const part = box.dataset.swatch as ColorSlot;
    box.textContent = '';
    PART_COLORS[part].forEach((hex, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-sw';
      b.style.background = '#' + hex.toString(16).padStart(6, '0');
      const label = SWATCH_LABEL[part];
      b.title = label + (i + 1);
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => {
        look[COLOR_KEY[part]] = i;
        paint(root);
      });
      box.appendChild(b);
    });
  }
}

/** 미리보기를 켠다. WebGL 을 못 열면 미리보기만 접고 고르기는 계속 되게 둔다 */
function openPreview(root: Element, canvas: HTMLCanvasElement): void {
  if (renderer) return;
  try {
    initPreview(canvas);
  } catch (err) {
    // WebGL 문맥을 두 개 못 여는 환경
    console.warn('[customize] 미리보기를 못 켰다', err);
    const box = root.querySelector<HTMLElement>('.cz-preview');
    if (box) box.style.display = 'none';
  }
}

/** 리스너를 한 번만 붙였는지 — 입장 화면으로 돌아올 때 두 벌이 되면 안 된다 */
let wired = false;

/** 입장 화면이 뜰 때 한 번 부른다 */
export function initCustomizer(): void {
  const root = document.querySelector('.customize');
  const canvas = document.getElementById('cz-canvas') as HTMLCanvasElement | null;
  if (!root || !canvas) return;

  loadSaved();
  openPreview(root, canvas);
  if (wired) {
    paint(root);
    if (renderer) loop();
    return;
  }
  wired = true;
  wireCanvas(canvas);

  for (const row of root.querySelectorAll<HTMLElement>('.cz-row')) {
    const part = row.dataset.part as PartSlot;
    const list = PARTS[part];
    for (const btn of row.querySelectorAll<HTMLButtonElement>('.cz-arrow')) {
      btn.type = 'button';
      btn.setAttribute(
        'aria-label',
        row.querySelector('.cz-label')!.textContent +
          (Number(btn.dataset.d) < 0 ? ' 이전' : ' 다음'),
      );
      btn.addEventListener('click', () => {
        const d = Number(btn.dataset.d);
        look[KEY[part]] = (look[KEY[part]] + d + list.length) % list.length;
        paint(root);
      });
    }
  }
  buildSwatches(root);

  const rnd = document.getElementById('cz-random') as HTMLButtonElement | null;
  if (rnd) {
    rnd.type = 'button';
    rnd.addEventListener('click', () => {
      const pick = (n: number): number => Math.floor(Math.random() * n);
      look = {
        h: pick(PARTS.hair.length),
        hc: pick(PART_COLORS.hair.length),
        f: pick(PARTS.face.length),
        t: pick(PARTS.top.length),
        tc: pick(PART_COLORS.top.length),
        b: pick(PARTS.bottom.length),
        bc: pick(PART_COLORS.bottom.length),
        e: pick(PARTS.expression.length),
        sc: pick(PART_COLORS.skin.length),
        shc: pick(PART_COLORS.shoes.length),
      };
      paint(root);
    });
  }

  document.getElementById('cz-reset')!.addEventListener('click', () => {
    look = { ...DEFAULT_LOOK };
    yaw = 0.22;
    paint(root);
  });
  document.getElementById('cz-turn')!.addEventListener('click', () => {
    yaw += Math.PI / 2;
  });
  document.getElementById('cz-front')!.addEventListener('click', () => {
    yaw = 0;
  });
  document.getElementById('cz-walk')!.addEventListener('click', (event) => {
    walking = !walking;
    (event.currentTarget as Element).setAttribute('aria-pressed', String(walking));
  });

  paint(root);
  if (renderer) loop();
}

/** 방에 들어갈 때 함께 보낼 값 */
export function currentLook(): Look {
  return Object.assign({}, look);
}

/** 입장 화면으로 돌아왔을 때 미리보기를 다시 켠다 (한 번 켠 적이 있을 때만) */
export function resumeCustomizer(): void {
  if (!wired || renderer) return;
  const root = document.querySelector('.customize');
  const canvas = document.getElementById('cz-canvas') as HTMLCanvasElement | null;
  if (!root || !canvas) return;
  openPreview(root, canvas);
  paint(root);
  if (renderer) loop();
}

/** 게임이 시작되면 미리보기를 접는다 — WebGL 문맥을 붙들고 있을 이유가 없다 */
export function stopCustomizer(): void {
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  resizeObserver?.disconnect();
  if (model) {
    disposePreviewBody(model);
    model = null;
  }
}
