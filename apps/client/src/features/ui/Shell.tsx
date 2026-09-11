/* ────────────────────────────────────────────────────────────
   화면 전체. 어느 화면을 보여줄지는 서버 phase 하나로 결정된다 —
   그래서 "화면 상태" 라는 별도 개념이 없다.

   최상위 요소(`#gl` · `.screen` · `#hud` · `#toast-area` ·
   `.connection-status` · `#overlay-*`)가 전부 position:fixed 라
   감싸는 `<div id="app">` 은 배치에 영향을 주지 않는다.
   ──────────────────────────────────────────────────────────── */
import { on, S } from '@/features/net/net';
import { state as P, releaseLock } from '@/features/player/player';
import { HelpOverlay } from '@/features/ui/HelpOverlay';
import { Hud } from '@/features/ui/Hud';
import { JoinScreen } from '@/features/ui/JoinScreen';
import { LobbyScreen } from '@/features/ui/LobbyScreen';
import { ResultScreen } from '@/features/ui/ResultScreen';
import { useEffect, useState } from 'react';

export type ScreenId = 'screen-join' | 'screen-lobby' | 'screen-game' | 'screen-result';

/** 서버 phase 가 곧 화면이다 */
function currentScreen(): ScreenId {
  if (!S.state) return 'screen-join';
  if (S.state.phase === 'playing') return 'screen-game';
  if (S.state.phase === 'result') return 'screen-result';
  return 'screen-lobby';
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div
      id="connection-status"
      className={'connection-status' + (connected ? ' hidden' : '')}
      role="status"
      aria-live="polite"
    >
      <span id="connection-status-text">
        {S.state
          ? '연결을 복구하고 있습니다. 잠시만 기다려 주세요. (' +
            Math.round(S.recoveryMs / 1000) +
            '초 이내 자동 복귀)'
          : '서버에 연결하고 있습니다. 연결이 되면 입장할 수 있습니다.'}
      </span>
      <button id="connection-retry" type="button" onClick={() => S.socket?.connect()}>
        다시 연결
      </button>
    </div>
  );
}

export function Shell() {
  const [, bump] = useState(0);
  useEffect(() => {
    const redraw = (): void => bump((n) => (n + 1) % 1000);
    const offs = (['state', 'connection', 'phase'] as const).map((e) => on(e, redraw));
    return () => offs.forEach((off) => off());
  }, []);

  const screen = currentScreen();
  const connected = S.connection === 'connected';

  /* 조작을 켜고 끄는 유일한 자리. 게임 화면이 아니거나 끊겨 있으면
     마우스 잠금을 놓아준다 — 잠긴 채로 로비가 뜨면 클릭이 안 된다. */
  const canPlay = screen === 'screen-game' && connected;
  useEffect(() => {
    P.enabled = canPlay;
    if (!canPlay) releaseLock();
  }, [canPlay]);

  return (
    <>
      <canvas id="gl" />
      <ConnectionStatus connected={connected} />

      <Hud />
      <JoinScreen active={screen === 'screen-join'} connected={connected} />
      <LobbyScreen active={screen === 'screen-lobby'} />

      {/* 게임 (3D 캔버스) */}
      <section
        id="screen-game"
        className={'screen' + (screen === 'screen-game' ? ' active' : '')}
      />

      <ResultScreen active={screen === 'screen-result'} />
      <HelpOverlay />

      <div id="toast-area" role="status" aria-live="polite" aria-atomic="false" />
    </>
  );
}
