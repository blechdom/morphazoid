import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRoachGlb } from '../src/roach-synth-viewer.js';

function glb(document, binaryBytes = 4) {
  const encoded = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, ...document }));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(12 + 8 + jsonLength + 8 + binaryBytes);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonLength).fill(32);
  new Uint8Array(buffer, 20, encoded.length).set(encoded);
  view.setUint32(20 + jsonLength, binaryBytes, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  return buffer;
}

test('GLB preflight counts explicit rigid joints and shared skeleton joints once', () => {
  const info = inspectRoachGlb(glb({
    nodes: [{ extras: { roachJoint: true }, children: [1] }, {}],
    skins: [{ joints: [0, 1] }, { joints: [0, 1] }],
  }));
  assert.equal(info.joints, 2);
});

test('GLB preflight rejects external buffers and images before the loader can request them', () => {
  assert.throws(() => inspectRoachGlb(glb({ buffers: [{ uri: 'https://example.com/model.bin' }] })), /embedded/);
  assert.throws(() => inspectRoachGlb(glb({ images: [{ uri: '../private-image.png' }] })), /embedded/);
  assert.throws(() => inspectRoachGlb(glb({ images: [{ uri: 'data:image/png;base64,abc' }] })), /embedded/);
});

test('GLB preflight rejects cycles and shared children before recursive scene parsing', () => {
  assert.throws(() => inspectRoachGlb(glb({ nodes: [{ children: [1] }, { children: [0] }] })), /hierarchy/);
  assert.throws(() => inspectRoachGlb(glb({ nodes: [{ children: [2] }, { children: [2] }, {}] })), /parents/);
});

test('GLB preflight bounds scene, vertex, and expanded accessor resources', () => {
  assert.throws(() => inspectRoachGlb(glb({ nodes: Array(2049).fill({}) })), /budget/);
  assert.throws(() => inspectRoachGlb(glb({
    accessors: [{ count: 1_000_001, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  })), /one million/);
  assert.throws(() => inspectRoachGlb(glb({ accessors: [{ count: 6_000_000, type: 'MAT4' }] })), /budget/);
});

test('GLB preflight refuses truncated and out-of-range binary data', () => {
  assert.throws(() => inspectRoachGlb(new ArrayBuffer(3)), /GLB/);
  const complete = glb({});
  assert.throws(() => inspectRoachGlb(complete.slice(0, -1)), /valid GLB/);
  assert.throws(() => inspectRoachGlb(glb({ bufferViews: [{ buffer: 0, byteOffset: 2, byteLength: 8 }] })), /buffer range/);
});

function packedDocument() {
  return {
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [{ byteLength: 4 }, { byteLength: 16, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    bufferViews: [{ buffer: 1, byteOffset: 0, byteLength: 16, extensions: {
      EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 4, byteStride: 4, count: 4, mode: 'ATTRIBUTES', filter: 'NONE' },
    } }],
  };
}

test('compressed GLB preflight permits embedded mesh data with a bounded virtual decode buffer', () => {
  const document = packedDocument();
  assert.equal(inspectRoachGlb(glb(document)).json.buffers[1].byteLength, 16);
  document.buffers[1].extensions.EXT_meshopt_compression.fallback = false;
  assert.throws(() => inspectRoachGlb(glb(document)), /decompression buffer/);
});

test('compressed GLB preflight rejects external streams, truncated data and inconsistent decode sizes', () => {
  for (const change of [
    packed => { packed.buffer = 1; },
    packed => { packed.byteOffset = 2; },
    packed => { packed.byteLength = 0; },
    packed => { packed.count = 100; },
    packed => { packed.count = 1.5; },
    packed => { packed.byteStride = 3; },
    packed => { packed.mode = 'UNKNOWN'; },
    packed => { packed.mode = 'TRIANGLES'; },
  ]) {
    const document = packedDocument();
    change(document.bufferViews[0].extensions.EXT_meshopt_compression);
    assert.throws(() => inspectRoachGlb(glb(document)), /compressed buffer/);
  }
  const document = packedDocument();
  delete document.bufferViews[0].extensions;
  assert.throws(() => inspectRoachGlb(glb(document)), /buffer range/);
});

test('compressed GLB preflight limits total allocation even when virtual ranges overlap', () => {
  const document = packedDocument();
  const budget = 64 * 1024 * 1024;
  document.buffers[1].byteLength = budget;
  document.bufferViews[0].byteLength = budget;
  document.bufferViews[0].extensions.EXT_meshopt_compression.count = budget / 4;
  document.bufferViews.push(structuredClone(document.bufferViews[0]));
  assert.throws(() => inspectRoachGlb(glb(document)), /decompression budget/);
  document.bufferViews.pop();
  document.buffers[1].byteLength = budget + 1;
  assert.throws(() => inspectRoachGlb(glb(document)), /decompression buffer/);
});

test('an alternative meshopt extension cannot bypass the decompression preflight', () => {
  const document = { buffers: [{ byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4,
    extensions: { KHR_meshopt_compression: { buffer: 0, byteLength: 4, count: 1_000_000, byteStride: 256, mode: 'ATTRIBUTES' } },
  }] };
  assert.throws(() => inspectRoachGlb(glb(document)), /unsupported compressed buffer/);
});
