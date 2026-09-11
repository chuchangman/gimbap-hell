/* ────────────────────────────────────────────────────────────
   결과 — 점수 · 성적표 · 가게 랭킹 · 다음엔 이렇게.
   서버가 준 `S.state.result` 를 그대로 읽어 그린다.
   ──────────────────────────────────────────────────────────── */
import { emit, isHost, S } from '@/features/net/net';
import { BoardRow } from '@/features/ui/Board';
import type { ResultView } from '@repo/types';

/** 저장은 비동기다 — 아직 안 끝났으면 순위가 임시라고 알려 준다 */
function storageNote(r: ResultView): string {
  if (!r.storage) return '';
  if (r.storage.error)
    return '랭킹 저장을 재시도하고 있습니다. 현재 순위는 임시이며 아직 저장 완료되지 않았습니다.';
  if (r.storage.pending) return '랭킹을 저장하고 있습니다. 현재 순위는 임시입니다.';
  return '랭킹 저장 완료';
}

function tipsFor(r: ResultView): string[] {
  const tips: string[] = [];
  if (r.angry)
    tips.push(
      '손님이 나가면 평판 −12. 김밥을 들면 조합이 맞는 손님에게 테두리가 생기고, 좌측 주문서에서는 그중 가장 급한 한 명에게만 줄이 그어집니다.',
    );
  if (r.avgQuality < 80) tips.push('속재료 3종을 다 넣고 5초에 맞춰 꺼내야 품질 100 이 나옵니다.');
  if (r.mess) tips.push('못 쓰는 재료는 Q 말고 음쓰통에 버리세요.');
  tips.push(
    '준비 시간에 밥 5인분을 미리 지어두고 속재료를 쌓아두면 웨이브를 훨씬 수월하게 넘깁니다.',
  );
  return tips;
}

function Board({ r }: { r: ResultView }) {
  const b = r.board;
  if (!b?.top?.length)
    return (
      <>
        <p className="rank-line" id="r-rank-line" />
        <ol className="board" id="r-board">
          <li className="none">아직 기록이 없습니다.</li>
        </ol>
      </>
    );
  return (
    <>
      <p className="rank-line" id="r-rank-line">
        {r.rank ? (
          <>
            <b>{r.shop}</b> — 역대 <b>{b.total}개</b> 가게 중 <b className="hl">{r.rank}위</b>
            {r.rank === 1 ? ' 🏆 신기록!' : ''}
          </>
        ) : (
          r.shop
        )}
      </p>
      <ol className="board" id="r-board">
        {b.top.map((row, i) => (
          <BoardRow key={row.id} row={row} n={i + 1} mine={row.id === r.entryId} />
        ))}
        {/* 이번 판이 10위 밖이면 아래에 따로 붙여준다 */}
        {b.outside && (
          <>
            <li className="gap">⋯</li>
            <BoardRow row={b.outside} n={b.myRank ?? 0} mine />
          </>
        )}
      </ol>
    </>
  );
}

export function ResultScreen({ active }: { active: boolean }) {
  const r = S.state?.result ?? null;
  const host = isHost();
  const win = r?.kind === 'victory';

  const rows: [string, string][] = r
    ? [
        ['🌊 도달 웨이브', r.wave + ' / ' + r.totalWaves],
        ['🍣 만든 김밥', r.servedRolls + ' 줄'],
        ['⭐ 평균 품질', r.avgQuality + ' 점'],
        ['😋 만족하고 간 손님', r.happy + ' 명'],
        ['😡 그냥 나간 손님', r.angry + ' 명'],
        ['🏪 남은 평판', r.reputation + ' / ' + r.reputationMax],
        ['🧼 바닥에 버린 재료', r.mess + ' 개 (−' + r.messPenalty + '점)'],
      ]
    : [];

  return (
    <section id="screen-result" className={'screen solid scrollable' + (active ? ' active' : '')}>
      <div className="card wide result-card">
        <h1 id="r-title" className={r ? (win ? 'win' : 'lose') : ''}>
          {r ? (win ? '🎉 10웨이브 완주!' : '💀 폐업...') : '결과'}
        </h1>
        <p className="tagline" id="r-sub">
          {r &&
            (win
              ? '손님을 모두 받아냈습니다. 대단한 김밥집이네요.'
              : '웨이브 ' + r.wave + ' 에서 평판이 바닥났습니다.')}
        </p>
        <div className="score-hero">
          <div className="big-score">
            <span id="r-total">{r?.score ?? 0}</span>
            <em>점</em>
          </div>
          <div className="players" id="r-players">
            {r?.players.map((p, i) => (
              <span className="chip-p" key={p.name + i} style={{ borderColor: p.color }}>
                {p.name}
              </span>
            ))}
          </div>
        </div>

        <div className="rows" id="r-rows">
          {rows.map(([k, v]) => (
            <div className="row" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>

        <h3>🏆 가게 랭킹</h3>
        {r ? (
          <>
            <Board r={r} />
            <p className="hint" id="r-storage-status" role="status" aria-live="polite">
              {storageNote(r)}
            </p>
          </>
        ) : (
          <>
            <p className="rank-line" id="r-rank-line" />
            <p className="hint" id="r-storage-status" role="status" aria-live="polite" />
            <ol className="board" id="r-board" />
          </>
        )}

        <h3>다음엔 이렇게</h3>
        <ul className="tips" id="r-tips">
          {r && tipsFor(r).map((t) => <li key={t}>{t}</li>)}
        </ul>

        {host ? (
          <div id="r-host">
            <button
              id="btn-to-lobby"
              className="btn primary big"
              onClick={() => emit('game:lobby')}
            >
              대기실로 — 한 판 더
            </button>
          </div>
        ) : (
          <p className="hint" id="r-guest">
            방장이 다음 판을 준비합니다.
          </p>
        )}
      </div>
    </section>
  );
}
