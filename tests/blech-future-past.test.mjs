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
  assert.ok(Math.abs(geometry.keyboardTop - .74) < 1e-12); assert.ok(Math.abs(geometry.keyboardBottom - .82) < 1e-12);
  const future = blackMidiNoteSegment(.5, 1, geometry), past = blackMidiNoteSegment(-1, -.5, geometry, true);
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
  assert.ok(past.brightness > blackMidiNoteSegment(-1, -.5, geometry, true).brightness);
  assert.equal(blackMidiNoteSegment(-5, -4, geometry, true), null);
  assert.equal(blackMidiNoteSegment(-1, 0, { ...geometry, pastSeconds: 0 }, true), null);
  assert.equal(blackMidiNoteSegment(-Infinity, 2, geometry), null);
});

test('keyboard keeps a readable bounded band on laptop and small screens', () => {
  for (const height of [150, 240, 470, 900]) {
    const geometry = blackMidiTimeGeometry({}, height), size = (geometry.keyboardBottom - geometry.keyboardTop) * height;
    assert.ok(size >= 18 - 1e-10 && size <= 42 + 1e-10);
    assert.ok(geometry.keyboardTop > 0 && geometry.keyboardBottom < 1);
    const former = blackMidiTimeGeometry({ keyboardPosition: .6 }, height);
    const historyRatio = (1 - geometry.keyboardBottom) / (1 - former.keyboardBottom);
    assert.ok(historyRatio > .45 && historyRatio < .55, 'default history is about half as tall');
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


test('Automata Hold carries the original effect family through row boundaries', () => {
  const clock = new MidiAutomataClock(); clock.configure({ columns: 8, lowestNote: 60, rowBeats: .25, rule: 255, articulation: 'hold' }); clock.setPlaying(true);
  clock.advance(.125, 120);
  const heldPitch = clock.snapshot(true).notes[0].note, project = createBlechLiveProjector();
  project(state([], .0625, { automata: clock.snapshot() }), { pastSeconds: 4 });
  // Change effects while the initial cell is held. Rule255 preserves it while
  // introducing seven new source attacks at the next row.
  project(state([], .0625, { automata: clock.snapshot(), noteEffects: { enabled: true, transpose: 12 } }), { pastSeconds: 4 });
  clock.advance(.25, 120);
  const result = project(state([], .1875, { automata: clock.snapshot(), noteEffects: { enabled: true, transpose: 12 } }), { pastSeconds: 4 });
  assert.ok(result.notes.some(item => item.pitch === heldPitch && item.start < 0));
  assert.ok(!result.notes.some(item => item.pitch === heldPitch + 12 && item.start <= 0));
  assert.ok(result.pastNotes.some(item => item.pitch === heldPitch && item.end === 0));
  assert.ok(!result.pastNotes.some(item => item.pitch === heldPitch + 12));
  assert.ok(result.notes.some(item => item.pitch >= 72 && item.pitch !== heldPitch + 12));
});


test('Automata can start, restart and change tempo before its first tempo-history entry', () => {
  const clock = new MidiAutomataClock(), project = createBlechLiveProjector();
  clock.setPlaying(true);
  assert.deepEqual(clock.snapshot().tempos, []);
  for (const tempo of [120, 240]) {
    const result = project(state([], 0, { tempo, automata: clock.snapshot() }), { pastSeconds: 4 });
    assert.ok(result.notes.length > 0);
    assert.ok(result.notes.every(item => Number.isFinite(item.start) && Number.isFinite(item.end)));
    assert.equal(result.pastNotes.length, 0);
  }
  clock.advance(.25, 240); project(state([], .0625, { tempo: 240, automata: clock.snapshot() }), { pastSeconds: 4 });
  clock.restart();
  const restarted = project(state([], .0625, { tempo: 240, automata: clock.snapshot() }), { pastSeconds: 4 });
  assert.ok(restarted.notes.every(item => Number.isFinite(item.start) && Number.isFinite(item.end)));
});

test('pausing one live layer releases its history while another layer and Automata keep advancing', () => {
  const clock = new MidiAutomataClock(); clock.configure({ columns: 8, lowestNote: 90, rowBeats: 4 }); clock.setPlaying(true);
  clock.advance(1.5, 120);
  const project = createBlechLiveProjector(), first = sample({ positionBeats: 1.5 }), second = sample({ id: 2, slot: 1, positionBeats: 1.5 });
  project(state([first, second], .75, { automata: clock.snapshot(), playing: true, beat: 7 }), { pastSeconds: 4 });
  clock.advance(.5, 120);
  const paused = project(state([{ ...first, paused: true }, { ...second, positionBeats: 2 }], 1, { automata: clock.snapshot(), playing: true, beat: 7.5 }), { pastSeconds: 4 });
  assert.deepEqual(paused.sources, ['sample:2', 'automata']);
  assert.ok(paused.pastNotes.some(item => item.source === 'sample:1' && item.pitch === 80 && item.end === 0));
  assert.ok(paused.notes.some(item => item.source === 'sample:2'));
  assert.ok(paused.notes.some(item => item.source === 'automata'));
  clock.advance(2, 120);
  const later = project(state([{ ...first, paused: true }, { ...second, positionBeats: 0, cycle: 1 }], 2, { automata: clock.snapshot(), playing: true, beat: 9.5 }), { pastSeconds: 4 });
  assert.ok(later.pastNotes.filter(item => item.source === 'sample:1').every(item => item.end <= -1));
});

test('resumed layer history starts at its frozen beat and never reconnects across the pause', () => {
  const project = createBlechLiveProjector(), source = sample({ positionBeats: 1.5 });
  const before = project(state([source], .75), { pastSeconds: 4 });
  project(state([{ ...source, paused: true }], 1), { pastSeconds: 4 });
  const resumedSource = { ...source, playbackEpoch: 1, resumedPositionBeats: 1.5, resumedCycle: 0 };
  const resumed = project(state([resumedSource], 3), { pastSeconds: 4 });
  const oldId = before.pastNotes.find(item => item.pitch === 80).id;
  assert.ok(resumed.notes.some(item => item.pitch === 80 && item.start === 0));
  assert.ok(resumed.pastNotes.every(item => before.pastNotes.some(old => old.id === item.id)));
  const advanced = project(state([{ ...resumedSource, positionBeats: 1.75 }], 3.125), { pastSeconds: 4 });
  const samePitch = advanced.pastNotes.filter(item => item.pitch === 80);
  assert.equal(samePitch.length, 2);
  assert.equal(samePitch.find(item => item.id === oldId).end, -2.125);
  assert.equal(samePitch.find(item => item.id !== oldId).start, -.125);
  assert.equal(samePitch.find(item => item.id !== oldId).end, 0);
});

test('resume metadata prevents old attacks from entering history when the first frame arrives after resume', () => {
  const project = createBlechLiveProjector();
  const resumed = sample({ positionBeats: 1.75, playbackEpoch: 1, resumedPositionBeats: 1.5, resumedCycle: 0 });
  const result = project(state([resumed], 20), { pastSeconds: 4 });
  assert.equal(result.pastNotes.length, 1);
  assert.equal(result.pastNotes[0].pitch, 80);
  assert.equal(result.pastNotes[0].start, -.125);
});

test('completion after resume retains its performed gates without replaying the earlier pass', () => {
  const project = createBlechLiveProjector(), source = sample({ loop: false, positionBeats: 1.5 });
  project(state([source], .75), { pastSeconds: 4 });
  project(state([{ ...source, paused: true }], 1), { pastSeconds: 4 });
  const resumed = { ...source, playbackEpoch: 1, resumedPositionBeats: 1.5, resumedCycle: 0 };
  project(state([resumed], 10), { pastSeconds: 4 });
  const completed = project(state([], 12, { finishedSamples: [{ ...resumed, positionBeats: 4, finishedAt: 11.25, tempo: 120 }] }), { pastSeconds: 4 });
  assert.equal(completed.notes.length, 0);
  assert.equal(completed.pastNotes.length, 1);
  assert.equal(completed.pastNotes[0].pitch, 80);
  assert.equal(completed.pastNotes[0].start, -2);
  assert.equal(completed.pastNotes[0].end, -1.75);
});

test('a skipped pause frame cannot stretch held history through a silent gap', () => {
  const project = createBlechLiveProjector();
  const source = sample({ positionBeats: 1, analysis: { notes: [note(0, 16)], durationBeats: 16, tempoMap: [{ beat: 0, bpm: 120 }] } });
  const before = project(state([source], .5), { pastSeconds: 4 });
  const resumedSource = { ...source, positionBeats: 2.5, playbackEpoch: 1, resumedPositionBeats: 2, resumedCycle: 0, pausedAt: 1 };
  const resumed = project(state([resumedSource], 3.25), { pastSeconds: 4 });
  assert.equal(resumed.pastNotes.length, 2);
  const old = resumed.pastNotes.find(item => item.id === before.pastNotes[0].id);
  const current = resumed.pastNotes.find(item => item.id !== old.id);
  assert.equal(old.end, -2.25);
  assert.equal(current.start, -.25);
  assert.equal(current.end, 0);
  const next = project(state([{ ...resumedSource, positionBeats: 3 }], 3.5), { pastSeconds: 4 });
  assert.equal(next.pastNotes.find(item => item.id === old.id).end, -2.5);
  assert.equal(next.pastNotes.find(item => item.id === current.id).end, 0);
});

test('paused clock evidence recovers subframe gates and keeps them fixed at their played time', () => {
  const project = createBlechLiveProjector();
  const source = sample({ loop: false, positionBeats: .9,
    analysis: { notes: [note(.95, .04)], durationBeats: 4, tempoMap: [{ beat: 0, bpm: 120 }] } });
  project(state([source], .45), { pastSeconds: 4 });
  const paused = { ...source, paused: true, pausedAt: .5, positionBeats: 1, playbackEpoch: 0 };
  const result = project(state([paused], .6), { pastSeconds: 4 });
  assert.equal(result.notes.length, 0);
  assert.equal(result.pastNotes.length, 1);
  assert.ok(Math.abs(result.pastNotes[0].start + .125) < 1e-12);
  assert.ok(Math.abs(result.pastNotes[0].end + .105) < 1e-12);
  const later = project(state([paused], 1), { pastSeconds: 4 });
  assert.ok(Math.abs(later.pastNotes[0].start + .525) < 1e-12);
  assert.ok(Math.abs(later.pastNotes[0].end + .505) < 1e-12);
  assert.equal(project(state([paused], 5), { pastSeconds: 4 }).pastNotes.length, 0);
});

test('pause telemetry and edits to a paused layer do not duplicate or recolor its performed tail', () => {
  const project = createBlechLiveProjector(), source = sample({ positionBeats: 1.5, revision: 0 });
  const before = project(state([source], .75), { pastSeconds: 4 });
  const paused = { ...source, paused: true, pausedAt: .8, positionBeats: 1.6, revision: 1, playbackEpoch: 0 };
  const first = project(state([paused], .9), { pastSeconds: 4 });
  assert.equal(first.pastNotes.length, before.pastNotes.length);
  assert.deepEqual(first.pastNotes.map(item => item.id), before.pastNotes.map(item => item.id));
  const edited = project(state([{ ...paused, revision: 2, midi: { transpose: 12 } }], 1), { pastSeconds: 4 });
  assert.equal(edited.pastNotes.length, before.pastNotes.length);
  assert.deepEqual(edited.pastNotes.map(item => item.pitch), before.pastNotes.map(item => item.pitch));
  assert.ok(Math.abs(edited.pastNotes.find(item => item.pitch === 80).end + .2) < 1e-12);
});
