import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('downloaded lattice keeps its original facets and credits in a 12-joint skin', async () => {
  const glb = await readFile(new URL('../assets/rig-lab/lattice-rig.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.ok(glb.length < 1_000_000, 'Keep four skinned copies within the browser budget');
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
  assert.equal(gltf.asset.extras.author, 'David Hall (https://sketchfab.com/davidhall)');
  assert.match(gltf.asset.extras.license, /CC-BY-4\.0/);
  assert.equal(gltf.asset.extras.source,
    'https://sketchfab.com/3d-models/3d-lattice-of-icosahedra-and-octahedra-c58fa5bbb8a74ef7ac6fc477715e1fc3');
  assert.equal(gltf.skins.length, 1);
  assert.equal(gltf.skins[0].joints.length, 13);
  const names = gltf.skins[0].joints.map((index) => gltf.nodes[index].name);
  assert.ok(names.includes('root'));
  for (let i = 0; i < 12; i += 1) {
    assert.ok(names.includes(`joint_${String(i).padStart(2, '0')}`), `No independent joint ${i}`);
  }
  assert.equal(gltf.animations?.length ?? 0, 0, 'The musical pose drives the bones at runtime');
  assert.equal(gltf.meshes.length, 1, 'Thousands of source objects are joined for WebGL');
  assert.equal(gltf.meshes[0].primitives.length, 2, 'Keep the two original materials');
  assert.equal(gltf.materials.length, 2);
  for (const { attributes } of gltf.meshes[0].primitives) {
    for (const name of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']) {
      assert.ok(name in attributes, `${name} missing from the real downloaded surfaces`);
    }
  }
  const notice = await readFile(new URL('../assets/rig-lab/SOURCE.LICENSE.txt', import.meta.url), 'utf8');
  assert.match(notice, /File: lattice-rig\.glb[\s\S]*Creator: David Hall/);
  assert.ok(notice.includes(createHash('sha256').update(glb).digest('hex')));
});
