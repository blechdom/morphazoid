import assert from 'node:assert/strict';
import test from 'node:test';
import { FREE_TEXT_FONTS, layoutFreeTextGlyphs, prepareFreeTextMidi } from '../src/instruments/blech-midi-ultra/blech-midi-text-controls.js';
import { digitalNoteGlyph, generateUltraTextMidi, ULTRA_TEXT_FONTS, ultraNoteGlyph } from '../src/instruments/blech-midi-ultra/blech-midi-text-fonts.js';
import { workboxStampNotes } from '../src/instruments/blech-midi-ultra/blech-midi-drop-stage.js';
import { generateLaidOutTextMidi, TEXT_MIDI_FONTS } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

const pitches = score => parseMidi(score.buffer).notes.map(note => note.note);
const playedPixels = score => {
  const pixels = Array.from({ length: score.rows }, () => Array(score.columns).fill(0));
  const beatsPerRow = score.secondsPerRow * 2;
  for (const note of parseMidi(score.buffer).notes) {
    const from = Math.round(note.beat / beatsPerRow), until = Math.round((note.beat + note.duration) / beatsPerRow);
    for (let row = from; row < until; row++) pixels[score.rows - 1 - row][note.note - score.lowestNote] = 1;
  }
  return pixels;
};

test('digital note glyphs are distinct and remain full strokes at one pitch per cell', () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  assert.equal(new Set([...characters].map(character => digitalNoteGlyph(character)?.join(''))).size, characters.length);
  for (const character of characters) {
    const glyph = digitalNoteGlyph(character);
    assert.equal(glyph?.length, 7, character);
    assert.ok(glyph.every(row => /^[01]{7}$/.test(row)), character);
  }
  const score = generateUltraTextMidi('BLECH', { font: 'digital', fit: false, span: 48, lowestNote: 40, beats: 2, align: 'left' });
  assert.deepEqual(score.lines.map(line => line.text), ['BLECH']);
  assert.equal(score.layout.glyphWidth, 7);
  assert.equal(score.rows, 8);
  [...score.text].forEach((character, index) => {
    for (let row = 0; row < 7; row++)
      assert.equal(score.pixels[row + 1].slice(index * 8, index * 8 + 7).join(''),
        digitalNoteGlyph(character)[row], `${character} row ${row} must not lose a one-note-wide stroke`);
  });
  assert.deepEqual(playedPixels(score), score.pixels, 'the dropped MIDI and visible cells are the same lettering');
});

test('all workbox font choices fit whole pixels, keep separate glyphs and play exactly their previews', () => {
  assert.deepEqual(ULTRA_TEXT_FONTS.map(face => face.id), ['digital', 'pixel', 'square', 'chunky']);
  for (const { id } of ULTRA_TEXT_FONTS) {
    const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
    const columns = ultraNoteGlyph('A', id)[0].length, cellRow = new RegExp(`^[01]{${columns}}$`);
    const stencils = alphabet.map(character => {
      const rows = ultraNoteGlyph(character, id);
      assert.equal(rows.length, 7, `${id}: ${character} keeps seven time rows`);
      assert.ok(rows.every(row => cellRow.test(row)), `${id}: ${character} uses only whole note cells`);
      return rows.join('');
    });
    assert.equal(new Set(stencils).size, alphabet.length, `${id}: letters and digits must remain distinct`);
    const score = generateUltraTextMidi('BLECH', { font: id, span: 48, lowestNote: 40, beats: 2, fit: true });
    assert.equal(score.layout.font, id);
    assert.ok(Number.isInteger(score.layout.scale) && score.layout.scale >= 1 && score.layout.scale <= 4, id);
    assert.ok(score.rows <= 256 && score.columns <= 128 && score.notes.length <= 4096, id);
    assert.equal(parseMidi(score.buffer).durationBeats, 2, id);
    assert.deepEqual(playedPixels(score), score.pixels, id);
    assert.ok(pitches(score).every(note => note >= 40 && note < 88), id);
    const stamp = workboxStampNotes({ ...score, analysis: parseMidi(score.buffer) },
      { low: 40, width: 48, heightBeats: 4 }, { pitch: 64, beat: 0 });
    assert.equal(stamp.length, score.notes.length, `${id} should survive placement in the workbox`);
    assert.ok(stamp.every(note => note.note >= 40 && note.note < 88 && note.beat >= 0 && note.beat < 4), id);
    const natural = generateUltraTextMidi('BLECH', { font: id, span: 48, lowestNote: 40,
      beats: 2, fit: false, scale: 1, align: 'left' });
    [...natural.text].forEach((letter, index) => {
      const stencil = ultraNoteGlyph(letter, id), start = index * (stencil[0].length + 1);
      for (let row = 0; row < 7; row++)
        assert.equal(natural.pixels[row + 1].slice(start, start + stencil[0].length).join(''),
          stencil[row], `${id}: ${letter} retains its complete square stroke on the note grid`);
    });
  }
  const block = generateUltraTextMidi('MIDI', { font: 'pixel', span: 48, lowestNote: 40, beats: 2 });
  assert.equal(block.layout.scale, 2, 'short words use whole-pitch enlargement, not fractional downsampling');
  const natural = generateUltraTextMidi('MIDI', { font: 'pixel', span: 48, lowestNote: 40, beats: 2, fit: false });
  for (let row = 0; row < 7; row++) {
    const source = natural.pixels[row + 1].slice(12, 35);
    const enlarged = block.pixels[row + 1].slice(1, 47);
    assert.deepEqual(enlarged, source.flatMap(pixel => [pixel, pixel]), `whole pixels at row ${row}`);
  }
  assert.equal(generateUltraTextMidi('BLECH').layout.font, 'digital');
  assert.equal(generateUltraTextMidi('BLECH', { font: 'block' }).layout.font, 'pixel',
    'older workbox selections open in their closest readable face');
  assert.throws(() => generateUltraTextMidi('🦄'), /Type letters/);
});

test('Free Text starts in digital mode and its B/I choices alter the actual MIDI stencil', () => {
  assert.equal(FREE_TEXT_FONTS[0].id, 'digital');
  assert.deepEqual(FREE_TEXT_FONTS.map(font => font.id), ULTRA_TEXT_FONTS.map(font => font.id));
  const options = { font: 'digital', pitch: 60, rasterCanvas: {} };
  const plain = prepareFreeTextMidi('BLECH', options);
  assert.equal(plain.textSettings.font, 'digital');
  assert.deepEqual(playedPixels(plain).slice(1, 8).map(row => row.slice(0, 7).join('')), digitalNoteGlyph('B'));
  const distinct = new Set();
  for (const { id } of FREE_TEXT_FONTS) {
    const score = prepareFreeTextMidi('BLECH', { ...options, font: id });
    const stencil = ultraNoteGlyph('B', id);
    assert.deepEqual(playedPixels(score).slice(1, 8).map(row => row.slice(0, stencil[0].length).join('')),
      stencil, `${id} is designed for note resolution instead of downsampled`);
    distinct.add(stencil.join(''));
  }
  assert.equal(distinct.size, FREE_TEXT_FONTS.length);
  const bold = prepareFreeTextMidi('BLECH', { ...options, bold: true });
  const italic = prepareFreeTextMidi('BLECH', { ...options, italic: true });
  assert.ok(bold.notes.length !== plain.notes.length || bold.columns !== plain.columns);
  assert.ok(italic.columns > plain.columns);
  assert.notDeepEqual(playedPixels(bold), playedPixels(plain));
  assert.notDeepEqual(playedPixels(italic), playedPixels(plain));
});

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

test('inline vertical text rotates the whole phrase 90° without stacking upright glyphs', () => {
  assert.equal(FREE_TEXT_FONTS.length, 4);
  const glyphs = [
    { character: 'L', width: 3, rows: Array.from({ length: 7 }, (_, row) => row === 6 ? [1, 1, 1] : [1, 0, 0]) },
    { character: 'F', width: 3, rows: Array.from({ length: 7 }, (_, row) => row === 0 || row === 3 ? [1, 1, 1] : [1, 0, 0]) },
  ];
  const across = layoutFreeTextGlyphs(glyphs, { pitch: 60 });
  assert.deepEqual(across.lines, ['LF']);
  assert.equal(across.pixels.length, 8);
  assert.equal(across.columns, 7);
  const turned = layoutFreeTextGlyphs(glyphs, { pitch: 60, orientation: 'vertical' });
  assert.deepEqual(turned.lines, ['LF'], 'the letters remain one word');
  assert.equal(turned.pixels.length, across.columns);
  assert.equal(turned.columns, across.pixels.length);
  assert.deepEqual(turned.pixels, Array.from({ length: across.columns }, (_, row) =>
    Array.from({ length: across.pixels.length }, (_, column) =>
      across.pixels[column][across.columns - 1 - row])), 'every letter turns counterclockwise; first typed letter is at the bottom');
  const atEdge = layoutFreeTextGlyphs(glyphs, { pitch: 127, size: 4 });
  assert.equal(atEdge.lowestNote, 116);
  assert.deepEqual(atEdge.lines, ['L', 'F']);
  assert.ok(atEdge.pixels.every(row => row.length <= 128));
  const turnedEdge = layoutFreeTextGlyphs(glyphs, { pitch: 127, size: 4, orientation: 'vertical' });
  assert.equal(turnedEdge.lowestNote, 96);
  assert.deepEqual(turnedEdge.lines, ['LF']);
  assert.equal(turnedEdge.pixels.length, 28);
  assert.equal(turnedEdge.columns, 32);
  const acrossLarge = layoutFreeTextGlyphs(glyphs, { pitch: 60, size: 3 });
  const turnedLarge = layoutFreeTextGlyphs(glyphs, { pitch: 60, size: 3, orientation: 'vertical' });
  assert.equal(turnedLarge.columns, acrossLarge.pixels.length * 3);
  assert.equal(turnedLarge.pixels.length, acrossLarge.columns);
  assert.deepEqual(turnedLarge.pixels, Array.from({ length: acrossLarge.columns }, (_, row) =>
    acrossLarge.pixels.flatMap(line => Array(3).fill(line[acrossLarge.columns - 1 - row]))),
  'a turned cell stays three notes wide and three time rows tall at 3×');
  const uprightScore = prepareFreeTextMidi('BLECH', { font: 'digital', size: 3 });
  const rotatedScore = prepareFreeTextMidi('BLECH', { font: 'digital', size: 3, orientation: 'vertical' });
  assert.equal(uprightScore.layout.beats / uprightScore.rows, .75);
  assert.equal(rotatedScore.layout.beats / rotatedScore.rows, .25);
  assert.deepEqual(playedPixels(rotatedScore).length, rotatedScore.rows);
  const full = layoutFreeTextGlyphs(Array(32).fill(glyphs[0]), { pitch: 127, size: 4 });
  assert.ok(full.pixels.length <= 256 && full.columns <= 128);
  const fullTurned = layoutFreeTextGlyphs(Array(32).fill(glyphs[0]), { pitch: 127, size: 4, orientation: 'vertical' });
  assert.equal(fullTurned.lines.join(''), 'L'.repeat(32));
  assert.ok(fullTurned.pixels.length <= 256 && fullTurned.columns <= 128);
  assert.equal(fullTurned.lowestNote + fullTurned.columns, 128);
});

test('each rotated note-pixel keeps its pitch width and musical-time height, even in large wrapped words', () => {
  const message = 'BLECH MIDI ULTRA BLECH MIDI';
  for (const { id: font } of FREE_TEXT_FONTS) for (const size of [1, 3, 4]) {
    const score = prepareFreeTextMidi(message, { font, pitch: 127, size, orientation: 'vertical' });
    const { scale, lowestNote } = score.layout;
    assert.equal(score.lines.map(line => line.text).join(''), message, `${font}: keep every letter after wrapping`);
    if (size > 1) assert.ok(score.lines.length > 1, `${font}: the large word wraps at this pitch`);
    assert.ok(scale >= 1 && scale <= size, `${font}: fit without shrinking pixels to fractions`);
    const width = Math.max(...score.lines.map(line => [...line.text].reduce((sum, letter, index) =>
      sum + (index ? 1 : 0) + (letter === ' ' ? 4 : ultraNoteGlyph(letter, font)[0].length), 0) * scale));
    const source = Array.from({ length: score.lines.length * 8 }, () => Array(width).fill(0));
    score.lines.forEach((line, index) => {
      let at = 0;
      for (const [letterIndex, letter] of [...line.text].entries()) {
        if (letterIndex) at += scale;
        const glyph = letter === ' ' ? null : ultraNoteGlyph(letter, font);
        if (glyph) for (let timeRow = 0; timeRow < 7; timeRow++)
          for (let pitchCell = 0; pitchCell < glyph[timeRow].length; pitchCell++)
            if (glyph[timeRow][pitchCell] === '1')
              source[source.length - (index + 1) * 8 + 1 + timeRow]
                .fill(1, at + pitchCell * scale, at + (pitchCell + 1) * scale);
        at += (glyph?.[0]?.length ?? 4) * scale;
      }
    });
    const rotated = Array.from({ length: width }, (_, timeRow) =>
      source.flatMap(row => Array(scale).fill(row[width - timeRow - 1])));
    assert.equal(score.rows, width, `${font} ${size}×: a pitch cell becomes a time cell`);
    assert.equal(score.columns, source.length * scale, `${font} ${size}×: every time cell spans ${scale} pitches`);
    assert.ok(lowestNote >= 0 && lowestNote + score.columns <= 128);
    assert.equal(score.secondsPerRow * 2, .25, `${font} ${size}×: each rotated time row keeps one ¼ beat`);
    assert.deepEqual(playedPixels(score), rotated, `${font} ${size}×: MIDI preserves the entire rotated word`);
  }
});
