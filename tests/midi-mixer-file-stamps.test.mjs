import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMidiFileStamp } from '../src/instruments/midi-mixer/midi-mixer-file-stamps.js';
import { parseMidi, MIDI_SAMPLE_LIMITS } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { MidiMixerEngine } from '../src/instruments/midi-mixer/midi-mixer-engine.js';

function midi(events, endBeat = 16) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  let tick = 0; const track = [];
  for (const [beat, ...message] of [...events].sort((a, b) => a[0] - b[0]).concat([[endBeat, 255, 47, 0]])) {
    const next = Math.round(beat * 960); track.push(...vlq(next - tick), ...message); tick = next;
  }
  const result = new Uint8Array(22 + track.length), view = new DataView(result.buffer);
  result.set([77, 84, 104, 100]); view.setUint32(4, 6); view.setUint16(10, 1); view.setUint16(12, 960);
  result.set([77, 84, 114, 107], 14); view.setUint32(18, track.length); result.set(track, 22); return result.buffer;
}
const notes = (beat, pitches, duration = 0.5, channel = 0) => pitches.flatMap(pitch => [[beat, 0x90 + channel, pitch, 100], [beat + duration, 0x80 + channel, pitch, 0]]);
const messages = analysis => analysis.events.map(event => [event.beat, event.kind, event.a, event.b]);

test('dense auto slices are deterministic and explicit/next slices retain their source ranges', () => {
  const source = midi([...notes(0, [60]), ...notes(4, [60, 64, 67]), ...notes(8, [61, 65]), ...notes(12, [62])]);
  const dense = createMidiFileStamp(source, { beats: 4 });
  assert.equal(dense.sourceStartBeat, 4); assert.equal(dense.sourceEndBeat, 8); assert.equal(dense.noteCount, 3);
  assert.equal(dense.nextStartBeat, 8); assert.deepEqual(dense.buffer, createMidiFileStamp(source, { beats: 4 }).buffer);
  const next = createMidiFileStamp(source, { beats: 4, startBeat: dense.nextStartBeat });
  assert.equal(next.sourceStartBeat, 8); assert.equal(next.noteCount, 2);
  assert.deepEqual(next.buffer, createMidiFileStamp(source, { beats: 4, variant: 1 }).buffer);
  const last = createMidiFileStamp(source, { beats: 4, startBeat: 12 });
  assert.equal(last.nextStartBeat, 0); assert.equal(last.shortened, false);
});

test('whole pictures trim empty margins and uniformly fit notes and controllers to the requested length', () => {
  const score = parseMidi(midi([[0, 0xc0, 81], [3, 0xb0, 7, 99], ...notes(4, [48], 4), ...notes(6, [60], 2), [7, 0xe0, 2, 70]], 12));
  const stamp = createMidiFileStamp(score, { whole: true, fitBeats: 8 });
  assert.equal(stamp.sourceStartBeat, 4); assert.equal(stamp.sourceEndBeat, 8); assert.equal(stamp.scale, 2);
  assert.equal(stamp.durationBeats, 8); assert.equal(stamp.noteCount, 2); assert.equal(stamp.shortened, false);
  assert.deepEqual(stamp.analysis.notes.map(note => [note.beat, note.duration]), [[0, 8], [4, 4]]);
  assert.ok(messages(stamp.analysis).some(([beat, kind]) => kind === 14 && beat === 6));
  assert.equal(stamp.analysis.channels[0].program, 81);
});

test('sustain-held keys released before a cut are reconstructed under the original pedal state', () => {
  const source = midi([[0, 0xc0, 16], [0, 0xb0, 64, 127], ...notes(1, [60], 1), ...notes(3, [64], 4), [6, 0xb0, 64, 0]], 8);
  const stamp = createMidiFileStamp(source, { startBeat: 4, beats: 4 });
  assert.equal(stamp.restoredNoteCount, 2); assert.equal(stamp.sustainedNoteCount, 1); assert.equal(stamp.noteCount, 2);
  const events = stamp.analysis.events, held = events.findIndex(event => event.kind === 9 && event.a === 60);
  assert.ok(events.slice(0, held).some(event => event.kind === 11 && event.a === 64 && event.b === 127));
  assert.ok(events.some(event => event.kind === 8 && event.a === 60 && event.beat === 0));
  assert.ok(events.some(event => event.kind === 11 && event.a === 64 && event.b === 0 && event.beat === 2));
  assert.equal(stamp.analysis.notes.find(note => note.note === 64).duration, 3);
  const afterPedal = createMidiFileStamp(source, { startBeat: 6, beats: 1 });
  assert.equal(afterPedal.noteCount, 1, 'released pedal tails are not resurrected');
  const clipped = createMidiFileStamp(source, { startBeat: 4, beats: 1 });
  assert.equal(clipped.analysis.events.at(-1).a, 123);
  assert.ok(clipped.analysis.notes.every(note => note.beat + note.duration <= clipped.durationBeats));
});

test('pre-roll compacts bends but preserves patch banks, RPN state, pending bank and in-range controllers', () => {
  const events = [[0, 0xb0, 0, 1], [0, 0xb0, 32, 2], [0, 0xc0, 80], [1, 0xb0, 0, 3], [1, 0xb0, 101, 0], [1, 0xb0, 100, 0], [1, 0xb0, 6, 12], [2, 0xb0, 101, 127], [2, 0xb0, 100, 127]];
  for (let index = 0; index < 10000; index++) events.push([index / 10000 * 3, 0xe0, index % 128, 64]);
  events.push(...notes(3, [60], 4), [5, 0xb0, 10, 100]);
  const stamp = createMidiFileStamp(midi(events, 8), { startBeat: 4, beats: 2 });
  assert.equal(stamp.analysis.events.filter(event => event.kind === 14).length, 1);
  let bank = 0, patchBank, rpn = [127, 127], range, program;
  for (const event of stamp.analysis.events.filter(event => event.beat === 0)) {
    if (event.kind === 12) { program = event.a; patchBank = bank; }
    if (event.kind === 11 && event.a === 0) bank = event.b;
    if (event.kind === 11 && event.a === 101) rpn[0] = event.b;
    if (event.kind === 11 && event.a === 100) rpn[1] = event.b;
    if (event.kind === 11 && event.a === 6 && rpn[0] === 0 && rpn[1] === 0) range = event.b;
  }
  assert.equal(program, 80); assert.equal(patchBank, 1); assert.equal(bank, 3); assert.equal(range, 12); assert.deepEqual(rpn, [127, 127]);
  assert.ok(stamp.analysis.events.some(event => event.kind === 11 && event.a === 10 && event.b === 100 && event.beat === 1));
});

test('transpose shifts the entire melodic range by one legal interval and leaves percussion unchanged', () => {
  const score = midi([...notes(0, [4, 120], 1), ...notes(0, [36], 1, 9)]);
  const up = createMidiFileStamp(score, { whole: true, transpose: 36 });
  assert.equal(up.requestedTranspose, 36); assert.equal(up.effectiveTranspose, 7);
  assert.deepEqual(up.analysis.notes.filter(note => note.channel === 0).map(note => note.note), [11, 127]);
  assert.equal(up.analysis.notes.find(note => note.channel === 9).note, 36);
  const down = createMidiFileStamp(score, { whole: true, transpose: -36 });
  assert.equal(down.effectiveTranspose, -4); assert.deepEqual(down.analysis.notes.filter(note => note.channel === 0).map(note => note.note), [0, 116]);
});

test('sample bounds shorten time windows without silently thinning notes and reject impossible instants', () => {
  const events = [];
  for (let beat = 0; beat < 40; beat++) for (let index = 0; index < 1000; index++) events.push(...notes(beat, [index % 128], 0.25));
  const score = parseMidi(midi(events, 40)), stamp = createMidiFileStamp(score, { startBeat: 0, beats: 40 });
  assert.equal(stamp.shortened, true); assert.ok(stamp.warnings.some(warning => /shortened/.test(warning)));
  assert.equal(stamp.noteCount, score.notes.filter(note => note.beat < stamp.sourceEndBeat).length);
  assert.equal(stamp.noteCount, stamp.analysis.noteCount); assert.ok(stamp.noteCount <= MIDI_SAMPLE_LIMITS.notes);
  const impossible = midi(Array.from({ length: 32769 }, (_, index) => notes(0, [index % 128], 1)).flat(), 1);
  assert.throws(() => createMidiFileStamp(impossible, { whole: true }), /too dense.*no notes were removed/);
});

test('all 28 bundled black/geometric files produce playable excerpts; all nine patterns retain every note at 4/8/32 beats', async () => {
  const collection = JSON.parse(await readFile(new URL('../assets/midiphoria/collection.json', import.meta.url), 'utf8'));
  const files = collection.filter(file => /Black MIDI|Geometric/.test(file.collection));
  assert.equal(files.length, 28);
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => 0 } } });
  let patterns = 0;
  try {
    for (const file of files) {
      const score = parseMidi(await readFile(new URL(`../assets/midiphoria/${file.file}`, import.meta.url)));
      const whole = file.collection === 'Geometric patterns'; if (whole) patterns++;
      for (const beats of whole ? [4, 8, 32] : [4, 8, 16]) {
        const stamp = createMidiFileStamp(score, { whole, fitBeats: whole ? beats : undefined, beats, name: file.title });
        assert.equal(stamp.shortened, false, file.id); assert.equal(stamp.noteCount, stamp.analysis.noteCount, file.id);
        assert.ok(stamp.buffer.byteLength <= MIDI_SAMPLE_LIMITS.fileBytes); assert.ok(stamp.channelCount <= 16);
        assert.ok(stamp.analysis.notes.every(note => note.beat + note.duration <= stamp.durationBeats + 1e-8), file.id);
        if (whole) { assert.equal(stamp.noteCount, score.noteCount, file.id); assert.equal(stamp.durationBeats, beats, file.id); }
        const playing = engine.triggerSample(stamp.buffer, { program: null }); assert.equal(playing.program, null); assert.equal(playing.analysis.noteCount, stamp.noteCount);
      }
    }
    assert.equal(patterns, 9); assert.equal(engine.state.audioEnabled, false); assert.equal(engine.context, null);
  } finally { await engine.dispose(); }
});
