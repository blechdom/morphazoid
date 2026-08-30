import assert from "node:assert/strict";
import test from "node:test";
import { GraphSynthAudio } from "../src/graph-synth-audio.js";

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.calls.push(["set", value, time]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.calls.push(["linear", value, time]);
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.calls.push(["exponential", value, time]);
  }

  setTargetAtTime(value, time, timeConstant) {
    this.value = value;
    this.calls.push(["target", value, time, timeConstant]);
  }

  cancelScheduledValues(time) {
    this.calls.push(["cancel", time]);
  }

  cancelAndHoldAtTime(time) {
    this.calls.push(["hold", time]);
  }
}

class FakeNode {
  constructor(properties = {}) {
    this.connections = [];
    this.disconnectCount = 0;
    Object.assign(this, properties);
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
    super();
    this.type = "sine";
    this.frequency = new FakeAudioParam(440);
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }

  start(time) {
    this.starts.push(time);
  }

  stop(time) {
    this.stops.push(time);
  }
}

function makeRuntime({ state = "running", resumeGate = null } = {}) {
  const created = {
    contexts: [],
    oscillators: [],
    filters: [],
    panners: [],
    delays: [],
    gains: [],
    closeCount: 0,
    resumeCount: 0,
  };

  class FakeContext {
    constructor() {
      this.state = state;
      this.currentTime = 1;
      this.sampleRate = 48_000;
      this.destination = new FakeNode();
      created.contexts.push(this);
    }

    createGain() {
      const gain = new FakeNode({ gain: new FakeAudioParam(0) });
      created.gains.push(gain);
      return gain;
    }

    createDynamicsCompressor() {
      return new FakeNode({
        threshold: new FakeAudioParam(),
        knee: new FakeAudioParam(),
        ratio: new FakeAudioParam(),
        attack: new FakeAudioParam(),
        release: new FakeAudioParam(),
      });
    }

    createBiquadFilter() {
      const filter = new FakeNode({
        type: "",
        frequency: new FakeAudioParam(),
        Q: new FakeAudioParam(),
      });
      created.filters.push(filter);
      return filter;
    }

    createStereoPanner() {
      const panner = new FakeNode({ pan: new FakeAudioParam() });
      created.panners.push(panner);
      return panner;
    }

    createOscillator() {
      const oscillator = new FakeOscillator();
      created.oscillators.push(oscillator);
      return oscillator;
    }

    createDelay() {
      const delay = new FakeNode({ delayTime: new FakeAudioParam() });
      created.delays.push(delay);
      return delay;
    }

    createAnalyser() {
      return new FakeNode({
        fftSize: 256,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData() {},
      });
    }

    createBuffer(_channels, frameCount) {
      return {
        getChannelData() { return new Float32Array(frameCount); },
      };
    }

    createBufferSource() {
      return new FakeNode({
        buffer: null,
        start() {},
        stop() {},
        onended: null,
      });
    }

    async resume() {
      created.resumeCount += 1;
      if (resumeGate) await resumeGate;
      this.state = "running";
    }

    async close() {
      created.closeCount += 1;
      this.state = "closed";
    }
  }

  return {
    runtime: { AudioContext: FakeContext },
    created,
  };
}

test("Graph Synth audio is lazy and applies an output selected before start", async () => {
  const { runtime, created } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);

  assert.equal(audio.context, null);
  assert.equal(created.contexts.length, 0, "construction must not touch AudioContext");
  audio.setOutput(0.37);
  assert.equal(created.contexts.length, 0, "parameter edits must remain lazy");

  const pending = audio.start();
  assert.equal(created.contexts.length, 1, "start creates the context synchronously in the gesture");
  const context = await pending;
  assert.equal(context, audio.context);
  assert.ok(audio.master.gain.calls.some(([method, value]) => (
    method === "target" && value === 0.37
  )));
});

test("Graph Synth follows absolute audio time and honors feedback-darkened brightness", async () => {
  const { runtime, created } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);
  await audio.start();
  audio.context.currentTime = 3;

  const dark = await audio.trigger({
    mode: "fm",
    waveform: "triangle",
    frequency: 220,
    gain: 0.42,
    pan: -0.65,
    modulationIndex: 3,
    modulationRatio: 2,
    brightness: 0.18,
  }, {
    startAt: 3.25,
    attackSeconds: 0.01,
    decaySeconds: 0.24,
  });

  assert.equal(dark.startAt, 3.25);
  assert.equal(dark.endAt, 3.5);
  assert.equal(dark.brightness, 0.18);
  assert.deepEqual(created.oscillators.slice(0, 2).map(({ starts }) => starts), [
    [3.25],
    [3.25],
  ]);
  assert.equal(created.oscillators[0].type, "triangle");
  assert.equal(created.oscillators[1].frequency.value, 440);
  assert.equal(created.filters[0].type, "lowpass");
  assert.ok(created.filters[0].frequency.calls.some(([method, value, time]) => (
    method === "set" && value === dark.filterFrequency && time === 3.25
  )));
  assert.ok(created.panners[0].pan.calls.some(([method, value, time]) => (
    method === "set" && value === -0.65 && time === 3.25
  )));

  const bright = await audio.trigger({
    mode: "sine",
    waveform: "square",
    frequency: 330,
    gain: 0.2,
    brightness: 0.82,
  }, { startAt: 3.3 });
  assert.ok(
    dark.filterFrequency < bright.filterFrequency,
    "a feedback-darkened event must reach a lower low-pass cutoff",
  );

  audio.context.currentTime = 4;
  const late = await audio.trigger({ frequency: 110 }, { startAt: 3.8 });
  assert.equal(late.startAt, 4, "an absolute request in the past starts safely now");
});

test("Graph Synth schedules a full ADSR around an exact edge gate", async () => {
  const { runtime, created } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);
  await audio.start();
  audio.context.currentTime = 2;

  const rendered = await audio.trigger({
    frequency: 220,
    gain: 0.4,
  }, {
    startAt: 2.25,
    attackSeconds: 0.4,
    decaySeconds: 0.2,
    sustainLevel: 0.25,
    gateSeconds: 1,
    releaseSeconds: 0.3,
  });

  assert.equal(rendered.attackSeconds, 0.4, "attacks longer than the old 250 ms clamp survive");
  assert.equal(rendered.decaySeconds, 0.2);
  assert.equal(rendered.sustainLevel, 0.25);
  assert.equal(rendered.gateSeconds, 1);
  assert.equal(rendered.gateEndAt, 3.25);
  assert.equal(rendered.releaseSeconds, 0.3);
  assert.equal(rendered.releaseEndAt, 3.55);
  assert.equal(rendered.endAt, rendered.releaseEndAt);
  assert.equal(rendered.stopAt, 3.562);

  const envelope = created.gains.at(-1).gain.calls;
  assert.ok(envelope.some(([method, value, time]) => (
    method === "linear" && value === 0.4 && time === 2.65
  )));
  assert.ok(envelope.some(([method, value, time]) => (
    method === "exponential" && value === 0.1 && time === 2.85
  )));
  assert.ok(envelope.some(([method, value, time]) => (
    method === "set" && value === 0.1 && time === rendered.gateEndAt
  )));
  assert.ok(envelope.some(([method, value, time]) => (
    method === "exponential" && value === 0.0001 && time === rendered.releaseEndAt
  )));
  assert.equal(created.oscillators.at(-1).stops.at(-1), rendered.stopAt);
});

test("Graph Synth compresses attack and decay into short edge gates without moving note-off", async () => {
  const { runtime, created } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);
  await audio.start();
  audio.context.currentTime = 1;

  const rendered = await audio.trigger({ frequency: 330, gain: 0.5 }, {
    startAt: 1.1,
    attackSeconds: 0.2,
    decaySeconds: 0.3,
    sustainLevel: 0.6,
    gateSeconds: 0.05,
    releaseSeconds: 0.08,
  });

  assert.ok(Math.abs(rendered.attackSeconds - 0.02) < 1e-12);
  assert.ok(Math.abs(rendered.decaySeconds - 0.03) < 1e-12);
  assert.ok(Math.abs(rendered.attackSeconds + rendered.decaySeconds - 0.05) < 1e-12);
  assert.ok(Math.abs(rendered.gateEndAt - 1.15) < 1e-12);
  assert.ok(Math.abs(rendered.releaseEndAt - 1.23) < 1e-12);

  const envelope = created.gains.at(-1).gain.calls;
  assert.ok(envelope.some(([method, value, time]) => (
    method === "linear" && value === 0.5 && Math.abs(time - 1.12) < 1e-12
  )));
  assert.ok(envelope.some(([method, value, time]) => (
    method === "exponential" && value === 0.3 && Math.abs(time - 1.15) < 1e-12
  )));
  assert.ok(envelope.some(([method, value, time]) => (
    method === "set" && value === 0.3 && Math.abs(time - 1.15) < 1e-12
  )));
});

test("Graph Synth builds native sine, FM, PM, and Shepard one-shots", async () => {
  const { runtime, created } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);

  const sine = await audio.trigger({ mode: "sine", waveform: "sawtooth", frequency: 100 });
  const fm = await audio.trigger({
    mode: "fm", waveform: "square", frequency: 120, modulationIndex: 2,
  });
  const pm = await audio.trigger({
    mode: "pm", waveform: "triangle", frequency: 140, modulationIndex: 2,
  });
  const shepard = await audio.trigger({
    mode: "shepard", waveform: "sine", frequency: 220, shepardWidth: 5,
  });

  assert.deepEqual([sine.mode, fm.mode, pm.mode, shepard.mode], [
    "sine", "fm", "pm", "shepard",
  ]);
  assert.ok(created.delays.length >= 1, "PM uses a modulated short delay as its phase stage");
  assert.ok(
    created.oscillators.length >= 10,
    "FM/PM modulators and the Shepard octave stack are allocated per one-shot",
  );
});

test("Graph Synth silence cancels future voices and fades active voices", async () => {
  const { runtime } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);
  await audio.start();
  audio.context.currentTime = 1;
  await audio.trigger({ frequency: 180, gain: 0.4 }, {
    startAt: 1,
    decaySeconds: 0.5,
  });
  await audio.trigger({ frequency: 240, gain: 0.3 }, {
    startAt: 1.7,
    decaySeconds: 0.4,
  });
  const [active, future] = [...audio.activeVoices];
  assert.equal(audio.activeVoices.size, 2);

  audio.context.currentTime = 1.1;
  audio.silence();

  assert.equal(future.cleaned, true);
  assert.equal(audio.activeVoices.has(future), false);
  assert.equal(future.sources[0].stops.at(-1), 1.1);
  assert.ok(future.amplitude.gain.calls.some(([method, value, time]) => (
    method === "set" && value === 0 && time === 1.1
  )));

  assert.equal(audio.activeVoices.has(active), true);
  assert.equal(active.sources[0].stops.at(-1), 1.13);
  assert.ok(active.amplitude.gain.calls.some(([method, time]) => (
    method === "hold" && time === 1.1
  )));
  assert.ok(active.amplitude.gain.calls.some(([method, value, time]) => (
    method === "exponential" && value === 0.0001 && time === 1.125
  )));

  for (const source of [...active.pendingSources]) source.onended?.();
  assert.equal(audio.activeVoices.size, 0);
  assert.equal(active.cleaned, true);
  assert.ok(active.filter.disconnectCount > 0);
});

test("Graph Synth caps overlapping voices without leaving stolen sources live", async () => {
  const { runtime, created } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);
  await audio.start();
  for (let index = 0; index < 65; index += 1) {
    await audio.trigger({ frequency: 80 + index, gain: 0.1 }, {
      startAt: 2,
      decaySeconds: 1,
    });
  }
  assert.equal(audio.activeVoices.size, 64);
  assert.equal(created.oscillators[0].stops.at(-1), 1);
  assert.ok(created.oscillators[0].disconnectCount > 0);
});

test("Graph Synth closes cleanly and restarts with a fresh context", async () => {
  const { runtime, created } = makeRuntime();
  const audio = new GraphSynthAudio(runtime);
  const first = await audio.start();
  await audio.trigger({ mode: "pm", frequency: 220, modulationIndex: 1 });

  await audio.close();
  assert.equal(created.closeCount, 1);
  assert.equal(audio.context, null);
  assert.equal(audio.master, null);
  assert.equal(audio.activeVoices.size, 0);

  const second = await audio.start();
  assert.notEqual(second, first);
  assert.equal(created.contexts.length, 2);
});

test("Graph Synth rejects a suspended start when close wins the lifecycle race", async () => {
  let releaseResume;
  const resumeGate = new Promise((resolve) => { releaseResume = resolve; });
  const { runtime } = makeRuntime({ state: "suspended", resumeGate });
  const audio = new GraphSynthAudio(runtime);

  const pending = audio.start();
  const pendingContext = audio.context;
  assert.equal(pendingContext.state, "suspended");
  await audio.close();
  releaseResume();

  await assert.rejects(pending, (error) => (
    error?.name === "AbortError" && /cancelled/i.test(error.message)
  ));
  assert.equal(audio.context, null);
});
