import test from 'node:test';
import assert from 'node:assert/strict';
import { FORM_IDS, createBlobForm } from '../src/instruments/blobs/forms.js';
import { buildPath, cleanPoints, contourVertices } from '../src/instruments/blobs/model.js';
import { curvePoint, insertPoint } from '../src/instruments/blobs/vector.js';

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
function controls(blob) {
  return blob.points.flatMap(p => [p, { x: p.x + p.hx, y: p.y + p.hy }, { x: p.x + p.inHx, y: p.y + p.inHy }]);
}
function profile(blob) {
  const { samples } = buildPath(blob);
  return Array.from({ length: 64 }, (_, i) => ({ x: samples[i * 8], y: samples[i * 8 + 1] }));
}
function directedDistance(a, b) {
  return Math.max(...a.map(p => Math.min(...b.map(q => Math.hypot(p.x - q.x, p.y - q.y)))));
}
function area(points) {
  return Math.abs(points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length];
    return sum + p.x * next.y - p.y * next.x;
  }, 0)) / 2;
}
function convexHull(points) {
  const sorted = points.toSorted((a, b) => a.x - b.x || a.y - b.y);
  const half = source => {
    const result = [];
    for (const p of source) {
      while (result.length >= 2 && cross(result.at(-2), result.at(-1), p) <= 0) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.toReversed())];
}

test('authored forms remain bounded closed editable paths through variant and detail extremes', () => {
  assert.ok(FORM_IDS.length >= 18);
  assert.equal(new Set(FORM_IDS).size, FORM_IDS.length);
  const tools = new Set();
  for (const kind of FORM_IDS) for (const variant of [0, .5, 1]) for (const detail of [3, 5, 8]) {
    const blob = createBlobForm(kind, { variant, detail });
    tools.add(blob.tool);
    assert.ok(blob.points.length >= 3 && blob.points.length <= 40, `${kind}: modest editable anchor count`);
    assert.deepEqual(cleanPoints(blob.points), blob.points, `${kind}: normalization must not clip or remove anchors`);
    assert.deepEqual(JSON.parse(JSON.stringify(blob)), blob, `${kind}: browser persistence keeps the exact contour`);
    assert.ok(buildPath(blob)?.length > .06, `${kind}: playhead has a usable closed circuit`);
    for (const p of controls(blob)) {
      assert.ok(p.x >= .175 - 1e-9 && p.x <= .825 + 1e-9, `${kind}: control x`);
      assert.ok(p.y >= .175 - 1e-9 && p.y <= .825 + 1e-9, `${kind}: control y`);
    }
    const seam = curvePoint(blob, blob.points.length - 1, 1);
    near(seam.x, blob.points[0].x);
    near(seam.y, blob.points[0].y);
    assert.ok(Math.hypot(blob.points[0].x - blob.points.at(-1).x, blob.points[0].y - blob.points.at(-1).y) > .001);
  }
  assert.deepEqual([...tools].sort(), ['line', 'pen', 'pencil']);
});

test('ordinary form variations keep simple connected outlines without tiny crossing loops', () => {
  for (const kind of FORM_IDS) for (const variant of [0, .5, 1]) for (const detail of [3, 5, 8]) {
    const points = contourVertices(createBlobForm(kind, { variant, detail }));
    for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const a = points[i], b = points[(i + 1) % points.length];
      const c = points[j], d = points[(j + 1) % points.length];
      const intersects = cross(a, b, c) * cross(a, b, d) < -1e-13 && cross(c, d, a) * cross(c, d, b) < -1e-13;
      assert.equal(intersects, false, `${kind}, variant ${variant}, detail ${detail}: segments ${i} and ${j}`);
    }
  }
});

test('families have distinct sampled silhouettes rather than the same radial loop with new labels', () => {
  const profiles = FORM_IDS.map(kind => ({ kind, points: profile(createBlobForm(kind)) }));
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    const a = profiles[i], b = profiles[j];
    const distance = Math.max(directedDistance(a.points, b.points), directedDistance(b.points, a.points));
    assert.ok(distance > .035, `${a.kind} and ${b.kind} need visibly distinct boundaries`);
  }
  for (const kind of ['crescent', 'spiral', 'ribbon', 'comb', 'stairs']) {
    const points = contourVertices(createBlobForm(kind));
    assert.ok(area(points) / area(convexHull(points)) < .68, `${kind} needs its substantial cutout or folding return`);
  }
});

test('simple forms and bilateral creatures preserve reflected anchors and Bezier handles exactly', () => {
  const simple = ['oval', 'eye', 'diamond', 'hourglass'];
  const bilateral = [...simple, 'beetle', 'moth', 'tick', 'squid'];
  for (const kind of bilateral) for (const variant of [0, .5, 1]) {
    const blob = createBlobForm(kind, { variant, x: .47, y: .52, width: .62, height: .74 });
    for (const axis of simple.includes(kind) ? ['vertical', 'horizontal'] : ['vertical']) {
      for (const p of blob.points) {
        const x = axis === 'vertical' ? .94 - p.x : p.x;
        const y = axis === 'horizontal' ? 1.04 - p.y : p.y;
        const partner = blob.points.find(q => Math.hypot(q.x - x, q.y - y) < 1e-9);
        assert.ok(partner, `${kind}: ${axis} anchor reflection`);
        // Reflection reverses winding, exchanging incoming and outgoing handles.
        near(partner.hx, p.inHx * (axis === 'vertical' ? -1 : 1));
        near(partner.hy, p.inHy * (axis === 'horizontal' ? -1 : 1));
        near(partner.inHx, p.hx * (axis === 'vertical' ? -1 : 1));
        near(partner.inHy, p.hy * (axis === 'horizontal' ? -1 : 1));
      }
    }
  }
});

test('rotating tall forms preserves proportions and off-center placement safely fits the stage', () => {
  const upright = createBlobForm('ribbon', { width: .24, height: .72 });
  const sideways = createBlobForm('ribbon', { width: .24, height: .72, rotation: Math.PI / 2 });
  for (let i = 0; i < upright.points.length; i++) {
    const p = upright.points[i], q = sideways.points[i];
    near(q.x, 1 - p.y); near(q.y, p.x);
    near(q.hx, -p.hy); near(q.hy, p.hx);
    near(q.inHx, -p.inHy); near(q.inHy, p.inHx);
  }
  for (const kind of FORM_IDS) for (const x of [.08, .5, .92]) {
    const blob = createBlobForm(kind, { x, y: 1 - x, width: .94, height: .94, rotation: 2.1 });
    for (const p of controls(blob)) {
      assert.ok(p.x >= .03 - 1e-9 && p.x <= .97 + 1e-9, `${kind}: stage x`);
      assert.ok(p.y >= .03 - 1e-9 && p.y <= .97 + 1e-9, `${kind}: stage y`);
    }
    assert.deepEqual(cleanPoints(blob.points), blob.points);
  }
});

test('form points support exact ordinary vector insertion, including their closing segments', () => {
  for (const kind of FORM_IDS) {
    const original = createBlobForm(kind);
    const segment = original.points.length - 1, t = .37;
    const edited = insertPoint(original, segment, t);
    assert.equal(edited.points.length, original.points.length + 1);
    for (const position of [.1, .3, .6, .9]) {
      const before = curvePoint(original, segment, position);
      const after = position < t ? curvePoint(edited, segment, position / t)
        : curvePoint(edited, segment + 1, (position - t) / (1 - t));
      near(before.x, after.x); near(before.y, after.y);
    }
  }
});

test('form generation is deterministic, independently editable, and bounded for malformed options', () => {
  for (const kind of FORM_IDS) {
    const original = createBlobForm(kind);
    const copy = createBlobForm(kind);
    assert.deepEqual(copy, original);
    copy.points[0].x = 0;
    assert.notEqual(copy.points[0].x, original.points[0].x);
    const malformed = createBlobForm(kind, { x: Infinity, y: NaN, width: -10, height: 10, rotation: Infinity, variant: NaN, detail: 100 });
    assert.ok(buildPath(malformed));
    assert.ok(controls(malformed).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
  assert.deepEqual(createBlobForm('unknown'), createBlobForm('amoeba'));
});
