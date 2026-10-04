import test from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import { compileSequence } from '../src/instruments/synthesis/sequence-compiler.js';
import { applySequenceParameterValues } from '../src/instruments/synthesis/sequence-parameters.js';
import { sequenceSurfaceKind } from '../src/instruments/synthesis/sequence-surfaces.js';
import { buildSequenceMechanismModel, markovTransitionMatrix } from '../src/instruments/synthesis/sequence-mechanism-view.js';

test('every catalog mechanism has either a real editor or an honest typed readout', () => {
  const kinds = new Set();
  for (const study of SEQUENCE_STUDIES) {
    const editor = sequenceSurfaceKind(study), model = buildSequenceMechanismModel(study);
    assert.notEqual(Boolean(editor), Boolean(model), study.id);
    if (model) {
      kinds.add(model.kind);
      assert.equal(model.id, study.id);
      assert.ok(model.title.length > 3);
      assert.ok(model.blocks.length > 0);
      assert.ok(Object.isFrozen(model));
      assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
      assert.ok(model.caption.length > 15);
    }
  }
  assert.equal(kinds.size, 13);
  assert.equal(buildSequenceMechanismModel('not-an-id'), null);
});

test('tracker columns show effective locks and real carry semantics, not invented values', () => {
  const model = buildSequenceMechanismModel('tracker-effect-memory', { rowRotation: 1, reverseRows: true, velocityScale: .5, carryVelocity: false, carryGate: true });
  const { config } = applySequenceParameterValues('tracker-effect-memory', { rowRotation: 1, reverseRows: true, velocityScale: .5, carryVelocity: false, carryGate: true });
  const grid = model.blocks[0];
  assert.deepEqual(grid.columns, ['Row', 'Pitch offsets', 'Velocity', 'Row gate']);
  assert.equal(grid.rows.length, config.rows.length);
  config.rows.forEach((source, index) => {
    if (!Number.isFinite(source.velocity)) assert.equal(grid.rows[index][2], '72% default');
    if (!Number.isFinite(source.gate)) assert.equal(grid.rows[index][3], 'carry');
  });
});

test('phrase memory reflects effective chain rotation, phrase reversal and transposition', () => {
  const initial = buildSequenceMechanismModel('phrase-bank-switching');
  const parameters = { chainRotation: 1, phraseOrder: 'reverse', phraseRise: 3.5 };
  const model = buildSequenceMechanismModel('phrase-bank-switching', parameters);
  const { config } = applySequenceParameterValues('phrase-bank-switching', parameters);
  assert.notDeepEqual(model.blocks, initial.blocks);
  assert.equal(model.blocks[0].cells.length, config.chain.length);
  config.chain.forEach((phrase, index) => assert.ok(model.blocks[0].cells[index].text.startsWith(String.fromCharCode(65 + phrase))));
  assert.ok(model.blocks[0].cells[1].text.includes('+3.5'));
  assert.equal(model.blocks[1].rows.length, config.phrases.length);
});

test('Markov matrix collapses clipped transitions and normalizes actual effective weights', () => {
  assert.deepEqual(markovTransitionMatrix({ states: [0, 3, 7], transitions: [[1, 2, 1]], maxLeap: 1 }), [
    [.75, .25, 0], [.25, .5, .25], [0, .25, .75],
  ]);
  assert.deepEqual(markovTransitionMatrix({ states: [0, 3, 7], transitions: [[0, 0, 0]], maxLeap: 1 }), [
    [1, 0, 0], [1, 0, 0], [0, 1, 0],
  ]);
  const parameters = { maxLeap: 1, transitionFocus: 3, stateSpread: 1.5 };
  const { config } = applySequenceParameterValues('bounded-random-walk', parameters);
  const model = buildSequenceMechanismModel('bounded-random-walk', parameters);
  const matrix = markovTransitionMatrix(config);
  model.blocks[0].rows.forEach((row, index) => {
    const probabilities = row.slice(1).map(cell => cell.probability);
    assert.deepEqual(probabilities, matrix[index]);
    assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    for (let target = 0; target < probabilities.length; target++) if (Math.abs(index - target) > 1) assert.equal(probabilities[target], 0);
  });
});

test('independent lane onsets agree with the compiler before output thinning', () => {
  for (const study of SEQUENCE_STUDIES.filter(study => ['ratio-canon', 'polymeter'].includes(study.archetype))) {
    const parameters = { density: 1, periodScale: 1.5, phaseShift: 2 };
    const cycle = compileSequence(study, { parameters });
    const model = buildSequenceMechanismModel(study, parameters, cycle), lanes = model.blocks[0].lanes;
    assert.equal(lanes.length, (study.config.voices || study.config.lanes).length);
    cycle.steps.forEach((step, index) => assert.equal(lanes.filter(lane => lane.cells[index] != null).length, step.notes.length, `${study.id}: ${index}`));
  }
});

test('drawn rows expose transformed anchors, masks and velocities without invented voice tracking', () => {
  const id = 'drawn-density-bands', parameters = { contourScale: 1.7, reverseContour: true, invertMasks: true };
  const model = buildSequenceMechanismModel(id, parameters), { config } = applySequenceParameterValues(id, parameters);
  model.blocks[0].rows.forEach((row, index) => {
    assert.deepEqual(row.points, config.rows[index]);
    assert.deepEqual(row.mask, config.masks[index]);
  });
  assert.match(model.caption, /No continuous portamento/);
});

test('parameter rows retain their independent source lengths', () => {
  const model = buildSequenceMechanismModel('punched-duration-grid', { durationScale: 2, velocityScale: .7 });
  const { config } = applySequenceParameterValues('punched-duration-grid', { durationScale: 2, velocityScale: .7 });
  assert.deepEqual(model.blocks[0].rows.map(row => row[1]), ['pitch', 'velocity', 'gate', 'duration'].map(key => config[key].length));
  assert.ok(new Set(model.blocks[0].rows.map(row => row[1])).size > 1);
});

test('held-note paths use the actual compiled output and reject stale supplied cycles', () => {
  const id = 'rising-latched-chord', parameters = { order: 'down', octaves: 2, density: 1 };
  const cycle = compileSequence(id, { parameters });
  const tunedCycle = { ...cycle, steps: cycle.steps.map(step => ({ ...step, notes: step.notes.map(note => ({ ...note, ratio: 1.25 })) })) };
  const model = buildSequenceMechanismModel(id, parameters, tunedCycle);
  const path = model.blocks.find(block => block.type === 'path');
  assert.match(path.label, /tuned ratios/);
  assert.equal(path.cells.length, cycle.steps.length);
  assert.ok(path.cells.every(cell => cell.text === '×1.25'));
  const stale = buildSequenceMechanismModel(id, { ...parameters, order: 'up' }, tunedCycle);
  assert.doesNotMatch(stale.blocks.find(block => block.type === 'path').label, /tuned ratios/);
});

test('mutation passes are actual compiled results, including the current seed', () => {
  const id = 'mutable-cell-loop', parameters = { mutationChance: 1, seed: 912, steps: 48, density: 1 };
  const model = buildSequenceMechanismModel(id, parameters), other = buildSequenceMechanismModel(id, { ...parameters, seed: 135 });
  const passes = model.blocks.find(block => block.type === 'passes').passes;
  assert.equal(passes.length, 6);
  assert.deepEqual(passes.flatMap(pass => pass.cells.map(cell => cell.outputStep)), Array.from({ length: 48 }, (_, index) => index));
  assert.notDeepEqual(passes, other.blocks.find(block => block.type === 'passes').passes);
});

test('conditional readout shows effective rules rather than treating chance as a note sequence', () => {
  const id = 'operator-recurrence-grid', parameters = { periodScale: 2, offsetShift: 2, probabilityScale: .5, breathe: .7 };
  const model = buildSequenceMechanismModel(id, parameters), { config } = applySequenceParameterValues(id, parameters);
  config.cells.forEach((cell, index) => {
    assert.equal(model.blocks[0].rows[index][2], cell.every == null ? 'each step' : cell.every);
    assert.equal(model.blocks[0].rows[index][3], cell.every == null ? '—' : cell.offset || 0);
  });
  assert.equal(model.blocks[1].value, '70%');
});
