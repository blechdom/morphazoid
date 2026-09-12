#!/usr/bin/env node
// Lossless container compression with explicit optional shading/texture quality
// profiles. No graph rewrites, welding, simplification, or vertex reordering.
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { MeshoptEncoder } from './vendor/meshoptimizer/meshopt_encoder.module.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const input = path.resolve(option('--input', path.join(root, 'assets/roach-synth/cockroach.glb')));
const output = path.resolve(option('--output', path.join(root, 'assets/roach-synth/cockroach-mobile.glb')));
const profile = option('--textures', 'lossless');
const attributes = option('--attributes', 'exact');
assert.ok(['lossless', 'color95', 'original', 'mobile', 'compact', 'normalhalf'].includes(profile), 'Unknown texture profile');
assert.ok(['exact', 'precision16', 'precision12'].includes(attributes), 'Unknown attribute profile');
assert.notEqual(input, output, 'The source GLB must never be overwritten');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(input);
assert.equal(source.toString('ascii', 0, 4), 'glTF');
assert.equal(source.readUInt32LE(4), 2);
assert.equal(source.readUInt32LE(8), source.length);
const jsonLength = source.readUInt32LE(12);
assert.equal(source.readUInt32LE(16), 0x4e4f534a);
const original = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
const gltf = structuredClone(original);
assert.equal(gltf.buffers.length, 1, 'Builder accepts self-contained uncompressed inputs');
assert.ok(!gltf.buffers[0].uri);
assert.equal(source.readUInt32LE(24 + jsonLength), 0x004e4942);
const binary = Buffer.from(source.subarray(28 + jsonLength, 28 + jsonLength + gltf.buffers[0].byteLength));
assert.equal(binary.length, gltf.buffers[0].byteLength);
assert.ok(!gltf.bufferViews.some((view) => view.extensions?.EXT_meshopt_compression), 'Input is already compressed');
const temporary = await mkdtemp(path.join(tmpdir(), 'roach-asset-'));
try {
  const attributeResults = [];
  if (attributes !== 'exact') {
    const selected = new Map();
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) for (const [semantic, index] of Object.entries(primitive.attributes)) {
      if (/^(NORMAL|TANGENT|TEXCOORD_\d+)$/.test(semantic)) selected.set(index, semantic);
    }
    for (const [index, semantic] of selected) {
      const accessor = gltf.accessors[index]; assert.equal(accessor.componentType, 5126);
      const components = { VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type]; assert.ok(components);
      const view = gltf.bufferViews[accessor.bufferView]; const stride = view.byteStride || components * 4;
      const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
      const discardedBits = attributes === 'precision12' && !semantic.startsWith('TEXCOORD_') ? 12 : 8;
      const rounding = 2 ** (discardedBits - 1); const mask = (0xffffffff << discardedBits) >>> 0;
      const minimum = Array(components).fill(Infinity); const maximum = Array(components).fill(-Infinity);
      let maximumError = 0; let energy = 0; let maximumAngle = 0;
      for (let element = 0; element < accessor.count; element += 1) {
        let dot = 0; let beforeLength = 0; let afterLength = 0;
        for (let component = 0; component < components; component += 1) {
          const offset = start + element * stride + component * 4;
          const before = binary.readFloatLE(offset); assert.ok(Number.isFinite(before));
          // Retain sign/exponent, round only low mantissa bits. UVs always
          // retain 16 significant bits; POSITION is never selected here.
          const bits = binary.readUInt32LE(offset);
          binary.writeUInt32LE(((bits + rounding) & mask) >>> 0, offset);
          const after = binary.readFloatLE(offset); const error = Math.abs(after - before);
          maximumError = Math.max(maximumError, error); energy += error * error;
          minimum[component] = Math.min(minimum[component], after); maximum[component] = Math.max(maximum[component], after);
          if (component < 3) { dot += before * after; beforeLength += before * before; afterLength += after * after; }
        }
        if (semantic === 'NORMAL' || semantic === 'TANGENT') maximumAngle = Math.max(maximumAngle, Math.acos(Math.max(-1, Math.min(1, dot / Math.sqrt(beforeLength * afterLength)))) * 180 / Math.PI);
      }
      if (accessor.min) accessor.min = minimum;
      if (accessor.max) accessor.max = maximum;
      attributeResults.push({ index, semantic, significantBits: 24 - discardedBits, count: accessor.count, maximumError, rmsError: Math.sqrt(energy / (accessor.count * components)), maximumAngularDegrees: maximumAngle });
    }
  }
  // Identify image roles through material texture slots, never filename guesses.
  const imageRoles = gltf.images.map(() => new Set());
  function inspect(value, key = '') {
    if (!value || typeof value !== 'object') return;
    if (key.endsWith('Texture') && Number.isInteger(value.index)) {
      const image = gltf.textures[value.index]?.source;
      if (Number.isInteger(image)) imageRoles[image].add(key === 'normalTexture' ? 'normal' : key === 'baseColorTexture' || key === 'emissiveTexture' ? 'color' : 'data');
    }
    for (const [childKey, child] of Object.entries(value)) inspect(child, childKey);
  }
  inspect(gltf.materials);
  const jobs = [];
  for (let index = 0; index < gltf.images.length; index += 1) {
    const image = gltf.images[index]; assert.ok(Number.isInteger(image.bufferView) && !image.uri);
    const view = gltf.bufferViews[image.bufferView];
    const filename = `image-${index}`;
    await writeFile(path.join(temporary, filename), binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
    jobs.push({ index, input: filename, mimeType: image.mimeType, roles: [...imageRoles[index]], colorOnly: imageRoles[index].has('color') && imageRoles[index].size === 1,
      faceColor: imageRoles[index].has('color') && /head/i.test(view.name || '') });
  }
  await writeFile(path.join(temporary, 'texture-jobs.json'), JSON.stringify(jobs));
  const textures = spawnSync(option('--python', 'python3'), [path.join(root, 'scripts/optimize-roach-textures.py'), temporary, profile], { stdio: 'inherit' });
  assert.equal(textures.status, 0, 'Texture stage failed');
  const textureResults = JSON.parse(await readFile(path.join(temporary, 'texture-results.json'), 'utf8'));
  const imageViews = new Map();
  for (const result of textureResults) {
    imageViews.set(gltf.images[result.index].bufferView, result);
    gltf.images[result.index].mimeType = result.mimeType;
    if (result.mimeType === 'image/webp') for (const texture of gltf.textures) if (texture.source === result.index) {
      texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: result.index } }; delete texture.source;
    }
  }
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const chunks = []; let total = 0; let decodedTotal = 0;
  function append(bytes) { const offset = total; chunks.push(bytes); total += bytes.length; const pad = (4 - total % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); total += pad; } return offset; }
  const viewResults = [];
  for (let index = 0; index < gltf.bufferViews.length; index += 1) {
    const view = gltf.bufferViews[index];
    const bytes = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    assert.equal(bytes.length, view.byteLength);
    const image = imageViews.get(index);
    if (image) {
      const encoded = await readFile(path.join(temporary, image.output));
      view.buffer = 0; view.byteOffset = append(encoded); view.byteLength = encoded.length;
      continue;
    }
    const references = gltf.accessors.filter((accessor) => accessor.bufferView === index);
    const indices = references.length > 0 && references.every((a) => a.type === 'SCALAR' && (a.componentType === 5123 || a.componentType === 5125));
    const stride = view.byteStride || (indices ? (references[0].componentType === 5123 ? 2 : 4) : 4);
    assert.equal(bytes.length % stride, 0);
    const count = bytes.length / stride; const mode = indices ? 'INDICES' : 'ATTRIBUTES';
    const encoded = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
    const decoded = new Uint8Array(bytes.length);
    MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, encoded, mode, 'NONE');
    assert.deepEqual(Buffer.from(decoded), bytes, `View ${index} changed after compression`);
    const useCompression = encoded.length < bytes.length;
    viewResults.push({ index, originalBytes: bytes.length, storedBytes: useCompression ? encoded.length : bytes.length, decodedSha256: sha(bytes), mode, byteStride: stride, count, compressed: useCompression });
    if (useCompression) {
      view.buffer = 1; view.byteOffset = decodedTotal; decodedTotal += bytes.length;
      view.extensions = { ...view.extensions, EXT_meshopt_compression: { buffer: 0, byteOffset: append(Buffer.from(encoded)), byteLength: encoded.length, byteStride: stride, count, mode, filter: 'NONE' } };
    } else { view.buffer = 0; view.byteOffset = append(bytes); }
  }
  gltf.buffers = [{ byteLength: total }, { byteLength: decodedTotal, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  const extensions = ['EXT_meshopt_compression'];
  if (textureResults.some((image) => image.mimeType === 'image/webp')) extensions.push('EXT_texture_webp');
  gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed || []), ...extensions])];
  gltf.extensionsRequired = [...new Set([...(gltf.extensionsRequired || []), ...extensions])];
  // Every semantic graph and accessor remains exactly unchanged.
  for (const key of ['nodes', 'meshes', 'materials', 'animations', 'skins', 'scenes', 'scene', 'samplers']) assert.deepEqual(gltf[key], original[key], `${key} changed`);
  const accessorLayout = (items) => items.map(({ min, max, ...layout }) => layout);
  assert.deepEqual(accessorLayout(gltf.accessors), accessorLayout(original.accessors), 'Accessor layout changed');
  if (attributes === 'exact') assert.deepEqual(gltf.accessors, original.accessors);
  const json = Buffer.from(JSON.stringify(gltf)); const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + jsonPadding.length + total, 8); header.writeUInt32LE(json.length + jsonPadding.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(total); binHeader.writeUInt32LE(0x004e4942, 4);
  const result = Buffer.concat([header, json, jsonPadding, binHeader, ...chunks]);
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, result);
  const report = { schemaVersion: 1, textureProfile: profile, attributeProfile: attributes, tools: { meshoptimizer: '0.25', pillow: '10.2.0', libwebp: '1.3.2' }, source: { bytes: source.length, sha256: sha(source) }, output: { bytes: result.length, sha256: sha(result), reductionPercent: (1 - result.length / source.length) * 100 }, invariants: { exactDecodedGeometryAndAnimationBytes: attributes === 'exact', exactPositionsIndicesAndAnimationBytes: true, semanticGraphsAndAccessorLayoutsUnchanged: true, losslessImagePixels: profile === 'lossless' || profile === 'original', textureDimensionsUnchanged: profile !== 'normalhalf' }, nodes: gltf.nodes.length, joints: gltf.nodes.filter((node) => node.extras?.roachJoint).length, meshoptDecodedBytes: decodedTotal, attributes: attributeResults, views: viewResults, images: textureResults.map(({ input: ignoredInput, output: ignoredOutput, ...data }) => data) };
  await writeFile(`${output}.report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...report.output, decodedBytes: decodedTotal, preservedJoints: report.joints }));
} finally { await rm(temporary, { recursive: true, force: true }); }
