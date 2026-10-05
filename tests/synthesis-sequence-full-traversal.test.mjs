import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES, getSequenceStudy } from '../src/instruments/synthesis/sequence-catalog.js';
import { compileSequence, MAX_SEQUENCE_STEPS } from '../src/instruments/synthesis/sequence-compiler.js';
import { createSequenceParameterValues, getSequenceParameterBounds, orderedChordTraversalSteps } from '../src/instruments/synthesis/sequence-parameters.js';
import { createSequenceSettingsPresets, randomizeSequenceParameters, SEQUENCE_SETTING_RECIPES } from '../src/instruments/synthesis/performance-presets.js';

const id = 'keyboard-range-arpeggio';
const pitches = cycle => cycle.steps.map(step => { assert.equal(step.notes.length, 1); return step.notes[0].semitone; });
const seeded = initial => { let seed = initial; return () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296); };

test('complete traversal is additive and omitted from every legacy default/saved parameter map', () => {
  for (const study of SEQUENCE_STUDIES.filter(study => study.id !== id)) {
    const values = createSequenceParameterValues(study);
    assert.equal(Object.hasOwn(values, 'fullTraversal'), false, study.id);
    assert.deepEqual(createSequenceParameterValues(study, JSON.parse(JSON.stringify(values))), values);
    assert.equal(compileSequence(study).steps.length, study.defaults.steps, study.id);
  }
  assert.deepEqual(createSequenceParameterValues('rising-latched-chord', { octaves: 8, steps: 5 }), {
    steps: 5, stepBeats: .25, transpose: 0, density: 1, swing: 0, gate: .72, seed: 1,
    pitchMode: 'nearest', order: 'up', octaves: 2, intervalSpread: 1,
  });
});

test('the new keyboard study defaults to one complete three-octave return journey', () => {
  const values = createSequenceParameterValues(id), cycle = compileSequence(id);
  assert.equal(values.fullTraversal, true); assert.equal(values.octaves, 3); assert.equal(values.steps, 16);
  assert.equal(cycle.steps.length, 16); assert.equal(cycle.lengthBeats, 4);
  assert.deepEqual(cycle.parameters, values);
  assert.deepEqual(cycle, compileSequence(id, { parameters: values }));
  const notes = pitches(cycle);
  assert.equal(notes[0], -12); assert.equal(notes[8], 19.1); assert.equal(notes.at(-1), -8.2);
  assert.ok(notes.slice(0, 8).every((note, index) => note < notes[index + 1]));
  assert.ok(notes.slice(8, -1).every((note, index) => note > notes[index + 9]));
});

test('one through eight octaves finish every direction without repeated pendulum endpoints', () => {
  for (const octaves of [1, 2, 3, 4, 5, 6, 7, 8]) for (const order of ['up', 'down', 'pendulum', 'inside-out', 'outside-in', 'played']) {
    const parameters = createSequenceParameterValues(id, { octaves, order, steps: 1, transpose: -36, density: 1 });
    const cycle = compileSequence(id, { parameters, steps: 1 });
    const notes = pitches(cycle), count = 3 * octaves, length = order === 'pendulum' ? count * 2 - 2 : count;
    assert.equal(parameters.steps, length); assert.equal(cycle.steps.length, length); assert.equal(cycle.settings.steps, length);
    assert.ok(length <= MAX_SEQUENCE_STEPS); assert.equal(new Set(notes).size, count);
    assert.equal(Math.min(...notes), -36); assert.equal(Math.max(...notes), 7.1 + 12 * (octaves - 1) - 36);
    if (order === 'up') assert.ok(notes.slice(0, -1).every((note, index) => note < notes[index + 1]));
    if (order === 'down') assert.ok(notes.slice(0, -1).every((note, index) => note > notes[index + 1]));
    if (order === 'pendulum') {
      assert.equal(notes.filter(note => note === Math.min(...notes)).length, 1);
      assert.equal(notes.filter(note => note === Math.max(...notes)).length, 1);
      assert.ok(notes.every((note, index) => note !== notes[(index + 1) % notes.length]));
      assert.ok(notes.slice(count - 1, -1).every((note, index) => note > notes[count + index]));
    }
  }
});

test('full mode derives octave bounds from the complete-return budget, not a stale rendered-step count', () => {
  const study = 'voltage-row-pendulum';
  assert.deepEqual(getSequenceParameterBounds(study, 'octaves', { fullTraversal: true, order: 'pendulum', steps: 1 }), { min: 1, max: 5 });
  const values = createSequenceParameterValues(study, { fullTraversal: true, order: 'pendulum', octaves: 8, steps: 1 });
  assert.equal(values.octaves, 5); assert.equal(values.steps, 58);
  assert.deepEqual(getSequenceParameterBounds(study, 'steps', values), { min: 58, max: 58 });
  assert.equal(compileSequence(study, { parameters: values, steps: 1 }).steps.length, 58);
  const ascent = createSequenceParameterValues(study, { fullTraversal: true, order: 'up', octaves: 8, steps: 1 });
  assert.equal(ascent.octaves, 8); assert.equal(ascent.steps, 48);
});

test('explicit OFF survives new-study JSON recall and retains intentional cropped-cycle behavior', () => {
  const values = createSequenceParameterValues(id, { fullTraversal: false, steps: 5, order: 'down', octaves: 8 });
  assert.equal(values.fullTraversal, false); assert.equal(values.steps, 5);
  assert.deepEqual(createSequenceParameterValues(id, JSON.parse(JSON.stringify(values))), values);
  assert.equal(compileSequence(id, { parameters: values }).steps.length, 5);
  const legacy = createSequenceParameterValues('rising-latched-chord', { fullTraversal: true, octaves: 8, order: 'pendulum', steps: 5 });
  assert.equal(legacy.steps, 62);
  assert.deepEqual(createSequenceParameterValues('rising-latched-chord', JSON.parse(JSON.stringify(legacy))), legacy);
});

test('six keyboard presets retain stable recipe IDs and cover full narrow/wide directional cycles', () => {
  const presets = createSequenceSettingsPresets(id);
  assert.deepEqual(presets.map(preset => preset.id), SEQUENCE_SETTING_RECIPES.map(recipe => `${id}:${recipe.id}`));
  assert.deepEqual(presets[0].snapshot.parameters, createSequenceParameterValues(id));
  assert.deepEqual(presets.map(preset => preset.snapshot.parameters.octaves), [3, 1, 5, 7, 8, 8]);
  assert.deepEqual(presets.map(preset => preset.snapshot.parameters.order), ['pendulum', 'inside-out', 'down', 'up', 'pendulum', 'outside-in']);
  for (const preset of presets) {
    const values = preset.snapshot.parameters, cycle = compileSequence(id, { parameters: values });
    assert.equal(values.fullTraversal, true); assert.equal(values.density, 1);
    assert.equal(cycle.steps.length, orderedChordTraversalSteps(id, values));
    assert.ok(cycle.steps.every(step => step.notes.length === 1));
  }
});

test('keyboard dice spans two to eight octaves and both policies without partial return journeys', () => {
  const ranges = new Set(), policies = new Set();
  for (const rng of [...[0, 1, NaN, -1, 2].map(value => () => value), ...Array.from({ length: 256 }, (_, index) => seeded(index + 5000))]) {
    const values = randomizeSequenceParameters(id, rng), cycle = compileSequence(id, { parameters: values });
    ranges.add(values.octaves); policies.add(values.fullTraversal);
    assert.ok(values.octaves >= 2 && values.octaves <= 8);
    assert.equal(values.steps % orderedChordTraversalSteps(id, values), 0);
    assert.ok(cycle.steps.length <= MAX_SEQUENCE_STEPS);
    const notes = cycle.steps.flatMap(step => step.notes);
    assert.ok(notes.length >= 4);
    assert.ok(notes.every(note => note.semitone >= -48 && note.semitone <= 48));
  }
  assert.deepEqual([...ranges].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...policies].sort(), [false, true]);
  assert.deepEqual(randomizeSequenceParameters(id, seeded(4)), randomizeSequenceParameters(id, seeded(4)));
  assert.equal(getSequenceStudy(id).config.fullTraversal, true);
});

test('extreme transposition moves the whole eight-octave field without flattening its notes', () => {
  for (const fullTraversal of [true, false]) for (const intervalSpread of [.25, 1, 2]) {
    for (const transpose of [-96, 24, 96]) for (const order of ['up', 'down', 'pendulum']) {
      const parameters = createSequenceParameterValues(id, { fullTraversal, octaves: 8, order,
        steps: order === 'pendulum' ? 46 : 24, intervalSpread, transpose, density: 1 });
      const bounds = getSequenceParameterBounds(id, 'transpose', parameters);
      assert.ok(parameters.transpose >= bounds.min && parameters.transpose <= bounds.max);
      const cycle = compileSequence(id, { parameters }), notes = pitches(cycle);
      assert.equal(new Set(notes).size, 24, `${order}/${fullTraversal}/${intervalSpread}/${transpose}: no saturated notes`);
      assert.ok(notes.every(note => note >= -96 && note <= 96));
      assert.ok(Math.abs(Math.max(...notes) - Math.min(...notes) - (84 + 7.1 * intervalSpread)) < 1e-10,
        'whole-field transposition preserves the complete interval span');
      if (order === 'up') assert.ok(notes.slice(0, -1).every((note, index) => note < notes[index + 1]));
      if (order === 'down') assert.ok(notes.slice(0, -1).every((note, index) => note > notes[index + 1]));
      assert.deepEqual(createSequenceParameterValues(id, JSON.parse(JSON.stringify(parameters))), parameters);
      for (const override of [-96, 96]) {
        const overridden = compileSequence(id, { parameters, transpose: override });
        assert.ok(overridden.settings.transpose >= bounds.min && overridden.settings.transpose <= bounds.max);
        assert.equal(new Set(pitches(overridden)).size, 24, 'top-level transpose cannot bypass whole-field bounds');
      }
    }
  }
  assert.deepEqual(getSequenceParameterBounds(id, 'transpose', { fullTraversal: true, octaves: 8, intervalSpread: 2 }),
    { min: -96, max: -2.2 });
});

test('opt-in full legacy studies gain contour-safe transposition without changing legacy cropped behavior', () => {
  const parameters = createSequenceParameterValues('rising-latched-chord', {
    fullTraversal: true, octaves: 8, order: 'up', steps: 64, transpose: 96, intervalSpread: 1, density: 1,
  });
  assert.equal(parameters.transpose, 1.4);
  assert.equal(new Set(pitches(compileSequence('rising-latched-chord', { parameters, transpose: 96 }))).size, 32);
  const legacy = createSequenceParameterValues('rising-latched-chord', {
    octaves: 8, order: 'up', steps: 64, transpose: 96, intervalSpread: 1, density: 1,
  });
  assert.equal(legacy.transpose, 96, 'legacy OFF snapshots retain their existing value and saturation semantics');
  assert.equal(new Set(pitches(compileSequence('rising-latched-chord', { parameters: legacy }))).size, 1);
});
