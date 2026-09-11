/* ────────────────────────────────────────────────────────────
   화면과 소켓 사이의 배선.

   그리는 일은 전부 React 가 한다(`Shell` · `Hud` · `JoinScreen` ·
   `LobbyScreen` · `ResultScreen` · `HelpOverlay`). 여기 남은 것은
   "스냅샷이 왔을 때 그리기 말고 해야 하는 일" 뿐이다 — 자세 복구,
   토스트 띄우기, 일시정지 시 마우스 잠금 해제, 꾸미기 초기화.
   ──────────────────────────────────────────────────────────── */
import { initCustomizer } from '@/features/customize/customize';
import { on, S } from '@/features/net/net';
import { releaseLock, resetPose } from '@/features/player/player';

/* ──────────────── 토스트 ────────────────
   React 가 그리는 `#toast-area` 에 직접 붙인다. 사라지는 타이밍이
   제각각이라 목록으로 들고 있을 이유가 없다. */
const TOAST_MAX = 5;
const TOAST_MS = 2600;
const TOAST_FADE_MS = 320;

export function toast(msg: string, kind?: string): void {
  const area = document.getElementById('toast-area');
  if (!area) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  area.appendChild(el);
  while (area.children.length > TOAST_MAX) area.removeChild(area.firstChild!);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), TOAST_FADE_MS);
  }, TOAST_MS);
}

/** 일시정지가 시작되는 순간 마우스 잠금을 놓아준다. 화면은 React 가 그린다 */
let pauseShown = false;
function releaseLockOnPause(): void {
  const paused = !!(S.state && S.state.phase === 'playing' && S.state.paused);
  if (paused && !pauseShown) releaseLock();
  pauseShown = paused;
}

/** 소켓 이벤트를 화면 밖의 일과 이어 준다. 부팅 때 한 번 부른다 */
export function initUI(): void {
  on('state', () => {
    /* 연결이 복구되면 서버가 마지막 자세를 돌려준다 — 그 자리로 되돌린다 */
    if (S.restorePose) {
      resetPose(S.restorePose);
      S.restorePose = null;
    }
    releaseLockOnPause();
  });

  on('phase', (ph) => {
    if (ph !== 'playing') return;
    const me = S.state?.players.find((p) => p.id === S.meId);
    resetPose(me?.spawn || S.positions.find((p) => p.id === S.meId) || { x: 0, z: 6.2 });
  });

  on('toast', (d) => toast(d.msg, d.kind));

  // 입장 화면의 캐릭터 꾸미기 — 미리보기 캔버스와 파츠 버튼을 켠다
  initCustomizer();
}
