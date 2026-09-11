import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { io } from 'socket.io-client';

let child, url, folder, logs='';
const sockets=new Set();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=5000) {
  const end=Date.now()+ms;
  while(Date.now()<end) { const result=await fn();if(result) return result;await delay(25); }
  throw new Error('Timed out waiting for observed condition');
}
const health=async()=> (await fetch(url+'/health')).json();
const request=(pathname,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=http.request(url,{path:pathname,headers,method},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
  });req.on('error',reject);req.end();
});
async function client(options={}) {
  const s=io(url,{autoConnect:false,transports:['websocket'],reconnection:false,timeout:1500,...options});
  sockets.add(s);s.lastState=null;s.lastKitchen=null;s.hello=null;
  s.on('state',d=>s.lastState=d);s.on('kitchen',d=>s.lastKitchen=d);s.on('hello',d=>s.hello=d);
  s.motionVersion=0;s.corrections=[];
  s.on('position:correct',d=>{s.motionVersion=d.version;s.corrections.push(d);});
  const connected=once(s,'connect');s.connect();await connected;await until(()=>s.hello);return s;
}
const emit=(s,event,data)=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(err,res)=>err?reject(err):resolve(res)));
async function create(s) {
  const result=await emit(s,'room:create',{name:'검사방장',shop:'격리된 QA 가게'});
  // The ACK confirms admission, not that the subsequent snapshots have arrived.
  if(result.ok) await until(()=>s.lastState?.code===result.code && s.lastKitchen);
  return result;
}
const close=s=>{s.disconnect();sockets.delete(s);};
async function walk(s,points) {
  let p={...s.lastState.players.find(p=>p.id===s.id).spawn};
  for(const target of points) {
    const dx=target.x-p.x,dz=target.z-p.z,steps=Math.ceil(Math.hypot(dx,dz)/.32);
    const start={...p};
    for(let i=1;i<=steps;i++) {
      p={x:start.x+dx*i/steps,z:start.z+dz*i/steps,y:0,ry:target.ry||0};
      s.emit('player:move',{...p,version:s.motionVersion});await delay(65);
    }
  }
  assert.equal(s.corrections.length,0,'Normal fixture walking was rejected');return p;
}

before(async()=>{
  folder=await fs.mkdtemp(path.join(os.tmpdir(),'gimbap-protocol-'));
  child=fork(new URL('../legacy/server/index.mjs',import.meta.url),[],{silent:true,env:{...process.env,
    PORT:'0',NODE_ENV:'test',GIMBAP_RECOVERY_MS:'1500',GIMBAP_LEADERBOARD:path.join(folder,'leaderboard.json'),
    UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:'',GIMBAP_ALLOWED_ORIGINS:''}});
  child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
  let startupTimer;
  const ready=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error('Server startup failed: '+logs);}),
    new Promise((_resolve,reject)=>{startupTimer=setTimeout(()=>reject(Error('Server startup timeout: '+logs)),10000);})])
    .finally(()=>clearTimeout(startupTimer));
  assert.equal(ready[0].type,'ready');url='http://localhost:'+ready[0].port;
});
after(async()=>{
  for(const socket of sockets) socket.disconnect();
  if(child?.exitCode===null) { const exited=once(child,'exit');child.kill();await exited; }
  if(folder) await fs.rm(folder,{recursive:true,force:true}); // mkdtemp-owned test fixture only
});
afterEach(async()=>{
  for(const socket of [...sockets]) close(socket);
  if(url && child.exitCode===null) await until(async()=> (await health()).rooms===0,5000);
});

test('bad HTTP requests do not crash the server or expose private files',async()=>{
  for(const p of ['/%','/%E0%A4%A','/..%5cserver%5cindex.mjs','/.env','/%00','/../server/index.mjs'])
    assert.equal((await request(p)).status,400,p);
  assert.equal((await request('/server/index.mjs')).status,404);
  assert.equal((await request('/','', 'POST')).status,405);
  assert.equal((await health()).ok,true);
  assert.ok((await health()).rejected.invalidHttp>=6);
});

test('static asset responses have bounded caching, compression, MIME and script policy',async()=>{
  const first=await request('/js/world.js');assert.equal(first.status,200);
  assert.equal(first.headers['x-content-type-options'],'nosniff');
  assert.match(first.headers['content-security-policy'],/script-src 'self' 'sha256-/);
  assert.equal((await request('/js/world.js',{'If-None-Match':first.headers.etag})).status,304);
  const zipped=await request('/js/world.js',{'Accept-Encoding':'gzip'});
  assert.equal(zipped.headers['content-encoding'],'gzip');assert.ok(zipped.body.length<first.body.length/2);
  // GLB MIME is checked by apps/server/src/static.client.spec.ts: the game assets
  // now live in apps/client/public/assets, not in the legacy tree served here.
  const head=await request('/js/world.js',{},'HEAD');assert.equal(head.body.length,0);assert.ok(Number(head.headers['content-length'])>0);
  assert.equal((await request('/ready')).status,200);
});

test('malformed socket data and non-function callback arguments cannot terminate the process',async()=>{
  const s=await client();
  for(const name of [{},[],42,null,'a']) assert.equal((await emit(s,'room:create',{name})).ok,false);
  s.emit('room:create',{name:{toString:'not a function'}},'not a callback');
  s.emit('kitchen:act',{action:'mat:roll',payload:{mat:'__proto__'}});
  await until(async()=> (await health()).rejected.invalidEvents>=3);
  assert.equal((await health()).ok,true);close(s);
});

test('one socket cannot leak rooms or receive another room after a duplicate join',async()=>{
  const a=await client(),b=await client();
  const ra=await create(a),rb=await create(b);assert.ok(ra.ok&&rb.ok);
  assert.equal((await create(a)).ok,false);
  assert.equal((await emit(a,'room:join',{name:'중복입장',code:rb.code})).ok,false);
  assert.equal((await health()).rooms,2);
  b.emit('game:start');await until(()=>b.lastState?.phase==='playing');
  assert.equal(a.lastState.code,ra.code);assert.equal(a.lastState.phase,'lobby');
  close(a);close(b);await until(async()=> (await health()).rooms===0);
});

test('six-player cap, host authority, unlocks and index validation work over the wire',async()=>{
  const host=await client();const room=await create(host);const guests=[];
  for(let i=0;i<6;i++) {const g=await client();guests.push(g);const result=await emit(g,'room:join',{name:'동료'+i,code:room.code});assert.equal(result.ok,i<5);}
  guests[0].emit('game:start');await delay(100);assert.equal(host.lastState.phase,'lobby');
  host.emit('game:start');await until(()=>host.lastState.phase==='playing');
  guests[0].emit('game:pause');await delay(50);assert.equal(host.lastState.paused,false);
  host.emit('kitchen:act',{action:'fridge:take',payload:{item:'fishcake'}});
  await delay(75);assert.equal(host.lastKitchen.hands.find(h=>h.id===host.id).holding,null);
  host.emit('kitchen:act',{action:'mat:roll',payload:{mat:'constructor'}});
  await walk(host,[{x:-4.4,z:5.6},{x:-4.4,z:-5.4}]);
  host.emit('kitchen:act',{action:'fridge:take',payload:{item:'gim'}});
  await until(()=>host.lastKitchen.hands.find(h=>h.id===host.id).holding?.id==='gim');
  host.emit('game:lobby');await delay(50);assert.equal(host.lastState.phase,'playing');
  close(host);for(const g of guests) close(g);await until(async()=> (await health()).rooms===0);
});

test('transient host disconnect preserves identity, pose and hand, pauses and resumes timers',async()=>{
  const host=await client(),guest=await client();const r=await create(host);
  await emit(guest,'room:join',{name:'복구동료',code:r.code});host.emit('game:start');
  await until(()=>host.lastState.phase==='playing');
  const expected=await walk(host,[{x:-4.4,z:5.6},{x:-4.4,z:-4.25,ry:1}]);
  host.emit('kitchen:act',{action:'fridge:take',payload:{item:'rice'}});
  await until(()=>host.lastKitchen.hands.find(h=>h.id===host.id).holding?.id==='rice');
  const id=host.id,prepEnd=host.lastState.wave.phaseEndsAt;
  const disconnected=once(host,'disconnect');host.io.engine.close();await disconnected;
  await until(()=>guest.lastState.paused===true && guest.lastState.players.find(p=>p.id===id).connected===false);
  await delay(150);
  const reconnected=once(host,'connect');host.connect();await reconnected;
  await until(()=>host.hello.restored===true && host.lastState.paused===false);
  assert.equal(host.id,id);assert.equal(host.hello.pose.x,expected.x);assert.equal(host.hello.pose.ry,1);
  assert.equal(host.lastKitchen.hands.find(h=>h.id===id).holding.id,'rice');
  if(prepEnd) assert.ok(host.lastState.wave.phaseEndsAt>=prepEnd+100);
  assert.ok((await health()).rejected.recovered>=1);
  close(host);close(guest);await until(async()=> (await health()).rooms===0);
});

test('expired host reservation transfers authority and cannot leave the remaining player stuck',async()=>{
  const host=await client(),guest=await client();const r=await create(host);
  await emit(guest,'room:join',{name:'새로운방장',code:r.code});host.emit('game:start');
  await until(()=>guest.lastState?.phase==='playing');
  host.io.engine.close();await until(()=>guest.lastState.paused);
  await until(()=>guest.lastState.players.length===1 && guest.lastState.hostId===guest.id,4000);
  guest.emit('game:pause');await until(()=>guest.lastState.paused===false);
  assert.equal((await health()).recoveryPending,0);
  close(host);close(guest);await until(async()=> (await health()).rooms===0);
});

test('rate limits and websocket origin checks are enforced without affecting healthy clients',async()=>{
  const s=await client();const before=(await health()).rejected.rateLimited;
  for(let i=0;i<30;i++) s.emit('room:create',{name:'요청검사'});
  await until(async()=> (await health()).rejected.rateLimited>before);
  assert.equal((await health()).rooms,1);
  const attacker=io(url,{transports:['websocket'],reconnection:false,extraHeaders:{Origin:'https://untrusted.example'}});
  sockets.add(attacker);await once(attacker,'connect_error');assert.equal(attacker.connected,false);close(attacker);
  assert.equal((await health()).ok,true);close(s);await until(async()=> (await health()).rooms===0);
});

test('remote item requests and teleported coordinates cannot bypass server proximity checks',async()=>{
  const s=await client();await create(s);s.emit('game:start');await until(()=>s.lastState.phase==='playing');
  const before=(await health()).rejected.rejectedDistance||0;
  s.emit('kitchen:act',{action:'fridge:take',payload:{item:'rice'}});
  await until(async()=>((await health()).rejected.rejectedDistance||0)>before);
  assert.equal(s.lastKitchen.hands.find(h=>h.id===s.id).holding,null);
  s.emit('player:move',{x:-4.4,z:-4.25,y:0,ry:0,version:0});
  await until(()=>s.corrections.length===1);
  assert.equal(s.corrections[0].x,-1.6);assert.equal(s.corrections[0].z,5.6);
  s.emit('player:move',{x:-4.4,z:-4.25,y:0,ry:0,version:0}); // queued before correction
  s.emit('kitchen:act',{action:'fridge:take',payload:{item:'rice',kind:'serve'}});
  await until(async()=>((await health()).rejected.rejectedDistance||0)>before+1);
  assert.equal(s.lastKitchen.hands.find(h=>h.id===s.id).holding,null);
  s.emit('player:move',{x:-1.7,z:5.6,y:0,ry:0,version:s.motionVersion});
  await delay(90);assert.equal(s.corrections.length,1,'Fresh legitimate move should not be corrected');
});
