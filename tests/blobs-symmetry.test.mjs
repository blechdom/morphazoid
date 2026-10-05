import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPaths, reflectionTransforms, reflectPoint, unreflectPoint, rotateUnitPoint } from '../src/instruments/blobs/symmetry.js';
import { buildPerformancePath, transformAnchor, inverseAnchor } from '../src/instruments/blobs/paths.js';
import { demoBlobs, normalizeParams, normalizeScene, buildPath } from '../src/instruments/blobs/model.js';
import { insertPoint, curvePoint } from '../src/instruments/blobs/vector.js';

const nearly = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-8);
test('reflection axes form distinct closed two-, four-, and eightfold ornaments', () => {
  const params = normalizeParams({ aspect: .4, skew: -.2 });
  const base = buildPerformancePath(demoBlobs()[0], params);
  for (const [axes, count] of [[[], 1], [['vertical'], 2], [['horizontal', 'vertical'], 4], [['vertical', 'diagonal'], 8], [['vertical', 'diagonal', 'horizontal', 'antiDiagonal'], 8]]) {
    const paths = expandPaths([base], axes);
    assert.equal(paths.length, count);
    assert.equal(new Set(paths.map(path => path.pathKey)).size, count);
    for (const path of paths) {
      assert.equal(path.closed, true);
      assert.equal(path.totalLength, base.totalLength);
      assert.deepEqual(path.vertexDistances, base.vertexDistances);
      const m = path.reflection, determinant = m.a * m.d - m.b * m.c;
      assert.deepEqual(path.cornerTurns, base.cornerTurns.map(turn => turn * determinant));
      assert.deepEqual(path.cornerStrengths, base.cornerStrengths);
      for (let i = 0; i < path.points.length; i += 13) {
        const transformed = reflectPoint({ x: (base.points[i].x + 1) / 2, y: (base.points[i].y + 1) / 2 }, m);
        nearly(transformed, { x: (path.points[i].x + 1) / 2, y: (path.points[i].y + 1) / 2 });
      }
    }
  }
});
test('drag coordinates round-trip across all reflected, stretched, skewed and rotated copies', () => {
  const blob = demoBlobs()[0], path = buildPerformancePath(blob, normalizeParams({ aspect: .9, skew: .7 }));
  for (const reflection of reflectionTransforms(['vertical', 'diagonal'])) for (const point of blob.points) {
    const shown = rotateUnitPoint(reflectPoint(transformAnchor(point, path, 0), reflection), 113);
    const recovered = inverseAnchor(unreflectPoint(rotateUnitPoint(shown, -113), reflection), path, 0);
    nearly(point, recovered);
  }
});
test('old drawings migrate and inserted asymmetric handles survive exact saved-state recall', () => {
  const original = demoBlobs()[0], split = insertPoint(original, 1, .27);
  const scene = normalizeScene({ version: 2, blobs: [split], params: { reflectionAxes: ['vertical', 'diagonal', 'vertical', 'invalid'] } });
  assert.equal(scene.version, 3);
  assert.deepEqual(scene.params.reflectionAxes, ['vertical', 'diagonal']);
  assert.deepEqual(normalizeScene(scene), scene);
  for (let t = 0; t < 1; t += .025) {
    const actual = t < .27 ? curvePoint(scene.blobs[0], 1, t / .27) : curvePoint(scene.blobs[0], 2, (t - .27) / .73);
    nearly(actual, curvePoint(original, 1, t));
  }
  assert.ok(buildPath(scene.blobs[0]));
  assert.deepEqual(normalizeScene({ version: 2, blobs: [original], params: {} }).params.reflectionAxes, []);
});
test('path sampling retains ordered source segment locations including the closing segment', () => {
  for (const tool of ['pen', 'line']) {
    const blob = { ...demoBlobs()[0], tool }, sampled = buildPath(blob);
    assert.equal(sampled.locations.length, sampled.samples.length / 2);
    let previous = -1;
    for (const loc of sampled.locations) {
      assert.ok(loc.segment >= 0 && loc.segment < blob.points.length && loc.t >= 0 && loc.t < 1);
      assert.ok(loc.segment + loc.t >= previous); previous = loc.segment + loc.t;
    }
    assert.equal(sampled.locations.at(-1).segment, blob.points.length - 1);
  }
});
