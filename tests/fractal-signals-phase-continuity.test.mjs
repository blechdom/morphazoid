import test from 'node:test';
import assert from 'node:assert/strict';
import { FractalDSP, advancePhaseClocks } from '../src/instruments/fractal-signals/dsp.js';
import { createDefaultState } from '../src/instruments/fractal-signals/model.js';

const fract = n => n - Math.floor(n);
const near = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ~= ${expected}`);
const stateFor = (values = {}) => ({ ...createDefaultState('echoes'), engine: 'shepard', sweepRate: .5, base: 440, index: 0,
  depth: 7, inputMix: 1, echoTime: .03, echoRatio: 1.2, memory: .3, space: 0, ...values });
const score = { events: [{ phase: 0, point: 0, duration: .4, amp: .7, freq: 440, pan: 0 }] };
const make = (state = stateFor(), sampleRate = 16000) => new FractalDSP(sampleRate, state, score);
function render(dsp, count, microphone = false) {
  const left = new Float32Array(count), right = new Float32Array(count), input = microphone ? new Float32Array(count).fill(.2) : undefined;
  for (let offset = 0; offset < count; offset += 128) dsp.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128), input?.subarray(offset, offset + 128));
  return { left, right };
}
function registers(dsp) { return { frequencies: [...dsp.shepardFreq], gains: [...dsp.shepardGain] }; }
function sameRegisters(dsp, before) {
  before.frequencies.forEach((value, index) => near(dsp.shepardFreq[index], value, 1e-8));
  before.gains.forEach((value, index) => near(dsp.shepardGain[index], value, 1e-12));
}

test('editing Sweep rate preserves the current register position before integrating the new velocity', () => {
  const dsp = make();
  dsp.motionTime = 123.456; dsp.updateControls();
  const before = registers(dsp), initial = fract(dsp.motionTime * dsp.smooth.sweepRate / 7);
  dsp.setState(stateFor({ sweepRate: 3.75 }), score); dsp.setPlaying(true);
  render(dsp, 1);
  sameRegisters(dsp, before);
  assert.equal(dsp.shepardPhaseTracked, true);
  near(dsp.shepardPhase, fract(initial + dsp.dt * dsp.smooth.sweepRate / 7));
});

test('edited Sweep rate sounds identically from equivalent registers at different elapsed times', () => {
  const a = make(), b = make();
  a.motionTime = 14; b.motionTime = 98;
  for (const dsp of [a, b]) { dsp.setState(stateFor({ sweepRate: 2.37 }), score); dsp.setPlaying(true); }
  assert.deepEqual(render(a, 4096), render(b, 4096));
  assert.deepEqual(registers(a), registers(b));
});

test('changing direction reverses register velocity without moving the current registers', () => {
  const dsp = make();
  dsp.motionTime = 4.321; dsp.updateControls();
  const before = registers(dsp), initial = fract(dsp.motionTime * dsp.smooth.sweepRate / 7);
  dsp.setState(stateFor({ direction: -1 }), score); dsp.setPlaying(true);
  render(dsp, 1);
  sameRegisters(dsp, before);
  near(dsp.shepardPhase, fract(initial - dsp.dt * dsp.smooth.sweepRate / 7));
});

test('manual microphone Root changes preserve carrier phase independently of elapsed session time', () => {
  const state = stateFor({ engine: 'strikes' }), a = make(state), b = make(state);
  a.time = 12.5; b.time = 1012.5;
  for (const dsp of [a, b]) { dsp.setMicrophone(true); dsp.setPlaying(true); dsp.setState({ ...state, base: 660 }, score); }
  assert.deepEqual(render(a, 4096, true), render(b, 4096, true));
  assert.equal(a.rootCarrierTracked, true); assert.equal(b.rootCarrierTracked, true);
});

test('enabling a nonzero Root modulation captures carrier phase before smoothing', () => {
  const state = stateFor({ engine: 'strikes' }), dsp = make(state);
  dsp.time = 12.5;
  dsp.setState({ ...state, lfo1On: true, lfo1Target: 'base', lfo1Shape: 'rise', lfo1Depth: .7 }, score);
  dsp.setPlaying(true); render(dsp, 1, true);
  assert.equal(dsp.rootCarrierTracked, true);
  near(dsp.osc[14], fract(dsp.smooth.base * dsp.dt));
});

test('pause holds phase clocks through edits, then resumes with their new velocities', () => {
  const dsp = make();
  dsp.setState(stateFor({ sweepRate: 2, base: 660 }), score); dsp.setPlaying(true); render(dsp, 1000);
  dsp.setPlaying(false);
  const before = { shepard: dsp.shepardPhase, carrier: dsp.osc[14], time: dsp.time, motionTime: dsp.motionTime };
  dsp.setState(stateFor({ sweepRate: 3, base: 880, direction: -1 }), score); render(dsp, 8000);
  assert.equal(dsp.shepardPhase, before.shepard); assert.equal(dsp.osc[14], before.carrier);
  assert.equal(dsp.time, before.time); assert.equal(dsp.motionTime, before.motionTime);
  dsp.setPlaying(true); render(dsp, 1);
  near(dsp.shepardPhase, fract(before.shepard - dsp.dt * dsp.smooth.sweepRate / 7));
  near(dsp.osc[14], fract(before.carrier + dsp.dt * dsp.smooth.base));
});

test('ping-pong reverses the Shepard clock while the Root carrier keeps moving forward', () => {
  const state = stateFor({ sweepRate: 1, base: 100, rate: 1, phrase: 1, loop: true, pingPong: true }), dsp = make(state, 8000);
  dsp.setPhase(.99, { time: .99, motionTime: .99, phaseClocks: { shepard: .4, rootCarrier: .1 } });
  dsp.setPlaying(true); render(dsp, 240);
  assert.equal(dsp.travelDirection, -1);
  near(dsp.shepardPhase, fract(.4 + (dsp.motionTime - .99) / 7));
  near(dsp.osc[14], .1);
});

test('audio lifetime snapshots restore integrated phases and explicit seek/Restart reset them', () => {
  const state = stateFor({ sweepRate: 2, base: 660 }), dsp = make();
  dsp.setState(state, score); dsp.setPlaying(true); render(dsp, 5000);
  const snapshot = { ...dsp.telemetry, phaseClocks: { ...dsp.telemetry.phaseClocks } }, restored = make(state);
  restored.setPhase(snapshot.phase, snapshot);
  assert.equal(restored.shepardPhase, dsp.shepardPhase); assert.equal(restored.osc[14], dsp.osc[14]);
  assert.equal(restored.shepardPhaseTracked, true); assert.equal(restored.rootCarrierTracked, true);
  restored.setPhase(.37);
  assert.equal(restored.shepardPhaseTracked, false); assert.equal(restored.rootCarrierTracked, false);
  near(restored.motionTime, .37 * restored.state.phrase / restored.state.rate);
  restored.setPhase(0);
  assert.equal(restored.time, 0); assert.equal(restored.motionTime, 0); assert.equal(restored.osc[14], 0);
});

test('silent preview advances handed-off phases through speed edits and return travel', () => {
  const clocks = { shepard: .3, rootCarrier: .2 };
  advancePhaseClocks(clocks, .2, .5, 441);
  near(clocks.shepard, .3 + .1 / 7); near(clocks.rootCarrier, .4);
  const paused = { ...clocks };
  advancePhaseClocks(clocks, 0, 2, 442, 1, -1);
  assert.deepEqual(clocks, paused);
  advancePhaseClocks(clocks, .1, 2, 442, 1, -1);
  near(clocks.shepard, .3 - .1 / 7); near(clocks.rootCarrier, .6);
  const dsp = make(); dsp.setPhase(.2, { phaseClocks: clocks });
  near(dsp.shepardPhase, clocks.shepard); near(dsp.osc[14], clocks.rootCarrier);
});

test('untouched constant-rate patches retain legacy phase arithmetic until a lifetime handoff', () => {
  for (const engine of ['shepard', 'strikes', 'resonant']) {
    const dsp = make(stateFor({ engine })); dsp.setPlaying(true); render(dsp, 2048);
    assert.equal(dsp.shepardPhaseTracked, false, engine); assert.equal(dsp.rootCarrierTracked, false, engine);
    assert.equal(dsp.telemetry.phaseClocks.shepard, fract(dsp.motionTime * dsp.smooth.sweepRate * dsp.state.direction / 7));
    assert.equal(dsp.telemetry.phaseClocks.rootCarrier, fract(dsp.time * dsp.smooth.base));
  }
});
