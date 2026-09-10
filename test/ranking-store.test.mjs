import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRankingStore,mergeRankings} from '../server/ranking-store.mjs';

const row=(id,score=100)=>({id,shop:'검사 가게',score,wave:1,at:'2026-09-08T00:00:00.000Z'});
async function fixture(t) {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gimbap-ranking-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  return path.join(folder,'leaderboard.json');
}
function mockRedis(initial=[]) {
  const state={rows:initial,failRead:false,failWrite:false,loseReply:false,commands:[],active:0,maxActive:0};
  state.fetch=async(_url,options)=>{
    const command=JSON.parse(options.body);state.commands.push(command[0]);
    state.active++;state.maxActive=Math.max(state.maxActive,state.active);
    try {
      await new Promise(resolve=>setTimeout(resolve,5));
      if(command[0]==='GET') {
        if(state.failRead) throw Error('secret response must not be logged');
        return {ok:true,json:async()=>({result:JSON.stringify(state.rows)})};
      }
      assert.equal(command[0],'EVAL');
      if(state.failWrite) throw Error('secret response must not be logged');
      state.rows=mergeRankings(state.rows,JSON.parse(command[4]));
      if(state.loseReply) {state.loseReply=false;throw Error('Lost response after commit');}
      return {ok:true,json:async()=>({result:JSON.stringify(state.rows)})};
    } finally {state.active--;}
  };
  return state;
}
async function remote(t,mock,extra={}) {
  const file=await fixture(t);
  const store=createRankingStore({file,redisUrl:'http://isolated-test.invalid',redisToken:'test-only',
    fetchImpl:mock.fetch,retryMs:100000,...extra});
  t.after(()=>store.close());return store;
}

test('atomic file saves survive a new store instance and retain top 200',async t=>{
  const file=await fixture(t),a=createRankingStore({file});t.after(()=>a.close());
  assert.equal((await a.init()).ready,true);
  for(let i=0;i<205;i++) a.add(row('run-'+i,i));
  const b=createRankingStore({file});t.after(()=>b.close());await b.init();
  assert.equal(b.read().length,200);assert.equal(b.read()[0].score,204);assert.equal(b.read().at(-1).score,5);
  assert.equal(b.health().pending,0);
  assert.deepEqual(await fs.readdir(path.dirname(file)),['leaderboard.json']);
});

test('a corrupt file is never silently overwritten and can recover after operator repair',async t=>{
  const file=await fixture(t);await fs.writeFile(file,'{incomplete');
  const store=createRankingStore({file,retryMs:100000});t.after(()=>store.close());
  assert.equal((await store.init()).ready,false);store.add(row('pending'));
  assert.equal(await fs.readFile(file,'utf8'),'{incomplete');assert.equal(store.health().pending,1);
  await fs.writeFile(file,JSON.stringify([row('preserved',500)]));
  assert.equal(await store.flush(),true);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')).map(r=>r.id),['preserved','pending']);
  assert.equal(store.health().error,null);
});

test('failed initial Redis read never overwrites unseen records',async t=>{
  const redis=mockRedis([row('existing',1000)]);redis.failRead=true;
  const store=await remote(t,redis);assert.equal((await store.init()).ready,false);
  store.add(row('new'));assert.equal(await store.flush(),false);
  assert.ok(!redis.commands.includes('EVAL'));assert.equal(redis.rows.length,1);
  redis.failRead=false;assert.equal(await store.flush(),true);
  assert.deepEqual(store.read().map(r=>r.id),['existing','new']);assert.equal(store.health().ready,true);
});

test('Redis writes are serialized and a record added during a request is not lost',async t=>{
  const redis=mockRedis(),store=await remote(t,redis);await store.init();
  store.add(row('one'));store.add(row('two',200));store.add(row('three',300));
  assert.equal(await store.flush(),true);assert.equal(redis.maxActive,1);
  assert.deepEqual(redis.rows.map(r=>r.id),['three','two','one']);assert.equal(store.health().pending,0);
});

test('uncertain Redis response is retried with stable IDs without duplicate ranking',async t=>{
  const redis=mockRedis(),logs=[],store=await remote(t,redis,{onError:code=>logs.push(code)});await store.init();
  redis.loseReply=true;store.add(row('same-id'));assert.equal(await store.flush(),false);
  assert.equal(store.health().ready,false);assert.equal(store.health().pending,1);
  assert.equal(await store.flush(),true);assert.equal(redis.rows.length,1);
  assert.deepEqual(logs,['storage_write_failed']);assert.equal(store.health().ready,true);
});

test('automatic retry clears runtime errors and pending writes',async t=>{
  const redis=mockRedis(),store=await remote(t,redis,{retryMs:10});await store.init();redis.failWrite=true;
  store.add(row('retry'));assert.equal(await store.flush(),false);redis.failWrite=false;
  const end=Date.now()+2000;
  while(store.health().pending && Date.now()<end) await new Promise(r=>setTimeout(r,10));
  assert.equal(store.health().pending,0);assert.equal(store.health().ready,true);assert.equal(redis.rows.length,1);
});

test('stalled REST requests are aborted within the configured timeout',async t=>{
  const mock={fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))};
  const store=await remote(t,mock,{timeoutMs:30});const start=Date.now();
  assert.equal((await store.init()).ready,false);assert.ok(Date.now()-start<500);assert.equal(store.health().error,'storage_read_failed');
});

test('ranking merge is idempotent and deterministically ordered',()=>{
  assert.deepEqual(mergeRankings([row('b'),row('a')],[row('a')]).map(r=>r.id),['a','b']);
});

test('a pending Redis run survives process-local state loss via its durable outbox',async t=>{
  const file=await fixture(t),redis=mockRedis();redis.failWrite=true;
  const options={file,redisUrl:'http://isolated-test.invalid',redisToken:'test-only',fetchImpl:redis.fetch,retryMs:100000};
  const first=createRankingStore(options);t.after(()=>first.close());await first.init();
  first.add(row('survives-restart'));assert.equal(await first.flush(),false);first.close();
  assert.equal(JSON.parse(await fs.readFile(file+'.pending.json','utf8')).length,1);
  redis.failWrite=false;
  const restarted=createRankingStore(options);t.after(()=>restarted.close());
  assert.equal((await restarted.init()).ready,true);
  assert.equal(redis.rows[0].id,'survives-restart');assert.equal(restarted.health().pending,0);
  assert.deepEqual(JSON.parse(await fs.readFile(file+'.pending.json','utf8')),[]);
});
