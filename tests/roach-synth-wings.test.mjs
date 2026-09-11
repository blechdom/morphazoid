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
