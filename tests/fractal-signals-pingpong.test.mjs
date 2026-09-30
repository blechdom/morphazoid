import assert from 'node:assert/strict';
import test from 'node:test';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { MODES, createDefaultState, generateStructure, sanitizeState } from '../src/instruments/fractal-signals/model.js';
import { USER_PRESET_RECORDS } from '../src/instruments/fractal-signals/user-presets.js';

const branches = [{ id: 'default-branches', snapshot: createDefaultState('grammar') }, ...USER_PRESET_RECORDS.filter(preset => preset.snapshot.mode === 'grammar')];
function play(state, legs, sampleRate = 8000, block = 128) {
  const structure = generateStructure(state), dsp = new FractalDSP(sampleRate, state, structure), attacks = [];
  const trigger = dsp.trigger;
  dsp.trigger = function(event, offset = 0) {
    if (!offset) attacks.push({ point: event.point, eventPhase: event.phase, frequency: event.freq, time: this.time, travelDirection: this.travelDirection });
    return trigger.call(this, event, offset);
  };
  dsp.setPlaying(true);
  const duration = state.phrase / state.rate;
  const samples = Math.ceil(duration * legs * sampleRate) + 1;
  const left = new Float32Array(block), right = new Float32Array(block);
  for (let offset = 0; offset < samples; offset += block) {
    const length = Math.min(block, samples - offset);
    dsp.process(left.subarray(0, length), right.subarray(0, length));
    for (let i = 0; i < length; i++) assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
  }
  return { structure, dsp, attacks, duration };
}
function roundTrip(events) {
  return [...events, ...events.filter(event => event.phase < 1 - 1e-9).reverse()].map(event => event.point);
}

test('generated Branches place geometric endpoints at the ping-pong turns in either orientation', () => {
  for (const preset of branches) {
    const forward = generateStructure({ ...preset.snapshot, direction: 1, pingPong: false });
    const ids = forward.events.map(event => event.point);
    for (const direction of [1, -1]) {
      const structure = generateStructure({ ...preset.snapshot, direction, pingPong: true });
      assert.deepEqual(structure.events.map(event => event.point), direction === 1 ? ids : [...ids].reverse(), preset.id + ' direction ' + direction);
      assert.equal(structure.events[0].phase, 0);
      assert.equal(structure.events.at(-1).phase, 1);
      for (const event of structure.events) assert.equal(structure.points[event.point].phase, event.phase);
      const baseline = new Map(forward.events.map(event => [event.point, event]));
      for (const event of structure.events) for (const key of ['freq', 'amp', 'duration', 'shape', 'pan', 'depth']) assert.equal(event[key], baseline.get(event.point)[key], key + ' survives the timing fix');
    }
  }
});

test('actual default and owner Branches play each end note once before changing leg', () => {
  for (const preset of branches) for (const direction of [1, -1]) for (const loop of [false, true]) {
    const state = sanitizeState({ ...preset.snapshot, direction, loop, pingPong: true });
    const { structure, dsp, attacks, duration } = play(state, 2);
    assert.deepEqual(attacks.map(event => event.point), roundTrip(structure.events), `${preset.id} direction ${direction} loop ${loop}`);
    const final = attacks[structure.events.length - 1], returned = attacks.at(-1);
    assert.equal(final.travelDirection, 1, 'the end note belongs to the outgoing leg');
    assert.equal(returned.travelDirection, -1, 'the start note belongs to the completed return leg');
    assert.ok(Math.abs(final.time - duration) <= 2 / dsp.sampleRate);
    assert.ok(Math.abs(returned.time - 2 * duration) <= 2 / dsp.sampleRate);
    assert.equal(dsp.completed, !loop); assert.equal(dsp.playing, loop);
  }
});

test('repeated generated Branches round trips never insert or repeat a turn note', () => {
  for (const direction of [1, -1]) {
    const state = sanitizeState({ ...createDefaultState('grammar'), direction, loop: true, pingPong: true, rate: 8, phrase: 8 });
    const { structure, attacks } = play(state, 4, 44100, 511);
    const outbound = structure.events.map(event => event.point), returning = outbound.slice(0, -1).reverse();
    assert.deepEqual(attacks.map(event => event.point), [...outbound, ...returning, ...outbound.slice(1), ...returning]);
  }
});

test('generated scores in every mode own both endpoints, including tied endpoint groups', () => {
  let tiedEndpointCases = 0;
  const cases = [...MODES.map(({ id }) => ({ ...createDefaultState(id), rate: 2, phrase: 8 })), ...[.5, 1].map(echoTime => ({ ...createDefaultState('echoes'), depth: 6, branch: 0, phrase: 1, rate: 1, echoTime, echoRatio: 1 }))];
  for (const scene of cases) for (const direction of [1, -1]) {
    const mode = scene.mode;
    const state = sanitizeState({ ...scene, direction, pingPong: true, loop: false });
    const { structure, attacks, dsp } = play(state, 2);
    assert.equal(structure.events[0].phase, 0, mode);
    if (structure.events.some(event => event.phase > 0)) assert.equal(structure.events.at(-1).phase, 1, mode);
    for (const event of structure.events) assert.equal(structure.points[event.point].phase, event.phase, mode);
    assert.deepEqual(attacks.map(event => event.point), roundTrip(structure.events), mode + ' direction ' + direction);
    for (const phase of [0, 1]) {
      const group = structure.events.filter(event => event.phase === phase);
      if (group.length > 1) tiedEndpointCases++;
      for (const event of group) assert.equal(attacks.filter(attack => attack.point === event.point).length, phase === 0 ? 2 : 1, mode + ' tied endpoint ownership');
    }
    assert.equal(dsp.completed, true);
  }
  assert.ok(tiedEndpointCases > 0, 'the generated-score suite includes actual endpoint chords');
});

test('a single-note Branches score remains finite and plays once at each returned start', () => {
  for (const direction of [1, -1]) {
    const state = sanitizeState({ ...createDefaultState('grammar'), depth: 1, branch: 0, direction, pingPong: true, loop: false, rate: 8, phrase: 8 });
    const { structure, attacks, dsp } = play(state, 2);
    assert.equal(structure.events.length, 1); assert.equal(structure.events[0].phase, 0);
    assert.deepEqual(attacks.map(event => event.point), [1, 1]);
    assert.ok(structure.points.every(point => Number.isFinite(point.phase)));
    assert.equal(dsp.completed, true);
  }
});

test('distinct sub-picosecond score phases remain distinct endpoints after normalization', () => {
  for (const direction of [1, -1]) {
    const structure = generateStructure({ ...createDefaultState('echoes'), direction, pingPong: true, depth: 1, branch: 0, phrase: 1, rate: .0625, echoTime: .015, echoRatio: 1, timingBend: 1 });
    assert.equal(structure.events.length, 2);
    assert.deepEqual(structure.events.map(event => event.phase), [0, 1]);
    assert.deepEqual(structure.events.map(event => event.point), direction === 1 ? [0, 1] : [1, 0]);
  }
});
