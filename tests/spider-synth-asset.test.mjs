import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from '../vendor/three/three.module.min.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';
import { SpiderSynthViewer } from '../src/spider-synth-viewer.js';
import { SPIDER_JOINTS, SPIDER_MOTION_PRESETS, createSpiderWeb, createSpiderFrame, writeSpiderFrame } from '../src/spider-synth-model.js';

const rig = JSON.parse(await readFile(new URL('../assets/spider-synth/rig-manifest.json', import.meta.url)));
const bytes = await readFile(new URL('../assets/spider-synth/spider-mobile.glb', import.meta.url));
const report = JSON.parse(await readFile(new URL('../assets/spider-synth/spider-mobile.glb.report.json', import.meta.url)));
const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary = bytes.subarray(28 + length);
await MeshoptDecoder.ready;
function accessor(index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView], packed = view.extensions?.EXT_meshopt_compression;
  let data;
  if (packed) {
    data = new Uint8Array(view.byteLength);
    MeshoptDecoder.decodeGltfBuffer(data, packed.count, packed.byteStride, binary.subarray(packed.byteOffset, packed.byteOffset + packed.byteLength), packed.mode, packed.filter);
  } else data = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  const copy = new Uint8Array(data).buffer;
  return a.componentType === 5123 ? new Uint16Array(copy) : a.componentType === 5125 ? new Uint32Array(copy) : new Float32Array(copy);
}

test('Spider delivery contains the complete real scan, a valid 38-joint skin and no calibration cube', () => {
  assert.ok(bytes.length < 6 * 1024 * 1024);
  assert.equal(json.asset.extras.license, 'CC0-1.0');
  assert.equal(json.meshes.length, 1); assert.equal(json.skins.length, 1);
  assert.equal(json.skins[0].joints.length, 38);
  assert.deepEqual(rig.joints.map(j => j.id), SPIDER_JOINTS.map(j => j.id));
  assert.equal(json.accessors[json.meshes[0].primitives[0].indices].count / 3, 106200);
  assert.equal(rig.texture.width, 4096); assert.equal(rig.texture.height, 4096);
  assert.ok(json.nodes.every(node => !/cube/i.test(node.name)));
  assert.ok(json.nodes.every(node => !Object.hasOwn(node.extras || {}, 'pivot')), 'Generic extras.pivot makes Three rewrite child bone positions');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.outputSha256);
});

test('Shared-clock prey and strand pulses expire without Audio, and planted contacts stay on the web', () => {
  const viewer = Object.assign(Object.create(SpiderSynthViewer.prototype), {
    scene: new THREE.Scene(), webRoot: new THREE.Group(), webLines: [], recentEvents: [], audioTime: 0,
    frameData: { feet: [] }, invalidate() {},
  });
  const web = createSpiderWeb(); viewer.setWeb(web); viewer.setClock(100);
  const segment = web.segments[0];
  viewer.frameData.feet = [{ stance: true, segmentId: segment.id }];
  viewer.setEvents([{ segmentId: segment.id, audioTime: 100, velocity: 1 }], 100);
  viewer.updateWeb();
  const group = viewer.webLines.find(entry => entry.segments.includes(segment));
  const start = group.segments.indexOf(segment) * 8;
  for (let vertex = start; vertex < start + 8; vertex++) assert.ok(Math.abs(group.lines.geometry.attributes.position.getY(vertex) - .0002) < 1e-9);
  viewer.frameData.feet[0].stance = false; viewer.updateWeb();
  assert.ok(Array.from({ length: 8 }, (_, index) => group.lines.geometry.attributes.position.getY(start + index)).some(y => Math.abs(y - .0002) > .0001));
  assert.equal(viewer.showPrey({ segmentId: segment.id, u: .4 }), true);
  viewer.updateWeb(); assert.equal(viewer.prey.visible, true);
  viewer.setClock(102.3); viewer.updateWeb(); assert.equal(viewer.prey.visible, false);
  viewer.showPrey({ segmentId: segment.id }); viewer.setClock(.1); viewer.updateWeb();
  assert.equal(viewer.prey.visible, false); assert.deepEqual(viewer.recentEvents, []);
});

test('Every source vertex has finite normalized skin weights and neutral inverse binds preserve its surface', () => {
  const primitive = json.meshes[0].primitives[0], weights = accessor(primitive.attributes.WEIGHTS_0), indices = accessor(primitive.attributes.JOINTS_0);
  const positions = accessor(primitive.attributes.POSITION), inverse = accessor(json.skins[0].inverseBindMatrices), usage = new Uint32Array(38);
  for (let v = 0; v < positions.length / 3; v++) {
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const i = v * 4 + k; assert.ok(indices[i] < 38); assert.ok(Number.isFinite(weights[i]) && weights[i] >= 0);
      total += weights[i]; if (weights[i] > .01) usage[indices[i]]++;
    }
    assert.ok(Math.abs(total - 1) < 1e-6);
  }
  assert.ok([...usage].every(count => count > 50), 'Every named joint controls actual scanned vertices');
  for (let i = 0; i < 38; i++) {
    const bind = new THREE.Matrix4().makeTranslation(...rig.joints[i].pivot);
    const inverseBind = new THREE.Matrix4().fromArray(inverse, i * 16);
    bind.multiply(inverseBind);
    assert.ok(bind.elements.every((value, axis) => Math.abs(value - (axis % 5 === 0 ? 1 : 0)) < 2e-8));
  }
});

function fixture() {
  const viewer = Object.create(SpiderSynthViewer.prototype);
  viewer.temp = Array.from({ length: 12 }, () => new THREE.Vector3());
  viewer.turn = new THREE.Quaternion(); viewer.parentQuaternion = new THREE.Quaternion(); viewer.worldQuaternion = new THREE.Quaternion(); viewer.euler = new THREE.Euler();
  viewer.performer = new THREE.Group(); viewer.loaded = true; viewer.showJoints = false;
  viewer.bones = rig.joints.map((record, index) => ({ ...record, index, bone: new THREE.Bone(), rest: new THREE.Quaternion() }));
  const map = new Map(viewer.bones.map(b => [b.id, b]));
  viewer.bones.forEach(entry => {
    const parent = map.get(entry.parent);
    entry.bone.position.fromArray(entry.pivot);
    if (parent) entry.bone.position.sub(new THREE.Vector3().fromArray(parent.pivot));
    (parent?.bone || viewer.performer).add(entry.bone);
  });
  viewer.legs = rig.legs.map((leg, index) => ({ ...leg, index, chain: leg.jointIds.map(id => map.get(id).bone),
    points: Array.from({ length: 5 }, () => new THREE.Vector3()), target: new THREE.Vector3(), actual: new THREE.Vector3(),
    end: new THREE.Vector3().fromArray(leg.anchors[4]).sub(new THREE.Vector3().fromArray(leg.anchors[3])), error: 0 }));
  viewer.mesh = { skeleton: { update() {} } }; viewer.frameData = createSpiderFrame(); return viewer;
}
test('Actual scan joint lengths reach shared web contacts across every routine without changing the supplied pose', () => {
  const viewer = fixture(), web = createSpiderWeb(); let maximum = 0;
  for (const preset of SPIDER_MOTION_PRESETS) for (let phase = 0; phase < 20; phase++) {
    writeSpiderFrame(phase * .19, { preset: preset.id, tempo: 108, intensity: 1, explore: true, seed: 1, center: { x: 0, z: 0 }, yaw: 0, offsets: {} }, web, viewer.frameData);
    const pose = [...viewer.frameData.pose]; viewer.applyFrame(); assert.deepEqual([...viewer.frameData.pose], pose);
    for (const leg of viewer.legs) {
      maximum = Math.max(maximum, leg.error);
      assert.ok(Number.isFinite(leg.error) && leg.error < .001, `${preset.id} phase${phase} ${leg.id} contact gap${leg.error}`);
    }
  }
  assert.ok(maximum < .001);
});
