import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from '../vendor/three/three.module.min.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';
import { SpiderSynthViewer } from '../src/spider-synth-viewer.js';
import { SpiderSynthWorld } from '../src/spider-synth-world.js';
import { SPIDER_JOINTS, SPIDER_MOTION_PRESETS, SPIDER_WEB_PRESETS, createSpiderWeb, createSpiderFrame, writeSpiderFrame } from '../src/spider-synth-model.js';

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
  viewer.frameData.feet = [{ stance: true, segmentId: segment.id, u: .4 }];
  viewer.setEvents([{ segmentId: segment.id, audioTime: 100, velocity: 1 }], 100);
  viewer.setClock(100.1);
  viewer.updateWeb();
  const samples = viewer.getSegmentSamples(segment.id), toe = samples.find(sample => sample.u === .4);
  assert.ok(toe); assert.equal(toe.displacement, 0);
  assert.ok(samples.some(point => point.displacement > .001), 'The strand still moves on either side of the fixed toe');
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
      if (viewer.frameData.airborne || viewer.frameData.feet[leg.index].airborne) {
        assert.equal(viewer.frameData.feet[leg.index].stance, false);
        assert.ok(Number.isFinite(leg.error)); continue;
      }
      maximum = Math.max(maximum, leg.error);
      assert.ok(Number.isFinite(leg.error) && leg.error < .001, `${preset.id} phase${phase} ${leg.id} contact gap${leg.error}`);
    }
  }
  assert.ok(maximum < .001);
});

test('Skinned support toes reach the three-dimensional strands in every web family', () => {
  const viewer = fixture(), failures = [];
  for (const family of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb(family.settings);
    for (const preset of ['orb-walk', 'radial-run', 'silk-harp']) for (let phase = 0; phase < 16; phase++) {
      writeSpiderFrame(phase * .21, { preset, tempo: 108, intensity: 1, explore: true, seed: 1, center: { x: 0, z: 0 }, yaw: 0, offsets: {} }, web, viewer.frameData);
      viewer.applyFrame();
      for (const leg of viewer.legs) if (viewer.frameData.feet[leg.index].stance && leg.error > .004) failures.push({ family: family.id, preset, phase, leg: leg.id, error: leg.error });
    }
  }
  assert.deepEqual(failures.sort((a, b) => b.error - a.error).slice(0, 12), []);
});

test('Fast world-driven travel keeps the actual rig toes on their anchored strands through turns', () => {
  const viewer = fixture(), failures = [];
  for (const family of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb(family.settings);
    const world = new SpiderSynthWorld({ path: 'hold', speed: 2, range: .85, playing: true, joystick: { x: 0, z: 1 } });
    const motion = { preset: 'radial-run', tempo: 300, intensity: 1, explore: false, seed: 1, center: { x: 0, z: 0 }, yaw: 0, offsets: {} };
    const anchors = new Map();
    for (let step = 0; step <= 120; step++) {
      const time = step / 60;
      if (step === 45) world.update({ joystick: { x: 1, z: 0 } }, time);
      if (step === 90) world.update({ joystick: { x: 0, z: -1 } }, time);
      world.sample(time, motion, web, viewer.frameData, null, null, { motionTime: time, playing: true });
      viewer.applyFrame();
      if (viewer.frameData.supportCount < 4) failures.push({ family: family.id, step, supports: viewer.frameData.supportCount });
      for (const leg of viewer.legs) {
        const foot = viewer.frameData.feet[leg.index];
        if (!foot.stance) { anchors.delete(leg.index); continue; }
        if (leg.error > .004) failures.push({ family: family.id, step, leg: leg.id, gap: leg.error });
        const prior = anchors.get(leg.index);
        const contact = `${viewer.frameData.contactEpoch}:${foot.step}`;
        if (prior && prior.contact === contact) {
          const drift = Math.hypot(foot.x - prior.x, foot.y - prior.y, foot.z - prior.z);
          if (drift > 1e-7) failures.push({ family: family.id, step, leg: leg.id, drift });
        }
        anchors.set(leg.index, { x: foot.x, y: foot.y, z: foot.z, contact });
      }
    }
  }
  assert.deepEqual(failures.slice(0, 15), []);
});

test('actual scan reaches contacts while recovering from a manually steered edge', () => {
  const viewer = fixture(), web = createSpiderWeb();
  const motion = { preset: 'low-sprint', tempo: 300, intensity: .65, explore: false, seed: 1, center: { x: 0, z: 0 }, yaw: 0, offsets: {} };
  for (const next of [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }]) {
    const world = new SpiderSynthWorld({ playing: false, speed: .75 });
    world.sample(0, motion, web, viewer.frameData, null, null, { motionTime: 11.464, playing: false });
    world.command({ type: 'home' }, 0); world.update({ joystick: { x: -1, z: 0 } }, 0);
    for (let i = 0; i <= 156; i++) {
      const time = i / 60;
      if (i === 78) world.update({ joystick: next }, time);
      world.sample(time, motion, web, viewer.frameData, null, null, { motionTime: 11.464, playing: false });
      viewer.applyFrame();
      for (const leg of viewer.legs) if (viewer.frameData.feet[leg.index].stance) {
        assert.ok(leg.error < .004, `${next.z}/${i}/${leg.id}: ${leg.error}`);
      }
    }
  }
});
