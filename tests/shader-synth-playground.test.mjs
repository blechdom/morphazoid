import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SHADER_PLAYGROUND_LIMITS,
  SHADER_PLAYGROUND_LAYOUT_DEFAULTS,
  SHADER_PLAYGROUND_COMBOS,
  SHADER_PLAYGROUND_MODULES,
  SHADER_PLAYGROUND_PRESETS,
  SHADER_PLAYGROUND_RUNTIME_DEFAULTS,
  SHADER_PLAYGROUND_SHADER,
  ShaderSynthPlaygroundAudio,
  canConnectShaderPlaygroundPorts,
  createShaderPlaygroundCombo,
  createShaderPlaygroundPatch,
  encodeShaderPlaygroundPatch,
  layoutShaderPlaygroundPatch,
  sanitizeShaderPlaygroundPatch,
  shaderPlaygroundSupport,
  validateShaderPlaygroundPatch,
} from "../src/shader-synth-playground.js";
import {
  SHADER_SYNTH_PLAYGROUND_FX_BINDINGS,
  SHADER_SYNTH_PLAYGROUND_FX_KINDS,
  SHADER_SYNTH_PLAYGROUND_FX_LIMITS,
  SHADER_SYNTH_PLAYGROUND_FX_MODULES,
  SHADER_SYNTH_PLAYGROUND_FX_SHADER,
  SHADER_SYNTH_PLAYGROUND_HISTORY_CAPTURE_SHADER,
  isShaderSynthPlaygroundFxKind,
  shaderSynthPlaygroundFxHistoryByteSize,
  shaderSynthPlaygroundFxHistoryFrames,
  shaderSynthPlaygroundFxNodes,
} from "../src/shader-synth-playground-fx.js";
import {
  SHADER_SYNTH_PLAYGROUND_EXTRA_CASES,
  SHADER_SYNTH_PLAYGROUND_EXTRA_HELPERS,
  SHADER_SYNTH_PLAYGROUND_EXTRA_MODULES,
} from "../src/shader-synth-playground-extra.js";
import {
  SHADER_SYNTH_PLAYGROUND_FOUND_HELPERS,
} from "../src/shader-synth-playground-found-sounds.js";
import {
  SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES,
  SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS,
  SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES,
} from "../src/shader-synth-playground-geometry.js";

const ROOT = new URL("../", import.meta.url);

function evaluatorCase(kind) {
  const evaluator = SHADER_PLAYGROUND_SHADER.slice(
    SHADER_PLAYGROUND_SHADER.indexOf("fn evaluateNode("),
    SHADER_PLAYGROUND_SHADER.indexOf("@compute @workgroup_size"),
  );
  const marker = `    case ${kind}u:`;
  const start = evaluator.indexOf(marker);
  assert.ok(start >= 0, `missing evaluator case ${kind}`);
  const remainder = evaluator.slice(start + marker.length);
  const next = remainder.search(/\n    (?:case \d+u:|default:)/);
  return next >= 0 ? remainder.slice(0, next) : remainder;
}

test("the playground registry exposes bounded typed modules with educational metadata", () => {
  assert.ok(SHADER_PLAYGROUND_MODULES.length >= 83);
  assert.equal(new Set(SHADER_PLAYGROUND_MODULES.map(({ id }) => id)).size, SHADER_PLAYGROUND_MODULES.length);
  assert.equal(new Set(SHADER_PLAYGROUND_MODULES.map(({ kind }) => kind)).size, SHADER_PLAYGROUND_MODULES.length);
  assert.ok(SHADER_PLAYGROUND_MODULES.some(({ id }) => id === "fm"));
  assert.ok(SHADER_PLAYGROUND_MODULES.some(({ id }) => id === "output"));
  const extendedPlayableModules = [
    "spectral-acid", "modal-metal", "particle-cloud", "vector-wavetable", "formant-bank", "procedural-kick",
    "sample-hold", "euclidean-gate", "hard-sync", "phase-distortion", "bytebeat", "chebyshev",
    "am-tremolo", "chord-arpeggiator", "euclidean-arpeggiator", "random-walk-arpeggiator",
    "additive-drawbar-organ", "supersaw", "chirp-sweep", "air-swoosh", "laser-woosh", "robot-voice",
    "analytic-plucked-string", "wave-terrain", "fractal-recurrence", "procedural-snare", "metallic-hi-hat",
    "clap-burst", "fof-voice", "full-wave-rectifier", "mid-side-width", "cyclic-fractal-noise",
    "bitmask-rhythm", "morph-crossfade", "harmonic-exciter", "cv-curve-mapper",
    "flanger", "chorus", "doppler-sweep", "fft-robotizer", "spectral-gate", "vibrato",
    "shepard-risset-spiral", "procedural-bird-flock", "thunder-impact-cell",
    "mirror-fold-sequencer", "sdf-orbit-sequencer", "polar-kaleidoscope-sequencer",
    "voronoi-cell-sequencer", "truchet-path-sequencer", "kifs-fold-sequencer",
    "interference-lattice-sequencer", "phase-plane", "tile-mirror-domain", "polar-fold-domain",
    "sdf-pattern-field", "sdf-logic", "interference-field", "voronoi-event-field", "truchet-router",
  ];
  assert.deepEqual(
    extendedPlayableModules.filter((id) => !SHADER_PLAYGROUND_MODULES.some((module) => module.id === id)),
    [],
  );

  for (const module of SHADER_PLAYGROUND_MODULES) {
    assert.ok(module.name && module.description && module.execution && module.wgsl, `${module.id} needs teaching metadata`);
    assert.ok(module.inputs.length <= SHADER_PLAYGROUND_LIMITS.maxInputs);
    assert.ok(module.params.length <= 8, `${module.id} exceeds the packed parameter limit`);
    assert.match(module.faust?.url ?? "", /^https:\/\/(?:faustdoc|faustlibraries)\.grame\.fr\//);
    for (const input of module.inputs) {
      assert.ok(input.types.length > 0, `${module.id}.${input.id} needs accepted signal types`);
    }
    for (const param of module.params) {
      assert.ok(param.min < param.max, `${module.id}.${param.id} needs a usable range`);
      assert.ok(param.default >= param.min && param.default <= param.max);
      assert.ok(param.low && param.high && param.behavior, `${module.id}.${param.id} needs sonic endpoint language`);
    }
  }
});

test("the graph utility expansion owns unique evaluator cases 66 through 68", () => {
  const expected = new Map([
    [66, "morph-crossfade"],
    [67, "harmonic-exciter"],
    [68, "cv-curve-mapper"],
  ]);
  for (const [kind, id] of expected) {
    assert.equal(SHADER_SYNTH_PLAYGROUND_EXTRA_MODULES.filter((module) => module.kind === kind).length, 1);
    assert.equal(SHADER_SYNTH_PLAYGROUND_EXTRA_MODULES.find((module) => module.kind === kind)?.id, id);
    assert.equal([...SHADER_SYNTH_PLAYGROUND_EXTRA_CASES.matchAll(new RegExp(`case ${kind}u:`, "g"))].length, 1);
    assert.match(SHADER_PLAYGROUND_SHADER, new RegExp(`case ${kind}u:`));
  }
});

test("geometry modules own kinds 69 through 83 and preserve composable X/Y or field/gate outputs", () => {
  const expectedIds = [
    "mirror-fold-sequencer", "sdf-orbit-sequencer", "polar-kaleidoscope-sequencer",
    "voronoi-cell-sequencer", "truchet-path-sequencer", "kifs-fold-sequencer",
    "interference-lattice-sequencer", "phase-plane", "tile-mirror-domain", "polar-fold-domain",
    "sdf-pattern-field", "sdf-logic", "interference-field", "voronoi-event-field", "truchet-router",
  ];
  assert.deepEqual(SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES.map(({ id }) => id), expectedIds);
  assert.deepEqual(SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES.map(({ kind }) => kind), Array.from({ length: 15 }, (_, index) => 69 + index));

  for (const module of SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES) {
    assert.equal([...SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES.matchAll(new RegExp(`case ${module.kind}u:`, "g"))].length, 1);
    assert.match(module.shaderSource?.url ?? "", /^https:\/\/(?:www\.)?(?:shadertoy\.com|thebookofshaders\.com)\//);
    assert.equal(module.outputs.length, 2);
    assert.equal(module.outputs[1].component, "y", `${module.id} must expose the packed Y output independently`);
    assert.equal(module.outputs.every(({ type }) => type === "control"), true);
    assert.equal(module.params.length <= 8, true);
  }

  for (const module of SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES.slice(0, 7)) {
    assert.deepEqual(module.outputs.map(({ id }) => id), ["pitch", "gate"]);
    assert.equal(module.auditionKind, "pitch-gate");
  }
  assert.deepEqual(
    SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES.slice(7, 10).map(({ outputs }) => outputs.map(({ id }) => id)),
    [["x", "y"], ["x", "y"], ["x", "y"]],
  );
  assert.equal(
    SHADER_SYNTH_PLAYGROUND_GEOMETRY_MODULES.slice(10).every(({ outputs }) => outputs[1].id === "gate"),
    true,
  );
});

test("geometric event fields use absolute time, bounded work, and explicit click-safe contour edges", () => {
  assert.doesNotMatch(SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES, /\bfwidth\s*\(/, "fragment derivatives are not valid in the compute pass");
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES, /phaseAtSample\(sampleIndex, baseRate \* ratio\)/);
  assert.match(evaluatorCase(78), /if \(radius > 0\.04\)/);
  assert.match(evaluatorCase(78), /angularStability = smoothstep\(0\.04, 0\.24, radius\)/);
  assert.doesNotMatch(evaluatorCase(70), /phase >= 0\.5/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES, /extraStepCoordinates\(sampleIndex,/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES, /smoothstep\(band, band \+ softness, abs\(distance\)\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES, /for \(var axis = 0u; axis < 12u;/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_CASES, /for \(var y: i32 = -1; y <= 1;/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS, /fn geometrySmoothMin/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS, /fn geometrySmoothMax/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS, /fn geometryShapeSize/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS, /fn geometryWrappedTurns/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS, /fn geometryCellIdentity/);
  assert.match(SHADER_SYNTH_PLAYGROUND_GEOMETRY_HELPERS, /bitcast<u32>\(cell\.x\)/);
});

test("the coordinate-field scene visibly wires packed X/Y through geometric processors", () => {
  const combo = SHADER_PLAYGROUND_COMBOS.find(({ id }) => id === "combo-228-folded-coordinate-weather");
  assert.ok(combo);
  const patch = createShaderPlaygroundCombo(combo.id);
  assert.equal(patch.nodes.length, 14);
  assert.equal(patch.connections.length, 22);
  for (const type of ["phase-plane", "tile-mirror-domain", "polar-fold-domain", "sdf-pattern-field", "sdf-logic", "interference-field"]) {
    assert.ok(patch.nodes.some((node) => node.type === type), `${type} should be visible in the composable geometry scene`);
  }
  const encoded = encodeShaderPlaygroundPatch(patch);
  const tileOffset = encoded.order.indexOf("tiles") * 20;
  assert.ok(encoded.data[tileOffset + 1] > 0, "X should use the packed vector's first component");
  assert.ok(encoded.data[tileOffset + 2] < 0, "Y should use the packed vector's second component");
  const unsafePitchSources = new Set(["logic", "moire"]);
  assert.equal(
    patch.connections.some(({ from, to }) => unsafePitchSources.has(from.node) && to.port === "pitch"),
    false,
    "continuous fields should use stateless phase/index modulation rather than t·f(t) pitch modulation",
  );
});

test("every starter patch is a valid audible DAG and encodes into the fixed GPU buffer", () => {
  assert.ok(SHADER_PLAYGROUND_PRESETS.length >= 9);
  for (const preset of SHADER_PLAYGROUND_PRESETS) {
    const patch = createShaderPlaygroundPatch(preset.id);
    const validation = validateShaderPlaygroundPatch(patch);
    assert.equal(validation.valid, true, `${preset.id}: ${validation.errors.join(" ")}`);
    assert.equal(validation.order.length, patch.nodes.length);
    assert.equal(patch.nodes.filter(({ type }) => type === "output").length, 1);
    assert.ok(patch.connections.length > 0, `${preset.id} must route a signal to output`);
    const encoded = encodeShaderPlaygroundPatch(patch);
    assert.equal(encoded.data.length, SHADER_PLAYGROUND_LIMITS.maxNodes * 20);
    assert.equal(encoded.nodeCount, patch.nodes.length);
    assert.ok(encoded.outputIndex >= 0 && encoded.outputIndex < encoded.nodeCount);

    const orderIndex = new Map(encoded.order.map((id, index) => [id, index]));
    for (const connection of patch.connections) {
      assert.ok(orderIndex.get(connection.from.node) < orderIndex.get(connection.to.node));
    }
  }

  const presetById = new Map(SHADER_PLAYGROUND_PRESETS.map((preset) => [preset.id, preset]));
  for (const id of ["gpu-organ-lanes", "simple-delay", "warm-vibrato", "choral-room", "spectral-bloom"]) {
    assert.ok(presetById.has(id), `${id} should be directly available as a starting point`);
  }
  assert.equal(presetById.get("gpu-organ-lanes").patch.nodes[0].type, "additive-drawbar-organ");
  assert.deepEqual(presetById.get("choral-room").patch.nodes.filter(({ type }) => ["chorus", "reverb"].includes(type)).map(({ type }) => type), ["chorus", "reverb"]);
  assert.deepEqual(presetById.get("spectral-bloom").patch.nodes.filter(({ type }) => ["spectral-resynth", "reverb"].includes(type)).map(({ type }) => type), ["spectral-resynth", "reverb"]);
});

test("the combination library provides at least 120 distinct, compact, audible graphs", () => {
  assert.ok(SHADER_PLAYGROUND_COMBOS.length >= 120);
  assert.equal(new Set(SHADER_PLAYGROUND_COMBOS.map(({ id }) => id)).size, SHADER_PLAYGROUND_COMBOS.length);
  assert.equal(new Set(SHADER_PLAYGROUND_COMBOS.map(({ name }) => name)).size, SHADER_PLAYGROUND_COMBOS.length);

  const audibleSources = new Set(SHADER_PLAYGROUND_MODULES
    .filter((module) => module.outputs.some(({ type }) => type === "audio" || type === "stereo"))
    .filter((module) => !module.inputs.some((input) => input.required
      && input.types.some((type) => type === "audio" || type === "stereo")))
    .map(({ id }) => id));
  const moduleTypesUsed = new Set();
  const patchFingerprints = new Set();
  const topologyFingerprints = new Set();
  const authoredTopologyFingerprints = new Set();

  for (const combo of SHADER_PLAYGROUND_COMBOS) {
    assert.match(combo.id, /^combo-\d{3}-[a-z0-9-]+$/);
    assert.ok(combo.name && combo.description && combo.family && combo.character);
    assert.match(combo.route, /[→⇢].*Output$/);
    assert.ok(combo.moduleTypes.length >= 3);
    assert.equal(combo.moduleTypes.length, combo.moduleNames.length);

    const patch = createShaderPlaygroundCombo(combo.id);
    const validation = validateShaderPlaygroundPatch(patch);
    assert.equal(validation.valid, true, `${combo.id}: ${validation.errors.join(" ")}`);
    const nodeLimit = combo.collection === "authored-scenes" ? SHADER_PLAYGROUND_LIMITS.maxNodes : 9;
    assert.ok(patch.nodes.length <= nodeLimit, `${combo.id} is too busy for the graph browser`);
    assert.equal(patch.nodes.filter(({ type }) => type === "output").length, 1);
    encodeShaderPlaygroundPatch(patch);

    const outgoing = new Map(patch.nodes.map(({ id }) => [id, []]));
    for (const connection of patch.connections) outgoing.get(connection.from.node)?.push(connection.to.node);
    const reachable = patch.nodes.filter(({ type }) => audibleSources.has(type)).map(({ id }) => id);
    const visited = new Set(reachable);
    while (reachable.length) {
      for (const next of outgoing.get(reachable.shift()) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          reachable.push(next);
        }
      }
    }
    const outputId = patch.nodes.find(({ type }) => type === "output").id;
    assert.ok(visited.has(outputId), `${combo.id} must route an audible source to Output`);

    for (const graphNode of patch.nodes) moduleTypesUsed.add(graphNode.type);
    patchFingerprints.add(JSON.stringify({
      nodes: patch.nodes.map(({ type, params }) => ({ type, params })),
      connections: patch.connections.map(({ from, to }) => ({ from, to })),
    }));
    const nodeIndex = new Map(patch.nodes.map(({ id }, index) => [id, index]));
    const topology = JSON.stringify({
      nodes: patch.nodes.map(({ type }) => type),
      connections: patch.connections.map(({ from, to }) => [
        nodeIndex.get(from.node), from.port, nodeIndex.get(to.node), to.port,
      ]),
    });
    topologyFingerprints.add(topology);
    if (combo.collection === "authored-scenes") authoredTopologyFingerprints.add(topology);
  }

  assert.equal(patchFingerprints.size, SHADER_PLAYGROUND_COMBOS.length);
  assert.ok(topologyFingerprints.size >= 40, "the library should contain substantially different graph architectures");
  assert.equal(SHADER_PLAYGROUND_COMBOS.filter(({ collection }) => collection === "authored-scenes").length, 28);
  assert.equal(authoredTopologyFingerprints.size, 28, "each authored scene needs its own graph topology");
  assert.deepEqual([...moduleTypesUsed].sort(), SHADER_PLAYGROUND_MODULES.map(({ id }) => id).sort());
  const extendedComboCoverage = SHADER_PLAYGROUND_COMBOS.slice(108, 120);
  assert.equal(extendedComboCoverage.length, 12);
  assert.deepEqual(
    extendedComboCoverage.map(({ id }) => id),
    [
      "combo-109-spectral-acid-sweep",
      "combo-110-modal-metal-strike",
      "combo-111-particle-cloud-drift",
      "combo-112-vector-wavetable-scan",
      "combo-113-formant-bank-vowel",
      "combo-114-procedural-kick-body",
      "combo-115-sample-hold-phase",
      "combo-116-euclidean-gate-pulse",
      "combo-117-hard-sync-sweep",
      "combo-118-phase-distortion-warp",
      "combo-119-bytebeat-code",
      "combo-120-chebyshev-series",
    ],
  );
  assert.ok(extendedComboCoverage.every(({ category }) => ["tonal", "rhythmic", "texture", "experimental"].includes(category)));
  assert.deepEqual(createShaderPlaygroundCombo(SHADER_PLAYGROUND_COMBOS[12].id), createShaderPlaygroundCombo(SHADER_PLAYGROUND_COMBOS[12].id));
});

test("stereo source Hear patches preserve their designed image", () => {
  for (const moduleId of ["shepard-risset-spiral", "procedural-bird-flock", "thunder-impact-cell"]) {
    const combo = SHADER_PLAYGROUND_COMBOS.find(({ name, moduleTypes }) => (
      name.endsWith("· Hear") && moduleTypes.includes(moduleId)
    ));
    assert.ok(combo, `${moduleId} needs a Hear patch`);
    const patch = createShaderPlaygroundCombo(combo.id);
    assert.ok(patch.nodes.some(({ type }) => type === "mid-side-width"));
    assert.ok(!patch.nodes.some(({ type }) => type === "pan"), `${moduleId} must not be collapsed to mono`);
  }
});

test("Hear patches expose optional inputs that materially shape their focus module", () => {
  const hearPatch = (moduleId) => {
    const combo = SHADER_PLAYGROUND_COMBOS.find(({ name, moduleTypes }) => (
      name.endsWith("· Hear") && moduleTypes.includes(moduleId)
    ));
    assert.ok(combo, `${moduleId} needs a Hear patch`);
    return createShaderPlaygroundCombo(combo.id);
  };
  const inputsTo = (patch, moduleId) => {
    const focus = patch.nodes.find(({ type }) => type === moduleId);
    assert.ok(focus, `${moduleId} needs a focus node`);
    return patch.connections
      .filter(({ to }) => to.node === focus.id)
      .map(({ from, to }) => ({ source: patch.nodes.find(({ id }) => id === from.node)?.type, port: to.port }));
  };

  for (const [moduleId, port] of [
    ["additive-drawbar-organ", "control"],
    ["robot-voice", "vowel"],
    ["fractal-recurrence", "control"],
    ["cyclic-fractal-noise", "control"],
  ]) {
    assert.deepEqual(inputsTo(hearPatch(moduleId), moduleId), [{ source: "lfo", port }]);
  }

  const exciter = hearPatch("harmonic-exciter");
  assert.deepEqual(inputsTo(exciter, "harmonic-exciter"), [
    { source: "oscillator", port: "signal" },
    { source: "lfo", port: "drive" },
  ]);
  assert.ok(exciter.nodes.find(({ type }) => type === "harmonic-exciter").params.cvDepth > 0);

  const morph = hearPatch("morph-crossfade");
  assert.deepEqual(inputsTo(morph, "morph-crossfade"), [
    { source: "oscillator", port: "a" },
    { source: "supersaw", port: "b" },
    { source: "lfo", port: "morph" },
  ]);
  assert.ok(morph.nodes.find(({ type }) => type === "morph-crossfade").params.cvDepth > 0);
  assert.ok(morph.nodes.length <= SHADER_PLAYGROUND_LIMITS.maxNodes);
  assert.equal(validateShaderPlaygroundPatch(morph).valid, true);
});

test("every shipped patch module contributes to its final output", () => {
  const patches = [
    ...SHADER_PLAYGROUND_PRESETS.map(({ id }) => [`preset:${id}`, createShaderPlaygroundPatch(id)]),
    ...SHADER_PLAYGROUND_COMBOS.map(({ id }) => [`combo:${id}`, createShaderPlaygroundCombo(id)]),
  ];

  for (const [patchId, patch] of patches) {
    const output = patch.nodes.find(({ type }) => type === "output");
    assert.ok(output, `${patchId} needs an Output node`);
    const incoming = new Map(patch.nodes.map(({ id }) => [id, []]));
    for (const connection of patch.connections) {
      incoming.get(connection.to.node)?.push(connection.from.node);
    }
    const contributing = new Set();
    const pending = [output.id];
    while (pending.length) {
      const nodeId = pending.pop();
      if (contributing.has(nodeId)) continue;
      contributing.add(nodeId);
      pending.push(...(incoming.get(nodeId) ?? []));
    }
    assert.deepEqual(
      patch.nodes.filter(({ id }) => !contributing.has(id)).map(({ id, type }) => `${id}:${type}`),
      [],
      `${patchId} contains a disconnected or inaudible module`,
    );
  }
});

test("the Shepard/Risset spiral integrates exponential phase across octave wraps", async () => {
  const source = await readFile(new URL("src/shader-synth-playground-found-sounds.js", ROOT), "utf8");
  assert.match(source, /fundamentalPhase = fract\(frequency \/ \(glideRate \* FOUND_LN_2\)\)/);
  assert.match(source, /octaveOffset \/ f32\(layerCount\) \+ rotation/);

  const sampleRate = 44100;
  const rate = 0.16;
  const render = (time) => {
    const layerCount = 7;
    const center = (layerCount - 1) * 0.5;
    const halfSpan = layerCount * 0.5;
    const glide = ((time * rate) % 1 + 1) % 1;
    let left = 0;
    let right = 0;
    let energy = 0;
    for (let layer = 0; layer < layerCount; layer += 1) {
      const octaveOffset = layer - center + glide - 0.5;
      const frequency = 82.41 * (2 ** octaveOffset);
      const window = Math.max(Math.cos((octaveOffset / halfSpan) * Math.PI * 0.5), 0) ** 1.45;
      const phase = frequency / (rate * Math.LN2);
      const tone = Math.sin(2 * Math.PI * (phase - Math.floor(phase)));
      const pan = Math.sin(2 * Math.PI * (octaveOffset / layerCount + 0.2)) * 0.72;
      const panAngle = (pan + 1) * Math.PI * 0.25;
      left += Math.cos(panAngle) * tone * window;
      right += Math.sin(panAngle) * tone * window;
      energy += window * window;
    }
    const normalization = Math.max(Math.sqrt(energy), 1);
    return [left / normalization, right / normalization];
  };
  const wrapTime = 1 / rate;
  const before = render(wrapTime - 1 / sampleRate);
  const after = render(wrapTime);
  assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) < 0.05);
});

test("typed patching accepts valid routes and rejects mismatches, occupied ports, and cycles", () => {
  const patch = createShaderPlaygroundPatch("pm-bell");
  const occupied = canConnectShaderPlaygroundPorts(
    patch,
    { node: "clock", port: "phase" },
    { node: "shape", port: "phase" },
  );
  assert.equal(occupied.valid, false);
  assert.match(occupied.reason, /already has a cable/i);

  const withoutPanControl = sanitizeShaderPlaygroundPatch({
    ...patch,
    connections: patch.connections.filter(({ to }) => !(to.node === "pan" && to.port === "position")),
  });
  const validControl = canConnectShaderPlaygroundPorts(
    withoutPanControl,
    { node: "shape", port: "out" },
    { node: "pan", port: "position" },
  );
  assert.equal(validControl.valid, true);

  const mismatch = canConnectShaderPlaygroundPorts(
    withoutPanControl,
    { node: "voice", port: "out" },
    { node: "pan", port: "position" },
  );
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.reason, /audio cannot feed control/i);

  const cycleCandidate = {
    ...withoutPanControl,
    connections: [
      ...withoutPanControl.connections.filter(({ to }) => !(to.node === "voice" && to.port === "index")),
      { id: "cycle", from: { node: "pan", port: "out" }, to: { node: "voice", port: "index" } },
    ],
  };
  const cycle = validateShaderPlaygroundPatch(cycleCandidate);
  assert.equal(cycle.valid, false);
  assert.match(cycle.errors.join(" "), /feedback|cycle/i);
});

test("one module output can fan out to independent downstream inputs", () => {
  const nodes = [
    { id: "source", type: "oscillator" },
    { id: "fold", type: "fold" },
    { id: "amp", type: "vca" },
    { id: "mix", type: "mix" },
    { id: "out", type: "output" },
  ];
  const connections = [
    { id: "source-fold", from: { node: "source", port: "out" }, to: { node: "fold", port: "signal" } },
    { id: "source-amp", from: { node: "source", port: "out" }, to: { node: "amp", port: "signal" } },
    { id: "fold-mix", from: { node: "fold", port: "out" }, to: { node: "mix", port: "a" } },
    { id: "amp-mix", from: { node: "amp", port: "out" }, to: { node: "mix", port: "b" } },
    { id: "mix-out", from: { node: "mix", port: "out" }, to: { node: "out", port: "signal" } },
  ];
  const patch = { nodes, connections };
  const withoutSecondBranch = { nodes, connections: connections.filter(({ id }) => id !== "source-amp") };

  assert.deepEqual(
    canConnectShaderPlaygroundPorts(
      withoutSecondBranch,
      { node: "source", port: "out" },
      { node: "amp", port: "signal" },
    ),
    { valid: true, reason: "Compatible ports." },
  );
  assert.equal(validateShaderPlaygroundPatch(patch).valid, true);

  const encoded = encodeShaderPlaygroundPatch(patch);
  const sourceSlot = encoded.order.indexOf("source") + 1;
  const foldOffset = encoded.order.indexOf("fold") * 20;
  const ampOffset = encoded.order.indexOf("amp") * 20;
  assert.equal(encoded.data[foldOffset + 1], sourceSlot);
  assert.equal(encoded.data[ampOffset + 1], sourceSlot);
});

test("editor layout keeps Output at the right edge when graph rows wrap", () => {
  const patch = createShaderPlaygroundPatch("moving-drone");
  const {
    nodeWidth, nodeHeight, marginX,
  } = SHADER_PLAYGROUND_LAYOUT_DEFAULTS;
  for (const width of [570, 710, 864]) {
    const layout = layoutShaderPlaygroundPatch(patch, { width, height: 640 });
    const positions = new Map(layout.map((position) => [position.id, position]));
    const output = patch.nodes.find(({ type }) => type === "output");
    const outputPosition = positions.get(output.id);
    const maximumX = Math.max(...layout.map(({ x }) => x));

    assert.equal(outputPosition.x, maximumX, `Output should be rightmost at ${width}px`);
    assert.equal(outputPosition.x + nodeWidth, width - marginX, `Output should meet the right layout margin at ${width}px`);
    assert.ok(layout.every(({ x }) => x >= marginX && x + nodeWidth <= width - marginX));
    for (let first = 0; first < layout.length; first += 1) {
      for (let second = first + 1; second < layout.length; second += 1) {
        const a = layout[first];
        const b = layout[second];
        const overlaps = a.x < b.x + nodeWidth && a.x + nodeWidth > b.x
          && a.y < b.y + nodeHeight && a.y + nodeHeight > b.y;
        assert.equal(overlaps, false, `${a.id} and ${b.id} should not overlap at ${width}px`);
      }
    }
  }
});

test("the graph editor shares a compact node footprint without shrinking touch targets", async () => {
  assert.deepEqual(SHADER_PLAYGROUND_LAYOUT_DEFAULTS, {
    nodeWidth: 150,
    nodeHeight: 96,
    gapX: 24,
    gapY: 20,
    marginX: 20,
    marginTop: 52,
    marginBottom: 20,
  });

  const [css, app, html] = await Promise.all([
    readFile(new URL("shader-synth-playground.css", ROOT), "utf8"),
    readFile(new URL("shader-synth-playground-app.js", ROOT), "utf8"),
    readFile(new URL("shader-synth-playground.html", ROOT), "utf8"),
  ]);
  assert.match(css, /\.patch-node\s*\{[\s\S]*?width: 150px;[\s\S]*?min-height: 60px;[\s\S]*?border-radius: 7px;/);
  assert.match(css, /\.node-header\s*\{[\s\S]*?min-height: 30px;[\s\S]*?padding: 5px 7px 4px;/);
  assert.match(css, /\.node-port\s*\{[\s\S]*?min-height: 18px;/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.node-port[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.patch-node\.is-selected\s*\{[\s\S]*?border-color: var\(--node-color, var\(--accent\)\)/);
  assert.match(app, /SHADER_PLAYGROUND_LAYOUT_DEFAULTS\.nodeWidth/);
  assert.match(app, /SHADER_PLAYGROUND_LAYOUT_DEFAULTS\.nodeHeight/);
  assert.match(html, /shader-synth-playground\.css\?v=20260829-compact-geometry-notes/);
});

test("three-way sum and product require and encode all three input slots", () => {
  for (const moduleId of ["sum-3", "product-3"]) {
    const module = SHADER_PLAYGROUND_MODULES.find(({ id }) => id === moduleId);
    assert.equal(module.inputs.length, 3);
    assert.deepEqual(module.inputs.map(({ id }) => id), ["a", "b", "c"]);
    assert.ok(module.inputs.every(({ required }) => required));

    const patch = {
      nodes: [
        { id: "source-a", type: "oscillator" },
        { id: "source-b", type: "noise" },
        { id: "source-c", type: "additive" },
        { id: "combine", type: moduleId },
        { id: "out", type: "output" },
      ],
      connections: [
        { id: "a", from: { node: "source-a", port: "out" }, to: { node: "combine", port: "a" } },
        { id: "b", from: { node: "source-b", port: "out" }, to: { node: "combine", port: "b" } },
        { id: "c", from: { node: "source-c", port: "out" }, to: { node: "combine", port: "c" } },
        { id: "out", from: { node: "combine", port: "out" }, to: { node: "out", port: "signal" } },
      ],
    };
    const encoded = encodeShaderPlaygroundPatch(patch);
    const combineOffset = encoded.order.indexOf("combine") * 20;
    assert.deepEqual(
      [...encoded.data.slice(combineOffset + 1, combineOffset + 4)],
      ["source-a", "source-b", "source-c"].map((id) => encoded.order.indexOf(id) + 1),
    );
    assert.equal(
      encoded.data[combineOffset + 3],
      encoded.order.indexOf("source-c") + 1,
      `${moduleId} must pack input C into GraphNode.header.w`,
    );
  }

  assert.match(SHADER_PLAYGROUND_SHADER, /readInput\(&targetValues, graphNode\.header\.w\)/);
  assert.match(SHADER_PLAYGROUND_SHADER, /case 34u:[\s\S]*inputC/);
  assert.match(SHADER_PLAYGROUND_SHADER, /case 35u:[\s\S]*inputC/);
});

test("the GPU arpeggiator packs pitch in x and gate in y for independent routing", () => {
  const arp = SHADER_PLAYGROUND_MODULES.find(({ id }) => id === "gpu-arp");
  assert.deepEqual(
    arp.outputs.map(({ id, type, component }) => ({ id, type, component })),
    [
      { id: "pitch", type: "control", component: "x" },
      { id: "gate", type: "control", component: "y" },
    ],
  );

  const patch = {
    nodes: [
      { id: "arp", type: "gpu-arp" },
      { id: "voice", type: "oscillator" },
      { id: "amp", type: "vca" },
      { id: "out", type: "output" },
    ],
    connections: [
      { id: "pitch", from: { node: "arp", port: "pitch" }, to: { node: "voice", port: "pitch" } },
      { id: "voice", from: { node: "voice", port: "out" }, to: { node: "amp", port: "signal" } },
      { id: "gate", from: { node: "arp", port: "gate" }, to: { node: "amp", port: "cv" } },
      { id: "out", from: { node: "amp", port: "out" }, to: { node: "out", port: "signal" } },
    ],
  };
  const encoded = encodeShaderPlaygroundPatch(patch);
  const arpSlot = encoded.order.indexOf("arp") + 1;
  const voiceOffset = encoded.order.indexOf("voice") * 20;
  const ampOffset = encoded.order.indexOf("amp") * 20;

  assert.equal(encoded.data[voiceOffset + 2], arpSlot, "pitch selects the positive/x source slot");
  assert.equal(encoded.data[ampOffset + 2], -arpSlot, "gate selects the negative/y source slot");
  assert.match(SHADER_PLAYGROUND_SHADER, /case 33u:[\s\S]*result = vec2<f32>\(pitch, attack \* release\)/);
});

test("GPU pattern controls reach 128 steps and every arpeggiator offers quarter tones", () => {
  const moduleById = new Map(SHADER_PLAYGROUND_MODULES.map((module) => [module.id, module]));
  const parameterFor = (moduleId, parameterId) => moduleById.get(moduleId)?.params.find(({ id }) => id === parameterId);

  for (const [moduleId, parameterId] of [
    ["euclidean-gate", "steps"],
    ["euclidean-gate", "pulses"],
    ["gpu-arp", "steps"],
    ["euclidean-arpeggiator", "steps"],
    ["euclidean-arpeggiator", "pulses"],
    ["random-walk-arpeggiator", "length"],
  ]) {
    assert.equal(parameterFor(moduleId, parameterId)?.max, 128, `${moduleId}.${parameterId}`);
  }
  assert.equal(parameterFor("euclidean-gate", "rotation")?.max, 127);
  assert.equal(parameterFor("euclidean-arpeggiator", "rotation")?.max, 127);
  assert.equal(parameterFor("bitmask-rhythm", "rotation")?.max, 15);

  for (const moduleId of ["gpu-arp", "euclidean-arpeggiator", "random-walk-arpeggiator"]) {
    const scale = parameterFor(moduleId, "scale");
    assert.equal(scale?.max, 6);
    assert.equal(scale?.options?.[6], "Quarter tone");
  }
  assert.equal(parameterFor("chord-arpeggiator", "transpose")?.step, 0.5);

  assert.match(SHADER_PLAYGROUND_SHADER, /case 6u:\s*\{ return 24u; \}/);
  assert.match(SHADER_PLAYGROUND_SHADER, /case 6u:\s*\{ tone = f32\(index\) \* 0\.5; \}/);
  assert.match(evaluatorCase(24), /clamp\(round\(p0\.y\), 2\.0, 128\.0\)/);
  assert.match(evaluatorCase(33), /clamp\(round\(p0\.y\), 2\.0, 128\.0\)/);
  assert.match(evaluatorCase(33), /clamp\(round\(p0\.w\), 0\.0, 6\.0\)/);
  assert.match(evaluatorCase(38), /clamp\(round\(p0\.y\), 2\.0, 128\.0\)/);
  assert.match(evaluatorCase(38), /clamp\(round\(p1\.x\), 0\.0, 6\.0\)/);
  assert.match(evaluatorCase(39), /clamp\(round\(p0\.y\), 2\.0, 128\.0\)/);
  assert.match(evaluatorCase(39), /clamp\(round\(p0\.z\), 0\.0, 6\.0\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_EXTRA_HELPERS, /position < 128u/);
  assert.match(SHADER_SYNTH_PLAYGROUND_EXTRA_HELPERS, /walkIndex < 128u/);

  const patch = createShaderPlaygroundPatch("simple-delay");
  const arp = patch.nodes.find(({ type }) => type === "gpu-arp");
  arp.params.steps = 128;
  arp.params.scale = 6;
  const encoded = encodeShaderPlaygroundPatch(patch);
  const offset = encoded.order.indexOf(arp.id) * 20;
  assert.equal(encoded.data[offset + 13], 128);
  assert.equal(encoded.data[offset + 15], 6);
});

test("ordered arpeggiators deterministically span the selected octave range", () => {
  const spanDegree = (position, positionCount, noteCount) => {
    if (positionCount <= 1 || noteCount <= 1) return 0;
    return Math.min(
      noteCount - 1,
      Math.floor((Math.min(position, positionCount - 1) * (noteCount - 1) + Math.floor((positionCount - 1) / 2)) / (positionCount - 1)),
    );
  };
  const ordered = (positionCount, scaleSize, octaves) => (
    Array.from({ length: positionCount }, (_, position) => spanDegree(position, positionCount, scaleSize * octaves))
  );

  const coreOneOctave = ordered(8, 7, 1);
  const coreFourOctaves = ordered(8, 7, 4);
  assert.deepEqual(coreFourOctaves, ordered(8, 7, 4), "the same GPU Arp settings must reproduce exactly");
  assert.notDeepEqual(coreOneOctave, coreFourOctaves, "GPU Arp Range must alter its ordered pitches");
  assert.equal(coreOneOctave.at(-1), 6);
  assert.equal(coreFourOctaves.at(-1), 27);

  const euclideanOneOctave = ordered(5, 7, 1);
  const euclideanFourOctaves = ordered(5, 7, 4);
  assert.deepEqual(euclideanFourOctaves, ordered(5, 7, 4), "the same Euclidean hit order must reproduce exactly");
  assert.notDeepEqual(euclideanOneOctave, euclideanFourOctaves, "Euclidean Arp Range must alter default five-hit pitches");
  assert.equal(euclideanFourOctaves.at(-1), 27);

  assert.match(SHADER_PLAYGROUND_SHADER, /fn arpSpanDegree\(position: u32, positionCount: u32, noteCount: u32\)/);
  assert.match(SHADER_PLAYGROUND_SHADER, /case 1u: \{ return arpSpanDegree\(length - 1u - position, length, noteCount\); \}/);
  assert.match(SHADER_PLAYGROUND_SHADER, /default: \{ return arpSpanDegree\(position, length, noteCount\); \}/);
  assert.match(evaluatorCase(38), /arpSpanDegree\(ordinal, pulses, noteCount\)/);
  assert.match(evaluatorCase(38), /arpSpanDegree\(nextOrdinal, pulses, noteCount\)/);
});

test("every direct-pass module parameter is consumed by its WGSL evaluator", () => {
  const components = ["p0.x", "p0.y", "p0.z", "p0.w", "p1.x", "p1.y", "p1.z", "p1.w"];
  const foundHelperByKind = new Map([
    [57, "foundShepardRisset"],
    [58, "foundBirdFlock"],
    [59, "foundThunderImpact"],
  ]);
  const directModules = SHADER_PLAYGROUND_MODULES.filter(({ kind }) => !isShaderSynthPlaygroundFxKind(kind));
  for (const module of directModules) {
    const helperName = foundHelperByKind.get(module.kind);
    const helperStart = helperName ? SHADER_SYNTH_PLAYGROUND_FOUND_HELPERS.indexOf(`fn ${helperName}(`) : -1;
    const helperEnd = helperStart >= 0
      ? SHADER_SYNTH_PLAYGROUND_FOUND_HELPERS.indexOf("\nfn ", helperStart + 4)
      : -1;
    const outputStart = module.id === "output"
      ? SHADER_SYNTH_PLAYGROUND_FX_SHADER.indexOf("fn finalizeOutput(")
      : -1;
    const outputEnd = outputStart >= 0
      ? SHADER_SYNTH_PLAYGROUND_FX_SHADER.indexOf("\nfn ", outputStart + 4)
      : -1;
    const body = outputStart >= 0
      ? SHADER_SYNTH_PLAYGROUND_FX_SHADER.slice(outputStart, outputEnd)
      : helperStart >= 0
        ? SHADER_SYNTH_PLAYGROUND_FOUND_HELPERS.slice(helperStart, helperEnd)
        : evaluatorCase(module.kind);
    const moduleComponents = module.id === "output" ? ["params.x", "params.y"] : components;
    module.params.forEach((parameter, index) => {
      assert.match(
        body,
        new RegExp(moduleComponents[index].replace(".", "\\.")),
        `${module.id}.${parameter.id} must affect its shader case through ${moduleComponents[index]}`,
      );
    });
  }
});

test("the additive drawbar organ restores nine editable GPU rank lanes", () => {
  const organ = SHADER_PLAYGROUND_MODULES.find(({ id }) => id === "additive-drawbar-organ");
  assert.ok(organ);
  assert.equal(organ.lanes.length, 9);
  assert.deepEqual(
    organ.lanes.map(({ row, controls }) => ({ row, controls: controls.map(({ id }) => id) })),
    Array.from({ length: 9 }, (_, row) => ({
      row,
      controls: ["ratio", "level", "amRate", "amDepth"],
    })),
  );
  assert.match(organ.execution, /9 external analytic rank lanes/i);
  assert.match(SHADER_PLAYGROUND_SHADER, /@group\(0\) @binding\(3\) var<storage, read> organ_rank: array<vec4<f32>>/);
  assert.match(SHADER_PLAYGROUND_SHADER, /case 40u:[\s\S]*organ_rank\[organRankOffset \+ rankIndex\]/);
  assert.match(SHADER_PLAYGROUND_SHADER, /organRampActive: u32/);
  assert.match(SHADER_PLAYGROUND_SHADER, /transitionActive = render_info\.rampActive != 0u \|\| render_info\.organRampActive != 0u/);
  assert.match(SHADER_PLAYGROUND_SHADER, /previousOrganRankOffset = select\(9u, 0u, render_info\.organRampActive != 0u\)/);

  const engine = new ShaderSynthPlaygroundAudio({});
  const writes = [];
  engine.device = { queue: { writeBuffer(_buffer, _offset, data) { writes.push(new Float32Array(data)); } } };
  engine.organRankBuffer = {};
  const ranks = engine.updateOrganRanks([{ ratio: 2, level: 0.5, amRate: 3, amDepth: 0.25 }]);
  assert.equal(ranks.length, 9);
  assert.equal(writes[0].length, 72, "the storage buffer packs nine previous rows followed by nine target rows");
  assert.deepEqual([...writes[0].slice(0, 4)], [...new Float32Array([0.5, 0.76, 0, 0])]);
  assert.deepEqual([...writes[0].slice(36, 40)], [2, 0.5, 3, 0.25]);
  assert.equal(engine.pendingOrganRankRamp, true);
});

test("history effects expose explicit core and extended kinds, bounded history helpers, and both GPU passes", () => {
  assert.deepEqual(SHADER_SYNTH_PLAYGROUND_FX_KINDS, {
    delay: 29,
    reverb: 30,
    recombobulator: 31,
    spectralResynth: 32,
    flanger: 60,
    chorus: 61,
    dopplerSweep: 62,
    fftRobotizer: 63,
    spectralGate: 64,
    vibrato: 65,
  });
  assert.deepEqual(
    SHADER_SYNTH_PLAYGROUND_FX_MODULES.map(({ id, kind }) => ({ id, kind })),
    [
      { id: "delay", kind: 29 },
      { id: "reverb", kind: 30 },
      { id: "recombobulator", kind: 31 },
      { id: "spectral-resynth", kind: 32 },
      { id: "flanger", kind: 60 },
      { id: "chorus", kind: 61 },
      { id: "doppler-sweep", kind: 62 },
      { id: "fft-robotizer", kind: 63 },
      { id: "spectral-gate", kind: 64 },
      { id: "vibrato", kind: 65 },
    ],
  );
  const historyKinds = [29, 30, 31, 32, 60, 61, 62, 63, 64, 65];
  for (const kind of historyKinds) assert.equal(isShaderSynthPlaygroundFxKind(kind), true);
  assert.equal(isShaderSynthPlaygroundFxKind(28), false);
  assert.equal(isShaderSynthPlaygroundFxKind(33), false);
  assert.equal(isShaderSynthPlaygroundFxKind(59), false);
  assert.deepEqual(SHADER_SYNTH_PLAYGROUND_FX_BINDINGS, {
    renderInfo: 0,
    graphNodes: 1,
    inputChunk: 2,
    soundChunk: 3,
    fxHistory: 4,
    stageInfo: 5,
  });
  assert.deepEqual(SHADER_SYNTH_PLAYGROUND_FX_LIMITS, {
    historySeconds: 12.5,
    delayRepeats: 6,
    delayTimeSeconds: 2,
    reverbTaps: 64,
    reverbSizeSeconds: 12,
    reverbPredelaySeconds: 0.4,
    recombobulatorHeads: 12,
    recombobulatorMemorySeconds: 12,
    spectralWindow: 128,
    spectralBins: 24,
    chorusVoices: 6,
    maxChainEffects: 3,
    historyRegions: 4,
  });

  const simpleDelay = SHADER_SYNTH_PLAYGROUND_FX_MODULES.find(({ id }) => id === "delay");
  const reverb = SHADER_SYNTH_PLAYGROUND_FX_MODULES.find(({ id }) => id === "reverb");
  const recombobulator = SHADER_SYNTH_PLAYGROUND_FX_MODULES.find(({ id }) => id === "recombobulator");
  const chorus = SHADER_SYNTH_PLAYGROUND_FX_MODULES.find(({ id }) => id === "chorus");
  const vibrato = SHADER_SYNTH_PLAYGROUND_FX_MODULES.find(({ id }) => id === "vibrato");
  assert.equal(simpleDelay.name, "Simple Delay");
  assert.equal(simpleDelay.auditionKind, "history");
  assert.equal(simpleDelay.params.find(({ id }) => id === "time").max, SHADER_SYNTH_PLAYGROUND_FX_LIMITS.delayTimeSeconds);
  assert.equal(reverb.params.find(({ id }) => id === "size").max, SHADER_SYNTH_PLAYGROUND_FX_LIMITS.reverbSizeSeconds);
  const reverbDecay = reverb.params.find(({ id }) => id === "decay");
  assert.deepEqual(
    {
      label: reverbDecay.label,
      min: reverbDecay.min,
      max: reverbDecay.max,
      default: reverbDecay.default,
      unit: reverbDecay.unit,
      scale: reverbDecay.scale,
    },
    { label: "Decay (RT60)", min: 0.1, max: 12, default: 3.6, unit: "s", scale: "log" },
  );
  assert.equal(reverb.params.find(({ id }) => id === "predelay").max, SHADER_SYNTH_PLAYGROUND_FX_LIMITS.reverbPredelaySeconds);
  assert.equal(recombobulator.params.find(({ id }) => id === "memory").max, SHADER_SYNTH_PLAYGROUND_FX_LIMITS.recombobulatorMemorySeconds);
  assert.equal(chorus.params.find(({ id }) => id === "depth").min, 0);
  for (const id of ["spectral-resynth", "fft-robotizer", "spectral-gate"]) {
    const spectralEffect = SHADER_SYNTH_PLAYGROUND_FX_MODULES.find((module) => module.id === id);
    const minimumWindow = spectralEffect.params.find((parameter) => parameter.id === "window").min;
    const maximumBins = spectralEffect.params.find((parameter) => parameter.id === "bins").max;
    assert.equal(minimumWindow, 64);
    assert.ok(Math.floor(minimumWindow / 2) - 1 >= maximumBins, `${id} exposes bins that its shortest window cannot analyze`);
  }
  assert.deepEqual(vibrato.params.map(({ id }) => id), ["rate", "depth", "delay", "mix", "stereo", "shape", "tone", "level"]);
  assert.equal(vibrato.params.find(({ id }) => id === "depth").unit, "cents");

  const longestPublicReadSeconds = Math.max(
    SHADER_SYNTH_PLAYGROUND_FX_LIMITS.delayTimeSeconds * SHADER_SYNTH_PLAYGROUND_FX_LIMITS.delayRepeats,
    SHADER_SYNTH_PLAYGROUND_FX_LIMITS.reverbSizeSeconds + SHADER_SYNTH_PLAYGROUND_FX_LIMITS.reverbPredelaySeconds,
    SHADER_SYNTH_PLAYGROUND_FX_LIMITS.recombobulatorMemorySeconds + 0.002,
  );
  assert.ok(SHADER_SYNTH_PLAYGROUND_FX_LIMITS.historySeconds > longestPublicReadSeconds);

  const historyFrames = shaderSynthPlaygroundFxHistoryFrames(48000, 4800);
  assert.equal(historyFrames, 1048576);
  assert.equal(historyFrames & (historyFrames - 1), 0, "history length remains a power of two");
  assert.ok(historyFrames >= 48000 * SHADER_SYNTH_PLAYGROUND_FX_LIMITS.historySeconds + 4800 + 2);
  assert.equal(
    shaderSynthPlaygroundFxHistoryByteSize(48000, 4800),
    historyFrames * SHADER_SYNTH_PLAYGROUND_FX_LIMITS.historyRegions * 2 * Float32Array.BYTES_PER_ELEMENT,
  );

  assert.match(SHADER_SYNTH_PLAYGROUND_HISTORY_CAPTURE_SHADER, /fn captureDryHistory/);
  assert.match(SHADER_SYNTH_PLAYGROUND_HISTORY_CAPTURE_SHADER, /historyFrames = arrayLength\(&fx_history\) \/ 4u/);
  assert.match(SHADER_SYNTH_PLAYGROUND_HISTORY_CAPTURE_SHADER, /fx_history\[\(render_info\.baseSample \+ sample\) % historyFrames\] = dry_chunk\[sample\]/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /fn processPostGraphFx/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /fn historyAt/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /fx_stage\.inputHistoryRegion/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /fn writeStageHistory/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /graph_nodes\[fx_stage\.nodeIndex\]/);
  for (const kind of historyKinds) {
    assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, new RegExp(`case ${kind}u:`));
    assert.match(SHADER_PLAYGROUND_SHADER, new RegExp(`case ${kind}u:`));
  }
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /fn vibratoEffect/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /pitchRatioExcursion = pow\(2\.0, cents \/ 1200\.0\) - 1\.0/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /baseDelay = clamp\(p0\.x, 0\.005, 2\.0\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /roomSize = clamp\(p0\.x, 0\.08, 12\.0\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /const LN_1000: f32 = 6\.907755278982137/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /decayTime = clamp\(p0\.y, 0\.1, 12\.0\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /predelay = clamp\(p1\.x, 0\.0, 0\.4\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /reflectionPosition = clamp\([\s\S]*?, 0\.001, 1\.0\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /reflectionSeconds = roomSize \* reflectionPosition/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /delaySeconds = predelay \+ reflectionSeconds/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /gain = exp\(-LN_1000 \* reflectionSeconds \/ decayTime\) \/ sqrt\(f32\(tap\)\)/);
  assert.doesNotMatch(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /LN_1000 \* delaySeconds/);
  assert.ok(Math.abs(Math.exp(-Math.log(1000)) - 0.001) < Number.EPSILON, "RT60 reaches -60 dB in amplitude");
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /memorySeconds = clamp\(p0\.x, 0\.02, 12\.0\)/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /tapPan = select\(-1\.0, 1\.0,[\s\S]*?\* stereoSpread/);
  assert.match(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /sharedPhase = randomPhase \* \(1\.0 - width\)/);
  assert.equal(
    SHADER_SYNTH_PLAYGROUND_FX_SHADER.match(/windowSize = u32\(clamp\(round\(p0\.x\), 64\.0, f32\(MAX_SPECTRAL_WINDOW\)\)\)/g)?.length,
    3,
  );
  assert.doesNotMatch(SHADER_SYNTH_PLAYGROUND_FX_SHADER, /windowSize = u32\(clamp\(round\(p0\.x\), 32\.0/);

  const encoded = encodeShaderPlaygroundPatch({
    nodes: [
      { id: "source", type: "oscillator" },
      { id: "delay", type: "delay" },
      { id: "room", type: "reverb" },
      { id: "out", type: "output" },
    ],
    connections: [
      { id: "source-delay", from: { node: "source", port: "out" }, to: { node: "delay", port: "signal" } },
      { id: "delay-room", from: { node: "delay", port: "out" }, to: { node: "room", port: "signal" } },
      { id: "room-out", from: { node: "room", port: "out" }, to: { node: "out", port: "signal" } },
    ],
  });
  assert.deepEqual(shaderSynthPlaygroundFxNodes(encoded).map(({ id }) => id), ["delay", "room"]);

  let packedStages;
  const stageBuffer = {};
  const engine = new ShaderSynthPlaygroundAudio({});
  engine.fxStageInfoStride = 16;
  engine.fxStageInfoBuffer = stageBuffer;
  engine.nodeBuffer = {};
  engine.device = {
    queue: {
      writeBuffer(buffer, _offset, data) {
        if (buffer === stageBuffer) packedStages = data.slice(0);
      },
    },
  };
  engine.updatePatch(encoded.patch);
  const stages = new DataView(packedStages);
  assert.equal(engine.fxStageCount, 2);
  assert.deepEqual(
    Array.from({ length: 2 }, (_, index) => [
      stages.getUint32(index * 16, true),
      stages.getUint32(index * 16 + 4, true),
      stages.getUint32(index * 16 + 8, true),
      stages.getUint32(index * 16 + 12, true),
    ]),
    [[1, 0, 1, 1], [2, 1, 2, 3]],
  );
});

test("every history-effect parameter is packed into and consumed from its matching WGSL slot", () => {
  const functionByModule = {
    delay: "delayEffect",
    reverb: "reverbEffect",
    recombobulator: "recombobulatorEffect",
    "spectral-resynth": "spectralResynthEffect",
    flanger: "flangerEffect",
    chorus: "chorusEffect",
    "doppler-sweep": "dopplerSweepEffect",
    "fft-robotizer": "fftRobotizerEffect",
    "spectral-gate": "spectralGateEffect",
    vibrato: "vibratoEffect",
  };
  const slotNames = ["p0.x", "p0.y", "p0.z", "p0.w", "p1.x", "p1.y", "p1.z", "p1.w"];

  for (const effect of SHADER_SYNTH_PLAYGROUND_FX_MODULES) {
    assert.equal(effect.params.length, 8, `${effect.id} must fill the packed p0/p1 vectors`);
    const requestedParams = Object.fromEntries(effect.params.map((parameter, index) => {
      const fraction = (index + 1) / 10;
      return [parameter.id, parameter.min + (parameter.max - parameter.min) * fraction];
    }));
    const patch = {
      nodes: [
        { id: "source", type: "oscillator" },
        { id: "effect", type: effect.id, params: requestedParams },
        { id: "out", type: "output" },
      ],
      connections: [
        { id: "source-effect", from: { node: "source", port: "out" }, to: { node: "effect", port: "signal" } },
        { id: "effect-out", from: { node: "effect", port: "out" }, to: { node: "out", port: "signal" } },
      ],
    };
    const sanitized = sanitizeShaderPlaygroundPatch(patch);
    const effectNode = sanitized.nodes.find(({ id }) => id === "effect");
    const targetValues = effect.params.map(({ id }) => effectNode.params[id]);
    const previousValues = targetValues.map((value, index) => value + (index + 1) * 0.0001);
    const encoded = encodeShaderPlaygroundPatch(sanitized, new Map([["effect", previousValues]]));
    const effectOffset = encoded.order.indexOf("effect") * 20;
    targetValues.forEach((value, index) => {
      assert.ok(Math.abs(encoded.data[effectOffset + 12 + index] - value) < 0.0001, `${effect.id}.${effect.params[index].id} target slot drifted`);
      assert.ok(Math.abs(encoded.data[effectOffset + 4 + index] - previousValues[index]) < 0.0001, `${effect.id}.${effect.params[index].id} previous slot drifted`);
    });

    const functionStart = SHADER_SYNTH_PLAYGROUND_FX_SHADER.indexOf(`fn ${functionByModule[effect.id]}(`);
    const functionEnd = SHADER_SYNTH_PLAYGROUND_FX_SHADER.indexOf("\nfn ", functionStart + 4);
    assert.ok(functionStart >= 0, `${effect.id} needs a WGSL effect function`);
    const functionSource = SHADER_SYNTH_PLAYGROUND_FX_SHADER.slice(functionStart, functionEnd);
    slotNames.forEach((slot, index) => {
      assert.ok(functionSource.includes(slot), `${effect.id}.${effect.params[index].id} is packed into ${slot} but never read by WGSL`);
    });
  }
});

test("history effects are rejected outside one terminal chain before Output", () => {
  const terminalPatch = {
    nodes: [
      { id: "source", type: "oscillator" },
      { id: "delay", type: "delay" },
      { id: "room", type: "reverb" },
      { id: "out", type: "output" },
    ],
    connections: [
      { id: "source-delay", from: { node: "source", port: "out" }, to: { node: "delay", port: "signal" } },
      { id: "delay-room", from: { node: "delay", port: "out" }, to: { node: "room", port: "signal" } },
      { id: "room-out", from: { node: "room", port: "out" }, to: { node: "out", port: "signal" } },
    ],
  };
  assert.equal(validateShaderPlaygroundPatch(terminalPatch).valid, true);

  const nonTerminalPatch = {
    nodes: [
      { id: "source", type: "oscillator" },
      { id: "delay", type: "delay" },
      { id: "fold", type: "fold" },
      { id: "out", type: "output" },
    ],
    connections: [
      { id: "source-delay", from: { node: "source", port: "out" }, to: { node: "delay", port: "signal" } },
      { id: "delay-fold", from: { node: "delay", port: "out" }, to: { node: "fold", port: "signal" } },
      { id: "fold-out", from: { node: "fold", port: "out" }, to: { node: "out", port: "signal" } },
    ],
  };
  const validation = validateShaderPlaygroundPatch(nonTerminalPatch);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /connected tail directly before Output/i);
  assert.match(validation.errors.join(" "), /must feed only the next history effect or Output/i);
  assert.throws(() => encodeShaderPlaygroundPatch(nonTerminalPatch), /connected tail directly before Output/i);
});

test("history-effect cable preflight rejects a nonterminal processor route", () => {
  const patch = {
    nodes: [
      { id: "source", type: "oscillator" },
      { id: "bend", type: "vibrato" },
      { id: "fold", type: "fold" },
      { id: "out", type: "output" },
    ],
    connections: [
      { id: "source-bend", from: { node: "source", port: "out" }, to: { node: "bend", port: "signal" } },
      { id: "fold-out", from: { node: "fold", port: "out" }, to: { node: "out", port: "signal" } },
    ],
  };
  const result = canConnectShaderPlaygroundPorts(
    patch,
    { node: "bend", port: "out" },
    { node: "fold", port: "signal" },
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /next history effect or Output/i);
});

test("the fully open Spectral Gate reconstructs a bin-centered in-band tone", () => {
  const body = SHADER_SYNTH_PLAYGROUND_FX_SHADER.match(
    /fn spectralGateEffect\([\s\S]*?\n\}/,
  )?.[0] ?? "";
  assert.match(body, /let basis = vec2<f32>\(cos\(angle\), sin\(angle\)\);/);
  assert.match(body, /let magnitudeScale = 2\.0 \/ f32\(windowSize\);/);
  assert.doesNotMatch(body, /0\.5 - 0\.5 \* cos/);

  const windowSize = 96;
  const binLimit = 20;
  const sourceBin = 5;
  const input = (sample) => Math.sin(Math.PI * 2 * sourceBin * sample / windowSize);
  const reconstructed = (sample) => {
    let value = 0;
    for (let bin = 1; bin <= binLimit; bin += 1) {
      let real = 0;
      for (let lag = 0; lag < windowSize; lag += 1) {
        real += input(sample - lag) * Math.cos(Math.PI * 2 * bin * lag / windowSize);
      }
      value += real * 2 / windowSize;
    }
    return value;
  };
  const sourceRms = Math.hypot(...Array.from({ length: windowSize }, (_, sample) => input(sample))) / Math.sqrt(windowSize);
  const wetRms = Math.hypot(...Array.from({ length: windowSize }, (_, sample) => reconstructed(sample))) / Math.sqrt(windowSize);
  assert.ok(Math.abs(wetRms / sourceRms - 1) < 1e-6);
});

test("validation rejects raw malformed cables and missing required inputs before sanitizing", () => {
  const patch = createShaderPlaygroundPatch("pm-bell");
  const cases = [
    {
      label: "self cable",
      candidate: {
        ...patch,
        connections: [
          ...patch.connections,
          { id: "self", from: { node: "voice", port: "out" }, to: { node: "voice", port: "index" } },
        ],
      },
      pattern: /itself/i,
    },
    {
      label: "duplicate destination",
      candidate: {
        ...patch,
        connections: [
          ...patch.connections,
          { id: "duplicate", from: { node: "clock", port: "phase" }, to: { node: "shape", port: "phase" } },
        ],
      },
      pattern: /already has a connection/i,
    },
    {
      label: "malformed endpoint",
      candidate: {
        ...patch,
        connections: [...patch.connections, { id: "malformed", from: { node: "clock" }, to: { node: "shape", port: "phase" } }],
      },
      pattern: /needs a source module, source port/i,
    },
    {
      label: "missing port",
      candidate: {
        ...patch,
        connections: [...patch.connections, { id: "bad-port", from: { node: "clock", port: "missing" }, to: { node: "pan", port: "position" } }],
      },
      pattern: /missing port/i,
    },
    {
      label: "unconnected output",
      candidate: {
        ...patch,
        connections: patch.connections.filter(({ to }) => to.node !== "out"),
      },
      pattern: /Output out requires a connection/i,
    },
    {
      label: "unconnected processor input",
      candidate: {
        ...patch,
        connections: patch.connections.filter(({ to }) => !(to.node === "vca" && to.port === "signal")),
      },
      pattern: /VCA vca requires a connection/i,
    },
  ];

  for (const { label, candidate, pattern } of cases) {
    const validation = validateShaderPlaygroundPatch(candidate);
    assert.equal(validation.valid, false, label);
    assert.match(validation.errors.join(" "), pattern, label);
  }

  const safelySanitized = sanitizeShaderPlaygroundPatch(cases[0].candidate);
  assert.equal(safelySanitized.connections.some(({ id }) => id === "self"), false);
});

test("patch sanitization clamps parameters and bounds graph size", () => {
  const excessive = {
    nodes: Array.from({ length: 40 }, (_, index) => ({
      id: `osc-${index}`,
      type: "oscillator",
      params: { frequency: index === 0 ? -100 : 999999, waveform: 99 },
    })),
    connections: [],
  };
  const patch = sanitizeShaderPlaygroundPatch(excessive);
  assert.equal(patch.nodes.length, SHADER_PLAYGROUND_LIMITS.maxNodes);
  assert.equal(patch.nodes[0].params.frequency, 30);
  assert.equal(patch.nodes[1].params.frequency, 4000);
  assert.equal(patch.nodes[0].params.waveform, 3);
});

test("the WGSL is a fixed sample-parallel graph interpreter with safe patch crossfades", () => {
  assert.match(SHADER_PLAYGROUND_SHADER, /var previousValues: array<vec2<f32>, 16>/);
  assert.match(SHADER_PLAYGROUND_SHADER, /var targetValues: array<vec2<f32>, 16>/);
  assert.match(SHADER_PLAYGROUND_SHADER, /switch kind/);
  assert.match(SHADER_PLAYGROUND_SHADER, /mix\(previousValues\[outputIndex\], targetValues\[outputIndex\], ramp\)/);
  assert.match(SHADER_PLAYGROUND_SHADER, /fn phaseAtSample/);
  assert.match(SHADER_PLAYGROUND_SHADER, /render_info\.baseSample \+ sample/);
  assert.match(SHADER_PLAYGROUND_SHADER, /performancePitch: f32/);
  assert.match(SHADER_PLAYGROUND_SHADER, /inputB\.x \+ render_info\.performancePitch/);
  assert.match(SHADER_PLAYGROUND_SHADER, /p0\.x \* exp2\(render_info\.performancePitch \/ 12\.0\)/);
  for (const kind of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 55]) {
    const body = SHADER_PLAYGROUND_SHADER.match(
      new RegExp(`case ${kind}u: \\{([\\s\\S]*?)\\n    \\}\\n    case`),
    )?.[1] ?? "";
    assert.match(body, /render_info\.performancePitch/, `pitched module kind ${kind} needs the live MIDI overlay`);
  }
  for (const helper of ["foundShepardRisset", "foundBirdFlock", "foundThunderImpact"]) {
    const body = SHADER_PLAYGROUND_SHADER.match(
      new RegExp(`fn ${helper}\\([\\s\\S]*?\\n\\}`),
    )?.[0] ?? "";
    assert.match(body, /render_info\.performancePitch/, `${helper} needs the live MIDI overlay`);
  }
  assert.match(SHADER_PLAYGROUND_SHADER, /1\.0 - smoothstep\(0\.985, 1\.0, phase\)/);
  assert.doesNotMatch(SHADER_PLAYGROUND_SHADER, /offsetSeconds|time \* hz|hz \* time/);
  assert.match(SHADER_PLAYGROUND_SHADER, /fn polyBlep/);
  assert.match(SHADER_PLAYGROUND_SHADER, /case 7u:[\s\S]*modulator \* index/);
  assert.match(SHADER_PLAYGROUND_SHADER, /case 16u:/);
  for (let kind = 17; kind <= 28; kind += 1) {
    assert.match(SHADER_PLAYGROUND_SHADER, new RegExp(`case ${kind}u:`), `module kind ${kind} needs a WGSL evaluator case`);
  }
  for (let kind = 36; kind <= 59; kind += 1) {
    assert.match(SHADER_PLAYGROUND_SHADER, new RegExp(`case ${kind}u:`), `module kind ${kind} needs a WGSL evaluator case`);
  }
  assert.match(SHADER_PLAYGROUND_SHADER, /for \(var partial = 1u; partial <= 48u;/);
  assert.match(SHADER_PLAYGROUND_SHADER, /fn bytebeatWord\(/);
  assert.match(SHADER_PLAYGROUND_SHADER, /fn chebyshevSeries\(/);
  assert.doesNotMatch(SHADER_PLAYGROUND_SHADER, /textureStore|atomicAdd/);
});

test("runtime support and the audio class report WebGPU and Web Audio independently", () => {
  assert.deepEqual(shaderPlaygroundSupport({}), { audio: false, webgpu: false, ready: false });
  const runtime = {
    AudioContext: class {},
    navigator: { gpu: { requestAdapter() {} } },
  };
  assert.deepEqual(shaderPlaygroundSupport(runtime), { audio: true, webgpu: true, ready: true });
  const engine = new ShaderSynthPlaygroundAudio(runtime, { chunkDuration: 0.001, workgroupSize: 999 });
  assert.equal(engine.chunkDuration, 0.03);
  assert.equal(engine.workgroupSize, 256);
  assert.equal(new ShaderSynthPlaygroundAudio(runtime).chunkDuration, 0.1);
  assert.equal(new ShaderSynthPlaygroundAudio(runtime, { chunkDuration: 99 }).chunkDuration, 0.5);
  assert.deepEqual(SHADER_PLAYGROUND_RUNTIME_DEFAULTS, {
    chunkDuration: 0.1,
    workgroupSize: 256,
    bufferedChunks: 2.5,
    schedulePadding: 0.05,
  });
});

test("clocks start straight and the reusable event contour closes before phase wraps", () => {
  const clockModule = SHADER_PLAYGROUND_MODULES.find(({ id }) => id === "clock");
  const swing = clockModule.params.find(({ id }) => id === "swing");
  const patch = createShaderPlaygroundPatch("pm-bell");
  const clock = patch.nodes.find(({ type }) => type === "clock");
  assert.equal(swing.default, 0);
  assert.equal(clock.params.swing, 0);
  assert.match(SHADER_PLAYGROUND_SHADER, /attack \* tail \* release/);
});

test("retriggered analytic voices close their decaying tails before event age wraps", () => {
  const modalCase = SHADER_PLAYGROUND_SHADER.match(/case 18u: \{[\s\S]*?\n    \}\n    case 19u:/)?.[0] ?? "";
  const kickCase = SHADER_PLAYGROUND_SHADER.match(/case 22u: \{[\s\S]*?\n    \}\n    case 23u:/)?.[0] ?? "";

  assert.match(modalCase, /eventProgress = f32\(eventSample\) \/ f32\(max\(periodSamples - 1u, 1u\)\)/);
  assert.match(modalCase, /release = 1\.0 - smoothstep\(0\.985, 1\.0, eventProgress\)/);
  assert.match(modalCase, /damping \* onset \* release \* bandGain/);
  assert.match(kickCase, /release = 1\.0 - smoothstep\(0\.985, 1\.0, eventPhase\)/);
  assert.match(kickCase, /\(body \+ click\) \* release/);
});

test("serial GPU readbacks retain exact sample offsets and gapless Web Audio start times", async () => {
  const starts = [];
  const renderedBaseSamples = [];
  const gainEvents = [];
  const context = {
    currentTime: 10,
    createBuffer(_channels, length, sampleRate) {
      const channels = [new Float32Array(length), new Float32Array(length)];
      return {
        duration: length / sampleRate,
        length,
        getChannelData(index) { return channels[index]; },
      };
    },
    createBufferSource() {
      return {
        connect() {},
        start(when) { starts.push(when); },
      };
    },
  };
  const engine = new ShaderSynthPlaygroundAudio({}, { chunkDuration: 0.1 });
  engine.context = context;
  engine.input = {};
  engine.master = {
    gain: {
      cancelScheduledValues(when) { gainEvents.push(["cancel", when]); },
      setValueAtTime(value, when) { gainEvents.push(["set", value, when]); },
      linearRampToValueAtTime(value, when) { gainEvents.push(["ramp", value, when]); },
    },
  };
  engine.running = true;
  engine.playbackEnabled = true;
  engine.sampleRate = 40;
  engine.chunkSamples = 4;
  engine.renderSampleOffset = 100;
  engine.renderOffset = 2.5;
  engine.nextStartTime = 10.06;
  engine.renderChunk = async (baseSample) => {
    renderedBaseSamples.push(baseSample);
    // Simulate a relatively slow serial dispatch + mapAsync readback. It is
    // slower than the old 45 ms default, but remains inside the 100 ms chunk.
    context.currentTime += 0.08;
    return new Float32Array(engine.chunkSamples * 2);
  };

  await engine.fillBuffer({ maxChunks: 4 });

  assert.deepEqual(renderedBaseSamples, [100, 104, 108, 112]);
  assert.equal(engine.renderSampleOffset, 116);
  assert.equal(starts.length, 4);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok(Math.abs(starts[index] - starts[index - 1] - 0.1) < 1e-9);
  }
  assert.deepEqual(
    engine.scheduledChunks.map(({ offset }) => offset),
    [2.5, 2.6, 2.7, 2.8],
  );
  assert.deepEqual(gainEvents, [
    ["cancel", starts[0]],
    ["set", 0, starts[0]],
    ["ramp", engine.output, starts[0] + 0.012],
  ]);
});

test("MIDI pitch refresh keeps the old queue audible until a rendered replacement can crossfade", async () => {
  const oldGainEvents = [];
  const newGainEvents = [];
  const masterGainEvents = [];
  const starts = [];
  const stops = [];
  let queueRequests = 0;
  let finishRender;
  let replacementSource;
  const gainNode = (events, value = 1) => ({
    gain: {
      value,
      cancelScheduledValues(time) { events.push(["cancel", time]); },
      cancelAndHoldAtTime(time) { events.push(["hold", time]); },
      setValueAtTime(next, time) { events.push(["set", next, time]); },
      linearRampToValueAtTime(next, time) { events.push(["ramp", next, time]); },
    },
    connect() {},
    disconnect() { events.push(["disconnect"]); },
  });
  const oldSource = { stop(time) { stops.push(["old", time]); } };
  const oldGain = gainNode(oldGainEvents);
  const context = {
    currentTime: 3,
    createGain() { return gainNode(newGainEvents); },
    createBuffer(_channels, length, sampleRate) {
      const channels = [new Float32Array(length), new Float32Array(length)];
      return {
        duration: length / sampleRate,
        getChannelData(index) { return channels[index]; },
      };
    },
    createBufferSource() {
      replacementSource = {
        connect() {},
        start(time) { starts.push(time); },
        stop(time) { stops.push(["new", time]); },
      };
      return replacementSource;
    },
  };
  const engine = new ShaderSynthPlaygroundAudio({});
  engine.context = context;
  engine.input = {};
  engine.master = {
    gain: {
      value: 0.7,
      cancelAndHoldAtTime(time) { masterGainEvents.push(["hold", time]); },
      linearRampToValueAtTime(value, time) { masterGainEvents.push(["ramp", value, time]); },
    },
  };
  engine.running = true;
  engine.playbackEnabled = true;
  engine.sampleRate = 40;
  engine.chunkSamples = 4;
  engine.renderSampleOffset = 100;
  engine.sources.add(oldSource);
  engine.sourceGains.set(oldSource, oldGain);
  engine.scheduledChunks = [{ source: oldSource, startAt: 3, endAt: 3.5 }];
  engine.queueFill = () => { queueRequests += 1; };
  engine.renderChunk = () => new Promise((resolve) => { finishRender = resolve; });

  assert.equal(engine.setPerformancePitch(7, { refresh: true }), 7);
  assert.equal(engine.performancePitch, 7);
  assert.equal(engine.queueGeneration, 1);
  assert.deepEqual(oldGainEvents, [], "refresh must not fade the audible queue before GPU readback");
  assert.deepEqual(masterGainEvents, [], "pitch refresh must not gate the master/play state");
  assert.deepEqual(stops, [], "refresh must not stop queued audio before its replacement exists");
  assert.equal(engine.scheduledChunks.length, 1);
  assert.equal(queueRequests, 1);

  engine.setPerformancePitch(7, { refresh: true });
  assert.equal(engine.queueGeneration, 1, "repeating one note must not churn the render queue");
  assert.equal(queueRequests, 1);

  const fill = engine.fillBuffer({ forceFirstChunk: true, maxChunks: 1 });
  await Promise.resolve();
  assert.deepEqual(oldGainEvents, [], "a slow in-flight render keeps prior audio at full gain");
  context.currentTime = 3.08;
  finishRender(new Float32Array(engine.chunkSamples * 2));
  await fill;

  assert.equal(starts.length, 1);
  const handoffStart = starts[0];
  const handoffEnd = handoffStart + 0.012;
  assert.ok(Math.abs(handoffStart - 3.092) < 1e-9);
  assert.deepEqual(oldGainEvents, [
    ["hold", handoffStart],
    ["ramp", 0, handoffEnd],
  ]);
  assert.deepEqual(newGainEvents, [
    ["cancel", handoffStart],
    ["set", 0, handoffStart],
    ["ramp", 1, handoffEnd],
  ]);
  assert.deepEqual(stops, [], "faded buffers may end naturally so rapid retunes can supersede automation safely");
  assert.equal(engine.pendingQueueHandoff, null);
  assert.equal(engine.playbackEnabled, true);
  assert.deepEqual(engine.scheduledChunks.map(({ generation }) => generation), [undefined, 1]);

  replacementSource.onended();
  assert.equal(engine.sources.has(replacementSource), false);
  assert.equal(engine.sourceGains.has(replacementSource), false);
  assert.deepEqual(newGainEvents.at(-1), ["disconnect"]);
});

test("rapid parameter edits continue from each rendered intermediate target", () => {
  const initial = createShaderPlaygroundPatch("pm-bell");
  const firstEdit = createShaderPlaygroundPatch("pm-bell");
  const latestEdit = createShaderPlaygroundPatch("pm-bell");
  firstEdit.nodes.find(({ id }) => id === "voice").params.frequency = 220;
  latestEdit.nodes.find(({ id }) => id === "voice").params.frequency = 330;

  const writes = [];
  const engine = new ShaderSynthPlaygroundAudio({});
  engine.device = {
    queue: {
      writeBuffer(_buffer, _offset, data) { writes.push(new Float32Array(data)); },
    },
  };
  engine.nodeBuffer = {};
  engine.previousParams = encodeShaderPlaygroundPatch(initial).paramsByNode;
  engine.updatePatch(firstEdit);
  const firstRevision = engine.patchRevision;
  const firstRenderedParams = engine.encodedPatch.paramsByNode;
  engine.updatePatch(latestEdit);

  const voiceOffset = engine.encodedPatch.order.indexOf("voice") * 20;
  assert.ok(Math.abs(engine.encodedPatch.data[voiceOffset + 4] - 164.81) < 0.001);
  assert.equal(engine.encodedPatch.data[voiceOffset + 12], 330);

  engine.commitRamp(firstRevision, firstRenderedParams, true);
  assert.equal(engine.pendingRamp, true);
  assert.equal(engine.previousParams.get("voice")[0], 220);
  assert.equal(engine.encodedPatch.data[voiceOffset + 4], 220);
  assert.equal(engine.encodedPatch.data[voiceOffset + 12], 330);

  const latestRevision = engine.patchRevision;
  const latestRenderedParams = engine.encodedPatch.paramsByNode;
  engine.commitRamp(latestRevision, latestRenderedParams, true);
  assert.equal(engine.pendingRamp, false);
  assert.equal(engine.previousParams.get("voice")[0], 330);
  assert.equal(writes.at(-1)[voiceOffset + 4], 330);
  assert.equal(writes.at(-1)[voiceOffset + 12], 330);
});

test("live patch edits replace one future queue boundary without touching master transport", () => {
  const engine = new ShaderSynthPlaygroundAudio({});
  const initial = createShaderPlaygroundPatch("pm-bell");
  const edit = createShaderPlaygroundPatch("pm-bell");
  edit.nodes.find(({ id }) => id === "voice").params.frequency = 220;
  engine.previousParams = encodeShaderPlaygroundPatch(initial).paramsByNode;
  engine.encodedPatch = encodeShaderPlaygroundPatch(initial, engine.previousParams);
  engine.patch = initial;
  engine.running = true;
  engine.context = { currentTime: 2 };
  engine.sampleRate = 1000;
  engine.chunkDuration = 0.1;
  const oldSources = [{}, {}, {}];
  oldSources.forEach((source) => engine.sources.add(source));
  engine.scheduledChunks = [
    { source: oldSources[0], generation: 0, offset: 8.0, startAt: 2.02, endAt: 2.12 },
    { source: oldSources[1], generation: 0, offset: 8.1, startAt: 2.12, endAt: 2.22 },
    { source: oldSources[2], generation: 0, offset: 8.2, startAt: 2.22, endAt: 2.32 },
  ];
  let queueRequests = 0;
  engine.queueFill = () => { queueRequests += 1; };

  engine.updatePatch(edit);
  assert.equal(engine.queueGeneration, 1);
  assert.equal(engine.renderSampleOffset, 8100, "replacement renders the first safe future chunk's timeline");
  assert.equal(engine.nextStartTime, 2.12);
  assert.equal(engine.pendingQueueHandoff.generation, 1);
  assert.deepEqual([...engine.pendingQueueHandoff.sources], oldSources);
  assert.equal(queueRequests, 1);
  assert.equal(engine.playbackEnabled, false, "a live edit cannot toggle transport");

  edit.nodes.find(({ id }) => id === "voice").params.frequency = 330;
  engine.updatePatch(edit);
  assert.equal(engine.queueGeneration, 1, "rapid edits coalesce instead of starving an in-flight replacement");
  assert.equal(queueRequests, 2);
  assert.equal(engine.deferredQueueRefresh, true);

  for (let frequency = 340; frequency <= 440; frequency += 10) {
    edit.nodes.find(({ id }) => id === "voice").params.frequency = frequency;
    engine.updatePatch(edit);
  }
  assert.equal(engine.queueGeneration, 1, "a drag cannot repeatedly invalidate the handoff generation");

  engine.pendingQueueHandoff = null;
  engine.deferredQueueRefresh = false;
  engine.renderingPromise = Promise.resolve();
  for (let frequency = 450; frequency <= 550; frequency += 10) {
    edit.nodes.find(({ id }) => id === "voice").params.frequency = frequency;
    engine.updatePatch(edit);
  }
  assert.equal(engine.queueGeneration, 1, "events during a GPU fill defer one refresh rather than discarding the fill");
  assert.equal(engine.deferredQueueRefresh, true);
});

test("organ-rank transitions commit the bank that rendered while preserving newer edits", () => {
  const writes = [];
  const engine = new ShaderSynthPlaygroundAudio({});
  engine.device = {
    queue: {
      writeBuffer(_buffer, _offset, data) { writes.push(new Float32Array(data)); },
    },
  };
  engine.organRankBuffer = {};
  const edit = (ratio) => engine.organRanks.map((rank, index) => (
    index === 0 ? { ...rank, ratio } : rank
  ));

  engine.updateOrganRanks(edit(2));
  const renderedRanks = engine.organRanks;
  const renderedRevision = engine.organRankRevision;
  engine.updateOrganRanks(edit(3));

  assert.equal(writes.at(-1)[0], 0.5, "rapid edits retain the last rendered bank as their starting point");
  assert.equal(writes.at(-1)[36], 3);
  engine.commitOrganRankRamp(renderedRevision, renderedRanks, true);
  assert.equal(engine.previousOrganRanks[0].ratio, 2, "completion advances to the target actually submitted");
  assert.equal(engine.organRanks[0].ratio, 3, "the newer editor target is preserved");
  assert.equal(engine.pendingOrganRankRamp, true);
  assert.equal(writes.at(-1)[0], 2);
  assert.equal(writes.at(-1)[36], 3);

  engine.commitOrganRankRamp(engine.organRankRevision, engine.organRanks, true);
  assert.equal(engine.pendingOrganRankRamp, false);
  assert.equal(writes.at(-1)[0], 3);
  assert.equal(writes.at(-1)[36], 3, "a settled transition uploads identical previous and target banks");

  const stableRevision = engine.organRankRevision;
  const stableRanks = engine.organRanks;
  engine.updateOrganRanks(edit(4));
  engine.commitOrganRankRamp(stableRevision, stableRanks, false);
  assert.equal(engine.previousOrganRanks[0].ratio, 3, "a chunk dispatched before an edit must not commit that edit");
  assert.equal(engine.pendingOrganRankRamp, true);
  assert.equal(writes.at(-1)[0], 3);
  assert.equal(writes.at(-1)[36], 4);
});

test("waveform callbacks are playback-aligned and cannot stop the audio renderer", () => {
  let scheduled;
  const reported = [];
  const runtime = {
    setTimeout(callback, delay) {
      scheduled = { callback, delay };
      return 17;
    },
    console: { error(...args) { reported.push(args); } },
  };
  const engine = new ShaderSynthPlaygroundAudio(runtime);
  engine.context = { currentTime: 4 };
  engine.running = true;
  engine.setChunkHandler(() => { throw new Error("scope failed"); });
  engine.queueChunkVisualization(new Float32Array([0.1, -0.1]), { startAt: 4.08 });
  assert.ok(scheduled.delay >= 79 && scheduled.delay <= 81);
  scheduled.callback();
  assert.equal(engine.running, true);
  assert.equal(engine.visualTimers.size, 0);
  assert.equal(reported.length, 1);
});

test("dynamic pattern-control ceilings follow Steps without changing registry limits", async () => {
  const app = await readFile(new URL("shader-synth-playground-app.js", ROOT), "utf8");
  const maximumSource = app.match(/function dynamicParameterMaximum\(moduleId, paramId, steps, specMaximum\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(maximumSource);
  const dynamicParameterMaximum = Function(`"use strict"; return (${maximumSource});`)();

  assert.equal(dynamicParameterMaximum("euclidean-gate", "pulses", 7, 128), 7);
  assert.equal(dynamicParameterMaximum("euclidean-gate", "rotation", 7, 127), 6);
  assert.equal(dynamicParameterMaximum("euclidean-arpeggiator", "pulses", 3, 128), 3);
  assert.equal(dynamicParameterMaximum("euclidean-arpeggiator", "rotation", 3, 127), 2);
  assert.equal(dynamicParameterMaximum("bitmask-rhythm", "rotation", 1, 15), 0);
  assert.equal(dynamicParameterMaximum("bitmask-rhythm", "rotation", 16, 15), 15);
  assert.equal(dynamicParameterMaximum("gpu-arp", "steps", 4, 128), 128);

  assert.match(app, /constrainDependentNodeParameters\(node, module\)[\s\S]*?clamp\(current, effective\.min, effective\.max\)/);
  assert.match(app, /param\.id === "steps"[\s\S]*?isStepDependentParameter[\s\S]*?syncParameterControlSurfaces/);
  assert.match(app, /module\.params\.map\(\(rawParam, index\) => \{[\s\S]*?effectiveParameterDescriptor/);
  assert.match(app, /for \(const rawParam of module\.params\)[\s\S]*?effectiveParameterDescriptor/);
});

test("the page exposes a real graph editor, inspector, transport, and shared instrument header", async () => {
  const [html, css, app, primitives, synth] = await Promise.all([
    readFile(new URL("shader-synth-playground.html", ROOT), "utf8"),
    readFile(new URL("shader-synth-playground.css", ROOT), "utf8"),
    readFile(new URL("shader-synth-playground-app.js", ROOT), "utf8"),
    readFile(new URL("webgpu-dsp-primitives.html", ROOT), "utf8"),
    readFile(new URL("webgpu-synths.html", ROOT), "utf8"),
  ]);
  for (const id of [
    "audioButton", "playgroundPlayButton", "modulePalette", "graphViewport", "patchCables", "patchNodes",
    "nodeInspector", "nodeControls", "parameterResponseCanvas", "parameterBehavior", "selectedNodeShader", "scopeCanvas",
    "presetButtons", "organRankSection", "organRankControls", "resetOrganRanks",
    "patchControlsPanel", "patchControls", "patchControlCount",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /<title>Modular Shader Synth — Morphazoid<\/title>/);
  assert.match(html, /<nav class="tabs" aria-label="Instrument">/);
  assert.match(html, /href="shader-synth-playground\.html" aria-current="page">modular shader synth<\/a>/);
  assert.match(html, /class="mobile-instrument-select" aria-label="Instrument"/);
  assert.match(html, /<option value="shader-synth-playground\.html" selected>modular shader synth<\/option>/);
  assert.match(html, /class="audio-strip playground-transport" aria-label="Audio controls"/);
  assert.match(html, /class="synth-play-button playground-play-button" id="playgroundPlayButton"/);
  assert.doesNotMatch(html, /class="transport-(?:play|pause)"/);
  assert.doesNotMatch(css, /\.playground-play-button\s+svg/);
  assert.match(html, /src=["']nav\.js["']/);
  assert.match(html, /href=["']webgpu-dsp-primitives\.html["']/);
  assert.match(primitives, /href=["']shader-synth-playground\.html["']/);
  assert.match(synth, /href=["']shader-synth-playground\.html["']/);
  assert.doesNotMatch(html, /01\s*·\s*BUILD|02\s*·\s*PATCH|03\s*·\s*HEAR THE CHANGE/);
  assert.doesNotMatch(`${html}\n${css}`, /playground-(?:masthead|context|related-links)/);
  assert.match(css, /\.patch-node/);
  assert.match(css, /\.patch-cable/);
  assert.match(css, /\.patch-node\.is-selected/);
  assert.match(css, /\.selected-module-heading::after/);
  assert.match(html, /<details class="patch-controls-panel" id="patchControlsPanel" open>/);
  assert.match(css, /\.patch-controls\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y: auto/);
  assert.match(css, /\.patch-control-module/);
  assert.match(css, /\.patch-knob-control input\[type="range"\]/);
  assert.match(css, /\.patch-knob-control:focus-within \.patch-knob-dial/);
  assert.match(css, /\.patch-organ-ranks/);
  assert.match(css, /\.patch-organ-rank-knobs/);
  assert.match(app, /function renderPatchControls\(\)/);
  assert.match(app, /for \(const param of module\.params\)/);
  assert.match(app, /input\.dataset\.nodeId = node\.id/);
  assert.match(app, /input\.dataset\.paramId = param\.id/);
  assert.match(app, /function updateNodeParameter\(input\)[\s\S]*?resolveParameterTarget\(input, patchNodes\(\), moduleForNode\)/);
  assert.match(app, /node\.params\[param\.id\] = value/);
  assert.match(app, /\$\("patchControls"\)\.addEventListener\("input"[\s\S]*?updateNodeParameter\(event\.target\)/);
  assert.match(app, /syncParameterControlSurfaces\(node, param, value\)/);
  assert.match(app, /parameterCount \+= WEBGPU_SYNTHS_ORGAN_RANK_COUNT \* ORGAN_RANK_FIELDS\.length/);
  assert.match(app, /function createPatchOrganRankControls\(module, node\)/);
  assert.match(app, /state\.organRanks\.forEach\(\(rank, rankIndex\) =>/);
  assert.match(app, /for \(const field of ORGAN_RANK_FIELDS\)/);
  assert.match(app, /\$\("patchControls"\)\.addEventListener\("input"[\s\S]*?updateOrganRankParameter\(event\.target\)/);
  assert.match(app, /function syncOrganRankControlSurfaces\(rankIndex, field\)[\s\S]*?querySelectorAll\("input\[data-organ-rank\]\[data-organ-rank-field\]"\)/);
  assert.match(app, /resetOrganRanks[\s\S]*?syncAllOrganRankControlSurfaces\(\)/);
  assert.match(app, /matchMedia\?\.\("\(max-width: 720px\)"\)\?\.matches[\s\S]*?patchControlsPanel[\s\S]*?open = false/);
  const resolverSource = app.match(/function resolveParameterTarget\(input, nodes, moduleLookup\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(resolverSource, "the shared control event resolver must remain directly testable");
  const resolveParameterTarget = Function(`"use strict"; return (${resolverSource});`)();
  const firstNode = { id: "first" };
  const secondNode = { id: "second" };
  const firstModule = { params: [{ id: "rate" }] };
  const secondModule = { params: [{ id: "rate" }, { id: "tone" }] };
  const moduleByNode = new Map([[firstNode, firstModule], [secondNode, secondModule]]);
  const target = resolveParameterTarget(
    { dataset: { nodeId: "second", paramId: "rate" } },
    [firstNode, secondNode],
    (node) => moduleByNode.get(node),
  );
  assert.equal(target.node, secondNode, "a patch-wide control updates its own node, even when parameter IDs repeat");
  assert.equal(target.module, secondModule);
  assert.equal(target.param, secondModule.params[0]);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.patch-nodes/);
  assert.match(app, /dataset\.addModule/);
  assert.match(app, /dataset\.portId/);
  assert.match(app, /setAttribute\("aria-current", "true"\)/);
  assert.match(app, /SHADER_PLAYGROUND_RUNTIME_DEFAULTS\.chunkDuration/);
  assert.match(app, /parameterResponseCanvas/);
  assert.match(app, /module\.aliases/);
  assert.match(app, /module\.tags/);
  assert.match(app, /updateOrganRanks/);
  assert.match(html, /GPU harmonic lanes/);
  assert.match(css, /\.organ-rank-row/);
  assert.match(app, /setChunkHandler/);
  assert.match(app, /viewMode: spatialGraphAvailable\(\) \? "patch" : "chain"/);
  assert.match(app, /textContent = "Patch view"/);
  assert.match(app, /header\.setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(html, /Headers move · ports patch/);
  assert.match(app, /select\.id = "patchSelect"/);
  assert.match(app, /select\.name = "preset"/);
  assert.match(app, /appendPatchOptions\(select, "Starting points"/);
  assert.match(app, /appendPatchOptions\(select, "Authored scenes"/);
  assert.match(app, /appendPatchOptions\(select, "Variations"/);
  assert.doesNotMatch(html, /id=["']comboLibraryButton["']/);
  assert.match(html, /id="gpuChunkDuration">~100 ms chunk<\/output>/);
  assert.match(html, /id="gpuChunkSampleCount">4,410 samples @ 44\.1 kHz<\/output>/);
  assert.match(html, /id="gpuLookaheadDuration">~300 ms queued<\/output>/);
  assert.doesNotMatch(`${app}\n${html}`, /createOscillator\s*\(/);
  assert.match(html, /id="performanceNotesTitle">Play notes<\/b>/);
  assert.match(html, /id="performanceNoteButtons"[^>]*aria-label="Play notes from C3 to C4"/);
  assert.match(html, /id="performanceOctaveDown"/);
  assert.match(html, /id="performanceOctaveUp"/);
  assert.match(html, /id="midiNoteState"[^>]*>C3<\/output>/);
  assert.match(html, /id="performanceNoteHint">Click to start · MIDI on: Z–M \/ Q–U<\/p>/);
  assert.match(html, /id="playgroundPlayLabel">Run patch<\/span>/);
  assert.match(css, /\.performance-notes\s*\{/);
  assert.match(css, /\.performance-note-buttons\s*\{[\s\S]*?grid-template-columns: repeat\(7,/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.performance-notes\s*\{[\s\S]*?width: 100%/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.performance-note,[\s\S]*?min-height: 44px/);
  assert.match(app, /function renderPerformanceNoteButtons\(\)/);
  assert.match(app, /async function auditionPerformanceNote\(note\)[\s\S]*?startAudio\(\{ play: true \}\)/);
  assert.match(app, /performanceNoteButtons[\s\S]*?data-performance-note/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /MIDI_PATCH_ROOT_NOTE = 48/);
  assert.match(app, /setPerformancePitch\?\.\(performancePitch, \{ refresh \}\)/);
  assert.match(app, /MIDI note input is a pitch-only performance overlay/);
  assert.match(app, /Playback stays where it is/);
  assert.doesNotMatch(app, /midiVelocityGain/);
  const midiNoteHandlers = app.slice(
    app.indexOf("function handleMidiNoteOn"),
    app.indexOf("function handleMidiControlChange"),
  );
  assert.doesNotMatch(midiNoteHandlers, /state\.playing|setPlaybackEnabled|setOutput|startAudio/);
  assert.match(midiNoteHandlers, /applyMidiPerformance\(\)/);
  assert.doesNotMatch(html, /minus and plus change velocity/i);
});
