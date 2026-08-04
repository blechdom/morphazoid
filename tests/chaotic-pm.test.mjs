import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHAOTIC_PM_DC_BLOCKER_HZ,
  CHAOTIC_PM_LIMITS,
  CHAOTIC_PM_LEGACY_PRESETS,
  CHAOTIC_PM_PRESETS,
  DEFAULT_CHAOTIC_PM_PRESET_ID,
  ChaoticPmAudio,
  chaoticPmTurnSample,
  createChaoticPmSoftCeilingCurve,
  deriveChaoticPmStack,
  sanitizeChaoticPmParams,
} from "../src/chaotic-pm.js";

const LEGACY_PRESET_IDS = [
  "subzero-thread",
  "forty-fold",
  "still-glass",
  "runaway-stair",
  "braided-orbit",
  "low-ember",
  "kilohertz-veil",
  "chrome-cascade",
];

const LEGACY_SETTINGS = [
  [2, 0.06, 0.035, 22, 0.625, 6, 0.34],
  [1, 0.666, 40, 10, 6.66, 6.5, 0.512],
  [4, 0.002, 0.002, 1, 0.365, 5.75, 0.246],
  [8, 0.006, 0.05, 0.001, 0.625, 4.75, 0.666],
  [5, 1.41, 1.14, 1, 0.864, 6.75, 0.41],
  [4, 3, 0.08, 2.6, 0.5, 7, 0.9],
  [4, 1_000, 0.02, 17.85, 13.5, 6.75, 0.13],
  [6, 0.144, 400, 10.247, 64, 1.75, 0.279],
].map(([
  depth,
  carrierHz,
  startModFrequencyHz,
  frequencyDivisor,
  startPhaseIndex,
  indexDivisor,
  nonlinearity,
]) => ({
  depth,
  carrierHz,
  startModFrequencyHz,
  frequencyDivisor,
  startPhaseIndex,
  indexDivisor,
  nonlinearity,
}));

function expectedLegacyTurn(
  previousSignal,
  basePhase,
  modFrequencyHz,
  phaseIndex,
  nonlinearity,
) {
  // Morphisma's `mod(..., 1)` is remainder, not a positive wrap. This signed
  // result matters because tanh is applied before the final sine.
  const phase = (basePhase + previousSignal * phaseIndex) % 1;
  const drive = nonlinearity * modFrequencyHz * modFrequencyHz;
  const gain = 1.2 - Math.sqrt(nonlinearity);
  return Math.sin(Math.PI * 2 * Math.tanh(phase * drive) * gain);
}

function approximatelyEqual(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function methodBody(source, signature) {
  const methodStart = source.indexOf(signature);
  assert.ok(methodStart >= 0, `missing ${signature}`);
  const bodyStart = source.indexOf("{", methodStart);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated ${signature}`);
}

test("Chaotic PM preserves the eight WIP tuples apart from the playable bank", () => {
  // Morphisma displayed tuple two initially; its Play effect then accidentally
  // forced tuple one. The recovered values remain reference material, but are
  // not suitable as an audible preset bank.
  assert.equal(DEFAULT_CHAOTIC_PM_PRESET_ID, "forty-fold");
  assert.deepEqual(
    CHAOTIC_PM_LEGACY_PRESETS.map(({ id }) => id),
    LEGACY_PRESET_IDS,
  );
  assert.deepEqual(
    CHAOTIC_PM_LEGACY_PRESETS.map(({ settings }) => settings),
    LEGACY_SETTINGS,
  );
  assert.ok(Object.isFrozen(CHAOTIC_PM_LEGACY_PRESETS));
  assert.ok(CHAOTIC_PM_LEGACY_PRESETS.every(Object.isFrozen));
  assert.ok(
    CHAOTIC_PM_LEGACY_PRESETS.every(
      ({ settings }) => Object.isFrozen(settings),
    ),
  );

  assert.deepEqual(
    CHAOTIC_PM_PRESETS.map(({ id }) => id),
    LEGACY_PRESET_IDS,
  );
  assert.notDeepEqual(
    CHAOTIC_PM_PRESETS.map(({ settings }) => settings),
    LEGACY_SETTINGS,
    "the playable bank must not silently alias the inaudible WIP tuples",
  );
  CHAOTIC_PM_PRESETS.forEach((preset, index) => {
    assert.notDeepEqual(
      preset.settings,
      CHAOTIC_PM_LEGACY_PRESETS[index].settings,
      `${preset.id} must identify its audible adaptation separately from WIP`,
    );
  });
  assert.ok(Object.isFrozen(CHAOTIC_PM_PRESETS));
  assert.ok(CHAOTIC_PM_PRESETS.every(Object.isFrozen));
  assert.ok(CHAOTIC_PM_PRESETS.every(({ settings }) => Object.isFrozen(settings)));
});

test("Chaotic PM accepts the original parameter names without altering presets", () => {
  const legacy = sanitizeChaoticPmParams({
    steps: 8,
    carrierFreq: 0.006,
    startModFreq: 0.05,
    freqDiv: 0.001,
    indexOfMod: 0.625,
    indexDiv: 4.75,
    filter: 0.666,
  });

  assert.deepEqual(
    {
      depth: legacy.depth,
      carrierHz: legacy.carrierHz,
      startModFrequencyHz: legacy.startModFrequencyHz,
      frequencyDivisor: legacy.frequencyDivisor,
      startPhaseIndex: legacy.startPhaseIndex,
      indexDivisor: legacy.indexDivisor,
      nonlinearity: legacy.nonlinearity,
    },
    LEGACY_SETTINGS[3],
  );

  const bounded = sanitizeChaoticPmParams({
    steps: 99,
    carrierFreq: -1,
    startModFreq: -1,
    freqDiv: 0,
    indexOfMod: 1_000,
    indexDiv: 0,
    filter: 2,
  });
  assert.equal(bounded.depth, CHAOTIC_PM_LIMITS.maxDepth);
  assert.equal(bounded.carrierHz, CHAOTIC_PM_LIMITS.minCarrierHz);
  assert.equal(
    bounded.startModFrequencyHz,
    CHAOTIC_PM_LIMITS.minModFrequencyHz,
  );
  assert.equal(
    bounded.frequencyDivisor,
    CHAOTIC_PM_LIMITS.minFrequencyDivisor,
  );
  assert.equal(bounded.startPhaseIndex, CHAOTIC_PM_LIMITS.maxPhaseIndex);
  assert.equal(bounded.indexDivisor, CHAOTIC_PM_LIMITS.minIndexDivisor);
  assert.equal(bounded.nonlinearity, CHAOTIC_PM_LIMITS.maxNonlinearity);
});

test("one Chaotic PM turn matches the signed-remainder legacy transfer", () => {
  for (const values of [
    [0.25, 0.125, 40, 6.66, 0.512],
    [-0.75, 0.1, 3.5, 0.6, 0.34],
    [0.9, 0.95, 0.08, 0.5, 0.9],
    [1, 0.25, 400, 64, 0.279],
  ]) {
    approximatelyEqual(
      chaoticPmTurnSample(...values),
      expectedLegacyTurn(...values),
    );
  }

  const negativeValues = [-0.75, 0.1, 3.5, 0.6, 0.34];
  const signedPhase = (
    negativeValues[1] + negativeValues[0] * negativeValues[3]
  ) % 1;
  assert.ok(signedPhase < 0, "fixture must exercise signed remainder semantics");
  const positivePhase = signedPhase - Math.floor(signedPhase);
  const positiveWrapResult = Math.sin(
    Math.PI * 2
      * Math.tanh(
        positivePhase * negativeValues[4] * negativeValues[2] ** 2,
      )
      * (1.2 - Math.sqrt(negativeValues[4])),
  );
  assert.notEqual(chaoticPmTurnSample(...negativeValues), positiveWrapResult);
  assert.equal(chaoticPmTurnSample(0.5, 0.5, 20, 2, 0), 0);
});

test("operator ledger divides frequency and index independently", () => {
  const stack = deriveChaoticPmStack(LEGACY_SETTINGS[0]);

  assert.equal(stack.requestedDepth, 2);
  assert.equal(stack.actualDepth, 2);
  assert.equal(stack.audibleIndex, 2);
  assert.equal(stack.operators.length, 3);
  assert.deepEqual(
    stack.operators.map(({ sourceIndex }) => sourceIndex),
    [null, 0, 1],
  );
  assert.equal(stack.operators[0].kind, "carrier");
  assert.equal(stack.operators[0].frequencyHz, 0.06);
  assert.equal(stack.operators[1].frequencyHz, 0.035);
  assert.equal(stack.operators[1].phaseIndex, 0.625);
  assert.equal(stack.operators[1].nonlinearity, 0.34);
  approximatelyEqual(stack.operators[1].drive, 0.34 * 0.035 ** 2);
  approximatelyEqual(stack.operators[1].gain, 1.2 - Math.sqrt(0.34));
  approximatelyEqual(stack.operators[2].frequencyHz, 0.035 / 22);
  approximatelyEqual(stack.operators[2].phaseIndex, 0.625 / 6);
});

test("operator ledger omits a turn whose base frequency reaches the ceiling", () => {
  const stack = deriveChaoticPmStack({
    depth: 8,
    carrierHz: 0.006,
    startModFrequencyHz: 0.05,
    frequencyDivisor: 0.001,
    startPhaseIndex: 0.625,
    indexDivisor: 4.75,
    nonlinearity: 0.666,
  }, { sampleRate: 48_000 });

  assert.equal(stack.requestedDepth, 8);
  assert.equal(stack.actualDepth, 2);
  assert.equal(stack.boundedByFrequency, true);
  assert.deepEqual(
    stack.operators.slice(1).map(({ frequencyHz }) => frequencyHz),
    [0.05, 50],
  );
  assert.ok(50_000 >= stack.settings.maximumFrequencyHz);
});

test("every playable preset reaches an untruncated audio-rate final operator", () => {
  for (const preset of CHAOTIC_PM_PRESETS) {
    const stack = deriveChaoticPmStack(preset.settings, {
      sampleRate: 48_000,
    });
    const finalOperator = stack.operators[stack.audibleIndex];

    assert.equal(
      stack.actualDepth,
      stack.requestedDepth,
      `${preset.id} must not lose requested turns to the frequency ceiling`,
    );
    assert.equal(
      stack.boundedByFrequency,
      false,
      `${preset.id} must fit below the render ceiling`,
    );
    assert.ok(
      finalOperator.frequencyHz >= 40,
      `${preset.id} final operator is sub-audio at ${finalOperator.frequencyHz} Hz`,
    );
    assert.ok(
      finalOperator.frequencyHz <= 2_000,
      `${preset.id} final operator is unnecessarily high at ${finalOperator.frequencyHz} Hz`,
    );
    assert.ok(
      finalOperator.frequencyHz < stack.settings.maximumFrequencyHz,
      `${preset.id} final operator must remain below the render ceiling`,
    );
    assert.ok(
      finalOperator.drive >= 0.25,
      `${preset.id} terminal phase-warp drive ${finalOperator.drive} collapses toward silence`,
    );
  }
});

test("soft ceiling is finite, bounded, monotonic, and antisymmetric", () => {
  const curve = createChaoticPmSoftCeilingCurve(1_025);
  assert.ok(curve instanceof Float32Array);
  assert.equal(curve.length, 1_025);
  for (let index = 0; index < curve.length; index += 1) {
    assert.ok(Number.isFinite(curve[index]));
    assert.ok(Math.abs(curve[index]) <= 1);
    if (index > 0) assert.ok(curve[index] >= curve[index - 1]);
    approximatelyEqual(curve[index], -curve[curve.length - 1 - index], 1e-6);
  }
});

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
  }

  cancelScheduledValues() {}

  setValueAtTime(value) {
    this.value = value;
  }

  setTargetAtTime(value) {
    this.value = value;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }
}

class FakeNode {
  constructor() {
    this.connections = [];
    this.disconnected = false;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeAudioWorkletNode extends FakeNode {
  constructor(context, name, options) {
    super();
    this.context = context;
    this.name = name;
    this.options = options;
    this.messages = [];
    this.port = {
      postMessage: (message) => this.messages.push(message),
    };
  }
}

class FakeAudioContext {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.sampleRate = 48_000;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new FakeNode();
    this.modules = [];
    this.audioWorklet = {
      addModule: async (url) => this.modules.push(String(url)),
    };
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const node = new FakeNode();
    node.gain = new FakeAudioParam();
    return node;
  }

  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const name of ["threshold", "knee", "ratio", "attack", "release"]) {
      node[name] = new FakeAudioParam();
    }
    return node;
  }

  createWaveShaper() {
    const node = new FakeNode();
    node.curve = null;
    node.oversample = "none";
    return node;
  }

  createBiquadFilter() {
    const node = new FakeNode();
    node.frequency = new FakeAudioParam();
    node.Q = new FakeAudioParam();
    return node;
  }

  createAnalyser() {
    const node = new FakeNode();
    node.fftSize = 0;
    node.smoothingTimeConstant = 0;
    node.getByteTimeDomainData = (target) => target.fill(128);
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

test("audio stays lazy, starts one worklet, and closes every node", async () => {
  FakeAudioContext.instances.length = 0;
  const runtime = {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
  };
  const audio = new ChaoticPmAudio(runtime);
  assert.equal(FakeAudioContext.instances.length, 0);

  await audio.start(LEGACY_SETTINGS[0], 0.58);
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(audio.running, true);
  assert.equal(audio.context.options.latencyHint, "interactive");
  assert.match(audio.context.modules[0], /src\/chaotic-pm\.js$/);
  const worklet = audio.worklet ?? audio.node;
  assert.equal(worklet.name, "morphazoid-chaotic-pm");
  assert.equal(CHAOTIC_PM_DC_BLOCKER_HZ, 18);
  assert.equal(audio.highpass.frequency.value, CHAOTIC_PM_DC_BLOCKER_HZ);

  await audio.start(LEGACY_SETTINGS[1], 0.4);
  assert.equal(FakeAudioContext.instances.length, 1);
  await audio.stop({ immediate: true });
  assert.equal(audio.running, false);
  assert.equal(FakeAudioContext.instances[0].state, "closed");
  assert.equal(worklet.disconnected, true);
});

class DeferredAudioContext extends FakeAudioContext {
  static releaseModule = null;

  constructor(options) {
    super(options);
    this.audioWorklet = {
      addModule: (url) => {
        this.modules.push(String(url));
        return new Promise((resolve) => {
          DeferredAudioContext.releaseModule = resolve;
        });
      },
    };
  }
}

test("concurrent start keeps the latest controls and a closed context restarts", async () => {
  FakeAudioContext.instances.length = 0;
  const runtime = {
    AudioContext: DeferredAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
  };
  const audio = new ChaoticPmAudio(runtime);
  const firstStart = audio.start(LEGACY_SETTINGS[0], 0.2);
  const secondStart = audio.start(LEGACY_SETTINGS[3], 0.66);
  assert.equal(FakeAudioContext.instances.length, 1);
  DeferredAudioContext.releaseModule();
  await Promise.all([firstStart, secondStart]);

  assert.equal(audio.running, true);
  assert.equal(audio.worklet.messages.at(-1).settings.carrierHz, 0.006);
  assert.equal(audio.worklet.messages.at(-1).settings.depth, 2);
  assert.equal(audio.masterGain.gain.value, 0.66);

  const firstContext = audio.context;
  const firstWorklet = audio.worklet;
  await firstContext.close();
  assert.equal(audio.running, false);
  const restart = audio.start(LEGACY_SETTINGS[1], 0.4);
  DeferredAudioContext.releaseModule();
  await restart;
  assert.equal(FakeAudioContext.instances.length, 2);
  assert.notEqual(audio.context, firstContext);
  assert.equal(firstWorklet.disconnected, true);
  await audio.stop({ immediate: true });
});

function configureWorkletProcessor(Processor, settings, sampleRate) {
  const stack = deriveChaoticPmStack(settings, { sampleRate });
  const processor = new Processor();
  processor.port.onmessage({
    data: {
      type: "settings",
      settings: {
        ...stack.settings,
        depth: stack.actualDepth,
      },
      immediate: true,
    },
  });
  return processor;
}

function renderAudibilityMetrics(Processor, settings, {
  sampleRate = 48_000,
  warmupSeconds = 0.25,
  measureSeconds = 1,
  dcBlockerHz = CHAOTIC_PM_DC_BLOCKER_HZ,
} = {}) {
  globalThis.sampleRate = sampleRate;
  const processor = configureWorkletProcessor(Processor, settings, sampleRate);
  const warmupFrames = Math.round(warmupSeconds * sampleRate);
  const measureFrames = Math.round(measureSeconds * sampleRate);
  const totalFrames = warmupFrames + measureFrames;
  // Match the audible graph's Butterworth-like high-pass closely enough to
  // reject DC-heavy WIP signals in a deterministic, browser-free render.
  const angularFrequency = Math.PI * 2 * dcBlockerHz / sampleRate;
  const cosine = Math.cos(angularFrequency);
  const alpha = Math.sin(angularFrequency) / (2 * 0.707);
  const a0 = 1 + alpha;
  const highpass = {
    b0: (1 + cosine) / (2 * a0),
    b1: -(1 + cosine) / a0,
    b2: (1 + cosine) / (2 * a0),
    a1: -2 * cosine / a0,
    a2: (1 - alpha) / a0,
  };
  let input1 = 0;
  let input2 = 0;
  let output1 = 0;
  let output2 = 0;
  let renderedFrames = 0;
  let measuredFrames = 0;
  let sum = 0;
  let squareSum = 0;
  let postDcSquareSum = 0;
  let peak = 0;

  while (renderedFrames < totalFrames) {
    const output = new Float32Array(128);
    assert.equal(processor.process([], [[output]]), true);
    for (const sample of output) {
      assert.ok(Number.isFinite(sample), "worklet emitted a non-finite sample");
      assert.ok(Math.abs(sample) <= 1.000001, "worklet exceeded unity");
      const postDc = highpass.b0 * sample
        + highpass.b1 * input1
        + highpass.b2 * input2
        - highpass.a1 * output1
        - highpass.a2 * output2;
      assert.ok(Number.isFinite(postDc), "DC blocker emitted a non-finite sample");
      input2 = input1;
      input1 = sample;
      output2 = output1;
      output1 = postDc;

      if (renderedFrames >= warmupFrames && measuredFrames < measureFrames) {
        sum += sample;
        squareSum += sample * sample;
        postDcSquareSum += postDc * postDc;
        peak = Math.max(peak, Math.abs(sample));
        measuredFrames += 1;
      }
      renderedFrames += 1;
      if (renderedFrames >= totalFrames) break;
    }
  }

  assert.equal(measuredFrames, measureFrames);
  const mean = sum / measuredFrames;
  return {
    peak,
    acRms: Math.sqrt(Math.max(0, squareSum / measuredFrames - mean * mean)),
    postDcRms: Math.sqrt(postDcSquareSum / measuredFrames),
  };
}

test("worklet renders both banks finitely and playable presets audibly", async () => {
  const previousProcessorBase = globalThis.AudioWorkletProcessor;
  const previousRegisterProcessor = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;
  try {
    globalThis.AudioWorkletProcessor = class {
      constructor() {
        this.port = { onmessage: null };
      }
    };
    globalThis.registerProcessor = (_name, ProcessorClass) => {
      Processor = ProcessorClass;
    };
    const workletUrl = new URL("../src/chaotic-pm.js", import.meta.url);
    workletUrl.searchParams.set("worklet-test", String(Date.now()));
    await import(workletUrl);
    assert.equal(typeof Processor, "function");

    for (const sampleRate of [32_000, 44_100, 48_000, 96_000]) {
      globalThis.sampleRate = sampleRate;
      const settingsBank = [
        ...CHAOTIC_PM_LEGACY_PRESETS.map(({ settings }) => settings),
        ...CHAOTIC_PM_PRESETS.map(({ settings }) => settings),
      ];
      for (const settings of settingsBank) {
        const processor = configureWorkletProcessor(
          Processor,
          settings,
          sampleRate,
        );
        for (let block = 0; block < 16; block += 1) {
          const left = new Float32Array(128);
          const right = new Float32Array(128);
          assert.equal(processor.process([], [[left, right]]), true);
          for (let frame = 0; frame < left.length; frame += 1) {
            assert.ok(Number.isFinite(left[frame]));
            assert.ok(Math.abs(left[frame]) <= 1.000001);
            assert.equal(left[frame], right[frame]);
          }
        }
      }
    }

    globalThis.sampleRate = 48_000;
    const silentWarp = new Processor();
    silentWarp.port.onmessage({
      data: {
        type: "settings",
        settings: {
          ...LEGACY_SETTINGS[1],
          depth: 1,
          nonlinearity: 0,
          maximumFrequencyHz: 20_000,
        },
        immediate: true,
      },
    });
    const silent = new Float32Array(128);
    silentWarp.process([], [[silent]]);
    assert.ok(silent.every((sample) => sample === 0));

    const carrierOnly = new Processor();
    carrierOnly.port.onmessage({
      data: {
        type: "settings",
        settings: {
          ...LEGACY_SETTINGS[1],
          depth: 0,
          maximumFrequencyHz: 20_000,
        },
        immediate: true,
      },
    });
    const carrier = new Float32Array(128);
    carrierOnly.process([], [[carrier]]);
    assert.ok(carrier.some((sample) => Math.abs(sample) > 0));

    for (const sampleRate of [44_100, 48_000]) {
      for (const preset of CHAOTIC_PM_PRESETS) {
        const metrics = renderAudibilityMetrics(Processor, preset.settings, {
          sampleRate,
        });
        const fixture = `${preset.id} at ${sampleRate} Hz`;
        assert.ok(
          metrics.peak >= 0.25,
          `${fixture} rendered peak ${metrics.peak} is effectively silent`,
        );
        assert.ok(
          metrics.acRms >= 0.15,
          `${fixture} AC RMS ${metrics.acRms} is effectively silent`,
        );
        assert.ok(
          metrics.postDcRms >= 0.15,
          `${fixture} post-${CHAOTIC_PM_DC_BLOCKER_HZ} Hz DC-blocker RMS ${metrics.postDcRms} is effectively silent`,
        );
      }
    }
  } finally {
    if (previousProcessorBase === undefined) {
      delete globalThis.AudioWorkletProcessor;
    } else {
      globalThis.AudioWorkletProcessor = previousProcessorBase;
    }
    if (previousRegisterProcessor === undefined) {
      delete globalThis.registerProcessor;
    } else {
      globalThis.registerProcessor = previousRegisterProcessor;
    }
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("worklet preallocates state and keeps its render loop allocation-free", async () => {
  const source = await readFile(
    new URL("../src/chaotic-pm.js", import.meta.url),
    "utf8",
  );
  const processBody = methodBody(source, "process(_inputs, outputs)");

  assert.match(source, /registerProcessor/);
  assert.match(source, /new Float(?:32|64)Array/);
  assert.doesNotMatch(processBody, /new (?:Array|Float(?:32|64)Array)/);
  assert.match(source, /Number\.isFinite/);
});
