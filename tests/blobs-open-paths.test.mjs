import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, cleanPoints, contourVertices, normalizeParams, normalizeScene, pointAt, SCENE_VERSION } from '../src/instruments/blobs/model.js';
import { buildPerformancePath, containsPoint, inverseAnchor, rotatePath, transformAnchor, translateBlob } from '../src/instruments/blobs/paths.js';
import { expandPaths } from '../src/instruments/blobs/symmetry.js';
import { curvePoint, handles, insertPoint, nearestSegment, removePoint, smoothPoint } from '../src/instruments/blobs/vector.js';

const line = () => ({ tool: 'line', closed: false, points: [{ x: .2, y: .4 }, { x: .8, y: .4 }] });
const square = () => ({ tool: 'line', points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }] });
const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const nearPoint = (actual, expected, epsilon) => { near(actual.x, expected.x, epsilon); near(actual.y, expected.y, epsilon); };

test('two-point open lines sample both endpoints, only their real length and ordered segment locations', () => {
  const blob = line(), path = buildPath(blob);
  assert.equal(path.closed, false);
  near(path.length, .6);
  nearPoint(pointAt(path.samples, 0, {}, false), blob.points[0]);
  nearPoint(pointAt(path.samples, .5, {}, false), { x: .5, y: .4 });
  nearPoint(pointAt(path.samples, 1, {}, false), blob.points[1]);
  nearPoint(pointAt(path.samples, 2, {}, false), blob.points[1]);
  nearPoint(pointAt(path.samples, -1, {}, false), blob.points[0]);
  assert.deepEqual(path.locations[0], { segment: 0, t: 0 });
  assert.deepEqual(path.locations.at(-1), { segment: 0, t: 1 });
  assert.ok(path.locations.every((location, i) => location.segment === 0 && location.t >= 0 && location.t <= 1 && (!i || location.t >= path.locations[i - 1].t)));
  assert.equal(buildPath({ ...blob, closed: true }), null);
  assert.equal(buildPath({ ...blob, points: blob.points.slice(0, 1) }), null);
  assert.equal(buildPath({ ...blob, points: [{ x: .4, y: .4 }, { x: .42, y: .4 }] }), null);
});

test('open polylines never sample an implied closing edge', () => {
  const blob = { ...square(), closed: false }, open = buildPath(blob), closed = buildPath(square());
  near(open.length, 1.8);
  near(closed.length, 2.4);
  nearPoint(pointAt(open.samples, 1, {}, false), blob.points.at(-1));
  assert.ok(open.locations.every(location => location.segment < blob.points.length - 1));
  assert.equal(open.locations.at(-1).segment, 2);
  assert.equal(open.locations.at(-1).t, 1);
  for (let i = 0; i < open.samples.length; i += 2) assert.ok(Math.abs(open.samples[i] - .2) > 1e-6 || Math.abs(open.samples[i + 1] - .2) < 1e-6 || Math.abs(open.samples[i + 1] - .8) < 1e-6);
});

test('open pen curves honor independent handles and include their true final endpoint', () => {
  const blob = { ...line(), tool: 'pen', points: [{ x: .2, y: .6, hx: .1, hy: -.35, inHx: -.7, inHy: .2 }, { x: .8, y: .6, hx: .7, hy: .2, inHx: -.1, inHy: -.35 }] };
  const vertices = contourVertices(blob), path = buildPath(blob);
  assert.equal(vertices.length, 17);
  for (let i = 0; i < vertices.length; i++) nearPoint(vertices[i], curvePoint(blob, 0, i / 16), 1e-12);
  nearPoint(pointAt(path.samples, 1, {}, false), blob.points.at(-1));
  assert.ok(path.length > .6);
  assert.ok(pointAt(path.samples, .5, {}, false).y < .4);
  const changedUnusedHandles = structuredClone(blob);
  Object.assign(changedUnusedHandles.points[0], { inHx: .1, inHy: -.8 });
  Object.assign(changedUnusedHandles.points[1], { hx: -.3, hy: -.9 });
  assert.deepEqual(buildPath(changedUnusedHandles), path);
});

test('scene migration retains legacy closure while explicit topology round-trips unchanged', () => {
  for (const version of [1, 2, 3, 4, 5]) {
    const scene = normalizeScene({ version, blobs: [square(), line(), { ...square(), closed: true }], params: {} });
    assert.equal(scene.version, SCENE_VERSION);
    assert.equal('closed' in scene.blobs[0], false);
    assert.equal(buildPath(scene.blobs[0]).closed, true);
    assert.equal(scene.blobs[1].closed, false);
    assert.equal(scene.blobs[2].closed, true);
    assert.deepEqual(normalizeScene(JSON.parse(JSON.stringify(scene))), scene);
  }
  assert.equal(normalizeScene({ version: 6, blobs: [] }), null);
  const malformed = normalizeScene({ version: 5, blobs: [{ ...square(), closed: 'false' }] });
  assert.equal('closed' in malformed.blobs[0], false);
  assert.equal(buildPath(malformed.blobs[0]).closed, true);
});

test('open cleaning preserves terminal anchors even when they coincide or need bounded resampling', () => {
  const points = [...square().points, square().points[0]];
  assert.equal(cleanPoints(points, false).length, 5);
  assert.equal(cleanPoints(points).length, 4);
  const path = buildPerformancePath({ tool: 'line', closed: false, points }, normalizeParams({}));
  assert.equal(path.closed, false);
  assert.equal(path.anchorIndices[0], 0);
  assert.equal(path.anchorIndices.at(-1), path.points.length - 1);
  assert.equal(path.vertexIndices.at(-1), path.points.length - 1);
  const dense = Array.from({ length: 1000 }, (_, i) => ({ x: .1 + .8 * i / 999, y: .5 + .1 * Math.sin(i / 40) }));
  const cleaned = cleanPoints(dense, false);
  assert.equal(cleaned.length, 256);
  nearPoint(cleaned[0], dense[0]);
  nearPoint(cleaned.at(-1), dense.at(-1));
});

test('open performance paths have endpoint reversal corners and no filled interior', () => {
  const path = buildPerformancePath(line(), normalizeParams({}));
  assert.equal(path.closed, false);
  assert.equal(path.sides, 2);
  near(path.totalLength, 1.2);
  assert.equal(path.cumulativeLengths.at(-1), path.totalLength);
  assert.deepEqual(path.vertexIndices, [0, 255]);
  assert.deepEqual(path.vertexDistances, [0, path.totalLength]);
  assert.deepEqual(path.cornerTurns, [1, -1]);
  assert.deepEqual(path.cornerStrengths, [1, 1]);
  assert.equal(containsPoint(buildPerformancePath({ ...square(), closed: false }, normalizeParams({})), { x: .5, y: .5 }), false);
  const elbow = buildPerformancePath({ ...line(), points: [{ x: .2, y: .3 }, { x: .6, y: .3 }, { x: .6, y: .5 }] }, normalizeParams({}));
  assert.equal(elbow.vertexCount, 3);
  near(elbow.cornerTurns[1], .5, 1e-5);
});

test('open even and dense authored corners always retain both endpoints within the corner budget', () => {
  const dense = { tool: 'pencil', closed: false, points: Array.from({ length: 160 }, (_, i) => ({ x: .1 + i / 200, y: .5 + .1 * Math.sin(i / 10) })) };
  for (const blob of [line(), dense]) for (const corners of [1, 2, 11, 32]) for (const cornerMode of ['even', 'anchors']) {
    const path = buildPerformancePath(blob, normalizeParams({ cornerMode, corners }));
    assert.equal(path.vertexIndices[0], 0);
    assert.equal(path.vertexIndices.at(-1), 255);
    assert.ok(path.vertexCount >= 2 && path.vertexCount <= 32);
    assert.equal(path.vertexCount, new Set(path.vertexIndices).size);
    if (cornerMode === 'even') assert.equal(path.vertexCount, Math.max(2, corners));
    assert.equal(path.cornerStrengths[0], 1);
    assert.equal(path.cornerStrengths.at(-1), 1);
  }
});

test('open contours retain topology and timing through offsets, reflection, rotation and editing transforms', () => {
  const blob = { ...line(), offset: { x: .04, y: -.06 } }, params = normalizeParams({ aspect: .6, skew: .4 });
  const base = buildPerformancePath(blob, params);
  const moved = buildPerformancePath(translateBlob(blob, base, { x: -.03, y: .02 }), params);
  assert.equal(moved.closed, false);
  assert.equal(moved.totalLength, base.totalLength);
  for (const path of expandPaths([base], ['vertical', 'diagonal'])) {
    const rotated = rotatePath(path, 71);
    assert.equal(rotated.closed, false);
    assert.equal(rotated.totalLength, base.totalLength);
    assert.deepEqual(rotated.vertexDistances, base.vertexDistances);
    assert.ok(rotated.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  for (const point of blob.points) nearPoint(inverseAnchor(transformAnchor(point, base, 73), base, 73), point, 1e-12);
});

test('roundness bends a two-anchor open span to either side while preserving both endpoints', () => {
  const blob = { ...line(), points: [{ x: .2, y: .5 }, { x: .8, y: .5 }] };
  const straight = buildPerformancePath(blob, normalizeParams({ curvature: 0 }));
  assert.ok(straight.points.every(point => point.y === 0));
  for (const curvature of [-1, -.5, .5, 1]) {
    const path = buildPerformancePath(blob, normalizeParams({ curvature }));
    assert.equal(path.closed, false);
    nearPoint(path.points[0], straight.points[0], 1e-12);
    nearPoint(path.points.at(-1), straight.points.at(-1), 1e-12);
    assert.ok(path.points[128].y * curvature > 0);
    near(path.points[128].y, curvature * .54, 3e-5);
    assert.ok(path.totalLength > straight.totalLength);
    assert.equal(path.cumulativeLengths.at(-1), path.totalLength);
    assert.ok(path.points.every(point => Math.hypot(point.x, point.y) <= 1));
  }
});

test('open vector editing inserts real segments, never hits or splits an implied seam, and keeps two anchors', () => {
  const blob = { ...square(), closed: false };
  assert.equal(curvePoint(blob, 3, .5), null);
  assert.equal(insertPoint(blob, 3, .5), null);
  assert.equal(nearestSegment(blob, { x: .2, y: .5 }, { maxDistance: .01 }), null);
  const hit = nearestSegment(blob, { x: .5, y: .2 }, { maxDistance: .01 });
  assert.equal(hit.segment, 0);
  near(hit.t, .5);
  const split = insertPoint(line(), 0, .3);
  assert.equal(split.closed, false);
  assert.equal(split.points.length, 3);
  nearPoint(split.points[1], { x: .38, y: .4 });
  assert.deepEqual(removePoint(split, 1), line());
  assert.equal(removePoint(line(), 0), null);
  assert.equal(removePoint(split, 0).points.length, 2);
});

test('open cubic subdivision preserves the full curve and unused endpoint handles', () => {
  const blob = { tool: 'pen', closed: false, points: [{ x: .2, y: .6, hx: .1, hy: -.3, inHx: .01, inHy: .02 }, { x: .8, y: .6, hx: .07, hy: .08, inHx: -.1, inHy: -.3 }] };
  const split = insertPoint(blob, 0, .37);
  assert.equal(split.closed, false);
  nearPoint(handles(split.points[0]).in, handles(blob.points[0]).in, 1e-12);
  nearPoint(handles(split.points.at(-1)).out, handles(blob.points.at(-1)).out, 1e-12);
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    nearPoint(curvePoint(split, 0, t), curvePoint(blob, 0, t * .37), 1e-12);
    nearPoint(curvePoint(split, 1, t), curvePoint(blob, 0, .37 + t * .63), 1e-12);
  }
});

test('smoothing open endpoints uses their sole neighbor without handles toward a fictional seam', () => {
  const blob = { ...line(), points: [{ x: .2, y: .2 }, { x: .5, y: .5 }, { x: .8, y: .2 }] };
  const first = smoothPoint(blob, 0), last = smoothPoint(blob, 2), middle = smoothPoint(blob, 1);
  nearPoint(handles(first.points[0]).out, { x: .1, y: .1 }, 1e-12);
  nearPoint(handles(first.points[0]).in, { x: 0, y: 0 }, 1e-12);
  nearPoint(handles(last.points[2]).in, { x: -.1, y: .1 }, 1e-12);
  nearPoint(handles(last.points[2]).out, { x: 0, y: 0 }, 1e-12);
  nearPoint(handles(middle.points[1]).out, { x: .1, y: 0 }, 1e-12);
  assert.equal(first.closed, false);
});
