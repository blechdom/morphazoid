import assert from 'node:assert/strict';
import test from 'node:test';
import { FREE_TEXT_FONTS, layoutFreeTextGlyphs, prepareFreeTextMidi } from '../src/instruments/blech-midi-ultra/blech-midi-text-controls.js';
import { generateLaidOutTextMidi, TEXT_MIDI_FONTS } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

const pitches = score => parseMidi(score.buffer).notes.map(note => note.note);

test('free text starts on the selected pitch and beat, with the original block glyphs', () => {
  const score = prepareFreeTextMidi('HELLO', { pitch: 60, delayBeats: 2.37 });
  const authored = generateLaidOutTextMidi('HELLO', { span: 68, lowestNote: 60, scale: 1, fit: false, align: 'left', beats: 2 });
  assert.deepEqual(score.buffer, authored.buffer);
  assert.equal(score.delayBeats, 2.25);
  assert.deepEqual(score.textSettings, {
    message: 'HELLO', font: 'block', span: 68, lowestNote: 60, mode: 'word',
    fit: false, scale: 1, align: 'left', beats: 2,
  });
  assert.ok(pitches(score).every(note => note >= 60 && note <= 127));
  assert.equal(parseMidi(score.buffer).durationBeats, 2);
});

test('font and size change actual MIDI pitches and time, not only CSS', () => {
  assert.deepEqual(TEXT_MIDI_FONTS.map(font => font.id), ['block', 'slant', 'wide']);
  const block = prepareFreeTextMidi('L', { pitch: 48, font: 'block' });
  const slant = prepareFreeTextMidi('L', { pitch: 48, font: 'slant' });
  const wide = prepareFreeTextMidi('L', { pitch: 48, font: 'wide' });
  const large = prepareFreeTextMidi('L', { pitch: 48, font: 'block', size: 3 });
  assert.notDeepEqual(pitches(block), pitches(slant));
  assert.notDeepEqual(pitches(block), pitches(wide));
  assert.notDeepEqual(pitches(slant), pitches(wide));
  assert.equal(slant.layout.glyphWidth, 7);
  assert.equal(wide.layout.glyphWidth, 7);
  assert.equal(large.layout.glyphWidth, 15);
  assert.equal(parseMidi(block.buffer).durationBeats, 2);
  assert.equal(parseMidi(large.buffer).durationBeats, 6);
  assert.ok(Math.max(...pitches(large)) > Math.max(...pitches(block)));
  assert.equal(prepareFreeTextMidi('L', { font: 'unknown' }).textSettings.font, 'block');
});

test('near the right edge words wrap without clipping pitches or exceeding bounded MIDI duration', () => {
  const score = prepareFreeTextMidi('A B C D', { pitch: 127, delayBeats: 64, font: 'slant', size: 4 });
  assert.equal(score.layout.lowestNote, 100);
  assert.equal(score.lines.length, 4);
  assert.equal(score.layout.beats, 32);
  assert.ok(pitches(score).every(pitch => pitch >= 100 && pitch <= 127));
  assert.equal(parseMidi(score.buffer).durationBeats, score.layout.beats);
  const long = prepareFreeTextMidi('L'.repeat(32), { pitch: 127, font: 'wide', size: 4 });
  assert.ok(long.layout.lineCount <= 32);
  assert.equal(long.layout.beats, 64);
  assert.ok(pitches(long).every(pitch => pitch >= 0 && pitch <= 127));
  assert.ok(long.buffer.byteLength < 2 * 1024 * 1024);
});

test('blank or unsupported-only text never prepares a playable score', () => {
  for (const message of ['', ' ', '🦄']) assert.throws(() => prepareFreeTextMidi(message), /Type letters/);
});

test('inline font layout wraps at MIDI pitch 127 and stacks upright letters for vertical text', () => {
  assert.equal(FREE_TEXT_FONTS.length, 6);
  const glyphs = ['H', 'I'].map(character => ({ character, width: 3,
    rows: Array.from({ length: 7 }, (_, row) => row === 3 ? [1, 1, 1] : [1, 0, 1]) }));
  const across = layoutFreeTextGlyphs(glyphs, { pitch: 60 });
  assert.deepEqual(across.lines, ['HI']);
  assert.equal(across.pixels.length, 8);
  assert.equal(across.columns, 7);
  const down = layoutFreeTextGlyphs(glyphs, { pitch: 60, orientation: 'vertical' });
  assert.deepEqual(down.lines, ['H', 'I']);
  assert.equal(down.pixels.length, 16);
  assert.equal(down.columns, 3);
  assert.deepEqual(down.pixels.slice(1, 8), down.pixels.slice(9, 16), 'letters stay upright in both time windows');
  const atEdge = layoutFreeTextGlyphs(glyphs, { pitch: 127, size: 4 });
  assert.equal(atEdge.lowestNote, 116);
  assert.deepEqual(atEdge.lines, ['H', 'I']);
  assert.ok(atEdge.pixels.every(row => row.length <= 128));
  const full = layoutFreeTextGlyphs(Array(32).fill(glyphs[0]), { pitch: 127, size: 4 });
  assert.ok(full.pixels.length <= 256 && full.columns <= 128);
});
