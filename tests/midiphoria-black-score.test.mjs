import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlackMidiScore, blackMidiStatistics, queryBlackMidiNotes } from '../src/instruments/midiphoria/midiphoria-black-score.js';
import { blackMidiKeyLayout, blackMidiColor } from '../src/instruments/midiphoria/midiphoria-black-renderer.js';

function vlq(number) { const bytes = [number & 127]; while ((number = Math.floor(number / 128))) bytes.unshift((number & 127) | 128); return bytes; }
const event = (delta, ...bytes) => [...vlq(delta), ...bytes];
function midi(tracks, { division = 480, format = tracks.length > 1 ? 1 : 0 } = {}) {
  const chunks = tracks.map(events => { const bytes = [...events.flat(), 0, 255, 47, 0]; return [77, 84, 114, 107, bytes.length >>> 24, bytes.length >>> 16 & 255, bytes.length >>> 8 & 255, bytes.length & 255, ...bytes]; });
  return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, format, tracks.length >>> 8, tracks.length & 255, division >>> 8, division & 255, ...chunks.flat()]).buffer;
}

test('positive note attacks, FIFO overlaps, zero-velocity releases, track identity and tempo changes stay exact', () => {
  const score = parseBlackMidiScore(midi([
    [event(0, 255, 81, 3, 7, 161, 32), event(480, 255, 81, 3, 15, 66, 64)],
    [event(0, 255, 3, 4, 66, 97, 115, 115), event(0, 144, 64, 90), event(240, 64, 110), event(240, 128, 64, 0), event(480, 144, 64, 0)],
    [event(0, 145, 127, 127), event(480, 129, 127, 0), event(0, 145, 0, 1), event(480, 129, 0, 0)],
  ]));
  assert.equal(score.total, 4); assert.equal(score.duration, 1.5); assert.equal(score.peakPolyphony, 3);
  assert.deepEqual([...score.starts], [0, .25, 0, .5]); assert.deepEqual([...score.ends], [.5, 1.5, .5, 1.5]);
  assert.equal(score.tracks[1].name, 'Bass'); assert.deepEqual(score.tracks[2].channels, [1]);
  assert.deepEqual([...score.pitches], [64, 64, 127, 0]);
  assert.deepEqual(blackMidiStatistics(score, .5), { total: 4, passed: 4, held: 2, notesPerSecond: 4, peakPolyphony: 3, candidateCount: 2 });
  assert.equal(blackMidiStatistics(score, 1.5).held, 0); assert.equal(blackMidiStatistics(score, 0).passed, 2);
});

test('exact-boundary release comes before replacement attack and does not inflate polyphony', () => {
  const score = parseBlackMidiScore(midi([[event(0, 144, 60, 100), event(480, 128, 60, 0), event(0, 144, 60, 100), event(480, 128, 60, 0)]]));
  assert.equal(score.peakPolyphony, 1); assert.equal(blackMidiStatistics(score, .5).held, 1);
  const indexes = []; queryBlackMidiNotes(score, .5, .25, { visit: index => indexes.push(index) });
  assert.deepEqual(indexes, [1]);
});

test('full 128-pitch keyboard has ordered equal lanes and 75 white/53 black piano keys', () => {
  const equal = blackMidiKeyLayout('equal'), piano = blackMidiKeyLayout('piano');
  assert.equal(equal.length, 128); assert.equal(piano.filter(key => !key.black).length, 75);
  assert.equal(piano.filter(key => key.black).length, 53);
  assert.equal(equal[127].x + equal[127].width, 1);
  assert.equal(piano[0].x, 0); assert.equal(piano[127].x + piano[127].width, 1);
  assert.ok(piano.every(key => key.x >= 0 && key.x + key.width <= 1));
});

test('track colors stay stable across pitches and velocities; overrides and alternate mappings work', () => {
  const a = { track: 4, channel: 3, pitch: 0, velocity: 1 }, b = { ...a, pitch: 127, velocity: 127 };
  assert.deepEqual(blackMidiColor(a), blackMidiColor(b));
  assert.notDeepEqual(blackMidiColor(a, { colorBy: 'pitch' }), blackMidiColor(b, { colorBy: 'pitch' }));
  assert.notDeepEqual(blackMidiColor(a, { colorBy: 'velocity' }), blackMidiColor(b, { colorBy: 'velocity' }));
  assert.deepEqual(blackMidiColor(a, { trackColors: { 4: '#ff0080' } }), [1, 0, 128 / 255]);
});

test('interval index finds an old long note after many expired blocks and seeks backwards without stale notes', () => {
  const events = [event(0, 144, 64, 100)];
  for (let index = 0; index < 300; index++) events.push(event(10, 145, index % 128, 100), event(1, 129, index % 128, 0));
  events.push(event(1500, 128, 64, 0));
  const score = parseBlackMidiScore(midi([events]));
  let indexes = []; const late = queryBlackMidiNotes(score, 4, .1, { visit: index => indexes.push(index) });
  assert.deepEqual(indexes, [0]); assert.ok(late.scanned <= 64);
  indexes = []; queryBlackMidiNotes(score, 0, .02, { visit: index => indexes.push(index) }); assert.deepEqual(indexes, [0, 1]);
});

test('display caps and hidden previews never change exact file counts', () => {
  const chord = Array.from({ length: 128 }, (_, pitch) => event(0, 144, pitch, 100));
  chord.push(event(480, 176, 7, 100));
  const score = parseBlackMidiScore(midi([chord, [event(0, 145, 60, 100), event(480, 129, 60, 0)]]));
  const stats = blackMidiStatistics(score, .1, { hiddenTracks: [1] });
  assert.equal(stats.total, 129); assert.equal(stats.held, 129); assert.equal(stats.candidateCount, 128);
  const query = queryBlackMidiNotes(score, .1, 6, { limit: 10, hiddenTracks: [1] }); assert.equal(query.visible, 10);
  assert.equal(score.diagnostics.unclosed, 128); assert.equal(score.diagnostics.thinned, false);
});

test('SMPTE timing including 29.97 fps ignores tempo metadata', () => {
  for (const fps of [24, 25, 29, 30]) {
    const score = parseBlackMidiScore(midi([[event(0, 144, 64, 100), event(1000, 128, 64, 0)]], { division: ((256 - fps) << 8) | 40 }));
    assert.ok(Math.abs(score.duration - 1000 / ((fps === 29 ? 30000 / 1001 : fps) * 40)) < 1e-10);
  }
});

test('invalid files and explicit budgets reject instead of silently thinning', () => {
  const source = midi([[event(0, 144, 60, 100), event(0, 144, 61, 100), event(480, 128, 60, 0)]]);
  assert.throws(() => parseBlackMidiScore(source, { limits: { notes: 1 } }), /not thinned/);
  assert.throws(() => parseBlackMidiScore(source, { limits: { bytes: 16 } }), /up to/);
  assert.throws(() => parseBlackMidiScore(source.slice(0, -1)), /Truncated/);
  assert.throws(() => parseBlackMidiScore(midi([[]], { format: 2 })), /format 2/);
  assert.throws(() => parseBlackMidiScore(midi([[event(0, 60, 100)]])), /running status/);
  assert.throws(() => parseBlackMidiScore(midi([[event(0, 144, 60, 255)]])), /data byte/);
});

test('100,000 simultaneous decorative notes remain indexed above synthesis voice caps', () => {
  const count = 100_000, data = new Uint8Array(14 + 8 + count * 8 + 4), view = new DataView(data.buffer);
  data.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107]); view.setUint32(18, count * 8 + 4);
  for (let index = 0; index < count; index++) data.set([0, 144, index % 128, 100], 22 + index * 4);
  for (let index = 0; index < count; index++) data.set([index ? 0 : 120, 128, index % 128, 0], 22 + count * 4 + index * 4);
  data.set([0, 255, 47, 0], data.length - 4);
  const score = parseBlackMidiScore(data.buffer);
  assert.equal(score.total, count); assert.equal(score.peakPolyphony, count); assert.equal(blackMidiStatistics(score, .1).held, count);
  assert.equal(queryBlackMidiNotes(score, .1).visible, count); assert.equal(blackMidiStatistics(score, .125).held, 0);
});
