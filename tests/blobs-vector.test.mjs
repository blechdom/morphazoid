import test from 'node:test';
import assert from 'node:assert/strict';
import { handles, curvePoint, insertPoint, removePoint, smoothPoint, nearestSegment } from '../src/instruments/blobs/vector.js';

const loop = () => ({ tool: 'pen', points: [
  { x: .2, y: .2, hx: .18, hy: -.09 },
  { x: .8, y: .25, hx: .1, hy: .2, inHx: -.12, inHy: -.18 },
  { x: .65, y: .8, hx: -.18, hy: .08 },
  { x: .2, y: .7, hx: -.12, hy: -.2, inHx: .2, inHy: .03 },
] });
const closePoint = (a, b, epsilon = 1e-12) => {
  assert.ok(Math.abs(a.x - b.x) < epsilon, `x: ${a.x} vs ${b.x}`);
  assert.ok(Math.abs(a.y - b.y) < epsilon, `y: ${a.y} vs ${b.y}`);
};

test('incoming handles preserve legacy mirroring and allow independent asymmetric curves', () => {
  assert.deepEqual(handles({ hx: .2, hy: -.1 }), { out: { x: .2, y: -.1 }, in: { x: -.2, y: .1 } });
  assert.deepEqual(handles({ hx: .2, hy: -.1, inHx: .03, inHy: -.08 }), { out: { x: .2, y: -.1 }, in: { x: .03, y: -.08 } });
  assert.deepEqual(handles({ hx: NaN, hy: Infinity, inHx: NaN }), { out: { x: 0, y: 0 }, in: { x: -0, y: -0 } });
});

test('cubic insertion exactly preserves both split pieces and every adjoining segment', () => {
  for (const segment of [0, 1, 3]) {
    const original = loop(), frozen = JSON.stringify(original), t = .371;
    const edited = insertPoint(original, segment, t);
    assert.equal(edited.points.length, 5);
    assert.equal(JSON.stringify(original), frozen);
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      closePoint(curvePoint(edited, segment, u), curvePoint(original, segment, u * t));
      closePoint(curvePoint(edited, segment + 1, u), curvePoint(original, segment, t + u * (1 - t)));
      for (let unaffected = 0; unaffected < original.points.length; unaffected++) {
        if (unaffected === segment) continue;
        closePoint(curvePoint(edited, unaffected + (unaffected > segment ? 1 : 0), u), curvePoint(original, unaffected, u));
      }
    }
  }
});

test('line insertion handles the closing edge without curving or moving old anchors', () => {
  const original = { tool: 'line', points: loop().points };
  const edited = insertPoint(original, 3, .25);
  assert.deepEqual(edited.points.slice(0, 4), original.points);
  assert.equal(edited.tool, 'line');
  closePoint(edited.points[4], { x: .2, y: .575 });
  closePoint(curvePoint(edited, 4, .5), curvePoint(original, 3, .625));
  assert.equal(insertPoint(original, 1, 0), null);
  assert.equal(insertPoint(original, 1, 1), null);
  assert.equal(insertPoint(original, 9, .5), null);
  assert.equal(insertPoint(original, 1, NaN), null);
  assert.equal(insertPoint({ ...original, points: Array.from({ length: 256 }, (_, i) => ({ x: i / 256, y: .5 })) }, 1, .5), null);
});

test('removal preserves remaining anchor data and the minimum closed-loop triangle', () => {
  const original = loop(), frozen = JSON.stringify(original), edited = removePoint(original, 1);
  assert.deepEqual(edited.points, [original.points[0], original.points[2], original.points[3]]);
  assert.equal(removePoint(edited, 0), null);
  assert.equal(removePoint(original, -1), null);
  edited.points[0].x = .3;
  assert.equal(JSON.stringify(original), frozen);
});

test('smooth and corner conversions leave other cubic handles intact and preserve straight segments', () => {
  const original = loop(), smooth = smoothPoint(original, 1), corner = smoothPoint(smooth, 1, false);
  assert.deepEqual(smooth.points[0], original.points[0]);
  assert.deepEqual(smooth.points[2], original.points[2]);
  closePoint(handles(smooth.points[1]).out, { x: .075, y: .1 });
  closePoint(handles(smooth.points[1]).in, { x: -.075, y: -.1 });
  closePoint(handles(corner.points[1]).out, { x: 0, y: 0 });
  closePoint(handles(corner.points[1]).in, { x: 0, y: 0 });
  const line = { ...original, tool: 'line' }, converted = smoothPoint(line, 1, false);
  assert.equal(converted.tool, 'pen');
  for (let segment = 0; segment < line.points.length; segment++) {
    closePoint(curvePoint(converted, segment, .5), curvePoint(line, segment, .5));
    closePoint(handles(converted.points[segment]).out, { x: 0, y: 0 });
  }
  assert.equal(smoothPoint(line, 99), null);
});

test('hit testing locates curved and closing segments after affine transforms', () => {
  const original = loop();
  const transform = point => ({ x: 300 + point.x * 800 + point.y * 170, y: 600 - point.y * 500 + point.x * 50 });
  for (const segment of [0, 1, 3]) {
    const t = .423, authored = curvePoint(original, segment, t), target = transform(authored);
    const nearest = nearestSegment(original, target, { transform, maxDistance: .02 });
    assert.equal(nearest.segment, segment);
    assert.ok(Math.abs(nearest.t - t) < 1e-5);
    closePoint(nearest.point, authored, 1e-5);
    assert.ok(nearest.distance < .01);
  }
  assert.equal(nearestSegment(original, { x: 99, y: 99 }), null);
  assert.equal(nearestSegment(original, { x: .2, y: .2 }, { transform: () => ({ x: NaN, y: 0 }) }), null);
  assert.equal(nearestSegment({ points: [] }, { x: .2, y: .2 }), null);
});

test('line hit testing returns an exact projection and respects transformed hit distance', () => {
  const original = { tool: 'line', points: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }] };
  const nearest = nearestSegment(original, { x: .46, y: .105 }, { maxDistance: .01 });
  assert.equal(nearest.segment, 0);
  closePoint(nearest.point, { x: .46, y: .1 });
  assert.ok(Math.abs(nearest.distance - .005) < 1e-12);
  assert.equal(nearestSegment(original, { x: .46, y: .105 }, { maxDistance: .004 }), null);
});
