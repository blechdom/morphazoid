import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_HEADS, ShapeReader, normalizedOrbitPoint, shapeCoordinate, shapeFrequency, shapeTempo, rhythmRatio } from '../src/instruments/bifurcator/shape-reader.js';

const RATE = 48000;
const CURRENT = { frequency: 110, pitchSpan: 2.5, headRate: .7, headSpread: 0, travelSpan: 0, amplitudeDepth: 0, panWidth: 0, tempo: 120, tempoSpan: 0, pulseDecay: .18 };
const PARAMS = { sonification: 'rhythm', pitchAxis: 'height', headCount: 4, growShape: true, travelAxis: 'none', amplitudeAxis: 'none', panAxis: 'none', tempoAxis: 'none', rhythmRatios: 'unison', pulseVoice: 'pluck' };
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b}`);
const read = (reader, time, current = CURRENT, params = PARAMS) => reader.sample('lorenz', 12 * Math.sin(time * 2), 15 * Math.cos(time), 24 + 13 * Math.sin(time * 3), 28, current, params);
const run = (reader, seconds, start = 0, current = CURRENT, params = PARAMS) => {
  for (let frame = 0; frame < Math.round(seconds * reader.sampleRate); frame++) {
    const mono = read(reader, start + frame / reader.sampleRate, current, params);
    assert.ok(Number.isFinite(mono) && Math.abs(mono) <= .550000001);
    assert.ok(Number.isFinite(reader.left) && Math.abs(reader.left) <= .800000001);
    assert.ok(Number.isFinite(reader.right) && Math.abs(reader.right) <= .800000001);
  }
};

test('all coordinate routes are bounded and depth retains the actual model coordinate', () => {
  assert.equal(MAX_HEADS, 16);
  near(shapeCoordinate('height', .6, .2), .6);
  near(shapeCoordinate('horizontal', .6, .2), .8);
  near(shapeCoordinate('depth', .6, .2, .8), .9);
  near(shapeCoordinate('center', .6, .2), Math.sqrt(.2));
  near(shapeCoordinate('angle', 0, 1), .75);
  near(shapeCoordinate('bend', .6, .2, .8, .3), .3);
  near(shapeCoordinate('path', .6, .2, .8, .3, .7), .7);
  near(shapeCoordinate('none', .6, .2, .8), .5);
  for (const axis of ['none', 'height', 'horizontal', 'depth', 'center', 'angle', 'bend', 'path', '__proto__']) {
    const value = shapeCoordinate(axis, NaN, Infinity, -Infinity, 1e30, -1e30);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
  const target = new Float64Array(3);
  normalizedOrbitPoint('lorenz', 10, 28, 24, target); near(target[2], Math.tanh(1));
  normalizedOrbitPoint('rossler', 10, 4, 12, target); near(target[2], Math.tanh(1));
  normalizedOrbitPoint('hopf', 10, 4, 12, target); assert.equal(target[2], 0);
  near(shapeFrequency(0, 0, { frequency: 100, pitchSpan: 2, pitchAxis: 'depth' }, RATE, 1), 400);
});

test('tempo helpers expose safe ratio families and centered geometric octaves', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => rhythmRatio(i, 'octaves')), [.5, 1, 2, 4, .5, 1, 2, 4]);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => rhythmRatio(i, 'two-three-four')), [1, 1.5, 2, 1, 1.5, 2]);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => rhythmRatio(i, 'fibonacci')), [1, 2, 3, 5]);
  assert.equal(rhythmRatio(NaN, '__proto__'), 1);
  near(shapeTempo(0, { tempo: 120, tempoSpan: 2, tempoAxis: 'height' }), 60);
  near(shapeTempo(.5, { tempo: 120, tempoSpan: 2, tempoAxis: 'height' }), 120);
  near(shapeTempo(1, { tempo: 120, tempoSpan: 2, tempoAxis: 'height' }), 240);
  assert.equal(shapeTempo(0, { tempo: 120, tempoSpan: 3, tempoAxis: 'none', rhythmRatios: 'octaves' }, 2), 240);
  assert.equal(shapeTempo(1, { tempo: 120, tempoSpan: 3, tempoAxis: 'none', rhythmRatios: 'octaves' }, 2), 240);
  assert.equal(shapeTempo(1, { tempo: 1e30, tempoSpan: 1e30, tempoAxis: 'depth', rhythmRatios: 'fibonacci' }, 3), 960);
  assert.ok(Number.isFinite(shapeTempo(NaN, null, Infinity)));
});

test('ratio clocks strike at sample-time periods without a renderer', () => {
  const reader = new ShapeReader(RATE);
  const params = { ...PARAMS, growShape: false, rhythmRatios: 'octaves' };
  const strikes = Array.from({ length: 4 }, () => []), previous = [0, 0, 0, 0];
  for (let frame = 0; frame < RATE * 2; frame++) {
    read(reader, frame / RATE, CURRENT, params);
    if (frame % 48 !== 0) continue;
    for (const head of reader.snapshot().heads) {
      if (head.hits !== previous[head.index]) strikes[head.index].push(frame / RATE);
      previous[head.index] = head.hits;
    }
  }
  const tempos = [60, 120, 240, 480];
  for (let index = 0; index < 4; index++) {
    const period = 60 / tempos[index];
    const first = index === 0 ? 0 : (1 - index / 4) * period;
    assert.ok(strikes[index].length >= 2);
    strikes[index].forEach((time, strike) => near(time, first + strike * period, .0012));
    near(reader.snapshot().heads[index].tempo, tempos[index]);
  }
});

test('tempo edits preserve beat phase and change subsequent time rather than emitting catch-up hits', () => {
  const reader = new ShapeReader(RATE), params = { ...PARAMS, headCount: 1, growShape: false };
  run(reader, .2, 0, CURRENT, params);
  const before = reader.snapshot().heads[0];
  read(reader, .2, { ...CURRENT, tempo: 240 }, params);
  const first = reader.snapshot().heads[0];
  assert.equal(first.hits, before.hits);
  assert.ok(first.beatPhase > before.beatPhase && first.beatPhase - before.beatPhase < .001);
  run(reader, .5, .2, { ...CURRENT, tempo: 240 }, params);
  const accelerated = reader.snapshot().heads[0];
  assert.ok(accelerated.hits > before.hits);
  near(accelerated.tempo, 240, .001);
});

test('pitch, travel, amplitude, pan and tempo read independent coordinates', () => {
  const y = Math.atanh(.8) * 28, x = Math.atanh(.6) * 28 - .15 * y, z = 24 + Math.atanh(.2) * 25;
  const reader = new ShapeReader(RATE), reference = new ShapeReader(RATE);
  reader.reset('lorenz', x, y, z, 28); reference.reset('lorenz', x, y, z, 28);
  const current = { ...CURRENT, frequency: 100, pitchSpan: 2, travelSpan: 2, headRate: 1, amplitudeDepth: 1, panWidth: 1, tempoSpan: 2 };
  const params = { ...PARAMS, sonification: 'shape', headCount: 1, growShape: false, pitchAxis: 'height', travelAxis: 'horizontal', amplitudeAxis: 'center', panAxis: 'horizontal', tempoAxis: 'depth' };
  let mappedEnergy = 0, referenceEnergy = 0, leftEnergy = 0, rightEnergy = 0;
  for (let frame = 0; frame < RATE * .3; frame++) {
    const value = reader.sample('lorenz', x, y, z, 28, current, params);
    const original = reference.sample('lorenz', x, y, z, 28, { ...current, amplitudeDepth: 0, panWidth: 0 }, params);
    if (frame > RATE * .2) { mappedEnergy += value * value; referenceEnergy += original * original; leftEnergy += reader.left ** 2; rightEnergy += reader.right ** 2; }
  }
  const head = reader.snapshot().heads[0];
  near(head.frequency, 100 * 2 ** 1.2, .000001);
  near(head.tempo, 120 * 2 ** .8, .000001);
  near(head.speed, 6 * 2 ** .6, .000001);
  near(head.amplitude, .15 + .85 * Math.sqrt(.2), .000001);
  near(head.pan, .6, .000001);
  near(Math.sqrt(mappedEnergy / referenceEnergy), head.amplitude, .000001);
  assert.ok(rightEnergy > leftEnergy * 4, 'horizontal pan moves energy right');
});

test('zero pan preserves exact mono and off-center pan remains within stereo headroom', () => {
  const reader = new ShapeReader(RATE);
  for (let frame = 0; frame < RATE * .15; frame++) {
    const mono = read(reader, frame / RATE, CURRENT, { ...PARAMS, headCount: 16 });
    assert.equal(reader.left, mono); assert.equal(reader.right, mono);
  }
  run(reader, .2, .15, { ...CURRENT, panWidth: 1 }, { ...PARAMS, headCount: 16, panAxis: 'path' });
  assert.ok(reader.snapshot().heads.some(head => Math.abs(head.pan) > .05));
  assert.notEqual(reader.left, reader.right);
});

test('constant amplitude route stays at unity for every depth and invalid selector', () => {
  for (const amplitudeAxis of ['none', '__proto__', undefined]) for (const amplitudeDepth of [0, .5, 1]) {
    const reader = new ShapeReader(8000);
    run(reader, .02, 0, { ...CURRENT, amplitudeDepth }, { ...PARAMS, amplitudeAxis });
    assert.ok(reader.snapshot().heads.every(head => head.amplitude === 1));
  }
});

test('shape mode freezes hidden beat clocks and rhythm reentry resumes them without a new first strike', () => {
  const reader = new ShapeReader(RATE), params = { ...PARAMS, headCount: 2, growShape: false };
  run(reader, .2, 0, CURRENT, params);
  const before = reader.exportState();
  run(reader, .3, .2, CURRENT, { ...params, sonification: 'shape' });
  const held = reader.exportState();
  for (let index = 0; index < 2; index++) for (const field of ['beatPhase', 'secondaryPhase', 'pulseAge', 'pulseEnvelope', 'decayEnvelope', 'hits', 'rhythmInitialized']) assert.equal(held.heads[index][field], before.heads[index][field], field);
  read(reader, .5, CURRENT, params);
  const joined = reader.exportState();
  for (let index = 0; index < 2; index++) assert.equal(joined.heads[index].hits, before.heads[index].hits);
  assert.ok(joined.heads[0].beatPhase > before.heads[0].beatPhase);
});

test('live geometry reset preserves every rhythm clock, partial and envelope while hard reset restarts deterministically', () => {
  const reader = new ShapeReader(RATE);
  run(reader, .137, 0, CURRENT, { ...PARAMS, pulseVoice: 'bell' });
  const before = reader.exportState();
  reader.reset('rossler', .5, .2, .1, 5.7, { preservePhases: true });
  const after = reader.exportState();
  for (let index = 0; index < 16; index++) for (const field of ['phase', 'secondaryPhase', 'beatPhase', 'pulseAge', 'pulseEnvelope', 'decayEnvelope', 'rhythmInitialized', 'pulseVoice', 'hits', 'gain']) assert.equal(after.heads[index][field], before.heads[index][field], field);
  assert.equal(after.rhythmMode, before.rhythmMode);
  assert.equal(after.count, 1);
  reader.reset('rossler', .5, .2, .1, 5.7);
  const reset = reader.exportState();
  assert.ok(reset.heads.every(head => head.phase === 0 && head.secondaryPhase === 0 && head.beatPhase === 0 && head.pulseEnvelope === 0 && head.hits === 0));
  assert.equal(reset.rhythmMode, false);
});

test('all four pulse voices continue exactly through exported stereo state', () => {
  for (const pulseVoice of ['pluck', 'bell', 'tick', 'kick']) {
    const source = new ShapeReader(8000), target = new ShapeReader(8000);
    const current = { ...CURRENT, headSpread: 2, travelSpan: 2, amplitudeDepth: .8, panWidth: .8, tempoSpan: 2 };
    const params = { ...PARAMS, headCount: 16, travelAxis: 'depth', amplitudeAxis: 'center', panAxis: 'horizontal', tempoAxis: 'height', rhythmRatios: 'fibonacci', pulseVoice };
    run(source, 9.137, 0, current, params);
    const state = source.exportState();
    assert.equal(state.version, 2); assert.equal(state.heads.length, 16); assert.equal(state.count, 1024); assert.equal('sampleRate' in state, false);
    assert.equal(target.importState(JSON.parse(JSON.stringify(state))), true);
    assert.equal(target.left, source.left); assert.equal(target.right, source.right);
    for (let frame = 0; frame < 800; frame++) {
      const time = 9.137 + frame / 8000;
      assert.equal(read(target, time, current, params), read(source, time, current, params));
      assert.equal(target.left, source.left); assert.equal(target.right, source.right);
    }
    assert.deepEqual(target.exportState(), source.exportState());
  }
});

test('version-one migration retains all four old heads and assigns bounded neutral defaults to new fields', () => {
  const source = new ShapeReader(RATE); run(source, .2, 0, CURRENT, { ...PARAMS, sonification: 'shape' });
  const state = source.exportState();
  const oldFields = ['position', 'direction', 'phase', 'frequency', 'targetFrequency', 'gain', 'active', 'pendingPlacement'];
  const legacy = { version: 1, start: state.start, count: state.count, points: state.points, heads: state.heads.slice(0, 4).map(head => Object.fromEntries(oldFields.map(field => [field, head[field]]))), recordElapsed: state.recordElapsed, controlElapsed: state.controlElapsed, needsControl: state.needsControl, initialized: state.initialized };
  const joined = new ShapeReader(RATE); assert.equal(joined.importState(legacy), true);
  const migrated = joined.exportState();
  for (let index = 0; index < 4; index++) for (const field of oldFields) assert.equal(migrated.heads[index][field], legacy.heads[index][field]);
  assert.equal(migrated.heads.length, 16); assert.ok(migrated.depths.every(depth => depth === 0));
  assert.ok(migrated.heads.slice(4).every(head => head.gain === 0 && head.active === 0 && head.rhythmInitialized === 0));
  for (let frame = 0; frame < 4800; frame++) assert.equal(read(joined, .2 + frame / RATE, CURRENT, { ...PARAMS, sonification: 'shape' }), read(source, .2 + frame / RATE, CURRENT, { ...PARAMS, sonification: 'shape' }));
});

test('hostile new clock, depth and stereo imports are fully transactional', () => {
  const reader = new ShapeReader(RATE); run(reader, .1);
  const state = reader.exportState();
  const mutations = [s => { s.heads[0].tempo = Infinity; }, s => { s.heads[0].beatPhase = 1; }, s => { s.heads[0].pulseEnvelope = 2; }, s => { s.heads[0].pulseAge = -1; }, s => { s.heads[0].secondaryPhase = NaN; }, s => { s.heads[0].leftGain = 100; }, s => { s.depths[0] = 2; }, s => { s.left = 100; }, s => { s.heads.pop(); }, s => { s.heads[0].pulseVoice = 5; }, s => { s.heads[0].decaySeconds = 0; }, s => { s.heads[0].hits = 1e30; }];
  for (const mutate of mutations) {
    const candidate = structuredClone(state); mutate(candidate);
    assert.equal(reader.importState(candidate), false);
    assert.deepEqual(reader.exportState(), state);
  }
});

test('16 heads and every pulse voice remain bounded at extreme mappings and sample rates', () => {
  for (const rate of [8000, 48000, 192000]) for (const pulseVoice of ['pluck', 'bell', 'tick', 'kick']) {
    const reader = new ShapeReader(rate);
    const current = { frequency: 1e30, pitchSpan: 1e30, headRate: 1e30, headSpread: 1e30, travelSpan: 1e30, amplitudeDepth: 1e30, panWidth: 1e30, tempo: 1e30, tempoSpan: 1e30, pulseDecay: .025 };
    const params = { ...PARAMS, headCount: 16, pitchAxis: 'depth', travelAxis: 'bend', amplitudeAxis: 'angle', panAxis: 'horizontal', tempoAxis: 'path', rhythmRatios: 'fibonacci', pulseVoice };
    run(reader, .1, 0, current, params);
    assert.equal(reader.snapshot().heads.length, 16);
    assert.ok(reader.snapshot().heads.every(head => head.tempo >= 8 && head.tempo <= 960 && head.frequency >= 20 && head.frequency <= Math.min(12000, rate * .25)));
  }
});
