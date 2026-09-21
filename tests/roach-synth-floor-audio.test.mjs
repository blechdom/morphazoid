import assert from 'node:assert/strict';
import test from 'node:test';
import { RoachSynthDsp, createDefaultRoachBodyMix } from '../src/instruments/roach-synth/roach-synth-dsp.js';
import { RoachMidiPerformance } from '../src/instruments/roach-synth/roach-synth-midi.js';
import { constrainRoachFloorPose, createRoachSceneState, writeRoachPose, writeRoachSceneState } from '../src/instruments/roach-synth/roach-synth-motion.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const zero = () => ({ x: 0, y: 0, z: 0 });
function joint(id, parent, position, extra = {}) {
  return { id, jointId: id, name: id, parent, offset: zero(), restOffset: zero(),
    kinematics: { position, quaternion: [0, 0, 0, 1], scale: [1, 1, 1], parentMatrix: parent ? null : identity, footTip: null },
    poseLimits: { x: [-80, 80], y: [-80, 80], z: [-80, 80] }, ...extra };
}
function rig() {
  const joints = [
    joint('body', null, [0, .12, 0], {
      bodyEllipsoid: { jointId: 'body', center: [0, 0, -.05], radii: [.02, .02, .02] },
      groundFrame: { dorsal: [0, 1, 0], forward: [0, 0, 1], left: [1, 0, 0], bodyLength: .3 },
    }),
    joint('neck', 'body', [0, -.04, .06], { floorBounds: [[-.01, -.01, 0], [.01, .01, .03]] }),
    joint('head', 'neck', [0, -.03, .03], { floorBounds: [[-.02, -.015, 0], [.02, .015, .18]] }),
    joint('antenna_left', 'head', [-.02, .02, .12], { floorBounds: [[-.001, -.001, 0], [.001, .001, .4]] }),
    joint('antenna_right', 'head', [.02, .02, .12], { floorBounds: [[-.001, -.001, 0], [.001, .001, .4]] }),
  ];
  for (const side of ['left', 'right']) for (const row of ['front', 'middle', 'hind']) {
    const id = `${row}_${side}_${row === 'hind' ? 'foot' : 'distal'}`;
    const foot = joint(id, 'body', [side === 'left' ? -.1 : .1, 0, row === 'front' ? .1 : row === 'hind' ? -.1 : 0]);
    foot.kinematics.footTip = [0, -.12, 0]; joints.push(foot);
  }
  return joints;
}
function synth(joints, extra = {}) {
  const dsp = new RoachSynthDsp(24000);
  dsp.update({ enabled: true, playing: false, soundPlaying: false, joints, mappings: [],
    motion: { presetId: 'none', antennae: false, intensity: 1, tempo: 120 },
    bodyMix: createDefaultRoachBodyMix().map(row => ({ ...row, source: 'walls', level: row.groupId === 'head' ? .8 : 0 })),
    ...extra });
  return dsp;
}
function render(dsp, seconds = .1) {
  const output = new Float32Array(Math.round(dsp.sampleRate * seconds));
  for (let start = 0; start < output.length; start += 128) {
    const left = output.subarray(start, start + 128), right = new Float32Array(left.length);
    dsp.render(left, right);
    for (const sample of right) assert.ok(Number.isFinite(sample));
  }
  for (const sample of output) assert.ok(Number.isFinite(sample));
  return output;
}

test('audio copies floor calibration and samples once, bounds metadata, and retains caches through manual edits', () => {
  const input = rig(), dsp = synth(input), original = dsp.joints[0], samples = dsp.joints[2].floorBounds;
  assert.deepEqual(original.groundFrame, input[0].groundFrame);
  assert.notEqual(original.groundFrame, input[0].groundFrame);
  assert.deepEqual(samples, input[2].floorBounds);
  input[0].groundFrame.dorsal[1] = .5; input[2].floorBounds[0][1] = -10;
  assert.equal(original.groundFrame.dorsal[1], 1); assert.equal(samples[0][1], -.015);
  const edit = rig(); edit[2].offset.x = 5; dsp.update({ joints: edit });
  assert.equal(dsp.joints[0], original); assert.equal(dsp.joints[2].floorBounds, samples);
  const huge = rig(); huge[2].floorBounds = Array.from({ length: 600 }, () => [0, 0, .1]);
  dsp.update({ joints: huge }); assert.equal(dsp.joints[2].floorBounds.length, 512);
  huge[0].groundFrame.bodyLength = Infinity; dsp.update({ joints: huge }); assert.equal(dsp.joints[0].groundFrame, null);
});

test('final audio pose matches scene-aware visual composition for held, animated and MIDI poses', () => {
  for (const playing of [false, true]) for (const withMidi of [false, true]) {
    const input = rig(); input[2].offset.x = 60; input[3].offset.x = 45;
    const dsp = synth(input, { playing, motion: { presetId: playing ? 'side_walk' : 'none', antennae: false, intensity: 1.6,
      staticScene: playing ? undefined : { body: { lift: 0, pitch: 18, roll: 12, yaw: 0 } } } });
    const mirror = new RoachMidiPerformance(); mirror.setJoints(dsp.joints);
    if (withMidi) {
      const message = { type: 'noteOn', note: 69, velocity: 110, channel: 0, sourceId: 'test' };
      dsp.midi(message, 0); mirror.handle(message, 0);
      dsp.midiControl('antennae', 'x', .8, 0); mirror.setControl('antennae', 'x', .8, 0);
    }
    dsp.time = .31; dsp.audioTime = .4;
    const pose = new Float32Array(input.length * 3), scene = createRoachSceneState();
    writeRoachPose(dsp.time, dsp.motion, dsp.joints, pose);
    mirror.applyPose(pose, dsp.joints, dsp.audioTime, dsp.motion.tempo, dsp.motion.intensity);
    const unsafe = pose.slice();
    writeRoachSceneState(dsp.time, dsp.motion, scene, dsp.joints);
    constrainRoachFloorPose(pose, dsp.joints, scene);
    assert.ok(pose.some((value, i) => Math.abs(value - unsafe[i]) > .01), 'fixture must actually hit the floor');
    dsp.control();
    assert.deepEqual(dsp.pose.subarray(0, pose.length), pose, `playing=${playing}, midi=${withMidi}`);
    assert.ok(dsp.pose.subarray(pose.length).every(value => value === 0), 'the projector leaves unused DSP buffer capacity untouched');
    assert.deepEqual(dsp.previousPose.subarray(0, pose.length), pose, 'movement starts from the accepted pose');
    assert.equal(dsp.playing, playing); assert.equal(dsp.soundPlaying, false); assert.equal(dsp.time, .31);
    render(dsp, .08);
    assert.equal(dsp.playing, playing); assert.equal(dsp.soundPlaying, false);
  }
});

test('manual interaction compares accepted floor poses and still excites a real permitted movement', () => {
  const input = rig(); input[2].offset.x = 60;
  const dsp = synth(input); render(dsp, .15);
  dsp.interact({ jointId: 'head', active: true, velocity: 0 });
  const calls = [], original = dsp.exciteInteraction;
  dsp.exciteInteraction = function(index, strength) { calls.push({ index, strength }); return original.call(this, index, strength); };
  const edit = structuredClone(input); edit[2].offset.x = 75;
  dsp.update({ joints: edit });
  assert.ok(dsp.scene.floorLift <= 1e-7, 'an ordinary downward head drag is corrected locally without raising the supports');
  const k = 2 * 3;
  const acceptedDelta = Math.abs(dsp.pose[k] - dsp.editedPose[k]) + Math.abs(dsp.pose[k + 1] - dsp.editedPose[k + 1]) + Math.abs(dsp.pose[k + 2] - dsp.editedPose[k + 2]);
  assert.ok(acceptedDelta < 3, 'the floor must reject most of this fifteen-degree downward drag');
  if (acceptedDelta <= .001) assert.equal(calls.length, 0, 'blocked geometry cannot fabricate friction');
  else assert.ok(calls.every(call => call.strength <= Math.max(.025, acceptedDelta / 18) + 1e-7), 'only accepted motion can excite the source');
  const movement = structuredClone(edit); movement[2].offset.x = -15; calls.length = 0;
  dsp.update({ joints: movement });
  assert.ok(calls.some(call => call.index === 2 && call.strength > .025));
  assert.ok(render(dsp, .12).some(sample => Math.abs(sample) > .0001));
  assert.equal(dsp.playing, false); assert.equal(dsp.soundPlaying, false); assert.equal(dsp.time, 0);
});

test('derived support lift suppresses gait impacts while contact counters keep advancing for recovery', () => {
  const supported = rig();
  for (const joint of supported.slice(1, 5)) joint.poseLimits = { x: [0, 0], y: [0, 0], z: [0, 0] };
  const impossible = structuredClone(supported); impossible[2].floorBounds = [[0, -2, 0]];
  const settings = { playing: true, motion: { presetId: 'side_walk', antennae: false, tempo: 120, intensity: .5 } };
  const normal = synth(supported, settings), lifted = synth(impossible, settings);
  render(normal, .81); render(lifted, .81);
  assert.equal(normal.scene.floorLift, 0); assert.ok(lifted.scene.floorLift > 1e-6);
  assert.ok(normal.contactEvents > 0); assert.equal(lifted.contactEvents, 0, 'feet raised away from the floor cannot strike it');
  assert.deepEqual(lifted.contactCounts, normal.contactCounts, 'suppressed impacts are consumed rather than queued');
  const contacts = normal.contactEvents;
  lifted.update({ joints: supported });
  render(normal, .01); render(lifted, .01);
  assert.equal(lifted.scene.floorLift, 0); assert.equal(lifted.contactEvents, 0, 'recovery cannot replay missed strikes');
  render(normal, .24); render(lifted, .24);
  assert.ok(lifted.contactEvents > 0, 'the next newly scheduled supported footfall still sounds');
  assert.equal(lifted.contactEvents, normal.contactEvents - contacts);
  assert.deepEqual(lifted.contactCounts, normal.contactCounts);
  assert.equal(lifted.playing, true); assert.equal(lifted.soundPlaying, false);
});
