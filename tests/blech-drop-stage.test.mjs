import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainDropPosition } from '../src/instruments/blech-midi/blech-midi-drop-stage.js';

test('positioning preserves intervals by bounding the complete phrase at keyboard edges', () => {
  const notes = [40, 47, 64].map(note => ({ note }));
  assert.equal(constrainDropPosition(notes, { transpose: -100 }).transpose, -40);
  assert.equal(constrainDropPosition(notes, { transpose: 100 }).transpose, 63);
  const full = [0,127].map(note => ({ note }));
  assert.equal(constrainDropPosition(full, { transpose: 5 }).transpose, 0);
  assert.equal(constrainDropPosition(full, { transpose: -5 }).transpose, 0);
});

test('delay is a nonnegative quarter-beat position independent of phrase pitch', () => {
  const notes = [{ note: 60 }];
  assert.deepEqual(constrainDropPosition(notes, { transpose: 3, delayBeats: 2.37 }), { transpose: 3, delayBeats: 2.25 });
  assert.equal(constrainDropPosition(notes, { delayBeats: -12 }).delayBeats, 0);
  assert.equal(constrainDropPosition(notes, { delayBeats: 800 }).delayBeats, 64);
  assert.deepEqual(constrainDropPosition([], { transpose: 3, delayBeats: NaN }), { transpose: 0, delayBeats: 0 });
});
