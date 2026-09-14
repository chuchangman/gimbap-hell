import { NAME_MAX, PLAYER_LIMIT, SHOP_MAX } from '@repo/game-core';
import type { LeaderboardRow } from '@repo/types';

export { SHOP_MAX };

/** 제어문자(U+0000-U+001F, U+007F)를 모두 걷어낸다.
 *  레거시의 전역 정규식 replace 와 같은 결과이며, spec 이 대조해 고정한다. */
export function stripControl(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) out += value[i];
  }
  return out;
}

export function cleanShopName(name: unknown, fallback?: string): string {
  // 레거시와 같은 강제 변환을 유지한다. 숫자·불리언·toString 을 가진 객체가
  // 그대로 들어오고, 평범한 객체는 '[object Object]' 가 된다.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const s = stripControl(String(name ?? ''))
    .trim()
    .slice(0, SHOP_MAX);
  return s || fallback || '이름 없는 김밥집';
}

const finite = (v: unknown, max = Number.MAX_SAFE_INTEGER): number =>
  Number.isFinite(v) ? Math.max(0, Math.min(max, v as number)) : 0;

export interface RunResult {
  shop?: unknown;
  score?: unknown;
  wave?: unknown;
  totalWaves?: unknown;
  kind?: unknown;
  players?: unknown;
  servedRolls?: unknown;
  avgQuality?: unknown;
}

/** 완료된 한 판을 저장 가능한 한 줄로 만든다.
 *  id 와 at 을 밖에서 받는다 — 재시도가 같은 UUID 를 재사용해야 멱등하고,
 *  테스트가 결정적으로 비교할 수 있다. */
export function buildEntry(result: RunResult, id: string, at: string): LeaderboardRow {
  return {
    id,
    shop: cleanShopName(result.shop),
    score: Math.round(finite(result.score)),
    wave: Math.floor(finite(result.wave)),
    totalWaves: Math.floor(finite(result.totalWaves)),
    kind: result.kind === 'victory' ? 'victory' : 'defeat',
    players: (Array.isArray(result.players) ? (result.players as unknown[]) : [])
      .slice(0, PLAYER_LIMIT)
      .map((p) => stripControl(String((p as { name?: unknown })?.name || p)).slice(0, NAME_MAX)),
    rolls: Math.floor(finite(result.servedRolls)),
    avgQuality: finite(result.avgQuality, 100),
    at,
  };
}

/** 가게 이름은 첫 글자만 남기고 가린다 — 랭킹은 공개 API 로도 나간다 */
export function maskShop(name: unknown): string {
  // cleanShopName 과 같은 이유로 레거시 강제 변환을 유지한다.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const chars = Array.from(String(name ?? ''));
  return chars.length <= 1 ? chars.join('') : chars[0] + '●'.repeat(chars.length - 1);
}

export const maskRow = (r: LeaderboardRow): LeaderboardRow => ({ ...r, shop: maskShop(r.shop) });
