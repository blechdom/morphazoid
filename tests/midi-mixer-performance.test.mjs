import assert from 'node:assert/strict';
import test from 'node:test';
import { MIXER_SAMPLE_STAMPS, MIXER_PATTERN_DEFAULTS, mixerStampScore, nextMixerStampVariation, mixerMessageScore, mixerPerformanceScore, mixerPerformanceChannel,
  indexPerformanceNotes, queryPerformanceNotes } from '../src/instruments/midi-mixer/midi-mixer-performance-score.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { midiColorHue } from '../src/instruments/midiphoria/midiphoria-renderer.js';
import { generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';

// Raw scrolling trails put older notes above younger notes: chronological rows
// must be upright directly, without reversing the raster as the Draw editor does.
function pixelsFor(score) {
  const pixels = Array.from({ length: score.rows }, () => Array(score.columns).fill(0));
  for (const note of parseMidi(score.buffer).notes) {
    const from = note.beat * .5 / score.secondsPerRow, duration = note.duration * .5 / score.secondsPerRow;
    for (let row = from; row < from + duration; row++) pixels[row][note.note - score.lowestNote] = 1;
  }
  return pixels;
}

test('sample bank exports distinct upright shapes with the same notes as its sounding MIDI', () => {
  const shapes = new Set();
  for (const stamp of MIXER_SAMPLE_STAMPS) {
    const score = mixerStampScore(stamp.id), parsed = parseMidi(score.buffer);
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

test('seeded particle and organic patterns repeat exactly and reroll into distinct soundable scores', () => {
  for (const id of ['drips', 'cloud', 'rain', 'comet', 'noise', 'scatter', 'explode', 'sparks', 'glob', 'glooob']) {
    const first = mixerStampScore(id, { seed: 1234 }), same = mixerStampScore(id, { seed: 1234 });
    const other = mixerStampScore(id, { seed: 9876 });
    assert.deepEqual(first.buffer, same.buffer, `${id} is reproducible`);
    assert.notDeepEqual(first.buffer, other.buffer, `${id} responds to its seed`);
    assert.deepEqual(first.pixels, pixelsFor(first));
  }
});

test('Variation skips identical neighboring seeds and returns a complete distinct MIDI score', () => {
  const options = { seed: 10, density: 0, span: 48, beats: 12, transpose: 7 };
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
  const cases = [{ seed: 0, density: 0, span: 12, beats: 4, transpose: -36 },
    { seed: 0xffffffff, density: 1, span: 48, beats: 32, transpose: 36 },
    { seed: -1e100, density: 1e100, span: 1e100, beats: -1e100, transpose: 1e100 },
    { seed: NaN, density: Infinity, span: 'wrong', beats: undefined, transpose: NaN }];
  for (const { id } of MIXER_SAMPLE_STAMPS) for (const options of cases) {
    const score = mixerStampScore(id, options), analysis = parseMidi(score.buffer);
    assert.ok(analysis.noteCount > 0 && analysis.noteCount <= 768);
    assert.ok(analysis.events.length < 32768 && score.buffer.byteLength < 2 * 1024 * 1024);
    assert.equal(score.rows, 32); assert.ok(score.columns >= 12 && score.columns <= 48);
    assert.ok(analysis.notes.every(note => note.note >= 0 && note.note <= 127 && note.duration > 0));
    assert.ok(analysis.durationBeats >= 4 && analysis.durationBeats <= 32);
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
