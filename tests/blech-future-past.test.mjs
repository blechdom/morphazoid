import test from 'node:test';
import assert from 'node:assert/strict';
import { blackMidiTimeGeometry, blackMidiNoteSegment } from '../src/instruments/blech-midi/blech-midi-black-renderer.js';
import { createBlechNoteHistory, BLECH_HISTORY_LIMIT } from '../src/instruments/blech-midi/blech-midi-note-history.js';
import { createBlechLiveProjector } from '../src/instruments/blech-midi/blech-midi-live-score.js';
import { MidiAutomataClock } from '../src/instruments/midi-mixer/midi-mixer-automata.js';

const note = (beat, duration, pitch = 60) => ({ beat, duration, note: pitch, velocity: 100, channel: 0, track: 0 });
const sample = (extra = {}) => ({ id: 1, slot: 0, sync: true, loop: true, cycle: 0, positionBeats: 1, gain: 1, midi: {},
  analysis: { notes: [note(0, .1), note(.2, .1, 72), note(1, 1, 80)], durationBeats: 4, tempoMap: [{ beat: 0, bpm: 120 }] }, ...extra });
const state = (samples, sampleTime = .5, extra = {}) => ({ samples, sampleTime, tempo: 120, ...extra });

test('future falls into the present and past exits at the identical pixels-per-second velocity', () => {
  const geometry = blackMidiTimeGeometry({}, 500);
  assert.ok(Math.abs(geometry.keyboardTop - .56) < 1e-12); assert.ok(Math.abs(geometry.keyboardBottom - .64) < 1e-12);
  const future = blackMidiNoteSegment(1, 2, geometry), past = blackMidiNoteSegment(-2, -1, geometry, true);
  assert.ok(Math.abs(future.height - past.height) < 1e-12);
  assert.ok(Math.abs((geometry.keyboardTop - future.top) - (past.top + past.height - geometry.keyboardBottom)) < 1e-12);
  assert.equal(blackMidiNoteSegment(-2, -1, geometry), null);
  assert.equal(blackMidiNoteSegment(1, 2, geometry, true), null);
});

test('crossing gate is split at the keyboard and trails fade/clamp without changing pitch lanes', () => {
  const geometry = blackMidiTimeGeometry({}, 500);
  const future = blackMidiNoteSegment(-.5, 1, geometry), past = blackMidiNoteSegment(-.5, 1, geometry, true);
  assert.equal(future.top + future.height, geometry.keyboardTop);
  assert.equal(past.top, geometry.keyboardBottom);
  assert.ok(past.brightness > blackMidiNoteSegment(-3, -2, geometry, true).brightness);
  assert.equal(blackMidiNoteSegment(-5, -4, geometry, true), null);
  assert.equal(blackMidiNoteSegment(-1, 0, { ...geometry, pastSeconds: 0 }, true), null);
  assert.equal(blackMidiNoteSegment(-Infinity, 2, geometry), null);
});

test('keyboard keeps a readable bounded band on laptop and small screens', () => {
  for (const height of [150, 240, 470, 900]) {
    const geometry = blackMidiTimeGeometry({}, height), size = (geometry.keyboardBottom - geometry.keyboardTop) * height;
    assert.ok(size >= 18 - 1e-10 && size <= 42 + 1e-10);
    assert.ok(geometry.keyboardTop > 0 && geometry.keyboardBottom < 1);
  }
});

test('short sample gates between display frames are recovered from the score without future-history leakage', () => {
  const project = createBlechLiveProjector();
  const result = project(state([sample()]), { pastSeconds: 4 });
  assert.deepEqual(result.pastNotes.map(item => item.pitch).sort(), [60, 72]);
  assert.ok(result.pastNotes.every(item => item.start < 0 && item.end <= 0));
  assert.ok(result.notes.some(item => item.pitch === 80));
});

test('stopped and naturally completed pad gates keep fading; future gates disappear immediately', () => {
  const project = createBlechLiveProjector();
  project(state([sample({ positionBeats: 1.5 })], .75), { pastSeconds: 4 });
  const stopped = project(state([], 1), { pastSeconds: 4 });
  assert.equal(stopped.notes.length, 0);
  assert.ok(stopped.pastNotes.some(item => item.pitch === 80 && item.end === 0));
  const later = project(state([], 2), { pastSeconds: 4 });
  assert.ok(later.pastNotes.every(item => item.end < 0));
  assert.equal(project(state([], 6), { pastSeconds: 4 }).pastNotes.length, 0);
});

test('loop cycles keep distinct historical gates instead of stretching old attacks', () => {
  const project = createBlechLiveProjector(), first = sample();
  project(state([first]), { pastSeconds: 4 });
  const result = project(state([{ ...first, cycle: 1 }], 2.5), { pastSeconds: 4 });
  const gates = result.pastNotes.filter(item => item.pitch === 60);
  assert.equal(gates.length, 2);
  assert.equal(new Set(gates.map(item => item.id)).size, 2);
  assert.ok(Math.abs(gates[0].start - gates[1].start) === 2);
});

test('live transpose edits do not recolor/rewrite the already played pitches', () => {
  const project = createBlechLiveProjector(), first = sample();
  const before = project(state([first]), { pastSeconds: 4 });
  const after = project(state([{ ...first, positionBeats: 1.2, revision: 1, midi: { transpose: 12 } }], .6), { pastSeconds: 4 });
  assert.ok(after.pastNotes.some(item => item.pitch === 60));
  assert.ok(!after.pastNotes.some(item => item.pitch === 72 && item.start < -.59));
  assert.equal(before.pastNotes.find(item => item.pitch === 60).start - .1, after.pastNotes.find(item => item.pitch === 60).start);
  assert.ok(after.notes.some(item => item.pitch === 92));
});

test('Automata uses actual evolved rows in the past and retains them after pause', () => {
  const clock = new MidiAutomataClock(); clock.configure({ columns: 8, lowestNote: 60, rowBeats: .25, rule: 30 }); clock.setPlaying(true);
  clock.advance(2, 120);
  const snapshot = clock.snapshot(), project = createBlechLiveProjector();
  const running = project(state([], 1, { automata: snapshot }), { pastSeconds: 4 });
  const expected = new Set(snapshot.history.flatMap(row => row.row.flatMap((cell, column) => cell ? [row.lowestNote + column] : [])));
  assert.ok(running.pastNotes.length > 0);
  assert.ok(running.pastNotes.every(item => expected.has(item.pitch) && item.end <= 0));
  clock.setPlaying(false);
  const paused = project(state([], 2, { automata: clock.snapshot() }), { pastSeconds: 4 });
  assert.equal(paused.notes.length, 0); assert.ok(paused.pastNotes.length > 0);
  assert.ok(paused.pastNotes.every(item => item.end < 0));
});

test('history handles clock resets, disabled trails, pruning and a hard memory cap', () => {
  const history = createBlechNoteHistory();
  const candidates = Array.from({ length: BLECH_HISTORY_LIMIT + 20 }, (_, index) => ({ id: String(index), source: 'test', pitch: index % 128, start: -.5, end: .5 }));
  history.update(candidates, 1); assert.equal(history.size, BLECH_HISTORY_LIMIT);
  history.update([], 1.2); assert.equal(history.size, BLECH_HISTORY_LIMIT);
  history.update([], 8); assert.equal(history.size, 0);
  history.update(candidates.slice(0, 2), 9); history.update([], 0); assert.equal(history.size, 0);
  history.update(candidates.slice(0, 2), 1); history.update([], 2, { seconds: 0 }); assert.equal(history.size, 0);
});


test('resuming Automata makes a new performed segment and never replays pre-pause history', () => {
  const clock = new MidiAutomataClock(); clock.configure({ columns: 8, lowestNote: 60, rowBeats: 4, rule: 30 }); clock.setPlaying(true);
  clock.advance(.5, 120);
  const project = createBlechLiveProjector();
  const before = project(state([], .25, { automata: clock.snapshot() }), { pastSeconds: 4 });
  clock.setPlaying(false); project(state([], .3, { automata: clock.snapshot() }), { pastSeconds: 4 });
  clock.setPlaying(true); clock.advance(.5, 120);
  const resumed = project(state([], 1.25, { automata: clock.snapshot() }), { pastSeconds: 4 });
  // First observation after a resume cannot infer the time of the click; the
  // resumed row starts at its current observed beat, never at the old attack.
  clock.advance(.5, 120);
  const advanced = project(state([], 1.5, { automata: clock.snapshot() }), { pastSeconds: 4 });
  assert.ok(advanced.pastNotes.some(item => item.id !== before.pastNotes[0].id && item.start >= -.25 && item.end === 0));
  assert.ok(resumed.pastNotes.every(item => item.id === before.pastNotes[0].id));
  clock.setPlaying(false); project(state([], 1.6, { automata: clock.snapshot() }), { pastSeconds: 4 });
  project(state([], 8, { automata: clock.snapshot() }), { pastSeconds: 4 });
  clock.setPlaying(true); clock.advance(.1, 120);
  assert.equal(project(state([], 8.1, { automata: clock.snapshot() }), { pastSeconds: 4 }).pastNotes.length, 0);
  clock.advance(.1, 120);
  assert.ok(project(state([], 8.15, { automata: clock.snapshot() }), { pastSeconds: 4 }).pastNotes.every(item => item.start >= -.05 - 1e-10));
});


test('global note-effect edits preserve held note families and apply to later attacks', () => {
  const project = createBlechLiveProjector();
  const source = sample({ analysis: { notes: [note(0, 4), note(2, 1, 80)], durationBeats: 4, tempoMap: [{ beat: 0, bpm: 120 }] }, loop: false });
  project(state([source], .5), { pastSeconds: 4 });
  const after = project(state([{ ...source, positionBeats: 1.2 }], .6, { noteEffects: { enabled: true, transpose: 12 } }), { pastSeconds: 4 });
  assert.ok(after.notes.some(item => item.pitch === 60 && item.start < 0));
  assert.ok(!after.notes.some(item => item.pitch === 72));
  assert.ok(after.notes.some(item => item.pitch === 92 && item.start > 0));
  assert.ok(after.pastNotes.some(item => item.pitch === 60 && item.end === 0));
  assert.ok(!after.pastNotes.some(item => item.pitch === 72));
});


test('clock-confirmed completion recovers final subframe gates but explicit stop does not', () => {
  const source = sample({ loop: false, positionBeats: .9,
    analysis: { notes: [note(.95, .04)], durationBeats: 1, tempoMap: [{ beat: 0, bpm: 120 }] } });
  const stopped = createBlechLiveProjector(), completed = createBlechLiveProjector();
  for (const project of [stopped, completed]) project(state([source], .45), { pastSeconds: 4 });
  assert.equal(stopped(state([], .51), { pastSeconds: 4 }).pastNotes.length, 0);
  const result = completed(state([], .51, { finishedSamples: [{ ...source, ended: true, positionBeats: 1, finishedAt: .5, tempo: 120 }] }), { pastSeconds: 4 });
  assert.equal(result.notes.length, 0); assert.equal(result.pastNotes.length, 1);
  assert.equal(result.sources.length, 0); assert.equal(result.pastNotes[0].pitch, 60);
  assert.ok(Math.abs(result.pastNotes[0].start - -.035) < 1e-12);
  assert.ok(Math.abs(result.pastNotes[0].end - -.015) < 1e-12);
});
