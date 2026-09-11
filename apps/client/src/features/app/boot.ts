/* ────────────────────────────────────────────────────────────
   조립점 — 소켓 · 월드 · 플레이어 · UI 를 연결하고 루프를 돈다.
   레거시 main.js 를 그대로 옮겼다.

   레거시와 다른 점은 두 가지다.
   - 렌더러 생성과 프레임 루프가 `features/world/renderer` 로 갔다 (R3F).
     레거시 `initWorld` = `startRenderer` + `buildWorld`,
     레거시 `render(swinging)` = `stepWorld(swinging)` + R3F 의 그리기.
   - `boot()` 를 부르는 쪽이 `<script>` 가 아니라 `App` 의 마운트 이펙트다.
     `canvas#gl` 을 `Shell` 이 그리므로 마운트 뒤여야 한다.
   ──────────────────────────────────────────────────────────── */
import { preloadAssets } from '@/features/assets/assets';
import { resolveAction } from '@/features/kitchen/kitchen';
import { connect, emit, on, S } from '@/features/net/net';
import {
  applyKnockback,
  correctPose,
  getPose,
  initPlayer,
  isSwinging,
  state as P,
  setLook,
  updatePlayer,
} from '@/features/player/player';
import { initUI, renderHUD, route, toast, wavePop } from '@/features/ui/ui';
import { buildWorld, stepWorld } from '@/features/world/build';
import { animatePreviewBody, disposePreviewBody, previewBody } from '@/features/world/character';
import { remoteSwing } from '@/features/world/customers';
import { startLoop, startRenderer } from '@/features/world/renderer';
import { camera, interactables, scene } from '@/features/world/scene';
import { DEFAULT_LOOK, PARTS } from '@repo/game-core';
import * as THREE from 'three';

/** 더 갈 수 없을 때 화면에 그대로 붙인다 — 레거시와 같은 마크업 */
function fatal(head: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="fatal">' + head + '<br /><small>' + message + '</small></div>',
  );
}

/** 브라우저 QA(`tools/release-browser-qa.cjs`)가 잡는 훅 */
export interface DebugHooks {
  S: typeof S;
  emit: typeof emit;
  scene: typeof scene;
  camera: typeof camera;
  interactables: typeof interactables;
  player: typeof P;
  setLook: typeof setLook;
  getPose: typeof getPose;
  resolveAction: typeof resolveAction;
  applyKnockback: typeof applyKnockback;
  remoteSwing: typeof remoteSwing;
  /** 캐릭터 미리보기 QA 가 쓰는 작업대 */
  preview: {
    THREE: typeof THREE;
    previewBody: typeof previewBody;
    animatePreviewBody: typeof animatePreviewBody;
    disposePreviewBody: typeof disposePreviewBody;
    PARTS: typeof PARTS;
    DEFAULT_LOOK: typeof DEFAULT_LOOK;
  };
  step: (dt?: number) => void;
}

declare global {
  interface Window {
    GB?: DebugHooks;
  }
}

export async function boot(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;

  // 직접 만든 모델이 있으면 먼저 받아둔다. 없으면 그냥 지나간다 (전부 코드로 만든다)
  await preloadAssets();

  let root;
  try {
    root = await startRenderer(canvas);
    buildWorld();
  } catch (err) {
    console.error(err);
    fatal('3D 를 켤 수 없습니다.<br />WebGL 을 지원하는 브라우저인지 확인하세요.', err);
    return;
  }

  try {
    await connect();
  } catch (err) {
    console.error(err);
    fatal('서버에 연결하지 못했습니다.', err);
    return;
  }

  initPlayer(canvas);
  initUI();
  on('position:correct', correctPose);

  // 🌊 웨이브가 끝났다 — 중앙 상단에 크게 알린다
  on('waveEnd', wavePop);

  // 누가 빗자루를 휘둘렀다 — 그 사람 아바타에 모션을 재생한다
  on('swing', (d) => {
    if (d.by !== S.meId) remoteSwing(d.by);
  });

  // 빗자루에 맞았다
  on('hit', (d) => {
    if (d.target === S.meId) {
      applyKnockback(d.dirX, d.dirZ, d.power);
      if (d.dropped) toast('빗자루에 맞아 들고 있던 걸 놓쳤습니다!', 'bad');
    }
  });

  // 디버깅/자동 검증용 훅
  window.GB = {
    S,
    /* QA 도구가 "끊긴 동안 보낸 명령이 큐에 쌓이지 않는다" 를 확인할 때 쓴다.
       예전엔 도구가 /js/net.js 를 직접 import 했는데, 번들러가 붙으면
       그런 경로가 없다 — 훅으로 내보낸다. */
    emit,
    scene,
    camera,
    interactables,
    player: P,
    setLook,
    getPose,
    resolveAction,
    applyKnockback,
    remoteSwing,
    // 캐릭터 미리보기 QA 가 쓰는 작업대. 예전엔 도구가 모듈을 직접 import 했다.
    preview: { THREE, previewBody, animatePreviewBody, disposePreviewBody, PARTS, DEFAULT_LOOK },
    /* 레거시는 여기서 renderer.render 까지 했지만, 그리기는 R3F 가 맡는다.
       QA 가 읽는 것은 좌표와 상태뿐이라 논리 한 프레임이면 된다. */
    step(dt?: number) {
      updatePlayer(dt || 0.016);
      renderHUD();
      stepWorld(isSwinging());
    },
  };

  route();
  startLoop(root);
}
