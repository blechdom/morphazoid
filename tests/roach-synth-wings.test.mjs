import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three/three.module.min.js';
import { splitRoachWingGeometry, articulateRoachWings, updateRoachWingFans } from '../src/roach-synth-wings.js';

function area(geometry) {
  let sum = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < geometry.index.count; i += 3) {
    a.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(i));
    b.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(i + 1));
    c.fromBufferAttribute(geometry.attributes.position, geometry.index.getX(i + 2));
    sum += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return sum;
}

test('wing triangle clipping preserves total surface area, interpolated UVs and material groups without mutating source', () => {
  const geometry = new THREE.PlaneGeometry(2, 3, 3, 4);
  geometry.clearGroups(); geometry.addGroup(0, 36, 0); geometry.addGroup(36, geometry.index.count - 36, 1);
  const before = Array.from(geometry.attributes.position.array);
  const halves = splitRoachWingGeometry(geometry, { slope: .12, intercept: .04 });
  assert.ok(Math.abs(area(halves[0]) + area(halves[1]) - area(geometry)) < 1e-6);
  assert.deepEqual(Array.from(geometry.attributes.position.array), before);
  for (const [i, half] of halves.entries()) {
    assert.deepEqual(half.groups.map((group) => group.materialIndex), [0, 1]);
    const position = half.attributes.position, uv = half.attributes.uv;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const x = position.getX(vertex), y = position.getY(vertex);
      assert.ok((x - .12 * y - .04) * (i === 0 ? 1 : -1) >= -1e-6);
      assert.ok(Math.abs(uv.getX(vertex) - (x + 1) / 2) < 1e-6);
      assert.ok(Math.abs(uv.getY(vertex) - (y + 1.5) / 3) < 1e-6);
    }
  }
});

test('four wing joints replace the original cover mesh and independently unfold two authored membranes', () => {
  const model = new THREE.Group(), aggregate = new THREE.Group();
  aggregate.userData.jointId = 'wings'; model.add(aggregate);
  const source = new THREE.Mesh(new THREE.PlaneGeometry(2, 3, 3, 4), new THREE.MeshStandardMaterial());
  aggregate.add(source);
  const rig = articulateRoachWings(model);
  assert.equal(rig.leaves.length, 4);
  assert.equal(source.parent, null);
  assert.equal(rig.fans.length, 2);
  assert.equal(articulateRoachWings(model), null);
  assert.deepEqual(rig.leaves.map((joint) => joint.userData.jointId), ['wing_cover_left', 'wing_hind_left', 'wing_cover_right', 'wing_hind_right']);
  updateRoachWingFans(rig);
  assert.ok(rig.fans.every((fan) => fan.membrane.visible === false));
  rig.fans[0].joint.rotation.z = .8;
  updateRoachWingFans(rig);
  assert.ok(rig.fans[0].membrane.morphTargetInfluences[0] > .7);
  assert.equal(rig.fans[1].membrane.morphTargetInfluences[0], 0);
  assert.equal(rig.leaves[0].quaternion.w, 1);
  assert.equal(rig.leaves[2].quaternion.w, 1);
});

test('prepared covers reuse their geometry and reproduce the original rig and pre-articulation bounds', async () => {
  const { readFile } = await import('node:fs/promises');
  const { precomputeRoachWingsGlb, decodeRoachGlb, roachGeometryScene } = await import('../scripts/precompute-roach-wings.mjs');
  const bytes = await readFile(new URL('../assets/roach-synth/cockroach.glb', import.meta.url));
  const original = decodeRoachGlb(bytes), prepared = precomputeRoachWingsGlb(bytes), encoded = decodeRoachGlb(prepared.buffer);
  const first = roachGeometryScene(original.json, original.binary).scene;
  const second = roachGeometryScene(encoded.json, encoded.binary).scene;
  function authoredJoints(scene) {
    const joints = []; scene.traverse((object) => { if (object.userData.roachJoint) joints.push(object.userData.jointId); }); return joints;
  }
  const ids = authoredJoints(first);
  assert.equal(ids.length, 27);
  assert.deepEqual(authoredJoints(second), ids);
  assert.deepEqual(encoded.json.animations, original.json.animations);
  assert.deepEqual(encoded.json.materials, original.json.materials);
  assert.deepEqual(encoded.json.images, original.json.images);
  assert.deepEqual(encoded.binary.subarray(0, original.binary.length), original.binary);
  const firstBounds = new THREE.Box3().setFromObject(first), secondBounds = new THREE.Box3().setFromObject(second);
  assert.ok(firstBounds.min.distanceTo(secondBounds.min) < 1e-7);
  assert.ok(firstBounds.max.distanceTo(secondBounds.max) < 1e-7);
  const existingGeometry = [];
  second.traverse((object) => {
    if (object.userData.preparedRoachWingCover) {
      existingGeometry.push(object.geometry);
      object.geometry.clone = () => { throw new Error('Prepared covers must not be cloned or reclipped at load time.'); };
    }
  });
  const a = articulateRoachWings(first), b = articulateRoachWings(second);
  assert.equal(a.prepared, false); assert.equal(b.prepared, true);
  assert.equal(b.sourceTriangles, a.sourceTriangles); assert.equal(b.coverTriangles, a.coverTriangles);
  assert.deepEqual(b.leaves.map((joint) => joint.userData), a.leaves.map((joint) => joint.userData));
  assert.deepEqual(b.leaves.map((joint) => joint.position.toArray()), a.leaves.map((joint) => joint.position.toArray()));
  assert.equal(b.leaves[0].children[0].geometry, existingGeometry[0]);
  assert.equal(b.leaves[2].children[0].geometry, existingGeometry[1]);
  for (let leaf = 0; leaf < 4; leaf += 1) {
    const firstObjects = a.leaves[leaf].children, secondObjects = b.leaves[leaf].children;
    assert.equal(firstObjects.length, secondObjects.length);
    for (let child = 0; child < firstObjects.length; child += 1) {
      const before = firstObjects[child].geometry, after = secondObjects[child].geometry;
      for (const name of Object.keys(before.attributes)) assert.deepEqual(after.attributes[name].array, before.attributes[name].array);
      assert.deepEqual(after.index?.array, before.index?.array);
    }
  }
  for (const angle of [0, .2, .8, 1.4]) {
    for (const rig of [a, b]) {
      rig.leaves.forEach((joint, i) => joint.rotation.set(angle * .1, angle * (i % 2 ? .3 : .1), angle * (i < 2 ? 1 : -1)));
      updateRoachWingFans(rig);
      rig.parent.updateMatrixWorld(true);
    }
    assert.deepEqual(b.fans.map((fan) => fan.membrane.morphTargetInfluences), a.fans.map((fan) => fan.membrane.morphTargetInfluences));
    for (let leaf = 0; leaf < 4; leaf += 1) assert.deepEqual(b.leaves[leaf].matrixWorld.elements, a.leaves[leaf].matrixWorld.elements);
  }
  assert.equal(articulateRoachWings(second), null);
});

test('precomputation is deterministic and rejects an already prepared asset', async () => {
  const { readFile } = await import('node:fs/promises');
  const { precomputeRoachWingsGlb } = await import('../scripts/precompute-roach-wings.mjs');
  const bytes = await readFile(new URL('../assets/roach-synth/cockroach.glb', import.meta.url));
  const first = precomputeRoachWingsGlb(bytes), second = precomputeRoachWingsGlb(bytes);
  assert.deepEqual(first.buffer, second.buffer);
  assert.throws(() => precomputeRoachWingsGlb(first.buffer), /unprepared/);
});
