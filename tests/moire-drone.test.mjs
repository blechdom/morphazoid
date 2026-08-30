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
  MOIRE_DRONE_NOISE_COLOR_CHOICES,
  MOIRE_DRONE_PRESETS,
  MOIRE_DRONE_PROCESSOR_NAME,
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

test("Moiré Drone registers a zero-input self-generating worklet", () => {
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

test("spectral sculpt modes and gesture dynamics sanitize to a stable public contract", () => {
  assert.ok(Object.isFrozen(SPECTRAL_SCULPT_MODES));
  assert.deepEqual(SPECTRAL_SCULPT_MODES, [
    "notches", "ridges", "lowpass", "highpass", "bandpass", "bandstop",
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

test("the names-only preset library is unique, frozen, safe, and audible", () => {
  assert.ok(
    MOIRE_DRONE_PRESETS.length >= 28,
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
    parameters.combDrift.toFixed(3),
    parameters.propagationVoices,
    parameters.autoPluckRate.toFixed(3),
    parameters.propagationMode,
  ].join("|")));
  assert.ok(combSignatures.size >= 12, "presets must not be cosmetic aliases of one comb motion");
  assert.ok(sanitizedPresets.some(({ autoPluckRate }) => autoPluckRate === 0));
  assert.ok(sanitizedPresets.some(({ autoPluckRate }) => autoPluckRate > 0));
  assert.ok(sanitizedPresets.some(({ propagationVoices }) => propagationVoices > 1));
  assert.ok(sanitizedPresets.some(({ combDepth }) => combDepth < 0.8));
  assert.ok(sanitizedPresets.some(({ combDepth }) => combDepth === 1));
  assert.ok(sanitizedPresets.some(({ combDrift }) => combDrift < 0));
  assert.ok(sanitizedPresets.some(({ combDrift }) => combDrift > 0));
  assert.deepEqual(
    new Set(sanitizedPresets.map(({ propagationMode }) => propagationMode)),
    new Set(SPECTRAL_PROPAGATION_MODES),
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
    /<canvas[\s\S]*?id="stage"[\s\S]*?tabindex="0"[\s\S]*?role="application"[\s\S]*?aria-roledescription="interactive spectral vector grid"/,
  );
  assert.match(html, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(html, /id="audioState">off</);
  assert.match(html, /id="audioError" role="alert" hidden/);
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.match(html, /aria-keyshortcuts="Space Enter ArrowLeft ArrowRight ArrowUp ArrowDown"/);
  assert.match(html, /id="fabricExciteButton"[^>]*>Pluck center</);
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
    /data-spectral-sculpt-mode="notches"[^>]*>Gaps<[\s\S]*data-spectral-sculpt-mode="ridges"[^>]*>Ridges<[\s\S]*data-spectral-sculpt-mode="lowpass"[^>]*>Low-pass<[\s\S]*data-spectral-sculpt-mode="highpass"[^>]*>High-pass<[\s\S]*data-spectral-sculpt-mode="bandpass"[^>]*>Window<[\s\S]*data-spectral-sculpt-mode="bandstop"[^>]*>Hollow</,
  );
  assert.match(html, /id="gestureCoupling"[^>]*type="range"/);
  assert.match(html, /id="gestureMemory"[^>]*type="range"/);
  assert.match(
    html,
    /(?:horizontal|low[^<]{0,80}high)[^<]{0,160}(?:frequency|spectrum|touch)[^<]{0,160}(?:pull|distance)[^<]{0,100}(?:deep|depth|width|strength)/i,
  );
  assert.match(
    html,
    /Touch left[\s\S]{0,120}low frequencies[\s\S]{0,120}right[\s\S]{0,120}high frequencies[\s\S]{0,180}pulling farther[\s\S]{0,160}release/i,
  );
  assert.match(html, /id="fabricInstruction"[^>]*>touch a frequency · pull to sculpt</);
  assert.match(
    html,
    /id="propagationModeChoice"[\s\S]*data-propagation-mode="drop"[\s\S]*data-propagation-mode="harmonic"[\s\S]*data-propagation-mode="spiral"[\s\S]*data-propagation-mode="shock"/,
  );
  assert.match(html, /id="propagationRate"[^>]*min="1"[^>]*max="50"/);
  assert.match(html, /id="propagationVoices"[^>]*min="1"[^>]*max="4"/);
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
    /Q filtering gives the sculpture physical resonance[\s\S]*FFT filtering reshapes exact frequency bins[\s\S]*gaps, ridges, shelves, a passing window, or a hollowed band/,
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
  assert.match(html, /for="propagationVoices"><span><b>Max ripples<\/b>/);
  assert.doesNotMatch(html, /data-preset=/, "preset names are rendered without embedded stats");
  for (const [, key] of new Set([
    ["", "noiseColor"], ["", "filterPairs"], ["", "glideA"],
    ["", "propagationRate"], ["", "propagationSpeed"], ["", "propagationDecay"],
    ["", "propagationDepth"], ["", "propagationGain"], ["", "propagationWidth"],
    ["", "harmonicOrder"], ["", "ringDensity"], ["", "autoPluckRate"],
    ["", "propagationVoices"], ["", "combDepth"], ["", "combTeeth"],
    ["", "combWidth"], ["", "combOffset"], ["", "combDrift"],
    ["", "combWarp"], ["", "pluckCut"],
    ["", "gestureCoupling"], ["", "gestureMemory"],
    ["", "spectralFilterBlend"], ["", "fftCutDepth"], ["", "fftSharpness"],
    ["", "qCutDepth"], ["", "qCharacter"],
    ["", "fabricDepth"], ["", "fabricTension"], ["", "fabricRotation"],
    ["", "fieldAAngle"], ["", "fieldBAngle"], ["", "collisionAmount"],
    ["", "stereoWidth"], ["", "outputLevel"],
  ])) {
    assert.match(html, new RegExp(`<label[^>]+for="${key}"`));
    assert.match(html, new RegExp(`<output[^>]+for="${key}"`));
  }
  assert.doesNotMatch(appSource, /new\s+(?:AudioContext|webkitAudioContext)/);
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
    /\$\("spectralSculptModeChoice"\)\.querySelectorAll\("\[data-spectral-sculpt-mode\]"\)[\s\S]*?button\.addEventListener\("click"[\s\S]*?setParameter\("spectralSculptMode", button\.dataset\.spectralSculptMode\)/,
  );
  const applyPointerTugSource = appSource.slice(
    appSource.indexOf("function applyPointerTug("),
    appSource.indexOf("function tugFabricFromPointer("),
  );
  assert.match(
    applyPointerTugSource,
    /visualFabric\.tug\(pointerAnchorLocalX, pointerAnchorLocalY, amount\)/,
  );
  assert.match(
    applyPointerTugSource,
    /audio\.tugFabric\([\s\S]*?pointerAudioAnchorX,[\s\S]*?pointerAudioAnchorY,[\s\S]*?amount,[\s\S]*?currentAudioGesture\(\)[\s\S]*?\)/,
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
    /rotateFabricCoordinate\(\s*point\.x\s*,\s*point\.y\s*,\s*effectiveFabricAngle\(\)\s*,?\s*\)/,
  );
  assert.match(pointerDownSource, /pointerAnchorLocalX\s*=\s*[A-Za-z_$][\w$]*\.x/);
  assert.match(pointerDownSource, /pointerAnchorLocalY\s*=\s*[A-Za-z_$][\w$]*\.y/);
  assert.match(
    pointerDownSource,
    /pointerAudioAnchorX\s*=\s*point\.x[\s\S]*?pointerAudioAnchorY\s*=\s*point\.y[\s\S]*?pointerPullAmount\s*=\s*fabricGesturePull\([\s\S]*?anchorX:\s*pointerAudioAnchorX[\s\S]*?anchorY:\s*pointerAudioAnchorY[\s\S]*?currentX:\s*pointerCurrentX[\s\S]*?currentY:\s*pointerCurrentY[\s\S]*?\)\.amount/,
  );
  assert.match(pointerDownSource, /applyPointerTug\(pointerPullAmount\)/);
  assert.match(pointerDownSource, /void ensureAudioOn\(\)/);
  assert.match(pointerDownSource, /fabricInstruction[\s\S]*?classList\.add\("dismissed"\)/);
  const samplePointerSource = namedFunctionSource(appSource, "samplePointerEvent");
  assert.match(samplePointerSource, /stagePointFromEvent\(event\)/);
  assert.match(samplePointerSource, /pointerCurrentX\s*=\s*point\.x/);
  assert.match(samplePointerSource, /pointerCurrentY\s*=\s*point\.y/);
  assert.match(samplePointerSource, /pointerVelocityX/);
  assert.match(samplePointerSource, /pointerVelocityY/);
  const pointerMoveSource = namedFunctionSource(appSource, "tugFabricFromPointer");
  assert.match(pointerMoveSource, /samplePointerEvent\(event\)/);
  const releasePointerSource = appSource.slice(
    appSource.indexOf("async function releasePointer("),
    appSource.indexOf('$("stage").addEventListener("pointerup"'),
  );
  const finalPointerSample = releasePointerSource.search(/samplePointerEvent\(\s*event\b/);
  const releaseGestureCapture = releasePointerSource.indexOf(
    "const releaseGesture = currentAudioGesture()",
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
    /if \(!wasQuickTap\) \{[\s\S]*?return;\s*\}[\s\S]*?triggerPropagationAt\(/,
  );
  assert.equal(
    (releasePointerSource.match(/triggerPropagationAt\(/g) ?? []).length,
    1,
    "a release must produce at most one ripple, and only for a quick stationary tap",
  );
  assert.match(releasePointerSource, /pointerVelocityX\)\) \* 0\.58/);
  assert.match(releasePointerSource, /pointerVelocityY\)\) \* 0\.58/);
  assert.match(releasePointerSource, /visualFabric\.excite\(/);
  assert.match(releasePointerSource, /const releaseGesture = currentAudioGesture\(\)/);
  assert.match(releasePointerSource, /audio\.releaseFabric\(releaseGesture\)/);
  assert.match(
    releasePointerSource,
    /audio\.kickFabric\([\s\S]*?releaseAudioAnchorX,[\s\S]*?releaseAudioAnchorY,[\s\S]*?releaseGesture,[\s\S]*?\)/,
  );
  assert.match(cssSource, /#stage\s*\{[\s\S]*?cursor:\s*grab/);
  assert.match(cssSource, /#stage\.is-grabbed[\s\S]*?cursor:\s*grabbing/);
  assert.match(
    appSource,
    /function ensureAudioOn\(\)[\s\S]*?if \(audioStartPromise\) return audioStartPromise[\s\S]*?audioStartPromise = \(async \(\) => \{[\s\S]*?await audio\.start\(\)[\s\S]*?return true[\s\S]*?return audioStartPromise/,
  );
  assert.match(
    appSource,
    /\$\("fabricExciteButton"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?if \(!await ensureAudioOn\(\)\) return;[\s\S]*?triggerPropagationAt\(/,
  );
  assert.match(
    appSource,
    /\$\("stage"\)\.addEventListener\("keydown", async \(event\) => \{[\s\S]*?event\.key === "Enter"[\s\S]*?if \(!await ensureAudioOn\(\)\) return;[\s\S]*?triggerPropagationAt\(/,
  );
  const triggerPropagationSource = namedFunctionSource(appSource, "triggerPropagationAt");
  assert.match(triggerPropagationSource, /if \(sendAudio\)\s*\{/);
  assert.match(triggerPropagationSource, /captureVisualSculptGesture\(/);
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
  assert.ok(Number.isInteger(gridColumns) && gridColumns >= 2);
  assert.ok(Number.isInteger(gridRows) && gridRows >= 2);
  assert.match(appSource, /const STATIC_GRID_PINK\s*=\s*"#ff5cad"/i);
  assert.match(appSource, /const STATIC_GRID_GREEN\s*=\s*"#68f7a4"/i);
  const staticGridRenderer = namedFunctionSource(appSource, "drawStaticVectorGrid");
  assert.match(staticGridRenderer, /column\s*\/\s*STATIC_GRID_COLUMNS/);
  assert.match(staticGridRenderer, /row\s*\/\s*STATIC_GRID_ROWS/);
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
  const staticGridPointSource = namedFunctionSource(appSource, "staticGridPoint");
  assert.match(
    staticGridPointSource,
    /visualPullOffsetAt/,
    "direct pointer pulls must still deform the static grid",
  );
  assert.match(
    staticGridPointSource,
    /visualFabric\.(?:sample|sampleLocal)[\s\S]*visualPropagation\.sample/,
    "fabric tugs and manual pluck ripples must still deform the static grid",
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
    "the displayed spectral shape must be derived from live or remembered gesture state",
  );
  const captureVisualGestureSource = namedFunctionSource(
    appSource,
    "captureVisualSculptGesture",
  );
  assert.match(captureVisualGestureSource, /focus|currentX|pointerCurrentX/);
  assert.match(captureVisualGestureSource, /width|currentY|deltaY|pointerCurrentY/);
  assert.match(captureVisualGestureSource, /depth|amount|distance|pointerPullAmount/);
  const stepVisualGestureSource = namedFunctionSource(appSource, "stepVisualSculptGesture");
  assert.match(stepVisualGestureSource, /memory|gestureMemory|decay|Math\.exp/i);
  const visualCombGeometrySource = namedFunctionSource(appSource, "updateVisualCombGeometry");
  assert.match(visualCombGeometrySource, /visualSculptGeometry\(\)/);
  assert.match(visualCombGeometrySource, /\.focus\b/);
  const spectralMaskSource = namedFunctionSource(appSource, "drawSpectralCombMask");
  assert.match(spectralMaskSource, /visualSculptGeometry\(\)|currentVisualSculpt/);
  assert.match(spectralMaskSource, /\.focus\b/);
  assert.match(spectralMaskSource, /\.width\b/);
  assert.match(spectralMaskSource, /\.depth\b/);
  assert.doesNotMatch(
    spectralMaskSource,
    /focus:\s*settings\.combOffset/,
    "the visual response must follow gesture focus rather than only the static offset",
  );
  const broadRegionsSource = namedFunctionSource(appSource, "drawBroadSculptRegions");
  assert.match(broadRegionsSource, /visualSculptGeometry\(\)|currentVisualSculpt/);
  assert.match(broadRegionsSource, /sculpt\.periodic/);
  assert.match(broadRegionsSource, /mode:\s*settings\.spectralSculptMode/);
  assert.match(
    broadRegionsSource,
    /context2d\.(?:fillRect|ellipse|arc|fill)\(/,
    "broad sculpt modes need a visible region on the fabric, not only a thin response strip",
  );
  const drawSource = namedFunctionSource(appSource, "draw");
  assert.match(drawSource, /drawBroadSculptRegions\(\)/);
  assert.match(drawSource, /drawStaticVectorGrid\(\)/);
  assert.doesNotMatch(drawSource, /renderSpectralTexture\(\)|drawImage\(\s*textureCanvas/);
  const animateSource = namedFunctionSource(appSource, "animate");
  assert.match(animateSource, /stepVisualSculptGesture\(/);
  assert.doesNotMatch(
    animateSource,
    /state\.(?:shepardPhaseA|shepardPhaseB|fieldPhaseA|fieldPhaseB|fabricSpinPhase|combPhase)\s*=/,
    "the background field, lattice, and sculpt phases must not advance on their own",
  );
  assert.doesNotMatch(
    animateSource,
    /triggerAutomaticVisualPropagation\(|autoPluckRate/,
    "the static visual page must not create automatic background ripples",
  );
  assert.match(
    animateSource,
    /if\s*\(\s*staticGridHasDeformation\(\)\s*\)\s*\{[\s\S]*?visualFabric\.step\(\s*elapsed\s*,\s*settings\s*,\s*true\s*\)/,
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
    fabricDepth: 99,
    fabricExcitation: -4,
    fabricVibration: 4,
    fabricRate: 0,
    fabricRotation: 999,
    fabricSpin: -99,
    fabricPull: 99,
  });

  assert.equal(settings.fabricTension, 0);
  assert.equal(settings.fabricDamping, 1);
  assert.equal(settings.fabricInertia, MOIRE_DRONE_DEFAULTS.fabricInertia);
  assert.equal(settings.fabricDepth, MOIRE_DRONE_LIMITS.maxFabricDepth);
  assert.equal(settings.fabricExcitation, 0);
  assert.equal(settings.fabricVibration, 1);
  assert.equal(settings.fabricRate, 0.05);
  assert.equal(settings.fabricRotation, 180);
  assert.equal(settings.fabricSpin, -MOIRE_DRONE_LIMITS.maxFabricSpin);
  assert.equal(settings.fabricPull, 2);
  assert.equal(
    MOIRE_DRONE_LIMITS.fabricWidth * MOIRE_DRONE_LIMITS.fabricHeight,
    MOIRE_DRONE_LIMITS.fabricNodes,
  );
});

test("fabric impulses are local, toroidal, deterministic, and bounded", () => {
  assert.equal(fabricImpulseWeight(0.2, -0.3, 0.2, -0.3, 0.2), 1);
  const near = fabricImpulseWeight(0.24, -0.28, 0.2, -0.3, 0.2);
  const far = fabricImpulseWeight(-0.5, 0.6, 0.2, -0.3, 0.2);
  assert.ok(near > far * 1_000);
  assert.ok(
    fabricImpulseWeight(-0.99, 0, 0.99, 0, 0.1) > 0.9,
    "opposite fabric edges must be adjacent on the torus",
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

test("tension spreads an impulse while damping removes membrane energy", () => {
  const common = {
    ...MOIRE_DRONE_DEFAULTS,
    fabricExcitation: 0,
    fabricVibration: 0,
    fabricInertia: 0.3,
    fabricDamping: 0.1,
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
    tautFarField > slackFarField * 100,
    "higher tension must propagate a local impulse across the weave faster",
  );

  const ringing = new SpectralFabric({ seed: 8 });
  const damped = new SpectralFabric({ seed: 8 });
  ringing.excite(0.15, -0.2, 1, 0.12);
  damped.excite(0.15, -0.2, 1, 0.12);
  for (let step = 0; step < 120; step += 1) {
    ringing.step(1 / 240, { ...common, fabricTension: 0.58, fabricDamping: 0 }, true);
    damped.step(1 / 240, { ...common, fabricTension: 0.58, fabricDamping: 1 }, true);
  }
  assert.ok(damped.energy < ringing.energy * 0.5);
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
      fabricExcitation: 0,
      fabricVibration: 0,
    },
  });
  const rotatedKernel = new MoireDroneKernel({
    parameters: {
      ...MOIRE_DRONE_DEFAULTS,
      freeze: true,
      fabricRotation: 90,
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
  audio.pluckFabric(0.14, -0.16, 0.81, 0.19, gesture);

  assert.deepEqual(messages.map(({ type }) => type), [
    "fabric-tug", "fabric-release", "fabric-kick", "fabric-pluck",
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
  assert.ok(
    strong.gestureEnvelope - weak.gestureEnvelope > 0.08,
    "stored pull distance must survive release as materially different ring energy",
  );
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

test("extreme spectral-fabric motion stays finite and shifts the filter lattice", () => {
  const fabric = new SpectralFabric({ width: 99, height: 99, seed: 31_337 });
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
  assert.ok(fabric.acceleration.every((value) => Number.isFinite(value) && Math.abs(value) <= 520));

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

  const defaults = sanitizeMoireDroneParams();
  assert.equal(defaults.autoPluckRate, 0);
  assert.equal(defaults.propagationVoices, 1);
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

test("six spectral sculptors have distinct, finite, frequency-selective responses", () => {
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
      gains.every((gain) => gain <= (mode === "ridges" ? 3.000001 : 1.000001)),
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

  const lowFocusCut = response("bandstop", 0.2, { focus: 0.2 });
  const lowFocusRemote = response("bandstop", 0.8, { focus: 0.2 });
  const highFocusRemote = response("bandstop", 0.2, { focus: 0.8 });
  const highFocusCut = response("bandstop", 0.8, { focus: 0.8 });
  assert.ok(lowFocusCut + 0.25 < lowFocusRemote);
  assert.ok(highFocusCut + 0.25 < highFocusRemote);
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
    spectralCombGate({ ...center, depth: 0.8, influence: 0.5 }) - 0.6
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

test("the kernel crossfades sample-exactly between aligned Q and FFT engines", () => {
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
  let maximumBlendError = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const q = channel === 0 ? qOnly.left : qOnly.right;
    const fft = channel === 0 ? fftOnly.left : fftOnly.right;
    const mixed = channel === 0 ? hybrid.left : hybrid.right;
    for (let index = 0; index < mixed.length; index += 1) {
      const expected = q[index] + (fft[index] - q[index]) * blendAmount;
      maximumBlendError = Math.max(maximumBlendError, Math.abs(mixed[index] - expected));
      endpointDifference += Math.abs(q[index] - fft[index]);
    }
  }
  assert.ok(endpointDifference > 1, "Q and FFT endpoints must be genuinely different filters");
  assert.ok(
    maximumBlendError < 2e-7,
    "the phase-aligned hybrid must be a linear sample-accurate crossfade",
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

test("the four propagation modes move outward, repeat at rate, and preserve polarity", () => {
  assert.deepEqual(SPECTRAL_PROPAGATION_MODES, [
    "drop", "harmonic", "spiral", "shock",
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
        mode: SPECTRAL_PROPAGATION_MODES[index % 4],
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
  assert.equal(
    automatic.propagation.randomState,
    automaticRandomState,
    "automatic placement and polarity must not consume random choices",
  );
  for (let index = 0; index < automatic.propagation.maxEntities; index += 1) {
    if (automatic.propagation.active[index]) {
      assert.equal(automatic.propagation.polarity[index], 1);
    }
  }
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
