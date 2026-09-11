/* ────────────────────────────────────────────────────────────
   HUD 뼈대 — 레거시 index.html 19-60 줄을 그대로 옮겼다.

   내용은 비워 둔다. `ui.ts` 가 매 프레임 `#queue` · `#hand` · `#prompt` 같은
   자리를 id 로 잡아 innerHTML 로 칠한다 — 레거시와 같은 그림이 나와야 하므로
   React 가 내용까지 그리도록 바꾸지 않는다 (충실한 이식, 계획서 A안).
   그래서 id 와 class 가 하나라도 어긋나면 안 된다.
   ──────────────────────────────────────────────────────────── */
export function Hud() {
  return (
    <div id="hud" className="hidden">
      <div className="hud-top">
        <div className="chip" id="wave-chip">
          준비 중
        </div>
        <div className="timer" id="timer">
          0:00
        </div>
        <div className="rep">
          <span>평판</span>
          <div className="bar">
            <i id="rep-bar" />
          </div>
          <b id="rep-num">100</b>
        </div>
        <div className="score" id="score">
          <b>0</b> 점
        </div>
      </div>
      <div className="hud-sub" id="stat-rolls" />
      <div id="wave-pop" className="wave-pop" />
      <div id="pause-overlay" className="pause-overlay hidden">
        <strong>⏸ 일시정지</strong>
        <span id="pause-hint">방장이 게임을 멈췄습니다.</span>
      </div>

      <div id="queue" className="queue" />
      <div className="hud-right">
        <div id="say" className="say" />
        <div id="roll" className="roll hidden" />
      </div>

      {/* 손에 든 것으로 뭘 해야 하는지 — 예전 구역 안내가 있던 자리 */}
      <div id="hand-hint" className="hand-hint hidden" />

      <div id="crosshair" />
      <div id="prompt" className="hidden" />

      <div className="hud-bottom">
        <div id="hand" className="hand">
          <span className="nm empty">빈손</span>
        </div>
      </div>

      <div className="controls">
        <b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>Space</b> 점프 · <b>마우스</b> 시점
        <br />
        <b>E</b>/좌클릭 상호작용 · <b>Q</b> 버리기 · <b>H</b> 도움말 · <b>Esc</b> 마우스 해제
        <br />
        방장: <b>P</b> 일시정지/재개
        <br />
        <b>🧹 빗자루</b>를 들면 <b>좌클릭</b>으로 동료 · 손님을 후려칩니다
      </div>
    </div>
  );
}
