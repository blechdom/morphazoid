import assert from "node:assert/strict";
import test from "node:test";

import {
  WHEEL_AUDIO_VOICE_COUNT,
  WheelOfOrgansAudio,
} from "../src/wheel-of-organs-audio.js";

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelAndHoldAtTime(time) {
    this.events.push(["cancelAndHoldAtTime", time]);
  }

  cancelScheduledValues(time) {
    this.events.push(["cancelScheduledValues", time]);
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(["setValueAtTime", value, time]);
  }

  setTargetAtTime(value, time, timeConstant) {
    this.value = value;
    this.events.push(["setTargetAtTime", value, time, timeConstant]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["linearRampToValueAtTime", value, time]);
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
    this.disconnectCount = 0;
  }

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnectCount += 1;
    this.connections.length = 0;
  }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super("oscillator");
    this.type = "sine";
    this.frequency = new FakeAudioParam(440);
    this.detune = new FakeAudioParam(0);
    this.starts = [];
    this.stops = [];
    this.periodicWaves = [];
  }

  start(time = 0) {
    this.starts.push(time);
  }

  stop(time = 0) {
    this.stops.push(time);
  }

  setPeriodicWave(wave) {
    this.periodicWaves.push(wave);
  }
}

class FakeGain extends FakeNode {
  constructor() {
    super("gain");
    this.gain = new FakeAudioParam(1);
  }
}

class FakeFilter extends FakeNode {
  constructor() {
    super("biquad");
    this.type = "lowpass";
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
    this.gain = new FakeAudioParam(0);
  }
}

class FakePanner extends FakeNode {
  constructor() {
    super("panner");
    this.pan = new FakeAudioParam(0);
  }
}

class FakeWaveShaper extends FakeNode {
  constructor() {
    super("waveshaper");
    this.curve = null;
    this.oversample = "none";
  }
}

class FakeDelay extends FakeNode {
  constructor(maxDelayTime) {
    super("delay");
    this.maxDelayTime = maxDelayTime;
    this.delayTime = new FakeAudioParam(0);
  }
}

class FakeCompressor extends FakeNode {
  constructor() {
    super("compressor");
    this.threshold = new FakeAudioParam(-24);
    this.knee = new FakeAudioParam(30);
    this.ratio = new FakeAudioParam(12);
    this.attack = new FakeAudioParam(0.003);
    this.release = new FakeAudioParam(0.25);
  }
}

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel) {
    return this.data[channel];
  }
}

class FakeBufferSource extends FakeNode {
  constructor() {
    super("buffer-source");
    this.buffer = null;
    this.loop = false;
    this.starts = [];
    this.stops = [];
  }

  start(time = 0) {
    this.starts.push(time);
  }

  stop(time = 0) {
    this.stops.push(time);
  }
}

class FakeAudioContext {
  static instances = [];

  constructor(options = {}) {
    this.options = options;
    this.currentTime = 1;
    this.sampleRate = 48_000;
    this.state = "suspended";
    this.destination = new FakeNode("destination");
    this.oscillators = [];
    this.gains = [];
    this.filters = [];
    this.panners = [];
    this.shapers = [];
    this.delays = [];
    this.compressors = [];
    this.bufferSources = [];
    this.periodicWaves = [];
    this.resumeCount = 0;
    this.suspendCount = 0;
    this.closeCount = 0;
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter() {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createStereoPanner() {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }

  createWaveShaper() {
    const node = new FakeWaveShaper();
    this.shapers.push(node);
    return node;
  }

  createDelay(maxDelayTime) {
    const node = new FakeDelay(maxDelayTime);
    this.delays.push(node);
    return node;
  }

  createDynamicsCompressor() {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  }

  createBuffer(channels, length, sampleRate) {
    return new FakeBuffer(channels, length, sampleRate);
  }

  createBufferSource() {
    const node = new FakeBufferSource();
    this.bufferSources.push(node);
    return node;
  }

  createPeriodicWave(real, imaginary, options) {
    const wave = { real, imaginary, options };
    this.periodicWaves.push(wave);
    return wave;
  }

  async resume() {
    this.resumeCount += 1;
    this.state = "running";
  }

  async suspend() {
    this.suspendCount += 1;
    this.state = "suspended";
  }

  async close() {
    this.closeCount += 1;
    this.state = "closed";
  }
}

function fakeRuntime() {
  FakeAudioContext.instances.length = 0;
  return { AudioContext: FakeAudioContext };
}

function mouth(letter, overrides = {}) {
  return {
    id: `mouth-${letter}`,
    active: true,
    letter,
    pull: 0.35,
    tongue: 0.5,
    aperture: 0.65,
    glottalTension: 0.58,
    breath: 0.16,
    interval: 0,
    ...overrides,
  };
}

function nodeCounts(context) {
  return {
    oscillators: context.oscillators.length,
    gains: context.gains.length,
    filters: context.filters.length,
    panners: context.panners.length,
    shapers: context.shapers.length,
    delays: context.delays.length,
    compressors: context.compressors.length,
    bufferSources: context.bufferSources.length,
  };
}

function vocalSnapshot(voice) {
  return {
    frequency: voice.profile.frequency,
    formants: [...voice.profile.formants],
    deformation: voice.profile.deformation,
    intensity: voice.profile.intensity,
    drive: voice.sourceBus.gain.value,
    voiced: voice.voicedGain.gain.value,
    oral: voice.oralGain.gain.value,
    noise: voice.noiseGain.gain.value,
    noiseFrequency: voice.noiseFilter.frequency.value,
    highpass: voice.highpass.frequency.value,
    lowpass: voice.lowpass.frequency.value,
    throatFrequency: voice.throatPeak.frequency.value,
    throatQ: voice.throatPeak.Q.value,
    throatGain: voice.throatPeak.gain.value,
    notchFrequency: voice.throatNotch.frequency.value,
    nasal: voice.nasalGain.gain.value,
    nasalPoleGain: voice.nasalPole.gain.value,
    slimeWet: voice.slimeWet.gain.value,
    slimeDelay: voice.slimeDelay.delayTime?.value ?? 0,
    slimeFrequency: voice.slimeFilter.frequency.value,
    slimeQ: voice.slimeFilter.Q.value,
    slimeFeedback: voice.slimeFeedback.gain.value,
    waveKey: voice.waveKey,
  };
}

test("audio is lazy, then builds twelve permanent LF/formant voice slots", async () => {
  const runtime = fakeRuntime();
  const audio = new WheelOfOrgansAudio({ runtime, level: 0.57 });

  assert.equal(audio.context, null);
  assert.equal(audio.running, false);
  assert.equal(audio.isEnabled, false);
  assert.equal(FakeAudioContext.instances.length, 0);
  assert.equal(audio.syncMouths([mouth("A")], { rootMidi: 48 }), 1);
  assert.equal(FakeAudioContext.instances.length, 0, "sync before a gesture stays inert");

  await Promise.all([audio.enable(), audio.enable()]);
  const [context] = FakeAudioContext.instances;
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(context.options.latencyHint, "interactive");
  assert.equal(audio.running, true);
  assert.equal(audio.isEnabled, true);
  assert.equal(audio.voices.length, WHEEL_AUDIO_VOICE_COUNT);
  assert.equal(context.oscillators.length, WHEEL_AUDIO_VOICE_COUNT + 1, "voices plus vibrato LFO");
  assert.equal(context.bufferSources.length, 1, "all mouths share one noise source");
  assert.equal(context.bufferSources[0].loop, true);
  assert.deepEqual(context.bufferSources[0].starts, [1]);
  assert.ok(context.bufferSources[0].buffer.getChannelData(0).some((sample) => sample !== 0));

  for (const voice of audio.voices) {
    assert.deepEqual(voice.oscillator.starts, [1]);
    assert.equal(voice.oscillator.periodicWaves.length >= 1, true);
    assert.equal(voice.formants.length, 4);
    assert.ok(voice.formants.every((filter) => filter.type === "peaking"));
    assert.equal(voice.highpass.type, "highpass");
    assert.equal(voice.throatPeak.type, "peaking");
    assert.equal(voice.throatNotch.type, "notch");
    assert.equal(voice.lowpass.type, "lowpass");
    assert.ok(voice.oralGain.gain.value >= 0.16 && voice.oralGain.gain.value <= 0.68);
    assert.equal(voice.nasalPole.type, "peaking");
    assert.equal(voice.nasalNotch.type, "notch");
    assert.equal(voice.slimeDelay.maxDelayTime, 0.08);
    assert.equal(voice.slimeFilter.type, "bandpass");
    assert.ok(voice.slimeFeedback.gain.value >= 0 && voice.slimeFeedback.gain.value <= 0.24);
    assert.ok(voice.clipper.curve instanceof Float32Array);
    assert.equal(voice.clipper.oversample, "2x");
  }
  assert.equal(context.periodicWaves.length, 17, "the complete tension wave bank is preallocated");
  assert.equal(context.compressors.length, 1);
  await audio.close();
});

test("mouth synchronization retunes anatomy without growing the fixed graph", async () => {
  const runtime = fakeRuntime();
  const audio = new WheelOfOrgansAudio({ runtime });
  await audio.enable();
  const [context] = FakeAudioContext.instances;
  const initialCounts = nodeCounts(context);
  const initialWaveCount = context.periodicWaves.length;
  const mouths = [
    mouth("A", {
      pull: 0,
      push: 0,
      pinch: 0,
      aperture: 0.55,
      tongue: 0.5,
      tongueOut: 0,
      size: 1,
      stretch: 1,
      nasality: 0,
      screech: 0,
      glottalTension: 0.5,
      breath: 0,
    }),
    mouth("S", { pull: 0.52, tongue: 0.82 }),
    mouth("M", { pull: 0.86, glottalTension: 0.9 }),
  ];

  assert.equal(audio.syncMouths(mouths, {
    rootMidi: 43,
    level: 0.7,
    vibrato: 0.75,
    vibratoRate: 6.4,
    nasality: 0,
    screech: 0,
    pressure: 0,
    pinch: 0,
    push: 0,
    slime: 0,
    dirt: 0,
    depth: 0,
    tongueOut: 0,
  }), 3);
  assert.equal(audio.voices[0].present, true);
  assert.equal(audio.voices[1].profile.manner.length > 0, true);
  assert.equal(audio.voices[2].profile.frequency > audio.voices[0].profile.frequency, true);
  assert.equal(audio.voices[0].nasalGain.gain.value, 0, "A keeps the nasal path shut");
  assert.ok(audio.voices[2].nasalGain.gain.value > 0, "M opens its nasal resonator");
  assert.ok(audio.voices[2].nasalGain.gain.value <= 0.92);
  assert.ok(audio.voices[2].nasalGain.gain.events.some(([method]) => (
    method === "setTargetAtTime"
  )), "nasal coupling is click-smoothed");
  assert.notEqual(audio.voices[1].profile.pan, audio.voices[0].profile.pan);
  assert.ok(audio.voices.slice(0, 3).every(({ profile }) => (
    profile.pan >= -1 && profile.pan <= 1
  )));
  assert.equal(audio.voices[3].present, false);
  assert.equal(audio.vibrato.frequency.value, 6.4);
  assert.equal(audio.vibratoDepth.gain.value > 0, true);
  assert.equal(audio.master.gain.value, 0.7);
  const cleanDrive = audio.voices[0].sourceBus.gain.value;
  const cleanThroatFrequency = audio.voices[0].throatPeak.frequency.value;
  const cleanThroatGain = audio.voices[0].throatPeak.gain.value;
  const cleanSlime = audio.voices[0].slimeWet.gain.value;
  const cleanSlimeDelay = audio.voices[0].slimeDelay.delayTime.value;
  const cleanFirstFormant = audio.voices[0].profile.formants[0];
  const cleanNoiseFrequency = audio.voices[0].profile.noiseFrequency;
  assert.deepEqual(nodeCounts(context), initialCounts);

  mouths[0].pull = 1;
  mouths[0].size = 1;
  mouths[0].stretch = 1;
  mouths[0].tongueOut = 1;
  mouths[0].push = 1;
  mouths[0].pinch = 1;
  mouths[0].nasality = 1;
  mouths[0].screech = 1;
  mouths[0].glottalTension = 1;
  mouths[0].breath = 1;
  audio.syncMouths(mouths, {
    rootMidi: 43,
    vibrato: 0.2,
    growl: 1,
    nasality: 1,
    screech: 1,
    pressure: 1,
    pinch: 1,
    push: 1,
    slime: 1,
    dirt: 1,
    depth: 1,
    tongueOut: 1,
  });
  assert.equal(audio.voices[0].profile.frequency > audio.voices[2].profile.frequency, true);
  assert.ok(audio.voices[0].sourceBus.gain.value > cleanDrive);
  assert.ok(audio.voices[0].sourceBus.gain.value <= 1.58);
  assert.ok(audio.voices[0].nasalGain.gain.value > 0, "global nasality wets a vowel");
  assert.ok(audio.voices[0].nasalGain.gain.value <= 0.92);
  assert.ok(audio.voices[0].throatPeak.frequency.value > cleanThroatFrequency);
  assert.ok(audio.voices[0].throatPeak.gain.value > cleanThroatGain);
  assert.ok(audio.voices[0].slimeWet.gain.value > cleanSlime);
  assert.ok(audio.voices[0].slimeWet.gain.value <= 0.68);
  assert.ok(audio.voices[0].slimeFeedback.gain.value <= 0.32);
  assert.ok(audio.voices[0].slimeDelay.delayTime.value > cleanSlimeDelay);
  assert.ok(audio.voices[0].profile.formants[0] < cleanFirstFormant);
  assert.ok(audio.voices[0].profile.noiseFrequency > cleanNoiseFrequency);
  assert.ok(audio.voices[0].sourceBus.gain.events.some(([method]) => (
    method === "setTargetAtTime"
  )), "growl drive is click-smoothed");
  assert.ok(audio.voices[0].formants.every(({ frequency }) => (
    frequency.events.some(([method]) => method === "setTargetAtTime")
  )));
  assert.deepEqual(nodeCounts(context), initialCounts, "drag updates allocate no Web Audio nodes");
  assert.equal(
    context.periodicWaves.length,
    initialWaveCount,
    "glottal retuning reuses the preallocated PeriodicWave bank",
  );
  await audio.close();
});

test("every visible mouth morph produces a strong bounded anatomical retune", async () => {
  const runtime = fakeRuntime();
  const audio = new WheelOfOrgansAudio({ runtime });
  const neutral = mouth("A", {
    pull: 0,
    push: 0,
    pinch: 0,
    aperture: 0.55,
    tongue: 0.5,
    tongueOut: 0,
    size: 1,
    stretch: 1,
    nasality: 0,
    screech: 0,
    glottalTension: 0.5,
    breath: 0,
  });
  const cleanGlobals = {
    rootMidi: 48,
    growl: 0,
    slime: 0,
    dirt: 0,
    noise: 0,
    depth: 0,
  };
  audio.syncMouths([neutral], cleanGlobals);
  await audio.enable();
  const [context] = FakeAudioContext.instances;
  const counts = nodeCounts(context);
  const waveCount = context.periodicWaves.length;
  assert.equal(audio.sustain(0, neutral, { globals: cleanGlobals }), true);
  const voice = audio.voices[0];
  const envelopeEvents = voice.envelope.gain.events.length;
  const pose = (overrides) => {
    assert.equal(audio.sustain(0, { ...neutral, ...overrides }, { globals: cleanGlobals }), true);
    return vocalSnapshot(voice);
  };

  const pullIn = pose({ pull: 0 });
  const pullOut = pose({ pull: 1 });
  assert.ok(pullOut.frequency / pullIn.frequency > 2.7, "pull audibly spans about 18 semitones");
  assert.ok(pullOut.formants[0] / pullIn.formants[0] < 0.77, "pull lowers the tract envelope");
  assert.ok(pullOut.slimeWet - pullIn.slimeWet > 0.14, "pull also stretches the wet cavity");

  const pushLow = pose({ push: 0 });
  const pushHigh = pose({ push: 1 });
  assert.ok(pushHigh.drive - pushLow.drive > 0.45);
  assert.ok(pushHigh.noise - pushLow.noise > 0.2);

  const pinchLow = pose({ pinch: 0 });
  const pinchHigh = pose({ pinch: 1 });
  assert.ok(pinchHigh.throatQ - pinchLow.throatQ > 10);
  assert.ok(pinchHigh.highpass - pinchLow.highpass > 300);
  assert.ok(pinchHigh.nasal - pinchLow.nasal > 0.18);

  const closed = pose({ aperture: 0 });
  const open = pose({ aperture: 1 });
  assert.ok(open.oral - closed.oral > 0.3);
  assert.ok(open.formants[0] / closed.formants[0] > 1.45);

  const tongueBack = pose({ tongue: 0 });
  const tongueFront = pose({ tongue: 1 });
  assert.ok(tongueFront.formants[1] / tongueBack.formants[1] > 1.8);
  assert.ok(tongueFront.noiseFrequency / tongueBack.noiseFrequency > 2.5);

  const tongueInside = pose({ tongueOut: 0 });
  const tongueOutside = pose({ tongueOut: 1 });
  assert.ok(tongueOutside.noiseFrequency / tongueInside.noiseFrequency > 1.45);
  assert.ok(tongueOutside.throatFrequency - tongueInside.throatFrequency > 700);
  assert.ok(tongueOutside.slimeWet - tongueInside.slimeWet > 0.12);

  const tiny = pose({ size: 0.2 });
  const huge = pose({ size: 2.6 });
  assert.ok(tiny.formants[0] / huge.formants[0] > 2.4);
  assert.ok(tiny.frequency / huge.frequency > 2);
  assert.ok(tiny.slimeFrequency / huge.slimeFrequency > 2);

  const compact = pose({ stretch: 0.35 });
  const stretched = pose({ stretch: 2.8 });
  assert.ok(compact.formants[0] / stretched.formants[0] > 1.7);
  assert.ok(compact.slimeFrequency / stretched.slimeFrequency > 1.4);

  const oral = pose({ nasality: 0 });
  const nasal = pose({ nasality: 1 });
  assert.ok(nasal.nasal - oral.nasal > 0.45);
  assert.ok(nasal.nasalPoleGain - oral.nasalPoleGain > 8);

  const smooth = pose({ screech: 0 });
  const screaming = pose({ screech: 1 });
  assert.ok(screaming.throatFrequency - smooth.throatFrequency > 3_300);
  assert.ok(screaming.throatGain - smooth.throatGain > 10);
  assert.ok(screaming.noise - smooth.noise > 0.18);

  const slack = pose({ glottalTension: 0 });
  const tense = pose({ glottalTension: 1 });
  assert.ok(tense.frequency / slack.frequency > 1.24);
  assert.notEqual(tense.waveKey, slack.waveKey);

  const dryBreath = pose({ breath: 0 });
  const breathy = pose({ breath: 1 });
  assert.ok(breathy.noise - dryBreath.noise > 0.3);
  assert.ok(dryBreath.voiced - breathy.voiced > 0.1);

  const plain = pose({
    pull: 0,
    push: 0,
    pinch: 0,
    tongueOut: 0,
    size: 1,
    stretch: 1,
    nasality: 0,
    screech: 0,
    breath: 0,
  });
  const mutant = pose({
    pull: 1,
    push: 1,
    pinch: 1,
    tongueOut: 1,
    size: 2.6,
    stretch: 2.8,
    nasality: 0,
    screech: 0,
    breath: 0,
  });
  assert.ok(mutant.deformation > 0.95);
  assert.ok(mutant.intensity > 0.85);
  assert.ok(mutant.slimeWet - plain.slimeWet > 0.2, "geometry alone opens the wet cavity");
  assert.ok(mutant.noise - plain.noise > 0.35, "geometry alone creates internal turbulence");
  assert.ok(mutant.nasal - plain.nasal > 0.25, "geometry alone couples the nasal cavity");
  assert.ok(mutant.throatGain - plain.throatGain > 10, "geometry alone constricts the throat");
  assert.ok(mutant.oral < plain.oral, "the mutant sound favors cavity paths over raw oscillator");
  assert.ok(mutant.drive >= 0.5 && mutant.drive <= 1.58);
  assert.ok(mutant.voiced >= 0 && mutant.voiced <= 0.52);
  assert.ok(mutant.oral >= 0.16 && mutant.oral <= 0.68);
  assert.ok(mutant.noise >= 0 && mutant.noise <= 0.82);
  assert.ok(mutant.nasal >= 0 && mutant.nasal <= 0.92);
  assert.ok(mutant.slimeWet >= 0 && mutant.slimeWet <= 0.68);
  assert.ok(mutant.slimeFeedback >= 0 && mutant.slimeFeedback <= 0.32);

  assert.equal(voice.envelope.gain.events.length, envelopeEvents);
  assert.deepEqual(nodeCounts(context), counts);
  assert.equal(context.periodicWaves.length, waveCount);
  assert.ok([
    voice.sourceBus.gain.value,
    voice.voicedGain.gain.value,
    voice.oralGain.gain.value,
    voice.noiseGain.gain.value,
    voice.nasalGain.gain.value,
    voice.slimeWet.gain.value,
    voice.slimeFeedback.gain.value,
  ].every(Number.isFinite));
  await audio.close();
});

test("vowels, fricatives, and stop bursts schedule on permanent voice envelopes", async () => {
  const runtime = fakeRuntime();
  const audio = new WheelOfOrgansAudio({ runtime });
  const mouths = [mouth("A"), mouth("S"), mouth("P")];
  audio.syncMouths(mouths, { rootMidi: 48 });
  await audio.enable();
  const [context] = FakeAudioContext.instances;
  const counts = nodeCounts(context);

  assert.equal(audio.articulate(0, mouths[0], { duration: 0.42, velocity: 0.8 }), true);
  assert.equal(audio.articulate(1, mouths[1], { duration: 0.25 }), true);
  assert.equal(audio.articulate(2, mouths[2], { duration: 0.2, when: 1.5 }), true);
  assert.equal(audio.articulate(-1, mouths[0]), false);
  assert.equal(audio.articulate(12, mouths[0]), false);
  assert.deepEqual(nodeCounts(context), counts, "letter hits only automate the preallocated graph");

  const vowelEnvelope = audio.voices[0].envelope.gain.events;
  const frication = audio.voices[1].noiseGain.gain.events;
  const stopBurst = audio.voices[2].noiseGain.gain.events;
  assert.ok(vowelEnvelope.some(([method, value]) => (
    method === "linearRampToValueAtTime" && value > 0.001 && value <= 0.34
  )));
  assert.ok(frication.some(([method, value]) => (
    method === "linearRampToValueAtTime" && value > 0
  )));
  assert.ok(stopBurst.some(([method, value, time]) => (
    method === "setValueAtTime" && value > 0 && time > 1.5
  )), "a stop closes before its filtered noise burst");
  assert.ok(stopBurst.every((event) => (
    event[1] === undefined || Number.isFinite(event[1])
  )));

  assert.equal(audio.sustain(0, mouths[0], { velocity: 0.65 }), true);
  assert.equal(audio.voices[0].gated, true);
  assert.equal(audio.voices[0].releaseAt, Infinity);
  const heldEnvelopeEvents = audio.voices[0].envelope.gain.events.length;
  const heldFrequency = audio.voices[0].profile.frequency;
  const heldNoise = audio.voices[0].noiseGain.gain.value;
  assert.equal(audio.sustain(0, {
    ...mouths[0],
    pull: 0.9,
    dirt: 1,
    tongueOut: 1,
  }, { velocity: 0.65 }), true);
  assert.equal(
    audio.voices[0].envelope.gain.events.length,
    heldEnvelopeEvents,
    "sustained drag retunes without replaying the mouth attack",
  );
  assert.ok(audio.voices[0].profile.frequency > heldFrequency);
  assert.ok(audio.voices[0].noiseGain.gain.value > heldNoise, "dirt raises internal turbulence");
  assert.ok(audio.voices[0].noiseGain.gain.value <= 0.82);
  assert.equal(audio.release(0), true);
  assert.equal(audio.voices[0].gated, false);
  assert.ok(audio.voices[0].envelope.gain.events.at(-1)[1] <= 0.0001);
  await audio.close();
});

test("rapid wheel crossings reuse slots and a winning sustain exposes its full decay", async () => {
  const runtime = fakeRuntime();
  const audio = new WheelOfOrgansAudio({ runtime });
  const mouths = Array.from({ length: 12 }, (_, index) => (
    mouth(String.fromCharCode(65 + index), { id: `spin-mouth-${index}` })
  ));
  audio.syncMouths(mouths, { rootMidi: 45, slime: 0.7, dirt: 0.55 });
  await audio.enable();
  const [context] = FakeAudioContext.instances;
  const counts = nodeCounts(context);
  const waveCount = context.periodicWaves.length;

  for (let crossing = 0; crossing < 24; crossing += 1) {
    context.currentTime = 1 + crossing * 0.026;
    const slot = crossing % WHEEL_AUDIO_VOICE_COUNT;
    assert.equal(audio.articulate(slot, mouths[slot], {
      duration: 0.052,
      release: 0.018,
      velocity: 0.72 + crossing % 3 * 0.08,
    }), true);
  }
  assert.deepEqual(nodeCounts(context), counts, "fast crossings only automate permanent slots");
  assert.equal(context.periodicWaves.length, waveCount);
  assert.ok(audio.voices.every(({ envelope }) => (
    envelope.gain.events.some(([method, value]) => (
      method === "linearRampToValueAtTime" && value > 0
    ))
  )), "every physical slot can speak during a fast spin");

  const winnerSlot = 7;
  const winner = { ...mouths[winnerSlot], id: "winning-occurrence", pull: 0.82 };
  context.currentTime = 1.64;
  assert.equal(audio.sustain(winnerSlot, winner, { velocity: 0.96 }), true);
  const winningVoice = audio.voices[winnerSlot];
  assert.equal(winningVoice.releaseAt, Infinity);
  assert.equal(audio.isDecaying, false);
  const heldEnvelopeEvents = winningVoice.envelope.gain.events.length;

  context.currentTime = 3.24;
  assert.equal(winningVoice.releaseAt, Infinity, "the winner remains audible for the whole hold");
  assert.equal(audio.sustain(winnerSlot, winner, { velocity: 0.96 }), true);
  assert.equal(
    winningVoice.envelope.gain.events.length,
    heldEnvelopeEvents,
    "refreshing the winning hold does not retrigger its attack",
  );

  assert.equal(audio.release(winnerSlot, { release: 2.4 }), true);
  assert.equal(winningVoice.gated, false);
  const winnerSilentAt = audio.decayUntil;
  assert.ok(Math.abs(winnerSilentAt - 5.64) < 1e-9);
  assert.ok(Math.abs(audio.decayRemaining - 2.4) < 1e-9);
  assert.equal(audio.isDecaying, true);
  const [decayMethod, decayTarget, decayEnd] = winningVoice.envelope.gain.events.at(-1);
  assert.equal(decayMethod, "linearRampToValueAtTime");
  assert.equal(decayTarget, 0, "the bounded winner decay lands at exact silence");
  assert.ok(Math.abs(decayEnd - 5.64) < 1e-9);

  context.currentTime = winnerSilentAt - 0.001;
  assert.equal(audio.isDecaying, true, "the next spin stays locked through the fade tail");
  context.currentTime = winnerSilentAt;
  assert.equal(audio.isDecaying, false);
  assert.equal(audio.decayRemaining, 0);
  assert.equal(audio.decayUntil, 0);
  assert.equal(audio.articulate(0, mouths[0], { duration: 0.052 }), true);
  assert.deepEqual(nodeCounts(context), counts);
  assert.equal(context.periodicWaves.length, waveCount);
  await audio.close();
});

test("consonants and X-like sequences coarticulate into carriers on one fixed slot", async () => {
  const runtime = fakeRuntime();
  const audio = new WheelOfOrgansAudio({ runtime });
  const mouths = [mouth("S"), mouth("X")];
  audio.syncMouths(mouths, { rootMidi: 48 });
  await audio.enable();
  const [context] = FakeAudioContext.instances;
  const counts = nodeCounts(context);

  const sVoice = audio.voices[0];
  assert.equal(audio.articulate(0, mouths[0], {
    duration: 0.28,
    globals: {
      articulation: "sh",
      carrierLetter: "IY",
      nextLetter: "E",
      coarticulationMs: 60,
    },
  }), true);
  assert.equal(sVoice.profile.manner, "fricative");
  assert.equal(sVoice.coarticulationTarget.manner, "vowel");
  assert.equal(sVoice.coarticulationTarget.voiced, true);
  assert.notDeepEqual(sVoice.profile.formants, sVoice.coarticulationTarget.formants);
  assert.ok(sVoice.voicedGain.gain.events.some(([method, value, time]) => (
    method === "linearRampToValueAtTime"
      && value > 0
      && time >= 1.035
      && time <= 1.09
  )), "the carrier voice enters inside the same event");
  assert.ok(sVoice.formants.every(({ frequency }) => (
    frequency.events.some(([method, , time]) => (
      method === "linearRampToValueAtTime" && time >= 1.035 && time <= 1.09
    ))
  )));

  const xVoice = audio.voices[1];
  assert.equal(audio.articulate(1, mouths[1], {
    duration: 0.32,
    globals: {
      articulationSequence: ["k", "s"],
      carrierSequence: ["AX", "IY"],
      sequenceWeights: [0.38, 0.62],
      coarticulationMs: 72,
    },
  }), true);
  const noiseMorphs = xVoice.noiseFilter.frequency.events.filter(([method]) => (
    method === "linearRampToValueAtTime"
  ));
  assert.ok(noiseMorphs.length >= 2, "K morphs through S before the voiced carrier");
  assert.equal(xVoice.coarticulationTarget.manner, "vowel");
  assert.ok(xVoice.noiseGain.gain.events.every((event) => (
    event[1] === undefined || Number.isFinite(event[1])
  )));
  assert.ok(xVoice.noiseGain.gain.events
    .filter(([method]) => method === "setValueAtTime")
    .every(([, value]) => value <= 0.34));
  assert.deepEqual(nodeCounts(context), counts, "multi-phase speech reuses the same DSP slots");

  const diphthongVoice = audio.voices[2];
  assert.equal(audio.articulate(2, mouth("O"), {
    duration: 0.28,
    globals: {
      articulationSequence: ["a", "u"],
      carrierSequence: ["AH", "UW"],
      sequenceWeights: [0.46, 0.54],
    },
  }), true);
  assert.equal(diphthongVoice.profile.manner, "vowel");
  assert.equal(diphthongVoice.coarticulationTarget.manner, "vowel");
  assert.notDeepEqual(
    diphthongVoice.profile.formants,
    diphthongVoice.coarticulationTarget.formants,
    "a vowel sequence starts at its first carrier and morphs to the second",
  );
  assert.ok(diphthongVoice.formants.every(({ frequency }) => (
    frequency.events.some(([method]) => method === "linearRampToValueAtTime")
  )));
  assert.deepEqual(nodeCounts(context), counts, "diphthongs also reuse the fixed voice graph");

  const occurrences = Array.from({ length: 32 }, (_, index) => ({
    ...mouth(String.fromCharCode(65 + index % 26)),
    id: `occurrence-${index + 1}`,
  }));
  assert.equal(audio.syncMouths(occurrences, { mouthCount: 32 }), 12);
  assert.equal(audio.voices.length, 12);
  const replacement = { ...mouth("A"), id: "occurrence-25", size: 1, stretch: 1, tongueOut: 1 };
  assert.equal(audio.articulate(1, replacement, { duration: 0.2 }), true);
  assert.equal(xVoice.mouthId, "occurrence-25", "a reused slot tracks the actual occurrence mouth");
  assert.deepEqual(nodeCounts(context), counts);
  await audio.close();
});

test("disable is reusable and close stops and disconnects every permanent source", async () => {
  const runtime = fakeRuntime();
  const audio = new WheelOfOrgansAudio({ runtime });
  audio.syncMouths([mouth("O"), mouth("R"), mouth("G")], { level: 0.6 });
  await audio.enable();
  const [context] = FakeAudioContext.instances;
  const counts = nodeCounts(context);
  audio.sustain(0, mouth("O"));

  await audio.disable();
  assert.equal(audio.isEnabled, false);
  assert.equal(audio.running, false);
  assert.equal(context.state, "suspended");
  assert.equal(context.suspendCount, 1);
  assert.ok(audio.voices.every(({ gated }) => gated === false));

  await audio.enable();
  assert.equal(audio.running, true);
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.deepEqual(nodeCounts(context), counts, "re-enable reuses the muted graph");

  const oscillators = audio.voices.map(({ oscillator }) => oscillator);
  const nasalNodes = audio.voices.flatMap(({ oralGain, nasalPole, nasalNotch, nasalGain }) => (
    [oralGain, nasalPole, nasalNotch, nasalGain]
  ));
  const cavityNodes = audio.voices.flatMap(({
    throatPeak,
    throatNotch,
    slimeDelay,
    slimeFilter,
    slimeWet,
    slimeFeedback,
  }) => [throatPeak, throatNotch, slimeDelay, slimeFilter, slimeWet, slimeFeedback]);
  const noiseSource = audio.noiseSource;
  const vibrato = audio.vibrato;
  await audio.close();
  assert.equal(context.state, "closed");
  assert.equal(context.closeCount, 1);
  assert.ok(oscillators.every(({ stops, disconnectCount }) => (
    stops.length === 1 && disconnectCount === 1
  )));
  assert.ok(nasalNodes.every(({ disconnectCount }) => disconnectCount === 1));
  assert.ok(cavityNodes.every(({ disconnectCount }) => disconnectCount === 1));
  assert.equal(noiseSource.stops.length, 1);
  assert.equal(vibrato.stops.length, 1);
  assert.equal(audio.context, null);
  assert.deepEqual(audio.voices, []);
  assert.equal(audio.isEnabled, false);
});
