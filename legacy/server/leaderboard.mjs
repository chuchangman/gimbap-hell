// Synchronous ranking view backed by atomic file writes or a retrying Redis queue.
// Result screens render immediately; health reports whether storage caught up.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRankingStore } from './ranking-store.mjs';
import { PLAYER_LIMIT, NAME_MAX, SHOP_MAX } from '../public/js/game-rules.js';
import { RANKING_POLICY } from './ranking-policy.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export { SHOP_MAX };
let storage;
function store() {
  return storage ||= createRankingStore({
    file:process.env.GIMBAP_LEADERBOARD || path.join(HERE,'..','data','leaderboard.json'),
    redisUrl:(process.env.UPSTASH_REDIS_REST_URL||'').replace(/\/+$/,''),
    redisToken:process.env.UPSTASH_REDIS_REST_TOKEN||'',
    redisKey:process.env.GIMBAP_LEADERBOARD_KEY||RANKING_POLICY.redisKey,
    onError:code=>console.error('[leaderboard]',code)
  });
}
export const init=()=>store().init();
export const status=()=>store().health();
export const flush=()=>store().flush();
export const close=()=>store().close();

export function cleanShopName(name,fallback) {
  const s=String(name??'').replace(/[\u0000-\u001f\u007f]/gu,'').trim().slice(0,SHOP_MAX);
  return s || fallback || '이름 없는 김밥집';
}
const finite=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isFinite(v)?Math.max(0,Math.min(max,v)):0;

/** Adds one completed server-authoritative run. Retries reuse this same UUID. */
export function add(result) {
  const entry={
    id:randomUUID(), shop:cleanShopName(result.shop),
    score:Math.round(finite(result.score)), wave:Math.floor(finite(result.wave)),
    totalWaves:Math.floor(finite(result.totalWaves)),
    kind:result.kind==='victory'?'victory':'defeat',
    players:(Array.isArray(result.players)?result.players:[]).slice(0,PLAYER_LIMIT)
      .map(p=>String(p?.name||p).replace(/[\u0000-\u001f\u007f]/gu,'').slice(0,NAME_MAX)),
    rolls:Math.floor(finite(result.servedRolls)), avgQuality:finite(result.avgQuality,100),
    at:new Date().toISOString()
  };
  store().add(entry);
  const list=store().read();
  const rank=list.findIndex(r=>r.id===entry.id)+1;
  return {rank:rank||null,total:list.length,entry};
}

export function maskShop(name) {
  const chars=Array.from(String(name??''));
  return chars.length<=1?chars.join(''):chars[0]+'●'.repeat(chars.length-1);
}
const maskRow=r=>({...r,shop:maskShop(r.shop)});
export const top=(n=RANKING_POLICY.topCount)=>store().read().slice(0,n);
export const size=()=>store().read().length;
export const publicTop=n=>top(n).map(maskRow);
export function board(highlightId,n=RANKING_POLICY.topCount) {
  const list=store().read(), head=list.slice(0,n), mine=list.find(r=>r.id===highlightId);
  return {top:head,myRank:mine?list.findIndex(r=>r.id===highlightId)+1:null,total:list.length,
    outside:mine&&!head.some(r=>r.id===highlightId)?mine:null};
}
export function publicBoard(highlightId,n) {
  const b=board(highlightId,n);
  return {...b,top:b.top.map(maskRow),outside:b.outside?maskRow(b.outside):null};
}
