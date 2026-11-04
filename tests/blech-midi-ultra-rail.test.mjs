import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blechCombStride, blechCombNotes, blechCombBlockNotes, blechCrossingNotes, blechRailPeriod,
} from '../src/instruments/blech-midi-ultra/blech-midi-spigots.js';
import { blechStrokeScore } from '../src/instruments/blech-midi-ultra/blech-midi-spigot-engine.js';

test('left-rail hold steps arrive at the same times as the top-rail hold steps', () => {
  for (const [milliseconds, stride, period] of [
    [0, 1, .25], [249, 1, .25],
    [250, 2, .5], [799, 2, .5],
    [800, 3, 1], [1349, 3, 1],
    [1350, 4, 2], [1899, 4, 2],
    [1900, 5, 4], [2449, 5, 4],
    [2450, 6, 8], [3550, 8, 8],
    [7950, 16, 8], [30_000, 16, 8],
  ]) {
    assert.equal(blechCombStride(milliseconds), stride, `${milliseconds}ms left rail`);
    assert.equal(blechRailPeriod(milliseconds), period, `${milliseconds}ms top rail`);
  }
  assert.equal(blechCombStride(NaN), 1);
  assert.equal(blechCombStride(-5), 1);
});

test('left-rail spacing emits every Nth pitch, starting at the first key', () => {
  for (const [stride, count] of [[1, 128], [2, 64], [3, 43], [4, 32], [5, 26], [16, 8]]) {
    const notes = blechCombNotes(stride);
    assert.equal(notes.length, count);
    assert.deepEqual(notes.map(({ note }) => note), Array.from({ length: count }, (_, n) => n * stride));
    assert.ok(notes.every(({ beat, duration, channel }) => beat === 0 && duration === .25 && channel === 0));
  }
  assert.deepEqual(blechCombNotes(), blechCombNotes(1));
  assert.deepEqual(blechCombNotes(128), blechCombNotes(16), 'pitch spacing stays bounded');
  const midi = blechStrokeScore(blechCombNotes(5), .25);
  assert.deepEqual(midi.analysis.notes.map(note => note.note), blechCombNotes(5).map(note => note.note));
  assert.equal(midi.analysis.durationBeats, .25, 'the selected chord is a single MIDI row');
});

test('only the corner repeats the same selected pitches over musical time', () => {
  for (const stride of [1, 3, 4, 5, 16]) {
    const pitches = blechCombNotes(stride).map(note => note.note);
    const notes = blechCrossingNotes(stride, .25);
    assert.equal(notes.length, pitches.length, 'one chord, repeated by the audio clock');
    assert.deepEqual(notes.map(note => note.note), pitches);
    assert.ok(notes.every(note => note.beat === 0 && note.duration === .125));
  }
});

test('left-rail taps land at their chosen time; drags create bounded one-shot rows in both directions', () => {
  const tap = blechCombBlockNotes(5, 3);
  assert.deepEqual(tap, { notes: blechCombNotes(5), delayBeats: 3, rows: 1 });
  const up = blechCombBlockNotes(3, 1.25, 2);
  const down = blechCombBlockNotes(3, 2, 1.25);
  assert.deepEqual(down, up);
  assert.equal(up.rows, 4);
  assert.equal(up.delayBeats, 1.25);
  assert.deepEqual([...new Set(up.notes.map(note => note.beat))], [0, .25, .5, .75]);
  assert.ok(up.notes.every(note => note.duration === .125 && note.channel === 0));
  const giant = blechCombBlockNotes(1, 0, 64);
  assert.equal(giant.rows, 32);
  assert.equal(giant.notes.length, 4096);
  assert.equal(giant.notes[0].beat, 0);
  assert.equal(giant.notes.at(-1).beat, 64);
  assert.ok(giant.notes.every(note => note.beat <= 64));
});
