import assert from "node:assert/strict";
import test from "node:test";

import {
  BARBER_DELAY_DEFAULTS,
  BARBER_DELAY_LIMITS,
  BARBER_DELAY_PRESETS,
  BARBER_DELAY_PROCESSOR_NAME,
  BarberDelayAudio,
  barberDelayCurve,
  barberDelayPitchEstimate,
  barberDelayWindow,
  createBarberSoftCeilingCurve,
  sanitizeBarberDelayMode,
  sanitizeBarberDelayParams,
} from "../src/barber-delay.js";

test("barber-delay parameters are finite, bounded, and share a feedback budget", () => {
  const safe = sanitizeBarberDelayParams({
    numVoices: 99,
    speed: -8,
    range: 50,
    directionUp: false,
    tilt: 3,
    feedback: 0.95,
    fbDelay: 0,
    globalFeedback: 0.5,
    dryWet: -1,
    inputGain: 8,
    outputLevel: Number.NaN,
  }, "candy");

  assert.equal(safe.numVoices, BARBER_DELAY_LIMITS.maximumVoices);
  assert.equal(safe.speed, 0);
  assert.equal(safe.range, BARBER_DELAY_LIMITS.maximumRange);
  assert.equal(safe.directionUp, false);
  assert.equal(safe.tilt, 1);
  assert.ok(Math.abs(
    safe.feedback + safe.globalFeedback
    - BARBER_DELAY_LIMITS.maximumFeedback
  ) < 1e-12);
  assert.equal(safe.fbDelay, BARBER_DELAY_LIMITS.minimumFeedbackDelay);
  assert.equal(safe.dryWet, 0);
  assert.equal(safe.inputGain, BARBER_DELAY_LIMITS.maximumInputGain);
  assert.equal(safe.outputLevel, BARBER_DELAY_DEFAULTS.candy.outputLevel);
  assert.ok(Object.isFrozen(safe));
  assert.equal(sanitizeBarberDelayMode("unknown"), "candy");
  assert.equal(sanitizeBarberDelayMode("sludge"), "sludge");
  assert.equal(sanitizeBarberDelayMode("sandy"), "sandy");
});

test("all 36 Morphisma delay presets are retained and immutable", () => {
  assert.equal(BARBER_DELAY_PRESETS.candy.length, 12);
  assert.equal(BARBER_DELAY_PRESETS.sludge.length, 12);
  assert.equal(BARBER_DELAY_PRESETS.sandy.length, 12);
  assert.equal(
    new Set(BARBER_DELAY_PRESETS.candy.map(({ id }) => id)).size,
    12,
  );
  assert.equal(
    new Set(BARBER_DELAY_PRESETS.sludge.map(({ id }) => id)).size,
    12,
  );
  const candyDualGrind = BARBER_DELAY_PRESETS.candy.find(
    ({ id }) => id === "dual-grind",
  );
  const centeredFall = BARBER_DELAY_PRESETS.sludge.find(
    ({ id }) => id === "centered-fall",
  );
  assert.equal(candyDualGrind.settings.speed, 1.309);
  assert.equal(candyDualGrind.settings.range, 0.104);
  assert.equal(candyDualGrind.settings.feedback, 0.95);
  assert.equal(centeredFall.settings.directionUp, false);
  assert.ok(Object.isFrozen(BARBER_DELAY_PRESETS));
  assert.ok(Object.isFrozen(candyDualGrind.settings));
});

test("Candy and Sludge retain their authoritative delay-head curves", () => {
  assert.equal(barberDelayCurve("candy", 0, true), 1);
  assert.ok(Math.abs(
    barberDelayCurve("candy", 0.5, true) - (Math.SQRT2 - 1)
  ) < 1e-12);
  assert.ok(Math.abs(
    barberDelayCurve("candy", 0.5, false)
    - (2 - Math.SQRT2)
  ) < 1e-12);
  assert.ok(barberDelayCurve("candy", 1 - 1e-9, true) < 1e-8);

  assert.equal(barberDelayCurve("sludge", 0, true), 0);
  assert.equal(barberDelayCurve("sludge", 0.5, true), 1);
  assert.ok(Math.abs(barberDelayCurve("sludge", 0.25, true) - 0.5) < 1e-12);
  assert.ok(Math.abs(barberDelayCurve("sludge", 0.25, false) - 0.5) < 1e-12);
});

test("skewed Hann windows remain bounded and move their peak with tilt", () => {
  assert.equal(barberDelayWindow(0, 0), 0);
  assert.equal(barberDelayWindow(0.5, 0), 1);
  assert.ok(Math.abs(barberDelayWindow(0.25, 0) - 0.5) < 1e-12);
  assert.ok(barberDelayWindow(0.8409, 1) > 0.999);
  assert.ok(barberDelayWindow(0.0625, -1) > 0.999999);
  for (let index = 0; index <= 1_000; index += 1) {
    const value = barberDelayWindow(index / 1_000, 0.73);
    assert.ok(value >= 0 && value <= 1);
  }
});

test("pitch estimates preserve Candy direction and Sludge's symmetric range", () => {
  const rising = barberDelayPitchEstimate({
    speed: 1,
    range: 1,
    directionUp: true,
  }, "candy");
  const falling = barberDelayPitchEstimate({
    speed: 0.5,
    range: 1,
    directionUp: false,
  }, "candy");
  const sludge = barberDelayPitchEstimate({
    speed: 0.5,
    range: 2,
  }, "sludge");

  assert.equal(rising.product, 1);
  assert.equal(rising.ratio, 2);
  assert.equal(rising.semitones, 12);
  assert.equal(falling.ratio, 0.5);
  assert.equal(falling.semitones, -12);
  assert.equal(sludge.symmetric, true);
  assert.ok(Math.abs(sludge.product - Math.PI) < 1e-12);
  assert.ok(Math.abs(sludge.lowRatio * sludge.highRatio - 1) < 1e-12);
});

test("barber soft ceiling is symmetric, monotonic, and bounded", () => {
  const curve = createBarberSoftCeilingCurve(257);
  assert.equal(curve.length, 257);
  assert.ok(Math.abs(curve[0] + curve.at(-1)) < 1e-6);
  assert.ok(Math.abs(curve[128]) < 1e-7);
  assert.ok(Math.max(...curve.map(Math.abs)) <= 0.921);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(curve[index] >= curve[index - 1]);
  }
});

test("worklet uses one bounded stereo ring and stays finite at feedback limits", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;
  let registeredName = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (name, ProcessorConstructor) => {
    registeredName = name;
    Processor = ProcessorConstructor;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/barber-delay.js?worklet-test=${Date.now()}`);
    assert.equal(registeredName, BARBER_DELAY_PROCESSOR_NAME);
    assert.equal(typeof Processor, "function");
    const processor = new Processor({
      processorOptions: {
        mode: "sludge",
        parameters: {
          numVoices: 12,
          speed: 5,
          range: 0.1,
          feedback: 0.95,
          globalFeedback: 0.5,
          fbDelay: 0.001,
          dryWet: 0.8,
          inputGain: 2,
          outputLevel: 1,
        },
      },
    });
    assert.equal(processor.buffers.length, 2);
    assert.equal(processor.buffers[0].length, processor.buffers[1].length);
    assert.ok(processor.buffers[0].length < 481_000);
    processor.port.onmessage({ data: { type: "active", value: true } });

    let energy = 0;
    let peak = 0;
    let renderedSamples = 0;
    let oscillatorPhase = 0;
    for (let block = 0; block < 240; block += 1) {
      const input = new Float32Array(128);
      for (let index = 0; index < input.length; index += 1) {
        oscillatorPhase += (Math.PI * 2 * 220) / 48_000;
        input[index] = Math.sin(oscillatorPhase) * 0.36;
      }
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([[input]], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.ok(Number.isFinite(right[index]));
        energy += left[index] * left[index];
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        renderedSamples += 1;
      }
    }
    const rms = Math.sqrt(energy / renderedSamples);
    assert.ok(rms > 0.01, `unexpected delay RMS ${rms}`);
    assert.ok(peak <= 0.981, `unexpected delay peak ${peak}`);

    processor.port.onmessage({
      data: {
        type: "parameters",
        parameters: {
          numVoices: -40,
          speed: Infinity,
          range: Number.NaN,
          feedback: 20,
          globalFeedback: 20,
        },
      },
    });
    const tail = new Float32Array(128);
    assert.equal(processor.process([], [[tail, new Float32Array(128)]]), true);
    assert.ok(tail.every(Number.isFinite));
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("browser wrapper is gesture-inert and releases a file source completely", async () => {
  let contextCreations = 0;
  let fileNodeDisconnects = 0;
  const portMessages = [];
  const makeParam = (value = 0) => ({
    value,
    cancelScheduledValues() {},
    setValueAtTime(next) {
      this.value = next;
    },
    linearRampToValueAtTime(next) {
      this.value = next;
    },
  });
  const makeNode = (extra = {}) => ({
    connect(target) {
      return target;
    },
    disconnect() {},
    ...extra,
  });

  class MockAudioWorkletNode {
    constructor() {
      this.port = {
        postMessage(message) {
          portMessages.push(message);
        },
      };
    }

    connect(target) {
      return target;
    }

    disconnect() {}
  }

  class MockAudioContext {
    constructor() {
      contextCreations += 1;
      this.state = "suspended";
      this.currentTime = 0;
      this.destination = makeNode();
      this.audioWorklet = { addModule: async () => {} };
    }

    createBiquadFilter() {
      return makeNode({ frequency: makeParam(), Q: makeParam(), type: "" });
    }

    createDynamicsCompressor() {
      return makeNode({
        threshold: makeParam(),
        knee: makeParam(),
        ratio: makeParam(),
        attack: makeParam(),
        release: makeParam(),
      });
    }

    createWaveShaper() {
      return makeNode({ curve: null, oversample: "none" });
    }

    createGain() {
      return makeNode({ gain: makeParam() });
    }

    createAnalyser() {
      return makeNode({
        fftSize: 0,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(target) {
          target.fill(0.125);
        },
      });
    }

    createMediaElementSource() {
      return makeNode({
        disconnect() {
          fileNodeDisconnects += 1;
        },
      });
    }

    async resume() {
      this.state = "running";
    }

    async suspend() {
      this.state = "suspended";
    }

    async close() {
      this.state = "closed";
    }
  }

  const timers = new Map();
  let nextTimer = 1;
  const runtime = {
    AudioContext: MockAudioContext,
    AudioWorkletNode: MockAudioWorkletNode,
    setTimeout(callback) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  let plays = 0;
  let pauses = 0;
  const element = {
    async play() {
      plays += 1;
    },
    pause() {
      pauses += 1;
    },
  };

  const audio = new BarberDelayAudio("candy", runtime);
  assert.equal(contextCreations, 0);
  assert.equal(audio.state.initialized, false);
  assert.equal(audio.getTimeDomainData(new Float32Array(8)), false);
  audio.setParameters({ speed: 2.5, feedback: 0.3 });
  assert.equal(contextCreations, 0);

  await audio.start({ kind: "file", element });
  assert.equal(contextCreations, 1);
  assert.equal(plays, 1);
  assert.equal(audio.state.enabled, true);
  assert.equal(audio.state.sourceKind, "file");
  assert.deepEqual(
    portMessages.slice(-2).map(({ type }) => type),
    ["reset", "active"],
  );
  const waveform = new Float32Array(8);
  assert.equal(audio.getTimeDomainData(waveform), true);
  assert.ok(waveform.every((sample) => sample === 0.125));

  await audio.stop();
  assert.equal(audio.state.enabled, false);
  assert.equal(pauses, 1);
  assert.equal(fileNodeDisconnects, 1);

  // MediaElementSourceNode may only be created once per element/context.
  // Reuse must reconnect the cached node rather than constructing a new one.
  await audio.start({ kind: "file", element });
  assert.equal(contextCreations, 1);
  assert.equal(plays, 2);
  await audio.stop();
  assert.equal(pauses, 2);
  assert.equal(fileNodeDisconnects, 2);

  await audio.close();
  assert.equal(audio.state.contextState, "closed");
  assert.equal(timers.size, 0);
});
