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
