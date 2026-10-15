import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiAutomataClock, captureAutomataMidi, AUTOMATA_HISTORY_ROWS } from '../src/instruments/midi-mixer/midi-mixer-automata.js';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { generateAutomataMidi } from '../src/instruments/midiphoria/midiphoria-automata-midi.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

const fixed = { columns: 8, lowestNote: 60, rule: 204, rowBeats: .5, program: 16, gain: .8 };

test('reseed starts a separate held-note lineage at the current beat and retains performed history', () => {
  const events = [], clock = new MidiAutomataClock({ emit: event => events.push(event) });
  clock.configure({ ...fixed, articulation: 'hold' }); clock.setPlaying(true); clock.advance(.75);
  const before = clock.snapshot(true), original = before.notes[0];
  clock.configure({ seedRow: [1, 0, 0, 0, 1, 0, 0, 0] }); clock.reseed();
  assert.equal(clock.playing, true); assert.equal(clock.beat, before.beat); assert.equal(clock.generation, before.generation + 1);
  assert.deepEqual(clock.history.slice(0, -1), before.history);
  assert.equal(clock.history.at(-1).reseed, true); assert.equal(clock.history.at(-1).startBeat, .75);
  assert.deepEqual(events.slice(-3).map(event => [event.kind, event.a]), [[8, 64], [9, 60], [9, 64]]);
  assert.equal(clock.notes.find(note => note.id === original.id).endBeat, .75);
  assert.notEqual(clock.active.get(64).id, original.id, 'shared pitches reattack at the new lineage');
  clock.advance(.25); const captured = captureAutomataMidi(clock.snapshot(true), 1);
  assert.deepEqual(captured.analysis.notes.map(({ note, beat, duration }) => [note, beat, duration]), [[64, 0, .75], [60, .75, .25], [64, .75, .25]]);
});

test('paused reseed stages one new seed across snapshot handoff without sounding or clearing history', () => {
  const events = [], clock = new MidiAutomataClock({ emit: event => events.push(event) });
  clock.configure(fixed); clock.setPlaying(true); clock.advance(.7); clock.setPlaying(false);
  const before = clock.snapshot(true), count = events.length;
  clock.configure({ seedRow: [1, 0, 0, 0, 0, 0, 0, 0] }); clock.reseed();
  assert.equal(clock.seedPending, true); assert.equal(clock.playing, false); assert.equal(events.length, count);
  assert.equal(clock.beat, before.beat); assert.deepEqual(clock.row, before.row); assert.deepEqual(clock.history, before.history);
  clock.configure({ seedRow: [0, 1, 0, 0, 0, 0, 0, 0] }); clock.reseed();
  const restored = new MidiAutomataClock({ emit: event => events.push(event) }); restored.restore(clock.snapshot(true));
  restored.rejoin(); assert.equal(events.length, count);
  restored.setPlaying(true); assert.equal(restored.seedPending, false); assert.equal(restored.generation, before.generation + 1);
  assert.deepEqual(restored.row, [0, 1, 0, 0, 0, 0, 0, 0]); assert.equal(events.at(-1).a, 61);
  restored.setPlaying(false); restored.restart(); assert.equal(restored.seedPending, false); assert.deepEqual(restored.history, []);
});

test('the live seed and each descendant match the actual finite generator beyond its Rows limit', () => {
  for (const settings of [{ rule: 90, columns: 8, rows: 128 }, { family: 'totalistic-r2', rule: 22, columns: 48, density: .35, seed: 452, transform: 'shift-right', boundary: 'periodic', rows: 128 }]) {
    const expected = generateAutomataMidi(settings), clock = new MidiAutomataClock(); clock.configure(settings); clock.setPlaying(true);
    assert.deepEqual(clock.row, expected.pixels[0]);
    for (let row = 1; row < 128; row++) { clock.advance(expected.settings.rowBeats + (row === 1 ? 1e-8 : 0)); assert.deepEqual(clock.row, expected.pixels[row]); }
    assert.equal(clock.generation, 127); assert.equal(clock.playing, true);
    clock.restart(); assert.equal(clock.generation, 0); assert.deepEqual(clock.row, expected.pixels[0]);
  }
});

test('rate/rule edits wait for the next generation and Pause preserves row and phase', () => {
  const events = [], clock = new MidiAutomataClock({ emit: event => events.push(event) });
  clock.configure(fixed); clock.setPlaying(true); clock.advance(.2);
  const before = clock.snapshot(); clock.configure({ rowBeats: .125, rule: 255 });
  assert.equal(clock.rowLength, .5); assert.deepEqual(clock.row, before.row);
  clock.setPlaying(false); const paused = clock.snapshot(); clock.advance(100, 240);
  assert.equal(clock.beat, .2); assert.equal(clock.snapshot().phase, paused.phase);
  assert.equal(events.at(-1).kind, 8);
  clock.setPlaying(true); clock.advance(.30001);
  assert.equal(clock.generation, 1); assert.equal(clock.rowLength, .125); assert.deepEqual(clock.row, Array(8).fill(1));
  assert.deepEqual(events.filter(event => event.kind === 9).map(event => event.beat).slice(0, 3), [0, .2, .5]);
});

test('frame scheduling follows shared tempo exactly and rate changes preserve the in-flight row', () => {
  let offset = 0; const onsets = [], clock = new MidiAutomataClock({ emit: (event, frame) => { if (event.kind === 9) onsets.push(offset + frame); } });
  clock.configure(fixed); clock.setPlaying(true);
  const render = (frames, tempo) => { clock.process(frames, 48000, tempo); offset += frames; };
  render(6000, 120); assert.equal(clock.snapshot().phase, .5);
  render(12000, 240); assert.deepEqual(onsets, [0, 9000, 15000]);
  assert.equal(clock.beat, 1.25); clock.configure({ rowBeats: 1 });
  render(12000, 240); assert.deepEqual(onsets, [0, 9000, 15000, 21000]);
});

test('rolling capture retains actual gates, pitch shifts, program changes and tempo positions', () => {
  const clock = new MidiAutomataClock(); clock.configure({ ...fixed, articulation: 'hold' }); clock.setPlaying(true);
  clock.advance(.75, 120); clock.setPlaying(false); clock.setPlaying(true);
  clock.configure({ lowestNote: 61, program: 80, articulation: 'retrigger', rowBeats: .25 }); clock.advance(1.25, 240);
  const score = captureAutomataMidi(clock.snapshot(true), 1.5);
  assert.equal(score.sourceStartBeat, .5); assert.equal(score.sourceEndBeat, 2); assert.equal(score.durationBeats, 1.5);
  assert.deepEqual(score.analysis.tempoMap.map(({ beat, bpm }) => [beat, bpm]), [[0, 120], [.25, 240]]);
  assert.deepEqual(score.analysis.notes.map(({ beat, duration, note }) => [beat, duration, note]), [[0, .25, 64], [.25, .25, 64], [.5, .25, 65], [.75, .25, 65], [1, .25, 65], [1.25, .25, 65]]);
  assert.equal(score.analysis.events.find(event => event.kind === 12 && event.beat === .5).a, 80);
  assert.equal(score.lowestNote, 64); assert.equal(score.columns, 2);
  assert.equal(clock.playing, true); assert.equal(clock.generation, 5);
  assert.deepEqual(parseMidi(score.buffer).notes, score.analysis.notes);
});

test('history and capture stay bounded, all-zero explicit seeds stay silent, and reseeding is explicit', () => {
  const clock = new MidiAutomataClock(); clock.configure({ columns: 128, lowestNote: 0, seedRow: Array(128).fill(1), rule: 204, rowBeats: .125 }); clock.setPlaying(true);
  clock.advance(40, 120);
  assert.ok(clock.history.length <= AUTOMATA_HISTORY_ROWS); assert.ok(clock.history.length <= 129);
  const score = captureAutomataMidi(clock.snapshot(true), 1000); assert.equal(score.durationBeats, 16); assert.equal(score.analysis.noteCount, 16384);
  const generation = clock.generation; clock.configure({ seedRow: Array(128).fill(0) });
  assert.equal(clock.generation, generation); assert.equal(clock.row.reduce((sum, cell) => sum + cell, 0), 128);
  clock.restart(); assert.deepEqual(clock.row, Array(128).fill(0)); clock.advance(1);
  assert.throws(() => captureAutomataMidi(clock.snapshot(true)), /notes to capture/);
});

test('silent engine transport and capture never arm Audio or consume four independent sample slots', async () => {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  try {
    engine.configureAutomata(fixed); engine.setAutomataPlaying(true);
    const score = generateAutomataMidi(fixed);
    for (let index = 0; index < 4; index++) engine.triggerSample(score.buffer, { loop: true });
    const ids = engine.state.samples.map(sample => sample.id);
    now = 1000; assert.equal(engine.state.automata.beat, 2); engine.setTempo(240);
    now = 1500; assert.equal(engine.state.automata.beat, 4);
    engine.setAutomataPlaying(false); const phase = engine.state.automata.phase;
    now = 2500; assert.equal(engine.state.automata.beat, 4); assert.equal(engine.state.automata.phase, phase);
    assert.deepEqual(engine.state.samples.map(sample => sample.id), ids);
    const captured = await engine.captureAutomata(4); assert.equal(captured.durationBeats, 4);
    assert.equal(engine.state.samples.length, 4, 'Capture saves source data without launching a fifth sample');
    assert.equal(contexts, 0); assert.equal(engine.state.audioEnabled, false);
    engine.setAutomataPlaying(true); engine.stopSamples(); now = 3000;
    assert.equal(engine.state.automata.beat, 6); assert.equal(engine.state.samples.length, 0);
  } finally { await engine.dispose(); }
});

test('an idle silent tab bounds catch-up without manufacturing skipped descendants or audio attacks', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  try {
    engine.configureAutomata({ ...fixed, rowBeats: .125 }); engine.setAutomataPlaying(true);
    now = 3600000;
    const state = engine.state.automata;
    assert.equal(state.beat, 16); assert.equal(state.generation, 127);
    assert.equal(state.skippedSilentBeats, 7184); assert.equal(engine.context, null);
    assert.equal(engine.state.automata.generation, 127, 'reading state twice never replays discarded idle time');
  } finally { await engine.dispose(); }
});

test('native SoundFont source sounds independently, survives shared tempo edits, and Pause cancels only its own effects', async () => {
  let Processor; const messages = [];
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => messages.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js');
  const processor = new Processor();
  const render = blocks => {
    let energy = 0;
    for (let block = 0; block < blocks; block++) {
      const output = [new Float32Array(128), new Float32Array(128)]; processor.process([], [output]);
      for (const channel of output) for (const sample of channel) { assert.ok(Number.isFinite(sample)); energy += sample * sample; }
      globalThis.currentTime += 128 / 48000;
    }
    processor.publish(); return Math.sqrt(energy / (blocks * 256));
  };
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    await processor.command({ type: 'automataConfigure', settings: fixed, revision: 1 });
    await processor.command({ type: 'automataPlaying', playing: true, revision: 2 });
    assert.ok(render(300) > .001, 'live rows produce actual SoundFont audio');
    let onsets = messages.flatMap(message => message.notes ?? []).filter(note => note.sourceId === 'automata' && note.type === 'noteOn');
    assert.ok(onsets.length >= 4); assert.ok(onsets.every(note => note.sampleId === null && note.deck === null));
    assert.ok(Math.abs(onsets[2].at - onsets[1].at - .25) <= 1 / 48000);
    const before = processor.automata.beat; await processor.command({ type: 'tempo', tempo: 240 }); assert.equal(processor.automata.beat, before);
    render(150); onsets = messages.flatMap(message => message.notes ?? []).filter(note => note.sourceId === 'automata' && note.type === 'noteOn');
    assert.ok(Math.abs(onsets.at(-1).at - onsets.at(-2).at - .125) <= 1 / 48000);
    const beforeMute = processor.automata.snapshot();
    await processor.command({ type: 'audibility', enabled: false, volume: .6 }); await processor.command({ type: 'release' });
    render(75); assert.ok(processor.automata.beat > beforeMute.beat, 'Audio off releases sound without pausing evolution');
    const beforeRejoin = processor.automata.snapshot();
    await processor.command({ type: 'audibility', enabled: true, volume: .6 }); await processor.command({ type: 'rejoin' });
    assert.equal(processor.automata.beat, beforeRejoin.beat); assert.equal(processor.automata.snapshot().phase, beforeRejoin.phase);
    assert.ok(render(50) > .001, 'Audio rejoins the current generated row');
    const sample = generateAutomataMidi({ ...fixed, rows: 8 }), data = compileDeck(parseMidi(sample.buffer));
    for (let slot = 0; slot < 4; slot++) await processor.command({ type: 'sample', slot, id: slot + 1, data, startBeat: processor.sampleClock.beat, loop: true, sync: true, gain: .3, program: 16 });
    await processor.command({ type: 'noteEffects', config: { enabled: true, echoCount: 3, echoBeats: .5 } });
    render(80); await processor.command({ type: 'automataPlaying', playing: false, revision: 3 });
    const paused = processor.automata.snapshot(), mark = messages.length;
    assert.ok(render(400) > .001, 'pausing live source leaves sample audio playing');
    assert.equal(processor.automata.beat, paused.beat); assert.equal(processor.automata.snapshot().phase, paused.phase);
    assert.equal(processor.sampleClock.samples.filter(Boolean).length, 4);
    await processor.command({ type: 'audibility', enabled: false, volume: .6 }); await processor.command({ type: 'release' });
    await processor.command({ type: 'audibility', enabled: true, volume: .6 }); await processor.command({ type: 'rejoin' });
    assert.equal(processor.automata.playing, false); assert.equal(processor.automata.snapshot().phase, paused.phase);
    assert.equal(messages.slice(mark).flatMap(message => message.notes ?? []).filter(note => note.sourceId === 'automata' && note.type === 'noteOn').length, 0, 'no delayed live-source attacks after Pause');
    await processor.command({ type: 'automataCapture', token: 71 });
    const state = messages.findLast(message => message.type === 'automataCapture').state;
    assert.equal(captureAutomataMidi(state, 2).durationBeats, 2);
    await processor.command({ type: 'stopSamples' }); render(1500); assert.ok(render(100) < .0001);
    await processor.command({ type: 'automataPlaying', playing: true, revision: 4 }); assert.ok(render(100) > .001);
  } finally { await processor.command({ type: 'dispose' }); }
});
