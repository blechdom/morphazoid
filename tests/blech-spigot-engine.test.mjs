import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { createBlechSpigotEngine, blechStrokeScore, transformBlechSpigot } from '../src/instruments/blech-midi/blech-midi-spigot-engine.js';
const note = (pitch, beat = 0, duration = .5) => ({ note: pitch, beat, duration, channel: 0, velocity: 96 });
const score = () => blechStrokeScore([note(48), note(60, 1)], 2);
function setup() {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  return { engine, sources: createBlechSpigotEngine({ engine }), at(seconds) { now = seconds * 1000; }, contexts: () => contexts };
}

test('persistent sources transform pristine MIDI immediately while retaining phrase phase, mix, and sibling clocks', async () => {
  const q = setup(), original = score();
  const first = q.sources.create(original, { loop: true, source: 'math', gain: .35, pan: -.25, channel: 3, name: 'Shape' });
  q.sources.create(original, { loop: true, source: 'frames' });
  q.at(.3); const before = q.engine.state.samples, count = q.engine.state.generatedNoteCount;
  q.sources.edit(first.id, { rotationDegrees: 90, widthNotes: 36, heightBeats: 4, transpose: 12 });
  const layer = q.sources.getLayers()[0], current = q.engine.state.samples[0];
  assert.notEqual(current.analysis, before[0].analysis);
  assert.equal(current.pendingReplacement, undefined); assert.equal(layer.pendingEdit, false);
  assert.equal(current.id, first.sampleId); assert.equal(current.positionBeats, before[0].positionBeats * 2);
  assert.equal(current.cycle, before[0].cycle); assert.equal(current.analysis.durationBeats, 4);
  assert.equal(current.gain, .35); assert.equal(current.pan, -.25); assert.equal(current.channel, 3); assert.equal(current.loop, true);
  assert.equal(q.engine.state.generatedNoteCount, count, 'rewritten past attacks are not counted again');
  assert.equal(layer.score.analysis.noteCount, 2); assert.equal(layer.settings.rotationDegrees, 90);
  assert.deepEqual(q.engine.state.samples[1], before[1]);
  q.sources.edit(first.id, { rotationDegrees: 180 });
  assert.deepEqual(q.sources.getLayers()[0].score.buffer, transformBlechSpigot(original, { ...layer.settings, rotationDegrees: 180 }).buffer, 'angle edits do not compound');
  assert.equal(q.engine.state.samples[0].positionBeats, current.positionBeats);
  q.at(.5); assert.equal(q.engine.state.samples[0].positionBeats, 1.6);
  assert.equal(q.contexts(), 0); await q.engine.dispose();
});

test('closing a valve finishes its current pass and leaves an editable retriggerable persistent source', async () => {
  const q = setup(), source = q.sources.create(score(), { loop: true });
  q.at(.2); const position = q.engine.state.samples[0].positionBeats;
  q.sources.loop(source.id, false);
  assert.equal(q.engine.state.samples[0].positionBeats, position); assert.equal(q.engine.state.samples[0].loop, false);
  q.at(2); assert.equal(q.engine.state.samples.length, 0);
  assert.equal(q.sources.getLayers().length, 1); assert.equal(q.sources.getLayers()[0].active, false);
  q.sources.edit(source.id, { transpose: 7, heightBeats: 1 });
  q.sources.configure(source.id, { gain: .25, channel: 3, pan: -.5 }); q.sources.loop(source.id, true);
  const reopened = q.sources.getLayers()[0]; assert.equal(reopened.id, source.id); assert.notEqual(reopened.sampleId, source.sampleId);
  assert.equal(q.engine.state.samples[0].gain, .25); assert.equal(q.engine.state.samples[0].channel, 3);
  assert.equal(q.engine.state.samples[0].analysis.notes[0].note, 55);
  q.sources.remove(source.id); assert.equal(q.engine.state.samples.length, 0); assert.equal(q.sources.getLayers().length, 0);
  await q.engine.dispose();
});

test('one captured drawing streams immutable future rows through one slot, skips idle backlog and ends at its real length', async () => {
  const q = setup(), id = q.sources.brushStart({ pitch: 60, delayBeats: 0, prepared: { settings: { loop: false, gain: .4, channel: 2, program: '16' } } });
  const sampleId = q.sources.getLayers()[0].sampleId;
  q.at(.2); assert.ok(q.sources.brushMove(id, { pitch: 64, delayBeats: 0 }));
  const early = q.engine.state.samples[0].analysis.notes.map(note => ({ ...note }));
  q.at(5); assert.ok(q.sources.brushMove(id, { pitch: 64, delayBeats: 0 }));
  const appended = q.engine.state.samples[0];
  assert.equal(q.engine.state.samples.length, 1); assert.equal(appended.id, sampleId); assert.equal(appended.analysis.notes.length, early.length + 1, 'stalled input emits one current row, never backlog');
  assert.deepEqual(appended.analysis.notes.slice(0, early.length), early, 'old notes keep timing and stable IDs');
  q.sources.brushEnd(id); assert.ok(q.engine.state.samples[0].analysis.durationBeats < 12);
  q.at(8); assert.equal(q.engine.state.samples.length, 0); assert.equal(q.sources.getLayers().length, 1);
  assert.equal(q.contexts(), 0); await q.engine.dispose();
});

test('Stop all and pointer end prevent later brush timer calls from resurrecting voices', async () => {
  const q = setup(), id = q.sources.brushStart({ pitch: 64, prepared: { settings: { loop: true } } });
  q.at(.2); q.sources.stopAll(); q.at(.4);
  assert.equal(q.sources.brushMove(id, { pitch: 70 }), false); assert.equal(q.sources.brushEnd(id), false);
  assert.equal(q.engine.state.samples.length, 0); assert.equal(q.sources.getLayers()[0].active, false);
  q.sources.dispose(); assert.equal(q.sources.create(score()), null); await q.engine.dispose();
});

test('append rejects rewritten gates and controls, and never recounts already crossed attacks', async () => {
  const q = setup(), first = blechStrokeScore([note(60, 0, 4)], 16), source = q.engine.triggerSample(first.buffer);
  q.at(.2); assert.equal(q.engine.state.generatedNoteCount, 1);
  assert.equal(q.engine.appendSample(source.id, blechStrokeScore([note(61, 0, 4), note(72, 1)], 16).buffer), false);
  assert.ok(q.engine.appendSample(source.id, blechStrokeScore([note(60, 0, 4), note(72, 1)], 16).buffer));
  assert.equal(q.engine.state.generatedNoteCount, 1); q.at(.6); assert.equal(q.engine.state.generatedNoteCount, 2);
  assert.equal(q.engine.appendSample(source.id, blechStrokeScore([note(60, 0, 4), note(72, 1), note(65, .5)], 16).buffer), false, 'overdue new attacks are rejected');
  assert.equal(q.engine.state.generatedNoteCount, 2); await q.engine.dispose();
});

test('audio-frame append preserves held gates without release/retrigger and replacement delay occurs at the loop boundary', () => {
  const emitted = [], released = [];
  const clock = new MidiSampleClock({ emit: (source, event) => emitted.push(event), release: source => released.push(source) });
  const first = compileDeck(blechStrokeScore([note(60, 0, 2)], 4).analysis);
  clock.load(0, { id: 1, revision: 0, data: first, startBeat: 0, loop: false, sync: true });
  clock.process(12000, 48000, 120); const releases = released.length;
  const next = compileDeck(blechStrokeScore([note(60, 0, 2), note(67, 1, .5)], 4).analysis);
  assert.ok(clock.appendScore(0, next, 1)); assert.equal(released.length, releases);
  clock.process(24000, 48000, 120);
  assert.deepEqual(emitted.filter(event => event.kind === 9).map(event => event.a), [60, 67]);
  clock.setOptions(0, { loop: true });
  clock.replaceScore(0, { data: compileDeck(score().analysis), channels: [], token: 2, delayBeats: .5 }, { defer: true, revision: 2 });
  clock.process(60000, 48000, 120); assert.equal(clock.samples[0].timing.positionBeats, 0); assert.equal(clock.samples[0].timing.pendingBeats, .5);
  const attacks = emitted.filter(event => event.kind === 9).length; clock.process(12000, 48000, 120);
  assert.equal(emitted.filter(event => event.kind === 9).length, attacks);
  clock.process(128, 48000, 120); assert.equal(emitted.filter(event => event.kind === 9).length, attacks + 1);
});

test('native SoundFont append stays audible, has no duplicate attacks and releases at the finished stroke boundary', async () => {
  let Processor; const messages = [];
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => messages.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    await processor.command({ type: 'sample', slot: 0, id: 1, revision: 0, data: compileDeck(blechStrokeScore([note(60, 0, 1)], 16).analysis), startBeat: 0, gain: .5, program: 16, loop: false, sync: true });
    const render = seconds => { let energy = 0; for (let i = 0; i < Math.ceil(seconds * 48000 / 128); i++) { const channels = [new Float32Array(128), new Float32Array(128)]; processor.process([], [channels]); for (const value of channels[0]) energy += value * value; globalThis.currentTime += 128 / 48000; } return energy; };
    assert.ok(render(.15) > .001); const clock = processor.sampleClock.samples[0].timing.positionBeats;
    await processor.command({ type: 'sampleAppend', slot: 0, id: 1, revision: 1, data: compileDeck(blechStrokeScore([note(60, 0, 1), note(67, .75, .5)], 1.5).analysis) });
    assert.equal(processor.sampleClock.samples[0].timing.positionBeats, clock); assert.ok(processor.noteFx.activePitches(128, 60).length);
    assert.ok(render(.5) > .001); render(.5);
    assert.equal(processor.sampleClock.samples[0], null); assert.equal(processor.noteFx.activePitches(128, 60).length, 0); assert.equal(processor.noteFx.activePitches(128, 67).length, 0);
    assert.ok(!messages.some(message => message.type === 'error'));
  } finally { await processor.command({ type: 'dispose' }); for (const key of ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime']) delete globalThis[key]; }
});

test('an overdue appended attack never rehydrates on pause/resume but is playable on its next loop', () => {
  const joined = [], emitted = [], clock = new MidiSampleClock({ emit: (_source, event) => emitted.push(event), rehydrate: (_source, notes) => joined.push(...notes) });
  clock.load(0, { id: 1, revision: 0, data: compileDeck(blechStrokeScore([note(60, 0, 4)], 8).analysis), startBeat: 0, loop: false });
  clock.process(24000, 48000, 120);
  const next = compileDeck(blechStrokeScore([note(60, 0, 4), note(72, .5, 3)], 8).analysis);
  clock.appendScore(0, next, 1); clock.setPaused(0, true, 2); clock.setPaused(0, false, 3);
  assert.deepEqual(joined.map(event => event.a), [60]);
  clock.appendScore(0, compileDeck(blechStrokeScore([note(60, 0, 4), note(72, .5, 3), note(67, 2)], 8).analysis), 4);
  clock.setPaused(0, true, 5); clock.setPaused(0, false, 6);
  assert.deepEqual(joined.map(event => event.a), [60, 60], 'suppression survives another append');
  clock.setOptions(0, { loop: true }); clock.process(192000, 48000, 120);
  assert.ok(emitted.some(event => event.kind === 9 && event.a === 72), 'the full authored row is valid on the following cycle');
});

test('late finalization acknowledges its new revision and paused gesture ends retain their short loop length', async () => {
  const clock = new MidiSampleClock();
  clock.load(0, { id: 1, revision: 0, data: compileDeck(blechStrokeScore([note(60)], 512).analysis), startBeat: 0, loop: false });
  clock.process(48000, 48000, 120);
  assert.ok(clock.appendScore(0, compileDeck(blechStrokeScore([note(60)], 1).analysis), 7));
  assert.equal(clock.samples[0], null); assert.equal(clock.snapshot()[0].revision, 7);
  const q = setup(), id = q.sources.brushStart({ pitch: 60, delayBeats: 3, prepared: { settings: { loop: true } } });
  assert.equal(q.sources.getLayers()[0].settings.delayBeats, 3);
  assert.equal(q.sources.getLayers()[0].score.analysis.notes[0].beat, 0, 'clicked height is transport placement, not a blank source prefix');
  q.at(.2); q.engine.setSamplePaused(q.sources.getLayers()[0].sampleId, true); q.sources.brushEnd(id);
  assert.ok(q.engine.state.samples[0].analysis.durationBeats < 1); assert.equal(q.engine.state.samples[0].paused, true); assert.equal(q.engine.state.samples[0].loop, true);
  await q.engine.dispose();
});

test('rotation keeps its full resize envelope within the keyboard even when occupied notes collapse to one pitch', () => {
  const chord = blechStrokeScore([note(40), note(80)], 1);
  const rotated = transformBlechSpigot(chord, { rotationDegrees: 90, widthNotes: 100, transpose: 127 });
  assert.equal(rotated.pitchHigh, 127); assert.equal(rotated.pitchLow, 28); assert.equal(rotated.pitchWidth, 100);
  assert.equal(new Set(rotated.analysis.notes.map(note => note.note)).size, 1);
  assert.ok(rotated.analysis.notes.every(note => note.note >= rotated.pitchLow && note.note <= rotated.pitchHigh));
});

test('stamp brushes repeat complete shapes and stop at their bounded note budget without partial copies', async () => {
  const q = setup(), shape = blechStrokeScore(Array.from({ length: 1200 }, (_, i) => note(i % 128, Math.floor(i / 128) * .05, .01)), 1);
  const id = q.sources.brushStart({ mode: 'stamp', pitch: 64, prepared: { score: shape, settings: {} } });
  q.at(.6); assert.equal(q.sources.brushMove(id, { pitch: 64 }), true);
  q.at(1.2); assert.equal(q.sources.brushMove(id, { pitch: 64 }), true);
  q.at(1.8); assert.equal(q.sources.brushMove(id, { pitch: 64 }), false);
  assert.equal(q.engine.state.samples.length, 1); assert.equal(q.sources.getLayers()[0].score.analysis.noteCount, 3600);
  assert.ok(q.engine.state.samples[0].analysis.durationBeats < 5); await q.engine.dispose();
});

test('cancelling a loop-enabled pointer gesture finishes committed notes without opening a repeating valve', async () => {
  const q = setup(), id = q.sources.brushStart({ pitch: 60, prepared: { settings: { loop: true } } });
  q.at(.2); q.sources.brushMove(id, { pitch: 67 }); const count = q.sources.getLayers()[0].score.analysis.noteCount;
  q.sources.brushEnd(id, { cancelled: true });
  assert.equal(q.engine.state.samples[0].loop, false); assert.equal(q.sources.getLayers()[0].score.analysis.noteCount, count);
  q.at(5); assert.equal(q.engine.state.samples.length, 0); assert.equal(q.sources.getLayers()[0].active, false);
  await q.engine.dispose();
});

test('a dense stamp still places every note as one source and never becomes a truncated brush', async () => {
  const { generateGridMidi } = await import('../src/instruments/midiphoria/midiphoria-text-midi.js');
  const dense = generateGridMidi(Array.from({ length: 40 }, () => Array(128).fill(1)), { lowestNote: 0, retrigger: true, secondsPerRow: .01 });
  const q = setup(), id = q.sources.brushStart({ mode: 'stamp', pitch: 64, delayBeats: 2, prepared: { score: dense, settings: { source: 'frames', gain: .3, program: '16', channel: 3 } } });
  assert.ok(id); assert.equal(q.engine.state.samples[0].analysis.noteCount, 5120); assert.equal(q.engine.state.samples[0].gain, .3);
  assert.equal(q.sources.getLayers()[0].settings.delayBeats, 2);
  q.at(.2); assert.equal(q.sources.brushMove(id, { pitch: 72 }), false); assert.equal(q.sources.brushEnd(id), false);
  assert.equal(q.engine.state.samples.length, 1); assert.equal(q.engine.state.samples[0].analysis.noteCount, 5120);
  await q.engine.dispose();
});
