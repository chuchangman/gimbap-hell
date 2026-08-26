/* ────────────────────────────────────────────────────────────
   가게 랭킹 — 역대 영업 기록을 점수 순으로 모아둔다.

   저장 위치는 두 가지다.
     · 기본     data/leaderboard.json          (로컬 개발 · 자체 호스팅)
     · Upstash  UPSTASH_REDIS_REST_URL + _TOKEN 이 둘 다 있으면 Redis

   Render 무료 플랜은 파일 시스템이 휘발성이다. 재배포뿐 아니라 15분
   미사용으로 잠들었다 깨어나기만 해도 파일이 통째로 사라진다. 그래서
   배포판은 Upstash 를 쓴다.

   읽기(top/size/board)와 쓰기(add)는 전부 동기로 남겨뒀다. room.mjs 가
   add() 바로 다음 줄에서 board() 를 부르기 때문이다. 메모리 캐시(rows)가
   사실상의 원본이고, Upstash 쓰기는 뒤에서 비동기로 따라간다.

   기록 하나:
     { id, shop, score, wave, totalWaves, kind, players[], rolls, avgQuality, at }
     at 은 ISO 8601 UTC 문자열
   ──────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(HERE, '..', 'data');

/* 저장 위치 — GIMBAP_LEADERBOARD 로 덮어쓸 수 있다 (테스트가 실제 기록을 건드리지 않도록) */
const file = () => process.env.GIMBAP_LEADERBOARD || path.join(DEFAULT_DIR, 'leaderboard.json');

/* Upstash Redis (REST) — URL 과 토큰이 둘 다 있을 때만 켜진다 */
const redisUrl = () => (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || '';
const redisKey = () => process.env.GIMBAP_LEADERBOARD_KEY || 'gimbap:leaderboard';
const useRedis = () => !!(redisUrl() && redisToken());

const MAX_ENTRIES = 200;     // 이보다 많아지면 점수 낮은 것부터 버린다
export const SHOP_MAX = 16;  // 가게 이름 길이 제한

let rows = null;             // 메모리 캐시

/** Upstash REST 에 명령 하나 — ['GET', key] 같은 배열을 그대로 보낸다 */
async function redisCmd(command) {
  const res = await fetch(redisUrl(), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + redisToken(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('HTTP ' + res.status + (body.error ? ' — ' + body.error : ''));
  if (body.error) throw new Error(body.error);
  return body.result;
}

/** 가게 이름 정리 — 제어문자 제거 + 길이 제한 */
export function cleanShopName(name, fallback) {
  const s = String(name == null ? '' : name)
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, SHOP_MAX);
  return s || (fallback || '이름 없는 김밥집');
}

function valid(r) {
  return r && typeof r.shop === 'string' && Number.isFinite(r.score);
}

/** 점수 내림차순 → 도달 웨이브 내림차순 → 먼저 세운 기록 우선 */
function sort(list) {
  list.sort((a, b) =>
    (b.score - a.score) ||
    ((b.wave || 0) - (a.wave || 0)) ||
    String(a.at || '').localeCompare(String(b.at || '')));
  return list;
}

function load() {
  if (rows) return rows;
  if (useRedis()) return (rows = []);   // Upstash 모드에선 init() 이 채운다
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    rows = Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    rows = [];               // 파일이 없거나 깨졌으면 빈 랭킹으로 시작
  }
  sort(rows);
  return rows;
}

/**
 * 부팅 때 한 번 — 저장소에서 랭킹을 읽어 캐시에 올린다.
 * 서버가 요청을 받기 전에 await 해야 첫 손님이 빈 랭킹을 보지 않는다.
 * → { mode, where, count, error? }
 */
export async function init() {
  if (!useRedis()) {
    load();
    return { mode: 'file', where: file(), count: rows.length };
  }
  const where = 'Upstash Redis · ' + redisKey();
  try {
    const raw = await redisCmd(['GET', redisKey()]);
    const parsed = raw ? JSON.parse(raw) : [];
    rows = sort(Array.isArray(parsed) ? parsed.filter(valid) : []);
    return { mode: 'redis', where, count: rows.length };
  } catch (err) {
    rows = [];               // 못 읽었어도 게임은 돌아가야 한다
    console.error('[leaderboard] Upstash 읽기 실패:', err.message);
    return { mode: 'redis', where, count: 0, error: err.message };
  }
}

function persist() {
  if (useRedis()) {
    /* 결과 화면을 막지 않도록 뒤에서 쓴다 — 캐시가 이미 최신이라 읽기엔 지장 없다 */
    redisCmd(['SET', redisKey(), JSON.stringify(rows)])
      .catch((err) => console.error('[leaderboard] Upstash 저장 실패:', err.message));
    return;
  }
  try {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), 'utf8');
    fs.renameSync(tmp, target);            // 쓰다 만 파일이 남지 않도록
  } catch (err) {
    console.error('[leaderboard] 저장 실패:', err.message);
  }
}

let seq = 0;
const makeId = () => Date.now().toString(36) + (seq++).toString(36);

/**
 * 기록 추가 → { rank, total, entry }
 * rank 는 1부터. 동점이면 먼저 세운 기록이 앞선다.
 */
export function add(result) {
  const list = load();
  const entry = {
    id: makeId(),
    shop: cleanShopName(result.shop),
    score: Math.max(0, Math.round(result.score || 0)),
    wave: result.wave || 0,
    totalWaves: result.totalWaves || 0,
    kind: result.kind === 'victory' ? 'victory' : 'defeat',
    players: (result.players || []).map((p) => String((p && p.name) || p).slice(0, 12)),
    rolls: result.servedRolls || 0,
    avgQuality: result.avgQuality || 0,
    at: new Date().toISOString()
  };

  list.push(entry);
  sort(list);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  rows = list;
  persist();

  const rank = list.findIndex((r) => r.id === entry.id) + 1;
  return { rank: rank || null, total: list.length, entry };
}

/* ── 화면에 내보낼 형태 ──────────────────────────────────
   가게 이름은 첫 글자만 남기고 가린다. 남이 지은 이름이 랭킹에
   그대로 박히지 않도록. 가리는 일은 서버에서 해야 의미가 있다 —
   클라이언트에서만 가리면 /leaderboard.json 에 원본이 그대로 나온다.
   ──────────────────────────────────────────────────── */

/** '동네김밥집' → '동●●●●' (이모지가 섞여도 글자 단위로 센다) */
export function maskShop(name) {
  const chars = Array.from(String(name == null ? '' : name));
  if (chars.length <= 1) return chars.join('');
  return chars[0] + '●'.repeat(chars.length - 1);
}

const maskRow = (r) => ({ ...r, shop: maskShop(r.shop) });

/** 화면용 상위 n 개 */
export function publicTop(n) {
  return top(n).map(maskRow);
}

/** 화면용 랭킹 묶음 */
export function publicBoard(highlightId, n) {
  const b = board(highlightId, n);
  return { ...b, top: b.top.map(maskRow), outside: b.outside ? maskRow(b.outside) : null };
}

/** 상위 n 개 */
export function top(n) {
  return load().slice(0, n || 10);
}

export function size() { return load().length; }

/** 결과 화면에 보낼 랭킹 묶음 — 이번 판이 밖으로 밀렸으면 뒤에 붙여준다 */
export function board(highlightId, n) {
  const list = load();
  const head = list.slice(0, n || 10);
  const mine = list.find((r) => r.id === highlightId);
  const inHead = !!mine && head.some((r) => r.id === highlightId);
  return {
    top: head,
    myRank: mine ? list.findIndex((r) => r.id === highlightId) + 1 : null,
    total: list.length,
    outside: !inHead && mine ? mine : null
  };
}
