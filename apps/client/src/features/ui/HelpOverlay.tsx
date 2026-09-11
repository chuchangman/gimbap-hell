/* ────────────────────────────────────────────────────────────
   도움말 오버레이 — 조작법과 공정. 전부 고정 문구다.

   여닫는 상태를 React 가 들고, 컨트롤러(H · Esc)가 부를 콜백을
   `player.state` 에 걸어 준다. 공정 시간은 `TIME` 에서 바로 읽으므로
   예전처럼 `[data-time]` 자리를 나중에 채우는 기계장치가 필요 없다.

   `<tbody>` 를 직접 쓴다 — JSX 는 HTML 파서처럼 끼워 넣어 주지 않는다.
   ──────────────────────────────────────────────────────────── */
import { state as P, releaseLock } from '@/features/player/player';
import { TIME } from '@repo/game-core';
import { useEffect, useState } from 'react';

export function HelpOverlay() {
  const [open, setOpen] = useState(false);

  /* 컨트롤러가 H 와 Esc 로 부른다 */
  useEffect(() => {
    P.onToggleHelp = () => setOpen((v) => !v);
    P.onCloseOverlay = () => {
      setOpen((wasOpen) => {
        if (!wasOpen) releaseLock();
        return false;
      });
    };
    return () => {
      P.onToggleHelp = () => {};
      P.onCloseOverlay = () => {};
    };
  }, []);

  /* 열려 있는 동안은 조준을 막는다 — 뒤에서 게임이 돌고 있다 */
  useEffect(() => {
    P.overlayOpen = open;
    if (open) releaseLock();
  }, [open]);

  return (
    <>
      <div id="overlay-bg" className={open ? '' : 'hidden'} onClick={() => setOpen(false)} />
      <div id="overlay-help" className={'overlay' + (open ? '' : ' hidden')}>
        <div className="overlay-head">
          <h2>📖 조작법 &amp; 공정</h2>
          <span className="sub">H 또는 Esc 로 닫기</span>
          <button id="btn-help-close" className="btn tiny" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>

        <h3>조작</h3>
        <table className="keys">
          <tbody>
            <tr>
              <td>
                <b>W A S D</b>
              </td>
              <td>
                이동 · <b>Shift</b> 달리기 · <b>Space</b> 점프
              </td>
            </tr>
            <tr>
              <td>
                <b>마우스</b>
              </td>
              <td>시점 (캔버스 클릭 시 잠김)</td>
            </tr>
            <tr>
              <td>
                <b>E</b> / 좌클릭
              </td>
              <td>조준한 대상과 상호작용</td>
            </tr>
            <tr>
              <td>
                <b>Q</b>
              </td>
              <td>손에 든 것 버리기 (빗자루는 제자리로)</td>
            </tr>
            <tr>
              <td>
                <b>🧹 좌클릭</b>
              </td>
              <td>빗자루를 들었을 때 — 동료 · 손님 후려치기</td>
            </tr>
            <tr>
              <td>
                <b>H</b> / <b>Esc</b>
              </td>
              <td>도움말 / 마우스 잠금 해제</td>
            </tr>
          </tbody>
        </table>

        <h3>공정</h3>
        <table className="keys">
          <tbody>
            <tr>
              <td>
                🚰 <b>싱크대</b>
              </td>
              <td>쌀을 {TIME.riceRinse}번 헹굽니다 (E 연타)</td>
            </tr>
            <tr>
              <td>
                🍚 <b>밥솥 ×2</b>
              </td>
              <td>
                씻은 쌀 → {TIME.riceCook}초 취사 → 밥 {TIME.riceYield}
                인분
              </td>
            </tr>
            <tr>
              <td>
                🔥 <b>가스렌지 5구</b>
              </td>
              <td>
                냄비2 = 🥬시금치 데치기 · 팬3 = 🥓햄 🥚계란 🥕당근 🍢어묵
                <br />
                각각 제 시간에 꺼내야 합니다. 오래 두면 못 씁니다
              </td>
            </tr>
            <tr>
              <td>
                🔪 <b>도마 ×3</b>
              </td>
              <td>🟡단무지 · 🥒오이 썰기 · 만 김밥 썰기 {TIME.cutRoll}초</td>
            </tr>
            <tr>
              <td>
                🦀 <b>맛살</b>
              </td>
              <td>손질이 필요 없습니다 — 냉장고에서 집어 바로 넣으세요</td>
            </tr>
            <tr>
              <td>
                🍙 <b>조립대 ×3</b>
              </td>
              <td>김 → 밥 → 속재료 → 말기 {TIME.roll}초</td>
            </tr>
            <tr>
              <td>
                🗑️ <b>음쓰통</b>
              </td>
              <td>못 쓰게 된 재료는 여기에 (Q 로 바닥에 버리면 감점)</td>
            </tr>
            <tr>
              <td>
                👤 <b>손님 조준</b>
              </td>
              <td>
                카운터의 손님을 조준하고 <b>E</b> — 그 손님에게 바로 나갑니다
              </td>
            </tr>
            <tr>
              <td>
                🍽️ <b>서빙 테이블</b>
              </td>
              <td>
                조준하기 귀찮으면 여기로. <b>조합이 가장 잘 맞는 주문</b>으로 자동으로 나갑니다.
                <br />
                완전히 맞으면 만점, 빠지거나 더 들어가면 그만큼 깎입니다
              </td>
            </tr>
          </tbody>
        </table>

        <h3>🧹 빗자루 난투</h3>
        <p className="hint">
          가게에 빗자루가 <b>3개</b> 있습니다. E 로 집고 좌클릭으로 휘두릅니다. 사거리 2.6m · 정면
          ±70도 · 쿨다운 0.65초. 맞은 사람은 날아가고 <b>들고 있던 걸 놓칩니다</b>.
          <br />
          단, <b>빗자루를 들면 재료를 못 듭니다.</b> 훼방에는 대가가 따릅니다. 거리와 쿨다운은
          서버가 다시 검사합니다.
        </p>

        <h3>🎯 누구에게 줄지 고르기</h3>
        <p className="hint">
          김밥을 잘라 손에 들면 화면 <b>우측</b>에 그 김밥의 속재료가 펼쳐집니다.
          <br />
          동시에 그 김밥과 <b>가장 잘 맞는 주문</b>의 손님에게 <b>보라색 테두리</b>가 생깁니다.
          똑같이 맞는 손님이 여럿이면 전부 표시되고, 그중 <b>실제로 나갈 한 명</b>만 밝게 숨쉽니다.
          테두리는 <b>내 화면에만</b> 보입니다.
          <br />
          좌측 주문서의 <b>줄 긋기</b>는 그중 <b>가장 급한 한 명</b>에게만 갑니다 — 조준하지 않고
          서빙 테이블로 내면 바로 그 손님에게 나갑니다.
          <br />
          아직 만드는 중일 때는 <b>조립대에 넣은 재료</b>를 기준으로 줄이 그어집니다.
        </p>

        <h3>😤 손님 쫓아내기</h3>
        <p className="hint">
          손님마다 <b>체력바</b>가 있습니다. 빗자루로 때려 <b>0</b> 으로 만들면 쫓겨납니다.
          <br />
          일반 손님 <b>3대</b> · 진상 손님 <b>5대</b> — 진상은 맷집이 좋습니다.
          <br />
          쫓아내면 <b>점수 -25 · 평판 -6</b>. 시간 초과로 놓치는 것(평판 -12 / -18)보다는 쌉니다.
          <br />
          도저히 못 맞출 커스텀 주문은 <b>손절</b>이 답일 때가 있습니다.
        </p>

        <h3>점수</h3>
        <p className="hint">
          김밥 품질 = <b>속재료의 불 조절</b> × <b>주문과 얼마나 맞는지</b>.
          <br />
          주문을 다 채우면 <b>+60점 + 남은 인내심 보너스</b> (진상 손님은 ×1.5), 놓치면 <b>−60점</b>
          .<br />
          웨이브를 다 넘겨도 <b>보너스는 없습니다</b> — 점수는 손님을 만족시켜야만 나옵니다.
          웨이브가 끝나면 화면 <b>중앙 상단</b>에 크게 뜹니다.
          <br />
          재료는 웨이브가 지나며 하나씩 해금됩니다 — 🦀맛살(W2) 🥒오이(W3) 🥚계란(W4) 🥕당근(W6)
          🍢어묵(W8).
        </p>
      </div>
    </>
  );
}
