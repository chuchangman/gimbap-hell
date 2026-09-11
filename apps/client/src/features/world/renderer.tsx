/* ────────────────────────────────────────────────────────────
   렌더러와 프레임 루프 — R3F 가 맡는다.

   `<Canvas>` 가 아니라 `createRoot` 로 기존 `canvas#gl` 에 붙인다.
   `<Canvas>` 는 div 두 겹으로 캔버스를 감싸는데, 그러면 레거시 DOM
   (`#gl` 하나)과 달라지고 `#gl { position: fixed; inset: 0 }` 도 안 먹는다.
   화면이 그대로여야 하므로 캔버스는 `Shell` 이 그리고 R3F 가 거기 붙는다.

   씬과 카메라는 `build.ts` 가 만든 것을 그대로 넘긴다 — R3F 가 제 것을
   만들지 않고 이걸 쓰고, 리사이즈 때 `camera.aspect` 를 갱신한다
   (레거시 `initWorld` 의 `resize()` 와 같은 일).
   ──────────────────────────────────────────────────────────── */
import { isSwinging, state as P, updatePlayer } from '@/features/player/player';
import { stepWorld } from '@/features/world/build';
import { camera, scene, setViewportHeight } from '@/features/world/scene';
import { createRoot, useFrame, type ReconcilerRoot, type Size } from '@react-three/fiber';
import * as THREE from 'three';

/** 레거시 initWorld 가 렌더러에 걸던 설정 그대로 */
export const RENDERER_PROPS = {
  antialias: true,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.18,
} as const;

/** 레거시 `setPixelRatio(Math.min(devicePixelRatio, 2))` */
export const PIXEL_RATIO_CAP = 2;

/** 탭이 쉬었다 돌아와도 한 프레임에 0.1초 넘게 굴리지 않는다 */
export const MAX_DT = 0.1;

/**
 * 레거시 `resize()` 와 같은 기준 — 창 크기.
 * `#gl` 이 `position: fixed; inset: 0` 이라 창과 같은 크기다.
 *
 * R3F 에 맡기면 안 된다. R3F 는 `canvas.parentElement`(= `#app`)를 재는데,
 * 그 안은 전부 fixed 라 높이가 0 이다. 그러면 `camera.aspect` 가 Infinity 가
 * 되어 투영행렬이 깨지고, 화면은 멀쩡해 보이는데 조준(레이캐스트)이 통째로
 * 죽는다 — 브라우저 QA 가 실제로 여기서 멈췄다.
 */
export const viewportSize = (): Size => ({
  width: window.innerWidth,
  height: window.innerHeight,
  top: 0,
  left: 0,
});

/**
 * 한 프레임. 레거시 main.js 의 `loop()` 에서 `requestAnimationFrame` 예약만
 * 뺀 것이다 — 그 예약은 R3F 가 한다.
 *
 * 손님 테두리 두께는 화면 높이로 환산한다. 레거시는 매 프레임
 * `renderer.domElement.clientHeight` 를 읽었고, 여기서는 R3F 가 재어 둔
 * 크기를 받는다 (`#gl` 이 `position: fixed; inset: 0` 이라 같은 값이다).
 */
export function frameStep(delta: number, viewportPx: number): void {
  setViewportHeight(viewportPx);
  const dt = Math.min(MAX_DT, delta);
  if (P.enabled) updatePlayer(dt);
  stepWorld(isSwinging());
}

function Frame(): null {
  useFrame((state, delta) => frameStep(delta, state.size.height));
  return null;
}

/**
 * 렌더러를 레거시 `initWorld` 와 한 글자도 다르지 않게 만든다.
 *
 * R3F 에 설정을 맡기지 않고 직접 만들어 넘기는 이유는, R3F 의 기본값이
 * 버전에 따라 바뀔 수 있기 때문이다. 톤매핑 하나만 어긋나도 로우폴리의
 * 면 대비가 통째로 죽는다 — 화면이 그대로여야 하니 여기서 못 박는다.
 */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: RENDERER_PROPS.antialias });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
  gl.toneMapping = RENDERER_PROPS.toneMapping;
  gl.toneMappingExposure = RENDERER_PROPS.toneMappingExposure;
  gl.shadowMap.enabled = false;
  return gl;
}

/**
 * 캔버스에 R3F 를 붙인다. 아직 프레임은 돌지 않는다.
 * WebGL 을 못 켜면 던진다 — 레거시 `initWorld` 와 같은 자리에서 같은 이유로.
 */
export async function startRenderer(
  canvas: HTMLCanvasElement,
): Promise<ReconcilerRoot<HTMLCanvasElement>> {
  const root = createRoot(canvas);
  await root.configure({
    scene,
    camera,
    gl: () => createRenderer(canvas),
    dpr: Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP),
    shadows: false,
    size: viewportSize(),
    /* R3F 의 포인터 이벤트는 붙이지 않는다 — 조준과 마우스 잠금은
       player.ts 가 캔버스에서 직접 처리한다. 둘이 겹치면 안 된다. */
  });
  return root;
}

/**
 * 루프를 시작한다. 레거시가 boot() 맨 끝에서 `loop()` 를 부르던 자리다.
 * 창 크기가 바뀌면 렌더러와 카메라를 따라가게 한다 (레거시 `resize()`).
 */
export function startLoop(root: ReconcilerRoot<HTMLCanvasElement>): () => void {
  const store = root.render(<Frame />);
  const onResize = (): void => {
    const { width, height } = viewportSize();
    store.getState().setSize(width, height);
  };
  window.addEventListener('resize', onResize);
  onResize();
  return () => window.removeEventListener('resize', onResize);
}
