import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SHADER_PLAYGROUND_COMBOS,
  SHADER_PLAYGROUND_LIMITS,
  SHADER_PLAYGROUND_MODULES,
  SHADER_PLAYGROUND_SHADER,
  ShaderSynthPlaygroundAudio,
  encodeShaderPlaygroundPatch,
  sanitizeShaderPlaygroundPatch,
  validateShaderPlaygroundPatch,
} from "../src/shader-synth-playground.js";
import {
  SHADER_SYNTH_PLAYGROUND_ADVANCED_RESET_PARAM_INDICES,
  SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_LIMITS,
  shaderSynthPlaygroundAdvancedAssetLayout,
  shaderSynthPlaygroundAdvancedPersistentByteSize,
} from "../src/shader-synth-playground-advanced-state-engine.js";
import * as stateful from "../src/shader-synth-playground-stateful.js";

const ROOT = new URL("../", import.meta.url);
const EXPECTED_STATEFUL_IDS = Object.freeze([
  "cellular-automaton-score",
  "reaction-diffusion-score-lattice",
  "geometric-feedback-lattice",
  "spectral-sdf",
  "flow-field-advection",
  "raymarch-resonator",
]);
const EXPECTED_STATEFUL_KINDS = Object.freeze([105, 106, 107, 108, 109, 110]);
const EXPECTED_ADVANCED_KINDS = Object.freeze(Array.from({ length: 15 }, (_, index) => 111 + index));

const STATEFUL_MODULES = stateful.SHADER_SYNTH_PLAYGROUND_STATEFUL_MODULES;
const STATEFUL_KINDS = stateful.SHADER_SYNTH_PLAYGROUND_STATEFUL_KINDS;
const STATEFUL_SHADER = stateful.SHADER_SYNTH_PLAYGROUND_STATEFUL_SHADER;
const VISUAL_STATEFUL_MODULES = stateful.SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_MODULES;
const VISUAL_STATEFUL_KINDS = stateful.SHADER_SYNTH_PLAYGROUND_VISUAL_STATE_KINDS;
const ADVANCED_STATEFUL_MODULES = stateful.SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_MODULES;
const StatefulEngine = stateful.ShaderSynthPlaygroundStateEngine;
const STATE_RENDERER_BY_KIND = new Map([
  [105, "renderCellularAutomaton"],
  [106, "renderReactionDiffusion"],
  [107, "renderFeedbackLattice"],
  [108, "renderSpectralSdf"],
  [109, "renderFlowAdvection"],
  [110, "renderRaymarchResonator"],
  [111, "renderSequenceLane"],
  [112, "renderUploadedWavetable"],
  [113, "renderGpuSamplerGranulator"],
  [114, "renderSpatializer"],
  [115, "renderRecursiveFilter"],
  [116, "renderFeedbackNetwork"],
  [117, "renderWavefieldSolver"],
  [118, "renderSpectralTransport"],
  [119, "renderAdvancedDynamics"],
  [120, "renderConvolutionSpace"],
  [121, "renderMassiveBank"],
  [122, "renderAudioAnalysisField"],
  [123, "renderDdspResynth"],
  [124, "renderSpectralVocoder"],
  [125, "renderNeuralProcessor"],
]);

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function statefulCase(kind) {
  const marker = `case ${kind}u:`;
  const start = STATEFUL_SHADER.indexOf(marker);
  assert.ok(start >= 0, `missing stateful WGSL case ${kind}`);
  const remainder = STATEFUL_SHADER.slice(start + marker.length);
  const next = remainder.search(/\n\s*(?:case \d+u:|default:)/);
  return next >= 0 ? remainder.slice(0, next) : remainder;
}

function wgslFunction(name) {
  const start = STATEFUL_SHADER.indexOf(`fn ${name}(`);
  assert.ok(start >= 0, `missing stateful WGSL function ${name}`);
  const next = STATEFUL_SHADER.indexOf("\nfn ", start + 4);
  return next >= 0 ? STATEFUL_SHADER.slice(start, next) : STATEFUL_SHADER.slice(start);
}

function wgslBlock(source, marker) {
  const markerStart = source.indexOf(marker);
  assert.ok(markerStart >= 0, `missing WGSL block marker: ${marker}`);
  const blockStart = source.indexOf("{", markerStart + marker.length);
  assert.ok(blockStart >= 0, `missing WGSL block body: ${marker}`);
  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(blockStart + 1, index);
  }
  assert.fail(`unterminated WGSL block: ${marker}`);
}

function encodedStateNodes(kinds = []) {
  const data = new Float32Array(kinds.length * 20);
  const order = kinds.map((_, index) => `state-${index}`);
  const nodes = kinds.map((kind, index) => {
    data[index * 20] = kind;
    return {
      id: order[index],
      type: STATEFUL_MODULES.find((module) => module.kind === kind)?.id,
    };
  });
  return {
    data,
    order,
    patch: { nodes, connections: [] },
    paramsByNode: new Map(order.map((id) => [id, [1, 2, 3, 4, 5, 6, 7, 8]])),
  };
}

function geometricFeedbackPatch(enabled = true) {
  const combo = SHADER_PLAYGROUND_COMBOS.find((candidate) => (
    candidate.character === "primitive-audition"
    && candidate.patch.nodes.some(({ id, type }) => id === "focus" && type === "geometric-feedback-lattice")
  ));
  assert.ok(combo, "the geometric feedback Hear graph must exist");
  const patch = JSON.parse(JSON.stringify(combo.patch));
  patch.nodes.find(({ id }) => id === "focus").enabled = enabled;
  return sanitizeShaderPlaygroundPatch(patch);
}

function residentAssetPatch(type) {
  return sanitizeShaderPlaygroundPatch({
    name: `${type} asset ownership`,
    nodes: [
      { id: "focus", type },
      { id: "out", type: "output" },
    ],
    connections: [{
      id: "focus-out",
      from: { node: "focus", port: "out" },
      to: { node: "out", port: "signal" },
    }],
  });
}

test("stateful barrel combines six visual and fifteen advanced modules without kind overlap", () => {
  assert.ok(Array.isArray(STATEFUL_MODULES), "the dedicated state module must export its module registry");
  assert.deepEqual(VISUAL_STATEFUL_MODULES.map(({ id }) => id), EXPECTED_STATEFUL_IDS);
  assert.deepEqual(VISUAL_STATEFUL_MODULES.map(({ kind }) => kind), EXPECTED_STATEFUL_KINDS);
  assert.deepEqual(
    [...Object.values(VISUAL_STATEFUL_KINDS ?? {})].sort((left, right) => left - right),
    EXPECTED_STATEFUL_KINDS,
    "the visual kind map must retain the same six fixed evaluator kinds",
  );
  assert.deepEqual(ADVANCED_STATEFUL_MODULES.map(({ kind }) => kind), EXPECTED_ADVANCED_KINDS);
  assert.deepEqual(
    [...Object.values(STATEFUL_KINDS ?? {})].sort((left, right) => left - right),
    [...EXPECTED_STATEFUL_KINDS, ...EXPECTED_ADVANCED_KINDS],
    "the aggregate kind map must cover the complete ordered-state range",
  );
  assert.equal(STATEFUL_MODULES.length, 21);

  const allIds = SHADER_PLAYGROUND_MODULES.map(({ id }) => id);
  const allKinds = SHADER_PLAYGROUND_MODULES.map(({ kind }) => kind);
  assert.equal(new Set(allIds).size, allIds.length, "module ids must remain globally unique");
  assert.equal(new Set(allKinds).size, allKinds.length, "module kinds must remain globally unique");
  for (const module of STATEFUL_MODULES) {
    assert.equal(allIds.filter((id) => id === module.id).length, 1, `${module.id} must be registered exactly once`);
    assert.equal(allKinds.filter((kind) => kind === module.kind).length, 1, `kind ${module.kind} must be registered exactly once`);
    assert.ok(
      module.stateful === true || module.state?.family,
      `${module.id} needs explicit stateful runtime metadata`,
    );
  }
});

test("state shader variants retain only renderers reachable from their exact active kinds", () => {
  const fullLength = STATEFUL_SHADER.length;
  assert.ok(fullLength > 100_000, "the complete documentation shader should retain the entire catalog");

  for (const [kind, renderer] of STATE_RENDERER_BY_KIND) {
    const variant = stateful.shaderSynthPlaygroundStateShaderVariant([kind]);
    assert.equal(variant.key, `state-kinds-v1:${kind}`);
    assert.deepEqual(variant.kinds, [kind]);
    assert.match(variant.code, /@compute @workgroup_size\(64\)/);
    assert.match(variant.code, new RegExp(`case ${kind}u: \\{ ${renderer}\\(node\\); \\}`));
    assert.match(variant.code, new RegExp(`fn ${renderer}\\(`));
    assert.ok(
      variant.code.length < fullLength * 0.15,
      `kind ${kind} specialization should be materially smaller than the full catalog`,
    );
    for (const [otherKind, otherRenderer] of STATE_RENDERER_BY_KIND) {
      if (otherKind === kind) continue;
      assert.doesNotMatch(
        variant.code,
        new RegExp(`fn ${otherRenderer}\\(`),
        `kind ${kind} must not retain renderer ${otherRenderer}`,
      );
    }
  }
});

test("state shader variant keys sort, deduplicate, cache, and derive from encoded graphs", () => {
  const first = stateful.shaderSynthPlaygroundStateShaderVariant([120, 105, 120, 108]);
  const second = stateful.shaderSynthPlaygroundStateShaderVariant([{ kind: 108 }, { kind: 120 }, { kind: 105 }]);
  assert.equal(first, second, "equivalent exact kind sets should reuse one immutable variant");
  assert.equal(first.key, "state-kinds-v1:105,108,120");
  assert.deepEqual(first.kinds, [105, 108, 120]);
  assert.equal(stateful.shaderSynthPlaygroundStateShaderKey([120, 105, 108]), first.key);
  assert.equal(stateful.buildShaderSynthPlaygroundStateShader([105, 108, 120]), first.code);
  assert.ok(first.code.length < STATEFUL_SHADER.length * 0.3);

  const encoded = encodedStateNodes([120, 105, 120, 108]);
  const fromEncoded = stateful.shaderSynthPlaygroundStateShaderVariantForEncoded(encoded);
  assert.equal(fromEncoded, first);

  const empty = stateful.shaderSynthPlaygroundStateShaderVariant([]);
  assert.equal(empty.key, "state-kinds-v1:none");
  assert.deepEqual(empty.kinds, []);
  assert.match(empty.code, /fn renderStateNode\(/);
  assert.doesNotMatch(empty.code, /fn render(?:CellularAutomaton|NeuralProcessor)\(/);
  const emptyEntry = wgslBlock(empty.code, "fn renderStateNode(");
  for (const bindingName of [
    "render_info",
    "graph_nodes",
    "graph_signals",
    "state_output",
    "persistent_state",
    "state_stage",
  ]) {
    assert.match(
      emptyEntry,
      new RegExp(`\\b${bindingName}\\b`),
      `every exact auto layout must retain runtime binding ${bindingName}`,
    );
  }
  assert.throws(
    () => stateful.shaderSynthPlaygroundStateShaderVariant([999]),
    /Unknown shader playground state kind: 999/,
  );
});

test("all stateful modules expose bounded typed I/O and packed audible parameters", () => {
  const signalTypes = new Set(["audio", "stereo", "control"]);
  for (const module of STATEFUL_MODULES) {
    assert.ok(module.inputs.length > 0, `${module.id} needs an excitation, coordinate, or routing input`);
    assert.ok(module.inputs.length <= SHADER_PLAYGROUND_LIMITS.maxInputs, `${module.id} exceeds graph input packing`);
    assert.ok(module.outputs.length > 0 && module.outputs.length <= 2, `${module.id} needs one or two patchable outputs`);
    assert.ok(module.params.length > 0 && module.params.length <= 8, `${module.id} exceeds p0/p1 parameter packing`);
    assert.equal(new Set(module.inputs.map(({ id }) => id)).size, module.inputs.length, `${module.id} repeats an input id`);
    assert.equal(new Set(module.outputs.map(({ id }) => id)).size, module.outputs.length, `${module.id} repeats an output id`);
    assert.equal(new Set(module.params.map(({ id }) => id)).size, module.params.length, `${module.id} repeats a parameter id`);

    for (const input of module.inputs) {
      assert.ok(input.types?.length, `${module.id}.${input.id} needs accepted signal types`);
      assert.equal(input.types.every((type) => signalTypes.has(type)), true, `${module.id}.${input.id} has an unknown signal type`);
    }
    for (const output of module.outputs) {
      assert.ok(signalTypes.has(output.type), `${module.id}.${output.id} has an unknown signal type`);
    }
    for (const parameter of module.params) {
      assert.ok(parameter.min < parameter.max, `${module.id}.${parameter.id} needs a usable range`);
      assert.ok(parameter.default >= parameter.min && parameter.default <= parameter.max, `${module.id}.${parameter.id} default is outside its range`);
      assert.ok(parameter.low && parameter.high && parameter.behavior, `${module.id}.${parameter.id} needs audible endpoint language`);
    }
    assert.ok(module.state?.family && module.state.resources && module.state.lifecycle, `${module.id} needs explicit GPU state ownership metadata`);
    for (const resetParameter of module.state.resetParams ?? []) {
      assert.ok(module.params.some(({ id }) => id === resetParameter), `${module.id} names unknown reset parameter ${resetParameter}`);
    }
  }
});

test("every stateful module has one valid dedicated Hear graph", () => {
  const effectExcitationById = new Map([
    ["geometric-feedback-lattice", "procedural-kick"],
    ["spectral-sdf", "supersaw"],
    ["raymarch-resonator", "procedural-kick"],
  ]);
  for (const module of STATEFUL_MODULES) {
    assert.ok(module.auditionKind, `${module.id} needs a Hear strategy`);
    const auditions = SHADER_PLAYGROUND_COMBOS.filter((combo) => (
      combo.character === "primitive-audition"
      && combo.moduleTypes.includes(module.id)
      && combo.patch.nodes.some(({ id, type }) => id === "focus" && type === module.id)
    ));
    assert.equal(auditions.length, 1, `${module.id} needs exactly one focused Hear graph`);
    const [audition] = auditions;
    const validation = validateShaderPlaygroundPatch(audition.patch);
    assert.equal(validation.valid, true, `${module.id} Hear graph: ${validation.errors.join(" ")}`);

    const focus = audition.patch.nodes.find(({ id }) => id === "focus");
    const incoming = audition.patch.connections.filter(({ to }) => to.node === focus.id);
    const outgoing = audition.patch.connections.filter(({ from }) => from.node === focus.id);
    for (const input of module.inputs.filter(({ required }) => required)) {
      assert.ok(
        incoming.some(({ to }) => to.port === input.id),
        `${module.id} Hear graph must drive required input ${input.id}`,
      );
    }
    assert.ok(outgoing.length > 0, `${module.id} Hear graph must route its result toward Output`);

    const encoded = encodeShaderPlaygroundPatch(audition.patch);
    const focusOffset = encoded.order.indexOf(focus.id) * 20;
    assert.ok(focusOffset >= 0, `${module.id} focus must survive graph encoding`);
    module.params.forEach((parameter, index) => {
      const expected = new Float32Array([focus.params[parameter.id]])[0];
      assert.equal(encoded.data[focusOffset + 12 + index], expected, `${module.id}.${parameter.id} target slot drifted`);
    });

    const expectedExcitation = effectExcitationById.get(module.id);
    if (expectedExcitation) {
      assert.equal(
        audition.patch.nodes.find(({ id }) => id === "source")?.type,
        expectedExcitation,
        `${module.id} Hear graph must retain its characteristic excitation source`,
      );
    }
  }
});

test("stateful WGSL owns six cases and a dedicated ordered compute entry point", async () => {
  assert.ok(STATEFUL_SHADER.length > 0, "the dedicated state module must export WGSL source");
  assert.equal(
    countMatches(STATEFUL_SHADER, /@compute\s+@workgroup_size\s*\(/g),
    1,
    "one ordered state-node pass may combine persistent evolution with audio/control projection",
  );
  const renderFunctionById = new Map([
    ["cellular-automaton-score", "renderCellularAutomaton"],
    ["reaction-diffusion-score-lattice", "renderReactionDiffusion"],
    ["geometric-feedback-lattice", "renderFeedbackLattice"],
    ["spectral-sdf", "renderSpectralSdf"],
    ["flow-field-advection", "renderFlowAdvection"],
    ["raymarch-resonator", "renderRaymarchResonator"],
  ]);
  for (const [index, id] of EXPECTED_STATEFUL_IDS.entries()) {
    const kind = EXPECTED_STATEFUL_KINDS[index];
    assert.equal(countMatches(STATEFUL_SHADER, new RegExp(`case ${kind}u:`, "g")), 1, `${id} needs one stateful WGSL case`);
    const renderFunction = renderFunctionById.get(id);
    assert.match(statefulCase(kind), new RegExp(`${renderFunction}\\(node\\)`), `${id} must dispatch its dedicated renderer`);
    assert.match(
      wgslFunction(renderFunction),
      /node\.target[01]|params[01]\(node/,
      `${id} must consume packed graph parameters in its renderer`,
    );
  }

  const stateEngineSource = await readFile(new URL("src/shader-synth-playground-state-engine.js", ROOT), "utf8");
  assert.match(
    stateEngineSource,
    /entryPoint:\s*["']renderStateNode["']/,
    "the state engine must build a pipeline for the ordered state-node entry point",
  );
  assert.match(
    stateEngineSource,
    /createComputePipeline(?:Async)?\s*\(/,
    "the state engine must own a dedicated GPU compute pipeline",
  );
});

test("advanced state kinds dispatch dedicated renderers with aligned reset and asset contracts", () => {
  const rendererByKind = new Map([
    [111, "renderSequenceLane"],
    [112, "renderUploadedWavetable"],
    [113, "renderGpuSamplerGranulator"],
    [114, "renderSpatializer"],
    [115, "renderRecursiveFilter"],
    [116, "renderFeedbackNetwork"],
    [117, "renderWavefieldSolver"],
    [118, "renderSpectralTransport"],
    [119, "renderAdvancedDynamics"],
    [120, "renderConvolutionSpace"],
    [121, "renderMassiveBank"],
    [122, "renderAudioAnalysisField"],
    [123, "renderDdspResynth"],
    [124, "renderSpectralVocoder"],
    [125, "renderNeuralProcessor"],
  ]);
  const assetKinds = new Set([112, 113, 120]);
  const sampleRate = 48000;

  for (const module of ADVANCED_STATEFUL_MODULES) {
    const renderer = rendererByKind.get(module.kind);
    assert.equal(countMatches(STATEFUL_SHADER, new RegExp(`case ${module.kind}u:`, "g")), 1);
    assert.match(statefulCase(module.kind), new RegExp(`${renderer}\\(node\\)`));
    assert.match(wgslFunction(renderer), /node\.|stateInput\(|params[01]\(/, `${module.id} renderer must consume graph state`);

    const resetIndices = module.state.resetParams.map((parameterId) => (
      module.params.findIndex(({ id }) => id === parameterId)
    ));
    assert.deepEqual(
      SHADER_SYNTH_PLAYGROUND_ADVANCED_RESET_PARAM_INDICES[module.kind],
      resetIndices,
      `${module.id} reset signature must track its declared structural parameters`,
    );

    const byteSize = shaderSynthPlaygroundAdvancedPersistentByteSize(module.kind, sampleRate);
    assert.ok(byteSize > 0 && byteSize % 16 === 0, `${module.id} needs aligned private GPU storage`);
    assert.equal(stateful.shaderSynthPlaygroundStatePersistentByteSize(module.kind, sampleRate), byteSize);

    const layout = shaderSynthPlaygroundAdvancedAssetLayout(module.kind, sampleRate);
    assert.equal(Boolean(layout), assetKinds.has(module.kind), `${module.id} uploaded-asset ownership drifted`);
    if (layout) {
      assert.ok(layout.capacityFrames > 0 && layout.channels >= 1 && layout.channels <= 2);
      assert.ok(
        (layout.offsetVec4 + layout.capacityFrames) * 16 <= byteSize,
        `${module.id} upload region must stay inside its private state buffer`,
      );
    }
  }

  assert.equal(shaderSynthPlaygroundAdvancedPersistentByteSize(110, sampleRate), 0);
  assert.equal(shaderSynthPlaygroundAdvancedAssetLayout(125, sampleRate), null);
  assert.equal(SHADER_SYNTH_PLAYGROUND_ADVANCED_STATE_LIMITS.convolutionSeconds, 12);

  const entry = wgslFunction("renderStateNode");
  const laneZeroGuard = entry.indexOf("if (lane != 0u)");
  assert.ok(entry.indexOf("case 117u:") < laneZeroGuard, "wavefield block updates need the full 64-lane workgroup");
  assert.ok(entry.indexOf("case 120u:") < laneZeroGuard, "convolution sample blocks need the full 64-lane workgroup");
  for (const kind of EXPECTED_ADVANCED_KINDS.filter((kind) => kind !== 117 && kind !== 120)) {
    assert.ok(entry.indexOf(`case ${kind}u:`) > laneZeroGuard, `advanced kind ${kind} must stay lane-zero ordered`);
  }
});

test("Spectral SDF keeps its 64-lane ordered state-pass contract", () => {
  assert.equal(
    stateful.SHADER_SYNTH_PLAYGROUND_STATE_ENGINE_LIMITS.spectralBands,
    64,
    "the runtime allocation and dispatch contract must retain exactly 64 spectral bands",
  );
  assert.equal(
    countMatches(STATEFUL_SHADER, /const\s+SPECTRAL_BANDS\s*:\s*u32\s*=\s*64u\s*;/g),
    1,
    "WGSL must retain the same 64-band bound",
  );
  assert.match(
    STATEFUL_SHADER,
    /@compute\s+@workgroup_size\s*\(\s*64\s*\)\s*fn\s+renderStateNode\s*\(/,
    "the ordered state entry point must launch one lane per spectral band",
  );

  const entry = wgslFunction("renderStateNode");
  const spectralDispatch = entry.indexOf("case 108u:");
  const laneZeroGuard = entry.indexOf("if (lane != 0u)");
  assert.ok(spectralDispatch >= 0, "kind 108 must have an entry-point dispatch");
  assert.ok(laneZeroGuard > spectralDispatch, "kind 108 must dispatch before the lane-zero-only branch");
  assert.match(
    entry.slice(spectralDispatch, laneZeroGuard),
    /renderSpectralSdf\s*\(\s*node\s*\)/,
    "all 64 lanes must invoke the Spectral SDF renderer",
  );
  for (const kind of [105, 106, 107, 109, 110]) {
    assert.ok(
      entry.indexOf(`case ${kind}u:`) > laneZeroGuard,
      `non-spectral kind ${kind} must remain behind the lane-zero guard`,
    );
  }

  const spectralRenderer = wgslFunction("renderSpectralSdf");
  const segmentLoop = wgslBlock(
    spectralRenderer,
    "for (var segmentIndex = 0u; segmentIndex < state_stage.spectralSegments; segmentIndex += 1u)",
  );
  assert.equal(
    countMatches(segmentLoop, /storageBarrier\s*\(\s*\)\s*;/g),
    4,
    "each spectral hop must barrier after output, ingest, band analysis, and overlap-add",
  );

  const analysisLoop = wgslBlock(
    spectralRenderer,
    "for (var n = 0u; n < MAX_SPECTRAL_FRAMES; n += 1u)",
  );
  assert.doesNotMatch(
    analysisLoop,
    /\b(?:cos|sin)\s*\(/,
    "the 64-band DFT inner loop must advance cached oscillator rotations instead of evaluating trig per sample",
  );
  assert.match(spectralRenderer, /phaseRotation[\s\S]*windowRotation/, "DFT analysis needs cached phase and window rotations");
});

test("every packed stateful parameter is read by its dedicated WGSL renderer", () => {
  const referencesById = new Map([
    ["cellular-automaton-score", [
      /p0\.x/, /p0\.y/, /p0\.z/, /node\.target0\.w/,
      /node\.target1\.x/, /p1\.y/, /p1\.z/, /p1\.w/,
    ]],
    ["reaction-diffusion-score-lattice", [
      /p0\.x/, /p0\.y/, /p0\.z/, /p0\.w/,
      /p1\.x/, /p\.y/, /p\.z/, /node\.target1\.w/,
    ]],
    ["geometric-feedback-lattice", [
      /p0\.x/, /p0\.y/, /p0\.z/, /p0\.w/,
      /p1\.x/, /p1\.y/, /p1\.z/, /p1\.w/,
    ]],
    ["spectral-sdf", [
      /node\.(?:previous|target)0\.x/, /p0\.y/, /p0\.z/, /p0\.w/,
      /p1\.x/, /p1\.y/, /p1\.z/, /p1\.w/,
    ]],
    ["flow-field-advection", [
      /p0\.x/, /p0\.y/, /p0\.z/, /p0\.w/,
      /p1\.x/, /p1\.y/, /node\.target1\.z/, /params1\(node, sample\)\.w/,
    ]],
    ["raymarch-resonator", [
      /target0\.x/, /target0\.y/, /target0\.z/, /p0\.w/,
      /p1\.x/, /p1\.y/, /p1\.z/, /p1\.w/,
    ]],
  ]);
  const rendererById = new Map([
    ["cellular-automaton-score", "renderCellularAutomaton"],
    ["reaction-diffusion-score-lattice", "renderReactionDiffusion"],
    ["geometric-feedback-lattice", "renderFeedbackLattice"],
    ["spectral-sdf", "renderSpectralSdf"],
    ["flow-field-advection", "renderFlowAdvection"],
    ["raymarch-resonator", "renderRaymarchResonator"],
  ]);

  for (const module of VISUAL_STATEFUL_MODULES) {
    const renderer = wgslFunction(rendererById.get(module.id));
    const references = referencesById.get(module.id);
    assert.equal(references.length, module.params.length, `${module.id} parameter-reference contract drifted`);
    references.forEach((reference, index) => {
      assert.match(renderer, reference, `${module.id}.${module.params[index].id} is packed but never read`);
    });
  }
});

test("Spectral SDF maps each exposed analysis-window choice to a distinct power of two", () => {
  const spectral = VISUAL_STATEFUL_MODULES.find(({ id }) => id === "spectral-sdf");
  const windowParameter = spectral.params.find(({ id }) => id === "fftSize");
  assert.deepEqual(
    {
      min: windowParameter.min,
      max: windowParameter.max,
      step: windowParameter.step,
      default: windowParameter.default,
      options: windowParameter.options,
    },
    { min: 0, max: 3, step: 1, default: 2, options: ["256", "512", "1024", "2048"] },
  );
  const selector = wgslFunction("selectedFftSize");
  assert.ok(
    /value\s*<\s*0\.5[\s\S]*?256u[\s\S]*?value\s*<\s*1\.5[\s\S]*?512u[\s\S]*?value\s*<\s*2\.5[\s\S]*?1024u[\s\S]*?2048u/.test(selector)
      || /switch\s+u32\([^)]*value[^)]*\)[\s\S]*?case\s+0u[\s\S]*?256u[\s\S]*?case\s+1u[\s\S]*?512u[\s\S]*?case\s+2u[\s\S]*?1024u[\s\S]*?2048u/.test(selector),
    "the 0..3 selector must not be interpreted as a raw sample count",
  );
});

test("stateful bypass survives JSON serialization and keeps graph routing and parameters intact", () => {
  const active = geometricFeedbackPatch(true);
  const activeFocus = active.nodes.find(({ id }) => id === "focus");
  assert.equal(activeFocus.enabled, true);

  const serialized = JSON.parse(JSON.stringify(active));
  serialized.nodes.find(({ id }) => id === "focus").enabled = false;
  const bypassed = sanitizeShaderPlaygroundPatch(serialized);
  const bypassedFocus = bypassed.nodes.find(({ id }) => id === "focus");
  assert.equal(bypassedFocus.enabled, false, "sanitization must preserve an explicit state bypass");
  assert.equal(
    Object.hasOwn(bypassed.nodes.find(({ id }) => id === "source"), "enabled"),
    false,
    "the state lifecycle flag must not leak onto ordinary sample nodes",
  );
  assert.equal(validateShaderPlaygroundPatch(bypassed).valid, true);

  const encoded = encodeShaderPlaygroundPatch(bypassed);
  const focusIndex = encoded.order.indexOf("focus");
  const sourceIndex = encoded.order.indexOf("source");
  const focusOffset = focusIndex * 20;
  assert.equal(encoded.data[focusOffset], -107, "a bypassed state node needs the reserved negative-kind sentinel");
  assert.equal(encoded.data[focusOffset + 1], sourceIndex + 1, "input A routing must survive bypass");
  STATEFUL_MODULES.find(({ id }) => id === "geometric-feedback-lattice").params.forEach((parameter, index) => {
    assert.equal(
      encoded.data[focusOffset + 12 + index],
      new Float32Array([bypassedFocus.params[parameter.id]])[0],
      `${parameter.id} must remain serialized while the node is bypassed`,
    );
  });
  assert.deepEqual(
    stateful.shaderSynthPlaygroundStateEngineNodes(encoded),
    [],
    "a bypassed node must not enter the ordered state engine",
  );
});

test("the graph shader bypasses a state kind by forwarding input A in both transition paths", () => {
  const render = wgslBlock(SHADER_PLAYGROUND_SHADER, "fn render(");
  assert.match(render, /let bypassed = graphNode\.header\.x < 0\.0/);
  assert.match(render, /let kind = u32\(round\(abs\(graphNode\.header\.x\)\)\)/);
  assert.match(
    render,
    /let previousInputA = readInput\(&previousValues, graphNode\.header\.y\);[\s\S]*?var previousResult = previousInputA;[\s\S]*?if \(!bypassed\) \{[\s\S]*?previousResult = evaluateNode/,
  );
  assert.match(
    render,
    /let targetInputA = readInput\(&targetValues, graphNode\.header\.y\);[\s\S]*?targetResult = targetInputA;[\s\S]*?if \(!bypassed\) \{[\s\S]*?targetResult = evaluateNode/,
  );
  assert.equal(stateful.isShaderSynthPlaygroundStateEngineKind(107), true);
  assert.equal(stateful.isShaderSynthPlaygroundStateEngineKind(-107), false);
});

test("state engine allocates lazily and destroys private buffers with the last active node", () => {
  const buffers = [];
  const device = {
    queue: { writeBuffer() {} },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyCount: 0,
        destroy() { this.destroyCount += 1; },
      };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroup(descriptor) { return { descriptor }; },
  };
  const pipeline = { getBindGroupLayout() { return {}; } };
  const engine = new StatefulEngine(device, {
    usage: { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 },
    sampleRate: 48000,
    chunkSamples: 128,
    maxNodes: SHADER_PLAYGROUND_LIMITS.maxNodes,
    renderInfoBuffer: {},
    nodeBuffer: {},
  }).setPipeline(pipeline);

  assert.equal(engine.sync(encodedStateNodes()), false);
  assert.equal(engine.active, false);
  assert.equal(buffers.length, 0, "an ordinary patch must not allocate state scratch or private buffers");

  assert.equal(engine.sync(encodedStateNodes([105])), true);
  assert.equal(engine.active, true);
  assert.equal(engine.allocationSummary.nodeCount, 1);
  assert.ok(engine.allocationSummary.scratchBytes > 0);
  assert.ok(engine.allocationSummary.persistentBytes > 0);
  assert.equal(buffers.length, 4, "one node needs two shared scratch, one private state, and one stage-info buffer");
  assert.equal(buffers.every(({ destroyCount }) => destroyCount === 0), true);

  assert.equal(engine.sync(encodedStateNodes()), true);
  assert.equal(engine.active, false);
  assert.equal(engine.allocationSummary.scratchBytes, 0);
  assert.equal(engine.allocationSummary.persistentBytes, 0);
  assert.equal(buffers.every(({ destroyCount }) => destroyCount === 1), true, "last-node removal must destroy all state allocations");
  assert.equal(engine.sync(encodedStateNodes()), false, "repeated empty synchronization must not allocate or destroy again");
  assert.equal(buffers.every(({ destroyCount }) => destroyCount === 1), true);
});

test("changing an exact state pipeline invalidates auto-layout bind groups", () => {
  const bindGroups = [];
  const device = {
    queue: { writeBuffer() {} },
    createBuffer(descriptor) {
      return { descriptor, destroy() {} };
    },
    createBindGroup(descriptor) {
      const bindGroup = { descriptor };
      bindGroups.push(bindGroup);
      return bindGroup;
    },
  };
  const firstLayout = {};
  const secondLayout = {};
  const firstPipeline = { getBindGroupLayout() { return firstLayout; } };
  const secondPipeline = { getBindGroupLayout() { return secondLayout; } };
  const engine = new StatefulEngine(device, {
    usage: { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 },
    sampleRate: 48000,
    chunkSamples: 128,
    maxNodes: SHADER_PLAYGROUND_LIMITS.maxNodes,
    renderInfoBuffer: {},
    nodeBuffer: {},
  }).setPipeline(firstPipeline, "state-kinds-v1:105");

  const encoded = encodedStateNodes([105]);
  engine.sync(encoded);
  const resource = engine.orderedResources[0];
  const firstBindGroup = resource.bindGroup;
  assert.equal(firstBindGroup.descriptor.layout, firstLayout);

  engine.setPipeline(secondPipeline, "state-kinds-v1:106");
  assert.equal(resource.bindGroup, null, "a replacement auto layout must invalidate the old bind group");
  engine.sync(encoded);
  assert.notEqual(resource.bindGroup, firstBindGroup);
  assert.equal(resource.bindGroup.descriptor.layout, secondLayout);
  assert.equal(bindGroups.length, 2);

  const currentBindGroup = resource.bindGroup;
  engine.setPipeline(secondPipeline, "state-kinds-v1:106");
  assert.equal(resource.bindGroup, currentBindGroup, "reusing the same pipeline and key should preserve its bind group");
  engine.sync(encoded);
  assert.equal(bindGroups.length, 2);
});

test("state engine releases and recreates resources across active, bypassed, and active states", () => {
  const buffers = [];
  const device = {
    queue: { writeBuffer() {} },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyCount: 0,
        destroy() { this.destroyCount += 1; },
      };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroup(descriptor) { return { descriptor }; },
  };
  const pipeline = { getBindGroupLayout() { return {}; } };
  const engine = new StatefulEngine(device, {
    usage: { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 },
    sampleRate: 48000,
    chunkSamples: 128,
    maxNodes: SHADER_PLAYGROUND_LIMITS.maxNodes,
    renderInfoBuffer: {},
    nodeBuffer: {},
  }).setPipeline(pipeline);

  const active = encodeShaderPlaygroundPatch(geometricFeedbackPatch(true));
  const bypassed = encodeShaderPlaygroundPatch(geometricFeedbackPatch(false));
  const restored = encodeShaderPlaygroundPatch(geometricFeedbackPatch(true));

  assert.equal(engine.sync(active), true);
  assert.equal(engine.active, true);
  assert.equal(engine.orderedResources.length, 1);
  const firstResource = engine.orderedResources[0];
  const firstBuffers = [...buffers];

  assert.equal(engine.sync(bypassed), true);
  assert.equal(engine.active, false);
  assert.equal(engine.orderedResources.length, 0);
  assert.equal(engine.allocationSummary.persistentBytes, 0);
  assert.equal(firstBuffers.every(({ destroyCount }) => destroyCount === 1), true);

  assert.equal(engine.sync(restored), true);
  assert.equal(engine.active, true);
  assert.equal(engine.orderedResources.length, 1);
  assert.notEqual(engine.orderedResources[0], firstResource, "re-enabling must create fresh private state");
  assert.equal(buffers.length, firstBuffers.length * 2);
  assert.equal(buffers.slice(firstBuffers.length).every(({ destroyCount }) => destroyCount === 0), true);
});

test("uploaded audio is owned by node id and module kind across same-id replacements", () => {
  const buffers = [];
  const writes = [];
  const device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, byteLength: data.byteLength });
      },
    },
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyCount: 0,
        destroy() { this.destroyCount += 1; },
      };
      buffers.push(buffer);
      return buffer;
    },
    createBindGroup(descriptor) { return { descriptor }; },
  };
  const stateEngine = new StatefulEngine(device, {
    usage: { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 },
    sampleRate: 48000,
    chunkSamples: 128,
    maxNodes: SHADER_PLAYGROUND_LIMITS.maxNodes,
    renderInfoBuffer: {},
    nodeBuffer: {},
  }).setPipeline({ getBindGroupLayout() { return {}; } });

  stateEngine.sync(encodedStateNodes([112]));
  const wavetableResource = stateEngine.orderedResources[0];
  assert.equal(
    stateEngine.setNodeAsset("state-0", 112, new Float32Array([0, 0.5, -0.5, 0])),
    true,
  );
  assert.deepEqual(
    [...stateEngine.nodeAssets.values()].map(({ nodeId, kind }) => ({ nodeId, kind })),
    [{ nodeId: "state-0", kind: 112 }],
  );
  assert.ok(
    writes.some(({ buffer, offset }) => buffer === wavetableResource.persistentBuffer && offset === 16),
    "the matching wavetable asset must upload into its own private buffer",
  );

  const replacementWriteStart = writes.length;
  stateEngine.sync(encodedStateNodes([113]));
  const samplerResource = stateEngine.orderedResources[0];
  assert.equal(wavetableResource.persistentBuffer.destroyCount, 1, "kind replacement must destroy old GPU state");
  assert.equal(wavetableResource.infoBuffer.destroyCount, 1);
  assert.equal(stateEngine.nodeAssets.size, 0, "a same-id asset from the old kind must be discarded");
  assert.equal(
    writes.slice(replacementWriteStart).some(({ buffer, offset }) => (
      buffer === samplerResource.persistentBuffer && offset === 16
    )),
    false,
    "old wavetable samples must never upload into the replacement sampler buffer",
  );
  assert.equal(
    stateEngine.setNodeAsset("state-0", 113, new Float32Array([0.25, -0.25]), new Float32Array([-0.5, 0.5])),
    true,
  );
  assert.deepEqual(
    [...stateEngine.nodeAssets.values()].map(({ nodeId, kind }) => ({ nodeId, kind })),
    [{ nodeId: "state-0", kind: 113 }],
  );
  assert.ok(
    writes.some(({ buffer, offset }) => buffer === samplerResource.persistentBuffer && offset === 16),
    "the replacement asset must upload only after its matching resource exists",
  );
  assert.equal(stateEngine.setNodeAsset("state-0", 125, new Float32Array([1])), false);

  const forwarded = [];
  const cleared = [];
  const audio = new ShaderSynthPlaygroundAudio({});
  audio.statefulEngine = {
    sync() { return false; },
    setNodeAsset(...args) { forwarded.push(args); return true; },
    clearNodeAsset(...args) { cleared.push(args); return true; },
  };
  audio.updatePatch(residentAssetPatch("uploaded-wavetable"));
  assert.equal(audio.setNodeAsset("focus", new Float32Array([0, 1, 0, -1])), true);
  assert.deepEqual(
    [...audio.pendingNodeAssets.values()].map(({ nodeId, moduleId, kind }) => ({ nodeId, moduleId, kind })),
    [{ nodeId: "focus", moduleId: "uploaded-wavetable", kind: 112 }],
  );
  assert.deepEqual(forwarded.at(-1).slice(0, 2), ["focus", 112], "runtime must forward the owner kind");

  audio.updatePatch(residentAssetPatch("gpu-sampler-granulator"));
  assert.equal(audio.pendingNodeAssets.size, 0, "same-id module replacement must evict pending CPU data");
  assert.deepEqual(cleared.at(-1), ["focus", 112], "the old state kind must be cleared explicitly");
  assert.equal(audio.setNodeAsset("focus", new Float32Array([0.1, 0.2])), true);
  assert.deepEqual(
    [...audio.pendingNodeAssets.values()].map(({ moduleId, kind }) => ({ moduleId, kind })),
    [{ moduleId: "gpu-sampler-granulator", kind: 113 }],
  );

  audio.updatePatch(residentAssetPatch("oscillator"));
  assert.equal(audio.pendingNodeAssets.size, 0, "a non-asset replacement must discard the prior upload");
  assert.deepEqual(cleared.at(-1), ["focus", 113]);
  assert.equal(audio.setNodeAsset("focus", new Float32Array([1])), false, "ordinary modules cannot claim audio data");
});

test("performance notes restart only sampler nodes in One-shot mode", () => {
  const writes = [];
  const oneShotBuffer = { id: "one-shot-buffer" };
  const loopBuffer = { id: "loop-buffer" };
  const engine = Object.create(StatefulEngine.prototype);
  engine.device = {
    queue: {
      writeBuffer(...args) { writes.push(args); },
    },
  };
  engine.nodeResources = new Map([
    ["one", { kind: 113, params: [0], persistentBuffer: oneShotBuffer }],
    ["loop", { kind: 113, params: [1], persistentBuffer: loopBuffer }],
    ["other", { kind: 116, params: [0], persistentBuffer: { id: "feedback-buffer" } }],
  ]);

  assert.equal(engine.triggerPerformanceNote(), 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], oneShotBuffer);
  assert.equal(writes[0][1], Float32Array.BYTES_PER_ELEMENT * 2, "only header.z is cleared");
  assert.deepEqual([...writes[0][2]], [0]);
});

test("large state resources are conditional, state passes are active-only, and shutdown destroys them", async () => {
  const [coreSource, stateEngineSource] = await Promise.all([
    readFile(new URL("src/shader-synth-playground.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-state-engine.js", ROOT), "utf8"),
  ]);
  const lifecycleSource = `${coreSource}\n${stateEngineSource}`;
  const allocationContract = lifecycleSource.match(
    /(?:ensure|sync|allocate)\w*stateful\w*(?:resource|buffer)\w*\s*\([^)]*\)\s*\{[\s\S]{0,6000}?\n\s*\}/i,
  )?.[0] ?? "";
  assert.ok(allocationContract, "state buffers need a dedicated conditional allocation helper");
  assert.match(allocationContract, /(?:count|length|active|needed|required)/i);
  assert.match(allocationContract, /createBuffer\s*\(/, "the helper must own large GPU-buffer creation");
  assert.match(
    allocationContract,
    /if\s*\([^)]*(?:===?\s*0|<=\s*0|!\s*\w+|active|needed|required)[^)]*\)/i,
    "allocation must be guarded by active stateful nodes rather than happen for every patch",
  );

  const renderSource = ShaderSynthPlaygroundAudio.prototype.renderChunk.toString();
  assert.match(
    renderSource,
    /if\s*\(activeStateful\)\s*\{[\s\S]{0,3000}?orderedResources[\s\S]{0,1000}?encodeNodePass\([\s\S]{0,500}?encodeGraphPass\(\)/,
    "each ordered state pass and causal graph rerun must remain inside the active-state guard",
  );

  const stopSource = ShaderSynthPlaygroundAudio.prototype.stop.toString();
  assert.match(
    stopSource,
    /this\.statefulEngine(?:\?\.|\.)destroy(?:\?\.)?\(/,
    "shutdown must destroy the state engine rather than only drop its reference",
  );
  assert.match(
    lifecycleSource,
    /(?:release|destroy)\w*stateful\w*(?:resource|buffer)|stateful[\s\S]{0,1200}?\.destroy\?*\s*\./i,
    "removing the last active stateful node must have an explicit destruction path",
  );
});

test("stateful passes keep simulation data on GPU and preserve one final CPU readback", async () => {
  const [coreSource, stateBarrelSource, stateEngineSource, visualStateSource] = await Promise.all([
    readFile(new URL("src/shader-synth-playground.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-stateful.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-state-engine.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-visual-state.js", ROOT), "utf8"),
  ]);
  const renderStart = coreSource.indexOf("  async renderChunk(");
  const renderEnd = coreSource.indexOf("\n  handleError(", renderStart);
  const renderSource = coreSource.slice(renderStart, renderEnd);

  assert.equal(countMatches(renderSource, /\.mapAsync\s*\(/g), 1, "only the finished stereo chunk may map to the CPU");
  assert.equal(countMatches(renderSource, /getMappedRange\s*\(/g), 1, "only the finished stereo chunk may be read by JavaScript");
  assert.equal(
    countMatches(renderSource, /copyBufferToBuffer\([^;]*this\.mapBuffer[^;]*\)/g),
    1,
    "exactly one final GPU buffer copy may target the CPU map buffer",
  );
  assert.doesNotMatch(
    `${stateBarrelSource}\n${stateEngineSource}\n${visualStateSource}`,
    /mapAsync|getMappedRange/,
    "state grids must never cross to the CPU per audio chunk",
  );
});

test("site and WAX builds include the dedicated stateful runtime", async () => {
  const [
    barrel,
    waxBarrel,
    engine,
    waxEngine,
    visual,
    waxVisual,
    advanced,
    waxAdvanced,
    advancedEngine,
    waxAdvancedEngine,
    builder,
    core,
    waxCore,
  ] = await Promise.all([
    readFile(new URL("src/shader-synth-playground-stateful.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-stateful.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-state-engine.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-state-engine.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-visual-state.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-visual-state.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-advanced-state.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-advanced-state.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-advanced-state-engine.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-advanced-state-engine.js", ROOT), "utf8"),
    readFile(new URL("scripts/build-site.sh", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground.js", ROOT), "utf8"),
  ]);
  assert.equal(waxBarrel, barrel, "WAX must ship the exact stateful barrel used by the web build");
  assert.equal(waxEngine, engine, "WAX must ship the exact state engine used by the web build");
  assert.equal(waxVisual, visual, "WAX must ship the exact visual-state specs used by the web build");
  assert.equal(waxAdvanced, advanced, "WAX must ship the exact advanced-state specs used by the web build");
  assert.equal(waxAdvancedEngine, advancedEngine, "WAX must ship the exact advanced-state WGSL used by the web build");
  assert.equal(waxCore, core, "WAX core must import the same stateful graph integration");
  for (const file of [
    "shader-synth-playground-stateful.js",
    "shader-synth-playground-state-engine.js",
    "shader-synth-playground-visual-state.js",
    "shader-synth-playground-advanced-state.js",
    "shader-synth-playground-advanced-state-engine.js",
  ]) {
    assert.ok(
      countMatches(builder, new RegExp(`src/${file.replaceAll(".", "\\.")}`, "g")) >= 2,
      `${file} must appear in both worktree-runtime and required-file build contracts`,
    );
  }
});
