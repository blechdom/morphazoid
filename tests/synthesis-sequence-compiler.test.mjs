import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import {
  MAX_NOTES_PER_STEP,
  MAX_SEQUENCE_STEPS,
  SEQUENCE_ARCHETYPES,
  SEQUENCE_CONFIG_KEYS,
  compileSequence,
  sanitizeSequenceOptions,
} from '../src/instruments/synthesis/sequence-compiler.js';

const soundingNotes = cycle => cycle.steps.flatMap(step => step.notes);

test('every study compiles to a bounded, finite and serializable cycle', () => {
  for (const study of SEQUENCE_STUDIES) {
    const cycle = compileSequence(study);
    assert.equal(cycle.studyId, study.id);
    assert.equal(cycle.archetype, study.archetype);
    assert.ok(cycle.steps.length >= 1 && cycle.steps.length <= MAX_SEQUENCE_STEPS);
    assert.ok(Number.isFinite(cycle.tempo));
    assert.ok(Number.isFinite(cycle.lengthBeats) && cycle.lengthBeats > 0);
    assert.ok(Object.isFrozen(cycle));
    assert.ok(Object.isFrozen(cycle.steps));
    let previousAt = -1;
    for (const [index, step] of cycle.steps.entries()) {
      assert.equal(step.index, index);
      assert.ok(Number.isFinite(step.at) && step.at > previousAt);
      assert.ok(Number.isFinite(step.duration) && step.duration > 0);
      assert.ok(step.notes.length <= MAX_NOTES_PER_STEP);
      assert.equal(Object.hasOwn(step, 'tie'), false);
      assert.equal(Object.hasOwn(step, 'slide'), false);
      previousAt = step.at;
      for (const note of step.notes) {
        assert.ok(Number.isFinite(note.semitone) && note.semitone >= -96 && note.semitone <= 96);
        assert.ok(Number.isFinite(note.velocity) && note.velocity > 0 && note.velocity <= 1);
        assert.ok(Number.isFinite(note.gate) && note.gate > 0 && note.gate <= 1);
        assert.equal(typeof note.accent, 'boolean');
      }
    }
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(cycle)));
  }
});

test('seeded generation and thinning are deterministic without mutating definitions', () => {
  const before = JSON.stringify(SEQUENCE_STUDIES);
  const first = compileSequence('bounded-random-walk', { seed: 'repeatable', density: .63 });
  const second = compileSequence('bounded-random-walk', { seed: 'repeatable', density: .63 });
  const other = compileSequence('bounded-random-walk', { seed: 'different', density: .63 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.steps, other.steps);
  assert.equal(JSON.stringify(SEQUENCE_STUDIES), before);

  const silent = compileSequence('mutable-cell-loop', { seed: 9, density: 0 });
  assert.ok(silent.steps.every(step => step.notes.length === 0));
});

test('hostile runtime options are clamped and copied into immutable settings', () => {
  const settings = sanitizeSequenceOptions('rising-latched-chord', {
    seed: 'x'.repeat(1000), density: 8, gate: -9, swing: 4, tempo: 99999,
    stepBeats: 0, steps: 999, transpose: 999, velocity: -5, maxNotes: 99,
  });
  assert.equal(settings.density, 1);
  assert.equal(settings.gate, .01);
  assert.equal(settings.swing, .49);
  assert.equal(settings.tempo, 1200);
  assert.equal(settings.stepBeats, 1 / 64);
  assert.equal(settings.steps, 64);
  assert.equal(settings.transpose, 96);
  assert.equal(settings.velocity, .01);
  assert.equal(settings.maxNotes, 8);
  assert.ok(Number.isInteger(settings.seed) && settings.seed >= 0);
  assert.ok(Object.isFrozen(settings));

  const cycle = compileSequence({ id: 'rising-latched-chord', config: { intervals: [Infinity] } }, {
    seed: NaN, density: NaN, gate: Infinity, swing: -Infinity, tempo: '40', steps: -20,
  });
  assert.equal(cycle.tempo, 40);
  assert.equal(cycle.steps.length, 1);
  assert.equal(cycle.settings.density, 1);
  assert.equal(cycle.settings.gate, .72);
  assert.equal(cycle.settings.swing, 0);
  assert.ok(soundingNotes(cycle).every(note => Number.isFinite(note.semitone)));
  assert.throws(() => compileSequence('missing-study'), RangeError);
  assert.throws(() => sanitizeSequenceOptions({}), TypeError);
  assert.equal(compileSequence().studyId, SEQUENCE_STUDIES[0].id);
});

test('swing remains bipolar and changes timing without changing total paired duration', () => {
  const straight = compileSequence('rising-latched-chord', { steps: 4, swing: 0, stepBeats: .25 });
  const late = compileSequence('rising-latched-chord', { steps: 4, swing: .4, stepBeats: .25 });
  const early = compileSequence('rising-latched-chord', { steps: 4, swing: -.4, stepBeats: .25 });
  assert.equal(straight.lengthBeats, 1);
  assert.equal(late.lengthBeats, 1);
  assert.equal(early.lengthBeats, 1);
  assert.ok(late.steps[0].duration > late.steps[1].duration);
  assert.ok(early.steps[0].duration < early.steps[1].duration);
});

test('compiled cycles round-trip through the audible processor event shape without aliases', () => {
  const authored = compileSequence('accented-step-line', { steps: 16, seed: 81, gate: .5 });
  const transported = JSON.parse(JSON.stringify(authored));
  const processorShape = {
    studyId: transported.studyId,
    seed: transported.seed,
    stepBeats: transported.stepBeats,
    lengthBeats: transported.lengthBeats,
    steps: transported.steps.map((step, ordinal) => ({
      index: Math.trunc(step.index ?? ordinal),
      at: Number(step.at),
      duration: Number(step.duration),
      notes: step.notes.map(note => ({
        semitone: Number(note.semitone), velocity: Number(note.velocity),
        gate: Number(note.gate), accent: note.accent === true,
      })),
    })),
  };
  assert.deepEqual(processorShape.steps, transported.steps);
  assert.ok(processorShape.steps.every(step => (
    !Object.hasOwn(step, 'atBeats') && !Object.hasOwn(step, 'durationBeats')
    && !Object.hasOwn(step, 'tie') && !Object.hasOwn(step, 'slide')
  )));
});

test('representative historical mechanisms preserve their defining semantics', () => {
  const rising = compileSequence('rising-latched-chord', { steps: 8 });
  const pitches = rising.steps.map(step => step.notes[0].semitone);
  assert.ok(pitches.slice(1).every((pitch, index) => pitch >= pitches[index]));

  const canon = compileSequence('perforated-ratio-canon', { steps: 15 });
  assert.ok(canon.steps.some(step => step.notes.length >= 2));
  assert.ok(soundingNotes(canon).some(note => Math.abs(note.semitone - Math.round(note.semitone)) > .01));

  const drawn = compileSequence('drawn-pitch-ribbon', { steps: 9 });
  assert.ok(new Set(soundingNotes(drawn).map(note => note.semitone)).size > 5);

  const accented = compileSequence('accented-step-line', { steps: 16 });
  assert.ok(soundingNotes(accented).some(note => note.accent));
  assert.ok(soundingNotes(accented).some(note => !note.accent));

  const tracker = compileSequence('tracker-effect-memory', { steps: 8 });
  assert.ok(new Set(soundingNotes(tracker).map(note => note.gate)).size > 1);

  const euclidean = compileSequence('euclidean-pulse-rotation', { steps: 16 });
  assert.equal(euclidean.steps.filter(step => step.notes.length).length, 7);

  const meter = compileSequence('pulse-divider-chain', { steps: 30 });
  assert.ok(meter.steps.some(step => step.notes.length >= 3));

  const condition = compileSequence('recurring-conditional-steps', { steps: 56, seed: 1 });
  assert.ok(condition.steps[0].notes.length >= 1);
  assert.ok(new Set(condition.steps.map(step => step.notes.length)).size > 1);

  const phrase = compileSequence('chord-memory-strum', { steps: 12 });
  assert.ok(phrase.steps.some(step => step.notes.length >= 4));
});

test('all reusable archetypes have at least one compiling catalog study', () => {
  const covered = new Set(SEQUENCE_STUDIES.map(study => study.archetype));
  assert.deepEqual([...covered].sort(), [...SEQUENCE_ARCHETYPES].sort());
  for (const archetype of SEQUENCE_ARCHETYPES) {
    const study = SEQUENCE_STUDIES.find(candidate => candidate.archetype === archetype);
    assert.doesNotThrow(() => compileSequence(study, { seed: 44, steps: 12 }));
  }
});

test('every authored top-level config key is consumed by its archetype contract', () => {
  assert.deepEqual(Object.keys(SEQUENCE_CONFIG_KEYS).sort(), [...SEQUENCE_ARCHETYPES].sort());
  for (const study of SEQUENCE_STUDIES) {
    const allowed = new Set(SEQUENCE_CONFIG_KEYS[study.archetype]);
    for (const key of Object.keys(study.config)) assert.ok(allowed.has(key), `${study.id}: unused config key ${key}`);
  }
});
