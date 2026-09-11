import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  SIMD_SYNTH_BLOCK_SIZE,
  SIMD_SYNTH_DEFAULTS,
  SIMD_SYNTH_DEFAULT_MOD_ROUTES,
  SIMD_SYNTH_DEFAULT_SEQUENCE,
  SIMD_SYNTH_MOD_DESTINATIONS,
  SIMD_SYNTH_MOD_ROUTE_COUNT,
  SIMD_SYNTH_MOD_SOURCES,
  SIMD_SYNTH_PARAM_ORDER,
  SIMD_SYNTH_SEQUENCE_LENGTH,
  SIMD_SYNTH_VOICE_COUNT,
  createSimdSynthConfiguration,
  createSimdSynthKernelViews,
  createSimdSynthSequence,
  sanitizeSimdSynthModRoutes,
  sanitizeSimdSynthParams,
  sanitizeSimdSynthSequence,
  simdSynthParamArray,
  writeSimdSynthConfiguration,
} from "../src/simd-synth.js";
import {
  SIMD_SYNTH_USER_PRESET_STORAGE_KEY,
  createSimdSynthUserPreset,
  loadSimdSynthUserPresets,
  persistSimdSynthUserPresets,
  sanitizeSimdSynthPresetName,
} from "../src/simd-synth-user-presets.js";
import { simdSynthPresetById } from "../src/simd-synth-presets.js";

const root = new URL("../", import.meta.url);
const scalarUrl = new URL("assets/wasm/simd-synth-scalar.wasm", root);
const simdUrl = new URL("assets/wasm/simd-synth-simd.wasm", root);

const wasmAssetsReady = await Promise.all([scalarUrl, simdUrl].map(async (url) => {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
})).then((results) => results.every(Boolean));

const wasmTest = (name, callback) => test(name, {
  skip: wasmAssetsReady ? false : "SIMD SYNTH Wasm assets have not been built yet",
}, callback);

const REQUIRED_KERNEL_EXPORTS = [
  "memory",
  "process",
  "reset",
  "note_on",
  "note_off",
  "all_notes_off",
  "set_sequence_active",
  "lane_width",
  "block_size",
  "voice_count",
  "output_left_ptr",
  "output_right_ptr",
  "params_ptr",
  "sequence_ptr",
  "mod_routes_ptr",
  "voice_note_ptr",
  "voice_gate_ptr",
  "voice_envelope_ptr",
];

async function loadKernel(url) {
  const bytes = await readFile(url);
  assert.equal(WebAssembly.validate(bytes), true);
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = new WebAssembly.Instance(module);
  return {
    bytes,
    module,
    kernel: createSimdSynthKernelViews(instance),
  };
}

function testPatch(overrides = {}) {
  return {
    params: {
      ...SIMD_SYNTH_DEFAULTS,
      sourceA: 0,
      sourceB: 0,
      colorA: 0.72,
      motionA: 0,
      detailA: 12,
      combine: 0,
      combineMix: 0,
      combineDrive: 0.72,
      shaper: 0,
      shaperAmount: 0,
      filter1: 0,
      filter2: 0,
      filterRoute: 0,
      attack: 0.002,
      decay: 0.4,
      sustain: 0.8,
      release: 0.2,
      stereo: 0,
      drift: 0,
      fx1: 0,
      fx1Amount: 0,
      fx2: 0,
      fx2Amount: 0,
      ...overrides,
    },
    sequence: SIMD_SYNTH_DEFAULT_SEQUENCE,
    modRoutes: Array.from({ length: SIMD_SYNTH_MOD_ROUTE_COUNT }, () => [0, 0, 0, 0]),
  };
}

function renderNote(kernel, patch = testPatch(), options = {}) {
  const sampleRate = options.sampleRate ?? 48_000;
  const blocks = options.blocks ?? 40;
  const note = options.note ?? 60;
  const velocity = options.velocity ?? 0.84;
  kernel.exports.reset();
  writeSimdSynthConfiguration(kernel, createSimdSynthConfiguration(patch));
  kernel.exports.note_on(note, velocity);
  const samples = [];
  for (let block = 0; block < blocks; block += 1) {
    const time = block * SIMD_SYNTH_BLOCK_SIZE / sampleRate;
    kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, time, time);
    samples.push(...kernel.outputLeft, ...kernel.outputRight);
  }
  return samples;
}

function renderPolyNotes(kernel, patch, notes, options = {}) {
  const sampleRate = options.sampleRate ?? 48_000;
  const blocks = options.blocks ?? 40;
  kernel.exports.reset();
  writeSimdSynthConfiguration(kernel, createSimdSynthConfiguration(patch));
  for (const [note, velocity] of notes) kernel.exports.note_on(note, velocity);
  const samples = [];
  for (let block = 0; block < blocks; block += 1) {
    const time = block * SIMD_SYNTH_BLOCK_SIZE / sampleRate;
    kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, time, time);
    samples.push(...kernel.outputLeft, ...kernel.outputRight);
  }
  return samples;
}

function renderStereoMean(kernel, patch, notes, options = {}) {
  const sampleRate = options.sampleRate ?? 48_000;
  const warmupBlocks = options.warmupBlocks ?? 750;
  const measuredBlocks = options.measuredBlocks ?? 1_500;
  kernel.exports.reset();
  writeSimdSynthConfiguration(kernel, createSimdSynthConfiguration(patch));
  for (const [note, velocity] of notes) kernel.exports.note_on(note, velocity);

  let currentBlock = 0;
  const processBlock = () => {
    const time = currentBlock * SIMD_SYNTH_BLOCK_SIZE / sampleRate;
    kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, time, time);
    currentBlock += 1;
  };
  for (let block = 0; block < warmupBlocks; block += 1) processBlock();

  let left = 0;
  let right = 0;
  let samples = 0;
  for (let block = 0; block < measuredBlocks; block += 1) {
    processBlock();
    for (let frame = 0; frame < SIMD_SYNTH_BLOCK_SIZE; frame += 1) {
      left += kernel.outputLeft[frame];
      right += kernel.outputRight[frame];
      samples += 1;
    }
  }
  return { left: left / samples, right: right / samples };
}

function signalStats(samples) {
  let peak = 0;
  let sumOfSquares = 0;
  let nonZero = 0;
  for (const sample of samples) {
    assert.equal(Number.isFinite(sample), true);
    peak = Math.max(peak, Math.abs(sample));
    sumOfSquares += sample * sample;
    if (sample !== 0) nonZero += 1;
  }
  return {
    peak,
    nonZero,
    rms: Math.sqrt(sumOfSquares / samples.length),
  };
}

function signalAgreement(reference, candidate) {
  assert.equal(reference.length, candidate.length);
  let errorEnergy = 0;
  let referenceEnergy = 0;
  let candidateEnergy = 0;
  let dotProduct = 0;
  let maximumDifference = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const referenceSample = reference[index];
    const candidateSample = candidate[index];
    assert.equal(Number.isFinite(referenceSample), true);
    assert.equal(Number.isFinite(candidateSample), true);
    const difference = referenceSample - candidateSample;
    errorEnergy += difference * difference;
    referenceEnergy += referenceSample * referenceSample;
    candidateEnergy += candidateSample * candidateSample;
    dotProduct += referenceSample * candidateSample;
    maximumDifference = Math.max(maximumDifference, Math.abs(difference));
  }
  return {
    correlation: dotProduct / Math.sqrt(Math.max(referenceEnergy * candidateEnergy, Number.EPSILON)),
    maximumDifference,
    normalizedError: Math.sqrt(errorEnergy / Math.max(referenceEnergy, Number.EPSILON)),
  };
}

test("SIMD SYNTH sanitizes parameters, sequence steps, and modulation routes", () => {
  const params = sanitizeSimdSynthParams({
    sourceA: -20,
    sourceB: 99,
    tuneA: -200,
    tuneB: 200,
    detailA: 3.6,
    cutoff1: -1,
    cutoff2: Infinity,
    attack: -2,
    release: 99,
    steps: 8.7,
    xyX: -1,
    xyY: 2,
    seed: 0,
  });
  assert.equal(params.sourceA, 0);
  assert.equal(params.sourceB, 7);
  assert.equal(params.tuneA, -24);
  assert.equal(params.tuneB, 24);
  assert.equal(params.detailA, 4);
  assert.equal(params.cutoff1, 45);
  assert.equal(params.cutoff2, SIMD_SYNTH_DEFAULTS.cutoff2);
  assert.equal(params.attack, 0.002);
  assert.equal(params.release, 8);
  assert.equal(params.steps, 9);
  assert.equal(params.xyX, 0);
  assert.equal(params.xyY, 1);
  assert.equal(params.seed, 1);

  const sequence = sanitizeSimdSynthSequence([
    [99, 2, -1, 2],
    [-99, 0.49, Number.NaN, -2],
  ]);
  assert.deepEqual(sequence[0], [24, 1, 0.05, 1]);
  assert.deepEqual(sequence[1], [-12, 0, 0.72, 0]);
  assert.equal(sequence.length, SIMD_SYNTH_SEQUENCE_LENGTH);

  const routes = sanitizeSimdSynthModRoutes([
    [99, 99, 2, -2],
    [-1, -1, -2, 2],
  ]);
  assert.deepEqual(routes[0], [SIMD_SYNTH_MOD_SOURCES.length - 1, SIMD_SYNTH_MOD_DESTINATIONS.length - 1, 1, -1]);
  assert.deepEqual(routes[1], [0, 0, -1, 1]);
  assert.equal(routes.length, SIMD_SYNTH_MOD_ROUTE_COUNT);
});

test("SIMD SYNTH keeps its 51-parameter order aligned with kernel configuration arrays", () => {
  assert.equal(SIMD_SYNTH_PARAM_ORDER.length, 51);
  assert.equal(new Set(SIMD_SYNTH_PARAM_ORDER).size, 51);
  assert.equal(Object.keys(SIMD_SYNTH_DEFAULTS).length, 51);
  assert.deepEqual(Object.keys(SIMD_SYNTH_DEFAULTS), [...SIMD_SYNTH_PARAM_ORDER]);

  const configuration = createSimdSynthConfiguration({
    params: { ...SIMD_SYNTH_DEFAULTS, sourceA: 6, cutoff1: 1234, xyY: 0.81 },
    sequence: [[7, 1, 0.93, 0.4]],
    modRoutes: [[9, 14, -0.75, 0.5]],
  });
  assert.deepEqual(Object.keys(configuration.params), [...SIMD_SYNTH_PARAM_ORDER]);
  assert.equal(configuration.paramArray.length, 51);
  assert.equal(configuration.sequenceArray.length, SIMD_SYNTH_SEQUENCE_LENGTH * 4);
  assert.equal(configuration.modRouteArray.length, SIMD_SYNTH_MOD_ROUTE_COUNT * 4);
  assert.equal(configuration.paramArray instanceof Float32Array, true);
  assert.equal(configuration.sequenceArray instanceof Float32Array, true);
  assert.equal(configuration.modRouteArray instanceof Float32Array, true);
  for (const [index, key] of SIMD_SYNTH_PARAM_ORDER.entries()) {
    assert.equal(configuration.paramArray[index], Math.fround(configuration.params[key]), key);
  }
  assert.deepEqual([...configuration.sequenceArray.slice(0, 4)], [7, 1, Math.fround(0.93), Math.fround(0.4)]);
  assert.deepEqual([...configuration.modRouteArray.slice(0, 4)], [9, 14, -0.75, 0.5]);
  assert.deepEqual(simdSynthParamArray(configuration.params), configuration.paramArray);
});

test("SIMD SYNTH seeded sequence generation is deterministic and bounded", () => {
  const first = createSimdSynthSequence(42_271, 0.64);
  const second = createSimdSynthSequence(42_271, 0.64);
  const different = createSimdSynthSequence(42_272, 0.64);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(first.length, SIMD_SYNTH_SEQUENCE_LENGTH);
  first.forEach(([degree, enabled, velocity, slide], index) => {
    assert.equal(Number.isInteger(degree), true);
    assert.ok(degree >= 0 && degree <= 19);
    assert.ok(enabled === 0 || enabled === 1);
    assert.ok(velocity >= 0.05 && velocity <= 1);
    assert.ok(slide >= 0 && slide <= 1);
    if (index % 4 === 0) assert.equal(enabled, 1);
  });
});

test("SIMD SYNTH browser presets round-trip a complete sanitized patch", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const preset = createSimdSynthUserPreset({
    params: { ...SIMD_SYNTH_DEFAULTS, sourceA: 99, cutoff1: 1337, seed: 12_345 },
    sequence: [[24, 1, 0.91, 0.72]],
    modRoutes: [[9, 14, -0.67, 0.42]],
  }, "  Browser\n Reef  ", {
    now: 1_700_000_000_000,
    random: () => 0.5,
  });

  assert.equal(preset.label, "Browser Reef");
  assert.match(preset.id, /^user:/);
  assert.equal(preset.category, "My presets");
  assert.equal(preset.userPreset, true);
  assert.equal(preset.params.sourceA, 7);
  assert.equal(preset.params.cutoff1, 1337);
  assert.deepEqual(preset.sequence[0], [24, 1, 0.91, 0.72]);
  assert.deepEqual(preset.modRoutes[0], [9, 14, -0.67, 0.42]);
  assert.equal(Object.isFrozen(preset), true);
  assert.equal(Object.isFrozen(preset.params), true);
  assert.equal(Object.isFrozen(preset.sequence[0]), true);
  assert.equal(persistSimdSynthUserPresets(storage, [preset]), true);

  const stored = JSON.parse(values.get(SIMD_SYNTH_USER_PRESET_STORAGE_KEY));
  assert.equal(stored.version, 1);
  assert.deepEqual(loadSimdSynthUserPresets(storage), [preset]);
  assert.equal(sanitizeSimdSynthPresetName("  wet\t\n patch  "), "wet patch");
  assert.deepEqual(loadSimdSynthUserPresets({ getItem: () => "not json" }), []);
  assert.equal(persistSimdSynthUserPresets({ setItem: () => { throw new Error("quota"); } }, []), false);
  assert.throws(() => createSimdSynthUserPreset({}, "   "), /preset name/i);
});

wasmTest("scalar and f32x4 SIMD SYNTH kernels expose the required bounded ABI", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  for (const candidate of [scalar, simd]) {
    const exports = new Set(WebAssembly.Module.exports(candidate.module).map(({ name }) => name));
    for (const name of REQUIRED_KERNEL_EXPORTS) assert.equal(exports.has(name), true, name);
    assert.equal(candidate.kernel.exports.block_size(), SIMD_SYNTH_BLOCK_SIZE);
    assert.equal(candidate.kernel.exports.voice_count(), SIMD_SYNTH_VOICE_COUNT);
    assert.equal(candidate.kernel.outputLeft.length, SIMD_SYNTH_BLOCK_SIZE);
    assert.equal(candidate.kernel.outputRight.length, SIMD_SYNTH_BLOCK_SIZE);
    assert.equal(candidate.kernel.params.length, 51);
    assert.equal(candidate.kernel.sequence.length, SIMD_SYNTH_SEQUENCE_LENGTH * 4);
    assert.equal(candidate.kernel.modRoutes.length, SIMD_SYNTH_MOD_ROUTE_COUNT * 4);
    assert.equal(candidate.kernel.voiceNote.length, SIMD_SYNTH_VOICE_COUNT);
  }
  assert.equal(scalar.kernel.exports.lane_width(), 1);
  assert.equal(simd.kernel.exports.lane_width(), 4);
  assert.notDeepEqual(scalar.bytes, simd.bytes);
});

wasmTest("both SIMD SYNTH kernels render a bounded non-silent note", async () => {
  const kernels = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  for (const { kernel } of kernels) {
    const stats = signalStats(renderNote(kernel));
    assert.ok(stats.nonZero > SIMD_SYNTH_BLOCK_SIZE, "note sustains beyond a single block");
    assert.ok(stats.rms > 0.001, "note has audible signal energy");
    assert.ok(stats.peak > 0.005, "note has a meaningful peak");
    assert.ok(stats.peak <= 0.92, "kernel respects its output ceiling");
  }
});

wasmTest("SIMD SYNTH rendering responds materially to a timbre parameter", async () => {
  const { kernel } = await loadKernel(scalarUrl);
  const dark = renderNote(kernel, testPatch({ colorA: 0, detailA: 16 }));
  const bright = renderNote(kernel, testPatch({ colorA: 1, detailA: 16 }));
  let absoluteDifference = 0;
  for (let index = 0; index < dark.length; index += 1) {
    absoluteDifference += Math.abs(dark[index] - bright[index]);
  }
  assert.ok(absoluteDifference / dark.length > 0.005, "source color audibly changes the rendered waveform");
});

wasmTest("scalar and f32x4 SIMD SYNTH rendering remain reasonably close", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const patch = testPatch({ colorA: 0.63, detailA: 11, tuneA: -5 });
  const scalarSamples = renderNote(scalar.kernel, patch);
  const simdSamples = renderNote(simd.kernel, patch);
  assert.equal(scalarSamples.length, simdSamples.length);

  let errorEnergy = 0;
  let scalarEnergy = 0;
  let simdEnergy = 0;
  let dotProduct = 0;
  let maximumDifference = 0;
  for (let index = 0; index < scalarSamples.length; index += 1) {
    const scalarSample = scalarSamples[index];
    const simdSample = simdSamples[index];
    const difference = scalarSample - simdSample;
    assert.equal(Number.isFinite(scalarSample), true);
    assert.equal(Number.isFinite(simdSample), true);
    errorEnergy += difference * difference;
    scalarEnergy += scalarSample * scalarSample;
    simdEnergy += simdSample * simdSample;
    dotProduct += scalarSample * simdSample;
    maximumDifference = Math.max(maximumDifference, Math.abs(difference));
  }
  const normalizedError = Math.sqrt(errorEnergy / Math.max(scalarEnergy, Number.EPSILON));
  const correlation = dotProduct / Math.sqrt(Math.max(scalarEnergy * simdEnergy, Number.EPSILON));
  assert.ok(normalizedError < 0.03, `normalized scalar/SIMD error ${normalizedError}`);
  assert.ok(correlation > 0.995, `scalar/SIMD correlation ${correlation}`);
  assert.ok(maximumDifference < 0.02, `maximum scalar/SIMD difference ${maximumDifference}`);
});

wasmTest("SIMD SYNTH transport releases and retriggers its reserved voice on the same step", async () => {
  const kernels = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const sampleRate = 48_000;
  const sequenceTime = 0.1;
  const configuration = createSimdSynthConfiguration({
    ...testPatch({
      rootNote: 60,
      bpm: 30,
      gateLength: 1,
      attack: 0.002,
      decay: 0.02,
      sustain: 0.8,
      release: 0.08,
    }),
    sequence: Array.from({ length: SIMD_SYNTH_SEQUENCE_LENGTH }, () => [0, 1, 0.9, 0]),
  });

  for (const { kernel } of kernels) {
    kernel.exports.reset();
    writeSimdSynthConfiguration(kernel, configuration);
    kernel.exports.set_sequence_active(1);
    let absoluteTime = 0;
    for (let block = 0; block < 80; block += 1) {
      kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, absoluteTime, sequenceTime);
      absoluteTime += SIMD_SYNTH_BLOCK_SIZE / sampleRate;
    }
    assert.equal(kernel.voiceGate[0], 1, "sequencer voice is gated before pause");

    kernel.exports.set_sequence_active(0);
    assert.equal(kernel.voiceGate[0], 0, "pause releases the reserved sequencer voice");
    const sustainedEnvelope = kernel.voiceEnvelope[0];
    for (let block = 0; block < 16; block += 1) {
      kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, absoluteTime, sequenceTime);
      absoluteTime += SIMD_SYNTH_BLOCK_SIZE / sampleRate;
    }
    const releasedEnvelope = kernel.voiceEnvelope[0];
    assert.ok(releasedEnvelope < sustainedEnvelope, "paused voice enters its release stage");

    kernel.exports.set_sequence_active(1);
    assert.equal(kernel.voiceGate[0], 0, "resume begins from a released gate");
    kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, absoluteTime, sequenceTime);
    assert.equal(kernel.voiceGate[0], 1, "same-step resume restores the sequence gate");
    assert.ok(kernel.voiceEnvelope[0] > releasedEnvelope, "same-step resume retriggers the attack stage");
  }
});

wasmTest("SIMD SYNTH note-off preserves reserved sequencer voice zero", async () => {
  const kernels = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const configuration = createSimdSynthConfiguration({
    ...testPatch({ rootNote: 60, bpm: 30, gateLength: 1 }),
    sequence: Array.from({ length: SIMD_SYNTH_SEQUENCE_LENGTH }, () => [0, 1, 0.9, 0]),
  });

  for (const { kernel } of kernels) {
    kernel.exports.reset();
    writeSimdSynthConfiguration(kernel, configuration);
    kernel.exports.set_sequence_active(1);
    kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, 48_000, 0, 0.1);
    assert.equal(kernel.voiceNote[0], 60);
    assert.equal(kernel.voiceGate[0], 1);

    kernel.exports.note_on(60, 0.7);
    assert.equal(kernel.voiceNote[1], 60, "matching manual note uses the first non-reserved voice");
    assert.equal(kernel.voiceGate[1], 1);
    kernel.exports.note_off(60);
    assert.equal(kernel.voiceGate[0], 1, "manual note-off does not release sequencer voice zero");
    assert.equal(kernel.voiceGate[1], 0, "manual note-off still releases the matching manual voice");
  }
});

wasmTest("SIMD SYNTH saturated voice allocation steals voices in true oldest order", async () => {
  const kernels = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  for (const { kernel } of kernels) {
    kernel.exports.reset();
    for (let voice = 0; voice < SIMD_SYNTH_VOICE_COUNT; voice += 1) {
      kernel.exports.note_on(60 + voice, 0.8);
    }
    assert.deepEqual([...kernel.voiceNote], [60, 61, 62, 63, 64, 65, 66, 67]);

    kernel.exports.note_on(80, 0.8);
    assert.equal(kernel.voiceNote[0], 80, "first overflow steals the oldest voice zero");
    kernel.exports.note_on(81, 0.8);
    assert.equal(kernel.voiceNote[0], 80, "newly stolen voice is not immediately stolen again");
    assert.equal(kernel.voiceNote[1], 81, "second overflow advances to the next-oldest voice");
  }
});

wasmTest("inactive SIMD lanes preserve scalar-equivalent phase and filter state", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const sampleRate = 48_000;
  const idleBlocks = 400;
  const measuredBlocks = 12;
  const configuration = createSimdSynthConfiguration(testPatch({
    sourceA: 0,
    sourceB: 1,
    combine: 1,
    combineMix: 0.8,
    combineDrive: 2,
    filter1: 1,
    cutoff1: 700,
    resonance1: 0.9,
    filter2: 2,
    cutoff2: 1_800,
    resonance2: 0.8,
    filterRoute: 5,
    filterBlend: 0.8,
    attack: 0.002,
    decay: 0.2,
    sustain: 0.8,
  }));

  const renderAfterIdle = (kernel) => {
    kernel.exports.reset();
    writeSimdSynthConfiguration(kernel, configuration);
    for (let block = 0; block < idleBlocks; block += 1) {
      const time = block * SIMD_SYNTH_BLOCK_SIZE / sampleRate;
      kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, time, 0);
    }
    kernel.exports.note_on(60, 0.9);
    const samples = [];
    for (let block = 0; block < measuredBlocks; block += 1) {
      const absoluteBlock = idleBlocks + block;
      const time = absoluteBlock * SIMD_SYNTH_BLOCK_SIZE / sampleRate;
      kernel.exports.process(SIMD_SYNTH_BLOCK_SIZE, sampleRate, time, 0);
      samples.push(...kernel.outputLeft, ...kernel.outputRight);
    }
    return samples;
  };

  const agreement = signalAgreement(renderAfterIdle(scalar.kernel), renderAfterIdle(simd.kernel));
  assert.ok(agreement.normalizedError < 0.005, `idle-onset scalar/SIMD error ${agreement.normalizedError}`);
  assert.ok(agreement.correlation > 0.999, `idle-onset scalar/SIMD correlation ${agreement.correlation}`);
  assert.ok(agreement.maximumDifference < 0.001, `idle-onset maximum difference ${agreement.maximumDifference}`);
});

wasmTest("modal source keeps the scalar and f32x4 ratio formula in parity", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const patch = testPatch({ sourceA: 3, colorA: 0.87, motionA: 0.31, detailA: 20 });
  const notes = [[48, 0.82], [55, 0.67], [62, 0.91], [69, 0.74]];
  const agreement = signalAgreement(
    renderPolyNotes(scalar.kernel, patch, notes),
    renderPolyNotes(simd.kernel, patch, notes),
  );
  assert.ok(agreement.normalizedError < 0.01, `normalized modal scalar/SIMD error ${agreement.normalizedError}`);
  assert.ok(agreement.correlation > 0.999, `modal scalar/SIMD correlation ${agreement.correlation}`);
  assert.ok(agreement.maximumDifference < 0.01, `maximum modal scalar/SIMD difference ${agreement.maximumDifference}`);
});

wasmTest("particle source hashes per-voice color independently across SIMD lanes", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const patch = {
    ...testPatch({ sourceA: 4, colorA: 0.5, motionA: 0.73, detailA: 14 }),
    modRoutes: [[6, 2, 1, 0]],
  };
  const notes = [[48, 0.12], [53, 0.38], [60, 0.69], [67, 0.97]];
  const scalarSamples = renderPolyNotes(scalar.kernel, patch, notes, { blocks: 64 });
  const simdSamples = renderPolyNotes(simd.kernel, patch, notes, { blocks: 64 });
  const scalarStats = signalStats(scalarSamples);
  const simdStats = signalStats(simdSamples);
  assert.ok(scalarStats.rms > 0.001);
  assert.ok(simdStats.rms > 0.001);
  const agreement = signalAgreement(scalarSamples, simdSamples);
  assert.ok(agreement.normalizedError < 0.02, `normalized particle scalar/SIMD error ${agreement.normalizedError}`);
  assert.ok(agreement.correlation > 0.999, `particle scalar/SIMD correlation ${agreement.correlation}`);
  assert.ok(agreement.maximumDifference < 0.015, `maximum particle scalar/SIMD difference ${agreement.maximumDifference}`);
});

wasmTest("feedback routing rejects sustained DC on both backends", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const patch = simdSynthPresetById("feedback-reef");
  const notes = [[38, 0.9], [45, 0.73], [50, 0.82]];
  for (const { kernel } of [scalar, simd]) {
    const mean = renderStereoMean(kernel, patch, notes);
    assert.ok(Math.abs(mean.left) < 0.01, `left DC mean ${mean.left}`);
    assert.ok(Math.abs(mean.right) < 0.01, `right DC mean ${mean.right}`);
  }
});
