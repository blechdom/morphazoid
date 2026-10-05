import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERCUSSION_LANES, PERCUSSION_METHODS, PERCUSSION_STEP_COUNT, PERCUSSION_VOICE_RANGES,
  getPercussionMethod, createPercussionState, sanitizePercussionState,
  applyPercussionKit, applyPercussionRhythm, randomizePercussionKit,
  randomizePercussionRhythm, compilePercussionSequence,
} from '../src/instruments/synthesis/percussion-state.js';

function random(seed) {
  let value = seed >>> 0;
  return () => ((value = Math.imul(value, 1664525) + 1013904223 >>> 0) / 4294967296);
}
const countHits = state => state.steps.flat().filter(value => value > 0).length;
const checkState = state => {
  assert.equal(state.version, 1);
  assert.equal(state.voices.length, 8);
  assert.equal(state.steps.length, 8);
  for (const voice of state.voices) {
    assert.deepEqual(Object.keys(voice), Object.keys(PERCUSSION_VOICE_RANGES));
    for (const [key, [lo, hi]] of Object.entries(PERCUSSION_VOICE_RANGES)) {
      assert.ok(Number.isFinite(voice[key]), `${key} must be finite`);
      assert.ok(voice[key] >= lo && voice[key] <= hi, `${key}=${voice[key]} outside ${lo}..${hi}`);
    }
    assert.ok(Number.isInteger(voice.model));
  }
  for (const lane of state.steps) {
    assert.equal(lane.length, 16);
    for (const value of lane) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
  assert.ok(Number.isFinite(state.swing) && state.swing >= 0 && state.swing <= .45);
  assert.ok(Number.isInteger(state.selectedLane) && state.selectedLane >= 0 && state.selectedLane < 8);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
};

test('six historical families have distinct documented models and original presets', () => {
  assert.equal(PERCUSSION_METHODS.length, 6);
  assert.equal(PERCUSSION_LANES.length, 8);
  assert.equal(PERCUSSION_STEP_COUNT, 16);
  assert.equal(new Set(PERCUSSION_METHODS.map(method => method.id)).size, PERCUSSION_METHODS.length);
  assert.deepEqual(PERCUSSION_METHODS.map(method => method.date), ['1980', '1980', '1981', '1983', '1994', '2020']);
  for (const method of PERCUSSION_METHODS) {
    assert.ok(method.label.length > 0);
    assert.match(method.description, /original|independent/i);
    assert.ok(method.sources.length >= 1);
    for (const reference of method.sources) {
      assert.ok(reference.label.length > 0);
      assert.equal(new URL(reference.url).protocol, 'https:');
    }
    assert.equal(method.kits.length, 3);
    assert.equal(method.rhythms.length, 3);
    assert.equal(new Set(method.kits.map(kit => kit.id)).size, 3);
    assert.equal(new Set(method.rhythms.map(rhythm => rhythm.id)).size, 3);
    assert.equal(new Set(method.kits.map(kit => JSON.stringify(kit.voices))).size, 3);
    assert.equal(new Set(method.rhythms.map(rhythm => JSON.stringify(rhythm.lanes))).size, 3);
    assert.equal(new Set(method.controls).size, method.controls.length);
    for (const key of method.controls) assert.ok(Object.hasOwn(PERCUSSION_VOICE_RANGES, key));
    assert.ok(Object.isFrozen(method));
    assert.ok(Object.isFrozen(method.kits[0].voices[0]));
    assert.ok(Object.isFrozen(method.rhythms[0].lanes[0]));
    assert.ok(Object.isFrozen(method.sources[0]));
  }
  assert.ok(getPercussionMethod('pcm-lm1').kits.every(kit => kit.voices.every(voice => voice.model === 5)));
  assert.ok(getPercussionMethod('modal-wavedrum').kits.every(kit => kit.voices.every(voice => voice.model === 4)));
  assert.ok(getPercussionMethod('fm-cycles').kits.every(kit => kit.voices.every(voice => voice.model === 3)));
  for (const kit of getPercussionMethod('hybrid909').kits) {
    assert.deepEqual(kit.voices.map(voice => voice.model), [0, 0, 5, 5, 0, 0, 1, 5]);
  }
});

test('all kits and rhythm combinations are valid, audible candidates with distinct sound/rhythm state', () => {
  const before = JSON.stringify(PERCUSSION_METHODS);
  for (const method of PERCUSSION_METHODS) for (const kit of method.kits) for (const rhythm of method.rhythms) {
    const state = applyPercussionRhythm(applyPercussionKit(createPercussionState(method.id), kit.id), rhythm.id);
    checkState(state);
    assert.deepEqual(state.voices, kit.voices, `${method.id}/${kit.id} was silently clamped`);
    assert.deepEqual(state.steps, rhythm.lanes);
    assert.ok(countHits(state) >= 4 && countHits(state) < 96);
    assert.ok(state.steps.some(lane => lane.some(value => value === 0)));
    assert.ok(state.steps.some(lane => lane.some(value => value > 0 && value < .6)));
    assert.ok(state.voices.every(voice => voice.level > 0));
    assert.equal(compilePercussionSequence(state).steps.flatMap(step => step.notes).length, countHits(state));
  }
  assert.equal(JSON.stringify(PERCUSSION_METHODS), before);
});

test('new states, recall and sanitation never alias caller data or factory definitions', () => {
  const originalCatalog = JSON.stringify(PERCUSSION_METHODS);
  const first = createPercussionState(), second = createPercussionState();
  first.voices[0].frequency = 777;
  first.steps[0][0] = 0;
  assert.notEqual(second.voices[0].frequency, 777);
  assert.notEqual(second.steps[0][0], 0);
  const sanitized = sanitizePercussionState(first);
  sanitized.steps[0][1] = .123;
  sanitized.voices[0].noise = .321;
  assert.notEqual(first.steps[0][1], .123);
  assert.notEqual(first.voices[0].noise, .321);
  const recalled = applyPercussionKit(second, getPercussionMethod().kits[1].id);
  recalled.voices[0].frequency = 999;
  recalled.steps[1][0] = .123;
  assert.notEqual(second.voices[0].frequency, 999);
  assert.notEqual(second.steps[1][0], .123);
  assert.equal(JSON.stringify(PERCUSSION_METHODS), originalCatalog);
});

test('kit recall preserves edited rhythm, swing, selection and source state', () => {
  for (const method of PERCUSSION_METHODS) {
    const state = createPercussionState(method.id);
    state.steps[3][5] = .314;
    state.rhythmId = 'custom'; state.swing = .28; state.selectedLane = 6;
    const before = JSON.stringify(state), selected = method.kits[2];
    const next = applyPercussionKit(state, selected.id);
    assert.deepEqual(next.voices, selected.voices);
    assert.equal(next.kitId, selected.id);
    assert.equal(next.rhythmId, 'custom');
    assert.deepEqual(next.steps, state.steps);
    assert.equal(next.swing, .28);
    assert.equal(next.selectedLane, 6);
    assert.equal(JSON.stringify(state), before);
  }
});

test('rhythm recall preserves edited sound, swing, selection and source state', () => {
  for (const method of PERCUSSION_METHODS) {
    const state = createPercussionState(method.id);
    state.voices[5].frequency = 315.75; state.voices[0].level = 0;
    state.kitId = 'custom'; state.swing = .19; state.selectedLane = 5;
    const before = JSON.stringify(state), selected = method.rhythms[2];
    const next = applyPercussionRhythm(state, selected.id);
    assert.deepEqual(next.voices, state.voices);
    assert.equal(next.kitId, 'custom');
    assert.deepEqual(next.steps, selected.lanes);
    assert.equal(next.rhythmId, selected.id);
    assert.equal(next.swing, .19);
    assert.equal(next.selectedLane, 5);
    assert.equal(JSON.stringify(state), before);
  }
});

test('hostile musical values are finite and bounded without copying transport/device fields', () => {
  for (const input of [null, undefined, 9, 'garbage', true, [], { methodId: 'missing' }]) checkState(sanitizePercussionState(input));
  const state = sanitizePercussionState({
    version: 99, methodId: 'pcm-lm1', kitId: 'bad', rhythmId: 'bad', selectedLane: 900,
    voices: [{ model: 8, frequency: Infinity, decay: -5, tone: 4, noise: '-1', sweep: 99, ratio: 0, index: '3.4', level: 0, pan: -9 }],
    steps: [[0, -9, 40, Infinity, '0.3', null]], swing: 100,
    audioEnabled: true, playing: true, context: { state: 'running' }, inputDevice: 'microphone',
  });
  checkState(state);
  assert.equal(state.methodId, 'pcm-lm1');
  assert.equal(state.voices[0].model, 5);
  assert.equal(state.voices[0].frequency, getPercussionMethod('pcm-lm1').kits[0].voices[0].frequency);
  assert.equal(state.voices[0].decay, .03);
  assert.equal(state.voices[0].tone, 1);
  assert.equal(state.voices[0].noise, 0);
  assert.equal(state.voices[0].sweep, 48);
  assert.equal(state.voices[0].ratio, .125);
  assert.equal(state.voices[0].index, 3.4);
  assert.equal(state.voices[0].level, 0);
  assert.equal(state.voices[0].pan, -1);
  assert.deepEqual(state.steps[0].slice(0, 3), [0, 0, 1]);
  assert.equal(state.steps[0][4], .3);
  assert.equal(state.selectedLane, 7);
  assert.equal(state.swing, .45);
  for (const key of ['audioEnabled', 'playing', 'context', 'inputDevice']) assert.equal(Object.hasOwn(state, key), false);
  assert.deepEqual(sanitizePercussionState(state), state);
});

test('explicit silence is retained and malformed grids recover deterministically', () => {
  const state = createPercussionState();
  state.steps = Array.from({ length: 8 }, () => Array(16).fill(0));
  assert.equal(countHits(sanitizePercussionState(state)), 0);
  assert.ok(compilePercussionSequence(state).steps.every(step => step.notes.length === 0));
  state.steps = [Array(100).fill(.9)]; state.voices = Array(100).fill({ level: .7 });
  checkState(sanitizePercussionState(state));
  assert.equal(sanitizePercussionState(state).steps[0].length, 16);
  assert.deepEqual(sanitizePercussionState(state), sanitizePercussionState(state));
  assert.equal(sanitizePercussionState({ swing: NaN }).swing, 0);
  assert.equal(sanitizePercussionState({ selectedLane: -3 }).selectedLane, 0);
  assert.deepEqual(applyPercussionKit(createPercussionState(), 'invalid'), createPercussionState());
  assert.deepEqual(applyPercussionRhythm(createPercussionState(), 'invalid'), createPercussionState());
});

test('sound dice is seeded, detached, remains in its family and generates every exposed parameter', () => {
  for (const method of PERCUSSION_METHODS) {
    const state = createPercussionState(method.id), before = JSON.stringify(state);
    state.swing = .24; state.selectedLane = 7;
    const samples = Array.from({ length: 32 }, (_, index) => randomizePercussionKit(state, random(index + 19)));
    for (const next of samples) {
      checkState(next);
      assert.equal(next.methodId, method.id);
      assert.equal(next.kitId, 'custom');
      assert.equal(next.rhythmId, state.rhythmId);
      assert.deepEqual(next.steps, state.steps);
      assert.equal(next.swing, state.swing);
      assert.equal(next.selectedLane, state.selectedLane);
      assert.deepEqual(next.voices.map(voice => voice.model), method.kits[0].voices.map(voice => voice.model));
      assert.ok(method.kits.every(kit => JSON.stringify(kit.voices) !== JSON.stringify(next.voices)));
      assert.ok(next.voices.every(voice => voice.level >= .25));
    }
    for (const key of method.controls) for (let lane = 0; lane < 8; lane++) {
      assert.ok(new Set(samples.map(sample => sample.voices[lane][key])).size > 8, `${method.id} lane ${lane}: ${key} frozen`);
    }
    assert.deepEqual(randomizePercussionKit(state, random(12)), randomizePercussionKit(state, random(12)));
    state.swing = 0; state.selectedLane = 0;
    assert.equal(JSON.stringify(state), before);
  }
});

test('rhythm dice remains audible, leaves rests, limits attacks, preserves edited sound and is not preset selection', () => {
  for (const method of PERCUSSION_METHODS) {
    const state = createPercussionState(method.id);
    state.voices[3].tone = .123; state.kitId = 'custom'; state.selectedLane = 4;
    const before = JSON.stringify(state), grids = new Set();
    for (let seed = 0; seed < 100; seed++) {
      const next = randomizePercussionRhythm(state, random(seed * 2341 + 3));
      checkState(next);
      assert.equal(next.methodId, method.id);
      assert.equal(next.rhythmId, 'custom');
      assert.equal(next.kitId, state.kitId);
      assert.deepEqual(next.voices, state.voices);
      assert.equal(next.selectedLane, 4);
      assert.ok(countHits(next) >= 4 && countHits(next) <= 64);
      assert.ok(next.steps.flat().some(value => value === 0));
      assert.ok(next.steps[0][0] > 0);
      assert.ok(next.steps[1][8] > 0 || next.steps[1][12] > 0);
      assert.ok(next.steps[2][2] > 0 && next.steps[2][10] > 0);
      for (let step = 0; step < 16; step++) {
        assert.ok(next.steps.filter(lane => lane[step] > 0).length <= 4);
        assert.equal(next.steps[2][step] > 0 && next.steps[3][step] > 0, false);
      }
      assert.ok(method.rhythms.every(rhythm => JSON.stringify(rhythm.lanes) !== JSON.stringify(next.steps)));
      grids.add(JSON.stringify(next.steps));
    }
    assert.ok(grids.size > 90);
    assert.deepEqual(randomizePercussionRhythm(state, random(67)), randomizePercussionRhythm(state, random(67)));
    assert.equal(JSON.stringify(state), before);
  }
});

test('extreme and malformed random streams remain bounded, nonempty and not an all-on grid', () => {
  for (const method of PERCUSSION_METHODS) for (const number of [0, 1, -9, 20, NaN, Infinity, -Infinity, null, '0.4']) {
    const state = createPercussionState(method.id);
    const sound = randomizePercussionKit(state, () => number), beat = randomizePercussionRhythm(state, () => number);
    checkState(sound); checkState(beat);
    assert.ok(countHits(beat) >= 4 && countHits(beat) <= 64);
    assert.ok(beat.steps.flat().some(value => value === 0));
  }
});

test('compiled cycles preserve all simultaneous lanes and immutable exact beat timing', () => {
  const state = createPercussionState('fm-cycles');
  state.steps = Array.from({ length: 8 }, (_, lane) => Array.from({ length: 16 }, (_, step) => step === 0 ? (lane + 1) / 8 : 0));
  const before = JSON.stringify(state), cycle = compilePercussionSequence(state, 135);
  assert.equal(cycle.studyId, 'percussion-fm-cycles');
  assert.equal(cycle.tempo, 135);
  assert.equal(cycle.lengthBeats, 4);
  assert.equal(cycle.stepBeats, .25);
  assert.equal(cycle.steps.length, 16);
  assert.deepEqual(cycle.steps[0].notes.map(note => note.lane), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(cycle.steps[0].notes.map(note => note.velocity), [.125, .25, .375, .5, .625, .75, .875, 1]);
  for (const note of cycle.steps[0].notes) {
    assert.equal(note.ratio, 1); assert.equal(note.gate, 1);
    assert.ok(Object.isFrozen(note));
  }
  for (const [index, step] of cycle.steps.entries()) {
    assert.equal(step.index, index);
    assert.equal(step.atBeats, index * .25);
    assert.equal(step.durationBeats, .25);
    assert.equal(step.at, step.atBeats);
    assert.equal(step.duration, step.durationBeats);
  }
  assert.ok(Object.isFrozen(cycle) && Object.isFrozen(cycle.steps) && Object.isFrozen(cycle.steps[0]));
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(JSON.parse(JSON.stringify(cycle)), cycle);
});

test('swing preserves paired duration, lane velocities and loop seam at all tempo bounds', () => {
  const state = createPercussionState();
  for (const swing of [0, .1, .3, .45]) for (const tempo of [0, 10, 120, 1200, 10000, NaN, '78']) {
    const cycle = compilePercussionSequence({ ...state, swing }, tempo);
    assert.ok(cycle.tempo >= 10 && cycle.tempo <= 1200);
    assert.equal(cycle.lengthBeats, 4);
    let previous = -1;
    for (const step of cycle.steps) {
      assert.ok(step.atBeats > previous);
      assert.ok(step.durationBeats > 0);
      assert.ok(step.atBeats < 4);
      previous = step.atBeats;
      assert.deepEqual(step.notes.map(note => note.velocity), state.steps.map(lane => lane[step.index]).filter(value => value > 0));
      if (step.index % 2 === 0) {
        assert.equal(step.atBeats, step.index * .25);
        assert.ok(Math.abs(step.durationBeats + cycle.steps[step.index + 1].durationBeats - .5) < 1e-12);
      }
    }
    assert.ok(Math.abs(cycle.steps[15].atBeats + cycle.steps[15].durationBeats - 4) < 1e-12);
  }
});
