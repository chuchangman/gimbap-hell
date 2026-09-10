// Real Redis/Lua verification. Uses REDIS_TEST_PORT (CI service) or an owned,
// ephemeral Docker container; never reads deployment URLs or real credentials.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,fork} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRankingStore,MERGE_RANKINGS_LUA} from '../server/ranking-store.mjs';

let container,port,bridge,url,folder;
let failRequests=false;
const children=new Set();
const keys=new Set(),stores=[];
const row=(id,score=100)=>({id,shop:'🍣 검증 가게',score,wave:2,at:'2026-09-08T00:00:00.000Z'});
function redis(command) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});let buffer=Buffer.alloc(0);
    const finish=(error,result)=>{socket.destroy();error?reject(error):resolve(result);};
    socket.setTimeout(3000,()=>finish(Error('Redis test timeout')));socket.on('error',reject);
    socket.on('connect',()=>socket.write(Buffer.concat([Buffer.from('*'+command.length+'\r\n'),
      ...command.flatMap(value=>{const b=Buffer.from(String(value));return [Buffer.from('$'+b.length+'\r\n'),b,Buffer.from('\r\n')];})])));
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);const end=buffer.indexOf('\r\n');if(end<0)return;
      const type=String.fromCharCode(buffer[0]),line=buffer.subarray(1,end).toString();
      if(type==='-')return finish(Error(line));
      if(type==='+')return finish(null,line);
      if(type===':')return finish(null,Number(line));
      if(type!=='$')return finish(Error('Unsupported test RESP type '+type));
      const length=Number(line);if(length===-1)return finish(null,null);
      if(buffer.length>=end+2+length+2)finish(null,buffer.subarray(end+2,end+2+length).toString());
    });
  });
}
function key() {const k='gimbap:isolated-test:'+randomUUID();keys.add(k);return k;}
async function store(k,name) {
  const s=createRankingStore({file:path.join(folder,name+'.json'),redisUrl:url,redisToken:'isolated-test',redisKey:k,retryMs:100000});
  stores.push(s);await s.init();return s;
}
before(async()=>{
  port=Number(process.env.REDIS_TEST_PORT);
  if(!port) {
    container=execFileSync('docker',['run','--rm','--detach','--publish','127.0.0.1::6379',
      'redis:7.2-alpine','redis-server','--save','','--appendonly','no'],{encoding:'utf8'}).trim();
    assert.match(container,/^[a-f0-9]{64}$/);
    port=Number(execFileSync('docker',['port',container,'6379'],{encoding:'utf8'}).trim().split(':').at(-1));
  }
  assert.ok(port>0 && port<=65535);
  const deadline=Date.now()+10000;
  while(true) {try {if(await redis(['PING'])==='PONG')break;} catch(e) {if(Date.now()>deadline)throw e;}
    await new Promise(r=>setTimeout(r,50));}
  folder=await fs.mkdtemp(path.join(os.tmpdir(),'gimbap-real-redis-'));
  bridge=http.createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer isolated-test'){res.writeHead(401);return res.end();}
    try {
      if(failRequests) {res.writeHead(503);return res.end(JSON.stringify({error:'isolated outage'}));}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const command=JSON.parse(Buffer.concat(chunks).toString());
      const result=await redis(command);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));
    } catch(e) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
  });
  bridge.listen(0,'127.0.0.1');await once(bridge,'listening');url='http://127.0.0.1:'+bridge.address().port;
});
after(async()=>{
  for(const child of children)if(child.exitCode===null)child.kill();
  stores.forEach(s=>s.close());
  if(bridge)await new Promise(resolve=>bridge.close(resolve));
  for(const k of keys)await redis(['DEL',k]); // Exact per-run UUID keys only.
  if(container)execFileSync('docker',['stop','--time','2',container],{stdio:'ignore'});
  if(folder)await fs.rm(folder,{recursive:true,force:true});
});

test('actual Lua merges concurrent writers without losing either run',async()=>{
  const k=key(),a=await store(k,'writer-a'),b=await store(k,'writer-b');
  a.add(row('run-a',100));b.add(row('run-b',200));
  assert.deepEqual(await Promise.all([a.flush(),b.flush()]),[true,true]);
  const result=JSON.parse(await redis(['GET',k]));
  assert.deepEqual(result.map(r=>r.id),['run-b','run-a']);assert.equal(result[0].shop,'🍣 검증 가게');
});

test('actual Lua retry is idempotent, sorted, and capped at 200',async()=>{
  const k=key(),batch=Array.from({length:205},(_,i)=>row('batch-'+i,i));
  for(let i=0;i<2;i++)await redis(['EVAL',MERGE_RANKINGS_LUA,'1',k,JSON.stringify(batch)]);
  const result=JSON.parse(await redis(['GET',k]));
  assert.equal(result.length,200);assert.equal(result[0].score,204);assert.equal(result.at(-1).score,5);
});

test('actual Lua does not overwrite corrupt or unexpected stored data',async()=>{
  for(const corrupt of ['{not json','{}','[{}]']) {
    const k=key();await redis(['SET',k,corrupt]);
    await assert.rejects(()=>redis(['EVAL',MERGE_RANKINGS_LUA,'1',k,JSON.stringify([row('new')])]));
    assert.equal(await redis(['GET',k]),corrupt);
  }
});

test('new process-local store sees confirmed Redis records without old cache',async()=>{
  const k=key(),a=await store(k,'before-restart');a.add(row('confirmed'));await a.flush();a.close();
  const b=await store(k,'after-restart');assert.equal(b.read()[0].id,'confirmed');assert.equal(b.health().ready,true);
});

test('unconfirmed run survives a hard process kill and replays once after Redis recovers',async()=>{
  const k=key(),options={file:path.join(folder,'crash-recovery.json'),redisUrl:url,redisToken:'isolated-test',redisKey:k};
  async function worker() {
    const child=fork(new URL('./fixtures/ranking-worker.mjs',import.meta.url),[JSON.stringify(options)],{silent:true});
    children.add(child);
    const [message]=await once(child,'message');assert.equal(message.type,'ready');return child;
  }
  const first=await worker();failRequests=true;
  const added=once(first,'message');first.send({type:'add',row:row('crash-safe')});await added;
  const exited=once(first,'exit');first.kill();await exited;children.delete(first);
  assert.equal(JSON.parse(await fs.readFile(options.file+'.pending.json','utf8'))[0].id,'crash-safe');
  failRequests=false;
  const second=await worker();
  assert.deepEqual(JSON.parse(await redis(['GET',k])).map(r=>r.id),['crash-safe']);
  assert.deepEqual(JSON.parse(await fs.readFile(options.file+'.pending.json','utf8')),[]);
  const done=once(second,'exit');second.kill();await done;children.delete(second);
});
