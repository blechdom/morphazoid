import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLaidOutTextMidi, generateTextMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function decodedPixels(score) {
  const analysis = parseMidi(score.buffer), rows = Array.from({ length: score.rows }, () => Array(score.columns).fill(0));
  const beatsPerRow = score.layout.beats / score.rows;
  for (const note of analysis.notes) {
    const start = Math.round(note.beat / beatsPerRow), length = Math.round(note.duration / beatsPerRow);
    for (let row = start; row < start + length; row++) rows[score.rows - 1 - row][note.note - score.lowestNote] = 1;
  }
  assert.ok(Math.abs(analysis.durationBeats - score.layout.beats) < 1e-10, 'the encoded loop ends at the requested beat');
  return rows;
}
const linePixels = (score, index) => decodedPixels(score)
  .slice(score.rows - (index + 1) * 8 + 1, score.rows - index * 8).map(row => row.join(''));
const noteBounds = score => [Math.min(...score.notes.map(note => note.note)), Math.max(...score.notes.map(note => note.note))];

test('manual newlines and blank lines survive as chronological upright sounding glyphs', () => {
  const score = generateLaidOutTextMidi('F\n\nJ\n', { span: 5, lowestNote: 40, beats: 4, fit: false, align: 'left' });
  assert.equal(score.text, 'F\n\nJ\n'); assert.equal(score.rows, 32);
  assert.deepEqual(score.lines, [
    { text: 'F', breakReason: 'explicit', sourceLine: 0 },
    { text: '', breakReason: 'explicit', sourceLine: 1 },
    { text: 'J', breakReason: 'explicit', sourceLine: 2 },
    { text: '', breakReason: 'end', sourceLine: 3 },
  ]);
  assert.deepEqual(linePixels(score, 0), ['11111', '10000', '10000', '11110', '10000', '10000', '10000']);
  assert.deepEqual(linePixels(score, 2), ['00111', '00010', '00010', '00010', '10010', '10010', '01100']);
  for (const index of [1, 3]) assert.ok(linePixels(score, index).every(row => /^0+$/.test(row)));
  assert.deepEqual(decodedPixels(score), score.pixels);
  const parsed = parseMidi(score.buffer);
  assert.ok(parsed.notes.every(note => note.beat < 1 || note.beat >= 2 && note.beat < 3), 'blank lines never acquire attacks');
  assert.ok(parsed.notes.filter(note => note.beat < 1).every(note => note.beat + note.duration <= .875));
});

test('word wrapping prefers complete words and only splits words wider than the pitch window', () => {
  const words = generateLaidOutTextMidi('HI ALL YOU\nYES', { span: 35 });
  assert.deepEqual(words.lines.map(line => [line.text, line.breakReason]), [
    ['HI ALL', 'wrap'], ['YOU', 'explicit'], ['YES', 'end'],
  ]);
  assert.equal(words.layout.capacity, 6);
  const long = generateLaidOutTextMidi('AB ABCDEFGH IJ', { span: 23 });
  assert.deepEqual(long.lines.map(line => [line.text, line.breakReason]), [
    ['AB', 'wrap'], ['ABCD', 'hard-wrap'], ['EFGH', 'wrap'], ['IJ', 'end'],
  ]);
  assert.deepEqual(decodedPixels(words), words.pixels);
  assert.deepEqual(decodedPixels(long), long.pixels);
});

test('letter sequence preserves explicit breaks and spaces without changing reading order', () => {
  const score = generateLaidOutTextMidi('F R\n\nJ', { mode: 'letter', span: 5, fit: false, align: 'left' });
  assert.deepEqual(score.lines.map(line => line.text), ['F', '', 'R', '', 'J']);
  assert.deepEqual(score.lines.map(line => line.breakReason), ['letter', 'letter', 'explicit', 'explicit', 'end']);
  for (const [index, glyph] of [[0, 'F'], [2, 'R'], [4, 'J']]) {
    const single = generateLaidOutTextMidi(glyph, { span: 5, fit: false, align: 'left' });
    assert.deepEqual(linePixels(score, index), linePixels(single, 0));
  }
  assert.deepEqual(decodedPixels(score), score.pixels);
});

test('automatic fitting uses one letter size across short and long lines', () => {
  const score = generateLaidOutTextMidi('LL\nL', { span: 22, fit: true, align: 'left' });
  assert.equal(score.layout.glyphWidth, 10);
  assert.deepEqual(noteBounds(score), [40, 61]);
  const first = linePixels(score, 0), second = linePixels(score, 1);
  assert.deepEqual(first.map(row => row.slice(0, 10)), second.map(row => row.slice(0, 10)));
  assert.ok(second.every(row => /^0+$/.test(row.slice(10))), 'one short line is not enlarged to the full window');
  assert.equal(second.at(-1), '1111111111000000000000');
  assert.deepEqual(decodedPixels(score), score.pixels);
  const fractional = generateLaidOutTextMidi('LL\nL', { span: 48, fit: true, align: 'left' });
  const longer = linePixels(fractional, 0), shorter = linePixels(fractional, 1);
  assert.deepEqual(longer.map(row => row.slice(0, 22)), shorter.map(row => row.slice(0, 22)),
    'fractional fitting does not give a short line a different pixel scale');
});

test('fixed letter scale changes glyph width and wrapping while alignment moves the complete word', () => {
  const small = generateLaidOutTextMidi('AB CD', { span: 48, scale: 1, fit: false });
  const large = generateLaidOutTextMidi('AB CD', { span: 48, scale: 2, fit: false });
  assert.deepEqual(small.lines.map(line => line.text), ['AB CD']);
  assert.deepEqual(large.lines.map(line => line.text), ['AB', 'CD']);
  assert.equal(large.layout.glyphWidth, 10); assert.equal(large.layout.capacity, 4);
  const aligned = ['left', 'center', 'right'].map(align => generateLaidOutTextMidi('L', { span: 20, scale: 2, fit: false, align }));
  assert.deepEqual(aligned.map(noteBounds), [[40, 49], [45, 54], [50, 59]]);
  assert.deepEqual(aligned[1].notes, aligned[0].notes.map(note => ({ ...note, note: note.note + 5 })));
  assert.deepEqual(aligned[2].notes, aligned[0].notes.map(note => ({ ...note, note: note.note + 10 })));
  for (const score of [small, large, ...aligned]) assert.deepEqual(decodedPixels(score), score.pixels);
});

test('narrow windows report a smaller actual scale and full keyboard windows clamp position', () => {
  const narrow = generateLaidOutTextMidi('AB', { span: 12, scale: 4, fit: false, lowestNote: 120 });
  assert.equal(narrow.layout.scale, 2); assert.equal(narrow.layout.glyphWidth, 10);
  assert.equal(narrow.layout.lowestNote, 116); assert.equal(narrow.layout.capacity, 1);
  assert.deepEqual(narrow.lines.map(line => line.text), ['A', 'B']);
  const full = generateLaidOutTextMidi('L', { span: 128, lowestNote: 1000 });
  assert.equal(full.layout.lowestNote, 0); assert.deepEqual(noteBounds(full), [0, 127]);
  assert.deepEqual(decodedPixels(full), full.pixels);
});

test('every legal line count has an exact quarter-beat MIDI duration without cumulative row drift', () => {
  for (let lineCount = 1; lineCount <= 32; lineCount++) for (const beats of [.25, 2.75, 8, 63.75, 64]) {
    const score = generateLaidOutTextMidi('L'.repeat(lineCount), { mode: 'letter', span: 5, beats });
    assert.equal(score.lines.length, lineCount);
    assert.ok(score.ticksPerBeat >= 480 && score.ticksPerBeat <= 15360);
    const parsed = parseMidi(score.buffer);
    assert.ok(Math.abs(parsed.durationBeats - beats) < 1e-10);
    assert.ok(Math.abs(score.duration * 2 - beats) < 1e-10);
    const noteRows = parsed.notes.map(note => note.beat * score.rows / beats);
    assert.ok(noteRows.every(row => Math.abs(row - Math.round(row)) < 1e-9));
    assert.deepEqual(decodedPixels(score), score.pixels);
  }
});

test('normalization retains manual breaks, supported emoji and visible unsupported feedback', () => {
  const score = generateLaidOutTextMidi('  Héllo\r\n\tｗｏｒｌｄ 🦄 ❤️  ');
  assert.equal(score.text, 'HELLO\nWORLD ❤');
  assert.deepEqual(score.unsupported, ['🦄']); assert.equal(score.truncated, false);
  assert.deepEqual(score.lines.map(line => line.text), ['HELLO', 'WORLD ❤']);
  assert.deepEqual(decodedPixels(score), score.pixels);
  assert.deepEqual(generateLaidOutTextMidi('café').buffer, generateLaidOutTextMidi('CAFE').buffer);
});

test('oversized input stays bounded and tells the caller which text was retained', () => {
  const score = generateLaidOutTextMidi('⭐'.repeat(100000), { mode: 'letter', span: 128, beats: .25 });
  assert.equal([...score.text].length, 32); assert.equal(score.lines.length, 32);
  assert.equal(score.rows, 256); assert.equal(score.columns, 128); assert.equal(score.truncated, true);
  assert.ok(score.notes.length <= 32768); assert.ok(score.buffer.byteLength <= 2 * 1024 * 1024);
  assert.ok(score.notes.every(note => note.note >= 0 && note.note <= 127 && note.duration > 0));
  assert.deepEqual(decodedPixels(score), score.pixels);
  const spaces = generateLaidOutTextMidi('A B C D E F G H I J K L M N O P Q R S T');
  assert.ok([...spaces.text].length <= 32); assert.equal(spaces.truncated, true);
  const lines = generateLaidOutTextMidi('A' + '\n'.repeat(100));
  assert.equal(lines.lines.length, 32); assert.equal(lines.truncated, true);
});

test('empty or unsupported-only drafts cannot create a playable layer', () => {
  for (const value of ['', ' \n\t ', '\n'.repeat(100), '🦄☃️', null, undefined, 42, {}]) {
    assert.throws(() => generateLaidOutTextMidi(value), /Type letters, numbers or punctuation/);
  }
});

test('layout settings are bounded copies and the legacy generator retains its original layout', () => {
  const settings = { span: 12, lowestNote: 40, scale: 4, fit: false, mode: 'word', beats: 2.75, align: 'right' };
  const score = generateLaidOutTextMidi('L', settings);
  assert.equal(settings.scale, 4); assert.equal(score.layout.scale, 2);
  settings.scale = 1; assert.equal(score.layout.scale, 2);
  const legacy = generateTextMidi('HI ALL YOU\nYES');
  assert.equal(legacy.text, 'HI ALL YOU YES');
  assert.deepEqual(legacy.phrases, ['HI ALL Y', 'OU YES']);
  const bounded = generateLaidOutTextMidi('L', { span: -1, lowestNote: Infinity, beats: Infinity, scale: NaN, mode: 'bogus', align: 'bogus' });
  assert.deepEqual(bounded.layout, { mode: 'word', span: 5, lowestNote: 40, beats: 8, fit: true,
    scale: 1, align: 'center', capacity: 1, lineCount: 1, glyphWidth: 5 });
});
