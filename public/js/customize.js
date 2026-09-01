/* ────────────────────────────────────────────────────────────
   캐릭터 꾸미기 — 입장 화면

   머리카락·얼굴·상의를 고른다. 고른 값은 인덱스 다섯 개뿐이라
   방에 들어갈 때 함께 보내고, 서버가 잘라낸 뒤 모두에게 뿌린다.

   미리보기는 게임과 다른 작은 캔버스에 따로 그린다.
   world.js 의 makeBody / applyLook 을 그대로 쓰므로
   여기서 보이는 모습이 실제 게임에서 보일 모습과 같다.
   ──────────────────────────────────────────────────────────── */
import * as THREE from '/vendor/three.module.min.js';
import { PARTS, PART_COLORS, DEFAULT_LOOK, sanitizeLook } from './config.js';
import { previewBody } from './world.js';

const STORE_KEY = 'gimbap:look';

let look = Object.assign({}, DEFAULT_LOOK);
let renderer, scene, cam, model, spin = 0, raf = 0;

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
  renderer.setSize(canvas.clientWidth || 112, canvas.clientHeight || 150, false);
  /* 게임과 같은 톤매핑·노출을 쓴다. 안 맞추면 여기서 고른 색이
     실제로는 다르게 보여서 고르는 의미가 없어진다. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.90));
  const a = new THREE.DirectionalLight(0xfff7e9, 1.45); a.position.set(3, 6, 5); scene.add(a);
  const b = new THREE.DirectionalLight(0xddeeff, 0.42); b.position.set(-4, 3, -3); scene.add(b);
  const c = new THREE.DirectionalLight(0xfff1d6, 0.18); c.position.set(-1, -3, 2); scene.add(c);

  /* 얼굴이 잘 보이게 가슴 위쪽을 잡는다.
     몸이 눈높이(1.82)에 맞춰 커졌으므로 프레임도 같이 올린다 — 안 그러면 머리가 잘린다. */
  cam = new THREE.OrthographicCamera(-0.47, 0.47, 0.60, -0.55, 0.1, 20);
  cam.position.set(0, 1.65, 4);
  cam.lookAt(0, 1.65, 0);
}

function rebuild() {
  if (model) { scene.remove(model); model = null; }
  model = previewBody(look);
  scene.add(model);
}

function loop() {
  raf = requestAnimationFrame(loop);
  spin += 0.006;
  if (model) model.rotation.y = Math.sin(spin) * 0.45;   // 좌우로 천천히 돌아본다
  renderer.render(scene, cam);
}

/* ──────────────── 조작 ──────────────── */

const KEY = { hair: 'h', face: 'f', top: 't' };
const COLOR_KEY = { hair: 'hc', top: 'tc' };

function paint(root) {
  for (const row of root.querySelectorAll('.cz-row')) {
    const part = row.dataset.part;
    row.querySelector('.cz-name').textContent = PARTS[part][look[KEY[part]]].name;
  }
  for (const box of root.querySelectorAll('.cz-swatches')) {
    const part = box.dataset.swatch;
    const sel = look[COLOR_KEY[part]];
    [...box.children].forEach((sw, i) =>
      sw.setAttribute('aria-selected', String(i === sel)));
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
      b.title = (part === 'hair' ? '머리색 ' : '상의색 ') + (i + 1);
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
        t: pick(PARTS.top.length),  tc: pick(PART_COLORS.top.length)
      };
      paint(root);
    });
  }

  paint(root);
  if (renderer) loop();
}

/** 방에 들어갈 때 함께 보낼 값 */
export function currentLook() { return Object.assign({}, look); }

/** 게임이 시작되면 미리보기를 접는다 — WebGL 문맥을 붙들고 있을 이유가 없다 */
export function stopCustomizer() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (renderer) { renderer.dispose(); renderer = null; }
}
