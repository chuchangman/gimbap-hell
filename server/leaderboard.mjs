/* ────────────────────────────────────────────────────────────
   가게 랭킹 — 역대 영업 기록을 점수 순으로 모아둔다.
   data/leaderboard.json 에 저장하므로 서버를 껐다 켜도 남는다.

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

const MAX_ENTRIES = 200;     // 이보다 많아지면 점수 낮은 것부터 버린다
export const SHOP_MAX = 16;  // 가게 이름 길이 제한

let rows = null;             // 메모리 캐시

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
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    rows = Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    rows = [];               // 파일이 없거나 깨졌으면 빈 랭킹으로 시작
  }
  sort(rows);
  return rows;
}

function persist() {
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
