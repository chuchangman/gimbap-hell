/* 엔트리 — 소켓 · 월드 · 플레이어 · UI 를 연결하고 루프를 돈다 */
import { connect, emit, on, S } from './net.js';
import * as THREE from '/vendor/three.module.min.js';
import { initWorld, render, remoteSwing, scene, camera, interactables,
  previewBody, animatePreviewBody, disposePreviewBody } from './world.js';
import { PARTS, DEFAULT_LOOK } from './config.js';
import {
  initPlayer, updatePlayer, applyKnockback, isSwinging, setLook, getPose, correctPose, state as P
} from './player.js';
import { initUI, renderHUD, route, toast, wavePop } from './ui.js';
import { resolveAction } from './kitchen.js';
import { preloadAssets } from './assets.js';

let last = performance.now();

function loop() {
  requestAnimationFrame(loop);
  const t = performance.now();
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;

  if (P.enabled) {
    updatePlayer(dt);
    renderHUD();
  }
  render(isSwinging());
}

async function boot() {
  const canvas = document.getElementById('gl');

  // 직접 만든 모델이 있으면 먼저 받아둔다. 없으면 그냥 지나간다 (전부 코드로 만든다)
  await preloadAssets();

  try {
    initWorld(canvas);
  } catch (err) {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend',
      '<div class="fatal">3D 를 켤 수 없습니다.<br />WebGL 을 지원하는 브라우저인지 확인하세요.<br /><small>'
      + err.message + '</small></div>');
    return;
  }

  try {
    await connect();
  } catch (err) {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend',
      '<div class="fatal">서버에 연결하지 못했습니다.<br /><small>' + err.message + '</small></div>');
    return;
  }

  initPlayer(canvas);
  initUI();
  on('position:correct',correctPose);

  // 🌊 웨이브가 끝났다 — 중앙 상단에 크게 알린다
  on('waveEnd', wavePop);

  // 누가 빗자루를 휘둘렀다 — 그 사람 아바타에 모션을 재생한다
  on('swing', (d) => { if (d.by !== S.meId) remoteSwing(d.by); });

  // 빗자루에 맞았다
  on('hit', (d) => {
    if (d.target === S.meId) {
      applyKnockback(d.dirX, d.dirZ, d.power);
      if (d.dropped) toast('빗자루에 맞아 들고 있던 걸 놓쳤습니다!', 'bad');
    }
  });

  // 디버깅/자동 검증용 훅
  window.GB = {
    S, emit, scene, camera, interactables, player: P, setLook, getPose, resolveAction,
    applyKnockback, remoteSwing,
    // 캐릭터 미리보기 QA 가 쓰는 작업대. 예전엔 도구가 모듈을 직접 import 했다.
    preview: {THREE, previewBody, animatePreviewBody, disposePreviewBody, PARTS, DEFAULT_LOOK},
    step(dt) { updatePlayer(dt || 0.016); renderHUD(); render(isSwinging()); }
  };

  route();
  loop();
}

boot();
