/* ────────────────────────────────────────────────────────────
   입장 화면 뼈대 — 레거시 index.html 62-138 줄.
   `.customize` 안쪽은 `features/customize/customize.ts` 가 값을 칠한다.
   ──────────────────────────────────────────────────────────── */

/** 파츠 한 줄 — 머리 · 얼굴 · 표정 · 상의 · 하의가 같은 모양이다 */
function PartRow({ part, label }: { part: string; label: string }) {
  return (
    <div className="cz-row" data-part={part}>
      <span className="cz-label">{label}</span>
      <button className="cz-arrow" data-d="-1">
        ◀
      </button>
      <b className="cz-name" />
      <button className="cz-arrow" data-d="1">
        ▶
      </button>
    </div>
  );
}

export function JoinScreen() {
  return (
    <section id="screen-join" className="screen solid active scrollable">
      <div className="card">
        <h1 className="logo">
          🍣 김밥지옥
          <br />
          <span>웨이브 디펜스</span>
        </h1>
        <p className="tagline">
          손님이 웨이브로 밀려옵니다.
          <br />다 같이 김밥을 말아 인내심이 다하기 전에 내보내세요.
        </p>

        <label className="field">
          <span>
            이름 <em id="name-limits" />
          </span>
          <input id="input-name" placeholder="예: 김알바" autoComplete="off" />
        </label>

        <div className="cz-heading">
          <b>나의 클레이 캐릭터</b>
          <span>선택한 모습이 게임에 그대로 적용돼요</span>
        </div>
        <div className="customize">
          <div className="cz-preview">
            <canvas id="cz-canvas" aria-label="캐릭터 3D 미리보기. 드래그해서 회전" tabIndex={0} />
            <div className="cz-view-controls">
              <button id="cz-turn" type="button" title="캐릭터 90도 회전">
                ↻ 회전
              </button>
              <button id="cz-walk" type="button" aria-pressed="false">
                걷기
              </button>
              <button id="cz-front" type="button">
                정면
              </button>
            </div>
            <span className="cz-preview-hint">드래그로 360° 돌려보기</span>
          </div>
          <div className="cz-rows">
            <div className="cz-color-label">피부색</div>
            <div className="cz-swatches" data-swatch="skin" />
            <PartRow part="hair" label="머리" />
            <div className="cz-swatches" data-swatch="hair" />
            <PartRow part="face" label="얼굴" />
            <PartRow part="expression" label="표정" />
            <PartRow part="top" label="상의" />
            <div className="cz-swatches" data-swatch="top" />
            <PartRow part="bottom" label="하의" />
            <div className="cz-swatches" data-swatch="bottom" />
            <div className="cz-color-label">신발색</div>
            <div className="cz-swatches" data-swatch="shoes" />
            <div className="cz-actions">
              <button id="cz-random" className="btn tiny">
                랜덤 조합
              </button>
              <button id="cz-reset" className="btn tiny">
                기본 조합
              </button>
            </div>
          </div>
        </div>

        <label className="field">
          <span>
            가게 이름 <em>(새로 열 때만 · 비우면 「이름」의 가게)</em>
          </span>
          <input id="input-shop" placeholder="비워두면 「이름」의 가게" autoComplete="off" />
        </label>

        <button id="btn-create" className="btn primary big">
          새 가게 열기
        </button>
        <div className="or">
          <span>또는</span>
        </div>
        <div className="join-row">
          <input id="input-code" placeholder="방 코드" autoComplete="off" />
          <button id="btn-join" className="btn">
            입장
          </button>
        </div>
        <p id="join-err" className="err" role="status" aria-live="polite" />
        <p id="player-limit-hint" className="hint small" />
      </div>
    </section>
  );
}
