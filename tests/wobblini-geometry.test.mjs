import assert from "node:assert/strict";
import test from "node:test";
import { pointsFromDecks, patchesFromPoints, centroid, transformPoints, withPoint,
  octagonPoints, centerPans } from "../src/instruments/wobblini/wobblini-geometry-model.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≈ ${expected}`);
const distances = points => points.map((point, i) => Math.hypot(point.x - points[(i + 1) % points.length].x,
  point.y - points[(i + 1) % points.length].y));

test("Wobblini geometry round-trips the current eight-deck mix without arranging it", () => {
  const decks = Array.from({ length: 8 }, (_, id) => ({ id, pan: id / 3.5 - 1, gain: id / 7, rate: 1.25, playing: true }));
  const original = structuredClone(decks), points = pointsFromDecks(decks), patches = patchesFromPoints(points);
  for (const [i, patch] of patches.entries()) {
    assert.deepEqual(Object.keys(patch), ["id", "pan", "gain"]);
    assert.equal(patch.id, i); near(patch.pan, decks[i].pan); near(patch.gain, decks[i].gain);
    near(points[i].y, 1 - 2 * decks[i].gain);
  }
  assert.deepEqual(decks, original);
  const coincident = pointsFromDecks(decks.map(deck => ({ ...deck, pan: 0, gain: 0.7 })));
  assert.ok(coincident.every(point => point.x === 0 && point.y === 1 - 2 * 0.7));
  assert.notDeepEqual(coincident, octagonPoints(), "arrangement is an explicit action");
});

test("Wobblini geometry maps left/right to pan and upward/downward to louder/quieter", () => {
  const points = [{ id: 3, x: 0, y: 0 }, { id: 6, x: 0.2, y: 0.2 }];
  const moved = patchesFromPoints(transformPoints(points, { translateX: -0.3, translateY: -0.4 }));
  near(moved[0].pan, -0.3); near(moved[0].gain, 0.7);
  near(moved[1].pan, -0.1); near(moved[1].gain, 0.6);
  const limits = patchesFromPoints([{ id: 0, x: -1, y: -1 }, { id: 7, x: 1, y: 1 }]);
  assert.deepEqual(limits, [{ id: 0, pan: -1, gain: 1 }, { id: 7, pan: 1, gain: 0 }]);
});

test("Wobblini rotation preserves distances and centroid before clipping and supports an explicit pivot", () => {
  const points = [{ id: 5, x: -0.2, y: -0.2 }, { id: 1, x: 0.4, y: -0.2 }, { id: 7, x: 0.1, y: 0.4 }];
  const before = structuredClone(points), center = centroid(points);
  const rotated = transformPoints(points, { rotation: Math.PI / 2 });
  distances(rotated).forEach((distance, i) => near(distance, distances(points)[i]));
  near(centroid(rotated).x, center.x); near(centroid(rotated).y, center.y);
  assert.deepEqual(rotated.map(point => point.id), [5, 1, 7]);
  const restored = transformPoints(rotated, { rotation: -Math.PI / 2 });
  restored.forEach((point, i) => { near(point.x, points[i].x); near(point.y, points[i].y); });
  const origin = transformPoints([{ id: 0, x: 0.5, y: 0 }], { pivot: { x: 0, y: 0 }, rotation: Math.PI / 2 });
  near(origin[0].x, 0); near(origin[0].y, 0.5); assert.deepEqual(points, before);
});

test("Wobblini stretch then rotation then translation has predictable independent pan/gain effects", () => {
  const points = [{ id: 0, x: -0.2, y: -0.1 }, { id: 1, x: 0.2, y: 0.1 }];
  const result = transformPoints(points, { scaleX: 2, scaleY: 0.5, rotation: Math.PI / 2, translateX: 0.1, translateY: -0.2 });
  near(result[0].x, 0.15); near(result[0].y, -0.6);
  near(result[1].x, 0.05); near(result[1].y, 0.2);
  const reflected = transformPoints(points, { scaleX: -1, scaleY: 0 });
  near(reflected[0].x, 0.2); near(reflected[1].x, -0.2); near(reflected[0].y, 0); near(reflected[1].y, 0);
});

test("Wobblini gesture snapshots recover from clipped extremes and support exact undo without mutation", () => {
  const baseline = octagonPoints().map(Object.freeze); Object.freeze(baseline);
  const original = structuredClone(baseline);
  const outside = transformPoints(baseline, { translateX: 2, translateY: -2, scaleX: 16, scaleY: 16 });
  assert.ok(outside.some(point => Math.abs(point.x) === 1 || Math.abs(point.y) === 1));
  const returned = transformPoints(baseline);
  returned.forEach((point, i) => { near(point.x, baseline[i].x); near(point.y, baseline[i].y); });
  assert.deepEqual(baseline, original);
  const undo = patchesFromPoints(baseline);
  assert.ok(undo.every(patch => patch.gain >= 0.35 && patch.gain <= 0.85));
});

test("Wobblini point pulling affects only its deck, while centering pans retains all gain coordinates", () => {
  const points = octagonPoints(), pulled = withPoint(points, 4, { x: 0.37, y: -0.45 });
  for (let i = 0; i < 8; i++) if (i !== 4) assert.deepEqual(pulled[i], points[i]);
  assert.deepEqual(pulled[4], { id: 4, x: 0.37, y: -0.45 });
  const patch = patchesFromPoints(pulled)[4]; near(patch.pan, 0.37); near(patch.gain, 0.725);
  assert.deepEqual(withPoint(points, 99, { x: 0, y: 0 }), points);
  const centered = centerPans(pulled);
  centered.forEach((point, i) => { assert.equal(point.x, 0); assert.equal(point.y, pulled[i].y); });
  assert.equal(pulled[4].x, 0.37);
});

test("Wobblini explicit octagon has eight distinct numbered decks and moderate gain/pan defaults", () => {
  const points = octagonPoints(); assert.equal(points.length, 8);
  assert.deepEqual(points.map(point => point.id), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(points.map(point => `${point.x},${point.y}`)).size, 8);
  near(centroid(points).x, 0); near(centroid(points).y, -0.2);
  const patches = patchesFromPoints(points);
  near(Math.min(...patches.map(patch => patch.gain)), 0.35); near(Math.max(...patches.map(patch => patch.gain)), 0.85);
  near(Math.min(...patches.map(patch => patch.pan)), -0.8); near(Math.max(...patches.map(patch => patch.pan)), 0.8);
  points[0].x = -1; assert.notEqual(octagonPoints()[0].x, -1);
});

test("Wobblini geometry bounds malformed input and transforms without manufacturing duplicate deck identities", () => {
  assert.deepEqual(centroid([]), { x: 0, y: 0 }); assert.deepEqual(transformPoints(null), []);
  const points = [{ id: 7, x: Infinity, y: NaN }, { id: 7, x: 0.5, y: 0.5 }, { id: -1, x: 1, y: 1 },
    { id: 8, x: 1, y: 1 }, null, { id: 2, x: -99, y: 99 }];
  const transformed = transformPoints(points, { translateX: 1e300, translateY: -1e300, scaleX: 1e300, scaleY: -1e300,
    rotation: Infinity, pivot: { x: NaN, y: Infinity } });
  assert.deepEqual(transformed.map(point => point.id), [7, 2]);
  assert.ok(transformed.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1));
  assert.ok(patchesFromPoints(transformed).every(patch => Math.abs(patch.pan) <= 1 && patch.gain >= 0 && patch.gain <= 1));
  const baseline = octagonPoints();
  assert.deepEqual(withPoint(baseline, 1, { x: NaN, y: Infinity }), baseline);
  assert.equal(pointsFromDecks(Array.from({ length: 100 }, () => ({ pan: 0, gain: 0.7 }))).length, 8);
});
