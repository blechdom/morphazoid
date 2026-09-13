import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three/three.module.min.js';
import {MeshoptDecoder} from '../vendor/meshoptimizer/meshopt_decoder.module.js';
import {SPIDER_JOINTS} from '../src/spider-synth-model.js';

const specimens = [
  ['golden', 116379, 'CC0-1.0'], ['devil', 161171, 'CC0-1.0'],
  ['tarantula', 239276, 'CC-BY-4.0'], ['huntsman', 171906, 'CC0-1.0'],
  ['fishing', 147012, 'CC0-1.0'],
];
await MeshoptDecoder.ready;
const widths = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
const components = {5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255], 5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535], 5125: ['getUint32', 4, 4294967295], 5126: ['getFloat32', 4, 1]};
for (const [id, triangles, license] of specimens) {
  test(`${id} is a complete licensed scan with an independent finite 38-joint mobile skin`, async () => {
    const base = new URL(`../assets/spider-synth/skins/${id}/`, import.meta.url);
    const [bytes, manifestText, reportText, provenanceText, licenseText] = await Promise.all(
      ['spider-mobile.glb', 'rig-manifest.json', 'spider-mobile.glb.report.json', 'source-provenance.json', 'SOURCE.LICENSE.txt'].map(path => readFile(new URL(path, base))),
    );
    const rig = JSON.parse(manifestText), report = JSON.parse(reportText), provenance = JSON.parse(provenanceText);
    assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.ok(bytes.length < 7 * 1024 * 1024, 'The largest complete scan stays within the declared 7 MiB delivery ceiling');
    assert.equal(report.outputBytes, bytes.length);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), report.outputSha256);
    assert.equal(provenance.inspection.runtimeSha256, report.outputSha256);
    assert.match(licenseText.toString(), /https:\/\/sketchfab.com\/3d-models\//);
    if (id === 'tarantula') assert.match(licenseText.toString(), /Auckland Museum/);
    const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
    const binary = bytes.subarray(28 + length), decoded = new Map();
    function accessor(index) {
      const a = json.accessors[index], view = json.bufferViews[a.bufferView], packed = view.extensions?.EXT_meshopt_compression;
      let data = decoded.get(a.bufferView);
      if (!data) {
        if (packed) {
          data = new Uint8Array(view.byteLength);
          MeshoptDecoder.decodeGltfBuffer(data, packed.count, packed.byteStride, binary.subarray(packed.byteOffset, packed.byteOffset + packed.byteLength), packed.mode, packed.filter);
        } else data = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
        decoded.set(a.bufferView, data);
      }
      const [method, size, normalizer] = components[a.componentType], width = widths[a.type];
      const stride = view.byteStride ?? width * size, result = new Float64Array(a.count * width), reader = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < width; k++) {
        const value = reader[method]((a.byteOffset ?? 0) + i * stride + k * size, true);
        result[i * width + k] = a.normalized ? Math.max(-1, value / normalizer) : value;
      }
      return result;
    }
    assert.equal(json.asset.extras.specimen, id); assert.equal(json.asset.extras.license, license);
    assert.equal(json.meshes.length, 1); assert.equal(json.skins.length, 1);
    assert.equal(json.skins[0].joints.length, 38); assert.equal(json.animations?.length ?? 0, 0);
    assert.equal(rig.id, id); assert.equal(rig.triangles, triangles);
    assert.deepEqual(rig.joints.map(j => j.id), SPIDER_JOINTS.map(j => j.id));
    assert.ok(json.nodes.every(n => !/cube/i.test(n.name) && !Object.hasOwn(n.extras ?? {}, 'pivot')));
    assert.equal(rig.texture.width, 4096); assert.equal(rig.texture.height, 4096);
    assert.equal(rig.precision.trianglesRemovedFromAnimal, 0);
    const primitive = json.meshes[0].primitives[0], attributes = primitive.attributes;
    const positions = accessor(attributes.POSITION), normals = accessor(attributes.NORMAL), uv = accessor(attributes.TEXCOORD_0);
    const weights = accessor(attributes.WEIGHTS_0), indices = accessor(attributes.JOINTS_0), trianglesData = accessor(primitive.indices);
    assert.equal(positions.length / 3, rig.vertices); assert.equal(trianglesData.length / 3, triangles);
    const usage = new Uint32Array(38), nearestToe = new Float64Array(8).fill(Infinity), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const legIndexByBone = new Map(); rig.legs.forEach((leg, i) => leg.jointIds.forEach(jointId => legIndexByBone.set(rig.joints.findIndex(j => j.id === jointId), i)));
    for (let v = 0; v < rig.vertices; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const n = v * 4 + k; assert.ok(Number.isInteger(indices[n]) && indices[n] >= 0 && indices[n] < 38);
        assert.ok(Number.isFinite(weights[n]) && weights[n] >= 0 && weights[n] <= 1); sum += weights[n];
        if (weights[n] > .05) usage[indices[n]]++;
      }
      assert.ok(Math.abs(sum - 1) < 1e-8);
      for (let k = 0; k < 3; k++) { const p = positions[v * 3 + k]; assert.ok(Number.isFinite(p)); min[k] = Math.min(min[k], p); max[k] = Math.max(max[k], p); }
      assert.ok(Math.abs(Math.hypot(...normals.subarray(v * 3, v * 3 + 3)) - 1) < .00006);
      assert.ok(uv[v * 2] >= 0 && uv[v * 2] <= 1 && uv[v * 2 + 1] >= 0 && uv[v * 2 + 1] <= 1);
      const li = legIndexByBone.get(indices[v * 4]);
      if (li !== undefined) {
        const toe = rig.legs[li].anchors[4];
        nearestToe[li] = Math.min(nearestToe[li], Math.hypot(positions[v * 3] - toe[0], positions[v * 3 + 1] - toe[1], positions[v * 3 + 2] - toe[2]));
      }
    }
    assert.ok([...usage].every(n => n > 100), 'Every joint moves actual photographed vertices');
    assert.ok(Math.abs(Math.max(...max.map((n, i) => n - min[i])) - .9) < .000005);
    assert.ok([...nearestToe].every(distance => distance < .008), 'Every contact endpoint lies on its own scanned limb');
    assert.ok(trianglesData.every(index => Number.isInteger(index) && index >= 0 && index < rig.vertices));
    const inverse = accessor(json.skins[0].inverseBindMatrices);
    rig.joints.forEach((joint, i) => {
      const m = new THREE.Matrix4().makeTranslation(...joint.pivot).multiply(new THREE.Matrix4().fromArray(inverse, i * 16));
      assert.ok(m.elements.every((v, n) => Math.abs(v - (n % 5 === 0 ? 1 : 0)) < 2e-8));
    });
    for (const leg of rig.legs) {
      assert.equal(leg.anchors.length, 5); assert.equal(leg.lengths.length, 4); assert.equal(leg.radii.length, 4);
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(Math.hypot(...leg.anchors[i].map((n, k) => n - leg.anchors[i + 1][k])) - leg.lengths[i]) < 1e-10);
        assert.ok(leg.radii[i] >= .001 && leg.radii[i] <= .05);
      }
    }
    for (const body of rig.collision.bodies) {
      assert.ok(body.center.every(Number.isFinite) && body.radii.every(r => Number.isFinite(r) && r > 0));
      assert.ok(rig.neutralBodyHeight + body.center[1] - body.radii[1] >= .01399, 'Neutral support height clears the measured body underside');
    }
  });
}

test('original Argiope also has measured collision geometry and body clearance', async () => {
  const rig = JSON.parse(await readFile(new URL('../assets/spider-synth/rig-manifest.json', import.meta.url)));
  assert.equal(rig.id, 'argiope'); assert.equal(rig.collision.bodies.length, 2);
  for (const body of rig.collision.bodies) {
    assert.ok(body.center.every(Number.isFinite)); assert.ok(body.radii.every(r => Number.isFinite(r) && r > 0));
    assert.ok(rig.neutralBodyHeight + body.center[1] - body.radii[1] >= .01399);
  }
  for (const leg of rig.legs) assert.ok(leg.radii.length === 4 && leg.radii.every(r => r >= .001 && r <= .05));
});
