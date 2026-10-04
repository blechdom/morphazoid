import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import { SEQUENCE_ARCHETYPES, SEQUENCE_CONFIG_KEYS } from '../src/instruments/synthesis/sequence-compiler.js';
import {
  applySequenceParameterValues,
  createSequenceParameterValues,
  getSequenceParameterDefinitions,
} from '../src/instruments/synthesis/sequence-parameters.js';

const COMMON_IDS = Object.freeze([
  'steps', 'stepBeats', 'transpose', 'density', 'swing', 'gate', 'seed', 'pitchMode',
]);

test('every catalog study exposes common cycle controls and specific mechanism controls', () => {
  const covered = new Set();
  for (const study of SEQUENCE_STUDIES) {
    covered.add(study.archetype);
    const definitions = getSequenceParameterDefinitions(study);
    const ids = definitions.map(definition => definition.id);
    const common = definitions.filter(definition => definition.group === 'cycle');
    const mechanism = definitions.filter(definition => definition.group === 'mechanism');

    assert.deepEqual(common.map(definition => definition.id), COMMON_IDS, `${study.id}: common controls`);
    assert.ok(mechanism.length >= 2 && mechanism.length <= 4, `${study.id}: mechanism control count`);
    assert.equal(new Set(ids).size, ids.length, `${study.id}: unique parameter IDs`);
    assert.ok(Object.isFrozen(definitions), `${study.id}: immutable definitions`);

    const values = createSequenceParameterValues(study);
    assert.deepEqual(Object.keys(values), ids, `${study.id}: value schema follows definitions`);
    assert.ok(Object.isFrozen(values), `${study.id}: immutable values`);

    for (const definition of definitions) {
      assert.match(definition.id, /^[a-z][A-Za-z0-9]*$/);
      assert.ok(definition.label.length > 2);
      assert.ok(definition.help.length > 10);
      assert.ok(['number', 'select', 'boolean'].includes(definition.type), `${study.id}.${definition.id}: supported UI type`);
      assert.equal(values[definition.id], definition.default, `${study.id}.${definition.id}: honest default`);
      if (definition.type === 'number') {
        assert.ok(Number.isFinite(definition.default));
        assert.ok(Number.isFinite(definition.min) && definition.min <= definition.default);
        assert.ok(Number.isFinite(definition.max) && definition.max >= definition.default);
        assert.ok(Number.isFinite(definition.step) && definition.step > 0);
      } else if (definition.type === 'select') {
        assert.ok(Array.isArray(definition.choices) && definition.choices.length >= 2);
        assert.ok(Object.isFrozen(definition.choices));
        assert.ok(definition.choices.some(choice => choice.value === definition.default));
      } else {
        assert.equal(typeof definition.default, 'boolean');
      }
    }
  }
  assert.deepEqual([...covered].sort(), [...SEQUENCE_ARCHETYPES].sort());
});

test('runtime values are sanitized, dependent Euclidean values stay valid, and unknown values are discarded', () => {
  const values = createSequenceParameterValues('euclidean-pulse-rotation', {
    steps: 999,
    stepBeats: -3,
    transpose: 999,
    density: -2,
    swing: 8,
    gate: 0,
    seed: 9e20,
    pitchMode: 'not-a-mode',
    pulses: 99,
    euclideanSteps: '3',
    rotation: -999,
    pitchRotation: 'bad',
    unknown: 'discard me',
  });
  assert.deepEqual(values, {
    steps: 64,
    stepBeats: 1 / 64,
    transpose: 96,
    density: 0,
    swing: .49,
    gate: .01,
    seed: 0xffffffff,
    pitchMode: 'nearest',
    pulses: 3,
    euclideanSteps: 3,
    rotation: -64,
    pitchRotation: 0,
  });
  assert.equal(Object.hasOwn(values, 'unknown'), false);

  const booleans = createSequenceParameterValues('captured-control-gesture', {
    reverseGesture: 'true',
    densityFromPressure: 'false',
  });
  assert.equal(booleans.reverseGesture, true);
  assert.equal(booleans.densityFromPressure, false);

  const fallback = createSequenceParameterValues('rising-latched-chord', {
    intervalSpread: Infinity,
    order: 'sideways',
  });
  assert.equal(fallback.intervalSpread, 1);
  assert.equal(fallback.order, 'up');
  assert.throws(() => createSequenceParameterValues('missing-study'), RangeError);
  assert.throws(() => getSequenceParameterDefinitions({}), TypeError);
});

test('applying default values clones frozen studies without changing their authored config', () => {
  const before = JSON.stringify(SEQUENCE_STUDIES);
  for (const study of SEQUENCE_STUDIES) {
    const result = applySequenceParameterValues(study);
    assert.deepEqual(result.config, study.config, `${study.id}: neutral controls preserve config`);
    assert.notEqual(result.config, study.config, `${study.id}: config is detached`);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.config));
    assert.ok(Object.isFrozen(result.options));
    assert.ok(Object.isFrozen(result.values));
    assert.deepEqual(Object.keys(result.options), COMMON_IDS);
    const expectedPitchMode = ['gesture', 'drawn-rows'].includes(study.archetype) ? 'contour' : 'nearest';
    assert.equal(result.options.pitchMode, expectedPitchMode);
    const allowed = new Set(SEQUENCE_CONFIG_KEYS[study.archetype]);
    for (const key of Object.keys(result.config)) assert.ok(allowed.has(key), `${study.id}: no invented compiler key ${key}`);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
  }
  assert.equal(JSON.stringify(SEQUENCE_STUDIES), before);
  const result = applySequenceParameterValues('rising-latched-chord');
  assert.throws(() => { result.config.order = 'down'; }, TypeError);
});

const CHANGED_VALUES = Object.freeze({
  'ordered-chord': Object.freeze({ order: 'played', intervalSpread: 1.5 }),
  'ratio-canon': Object.freeze({ periodScale: 2, phaseShift: 1 }),
  'drawn-rows': Object.freeze({ contourScale: .5, reverseContour: true }),
  'parameter-rows': Object.freeze({ durationScale: .5, reverseRows: true }),
  'cv-rows': Object.freeze({ voltageScale: .5, gateRotation: 1 }),
  gesture: Object.freeze({ contourScale: .5, pressureScale: .5 }),
  'phrase-bank': Object.freeze({ phraseRise: 2, chainRotation: 1 }),
  'accent-pattern': Object.freeze({ accentShift: 1, patternRotation: 1 }),
  tracker: Object.freeze({ rowRotation: 1, velocityScale: .5 }),
  groove: Object.freeze({ patternRotation: 1, timingDepth: .5 }),
  markov: Object.freeze({ stateSpread: .5, transitionFocus: 2 }),
  euclidean: Object.freeze({ pitchRotation: 1, rotation: -1 }),
  polymeter: Object.freeze({ periodScale: 2, laneSpacing: 2 }),
  'mutating-loop': Object.freeze({ mutationChance: .99, mutationSpread: .5 }),
  'conditional-steps': Object.freeze({ probabilityScale: .5, periodScale: 2 }),
  'phrase-arp': Object.freeze({ order: 'down', repeats: 3 }),
});

test('every catalog study receives an audible mechanism-specific config transform', () => {
  const before = JSON.stringify(SEQUENCE_STUDIES);
  for (const study of SEQUENCE_STUDIES) {
    const input = CHANGED_VALUES[study.archetype];
    assert.ok(input, `${study.archetype}: test input exists`);
    const result = applySequenceParameterValues(study, input);
    assert.notDeepEqual(result.config, study.config, `${study.id}: mechanism controls transform config`);
    assert.equal(result.options.steps, study.defaults.steps, `${study.id}: mechanism edit preserves cycle length`);
  }
  assert.equal(JSON.stringify(SEQUENCE_STUDIES), before, 'catalog remains byte-for-byte stable');
});

test('common cycle edits are returned as compiler options and never leak into mechanism config', () => {
  const study = SEQUENCE_STUDIES.find(candidate => candidate.archetype === 'phrase-arp');
  const original = JSON.stringify(study.config);
  const result = applySequenceParameterValues(study, {
    steps: '23', stepBeats: '.5', transpose: '-7.5', density: '.6', swing: '-.2',
    gate: '.4', seed: '42', pitchMode: 'original',
  });
  assert.deepEqual(result.options, {
    steps: 23,
    stepBeats: .5,
    transpose: -7.5,
    density: .6,
    swing: -.2,
    gate: .4,
    seed: 42,
    pitchMode: 'original',
  });
  assert.equal(JSON.stringify(result.config), original);
});

test('representative mechanism controls alter the intended nested data without flattening it', () => {
  const canon = applySequenceParameterValues('perforated-ratio-canon', { periodScale: 2, ratioSpread: 2 });
  assert.deepEqual(canon.config.voices.map(voice => voice.period), [4, 6, 10]);
  assert.equal(canon.config.voices[1].pitchRatio, 1.125 ** 2);

  const cv = applySequenceParameterValues('three-row-voltage-walk', { addressOffset: 1, secondVoice: false });
  assert.deepEqual(cv.config.address.slice(0, 4), [1, 2, 3, 4]);
  assert.equal(Object.hasOwn(cv.config, 'second'), false);

  const groove = applySequenceParameterValues('groove-template-shift', { timingDepth: 0 });
  assert.ok(groove.config.timing.every(value => value === 1));
  assert.deepEqual(groove.config.notes, SEQUENCE_STUDIES.find(study => study.id === 'groove-template-shift').config.notes);

  const conditional = applySequenceParameterValues('modular-logic-gates', { probabilityScale: .5, offsetShift: 2 });
  assert.ok(conditional.config.cells.every(cell => cell.probability <= .5));
  assert.ok(conditional.config.cells.filter(cell => cell.every != null).every(cell => Number.isInteger(cell.offset)));
});
