/* ────────────────────────────────────────────────────────────
   조립점 — 소켓 · 월드 · 플레이어 · UI 를 연결하고 루프를 돈다.

   렌더러와 프레임 루프는 `features/world/renderer` 가 맡는다 (R3F).
   `boot()` 는 `App` 의 마운트 이펙트가 부른다 — `canvas#gl` 을 `Shell` 이
   그리므로 마운트 뒤여야 한다.
   ──────────────────────────────────────────────────────────── */
import { preloadAssets } from '@/features/assets/assets';
import { connect, on, S } from '@/features/net/net';
import { applyKnockback, correctPose, initPlayer } from '@/features/player/player';
import { initUI, toast } from '@/features/ui/ui';
import { buildWorld } from '@/features/world/build';
import { remoteSwing } from '@/features/world/customers';
import { startLoop, startRenderer } from '@/features/world/renderer';

/** 더 갈 수 없을 때 화면에 그대로 붙인다 */
function fatal(head: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="fatal">' + head + '<br /><small>' + message + '</small></div>',
  );
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

  startLoop(root);
}
