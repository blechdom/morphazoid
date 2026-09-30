import assert from 'node:assert/strict';
import test from 'node:test';
import { FractalDSP, sanitizeDSPState, DSP_ENGINES } from '../src/instruments/fractal-signals/dsp.js';
import { createDefaultState, sanitizeState, generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS } from '../src/instruments/fractal-signals/presets.js';

const SR = 8000;
const patch = (values = {}) => ({ ...createDefaultState('wander'), rate: 1, phrase: 1, space: 0, memory: 0, attack: .005, decay: .02, sustain: .8, release: .12, ...values });
const score = (phases = [0, .2, .5, .8, 1]) => ({ events: phases.map((phase, point) => ({ phase, point, freq: 180 + point * 73, amp: .55, duration: .05, pan: point % 2 ? .4 : -.4 })) });
function instrument(state, structure = score()) {
  const dsp = new FractalDSP(SR, state, structure), attacks = [];
  const trigger = dsp.trigger;
  dsp.trigger = function(event, cloudOffset = 0) {
    if (!cloudOffset) attacks.push({ point: event.point, phase: this.phase, time: this.time, travelDirection: this.travelDirection, direction: this.state.direction * this.travelDirection });
    return trigger.call(this, event, cloudOffset);
  };
  dsp.setPlaying(true);
  return { dsp, attacks };
}
function render(dsp, seconds, { block = 128, input } = {}) {
  const count = Math.round(seconds * dsp.sampleRate), left = new Float32Array(count), right = new Float32Array(count);
  for (let offset = 0; offset < count; offset += block) {
    const end = Math.min(count, offset + block);
    dsp.process(left.subarray(offset, end), right.subarray(offset, end), input?.subarray(offset, end));
  }
  return { left, right };
}
function rms(values) { return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length)); }
function peak(values) { return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0); }
function bounded({ left, right }) {
  for (const channel of [left, right]) for (const value of channel) assert.ok(Number.isFinite(value) && Math.abs(value) < .881);
}

test('missing transport switches preserve legacy loop policy and complete presets', () => {
  for (const sanitize of [sanitizeState, sanitizeDSPState]) {
    assert.equal(sanitize({}).loop, true); assert.equal(sanitize({}).pingPong, false);
    assert.equal(sanitize({ loop: false, pingPong: true }).loop, false);
    assert.equal(sanitize({ loop: false, pingPong: true }).pingPong, true);
    assert.equal(sanitize({ loop: 'false', pingPong: 'true' }).loop, true);
    assert.equal(sanitize({ loop: 'false', pingPong: 'true' }).pingPong, false);
  }
  for (const preset of FACTORY_PRESETS.filter(item => !item.id.includes('-user-'))) {
    assert.equal(preset.snapshot.loop, true); assert.equal(preset.snapshot.pingPong, false);
  }
});

test('forward and reverse generated scores sound in their geometric event order', () => {
  const state = patch({ branch: .5, depth: 3, loop: false });
  const structures = [1, -1].map(direction => generateStructure({ ...state, direction }));
  const positive = structures[0].events.filter(event => event.phase > 1e-9).map(event => event.point);
  const reversed = structures[1].events.filter(event => event.phase > 1e-9).map(event => event.point);
  assert.deepEqual(reversed, [...positive].reverse());
  for (const direction of [1, -1]) {
    const structure = structures[direction === 1 ? 0 : 1], { dsp, attacks } = instrument({ ...state, direction }, structure);
    render(dsp, 1.1);
    assert.deepEqual(attacks.map(event => event.point), structure.events.map(event => event.point));
    assert.equal(dsp.phase, 1); assert.equal(dsp.playing, false); assert.equal(dsp.completed, true);
    assert.ok(attacks.every(event => event.direction === direction));
  }
});

test('Loop off sounds one pass, consumes the final sample, and never attacks after completion', () => {
  const { dsp, attacks } = instrument(patch({ loop: false }), score([0, .3, .99995, 1]));
  render(dsp, 1.001);
  assert.deepEqual(attacks.map(event => event.point), [0, 1, 2, 3]);
  assert.equal(dsp.phase, 1); assert.equal(dsp.completed, true); assert.equal(dsp.playing, false);
  assert.ok(Math.abs(dsp.time - 1) <= 1 / SR + 1e-10);
  const phase = dsp.phase, time = dsp.time;
  render(dsp, 2);
  assert.equal(attacks.length, 4); assert.equal(dsp.phase, phase); assert.equal(dsp.time, time);
  assert.equal(dsp.telemetry.playing, false); assert.equal(dsp.telemetry.completed, true);
});

test('Ping-pong without Loop makes one out-and-back with each endpoint owned once', () => {
  for (const direction of [1, -1]) {
    const { dsp, attacks } = instrument(patch({ loop: false, pingPong: true, direction }));
    render(dsp, 2.01);
    assert.deepEqual(attacks.map(event => event.point), [0, 1, 2, 3, 4, 3, 2, 1, 0]);
    assert.deepEqual(attacks.map(event => event.direction), [direction, direction, direction, direction, direction, -direction, -direction, -direction, -direction]);
    assert.equal(dsp.phase, 0); assert.equal(dsp.travelDirection, -1);
    assert.equal(dsp.completed, true); assert.equal(dsp.playing, false);
    assert.ok(Math.abs(dsp.time - 2) <= 2 / SR + 1e-10);
    assert.ok(Math.abs(dsp.motionTime) <= 2 / SR + 1e-10);
  }
});

test('looped Ping-pong does not duplicate endpoint attacks at either turnaround', () => {
  const { dsp, attacks } = instrument(patch({ loop: true, pingPong: true }));
  render(dsp, 4.01);
  assert.deepEqual(attacks.map(event => event.point), [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0]);
  assert.equal(dsp.playing, true); assert.equal(dsp.completed, false);
  assert.equal(dsp.travelDirection, 1);
});

test('pause/resume on the return leg preserves travel and does not retrigger a played point', () => {
  const { dsp, attacks } = instrument(patch({ pingPong: true, loop: false }));
  render(dsp, 1.43);
  const before = { phase: dsp.phase, time: dsp.time, direction: dsp.travelDirection, cursor: dsp.nextEvent };
  const count = attacks.length;
  dsp.setPlaying(false); render(dsp, .8);
  assert.equal(dsp.phase, before.phase); assert.equal(dsp.time, before.time);
  assert.equal(dsp.travelDirection, before.direction); assert.equal(dsp.nextEvent, before.cursor);
  assert.equal(attacks.length, count);
  dsp.setPlaying(true); render(dsp, .6);
  assert.deepEqual(attacks.map(event => event.point), [0, 1, 2, 3, 4, 3, 2, 1, 0]);
  assert.equal(dsp.completed, true);
});

test('state and preset edits preserve return phase, with a new loop policy applied at its endpoint', () => {
  const { dsp } = instrument(patch({ pingPong: true }));
  render(dsp, 1.4);
  const before = { phase: dsp.phase, time: dsp.time, motionTime: dsp.motionTime, travelDirection: dsp.travelDirection };
  const preset = FACTORY_PRESETS.find(p => p.snapshot.mode === 'grains').snapshot;
  dsp.setState(preset, generateStructure(preset));
  for (const [key, value] of Object.entries(before)) assert.equal(dsp[key], value, key);
  assert.equal(dsp.playing, true); assert.equal(dsp.microphone, false);
  dsp.setState({ ...preset, rate: 1, phrase: 1, loop: false, pingPong: false }, score());
  bounded(render(dsp, 1));
  assert.equal(dsp.phase, 0); assert.equal(dsp.completed, true); assert.equal(dsp.playing, false);
});

test('turning off Ping-pong during return finishes that leg before normal looping', () => {
  const state = patch({ pingPong: true }), { dsp } = instrument(state);
  render(dsp, 1.4);
  const phase = dsp.phase;
  dsp.setState({ ...state, pingPong: false }, score());
  assert.equal(dsp.phase, phase); assert.equal(dsp.travelDirection, -1);
  render(dsp, .8);
  assert.equal(dsp.travelDirection, 1); assert.equal(dsp.playing, true);
  assert.ok(dsp.phase > .19 && dsp.phase < .21);
});

test('Play after completion and explicit Restart begin a fresh initial traversal', () => {
  const { dsp, attacks } = instrument(patch({ loop: false, pingPong: true, direction: -1 }));
  render(dsp, 2.05); assert.equal(dsp.completed, true);
  dsp.setPlaying(true);
  assert.equal(dsp.phase, 0); assert.equal(dsp.travelDirection, 1); assert.equal(dsp.completed, false);
  render(dsp, .21);
  assert.deepEqual(attacks.slice(-2).map(event => event.point), [0, 1]);
  dsp.setPhase(0);
  assert.equal(dsp.phase, 0); assert.equal(dsp.travelDirection, 1); assert.equal(dsp.playing, true);
});

test('a transport snapshot restores the return leg and continuous motion clock', () => {
  const state = patch({ pingPong: true, loop: false }), { dsp } = instrument(state);
  render(dsp, 1.35);
  const snapshot = { ...dsp.telemetry }, restored = new FractalDSP(SR, state, score());
  restored.setPhase(snapshot.phase, snapshot); restored.setPlaying(snapshot.playing);
  for (const key of ['phase', 'time', 'motionTime', 'travelDirection', 'completed']) assert.equal(restored[key], dsp[key]);
  render(dsp, .4); render(restored, .4);
  for (const key of ['phase', 'time', 'motionTime', 'travelDirection', 'completed']) assert.equal(restored[key], dsp[key]);
});

test('automatic completion closes held gates but preserves an audible ADSR release', () => {
  const { dsp } = instrument(patch({ loop: false, release: .6 }), { events: [{ phase: .6, point: 0, freq: 530, amp: .7, duration: 3, pan: 0 }] });
  render(dsp, 1.01);
  const active = dsp.voices.filter(voice => voice.active);
  assert.ok(active.length); assert.equal(dsp.playing, false); assert.equal(dsp.releasing, true);
  for (const voice of active) { assert.ok(voice.gate <= voice.age); assert.ok(voice.length <= voice.gate + .6 + 1e-9); }
  const tail = render(dsp, 1.5);
  assert.ok(rms(tail.left.subarray(0, SR * .25)) > .005, 'the configured release remains audible');
  assert.equal(peak(tail.left.subarray(SR * 1.2)), 0, 'the tail eventually reaches exact silence');
  assert.equal(dsp.releasing, false);
});

test('late echoes survive silent gaps after the phrase finishes', () => {
  const state = patch({ mode: 'echoes', engine: 'strikes', loop: false, depth: 1, echoTime: 2, echoRatio: 1, release: .04 });
  const { dsp } = instrument(state, { events: [{ phase: .2, point: 0, freq: 430, amp: .7, duration: .03, pan: 0 }] });
  const audio = render(dsp, 5);
  assert.ok(rms(audio.left.subarray(SR * 2.2, SR * 2.3)) > .001, 'a delayed tap arrives after completion');
  assert.equal(peak(audio.left.subarray(SR * 4.8)), 0);
  assert.equal(dsp.completed, true); assert.equal(dsp.releasing, false);
});

test('one-shot microphone excitation releases while capture and analysis remain available', () => {
  const state = patch({ mode: 'echoes', engine: 'shepard', loop: false, depth: 1, echoTime: .15, echoRatio: 1, release: .1, inputMix: 1 });
  const { dsp, attacks } = instrument(state);
  dsp.setMicrophone(true);
  const input = Float32Array.from({ length: SR * 3 }, (_, sample) => .3 * Math.sin(sample / SR * Math.PI * 2 * 280));
  const audio = render(dsp, 3, { input });
  assert.ok(rms(audio.left.subarray(SR * .3, SR * .9)) > .001);
  assert.equal(peak(audio.left.subarray(SR * 2.7)), 0, 'continued microphone input cannot sustain a completed phrase');
  assert.equal(attacks.length, 5); assert.equal(dsp.microphone, true); assert.ok(dsp.telemetry.inputRms > .01);
});

test('new grain attacks and the continuous Shepard clock follow the current leg', () => {
  const { dsp } = instrument(patch({ mode: 'grains', engine: 'sample', pingPong: true, grainSize: .4 }), score([.1, .9]));
  render(dsp, .95);
  assert.ok(dsp.voices.some(voice => voice.active && voice.sourceStep > 0));
  render(dsp, .25);
  assert.equal(dsp.travelDirection, -1);
  assert.ok(dsp.voices.some(voice => voice.active && voice.sourceStep < 0));
  const before = dsp.motionTime; render(dsp, .1);
  assert.ok(Math.abs(dsp.motionTime - (before - .1)) < 1e-9);
});

test('single-pass and round-trip timing is independent of process block size', () => {
  for (const pingPong of [false, true]) {
    const state = patch({ loop: false, pingPong });
    const a = instrument(state), b = instrument(state);
    const one = render(a.dsp, 2.4, { block: 128 }), two = render(b.dsp, 2.4, { block: 511 });
    assert.deepEqual(one.left, two.left); assert.deepEqual(one.right, two.right);
    assert.deepEqual(a.attacks, b.attacks); assert.equal(a.dsp.phase, b.dsp.phase);
  }
});

test('all engines remain finite and bounded through one-shot ping-pong and tails', () => {
  for (const [mode, engines] of Object.entries(DSP_ENGINES)) for (const engine of engines) {
    const state = patch({ mode, engine, loop: false, pingPong: true, rate: 4, phrase: 1, memory: .65, space: .75, release: .3 });
    const { dsp, attacks } = instrument(state, score([0, .2, .5, .8, 1]));
    const audio = render(dsp, 1.5); bounded(audio);
    assert.equal(dsp.playing, false, engine); assert.equal(dsp.completed, true, engine);
    assert.deepEqual(attacks.map(event => event.point), [0, 1, 2, 3, 4, 3, 2, 1, 0], engine);
    assert.ok(rms(audio.left) > .0001, engine);
  }
});


test('a final-sample event finishes its existing attack and sounds during release', () => {
  const { dsp, attacks } = instrument(patch({ loop: false, attack: .02, release: .25 }), score([1]));
  const audio = render(dsp, 1.5);
  assert.equal(attacks.length, 1);
  assert.ok(rms(audio.left.subarray(SR * 1.02, SR * 1.12)) > .005, 'terminal event is audible, not only counted');
  assert.equal(dsp.playing, false); assert.equal(dsp.completed, true);
  assert.equal(peak(audio.left.subarray(SR * 1.45)), 0);
});

test('the longest delayed tap survives a muted master and a long quiet gap', () => {
  const state = patch({ mode: 'echoes', engine: 'strikes', loop: false, depth: 3, echoTime: 3, echoRatio: 2.5, release: .04 });
  const { dsp } = instrument(state, { events: [{ phase: .2, point: 0, freq: 430, amp: .7, duration: .03, pan: 0 }] });
  render(dsp, 1);
  dsp.setLevel(0); render(dsp, 6.8);
  assert.equal(dsp.releasing, true, 'muting does not discard delay memory');
  dsp.setLevel(.55);
  const late = render(dsp, .5);
  assert.ok(rms(late.left.subarray(SR * .3, SR * .4)) > .0001, 'the 7.9-second tap remains audible after unmuting');
  const tail = render(dsp, 10);
  assert.equal(peak(tail.left.subarray(SR * 9.8)), 0);
  assert.equal(dsp.releasing, false);
});

test('fractional-sample boundaries preserve endpoint order at browser sample rates and fastest tempo', () => {
  for (const sampleRate of [8000, 24000, 44100, 48000, 96000]) {
    const state = patch({ loop: false, pingPong: true, rate: 64, phrase: 1 });
    const dsp = new FractalDSP(sampleRate, state, score()), attacks = [], trigger = dsp.trigger;
    dsp.trigger = function(event, offset) { attacks.push(event.point); return trigger.call(this, event, offset); };
    dsp.setPlaying(true); render(dsp, .04);
    assert.deepEqual(attacks, [0, 1, 2, 3, 4, 3, 2, 1, 0], String(sampleRate));
    assert.equal(dsp.phase, 0); assert.equal(dsp.completed, true);
    assert.ok(Math.abs(dsp.time - 2 / 64) <= 2 / sampleRate + 1e-10);
  }
});
