#!/usr/bin/env node
// Prepare only the paired cover mesh. The source GLB remains untouched; its
// 27 authored joints, animations, other surfaces, materials and images survive.
// Run before optional lossless meshopt/texture compression:
// node scripts/precompute-roach-wings.mjs input.glb output.glb
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../vendor/three/three.module.min.js';
import { prepareRoachWingGeometry } from '../src/roach-synth-wings.js';

const TYPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const ATTRIBUTE_NAMES = { POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', COLOR_0: 'color' };
const ATTRIBUTE_KEYS = Object.fromEntries(Object.entries(ATTRIBUTE_NAMES).map(([key, name]) => [name, key]));

export function decodeRoachGlb(data) {
  const bytes = Buffer.from(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
  if (bytes.length < 28 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2
    || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Expected a complete GLB 2.0 file.');
  const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
  const json = JSON.parse(bytes.toString('utf8', 20, binHeader));
  if (binHeader + 8 > bytes.length || bytes.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error('Expected an embedded binary chunk.');
  const binary = bytes.subarray(binHeader + 8, binHeader + 8 + bytes.readUInt32LE(binHeader));
  if (json.buffers?.length !== 1 || json.buffers[0].uri || json.buffers[0].byteLength > binary.length) throw new Error('Expected one embedded buffer.');
  return { json, binary: binary.subarray(0, json.buffers[0].byteLength) };
}

function accessorAttribute(json, binary, index) {
  const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
  const Type = COMPONENTS[accessor.componentType], size = TYPES[accessor.type];
  if (!Type || !size || accessor.sparse || view.extensions?.EXT_meshopt_compression || view.extensions?.KHR_meshopt_compression) {
    throw new Error('Prepare the original uncompressed, nonsparse geometry before compression.');
  }
  const stride = view.byteStride ?? Type.BYTES_PER_ELEMENT * size;
  const values = new Type(accessor.count * size);
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * stride;
    const vertex = binary.subarray(offset, offset + size * Type.BYTES_PER_ELEMENT);
    if (vertex.length !== size * Type.BYTES_PER_ELEMENT) throw new Error('Accessor exceeds its binary buffer.');
    new Uint8Array(values.buffer, i * size * Type.BYTES_PER_ELEMENT, vertex.length).set(vertex);
  }
  return new THREE.BufferAttribute(values, size, accessor.normalized === true);
}

/** Geometry-only loading for the offline preparation/parity tests: no browser,
 * image decode, texture rewriting, GLTFExporter, or external dependencies. */
export function roachGeometryScene(json, binary) {
  const materials = (json.materials ?? []).map(() => new THREE.MeshStandardMaterial());
  const objects = json.nodes.map((node) => {
    let object = new THREE.Group();
    if (node.mesh != null) {
      const primitives = json.meshes[node.mesh].primitives;
      if (primitives.length !== 1 || (primitives[0].mode ?? 4) !== 4 || node.skin != null) throw new Error('Expected the known rigid single-primitive roach meshes.');
      const primitive = primitives[0], geometry = new THREE.BufferGeometry();
      for (const [semantic, accessor] of Object.entries(primitive.attributes)) {
        if (!ATTRIBUTE_NAMES[semantic]) throw new Error(`Unsupported source attribute: ${semantic}`);
        geometry.setAttribute(ATTRIBUTE_NAMES[semantic], accessorAttribute(json, binary, accessor));
      }
      if (primitive.indices != null) geometry.setIndex(accessorAttribute(json, binary, primitive.indices));
      object = new THREE.Mesh(geometry, materials[primitive.material] ?? new THREE.MeshStandardMaterial());
    }
    object.name = node.name ?? ''; object.userData = structuredClone(node.extras ?? {});
    if (node.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix));
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  json.nodes.forEach((node, i) => { for (const child of node.children ?? []) objects[i].add(objects[child]); });
  const scene = new THREE.Group();
  for (const root of json.scenes[json.scene ?? 0].nodes) scene.add(objects[root]);
  scene.updateMatrixWorld(true);
  return { scene, objects };
}

function encodeGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4, binaryLength = Math.ceil(binary.length / 4) * 4;
  const result = Buffer.alloc(28 + jsonLength + binaryLength);
  result.write('glTF'); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12); result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + jsonLength); text.copy(result, 20);
  result.writeUInt32LE(binaryLength, 20 + jsonLength); result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  binary.copy(result, 28 + jsonLength);
  return result;
}

export function precomputeRoachWingsGlb(data) {
  const { json, binary } = decodeRoachGlb(data);
  const { scene, objects } = roachGeometryScene(json, binary);
  const parentIndex = json.nodes.findIndex((node) => node.extras?.jointId === 'wings');
  if (parentIndex < 0 || json.nodes[parentIndex].extras.preparedRoachWings) throw new Error('Expected the original, unprepared paired-cover joint.');
  const parent = objects[parentIndex], sources = [];
  parent.traverse((object) => { if (object.isMesh) sources.push(object); });
  if (sources.length !== 1) throw new Error('Expected exactly one original paired-cover mesh.');
  const source = sources[0], sourceIndex = objects.indexOf(source);
  const primitive = json.meshes[json.nodes[sourceIndex].mesh].primitives[0];
  const matrix = parent.matrixWorld.clone().invert().multiply(source.matrixWorld);
  const prepared = prepareRoachWingGeometry(source.geometry, { matrix });
  const pieces = [binary]; let byteLength = binary.length;
  function appendAccessor(attribute, name) {
    const padding = (4 - byteLength % 4) % 4;
    if (padding) { pieces.push(Buffer.alloc(padding)); byteLength += padding; }
    const values = attribute.array;
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target: name === 'index' ? 34963 : 34962 });
    pieces.push(bytes); byteLength += bytes.length;
    const accessor = { bufferView, componentType: values instanceof Uint16Array ? 5123 : values instanceof Uint32Array ? 5125 : 5126,
      count: attribute.count, type: name === 'index' ? 'SCALAR' : `VEC${attribute.itemSize}` };
    if (name === 'position') {
      const box = new THREE.Box3().setFromBufferAttribute(attribute);
      accessor.min = box.min.toArray(); accessor.max = box.max.toArray();
    }
    json.accessors.push(accessor); return json.accessors.length - 1;
  }
  for (const [index, side] of ['left', 'right'].entries()) {
    const geometry = prepared.covers[index], attributes = {};
    for (const [name, attribute] of Object.entries(geometry.attributes)) attributes[ATTRIBUTE_KEYS[name]] = appendAccessor(attribute, name);
    const mesh = json.meshes.length;
    json.meshes.push({ name: `${side} prepared photogrammetry wing cover`, primitives: [{ attributes,
      indices: appendAccessor(geometry.index, 'index'), material: primitive.material, mode: 4 }] });
    const node = json.nodes.length;
    json.nodes.push({ name: `${side} prepared photogrammetry wing cover`, mesh,
      translation: prepared.metadata.hinges[`wing_cover_${side}`], extras: { preparedRoachWingCover: side } });
    json.nodes[parentIndex].children.push(node);
  }
  // Preserve all node indices and authored joint order. The removed source
  // mesh node becomes an empty placeholder; its binary is left for optional
  // downstream compaction, avoiding edits to any unrelated buffer views.
  delete json.nodes[sourceIndex].mesh;
  json.nodes[parentIndex].extras.preparedRoachWings = prepared.metadata;
  json.buffers[0].byteLength = byteLength;
  const output = encodeGlb(json, Buffer.concat(pieces, byteLength));
  scene.traverse((object) => { object.geometry?.dispose(); });
  prepared.covers.forEach((geometry) => geometry.dispose());
  return { buffer: output, metadata: prepared.metadata };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output)) throw new Error('Usage: node scripts/precompute-roach-wings.mjs original.glb prepared.glb (different paths)');
  const source = await readFile(input), result = precomputeRoachWingsGlb(source);
  await writeFile(output, result.buffer);
  console.log(JSON.stringify({ input, output, inputBytes: source.length, outputBytes: result.buffer.length, ...result.metadata }, null, 2));
}
