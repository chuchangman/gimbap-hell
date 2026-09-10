import fs from 'node:fs';
import path from 'node:path';
import { RANKING_POLICY, rankingRetryDelay } from './ranking-policy.mjs';

const valid = row => row && typeof row.id === 'string' && typeof row.shop === 'string' && Number.isFinite(row.score);
const compare = (a,b) => (b.score-a.score) || ((b.wave||0)-(a.wave||0)) ||
  (String(a.at||'') < String(b.at||'') ? -1 : String(a.at||'') > String(b.at||'') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function mergeRankings(...lists) {
  return [...new Map(lists.flat().filter(valid).map(row=>[row.id,row])).values()].sort(compare).slice(0,RANKING_POLICY.maxEntries);
}
function parse(raw) {
  const list = raw == null ? [] : JSON.parse(raw);
  if (!Array.isArray(list) || !list.every(valid)) throw Error('invalid_storage_data');
  return list;
}

function atomicFile(target,list) {
  const temporary=target+'.'+process.pid+'.tmp';
  let fd;
  try {
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fd=fs.openSync(temporary,'w',0o600);
    fs.writeFileSync(fd,JSON.stringify(list,null,2),'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temporary,target);
  } finally {
    if(fd!==undefined) fs.closeSync(fd);
    try {fs.unlinkSync(temporary);} catch {} // This store's exact scratch file only.
  }
}
function readJsonFile(file) {
  try {return parse(fs.readFileSync(file,'utf8'));} catch(e) {if(e.code==='ENOENT')return [];throw e;}
}

// Read/merge/write in one Redis operation: two game servers cannot overwrite
// each other's completed runs. Stable IDs also make an uncertain retry idempotent.
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

export function createRankingStore({file, redisUrl='', redisToken='', redisKey=RANKING_POLICY.redisKey,
  fetchImpl=globalThis.fetch, timeoutMs=RANKING_POLICY.timeoutMs, retryMs=RANKING_POLICY.retryMs, onError=()=>{}}) {
  const redis=!!(redisUrl && redisToken);
  let rows=[], loaded=false, attempted=false, error=null, failures=0, consecutive=0;
  let lastReadAt=null, lastWriteAt=null, timer=null, running=null, closed=false;
  let journalLoaded=!redis, journalError=null;
  const journal=file+'.pending.json';
  const pending=new Map();
  const health=()=>({mode:redis?'redis':'file',ready:loaded&&journalLoaded&&!error&&!journalError,pending:pending.size,
    error:journalError||error,lastReadAt,lastWriteAt,failures});
  function fail(code) {
    error=code; failures++; consecutive++;
    // No URLs, credentials, filenames, response bodies or player names in logs.
    if(consecutive===1 || (consecutive & (consecutive-1))===0) onError(code);
  }
  function success() { error=null; consecutive=0; }
  function loadJournal() {
    if(journalLoaded)return true;
    try {
      for(const row of mergeRankings(readJsonFile(journal),[...pending.values()])) pending.set(row.id,row);
      rows=mergeRankings(rows,[...pending.values()]);journalLoaded=true;journalError=null;return true;
    } catch {journalError='pending_read_failed';fail(journalError);schedule();return false;}
  }
  function saveJournal() {
    if(!journalLoaded)return false;
    try {atomicFile(journal,[...pending.values()]);journalError=null;return true;}
    catch {journalError='pending_write_failed';fail(journalError);schedule();return false;}
  }
  function schedule() {
    if(closed || timer) return;
    timer=setTimeout(()=>{timer=null;void flush();},rankingRetryDelay(retryMs,consecutive));
    timer.unref?.();
  }
  async function command(command) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetchImpl(redisUrl,{method:'POST',signal:controller.signal,
        headers:{Authorization:'Bearer '+redisToken,'Content-Type':'application/json'},body:JSON.stringify(command)});
      const body=await response.json();
      if(!response.ok || body.error || !Object.hasOwn(body,'result')) throw Error('storage_unavailable');
      return body.result;
    } finally { clearTimeout(timeout); }
  }
  function readFile() {
    attempted=true;
    try {
      rows=mergeRankings(readJsonFile(file),[...pending.values()]);
      loaded=true; lastReadAt=Date.now(); success();
    } catch { loaded=false;fail('storage_read_failed');schedule(); }
  }
  function writeFile() {
    if(!loaded) readFile();
    if(!loaded) return false; // Never replace an unreadable/corrupt existing file with an empty cache.
    try {
      atomicFile(file,rows);
      pending.clear();lastWriteAt=Date.now();success();return true;
    } catch { fail('storage_write_failed');schedule();return false; }
  }
  async function drainRedis() {
    try {
      if(!loadJournal())return false;
      if(!loaded) {
        attempted=true;
        const disk=parse(await command(['GET',redisKey]));
        rows=mergeRankings(disk,[...pending.values()]);loaded=true;lastReadAt=Date.now();
      }
      while(pending.size && !closed) {
        if(!saveJournal())return false;
        const batch=[...pending.values()];
        const saved=parse(await command(['EVAL',MERGE_RANKINGS_LUA,'1',redisKey,JSON.stringify(batch)]));
        for(const row of batch) pending.delete(row.id);
        rows=mergeRankings(saved,[...pending.values()]);lastWriteAt=Date.now();
      }
      if(!saveJournal())return false;
      success();return true;
    } catch { fail(loaded?'storage_write_failed':'storage_read_failed');schedule();return false; }
  }
  function read() { if(!attempted && !redis) readFile();return rows; }
  function add(row) {
    if(!valid(row)) throw TypeError('Invalid ranking entry');
    if(redis)loadJournal();
    read();pending.set(row.id,row);rows=mergeRankings(rows,[row]);
    const retained=new Set(rows.map(r=>r.id));
    for(const id of pending.keys()) if(!retained.has(id)) pending.delete(id);
    if(redis) { if(saveJournal() && !timer) void flush(); }
    else writeFile();
  }
  async function flush() {
    if(closed) return false;
    if(timer) {clearTimeout(timer);timer=null;}
    if(!redis) {if(!loaded) readFile();return pending.size?writeFile():loaded&&!error;}
    if(!running) running=drainRedis().finally(()=>{
      running=null;
      if(pending.size && !timer && !closed)schedule();
    });
    return running;
  }
  async function init() { await flush();return {...health(),where:redis?'Upstash Redis':file,count:rows.length}; }
  function close() {closed=true;if(timer)clearTimeout(timer);}
  return {init,read,add,flush,health,close};
}
