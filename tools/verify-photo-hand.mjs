import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'apps/client/public/assets');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
for (const [key, file, texture] of [
  ['hand/fps-right', 'fps-right-photo.glb', 'right-hand-photo-cutout.png'],
  ['hand/fps-right-grip', 'fps-right-photo-grip.glb', 'right-hand-grip-cutout.png'],
]) {
  assert.equal(manifest[key], 'hand/'+file);
  const bytes = fs.readFileSync(path.join(dir, manifest[key]));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert(gltf.nodes.some((n) => n.name === 'RightHand_Skin'));
  assert(gltf.materials.some((m) => m.extensions?.KHR_materials_unlit));
  for (const mesh of gltf.meshes) {
    assert(mesh.weights.every((w) => w === 0), 'Default photo must not have combined morphs');
    assert.deepEqual(mesh.extras.targetNames, ['Grip', 'Open']);
    assert.equal(mesh.primitives.length, 2, 'Photo front and plain sides/back');
  }
  const png = fs.readFileSync(path.join(dir, 'hand', texture));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png[25], 6, 'Cutout must be RGBA, not a checkerboard RGB image');
}

// Execute the real hand.ts module, mocking only world/network/asset boundaries.
const camera = new THREE.PerspectiveCamera();
const registry = { handKey: null, hand: null, arm: null };
let held = null;
let gripAssetAvailable = true;
function fixture(name) {
  const group = new THREE.Group();
  group.name = name;
  const skin = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  skin.morphTargetDictionary = { Grip: 0 };
  skin.morphTargetInfluences = [0];
  group.add(skin);
  return group;
}
const dependencies = {
  three: THREE,
  '@/features/assets/assets': {
    assetOrNull: (key) => key === 'hand/fps-right-grip'
      ? (gripAssetAvailable ? fixture('grip-fixture') : null)
      : fixture('open-fixture'),
  },
  '@/features/net/net': { myHand: () => held },
  '@/features/world/items': { makeItemMesh: () => new THREE.Group() },
  '@/features/world/primitives': { disposeObject: () => {} },
  '@/features/world/registry': { D: registry },
  '@/features/world/scene': { camera },
};
const source = fs.readFileSync(path.join(root, 'apps/client/src/features/world/hand.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const api = {};
vm.runInNewContext(compiled, {
  exports: api, require: (name) => {
    assert(name in dependencies, 'Unexpected dependency: '+name);
    return dependencies[name];
  }, performance, console: { warn: () => {}, error: (message) => assert.fail(message) },
});
api.buildArm();
function expectPose(open, closed) {
  assert.equal(registry.arm.getObjectByName('open-fixture').visible, open);
  assert.equal(registry.arm.getObjectByName('grip-fixture').visible, closed);
}
expectPose(true, false);
held = { uid: 'food-1', id: 'rice', stage: 'raw' };
api.updateHand();
expectPose(false, true);
api.setArmBob(1, 1/60);
expectPose(false, true);
held = { uid: 'broom-1', id: 'broom', stage: 'raw' };
api.updateHand();
expectPose(false, true);
held = null;
api.updateHand();
expectPose(true, false);
held = { uid: 'food-2', id: 'ham', stage: 'raw' };
api.buildArm();
expectPose(false, true); // Building/reconnecting while already holding an item.
gripAssetAvailable = false;
api.buildArm();
api.setArmBob(0, .5);
assert.equal(registry.arm.getObjectByName('open-fixture').visible, true);
assert(registry.arm.getObjectByName('open-fixture').children[0].morphTargetInfluences[0] > 0);
console.log('Photo hands OK: both GLBs, RGBA textures, unlit materials; empty/pickup/broom/drop/rebuild/fallback transitions pass.');
