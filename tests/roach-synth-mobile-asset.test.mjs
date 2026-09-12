import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';

const asset = (name) => new URL(`../assets/roach-synth/${name}`, import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function readGlb(name) {
  const bytes = readFileSync(asset(name));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary: bytes.subarray(28 + length) };
}
function viewBytes(glb, index) {
  const view = glb.json.bufferViews[index];
  const compressed = view.extensions?.EXT_meshopt_compression;
  if (!compressed) return glb.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const output = new Uint8Array(view.byteLength);
  MeshoptDecoder.decodeGltfBuffer(output, compressed.count, compressed.byteStride,
    glb.binary.subarray(compressed.byteOffset || 0, (compressed.byteOffset || 0) + compressed.byteLength), compressed.mode, compressed.filter);
  return Buffer.from(output);
}

test('mobile Roach preserves positions, indices, animation and original joint identities', async () => {
  await MeshoptDecoder.ready;
  const original = readGlb('cockroach.glb'); const mobile = readGlb('cockroach-mobile.glb');
  assert.equal(sha(original.bytes), 'ccb4887122c0882c6885b6fd86d146ab9ec54a9f4177d9c0888dbbb03a3cea8c');
  const report = JSON.parse(readFileSync(asset('cockroach-mobile.glb.report.json'), 'utf8'));
  assert.equal(sha(mobile.bytes), report.output.sha256);
  assert.ok(mobile.bytes.length < original.bytes.length * .8, 'Derived storage should be substantially smaller without decimation');
  const originalViews = new Map(); const mobileViews = new Map();
  const changedAttributes = new Map((report.attributes || []).map((item) => [item.index, item]));
  const sourceSemantics = new Map(); const mobileSemantics = new Map();
  for (const [json, table] of [[original.json, sourceSemantics], [mobile.json, mobileSemantics]]) {
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) for (const [semantic, index] of Object.entries(primitive.attributes)) {
      if (!table.has(index)) table.set(index, new Set()); table.get(index).add(semantic);
    }
  }
  assert.equal(report.attributeProfile, 'precision16');
  for (const [index, change] of changedAttributes) {
    const semantics = index < original.json.accessors.length ? sourceSemantics.get(index) : mobileSemantics.get(index);
    assert.ok(/^(NORMAL|TANGENT|TEXCOORD_\d+)$/.test(change.semantic));
    assert.ok(semantics?.has(change.semantic)); assert.ok(!semantics.has('POSITION'));
  }
  for (let i = 0; i < original.json.accessors.length; i += 1) {
    const accessor = original.json.accessors[i]; const next = mobile.json.accessors[i];
    const { min, max, ...layout } = accessor; const { min: nextMin, max: nextMax, ...nextLayout } = next;
    assert.deepEqual(nextLayout, layout, `Accessor ${i} layout changed`);
    const view = accessor.bufferView;
    if (!originalViews.has(view)) originalViews.set(view, viewBytes(original, view));
    if (!mobileViews.has(view)) mobileViews.set(view, viewBytes(mobile, view));
    const before = originalViews.get(view); const after = mobileViews.get(view);
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const stride = original.json.bufferViews[view].byteStride || components * 4;
    const change = changedAttributes.get(i);
    if (!change) assert.deepEqual({ min: nextMin, max: nextMax }, { min, max });
    if (!change && stride === components * 4) {
      const offset = accessor.byteOffset || 0; const end = offset + accessor.count * stride;
      assert.deepEqual(after.subarray(offset, end), before.subarray(offset, end), `Accessor ${i} changed`);
      continue;
    }
    for (let element = 0; element < accessor.count; element += 1) {
      const offset = (accessor.byteOffset || 0) + element * stride;
      if (!change) assert.equal(after.toString('hex', offset, offset + components * 4), before.toString('hex', offset, offset + components * 4), `Accessor ${i} element ${element} changed`);
      else {
        const limit = 8e-6;
        for (let component = 0; component < components; component += 1) assert.ok(Math.abs(after.readFloatLE(offset + component * 4) - before.readFloatLE(offset + component * 4)) <= limit);
      }
    }
  }
  for (const key of ['materials', 'samplers', 'animations']) assert.deepEqual(mobile.json[key], original.json[key]);
  const joints = original.json.nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.extras?.roachJoint);
  assert.equal(joints.length, 27);
  for (const { node, index } of joints) {
    const next = mobile.json.nodes[index];
    for (const [key, value] of Object.entries(node)) {
      if (key === 'extras') for (const [extra, data] of Object.entries(value)) assert.deepEqual(next.extras[extra], data);
      else if (key === 'children') for (const child of value) assert.ok(next.children.includes(child));
      else assert.deepEqual(next[key], value);
    }
  }
  assert.equal(report.images.length, 80);
  assert.equal(report.invariants.exactPositionsIndicesAndAnimationBytes, true);
  assert.ok(['compact', 'normalhalf'].includes(report.textureProfile));
  assert.equal(report.invariants.textureDimensionsUnchanged, report.textureProfile !== 'normalhalf');
  for (const image of report.images) {
    if (image.mode === 'original' || image.mode === 'lossless') assert.equal(image.maximumPixelError, 0);
    if (image.mode === 'resampled-lossless') {
      assert.equal(report.textureProfile, 'normalhalf'); assert.ok(image.roles.includes('normal'));
      assert.equal(image.outputWidth, image.width / 2); assert.equal(image.outputHeight, image.height / 2);
    } else { assert.equal(image.outputWidth || image.width, image.width); assert.equal(image.outputHeight || image.height, image.height); }
  }
});

test('mobile Roach compression has bounded self-contained buffers and a pinned decoder', () => {
  const mobile = readGlb('cockroach-mobile.glb'); const gltf = mobile.json;
  assert.equal(gltf.buffers.length, 2);
  assert.equal(gltf.buffers[1].extensions.EXT_meshopt_compression.fallback, true);
  assert.ok(gltf.buffers[1].byteLength < 64 * 1024 * 1024);
  assert.ok(gltf.buffers.every((buffer) => !buffer.uri));
  assert.ok(gltf.images.every((image) => !image.uri));
  for (const view of gltf.bufferViews) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    assert.ok((view.byteOffset || 0) + view.byteLength <= gltf.buffers[view.buffer].byteLength);
    if (compressed) {
      assert.equal(compressed.buffer, 0); assert.equal(view.buffer, 1);
      assert.equal(compressed.filter, 'NONE');
      assert.ok(['ATTRIBUTES', 'INDICES'].includes(compressed.mode));
      assert.equal(compressed.count * compressed.byteStride, view.byteLength);
      assert.ok((compressed.byteOffset || 0) + compressed.byteLength <= gltf.buffers[0].byteLength);
    }
  }
  const decoder = readFileSync(new URL('../vendor/meshoptimizer/meshopt_decoder.module.js', import.meta.url));
  assert.equal(sha(decoder), '4ac97b2c44347dacb9a0ca9c3740c8678d166fdcf02bc1612f371e27418e70a7');
});
