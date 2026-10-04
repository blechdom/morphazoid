import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTHESIS_METHODS,
  createDefaultState,
  sanitizeState,
} from '../src/instruments/synthesis/catalog.js';
import { SEQUENCE_STUDIES, getSequenceStudy } from '../src/instruments/synthesis/sequence-catalog.js';
import { compileSequence } from '../src/instruments/synthesis/sequence-compiler.js';
import {
  createSequenceParameterValues,
  getSequenceParameterBounds,
  getSequenceParameterDefinitions,
} from '../src/instruments/synthesis/sequence-parameters.js';
import { TUNINGS } from '../src/instruments/synthesis/tunings.js';
import {
  MASTER_PRESET_RECIPES,
  MAX_SEQUENCE_TEMPO,
  MIN_SEQUENCE_TEMPO,
  SEQUENCE_SETTINGS_PRESETS,
  SEQUENCE_SETTING_RECIPES,
  SYNTHESAURUS_MASTER_PRESETS,
  applyPerformanceSnapshot,
  applySequenceSettingsRecipe,
  capturePerformanceSnapshot,
  createSequenceSettingsPresets,
  instantiateMasterPreset,
  nextSequenceId,
  nextTuningId,
  randomSequenceId,
  randomTuningId,
  randomizeMasterPerformance,
  randomizeSequenceParameters,
  randomizeSequenceSettings,
  sanitizeSequencePerformance,
  validatePerformancePresetBank,
} from '../src/instruments/synthesis/performance-presets.js';

const mulberry32 = seed => () => {
  let value = seed += 0x6d2b79f5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

const assertFiniteTree = (value, path = 'value') => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is finite`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${path}.${key}`);
};

test('master bank contains distinct complete synthesis + sequence + tuning scenes', () => {
  assert.equal(validatePerformancePresetBank(SYNTHESAURUS_MASTER_PRESETS), true);
  assert.ok(SYNTHESAURUS_MASTER_PRESETS.length >= 12);
  assert.equal(SYNTHESAURUS_MASTER_PRESETS.length, MASTER_PRESET_RECIPES.length);
  assert.equal(new Set(SYNTHESAURUS_MASTER_PRESETS.map(preset => preset.id)).size, SYNTHESAURUS_MASTER_PRESETS.length);
  assert.equal(new Set(SYNTHESAURUS_MASTER_PRESETS.map(preset => JSON.stringify(preset.snapshot))).size, SYNTHESAURUS_MASTER_PRESETS.length);

  const synthesisIds = new Set(SYNTHESIS_METHODS.map(method => method.id));
  const tuningIds = new Set(TUNINGS.map(tuning => tuning.id));
  const usedTunings = new Set();
  for (const preset of SYNTHESAURUS_MASTER_PRESETS) {
    const { sound, sequence, tuningId } = preset.snapshot;
    assert.ok(Object.isFrozen(preset) && Object.isFrozen(preset.snapshot));
    assert.ok(synthesisIds.has(sound.methodId), `${preset.id}: synthesis method`);
    assert.ok(getSequenceStudy(sequence.id), `${preset.id}: historical sequence`);
    assert.ok(tuningIds.has(tuningId), `${preset.id}: known tuning`);
    usedTunings.add(tuningId);
    assert.deepEqual(sequence.parameters, createSequenceParameterValues(sequence.id, sequence.parameters));
    assert.deepEqual(Object.keys(sequence.parameters), getSequenceParameterDefinitions(sequence.id).map(definition => definition.id));
    assert.ok(sequence.tempoBpm >= MIN_SEQUENCE_TEMPO && sequence.tempoBpm <= MAX_SEQUENCE_TEMPO);
    for (const key of ['outputLevel', 'voiceMode', 'tuningId', 'source', 'audioEnabled', 'playing', 'transport', 'midi']) {
      assert.equal(Object.hasOwn(sound, key), false, `${preset.id}: sound excludes ${key}`);
    }
    assert.deepEqual(Object.keys(preset.snapshot).sort(), ['sequence', 'sound', 'tuningId']);
    assertFiniteTree(preset.snapshot, preset.id);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(preset.snapshot)));
  }
  assert.ok(usedTunings.size >= 12, 'master scenes explore a diverse tuning set');
  assert.ok([...usedTunings].filter(id => id.includes('pentatonic')).length <= 2, 'bank is not pentatonic-biased');

  assert.throws(() => validatePerformancePresetBank(SYNTHESAURUS_MASTER_PRESETS.slice(0, 11)), /at least 12/);
  const duplicated = [...SYNTHESAURUS_MASTER_PRESETS.slice(0, 12)];
  duplicated[11] = { ...duplicated[11], id: duplicated[0].id };
  assert.throws(() => validatePerformancePresetBank(duplicated), /Duplicate/);
});

test('capture and restore own musical state but preserve performer level and voice mode', () => {
  const currentSound = {
    ...createDefaultState('fx-delay'),
    outputLevel: .19,
    voiceMode: 'poly',
    tuningId: 'edo-6-whole-tone',
  };
  const original = structuredClone(currentSound);
  const preset = SYNTHESAURUS_MASTER_PRESETS[5];
  const restored = applyPerformanceSnapshot(preset.snapshot, currentSound);

  assert.equal(restored.sound.outputLevel, .19);
  assert.equal(restored.sound.voiceMode, 'poly');
  assert.equal(restored.sound.tuningId, preset.snapshot.tuningId);
  assert.equal(restored.tuningId, preset.snapshot.tuningId);
  assert.deepEqual(restored.sequence, preset.snapshot.sequence);
  assert.ok(SYNTHESIS_METHODS.some(method => method.id === restored.sound.methodId));
  assert.deepEqual(currentSound, original, 'restore never mutates caller state');
  assert.ok(Object.isFrozen(restored) && Object.isFrozen(restored.sound));

  const recaptured = capturePerformanceSnapshot(restored);
  assert.deepEqual(recaptured, preset.snapshot);
  assert.deepEqual(instantiateMasterPreset(preset.id, currentSound), restored);
  assert.throws(() => instantiateMasterPreset('missing-scene', currentSound), RangeError);

  const noisy = capturePerformanceSnapshot({
    ...restored,
    audioEnabled: true,
    playing: true,
    midi: { input: 'outside-preset-scope' },
    sound: { ...restored.sound, outputLevel: .99, voiceMode: 'mono', audioEnabled: true },
  });
  assert.deepEqual(noisy, preset.snapshot, 'runtime and performer fields never enter a stored snapshot');
});

test('six bounded sequence-settings recipes apply to every historical mechanism', () => {
  assert.deepEqual(SEQUENCE_SETTING_RECIPES.map(recipe => recipe.id), [
    'original', 'spacious', 'sparse', 'tight', 'dense', 'wild',
  ]);
  assert.equal(Object.keys(SEQUENCE_SETTINGS_PRESETS).length, SEQUENCE_STUDIES.length);

  for (const study of SEQUENCE_STUDIES) {
    const presets = createSequenceSettingsPresets(study);
    assert.deepEqual(presets, SEQUENCE_SETTINGS_PRESETS[study.id]);
    assert.equal(presets.length, SEQUENCE_SETTING_RECIPES.length, `${study.id}: recipe count`);
    assert.equal(new Set(presets.map(preset => JSON.stringify(preset.snapshot))).size, presets.length, `${study.id}: recipes are distinct`);
    const parameterIds = getSequenceParameterDefinitions(study).map(definition => definition.id);
    for (const preset of presets) {
      assert.ok(!/^(original|spacious|sparse|tight|dense|wild)$/i.test(preset.label), `${preset.id}: names its musical mechanism`);
      assert.equal(preset.snapshot.id, study.id);
      assert.deepEqual(Object.keys(preset.snapshot.parameters), parameterIds);
      assert.deepEqual(preset.snapshot.parameters, createSequenceParameterValues(study, preset.snapshot.parameters));
      assert.ok(Number.isFinite(preset.snapshot.tempoBpm));
      assert.ok(Object.isFrozen(preset.snapshot.parameters));
      for (const definition of getSequenceParameterDefinitions(study).filter(candidate => candidate.type === 'number')) {
        const bounds = getSequenceParameterBounds(study, definition.id, preset.snapshot.parameters);
        const value = preset.snapshot.parameters[definition.id];
        assert.ok(value >= bounds.min && value <= bounds.max, `${preset.id}.${definition.id}: effective range`);
      }
    }
    assert.deepEqual(presets[0].snapshot.parameters, createSequenceParameterValues(study), `${study.id}: Original is authored default`);
    const current = sanitizeSequencePerformance({ id: study.id, tempoBpm: 999, parameters: { density: .01 } });
    assert.deepEqual(applySequenceSettingsRecipe(current, 'dense'), presets[4].snapshot);
  }
});

test('technique presets produce distinct mechanisms and an early audible event', () => {
  for (const study of SEQUENCE_STUDIES) {
    const presets = createSequenceSettingsPresets(study);
    const mechanismPatterns = new Set();
    for (const preset of presets) {
      const parameters = preset.snapshot.parameters;
      const compiled = compileSequence(study, { parameters });
      const sounding = compiled.steps.filter(step => step.notes.length);
      assert.ok(sounding.length >= 4, `${preset.id}: several visible attacks`);
      assert.ok(sounding[0].at * 60 / preset.snapshot.tempoBpm <= .75, `${preset.id}: first note within 750 ms`);
      assert.ok(compiled.steps.flatMap(step => step.notes).every(note => note.velocity >= .12), `${preset.id}: audible note velocities`);
      // Remove superficial tempo, seed, articulation and register differences:
      // the method's own mechanism must still create differing event patterns.
      const neutral = compileSequence(study, {
        parameters: { ...parameters, steps: 64, stepBeats: .25, gate: .72, density: 1, transpose: 0, swing: 0, seed: 1 },
      });
      mechanismPatterns.add(JSON.stringify(neutral.steps));
    }
    assert.ok(mechanismPatterns.size >= 4, `${study.id}: at least four distinct mechanisms, not relabeled tempo changes`);
  }
  assert.equal(createSequenceSettingsPresets('euclidean-pulse-rotation')[1].label, 'Three in eight');
  assert.equal(createSequenceSettingsPresets('bounded-random-walk')[1].label, 'Neighbor-state melody');
});

test('arpeggiator dice compiles visible playable notes across methods, seeds and RNG edges', () => {
  for (const study of SEQUENCE_STUDIES) {
    const generators = [
      ...[0, 1, .01, .5, .99, NaN, -1, 2].map(value => () => value),
      ...Array.from({ length: 96 }, (_, index) => mulberry32(index + 4000)),
    ];
    for (const [index, rng] of generators.entries()) {
      const state = randomizeSequenceSettings({ id: study.id }, rng);
      const compiled = compileSequence(study, { parameters: state.parameters });
      const sounding = compiled.steps.filter(step => step.notes.length);
      const notes = sounding.flatMap(step => step.notes);
      const label = `${study.id}: sample ${index}`;
      assert.ok(sounding.length >= Math.max(4, Math.ceil(compiled.steps.length * .2)), `${label}: useful visible event density`);
      assert.ok(sounding[0].at * 60 / state.tempoBpm <= .75, `${label}: first note within 750 ms`);
      assert.ok(notes.every(note => note.semitone >= -36 && note.semitone <= 36), `${label}: bounded three-octave register`);
      assert.ok(notes.every(note => note.velocity >= .12 && note.velocity <= 1), `${label}: non-negligible velocities`);
      const noteRate = notes.length / compiled.lengthBeats * state.tempoBpm / 60;
      assert.ok(noteRate >= .6 && noteRate <= 24, `${label}: useful note rate, received ${noteRate}`);
      const durations = sounding.flatMap(step => step.notes.map(note => step.duration * note.gate * 60 / state.tempoBpm));
      assert.ok(durations.every(duration => duration >= .004), `${label}: no sub-4 ms note gates`);
      assert.ok(durations.reduce((sum, duration) => sum + duration, 0) / durations.length >= .03, `${label}: mean gate exceeds 30 ms`);
    }
  }
});

test('sequence dice is deterministic, pure, bounded and covers every editable field', () => {
  for (const study of SEQUENCE_STUDIES) {
    const input = sanitizeSequencePerformance({ id: study.id, tempoBpm: study.defaults.tempoBpm });
    const before = structuredClone(input);
    const first = randomizeSequenceSettings(input, mulberry32(1000 + study.year));
    const second = randomizeSequenceSettings(input, mulberry32(1000 + study.year));
    assert.deepEqual(first, second, `${study.id}: seeded randomization`);
    assert.deepEqual(input, before, `${study.id}: input purity`);
    assert.equal(first.id, study.id, `${study.id}: settings dice owns no sequence selection`);
    assert.ok(first.tempoBpm >= 48 && first.tempoBpm <= 220, `${study.id}: musical tempo range`);
    assert.deepEqual(first.parameters, createSequenceParameterValues(study, first.parameters));

    const definitions = getSequenceParameterDefinitions(study);
    const samples = Array.from({ length: 72 }, (_, index) => randomizeSequenceParameters(study, mulberry32(index + 1)));
    for (const definition of definitions) {
      const values = new Set(samples.map(sample => sample[definition.id]));
      assert.ok(values.size > 1, `${study.id}.${definition.id}: randomized rather than frozen`);
    }
    if (study.archetype === 'euclidean') {
      for (const sample of samples) assert.ok(sample.pulses <= sample.euclideanSteps, `${study.id}: dependent pulse bound`);
    }
  }
});

test('dependent sequence dice samples live domains without piling up at clamped endpoints', () => {
  const endpointRate = (studyId, parameterId) => {
    let endpoints = 0;
    let considered = 0;
    for (let index = 0; index < 1024; index += 1) {
      const values = randomizeSequenceParameters(studyId, mulberry32(12000 + index));
      const bounds = getSequenceParameterBounds(studyId, parameterId, values);
      if (bounds.max - bounds.min + 1 < 8) continue;
      considered += 1;
      if (values[parameterId] === bounds.min || values[parameterId] === bounds.max) endpoints += 1;
    }
    assert.ok(considered > 500, `${studyId}.${parameterId}: enough deterministic samples`);
    return endpoints / considered;
  };

  assert.ok(endpointRate('perforated-ratio-canon', 'phaseShift') < .2, 'canon phases do not clamp to their live edges');
  assert.ok(endpointRate('euclidean-pulse-rotation', 'rotation') < .3, 'Euclidean rotations do not clamp to their live edges');
});

test('factory recipes shift dependent controls within their established live domains', () => {
  const canon = SEQUENCE_SETTINGS_PRESETS['perforated-ratio-canon'].slice(1);
  for (const preset of canon) {
    const values = preset.snapshot.parameters;
    const bounds = getSequenceParameterBounds('perforated-ratio-canon', 'phaseShift', values);
    if (bounds.min === bounds.max) continue;
    assert.ok(values.phaseShift > bounds.min && values.phaseShift < bounds.max, `${preset.id}: phase is not post-clamped`);
  }

  const euclidean = SEQUENCE_SETTINGS_PRESETS['euclidean-pulse-rotation'];
  for (const recipeId of ['spacious', 'sparse', 'tight']) {
    const preset = euclidean.find(candidate => candidate.id.endsWith(`:${recipeId}`));
    const values = preset.snapshot.parameters;
    const bounds = getSequenceParameterBounds('euclidean-pulse-rotation', 'rotation', values);
    assert.ok(bounds.min < bounds.max, `${preset.id}: useful rotation domain`);
    assert.ok(values.rotation > bounds.min && values.rotation < bounds.max, `${preset.id}: rotation is not post-clamped`);
  }
});

test('whole-instrument dice randomizes every musical axis while preserving safe output level', () => {
  const current = {
    sound: {
      ...createDefaultState('additive'),
      outputLevel: .23,
      voiceMode: 'poly',
      tuningId: 'edo-12-chromatic',
    },
    sequence: sanitizeSequencePerformance({ id: 'rising-latched-chord' }),
    tuningId: 'edo-12-chromatic',
    audioEnabled: true,
    playing: true,
    midi: { input: 'outside-preset-scope' },
  };
  const before = structuredClone(current);
  const first = randomizeMasterPerformance(current, mulberry32(90210));
  const second = randomizeMasterPerformance(current, mulberry32(90210));
  assert.deepEqual(first, second, 'injected RNG fully determines the result');
  assert.deepEqual(current, before, 'master dice is pure');
  assert.equal(first.sound.outputLevel, .23);
  assert.ok(['mono', 'poly'].includes(first.sound.voiceMode));
  assert.equal(first.sound.presetId, 'custom');
  assert.equal(first.sound.tuningId, first.tuningId);
  assert.ok(SYNTHESIS_METHODS.some(method => method.id === first.sound.methodId));
  assert.ok(getSequenceStudy(first.sequence.id));
  assert.ok(TUNINGS.some(tuning => tuning.id === first.tuningId));
  assert.deepEqual(first.sound, sanitizeState(first.sound));
  assert.deepEqual(first.sequence.parameters, createSequenceParameterValues(first.sequence.id, first.sequence.parameters));
  assert.equal(Object.hasOwn(first, 'audioEnabled'), false);
  assert.equal(Object.hasOwn(first, 'playing'), false);
  assert.equal(Object.hasOwn(first, 'midi'), false);
  assertFiniteTree(first);

  const low = randomizeMasterPerformance(current, () => 0);
  const high = randomizeMasterPerformance(current, () => 1);
  assert.equal(low.sound.methodId, SYNTHESIS_METHODS[0].id);
  assert.equal(high.sound.methodId, SYNTHESIS_METHODS.at(-1).id);
  assert.equal(low.sequence.id, SEQUENCE_STUDIES[0].id);
  assert.equal(high.sequence.id, SEQUENCE_STUDIES.at(-1).id);
  assert.equal(low.tuningId, TUNINGS[0].id);
  assert.equal(high.tuningId, TUNINGS.at(-1).id);
  assert.equal(low.sound.voiceMode, 'mono');
  assert.equal(high.sound.voiceMode, 'poly');
});

test('axis navigation helpers wrap and random helpers can reach both catalog edges', () => {
  assert.equal(nextSequenceId('none'), SEQUENCE_STUDIES[0].id);
  assert.equal(nextSequenceId('none', -1), SEQUENCE_STUDIES.at(-1).id);
  assert.equal(nextSequenceId(SEQUENCE_STUDIES.at(-1).id), SEQUENCE_STUDIES[0].id);
  assert.equal(nextSequenceId(SEQUENCE_STUDIES[0].id, -1), SEQUENCE_STUDIES.at(-1).id);
  assert.equal(randomSequenceId(() => 0), SEQUENCE_STUDIES[0].id);
  assert.equal(randomSequenceId(() => 1), SEQUENCE_STUDIES.at(-1).id);
  assert.equal(nextTuningId('missing'), TUNINGS[0].id);
  assert.equal(nextTuningId('missing', -1), TUNINGS.at(-1).id);
  assert.equal(nextTuningId(TUNINGS.at(-1).id), TUNINGS[0].id);
  assert.equal(nextTuningId(TUNINGS[0].id, -1), TUNINGS.at(-1).id);
  assert.equal(randomTuningId(() => 0), TUNINGS[0].id);
  assert.equal(randomTuningId(() => 1), TUNINGS.at(-1).id);
});
