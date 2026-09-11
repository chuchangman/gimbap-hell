import type * as THREE from 'three';
/* 레거시 index.html 을 문자열로 그대로 읽어 온다 (Vite 의 ?raw).
   node:fs 로 읽으면 브라우저용 tsconfig 에 node 타입을 끌어와야 한다. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import INDEX_HTML from '../../../../../legacy/public/index.html?raw';

/* ────────────────────────────────────────────────────────────
   캐릭터 꾸미기 동등성 검사

   입장 화면의 미리보기는 눈으로 보고 고르는 화면이라, 레거시와
   "같은 조작 → 같은 모습" 이 아니면 이식이 끝난 게 아니다.
   그래서 레거시 index.html 의 실제 마크업을 그대로 읽어 심고,
   같은 클릭·드래그·키 순서를 두 구현에 차례로 먹인 뒤
   (1) 렌더러에 넘어온 씬을 정점까지, (2) 카메라 투영을,
   (3) 칠해진 DOM 을, (4) localStorage 에 저장된 값을 통째로 비교한다.

   두 구현은 같은 element id 를 잡으므로 동시에 못 띄운다 — 차례로 돌린다.
   ──────────────────────────────────────────────────────────── */

/** 렌더러가 받은 프레임을 모은다. 미리보기 씬을 꺼낼 유일한 통로다. */
const rec = vi.hoisted(() => ({
  frames: [] as Array<{ scene: unknown; cam: unknown }>,
  disposed: 0,
  /** WebGL 문맥을 못 여는 환경을 흉내 낼 때 켠다 */
  throwOnCreate: false,
}));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeRenderer {
    domElement: HTMLCanvasElement;
    toneMapping = 0;
    toneMappingExposure = 1;
    constructor(p: { canvas: HTMLCanvasElement }) {
      if (rec.throwOnCreate) throw new Error('WebGL 문맥을 못 연다');
      this.domElement = p.canvas;
    }
    setPixelRatio(): void {}
    setSize(): void {}
    render(scene: unknown, cam: unknown): void {
      rec.frames.push({ scene, cam });
    }
    dispose(): void {
      rec.disposed++;
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

const legacyMod = await import('@legacy/customize.js');
const portMod = await import('@/features/customize/customize');
const { describeObject, firstDifference } = await import('@/testing/mesh-snapshot');
const { DEFAULT_LOOK } = await import('@repo/game-core');

interface Customizer {
  initCustomizer(): void;
  currentLook(): unknown;
  stopCustomizer(): void;
}

/* ──────────────── 무대 ──────────────── */

/** 레거시 index.html 의 `.customize` 를 그대로 쓴다 — 손으로 옮겨 적으면 검사가 무의미하다 */
const CUSTOMIZE_MARKUP = (() => {
  const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
  const node = doc.querySelector('#screen-join .customize');
  if (!node) throw new Error('index.html 에서 .customize 를 못 찾았다');
  return node.outerHTML;
})();

let pendingFrame: FrameRequestCallback | null = null;
let rafSeq = 0;
const cancelled: number[] = [];
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  pendingFrame = cb;
  return ++rafSeq;
});
vi.stubGlobal('cancelAnimationFrame', (id: number) => {
  cancelled.push(id);
  pendingFrame = null;
});
/* jsdom 에 ResizeObserver 가 없다. 없으면 initPreview 가 던지고 두 구현이
   나란히 "미리보기 없음" 으로 빠져 비교가 텅 빈다 — 그래서 채워 둔다. */
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

function mountStage(): { root: HTMLElement; canvas: HTMLCanvasElement } {
  document.body.innerHTML =
    '<section id="screen-join" class="screen solid active scrollable">' +
    CUSTOMIZE_MARKUP +
    '</section>';
  const root = document.querySelector('.customize') as HTMLElement;
  const canvas = document.getElementById('cz-canvas') as HTMLCanvasElement;
  // jsdom 의 포인터 캡처는 실제 포인터가 없으면 던진다 — 드래그 경로를 막지 않게 비운다
  canvas.setPointerCapture = (): void => {};
  canvas.releasePointerCapture = (): void => {};
  return { root, canvas };
}

/* ──────────────── 조작 대본 ──────────────── */

const arrow = (root: HTMLElement, part: string, d: -1 | 1): void =>
  root
    .querySelector<HTMLButtonElement>(`.cz-row[data-part="${part}"] .cz-arrow[data-d="${d}"]`)!
    .click();

const swatch = (root: HTMLElement, part: string, i: number): void =>
  (
    root.querySelectorAll<HTMLButtonElement>(`.cz-swatches[data-swatch="${part}"] .cz-sw`)[
      i
    ] as HTMLButtonElement
  ).click();

const press = (id: string): void => (document.getElementById(id) as HTMLButtonElement).click();

interface Step {
  name: string;
  run: (root: HTMLElement, canvas: HTMLCanvasElement) => void;
}

const STEPS: Step[] = [
  { name: '머리 +3', run: (r) => [0, 1, 2].forEach(() => arrow(r, 'hair', 1)) },
  { name: '머리 -1', run: (r) => arrow(r, 'hair', -1) },
  { name: '얼굴 +1', run: (r) => arrow(r, 'face', 1) },
  { name: '표정 +2', run: (r) => [0, 1].forEach(() => arrow(r, 'expression', 1)) },
  { name: '표정 -1 (되감기)', run: (r) => arrow(r, 'expression', -1) },
  { name: '상의 +1', run: (r) => arrow(r, 'top', 1) },
  { name: '하의 -1 (음수 순환)', run: (r) => arrow(r, 'bottom', -1) },
  { name: '피부색 3', run: (r) => swatch(r, 'skin', 3) },
  { name: '머리색 4', run: (r) => swatch(r, 'hair', 4) },
  { name: '상의색 6', run: (r) => swatch(r, 'top', 6) },
  { name: '하의색 2', run: (r) => swatch(r, 'bottom', 2) },
  { name: '신발색 4', run: (r) => swatch(r, 'shoes', 4) },
  { name: '90도 회전', run: () => press('cz-turn') },
  { name: '걷기 켜기', run: () => press('cz-walk') },
  { name: '정면', run: () => press('cz-front') },
  {
    name: '드래그로 돌리기',
    run: (_r, canvas) => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100 }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 160 }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 130 }));
      canvas.dispatchEvent(new MouseEvent('pointerup'));
      // 놓은 뒤 움직임은 무시돼야 한다
      canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 900 }));
    },
  },
  {
    name: '←→ 키로 돌리기',
    run: (_r, canvas) => {
      for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowRight', 'Space'])
        canvas.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }));
    },
  },
  { name: '걷기 끄기', run: () => press('cz-walk') },
  { name: '기본 조합', run: () => press('cz-reset') },
  // 게 후드는 기본 몸보다 커서 fitPreview 가 카메라를 물려야 한다 — 그 경로를 탄다
  { name: '머리 +6 (게 후드)', run: (r) => [0, 0, 0, 0, 0, 0].forEach(() => arrow(r, 'hair', 1)) },
  { name: '랜덤 조합', run: () => press('cz-random') },
];

/* ──────────────── 한 판 돌리기 ──────────────── */

/** 같은 씨앗이면 같은 순서로 같은 수를 준다 — 랜덤 조합을 두 구현에 똑같이 먹인다 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

function describeCamera(c: THREE.OrthographicCamera): unknown {
  return {
    left: r6(c.left),
    right: r6(c.right),
    top: r6(c.top),
    bottom: r6(c.bottom),
    zoom: c.zoom,
    position: [r6(c.position.x), r6(c.position.y), r6(c.position.z)],
    quaternion: [r6(c.quaternion.x), r6(c.quaternion.y), r6(c.quaternion.z), r6(c.quaternion.w)],
    projection: Array.from(c.projectionMatrix.elements, r6),
  };
}

/** 씬 안에 지오메트리를 가진 노드가 몇인지 — 검사가 텅 빈 트리를 비교하고 있지 않은지 본다 */
function countGeometry(d: { geometry: unknown; children: Array<{ geometry: unknown }> }): number {
  let n = d.geometry ? 1 : 0;
  for (const c of d.children as Array<Parameters<typeof countGeometry>[0]>) n += countGeometry(c);
  return n;
}

interface Shot {
  step: string;
  html: string;
  look: unknown;
  scene: unknown;
  cam: unknown;
}

interface Run {
  shots: Shot[];
  frames: number;
  previewHidden: boolean;
  saved: string | null;
  geometries: number;
}

const SEED = 20260911;

function runTrace(mod: Customizer): Run {
  const { root, canvas } = mountStage();
  localStorage.clear();
  rec.frames.length = 0;
  pendingFrame = null;
  const rng = lcg(SEED);
  const spy = vi.spyOn(Math, 'random').mockImplementation(rng);
  try {
    mod.initCustomizer();

    const shots: Shot[] = [];
    /** 고정 시각으로 한 프레임 그린 뒤 화면을 통째로 뜬다 */
    const capture = (step: string, at: number): void => {
      const cb = pendingFrame;
      pendingFrame = null;
      cb?.(at);
      const frame = rec.frames[rec.frames.length - 1];
      shots.push({
        step,
        html: root.innerHTML,
        look: mod.currentLook(),
        scene: describeObject(frame.scene as THREE.Object3D),
        cam: describeCamera(frame.cam as THREE.OrthographicCamera),
      });
    };

    capture('입장', 1000);
    STEPS.forEach((s, i) => {
      s.run(root, canvas);
      // 걷기 자세가 시각에 따라 바뀌므로 단계마다 시각을 옮긴다
      capture(s.name, 1000 + (i + 1) * 137);
    });

    const preview = root.querySelector<HTMLElement>('.cz-preview')!;
    return {
      shots,
      frames: rec.frames.length,
      previewHidden: preview.style.display === 'none',
      saved: localStorage.getItem('gimbap:look'),
      geometries: countGeometry(shots[shots.length - 1].scene as never),
    };
  } finally {
    spy.mockRestore();
    mod.stopCustomizer();
  }
}

/* ──────────────── 검사 ──────────────── */

describe('캐릭터 꾸미기 — 레거시 동등성', () => {
  let legacy: Run;
  let port: Run;

  beforeAll(() => {
    legacy = runTrace(legacyMod as Customizer);
    port = runTrace(portMod as Customizer);
  });

  it('두 구현은 서로 다른 모듈이다 (같으면 자기 자신과의 비교다)', () => {
    expect(portMod.initCustomizer).not.toBe(legacyMod.initCustomizer);
    expect(legacy.shots.length).toBe(STEPS.length + 1);
    expect(port.shots.length).toBe(STEPS.length + 1);
  });

  it('미리보기가 실제로 돌아간다 (접혔으면 비교가 빈 화면끼리다)', () => {
    for (const [who, run] of [
      ['레거시', legacy],
      ['이식본', port],
    ] as const) {
      expect(run.previewHidden, who).toBe(false);
      // 단계마다 한 프레임 + initCustomizer 가 직접 부른 첫 프레임
      expect(run.frames, who).toBe(STEPS.length + 2);
      // 몸·머리·옷·신발·받침 — 수십 개는 나와야 한다
      expect(run.geometries, who).toBeGreaterThan(20);
    }
    expect(legacy.geometries).toBe(port.geometries);
  });

  it('단계마다 화면이 실제로 바뀐다 (안 바뀌면 조작이 안 먹은 것이다)', () => {
    const seen = new Set(legacy.shots.map((s) => JSON.stringify(s)));
    expect(seen.size).toBeGreaterThan(STEPS.length - 3);
  });

  it('같은 조작을 먹이면 미리보기 씬이 정점까지 같다', () => {
    for (let i = 0; i < legacy.shots.length; i++) {
      const a = legacy.shots[i];
      const b = port.shots[i];
      expect(firstDifference(a.scene, b.scene), a.step + ' 씬').toBe(null);
      expect(firstDifference(a.cam, b.cam), a.step + ' 카메라').toBe(null);
    }
  });

  it('칠해진 DOM 과 고른 조합이 단계마다 같다', () => {
    for (let i = 0; i < legacy.shots.length; i++) {
      const a = legacy.shots[i];
      const b = port.shots[i];
      expect(firstDifference(a.look, b.look), a.step + ' 조합').toBe(null);
      expect(b.html, a.step + ' DOM').toBe(a.html);
    }
  });

  it('랜덤 조합이 실제로 다른 값을 뽑는다 (기본값 그대로면 뽑기가 안 돈 것이다)', () => {
    const last = port.shots[port.shots.length - 1];
    expect(last.step).toBe('랜덤 조합');
    expect(last.look).not.toEqual(DEFAULT_LOOK);
    expect(last.look).toEqual(legacy.shots[legacy.shots.length - 1].look);
  });

  it('고른 조합을 레거시와 같은 모양으로 저장한다', () => {
    expect(port.saved).toBe(legacy.saved);
    expect(JSON.parse(port.saved!)).toEqual(port.shots[port.shots.length - 1].look);
  });

  it('stopCustomizer 가 렌더러와 프레임 예약을 거둔다', () => {
    // 두 판 모두 finally 에서 불렀다
    expect(rec.disposed).toBeGreaterThanOrEqual(2);
    expect(cancelled.length).toBeGreaterThanOrEqual(2);
  });
});

describe('캐릭터 꾸미기 — 되살리기와 예외', () => {
  /** 저장된 값으로 한 번만 띄운다 */
  function bootWith(mod: Customizer, stored: string): unknown {
    mountStage();
    localStorage.clear();
    localStorage.setItem('gimbap:look', stored);
    pendingFrame = null;
    try {
      mod.initCustomizer();
      return mod.currentLook();
    } finally {
      mod.stopCustomizer();
    }
  }

  it('저장된 조합을 되살리고, 범위를 벗어난 값은 레거시와 같게 잘라낸다', () => {
    for (const stored of [
      '{"h":3,"hc":2,"f":1,"t":4,"tc":5,"b":2,"bc":3,"e":6,"sc":4,"shc":2}',
      '{"h":99,"hc":-1,"f":2,"t":"x","e":5}',
      '{}',
      '깨진 JSON',
    ]) {
      const a = bootWith(legacyMod as Customizer, stored);
      const b = bootWith(portMod as Customizer, stored);
      expect(firstDifference(a, b), stored).toBe(null);
    }
  });

  it('WebGL 을 못 열면 미리보기만 접고 고르기는 계속 된다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rec.throwOnCreate = true;
    try {
      const out = [legacyMod, portMod].map((mod) => {
        const { root } = mountStage();
        localStorage.clear();
        (mod as Customizer).initCustomizer();
        arrow(root, 'hair', 1);
        swatch(root, 'skin', 2);
        const preview = root.querySelector<HTMLElement>('.cz-preview')!;
        const result = {
          hidden: preview.style.display,
          html: root.innerHTML,
          look: (mod as Customizer).currentLook(),
        };
        (mod as Customizer).stopCustomizer();
        return result;
      });
      expect(out[0].hidden).toBe('none');
      expect(firstDifference(out[0], out[1])).toBe(null);
      expect(warn).toHaveBeenCalled();
    } finally {
      rec.throwOnCreate = false;
      warn.mockRestore();
    }
  });
});
