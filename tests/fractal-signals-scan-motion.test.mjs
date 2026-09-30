import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultState, generateStructure, PARAMS } from '../src/instruments/fractal-signals/model.js';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { createMotions, advanceMotions, rebaseMotions, motionSnapshot } from '../src/instruments/fractal-signals/motions.js';
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ~= ${expected}`);
const scene = extra => ({ ...createDefaultState('grains'), engine: 'sample', ...extra });
function render(dsp, seconds) {
  const count = Math.round(seconds * dsp.sampleRate), left = new Float32Array(count), right = new Float32Array(count);
  for (let i = 0; i < count; i += 128) dsp.process(left.subarray(i, i + 128), right.subarray(i, i + 128));
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite)); return left;
}

test('Source scan holds1 exactly, wraps on the first moving tick, and repeats full signed cycles', () => {
  assert.equal(PARAMS.motionScanTempo.default, 6);
  const state = scene({ scan: 1, motionScanTempo: 60 }), motions = createMotions(state);
  advanceMotions(motions, state, 100); assert.equal(motions.actual.scan, 1);
  const restored = createMotions(state, motionSnapshot(motions)); assert.equal(restored.actual.scan, 1);
  advanceMotions(motions, { ...state, motionScanOn: true, motionScanTempo: 0 }, .2); assert.equal(motions.actual.scan, 1);
  advanceMotions(motions, { ...state, motionScanOn: true }, .125); near(motions.actual.scan, .125);
  advanceMotions(restored, { ...state, motionScanOn: true, motionScanTempo: -60 }, .125); near(restored.actual.scan, .875);
  advanceMotions(motions, { ...state, motionScanOn: true }, 20); near(motions.actual.scan, .125);
});

test('Source scan own pause holds and a manual edit rebases only its position', () => {
  const state = scene({ scan: .8, motionScanOn: true, motionScanTempo: 60 }), motions = createMotions(state);
  advanceMotions(motions, state, .25); near(motions.actual.scan, .05);
  const paused = { ...state, motionScanOn: false }; advanceMotions(motions, paused, 10); near(motions.actual.scan, .05);
  const before = motionSnapshot(motions), edit = { ...paused, scan: 1 }; rebaseMotions(motions, paused, edit);
  assert.equal(motions.actual.scan, 1);
  for (const key of ['branch', 'branchAngle', 'base', 'index', 'turns']) assert.equal(motions.values[key], before.values[key]);
  const restored = createMotions(edit, motionSnapshot(motions)); advanceMotions(motions, state, .125); advanceMotions(restored, state, .125);
  assert.deepEqual(motionSnapshot(restored), motionSnapshot(motions));
});

test('Source scan runs through repeated wraps during phrase pause without a score bank', () => {
  const state = scene({ scan: .8, motionScanOn: true, motionScanTempo: 60 }), structure = generateStructure(state), dsp = new FractalDSP(8000, state, structure);
  render(dsp, 2.25); near(dsp.motions.actual.scan, .05); assert.equal(dsp.phase, 0); assert.equal(dsp.time, 0); assert.equal(dsp.motionBank, null);
  const held = dsp.motions.actual.scan, paused = { ...state, motionScanOn: false }; dsp.setState(paused, structure); render(dsp, .2);
  assert.equal(dsp.motions.actual.scan, held);
  const resumed = new FractalDSP(8000, paused, structure); resumed.setPhase(dsp.phase, { motions: motionSnapshot(dsp.motions) });
  assert.equal(resumed.motions.actual.scan, held);
  dsp.setState(state, structure); resumed.setState(state, structure); render(dsp, .2); render(resumed, .2);
  assert.deepEqual(motionSnapshot(resumed.motions), motionSnapshot(dsp.motions));
});

test('Source scan reaches sample playback without changing attacks or legacy LFO phases', () => {
  const state = scene({ scan: .98, rate: 16, phrase: 8, depth: 4 }), structure = generateStructure(state), results = [];
  for (const motionScanOn of [false, true]) {
    const dsp = new FractalDSP(8000, { ...state, motionScanOn, motionScanTempo: 60 }, structure), attacks = [], trigger = dsp.trigger;
    dsp.trigger = function(event, offset = 0) { if (!offset) attacks.push([event.point, this.time]); return trigger.call(this, event, offset); };
    dsp.setPlaying(true); results.push({ samples: render(dsp, .7), attacks, dsp });
  }
  assert.deepEqual(results[0].attacks, results[1].attacks);
  assert.deepEqual(Array.from(results[0].dsp.lfoPhases), Array.from(results[1].dsp.lfoPhases));
  assert.ok(results[1].samples.some((value, i) => Math.abs(value - results[0].samples[i]) > .001));
  assert.ok(results[1].samples.every(value => Math.abs(value) < .881));
  near(results[1].dsp.motions.actual.scan, .68);
});
