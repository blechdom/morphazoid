const freeze = (value) => Object.freeze(value);

export const SHADER_PLAYGROUND_SCENE_RANGE = freeze({
  first: 121,
  last: 140,
  count: 20,
});

const HISTORY_EFFECT_IDS = new Set([
  "delay",
  "reverb",
  "recombobulator",
  "spectral-resynth",
  "flanger",
  "chorus",
  "doppler-sweep",
  "fft-robotizer",
  "spectral-gate",
  "vibrato",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertScene(condition, message) {
  if (!condition) throw new Error(`Shader playground scene: ${message}`);
}

/**
 * Builds the authored scene collection after the core and history-effect module
 * specs have been assembled. Supplying the module list here avoids a circular
 * import while still filling every node with the current parameter defaults.
 */
export function createShaderPlaygroundScenes(moduleSpecs = []) {
  assertScene(Array.isArray(moduleSpecs), "moduleSpecs must be an array.");
  const moduleById = new Map(moduleSpecs.map((spec) => [spec.id, spec]));

  function node(id, type, x, y, overrides = {}) {
    const spec = moduleById.get(type);
    assertScene(spec, `missing module spec: ${type}.`);
    const parameterIds = new Set((spec.params ?? []).map((parameter) => parameter.id));
    for (const key of Object.keys(overrides)) {
      assertScene(parameterIds.has(key), `${type} has no parameter named ${key}.`);
    }
    return {
      id,
      type,
      x,
      y,
      params: Object.fromEntries((spec.params ?? []).map((parameter) => [
        parameter.id,
        Object.prototype.hasOwnProperty.call(overrides, parameter.id)
          ? overrides[parameter.id]
          : parameter.default,
      ])),
    };
  }

  function edge(fromNode, fromPort, toNode, toPort) {
    return {
      id: `${fromNode}-${fromPort}-${toNode}-${toPort}`,
      from: { node: fromNode, port: fromPort },
      to: { node: toNode, port: toPort },
    };
  }

  function output(x, y, level = 0.62) {
    return node("out", "output", x, y, { level, ceiling: 0.88 });
  }

  function validateScene(patch) {
    assertScene(patch.nodes.length <= 16, `${patch.id} exceeds 16 nodes.`);
    assertScene(patch.connections.length <= 24, `${patch.id} exceeds 24 cables.`);

    const nodeById = new Map();
    for (const graphNode of patch.nodes) {
      assertScene(!nodeById.has(graphNode.id), `${patch.id} repeats node id ${graphNode.id}.`);
      nodeById.set(graphNode.id, graphNode);
    }
    const outputs = patch.nodes.filter(({ type }) => type === "output");
    assertScene(outputs.length === 1, `${patch.id} needs exactly one Output.`);

    const occupiedInputs = new Set();
    const connectedInputs = new Set();
    const indegree = new Map(patch.nodes.map(({ id }) => [id, 0]));
    const outgoing = new Map(patch.nodes.map(({ id }) => [id, []]));
    for (const connection of patch.connections) {
      const sourceNode = nodeById.get(connection.from.node);
      const targetNode = nodeById.get(connection.to.node);
      assertScene(sourceNode && targetNode, `${patch.id} has a cable with a missing node.`);
      assertScene(sourceNode.id !== targetNode.id, `${patch.id} has a self-connection.`);
      const sourceSpec = moduleById.get(sourceNode.type);
      const targetSpec = moduleById.get(targetNode.type);
      const sourcePort = sourceSpec.outputs.find(({ id }) => id === connection.from.port);
      const targetPort = targetSpec.inputs.find(({ id }) => id === connection.to.port);
      assertScene(sourcePort, `${patch.id} references missing output ${sourceNode.type}.${connection.from.port}.`);
      assertScene(targetPort, `${patch.id} references missing input ${targetNode.type}.${connection.to.port}.`);
      assertScene(targetPort.types.includes(sourcePort.type), `${patch.id} connects incompatible ports ${sourceNode.type}.${sourcePort.id} and ${targetNode.type}.${targetPort.id}.`);
      const targetKey = `${targetNode.id}:${targetPort.id}`;
      assertScene(!occupiedInputs.has(targetKey), `${patch.id} connects ${targetKey} more than once.`);
      occupiedInputs.add(targetKey);
      connectedInputs.add(targetKey);
      indegree.set(targetNode.id, indegree.get(targetNode.id) + 1);
      outgoing.get(sourceNode.id).push(targetNode.id);
    }

    for (const graphNode of patch.nodes) {
      const spec = moduleById.get(graphNode.type);
      for (const input of spec.inputs ?? []) {
        assertScene(!input.required || connectedInputs.has(`${graphNode.id}:${input.id}`), `${patch.id} leaves required input ${graphNode.id}.${input.id} open.`);
      }
    }

    const queue = patch.nodes.filter(({ id }) => indegree.get(id) === 0).map(({ id }) => id);
    let visited = 0;
    while (queue.length) {
      const current = queue.shift();
      visited += 1;
      for (const target of outgoing.get(current)) {
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      }
    }
    assertScene(visited === patch.nodes.length, `${patch.id} is not a DAG.`);

    const effectNodes = patch.nodes.filter(({ type }) => HISTORY_EFFECT_IDS.has(type));
    if (effectNodes.length) {
      const effectIds = new Set(effectNodes.map(({ id }) => id));
      const tailIds = new Set();
      let incoming = patch.connections.find(({ to }) => to.node === outputs[0].id && to.port === "signal");
      while (incoming && effectIds.has(incoming.from.node)) {
        assertScene(!tailIds.has(incoming.from.node), `${patch.id} repeats a history effect in its tail.`);
        tailIds.add(incoming.from.node);
        incoming = patch.connections.find(({ to }) => to.node === incoming.from.node && to.port === "signal");
      }
      assertScene(tailIds.size === effectIds.size, `${patch.id} history effects are not one terminal chain.`);
      for (const effectNode of effectNodes) {
        const effectOutputs = patch.connections.filter(({ from }) => from.node === effectNode.id);
        assertScene(effectOutputs.length === 1, `${patch.id} effect ${effectNode.id} must have one outgoing cable.`);
        const connection = effectOutputs[0];
        const destination = nodeById.get(connection.to.node);
        assertScene(connection.from.port === "out" && connection.to.port === "signal" && (destination.type === "output" || effectIds.has(destination.id)), `${patch.id} effect ${effectNode.id} is outside the terminal chain.`);
      }
    }
  }

  function scene(sequence, slug, metadata, nodes, connections) {
    const id = `combo-${String(sequence).padStart(3, "0")}-${slug}`;
    assertScene(/^combo-\d{3}-[a-z0-9-]+$/.test(id), `invalid id ${id}.`);
    const patch = { id, name: metadata.name, nodes, connections };
    validateScene(patch);
    const moduleTypes = [...new Set(nodes.map(({ type }) => type))];
    return deepFreeze({
      id,
      name: metadata.name,
      description: metadata.description,
      family: metadata.family,
      character: metadata.character,
      category: metadata.category,
      route: metadata.route,
      collection: "authored-scenes",
      moduleTypes,
      moduleNames: moduleTypes.map((type) => moduleById.get(type).name),
      patch,
    });
  }

  const scenes = [
    scene(121, "cathedral-fanout", {
      name: "Cathedral Fanout",
      description: "One GPU pitch lane drives three contrasting voices while its gate independently articulates all three branches into a large reflection field.",
      family: "fanout-ensemble",
      character: "wide choral staircase",
      category: "tonal",
      route: "Arp → 3 voices → 3 VCAs → Three-way Sum → Reverb → Output",
    }, [
      node("arp", "gpu-arp", 20, 190, { rate: 4.8, steps: 9, pattern: 2, scale: 2, octaves: 3, glide: 0.16, swing: 0.12, seed: 17011 }),
      node("choir", "formant-bank", 245, 20, { frequency: 82.41, vowel: 0.22, harmonics: 30, bandwidth: 205, breath: 0.08, level: 0.38 }),
      node("glass", "vector-wavetable", 245, 190, { frequency: 110, scan: 0.64, harmonics: 27, tilt: 0.88, stereo: 0.68, level: 0.34 }),
      node("pipes", "additive", 245, 360, { frequency: 55, partials: 25, tilt: 1.05, stretch: 1.016, level: 0.28 }),
      node("choir-vca", "vca", 500, 20, { base: 0, depth: 1, drive: 1.18 }),
      node("glass-vca", "vca", 500, 190, { base: 0, depth: 1, drive: 1.24 }),
      node("pipes-vca", "vca", 500, 360, { base: 0, depth: 1, drive: 1.14 }),
      node("sum", "sum-3", 740, 190, { a: 1.1, b: 0.86, c: 0.72, level: 0.82 }),
      node("room", "reverb", 960, 190, { size: 2.9, decay: 0.84, taps: 54, mix: 0.56, predelay: 0.038, width: 0.94, tone: 0.42, level: 0.8 }),
      output(1190, 190, 0.58),
    ], [
      edge("arp", "pitch", "choir", "pitch"), edge("arp", "pitch", "glass", "pitch"), edge("arp", "pitch", "pipes", "pitch"),
      edge("arp", "gate", "choir-vca", "cv"), edge("arp", "gate", "glass-vca", "cv"), edge("arp", "gate", "pipes-vca", "cv"),
      edge("choir", "out", "choir-vca", "signal"), edge("glass", "out", "glass-vca", "signal"), edge("pipes", "out", "pipes-vca", "signal"),
      edge("choir-vca", "out", "sum", "a"), edge("glass-vca", "out", "sum", "b"), edge("pipes-vca", "out", "sum", "c"),
      edge("sum", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(122, "triple-product-engine", {
      name: "Triple Product Engine",
      description: "Three pitches share one arpeggio but generate unrelated spectra whose multiplication produces moving sum-and-difference clusters.",
      family: "intermodulation",
      character: "mechanical harmonic knot",
      category: "experimental",
      route: "Arp → Oscillator + PM + Hard Sync → Three-way Product → Chebyshev → Delay → Output",
    }, [
      node("arp", "gpu-arp", 20, 220, { rate: 3.75, steps: 11, pattern: 4, scale: 4, octaves: 3, glide: 0.28, swing: 0.07, seed: 9037 }),
      node("wave", "oscillator", 250, 30, { frequency: 65.41, waveform: 1, level: 0.46 }),
      node("pm", "fm", 250, 200, { frequency: 98, ratio: 2.713, index: 4.2, level: 0.34 }),
      node("sync", "hard-sync", 250, 370, { frequency: 49, ratio: 5.7, waveform: 2, stereo: 6.5, level: 0.34 }),
      node("product", "product-3", 525, 200, { amount: 0.9, drive: 4.4, level: 0.92 }),
      node("series", "chebyshev", 745, 200, { order: 7, drive: 1.74, tilt: 0.82, mix: 0.66, bias: 0.04, level: 0.76 }),
      node("echo", "delay", 965, 200, { time: 0.19, repeats: 5, decay: 0.67, mix: 0.45, spread: 0.9, tone: 0.12, pattern: 0.38, level: 0.86 }),
      output(1190, 200, 0.56),
    ], [
      edge("arp", "pitch", "wave", "pitch"), edge("arp", "pitch", "pm", "pitch"), edge("arp", "pitch", "sync", "pitch"),
      edge("wave", "out", "product", "a"), edge("pm", "out", "product", "b"), edge("sync", "out", "product", "c"),
      edge("product", "out", "series", "signal"), edge("series", "out", "echo", "signal"), edge("echo", "out", "out", "signal"),
    ]),

    scene(123, "recombined-weather", {
      name: "Recombined Weather",
      description: "Grains, broadband air, and integer code enter a weighted bus before moving history heads continually rearrange the texture.",
      family: "memory-collage",
      character: "volatile synthetic weather",
      category: "texture",
      route: "Particles + Noise + Bytebeat → Three-way Sum → Recombobulator → Reverb → Output",
    }, [
      node("hold", "sample-hold", 20, 35, { rate: 0.83, seed: 57037, slew: 0.64, bipolar: 0, depth: 0.82 }),
      node("motion", "lfo", 20, 360, { rate: 0.071, shape: 1, depth: 0.74, offset: 0.08 }),
      node("cloud", "particle-cloud", 260, 35, { frequency: 174.61, rate: 29, size: 0.061, density: 0.54, spread: 19, stereo: 0.95, seed: 7219, level: 0.38 }),
      node("air", "noise", 260, 200, { rate: 3200, smooth: 0.54, seed: 48271, level: 0.18 }),
      node("code", "bytebeat", 260, 365, { clock: 6500, pitch: 0.63, formula: 4, bits: 6, variation: 43, cvDepth: 56, stereo: 0.82, level: 0.22 }),
      node("sum", "sum-3", 535, 200, { a: 1.2, b: 0.62, c: 0.78, level: 0.84 }),
      node("memory", "recombobulator", 760, 200, { memory: 1.45, heads: 10, rate: 1.7, mix: 0.7, scatter: 0.94, fold: 0.34, width: 0.98, level: 0.78 }),
      node("room", "reverb", 980, 200, { size: 2.4, decay: 0.77, taps: 44, mix: 0.38, predelay: 0.06, width: 0.96, tone: 0.58, level: 0.8 }),
      output(1205, 200, 0.55),
    ], [
      edge("hold", "out", "cloud", "density"), edge("motion", "out", "code", "variation"),
      edge("cloud", "out", "sum", "a"), edge("air", "out", "sum", "b"), edge("code", "out", "sum", "c"),
      edge("sum", "out", "memory", "signal"), edge("memory", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(124, "frozen-bin-choir", {
      name: "Frozen Bin Choir",
      description: "Three harmonically related voices drift internally, then a short sliding spectrum is shifted and rebuilt before the room stage.",
      family: "spectral-ensemble",
      character: "icy held overtones",
      category: "tonal",
      route: "Arp → Vector + Formant + Additive → Three-way Sum → Sliding-DFT Resynth → Reverb → Output",
    }, [
      node("arp", "gpu-arp", 20, 200, { rate: 1.85, steps: 13, pattern: 5, scale: 5, octaves: 2, glide: 0.7, swing: 0.19, seed: 44017 }),
      node("scan", "lfo", 20, 365, { rate: 0.09, shape: 1, depth: 0.86 }),
      node("vowel", "sample-hold", 20, 35, { rate: 0.22, seed: 30103, slew: 0.86, bipolar: 0, depth: 0.9 }),
      node("vector", "vector-wavetable", 250, 35, { frequency: 73.42, scan: 0.34, harmonics: 31, tilt: 1.15, stereo: 0.82, cvDepth: 0.68, level: 0.32 }),
      node("voice", "formant-bank", 250, 200, { frequency: 55, vowel: 0.6, harmonics: 32, bandwidth: 145, tilt: 0.84, breath: 0.04, cvDepth: 0.82, level: 0.38 }),
      node("bank", "additive", 250, 365, { frequency: 36.71, partials: 32, tilt: 1.35, stretch: 1.029, level: 0.27 }),
      node("sum", "sum-3", 520, 200, { a: 0.92, b: 1.18, c: 0.7, level: 0.8 }),
      node("bins", "spectral-resynth", 755, 200, { window: 112, bins: 22, shift: 1.98, mix: 0.68, smear: 0.82, tilt: 1.18, width: 0.96, level: 0.78 }),
      node("room", "reverb", 985, 200, { size: 3.6, decay: 0.91, taps: 62, mix: 0.58, predelay: 0.09, width: 0.92, tone: 0.66, level: 0.76 }),
      output(1215, 200, 0.54),
    ], [
      edge("arp", "pitch", "vector", "pitch"), edge("arp", "pitch", "voice", "pitch"), edge("arp", "pitch", "bank", "pitch"),
      edge("scan", "out", "vector", "scan"), edge("vowel", "out", "voice", "vowel"),
      edge("vector", "out", "sum", "a"), edge("voice", "out", "sum", "b"), edge("bank", "out", "sum", "c"),
      edge("sum", "out", "bins", "signal"), edge("bins", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(125, "kick-against-glass", {
      name: "Kick Against Glass",
      description: "A shared sample-accurate phase launches a low drum and a metal contour while a separate Euclidean gate cuts a noise-hat branch.",
      family: "percussion-ensemble",
      character: "heavy body and bright debris",
      category: "rhythmic",
      route: "Clocked kick + Modal plate + Gated noise → Three-way Sum → Delay → Reverb → Output",
    }, [
      node("clock", "clock", 20, 35, { rate: 2.35, swing: 0.08 }),
      node("env", "contour", 245, 35, { attack: 0.003, tail: 0.22, curve: 2.6, level: 1 }),
      node("kick", "procedural-kick", 245, 170, { rate: 2.35, frequency: 43, drop: 6.3, decay: 0.58, click: 0.42, drive: 2.4, phaseDepth: 1, level: 0.7 }),
      node("plate", "modal-metal", 470, 35, { frequency: 154, rate: 2.35, decay: 1.18, inharmonicity: 0.86, modes: 27, brightness: 0.9, strikeDepth: 1, level: 0.42 }),
      node("euclid", "euclidean-gate", 20, 360, { rate: 11, steps: 15, pulses: 4, rotation: 2, width: 0.12, accent: 0.48, level: 1 }),
      node("noise", "noise", 245, 360, { rate: 22000, smooth: 0.03, seed: 13291, level: 0.21 }),
      node("hat-vca", "vca", 470, 330, { base: 0, depth: 1, drive: 2.1 }),
      node("sum", "sum-3", 705, 175, { a: 1.3, b: 0.72, c: 0.55, level: 0.86 }),
      node("echo", "delay", 925, 175, { time: 0.31, repeats: 3, decay: 0.5, mix: 0.29, spread: 0.86, tone: 0.32, pattern: 0.2, level: 0.9 }),
      node("room", "reverb", 1145, 175, { size: 1.25, decay: 0.68, taps: 38, mix: 0.31, predelay: 0.018, width: 0.88, tone: 0.4, level: 0.86 }),
      output(1370, 175, 0.6),
    ], [
      edge("clock", "phase", "env", "phase"), edge("clock", "phase", "kick", "phase"), edge("env", "out", "plate", "strike"),
      edge("noise", "out", "hat-vca", "signal"), edge("euclid", "out", "hat-vca", "cv"),
      edge("kick", "out", "sum", "a"), edge("plate", "out", "sum", "b"), edge("hat-vca", "out", "sum", "c"),
      edge("sum", "out", "echo", "signal"), edge("echo", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(126, "acid-staircase", {
      name: "Acid Staircase",
      description: "A swung pitch lane drives a spectral acid bank and hard-sync voice while independent controls pull their spectra in opposite directions.",
      family: "sequenced-hybrid",
      character: "elastic acidic climb",
      category: "rhythmic",
      route: "Arp → Spectral Acid × Hard Sync → Fold → gated VCA → Delay → Output",
    }, [
      node("arp", "gpu-arp", 20, 180, { rate: 6.4, steps: 12, pattern: 1, scale: 3, octaves: 3, glide: 0.34, swing: 0.21, seed: 8821 }),
      node("cutoff", "sample-hold", 20, 345, { rate: 1.6, seed: 3907, slew: 0.52, bipolar: 1, depth: 0.86 }),
      node("ratio", "lfo", 20, 20, { rate: 0.37, shape: 1, depth: 0.8 }),
      node("acid", "spectral-acid", 260, 75, { frequency: 55, partials: 44, cutoff: 0.28, resonance: 0.9, tilt: 0.82, drive: 3.4, level: 0.38, cvDepth: 0.78 }),
      node("sync", "hard-sync", 260, 280, { frequency: 82.41, ratio: 4.2, waveform: 2, cvDepth: 4.8, stereo: 7.2, level: 0.36 }),
      node("ring", "ring", 520, 170, { amount: 0.68, level: 0.84 }),
      node("fold", "fold", 730, 170, { drive: 5.6, fold: 0.84, mix: 0.72, symmetry: -0.06 }),
      node("amp", "vca", 940, 170, { base: 0, depth: 1, drive: 1.45 }),
      node("echo", "delay", 1150, 170, { time: 0.145, repeats: 5, decay: 0.61, mix: 0.44, spread: 0.95, tone: 0.16, pattern: 0.56, level: 0.86 }),
      output(1370, 170, 0.57),
    ], [
      edge("arp", "pitch", "acid", "pitch"), edge("arp", "pitch", "sync", "pitch"), edge("arp", "gate", "amp", "cv"),
      edge("cutoff", "out", "acid", "cutoff"), edge("ratio", "out", "sync", "ratio"),
      edge("acid", "out", "ring", "a"), edge("sync", "out", "ring", "b"), edge("ring", "out", "fold", "signal"),
      edge("fold", "out", "amp", "signal"), edge("amp", "out", "echo", "signal"), edge("echo", "out", "out", "signal"),
    ]),

    scene(127, "three-rivers", {
      name: "Three Rivers",
      description: "A folded wave, reduced-bit code, and softened particle stream remain separate until a true three-input bus joins them.",
      family: "parallel-branches",
      character: "layered irregular current",
      category: "texture",
      route: "Folded oscillator + Quantized bytebeat + Clipped particles → Three-way Sum → Recombobulator → Output",
    }, [
      node("motion", "lfo", 20, 25, { rate: 0.13, shape: 0, depth: 0.72 }),
      node("hold", "sample-hold", 20, 385, { rate: 2.2, seed: 49201, slew: 0.18, depth: 0.78 }),
      node("wave", "oscillator", 245, 25, { frequency: 69.3, waveform: 2, pmDepth: 1.3, level: 0.42 }),
      node("fold", "fold", 470, 25, { drive: 6.1, fold: 0.88, mix: 0.8, symmetry: 0.09 }),
      node("code", "bytebeat", 245, 205, { clock: 9200, pitch: 0.5, formula: 2, bits: 5, variation: 77, cvDepth: 82, stereo: 0.64, level: 0.24 }),
      node("steps", "quantize", 470, 205, { bits: 4, mix: 0.74, level: 0.78 }),
      node("cloud", "particle-cloud", 245, 385, { frequency: 207.65, rate: 21, size: 0.034, density: 0.58, spread: 21, stereo: 0.92, seed: 6197, level: 0.32 }),
      node("soft", "softclip", 470, 385, { drive: 2.7, mix: 0.68, level: 0.82 }),
      node("sum", "sum-3", 705, 205, { a: 0.92, b: 0.68, c: 1.12, level: 0.82 }),
      node("memory", "recombobulator", 940, 205, { memory: 0.92, heads: 9, rate: 0.66, mix: 0.6, scatter: 0.88, fold: 0.2, width: 0.96, level: 0.82 }),
      output(1170, 205, 0.56),
    ], [
      edge("motion", "out", "wave", "pm"), edge("motion", "out", "cloud", "density"), edge("hold", "out", "code", "variation"),
      edge("wave", "out", "fold", "signal"), edge("code", "out", "steps", "signal"), edge("cloud", "out", "soft", "signal"),
      edge("fold", "out", "sum", "a"), edge("steps", "out", "sum", "b"), edge("soft", "out", "sum", "c"),
      edge("sum", "out", "memory", "signal"), edge("memory", "out", "out", "signal"),
    ]),

    scene(128, "phase-knot", {
      name: "Phase Knot",
      description: "One oscillator is heard directly and also becomes the PM index for a second voice before three streams meet in a nonlinear product.",
      family: "cross-modulation",
      character: "dense glass filaments",
      category: "experimental",
      route: "Oscillator → PM index + Product A; PM + Phase Distortion → Three-way Product → Fold → Spectral Resynth → Output",
    }, [
      node("motion", "lfo", 20, 350, { rate: 0.29, shape: 0, depth: 0.83 }),
      node("wave", "oscillator", 235, 40, { frequency: 58.27, waveform: 1, pmDepth: 2.2, level: 0.52 }),
      node("pm", "fm", 470, 40, { frequency: 87.31, ratio: 3.91, index: 1.3, modDepth: 5.4, level: 0.35 }),
      node("phase", "phase-distortion", 235, 300, { frequency: 130.81, bend: 0.78, split: 0.22, curve: 1.7, cvDepth: 0.52, stereo: 7.8, level: 0.36 }),
      node("product", "product-3", 700, 175, { amount: 0.82, drive: 5.7, level: 0.9 }),
      node("fold", "fold", 910, 175, { drive: 3.9, fold: 0.7, mix: 0.66, symmetry: 0.12 }),
      node("bins", "spectral-resynth", 1120, 175, { window: 72, bins: 17, shift: 2.35, mix: 0.5, smear: 0.74, tilt: 0.76, width: 0.9, level: 0.82 }),
      output(1345, 175, 0.54),
    ], [
      edge("motion", "out", "wave", "pm"), edge("motion", "out", "phase", "bend"),
      edge("wave", "out", "pm", "index"), edge("wave", "out", "product", "a"), edge("pm", "out", "product", "b"), edge("phase", "out", "product", "c"),
      edge("product", "out", "fold", "signal"), edge("fold", "out", "bins", "signal"), edge("bins", "out", "out", "signal"),
    ]),

    scene(129, "golden-canopy", {
      name: "Golden Canopy",
      description: "The arpeggiator fans pitch and gate into a struck plate, a granular canopy, and a separately articulated vowel voice.",
      family: "event-fanout",
      character: "plucked airborne ensemble",
      category: "rhythmic",
      route: "Arp → Modal + Particles + Formant VCA → Three-way Sum → Reverb → Output",
    }, [
      node("arp", "gpu-arp", 20, 190, { rate: 5.25, steps: 10, pattern: 4, scale: 1, octaves: 3, glide: 0.11, swing: 0.16, seed: 28657 }),
      node("metal", "modal-metal", 260, 25, { frequency: 96, rate: 5.25, decay: 0.46, inharmonicity: 0.48, modes: 21, brightness: 0.88, strikeDepth: 0.92, level: 0.4 }),
      node("cloud", "particle-cloud", 260, 190, { frequency: 144, rate: 34, size: 0.025, density: 0.48, spread: 15, stereo: 0.96, seed: 21841, level: 0.32 }),
      node("vowel", "formant-bank", 260, 355, { frequency: 72, vowel: 0.72, harmonics: 28, bandwidth: 190, tilt: 0.75, breath: 0.11, level: 0.4 }),
      node("vowel-vca", "vca", 510, 355, { base: 0, depth: 1, drive: 1.35 }),
      node("sum", "sum-3", 740, 190, { a: 0.94, b: 0.88, c: 1.08, level: 0.82 }),
      node("room", "reverb", 970, 190, { size: 2.15, decay: 0.82, taps: 48, mix: 0.49, predelay: 0.046, width: 0.98, tone: 0.37, level: 0.82 }),
      output(1200, 190, 0.58),
    ], [
      edge("arp", "pitch", "metal", "pitch"), edge("arp", "pitch", "cloud", "pitch"), edge("arp", "pitch", "vowel", "pitch"),
      edge("arp", "gate", "metal", "strike"), edge("arp", "gate", "cloud", "density"), edge("arp", "gate", "vowel-vca", "cv"),
      edge("vowel", "out", "vowel-vca", "signal"), edge("metal", "out", "sum", "a"), edge("cloud", "out", "sum", "b"), edge("vowel-vca", "out", "sum", "c"),
      edge("sum", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(130, "bytebeat-memory", {
      name: "Bytebeat Memory",
      description: "Scale-stepped integer code is amplitude-reduced, echoed, and then cut into a slower moving collage of its recent past.",
      family: "code-memory",
      character: "aliased recursive illusion",
      category: "experimental",
      route: "Arp + Sample & Hold → Bytebeat → Quantizer → Delay → Recombobulator → Output",
    }, [
      node("arp", "gpu-arp", 20, 35, { rate: 7.75, steps: 16, pattern: 3, scale: 0, octaves: 2, glide: 0.04, swing: 0.24, seed: 6143 }),
      node("hold", "sample-hold", 20, 270, { rate: 0.58, seed: 51061, slew: 0.05, depth: 0.92 }),
      node("code", "bytebeat", 275, 140, { clock: 7200, pitch: 0.75, formula: 5, bits: 6, variation: 91, cvDepth: 104, stereo: 0.74, level: 0.27 }),
      node("steps", "quantize", 510, 140, { bits: 5, mix: 0.58, level: 0.84 }),
      node("echo", "delay", 730, 140, { time: 0.117, repeats: 6, decay: 0.73, mix: 0.58, spread: 1, tone: 0.08, pattern: 0.74, level: 0.84 }),
      node("memory", "recombobulator", 950, 140, { memory: 2.2, heads: 7, rate: 0.42, mix: 0.62, scatter: 0.96, fold: 0.42, width: 0.94, level: 0.8 }),
      output(1180, 140, 0.54),
    ], [
      edge("arp", "pitch", "code", "pitch"), edge("hold", "out", "code", "variation"),
      edge("code", "out", "steps", "signal"), edge("steps", "out", "echo", "signal"), edge("echo", "out", "memory", "signal"), edge("memory", "out", "out", "signal"),
    ]),

    scene(131, "slow-brass-horizon", {
      name: "Slow Brass Horizon",
      description: "One slow control opens a harmonic acid spectrum, reshapes a vowel bank, and moves the combined brass-like layer across stereo.",
      family: "continuous-morph",
      character: "slow luminous brass",
      category: "tonal",
      route: "LFO → Formant + Spectral Acid → Mix → Soft Clip → Pan → Reverb → Output",
    }, [
      node("motion", "lfo", 20, 300, { rate: 0.047, shape: 0, depth: 0.91, offset: -0.04 }),
      node("voice", "formant-bank", 250, 35, { frequency: 61.74, vowel: 0.3, harmonics: 31, bandwidth: 275, tilt: 0.68, breath: 0.06, cvDepth: 0.84, level: 0.43 }),
      node("acid", "spectral-acid", 250, 215, { frequency: 92.5, partials: 42, cutoff: 0.34, resonance: 0.76, tilt: 1.08, drive: 2.5, level: 0.33, cvDepth: 0.7 }),
      node("blend", "mix", 500, 125, { balance: -0.12, level: 0.78 }),
      node("soft", "softclip", 710, 125, { drive: 2.25, mix: 0.52, level: 0.84 }),
      node("pan", "pan", 920, 125, { pan: 0, depth: 0.82, level: 0.9 }),
      node("room", "reverb", 1130, 125, { size: 2.65, decay: 0.86, taps: 56, mix: 0.46, predelay: 0.072, width: 0.9, tone: 0.52, level: 0.82 }),
      output(1360, 125, 0.58),
    ], [
      edge("motion", "out", "voice", "vowel"), edge("motion", "out", "acid", "cutoff"), edge("motion", "out", "pan", "position"),
      edge("voice", "out", "blend", "a"), edge("acid", "out", "blend", "b"), edge("blend", "out", "soft", "signal"),
      edge("soft", "out", "pan", "signal"), edge("pan", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(132, "polyrhythm-lattice", {
      name: "Polyrhythm Lattice",
      description: "Two independent Euclidean cycles articulate neighboring voices while the arpeggiator contributes a third gate and fans pitch across the entire lattice.",
      family: "multi-clock",
      character: "interlocking pitched rhythm",
      category: "rhythmic",
      route: "2 Euclidean gates + Arp gate → 3 pitched VCAs → Three-way Sum → Delay → Output",
    }, [
      node("arp", "gpu-arp", 20, 205, { rate: 4.5, steps: 14, pattern: 2, scale: 2, octaves: 2, glide: 0.09, swing: 0.13, seed: 33013 }),
      node("five", "euclidean-gate", 20, 25, { rate: 8.5, steps: 13, pulses: 5, rotation: 1, width: 0.31, accent: 0.34, level: 1 }),
      node("seven", "euclidean-gate", 20, 385, { rate: 8.5, steps: 16, pulses: 7, rotation: 4, width: 0.22, accent: 0.18, level: 1 }),
      node("wave", "oscillator", 260, 25, { frequency: 73.42, waveform: 2, level: 0.42 }),
      node("pm", "fm", 260, 205, { frequency: 110, ratio: 1.414, index: 2.9, level: 0.36 }),
      node("metal", "modal-metal", 260, 385, { frequency: 146.83, rate: 4.5, decay: 0.38, inharmonicity: 0.7, modes: 18, level: 0.38 }),
      node("wave-vca", "vca", 500, 25, { base: 0, depth: 1, drive: 1.3 }),
      node("pm-vca", "vca", 500, 205, { base: 0, depth: 1, drive: 1.24 }),
      node("metal-vca", "vca", 500, 385, { base: 0, depth: 1, drive: 1.38 }),
      node("sum", "sum-3", 735, 205, { a: 0.9, b: 1.05, c: 0.8, level: 0.83 }),
      node("echo", "delay", 965, 205, { time: 0.235, repeats: 4, decay: 0.56, mix: 0.4, spread: 0.92, tone: 0.22, pattern: 0.44, level: 0.87 }),
      output(1195, 205, 0.57),
    ], [
      edge("arp", "pitch", "wave", "pitch"), edge("arp", "pitch", "pm", "pitch"), edge("arp", "pitch", "metal", "pitch"),
      edge("wave", "out", "wave-vca", "signal"), edge("pm", "out", "pm-vca", "signal"), edge("metal", "out", "metal-vca", "signal"),
      edge("five", "out", "wave-vca", "cv"), edge("seven", "out", "pm-vca", "cv"), edge("arp", "gate", "metal-vca", "cv"),
      edge("wave-vca", "out", "sum", "a"), edge("pm-vca", "out", "sum", "b"), edge("metal-vca", "out", "sum", "c"),
      edge("sum", "out", "echo", "signal"), edge("echo", "out", "out", "signal"),
    ]),

    scene(133, "shimmering-downshift", {
      name: "Shimmering Downshift",
      description: "A shared slow gesture opens a partial bank and a particle field before spectral resynthesis moves their measured energy downward.",
      family: "spectral-pitch-shift",
      character: "descending luminous fog",
      category: "texture",
      route: "LFO → Additive + Particles → Mix → Downshifted Resynth → Delay → Reverb → Output",
    }, [
      node("motion", "lfo", 20, 260, { rate: 0.082, shape: 1, depth: 0.88, offset: 0.1 }),
      node("bank", "additive", 255, 65, { frequency: 98, partials: 29, tilt: 0.74, stretch: 1.023, level: 0.32 }),
      node("cloud", "particle-cloud", 255, 280, { frequency: 196, rate: 23, size: 0.072, density: 0.46, spread: 17, stereo: 0.94, seed: 53089, level: 0.34 }),
      node("blend", "mix", 500, 170, { balance: 0.08, level: 0.76 }),
      node("bins", "spectral-resynth", 720, 170, { window: 128, bins: 24, shift: 0.48, mix: 0.72, smear: 0.68, tilt: 0.72, width: 0.98, level: 0.8 }),
      node("echo", "delay", 945, 170, { time: 0.42, repeats: 4, decay: 0.66, mix: 0.34, spread: 0.88, tone: 0.48, pattern: 0.82, level: 0.86 }),
      node("room", "reverb", 1170, 170, { size: 3.2, decay: 0.88, taps: 60, mix: 0.5, predelay: 0.12, width: 0.98, tone: 0.7, level: 0.78 }),
      output(1400, 170, 0.54),
    ], [
      edge("motion", "out", "bank", "brightness"), edge("motion", "out", "cloud", "density"),
      edge("bank", "out", "blend", "a"), edge("cloud", "out", "blend", "b"), edge("blend", "out", "bins", "signal"),
      edge("bins", "out", "echo", "signal"), edge("echo", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(134, "microscopic-comb", {
      name: "Microscopic Comb",
      description: "Ringed noise and tone hit a six-tap delay short enough for the repeated reads to become a pitched, metallic comb color.",
      family: "micro-delay",
      character: "tight electric filament",
      category: "experimental",
      route: "Noise × PM oscillator → Ring → Quantizer → 8 ms Delay → Output",
    }, [
      node("motion", "lfo", 20, 285, { rate: 6.2, shape: 0, depth: 0.58 }),
      node("noise", "noise", 20, 35, { rate: 17000, smooth: 0.05, seed: 40193, level: 0.34 }),
      node("wave", "oscillator", 245, 285, { frequency: 184.997, waveform: 0, pmDepth: 3.7, level: 0.5 }),
      node("ring", "ring", 480, 145, { amount: 0.96, level: 0.9 }),
      node("steps", "quantize", 695, 145, { bits: 8, mix: 0.28, level: 0.88 }),
      node("comb", "delay", 910, 145, { time: 0.008, repeats: 6, decay: 0.82, mix: 0.7, spread: 0.68, tone: 0.06, pattern: 0.14, level: 0.82 }),
      output(1140, 145, 0.55),
    ], [
      edge("motion", "out", "wave", "pm"), edge("noise", "out", "ring", "a"), edge("wave", "out", "ring", "b"),
      edge("ring", "out", "steps", "signal"), edge("steps", "out", "comb", "signal"), edge("comb", "out", "out", "signal"),
    ]),

    scene(135, "impossible-room", {
      name: "Impossible Room",
      description: "Three sustained source models feed a four-second reflection field whose output is then broken into slowly mutating, spatial memory heads.",
      family: "deep-space",
      character: "vast shifting architecture",
      category: "texture",
      route: "Particles + Modal body + Formants → Three-way Sum → Long Reverb → Recombobulator → Output",
    }, [
      node("motion", "lfo", 20, 45, { rate: 0.031, shape: 0, depth: 0.76, offset: 0.16 }),
      node("hold", "sample-hold", 20, 350, { rate: 0.13, seed: 61613, slew: 0.92, bipolar: 0, depth: 0.84 }),
      node("cloud", "particle-cloud", 255, 45, { frequency: 116.54, rate: 12, size: 0.14, density: 0.7, spread: 24, stereo: 1, seed: 4919, level: 0.34 }),
      node("metal", "modal-metal", 255, 205, { frequency: 67, rate: 0.72, decay: 2.4, inharmonicity: 0.92, modes: 31, brightness: 1.36, strikeDepth: 0.66, level: 0.36 }),
      node("voice", "formant-bank", 255, 365, { frequency: 48.99, vowel: 0.46, harmonics: 32, bandwidth: 330, tilt: 1.05, breath: 0.13, cvDepth: 0.62, level: 0.37 }),
      node("sum", "sum-3", 520, 205, { a: 1.05, b: 0.9, c: 0.84, level: 0.8 }),
      node("room", "reverb", 750, 205, { size: 4, decay: 0.96, taps: 64, mix: 0.75, predelay: 0.19, width: 1, tone: 0.76, level: 0.76 }),
      node("memory", "recombobulator", 980, 205, { memory: 3.5, heads: 12, rate: 0.17, mix: 0.56, scatter: 0.88, fold: 0.16, width: 1, level: 0.8 }),
      output(1210, 205, 0.52),
    ], [
      edge("motion", "out", "cloud", "density"), edge("motion", "out", "voice", "vowel"), edge("hold", "out", "metal", "strike"),
      edge("cloud", "out", "sum", "a"), edge("metal", "out", "sum", "b"), edge("voice", "out", "sum", "c"),
      edge("sum", "out", "room", "signal"), edge("room", "out", "memory", "signal"), edge("memory", "out", "out", "signal"),
    ]),

    scene(136, "folded-machine", {
      name: "Folded Machine",
      description: "One held control fans into three unrelated synthesis parameters before the sources collide in a three-way multiplier and polynomial series.",
      family: "control-fanout",
      character: "unstable digital mechanism",
      category: "experimental",
      route: "Sample & Hold → Hard Sync + Phase Distortion + Bytebeat → Three-way Product → Chebyshev → Delay → Output",
    }, [
      node("hold", "sample-hold", 20, 195, { rate: 3.1, seed: 12547, slew: 0.34, depth: 0.9 }),
      node("sync", "hard-sync", 260, 30, { frequency: 61.74, ratio: 6.2, waveform: 3, shape: 0.24, cvDepth: 5.6, stereo: 5.2, level: 0.38 }),
      node("phase", "phase-distortion", 260, 195, { frequency: 103.83, bend: 0.64, split: 0.41, curve: 2.2, cvDepth: 0.74, stereo: 6.4, level: 0.38 }),
      node("code", "bytebeat", 260, 360, { clock: 11600, pitch: 0.42, formula: 3, bits: 7, variation: 33, cvDepth: 112, stereo: 0.72, level: 0.23 }),
      node("product", "product-3", 525, 195, { amount: 0.94, drive: 6.6, level: 0.91 }),
      node("series", "chebyshev", 750, 195, { order: 8, drive: 1.92, tilt: 0.56, mix: 0.74, bias: -0.08, level: 0.74 }),
      node("echo", "delay", 970, 195, { time: 0.27, repeats: 5, decay: 0.72, mix: 0.48, spread: 0.98, tone: 0.14, pattern: 0.63, level: 0.84 }),
      output(1200, 195, 0.54),
    ], [
      edge("hold", "out", "sync", "ratio"), edge("hold", "out", "phase", "bend"), edge("hold", "out", "code", "variation"),
      edge("sync", "out", "product", "a"), edge("phase", "out", "product", "b"), edge("code", "out", "product", "c"),
      edge("product", "out", "series", "signal"), edge("series", "out", "echo", "signal"), edge("echo", "out", "out", "signal"),
    ]),

    scene(137, "breathing-choir-steps", {
      name: "Breathing Choir Steps",
      description: "Pitch, gate, and timbre each fan across a paired choir while a spectral stage turns their shared articulations into a high, breathing halo.",
      family: "articulated-choir",
      character: "human shimmer pulses",
      category: "tonal",
      route: "Arp + LFO → Formant VCA + Additive VCA → Mix → Spectral Resynth → Reverb → Output",
    }, [
      node("arp", "gpu-arp", 20, 85, { rate: 2.8, steps: 7, pattern: 0, scale: 1, octaves: 2, glide: 0.42, swing: 0.1, seed: 25057 }),
      node("breath", "lfo", 20, 330, { rate: 0.18, shape: 0, depth: 0.78, offset: 0.04 }),
      node("voice", "formant-bank", 260, 45, { frequency: 69.3, vowel: 0.24, harmonics: 30, bandwidth: 240, tilt: 0.74, breath: 0.14, cvDepth: 0.76, level: 0.42 }),
      node("bank", "additive", 260, 300, { frequency: 34.65, partials: 28, tilt: 1.18, stretch: 1.011, level: 0.3 }),
      node("voice-vca", "vca", 500, 45, { base: 0, depth: 1, drive: 1.22 }),
      node("bank-vca", "vca", 500, 300, { base: 0, depth: 1, drive: 1.18 }),
      node("blend", "mix", 725, 170, { balance: -0.16, level: 0.78 }),
      node("bins", "spectral-resynth", 945, 170, { window: 96, bins: 19, shift: 2.7, mix: 0.55, smear: 0.86, tilt: 1.26, width: 0.98, level: 0.8 }),
      node("room", "reverb", 1170, 170, { size: 3.1, decay: 0.89, taps: 58, mix: 0.53, predelay: 0.075, width: 0.96, tone: 0.64, level: 0.78 }),
      output(1400, 170, 0.54),
    ], [
      edge("arp", "pitch", "voice", "pitch"), edge("arp", "pitch", "bank", "pitch"), edge("arp", "gate", "voice-vca", "cv"), edge("arp", "gate", "bank-vca", "cv"),
      edge("breath", "out", "voice", "vowel"), edge("breath", "out", "bank", "brightness"),
      edge("voice", "out", "voice-vca", "signal"), edge("bank", "out", "bank-vca", "signal"),
      edge("voice-vca", "out", "blend", "a"), edge("bank-vca", "out", "blend", "b"),
      edge("blend", "out", "bins", "signal"), edge("bins", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),

    scene(138, "percussion-cloud", {
      name: "Percussion Cloud",
      description: "A kick strikes against an independently gated metal-and-grain layer before ring multiplication and two different memory processes.",
      family: "hybrid-percussion",
      character: "shattered rhythmic mass",
      category: "rhythmic",
      route: "Kick × (Modal + Particles) → Ring → Recombobulator → Delay → Output",
    }, [
      node("clock", "clock", 20, 30, { rate: 2.1, swing: 0.17 }),
      node("euclid", "euclidean-gate", 20, 205, { rate: 9.4, steps: 11, pulses: 4, rotation: 3, width: 0.24, accent: 0.42, level: 1 }),
      node("hold", "sample-hold", 20, 380, { rate: 1.35, seed: 40343, slew: 0.4, bipolar: 0, depth: 0.9 }),
      node("kick", "procedural-kick", 255, 30, { rate: 2.1, frequency: 46, drop: 7.2, decay: 0.48, click: 0.54, drive: 2.7, phaseDepth: 1, level: 0.68 }),
      node("metal", "modal-metal", 255, 205, { frequency: 182, rate: 9.4, decay: 0.57, inharmonicity: 0.95, modes: 24, brightness: 0.76, strikeDepth: 1, level: 0.42 }),
      node("cloud", "particle-cloud", 255, 380, { frequency: 232, rate: 31, size: 0.028, density: 0.44, spread: 22, stereo: 0.96, seed: 9833, level: 0.33 }),
      node("blend", "mix", 510, 290, { balance: 0.18, level: 0.8 }),
      node("ring", "ring", 735, 155, { amount: 0.62, level: 0.88 }),
      node("memory", "recombobulator", 955, 155, { memory: 0.64, heads: 11, rate: 2.8, mix: 0.67, scatter: 1, fold: 0.52, width: 0.98, level: 0.78 }),
      node("echo", "delay", 1175, 155, { time: 0.37, repeats: 4, decay: 0.64, mix: 0.46, spread: 1, tone: 0.29, pattern: 0.7, level: 0.84 }),
      output(1405, 155, 0.55),
    ], [
      edge("clock", "phase", "kick", "phase"), edge("euclid", "out", "metal", "strike"), edge("hold", "out", "cloud", "density"),
      edge("metal", "out", "blend", "a"), edge("cloud", "out", "blend", "b"), edge("kick", "out", "ring", "a"), edge("blend", "out", "ring", "b"),
      edge("ring", "out", "memory", "signal"), edge("memory", "out", "echo", "signal"), edge("echo", "out", "out", "signal"),
    ]),

    scene(139, "dual-clock-canons", {
      name: "Dual Clock Canons",
      description: "Two unrelated event rates articulate a bright waveform and a slower PM voice, producing phase relationships that take many beats to repeat.",
      family: "independent-events",
      character: "offset melodic canons",
      category: "rhythmic",
      route: "Clock A → Oscillator VCA + Clock B → PM VCA → Mix → Delay → Output",
    }, [
      node("clock-a", "clock", 20, 25, { rate: 3.2, swing: 0.14 }),
      node("env-a", "contour", 240, 25, { attack: 0.006, tail: 0.19, curve: 1.7, level: 1 }),
      node("wave", "oscillator", 20, 170, { frequency: 146.83, waveform: 2, level: 0.4 }),
      node("vca-a", "vca", 465, 95, { base: 0, depth: 1, drive: 1.22 }),
      node("clock-b", "clock", 20, 330, { rate: 2.07, swing: 0.27 }),
      node("env-b", "contour", 240, 330, { attack: 0.014, tail: 0.42, curve: 2.1, level: 1 }),
      node("pm", "fm", 20, 475, { frequency: 73.42, ratio: 3.141, index: 4.7, level: 0.38 }),
      node("vca-b", "vca", 465, 405, { base: 0, depth: 1, drive: 1.28 }),
      node("blend", "mix", 700, 245, { balance: 0.02, level: 0.8 }),
      node("echo", "delay", 925, 245, { time: 0.286, repeats: 5, decay: 0.59, mix: 0.43, spread: 0.9, tone: 0.2, pattern: 0.32, level: 0.86 }),
      output(1155, 245, 0.58),
    ], [
      edge("clock-a", "phase", "env-a", "phase"), edge("wave", "out", "vca-a", "signal"), edge("env-a", "out", "vca-a", "cv"),
      edge("clock-b", "phase", "env-b", "phase"), edge("pm", "out", "vca-b", "signal"), edge("env-b", "out", "vca-b", "cv"),
      edge("vca-a", "out", "blend", "a"), edge("vca-b", "out", "blend", "b"), edge("blend", "out", "echo", "signal"), edge("echo", "out", "out", "signal"),
    ]),

    scene(140, "aliased-cathedral", {
      name: "Aliased Cathedral",
      description: "Integer code, vowel harmonics, and an acid spectrum are bussed together, deliberately reduced, then rebuilt as a displaced spectral room.",
      family: "spectral-code",
      character: "monumental digital choir",
      category: "experimental",
      route: "Bytebeat + Formant + Spectral Acid → Three-way Sum → Quantizer → Spectral Resynth → Reverb → Output",
    }, [
      node("motion", "lfo", 20, 45, { rate: 0.12, shape: 1, depth: 0.84, offset: -0.08 }),
      node("hold", "sample-hold", 20, 370, { rate: 0.94, seed: 35771, slew: 0.22, depth: 0.88 }),
      node("code", "bytebeat", 255, 45, { clock: 5400, pitch: 0.34, formula: 1, bits: 6, variation: 117, cvDepth: 120, stereo: 0.82, level: 0.2 }),
      node("voice", "formant-bank", 255, 205, { frequency: 52, vowel: 0.38, harmonics: 32, bandwidth: 180, tilt: 0.66, breath: 0.09, cvDepth: 0.86, level: 0.39 }),
      node("acid", "spectral-acid", 255, 365, { frequency: 78, partials: 48, cutoff: 0.42, resonance: 0.93, tilt: 0.72, drive: 3.8, level: 0.31, cvDepth: 0.8 }),
      node("sum", "sum-3", 525, 205, { a: 0.54, b: 1.12, c: 0.94, level: 0.82 }),
      node("steps", "quantize", 750, 205, { bits: 5, mix: 0.5, level: 0.84 }),
      node("bins", "spectral-resynth", 970, 205, { window: 104, bins: 21, shift: 1.73, mix: 0.63, smear: 0.9, tilt: 0.68, width: 1, level: 0.78 }),
      node("room", "reverb", 1195, 205, { size: 3.45, decay: 0.92, taps: 64, mix: 0.57, predelay: 0.11, width: 0.98, tone: 0.72, level: 0.76 }),
      output(1425, 205, 0.52),
    ], [
      edge("hold", "out", "code", "variation"), edge("motion", "out", "voice", "vowel"), edge("motion", "out", "acid", "cutoff"),
      edge("code", "out", "sum", "a"), edge("voice", "out", "sum", "b"), edge("acid", "out", "sum", "c"),
      edge("sum", "out", "steps", "signal"), edge("steps", "out", "bins", "signal"), edge("bins", "out", "room", "signal"), edge("room", "out", "out", "signal"),
    ]),
  ];

  assertScene(scenes.length === SHADER_PLAYGROUND_SCENE_RANGE.count, "scene count does not match SHADER_PLAYGROUND_SCENE_RANGE.");
  return freeze(scenes);
}
