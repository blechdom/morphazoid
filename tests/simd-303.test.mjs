import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SIMD_303_BLOCK_SIZE,
  SIMD_303_MAX_PARTIALS,
  SIMD_303_STEP_EXPRESSION_DEFAULT,
  SIMD_303_XL_DEFAULTS,
  Simd303Audio,
  createSimd303Configuration,
  createSimd303KernelViews,
  resolveSimd303Sequence,
  sanitizeSimd303Params,
  sanitizeSimd303StepExpression,
  sanitizeSimd303XlParams,
  simd303PartialArrays,
  simd303StepExpressionArray,
  simd303StepFrequencyArray,
  simd303Support,
  writeSimd303Configuration,
} from "../src/simd-303.js";
import { SIMD_303_EXPANSION_PRESETS } from "../src/simd-303-presets.js";
import {
  createSimd303MorphSnapshot,
  interpolateSimd303MorphSnapshot,
  resolveSimd303MorphTarget,
  simd303MorphDurationSeconds,
  simd303MorphTimeFromControl,
} from "../src/simd-303-morph.js";
import {
  createSimd303UserPreset,
  loadSimd303UserPresets,
  persistSimd303UserPresets,
  sanitizeSimd303UserPresetName,
  SIMD_303_USER_PRESET_STORAGE_KEY,
} from "../src/simd-303-user-presets.js";
import {
  WEBGPU_303_DEFAULTS,
  WEBGPU_303_SEQUENCE_LENGTH,
  WEBGPU_303_SOURCE_SEQUENCE,
  sanitizeWebGpu303Params,
} from "../src/webgpu-303.js";

const root = new URL("../", import.meta.url);
const scalarUrl = new URL("assets/wasm/simd-303-scalar.wasm", root);
const simdUrl = new URL("assets/wasm/simd-303-simd.wasm", root);

async function loadKernel(url) {
  const bytes = await readFile(url);
  assert.equal(WebAssembly.validate(bytes), true);
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  return {
    bytes,
    kernel: createSimd303KernelViews(new WebAssembly.Instance(module)),
  };
}

test("SIMD 303 resolves source noise, step pitches, and static partial weights", () => {
  const params = sanitizeWebGpu303Params({
    ...WEBGPU_303_DEFAULTS,
    fundamental: 220,
    frequency: 24,
    ratio: 3.5,
    sampOffset: 2,
  });
  const resolved = resolveSimd303Sequence(WEBGPU_303_SOURCE_SEQUENCE, params);
  const frequencies = simd303StepFrequencyArray(params, WEBGPU_303_SOURCE_SEQUENCE);
  const partials = simd303PartialArrays(params);

  assert.equal(resolved.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.equal(frequencies.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.equal(resolved.every((value) => value >= 0 && value < 1), true);
  assert.equal(frequencies.every((value) => Number.isFinite(value) && value > 0), true);
  assert.equal(partials.base.length, SIMD_303_MAX_PARTIALS);
  assert.equal(partials.fold.length, SIMD_303_MAX_PARTIALS);
  assert.ok(partials.base[0] > partials.base.at(-1));
  assert.equal(partials.base.every(Number.isFinite), true);
  assert.equal(partials.fold.every(Number.isFinite), true);
});

test("SIMD 303 XL settings bound 512 partials, effects, and four expression lanes", () => {
  assert.equal(SIMD_303_MAX_PARTIALS, 512);
  assert.equal(sanitizeSimd303Params({ partials: 900 }).partials, 512);
  assert.equal(sanitizeSimd303Params({ partials: -8 }).partials, 1);
  assert.deepEqual(sanitizeSimd303XlParams({
    spectrumMorph: 7,
    chorusDepth: -2,
    delayFeedback: 2,
  }), {
    ...SIMD_303_XL_DEFAULTS,
    spectrumMorph: 3,
    chorusDepth: 0,
    delayFeedback: 0.85,
  });
  const expression = sanitizeSimd303StepExpression([
    [2, 0, -1, 0.35],
  ]);
  assert.deepEqual(expression[0], [1, 0.05, 0, 0.35]);
  assert.deepEqual(expression[1], SIMD_303_STEP_EXPRESSION_DEFAULT);
  assert.equal(simd303StepExpressionArray(expression).length, WEBGPU_303_SEQUENCE_LENGTH * 4);

  const saw = simd303PartialArrays({ ...WEBGPU_303_DEFAULTS, partials: 512 }, { spectrumMorph: 0 });
  const square = simd303PartialArrays({ ...WEBGPU_303_DEFAULTS, partials: 512 }, { spectrumMorph: 1 });
  const pulse = simd303PartialArrays({ ...WEBGPU_303_DEFAULTS, partials: 512 }, { spectrumMorph: 2 });
  assert.notDeepEqual(saw.base.slice(0, 16), square.base.slice(0, 16));
  assert.notDeepEqual(square.base.slice(0, 16), pulse.base.slice(0, 16));
});

test("SIMD 303 expansion bank spans 25 deterministic voice, motion, space, and extreme patches", () => {
  assert.equal(SIMD_303_EXPANSION_PRESETS.length, 25);
  assert.equal(new Set(SIMD_303_EXPANSION_PRESETS.map(({ id }) => id)).size, 25);
  assert.equal(new Set(SIMD_303_EXPANSION_PRESETS.map(({ label }) => label)).size, 25);
  assert.deepEqual(
    [...new Set(SIMD_303_EXPANSION_PRESETS.map(({ category }) => category))],
    ["Foundation", "Spectrum", "Motion", "Space", "Extremes"],
  );

  for (const preset of SIMD_303_EXPANSION_PRESETS) {
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.params), true);
    assert.equal(Object.isFrozen(preset.sequence), true);
    assert.equal(Object.isFrozen(preset.xlParams), true);
    assert.equal(Object.isFrozen(preset.stepExpression), true);
    assert.ok(preset.description.length > 60, `${preset.label} needs a useful description`);
    assert.equal(preset.sequence.length, WEBGPU_303_SEQUENCE_LENGTH);
    assert.equal(preset.stepExpression.length, WEBGPU_303_SEQUENCE_LENGTH);
  }

  const params = SIMD_303_EXPANSION_PRESETS.map((preset) => preset.params);
  const xlParams = SIMD_303_EXPANSION_PRESETS.map((preset) => preset.xlParams);
  const expression = SIMD_303_EXPANSION_PRESETS.flatMap((preset) => preset.stepExpression);
  assert.equal(Math.min(...params.map(({ partials }) => partials)), 128);
  assert.equal(Math.max(...params.map(({ partials }) => partials)), 512);
  assert.ok(Math.max(...params.map(({ res }) => res)) >= 14);
  assert.ok(Math.max(...params.map(({ ratio }) => ratio)) >= 31);
  assert.ok(Math.min(...params.map(({ timeMod }) => timeMod)) <= 8);
  assert.ok(Math.max(...params.map(({ timeMod }) => timeMod)) >= 32);
  assert.deepEqual(
    [...new Set(xlParams.map(({ spectrumMorph }) => Math.round(spectrumMorph)))].sort(),
    [0, 1, 2, 3],
  );
  assert.ok(Math.max(...xlParams.map(({ chorusMix }) => chorusMix)) >= 0.6);
  assert.ok(Math.max(...xlParams.map(({ delayMix }) => delayMix)) >= 0.65);
  assert.ok(expression.some(([accent]) => accent >= 0.8));
  assert.ok(expression.some(([, gate]) => gate <= 0.2));
  assert.ok(expression.some(([, , slide]) => slide > 0));
  assert.ok(expression.some(([, , , chance]) => chance < 0.5));
});

test("SIMD 303 browser presets round-trip a complete sanitized patch", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const snapshot = createSimd303MorphSnapshot({
    params: { ...WEBGPU_303_DEFAULTS, partials: 512, timeScale: 11.2 },
    sequence: [0.17, 0.81, 0.42],
    xlParams: { ...SIMD_303_XL_DEFAULTS, spectrumMorph: 2.4, delayMix: 0.63 },
    stepExpression: [[0.91, 0.36, 0.82, 0.74]],
  });
  const preset = createSimd303UserPreset(snapshot, "  Browser\nSlime  ", {
    now: 1_700_000_000_000,
    random: 0.5,
  });

  assert.equal(preset.label, "Browser Slime");
  assert.match(preset.id, /^user:/);
  assert.equal(preset.category, "My presets");
  assert.equal(preset.userPreset, true);
  assert.equal(preset.params.partials, 512);
  assert.equal(preset.sequence.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.equal(preset.xlParams.delayMix, 0.63);
  assert.deepEqual(preset.stepExpression[0], [0.91, 0.36, 0.82, 0.74]);
  assert.equal(Object.isFrozen(preset), true);
  assert.equal(persistSimd303UserPresets(storage, [preset]), true);

  const loaded = loadSimd303UserPresets(storage);
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], preset);
  assert.equal(JSON.parse(values.get(SIMD_303_USER_PRESET_STORAGE_KEY)).version, 1);
  assert.equal(sanitizeSimd303UserPresetName("  wet\t\n patch "), "wet patch");
});

test("SIMD 303 browser presets ignore corrupt data and report blocked storage", () => {
  assert.deepEqual(loadSimd303UserPresets({ getItem: () => "not json" }), []);
  assert.deepEqual(loadSimd303UserPresets({
    getItem: () => JSON.stringify({ version: 1, presets: [{ id: "factory-id" }] }),
  }), []);
  assert.equal(persistSimd303UserPresets({ setItem: () => { throw new Error("quota"); } }, []), false);
  assert.throws(() => createSimd303UserPreset({}, "   "), /preset name/i);
});

test("SIMD 303 A/B morph scopes protect transport and level while separating tone, effects, and pattern", () => {
  const source = createSimd303MorphSnapshot({
    label: "Source",
    params: {
      ...WEBGPU_303_DEFAULTS,
      timeScale: 4,
      timeMod: 8,
      gain: 0.12,
      fundamental: 110,
      frequency: 24,
      stereo: 0.2,
      nse: 111,
    },
    sequence: [0.1, 0.2],
    xlParams: { ...SIMD_303_XL_DEFAULTS, spectrumMorph: 0, chorusMix: 0.1, delayMix: 0.05 },
    stepExpression: [[0.1, 0.9, 0, 1]],
  });
  const destination = createSimd303MorphSnapshot({
    label: "Destination",
    params: {
      ...WEBGPU_303_DEFAULTS,
      timeScale: 20,
      timeMod: 32,
      gain: 0.5,
      fundamental: 440,
      frequency: 72,
      stereo: 6,
      nse: 39000,
    },
    sequence: [0.9, 0.7],
    xlParams: { ...SIMD_303_XL_DEFAULTS, spectrumMorph: 3, chorusMix: 0.8, delayMix: 0.7 },
    stepExpression: [[0.9, 0.3, 0.4, 0.5]],
  });

  const tone = resolveSimd303MorphTarget(source, destination, "tone");
  assert.equal(tone.params.timeScale, source.params.timeScale);
  assert.equal(tone.params.timeMod, source.params.timeMod);
  assert.equal(tone.params.gain, source.params.gain);
  assert.equal(tone.params.fundamental, destination.params.fundamental);
  assert.equal(tone.params.stereo, source.params.stereo);
  assert.equal(tone.params.nse, source.params.nse);
  assert.equal(tone.xlParams.spectrumMorph, destination.xlParams.spectrumMorph);
  assert.equal(tone.xlParams.chorusMix, source.xlParams.chorusMix);
  assert.deepEqual(tone.sequence, source.sequence);
  assert.deepEqual(tone.stepExpression, source.stepExpression);

  const effects = resolveSimd303MorphTarget(source, destination, "effects");
  assert.equal(effects.params.fundamental, source.params.fundamental);
  assert.equal(effects.params.stereo, destination.params.stereo);
  assert.equal(effects.xlParams.spectrumMorph, source.xlParams.spectrumMorph);
  assert.equal(effects.xlParams.chorusMix, destination.xlParams.chorusMix);
  assert.deepEqual(effects.sequence, source.sequence);

  const all = resolveSimd303MorphTarget(source, destination, "all");
  assert.equal(all.params.timeScale, source.params.timeScale);
  assert.equal(all.params.timeMod, source.params.timeMod);
  assert.equal(all.params.gain, source.params.gain);
  assert.equal(all.params.nse, destination.params.nse);
  assert.deepEqual(all.sequence, destination.sequence);
  assert.deepEqual(all.stepExpression, destination.stepExpression);

  const halfway = interpolateSimd303MorphSnapshot(source, all, 0.5);
  assert.ok(Math.abs(halfway.params.fundamental - 220) < 0.0001);
  assert.equal(halfway.params.timeScale, source.params.timeScale);
  assert.equal(halfway.stepExpression[0][0], 0.5);
  assert.equal(interpolateSimd303MorphSnapshot(source, all, 1).sequence[0], 0.9);
});

test("SIMD 303 morph time supports logarithmic seconds, step, and bar durations", () => {
  for (const unit of ["seconds", "steps", "bars"]) {
    const short = simd303MorphTimeFromControl(0, unit);
    const middle = simd303MorphTimeFromControl(0.5, unit);
    const long = simd303MorphTimeFromControl(1, unit);
    assert.ok(short < middle);
    assert.ok(middle < long);
  }
  assert.equal(simd303MorphDurationSeconds(8, "steps", { timeScale: 4 }), 2);
  assert.equal(simd303MorphDurationSeconds(2, "bars", { timeScale: 4, timeMod: 8 }), 4);
  assert.equal(simd303MorphDurationSeconds(3.5, "seconds"), 3.5);
});

test("SIMD 303 audio posts complete render-clock morph configurations and can commit an interruption", () => {
  const messages = [];
  const audio = new Simd303Audio({});
  audio.node = { port: { postMessage: (message) => messages.push(message) } };
  const source = createSimd303MorphSnapshot({ params: { ...WEBGPU_303_DEFAULTS, fundamental: 110 } });
  const destination = createSimd303MorphSnapshot({ params: { ...WEBGPU_303_DEFAULTS, fundamental: 440 } });

  const morphId = audio.morphTo(source, destination, 2.5);
  assert.equal(messages[0].type, "morph");
  assert.equal(messages[0].id, morphId);
  assert.equal(messages[0].durationSeconds, 2.5);
  assert.equal(messages[0].from.stepFrequency.length, WEBGPU_303_SEQUENCE_LENGTH);
  assert.equal(messages[0].to.expressionArray.length, WEBGPU_303_SEQUENCE_LENGTH * 4);
  assert.equal(audio.params.fundamental, 440);

  audio.cancelMorph(source);
  assert.equal(messages[1].type, "configure");
  assert.equal(audio.params.fundamental, 110);
});

test("every SIMD 303 expansion preset renders an audible bounded signal", async () => {
  const { kernel } = await loadKernel(scalarUrl);
  const sampleRate = 48_000;

  for (const preset of SIMD_303_EXPANSION_PRESETS) {
    kernel.exports.reset();
    writeSimd303Configuration(kernel, createSimd303Configuration(
      preset.params,
      preset.sequence,
      [],
      preset.xlParams,
      preset.stepExpression,
    ));
    let sumOfSquares = 0;
    let peak = 0;
    let sampleCount = 0;
    for (let block = 0; block < 96; block += 1) {
      kernel.exports.process(
        SIMD_303_BLOCK_SIZE,
        sampleRate,
        block * SIMD_303_BLOCK_SIZE / sampleRate,
      );
      for (let frame = 0; frame < SIMD_303_BLOCK_SIZE; frame += 1) {
        for (const sample of [kernel.outputLeft[frame], kernel.outputRight[frame]]) {
          assert.equal(Number.isFinite(sample), true, `${preset.label} must stay finite`);
          peak = Math.max(peak, Math.abs(sample));
          sumOfSquares += sample * sample;
          sampleCount += 1;
        }
      }
    }
    const rms = Math.sqrt(sumOfSquares / sampleCount);
    assert.ok(rms > 0.004, `${preset.label} must remain clearly audible`);
    assert.ok(peak <= 0.88, `${preset.label} must respect the output ceiling`);
  }
});

test("scalar and f32x4 303 kernels expose the same bounded ABI", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  assert.equal(scalar.kernel.exports.lane_width(), 1);
  assert.equal(simd.kernel.exports.lane_width(), 4);
  assert.equal(scalar.kernel.exports.block_size(), SIMD_303_BLOCK_SIZE);
  assert.equal(simd.kernel.exports.block_size(), SIMD_303_BLOCK_SIZE);
  assert.equal(scalar.kernel.exports.max_partials(), SIMD_303_MAX_PARTIALS);
  assert.equal(simd.kernel.exports.max_partials(), SIMD_303_MAX_PARTIALS);
  assert.equal(scalar.kernel.exports.sequence_length(), WEBGPU_303_SEQUENCE_LENGTH);
  assert.equal(simd.kernel.exports.sequence_length(), WEBGPU_303_SEQUENCE_LENGTH);
  assert.notDeepEqual(scalar.bytes, simd.bytes);
});

test("scalar and f32x4 kernels render the same finite stereo acid signal", async () => {
  const [scalar, simd] = await Promise.all([loadKernel(scalarUrl), loadKernel(simdUrl)]);
  const configuration = createSimd303Configuration({
    ...WEBGPU_303_DEFAULTS,
    partials: 512,
    timeScale: 7.4,
    timeMod: 24,
    stereo: 2.4,
    res: 10.8,
    flt: -12,
  }, [0.08, 0.46, 0.2, 0.72, 0.3, 0.62, 0.38, 0.9], [], {
    spectrumMorph: 1.72,
    chorusMix: 0.36,
    chorusDepth: 8,
    chorusRate: 0.73,
    delayMix: 0.32,
    delaySteps: 0.25,
    delayFeedback: 0.42,
  }, Array.from({ length: 24 }, (_, index) => [
    index % 4 === 0 ? 0.8 : 0.1,
    index % 3 === 0 ? 0.42 : 0.9,
    index % 5 === 0 ? 0.7 : 0,
    index % 7 === 0 ? 0.7 : 1,
  ]));
  writeSimd303Configuration(scalar.kernel, configuration);
  writeSimd303Configuration(simd.kernel, configuration);
  let peak = 0;
  let maximumDifference = 0;
  let nonZero = 0;
  const sampleRate = 48_000;

  for (let block = 0; block < 96; block += 1) {
    const startTime = block * SIMD_303_BLOCK_SIZE / sampleRate;
    scalar.kernel.exports.process(SIMD_303_BLOCK_SIZE, sampleRate, startTime);
    simd.kernel.exports.process(SIMD_303_BLOCK_SIZE, sampleRate, startTime);
    for (let frame = 0; frame < SIMD_303_BLOCK_SIZE; frame += 1) {
      for (const [scalarSample, simdSample] of [
        [scalar.kernel.outputLeft[frame], simd.kernel.outputLeft[frame]],
        [scalar.kernel.outputRight[frame], simd.kernel.outputRight[frame]],
      ]) {
        assert.equal(Number.isFinite(scalarSample), true);
        assert.equal(Number.isFinite(simdSample), true);
        peak = Math.max(peak, Math.abs(scalarSample), Math.abs(simdSample));
        maximumDifference = Math.max(maximumDifference, Math.abs(scalarSample - simdSample));
        if (scalarSample !== 0 || simdSample !== 0) nonZero += 1;
      }
    }
  }

  assert.ok(nonZero > 1_000, "acid voice produces a sustained signal");
  assert.ok(peak > 0.001, "acid voice is audible");
  assert.ok(peak <= 0.88, "shader output ceiling is retained");
  assert.ok(maximumDifference < 0.0001, "scalar and four-sample SIMD paths match through the XL effects");
});

test("step chance gates new notes while reset clears the persistent delay", async () => {
  const { kernel } = await loadKernel(scalarUrl);
  const params = { ...WEBGPU_303_DEFAULTS, partials: 512, timeScale: 9, timeMod: 16 };
  const xl = {
    ...SIMD_303_XL_DEFAULTS,
    chorusMix: 0,
    delayMix: 0.75,
    delaySteps: 0.25,
    delayFeedback: 0.5,
  };
  const sounding = createSimd303Configuration(params, Array(16).fill(0.5), [], xl);
  writeSimd303Configuration(kernel, sounding);
  for (let block = 0; block < 20; block += 1) {
    kernel.exports.process(SIMD_303_BLOCK_SIZE, 48_000, block * SIMD_303_BLOCK_SIZE / 48_000);
  }

  const muted = createSimd303Configuration(
    params,
    Array(16).fill(0.5),
    [],
    xl,
    Array.from({ length: 16 }, () => [0, 1, 0, 0]),
  );
  writeSimd303Configuration(kernel, muted);
  kernel.exports.process(SIMD_303_BLOCK_SIZE, 48_000, 20 * SIMD_303_BLOCK_SIZE / 48_000);
  const delayPeak = Math.max(...kernel.outputLeft.map(Math.abs), ...kernel.outputRight.map(Math.abs));
  assert.ok(delayPeak > 0.0001, "muted steps leave the existing delay tail audible");

  kernel.exports.reset();
  kernel.exports.process(SIMD_303_BLOCK_SIZE, 48_000, 21 * SIMD_303_BLOCK_SIZE / 48_000);
  assert.equal(kernel.outputLeft.every((sample) => sample === 0), true);
  assert.equal(kernel.outputRight.every((sample) => sample === 0), true);
});

test("SIMD 303 support requires Web Audio, AudioWorklet, and WebAssembly", () => {
  assert.deepEqual(simd303Support({}), {
    audio: false,
    worklet: false,
    wasm: true,
    supported: false,
  });
  class AudioContext {}
  Object.defineProperty(AudioContext.prototype, "audioWorklet", { value: {} });
  assert.deepEqual(simd303Support({
    AudioContext,
    AudioWorkletNode: class {},
    WebAssembly,
  }), {
    audio: true,
    worklet: true,
    wasm: true,
    supported: true,
  });
});

test("SIMD 303 ships as a separate page with the shared 303 control surface", async () => {
  const [html, css, app, sharedApp, runtime, processor, buildScript, readme] = await Promise.all([
    readFile(new URL("simd-303.html", root), "utf8"),
    readFile(new URL("simd-303.css", root), "utf8"),
    readFile(new URL("simd-303-app.js", root), "utf8"),
    readFile(new URL("webgpu-303-app.js", root), "utf8"),
    readFile(new URL("src/simd-303.js", root), "utf8"),
    readFile(new URL("src/simd-303-processor.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);

  assert.match(html, /data-audio-backend="simd"/);
  assert.match(html, /id="simd303"/);
  assert.match(html, /id="knobControls"/);
  assert.match(html, /id="synthPlayButton"/);
  assert.match(html, /id="backendMetric"/);
  assert.match(html, /id="laneMetric"/);
  assert.match(html, /id="stepExpressionState"/);
  assert.match(html, /data-step-edit-mode="accent"/);
  assert.match(html, /data-step-edit-mode="slide"/);
  assert.match(html, /id="stageSynthPlayButton"/);
  assert.match(html, /id="stagePresetSelect"/);
  assert.match(html, /id="recallStagePreset"/);
  assert.match(html, /id="userPresetName"/);
  assert.match(html, /id="saveUserPreset"/);
  assert.match(html, /id="deleteUserPreset"/);
  assert.match(html, /Morph A\/B controls are parked for now/);
  assert.match(html, /id="captureMorphA"/);
  assert.match(html, /id="captureMorphB"/);
  assert.match(html, /id="morphTime"/);
  assert.match(html, /id="morphUnit"/);
  assert.match(html, /id="morphScope"/);
  assert.match(html, /id="morphTarget"/);
  assert.match(html, /id="startMorph"/);
  assert.match(html, /id="transportKnobControls"/);
  assert.match(html, /data-main-action="randomize-expression"/);
  assert.match(html, /data-main-action="source-noise"/);
  assert.match(html, /id="simdXlControls"/);
  assert.match(html, /id="kernelMetric"/);
  assert.match(html, /sound - acid jam by srtuss/);
  assert.match(css, /\.simd-303-page/);
  assert.match(css, /\.simd-morph-strip/);
  assert.match(css, /\.simd-user-preset-tools/);
  assert.match(app, /webgpu-303-app\.js/);
  assert.match(sharedApp, /simdXlControlSpecs/);
  assert.match(sharedApp, /transport: Object\.freeze\(\["timeScale", "timeMod", "gain"\]\)/);
  assert.match(sharedApp, /createSimdKnobGroup\("Effects", simdKnobGroups\.effects\)/);
  assert.match(sharedApp, /SIMD_303_EXPANSION_PRESETS/);
  assert.match(sharedApp, /preset\.xlParams \?\? SIMD_303_XL_DEFAULTS/);
  assert.match(sharedApp, /preset\.stepExpression/);
  assert.match(sharedApp, /presetsByCategory/);
  assert.match(sharedApp, /loadSimd303UserPresets/);
  assert.match(sharedApp, /function saveUserPreset/);
  assert.match(sharedApp, /function deleteUserPreset/);
  assert.match(sharedApp, /resolveSimd303MorphTarget/);
  assert.match(sharedApp, /function captureMorphEndpoint/);
  assert.match(sharedApp, /function settleActiveMorph/);
  assert.match(sharedApp, /acidizeStepExpression/);
  assert.match(sharedApp, /function randomizeStepExpression/);
  assert.match(sharedApp, /Expression and effects reset/);
  assert.match(sharedApp, /applyStepExpression\(\[\]\)/);
  assert.match(sharedApp, /engine\?\.timeDomainData\?\.\(\)/);
  assert.match(sharedApp, /drawCapturedTrace/);
  assert.match(runtime, /class Simd303Audio/);
  assert.match(runtime, /simd-303-simd\.wasm/);
  assert.match(runtime, /createAnalyser\(\)/);
  assert.match(runtime, /getFloatTimeDomainData\(this\.scopeData\)/);
  assert.match(processor, /registerProcessor\("morphazoid-simd-303"/);
  assert.match(processor, /writeInterpolatedConfiguration/);
  assert.match(processor, /message\.type === "morph"/);
  assert.match(processor, /128-frame|BLOCK_SIZE = 128/);
  assert.match(readme, /\*\*SIMD 303\*\*/);
  for (const file of [
    "simd-303.html",
    "simd-303.css",
    "simd-303-app.js",
    "src/simd-303.js",
    "src/simd-303-morph.js",
    "src/simd-303-presets.js",
    "src/simd-303-user-presets.js",
    "src/simd-303-processor.js",
    "assets/wasm/simd-303-scalar.wasm",
    "assets/wasm/simd-303-simd.wasm",
  ]) {
    assert.match(buildScript, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
