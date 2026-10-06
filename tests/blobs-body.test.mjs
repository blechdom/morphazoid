import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, SCENE_VERSION, demoBlobs, normalizeParams, normalizeScene } from '../src/instruments/blobs/model.js';
import { buildPerformancePath, containsPoint, inverseAnchor, rotatePath, transformAnchor, translateBlob } from '../src/instruments/blobs/paths.js';

const square = { tool: 'line', points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }] };
const nearly = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, `${message ?? ''}: ${actual} ≈ ${expected}`);

test('body translation preserves authored curves, fitted size, path timing and corner sound under form changes', () => {
  for (const form of [{}, { aspect: .8, skew: -.65, curvature: .7 }, { aspect: -.7, skew: .6, cornerMode: 'even', corners: 13 }]) {
    const blob = demoBlobs()[0], original = structuredClone(blob), params = normalizeParams(form);
    const before = buildPerformancePath(blob, params);
    const moved = translateBlob(blob, before, { x: .035, y: -.025 });
    const after = buildPerformancePath(moved, params);
    assert.strictEqual(moved.points, blob.points);
    assert.deepEqual(blob, original);
    assert.equal(after.transform.fit, before.transform.fit);
    assert.equal(after.totalLength, before.totalLength);
    for (const key of ['cumulativeLengths', 'vertexDistances', 'cornerTurns', 'cornerStrengths', 'locations']) assert.deepEqual(after[key], before[key]);
    nearly(after.bounds.width, before.bounds.width, 'width');
    nearly(after.bounds.height, before.bounds.height, 'height');
    for (let i = 0; i < before.points.length; i++) {
      nearly(after.points[i].x - before.points[i].x, moved.offset.x * 2, 'rigid x');
      nearly(after.points[i].y - before.points[i].y, moved.offset.y * 2, 'rigid y');
    }
  }
});

test('body motion clamps the full sampled contour and starts from the effective displayed offset', () => {
  const before = buildPerformancePath(square, DEFAULTS);
  const moved = translateBlob(square, before, { x: 10, y: -10 });
  const after = buildPerformancePath(moved, DEFAULTS);
  nearly(after.bounds.maxX, 1); nearly(after.bounds.minY, -1);
  nearly(moved.offset.x, (1 - before.bounds.maxX) / 2);
  nearly(moved.offset.y, (-1 - before.bounds.minY) / 2);
  for (const p of after.points) assert.ok(p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1);
  const overshot = { ...square, offset: { x: 1, y: -1 } };
  const displayed = buildPerformancePath(overshot, DEFAULTS);
  const reversed = translateBlob(overshot, displayed, { x: -.04, y: .06 });
  nearly(reversed.offset.x, displayed.transform.offsetX - .04);
  nearly(reversed.offset.y, displayed.transform.offsetY + .06);
  assert.deepEqual(translateBlob(overshot, displayed, { x: NaN, y: Infinity }).offset, moved.offset);
});

test('offset scenes save exactly, bound malformed values, and migrate every older scene without altering unmoved blobs', () => {
  assert.equal(SCENE_VERSION, 4);
  for (const version of [1, 2, 3, 4]) {
    const scene = normalizeScene({ version, blobs: [square], params: {} });
    assert.equal(scene.version, SCENE_VERSION);
    assert.equal('offset' in scene.blobs[0], false);
    assert.deepEqual(normalizeScene(scene), scene);
  }
  const moved = normalizeScene({ version: SCENE_VERSION, blobs: [{ ...square, offset: { x: .08, y: -.05 } }], params: {} });
  assert.deepEqual(normalizeScene(JSON.parse(JSON.stringify(moved))), moved);
  assert.deepEqual(moved.blobs[0].offset, { x: .08, y: -.05 });
  const malformed = normalizeScene({ version: SCENE_VERSION, blobs: [
    { ...square, offset: { x: 50, y: -50 } }, { ...square, offset: { x: NaN, y: Infinity } }, { ...square, offset: {} },
  ], params: {} });
  assert.deepEqual(malformed.blobs.map(blob => blob.offset), [{ x: 1, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
});

test('point and handle editing round-trips through body offsets, form controls and global rotation', () => {
  const blob = { ...demoBlobs()[0], offset: { x: -.08, y: .06 } };
  const path = buildPerformancePath(blob, normalizeParams({ aspect: .65, skew: -.7 }));
  for (const degrees of [0, 73, -121]) for (const anchor of blob.points) {
    for (const point of [anchor, { x: anchor.x + anchor.hx, y: anchor.y + anchor.hy }]) {
      const actual = inverseAnchor(transformAnchor(point, path, degrees), path, degrees);
      nearly(actual.x, point.x); nearly(actual.y, point.y);
    }
  }
});

test('body hit testing follows concave and curved sampled fills, including translations and rotation', () => {
  const concave = { tool: 'line', points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .4 }, { x: .4, y: .4 }, { x: .4, y: .8 }, { x: .2, y: .8 }] };
  const path = buildPerformancePath(concave, DEFAULTS);
  assert.equal(containsPoint(path, { x: .3, y: .65 }), true);
  assert.equal(containsPoint(path, { x: .7, y: .7 }), false);
  const moved = buildPerformancePath({ ...concave, offset: { x: .05, y: -.05 } }, DEFAULTS);
  assert.equal(containsPoint(moved, { x: .35, y: .6 }), true);
  assert.equal(containsPoint(moved, { x: .75, y: .65 }), false);
  const rotated = rotatePath(path, 90);
  assert.equal(containsPoint(rotated, { x: .35, y: .3 }), true);
  assert.equal(containsPoint(rotated, { x: .3, y: .7 }), false);
  const curved = buildPerformancePath({ tool: 'pen', points: [
    { x: .3, y: .3, hx: .13, hy: -.2 }, { x: .7, y: .3, hx: .2, hy: .13 },
    { x: .7, y: .7, hx: -.13, hy: .2 }, { x: .3, y: .7, hx: -.2, hy: -.13 },
  ] }, DEFAULTS);
  assert.equal(containsPoint(curved, { x: .5, y: .23 }), true, 'curved bulge outside the anchor polygon');
  assert.equal(containsPoint(curved, { x: .5, y: .1 }), false);
  assert.equal(containsPoint(path, { x: NaN, y: .5 }), false);
});

test('body hit testing uses nonzero winding, accepts either direction and includes contour boundaries', () => {
  const loop = [{ x: -.6, y: -.6 }, { x: .6, y: -.6 }, { x: .6, y: .6 }, { x: -.6, y: .6 }];
  for (const points of [loop, loop.toReversed(), [...loop, ...loop]]) {
    const path = { points, closed: true };
    assert.equal(containsPoint(path, { x: .5, y: .5 }), true);
    assert.equal(containsPoint(path, { x: .2, y: .5 }), true);
    assert.equal(containsPoint(path, { x: .2, y: .2 }), true);
    assert.equal(containsPoint(path, { x: .1, y: .5 }), false);
  }
  const cancelled = [loop[0], loop[1], loop[2], loop[3], loop[0], loop[3], loop[2], loop[1]];
  assert.equal(containsPoint({ points: cancelled, closed: true }, { x: .5, y: .5 }), false);
});
