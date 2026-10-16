import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock, liveSampleReplacementTiming } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { blechStrokeScore, createBlechSpigotEngine } from '../src/instruments/blech-midi/blech-midi-spigot-engine.js';
import { createBlechLiveProjector } from '../src/instruments/blech-midi/blech-midi-live-score.js';
const note = (pitch, beat = 0, duration = .25) => ({ note: pitch, beat, duration, channel: 0, velocity: 100 });
const score = (pitch = 60, beats = 4) => blechStrokeScore([note(pitch, 0, beats / 2), note(pitch + 7, beats * .75)], beats);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function setup() {
  let now = 0, armed = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { armed++; } } } });
  return { engine, sources: createBlechSpigotEngine({ engine }), at(seconds) { now = seconds * 1000; }, armed: () => armed };
}

test('repeated live edits retain phase, update upcoming notes now and do not inflate generated counts', async () => {
  const q = setup(), layer = q.sources.create(score(), { loop: true });
  q.at(.5); const count = q.engine.state.generatedNoteCount;
  for (let index = 0; index < 16; index++) {
    q.sources.edit(layer.id, { transpose: index % 2 ? 7 : 0, heightBeats: index % 2 ? 2 : 8 });
    const current = q.engine.state.samples[0];
    near(current.positionBeats / current.analysis.durationBeats, .25);
    assert.equal(current.id, layer.sampleId); assert.equal(current.pendingReplacement, undefined);
    assert.equal(q.engine.state.generatedNoteCount, count);
  }
  q.at(1.1); assert.equal(q.engine.state.generatedNoteCount, count + 1);
  assert.equal(q.armed(), 0); await q.engine.dispose();
});

test('live queued edits preserve elapsed waiting and paused edits preserve their frozen phase and silence', async () => {
  const q = setup(), queued = q.sources.create(score(), { delayBeats: 3, loop: true });
  q.at(.5); q.sources.edit(queued.id, { transpose: 5, heightBeats: 2, delayBeats: 2 });
  near(q.engine.state.samples[0].pendingBeats, 1); assert.equal(q.engine.state.generatedNoteCount, 0);
  q.at(1.1); near(q.engine.state.samples[0].positionBeats, .2); assert.equal(q.engine.state.generatedNoteCount, 1);
  q.sources.togglePlay(queued.id); const before = q.engine.state.samples[0];
  q.at(2); q.sources.edit(queued.id, { heightBeats: 8, rotationDegrees: 90 });
  const paused = q.engine.state.samples[0]; near(paused.positionBeats, before.positionBeats * 4);
  assert.equal(paused.paused, true); assert.equal(paused.id, before.id);
  q.at(3); near(q.engine.state.samples[0].positionBeats, paused.positionBeats);
  q.sources.togglePlay(queued.id); q.at(3.25); near(q.engine.state.samples[0].positionBeats, paused.positionBeats + .5);
  assert.equal(q.armed(), 0); await q.engine.dispose();
});

test('live one-shot resizing keeps its remaining fraction and stops once at the resized endpoint', async () => {
  const q = setup(), source = q.sources.create(score(), { loop: false });
  q.at(1.5); near(q.engine.state.samples[0].positionBeats, 3);
  q.sources.edit(source.id, { heightBeats: 1, transpose: 12 });
  near(q.engine.state.samples[0].positionBeats, .75); assert.equal(q.engine.state.samples[0].loop, false);
  q.at(1.7); assert.equal(q.engine.state.samples.length, 0);
  assert.equal(q.sources.getLayers()[0].active, false); assert.equal(q.sources.getLayers()[0].score.analysis.durationBeats, 1);
  await q.engine.dispose();
});

test('live placement moves waiting time without rewinding attacks, including free-time source tempo', () => {
  const old = compileDeck(score().analysis), next = compileDeck(score(72, 8).analysis);
  const timing = { positionBeats: 1, pendingBeats: 0, cycle: 2, ended: false };
  assert.deepEqual(liveSampleReplacementTiming(timing, old, next, { loop: true, delayDelta: 2 }), { positionBeats: 2, pendingBeats: 2, cycle: 2, ended: false });
  assert.deepEqual(liveSampleReplacementTiming({ ...timing, pendingBeats: 2 }, old, next, { loop: true, delayDelta: -3 }), { positionBeats: 3, pendingBeats: 0, cycle: 2, ended: false });
  const free = { ...next, tempoMap: [{ beat: 0, bpm: 60, seconds: 0 }] };
  near(liveSampleReplacementTiming(timing, old, free, { loop: true, sync: false, delayDelta: -2, tempo: 120 }).positionBeats, 3);
  const finished = liveSampleReplacementTiming({ ...timing, positionBeats: 3 }, old, next, { loop: false, delayDelta: -4 });
  assert.equal(finished.ended, true); near(finished.positionBeats, 8);
});

test('audio clock edits chase only current transformed gates and schedule upcoming new notes without restarting siblings', () => {
  const events = [], joins = [], releases = [], clock = new MidiSampleClock({ emit: (source, event) => events.push({ source, event }), rehydrate: (source, notes) => joins.push({ source, notes }), release: source => releases.push(source) });
  clock.load(0, { id: 1, revision: 0, data: compileDeck(score().analysis), startBeat: 0, loop: true, config: { gain: .3 } });
  clock.load(1, { id: 2, revision: 0, data: compileDeck(score(40).analysis), startBeat: 0, loop: true });
  clock.process(24000, 48000, 120); const sibling = clock.samples[1], siblingTiming = { ...sibling.timing }, mark = events.length;
  const next = compileDeck(score(72, 2).analysis);
  clock.replaceScore(0, { data: next, channels: [], token: 1, delayDelta: 0 }, { live: true, revision: 1 });
  near(clock.samples[0].timing.positionBeats, .5); assert.equal(clock.samples[0].id, 1); assert.equal(clock.samples[0].config.gain, .3);
  assert.deepEqual(sibling.timing, siblingTiming); assert.equal(releases.at(-1), 2);
  assert.deepEqual(joins.at(-1).notes.map(event => event.a), [72], 'only the new sustained note is chased');
  clock.process(26400, 48000, 120);
  assert.deepEqual(events.slice(mark).filter(item => item.source === 2 && item.event.kind === 9).map(item => item.event.a), [79]);
  assert.equal(clock.samples[1], sibling); near(sibling.timing.positionBeats, 2.1);
  clock.setPaused(0, true, 2); const paused = { ...clock.samples[0].timing };
  clock.replaceScore(0, { data: compileDeck(score(80, 4).analysis), channels: [], token: 3 }, { live: true, revision: 3 });
  assert.equal(clock.samples[0].paused, true); near(clock.samples[0].timing.positionBeats, paused.positionBeats * 2); assert.equal(joins.at(-1).notes.length, 0);
});

test('a live delay pauses transformed sustains until their new arrival, then resumes without catch-up attacks', () => {
  const joined = [], clock = new MidiSampleClock({ rehydrate: (_source, notes) => joined.push(...notes) });
  clock.load(0, { id: 1, revision: 0, data: compileDeck(score().analysis), startBeat: 0, loop: true });
  clock.process(24000, 48000, 120);
  clock.replaceScore(0, { data: compileDeck(score(72).analysis), channels: [], token: 1, delayDelta: 1 }, { live: true, revision: 1 });
  assert.equal(joined.length, 0); near(clock.samples[0].timing.pendingBeats, 1);
  clock.process(24000, 48000, 120); assert.equal(joined.length, 0);
  clock.process(128, 48000, 120); assert.deepEqual(joined.map(event => event.a), [72]);
  near(clock.samples[0].timing.positionBeats, 1 + 128 / 24000);
});

test('live score forecasts update immediately while old performed notes retain their history and paused edits invent none', async () => {
  const q = setup(), project = createBlechLiveProjector(), layer = q.sources.create(score(), { loop: true });
  q.at(.5); project(q.engine.state, { pastSeconds: 8 });
  q.sources.edit(layer.id, { transpose: 12, heightBeats: 8 });
  const changed = project(q.engine.state, { pastSeconds: 8 });
  assert.ok(changed.notes.some(note => note.pitch === 79 && note.start > 0));
  assert.ok(changed.pastNotes.some(note => note.pitch === 60 && note.end <= 0));
  assert.ok(changed.pastNotes.filter(note => note.pitch === 72).every(note => note.start >= 0));
  q.at(.75); q.sources.togglePlay(layer.id); project(q.engine.state, { pastSeconds: 8 });
  q.at(1); q.sources.edit(layer.id, { transpose: 24 });
  q.at(1.2); q.sources.edit(layer.id, { heightBeats: 4 });
  q.at(1.5); const paused = project(q.engine.state, { pastSeconds: 8 });
  assert.equal(paused.notes.length, 0); assert.ok(!paused.pastNotes.some(note => note.pitch === 84 || note.pitch === 91));
  q.sources.togglePlay(layer.id); q.at(1.6); const resumed = project(q.engine.state, { pastSeconds: 8 });
  assert.ok(resumed.notes.some(note => note.pitch === 84));
  assert.ok(resumed.pastNotes.filter(note => note.pitch === 84).every(note => note.start >= -.1 - 1e-8));
  await q.engine.dispose();
});

test('native live replacement remains audible, clears old pitches and echoes, and preserves unrelated sound', async () => {
  let Processor; const messages = [];
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => messages.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    await processor.command({ type: 'noteEffects', config: { enabled: true, echoCount: 2, echoBeats: 1 } });
    for (let slot = 0; slot < 2; slot++) await processor.command({ type: 'sample', slot, id: slot + 1, revision: 0, data: compileDeck(score(slot ? 40 : 60, 8).analysis), startBeat: 0, gain: .5, program: 16, loop: true, sync: true });
    const render = seconds => { let energy = 0; for (let i = 0; i < Math.ceil(seconds * 48000 / 128); i++) { const channels = [new Float32Array(128), new Float32Array(128)]; processor.process([], [channels]); for (const value of channels[0]) energy += value * value; globalThis.currentTime += 128 / 48000; } return energy; };
    assert.ok(render(.3) > .001); const before = { ...processor.sampleClock.samples[0].timing }, sibling = processor.sampleClock.samples[1];
    await processor.command({ type: 'sampleReplacement', slot: 0, id: 1, scoreVersion: 0, revision: 1, live: true, program: 16, replacement: { data: compileDeck(score(72, 4).analysis), token: 1, delayDelta: 0 } });
    near(processor.sampleClock.samples[0].timing.positionBeats, before.positionBeats / 2);
    assert.equal(processor.sampleClock.samples[1], sibling); assert.ok(processor.noteFx.activePitches(144, 40).length);
    assert.equal(processor.noteFx.activePitches(128, 60).length, 0); assert.ok(processor.noteFx.activePitches(128, 72).length);
    assert.ok(render(.3) > .001); assert.equal(processor.noteFx.activePitches(128, 60).length, 0, 'the old source echo never comes back');
    assert.ok(!messages.some(message => message.type === 'error'));
    await processor.command({ type: 'samplePaused', slot: 0, id: 1, paused: true, revision: 2 });
    await processor.command({ type: 'sampleReplacement', slot: 0, id: 1, scoreVersion: 1, revision: 3, live: true, program: 16, replacement: { data: compileDeck(score(84, 2).analysis), token: 3, delayDelta: 0 } });
    assert.equal(processor.noteFx.activePitches(128, 84).length, 0); assert.equal(processor.sampleClock.samples[0].paused, true);
  } finally { await processor.command({ type: 'dispose' }); for (const key of ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime']) delete globalThis[key]; }
});
