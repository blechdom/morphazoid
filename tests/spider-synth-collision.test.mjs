import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.min.js';
import { SpiderSynthViewer } from '../src/spider-synth-viewer.js';
import { createSpiderCollisionProfile, constrainSpiderCollisionPose, constrainSpiderCollisionRoot, measureSpiderBodyPenetration, spiderSegmentDistance, createSpiderCollisionSolver, createSpiderCollisionBodies, writeSpiderCollisionBodies } from '../src/spider-synth-collision.js';
import { createSpiderWeb, createSpiderFrame, writeSpiderFrame, writeSpiderPose, normalizeSpiderMotion, createSpiderStaticPose, SPIDER_MOTION_PRESETS } from '../src/spider-synth-model.js';
import { SPIDER_SPECIMENS } from '../src/spider-synth-specimens.js';
import { SpiderSynthWorld } from '../src/spider-synth-world.js';

const rig = JSON.parse(await readFile(new URL('../assets/spider-synth/rig-manifest.json', import.meta.url), 'utf8'));
const profile = createSpiderCollisionProfile(rig);
const point = (x, y, z) => ({ x, y, z });

function viewerFixture(rigData = rig) {
  const rig = rigData, profile = createSpiderCollisionProfile(rig);
  const performer = new THREE.Group();
  const bones = rig.joints.map((meta, index) => ({ ...meta, index, bone: new THREE.Bone(), rest: new THREE.Quaternion() }));
  for (const entry of bones) {
    const parent = bones.find(b => b.id === entry.parent);
    entry.bone.position.fromArray(entry.pivot); if (parent) entry.bone.position.sub(new THREE.Vector3().fromArray(parent.pivot));
    (parent?.bone || performer).add(entry.bone);
  }
  const legs = rig.legs.map((leg, index) => ({ ...leg, index, radii: profile.legs[index].radii,
    chain: leg.jointIds.map(id => bones.find(b => b.id === id).bone), points: Array.from({ length: 5 }, () => new THREE.Vector3()),
    end: new THREE.Vector3().fromArray(leg.anchors[4]).sub(new THREE.Vector3().fromArray(leg.anchors[3])),
    actual: new THREE.Vector3(), target: new THREE.Vector3(), root: new THREE.Vector3(), error: 0,
  }));
  return Object.assign(Object.create(SpiderSynthViewer.prototype), {
    loaded: true, performer, bones, legs, mesh: { skeleton: { update() {} } },
    temp: Array.from({ length: 12 }, () => new THREE.Vector3()), turn: new THREE.Quaternion(), euler: new THREE.Euler(),
    parentQuaternion: new THREE.Quaternion(), worldQuaternion: new THREE.Quaternion(), frameData: createSpiderFrame(),
    collisionProfile: profile, collisionSolver: createSpiderCollisionSolver(profile), collisionChains: legs,
    collisionBodies: profile.bodies.map(body => ({ ...body, a: new THREE.Vector3(), b: new THREE.Vector3(), worldCenter: new THREE.Vector3(), axes: new Float64Array(9) })),
  });
}

test('segment distance handles crossing, parallel, degenerate and separated capsules', () => {
  assert.equal(spiderSegmentDistance(point(-1, 0, 0), point(1, 0, 0), point(0, -1, 0), point(0, 1, 0)).distance, 0);
  assert.equal(spiderSegmentDistance(point(-1, 0, 0), point(1, 0, 0), point(-1, 2, 0), point(1, 2, 0)).distance, 2);
  assert.equal(spiderSegmentDistance(point(0, 0, 0), point(0, 0, 0), point(1, 0, 0), point(1, 0, 0)).distance, 1);
  assert.equal(spiderSegmentDistance(point(0, 0, 0), point(1, 0, 0), point(2, 0, 0), point(3, 0, 0)).distance, 1);
});

test('interior capsule crossings separate without moving either strand contact or stretching links', () => {
  const chain = values => {
    const points = values.map(value => point(...value));
    return { points, radii: [.025, .025, .025, .025], lengths: points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y, p.z - points[i].z)), root: { ...points[0] }, target: { ...points[4] } };
  };
  const a = chain([[-1, 0, 0], [-.5, .3, 0], [0, 0, 0], [.5, -.3, 0], [1, 0, 0]]);
  const b = chain([[0, 0, -1], [0, .3, -.5], [0, 0, 0], [0, -.3, .5], [0, 0, 1]]);
  const solver = createSpiderCollisionSolver({ bodies: [], legs: [a, b], tolerance: .0001 });
  assert.ok(solver.measure([a, b], []).legPenetration > .04);
  const result = solver.solve([a, b], []);
  assert.ok(result.legPenetration < .0002, `${result.legPenetration}`);
  assert.ok(result.footError < 1e-8); assert.ok(result.lengthError < 1e-10);
  assert.deepEqual(a.points[0], a.root); assert.deepEqual(b.points[0], b.root);
});

test('a blocked face axis preserves a free abdomen lift and other independent expression', () => {
  const pose = new Float32Array(114); pose.set([.4, .2, .1], 3); pose.set([.6, -.6, .6], 6);
  constrainSpiderCollisionPose(pose, profile);
  assert.ok(Math.abs(pose[3] - .4) < 1e-7);
  assert.ok(measureSpiderBodyPenetration(pose, profile) <= profile.tolerance + 1e-10);
});

test('cached body guards retain fresh leg gestures and are idempotent across output buffers', () => {
  for (const specimen of SPIDER_SPECIMENS) {
    const localProfile = createSpiderCollisionProfile(specimen.rig);
    const input = Float64Array.from({ length: 114 }, (_, index) => Math.sin(index * 13.1) * .7);
    const guarded = new Float64Array(114); constrainSpiderCollisionPose(input, localProfile, guarded);
    assert.ok(measureSpiderBodyPenetration(guarded, localProfile) <= localProfile.tolerance + 1e-10, specimen.id);
    const anotherGesture = input.slice(); anotherGesture[42] = -.311;
    const cached = new Float64Array(114); constrainSpiderCollisionPose(anotherGesture, localProfile, cached);
    assert.deepEqual(cached.slice(0, 18), guarded.slice(0, 18)); assert.equal(cached[42], -.311);
    const twice = cached.slice(); constrainSpiderCollisionPose(twice, localProfile);
    assert.deepEqual(twice, cached);
  }
});

test('alternating base and composed body poses retain exact uncached results through cache eviction', () => {
  for (const ArrayType of [Float32Array, Float64Array]) for (const specimen of SPIDER_SPECIMENS) {
    const localProfile = createSpiderCollisionProfile(specimen.rig);
    const inputs = Array.from({ length: 12 }, (_, seed) => ArrayType.from({ length: 114 }, (_, index) => Math.sin(index * 13.1 + seed * .71) * .7));
    const expected = inputs.map(input => constrainSpiderCollisionPose(input, createSpiderCollisionProfile(specimen.rig), new ArrayType(114)));
    for (const index of [0, 1, 2, 3, 0, 2, 1, 3, 4, 5, 6, 7, 0, 8, 9, 10, 11, 0, 1, 8]) {
      const freshLeg = inputs[index].slice(); freshLeg[42] = .123;
      const result = constrainSpiderCollisionPose(freshLeg, localProfile, new ArrayType(114));
      assert.deepEqual(result.slice(0, 18), expected[index].slice(0, 18), `${specimen.id}/${ArrayType.name}/${index}`);
      assert.equal(result[42], freshLeg[42]);
      const repeated = result.slice(); constrainSpiderCollisionPose(repeated, localProfile);
      assert.deepEqual(repeated, result);
    }
  }
});

test('root-only support planning exactly matches the full guard while leaving face and body entries untouched', () => {
  for (const Type of [Float32Array, Float64Array]) for (const specimen of SPIDER_SPECIMENS) {
    const localProfile = createSpiderCollisionProfile(specimen.rig);
    for (let sample = 0; sample < 100; sample++) {
      const input = Float64Array.from({ length: 114 }, (_, i) => Math.sin(i * 5.731 + sample * .871) * .9);
      if (!sample) { input[0] = NaN; input[1] = Infinity; input[2] = -Infinity; }
      const expected = constrainSpiderCollisionPose(input, localProfile, new Type(114));
      const root = new Type(18).fill(.321), tail = root.slice(3);
      constrainSpiderCollisionRoot(input, localProfile, root);
      assert.deepEqual(root.slice(0, 3), expected.slice(0, 3), `${specimen.id}/${Type.name}/${sample}`);
      assert.deepEqual(root.slice(3), tail);
    }
  }
});

test('collision profiles serialize, use specimen dimensions and preserve authored attachment overlaps', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(profile)), profile);
  const larger = structuredClone(rig); larger.bodyLength *= 2;
  for (const joint of larger.joints) joint.pivot = joint.pivot.map(x => x * 2);
  for (const leg of larger.legs) { leg.anchors = leg.anchors.map(p => p.map(x => x * 2)); leg.lengths = leg.lengths.map(x => x * 2); if (leg.radii) leg.radii = leg.radii.map(x => x * 2); }
  if (larger.collision) for (const body of larger.collision.bodies) { body.center = body.center.map(x => x * 2); body.radii = body.radii.map(x => x * 2); }
  const scaled = createSpiderCollisionProfile(larger);
  assert.equal(scaled.bodies[1].radius, profile.bodies[1].radius * 2);
  const zero = new Float32Array(114); constrainSpiderCollisionPose(zero, profile);
  assert.ok(zero.every(x => x === 0)); assert.equal(measureSpiderBodyPenetration(zero, profile), 0);
});

test('shared collision volumes exactly match the actual six specimen skeleton transforms', () => {
  for (const specimen of SPIDER_SPECIMENS) {
    const viewer = viewerFixture(specimen.rig); viewer.collisionSolver = null;
    const bodies = createSpiderCollisionBodies(viewer.collisionProfile);
    for (let sample = 0; sample < 20; sample++) {
      viewer.frameData.body = { x: .3, y: specimen.bodyHeight + .04, z: -.27, yaw: sample * .41, pitch: Math.sin(sample) * .3, roll: Math.cos(sample) * .4 };
      viewer.frameData.feet = []; viewer.frameData.pose.set(Array.from({ length: 114 }, (_, index) => Math.sin(sample * 13 + index * 17) * .3));
      viewer.applyFrame(); writeSpiderCollisionBodies(viewer.collisionProfile, viewer.frameData.pose, viewer.frameData.body, bodies);
      viewer.collisionProfile.bodies.forEach((shape, index) => {
        const bone = viewer.bones[shape.index].bone, result = bodies[index];
        const actual = new THREE.Vector3(shape.center.x - shape.pivot.x, shape.center.y - shape.pivot.y, shape.center.z - shape.pivot.z).applyMatrix4(bone.matrixWorld);
        assert.ok(actual.distanceTo(new THREE.Vector3(result.worldCenter.x, result.worldCenter.y, result.worldCenter.z)) < 1e-12, specimen.id);
        const e = bone.matrixWorld.elements;
        [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].forEach((value, i) => assert.ok(Math.abs(value - result.axes[i]) < 1e-12, specimen.id));
      });
    }
  }
});

test('extreme abdomen/palp/fang combinations cannot add new solid penetration and remain finite', () => {
  let reduced = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const pose = Float64Array.from({ length: 114 }, (_, i) => Math.sin((seed * 131 + i * 37) * 17.17) * .75);
    const before = pose.slice(); constrainSpiderCollisionPose(pose, profile);
    assert.ok(measureSpiderBodyPenetration(pose, profile) <= profile.tolerance + 1e-10);
    assert.deepEqual(pose.slice(18), before.slice(18)); // supported-leg model owns leg gestures
    assert.ok(pose.slice(0, 3).every((x, axis) => Math.abs(x) <= profile.rootLimits[axis]));
    assert.ok(pose.every(Number.isFinite)); if (pose.some((v, i) => v !== before[i])) reduced++;
  }
  assert.ok(reduced > 10, 'The guard must actually refuse penetrating rotations.');
});

test('coupled leg clearance preserves lengths and actual supported scan endpoints during representative motion', () => {
  const viewer = viewerFixture(), web = createSpiderWeb({ preset: 'argiope', seed: 1 });
  let maxBody = 0, maxLeg = 0, maxFoot = 0;
  for (const id of ['orb-walk', 'low-sprint', 'macarena', 'pushups']) {
    const motion = normalizeSpiderMotion({ preset: id, tempo: 300, intensity: 1 });
    for (let sample = 0; sample < 24; sample++) {
      writeSpiderFrame(sample / 20, motion, web, viewer.frameData); viewer.applyFrame();
      const stats = viewer.collisionSolver.stats;
      maxBody = Math.max(maxBody, stats.bodyPenetration); maxLeg = Math.max(maxLeg, stats.legPenetration); maxFoot = Math.max(maxFoot, ...viewer.legs.map(leg => leg.error));
      assert.ok(stats.passes <= 16); assert.ok(stats.lengthError < 1e-9);
      assert.ok(viewer.legs.every(leg => leg.points.every(p => [p.x, p.y, p.z].every(Number.isFinite))));
    }
  }
  assert.ok(maxFoot < 1e-8, `Pinned tip error ${maxFoot}`);
});

test('hostile manual leg combinations retain exact feet within the bounded proxy approximation', () => {
  const viewer = viewerFixture(), web = createSpiderWeb({ preset: 'argiope', seed: 1 });
  let body = 0, legs = 0, feet = 0;
  for (let seed = 0; seed < 80; seed++) {
    const offsets = createSpiderStaticPose('random', seed);
    for (const value of Object.values(offsets)) for (const axis of ['x', 'y', 'z']) value[axis] *= 3;
    const motion = normalizeSpiderMotion({ preset: 'orb-walk', tempo: 300, intensity: 1, offsets });
    const pose = writeSpiderPose(seed / 20, motion); constrainSpiderCollisionPose(pose, profile);
    writeSpiderFrame(seed / 20, motion, web, viewer.frameData, pose); viewer.applyFrame();
    body = Math.max(body, viewer.collisionSolver.stats.bodyPenetration); legs = Math.max(legs, viewer.collisionSolver.stats.legPenetration); feet = Math.max(feet, ...viewer.legs.map(leg => leg.error));
  }
  assert.ok(feet < 1e-8);
  // Simultaneously tripling every manual axis can press the original scan's
  // long, bowed foreleg against its coarse rig-derived palp proxy. The bounded
  // visual solve allows <0.001 normalized units (~0.1% of leg span) here;
  // ordinary presets below retain the much tighter specimen-scale clearance.
  // Neither limit permits moving a planted toe or stretching a bone.
  assert.ok(body < .001, `Body penetration ${body}`); assert.ok(legs < .0002, `Leg penetration ${legs}`);
});

test('all six actual specimen chains clear solid proxies across forty sampled fast motion presets', () => {
  const web = createSpiderWeb({ preset: 'argiope', seed: 1 });
  for (const specimen of SPIDER_SPECIMENS) {
    const viewer = viewerFixture(specimen.rig), tolerance = viewer.collisionProfile.tolerance + .00001;
    for (const preset of SPIDER_MOTION_PRESETS) {
      const motion = normalizeSpiderMotion({ specimen: specimen.id, preset: preset.id, tempo: 300, intensity: 1 });
      const world = new SpiderSynthWorld({ playing: true, path: preset.id === 'low-sprint' ? 'figure8' : 'hold', speed: 2, range: .85 });
      for (let sample = 0; sample < 24; sample++) {
        const time = sample / 20, pose = writeSpiderPose(time, motion);
        world.sample(time, motion, web, viewer.frameData, pose, null, { motionTime: time, playing: true }); viewer.applyFrame();
        const result = viewer.collisionSolver.stats, label = `${specimen.id}/${preset.id}/${sample}`;
        assert.ok(result.bodyPenetration <= tolerance, `${label}: body ${result.bodyPenetration}`);
        assert.ok(result.legPenetration <= tolerance, `${label}: legs ${result.legPenetration}`);
        assert.ok(result.lengthError < 1e-8, `${label}: stretched link ${result.lengthError}`);
        for (const leg of viewer.legs) if (viewer.frameData.feet[leg.index].stance) assert.ok(leg.error < 1e-8, `${label}: planted toe ${leg.error}`);
      }
    }
  }
});
