import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { mixerPerformanceScore, mixerStampScore, mixerMessageScore, nextMixerStampVariation, MIXER_SAMPLE_STAMPS } from '../src/instruments/midi-mixer/midi-mixer-performance-score.js';

function chronological(score) {
  const rows = Array.from({ length: score.rows }, () => Array(score.columns).fill(0));
  for (const note of parseMidi(score.buffer).notes) {
    const start = Math.round(note.beat / 2 / score.secondsPerRow), end = Math.round((note.beat + note.duration) / 2 / score.secondsPerRow);
    for (let row = start; row < end; row++) rows[row][note.note - score.lowestNote] = 1;
  }
  return rows;
}
function trim(rows) {
  const first = rows.findIndex(row => row.some(Boolean)), last = rows.findLastIndex(row => row.some(Boolean));
  return rows.slice(first, last + 1);
}

test('falling drawings retain upright geometry in exported MIDI while default trails remain unchanged', () => {
  const pixels = [[1, 1, 1], [1, 0, 0], [1, 1, 0], [1, 0, 0]], source = generateGridMidi(pixels);
  const original = source.buffer.slice(0);
  const rising = mixerPerformanceScore(source), falling = mixerPerformanceScore(source, { orientation: 'falling' });
  assert.deepEqual(chronological(rising), pixels);
  assert.deepEqual(chronological(falling).reverse(), pixels);
  assert.deepEqual(falling.pixels, pixels);
  assert.deepEqual(source.buffer, original);
  assert.deepEqual(mixerPerformanceScore(source, { orientation: 'rising' }).buffer, rising.buffer);
});

test('falling orientation is preserved after pitch, height, width and offset edits', () => {
  const pixels = [[1, 1, 1], [1, 0, 0], [1, 1, 0], [1, 0, 0]], source = generateGridMidi(pixels);
  const score = mixerPerformanceScore(source, { orientation: 'falling', span: 128, lowestNote: 127, heightBeats: 16, offset: -127 });
  assert.equal(score.columns, 128); assert.equal(score.lowestNote, 0); assert.equal(score.duration, 8);
  assert.deepEqual(chronological(score).reverse(), score.pixels);
  assert.equal(score.pixels[0].filter(Boolean).length, 128);
  assert.ok(score.pixels[3].filter(Boolean).length < 50);
});

test('all falling stamps keep their asymmetric pictures upright, with no leading silence', () => {
  for (const stamp of MIXER_SAMPLE_STAMPS) {
    const rising = mixerStampScore(stamp.id), falling = mixerStampScore(stamp.id, { orientation: 'falling' });
    assert.equal(falling.notes[0].start, 0, stamp.id);
    assert.deepEqual(trim(chronological(falling).reverse()), trim(chronological(rising)), stamp.id);
    assert.deepEqual(falling.pixels, chronological(falling).reverse(), stamp.id);
  }
});

test('falling message glyphs remain upright and sequential letters keep phrase order and rests', () => {
  const score = mixerMessageScore('FL', { mode: 'letter', orientation: 'falling' }), rows = chronological(score);
  assert.deepEqual(score.phrases, ['F', 'L']);
  assert.equal(rows[0].join(''), '10000'); assert.equal(rows[6].join(''), '11111');
  assert.equal(rows[7].join(''), '00000');
  assert.equal(rows[8].join(''), '11111'); assert.equal(rows[14].join(''), '10000');
  assert.equal(rows[15].join(''), '00000');
  assert.deepEqual(score.pixels, rows.toReversed());
});

test('variation returns a newly seeded falling score rather than reverting to trail orientation', () => {
  const options = { orientation: 'falling', seed: 55, density: .7 };
  const next = nextMixerStampVariation('noise', options);
  assert.ok(next);
  const expected = mixerStampScore('noise', { ...options, ...next.patternOptions });
  assert.deepEqual(next.buffer, expected.buffer);
  assert.deepEqual(next.pixels, chronological(next).reverse());
});


test('explicit text width, height and offset shape the exported score and its falling thumbnail', () => {
  const original = mixerMessageScore('FL', { mode: 'letter', orientation: 'falling' });
  const moved = mixerMessageScore('FL', { mode: 'letter', orientation: 'falling', span: 10, beats: 16, offset: 12 });
  assert.equal(original.columns, 5); assert.equal(moved.columns, 10);
  assert.equal(moved.duration, 8); assert.equal(moved.lowestNote, 60);
  assert.deepEqual(moved.phrases, ['F', 'L']);
  const rows = chronological(moved);
  assert.equal(rows[0].join(''), '1100000000'); assert.equal(rows[6].join(''), '1111111111');
  assert.equal(rows[7].join(''), '0000000000');
  assert.equal(rows[8].join(''), '1111111111'); assert.equal(rows[14].join(''), '1100000000');
  assert.deepEqual(moved.pixels, rows.toReversed());
  assert.ok(parseMidi(moved.buffer).notes.every(note => note.note >= 60 && note.note <= 69));
});

test('unspecified text geometry preserves legacy duration and width; each optional control is independent', () => {
  const text = 'HELLO', original = mixerMessageScore(text);
  assert.deepEqual(mixerMessageScore(text, { span: undefined, heightBeats: undefined, offset: undefined }).buffer, original.buffer);
  const taller = mixerMessageScore(text, { heightBeats: 12 });
  assert.equal(taller.columns, original.columns); assert.equal(taller.lowestNote, original.lowestNote);
  assert.equal(taller.duration, 6); assert.deepEqual(taller.pixels, original.pixels);
  const offset = mixerMessageScore(text, { offset: -24 });
  assert.equal(offset.columns, original.columns); assert.equal(offset.duration, original.duration);
  assert.equal(offset.lowestNote, original.lowestNote - 24); assert.deepEqual(offset.pixels, original.pixels);
  const width = mixerMessageScore(text, { span: 128, offset: 127 });
  assert.equal(width.columns, 128); assert.equal(width.lowestNote, 0); assert.equal(width.duration, original.duration);
  assert.equal(mixerMessageScore(text, { beats: 12, heightBeats: 4 }).duration, 2, 'explicit height uses the score adapter units');
});
