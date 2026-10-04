import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import { createSequenceParameterValues, getSequenceParameterBounds, applySequenceParameterValues } from '../src/instruments/synthesis/sequence-parameters.js';
import { compileSequence } from '../src/instruments/synthesis/sequence-compiler.js';
import { capturePerformanceSnapshot, applyPerformanceSnapshot } from '../src/instruments/synthesis/performance-presets.js';

const studies = SEQUENCE_STUDIES.filter(study => study.archetype === 'cv-rows');

test('edited voltage-gate periods expand live phase bounds without clipping saved rotations', () => {
  for (const study of studies) {
    const stageGates = study.config.gates.map((_, index) => index === 0 ? 1 : 0);
    const bounds = getSequenceParameterBounds(study, 'gateRotation', { stageGates });
    assert.deepEqual(bounds, { min: -3, max: 4 }, study.id);
    const patterns = new Set();
    for (let gateRotation = bounds.min; gateRotation <= bounds.max; gateRotation++) {
      const parameters = createSequenceParameterValues(study, { stageGates, gateRotation, density: 1, steps: 8 });
      assert.equal(parameters.gateRotation, gateRotation, `${study.id}: phase retained`);
      const gates = compileSequence(study, { parameters }).steps.map(step => Number(step.notes.length > 0));
      assert.equal(gates.filter(Boolean).length, 1);
      patterns.add(JSON.stringify(gates));
      assert.deepEqual(gates, applySequenceParameterValues(study, parameters).config.gates);
      const snapshot = capturePerformanceSnapshot({ sequence: { id: study.id, parameters } });
      assert.deepEqual(applyPerformanceSnapshot(JSON.parse(JSON.stringify(snapshot))).sequence.parameters, parameters);
    }
    assert.equal(patterns.size, stageGates.length, `${study.id}: every distinct phase is reachable`);
  }
});

test('constant and repeating edited gates remove ineffective phase ranges', () => {
  for (const study of studies) {
    for (const value of [0, 1]) {
      const stageGates = study.config.gates.map(() => value);
      assert.deepEqual(getSequenceParameterBounds(study, 'gateRotation', { stageGates }), { min: 0, max: 0 });
      assert.equal(createSequenceParameterValues(study, { stageGates, gateRotation: 4 }).gateRotation, 0);
    }
    const stageGates = study.config.gates.map((_, index) => index % 2);
    assert.deepEqual(getSequenceParameterBounds(study, 'gateRotation', { stageGates }), { min: 0, max: 1 });
    assert.equal(createSequenceParameterValues(study, { stageGates, gateRotation: 4 }).gateRotation, 1);
  }
});

test('malformed gate arrays use the same bounded sanitization in model and live controls', () => {
  for (const study of studies) {
    for (const stageGates of [[], null, {}, [1], ['false', 'true', null, NaN], Array(100).fill('true')]) {
      const parameters = createSequenceParameterValues(study, { stageGates, gateRotation: 999 });
      assert.deepEqual(getSequenceParameterBounds(study, 'gateRotation', { stageGates }), getSequenceParameterBounds(study, 'gateRotation', parameters));
      assert.deepEqual(createSequenceParameterValues(study, JSON.parse(JSON.stringify(parameters))), parameters);
    }
    assert.deepEqual(createSequenceParameterValues(study).stageGates, undefined, 'legacy default remains scalar-only');
  }
});
