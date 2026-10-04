import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import { compileSequence } from '../src/instruments/synthesis/sequence-compiler.js';
import { createSequenceParameterValues } from '../src/instruments/synthesis/sequence-parameters.js';
import { capturePerformanceSnapshot, applyPerformanceSnapshot, randomizeSequenceParameters } from '../src/instruments/synthesis/performance-presets.js';

const studies = SEQUENCE_STUDIES.filter(study => ['gesture', 'cv-rows'].includes(study.archetype));
const mulberry32 = seed => () => {
  let value = seed += 0x6d2b79f5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};
const finiteTree = (value, label) => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), label);
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => finiteTree(child, `${label}.${key}`));
};
const assertDrawings = (study, values) => {
  if (study.archetype === 'gesture') {
    assert.ok(values.gesturePoints?.length >= 4, `${study.id}: randomized gesture remains stored`);
    assert.equal(values.gesturePoints[0].time, 0);
    assert.equal(values.gesturePoints.at(-1).time, 1);
    values.gesturePoints.forEach((point, index) => {
      assert.ok(point.note >= -6 && point.note <= 18);
      assert.ok(point.pressure >= .55 && point.pressure <= 1);
      if (index) assert.ok(point.time > values.gesturePoints[index - 1].time);
    });
  } else {
    assert.equal(values.stagePitches?.length, study.config.pitch.length, `${study.id}: randomized voltages remain stored`);
    assert.equal(values.stageGates?.length, (study.config.gates || study.config.pitch).length, `${study.id}: randomized gates remain stored`);
    assert.ok(values.stagePitches.every(pitch => pitch >= -6 && pitch <= 18));
    assert.ok(values.stageGates.every(gate => gate === 0 || gate === 1));
  }
};
const assertPlayable = (study, parameters) => {
  const cycle = compileSequence(study, { parameters });
  finiteTree(cycle, study.id);
  const sounding = cycle.steps.filter(step => step.notes.length);
  assert.ok(sounding.length >= Math.max(4, Math.ceil(cycle.steps.length * .2)), `${study.id}: useful event density`);
  assert.ok(sounding[0].at * 60 / 64 <= .75, `${study.id}: early attack even at minimum random tempo`);
  const notes = sounding.flatMap(step => step.notes);
  assert.ok(notes.every(note => note.semitone >= -36 && note.semitone <= 36 && note.velocity >= .12 && note.velocity <= 1));
  assert.ok(notes.length / cycle.lengthBeats * 64 / 60 >= .6, `${study.id}: sufficient note rate`);
  assert.ok(notes.length / cycle.lengthBeats * 180 / 60 <= 24, `${study.id}: bounded note rate`);
  const gates = sounding.flatMap(step => step.notes.map(note => step.duration * note.gate * 60 / 180));
  assert.ok(gates.every(gate => gate >= .004), `${study.id}: minimum gate`);
  assert.ok(gates.reduce((sum, gate) => sum + gate, 0) / gates.length >= .03, `${study.id}: mean gate`);
};

test('randomized editable drawings survive RNG extremes and remain playable', () => {
  for (const study of studies) {
    for (const edge of [0, 1, -.1, 2, NaN, Infinity, -Infinity, .01, .5, .99]) {
      const parameters = randomizeSequenceParameters(study, () => edge);
      assertDrawings(study, parameters);
      assertPlayable(study, parameters);
      assert.deepEqual(parameters, createSequenceParameterValues(study, parameters));
      assert.deepEqual(parameters, randomizeSequenceParameters(study, () => edge), `${study.id}: deterministic recovery`);
    }
  }
});

test('every editable voltage gate and stage varies rather than retaining a fixed first gate', () => {
  for (const study of studies.filter(study => study.archetype === 'cv-rows')) {
    const samples = Array.from({ length: 192 }, (_, index) => randomizeSequenceParameters(study, mulberry32(index + 123)));
    samples.forEach(values => { assertDrawings(study, values); assertPlayable(study, values); });
    for (let stage = 0; stage < study.config.pitch.length; stage++) {
      assert.ok(new Set(samples.map(values => values.stagePitches[stage])).size > 100, `${study.id}: voltage ${stage + 1} varies`);
    }
    for (let gate = 0; gate < samples[0].stageGates.length; gate++) {
      assert.deepEqual(new Set(samples.map(values => values.stageGates[gate])), new Set([0, 1]), `${study.id}: gate ${gate + 1} is not frozen`);
    }
  }
});

test('every gesture pitch, pressure and interior time varies across dice throws', () => {
  for (const study of studies.filter(study => study.archetype === 'gesture')) {
    const samples = Array.from({ length: 128 }, (_, index) => randomizeSequenceParameters(study, mulberry32(index + 5000)));
    samples.forEach(values => { assertDrawings(study, values); assertPlayable(study, values); });
    for (const field of ['note', 'pressure', 'time']) {
      assert.ok(new Set(samples.map(values => values.gesturePoints[1][field])).size > 100, `${study.id}: interior ${field} varies`);
    }
    assert.ok(new Set(samples.map(values => values.gesturePoints[0].note)).size > 100, `${study.id}: endpoint pitch is not frozen`);
  }
});

test('dice replaces old graph edits without mutating them and complete presets retain the new drawing', () => {
  for (const study of studies) {
    const edited = createSequenceParameterValues(study, study.archetype === 'gesture'
      ? { gesturePoints: [{ time: 0, note: -90, pressure: .01 }, { time: 1, note: 90, pressure: .02 }] }
      : { stagePitches: study.config.pitch.map(() => 90), stageGates: (study.config.gates || study.config.pitch).map(() => 0) });
    const before = structuredClone(edited);
    const parameters = randomizeSequenceParameters(study, edited, mulberry32(77));
    assert.deepEqual(edited, before, 'caller graph remains untouched');
    assertDrawings(study, parameters);
    const snapshot = capturePerformanceSnapshot({ sequence: { id: study.id, parameters } });
    const restored = applyPerformanceSnapshot(JSON.parse(JSON.stringify(snapshot)));
    assert.deepEqual(restored.sequence.parameters, parameters, `${study.id}: complete preset round trip`);
    assert.deepEqual(compileSequence(study, { parameters }).steps, compileSequence(study, { parameters: restored.sequence.parameters }).steps);
    assert.notDeepEqual(compileSequence(study, { parameters }).steps, compileSequence(study, { parameters: edited }).steps, `${study.id}: graph edits reach the actual compiler`);
  }
});
