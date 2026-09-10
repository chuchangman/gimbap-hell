/* ────────────────────────────────────────────────────────────
   캐릭터 꾸미기 — 입장 화면

   캐릭터를 고른다. 고른 값은 작은 정수 인덱스뿐이라
   방에 들어갈 때 함께 보내고, 서버가 잘라낸 뒤 모두에게 뿌린다.

   미리보기는 게임과 다른 작은 캔버스에 따로 그린다.
   world.js 의 makeBody / applyLook 을 그대로 쓰므로
   여기서 보이는 모습이 실제 게임에서 보일 모습과 같다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from '/vendor/three.module.min.js';
import { PARTS, PART_COLORS, DEFAULT_LOOK, sanitizeLook } from './config.js';
import { previewBody, animatePreviewBody, disposePreviewBody } from './world.js';

const STORE_KEY = 'gimbap:look';

let look = Object.assign({}, DEFAULT_LOOK);
let renderer, scene, cam, model, raf = 0, resizeObserver;
let yaw = 0.22, walking = false, dragX = null;

/** 지난번에 고른 조합을 되살린다. 안 되면 기본값 */
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) look = sanitizeLook(JSON.parse(raw));
  } catch (err) { /* 저장이 막힌 브라우저 — 기본값으로 간다 */ }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(look)); } catch (err) { /* 무시 */ }
}

/* ──────────────── 미리보기 ──────────────── */

function initPreview(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 280, canvas.clientHeight || 376, false);
  /* 게임과 같은 톤매핑·노출을 쓴다. 안 맞추면 여기서 고른 색이
     실제로는 다르게 보여서 고르는 의미가 없어진다. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.90));
  const a = new THREE.DirectionalLight(0xfff7e9, 1.45); a.position.set(3, 6, 5); scene.add(a);
  const b = new THREE.DirectionalLight(0xddeeff, 0.42); b.position.set(-4, 3, -3); scene.add(b);
  const c = new THREE.DirectionalLight(0xfff1d6, 0.18); c.position.set(-1, -3, 2); scene.add(c);

  /* PEAK 계열의 캐릭터는 머리뿐 아니라 짧은 팔다리와 큰 신발이 실루엣의
     절반이다. 전신을 보여줘야 고른 상의와 몸 비율을 게임에 들어가기 전에
     확인할 수 있다. */
  cam = new THREE.OrthographicCamera(-0.66, 0.66, 1.25, -1.25, 0.1, 20);
  cam.position.set(0, 1.22, 4);
  cam.lookAt(0, 1.22, 0);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(.59, .62, .055, 48),
    new THREE.MeshStandardMaterial({ color: 0xd5c4a6, roughness: .9 }));
  stand.position.y = -.036;
  scene.add(stand);
  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !canvas.clientWidth || !canvas.clientHeight) return;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    fitPreview();
  });
  resizeObserver.observe(canvas);

  canvas.addEventListener('pointerdown', (event) => {
    dragX = event.clientX; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragX === null) return;
    yaw += (event.clientX - dragX) * .012; dragX = event.clientX;
  });
  const endDrag = () => { dragX = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('keydown', (event) => {
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
    event.preventDefault(); yaw += event.code === 'ArrowLeft' ? -.25 : .25;
  });
}

/** 큰 모자나 게 후드도 잘리지 않도록 현재 조합의 실제 크기로 카메라를 맞춘다. */
function fitPreview() {
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
  cam.left = -halfW; cam.right = halfW;
  cam.top = halfH; cam.bottom = -halfH;
  cam.position.set(center.x, center.y, 4);
  cam.lookAt(center.x, center.y, 0);
  cam.updateProjectionMatrix();
}

function rebuild() {
  if (!renderer || !scene) return;
  if (model) { scene.remove(model); disposePreviewBody(model); model = null; }
  model = previewBody(look);
  scene.add(model);
  fitPreview();
}

function loop(time = 0) {
  raf = requestAnimationFrame(loop);
  if (!document.getElementById('screen-join').classList.contains('active')) return;
  if (model) {
    model.rotation.y = yaw;
    animatePreviewBody(model, time / 1000, walking);
  }
  renderer.render(scene, cam);
}

/* ──────────────── 조작 ──────────────── */

const KEY = { hair: 'h', face: 'f', top: 't', bottom: 'b', expression: 'e' };
const COLOR_KEY = { hair: 'hc', top: 'tc', bottom: 'bc', skin: 'sc', shoes: 'shc' };

function paint(root) {
  for (const row of root.querySelectorAll('.cz-row')) {
    const part = row.dataset.part;
    row.querySelector('.cz-name').textContent = PARTS[part][look[KEY[part]]].name;
  }
  for (const box of root.querySelectorAll('.cz-swatches')) {
    const part = box.dataset.swatch;
    const sel = look[COLOR_KEY[part]];
    [...box.children].forEach((sw, i) =>
      sw.setAttribute('aria-pressed', String(i === sel)));
  }
  rebuild();
  save();
}

function buildSwatches(root) {
  for (const box of root.querySelectorAll('.cz-swatches')) {
    const part = box.dataset.swatch;
    box.textContent = '';
    PART_COLORS[part].forEach((hex, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cz-sw';
      b.style.background = '#' + hex.toString(16).padStart(6, '0');
      const label = { hair: '머리색 ', bottom: '하의색 ', top: '상의색 ', skin: '피부색 ', shoes: '신발색 ' }[part];
      b.title = label + (i + 1);
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => { look[COLOR_KEY[part]] = i; paint(root); });
      box.appendChild(b);
    });
  }
}

/** 입장 화면이 뜰 때 한 번 부른다 */
export function initCustomizer() {
  const root = document.querySelector('.customize');
  const canvas = document.getElementById('cz-canvas');
  if (!root || !canvas) return;

  loadSaved();
  try {
    initPreview(canvas);
  } catch (err) {
    // WebGL 문맥을 두 개 못 여는 환경 — 미리보기만 접고 고르기는 계속 되게 둔다
    console.warn('[customize] 미리보기를 못 켰다', err);
    const box = root.querySelector('.cz-preview');
    if (box) box.style.display = 'none';
  }

  for (const row of root.querySelectorAll('.cz-row')) {
    const part = row.dataset.part;
    const list = PARTS[part];
    for (const btn of row.querySelectorAll('.cz-arrow')) {
      btn.type = 'button';
      btn.setAttribute('aria-label', row.querySelector('.cz-label').textContent + (Number(btn.dataset.d) < 0 ? ' 이전' : ' 다음'));
      btn.addEventListener('click', () => {
        const d = Number(btn.dataset.d);
        look[KEY[part]] = (look[KEY[part]] + d + list.length) % list.length;
        paint(root);
      });
    }
  }
  buildSwatches(root);

  const rnd = document.getElementById('cz-random');
  if (rnd) {
    rnd.type = 'button';
    rnd.addEventListener('click', () => {
      const pick = (n) => Math.floor(Math.random() * n);
      look = {
        h: pick(PARTS.hair.length), hc: pick(PART_COLORS.hair.length),
        f: pick(PARTS.face.length),
        t: pick(PARTS.top.length),  tc: pick(PART_COLORS.top.length),
        b: pick(PARTS.bottom.length), bc: pick(PART_COLORS.bottom.length),
        e: pick(PARTS.expression.length),
        sc: pick(PART_COLORS.skin.length), shc: pick(PART_COLORS.shoes.length)
      };
      paint(root);
    });
  }

  document.getElementById('cz-reset').addEventListener('click', () => {
    look = { ...DEFAULT_LOOK }; yaw = .22; paint(root);
  });
  document.getElementById('cz-turn').addEventListener('click', () => { yaw += Math.PI / 2; });
  document.getElementById('cz-front').addEventListener('click', () => { yaw = 0; });
  document.getElementById('cz-walk').addEventListener('click', (event) => {
    walking = !walking;
    event.currentTarget.setAttribute('aria-pressed', String(walking));
  });

  paint(root);
  if (renderer) loop();
}

/** 방에 들어갈 때 함께 보낼 값 */
export function currentLook() { return Object.assign({}, look); }

/** 게임이 시작되면 미리보기를 접는다 — WebGL 문맥을 붙들고 있을 이유가 없다 */
export function stopCustomizer() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (renderer) { renderer.dispose(); renderer = null; }
  resizeObserver?.disconnect();
  if (model) { disposePreviewBody(model); model = null; }
}
