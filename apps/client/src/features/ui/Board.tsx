/* 🏆 가게 랭킹 — 대기실 좌측(간략)과 결과 화면(상세)이 같은 조각을 쓴다.
   가게 이름은 서버가 이미 첫 글자만 남겨서 준다. */
import type { LeaderboardRow } from '@repo/types';
import { useEffect, useState } from 'react';

export const medal = (n: number): string =>
  n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : n + '위';

/** 대기실에 앉아 있는 동안 30초마다 다시 받는다 */
const REFRESH_MS = 30000;

export function useLeaderboard(active: boolean): {
  rows: LeaderboardRow[] | null;
  failed: boolean;
} {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/leaderboard.json', { cache: 'no-store' });
        const list = (await res.json()) as LeaderboardRow[];
        if (!alive) return;
        setRows(list);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);

  return { rows, failed };
}

/** 대기실 좌측 — 이름과 점수만 */
export function CompactBoard({ active }: { active: boolean }) {
  const { rows, failed } = useLeaderboard(active);
  return (
    <ol className="board compact" id="lobby-board-list">
      {failed ? (
        <li className="none">랭킹을 불러오지 못했습니다.</li>
      ) : !rows ? (
        <li className="none">불러오는 중...</li>
      ) : rows.length ? (
        rows.slice(0, 10).map((r, i) => (
          <li key={r.id}>
            <span className="pos">{medal(i + 1)}</span>
            <span className="shop">{r.shop}</span>
            <b className="pts">{r.score}</b>
          </li>
        ))
      ) : (
        <li className="none">아직 기록이 없습니다.</li>
      )}
    </ol>
  );
}

/** 결과 화면 한 줄 — 기록 시각과 성적까지 */
export function BoardRow({ row, n, mine }: { row: LeaderboardRow; n: number; mine: boolean }) {
  const when = row.at
    ? new Date(row.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
    : '';
  return (
    <li className={mine ? 'mine' : ''}>
      <span className="pos">{medal(n)}</span>
      <span className="shop">
        {row.shop}
        {mine && <em> ← 이번 판</em>}
      </span>
      <span className="meta">
        {row.kind === 'victory' ? '🎉 완주' : 'W' + row.wave} · 🍣{row.rolls} · ⭐{row.avgQuality}
      </span>
      <span className="when">{when}</span>
      <b className="pts">{row.score}</b>
    </li>
  );
}
