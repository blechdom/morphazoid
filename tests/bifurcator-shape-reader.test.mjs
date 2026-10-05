import assert from 'node:assert/strict';
import test from 'node:test';
import { ShapeReader, normalizedOrbitPoint, shapeFrequency } from '../src/instruments/bifurcator/shape-reader.js';

const CURRENT = { frequency: 110, pitchSpan: 2.5, headRate: 1 };
const PARAMS = { pitchAxis: 'height', headCount: 2, growShape: true };
const point = new Float64Array(2);
const at = (model, x, y, z, parameter = 0) => Array.from(normalizedOrbitPoint(model, x, y, z, point, parameter));
const sample = (reader, time, current = CURRENT, params = PARAMS) => reader.sample('hopf', Math.sin(time * 3), Math.cos(time * 3), 0, 0, current, params);
const run = (reader, seconds, start = 0, current = CURRENT, params = PARAMS) => {
  let peak = 0, energy = 0;
  for (let frame = 0; frame < Math.round(seconds * reader.sampleRate); frame++) {
    const value = sample(reader, start + frame / reader.sampleRate, current, params);
    assert.ok(Number.isFinite(value) && Math.abs(value) <= .550000001);
    peak = Math.max(peak, Math.abs(value)); energy += value * value;
  }
  return { peak, rms: Math.sqrt(energy / Math.max(1, Math.round(seconds * reader.sampleRate))) };
};
const near = (left, right, tolerance = 1e-9) => assert.ok(Math.abs(left - right) <= tolerance, `${left} ≈ ${right}`);

test('fixed projections preserve normalized orientation and distinguish every model', () => {
  const lorenz = at('lorenz', 14, 8, 36);
  near(lorenz[0], Math.tanh((14 + .15 * 8) / 28)); near(lorenz[1], Math.tanh(12 / 25));
  assert.ok(at('lorenz', 0, 0, 40)[1] > at('lorenz', 0, 0, 8)[1], 'greater height maps up');
  assert.deepEqual(at('rossler', 3, 4, 2), [Math.tanh(3.24 / 12), Math.tanh(4.46 / 12)]);
  assert.deepEqual(at('hopf', 1.2, -1.2, 0), [Math.tanh(1), -Math.tanh(1)]);
  assert.deepEqual(at('logistic', .8, .2, 0), [-.6, .6000000000000001]);
  assert.deepEqual(at('fold', 1, 0, 0, -.325), [Math.tanh(1), -.5]);
  for (const model of ['lorenz', 'rossler', 'hopf', 'logistic', 'fold', 'missing']) {
    assert.ok(at(model, 1e30, -1e30, Infinity, NaN).every((value) => Number.isFinite(value) && Math.abs(value) <= 1));
  }
});

test('geometric pitch is continuous, dimensionless and free of tuning steps', () => {
  for (const pitchAxis of ['height', 'horizontal', 'center']) {
    const controls = { frequency: 100, pitchSpan: 2, pitchAxis };
    const a = shapeFrequency(.2, .3, controls, 48000);
    const b = shapeFrequency(.2 + 1e-5, .3 + 1e-5, controls, 48000);
    assert.ok(b > a && b - a < .01, pitchAxis);
  }
  near(shapeFrequency(0, -1, { frequency: 100, pitchSpan: 2 }), 100);
  near(shapeFrequency(0, 1, { frequency: 100, pitchSpan: 2 }), 400);
  near(shapeFrequency(0, 0, { frequency: 100, pitchSpan: 2, pitchAxis: 'center' }), 100);
  near(shapeFrequency(1, 1, { frequency: 100, pitchSpan: 2, pitchAxis: 'center' }), 400);
  near(shapeFrequency(0, 0, { frequency: 100, pitchSpan: 0 }), 100);
  assert.equal(shapeFrequency(1, 1, { frequency: 1400, pitchSpan: 4 }, 8000), 2000);
  assert.equal(shapeFrequency(1, 1, { frequency: 1400, pitchSpan: 4 }, 192000), 12000);
});

test('captures actual projected points at 120 Hz and preserves frozen contour while heads travel', () => {
  const reader = new ShapeReader(48000);
  reader.reset('hopf', 0, 1, 0, 0);
  run(reader, 1);
  const captured = reader.snapshot();
  assert.ok(captured.count >= 120 && captured.count <= 121);
  const last = captured.points.at(-1);
  assert.ok(Math.hypot(last[0] - Math.tanh(Math.sin(3) / 1.2), last[1] - Math.tanh(Math.cos(3) / 1.2)) < .03);
  const expectedLength = captured.points.slice(1).reduce((sum, entry, index) => sum + Math.hypot(entry[0] - captured.points[index][0], entry[1] - captured.points[index][1]), 0);
  near(captured.totalLength, expectedLength);
  const before = reader.exportState();
  run(reader, .15, 1, CURRENT, { ...PARAMS, growShape: false });
  const frozen = reader.snapshot();
  assert.deepEqual(frozen.points, captured.points);
  assert.equal(frozen.count, captured.count);
  assert.ok(frozen.heads.some((head, index) => Math.abs(head.position - captured.heads[index].position) > .01));
  assert.notEqual(reader.exportState().heads[0].phase, before.heads[0].phase);
});

test('a frozen single reader produces the mapped sine pitch with continuous phase', () => {
  const reader = new ShapeReader(48000);
  reader.reset('hopf', 0, 0, 0, 0);
  const controls = { frequency: 100, pitchSpan: 2, headRate: 1 };
  const params = { pitchAxis: 'height', headCount: 1, growShape: false };
  for (let frame = 0; frame < 9600; frame++) reader.sample('hopf', 0, 0, 0, 0, controls, params);
  let sine200 = 0, cosine200 = 0, sine100 = 0, cosine100 = 0;
  for (let frame = 0; frame < 12000; frame++) {
    const value = reader.sample('hopf', 0, 0, 0, 0, controls, params);
    const angle200 = 2 * Math.PI * 200 * frame / 48000;
    const angle100 = 2 * Math.PI * 100 * frame / 48000;
    sine200 += value * Math.sin(angle200); cosine200 += value * Math.cos(angle200);
    sine100 += value * Math.sin(angle100); cosine100 += value * Math.cos(angle100);
  }
  near(2 * Math.hypot(sine200, cosine200) / 12000, .55, .00001);
  assert.ok(2 * Math.hypot(sine100, cosine100) / 12000 < .00001);
  near(reader.snapshot().heads[0].frequency, 200);
  const before = reader.phase;
  reader.sample('hopf', 0, 0, 0, 0, { ...controls, frequency: 300 }, params);
  const advance = (reader.phase - before + 1) % 1;
  assert.ok(advance > 0 && advance < .01, 'live pitch changes retain oscillator phase');
});

test('sine readers ping-pong on an open contour and do not join its endpoints', () => {
  const reader = new ShapeReader(48000);
  const coordinate = Math.atanh(.5) * 1.2;
  reader.reset('hopf', -coordinate, -coordinate, 0, 0);
  const controls = { ...CURRENT, headRate: 3 }, params = { ...PARAMS, headCount: 4 };
  for (let frame = 0; frame < 4800; frame++) reader.sample('hopf', coordinate, -coordinate, 0, 0, controls, params);
  for (let frame = 0; frame < 4800; frame++) reader.sample('hopf', coordinate, coordinate, 0, 0, controls, params);
  const directions = new Set();
  for (let block = 0; block < 300; block++) {
    for (let frame = 0; frame < 128; frame++) reader.sample('hopf', coordinate, coordinate, 0, 0, controls, { ...params, growShape: false });
    for (const head of reader.snapshot().heads) {
      assert.ok(Math.abs(head.y + .5) < 1e-10 || Math.abs(head.x - .5) < 1e-10, 'reader remains on one of the actual L segments');
      assert.ok(head.position >= 0 && head.position <= reader.snapshot().totalLength + 1e-10);
      directions.add(head.direction);
    }
  }
  assert.deepEqual([...directions].sort(), [-1, 1]);
});

test('head activation spaces only new readers, retains phases and smoothly releases removed readers', () => {
  const reader = new ShapeReader(48000);
  run(reader, 1, 0, CURRENT, { ...PARAMS, headCount: 1 });
  const original = reader.exportState();
  const single = new ShapeReader(48000); assert.equal(single.importState(original), true);
  for (let frame = 0; frame < 2400; frame++) {
    sample(reader, 1 + frame / 48000, CURRENT, { ...PARAMS, headCount: 4, growShape: false });
    sample(single, 1 + frame / 48000, CURRENT, { ...PARAMS, headCount: 1, growShape: false });
  }
  const expanded = reader.exportState();
  assert.deepEqual(expanded.heads[0], single.exportState().heads[0], 'existing head keeps the same travel and oscillator state');
  assert.notEqual(expanded.heads[0].phase, 0);
  assert.equal(new Set(expanded.heads.slice(0, 4).map((head) => head.position.toFixed(6))).size, 4);
  assert.ok(expanded.heads[1].gain > .5 && expanded.heads[1].gain < 1, 'new readers enter with a gain ramp');
  for (let frame = 0; frame < 1200; frame++) sample(reader, 1.05 + frame / 48000, CURRENT, { ...PARAMS, headCount: 1, growShape: false });
  const reduced = reader.exportState();
  assert.ok(reduced.heads[1].gain > 0 && reduced.heads[1].gain < expanded.heads[1].gain, 'removed reader releases rather than disappearing');
});

test('rolling storage stays bounded and preserves relative head spacing while old arc is discarded', () => {
  const reader = new ShapeReader(8000);
  const controls = { ...CURRENT, headRate: .03 }, params = { ...PARAMS, headCount: 4 };
  run(reader, 10, 0, controls, params);
  assert.equal(reader.snapshot().count, 1024);
  const seeded = reader.exportState();
  const start = seeded.points[2], end = seeded.points.at(-1), length = end - start;
  seeded.heads.slice(0, 4).forEach((head, index) => { head.position = start + length * (.2 + index * .15); head.direction = 1; head.pendingPlacement = 0; });
  assert.equal(reader.importState(seeded), true);
  const before = reader.snapshot();
  for (let frame = 0; frame < 80; frame++) sample(reader, 10 + frame / 8000, controls, params);
  const after = reader.snapshot();
  assert.equal(after.count, 1024);
  for (let index = 1; index < 4; index++) near(after.heads[index].position - after.heads[0].position, before.heads[index].position - before.heads[0].position, 1e-8);
  assert.ok(after.heads.every((head) => head.position > 0 && head.position < after.totalLength));
  assert.ok(reader.exportState().start !== seeded.start);
});

test('same-rate export/import continues sample exactly, including rolling storage and cadence remainders', () => {
  for (const rate of [8000, 44100, 48000]) {
    const source = new ShapeReader(rate), target = new ShapeReader(rate);
    const params = { ...PARAMS, headCount: 4 };
    run(source, 9.137, 0, CURRENT, params);
    const state = source.exportState();
    assert.equal('sampleRate' in state, false);
    assert.equal(target.importState(JSON.parse(JSON.stringify(state))), true);
    for (let frame = 0; frame < Math.round(rate * .15); frame++) {
      const t = 9.137 + frame / rate;
      assert.equal(sample(source, t, CURRENT, params), sample(target, t, CURRENT, params), `${rate} Hz, frame ${frame}`);
    }
    assert.deepEqual(target.exportState(), source.exportState());
    assert.deepEqual(target.snapshot(), source.snapshot());
  }
});

test('state joins a different rate with seconds, geometry and phases preserved', () => {
  const source = new ShapeReader(48000);
  run(source, 1.137);
  for (const rate of [8000, 44100, 96000]) {
    const target = new ShapeReader(rate), state = source.exportState();
    assert.equal(target.importState(state), true);
    assert.deepEqual(target.snapshot(), source.snapshot());
    const joined = target.exportState();
    assert.equal(joined.recordElapsed, state.recordElapsed);
    assert.equal(joined.controlElapsed, state.controlElapsed);
    run(target, .15, 1.137);
    assert.ok(target.snapshot().count > source.snapshot().count);
  }
});

test('malformed imports are transactional and cannot inject unbounded state', () => {
  const reader = new ShapeReader(48000); run(reader, .1);
  const original = reader.exportState();
  const mutate = callback => { const candidate = structuredClone(original); callback(candidate); return candidate; };
  const invalid = [undefined, null, {}, mutate(state => { state.count = 1025; }), mutate(state => { state.points[0] = Infinity; }), mutate(state => { state.points[2] = -1; }), mutate(state => { state.points[5] += 4; }), mutate(state => { state.heads[0].phase = 1; }), mutate(state => { state.heads[0].frequency = 1e20; }), mutate(state => { state.heads[0].direction = 0; }), mutate(state => { state.heads[0].position = 1e10; }), mutate(state => { state.recordElapsed = .1; })];
  for (const state of invalid) {
    assert.equal(reader.importState(state), false);
    assert.deepEqual(reader.exportState(), original);
  }
  assert.equal(reader.importState(original), true);
});

test('extreme inputs and four-head transitions stay finite and bounded', () => {
  for (const rate of [8000, 48000, 192000]) {
    const reader = new ShapeReader(rate);
    const controls = { frequency: 1e30, pitchSpan: 1e30, headRate: 1e30 };
    for (const model of ['lorenz', 'rossler', 'hopf', 'logistic', 'fold']) {
      reader.reset(model, 1e30, -1e30, 1e30, 1e30, { preservePhases: true });
      for (let frame = 0; frame < Math.round(rate * .025); frame++) {
        const value = reader.sample(model, frame % 2 ? 1e30 : -1e30, 1e30, NaN, Infinity, controls, { pitchAxis: 'center', headCount: frame % 4 + 1, growShape: true });
        assert.ok(Number.isFinite(value) && Math.abs(value) <= .550000001);
      }
      assert.ok(reader.snapshot().heads.every((head) => head.frequency <= Math.min(12000, rate * .25)));
    }
  }
});

test('reset can preserve oscillator phases while clearing captured geometry and travel', () => {
  const reader = new ShapeReader(48000); run(reader, .1);
  const phases = reader.exportState().heads.map(head => head.phase);
  reader.reset('lorenz', 10, 12, 22, 28, { preservePhases: true });
  assert.deepEqual(reader.exportState().heads.map(head => head.phase), phases);
  assert.deepEqual(reader.snapshot().points, [at('lorenz', 10, 12, 22)]);
  assert.equal(reader.snapshot().totalLength, 0);
  assert.equal(reader.snapshot().heads.length, 2, 'active heads retain their gains during a live geometry reset');
  reader.reset('hopf', 0, 0, 0, 0);
  assert.deepEqual(reader.exportState().heads.map(head => head.phase), Array(16).fill(0));
});
