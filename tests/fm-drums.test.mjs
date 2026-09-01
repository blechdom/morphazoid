import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cloneDefaultFmDrumVoices,
  DEFAULT_FM_DRUM_VOICES,
  FmDrumAudio,
  MAX_FM_DRUM_ACTIVE_HITS,
  MAX_FM_DRUM_ACTIVE_SOURCES,
  MAX_FM_DRUM_SOURCE_BURST,
  MAX_FM_DRUM_SOURCE_STARTS_PER_SECOND,
  frequencyFromSlider,
  frequencySliderPosition,
  sanitizeFmDrumVoice,
} from "../src/fm-drums.js";

const root = new URL("../", import.meta.url);

test("FM Drums exposes sixteen uniquely keyed reusable voices", () => {
  assert.equal(DEFAULT_FM_DRUM_VOICES.length, 16);
  assert.equal(new Set(DEFAULT_FM_DRUM_VOICES.map(({ id }) => id)).size, 16);
  assert.deepEqual(
    DEFAULT_FM_DRUM_VOICES.map(({ key }) => key).join(""),
    "1234qwerasdfzxcv",
  );
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "kick"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "snare"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "hat"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "bell"), true);
});

test("FM drum banks clone cleanly and voice values stay bounded", () => {
  assert.equal(MAX_FM_DRUM_ACTIVE_HITS, 96);
  assert.equal(MAX_FM_DRUM_ACTIVE_SOURCES, 256);
  assert.equal(MAX_FM_DRUM_SOURCE_STARTS_PER_SECOND, 512);
  assert.equal(MAX_FM_DRUM_SOURCE_BURST, 192);
  const bank = cloneDefaultFmDrumVoices();
  bank[0].frequency = 999;
  assert.notEqual(bank[0].frequency, DEFAULT_FM_DRUM_VOICES[0].frequency);
  assert.deepEqual(
    sanitizeFmDrumVoice({
      frequency: -2,
      attack: 8,
      decay: 0,
      modRatio: 30,
      modIndex: -1,
      pitchBend: 80,
      noise: 4,
      tone: -3,
      level: 7,
    }),
    {
      frequency: 20,
      attack: .25,
      decay: .1,
      modRatio: 8,
      modIndex: 0,
      pitchBend: 8,
      noise: 1,
      tone: 0,
      level: 1,
    },
  );
});

test("FM drum tuning slider is logarithmic and reversible", () => {
  assert.equal(frequencyFromSlider(0), 35);
  assert.equal(frequencyFromSlider(1), 6_000);
  for (const frequency of [48, 176, 784, 4_820]) {
    assert.ok(Math.abs(frequencyFromSlider(frequencySliderPosition(frequency)) - frequency) < 1e-8);
  }
});

test("FM drum audio recreates a context after page lifecycle closure", async () => {
  let contextCount = 0;
  let closeCount = 0;
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class FakeContext {
    constructor() {
      contextCount += 1;
      this.state = "running";
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {},
        knee: {},
        ratio: {},
        attack: {},
        release: {},
      });
    }

    createGain() {
      return node({ gain: { value: 0 } });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    async close() {
      closeCount += 1;
      this.state = "closed";
    }
  }
  const audio = new FmDrumAudio({ AudioContext: FakeContext });
  const firstStart = audio.start();
  assert.equal(contextCount, 1, "the context is created synchronously inside the user gesture");
  const first = await firstStart;
  first.state = "closed";
  const second = await audio.start();
  assert.notEqual(second, first);
  assert.equal(contextCount, 2);
  await audio.close();
  assert.equal(closeCount, 1);
  assert.equal(audio.context, null);
  assert.equal(audio.master, null);
  const third = await audio.start();
  assert.notEqual(third, second);
  assert.equal(contextCount, 3);
});

test("FM drum audio resumes an interrupted context from a user gesture", async () => {
  let resumeCount = 0;
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class InterruptedContext {
    constructor() {
      this.state = "interrupted";
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
      });
    }

    createGain() {
      return node({ gain: { value: 0 } });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    async resume() {
      resumeCount += 1;
      this.state = "running";
    }
  }

  const audio = new FmDrumAudio({ AudioContext: InterruptedContext });
  const context = await audio.start();
  assert.equal(resumeCount, 1);
  assert.equal(context.state, "running");
});

test("FM drum audio gives rattles a pitched bandpass and repeated noise strikes", async () => {
  const gainEvents = [];
  const filters = [];
  const audioParam = (value = 0) => ({
    value,
    setValueAtTime(next, time) {
      this.value = next;
      gainEvents.push({ method: "set", value: next, time });
    },
    linearRampToValueAtTime(next, time) {
      this.value = next;
      gainEvents.push({ method: "linear", value: next, time });
    },
    exponentialRampToValueAtTime(next, time) {
      this.value = next;
      gainEvents.push({ method: "exponential", value: next, time });
    },
    setTargetAtTime(next) {
      this.value = next;
    },
  });
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class RattleContext {
    constructor() {
      this.state = "running";
      this.currentTime = 1;
      this.sampleRate = 1_000;
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
      });
    }

    createGain() {
      return node({ gain: audioParam() });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    createBiquadFilter() {
      const filter = node({ type: "", frequency: audioParam(), Q: audioParam() });
      filters.push(filter);
      return filter;
    }

    createOscillator() {
      return node({
        type: "sine",
        frequency: audioParam(),
        start() {},
        stop() {},
      });
    }

    createBuffer(channels, frameCount) {
      return { getChannelData: () => new Float32Array(frameCount) };
    }

    createBufferSource() {
      return node({ start() {}, stop() {}, buffer: null });
    }
  }

  const audio = new FmDrumAudio({ AudioContext: RattleContext });
  const voice = await audio.trigger({
    ...DEFAULT_FM_DRUM_VOICES[4],
    family: "rattle",
    frequency: 220,
    decay: 0.2,
    noise: 0.9,
  });
  assert.equal(voice.family, "rattle");
  assert.equal(filters.length, 2);
  assert.ok(filters.every(({ type }) => type === "bandpass"));
  assert.equal(filters[0].frequency.value, 1_100);
  assert.equal(filters[1].frequency.value, 1_320);
  assert.ok(
    gainEvents.filter(({ method }) => method === "linear").length >= 4,
    "the noise layer should contain several individual rattle strikes",
  );
});

test("FM drum hits follow absolute audio time and reuse one noise buffer", async () => {
  const buffers = [];
  const oscillators = [];
  const noiseSources = [];
  const audioParam = (value = 0) => ({
    value,
    setValueAtTime(next) { this.value = next; },
    linearRampToValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    setTargetAtTime(next) { this.value = next; },
  });
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) { return destination; },
  });
  class ScheduledContext {
    constructor() {
      this.state = "running";
      this.currentTime = 3;
      this.sampleRate = 1_000;
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
    }

    createGain() { return node({ gain: audioParam() }); }

    createAnalyser() { return node({ fftSize: 0 }); }

    createBiquadFilter() {
      return node({ type: "", frequency: audioParam(), Q: audioParam() });
    }

    createOscillator() {
      const oscillator = node({
        type: "sine",
        frequency: audioParam(),
        starts: [],
        stops: [],
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
      });
      oscillators.push(oscillator);
      return oscillator;
    }

    createBuffer(channels, frameCount, sampleRate) {
      const buffer = {
        channels,
        frameCount,
        sampleRate,
        getChannelData: () => new Float32Array(frameCount),
      };
      buffers.push(buffer);
      return buffer;
    }

    createBufferSource() {
      const source = node({
        buffer: null,
        starts: [],
        stops: [],
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
      });
      noiseSources.push(source);
      return source;
    }
  }

  const audio = new FmDrumAudio({ AudioContext: ScheduledContext });
  const noisyVoice = { ...DEFAULT_FM_DRUM_VOICES[2], noise: 0.8 };

  await audio.trigger(noisyVoice, { startAt: 3.125 });
  assert.deepEqual(oscillators.slice(0, 2).map(({ starts }) => starts), [[3.125], [3.125]]);
  assert.deepEqual(noiseSources[0].starts, [3.125]);

  audio.context.currentTime = 4;
  await audio.trigger(noisyVoice, { startAt: 3.75 });
  assert.deepEqual(oscillators.slice(2, 4).map(({ starts }) => starts), [[4], [4]]);
  assert.deepEqual(noiseSources[1].starts, [4]);

  audio.context.currentTime = 5;
  await audio.trigger(noisyVoice, { startDelaySeconds: 0.075 });
  assert.deepEqual(oscillators.slice(4, 6).map(({ starts }) => starts), [[5.075], [5.075]]);
  assert.deepEqual(noiseSources[2].starts, [5.075]);

  await audio.trigger({ ...noisyVoice, frequency: noisyVoice.frequency * 2 }, { startAt: 5.2 });
  const unpitchedDuration = oscillators[0].stops[0] - oscillators[0].starts[0];
  const octaveUpDuration = oscillators[6].stops[0] - oscillators[6].starts[0];
  assert.ok(Math.abs(octaveUpDuration - unpitchedDuration) < 1e-12,
    "synth-drum pitch should not rescale its envelope duration");

  assert.equal(buffers.length, 1, "repeated hits should not regenerate white noise");
  assert.equal(buffers[0].frameCount, 2_500);
  assert.ok(noiseSources.every(({ buffer }) => buffer === buffers[0]));
});

test("FM drum silence cancels future hits and fades active sources before cleanup", async () => {
  const audioParam = (value = 0) => ({
    value,
    calls: [],
    setValueAtTime(next, time) {
      this.value = next;
      this.calls.push(["set", next, time]);
    },
    linearRampToValueAtTime(next, time) {
      this.value = next;
      this.calls.push(["linear", next, time]);
    },
    exponentialRampToValueAtTime(next, time) {
      this.value = next;
      this.calls.push(["exponential", next, time]);
    },
    cancelScheduledValues(time) { this.calls.push(["cancel", time]); },
    cancelAndHoldAtTime(time) { this.calls.push(["hold", time]); },
    setTargetAtTime(next) { this.value = next; },
  });
  const node = (properties = {}) => ({
    disconnectCount: 0,
    ...properties,
    connect(destination) { return destination; },
    disconnect() { this.disconnectCount += 1; },
  });
  class SilenceContext {
    constructor() {
      this.state = "running";
      this.currentTime = 1;
      this.sampleRate = 1_000;
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
    }

    createGain() { return node({ gain: audioParam() }); }

    createAnalyser() { return node({ fftSize: 0 }); }

    createBiquadFilter() {
      return node({ type: "", frequency: audioParam(), Q: audioParam() });
    }

    createOscillator() {
      return node({
        type: "sine",
        frequency: audioParam(),
        starts: [],
        stops: [],
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
        onended: null,
      });
    }

    createBuffer(_channels, frameCount) {
      return { getChannelData: () => new Float32Array(frameCount) };
    }

    createBufferSource() {
      return node({
        buffer: null,
        starts: [],
        stops: [],
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
        onended: null,
      });
    }
  }

  const audio = new FmDrumAudio({ AudioContext: SilenceContext });
  const noisyVoice = { ...DEFAULT_FM_DRUM_VOICES[2], noise: 0.8 };
  await audio.trigger(noisyVoice, { startAt: 1 });
  await audio.trigger(noisyVoice, { startAt: 1.5 });
  const [activeHit, futureHit] = [...audio.activeHits];
  assert.equal(audio.activeHits.size, 2);

  audio.context.currentTime = 1.1;
  audio.silence();

  assert.equal(futureHit.cleaned, true);
  assert.equal(audio.activeHits.has(futureHit), false);
  assert.equal(futureHit.carrier.stops.at(-1), 1.1);
  assert.equal(futureHit.modulator.stops.at(-1), 1.1);
  assert.equal(futureHit.noiseLayer.source.stops.at(-1), 1.1);
  assert.ok(futureHit.filter.disconnectCount > 0);
  assert.ok(futureHit.amplitude.gain.calls.some(([method, , time]) => (
    method === "set" && time === 1.1
  )));

  assert.equal(audio.activeHits.has(activeHit), true, "an audible hit remains tracked through its fade");
  assert.equal(activeHit.carrier.stops.at(-1), 1.13);
  assert.equal(activeHit.modulator.stops.at(-1), 1.13);
  assert.equal(activeHit.noiseLayer.source.stops.at(-1), 1.13);
  assert.ok(activeHit.amplitude.gain.calls.some(([method, time]) => (
    method === "hold" && time === 1.1
  )));
  assert.ok(activeHit.amplitude.gain.calls.some(([method, value, time]) => (
    method === "exponential" && value === 0.0001 && time === 1.125
  )));

  for (const source of [...activeHit.pendingSources]) source.onended();
  assert.equal(audio.activeHits.size, 0);
  assert.equal(activeHit.cleaned, true);
  assert.ok(activeHit.filter.disconnectCount > 0);
  assert.ok(activeHit.amplitude.disconnectCount > 0);
});

function makeGuardedFmRuntime({ failure = null } = {}) {
  const created = {
    nodes: [],
    oscillators: [],
    bufferSources: [],
    oscillatorAttempts: 0,
    gainAttempts: 0,
    contexts: [],
    closeCount: 0,
    failure,
  };
  const audioParam = (value = 0) => ({
    value,
    setValueAtTime(next) { this.value = next; },
    linearRampToValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    setTargetAtTime(next) { this.value = next; },
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
  });
  const node = (properties = {}) => {
    const result = {
      connections: [],
      disconnectCount: 0,
      ...properties,
      connect(destination) {
        this.connections.push(destination);
        return destination;
      },
      disconnect() {
        this.disconnectCount += 1;
        this.connections.length = 0;
      },
    };
    created.nodes.push(result);
    return result;
  };

  class GuardedContext {
    constructor() {
      this.state = "running";
      this.currentTime = 1;
      this.sampleRate = 1_000;
      this.destination = node();
      created.contexts.push(this);
    }

    createDynamicsCompressor() {
      return node({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
    }

    createGain() {
      created.gainAttempts += 1;
      if (created.failure === "output-gain" && created.gainAttempts === 1) {
        throw new DOMException("injected output exhaustion", "QuotaExceededError");
      }
      return node({ gain: audioParam() });
    }

    createAnalyser() { return node({ fftSize: 0 }); }

    createBiquadFilter() {
      return node({ type: "", frequency: audioParam(), Q: audioParam() });
    }

    createOscillator() {
      created.oscillatorAttempts += 1;
      if (created.failure === "second-oscillator" && created.oscillatorAttempts === 2) {
        throw new DOMException("injected oscillator exhaustion", "QuotaExceededError");
      }
      const oscillator = node({
        type: "sine",
        frequency: audioParam(),
        starts: [],
        stops: [],
        onended: null,
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
      });
      created.oscillators.push(oscillator);
      return oscillator;
    }

    createBuffer(_channels, frameCount) {
      return { getChannelData: () => new Float32Array(frameCount) };
    }

    createBufferSource() {
      const source = node({
        buffer: null,
        starts: [],
        stops: [],
        onended: null,
        start(time) {
          this.starts.push(time);
          if (created.failure === "noise-start") {
            throw new DOMException("injected source exhaustion", "OperationError");
          }
        },
        stop(time) { this.stops.push(time); },
      });
      created.bufferSources.push(source);
      return source;
    }

    async close() {
      created.closeCount += 1;
      this.state = "closed";
    }
  }

  const runtime = { AudioContext: GuardedContext };
  return { runtime, created };
}

test("FM drum output construction closes and disconnects a partial graph", async () => {
  const { runtime, created } = makeGuardedFmRuntime({ failure: "output-gain" });
  const audio = new FmDrumAudio(runtime);

  await assert.rejects(audio.start(), /injected output exhaustion/);
  const failedContext = created.contexts[0];
  const failedCompressor = created.nodes.find((candidate) => (
    candidate !== failedContext.destination && "threshold" in candidate
  ));
  assert.equal(failedContext.state, "closed");
  assert.equal(created.closeCount, 1);
  assert.ok(failedCompressor.disconnectCount > 0);
  assert.equal(audio.context, null);
  assert.equal(audio.input, null);
  assert.equal(audio.master, null);

  created.failure = null;
  const recovered = await audio.start();
  assert.equal(recovered.state, "running");
  assert.notEqual(recovered, failedContext);
});

test("FM drum admission bounds live hits and source allocation without throwing", async () => {
  const { runtime, created } = makeGuardedFmRuntime();
  const audio = new FmDrumAudio(runtime, {
    maxActiveHits: 2,
    maxActiveSources: 4,
    sourceStartsPerSecond: 20,
    sourceBurst: 4,
  });
  const quietVoice = { ...DEFAULT_FM_DRUM_VOICES[0], noise: 0, decay: 3 };

  const first = await audio.trigger(quietVoice, { startAt: 1 });
  const second = await audio.trigger(quietVoice, { startAt: 1.1 });
  const skipped = await audio.trigger(quietVoice, { startAt: 1.2 });

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, true);
  assert.deepEqual(
    { scheduled: skipped.scheduled, skipped: skipped.skipped, reason: skipped.skipReason },
    { scheduled: false, skipped: true, reason: "live-hit-budget" },
  );
  assert.equal(audio.activeHits.size, 2);
  assert.equal(audio.activeSourceCount, 4);
  assert.equal(created.oscillators.length, 4, "a rejected hit must allocate no native nodes");

  for (const source of [...audio.activeHits][0].sources) source.onended?.();
  audio.context.currentTime = 1.25;
  const recovered = await audio.trigger(quietVoice, { startAt: 1.25 });
  assert.equal(recovered.scheduled, true, "capacity should recover as sources end");
  assert.equal(audio.activeHits.size, 2);
  assert.equal(audio.activeSourceCount, 4);
});

test("FM drum source-rate admission refills without allocating rejected hits", async () => {
  const { runtime, created } = makeGuardedFmRuntime();
  const audio = new FmDrumAudio(runtime, {
    maxActiveHits: 8,
    maxActiveSources: 16,
    sourceStartsPerSecond: 2,
    sourceBurst: 2,
  });
  const quietVoice = { ...DEFAULT_FM_DRUM_VOICES[0], noise: 0 };

  assert.equal((await audio.trigger(quietVoice)).scheduled, true);
  const skipped = await audio.trigger(quietVoice);
  assert.equal(skipped.scheduled, false);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.skipReason, "source-rate-budget");
  assert.equal(created.oscillators.length, 2);

  audio.context.currentTime = 2;
  const recovered = await audio.trigger(quietVoice);
  assert.equal(recovered.scheduled, true);
  assert.equal(created.oscillators.length, 4);
});

test("FM drum source-cost admission accounts for optional noise layers", async () => {
  const { runtime, created } = makeGuardedFmRuntime();
  const audio = new FmDrumAudio(runtime, {
    maxActiveHits: 8,
    maxActiveSources: 5,
    sourceStartsPerSecond: 20,
    sourceBurst: 5,
  });
  const noisyVoice = { ...DEFAULT_FM_DRUM_VOICES[2], noise: 0.8, decay: 3 };

  const first = await audio.trigger(noisyVoice);
  const skipped = await audio.trigger(noisyVoice);
  assert.equal(first.scheduled, true);
  assert.equal(audio.activeSourceCount, 3);
  assert.equal(skipped.scheduled, false);
  assert.equal(skipped.skipReason, "live-source-budget");
  assert.equal(created.oscillators.length, 2);
  assert.equal(created.bufferSources.length, 1);
});

for (const failure of ["second-oscillator", "noise-start"]) {
  test(`FM drum construction rolls back every partial node after ${failure}`, async () => {
    const { runtime, created } = makeGuardedFmRuntime({ failure });
    const audio = new FmDrumAudio(runtime, {
      maxActiveHits: 8,
      maxActiveSources: 24,
      sourceStartsPerSecond: 24,
      sourceBurst: 24,
    });
    await audio.start();
    const graphNodeCount = created.nodes.length;
    const voice = {
      ...DEFAULT_FM_DRUM_VOICES[2],
      noise: failure === "noise-start" ? 0.8 : 0,
    };

    await assert.rejects(audio.trigger(voice), /injected .* exhaustion/);
    const partialNodes = created.nodes.slice(graphNodeCount);
    assert.ok(partialNodes.length > 0);
    assert.ok(
      partialNodes.every(({ disconnectCount }) => disconnectCount > 0),
      "every native node created for a failed hit must be disconnected",
    );
    assert.ok(
      [...created.oscillators, ...created.bufferSources]
        .every(({ stops }) => stops.at(-1) === audio.context.currentTime),
      "every partial source must be stopped immediately",
    );
    assert.equal(audio.activeHits.size, 0);
    assert.equal(audio.activeSourceCount, 0);

    created.failure = null;
    const recovered = await audio.trigger(voice);
    assert.equal(recovered.scheduled, true, "the same AudioContext should remain usable");
    assert.equal(audio.activeHits.size, 1);
  });
}

test("FM drum audio cancels a suspended start when page lifecycle closure wins", async () => {
  let resolveResume;
  const resumeGate = new Promise((resolve) => {
    resolveResume = resolve;
  });
  const node = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  class SuspendedContext {
    constructor() {
      this.state = "suspended";
      this.destination = node();
    }

    createDynamicsCompressor() {
      return node({
        threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
      });
    }

    createGain() {
      return node({ gain: { value: 0 } });
    }

    createAnalyser() {
      return node({ fftSize: 0 });
    }

    async resume() {
      await resumeGate;
      this.state = "running";
    }

    async close() {
      this.state = "closed";
    }
  }

  const audio = new FmDrumAudio({ AudioContext: SuspendedContext });
  const pendingStart = audio.start();
  const pendingContext = audio.context;
  assert.equal(pendingContext.state, "suspended");

  await audio.close();
  assert.equal(audio.context, null);
  resolveResume();
  await assert.rejects(pendingStart, (error) => (
    error?.name === "AbortError"
    && /cancelled/i.test(error.message)
  ));
  assert.equal(audio.context, null, "the late resume must not restore a closed context");
});

test("FM Drums keeps compact preset controls without a page title block", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("fm-drums.html", root), "utf8"),
    readFile(new URL("fm-drums.css", root), "utf8"),
    readFile(new URL("fm-drums-app.js", root), "utf8"),
  ]);
  assert.match(html, /class="masthead"/);
  assert.match(html, /class="mobile-instrument-select"/);
  assert.match(html, /id="padGrid"/);
  assert.match(html, /id="randomizeSet"/);
  assert.match(html, /id="resetSet"/);
  assert.match(html, /id="downloadBank"/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="fm-drums-app\.js"/);
  assert.match(html, /MIDI NOTES 36–51/);
  assert.match(html, /Controller Macros 1–8 · tune · decay · FM ratio · FM index · pitch sweep · noise · tone · level/);
  assert.match(html, /CC7 output · CC16 tune · CC73 attack · CC72 decay/);
  assert.match(html, /Computer pads · turn MIDI on, then use 1–4 \/ Q–R \/ A–F \/ Z–V/);
  assert.doesNotMatch(html, /id="fmDrumsTitle"|fm-drums-kicker|fm-drums-lede/);
  assert.doesNotMatch(css, /\.fm-drums-kicker|\.fm-drums-lede|\.fm-drums-intro h1/);
  assert.match(css, /\.fm-pad-grid[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /\.fm-midi-map-note/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /getSharedMidiManager/);
  assert.match(app, /registerClient\(\{/);
  assert.match(app, /fmDrumMidiAction/);
  assert.match(app, /createFmDrumMidiTriggerVoice/);
  assert.match(app, /function refreshEditorControls\(voice\)/);
  assert.match(app, /Object\.assign\(voice, updated\)/);
  assert.match(app, /refreshPad\(voice\);[\s\S]+refreshEditorControls\(voice\)/);
  assert.match(app, /onPrepareEnable:[\s\S]+enableAudio\(\)/);
  assert.match(app, /function isWaxMidiOnly\(\)/);
  assert.match(app, /if \(isWaxMidiOnly\(\)\) return;/);
  assert.match(app, /!state\.audioOn && !isWaxMidiOnly\(\)/);
  assert.match(app, /let audioLifecycleGeneration = 0;/);
  assert.match(app, /lifecycleGeneration !== audioLifecycleGeneration/);
  assert.match(app, /pagehide[\s\S]+audioLifecycleGeneration \+= 1;[\s\S]+audioStartPromise = null;/);
  assert.match(app, /if \(midiManager\.enabled\) return;/);
  assert.match(app, /computerKeyboard: \{ layout: "pad-grid", baseNote: 36, velocity: 110 \}/);
  assert.match(app, /pagehide[\s\S]+unregisterMidi\?\.\(\)[\s\S]+audio\.close\(\)/);
  assert.match(app, /pageshow[\s\S]+registerMidiClient\(\)/);
  assert.doesNotMatch(html, /id="midiButton"|id="playModeMidi"/);
  assert.match(app, /new Blob\(\[data\], \{ type: "application\/json" \}\)/);
  assert.match(app, /morphazoid-fm-drums-\$\{date\}\.json/);
});
