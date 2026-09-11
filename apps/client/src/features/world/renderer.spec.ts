import { describe, expect, it, vi } from 'vitest';

/* ────────────────────────────────────────────────────────────
   렌더러 설정 동등성

   씬 트리는 정점까지 맞춰 놨지만, 같은 씬도 렌더러 설정이 다르면 다르게
   보인다 — 톤매핑을 빼면 밝은 면이 하얗게 뜨고 로우폴리의 면 대비가 죽는다.
   레거시 `initWorld` 가 실제로 건 값과, R3F 를 태운 뒤의 값을
   같은 가짜 렌더러로 받아 적어 대조한다.
   ──────────────────────────────────────────────────────────── */

interface FakeGL {
  params: Record<string, unknown>;
  pixelRatio: number | null;
  size: [number, number] | null;
  toneMapping: number;
  toneMappingExposure: number;
  outputColorSpace: string;
  shadowMap: { enabled: boolean; type?: number };
}

const made = vi.hoisted(() => ({ list: [] as FakeGL[] }));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeRenderer {
    domElement: unknown;
    params: Record<string, unknown>;
    pixelRatio: number | null = null;
    size: [number, number] | null = null;
    shadowMap = { enabled: false, type: 0 };
    info = { memory: { geometries: 0, textures: 0 }, render: { calls: 0, triangles: 0 } };
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = '';
    xr = { enabled: false, addEventListener() {}, removeEventListener() {} };
    capabilities = { isWebGL2: true, getMaxAnisotropy: () => 1, getMaxPrecision: () => 'highp' };
    constructor(params: Record<string, unknown> = {}) {
      this.domElement = params.canvas ?? { clientHeight: 900, clientWidth: 1600 };
      this.params = { antialias: params.antialias ?? false };
      made.list.push(this as unknown as FakeGL);
    }
    setPixelRatio(v: number): void {
      this.pixelRatio = v;
    }
    setSize(w: number, h: number): void {
      this.size = [w, h];
    }
    setAnimationLoop(): void {}
    getContext(): Record<string, unknown> {
      return {};
    }
    compile(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

/* 픽셀비 상한(2)이 실제로 걸리는 화면에서 본다. jsdom 기본값 1 로는
   `Math.min(1, 2)` 와 `Math.min(1, 3)` 이 같아서 상한을 못 본다. */
vi.stubGlobal('devicePixelRatio', 3);

const legacyWorld = await import('@legacy/world.js');
const { camera } = await import('@/features/world/scene');
const { RENDERER_PROPS, PIXEL_RATIO_CAP, createRenderer, startRenderer, startLoop } =
  await import('@/features/world/renderer');

/** 화면에 실제로 영향을 주는 값만 뽑는다 */
const look = (gl: FakeGL) => ({
  antialias: gl.params.antialias,
  pixelRatio: gl.pixelRatio,
  toneMapping: gl.toneMapping,
  toneMappingExposure: gl.toneMappingExposure,
  shadows: gl.shadowMap.enabled,
});

describe('렌더러 설정 — 레거시 initWorld 와 같은 값', () => {
  it('톤매핑 · 노출 · 그림자 · 안티에일리어싱 · 픽셀비가 같다', async () => {
    made.list.length = 0;
    legacyWorld.initWorld(document.createElement('canvas'));
    expect(made.list, '레거시가 렌더러를 하나 만들어야 한다').toHaveLength(1);
    const legacy = look(made.list[0]);

    /* 우리가 만든 렌더러 그 자체 — R3F 를 타기 전. R3F 의 기본값이
       우연히 같아서 통과하는 일이 없도록 여기서 먼저 못 박는다. */
    createRenderer(document.createElement('canvas'));
    expect(made.list).toHaveLength(2);
    const mine = look(made.list[1]);

    // 기본값 그대로면 비교가 무의미하다 — 레거시가 실제로 걸었는지 먼저 본다
    expect(legacy.toneMapping).toBe(RENDERER_PROPS.toneMapping);
    expect(legacy.toneMapping).not.toBe(0);
    expect(legacy.toneMappingExposure).toBe(RENDERER_PROPS.toneMappingExposure);
    expect(legacy.antialias).toBe(true);
    expect(legacy.shadows).toBe(false);
    // 상한이 실제로 걸린 값이어야 한다 (화면 배율 3 → 2)
    expect(legacy.pixelRatio).toBe(PIXEL_RATIO_CAP);
    expect(legacy.pixelRatio).toBeLessThan(devicePixelRatio);

    expect(mine).toEqual(legacy);

    // R3F 를 태우고 나서도 그대로여야 한다
    await startRenderer(document.createElement('canvas'));
    expect(made.list, 'R3F 도 렌더러를 하나 만들어야 한다').toHaveLength(3);
    expect(look(made.list[2])).toEqual(legacy);
  });
});

/* ────────────────────────────────────────────────────────────
   화면 크기 — 조준이 여기에 걸린다.

   R3F 에 크기를 맡기면 `canvas.parentElement`(= `#app`)를 재는데, 그 안은
   전부 `position: fixed` 라 높이가 0 이다. 그러면 `camera.aspect` 가
   Infinity 가 되어 투영행렬이 깨지고, 레이캐스트(조준)가 통째로 죽는다 —
   화면은 멀쩡해 보이는데 아무것도 집을 수 없다. 브라우저 QA 가 실제로
   여기서 멈췄다. 레거시 `resize()` 처럼 창 크기를 기준으로 준다.
   ──────────────────────────────────────────────────────────── */
describe('화면 크기', () => {
  it('카메라 종횡비가 창 크기에서 나온다 (부모 높이 0 에 걸리지 않는다)', async () => {
    const host = document.createElement('div');
    // `#app` 처럼 안이 전부 fixed 라 높이가 0 인 부모를 흉내 낸다
    host.getBoundingClientRect = () => ({ width: 1024, height: 0, top: 0, left: 0 }) as DOMRect;
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    document.body.appendChild(host);

    made.list.length = 0;
    const root = await startRenderer(canvas);
    startLoop(root);

    const expected = window.innerWidth / window.innerHeight;
    expect(expected).toBeGreaterThan(0);
    expect(Number.isFinite(camera.aspect)).toBe(true);
    expect(camera.aspect).toBe(expected);
    // 렌더러도 창 크기로 잡혀야 한다
    expect(made.list[0].size).toEqual([window.innerWidth, window.innerHeight]);
    root.unmount();
  });
});
