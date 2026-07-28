import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { PHONEMES } from "../src/throatazoid.js";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const WORKLET_URL = new URL(
  "../src/throatazoid-tract-processor.js",
  import.meta.url,
);
const WORKLET_SOURCE = readFileSync(WORKLET_URL, "utf8");
let ProcessorConstructor;

class MockAudioWorkletProcessor {
  constructor() {
    const messages = [];
    this.messages = messages;
    this.port = {
      onmessage: null,
      start() {},
      close() {},
      postMessage(message) {
        messages.push(message);
      },
    };
  }
}

function processorClass() {
  if (ProcessorConstructor) return ProcessorConstructor;
  const registrations = new Map();
  const evaluateWorklet = vm.compileFunction(
    WORKLET_SOURCE,
    [
      "AudioWorkletProcessor",
      "registerProcessor",
      "sampleRate",
      "currentFrame",
      "currentTime",
    ],
    {
      filename: WORKLET_URL.pathname,
    },
  );
  evaluateWorklet(
    MockAudioWorkletProcessor,
    (name, Processor) => registrations.set(name, Processor),
    SAMPLE_RATE,
    0,
    0,
  );
  ProcessorConstructor = registrations.get("throatazoid-tract");
  assert.equal(
    typeof ProcessorConstructor,
    "function",
    "the tract worklet must register throatazoid-tract",
  );
  return ProcessorConstructor;
}

function loadProcessor() {
  const Processor = processorClass();
  return new Processor();
}

function pressureSources(openIndex = -1) {
  return Array.from({ length: 4 }, (_, index) => ({
    open: index === openIndex,
    level: 0.82 - index * 0.08,
  }));
}

function mouths(count = 7) {
  return Array.from({ length: count }, (_, index) => ({
    aperture: 0.68 + (index % 3) * 0.08,
    length: 0.35 + (index % 4) * 0.12,
    closed: false,
    muted: false,
  }));
}

function baseConfiguration(overrides = {}) {
  return {
    mouthCount: 3,
    throatCount: 3,
    selectedMouth: 0,
    articulateAll: true,
    bodyLength: 0.56,
    tension: 0.58,
    mutation: 0.3,
    coupling: 0.72,
    spread: 0.8,
    oralClosure: 0,
    articulationPlace: 0.48,
    articulationIndex: 26,
    articulationAperture: 0.92,
    articulationVoicing: 0.94,
    glottalClosure: 0,
    nasalCoupling: 0.16,
    exciterIntensity: 0.72,
    performanceGate: 1,
    pressureSourceCount: 4,
    pressureSources: pressureSources(0),
    tongueCount: 3,
    noseCount: 3,
    mouths: mouths(),
    throats: mouths(),
    tongues: Array.from({ length: 5 }, (_, index) => ({
      position: 0.2 + index * 0.14,
      height: 0.14 + (index % 3) * 0.16,
      curl: 0.25 + (index % 2) * 0.45,
    })),
    noses: Array.from({ length: 3 }, (_, index) => ({
      openness: 0.12 + index * 0.16,
      length: 0.38 + index * 0.18,
      resonance: 0.32 + index * 0.22,
    })),
    ...overrides,
  };
}

function configure(processor, state) {
  assert.equal(
    typeof processor.port?.onmessage,
    "function",
    "the worklet must accept configuration messages",
  );
  processor.port.onmessage({
    data: {
      type: "configure",
      state,
    },
  });
}

function signalSample(index, amplitude = 0.22) {
  const seconds = index / SAMPLE_RATE;
  return amplitude * (
    Math.sin(2 * Math.PI * 173 * seconds) * 0.58
    + Math.sin(2 * Math.PI * 811 * seconds + 0.37) * 0.27
    + Math.sin(2 * Math.PI * 3_203 * seconds + 1.1) * 0.15
  );
}

function assertFiniteBlock(left, right, label) {
  for (let index = 0; index < left.length; index += 1) {
    assert.ok(
      Number.isFinite(left[index]),
      `${label}: left output ${index} must be finite`,
    );
    assert.ok(
      Number.isFinite(right[index]),
      `${label}: right output ${index} must be finite`,
    );
  }
}

function runBlocks(
  processor,
  blockCount,
  {
    inputSample = signalSample,
    collectAfter = 0,
    captureBlocks = 0,
  } = {},
) {
  let frame = 0;
  let peak = 0;
  let squareSum = 0;
  let collectedSamples = 0;
  const samples = [];

  for (let block = 0; block < blockCount; block += 1) {
    const input = new Float32Array(BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      input[index] = inputSample(frame, block, index);
      frame += 1;
    }

    assert.equal(
      processor.process([[input]], [[left, right]]),
      true,
      "the worklet must stay alive",
    );
    assertFiniteBlock(left, right, `block ${block}`);

    if (captureBlocks > 0 && block >= blockCount - captureBlocks) {
      for (let index = 0; index < BLOCK_SIZE; index += 1) {
        samples.push(left[index], right[index]);
      }
    }
    if (block < collectAfter) continue;
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
      squareSum += left[index] ** 2 + right[index] ** 2;
      collectedSamples += 2;
    }
  }

  return {
    peak,
    rms: collectedSamples > 0
      ? Math.sqrt(squareSum / collectedSamples)
      : 0,
    samples,
  };
}

function runEightInputBlocks(
  processor,
  blockCount,
  inputSamples = Array.from({ length: 8 }, () => () => 0),
) {
  assert.equal(
    inputSamples.length,
    8,
    "the routed tract contract is one common input plus seven mouth inputs",
  );
  let frame = 0;
  let peak = 0;
  let squareSum = 0;
  let sampleCount = 0;

  for (let block = 0; block < blockCount; block += 1) {
    const inputs = Array.from(
      { length: 8 },
      (_, inputIndex) => {
        const channel = new Float32Array(BLOCK_SIZE);
        for (let sampleIndex = 0; sampleIndex < BLOCK_SIZE; sampleIndex += 1) {
          channel[sampleIndex] = inputSamples[inputIndex](
            frame + sampleIndex,
            block,
            sampleIndex,
          );
        }
        return [channel];
      },
    );
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    assert.equal(
      processor.process(inputs, [[left, right]]),
      true,
      "the eight-input worklet must stay alive",
    );
    assertFiniteBlock(left, right, `eight-input block ${block}`);
    for (let sampleIndex = 0; sampleIndex < BLOCK_SIZE; sampleIndex += 1) {
      peak = Math.max(peak, Math.abs(left[sampleIndex]), Math.abs(right[sampleIndex]));
      squareSum += left[sampleIndex] ** 2 + right[sampleIndex] ** 2;
      sampleCount += 2;
    }
    frame += BLOCK_SIZE;
  }

  return {
    peak,
    rms: sampleCount > 0 ? Math.sqrt(squareSum / sampleCount) : 0,
  };
}

function waveEnergy(value) {
  if (!value || typeof value !== "object") return 0;
  let energy = 0;
  for (const key of [
    "right",
    "left",
    "rightJunction",
    "leftJunction",
  ]) {
    const item = value[key];
    if (!ArrayBuffer.isView(item) || item instanceof DataView) continue;
    for (const sample of item) {
      if (typeof sample === "number") energy += sample * sample;
    }
  }
  return energy;
}

function assertFiniteState(value, label = "processor", seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    for (let index = 0; index < value.length; index += 1) {
      assert.ok(
        Number.isFinite(value[index]),
        `${label}[${index}] must be finite`,
      );
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "function") continue;
    assertFiniteState(child, `${label}.${key}`, seen);
  }
}

function pressureMessages(processor) {
  return processor.messages.filter((message) => message?.type === "pressure");
}

function lastPressureMessage(processor) {
  return pressureMessages(processor).at(-1);
}

function fillWaveArrays(airway, value = 0) {
  if (!airway) return;
  for (const key of [
    "right",
    "left",
    "rightJunction",
    "leftJunction",
    "noseRight",
    "noseLeft",
    "noseRightJunction",
    "noseLeftJunction",
  ]) {
    airway[key]?.fill?.(value);
  }
}

function signatureDistance(first, second) {
  assert.equal(first.length, second.length);
  let difference = 0;
  let reference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference += (first[index] - second[index]) ** 2;
    reference += first[index] ** 2 + second[index] ** 2;
  }
  return Math.sqrt(difference / Math.max(1e-20, reference));
}

const VOWEL_KEYS = Object.freeze(["a", "e", "i", "o", "u"]);
const SPECTRAL_PERIOD = 8_192;
const SPECTRAL_CAPTURE_BLOCKS = SPECTRAL_PERIOD / BLOCK_SIZE;
const SPECTRAL_BINS = Object.freeze(
  Array.from({ length: 50 }, (_, index) => 17 * (index + 1)),
);
const SPECTRAL_PHASES = Object.freeze(
  SPECTRAL_BINS.map(
    (_, index) => Math.PI * index * (index + 1) / SPECTRAL_BINS.length,
  ),
);

function vowelConfiguration(key, overrides = {}) {
  const vowel = PHONEMES[key];
  assert.equal(vowel?.kind, "vowel", `${key} must name a calibrated vowel`);
  return baseConfiguration({
    mouthCount: 1,
    throatCount: 1,
    bodyLength: 0.55,
    mutation: 0,
    coupling: 0,
    oralClosure: 0,
    lipDiameter: vowel.lipDiameter,
    articulationAperture: 1,
    articulationIndex: 26,
    articulationVoicing: 0.94,
    tongueCount: 1,
    noseCount: 1,
    tongues: vowel.tongues.map((tongue) => ({ ...tongue })),
    noses: vowel.noses.map((nose) => ({ ...nose })),
    mouths: [{ aperture: 1, length: 0.56, closed: false }],
    throats: [{ aperture: 1, length: 0.56, muted: false }],
    pressureSourceCount: 1,
    pressureSources: pressureSources(0),
    ...overrides,
  });
}

function spectralMultisine(frame) {
  const periodFrame = frame % SPECTRAL_PERIOD;
  let sample = 0;
  for (let index = 0; index < SPECTRAL_BINS.length; index += 1) {
    sample += Math.sin(
      2 * Math.PI * SPECTRAL_BINS[index] * periodFrame / SPECTRAL_PERIOD
        + SPECTRAL_PHASES[index],
    );
  }
  return sample * 0.0014;
}

function logarithmicBinMagnitude(samples, bin) {
  assert.equal(samples.length, SPECTRAL_PERIOD);
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const phase = 2 * Math.PI * bin * index / samples.length;
    real += samples[index] * Math.cos(phase);
    imaginary -= samples[index] * Math.sin(phase);
  }
  return 20 * Math.log10(
    Math.max(1e-12, Math.hypot(real, imaginary) / samples.length),
  );
}

function vowelSpectralSignature(key) {
  const processor = loadProcessor();
  configure(processor, vowelConfiguration(key, { classicTopology: true }));
  const rendered = runBlocks(processor, SPECTRAL_CAPTURE_BLOCKS * 5, {
    inputSample: spectralMultisine,
    captureBlocks: SPECTRAL_CAPTURE_BLOCKS,
  });
  const left = rendered.samples.filter((_, index) => index % 2 === 0);
  assert.equal(left.length, SPECTRAL_PERIOD);
  return SPECTRAL_BINS.map((bin) => logarithmicBinMagnitude(left, bin));
}

function normalizedLogSpectralDistance(first, second) {
  assert.equal(first.length, second.length);
  const meanDifference = first.reduce(
    (sum, value, index) => sum + value - second[index],
    0,
  ) / first.length;
  const squareDifference = first.reduce(
    (sum, value, index) => (
      sum + (value - second[index] - meanDifference) ** 2
    ),
    0,
  );
  return Math.sqrt(squareDifference / first.length);
}

test("calibrated vowels carve distinct physical tracts, including O and U lips", () => {
  const rendered = new Map();
  const lipDiameters = new Map();

  for (const key of VOWEL_KEYS) {
    const vowel = PHONEMES[key];
    const processor = loadProcessor();
    configure(processor, vowelConfiguration(key));

    const mouth = processor.mouths[0];
    const tongueIndex = 12.9 + vowel.tongues[0].position * 17.5;
    const localTongueIndex = Math.round(tongueIndex) - 8;
    assert.ok(
      mouth.targetDiameter[localTongueIndex] < 1.6,
      `${key.toUpperCase()} must deform its requested tongue region`,
    );
    assert.ok(
      Math.max(...mouth.targetDiameter.slice(2, 31)) > 1.65,
      `${key.toUpperCase()} must preserve a widened tongue cavity, not only constrictions`,
    );
    lipDiameters.set(key, mouth.targetDiameter[41 - 8]);

    const result = runBlocks(processor, 190, {
      collectAfter: 64,
      captureBlocks: 6,
    });
    assert.ok(result.rms > 1e-5, `${key.toUpperCase()} must reach the output`);
    rendered.set(key, result.samples);
  }

  assert.ok(
    lipDiameters.get("o") < lipDiameters.get("a") * 0.8,
    "O needs an independent rounded-lip constriction",
  );
  assert.ok(
    lipDiameters.get("u") < lipDiameters.get("o"),
    "U needs tighter lips than O",
  );

  for (const [first, second] of [
    ["a", "e"],
    ["e", "i"],
    ["i", "o"],
    ["o", "u"],
    ["a", "u"],
  ]) {
    assert.ok(
      signatureDistance(rendered.get(first), rendered.get(second)) > 0.01,
      `${first.toUpperCase()} and ${second.toUpperCase()} need distinct physical output`,
    );
  }
});

test("signed alien height lobes reach the physical airway target", () => {
  const configuration = vowelConfiguration("a", {
    mutation: 0.72,
    articulationAperture: 1,
  });
  const baselineProcessor = loadProcessor();
  configure(baselineProcessor, configuration);
  const alienProcessor = loadProcessor();
  configure(alienProcessor, {
    ...configuration,
    tractDeformations: [
      { center: 20, radius: 3, height: -0.72, strength: 1 },
      { center: 31, radius: 3, height: 0.58, strength: 1 },
    ],
  });
  const baseline = baselineProcessor.mouths[0].targetDiameter;
  const alien = alienProcessor.mouths[0].targetDiameter;
  assert.ok(alien[20 - 8] < baseline[20 - 8] - 0.7);
  assert.ok(alien[31 - 8] > baseline[31 - 8] + 0.56);
  for (const diameter of alien) {
    assert.ok(Number.isFinite(diameter));
    assert.ok(diameter >= 0.001 && diameter <= 4);
  }
});

test("single-mouth resonance is invariant to cross-mouth coupling", () => {
  const rendered = new Map();
  for (const coupling of [0, 0.72]) {
    const processor = loadProcessor();
    configure(processor, vowelConfiguration("a", { coupling }));
    rendered.set(
      coupling,
      runBlocks(processor, 190, {
        collectAfter: 64,
        captureBlocks: 6,
      }).samples,
    );
  }

  const distance = signatureDistance(rendered.get(0), rendered.get(0.72));
  assert.ok(
    distance < 1e-6,
    `one mouth has nothing to cross-couple, but coupling changed it by ${distance}`,
  );
});

test("the playable default still obeys its pressure-source gate", () => {
  const processor = loadProcessor();
  configure(processor, vowelConfiguration("a", {
    classicTopology: true,
    pressureSources: pressureSources(-1),
  }));
  const result = runBlocks(processor, 120);
  assert.ok(
    result.peak < 1e-7,
    "closing P1 must silence the direct classic glottal inlet",
  );
});

test("calibrated vowels remain separated across the rendered spectrum", () => {
  const signatures = new Map(
    VOWEL_KEYS.map((key) => [key, vowelSpectralSignature(key)]),
  );
  for (const [first, second] of [
    ["a", "e"],
    ["e", "i"],
    ["i", "o"],
    ["o", "u"],
  ]) {
    const distance = normalizedLogSpectralDistance(
      signatures.get(first),
      signatures.get(second),
    );
    assert.ok(
      distance >= 7.5,
      `${first.toUpperCase()}/${second.toUpperCase()} spectral separation `
        + `must be at least 7.5 dB; received ${distance.toFixed(2)} dB`,
    );
  }

  const span = normalizedLogSpectralDistance(
    signatures.get("a"),
    signatures.get("u"),
  );
  assert.ok(
    span >= 9.5,
    `A/U vowel-space span must be at least 9.5 dB; received ${span.toFixed(2)} dB`,
  );
});

test("a direct mouth input excites its airway with a silent common input", () => {
  const processor = loadProcessor();
  configure(processor, baseConfiguration({
    mouthCount: 4,
    throatCount: 4,
    pressureSources: pressureSources(-1),
  }));
  const inputs = Array.from({ length: 8 }, () => () => 0);
  inputs[4] = (frame) => signalSample(frame, 0.24);

  const result = runEightInputBlocks(processor, 160, inputs);
  assert.ok(
    result.rms > 1e-5,
    "mouth input four must be audible even when the shared input is silent",
  );
  assert.ok(result.peak <= 1.000001, "direct mouth excitation must remain bounded");
  assert.ok(
    waveEnergy(processor.mouths[3]) > 1e-10,
    "input port four must energize mouth airway four",
  );
  assertFiniteState(processor);
});

test("performance gate silences every direct mouth input", () => {
  const processor = loadProcessor();
  configure(processor, baseConfiguration({
    mouthCount: 7,
    throatCount: 7,
    performanceGate: 0,
    pressureSources: pressureSources(-1),
  }));
  const inputs = Array.from(
    { length: 8 },
    (_, inputIndex) => (
      inputIndex === 0
        ? () => 0
        : (frame) => signalSample(frame + inputIndex * 31, 0.38)
    ),
  );

  const result = runEightInputBlocks(processor, 96, inputs);
  assert.ok(result.peak < 1e-7, "performanceGate=0 must silence all eight inputs");
  assert.ok(
    processor.mouths.every((mouth) => waveEnergy(mouth) < 1e-12),
    "gated direct voices must not accumulate hidden airway energy",
  );
  assertFiniteState(processor);
});

test("seven simultaneous direct mouth voices remain finite and bounded", () => {
  const processor = loadProcessor();
  configure(processor, baseConfiguration({
    mouthCount: 7,
    throatCount: 7,
    coupling: 0.72,
    pressureSources: pressureSources(-1),
  }));
  const inputs = Array.from(
    { length: 8 },
    (_, inputIndex) => {
      if (inputIndex === 0) return () => 0;
      const frequency = 82 * Math.pow(2, (inputIndex - 1) * 5 / 12);
      return (frame) => (
        Math.sin(2 * Math.PI * frequency * frame / SAMPLE_RATE + inputIndex * 0.37)
        * 0.34
      );
    },
  );

  const result = runEightInputBlocks(processor, 360, inputs);
  assert.ok(result.rms > 1e-5, "the seven-mouth voice bank must reach the output");
  assert.ok(result.peak <= 1.000001, "simultaneous mouth voices must remain bounded");
  assert.ok(
    processor.mouths.every((mouth) => waveEnergy(mouth) > 1e-10),
    "each active direct voice must energize its assigned mouth",
  );
  assertFiniteState(processor);
});

test("tract worklet remains finite under sustained coupled excitation", () => {
  const processor = loadProcessor();
  configure(processor, baseConfiguration({
    mouthCount: 5,
    throatCount: 5,
    articulationAperture: 0.42,
    nasalCoupling: 0.48,
    pressureSources: Array.from({ length: 4 }, (_, index) => ({
      open: true,
      level: 0.84 - index * 0.1,
    })),
  }));

  const result = runBlocks(processor, 480, { collectAfter: 80 });
  assert.ok(result.rms > 1e-5, "sustained excitation must reach the output");
  assert.ok(result.peak <= 1.000001, "the worklet output must remain bounded");
  assertFiniteState(processor);
});

test("closing all pressure sources keeps a sealed tract silent and unpressurized", () => {
  const processor = loadProcessor();
  configure(processor, baseConfiguration({
    mouthCount: 2,
    throatCount: 2,
    oralClosure: 1,
    articulationAperture: 0,
    exciterIntensity: 0,
    pressureSources: pressureSources(-1),
  }));

  const result = runBlocks(processor, 72, {
    inputSample: (frame) => signalSample(frame, 0.45),
  });
  assert.ok(result.peak < 1e-7, "closed glands must not leak excitation");
  assert.ok(
    waveEnergy(processor.root ?? processor.rootAirway) < 1e-12,
    "the root must retain zero wave energy when every gland is closed",
  );

  const report = lastPressureMessage(processor);
  assert.ok(report, "the worklet must publish a pressure report");
  assert.ok(
    Array.from(report.sources ?? []).every((value) => Math.abs(value) < 1e-7),
    "every closed source must report zero pressure",
  );
  assert.ok(
    Array.from(report.mouths ?? []).every((value) => Math.abs(value) < 1e-7),
    "a silent sealed mouth must not accumulate synthetic pressure",
  );
  assert.ok(Math.abs(report.value ?? 0) < 1e-7, "root pressure must remain zero");
});

test("each pressure-source gate independently excites the root and output", () => {
  for (let sourceIndex = 0; sourceIndex < 4; sourceIndex += 1) {
    const processor = loadProcessor();
    configure(processor, baseConfiguration({
      mouthCount: 1,
      throatCount: 1,
      pressureSources: pressureSources(sourceIndex),
    }));

    const result = runBlocks(processor, 140, { collectAfter: 48 });
    assert.ok(
      result.rms > 1e-5,
      `pressure source ${sourceIndex + 1} must reach the output`,
    );
    assert.ok(
      waveEnergy(processor.root ?? processor.rootAirway) > 1e-10,
      `pressure source ${sourceIndex + 1} must energize the root airway`,
    );

    const glands = processor.glands ?? processor.pressureGlands;
    if (Array.isArray(glands)) {
      assert.ok(
        glands[sourceIndex].targetValve > 0.5
          && glands[sourceIndex].valve > 0.5,
        `pressure source ${sourceIndex + 1} must open its own valve`,
      );
      for (let index = 0; index < 4; index += 1) {
        if (index === sourceIndex) continue;
        assert.ok(
          glands[index].targetValve < 1e-7
            && glands[index].valve < 1e-7,
          `closed pressure source ${index + 1} must not inject a drive`,
        );
      }
    }

    const report = lastPressureMessage(processor);
    assert.ok(report, "the worklet must publish source pressure");
    const sourceLevels = Array.from(report.sources ?? []);
    assert.ok(
      sourceLevels[sourceIndex] > 1e-4,
      `pressure source ${sourceIndex + 1} must report activity`,
    );
  }
});

test("the root glottis physically seals and reopens under excitation", () => {
  const processor = loadProcessor();
  const openConfig = baseConfiguration({
    mouthCount: 1,
    throatCount: 1,
    noseCount: 1,
    nasalCoupling: 0,
    noses: [{ openness: 0, length: 0.5, resonance: 0.5 }],
  });
  configure(processor, openConfig);
  runBlocks(processor, 18);
  const openDiameter = processor.root.diameter[0];

  configure(processor, {
    ...openConfig,
    glottalClosure: 1,
  });
  runBlocks(processor, 36);
  const sealedDiameter = processor.root.diameter[0];
  assert.ok(
    sealedDiameter < openDiameter * 0.08,
    "glottal closure must collapse the physical proximal root section",
  );
  assert.ok(
    processor.root.targetDiameter[0] < 0.005,
    "a sealed glottis must target a near-closed diameter",
  );

  configure(processor, openConfig);
  const reopened = runBlocks(processor, 36, { collectAfter: 12 });
  assert.ok(
    processor.root.diameter[0] > openDiameter * 0.75,
    "releasing the glottis must reopen the physical root section",
  );
  assert.ok(reopened.rms > 1e-5, "source flow must resume through the reopened glottis");
  assertFiniteState(processor);
});

test("K, T, and P stops store source pressure and release without silent ghost bursts", () => {
  const stops = [
    ["K", 22],
    ["T", 36],
    ["P", 41],
  ];

  for (const [label, articulationIndex] of stops) {
    const closedConfig = baseConfiguration({
      mouthCount: 1,
      throatCount: 1,
      oralClosure: 1,
      articulationAperture: 0,
      articulationIndex,
      noseCount: 1,
      nasalCoupling: 0,
      noses: [{ openness: 0, length: 0.5, resonance: 0.5 }],
    });
    const driven = loadProcessor();
    configure(driven, closedConfig);
    runBlocks(driven, 56, {
      inputSample: (frame) => signalSample(frame, 0.32),
    });
    const drivenMouth = driven.mouths[0];
    assert.ok(drivenMouth.actuallySealed, `${label} must form an actual tube seal`);
    assert.ok(
      drivenMouth.pressureEnergy > 1e-8,
      `${label} must store source-driven pressure behind its seal`,
    );
    assert.ok(
      Math.abs(drivenMouth.closureIndex - (articulationIndex - 8)) < 0.51,
      `${label} pressure must be stored at its requested tract place`,
    );

    configure(driven, {
      ...closedConfig,
      oralClosure: 0,
      articulationAperture: 1,
    });
    let drivenReleasePeak = 0;
    for (let block = 0; block < 12; block += 1) {
      drivenReleasePeak = Math.max(
        drivenReleasePeak,
        runBlocks(driven, 1, {
          inputSample: (frame) => signalSample(frame, 0.32),
        }).peak,
      );
    }
    assert.ok(
      drivenMouth.transientStrength > 1e-6,
      `${label} must create a pressure-scaled release transient`,
    );
    assert.ok(drivenReleasePeak > 1e-5, `${label} release must reach the output`);

    const silent = loadProcessor();
    configure(silent, {
      ...closedConfig,
      pressureSources: pressureSources(-1),
    });
    runBlocks(silent, 56, {
      inputSample: (frame) => signalSample(frame, 0.45),
    });
    const silentMouth = silent.mouths[0];
    assert.ok(
      silentMouth.pressureEnergy < 1e-12,
      `silent ${label} closure must not manufacture pressure`,
    );
    configure(silent, {
      ...closedConfig,
      oralClosure: 0,
      articulationAperture: 1,
      pressureSources: pressureSources(-1),
    });
    const silentRelease = runBlocks(silent, 12, {
      inputSample: (frame) => signalSample(frame, 0.45),
    });
    assert.ok(
      silentMouth.transientStrength < 1e-12,
      `silent ${label} release must not manufacture a burst`,
    );
    assert.ok(silentRelease.peak < 1e-7, `silent ${label} release must remain silent`);
  }
});

test("K/T/P/S/SH/F tract places produce nonzero, place-distinct frication", () => {
  const styleIndices = {
    K: 22,
    T: 36,
    P: 41,
    S: 36,
    SH: 31,
    F: 41,
  };
  const signatures = new Map();
  const injectionSites = new Set();

  for (const articulationIndex of new Set(Object.values(styleIndices))) {
    const processor = loadProcessor();
    configure(processor, baseConfiguration({
      mouthCount: 1,
      throatCount: 1,
      oralClosure: 0,
      articulationAperture: 0.4,
      articulationIndex,
      noseCount: 1,
      nasalCoupling: 0,
      noses: [{ openness: 0, length: 0.5, resonance: 0.5 }],
    }));
    const mouth = processor.mouths[0];
    assert.ok(mouth.frication > 0.5, `tract index ${articulationIndex} must fricate`);
    assert.ok(
      Math.abs(mouth.constrictionIndex - (articulationIndex - 8)) < 0.01,
      `tract index ${articulationIndex} must map into its mouth section`,
    );

    fillWaveArrays(mouth);
    mouth.injectFrication(0.75, 1);
    const injectionSite = mouth.right.findIndex((value) => Math.abs(value) > 1e-8);
    assert.ok(injectionSite >= 0, `tract index ${articulationIndex} must inject turbulence`);
    injectionSites.add(injectionSite);
    fillWaveArrays(mouth);

    const rendered = runBlocks(processor, 84, {
      collectAfter: 24,
      captureBlocks: 4,
    });
    assert.ok(
      rendered.rms > 1e-5,
      `tract index ${articulationIndex} must produce audible frication`,
    );
    signatures.set(articulationIndex, rendered.samples);
  }

  assert.equal(
    injectionSites.size,
    4,
    "K, SH, T/S, and P/F places must inject turbulence at four distinct sections",
  );
  const uniqueIndices = [...signatures.keys()];
  for (let first = 0; first < uniqueIndices.length; first += 1) {
    for (let second = first + 1; second < uniqueIndices.length; second += 1) {
      const distance = signatureDistance(
        signatures.get(uniqueIndices[first]),
        signatures.get(uniqueIndices[second]),
      );
      assert.ok(
        distance > 0.005,
        `frication at ${uniqueIndices[first]} and ${uniqueIndices[second]} must be distinct`,
      );
    }
  }
});

test("a closed mouth remains a manifold port and returns energy to open mouths", () => {
  const processor = loadProcessor();
  const configuredMouths = mouths();
  configuredMouths[0] = {
    ...configuredMouths[0],
    closed: true,
    muted: true,
  };
  configure(processor, baseConfiguration({
    mouthCount: 2,
    throatCount: 2,
    coupling: 0.72,
    mouths: configuredMouths,
    throats: configuredMouths,
    pressureSources: pressureSources(-1),
  }));

  const closedMouth = processor.mouths?.[0];
  const openMouth = processor.mouths?.[1];
  assert.ok(
    closedMouth?.participating
      ?? closedMouth?.active
      ?? closedMouth?.activeTarget > 0,
    "the closed mouth must remain active",
  );
  assert.ok(
    openMouth?.participating
      ?? openMouth?.active
      ?? openMouth?.activeTarget > 0,
    "the comparison mouth must remain active",
  );

  runBlocks(processor, 24, {
    inputSample: () => 0,
  });

  const closedArea = Number(
    closedMouth.manifoldArea
      ?? closedMouth.inletArea
      ?? closedMouth.portArea
      ?? closedMouth.area?.[0],
  );
  const openArea = Number(
    openMouth.manifoldArea
      ?? openMouth.inletArea
      ?? openMouth.portArea
      ?? openMouth.area?.[0],
  );
  assert.ok(
    Number.isFinite(closedArea)
      && Number.isFinite(openArea)
      && closedArea >= openArea * 0.1,
    "closing a mouth must not collapse its manifold-port area",
  );

  fillWaveArrays(processor.root);
  for (const mouth of processor.mouths) fillWaveArrays(mouth);
  assert.ok(
    closedMouth.left?.length,
    "the closed mouth must expose a returning wave at its manifold inlet",
  );
  closedMouth.left[0] = 0.5;

  const scatter = processor.manifold
    ?? processor.mouthManifold
    ?? processor.scatterManifold
    ?? processor.scatterMouthManifold
    ?? processor.processMouthManifold
    ?? processor.processManifold;
  assert.equal(typeof scatter, "function", "the worklet must expose manifold scattering");
  scatter.call(processor);

  const rootReturn = Number(
    processor.manifoldRootReturn
      ?? processor.rootManifoldReturn
      ?? processor.root?.manifoldReturn
      ?? processor.mouthOutgoing?.[0],
  );
  const openPortIndex = processor.mouthPortIndex?.[1];
  const openFeed = Number(
    processor.manifoldFeed?.[1]
      ?? processor.mouthFeed?.[1]
      ?? openMouth.manifoldInput
      ?? processor.mouthOutgoing?.[openPortIndex],
  );
  assert.ok(
    Number.isFinite(rootReturn) && Math.abs(rootReturn) > 1e-4,
    "a closed mouth return must re-enter the shared root",
  );
  assert.ok(
    Number.isFinite(openFeed) && Math.abs(openFeed) > 1e-4,
    `a closed mouth return must redistribute into another open mouth; received ${openFeed}`,
  );
});

test("rapid anatomy and source sweeps keep every recursive state finite", () => {
  const processor = loadProcessor();
  let randomState = 0x5eedc0de;
  const random = () => {
    randomState = (
      Math.imul(randomState, 1_664_525) + 1_013_904_223
    ) >>> 0;
    return randomState / 0x1_0000_0000;
  };
  let frame = 0;

  for (let block = 0; block < 320; block += 1) {
    const mouthCount = 1 + block % 7;
    const sweptMouths = Array.from({ length: 7 }, (_, index) => ({
      aperture: random(),
      length: random(),
      closed: index < mouthCount && random() < 0.22,
      muted: false,
    }));
    configure(processor, baseConfiguration({
      mouthCount,
      throatCount: mouthCount,
      selectedMouth: block % mouthCount,
      bodyLength: random(),
      tension: random(),
      mutation: random(),
      coupling: random() * 0.72,
      oralClosure: block % 11 === 0 ? 1 : random(),
      articulationIndex: 2 + random() * 40,
      articulationAperture: block % 13 === 0 ? 0 : random(),
      glottalClosure: block % 17 === 0 ? 1 : random() * 0.3,
      nasalCoupling: random(),
      exciterIntensity: random(),
      pressureSourceCount: 1 + block % 4,
      pressureSources: Array.from({ length: 4 }, (_, index) => ({
        open: index <= block % 4 && random() > 0.2,
        level: random(),
      })),
      mouths: sweptMouths,
      throats: sweptMouths,
      tongues: Array.from({ length: 5 }, () => ({
        position: random(),
        height: random(),
        curl: random(),
      })),
      noses: Array.from({ length: 3 }, () => ({
        openness: random(),
        length: random(),
        resonance: random(),
      })),
    }));

    const input = new Float32Array(BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
      input[index] = signalSample(frame, 0.16) + (random() * 2 - 1) * 0.025;
      frame += 1;
    }
    assert.equal(processor.process([[input]], [[left, right]]), true);
    assertFiniteBlock(left, right, `sweep block ${block}`);
    if (block % 16 === 0) assertFiniteState(processor);
  }

  assertFiniteState(processor);
  for (const [index, message] of processor.messages.entries()) {
    assertFiniteState(message, `pressure message ${index}`);
  }
});
