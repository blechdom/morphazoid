import test from 'node:test';
import assert from 'node:assert/strict';
import { HAND_CONTOUR_POINTS, HAND_CONTOUR_BEATS, normalizeHandContour, sampleHandContour, randomizeHandContour } from '../src/instruments/gesticulating-hand/hand-contour.js';

const interval = HAND_CONTOUR_BEATS / HAND_CONTOUR_POINTS;
const sine = () => Array.from({ length: HAND_CONTOUR_POINTS }, (_, i) => Math.sin(i * Math.PI * 2 / HAND_CONTOUR_POINTS));
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const seeded = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32;

test('missing and hostile contours normalize to fresh bounded editable arrays', () => {
  const zero = Array(HAND_CONTOUR_POINTS).fill(0);
  for (const value of [undefined, null, true, Symbol(), 3, 'curve', {}, { length: 1e12 }, new DataView(new ArrayBuffer(8))]) {
    assert.deepEqual(normalizeHandContour(value), zero);
  }
  const source = [-4, 8, NaN, Infinity, -Infinity, Symbol(), {}, '.25', '-.5', 0, null];
  const result = normalizeHandContour(source);
  assert.deepEqual(result, [-1, 1, 0, 0, 0, 0, 0, .25, -.5, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(source[0], -4);
  result[0] = .7;
  assert.equal(normalizeHandContour(source)[0], -1);
  assert.deepEqual(normalizeHandContour(new Float32Array([.5, -.25])), [.5, -.25, ...zero.slice(2)]);
  assert.equal(normalizeHandContour(Array(10000).fill(.5)).length, HAND_CONTOUR_POINTS);
  const poisoned = [];
  Object.defineProperty(poisoned, 0, { get() { throw new Error('unreadable point'); } });
  assert.deepEqual(normalizeHandContour(poisoned), zero);
});

test('the sampler passes through every authored point and wraps positive and negative beats', () => {
  const curve = sine();
  for (let i = 0; i < HAND_CONTOUR_POINTS; i++) {
    const beat = i * interval;
    close(sampleHandContour(curve, beat), curve[i]);
    for (const cycles of [-100, -2, -1, 1, 2, 100]) close(sampleHandContour(curve, beat + cycles * HAND_CONTOUR_BEATS), curve[i]);
  }
  for (const beat of [-7.93, -.07, .03, .7, 1.19, 3.999]) close(sampleHandContour(curve, beat), sampleHandContour(curve, beat + HAND_CONTOUR_BEATS));
});

test('cubic interpolation has continuous value and slope at every point, including the loop seam', () => {
  const curve = sine(), epsilon = 1e-6;
  for (let i = 0; i < HAND_CONTOUR_POINTS; i++) {
    const beat = i * interval, center = sampleHandContour(curve, beat);
    const left = sampleHandContour(curve, beat - epsilon), right = sampleHandContour(curve, beat + epsilon);
    assert.ok(Math.abs(left - right) < .00001);
    close((center - left) / epsilon, (right - center) / epsilon, .0001);
  }
  const wrapSlope = (sampleHandContour(curve, epsilon) - sampleHandContour(curve, -epsilon)) / (2 * epsilon);
  assert.ok(wrapSlope > 1, 'smooth wrap should not impose an artificial stop on a rising curve');
});

test('sharp and irregular drawings stay within each segment without changing the supplied curve', () => {
  const random = seeded(491), curves = [Array(16).fill(.63), Array.from({ length: 16 }, (_, i) => i % 2 ? 1 : -1), sine()];
  for (let n = 0; n < 80; n++) curves.push(Array.from({ length: 16 }, () => random() * 2 - 1));
  for (const source of curves) {
    const curve = Object.freeze(source), snapshot = [...curve];
    for (let i = 0; i < HAND_CONTOUR_POINTS; i++) for (let step = 0; step <= 32; step++) {
      const value = sampleHandContour(curve, (i + step / 32) * interval);
      const a = curve[i], b = curve[(i + 1) % HAND_CONTOUR_POINTS];
      assert.ok(Number.isFinite(value) && value >= Math.min(a, b) - 1e-12 && value <= Math.max(a, b) + 1e-12);
    }
    assert.deepEqual(curve, snapshot);
  }
});

test('default contours and invalid time remain neutral; large finite times stay bounded', () => {
  const zero = normalizeHandContour();
  for (const beat of [-1e300, -4, -.1, 0, .1, 4, 1e300]) assert.equal(sampleHandContour(zero, beat), 0);
  for (const beat of [undefined, null, NaN, Infinity, -Infinity, Symbol(), {}, '1']) assert.equal(sampleHandContour(sine(), beat), 0);
  for (const curve of [undefined, null, {}, Symbol()]) assert.equal(sampleHandContour(curve, .2), 0);
  for (const beat of [-1e300, 1e300]) assert.ok(Math.abs(sampleHandContour(sine(), beat)) <= 1);
});

test('seeded random contours are reproducible, distinct, bounded and nonconstant', () => {
  assert.deepEqual(randomizeHandContour(seeded(73)), randomizeHandContour(seeded(73)));
  assert.notDeepEqual(randomizeHandContour(seeded(73)), randomizeHandContour(seeded(74)));
  for (const random of [seeded(9), () => 0, () => 1, () => NaN, () => Symbol(), () => { throw new Error('rng'); }, null]) {
    const curve = randomizeHandContour(random);
    assert.equal(curve.length, HAND_CONTOUR_POINTS);
    assert.ok(curve.every(value => Number.isFinite(value) && value >= -1 && value <= 1));
    assert.ok(Math.max(...curve) - Math.min(...curve) > .25);
    assert.deepEqual(curve, normalizeHandContour(curve));
  }
});
