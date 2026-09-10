import fs from 'node:fs';
import path from 'node:path';
import { RANKING_POLICY, rankingRetryDelay } from './ranking-policy.js';

/** 저장소가 실제로 검증하는 최소 형태. 실제 행은 이걸 확장한다
 *  (@repo/types 의 LeaderboardRow). 저장소는 나머지 필드를 들여다보지 않는다. */
export interface RankingRow {
  id: string;
  shop: string;
  score: number;
  wave?: number;
  at?: string;
}

export interface StoreHealth {
  mode: 'file' | 'redis';
  ready: boolean;
  pending: number;
  error: string | null;
  lastReadAt: number | null;
  lastWriteAt: number | null;
  failures: number;
}

export interface RankingStoreOptions {
  file: string;
  redisUrl?: string;
  redisToken?: string;
  redisKey?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  retryMs?: number;
  onError?: (code: string) => void;
}

export interface RankingStore<T extends RankingRow = RankingRow> {
  init(): Promise<StoreHealth & { where: string; count: number }>;
  read(): T[];
  add(row: T): void;
  flush(): Promise<boolean>;
  health(): StoreHealth;
  close(): void;
}

const valid = (row: unknown): row is RankingRow =>
  !!row &&
  typeof (row as RankingRow).id === 'string' &&
  typeof (row as RankingRow).shop === 'string' &&
  Number.isFinite((row as RankingRow).score);

const compare = (a: RankingRow, b: RankingRow): number =>
  b.score - a.score ||
  (b.wave || 0) - (a.wave || 0) ||
  (String(a.at || '') < String(b.at || '')
    ? -1
    : String(a.at || '') > String(b.at || '')
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0);

export function mergeRankings<T extends RankingRow>(...lists: (T[] | undefined)[]): T[] {
  const all = lists.flat().filter((row): row is T => valid(row));
  return [...new Map(all.map((row) => [row.id, row])).values()]
    .sort(compare)
    .slice(0, RANKING_POLICY.maxEntries);
}

function parse<T extends RankingRow>(raw: string | null | undefined): T[] {
  const list: unknown = raw == null ? [] : JSON.parse(raw);
  if (!Array.isArray(list) || !list.every(valid)) throw Error('invalid_storage_data');
  return list as T[];
}

function atomicFile(target: string, list: readonly RankingRow[]): void {
  const temporary = target + '.' + process.pid + '.tmp';
  let fd: number | undefined;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fd = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(fd, JSON.stringify(list, null, 2), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(temporary);
    } catch {
      // 이 저장소가 만든 임시 파일만 지운다. 없으면 그냥 넘어간다.
    }
  }
}

function readJsonFile<T extends RankingRow>(file: string): T[] {
  try {
    return parse<T>(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

// 한 번의 Redis 연산으로 읽기·병합·쓰기를 끝낸다: 게임 서버가 둘이어도
// 서로의 완료된 판을 덮어쓰지 않는다. ID 가 안정적이라 응답을 잃은 재시도도 멱등하다.
export const MERGE_RANKINGS_LUA = `
local raw = redis.call('GET', KEYS[1])
if raw and not string.match(raw, '^%s*%[') then return redis.error_reply('invalid_storage_data') end
local old = raw and cjson.decode(raw) or {}
local incoming = cjson.decode(ARGV[1])
local byId = {}
for _, list in ipairs({old, incoming}) do
  for _, row in ipairs(list) do
    if type(row) ~= 'table' or type(row.id) ~= 'string' or type(row.shop) ~= 'string' or type(row.score) ~= 'number' then
      return redis.error_reply('invalid_storage_data')
    end
    byId[row.id] = row
  end
end
local merged = {}
for _, row in pairs(byId) do table.insert(merged, row) end
table.sort(merged, function(a,b)
  if a.score ~= b.score then return a.score > b.score end
  if (a.wave or 0) ~= (b.wave or 0) then return (a.wave or 0) > (b.wave or 0) end
  if (a.at or '') ~= (b.at or '') then return (a.at or '') < (b.at or '') end
  return a.id < b.id
end)
while #merged > ${RANKING_POLICY.maxEntries} do table.remove(merged) end
local encoded = #merged == 0 and '[]' or cjson.encode(merged)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

export function createRankingStore<T extends RankingRow = RankingRow>({
  file,
  redisUrl = '',
  redisToken = '',
  redisKey = RANKING_POLICY.redisKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = RANKING_POLICY.timeoutMs,
  retryMs = RANKING_POLICY.retryMs,
  onError = () => {},
}: RankingStoreOptions): RankingStore<T> {
  const redis = !!(redisUrl && redisToken);
  let rows: T[] = [];
  let loaded = false;
  let attempted = false;
  let error: string | null = null;
  let failures = 0;
  let consecutive = 0;
  let lastReadAt: number | null = null;
  let lastWriteAt: number | null = null;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<boolean> | null = null;
  let closed = false;
  let journalLoaded = !redis;
  let journalError: string | null = null;
  const journal = file + '.pending.json';
  const pending = new Map<string, T>();

  const health = (): StoreHealth => ({
    mode: redis ? 'redis' : 'file',
    ready: loaded && journalLoaded && !error && !journalError,
    pending: pending.size,
    error: journalError || error,
    lastReadAt,
    lastWriteAt,
    failures,
  });

  function fail(code: string): void {
    error = code;
    failures++;
    consecutive++;
    // 로그에 URL · 자격증명 · 파일명 · 응답 본문 · 플레이어 이름을 남기지 않는다.
    if (consecutive === 1 || (consecutive & (consecutive - 1)) === 0) onError(code);
  }
  function success(): void {
    error = null;
    consecutive = 0;
  }

  function loadJournal(): boolean {
    if (journalLoaded) return true;
    try {
      for (const row of mergeRankings(readJsonFile<T>(journal), [...pending.values()]))
        pending.set(row.id, row);
      rows = mergeRankings(rows, [...pending.values()]);
      journalLoaded = true;
      journalError = null;
      return true;
    } catch {
      journalError = 'pending_read_failed';
      fail(journalError);
      schedule();
      return false;
    }
  }

  function saveJournal(): boolean {
    if (!journalLoaded) return false;
    try {
      atomicFile(journal, [...pending.values()]);
      journalError = null;
      return true;
    } catch {
      journalError = 'pending_write_failed';
      fail(journalError);
      schedule();
      return false;
    }
  }

  function schedule(): void {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, rankingRetryDelay(retryMs, consecutive));
    timer.unref?.();
  }

  async function command(cmd: (string | number)[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(redisUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + redisToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd),
      });
      const body = (await response.json()) as { error?: unknown; result?: string };
      if (!response.ok || body.error || !Object.hasOwn(body, 'result'))
        throw Error('storage_unavailable');
      return body.result as string;
    } finally {
      clearTimeout(timeout);
    }
  }

  function readFile(): void {
    attempted = true;
    try {
      rows = mergeRankings(readJsonFile<T>(file), [...pending.values()]);
      loaded = true;
      lastReadAt = Date.now();
      success();
    } catch {
      loaded = false;
      fail('storage_read_failed');
      schedule();
    }
  }

  function writeFile(): boolean {
    if (!loaded) readFile();
    // 읽히지 않는/깨진 기존 파일을 빈 캐시로 절대 덮지 않는다.
    if (!loaded) return false;
    try {
      atomicFile(file, rows);
      pending.clear();
      lastWriteAt = Date.now();
      success();
      return true;
    } catch {
      fail('storage_write_failed');
      schedule();
      return false;
    }
  }

  async function drainRedis(): Promise<boolean> {
    try {
      if (!loadJournal()) return false;
      if (!loaded) {
        attempted = true;
        const disk = parse<T>(await command(['GET', redisKey]));
        rows = mergeRankings(disk, [...pending.values()]);
        loaded = true;
        lastReadAt = Date.now();
      }
      while (pending.size && !closed) {
        if (!saveJournal()) return false;
        const batch = [...pending.values()];
        const saved = parse<T>(
          await command(['EVAL', MERGE_RANKINGS_LUA, '1', redisKey, JSON.stringify(batch)]),
        );
        for (const row of batch) pending.delete(row.id);
        rows = mergeRankings(saved, [...pending.values()]);
        lastWriteAt = Date.now();
      }
      if (!saveJournal()) return false;
      success();
      return true;
    } catch {
      fail(loaded ? 'storage_write_failed' : 'storage_read_failed');
      schedule();
      return false;
    }
  }

  function read(): T[] {
    if (!attempted && !redis) readFile();
    return rows;
  }

  function add(row: T): void {
    if (!valid(row)) throw TypeError('Invalid ranking entry');
    if (redis) loadJournal();
    read();
    pending.set(row.id, row);
    rows = mergeRankings(rows, [row]);
    const retained = new Set(rows.map((r) => r.id));
    for (const id of pending.keys()) if (!retained.has(id)) pending.delete(id);
    if (redis) {
      if (saveJournal() && !timer) void flush();
    } else writeFile();
  }

  async function flush(): Promise<boolean> {
    if (closed) return false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!redis) {
      if (!loaded) readFile();
      return pending.size ? writeFile() : loaded && !error;
    }
    if (!running)
      running = drainRedis().finally(() => {
        running = null;
        if (pending.size && !timer && !closed) schedule();
      });
    return running;
  }

  async function init(): Promise<StoreHealth & { where: string; count: number }> {
    await flush();
    return { ...health(), where: redis ? 'Upstash Redis' : file, count: rows.length };
  }

  function close(): void {
    closed = true;
    if (timer) clearTimeout(timer);
  }

  return { init, read, add, flush, health, close };
}
