#!/usr/bin/env node
// Lossless geometry packing of the prepared Spider GLB. Textures are untouched.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { MeshoptEncoder } from './vendor/meshoptimizer/meshopt_encoder.module.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';
const [input, output] = process.argv.slice(2);
assert.ok(input && output && input !== output, 'Input and distinct output GLB required');
const source = await readFile(input), length = source.readUInt32LE(12);
const json = JSON.parse(source.toString('utf8', 20, 20 + length));
const binary = source.subarray(28 + length);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const chunks = []; let offset = 0, fallback = 0;
const append = bytes => { const at = offset; chunks.push(bytes); offset += bytes.length;
  const pad = (4 - offset % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; } return at; };
for (const [index, view] of json.bufferViews.entries()) {
  const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const accessor = json.accessors.find(a => a.bufferView === index);
  if (!view.target || !accessor) { view.byteOffset = append(bytes); continue; }
  const stride = widths[accessor.type] * ({ 5126: 4, 5125: 4, 5123: 2 }[accessor.componentType]);
  const mode = view.target === 34963 ? 'INDICES' : 'ATTRIBUTES';
  const count = bytes.length / stride;
  const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
  const decoded = new Uint8Array(bytes.length);
  MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, encoded, mode, 'NONE');
  assert.equal(Buffer.compare(Buffer.from(decoded), bytes), 0, `Buffer${index} must decode exactly`);
  view.buffer = 1; view.byteOffset = fallback; fallback += bytes.length;
  view.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: append(Buffer.from(encoded)),
    byteLength: encoded.length, byteStride: stride, count, mode, filter: 'NONE' } };
  if (mode === 'ATTRIBUTES') view.byteStride = stride;
}
json.buffers = [{ byteLength: offset }, { byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } }];
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression'])];
json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression'])];
const text = Buffer.from(JSON.stringify(json));
const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + offset, 8);
header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(offset); binHeader.writeUInt32LE(0x004e4942, 4);
const result = Buffer.concat([header, padded, binHeader, ...chunks]);
await writeFile(output, result);
const report = { inputBytes: source.length, outputBytes: result.length, decodedGeometryBytes: fallback,
  geometry: 'All compressed buffers decoded and compared byte-for-byte; no decimation or attribute quantization.',
  inputSha256: createHash('sha256').update(source).digest('hex'), outputSha256: createHash('sha256').update(result).digest('hex') };
await writeFile(`${output}.report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
