import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import { SEQUENCE_ARCHETYPES, SEQUENCE_CONFIG_KEYS } from '../src/instruments/synthesis/sequence-compiler.js';
import {
  applySequenceParameterValues,
  createSequenceParameterValues,
  getSequenceParameterBounds,
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
    assert.ok(mechanism.length >= 2 && mechanism.length <= 6, `${study.id}: mechanism control count`);
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
    rotation: 0,
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

test('rotation and generation controls expose only distinct, currently audible states', () => {
  const definition = (id, parameter) => getSequenceParameterDefinitions(id).find(item => item.id === parameter);
  assert.deepEqual(
    { min: definition('tracker-row-steps', 'rowRotation').min, max: definition('tracker-row-steps', 'rowRotation').max },
    { min: -3, max: 4 },
  );
  assert.deepEqual(getSequenceParameterBounds('rotating-euclidean-chords', 'pulses', { euclideanSteps: 5 }), { min: 0, max: 5 });
  assert.deepEqual(getSequenceParameterBounds('rotating-euclidean-chords', 'rotation', { euclideanSteps: 5, pulses: 2 }), { min: -2, max: 2 });
  assert.deepEqual(getSequenceParameterBounds('groove-template-shift', 'rotateEvery', { steps: 17 }), { min: 0, max: 2 });
  assert.deepEqual(getSequenceParameterBounds('mutable-cell-loop', 'generations', { steps: 17 }), { min: 1, max: 3 });
  assert.deepEqual(getSequenceParameterBounds('mutable-cell-loop', 'mirrorEvery', { steps: 17, generations: 2 }), { min: 0, max: 1 });
  assert.deepEqual(getSequenceParameterBounds('syncopated-key-cycle', 'restShift', { steps: 8 }), { min: -3, max: 4 });
  assert.equal(definition('bounded-random-walk', 'maxLeap').max, 2);
});

test('periodic offsets expose one representative for each distinct residue', () => {
  const definition = (id, parameter) => getSequenceParameterDefinitions(id).find(item => item.id === parameter);
  const gate = definition('three-row-voltage-walk', 'gateRotation');
  assert.deepEqual({ min: gate.min, max: gate.max }, { min: -1, max: 2 }, 'the repeated eight-gate row has period four');
  const gateRows = Array.from({ length: gate.max - gate.min + 1 }, (_, index) => (
    applySequenceParameterValues('three-row-voltage-walk', { gateRotation: gate.min + index }).config.gates
  ));
  assert.equal(new Set(gateRows.map(JSON.stringify)).size, gateRows.length, 'every exposed gate rotation is distinct');

  const chain = definition('transposable-phrase-memory', 'chainRotation');
  assert.deepEqual({ min: chain.min, max: chain.max }, { min: 0, max: 1 }, 'the four-entry alternating chain has period two');
  const chains = Array.from({ length: chain.max - chain.min + 1 }, (_, index) => (
    applySequenceParameterValues('transposable-phrase-memory', { chainRotation: chain.min + index }).config.chain
  ));
  assert.equal(new Set(chains.map(JSON.stringify)).size, chains.length, 'every exposed chain rotation is distinct');

  assert.deepEqual(getSequenceParameterBounds('perforated-ratio-canon', 'phaseShift', {}), { min: -14, max: 15 });
  assert.deepEqual(getSequenceParameterBounds('perforated-ratio-canon', 'phaseShift', { periodScale: .5 }), { min: -2, max: 3 });
  assert.deepEqual(getSequenceParameterBounds('perforated-ratio-canon', 'phaseShift', { periodScale: 2 }), { min: -29, max: 30 });
  const wideCanon = getSequenceParameterBounds('perforated-ratio-canon', 'phaseShift', { periodScale: 3.75 });
  const canonPhases = Array.from({ length: wideCanon.max - wideCanon.min + 1 }, (_, index) => (
    applySequenceParameterValues('perforated-ratio-canon', { periodScale: 3.75, phaseShift: wideCanon.min + index })
      .config.voices.map(voice => voice.phase || 0)
  ));
  assert.equal(new Set(canonPhases.map(JSON.stringify)).size, canonPhases.length, 'every LCM residue produces a distinct phase tuple');
});

test('rendered length and traversal choices remove inaudible octave and repeat aliases', () => {
  for (const order of ['up', 'played', 'pendulum']) {
    assert.deepEqual(
      getSequenceParameterBounds('rising-latched-chord', 'octaves', { steps: 5, order }),
      { min: 1, max: 2 },
      order,
    );
    assert.equal(createSequenceParameterValues('rising-latched-chord', { steps: 5, order, octaves: 8 }).octaves, 2);
  }
  for (const order of ['down', 'inside-out', 'outside-in']) {
    assert.deepEqual(
      getSequenceParameterBounds('rising-latched-chord', 'octaves', { steps: 5, order }),
      { min: 1, max: 8 },
      order,
    );
    assert.equal(createSequenceParameterValues('rising-latched-chord', { steps: 5, order, octaves: 8 }).octaves, 8);
  }

  assert.deepEqual(getSequenceParameterBounds('captured-order-latch', 'repeats', { steps: 13, order: 'up' }), { min: 1, max: 4 });
  assert.deepEqual(getSequenceParameterBounds('captured-order-latch', 'repeats', { steps: 13, order: 'pendulum' }), { min: 1, max: 3 });
  assert.equal(createSequenceParameterValues('captured-order-latch', { steps: 13, order: 'pendulum', repeats: 8 }).repeats, 3);
});

test('Euclidean slot and rotation domains follow the rendered and fundamental periods', () => {
  assert.deepEqual(
    getSequenceParameterBounds('euclidean-pulse-rotation', 'euclideanSteps', { steps: 12, pulses: 7 }),
    { min: 7, max: 12 },
  );
  assert.deepEqual(getSequenceParameterBounds('euclidean-pulse-rotation', 'rotation', { steps: 16, euclideanSteps: 8, pulses: 0 }), { min: 0, max: 0 });
  assert.deepEqual(getSequenceParameterBounds('euclidean-pulse-rotation', 'rotation', { steps: 16, euclideanSteps: 8, pulses: 8 }), { min: 0, max: 0 });
  assert.deepEqual(getSequenceParameterBounds('euclidean-pulse-rotation', 'rotation', { steps: 16, euclideanSteps: 8, pulses: 2 }), { min: -1, max: 2 });
  assert.deepEqual(getSequenceParameterBounds('euclidean-pulse-rotation', 'rotation', { steps: 16, euclideanSteps: 8, pulses: 3 }), { min: -3, max: 4 });
  assert.deepEqual(
    createSequenceParameterValues('euclidean-pulse-rotation', { steps: 8, pulses: 20, euclideanSteps: 30, rotation: 7 }),
    {
      steps: 8, stepBeats: .125, transpose: 0, density: 1, swing: 0, gate: .72, seed: 1,
      pitchMode: 'nearest', pulses: 8, euclideanSteps: 8, rotation: 0, pitchRotation: 0,
    },
  );
});

test('numeric parameters snap to their declared finite step before reaching state or audio config', () => {
  const values = createSequenceParameterValues('perforated-ratio-canon', {
    density: .555,
    transpose: .15,
    periodScale: .3,
    ratioSpread: 1.234,
    ramp: .456,
  });
  assert.equal(values.density, .56);
  assert.equal(values.transpose, .2);
  assert.equal(values.periodScale, .25);
  assert.equal(values.ratioSpread, 1.23);
  assert.equal(values.ramp, .46);

  const applied = applySequenceParameterValues('perforated-ratio-canon', { periodScale: .3, ramp: .456 });
  assert.equal(applied.values.periodScale, .25);
  assert.equal(applied.config.ramp, .46);
  assert.deepEqual(applied.config.voices.map(voice => voice.period), [1, 1, 1]);
});

test('partial bound queries merge authored defaults before deriving dependent ranges', () => {
  assert.deepEqual(getSequenceParameterBounds('live-transform-mirror', 'mirrorEvery', {}), { min: 0, max: 3 });
  assert.deepEqual(getSequenceParameterBounds('live-transform-mirror', 'mirrorEvery', { steps: 17 }), { min: 0, max: 2 });
  assert.deepEqual(getSequenceParameterBounds('live-transform-mirror', 'mirrorEvery', { steps: 17, generations: 2 }), { min: 0, max: 1 });

  for (const study of SEQUENCE_STUDIES) {
    for (const definition of getSequenceParameterDefinitions(study).filter(candidate => candidate.type === 'number')) {
      const bounds = getSequenceParameterBounds(study, definition.id, {});
      assert.ok(definition.default >= bounds.min && definition.default <= bounds.max, `${study.id}.${definition.id}: authored default remains selectable`);
    }
  }
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

  const rotatedGroove = applySequenceParameterValues('groove-template-shift', { patternRotation: 1 });
  const originalGroove = SEQUENCE_STUDIES.find(study => study.id === 'groove-template-shift').config;
  assert.deepEqual(rotatedGroove.config.notes[0], originalGroove.notes.at(-1));
  assert.equal(rotatedGroove.config.timing[0], originalGroove.timing.at(-1));

  const conditional = applySequenceParameterValues('modular-logic-gates', { probabilityScale: .5, offsetShift: 2 });
  assert.ok(conditional.config.cells.every(cell => cell.probability <= .5));
  assert.ok(conditional.config.cells.filter(cell => cell.every != null).every(cell => Number.isInteger(cell.offset)));
});

test('study-specific controls are only exposed when their authored signal path can use them', () => {
  const ids = id => getSequenceParameterDefinitions(id).map(definition => definition.id);
  assert.ok(ids('drawn-density-bands').includes('invertMasks'));
  assert.ok(!ids('drawn-pitch-ribbon').includes('invertMasks'));
  assert.ok(ids('three-row-voltage-walk').includes('secondVoice'));
  assert.ok(!ids('addressed-stage-skip').includes('secondVoice'));
  assert.ok(ids('syncopated-key-cycle').includes('restShift'));
  assert.ok(!ids('captured-order-latch').includes('restShift'));
  assert.ok(ids('recurring-conditional-steps').includes('periodScale'));
  assert.ok(!ids('chance-weighted-steps').includes('periodScale'));
  assert.ok(ids('tracker-effect-memory').includes('carryGate'));
  assert.ok(!ids('locked-parameter-line').includes('carryGate'));
});
