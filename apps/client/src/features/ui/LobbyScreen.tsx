/* ────────────────────────────────────────────────────────────
   대기실 뼈대 — 레거시 index.html 140-190 줄.
   `#lobby-board-list` · `#player-list` · `#lobby-history` 는 `ui.ts` 가 칠한다.
   `[data-time]` 자리도 `ui.ts` 의 initUI 가 공정 시간을 넣는다.
   ──────────────────────────────────────────────────────────── */
export function LobbyScreen() {
  return (
    <section id="screen-lobby" className="screen solid scrollable">
      <div className="lobby-layout">
        {/* 좌측 — 가게 랭킹 (이름은 첫 글자만) */}
        <aside className="card lobby-board">
          <h3>🏆 가게 랭킹</h3>
          <ol className="board compact" id="lobby-board-list">
            <li className="none">불러오는 중...</li>
          </ol>
          <p className="hint small">가게 이름은 첫 글자만 보입니다.</p>
        </aside>

        <div className="card wide">
          <h2 className="shop-name" id="lobby-shop">
            🍣 김밥지옥
          </h2>
          <div className="room-code">
            <span className="label">방 코드</span>
            <strong id="lobby-code">----</strong>
            <button id="btn-copy" className="btn tiny">
              초대 링크 복사
            </button>
          </div>

          <p className="hint">
            역할 구분은 없습니다. 누구나 재료를 손질하고, 누구나 서빙합니다. <b>2~5명 권장</b>
          </p>

          <h3>참가자</h3>
          <ul id="player-list" className="player-list" />

          <div className="howto">
            <h3>이렇게 굴러갑니다</h3>
            <ol>
              <li>
                <b>준비 시간</b>(<span data-time="riceCook" />초 취사 × 여러 번) 동안 밥과 속재료를
                쌓아둡니다.
              </li>
              <li>
                손님이 문으로 들어와 <b>카운터에 줄을 섭니다.</b> 주문은 모두 <b>김밥 1줄</b>이고,
                필요한 재료는 <b>화면 왼쪽 주문서</b>에 이름으로 뜹니다.
              </li>
              <li>
                <b>손님을 조준하고 E</b> 를 눌러 그 손님에게 서빙합니다. 조립대에 넣은 재료는
                주문서에서 줄이 그어집니다.
              </li>
              <li>
                <b>진상 손님</b>은 커스텀 조합을 요구하고, 인내심이 훨씬 빨리 닳으며 말풍선으로
                궁시렁댑니다.
              </li>
              <li>
                인내심이 0이 되면 주문이 취소되고 <b>평판이 깎입니다</b> (일반 −12 · 진상 −18).
              </li>
              <li>
                평판이 0이 되면 <b>폐업</b>. 10웨이브를 넘기면 <b>완주</b>입니다.
              </li>
            </ol>
          </div>

          <div className="host-only" id="host-controls">
            <p className="hint" id="party-desc" />
            <button id="btn-start" className="btn primary big">
              영업 시작
            </button>
          </div>
          <p className="hint" id="not-host-hint">
            방장이 시작하기를 기다리는 중...
          </p>

          <div id="lobby-history" />
        </div>
      </div>
    </section>
  );
}
