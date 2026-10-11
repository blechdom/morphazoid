import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseMidi, beatsToSeconds, GM_PROGRAM_NAMES, loopLength, deckPosition, defaultDeckConfig } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { generateTextMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';

function midi(events, { format = 0, division = 480 } = {}) {
  const bytes = new Uint8Array(22 + events.length), view = new DataView(bytes.buffer);
  bytes.set([77, 84, 104, 100]); view.setUint32(4, 6); view.setUint16(8, format); view.setUint16(10, 1); view.setUint16(12, division);
  bytes.set([77, 84, 114, 107], 14); view.setUint32(18, events.length); bytes.set(events, 22); return bytes.buffer;
}
test('MIDI inspector pairs overlapping notes FIFO, running status, velocity-zero off and preserves controllers', () => {
  const score = parseMidi(midi([0, 0xc2, 33, 0, 0xb2, 64, 127, 0, 0x92, 60, 90, 120, 60, 80, 120, 60, 0, 120, 0x82, 60, 0, 0, 0xff, 0x2f, 0]));
  assert.equal(score.noteCount, 2); assert.equal(score.channels[0].program, 33); assert.equal(score.channels[0].instrument, 'Electric Bass (finger)');
  assert.deepEqual(score.notes.map(note => [note.beat, note.duration]), [[0, 0.5], [0.25, 0.5]]);
  assert.ok(score.events.some(event => event.kind === 11 && event.a === 64 && event.b === 127));
  assert.equal(score.key.source, 'estimated'); assert.equal(GM_PROGRAM_NAMES.length, 128);
});
test('source tempo, meter and embedded key maps retain physical quarter-note positions', () => {
  const score = parseMidi(midi([0, 255, 81, 3, 7, 161, 32, 0, 255, 88, 4, 3, 2, 24, 8, 0, 255, 89, 2, 2, 0, 0, 144, 60, 90, 0x83, 0x60, 255, 81, 3, 15, 66, 64, 0x83, 0x60, 128, 60, 0, 0, 255, 47, 0]));
  assert.deepEqual(score.tempoMap.map(item => [item.beat, item.bpm]), [[0, 120], [1, 60]]);
  assert.equal(score.durationBeats, 2); assert.equal(score.durationSeconds, 1.5); assert.equal(beatsToSeconds(2, score.tempoMap), 1.5);
  assert.equal(score.meterMap[0].numerator, 3); assert.equal(score.key.label, 'D major'); assert.equal(score.key.source, 'embedded');
  assert.equal(loopLength(score), 3); assert.equal(deckPosition(4, score, { ...defaultDeckConfig(), offsetBeats: 1 }), 2);
});
test('parser rejects format2, SMPTE, malformed lengths, missing status, overflow VLQ and oversize input clearly', () => {
  const valid = generateTextMidi('HI').buffer;
  assert.throws(() => parseMidi(midi([], { format: 2 })), /format 2/);
  assert.throws(() => parseMidi(midi([], { division: 0xe728 })), /SMPTE/);
  assert.throws(() => parseMidi(valid.slice(0, -1)), /truncated/);
  assert.throws(() => parseMidi(midi([0, 60, 90])), /running status/);
  assert.throws(() => parseMidi(midi([255, 255, 255, 255, 0])), /variable-length/);
  assert.throws(() => parseMidi(new ArrayBuffer(11 * 1024 * 1024)), /10 MB/);
});
test('all 100 bundled arrangements parse with bounded metadata and dense note counts intact', async () => {
  const directory = new URL('../assets/midiphoria/midi/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /\.midi?$/i.test(name)); let largest = 0;
  for (const file of files) {
    const score = parseMidi(await readFile(new URL(file, directory)));
    assert.ok(score.noteCount > 0, file); assert.equal(score.notes.length, score.noteCount);
    assert.ok(score.durationSeconds > 0 && Number.isFinite(score.durationSeconds), file);
    assert.ok(score.channels.length <= 64, file); largest = Math.max(largest, score.noteCount);
  }
  assert.ok(files.length >= 100); assert.ok(largest > 150000, 'full black MIDI arrangement remains intact');
});
