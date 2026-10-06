import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlobWord } from '../src/instruments/blobs/lettering.js';
import { buildPath, cleanPoints, contourVertices, normalizeScene, SCENE_VERSION } from '../src/instruments/blobs/model.js';
import { defaultParameters } from '../src/instruments/blobs/parameters.js';
import { buildPerformancePath, containsPoint } from '../src/instruments/blobs/paths.js';
import { curvePoint, insertPoint } from '../src/instruments/blobs/vector.js';

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

test('blob lettering keeps four independent editable closed contours and shared letter alignment', () => {
  const blobs = createBlobWord(), params = defaultParameters();
  assert.equal(blobs.length, 4);
  const scene = { version: SCENE_VERSION, blobs, params };
  assert.deepEqual(normalizeScene(scene), scene);
  const paths = blobs.map(blob => buildPerformancePath(blob, params));
  for (const [i, blob] of blobs.entries()) {
    assert.ok(blob.points.length >= 3 && blob.points.length <= 20);
    assert.deepEqual(cleanPoints(blob.points), blob.points);
    assert.ok(buildPath(blob)?.length > .1);
    assert.equal(paths[i].closed, true);
    assert.equal(paths[i].transform.fit, 1, 'independent stage fitting must not shrink or displace a letter');
    assert.equal(Math.max(...blob.points.map(p => p.y)), .73, 'letter baselines align');
    const last = curvePoint(blob, blob.points.length - 1, 1);
    assert.deepEqual(last, { x: blob.points[0].x, y: blob.points[0].y });
    if (i) assert.ok(paths[i - 1].bounds.maxX < paths[i].bounds.minX, 'letters retain readable spacing');
  }
  assert.equal(Math.min(...blobs[0].points.map(p => p.y)), Math.min(...blobs[1].points.map(p => p.y)));
  assert.deepEqual(blobs[0].points.map(p => p.y), blobs[3].points.map(p => p.y));
});

test('stencil letters keep open counters with no crossed or coincident return edges', () => {
  const blobs = createBlobWord(), params = defaultParameters();
  const paths = blobs.map(blob => buildPerformancePath(blob, params));
  for (const [index, x] of [[0, .10], [3, .725]]) {
    assert.equal(containsPoint(paths[index], { x: x + .20 * .55, y: .29 + .44 * .675 }), false, 'b bowl remains hollow');
    assert.equal(containsPoint(paths[index], { x: x + .20 * .15, y: .4 }), true, 'b ascender remains solid');
  }
  assert.equal(containsPoint(paths[2], { x: .58, y: .5826 }), false, 'o counter remains hollow');
  assert.equal(containsPoint(paths[2], { x: .495, y: .5826 }), true, 'o ring remains solid');
  for (const blob of blobs) {
    const points = contourVertices(blob);
    for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length];
      const intersects = cross(a, b, c) * cross(a, b, d) < -1e-14 && cross(c, d, a) * cross(c, d, b) < -1e-14;
      assert.equal(intersects, false, `letter segments ${i} and ${j} must not cross`);
    }
  }
});

test('letter contours can be independently edited and split using ordinary vector points', () => {
  const original = createBlobWord(), second = createBlobWord();
  assert.deepEqual(second, original);
  second[0].points[0].x += .02;
  assert.notEqual(second[0].points[0].x, original[0].points[0].x);
  assert.deepEqual(second[3], original[3]);
  for (const blob of original) {
    const edited = insertPoint(blob, 0, .4);
    assert.equal(edited.points.length, blob.points.length + 1);
    for (const t of [.2, .6, .9]) {
      const before = curvePoint(blob, 0, t);
      const after = t < .4 ? curvePoint(edited, 0, t / .4) : curvePoint(edited, 1, (t - .4) / .6);
      assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1e-10);
    }
  }
});
