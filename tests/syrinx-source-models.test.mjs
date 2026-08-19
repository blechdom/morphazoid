import assert from "node:assert/strict";
import test from "node:test";

import {
  SYRINX_ANIMAL_PRESETS,
  SYRINX_SOURCE_DEFAULTS,
  SYRINX_SOURCE_EXAMPLES,
  SYRINX_SOURCE_MODEL_IDS,
  SyrinxSourceEngine,
  createSyrinxSourceEngine,
  mapSyrinxSourceControls,
  sanitizeSyrinxSourceParameters,
  syrinxAnimalPreset,
  syrinxSourceExample,
  syrinxSourceModelId,
} from "../src/syrinx-source-models.js";

function peak(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

function rms(values) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / Math.max(1, values.length));
}

function renderSeconds(source, seconds, block = new Float32Array(512)) {
  const blockCount = Math.ceil(source.sampleRate * seconds / block.length);
  for (let index = 0; index < blockCount; index += 1) source.renderBlock(block);
  return block;
}

test("Syrinx exposes physical source families and compatibility examples", () => {
  assert.deepEqual(SYRINX_SOURCE_MODEL_IDS, {
    TWO_MASS: "twoMass",
    SYRINX: "syrinx",
    FROG: "frog",
    WHISTLE: "whistle",
  });
  assert.deepEqual(Object.keys(SYRINX_ANIMAL_PRESETS), [
    "wolf",
    "lion",
    "cat",
    "canary",
    "raven",
    "bullfrog",
    "mouse",
  ]);
  assert.equal(SYRINX_ANIMAL_PRESETS.wolf.parameters.model, "twoMass");
  assert.equal(SYRINX_ANIMAL_PRESETS.canary.parameters.model, "syrinx");
  assert.equal(SYRINX_ANIMAL_PRESETS.bullfrog.parameters.model, "frog");
  assert.equal(SYRINX_ANIMAL_PRESETS.mouse.parameters.model, "whistle");
  assert.equal(Object.isFrozen(SYRINX_ANIMAL_PRESETS.lion.parameters), true);
  assert.equal(
    SYRINX_ANIMAL_PRESETS,
    SYRINX_SOURCE_EXAMPLES,
    "the old animal-preset name remains only as a compatibility alias",
  );

  const copy = syrinxAnimalPreset("canary");
  copy.parameters.frequencyHz = 440;
  assert.notEqual(copy.parameters.frequencyHz, SYRINX_ANIMAL_PRESETS.canary.parameters.frequencyHz);
  assert.equal(syrinxAnimalPreset("missing").id, "wolf");
  assert.deepEqual(syrinxSourceExample("canary"), syrinxAnimalPreset("canary"));
});

test("source aliases and hostile saved parameters sanitize to finite bounds", () => {
  assert.equal(syrinxSourceModelId("mammal"), "twoMass");
  assert.equal(syrinxSourceModelId("BIRD"), "syrinx");
  assert.equal(syrinxSourceModelId("anuran"), "frog");
  assert.equal(syrinxSourceModelId("USV"), "whistle");
  assert.equal(syrinxSourceModelId("unknown"), "twoMass");

  const parameters = sanitizeSyrinxSourceParameters({
    sourceModel: "rodent",
    pitchHz: Infinity,
    intensity: -9,
    tension: 4,
    closure: -1,
    breath: NaN,
    roughness: 7,
    asymmetry: -12,
    pulseRateHz: 99_999,
    coupling: -4,
    balance: 3,
    feedback: 8,
    output: 99,
  }, 16_000);
  assert.deepEqual(parameters, {
    model: "whistle",
    frequencyHz: 3_360,
    pressure: 0,
    tension: 1,
    adduction: 0,
    sourceScale: 0.5,
    breath: SYRINX_SOURCE_DEFAULTS.whistle.breath,
    roughness: 1,
    asymmetry: -1,
    pulseRateHz: 250,
    coupling: 0,
    sourceBalance: 1,
    feedback: 1,
    outputGain: 1.5,
  });
});

test("normalized controls map pitch logarithmically and bipolar knobs around center", () => {
  const low = mapSyrinxSourceControls("twoMass", {
    pitch: 0,
    asymmetry: 0,
    balance: 0.5,
    sourceScale: 0.2,
  });
  const middle = mapSyrinxSourceControls("twoMass", {
    pitch: 0.5,
    asymmetry: 0.5,
    balance: 0.5,
  });
  const high = mapSyrinxSourceControls("twoMass", {
    pitch: 1,
    asymmetry: 1,
    balance: 0.5,
  });
  assert.equal(low.frequencyHz, 5);
  assert.equal(high.frequencyHz, 2_400);
  assert.ok(Math.abs(middle.frequencyHz - Math.sqrt(5 * 2_400)) < 1e-9);
  assert.equal(low.asymmetry, -1);
  assert.equal(middle.asymmetry, 0);
  assert.equal(high.asymmetry, 1);
  assert.equal(middle.sourceBalance, 0);
  assert.equal(low.sourceScale, 0.2);
});

test("every source model renders a nonzero, finite, bounded deterministic block", () => {
  for (const model of Object.values(SYRINX_SOURCE_MODEL_IDS)) {
    const first = createSyrinxSourceEngine({ sampleRate: 48_000, model, seed: 12345 });
    const second = createSyrinxSourceEngine({ sampleRate: 48_000, model, seed: 12345 });
    const firstOutput = new Float32Array(16_384);
    const secondOutput = new Float32Array(16_384);
    first.renderBlock(firstOutput);
    second.renderBlock(secondOutput);
    assert.deepEqual(firstOutput, secondOutput, `${model} should reproduce the same seed`);
    assert.ok(rms(firstOutput.subarray(4_096)) > 0.00001, `${model} should self-excite`);
    assert.ok(peak(firstOutput) <= 1.5, `${model} should respect the output ceiling`);
    assert.ok(firstOutput.every(Number.isFinite), `${model} should stay finite`);
    assert.equal(first.diagnostics().finite, true);
  }
});

test("constructor infers a source family from a full animal parameter object", () => {
  const source = new SyrinxSourceEngine({
    parameters: SYRINX_ANIMAL_PRESETS.canary.parameters,
  });
  assert.equal(source.diagnostics().model, "syrinx");
});

test("block boundaries do not alter deterministic source state", () => {
  const whole = new SyrinxSourceEngine({
    sampleRate: 48_000,
    model: "syrinx",
    parameters: SYRINX_ANIMAL_PRESETS.raven.parameters,
    seed: 73,
  });
  const split = new SyrinxSourceEngine({
    sampleRate: 48_000,
    model: "syrinx",
    parameters: SYRINX_ANIMAL_PRESETS.raven.parameters,
    seed: 73,
  });
  const wholeOutput = new Float32Array(1_024);
  const firstHalf = new Float32Array(512);
  const secondHalf = new Float32Array(512);
  whole.renderBlock(wholeOutput);
  split.renderBlock(firstHalf);
  split.renderBlock(secondHalf);
  assert.deepEqual(wholeOutput.subarray(0, 512), firstHalf);
  assert.deepEqual(wholeOutput.subarray(512), secondHalf);
});

test("reset reproduces noise and oscillator state exactly", () => {
  const source = new SyrinxSourceEngine({
    model: "frog",
    parameters: SYRINX_ANIMAL_PRESETS.bullfrog.parameters,
    seed: 909,
  });
  const before = new Float32Array(4_096);
  const after = new Float32Array(4_096);
  source.renderBlock(before);
  source.reset(909).renderBlock(after);
  assert.deepEqual(after, before);
});

test("supraglottal pressure feedback reduces source energy", () => {
  const open = new SyrinxSourceEngine({
    model: "twoMass",
    parameters: { ...SYRINX_ANIMAL_PRESETS.wolf.parameters, feedback: 1 },
    seed: 8,
  });
  const loaded = new SyrinxSourceEngine({
    model: "twoMass",
    parameters: { ...SYRINX_ANIMAL_PRESETS.wolf.parameters, feedback: 1 },
    seed: 8,
  });
  const openOutput = new Float32Array(24_000);
  const loadedOutput = new Float32Array(24_000);
  open.renderBlock(openOutput, undefined, 0);
  loaded.renderBlock(loadedOutput, undefined, 0.9);
  assert.ok(rms(openOutput.subarray(8_000)) > rms(loadedOutput.subarray(8_000)) * 2);
});

test("whistle tension uses hysteresis for discrete jet-mode transitions", () => {
  const source = new SyrinxSourceEngine({ model: "whistle", seed: 4 });
  assert.equal(source.diagnostics().whistleMode, 1);
  source.renderBlock(new Float32Array(4_096), { tension: 1 });
  assert.equal(source.diagnostics().whistleMode, 2);
  source.renderBlock(new Float32Array(64), { tension: 0.62 });
  assert.equal(source.diagnostics().whistleMode, 2, "the upper mode holds inside its hysteresis band");
  source.renderBlock(new Float32Array(4_096), { tension: 0 });
  assert.equal(source.diagnostics().whistleMode, 0);
});

test("mammal source retains two coupled tissue masses and Bernoulli flow", () => {
  const source = new SyrinxSourceEngine({
    sampleRate: 48_000,
    model: "twoMass",
    parameters: {
      ...SYRINX_SOURCE_EXAMPLES.wolf.parameters,
      breath: 0,
      sourceScale: 0.8,
    },
    seed: 18,
  });
  renderSeconds(source, 0.45);
  const diagnostics = source.diagnostics();
  assert.equal(diagnostics.twoMassState.length, 4);
  assert.ok(diagnostics.twoMassState.every(Number.isFinite));
  assert.notEqual(diagnostics.twoMassState[0], diagnostics.twoMassState[2]);
  assert.notEqual(diagnostics.twoMassState[1], diagnostics.twoMassState[3]);
  assert.ok(diagnostics.glottalFlow >= 0);
  assert.equal(diagnostics.parameters.sourceScale, 0.8);
});

test("the bilateral bird normal forms remain distinct and expose their difference", () => {
  const source = new SyrinxSourceEngine({
    sampleRate: 96_000,
    model: "syrinx",
    parameters: {
      ...SYRINX_SOURCE_EXAMPLES.canary.parameters,
      asymmetry: 0.42,
      sourceBalance: -0.3,
      breath: 0,
    },
    seed: 72,
  });
  let maximumDifference = 0;
  for (let index = 0; index < 48_000; index += 1) {
    source.renderSample();
    maximumDifference = Math.max(maximumDifference, Math.abs(source.bilateralDifference));
  }
  const diagnostics = source.diagnostics();
  assert.equal(diagnostics.birdState.length, 4);
  assert.ok(diagnostics.birdState.every(Number.isFinite));
  assert.notDeepEqual(diagnostics.birdState.slice(0, 2), diagnostics.birdState.slice(2));
  assert.ok(maximumDifference > 0.001);

  source.setParameters({ model: "frog" });
  source.renderSample();
  assert.equal(source.bilateralDifference, 0, "non-bird sources must not leak stale stereo state");
});

test("frog membrane self-oscillates above threshold while call rate modulates pressure", () => {
  const source = new SyrinxSourceEngine({
    sampleRate: 48_000,
    model: "frog",
    parameters: {
      ...SYRINX_SOURCE_EXAMPLES.bullfrog.parameters,
      frequencyHz: 220,
      pulseRateHz: 19,
      coupling: 0.72,
      breath: 0,
    },
    seed: 82,
  });
  renderSeconds(source, 0.25);
  let minimumPressure = 1;
  let maximumPressure = 0;
  let zeroCrossings = 0;
  let previous = source.renderSample();
  for (let index = 0; index < 24_000; index += 1) {
    const sample = source.renderSample();
    const pressure = source.frogDrivingPressure;
    minimumPressure = Math.min(minimumPressure, pressure);
    maximumPressure = Math.max(maximumPressure, pressure);
    if (previous < 0 && sample >= 0) zeroCrossings += 1;
    previous = sample;
  }
  assert.ok(maximumPressure - minimumPressure > 0.2);
  assert.ok(
    zeroCrossings > 50,
    "the acoustic carrier must be the self-oscillating membrane, not the 19 Hz call clock",
  );
  assert.ok(source.diagnostics().frogState.every(Number.isFinite));
});

test("frog membrane irregularity changes the physical oscillator state", () => {
  const regular = new SyrinxSourceEngine({
    model: "frog",
    parameters: { pressure: 0.82, roughness: 0.18, asymmetry: 0 },
    seed: 406,
  });
  const irregular = new SyrinxSourceEngine({
    model: "frog",
    parameters: { pressure: 0.82, roughness: 0.18, asymmetry: 0.7 },
    seed: 406,
  });
  regular.renderBlock(new Float32Array(24_000));
  irregular.renderBlock(new Float32Array(24_000));
  assert.notDeepEqual(
    regular.diagnostics().frogState,
    irregular.diagnostics().frogState,
  );
});

test("rodent whistle pitch follows jet speed, impingement length, and Strouhal mode", () => {
  const source = new SyrinxSourceEngine({
    sampleRate: 96_000,
    model: "whistle",
    parameters: {
      frequencyHz: 8_000,
      pressure: 0.62,
      tension: 0.5,
      sourceScale: 0.5,
      adduction: 0.25,
      asymmetry: 0,
      roughness: 0,
      breath: 0,
    },
    seed: 12,
  });
  renderSeconds(source, 0.25);
  const diagnostics = source.diagnostics();
  const predicted = diagnostics.strouhalNumber
    * diagnostics.jetSpeedMps
    / diagnostics.impingementLengthM;
  assert.ok(Math.abs(diagnostics.whistleFrequencyHz - predicted) < 1e-9);
  assert.ok(diagnostics.jetSpeedMps > 0);
  assert.ok(diagnostics.impingementLengthM > 0.0001);
  assert.ok(diagnostics.impingementLengthM < 0.0061);
});

test("signed tract feedback opposes compression and admits rarefaction", () => {
  const parameters = {
    ...SYRINX_SOURCE_EXAMPLES.wolf.parameters,
    feedback: 1,
    breath: 0,
  };
  const compressed = new SyrinxSourceEngine({ model: "twoMass", parameters, seed: 14 });
  const rarefied = new SyrinxSourceEngine({ model: "twoMass", parameters, seed: 14 });
  const compressedOutput = new Float32Array(24_000);
  const rarefiedOutput = new Float32Array(24_000);
  compressed.renderBlock(compressedOutput, undefined, 0.45);
  rarefied.renderBlock(rarefiedOutput, undefined, -0.45);
  assert.ok(
    rms(rarefiedOutput.subarray(8_000)) > rms(compressedOutput.subarray(8_000)),
  );
});

test("sample-rate-derived DC rejection preserves elephant fundamentals", () => {
  for (const sampleRate of [48_000, 96_000]) {
    const source = new SyrinxSourceEngine({
      sampleRate,
      model: "twoMass",
      parameters: {
        frequencyHz: 16.4,
        pressure: 0.82,
        tension: 0.24,
        adduction: 0.78,
        sourceScale: 0.92,
        roughness: 0.3,
        breath: 0,
      },
      seed: 31,
    });
    const output = new Float32Array(Math.round(sampleRate * 1.25));
    source.renderBlock(output);
    const diagnostics = source.diagnostics();
    assert.equal(diagnostics.dcBlockerCutoffHz, 4);
    assert.ok(diagnostics.dcBlockerPole > 0.999);
    for (const frequencyHz of [5, 16.4, 22, 42, 58]) {
      const angle = Math.PI * 2 * frequencyHz / sampleRate;
      const numerator = Math.hypot(1 - Math.cos(angle), Math.sin(angle));
      const denominator = Math.hypot(
        1 - diagnostics.dcBlockerPole * Math.cos(angle),
        diagnostics.dcBlockerPole * Math.sin(angle),
      );
      const magnitude = numerator / denominator;
      assert.ok(
        magnitude > (frequencyHz === 5 ? 0.75 : 0.96),
        `${frequencyHz} Hz should survive the ${sampleRate} Hz DC blocker`,
      );
    }
    assert.ok(rms(output.subarray(Math.round(sampleRate * 0.5))) > 0.001);
  }
});

test("source frequencies retain margin for the worklet's 2:1 decimation", () => {
  for (const sampleRate of [8_000, 48_000, 96_000, 192_000]) {
    const parameters = sanitizeSyrinxSourceParameters({
      model: "whistle",
      frequencyHz: Number.MAX_VALUE,
      pressure: 1,
      tension: 1,
      sourceScale: 0,
      roughness: 1,
    }, sampleRate);
    assert.ok(parameters.frequencyHz <= sampleRate * 0.21 + 1e-9);
    const source = new SyrinxSourceEngine({ sampleRate, parameters, seed: 99 });
    const output = new Float32Array(2_048);
    source.renderBlock(output);
    assert.ok(output.every(Number.isFinite));
    assert.ok(source.diagnostics().whistleFrequencyHz <= sampleRate * 0.21 + 1e-9);
  }
});

test("all source families restart after fifteen seconds at zero pressure", () => {
  // Use the engine's supported low-rate mode for the long wall-clock idle so
  // this regression does not starve unrelated browser smoke tests when the
  // full Node suite runs in parallel. Onset is checked at 96 kHz below.
  for (const sampleRate of [8_000]) {
    for (const model of Object.values(SYRINX_SOURCE_MODEL_IDS)) {
      const source = new SyrinxSourceEngine({ sampleRate, model, seed: 0x5151 });
      source.setParameters({ pressure: 0, breath: 0 });
      const idle = renderSeconds(source, 15);
      assert.ok(rms(idle) < 1e-8, `${model} at ${sampleRate} Hz should settle silent`);
      source.setParameters({
        pressure: SYRINX_SOURCE_DEFAULTS[model].pressure,
        breath: 0,
      });
      renderSeconds(source, 0.35);
      const active = new Float32Array(Math.round(sampleRate * 0.35));
      source.renderBlock(active);
      assert.ok(
        rms(active.subarray(Math.round(active.length * 0.35))) > 0.0001,
        `${model} at ${sampleRate} Hz must restart after exact-zero idle decay`,
      );
      assert.ok(active.every(Number.isFinite));
    }
  }
});

test("all source families restart from exact zero at the 96 kHz worklet rate", () => {
  for (const model of Object.values(SYRINX_SOURCE_MODEL_IDS)) {
    const source = new SyrinxSourceEngine({ sampleRate: 96_000, model, seed: 0x5151 });
    source.mammalX1 = 0;
    source.mammalV1 = 0;
    source.mammalX2 = 0;
    source.mammalV2 = 0;
    source.mammalFlow = 0;
    source.mammalPreviousFlow = 0;
    source.birdXLeft = 0;
    source.birdYLeft = 0;
    source.birdXRight = 0;
    source.birdYRight = 0;
    source.birdPreviousFlowLeft = 0;
    source.birdPreviousFlowRight = 0;
    source.frogMembraneX = 0;
    source.frogMembraneVelocity = 0;
    source.frogPreviousFlow = 0;
    source.whistleAmplitude = 0;
    const active = renderSeconds(source, 0.7);
    assert.ok(
      rms(active.subarray(Math.round(active.length * 0.5))) > 0.0001,
      `${model} must restart from an exact-zero state at 96 kHz`,
    );
    assert.ok(active.every(Number.isFinite));
  }
});

test("renderBlock accepts sample-rate feedback arrays and rejects missing output", () => {
  const source = new SyrinxSourceEngine({ model: "syrinx" });
  const output = new Float64Array(128);
  const feedback = Float32Array.from({ length: 128 }, (_, index) => index / 127);
  assert.equal(source.renderBlock(output, undefined, feedback), output);
  assert.ok(output.every(Number.isFinite));
  assert.throws(() => source.renderBlock(null), /writable array-like output/);
});
