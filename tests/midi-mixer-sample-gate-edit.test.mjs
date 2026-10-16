import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function score(notes, end = 8, control = 90) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  const events = [[0, 0xb0, 7, control]];
  for (const [pitch, beat, duration, velocity = 100] of notes) events.push([beat, 0x90, pitch, velocity], [beat + duration, 0x80, pitch, 0]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); events.push([end, 255, 47, 0]);
  let tick = 0; const track = [];
  for (const [beat, ...message] of events) { const next = Math.round(beat * 480); track.push(...vlq(next - tick), ...message); tick = next; }
  const bytes = new Uint8Array(22 + track.length), view = new DataView(bytes.buffer);
  bytes.set([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107]); view.setUint32(18, track.length); bytes.set(track, 22);
  return bytes.buffer;
}
const data = (...args) => compileDeck(parseMidi(score(...args)));
const editable = { allowGateEdits: true };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('gate edits require opt-in, retain stable attacks/counts/phase and reject rewritten attacks or controllers', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now * 1000 } } });
  try {
    const first = engine.triggerSample(score([[60, 0, .5]]), { quantize: false });
    engine.triggerSample(score([[40, 0, 6]]), { quantize: false, loop: true });
    now = .1; const before = engine.state, id = before.samples[0].analysis.notes[0].id;
    assert.equal(before.generatedNoteCount, 2);
    assert.equal(engine.appendSample(first.id, score([[60, 0, 1]])), false);
    for (const notes of [[[61, 0, 1]], [[60, .1, 1]], [[60, 0, 1, 99]]]) assert.equal(engine.appendSample(first.id, score(notes), editable), false);
    assert.equal(engine.appendSample(first.id, score([[60, 0, 1]], 8, 91), editable), false);
    const result = engine.appendSample(first.id, score([[60, 0, 1], [64, .75, .5]]), editable);
    assert.ok(result); assert.equal(result.analysis.notes[0].id, id); near(result.positionBeats, before.samples[0].positionBeats);
    assert.deepEqual(engine.state.samples[1], before.samples[1]); assert.equal(engine.state.generatedNoteCount, 2);
    now = .3; assert.ok(engine.appendSample(first.id, score([[60, 0, 1.5], [64, .75, .5]]), editable));
    assert.equal(engine.state.generatedNoteCount, 2);
    now = .4; assert.equal(engine.state.generatedNoteCount, 3);
    assert.equal(engine.appendSample(first.id, score([[60, 0, 1.5], [64, .75, .5], [67, .5, 1]]), editable), false);
    assert.equal(engine.appendSample(first.id, score([[64, .75, .5]]), editable), false);
    const held = engine.state.samples[0]; engine.setSamplePaused(first.id, true);
    now = 2; assert.ok(engine.appendSample(first.id, score([[60, 0, 2], [64, .75, .5]]), editable));
    near(engine.state.samples[0].positionBeats, held.positionBeats); assert.equal(engine.state.generatedNoteCount, 3);
  } finally { await engine.dispose(); }
});

test('audio clock extends one gate without replay, releases shortened gates once and leaves sibling timing alone', () => {
  const emitted = [], released = [], clock = new MidiSampleClock({ emit: (source, event) => emitted.push({ source, event }), release: source => released.push(source) });
  clock.load(0, { id: 1, revision: 0, data: data([[60, 0, .5]]), startBeat: 0 });
  clock.load(1, { id: 2, revision: 0, data: data([[40, 0, 6]]), startBeat: 0, loop: true });
  clock.process(4800, 48000, 120);
  const sibling = clock.samples[1], timing = { ...sibling.timing }, releases = released.length;
  assert.equal(clock.appendScore(0, data([[60, 0, 1]]), 1), false);
  assert.equal(clock.samples[0].revision, 0);
  assert.ok(clock.appendScore(0, data([[60, 0, 1]]), 1, editable));
  near(clock.samples[0].timing.positionBeats, .2); assert.deepEqual(sibling.timing, timing);
  clock.process(12000, 48000, 120);
  assert.equal(emitted.filter(({ source, event }) => source === 2 && event.kind === 9).length, 1);
  assert.equal(emitted.filter(({ source, event }) => source === 2 && event.kind === 8).length, 0);
  assert.equal(released.length, releases);
  assert.ok(clock.appendScore(0, data([[60, 0, .6], [64, 1, .5]]), 2, editable));
  assert.equal(emitted.filter(({ source, event }) => source === 2 && event.kind === 8).length, 1);
  clock.process(24000, 48000, 120);
  assert.deepEqual(emitted.filter(({ source, event }) => source === 2 && event.kind === 9).map(({ event }) => event.a), [60, 64]);
  assert.deepEqual(emitted.filter(({ source, event }) => source === 2 && event.kind === 8).map(({ event }) => event.a), [60, 64]);
  assert.equal(clock.samples[1], sibling); near(sibling.timing.positionBeats, 1.7);
});

test('gate release exactly at the current audio boundary occurs once, including a later append', () => {
  const emitted = [], clock = new MidiSampleClock({ emit: (_source, event) => emitted.push(event) });
  clock.load(0, { id: 1, revision: 0, data: data([[60, 0, 1]]), startBeat: 0 });
  clock.process(12000, 48000, 120);
  clock.appendScore(0, data([[60, 0, .5]]), 1, editable);
  clock.appendScore(0, data([[60, 0, .5], [67, 2, .5]]), 2, editable);
  clock.process(24000, 48000, 120);
  assert.deepEqual(emitted.filter(event => event.kind === 8 || event.kind === 9).map(event => [event.kind, event.a]), [[9, 60], [8, 60]]);
});

test('late gate extension cannot resurrect a released note on resync, but its next authored loop can play', () => {
  const emitted = [], joined = [], clock = new MidiSampleClock({ emit: (_source, event) => emitted.push(event), rehydrate: (_source, events) => joined.push(...events) });
  clock.load(0, { id: 1, revision: 0, data: data([[60, 0, .25]], 2), startBeat: 0 });
  clock.process(12000, 48000, 120);
  clock.appendScore(0, data([[60, 0, 1.5]], 2), 1, editable);
  clock.setPaused(0, true, 2); clock.setPaused(0, false, 3);
  assert.equal(joined.length, 0);
  clock.appendScore(0, data([[60, 0, 1.75]], 2), 4, editable);
  clock.process(36000, 48000, 120);
  assert.deepEqual(emitted.filter(event => event.kind === 8 || event.kind === 9).map(event => event.kind), [9, 8]);
  // Start a fresh capture to verify the first-pass suppression is cycle-scoped.
  clock.load(0, { id: 2, revision: 0, data: data([[60, 0, .25]], 2), startBeat: clock.beat });
  clock.process(12000, 48000, 120); clock.appendScore(0, data([[60, 0, 1.5]], 2), 1, editable);
  clock.setOptions(0, { loop: true }); clock.process(48000, 48000, 120);
  assert.equal(emitted.filter(event => event.kind === 9).length, 3);
  assert.ok(clock.samples[0].timing.cycle > 0);
});

test('pending gates can change before their first attack and late finalization acknowledges the edited revision', () => {
  const emitted = [], released = [], clock = new MidiSampleClock({ emit: (_source, event) => emitted.push(event), release: source => released.push(source) });
  clock.load(0, { id: 1, revision: 0, data: data([[60, 0, .5]]), startBeat: 1 });
  clock.appendScore(0, data([[60, 0, 1]]), 1, editable);
  clock.process(36000, 48000, 120);
  assert.equal(emitted.filter(event => event.kind === 9).length, 1);
  assert.equal(emitted.filter(event => event.kind === 8).length, 0);
  clock.appendScore(0, data([[60, 0, .25]], .25), 2, editable);
  assert.equal(clock.samples[0], null); assert.equal(released.length, 1);
  assert.deepEqual(clock.snapshot().map(({ id, revision, ended }) => ({ id, revision, ended })), [{ id: 1, revision: 2, ended: true }]);
});

test('single-note latch preserves its count past 512 beats, supports delay and pause, and rejects a multi-note latch', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now * 1000 } } });
  try {
    assert.equal(engine.triggerSample(score([[60, 0, 1], [64, 2, 1]]), { hold: true }), false);
    const layer = engine.triggerSample(score([[60, 0, 1]], 1), { hold: true, delayBeats: 2, quantize: false });
    const phrase = score([[60, 0, 1], [64, 2, 1]]);
    assert.equal(engine.appendSample(layer.id, phrase, editable), false);
    assert.equal(engine.replaceSample(layer.id, phrase, { when: 'live' }), false);
    now = .5; assert.equal(engine.state.generatedNoteCount, 0); assert.equal(engine.state.samples[0].pendingBeats, 1);
    now = 3600; const held = engine.state.samples[0];
    assert.equal(held.hold, true); assert.equal(held.paused, false); assert.equal(held.cycle, 0);
    near(held.positionBeats, 1 - 1 / 480); assert.equal(engine.state.generatedNoteCount, 1);
    engine.setSamplePaused(layer.id, true); now = 7200; near(engine.state.samples[0].positionBeats, held.positionBeats);
    engine.setSamplePaused(layer.id, false); engine.configureSample(layer.id, { pan: -.6, gain: .2, channel: 4, program: 16 });
    now = 10800; assert.equal(engine.state.generatedNoteCount, 1); assert.equal(engine.state.samples[0].analysis.notes[0].channel, 4);
    assert.equal(engine.configureSample(layer.id, { hold: false }).hold, false);
    now += .1; assert.equal(engine.state.samples.length, 0); assert.equal(engine.state.generatedNoteCount, 1);
    const second = engine.triggerSample(score([[64, 0, 1]], 1), { quantize: false });
    now += .1; assert.equal(engine.configureSample(second.id, { hold: true }).hold, true);
    now += 7200; assert.equal(engine.state.samples.length, 1); engine.stopSample(second.id); assert.equal(engine.state.samples.length, 0);
    const released = engine.triggerSample(score([[60, 0, .25]], 8), { quantize: false });
    now += 1; assert.equal(engine.configureSample(released.id, { hold: true }), false);
  } finally { await engine.dispose(); }
});

test('latched audio-frame timing stops before note-off and continues siblings; release, pause and free time remain coherent', () => {
  for (const sync of [true, false]) {
    const emitted = [], joined = [], released = [];
    const clock = new MidiSampleClock({ emit: (source, event) => emitted.push({ source, event }), rehydrate: (source, events) => joined.push({ source, events }), release: source => released.push(source) });
    clock.load(0, { id: 1, revision: 0, data: data([[60, 0, 1]], 1), startBeat: 1, hold: true, sync });
    clock.load(1, { id: 2, revision: 0, data: data([[40, 0, 6]]), startBeat: 0 });
    clock.process(12000, 48000, 120); assert.equal(emitted.filter(({ source }) => source === 2).length, 0);
    clock.process(14400000, 48000, 120);
    assert.equal(clock.samples[0].timing.ended, false); assert.equal(clock.samples[0].timing.cycle, 0);
    near(clock.samples[0].timing.positionBeats, 1 - 1 / 480); assert.equal(clock.samples[1], null);
    assert.deepEqual(emitted.filter(({ source, event }) => source === 2 && [8, 9].includes(event.kind)).map(({ event }) => event.kind), [9]);
    clock.setPaused(0, true, 1); const before = { ...clock.samples[0].timing }; clock.process(48000, 48000, 120);
    assert.deepEqual(clock.samples[0].timing, before); clock.setPaused(0, false, 2);
    assert.deepEqual(joined.at(-1).events.map(event => event.a), [60]);
    clock.setOptions(0, { hold: false, revision: 3 }); clock.process(48000, 48000, 120);
    assert.equal(clock.samples[0], null); assert.equal(released.filter(source => source === 2).length, 2);
  }
});

test('native SoundFont keeps the same live gate across extensions, then releases it once without muting another layer', async () => {
  let Processor; const messages = [];
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => messages.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    const sounded = [], originalSound = processor.soundEffectNote.bind(processor);
    processor.soundEffectNote = event => { sounded.push(event); originalSound(event); };
    for (const [slot, pitch] of [[0, 60], [1, 40]]) await processor.command({ type: 'sample', slot, id: slot + 1, revision: 0, data: data([[pitch, 0, slot ? 6 : .5]]), startBeat: 0, gain: .5, program: 16, loop: false, sync: true });
    const render = seconds => { let energy = 0; for (let i = 0; i < Math.ceil(seconds * 48000 / 128); i++) { const channels = [new Float32Array(128), new Float32Array(128)]; processor.process([], [channels]); for (const value of channels[0]) energy += value * value; globalThis.currentTime += 128 / 48000; } return energy; };
    assert.ok(render(.1) > .001); const sibling = processor.sampleClock.samples[1], firstAttack = sounded.find(event => event.type === 'noteOn' && event.note === 60);
    for (let revision = 1; revision <= 5; revision++) {
      const before = { ...processor.sampleClock.samples[0].timing };
      await processor.command({ type: 'sampleAppend', slot: 0, id: 1, revision, allowGateEdits: true, data: data([[60, 0, .5 + revision * .25]]) });
      assert.deepEqual(processor.sampleClock.samples[0].timing, before);
      assert.ok(render(.08) > .001); assert.ok(processor.noteFx.activePitches(128, 60).length);
    }
    assert.equal(sounded.filter(event => event.type === 'noteOn' && event.note === 60).length, 1);
    assert.equal(sounded.filter(event => event.type === 'noteOff' && event.note === 60).length, 0);
    await processor.command({ type: 'sampleAppend', slot: 0, id: 1, revision: 6, allowGateEdits: true, data: data([[60, 0, .75], [67, 1.5, .5]]) });
    assert.equal(processor.noteFx.activePitches(128, 60).length, 0);
    const released = sounded.filter(event => event.type === 'noteOff' && event.note === 60);
    assert.equal(released.length, 1); assert.equal(released[0].id, firstAttack.id);
    assert.equal(processor.sampleClock.samples[1], sibling); assert.ok(processor.noteFx.activePitches(144, 40).length);
    assert.ok(render(.65) > .001);
    assert.equal(sounded.filter(event => event.type === 'noteOn' && event.note === 67).length, 1);
    assert.equal(sounded.filter(event => event.type === 'noteOff' && event.note === 60).length, 1);
    assert.equal(processor.noteFx.activePitches(128, 67).length, 0);
    await processor.command({ type: 'stopSamples' });
    await processor.command({ type: 'sample', slot: 0, id: 3, revision: 0, data: data([[72, 0, 1]], 1), startBeat: processor.sampleClock.beat, gain: .5, program: 16, hold: true, loop: false, sync: true });
    await processor.command({ type: 'tempo', tempo: 4800 });
    assert.ok(render(7) > .001);
    assert.ok(processor.sampleClock.beat > 512); assert.equal(processor.sampleClock.samples[0].timing.cycle, 0);
    assert.equal(sounded.filter(event => event.type === 'noteOn' && event.note === 72).length, 1);
    assert.equal(sounded.filter(event => event.type === 'noteOff' && event.note === 72).length, 0);
    assert.ok(processor.noteFx.activePitches(128, 72).length);
    await processor.command({ type: 'samplePaused', slot: 0, id: 3, revision: 1, paused: true });
    assert.equal(processor.noteFx.activePitches(128, 72).length, 0); render(.1);
    await processor.command({ type: 'samplePaused', slot: 0, id: 3, revision: 2, paused: false });
    assert.ok(processor.noteFx.activePitches(128, 72).length); assert.ok(render(.1) > .001);
    await processor.command({ type: 'sampleParameters', slot: 0, id: 3, revision: 3, muted: true });
    assert.equal(processor.noteFx.activePitches(128, 72).length, 0);
    await processor.command({ type: 'sampleParameters', slot: 0, id: 3, revision: 4, muted: false });
    assert.ok(processor.noteFx.activePitches(128, 72).length);
    await processor.command({ type: 'sampleParameters', slot: 0, id: 3, revision: 5, gain: .3, pan: -.5, midi: { transpose: 12 } });
    assert.ok(processor.noteFx.activePitches(128, 72).length);
    assert.ok(render(.1) > .001); near(processor.sampleClock.samples[0].config.pan, -.5);
    await processor.command({ type: 'sample', slot: 1, id: 4, revision: 0, data: data([[40, 0, 1]], 1), startBeat: processor.sampleClock.beat, gain: .5, program: 16, hold: true, loop: false, sync: true });
    render(.1);
    await processor.command({ type: 'sampleParameters', slot: 1, id: 4, revision: 1, solo: true });
    assert.equal(processor.noteFx.activePitches(128, 72).length, 0); assert.ok(processor.noteFx.activePitches(144, 40).length);
    await processor.command({ type: 'sampleParameters', slot: 1, id: 4, revision: 2, solo: false });
    assert.ok(processor.noteFx.activePitches(128, 72).length);
    await processor.command({ type: 'stopSample', slot: 0, id: 3 });
    assert.equal(processor.noteFx.activePitches(128, 72).length, 0); assert.equal(processor.sampleClock.samples[0], null);
    assert.ok(processor.noteFx.activePitches(144, 40).length); await processor.command({ type: 'stopSamples' });
    assert.ok(!messages.some(message => message.type === 'error'));
  } finally { await processor.command({ type: 'dispose' }); for (const key of ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime']) delete globalThis[key]; }
});
