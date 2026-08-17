import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CASCADING_PM_DEFAULTS,
  CASCADING_PM_LIMITS,
  CASCADING_PM_PRESETS,
  CASCADING_PM_PROCESSOR_NAME,
  DEFAULT_CASCADING_PM_PRESET_ID,
  CascadingPmAudioEngine,
  CascadingPmProcessor,
  advanceCascadePhases,
  cascadeRatioForStageCount,
  deriveCascadeStack,
  deriveCascadingPmStack,
  evaluatePhaseCascade,
  formatCascadeFrequency,
  formatPhaseIndex,
  phaseIndexSliderPosition,
  phaseIndexSliderValue,
  ratioSliderPosition,
  ratioSliderValue,
  renderCascadingPmSamples,
  rootHzSliderPosition,
  rootHzSliderValue,
  sanitizeCascadingPmSettings,
} from "../src/cascading-pm.js";

const ROOT = new URL("../", import.meta.url);
const TWO_PI = Math.PI * 2;
const RATIO_UNITY_POSITION = ratioSliderPosition(1);

function approximatelyEqual(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function rms(samples) {
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / Math.max(1, samples.length));
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

test("Cascading PM settings and presets are finite, bounded, and immutable", () => {
  const safe = sanitizeCascadingPmSettings({
    stages: 99,
    rootHz: -2,
    cascadeRatio: Infinity,
    phaseIndex: 999,
    indexTaper: -4,
  });
  assert.deepEqual(safe, {
    stages: CASCADING_PM_LIMITS.maxStages,
    rootHz: CASCADING_PM_LIMITS.minRootHz,
    cascadeRatio: CASCADING_PM_DEFAULTS.cascadeRatio,
    phaseIndex: CASCADING_PM_LIMITS.maxPhaseIndex,
    indexTaper: CASCADING_PM_LIMITS.minIndexTaper,
  });
  assert.ok(Object.isFrozen(safe));
  assert.equal(DEFAULT_CASCADING_PM_PRESET_ID, "slow-cascade");
  assert.equal(CASCADING_PM_PROCESSOR_NAME, "morphazoid-cascading-pm");
  assert.equal(CASCADING_PM_LIMITS.minCascadeRatio, 0.25);
  assert.equal(CASCADING_PM_LIMITS.maxStages, 12);
  assert.equal(sanitizeCascadingPmSettings({ cascadeRatio: 0.01 }).cascadeRatio, 0.25);
  assert.equal(CASCADING_PM_PRESETS.length, 6);
  assert.ok(Object.isFrozen(CASCADING_PM_PRESETS));
  assert.ok(CASCADING_PM_PRESETS.every(Object.isFrozen));
  assert.ok(CASCADING_PM_PRESETS.every(({ settings }) => Object.isFrozen(settings)));

  for (const preset of CASCADING_PM_PRESETS) {
    assert.deepEqual(
      sanitizeCascadingPmSettings(preset.settings),
      preset.settings,
      `${preset.id} is not already sanitized`,
    );
  }
});

test("the operator ledger uses geometric base frequencies and radian phase indices", () => {
  const stack = deriveCascadeStack({
    stages: 5,
    rootHz: 0.5,
    cascadeRatio: 8,
    phaseIndex: 3,
    indexTaper: 0.5,
  }, { sampleRate: 48_000 });
  assert.equal(deriveCascadingPmStack, deriveCascadeStack);
  assert.deepEqual(
    stack.oscillators.map(({ frequencyHz }) => frequencyHz),
    [0.5, 4, 32, 256, 2_048],
  );
  assert.deepEqual(
    stack.connections.map(({ phaseIndex }) => phaseIndex),
    [3, 1.5, 0.75, 0.375],
  );
  assert.ok(stack.connections.every((connection) => !Object.hasOwn(connection, "depthHz")));
  assert.ok(stack.connections.every(({ phaseIndex }) => (
    phaseIndex >= 0 && phaseIndex <= CASCADING_PM_LIMITS.maxInternalPhaseIndex
  )));
  assert.equal(stack.outputIndex, 4);
  assert.ok(Object.isFrozen(stack));
  assert.ok(Object.isFrozen(stack.oscillators));
  assert.ok(Object.isFrozen(stack.connections));

  const zero = deriveCascadeStack({ ...stack.settings, phaseIndex: 0 });
  assert.deepEqual(
    zero.oscillators.map(({ frequencyHz }) => frequencyHz),
    stack.oscillators.map(({ frequencyHz }) => frequencyHz),
    "phase index must not alter any base frequency",
  );
  assert.ok(zero.connections.every(({ phaseIndex }) => phaseIndex === 0));
});

test("sub-unity ratios produce descending, stable, finite PM cascades", () => {
  const cases = [
    { ratio: 0.5, frequencies: [64, 32, 16, 8] },
    { ratio: 1, frequencies: [64, 64, 64, 64] },
    { ratio: 2, frequencies: [64, 128, 256, 512] },
  ];

  for (const { ratio, frequencies } of cases) {
    const settings = {
      stages: 4,
      rootHz: 64,
      cascadeRatio: ratio,
      phaseIndex: 1.4,
      indexTaper: 0.8,
    };
    const stack = deriveCascadeStack(settings, { sampleRate: 48_000 });
    assert.deepEqual(
      stack.oscillators.map(({ frequencyHz }) => frequencyHz),
      frequencies,
    );
    assert.equal(stack.boundedByFrequency, false);

    const samples = renderCascadingPmSamples(settings, {
      sampleRate: 48_000,
      frameCount: 2_048,
    });
    assert.ok(samples.every(Number.isFinite), `ratio ${ratio} produced non-finite audio`);
    assert.ok(samples.every((sample) => Math.abs(sample) <= 1));
  }

  const processor = new CascadingPmProcessor();
  processor._applySettings({
    stages: 4,
    rootHz: 64,
    cascadeRatio: 0.01,
    phaseIndex: 1,
    indexTaper: 1,
  }, true);
  assert.deepEqual(
    Array.from(processor._targetFrequencies.slice(0, 4)),
    [64, 16, 4, 1],
    "the worklet scalar sanitizer must enforce the 0.25 ratio floor",
  );

  const deepest = deriveCascadeStack({
    stages: CASCADING_PM_LIMITS.maxStages,
    rootHz: CASCADING_PM_LIMITS.minRootHz,
    cascadeRatio: CASCADING_PM_LIMITS.minCascadeRatio,
  });
  assert.equal(
    formatCascadeFrequency(deepest.oscillators.at(-1).frequencyHz),
    "4.77 nHz",
    "the ledger must not display a valid descending stage as 0 Hz",
  );
});

test("stage-count compensation preserves rising and descending PM endpoints", () => {
  const cases = [
    { ratio: 3.2, previousStages: 8, nextStages: 12, rootHz: 0.025 },
    { ratio: 0.72, previousStages: 6, nextStages: 11, rootHz: 100 },
    { ratio: 1.5, previousStages: 8, nextStages: 2, rootHz: 0.025 },
    { ratio: 0.9, previousStages: 8, nextStages: 2, rootHz: 100 },
  ];

  for (const { ratio, previousStages, nextStages, rootHz } of cases) {
    const adjustedRatio = cascadeRatioForStageCount(
      ratio,
      previousStages,
      nextStages,
    );
    const previous = deriveCascadeStack({
      stages: previousStages,
      rootHz,
      cascadeRatio: ratio,
      phaseIndex: 0,
      indexTaper: 1,
    });
    const next = deriveCascadeStack({
      stages: nextStages,
      rootHz,
      cascadeRatio: adjustedRatio,
      phaseIndex: 0,
      indexTaper: 1,
    });
    const expectedCarrierHz = previous.oscillators.at(-1).rawFrequencyHz;
    approximatelyEqual(
      next.oscillators.at(-1).rawFrequencyHz,
      expectedCarrierHz,
      Math.max(1, expectedCarrierHz) * 1e-12,
    );
    approximatelyEqual(
      cascadeRatioForStageCount(adjustedRatio, nextStages, previousStages),
      ratio,
      1e-12,
    );
  }
  assert.equal(cascadeRatioForStageCount(1, 2, 12), 1);
});

test("bandwidth pressure safely reduces extreme phase indices before Nyquist", () => {
  for (const sampleRate of [44_100, 48_000, 96_000]) {
    const stack = deriveCascadeStack({
      stages: CASCADING_PM_LIMITS.maxStages,
      rootHz: 110,
      cascadeRatio: 200,
      phaseIndex: 16,
      indexTaper: 4,
    }, { sampleRate });
    const bandwidthCeiling = sampleRate * 0.45;
    assert.ok(stack.oscillators.every(({ frequencyHz }) => (
      frequencyHz <= Math.min(CASCADING_PM_LIMITS.audioCeiling, sampleRate * 0.4)
    )));

    let priorBandwidth = stack.oscillators[0].frequencyHz;
    let limitedConnections = 0;
    for (let index = 0; index < stack.connections.length; index += 1) {
      const connection = stack.connections[index];
      const destinationHz = stack.oscillators[index + 1].frequencyHz;
      const estimatedBandwidth = destinationHz + connection.phaseIndex * priorBandwidth;
      assert.ok(
        estimatedBandwidth <= bandwidthCeiling + 1e-8,
        `stage ${index + 1} estimates ${estimatedBandwidth} Hz at ${sampleRate} Hz`,
      );
      priorBandwidth = estimatedBandwidth;
      if (connection.phaseIndex < Math.min(
        connection.rawPhaseIndex,
        CASCADING_PM_LIMITS.maxInternalPhaseIndex,
      )) limitedConnections += 1;
    }
    assert.ok(limitedConnections > 0, "extreme PM should engage the bandwidth guard");

    const processor = new CascadingPmProcessor();
    processor._sampleRate = sampleRate;
    processor._applySettings(stack.settings, true);
    for (let index = 0; index < stack.connections.length; index += 1) {
      approximatelyEqual(
        processor._phaseIndices[index],
        stack.connections[index].phaseIndex,
        1e-10,
      );
    }
  }
});

test("factory PM presets stay low and do not rely on safety guards", () => {
  assert.deepEqual(
    CASCADING_PM_DEFAULTS,
    CASCADING_PM_PRESETS.find(({ id }) => id === DEFAULT_CASCADING_PM_PRESET_ID).settings,
  );
  for (const preset of CASCADING_PM_PRESETS) {
    assert.ok(preset.settings.stages >= 6 && preset.settings.stages <= 12);
    assert.ok(preset.settings.rootHz <= 0.15, `${preset.id} root is too fast`);
    assert.ok(preset.settings.cascadeRatio <= 4.5, `${preset.id} ratio is too steep`);
    assert.ok(preset.settings.phaseIndex <= 1.5, `${preset.id} starts too deep`);
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      const stack = deriveCascadeStack(preset.settings, { sampleRate });
      const carrier = stack.oscillators.at(-1);
      assert.equal(
        stack.boundedByFrequency,
        false,
        `${preset.id} relies on a frequency clamp at ${sampleRate} Hz`,
      );
      assert.ok(
        carrier.frequencyHz >= 60 && carrier.frequencyHz <= 900,
        `${preset.id} carrier ${carrier.frequencyHz} Hz is not comfortably audible`,
      );
      assert.equal(stack.boundedByInternalIndex, false, `${preset.id} index guard`);
      assert.equal(stack.boundedByBandwidth, false, `${preset.id} bandwidth guard`);
      assert.ok(stack.connections.every(({ rawPhaseIndex, phaseIndex }) => (
        rawPhaseIndex <= 1.5 && phaseIndex === rawPhaseIndex
      )));
      assert.ok(
        carrier.estimatedBandwidthHz <= 1_000,
        `${preset.id} bandwidth ${carrier.estimatedBandwidthHz} Hz is too bright`,
      );
    }
  }
});

test("the phase cascade evaluates the nested PM equation exactly", () => {
  const settings = {
    stages: 3,
    rootHz: 100,
    cascadeRatio: 2,
    phaseIndex: 2,
    indexTaper: 0.5,
  };
  const phases = [0.1, 0.2, 0.3];
  const evaluated = evaluatePhaseCascade(phases, settings);
  const stage0 = Math.sin(phases[0]);
  const stage1 = Math.sin(phases[1] + 2 * stage0);
  const stage2 = Math.sin(phases[2] + stage1);
  approximatelyEqual(evaluated.stageOutputs[0], stage0);
  approximatelyEqual(evaluated.stageOutputs[1], stage1);
  approximatelyEqual(evaluated.stageOutputs[2], stage2);
  approximatelyEqual(evaluated.output, stage2);
  assert.ok(Object.isFrozen(evaluated));
  assert.ok(Object.isFrozen(evaluated.stageOutputs));

  const noPm = evaluatePhaseCascade(phases, { ...settings, phaseIndex: 0 });
  approximatelyEqual(noPm.output, Math.sin(phases.at(-1)));

  const advanced = advanceCascadePhases(phases, settings, { sampleRate: 48_000 });
  for (let index = 0; index < advanced.length; index += 1) {
    const frequency = settings.rootHz * settings.cascadeRatio ** index;
    const expected = (phases[index] + TWO_PI * frequency / 48_000) % TWO_PI;
    approximatelyEqual(advanced[index], expected);
  }
});

test("logarithmic and quadratic slider mappings round-trip", () => {
  for (const value of [0, 0.03, 0.2, 0.5, 0.82, 1]) {
    approximatelyEqual(rootHzSliderPosition(rootHzSliderValue(value)), value, 1e-11);
    approximatelyEqual(ratioSliderPosition(ratioSliderValue(value)), value, 1e-11);
    approximatelyEqual(
      phaseIndexSliderPosition(phaseIndexSliderValue(value)),
      value,
      1e-11,
    );
  }
  assert.equal(ratioSliderValue(0), 0.25);
  approximatelyEqual(ratioSliderValue(RATIO_UNITY_POSITION), 1);
  approximatelyEqual(ratioSliderPosition(1), RATIO_UNITY_POSITION);
  assert.equal(ratioSliderValue(1), 200);
  for (const ratio of [0.25, 0.5, 1, 2, 10, 200]) {
    approximatelyEqual(ratioSliderValue(ratioSliderPosition(ratio)), ratio, 1e-11);
  }
  assert.equal(formatPhaseIndex(0), "0 rad");
  assert.equal(formatPhaseIndex(2.4), "2.4 rad");
  assert.equal(formatPhaseIndex(16), "16 rad");
});

test("ratio slider stays monotonic and precise across twelve stages", () => {
  let previous = ratioSliderValue(0);
  for (let tick = 1; tick <= 10_000; tick += 1) {
    const value = ratioSliderValue(tick / 10_000);
    assert.ok(Number.isFinite(value));
    assert.ok(value > previous, `ratio stopped increasing at slider tick ${tick}`);
    assert.ok(value >= CASCADING_PM_LIMITS.minCascadeRatio);
    assert.ok(value <= CASCADING_PM_LIMITS.maxCascadeRatio);
    previous = value;
  }

  for (const position of [0, 0.08, 0.1, 0.19, RATIO_UNITY_POSITION, 0.21, 0.4, 0.72, 0.9, 1]) {
    approximatelyEqual(ratioSliderPosition(ratioSliderValue(position)), position, 1e-11);
  }

  const musicalStart = ratioSliderPosition(1);
  const musicalEnd = ratioSliderPosition(5);
  assert.ok(
    musicalEnd - musicalStart >= 0.4,
    "the musically useful ×1–×5 region should occupy at least 40% of the track",
  );

  for (let tick = 0; tick < 1_000; tick += 1) {
    const start = musicalStart
      + (musicalEnd - musicalStart - 0.001) * tick / 999;
    const ratioStep = ratioSliderValue(start + 0.001) / ratioSliderValue(start);
    const finalStageStep = ratioStep ** (CASCADING_PM_LIMITS.maxStages - 1);
    assert.ok(
      finalStageStep <= 1.055,
      `one fine drag step compounded to ${finalStageStep.toFixed(4)}× at the final stage`,
    );
  }
});

test("preset ratios occupy the usable rising side of the slider", () => {
  const sorted = [...CASCADING_PM_PRESETS]
    .sort((a, b) => a.settings.cascadeRatio - b.settings.cascadeRatio);
  let previousPosition = RATIO_UNITY_POSITION;
  for (const preset of sorted) {
    const ratio = preset.settings.cascadeRatio;
    const position = ratioSliderPosition(ratio);
    approximatelyEqual(ratioSliderValue(position), ratio, 1e-10);
    assert.ok(position > previousPosition, `${preset.id} should have a distinct slider position`);
    previousPosition = position;
  }
  const positions = sorted.map(({ settings }) => ratioSliderPosition(settings.cascadeRatio));
  assert.ok(
    positions.at(-1) - positions[0] >= 0.16,
    "factory ratios should not be bunched into a narrow part of the track",
  );
});

test("all presets render bounded, finite, and audible at common sample rates", () => {
  for (const preset of CASCADING_PM_PRESETS) {
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      const samples = renderCascadingPmSamples(preset.settings, {
        sampleRate,
        frameCount: Math.round(sampleRate * 0.35),
      });
      assert.ok(samples.length > 0);
      assert.ok(samples.every(Number.isFinite), `${preset.id} produced non-finite audio`);
      assert.ok(samples.every((sample) => Math.abs(sample) <= 1));
      assert.ok(rms(samples) > 0.05, `${preset.id} is effectively silent at ${sampleRate}`);
    }
  }
});

test("the worklet matches the pure renderer and keeps render storage stable", () => {
  const priorSampleRate = globalThis.sampleRate;
  globalThis.sampleRate = 48_000;
  try {
    const settings = CASCADING_PM_PRESETS[2].settings;
    const processor = new CascadingPmProcessor();
    processor._applySettings(settings, true);
    const storage = {
      phases: processor._phases,
      frequencies: processor._frequencies,
      phaseIndices: processor._phaseIndices,
      stageOutputs: processor._stageOutputs,
    };
    const left = new Float32Array(512);
    const right = new Float32Array(512);
    assert.equal(processor.process([], [[left, right]]), true);
    const reference = renderCascadingPmSamples(settings, {
      sampleRate: 48_000,
      frameCount: left.length,
    });
    for (let index = 0; index < left.length; index += 1) {
      approximatelyEqual(left[index], reference[index], 1e-6);
      assert.equal(right[index], left[index]);
    }
    assert.equal(processor._phases, storage.phases);
    assert.equal(processor._frequencies, storage.frequencies);
    assert.equal(processor._phaseIndices, storage.phaseIndices);
    assert.equal(processor._stageOutputs, storage.stageOutputs);
  } finally {
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});

test("rapid stage changes remain bounded and continuous", () => {
  const priorSampleRate = globalThis.sampleRate;
  globalThis.sampleRate = 48_000;
  try {
    const processor = new CascadingPmProcessor();
    const common = {
      rootHz: 2,
      cascadeRatio: 1.5,
      phaseIndex: 0.7,
      indexTaper: 0.8,
    };
    processor._applySettings({ ...common, stages: 2 }, true);
    const rendered = [];
    for (const [stages, frames] of [[2, 192], [12, 160], [3, 160], [11, 800]]) {
      processor._applySettings({ ...common, stages }, false);
      const block = new Float32Array(frames);
      processor.process([], [[block]]);
      rendered.push(...block);
    }
    let maximumStep = 0;
    for (let index = 1; index < rendered.length; index += 1) {
      maximumStep = Math.max(maximumStep, Math.abs(rendered[index] - rendered[index - 1]));
    }
    assert.ok(rendered.every(Number.isFinite));
    assert.ok(rendered.every((sample) => Math.abs(sample) <= 1));
    assert.ok(maximumStep < 0.12, `stage changes produced a ${maximumStep} sample step`);
  } finally {
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});

test("the worklet process loop is allocation-free", async () => {
  const source = await readFile(new URL("src/cascading-pm.js", ROOT), "utf8");
  const body = methodBody(source, "process(_inputs, outputs)");
  const applyBody = methodBody(source, "_applySettings(rawSettings, immediate = false)");
  assert.doesNotMatch(body, /\bnew\s+|Array\.from|\.(?:map|filter|reduce|slice)\(/);
  assert.doesNotMatch(
    applyBody,
    /\bnew\s+|Array\.from|\.(?:map|filter|reduce|slice)\(|deriveCascadeStack|sanitizeCascadingPmSettings/,
    "worklet settings messages must not allocate a frozen derivation ledger",
  );
  assert.match(source, /registerProcessor\(CASCADING_PM_PROCESSOR_NAME, CascadingPmProcessor\)/);
  assert.match(source, /this\._phases\[index\]\s*\+\s*this\._stageOutputs\[index - 1\]\s*\*\s*effectivePhaseIndex/s);
  assert.doesNotMatch(body, /\.frequency\b|depthHz/);
});

test("the audio owner is lazy and sends true-PM settings to its worklet", async () => {
  class Parameter {
    constructor(value = 0) { this.value = value; }
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
  }
  class Node {
    constructor() { this.connections = []; }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections.length = 0; }
  }
  class Context {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "suspended";
      this.destination = new Node();
      this.modules = [];
      this.audioWorklet = {
        addModule: async (url) => { this.modules.push(String(url)); },
      };
    }
    createBuffer() { return {}; }
    createBufferSource() {
      const node = new Node();
      node.start = () => {};
      node.buffer = null;
      node.onended = null;
      return node;
    }
    createGain() { const node = new Node(); node.gain = new Parameter(1); return node; }
    createDynamicsCompressor() {
      const node = new Node();
      for (const name of ["threshold", "knee", "ratio", "attack", "release"]) {
        node[name] = new Parameter();
      }
      return node;
    }
    createAnalyser() {
      const node = new Node();
      node.getByteTimeDomainData = (target) => target.fill(128);
      return node;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }
  const worklets = [];
  class Worklet extends Node {
    constructor(context, name, options) {
      super();
      this.context = context;
      this.name = name;
      this.options = options;
      this.messages = [];
      this.port = { postMessage: (message) => this.messages.push(message) };
      worklets.push(this);
    }
  }

  const runtime = {
    AudioContext: Context,
    AudioWorkletNode: Worklet,
    setTimeout: (callback) => callback(),
  };
  const engine = new CascadingPmAudioEngine(runtime);
  assert.equal(engine.context, null, "constructing the owner must not touch audio");
  const settings = CASCADING_PM_PRESETS[3].settings;
  await engine.start(settings, 0.43);
  assert.equal(engine.running, true);
  assert.equal(worklets.length, 1);
  assert.equal(worklets[0].name, CASCADING_PM_PROCESSOR_NAME);
  assert.deepEqual(worklets[0].options.outputChannelCount, [1]);
  assert.deepEqual(worklets[0].options.processorOptions, { settings });
  assert.match(engine.context.modules[0], /\/src\/cascading-pm\.js$/);
  assert.deepEqual(worklets[0].messages.at(-1), {
    type: "settings",
    settings: sanitizeCascadingPmSettings(settings),
    immediate: true,
  });
  await engine.stop({ immediate: true });
  assert.equal(engine.context, null);
  assert.equal(engine.running, false);
});

test("the page explains phase—not frequency—modulation and exposes the parallel UI", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("cascading-pm.html", ROOT), "utf8"),
    readFile(new URL("cascading-pm-app.js", ROOT), "utf8"),
  ]);
  assert.match(html, /<h1[^>]*>Cascading PM<\/h1>/);
  assert.match(html, /id="stages"[^>]*max="12"/);
  assert.match(html, /id="phaseIndex"/);
  assert.match(html, /id="indexTaper"/);
  assert.match(html, /phase index in radians/i);
  assert.match(html, /offsets phase, not oscillator frequency/i);
  assert.match(html, /id="cascadeSafetyNote"/);
  assert.match(html, /×0\.25 to ×200/i);
  assert.match(html, /focused logarithmic · 40% of the track covers ×1 to ×5[^<]*extended range ×0\.25 to ×200/i);
  const defaultRatioPosition = ratioSliderPosition(
    CASCADING_PM_PRESETS.find(({ id }) => id === DEFAULT_CASCADING_PM_PRESET_ID)
      .settings.cascadeRatio,
  ).toFixed(4);
  assert.match(
    html,
    new RegExp(`id="cascadeRatio"[\\s\\S]*?value="${defaultRatioPosition}"[\\s\\S]*?aria-describedby="cascadeRatioNote"`),
    "the static ratio thumb should match the default preset mapping",
  );
  assert.doesNotMatch(html, /center ×1|unity detent at center/i);
  assert.match(html, /below 1 descends, above 1 rises/i);
  assert.match(html, /data-reset-all data-reset-in-place/);
  assert.match(app, /new CascadingPmAudioEngine\(window\)/);
  assert.match(app, /sᵢ = sin\(φᵢ \+ Iᵢsᵢ₋₁\)/);
  assert.match(app, /INDEX = PHASE OFFSET IN RADIANS/);
  assert.match(app, /stack\.boundedByBandwidth/);
  assert.match(app, /Safety guard active/);
  const manualInputHandler = app.match(
    /for \(const \[key, control\] of Object\.entries\(controls\)\) \{\s*control\.input\.addEventListener\("input",[\s\S]*?\n\}/,
  );
  assert.ok(manualInputHandler, "missing manual control input handler");
  assert.match(
    manualInputHandler[0],
    /if \(key === "stages"\)[\s\S]*?cascadeRatioForStageCount\([\s\S]*?\{ syncControls: true \}\);[\s\S]*?return;/,
    "stage changes should preserve the final carrier and move the ratio thumb",
  );
  const nonStageInputPath = manualInputHandler[0].slice(
    manualInputHandler[0].indexOf("return;") + "return;".length,
  );
  assert.match(nonStageInputPath, /applySettings\(\{ \.\.\.state\.settings, \[key\]: value \}\)/);
  assert.doesNotMatch(nonStageInputPath, /syncControls|writeControlsFromState/);
  assert.doesNotMatch(app, /\.connect\([^\n]*\.frequency\)/);
  assert.doesNotMatch(`${html}\n${app}`, /mod(?:ulation)? depth[^\n]*kHz/i);
  assert.match(app, /pagehide/);
  assert.match(app, /audioState[^\n]*(?:"on"|"off")/);
});
