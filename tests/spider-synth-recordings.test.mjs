import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SpiderRecordingBank, SPIDER_RECORDINGS, SPIDER_RECORDING_MAX_VOICES } from '../src/spider-synth-recordings.js';
import { SpiderSynthDsp, createDefaultSpiderBodyMix, SPIDER_SOUND_PRESETS } from '../src/spider-synth-dsp.js';
import { SpiderSynthAudio } from '../src/spider-synth-audio.js';
import { spiderRecordingFixture } from './helpers/spider-recording-fixture.mjs';

const mix = (source, group = 'abdomen') => createDefaultSpiderBodyMix().map(row => ({ ...row, source, level: row.groupId === group ? .7 : 0 }));
function dsp(source = 'peacock-rumble', group = 'abdomen') {
  const d = new SpiderSynthDsp(24000); d.setSampleBank(spiderRecordingFixture);
  d.update({ enabled: true, motion: { preset: 'listen', explore: false }, sound: { space: 0 }, bodyMix: mix(source, group) }); return d;
}
function render(d, duration) {
  const left = new Float32Array(Math.round(d.sampleRate * duration)), right = new Float32Array(left.length);
  const telemetry = { ...d.render(left, right) };
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  return { ...telemetry, left, right };
}
const note = (note = 69, sourceId = 'keys') => ({ type: 'noteOn', note, velocity: 100, sourceId, channel: 0 });

test('three real, separately credited peacock articulations have verified finite compact PCM assets', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/audio/spider-synth/manifest.json', import.meta.url)));
  assert.equal(manifest.species, 'Maratus volans'); assert.equal(manifest.license, 'CC BY 4.0');
  assert.equal(manifest.records.length, 3); let total = 0;
  for (const [i, metadata] of manifest.records.entries()) {
    const file = readFileSync(new URL(`../assets/audio/spider-synth/${metadata.filename}`, import.meta.url)); total += file.length;
    assert.equal(createHash('sha256').update(file).digest('hex'), metadata.sha256);
    assert.equal(file.toString('ascii', 0, 4), 'RIFF'); assert.equal(file.readUInt16LE(22), 1); assert.equal(file.readUInt16LE(34), 16);
    const sample = spiderRecordingFixture[i]; assert.equal(sample.sampleRate, 22050);
    assert.ok(Math.abs(sample.data.length / sample.sampleRate - SPIDER_RECORDINGS[i].duration) < .001);
    let peak = 0, energy = 0; for (const value of sample.data) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); energy += value * value; }
    assert.ok(peak > .7 && peak < .761); assert.ok(Math.sqrt(energy / sample.data.length) > .04);
    assert.equal(sample.data[0], 0); assert.equal(sample.data.at(-1), 0);
  }
  assert.ok(total < 270000); assert.equal(new Set(manifest.records.map(record => record.sha256)).size, 3);
});

test('loaded recordings stay silent in a held pose and sound only from measured movement', () => {
  for (const source of SPIDER_RECORDINGS) {
    const d = dsp(source.id); d.update({ soundPlaying: true }); assert.equal(render(d, .3).peak, 0);
    d.update({ motion: { offsets: { abdomen: { x: .5, y: .2, z: .1 } } } });
    const moving = render(d, .25); assert.ok(moving.peak > .005, source.id); assert.ok(moving.recordingEvents > 0);
    const events = moving.recordingEvents; render(d, 2); const held = render(d, .1);
    assert.equal(held.recordingEvents, events); assert.equal(held.activeRecordings, 0); assert.ok(held.peak < 1e-6);
    assert.equal(d.playing, false); assert.equal(d.time, 0);
  }
});

test('actual leg contacts trigger recorded percussion and stopping animation cannot loop it', () => {
  const d = dsp('peacock-crunch', 'legs'); d.update({ playing: true, motion: { preset: 'orb-walk', tempo: 180, explore: false } });
  const moving = render(d, 1.2); assert.ok(moving.contactEvents >= 8); assert.ok(moving.recordingEvents >= 3); assert.ok(moving.peak > .005);
  d.update({ playing: false }); render(d, 2); const events = d.recordings.events; const stopped = render(d, .3);
  assert.equal(stopped.recordingEvents, events); assert.equal(stopped.activeRecordings, 0); assert.ok(stopped.peak < 1e-6);
});

test('recorded MIDI notes retain ownership, bend, expression and silence after release', () => {
  const d = dsp('peacock-grind'); d.midi(note()); render(d, .08);
  const voice = d.recordings.voices.find(voice => voice.active && voice.owner); assert.ok(voice);
  const firstRate = voice.targetRate; d.midi({ type: 'pitchBend', normalized: 1, sourceId: 'keys', channel: 0 }); render(d, .03);
  assert.ok(voice.targetRate > firstRate * 1.1);
  d.midi({ type: 'controlChange', controller: 11, value: 0, sourceId: 'keys', channel: 0 }); render(d, .2); assert.equal(voice.targetExpression, 0);
  assert.ok(render(d, .04).peak < 1e-4);
  const events=d.recordings.events; d.midi({ ...note(), type: 'noteOff', velocity: 0 }); render(d, .2); assert.equal(d.recordings.events,events);
  assert.ok(d.recordings.voices.every(voice => !voice.active)); assert.equal(d.playing, false);
});

test('scoped panic releases its recording without removing another source or a direct gesture', () => {
  const bank = new SpiderRecordingBank(24000); bank.setBank(spiderRecordingFixture);
  const a = { active: true, held: true, note: 60, order: 1, sourceId: 'a', channel: 0 };
  const b = { ...a, order: 2, sourceId: 'b' };
  bank.trigger(0, 0, .8, 0, a); bank.trigger(1, 1, .8, 0, b); bank.trigger(2, 2, .8, 0);
  bank.release(-1, { sourceId: 'a' }, true);
  assert.equal(bank.voices[0].release, true); assert.equal(bank.voices[1].release, false); assert.equal(bank.voices[2].release, false);
});

test('voice, tail and retrigger bounds remain fixed under dense calls, with a clean Audio mute', () => {
  const d = dsp();
  for (let i = 0; i < 1000; i++) d.recordings.trigger(i % 3, i % 8, 1, i * .16);
  assert.equal(d.recordings.voices.length, SPIDER_RECORDING_MAX_VOICES); assert.equal(d.recordings.voices.filter(v => v.active).length, 8);
  assert.ok(d.recordings.dropped > 0); assert.ok(render(d, .2).peak < .95);
  d.update({ enabled: false }); render(d, 1); const silent = render(d, .1);
  assert.equal(silent.activeRecordings, 0); assert.ok(silent.peak < 1e-6);
});

test('bank validation is transactional and unavailable recordings never invent a substitute', () => {
  const bank = new SpiderRecordingBank(24000); assert.equal(bank.trigger(0, 0, 1, 0), false);
  bank.setBank(spiderRecordingFixture); const previous = bank.bank[0];
  assert.throws(() => bank.setBank([spiderRecordingFixture[0], { id: 'peacock-crunch', data: new Float32Array(1), sampleRate: 22050 }]));
  assert.equal(bank.bank[0], previous); assert.equal(bank.events, 0);
  assert.throws(() => bank.setBank([spiderRecordingFixture[0], spiderRecordingFixture[0]]));
});

function adapter() {
  const requests = [], messages = [];
  class Node { constructor() { this.gain = { value: 0, cancelScheduledValues() {}, setTargetAtTime() {} }; } connect() {} disconnect() {} }
  class Context { constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); this.audioWorklet = { addModule: async () => {} }; }
    createGain() { return new Node(); } close() { return Promise.resolve(); }
    async decodeAudioData(bytes) { const view = new DataView(bytes), rate = view.getUint32(24, true), data = new Float32Array((bytes.byteLength - 44) / 2);
      for (let i = 0; i < data.length; i++) data[i] = view.getInt16(44 + i * 2, true) / 32768;
      return { duration: data.length / rate, sampleRate: rate, numberOfChannels: 1, getChannelData: () => data }; }
  }
  class Worklet extends Node { constructor() { super(); this.port = { postMessage: message => messages.push(message), close() {} }; } }
  return { requests, messages, runtime: { AudioContext: Context, AudioWorkletNode: Worklet, performance: { now: () => 0 },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) } };
}

test('recording I/O is lazy, never gates Audio, and transfers finite small data only after decode', async () => {
  const f = adapter(), audio = new SpiderSynthAudio({ runtime: f.runtime }); assert.equal(f.requests.length, 0);
  await audio.enable(); assert.equal(audio.enabled, true); assert.equal(audio.ready, true); assert.equal(f.requests.length, 3);
  for (const request of f.requests) { const bytes = readFileSync(request.url); request.resolve({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }); }
  await audio.samplesPromise; const message = f.messages.find(message => message.type === 'sample-bank');
  assert.equal(message.samples.length, 3); assert.equal(audio.getState().samplesStatus, 'ready');
  assert.ok(message.samples.every(sample => sample.data.every(Number.isFinite))); audio.dispose();
});

test('recording network failure and disposal preserve ordinary synthesis and do not publish stale samples', async () => {
  const f = adapter(), audio = new SpiderSynthAudio({ runtime: f.runtime }); await audio.enable();
  for (const request of f.requests) request.resolve({ ok: false }); await audio.samplesPromise;
  assert.equal(audio.enabled, true); assert.equal(audio.getState().samplesStatus, 'unavailable');
  audio.disable(); await audio.enable(); const pending = audio.samplesPromise; audio.dispose();
  for (const request of f.requests.slice(3)) { assert.equal(request.options.signal.aborted, true); request.resolve({ ok: false }); }
  await pending; assert.equal(f.messages.some(message => message.type === 'sample-bank'), false);
});

test('recorded presets preserve the original preset addresses and declare all three real sources', () => {
  assert.equal(SPIDER_SOUND_PRESETS[23].id, 'singing-architecture');
  const presets = SPIDER_SOUND_PRESETS.filter(preset => preset.id.startsWith('peacock-')); assert.equal(presets.length, 3);
  for (const source of SPIDER_RECORDINGS) assert.ok(presets.some(preset => preset.bodyMix.some(row => row.source === source.id)));
});
