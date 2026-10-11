import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeContours,
  computeContoursAsync,
  logJuliaGreenPotential,
  sanitizeContourRequest,
} from '../src/instruments/vector-fractals/contour-model.js';
import {
  DEFAULT_STATE,
  EXPLORER_JULIA_PRESETS,
  randomizeState,
  sanitizeState,
} from '../src/instruments/vector-fractals/model.js';
import { JULIA_PRESETS } from '../src/instruments/julia/julia.js';

const wholeView = Object.freeze({ x: 0, y: 0, width: 4, aspect: 1 });
const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
};

function validateGeometry(result) {
  const { points, offsets, closed, view, stats } = result;
  assert.ok(points instanceof Float32Array && offsets instanceof Uint32Array && closed instanceof Uint8Array);
  assert.equal(offsets.length, closed.length + 1);
  assert.equal(offsets[0], 0);
  assert.equal(offsets.at(-1), points.length / 2);
  assert.equal(stats.vertices, points.length / 2);
  assert.equal(stats.pathCount, closed.length);
  assert.ok(stats.grid.columns * stats.grid.rows <= 240_000);
  let segments = 0;
  for (let path = 0; path < closed.length; path += 1) {
    const start = offsets[path], end = offsets[path + 1];
    assert.ok(end - start >= (closed[path] ? 3 : 2));
    segments += end - start - (closed[path] ? 0 : 1);
    for (let i = start; i < end; i += 1) {
      const x = points[2 * i], y = points[2 * i + 1];
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(Math.abs(x) <= .5000001 && Math.abs(y) <= .5 / view.aspect + 1e-7);
      if (i + 1 < end || closed[path]) {
        const next = i + 1 === end ? start : i + 1;
        const step = Math.hypot(x - points[2 * next], y - points[2 * next + 1]);
        assert.ok(step <= Math.hypot(1 / stats.grid.columns, 1 / (view.aspect * stats.grid.rows)) + 1e-7,
          'an ordered contour cannot jump between distant branches');
      }
    }
    if (!closed[path]) {
      for (const endpoint of [start, end - 1]) {
        const x = points[2 * endpoint], y = points[2 * endpoint + 1];
        assert.ok(Math.abs(Math.abs(x) - .5) < 1e-6 || Math.abs(Math.abs(y) - .5 / view.aspect) < 1e-6,
          'open paths terminate on the visible crop boundary');
      }
    }
  }
  assert.equal(stats.segments, segments);
}

// Independent orbit oracle: a much larger escape radius and no analytic
// Mandelbrot-interior shortcuts. Used only where all samples escape quickly.
function orbitPotential(x, y, cr, ci) {
  let iterations = 0;
  while (Math.hypot(x, y) < 1e40 && iterations < 2048) {
    [x, y] = [x * x - y * y + cr, 2 * x * y + ci];
    iterations += 1;
  }
  assert.ok(iterations < 2048, 'the independent reference orbit must escape');
  return Math.log(Math.log(Math.hypot(x, y))) - iterations * Math.LN2;
}

test('Julia potential matches the exact circle and interval formulas', () => {
  // For c=0, G(z)=max(log|z|,0). For c=-2 and real z>2,
  // G(z)=log((z+sqrt(z²-4))/2), the inverse Joukowski map.
  for (const radius of [1.0001, 1.2, 2, 100]) {
    for (const angle of [0, .3, 1.4, 3.7]) {
      close(logJuliaGreenPotential(radius * Math.cos(angle), radius * Math.sin(angle), 0, 0),
        Math.log(Math.log(radius)), 1e-9);
    }
  }
  for (const x of [2.01, 3, 10]) {
    close(logJuliaGreenPotential(x, 0, -2, 0), Math.log(Math.log((x + Math.sqrt(x * x - 4)) / 2)));
  }
  for (const x of [0, .5, 1]) assert.equal(logJuliaGreenPotential(x, 0, 0, 0), -Infinity);
});

test('Julia potential follows the quadratic functional equation and conjugation', () => {
  for (const [cr, ci] of [[-1, 0], [-.12256116687665361, .7448617666197442], [-.7, .27015], [1, 0]]) {
    for (const [x, y] of [[1.8, .4], [-.75, 1.7], [2.5, -.6]]) {
      const potential = logJuliaGreenPotential(x, y, cr, ci);
      close(potential, orbitPotential(x, y, cr, ci));
      close(logJuliaGreenPotential(x * x - y * y + cr, 2 * x * y + ci, cr, ci), potential + Math.LN2);
      assert.equal(logJuliaGreenPotential(x, -y, cr, -ci), potential);
      assert.equal(logJuliaGreenPotential(-x, -y, cr, ci), potential);
    }
  }
});

test('Julia evaluation never applies Mandelbrot interior tests to its z or c', () => {
  // c=0 and c=-1 lie inside M, yet these starting z values escape.
  assert.ok(Number.isFinite(logJuliaGreenPotential(2, 0, 0, 0)));
  assert.ok(Number.isFinite(logJuliaGreenPotential(2, 0, -1, 0)));
  // z=0 and z=-1 lie inside M, yet both escape for c=1.
  for (const x of [0, -1]) close(logJuliaGreenPotential(x, 0, 1, 0), orbitPotential(x, 0, 1, 0));
  assert.ok(Number.isNaN(logJuliaGreenPotential(NaN, 0, 0, 0)));
});

test('sampled c=0 outlines follow the independent equipotential radius', () => {
  for (const depth of [.5, 2, 8, 12]) {
    const result = computeContours({ domain: 'julia', cReal: 0, cImag: 0, view: wholeView, depth, resolution: 128 });
    validateGeometry(result);
    assert.deepEqual([...result.closed], [1]);
    const expectedRadius = Math.exp(Math.exp(-depth));
    for (let i = 0; i < result.points.length; i += 2) {
      close(Math.hypot(result.points[i], result.points[i + 1]) * result.view.width, expectedRadius, 2e-5);
    }
  }
});

test('a cropped Julia outline stays an open arc without a closing chord', () => {
  const depth = 2, radius = Math.exp(Math.exp(-depth));
  const result = computeContours({
    domain: 'julia', cReal: 0, cImag: 0,
    view: { x: radius, y: 0, width: .4, aspect: 1 }, depth, resolution: 128,
  });
  validateGeometry(result);
  assert.deepEqual([...result.closed], [0]);
  assert.equal(result.stats.segments, result.stats.vertices - 1);
  assert.ok(Math.abs(result.points[1] - result.points.at(-1)) > .99);
});

test('disconnected Julia equipotentials retain legitimate separate components', () => {
  // For c=1, G(0) lies between exp(-2) and exp(-1). Crossing that critical
  // potential splits the exact equipotential into two components.
  const criticalPotential = orbitPotential(0, 0, 1, 0);
  assert.ok(criticalPotential > -2 && criticalPotential < -1);
  const request = { domain: 'julia', cReal: 1, cImag: 0, view: wholeView, resolution: 128 };
  const outer = computeContours({ ...request, depth: 1 });
  const inner = computeContours({ ...request, depth: 2 });
  for (const result of [outer, inner]) {
    validateGeometry(result);
    assert.equal(result.stats.uncertainClosedPaths, 0,
      'Mandelbrot anchor tests cannot diagnose a Julia component as an error');
    for (let i = 0; i < result.points.length; i += 2) {
      close(orbitPotential(result.points[i] * 4, result.points[i + 1] * 4, 1, 0), -result.depth, .0002);
    }
  }
  assert.deepEqual([...outer.closed], [1]);
  assert.deepEqual([...inner.closed], [1, 1]);
});

test('Explorer reuses the existing Julia page coefficients with honest names', () => {
  assert.equal(EXPLORER_JULIA_PRESETS.length, JULIA_PRESETS.length);
  assert.equal(new Set(EXPLORER_JULIA_PRESETS.map(preset => preset.id)).size, JULIA_PRESETS.length);
  for (const source of JULIA_PRESETS) {
    const preset = EXPLORER_JULIA_PRESETS.find(candidate => candidate.id === source.id);
    assert.ok(preset, `${source.id} is available in Explorer`);
    assert.equal(preset.cReal, source.cReal);
    assert.equal(preset.cImag, source.cImag);
    if (source.id === 'rabbit') assert.equal(preset.label, 'Douady rabbit');
    else if (source.id === 'spiral') assert.match(preset.label, /Spiral.*finite depth/);
    else assert.equal(preset.label, source.name);
  }
});

test('every named Julia coefficient yields bounded usable outlines at three depths', () => {
  for (const preset of EXPLORER_JULIA_PRESETS) {
    for (const depth of [4, 8, 12]) {
      const result = computeContours({
        domain: 'julia', cReal: preset.cReal, cImag: preset.cImag,
        view: wholeView, depth, resolution: 128,
      });
      validateGeometry(result);
      assert.equal(result.domain, 'julia');
      assert.equal(result.cReal, preset.cReal);
      assert.equal(result.cImag, preset.cImag);
      assert.ok(result.stats.vertices > 100, `${preset.id} at depth ${depth} should provide a playable outline`);
      // At a finite grid, thin connections can disappear; closed[] describes
      // sampled paths, not proof of exact Julia-set connectedness.
    }
  }
});

test('legacy contour requests still select Mandelbrot and do not mutate inputs', async () => {
  const view = Object.freeze({ x: -.5, y: 0, width: 4, aspect: 1 });
  const request = Object.freeze({ view, depth: 2, resolution: 64 });
  const first = computeContours(request);
  const explicit = computeContours({ ...request, domain: 'mandelbrot', cReal: 2, cImag: -2 });
  assert.equal(first.domain, 'mandelbrot');
  assert.deepEqual(first.points, explicit.points);
  assert.deepEqual(first.offsets, explicit.offsets);
  assert.deepEqual(first.closed, explicit.closed);
  assert.equal(sanitizeContourRequest().domain, 'mandelbrot');
  assert.equal(sanitizeContourRequest({ domain: 'unknown' }).domain, 'mandelbrot');
  const bounded = sanitizeContourRequest({ domain: 'julia', cReal: 8, cImag: -8 });
  assert.deepEqual([bounded.domain, bounded.cReal, bounded.cImag], ['julia', 2, -2]);
  const julia = Object.freeze({ ...request, domain: 'julia', cReal: -1, cImag: 0 });
  const synchronous = computeContours(julia);
  const asynchronous = await computeContoursAsync(julia);
  assert.deepEqual(synchronous.points, asynchronous.points);
  assert.deepEqual(synchronous.offsets, asynchronous.offsets);
  assert.deepEqual(synchronous.closed, asynchronous.closed);
  assert.deepEqual([asynchronous.domain, asynchronous.cReal, asynchronous.cImag], ['julia', -1, 0]);
});

test('Julia state is bounded, backward compatible, and covered by full randomization', () => {
  for (const state of [DEFAULT_STATE, sanitizeState({})]) {
    assert.deepEqual([state.contourDomain, state.cReal, state.cImag], ['mandelbrot', -1, 0]);
  }
  const previous = Object.freeze({ contourDomain: 'julia', cReal: -.123, cImag: .745 });
  assert.deepEqual([sanitizeState(previous).contourDomain, sanitizeState(previous).cReal, sanitizeState(previous).cImag],
    ['julia', -.123, .745]);
  const bounded = sanitizeState({ contourDomain: 'invalid', cReal: -20, cImag: 30 });
  assert.deepEqual([bounded.contourDomain, bounded.cReal, bounded.cImag], ['mandelbrot', -2, 2]);
  let seed = 17;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  const states = Array.from({ length: 96 }, () => randomizeState(previous, random));
  assert.deepEqual(new Set(states.map(state => state.contourDomain)), new Set(['mandelbrot', 'julia']));
  for (const key of ['cReal', 'cImag']) {
    assert.ok(new Set(states.map(state => state[key])).size > 4, `${key} participates in randomization`);
    assert.ok(states.every(state => Number.isFinite(state[key]) && Math.abs(state[key]) <= 2));
  }
  assert.deepEqual(previous, { contourDomain: 'julia', cReal: -.123, cImag: .745 });
});
