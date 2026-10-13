import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMotif, closestMotifCenter, pickMotifContour, describeMotif, compareMotifs, findMotifs, sampleMotifDescriptor,
  MOTIF_SAMPLE_LIMIT, MOTIF_CAPTURE_LIMIT, MOTIF_SEARCH_LIMIT } from '../src/instruments/vector-fractals/motif-model.js';

const TAU = 2 * Math.PI;
const motif = [[0, 0], [.4, .08], [.6, .55], [.48, .78], [.18, .82], [.08, .61], [.21, .5], [.32, .61], [.8, .3], [1, .4]];
const snap = (points, closed = false) => ({ points: Float64Array.from(points.flat()), closed });
const curve = (fn, n = 1025) => Array.from({ length: n }, (_, i) => fn(i / (n - 1)));
const rms = a => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / a.length);
function result(paths, closed = paths.map(() => false), view = { x: 0, y: 0, width: 1, aspect: 1 }) {
  const offsets = [0]; for (const path of paths) offsets.push(offsets.at(-1) + path.length);
  return { points: Float64Array.from(paths.flat(2)), offsets: Uint32Array.from(offsets), closed: Uint8Array.from(closed, Number), view, domain: 'julia', cReal: -.12, cImag: .74, depth: 14 };
}
function transform(points, { scale = 1, angle = 0, x = 0, y = 0, mirror = false } = {}) {
  return points.map(([px, py]) => { py *= mirror ? -1 : 1; return [x + scale * (Math.cos(angle) * px - Math.sin(angle) * py), y + scale * (Math.sin(angle) * px + Math.cos(angle) * py)]; });
}
function subdivisions(points, n = 30, closed = false) {
  const dense = [];
  for (let i = 0; i < points.length - Number(!closed); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < n; j++) dense.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  if (!closed) dense.push(points.at(-1));
  return dense;
}
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function nearArrays(a, b, tolerance = 1e-8) { assert.equal(a.length, b.length); for (let i = 0; i < a.length; i++) near(a[i], b[i], tolerance); }

test('capturing a motif detaches world coordinates and stores original contour correspondence', () => {
  const source = result([[[0, 0], [1, 0], [1, 1]]], [false], { x: -2, y: .4, width: 3, aspect: 1 });
  const a = captureMotif(source, 0, { center: .1, span: .5, samples: 32 });
  near(a.points[0], -2); near(a.points[1], .4); near(a.points.at(-2), 1); near(a.points.at(-1), .4);
  near(a.source.start, 0); near(a.source.center, .25); near(a.source.span, .5); assert.equal(a.closed, false);
  near(a.sourcePositions[0], 0); near(a.sourcePositions.at(-1), .5);
  near(closestMotifCenter(source, 0, { x: 1, y: 1.9 }), .75);
  source.points.fill(99); source.view.x = 99;
  near(a.points[0], -2); near(a.source.view.x, -2);
});

test('closed captures preserve a crossing-seam excerpt without an artificial chord', () => {
  const circle = curve(u => [Math.cos(TAU * u), Math.sin(TAU * u)]);
  const source = result([circle], [true]);
  const a = captureMotif(source, 0, { center: 0, span: .2, samples: 512 });
  assert.equal(a.closed, false); near(a.sourcePositions[0], -.1); near(a.sourcePositions.at(-1), .1);
  const d = describeMotif(a);
  near(d.turn.at(-1), TAU * .2, .04);
  assert.ok(d.rawLength < 1.3);
  const whole = captureMotif(source, 0, { center: .5, span: 1 });
  assert.equal(whole.closed, true); near(describeMotif(whole).turn.at(-1), TAU, 1e-6);
  assert.equal(describeMotif(whole).totalTurn, TAU);
});

test('picking a displayed contour preserves its level and the clicked arc-length position', () => {
  const layers = [0, .04, .08].map((height, i) => ({
    ...result([[[0, height], [.4, height], [1, height]]]), depth: 4 + i * 4,
  }));
  // A tiny fine strand is near the broad outline but must not steal its click.
  layers[2] = { ...result([[[0, .08], [1, .08]], [[.799, .002], [.801, .002]]]), depth: 12 };
  for (let i = 0; i < layers.length; i++) {
    const point = { x: .8, y: i * .04 };
    const picked = pickMotifContour(layers, point, .03);
    assert.equal(picked.layerIndex, i); assert.equal(picked.pathIndex, 0);
    assert.equal(picked.result, layers[i]); near(picked.center, .8);
    const captured = captureMotif(picked.result, picked.pathIndex, { center: picked.center, span: .1, samples: 65 });
    assert.equal(captured.source.depth, 4 + i * 4);
    near(captured.points[64], point.x); near(captured.points[65], point.y);
  }
});

test('contour picking uses world distance across views and includes closed seams', () => {
  const broad = result([[[0, 0], [1, 0], [1, 1], [0, 1]]], [true], { x: -2, y: 1, width: 2, aspect: 1 });
  const fine = result([[[0, 0], [1, 0]]], [false], { x: -3, y: 2.6, width: 2, aspect: 1 });
  const picked = pickMotifContour([broad, null, fine], { x: -2.01, y: 2 }, .02);
  assert.equal(picked.result, broad); near(picked.center, .875);
  assert.equal(pickMotifContour([broad, fine], { x: -2.1, y: 2 }, .02), null);
});

test('malformed and empty curves cannot create a capture hit', () => {
  const invalid = result([[[0, 0], [NaN, 1]]]);
  const repeated = result([[[0, 0], [0, 0]]]);
  assert.equal(pickMotifContour([invalid, repeated, null], { x: 0, y: 0 }, .1), null);
  assert.equal(pickMotifContour([], { x: 0, y: 0 }, .1), null);
  assert.equal(pickMotifContour([result([motif])], { x: NaN, y: 0 }, .1), null);
});

test('turning fingerprints survive translation, rotation, uniform scale and source subdivisions', () => {
  const a = snap(motif), b = snap(transform(subdivisions(motif, 13), { scale: .017, angle: 1.29, x: -1.73, y: .14 }));
  const comparison = compareMotifs(a, b);
  assert.ok(comparison.error < 1e-10, comparison.error);
  assert.ok(comparison.geometryError < 1e-10); assert.ok(comparison.turnError < 1e-10);
  near(comparison.similarity, 1); nearArrays(comparison.a.turn, comparison.b.turn, 1e-10);
  assert.equal(comparison.stability.label, 'stable across smoothing');
});

test('nonuniform resampling of a smooth curve converges at an explicit observation scale', () => {
  const fn = u => [u + .08 * Math.sin(7 * Math.PI * u), .3 * Math.sin(3 * Math.PI * u)];
  const a = snap(curve(fn));
  const b = snap(curve(u => fn(u ** 2), 289));
  const comparison = compareMotifs(a, b, { detail: .025 });
  assert.ok(comparison.geometryError < .001, comparison.geometryError);
  assert.ok(comparison.turnError < .001, comparison.turnError);
});

test('mirror and reverse are explicit options and return usable transformed audio and physical source paths', () => {
  const a = snap(motif), mirrored = snap(transform(motif, { mirror: true }));
  const noMirror = compareMotifs(a, mirrored), yesMirror = compareMotifs(a, mirrored, { mirror: true });
  assert.ok(noMirror.error > .4); assert.ok(yesMirror.error < 1e-10); assert.equal(yesMirror.mirrored, true);
  nearArrays(yesMirror.a.turn, yesMirror.b.turn, 1e-10);
  for (let i = 0; i < yesMirror.b.samples; i++) near(yesMirror.b.sourcePoints[i * 2 + 1], -yesMirror.a.sourcePoints[i * 2 + 1]);
  const backwards = snap(motif.toReversed()), comparison = compareMotifs(a, backwards, { reverse: true });
  assert.equal(comparison.reversed, true); assert.ok(comparison.error < 1e-10);
  nearArrays(comparison.a.turn, comparison.b.turn, 1e-10);
  nearArrays(comparison.a.sourcePoints, comparison.b.sourcePoints, 1e-10);
  const before = sampleMotifDescriptor(comparison.b, 0), after = sampleMotifDescriptor(comparison.b, 1);
  near(before.originalPhase, 1); near(after.originalPhase, 0);
  near(before.sourcePosition, 1); near(after.sourcePosition, 0);
  near(before.sourceT, 0); near(after.sourceT, 1);
});

test('closed-loop start is aligned independently of overall geometric rotation', () => {
  const polygon = [[0, 0], [1, 0], [.9, .2], [1.1, .8], [.3, 1], [-.1, .4]];
  const a = snap(polygon, true), b = snap(transform([...polygon.slice(2), ...polygon.slice(0, 2)], { angle: .81 }), true);
  const comparison = compareMotifs(a, b, { samples: 256 });
  assert.ok(comparison.error < .035, comparison.error); assert.ok(comparison.shift > 0);
  near(comparison.b.turn.at(-1), TAU, 1e-6);
  near(comparison.b.sourceT[0], 0); near(comparison.b.sourceT.at(-1), 1);
});

test('equal corner angles do not confuse a square with a long rectangle', () => {
  const square = snap([[0, 0], [1, 0], [1, 1], [0, 1]], true);
  const rectangle = snap([[0, 0], [4, 0], [4, 1], [0, 1]], true);
  const comparison = compareMotifs(square, rectangle, { elastic: .15 });
  near(comparison.a.turn.at(-1), TAU); near(comparison.b.turn.at(-1), TAU);
  assert.ok(comparison.geometryError > .2, comparison.geometryError);
  assert.ok(comparison.error > .25); assert.ok(comparison.similarity < .5);
});

test('broad and detail turn bands sum to the fine fingerprint at corresponding source positions', () => {
  const points = curve(u => [u, .2 * Math.sin(TAU * u) + .006 * Math.sin(60 * Math.PI * u)]);
  const fine = describeMotif(snap(points), { detail: .004 }), broad = describeMotif(snap(points), { detail: .08 });
  assert.ok(broad.length < fine.length);
  for (let i = 0; i < fine.samples; i++) near(fine.bands[0][i] + fine.bands[1][i] + fine.bands[2][i], fine.turn[i]);
  assert.ok(rms(fine.bands[2]) > .02);
  for (let i = 0; i <= 10; i++) {
    const point = sampleMotifDescriptor(fine, i / 10, { timing: 'original' });
    near(point.sourceT, i / 10);
    assert.ok(Number.isFinite(point.turn));
  }
});

test('elastic matching is monotone, endpoint fixed, bounded and retains geometric error', () => {
  const a = snap(motif), b = snap(motif.map(([x, y]) => [x * (1 + .12 * Math.sin(3 * x)), y]));
  const strict = compareMotifs(a, b), elastic = compareMotifs(a, b, { elastic: .1 });
  assert.ok(elastic.error <= strict.error + 1e-12);
  near(elastic.correspondence[0], 0); near(elastic.correspondence.at(-1), 1);
  for (let i = 1; i < elastic.correspondence.length; i++) {
    assert.ok(elastic.correspondence[i] > elastic.correspondence[i - 1]);
    assert.ok(Math.abs(elastic.correspondence[i] - i / (elastic.correspondence.length - 1)) <= .1 + 1e-8);
  }
  assert.ok(elastic.geometryError > .001);
});

test('search recognizes copies across paths and sizes, excludes self/overlap, and obeys budgets', () => {
  const exact = subdivisions(motif), duplicate = transform(exact, { scale: .3, angle: 1.1, x: 2 });
  const distractor = curve(u => [u + 4, .04 * Math.sin(8 * u)]);
  const geometry = result([exact, duplicate, distractor]);
  const reference = captureMotif(geometry, 0, { span: 1, center: .5, samples: 512 });
  const found = findMotifs(reference, geometry, { spans: [.5, 1], samples: 64, maxCandidates: 72, limit: 6 });
  assert.ok(found.matches.length > 0); assert.ok(found.examined <= 72);
  assert.equal(found.matches[0].pathIndex, 1); assert.equal(found.matches[0].span, 1);
  assert.ok(found.matches[0].comparison.error < .003);
  assert.ok(found.matches.every(item => item.pathIndex !== 0));
  const tiny = findMotifs(reference, geometry, { maxCandidates: 1, samples: 32 });
  assert.equal(tiny.examined, 1); assert.equal(tiny.limited, true);
});

test('detail-sensitive resemblance is reported as a smoothing comparison, never grid-refinement confidence', () => {
  const a = snap(curve(u => [u, .2 * Math.sin(3 * Math.PI * u)]));
  const b = snap(curve(u => [u, .2 * Math.sin(3 * Math.PI * u) + .016 * Math.sin(50 * Math.PI * u)]));
  const comparison = compareMotifs(a, b, { detail: .002 });
  assert.ok(comparison.stability.coarseError < comparison.stability.fineError);
  assert.ok(comparison.stability.value < 1);
  assert.ok(!('confidence' in comparison));
});

test('hostile and degenerate inputs are rejected and user budgets are clamped', () => {
  for (const points of [[], [0, 0, 0, 0], [0, 0, NaN, 1], [0, 0, Infinity, 1]]) assert.equal(describeMotif({ points }), null);
  assert.equal(captureMotif({}, 0), null); assert.equal(closestMotifCenter({}, 0, { x: 0, y: 0 }), null);
  assert.equal(compareMotifs(snap(motif), snap([[0, 0], [0, 0]])), null);
  assert.equal(sampleMotifDescriptor(null), null);
  assert.equal(describeMotif(snap(motif), { samples: 1e10, detail: -1 }).samples, MOTIF_SAMPLE_LIMIT);
  assert.equal(captureMotif(result([motif]), 0, { samples: 1e10 }).points.length, MOTIF_CAPTURE_LIMIT * 2);
  assert.ok(MOTIF_SEARCH_LIMIT <= 384);
});

test('source correspondence follows the captured curve after spatial smoothing and remeasuring', () => {
  const circle = curve(u => [Math.cos(TAU * u), Math.sin(TAU * u)], 4097);
  const excerpt = captureMotif(result([circle], [true]), 0, { center: .03, span: .6, samples: 512 });
  const descriptor = describeMotif(excerpt, { detail: .08 });
  for (let i = 0; i <= 20; i++) {
    const p = sampleMotifDescriptor(descriptor, i / 20);
    near(p.x, Math.cos(TAU * p.sourcePosition), 6e-5);
    near(p.y, Math.sin(TAU * p.sourcePosition), 6e-5);
  }
});

test('a whole closed circle has no residual turn after removing its one revolution drift', () => {
  const circle = describeMotif(snap(curve(u => [Math.cos(TAU * u), Math.sin(TAU * u)]), true));
  assert.equal(circle.totalTurn, TAU);
  for (let i = 0; i < circle.samples; i++) near(circle.turn[i] - circle.totalTurn * i / (circle.samples - 1), 0, 1e-5);
});

test('resampling stability detects undersampled turn phrases even when the pair matches perfectly', () => {
  const smooth = snap(curve(u => [u, .2 * Math.sin(TAU * u)], 2049));
  const busy = snap(curve(u => [u, .018 * Math.sin(80 * Math.PI * u)], 2049));
  const stable = compareMotifs(smooth, smooth, { detail: .002, samples: 64 });
  const aliased = compareMotifs(busy, busy, { detail: .002, samples: 64 });
  near(stable.similarity, 1); near(aliased.similarity, 1);
  assert.ok(stable.samplingStability.value > .97, stable.samplingStability.value);
  assert.ok(aliased.samplingStability.value < .5, aliased.samplingStability.value);
  assert.equal(aliased.samplingStability.lowSamples, 32);
  assert.equal(aliased.samplingStability.highSamples, 128);
  assert.equal(aliased.samplingStability.label, 'strongly sampling-sensitive');
  assert.equal(aliased.samplingStability.basis, 'same captured geometry; not independent grid refinement');
  assert.ok(aliased.samplingStability.turnError > stable.samplingStability.turnError * 10);
});

test('resampling stability is distinct from changing the observation scale and can be omitted for bounded search', () => {
  const a = snap(motif);
  const measured = compareMotifs(a, a, { samples: MOTIF_SAMPLE_LIMIT });
  assert.equal(measured.samplingStability.lowSamples, MOTIF_SAMPLE_LIMIT / 2);
  assert.equal(measured.samplingStability.highSamples, MOTIF_SAMPLE_LIMIT);
  assert.equal(measured.stability.label, 'stable across smoothing');
  assert.notEqual(measured.samplingStability.label, measured.stability.label);
  assert.equal(compareMotifs(a, a, { samplingStability: false }).samplingStability, null);
});
