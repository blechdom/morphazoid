import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MAX_MIDI_MIXER_TEMPO, parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { MidiAutomataClock, captureAutomataMidi } from '../src/instruments/midi-mixer/midi-mixer-automata.js';
import { MidiSampleClock, MAX_SAMPLE_EVENTS_PER_BLOCK, MAX_SAMPLE_RESTORES_PER_BLOCK } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { encodeArtwork } from '../src/instruments/blech-midi/blech-midi-art.js';
import { encodeMath } from '../src/instruments/blech-midi/blech-midi-math.js';
import { MidiFrameSequence } from '../src/instruments/blech-midi/blech-midi-frames.js';
import { createBlechLiveProjector } from '../src/instruments/blech-midi/blech-midi-live-score.js';

const score = () => encodeArtwork([0, 1].map(beat => ({ beat, note: 60 + beat, duration: .25, velocity: 100, layer: 0 })), { durationBeats: 2 });

test('BLECH reaches 4,800 BPM without resetting running layers or changing the ordinary mixer ceiling', async () => {
  const ordinary = new MidiMixerEngine(); assert.equal(ordinary.setTempo(4800), 300); await ordinary.dispose();
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ maxTempo: MAX_MIDI_MIXER_TEMPO, runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  try {
    engine.triggerSample(score().buffer, { loop: true, quantize: false, sync: true });
    engine.configureAutomata({ columns: 8, rule: 204, rowBeats: .5 }); engine.setAutomataPlaying(true);
    now = 250; const before = engine.state;
    assert.equal(before.samples[0].positionBeats, .5); assert.equal(before.automata.beat, .5);
    assert.equal(engine.setTempo(4800), 4800); assert.equal(engine.state.samples[0].positionBeats, .5);
    now = 275; const fast = engine.state;
    assert.ok(Math.abs(fast.samples[0].positionBeats - .5) < 1e-10); assert.equal(fast.samples[0].cycle, 1);
    assert.ok(Math.abs(fast.automata.beat - 2.5) < 1e-10); assert.equal(fast.audioEnabled, false); assert.equal(contexts, 0);
    assert.equal(engine.setTempo(1e6), 4800); assert.equal(engine.setTempo(NaN), 4800); assert.equal(engine.setTempo(0), 30);
    now = 1275; assert.ok(Math.abs(engine.state.samples[0].positionBeats - 1) < 1e-10);
  } finally { await engine.dispose(); }
});

test('art, math, frames and performed automata exports retain the fast master tempo', () => {
  const art = encodeArtwork([{ beat: 0, note: 60, duration: 1, velocity: 100, layer: 0 }], { tempo: 4800, durationBeats: 4 });
  const math = encodeMath({ equation: 'x', samples: 8 }, 4800);
  const frames = new MidiFrameSequence(); frames.capture(art);
  const clock = new MidiAutomataClock(); clock.configure({ columns: 8, rule: 204, rowBeats: .5 }); clock.setPlaying(true); clock.advance(2, 4800);
  const captured = captureAutomataMidi(clock.snapshot(true), 2);
  for (const item of [art, math, frames.score(1, 4800), captured]) assert.equal(parseMidi(item.buffer).initialTempo, 4800);
});

test('the falling forecast uses the same high tempo and preserves independent delayed arrivals', () => {
  const analysis = score().analysis, project = createBlechLiveProjector();
  const sample = { id: 1, slot: 0, sync: true, loop: false, cycle: 0, positionBeats: 0, gain: .8, midi: {}, analysis, pending: true, pendingBeats: 2 };
  const result = project({ tempo: 4800, samples: [sample] }, { lookAhead: 1 });
  const notes = result.notes.toSorted((a, b) => a.start - b.start);
  assert.equal(notes.length, 2); assert.ok(Math.abs(notes[0].start - .025) < 1e-10); assert.ok(Math.abs(notes[1].start - .0375) < 1e-10);
  assert.ok(Math.abs(notes[0].end - .028125) < 1e-10);
});

test('extremely short loops retain event and controller budgets at maximum master tempo', () => {
  const tiny = encodeArtwork([{ beat: 0, note: 60, duration: 1 / 960, velocity: 100, layer: 0 }], { durationBeats: 1 / 960 });
  const data = compileDeck(tiny.analysis); let emitted = 0, restored = 0;
  const clock = new MidiSampleClock({ emit: () => emitted++, restore: () => restored++ });
  for (let slot = 0; slot < 4; slot++) clock.load(slot, { id: slot, data, startBeat: 0, loop: true, sync: true });
  clock.process(128, 48000, 4800);
  assert.ok(emitted <= MAX_SAMPLE_EVENTS_PER_BLOCK); assert.ok(restored <= 4 + MAX_SAMPLE_RESTORES_PER_BLOCK);
  assert.ok(clock.skippedEvents > 0);
  for (const item of clock.samples) assert.ok(Number.isFinite(item.timing.positionBeats) && item.timing.positionBeats < data.durationBeats);
});

test('native worklet sounds 4,800 BPM loops at exact frames and tempo edits preserve phase', async () => {
  let Processor; const messages = []; globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => messages.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    await processor.command({ type: 'tempo', tempo: 4800 }); assert.equal(processor.clock.tempo, 4800);
    await processor.command({ type: 'sample', slot: 0, id: 1, data: compileDeck(score().analysis), timing: { positionBeats: 0, pendingBeats: 0, cycle: 0, ended: false }, loop: true, sync: true, quantize: false, gain: .8, program: 16 });
    let energy = 0;
    for (let block = 0; block < 30; block++) {
      const output = [new Float32Array(128), new Float32Array(128)]; processor.process([], [output]);
      for (const channel of output) for (const value of channel) { assert.ok(Number.isFinite(value)); energy += value * value; }
      globalThis.currentTime += 128 / 48000;
    }
    processor.publish(); assert.ok(energy > 0);
    const attacks = messages.flatMap(message => message.notes ?? []).filter(note => note.type === 'noteOn' && note.sampleId === 1);
    assert.deepEqual(attacks.map(note => Math.round(note.at * 48000)), [0, 600, 1200, 1800, 2400, 3000, 3600]);
    const before = processor.sampleClock.samples[0].timing.positionBeats;
    await processor.command({ type: 'tempo', tempo: 2400 }); assert.equal(processor.sampleClock.samples[0].timing.positionBeats, before);
    await processor.command({ type: 'tempo', tempo: 1e6 }); assert.equal(processor.clock.tempo, 4800);
    await processor.command({ type: 'tempo', tempo: NaN }); assert.equal(processor.clock.tempo, 4800);
    await processor.command({ type: 'stopSamples' }); assert.equal(processor.sampleClock.samples.filter(Boolean).length, 0);
  } finally { await processor.command({ type: 'dispose' }); delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.currentTime; delete globalThis.sampleRate; }
});
