import assert from 'node:assert/strict';
import test from 'node:test';
import { RoachSynthAudio, ROACH_VOICE_PRESETS, prepareRoachNativeSamples } from '../src/instruments/roach-synth/roach-synth-audio.js';
import { RoachSynthDsp, normalizeRoachSound, ROACH_MOTION_SOUND_PRESETS, ROACH_SOUND_PRESETS, createDefaultRoachBodyMix } from '../src/instruments/roach-synth/roach-synth-dsp.js';
import { presets as voicesaurusPresets } from '../src/instruments/voicesaurus/native-model.js';

const RATE = 24000;
const voiceSamples = (seconds = .4, frequency = 190) => Float32Array.from({ length: RATE * seconds }, (_, i) => Math.sin(i * Math.PI * 2 * frequency / RATE) * .2);
const joints = ['body', 'abdomen', 'head', 'neck', 'wing_cover_left', 'wing_cover_right', 'wing_hind_left', 'wing_hind_right', 'antenna_left', 'antenna_right',
  ...['left', 'right'].flatMap(side => ['front', 'middle', 'hind'].flatMap(leg => ['proximal', 'mid', 'distal'].map(segment => `${side}_${leg}_leg_${segment}`)))]
  .map(name => ({ id: name, jointId: name, name, offset: { x: 0, y: 0, z: 0 } }));
const bodyMix = (source) => createDefaultRoachBodyMix().map(row => ({ ...row, source, level: row.groupId === 'head' ? 1 : 0 }));
function render(dsp, seconds) {
  const left = new Float32Array(Math.round(RATE * seconds)), right = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 128) dsp.render(left.subarray(i, i + 128), right.subarray(i, i + 128));
  const energy = left.reduce((sum, value, i) => sum + value * value + right[i] * right[i], 0);
  return { left, right, rms: Math.sqrt(energy / (left.length * 2)), peak: Math.max(...left.map(Math.abs), ...right.map(Math.abs)) };
}
function fixture() {
  const contexts = [], workers = [], messages = [];
  class Node {
    constructor() { this.gain = { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }; }
    connect() {} disconnect() {}
  }
  class Context {
    constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = new Node(); this.audioWorklet = { addModule: async () => {} }; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { return new Node(); }
  }
  class Worklet extends Node {
    constructor() {
      super(); this.dsp = new RoachSynthDsp(RATE);
      this.port = { close() {}, postMessage: (message) => {
        messages.push(structuredClone(message));
        if (message.type === 'state') this.dsp.update(message.state);
        if (message.type === 'body-voice') this.dsp.setBodyVoice(message.source, message.samples, message.sampleRate);
        if (message.type === 'speak-samples') this.dsp.speakSamples(message.samples, message.sampleRate);
        if (message.type === 'stop-speech') this.dsp.stopSpeech();
      } };
    }
  }
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.terminated = false; workers.push(this); }
    postMessage(message) { this.request = message; }
    terminate() { this.terminated = true; }
    ready(samples = voiceSamples()) { this.onmessage({ data: { type: 'ready', samples, sampleRate: RATE } }); }
  }
  return { contexts, workers, messages, runtime: { AudioContext: Context, AudioWorkletNode: Worklet, Worker,
    performance: { now: () => 0 }, fetch: async () => ({ ok: false }) } };
}

test('four Roach voices preserve actual new Voicesaurus presets and become selectable body sounds', () => {
  assert.equal(ROACH_VOICE_PRESETS.length, 4);
  for (const preset of ROACH_VOICE_PRESETS) {
    const original = voicesaurusPresets.find(item => item.id === preset.id);
    assert.ok(original); assert.equal(preset.engine, original.snapshot.engine);
    assert.deepEqual(preset.values, original.snapshot.values);
    const patch = ROACH_SOUND_PRESETS.find(item => item.id === `body-${preset.bodySource}`);
    assert.equal(patch.sound.voicePreset, preset.id);
    assert.ok(patch.bodyMix.some(row => row.source === preset.bodySource));
    assert.equal(normalizeRoachSound({ voicePreset: preset.id }).voicePreset, preset.id);
  }
  assert.equal(normalizeRoachSound({ level: 1 }).level, 1);
  assert.equal(normalizeRoachSound({ level: 100 }).level, 1);
});

test('native speech uses one disposable worker, preserves animation pause, and remains metered through the worklet', async () => {
  const f = fixture(), audio = new RoachSynthAudio({ runtime: f.runtime });
  audio.setVoicePreset(ROACH_VOICE_PRESETS[1].id);
  assert.equal(f.contexts.length, 0); assert.equal(f.workers.length, 0);
  assert.equal(await audio.speak('Audio is off'), false);
  try {
    await audio.enable({ joints, playing: false, soundPlaying: false, time: 3, bodyMix: bodyMix('sine') });
    const phrase = audio.speak('A whole sentence, with native prosody.');
    const worker = f.workers.at(-1);
    assert.equal(worker.request.engine, 'espeak-klatt');
    assert.equal(worker.request.text, 'A whole sentence, with native prosody.');
    assert.deepEqual(worker.request.values, ROACH_VOICE_PRESETS[1].values);
    assert.match(worker.url.pathname, /voicesaurus\/native-worker\.js$/);
    worker.ready(); assert.equal(await phrase, true); assert.equal(worker.terminated, true);
    assert.equal(audio.voiceJobs.size, 0);
    const result = render(audio.node.dsp, .25);
    assert.ok(result.rms > .02); assert.ok(result.peak < .9);
    assert.ok(audio.node.dsp.telemetry.speechEnvelope > .001);
    assert.equal(audio.node.dsp.time, 3); assert.equal(audio.node.dsp.soundTime, 0);
    audio.disable(); render(audio.node.dsp, .4); await audio.enable();
    assert.ok(render(audio.node.dsp, .2).peak < 1e-6, 'rearming cannot revive an old spoken phrase');
  } finally { audio.dispose(); }
});

test('changing or muting a voice cancels pending native work and cannot publish a stale sentence', async () => {
  const f = fixture(), audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    await audio.enable();
    const first = audio.speak('first'); const worker = f.workers.at(-1);
    audio.setVoicePreset(ROACH_VOICE_PRESETS[2].id);
    assert.equal(await first, false); assert.equal(worker.terminated, true);
    worker.ready(); assert.equal(f.messages.filter(message => message.type === 'speak-samples').length, 0);
    const second = audio.speak('ah'); const next = f.workers.at(-1);
    audio.disable(); assert.equal(await second, false); assert.equal(next.terminated, true);
    assert.equal(audio.voiceJobs.size, 0);
  } finally { audio.dispose(); }
});

test('native body samples load only after Audio arm and real group motion, release, and respect body mute', async () => {
  const f = fixture(), audio = new RoachSynthAudio({ runtime: f.runtime }), preset = ROACH_VOICE_PRESETS[0];
  audio.update({ joints, bodyMix: bodyMix(preset.bodySource), playing: false, motion: { presetId: 'none', antennae: false } });
  assert.equal(f.workers.length, 0); assert.equal(f.contexts.length, 0);
  try {
    await audio.enable(); const pending = audio.loadBodyVoices();
    await Promise.resolve(); assert.equal(f.workers.length, 1);
    const worker = f.workers[0]; assert.equal(worker.request.text, 'ah'); worker.ready(); await pending;
    assert.deepEqual(audio.getState().bodyVoicesLoaded, [preset.bodySource]);
    const dsp = audio.node.dsp; assert.equal(render(dsp, .1).peak, 0);
    dsp.interact({ jointId: 'head', active: true, velocity: 1 });
    assert.ok(render(dsp, .15).rms > .01);
    assert.equal(dsp.body.voices[0].voiceActive, false, 'head motion must not excite the legs voice');
    dsp.update({ resetActivity: true }); render(dsp, .5);
    assert.ok(render(dsp, .1).peak < 1e-7);
    dsp.update({ bodyMix: bodyMix(preset.bodySource).map(row => ({ ...row, level: 0 })) });
    render(dsp, .6); dsp.interact({ jointId: 'head', active: true, velocity: 1 });
    assert.ok(render(dsp, .2).peak < 1e-7);
    assert.equal(audio.getState().playing, false);
  } finally { audio.dispose(); }
});

test('native sample preparation preserves fixed engine trim and rejects unbounded/corrupt PCM', () => {
  const preset = ROACH_VOICE_PRESETS[1], samples = voiceSamples(.2);
  const result = prepareRoachNativeSamples({ samples, sampleRate: RATE }, preset);
  assert.notEqual(result.samples, samples); assert.equal(result.samples.length, samples.length);
  assert.ok(Math.abs(result.samples[100] - samples[100] * preset.trim) < 1e-7);
  assert.throws(() => prepareRoachNativeSamples({ samples: new Float32Array([NaN]), sampleRate: RATE }, preset));
  assert.throws(() => prepareRoachNativeSamples({ samples: new Float32Array(RATE * 5), sampleRate: RATE }, preset, { body: true }));
});

test('all animation companions have useful maximum output, headroom, and a genuine 80–100% level range', () => {
  for (const preset of ROACH_MOTION_SOUND_PRESETS) {
    const dsp = new RoachSynthDsp(RATE);
    dsp.update({ joints, enabled: true, playing: true, soundPlaying: true, mappings: [],
      motion: { presetId: preset.motionId, tempo: 108 }, bodyMix: preset.bodyMix, sound: { ...preset.sound, level: 1 } });
    render(dsp, .1); const result = render(dsp, 1.5);
    assert.ok(result.rms >= .18 && result.rms < .4, `${preset.motionId}: ${result.rms}`);
    assert.ok(result.peak <= .9, `${preset.motionId}: ${result.peak}`);
    assert.ok(result.left.every(Number.isFinite)); assert.ok(result.right.every(Number.isFinite));
  }
  const held = level => {
    const dsp = new RoachSynthDsp(RATE);
    dsp.update({ joints, enabled: true, soundPlaying: true, sound: { level }, mappings: [] });
    render(dsp, .1); return render(dsp, .6).rms;
  };
  assert.ok(held(1) > held(.8) * 1.08, 'the top 20% must increase audible output');
  assert.equal(held(0), 0);
});
