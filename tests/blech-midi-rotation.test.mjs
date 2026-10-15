import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateMidiStamp, transformMidiStamp } from '../src/instruments/midi-mixer/midi-mixer-score-transform.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { MATH_PRESETS, encodeMath } from '../src/instruments/blech-midi/blech-midi-math.js';
import { MIXER_SAMPLE_STAMPS, mixerStampScore } from '../src/instruments/midi-mixer/midi-mixer-performance-score.js';

function midi(tracks, end = 8, ppq = 960) {
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
  const chunks = tracks.map(messages => {
    const data = []; let tick = 0;
    for (const [beat, ...message] of [...messages].sort((a, b) => a[0] - b[0]).concat([[end, 255, 47, 0]])) {
      const next = Math.round(beat * ppq); data.push(...vlq(next - tick), ...message); tick = next;
    }
    const chunk = new Uint8Array(data.length + 8);
    chunk.set([77, 84, 114, 107]); new DataView(chunk.buffer).setUint32(4, data.length); chunk.set(data, 8); return chunk;
  });
  const output = new Uint8Array(14 + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  output.set([77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0, 0, tracks.length, ppq >> 8, ppq & 255]);
  let cursor = 14; for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output.buffer;
}
const hit = (beat, pitch, duration = 1, velocity = 100, channel = 0) => [[beat, 144 | channel, pitch, velocity], [beat + duration, 128 | channel, pitch, 23]];
const positions = score => score.analysis.notes.map(({ beat, note, velocity, channel, duration }) => [beat, note, velocity, channel, duration]);
const controls = analysis => analysis.events.filter(event => event.kind !== 8 && event.kind !== 9).map(({ beat, kind, channel, a, b }) => ({ beat, kind, channel, a, b }));
function sysexTimeline(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), result = [];
  let cursor = 8 + view.getUint32(4);
  const vlq = () => { let value = 0, byte; do { byte = bytes[cursor++]; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
  for (let track = 0; track < view.getUint16(10); track++) {
    const end = cursor + 8 + view.getUint32(cursor + 4); cursor += 8;
    let tick = 0, port = 0, running = 0;
    while (cursor < end) {
      tick += vlq(); let status = bytes[cursor];
      if (status < 128) status = running; else cursor++;
      if (status === 255) {
        running = 0; const type = bytes[cursor++], length = vlq();
        if (type === 33) port = bytes[cursor];
        cursor += length;
      } else if (status === 240 || status === 247) {
        running = 0; const length = vlq();
        result.push({ beat: tick / view.getUint16(12), port, status, payload: [...bytes.subarray(cursor, cursor + length)] }); cursor += length;
      } else { running = status; cursor += [12, 13].includes(status >> 4) ? 1 : 2; }
    }
  }
  return result;
}
function assertComplete(before, result) {
  assert.equal(result.analysis.noteCount, before.noteCount);
  assert.deepEqual(result.analysis.notes.map(note => [note.channel, note.velocity]).sort(), before.notes.map(note => [note.channel, note.velocity]).sort());
  assert.ok(result.analysis.notes.every(note => note.note >= 0 && note.note <= 127 && Number.isInteger(note.note)));
  assert.ok(result.analysis.notes.every(note => note.beat >= 0 && note.duration > 0 && note.beat + note.duration <= result.heightBeats + 1e-9));
  assert.equal(result.analysis.durationBeats, result.heightBeats);
}

test('zero, full turns and invalid angles preserve exact bytes; zero-angle resizing uses the established transform', () => {
  const original = midi([[[0, 240, 3, 1, 2, 247], ...hit(0, 60), ...hit(3, 72)]]);
  for (const angle of [0, 360, -720, NaN, Infinity, -Infinity, 'invalid']) {
    assert.deepEqual(rotateMidiStamp(original, { rotationDegrees: angle }).buffer, original);
  }
  const wrapped = new Uint8Array(original.byteLength + 9); wrapped.set(new Uint8Array(original), 4);
  assert.deepEqual(rotateMidiStamp(wrapped.subarray(4, 4 + original.byteLength)).buffer, original);
  assert.deepEqual(rotateMidiStamp({ buffer: original }).buffer, original);
  assert.deepEqual(rotateMidiStamp(original, { pitchWidth: 48, heightBeats: 16 }).buffer,
    transformMidiStamp(original, { pitchWidth: 48, timeScale: 2 }).buffer);
});

test('90 degrees turns a chord into a pitch-centered time sequence with audible positive final gate', () => {
  const original = midi([[...hit(0, 60, 1, 30), ...hit(0, 64, 1, 70), ...hit(0, 68, 1, 110)]]);
  const result = rotateMidiStamp(original, { rotationDegrees: 90 });
  assert.deepEqual(positions(result), [[0, 64, 30, 0, 1], [3.75, 64, 70, 0, 1], [7.5, 64, 110, 0, .5]]);
  assert.equal(result.pitchLow, 60); assert.equal(result.pitchHigh, 68);
  assertComplete(parseMidi(original), result);
  assert.deepEqual(result.buffer, rotateMidiStamp(original, { rotationDegrees: 450 }).buffer);
  assert.deepEqual(result.buffer, rotateMidiStamp(original, { rotationDegrees: 90 }).buffer);
});

test('180 degrees reverses both temporal and pitch contours while retaining velocity and channel identity', () => {
  const original = midi([[...hit(0, 60, 1, 30, 2), ...hit(2, 64, 1, 70, 4), ...hit(6, 68, 1, 110, 9)]]);
  const result = rotateMidiStamp(original, { rotationDegrees: 180 });
  assert.deepEqual(positions(result), [[0, 60, 110, 9, 1], [5, 64, 70, 4, 1], [7.5, 68, 30, 2, .5]]);
  assertComplete(parseMidi(original), result);
});

test('a one-pitch temporal line becomes a chord; width and height are independent output dimensions', () => {
  const original = midi([[...hit(0, 60, 1, 30), ...hit(2, 60, 1, 70), ...hit(4, 60, 1, 110)]]);
  const natural = rotateMidiStamp(original, { rotationDegrees: 90 });
  assert.equal(natural.pitchWidth, 128);
  assert.deepEqual(natural.analysis.notes.map(note => note.note), [127, 64, 0]);
  assert.equal(new Set(natural.analysis.notes.map(note => note.beat)).size, 1);
  const narrow = rotateMidiStamp(original, { rotationDegrees: 90, pitchWidth: 25, heightBeats: 4 });
  assert.deepEqual(positions(narrow), [[1.875, 84, 30, 0, .5], [1.875, 72, 70, 0, .5], [1.875, 60, 110, 0, .5]]);
  const taller = rotateMidiStamp(original, { rotationDegrees: 90, pitchWidth: 25, heightBeats: 16 });
  assert.deepEqual(taller.analysis.notes.map(note => note.note), narrow.analysis.notes.map(note => note.note));
  assert.deepEqual(taller.analysis.notes.map(note => note.beat), narrow.analysis.notes.map(note => note.beat * 4));
  assertComplete(parseMidi(original), natural); assertComplete(parseMidi(original), narrow); assertComplete(parseMidi(original), taller);
});

test('negative angles wrap, low-PPQ sources gain precision, and a diagonal is not stretched into false edge piles', () => {
  const original = midi([[...hit(0, 0, 1, 30), ...hit(2, 32, 1, 50), ...hit(4, 64, 1, 70), ...hit(6, 96, 1, 90)]], 8, 24);
  assert.deepEqual(rotateMidiStamp(original, { rotationDegrees: -90 }).buffer, rotateMidiStamp(original, { rotationDegrees: 270 }).buffer);
  const line = rotateMidiStamp(original, { rotationDegrees: 45, pitchWidth: 128 });
  assert.equal(line.analysis.ppq, 960);
  assert.deepEqual(line.analysis.notes.map(note => note.note), [64, 64, 64, 64]);
  const oblique = rotateMidiStamp(original, { rotationDegrees: 23, pitchWidth: 128 });
  assert.deepEqual(oblique.analysis.notes.map(note => note.note), [0, 42, 85, 127]);
  assertComplete(parseMidi(original), line); assertComplete(parseMidi(original), oblique);
});

test('controllers, metadata and SysEx retain their source timeline scaled to height; moved notes keep their MIDI ports', () => {
  const sysex = [240, 5, 125, 1, 2, 3, 247], name = [255, 3, 4, 84, 101, 115, 116];
  const original = midi([[
    [0, ...name], [0, 255, 81, 3, 7, 161, 32], [0, 255, 88, 4, 7, 3, 24, 8], [0, 255, 89, 2, 1, 0],
    [0, 255, 33, 1, 2], [0, 192, 48], [0, 176, 64, 127], ...hit(0, 60, 1, 30),
    [2, ...sysex], [2, 224, 10, 65], [3, 255, 33, 1, 3], [3, 176, 10, 96],
    ...hit(4, 72, 1, 90), [5, 160, 72, 61], [6, 255, 81, 3, 15, 66, 64], [7, 176, 64, 0],
  ], [...hit(1, 36, .5, 100, 9)]]);
  const before = parseMidi(original), copy = original.slice(0);
  const result = rotateMidiStamp(original, { rotationDegrees: 180, heightBeats: 16 });
  assert.deepEqual(controls(result.analysis), controls(before).map(event => ({ ...event, beat: event.beat * 2 })));
  assert.deepEqual(result.analysis.tempoMap, before.tempoMap.map(event => ({ ...event, beat: event.beat * 2 })));
  assert.deepEqual(result.analysis.meterMap, before.meterMap.map(event => ({ ...event, beat: event.beat * 2 })));
  assert.deepEqual(result.analysis.keyMap, before.keyMap.map(event => ({ ...event, beat: event.beat * 2 })));
  assert.ok(Buffer.from(result.buffer).includes(Buffer.from(sysex)));
  assert.ok(Buffer.from(result.buffer).includes(Buffer.from(name)));
  assert.deepEqual(sysexTimeline(result.buffer), sysexTimeline(original).map(event => ({ ...event, beat: event.beat * 2 })), 'moved notes cannot reroute SysEx to a different MIDI port');
  assert.deepEqual(original, copy, 'the reusable source score stays untouched');
  assertComplete(before, result);
  assert.deepEqual(result.analysis.notes.map(note => [note.channel, note.velocity]).sort(), [[9, 100], [32, 30], [48, 90]].sort());
});

test('rotation retains running-status attacks, supplies missing releases and discards orphan releases safely', () => {
  const original = midi([[[0, 144, 60, 40], [1, 64, 80], [2, 128, 60, 31], [3, 128, 90, 0]]]);
  const result = rotateMidiStamp(original, { rotationDegrees: 37 });
  assertComplete(parseMidi(original), result);
  assert.ok(result.warnings.some(warning => /Missing note-offs/.test(warning)));
  assert.equal(result.analysis.events.filter(event => event.kind === 8).length, 2);
});

test('dense rotations preserve every attack and positive FIFO-safe gate even when pitches merge', () => {
  const events = [];
  for (let index = 0; index < 2048; index++) events.push(...hit((index % 256) / 64, index % 128, .25 + (index % 7) / 8, 1 + index % 127, index % 4));
  const original = midi([events]), before = parseMidi(original);
  for (const angle of [1, 45, 90, 137, 180, 270, 359.999]) {
    const result = rotateMidiStamp(original, { rotationDegrees: angle, pitchWidth: 1, heightBeats: .25 });
    assertComplete(before, result);
    assert.equal(result.analysis.events.filter(event => event.kind === 8).length, before.noteCount);
  }
});

test('all Math formulas and generated stamps retain complete bounded scores through quarter, half and oblique turns', () => {
  assert.equal(MATH_PRESETS.length, 54);
  const scores = [
    ...MATH_PRESETS.map(preset => [preset.id, encodeMath(preset)]),
    ...MIXER_SAMPLE_STAMPS.map(stamp => [stamp.id, mixerStampScore(stamp.id, { span: 128, density: .8, beats: 8, orientation: 'falling' })]),
    ['dense-formula', encodeMath({ ...MATH_PRESETS[0], samples: 1024, width: 16 })],
  ];
  for (const [name, score] of scores) {
    const before = parseMidi(score.buffer);
    for (const settings of [
      { rotationDegrees: 23, pitchWidth: 128, heightBeats: 8 },
      { rotationDegrees: 90, pitchWidth: 128, heightBeats: 8 },
      { rotationDegrees: 180, pitchWidth: 48, heightBeats: 16 },
      { rotationDegrees: 270, pitchWidth: 96, heightBeats: .25 },
    ]) {
      const rotated = rotateMidiStamp(score, settings);
      try { assertComplete(before, rotated); }
      catch (error) { error.message = `${name} at ${settings.rotationDegrees}°: ${error.message}`; throw error; }
    }
  }
});
