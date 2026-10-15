import test from "node:test";
import assert from "node:assert/strict";
import { buildGeometry, horizontalProbe, nearestPoint, probeHits, rayProbe, resampleColumns, traceAt, verticalProbe } from "../src/instruments/graphonic-calculator/geometry.js";
import { analyzeState, applySnapshot, createState, ensureSliders } from "../src/instruments/graphonic-calculator/model.js";
import { createCamera } from "../src/instruments/graphonic-calculator/camera.js";

const WIDTH = 800, HEIGHT = 500;
const VIEW = { xMin: -5, xMax: 5, yMin: -3, yMax: 3 };
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

function scene(texts, view = VIEW) {
  const snapshot = { rows: texts.map((text) => ({ text, color: "#61e9ce", visible: true, slider: null, range: null })), view, settings: { angle: "radians", sweepSeconds: 8, traceOctaves: 2 } };
  let state = applySnapshot(snapshot);
  let analysis = analyzeState(state);
  state = ensureSliders(state, analysis);
  analysis = analyzeState(state);
  return { state, analysis, geometry: buildGeometry(analysis, state, view, WIDTH, HEIGHT) };
}

test("every plot kind produces world-space drawables inside the view", () => {
  const { geometry } = scene(["y = x^2", "x^2 + y^2 = 4", "r = cos(3θ)", "(cos t, sin t)", "(1, 2)", "y < x", "a = 1", "(a, 2)", "x = y^2", "2 + 2", ""]);
  const kinds = geometry.map((item) => item.kind);
  assert.deepEqual(kinds, ["explicit-y", "implicit", "polar", "parametric", "point", "inequality", "point", "explicit-x"]);
  const [parabola, circle, rose, unit, point, region, draggable, sideways] = geometry;
  assert.ok(parabola.segments.length >= 1);
  for (const segment of parabola.segments) for (let i = 0; i < segment.length; i += 2) { assert.ok(segment[i] >= VIEW.xMin - 1e-9 && segment[i] <= VIEW.xMax + 1e-9); close(segment[i + 1], segment[i] ** 2, 1e-9); }
  assert.equal(circle.segments.length, 1, "marching squares output is stitched into one loop");
  assert.ok(circle.segments[0].length > 100);
  for (const segment of circle.segments) for (let i = 0; i < segment.length; i += 2) close(Math.hypot(segment[i], segment[i + 1]), 2, 0.06);
  assert.ok(rose.segments.length >= 1);
  const roseRadii = rose.segments.flatMap((segment) => Array.from({ length: segment.length / 2 }, (_, i) => Math.hypot(segment[2 * i], segment[2 * i + 1])));
  assert.ok(Math.max(...roseRadii) <= 1 + 1e-6 && Math.max(...roseRadii) > 0.99);
  assert.equal(unit.segments.length, 1);
  close(unit.segments[0][0], 1, 1e-9); close(unit.segments[0][1], 0, 1e-9);
  assert.deepEqual(point.points, [[1, 2]]);
  assert.deepEqual(point.draggable, [null, null]);
  assert.ok(region.fills.length >= 1);
  assert.equal(region.strict, true);
  assert.deepEqual(draggable.points, [[1, 2]]);
  assert.deepEqual(draggable.draggable, ["a", null]);
  for (const segment of sideways.segments) for (let i = 0; i < segment.length; i += 2) close(segment[i], segment[i + 1] ** 2, 1e-9);
});

test("hidden rows, errors and empty rows draw nothing", () => {
  const { state, analysis } = scene(["y = x^2", "y = q", ""]);
  const hidden = { ...state, rows: state.rows.map((row, index) => (index === 0 ? { ...row, visible: false } : row)) };
  assert.deepEqual(buildGeometry(analysis, hidden, VIEW, WIDTH, HEIGHT), []);
  assert.deepEqual(buildGeometry(analysis, createState(), VIEW, WIDTH, HEIGHT), []);
});

test("traceAt reports every crossing of the playhead and resampling yields uniform columns", () => {
  const { geometry } = scene(["y = x^2", "x^2 + y^2 = 4", "y = 1/x", "(3, 3)"]);
  const hits = traceAt(geometry, 1);
  assert.equal(hits.length, 3);
  close(hits[0].ys[0], 1, 1e-9);
  assert.equal(hits[1].ys.length, 2);
  close(hits[1].ys[0], -Math.sqrt(3), 0.05); close(hits[1].ys[1], Math.sqrt(3), 0.05);
  close(hits[2].ys[0], 1, 1e-9);
  const atZero = traceAt(geometry, 0);
  assert.equal(atZero.find((hit) => hit.id === geometry[2].id), undefined, "1/x is undefined at the pole");
  const outside = traceAt(geometry, 4.5);
  assert.equal(outside.find((hit) => hit.id === geometry[1].id), undefined, "the circle has no points beyond its radius");
  const columns = resampleColumns(geometry[0], -2, 2, 5);
  assert.deepEqual([...columns].map((value) => Number(value.toFixed(9))), [4, 1, 0, 1, 4]);
  assert.ok(Number.isNaN(resampleColumns(geometry[2], -1, 1, 3)[1]));
});

test("nearestPoint finds draggable points and curve vertices within the pixel radius", () => {
  const { geometry } = scene(["a = 1", "b = 2", "(a, b)", "y = x"]);
  const camera = createCamera(VIEW, WIDTH, HEIGHT);
  const [px, py] = camera.toPixel(1, 2);
  const found = nearestPoint(geometry, camera, px + 3, py - 3, 14);
  assert.equal(found.id, geometry[0].id);
  assert.deepEqual(found.draggable, ["a", "b"]);
  const [lx, ly] = camera.toPixel(-2, -2);
  const line = nearestPoint(geometry, camera, lx, ly, 14);
  assert.equal(line.id, geometry[1].id);
  close(line.x, -2, 0.05);
  assert.equal(nearestPoint(geometry, camera, 5, 5, 4), null);
});

test("probes intersect drawables along vertical, horizontal and radial lines", () => {
  const { geometry } = scene(["y = x^2", "x^2 + y^2 = 4", "(1, 2)", "x = y^2"]);
  const [parabola, circle, point, sideways] = geometry;
  const vertical = probeHits(geometry, verticalProbe(1, VIEW));
  assert.equal(vertical.find((hit) => hit.id === parabola.id).hits[0].y, 1);
  const circleVertical = vertical.find((hit) => hit.id === circle.id).hits.map((hit) => hit.y);
  assert.equal(circleVertical.length, 2);
  close(circleVertical[0], -Math.sqrt(3), 0.05); close(circleVertical[1], Math.sqrt(3), 0.05);
  assert.deepEqual(vertical.find((hit) => hit.id === point.id).hits.map((hit) => [hit.x, hit.y]), [[1, 2]]);
  for (const hit of vertical.flatMap((entry) => entry.hits)) { close(hit.x, 1, 1e-9); close(hit.s, hit.y - VIEW.yMin, 1e-9); }
  const horizontal = probeHits(geometry, horizontalProbe(1, VIEW));
  const parabolaRow = horizontal.find((hit) => hit.id === parabola.id).hits.map((hit) => hit.x);
  assert.equal(parabolaRow.length, 2); close(parabolaRow[0], -1, 0.02); close(parabolaRow[1], 1, 0.02);
  close(horizontal.find((hit) => hit.id === sideways.id).hits[0].x, 1, 1e-9);
  const ray = probeHits(geometry, rayProbe(0, 0, Math.PI / 4, 10));
  const circleRay = ray.find((hit) => hit.id === circle.id).hits;
  assert.equal(circleRay.length, 1, `a ray leaves the circle once: ${JSON.stringify(circleRay)}`); close(circleRay[0].s, 2, 0.06); close(circleRay[0].x, Math.SQRT2, 0.06);
  const parabolaRay = ray.find((hit) => hit.id === parabola.id).hits;
  assert.equal(parabolaRay.length, 2, "the parabola passes through the ray's origin and through (1, 1)");
  close(parabolaRay[0].s, 0, 1e-6); close(parabolaRay[1].x, 1, 1e-6); close(parabolaRay[1].s, Math.SQRT2, 1e-6);
  assert.equal(ray.find((hit) => hit.id === point.id), undefined, "a point off the ray is not hit");
  assert.deepEqual(probeHits(geometry, rayProbe(0, 0, 0, NaN)), []);
  assert.deepEqual(probeHits(geometry, { x0: 0, y0: 0, dx: 1, dy: 0, length: 0 }), []);
  const hits = probeHits(geometry, verticalProbe(1, VIEW)).flatMap((entry) => entry.hits.map((hit) => hit.s));
  assert.deepEqual(hits, [...hits].sort((a, b) => a - b).filter((value, index, array) => index === 0 || value !== array[index - 1]).length === hits.length ? hits : null);
});
