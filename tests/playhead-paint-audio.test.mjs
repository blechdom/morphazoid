import assert from "node:assert/strict";
import test from "node:test";

import { getSharedAudioOutputManager } from "../src/audio-output-manager.js";
import {
  DEFAULT_PLAYHEAD_PAINT_ADSR,
  PLAYHEAD_PAINT_DECLICK_ATTACK_MS,
  PLAYHEAD_PAINT_DECLICK_DECAY_MS,
  PLAYHEAD_PAINT_DECLICK_RELEASE_MS,
  PlayheadPaintAudio,
  sanitizePlayheadPaintAdsr,
  sanitizePlayheadPaintVoice,
} from "../src/playhead-paint-audio.js";

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

  disconnect(destination) {
    this.disconnectCount += 1;
    if (destination === undefined) this.connections.length = 0;
    else this.connections = this.connections.filter((target) => target !== destination);
  }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super("oscillator");
    this.type = "sine";
    this.frequency = new FakeAudioParam(440);
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }

  start(time = 0) {
    this.starts.push(time);
  }

  stop(time = 0) {
    this.stops.push(time);
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
    super("filter");
    this.type = "lowpass";
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
  }
}

class FakePanner extends FakeNode {
  constructor() {
    super("panner");
    this.pan = new FakeAudioParam(0);
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
  constructor(channels, length) {
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel) {
    return this.channels[channel];
  }
}

class FakeBufferSource extends FakeNode {
  constructor() {
    super("buffer-source");
    this.buffer = null;
    this.starts = [];
    this.stops = [];
    this.onended = null;
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
    this.state = "suspended";
    this.currentTime = 5;
    this.sampleRate = 48_000;
    this.destination = new FakeNode("destination");
    this.oscillators = [];
    this.gains = [];
    this.filters = [];
    this.panners = [];
    this.compressors = [];
    this.bufferSources = [];
    this.resumeCount = 0;
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

  createDynamicsCompressor() {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  }

  createBuffer(channels, length) {
    return new FakeBuffer(channels, length);
  }

  createBufferSource() {
    const node = new FakeBufferSource();
    this.bufferSources.push(node);
    return node;
  }

  async resume() {
    this.resumeCount += 1;
    this.state = "running";
  }

  async close() {
    this.closeCount += 1;
    this.state = "closed";
  }
}

function fakeRuntime(Context = FakeAudioContext) {
  Context.instances.length = 0;
  let nextTimer = 1;
  const timers = new Map();
  return {
    AudioContext: Context,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    runAllTimers() {
      while (timers.size) {
        const queued = [...timers.values()];
        timers.clear();
        for (const { callback } of queued) callback();
      }
    },
    timers,
  };
}

test("voice and ADSR sanitizers repair hostile persisted values", () => {
  assert.deepEqual(sanitizePlayheadPaintAdsr({
    attackMs: -20,
    decayMs: Infinity,
    sustain: 3,
    releaseMs: 99_000,
  }), {
    attackMs: 0,
    decayMs: DEFAULT_PLAYHEAD_PAINT_ADSR.decayMs,
    sustain: 1,
    releaseMs: 10_000,
  });

  assert.deepEqual(sanitizePlayheadPaintVoice({
    frequency: 1,
    gain: -1,
    pan: 8,
    brightness: -4,
    waveform: "noise",
    modulationDepth: 2,
    attackMs: 0,
    decayMs: 25,
    sustain: 0.4,
    releaseMs: 30,
  }), {
    frequency: 20,
    gain: 0,
    pan: 1,
    brightness: 0,
    waveform: "sine",
    modulationDepth: 1,
    adsr: { attackMs: 0, decayMs: 25, sustain: 0.4, releaseMs: 30 },
  });
});

test("start is silent and noteOn schedules a routed keyed ADSR voice", async () => {
  const runtime = fakeRuntime();
  const audio = new PlayheadPaintAudio({ runtime, maxVoices: 8, level: 0.7 });

  assert.equal(FakeAudioContext.instances.length, 0, "module is lazy");
  const context = await audio.start();
  assert.equal(context.state, "running");
  assert.equal(audio.running, true);
  assert.equal(context.options.latencyHint, "interactive");
  assert.equal(context.oscillators.length, 0, "arming audio creates no audible voices");
  assert.equal(context.bufferSources.length, 1, "arming uses the shared mobile unlock convention");
  assert.equal(audio.master.connections.includes(context.destination), true);
  assert.equal(audio.voiceBus.connections.includes(context.destination), false);
  assert.equal(
    getSharedAudioOutputManager(runtime).getStatus().connectionCount,
    1,
    "the mix owns exactly one shared-output lease",
  );

  assert.equal(await audio.noteOn("stroke-1:identity", {
    frequency: 330,
    gain: 0.75,
    pan: -0.25,
    brightness: 0.4,
    waveform: "triangle",
    modulationDepth: 0.35,
    adsr: { attackMs: 40, decayMs: 100, sustain: 0.6, releaseMs: 250 },
  }, { when: 5.1 }), true);

  const voice = audio.activeVoices.get("stroke-1:identity");
  assert.ok(voice);
  assert.equal(audio.activeVoiceCount, 1);
  assert.deepEqual(voice.carrier.starts, [5.1]);
  assert.deepEqual(voice.modulator.starts, [5.1]);
  assert.equal(voice.carrier.type, "triangle");
  assert.equal(voice.panner.pan.value, -0.25);
  assert.equal(voice.filter.type, "lowpass");
  assert.ok(voice.modulationGain.gain.value > 0);
  assert.ok(voice.panner.connections.includes(audio.voiceBus));
  assert.equal(voice.panner.connections.includes(context.destination), false);
  assert.ok(voice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime"
    && event[1] === 1
    && Math.abs(event[2] - 5.14) < 1e-9
  )));
  assert.ok(voice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime"
    && event[1] === 0.6
    && Math.abs(event[2] - 5.24) < 1e-9
  )));

  await audio.close();
  assert.equal(getSharedAudioOutputManager(runtime).getStatus().connectionCount, 0);
});

test("updates are smoothed at absolute times and noteOff releases and cleans up", async () => {
  const runtime = fakeRuntime();
  const audio = new PlayheadPaintAudio({ runtime });
  await audio.noteOn("draw", {
    frequency: 220,
    gain: 0.8,
    adsr: { attackMs: 5, decayMs: 20, sustain: 0.5, releaseMs: 240 },
  });
  const context = audio.context;
  const voice = audio.activeVoices.get("draw");
  context.currentTime = 6;

  assert.equal(audio.updateVoice("draw", {
    frequency: 880,
    gain: 0.5,
    pan: 2,
    brightness: 0,
    waveform: "square",
    modulationDepth: 1,
  }, { when: 6.12 }), true);
  assert.equal(voice.spec.frequency, 880);
  assert.equal(voice.spec.pan, 1);
  assert.equal(voice.spec.waveform, "square");
  assert.equal(
    voice.carrier.type,
    "sine",
    "a discrete waveform replacement is deferred until the next gate",
  );
  assert.ok(voice.carrier.frequency.events.some((event) => (
    event[0] === "setTargetAtTime" && event[1] === 880 && event[2] === 6.12
  )));
  assert.ok(voice.panner.pan.events.some((event) => (
    event[0] === "setTargetAtTime" && event[1] === 1 && event[2] === 6.12
  )));

  assert.equal(audio.noteOff("draw", { when: 6.2 }), true);
  assert.equal(audio.activeVoiceCount, 0);
  assert.equal(audio.allocatedVoiceCount, 1, "release tail keeps resources until cleanup");
  assert.ok(voice.envelope.gain.events.some((event) => (
    event[0] === "cancelAndHoldAtTime" && event[1] === 6.2
  )));
  assert.ok(voice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime" && event[1] === 0 && event[2] === 6.44
  )));
  assert.ok(Math.abs(voice.carrier.stops.at(-1) - 6.46) < 1e-9);

  runtime.runAllTimers();
  assert.equal(audio.allocatedVoiceCount, 0);
  assert.equal(voice.carrier.disconnectCount > 0, true);
  assert.equal(audio.updateVoice("draw", { frequency: 440 }), false);
  await audio.close();
});

test("zero-time ADSR edges retain de-click ramps and stop modulation only after silence", async () => {
  const runtime = fakeRuntime();
  const audio = new PlayheadPaintAudio({ runtime });
  await audio.noteOn("hard-edge", {
    waveform: "sawtooth",
    adsr: { attackMs: 0, decayMs: 0, sustain: 0.35, releaseMs: 0 },
  });
  const context = audio.context;
  const voice = audio.activeVoices.get("hard-edge");
  const attackEnd = 5 + PLAYHEAD_PAINT_DECLICK_ATTACK_MS / 1_000;
  const decayEnd = attackEnd + PLAYHEAD_PAINT_DECLICK_DECAY_MS / 1_000;

  assert.deepEqual(voice.spec.adsr, {
    attackMs: 0,
    decayMs: 0,
    sustain: 0.35,
    releaseMs: 0,
  }, "editor ADSR remains exact even though synthesis de-clicks it");
  assert.ok(voice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime"
    && event[1] === 1
    && Math.abs(event[2] - attackEnd) < 1e-9
  )));
  assert.ok(voice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime"
    && event[1] === 0.35
    && Math.abs(event[2] - decayEnd) < 1e-9
  )));
  assert.equal(
    voice.envelope.gain.events.some((event) => event[0] === "setValueAtTime" && event[1] === 1),
    false,
    "noteOn never steps the envelope directly to full gain",
  );

  context.currentTime = 5.02;
  assert.equal(audio.updateVoice("hard-edge", { waveform: "square" }), true);
  assert.equal(voice.spec.waveform, "square");
  assert.equal(voice.carrier.type, "sawtooth", "active oscillator type is not discontinuously replaced");
  assert.equal(audio.noteOff("hard-edge", { releaseMs: 0 }), true);
  const releaseEnd = 5.02 + PLAYHEAD_PAINT_DECLICK_RELEASE_MS / 1_000;
  const stopAt = releaseEnd + 0.02;
  assert.ok(voice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime"
    && event[1] === 0
    && Math.abs(event[2] - releaseEnd) < 1e-9
  )));
  assert.equal(
    voice.envelope.gain.events.some((event) => (
      event[0] === "setValueAtTime" && event[1] === 0 && Math.abs(event[2] - 5.02) < 1e-9
    )),
    false,
    "noteOff never hard-mutes at the gate boundary",
  );
  assert.ok(Math.abs(voice.carrier.stops.at(-1) - stopAt) < 1e-9);
  assert.ok(Math.abs(voice.modulator.stops.at(-1) - stopAt) < 1e-9);
  runtime.runAllTimers();
  assert.equal(audio.allocatedVoiceCount, 0);

  context.currentTime = 5.1;
  await audio.noteOn("next-gate", { waveform: "square" });
  const nextVoice = audio.activeVoices.get("next-gate");
  assert.equal(nextVoice.carrier.type, "square", "deferred waveform applies on a fresh zero-gain gate");
  audio.panic({ releaseMs: 0 });
  assert.ok(nextVoice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime"
    && event[1] === 0
    && Math.abs(event[2] - (5.1 + PLAYHEAD_PAINT_DECLICK_RELEASE_MS / 1_000)) < 1e-9
  )), "panic also honors the minimum release ramp");
  await audio.close();
});

test("look-ahead updates and noteOff survive an unawaited scheduled noteOn", async () => {
  const runtime = fakeRuntime();
  const audio = new PlayheadPaintAudio({ runtime });
  await audio.start();
  const context = audio.context;
  context.currentTime = 7;

  const scheduledNote = audio.noteOn("loop", {
    frequency: 220,
    adsr: { attackMs: 5, decayMs: 20, sustain: 0.7, releaseMs: 80 },
  }, { when: 7.1 });
  assert.equal(audio.updateVoice("loop", { frequency: 440 }, { when: 7.2 }), true);
  assert.equal(audio.noteOff("loop", { when: 7.4 }), true);
  assert.equal(await scheduledNote, true);

  const voice = [...audio.voices][0];
  assert.deepEqual(voice.carrier.starts, [7.1], "an update must not move note onset");
  assert.ok(voice.carrier.frequency.events.some((event) => (
    event[0] === "setTargetAtTime" && event[1] === 440 && event[2] === 7.2
  )));
  assert.equal(audio.activeVoiceCount, 0, "the queued gate-off is owned by the created voice");
  assert.ok(Math.abs(voice.carrier.stops.at(-1) - 7.5) < 1e-9);
  runtime.runAllTimers();
  assert.equal(audio.allocatedVoiceCount, 0);
  await audio.close();
});

test("noteOff while context resume is pending cannot leave a stuck note", async () => {
  class DeferredAudioContext extends FakeAudioContext {
    static instances = [];

    constructor(options) {
      super(options);
      FakeAudioContext.instances.pop();
      DeferredAudioContext.instances.push(this);
      this.resumeGate = new Promise((resolve) => { this.resolveResume = resolve; });
    }

    async resume() {
      this.resumeCount += 1;
      await this.resumeGate;
      this.state = "running";
    }
  }

  const runtime = fakeRuntime(DeferredAudioContext);
  const audio = new PlayheadPaintAudio({ runtime });
  const pendingNote = audio.noteOn("pointer", { frequency: 440 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(audio.pendingVoices.has("pointer"), true);
  assert.equal(audio.noteOff("pointer"), true);
  const [context] = DeferredAudioContext.instances;
  context.resolveResume();
  assert.equal(await pendingNote, false);
  assert.equal(audio.activeVoiceCount, 0);
  assert.equal(audio.allocatedVoiceCount, 0);
  assert.equal(context.oscillators.length, 0);
  await audio.close();
});

test("voice stealing stays bounded, eight-way headroom is limited, and panic cannot stick", async () => {
  const runtime = fakeRuntime();
  const audio = new PlayheadPaintAudio({ runtime, maxVoices: 8 });
  for (let index = 0; index < 8; index += 1) {
    assert.equal(await audio.noteOn(`symmetry-${index}`, { gain: 1 }), true);
  }
  assert.equal(audio.activeVoiceCount, 8);
  assert.equal(audio.allocatedVoiceCount, 8);
  const gainSum = [...audio.voices].reduce((sum, voice) => sum + voice.level.gain.value, 0);
  assert.ok(gainSum <= 0.8200001, `requested peak sum was ${gainSum}`);

  const oldestVoice = audio.activeVoices.get("symmetry-0");
  assert.equal(await audio.noteOn("ninth", { gain: 1 }), true);
  assert.equal(audio.allocatedVoiceCount, 9, "the stolen voice keeps one bounded de-click tail");
  assert.equal(audio.activeVoiceCount, 8);
  assert.equal(audio.allocatedVoiceCount <= audio.maxAllocatedVoices, true);
  assert.equal(audio.updateVoice("symmetry-0", { frequency: 999 }), false, "oldest key was stolen");
  assert.equal(oldestVoice.state, "releasing");
  assert.equal(oldestVoice.finalized, false, "stealing does not abruptly disconnect an audible node");
  assert.ok(oldestVoice.envelope.gain.events.some((event) => (
    event[0] === "linearRampToValueAtTime"
    && event[1] === 0
    && Math.abs(event[2] - (5 + PLAYHEAD_PAINT_DECLICK_RELEASE_MS / 1_000)) < 1e-9
  )));
  assert.equal(oldestVoice.carrier.disconnectCount, 0);

  assert.equal(audio.panic(), 9);
  assert.equal(audio.activeVoiceCount, 0);
  assert.equal(audio.allocatedVoiceCount, 9);
  runtime.runAllTimers();
  assert.equal(audio.allocatedVoiceCount, 0);
  assert.equal(audio.noteOff("ninth"), false);
  await audio.close();
});

test("minimal native-style contexts can fall back without filter, panner, or compressor", async () => {
  class MinimalAudioContext extends FakeAudioContext {
    static instances = [];

    constructor(options) {
      super(options);
      FakeAudioContext.instances.pop();
      MinimalAudioContext.instances.push(this);
      this.createBiquadFilter = undefined;
      this.createStereoPanner = undefined;
      this.createDynamicsCompressor = undefined;
    }
  }

  const runtime = fakeRuntime(MinimalAudioContext);
  const audio = new PlayheadPaintAudio({ runtime });
  assert.equal(await audio.noteOn("fallback", { pan: 0.7, brightness: 0.1 }), true);
  assert.equal(audio.activeVoiceCount, 1);
  assert.equal(audio.updateVoice("fallback", { pan: -0.7, brightness: 0.9 }), true);
  assert.equal(audio.noteOff("fallback", { releaseMs: 0 }), true);
  runtime.runAllTimers();
  assert.equal(audio.allocatedVoiceCount, 0);
  await audio.close();
});
