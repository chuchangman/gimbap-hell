import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Room} from '../legacy/server/room.mjs';
import {movementState,validateMove,grantKnockback} from '../legacy/server/movement.mjs';
import {MOVEMENT,STATION_BOXES,WORLD_SOLIDS,actionBox,stationBox,clearPosition,clearPath} from '../legacy/public/js/spatial.js';
const player=(x=-4.4,z=8)=>({x,z,y:0,ry:0,motion:movementState(0)});
const send=(p,values,now)=>validateMove(p,{x:p.x,z:p.z,y:p.y,ry:p.ry,version:p.motion.version,...values},now);

test('all six initial spawns and every station approach remain navigable',()=>{
  const room=new Room('GEOM');
  for(let i=0;i<6;i++)room.addPlayer(String(i),'검사자');room.start();
  for(const p of room.players.values())assert.ok(clearPosition(p),'Blocked spawn '+p.slot);
  assert.equal(WORLD_SOLIDS.length,13);
  for(const [action,payload,position] of [
    ['fridge:take',{item:'rice'},{x:-4.4,z:-4.25}],['sink:rinse',{}, {x:-4.4,z:1.1}],
    ['cooker:put',{cooker:1},{x:-4.4,z:6.4}],['burner:put',{slot:4},{x:4.5,z:1.52}],
    ['board:put',{board:2},{x:1.4,z:.2}],['mat:roll',{mat:2},{x:1.6,z:4}],
    ['bin:drop',{}, {x:4.4,z:5.6}],['broom:take',{rack:0},{x:-2.6,z:6.6}],
    ['serve',{}, {x:0,z:-5.4}]
  ]) {
    const p=room.players.get('0');Object.assign(p,position);
    assert.ok(clearPosition(p),action+' approach');assert.ok(room.canReach('0',action,payload),action+' reachable');
  }
});

test('every fridge row, burner and table part uses a shared interaction box',()=>{
  assert.equal(Object.keys(STATION_BOXES.fridge).length,10);
  for(const kind of ['cooker','burner','board','mat','broom']) {
    const field={cooker:'cooker',burner:'slot',board:'board',mat:'mat',broom:'rack'}[kind];
    STATION_BOXES[kind].forEach((b,i)=>assert.equal(stationBox({kind,[field]:i}),b));
  }
  assert.equal(actionBox('fridge:take',{item:'rice',kind:'serve'}),STATION_BOXES.fridge.rice);
});

test('ordinary running with uneven packet arrival does not trigger correction',()=>{
  const p=player();let at=0;
  for(let i=0;i<40;i++) {
    const dt=[67,100,33,134,0,67][i%6];at+=dt;
    assert.equal(send(p,{z:p.z-MOVEMENT.run*dt/1000},at).ok,true);
  }
});

test('legitimate jump arc and a server-confirmed knockback stay within movement limits',()=>{
  const p=player();let at=0;
  for(let i=1;i<=10;i++) {
    at=i*60;const seconds=at/1000;
    const y=Math.max(0,MOVEMENT.jump*seconds+MOVEMENT.gravity*seconds*seconds/2);
    assert.equal(send(p,{y,z:p.z-.15},at).ok,true);
  }
  grantKnockback(p,at);
  for(let i=0;i<8;i++) {at+=67;assert.equal(send(p,{z:p.z-.65,y:Math.max(0,.5-i*.08)},at).ok,true);}
});

test('idle time cannot bank a teleport; sustained fast movement is bounded by server time',()=>{
  const p=player();assert.equal(send(p,{x:4.4},60000).reason,'speed');
  assert.equal(p.x,-4.4);
  let travelled=0,at=60000;
  for(let i=0;i<15;i++) {at+=67;const before=p.z;send(p,{z:p.z-.9},at);travelled+=Math.abs(p.z-before);}
  assert.ok(travelled<=1.6+MOVEMENT.run*1.04*(at-60000)/1000+.001);
});

test('movement cannot cut through a table, cross a narrow solid, or leave the room',()=>{
  const p=player(-4.4,2.6);assert.equal(send(p,{x:-2.9},100).reason,'collision');
  assert.equal(p.x,-4.4);
  const a={x:5.6,z:4.81},b={x:5.6,z:6.39};assert.ok(clearPosition(a)&&clearPosition(b));
  assert.equal(clearPath(a,b),false,'The bin cannot be tunnelled through with clear endpoints');
  const edge=player(7.5,8);assert.equal(send(edge,{x:7.8},100).reason,'collision');
});

test('invalid height and persistent hovering are corrected; queued stale packets do not undo correction',()=>{
  const p=player();const invalid=send(p,{y:50},100);assert.equal(invalid.reason,'height');
  assert.equal(p.y,0);assert.equal(validateMove(p,{x:4,y:0,z:0,ry:0,version:0},110).reason,'stale');
  assert.equal(send(p,{y:.5},200).ok,true);assert.equal(send(p,{y:.5},1400).reason,'airtime');
  assert.equal(p.y,0);assert.equal(send(p,{z:7.8},1500).ok,true);
});

test('remote station actions and forged station kinds cannot mutate the kitchen',()=>{
  const room=new Room('DIST');room.addPlayer('p','검사자');room.start();
  const p=room.players.get('p');
  assert.equal(room.act('p','fridge:take',{item:'rice'}).rejected,'distance');
  Object.assign(p,{x:0,z:-5.4});
  assert.equal(room.act('p','fridge:take',{item:'rice',kind:'serve'}).rejected,'distance');
  assert.equal(room.kitchen.hand('p'),null);
  Object.assign(p,{x:-4.4,z:-4.25});assert.equal(room.act('p','fridge:take',{item:'rice'}).ok,true);
  assert.equal(room.act('p','sink:put',{}).rejected,'distance');assert.equal(room.kitchen.hand('p').id,'rice');
  Object.assign(p,{x:-4.4,z:1.1});assert.equal(room.act('p','sink:put',{}).ok,true);
  Object.assign(p,{x:4.4,z:5});assert.equal(room.act('p','sink:rinse',{}).rejected,'distance');
});

test('remote serving cannot consume the held roll or change a customer score',()=>{
  const room=new Room('SERV');room.addPlayer('p','검사자');room.start();
  const target={id:'customer',slot:0};room.waves.waitingById=()=>target;
  const hand={id:'gimbap',fills:[]};room.kitchen.setHand('p',hand);
  assert.equal(room.serve('p','customer').rejected,'distance');assert.equal(room.kitchen.hand('p'),hand);
});
