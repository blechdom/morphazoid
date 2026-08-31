import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const MODULE_URL = new URL("../src/moire-drone.js", import.meta.url);
const savedWorkletGlobals = new Map(
  ["sampleRate", "AudioWorkletProcessor", "registerProcessor"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

let registeredName = null;
let ProcessorConstructor = null;

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      messages: [],
      postMessage(message) {
        this.messages.push(message);
      },
    };
  }
}

Object.defineProperties(globalThis, {
  sampleRate: { configurable: true, writable: true, value: SAMPLE_RATE },
  AudioWorkletProcessor: {
    configurable: true,
    writable: true,
    value: MockAudioWorkletProcessor,
  },
  registerProcessor: {
    configurable: true,
    writable: true,
    value(name, constructor) {
      registeredName = name;
      ProcessorConstructor = constructor;
    },
  },
});

const module = await import(`${MODULE_URL.href}?moire-drone-test=${Date.now()}`);
const {
  MOIRE_DRONE_DEFAULTS,
  MOIRE_DRONE_FFT_HOP_SIZE,
  MOIRE_DRONE_FFT_LATENCY,
  MOIRE_DRONE_FFT_SIZE,
  MOIRE_DRONE_LIMITS,
  MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  MOIRE_DRONE_NOISE_COLOR_CHOICES,
  MOIRE_DRONE_NOISE_TYPES,
  MOIRE_DRONE_PRESETS,
  MOIRE_DRONE_PROCESSOR_NAME,
  FABRIC_IMPACT_BODIES,
  SPECTRAL_SCULPT_MODES,
  SPECTRAL_PROPAGATION_MODES,
  MoireDroneAudio,
  MoireDroneKernel,
  SpectralFabric,
  SpectralFftFilter,
  SpectralPropagationPool,
  adaptiveFilterCount,
  combToothAnchor,
  combToothWarpOffset,
  collideWaveFields,
  createSeededNoise,
  elasticReleaseProfile,
  fabricHeightForSections,
  fabricImpactPattern,
  fabricImpulseWeight,
  fabricGesturePull,
  latticeCoordinate,
  moireFilterTarget,
  rotateFabricCoordinate,
  sanitizeMoireDroneParams,
  shepardWindow,
  spectralCombGate,
  spectralFftMaskGain,
  spectralWarpedCombGate,
  spectralPropagationValue,
  stableSvfCoefficients,
  waveFieldValue,
  wrapUnit,
} = module;

after(() => {
  for (const [key, descriptor] of savedWorkletGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function rms(samples, start = 0) {
  let sum = 0;
  for (let index = start; index < samples.length; index += 1) sum += samples[index] ** 2;
  return Math.sqrt(sum / Math.max(1, samples.length - start));
}

function renderKernel(kernel, frameCount, blocks = BLOCK_SIZE) {
  const leftResult = new Float32Array(frameCount);
  const rightResult = new Float32Array(frameCount);
  let offset = 0;
  while (offset < frameCount) {
    const length = Math.min(blocks, frameCount - offset);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    assert.equal(kernel.process(left, right), true);
    leftResult.set(left, offset);
    rightResult.set(right, offset);
    offset += length;
  }
  return { left: leftResult, right: rightResult };
}

function renderSpectralFilter(
  filter,
  leftInput,
  rightInput = leftInput,
  tail = filter.fftSize * 2,
  chunkPattern = [128],
) {
  const length = leftInput.length + tail;
  const left = new Float64Array(length);
  const right = new Float64Array(length);
  let offset = 0;
  let chunk = 0;
  while (offset < length) {
    const requested = Math.max(1, Math.round(chunkPattern[chunk % chunkPattern.length]));
    const end = Math.min(length, offset + requested);
    for (let index = offset; index < end; index += 1) {
      filter.processSample(
        leftInput[index] ?? 0,
        rightInput[index] ?? 0,
      );
      left[index] = filter.outputLeft;
      right[index] = filter.outputRight;
    }
    offset = end;
    chunk += 1;
  }
  return { left, right };
}

function binToneAmplitude(
  samples,
  bin,
  fftSize,
  sourceStart,
  sourceEnd,
  latency,
) {
  let real = 0;
  let imaginary = 0;
  for (let index = sourceStart; index < sourceEnd; index += 1) {
    const sample = samples[index + latency];
    const angle = Math.PI * 2 * bin * index / fftSize;
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return 2 * Math.hypot(real, imaginary) / Math.max(1, sourceEnd - sourceStart);
}

function assertFiniteBounded(channels) {
  for (const channel of channels) {
    for (const sample of channel) {
      assert.ok(Number.isFinite(sample));
      assert.ok(Math.abs(sample) <= 0.980001);
    }
  }
}

function namedFunctionSource(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `${name}() must be declared`);
  const start = match.index;
  const remainder = source.slice(start + match[0].length);
  const next = remainder.search(/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/);
  return source.slice(start, next < 0 ? source.length : start + match[0].length + next);
}

test("Fabric Filter registers a zero-input self-generating worklet", () => {
  assert.equal(registeredName, MOIRE_DRONE_PROCESSOR_NAME);
  assert.equal(typeof ProcessorConstructor, "function");
  const processor = new ProcessorConstructor({
    processorOptions: { parameters: MOIRE_DRONE_DEFAULTS },
  });
  processor.performanceNow = null;
  const silentLeft = new Float32Array(BLOCK_SIZE);
  const silentRight = new Float32Array(BLOCK_SIZE);
  assert.equal(processor.process([], [[silentLeft, silentRight]]), true);
  assert.equal(silentLeft.every((sample) => sample === 0), true);
  processor.port.onmessage({ data: { type: "active", value: true } });
  let audible = false;
  for (let block = 0; block < 30; block += 1) {
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    processor.process([], [[left, right]]);
    assertFiniteBounded([left, right]);
    audible ||= rms(left) > 0.001;
  }
  assert.equal(audible, true, "the worklet must generate a drone without an input node");
});

test("parameter sanitization enforces the complete DSP budget and safe ranges", () => {
  const settings = sanitizeMoireDroneParams({
    noiseColor: -99,
    noiseCorrelation: 8,
    dust: Number.NaN,
    filterPairs: 999,
    lowFrequency: -4,
    highFrequency: 999_999,
    resonance: 2,
    resonanceMotion: -1,
    spectralTilt: 99,
    latticeScatter: 3,
    filteredMix: -3,
    cascade: 4,
    glideA: 90,
    glideB: -90,
    edgeFocus: 99,
    fieldAAngle: 900,
    fieldADensity: 0,
    fieldASpeed: 20,
    fieldACurvature: -1,
    fieldADepth: 20,
    fieldBAngle: -900,
    fieldBDensity: 99,
    fieldBSpeed: -20,
    fieldBCurvature: 4,
    fieldBDepth: -4,
    originX: 4,
    originY: -4,
    moireDetune: 8,
    phaseOffset: 8.25,
    collisionMode: "not-a-mode",
    collisionAmount: 7,
    collisionWidth: 0,
    collisionPolarity: -8,
    spectralFilterBlend: 7,
    fftCutDepth: -8,
    fftSharpness: 9,
    qCutDepth: -9,
    qCharacter: 8,
    stereoWidth: 8,
    drive: 8,
    space: -8,
    feedback: 9,
    outputLevel: 9,
    seed: 0,
  });
  assert.ok(Object.isFrozen(settings));
  assert.equal(settings.noiseColor, -1);
  assert.equal(settings.noiseCorrelation, 1);
  assert.equal(settings.dust, MOIRE_DRONE_DEFAULTS.dust);
  assert.equal(settings.filterPairs, MOIRE_DRONE_LIMITS.maxFilterPairs);
  assert.equal(settings.lowFrequency, MOIRE_DRONE_LIMITS.minFrequency);
  assert.equal(settings.highFrequency, MOIRE_DRONE_LIMITS.maxFrequency);
  assert.equal(settings.resonance, 1);
  assert.equal(settings.resonanceMotion, 0);
  assert.equal(settings.glideA, MOIRE_DRONE_LIMITS.maxGlideRate);
  assert.equal(settings.glideB, -MOIRE_DRONE_LIMITS.maxGlideRate);
  assert.equal(settings.collisionMode, MOIRE_DRONE_DEFAULTS.collisionMode);
  assert.equal(settings.spectralFilterBlend, 1);
  assert.equal(settings.fftCutDepth, 0);
  assert.equal(settings.fftSharpness, 1);
  assert.equal(settings.qCutDepth, 0);
  assert.equal(settings.qCharacter, 1);
  assert.equal(settings.feedback, 0.72);
  assert.equal(settings.outputLevel, 0.72);
  assert.equal(settings.seed, MOIRE_DRONE_DEFAULTS.seed);
  assert.equal(settings.filterPairs * 2, MOIRE_DRONE_LIMITS.maxFilters);
  assert.equal(adaptiveFilterCount(settings.filterPairs, 0), 48);
  assert.equal(adaptiveFilterCount(settings.filterPairs, 3), 16);

  const reordered = sanitizeMoireDroneParams({ lowFrequency: 1_600, highFrequency: 200 });
  assert.ok(reordered.highFrequency >= reordered.lowFrequency * 1.25);
});

test("the browser audio and worklet boundaries reject hidden autonomous motion", () => {
  const autonomousRequest = {
    glideA: 1.7,
    glideB: -1.6,
    fieldASpeed: 1.5,
    fieldBSpeed: -1.4,
    fabricExcitation: 1,
    fabricVibration: 1,
    fabricRate: 30,
    fabricSpin: 0.9,
    autoPluckRate: 4,
    combDrift: -1.8,
    gestureMemory: 4,
    freeze: true,
  };
  const assertManual = (parameters, boundary) => {
    for (const [key, value] of Object.entries(MOIRE_DRONE_MANUAL_MOTION_SETTINGS)) {
      assert.equal(parameters[key], value, `${boundary} must neutralize ${key}`);
    }
  };

  const audio = new MoireDroneAudio({});
  assertManual(audio.setParameters(autonomousRequest), "browser audio wrapper");

  const processor = new ProcessorConstructor({
    processorOptions: { parameters: autonomousRequest },
  });
  assertManual(processor.kernel.target, "worklet constructor");
  processor.port.onmessage({
    data: { type: "parameters", parameters: autonomousRequest },
  });
  assertManual(processor.kernel.target, "worklet message boundary");
});

test("spectral sculpt modes and gesture dynamics sanitize to a stable public contract", () => {
  assert.ok(Object.isFrozen(SPECTRAL_SCULPT_MODES));
  assert.deepEqual(SPECTRAL_SCULPT_MODES, [
    "notches", "ridges", "lowpass", "highpass", "bandpass", "bandstop",
    "peak", "tilt",
  ]);

  const invalid = sanitizeMoireDroneParams({
    spectralSculptMode: "not-a-sculpture",
    gestureCoupling: -99,
    gestureMemory: 99,
  });
  assert.equal(invalid.spectralSculptMode, MOIRE_DRONE_DEFAULTS.spectralSculptMode);
  assert.equal(invalid.gestureCoupling, 0);
  assert.equal(invalid.gestureMemory, 4);

  for (const spectralSculptMode of SPECTRAL_SCULPT_MODES) {
    const parameters = sanitizeMoireDroneParams({
      spectralSculptMode,
      gestureCoupling: 0.37,
      gestureMemory: 0.64,
    });
    assert.equal(parameters.spectralSculptMode, spectralSculptMode);
    assert.equal(parameters.gestureCoupling, 0.37);
    assert.equal(parameters.gestureMemory, 0.64);
  }
});

test("noise-color choices are canonical, immutable, and represented by presets", () => {
  assert.ok(Object.isFrozen(MOIRE_DRONE_NOISE_COLOR_CHOICES));
  assert.deepEqual(MOIRE_DRONE_NOISE_COLOR_CHOICES.map(({ label, value }) => ({ label, value })), [
    { label: "Brown", value: -1 },
    { label: "Pink", value: -0.5 },
    { label: "White", value: 0 },
    { label: "Blue", value: 1 },
  ]);
  assert.ok(MOIRE_DRONE_NOISE_COLOR_CHOICES.every(Object.isFrozen));

  const presetColors = new Set();
  for (const preset of MOIRE_DRONE_PRESETS) {
    assert.ok(
      Object.hasOwn(preset.settings, "noiseColor"),
      `${preset.id} must declare its noise source instead of inheriting one shared default`,
    );
    assert.ok(Number.isFinite(preset.settings.noiseColor));
    assert.ok(preset.settings.noiseColor >= -1 && preset.settings.noiseColor <= 1);
    presetColors.add(preset.settings.noiseColor);
  }
  assert.ok([...presetColors].some((value) => value <= -0.75), "presets must reach brown noise");
  assert.ok(
    [...presetColors].some((value) => value > -0.75 && value <= -0.25),
    "presets must include pink noise",
  );
  assert.ok([...presetColors].some((value) => Math.abs(value) <= 0.15), "presets must include white noise");
  assert.ok([...presetColors].some((value) => value >= 0.75), "presets must reach blue noise");
});

test("noise engines expose deterministic colored, impulsive, fractal, and chaotic sources", () => {
  assert.ok(Object.isFrozen(MOIRE_DRONE_NOISE_TYPES));
  assert.deepEqual(MOIRE_DRONE_NOISE_TYPES, [
    "colored", "violet", "crackle", "samplehold", "fractal", "chaotic",
  ]);

  const low = sanitizeMoireDroneParams({
    noiseType: "not-a-noise",
    noiseChaos: -99,
    noiseFractalDepth: -99,
  });
  assert.equal(low.noiseType, MOIRE_DRONE_DEFAULTS.noiseType);
  assert.equal(low.noiseChaos, 0);
  assert.equal(low.noiseFractalDepth, 0);

  const high = sanitizeMoireDroneParams({
    noiseType: "chaotic",
    noiseChaos: 99,
    noiseFractalDepth: 99,
  });
  assert.equal(high.noiseType, "chaotic");
  assert.equal(high.noiseChaos, 1);
  assert.equal(high.noiseFractalDepth, 1);

  const signatures = new Set();
  for (const noiseType of MOIRE_DRONE_NOISE_TYPES) {
    const parameters = {
      ...MOIRE_DRONE_DEFAULTS,
      noiseType,
      noiseChaos: 0.83,
      noiseFractalDepth: 0.78,
      filteredMix: 0.35,
      seed: 0x1badb002,
    };
    const first = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
    const second = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
    first.setActive(true);
    second.setActive(true);
    const firstRender = renderKernel(first, BLOCK_SIZE * 96);
    const secondRender = renderKernel(second, BLOCK_SIZE * 96, 73);
    assertFiniteBounded([firstRender.left, firstRender.right]);
    assert.deepEqual(firstRender.left, secondRender.left, `${noiseType} must be seeded`);
    assert.deepEqual(firstRender.right, secondRender.right, `${noiseType} must be block-stable`);
    assert.ok(rms(firstRender.left, BLOCK_SIZE * 12) > 0.001, `${noiseType} must be audible`);
    signatures.add(Array.from(
      firstRender.left.slice(BLOCK_SIZE * 40, BLOCK_SIZE * 41),
      (sample) => sample.toFixed(6),
    ).join(","));
  }
  assert.equal(
    signatures.size,
    MOIRE_DRONE_NOISE_TYPES.length,
    "the named noise engines must not collapse into cosmetic aliases",
  );
});

test("the names-only preset library is unique, frozen, manual, safe, and audible", () => {
  assert.ok(
    MOIRE_DRONE_PRESETS.length >= 56,
    "the expanded library must expose a substantial range of controllable sounds",
  );
  assert.equal(new Set(MOIRE_DRONE_PRESETS.map(({ id }) => id)).size, MOIRE_DRONE_PRESETS.length);
  assert.equal(new Set(MOIRE_DRONE_PRESETS.map(({ label }) => label)).size, MOIRE_DRONE_PRESETS.length);
  const sanitizedPresets = [];
  for (const preset of MOIRE_DRONE_PRESETS) {
    assert.match(preset.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.settings));
    const parameters = sanitizeMoireDroneParams({
      ...MOIRE_DRONE_DEFAULTS,
      ...preset.settings,
    });
    sanitizedPresets.push(parameters);
    for (const [key, value] of Object.entries(MOIRE_DRONE_MANUAL_MOTION_SETTINGS)) {
      assert.equal(
        parameters[key],
        value,
        `${preset.id} must neutralize hidden ${key} automation`,
      );
    }
    const kernel = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
    kernel.setActive(true);
    const rendered = renderKernel(kernel, BLOCK_SIZE * 90);
    assertFiniteBounded([rendered.left, rendered.right]);
    assert.ok(rms(rendered.left, BLOCK_SIZE * 8) > 0.002, `${preset.id} must stay audible`);
  }

  const combSignatures = new Set(sanitizedPresets.map((parameters) => [
    parameters.combDepth.toFixed(3),
    parameters.combTeeth,
    parameters.combWidth.toFixed(3),
    parameters.combOffset.toFixed(3),
    parameters.propagationVoices,
    parameters.propagationMode,
    parameters.propagationSpeed.toFixed(3),
    parameters.propagationDecay.toFixed(3),
  ].join("|")));
  assert.ok(combSignatures.size >= 12, "presets must not be cosmetic aliases of one manual sculpture");
  assert.ok(sanitizedPresets.some(({ propagationVoices }) => propagationVoices > 1));
  assert.ok(sanitizedPresets.some(({ combDepth }) => combDepth < 0.8));
  assert.ok(sanitizedPresets.some(({ combDepth }) => combDepth === 1));
  assert.deepEqual(
    new Set(sanitizedPresets.map(({ propagationMode }) => propagationMode)),
    new Set(SPECTRAL_PROPAGATION_MODES),
  );
  const fabricSignatures = new Set(sanitizedPresets.map((parameters) => (
    `${parameters.fabricSections}|${parameters.fabricPatchwork.toFixed(2)}`
  )));
  assert.ok(fabricSignatures.size >= 10, "presets must exercise genuinely different fabrics");
  assert.ok(sanitizedPresets.some(({ fabricSections }) => fabricSections === 3));
  assert.ok(sanitizedPresets.some(({ fabricSections }) => fabricSections === 16));
  assert.ok(sanitizedPresets.some(({ fabricPatchwork }) => fabricPatchwork < 0.1));
  assert.ok(sanitizedPresets.some(({ fabricPatchwork }) => fabricPatchwork > 0.8));
  const motionPresets = Object.fromEntries(
    MOIRE_DRONE_PRESETS
      .filter(({ id }) => [
        "snap-mesh", "rubber-sheet", "heavy-canvas", "felt-stop",
      ].includes(id))
      .map(({ id, settings }) => [id, settings]),
  );
  assert.deepEqual(Object.keys(motionPresets), [
    "snap-mesh", "rubber-sheet", "heavy-canvas", "felt-stop",
  ]);
  assert.ok(motionPresets["snap-mesh"].fabricTension > 0.9);
  assert.ok(1 - motionPresets["snap-mesh"].fabricInertia > 0.9);
  assert.ok(motionPresets["rubber-sheet"].fabricDamping < 0.05);
  assert.ok(1 - motionPresets["heavy-canvas"].fabricInertia < 0.05);
  assert.ok(motionPresets["felt-stop"].fabricDamping > 0.85);
  for (const settings of Object.values(motionPresets)) {
    assert.equal(settings.autoPluckRate, 0);
    assert.equal(settings.grabRippleRate, 0);
    assert.equal(settings.fabricGravity, 0);
    assert.equal(settings.fabricExcitation, 0);
    assert.equal(settings.fabricVibration, 0);
    assert.equal(settings.combDrift, 0);
    assert.equal(settings.space, 0);
    assert.equal(settings.feedback, 0);
  }
  assert.ok(
    sanitizedPresets
      .filter(({ propagationMode }) => propagationMode === "ocean")
      .every(({ autoPluckRate }) => autoPluckRate === 0),
    "named shoreline presets must launch from the chosen shore rather than wrapping randomly",
  );
  assert.deepEqual(
    new Set(sanitizedPresets.map(({ spectralSculptMode }) => spectralSculptMode)),
    new Set(SPECTRAL_SCULPT_MODES),
    "the preset library must demonstrate every noise-sculpting topology",
  );
  assert.ok(
    sanitizedPresets.filter(({ spectralSculptMode }) => spectralSculptMode === "notches").length
      <= Math.ceil(sanitizedPresets.length / 2),
    "periodic gaps must be one color in the library, not its dominant identity",
  );
  assert.deepEqual(
    new Set(sanitizedPresets.map(({ noiseType }) => noiseType)),
    new Set(MOIRE_DRONE_NOISE_TYPES),
    "the preset library must demonstrate every noise generator",
  );
  for (const parameter of [
    "propagationSizeSpread", "propagationSpeedSpread", "propagationInterference",
    "grabRippleRate", "fabricGravity",
  ]) {
    assert.ok(
      sanitizedPresets.some((settings) => settings[parameter] > 0),
      `the preset library must demonstrate ${parameter}`,
    );
  }
});

test("seeded noise resets exactly and remains independent across seeds", () => {
  const first = createSeededNoise(12345);
  const second = createSeededNoise(12345);
  const different = createSeededNoise(54321);
  const sequence = Array.from({ length: 128 }, () => first.next());
  assert.deepEqual(sequence, Array.from({ length: 128 }, () => second.next()));
  assert.notDeepEqual(sequence, Array.from({ length: 128 }, () => different.next()));
  first.reset();
  assert.deepEqual(sequence, Array.from({ length: 128 }, () => first.next()));
  assert.ok(sequence.every((sample) => sample >= -1 && sample < 1));
});

test("the analytic fields are bounded, periodic, two-dimensional, and collide nonlinearly", () => {
  for (let y = -1; y <= 1; y += 0.125) {
    for (let x = -1; x <= 1; x += 0.125) {
      const value = waveFieldValue(x, y, 0.27, 33, 4.2, 0.41, -0.2, 0.1);
      assert.ok(Number.isFinite(value));
      assert.ok(value >= -1 && value <= 1);
      assert.ok(Math.abs(value - waveFieldValue(x, y, 1.27, 33, 4.2, 0.41, -0.2, 0.1)) < 1e-12);
    }
  }
  const center = waveFieldValue(0.1, -0.2, 0.27, 33, 4.2, 0.41);
  assert.notEqual(center, waveFieldValue(0.2, -0.2, 0.27, 33, 4.2, 0.41));
  assert.notEqual(center, waveFieldValue(0.1, -0.1, 0.27, 33, 4.2, 0.41));

  for (const mode of ["multiply", "difference", "fold"]) {
    for (const a of [-1, -0.3, 0, 0.4, 1]) {
      for (const b of [-1, -0.2, 0.5, 1]) {
        const collision = collideWaveFields(a, b, mode);
        assert.ok(Number.isFinite(collision));
        assert.ok(collision >= -1 && collision <= 1);
      }
    }
  }
  const mixedDifference = (
    collideWaveFields(0.7, 0.5, "multiply")
    - collideWaveFields(0.7, -0.2, "multiply")
    - collideWaveFields(-0.3, 0.5, "multiply")
    + collideWaveFields(-0.3, -0.2, "multiply")
  );
  assert.ok(Math.abs(mixedDifference) > 0.1, "the collision must couple A and B rather than merely add them");
});

test("the spatial lattice covers both axes and yields stable non-quantized filters", () => {
  const coordinates = Array.from({ length: 24 }, (_, index) => latticeCoordinate(index, 24));
  assert.ok(Math.max(...coordinates.map(({ x }) => x)) - Math.min(...coordinates.map(({ x }) => x)) > 1.5);
  assert.ok(Math.max(...coordinates.map(({ y }) => y)) - Math.min(...coordinates.map(({ y }) => y)) > 1.5);
  const crossProducts = coordinates.slice(2).map((point) => (
    (coordinates[1].x - coordinates[0].x) * (point.y - coordinates[0].y)
    - (coordinates[1].y - coordinates[0].y) * (point.x - coordinates[0].x)
  ));
  assert.ok(crossProducts.some((value) => Math.abs(value) > 0.05), "the lattice must not collapse to a line");

  const regular = moireFilterTarget({ index: 7, bank: 0, parameters: { latticeScatter: 0 } });
  const scattered = moireFilterTarget({ index: 7, bank: 0, parameters: { latticeScatter: 1 } });
  const collided = moireFilterTarget({
    index: 7,
    bank: 0,
    parameters: { collisionAmount: 1, collisionPolarity: 1, resonanceMotion: 1 },
  });
  assert.notEqual(regular.frequency, scattered.frequency);
  assert.ok(Number.isFinite(collided.gain) && Number.isFinite(collided.q));
  assert.ok(collided.frequency >= MOIRE_DRONE_LIMITS.minFrequency);
  assert.ok(collided.frequency <= SAMPLE_RATE * 0.42);
  assert.ok(collided.q >= 0.45 && collided.q <= MOIRE_DRONE_LIMITS.maxQ);

  for (const frequency of [1, 24, 440, 10_000, 100_000]) {
    for (const q of [0.01, 0.5, 4, 16, 999]) {
      const coefficients = stableSvfCoefficients(frequency, q, SAMPLE_RATE);
      for (const value of Object.values(coefficients)) assert.ok(Number.isFinite(value));
      assert.ok(coefficients.frequency <= SAMPLE_RATE * 0.42);
      assert.ok(coefficients.a1 > 0 && coefficients.a1 <= 1);
    }
  }
});

test("default collision and propagation gain span materially audible filter ranges", () => {
  const collisionBase = {
    ...MOIRE_DRONE_DEFAULTS,
    phaseOffset: 0,
    moireDetune: 0,
    fieldADepth: 0,
    fieldBDepth: 0,
    combDepth: 0,
  };
  const uncoupled = moireFilterTarget({
    index: 0,
    bank: 0,
    phaseA: 0.2,
    phaseB: 0.2,
    fieldPhaseA: 0.2,
    fieldPhaseB: 0.2,
    parameters: { ...collisionBase, collisionAmount: 0 },
  });
  const defaultCollision = moireFilterTarget({
    index: 0,
    bank: 0,
    phaseA: 0.2,
    phaseB: 0.2,
    fieldPhaseA: 0.2,
    fieldPhaseB: 0.2,
    parameters: collisionBase,
  });
  assert.equal(defaultCollision.proximity, 1);
  assert.ok(defaultCollision.spatialCollision > 0.6);
  assert.ok(
    defaultCollision.gain > uncoupled.gain * 1.1,
    "the default collision polarity must clear ten percent gain at a real crossing",
  );
  assert.ok(
    defaultCollision.q > uncoupled.q * 1.08,
    "the default resonance motion must clear eight percent Q at a real crossing",
  );
  const distantOptions = {
    index: 0,
    bank: 0,
    phaseA: 0.1,
    phaseB: 0.5,
    fieldPhaseA: 0.2,
    fieldPhaseB: 0.2,
  };
  const distantUncoupled = moireFilterTarget({
    ...distantOptions,
    parameters: { ...collisionBase, collisionAmount: 0 },
  });
  const distantCollision = moireFilterTarget({
    ...distantOptions,
    parameters: collisionBase,
  });
  assert.ok(distantCollision.proximity < 1e-20, "the probe bands must be spectrally remote");
  assert.ok(
    distantCollision.gain > distantUncoupled.gain * 1.02,
    "the bounded spatial near-field must keep remote wave collisions audible",
  );
  assert.ok(distantCollision.q > distantUncoupled.q * 1.02);

  const propagationBase = {
    ...MOIRE_DRONE_DEFAULTS,
    phaseOffset: 0,
    moireDetune: 0,
    fieldADepth: 0,
    fieldBDepth: 0,
    fabricDepth: 0,
    propagationDepth: 1,
    pluckCut: 1,
    combDepth: 0,
  };
  const propagationAt = (propagationGain) => moireFilterTarget({
    index: 5,
    bank: 0,
    phaseA: 0.1,
    phaseB: 0.1,
    propagationA: 0.7,
    propagationB: -0.3,
    parameters: { ...propagationBase, propagationGain },
  });
  const silentRipple = propagationAt(0);
  const defaultRipple = propagationAt(MOIRE_DRONE_DEFAULTS.propagationGain);
  const maximumRipple = propagationAt(1);
  assert.equal(silentRipple.propagation, 0);
  assert.equal(silentRipple.propagationCut, 1);
  assert.ok(Math.abs(defaultRipple.propagation - 0.7) < 1e-12);
  assert.ok(maximumRipple.propagation > defaultRipple.propagation * 1.3);
  assert.ok(defaultRipple.propagationCut < 0.25);
  assert.ok(maximumRipple.propagationCut < defaultRipple.propagationCut * 0.1);
});

test("Shepard edges mute the wrap while opposite glides move independently", () => {
  assert.equal(shepardWindow(0), 0);
  assert.equal(shepardWindow(1), 0);
  assert.ok(shepardWindow(0.5) > 0.999999);
  assert.ok(shepardWindow(1e-6) < 1e-14);
  assert.equal(wrapUnit(-0.25), 0.75);

  const params = { ...MOIRE_DRONE_DEFAULTS, fieldADepth: 0, fieldBDepth: 0, latticeScatter: 0 };
  const a0 = moireFilterTarget({ index: 4, bank: 0, phaseA: 0.1, phaseB: 0.1, parameters: params });
  const a1 = moireFilterTarget({ index: 4, bank: 0, phaseA: 0.11, phaseB: 0.09, parameters: params });
  const b0 = moireFilterTarget({ index: 4, bank: 1, phaseA: 0.1, phaseB: 0.1, parameters: params });
  const b1 = moireFilterTarget({ index: 4, bank: 1, phaseA: 0.11, phaseB: 0.09, parameters: params });
  const independentFieldPhase = moireFilterTarget({
    index: 4,
    bank: 0,
    phaseA: 0.1,
    phaseB: 0.1,
    fieldPhaseA: 0.6,
    fieldPhaseB: 0.4,
    parameters: params,
  });
  assert.ok(a1.position > a0.position);
  assert.ok(b1.position < b0.position);
  assert.notEqual(independentFieldPhase.fieldA, a0.fieldA);
  assert.equal(independentFieldPhase.position, a0.position);
});

test("kernel output is deterministic across block boundaries and genuinely stereo", () => {
  const first = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  const second = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  first.setActive(true);
  second.setActive(true);
  const oneBlockShape = renderKernel(first, 16_384, 128);
  const oddBlockShape = renderKernel(second, 16_384, 73);
  assert.deepEqual(oneBlockShape.left, oddBlockShape.left);
  assert.deepEqual(oneBlockShape.right, oddBlockShape.right);
  assertFiniteBounded([oneBlockShape.left, oneBlockShape.right]);
  assert.ok(rms(oneBlockShape.left, 1_024) > 0.01);
  let stereoDifference = 0;
  for (let index = 1_024; index < oneBlockShape.left.length; index += 1) {
    stereoDifference += Math.abs(oneBlockShape.left[index] - oneBlockShape.right[index]);
  }
  assert.ok(stereoDifference > 1, "the two field banks must not collapse to dual mono");

  first.reset();
  first.setActive(true);
  assert.deepEqual(renderKernel(first, 16_384, 73).left, oneBlockShape.left);
});

test("the adaptive guard sheds and gradually restores filter work", () => {
  const kernel = new MoireDroneKernel({
    parameters: { ...MOIRE_DRONE_DEFAULTS, filterPairs: 24, cascade: 0.8 },
  });
  assert.equal(kernel.minimumQualityTier, 1);
  assert.equal(kernel.qualityTier, 1);
  const baseline = adaptiveFilterCount(24, kernel.qualityTier);
  for (let block = 0; block < 20; block += 1) kernel.recordPerformanceLoad(1.2);
  assert.ok(kernel.qualityTier > 1);
  assert.ok(adaptiveFilterCount(24, kernel.qualityTier) < baseline);
  for (let block = 0; block < 3_000; block += 1) kernel.recordPerformanceLoad(0.08);
  assert.equal(kernel.qualityTier, kernel.minimumQualityTier);
  for (let block = 0; block < 1_000; block += 1) kernel.recordPerformanceLoad(0.02);
  assert.equal(kernel.qualityTier, 1, "a dense cascade must retain its protected baseline");
});

test("the browser wrapper is lazy and the page exposes complete accessible controls", async () => {
  const runtime = {};
  const audio = new MoireDroneAudio(runtime);
  assert.equal(audio.context, null);
  assert.equal(audio.node, null);
  assert.equal(audio.isInitialized, false);

  const [html, appSource, cssSource] = await Promise.all([
    readFile(new URL("../moire-drone.html", import.meta.url), "utf8"),
    readFile(new URL("../moire-drone-app.js", import.meta.url), "utf8"),
    readFile(new URL("../moire-drone.css", import.meta.url), "utf8"),
  ]);
  assert.equal(
    (cssSource.match(/\{/g) ?? []).length,
    (cssSource.match(/\}/g) ?? []).length,
    "the instrument stylesheet must have balanced blocks",
  );
  assert.match(html, /<html lang="en">/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(
    html,
    /<div class="moire-field-legend"[^>]*\shidden(?:\s|>)/,
    "the verbose legend must stay off the top of the canvas",
  );
  assert.match(
    html,
    /<div class="stage-meta"[^>]*\shidden(?:\s|>)/,
    "the diagnostic readout must stay off the top of the canvas",
  );
  assert.match(
    cssSource,
    /\.moire-field-legend\[hidden\][\s\S]*?\.stage-meta\[hidden\][\s\S]*?display:\s*none/,
  );
  assert.match(
    html,
    /<canvas[\s\S]*?id="stage"[\s\S]*?tabindex="0"[\s\S]*?role="application"[\s\S]*?aria-roledescription="interactive spectral vector grid"/,
  );
  assert.match(html, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(html, /id="audioState">off</);
  assert.match(html, /id="audioError" role="alert" hidden/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.match(html, /aria-keyshortcuts="Enter ArrowLeft ArrowRight ArrowUp ArrowDown"/);
  assert.doesNotMatch(
    html,
    /aria-keyshortcuts="[^"]*\bSpace\b/,
    "Space must not toggle hidden automatic motion",
  );
  assert.match(html, /id="fabricExciteButton"[^>]*>Drop at origin</);
  assert.match(html, /id="fabricSections"[^>]*min="3"[^>]*max="16"/);
  assert.match(html, /id="fabricPatchwork"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /for="fabricTension"><span><b>Wave tension<\/b>/);
  assert.match(html, /for="fabricInertia"><span><b>Response speed<\/b>/);
  assert.match(html, /for="fabricDamping"><span><b>Motion brake<\/b>/);
  assert.match(html, /loose \/ slow[\s\S]*taut \/ fast/);
  assert.match(html, /slow \/ weighty[\s\S]*fast \/ immediate/);
  assert.match(html, /rings out[\s\S]*stops quickly/);
  assert.match(
    appSource,
    /\["fabricInertia",\s*"fabricInertia",\s*invertUnit,\s*invertUnit\]/,
    "response speed must invert both input and preset-to-control display mapping",
  );
  assert.match(html, /Field A · X \/ Warp Filter/);
  assert.match(html, /Field B · Y \/ Weft Filter/);
  assert.match(appSource, /function syncVisualFabricTopology\(/);
  const topologySyncSource = namedFunctionSource(appSource, "syncVisualFabricTopology");
  assert.match(topologySyncSource, /visualFabric\.reconfigure\(/);
  assert.match(topologySyncSource, /width:\s*columns/);
  assert.match(topologySyncSource, /height:\s*rows/);
  assert.match(topologySyncSource, /patchwork:\s*state\.settings\.fabricPatchwork/);
  assert.doesNotMatch(
    appSource,
    /visualFabricTopology|visualFabricColumnEdges|visualFabricRowEdges|topologyEdges/,
    "nonuniform physical topology must not distort the equally spaced display grid",
  );
  const noiseColorChoiceStart = html.indexOf('id="noiseColorChoice"');
  assert.ok(noiseColorChoiceStart >= 0, "the canonical noise-color chooser must be present");
  const noiseColorChoice = html.slice(
    noiseColorChoiceStart,
    html.indexOf("</div>", noiseColorChoiceStart) + 6,
  );
  assert.match(noiseColorChoice, /role="group"[^>]*aria-label="Noise color anchors"/);
  assert.equal((noiseColorChoice.match(/<button\b/g) ?? []).length, 4);
  assert.match(
    noiseColorChoice,
    /data-noise-color="-1"[^>]*aria-pressed="(?:true|false)"[^>]*>Brown<[\s\S]*data-noise-color="-0\.5"[^>]*aria-pressed="(?:true|false)"[^>]*>Pink<[\s\S]*data-noise-color="0"[^>]*aria-pressed="(?:true|false)"[^>]*>White<[\s\S]*data-noise-color="1"[^>]*aria-pressed="(?:true|false)"[^>]*>Blue</,
  );
  const noiseTypeChoiceStart = html.indexOf('id="noiseTypeChoice"');
  assert.ok(noiseTypeChoiceStart >= 0, "the noise-generator chooser must be present");
  const noiseTypeChoice = html.slice(
    noiseTypeChoiceStart,
    html.indexOf("</div>", noiseTypeChoiceStart) + 6,
  );
  assert.match(noiseTypeChoice, /role="group"[^>]*aria-label="[^"]*noise[^"]*"/i);
  assert.equal(
    (noiseTypeChoice.match(/data-noise-type=/g) ?? []).length,
    MOIRE_DRONE_NOISE_TYPES.length,
  );
  for (const noiseType of MOIRE_DRONE_NOISE_TYPES) {
    assert.match(noiseTypeChoice, new RegExp(`data-noise-type="${noiseType}"`));
  }
  const sculptModeChoiceStart = html.indexOf('id="spectralSculptModeChoice"');
  assert.ok(sculptModeChoiceStart >= 0, "the spectral-sculpt selector must be present");
  const sculptModeChoice = html.slice(
    sculptModeChoiceStart,
    html.indexOf("</div>", sculptModeChoiceStart) + 6,
  );
  assert.match(sculptModeChoice, /role="group"[^>]*aria-label="[^"]*sculpt[^"]*"/i);
  assert.equal((sculptModeChoice.match(/<button\b/g) ?? []).length, SPECTRAL_SCULPT_MODES.length);
  assert.match(
    sculptModeChoice,
    /data-spectral-sculpt-mode="notches"[^>]*>Gaps<[\s\S]*data-spectral-sculpt-mode="ridges"[^>]*>Ridges<[\s\S]*data-spectral-sculpt-mode="lowpass"[^>]*>Low-pass<[\s\S]*data-spectral-sculpt-mode="highpass"[^>]*>High-pass<[\s\S]*data-spectral-sculpt-mode="bandpass"[^>]*>Window<[\s\S]*data-spectral-sculpt-mode="bandstop"[^>]*>Hollow<[\s\S]*data-spectral-sculpt-mode="peak"[^>]*>Peak<[\s\S]*data-spectral-sculpt-mode="tilt"[^>]*>Tilt</,
  );
  assert.match(html, /id="gestureCoupling"[^>]*type="range"/);
  for (const id of [
    "glideA", "glideB", "fieldASpeed", "fieldBSpeed", "autoPluckRate",
    "combDrift", "gestureMemory", "fabricExcitation", "fabricVibration",
    "fabricRate", "fabricSpin", "freezeChoice",
  ]) {
    assert.doesNotMatch(
      html,
      new RegExp(`id="${id}"`),
      `${id} must not expose audio-only automatic motion`,
    );
  }
  assert.doesNotMatch(html, /data-freeze=/);
  assert.match(
    html,
    /Touch left[\s\S]{0,120}low frequencies[\s\S]{0,120}right[\s\S]{0,120}high frequencies/i,
  );
  assert.match(
    html,
    /stores strain[^<]{0,180}broad[^<]{0,100}pull axis[^<]{0,180}fast flick/i,
  );
  assert.match(html, /id="fabricInstruction"[^>]*>touch a frequency · pull to sculpt</);
  assert.match(
    html,
    /id="propagationModeChoice"[\s\S]*data-propagation-mode="drop"[\s\S]*data-propagation-mode="harmonic"[\s\S]*data-propagation-mode="spiral"[\s\S]*data-propagation-mode="shock"[\s\S]*data-propagation-mode="gravity"[\s\S]*data-propagation-mode="standing"[\s\S]*data-propagation-mode="ocean"[\s\S]*data-propagation-mode="sheet"/,
  );
  const impactBodyChoiceStart = html.indexOf('id="impactBodyChoice"');
  assert.ok(impactBodyChoiceStart >= 0, "the impact-body chooser must be present");
  const impactBodyChoice = html.slice(
    impactBodyChoiceStart,
    html.indexOf("</div>", impactBodyChoiceStart) + 6,
  );
  assert.equal((impactBodyChoice.match(/<button\b/g) ?? []).length, FABRIC_IMPACT_BODIES.length);
  for (const body of FABRIC_IMPACT_BODIES) {
    assert.match(impactBodyChoice, new RegExp(`data-impact-body="${body}"`));
  }
  assert.match(html, /id="propagationRate"[^>]*min="1"[^>]*max="50"/);
  assert.match(html, /id="propagationVoices"[^>]*min="1"[^>]*max="4"/);
  assert.match(html, /id="propagationSizeSpread"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="propagationSpeedSpread"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="propagationInterference"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="grabRippleRate"[^>]*min="0"[^>]*max="30"/);
  assert.match(html, /id="fabricGravity"[^>]*min="0"[^>]*max="2"/);
  assert.match(html, /id="gridDensity"[^>]*min="8"[^>]*max="40"[^>]*value="20"/);
  assert.match(html, /id="combDepth"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="combTeeth"[^>]*min="1"[^>]*max="16"/);
  assert.match(html, /id="combWidth"[^>]*min="0\.02"[^>]*max="0\.48"/);
  assert.match(html, /id="combWarp"[^>]*min="0"[^>]*max="4"/);
  assert.match(html, /id="pluckCut"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /class="group-title">FFT \/ Q filtering<\/h2>/);
  assert.match(html, /id="spectralFilterBlend"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="fftCutDepth"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="fftSharpness"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="qCutDepth"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="qCharacter"[^>]*min="0"[^>]*max="1"/);
  assert.match(
    html,
    /Q filtering gives the sculpture physical resonance[\s\S]*FFT filtering reshapes exact frequency bins[\s\S]*eight shared shapes[\s\S]*gaps and ridges[\s\S]*shelves[\s\S]*window and hollow bands[\s\S]*resonant peak[\s\S]*spectral tilt/,
  );
  const legendStart = html.indexOf('<div class="moire-field-legend"');
  const legend = html.slice(legendStart, html.indexOf("</div>", legendStart) + 6);
  assert.match(
    legend,
    /class="texture"[\s\S]*?Vector grid[\s\S]*?class="comb-gap"[\s\S]*?Sculpted regions[\s\S]*?class="output-spectrum"[\s\S]*?Output spectrum/,
  );
  assert.doesNotMatch(
    legend,
    /Layered spectral texture|Warp strand|Weft strand|Shared interaction|Moving gaps/,
  );
  assert.doesNotMatch(html, /class="group-title">(?:Wave field A|Wave field B|Collision)</);
  assert.match(html, /for="propagationVoices"><span><b>Pebbles \/ max waves<\/b>/);
  assert.doesNotMatch(html, /data-preset=/, "preset names are rendered without embedded stats");
  for (const [, key] of new Set([
    ["", "noiseColor"], ["", "noiseChaos"], ["", "noiseFractalDepth"],
    ["", "filterPairs"],
    ["", "propagationRate"], ["", "propagationSpeed"], ["", "propagationDecay"],
    ["", "propagationDepth"], ["", "propagationGain"], ["", "propagationWidth"],
    ["", "harmonicOrder"], ["", "ringDensity"],
    ["", "propagationSizeSpread"], ["", "propagationSpeedSpread"],
    ["", "propagationInterference"], ["", "grabRippleRate"],
    ["", "propagationVoices"], ["", "combDepth"], ["", "combTeeth"],
    ["", "combWidth"], ["", "combOffset"],
    ["", "combWarp"], ["", "pluckCut"],
    ["", "gestureCoupling"],
    ["", "spectralFilterBlend"], ["", "fftCutDepth"], ["", "fftSharpness"],
    ["", "qCutDepth"], ["", "qCharacter"],
    ["", "gridDensity"], ["", "fabricSections"], ["", "fabricPatchwork"],
    ["", "fabricDepth"], ["", "fabricTension"], ["", "fabricRotation"],
    ["", "fabricGravity"],
    ["", "fieldAAngle"], ["", "fieldBAngle"], ["", "collisionAmount"],
    ["", "stereoWidth"], ["", "outputLevel"],
  ])) {
    assert.match(html, new RegExp(`<label[^>]+for="${key}"`));
    assert.match(html, new RegExp(`<output[^>]+for="${key}"`));
  }
  assert.doesNotMatch(appSource, /new\s+(?:AudioContext|webkitAudioContext)/);
  assert.doesNotMatch(appSource, /\$\("freezeChoice"\)|stepVisualSculptGesture/);
  const manualSettingsSource = namedFunctionSource(appSource, "manualFabricSettings");
  assert.match(manualSettingsSource, /MOIRE_DRONE_MANUAL_MOTION_SETTINGS/);
  const updateAudioParametersSource = namedFunctionSource(appSource, "updateAudioParameters");
  assert.match(updateAudioParametersSource, /manualFabricSettings\(state\.settings\)/);
  assert.match(appSource, /prefers-reduced-motion/);
  assert.match(appSource, /pointerdown/);
  assert.match(appSource, /fabricGesturePull/);
  assert.match(appSource, /audio\.tugFabric/);
  assert.match(appSource, /audio\.releaseFabric/);
  assert.match(
    appSource,
    /\$\("noiseColorChoice"\)\.querySelectorAll\("\[data-noise-color\]"\)[\s\S]*?button\.addEventListener\("click"[\s\S]*?setParameter\("noiseColor", value\)/,
  );
  assert.match(
    appSource,
    /\$\("noiseTypeChoice"\)\.querySelectorAll\("\[data-noise-type\]"\)[\s\S]*?button\.addEventListener\("click"[\s\S]*?setParameter\("noiseType", (?:type|button\.dataset\.noiseType)\)/,
  );
  assert.match(
    appSource,
    /\$\("spectralSculptModeChoice"\)\.querySelectorAll\("\[data-spectral-sculpt-mode\]"\)[\s\S]*?button\.addEventListener\("click"[\s\S]*?setParameter\("spectralSculptMode", button\.dataset\.spectralSculptMode\)/,
  );
  const applyPointerTugSource = appSource.slice(
    appSource.indexOf("function applyPointerTug("),
    appSource.indexOf("function tugFabricFromPointer("),
  );
  assert.match(
    applyPointerTugSource,
    /rotateFabricCoordinate\([\s\S]*?pointerCurrentX,[\s\S]*?pointerCurrentY,[\s\S]*?effectiveFabricAngle\(\)[\s\S]*?\)/,
    "the physical grab point must follow the user's hand across the fabric",
  );
  assert.match(
    applyPointerTugSource,
    /visualFabric\.tug\([A-Za-z_$][\w$]*\.x, [A-Za-z_$][\w$]*\.y, amount\)/,
  );
  assert.match(
    applyPointerTugSource,
    /const gesture\s*=\s*currentAudioGesture\(\)[\s\S]*?captureVisualSculptGesture\([\s\S]*?gesture,[\s\S]*?true[\s\S]*?audio\.tugFabric\([\s\S]*?pointerCurrentX,[\s\S]*?pointerCurrentY,[\s\S]*?amount,[\s\S]*?gesture[\s\S]*?\)/,
    "visual and audio tug paths must receive one identical gesture snapshot",
  );
  const audioGestureSource = appSource.slice(
    appSource.indexOf("function currentAudioGesture("),
    appSource.indexOf("function applyPointerTug("),
  );
  for (const field of [
    "currentX", "currentY", "deltaX", "deltaY", "distance", "velocityX", "velocityY",
  ]) assert.match(audioGestureSource, new RegExp(`\\b${field}\\b`));
  const pointerDownSource = appSource.slice(
    appSource.indexOf('$("stage").addEventListener("pointerdown"'),
    appSource.indexOf('$("stage").addEventListener("pointermove"'),
  );
  assert.doesNotMatch(
    pointerDownSource,
    /nearestFabricCell\(/,
    "the visible grab point must not snap away from the frequency sent to the DSP",
  );
  assert.match(pointerDownSource, /pointerAnchorX\s*=\s*point\.x/);
  assert.match(pointerDownSource, /pointerAnchorY\s*=\s*point\.y/);
  assert.match(
    pointerDownSource,
    /pointerAudioAnchorX\s*=\s*point\.x[\s\S]*?pointerAudioAnchorY\s*=\s*point\.y[\s\S]*?pointerRawCurrentX\s*=\s*point\.rawX[\s\S]*?pointerRawCurrentY\s*=\s*point\.rawY[\s\S]*?pointerPullAmount\s*=\s*fabricGesturePull\([\s\S]*?anchorX:\s*pointerAudioAnchorX[\s\S]*?anchorY:\s*pointerAudioAnchorY[\s\S]*?currentX:\s*pointerRawCurrentX[\s\S]*?currentY:\s*pointerRawCurrentY[\s\S]*?\)\.amount/,
    "the contact stays onstage while raw captured coordinates preserve edge strain",
  );
  assert.match(pointerDownSource, /applyPointerTug\(pointerPullAmount\)/);
  assert.match(pointerDownSource, /void ensureAudioOn\(\)/);
  assert.match(pointerDownSource, /fabricInstruction[\s\S]*?classList\.add\("dismissed"\)/);
  const samplePointerSource = namedFunctionSource(appSource, "samplePointerEvent");
  assert.match(samplePointerSource, /stagePointFromEvent\(event\)/);
  assert.match(samplePointerSource, /pointerCurrentX\s*=\s*point\.x/);
  assert.match(samplePointerSource, /pointerCurrentY\s*=\s*point\.y/);
  assert.match(samplePointerSource, /motionX\s*=\s*point\.rawX\s*-\s*pointerRawCurrentX/);
  assert.match(samplePointerSource, /motionY\s*=\s*point\.rawY\s*-\s*pointerRawCurrentY/);
  assert.match(samplePointerSource, /velocityAge\s*=\s*Math\.max\(0, now - pointerLastMotionTime\)/);
  assert.match(samplePointerSource, /pointerVelocityX\s*\*=\s*retainedVelocity/);
  assert.match(samplePointerSource, /pointerVelocityY\s*\*=\s*retainedVelocity/);
  assert.match(samplePointerSource, /pointerRawCurrentX\s*=\s*point\.rawX/);
  assert.match(samplePointerSource, /pointerRawCurrentY\s*=\s*point\.rawY/);
  assert.match(
    samplePointerSource,
    /pointerWakeTravel\s*=\s*Math\.min\([\s\S]*?pointerWakeTravel\s*\+/,
  );
  assert.doesNotMatch(
    samplePointerSource,
    /pointerWakeTravel\s*=\s*0/,
    "ordinary move samples must accumulate rather than erase grab-wake travel",
  );
  assert.match(pointerDownSource, /pointerLastRippleTime\s*=/);
  assert.match(pointerDownSource, /pointerWakeCount\s*=\s*0/);
  assert.match(pointerDownSource, /pointerWakeTravel\s*=\s*0/);
  assert.match(
    pointerDownSource,
    /ensureAudioOn\(\)[\s\S]*?emitFirstGrabWake\(/,
    "a drag that outruns audio startup must emit its first wake when audio becomes ready",
  );
  const pointerMoveSource = namedFunctionSource(appSource, "tugFabricFromPointer");
  assert.match(
    pointerMoveSource,
    /samplePointerEvent\(event,\s*\{\s*drawNow:\s*false\s*\}\)/,
    "high-rate pointer samples must be coalesced into the RAF paint loop",
  );
  assert.match(pointerMoveSource, /emitFirstGrabWake\(/);
  assert.match(
    pointerMoveSource,
    /maybeEmitGrabRipple\(/,
    "moving a held patch must be able to emit ripples before release",
  );
  const firstWakeSource = namedFunctionSource(appSource, "emitFirstGrabWake");
  assert.match(firstWakeSource, /pointerWakeCount\s*!==\s*0/);
  assert.match(firstWakeSource, /!state\.audioOn/);
  assert.match(firstWakeSource, /triggerDirectGrabWake\(/);
  assert.match(firstWakeSource, /applyPointerTug\(pointerPullAmount\)/);
  const directWakeSource = namedFunctionSource(appSource, "directGrabWakeProfile");
  assert.match(directWakeSource, /0\.68/);
  const directWakeTriggerSource = namedFunctionSource(appSource, "triggerDirectGrabWake");
  assert.match(
    directWakeTriggerSource,
    /triggerElasticWaveAt\(x, y, wake\.force, wake\.radius, gesture\)/,
    "the first grab wake must use the same directional elastic release model",
  );
  const grabRippleSource = namedFunctionSource(appSource, "maybeEmitGrabRipple");
  assert.match(grabRippleSource, /pointerId\s*===\s*null|pointerId\s*!==\s*null/);
  assert.match(grabRippleSource, /pointerWakeCount\s*===\s*0/);
  assert.match(grabRippleSource, /settings\.grabRippleRate/);
  assert.match(grabRippleSource, /(?:elapsed|interval|time|timestamp|performance\.now)/i);
  assert.match(grabRippleSource, /(?:travel|distance|Math\.hypot)/i);
  assert.match(grabRippleSource, /triggerElasticWaveAt\(/);
  assert.match(
    grabRippleSource,
    /fabricScale:\s*0\.32\b/,
    "drag ripples must use the same physical impulse as the audio membrane",
  );
  assert.doesNotMatch(
    grabRippleSource,
    /autoPluckRate/,
    "grab ripples must be driven only by the user's held gesture",
  );
  const releasePointerSource = appSource.slice(
    appSource.indexOf("async function releasePointer("),
    appSource.indexOf('$("stage").addEventListener("pointerup"'),
  );
  const finalPointerSample = releasePointerSource.search(/samplePointerEvent\(\s*event\b/);
  const releaseGestureCapture = releasePointerSource.indexOf(
    "const releaseGesture = currentAudioGesture(",
  );
  assert.ok(
    finalPointerSample >= 0 && finalPointerSample < releaseGestureCapture,
    "pointerup must sample its final coordinates before making the release packet",
  );
  assert.match(
    releasePointerSource,
    /const wasQuickTap = !wasDrag && releasedAt - pointerStartTime <= 350/,
  );
  assert.match(
    releasePointerSource,
    /if \(!wasQuickTap\) \{[\s\S]*?return;\s*\}[\s\S]*?triggerImpactAt\(/,
  );
  assert.equal(
    (releasePointerSource.match(/triggerImpactAt\(/g) ?? []).length,
    1,
    "a quick stationary tap must create exactly one selected impact",
  );
  assert.match(
    releasePointerSource,
    /if \(wasDrag && !cancelled\) \{[\s\S]*?triggerElasticWaveAt\([\s\S]*?releaseGesture,[\s\S]*?\{ sendAudio: false \}/,
    "the visual release must launch the derived sheet without double-firing audio",
  );
  for (const axis of ["X", "Y"]) {
    assert.match(releasePointerSource, new RegExp(`visualPullOffset${axis}\\s*=\\s*0`));
  }
  assert.match(releasePointerSource, /const releaseGesture = currentAudioGesture\(/);
  assert.match(releasePointerSource, /audio\.releaseFabric\(releaseGesture\)/);
  assert.match(releasePointerSource, /const releaseCurrentX\s*=\s*pointerCurrentX/);
  assert.match(releasePointerSource, /const releaseCurrentY\s*=\s*pointerCurrentY/);
  assert.match(
    releasePointerSource,
    /audio\.kickFabric\([\s\S]*?releaseCurrentX,[\s\S]*?releaseCurrentY,[\s\S]*?releaseGesture,[\s\S]*?\)/,
    "release energy must follow the hand instead of snapping back to its anchor",
  );
  assert.match(
    releasePointerSource,
    /if \(!audioWasReady\) \{[\s\S]*?triggerElasticWaveAt\([\s\S]*?releasePull,[\s\S]*?releaseRadius,[\s\S]*?releaseGesture,[\s\S]*?\{ sendAudio: false \}[\s\S]*?\}[\s\S]*?audio\.kickFabric\([\s\S]*?releasePull,[\s\S]*?releaseRadius,[\s\S]*?releaseGesture/,
    "audio startup must restore the same derived release wave to both membranes",
  );
  assert.match(appSource, /grabRippleRate[\s\S]*?"onset only"/);
  assert.match(cssSource, /#stage\s*\{[\s\S]*?cursor:\s*grab/);
  assert.match(cssSource, /#stage\.is-grabbed[\s\S]*?cursor:\s*grabbing/);
  assert.match(
    appSource,
    /function ensureAudioOn\(\)[\s\S]*?if \(audioStartPromise\) return audioStartPromise[\s\S]*?audioStartPromise = \(async \(\) => \{[\s\S]*?await audio\.start\(\)[\s\S]*?return true[\s\S]*?return audioStartPromise/,
  );
  assert.match(
    appSource,
    /\$\("fabricExciteButton"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?if \(!await ensureAudioOn\(\)\) return;[\s\S]*?triggerImpactAt\(/,
  );
  assert.match(
    appSource,
    /\$\("stage"\)\.addEventListener\("keydown", async \(event\) => \{[\s\S]*?event\.key === "Enter"[\s\S]*?if \(!await ensureAudioOn\(\)\) return;[\s\S]*?triggerImpactAt\(/,
  );
  assert.match(appSource, /audio\.impactFabric\(/);
  assert.match(appSource, /visualPropagation\.triggerGroup\(propagationGroup\)/);
  assert.match(appSource, /elasticReleaseProfile\(/);
  assert.match(appSource, /visualPropagation\.sampleVector\(/);
  const triggerPropagationSource = namedFunctionSource(appSource, "triggerPropagationAt");
  assert.match(triggerPropagationSource, /if \(sendAudio\)\s*\{/);
  assert.match(triggerPropagationSource, /captureVisualSculptGesture\(/);
  assert.match(triggerPropagationSource, /sizeSpread:\s*sizeSpread \?\? settings\.propagationSizeSpread/);
  assert.match(triggerPropagationSource, /speedSpread:\s*speedSpread \?\? settings\.propagationSpeedSpread/);
  assert.match(
    triggerPropagationSource,
    /audio\.pluckFabric\(audioX, audioY, force, radius, gesture\)/,
  );
  const gridColumns = Number(
    appSource.match(/const STATIC_GRID_COLUMNS\s*=\s*(\d+)\b/)?.[1],
  );
  const gridRows = Number(
    appSource.match(/const STATIC_GRID_ROWS\s*=\s*(\d+)\b/)?.[1],
  );
  assert.equal(gridColumns, 28, "the default grid must be visibly finer");
  assert.equal(gridRows, 20, "the default grid must be visibly finer");
  const gridDimensionsSource = namedFunctionSource(appSource, "staticGridDimensions");
  assert.match(gridDimensionsSource, /state\.gridDensity/);
  assert.match(gridDimensionsSource, /STATIC_GRID_COLUMNS[\s\S]*?STATIC_GRID_ROWS/);
  assert.match(
    appSource,
    /\$\("gridDensity"\)\.addEventListener\("input"[\s\S]*?state\.gridDensity[\s\S]*?draw\(performance\.now\(\), true\)/,
  );
  assert.match(appSource, /const STATIC_GRID_PINK\s*=\s*"#ff5cad"/i);
  assert.match(appSource, /const STATIC_GRID_GREEN\s*=\s*"#68f7a4"/i);
  const staticGridRenderer = namedFunctionSource(appSource, "drawStaticVectorGrid");
  assert.match(staticGridRenderer, /column\s*\/\s*columns\s*\*\s*2\s*-\s*1/);
  assert.match(staticGridRenderer, /row\s*\/\s*rows\s*\*\s*2\s*-\s*1/);
  assert.doesNotMatch(
    staticGridRenderer,
    /fabricSectionDimensions|columnPositions|columnSpans|rowPositions|rowSpans/,
    "every visible resting-grid interval must be uniform",
  );
  assert.match(staticGridRenderer, /STATIC_GRID_PINK/);
  assert.match(staticGridRenderer, /STATIC_GRID_GREEN/);
  assert.match(staticGridRenderer, /context2d\.beginPath\(\)/);
  assert.match(staticGridRenderer, /context2d\.moveTo\(/);
  assert.match(staticGridRenderer, /context2d\.lineTo\(/);
  assert.match(staticGridRenderer, /context2d\.stroke\(\)/);
  assert.match(staticGridRenderer, /context2d\.lineCap\s*=\s*"butt"/);
  assert.match(staticGridRenderer, /context2d\.shadowBlur\s*=\s*0/);
  assert.doesNotMatch(
    staticGridRenderer,
    /(?:putImageData|drawImage|createImageData|waveFieldValue|bezierCurveTo|quadraticCurveTo)\(/,
    "the clear two-color grid must be drawn as canvas paths, not a raster texture",
  );
  const drawTimingSource = namedFunctionSource(appSource, "draw");
  assert.match(
    drawTimingSource,
    /pointerId\s*!==\s*null\s*\?\s*0/,
    "direct manipulation must follow each RAF rather than a mismatched refresh-rate cap",
  );
  assert.match(
    drawTimingSource,
    /staticGridHasDeformation\(\)[\s\S]*?ACTIVE_DEFORMATION_FRAME_RATE[\s\S]*?:\s*AUDIO_VISUAL_FRAME_RATE/,
    "released fabric motion must stay smoother than the audio-only analyzer",
  );
  assert.match(
    drawTimingSource,
    /Math\.floor\([\s\S]*?elapsed\s*\+\s*FRAME_INTERVAL_TOLERANCE_MS[\s\S]*?frameInterval[\s\S]*?lastDrawTime\s*\+\s*completedIntervals\s*\*\s*frameInterval/,
    "frame pacing must tolerate timestamp rounding and carry its target phase",
  );
  const staticGridPointSource = namedFunctionSource(appSource, "staticGridPoint");
  assert.match(
    staticGridPointSource,
    /visualPullOffsetAt/,
    "direct pointer pulls must still deform the static grid",
  );
  assert.match(
    staticGridPointSource,
    /visualFabric\.(?:sample|sampleLocal)[\s\S]*visualPropagation\.sampleVector/,
    "fabric tugs and manual pluck ripples must still deform the static grid",
  );
  assert.match(
    staticGridPointSource,
    /visualPropagation\.sampleVector\([\s\S]*?settings\.propagationInterference/,
    "the visible waves must use the same interference control as the audible field",
  );
  assert.doesNotMatch(staticGridPointSource, /waveFieldValue\(|Math\.random\(/);
  assert.doesNotMatch(appSource, /function drawFabricMesh|function drawPropagationOverlays/);
  const sculptGeometrySource = namedFunctionSource(appSource, "visualSculptGeometry");
  for (const dimension of ["focus", "width", "depth", "character"]) {
    assert.match(
      sculptGeometrySource,
      new RegExp(`\\b${dimension}\\b`),
      `visual sculpt geometry must expose ${dimension}`,
    );
  }
  assert.match(
    sculptGeometrySource,
    /pointer|gesture|visualSculpt/i,
    "the displayed spectral shape must be derived from live gesture state",
  );
  assert.match(
    sculptGeometrySource,
    /visualDirectGestureResponse\(\)[\s\S]*?qDepth:\s*Math\.max[\s\S]*?fftDepth:\s*Math\.max/,
    "the displayed Q/FFT sculpture must show the same guaranteed manual floor as the DSP",
  );
  const visualGestureFloorSource = namedFunctionSource(
    appSource,
    "visualDirectGestureResponse",
  );
  assert.match(visualGestureFloorSource, /0\.42[\s\S]*?0\.55/);
  const captureVisualGestureSource = namedFunctionSource(
    appSource,
    "captureVisualSculptGesture",
  );
  assert.match(captureVisualGestureSource, /focus|currentX|pointerCurrentX/);
  assert.match(captureVisualGestureSource, /width|currentY|deltaY|pointerCurrentY/);
  assert.match(captureVisualGestureSource, /depth|amount|distance|pointerPullAmount/);
  assert.match(
    captureVisualGestureSource,
    /visualSculptGestureEnvelope\s*=\s*active\s*\?\s*1\s*:\s*0/,
    "released direct manipulation must not leave an invisible visual memory tail",
  );
  const visualCombGeometrySource = namedFunctionSource(appSource, "updateVisualCombGeometry");
  assert.match(visualCombGeometrySource, /visualSculptGeometry\(\)/);
  assert.match(visualCombGeometrySource, /\.focus\b/);
  const spectralMaskSource = namedFunctionSource(appSource, "drawSpectralCombMask");
  assert.match(spectralMaskSource, /visualSculptGeometry\(\)|currentVisualSculpt/);
  assert.match(spectralMaskSource, /\.focus\b/);
  assert.match(spectralMaskSource, /\.width\b/);
  assert.match(spectralMaskSource, /\.(?:qDepth|fftDepth)\b/);
  assert.doesNotMatch(
    spectralMaskSource,
    /focus:\s*settings\.combOffset/,
    "the visual response must follow gesture focus rather than only the static offset",
  );
  const broadRegionsSource = namedFunctionSource(appSource, "drawBroadSculptRegions");
  assert.match(broadRegionsSource, /visualSculptGeometry\(\)|currentVisualSculpt/);
  assert.match(broadRegionsSource, /sculpt\.periodic/);
  assert.match(broadRegionsSource, /mode:\s*settings\.spectralSculptMode/);
  assert.match(broadRegionsSource, /combinedSpectralGain\(/);
  assert.match(
    broadRegionsSource,
    /context2d\.(?:fillRect|ellipse|arc|fill)\(/,
    "broad sculpt modes need a visible region on the fabric, not only a thin response strip",
  );
  const drawSource = namedFunctionSource(appSource, "draw");
  assert.match(drawSource, /drawBroadSculptRegions\(\)/);
  assert.match(drawSource, /drawStaticVectorGrid\(\)/);
  assert.doesNotMatch(drawSource, /renderSpectralTexture\(\)|drawImage\(\s*textureCanvas/);
  const combinedGainSource = namedFunctionSource(appSource, "combinedSpectralGain");
  assert.match(combinedGainSource, /CUT_SCULPT_MODES\.has\(mode\)/);
  assert.match(combinedGainSource, /qGain\s*\*\s*fftGain/);
  assert.match(combinedGainSource, /4\s*\*\s*amount\s*\*\s*\(1\s*-\s*amount\)/);
  assert.match(
    spectralMaskSource,
    /combinedSpectralGain\(/,
    "the displayed mask must show the same serial hybrid intersection as the audio",
  );
  const animateSource = namedFunctionSource(appSource, "animate");
  assert.doesNotMatch(animateSource, /stepVisualSculptGesture\(/);
  assert.doesNotMatch(
    animateSource,
    /state\.(?:shepardPhaseA|shepardPhaseB|fieldPhaseA|fieldPhaseB|fabricSpinPhase|combPhase)\s*=/,
    "the background field, lattice, and sculpt phases must not advance on their own",
  );
  assert.doesNotMatch(
    animateSource,
    /triggerAutomaticVisualPropagation\(|autoPluckRate|maybeEmitGrabRipple\(/,
    "the static visual page must not create automatic background ripples",
  );
  assert.match(
    animateSource,
    /if\s*\(\s*staticGridHasDeformation\(\)\s*\)\s*\{[\s\S]*?visualFabric\.step\(\s*elapsed\s*,\s*settings\s*,\s*true\s*,\s*visualDirectGestureResponse\(\)\s*,?\s*\)/,
    "fabric simulation may advance only while a direct interaction is active or decaying",
  );
  assert.match(
    animateSource,
    /visualPropagation\.step\(\s*elapsed\s*\)/,
    "manual pluck ripples must keep their visible decay after autonomous motion is removed",
  );
  const activeVisualInteractionSource = namedFunctionSource(
    appSource,
    "staticGridHasDeformation",
  );
  assert.match(activeVisualInteractionSource, /pointerId\s*!==\s*null/);
  assert.match(activeVisualInteractionSource, /visualPropagation\.activeCount/);
  assert.match(
    activeVisualInteractionSource,
    /visualPull(?:Offset|Velocity)|visualSculptGestureEnvelope/,
  );
  assert.match(
    appSource,
    /captureVisualSculptGesture\([\s\S]*?applyPointerTug|applyPointerTug[\s\S]*?captureVisualSculptGesture\(/,
  );
  const effectiveFilterCountSource = namedFunctionSource(appSource, "effectiveFilterCount");
  assert.match(effectiveFilterCountSource, /state\.settings\.filterPairs/);
  assert.match(
    effectiveFilterCountSource,
    /state\.quality\.(?:activeFilters|tier)/,
    "the UI count must reconcile the adaptive tier with the current lattice size",
  );
  const stageReadoutSource = namedFunctionSource(appSource, "updateStageReadout");
  assert.match(stageReadoutSource, /effectiveFilterCount\(\)/);
  const updateInterfaceSource = namedFunctionSource(appSource, "updateInterface");
  assert.match(updateInterfaceSource, /effectiveFilterCount\(\)/);
  assert.doesNotMatch(
    appSource,
    /function drawFilterNodes\s*\(/,
    "the static vector page must not layer filter-node markers over its clear grid",
  );
  assert.doesNotMatch(drawSource, /drawFilterNodes\(\)/);
  assert.doesNotMatch(
    appSource,
    /\bmoireFilterTarget\b/,
    "the clean static grid must not render the old animated filter-node lattice",
  );
  assert.match(appSource, /settings\.lowFrequency[\s\S]*settings\.highFrequency \/ settings\.lowFrequency/);
  assert.match(appSource, /function updatePropagationStatus[\s\S]*?updateStageReadout\(\)/);
  assert.match(appSource, /resetVisualDynamics\(\{ resetComb: false \}\)[\s\S]*?audio\.resetFabric\(\{ resetComb: false \}\)/);
  const presetRenderer = appSource.slice(
    appSource.indexOf("function renderPresets()"),
    appSource.indexOf("function setParameter("),
  );
  assert.match(presetRenderer, /label\.textContent = preset\.label/);
  assert.match(presetRenderer, /button\.append\(label\)/);
  assert.doesNotMatch(presetRenderer, /preset\.settings|innerHTML/);
  assert.match(appSource, /pagehide/);
  assert.match(appSource, /audioState"\)\.textContent = state\.audioOn \? "on" : "off"/);
});

test("spectral-fabric parameters sanitize to finite physical limits", () => {
  const settings = sanitizeMoireDroneParams({
    fabricTension: -99,
    fabricDamping: 99,
    fabricInertia: Number.NaN,
    fabricSections: 99,
    fabricPatchwork: -99,
    fabricDepth: 99,
    fabricExcitation: -4,
    fabricVibration: 4,
    fabricRate: 0,
    fabricRotation: 999,
    fabricSpin: -99,
    fabricPull: 99,
    fabricGravity: 99,
  });

  assert.equal(settings.fabricTension, 0);
  assert.equal(settings.fabricDamping, 1);
  assert.equal(settings.fabricInertia, MOIRE_DRONE_DEFAULTS.fabricInertia);
  assert.equal(settings.fabricSections, MOIRE_DRONE_LIMITS.maxFabricSections);
  assert.equal(settings.fabricPatchwork, 0);
  assert.equal(settings.fabricDepth, MOIRE_DRONE_LIMITS.maxFabricDepth);
  assert.equal(settings.fabricExcitation, 0);
  assert.equal(settings.fabricVibration, 1);
  assert.equal(settings.fabricRate, 0.05);
  assert.equal(settings.fabricRotation, 180);
  assert.equal(settings.fabricSpin, -MOIRE_DRONE_LIMITS.maxFabricSpin);
  assert.equal(settings.fabricPull, 2);
  assert.equal(settings.fabricGravity, 2);
  assert.equal(
    MOIRE_DRONE_LIMITS.fabricWidth * MOIRE_DRONE_LIMITS.fabricHeight,
    MOIRE_DRONE_LIMITS.fabricNodes,
  );
  assert.equal(MOIRE_DRONE_DEFAULTS.fabricSections, 8);
  assert.equal(MOIRE_DRONE_DEFAULTS.fabricPatchwork, 0.35);
  assert.equal(fabricHeightForSections(8), 6);
  assert.equal(fabricHeightForSections(3), 3);
  assert.equal(fabricHeightForSections(16), 12);
  const minimum = sanitizeMoireDroneParams({
    fabricSections: -99,
    fabricPatchwork: 99,
  });
  assert.equal(minimum.fabricSections, MOIRE_DRONE_LIMITS.minFabricSections);
  assert.equal(minimum.fabricPatchwork, 1);
});

test("fabric section count configures the actual physical topology", () => {
  const defaultFabric = new SpectralFabric();
  assert.equal(defaultFabric.width, 8);
  assert.equal(defaultFabric.height, 6);
  assert.equal(defaultFabric.nodeCount, 48);
  assert.equal(defaultFabric.patchwork, 0.35);

  for (const sections of [3, 5, 9, 12, 16]) {
    const fabric = new SpectralFabric({ width: sections, patchwork: 0 });
    const height = Math.max(3, Math.round(sections * 0.75));
    assert.equal(fabric.width, sections);
    assert.equal(fabric.height, height);
    assert.equal(fabric.nodeCount, sections * height);
    assert.equal(fabric.displacement.length, fabric.nodeCount);
    assert.equal(fabric.nodeX.length, fabric.nodeCount);
    assert.equal(fabric.horizontalSpringWeight.length, fabric.nodeCount);
  }

  const snapshot = defaultFabric.topology;
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.columnPositions));
  assert.ok(Object.isFrozen(snapshot.nodeMass));
  assert.equal(snapshot.width, defaultFabric.width);
  assert.equal(snapshot.height, defaultFabric.height);
  assert.equal(snapshot.nodeCount, defaultFabric.nodeCount);
});

test("patchwork topology is seeded, nonuniform, and exactly uniform at zero", () => {
  const first = new SpectralFabric({ width: 11, patchwork: 1, seed: 0x12345678 });
  const second = new SpectralFabric({ width: 11, patchwork: 1, seed: 0x12345678 });
  const other = new SpectralFabric({ width: 11, patchwork: 1, seed: 0x87654321 });
  assert.deepEqual(first.topology, second.topology);
  assert.notDeepEqual(first.columnSpans, other.columnSpans);
  assert.notDeepEqual(first.nodeMass, other.nodeMass);
  assert.ok(Math.abs(first.columnSpans.reduce((sum, value) => sum + value, 0) - 2) < 1e-12);
  assert.ok(Math.abs(first.rowSpans.reduce((sum, value) => sum + value, 0) - 2) < 1e-12);
  assert.ok(new Set(Array.from(first.columnSpans, (value) => value.toFixed(8))).size > 1);
  assert.ok(new Set(Array.from(first.rowSpans, (value) => value.toFixed(8))).size > 1);
  assert.ok(new Set(Array.from(first.nodeMass, (value) => value.toFixed(8))).size > 4);
  assert.ok(new Set(Array.from(first.nodeDamping, (value) => value.toFixed(8))).size > 4);
  assert.ok(
    first.horizontalSpringWeight.some((value, index) => (
      Math.abs(value - first.verticalSpringWeight[index]) > 0.05
    )),
    "horizontal and vertical edges need independent material weights",
  );
  assert.ok(first.columnPositions.every((value, index, values) => (
    index === 0 || value > values[index - 1]
  )));
  assert.ok(first.rowPositions.every((value, index, values) => (
    index === 0 || value > values[index - 1]
  )));

  const uniform = new SpectralFabric({ width: 8, height: 6, patchwork: 0, seed: 17 });
  for (let column = 0; column < uniform.width; column += 1) {
    assert.equal(uniform.columnSpans[column], 2 / uniform.width);
    assert.equal(
      uniform.columnPositions[column],
      (column + 0.5) / uniform.width * 2 - 1,
    );
  }
  for (let row = 0; row < uniform.height; row += 1) {
    assert.equal(uniform.rowSpans[row], 2 / uniform.height);
    assert.equal(
      uniform.rowPositions[row],
      (row + 0.5) / uniform.height * 2 - 1,
    );
  }
  for (const values of [uniform.nodeMass, uniform.nodeDamping]) {
    assert.ok(values.every((value) => value === 1));
  }
  for (let row = 0; row < uniform.height; row += 1) {
    for (let column = 0; column < uniform.width; column += 1) {
      const index = row * uniform.width + column;
      assert.equal(uniform.horizontalSpringWeight[index], column === uniform.width - 1 ? 2 : 1);
      assert.equal(uniform.verticalSpringWeight[index], row === uniform.height - 1 ? 2 : 1);
    }
  }

  for (let index = 0; index < uniform.nodeCount; index += 1) {
    uniform.displacement[index] = Math.sin(index * 0.73);
  }
  assert.equal(uniform.sampleLocal(-1, 0), 0);
  assert.equal(uniform.sampleLocal(1, 0), 0);
  assert.equal(uniform.sampleLocal(0, -1), 0);
  assert.equal(uniform.sampleLocal(0, 1), 0);
  for (let row = 0; row < uniform.height; row += 1) {
    for (let column = 0; column < uniform.width; column += 1) {
      const expected = uniform.displacement[row * uniform.width + column];
      assert.ok(Math.abs(uniform.sampleLocal(
        uniform.columnPositions[column],
        uniform.rowPositions[row],
      ) - expected) < 2e-12);
    }
  }
  const x0 = 2;
  const y0 = 1;
  const midpointX = (uniform.columnPositions[x0] + uniform.columnPositions[x0 + 1]) * 0.5;
  const midpointY = (uniform.rowPositions[y0] + uniform.rowPositions[y0 + 1]) * 0.5;
  const midpointExpected = (
    uniform.displacement[y0 * uniform.width + x0]
    + uniform.displacement[y0 * uniform.width + x0 + 1]
    + uniform.displacement[(y0 + 1) * uniform.width + x0]
    + uniform.displacement[(y0 + 1) * uniform.width + x0 + 1]
  ) * 0.25;
  assert.ok(Math.abs(uniform.sampleLocal(midpointX, midpointY) - midpointExpected) < 2e-12);
});

test("unequal patchwork vertices and edges change local membrane response", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricTension: 0.82,
    fabricDamping: 0.18,
    fabricInertia: 0.3,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricGravity: 0,
  };
  const patchwork = new SpectralFabric({
    width: 10, patchwork: 1, seed: 0x5eed1234,
  });
  const uniform = new SpectralFabric({
    width: 10, patchwork: 0, seed: 0x5eed1234,
  });
  const source = 4 * patchwork.width + 4;
  patchwork.displacement[source] = 0.9;
  uniform.displacement[source] = 0.9;
  patchwork.step(1 / 240, parameters, true);
  uniform.step(1 / 240, parameters, true);
  assert.notDeepEqual(patchwork.acceleration, uniform.acceleration);

  const left = source - 1;
  const right = source + 1;
  const up = source - patchwork.width;
  const down = source + patchwork.width;
  const neighborAccelerations = [left, right, up, down].map((index) => (
    patchwork.acceleration[index]
  ));
  assert.ok(
    new Set(neighborAccelerations.map((value) => value.toFixed(8))).size >= 3,
    "unequal edge springs and vertex masses must split neighboring responses",
  );

  const localX = patchwork.nodeX[source];
  const localY = patchwork.nodeY[source];
  patchwork.reset();
  patchwork.excite(localX, localY, 1, 0.04);
  assert.equal(
    patchwork.velocity[source],
    Math.max(...patchwork.velocity),
    "excitation must follow the nonuniform physical vertex locations",
  );
  assert.ok(Math.abs(patchwork.sampleVelocityLocal(localX, localY) - patchwork.velocity[source]) < 1e-12);
});

test("fabric sections refine one membrane without changing its physical time scale", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricTension: 0.58,
    fabricDamping: 0,
    fabricInertia: 0.5,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricGravity: 0,
  };
  const firstCrossings = [3, 8, 16].map((width) => {
    const fabric = new SpectralFabric({ width, patchwork: 0, seed: 31 });
    for (let index = 0; index < fabric.nodeCount; index += 1) {
      fabric.displacement[index] = Math.cos(Math.PI * fabric.nodeX[index] * 0.5)
        * Math.cos(Math.PI * fabric.nodeY[index] * 0.5) * 0.1;
    }
    const center = Math.floor(fabric.height / 2) * fabric.width + Math.floor(fabric.width / 2);
    let elapsed = 0;
    while (elapsed < 0.5 && fabric.displacement[center] > 0) {
      fabric.step(1 / 2_000, parameters, true);
      elapsed += 1 / 2_000;
    }
    return elapsed;
  });
  assert.ok(Math.max(...firstCrossings) - Math.min(...firstCrossings) < 0.015);

  const heavilyBraked = new SpectralFabric({ width: 16, patchwork: 1, seed: 42 });
  for (let index = 0; index < heavilyBraked.nodeCount; index += 1) {
    heavilyBraked.displacement[index] = Math.cos(Math.PI * heavilyBraked.nodeX[index] * 0.5)
      * Math.cos(Math.PI * heavilyBraked.nodeY[index] * 0.5) * 0.7;
  }
  for (let frame = 0; frame < 600; frame += 1) {
    heavilyBraked.step(1 / 60, {
      ...parameters,
      fabricTension: 0,
      fabricDamping: 1,
      fabricInertia: 1,
    }, true);
  }
  assert.ok(heavilyBraked.energy < 0.001, "maximum brake must settle instead of overdamped creeping");
});

test("the kernel reconfigures physical topology immediately and deterministically", () => {
  const kernel = new MoireDroneKernel({
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      freeze: true,
      fabricExcitation: 0,
      fabricVibration: 0,
    },
  });
  assert.equal(kernel.fabric.width, 8);
  assert.equal(kernel.fabric.height, 6);
  assert.equal(kernel.fabric.patchwork, 0.35);
  const initialState = kernel.fabric.displacement;
  const initialVersion = kernel.fabric.topologyVersion;

  const changed = kernel.setParameters({
    fabricSections: 13,
    fabricPatchwork: 0.9,
  });
  assert.equal(changed.fabricSections, 13);
  assert.equal(changed.fabricPatchwork, 0.9);
  assert.equal(kernel.fabric.width, 13);
  assert.equal(kernel.fabric.height, 10);
  assert.equal(kernel.fabric.nodeCount, 130);
  assert.equal(kernel.fabric.patchwork, 0.9);
  assert.notStrictEqual(kernel.fabric.displacement, initialState);
  assert.ok(kernel.fabric.topologyVersion > initialVersion);
  kernel.updateTargets(true);
  assert.equal(kernel.current.fabricSections, 13);
  assert.equal(kernel.current.fabricPatchwork, 0.9);

  const deterministicSeed = 0x2468ace0;
  kernel.setParameters({ seed: deterministicSeed });
  const expectedTopology = kernel.fabric.topology;
  const topologyArrays = {
    nodeX: kernel.fabric.nodeX,
    displacement: kernel.fabric.displacement,
  };
  kernel.setParameters({ seed: 0x13579bdf });
  assert.notDeepEqual(kernel.fabric.topology.nodeMass, expectedTopology.nodeMass);
  kernel.setParameters({ seed: deterministicSeed });
  assert.deepEqual(kernel.fabric.topology.columnSpans, expectedTopology.columnSpans);
  assert.deepEqual(kernel.fabric.topology.rowSpans, expectedTopology.rowSpans);
  assert.deepEqual(kernel.fabric.topology.nodeMass, expectedTopology.nodeMass);
  assert.strictEqual(kernel.fabric.nodeX, topologyArrays.nodeX);
  assert.strictEqual(kernel.fabric.displacement, topologyArrays.displacement);

  const patchworkState = kernel.fabric.displacement;
  kernel.setParameters({ fabricPatchwork: 0 });
  assert.notStrictEqual(kernel.fabric.displacement, patchworkState);
  assert.ok(kernel.fabric.nodeMass.every((value) => value === 1));
  for (let row = 0; row < kernel.fabric.height; row += 1) {
    for (let column = 0; column < kernel.fabric.width; column += 1) {
      const index = row * kernel.fabric.width + column;
      assert.equal(
        kernel.fabric.horizontalSpringWeight[index],
        column === kernel.fabric.width - 1 ? 2 : 1,
      );
    }
  }

  kernel.setActive(true);
  kernel.tugFabric(0.72, -0.61, 0.95, {
    currentX: -0.34,
    currentY: 0.48,
    deltaX: -1.06,
    deltaY: 1.09,
    distance: 1.52,
    velocityX: -2.2,
    velocityY: 1.7,
  });
  const rendered = renderKernel(kernel, BLOCK_SIZE * 48);
  assertFiniteBounded([rendered.left, rendered.right]);
  assert.ok(kernel.fabric.energy > 0.01, "a rebuilt topology must retain serious pull response");
});

test("gravity is bounded and materially changes a grabbed fabric", () => {
  const common = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricTension: 0.62,
    fabricDamping: 0.24,
    fabricInertia: 0.42,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricPull: 1.4,
  };
  const weightless = new SpectralFabric({ seed: 0x51515151 });
  const weighted = new SpectralFabric({ seed: 0x51515151 });
  weightless.tug(0.38, -0.26, 0.86);
  weighted.tug(0.38, -0.26, 0.86);
  for (let frame = 0; frame < 90; frame += 1) {
    weightless.step(1 / 120, { ...common, fabricGravity: 0 }, true);
    weighted.step(1 / 120, { ...common, fabricGravity: 2 }, true);
  }
  assert.notDeepEqual(
    weighted.displacement,
    weightless.displacement,
    "gravity must add a physical restoring/bending force while the fabric is grabbed",
  );
  for (const values of [weighted.displacement, weighted.velocity, weighted.acceleration]) {
    assert.ok(values.every(Number.isFinite));
  }
  assert.ok(weighted.displacement.every((value) => Math.abs(value) <= 1.2));
  assert.ok(weighted.velocity.every((value) => Math.abs(value) <= 16));
  assert.ok(weighted.acceleration.every((value) => Math.abs(value) <= 8_000));
});

test("fabric impulses are local, fixed-frame, deterministic, and bounded", () => {
  assert.equal(fabricImpulseWeight(0.2, -0.3, 0.2, -0.3, 0.2), 1);
  const near = fabricImpulseWeight(0.24, -0.28, 0.2, -0.3, 0.2);
  const far = fabricImpulseWeight(-0.5, 0.6, 0.2, -0.3, 0.2);
  assert.ok(near > far * 1_000);
  assert.ok(
    fabricImpulseWeight(-0.99, 0, 0.99, 0, 0.1) < 1e-20,
    "opposite fabric edges must remain physically far apart",
  );

  for (const value of [
    fabricImpulseWeight(-99, 99, Infinity, Number.NaN, -3),
    fabricImpulseWeight(0.4, 0.2, -0.7, 0.8, 99),
  ]) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1);
  }

  const first = new SpectralFabric({ seed: 77 });
  const second = new SpectralFabric({ seed: 77 });
  first.excite(0.31, -0.27, 0.82, 0.16);
  second.excite(0.31, -0.27, 0.82, 0.16);
  assert.deepEqual(first.velocity, second.velocity);
  assert.ok(first.velocity.some((value) => Math.abs(value) > 0.1));
  assert.ok(first.velocity.every((value) => Number.isFinite(value) && Math.abs(value) <= 14));

  const edge = new SpectralFabric({ width: 16, height: 12, seed: 91 });
  edge.excite(0.99, 0, 1, 0.08);
  const oppositeEdgeVelocity = Array.from({ length: edge.height }, (_, row) => (
    Math.abs(edge.velocity[row * edge.width])
  ));
  const impactEdgeVelocity = Array.from({ length: edge.height }, (_, row) => (
    Math.abs(edge.velocity[row * edge.width + edge.width - 1])
  ));
  assert.ok(Math.max(...oppositeEdgeVelocity) < 1e-12);
  assert.ok(Math.max(...impactEdgeVelocity) > 0.1);
});

test("elastic releases turn stored strain into broad directional membrane waves", () => {
  const base = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricTension: 0.7,
    fabricDamping: 0.25,
    fabricInertia: 0.2,
    fabricPull: 1.4,
    propagationRate: 6,
    propagationSpeed: 3,
    propagationDecay: 2.5,
    propagationWidth: 0.12,
  };
  const rightPull = {
    deltaX: 0.9, deltaY: 0.1, distance: Math.hypot(0.9, 0.1),
    velocityX: 0, velocityY: 0,
  };
  const leftPull = { ...rightPull, deltaX: -rightPull.deltaX };
  const slow = elasticReleaseProfile(base, rightPull, 1.2, 0.2);
  const mirrored = elasticReleaseProfile(base, leftPull, 1.2, 0.2);
  assert.ok(slow.strength > 0.5, "stored pull distance must launch a strong sheet wave");
  assert.equal(slow.impulseForce, 0, "slow release adds no synthetic momentum kick");
  assert.ok(slow.directionX < -0.9);
  assert.ok(mirrored.directionX > 0.9);
  assert.ok(Math.abs(slow.directionY - mirrored.directionY) < 1e-12);
  assert.ok(Math.abs(slow.strength - mirrored.strength) < 1e-12);

  const flick = elasticReleaseProfile(base, {
    ...rightPull,
    velocityX: 7,
    velocityY: -1,
  }, 1.2, 0.2);
  assert.ok(flick.impulseForce > 0.5, "measured flick velocity must add directional momentum");
  assert.ok(flick.impulseDirectionX > 0.9);

  const weak = elasticReleaseProfile(base, {
    ...rightPull,
    deltaX: 0.15,
    distance: 0.15,
  }, 0.35, 0.2);
  assert.ok(slow.strength > weak.strength * 5);

  const light = elasticReleaseProfile({ ...base, fabricInertia: 0 }, rightPull, 1.2, 0.2);
  const heavy = elasticReleaseProfile({ ...base, fabricInertia: 1 }, rightPull, 1.2, 0.2);
  assert.ok(light.rate > heavy.rate);
  assert.ok(light.speed > heavy.speed);

  const slowControls = elasticReleaseProfile({
    ...base, propagationRate: 1, propagationSpeed: 0.1,
  }, rightPull, 1.2, 0.2);
  const fastControls = elasticReleaseProfile({
    ...base, propagationRate: 50, propagationSpeed: 12,
  }, rightPull, 1.2, 0.2);
  assert.ok(fastControls.rate > slowControls.rate * 3);
  assert.ok(fastControls.speed > slowControls.speed * 3);

  const forward = new SpectralFabric({ width: 16, height: 12, patchwork: 0, seed: 19 });
  const backward = new SpectralFabric({ width: 16, height: 12, patchwork: 0, seed: 19 });
  forward.exciteDirectional(0, 0, 1, 0.24, 1, 0, 0.8);
  backward.exciteDirectional(0, 0, 1, 0.24, -1, 0, 0.8);
  for (let row = 0; row < forward.height; row += 1) {
    for (let column = 0; column < forward.width; column += 1) {
      const index = row * forward.width + column;
      const mirroredIndex = row * backward.width + backward.width - 1 - column;
      assert.ok(Math.abs(forward.displacement[index] - backward.displacement[mirroredIndex]) < 1e-12);
      assert.ok(Math.abs(forward.velocity[index] - backward.velocity[mirroredIndex]) < 1e-12);
    }
  }
});

test("manual impacts distinguish one pebble, a cluster, and a broad brick", () => {
  assert.deepEqual(FABRIC_IMPACT_BODIES, ["pebble", "pebbles", "brick"]);
  assert.ok(Object.isFrozen(FABRIC_IMPACT_BODIES));
  const common = {
    x: 0.2, y: -0.3, force: 0.8, radius: 0.2,
    count: 4, spread: 0.8, width: 0.18,
  };
  const pebble = fabricImpactPattern({ ...common, body: "pebble" });
  const pebbles = fabricImpactPattern({ ...common, body: "pebbles" });
  const brick = fabricImpactPattern({ ...common, body: "brick" });
  assert.equal(pebble.length, 1);
  assert.equal(pebbles.length, 4);
  assert.equal(brick.length, 1);
  assert.equal(new Set(pebbles.map(({ x, y }) => `${x.toFixed(6)}:${y.toFixed(6)}`)).size, 4);
  assert.ok(brick[0].radius > pebble[0].radius * 2);
  assert.ok(Math.abs(brick[0].force) > Math.abs(pebble[0].force));
  for (const source of [...pebble, ...pebbles, ...brick]) {
    assert.ok(source.x >= -1 && source.x <= 1);
    assert.ok(source.y >= -1 && source.y <= 1);
    assert.ok(Number.isFinite(source.force));
    assert.ok(Number.isFinite(source.radius));
    assert.ok(Object.isFrozen(source));
  }
  assert.ok(Object.isFrozen(pebbles));

  const brickFabric = new SpectralFabric({ width: 16, height: 12, patchwork: 0, seed: 23 });
  const pebbleFabric = new SpectralFabric({ width: 16, height: 12, patchwork: 0, seed: 23 });
  brickFabric.excitePatch(0, 0, 1, brick[0].radius, 25);
  pebbleFabric.excite(0, 0, 1, pebble[0].radius);
  const brickFootprint = Array.from(brickFabric.velocity).filter((value) => Math.abs(value) > 0.05).length;
  const pebbleFootprint = Array.from(pebbleFabric.velocity).filter((value) => Math.abs(value) > 0.05).length;
  assert.ok(brickFootprint > pebbleFootprint * 2.5, "a brick must contact substantially more fabric");
});

test("spectral fabric is seeded and invariant to compatible block boundaries", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricTension: 0.61,
    fabricDamping: 0.25,
    fabricInertia: 0.48,
    fabricExcitation: 1,
    fabricVibration: 0.2,
    fabricRate: 3.7,
  };
  const whole = new SpectralFabric({ seed: 123 });
  const split = new SpectralFabric({ seed: 123 });
  const other = new SpectralFabric({ seed: 124 });
  const stateArrays = [whole.displacement, whole.velocity, whole.acceleration];

  for (let block = 0; block < 120; block += 1) {
    whole.step(1 / 60, parameters);
    other.step(1 / 60, parameters);
  }
  for (let block = 0; block < 480; block += 1) {
    split.step(1 / 240, parameters);
  }

  assert.deepEqual(whole.displacement, split.displacement);
  assert.deepEqual(whole.velocity, split.velocity);
  assert.equal(whole.randomState, split.randomState);
  assert.notDeepEqual(whole.displacement, other.displacement);

  const expectedDisplacement = whole.displacement.slice();
  const expectedVelocity = whole.velocity.slice();
  whole.reset(123);
  for (let block = 0; block < 120; block += 1) whole.step(1 / 60, parameters);
  assert.deepEqual(whole.displacement, expectedDisplacement);
  assert.deepEqual(whole.velocity, expectedVelocity);
  assert.strictEqual(whole.displacement, stateArrays[0]);
  assert.strictEqual(whole.velocity, stateArrays[1]);
  assert.strictEqual(whole.acceleration, stateArrays[2]);
});

test("spring tension makes the fabric rebound faster and spreads the impulse", () => {
  const common = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricInertia: 0.3,
    fabricDamping: 0.1,
    fabricGravity: 0,
  };
  const slack = new SpectralFabric({ seed: 1 });
  const taut = new SpectralFabric({ seed: 1 });
  slack.excite(0, 0, 1, 0.08);
  taut.excite(0, 0, 1, 0.08);
  for (let step = 0; step < 12; step += 1) {
    slack.step(1 / 240, { ...common, fabricTension: 0 }, true);
    taut.step(1 / 240, { ...common, fabricTension: 1 }, true);
  }
  const slackFarField = Math.abs(slack.sample(0.5, 0));
  const tautFarField = Math.abs(taut.sample(0.5, 0));
  assert.ok(tautFarField > 1e-5);
  assert.ok(
    tautFarField > slackFarField * 10,
    "higher tension must propagate a local impulse across the weave faster",
  );

  const slackSpring = new SpectralFabric({ patchwork: 0, seed: 9 });
  const tautSpring = new SpectralFabric({ patchwork: 0, seed: 9 });
  const center = 3 * slackSpring.width + 4;
  slackSpring.displacement[center] = 0.12;
  tautSpring.displacement[center] = 0.12;
  let slackCrossings = 0;
  let tautCrossings = 0;
  let previousSlack = slackSpring.displacement[center];
  let previousTaut = tautSpring.displacement[center];
  for (let step = 0; step < 480; step += 1) {
    slackSpring.step(1 / 240, { ...common, fabricTension: 0 }, true);
    tautSpring.step(1 / 240, { ...common, fabricTension: 1 }, true);
    const nextSlack = slackSpring.displacement[center];
    const nextTaut = tautSpring.displacement[center];
    if (nextSlack * previousSlack < 0) slackCrossings += 1;
    if (nextTaut * previousTaut < 0) tautCrossings += 1;
    previousSlack = nextSlack;
    previousTaut = nextTaut;
  }
  assert.ok(
    tautCrossings >= slackCrossings + 8,
    "spring tension must produce a clearly faster, bouncier rebound",
  );
});

test("inertia is an inverse response-speed control without reversing the force", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricTension: 0.3,
    fabricDamping: 0,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricGravity: 0,
  };
  const responsive = new SpectralFabric({ patchwork: 0, seed: 10 });
  const slow = new SpectralFabric({ patchwork: 0, seed: 10 });
  const center = 3 * responsive.width + 4;
  responsive.displacement[center] = 0.05;
  slow.displacement[center] = 0.05;
  responsive.step(1 / 240, { ...parameters, fabricInertia: 0 }, true);
  slow.step(1 / 240, { ...parameters, fabricInertia: 1 }, true);

  assert.ok(responsive.acceleration[center] < 0);
  assert.ok(slow.acceleration[center] < 0);
  assert.ok(
    Math.abs(responsive.acceleration[center])
      > Math.abs(slow.acceleration[center]) * 7,
    "low inertia must respond much faster than high inertia",
  );
  assert.ok(responsive.displacement[center] < slow.displacement[center]);
});

test("motion damping provides a wide and controllable stop-time range", () => {
  const common = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricInertia: 0.3,
    fabricGravity: 0,
  };

  const ringing = new SpectralFabric({ seed: 8 });
  const damped = new SpectralFabric({ seed: 8 });
  ringing.excite(0.15, -0.2, 1, 0.12);
  damped.excite(0.15, -0.2, 1, 0.12);
  for (let step = 0; step < 120; step += 1) {
    ringing.step(1 / 240, { ...common, fabricTension: 0.58, fabricDamping: 0 }, true);
    damped.step(1 / 240, { ...common, fabricTension: 0.58, fabricDamping: 1 }, true);
  }
  assert.ok(damped.energy < ringing.energy * 0.5);

  for (let step = 0; step < 840; step += 1) {
    ringing.step(1 / 240, { ...common, fabricTension: 0.58, fabricDamping: 0 }, true);
    damped.step(1 / 240, { ...common, fabricTension: 0.58, fabricDamping: 1 }, true);
  }
  assert.ok(damped.energy < 0.001, "full brake must settle the membrane quickly");
  assert.ok(ringing.energy > 0.01, "zero brake must retain a long ringing tail");
});

test("fabric pull and rotation deform the intended spectral region", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricPull: 1.5,
    fabricDamping: 0.4,
  };
  const positive = new SpectralFabric({ seed: 7 });
  const negative = new SpectralFabric({ seed: 7 });
  positive.tug(0.4, -0.2, 1);
  negative.tug(0.4, -0.2, -1);
  for (let step = 0; step < 60; step += 1) {
    positive.step(1 / 240, parameters, true);
    negative.step(1 / 240, parameters, true);
  }
  const positiveNear = positive.sample(0.4, -0.2);
  const negativeNear = negative.sample(0.4, -0.2);
  assert.ok(positiveNear > 0.5);
  assert.ok(negativeNear < -0.5);
  assert.ok(Math.abs(positive.sample(-0.5, 0.6)) < Math.abs(positiveNear) * 0.2);

  const quarterTurn = rotateFabricCoordinate(0.5, 0, 90);
  assert.ok(Math.abs(quarterTurn.x) < 1e-12);
  assert.ok(Math.abs(quarterTurn.y - 0.5) < 1e-12);
  const fullTurn = rotateFabricCoordinate(0.5, -0.25, 360);
  assert.ok(Math.abs(fullTurn.x - 0.5) < 1e-12);
  assert.ok(Math.abs(fullTurn.y + 0.25) < 1e-12);

  const plainKernel = new MoireDroneKernel({
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      freeze: true,
      fabricRotation: 0,
      fabricPatchwork: 0,
      fabricExcitation: 0,
      fabricVibration: 0,
    },
  });
  const rotatedKernel = new MoireDroneKernel({
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      freeze: true,
      fabricRotation: 90,
      fabricPatchwork: 0,
      fabricExcitation: 0,
      fabricVibration: 0,
    },
  });
  plainKernel.exciteFabric(0.5, 0, 1, 0.1);
  rotatedKernel.exciteFabric(0.5, 0, 1, 0.1);
  assert.ok(plainKernel.fabric.sampleVelocityLocal(0.5, 0) > 0.5);
  assert.ok(rotatedKernel.fabric.sampleVelocityLocal(0, 0.5) > 0.5);
  assert.ok(rotatedKernel.fabric.sampleVelocityLocal(0.5, 0) < 1e-5);
});

test("direct fabric gestures preserve the full vector while keeping a bounded anchored pull", () => {
  const anchor = { anchorX: 0.23, anchorY: -0.41 };
  const contact = fabricGesturePull({
    ...anchor,
    currentX: anchor.anchorX,
    currentY: anchor.anchorY,
    velocityX: 1.25,
    velocityY: -0.75,
  });
  assert.equal(contact.tugX, anchor.anchorX);
  assert.equal(contact.tugY, anchor.anchorY);
  assert.equal(contact.currentX, anchor.anchorX);
  assert.equal(contact.currentY, anchor.anchorY);
  assert.equal(contact.deltaX, 0);
  assert.equal(contact.deltaY, 0);
  assert.equal(contact.distance, 0);
  assert.equal(contact.velocityX, 1.25);
  assert.equal(contact.velocityY, -0.75);
  assert.ok(contact.amount > 0 && contact.amount < 1);

  const directions = [
    { currentX: anchor.anchorX + 0.4, currentY: anchor.anchorY },
    { currentX: anchor.anchorX - 0.4, currentY: anchor.anchorY },
    { currentX: anchor.anchorX, currentY: anchor.anchorY - 0.4 },
    { currentX: anchor.anchorX, currentY: anchor.anchorY + 0.4 },
  ].map((current) => fabricGesturePull({ ...anchor, ...current }));
  for (const pull of directions) {
    assert.equal(pull.tugX, anchor.anchorX);
    assert.equal(pull.tugY, anchor.anchorY);
    assert.equal(pull.currentX - anchor.anchorX, pull.deltaX);
    assert.equal(pull.currentY - anchor.anchorY, pull.deltaY);
    assert.ok(Math.abs(Math.hypot(pull.deltaX, pull.deltaY) - pull.distance) < 1e-12);
    assert.ok(pull.distance > contact.distance);
    assert.ok(Math.abs(pull.amount) > contact.amount);
  }
  assert.ok(directions[0].deltaX > 0 && directions[1].deltaX < 0);
  assert.ok(directions[2].deltaY < 0 && directions[3].deltaY > 0);

  const upward = directions[2];
  const downward = directions[3];
  assert.ok(upward.amount > 0, "pulling upward must raise the local membrane");
  assert.ok(downward.amount < 0, "pulling downward must lower the local membrane");
  assert.ok(Math.abs(Math.abs(upward.amount) - Math.abs(downward.amount)) < 1e-12);
  assert.ok(directions[0].amount > 0, "horizontal movement must still pull outward");
  assert.ok(directions[1].amount > 0, "horizontal movement must still pull outward");

  const subtleDownward = fabricGesturePull({
    ...anchor,
    currentX: anchor.anchorX + 0.2,
    currentY: anchor.anchorY + 0.034,
  });
  assert.ok(subtleDownward.amount > 0, "pointer jitter must not unexpectedly flip polarity");

  const outwardEdgePull = fabricGesturePull({
    anchorX: 1,
    anchorY: -1,
    currentX: 1.75,
    currentY: -1.6,
  });
  assert.equal(outwardEdgePull.tugX, 1);
  assert.equal(outwardEdgePull.tugY, -1);
  assert.equal(outwardEdgePull.currentX, 1);
  assert.equal(outwardEdgePull.currentY, -1);
  assert.equal(outwardEdgePull.deltaX, 0.75);
  assert.ok(Math.abs(outwardEdgePull.deltaY + 0.6) < 1e-12);
  assert.ok(outwardEdgePull.distance > 0.9);
  assert.ok(
    Math.abs(outwardEdgePull.amount) > 0.7,
    "pointer capture beyond an edge must keep increasing audible fabric strain",
  );

  const extreme = fabricGesturePull({
    anchorX: 99,
    anchorY: -99,
    currentX: -99,
    currentY: 99,
    contactPull: 99,
    velocityX: 99,
    velocityY: -99,
  });
  assert.equal(extreme.tugX, 1);
  assert.equal(extreme.tugY, -1);
  assert.equal(Math.abs(extreme.amount), 1);
  assert.ok(Number.isFinite(extreme.distance));

  const invalid = fabricGesturePull({
    anchorX: Number.NaN,
    anchorY: Infinity,
    currentX: -Infinity,
    currentY: Number.NaN,
    contactPull: Number.NaN,
    velocityX: Infinity,
    velocityY: Number.NaN,
  });
  for (const value of Object.values(invalid)) assert.ok(Number.isFinite(value));
  assert.ok(invalid.tugX >= -1 && invalid.tugX <= 1);
  assert.ok(invalid.tugY >= -1 && invalid.tugY <= 1);
  assert.ok(Math.abs(invalid.amount) <= 1);
});

test("fabric pull stays materially graded from medium through extreme drags", () => {
  const anchor = { anchorX: -1, anchorY: -1 };
  const medium = fabricGesturePull({
    ...anchor,
    currentX: -0.5,
    currentY: -1,
  });
  const far = fabricGesturePull({
    ...anchor,
    currentX: 0,
    currentY: -1,
  });
  const extreme = fabricGesturePull({
    ...anchor,
    currentX: 1,
    currentY: 1,
  });
  const strengths = [medium, far, extreme].map(({ amount }) => Math.abs(amount));

  assert.ok(strengths[0] < strengths[1] && strengths[1] < strengths[2]);
  assert.ok(
    strengths[1] - strengths[0] > 0.1,
    "medium and far pulls must not collapse into the same near-maximum force",
  );
  assert.ok(
    strengths[2] - strengths[1] > 0.1,
    "an extreme pull must retain meaningful force headroom beyond a far pull",
  );
  assert.ok(medium.distance < far.distance && far.distance < extreme.distance);
});

test("the browser wrapper transfers complete tug and release gestures into the worklet", () => {
  const messages = [];
  const audio = new MoireDroneAudio({});
  audio.node = {
    port: {
      postMessage(message) {
        messages.push(message);
      },
    },
  };
  const gesture = Object.freeze({
    currentX: 0.62,
    currentY: -0.37,
    deltaX: 0.48,
    deltaY: -0.21,
    distance: Math.hypot(0.48, -0.21),
    velocityX: 2.75,
    velocityY: -1.5,
  });
  audio.tugFabric(0.14, -0.16, 0.73, gesture);
  audio.releaseFabric(gesture);
  audio.kickFabric(0.14, -0.16, 0.81, 0.19, gesture);
  audio.impactFabric(0.14, -0.16, 0.81, 0.19, gesture);
  audio.pluckFabric(0.14, -0.16, 0.81, 0.19, gesture);

  assert.deepEqual(messages.map(({ type }) => type), [
    "fabric-tug", "fabric-release", "fabric-kick", "fabric-impact", "fabric-pluck",
  ]);
  for (const message of messages) {
    const packet = message.gesture ?? message;
    for (const key of [
      "currentX", "currentY", "deltaX", "deltaY", "distance", "velocityX", "velocityY",
    ]) {
      assert.equal(packet[key], gesture[key], `${message.type} must preserve gesture.${key}`);
    }
  }
});

test("horizontal touch selects spectral focus and pull strength materially changes sculpture", () => {
  const tapGesture = (currentX) => ({
    currentX,
    currentY: 0,
    deltaX: 0,
    deltaY: 0,
    distance: 0,
    velocityX: 0,
    velocityY: 0,
  });
  const lowTap = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  const highTap = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  lowTap.pluckFabric(-0.8, 0, 0.7, 0.2, tapGesture(-0.8));
  highTap.pluckFabric(0.8, 0, 0.7, 0.2, tapGesture(0.8));
  assert.ok(lowTap.gestureFocus < highTap.gestureFocus);
  assert.ok(
    highTap.gestureFocus - lowTap.gestureFocus > 0.5,
    "left and right taps must address materially different log-frequency regions",
  );

  const weakGesture = {
    currentX: 0.2,
    currentY: -0.1,
    deltaX: 0.1,
    deltaY: 0,
    distance: 0.1,
    velocityX: 1,
    velocityY: 0,
  };
  const strongGesture = {
    ...weakGesture,
    deltaX: 0.8,
    distance: 0.8,
  };
  const weak = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  const strong = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  weak.tugFabric(0.1, -0.1, 0.3, weakGesture);
  strong.tugFabric(-0.6, -0.1, 0.9, strongGesture);
  assert.ok(
    strong.gestureStrength - weak.gestureStrength > 0.12,
    "pull distance must directly deepen the local spectral operation",
  );
  assert.ok(
    strong.gestureWidthScale - weak.gestureWidthScale > 0.08,
    "pull distance must audibly broaden the operated frequency region",
  );
  weak.updateTargets(true);
  strong.updateTargets(true);
  assert.ok(
    strong.sculptDepth - weak.sculptDepth > 0.12,
    "hard pulls must remain deeper even when the preset maximum depth is 100%",
  );
  assert.ok(
    strong.sculptWidth - weak.sculptWidth > 0.015,
    "hard pulls must also operate on a materially wider spectral region",
  );

  weak.releaseFabric(weakGesture);
  strong.releaseFabric(strongGesture);
  weak.updateTargets(true);
  strong.updateTargets(true);
  for (const kernel of [weak, strong]) {
    assert.equal(kernel.gestureEnvelope, 0);
    assert.equal(kernel.directGestureResponse, 0);
    assert.equal(kernel.directGestureDepth, 0);
    assert.equal(kernel.directGestureGainTarget, 1);
  }
  for (const value of [
    lowTap.gestureFocus,
    highTap.gestureFocus,
    weak.gestureStrength,
    strong.gestureStrength,
    weak.gestureWidthScale,
    strong.gestureWidthScale,
    weak.gestureEnvelope,
    strong.gestureEnvelope,
  ]) assert.ok(Number.isFinite(value));
});

test("matched X and opposite Y contacts address different filter families until release", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    autoPluckRate: 0,
    fieldASpeed: 0,
    fieldBSpeed: 0,
    glideA: 0,
    glideB: 0,
    spectralSculptMode: "bandstop",
    spectralFilterBlend: 0.62,
    seed: 0x64b19ea3,
  };
  const top = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
  const bottom = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
  top.setActive(true);
  bottom.setActive(true);
  renderKernel(top, 4_096);
  renderKernel(bottom, 4_096);
  const gestureAt = (y) => Object.freeze({
    currentX: 0.22,
    currentY: y,
    deltaX: 0.42,
    deltaY: Math.sign(y) * 0.92,
    distance: Math.hypot(0.42, 0.92),
    velocityX: 2.2,
    velocityY: Math.sign(y) * 3.8,
  });
  const topGesture = gestureAt(-0.76);
  const bottomGesture = gestureAt(0.76);
  top.tugFabric(0.22, -0.76, 0.92, topGesture);
  bottom.tugFabric(0.22, 0.76, 0.92, bottomGesture);
  top.updateTargets(true);
  bottom.updateTargets(true);
  assert.equal(top.gestureActive, true);
  assert.equal(bottom.gestureActive, true);
  assert.ok(top.gestureWarpAxis > 0 && bottom.gestureWarpAxis > 0);
  assert.ok(top.gestureWeftAxis < 0 && bottom.gestureWeftAxis > 0);
  assert.notDeepEqual(
    Array.from(top.filterPosition),
    Array.from(bottom.filterPosition),
    "Y must retune the weft family rather than only drawing at a different row",
  );

  const topRender = renderKernel(top, 6_144);
  const bottomRender = renderKernel(bottom, 6_144);
  assertFiniteBounded([
    topRender.left, topRender.right, bottomRender.left, bottomRender.right,
  ]);
  let energy = 0;
  let difference = 0;
  for (let index = 0; index < topRender.left.length; index += 1) {
    for (const channel of ["left", "right"]) {
      const a = topRender[channel][index];
      const b = bottomRender[channel][index];
      energy += (a * a + b * b) * 0.5;
      difference += (a - b) ** 2;
    }
  }
  assert.ok(
    Math.sqrt(difference / Math.max(1e-15, energy)) > 0.12,
    "top and bottom gestures must produce materially different sound",
  );

  top.releaseFabric(topGesture);
  bottom.releaseFabric(bottomGesture);
  top.updateTargets(true);
  bottom.updateTargets(true);
  for (const kernel of [top, bottom]) {
    assert.equal(kernel.gestureActive, false);
    assert.equal(kernel.gestureEnvelope, 0);
    assert.ok(Math.abs(kernel.gestureWarpAxis) < 1e-12);
    assert.ok(Math.abs(kernel.gestureWeftAxis) < 1e-12);
    assert.equal(kernel.directGestureGainTarget, 1);
  }
});

test("every preset gives a direct pull a serious parameter-independent sonic response", () => {
  const gesture = Object.freeze({
    currentX: 0.78,
    currentY: -0.68,
    deltaX: 1.5,
    deltaY: -1.33,
    distance: Math.hypot(1.5, -1.33),
    velocityX: 4.8,
    velocityY: -3.6,
  });
  const warmFrames = 4_096;
  const renderFrames = 6_144;
  const comparisonStart = MOIRE_DRONE_FFT_SIZE * 2;

  for (const preset of MOIRE_DRONE_PRESETS) {
    const parameters = {
      ...MOIRE_DRONE_DEFAULTS,
      ...preset.settings,
      seed: 0x71c4a9e3,
    };
    const idle = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
    const pulled = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
    idle.setActive(true);
    pulled.setActive(true);
    renderKernel(idle, warmFrames);
    renderKernel(pulled, warmFrames);
    pulled.tugFabric(-0.72, 0.65, 0.96, gesture);
    const idleRender = renderKernel(idle, renderFrames);
    const pulledRender = renderKernel(pulled, renderFrames);
    assertFiniteBounded([
      idleRender.left, idleRender.right,
      pulledRender.left, pulledRender.right,
    ]);

    let referenceEnergy = 0;
    let differenceEnergy = 0;
    for (let index = comparisonStart; index < renderFrames; index += 1) {
      for (const channel of ["left", "right"]) {
        const reference = idleRender[channel][index];
        const result = pulledRender[channel][index];
        referenceEnergy += reference * reference;
        differenceEnergy += (result - reference) ** 2;
      }
    }
    const relativeDifference = Math.sqrt(
      differenceEnergy / Math.max(1e-15, referenceEnergy),
    );
    assert.ok(referenceEnergy > 1e-7, `${preset.id} reference must stay audible`);
    assert.ok(
      relativeDifference > 0.3,
      `${preset.id} direct pull must remain unmistakable (${relativeDifference})`,
    );
    assert.ok(pulled.directGestureResponse > 0.85, `${preset.id} must retain direct contact`);
    assert.ok(pulled.directGestureDepth > 0.8, `${preset.id} must force deep spectral action`);
    assert.ok(pulled.directGestureGainTarget < 0.55, `${preset.id} must excavate every output path`);
  }
});

test("direct pull survives zeroed modulators at every sculpt and Q/FFT topology", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    freeze: true,
    dust: 0,
    filterPairs: 8,
    cascade: 0,
    glideA: 0,
    glideB: 0,
    fieldASpeed: 0,
    fieldBSpeed: 0,
    fabricDepth: 0,
    fabricPull: 0,
    fabricExcitation: 0,
    fabricVibration: 0,
    propagationDepth: 0,
    propagationGain: 0,
    autoPluckRate: 0,
    combDepth: 0,
    combWidth: 0.02,
    combDrift: 0,
    combWarp: 0,
    pluckCut: 0,
    fftCutDepth: 0,
    qCutDepth: 0,
    gestureCoupling: 0,
    gestureMemory: 0.08,
    filteredMix: 0,
    drive: 0,
    space: 0,
    feedback: 0,
    seed: 0x2f41bc98,
  };
  const gesture = Object.freeze({
    currentX: 0.74,
    currentY: -0.62,
    deltaX: 1.42,
    deltaY: -1.18,
    distance: Math.hypot(1.42, -1.18),
    velocityX: 5,
    velocityY: -4,
  });

  for (const spectralSculptMode of SPECTRAL_SCULPT_MODES) {
    for (const spectralFilterBlend of [0, 0.5, 1]) {
      const topology = { ...parameters, spectralSculptMode, spectralFilterBlend };
      const idle = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters: topology });
      const pulled = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters: topology });
      idle.setActive(true);
      pulled.setActive(true);
      const idleWarm = renderKernel(idle, 3_072);
      const pulledWarm = renderKernel(pulled, 3_072);
      assert.deepEqual(
        pulledWarm.left,
        idleWarm.left,
        `${spectralSculptMode}/${spectralFilterBlend} untouched bypass must remain exact`,
      );
      assert.equal(pulled.directGestureResponse, 0);
      assert.equal(pulled.directGestureDepth, 0);
      assert.equal(pulled.directGestureGain, 1);
      assert.equal(pulled.directGestureGainTarget, 1);

      pulled.tugFabric(gesture.currentX, gesture.currentY, 0.95, gesture);
      const idleRender = renderKernel(idle, 5_120);
      const pulledRender = renderKernel(pulled, 5_120);
      assertFiniteBounded([
        idleRender.left, idleRender.right,
        pulledRender.left, pulledRender.right,
      ]);
      let referenceEnergy = 0;
      let differenceEnergy = 0;
      for (let index = MOIRE_DRONE_FFT_SIZE * 2; index < 5_120; index += 1) {
        for (const channel of ["left", "right"]) {
          const reference = idleRender[channel][index];
          const result = pulledRender[channel][index];
          referenceEnergy += reference * reference;
          differenceEnergy += (result - reference) ** 2;
        }
      }
      const relativeDifference = Math.sqrt(
        differenceEnergy / Math.max(1e-15, referenceEnergy),
      );
      assert.ok(
        relativeDifference > 0.3,
        `${spectralSculptMode}/${spectralFilterBlend} zeroed topology must still respond (${relativeDifference})`,
      );
      assert.ok(pulled.sculptDepth > 0.55);
      assert.ok(pulled.directGestureDepth > 0.75);
      assert.ok(pulled.directGestureFabricDepth > 1);
      assert.ok(pulled.directGestureWarp > 2.5);
      assert.ok(pulled.directGestureGain < 0.58);
      assert.ok(
        pulled.fabric.energy > 0.01,
        `${spectralSculptMode}/${spectralFilterBlend} zero pull control must still move the membrane`,
      );
      assert.ok(
        Array.from(pulled.combToothWarp.slice(0, pulled.combStageCount))
          .some((warp) => Math.abs(warp) > 1e-5),
        `${spectralSculptMode}/${spectralFilterBlend} direct membrane must still bend filter geometry`,
      );
    }
  }
});

test("the guaranteed direct-pull response is graded during contact and ends at release", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    freeze: true,
    fabricDepth: 0,
    propagationDepth: 0,
    propagationGain: 0,
    combDepth: 0,
    combWarp: 0,
    pluckCut: 0,
    fftCutDepth: 0,
    qCutDepth: 0,
    gestureCoupling: 0,
    filteredMix: 0,
    space: 0,
    feedback: 0,
    drive: 0,
    seed: 0x9d2c5681,
  };
  const gestureAt = (distance) => Object.freeze({
    currentX: -0.7 + distance,
    currentY: 0.2 - distance * 0.25,
    deltaX: distance,
    deltaY: -distance * 0.25,
    distance: Math.hypot(distance, distance * 0.25),
    velocityX: distance * 5,
    velocityY: -distance * 1.25,
  });
  const strengths = [0.08, 0.58, 1.42];

  for (const spectralSculptMode of SPECTRAL_SCULPT_MODES) {
    const responses = [];
    const gains = [];
    const depths = [];
    for (const distance of strengths) {
      const kernel = new MoireDroneKernel({
        sampleRate: SAMPLE_RATE,
        parameters: { ...parameters, spectralSculptMode },
      });
      kernel.setActive(true);
      kernel.tugFabric(-0.7, 0.2, Math.min(1, 0.16 + distance * 0.58), gestureAt(distance));
      renderKernel(kernel, BLOCK_SIZE * 4);
      responses.push(kernel.directGestureResponse);
      gains.push(kernel.directGestureGainTarget);
      depths.push(kernel.directGestureDepth);
    }
    assert.ok(
      responses[0] < responses[1] && responses[1] < responses[2],
      `${spectralSculptMode} contact response must preserve pull headroom`,
    );
    assert.ok(
      depths[0] < depths[1] && depths[1] < depths[2],
      `${spectralSculptMode} forced spectral depth must be graded`,
    );
    assert.ok(
      gains[0] > gains[1] && gains[1] > gains[2],
      `${spectralSculptMode} excavation must deepen with pull distance`,
    );
    assert.ok(responses[2] - responses[0] > 0.3);
    assert.ok(depths[2] - depths[0] > 0.4);
    assert.ok(gains[0] - gains[2] > 0.25);
  }

  const released = new MoireDroneKernel({
    sampleRate: SAMPLE_RATE,
    parameters,
  });
  released.setActive(true);
  const releaseGesture = gestureAt(strengths[2]);
  released.tugFabric(-0.7, 0.2, 0.98, releaseGesture);
  renderKernel(released, BLOCK_SIZE * 4);
  const retainedFabricEnergy = released.fabric.energy;
  assert.ok(retainedFabricEnergy > 0.001);
  assert.ok(released.directGestureGain < 0.6);
  released.releaseFabric(releaseGesture);
  released.updateTargets(true);
  assert.equal(released.gestureActive, false);
  assert.equal(released.gestureEnvelope, 0);
  assert.equal(released.directGestureResponse, 0);
  assert.equal(released.directGestureDepth, 0);
  assert.equal(released.directGestureGainTarget, 1);
  assert.ok(Math.abs(released.gestureWarpAxis) < 1e-12);
  assert.ok(Math.abs(released.gestureWeftAxis) < 1e-12);
  assert.equal(released.fabric.energy, retainedFabricEnergy);
  renderKernel(released, Math.round(SAMPLE_RATE * 0.05));
  assert.ok(
    released.directGestureGain > 0.999,
    "the de-click smoothing may be brief but must not become a second release envelope",
  );
  assert.equal(
    released.fabric.energy,
    retainedFabricEnergy,
    "the released physical sheet may retain visible energy independently of direct contact",
  );
});

test("extreme spectral-fabric motion stays finite and shifts the filter lattice", () => {
  const fabric = new SpectralFabric({
    width: 99, height: 99, patchwork: 1, seed: 31_337,
  });
  assert.equal(fabric.width, 16);
  assert.equal(fabric.height, 16);
  assert.equal(fabric.nodeCount, 256);
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricTension: 1,
    fabricDamping: 0,
    fabricInertia: 0,
    fabricDepth: 2,
    fabricExcitation: 1,
    fabricVibration: 1,
    fabricRate: MOIRE_DRONE_LIMITS.maxFabricRate,
    fabricPull: 2,
  };
  fabric.excite(0.9, -0.9, 2, 0.04);
  fabric.tug(-0.95, 0.95, 1);
  for (let block = 0; block < 1_200; block += 1) {
    if (block === 300) fabric.tug(0.3, -0.7, -1);
    if (block === 700) fabric.release();
    fabric.step(1 / 60, parameters);
  }
  assert.ok(fabric.energy >= 0 && fabric.energy <= 1.5);
  assert.ok(fabric.displacement.every((value) => Number.isFinite(value) && Math.abs(value) <= 1.2));
  assert.ok(fabric.velocity.every((value) => Number.isFinite(value) && Math.abs(value) <= 16));
  assert.ok(fabric.acceleration.every((value) => Number.isFinite(value) && Math.abs(value) <= 8_000));
  for (const values of [
    fabric.nodeX,
    fabric.nodeY,
    fabric.nodeMass,
    fabric.nodeDamping,
    fabric.horizontalSpringWeight,
    fabric.verticalSpringWeight,
  ]) {
    assert.ok(values.every(Number.isFinite));
  }
  assert.ok(fabric.nodeMass.every((value) => value >= 0.42 && value <= 2.4));
  assert.ok(fabric.nodeDamping.every((value) => value >= 0.35 && value <= 1.7));
  assert.ok(fabric.horizontalSpringWeight.every((value) => value >= 0.32 && value <= 2.4));
  assert.ok(fabric.verticalSpringWeight.every((value) => value >= 0.32 && value <= 2.4));

  const targetOptions = {
    index: 7,
    bank: 0,
    phaseA: 0.23,
    phaseB: 0.66,
    parameters: { ...MOIRE_DRONE_DEFAULTS, fabricDepth: 1.4 },
  };
  const flat = moireFilterTarget(targetOptions);
  const moving = moireFilterTarget({
    ...targetOptions,
    fabricA: 0.4,
    fabricB: -0.3,
    fabricVelocityA: 4,
    fabricVelocityB: -2,
  });
  assert.notEqual(moving.frequency, flat.frequency);
  assert.ok(moving.q > flat.q);
  assert.ok(Math.abs(moving.fabric - 0.56) < 1e-12);
  assert.ok(moving.fabricActivity > 0);
  assert.ok(moving.frequency >= MOIRE_DRONE_LIMITS.minFrequency);
  assert.ok(moving.frequency <= SAMPLE_RATE * 0.42);
});

test("propagation controls sanitize to the bounded event model", () => {
  const low = sanitizeMoireDroneParams({
    impactBody: "meteor",
    propagationMode: "not-a-wave",
    propagationRate: -99,
    propagationSpeed: -99,
    propagationDecay: -99,
    propagationDepth: -99,
    propagationGain: -99,
    propagationWidth: -99,
    harmonicOrder: -99,
    ringDensity: -99,
    autoPluckRate: -99,
    propagationVoices: -99,
    propagationSizeSpread: -99,
    propagationSpeedSpread: -99,
    propagationInterference: -99,
    grabRippleRate: -99,
    combDepth: -99,
    combTeeth: -99,
    combWidth: -99,
    combOffset: -99,
    combDrift: -99,
    combWarp: -99,
    pluckCut: -99,
    spectralFilterBlend: -99,
    fftCutDepth: -99,
    fftSharpness: -99,
    qCutDepth: -99,
    qCharacter: -99,
  });
  assert.equal(low.impactBody, MOIRE_DRONE_DEFAULTS.impactBody);
  assert.equal(low.propagationMode, MOIRE_DRONE_DEFAULTS.propagationMode);
  assert.equal(low.propagationRate, MOIRE_DRONE_LIMITS.minPropagationRate);
  assert.equal(low.propagationSpeed, 0.1);
  assert.equal(low.propagationDecay, 0.08);
  assert.equal(low.propagationDepth, 0);
  assert.equal(low.propagationGain, 0);
  assert.equal(low.propagationWidth, 0.02);
  assert.equal(low.harmonicOrder, 0);
  assert.equal(low.ringDensity, 0.25);
  assert.equal(low.autoPluckRate, 0);
  assert.equal(low.propagationVoices, 1);
  assert.equal(low.propagationSizeSpread, 0);
  assert.equal(low.propagationSpeedSpread, 0);
  assert.equal(low.propagationInterference, 0);
  assert.equal(low.grabRippleRate, 0);
  assert.equal(low.combDepth, 0);
  assert.equal(low.combTeeth, 1);
  assert.equal(low.combWidth, 0.02);
  assert.equal(low.combOffset, 0);
  assert.equal(low.combDrift, -2);
  assert.equal(low.combWarp, 0);
  assert.equal(low.pluckCut, 0);
  assert.equal(low.spectralFilterBlend, 0);
  assert.equal(low.fftCutDepth, 0);
  assert.equal(low.fftSharpness, 0);
  assert.equal(low.qCutDepth, 0);
  assert.equal(low.qCharacter, 0);

  const high = sanitizeMoireDroneParams({
    impactBody: "brick",
    propagationMode: "shock",
    propagationRate: 999,
    propagationSpeed: 999,
    propagationDecay: 999,
    propagationDepth: 999,
    propagationGain: 999,
    propagationWidth: 999,
    harmonicOrder: 11.6,
    ringDensity: 999,
    autoPluckRate: 999,
    propagationVoices: 999,
    propagationSizeSpread: 999,
    propagationSpeedSpread: 999,
    propagationInterference: 999,
    grabRippleRate: 999,
    combDepth: 999,
    combTeeth: 15.6,
    combWidth: 999,
    combOffset: 999,
    combDrift: 999,
    combWarp: 999,
    pluckCut: 999,
    spectralFilterBlend: 999,
    fftCutDepth: 999,
    fftSharpness: 999,
    qCutDepth: 999,
    qCharacter: 999,
  });
  assert.equal(high.impactBody, "brick");
  assert.equal(high.propagationMode, "shock");
  assert.equal(high.propagationRate, MOIRE_DRONE_LIMITS.maxPropagationRate);
  assert.equal(high.propagationSpeed, MOIRE_DRONE_LIMITS.maxPropagationSpeed);
  assert.equal(high.propagationDecay, 8);
  assert.equal(high.propagationDepth, 2);
  assert.equal(high.propagationGain, 1);
  assert.equal(high.propagationWidth, 0.6);
  assert.equal(high.harmonicOrder, 12);
  assert.equal(high.ringDensity, 12);
  assert.equal(high.autoPluckRate, MOIRE_DRONE_LIMITS.maxAutoPluckRate);
  assert.equal(high.propagationVoices, MOIRE_DRONE_LIMITS.maxPropagationVoices);
  assert.equal(high.propagationSizeSpread, 1);
  assert.equal(high.propagationSpeedSpread, 1);
  assert.equal(high.propagationInterference, 1);
  assert.equal(high.grabRippleRate, 30);
  assert.equal(high.combDepth, 1);
  assert.equal(high.combTeeth, 16);
  assert.equal(high.combWidth, 0.48);
  assert.equal(high.combOffset, 0);
  assert.equal(high.combDrift, 2);
  assert.equal(high.combWarp, 4);
  assert.equal(high.pluckCut, 1);
  assert.equal(high.spectralFilterBlend, 1);
  assert.equal(high.fftCutDepth, 1);
  assert.equal(high.fftSharpness, 1);
  assert.equal(high.qCutDepth, 1);
  assert.equal(high.qCharacter, 1);

  const clustered = sanitizeMoireDroneParams({
    impactBody: "pebbles",
    propagationVoices: 1,
  });
  assert.equal(clustered.impactBody, "pebbles");
  assert.equal(clustered.propagationVoices, 2);

  const defaults = sanitizeMoireDroneParams();
  assert.equal(defaults.autoPluckRate, 0);
  assert.equal(defaults.propagationVoices, 1);
  assert.equal(defaults.propagationSizeSpread, MOIRE_DRONE_DEFAULTS.propagationSizeSpread);
  assert.equal(defaults.propagationSpeedSpread, MOIRE_DRONE_DEFAULTS.propagationSpeedSpread);
  assert.equal(defaults.propagationInterference, MOIRE_DRONE_DEFAULTS.propagationInterference);
  assert.equal(defaults.grabRippleRate, MOIRE_DRONE_DEFAULTS.grabRippleRate);
  assert.equal(defaults.combDepth, MOIRE_DRONE_DEFAULTS.combDepth);
  assert.equal(defaults.combTeeth, MOIRE_DRONE_DEFAULTS.combTeeth);
  assert.equal(defaults.combWidth, MOIRE_DRONE_DEFAULTS.combWidth);
  assert.equal(defaults.combOffset, MOIRE_DRONE_DEFAULTS.combOffset);
  assert.equal(defaults.combDrift, MOIRE_DRONE_DEFAULTS.combDrift);
  assert.equal(defaults.combWarp, 2);
  assert.equal(defaults.pluckCut, 0.82);
  assert.equal(defaults.spectralFilterBlend, MOIRE_DRONE_DEFAULTS.spectralFilterBlend);
  assert.equal(defaults.fftCutDepth, MOIRE_DRONE_DEFAULTS.fftCutDepth);
  assert.equal(defaults.fftSharpness, MOIRE_DRONE_DEFAULTS.fftSharpness);
  assert.equal(defaults.qCutDepth, MOIRE_DRONE_DEFAULTS.qCutDepth);
  assert.equal(defaults.qCharacter, MOIRE_DRONE_DEFAULTS.qCharacter);
});

test("all spectral sculptors have distinct, finite, frequency-selective responses", () => {
  const lowFrequency = 100;
  const highFrequency = 12_800;
  const focus = 0.5;
  const width = 0.14;
  const positions = [0.04, 0.12, 0.2, 0.35, 0.5, 0.65, 0.8, 0.88, 0.96];
  const toothPositions = Float64Array.of(0.2, focus, 0.8);
  const toothWidths = Float64Array.of(width, width, width);
  const response = (mode, position, overrides = {}) => spectralFftMaskGain({
    frequency: lowFrequency * (highFrequency / lowFrequency) ** position,
    lowFrequency,
    highFrequency,
    toothPositions,
    toothWidths,
    teeth: 3,
    depth: 0.9,
    sharpness: 0.8,
    mode,
    focus,
    width,
    binWidth: 0,
    ...overrides,
  });

  const responses = new Map();
  for (const mode of SPECTRAL_SCULPT_MODES) {
    const gains = positions.map((position) => response(mode, position));
    assert.ok(gains.every((gain) => Number.isFinite(gain) && gain >= 0));
    assert.ok(
      gains.every((gain) => gain <= (["ridges", "peak", "tilt"].includes(mode)
        ? 3.000001
        : 1.000001)),
      `${mode} must retain bounded spectral gain`,
    );
    responses.set(mode, gains);
  }
  assert.equal(
    new Set([...responses.values()].map((gains) => gains.map((gain) => gain.toFixed(6)).join("|"))).size,
    SPECTRAL_SCULPT_MODES.length,
    "each sculpt topology must have its own spectral transfer shape",
  );

  const at = (mode, position) => response(mode, position);
  assert.ok(at("notches", focus) < at("notches", 0.12));
  assert.ok(at("ridges", focus) > 1 && at("ridges", focus) > at("ridges", 0.12));
  assert.ok(at("lowpass", 0.12) > at("lowpass", 0.88) + 0.25);
  assert.ok(at("highpass", 0.88) > at("highpass", 0.12) + 0.25);
  assert.ok(at("bandpass", focus) > Math.max(at("bandpass", 0.12), at("bandpass", 0.88)) + 0.25);
  assert.ok(at("bandstop", focus) + 0.25 < Math.min(at("bandstop", 0.12), at("bandstop", 0.88)));
  assert.ok(at("peak", focus) > 1 && at("peak", focus) > at("peak", 0.12));
  assert.ok(
    Math.abs(at("tilt", 0.12) - at("tilt", 0.88)) > 0.2,
    "tilt must create a broad spectral slope rather than another comb",
  );

  const lowFocusCut = response("bandstop", 0.2, { focus: 0.2 });
  const lowFocusRemote = response("bandstop", 0.8, { focus: 0.2 });
  const highFocusRemote = response("bandstop", 0.2, { focus: 0.8 });
  const highFocusCut = response("bandstop", 0.8, { focus: 0.8 });
  assert.ok(lowFocusCut + 0.25 < lowFocusRemote);
  assert.ok(highFocusCut + 0.25 < highFocusRemote);
});

test("FFT cut depth uses the full control travel as a deep decibel-like response", () => {
  const lowFrequency = 100;
  const highFrequency = 12_800;
  const focus = 0.5;
  const frequency = Math.sqrt(lowFrequency * highFrequency);
  const common = {
    frequency,
    lowFrequency,
    highFrequency,
    toothPositions: Float64Array.of(focus),
    toothWidths: Float64Array.of(0.2),
    teeth: 1,
    sharpness: 1,
    mode: "notches",
    focus,
    width: 0.2,
  };
  const expectedCoreGains = new Map([
    [0, 1],
    [0.25, 0.75 ** 2],
    [0.5, 0.5 ** 2],
    [0.75, 0.25 ** 2],
    [1, 0],
  ]);
  let previous = Infinity;
  for (const [depth, expected] of expectedCoreGains) {
    const gain = spectralFftMaskGain({ ...common, depth });
    assert.ok(Math.abs(gain - expected) < 1e-12);
    assert.ok(gain <= previous, "increasing FFT depth must never reopen a cut");
    previous = gain;
  }

  const remoteFrequency = lowFrequency * (highFrequency / lowFrequency) ** 0.76;
  assert.equal(spectralFftMaskGain({
    ...common,
    frequency: remoteFrequency,
    depth: 0.75,
  }), 1, "a deeper response must not lower bins outside the sculpted region");
});

test("periodic pointer focus places a real gap or ridge at that absolute spectrum position", () => {
  const teeth = 5;
  const width = 0.09;
  const circularDistance = (left, right) => {
    const distance = Math.abs(left - right);
    return Math.min(distance, 1 - distance);
  };
  for (const spectralSculptMode of ["notches", "ridges"]) {
    const kernel = new MoireDroneKernel({
      sampleRate: SAMPLE_RATE,
      parameters: {
        ...MOIRE_DRONE_DEFAULTS,
        spectralSculptMode,
        freeze: true,
        combTeeth: teeth,
        combWidth: width,
        combDepth: 1,
        combDrift: 0,
        combWarp: 0,
        fabricDepth: 0,
        propagationDepth: 0,
        gestureCoupling: 1,
        fftCutDepth: 1,
        fftSharpness: 1,
      },
    });
    for (const focus of [0.137, 0.413, 0.789]) {
      const pointerX = focus * 2 - 1;
      const anchorX = pointerX < 0 ? 0.8 : -0.8;
      const deltaX = pointerX - anchorX;
      kernel.tugFabric(anchorX, 0, 0.8, {
        currentX: pointerX,
        currentY: 0,
        deltaX,
        deltaY: 0,
        distance: Math.abs(deltaX),
        velocityX: 0,
        velocityY: 0,
      });
      kernel.updateTargets(true);
      const centers = Array.from(kernel.combNotchPosition.slice(0, teeth));
      for (let stage = 0; stage < teeth; stage += 1) {
        const expected = wrapUnit(focus + stage / teeth);
        assert.ok(
          Math.min(...centers.map((center) => circularDistance(center, expected))) < 1e-10,
          `${spectralSculptMode} pointer focus ${focus} must own periodic center ${expected}`,
        );
      }
      const focusFrequency = kernel.current.lowFrequency * (
        kernel.current.highFrequency / kernel.current.lowFrequency
      ) ** focus;
      const gainAtPointer = spectralFftMaskGain({
        frequency: focusFrequency,
        lowFrequency: kernel.current.lowFrequency,
        highFrequency: kernel.current.highFrequency,
        toothPositions: kernel.combNotchPosition,
        toothWidths: kernel.combNotchWidth,
        teeth,
        depth: 1,
        sharpness: 1,
        mode: spectralSculptMode,
        focus,
        width,
      });
      if (spectralSculptMode === "notches") assert.equal(gainAtPointer, 0);
      else assert.ok(gainAtPointer > 1.5);
    }
  }
});

test("the spectral comb gate has true zero cores, exact bypass, and periodic bounds", () => {
  const center = {
    spectralPosition: 0.271,
    phase: -0.271 * 7,
    teeth: 7,
    width: 0.16,
  };
  assert.equal(spectralCombGate({ ...center, depth: 1, influence: 1 }), 0);
  assert.ok(Math.abs(
    spectralCombGate({ ...center, depth: 0.8, influence: 0.5 }) - 0.52
  ) < 1e-12);
  for (const spectralPosition of [-999, -0.37, 0, 0.81, 999]) {
    assert.equal(spectralCombGate({ spectralPosition, depth: 0 }), 1);
    assert.equal(spectralCombGate({ spectralPosition, depth: 1, influence: 0 }), 1);
  }

  const periodic = {
    spectralPosition: 0.137,
    phase: -0.22,
    teeth: 7,
    width: 0.21,
    depth: 0.83,
    influence: 0.64,
  };
  const value = spectralCombGate(periodic);
  assert.ok(Math.abs(value - spectralCombGate({
    ...periodic,
    spectralPosition: periodic.spectralPosition + 1 / periodic.teeth,
  })) < 1e-12);
  assert.ok(Math.abs(value - spectralCombGate({
    ...periodic,
    phase: periodic.phase + 1,
  })) < 1e-12);

  for (const teeth of [-99, 1, 6, 16, 99]) {
    for (const width of [-99, 0.02, 0.17, 0.48, 99]) {
      for (const depth of [-99, 0, 0.37, 1, 99]) {
        for (let step = -40; step <= 40; step += 1) {
          const gate = spectralCombGate({
            spectralPosition: step / 13,
            phase: step / 17,
            teeth,
            width,
            depth,
            influence: step / 20,
          });
          assert.ok(Number.isFinite(gate));
          assert.ok(gate >= 0 && gate <= 1);
        }
      }
    }
  }
  for (const spectralPosition of [Number.NaN, Infinity, -Infinity]) {
    const gate = spectralCombGate({
      spectralPosition,
      phase: Number.NaN,
      teeth: Infinity,
      width: Number.NaN,
      depth: Infinity,
      influence: Number.NaN,
    });
    assert.ok(Number.isFinite(gate) && gate >= 0 && gate <= 1);
  }

  const transition = {
    spectralPosition: 0.029,
    phase: 0,
    teeth: 5,
    width: 0.2,
  };
  let previous = 1;
  for (const depth of [0, 0.2, 0.5, 0.8, 1]) {
    const gate = spectralCombGate({ ...transition, depth, influence: 0.75 });
    assert.ok(gate <= previous + 1e-12, "more depth must never open a tooth");
    previous = gate;
  }
  previous = 1;
  for (const influence of [0, 0.2, 0.5, 0.8, 1]) {
    const gate = spectralCombGate({ ...transition, depth: 0.9, influence });
    assert.ok(gate <= previous + 1e-12, "more wave influence must never open a tooth");
    previous = gate;
  }
  previous = 1;
  for (const width of [0.04, 0.08, 0.12, 0.18, 0.24]) {
    const gate = spectralCombGate({
      spectralPosition: 0.03,
      phase: 0,
      teeth: 5,
      width,
      depth: 1,
      influence: 1,
    });
    assert.ok(gate <= previous + 1e-12, "wider gaps must not restore a muted position");
    previous = gate;
  }
});

test("comb teeth have deterministic, bounded two-dimensional fabric anchors", () => {
  for (const teeth of [1, 6, 16]) {
    const first = Array.from(
      { length: teeth },
      (_, stage) => combToothAnchor(stage, teeth),
    );
    const second = Array.from(
      { length: teeth },
      (_, stage) => combToothAnchor(stage, teeth),
    );
    assert.deepEqual(first, second);
    for (const anchor of first) {
      assert.ok(Number.isFinite(anchor.x));
      assert.ok(Number.isFinite(anchor.y));
      assert.ok(anchor.x >= -1 && anchor.x <= 1);
      assert.ok(anchor.y >= -1 && anchor.y <= 1);
    }
    if (teeth > 1) {
      assert.equal(
        new Set(first.map(({ x, y }) => `${x.toFixed(12)},${y.toFixed(12)}`)).size,
        teeth,
        "each tooth must sample its own point on the fabric",
      );
    }
  }
});

test("comb-tooth warp has an exact bypass and cannot let neighboring gaps cross", () => {
  const common = {
    fabric: 0.91,
    propagation: -0.73,
    fabricDepth: 1.4,
    propagationDepth: 1.7,
    octaveSpan: Math.log2(18_000 / 24),
  };
  assert.equal(combToothWarpOffset({ ...common, combWarp: 0, teeth: 9 }), 0);
  assert.equal(combToothWarpOffset({
    ...common,
    fabric: 0,
    propagation: 0,
    combWarp: 4,
    teeth: 9,
  }), 0);

  for (const teeth of [1, 2, 6, 11, 16]) {
    const maximum = 0.42 / teeth;
    for (const fabric of [-99, -1.5, -0.4, 0, 0.8, 99]) {
      for (const propagation of [-99, -1.5, 0, 0.6, 1.5, 99]) {
        const warp = combToothWarpOffset({
          ...common,
          fabric,
          propagation,
          combWarp: 4,
          teeth,
        });
        assert.ok(Number.isFinite(warp));
        assert.ok(
          Math.abs(warp) <= maximum + 1e-12,
          "physical stretching must preserve tooth order",
        );
      }
    }
  }
});

test("warped spectral comb gates preserve the legacy grid and null supplied centers", () => {
  for (const teeth of [1, 3, 7, 16]) {
    for (const phase of [-0.73, 0, 0.28, 1.41]) {
      const toothPositions = Float64Array.from(
        { length: teeth },
        (_, stage) => wrapUnit((stage - phase) / teeth + combToothWarpOffset({
          fabric: 0.8,
          propagation: -0.5,
          fabricDepth: 1.2,
          propagationDepth: 0.9,
          combWarp: 0,
          octaveSpan: 8,
          teeth,
        })),
      );
      for (let step = -48; step <= 48; step += 1) {
        const spectralPosition = step / 31;
        const options = {
          spectralPosition,
          teeth,
          width: 0.17,
          depth: 0.83,
          influence: 0.61,
        };
        const legacy = spectralCombGate({ ...options, phase });
        const warped = spectralWarpedCombGate({ ...options, toothPositions });
        assert.ok(
          Math.abs(warped - legacy) < 1e-12,
          "zero physical warp must be identical to the legacy periodic comb",
        );
      }
      for (const spectralPosition of toothPositions) {
        assert.equal(spectralWarpedCombGate({
          spectralPosition,
          toothPositions,
          teeth,
          width: 0.12,
          depth: 1,
          influence: 1,
        }), 0);
      }
    }
  }

  const deformed = Float64Array.from([0.02, 0.19, 0.43, 0.68, 0.91]);
  for (let step = -120; step <= 120; step += 1) {
    for (const depth of [0, 0.37, 1]) {
      for (const influence of [0, 0.54, 1]) {
        const gate = spectralWarpedCombGate({
          spectralPosition: step / 47,
          toothPositions: deformed,
          teeth: deformed.length,
          width: 0.21,
          depth,
          influence,
        });
        assert.ok(Number.isFinite(gate));
        assert.ok(gate >= 0 && gate <= 1);
      }
    }
  }
});

test("the streaming FFT has exact Hann-squared overlap-add and declared latency", () => {
  assert.equal(MOIRE_DRONE_FFT_SIZE, 1_024);
  assert.equal(MOIRE_DRONE_FFT_HOP_SIZE, 256);
  assert.equal(MOIRE_DRONE_FFT_LATENCY, 1_023);

  const fftSize = 256;
  const filter = new SpectralFftFilter({ sampleRate: SAMPLE_RATE, fftSize });
  assert.equal(filter.hopSize, fftSize / 4);
  assert.equal(filter.latencySamples, fftSize - 1);
  assert.throws(
    () => new SpectralFftFilter({ sampleRate: SAMPLE_RATE, fftSize: 300 }),
    RangeError,
  );

  for (let phase = 0; phase < filter.hopSize; phase += 1) {
    let overlap = 0;
    for (let frame = 0; frame < 4; frame += 1) {
      const window = filter.window[phase + frame * filter.hopSize];
      overlap += window * window * (2 / 3);
    }
    assert.ok(
      Math.abs(overlap - 1) < 1e-12,
      "four periodic Hann-squared frames must sum to unity",
    );
  }

  filter.setMask({ depth: 0 });
  const length = fftSize * 18 + 37;
  const leftInput = Float64Array.from(
    { length },
    (_, index) => (
      Math.sin(Math.PI * 2 * 7 * index / fftSize) * 0.23
      + Math.cos(Math.PI * 2 * 29 * index / fftSize) * 0.11
      + (((index * 73) % 257) / 256 - 0.5) * 0.04
    ),
  );
  const rightInput = Float64Array.from(
    { length },
    (_, index) => (
      Math.cos(Math.PI * 2 * 13 * index / fftSize) * 0.19
      - Math.sin(Math.PI * 2 * 41 * index / fftSize) * 0.07
    ),
  );
  const rendered = renderSpectralFilter(
    filter,
    leftInput,
    rightInput,
    fftSize * 2,
    [1, 73, 128, 17, 257],
  );
  const latency = filter.latencySamples;
  let maximumError = 0;
  for (let index = 0; index < length; index += 1) {
    maximumError = Math.max(
      maximumError,
      Math.abs(rendered.left[index + latency] - leftInput[index]),
      Math.abs(rendered.right[index + latency] - rightInput[index]),
    );
  }
  assert.ok(maximumError < 3e-12, "a unity FFT mask must be a flat delayed wire");
  assert.ok(
    rendered.left.slice(0, latency).every((sample) => Math.abs(sample) < 1e-12),
    "the streaming stage must not emit the input before its declared latency",
  );
});

test("the FFT stage makes a deep warped bin cut while leaving a far bin flat", () => {
  const fftSize = 256;
  const targetBin = 32;
  const passBin = 53;
  const lowFrequency = 1_500;
  const highFrequency = 18_000;
  const targetFrequency = targetBin * SAMPLE_RATE / fftSize;
  const passFrequency = passBin * SAMPLE_RATE / fftSize;
  const octaveSpan = Math.log2(highFrequency / lowFrequency);
  const targetPosition = Math.log2(targetFrequency / lowFrequency) / octaveSpan;
  const toothPositions = Float64Array.of(targetPosition);
  const toothWidths = Float64Array.of(0.2);
  const maskOptions = {
    lowFrequency,
    highFrequency,
    toothPositions,
    toothWidths,
    teeth: 1,
    depth: 1,
    sharpness: 1,
    binWidth: SAMPLE_RATE / fftSize,
  };
  assert.equal(spectralFftMaskGain({ ...maskOptions, frequency: targetFrequency }), 0);
  assert.equal(spectralFftMaskGain({ ...maskOptions, frequency: passFrequency }), 1);
  assert.equal(spectralFftMaskGain({ ...maskOptions, frequency: 0 }), 1);
  assert.equal(spectralFftMaskGain({ ...maskOptions, frequency: SAMPLE_RATE / 2 }), 1);
  assert.equal(spectralFftMaskGain({ ...maskOptions, frequency: Number.NaN }), 1);
  assert.equal(spectralFftMaskGain({ ...maskOptions, frequency: targetFrequency, depth: 0 }), 1);

  const filter = new SpectralFftFilter({ sampleRate: SAMPLE_RATE, fftSize });
  filter.setMask(maskOptions);
  const length = fftSize * 72;
  const input = Float64Array.from(
    { length },
    (_, index) => (
      Math.sin(Math.PI * 2 * targetBin * index / fftSize) * 0.3
      + Math.cos(Math.PI * 2 * passBin * index / fftSize) * 0.2
    ),
  );
  const rendered = renderSpectralFilter(filter, input, input, fftSize * 2, [73, 11, 256]);
  const start = fftSize * 8;
  const end = length - fftSize * 4;
  const targetAmplitude = binToneAmplitude(
    rendered.left,
    targetBin,
    fftSize,
    start,
    end,
    filter.latencySamples,
  );
  const passAmplitude = binToneAmplitude(
    rendered.left,
    passBin,
    fftSize,
    start,
    end,
    filter.latencySamples,
  );
  assert.ok(targetAmplitude < 3e-10, "the full-depth FFT hole must deeply reject its bin");
  assert.ok(Math.abs(passAmplitude - 0.2) < 2e-10, "a remote FFT bin must pass flat");
  assert.ok(rendered.left.every(Number.isFinite));
  assert.ok(rendered.right.every(Number.isFinite));
});

test("every physical output gap owns a fully cut nearest FFT bin", () => {
  const kernel = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  const lowFrequency = kernel.current.lowFrequency;
  const highFrequency = kernel.current.highFrequency;
  const octaveSpan = Math.log2(highFrequency / lowFrequency);
  const binWidth = SAMPLE_RATE / MOIRE_DRONE_FFT_SIZE;
  for (let stage = 0; stage < kernel.combStageCount; stage += 1) {
    const centerFrequency = lowFrequency * 2 ** (
      kernel.combNotchPosition[stage] * octaveSpan
    );
    const nearestBin = Math.max(
      1,
      Math.min(MOIRE_DRONE_FFT_SIZE / 2 - 1, Math.round(centerFrequency / binWidth)),
    );
    const gain = spectralFftMaskGain({
      frequency: nearestBin * binWidth,
      lowFrequency,
      highFrequency,
      toothPositions: kernel.combNotchPosition,
      toothWidths: kernel.combNotchWidth,
      teeth: kernel.combStageCount,
      depth: 1,
      sharpness: 1,
      binWidth,
    });
    assert.equal(gain, 0, `gap ${stage} must claim and silence FFT bin ${nearestBin}`);
  }
});

test("the streaming FFT resets exactly and ignores host chunk partitions", () => {
  const fftSize = 256;
  const mask = {
    lowFrequency: 900,
    highFrequency: 19_000,
    toothPositions: Float64Array.of(0.07, 0.31, 0.66, 0.91),
    toothWidths: Float64Array.of(0.08, 0.21, 0.12, 0.28),
    teeth: 4,
    depth: 0.87,
    sharpness: 0.73,
  };
  const input = Float64Array.from(
    { length: fftSize * 13 + 37 },
    (_, index) => (
      Math.sin(index * 0.113) * 0.24
      + Math.cos(index * 0.037) * 0.09
      + (((index * 41) % 127) / 63.5 - 1) * 0.035
    ),
  );
  input[101] = Number.NaN;
  input[777] = Number.POSITIVE_INFINITY;

  const first = new SpectralFftFilter({ sampleRate: SAMPLE_RATE, fftSize });
  const second = new SpectralFftFilter({ sampleRate: SAMPLE_RATE, fftSize });
  first.setMask(mask);
  second.setMask(mask);
  const irregular = renderSpectralFilter(first, input, input, fftSize * 2, [1, 73, 19, 257]);
  const regular = renderSpectralFilter(second, input, input, fftSize * 2, [128]);
  assert.deepEqual(irregular.left, regular.left);
  assert.deepEqual(irregular.right, regular.right);
  assert.ok(irregular.left.every(Number.isFinite));

  for (let index = 0; index < fftSize * 3 + 11; index += 1) {
    first.processSample(Math.sin(index * 0.2), Math.cos(index * 0.17));
  }
  first.reset();
  const afterReset = renderSpectralFilter(first, input, input, fftSize * 2, [37, 211]);
  assert.deepEqual(afterReset.left, regular.left);
  assert.deepEqual(afterReset.right, regular.right);
});

test("the kernel preserves exact Q/FFT endpoints and makes the middle a real intersection", () => {
  const common = {
    ...MOIRE_DRONE_DEFAULTS,
    freeze: true,
    dust: 0,
    filterPairs: 8,
    cascade: 0,
    glideA: 0,
    glideB: 0,
    fieldASpeed: 0,
    fieldBSpeed: 0,
    fabricExcitation: 0,
    fabricVibration: 0,
    autoPluckRate: 0,
    combDepth: 1,
    combTeeth: 4,
    combWidth: 0.16,
    combDrift: 0,
    fftCutDepth: 1,
    fftSharpness: 1,
    qCutDepth: 1,
    qCharacter: 0.82,
    space: 0,
    feedback: 0,
    drive: 0,
    seed: 123_456,
  };
  const makeKernel = (spectralFilterBlend) => {
    const kernel = new MoireDroneKernel({
      sampleRate: SAMPLE_RATE,
      parameters: { ...common, spectralFilterBlend },
    });
    kernel.setActive(true);
    return kernel;
  };
  const qOnly = renderKernel(makeKernel(0), 8_192);
  const fftOnly = renderKernel(makeKernel(1), 8_192);
  const blendAmount = 0.37;
  const hybrid = renderKernel(makeKernel(blendAmount), 8_192);
  assertFiniteBounded([
    qOnly.left, qOnly.right,
    fftOnly.left, fftOnly.right,
    hybrid.left, hybrid.right,
  ]);

  let endpointDifference = 0;
  let squaredIntersectionDifference = 0;
  let comparisonSamples = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const q = channel === 0 ? qOnly.left : qOnly.right;
    const fft = channel === 0 ? fftOnly.left : fftOnly.right;
    const mixed = channel === 0 ? hybrid.left : hybrid.right;
    for (let index = 0; index < mixed.length; index += 1) {
      const expected = q[index] + (fft[index] - q[index]) * blendAmount;
      if (index >= MOIRE_DRONE_FFT_SIZE * 2) {
        squaredIntersectionDifference += (mixed[index] - expected) ** 2;
        comparisonSamples += 1;
      }
      endpointDifference += Math.abs(q[index] - fft[index]);
    }
  }
  assert.ok(endpointDifference > 1, "Q and FFT endpoints must be genuinely different filters");
  assert.ok(
    Math.sqrt(squaredIntersectionDifference / comparisonSamples) > 1e-5,
    "the hybrid must intersect both cuts instead of refilling them with a parallel crossfade",
  );
});

test("the mixed Q/FFT cut rejects a tone passed by one mismatched shoulder", () => {
  const fftSize = MOIRE_DRONE_FFT_SIZE;
  const targetBin = 20;
  const frequency = targetBin * SAMPLE_RATE / fftSize;
  const kernel = new MoireDroneKernel({
    sampleRate: SAMPLE_RATE,
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      spectralSculptMode: "notches",
      freeze: true,
      combDepth: 0.8,
      combTeeth: 3,
      combWidth: 0.16,
      combOffset: 0.5,
      combDrift: 0,
      qCutDepth: 1,
      qCharacter: 0.55,
      fftCutDepth: 1,
      fftSharpness: 0.8,
      fabricDepth: 0,
      propagationDepth: 0,
    },
  });
  kernel.resetCombNotches();
  kernel.fftFilter.reset();
  const length = fftSize * 80;
  const q = new Float64Array(length);
  const fft = new Float64Array(length);
  const intersection = new Float64Array(length);
  const qDepth = 1 - (1 - kernel.sculptDepth * kernel.current.qCutDepth) ** 2;
  for (let sample = 0; sample < length; sample += 1) {
    const input = Math.sin(Math.PI * 2 * frequency * sample / SAMPLE_RATE) * 0.25;
    q[sample] = kernel.processCombNotchChannel(input, 0);
    kernel.fftFilter.processSample(input, input);
    fft[sample] = kernel.fftFilter.outputLeft;
    const serialQ = kernel.processHybridCombChannel(fft[sample], 0);
    intersection[sample] = fft[sample] + (serialQ - fft[sample]) * qDepth;
  }
  const start = fftSize * 12;
  const qAmplitude = rms(q, start) * Math.SQRT2;
  const fftAmplitude = rms(fft, start) * Math.SQRT2;
  const intersectionAmplitude = rms(intersection, start) * Math.SQRT2;
  assert.ok(qAmplitude > fftAmplitude * 4, "the probe must expose a mismatched Q shoulder");
  assert.ok(
    intersectionAmplitude < fftAmplitude * 0.7,
    "the serial midpoint must deepen even the already quieter FFT branch",
  );
  assert.ok(
    intersectionAmplitude < qAmplitude * 0.1,
    "the hybrid must not restore the Q shoulder over the FFT cut",
  );
});

test("every sculpt topology has finite, genuinely distinct Q and FFT renderings", () => {
  const common = {
    ...MOIRE_DRONE_DEFAULTS,
    freeze: true,
    dust: 0,
    filterPairs: 10,
    cascade: 0,
    glideA: 0,
    glideB: 0,
    fieldASpeed: 0,
    fieldBSpeed: 0,
    fabricExcitation: 0,
    fabricVibration: 0,
    autoPluckRate: 0,
    combDepth: 0.88,
    combTeeth: 3,
    combWidth: 0.14,
    combDrift: 0,
    fftCutDepth: 1,
    fftSharpness: 0.82,
    qCutDepth: 1,
    qCharacter: 0.73,
    gestureCoupling: 1,
    gestureMemory: 0.72,
    filteredMix: 1,
    space: 0,
    feedback: 0,
    drive: 0,
    seed: 871_203,
  };
  const gesture = {
    currentX: 0.36,
    currentY: -0.24,
    deltaX: 0.72,
    deltaY: -0.18,
    distance: Math.hypot(0.72, -0.18),
    velocityX: 2.4,
    velocityY: -0.7,
  };

  for (const spectralSculptMode of SPECTRAL_SCULPT_MODES) {
    const renderEndpoint = (spectralFilterBlend) => {
      const kernel = new MoireDroneKernel({
        sampleRate: SAMPLE_RATE,
        parameters: { ...common, spectralSculptMode, spectralFilterBlend },
      });
      kernel.setActive(true);
      kernel.tugFabric(-0.36, -0.06, 0.86, gesture);
      return renderKernel(kernel, 7_168);
    };
    const q = renderEndpoint(0);
    const fft = renderEndpoint(1);
    assertFiniteBounded([q.left, q.right, fft.left, fft.right]);
    assert.ok(rms(q.left, MOIRE_DRONE_FFT_SIZE * 2) > 0.0005, `${spectralSculptMode} Q path must remain audible`);
    assert.ok(rms(fft.left, MOIRE_DRONE_FFT_SIZE * 2) > 0.0005, `${spectralSculptMode} FFT path must remain audible`);
    let squaredDifference = 0;
    let samples = 0;
    for (let index = MOIRE_DRONE_FFT_SIZE * 2; index < q.left.length; index += 1) {
      squaredDifference += (q.left[index] - fft.left[index]) ** 2;
      squaredDifference += (q.right[index] - fft.right[index]) ** 2;
      samples += 2;
    }
    assert.ok(
      Math.sqrt(squaredDifference / samples) > 1e-5,
      `${spectralSculptMode} must not collapse Q and FFT into the same renderer`,
    );
  }
});

test("rapid FFT and Q extremes remain finite across moving gap topologies", () => {
  const kernel = new MoireDroneKernel({
    sampleRate: SAMPLE_RATE,
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      filterPairs: 24,
      cascade: 1,
      autoPluckRate: 0,
      space: 0.7,
      feedback: 0.72,
      drive: 1,
      seed: 0x6ac1d00d,
    },
  });
  kernel.setActive(true);
  const blockShapes = [1, 73, 128, 257];
  const renderedChannels = [];
  for (let block = 0; block < 64; block += 1) {
    const high = block % 2 === 0;
    kernel.setParameters({
      spectralFilterBlend: high ? 1 : 0,
      fftCutDepth: high ? 1 : 0,
      fftSharpness: block % 3 === 0 ? 1 : 0,
      qCutDepth: high ? 0 : 1,
      qCharacter: block % 3 === 1 ? 1 : 0,
      combTeeth: high ? 16 : 1,
      combWidth: high ? 0.48 : 0.02,
      combWarp: high ? 4 : 0,
    });
    if (block % 8 === 0) {
      kernel.pluckFabric(
        ((block * 7) % 17) / 8 - 1,
        ((block * 11) % 19) / 9 - 1,
        high ? 1 : -1,
        high ? 0.6 : 0.02,
      );
    }
    const length = blockShapes[block % blockShapes.length];
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    assert.equal(kernel.process(left, right), true);
    assertFiniteBounded([left, right]);
    renderedChannels.push(left, right);
  }
  const settled = renderKernel(kernel, 4_096, 73);
  assertFiniteBounded([settled.left, settled.right]);
  assert.ok(rms(settled.left, MOIRE_DRONE_FFT_SIZE) > 0.001);
  assert.ok(kernel.fftFilter.outputLeft === 0 || Number.isFinite(kernel.fftFilter.outputLeft));
  assert.ok(kernel.fftFilter.outputRight === 0 || Number.isFinite(kernel.fftFilter.outputRight));
  assert.ok(renderedChannels.every((channel) => channel.every(Number.isFinite)));
});

test("comb phase moves actual silent bands without retuning or resonating them", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    filterPairs: 16,
    latticeScatter: 0,
    fieldADepth: 0,
    fieldBDepth: 0,
    fabricDepth: 0,
    propagationDepth: 0,
    propagationGain: 0,
    combDepth: 1,
    combTeeth: 6,
    combWidth: 0.08,
    combOffset: 0,
    combDrift: 0,
  };
  for (const bank of [0, 1]) {
    const options = {
      index: 6,
      bank,
      phaseA: 0.19,
      phaseB: 0.63,
      parameters,
    };
    const reference = moireFilterTarget({ ...options, combPhase: 0 });
    const centerPhase = wrapUnit(-reference.position * parameters.combTeeth);
    const muted = moireFilterTarget({ ...options, combPhase: centerPhase });
    const open = moireFilterTarget({
      ...options,
      combPhase: wrapUnit(centerPhase + 0.5),
    });
    const bypassed = moireFilterTarget({
      ...options,
      combPhase: centerPhase,
      parameters: { ...parameters, combDepth: 0 },
    });

    assert.equal(muted.frequency, open.frequency);
    assert.equal(muted.q, open.q);
    assert.equal(muted.combGain, 0);
    assert.equal(muted.gain, 0);
    assert.equal(open.combGain, 1);
    assert.ok(open.gain > 0);
    assert.equal(bypassed.combGain, 1);
    assert.equal(bypassed.gain, open.gain);
  }
});

test("the final series comb creates deep acoustic notches after the parallel bank", () => {
  const kernel = new MoireDroneKernel({
    sampleRate: SAMPLE_RATE,
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      freeze: true,
      combDepth: 1,
      combDrift: 0,
      space: 0.7,
      feedback: 0.6,
      drive: 0.8,
    },
  });
  assert.equal(kernel.combStageCount, MOIRE_DRONE_DEFAULTS.combTeeth);
  for (let stage = 0; stage < kernel.combStageCount; stage += 1) {
    const omega = Math.PI * 2 * kernel.combNotchFrequency[stage] / SAMPLE_RATE;
    const numeratorReal = (
      kernel.combNotchB0[stage]
      + kernel.combNotchB1[stage] * Math.cos(-omega)
      + kernel.combNotchB2[stage] * Math.cos(-2 * omega)
    );
    const numeratorImaginary = (
      kernel.combNotchB1[stage] * Math.sin(-omega)
      + kernel.combNotchB2[stage] * Math.sin(-2 * omega)
    );
    assert.ok(
      Math.hypot(numeratorReal, numeratorImaginary) < 1e-12,
      "every output-comb tooth must have a mathematical zero at its center",
    );
  }

  const probeStage = Math.min(3, kernel.combStageCount - 1);
  const frequency = kernel.combNotchFrequency[probeStage];
  kernel.resetCombNotches();
  let inputEnergy = 0;
  let outputEnergy = 0;
  for (let sample = 0; sample < SAMPLE_RATE * 2; sample += 1) {
    const input = Math.sin(Math.PI * 2 * frequency * sample / SAMPLE_RATE);
    const output = kernel.processCombNotchChannel(input, 0);
    if (sample >= SAMPLE_RATE) {
      inputEnergy += input * input;
      outputEnergy += output * output;
    }
  }
  const residual = Math.sqrt(outputEnergy / inputEnergy);
  assert.ok(residual < 1e-6, "the complete series stage must reject a tooth by over 120 dB");
});

test("broad Q cut modes cascade two bounded sections for an unmasked slope", () => {
  for (const spectralSculptMode of [
    "lowpass", "highpass", "bandpass", "bandstop",
  ]) {
    const kernel = new MoireDroneKernel({
      sampleRate: SAMPLE_RATE,
      parameters: {
        ...MOIRE_DRONE_DEFAULTS,
        spectralSculptMode,
        freeze: true,
        combOffset: 0.5,
        combWidth: 0.14,
        qCharacter: 0.42,
        combDrift: 0,
        fabricDepth: 0,
        propagationDepth: 0,
      },
    });
    assert.equal(kernel.combStageCount, 2, `${spectralSculptMode} must use two Q sections`);
    assert.ok(kernel.combNotchFrequency[0] > 0);
    assert.equal(kernel.combNotchFrequency[1], kernel.combNotchFrequency[0]);
    for (const coefficients of [
      kernel.combNotchB0,
      kernel.combNotchB1,
      kernel.combNotchB2,
      kernel.combNotchA1,
      kernel.combNotchA2,
    ]) {
      assert.ok(Number.isFinite(coefficients[0]));
      assert.equal(coefficients[1], coefficients[0]);
    }

    kernel.resetCombNotches();
    for (let sample = 0; sample < SAMPLE_RATE; sample += 1) {
      const impulse = sample === 0 ? 1 : 0;
      assert.ok(Number.isFinite(kernel.processCombNotchChannel(impulse, 0)));
    }
  }

  for (const spectralSculptMode of ["peak", "tilt"]) {
    const kernel = new MoireDroneKernel({
      sampleRate: SAMPLE_RATE,
      parameters: { ...MOIRE_DRONE_DEFAULTS, spectralSculptMode, freeze: true },
    });
    assert.equal(
      kernel.combStageCount,
      1,
      `${spectralSculptMode} must retain one bounded boost section`,
    );
  }
});

test("a frozen physical tug stretches the real output-comb gaps across the fabric", () => {
  const teeth = 7;
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    freeze: true,
    glideA: 0,
    glideB: 0,
    fieldASpeed: 0,
    fieldBSpeed: 0,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricRotation: 0,
    fabricSpin: 0,
    fabricTension: 0.45,
    fabricDamping: 0.18,
    fabricInertia: 0.25,
    fabricPull: 2,
    fabricDepth: 1.35,
    propagationDepth: 0,
    autoPluckRate: 0,
    combDepth: 1,
    combTeeth: teeth,
    combWidth: 0.1,
    combOffset: 0.17,
    combDrift: 0,
    combWarp: 4,
    space: 0,
    feedback: 0,
    seed: 73_191,
  };
  const kernel = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
  assert.ok(kernel.combNotchPosition instanceof Float64Array);
  assert.ok(kernel.combToothWarp instanceof Float64Array);
  const before = Array.from(kernel.combNotchPosition.slice(0, teeth));
  const phaseBefore = kernel.combPhase;
  const anchor = combToothAnchor(3, teeth);
  kernel.setActive(true);
  kernel.tugFabric(anchor.x, anchor.y, 1);
  const rendered = renderKernel(kernel, BLOCK_SIZE * 48);
  assertFiniteBounded([rendered.left, rendered.right]);
  assert.equal(kernel.combPhase, phaseBefore, "Frozen must keep drift out of this measurement");

  const circularDistance = (left, right) => {
    const distance = Math.abs(left - right);
    return Math.min(distance, 1 - distance);
  };
  const positionMotion = Array.from(
    kernel.combNotchPosition.slice(0, teeth),
    (position, stage) => circularDistance(position, before[stage]),
  );
  assert.ok(
    Math.max(...positionMotion) > 1e-5,
    "pulling the 2D weave must move at least one real series-notch center",
  );
  assert.ok(
    Array.from(kernel.combToothWarp.slice(0, teeth))
      .some((warp) => Math.abs(warp) > 1e-5),
    "the physical displacement must reach the comb warp state",
  );

  const octaveSpan = Math.log2(parameters.highFrequency / parameters.lowFrequency);
  for (let stage = 0; stage < teeth; stage += 1) {
    const position = kernel.combNotchPosition[stage];
    const frequency = kernel.combNotchFrequency[stage];
    assert.ok(Number.isFinite(position) && position >= 0 && position < 1);
    assert.ok(Number.isFinite(kernel.combToothWarp[stage]));
    assert.ok(Number.isFinite(frequency) && frequency > 0);
    const expected = Math.min(
      SAMPLE_RATE * 0.42,
      parameters.lowFrequency * 2 ** (position * octaveSpan),
    );
    assert.ok(Math.abs(frequency - expected) < 1e-9);
  }
});

test("propagation modes include radial, modal, ocean, and directional sheet fields", () => {
  assert.deepEqual(SPECTRAL_PROPAGATION_MODES, [
    "drop", "harmonic", "spiral", "shock", "gravity", "standing", "ocean", "sheet",
  ]);
  assert.ok(Object.isFrozen(SPECTRAL_PROPAGATION_MODES));

  const common = {
    originX: 0,
    originY: 0,
    age: 0.37,
    strength: 1.3,
    rate: 7,
    speed: 1.8,
    decay: 4,
    width: 0.07,
    harmonicOrder: 3,
    ringDensity: 4.2,
  };
  const points = [
    [0.21, 0.12],
    [-0.37, 0.18],
    [0.44, -0.31],
    [-0.62, -0.27],
  ];
  const signatures = SPECTRAL_PROPAGATION_MODES.map((mode) => {
    const signature = points.map(([x, y]) => spectralPropagationValue({
      ...common, mode, x, y,
    }));
    for (const value of signature) {
      assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(value) <= 1.5);
    }
    const inverted = points.map(([x, y]) => spectralPropagationValue({
      ...common, mode, x, y, polarity: -1,
    }));
    signature.forEach((value, index) => {
      assert.ok(Math.abs(value + inverted[index]) < 1e-12);
    });
    return signature.map((value) => value.toFixed(8)).join(",");
  });
  assert.equal(new Set(signatures).size, SPECTRAL_PROPAGATION_MODES.length);

  const harmonicRadius = 0.28;
  const harmonicOrder = 3;
  const harmonicPositive = spectralPropagationValue({
    mode: "harmonic",
    x: harmonicRadius,
    y: 0,
    age: 0.2,
    speed: 1.4,
    rate: 5,
    decay: 3,
    width: 0.04,
    harmonicOrder,
    ringDensity: 1,
  });
  const oppositeLobeAngle = Math.PI / harmonicOrder;
  const harmonicNegative = spectralPropagationValue({
    mode: "harmonic",
    x: Math.cos(oppositeLobeAngle) * harmonicRadius,
    y: Math.sin(oppositeLobeAngle) * harmonicRadius,
    age: 0.2,
    speed: 1.4,
    rate: 5,
    decay: 3,
    width: 0.04,
    harmonicOrder,
    ringDensity: 1,
  });
  assert.ok(harmonicPositive * harmonicNegative < 0);
  assert.ok(Math.abs(Math.abs(harmonicPositive) - Math.abs(harmonicNegative)) < 1e-10);

  const peakRadius = (mode, age) => {
    let bestRadius = 0;
    let bestMagnitude = -1;
    for (let step = 0; step <= 100; step += 1) {
      const radius = step / 100;
      const magnitude = Math.abs(spectralPropagationValue({
        mode,
        x: radius,
        y: 0,
        age,
        speed: 2,
        rate: 1,
        decay: 8,
        width: 0.025,
        harmonicOrder: 4,
        ringDensity: 0.25,
      }));
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestRadius = radius;
      }
    }
    return bestRadius;
  };
  for (const mode of ["drop", "shock"]) {
    const radii = [0.1, 0.2, 0.3].map((age) => peakRadius(mode, age));
    assert.ok(radii[0] < radii[1] && radii[1] < radii[2]);
    radii.forEach((radius, index) => {
      assert.ok(Math.abs(radius - (index + 1) * 0.2) <= 0.03);
    });
  }

  const zeroCrossings = (rate) => {
    let previous = spectralPropagationValue({
      mode: "drop", x: 0, y: 0, age: 0.1, rate,
      speed: 2, decay: 8, width: 0.02, ringDensity: 0.25,
    });
    let crossings = 0;
    for (let step = 101; step <= 1_100; step += 1) {
      const current = spectralPropagationValue({
        mode: "drop", x: 0, y: 0, age: step / 1_000, rate,
        speed: 2, decay: 8, width: 0.02, ringDensity: 0.25,
      });
      if ((previous < 0 && current >= 0) || (previous > 0 && current <= 0)) {
        crossings += 1;
      }
      previous = current;
    }
    return crossings;
  };
  assert.ok(zeroCrossings(20) > zeroCrossings(2) * 5);

  const clampProbe = {
    mode: "spiral", x: 0.27, y: -0.41, age: 0.73,
    speed: 2, decay: 3, width: 0.08, harmonicOrder: 5, ringDensity: 3,
  };
  assert.equal(
    spectralPropagationValue({ ...clampProbe, rate: -1 }),
    spectralPropagationValue({ ...clampProbe, rate: 1 }),
  );
  assert.equal(
    spectralPropagationValue({ ...clampProbe, rate: 5_000 }),
    spectralPropagationValue({ ...clampProbe, rate: 50 }),
  );
});

test("standing propagation creates stationary orthogonal nodes anchored by both gesture axes", () => {
  const common = {
    mode: "standing",
    originX: 0,
    originY: 0,
    age: 0.17,
    strength: 1,
    rate: 1,
    speed: 2,
    decay: 8,
    width: 0.1,
    harmonicOrder: 2,
    ringDensity: 4,
    polarity: 1,
  };
  const at = (x, y, overrides = {}) => spectralPropagationValue({
    ...common, ...overrides, x, y,
  });

  const centerAntinode = at(0, 0);
  const adjacentAntinode = at(0.5, 0);
  assert.ok(Math.abs(centerAntinode) > 0.4);
  assert.ok(centerAntinode * adjacentAntinode < 0);
  assert.ok(Math.abs(Math.abs(centerAntinode) - Math.abs(adjacentAntinode)) < 1e-12);
  assert.ok(Math.abs(at(0.25, 0)) < 1e-12, "the X mode must have a fixed node");
  assert.ok(Math.abs(at(0, 0.25)) < 1e-12, "the Y mode must have a fixed node");

  for (const age of [0.08, 0.23, 0.61]) {
    assert.ok(
      Math.abs(at(0.25, 0, { age })) < 1e-12,
      "standing nodes must not travel as the oscillator advances",
    );
    assert.ok(Math.abs(at(0, 0.25, { age })) < 1e-12);
  }

  const shiftedXNode = at(0.35, 0, { originX: 0.1 });
  const shiftedYNode = at(0, 0.05, { originY: -0.2 });
  assert.ok(Math.abs(shiftedXNode) < 1e-12, "originX must translate X nodes");
  assert.ok(Math.abs(shiftedYNode) < 1e-12, "originY must translate Y nodes");
  assert.ok(Math.abs(at(0.25, 0, { originX: 0.1 })) > 0.1);
  assert.ok(Math.abs(at(0, 0.25, { originY: -0.2 })) > 0.1);
});

test("ocean propagation sends Cartesian sheets from the touched side across the fabric", () => {
  const horizontal = {
    mode: "ocean",
    originX: -1,
    originY: 0,
    strength: 1,
    rate: 1,
    speed: 1,
    decay: 8,
    width: 0.03,
    harmonicOrder: 3,
    ringDensity: 0.25,
    polarity: 1,
  };

  // A plane front has the same value everywhere transverse to its direction;
  // a circular front with the same origin demonstrably does not.
  const planeLine = [-0.9, -0.4, 0, 0.7, 1].map((y) => (
    spectralPropagationValue({ ...horizontal, age: 0.6, x: -0.4, y })
  ));
  planeLine.forEach((value) => assert.ok(Math.abs(value - planeLine[0]) < 1e-12));
  const radialCenter = spectralPropagationValue({
    ...horizontal, mode: "drop", age: 0.6, x: -0.4, y: 0,
  });
  const radialEdge = spectralPropagationValue({
    ...horizontal, mode: "drop", age: 0.6, x: -0.4, y: 0.7,
  });
  assert.ok(Math.abs(radialCenter - radialEdge) > 0.1);

  const frontPeak = (age) => {
    let bestX = -1;
    let bestMagnitude = -1;
    for (let step = 0; step <= 400; step += 1) {
      const x = -1 + step / 200;
      const magnitude = Math.abs(spectralPropagationValue({
        ...horizontal, age, x, y: 0.63,
      }));
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestX = x;
      }
    }
    return bestX;
  };
  const ages = [0.2, 0.6, 0.9, 1.4];
  const peaks = ages.map(frontPeak);
  peaks.forEach((peak, index) => {
    assert.ok(Math.abs(peak - (-1 + ages[index])) <= 0.015);
  });
  assert.ok(peaks.every((peak, index) => index === 0 || peak > peaks[index - 1]));

  const vertical = { ...horizontal, originX: 0, originY: -1 };
  const verticalLine = [-0.9, -0.3, 0.2, 0.8].map((x) => (
    spectralPropagationValue({ ...vertical, age: 0.6, x, y: -0.4 })
  ));
  verticalLine.forEach((value) => (
    assert.ok(Math.abs(value - verticalLine[0]) < 1e-12)
  ));
  assert.ok(
    Math.abs(spectralPropagationValue({
      ...horizontal, age: 0.6, x: -0.4, y: 0.6,
    }) - spectralPropagationValue({
      ...vertical, age: 0.6, x: -0.4, y: 0.6,
    })) > 0.1,
    "originX/originY must select and place different orthogonal traveling sheets",
  );

  const corner = { ...horizontal, originX: -1, originY: -1, age: 0.6 };
  const cornerIntersection = spectralPropagationValue({
    ...corner, x: -0.4, y: -0.4,
  });
  const cornerSingleFront = spectralPropagationValue({
    ...corner, x: -0.4, y: 0.6,
  });
  assert.ok(
    Math.abs(cornerIntersection - cornerSingleFront) > 0.05,
    "corner gestures must let the X and Y wave sheets interact",
  );
});

test("elastic sheet propagation follows the pull axis instead of radiating in circles", () => {
  const wave = {
    mode: "sheet",
    originX: 0,
    originY: 0,
    age: 0.2,
    strength: 1,
    rate: 5,
    speed: 2,
    decay: 3,
    width: 0.08,
    harmonicOrder: 3,
    ringDensity: 2,
    polarity: 1,
    directionX: 1,
    directionY: 0,
  };
  const forward = spectralPropagationValue({ ...wave, x: 0.4, y: 0 });
  const transverse = spectralPropagationValue({ ...wave, x: 0.4, y: 0.9 });
  const reverse = spectralPropagationValue({ ...wave, x: -0.29, y: 0 });
  assert.ok(Math.abs(forward) > 0.5);
  assert.ok(Math.abs(forward) > Math.abs(transverse) * 2);
  assert.ok(Math.abs(forward) > Math.abs(reverse) * 2);
  assert.ok(Math.abs(
    forward - spectralPropagationValue({
      ...wave, x: -0.4, y: 0, directionX: -1,
    }),
  ) < 1e-12, "opposite pulls must launch mirrored equal-energy sheets");

  const pool = new SpectralPropagationPool({ maxEntities: 1, activeLimit: 1 });
  pool.trigger({ ...wave, x: 0, y: 0 });
  pool.step(wave.age);
  const vector = pool.sampleVector(0.4, 0, 1, {});
  assert.ok(Math.abs(vector.value - pool.sample(0.4, 0, 1)) < 1e-12);
  assert.ok(Math.abs(vector.x - vector.value) < 1e-12);
  assert.ok(Math.abs(vector.y) < 1e-12);

  const wrappedRadial = new SpectralPropagationPool({ maxEntities: 1, activeLimit: 1 });
  wrappedRadial.trigger({
    mode: "drop", x: 0.95, y: 0, strength: 1, speed: 1, rate: 2,
    decay: 3, width: 0.08, polarity: 1,
  });
  wrappedRadial.step(0.1);
  const radialVector = wrappedRadial.sampleVector(-0.95, 0, 1, {});
  assert.ok(Math.abs(radialVector.value - wrappedRadial.sample(-0.95, 0, 1)) < 1e-12);
  if (Math.abs(radialVector.value) > 1e-9) {
    assert.ok(radialVector.x / radialVector.value > 0);
  }
});

test("directional propagation modes integrate with the pool and stay finite under stress", () => {
  for (const mode of ["standing", "ocean", "sheet"]) {
    const event = {
      mode,
      x: -0.82,
      y: 0.47,
      strength: 0.74,
      rate: 6,
      speed: 2.3,
      decay: 3.1,
      width: 0.12,
      harmonicOrder: 5,
      ringDensity: 7,
      polarity: -1,
      directionX: 0.8,
      directionY: -0.6,
    };
    const pool = new SpectralPropagationPool({ maxEntities: 1, activeLimit: 1 });
    const slot = pool.trigger(event);
    pool.step(0.31);
    const pooled = pool.sample(0.13, -0.29, 1);
    const direct = spectralPropagationValue({
      mode,
      originX: event.x,
      originY: event.y,
      x: 0.13,
      y: -0.29,
      age: pool.age[slot],
      strength: event.strength,
      rate: event.rate,
      speed: event.speed,
      decay: event.decay,
      width: event.width,
      harmonicOrder: event.harmonicOrder,
      ringDensity: event.ringDensity,
      polarity: event.polarity,
      directionX: pool.directionX[slot],
      directionY: pool.directionY[slot],
    });
    assert.ok(Math.abs(pooled - Math.max(-1, Math.min(1, direct))) < 1e-12);

    for (let age = 0; age <= 60; age += 0.37) {
      for (const [x, y] of [[-1, -1], [-0.7, 0.9], [0, 0], [0.8, -0.6], [1, 1]]) {
        const positive = spectralPropagationValue({
          mode, x, y, originX: -99, originY: 99, age,
          strength: 99, rate: 99, speed: 99, decay: 99,
          width: -99, harmonicOrder: 99, ringDensity: 99, polarity: 1,
        });
        const negative = spectralPropagationValue({
          mode, x, y, originX: -99, originY: 99, age,
          strength: 99, rate: 99, speed: 99, decay: 99,
          width: -99, harmonicOrder: 99, ringDensity: 99, polarity: -1,
        });
        assert.ok(Number.isFinite(positive));
        assert.ok(Math.abs(positive) <= 1.5);
        assert.ok(Math.abs(positive + negative) < 1e-12);
      }
    }
  }

  assert.equal(sanitizeMoireDroneParams({ propagationMode: "standing" }).propagationMode, "standing");
  assert.equal(sanitizeMoireDroneParams({ propagationMode: "ocean" }).propagationMode, "ocean");
  assert.equal(sanitizeMoireDroneParams({ propagationMode: "sheet" }).propagationMode, "sheet");
});

test("each ripple can deterministically vary its physical size and sweep speed", () => {
  const launchSequence = (seed, sizeSpread, speedSpread) => {
    const pool = new SpectralPropagationPool({
      maxEntities: 4,
      activeLimit: 4,
      seed,
    });
    for (let event = 0; event < 4; event += 1) {
      pool.trigger({
        mode: "drop",
        x: event * 0.2 - 0.3,
        y: 0,
        strength: 1,
        rate: 7,
        speed: 3.2,
        width: 0.18,
        sizeSpread,
        speedSpread,
        polarity: 1,
      });
    }
    return pool;
  };

  const exact = launchSequence(0x1234, 0, 0);
  assert.deepEqual(Array.from(exact.speed), [3.2, 3.2, 3.2, 3.2]);
  assert.deepEqual(Array.from(exact.width), [0.18, 0.18, 0.18, 0.18]);

  const first = launchSequence(0x89abcdef, 1, 1);
  const second = launchSequence(0x89abcdef, 1, 1);
  assert.deepEqual(first.speed, second.speed);
  assert.deepEqual(first.width, second.width);
  assert.equal(first.randomState, second.randomState);
  assert.ok(new Set(Array.from(first.speed, (value) => value.toFixed(8))).size > 1);
  assert.ok(new Set(Array.from(first.width, (value) => value.toFixed(8))).size > 1);
  assert.ok(first.speed.every((value) => (
    Number.isFinite(value)
      && value >= 0.1
      && value <= MOIRE_DRONE_LIMITS.maxPropagationSpeed
  )));
  assert.ok(first.width.every((value) => (
    Number.isFinite(value) && value >= 0.02 && value <= 0.6
  )));

  const kernel = new MoireDroneKernel({
    sampleRate: SAMPLE_RATE,
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      propagationVoices: 4,
      propagationSizeSpread: 1,
      propagationSpeedSpread: 1,
      autoPluckRate: 0,
      seed: 0x13579bdf,
    },
  });
  for (let event = 0; event < 4; event += 1) {
    kernel.pluckFabric(event * 0.2 - 0.3, 0, 0.8, 0.18);
  }
  assert.equal(kernel.propagation.activeCount, 4);
  const activeSlots = Array.from(kernel.propagation.active, (active, index) => (
    active ? index : -1
  )).filter((index) => index >= 0);
  assert.ok(new Set(activeSlots.map((index) => kernel.propagation.speed[index].toFixed(8))).size > 1);
  assert.ok(new Set(activeSlots.map((index) => kernel.propagation.width[index].toFixed(8))).size > 1);
});

test("propagation interference crossfades from one strongest wave to bounded superposition", () => {
  const createPair = (secondPolarity) => {
    const pool = new SpectralPropagationPool({ maxEntities: 2, activeLimit: 2, seed: 73 });
    const event = {
      mode: "drop",
      x: 0,
      y: 0,
      strength: 0.62,
      rate: 4,
      speed: 1.4,
      decay: 4,
      width: 0.08,
      ringDensity: 1,
      sizeSpread: 0,
      speedSpread: 0,
    };
    pool.trigger({ ...event, polarity: 1 });
    pool.trigger({ ...event, polarity: secondPolarity });
    for (let frame = 0; frame < 3; frame += 1) pool.step(0.1);
    return pool;
  };

  const opposed = createPair(-1);
  const strongest = opposed.sample(0.42, 0, 0);
  const halfMixed = opposed.sample(0.42, 0, 0.5);
  const cancelled = opposed.sample(0.42, 0, 1);
  assert.ok(Math.abs(strongest) > 0.05);
  assert.ok(Math.abs(cancelled) < Math.abs(strongest) * 0.05);
  assert.ok(Math.abs(halfMixed) < Math.abs(strongest));
  assert.ok(Math.abs(halfMixed) > Math.abs(cancelled));

  const aligned = createPair(1);
  const oneWave = Math.abs(aligned.sample(0.42, 0, 0));
  const reinforced = Math.abs(aligned.sample(0.42, 0, 1));
  assert.ok(reinforced > oneWave, "same-polarity fronts must reinforce");
  assert.ok(reinforced <= 1, "interference must remain bounded");
});

test("the propagation pool bounds events and lets slow fronts finish", () => {
  const pool = new SpectralPropagationPool({ maxEntities: 99, seed: 4_242 });
  assert.equal(pool.maxEntities, MOIRE_DRONE_LIMITS.maxPropagations);
  const slow = pool.trigger({
    mode: "drop",
    x: 99,
    y: -99,
    strength: 99,
    rate: -99,
    speed: -99,
    decay: -99,
    width: -99,
    harmonicOrder: -99,
    ringDensity: -99,
    polarity: -1,
  });
  assert.equal(pool.x[slow], 1);
  assert.equal(pool.y[slow], -1);
  assert.equal(pool.strength[slow], 2);
  assert.equal(pool.rate[slow], 1);
  assert.equal(pool.speed[slow], 0.1);
  assert.equal(pool.decay[slow], 0.08);
  assert.equal(pool.width[slow], 0.02);
  assert.equal(pool.harmonicOrder[slow], 0);
  assert.equal(pool.ringDensity[slow], 0.25);
  assert.equal(pool.polarity[slow], -1);
  assert.ok(
    pool.lifetime[slow] > Math.SQRT2 / pool.speed[slow],
    "the slowest front must live long enough to cross the toroidal field",
  );

  for (let event = 1; event < 30; event += 1) {
    pool.trigger({
      mode: SPECTRAL_PROPAGATION_MODES[event % SPECTRAL_PROPAGATION_MODES.length],
      x: event / 20 - 1,
      y: 1 - event / 20,
      strength: 2,
      rate: 50,
      speed: 12,
      decay: 8,
      width: 0.6,
      harmonicOrder: 12,
      ringDensity: 12,
    });
  }
  assert.equal(pool.activeCount, MOIRE_DRONE_LIMITS.maxPropagations);
  assert.ok(pool.energy >= 0 && pool.energy <= 1.5);
  for (let y = -1; y <= 1; y += 0.125) {
    for (let x = -1; x <= 1; x += 0.125) {
      const value = pool.sample(x, y);
      assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(value) <= 1);
    }
  }

  const expiring = new SpectralPropagationPool({ maxEntities: 1, seed: 9 });
  const slot = expiring.trigger({
    speed: 12, decay: 0.08, rate: 50, polarity: 1,
  });
  const lifetime = expiring.lifetime[slot];
  while (expiring.age[slot] + 0.1 < lifetime) {
    assert.equal(expiring.step(0.1), 1);
  }
  expiring.step(0.1);
  assert.equal(expiring.activeCount, 0);
  assert.equal(expiring.sample(0, 0), 0);
});

test("multi-pebble impacts reserve every propagation voice atomically", () => {
  const pool = new SpectralPropagationPool({ maxEntities: 4, activeLimit: 4, seed: 83 });
  for (let index = 0; index < 4; index += 1) {
    pool.trigger({
      mode: "standing", x: -0.75 + index * 0.5, y: 0.8,
      strength: 2, decay: 8, speed: 1, polarity: 1,
    });
  }
  const group = [-0.6, -0.2, 0.2, 0.6].map((x) => ({
    mode: "drop", x, y: -0.35, strength: 0.2, decay: 1, speed: 2,
    width: 0.06, sizeSpread: 0, speedSpread: 0, polarity: 1,
  }));
  const slots = pool.triggerGroup(group);
  assert.equal(new Set(slots).size, 4);
  assert.equal(pool.activeCount, 4);
  assert.deepEqual(Array.from(pool.x), group.map(({ x }) => x));
  assert.ok(Array.from(pool.y).every((y) => y === -0.35));
  assert.ok(Array.from(pool.strength).every((strength) => strength === 0.2));

  const kernel = new MoireDroneKernel({
    sampleRate: SAMPLE_RATE,
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      impactBody: "pebbles",
      propagationVoices: 4,
      propagationSizeSpread: 0.8,
      propagationSpeedSpread: 0,
    },
  });
  for (let index = 0; index < 4; index += 1) {
    kernel.propagation.trigger({
      mode: "standing", x: -0.75 + index * 0.5, y: 0.8,
      strength: 2, decay: 8, speed: 1, polarity: 1,
    });
  }
  const pattern = kernel.impactFabric(0.1, -0.2, 0.9, 0.2, {});
  assert.equal(pattern.length, 4);
  assert.equal(kernel.propagation.activeCount, 4);
  const actualPositions = Array.from(kernel.propagation.active, (active, index) => (
    active ? `${kernel.propagation.x[index].toFixed(8)}:${kernel.propagation.y[index].toFixed(8)}` : null
  )).filter(Boolean).sort();
  const expectedPositions = pattern.map(({ x, y }) => `${x.toFixed(8)}:${y.toFixed(8)}`).sort();
  assert.deepEqual(actualPositions, expectedPositions);
});

test("the propagation pool caps voices, replaces the weakest event, and trims immediately", () => {
  const pool = new SpectralPropagationPool({
    maxEntities: MOIRE_DRONE_LIMITS.maxPropagations,
    activeLimit: 2,
    seed: 0x1234abcd,
  });
  assert.equal(pool.maxEntities, MOIRE_DRONE_LIMITS.maxPropagations);
  assert.equal(pool.activeLimit, 2);

  const strongSlot = pool.trigger({
    x: -0.7, y: 0.2, strength: 2, decay: 8, speed: 1, polarity: 1,
  });
  const weakSlot = pool.trigger({
    x: 0.4, y: -0.5, strength: 0.2, decay: 0.08, speed: 1, polarity: 1,
  });
  pool.step(0.1);
  const replacementSlot = pool.trigger({
    x: 0.8, y: 0.7, strength: 1, decay: 3, speed: 2, polarity: 1,
  });
  assert.equal(replacementSlot, weakSlot, "a saturated pool must replace its weakest residual");
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.x[strongSlot], -0.7);
  assert.equal(pool.x[replacementSlot], 0.8);

  assert.equal(pool.setActiveLimit(99), MOIRE_DRONE_LIMITS.maxPropagationVoices);
  pool.trigger({ x: -0.2, strength: 0.5, decay: 2, polarity: 1 });
  pool.trigger({ x: 0.2, strength: 1.5, decay: 4, polarity: 1 });
  assert.equal(pool.activeCount, MOIRE_DRONE_LIMITS.maxPropagationVoices);
  const residuals = Array.from(pool.active, (active, index) => active
    ? pool.strength[index] * Math.exp(-pool.age[index] / Math.max(0.04, pool.decay[index]))
    : -Infinity);
  const expectedSurvivor = residuals.indexOf(Math.max(...residuals));
  assert.equal(pool.setActiveLimit(-99), 1);
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.active[expectedSurvivor], 1, "trimming must retain the strongest residual");

  const tiny = new SpectralPropagationPool({ maxEntities: 2, activeLimit: 99 });
  assert.equal(tiny.activeLimit, 2);
  assert.equal(tiny.setActiveLimit(99), 2);
});

test("propagation reset and compatible block boundaries are deterministic", () => {
  const triggerSequence = (pool) => {
    for (let index = 0; index < 8; index += 1) {
      pool.trigger({
        mode: SPECTRAL_PROPAGATION_MODES[index % SPECTRAL_PROPAGATION_MODES.length],
        x: index * 0.17 - 0.6,
        y: 0.7 - index * 0.13,
        strength: 0.4 + index * 0.11,
        rate: 1 + index * 6.4,
        speed: 0.2 + index * 1.1,
        decay: 0.3 + index * 0.5,
        width: 0.025 + index * 0.03,
        harmonicOrder: index + 1,
        ringDensity: 0.5 + index,
      });
    }
  };
  const whole = new SpectralPropagationPool({ seed: 0x12345678 });
  const split = new SpectralPropagationPool({ seed: 0x12345678 });
  triggerSequence(whole);
  triggerSequence(split);
  for (let step = 0; step < 60; step += 1) whole.step(1 / 60);
  for (let step = 0; step < 240; step += 1) split.step(1 / 240);
  assert.equal(whole.activeCount, split.activeCount);
  assert.equal(whole.randomState, split.randomState);
  assert.deepEqual(whole.polarity, split.polarity);
  for (let index = 0; index < whole.maxEntities; index += 1) {
    assert.ok(Math.abs(whole.age[index] - split.age[index]) < 1e-12);
  }
  for (let index = 0; index < 25; index += 1) {
    const x = index / 12 - 1;
    const y = ((index * 7) % 25) / 12 - 1;
    assert.ok(Math.abs(whole.sample(x, y) - split.sample(x, y)) < 1e-11);
  }

  const snapshot = {
    active: whole.active.slice(),
    mode: whole.mode.slice(),
    x: whole.x.slice(),
    y: whole.y.slice(),
    strength: whole.strength.slice(),
    polarity: whole.polarity.slice(),
    randomState: whole.randomState,
  };
  whole.reset(0x12345678);
  triggerSequence(whole);
  for (let step = 0; step < 60; step += 1) whole.step(1 / 60);
  assert.deepEqual(whole.active, snapshot.active);
  assert.deepEqual(whole.mode, snapshot.mode);
  assert.deepEqual(whole.x, snapshot.x);
  assert.deepEqual(whole.y, snapshot.y);
  assert.deepEqual(whole.strength, snapshot.strength);
  assert.deepEqual(whole.polarity, snapshot.polarity);
  assert.equal(whole.randomState, snapshot.randomState);
});

test("clearing texture motion can preserve independently drifting comb gaps", () => {
  const kernel = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  kernel.combPhase = 0.417;
  kernel.pluckFabric(0.2, -0.3, 0.8, 0.14);
  assert.equal(kernel.propagation.activeCount, 1);
  kernel.resetFabric({ resetComb: false });
  assert.equal(kernel.propagation.activeCount, 0);
  assert.equal(kernel.combPhase, 0.417);
  kernel.resetFabric();
  assert.equal(kernel.combPhase, 0);
});

test("defaults stay still until one controllable voice is manually or sparsely launched", () => {
  assert.equal(MOIRE_DRONE_DEFAULTS.autoPluckRate, 0);
  assert.equal(MOIRE_DRONE_DEFAULTS.propagationVoices, 1);
  const manual = new MoireDroneKernel({ sampleRate: SAMPLE_RATE });
  manual.setActive(true);
  const untouchedPropagationRandomState = manual.propagation.randomState;
  const idle = renderKernel(manual, SAMPLE_RATE);
  assertFiniteBounded([idle.left, idle.right]);
  assert.equal(manual.propagation.activeCount, 0);
  assert.equal(manual.propagation.activeLimit, 1);
  assert.equal(manual.propagation.randomState, untouchedPropagationRandomState);
  assert.equal(manual.autoLaunchSerial, 0);

  manual.pluckFabric(-0.35, 0.2, 0.8, 0.12);
  assert.equal(manual.propagation.activeCount, 1);
  manual.pluckFabric(0.65, -0.4, 0.9, 0.12);
  assert.equal(manual.propagation.activeCount, 1);
  const manualSlot = manual.propagation.active.findIndex((active) => active === 1);
  assert.equal(manual.propagation.x[manualSlot], 0.65);
  assert.equal(manual.propagation.y[manualSlot], -0.4);

  const automatic = new MoireDroneKernel({
    sampleRate: SAMPLE_RATE,
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      autoPluckRate: 4,
      propagationVoices: 2,
      propagationDecay: 8,
      seed: 0x2468ace0,
    },
  });
  automatic.setActive(true);
  const automaticRandomState = automatic.propagation.randomState;
  const moving = renderKernel(automatic, Math.round(SAMPLE_RATE * 0.75), 73);
  assertFiniteBounded([moving.left, moving.right]);
  assert.equal(automatic.propagation.activeLimit, 2);
  assert.equal(automatic.propagation.activeCount, 2);
  assert.ok(automatic.autoLaunchSerial >= 2);
  assert.notEqual(
    automatic.propagation.randomState,
    automaticRandomState,
    "per-ripple size and speed variety must advance the seeded random sequence",
  );
  for (let index = 0; index < automatic.propagation.maxEntities; index += 1) {
    if (automatic.propagation.active[index]) {
      assert.equal(automatic.propagation.polarity[index], 1);
    }
  }
});

test("filtered mix removes broadband masking progressively without changing its endpoints", () => {
  const common = {
    ...MOIRE_DRONE_DEFAULTS,
    freeze: true,
    dust: 0,
    filterPairs: 8,
    cascade: 0,
    glideA: 0,
    glideB: 0,
    fieldASpeed: 0,
    fieldBSpeed: 0,
    fabricExcitation: 0,
    fabricVibration: 0,
    autoPluckRate: 0,
    combDepth: 0,
    fftCutDepth: 0,
    qCutDepth: 0,
    space: 0,
    feedback: 0,
    drive: 0,
    seed: 0x5ca1ab1e,
  };
  const renderAt = (filteredMix) => {
    const kernel = new MoireDroneKernel({
      sampleRate: SAMPLE_RATE,
      parameters: { ...common, filteredMix },
    });
    kernel.setActive(true);
    return renderKernel(kernel, 8_192);
  };
  const raw = renderAt(0);
  const middle = renderAt(0.5);
  const resonant = renderAt(1);
  assertFiniteBounded([
    raw.left, raw.right,
    middle.left, middle.right,
    resonant.left, resonant.right,
  ]);

  let endpointDifference = 0;
  let maximumCurveError = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const dry = channel === 0 ? raw.left : raw.right;
    const half = channel === 0 ? middle.left : middle.right;
    const wet = channel === 0 ? resonant.left : resonant.right;
    for (let index = MOIRE_DRONE_FFT_SIZE * 2; index < half.length; index += 1) {
      // The residual-noise curve maps a 50% control to 75% resonator signal.
      const expected = dry[index] + (wet[index] - dry[index]) * 0.75;
      maximumCurveError = Math.max(maximumCurveError, Math.abs(half[index] - expected));
      endpointDifference += Math.abs(wet[index] - dry[index]);
    }
  }
  assert.ok(endpointDifference > 1, "raw noise and resonator endpoints must remain distinct");
  assert.ok(maximumCurveError < 2e-7, "the masking curve must retain deterministic endpoints");
});

test("spectral sculpting is not duplicated inside resonators or allowed to force the dry mix", async () => {
  const source = await readFile(MODULE_URL, "utf8");
  const processStart = source.indexOf("  process(leftOutput, rightOutput) {");
  const processEnd = source.indexOf("\nfunction createProcessorClass", processStart);
  assert.ok(processStart >= 0 && processEnd > processStart);
  const processSource = source.slice(processStart, processEnd);
  const resonatorStart = processSource.indexOf("      let filteredLeft = 0;");
  const rawMixStart = processSource.indexOf("      const rawLeft =", resonatorStart);
  const delayStart = processSource.indexOf("      this.delayLeft[", rawMixStart);
  assert.ok(resonatorStart >= 0 && rawMixStart > resonatorStart && delayStart > rawMixStart);

  const resonatorBank = processSource.slice(resonatorStart, rawMixStart);
  assert.doesNotMatch(
    resonatorBank,
    /(?:target)?(?:Comb|Sculpt)Gate|spectralWarpedCombGate/,
    "one resonator must not repeat a mask already rendered by the Q/FFT sculpt stage",
  );
  const sourceMix = processSource.slice(rawMixStart, delayStart);
  assert.match(sourceMix, /this\.current\.filteredMix/);
  assert.doesNotMatch(
    sourceMix,
    /combDepth|spectralSculptMode/,
    "choosing a sculptor must not silently override the user's raw/filtered mix",
  );
});

test("a manual pluck advances and cuts deeply through matched noise while Frozen", () => {
  const parameters = {
    ...MOIRE_DRONE_DEFAULTS,
    freeze: true,
    autoPluckRate: 0,
    fabricExcitation: 0,
    fabricVibration: 0,
    propagationMode: "shock",
    propagationRate: 50,
    propagationSpeed: 12,
    propagationDecay: 0.08,
    propagationDepth: 1.4,
    propagationGain: 1,
    propagationWidth: 0.08,
    combDepth: 1,
    combTeeth: 7,
    combWidth: 0.12,
    combWarp: 3.5,
    pluckCut: 1,
    filteredMix: 1,
    space: 0,
    feedback: 0,
    seed: 84_021,
  };
  const baseline = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
  const plucked = new MoireDroneKernel({ sampleRate: SAMPLE_RATE, parameters });
  baseline.setActive(true);
  plucked.setActive(true);
  renderKernel(baseline, BLOCK_SIZE * 40);
  renderKernel(plucked, BLOCK_SIZE * 40);
  plucked.pluckFabric(0.2, -0.1, 1, 0.12);
  const slot = plucked.propagation.active.findIndex((active) => active === 1);
  assert.ok(slot >= 0);
  const lifetime = plucked.propagation.lifetime[slot];

  const baselineRendered = renderKernel(baseline, BLOCK_SIZE * 100);
  const pluckedRendered = renderKernel(plucked, BLOCK_SIZE * 100);
  const windowStart = Math.round(SAMPLE_RATE * 0.08);
  const windowEnd = Math.min(pluckedRendered.left.length, Math.round(SAMPLE_RATE * 0.26));
  let baselineEnergy = 0;
  let pluckedEnergy = 0;
  let differenceEnergy = 0;
  for (let index = windowStart; index < windowEnd; index += 1) {
    const idleSample = baselineRendered.left[index];
    const pluckedSample = pluckedRendered.left[index];
    baselineEnergy += idleSample * idleSample;
    pluckedEnergy += pluckedSample * pluckedSample;
    differenceEnergy += (pluckedSample - idleSample) ** 2;
  }
  const baselineWindowRms = Math.sqrt(baselineEnergy / (windowEnd - windowStart));
  const pluckedWindowRms = Math.sqrt(pluckedEnergy / (windowEnd - windowStart));
  const differenceRms = Math.sqrt(differenceEnergy / (windowEnd - windowStart));
  assertFiniteBounded([pluckedRendered.left, pluckedRendered.right]);
  assert.ok(plucked.propagation.age[slot] > 0.15);
  assert.ok(baselineWindowRms > 0.005);
  assert.ok(
    differenceRms / baselineWindowRms > 0.22,
    "the post-onset pluck must remain plainly distinct from matched seeded noise",
  );
  assert.ok(
    pluckedWindowRms / baselineWindowRms < 0.9,
    "the pluck must excavate the noise instead of being masked by an additive click",
  );
  assert.ok(rms(pluckedRendered.left) > 0.005);

  const remainingFrames = Math.ceil(
    Math.max(0, lifetime - plucked.propagation.age[slot] + 0.05) * SAMPLE_RATE,
  );
  renderKernel(plucked, remainingFrames);
  assert.equal(plucked.propagation.activeCount, 0);
});

test("high-risk propagation presets stay finite under sparse voice caps and comb gaps", () => {
  const presetIds = [
    "rain-engine", "spherical-choir", "spiral-current", "shock-repeat",
  ];
  for (const id of presetIds) {
    const preset = MOIRE_DRONE_PRESETS.find((candidate) => candidate.id === id);
    assert.ok(preset, `${id} must exist`);
    const kernel = new MoireDroneKernel({
      sampleRate: SAMPLE_RATE,
      parameters: {
        ...MOIRE_DRONE_DEFAULTS,
        ...preset.settings,
        seed: 0x5f3759df,
      },
    });
    kernel.setActive(true);
    const voiceLimit = kernel.target.propagationVoices;
    assert.ok(voiceLimit >= 1 && voiceLimit <= MOIRE_DRONE_LIMITS.maxPropagationVoices);
    for (let event = 0; event < MOIRE_DRONE_LIMITS.maxPropagations * 2; event += 1) {
      kernel.pluckFabric(
        ((event * 7) % 23) / 11 - 1,
        ((event * 13) % 23) / 11 - 1,
        event % 2 ? 2 : -2,
        event % 3 ? 0.02 : 0.6,
      );
    }
    assert.equal(kernel.propagation.activeLimit, voiceLimit);
    assert.equal(kernel.propagation.activeCount, voiceLimit);
    const rendered = renderKernel(kernel, SAMPLE_RATE);
    assertFiniteBounded([rendered.left, rendered.right]);
    assert.ok(rms(rendered.left, BLOCK_SIZE * 8) > 0.001, `${id} must stay audible`);
    assert.ok(kernel.propagation.activeCount <= voiceLimit);
    assert.ok(kernel.propagation.energy >= 0 && kernel.propagation.energy <= 1.5);
    assert.ok(kernel.targetCombGate.every((value) => (
      Number.isFinite(value) && value >= 0 && value <= 1
    )));
    assert.ok(kernel.combGate.every((value) => (
      Number.isFinite(value) && value >= 0 && value <= 1
    )));
    for (const array of [
      kernel.propagation.age,
      kernel.propagation.lifetime,
      kernel.propagation.strength,
      kernel.propagation.rate,
      kernel.propagation.speed,
      kernel.propagation.decay,
      kernel.propagation.width,
      kernel.propagation.ringDensity,
      kernel.propagation.polarity,
    ]) {
      assert.ok(array.every((value) => Number.isFinite(value)));
    }
  }
});
