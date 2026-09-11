import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROACH_MOTION_PRESETS, ROACH_MOTION_DEFAULTS, ROACH_SEQUENCE_STEPS, ROACH_MAX_JOINT_TRACKS,
  normalizeRoachMotion, activeRoachPreset, writeRoachPose, createRoachJointTrack,
  roachSequencePosition, createRoachSceneState, writeRoachSceneState,
} from '../src/roach-synth-motion.js';

const jointIds = ['body', 'abdomen', 'neck', 'head', 'antenna_left', 'antenna_right', 'wings'];
for (const pair of ['front', 'middle', 'hind']) for (const side of ['left', 'right']) {
  for (const part of ['proximal', 'middle', 'distal']) jointIds.push(`${pair}_${side}_${part}`);
  if (pair === 'hind') jointIds.push(`${pair}_${side}_foot`);
}
function joints() {
  return jointIds.map((jointId, index) => ({ id: `bone-${index}`, jointId, name: jointId,
    offset: { x: 0, y: 0, z: 0 }, motion: { enabled: false, axis: 'y', amplitude: 12, speed: .5 } }));
}
function pose(time, settings, rig = joints()) {
  return writeRoachPose(time, normalizeRoachMotion(settings), rig, new Float32Array(rig.length * 3));
}
function scene(time, settings, rig = joints()) {
  return writeRoachSceneState(time, normalizeRoachMotion(settings), createRoachSceneState(), rig);
}
const maxDifference = (left, right) => Math.max(...left.map((value, i) => Math.abs(value - right[i])));

test('24 distinct patches preserve the original IDs and never own a camera', () => {
  assert.equal(ROACH_MOTION_PRESETS.length, 24);
  assert.equal(new Set(ROACH_MOTION_PRESETS.map((item) => item.id)).size, 24);
  const originals = ['side_walk', 'side_run', 'side_jump', 'top_wing_fan', 'top_body_wave', 'top_flight', 'bottom_wiggle', 'bottom_shuffle', 'bottom_rave', 'face_curious', 'face_chatter', 'face_sing'];
  for (const id of originals) assert.ok(ROACH_MOTION_PRESETS.some((item) => item.id === id));
  for (const item of ROACH_MOTION_PRESETS) {
    assert.ok(item.soundFlavor && item.category && item.rootPosture);
    assert.equal(item.view, undefined);
    assert.equal(activeRoachPreset(100, normalizeRoachMotion({ presetId: item.id, sequenceEnabled: true, sequence: ['side_walk'] })).id, item.id);
  }
  assert.deepEqual(normalizeRoachMotion(), { ...ROACH_MOTION_DEFAULTS, tracks: [] });
});

test('every factory patch repeats continuously after eight beats with distinct bounded poses', () => {
  const rig = joints(); const signatures = new Set();
  for (const preset of ROACH_MOTION_PRESETS) {
    const settings = normalizeRoachMotion({ presetId: preset.id, intensity: 2, tempo: 120 });
    const signature = [];
    for (const time of [0, .173, .75, 2.19, 120]) {
      const out = pose(time, settings, rig);
      assert.ok(out.every((value) => Number.isFinite(value) && Math.abs(value) <= 180));
      assert.deepEqual(out, pose(time, settings, rig));
      assert.ok(maxDifference(out, pose(time + 4, settings, rig)) < .0001, `${preset.id} loops`);
      signature.push(...out);
    }
    assert.ok(maxDifference(pose(4 - 1e-7, settings, rig), pose(4, settings, rig)) < .01, `${preset.id} wrap`);
    signatures.add(JSON.stringify(signature));
  }
  assert.equal(signatures.size, 24);
});

test('every routine moves both antennae and the antenna switch removes their procedural motion', () => {
  for (const preset of ROACH_MOTION_PRESETS) {
    const first = pose(.2, { presetId: preset.id }); const second = pose(.49, { presetId: preset.id });
    assert.notDeepEqual(first.slice(12, 15), second.slice(12, 15), `${preset.id}: left`);
    assert.notDeepEqual(first.slice(15, 18), second.slice(15, 18), `${preset.id}: right`);
    assert.deepEqual(pose(.49, { presetId: preset.id, antennae: false }).slice(12, 18), new Float32Array(6));
  }
});

test('manual XYZ, joint oscillator, factory motion and scored XYZ remain independent and additive', () => {
  const rig = joints(); rig[3].offset = { x: 15, y: -12, z: 8 };
  rig[3].motion = { enabled: true, axis: 'x', amplitude: 20, speed: 1 };
  const tracks = [createRoachJointTrack('bone-3', 'y', Array(16).fill(14)), createRoachJointTrack('head', 'z', Array(16).fill(-4))];
  const settings = { presetId: 'none', antennae: false, sequenceEnabled: true, tracks };
  assert.deepEqual(Array.from(pose(.25, settings, rig).slice(9, 12)), [35, 2, 4]);
  assert.deepEqual(Array.from(pose(.25, { ...settings, sequenceEnabled: false }, rig).slice(9, 12)), [35, -12, 8]);
  const base = pose(.25, { presetId: 'side_run' }, rig);
  const scored = pose(.25, { ...settings, presetId: 'side_run', antennae: true }, rig);
  assert.ok(Math.abs(scored[10] - base[10] - 14) < .00001);
  assert.ok(Math.abs(scored[11] - base[11] + 4) < .00001);
});

test('the joint score reads all 16 exact steps, smoothly wraps, and only edits its selected joint/axis', () => {
  const values = Array.from({ length: 16 }, (_, i) => i * 4 - 28);
  const settings = { presetId: 'none', antennae: false, tempo: 120, sequenceEnabled: true, tracks: [createRoachJointTrack('head', 'x', values)] };
  for (let i = 0; i < 32; i += 1) {
    const time = i * .125;
    const out = pose(time, settings);
    assert.equal(out[9], values[i % 16]);
    assert.equal(out.filter((value, index) => index !== 9 && value !== 0).length, 0);
    assert.deepEqual(roachSequencePosition(time, settings), { step: i % 16, fraction: 0, length: 16 });
  }
  assert.equal(pose(.0625, settings)[9], -26);
  assert.ok(maxDifference(pose(2 - 1e-6, settings), pose(2, settings)) < .001);
  const disabled = structuredClone(settings); disabled.tracks[0].enabled = false;
  assert.ok(pose(.5, disabled).every((value) => value === 0));
});

test('track normalization clones caller values, bounds work and values, and rejects duplicate joint/axis tracks', () => {
  const tracks = Array.from({ length: 120 }, (_, i) => ({ jointId: `part-${i}`, axis: 'bad', steps: [999, -999, NaN] }));
  const original = structuredClone(tracks);
  const controls = normalizeRoachMotion({ tracks });
  assert.equal(controls.tracks.length, ROACH_MAX_JOINT_TRACKS);
  assert.ok(controls.tracks.every((track) => track.steps.length === ROACH_SEQUENCE_STEPS && track.axis === 'x'));
  assert.deepEqual(controls.tracks[0].steps.slice(0, 4), [90, -90, 0, 0]);
  assert.deepEqual(tracks, original);
  controls.tracks[0].steps[0] = 2;
  assert.equal(tracks[0].steps[0], 999);
  assert.equal(normalizeRoachMotion({ tracks: [tracks[0], tracks[0]] }).tracks.length, 1);
});

test('tripod contacts match displayed swing/stance and count independently of render sample cadence', () => {
  const settings = { presetId: 'side_run', tempo: 120 };
  let previous = scene(0, settings);
  let contacts = 0;
  for (let i = 1; i <= 12000; i += 1) {
    const next = scene(i / 3000, settings);
    for (let foot = 0; foot < 6; foot += 1) {
      const current = next.feet[foot];
      assert.equal(current.stance, current.phase < .54);
      if (current.stance) assert.equal(current.lift, 0);
      assert.ok(current.contactCount >= previous.feet[foot].contactCount);
      if (current.contactCount !== previous.feet[foot].contactCount) {
        contacts += current.contactCount - previous.feet[foot].contactCount;
        assert.equal(current.stance, true);
        assert.ok(current.impact > 0);
      }
    }
    previous = next;
  }
  const start = scene(0, settings); const end = scene(4, settings);
  assert.equal(contacts, end.feet.reduce((sum, foot, i) => sum + foot.contactCount - start.feet[i].contactCount, 0));
  assert.equal(contacts, 144);
  assert.ok(end.groundOffset > start.groundOffset);
  assert.ok(scene(4, { presetId: 'side_backpedal' }).groundOffset < 0);
});

test('jump and takeoff have airborne roots, silent feet, and synchronized landing contacts', () => {
  for (const presetId of ['side_jump', 'top_flight']) {
    const before = scene(.25, { presetId, tempo: 120 });
    const air = scene(1, { presetId, tempo: 120 });
    const landed = scene(1.8, { presetId, tempo: 120 });
    assert.equal(before.body.lift, 0);
    assert.ok(air.body.lift > .2);
    assert.ok(air.feet.every((foot) => !foot.stance && foot.lift > 0 && foot.impact === 0));
    assert.equal(landed.body.lift, 0);
    assert.ok(landed.feet.every((foot) => foot.stance && foot.contactCount === 1 && foot.impact > 0));
  }
});

test('upright dances reserve support for rear feet and remain separate from the camera', () => {
  for (const presetId of ['dance_upright', 'dance_boxer', 'dance_can_can', 'dance_waltz']) {
    const out = scene(.31, { presetId });
    assert.ok(out.body.pitch >= 50);
    assert.equal(out.body.lift, 0, 'renderer grounds the pitched rear feet without extra hover');
    assert.ok(out.feet.slice(0, 4).every((foot) => !foot.stance && foot.impact === 0));
    assert.ok(out.feet.slice(4).every((foot) => foot.impact > 0));
  }
});

test('pose-only keyed leg lifts land on descending score crossings while held angles stay silent', () => {
  const rig = joints();
  const steps = [0, 30, 30, 0, 0, 30, 30, 0, 0, 30, 30, 0, 0, 30, 30, 0];
  const settings = { presetId: 'none', tempo: 120, antennae: false, sequenceEnabled: true,
    tracks: [createRoachJointTrack('front_left_proximal', 'x', steps)] };
  const up = scene(.1875, settings, rig); const down = scene(.375, settings, rig);
  assert.equal(up.feet[0].stance, false);
  assert.ok(up.feet[0].lift > 0);
  assert.equal(down.feet[0].stance, true);
  assert.equal(down.feet[0].contactCount, 1);
  assert.equal(scene(2, settings, rig).feet[0].contactCount, 4);
  assert.equal(scene(2.375, settings, rig).feet[0].contactCount, 5);
  assert.ok(down.feet.slice(1).every((foot) => foot.contactCount === 0 && foot.impact === 0));
  settings.tracks[0].steps.fill(30);
  assert.equal(scene(2, settings, rig).feet[0].impact, 0);
  settings.tracks = []; rig[7].offset.x = 30;
  assert.ok(scene(2, settings, rig).feet.every((foot) => foot.impact === 0));
});

test('zero procedural intensity removes factory motion and impact energy but preserves manual and keyed control', () => {
  const rig = joints(); rig[3].offset.x = 12;
  for (const preset of ROACH_MOTION_PRESETS) {
    const settings = { presetId: preset.id, intensity: 0 };
    const out = scene(1, settings, rig);
    assert.ok(out.feet.every((foot) => foot.impact === 0 && foot.lift === 0));
    assert.ok(Object.values(out.body).every((value) => value === 0));
    assert.equal(pose(1, settings, rig)[9], 12);
  }
});

test('hostile inputs remain finite and bounded without mutating caller state', () => {
  const settings = normalizeRoachMotion({ presetId: 'bad', tempo: Infinity, intensity: 99, stepBeats: -3 });
  assert.equal(settings.tempo, 108); assert.equal(settings.intensity, 2); assert.equal(settings.stepBeats, 1 / 16);
  const rig = joints(); rig[0].offset.x = Infinity;
  const original = structuredClone(rig);
  for (const time of [NaN, Infinity, -10, 1e308]) {
    assert.ok(pose(time, settings, rig).every(Number.isFinite));
    const out = scene(time, settings, rig);
    assert.ok(Object.values(out.body).every(Number.isFinite));
    assert.ok(out.feet.every((foot) => Number.isFinite(foot.contactCount) && foot.lift >= 0 && foot.lift <= 1));
  }
  assert.deepEqual(rig, original);
  assert.throws(() => writeRoachPose(0, settings, rig, new Float32Array(2)), /three values/);
});


test('camera gaze is bounded and shared as additive head-only motion', () => {
  const rig = joints();
  const controls = normalizeRoachMotion({ presetId: 'side_run', gaze: { x: 999, y: -999, z: 7 } });
  assert.deepEqual(controls.gaze, { x: 22, y: -22, z: 7 });
  const base = pose(.4, { presetId: 'side_run' }, rig);
  const aimed = pose(.4, controls, rig);
  for (let i = 0; i < aimed.length; i += 1) {
    const delta = i === 9 ? 22 : i === 10 ? -22 : i === 11 ? 7 : 0;
    assert.ok(Math.abs(aimed[i] - base[i] - delta) < .00001);
  }
});


test('one-time calibrated leg rest offsets remain in every shared pose independently of manual edits', () => {
  const rig = joints();
  rig[7].restOffset = { x: 70, y: -22, z: 8 };
  rig[7].offset = { x: 12, y: -4, z: 0 };
  assert.deepEqual(Array.from(pose(0, { presetId: 'none', antennae: false }, rig).slice(21, 24)), [82, -26, 8]);
  for (const preset of ROACH_MOTION_PRESETS) {
    assert.deepEqual(Array.from(pose(1, { presetId: preset.id, intensity: 0 }, rig).slice(21, 24)), [82, -26, 8]);
  }
});


test('grounded leg poses interpolate calibrated planted and lifted corners on the shared foot phase', () => {
  const rig = joints();
  rig[7].restOffset = { x: 10, y: 20, z: 30 };
  rig[7].gaitPose = { back: [0, 20, 30], front: [20, 20, 30], raisedBack: [0, 40, 30], raisedFront: [20, 40, 30] };
  rig[7].offset.z = 5;
  const settings = { presetId: 'side_walk', tempo: 120 };
  for (const time of [0, .1, .2, .27, .34, .39]) {
    const foot = scene(time, settings, rig).feet[0];
    const out = pose(time, settings, rig);
    assert.ok(Math.abs(out[21] - (foot.stride + 1) * 10) < .00001);
    assert.ok(Math.abs(out[22] - (20 + foot.lift * 20)) < .00001);
    assert.equal(out[23], 35);
  }
  assert.deepEqual(Array.from(pose(.2, { ...settings, intensity: 0 }, rig).slice(21, 24)), [10, 20, 35]);
  const track = createRoachJointTrack('bone-7', 'z', Array(16).fill(8));
  assert.equal(pose(.2, { ...settings, sequenceEnabled: true, tracks: [track] }, rig)[23], 43);
});
