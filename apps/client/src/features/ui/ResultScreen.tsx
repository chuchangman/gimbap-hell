/* ────────────────────────────────────────────────────────────
   결과 화면 뼈대 — 레거시 index.html 196-228 줄.
   `#r-*` 자리는 전부 `ui.ts` 의 renderResult · renderBoard 가 칠한다.
   ──────────────────────────────────────────────────────────── */
export function ResultScreen() {
  return (
    <section id="screen-result" className="screen solid scrollable">
      <div className="card wide result-card">
        <h1 id="r-title">결과</h1>
        <p className="tagline" id="r-sub" />
        <div className="score-hero">
          <div className="big-score">
            <span id="r-total">0</span>
            <em>점</em>
          </div>
          <div className="players" id="r-players" />
        </div>

        <div className="rows" id="r-rows" />

        <h3>🏆 가게 랭킹</h3>
        <p className="rank-line" id="r-rank-line" />
        <p className="hint" id="r-storage-status" role="status" aria-live="polite" />
        <ol className="board" id="r-board" />

        <h3>다음엔 이렇게</h3>
        <ul className="tips" id="r-tips" />

        <div id="r-host" className="hidden">
          <button id="btn-to-lobby" className="btn primary big">
            대기실로 — 한 판 더
          </button>
        </div>
        <p className="hint hidden" id="r-guest">
          방장이 다음 판을 준비합니다.
        </p>
      </div>
    </section>
  );
}
