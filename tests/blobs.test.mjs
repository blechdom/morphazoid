import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildPath, pointAt, demoBlobs, normalizeScene, normalizeParams, phaseAt, frequencyAt, DEFAULTS, MAX_POINTS } from '../src/instruments/blobs/model.js';
import { RANGES, CHOICES, performanceState } from '../src/instruments/blobs/parameters.js';
import { buildPerformancePath, rotatePath, transformAnchor, inverseAnchor } from '../src/instruments/blobs/paths.js';
import { BLOB_PRESETS, randomizeBlobs } from '../src/instruments/blobs/presets.js';
import { createShapeReaderModel } from '../src/families/geometry-presets/shape-readers.js';
import { blobsSiteChanges, restoreBlobsSite } from './helpers/blobs-site-reference.mjs';

const square = { tool: 'line', points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }] };
test('closed paths cover the closing segment with constant arc-length travel', () => {
  const path = buildPath(square);
  assert.ok(Math.abs(path.length - 2.4) < 1e-6);
  for (const [phase, x, y] of [[0, .2, .2], [.125, .5, .2], [.375, .8, .5], [.875, .2, .5], [1, .2, .2], [-.125, .2, .5]]) {
    const point = pointAt(path.samples, phase);
    assert.ok(Math.abs(point.x - x) < 1e-6 && Math.abs(point.y - y) < 1e-6);
  }
});
test('pen handles change the contour and preserve a closed seam', () => {
  const demo = demoBlobs()[0], curved = buildPath(demo), corners = buildPath({ ...demo, tool: 'line' });
  assert.notDeepEqual(curved.samples, corners.samples);
  assert.deepEqual(pointAt(curved.samples, 0), pointAt(curved.samples, 1));
  assert.ok(curved.samples.every(value => Number.isFinite(value) && value >= .019 && value <= .981));
});
test('invalid, tiny and unfinished contours never become playable', () => {
  for (const tool of ['line', 'pen', 'pencil']) {
    for (const points of [[], [{ x: .4, y: .4, hx: .1 }], square.points.slice(0, 2), [{ x: .4, y: .4 }, { x: .4, y: .4 }, { x: NaN, y: 0 }]]) assert.equal(buildPath({ tool, points }), null);
  }
});
test('saved scenes clamp resource bounds and reject unknown versions', () => {
  assert.equal(normalizeScene({ version: 99, blobs: [] }), null);
  const scene = normalizeScene({ version: 1, blobs: Array.from({ length: 30 }, () => ({ tool: 'pencil', points: Array.from({ length: 3000 }, (_, i) => ({ x: .5 + .3 * Math.cos(i / 30), y: .5 + .3 * Math.sin(i / 30) })) })), params: { heads: 99, speed: Infinity, baseFrequency: -20 } });
  assert.equal(scene.blobs.length, 6);
  assert.ok(scene.blobs.every(blob => blob.points.length <= MAX_POINTS));
  assert.equal(scene.version, 3);
  assert.equal(scene.params.heads, 12); assert.equal(scene.params.baseFrequency, 20);
  assert.deepEqual(normalizeScene(scene), scene);
});
test('pause, speed and reverse can rebase without jumping; height maps continuously', () => {
  const params = { ...DEFAULTS, speed: .2 }, initial = { phase: .1, time: 10, playing: true };
  const at = phaseAt(initial, 12, params);
  assert.ok(Math.abs(at - .5) < 1e-10);
  const rebased = { phase: at, time: 12, playing: true };
  assert.equal(phaseAt(rebased, 12, { ...params, traversalDirection: -1, speed: .6 }), at);
  assert.equal(phaseAt({ ...rebased, playing: false }, 100, params), at);
  assert.ok(frequencyAt(.2, params) > frequencyAt(.8, params));
  assert.equal(frequencyAt(.5, params), params.baseFrequency);
});
test('legacy drawings retain pitch, stereo and backwards travel without enabling corner envelopes', () => {
  const scene = normalizeScene({ version: 1, blobs: [square], params: { baseFrequency: 220, spread: .3, reverse: true } });
  assert.equal(scene.params.baseFrequency, 220);
  assert.equal(scene.params.stereoWidth, .3);
  assert.equal(scene.params.traversalDirection, -1);
  assert.equal(scene.params.amplitudeEnvelopeEnabled, false);
  assert.deepEqual(scene.blobs[0].points.map(({ x, y }) => ({ x, y })), square.points);
});
test('drawn corners, evenly spaced corners, and transformed editing share a closed path', () => {
  const params = normalizeParams({ aspect: .7, skew: -.3 });
  const path = buildPerformancePath(square, params);
  assert.equal(path.vertexCount, 4);
  assert.equal(path.points.length, 256);
  assert.ok(path.cornerStrengths.every(strength => strength > .05));
  const even = buildPerformancePath(square, normalizeParams({ cornerMode: 'even', corners: 11 }));
  assert.equal(even.vertexCount, 11);
  assert.ok(even.cornerStrengths.every(strength => strength >= .35));
  const rotated = rotatePath(path, 73);
  assert.equal(rotated.totalLength, path.totalLength);
  assert.deepEqual(rotated.vertexDistances, path.vertexDistances);
  for (const p of square.points) {
    const actual = inverseAnchor(transformAnchor(p, path, 73), path, 73);
    assert.ok(Math.hypot(actual.x - p.x, actual.y - p.y) < 1e-10);
  }
  assert.notDeepEqual(buildPerformancePath(square, normalizeParams({ curvature: .8 })).points, buildPerformancePath(square, DEFAULTS).points);
});
test('playheads and rotation have independent clocks; ping-pong direction edits preserve contact position', () => {
  const params = normalizeParams({ speed: .2, rotationSpeed: .1, motionMode: 'pingpong' });
  const clock = { phase: .75, rotationPhase: .1, time: 10, playing: false, rotating: true };
  const before = performanceState(params, clock, 12);
  assert.equal(before.position, .75);
  assert.ok(Math.abs(before.rotation - 108) < 1e-9);
  const reversed = normalizeParams({ ...params, traceHeadDirections: [-1], traceHeadDirectionAdjustments: [1.5] });
  assert.equal(reversed.traceHeadDirectionAdjustments[0], 1.5);
  const path = buildPerformancePath(square, params);
  const a = createShapeReaderModel(before).collectContacts(path).contacts[0];
  const b = createShapeReaderModel(performanceState(reversed, clock, 12)).collectContacts(path).contacts[0];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-10);
  const moving = performanceState(params, { ...clock, playing: true, rotating: false }, 12);
  assert.ok(Math.abs(moving.position - .85) < 1e-10);
  assert.ok(Math.abs(moving.rotation - 36) < 1e-9);
});
test('30 complete distinct presets cover all five engines and survive exact recall', () => {
  assert.equal(BLOB_PRESETS.length, 30);
  assert.equal(new Set(BLOB_PRESETS.map(preset => preset.id)).size, 30);
  assert.equal(new Set(BLOB_PRESETS.map(preset => JSON.stringify(preset.snapshot))).size, 30);
  for (const mode of CHOICES.soundMode) assert.equal(BLOB_PRESETS.filter(preset => preset.snapshot.params.soundMode === mode).length, 6);
  for (const { snapshot, label } of BLOB_PRESETS) {
    assert.deepEqual(normalizeScene(snapshot), snapshot, label);
    assert.ok(snapshot.blobs.every(blob => buildPerformancePath(blob, snapshot.params)?.closed));
    assert.equal('playing' in snapshot.params, false);
    assert.equal('audioEnabled' in snapshot.params, false);
    assert.equal('level' in snapshot.params, false);
  }
});
test('whole-scene randomization varies every musical field within valid recall bounds', () => {
  let seed = 317;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const states = Array.from({ length: 100 }, () => randomizeBlobs(null, random));
  for (const scene of states) {
    assert.deepEqual(normalizeScene(scene), scene);
    for (const [key, [low, high]] of Object.entries(RANGES)) assert.ok(scene.params[key] >= low && scene.params[key] <= high, key);
    assert.equal(scene.params.percussionEnvelopePoints[1].y, 1);
    assert.ok(scene.blobs.every(blob => buildPerformancePath(blob, scene.params)?.closed));
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (['amplitudePreset', 'percussionPreset', 'pitchCurvePreset'].includes(key)) continue;
    assert.ok(new Set(states.map(scene => JSON.stringify(scene.params[key]))).size > 1, `${key} must vary`);
  }
  assert.ok(new Set(states.map(scene => JSON.stringify(scene.blobs))).size > 90);
});
test('Blobs registration preserves all pre-existing catalogue source bytes', async () => {
  for (const { file, addition, sha256 } of blobsSiteChanges) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(restoreBlobsSite(source, file)).digest('hex'), sha256);
    assert.throws(() => restoreBlobsSite(source + addition, file), /exact Blobs addition/);
    assert.throws(() => restoreBlobsSite(source.replace(addition, ''), file), /exact Blobs addition/);
  }
});
