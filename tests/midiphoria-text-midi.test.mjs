import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTextMidi, normalizeTextMidi, MAX_TEXT_MIDI_GLYPHS }
  from '../src/instruments/midiphoria/midiphoria-text-midi.js';

// Independent SMF reader for the exported file, including event matching and
// absolute tempo conversion. Browser coverage also loads it in SpessaSynth.
function readScore(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  assert.equal(ascii(0, 4), 'MThd');
  assert.equal(view.getUint32(4), 6);
  assert.equal(view.getUint16(8), 0);
  assert.equal(view.getUint16(10), 1);
  const division = view.getUint16(12);
  assert.ok(division > 0 && division < 0x8000);
  assert.equal(ascii(14, 4), 'MTrk');
  assert.equal(view.getUint32(18), bytes.length - 22);
  let offset = 22, tick = 0, endTick, tempo = 500000, program, title, lastStatus;
  const active = new Map(), notes = [], events = [], controllers = [];
  let maxPolyphony = 0;
  function byte() { assert.ok(offset < bytes.length, 'event fits track'); return bytes[offset++]; }
  function variableLength() {
    let result = 0;
    for (let length = 0; length < 4; length++) {
      const value = byte(); result = result * 128 + (value & 127);
      if (value < 128) return result;
    }
    assert.fail('MIDI variable-length value exceeds four bytes');
  }
  while (offset < bytes.length) {
    tick += variableLength();
    let status = byte();
    if (status < 128) { offset--; assert.ok(lastStatus); status = lastStatus; }
    if (status === 0xff) {
      lastStatus = undefined;
      const kind = byte(), length = variableLength(), data = bytes.slice(offset, offset + length);
      assert.equal(data.length, length); offset += length;
      if (kind === 0x51) {
        assert.equal(length, 3); assert.equal(tick, 0);
        tempo = data[0] * 65536 + data[1] * 256 + data[2];
      } else if (kind === 0x03) title = String.fromCharCode(...data);
      else if (kind === 0x2f) {
        assert.equal(length, 0); assert.equal(offset, bytes.length); endTick = tick;
      }
      continue;
    }
    lastStatus = status;
    const kind = status & 0xf0, channel = status & 15;
    assert.equal(channel, 0);
    const a = byte(); assert.ok(a < 128);
    if (kind === 0xc0) { program = a; continue; }
    const b = byte(); assert.ok(b < 128);
    if (kind === 0xb0) {
      assert.equal(a, 123); assert.equal(b, 0);
      assert.equal(active.size, 0, 'final all-notes-off occurs after every matching note release');
      controllers.push({ tick, controller: a, value: b });
      continue;
    }
    assert.ok(kind === 0x80 || kind === 0x90);
    const on = kind === 0x90 && b > 0;
    events.push({ tick, note: a, on });
    if (on) {
      assert.ok(!active.has(a), 'no overlapping attacks on one pitch');
      active.set(a, { tick, velocity: b });
      maxPolyphony = Math.max(maxPolyphony, active.size);
    } else {
      const start = active.get(a); assert.ok(start, 'each release matches an attack');
      assert.ok(tick > start.tick, 'notes have positive duration');
      const secondsPerTick = tempo / 1000000 / division;
      notes.push({ note: a, start: start.tick * secondsPerTick,
        duration: (tick - start.tick) * secondsPerTick, velocity: start.velocity });
      active.delete(a);
    }
  }
  assert.equal(active.size, 0, 'all notes release');
  assert.ok(Number.isFinite(endTick));
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  return { notes, events, controllers, maxPolyphony, program, tempo, title,
    duration: endTick * tempo / 1000000 / division };
}

function rasterize(score) {
  const pixels = Array.from({ length: 7 }, () => Array(score.columns).fill('0'));
  for (const note of score.notes) {
    const from = Math.round(note.start / score.secondsPerColumn);
    const width = Math.round(note.duration / score.secondsPerColumn);
    for (let column = from; column < from + width; column++) pixels[score.highestNote - note.note][column] = '1';
  }
  return pixels.map(row => row.join(''));
}

test('exported MIDI notes spell the same H I shape as the preview, with high pitches on top', () => {
  const score = generateTextMidi('hi');
  assert.equal(score.text, 'HI');
  assert.deepEqual(rasterize(score), [
    '100010111110',
    '100010001000',
    '100010001000',
    '111110001000',
    '100010001000',
    '100010001000',
    '100010111110',
  ]);
  const parsed = readScore(score.buffer);
  assert.deepEqual(parsed.notes, score.notes);
  assert.equal(parsed.duration, score.duration);
  assert.equal(parsed.tempo, 500000);
  assert.equal(parsed.program, 81);
  assert.equal(parsed.title, 'Text: HI');
  assert.equal(score.secondsPerColumn, 0.0625);
  assert.equal(score.lowestNote, 60);
  assert.equal(score.highestNote, 66);
});

test('horizontal pixels sustain notes and every glyph retains its final blank column', () => {
  const score = generateTextMidi('I I');
  const parsed = readScore(score.buffer);
  assert.equal(score.notes.length, 14, 'two I glyphs have seven sustained row runs each');
  assert.equal(score.columns, 18);
  assert.equal(score.duration, 1.125);
  assert.ok(score.notes.some(note => note.note === 66 && note.start === 0 && note.duration === 0.3125));
  const lastNoteEnd = Math.max(...score.notes.map(note => note.start + note.duration));
  assert.equal(score.duration - lastNoteEnd, score.secondsPerColumn);
  for (const note of parsed.notes) {
    assert.ok(note.start + note.duration <= 0.3125 || note.start >= 0.75,
      'inter-letter space does not secretly schedule notes');
  }
  assert.deepEqual(parsed.notes, score.notes);
});

test('a silent final channel event preserves the exact score duration in SpessaSynth loops', () => {
  for (const text of ['HELLO MIDI', 'I', '"']) {
    const score = generateTextMidi(text), parsed = readScore(score.buffer);
    assert.deepEqual(parsed.controllers, [{ tick: score.columns * 60, controller: 123, value: 0 }]);
    const lastNoteOffTick = Math.max(...parsed.events.filter(event => !event.on).map(event => event.tick));
    const lastChannelTick = parsed.controllers[0].tick;
    assert.ok(lastChannelTick - lastNoteOffTick >= 60, 'at least one blank column remains before loop restart');
    assert.equal(lastChannelTick * 0.5 / 480, score.duration);
    assert.equal(parsed.duration, score.duration);
  }
});

test('case, accents, compatibility characters and punctuation normalize deterministically', () => {
  assert.equal(normalizeTextMidi('  Héllo\tｗｏｒｌｄ… 123 — “yes”! '), 'HELLO WORLD... 123 - "YES"!');
  assert.equal(normalizeTextMidi('straße'), 'STRASSE');
  assert.equal(normalizeTextMidi('AB🙂☃️CD'), 'AB CD');
  assert.equal(normalizeTextMidi('A\u0000\u0001B'), 'A B');
  assert.equal(normalizeTextMidi('a\n\n b'), 'A B');
  const plain = generateTextMidi('CAFE!');
  const normalized = generateTextMidi('café!');
  assert.deepEqual(normalized, plain);
  assert.deepEqual(generateTextMidi('CAFE!').buffer, plain.buffer);
});

test('empty, unsupported-only and non-string input cannot create a silent or coerced song', () => {
  for (const input of ['', ' \n\t ', '🙂☃️', null, undefined, 123, {}, { toString() { throw new Error('must not call'); } }]) {
    assert.equal(normalizeTextMidi(input), '');
    assert.throws(() => generateTextMidi(input), /Type letters, numbers or punctuation/);
  }
});

test('large and hostile inputs stay inside the text, duration, event and file budgets', () => {
  for (const text of [
    'W'.repeat(1000000),
    '#'.repeat(1000000),
    '🙂'.repeat(10000) + 'A',
    'A' + '\u0301'.repeat(1000000),
    '<script>alert("HI")</script>'.repeat(1000),
    'A B C D E F G H I J K L M N O P Q R S T',
  ]) {
    const normalized = normalizeTextMidi(text);
    assert.ok(normalized.length <= MAX_TEXT_MIDI_GLYPHS);
    if (!normalized) { assert.throws(() => generateTextMidi(text)); continue; }
    const score = generateTextMidi(text), parsed = readScore(score.buffer);
    assert.ok(score.columns <= 192);
    assert.ok(score.duration <= 12);
    assert.ok(score.notes.length <= 672);
    assert.ok(parsed.events.length <= 1344);
    assert.ok(parsed.maxPolyphony <= 7);
    assert.ok(score.buffer.byteLength < 6000);
    assert.deepEqual(parsed.notes, score.notes);
    assert.equal(parsed.duration, score.duration);
  }
});

test('all supported lettering produces finite, distinct, exactly aligned MIDI shapes', () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?:;-_+=/\\()[]<>\'"#*@%&';
  const shapes = new Set();
  for (const character of characters) {
    const score = generateTextMidi(character), parsed = readScore(score.buffer);
    assert.equal(score.text, character);
    assert.equal(score.columns, 6);
    assert.ok(score.notes.length > 0);
    assert.deepEqual(parsed.notes, score.notes);
    assert.ok(parsed.maxPolyphony <= 7);
    for (const note of score.notes) {
      assert.ok(Number.isInteger(note.note) && note.note >= 60 && note.note <= 66);
      assert.ok(Number.isFinite(note.start) && note.start >= 0);
      assert.ok(Number.isFinite(note.duration) && note.duration > 0);
      assert.equal(note.start / score.secondsPerColumn % 1, 0);
      assert.equal(note.duration / score.secondsPerColumn % 1, 0);
      assert.ok(note.velocity > 0 && note.velocity <= 127);
    }
    shapes.add(rasterize(score).join('/'));
  }
  assert.equal(shapes.size, characters.length, 'letter, number and punctuation shapes remain distinguishable');
});
