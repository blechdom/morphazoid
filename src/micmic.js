export const MAX_RECURSION_FEEDBACK = 0.86;
export const MAX_GENERATION_STAGES = 8;
export const GENERATION_RULE_PRESETS = Object.freeze({
  clean: Object.freeze({ label: "Clean echo · 1:1", timeRatio: 1, angle: 0, asymmetry: 0, pitchScale: 1 }),
  binary: Object.freeze({ label: "Half-time fork", timeRatio: 0.5, angle: 30, asymmetry: 0, pitchScale: 1 }),
  pythagorean: Object.freeze({ label: "Pythagorean tree", timeRatio: 0.72, angle: 45, asymmetry: 0, pitchScale: 1 }),
  plant: Object.freeze({ label: "Branching plant", timeRatio: 0.72, angle: 22.5, asymmetry: 0.18, pitchScale: 1 }),
  coral: Object.freeze({ label: "Coral", timeRatio: 0.72, angle: 22.5, asymmetry: -0.22, pitchScale: 1.4 }),
  dragon: Object.freeze({ label: "Dragon curve", timeRatio: Math.SQRT1_2, angle: 90, asymmetry: 0, pitchScale: 0.5 }),
  koch: Object.freeze({ label: "Koch fork", timeRatio: 1 / 3, angle: 60, asymmetry: 0, pitchScale: 1 }),
});

export const MICMIC_PRESETS = Object.freeze({
  tunnel: Object.freeze({
    label: "Tunnel",
    interval: 360,
    depth: 0.64,
    branching: 0.08,
    mutation: 0.18,
    spread: 0.56,
    wet: 0.78,
    dry: 0,
  }),
  bloom: Object.freeze({
    label: "Bloom",
    interval: 240,
    depth: 0.72,
    branching: 0.84,
    mutation: 0.3,
    spread: 0.9,
    wet: 0.76,
    dry: 0,
  }),
  choir: Object.freeze({
    label: "Choir",
    interval: 135,
    depth: 0.76,
    branching: 0.62,
    mutation: 0.56,
    spread: 0.7,
    wet: 0.68,
    dry: 0.08,
  }),
  fray: Object.freeze({
    label: "Fray",
    interval: 38,
    depth: 0.8,
    branching: 1,
    mutation: 0.9,
    spread: 1,
    wet: 0.7,
    dry: 0,
  }),
});

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function estimateGenerations(feedback, silenceFloor = 0.04) {
  const gain = clamp(feedback, 0, MAX_RECURSION_FEEDBACK);
  const floor = clamp(silenceFloor, 0.0001, 0.5);
  // The seeded delay is generation one even when no signal is fed back.
  if (gain <= floor) return 1;
  return Math.min(32, Math.max(1, Math.ceil(Math.log(floor) / Math.log(gain))));
}

export function recursionParameters(values = {}) {
  const interval = clamp(values.interval ?? 240, 0.2, 2_400);
  const depth = clamp(values.depth ?? 0.72, 0, MAX_RECURSION_FEEDBACK);
  const branching = clamp(values.branching ?? 0.84);
  const mutation = clamp(values.mutation ?? 0.3);
  const spread = clamp(values.spread ?? 0.9);
  const split = branching * 0.5;
  const seedRatio = branching * 0.78;
  const seedNormalization = 1 / Math.sqrt(1 + seedRatio * seedRatio);

  return {
    intervalA: interval / 1000,
    intervalB: interval * (1 + branching * 0.618) / 1000,
    selfFeedback: depth * (1 - split),
    crossFeedback: depth * split,
    seedA: seedNormalization,
    seedB: seedRatio * seedNormalization,
    lowpass: 18_000 * Math.pow(2_200 / 18_000, Math.pow(mutation, 0.86)),
    highpass: 45 + 255 * Math.pow(mutation, 1.35),
    modulationDepth: Math.min(0.006, interval / 1000 * 0.08) * mutation,
    modulationRate: 0.11 + mutation * 1.18,
    panA: -spread,
    panB: spread,
    wetNormalization: 0.36 + 0.64 * Math.sqrt(Math.max(0.08, 1 - depth * depth)),
    generations: estimateGenerations(depth),
  };
}

/** Build an inherited binary rewrite: interval tapers, branch turns map to pitch. */
export function generationVoiceSpecs({
  generations = 8,
  interval = 240,
  depth = 0.72,
  branching = 0.84,
  spread = 0.9,
  mutation = 0.3,
  timeRatio = 0.5,
  angle = 30,
  asymmetry = 0,
  pitchScale = 1,
} = {}) {
  const count = Math.max(1, Math.min(MAX_GENERATION_STAGES, Math.round(Number(generations) || 1)));
  const taper = clamp(timeRatio, 0.2, 1);
  const turn = clamp(angle, 0, 180);
  const skew = clamp(asymmetry, -0.8, 0.8);
  const octaveScale = clamp(pitchScale, 0, 4);
  const turnA = -turn * (1 - skew);
  const turnB = turn * (1 + skew);
  const layout = echoTreeLayout(count, branching, 8).filter((node) => node.generation > 0);
  const perGeneration = new Map();
  for (const node of layout) {
    const group = perGeneration.get(node.generation) ?? [];
    group.push(node);
    perGeneration.set(node.generation, group);
  }
  const lineage = new Map([["0:0", { delay: 0, interval: clamp(interval, 0.2, 2_400) / 1000, semitones: 0 }]]);
  const voices = [];
  for (let generation = 1; generation <= count; generation += 1) {
    const nodes = perGeneration.get(generation) ?? [];
    const generationGain = 0.5 * Math.pow(clamp(depth, 0, MAX_RECURSION_FEEDBACK), generation * 0.72);
    for (const node of nodes) {
      const parent = lineage.get(node.parentId) ?? lineage.get("0:0");
      const hasFork = nodes.length > 1 && clamp(branching) > 0;
      const branchTurn = !hasFork ? 0 : (node.rule === "B" ? turnB : turnA);
      const nextInterval = parent.interval * taper;
      const cumulativeDelay = parent.delay + nextInterval;
      const cumulativeSemitones = parent.semitones + branchTurn / 180 * 12 * octaveScale;
      lineage.set(node.id, { delay: cumulativeDelay, interval: nextInterval, semitones: cumulativeSemitones });
      voices.push({
        key: `generation:${generation}:${node.index}`,
        generation,
        rule: node.rule,
        turnDegrees: branchTurn,
        interval: nextInterval,
        delay: cumulativeDelay,
        rate: clamp(2 ** (cumulativeSemitones / 12), 0.125, 8),
        gain: generationGain / Math.sqrt(Math.max(1, nodes.length)),
        pan: clamp(node.y * 2 * clamp(spread), -1, 1),
      });
    }
  }
  return voices;
}

export function echoTreeLayout(
  generationCount,
  branching = 1,
  maximumPerGeneration = 8,
  generationLimit = MAX_GENERATION_STAGES,
) {
  const limit = Math.max(0, Math.min(32, Math.round(Number(generationLimit) || MAX_GENERATION_STAGES)));
  const generations = Math.max(0, Math.min(limit, Math.round(Number(generationCount) || 0)));
  const branch = clamp(branching);
  const maximum = Math.max(1, Math.round(Number(maximumPerGeneration) || 1));
  const nodes = [{ id: "0:0", generation: 0, index: 0, x: 0, y: 0, parentId: null }];
  let previous = [nodes[0]];

  for (let generation = 1; generation <= generations; generation += 1) {
    const possible = Math.min(maximum, 2 ** Math.min(generation, 4));
    const count = Math.max(1, Math.round(1 + (possible - 1) * branch));
    const current = [];
    for (let index = 0; index < count; index += 1) {
      const parentIndex = Math.min(
        previous.length - 1,
        Math.floor(index * previous.length / count),
      );
      const node = {
        id: `${generation}:${index}`,
        generation,
        index,
        x: generation / Math.max(1, generations),
        y: count === 1 ? 0 : index / (count - 1) - 0.5,
        parentId: previous[parentIndex].id,
        rule: count === 1 ? "A" : (index % 2 === 0 ? "A" : "B"),
      };
      nodes.push(node);
      current.push(node);
    }
    previous = current;
  }
  return nodes;
}

export function recorderExtension(mimeType = "") {
  const value = String(mimeType).toLowerCase();
  if (value.includes("ogg")) return "ogg";
  if (value.includes("mp4")) return "m4a";
  if (value.includes("wav")) return "wav";
  return "webm";
}
