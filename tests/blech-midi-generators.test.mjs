import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMidiExpression, mathArtwork, encodeMath, MATH_PRESETS, MATH_LIMITS } from '../src/instruments/blech-midi/blech-midi-math.js';
import { MidiFrameSequence, snapshotMidiFrame, FRAME_LIMITS } from '../src/instruments/blech-midi/blech-midi-frames.js';
import { encodeArtwork } from '../src/instruments/blech-midi/blech-midi-art.js';
import { generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';

const source = () => ({ notes: [{ note: 0, beat: 0, duration: 1, velocity: 96 }, { note: 127, beat: 3, duration: 1, velocity: 80 }], durationBeats: 4 });

test('expression grammar evaluates arithmetic with conventional exponent and unary precedence', () => {
  for (const [expression, expected] of [['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-2^2', -4], ['(-2)^2', 4], ['2^-2', .25], ['min(3, 2)+max(5,4)', 7], ['1e-3+2e-3', .003], ['sin(pi/2)+cos(tau)', 2], ['abs(-3)+sqrt(4)+floor(2.9)', 7]]) assert.equal(compileMidiExpression(expression)(0), expected, expression);
  assert.equal(compileMidiExpression('x*x+1')(3), 10);
  assert.equal(compileMidiExpression('t/2', 't')(6), 3);
});

test('expression language rejects executable syntax, unknown names, arity mistakes and unbounded input', () => {
  for (const expression of ['globalThis', 'x.constructor', 'sin.constructor(1)', 'alert(1)', 'x=3', 'x[0]', 'x;1', '2x', 'Math.sin(x)', 'sin()', 'min(1)', 'sin(1,2)', '2+', '(2+3', '1e999', 'x'.repeat(257), '('.repeat(26) + '1' + ')'.repeat(26)]) assert.throws(() => compileMidiExpression(expression), undefined, expression);
  assert.throws(() => compileMidiExpression('t'));
  assert.throws(() => compileMidiExpression('x', 'constructor'));
});

test('every math preset creates deterministic, distinct, correctly counted MIDI without mutating options', () => {
  const signatures = new Set();
  for (const preset of MATH_PRESETS) {
    const options = structuredClone(preset), before = structuredClone(options), result = mathArtwork(options), score = encodeMath(options, 150);
    assert.deepEqual(mathArtwork(options), result); assert.deepEqual(options, before);
    assert.ok(result.notes.length > 100, preset.name);
    assert.equal(score.analysis.noteCount, result.notes.length); assert.equal(score.analysis.durationBeats, 8); assert.equal(score.analysis.initialTempo, 150);
    assert.ok(score.analysis.notes.every(n => n.note >= 0 && n.note <= 127 && n.duration > 0 && n.beat >= 0 && n.beat + n.duration <= 8 + 1 / 960));
    signatures.add(JSON.stringify(result.notes));
  }
  assert.equal(signatures.size, MATH_PRESETS.length);
});

test('math timing, pitch range, thickness, velocity and gate change the encoded notes', () => {
  const ramp = { equation: 'x', domainMin: -1, domainMax: 1, low: 0, high: 127, samples: 8, beats: 4, width: 1, velocity: 40, gate: .5 };
  const narrow = mathArtwork(ramp), broad = mathArtwork({ ...ramp, width: 5, gate: 1, beats: 8, velocity: 100 });
  assert.equal(narrow.notes[0].note, 0); assert.equal(narrow.notes.at(-1).note, 127);
  assert.equal(narrow.notes[1].beat, .5); assert.equal(narrow.notes[1].duration, .25);
  assert.ok(broad.notes.length > narrow.notes.length);
  assert.ok(broad.notes.every(n => n.velocity === 100));
  assert.equal(broad.durationBeats, 8);
  const restricted = mathArtwork({ ...ramp, low: 60, high: 72 });
  assert.equal(restricted.notes[0].note, 60); assert.equal(restricted.notes.at(-1).note, 72);
});

test('parametric traversal can overlap in time and never emits invalid or duplicate attacks', () => {
  const artwork = mathArtwork({ ...MATH_PRESETS[3], samples: 1024, width: 16 });
  assert.ok(artwork.notes.length <= MATH_LIMITS.notes);
  assert.equal(new Set(artwork.notes.map(n => `${n.note}:${n.beat}`)).size, artwork.notes.length);
  assert.ok(new Set(artwork.notes.map(n => n.beat)).size < artwork.notes.length);
  assert.ok(artwork.notes.every(n => n.duration > 0 && Number.isFinite(n.beat)));
});

test('nonfinite/outside samples are omitted; invalid bounds and all-empty output cannot be dropped', () => {
  const empty = mathArtwork({ equation: 'sqrt(-1)' }); assert.equal(empty.notes.length, 0); assert.equal(empty.skipped, empty.samples);
  assert.throws(() => encodeMath({ equation: '1/0' }), /No notes/);
  assert.throws(() => mathArtwork({ domainMin: 1, domainMax: 1 }), /minimum/);
  assert.throws(() => mathArtwork({ low: 127, high: 0 }), /Highest pitch/);
  assert.throws(() => mathArtwork({ yMin: NaN }), /minimum/);
  assert.ok(mathArtwork({ samples: 100000000, width: 100000 }).notes.length <= MATH_LIMITS.notes);
});

test('frame capture and duplicate are immutable copies, including externally returned frame records', () => {
  const frames = new MidiFrameSequence(), input = source(); frames.capture(input, 'First'); frames.duplicate(0);
  input.notes[0].note = 99; const publicCopy = frames.frames; publicCopy[0].notes[0].note = 88; publicCopy[1].name = 'Changed';
  assert.deepEqual(frames.frames.map(frame => frame.notes[0].note), [0, 0]);
  assert.deepEqual(frames.frames.map(frame => frame.name), ['First', 'First']);
});

test('frames compile in sequence at the shared tempo with exact frame lengths and full note range', () => {
  const frames = new MidiFrameSequence(); frames.capture(source(), 'One'); frames.blank(); frames.capture(source(), 'Two');
  const score = frames.score(2, 150);
  assert.equal(score.analysis.noteCount, 4); assert.equal(score.analysis.durationBeats, 6); assert.equal(score.analysis.initialTempo, 150);
  assert.deepEqual(score.analysis.notes.map(n => [n.note, n.beat, n.duration]), [[0, 0, .5], [127, 1.5, .5], [0, 4, .5], [127, 5.5, .5]]);
  assert.equal(frames.artwork(.25).durationBeats, .75);
});

test('raw drawing MIDI is parsed in beats rather than confusing seconds with the frame timeline', () => {
  const drawing = generateGridMidi([[1, 0], [0, 1]], { secondsPerRow: .5, lowestNote: 0 });
  const snapshot = snapshotMidiFrame(drawing);
  assert.equal(snapshot.notes.length, 2); assert.ok(snapshot.notes.every(n => Number.isFinite(n.beat)));
  const frames = new MidiFrameSequence(); frames.capture(drawing); assert.equal(frames.score(2).analysis.durationBeats, 2);
});

test('frame order and deletion are explicit, bounded and preserve remaining notes', () => {
  const frames = new MidiFrameSequence(); frames.capture(source(), 'One'); frames.blank(); frames.capture(source(), 'Two');
  assert.equal(frames.move(2, -1), 1); assert.deepEqual(frames.frames.map(f => f.name), ['One', 'Two', 'Rest']);
  assert.equal(frames.remove(1), 1); assert.deepEqual(frames.frames.map(f => f.name), ['One', 'Rest']);
  assert.equal(frames.move(0, -1), 0); assert.equal(frames.move(1, 1), 1); frames.clear(); assert.equal(frames.count, 0);
  assert.throws(() => frames.score(), /Capture/); assert.throws(() => frames.duplicate(0), /Choose/);
});

test('frame and total note limits are enforced without partially mutating the prepared sequence', () => {
  const frames = new MidiFrameSequence(); for (let i = 0; i < 8; i++) frames.capture(source());
  assert.throws(() => frames.capture(source()), /eight/); assert.throws(() => frames.duplicate(0), /eight/); assert.equal(frames.count, FRAME_LIMITS.count);
  assert.throws(() => frames.score(0), /beats/); assert.throws(() => frames.score(17), /beats/);
  const dense = new MidiFrameSequence(), frame = { ...source(), notes: Array.from({ length: 16385 }, (_, i) => ({ note: i % 128, beat: 0, duration: 1, velocity: 96 })) };
  dense.capture(frame); assert.throws(() => dense.capture(frame), /32,768/); assert.equal(dense.count, 1);
  const invalid = source(); invalid.notes[0].duration = Infinity; assert.throws(() => snapshotMidiFrame(invalid), /invalid/);
  assert.throws(() => snapshotMidiFrame({ notes: [] }), /Prepare/);
});

test('a prepared score is detached from later frame edits and remains a valid replayable MIDI', () => {
  const frames = new MidiFrameSequence(); frames.capture(encodeArtwork(source().notes, { durationBeats: 4 }));
  const original = frames.score(4), bytes = original.buffer.slice(0); frames.duplicate(0); frames.remove(0); frames.clear();
  assert.deepEqual(original.buffer, bytes); assert.equal(original.analysis.noteCount, 2); assert.equal(original.analysis.durationBeats, 4);
});
