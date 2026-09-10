import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createTestEnvironment, ownedTemporaryPath, startIsolatedServer, waitForReady } from '../tools/lib/qa-server.cjs';
import { localQaUrl, loadPlaywright, waitForGameState, waitForOwnPoseSynced } from '../tools/lib/browser-qa.cjs';
import { until } from '../tools/lib/qa-wait.cjs';

test('test server environment isolates storage, origins, ports and inherited server settings',()=>{
  const folder=path.join(os.tmpdir(),'gimbap-qa-example');
  const env=createTestEnvironment(folder,1500,{PATH:'runtime',PORT:'3211',NODE_OPTIONS:'--require private',
    GIMBAP_LEADERBOARD:'production.json',GIMBAP_ALLOWED_ORIGINS:'https://production',GIMBAP_MAX_ROOMS:'1',
    UPSTASH_REDIS_REST_URL:'https://private',UPSTASH_REDIS_REST_TOKEN:'secret'});
  assert.equal(env.PATH,'runtime');assert.equal(env.PORT,'0');assert.equal(env.NODE_ENV,'test');
  assert.equal(env.GIMBAP_RECOVERY_MS,'1500');assert.equal(env.GIMBAP_LEADERBOARD,path.join(folder,'leaderboard.json'));
  assert.equal(env.GIMBAP_ALLOWED_ORIGINS,'');assert.equal(env.UPSTASH_REDIS_REST_URL,'');
  assert.equal(env.UPSTASH_REDIS_REST_TOKEN,'');assert.equal(env.GIMBAP_MAX_ROOMS,undefined);assert.equal(env.NODE_OPTIONS,undefined);
});

test('temporary cleanup only accepts an immediate owned-prefix child of the temp directory',()=>{
  const root=path.resolve(os.tmpdir());
  assert.equal(ownedTemporaryPath(path.join(root,'gimbap-qa-abc'),root),path.join(root,'gimbap-qa-abc'));
  for(const target of [root,path.dirname(root),path.join(root,'not-owned'),path.join(root,'gimbap-qa-x','nested')])
    assert.throws(()=>ownedTemporaryPath(target,root),/Unsafe/);
});

test('readiness waits for a valid ready packet and releases listeners on every outcome',async()=>{
  const child=new EventEmitter();const ready=waitForReady(child,1000,()=> 'fixture');
  child.emit('message',{type:'other'});child.emit('message',{type:'ready',port:4201});assert.equal(await ready,4201);
  for(const event of ['message','exit','error']) assert.equal(child.listenerCount(event),0);
  const broken=new EventEmitter();const failed=waitForReady(broken,1000,()=> 'exit evidence');
  broken.emit('exit',7);await assert.rejects(failed,/exit evidence/);
  assert.equal(broken.listenerCount('message'),0);
  const silent=new EventEmitter();await assert.rejects(waitForReady(silent,5,()=> ''),/timeout/i);
  assert.equal(silent.listenerCount('message'),0);
  const invalid=new EventEmitter();const bad=waitForReady(invalid,1000,()=> '');
  invalid.emit('message',{type:'ready',port:0});await assert.rejects(bad,/port/);
});

test('isolated server owns PORT 0, local empty storage and idempotent cleanup',async()=>{
  const server=await startIsolatedServer({recoveryMs:1500});
  try {
    const response=await fetch(server.url+'/health');const status=await response.json();
    assert.equal(response.status,200);assert.equal(status.rooms,0);assert.equal(status.entries,0);assert.equal(status.store,'file');
    assert.notEqual(new URL(server.url).port,'0');assert.ok(await fs.stat(server.folder));
  } finally {await server.close();await server.close();}
  await assert.rejects(fs.stat(server.folder),{code:'ENOENT'});
  assert.ok(server.child.exitCode!==null||server.child.signalCode!==null);
});

test('browser override accepts loopback origins only and rejects embedded credentials or remote hosts',()=>{
  for(const value of ['http://localhost:3211','http://127.0.0.1:4000/','http://[::1]:3211']) assert.equal(typeof localQaUrl(value),'string');
  for(const value of ['https://example.com','http://localhost.example.com','http://user:pass@localhost:3211',
    'file:///tmp/a','http://localhost:3211/private?x=1','http://localhost:3211/#x']) assert.throws(()=>localQaUrl(value),/local|loopback/i);
});

test('Playwright resolution uses explicit override, then installed dependency then bundled runtime',()=>{
  const tried=[];const expected={chromium:{}};
  const loader=id=>{tried.push(id);if(id==='custom-pw')return expected;throw Error('missing');};
  assert.equal(loadPlaywright({PLAYWRIGHT_PATH:'custom-pw'},loader),expected);assert.deepEqual(tried,['custom-pw']);
  assert.throws(()=>loadPlaywright({PLAYWRIGHT_PATH:'missing'},loader),/missing/);
  const candidates=[];
  assert.equal(loadPlaywright({},id=>{candidates.push(id);if(id==='playwright')throw Error('missing');return expected;}),expected);
  assert.equal(candidates[0],'playwright');assert.ok(candidates[1].includes('codex-primary-runtime'));
});

test('browser state wait observes every input recipient and does not mistake missing state for resumed',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});let guestDone=false;
  const host={waitForFunction:async(fn,state)=>{assert.equal(state.paused,false);await held;}};
  const guest={waitForFunction:async()=>{guestDone=true;}};
  let finished=false;const waiting=waitForGameState([host,guest],{phase:'playing',paused:false}).then(()=>{finished=true;});
  await Promise.resolve();assert.equal(guestDone,true);assert.equal(finished,false);release();await waiting;assert.equal(finished,true);
});

test('pose synchronization wait compares the local camera with the authoritative self entry',async()=>{
  const previous=globalThis.window;
  try {
    globalThis.window={GB:{camera:{position:{x:1,z:2}},S:{meId:'self',positions:[{id:'self',x:1.01,z:2.01}]}}};
    const page={waitForFunction:async(fn,limit)=>fn(limit)};
    assert.equal(await waitForOwnPoseSynced(page,.03),true);
    globalThis.window.GB.S.positions[0].x=1.2;
    assert.equal(await waitForOwnPoseSynced(page,.03),false);
  } finally {globalThis.window=previous;}
});

test('condition polling returns the observed result and reports bounded failure',async()=>{
  let count=0;assert.equal(await until(()=>++count===2?'ready':false,{intervalMs:1,timeoutMs:100}),'ready');
  await assert.rejects(until(()=>false,{intervalMs:1,timeoutMs:3,label:'snapshot'}),/snapshot/);
});
