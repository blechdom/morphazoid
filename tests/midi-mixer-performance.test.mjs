import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { MIXER_SAMPLE_STAMPS, MIXER_PATTERN_DEFAULTS, mixerStampScore, nextMixerStampVariation, mixerMessageScore, mixerPerformanceScore, mixerPerformanceChannel,
  indexPerformanceNotes, queryPerformanceNotes } from '../src/instruments/midi-mixer/midi-mixer-performance-score.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { midiColorHue } from '../src/instruments/midiphoria/midiphoria-renderer.js';
import { generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { MidiDrawing } from '../src/instruments/midiphoria/midiphoria-drawing.js';
import { generateAutomataMidi } from '../src/instruments/midiphoria/midiphoria-automata-midi.js';

// Raw scrolling trails put older notes above younger notes: chronological rows
// must be upright directly, without reversing the raster as the Draw editor does.
function pixelsFor(score) {
  const pixels = Array.from({ length: score.rows }, () => Array(score.columns).fill(0));
  for (const note of parseMidi(score.buffer).notes) {
    const from = Math.round(note.beat * .5 / score.secondsPerRow), duration = Math.round(note.duration * .5 / score.secondsPerRow);
    for (let row = from; row < from + duration; row++) pixels[row][note.note - score.lowestNote] = 1;
  }
  return pixels;
}

test('sample bank exports distinct upright shapes with the same notes as its sounding MIDI', () => {
  const shapes = new Set();
  for (const stamp of MIXER_SAMPLE_STAMPS) {
    const score = mixerStampScore(stamp.id), parsed = parseMidi(score.buffer);
    assert.equal(parsed.channels[0].program, 0, 'generated stamps default to acoustic grand piano');
    assert.equal(score.duration, 4);
    assert.equal(score.columns, 48); assert.equal(score.rows, 32);
    assert.equal(score.text, stamp.label);
    assert.equal(score.group, stamp.group); assert.ok(stamp.group);
    assert.equal(score.notes[0].start, 0, 'factory hits have no leading silence');
    assert.deepEqual(parsed.notes.map(note => ({ note: note.note, start: note.beat * .5,
      duration: note.duration * .5, velocity: note.velocity })).sort((a, b) => a.start - b.start || a.note - b.note), score.notes);
    assert.ok(score.notes.every(note => note.note >= 48 && note.note <= 95 && note.duration > 0));
    shapes.add(JSON.stringify(pixelsFor(score)));
    assert.deepEqual(score.pixels, pixelsFor(score), 'thumbnail is the chronological sounding MIDI raster');
  }
  assert.equal(shapes.size, MIXER_SAMPLE_STAMPS.length);
  assert.equal(shapes.size, 30);
  assert.throws(() => mixerStampScore('unsupported'), /sample/);
});

test('density, pitch span, duration and whole-score transposition change the sounding geometry', () => {
  for (const { id } of MIXER_SAMPLE_STAMPS) {
    const sparse = mixerStampScore(id, { density: 0 }), dense = mixerStampScore(id, { density: 1 });
    const count = score => score.pixels.reduce((sum, row) => sum + row.reduce((a, b) => a + b), 0);
    assert.ok(count(dense) > count(sparse), `${id}: density adds sounding cells`);
    const narrow = mixerStampScore(id, { span: 12, beats: 4, transpose: -24 });
    assert.equal(narrow.columns, 12); assert.equal(narrow.lowestNote, 42); assert.equal(narrow.highestNote, 53);
    assert.equal(parseMidi(narrow.buffer).durationBeats, 4);
    assert.deepEqual(narrow.pixels, pixelsFor(narrow));
    const long = mixerStampScore(id, { beats: 32 }), shifted = mixerStampScore(id, { transpose: 36 });
    assert.equal(parseMidi(long.buffer).durationBeats, 32);
    assert.deepEqual(long.pixels, mixerStampScore(id).pixels, 'duration scales time, preserving the picture');
    assert.deepEqual(shifted.pixels, mixerStampScore(id).pixels, 'transposition never clips the picture');
    assert.equal(shifted.highestNote, 127); assert.equal(shifted.patternOptions.transpose, 32);
  }
});

test('default stamp bank and drawing retain their published MIDI bytes', () => {
  const bank = createHash('sha256');
  for (const { id } of MIXER_SAMPLE_STAMPS) bank.update(new Uint8Array(mixerStampScore(id).buffer));
  assert.equal(bank.digest('hex'), 'd0b72531a2dad567653100763101426e0a2ad5dc95c06b673a3e8e8843385c46');
  const drawing = generateGridMidi([[0, 1, 0], [1, 1, 0], [1, 0, 1], [0, 0, 0]], { secondsPerRow: .125 });
  assert.equal(createHash('sha256').update(new Uint8Array(mixerPerformanceScore(drawing).buffer)).digest('hex'),
    'ee1aa7bd2d814b1e17cbf89ed531e82bbbb4814941b70fa8aa95dc3d8d00fbd2');
});

test('fractional pattern height scales the entire temporal extent without changing its bitmap', () => {
  for (const { id } of MIXER_SAMPLE_STAMPS) {
    const original = mixerStampScore(id);
    for (const beats of [.25, .5, 2.75, 16.25, 64]) {
      const score = mixerStampScore(id, { beats }), decoded = parseMidi(score.buffer);
      assert.equal(score.rows, 32); assert.equal(score.heightBeats, beats);
      assert.equal(score.patternOptions.beats, beats); assert.equal(decoded.durationBeats, beats);
      assert.equal(score.secondsPerRow, beats / 64);
      assert.deepEqual(score.pixels, original.pixels); assert.deepEqual(pixelsFor(score), original.pixels);
      assert.equal(score.notes[0].start, 0); assert.equal(score.notes.length, original.notes.length);
      score.notes.forEach((note, index) => {
        assert.equal(note.start, original.notes[index].start * beats / 8);
        assert.equal(note.duration, original.notes[index].duration * beats / 8);
      });
    }
  }
});

test('horizontal pattern offset moves the fitted transposed window without clipping or folding', () => {
  for (const span of [12, 48, 127, 128]) for (const transpose of [-127, 0, 7, 127]) {
    const normal = mixerStampScore('scatter', { span, transpose, seed: 66, density: 1 });
    for (const offset of [-127, -12, 0, 12, 127]) {
      const score = mixerStampScore('scatter', { span, transpose, offset, seed: 66, density: 1 });
      const expectedBase = Math.max(0, Math.min(128 - span, normal.lowestNote + offset));
      assert.equal(score.lowestNote, expectedBase); assert.equal(score.highestNote, expectedBase + span - 1);
      assert.equal(score.appliedOffset, expectedBase - normal.lowestNote);
      assert.deepEqual(score.pixels, normal.pixels); assert.deepEqual(pixelsFor(score), normal.pixels);
      assert.deepEqual(score.notes, normal.notes.map(note => ({ ...note, note: note.note + score.appliedOffset })));
    }
  }
});

test('seeded particle and organic patterns repeat exactly and reroll into distinct soundable scores', () => {
  for (const id of ['drips', 'cloud', 'rain', 'comet', 'noise', 'scatter', 'explode', 'sparks', 'glob', 'glooob']) {
    const first = mixerStampScore(id, { seed: 1234 }), same = mixerStampScore(id, { seed: 1234 });
    const other = mixerStampScore(id, { seed: 9876 });
    assert.deepEqual(first.buffer, same.buffer, `${id} is reproducible`);
    assert.notDeepEqual(first.buffer, other.buffer, `${id} responds to its seed`);
    assert.deepEqual(first.pixels, pixelsFor(first));
  }
});

test('full-width patterns sound MIDI endpoints and narrower patterns can be placed at either boundary', () => {
  const full = mixerStampScore('scatter', { span: 128, density: 1, seed: 66 });
  assert.equal(full.columns, 128); assert.equal(full.lowestNote, 0); assert.equal(full.highestNote, 127);
  const notes = parseMidi(full.buffer).notes;
  assert.ok(notes.some(note => note.note === 0)); assert.ok(notes.some(note => note.note === 127));
  assert.deepEqual(pixelsFor(full), full.pixels);
  for (const span of [12, 48, 127, 128]) {
    const low = mixerStampScore('noise', { span, transpose: -127 });
    const high = mixerStampScore('noise', { span, transpose: 127 });
    assert.equal(low.lowestNote, 0); assert.equal(low.highestNote, span - 1);
    assert.equal(high.lowestNote, 128 - span); assert.equal(high.highestNote, 127);
    assert.deepEqual(low.pixels, high.pixels, 'moving a whole pattern preserves its geometry');
    assert.deepEqual(low.pixels, pixelsFor(low)); assert.deepEqual(high.pixels, pixelsFor(high));
    assert.deepEqual(low.notes.map(note => note.note + 128 - span), high.notes.map(note => note.note));
  }
});

test('Variation skips identical neighboring seeds and returns a complete distinct MIDI score', () => {
  const options = { seed: 10, density: 0, span: 48, beats: 2.75, transpose: 7, offset: -12 };
  const previous = mixerStampScore('stripes', options), adjacent = mixerStampScore('stripes', { ...options, seed: 11 });
  assert.deepEqual(previous.pixels, adjacent.pixels, 'regression: adjacent phase seeds can rasterize identically');
  const next = nextMixerStampVariation('stripes', options);
  assert.ok(next.patternOptions.seed > 11 && next.patternOptions.seed <= 26);
  assert.notDeepEqual(next.pixels, previous.pixels); assert.notDeepEqual(next.buffer, previous.buffer);
  assert.deepEqual(next.pixels, pixelsFor(next));
  assert.deepEqual({ ...next.patternOptions, seed: 10 }, options);
  const wrapped = nextMixerStampVariation('noise', { seed: 0xffffffff });
  assert.equal(wrapped.patternOptions.seed, 0);
  assert.notDeepEqual(wrapped.pixels, mixerStampScore('noise', { seed: 0xffffffff }).pixels);
});

test('Variation returns null for fixed grids and literal shapes but varies sparse icons', () => {
  for (const id of ['heart', 'square', 'star', 'smile', 'diamond', 'wave', 'polka-dots', 'plaid', 'checker', 'ladder', 'staircase', 'rings']) {
    assert.equal(nextMixerStampVariation(id), null, id);
    assert.equal(nextMixerStampVariation(id, { density: 1, seed: 300 }), null, id);
  }
  for (const id of ['heart', 'square', 'star', 'smile', 'diamond', 'wave']) {
    const next = nextMixerStampVariation(id, { density: .2 });
    assert.ok(next); assert.notDeepEqual(next.pixels, mixerStampScore(id, { density: .2 }).pixels);
  }
  assert.throws(() => nextMixerStampVariation('unknown'), /Choose/);
});

test('all pattern extremes remain bounded, nonempty and within the one-shot MIDI budget', () => {
  const cases = [{ seed: 0, density: 0, span: 12, beats: .25, transpose: -36, offset: -127 },
    { seed: 0xffffffff, density: 1, span: 128, beats: 64, transpose: 127, offset: 127 },
    { seed: -1e100, density: 1e100, span: 1e100, beats: -1e100, transpose: 1e100, offset: -1e100 },
    { seed: NaN, density: Infinity, span: 'wrong', beats: undefined, transpose: NaN, offset: Infinity }];
  for (const { id } of MIXER_SAMPLE_STAMPS) for (const options of cases) {
    const score = mixerStampScore(id, options), analysis = parseMidi(score.buffer);
    assert.ok(analysis.noteCount > 0 && analysis.noteCount <= 2048);
    assert.ok(analysis.events.length < 32768 && score.buffer.byteLength < 2 * 1024 * 1024);
    assert.equal(score.rows, 32); assert.ok(score.columns >= 12 && score.columns <= 128);
    assert.ok(analysis.notes.every(note => note.note >= 0 && note.note <= 127 && note.duration > 0));
    assert.ok(analysis.durationBeats >= .25 && analysis.durationBeats <= 64);
    assert.equal(score.notes[0].start, 0);
    assert.deepEqual(score.pixels, pixelsFor(score));
  }
  assert.deepEqual(mixerStampScore('noise', null).patternOptions, MIXER_PATTERN_DEFAULTS);
});

test('square sample is a hollow square; top and bottom of exported MIDI preserve drawing orientation', () => {
  const pixels = pixelsFor(mixerStampScore('square'));
  assert.equal(pixels[0].reduce((a, b) => a + b), 22);
  assert.equal(pixels[21].reduce((a, b) => a + b), 22);
  assert.equal(pixels[15].reduce((a, b) => a + b), 4);
  assert.equal(pixels[15][20], 0);
  assert.equal(pixels[22].reduce((a, b) => a + b), 0);
  assert.equal(pixels[31].reduce((a, b) => a + b), 0);
});

test('message samples retain whole-word MIDI geometry and validate unsupported/oversized input', () => {
  const score = mixerMessageScore('Hi 🙂 ⭐ 🦄');
  assert.equal(score.name, 'HI 🙂 ⭐'); assert.deepEqual(score.unsupported, ['🦄']);
  assert.ok(parseMidi(score.buffer).noteCount > 0);
  assert.equal(pixelsFor(mixerMessageScore('F'))[0].join(''), '11111');
  assert.equal(pixelsFor(mixerMessageScore('F'))[6].join(''), '10000');
  assert.equal(pixelsFor(mixerMessageScore('F'))[7].join(''), '00000', 'phrase rest follows the upright glyph');
  for (const input of ['', '  ', null, {}, '🦄']) assert.throws(() => mixerMessageScore(input));
  const bounded = mixerMessageScore('⭐'.repeat(10000));
  assert.equal([...bounded.text].length, 32); assert.equal(bounded.duration, 8);
});

test('message phrases keep reading order and their silent separators while scrolling upward', () => {
  const score = mixerMessageScore('FFFFFFFFLLLLLLLL'), pixels = pixelsFor(score);
  assert.deepEqual(score.phrases, ['FFFFFFFF', 'LLLLLLLL']);
  assert.equal(pixels[0].slice(0, 5).join(''), '11111');
  assert.equal(pixels[6].slice(0, 5).join(''), '10000');
  assert.equal(pixels[7].reduce((a, b) => a + b), 0);
  assert.equal(pixels[8].slice(0, 5).join(''), '10000');
  assert.equal(pixels[14].slice(0, 5).join(''), '11111');
  assert.equal(pixels[15].reduce((a, b) => a + b), 0);
});

test('message layout exposes sequential letters while preserving upright glyphs and every note', () => {
  const word = mixerMessageScore('FL'), letters = mixerMessageScore('FL', { mode: 'letter' });
  assert.equal(word.mode, 'word'); assert.equal(letters.mode, 'letter');
  assert.deepEqual(letters.phrases, ['F', 'L']); assert.equal(letters.columns, 5); assert.equal(letters.rows, 16);
  const pixels = pixelsFor(letters);
  assert.equal(pixels[0].join(''), '11111'); assert.equal(pixels[6].join(''), '10000');
  assert.equal(pixels[8].join(''), '10000'); assert.equal(pixels[14].join(''), '11111');
  assert.equal(parseMidi(letters.buffer).noteCount, parseMidi(word.buffer).noteCount);
});

test('current drawings become upright sounding trails without mutating the editor score', () => {
  const pixels = [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 0, 0]];
  const drawing = generateGridMidi(pixels), originalNotes = structuredClone(drawing.notes);
  const performance = mixerPerformanceScore(drawing);
  assert.deepEqual(pixelsFor(performance), pixels);
  assert.equal(performance.notes[0].start, .25, 'authored drawing padding remains');
  assert.deepEqual(drawing.notes, originalNotes);
  assert.notEqual(performance.buffer, drawing.buffer);
  for (const score of [null, {}, { ...drawing, rows: 10000 }, { ...drawing, notes: [{ note: 129, start: 0, duration: 1 }] }]) {
    assert.throws(() => mixerPerformanceScore(score));
  }
});

test('drawing row length and lowest note resize timing and pitch without altering the drawing', () => {
  const drawing = generateGridMidi([[0, 1, 0], [1, 1, 0], [1, 0, 1], [0, 0, 0]], { secondsPerRow: .125 });
  const before = drawing.buffer.slice(0), normal = mixerPerformanceScore(drawing);
  const moved = mixerPerformanceScore(drawing, { secondsPerRow: .5, lowestNote: 12 });
  assert.equal(moved.duration, normal.duration * 4); assert.equal(moved.lowestNote, 12);
  assert.deepEqual(pixelsFor(moved), pixelsFor(normal));
  assert.deepEqual(parseMidi(moved.buffer).notes.map(note => note.note), parseMidi(normal.buffer).notes.map(note => note.note - 36));
  assert.deepEqual(drawing.buffer, before);
  assert.throws(() => mixerPerformanceScore(drawing, { secondsPerRow: 0 }));
  assert.throws(() => mixerPerformanceScore(drawing, { lowestNote: 127 }));
});

test('drawing height overrides row timing and offset shifts only the final fitted pitch window', () => {
  for (const rows of [4, 32, 128, 256]) {
    const pixels = Array.from({ length: rows }, (_, row) => [Number(row % 3 === 0), Number(row % 7 === 1), Number(row === rows - 1)]);
    const drawing = generateGridMidi(pixels, { secondsPerRow: .125 }), before = structuredClone(drawing);
    for (const heightBeats of [.25, 2.75, 64]) for (const offset of [-127, 12, 127]) {
      const score = mixerPerformanceScore(drawing, { heightBeats, secondsPerRow: 0, offset });
      assert.equal(score.heightBeats, heightBeats); assert.equal(score.secondsPerRow, heightBeats / (rows * 2));
      assert.equal(parseMidi(score.buffer).durationBeats, heightBeats);
      assert.equal(score.lowestNote, Math.max(0, Math.min(125, drawing.lowestNote + offset)));
      assert.equal(score.appliedOffset, score.lowestNote - drawing.lowestNote);
      assert.deepEqual(score.pixels, pixels); assert.deepEqual(pixelsFor(score), pixels);
      assert.equal(score.notes.length, drawing.notes.length);
    }
    assert.deepEqual(drawing, before);
    const wide = mixerPerformanceScore(drawing, { span: 128, lowestNote: 127, offset: -127, heightBeats: .25 });
    assert.equal(wide.lowestNote, 0); assert.equal(wide.highestNote, 127); assert.equal(wide.appliedOffset, 0);
    const fitted = mixerPerformanceScore(drawing, { lowestNote: 127, offset: -12 });
    assert.equal(fitted.lowestNote, 113, 'fit the original three-pitch window before applying offset');
  }
});

test('drawing pitch span stretches to every MIDI pitch with matching export and preview, retaining its authored grid', () => {
  const pixels = Array.from({ length: 4 }, () => Array(48).fill(0));
  pixels[0][0] = 1; pixels[1][12] = 1; pixels[2][12] = 1; pixels[3][47] = 1;
  const drawing = generateGridMidi(pixels, { secondsPerRow: .125 }), before = structuredClone(drawing);
  const normal = mixerPerformanceScore(drawing);
  assert.deepEqual(mixerPerformanceScore(drawing, { span: 48 }).buffer, normal.buffer, 'explicit original span preserves the old drawing');
  const full = mixerPerformanceScore(drawing, { span: 128, lowestNote: 48 });
  assert.equal(full.lowestNote, 0); assert.equal(full.highestNote, 127); assert.equal(full.duration, normal.duration);
  assert.deepEqual(full.pixels, pixels.map(row => Array.from({ length: 128 }, (_, x) => row[Math.floor((x + .5) * 48 / 128)])));
  assert.deepEqual(pixelsFor(full), full.pixels);
  const actual = parseMidi(full.buffer).notes;
  assert.ok(actual.some(note => note.note === 0)); assert.ok(actual.some(note => note.note === 127));
  assert.ok(actual.every(note => note.note >= 0 && note.note <= 127));
  assert.deepEqual(drawing, before, 'resizing never edits the source drawing, notes or download');
  const source128 = generateGridMidi([Array(128).fill(1)], { lowestNote: 0 });
  assert.equal(mixerPerformanceScore(source128).columns, 128, 'full-width authored scores also pass through the adapter');
});

test('compressing a drawing retains thin strokes and safely fits its new pitch window', () => {
  const pixels = Array.from({ length: 4 }, () => Array(48).fill(0));
  pixels[1][12] = 1; pixels[2][12] = 1;
  const drawing = generateGridMidi(pixels);
  const narrow = mixerPerformanceScore(drawing, { span: 12, lowestNote: 127 });
  assert.equal(narrow.lowestNote, 116); assert.equal(narrow.highestNote, 127);
  assert.equal(narrow.notes.length, 1); assert.equal(narrow.notes[0].note, 119);
  assert.equal(narrow.notes[0].duration, .5); assert.equal(narrow.notes[0].start, .25);
  assert.deepEqual(narrow.pixels, pixelsFor(narrow));
  for (const options of [{ span: -100, lowestNote: -10 }, { span: 10000, lowestNote: 127 }, { span: NaN }, { span: Infinity }]) {
    const score = mixerPerformanceScore(drawing, options);
    assert.ok(score.columns >= 1 && score.columns <= 128);
    assert.ok(score.notes.length > 0 && score.notes.every(note => note.note >= 0 && note.note <= 127));
    assert.deepEqual(score.pixels, pixelsFor(score));
  }
});

test('standalone drawings and automata export acoustic grand piano before mixer overrides', () => {
  const drawing = new MidiDrawing(); drawing.stamp('❤');
  for (const score of [drawing.score(), generateAutomataMidi()]) {
    assert.equal(parseMidi(score.buffer).channels[0].program, 0);
    assert.ok(score.notes.length > 0);
  }
});

test('deck A, deck B and sample voices use stable independent hues at identical pitch/channel', () => {
  const sources = ['deck:0', 'deck:1', 'sample:1', 'sample:2'];
  const hues = sources.map(source => midiColorHue({ channel: mixerPerformanceChannel(source, 0) }, 'voice'));
  assert.equal(new Set(hues).size, 4);
  for (const source of sources) assert.equal(mixerPerformanceChannel(source, 7), mixerPerformanceChannel(source, 7));
  assert.notEqual(mixerPerformanceChannel('deck:0', 7), mixerPerformanceChannel('deck:0', 8));
  assert.ok(Number.isFinite(mixerPerformanceChannel('sample:bad', NaN)));
});

test('silent preview queries include held and brief crossed notes and skip old finished notes', () => {
  const notes = [
    { beat: 0, duration: .1 }, { beat: .2, duration: 4 }, { beat: 1, duration: .1 },
    { beat: 1.2, duration: .01 }, { beat: 2, duration: .5 },
  ];
  const index = indexPerformanceNotes(notes);
  assert.deepEqual(queryPerformanceNotes(index, 1.15, 1.3).map(item => item.index), [1, 3]);
  assert.deepEqual(queryPerformanceNotes(index, 2.6, 3).map(item => item.index), [1]);
  assert.deepEqual(queryPerformanceNotes(index, 5, 6), []);
  assert.deepEqual(queryPerformanceNotes(index, 3, 2), []);
  assert.deepEqual(queryPerformanceNotes(index, NaN, 2), []);
});

test('dense preview interval reads are bounded independently of source note count', () => {
  const notes = Array.from({ length: 100000 }, (_, index) => ({ beat: index / 100000, duration: 4 }));
  const result = queryPerformanceNotes(indexPerformanceNotes(notes), .5, 1, 512);
  assert.equal(result.length, 512);
  assert.equal(result.at(-1).index, 99999);
});
