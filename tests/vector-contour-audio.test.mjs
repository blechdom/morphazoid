import test from 'node:test';
import assert from 'node:assert/strict';
import { contourSamples, createContourBank } from '../src/instruments/vector-fractals/contour-audio.js';
import { TABLE_SIZE, HARMONICS, PRESETS, fft } from '../src/instruments/vector-fractals/model.js';
import { VectorDSP } from '../src/instruments/vector-fractals/dsp.js';

test('open strands retrace their actual arc without a fabricated closing chord', () => {
  const a = contourSamples(new Float32Array([0, 0, 1, 0, 1, 1]), false);
  const b = contourSamples(new Float32Array([1, 1, 1, 0, 0, 0]), false);
  for (let i = 0; i < TABLE_SIZE; i++) {
    assert.ok(Math.abs(a.x[i] - b.x[i]) < 1e-12 && Math.abs(a.y[i] - b.y[i]) < 1e-12);
    assert.ok(Math.abs(a.x[i] - 1) < 1e-12 || Math.abs(a.y[i]) < 1e-12);
  }
  assert.equal(a.x[0], 0); assert.equal(a.y[0], 0);
  assert.equal(a.x[TABLE_SIZE / 2], 1); assert.equal(a.y[TABLE_SIZE / 2], 1);
  assert.ok(Math.abs(a.x[TABLE_SIZE - 1] - a.x[0]) < .00001);
});

test('arc sampling is independent of adaptive vertex density', () => {
  const a = contourSamples(new Float32Array([0, 0, 1, 0, 1, 1]), false);
  const b = contourSamples(new Float32Array([0, 0, .125, 0, .5, 0, 1, 0, 1, .5, 1, 1]), false);
  for (let i = 0; i < TABLE_SIZE; i++) assert.ok(Math.hypot(a.x[i] - b.x[i], a.y[i] - b.y[i]) < 1e-12);
});

test('traced banks retain common XY normalization and pitch-limited harmonics', () => {
  const bank = createContourBank({}, { points: new Float32Array([-.5, 0, 0, .3, .4, -.1, .5, .2]), closed: false });
  const frame = bank.frames[0];
  for (let m = 0; m < HARMONICS.length; m++) {
    const x = Float64Array.from(frame.tables[m].x), y = Float64Array.from(frame.tables[m].y);
    assert.ok(x.every(Number.isFinite) && y.every(Number.isFinite));
    assert.ok(Math.max(...x.map(Math.abs), ...y.map(Math.abs)) < 1.8);
    fft(x, y);
    assert.ok(Math.hypot(x[0], y[0]) / TABLE_SIZE < 1e-7);
    for (let k = HARMONICS[m] + 1; k < TABLE_SIZE - HARMONICS[m]; k++) assert.ok(Math.hypot(x[k], y[k]) / TABLE_SIZE < 1e-7);
  }
});

test('empty and degenerate regions produce silence instead of unrelated geometry', () => {
  for (const path of [null, { points: new Float32Array([.2, .3, .2, .3]), closed: false }]) {
    const bank = createContourBank({}, path);
    assert.ok(bank.frames[0].tables.every(t => t.x.every(v => v === 0) && t.y.every(v => v === 0)));
  }
});

test('explorer presets trace different regions and keep running through sound replacement', async () => {
  const { computeContours } = await import('../src/instruments/vector-fractals/contour-model.js');
  const banks = [];
  for (const preset of PRESETS.filter(p => p.snapshot.mode === 'explorer')) {
    const s = preset.snapshot;
    const result = computeContours({ view: { x: s.viewX, y: s.viewY, width: s.viewWidth, aspect: 1.5 }, depth: 12 + 12 * Math.log2(3.4 / s.viewWidth), resolution: 150 });
    let p = -1;
    for (let i = 0; i < result.closed.length; i++) if (p < 0 || result.offsets[i + 1] - result.offsets[i] > result.offsets[p + 1] - result.offsets[p]) p = i;
    assert.ok(p >= 0, preset.id);
    banks.push(createContourBank(s, { points: result.points.slice(result.offsets[p] * 2, result.offsets[p + 1] * 2), closed: Boolean(result.closed[p]) }));
  }
  assert.equal(banks.length, 3);
  const rms = x => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
  assert.ok(rms(banks[0].frames[0].sourceX.map((v, i) => v - banks[1].frames[0].sourceX[i])) > .02);
  const dsp = new VectorDSP(); dsp.playing = true;
  for (const bank of banks) {
    const before = dsp.phase; dsp.setState(bank.state); dsp.setBank(bank);
    assert.equal(dsp.phase, before);
    const left = new Float32Array(128), right = new Float32Array(128);
    for (let block = 0; block < 200; block++) { dsp.process(left, right); assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite)); }
    assert.ok(rms(left) > .005); assert.ok(Math.max(...left.map(Math.abs), ...right.map(Math.abs)) < .8);
  }
});
