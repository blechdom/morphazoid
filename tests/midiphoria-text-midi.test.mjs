import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTextMidi, generateGridMidi, normalizeTextMidi, MAX_TEXT_MIDI_GLYPHS }
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
      } else if (kind === 0x03) title = new TextDecoder().decode(data);
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

function rasterize(score, phrase = 0) {
  const pixels = Array.from({ length: 7 }, () => Array(score.columns).fill('0'));
  for (const note of score.notes) {
    const from = Math.round(note.start / score.secondsPerRow);
    const length = Math.round(note.duration / score.secondsPerRow);
    for (let row = from; row < from + length; row++) {
      if (Math.floor(row / score.rowsPerPhrase) !== phrase) continue;
      const glyphRow = 6 - row % score.rowsPerPhrase;
      assert.ok(glyphRow >= 0, 'blank time rows never acquire sounding pixels');
      pixels[glyphRow][note.note - score.lowestNote] = '1';
    }
  }
  return pixels.map(row => row.join(''));
}

test('exported MIDI spells upright H I left to right while time moves from bottom to top', () => {
  const score = generateTextMidi('hi');
  assert.equal(score.text, 'HI');
  assert.deepEqual(rasterize(score), [
    '10001011111',
    '10001000100',
    '10001000100',
    '11111000100',
    '10001000100',
    '10001000100',
    '10001011111',
  ]);
  const parsed = readScore(score.buffer);
  assert.deepEqual(parsed.notes, score.notes);
  assert.equal(parsed.duration, score.duration);
  assert.equal(parsed.tempo, 500000);
  assert.equal(parsed.program, 0, 'generated text defaults to acoustic grand piano');
  assert.equal(parsed.title, 'Text: HI');
  assert.equal(score.secondsPerRow, 0.25);
  assert.equal(score.lowestNote, 48);
  assert.equal(score.highestNote, 58);
  assert.equal(score.columns, 11);
  assert.equal(score.rows, 8);
  assert.deepEqual(score.phrases, ['HI']);
});

test('asymmetric letters retain their upright orientation in the sounding MIDI', () => {
  for (const [letter, pixels] of Object.entries({
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  })) {
    const score = generateTextMidi(letter);
    assert.deepEqual(rasterize({ ...score, notes: readScore(score.buffer).notes }), pixels);
  }
});

test('vertical pixels sustain notes, spaces leave silent pitches and phrases end with a rest', () => {
  const score = generateTextMidi('I I');
  const parsed = readScore(score.buffer);
  assert.equal(score.notes.length, 18, 'two I glyphs have nine sustained vertical runs each');
  assert.equal(score.columns, 17);
  assert.equal(score.duration, 2);
  assert.ok(score.notes.some(note => note.note === 50 && note.start === 0 && note.duration === 1.75));
  const lastNoteEnd = Math.max(...score.notes.map(note => note.start + note.duration));
  assert.equal(score.duration - lastNoteEnd, score.secondsPerRow);
  for (const note of parsed.notes) {
    assert.ok(note.note <= 52 || note.note >= 60, 'inter-letter space does not secretly schedule notes');
  }
  assert.deepEqual(parsed.notes, score.notes);
});

test('long inputs wrap in eight-glyph phrases without reversing characters or exceeding MIDI pitch bounds', () => {
  for (const text of ['FRJABCDEFG', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345']) {
    const score = generateTextMidi(text), parsed = readScore(score.buffer);
    assert.equal(score.phrases.join(''), text);
    assert.equal(score.rows, Math.ceil(text.length / 8) * 8);
    assert.equal(score.duration, Math.ceil(text.length / 8) * 2);
    assert.deepEqual(parsed.notes, score.notes);
    score.phrases.forEach((phrase, index) => {
      const separate = generateTextMidi(phrase);
      const pixels = rasterize({ ...score, notes: parsed.notes }, index);
      assert.deepEqual(pixels.map(row => row.slice(0, separate.columns)), rasterize(separate));
      assert.ok(pixels.every(row => /^0*$/.test(row.slice(separate.columns))));
      const restFrom = (index * 8 + 7) * score.secondsPerRow;
      assert.ok(parsed.notes.every(note => note.start + note.duration <= restFrom
        || note.start >= restFrom + score.secondsPerRow), 'a full silent row separates successive phrases');
    });
    assert.ok(parsed.notes.every(note => note.note >= 48 && note.note <= 94));
  }
});

test('a silent final channel event preserves the exact score duration in SpessaSynth loops', () => {
  for (const text of ['HELLO MIDI', 'I', '"']) {
    const score = generateTextMidi(text), parsed = readScore(score.buffer);
    assert.deepEqual(parsed.controllers, [{ tick: score.rows * 240, controller: 123, value: 0 }]);
    const lastNoteOffTick = Math.max(...parsed.events.filter(event => !event.on).map(event => event.tick));
    const lastChannelTick = parsed.controllers[0].tick;
    assert.ok(lastChannelTick - lastNoteOffTick >= 240, 'at least one blank row remains before loop restart');
    assert.equal(lastChannelTick * 0.5 / 480, score.duration);
    assert.equal(parsed.duration, score.duration);
  }
});

test('case, accents, compatibility characters and punctuation normalize deterministically', () => {
  assert.equal(normalizeTextMidi('  Héllo\tｗｏｒｌｄ… 123 — “yes”! '), 'HELLO WORLD... 123 - "YES"!');
  assert.equal(normalizeTextMidi('straße'), 'STRASSE');
  assert.equal(normalizeTextMidi('AB🙂☃️CD'), 'AB🙂 CD');
  assert.equal(normalizeTextMidi('A\u0000\u0001B'), 'A B');
  assert.equal(normalizeTextMidi('a\n\n b'), 'A B');
  const plain = generateTextMidi('CAFE!');
  const normalized = generateTextMidi('café!');
  assert.deepEqual(normalized, plain);
  assert.deepEqual(generateTextMidi('CAFE!').buffer, plain.buffer);
});

test('empty, unsupported-only and non-string input cannot create a silent or coerced song', () => {
  for (const input of ['', ' \n\t ', '🦄☃️', null, undefined, 123, {}, { toString() { throw new Error('must not call'); } }]) {
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
    assert.ok([...normalized].length <= MAX_TEXT_MIDI_GLYPHS);
    if (!normalized) { assert.throws(() => generateTextMidi(text)); continue; }
    const score = generateTextMidi(text), parsed = readScore(score.buffer);
    assert.ok(score.columns <= 47);
    assert.ok(score.rows <= 32);
    assert.ok(score.duration <= 8);
    assert.ok(score.notes.length <= 640);
    assert.ok(parsed.events.length <= 1280);
    assert.ok(parsed.maxPolyphony <= 40);
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
    assert.equal(score.columns, 5);
    assert.equal(score.rows, 8);
    assert.ok(score.notes.length > 0);
    assert.deepEqual(parsed.notes, score.notes);
    assert.ok(parsed.maxPolyphony <= 5);
    for (const note of score.notes) {
      assert.ok(Number.isInteger(note.note) && note.note >= 48 && note.note <= 52);
      assert.ok(Number.isFinite(note.start) && note.start >= 0);
      assert.ok(Number.isFinite(note.duration) && note.duration > 0);
      assert.equal(note.start / score.secondsPerRow % 1, 0);
      assert.equal(note.duration / score.secondsPerRow % 1, 0);
      assert.ok(note.velocity > 0 && note.velocity <= 127);
    }
    shapes.add(rasterize(score).join('/'));
  }
  assert.equal(shapes.size, characters.length, 'letter, number and punctuation shapes remain distinguishable');
});


test('curated emoji glyphs have distinct sounding shapes and unsupported symbols are reported', () => {
  const seen = new Set();
  for (const symbol of ['🙂', '😀', '⭐', '❤️', '◆']) {
    const score = generateTextMidi(symbol), parsed = readScore(score.buffer);
    assert.deepEqual(parsed.notes, score.notes);
    assert.equal(parsed.title, `Text: ${score.text}`);
    assert.deepEqual(score.unsupported, []);
    seen.add(rasterize(score).join('/'));
  }
  assert.equal(seen.size, 5);
  const mixed = generateTextMidi('HI 🦄 ⭐');
  assert.deepEqual(mixed.unsupported, ['🦄']);
  assert.equal(mixed.text, 'HI ⭐');
});

test('letter mode sounds each complete upright glyph in chronological order', () => {
  const score = generateTextMidi('FR🙂', { mode: 'letter' });
  assert.equal(score.columns, 5);
  assert.equal(score.rows, 24);
  assert.equal(score.duration, 6);
  assert.deepEqual(score.phrases, ['F', 'R', '🙂']);
  assert.deepEqual(readScore(score.buffer).notes, score.notes);
  score.phrases.forEach((character, index) => assert.deepEqual(rasterize(score, index), rasterize(generateTextMidi(character))));
  const maximum = generateTextMidi('⭐'.repeat(10000), { mode: 'letter' });
  assert.equal(maximum.rows, 256);
  assert.equal(maximum.duration, 64);
  assert.ok(readScore(maximum.buffer).maxPolyphony <= 5);
});

test('drawing MIDI contains exactly the upright painted cells including sustained vertical runs', () => {
  const pixels = [[0, 1, 0], [1, 1, 0], [0, 1, 1], [0, 0, 1]];
  const score = generateGridMidi(pixels, { secondsPerRow: .125 });
  const decoded = readScore(score.buffer);
  assert.equal(decoded.program, 0, 'generated drawing exports acoustic grand piano');
  assert.deepEqual(decoded.notes, score.notes);
  const restored = pixels.map(row => row.map(() => 0));
  for (const note of decoded.notes) for (let row = note.start / .125; row < (note.start + note.duration) / .125; row++) {
    restored[pixels.length - 1 - row][note.note - score.lowestNote] = 1;
  }
  assert.deepEqual(restored, pixels);
  assert.equal(decoded.duration, .5);
  assert.equal(decoded.notes.length, 3);
  assert.equal(decoded.maxPolyphony, 2);
});

test('drawing encoder rejects empty, ragged and unbounded score geometry', () => {
  for (const pixels of [[], [[0]], [[1], [1, 0]], [Array(129).fill(1)], Array(257).fill([1])]) {
    assert.throws(() => generateGridMidi(pixels));
  }
  for (const options of [{ secondsPerRow: NaN }, { secondsPerRow: 0 }, { lowestNote: 127 },
    { retrigger: 'yes' }, { velocity: 0 }, { velocity: 128 }, { velocity: 1.5 }, { velocity: NaN }]) {
    assert.throws(() => generateGridMidi([[1, 1]], options));
  }
});

test('grid MIDI supports every MIDI pitch and releases each cell before its next retrigger', () => {
  const pixels = [Array(128).fill(1), Array(128).fill(1)];
  const score = generateGridMidi(pixels, { lowestNote: 0, secondsPerRow: .0625, retrigger: true, velocity: 127 });
  const decoded = readScore(score.buffer);
  assert.deepEqual(decoded.notes, score.notes);
  assert.equal(decoded.notes.length, 256); assert.equal(decoded.maxPolyphony, 128);
  assert.ok(decoded.notes.every(note => note.duration === .0625 && note.velocity === 127));
  assert.equal(score.lowestNote, 0); assert.equal(score.highestNote, 127);
});

test('new grid articulation options preserve default held notes and their existing velocity', () => {
  const pixels = [[1, 1], [1, 0], [1, 1]];
  const original = generateGridMidi(pixels);
  const explicit = generateGridMidi(pixels, { retrigger: false, velocity: 88 });
  assert.deepEqual(original.buffer, explicit.buffer);
  assert.ok(readScore(original.buffer).notes.every(note => note.velocity === 88));
  assert.equal(original.notes.find(note => note.note === 48).duration, .75);
});

test('optional grid resolution preserves default bytes and encodes short or tall grids exactly', () => {
  const pixels = [[1, 0], [1, 1], [0, 1]];
  assert.deepEqual(generateGridMidi(pixels).buffer, generateGridMidi(pixels, { ticksPerBeat: 480 }).buffer);
  for (const rows of [1, 32, 128, 256]) for (const beats of [.25, 2.75, 64]) {
    const grid = Array.from({ length: rows }, (_, row) => [1, row % 2]);
    const score = generateGridMidi(grid, { secondsPerRow: beats / (rows * 2), ticksPerBeat: 15360, retrigger: true });
    const decoded = readScore(score.buffer);
    assert.equal(new DataView(score.buffer).getUint16(12), 15360);
    assert.equal(decoded.duration, beats / 2); assert.equal(score.duration, decoded.duration);
    assert.deepEqual(decoded.notes, score.notes); assert.equal(score.notes[0].duration, beats / (rows * 2));
  }
});

test('grid quantization reports actual note timing and rejects invalid or unbounded resolution', () => {
  const score = generateGridMidi([[1], [0], [1]], { secondsPerRow: .012345, ticksPerBeat: 15360 });
  const expectedRow = Math.round(.012345 * 30720) / 30720;
  assert.equal(score.secondsPerRow, expectedRow);
  const decoded = readScore(score.buffer);
  score.notes.forEach((note, index) => {
    assert.ok(Math.abs(note.start - decoded.notes[index].start) < 1e-12);
    assert.ok(Math.abs(note.duration - decoded.notes[index].duration) < 1e-12);
  });
  assert.ok(Math.abs(decoded.duration - score.duration) < 1e-12);
  for (const options of [{ ticksPerBeat: 0 }, { ticksPerBeat: 32768 }, { ticksPerBeat: 1.5 }, { ticksPerBeat: Infinity },
    { ticksPerBeat: '480' }, { ticksPerBeat: 15360, secondsPerRow: 1 / 61440 }, { secondsPerRow: 33 }]) {
    assert.throws(() => generateGridMidi([[1]], options));
  }
  assert.throws(() => generateGridMidi(Array(256).fill([1]), { secondsPerRow: 1 }));
});
