import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSequenceToTuning, sequenceRegisterMultiplier } from '../src/instruments/synthesis/sequence-register.js';
import { compileSequence } from '../src/instruments/synthesis/sequence-compiler.js';
import { TUNINGS } from '../src/instruments/synthesis/tunings.js';

test('wide arpeggios move as one contour instead of folding their highest notes', () => {
  const ascending = Array.from({ length: 8 }, (_, octave) => [0, 3.8, 7.1].map(note => 2 ** (octave + note / 12))).flat();
  const pendulum = [...ascending, ...ascending.slice(1, -1).reverse()];
  for (const root of [20, 55, 137, 223, 440, 1021, 8000]) {
    const factor = sequenceRegisterMultiplier(pendulum, root);
    assert.ok(factor > 0);
    assert.ok(Number.isInteger(Math.log2(factor)), 'register shift is a whole octave');
    const frequencies = pendulum.map(ratio => ratio * factor * root);
    assert.ok(Math.min(...frequencies) >= 20);
    assert.ok(Math.max(...frequencies) <= 8000);
    for (let i = 1; i < ascending.length; i++) assert.ok(frequencies[i] > frequencies[i - 1]);
    for (let i = ascending.length; i < frequencies.length; i++) assert.ok(frequencies[i] < frequencies[i - 1]);
    assert.ok(Math.max(...frequencies) / Math.min(...frequencies) > 128, 'more than seven octaves survive');
  }
});

test('live and level-probe mapping preserves playable notes for every tuning and both register edges', () => {
  const cycle = compileSequence('keyboard-range-arpeggio', { parameters: { fullTraversal: true, octaves: 8, transpose: -36, density: 1 } });
  const original = structuredClone(cycle);
  for (const tuning of TUNINGS) for (const rootFrequency of [20, 137, 8000]) {
    for (const pitchMode of ['nearest', 'contour', 'original']) {
      const mapped = mapSequenceToTuning(cycle, { tuningId: tuning.id, rootFrequency, pitchMode });
      assert.equal(mapped.steps.length, cycle.steps.length);
      mapped.steps.forEach((step, index) => {
        assert.equal(step.notes.length, cycle.steps[index].notes.length, `${tuning.id} ${rootFrequency} ${pitchMode}`);
        for (const note of step.notes) assert.ok(note.ratio * rootFrequency >= 20 && note.ratio * rootFrequency <= 8000);
      });
      assert.equal(mapped.tuningId, tuning.id);
      assert.equal(mapped.pitchMode, pitchMode);
    }
  }
  assert.deepEqual(cycle, original);
  assert.equal(mapSequenceToTuning(null), null);
  assert.deepEqual(mapSequenceToTuning(cycle, { rootFrequency: NaN }).steps.flatMap(step => step.notes), []);
});

test('register fitting preserves already playable notes and non-octave tuning periods', () => {
  assert.equal(sequenceRegisterMultiplier([.5, 1, 1.5, 2], 220), 1);
  const factor = sequenceRegisterMultiplier([1, 3, 9, 27], 440, 3);
  assert.equal(factor, 1 / 3);
  assert.deepEqual([1, 3, 9, 27].map(ratio => ratio * factor), [1 / 3, 1, 3, 9]);
  assert.equal(sequenceRegisterMultiplier([], 220), 1);
  assert.equal(sequenceRegisterMultiplier([1, 1000], 220), null, 'impossible spans are explicit');
  for (const invalid of [NaN, Infinity, 0, -1]) {
    assert.equal(sequenceRegisterMultiplier([1, invalid], 220), null);
    assert.equal(sequenceRegisterMultiplier([1, 2], invalid), null);
  }
  assert.equal(sequenceRegisterMultiplier([1, 2], 220, 1), null);
});
