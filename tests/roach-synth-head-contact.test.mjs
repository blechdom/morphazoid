import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainRoachPose, writeRoachPose, applyRoachSpeechPose, normalizeRoachMotion } from '../src/instruments/roach-synth/roach-synth-motion.js';
import { RoachMidiPerformance } from '../src/instruments/roach-synth/roach-synth-midi.js';

function rig(sign = -1) {
  return [
    { id: 'body', jointId: 'body', offset: { x: 4, y: 5, z: 6 } },
    { id: 'plate', jointId: 'neck', parent: 'body', offset: { x: 0, y: 0, z: 0 }, poseLimits: { x: [-42, 12], y: [-3, 3], z: [-4, 4] } },
    { id: 'face', jointId: 'head', parent: 'plate', offset: { x: 0, y: 0, z: 0 }, poseLimits: { x: [-50, 18], y: [-6, 6], z: [-8, 8] },
      headContact: { parentId: 'plate', liftSign: sign, parentLiftSign: sign, liftLimit: .15 } },
    { id: 'antenna', jointId: 'antenna_left', parent: 'face', offset: { x: 0, y: 0, z: 0 } },
  ];
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const controls = normalizeRoachMotion({ presetId: 'none', antennae: false });

test('contact transfers only upward head pressure into the parent plate and releases on reversal', () => {
  for (const sign of [-1, 1]) {
    const joints = rig(sign), saved = structuredClone(joints);
    const request = new Float64Array([4, 5, 6, sign * 2, 1, -2, sign * 8, 6, -8, 7, 8, 9, 777]);
    const out = new Float64Array(request.length).fill(333);
    constrainRoachPose(request, joints, out);
    near(out[6], sign * .15); near(out[3], sign * 9.85);
    assert.deepEqual(Array.from(out.slice(7, 9)), [0, 0]);
    assert.deepEqual(Array.from(out.slice(0, 3)), [4, 5, 6]);
    assert.deepEqual(Array.from(out.slice(9, 12)), [7, 8, 9]);
    assert.equal(out[12], 333); assert.deepEqual(joints, saved);
    const reverse = request.slice(); reverse[6] -= sign * 3;
    constrainRoachPose(reverse, joints);
    near(reverse[3], sign * 6.85); near(reverse[6], sign * .15);
    request[6] = -sign * 5;
    constrainRoachPose(request, joints);
    near(request[6], -sign * 5); near(request[3], sign * 2);
  }
});

test('plate pressure remains bounded and repeated projection cannot accumulate carry', () => {
  for (const Buffer of [Float32Array, Float64Array]) {
    const joints = rig(), pose = new Buffer([0, 0, 0, -30, 1, 2, -50, 0, 0, 0, 0, 0]);
    constrainRoachPose(pose, joints);
    near(pose[3], -42); near(pose[6], -.15);
    const accepted = pose.slice();
    for (let i = 0; i < 1000; i++) constrainRoachPose(pose, joints);
    assert.deepEqual(pose, accepted);
    // Float32 rounding at first contact must not manufacture plate pressure.
    pose[3] = 0; pose[6] = -.15;
    const touching = pose.slice();
    for (let i = 0; i < 1000; i++) constrainRoachPose(pose, joints);
    assert.deepEqual(pose, touching);
  }
});

test('contact angles are relative to authored rest offsets', () => {
  const joints = rig(); joints[1].restOffset = { x: 7, y: 0, z: 0 };
  joints[2].restOffset = { x: 3, y: -2, z: 1 };
  const pose = new Float64Array([0, 0, 0, 7, 2, 3, -7, 5, -4, 0, 0, 0]);
  constrainRoachPose(pose, joints);
  near(pose[6], 2.85); near(pose[3], -2.85);
  assert.deepEqual(Array.from(pose.slice(7, 9)), [-2, 1]);
});

test('invalid contact metadata cannot claim another body part or physical parent', () => {
  for (const mutation of [
    j => { j[2].parent = 'body'; }, j => { j[1].jointId = 'abdomen'; },
    j => { j[2].headContact.liftLimit = NaN; }, j => { j[2].headContact.liftLimit = 0; },
    j => { j[2].headContact.parentLiftSign = 0; }, j => { j[2].headContact.liftSign = 2; },
    j => { j[2].headContact.parentId = 'missing'; },
  ]) {
    const joints = rig(); mutation(joints);
    const pose = new Float64Array([0, 0, 0, 0, 0, 0, -20, 3, 4, 0, 0, 0]);
    const original = pose.slice(); constrainRoachPose(pose, joints);
    assert.deepEqual(pose, original);
  }
});

test('raw manual and MIDI pressure compose before contact, so opposing MIDI releases the plate', () => {
  const joints = rig(); joints[2].offset.x = -20;
  const midi = new RoachMidiPerformance();
  midi.setControl('head', 'x', .5, 0, { sourceId: 'test', channel: 0 });
  const pose = writeRoachPose(1, controls, joints, new Float64Array(12), false);
  near(pose[3], 0); near(pose[6], -20);
  midi.applyPose(pose, joints, 1, 120, 1, false);
  near(pose[3], 0); near(pose[6], -6);
  constrainRoachPose(pose, joints);
  near(pose[3], -5.85); near(pose[6], -.15);
  const released = writeRoachPose(2, controls, joints, new Float64Array(12));
  near(released[3], -19.85); near(released[6], -.15);
  near(joints[2].offset.x, -20); near(joints[1].offset.x, 0);
});

test('speech contact is temporary and returns to the exact held head and plate pose', () => {
  const joints = rig(); joints[2].offset.x = -8; joints[1].offset.x = -3;
  const saved = structuredClone(joints), held = writeRoachPose(0, controls, joints, new Float64Array(12));
  let moved = false;
  for (let frame = 0; frame < 120; frame++) {
    const pose = writeRoachPose(0, controls, joints, new Float64Array(12), false);
    applyRoachSpeechPose(frame / 20, 1, joints, pose, false);
    constrainRoachPose(pose, joints);
    assert.ok(pose[6] >= -.150001 && pose[6] <= 18);
    assert.equal(pose[7], 0); assert.equal(pose[8], 0);
    assert.deepEqual(pose.slice(0, 3), held.slice(0, 3));
    moved ||= Math.abs(pose[3] - held[3]) > 1;
  }
  assert.ok(moved);
  const finished = writeRoachPose(0, controls, joints, new Float64Array(12), false);
  applyRoachSpeechPose(8, 0, joints, finished, false);
  constrainRoachPose(finished, joints);
  assert.deepEqual(finished, held); assert.deepEqual(joints, saved);
});
