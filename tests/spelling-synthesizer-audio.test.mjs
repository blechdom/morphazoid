import assert from "node:assert/strict";
import test from "node:test";

import { SpellingSynthesizerAudio } from "../src/spelling-synthesizer-audio.js";
import {
  SPELLING_DIPHONE_CLIPS,
  spellingDiphoneClipKey,
} from "../src/spelling-diphone-atlas.js";
import {
  SPELLING_PAIRS,
  spellingArticulation,
  spellingPerformanceState,
  typingDynamics,
} from "../src/spelling-synthesizer.js";

const MOCK_ATLAS_SAMPLE_RATE = 16_000;
const MOCK_ATLAS_DURATION = Math.max(
  ...Object.values(SPELLING_DIPHONE_CLIPS)
    .map((clip) => clip.offset + clip.duration),
) + 0.018;

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

  connect(destination, output, input) {
    this.connections.push({ destination, output, input });
    return destination;
  }

  disconnect() {
    this.connections.length = 0;
    this.disconnectCount += 1;
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
  constructor() {
    super("delay");
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
    this.playbackRate = new FakeAudioParam(1);
    this.starts = [];
    this.stops = [];
  }

  start(time = 0, offset, duration) {
    this.starts.push({ time, offset, duration });
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
    this.decodedBuffers = [];
    this.decodeCalls = [];
    this.periodicWaves = [];
    this.workletModules = [];
    this.audioWorklet = {
      addModule: async (url) => {
        this.workletModules.push(String(url));
      },
    };
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

  createDynamicsCompressor() {
    const node = new FakeCompressor();
    this.compressors.push(node);
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

  createDelay() {
    const node = new FakeDelay();
    this.delays.push(node);
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

  decodeAudioData(bytes, onSuccess) {
    this.decodeCalls.push(bytes);
    const buffer = {
      kind: "decoded-audio",
      bytes,
      duration: MOCK_ATLAS_DURATION,
      length: Math.round(MOCK_ATLAS_DURATION * MOCK_ATLAS_SAMPLE_RATE),
      sampleRate: MOCK_ATLAS_SAMPLE_RATE,
    };
    this.decodedBuffers.push(buffer);
    onSuccess?.(buffer);
    return Promise.resolve(buffer);
  }

  createPeriodicWave(real, imaginary) {
    const wave = { real, imaginary };
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

class FakeAudioWorkletNode extends FakeNode {
  static instances = [];

  constructor(context, name, options) {
    super("audio-worklet");
    this.context = context;
    this.name = name;
    this.options = options;
    this.messages = [];
    this.port = {
      postMessage: (message) => this.messages.push(message),
    };
    FakeAudioWorkletNode.instances.push(this);
  }
}

function fakeRuntime() {
  FakeAudioContext.instances.length = 0;
  FakeAudioWorkletNode.instances.length = 0;
  let nextTimer = 0;
  const timers = new Map();
  const fetches = [];
  return {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    async fetch(url) {
      fetches.push(String(url));
      return {
        ok: true,
        async arrayBuffer() {
          return new ArrayBuffer(32);
        },
      };
    },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetches,
    timers,
  };
}

function voiceEvent(character = "a", personality = "clear") {
  const articulation = character.toLowerCase();
  const dynamics = typingDynamics({
    intervalMs: 150,
    averageIntervalMs: 280,
    amount: 0.82,
    capital: character !== character.toLowerCase(),
  });
  const performance = spellingPerformanceState({
    personality,
    articulation,
    carrierVowel: "a",
    dynamics,
  });
  const carrierPerformance = spellingPerformanceState({
    personality,
    articulation: "a",
    carrierVowel: "a",
    dynamics,
  });
  return {
    character,
    articulation,
    carrierVowel: "a",
    personality,
    dynamics,
    performance,
    carrierPerformance,
  };
}

function graphCounts(context) {
  return {
    oscillators: context.oscillators.length,
    gains: context.gains.length,
    filters: context.filters.length,
    compressors: context.compressors.length,
    buffers: context.bufferSources.length,
  };
}

function fireFakeTimer(runtime, id) {
  const timer = runtime.timers.get(id);
  assert.ok(timer, `timer ${id} should be pending`);
  runtime.timers.delete(id);
  timer.callback();
  return timer.delay;
}

function pairVoiceEvent(source, articulation, pairStepIndex) {
  const event = voiceEvent(articulation);
  event.character = source;
  event.articulation = articulation;
  event.pair = SPELLING_PAIRS[source];
  event.pairStepIndex = pairStepIndex;
  event.pairStepCount = event.pair.sounds.length;
  return event;
}

function atlasSources(context) {
  const [atlas] = context.decodedBuffers;
  return context.bufferSources.filter(({ buffer }) => buffer === atlas);
}

test("every A–Z spelling articulation has a diphone atlas clip", () => {
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    const event = voiceEvent(letter);
    event.articulation = spellingArticulation(letter);
    const key = spellingDiphoneClipKey(event);
    assert.ok(key, `${letter.toUpperCase()} needs a sampled clip`);
    assert.ok(SPELLING_DIPHONE_CLIPS[key], `${letter.toUpperCase()} maps to ${key}`);
  }
});

test("the tube backend reuses Throatazoid's worklet and sends bounded performance states", async () => {
  const runtime = fakeRuntime();
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "tube", level: 0.46 });

  assert.equal(FakeAudioContext.instances.length, 0, "audio stays lazy before a gesture");
  assert.equal(await audio.enable(), "tube");
  assert.equal(audio.running, true);
  assert.equal(audio.activeEngine, "tube");
  const [context] = FakeAudioContext.instances;
  const [worklet] = FakeAudioWorkletNode.instances;
  assert.match(context.workletModules[0], /throatazoid-tract-processor\.js$/);
  assert.equal(worklet.name, "throatazoid-tract");
  assert.equal(worklet.options.numberOfInputs, 8);

  const before = graphCounts(context);
  assert.equal(audio.articulate(voiceEvent("S", "creature")), true);
  assert.deepEqual(graphCounts(context), before, "letter events automate the fixed graph");
  const active = worklet.messages.at(-1);
  assert.equal(active.type, "configure");
  assert.equal(active.state.performanceGate, 1);
  assert.equal(active.state.articulationManner, "fricative");
  assert.equal(active.state.mouthCount, 3);
  assert.ok(active.state.articulationAperture >= 0 && active.state.articulationAperture <= 1);
  assert.ok(runtime.timers.size > 0, "the physical body schedules its release");

  assert.equal(audio.release({ releaseMs: 70 }), true);
  assert.equal(worklet.messages.at(-1).state.performanceGate, 0);
  assert.equal(audio.setLevel(99), 0.82);
  await audio.disable();
  assert.equal(context.state, "suspended");
  assert.equal(audio.running, false);
  await audio.close();
  assert.equal(context.state, "closed");
});

test("Bellazoid stages affricates, nasals, and X through their English gestures", async () => {
  const runtime = fakeRuntime();
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "tube" });
  await audio.enable();
  const backend = audio.backends.tube;
  const [worklet] = FakeAudioWorkletNode.instances;

  const ch = voiceEvent("c");
  assert.equal(ch.performance.phoneme, "c");
  assert.equal(ch.performance.articulationManner, "affricate");
  assert.equal(audio.articulate(ch), true);
  let configuration = worklet.messages.at(-1).state;
  assert.equal(configuration.articulationManner, "stop");
  assert.equal(configuration.articulationAperture, 0);
  const closureDelay = fireFakeTimer(runtime, backend.articulationTimer);
  assert.ok(closureDelay >= 52 && closureDelay <= 75);
  configuration = worklet.messages.at(-1).state;
  assert.equal(configuration.articulationManner, "affricate");
  assert.ok(configuration.articulationAperture > 0);
  const carrierDelay = fireFakeTimer(runtime, backend.releaseTimer);
  assert.ok(carrierDelay > closureDelay);
  assert.equal(worklet.messages.at(-1).state.articulationManner, "vowel");

  assert.equal(audio.articulate(voiceEvent("m")), true);
  assert.equal(worklet.messages.at(-1).state.articulationManner, "nasal");
  const nasalDelay = fireFakeTimer(runtime, backend.releaseTimer);
  assert.ok(nasalDelay >= 70 && nasalDelay <= 100);
  assert.equal(worklet.messages.at(-1).state.articulationManner, "vowel");

  assert.equal(audio.articulate(voiceEvent("x")), true);
  configuration = worklet.messages.at(-1).state;
  assert.equal(configuration.articulationManner, "stop");
  assert.equal(configuration.articulationIndex, 22, "X begins with a velar K closure");
  fireFakeTimer(runtime, backend.articulationTimer);
  configuration = worklet.messages.at(-1).state;
  assert.equal(configuration.articulationManner, "fricative");
  assert.equal(configuration.articulationIndex, 36, "X releases into alveolar S frication");

  await audio.close();
});

test("the diphone backend loads its atlas once and selects bounded sample slices", async () => {
  const runtime = fakeRuntime();
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "diphone", level: 0.38 });

  assert.equal(await audio.enable(), "diphone");
  const [context] = FakeAudioContext.instances;
  assert.equal(runtime.fetches.length, 1);
  assert.match(runtime.fetches[0], /spelling-diphone-kal16\.wav$/);
  assert.equal(context.decodeCalls.length, 1);
  assert.equal(context.filters.length, 1);
  assert.equal(context.filters[0].type, "lowpass");
  assert.equal(context.compressors.length, 1);

  const vowelEvent = voiceEvent("A");
  assert.equal(audio.articulate(vowelEvent), true);
  const [source] = atlasSources(context);
  assert.ok(source, "a decoded atlas source is scheduled for a letter");
  assert.equal(source.buffer, context.decodedBuffers[0]);
  assert.equal(source.playbackRate.value, 1, "KAL16 phones retain their measured formants");
  const expectedVowelDuration = Math.min(
    SPELLING_DIPHONE_CLIPS.a.duration,
    Math.min(0.52, Math.max(0.26, vowelEvent.dynamics.durationMs / 1_000)),
  );
  assert.deepEqual(source.starts, [{
    time: context.currentTime,
    offset: SPELLING_DIPHONE_CLIPS.a.offset,
    duration: expectedVowelDuration,
  }]);
  const eventGain = context.gains.at(-1).gain;
  const attackRamp = eventGain.events
    .filter(([method]) => method === "linearRampToValueAtTime")
    .at(0);
  const peak = attackRamp?.[1];
  assert.ok(peak > 0, "the clip's calibrated gain reaches the event envelope");
  assert.ok(Math.abs(attackRamp[2] - (context.currentTime + 0.002)) < 1e-9);
  assert.ok(
    eventGain.events.some(([method, value, time]) => (
      method === "setValueAtTime"
      && value === peak
      && time > attackRamp[2]
    )),
    "the sample gain holds through the phone body before its release",
  );

  assert.equal(audio.release({ releaseMs: 80 }), true);
  assert.deepEqual(source.stops, [context.currentTime + 0.08]);

  await audio.disable();
  assert.equal(context.state, "suspended");
  assert.equal(await audio.enable(), "diphone");
  assert.equal(runtime.fetches.length, 1, "re-enable reuses the decoded atlas");
  await audio.close();
  assert.equal(context.state, "closed");
});

test("pair clips play once even when the spelling gesture has multiple resolved sounds", async () => {
  const runtime = fakeRuntime();
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "diphone" });
  await audio.enable();
  const [context] = FakeAudioContext.instances;

  const quFirst = pairVoiceEvent("qu", "k", 0);
  const quSecond = pairVoiceEvent("qu", "w", 1);
  assert.equal(spellingDiphoneClipKey(quFirst), "q");
  assert.equal(spellingDiphoneClipKey(quSecond), "");
  assert.equal(audio.articulate(quFirst), true);
  assert.equal(audio.articulate(quSecond), true, "a consumed pair step is still handled");
  assert.equal(atlasSources(context).length, 1, "QU uses its joined sample only once");
  assert.equal(atlasSources(context)[0].starts[0].offset, SPELLING_DIPHONE_CLIPS.q.offset);

  const ch = pairVoiceEvent("ch", "c", 0);
  assert.equal(spellingDiphoneClipKey(ch), "ch");
  assert.equal(audio.articulate(ch), true);
  assert.equal(atlasSources(context).at(-1).starts[0].offset, SPELLING_DIPHONE_CLIPS.ch.offset);

  const ouFirst = pairVoiceEvent("ou", "o", 0);
  const ouSecond = pairVoiceEvent("ou", "u", 1);
  assert.equal(audio.articulate(ouFirst), true);
  assert.equal(audio.articulate(ouSecond), true);
  assert.equal(atlasSources(context).length, 3, "OU adds one joined glide, not two vowels");
  assert.equal(atlasSources(context).at(-1).starts[0].offset, SPELLING_DIPHONE_CLIPS.ou.offset);
  assert.equal(
    atlasSources(context).at(-1).starts[0].duration,
    SPELLING_DIPHONE_CLIPS.ou.duration,
    "the complete AW trajectory survives instead of truncating its offglide",
  );

  await audio.close();
});

test("the vocoder uses the diphone atlas as its modulator", async () => {
  const runtime = fakeRuntime();
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "vocoder" });

  assert.equal(await audio.enable(), "vocoder");
  const [context] = FakeAudioContext.instances;
  const [worklet] = FakeAudioWorkletNode.instances;
  assert.match(context.workletModules[0], /spelling-vocoder-processor\.js$/);
  assert.equal(worklet.name, "spelling-vocoder");
  assert.equal(worklet.options.numberOfInputs, 1);
  assert.equal(runtime.fetches.length, 1);
  assert.equal(context.compressors[0].ratio.value, 3.2);

  assert.equal(audio.articulate(voiceEvent("F", "whisper")), true);
  const [source] = atlasSources(context);
  assert.equal(source.starts[0].offset, SPELLING_DIPHONE_CLIPS.f.offset);
  const voice = worklet.messages.at(-1);
  assert.equal(voice.type, "voice");
  assert.equal("noiseMix" in voice, false, "the signal detector uses a voicedness prior, not fixed hiss");
  assert.ok(voice.voicednessHint < 0.1);
  assert.ok(voice.frequency > 0);
  assert.ok(voice.drive >= 1.2);
  assert.ok(Math.abs(voice.brightness - 0.6) < 1e-9);

  await audio.disable();
  assert.equal(source.stops.at(-1), context.currentTime);
  assert.equal(audio.backends.vocoder.active.size, 0);
  assert.deepEqual(worklet.messages.at(-1), { type: "reset" });
  assert.equal(context.state, "suspended");
  assert.equal(await audio.enable(), "vocoder");
  assert.equal(runtime.fetches.length, 1, "re-enable reuses the vocoder and decoded atlas");
  await audio.close();
});

test("a failed diphone selection restores the previously running engine", async () => {
  const runtime = fakeRuntime();
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "tube" });
  await audio.enable();
  const tubeContext = FakeAudioContext.instances[0];
  runtime.fetch = async (url) => {
    runtime.fetches.push(String(url));
    return { ok: false };
  };

  await assert.rejects(
    audio.selectEngine("diphone"),
    /diphone voice sample could not be loaded/i,
  );
  const failedContext = FakeAudioContext.instances[1];
  assert.equal(failedContext.state, "closed");
  assert.equal(audio.activeEngine, "tube");
  assert.equal(audio.running, true);
  assert.equal(tubeContext.state, "running");
  await audio.close();
});

test("cancelling a cold Tube start closes its partial context without falling back", async () => {
  const runtime = fakeRuntime();
  let resolveModule;
  class DeferredAudioContext extends FakeAudioContext {
    constructor(options) {
      super(options);
      this.audioWorklet.addModule = (url) => {
        this.workletModules.push(String(url));
        return new Promise((resolve) => { resolveModule = resolve; });
      };
    }
  }
  runtime.AudioContext = DeferredAudioContext;
  const fallbacks = [];
  const audio = new SpellingSynthesizerAudio({
    runtime,
    engine: "tube",
    onFallback: (fallback) => fallbacks.push(fallback),
  });

  const starting = audio.enable();
  for (let index = 0; index < 5 && !resolveModule; index += 1) await Promise.resolve();
  assert.equal(typeof resolveModule, "function");
  const disabling = audio.disable();
  resolveModule();
  await disabling;
  await assert.rejects(starting, { name: "AbortError" });
  const [context] = FakeAudioContext.instances;
  assert.equal(context.state, "closed");
  assert.equal(context.closeCount, 1);
  assert.equal(audio.running, false);
  assert.equal(audio.activeEngine, "tube");
  assert.equal(fallbacks.length, 0);
});

test("cancelling a cold diphone atlas load closes its partial context", async () => {
  const runtime = fakeRuntime();
  let resolveFetch;
  runtime.fetch = (url) => {
    runtime.fetches.push(String(url));
    return new Promise((resolve) => { resolveFetch = resolve; });
  };
  const fallbacks = [];
  const audio = new SpellingSynthesizerAudio({
    runtime,
    engine: "diphone",
    onFallback: (fallback) => fallbacks.push(fallback),
  });

  const starting = audio.enable();
  for (let index = 0; index < 5 && !resolveFetch; index += 1) await Promise.resolve();
  assert.equal(typeof resolveFetch, "function");
  const [context] = FakeAudioContext.instances;
  const disabling = audio.disable();
  resolveFetch({
    ok: true,
    async arrayBuffer() {
      return new ArrayBuffer(32);
    },
  });

  await disabling;
  await assert.rejects(starting, { name: "AbortError" });
  assert.equal(context.state, "closed");
  assert.equal(context.closeCount, 1);
  assert.equal(audio.running, false);
  assert.equal(audio.activeEngine, "diphone");
  assert.equal(fallbacks.length, 0);
});

test("a fetch abort cancels a cold diphone start without leaving a context open", async () => {
  const runtime = fakeRuntime();
  let signal;
  runtime.fetch = (url, options = {}) => {
    runtime.fetches.push(String(url));
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("Atlas fetch aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  };
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "diphone" });

  const starting = audio.enable();
  for (let index = 0; index < 5 && !signal; index += 1) await Promise.resolve();
  assert.ok(signal);
  await audio.disable();
  await assert.rejects(starting, { name: "AbortError" });
  const [context] = FakeAudioContext.instances;
  assert.equal(signal.aborted, true);
  assert.equal(context.state, "closed");
  assert.equal(context.closeCount, 1);
  assert.equal(audio.running, false);
});

test("disable wins when a suspended backend resume is still pending", async () => {
  const runtime = fakeRuntime();
  let resolveResume;
  let resumePending = false;
  let suspendQueued = false;
  class DeferredResumeContext extends FakeAudioContext {
    async resume() {
      this.resumeCount += 1;
      if (!this.masterReady) {
        this.state = "running";
        this.masterReady = true;
        return;
      }
      resumePending = true;
      await new Promise((resolve) => { resolveResume = resolve; });
      if (this.state !== "closed") this.state = suspendQueued ? "suspended" : "running";
      resumePending = false;
    }

    async suspend() {
      this.suspendCount += 1;
      if (resumePending) suspendQueued = true;
      else if (this.state !== "closed") this.state = "suspended";
    }
  }
  runtime.AudioContext = DeferredResumeContext;
  const audio = new SpellingSynthesizerAudio({ runtime, engine: "diphone" });
  await audio.enable();
  await audio.disable();

  const starting = audio.enable();
  for (let index = 0; index < 5 && !resolveResume; index += 1) await Promise.resolve();
  assert.equal(typeof resolveResume, "function");
  const stopping = audio.disable();
  resolveResume();
  await stopping;
  await assert.rejects(starting, { name: "AbortError" });
  const [context] = FakeAudioContext.instances;
  assert.equal(context.state, "suspended");
  assert.equal(audio.running, false);
});
