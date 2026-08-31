import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SHADER_PLAYGROUND_COMBOS,
  SHADER_PLAYGROUND_LIMITS,
  SHADER_PLAYGROUND_MODULES,
  ShaderSynthPlaygroundAudio,
  encodeShaderPlaygroundPatch,
  validateShaderPlaygroundPatch,
} from "../src/shader-synth-playground.js";
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

const STATEFUL_MODULES = stateful.SHADER_SYNTH_PLAYGROUND_STATEFUL_MODULES;
const STATEFUL_KINDS = stateful.SHADER_SYNTH_PLAYGROUND_STATEFUL_KINDS;
const STATEFUL_SHADER = stateful.SHADER_SYNTH_PLAYGROUND_STATEFUL_SHADER;
const StatefulEngine = stateful.ShaderSynthPlaygroundStateEngine;

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

function encodedStateNodes(kinds = []) {
  const data = new Float32Array(kinds.length * 20);
  const order = kinds.map((_, index) => `state-${index}`);
  const nodes = kinds.map((kind, index) => {
    data[index * 20] = kind;
    return { id: order[index], type: EXPECTED_STATEFUL_IDS[EXPECTED_STATEFUL_KINDS.indexOf(kind)] };
  });
  return {
    data,
    order,
    patch: { nodes, connections: [] },
    paramsByNode: new Map(order.map((id) => [id, [1, 2, 3, 4, 5, 6, 7, 8]])),
  };
}

test("six stateful visual modules own unique registry kinds 105 through 110", () => {
  assert.ok(Array.isArray(STATEFUL_MODULES), "the dedicated state module must export its module registry");
  assert.deepEqual(STATEFUL_MODULES.map(({ id }) => id), EXPECTED_STATEFUL_IDS);
  assert.deepEqual(STATEFUL_MODULES.map(({ kind }) => kind), EXPECTED_STATEFUL_KINDS);
  assert.deepEqual(
    [...Object.values(STATEFUL_KINDS ?? {})].sort((left, right) => left - right),
    EXPECTED_STATEFUL_KINDS,
    "the public kind map must describe the same six fixed evaluator kinds",
  );

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

test("stateful visual modules expose bounded typed I/O and packed audible parameters", () => {
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
  }
});

test("every stateful visual module has one valid dedicated Hear graph", () => {
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
    assert.ok(incoming.length > 0, `${module.id} Hear graph must drive at least one module input`);
    assert.ok(outgoing.length > 0, `${module.id} Hear graph must route its result toward Output`);

    const encoded = encodeShaderPlaygroundPatch(audition.patch);
    const focusOffset = encoded.order.indexOf(focus.id) * 20;
    assert.ok(focusOffset >= 0, `${module.id} focus must survive graph encoding`);
    module.params.forEach((parameter, index) => {
      const expected = new Float32Array([focus.params[parameter.id]])[0];
      assert.equal(encoded.data[focusOffset + 12 + index], expected, `${module.id}.${parameter.id} target slot drifted`);
    });
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
  const [barrel, waxBarrel, engine, waxEngine, visual, waxVisual, builder, core, waxCore] = await Promise.all([
    readFile(new URL("src/shader-synth-playground-stateful.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-stateful.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-state-engine.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-state-engine.js", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground-visual-state.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground-visual-state.js", ROOT), "utf8"),
    readFile(new URL("scripts/build-site.sh", ROOT), "utf8"),
    readFile(new URL("src/shader-synth-playground.js", ROOT), "utf8"),
    readFile(new URL("dist-wax/src/shader-synth-playground.js", ROOT), "utf8"),
  ]);
  assert.equal(waxBarrel, barrel, "WAX must ship the exact stateful barrel used by the web build");
  assert.equal(waxEngine, engine, "WAX must ship the exact state engine used by the web build");
  assert.equal(waxVisual, visual, "WAX must ship the exact visual-state specs used by the web build");
  assert.equal(waxCore, core, "WAX core must import the same stateful graph integration");
  for (const file of [
    "shader-synth-playground-stateful.js",
    "shader-synth-playground-state-engine.js",
    "shader-synth-playground-visual-state.js",
  ]) {
    assert.ok(
      countMatches(builder, new RegExp(`src/${file.replaceAll(".", "\\.")}`, "g")) >= 2,
      `${file} must appear in both worktree-runtime and required-file build contracts`,
    );
  }
});
