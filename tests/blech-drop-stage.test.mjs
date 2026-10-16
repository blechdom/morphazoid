import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainDropPosition, dropScoreDimensions, resizeDropScore } from '../src/instruments/blech-midi/blech-midi-drop-stage.js';

import { encodeArtwork } from '../src/instruments/blech-midi/blech-midi-art.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

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


const artScore = () => encodeArtwork([
  { note: 40, beat: 0, duration: 1, velocity: 60 },
  { note: 52, beat: 1, duration: .5, velocity: 90 },
  { note: 64, beat: 3, duration: 1, velocity: 110 },
], { durationBeats: 8, title: 'Resize test' });

test('unchanged block retains source bytes, notes and exact loop boundary', () => {
  const score = artScore();
  assert.equal(resizeDropScore(score), score);
  assert.equal(dropScoreDimensions(score).width, 25);
  assert.equal(dropScoreDimensions(score).heightBeats, 8);
});

test('width and height resize actual pitches and timing without replacing the prepared source', () => {
  const original = artScore(), before = original.buffer.slice(0);
  const resized = resizeDropScore(original, { widthNotes: 13, heightBeats: 4 });
  assert.deepEqual(resized.analysis.notes.map(note => [note.note, note.beat, note.duration, note.velocity]), [[40, 0, .5, 60], [46, .5, .25, 90], [52, 1.5, .5, 110]]);
  assert.equal(resized.analysis.durationBeats, 4, 'trailing space scales with the loop');
  assert.deepEqual(resized.analysis.notes, parseMidi(resized.buffer).notes, 'preview notes come from the exact emitted MIDI');
  assert.deepEqual(original.buffer, before);
  assert.deepEqual(original.analysis.notes.map(note => note.note), [40, 52, 64]);
  assert.equal(resizeDropScore(original, { widthNotes: null, heightBeats: null }), original);
});

test('width reaches both keyboard edges and positions the whole resized block inside them', () => {
  const score = artScore(), resized = resizeDropScore(score, { widthNotes: 128 });
  assert.deepEqual(resized.analysis.notes.map(note => note.note), [0, 64, 127]);
  assert.equal(constrainDropPosition(resized.analysis.notes, { transpose: 100 }).transpose, 0);
  const narrow = resizeDropScore(score, { widthNotes: 1, heightBeats: .25 });
  assert.equal(narrow.analysis.noteCount, score.analysis.noteCount);
  assert.ok(narrow.analysis.notes.every(note => note.note === 40));
  assert.equal(narrow.analysis.durationBeats, .25);
  assert.equal(constrainDropPosition(narrow.analysis.notes, { transpose: 100 }).transpose, 87);
});

test('resize limits and one-pitch geometry remain finite without inventing notes', () => {
  const score = artScore();
  assert.equal(dropScoreDimensions(score, { widthNotes: 999, heightBeats: 9999 }).width, 128);
  assert.equal(dropScoreDimensions(score, { widthNotes: 999, heightBeats: 9999 }).heightBeats, 512);
  assert.equal(dropScoreDimensions(score, { widthNotes: NaN, heightBeats: Infinity }).width, 25);
  assert.equal(dropScoreDimensions(score, { heightBeats: Infinity }).heightBeats, 8);
  const line = encodeArtwork([{ note: 60, beat: 0, duration: 1, velocity: 100 }]);
  assert.equal(dropScoreDimensions(line, { widthNotes: 128 }).width, 1);
  assert.equal(resizeDropScore(line, { widthNotes: 128 }), line);
});

// Deliberately includes events that a notes-only artwork re-encoder would lose.
function expressiveScore() {
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
  const events = [[0, 255, 3, 4, 84, 101, 115, 116], [0, 255, 81, 3, 7, 161, 32], [0, 255, 88, 4, 7, 3, 24, 8],
    [0, 255, 33, 1, 2], [0, 194, 48], [0, 178, 64, 127], [0, 146, 40, 60], [240, 240, 3, 1, 2, 247],
    [480, 162, 40, 77], [480, 226, 10, 65], [960, 130, 40, 21], [1920, 146, 64, 110], [2880, 130, 64, 0],
    [3840, 178, 64, 0], [7680, 255, 47, 0]];
  const data = []; let previous = 0;
  for (const [tick, ...bytes] of events) { data.push(...vlq(tick - previous), ...bytes); previous = tick; }
  const bytes = new Uint8Array(22 + data.length); bytes.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 3, 192, 77, 84, 114, 107]);
  new DataView(bytes.buffer).setUint32(18, data.length); bytes.set(data, 22);
  return { buffer: bytes.buffer, analysis: parseMidi(bytes.buffer) };
}

test('resizing retains channels, instruments, controller values, SysEx and metadata while scaling their time', () => {
  const original = expressiveScore(), resized = resizeDropScore(original, { widthNotes: 49, heightBeats: 16 });
  assert.equal(resized.analysis.noteCount, original.analysis.noteCount);
  assert.equal(resized.analysis.channels[0].channel, 34);
  assert.equal(resized.analysis.channels[0].program, 48);
  assert.equal(resized.analysis.tracks[0].name, 'Test');
  assert.deepEqual(resized.analysis.meterMap, original.analysis.meterMap);
  assert.deepEqual(resized.analysis.tempoMap, original.analysis.tempoMap);
  const controls = analysis => analysis.events.filter(event => [11, 12, 14].includes(event.kind)).map(({ beat, channel, kind, a, b }) => ({ beat, channel, kind, a, b }));
  assert.deepEqual(controls(resized.analysis), controls(original.analysis).map(event => ({ ...event, beat: event.beat * 2 })));
  const pressure = resized.analysis.events.find(event => event.kind === 10);
  assert.deepEqual([pressure.a, pressure.b, pressure.beat], [40, 77, 1]);
  assert.ok(Buffer.from(resized.buffer).includes(Buffer.from([240, 3, 1, 2, 247])));
  assert.equal(resized.analysis.events.find(event => event.kind === 8).b, 21);
});

test('a dense resized block retains every source attack beyond the preview budget', () => {
  const count = 16384;
  const score = encodeArtwork(Array.from({ length: count }, (_, i) => ({ note: i % 128, beat: Math.floor(i / 128) / 8, duration: 1 / 16, velocity: 1 + i % 127 })), { durationBeats: 16 });
  const resized = resizeDropScore(score, { widthNotes: 12, heightBeats: 4 });
  assert.equal(resized.analysis.noteCount, count);
  assert.equal(resized.analysis.events.filter(event => event.kind === 9).length, count);
  assert.equal(resized.analysis.durationBeats, 4);
  assert.ok(resized.analysis.notes.every(note => note.note >= 0 && note.note < 12));
});


test('low-resolution MIDI still resizes to an exact quarter-beat loop boundary', () => {
  const score = expressiveScore();
  new DataView(score.buffer).setUint16(12, 1);
  score.analysis = parseMidi(score.buffer);
  const resized = resizeDropScore(score, { heightBeats: .25 });
  assert.equal(resized.analysis.durationBeats, .25);
  assert.equal(resized.analysis.noteCount, score.analysis.noteCount);
  assert.ok(resized.analysis.notes.every(note => note.duration > 0));
});
