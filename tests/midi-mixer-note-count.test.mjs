import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function score(starts = [0, .5, 1, 3], beats = 4, bpm = 120) {
  const ppq = 96, micros = Math.round(60000000 / bpm);
  const events = [[0, 255, 81, 3, micros >>> 16, micros >>> 8 & 255, micros & 255]];
  starts.forEach((beat, index) => events.push([beat, 144, 40 + index % 80, 100], [beat + 1 / ppq, 128, 40 + index % 80, 0]));
  events.push([beats, 255, 47, 0]); events.sort((a, b) => a[0] - b[0]);
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
  let tick = 0; const track = [];
  for (const [beat, ...message] of events) { const next = Math.round(beat * ppq); track.push(...vlq(next - tick), ...message); tick = next; }
  const bytes = new Uint8Array(22 + track.length), view = new DataView(bytes.buffer);
  bytes.set([77, 84, 104, 100]); view.setUint32(4, 6); view.setUint16(10, 1); view.setUint16(12, ppq);
  bytes.set([77, 84, 114, 107], 14); view.setUint32(18, track.length); bytes.set(track, 22); return bytes.buffer;
}

function harness(t) {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  t.after(async () => { await engine.dispose(); assert.equal(contexts, 0, 'counting never arms Audio'); });
  return { engine, at: milliseconds => { now = milliseconds; return engine.state; }, setTime: milliseconds => { now = milliseconds; } };
}

test('the counter waits for drops to arrive and counts simultaneous source attacks, not future notes or repeated reads', t => {
  const { engine, at } = harness(t);
  engine.triggerSample(score([0, 0, 1, 3]), { delayBeats: 2, quantize: false });
  assert.equal(engine.state.generatedNoteCount, 0);
  assert.equal(at(999).generatedNoteCount, 0);
  assert.equal(at(1000).generatedNoteCount, 2);
  for (let frame = 0; frame < 100; frame++) assert.equal(engine.state.generatedNoteCount, 2);
  assert.equal(at(1500).generatedNoteCount, 3);
  assert.equal(at(3001).generatedNoteCount, 4);
  assert.equal(engine.state.samples.length, 0);
  assert.equal(at(40000).finishedSamples.length, 0);
  assert.equal(engine.state.generatedNoteCount, 4, 'pruned display history does not erase performed notes');
});

test('missed frames and complete loop cycles count exactly while pause freezes and resume never recounts held notes', t => {
  const { engine, at } = harness(t);
  const layer = engine.triggerSample(score(), { loop: true, quantize: false });
  assert.equal(at(750).generatedNoteCount, 3);
  engine.setSamplePaused(layer.id, true);
  assert.equal(at(20000).generatedNoteCount, 3);
  engine.setSamplePaused(layer.id, false);
  assert.equal(engine.state.generatedNoteCount, 3);
  assert.equal(at(20750).generatedNoteCount, 4);
  assert.equal(at(21250).generatedNoteCount, 5);
  assert.equal(at(1021250).generatedNoteCount, 2005, '500 entire unseen cycles are counted without replaying events');
});

test('tempo and source-sync changes retain the count at their actual source phase', t => {
  const { engine, at } = harness(t);
  const synced = engine.triggerSample(score(), { loop: true, quantize: false });
  const free = engine.triggerSample(score([0, 1, 2, 3], 4, 60), { loop: true, sync: false, quantize: false });
  assert.equal(at(500).generatedNoteCount, 4);
  engine.setTempo(240);
  assert.equal(at(1000).generatedNoteCount, 6);
  engine.configureSample(synced.id, { sync: false });
  assert.equal(at(1500).generatedNoteCount, 7);
  engine.configureSample(free.id, { sync: true });
  assert.equal(at(1875).generatedNoteCount, 10);
});

test('stops, slot stealing, and completion pruning preserve totals and canceled delayed drops add nothing', t => {
  const { engine, at, setTime } = harness(t);
  const first = engine.triggerSample(score(), { loop: true, quantize: false });
  setTime(750); engine.stopSample(first.id);
  assert.equal(engine.state.generatedNoteCount, 3, 'Stop captures notes since the last display frame');
  const pending = engine.triggerSample(score(), { delayBeats: 4, quantize: false });
  engine.stopSample(pending.id); assert.equal(engine.state.generatedNoteCount, 3);
  for (let index = 0; index < 4; index++) engine.triggerSample(score(), { loop: true, quantize: false });
  setTime(1500); engine.triggerSample(score(), { loop: true, quantize: false });
  assert.equal(engine.state.generatedNoteCount, 16, 'four old layers retain three notes each when one slot is stolen');
  setTime(1750); engine.stopSamples();
  assert.equal(engine.state.generatedNoteCount, 17);
  for (let index = 0; index < 12; index++) {
    engine.triggerSample(score([0], 1), { quantize: false }); at(3000 + index * 1000);
  }
  assert.equal(engine.state.generatedNoteCount, 29);
  assert.equal(engine.state.finishedSamples.length, 8);
  assert.equal(at(60000).generatedNoteCount, 29);
  assert.equal(engine.state.finishedSamples.length, 0);
});

test('reset clears only the displayed baseline while every transport and loop position remains intact', t => {
  const { engine, at } = harness(t);
  const layer = engine.triggerSample(score(), { loop: true, quantize: false });
  at(750); const before = engine.state;
  assert.equal(engine.resetNoteCount(), true);
  const after = engine.state;
  assert.equal(after.generatedNoteCount, 0);
  assert.deepEqual(after.samples, before.samples);
  assert.equal(after.sampleBeat, before.sampleBeat); assert.equal(after.sampleTime, before.sampleTime);
  assert.equal(after.playing, before.playing); assert.equal(after.audioEnabled, before.audioEnabled);
  assert.equal(at(1500).generatedNoteCount, 1);
  engine.setSamplePaused(layer.id, true); engine.resetNoteCount();
  assert.equal(at(5000).generatedNoteCount, 0);
  engine.setSamplePaused(layer.id, false); assert.equal(engine.state.generatedNoteCount, 0);
  assert.equal(at(5500).generatedNoteCount, 1);
});

test('next-loop replacements count the final old attacks and all new cycles even with no display at the boundary', t => {
  const { engine, at } = harness(t);
  const layer = engine.triggerSample(score(), { loop: true, quantize: false });
  at(750); engine.replaceSample(layer.id, score([0, .5], 1));
  assert.equal(at(3625).generatedNoteCount, 11, 'four old notes, three full new loops, and the next beat-zero note');
  assert.equal(engine.state.samples[0].cycle, 4);
  engine.replaceSample(layer.id, score([0, .25, .5], 1), { when: 'restart' });
  assert.equal(engine.state.generatedNoteCount, 12, 'explicit restart adds the new first attack once');
  assert.equal(at(3875).generatedNoteCount, 14);
  engine.setSamplePaused(layer.id, true);
  engine.replaceSample(layer.id, score([0, 0], 1));
  assert.equal(at(5000).generatedNoteCount, 14, 'editing a paused score adds nothing');
  engine.setSamplePaused(layer.id, false); assert.equal(engine.state.generatedNoteCount, 16);
});

test('editing a delayed score never counts either discarded or still-future notes', t => {
  const { engine, at } = harness(t);
  const layer = engine.triggerSample(score(), { delayBeats: 4, quantize: false, loop: true });
  at(250); engine.replaceSample(layer.id, score([0, 0, .5], 1));
  assert.equal(at(1999).generatedNoteCount, 0);
  assert.equal(at(2000).generatedNoteCount, 2);
  assert.equal(at(2250).generatedNoteCount, 3);
});

test('audio-clock telemetry agrees with source attacks and late reports cannot double-count', t => {
  const { engine } = harness(t), bytes = score(), layer = engine.triggerSample(bytes, { quantize: false, delayBeats: 1, loop: true });
  let attacks = 0;
  const clock = new MidiSampleClock({ emit: (_source, event) => { if (event.kind === 9) attacks++; } });
  clock.load(0, { id: layer.id, revision: layer.revision, data: compileDeck(parseMidi(bytes)), timing: { positionBeats: 0, cycle: 0, pendingBeats: 1, ended: false }, sync: true, loop: true });
  const context = { currentTime: 0, state: 'suspended', close: async () => {} };
  engine.context = context; engine._ready = true; engine._sampleAudioAnchor = 0;
  let last;
  for (let block = 0; block < 1500; block++) {
    clock.process(128, 48000, 120); context.currentTime += 128 / 48000;
    if (block % 101 !== 100) continue;
    const timings = clock.snapshot();
    engine._receiveSampleTimings(timings, clock.beat, clock.seconds);
    engine._sampleBeat = clock.beat; engine._sampleTime = clock.seconds; engine._sampleAudioAnchor = context.currentTime;
    assert.equal(engine.state.generatedNoteCount, attacks);
    if (last) { engine._receiveSampleTimings(last.timings, last.beat, last.seconds); assert.equal(engine._sampleNoteCount, attacks); }
    last = { timings, beat: clock.beat, seconds: clock.seconds };
    // Restore the newest authority after exercising an obsolete report.
    engine._receiveSampleTimings(timings, clock.beat, clock.seconds);
  }
});

test('processor replacement and completion reports retain both scores exactly once after their layer is removed', t => {
  const { engine, at } = harness(t);
  const layer = engine.triggerSample(score(), { loop: true, quantize: false });
  at(750); const queued = engine.replaceSample(layer.id, score([0, .5], 1));
  const replacement = { id: layer.id, revision: queued.revision, scoreVersion: queued.pendingReplacement.token,
    positionBeats: .75, cycle: 3, pendingBeats: 0, ended: false, replacedAt: 2, resumedCycle: 1 };
  engine._receiveSampleTimings([replacement], 6.75, 3.375);
  assert.equal(engine.state.generatedNoteCount, 10, 'four old attacks and three new two-note passes');
  engine._receiveSampleTimings([{ ...replacement, scoreVersion: 0, cycle: 0, positionBeats: 3 }], 3, 1.5);
  assert.equal(engine.state.generatedNoteCount, 10, 'late old-score telemetry does not count the new score in the old coordinate');
  const completed = { ...replacement, cycle: 4, positionBeats: 1, ended: true, finishedAt: 4 };
  engine._receiveSampleTimings([completed], 8, 4);
  assert.equal(engine.state.generatedNoteCount, 12);
  assert.equal(engine.state.samples.length, 0);
  engine._receiveSampleTimings([completed], 8, 4);
  assert.equal(at(60000).generatedNoteCount, 12, 'duplicate completion and expired display history cannot change the total');
});

test('dense counting probes logarithmically and ignores downstream FX, voice, and visual-event limits', t => {
  const { engine, at } = harness(t);
  engine.triggerSample(score(Array.from({ length: 32768 }, (_, index) => index / 96), 342), { loop: true, quantize: false });
  const sample = engine._samples[0], starts = sample.compiled.held.start; let reads = 0;
  sample.compiled.held.start = new Proxy(starts, { get: (target, key) => { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, target); } });
  engine._voices = 1; engine._droppedVisualEvents = 90000; engine._skippedEvents = 12000;
  const state = at(171000 * 1000 + 1000);
  assert.equal(state.generatedNoteCount, 1000 * 32768 + 193);
  assert.ok(reads <= 17, `${reads} start reads exceeds logarithmic lookup`);
});

test('Automata counts persistent attacks through history pruning, pause, reseed, restart, and counter reset', t => {
  const { engine, at } = harness(t);
  engine.configureAutomata({ columns: 8, seedRow: Array(8).fill(1), rule: 204, rowBeats: .5, articulation: 'retrigger' });
  engine.setAutomataPlaying(true); assert.equal(engine.state.generatedNoteCount, 8);
  for (let second = 1; second <= 20; second++) at(second * 1000 + 1);
  const before = engine.state;
  assert.equal(before.generatedNoteCount, 648);
  assert.ok(engine._automata.notes.length < before.generatedNoteCount, 'bounded history cannot be used as the cumulative total');
  engine.setAutomataPlaying(false); assert.equal(at(30000).generatedNoteCount, 648);
  engine.restartAutomata(); assert.equal(engine.state.generatedNoteCount, 648);
  engine.reseedAutomata(); assert.equal(engine.state.generatedNoteCount, 648);
  engine.setAutomataPlaying(true); assert.equal(engine.state.generatedNoteCount, 656);
  engine.reseedAutomata(); assert.equal(engine.state.generatedNoteCount, 664);
  engine.resetNoteCount(); assert.equal(engine.state.generatedNoteCount, 0);
  assert.equal(engine.state.automata.playing, true);
  engine.restartAutomata(); assert.equal(engine.state.generatedNoteCount, 8);
});
