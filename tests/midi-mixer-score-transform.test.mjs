import test from 'node:test';
import assert from 'node:assert/strict';
import { transformMidiStamp } from '../src/instruments/midi-mixer/midi-mixer-score-transform.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function midi(tracks, end = 8) {
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
  const parts = tracks.map(messages => {
    let tick = 0; const data = [];
    for (const [beat, ...message] of [...messages].sort((a, b) => a[0] - b[0]).concat([[end, 255, 47, 0]])) {
      const next = Math.round(beat * 960); data.push(...vlq(next - tick), ...message); tick = next;
    }
    const chunk = new Uint8Array(data.length + 8); chunk.set([77, 84, 114, 107]); new DataView(chunk.buffer).setUint32(4, data.length); chunk.set(data, 8); return chunk;
  });
  const result = new Uint8Array(14 + parts.reduce((sum, part) => sum + part.length, 0));
  result.set([77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0, 0, tracks.length, 3, 192]);
  let cursor = 14; for (const part of parts) { result.set(part, cursor); cursor += part.length; }
  return result.buffer;
}
const controls = analysis => analysis.events.filter(event => event.kind !== 8 && event.kind !== 9).map(({ beat, channel, kind, a, b }) => ({ beat, channel, kind, a, b }));

test('default gate preserves every source byte, including SysEx and metadata', () => {
  const original = midi([[[0, 255, 3, 4, 84, 101, 115, 116], [0, 240, 3, 1, 2, 247], [0, 144, 60, 100], [4, 128, 60, 33]]]);
  const result = transformMidiStamp(original);
  assert.deepEqual(result.buffer, original); assert.equal(result.gateScale, 1); assert.equal(result.adjustedNoteCount, 0);
  const view = new Uint8Array(original.byteLength + 9); view.set(new Uint8Array(original), 4);
  assert.deepEqual(transformMidiStamp(view.subarray(4, 4 + original.byteLength)).buffer, original);
});

test('gate compression preserves attacks, MIDI ports, controller automation, meter and tempo', () => {
  const original = midi([
    [[0, 255, 81, 3, 7, 161, 32], [0, 255, 88, 4, 7, 3, 24, 8], [0, 255, 33, 1, 2], [0, 192, 48], [0, 176, 0, 2], [0, 176, 64, 127], [0, 144, 60, 40], [2, 224, 10, 65], [3, 176, 10, 100], [4, 128, 60, 21], [5, 176, 64, 0]],
    [[0, 153, 36, 99], [2, 137, 36, 4]],
  ]);
  const before = parseMidi(original), result = transformMidiStamp(original, { gateScale: .25 }), after = result.analysis;
  assert.equal(after.noteCount, before.noteCount); assert.equal(after.durationBeats, before.durationBeats);
  assert.deepEqual(after.notes.map(({ beat, note, channel, velocity }) => ({ beat, note, channel, velocity })), before.notes.map(({ beat, note, channel, velocity }) => ({ beat, note, channel, velocity })));
  assert.deepEqual(after.notes.map(note => [note.channel, note.duration]).sort((a, b) => a[0] - b[0]), [[9, .5], [32, 1]]);
  assert.deepEqual(controls(after), controls(before)); assert.deepEqual(after.tempoMap, before.tempoMap); assert.deepEqual(after.meterMap, before.meterMap);
  assert.equal(after.events.find(event => event.kind === 8 && event.channel === 32).b, 21);
});

test('overlapping repeated notes retain FIFO gate pairing and same-tick sustain restoration', () => {
  const original = midi([[[0, 176, 64, 127], [0, 144, 60, 30], [0, 128, 60, 0], [1, 144, 60, 60], [2, 144, 60, 90], [3, 128, 60, 0], [4, 128, 60, 0], [7, 176, 64, 0]]]);
  const result = transformMidiStamp(original, { gateScale: .5 });
  assert.deepEqual(result.analysis.notes.map(note => [note.beat, note.velocity, note.duration]), [[0, 30, 1 / 960], [1, 60, 1], [2, 90, 1]]);
  assert.ok(result.analysis.events.some(event => event.kind === 8 && event.beat === 0));
  assert.deepEqual(controls(result.analysis), controls(parseMidi(original)));
});

test('running-status files preserve source state and unterminated notes gain complete releases', () => {
  const original = midi([[[0, 255, 33, 1, 3], [0, 144, 60, 80], [1, 64, 90], [3, 128, 60, 4]]]);
  const result = transformMidiStamp(original, { gateScale: .5 });
  assert.equal(result.analysis.noteCount, 2); assert.deepEqual(result.analysis.notes.map(note => [note.channel, note.note, note.duration]), [[48, 60, 1.5], [48, 64, 3.5]]);
  assert.ok(result.warnings.some(warning => /Missing note-offs/.test(warning)));
  assert.equal(result.analysis.durationBeats, 8);
});

test('tiny gates retain every attack and clamp to at least one MIDI tick', () => {
  const events = []; for (let index = 0; index < 2048; index++) { events.push([index / 960, 144, index % 128, 1 + index % 127], [(index + 1) / 960, 128, index % 128, 0]); }
  const original = midi([events], 4), result = transformMidiStamp(original, { gateScale: 0 });
  assert.equal(result.gateScale, .01); assert.equal(result.analysis.noteCount, 2048);
  assert.ok(result.analysis.notes.every(note => Math.abs(note.duration - 1 / 960) < 1e-8));
  assert.deepEqual(transformMidiStamp(original, { gateScale: Infinity }).buffer, original);
});
