import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('licensed mosquito derivative has textured, independently skinned controls', async () => {
  const glb = await readFile(new URL('../assets/rig-lab/mosquito-rig.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.ok(glb.length < 9_000_000, 'Keep the downloadable rig within the browser asset budget');
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
  assert.equal(gltf.asset.extras.author,
    'adarshktk (https://sketchfab.com/adarshktk)');
  assert.match(gltf.asset.extras.license, /CC-BY-4\.0/);
  assert.equal(gltf.asset.extras.source,
    'https://sketchfab.com/3d-models/mosquito-474d2ea54af64114b2b5b1d2f6b18f8a');
  assert.equal(gltf.skins.length, 1);
  assert.equal(gltf.skins[0].joints.length, 21);
  assert.equal(gltf.animations?.length ?? 0, 0, 'Animation is driven by the sound pose, not an independent baked clip');
  const names = new Set(gltf.skins[0].joints.map((index) => gltf.nodes[index].name));
  for (const name of ['wing_left', 'wing_right', 'probe', 'head', 'abdomen']) {
    assert.ok(names.has(name), `${name} is missing its bone`);
  }
  for (const side of ['left', 'right']) for (const section of ['front', 'middle', 'rear']) {
    for (const part of ['hip', 'knee']) {
      assert.ok(names.has(`leg_${side}_${section}_${part}`),
        `${side} ${section} leg cannot bend at the ${part}`);
    }
  }
  assert.equal(gltf.nodes.filter((node) => node.skin !== undefined).length, 15);
  assert.ok(gltf.meshes.every(({ primitives }) => primitives.every(({ attributes }) =>
    attributes.TEXCOORD_0 !== undefined && attributes.JOINTS_0 !== undefined
      && attributes.WEIGHTS_0 !== undefined)));
  assert.equal(gltf.materials.length, 1);
  const textureImage = (reference) =>
    gltf.images[gltf.textures[reference.index].source];
  const material = gltf.materials[0];
  const base = textureImage(material.pbrMetallicRoughness.baseColorTexture);
  const normal = textureImage(material.normalTexture);
  const packed = textureImage(material.pbrMetallicRoughness.metallicRoughnessTexture);
  const pngWidth = (image) => {
    const view = gltf.bufferViews[image.bufferView];
    const start = 20 + jsonLength + 8 + (view.byteOffset ?? 0);
    assert.equal(glb.toString('ascii', start + 1, start + 4), 'PNG');
    return glb.readUInt32BE(start + 16);
  };
  assert.equal(pngWidth(base), 2048);
  assert.equal(pngWidth(normal), 1024);
  assert.equal(pngWidth(packed), 1024);
  const notice = await readFile(new URL('../assets/rig-lab/SOURCE.LICENSE.txt', import.meta.url), 'utf8');
  assert.match(notice, /Mosquito\s*\nCreator: adarshktk/);
  assert.match(notice, /CC BY 4\.0/);
  assert.ok(notice.includes(createHash('sha256').update(glb).digest('hex')),
    'Modified asset digest needs an attribution entry');
});
