import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultState, generateStructure, sanitizeState } from '../src/instruments/fractal-signals/model.js';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { USER_PRESET_RECORDS } from '../src/instruments/fractal-signals/user-presets.js';

function observe(dsp) {
  const scheduled = [], endpointVoices = [], trigger = dsp.trigger;
  dsp.trigger = function(event, offset = 0) {
    const before = this.attackTokens, time = this.time, direction = this.travelDirection;
    const result = trigger.call(this, event, offset);
    const admitted = this.attackTokens <= before - .999999999;
    scheduled.push({ point: event.point, phase: event.phase, time, direction, offset, admitted });
    if (!offset && admitted && (event === this.events[0] || event === this.events.at(-1))) {
      const voice = this.voices.find(v => v.active && v.age === 0 && v.freq === event.freq / this.state.base);
      if (voice) endpointVoices.push({ point: event.point, time, voice, frequency: voice.freq, peak: 0 });
    }
    return result;
  };
  return { scheduled, endpointVoices };
}
function render(dsp, seconds, observed, block = 128) {
  const left = new Float32Array(block), right = new Float32Array(block), samples = Math.ceil(seconds * dsp.sampleRate);
  let minTokens = dsp.attackTokens, peak = 0;
  for (let offset = 0; offset < samples; offset += block) {
    const size = Math.min(block, samples - offset);
    dsp.process(left.subarray(0, size), right.subarray(0, size));
    minTokens = Math.min(minTokens, dsp.attackTokens);
    assert.ok(dsp.voices.filter(voice => voice.active).length <= 32);
    for (let i = 0; i < size; i++) { assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i])); peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); }
    for (const held of observed.endpointVoices) if (dsp.time <= held.time + .012 && held.voice.freq === held.frequency) held.peak = Math.max(held.peak, Math.abs(held.voice.lastL), Math.abs(held.voice.lastR));
  }
  assert.ok(peak < .881);
  return { minTokens, peak };
}
const note = (phase, point, frequency = 220 + point * 11) => ({ phase, point, freq: frequency, amp: .7, duration: .03, pan: point % 2 ? .4 : -.4, depth: 1 });

test('the actual dense Resonant 243 score admits and sounds both ping-pong edges in both orientations', () => {
  const supplied = USER_PRESET_RECORDS.find(preset => preset.id === 'grains-resonant-243').snapshot;
  for (const direction of [1, -1]) {
    const state = sanitizeState({ ...supplied, direction }), structure = generateStructure(state), dsp = new FractalDSP(48000, state, structure), observed = observe(dsp);
    dsp.setPlaying(true);
    const leg = state.phrase / state.rate, result = render(dsp, 2 * leg + .011, observed);
    const scheduled = observed.scheduled.filter(event => !event.offset);
    const expected = [...structure.events, ...structure.events.filter(event => event.phase < 1 - 1e-9).reverse()].map(event => event.point);
    assert.deepEqual(scheduled.slice(0, expected.length).map(event => event.point), expected);
    assert.ok(scheduled.some(event => !event.admitted), 'the real dense score exercises attack limiting');
    const first = structure.events[0].point, last = structure.events.at(-1).point;
    const upper = scheduled.filter(event => event.point === last && Math.abs(event.time - leg) < 2 / dsp.sampleRate);
    const lower = scheduled.filter(event => event.point === first && Math.abs(event.time - 2 * leg) < 2 / dsp.sampleRate);
    assert.equal(upper.length, 1); assert.equal(lower.length, 1);
    assert.equal(upper[0].direction, 1); assert.equal(lower[0].direction, -1);
    assert.equal(upper[0].admitted, true); assert.equal(lower[0].admitted, true);
    for (const edge of [upper[0], lower[0]]) {
      const sounding = observed.endpointVoices.find(held => held.point === edge.point && held.time === edge.time);
      assert.ok(sounding && sounding.peak > 1e-7, `direction ${direction}, point ${edge.point} produces a nonzero voice`);
    }
    assert.ok(result.minTokens >= -1);
  }
});

test('only true outer endpoint attacks may borrow, and cloud children use ordinary tokens', () => {
  const state = { ...createDefaultState('grains'), engine: 'cloud', pingPong: true };
  const structure = { events: [note(0, 0), note(.5, 1), note(1 - 1e-10, 2), note(1, 3)] };
  const dsp = new FractalDSP(8000, state, structure), observed = observe(dsp);
  dsp.attackTokens = .25;
  dsp.trigger(dsp.events[1]); dsp.trigger(dsp.events[2]);
  assert.equal(dsp.attackTokens, .25, 'interior and near-end events cannot borrow');
  dsp.trigger(dsp.events.at(-1));
  assert.equal(dsp.attackTokens, -.75);
  assert.equal(observed.scheduled.filter(event => event.admitted).length, 1);
  assert.ok(observed.scheduled.filter(event => event.offset).every(event => !event.admitted));
  dsp.trigger(dsp.events.at(-1));
  assert.equal(dsp.attackTokens, -.75, 'an unpaid endpoint cannot borrow again');
});

test('tied endpoint groups protect the actual arriving outer note without bypassing the bucket', () => {
  const state = { ...createDefaultState('grammar'), engine: 'bell', pingPong: true };
  const structure = { events: [...Array.from({ length: 24 }, (_, point) => note(0, point)), ...Array.from({ length: 24 }, (_, point) => note(1, point + 24))] };
  for (const direction of [1, -1]) {
    const dsp = new FractalDSP(8000, state, structure), observed = observe(dsp);
    dsp.travelDirection = direction; dsp.phase = direction > 0 ? 1 : 0; dsp.seekEvents(true); dsp.attackTokens = 0;
    dsp.scheduleEvents(dsp.phase);
    const admitted = observed.scheduled.filter(event => event.admitted);
    assert.deepEqual(admitted.map(event => event.point), [direction > 0 ? 47 : 0]);
    assert.equal(dsp.attackTokens, -1);
  }
});

test('the shortest dense ping-pong legs keep the 480-per-second bound plus one borrowed token', () => {
  const state = { ...createDefaultState('grains'), engine: 'cloud', rate: 64, phrase: 1, pingPong: true, loop: true, grainSize: .015 };
  const structure = { events: [...Array.from({ length: 24 }, (_, point) => note(0, point)), ...Array.from({ length: 336 }, (_, point) => note((point + 1) / 337, point + 24)), ...Array.from({ length: 24 }, (_, point) => note(1, point + 360))] };
  const dsp = new FractalDSP(8000, state, structure), observed = observe(dsp); dsp.setPlaying(true);
  const result = render(dsp, 2.001, observed, 1);
  const admitted = observed.scheduled.filter(event => event.admitted);
  for (let i = 0; i < admitted.length; i++) assert.ok(i + 1 <= 17 + 480 * (admitted[i].time + dsp.dt) + 1e-7, 'all voices, including cloud children, consume the same bounded bucket');
  assert.ok(result.minTokens >= -1 - 1e-10);
  const outer = observed.scheduled.filter(event => !event.offset && (event.point === 0 || event.point === 383));
  assert.ok(outer.length >= 129); assert.ok(outer.every(event => event.admitted));
  assert.ok(observed.scheduled.some(event => !event.admitted), 'oversized tied groups remain bounded');
});

test('switching ping-pong off during return still protects its finishing start note', () => {
  const state = { ...createDefaultState('grammar'), pingPong: true, loop: true, rate: 1, phrase: 1 }, structure = { events: [note(0, 0), note(1, 1)] };
  const dsp = new FractalDSP(8000, state, structure), observed = observe(dsp);
  dsp.setPhase(.00001, { travelDirection: -1 }); dsp.setPlaying(true);
  dsp.setState({ ...state, pingPong: false }, structure); dsp.attackTokens = .25;
  render(dsp, dsp.dt, observed, 1);
  assert.deepEqual(observed.scheduled.map(event => [event.point, event.admitted]), [[0, true]]);
  assert.equal(dsp.travelDirection, 1); assert.equal(dsp.state.pingPong, false);
  assert.ok(dsp.attackTokens < 0 && dsp.attackTokens >= -1);
});

test('ordinary playback cannot borrow endpoint tokens', () => {
  const state = { ...createDefaultState('grammar'), pingPong: false }, structure = { events: [note(0, 0), note(1, 1)] };
  const dsp = new FractalDSP(8000, state, structure), observed = observe(dsp); dsp.attackTokens = .25;
  dsp.trigger(dsp.events[0]); dsp.trigger(dsp.events.at(-1));
  assert.ok(observed.scheduled.every(event => !event.admitted)); assert.equal(dsp.attackTokens, .25);
});
