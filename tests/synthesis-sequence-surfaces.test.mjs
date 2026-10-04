import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES, getSequenceStudy } from '../src/instruments/synthesis/sequence-catalog.js';
import { compileSequence, euclideanPattern } from '../src/instruments/synthesis/sequence-compiler.js';
import { createSequenceParameterValues, applySequenceParameterValues, sanitizeGesturePoints } from '../src/instruments/synthesis/sequence-parameters.js';
import { capturePerformanceSnapshot, applyPerformanceSnapshot } from '../src/instruments/synthesis/performance-presets.js';
import { sequenceSurfaceKind, sequenceSurfaceData, editGesturePoint, paintVoltageStages, editEuclideanSurface } from '../src/instruments/synthesis/sequence-surfaces.js';

test('surfaces only claim the three mechanisms they actually edit', () => {
  for (const study of SEQUENCE_STUDIES) {
    assert.equal(sequenceSurfaceKind(study), ['gesture', 'euclidean', 'cv-rows'].includes(study.archetype) ? study.archetype : null);
  }
  assert.equal(sequenceSurfaceKind('not-a-study'), null);
});

test('unedited historical data and scalar snapshots stay unchanged', () => {
  for (const study of SEQUENCE_STUDIES) {
    const parameters = createSequenceParameterValues(study);
    assert.ok(!('gesturePoints' in parameters));
    assert.ok(!('stagePitches' in parameters));
    assert.ok(!('stageGates' in parameters));
    assert.deepEqual(applySequenceParameterValues(study, parameters).config, study.config);
  }
});

test('gesture time, pitch and pressure change the compiler output and survive full presets', () => {
  const id = 'captured-control-gesture';
  const original = createSequenceParameterValues(id, { density: 1, densityFromPressure: false });
  let edited = editGesturePoint(id, original, 1, { note: 19.5, time: .31, pressure: .27 });
  const first = compileSequence(id, { parameters: original });
  const second = compileSequence(id, { parameters: edited });
  assert.notDeepEqual(second.steps.map(step => step.notes), first.steps.map(step => step.notes));
  assert.equal(edited.gesturePoints[1].note, 19.5);
  assert.equal(edited.gesturePoints[1].time, .31);
  assert.equal(edited.gesturePoints[1].pressure, .27);
  const snapshot = capturePerformanceSnapshot({ sequence: { id, parameters: edited, tempoBpm: 112 } });
  const restored = applyPerformanceSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(restored.sequence.parameters.gesturePoints, edited.gesturePoints);
  assert.deepEqual(compileSequence(id, { parameters: restored.sequence.parameters }).steps, second.steps);
  edited = editGesturePoint(id, edited, 0, { time: .7, note: 5 });
  assert.equal(edited.gesturePoints[0].time, 0, 'loop origin is fixed');
  assert.equal(edited.gesturePoints[0].note, 5);
  const end = edited.gesturePoints.length - 1;
  edited = editGesturePoint(id, edited, end, { time: .2 });
  assert.equal(edited.gesturePoints[end].time, 1, 'loop end is fixed');
  assert.equal(getSequenceStudy(id).config.points[1].note, sequenceSurfaceData(id, original)[1].note, 'catalog never mutates');
});

test('gesture edits are bounded, detached, deterministic, and malformed fields cannot leak', () => {
  const hostile = Array.from({ length: 1000 }, (_, index) => ({ time: index / 63, note: index % 2 ? 1e6 : -1e6, pressure: index % 2 ? 9 : -9, unknown: 'discard' }));
  const parameters = createSequenceParameterValues('pointer-density-field', { gesturePoints: hostile });
  assert.equal(parameters.gesturePoints.length, 64);
  assert.equal(parameters.gesturePoints[0].time, 0);
  assert.equal(parameters.gesturePoints.at(-1).time, 1);
  for (const point of parameters.gesturePoints) {
    assert.ok(point.note >= -96 && point.note <= 96);
    assert.ok(point.pressure >= 0 && point.pressure <= 1);
    assert.deepEqual(Object.keys(point), ['time', 'note', 'pressure']);
    assert.ok(Object.isFrozen(point));
  }
  hostile[0].note = 1;
  assert.equal(parameters.gesturePoints[0].note, -96);
  assert.equal(sanitizeGesturePoints([null, {}, { time: 0, note: NaN, pressure: .7 }]), null);
  assert.equal(sanitizeGesturePoints([{ time: 0, note: 0, pressure: 1 }, { time: 0, note: 2, pressure: .5 }]), null);
  assert.ok(!('gesturePoints' in createSequenceParameterValues('rising-latched-chord', { gesturePoints: parameters.gesturePoints })));
  const copy = createSequenceParameterValues('pointer-density-field', JSON.parse(JSON.stringify(parameters)));
  assert.deepEqual(copy, parameters);
  assert.deepEqual(compileSequence('pointer-density-field', { parameters }).steps, compileSequence('pointer-density-field', { parameters: copy }).steps);
});

test('time edits cannot cross a neighbor, and pressure controls velocity and probability', () => {
  const id = 'captured-control-gesture';
  const points = [{ time: 0, note: 0, pressure: .8 }, { time: .4, note: 10, pressure: .5 }, { time: .6, note: 4, pressure: .9 }, { time: 1, note: 0, pressure: .3 }];
  const edited = editGesturePoint(id, { gesturePoints: points }, 1, { time: 1 });
  assert.equal(edited.gesturePoints.length, 4);
  assert.ok(edited.gesturePoints[1].time < edited.gesturePoints[2].time);
  const silent = createSequenceParameterValues(id, { gesturePoints: points.map(point => ({ ...point, pressure: 0 })), densityFromPressure: true });
  assert.ok(compileSequence(id, { parameters: silent }).steps.every(step => !step.notes.length));
  const loud = createSequenceParameterValues(id, { gesturePoints: points.map(point => ({ ...point, pressure: 1 })), densityFromPressure: true });
  assert.ok(compileSequence(id, { parameters: loud }).steps.every(step => step.notes[0]?.velocity === 1));
});

test('fast voltage painting interpolates skipped stages and changes real pitch addresses', () => {
  const id = 'three-row-voltage-walk';
  const original = createSequenceParameterValues(id);
  const count = getSequenceStudy(id).config.pitch.length;
  const edited = paintVoltageStages(id, original, 0, count - 1, -12, 12);
  assert.equal(edited.stagePitches.length, count);
  edited.stagePitches.forEach((note, index) => assert.ok(Math.abs(note - (-12 + 24 * index / (count - 1))) < 1e-10));
  const reversed = paintVoltageStages(id, original, count - 1, 0, 12, -12);
  reversed.stagePitches.forEach((note, index) => assert.ok(Math.abs(note - edited.stagePitches[index]) < 1e-10));
  assert.notDeepEqual(compileSequence(id, { parameters: original }).steps, compileSequence(id, { parameters: edited }).steps);
  const captured = capturePerformanceSnapshot({ sequence: { id, parameters: edited } });
  assert.deepEqual(applyPerformanceSnapshot(JSON.parse(JSON.stringify(captured))).sequence.parameters.stagePitches, edited.stagePitches);
});

test('voltage gate painting edits clock slots independently of stage addressing', () => {
  const id = 'addressed-stage-skip';
  const initial = sequenceSurfaceData(id, {}), count = initial.gates.length;
  const silent = paintVoltageStages(id, {}, 0, count - 1, 0, 0, true);
  assert.ok(compileSequence(id, { parameters: silent }).steps.every(step => !step.notes.length));
  const active = paintVoltageStages(id, silent, 0, count - 1, 1, 1, true);
  assert.ok(compileSequence(id, { parameters: active }).steps.some(step => step.notes.length));
  assert.deepEqual(sequenceSurfaceData(id, active).address, initial.address);
  assert.deepEqual(sequenceSurfaceData(id, active).pitches, initial.pitches);
  assert.ok(!('stageGates' in createSequenceParameterValues('pointer-density-field', active)));
});

test('Euclidean circle and compiler share gates, pulse counts and wrapped phase', () => {
  const id = 'euclidean-pulse-rotation';
  for (let slots = 1; slots <= 64; slots++) {
    for (const pulses of [0, Math.floor(slots / 2), slots]) {
      const values = editEuclideanSurface(id, { steps: 64 }, { euclideanSteps: slots, pulses, rotation: 999 });
      const displayed = sequenceSurfaceData(id, values);
      assert.equal(displayed.length, slots);
      assert.equal(displayed.filter(Boolean).length, pulses);
      const cycle = compileSequence(id, { parameters: values });
      assert.deepEqual(cycle.steps.slice(0, slots).map(step => Number(step.notes.length > 0)), displayed);
      assert.deepEqual(createSequenceParameterValues(id, JSON.parse(JSON.stringify(values))), values);
    }
  }
  const values = editEuclideanSurface(id, { euclideanSteps: 8, pulses: 3 }, { rotation: 5 });
  assert.equal(values.rotation, -3);
  assert.notDeepEqual(sequenceSurfaceData(id, { euclideanSteps: 8, pulses: 3, rotation: 0 }), sequenceSurfaceData(id, values));
  assert.deepEqual(euclideanPattern(Infinity, -1), [1]);
});
