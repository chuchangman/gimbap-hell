import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validKitchenAction, validEvent, createEventLimiter, allowedOrigin } from '../server/protocol.mjs';
import { resolvePublicPath } from '../server/http.mjs';
import { Room, nameError } from '../server/room.mjs';
import { Kitchen } from '../server/kitchen.mjs';

test('malformed paths cannot escape the public root on POSIX or Windows',()=>{
  const root=path.resolve('public');
  for(const input of ['/%','/%E0%A4%A','/..%5cserver%5cindex.mjs','/../server/index.mjs',
    '/%2e%2e/server/index.mjs','/.env','/%00','/C:/Windows/win.ini','/vendor/../../package.json'])
    assert.equal(resolvePublicPath(root,input),null,input);
  assert.equal(resolvePublicPath(root,'/assets/char/base.glb?v=2'),path.join(root,'assets/char/base.glb'));
});

test('wire schema rejects object coercion, invalid callback data and special array properties',()=>{
  for(const name of [{},[],42,null,'a','a\nb']) assert.equal(validEvent('room:create',{name}),false);
  assert.ok(validEvent('room:create',{name:'김알바',look:{h:1,sc:3}}));
  assert.equal(validEvent('room:join',{name:'김알바',code:'I000'}),false);
  for(const id of ['__proto__','constructor','length',-1,1.5,NaN,Infinity,999,{},[]]) {
    assert.equal(validKitchenAction('mat:roll',{mat:id}),false);
    assert.equal(validKitchenAction('cooker:put',{cooker:id}),false);
    assert.equal(validKitchenAction('broom:take',{rack:id}),false);
  }
  assert.equal(validKitchenAction('fridge:take',{item:'constructor'}),false);
  assert.equal(validEvent('player:move',{x:0,y:0,z:0,ry:NaN}),false);
  assert.equal(validEvent('player:swing',{targetId:{}}),false);
  assert.ok(validKitchenAction('sink:rinse',{}));
  assert.ok(validKitchenAction('cooker:put',{cooker:1}));
});

test('limiter bounds bursts, refills with time, and does not couple movement with interaction',()=>{
  let at=1000;const permit=createEventLimiter(()=>at);
  for(let i=0;i<20;i++) assert.ok(permit('kitchen:act'));
  assert.equal(permit('kitchen:act'),false);
  assert.ok(permit('player:move'));
  at+=1000;for(let i=0;i<12;i++) assert.ok(permit('kitchen:act'));
  assert.equal(permit('kitchen:act'),false);
  assert.equal(permit('unknown'),false);
});

test('origin validation covers websocket same-origin, configured origin, malformed and native clients',()=>{
  const req=origin=>({headers:{host:'localhost:3211',origin}});
  assert.ok(allowedOrigin(req('http://localhost:3211')));
  assert.ok(allowedOrigin(req(undefined)));
  assert.equal(allowedOrigin(req('https://evil.example')),false);
  assert.equal(allowedOrigin(req('null')),false);
  assert.equal(allowedOrigin(req('http://localhost:3211/')),false);
  assert.ok(allowedOrigin(req('https://play.example'),'https://play.example'));
  assert.equal(allowedOrigin(req('http://localhost:3211'),'https://play.example'),false);
});

test('room membership is idempotent and capped at six, including direct callers',()=>{
  const r=new Room('TEST');
  const p=r.addPlayer('a','알바');r.kitchen.setHand('a',{id:'rice'});
  assert.equal(r.addPlayer('a','다른이름'),p);assert.equal(r.size,1);assert.equal(r.kitchen.hand('a').id,'rice');
  for(let i=1;i<6;i++) r.addPlayer(String(i),'알바');
  assert.equal(r.addPlayer('overflow','추가'),null);assert.equal(r.size,6);
  assert.ok(nameError({toString:'malicious'}));
});

test('game server enforces ingredient unlock and rejects non-finite positions',()=>{
  const r=new Room('LOCK');r.addPlayer('a','알바');r.start();
  assert.equal(r.act('a','fridge:take',{item:'fishcake'}).ok,false);
  r.waves.wave=8;
  Object.assign(r.players.get('a'),{x:-4.8,z:-.8}); // Within the unlocked fridge cubby's reach.
  assert.equal(r.act('a','fridge:take',{item:'fishcake'}).ok,true);
  const p=r.players.get('a');const x=p.x;
  r.move('a',{x:NaN,z:Infinity,y:-Infinity,ry:NaN});
  assert.equal(p.x,x);assert.ok(r.positions().flat().every(Number.isFinite));
  r.move('a',{x:p.x,z:p.z,y:0,ry:Math.PI*10,version:p.motion.version});
  assert.ok(Math.abs(p.ry)<1e-10);
});

test('kitchen rejects prototype indices without corrupting shared state',()=>{
  const k=new Kitchen();k.join('a');
  const initial=JSON.stringify(k.snapshot(),(key,value)=>key==='now'?0:value);
  for(const index of ['__proto__','constructor','length',{},[]]) {
    assert.equal(k.act('a','mat:roll',{mat:index}).ok,false);
    assert.equal(k.act('a','board:put',{board:index}).ok,false);
  }
  assert.equal(k.act('outsider','fridge:take',{item:'gim'}).ok,false);
  assert.equal(JSON.stringify(k.snapshot(),(key,value)=>key==='now'?0:value),initial);
});
