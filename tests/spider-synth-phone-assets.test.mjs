import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';

const specimens = [
  ['argiope', 106200], ['golden', 116379], ['devil', 161171],
  ['tarantula', 239276], ['huntsman', 171906], ['fishing', 147012],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await MeshoptDecoder.ready;

function glb(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const length = bytes.readUInt32LE(12), binary = bytes.subarray(28 + length);
  assert.equal(bytes.readUInt32LE(20 + length), binary.length);
  assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942);
  return { bytes, json: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary };
}

function payload(model, index) {
  const view = model.json.bufferViews[index], packed = view.extensions?.EXT_meshopt_compression;
  const layout = packed || view;
  assert.equal(layout.buffer, 0);
  const at = layout.byteOffset || 0;
  assert.ok(at % 4 === 0 && at + layout.byteLength <= model.binary.length);
  return model.binary.subarray(at, at + layout.byteLength);
}

function decoded(model, index) {
  const view = model.json.bufferViews[index], packed = view.extensions?.EXT_meshopt_compression;
  if (!packed) return payload(model, index);
  assert.equal(view.buffer, 1); assert.equal(packed.count * packed.byteStride, view.byteLength);
  const result = new Uint8Array(view.byteLength);
  MeshoptDecoder.decodeGltfBuffer(result, packed.count, packed.byteStride, payload(model, index), packed.mode, packed.filter);
  return result;
}

function webpSize(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  for (let at = 12; at + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8;
    assert.ok(start + size <= bytes.length);
    if (kind === 'VP8X') return [1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3)];
    if (kind === 'VP8 ') {
      assert.equal(bytes.toString('hex', start + 3, start + 6), '9d012a');
      return [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
    }
    if (kind === 'VP8L') {
      assert.equal(bytes[start], 0x2f); const bits = bytes.readUInt32LE(start + 1);
      return [(bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1];
    }
    at = start + size + size % 2;
  }
  assert.fail('Embedded WebP has no image dimensions');
}

for (const [id, triangles] of specimens) test(`${id} phone atlas saves texture memory while preserving the complete original rig and mesh bytes`, async () => {
  const base = new URL(`../assets/spider-synth/${id === 'argiope' ? '' : `skins/${id}/`}`, import.meta.url);
  const [sourceBytes, phoneBytes, sourceReportBytes, reportBytes] = await Promise.all(
    ['spider-mobile.glb', 'spider-phone.glb', 'spider-mobile.glb.report.json', 'spider-phone.glb.report.json'].map(file => readFile(new URL(file, base))),
  );
  const original = glb(sourceBytes), phone = glb(phoneBytes), sourceReport = JSON.parse(sourceReportBytes), report = JSON.parse(reportBytes);
  assert.equal(sha(sourceBytes), sourceReport.outputSha256, 'Full-detail source remains unchanged');
  assert.equal(report.source.sha256, sourceReport.outputSha256); assert.equal(report.source.bytes, sourceBytes.length);
  assert.equal(report.output.sha256, sha(phoneBytes)); assert.equal(report.output.bytes, phoneBytes.length);
  assert.equal(report.profile, 'phone-2k-q90'); assert.equal(report.specimen, id);
  assert.deepEqual(report.tools, { pillow: '10.2.0', libwebp: '1.3.2' });
  // The tarantula's unusually small original atlas leaves most of its transfer
  // occupied by unchanged mesh streams; enforce its actual achievable saving.
  assert.ok(phoneBytes.length < sourceBytes.length * (id === 'tarantula' ? .92 : .8));
  assert.ok(phoneBytes.length < 5 * 1024 * 1024);
  for (const key of ['asset', 'accessors', 'meshes', 'skins', 'nodes', 'animations', 'materials', 'samplers', 'textures', 'scenes', 'scene', 'extensionsUsed', 'extensionsRequired']) {
    assert.deepEqual(phone.json[key], original.json[key], `${key} retained exactly`);
  }
  assert.equal(phone.json.skins[0].joints.length, 38);
  assert.equal(phone.json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + phone.json.accessors[p.indices].count / 3, 0), 0), triangles);
  assert.equal(phone.json.images.length, 1);
  const imageView = phone.json.images[0].bufferView;
  assert.equal(imageView, original.json.images[0].bufferView);
  assert.equal(phone.json.images[0].mimeType, 'image/webp');
  assert.deepEqual(webpSize(payload(original, imageView)), [4096, 4096]);
  assert.deepEqual(webpSize(payload(phone, imageView)), [2048, 2048]);
  assert.equal(report.texture.sourceSha256, sha(payload(original, imageView)));
  assert.equal(report.texture.sha256, sha(payload(phone, imageView)));
  assert.equal(report.texture.rgbaBytes, 2048 * 2048 * 4);
  assert.equal(report.texture.sourceRgbaBytes, report.texture.rgbaBytes * 4);
  assert.equal(report.texture.rgbaMipBytes, 22369620);
  assert.equal(report.texture.sourceRgbaMipBytes, 89478484);
  assert.ok(report.texture.encodingPsnrDbAgainstResampledReference > 35);
  assert.equal(phone.json.bufferViews.length, original.json.bufferViews.length);
  assert.equal(report.preservedPayloads.length, phone.json.bufferViews.length - 1);
  for (let index = 0; index < phone.json.bufferViews.length; index++) {
    const sourceView = original.json.bufferViews[index], view = phone.json.bufferViews[index];
    assert.ok((view.byteOffset || 0) + view.byteLength <= phone.json.buffers[view.buffer].byteLength);
    if (index === imageView) continue;
    assert.deepEqual(payload(phone, index), payload(original, index), `${index}: literal encoded payload`);
    assert.deepEqual(decoded(phone, index), decoded(original, index), `${index}: exact decoded positions/indices/UVs/weights/joints/inverse binds`);
    const evidence = report.preservedPayloads.find(item => item.bufferView === index);
    assert.equal(evidence.sha256, sha(payload(phone, index))); assert.equal(evidence.bytes, payload(phone, index).length);
    const normalize = value => { const next = structuredClone(value); if (next.buffer === 0) delete next.byteOffset; if (next.extensions?.EXT_meshopt_compression) delete next.extensions.EXT_meshopt_compression.byteOffset; return next; };
    assert.deepEqual(normalize(view), normalize(sourceView), `${index}: buffer layout unchanged except physical offset`);
  }
  assert.deepEqual(phone.json.buffers.slice(1), original.json.buffers.slice(1));
  assert.equal(report.decodedGeometryBytes, sourceReport.decodedGeometryBytes);
  assert.ok(phone.json.buffers.every(buffer => !buffer.uri)); assert.ok(phone.json.images.every(image => !image.uri));
  assert.equal(phone.json.buffers[0].byteLength, phone.binary.length);
  assert.deepEqual(report.invariants, { exactCompressedGeometryAndRigPayloads: true, exactAccessorAndSceneMetadata: true, allTrianglesAndWeightsRetained: true, selfContained: true });
});
