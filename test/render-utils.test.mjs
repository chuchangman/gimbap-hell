import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_VIEW,PLAYER_INPUT,CHARACTER_MOTION} from '../public/js/render-config.js';
import {collectTintTargets,applyBurnTint} from '../public/js/render-utils.js';

test('shared visual constants retain the existing camera, input and swing timing',()=>{
  assert.deepEqual(CAMERA_VIEW,{fov:72,near:.05,far:140});
  assert.deepEqual(PLAYER_INPUT,{lookSensitivity:.0022,maxPitch:1.35});
  assert.deepEqual(CHARACTER_MOTION,{swingMs:260});
  assert.ok(Object.isFrozen(CAMERA_VIEW)&&Object.isFrozen(PLAYER_INPUT)&&Object.isFrozen(CHARACTER_MOTION));
});

test('burn tint target discovery happens once and preserves exclusions',()=>{
  let traversals=0;
  const color=()=>({value:1,clone(){return color();},copy(other){this.value=other.value;return this;},multiplyScalar(v){this.value*=v;return this;}});
  const target={isMesh:true,material:{color:color()},userData:{}};
  const excluded={isMesh:true,material:{color:color()},userData:{noTint:true}};
  const root={traverse(fn){traversals++;fn(target);fn(excluded);fn({isMesh:false,userData:{}});}};
  const targets=collectTintTargets(root);
  assert.deepEqual(targets,[target]);assert.equal(traversals,1);
  applyBurnTint(targets,.5);assert.ok(Math.abs(target.material.color.value-.66)<1e-12);
  applyBurnTint(targets,1);assert.ok(Math.abs(target.material.color.value-.32)<1e-12);
  assert.equal(traversals,1,'frame updates reuse cached targets instead of traversing the mesh');
});
