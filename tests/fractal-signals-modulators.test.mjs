import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, sanitizeState, generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { modulatorSettings, modulationValue, modulatedValues, advanceModulators } from '../src/instruments/fractal-signals/modulators.js';
import { FACTORY_PRESETS } from '../src/instruments/fractal-signals/presets.js';
import { USER_PRESET_RECORDS } from '../src/instruments/fractal-signals/user-presets.js';
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} ~= ${b}`);
function render(state, seconds = .5) {
  const dsp = new FractalDSP(16000, state, generateStructure(state)); dsp.setPlaying(true);
  const left = new Float32Array(seconds * 16000), right = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 128) dsp.process(left.subarray(i, i + 128), right.subarray(i, i + 128));
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.ok(left.every(v => Math.abs(v) <= .881) && right.every(v => Math.abs(v) <= .881));
  return { dsp, left, right };
}
test('supplied patches preserve every supplied value without rounding or changing supplied modulation', () => {
  assert.equal(USER_PRESET_RECORDS.length, 31);
  assert.equal(new Set(USER_PRESET_RECORDS.map(r => JSON.stringify(r.snapshot))).size, 31);
  for (const record of USER_PRESET_RECORDS) {
    const preset = FACTORY_PRESETS.find(p => p.id === `${record.snapshot.mode}-user-${record.id}`);
    assert.ok(preset, record.id);
    for (const [key, value] of Object.entries(record.snapshot)) assert.equal(preset.snapshot[key], value, `${record.id} ${key}`);
    assert.equal(preset.snapshot.lfo1On, record.snapshot.lfo1On === true);
    assert.equal(preset.snapshot.lfo2On, record.snapshot.lfo2On === true);
  }
});
test('waveforms wrap and two routes add before final clamping', () => {
  for (const shape of ['sine', 'triangle', 'rise', 'fall']) for (const p of [0, .125, .5, .99]) {
    near(modulationValue(shape, p), modulationValue(shape, p + 3));
    assert.ok(Math.abs(modulationValue(shape, p)) <= 1);
  }
  const state = sanitizeState({ ...createDefaultState(), index: 32, lfo1On: true, lfo2On: true, lfo1Target: 'index', lfo2Target: 'index', lfo1Shape: 'rise', lfo2Shape: 'fall', lfo1Depth: 1, lfo2Depth: 1 });
  near(modulatedValues(state, modulatorSettings(state), [.25, .25]).index, 32);
  const phases = [.95, .1], slots = modulatorSettings(state); slots[0].rate = 1; slots[1].rate = 2;
  advanceModulators(phases, slots, .2); near(phases[0], .15); near(phases[1], .5);
});
test('disabled routes and zero depth retain exact samples while active routes change sound', () => {
  const state = { ...createDefaultState('wander'), engine: 'cascade', base: 420, index: 2, rate: 12 };
  const baseline = render(state).left;
  const off = render({ ...state, lfo1Rate: 13, lfo1Depth: 1, lfo1Target: 'index', lfo1On: false }).left;
  const zero = render({ ...state, lfo1Rate: 13, lfo1Depth: 0, lfo1Target: 'index', lfo1On: true }).left;
  assert.deepEqual(off, baseline); assert.deepEqual(zero, baseline);
  const on = render({ ...state, lfo1Rate: 3, lfo1Depth: 1, lfo1Target: 'index', lfo1On: true }).left;
  assert.ok(on.some((v, i) => Math.abs(v - baseline[i]) > .001));
});
test('modulator phases follow played samples, survive state edits and pause, and reset with Restart', () => {
  const state = sanitizeState({ ...createDefaultState(), lfo1On: true, lfo1Rate: 1.25, lfo2Rate: 2.5 });
  const { dsp } = render(state, .2), phases = Array.from(dsp.lfoPhases);
  near(phases[0], .25); near(phases[1], .5);
  dsp.setPlaying(false); dsp.process(new Float32Array(128), new Float32Array(128));
  assert.deepEqual(Array.from(dsp.lfoPhases), phases);
  dsp.setState({ ...state, base: 700 }, generateStructure({ ...state, base: 700 }));
  assert.deepEqual(Array.from(dsp.lfoPhases), phases);
  dsp.setPhase(.4, { travelDirection: -1, modPhases: phases });
  assert.deepEqual(Array.from(dsp.lfoPhases), phases);
  dsp.setPhase(0); assert.deepEqual(Array.from(dsp.lfoPhases), [0, 0]);
});

test('root, ratio, delay and stereo-width routes reach the signal path', () => {
  const state = { ...createDefaultState('wander'), engine: 'cascade', base: 420, index: 3, space: .5, rate: 12 };
  const baseline = render(state);
  for (const target of ['base', 'ratio', 'space', 'stereoWidth']) {
    const actual = render({ ...state, lfo1On: true, lfo1Target: target, lfo1Shape: 'sine', lfo1Rate: 2, lfo1Depth: 1 });
    assert.ok(actual.left.some((value, i) => Math.abs(value - baseline.left[i]) > .001), target);
  }
});
test('clocked branch angle changes pitches without changing topology, timing or attack count', () => {
  const state = sanitizeState({ ...createDefaultState('grammar'), branchAngle: 0, rate: 32, phrase: 8, lfo1Target: 'branchAngle', lfo1Rate: 2, lfo1Depth: 1 });
  const off = render(state), on = render({ ...state, lfo1On: true });
  assert.deepEqual(off.dsp.events.map(e => [e.phase, e.point]), on.dsp.events.map(e => [e.phase, e.point]));
  assert.ok(on.left.some((value, i) => Math.abs(value - off.left[i]) > .001));
  near(on.dsp.phase, off.dsp.phase);
  assert.equal(on.dsp.activeEvents, off.dsp.activeEvents);
  const wrap = render({ ...state, branchAngle: 360 });
  assert.deepEqual(wrap.left, off.left);
});

test('microphone strike pitch modulation is independent of elapsed session time', () => {
  const state = sanitizeState({ ...createDefaultState('echoes'), engine: 'strikes', base: 440, inputMix: 1, echoTime: .03, lfo1On: true, lfo1Target: 'base', lfo1Rate: 2, lfo1Depth: 1 });
  const structure = generateStructure(state), a = new FractalDSP(16000, state, structure), b = new FractalDSP(16000, state, structure);
  a.setPlaying(true); b.setPlaying(true); a.setMicrophone(true); b.setMicrophone(true);
  b.time = 1000; // At 440 Hz both sessions start at the same carrier phase.
  const leftA = new Float32Array(128), rightA = new Float32Array(128), leftB = new Float32Array(128), rightB = new Float32Array(128), input = new Float32Array(128).fill(.2);
  for (let block = 0; block < 64; block++) {
    a.process(leftA, rightA, input); b.process(leftB, rightB, input);
    assert.deepEqual(leftA, leftB); assert.deepEqual(rightA, rightB);
  }
  assert.equal(a.rootCarrierTracked, true); assert.equal(b.rootCarrierTracked, true);
});
