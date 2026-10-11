import assert from 'node:assert/strict';
import test from 'node:test';
import { MIXER_SAMPLE_STAMPS, mixerStampScore, mixerMessageScore, mixerPerformanceScore, mixerPerformanceChannel,
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
    assert.equal(score.notes[0].start, 0, 'factory hits have no leading silence');
    assert.deepEqual(parsed.notes.map(note => ({ note: note.note, start: note.beat * .5,
      duration: note.duration * .5, velocity: note.velocity })).sort((a, b) => a.start - b.start || a.note - b.note), score.notes);
    assert.ok(score.notes.every(note => note.note >= 48 && note.note <= 95 && note.duration > 0));
    shapes.add(JSON.stringify(pixelsFor(score)));
  }
  assert.equal(shapes.size, 6);
  assert.throws(() => mixerStampScore('unsupported'), /sample/);
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
