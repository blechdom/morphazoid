import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock, MAX_SAMPLE_EVENTS_PER_BLOCK, MAX_SAMPLE_RESTORES_PER_BLOCK, advanceSampleTiming } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { parseMidi, defaultDeckConfig } from '../src/instruments/midi-mixer/midi-mixer-model.js';

function midi(events, endBeat = 2, ppq = 96) {
  const vlq = value => { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
  let tick = 0; const track = [];
  for (const [beat, ...message] of [...events, [endBeat, 255, 47, 0]]) { const next = Math.round(beat * ppq); track.push(...vlq(next - tick), ...message); tick = next; }
  const result = new Uint8Array(22 + track.length), view = new DataView(result.buffer);
  result.set([77, 84, 104, 100]); view.setUint32(4, 6); view.setUint16(10, 1); view.setUint16(12, ppq);
  result.set([77, 84, 114, 107], 14); view.setUint32(18, track.length); result.set(track, 22); return result.buffer;
}
const tempo = (beat, micros) => [beat, 255, 81, 3, micros >>> 16 & 255, micros >>> 8 & 255, micros & 255];
const changing = () => midi([tempo(0, 1000000), [0, 0xc0, 16], [0, 0x90, 60, 100], [.25, 0x80, 60, 0], tempo(1, 500000), [1, 0x90, 64, 100], [1.25, 0x80, 64, 0]]);
const sample = (data, extra = {}) => ({ id: 1, data, startBeat: 0, config: defaultDeckConfig(), channels: data.channels.map(({ channel }) => ({ channel, mute: false, solo: false, program: null })), ...extra });
function render(clock, frames, tempoAt = () => 120, onBlock = () => {}) {
  let absolute = 0;
  while (absolute < frames) { const size = Math.min(113, frames - absolute); onBlock(absolute); clock.process(size, 48000, tempoAt(absolute)); absolute += size; }
}

test('source-tempo loops retain both tempo segments and do not follow master tempo edits', () => {
  const data = compileDeck(parseMidi(changing())), attacks = [], restores = [], releases = []; let base = 0;
  const clock = new MidiSampleClock({ emit: (source, event, frame) => { if (event.kind === 9) attacks.push([event.a, base + frame, event.durationSeconds]); }, restore: (_source, _history, beat, frame = 0) => restores.push([beat, base + frame]), release: (_source, frame = 0) => releases.push(base + frame) });
  clock.load(0, sample(data, { loop: true, sync: false }));
  render(clock, 150000, frame => frame < 50000 ? 300 : 30, frame => { base = frame; });
  assert.deepEqual(attacks.map(([pitch, frame]) => [pitch, frame]), [[60, 0], [64, 48000], [60, 72000], [64, 120000], [60, 144000]]);
  assert.deepEqual(attacks.map(item => item[2]), [.25, .125, .25, .125, .25]);
  assert.deepEqual(restores.map(item => item[0]), [0, 0, 0]);
  assert.deepEqual(releases, [72000, 144000]);
  assert.equal(clock.samples[0].timing.cycle, 2);
  assert.ok(Math.abs(clock.samples[0].timing.positionBeats - .125) < 1e-9);
});

test('synced loops follow tempo, restore at boundaries, and disabling loop finishes the current pass', () => {
  const data = compileDeck(parseMidi(changing())), attacks = []; let base = 0;
  const clock = new MidiSampleClock({ emit: (_source, event, frame) => { if (event.kind === 9) attacks.push(base + frame); } });
  clock.load(0, sample(data, { loop: true, sync: true }));
  render(clock, 96000, frame => frame < 48000 ? 120 : 240, frame => { base = frame; });
  // The tempo transition is applied at the first physical block after 48k.
  assert.equal(attacks[0], 0); assert.equal(attacks[1], 24000); assert.ok(Math.abs(attacks[2] - 48000) <= 1);
  const before = { ...clock.samples[0].timing };
  clock.setOptions(0, { loop: false });
  assert.deepEqual(clock.samples[0].timing, before);
  render(clock, 48000, () => 240, frame => { base = 96000 + frame; });
  assert.equal(clock.samples[0], null);
  assert.deepEqual(clock.snapshot(), [{ id: 1, revision: undefined, ended: true }]);
  assert.deepEqual(clock.snapshot(), []);
});

test('ordinary two-beat loops repeat beat-zero notes at exact 128-frame block boundaries', () => {
  const data = compileDeck(parseMidi(midi([[0, 0x90, 60, 100], [1, 0x80, 60, 0]]))), attacks = [];
  let base = 0;
  const clock = new MidiSampleClock({ emit: (_source, event, frame) => { if (event.kind === 9) attacks.push(base + frame); } });
  clock.load(0, sample(data, { loop: true }));
  for (let block = 0; block < 1126; block++) { base = block * 128; clock.process(128, 48000, 120); }
  assert.deepEqual(attacks, [0, 48000, 96000, 144000]);
});

test('changing Sync preserves source phase and held voices; pending free playback starts immediately', () => {
  const data = compileDeck(parseMidi(changing())); let emitted = 0, released = 0;
  const clock = new MidiSampleClock({ emit: () => emitted++, release: () => released++ });
  clock.load(0, sample(data, { loop: true, sync: true })); clock.process(12000, 48000, 120);
  const before = { ...clock.samples[0].timing }, count = emitted;
  clock.setOptions(0, { sync: false }); assert.deepEqual(clock.samples[0].timing, before); assert.equal(emitted, count); assert.equal(released, 0);
  clock.process(12000, 48000, 300); assert.ok(Math.abs(clock.samples[0].timing.positionBeats - .75) < 1e-10);
  clock.setOptions(0, { sync: true }); clock.process(12000, 48000, 120); assert.ok(Math.abs(clock.samples[0].timing.positionBeats - 1.25) < 1e-10);
  clock.load(1, sample(data, { startBeat: clock.beat + 1 })); assert.equal(clock.samples[1].timing.pendingBeats, 1);
  clock.setOptions(1, { sync: false }); assert.equal(clock.samples[1].timing.pendingBeats, 0);
});

test('silent preview quantizes without Audio, exposes tempo and cycle, and cancellation cannot replay loops', async () => {
  let now = 0, contexts = 0; const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now }, AudioContext: class { constructor() { contexts++; } } } });
  await engine.loadDeck(0, changing()); engine.play(); now = 100;
  const first = engine.triggerSample(changing(), { loop: true }); assert.equal(first.pending, true); assert.equal(first.positionBeats, 0);
  now = 499; assert.equal(engine.state.samples[0].pending, true); now = 750;
  assert.equal(engine.state.samples[0].pending, false); assert.ok(Math.abs(engine.state.samples[0].positionBeats - .5) < 1e-10);
  engine.configureSamples({ sync: false }); engine.setTempo(300); now = 1000;
  assert.ok(Math.abs(engine.state.samples[0].positionBeats - .75) < 1e-10); assert.equal(engine.state.samples[0].tempo, 60);
  now = 1750; assert.equal(engine.state.samples[0].cycle, 1); assert.equal(engine.state.samples[0].positionBeats, 0);
  engine.configureSamples({ loop: false }); now = 3250; assert.equal(engine.state.samples.length, 0);
  engine.triggerSample(changing(), { loop: true, sync: false }); engine.pause(); assert.equal(engine.state.samples.length, 0);
  engine.triggerSample(changing(), { loop: true }); engine.setAudioEnabled(false); assert.equal(engine.state.samples.length, 0);
  engine.triggerSample(changing(), { loop: true }); engine.stopSamples(); assert.equal(engine.state.samples.length, 0);
  assert.equal(contexts, 0); await engine.dispose();
});

test('hostile one-microsecond tempo loops bound events/restores and skip directly to finite current phase', () => {
  const data = compileDeck(parseMidi(midi([tempo(0, 1), [0, 0x90, 60, 100], [1 / 32767, 0x80, 60, 0]], 1 / 32767, 32767)));
  const start = { positionBeats: 0, pendingBeats: 0, cycle: 0, ended: false };
  assert.deepEqual(advanceSampleTiming(start, data, { loop: true, sync: false }, 0, 0), start);
  assert.equal(advanceSampleTiming(start, data, { loop: false, sync: false }, 0, 0).ended, false);
  let emitted = 0, restores = 0, releases = 0;
  const clock = new MidiSampleClock({ emit: () => emitted++, restore: () => restores++, release: () => releases++ });
  for (let slot = 0; slot < 4; slot++) clock.load(slot, sample(data, { loop: true, sync: false }));
  clock.process(128, 48000, 300);
  assert.ok(emitted <= MAX_SAMPLE_EVENTS_PER_BLOCK); assert.ok(restores <= 4 + MAX_SAMPLE_RESTORES_PER_BLOCK); assert.ok(releases > 0); assert.ok(clock.skippedEvents > 1000000);
  for (const clip of clock.samples) { assert.ok(Number.isFinite(clip.timing.positionBeats)); assert.ok(clip.timing.positionBeats >= 0 && clip.timing.positionBeats < data.durationBeats); }
  const far = advanceSampleTiming(clock.samples[0].timing, data, { loop: true, sync: false }, 1e6, 1e6);
  assert.ok(Number.isFinite(far.cycle)); assert.ok(Number.isFinite(far.positionBeats));
  const restoreCount = restores; clock.process(128, 48000, 300);
  assert.ok(restores - restoreCount <= MAX_SAMPLE_RESTORES_PER_BLOCK, 'whole controller chases share a separate quantum budget');
  clock.stopAll(); const count = emitted; clock.process(128, 48000, 300); assert.equal(emitted, count);
});

test('native quantized launch and source-tempo loop emit at physical frames and Stop releases sounding voices', async () => {
  let Processor; const telemetry = []; globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: message => telemetry.push(message) }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  await import('../src/instruments/midi-mixer/midi-mixer-processor.js'); const processor = new Processor();
  try {
    const font = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
    await processor.command({ type: 'initialize', soundfont: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
    processor.clock.setTransport(true, .25);
    const data = compileDeck(parseMidi(changing()));
    await processor.command({ type: 'sample', slot: 0, id: 4, data, timing: { positionBeats: 0, pendingBeats: .1, cycle: 0, ended: false }, quantize: true, loop: true, sync: true, gain: .8, program: 16 });
    assert.equal(processor.sampleClock.samples[0].timing.pendingBeats, .75);
    let energy = 0;
    const renderNative = frames => { for (let cursor = 0; cursor < frames; cursor += 128) { const size = Math.min(128, frames - cursor), left = new Float32Array(size), right = new Float32Array(size); processor.process([], [[left, right]]); for (const value of left) { assert.ok(Number.isFinite(value)); energy += value * value; } globalThis.currentTime += size / 48000; } processor.publish(); };
    renderNative(20000);
    const first = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []).find(note => note.type === 'noteOn');
    assert.ok(Math.abs(first.at * 48000 - 18000) <= 1); assert.ok(energy > 1);
    const position = processor.sampleClock.samples[0].timing.positionBeats;
    await processor.command({ type: 'sampleParameters', slot: 0, id: 4, loop: true, sync: false, midi: {}, gain: .8 });
    assert.equal(processor.sampleClock.samples[0].timing.positionBeats, position);
    renderNative(160000);
    const attacks = telemetry.flatMap(message => message.type === 'notes' ? message.notes : []).filter(note => note.type === 'noteOn' && note.note === 60);
    assert.ok(attacks.length >= 3); assert.ok(Math.abs((attacks[2].at - attacks[1].at) * 48000 - 72000) <= 2);
    await processor.command({ type: 'stopSamples' }); assert.equal(processor.sampleClock.samples.filter(Boolean).length, 0); assert.equal(processor.sampleVisualCount, 0);
    renderNative(48000); assert.equal(processor.synth.voiceCount, 0);
  } finally { await processor.command({ type: 'dispose' }); delete globalThis.AudioWorkletProcessor; delete globalThis.registerProcessor; delete globalThis.currentTime; delete globalThis.sampleRate; }
});
