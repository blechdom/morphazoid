import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackOffsetForBeat as offset } from '../src/instruments/voicesaurus/playback-offset.js';

const notes = [
  { index: 0, startBeats: 0, beats: 1, startSeconds: 0, seconds: .5 },
  { index: 1, startBeats: 1, beats: 2, startSeconds: .5, seconds: 1, rest: true },
  { index: 2, startBeats: 3, beats: 1, startSeconds: 1.5, seconds: .5 },
];
const native = { noteTimings: [
  { index: 0, start: 0, end: .5 },
  { index: 1, start: .5, end: 1.5 },
  { index: 2, start: 1.5, end: 2, releaseEnd: 2.5 },
] };

test('native mid-note and rest seeking use actual current-render slots', () => {
  assert.equal(offset(.5, notes, native), .25);
  assert.equal(offset(2, notes, native), 1);
  assert.equal(offset(3, notes, native), 1.5);
  assert.equal(offset(3.5, notes, native), 1.75);
});

test('display tail clamps to authored end and retains final release in PCM', () => {
  assert.equal(offset(6, notes, native), 2);
});

test('beat zero includes native Sinsy lead-in, while later positions include its boundary rest', () => {
  const sinsy = { noteTimings: native.noteTimings.map(t => ({ ...t, start: t.start + .125, end: t.end + .125 })) };
  assert.equal(offset(0, notes, sinsy), 0);
  assert.equal(offset(.5, notes, sinsy), .375);
  assert.equal(offset(1, notes, sinsy), .625);
});

test('sample-bank beat zero includes pickup and later positions include scoreOffsetSeconds', () => {
  assert.equal(offset(0, notes, { scoreOffsetSeconds: .17 }), 0);
  assert.equal(offset(1, notes, { scoreOffsetSeconds: .17 }), .67);
  assert.equal(offset(2, notes, { scoreOffsetSeconds: .17 }), 1.17);
});

test('render timing takes precedence over a stale nominal tempo projection', () => {
  const shifted = { noteTimings: native.noteTimings.map(t => ({ ...t, start: t.start * 2, end: t.end * 2 })) };
  assert.equal(offset(3.5, notes, shifted), 3.5);
});

test('mapping uses native tick-rounded endpoints and matches timing indexes rather than list offsets', () => {
  const rounded = [{ index: 7, startBeats: 0, beats: .333, startSeconds: 0, seconds: .1665 }];
  assert.equal(offset(.333, rounded, { noteTimings: [{ index: 7, start: .125, end: .2916666666666667 }] }), .2916666666666667);
});

test('zero-length notes do not divide by zero or prevent later note selection', () => {
  const withZero = [{ index: 0, startBeats: 0, beats: 0, startSeconds: 0, seconds: 0 }, { index: 1, startBeats: 0, beats: 1, startSeconds: 0, seconds: .5 }];
  assert.equal(offset(.5, withZero), .25);
  assert.equal(offset(10, [...withZero, { index: 2, startBeats: 1, beats: 0, startSeconds: .5, seconds: 0 }]), .5);
});

test('malformed timing and non-finite targets fail without silently jumping to the start', () => {
  assert.throws(() => offset(NaN, notes), /finite/);
  assert.throws(() => offset(Infinity, notes), /finite/);
  assert.throws(() => offset(1, []), /Add a note/);
  assert.throws(() => offset(1, [{ ...notes[0], beats: Infinity }]), /finite beat timeline/);
  assert.throws(() => offset(1, [{ ...notes[0], seconds: null }]), /Timing is unavailable/);
});
