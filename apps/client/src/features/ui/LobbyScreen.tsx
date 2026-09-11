/* ────────────────────────────────────────────────────────────
   대기실 — 방 코드 · 참가자 · 공정 안내 · 지난 영업 · 가게 랭킹.
   서버 스냅샷(`S.state`)을 그대로 읽어 그린다.
   ──────────────────────────────────────────────────────────── */
import { emit, isHost, S } from '@/features/net/net';
import { CompactBoard } from '@/features/ui/Board';
import { TIME } from '@repo/game-core';
import { useState } from 'react';

export function LobbyScreen({ active }: { active: boolean }) {
  const st = S.state;
  const host = isHost();
  const [copied, setCopied] = useState<'good' | 'bad' | null>(null);

  const copyInvite = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(location.origin + '/#' + (st?.code ?? ''));
      setCopied('good');
    } catch {
      setCopied('bad');
    }
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section id="screen-lobby" className={'screen solid scrollable' + (active ? ' active' : '')}>
      <div className="lobby-layout">
        {/* 좌측 — 가게 랭킹 (이름은 첫 글자만) */}
        <aside className="card lobby-board">
          <h3>🏆 가게 랭킹</h3>
          <CompactBoard active={active} />
          <p className="hint small">가게 이름은 첫 글자만 보입니다.</p>
        </aside>

        <div className="card wide">
          <h2 className="shop-name" id="lobby-shop">
            🍣 {st ? st.shop || st.code : '김밥지옥'}
          </h2>
          <div className="room-code">
            <span className="label">방 코드</span>
            <strong id="lobby-code">{st?.code ?? '----'}</strong>
            <button id="btn-copy" className="btn tiny" onClick={() => void copyInvite()}>
              {copied === 'good'
                ? '복사했습니다'
                : copied === 'bad'
                  ? '복사 실패'
                  : '초대 링크 복사'}
            </button>
          </div>

          <p className="hint">
            역할 구분은 없습니다. 누구나 재료를 손질하고, 누구나 서빙합니다. <b>2~5명 권장</b>
          </p>

          <h3>참가자</h3>
          <ul id="player-list" className="player-list">
            {st?.players.map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                <span className={p.id === S.meId ? 'me' : ''}>{p.name}</span>
                {p.id === st.hostId && <span className="tag">방장</span>}
                {p.connected === false && <span className="tag">연결 복구 중</span>}
              </li>
            ))}
          </ul>

          <div className="howto">
            <h3>이렇게 굴러갑니다</h3>
            <ol>
              <li>
                <b>준비 시간</b>({TIME.riceCook}초 취사 × 여러 번) 동안 밥과 속재료를 쌓아둡니다.
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

          {host ? (
            <div className="host-only" id="host-controls">
              <p className="hint" id="party-desc">
                인원 {st?.players.length ?? 1}명 기준으로 손님 수가 자동 조정됩니다.
              </p>
              <button id="btn-start" className="btn primary big" onClick={() => emit('game:start')}>
                영업 시작
              </button>
            </div>
          ) : (
            <p className="hint" id="not-host-hint">
              방장이 시작하기를 기다리는 중...
            </p>
          )}

          <div id="lobby-history">
            {!!st?.history.length && (
              <>
                <h3>지난 영업</h3>
                {st.history.map((h, i) => (
                  <div className="row" key={h.at + '-' + i}>
                    <span>{h.kind === 'victory' ? '🎉 완주' : '💀 웨이브 ' + h.wave}</span>
                    <b>{h.score}점</b>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
