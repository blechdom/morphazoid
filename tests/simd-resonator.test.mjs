import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SIMD_AUDIO_ENGINES,
  SIMD_AUDIO_PRESETS,
  SIMD_GRANULAR_DEFAULTS,
  SIMD_GRANULAR_MAX_GRAINS,
  SIMD_GRANULAR_SOURCE_SIZE,
  SIMD_RESONATOR_DEFAULTS,
  SIMD_RESONATOR_MAX_MODES,
  SIMD_SWARM_DEFAULTS,
  copySimdResonatorState,
  createSimdGranularConfiguration,
  createSimdAudioConfiguration,
  createSimdResonatorConfiguration,
  createSimdResonatorKernelViews,
  createSimdSwarmConfiguration,
  presetsForSimdEngine,
  sanitizeSimdGranularSettings,
  sanitizeSimdResonatorSettings,
  sanitizeSimdSwarmSettings,
  writeSimdAudioConfiguration,
  writeSimdResonatorConfiguration,
} from "../src/simd-resonator.js";

const root = new URL("../", import.meta.url);
const scalarUrl = new URL("assets/wasm/simd-resonator-scalar.wasm", root);
const simdUrl = new URL("assets/wasm/simd-resonator-simd.wasm", root);

async function loadKernel(url) {
  const bytes = await readFile(url);
  assert.equal(WebAssembly.validate(bytes), true);
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  return {
    bytes,
    module,
    kernel: createSimdResonatorKernelViews(new WebAssembly.Instance(module)),
  };
}

function renderImpulse(kernel, configuration, blockCount = 320) {
  kernel.exports.reset();
  writeSimdResonatorConfiguration(kernel, configuration);
  kernel.input.fill(0);
  const rendered = new Float32Array(blockCount * 128 * 2);
  for (let block = 0; block < blockCount; block += 1) {
    kernel.exports.process(
      128,
      configuration.settings.modeCount,
      block === 0 ? 0.78 : 0,
      configuration.outputScale,
    );
    rendered.set(kernel.outputLeft, block * 256);
    rendered.set(kernel.outputRight, block * 256 + 128);
  }
  return rendered;
}

function rms(values, start = 0, end = values.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += values[index] * values[index];
  return Math.sqrt(sum / Math.max(1, end - start));
}

function renderGranular(kernel, configuration, heldBlocks = 80, releaseBlocks = 120) {
  kernel.exports.reset();
  writeSimdAudioConfiguration(kernel, configuration);
  kernel.input.fill(0);
  const rendered = new Float32Array((heldBlocks + releaseBlocks) * 256);
  for (let block = 0; block < heldBlocks + releaseBlocks; block += 1) {
    kernel.exports.process_granular(
      128,
      configuration.grainCount,
      block < heldBlocks ? configuration.spawnIncrement : 0,
      configuration.grainSizeSamples,
      configuration.pitchRatio,
      configuration.scanPosition,
      configuration.scatter,
      configuration.stereoWidth,
      0,
      block === 0 ? 6 : 0,
      configuration.outputScale,
    );
    rendered.set(kernel.outputLeft, block * 256);
    rendered.set(kernel.outputRight, block * 256 + 128);
  }
  return rendered;
}

function renderSwarm(kernel, configuration, blockCount = 80) {
  kernel.exports.reset();
  writeSimdAudioConfiguration(kernel, configuration);
  const rendered = new Float32Array(blockCount * 256);
  for (let block = 0; block < blockCount; block += 1) {
    kernel.exports.process_swarm(128, configuration.voiceCount, configuration.outputScale);
    rendered.set(kernel.outputLeft, block * 256);
    rendered.set(kernel.outputRight, block * 256 + 128);
  }
  return rendered;
}

function renderAdditionalEngine(kernel, configuration, blockCount = 32) {
  kernel.exports.reset();
  writeSimdAudioConfiguration(kernel, configuration);
  kernel.input.fill(0);
  const rendered = new Float32Array(blockCount * 256);
  for (let block = 0; block < blockCount; block += 1) {
    if (configuration.engine === "freeze") {
      kernel.exports.process_freeze(128, configuration.binCount, block === 0 ? 0.8 : 0, 0, configuration.sourceOffset, configuration.outputScale);
    } else if (configuration.engine === "ir") {
      kernel.exports.process_ir(128, configuration.tapCount, configuration.morph, block === 0 ? 0.8 : 0, 0, configuration.outputScale);
    } else if (configuration.engine === "mesh") {
      kernel.exports.process_mesh(128, configuration.modeCount, block === 0 ? 0.8 : 0, configuration.coupling, configuration.outputScale);
    } else if (configuration.engine === "waveguide") {
      kernel.exports.process_waveguides(128, configuration.stringCount, block === 0 ? 0.8 : 0, 0, configuration.outputScale);
    } else if (configuration.engine === "spatial") {
      kernel.exports.process_spatial(128, configuration.sourceCount, configuration.outputScale);
    }
    rendered.set(kernel.outputLeft, block * 256);
    rendered.set(kernel.outputRight, block * 256 + 128);
  }
  return rendered;
}

test("SIMD Resonator settings stay finite, bounded, and lane-aligned", () => {
  const settings = sanitizeSimdResonatorSettings({
    modeCount: 127,
    baseFrequency: Number.POSITIVE_INFINITY,
    decaySeconds: -20,
    spread: 12,
    strikePosition: -4,
    hardness: Number.NaN,
    fftSize: 330,
    fftWindow: 22,
    fftHopRatio: 0.01,
    fftBandCount: 127,
    fftResponseMs: 9_000,
    fftLowFrequency: -20,
    fftHighFrequency: Number.NaN,
    fftDetail: -1,
    fftMix: 5,
    fftInputGain: 99,
    fftGateDb: -200,
  });
  assert.equal(settings.modeCount % 4, 0);
  assert.ok(settings.modeCount >= 32 && settings.modeCount <= SIMD_RESONATOR_MAX_MODES);
  assert.equal(settings.baseFrequency, SIMD_RESONATOR_DEFAULTS.baseFrequency);
  assert.equal(settings.decaySeconds, 0.35);
  assert.equal(settings.spread, 1);
  assert.equal(settings.strikePosition, 0.04);
  assert.equal(settings.hardness, SIMD_RESONATOR_DEFAULTS.hardness);
  assert.equal(settings.fftSize, 256);
  assert.equal(settings.fftWindow, 3);
  assert.equal(settings.fftHopRatio, 0.125);
  assert.equal(settings.fftBandCount, 128);
  assert.equal(settings.fftResponseMs, 800);
  assert.equal(settings.fftLowFrequency, 20);
  assert.equal(settings.fftHighFrequency, SIMD_RESONATOR_DEFAULTS.fftHighFrequency);
  assert.equal(settings.fftDetail, 0);
  assert.equal(settings.fftMix, 1);
  assert.equal(settings.fftInputGain, 4);
  assert.equal(settings.fftGateDb, -96);

  const configuration = createSimdResonatorConfiguration(settings, Number.NaN);
  assert.equal(configuration.sampleRate, 48_000);
  assert.equal(configuration.fftHopSize, 32);
  assert.equal(configuration.fftHighFrequency, 12_000);
  assert.ok(configuration.audibleModes > 0);
  for (const key of ["cosine", "sine", "decay", "strike", "gain", "panLeft", "panRight"]) {
    assert.equal(configuration[key].length, SIMD_RESONATOR_MAX_MODES);
    assert.equal(configuration[key].every(Number.isFinite), true, key);
  }
});

test("granular and swarm settings stay bounded and lane-aligned", () => {
  const granular = sanitizeSimdGranularSettings({
    grainCount: 63,
    density: 999,
    grainSizeMs: -2,
    pitchSemitones: Number.NaN,
    scanPosition: 3,
  });
  assert.equal(granular.grainCount, SIMD_GRANULAR_MAX_GRAINS);
  assert.equal(granular.density, 720);
  assert.equal(granular.grainSizeMs, 18);
  assert.equal(granular.pitchSemitones, SIMD_GRANULAR_DEFAULTS.pitchSemitones);
  assert.equal(granular.scanPosition, 1);

  const swarm = sanitizeSimdSwarmSettings({
    voiceCount: 127,
    centerFrequency: Number.POSITIVE_INFINITY,
    detuneCents: 0,
    stereoWidth: 4,
  });
  assert.equal(swarm.voiceCount % 4, 0);
  assert.equal(swarm.centerFrequency, SIMD_SWARM_DEFAULTS.centerFrequency);
  assert.equal(swarm.detuneCents, 2);
  assert.equal(swarm.stereoWidth, 1);

  const grainConfiguration = createSimdGranularConfiguration(granular, 48_000);
  assert.equal(grainConfiguration.source.length, SIMD_GRANULAR_SOURCE_SIZE);
  assert.equal(grainConfiguration.source.every(Number.isFinite), true);
  const swarmConfiguration = createSimdSwarmConfiguration(swarm, 48_000);
  for (const key of ["swarmCosine", "swarmSine", "swarmGain", "swarmPanLeft", "swarmPanRight"]) {
    assert.equal(swarmConfiguration[key].length, SIMD_RESONATOR_MAX_MODES);
    assert.equal(swarmConfiguration[key].every(Number.isFinite), true, key);
  }
});

test("scalar and f32x4 kernels expose the same bounded ABI", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  assert.equal(scalar.kernel.exports.lane_width(), 1);
  assert.equal(simd.kernel.exports.lane_width(), 4);
  assert.equal(scalar.kernel.exports.block_size(), 128);
  assert.equal(simd.kernel.exports.block_size(), 128);
  assert.equal(scalar.kernel.exports.max_modes(), SIMD_RESONATOR_MAX_MODES);
  assert.equal(simd.kernel.exports.max_modes(), SIMD_RESONATOR_MAX_MODES);
  assert.equal(scalar.kernel.exports.max_grains(), SIMD_GRANULAR_MAX_GRAINS);
  assert.equal(simd.kernel.exports.max_grains(), SIMD_GRANULAR_MAX_GRAINS);
  assert.equal(scalar.kernel.exports.grain_source_size(), SIMD_GRANULAR_SOURCE_SIZE);
  assert.equal(simd.kernel.exports.grain_source_size(), SIMD_GRANULAR_SOURCE_SIZE);
  assert.notDeepEqual(scalar.bytes, simd.bytes);
});

test("scalar and SIMD render the same finite, decaying resonator", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const configuration = createSimdResonatorConfiguration({
    modeCount: 128,
    baseFrequency: 78,
    decaySeconds: 0.65,
    spread: 0.43,
    strikePosition: 0.37,
    hardness: 0.74,
  }, 48_000);
  const scalarOutput = renderImpulse(scalar.kernel, configuration);
  const simdOutput = renderImpulse(simd.kernel, configuration);
  let peak = 0;
  let maximumDifference = 0;
  for (let index = 0; index < scalarOutput.length; index += 1) {
    assert.equal(Number.isFinite(scalarOutput[index]), true);
    assert.equal(Number.isFinite(simdOutput[index]), true);
    peak = Math.max(peak, Math.abs(scalarOutput[index]), Math.abs(simdOutput[index]));
    maximumDifference = Math.max(
      maximumDifference,
      Math.abs(scalarOutput[index] - simdOutput[index]),
    );
  }
  assert.ok(peak > 0.0001, "impulse is audible");
  assert.ok(peak <= 1, "soft clip bounds output");
  assert.ok(maximumDifference < 0.00005, "same recurrence across backends");

  const window = 128 * 2 * 20;
  assert.ok(
    rms(simdOutput, simdOutput.length - window) < rms(simdOutput, 0, window),
    "tail loses energy",
  );
});

test("scalar and SIMD render the same bounded granular cloud and release", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const configuration = createSimdGranularConfiguration({
    grainCount: 64,
    density: 96,
    grainSizeMs: 74,
    pitchSemitones: 5,
    scanPosition: 0.61,
    scatter: 0.42,
    stereoWidth: 0.88,
  }, 48_000);
  const scalarOutput = renderGranular(scalar.kernel, configuration);
  const simdOutput = renderGranular(simd.kernel, configuration);
  let peak = 0;
  let maximumDifference = 0;
  for (let index = 0; index < scalarOutput.length; index += 1) {
    assert.equal(Number.isFinite(scalarOutput[index]), true);
    assert.equal(Number.isFinite(simdOutput[index]), true);
    peak = Math.max(peak, Math.abs(scalarOutput[index]), Math.abs(simdOutput[index]));
    maximumDifference = Math.max(maximumDifference, Math.abs(scalarOutput[index] - simdOutput[index]));
  }
  assert.ok(peak > 0.001, "cloud is audible");
  assert.ok(peak <= 1, "cloud stays bounded");
  assert.ok(maximumDifference < 0.0002, "same grain schedule and windows");
  assert.ok(rms(simdOutput, simdOutput.length - 2_048) < 0.00001, "release stops spawning and reaches silence");
});

test("scalar and SIMD render the same finite oscillator swarm", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const configuration = createSimdSwarmConfiguration({
    voiceCount: 128,
    centerFrequency: 164,
    detuneCents: 51,
    stereoWidth: 0.91,
  }, 48_000);
  const scalarOutput = renderSwarm(scalar.kernel, configuration);
  const simdOutput = renderSwarm(simd.kernel, configuration);
  let peak = 0;
  let maximumDifference = 0;
  for (let index = 0; index < scalarOutput.length; index += 1) {
    assert.equal(Number.isFinite(scalarOutput[index]), true);
    assert.equal(Number.isFinite(simdOutput[index]), true);
    peak = Math.max(peak, Math.abs(scalarOutput[index]), Math.abs(simdOutput[index]));
    maximumDifference = Math.max(maximumDifference, Math.abs(scalarOutput[index] - simdOutput[index]));
  }
  assert.ok(peak > 0.001, "swarm is audible");
  assert.ok(peak <= 1, "swarm stays bounded");
  assert.ok(maximumDifference < 0.0002, "same quadrature oscillator bank");
});

test("presets cover every engine and granular density reaches a full cloud", async () => {
  assert.equal(new Set(SIMD_AUDIO_PRESETS.map((entry) => entry.id)).size, SIMD_AUDIO_PRESETS.length);
  for (const engine of SIMD_AUDIO_ENGINES) {
    assert.ok(presetsForSimdEngine(engine).length >= 4, engine + " has distinct starting points");
    assert.equal(presetsForSimdEngine(engine).every((entry) => entry.note?.length > 20), true, engine + " presets explain their audible intent");
    const configuration = createSimdAudioConfiguration(engine, {}, 48_000);
    assert.equal(configuration.engine, engine);
    assert.equal(Object.values(configuration.settings).every(Number.isFinite), true, engine);
  }

  const { kernel } = await loadKernel(scalarUrl);
  const activeAfter = (density) => {
    const configuration = createSimdGranularConfiguration({ density, grainSizeMs: 200 }, 48_000);
    kernel.exports.reset(); writeSimdAudioConfiguration(kernel, configuration); kernel.input.fill(0);
    for (let block = 0; block < 150; block += 1) {
      kernel.exports.process_granular(128, configuration.grainCount, configuration.spawnIncrement, configuration.grainSizeSamples, configuration.pitchRatio, configuration.scanPosition, configuration.scatter, configuration.stereoWidth, 0, 0, configuration.outputScale);
    }
    return [...kernel.grainAge].filter((age) => age >= 0 && age < 1).length;
  };
  const sparse = activeAfter(40);
  const dense = activeAfter(680);
  assert.ok(dense >= 56, "dense preset fills most of the bounded pool");
  assert.ok(dense > sparse * 3, "density materially increases simultaneous grains");
});

test("scalar and SIMD match for freeze, IR, mesh, waveguide, and spatial POCs", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  for (const engine of ["freeze", "ir", "mesh", "waveguide", "spatial"]) {
    const configuration = createSimdAudioConfiguration(engine, {}, 48_000);
    const scalarOutput = renderAdditionalEngine(scalar.kernel, configuration);
    const simdOutput = renderAdditionalEngine(simd.kernel, configuration);
    let peak = 0;
    let maximumDifference = 0;
    for (let index = 0; index < scalarOutput.length; index += 1) {
      assert.equal(Number.isFinite(scalarOutput[index]), true, engine + " scalar finite");
      assert.equal(Number.isFinite(simdOutput[index]), true, engine + " SIMD finite");
      peak = Math.max(peak, Math.abs(scalarOutput[index]), Math.abs(simdOutput[index]));
      maximumDifference = Math.max(maximumDifference, Math.abs(scalarOutput[index] - simdOutput[index]));
    }
    assert.ok(peak > 0.00001, engine + " produces signal");
    assert.ok(peak <= 1, engine + " stays bounded");
    assert.ok(maximumDifference < 0.0005, engine + " matches across backends");
  }
});

test("backend state copies without restarting the resonator", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const configuration = createSimdResonatorConfiguration({}, 48_000);
  writeSimdResonatorConfiguration(scalar.kernel, configuration);
  writeSimdResonatorConfiguration(simd.kernel, configuration);
  scalar.kernel.input.fill(0);
  scalar.kernel.exports.process(128, 128, 0.5, configuration.outputScale);
  copySimdResonatorState(scalar.kernel, simd.kernel);
  assert.deepEqual(simd.kernel.real, scalar.kernel.real);
  assert.deepEqual(simd.kernel.imaginary, scalar.kernel.imaginary);
  assert.deepEqual(simd.kernel.energy, scalar.kernel.energy);

  simd.kernel.exports.reset();
  simd.kernel.input.fill(0);
  simd.kernel.exports.process(128, 128, 0, configuration.outputScale);
  assert.equal(simd.kernel.outputLeft.every((value) => value === 0), true);
  assert.equal(simd.kernel.outputRight.every((value) => value === 0), true);
});

test("lowering the mode count clears inactive worklet state", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  };
  globalThis.registerProcessor = (_name, Constructor) => {
    Processor = Constructor;
  };

  try {
    await import(new URL(
      `../src/simd-resonator-processor.js?test=${Date.now()}`,
      import.meta.url,
    ));
    const processor = new Processor();
    const [scalarBytes, simdBytes] = await Promise.all([
      readFile(scalarUrl),
      readFile(simdUrl),
    ]);
    const fullConfiguration = createSimdResonatorConfiguration({ modeCount: 128 }, 48_000);
    processor.install({
      scalarBytes,
      simdBytes,
      requestedBackend: "simd",
      configuration: { ...fullConfiguration, modeCount: fullConfiguration.settings.modeCount },
    });
    for (const kernel of Object.values(processor.kernels)) {
      if (!kernel) continue;
      kernel.real[96] = 0.75;
      kernel.imaginary[96] = -0.5;
      kernel.energy[96] = 0.25;
    }

    const reducedConfiguration = createSimdResonatorConfiguration({ modeCount: 32 }, 48_000);
    processor.configure({
      ...reducedConfiguration,
      modeCount: reducedConfiguration.settings.modeCount,
    });
    for (const kernel of Object.values(processor.kernels)) {
      if (!kernel) continue;
      assert.equal(kernel.real[96], 0);
      assert.equal(kernel.imaginary[96], 0);
      assert.equal(kernel.energy[96], 0);
    }

    const granularConfiguration = createSimdGranularConfiguration({}, 48_000);
    processor.configure(granularConfiguration);
    const { source: _source, ...granularGestureUpdate } = granularConfiguration;
    processor.configure(granularGestureUpdate);
    assert.equal(
      processor.pendingConfiguration.source,
      granularConfiguration.source,
      "queued gesture updates retain the built-in grain source",
    );

    processor.applyConfiguration(createSimdAudioConfiguration("ir", {}, 48_000));
    processor.trigger(0.8, "ir");
    assert.ok(processor.irDemoRemaining > 20_000, "IR trigger starts the built-in source phrase");
    assert.equal(processor.pendingImpulse, 0, "IR demo does not expose a bare impulse");
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
  }
});

test("FFT band resynthesis reconstructs separated speech-band energy with bounded output", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor;
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.port = { onmessage: null, postMessage() {} }; }
  };
  globalThis.registerProcessor = (_name, Constructor) => { Processor = Constructor; };

  try {
    await import(new URL(`../src/simd-resonator-processor.js?fft-test=${Date.now()}`, import.meta.url));
    const processor = new Processor();
    const scalarBytes = await readFile(scalarUrl);
    const configuration = createSimdResonatorConfiguration({
      fftSize: 256,
      fftHopRatio: 0.125,
      fftBandCount: 64,
      fftResponseMs: 4,
      fftDetail: 1,
      fftMix: 1,
      fftInputGain: 1,
      fftGateDb: -96,
      fftLowFrequency: 50,
      fftHighFrequency: 8_000,
    }, 48_000);
    processor.install({ scalarBytes, requestedBackend: "scalar", configuration });
    processor.handleMessage({ type: "mic", active: true });

    let outputPower = 0;
    let outputPeak = 0;
    let sampleCount = 0;
    for (let block = 0; block < 120; block += 1) {
      const input = new Float32Array(128);
      for (let frame = 0; frame < input.length; frame += 1) {
        const time = (block * 128 + frame) / 48_000;
        input[frame] = Math.sin(Math.PI * 2 * 220 * time) * 0.18
          + Math.sin(Math.PI * 2 * 1_760 * time) * 0.08;
      }
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([[input]], [[left, right]]), true);
      if (block > 12) {
        for (const sample of left) {
          assert.equal(Number.isFinite(sample), true);
          outputPower += sample * sample;
          outputPeak = Math.max(outputPeak, Math.abs(sample));
          sampleCount += 1;
        }
      }
    }
    assert.ok(Math.sqrt(outputPower / sampleCount) > 0.06, "phase-preserved FFT path remains audible");
    assert.ok(outputPeak < 0.5, "resynthesis remains bounded before the graph limiter");
    assert.ok(Math.max(...processor.fftInputTelemetry) > 0.5, "input band triggers report energy");
    assert.ok(Math.max(...processor.fftOutputTelemetry) > 0.5, "resynthesized bands report energy");

    processor.configure(createSimdResonatorConfiguration({ ...configuration.settings, fftSize: 2_048 }, 48_000));
    assert.equal(processor.fftSize, 2_048);
    assert.equal(processor.fftAnalysisFill, 0, "changing the FFT frame resets only the spectral history");
    processor.configure({ ...configuration, fftSize: 330, fftHopSize: 127, fftBandCount: 3 });
    assert.equal(processor.fftSize, 256, "the worklet independently snaps hostile frame sizes to radix-2");
    assert.equal(processor.fftHopSize, 128);
    assert.equal(processor.fftBandCount, 16);
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("SIMD Resonator is dedicated while the lab explains and auditions seven parallel DSP examples", async () => {
  const [html, labHtml, app, worker, ffmpegHtml] = await Promise.all([
    readFile(new URL("simd-resonator.html", root), "utf8"),
    readFile(new URL("simd-audio-lab.html", root), "utf8"),
    readFile(new URL("simd-resonator-app.js", root), "utf8"),
    readFile(new URL("src/simd-audio-worker.js", root), "utf8"),
    readFile(new URL("ffmpeg-wasm.html", root), "utf8"),
  ]);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="micButton"[\s\S]*ENABLE MICROPHONE/);
  assert.match(html, /data-simd-surface="resonator"/);
  assert.doesNotMatch(html, /id="(?:granular|swarm|freeze|ir|mesh|waveguide|spatial)EngineButton"/);
  assert.match(html, /SIMD AUDIO LAB/);
  assert.match(html, /id="presetSelect"/);
  assert.match(html, /FFT Resynth/);
  for (const id of ["fftSize", "fftWindow", "fftHopRatio", "fftBandCount", "fftResponseMs", "fftDetail", "fftMix", "fftInputGain", "fftGateDb", "fftLowFrequency", "fftHighFrequency"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /simdBackendButton|scalarBackendButton|Wasm backend/);
  assert.doesNotMatch(html.match(/<button[\s\S]*?id="micButton"[\s\S]*?<\/button>/)?.[0] || "", /data-primary-transport/);
  assert.match(html, /role="application"/);
  assert.match(labHtml, /data-simd-surface="lab"/);
  for (const engine of ["granular", "swarm", "freeze", "ir", "mesh", "waveguide", "spatial"]) {
    assert.match(labHtml, new RegExp(`id="${engine}EngineButton"`));
  }
  assert.doesNotMatch(labHtml, /id="resonatorEngineButton"/);
  assert.match(labHtml, /PLAY SOURCE THROUGH IR|id="demoDescription"/);
  assert.match(labHtml, /id="presetDescription"/);
  assert.match(labHtml, />Next</);
  assert.match(labHtml, /Phase vocoder[\s\S]*Filterbank vocoder[\s\S]*Long IR[\s\S]*Nonlinear bank[\s\S]*Ambisonic decode[\s\S]*Audio ring/);
  assert.doesNotMatch(html.match(/<button id="resetButton"[^>]*>/)?.[0] || "", /data-reset-all/);
  assert.doesNotMatch(html.toLowerCase(), /experiment 001|in the loop/);
  assert.match(ffmpegHtml, /href="simd-resonator\.html"/);
  assert.match(ffmpegHtml, /href="simd-audio-lab\.html"/);
  assert.match(app, /if \(!state\.audioReady \|\| !state\.node\)/);
  assert.match(app, /micRequestGeneration/);
  assert.match(app, /function chooseEngine/);
  assert.match(app, /function auditionCurrentEngine/);
  assert.match(app, /DEMO_PRESET_BY_ENGINE/);
  assert.match(app, /function setGate/);
  assert.match(app, /requestedBackend: forceScalar \? "scalar" : "simd"/);
  assert.match(app, /SharedArrayBuffer/);
  assert.match(app, /fftAnalysisMicros/);
  assert.match(worker, /Atomics\.store/);
  assert.doesNotMatch(app, /function trigger[\s\S]{0,500}startAudio\(/);
});
