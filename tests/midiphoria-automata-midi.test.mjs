import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { AUTOMATA_MIDI_DEFAULTS, generateAutomataMidi, sanitizeAutomataMidiSettings, automataMidiSeedRow } from '../src/instruments/midiphoria/midiphoria-automata-midi.js';
import { automatapoeiaNextRow, automatapoeiaTransformRow } from '../src/instruments/cellular-automata/automatapoeia.js';
import { parseMidi, MIDI_SAMPLE_LIMITS } from '../src/instruments/midi-mixer/midi-mixer-model.js';

// Read actual MIDI bytes through the playback parser; recover each sounding cell
// independently of the generator's convenience notes and raster metadata.
function roundtrip(score) {
  const parsed = parseMidi(score.buffer);
  const cells = Array.from({ length: score.rows }, () => Array(score.columns).fill(0));
  for (const note of parsed.notes) {
    const from = note.beat / score.settings.rowBeats;
    const length = note.duration / score.settings.rowBeats;
    assert.ok(Math.abs(from - Math.round(from)) < 1e-7);
    assert.ok(Math.abs(length - Math.round(length)) < 1e-7);
    assert.ok(note.note >= score.lowestNote && note.note <= score.highestNote);
    assert.equal(note.velocity, score.settings.velocity);
    for (let row = Math.round(from); row < Math.round(from + length); row++) {
      assert.ok(row >= 0 && row < cells.length);
      assert.equal(cells[row][note.note - score.lowestNote]++, 0, 'a cell must not produce overlapping notes');
    }
  }
  assert.deepEqual(cells, score.pixels);
  assert.equal(parsed.notes.length, score.notes.length);
  const metadata = score.notes.map(note => ({ note: note.note, start: note.start, duration: note.duration, velocity: note.velocity }));
  const actual = parsed.notes.map(note => ({ note: note.note, start: note.beat / 2, duration: note.duration / 2, velocity: note.velocity }));
  for (const notes of [metadata, actual]) notes.sort((a, b) => a.start - b.start || a.note - b.note);
  for (let index = 0; index < actual.length; index++) {
    assert.equal(actual[index].note, metadata[index].note);
    assert.equal(actual[index].velocity, metadata[index].velocity);
    assert.ok(Math.abs(actual[index].start - metadata[index].start) < 1e-8);
    assert.ok(Math.abs(actual[index].duration - metadata[index].duration) < 1e-8);
  }
  assert.equal(parsed.durationBeats, score.durationBeats);
  assert.equal(parsed.durationSeconds, score.duration);
  return parsed;
}

test('default automata MIDI is deterministic, seed-first, and matches the exact Rule 30 evolution', () => {
  assert.ok(Object.isFrozen(AUTOMATA_MIDI_DEFAULTS));
  const defaults = generateAutomataMidi();
  assert.deepEqual(defaults.settings, AUTOMATA_MIDI_DEFAULTS);
  assert.equal(defaults.durationBeats, 16); assert.equal(defaults.duration, 8);
  assert.deepEqual(defaults.buffer, generateAutomataMidi().buffer);
  assert.equal(defaults.notes[0].start, 0); assert.equal(defaults.notes[0].note, 72);
  roundtrip(defaults);

  const narrow = generateAutomataMidi({ columns: 9, rows: 8, lowestNote: 60 });
  assert.deepEqual(narrow.pixels.slice(0, 4).map(row => row.join('')), [
    '000010000', '000111000', '001100100', '011011110',
  ]);
  const parsed = roundtrip(narrow);
  assert.equal(parsed.notes[0].note, 64); assert.equal(parsed.notes[0].beat, 0);
});

test('both automata families preserve exact boundaries and post-step transforms in exported MIDI', () => {
  for (const [family, rule] of [['elementary', 90], ['totalistic-r2', 10]]) {
    for (const boundary of ['fixed', 'periodic']) {
      for (const transform of ['none', 'shift-left', 'shift-right', 'reflect', 'complement']) {
        const score = generateAutomataMidi({ family, rule, boundary, transform, columns: 8, rows: 12, density: .5, seed: 19 });
        for (let row = 1; row < score.rows; row++) {
          const exact = automatapoeiaNextRow(score.pixels[row - 1], rule, boundary, family);
          assert.deepEqual(score.pixels[row], automatapoeiaTransformRow(exact, transform, boundary));
        }
        roundtrip(score);
      }
    }
    const fixed = generateAutomataMidi({ family, rule, columns: 8, boundary: 'fixed' });
    const periodic = generateAutomataMidi({ family, rule, columns: 8, boundary: 'periodic' });
    assert.notDeepEqual(fixed.pixels, periodic.pixels);
  }
  assert.notDeepEqual(generateAutomataMidi({ rule: 20 }).pixels, generateAutomataMidi({ family: 'totalistic-r2', rule: 20 }).pixels);
});

test('seeded Bernoulli rows match the live instrument and input settings remain untouched', () => {
  const settings = Object.freeze({ columns: 8, rows: 8, density: .5, seed: 1, velocity: 43 });
  const first = generateAutomataMidi(settings), repeated = generateAutomataMidi(settings);
  assert.deepEqual(first.pixels[0], [1, 1, 0, 0, 1, 1, 0, 0]);
  assert.deepEqual(first.buffer, repeated.buffer);
  assert.notDeepEqual(first.pixels[0], generateAutomataMidi({ ...settings, seed: 19 }).pixels[0]);
  assert.notEqual(first.settings, settings); roundtrip(first);
  assert.deepEqual(generateAutomataMidi({ density: 0, seed: 1 }).pixels, generateAutomataMidi({ density: .001, seed: 0xffffffff }).pixels);
});

test('retrigger emits every live cell; hold joins only adjacent generations of the same pitch', () => {
  const options = { rule: 255, density: 1, columns: 8, rows: 8, lowestNote: 120, rowBeats: .125, velocity: 1 };
  const retrigger = generateAutomataMidi(options), hold = generateAutomataMidi({ ...options, articulation: 'hold' });
  assert.deepEqual(retrigger.pixels, hold.pixels);
  assert.equal(roundtrip(retrigger).notes.length, 64);
  assert.equal(roundtrip(hold).notes.length, 8);
  assert.ok(retrigger.notes.every(note => note.duration === .0625));
  assert.ok(hold.notes.every(note => note.duration === .5));
  assert.equal(retrigger.notes.filter(note => note.start === 0).length, 8);
  const brokenColumns = generateAutomataMidi({ rule: 30, columns: 16, rows: 16, articulation: 'hold' });
  roundtrip(brokenColumns);
  assert.ok(brokenColumns.notes.some(note => note.duration > brokenColumns.secondsPerRow));
  assert.ok(brokenColumns.notes.some(note => note.duration === brokenColumns.secondsPerRow));
});

test('quiescent rules preserve their real seed note and empty seeds produce no fabricated notes', () => {
  const dying = generateAutomataMidi({ rule: 0, columns: 8, rows: 8 });
  assert.equal(roundtrip(dying).notes.length, 1);
  assert.ok(dying.pixels.slice(1).every(row => row.every(value => value === 0)));
  assert.throws(() => generateAutomataMidi({ rule: 0, density: .0011, columns: 8, rows: 8, seed: 1 }), error => {
    assert.equal(error.code, 'EMPTY_AUTOMATA_MIDI'); assert.match(error.message, /no MIDI notes/);
    assert.deepEqual(error.pixels, Array.from({ length: 8 }, () => Array(8).fill(0)));
    assert.equal(error.settings.rule, 0); assert.equal(error.settings.density, .0011);
    return true;
  });
});

test('numeric bounds, family codes and tick quantization are reported as the actual generated settings', () => {
  const score = generateAutomataMidi({ family: 'totalistic-r2', rule: 999, columns: 999, rows: -1, lowestNote: 127,
    rowBeats: .333333, velocity: 500, density: 999, seed: 2 ** 40, boundary: 'wrong', transform: 'wrong', articulation: 'wrong' });
  assert.deepEqual(score.settings, { ...AUTOMATA_MIDI_DEFAULTS, family: 'totalistic-r2', rule: 63,
    columns: 128, rows: 8, lowestNote: 0, rowBeats: 160 / 480, velocity: 127, density: 1, seed: 0xffffffff });
  roundtrip(score);
  assert.deepEqual(generateAutomataMidi(null).settings, AUTOMATA_MIDI_DEFAULTS);
  assert.deepEqual(generateAutomataMidi({ columns: NaN, rows: Infinity, seed: NaN, rowBeats: Infinity, density: NaN,
    rule: NaN, velocity: NaN, lowestNote: NaN, family: 'wrong' }).settings, AUTOMATA_MIDI_DEFAULTS);
  const minimum = generateAutomataMidi({ columns: 0, rows: 0, rowBeats: 0, lowestNote: -1, seed: -1, density: -1, velocity: -1, rule: -1 });
  assert.equal(minimum.columns, 8); assert.equal(minimum.rows, 8); assert.equal(minimum.lowestNote, 0);
  assert.equal(minimum.settings.seed, 0); assert.equal(minimum.settings.rule, 0); assert.equal(minimum.settings.velocity, 1);
  roundtrip(minimum);
});

test('the densest 128 by 128 score keeps all 16384 notes within the existing stamp budgets', () => {
  const score = generateAutomataMidi({ rule: 255, density: 1, columns: 128, rows: 128, rowBeats: 1 });
  const parsed = roundtrip(score);
  assert.equal(parsed.noteCount, 16384); assert.equal(score.durationBeats, 128);
  assert.equal(parsed.channels[0].minNote, 0); assert.equal(parsed.channels[0].maxNote, 127);
  assert.ok(score.buffer.byteLength < MIDI_SAMPLE_LIMITS.fileBytes);
  assert.ok(parsed.notes.length <= MIDI_SAMPLE_LIMITS.notes);
  assert.ok(parsed.events.length <= MIDI_SAMPLE_LIMITS.events);
  assert.ok(parsed.durationBeats <= MIDI_SAMPLE_LIMITS.beats);
  assert.equal(parsed.events.filter(event => event.kind === 8).length, parsed.noteCount);
});


test('finite MIDI bytes remain identical for existing centered, random and totalistic scores', () => {
  for (const [options, hash] of [
    [{}, '45782e918c17951afc9a820137116ca6ab220e3d352f2eca3934b57b878f5164'],
    [{ columns: 8, rows: 8, density: .5, seed: 19 }, 'a507bdc39fbea40583c7fe64a1d11bf3a913d0ed12b105487806634835df040f'],
    [{ family: 'totalistic-r2', rule: 20, boundary: 'periodic', transform: 'shift-left', columns: 24, rows: 16, articulation: 'hold' }, 'd259c09eab97bbb9a9798aa36af9726da6577d88911305d6ee05655ce7177d0e'],
  ]) assert.equal(createHash('sha256').update(new Uint8Array(generateAutomataMidi(options).buffer)).digest('hex'), hash);
});

test('custom seeds retain pitch cells, own their memory, and evolve through the exact rule', () => {
  const seedRow = [1, 0, 0, 1, 0, 1, 0, 0];
  const settings = sanitizeAutomataMidiSettings({ columns: 8, rows: 8, lowestNote: 120, rule: 90, seedRow });
  const seed = automataMidiSeedRow(settings); seed[0] = 0;
  assert.equal(settings.seedRow[0], 1); assert.equal(seedRow[0], 1);
  const score = generateAutomataMidi(settings);
  assert.deepEqual(score.pixels[0], seedRow);
  assert.deepEqual(score.pixels[1], automatapoeiaNextRow(seedRow, 90, 'fixed', 'elementary'));
  const parsed = roundtrip(score);
  assert.deepEqual(parsed.notes.filter(note => note.beat === 0).map(note => note.note), [120, 123, 125]);
  assert.deepEqual(generateAutomataMidi({ ...settings, density: 1, seed: 99 }).buffer, score.buffer);
  const reset = automataMidiSeedRow({ ...settings, seedRow: null, density: 0 });
  assert.deepEqual(reset, [0, 0, 0, 0, 1, 0, 0, 0]);
});

test('custom seed rows are binary, bounded and padded, including an intentional empty seed', () => {
  const source = new Float32Array([1, 0, -2, 2, NaN, Infinity, .1]);
  const settings = sanitizeAutomataMidiSettings({ columns: 8, seedRow: source });
  assert.deepEqual(settings.seedRow, [1, 0, 0, 1, 0, 0, 1, 0]);
  source[0] = 0; assert.equal(settings.seedRow[0], 1);
  assert.equal(sanitizeAutomataMidiSettings({ columns: 500, seedRow: Array(500).fill(1) }).seedRow.length, 128);
  assert.equal(sanitizeAutomataMidiSettings({ seedRow: '101' }).seedRow, null);
  const empty = { columns: 8, rows: 8, rule: 0, seedRow: [] };
  assert.deepEqual(automataMidiSeedRow(empty), Array(8).fill(0));
  assert.throws(() => generateAutomataMidi(empty), { code: 'EMPTY_AUTOMATA_MIDI' });
  const born = generateAutomataMidi({ ...empty, rule: 255 });
  assert.deepEqual(born.pixels[0], Array(8).fill(0));
  assert.deepEqual(born.pixels[1], Array(8).fill(1)); roundtrip(born);
});
