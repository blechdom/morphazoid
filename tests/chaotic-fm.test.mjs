import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHAOTIC_FM_DEFAULTS,
  CHAOTIC_FM_LIMITS,
  CHAOTIC_FM_PRESETS,
  DEFAULT_CHAOTIC_FM_PRESET_ID,
  ChaoticFmAudio,
  chaoticFmFrequency,
  createSoftCeilingCurve,
  deriveChaoticFmStack,
  formatChaoticFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  sanitizeChaoticFmParams,
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
  assert.ok(engine.node.messages.some(({ type, value }) => type === "active" && value));

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
  const [markup, app, moduleSource] = await Promise.all([
    readFile(new URL("chaotic-fm.html", root), "utf8"),
    readFile(new URL("chaotic-fm-app.js", root), "utf8"),
    readFile(new URL("src/chaotic-fm.js", root), "utf8"),
  ]);

  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="audioState">off</);
  assert.match(markup, /id="output"/);
  assert.match(markup, /href="chaotic-synth-ui\.css"/);
  assert.match(markup, /class="chaotic-signal-flow"/);
  assert.match(markup, /id="turnsReadout"/);
  assert.doesNotMatch(markup, />Turn \d+</);
  assert.match(markup, />Nonlinearity rate</);
  assert.match(markup, /this is not an audio filter/i);
  assert.match(markup, /CHAOTIC SYNTHS · 03/);
  assert.match(markup, /src="chaotic-fm-app\.js"/);
  assert.doesNotMatch(markup, /https?:\/\//);
  assert.doesNotMatch(markup, />\s*filter\s*</i);

  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /drawChaoticAnalysis/);
  assert.match(app, /createChaoticSpectrogram/);
  assert.match(app, /FRAME_INTERVAL = 1_000 \/ 30/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);

  assert.match(moduleSource, /createDynamicsCompressor/);
  assert.match(moduleSource, /createSoftCeilingCurve/);
  assert.match(moduleSource, /async start\(\)\s*\{\s*await this\.initialize\(\)/);
});
