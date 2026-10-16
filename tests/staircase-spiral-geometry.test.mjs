import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStaircaseField, buildStaircaseSpiralFeatures, measureStaircaseContourFeature,
  readStaircaseRhythm, STAIRCASE_FEATURE_FRAME_STRIDE as FRAME,
  STAIRCASE_FEATURE_STRIDE as STRIDE, STAIRCASE_BRANCH_OFFSET,
} from '../src/instruments/striped-staircase-rust/field.js';

const TAU = Math.PI * 2;
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const record = (id, slot, angle, x = .5, y = .5, extra = {}) => ({
  id, slot, parentId: 0, forkSafe: false, outline: [],
  measurement: { angle, x, y, curvature: .4, confidence: 1 }, ...extra,
});
const read = (features, frame, slot = 0) => Array.from(features.subarray(frame * FRAME + slot * STRIDE, frame * FRAME + slot * STRIDE + STRIDE));
function pathFrom(points, closed = false, aspect = 1) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot((points[i].x - points[i - 1].x) * aspect, points[i].y - points[i - 1].y);
  return { points, closed, length };
}
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
function forkFrames() {
  const old = box(.1, .1, .9, .9), left = box(.2, .3, .45, .7), right = box(.55, .3, .8, .7);
  const make = (id, slot, angle, x, y, outline, parentId = 0) => record(id, slot, angle, x, y, { forkSafe: true, outline, parentId });
  return [
    [make(1, 0, 0, .5, .5, old)],
    [make(1, 0, .2, .5, .5, old)],
    [make(1, 0, .4, .4, .5, left), make(2, 1, .5, .6, .5, right, 1)],
    [make(1, 0, .6, .4, .55, left), make(2, 1, .7, .6, .45, right, 1)],
  ];
}

test('oriented raw spiral tangents accumulate opposite signed winding and monotonic absolute travel', () => {
  for (const handedness of [-1, 1]) {
    const points = Array.from({ length: 1001 }, (_, i) => {
      const a = i / 1000 * TAU * 2, radius = .08 + i / 1000 * .14;
      return { x: .5 + handedness * Math.cos(a) * radius, y: .5 + Math.sin(a) * radius };
    });
    const path = pathFrom(points);
    const frames = Array.from({ length: 61 }, (_, i) => [{ id: 1, slot: 0,
      measurement: measureStaircaseContourFeature(path, points[50 + i * 15]) }]);
    const features = buildStaircaseSpiralFeatures(frames);
    const final = read(features, frames.length - 1);
    assert.ok(final[1] * handedness > 1.7, 'real tangent winding retains its handedness');
    assert.ok(final[4] > 1.7 && final[4] < 1.9, 'absolute travel follows the sampled 1.8 rotations');
    for (let i = 1; i < frames.length; i++) assert.ok(read(features, i)[4] >= read(features, i - 1)[4]);
  }
});

test('physical aspect correction leaves tangent, local curvature and fork displacement unchanged', () => {
  const base = Array.from({ length: 201 }, (_, i) => ({ x: .5 + .2 * Math.cos(i / 200 * TAU), y: .5 + .2 * Math.sin(i / 200 * TAU) }));
  const one = measureStaircaseContourFeature(pathFrom(base, true), base[35]);
  const stretched = base.map(point => ({ x: point.x / 2, y: point.y }));
  const two = measureStaircaseContourFeature(pathFrom(stretched, true, 2), stretched[35], 2);
  close(one.angle, two.angle); close(one.curvature, two.curvature); close(one.confidence, two.confidence);
  const frames = forkFrames(), physical = buildStaircaseSpiralFeatures(frames);
  for (const frame of frames) for (const branch of frame) {
    branch.measurement.x /= 2;
    branch.outline = branch.outline.map(point => ({ x: point.x / 2, y: point.y }));
  }
  const corrected = buildStaircaseSpiralFeatures(frames, 2);
  close(read(physical, 3)[2], read(corrected, 3)[2]); close(read(physical, 3, 1)[2], read(corrected, 3, 1)[2]);
});

test('tight local arcs are brighter than broad arcs; straight traces have no curvature', () => {
  const bend = radius => {
    const points = Array.from({ length: 201 }, (_, i) => ({ x: .5 + radius * Math.cos(i / 200 * TAU), y: .5 + radius * Math.sin(i / 200 * TAU) }));
    return measureStaircaseContourFeature(pathFrom(points, true), points[50]).curvature;
  };
  assert.ok(bend(.05) > bend(.2) * 2);
  const straight = pathFrom([{ x: .2, y: .5 }, { x: .5, y: .5 }, { x: .8, y: .5 }]);
  close(measureStaircaseContourFeature(straight, { x: .5, y: .5 }).curvature, 0);
});

test('certified persistent fork inherits current parent pitch/turn phase before diverging', () => {
  const features = buildStaircaseSpiralFeatures(forkFrames());
  const parentBirth = read(features, 2), childBirth = read(features, 2, 1);
  close(childBirth[1], parentBirth[1]); close(childBirth[4], parentBirth[4]); close(childBirth[2], parentBirth[2]);
  assert.ok(parentBirth[1] > 0);
  assert.ok(read(features, 3)[2] > .05);
  assert.ok(read(features, 3, 1)[2] < -.05);
});

test('a nested subspiral inherits an already diverged parent reference', () => {
  const frames = forkFrames();
  const top = box(.57, .32, .78, .48), bottom = box(.57, .52, .78, .68);
  frames.push([
    record(2, 1, .8, .6, .4, { parentId: 1, forkSafe: true, outline: top }),
    record(3, 2, .9, .6, .6, { parentId: 2, forkSafe: true, outline: bottom }),
  ], [
    record(2, 1, 1, .61, .39, { parentId: 1, forkSafe: true, outline: top }),
    record(3, 2, 1.1, .61, .61, { parentId: 2, forkSafe: true, outline: bottom }),
  ]);
  const features = buildStaircaseSpiralFeatures(frames);
  const parent = read(features, 4, 1), child = read(features, 4, 2);
  assert.ok(Math.abs(parent[2]) > .1, 'the parent already carries the first fork');
  close(child[2], parent[2]); close(child[1], parent[1]); close(child[4], parent[4]);
  assert.notEqual(read(features, 5, 2)[2], read(features, 5, 1)[2]);
});

test('a proximity parent, a clipped/censored fragment, an overlapping component, and a transient split never certify a fork', () => {
  for (const kind of ['proximity', 'clipped', 'overlap', 'transient']) {
    const frames = forkFrames();
    if (kind === 'proximity') frames[2][1].outline = box(.91, .3, .99, .7);
    if (kind === 'clipped') frames[2][1].forkSafe = false;
    if (kind === 'overlap') frames[2][1].outline = box(.4, .3, .7, .7);
    if (kind === 'transient') frames[3] = [frames[3][0]];
    const features = buildStaircaseSpiralFeatures(frames);
    close(read(features, 2, 1)[1], 0);
    close(read(features, 3)[2], 0);
    close(read(features, 3, 1)[2], 0);
  }
});

test('unknown local endpoints and ambiguous sampled rotations hold values without fabricated revolutions', () => {
  const line = pathFrom([{ x: .2, y: .5 }, { x: .5, y: .5 }, { x: .8, y: .5 }]);
  assert.equal(measureStaircaseContourFeature(line, { x: .2, y: .5 }).confidence, 0);
  const frames = [[record(1, 0, 0)], [record(1, 0, .3)], [record(1, 0, .3 + Math.PI)], [record(1, 0, -.1)]];
  const features = buildStaircaseSpiralFeatures(frames);
  close(read(features, 2)[1], read(features, 1)[1]); close(read(features, 2)[4], read(features, 1)[4]);
  assert.equal(read(features, 2)[5], 0);
});

test('a temporary absent pair retains its turn and fork references without integrating the unseen gap', () => {
  const frames = forkFrames();
  frames.push([], [record(2, 1, 1, .6, .44, { parentId: 1 })], [record(2, 1, 1.1, .6, .43, { parentId: 1 })]);
  const features = buildStaircaseSpiralFeatures(frames);
  close(read(features, 5, 1)[1], read(features, 3, 1)[1]);
  close(read(features, 5, 1)[4], read(features, 3, 1)[4]);
  assert.ok(read(features, 5, 1)[2] < 0);
  assert.ok(read(features, 6, 1)[4] > read(features, 5, 1)[4]);
});

test('nonfinite or unsupported measurements cannot inject invalid feature values', () => {
  const frames = [[record(1, 0, .3)], [record(1, 0, NaN, Infinity, NaN,
    { measurement: { angle: NaN, x: Infinity, y: NaN, curvature: Infinity, confidence: 1 } })]];
  const features = buildStaircaseSpiralFeatures(frames);
  assert.ok(features.every(Number.isFinite));
  assert.equal(read(features, 1)[5], 0);
  close(read(features, 1)[1], read(features, 0)[1]);
});

test('real sidecar aligns with every voice ID and leaves the existing audio table fixed', () => {
  const field = buildStaircaseField({ pitchSource: 1, resolution: 112, aspect: 1070 / 776 });
  assert.equal(field.featureFrames, 64); assert.equal(field.featureStride, 6); assert.equal(field.features.length, 64 * 512 * 6);
  assert.equal(field.table.length, 64 * 3616); assert.ok(field.features.every(Number.isFinite));
  let forks = 0, turns = 0;
  for (let frame = 0; frame < 64; frame++) for (const branch of field.overlays[frame].branches) {
    const feature = read(field.features, frame, branch.slot);
    assert.equal(feature[0], branch.id);
    assert.equal(field.table[frame * field.stride + STAIRCASE_BRANCH_OFFSET + branch.slot * 6 + 4], feature[0]);
    assert.ok(Math.abs(feature[1]) <= 1024 && Math.abs(feature[2]) <= 16);
    assert.ok(feature[3] >= 0 && feature[3] <= 1 && feature[4] >= 0 && feature[4] <= 2048 && feature[5] >= 0 && feature[5] <= 1);
    if (feature[5] && feature[2]) forks++;
    if (feature[5] && feature[1]) turns++;
  }
  assert.ok(forks > 0); assert.ok(turns > 0);
  const limited = buildStaircaseField({ pitchSource: 1, resolution: 112, aspect: 1070 / 776, voiceLimit: 8 });
  for (let frame = 0; frame < 64; frame++) for (const branch of limited.overlays[frame].branches) {
    assert.deepEqual(read(limited.features, frame, branch.slot), read(field.features, frame, branch.slot),
      'lowering the audible budget never resets geometry lineage or phase');
  }
  for (const progress of [.175, .59, .76]) for (const branch of readStaircaseRhythm(field, progress).branches) {
    assert.ok(Object.values(branch.feature).every(Number.isFinite));
  }
});

test('feature feedback never blends two different identities occupying the same slot', () => {
  const table = new Float32Array(2 * 3616), features = new Float32Array(2 * FRAME);
  for (let frame = 0; frame < 2; frame++) {
    table.set([1, .4, .6, .1, frame + 1, 0], frame * 3616 + STAIRCASE_BRANCH_OFFSET);
    table[frame * 3616 + 535] = 7;
    features.set([frame + 1, frame ? 10 : 1, 0, .2, frame ? 12 : 2, 1], frame * FRAME);
  }
  const field = { table, features, frames: 2, stride: 3616, pitchSource: 0,
    overlays: [0, 1].map(() => ({ branches: [], bandLow: 0, bandHigh: 1, omitted: 0 })) };
  close(readStaircaseRhythm(field, .25).branches[0].feature.signedTurns, 1);
  close(readStaircaseRhythm(field, .75).branches[0].feature.signedTurns, 10);
  features[FRAME] = 999;
  assert.equal(readStaircaseRhythm(field, .75).branches[0].feature.confidence, 0);
});


test('feature feedback does not invent interpolation through unsupported geometry', () => {
  const table = new Float32Array(2 * 3616), features = new Float32Array(2 * FRAME);
  for (let frame = 0; frame < 2; frame++) {
    table.set([1, .4, .6, .1, 1, 0], frame * 3616 + STAIRCASE_BRANCH_OFFSET);
    table[frame * 3616 + 535] = 7;
  }
  features.set([1, .2, .1, .3, .4, 1]);
  features.set([1, .9, .8, .7, .6, 0], FRAME);
  const field = { table, features, frames: 2, stride: 3616, pitchSource: 0,
    overlays: [0, 1].map(() => ({ branches: [], bandLow: 0, bandHigh: 1, omitted: 0 })) };
  const known = readStaircaseRhythm(field, .25).branches[0].feature;
  close(known.signedTurns, .2); close(known.travelTurns, .4); close(known.confidence, 1);
  const unknown = readStaircaseRhythm(field, .75).branches[0].feature;
  assert.equal(unknown.confidence, 0, 'unknown geometry is exposed, never a fractional invented confidence');
  close(unknown.signedTurns, .9);
  features[FRAME + 5] = 1;
  close(readStaircaseRhythm(field, .25).branches[0].feature.signedTurns, .375);
});
