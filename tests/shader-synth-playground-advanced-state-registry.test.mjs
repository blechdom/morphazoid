import assert from "node:assert/strict";
import test from "node:test";

import {
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_CASES,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KINDS,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KIND_SET,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES,
  isShaderSynthPlaygroundAdvancedStateKind,
} from "../src/shader-synth-playground-advanced-state.js";
import { WEBGPU_DSP_PRIMITIVES } from "../src/webgpu-dsp-primitives.js";

const EXPECTED_IDS = Object.freeze([
  "sequence-lane",
  "uploaded-wavetable",
  "gpu-sampler-granulator",
  "spatializer",
  "recursive-filter",
  "feedback-network",
  "wavefield-solver",
  "spectral-transport",
  "dynamics",
  "convolution-space",
  "massive-bank",
  "audio-analysis-field",
  "ddsp-resynth",
  "spectral-vocoder",
  "neural-processor",
]);

const EXPECTED_KINDS = Object.freeze(Array.from({ length: 15 }, (_, index) => 111 + index));

const EXPECTED_PRIMITIVE_IDS = Object.freeze([
  "lane-value",
  "wavetable-lookup",
  "sample-buffer-playback",
  "granular-sample-cloud",
  "large-grain-engine",
  "ambisonic-encode",
  "hrtf-binaural-convolution",
  "ambisonic-decode",
  "dc-blocker",
  "recursive-biquad",
  "state-variable-filter",
  "parallel-prefix-recursion",
  "feedback-delay",
  "comb-allpass",
  "feedback-delay-network",
  "karplus-strong",
  "nonlinear-string-fdtd",
  "membrane-fdtd",
  "room-acoustics-fdtd",
  "digital-waveguide-mesh",
  "fft-stft",
  "spectral-remap",
  "phase-vocoder",
  "overlap-add",
  "sliding-phase-vocoder",
  "spectral-gate",
  "phase-prefix-integration",
  "dynamics-reduction",
  "lookahead-limiter",
  "partitioned-convolution",
  "hybrid-convolution",
  "voice-mix-reduction",
  "million-sinusoid-bank",
  "massive-modal-synthesis",
  "audio-analysis-texture",
  "filtered-noise-spectrum",
  "ddsp-decoder",
  "vocoder-cross-synthesis",
  "neural-dilated-convolution",
  "neural-recurrent-model",
]);

test("advanced state registry reserves fixed kinds 111 through 125", () => {
  assert.deepEqual(SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES.map(({ id }) => id), EXPECTED_IDS);
  assert.deepEqual(SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES.map(({ kind }) => kind), EXPECTED_KINDS);
  assert.deepEqual(
    [...Object.values(SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KINDS)].sort((left, right) => left - right),
    EXPECTED_KINDS,
  );
  assert.deepEqual([...SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_KIND_SET], EXPECTED_KINDS);
  for (const kind of EXPECTED_KINDS) assert.equal(isShaderSynthPlaygroundAdvancedStateKind(kind), true);
  assert.equal(isShaderSynthPlaygroundAdvancedStateKind(110), false);
  assert.equal(isShaderSynthPlaygroundAdvancedStateKind(126), false);
});

test("advanced modules keep graph packing and conditional state ownership explicit", () => {
  const signalTypes = new Set(["audio", "stereo", "control"]);
  for (const module of SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES) {
    assert.equal(module.stateful, true, `${module.id} must enter the ordered state path`);
    assert.ok(module.inputs.length <= 3, `${module.id} exceeds graph input packing`);
    assert.ok(module.outputs.length > 0 && module.outputs.length <= 2, `${module.id} needs one or two outputs`);
    assert.ok(module.params.length > 0 && module.params.length <= 8, `${module.id} exceeds p0/p1 packing`);
    assert.equal(new Set(module.inputs.map(({ id }) => id)).size, module.inputs.length, `${module.id} repeats an input id`);
    assert.equal(new Set(module.outputs.map(({ id }) => id)).size, module.outputs.length, `${module.id} repeats an output id`);
    assert.equal(new Set(module.params.map(({ id }) => id)).size, module.params.length, `${module.id} repeats a parameter id`);

    for (const input of module.inputs) {
      assert.ok(input.types.length > 0, `${module.id}.${input.id} needs accepted types`);
      assert.equal(input.types.every((type) => signalTypes.has(type)), true, `${module.id}.${input.id} has an unknown type`);
    }
    for (const output of module.outputs) {
      assert.ok(signalTypes.has(output.type), `${module.id}.${output.id} has an unknown type`);
    }
    for (const parameter of module.params) {
      assert.ok(parameter.min < parameter.max, `${module.id}.${parameter.id} needs a usable range`);
      assert.ok(parameter.default >= parameter.min && parameter.default <= parameter.max, `${module.id}.${parameter.id} default is outside its range`);
      assert.ok(parameter.low && parameter.high && parameter.behavior, `${module.id}.${parameter.id} needs endpoint language`);
      if (parameter.options) {
        assert.equal(parameter.step, 1, `${module.id}.${parameter.id} menu must use integer steps`);
        assert.equal(parameter.options.length, parameter.max - parameter.min + 1, `${module.id}.${parameter.id} menu range drifted`);
      }
    }

    assert.equal(module.state.conditional, true, `${module.id} must allocate conditionally`);
    assert.equal(module.state.persistent, true, `${module.id} must retain state only while active`);
    assert.ok(module.state.family && module.state.resources, `${module.id} needs a resource family`);
    assert.match(module.state.lifecycle, /allocate on first active node; release after last active node/);
    for (const resetParam of module.state.resetParams) {
      assert.ok(module.params.some(({ id }) => id === resetParam), `${module.id} names unknown reset parameter ${resetParam}`);
    }
  }
});

test("combined families explicitly cover forty catalog primitives without duplicate ownership", () => {
  const mapped = SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES.flatMap(({ primitiveIds }) => primitiveIds);
  assert.equal(mapped.length, EXPECTED_PRIMITIVE_IDS.length);
  assert.equal(new Set(mapped).size, mapped.length, "a primitive should have one owning advanced family");
  assert.deepEqual([...mapped].sort(), [...EXPECTED_PRIMITIVE_IDS].sort());

  const catalogIds = new Set(WEBGPU_DSP_PRIMITIVES.map(({ id }) => id));
  for (const module of SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES) {
    assert.ok(module.primitiveIds.length > 0, `${module.id} must declare catalog coverage`);
    for (const primitiveId of module.primitiveIds) {
      assert.ok(catalogIds.has(primitiveId), `${module.id} references missing catalog primitive ${primitiveId}`);
      assert.ok(module.tags.includes(primitiveId), `${module.id} tags must expose ${primitiveId} to search`);
    }
  }
});

test("advanced graph cases forward one ordered-state result for every reserved kind", () => {
  const cases = [...SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_CASES.matchAll(/case (\d+)u:\s*\{\s*result = stateValue;\s*\}/g)]
    .map((match) => Number(match[1]));
  assert.deepEqual(cases, EXPECTED_KINDS);
});
