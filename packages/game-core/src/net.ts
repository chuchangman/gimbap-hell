/* 위치 동기화 주기 — 서버와 클라이언트가 같은 값을 봐야 한다.
   예전엔 서버 브로드캐스트 · 클라 송신 · 보간 지연이 세 파일에 따로
   박혀 있어서 한쪽만 고치면 조용히 어긋났다. 여기 하나만 고치면 된다. */
export const NET = {
  tickMs: 67, // 약 15Hz — 클라가 보내는 주기이자 서버가 뿌리는 주기
  interpMs: 135, // 받는 쪽이 재생하는 지연. 주기의 2배 — 한 번 빠져도 버틴다
} as const;

/* ────────────────────────────────────────────────────────────
   원격 플레이어 위치 보간

   위치는 초당 15번만 오는데 화면은 60Hz 이상이다. 받은 좌표를 그대로
   그리면 초당 15번만 움직여 뚝뚝 끊긴다. 표본을 잠깐 쌓아두고 "조금
   과거"를 그리면 항상 앞뒤 두 표본 사이를 지나가므로 등속으로 흐른다.
   대신 남의 아바타가 그만큼 늦게 보인다 — 같이 요리하는 게임이라
   이 정도 지연은 눈에 안 띈다.
   ──────────────────────────────────────────────────────────── */

export interface PathSample {
  t: number;
  x: number;
  z: number;
  y?: number;
  ry: number;
}

/** 두 각도 사이 최단 회전량 (-π ~ π) — 3.1 → -3.1 이 한 바퀴 돌지 않도록 */
export function shortestTurn(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * 시간순 표본 buf 에서 at 시점의 위치를 뽑는다.
 * 범위 밖이면 양 끝 값을 그대로 쓴다 — 없는 미래를 지어내면
 * 벽을 뚫고 나갔다가 되돌아오는 것처럼 보인다.
 */
export function samplePath(buf: PathSample[] | null | undefined, at: number): PathSample | null {
  if (!buf || !buf.length) return null;
  if (at <= buf[0].t) return buf[0];
  const last = buf[buf.length - 1];
  if (at >= last.t) return last;

  for (let i = 1; i < buf.length; i++) {
    const a = buf[i - 1];
    const b = buf[i];
    if (at > b.t) continue;
    const span = b.t - a.t;
    const k = span > 0 ? (at - a.t) / span : 1;
    return {
      t: at,
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * k,
      ry: a.ry + shortestTurn(a.ry, b.ry) * k,
    };
  }
  return last;
}
