import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlechLiveProjector, BLECH_LIVE_NOTE_LIMIT, BLECH_AUTOMATA_ROW_LIMIT } from '../src/instruments/blech-midi/blech-midi-live-score.js';
import { MidiAutomataClock } from '../src/instruments/midi-mixer/midi-mixer-automata.js';

const note = (beat, duration, pitch = 60) => ({ beat, duration, note: pitch, velocity: 100, channel: 0, track: 0 });
const sample = (notes = [note(0, 1), note(3, 1, 72)], extra = {}) => ({ id: 1, slot: 0, sync: true, loop: true, cycle: 0, positionBeats: .5, gain: .8, midi: {},
  analysis: { notes, durationBeats: 4, tempoMap: [{ beat: 0, bpm: 120 }], ...extra.analysis }, ...extra });
const state = (samples, extra = {}) => ({ tempo: 120, samples, ...extra });
const sorted = result => result.notes.toSorted((a, b) => a.start - b.start || a.pitch - b.pitch);

test('reseeding splits a held visual gate while retaining its earlier performed notes', () => {
  const clock = new MidiAutomataClock(), project = createBlechLiveProjector();
  clock.configure({ columns: 8, lowestNote: 60, rule: 204, articulation: 'hold', rowBeats: .25 });
  clock.setPlaying(true); clock.advance(.5);
  const before = project(state([], { automata: clock.snapshot() }), { now: .25, lookAhead: 1, pastSeconds: 4 });
  const old = before.notes.find(item => item.pitch === 64);
  clock.configure({ seedRow: [1, 0, 0, 0, 1, 0, 0, 0] }); clock.reseed();
  const after = project(state([], { automata: clock.snapshot() }), { now: .25, lookAhead: 1, pastSeconds: 4 });
  const current = after.notes.find(item => item.pitch === 64);
  assert.equal(current.start, 0); assert.notEqual(current.id, old.id);
  assert.ok(after.pastNotes.some(item => item.pitch === 64 && item.start < 0));
  assert.ok(after.notes.some(item => item.pitch === 60));
});
const coordinates = result => sorted(result).map(({ pitch, start, end }) => [pitch, start, end]);

test('full live scores project held and upcoming notes, including successive loop cycles', () => {
  const result = createBlechLiveProjector()(state([sample()]), { lookAhead: 4 });
  assert.deepEqual(coordinates(result), [[60, -.25, .25], [72, 1.25, 1.75], [60, 1.75, 2.25], [72, 3.25, 3.75], [60, 3.75, 4.25]]);
  assert.equal(result.held, 1); assert.deepEqual(result.sources, ['sample:1']);
});

test('each pad clock advances independently of the file transport and other layers', () => {
  const project = createBlechLiveProjector();
  const first = sample(), second = sample([note(1, 2, 80)], { id: 2, slot: 1, positionBeats: 1.5 });
  const before = project(state([first, second], { playing: false, beat: 0 }), { lookAhead: 1 });
  const after = project(state([{ ...first, positionBeats: 1 }, { ...second, positionBeats: 2 }], { playing: false, beat: 0 }), { lookAhead: 1 });
  assert.equal(before.held, 2); assert.equal(after.held, 1);
  assert.ok(after.notes.find(item => item.source === 'sample:2' && item.start === -.5));
});

test('free-time samples preserve changing source tempo, synced samples use the shared tempo', () => {
  const notes = [note(3, 1)], analysis = { notes, durationBeats: 4, tempoMap: [{ beat: 0, bpm: 120 }, { beat: 2, bpm: 60 }] };
  const project = createBlechLiveProjector(), current = sample(notes, { positionBeats: 1.5, loop: false, analysis });
  assert.deepEqual(coordinates(project(state([current]), { lookAhead: 3 })), [[60, .75, 1.25]]);
  assert.deepEqual(coordinates(project(state([{ ...current, sync: false }]), { lookAhead: 3 })), [[60, 1.25, 2.25]]);
  assert.deepEqual(coordinates(project(state([{ ...current, sync: false, loop: true }]), { lookAhead: 5 })), [[60, 1.25, 2.25], [60, 4.25, 5.25]]);
});

test('loop-off finishes one pass and stopping removes the complete live projection', () => {
  const project = createBlechLiveProjector();
  assert.equal(project(state([sample([], { analysis: { notes: [note(0, 1)], durationBeats: 4 }, loop: false })]), { lookAhead: 12 }).notes.length, 1);
  assert.deepEqual(project(state([])).notes, []);
  assert.deepEqual(project(state([sample(undefined, { pending: true })])).notes, []);
});

test('a source gate is clipped at the loop boundary instead of sounding across its release', () => {
  const result = createBlechLiveProjector()(state([sample([note(3, 5)], { loop: false, positionBeats: 3.5 })]));
  assert.deepEqual(coordinates(result), [[60, -.25, .25]]);
});

test('live pitch, chord, gate and echo parameters have corresponding visible notes', () => {
  const result = createBlechLiveProjector()(state([sample([note(2, 2)], { loop: false, positionBeats: 0, midi: { transpose: 2 } })], {
    noteEffects: { enabled: true, transpose: 12, chord: 'fifth', delayBeats: .5, gateBeats: .5, echoCount: 1, echoBeats: 1 },
  }));
  assert.deepEqual(coordinates(result), [[74, 1.25, 1.5], [81, 1.25, 1.5], [74, 1.75, 2], [81, 1.75, 2]]);
});

test('muted and out-of-range voices do not create false live keyboard hits', () => {
  const project = createBlechLiveProjector();
  for (const extra of [{ gain: 0 }, { midi: { controllers: { 7: 0 } } }, { midi: { controllers: { 11: 0 } } }, { midi: { transpose: 80 } }]) {
    assert.equal(project(state([sample(undefined, extra)])).notes.length, 0);
  }
});

test('automata forecasts match actual source-clock gates without changing that clock', () => {
  const clock = new MidiAutomataClock();
  clock.configure({ columns: 8, lowestNote: 60, rowBeats: .25, rule: 30, articulation: 'hold' }); clock.setPlaying(true);
  const snapshot = clock.snapshot(), preserved = structuredClone(snapshot);
  const result = createBlechLiveProjector()(state([], { automata: snapshot }), { lookAhead: 1 });
  clock.advance(2.25, 120);
  const expected = clock.snapshot(true).notes.filter(item => item.startBeat <= 2).map(item => [item.note, item.startBeat / 2, (item.endBeat ?? 2.25) / 2]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.deepEqual(coordinates(result), expected);
  assert.deepEqual(snapshot, preserved);
  assert.ok(result.notes.some(item => item.start > 0)); assert.equal(result.held, 1);
});

test('automata keeps current row settings until the next boundary and pause removes it', () => {
  const clock = new MidiAutomataClock(); clock.configure({ columns: 8, lowestNote: 60, rowBeats: .25 }); clock.setPlaying(true);
  clock.advance(.125); clock.configure({ lowestNote: 80 });
  const project = createBlechLiveProjector(), snapshot = clock.snapshot();
  const result = project(state([], { automata: snapshot }), { lookAhead: 1 });
  assert.ok(result.notes.some(item => item.pitch < 80 && item.start < 0));
  assert.ok(result.notes.some(item => item.pitch >= 80 && item.start > 0));
  clock.setPlaying(false);
  assert.equal(project(state([], { automata: clock.snapshot() })).notes.length, 0);
});

test('dense samples share a bounded display budget so one pad cannot hide another', () => {
  const notes = Array.from({ length: 32768 }, (_, index) => note(index / 8192, .25, index % 128));
  const result = createBlechLiveProjector()(state([sample(notes), sample(notes, { id: 2, slot: 1 })]), { limit: 100 });
  assert.equal(result.notes.length, 100); assert.equal(result.truncated, true);
  assert.equal(result.notes.filter(item => item.source === 'sample:1').length, 50);
  assert.equal(result.notes.filter(item => item.source === 'sample:2').length, 50);
  assert.ok(result.scanned <= 400);
});

test('pathological short loops and long automata forecasts cannot allocate unbounded visuals', () => {
  const project = createBlechLiveProjector();
  const result = project(state([sample([note(0, 1 / 15360)], { positionBeats: 0, analysis: { notes: [note(0, 1 / 15360)], durationBeats: 1 / 15360 } })]), { lookAhead: 60 });
  assert.equal(result.truncated, true); assert.ok(result.notes.length <= BLECH_LIVE_NOTE_LIMIT);
  const clock = new MidiAutomataClock(); clock.configure({ columns: 128, lowestNote: 0, rowBeats: .125, rule: 255 }); clock.setPlaying(true);
  const dense = project(state([], { tempo: 300, automata: clock.snapshot() }), { lookAhead: 60 });
  assert.equal(dense.truncated, true); assert.ok(dense.notes.length <= BLECH_LIVE_NOTE_LIMIT);
  assert.ok(dense.scanned <= BLECH_AUTOMATA_ROW_LIMIT * 128);
});

test('paused samples claim no held notes or forecast budget while other clocks keep playing', () => {
  const notes = Array.from({ length: 100 }, (_, index) => note(index / 25, 1, index % 128));
  const running = sample(notes, { id: 4, slot: 3 });
  const paused = [1, 2, 3].map(id => sample(notes, { id, slot: id - 1, paused: true }));
  const project = createBlechLiveProjector();
  const alone = project(state([running]), { limit: 100 });
  const together = project(state([...paused, running]), { limit: 100 });
  assert.deepEqual(together, alone);
  assert.deepEqual(together.sources, ['sample:4']);
  assert.ok(together.held > 0);
});

test('resumed free-time samples chase from frozen phase across source tempo and loop changes', () => {
  const project = createBlechLiveProjector();
  const source = sample([note(0, .25), note(1, 3, 72)], { sync: false, positionBeats: 2.5, cycle: 3,
    analysis: { notes: [note(0, .25), note(1, 3, 72)], durationBeats: 4, tempoMap: [{ beat: 0, bpm: 120 }, { beat: 2, bpm: 60 }] } });
  project(state([source]), { now: 10, pastSeconds: 4, lookAhead: 1 });
  project(state([{ ...source, paused: true }]), { now: 10.1, pastSeconds: 4, lookAhead: 1 });
  const resumed = project(state([{ ...source, playbackEpoch: 1, resumedPositionBeats: 2.5, resumedCycle: 3 }]), { now: 15, pastSeconds: 4, lookAhead: 1 });
  assert.deepEqual(coordinates(resumed), [[72, 0, 1.5]]);
  assert.equal(resumed.pastNotes.length, 0);
  const advanced = project(state([{ ...source, positionBeats: 3, playbackEpoch: 1, resumedPositionBeats: 2.5, resumedCycle: 3 }]), { now: 15.5, pastSeconds: 4, lookAhead: 2 });
  assert.deepEqual(coordinates(advanced), [[72, -.5, 1], [60, 1, 1.125], [72, 1.5, 4]]);
  assert.equal(advanced.pastNotes.length, 1);
  assert.equal(advanced.pastNotes[0].start, -.5);
});

test('resuming a held gate applies current effects without replaying canceled prior echoes', () => {
  const project = createBlechLiveProjector();
  const source = sample([note(0, .1), note(.5, 2, 72)], { loop: false, positionBeats: 1 });
  project(state([source], { noteEffects: { enabled: true, echoCount: 1, echoBeats: 2 } }), { now: .5, pastSeconds: 4 });
  project(state([{ ...source, paused: true }]), { now: .6, pastSeconds: 4 });
  const resumed = project(state([{ ...source, playbackEpoch: 1, resumedPositionBeats: 1, resumedCycle: 0 }], {
    noteEffects: { enabled: true, transpose: 12, echoCount: 1, echoBeats: 2 },
  }), { now: 3, pastSeconds: 4 });
  assert.deepEqual(coordinates(resumed), [[84, 0, .75], [84, 1, 1.75]]);
  assert.ok(resumed.pastNotes.every(item => item.pitch !== 84));
});
