import assert from 'node:assert/strict';
import test from 'node:test';
import { RoachSynthAudio, ROACH_VOICE_PRESETS, prepareRoachNativeSamples } from '../src/instruments/roach-synth/roach-synth-audio.js';
import { RoachSynthDsp, normalizeRoachSound, normalizeRoachBodyMix, ROACH_SOUND_DEFAULTS, ROACH_BODY_SOURCES, ROACH_MOTION_SOUND_PRESETS, ROACH_SOUND_PRESETS, createDefaultRoachBodyMix } from '../src/instruments/roach-synth/roach-synth-dsp.js';
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

test('Roach keeps only the native Low KAL16 voice and migrates retired saved voice choices', () => {
  assert.equal(ROACH_VOICE_PRESETS.length, 1);
  assert.equal(ROACH_VOICE_PRESETS[0].id, 'flite-kal16-native-4');
  assert.equal(ROACH_VOICE_PRESETS[0].bodySource, 'voice-kal');
  assert.deepEqual(ROACH_BODY_SOURCES.filter(source => source.id.startsWith('voice-')).map(source => source.id), ['voice-kal']);
  assert.deepEqual(ROACH_SOUND_PRESETS.filter(preset => preset.id.startsWith('body-voice-')).map(preset => preset.id), ['body-voice-kal']);
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
  assert.equal(ROACH_SOUND_DEFAULTS.voice, .6);
  assert.equal(ROACH_SOUND_PRESETS[0].sound.voice, .6, 'startup uses the reduced default speech level');
  for (const id of ['espeak-native-1', 'espeak-klatt-native-1', 'flite-slt-native-1']) {
    assert.equal(normalizeRoachSound({ voicePreset: id }).voicePreset, 'flite-kal16-native-4');
  }
  for (const source of ['voice-espeak', 'voice-klatt', 'voice-slt']) {
    assert.deepEqual(normalizeRoachBodyMix([{ groupId: 'head', source, level: .37 }])[6], { groupId: 'head', source: 'voice-kal', level: .37 });
  }
  assert.equal(normalizeRoachSound({ voiceSpeed: -1 }).voiceSpeed, .5);
  assert.equal(normalizeRoachSound({ voiceSpeed: 100 }).voiceSpeed, 2);
  assert.equal(normalizeRoachSound().voiceSpeed, 1);
});

test('native speech uses one disposable worker, preserves animation pause, and remains metered through the worklet', async () => {
  const f = fixture(), audio = new RoachSynthAudio({ runtime: f.runtime });
  audio.setVoicePreset(ROACH_VOICE_PRESETS[0].id);
  assert.equal(f.contexts.length, 0); assert.equal(f.workers.length, 0);
  assert.equal(await audio.speak('Audio is off'), false);
  try {
    await audio.enable({ joints, playing: false, soundPlaying: false, time: 3, bodyMix: bodyMix('sine') });
    const phrase = audio.speak('A whole sentence, with native prosody.');
    const worker = f.workers.at(-1);
    assert.equal(worker.request.engine, 'flite-kal16');
    assert.equal(worker.request.text, 'A whole sentence, with native prosody.');
    assert.deepEqual(worker.request.values, ROACH_VOICE_PRESETS[0].values);
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

test('replacing text or muting Audio cancels pending native work and cannot publish a stale sentence', async () => {
  const f = fixture(), audio = new RoachSynthAudio({ runtime: f.runtime });
  try {
    await audio.enable();
    const first = audio.speak('first'); const worker = f.workers.at(-1);
    const replacement = audio.speak('replacement'); const replacementWorker = f.workers.at(-1);
    assert.equal(await first, false); assert.equal(worker.terminated, true);
    worker.ready(); assert.equal(f.messages.filter(message => message.type === 'speak-samples').length, 0);
    replacementWorker.ready(); assert.equal(await replacement, true);
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
  const preset = ROACH_VOICE_PRESETS[0], samples = voiceSamples(.2);
  const result = prepareRoachNativeSamples({ samples, sampleRate: RATE }, preset);
  assert.notEqual(result.samples, samples); assert.equal(result.samples.length, samples.length);
  assert.ok(Math.abs(result.samples[100] - samples[100] * preset.trim) < 1e-7);
  assert.throws(() => prepareRoachNativeSamples({ samples: new Float32Array([NaN]), sampleRate: RATE }, preset));
  assert.throws(() => prepareRoachNativeSamples({ samples: new Float32Array(RATE * 5), sampleRate: RATE }, preset, { body: true }));
});

test('voice speed controls speech duration and expiry independently of Pitch without moving either transport', () => {
  const spoken = (voiceSpeed, pitch = 140) => {
    const dsp = new RoachSynthDsp(RATE);
    dsp.update({ enabled: true, playing: false, soundPlaying: false, sound: { voiceSpeed, pitch, voice: .3, level: .4 } });
    // Resolve controls first: an actual worker-rendered phrase arrives after
    // its asynchronous render, independently of the control message itself.
    render(dsp, .03); dsp.speakSamples(voiceSamples(.6), RATE);
    const start = dsp.audioTime; const output = render(dsp, .1);
    const deadline = dsp.telemetry.speechUntil - start;
    let lastSound = .1;
    for (let time = .1; time < 1.5; time += .025) if (render(dsp, .025).rms > .001) lastSound = time + .025;
    assert.equal(dsp.telemetry.speechUntil, 0);
    assert.equal(dsp.time, 0); assert.equal(dsp.soundTime, 0);
    return { deadline, lastSound, output: output.left };
  };
  const slow = spoken(.5), normal = spoken(1), fast = spoken(2), highPitch = spoken(1, 600);
  assert.ok(Math.abs(slow.deadline - 1.215) < .002);
  assert.ok(Math.abs(normal.deadline - .615) < .002);
  assert.ok(Math.abs(fast.deadline - .315) < .002);
  assert.ok(slow.lastSound > normal.lastSound * 1.8);
  assert.ok(normal.lastSound > fast.lastSound * 1.7);
  assert.equal(highPitch.deadline, normal.deadline);
  assert.deepEqual(highPitch.output, normal.output, 'Pitch no longer changes the native spoken sample or its speed');
});

test('a live voice-speed edit preserves the current phrase position and changes its future deadline', () => {
  const dsp = new RoachSynthDsp(RATE);
  dsp.update({ enabled: true, sound: { voiceSpeed: 1 } });
  dsp.speakSamples(voiceSamples(1), RATE); render(dsp, .2);
  const position = dsp.nativeSpeechPosition, deadline = dsp.telemetry.speechUntil;
  dsp.update({ sound: { voiceSpeed: 2 } });
  assert.equal(dsp.nativeSpeechPosition, position, 'changing speed must not restart the word');
  render(dsp, .1);
  assert.ok(dsp.nativeSpeechPosition > position + RATE * .15);
  assert.ok(dsp.telemetry.speechUntil < deadline - .2);
  assert.ok(dsp.telemetry.peak < .9);
});

test('the remaining Low KAL16 body source uses the speed knob without changing its joint pitch', () => {
  const positions = [.5, 1, 2].map(voiceSpeed => {
    const dsp = new RoachSynthDsp(RATE);
    dsp.update({ joints, enabled: true, playing: false, soundPlaying: false, mappings: [],
      motion: { presetId: 'none', antennae: false }, bodyMix: bodyMix('voice-kal'), sound: { voiceSpeed } });
    dsp.setBodyVoice('voice-kal', voiceSamples(1), RATE); render(dsp, .5);
    const voice = dsp.body.voices[6], frequency = voice.frequency;
    dsp.interact({ jointId: 'head', active: true, velocity: 1 });
    const output = render(dsp, .1);
    assert.ok(output.rms > .01); assert.ok(output.peak < .9);
    assert.ok(Math.abs(voice.frequency - frequency) < .0001);
    assert.equal(voice.voicePositions.length, 1, 'removed voice indices cannot alias a percussion source');
    return voice.voicePositions[0];
  });
  assert.ok(Math.abs(positions[1] / positions[0] - 2) < .001);
  assert.ok(Math.abs(positions[2] / positions[1] - 2) < .001);
});

test('native speech expiry follows remaining sample time and pending replacement rather than telemetry delivery age', () => {
  const dsp = new RoachSynthDsp(RATE);
  dsp.update({ enabled: true, playing: false, soundPlaying: false }); dsp.audioTime = 10;
  dsp.speakSamples(Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * Math.PI * 2 * 190 / 16000) * .2), 16000);
  assert.ok(Math.abs(dsp.speechExpiryTime() - 11.015) < .001, 'a pending native phrase exposes its full deadline');
  render(dsp, .1); const first = dsp.telemetry.speechUntil;
  assert.ok(first > dsp.audioTime + .89);
  render(dsp, .2);
  assert.ok(Math.abs(dsp.telemetry.speechUntil - first) < .002, 'the absolute deadline stays stable while remaining sample time decreases');
  dsp.speakSamples(voiceSamples(.4), RATE);
  const replacement = dsp.speechExpiryTime();
  assert.ok(replacement > dsp.audioTime + .414 && replacement < dsp.audioTime + .431);
  render(dsp, .001);
  assert.ok(dsp.pendingNativeSpeech, 'the old phrase is still releasing');
  assert.ok(Math.abs(dsp.telemetry.speechUntil - replacement) < .002);
  render(dsp, .04); assert.equal(dsp.pendingNativeSpeech, null);
  assert.ok(Math.abs(dsp.telemetry.speechUntil - replacement) < .002);
  render(dsp, .5); assert.equal(dsp.telemetry.speechUntil, 0);
  dsp.speakSamples(voiceSamples(1), RATE); render(dsp, .02);
  dsp.stopSpeech(); assert.equal(dsp.telemetry.speechUntil, 0); assert.equal(dsp.speechExpiryTime(), 0);
  dsp.speakSamples(voiceSamples(1), RATE); render(dsp, .02);
  dsp.update({ enabled: false }); assert.equal(dsp.telemetry.speechUntil, 0);
  assert.equal(dsp.speechExpiryTime(), 0);
  dsp.update({ enabled: true }); render(dsp, .3); assert.equal(dsp.telemetry.speechUntil, 0);
  dsp.update({ sound: { pitch: 600, voiceSpeed: 2 } }); render(dsp, .3);
  dsp.speakSamples(voiceSamples(1), RATE); render(dsp, .01);
  assert.ok(dsp.speechRate > 1.99);
  assert.ok(dsp.telemetry.speechUntil < dsp.audioTime + .52, 'explicit voice speed shortens the actual playback deadline');
  dsp.stopSpeech(); render(dsp, .1);
  dsp.setAtlas(voiceSamples(1), RATE); dsp.speak([{ offset: 0, duration: .2 }]); render(dsp, .01);
  assert.equal(dsp.telemetry.speechUntil, 0, 'legacy phone playback leaves the native deadline unavailable');
});

test('adapter forwards bounded native speech deadlines with their audio clock and clears stale telemetry on Audio off', async () => {
  const f = fixture(), updates = [], audio = new RoachSynthAudio({ runtime: f.runtime, onTelemetry: state => updates.push(state) });
  try {
    await audio.enable();
    const telemetry = speechUntil => audio.node.port.onmessage({ data: { type: 'telemetry', audioTime: 10, speechUntil, speechEnvelope: .2 } });
    telemetry(11.25); assert.equal(audio.getState().speechUntil, 11.25);
    assert.equal(updates.at(-1).audioTime, 10); assert.equal(updates.at(-1).speechUntil, 11.25);
    telemetry(99999); assert.equal(audio.getState().speechUntil, 75);
    telemetry(NaN); assert.equal(audio.getState().speechUntil, 0);
    telemetry(11.25); audio.disable(); assert.equal(audio.getState().speechUntil, 0);
    telemetry(11.25); assert.equal(updates.at(-1).speechUntil, 0, 'queued pre-mute reports cannot revive a stale animation deadline');
  } finally { audio.dispose(); }
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
