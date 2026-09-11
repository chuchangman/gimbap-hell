/* ────────────────────────────────────────────────────────────
   화면 뼈대 전체 — 레거시 index.html 의 <body> 를 그대로 옮겼다.

   React 는 "뼈대만" 그린다. 안쪽 내용은 `ui.ts` 가 id 로 잡아 칠한다.
   레거시를 R3F/선언형으로 다시 쓰지 않는 이유는 계획서 A안 그대로다 —
   발표용 화면이라 픽셀이 같아야 하고, `style.css` 618줄을 그대로 쓰려면
   DOM 모양도 그대로여야 한다.

   레거시 <body> 와 다른 점은 두 가지뿐이다.
   - `<script>` 세 줄이 없다. 모듈은 Vite 가 넣는다.
   - 뿌리가 `<div id="app">` 안이다. 최상위 요소(`#gl` · `.screen` · `#hud` ·
     `#toast-area` · `.connection-status` · `#overlay-*`)가 전부 position:fixed
     라 감싸는 div 가 배치에 영향을 주지 않는다.
   ──────────────────────────────────────────────────────────── */
import { HelpOverlay } from '@/features/ui/HelpOverlay';
import { Hud } from '@/features/ui/Hud';
import { JoinScreen } from '@/features/ui/JoinScreen';
import { LobbyScreen } from '@/features/ui/LobbyScreen';
import { ResultScreen } from '@/features/ui/ResultScreen';

export function Shell() {
  return (
    <>
      <canvas id="gl" />
      <div
        id="connection-status"
        className="connection-status hidden"
        role="status"
        aria-live="polite"
      >
        <span id="connection-status-text">서버에 연결하고 있습니다.</span>
        <button id="connection-retry" type="button">
          다시 연결
        </button>
      </div>

      <Hud />
      <JoinScreen />
      <LobbyScreen />

      {/* 게임 (3D 캔버스) */}
      <section id="screen-game" className="screen" />

      <ResultScreen />
      <HelpOverlay />

      <div id="toast-area" role="status" aria-live="polite" aria-atomic="false" />
    </>
  );
}
