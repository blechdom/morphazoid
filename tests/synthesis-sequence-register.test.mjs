import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceRegisterMultiplier } from '../src/instruments/synthesis/sequence-register.js';

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
