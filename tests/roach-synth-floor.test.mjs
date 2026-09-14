import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.min.js';
import { constrainRoachFloorPose, constrainRoachPose, createRoachSceneState } from '../src/roach-synth-motion.js';

function fixture() {
  const joint = (id, parent, position, extra = {}) => ({ id, jointId: id, parent, restOffset: { x: 0, y: 0, z: 0 }, kinematics: { position, quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }, ...extra });
  return [
    joint('body', null, [0, .3, 0], { bodyEllipsoid: { center: [0, -1, 0], radii: [.05, .05, .05] }, groundFrame: { dorsal: [0, 1, 0], forward: [0, 0, 1], left: [1, 0, 0], bodyLength: 1 } }),
    joint('neck', 'body', [0, 0, .1], { floorBounds: [[0, -.1, 0], [0, .1, .1]] }),
    joint('head', 'neck', [0, -.05, .3], { floorBounds: [[0, 0, 0], [0, -.15, 0], [0, 0, .5]], collisionSamples: [[0, 0, .5]] }),
    joint('antenna_left', 'head', [-.1, .05, .1], { floorBounds: [[0, 0, 0], [0, 0, .55]], restOffset: { x: -20, y: 0, z: 0 } }),
    joint('antenna_right', 'head', [.1, .05, .1], { floorBounds: [[0, 0, 0], [0, 0, .55]], restOffset: { x: -20, y: 0, z: 0 } }),
    ...['front_left', 'front_right', 'middle_left', 'middle_right', 'hind_left', 'hind_right'].map((id, i) => joint(`${id}_distal`, 'body', [i % 2 ? .3 : -.3, -.3, .25 - Math.floor(i / 2) * .25], { kinematics: { position: [i % 2 ? .3 : -.3, -.3, .25 - Math.floor(i / 2) * .25], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], footTip: [0, 0, .025] } })),
  ];
}
function resting(joints, padding = 0) {
  const pose = new Float32Array(joints.length * 3 + padding);
  for (let i = 0; i < joints.length; i++) for (let a = 0; a < 3; a++) pose[i * 3 + a] = joints[i].restOffset[['x', 'y', 'z'][a]];
  return pose;
}
// Independent Three.js FK and performer quaternion composition. These tests
// do not reuse the projector's matrix, normal or floor-height routines.
function gaps(pose, joints, scene) {
  const matrices = new Map(), frame = joints.find(j => j.groundFrame).groundFrame, up = new THREE.Vector3().fromArray(frame.dorsal);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().fromArray(frame.left), -(scene.body.pitch || 0) * Math.PI / 180)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().fromArray(frame.forward), (scene.body.roll || 0) * Math.PI / 180))
    .multiply(new THREE.Quaternion().setFromAxisAngle(up, (scene.body.yaw || 0) * Math.PI / 180));
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i], k = j.kinematics;
    const q = new THREE.Quaternion().fromArray(k.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...Array.from(pose.slice(i * 3, i * 3 + 3), v => v * Math.PI / 180), 'XYZ')));
    const parent = matrices.get(j.parent) || new THREE.Matrix4().fromArray(k.parentMatrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    matrices.set(j.id, parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3().fromArray(k.position), q, new THREE.Vector3().fromArray(k.scale))));
  }
  const height = (joint, point) => new THREE.Vector3().fromArray(point).applyMatrix4(matrices.get(joint.id)).applyQuaternion(turn).dot(up);
  const lowest = Math.min(...joints.filter(j => j.kinematics.footTip).map(j => height(j, j.kinematics.footTip)));
  return joints.filter(j => j.floorBounds).map(j => ({ id: j.id, minimum: Math.min(...j.floorBounds.map(point => height(j, point))) - lowest + .006 + scene.body.lift * frame.bodyLength + (scene.floorLift || 0) }));
}
const clear = (pose, joints, scene) => { for (const part of gaps(pose, joints, scene)) assert.ok(part.minimum >= -1e-7, `${part.id}: ${part.minimum}`); };

test('safe face poses return unchanged and padded DSP buffers preserve every non-face value and tail', () => {
  const joints = fixture(), pose = resting(joints, 84), scene = createRoachSceneState();
  pose[1] = 7; pose[17] = 13; pose.fill(321, joints.length * 3);
  const original = pose.slice(), body = { ...scene.body };
  constrainRoachFloorPose(pose, joints, scene);
  assert.deepEqual(pose, original); assert.equal(scene.floorLift, 0); assert.deepEqual(scene.body, body);
  clear(pose, joints, scene);
  pose[6] = 95;
  const out = new Float32Array(pose.length + 9).fill(777);
  constrainRoachFloorPose(pose, joints, scene, out);
  assert.equal(out[1], pose[1]); assert.equal(out[17], pose[17]); assert.ok(out[6] < 95);
  assert.ok(out.subarray(joints.length * 3).every(v => v === 777));
  clear(out, joints, scene);
});

test('head edits respect descendant feelers and retreat from the boundary without changing unrelated joints', () => {
  const joints = fixture(), scene = createRoachSceneState(), pose = resting(joints);
  pose[6] = 90;
  constrainRoachFloorPose(pose, joints, scene);
  assert.ok(pose[6] > 0 && pose[6] < 90); assert.equal(scene.floorLift, 0);
  clear(pose, joints, scene);
  const boundary = pose[6]; pose[6] -= 5;
  const back = pose.slice(); constrainRoachFloorPose(pose, joints, scene);
  assert.deepEqual(pose, back); assert.ok(pose[6] < boundary);
  const antenna = resting(joints); antenna[9] = 90;
  const right = antenna.slice(12, 15); constrainRoachFloorPose(antenna, joints, scene);
  assert.deepEqual(antenna.slice(12, 15), right); assert.equal(antenna[6], 0); assert.equal(scene.floorLift, 0);
  clear(antenna, joints, scene);
});

test('floor projection matches rotated performer geometry and remains independent of cache history', () => {
  const joints = fixture();
  for (let i = 0; i < 80; i++) {
    const scene = createRoachSceneState(); Object.assign(scene.body, { pitch: 18 * Math.sin(i), roll: 13 * Math.cos(i * .7), yaw: i * 7, lift: .05 });
    const pose = resting(joints); for (let j = 3; j < 15; j++) pose[j] += 55 * Math.sin(i * .4 + j);
    constrainRoachPose(pose, joints);
    const fresh = pose.slice(), otherScene = structuredClone(scene);
    constrainRoachFloorPose(pose, joints, scene); constrainRoachFloorPose(fresh, structuredClone(joints), otherScene);
    assert.deepEqual(pose, fresh); assert.equal(scene.floorLift, otherScene.floorLift); clear(pose, joints, scene);
    assert.deepEqual(constrainRoachPose(pose, joints, new Float32Array(pose.length)), pose, 'Floor correction also respects body-core bounds');
  }
});

test('an impossible fixed head pivot gets only the necessary derived support lift and resets on recovery', () => {
  const joints = fixture(); joints[2].parent = 'body'; joints[2].kinematics.position = [0, 0, 1];
  const pose = resting(joints), scene = createRoachSceneState(); scene.body.pitch = -90;
  const originalBody = { ...scene.body }, originalLegs = pose.slice(15);
  constrainRoachFloorPose(pose, joints, scene);
  assert.ok(scene.floorLift > .1); assert.deepEqual(scene.body, originalBody); assert.deepEqual(pose.slice(15), originalLegs);
  clear(pose, joints, scene); assert.ok(Math.abs(Math.min(...gaps(pose, joints, scene).map(g => g.minimum))) < 1e-7);
  scene.body.pitch = 0; const neutral = resting(joints); constrainRoachFloorPose(neutral, joints, scene);
  assert.equal(scene.floorLift, 0); clear(neutral, joints, scene);
});

test('missing optional floor geometry is a no-op and resets stale derived lift', () => {
  const joints = fixture(); delete joints[0].groundFrame;
  const pose = resting(joints), scene = createRoachSceneState(); scene.floorLift = .7;
  const before = pose.slice(); constrainRoachFloorPose(pose, joints, scene);
  assert.deepEqual(pose, before); assert.equal(scene.floorLift, 0);
});
