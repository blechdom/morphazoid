import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseMidiAnalysis, getMidiNoteGates, buildMidiStateHistories, midiStateMessages } from '../src/instruments/midi-mixer/midi-mixer-reverse.js';
import { parseMidi, MIDI_MIXER_LIMITS } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function midi(tracks, end = 8) {
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
  const chunks = tracks.map(messages => {
    let previous = 0; const data = [];
    for (const [beat, ...message] of [...messages].sort((a, b) => a[0] - b[0]).concat([[end, 255, 47, 0]])) {
      const tick = Math.round(beat * 960); data.push(...vlq(tick - previous), ...message); previous = tick;
    }
    const output = new Uint8Array(data.length + 8); output.set([77, 84, 114, 107]); new DataView(output.buffer).setUint32(4, data.length); output.set(data, 8); return output;
  });
  const output = new Uint8Array(14 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)), view = new DataView(output.buffer);
  output.set([77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0]); view.setUint16(10, tracks.length); view.setUint16(12, 960);
  let offset = 14; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; } return output.buffer;
}
const notes = analysis => analysis.notes.map(note => [note.beat, note.duration, note.note, note.velocity, note.channel]).sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[3] - b[3]);
const cc = (analysis, number) => analysis.events.filter(event => event.kind === 11 && event.a === number).map(event => [event.beat, event.b]);
const readState = (analysis, beat) => {
  const state = { cc: new Map(), bank: [0, 0], patch: [0, 0, 0], bend: 8192, rpn: [127, 127], nrpn: [127, 127], registered: true, parameters: new Map() };
  for (const event of analysis.events) {
    if (event.beat > beat) break;
    if (event.kind === 12) state.patch = [...state.bank, event.a];
    if (event.kind === 14) state.bend = event.a + event.b * 128;
    if (event.kind !== 11) continue;
    state.cc.set(event.a, event.b);
    if (event.a === 0 || event.a === 32) state.bank[event.a === 0 ? 0 : 1] = event.b;
    if (event.a >= 98 && event.a <= 101) {
      state.registered = event.a >= 100; (state.registered ? state.rpn : state.nrpn)[event.a % 2 ? 0 : 1] = event.b;
    }
    if (event.a === 6 || event.a === 38) {
      const selector = state.registered ? state.rpn : state.nrpn, key = `${state.registered ? 'rpn' : 'nrpn'}:${selector[0] * 128 + selector[1]}`;
      const before = state.parameters.get(key) ?? 0;
      state.parameters.set(key, event.a === 6 ? event.b * 128 + (before & 127) : (before & 16256) + event.b);
    }
  }
  return state;
};

test('notes mode reflects complete key intervals without changing source, attacks, ports or velocities', () => {
  const input = midi([[[0, 192, 16], [1, 144, 60, 91], [2, 128, 60, 22], [3, 144, 65, 72], [5, 128, 65, 44]], [[0, 255, 33, 1, 2], [2, 153, 36, 100], [2.5, 137, 36, 33]]]);
  const source = parseMidi(input), snapshot = structuredClone(source), result = reverseMidiAnalysis(source);
  assert.deepEqual(source, snapshot); assert.equal(result.durationBeats, 8); assert.equal(result.analysis.durationBeats, 8);
  assert.deepEqual(notes(result.analysis), [[3, 2, 65, 72, 0], [5.5, .5, 36, 100, 41], [6, 1, 60, 91, 0]]);
  assert.deepEqual(result.analysis.events.filter(event => event.kind === 8).map(event => event.b), [44, 33, 22]);
  assert.equal(result.analysis.channels.find(channel => channel.channel === 0).program, 16);
  assert.deepEqual(notes(parseMidi(result.buffer)), notes(result.analysis));
  assert.deepEqual(notes(reverseMidiAnalysis(result.analysis).analysis), notes(source));
});

test('notes mode retains only each channel setup before its first attack and prevents stuck pedals', () => {
  const result = reverseMidiAnalysis(midi([[[0, 192, 16], [0, 176, 10, 22], [0, 176, 64, 127], [1, 144, 60, 100], [2, 176, 10, 99], [3, 192, 80], [4, 128, 60, 0], [7, 176, 64, 0]]]));
  assert.deepEqual(notes(result.analysis), [[4, 3, 60, 100, 0]]);
  assert.equal(readState(result.analysis, 0).patch[2], 16);
  assert.deepEqual(cc(result.analysis, 10), [[0, 22]]);
  assert.ok(cc(result.analysis, 64).every(([, value]) => value === 0));
  assert.ok(result.warnings.some(value => /ignores later automation/.test(value)));
});

test('controller mode undoes pan, expression, bend and pressure at mirrored state boundaries', () => {
  const result = reverseMidiAnalysis(midi([[[0, 176, 10, 20], [0, 144, 60, 100], [2, 176, 10, 90], [3, 176, 11, 40], [4, 224, 0, 80], [5, 208, 80], [6, 176, 10, 50], [7, 128, 60, 0], [8, 176, 10, 64]]]), { mode: 'controllers' });
  assert.deepEqual(cc(result.analysis, 10), [[0, 50], [2, 90], [6, 20]], 'terminal reset must not replace the last audible state');
  assert.deepEqual(cc(result.analysis, 11), [[0, 40], [5, 127]]);
  assert.equal(readState(result.analysis, 0).bend, 10240); assert.equal(readState(result.analysis, 4).bend, 8192);
  assert.deepEqual(result.analysis.events.filter(event => event.kind === 13).map(event => [event.beat, event.a]), [[0, 80], [3, 0]]);
  const twice = reverseMidiAnalysis(result.analysis, { mode: 'controllers' }).analysis;
  assert.deepEqual(cc(twice, 10), [[0, 20], [2, 90], [6, 50]]);
});

test('bank/program transactions retain their latched bank when pending bank selection changes later', () => {
  const source = midi([[[0, 176, 0, 1], [0, 176, 32, 2], [0, 192, 20], [0, 144, 60, 100], [2, 176, 0, 3], [2, 176, 32, 4], [3, 192, 80], [4, 176, 0, 7], [7, 128, 60, 0]]]);
  const result = reverseMidiAnalysis(source, { mode: 'controllers' });
  assert.deepEqual(readState(result.analysis, 0).patch, [3, 4, 80]);
  assert.deepEqual(readState(result.analysis, 5).patch, [1, 2, 20]);
  const state = buildMidiStateHistories(parseMidi(source)).get(0);
  assert.deepEqual(state.lanes.get('patch').current, [3, 4, 80]); assert.deepEqual(state.lanes.get('bank').current, [7, 4]);
});

test('controller mode bakes sustain, including combined pedal holds and channel all-notes-off', () => {
  const source = parseMidi(midi([[[0, 176, 64, 127], [1, 144, 60, 100], [2, 128, 60, 0], [3, 144, 62, 80], [4, 176, 123, 0], [6, 176, 64, 0], [7, 128, 62, 0]]]));
  const gates = getMidiNoteGates(source); assert.deepEqual(gates.map(note => [note.start / 960, note.keyEnd / 960, note.end / 960]), [[1, 2, 6], [3, 4, 6]]);
  const result = reverseMidiAnalysis(source, { mode: 'controllers' });
  assert.deepEqual(notes(result.analysis), [[2, 5, 60, 100, 0], [2, 3, 62, 80, 0]]);
  assert.ok(cc(result.analysis, 64).every(([, value]) => value === 0)); assert.ok(result.warnings.some(value => /holds were written/.test(value)));
});

test('sostenuto captures keys already down, while later keys release normally', () => {
  const source = midi([[[0, 144, 60, 70], [1, 176, 66, 127], [2, 144, 64, 80], [3, 128, 60, 0], [4, 128, 64, 0], [6, 176, 66, 0]]]);
  const result = reverseMidiAnalysis(source, { mode: 'controllers' });
  assert.deepEqual(notes(result.analysis), [[2, 6, 60, 70, 0], [4, 2, 64, 80, 0]]);
  assert.ok(cc(result.analysis, 66).every(([, value]) => value === 0));
});

test('reset controllers releases pedals and restores RP-015 performance values while retaining patch, volume, pan and parameters', () => {
  const source = midi([[[0, 176, 7, 77], [0, 176, 10, 22], [0, 176, 11, 40], [0, 224, 0, 70], [0, 176, 64, 127], [0, 176, 101, 0], [0, 176, 100, 0], [0, 176, 6, 12], [0, 144, 60, 100], [2, 128, 60, 0], [4, 176, 121, 0]]]);
  const result = reverseMidiAnalysis(source, { mode: 'controllers' });
  assert.deepEqual(notes(result.analysis), [[4, 4, 60, 100, 0]]);
  assert.equal(readState(result.analysis, 0).cc.get(7), 77); assert.equal(readState(result.analysis, 0).cc.get(10), 22);
  assert.equal(readState(result.analysis, 0).cc.get(11), 127); assert.equal(readState(result.analysis, 4).cc.get(11), 40);
  assert.equal(readState(result.analysis, 0).parameters.get('rpn:0'), 12 * 128);
  assert.equal(readState(result.analysis, 4).bend, 70 * 128);
});

test('all sound off truncates a sounding hold instead of resurrecting it to end-of-file', () => {
  const result = reverseMidiAnalysis(midi([[[0, 176, 64, 127], [0, 144, 60, 100], [1, 128, 60, 0], [3, 176, 120, 0]]]), { mode: 'controllers' });
  assert.deepEqual(notes(result.analysis), [[5, 3, 60, 100, 0]]);
});

test('overlapping repeated pitches reverse with FIFO pairing and preserve every attack across source tracks', () => {
  const source = midi([[[0, 144, 60, 30], [4, 128, 60, 1]], [[2, 144, 60, 80], [4, 128, 60, 2]]]);
  const result = reverseMidiAnalysis(source);
  assert.deepEqual(notes(result.analysis), [[4, 4, 60, 30, 0], [4, 2, 60, 80, 0]]);
  assert.equal(result.analysis.noteCount, 2); assert.ok(result.warnings.some(value => /grouped together/.test(value)));
});

test('nested same-pitch sostenuto intervals report FIFO limitations without losing attacks', () => {
  const result = reverseMidiAnalysis(midi([[[0, 144, 60, 30], [1, 176, 66, 127], [2, 128, 60, 0], [3, 144, 60, 80], [4, 128, 60, 0], [6, 176, 66, 0]]]), { mode: 'controllers' });
  assert.equal(result.analysis.noteCount, 2); assert.deepEqual(result.analysis.notes.map(note => note.velocity).sort(), [30, 80]);
  assert.ok(result.warnings.some(value => /individual held lengths/.test(value)));
});

test('RPN absolute and relative values are independently restored with complete selector/data transactions', () => {
  const source = midi([[[0, 176, 101, 0], [0, 176, 100, 0], [0, 176, 6, 12], [0, 144, 60, 100], [2, 176, 6, 24], [3, 176, 96, 0], [4, 176, 100, 1], [4, 176, 6, 70], [4, 176, 38, 3], [7, 128, 60, 0]]]);
  const result = reverseMidiAnalysis(source, { mode: 'controllers' });
  assert.equal(readState(result.analysis, 0).parameters.get('rpn:0'), 24 * 128 + 1);
  assert.equal(readState(result.analysis, 0).parameters.get('rpn:1'), 70 * 128 + 3);
  assert.equal(readState(result.analysis, 4).parameters.get('rpn:1'), 8192);
  assert.equal(readState(result.analysis, 5).parameters.get('rpn:0'), 24 * 128);
  assert.equal(readState(result.analysis, 6).parameters.get('rpn:0'), 12 * 128);
  assert.deepEqual(readState(result.analysis, 6).rpn, [127, 127]);
  const lane = buildMidiStateHistories(parseMidi(source)).get(0).lanes.get('rpn:0');
  assert.deepEqual(midiStateMessages(lane, 256).slice(0, 4), [[11, 101, 0], [11, 100, 0], [11, 6, 2], [11, 38, 0]]);
});

test('unknown NRPN defaults and relative semantics are disclosed, absolute values retained', () => {
  const result = reverseMidiAnalysis(midi([[[0, 144, 60, 100], [1, 176, 99, 5], [1, 176, 98, 9], [1, 176, 6, 64], [1, 176, 38, 1], [2, 176, 6, 70], [3, 176, 96, 0], [7, 128, 60, 0]]]), { mode: 'controllers' });
  assert.equal(readState(result.analysis, 0).parameters.get('nrpn:649'), 70 * 128 + 1);
  assert.equal(readState(result.analysis, 6).parameters.get('nrpn:649'), 64 * 128 + 1);
  assert.ok(result.warnings.some(value => /defaults are unknown/.test(value))); assert.ok(result.warnings.some(value => /increment size/.test(value)));
});

test('tempo, meter and key state maps mirror; named tracks and byte metadata survive export', () => {
  const input = midi([[[0, 255, 3, 4, 84, 101, 115, 116], [0, 255, 81, 3, 7, 161, 32], [0, 255, 88, 4, 4, 2, 24, 8], [0, 255, 89, 2, 0, 0], [0, 144, 60, 100], [2, 255, 81, 3, 15, 66, 64], [3, 255, 88, 4, 3, 2, 24, 8], [4, 255, 89, 2, 255, 1], [5, 255, 5, 3, 104, 101, 121], [7, 128, 60, 0]]]);
  const result = reverseMidiAnalysis(input, { mode: 'controllers' }), source = parseMidi(input);
  assert.deepEqual(result.analysis.tempoMap.map(({ beat, bpm }) => [beat, bpm]), [[0, 60], [6, 120]]);
  assert.deepEqual(result.analysis.meterMap.map(({ beat, numerator }) => [beat, numerator]), [[0, 3], [5, 4]]);
  assert.deepEqual(result.analysis.keyMap.map(({ beat, label }) => [beat, label]), [[0, 'D minor'], [4, 'C major']]);
  assert.equal(result.analysis.durationSeconds, source.durationSeconds); assert.equal(result.analysis.tracks[1].name, 'Test');
  assert.ok(new TextDecoder().decode(result.buffer).includes('hey'));
});

test('typed byte slices and changing source ports export unchanged MIDI channel identities', () => {
  const input = midi([[[0, 255, 33, 1, 3], [0, 144, 60, 100], [2, 128, 60, 0], [3, 255, 33, 1, 0], [3, 144, 64, 90], [4, 128, 64, 0]]]);
  const bytes = new Uint8Array(input.byteLength + 20); bytes.set(new Uint8Array(input), 7);
  const result = reverseMidiAnalysis(bytes.subarray(7, 7 + input.byteLength));
  assert.deepEqual(notes(result.analysis), [[4, 1, 64, 90, 0], [6, 2, 60, 100, 48]]);
});

test('missing note-offs become bounded releases; unsupported SysEx produces an explicit warning', () => {
  const result = reverseMidiAnalysis(midi([[[0, 240, 3, 1, 2, 247], [1, 144, 60, 100]]]));
  assert.deepEqual(notes(result.analysis), [[0, 7, 60, 100, 0]]); assert.ok(result.analysis.events.some(event => event.kind === 8 && event.beat === 7));
  assert.ok(result.warnings.some(value => /SysEx is omitted/.test(value)));
  assert.throws(() => reverseMidiAnalysis(result.analysis, { mode: 'bad' }), /Choose Notes/);
});

test('dense input retains every attack and rejects rewritten bounds explicitly', () => {
  const events = []; for (let i = 0; i < 12000; i++) { events.push([i / 960, 144, i % 128, 1 + i % 127], [(i + 120) / 960, 128, i % 128, 0]); }
  const source = parseMidi(midi([events], 16)), result = reverseMidiAnalysis(source, { mode: 'controllers' });
  assert.equal(result.analysis.noteCount, 12000); assert.ok(result.analysis.notes.every(note => note.duration > 0));
  const before = source.trackCount; source.trackCount = MIDI_MIXER_LIMITS.tracks;
  assert.throws(() => reverseMidiAnalysis(source), /too many tracks/); source.trackCount = before;
});
