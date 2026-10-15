import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { transformMidiStamp } from '../src/instruments/midi-mixer/midi-mixer-score-transform.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { CONTINUOUS_MIDI_STAMPS, mixerStampScore } from '../src/instruments/midi-mixer/midi-mixer-performance-score.js';

function score(note = 60, channel = 0, beats = 8) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  const track = [0, 192 + channel, 16, 0, 176 + channel, 91, 0, 0, 176 + channel, 93, 0, 0, 144 + channel, note, 100, ...vlq(beats * 96), 128 + channel, note, 0, 0, 255, 47, 0];
  const bytes = new Uint8Array(22 + track.length), view = new DataView(bytes.buffer);
  bytes.set([77, 84, 104, 100]); view.setUint32(4, 6); view.setUint16(10, 1); view.setUint16(12, 96);
  bytes.set([77, 84, 114, 107], 14); view.setUint32(18, track.length); bytes.set(track, 22); return bytes.buffer;
}

test('layer mute/solo, pan and channel edits preserve phase and independent layers without arming Audio', async () => {
  let now = 0, contexts = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  const a = engine.triggerSample(score(60, 2), { loop: true }), b = engine.triggerSample(score(67, 4), { loop: true });
  now = 500;
  const before = engine.state.samples;
  engine.configureSample(a.id, { muted: true, pan: -4 });
  assert.equal(engine.state.samples[0].effectiveMuted, true); assert.equal(engine.state.samples[0].pan, -1);
  assert.equal(engine.state.samples[0].positionBeats, before[0].positionBeats);
  assert.deepEqual(engine.state.samples[1], before[1]);
  now = 1000; assert.equal(engine.state.samples[0].positionBeats, 2, 'Mute keeps running');
  engine.configureSample(a.id, { muted: false, solo: true, channel: 9, pan: 4 });
  const routed = engine.state.samples[0];
  assert.equal(routed.pan, 1); assert.equal(routed.channel, 9); assert.equal(routed.positionBeats, 2);
  assert.ok(routed.analysis.events.every(event => event.channel === 9));
  assert.equal(routed.analysis.channels[0].drums, true);
  assert.equal(engine.state.samples[1].effectiveMuted, true);
  engine.configureSample(a.id, { channel: null });
  assert.equal(engine.state.samples[0].analysis.channels[0].channel, 2);
  assert.equal(engine.state.samples[0].analysis.channels[0].drums, false);
  assert.equal(engine.state.samples[0].positionBeats, 2);
  engine.stopSample(a.id); assert.equal(engine.state.samples.find(sample => sample.id === b.id).effectiveMuted, false);
  assert.equal(contexts, 0); await engine.dispose();
});

test('channel edits preserve the pending replacement and Original restores each replacement source', async () => {
  let now = 0; const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  const sample = engine.triggerSample(score(60, 2, 2), { loop: true });
  now = 250; engine.replaceSample(sample.id, score(72, 4, 4));
  engine.configureSample(sample.id, { channel: 8 });
  assert.equal(engine.state.samples[0].pendingReplacement.analysis.channels[0].channel, 8);
  now = 1100;
  assert.equal(engine.state.samples[0].analysis.notes[0].note, 72);
  assert.equal(engine.state.samples[0].analysis.channels[0].channel, 8);
  engine.configureSample(sample.id, { channel: null });
  assert.equal(engine.state.samples[0].analysis.channels[0].channel, 4);
  assert.equal(engine.state.samples[0].analysis.notes[0].note, 72);
  await engine.dispose();
});

test('native layer mix silences only its source, resumes held gates, pans real audio and safely reroutes controllers', async () => {
  let Processor; const messages = [];
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => messages.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    const load = (slot, id, note) => processor.command({ type: 'sample', slot, id, data: compileDeck(parseMidi(score(note))), startBeat: processor.sampleClock.beat, gain: .7, program: 16, loop: true, sync: true });
    const render = seconds => {
      const energy = [0, 0];
      for (let block = 0; block < Math.ceil(seconds * 48000 / 128); block++) {
        const output = [new Float32Array(128), new Float32Array(128)]; processor.process([], [output]);
        output.forEach((channel, index) => { for (const value of channel) { assert.ok(Number.isFinite(value)); energy[index] += value ** 2; } });
        globalThis.currentTime += 128 / 48000;
      }
      assert.equal(processor.ready, true); return energy;
    };
    let revision = 0;
    const edit = (slot, id, changes) => processor.command({ type: 'sampleParameters', slot, id, revision: ++revision, ...changes });
    await processor.command({ type: 'noteEffects', config: { enabled: true, echoCount: 2, echoBeats: .5 } });
    await load(0, 1, 60); await load(1, 2, 67); render(.15);
    const sibling = processor.sampleClock.samples[1], position = sibling.timing.positionBeats;
    await edit(0, 1, { muted: true });
    assert.equal(processor.sampleClock.samples[0].config.mute, true);
    assert.deepEqual(processor.noteFx.activePitches(128, 60), []);
    assert.ok(processor.noteFx.activePitches(144, 67).length);
    assert.equal(sibling.timing.positionBeats, position);
    render(.2); assert.deepEqual(processor.noteFx.activePitches(128, 60), [], 'muting cancels queued echoes too');
    const mutedPosition = processor.sampleClock.samples[0].timing.positionBeats;
    await edit(0, 1, { muted: false, solo: true, pan: -1 });
    assert.equal(processor.sampleClock.samples[0].timing.positionBeats, mutedPosition);
    assert.ok(processor.noteFx.activePitches(128, 60).length, 'unmute rejoins the held note');
    assert.deepEqual(processor.noteFx.activePitches(144, 67), []);
    render(.1); const left = render(.2);
    assert.ok(left[0] > left[1] * 8 && left[0] > .01, `left pan ${left}`);
    await edit(0, 1, { pan: 1 }); render(.1); const right = render(.2);
    assert.ok(right[1] > right[0] * 8 && right[1] > .01, `right pan ${right}`);
    const clockBefore = { ...processor.sampleClock.samples[0].timing };
    const routed = transformMidiStamp(score(), { channel: 3 });
    await edit(0, 1, { routing: { data: compileDeck(routed.analysis), pendingReplacement: null }, program: 16 });
    assert.deepEqual(processor.sampleClock.samples[0].timing, clockBefore);
    assert.equal(processor.deckChannels[2].get(3), 128); assert.equal(processor.deckChannels[2].has(0), false);
    assert.ok(processor.noteFx.activePitches(128, 60).length);
    assert.deepEqual(processor.noteFx.activePitches(144, 67), []);
    await edit(0, 1, { midi: { transpose: 12, controllers: { 1: 100 } } });
    await edit(0, 1, { pan: 0 }); assert.equal(processor.sampleClock.samples[0].config.midi.transpose, 12);
    await edit(0, 1, { midi: {} }); assert.deepEqual(processor.sampleClock.samples[0].config.midi, {});
    await processor.command({ type: 'stopSample', slot: 0, id: 1 });
    assert.equal(sibling.config.mute, false); assert.ok(processor.noteFx.activePitches(144, 67).length, 'removing the solo layer restores its sibling');
    await processor.command({ type: 'sample', slot: 0, id: 3, data: compileDeck(parseMidi(score(72, 0, .25))), startBeat: processor.sampleClock.beat, gain: .7, program: 16, loop: false, sync: true, solo: true });
    assert.equal(sibling.config.mute, true); render(.2);
    assert.equal(processor.sampleClock.samples[0], null); assert.equal(sibling.config.mute, false, 'completion of a solo one-shot releases its solo too');
    assert.ok(processor.noteFx.activePitches(144, 67).length);
    await processor.command({ type: 'stopSamples' }); render(.3);
    assert.equal(processor.sampleClock.samples.filter(Boolean).length, 0);
    assert.deepEqual(processor.noteFx.activePitches(128, 60), []); assert.deepEqual(processor.noteFx.activePitches(144, 67), []);
    assert.ok(!messages.some(message => message.type === 'error'));
  } finally {
    await processor.command({ type: 'dispose' });
    for (const key of ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime']) delete globalThis[key];
  }
});

test('falling continuous stamps have matching occupied boundary rows and exact loop durations without altering literal shapes', () => {
  for (const id of CONTINUOUS_MIDI_STAMPS) for (const seed of [1, 17, 230]) for (const density of [0, .5, 1]) for (const span of [12, 48, 128]) {
    const pattern = mixerStampScore(id, { orientation: 'falling', density, seed, span, beats: 3.25 });
    assert.equal(pattern.continuous, true, id);
    assert.deepEqual(pattern.pixels[0], pattern.pixels.at(-1), `${id} boundary`);
    assert.ok(pattern.pixels[0].some(Boolean), `${id} occupied boundary`);
    assert.ok(pattern.pixels.every(row => row.some(Boolean)), `${id} has no empty temporal row`);
    assert.equal(parseMidi(pattern.buffer).durationBeats, 3.25, `${id} duration`);
    assert.ok(pattern.pixels[0].filter(Boolean).length < 110, `${id} closes with a contour, not a full-width chord`);
  }
  for (const id of ['heart', 'square', 'star', 'diamond']) {
    const shape = mixerStampScore(id, { orientation: 'falling' });
    assert.equal(shape.continuous, false); assert.ok(shape.pixels.some(row => !row.some(Boolean)), `${id} retains surrounding space`);
  }
});

test('rerouting and repeated solo-state reads never recount elapsed attacks or resurrect completed layers', async () => {
  let now = 0; const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  const a = engine.triggerSample(score(60, 2), { loop: true, quantize: false });
  const b = engine.triggerSample(score(67, 4), { loop: true, quantize: false });
  now = 9000;
  assert.equal(engine.state.generatedNoteCount, 6, 'two sources, two full eight-beat loops and the current first attacks');
  for (const channel of [9, 15, 0, null, 3, null]) {
    engine.configureSample(a.id, { channel, muted: channel === 9, solo: channel === 15 });
    for (let frame = 0; frame < 10; frame++) assert.equal(engine.state.generatedNoteCount, 6);
    assert.equal(engine.state.samples[0].positionBeats, 2);
  }
  const queued = engine.triggerSample(score(72, 6, 2), { delayBeats: 4, quantize: false, solo: true });
  assert.equal(engine.state.generatedNoteCount, 6);
  assert.ok(engine.state.samples.filter(sample => sample.id !== queued.id).every(sample => sample.effectiveMuted));
  now = 10000; engine.setSamplePaused(queued.id, true);
  now = 20000;
  const paused = engine.state.samples.find(sample => sample.id === queued.id);
  assert.equal(paused.pendingBeats, 2); assert.equal(paused.paused, true);
  assert.equal(engine.state.generatedNoteCount, 12, 'muted sources retain score-clock counting; paused pending solo has no attacks');
  engine.configureSample(queued.id, { channel: 9 });
  for (let frame = 0; frame < 10; frame++) assert.equal(engine.state.generatedNoteCount, 12);
  assert.equal(engine.state.samples.find(sample => sample.id === queued.id).pendingBeats, 2);
  engine.setSamplePaused(queued.id, false);
  now = 21500;
  assert.equal(engine.state.generatedNoteCount, 13);
  now = 22500;
  assert.ok(!engine.state.samples.some(sample => sample.id === queued.id));
  for (let frame = 0; frame < 10; frame++) {
    const state = engine.state;
    assert.equal(state.generatedNoteCount, 13);
    assert.equal(state.samples.length, 2);
    assert.ok(state.samples.every(sample => !sample.effectiveMuted));
  }
  assert.equal(engine.configureSample(queued.id, { channel: null, solo: true }), false);
  engine.stopSample(a.id); engine.stopSample(b.id);
  assert.equal(engine.state.samples.length, 0); assert.equal(engine.state.generatedNoteCount, 13);
  await engine.dispose();
});
