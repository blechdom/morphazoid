import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHAOTIC_FM_DEFAULTS,
  CHAOTIC_FM_LIMITS,
  CHAOTIC_FM_PARAMETER_IDS,
  CHAOTIC_FM_PERFORMANCE_DEFAULTS,
  CHAOTIC_FM_PRESETS,
  DEFAULT_CHAOTIC_FM_PRESET_ID,
  ChaoticFmAudio,
  ChaoticFmWebMidi,
  chaoticFmFactoryControlChange,
  chaoticFmFrequency,
  createSoftCeilingCurve,
  deriveChaoticFmStack,
  decodeChaoticFmMidiMessage,
  formatChaoticFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  sanitizeChaoticFmParams,
  sanitizeChaoticFmPerformance,
} from "../src/chaotic-fm.js";

test("Chaotic FM preserves all five original Morphisma presets exactly", () => {
  assert.equal(CHAOTIC_FM_PRESETS.length, 5);
  assert.equal(DEFAULT_CHAOTIC_FM_PRESET_ID, "feedback-nest");
  assert.deepEqual(
    CHAOTIC_FM_PRESETS.map(({ settings }) => settings),
    [
      {
        depth: 1,
        carrierHz: 10.5,
        offsetHz: 0,
        modulationAmount: 350,
        amountDivisor: 0.4,
        nonlinearityHz: 256,
      },
      {
        depth: 4,
        carrierHz: 1.798,
        offsetHz: 100,
        modulationAmount: 4_200,
        amountDivisor: 4,
        nonlinearityHz: 375,
      },
      {
        depth: 5,
        carrierHz: 0.129,
        offsetHz: 637,
        modulationAmount: 2_737,
        amountDivisor: 5.8,
        nonlinearityHz: 531,
      },
      {
        depth: 2,
        carrierHz: 0.143,
        offsetHz: 637,
        modulationAmount: 4_762,
        amountDivisor: 7.611,
        nonlinearityHz: 1_024,
      },
      {
        depth: 1,
        carrierHz: 11,
        offsetHz: 787,
        modulationAmount: 125,
        amountDivisor: 4.3,
        nonlinearityHz: 725,
      },
    ],
  );
  assert.ok(Object.isFrozen(CHAOTIC_FM_PRESETS));
  assert.ok(Object.isFrozen(CHAOTIC_FM_PRESETS[0]));
  assert.ok(Object.isFrozen(CHAOTIC_FM_PRESETS[0].settings));
});

test("parameter sanitizer accepts legacy names and bounds hostile values", () => {
  const safe = sanitizeChaoticFmParams({
    steps: 99,
    carrierFreq: Number.NaN,
    offset: -100,
    modAmp: Number.POSITIVE_INFINITY,
    modAmpDiv: 0,
    filter: 99_999,
    output: 4,
  }, { sampleRate: 32_000 });

  assert.equal(safe.depth, CHAOTIC_FM_LIMITS.maxDepth);
  assert.equal(safe.carrierHz, CHAOTIC_FM_DEFAULTS.carrierHz);
  assert.equal(safe.offsetHz, 0);
  assert.equal(safe.modulationAmount, CHAOTIC_FM_DEFAULTS.modulationAmount);
  assert.equal(safe.amountDivisor, CHAOTIC_FM_LIMITS.minAmountDivisor);
  assert.equal(safe.nonlinearityHz, CHAOTIC_FM_LIMITS.maxNonlinearityHz);
  assert.equal(safe.output, CHAOTIC_FM_LIMITS.maxOutput);
  assert.equal(safe.maximumFrequencyHz, 14_400);
  assert.ok(Object.isFrozen(safe));
});

test("expressive mono parameters have portable stable IDs and bounded defaults", () => {
  assert.deepEqual(CHAOTIC_FM_PERFORMANCE_DEFAULTS, {
    playMode: "midi",
    rootMidiNote: 60,
    pitchBendRangeSemitones: 2,
    ampAttackMs: 8,
    ampDecayMs: 120,
    ampSustainLevel: 0.72,
    ampReleaseMs: 180,
    glideTimeMs: 0,
    glideMode: "off",
  });
  assert.equal(CHAOTIC_FM_PARAMETER_IDS.ampAttackMs, "performance.ampAttackMs");
  assert.equal(CHAOTIC_FM_PARAMETER_IDS.glideMode, "performance.glideMode");
  assert.equal(CHAOTIC_FM_PARAMETER_IDS.output, "output.level");
  assert.ok(Object.isFrozen(CHAOTIC_FM_PARAMETER_IDS));

  const safe = sanitizeChaoticFmPerformance({
    playMode: "unknown",
    rootMidiNote: 999,
    pitchBendRangeSemitones: -2,
    ampAttackMs: 99_000,
    ampDecayMs: -1,
    ampSustainLevel: 3,
    ampReleaseMs: 0,
    glideTimeMs: 99_000,
    glideMode: "mystery",
  });
  assert.deepEqual(safe, {
    playMode: "midi",
    rootMidiNote: 127,
    pitchBendRangeSemitones: 0,
    ampAttackMs: 5_000,
    ampDecayMs: 0,
    ampSustainLevel: 1,
    ampReleaseMs: 2,
    glideTimeMs: 2_000,
    glideMode: "off",
  });
  assert.ok(Object.isFrozen(safe));
});

test("MIDI decoder preserves channel messages and factory CC curves", () => {
  assert.deepEqual(decodeChaoticFmMidiMessage([0x92, 64, 99]), {
    type: "noteOn", note: 64, velocity: 99, channel: 2,
  });
  assert.deepEqual(decodeChaoticFmMidiMessage([0x92, 64, 0]), {
    type: "noteOff", note: 64, velocity: 0, channel: 2,
  });
  assert.equal(decodeChaoticFmMidiMessage([0xe0, 0, 0]).normalized, -1);
  assert.equal(decodeChaoticFmMidiMessage([0xe0, 0, 64]).normalized, 0);
  assert.equal(decodeChaoticFmMidiMessage([0xe0, 127, 127]).normalized, 1);
  assert.deepEqual(decodeChaoticFmMidiMessage([0xb7, 64, 127]), {
    type: "controlChange", controller: 64, value: 127, channel: 7,
  });
  assert.equal(decodeChaoticFmMidiMessage([0xf0, 1, 2]), null);

  assert.equal(chaoticFmFactoryControlChange(5, 0).value, 0);
  assert.equal(chaoticFmFactoryControlChange(5, 1).value, 10);
  assert.ok(Math.abs(chaoticFmFactoryControlChange(5, 127).value - 2_000) < 1e-9);
  assert.equal(chaoticFmFactoryControlChange(73, 0).value, 0);
  assert.equal(chaoticFmFactoryControlChange(73, 1).value, 0.5);
  assert.ok(Math.abs(chaoticFmFactoryControlChange(73, 127).value - 5_000) < 1e-9);
  assert.equal(chaoticFmFactoryControlChange(75, 1).value, 1);
  assert.equal(chaoticFmFactoryControlChange(72, 0).value, 2);
  assert.ok(Math.abs(chaoticFmFactoryControlChange(72, 127).value - 10_000) < 1e-9);
  assert.deepEqual(chaoticFmFactoryControlChange(64, 63), {
    type: "sustain", down: false,
  });
  assert.deepEqual(chaoticFmFactoryControlChange(64, 64), {
    type: "sustain", down: true,
  });
  assert.deepEqual(chaoticFmFactoryControlChange(65, 127), {
    type: "glideEnabled", enabled: true,
  });
  assert.equal(chaoticFmFactoryControlChange(12, 99), null);
});

test("Web MIDI prompts only on explicit enable, never requests SysEx, and detaches", async () => {
  const listeners = new Map();
  const input = {
    state: "connected",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const accessListeners = new Map();
  const access = {
    inputs: new Map([["keyboard", input]]),
    addEventListener(type, listener) { accessListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (accessListeners.get(type) === listener) accessListeners.delete(type);
    },
  };
  const requests = [];
  const calls = [];
  const statuses = [];
  const runtime = {
    navigator: {
      async requestMIDIAccess(options) {
        requests.push(options);
        return access;
      },
    },
  };
  const adapter = new ChaoticFmWebMidi(runtime, {
    target: {
      noteOn: (...args) => calls.push(["noteOn", ...args]),
      controlChange: (...args) => calls.push(["controlChange", ...args]),
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(adapter.supported, true);
  assert.equal(requests.length, 0, "construction must not prompt for MIDI");
  await adapter.enable();
  assert.deepEqual(requests, [{ sysex: false }]);
  assert.equal(adapter.status().inputCount, 1);
  listeners.get("midimessage")({ data: new Uint8Array([0x90, 60, 100]) });
  listeners.get("midimessage")({ data: new Uint8Array([0xb0, 11, 64]) });
  assert.deepEqual(calls, [
    ["noteOn", 60, 100, 0],
    ["controlChange", 11, 64],
  ]);
  assert.ok(statuses.some(({ enabled, inputCount }) => enabled && inputCount === 1));
  adapter.close();
  assert.equal(listeners.has("midimessage"), false);
  assert.equal(accessListeners.has("statechange"), false);
});

test("stack derivation matches the original entry oscillator and amount division", () => {
  const stack = deriveChaoticFmStack(CHAOTIC_FM_PRESETS[1].settings);

  assert.equal(stack.carrier.frequencyHz, 1.798);
  assert.equal(stack.entry.minimumFrequencyHz, 100);
  assert.equal(stack.entry.centerFrequencyHz, 2_200);
  assert.equal(stack.entry.maximumFrequencyHz, 4_300);
  assert.deepEqual(
    stack.turns.map(({ amount }) => amount),
    [2_100, 525, 131.25, 32.8125],
  );
  assert.ok(stack.turns.every(({ nonlinearityHz }) => nonlinearityHz === 375));
  assert.equal(stack.operatorCount, 6);
  assert.equal(stack.audibleOperator, 5);

  const noRecursion = deriveChaoticFmStack({
    ...CHAOTIC_FM_PRESETS[1].settings,
    depth: 0,
  });
  assert.equal(noRecursion.turns.length, 0);
  assert.equal(noRecursion.audibleOperator, 1);
});

test("nonlinear transfer is signed, exact, finite, and frequency bounded", () => {
  const expected = 300 * Math.tanh(0.5 * 2);
  assert.ok(Math.abs(chaoticFmFrequency(0.5, 2, 300) - expected) < 1e-12);
  assert.ok(Math.abs(chaoticFmFrequency(-0.5, 2, 300) + expected) < 1e-12);
  assert.equal(chaoticFmFrequency(1, Number.POSITIVE_INFINITY, 99_999, 2_000), 0);
  assert.equal(chaoticFmFrequency(1, 1e100, 99_999, 2_000), 2_000);
  assert.ok(Number.isFinite(chaoticFmFrequency(Number.NaN, 1e100, 2_000)));
});

test("frequency slider mappings retain fine low-rate resolution and round trip", () => {
  for (const value of [0.01, 0.129, 10.5, 440, 4_800]) {
    const position = logarithmicSliderPosition(value, 0.01, 4_800);
    assert.ok(
      Math.abs(logarithmicSliderValue(position, 0.01, 4_800) - value) < 1e-8,
    );
  }
  for (const value of [0.001, 0.1, 256, 1_024, 4_000]) {
    const position = logarithmicSliderPosition(value, 0.001, 4_000);
    assert.ok(
      Math.abs(logarithmicSliderValue(position, 0.001, 4_000) - value) < 1e-8,
    );
  }
  for (const value of [0, 100, 637, 2_737, 4_800]) {
    const position = quadraticSliderPosition(value, 4_800);
    assert.ok(Math.abs(quadraticSliderValue(position, 4_800) - value) < 1e-8);
  }
});

test("readouts and soft ceiling remain compact and safely bounded", () => {
  assert.equal(formatChaoticFrequency(0.129), "0.129 Hz");
  assert.equal(formatChaoticFrequency(10.5), "10.5 Hz");
  assert.equal(formatChaoticFrequency(637), "637 Hz");
  assert.equal(formatChaoticFrequency(4_200), "4.2 kHz");

  const curve = createSoftCeilingCurve(257);
  assert.equal(curve.length, 257);
  assert.ok(Math.abs(curve[0] + curve.at(-1)) < 1e-6);
  assert.ok(Math.abs(curve[128]) < 1e-7);
  assert.ok(Math.max(...curve.map(Math.abs)) <= 0.911);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(curve[index] >= curve[index - 1]);
  }
});

test("worklet renders finite extreme recursion and crossfades depth without render allocation", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (_name, ProcessorConstructor) => {
    Processor = ProcessorConstructor;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/chaotic-fm.js?worklet-test=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    const processor = new Processor({
      processorOptions: CHAOTIC_FM_PRESETS[0].settings,
    });
    const phaseStorage = processor.phases;
    const signalStorage = processor.depthSignals;
    const gainStorage = processor.depthGains;
    processor.port.onmessage({ data: { type: "active", value: true } });
    processor.port.onmessage({
      data: {
        type: "performance",
        parameters: { playMode: "midi" },
      },
    });
    processor.port.onmessage({
      data: { type: "noteOn", note: 60, velocity: 127 },
    });
    assert.equal(processor.selectedNote, 60);
    assert.equal(processor.envelopeStage, 1);
    assert.equal(processor.envelopeDuration, 384);

    let peak = 0;
    let energy = 0;
    let sampleCount = 0;
    for (let block = 0; block < 40; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.equal(left[index], right[index]);
        peak = Math.max(peak, Math.abs(left[index]));
        energy += left[index] * left[index];
        sampleCount += 1;
      }
    }

    processor.port.onmessage({
      data: {
        type: "parameters",
        parameters: {
          depth: 10,
          carrierHz: 4_800,
          offsetHz: 4_800,
          modulationAmount: 4_800,
          amountDivisor: 0.001,
          nonlinearityHz: 4_000,
        },
      },
    });

    const transitionLeft = new Float32Array(128);
    const transitionRight = new Float32Array(128);
    processor.process([], [[transitionLeft, transitionRight]]);
    assert.ok(processor.depthGains[1] > 0);
    assert.ok(processor.depthGains[10] > 0);

    for (let block = 0; block < 300; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      processor.process([], [[left, right]]);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.equal(left[index], right[index]);
        peak = Math.max(peak, Math.abs(left[index]));
        energy += left[index] * left[index];
        sampleCount += 1;
      }
    }

    assert.strictEqual(processor.phases, phaseStorage);
    assert.strictEqual(processor.depthSignals, signalStorage);
    assert.strictEqual(processor.depthGains, gainStorage);
    assert.ok(processor.depthGains[10] > 0.999);
    assert.ok(processor.depthGains[1] < 0.001);
    assert.ok(peak <= 0.501, `unexpected raw worklet peak ${peak}`);
    assert.ok(
      Math.sqrt(energy / sampleCount) > 0.03,
      "Chaotic FM worklet unexpectedly silent",
    );

    processor.port.onmessage({
      data: {
        type: "performance",
        parameters: { glideMode: "legato", glideTimeMs: 100 },
      },
    });
    assert.equal(processor.envelopeStage, 3);
    processor.port.onmessage({
      data: { type: "noteOn", note: 72, velocity: 80 },
    });
    assert.equal(processor.selectedNote, 72);
    assert.equal(processor.envelopeStage, 3, "legato note must not retrigger ADSR");
    assert.equal(processor.baseGlideDuration, 4_800);
    processor.port.onmessage({ data: { type: "noteOff", note: 72 } });
    assert.equal(processor.selectedNote, 60, "note-off must fall back to held note");
    assert.equal(processor.envelopeStage, 3);
    processor.port.onmessage({ data: { type: "sustain", down: true } });
    processor.port.onmessage({
      data: { type: "noteOn", note: 72, velocity: 80 },
    });
    processor.port.onmessage({ data: { type: "noteOff", note: 72 } });
    assert.equal(
      processor.selectedNote,
      60,
      "a physically held note must outrank a sustained released note",
    );
    processor.port.onmessage({ data: { type: "noteOff", note: 60 } });
    assert.equal(processor.selectedNote, 60, "sustain must defer the final release");
    processor.port.onmessage({ data: { type: "sustain", down: false } });
    assert.equal(processor.selectedNote, -1);
    assert.equal(processor.envelopeStage, 4);
    assert.equal(processor.envelopeDuration, 8_640);

    globalThis.sampleRate = 1_000;
    const envelopeProcessor = new Processor({
      processorOptions: {
        ...CHAOTIC_FM_PRESETS[0].settings,
        playMode: "midi",
        ampAttackMs: 4,
        ampDecayMs: 4,
        ampSustainLevel: 0.5,
        ampReleaseMs: 4,
      },
    });
    envelopeProcessor.noteOn(60, 127);
    assert.deepEqual(
      Array.from({ length: 4 }, () => envelopeProcessor.advanceEnvelope()),
      [0.4375, 0.75, 0.9375, 1],
    );
    assert.deepEqual(
      Array.from({ length: 4 }, () => envelopeProcessor.advanceEnvelope()),
      [0.78125, 0.625, 0.53125, 0.5],
    );
    envelopeProcessor.noteOff(60);
    assert.deepEqual(
      Array.from({ length: 4 }, () => envelopeProcessor.advanceEnvelope()),
      [0.28125, 0.125, 0.03125, 0],
    );
    envelopeProcessor.noteOn(62, 127);
    envelopeProcessor.advanceEnvelope();
    envelopeProcessor.noteOff(62);
    const releasingLevel = envelopeProcessor.advanceEnvelope();
    envelopeProcessor.noteOn(64, 127);
    assert.equal(envelopeProcessor.envelopeStart, releasingLevel);
    assert.equal(envelopeProcessor.envelopeStage, 1);
    envelopeProcessor.port.onmessage({ data: { type: "allSoundOff" } });
    assert.equal(envelopeProcessor.envelopeDuration, 2);
    envelopeProcessor.advanceEnvelope();
    envelopeProcessor.advanceEnvelope();
    assert.equal(envelopeProcessor.envelopeStage, 0);
    assert.equal(envelopeProcessor.envelopeLevel, 0);

    const ownedProcessor = new Processor({
      processorOptions: {
        ...CHAOTIC_FM_PRESETS[0].settings,
        playMode: "midi",
      },
    });
    ownedProcessor.noteOn(60, 70, 0, "web-midi:hardware");
    ownedProcessor.noteOn(64, 90, 0, "web-midi:hardware");
    ownedProcessor.noteOn(60, 110, 0, "computer-keyboard");
    assert.equal(ownedProcessor.noteHeld[60], 2);
    ownedProcessor.noteOff(60, 0, "computer-keyboard");
    assert.equal(ownedProcessor.selectedNote, 64);
    assert.equal(ownedProcessor.noteHeld[60], 1);
    ownedProcessor.noteOff(64, 0, "web-midi:hardware");
    assert.equal(ownedProcessor.selectedNote, 60);
    assert.equal(ownedProcessor.targetVelocity, 70 / 127);
    ownedProcessor.noteOff(60, 0, "web-midi:hardware");
    assert.equal(ownedProcessor.selectedNote, -1);
    globalThis.sampleRate = 48_000;

    const source = await readFile(
      new URL("../src/chaotic-fm.js", import.meta.url),
      "utf8",
    );
    const processStart = source.indexOf("    process(_inputs, outputs) {");
    const processEnd = source.indexOf("\n      return true;\n    }", processStart);
    const processBody = source.slice(processStart, processEnd);
    assert.ok(processStart >= 0 && processEnd > processStart);
    assert.doesNotMatch(
      processBody,
      /\bnew\s+|Array\.from|\.map\(|\.filter\(|\.slice\(|\[\s*\]/,
    );
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("audio graph is inert until start, resumes, suspends, and fully closes", async () => {
  class FakeParam {
    constructor(value = 0) {
      this.value = value;
    }

    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
  }

  class FakeNode {
    constructor() {
      this.disconnected = false;
    }

    connect(node) {
      return node;
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  class FakeAudioWorkletNode extends FakeNode {
    constructor() {
      super();
      this.messages = [];
      this.port = {
        postMessage: (message) => this.messages.push(message),
      };
    }
  }

  class FakeContext {
    constructor() {
      this.state = "suspended";
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.destination = new FakeNode();
      this.audioWorklet = {
        addModule: async () => {},
      };
    }

    createBiquadFilter() {
      const node = new FakeNode();
      node.frequency = new FakeParam();
      node.Q = new FakeParam();
      return node;
    }

    createDynamicsCompressor() {
      const node = new FakeNode();
      node.threshold = new FakeParam();
      node.knee = new FakeParam();
      node.ratio = new FakeParam();
      node.attack = new FakeParam();
      node.release = new FakeParam();
      return node;
    }

    createWaveShaper() {
      return new FakeNode();
    }

    createGain() {
      const node = new FakeNode();
      node.gain = new FakeParam();
      return node;
    }

    createAnalyser() {
      const node = new FakeNode();
      node.getFloatTimeDomainData = (target) => target.fill(0);
      return node;
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

  let scheduledSuspend = null;
  const runtime = {
    AudioContext: FakeContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout(callback) {
      scheduledSuspend = callback;
      return 7;
    },
    clearTimeout() {
      scheduledSuspend = null;
    },
  };
  const engine = new ChaoticFmAudio(runtime);
  assert.equal(engine.context, null);
  assert.equal(engine.isInitialized, false);

  await engine.start();
  assert.equal(engine.context.state, "running");
  assert.equal(engine.enabled, true);
  assert.equal(engine.analyser.fftSize, 2_048);
  assert.equal(engine.analyser.minDecibels, -90);
  assert.equal(engine.analyser.maxDecibels, 0);
  assert.ok(engine.node.messages.some(({ type, value }) => type === "active" && value));
  assert.ok(engine.node.messages.some(({ type }) => type === "performance"));

  assert.equal(engine.noteOn(60, 100), true);
  assert.equal(engine.pitchBend(0.5), true);
  assert.equal(engine.controlChange(64, 127), true);
  assert.equal(engine.controlChange(73, 0), true);
  assert.equal(engine.performance.ampAttackMs, 0);
  assert.equal(engine.controlChange(12, 80), false);
  assert.ok(engine.node.messages.some(({ type, note }) => type === "noteOn" && note === 60));
  assert.ok(engine.node.messages.some(({ type, down }) => type === "sustain" && down));

  const buffer = new Float32Array(16);
  assert.equal(engine.getWaveform(buffer), true);
  engine.stop();
  assert.equal(engine.enabled, false);
  assert.equal(typeof scheduledSuspend, "function");
  await scheduledSuspend();
  assert.equal(engine.context.state, "suspended");

  const context = engine.context;
  await engine.close();
  assert.equal(context.state, "closed");
  assert.equal(engine.context, null);
  assert.equal(engine.node, null);
  assert.equal(engine.analyser, null);
});

test("native page exposes binary gesture audio, accurate naming, and cleanup", async () => {
  const root = new URL("../", import.meta.url);
  const [markup, app, moduleSource, flowSource, sharedUi] = await Promise.all([
    readFile(new URL("chaotic-fm.html", root), "utf8"),
    readFile(new URL("chaotic-fm-app.js", root), "utf8"),
    readFile(new URL("src/chaotic-fm.js", root), "utf8"),
    readFile(new URL("src/chaotic-fm-flow.js", root), "utf8"),
    readFile(new URL("chaotic-synth-ui.css", root), "utf8"),
  ]);

  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="audioState">off</);
  assert.match(markup, /id="output"/);
  assert.doesNotMatch(markup, /id="midiButton"|id="midiState"|id="midiError"/);
  assert.doesNotMatch(markup, /id="playModeDrone"|id="playModeMidi"/);
  assert.match(markup, /id="midiActivity"/);
  for (const id of [
    "ampAttackMs",
    "ampDecayMs",
    "ampSustainLevel",
    "ampReleaseMs",
    "glideTimeMs",
    "glideMode",
    "rootMidiNote",
    "pitchBendRangeSemitones",
  ]) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
  assert.match(markup, /Standard performance MIDI · CC5 glide · CC11 expression/);
  assert.match(markup, /Controller Macros 1–8 · carrier · offset · amount · nonlinearity · attack · release · glide · output/);
  assert.match(markup, /non-scrolling live spectrum/i);
  assert.match(markup, /frequency bars sits behind a brighter oscilloscope/i);
  assert.match(markup, /href="chaotic-synth-ui\.css"/);
  assert.match(markup, /class="chaotic-path-graph"/);
  assert.match(markup, /id="chaoticFmFlow"/);
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /EACH SINE WAVE DRIVES THE NEXT SINE'S FREQUENCY/);
  assert.match(app, /function updateSignalFlow\(stack\)/);
  assert.match(app, /buildChaoticFmFlowDiagram/);
  assert.match(flowSource, /× DEVIATION/);
  assert.match(flowSource, /× AMOUNT/);
  assert.match(flowSource, />TANH</);
  assert.match(flowSource, /× RATE/);
  assert.match(flowSource, /chaotic-path-junction/);
  assert.match(flowSource, /chaotic-path-recursive-wire/);
  assert.match(flowSource, /PREVIOUS SINE → NEXT FREQUENCY/);
  assert.match(flowSource, /const sumX = inputX - 60/);
  assert.match(sharedUi, /\.chaotic-fm-page \.chaotic-path-title[\s\S]*font-size: 11\.5px/);
  assert.match(sharedUi, /\.chaotic-fm-page \.chaotic-path-tap[\s\S]*opacity: 0\.55/);
  assert.match(sharedUi, /\.chaotic-fm-page \.chaotic-path-compact[\s\S]*display: block/);
  assert.match(markup, /id="turnsReadout"/);
  assert.doesNotMatch(markup, />Turn \d+</);
  assert.match(markup, />Nonlinearity rate</);
  assert.match(markup, /this is not an audio filter/i);
  assert.match(markup, /CHAOTIC SYNTHS · 03/);
  assert.match(markup, /class="chaotic-fm-subtitle"/);
  assert.match(markup, /Each oscillator’s waveform becomes the next oscillator’s signed frequency/);
  assert.match(markup, /Saturation keeps this recursive cascade bounded/);
  assert.match(markup, /class="plugin-download-callout"/);
  assert.match(markup, /JSFX v0\.3\.0 beta/);
  assert.match(
    markup,
    /downloads\/plugins\/chaotic-fm\/0\.3\.0\/reaper-jsfx\/Morphazoid_Chaotic_FM\.jsfx/,
  );
  assert.match(markup, /href="plugins\.html#chaotic-fm"/);
  assert.match(markup, /src="chaotic-fm-app\.js"/);
  assert.doesNotMatch(markup, /https?:\/\//);
  assert.doesNotMatch(markup, />\s*filter\s*</i);

  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /drawChaoticLiveAnalysis/);
  assert.match(app, /createChaoticSpectrum/);
  assert.match(app, /new ChaoticFmWebMidi/);
  assert.match(app, /getSharedMidiManager\(globalThis\)/);
  assert.match(app, /sharedMidiManager\.registerClient/);
  assert.match(app, /id: "chaotic-fm"/);
  assert.match(app, /onMessage: handleSharedMidiMessage/);
  assert.match(app, /onEnabledChange: handleSharedMidiEnabled/);
  assert.match(app, /onPrepareEnable: prepareSharedMidiEnable/);
  assert.match(app, /onProfileChange: handleSharedMidiProfileChange/);
  assert.match(app, /midiBridge\.handleMessage/);
  assert.doesNotMatch(app, /midiBridge\.enable\(/);
  assert.match(app, /applyLogicalMidiMacro\(message\.logical\)/);
  assert.match(app, /audio\.allSoundOff\(\);[\s\S]{0,180}playMode: "drone"/);
  assert.match(app, /playMode: "drone"/);
  assert.match(app, /FRAME_INTERVAL = 1_000 \/ 30/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /unregisterMidiClient\?\.\(\)/);
  assert.match(app, /addEventListener\("pageshow"/);
  assert.match(app, /registerSharedMidiClient\(\)/);
  assert.match(app, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);

  assert.match(moduleSource, /createDynamicsCompressor/);
  assert.match(moduleSource, /createSoftCeilingCurve/);
  assert.match(moduleSource, /requestMIDIAccess\(\{ sysex: false \}\)/);
  assert.match(moduleSource, /analyser\.fftSize = 2_048/);
  assert.match(moduleSource, /type: "allSoundOff"/);
  assert.match(moduleSource, /async start\(\)\s*\{\s*await this\.initialize\(\)/);
});
