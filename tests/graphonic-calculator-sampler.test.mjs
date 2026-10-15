import test from "node:test";
import assert from "node:assert/strict";
import {
  marchingSquares, polylineLength, sampleExplicit, sampleParametric,
} from "../src/instruments/graphonic-calculator/sampler.js";

const TAU = Math.PI * 2;
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const pointCount = (segment) => segment.length / 2;
const first = (segment) => [segment[0], segment[1]];
const last = (segment) => [segment[segment.length - 2], segment[segment.length - 1]];

function everyPoint(segment, predicate) {
  for (let i = 0; i < segment.length; i += 2) {
    if (!predicate(segment[i], segment[i + 1], i / 2)) return false;
  }
  return true;
}

function strictlyIncreasing(segment) {
  for (let i = 2; i < segment.length; i += 2) {
    if (!(segment[i] > segment[i - 2])) return false;
  }
  return true;
}

const spansValue = (segment, value) => {
  const start = first(segment)[0];
  const end = last(segment)[0];
  return Math.min(start, end) < value && value < Math.max(start, end);
};

function segmentListLength(array) {
  let total = 0;
  for (let i = 0; i + 3 < array.length; i += 4) total += Math.hypot(array[i + 2] - array[i], array[i + 3] - array[i + 1]);
  return total;
}

const emptyResult = { segments: [], defined: 0 };

test("steep lines stay one connected segment and refined samples lie on the line", () => {
  const { segments, defined } = sampleExplicit((t) => 1000 * t, { from: -1, to: 1 });
  assert.equal(defined, 801);
  assert.equal(segments.length, 1);
  const [segment] = segments;
  assert.ok(segment instanceof Float64Array);
  assert.ok(pointCount(segment) > 801);
  assert.ok(strictlyIncreasing(segment));
  assert.ok(everyPoint(segment, (t, v) => Math.abs(v - 1000 * t) < 1e-9));
  assert.deepEqual(first(segment), [-1, -1000]);
  assert.deepEqual(last(segment), [1, 1000]);
});

test("floor yields one segment per unit step and no segment spans an integer", () => {
  const { segments, defined } = sampleExplicit(Math.floor, { from: -3, to: 3 });
  assert.equal(defined, 801);
  assert.equal(segments.length, 6);
  segments.forEach((segment, index) => {
    const value = -3 + index;
    assert.ok(everyPoint(segment, (t, v) => v === value && Math.floor(t) === value), `segment ${index} holds ${value}`);
    for (let k = -3; k <= 3; k++) assert.ok(!spansValue(segment, k), `segment ${index} spans ${k}`);
  });
  for (let i = 1; i < segments.length; i++) {
    const gap = first(segments[i])[0] - last(segments[i - 1])[0];
    assert.ok(gap > 0 && gap < 1e-3, `step gap ${gap}`);
  }
});

test("reciprocal splits at the pole whether or not a sample lands on it", () => {
  for (const count of [800, 801]) {
    const { segments } = sampleExplicit((t) => 1 / t, { from: -2, to: 2, count });
    assert.equal(segments.length, 2, `count ${count}`);
    const [left, right] = segments;
    assert.ok(everyPoint(left, (t) => t <= -1e-9), `count ${count} left`);
    assert.ok(everyPoint(right, (t) => t >= 1e-9), `count ${count} right`);
    assert.ok(last(left)[0] > -1e-4 && last(left)[1] < -1000, `count ${count} approaches 0⁻`);
    assert.ok(first(right)[0] < 1e-4 && first(right)[1] > 1000, `count ${count} approaches 0⁺`);
    assert.ok(everyPoint(left, (t, v) => Math.abs(v * t - 1) < 1e-9));
    assert.ok(everyPoint(right, (t, v) => Math.abs(v * t - 1) < 1e-9));
  }
});

const TAN_POLES = [-3 * Math.PI / 2, -Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2];

test("tangent splits exactly at its poles", () => {
  const narrow = sampleExplicit(Math.tan, { from: -4, to: 4 });
  assert.equal(narrow.segments.length, 3);
  const wide = sampleExplicit(Math.tan, { from: -6, to: 6 });
  assert.equal(wide.segments.length, 5);
  for (const segment of [...narrow.segments, ...wide.segments]) {
    for (const pole of TAN_POLES) assert.ok(!spansValue(segment, pole), `segment spans pole ${pole}`);
    assert.ok(strictlyIncreasing(segment));
    assert.ok(everyPoint(segment, (t, v) => Math.abs(v - Math.tan(t)) <= 1e-6 * Math.max(1, Math.abs(v))));
  }
  const [, middle] = narrow.segments;
  close(first(middle)[0], -Math.PI / 2, 1e-3);
  close(last(middle)[0], Math.PI / 2, 1e-3);
  assert.ok(first(middle)[1] < -1000 && last(middle)[1] > 1000);
  const wideStarts = wide.segments.map((segment) => first(segment)[0]);
  assert.deepEqual(wideStarts.slice(1).map((t) => TAN_POLES.findIndex((pole) => Math.abs(t - pole) < 1e-3)), [0, 1, 2, 3]);
});

test("a base sample landing next to a pole adds splits only far off-screen", () => {
  const { segments } = sampleExplicit(Math.tan, { from: -5, to: 5 });
  const visible = segments.filter((segment) => !everyPoint(segment, (t, v) => Math.abs(v) > 1000));
  assert.equal(visible.length, 5);
  for (const segment of segments) {
    for (const pole of TAN_POLES) assert.ok(!spansValue(segment, pole));
  }
  const refined = sampleExplicit(Math.tan, { from: -5, to: 5, maxRefinement: 12 });
  assert.equal(refined.segments.length, 5);
});

test("square root reaches the origin", () => {
  const { segments, defined } = sampleExplicit(Math.sqrt, { from: -1, to: 4 });
  assert.equal(defined, 641);
  assert.equal(segments.length, 1);
  const [segment] = segments;
  const [t0, v0] = first(segment);
  assert.ok(Math.abs(t0) < 1e-6 && v0 >= 0);
  assert.ok(everyPoint(segment, (t, v) => t >= 0 && v >= 0 && Math.abs(v * v - t) < 1e-9));
  assert.deepEqual(last(segment), [4, 2]);
  assert.ok(strictlyIncreasing(segment));
});

test("logarithm runs down toward zero without crossing it", () => {
  const { segments, defined } = sampleExplicit(Math.log, { from: -1, to: 4 });
  assert.equal(defined, 640);
  assert.equal(segments.length, 1);
  const [segment] = segments;
  assert.ok(everyPoint(segment, (t) => t > 0));
  const [t0, v0] = first(segment);
  assert.ok(t0 < 1e-3 && v0 < -5);
  assert.ok(strictlyIncreasing(segment));
  close(last(segment)[1], Math.log(4));
});

test("smooth functions keep exactly the base samples when no jump exceeds the threshold", () => {
  const { segments, defined } = sampleExplicit(Math.sin, { from: 0, to: TAU, count: 50, span: 10 });
  assert.equal(defined, 51);
  assert.equal(segments.length, 1);
  assert.equal(pointCount(segments[0]), 51);
  assert.ok(everyPoint(segments[0], (t, v, index) => Math.abs(t - (TAU * index) / 50) < 1e-12 && v === Math.sin(t)));
  assert.equal(last(segments[0])[0], TAU);
  const refined = sampleExplicit(Math.sin, { from: 0, to: TAU, count: 50 });
  assert.equal(refined.segments.length, 1);
  assert.ok(pointCount(refined.segments[0]) > 51);
  assert.ok(strictlyIncreasing(refined.segments[0]));
  assert.ok(everyPoint(refined.segments[0], (t, v) => v === Math.sin(t)));
});

test("absolute value stays one segment with and without refinement", () => {
  const plain = sampleExplicit(Math.abs, { from: -2, to: 2 });
  assert.equal(plain.segments.length, 1);
  assert.equal(pointCount(plain.segments[0]), 801);
  const wide = sampleExplicit(Math.abs, { from: -100, to: 100 });
  assert.equal(wide.segments.length, 1);
  assert.ok(pointCount(wide.segments[0]) > 801);
  assert.ok(everyPoint(wide.segments[0], (t, v) => v === Math.abs(t)));
});

test("functions undefined everywhere yield no segments", () => {
  assert.deepEqual(sampleExplicit(() => NaN, { from: -1, to: 1 }), emptyResult);
  assert.deepEqual(sampleExplicit(() => Infinity, { from: -1, to: 1 }), emptyResult);
  assert.deepEqual(sampleExplicit(() => "3", { from: -1, to: 1 }), emptyResult);
  assert.deepEqual(sampleExplicit(() => { throw new Error("boom"); }, { from: -1, to: 1 }), emptyResult);
});

test("hostile explicit inputs return empty results without throwing", () => {
  assert.deepEqual(sampleExplicit(Math.sin, { from: -1, to: 1, count: 0 }), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin, { from: -1, to: 1, count: -4 }), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin, { from: 1, to: 1 }), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin, { from: NaN, to: 1 }), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin, { from: 0, to: Infinity }), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin, { from: -Number.MAX_VALUE, to: Number.MAX_VALUE }), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin, { from: "0", to: "1" }), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin), emptyResult);
  assert.deepEqual(sampleExplicit(Math.sin, null), emptyResult);
  assert.deepEqual(sampleExplicit(null, { from: -1, to: 1 }), emptyResult);
  assert.deepEqual(sampleExplicit(42, { from: -1, to: 1 }), emptyResult);
  assert.deepEqual(sampleExplicit("sin", { from: -1, to: 1 }), emptyResult);
});

test("garbage tuning parameters fall back to defaults", () => {
  const reference = sampleExplicit(Math.sin, { from: 0, to: TAU });
  for (const options of [
    { count: NaN }, { count: Infinity }, { count: "800" }, { span: NaN }, { span: 0 }, { span: -1 }, { span: Infinity },
    { maxRefinement: NaN }, { maxRefinement: -3 }, { jumpThreshold: 0 }, { jumpThreshold: NaN },
  ]) {
    const result = sampleExplicit(Math.sin, { from: 0, to: TAU, ...options });
    assert.deepEqual(result, reference, JSON.stringify(options));
  }
  const unrefined = sampleExplicit((t) => 1 / t, { from: -2, to: 2, count: 801, span: 4, maxRefinement: 0 });
  assert.ok(unrefined.segments.length >= 2, "a zero refinement budget still splits at suprathreshold jumps");
  for (const segment of unrefined.segments) {
    assert.ok(!spansValue(segment, 0));
    assert.ok(everyPoint(segment, (t, v) => v === 1 / t), "no refined points are inserted without a budget");
  }
});

test("per-sample errors and non-numeric results become gaps", () => {
  const throwing = sampleExplicit((t) => { if (t < 0) throw new RangeError("negative"); return t; }, { from: -1, to: 1 });
  assert.equal(throwing.segments.length, 1);
  assert.equal(throwing.defined, 401);
  assert.ok(everyPoint(throwing.segments[0], (t, v) => t >= 0 && v === t));
  const strings = sampleExplicit((t) => (t < 0 ? "oops" : t), { from: -1, to: 1 });
  assert.deepEqual(strings, throwing);
  const undefineds = sampleExplicit((t) => (t < 0 ? undefined : t), { from: -1, to: 1 });
  assert.deepEqual(undefineds, throwing);
});

test("isolated finite samples count as defined but do not form segments", () => {
  const result = sampleExplicit((t) => (t === 0 ? 0 : NaN), { from: -1, to: 1 });
  assert.equal(result.defined, 1);
  assert.deepEqual(result.segments, []);
});

test("a hole at a refined midpoint splits the curve and both sides approach it", () => {
  const hole = 0.0025;
  const { segments } = sampleExplicit((t) => (Math.abs(t - hole) < 1e-4 ? NaN : 1000 * t), { from: -1, to: 1, count: 400 });
  assert.equal(segments.length, 2);
  const [left, right] = segments;
  const leftEnd = last(left)[0];
  const rightStart = first(right)[0];
  assert.ok(leftEnd < hole - 1e-4 && leftEnd > hole - 1e-4 - 1e-4, `left ends at ${leftEnd}`);
  assert.ok(rightStart > hole + 1e-4 && rightStart < hole + 1e-4 + 1e-4, `right starts at ${rightStart}`);
  assert.ok(everyPoint(left, (t, v) => v === 1000 * t) && everyPoint(right, (t, v) => v === 1000 * t));
});

test("a refined value beyond a million spans splits without emitting the spike", () => {
  const spike = 0.0025;
  const { segments } = sampleExplicit((t) => (Math.abs(t - spike) < 1e-4 ? 1e7 : 1000 * t), { from: -1, to: 1, count: 400 });
  assert.equal(segments.length, 2);
  assert.ok(segments.every((segment) => everyPoint(segment, (t, v) => Math.abs(v) <= 1e6)));
  assert.deepEqual(last(segments[0]), [0, 0]);
  close(first(segments[1])[0], 0.005, 1e-12);
});

test("an explicit jump threshold overrides the span-derived default", () => {
  const { segments } = sampleExplicit(Math.sin, { from: 0, to: TAU, count: 50, jumpThreshold: 1 });
  assert.equal(segments.length, 1);
  assert.equal(pointCount(segments[0]), 51);
});

test("reversed ranges sample from start to end", () => {
  const { segments } = sampleExplicit((t) => t, { from: 1, to: -1, count: 4, span: 100 });
  assert.equal(segments.length, 1);
  assert.deepEqual(Array.from(segments[0]), [1, 1, 0.5, 0.5, 0, 0, -0.5, -0.5, -1, -1]);
  const pole = sampleExplicit((t) => 1 / t, { from: 2, to: -2 });
  assert.equal(pole.segments.length, 2);
  assert.ok(everyPoint(pole.segments[0], (t) => t >= 1e-9) && everyPoint(pole.segments[1], (t) => t <= -1e-9));
});

test("explicit sampling is deterministic", () => {
  const options = { from: -6, to: 6, count: 1234, span: 3 };
  assert.deepEqual(sampleExplicit(Math.tan, options), sampleExplicit(Math.tan, options));
  assert.deepEqual(sampleExplicit(Math.floor, options), sampleExplicit(Math.floor, options));
});

test("sampling evaluates each interval at most once per refinement step", () => {
  let evaluations = 0;
  const counted = (t) => { evaluations++; return Math.tan(t); };
  sampleExplicit(counted, { from: -6, to: 6, count: 4000, maxRefinement: 8 });
  assert.ok(evaluations <= 4001 + 4000 * 8, `${evaluations} evaluations`);
  evaluations = 0;
  sampleExplicit((t) => { evaluations++; return 2 * t; }, { from: 0, to: 1, count: 500, span: 100 });
  assert.equal(evaluations, 501, "a flat-enough curve keeps only its base samples");
});

test("curves far from the origin sample exactly like their origin-centred twins", () => {
  const near = sampleExplicit((t) => 1000 * t, { from: 0, to: 1, span: 1 });
  const far = sampleExplicit((t) => 1000 * (t - 1e7), { from: 1e7, to: 1e7 + 1, span: 1 });
  assert.equal(far.segments.length, 1);
  assert.ok(Math.abs(pointCount(far.segments[0]) - pointCount(near.segments[0])) <= pointCount(near.segments[0]) * 0.02);
  const wave = sampleExplicit((t) => 3 * Math.sin(t), { from: 2e6, to: 2e6 + 10, span: 2 });
  assert.equal(wave.segments.length, 1);
  const root = sampleExplicit((t) => Math.sqrt(t - 1e7), { from: 1e7 - 1, to: 1e7 + 4, span: 3 });
  assert.equal(root.segments.length, 1);
  close(first(root.segments[0])[0] - 1e7, 0, 1e-6);
  const circle = sampleParametric((t) => 5e6 + Math.cos(t), (t) => 5e6 + Math.sin(t), { from: 0, to: TAU, span: 2 });
  assert.equal(circle.segments.length, 1);
  close(first(circle.segments[0])[0], last(circle.segments[0])[0], 1e-9);
});

test("a step riding on a steep ramp still splits, and the ramp alone stays connected", () => {
  const ramp = sampleExplicit((t) => 1000 * t, { from: -10, to: 10, span: 20 });
  assert.equal(ramp.segments.length, 1);
  for (const offset of [0, 0.0037, -0.0123]) {
    const stepped = sampleExplicit((t) => 1000 * t + Math.sign(t - offset), { from: -10, to: 10, span: 20 });
    assert.equal(stepped.segments.length, 2, `offset ${offset}`);
    assert.ok(last(stepped.segments[0])[0] <= offset + 1e-9 && first(stepped.segments[1])[0] >= offset - 1e-9, `split at ${offset}`);
  }
  for (const fn of [Math.exp, (t) => t ** 3, (t) => Math.exp(-t * t * 1e4), (t) => Math.atan(50 * t)]) {
    assert.equal(sampleExplicit(fn, { from: -5, to: 12, span: 20 }).segments.length, 1);
  }
});


test("parametric circle is one closed-looking segment", () => {
  const { segments, defined } = sampleParametric(Math.cos, Math.sin, { from: 0, to: TAU });
  assert.equal(defined, 801);
  assert.equal(segments.length, 1);
  const [segment] = segments;
  assert.equal(pointCount(segment), 801);
  const [x0, y0] = first(segment);
  const [x1, y1] = last(segment);
  assert.ok(Math.hypot(x1 - x0, y1 - y0) < 1e-9);
  assert.ok(everyPoint(segment, (x, y) => Math.abs(Math.hypot(x, y) - 1) < 1e-12));
  close(polylineLength(segment), TAU, 1e-3);
});

test("parametric reciprocal splits into two branches", () => {
  const { segments } = sampleParametric((t) => t, (t) => 1 / t, { from: -1, to: 1 });
  assert.equal(segments.length, 2);
  const [left, right] = segments;
  assert.ok(everyPoint(left, (x, y) => x <= -1e-9 && Math.abs(x * y - 1) < 1e-9));
  assert.ok(everyPoint(right, (x, y) => x >= 1e-9 && Math.abs(x * y - 1) < 1e-9));
  assert.ok(last(left)[1] < -1000 && first(right)[1] > 1000);
});

test("parametric jumps in either coordinate split the curve", () => {
  const { segments } = sampleParametric(Math.floor, (t) => t, { from: 0, to: 3 });
  assert.equal(segments.length, 3);
  segments.forEach((segment, index) => assert.ok(everyPoint(segment, (x, y) => x === index && Math.floor(y) === index)));
  const gaps = sampleParametric((t) => (t < 0 ? NaN : t), (t) => t, { from: -1, to: 1 });
  assert.equal(gaps.segments.length, 1);
  assert.equal(gaps.defined, 401);
  assert.ok(everyPoint(gaps.segments[0], (x, y) => x >= 0 && x === y));
});

test("hostile parametric inputs return empty results without throwing", () => {
  assert.deepEqual(sampleParametric(null, Math.sin, { from: 0, to: 1 }), emptyResult);
  assert.deepEqual(sampleParametric(Math.cos, "sin", { from: 0, to: 1 }), emptyResult);
  assert.deepEqual(sampleParametric(Math.cos, () => { throw new Error("boom"); }, { from: 0, to: 1 }), emptyResult);
  assert.deepEqual(sampleParametric(() => NaN, Math.sin, { from: 0, to: 1 }), emptyResult);
  assert.deepEqual(sampleParametric(Math.cos, Math.sin, { from: 0, to: 1, count: 0 }), emptyResult);
  assert.deepEqual(sampleParametric(Math.cos, Math.sin, { from: 2, to: 2 }), emptyResult);
  assert.deepEqual(sampleParametric(Math.cos, Math.sin), emptyResult);
  assert.deepEqual(sampleParametric(Math.cos, Math.sin, { from: 0, to: TAU }), sampleParametric(Math.cos, Math.sin, { from: 0, to: TAU }));
});

const square = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 };

test("marching squares traces a circle", () => {
  const segments = marchingSquares((x, y) => x * x + y * y - 4, square);
  assert.ok(segments instanceof Float64Array);
  assert.ok(segments.length > 0);
  assert.equal(segments.length % 4, 0);
  for (let i = 0; i < segments.length; i += 2) assert.ok(Math.abs(Math.hypot(segments[i], segments[i + 1]) - 2) < 0.05);
  close(segmentListLength(segments), 4 * Math.PI, 0.03 * 4 * Math.PI);
});

test("marching squares interpolates a line exactly", () => {
  const segments = marchingSquares((x, y) => y - x, square);
  assert.ok(segments.length > 0);
  for (let i = 0; i < segments.length; i += 2) assert.ok(Math.abs(segments[i + 1] - segments[i]) < 1e-9);
  close(segmentListLength(segments), 6 * Math.SQRT2, 1e-6);
});

test("marching squares returns nothing for level sets that never cross zero", () => {
  assert.deepEqual(marchingSquares(() => 1, square), new Float64Array(0));
  assert.deepEqual(marchingSquares(() => -1, square), new Float64Array(0));
});

test("hostile marching squares inputs return an empty array without throwing", () => {
  const empty = new Float64Array(0);
  const F = (x, y) => x * x + y * y - 4;
  assert.deepEqual(marchingSquares(F, { ...square, columns: 0 }), empty);
  assert.deepEqual(marchingSquares(F, { ...square, rows: -2 }), empty);
  assert.deepEqual(marchingSquares(F, { ...square, columns: 0.5 }), empty);
  assert.deepEqual(marchingSquares(F, { ...square, xMin: NaN }), empty);
  assert.deepEqual(marchingSquares(F, { ...square, xMax: Infinity }), empty);
  assert.deepEqual(marchingSquares(F, { ...square, yMin: 3 }), empty);
  assert.deepEqual(marchingSquares(F, { ...square, xMin: -Number.MAX_VALUE, xMax: Number.MAX_VALUE }), empty);
  assert.deepEqual(marchingSquares(F), empty);
  assert.deepEqual(marchingSquares(F, null), empty);
  assert.deepEqual(marchingSquares(null, square), empty);
  assert.deepEqual(marchingSquares(() => { throw new Error("boom"); }, square), empty);
  assert.deepEqual(marchingSquares(() => NaN, square), empty);
  assert.deepEqual(marchingSquares(() => "0", square), empty);
});

test("marching squares keeps hyperbola branches in their own quadrants", () => {
  const segments = marchingSquares((x, y) => x * y - 1, square);
  let positive = 0;
  let negative = 0;
  for (let i = 0; i < segments.length; i += 4) {
    const [x1, y1, x2, y2] = segments.subarray(i, i + 4);
    assert.ok(x1 * y1 > 0 && x2 * y2 > 0);
    assert.equal(Math.sign(x1), Math.sign(x2));
    assert.equal(Math.sign(y1), Math.sign(y2));
    if (x1 > 0) positive++;
    else negative++;
  }
  assert.ok(positive > 10 && negative > 10);
  assert.equal(positive, negative);
});

test("marching squares skips cells with non-finite corners", () => {
  const segments = marchingSquares((x, y) => (x < 0 ? NaN : x + y - 1), { xMin: -2, xMax: 2, yMin: -2, yMax: 2 });
  assert.ok(segments.length > 0);
  for (let i = 0; i < segments.length; i += 2) {
    assert.ok(segments[i] >= 0);
    assert.ok(Math.abs(segments[i] + segments[i + 1] - 1) < 1e-9);
  }
});

test("marching squares resolves saddle cells by the sign at the center", () => {
  const unit = { xMin: -1, xMax: 1, yMin: -1, yMax: 1, columns: 1, rows: 1 };
  const quadrant = (x, y) => (x > 0 ? (y > 0 ? 1 : 4) : (y > 0 ? 2 : 3));
  const quadrants = (segments) => {
    const seen = [];
    for (let i = 0; i < segments.length; i += 4) {
      const [x1, y1, x2, y2] = segments.subarray(i, i + 4);
      assert.equal(quadrant(x1, y1), quadrant(x2, y2));
      seen.push(quadrant(x1, y1));
    }
    return seen.sort();
  };
  for (const F of [(x, y) => x * y - 0.5, (x, y) => 0.5 - x * y]) {
    const segments = marchingSquares(F, unit);
    assert.equal(segments.length, 8);
    assert.deepEqual(quadrants(segments), [1, 3]);
    for (let i = 0; i < segments.length; i += 2) close(segments[i] * segments[i + 1], 0.5);
  }
  for (const F of [(x, y) => x * y + 0.5, (x, y) => -(x * y + 0.5)]) {
    const segments = marchingSquares(F, unit);
    assert.equal(segments.length, 8);
    assert.deepEqual(quadrants(segments), [2, 4]);
    for (let i = 0; i < segments.length; i += 2) close(segments[i] * segments[i + 1], -0.5);
  }
});

test("polylineLength sums finite hops and tolerates garbage", () => {
  assert.equal(polylineLength([0, 0, 3, 4]), 5);
  assert.equal(polylineLength(Float64Array.of(0, 0, 3, 4, 3, 0)), 9);
  assert.equal(polylineLength([0, 0, 3, 4, 7]), 5);
  assert.equal(polylineLength([0, 0, NaN, 0, 3, 4]), 0);
  assert.equal(polylineLength([1, 2]), 0);
  assert.equal(polylineLength([]), 0);
  assert.equal(polylineLength(null), 0);
  assert.equal(polylineLength(undefined), 0);
  assert.equal(polylineLength("abc"), 0);
  assert.equal(polylineLength({}), 0);
});
