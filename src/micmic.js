export const MAX_RECURSION_FEEDBACK = 0.86;
export const MAX_GENERATION_STAGES = 12;
export const MAX_GENERATION_VOICES = 48;
export const MAX_BRANCHES_PER_GENERATION = 9;
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

export function generationCountForDepth(feedback, silenceFloor = 0.04) {
  return Math.min(MAX_GENERATION_STAGES, estimateGenerations(feedback, silenceFloor));
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
    generations: generationCountForDepth(depth),
  };
}

function hashUnit(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function evenlyBounded(candidates, maximum) {
  if (candidates.length <= maximum) return candidates;
  return Array.from({ length: maximum }, (_, index) => (
    candidates[Math.floor(index * candidates.length / maximum)]
  ));
}

/**
 * Build the bounded L-system used by both the rewrite drawing and the audio.
 * Generation zero is a fixed seed trunk.  Child Time Ratio starts at
 * generation one, so it can never resize or remove that trunk.
 */
export function generationTopology({
  generations = 8,
  branching = 0.84,
  mutation = 0,
  timeRatio = 0.5,
  angle = 30,
  asymmetry = 0,
  maximumPerGeneration = MAX_BRANCHES_PER_GENERATION,
} = {}) {
  const count = Math.max(1, Math.min(MAX_GENERATION_STAGES, Math.round(Number(generations) || 1)));
  const branchAmount = clamp(branching);
  const mutationAmount = clamp(mutation);
  const taper = clamp(timeRatio, 0.2, 1);
  const turn = clamp(angle, 0, 180);
  const skew = clamp(asymmetry, -0.8, 0.8);
  const turnA = -turn * (1 - skew);
  const turnB = turn * (1 + skew);
  const maximum = Math.max(1, Math.min(
    MAX_BRANCHES_PER_GENERATION,
    Math.round(Number(maximumPerGeneration) || MAX_BRANCHES_PER_GENERATION),
  ));
  const trunk = {
    id: "trunk",
    parentId: null,
    generation: 0,
    index: 0,
    rule: "T",
    turnDegrees: 0,
    headingDegrees: 0,
    length: 1,
    startX: 0,
    startY: 0,
    x: 1,
    y: 0,
  };
  const nodes = [trunk];
  let frontier = [trunk];

  for (let generation = 1; generation <= count; generation += 1) {
    const forkCount = Math.round(frontier.length * branchAmount);
    const forkedIds = new Set(
      [...frontier]
        .sort((left, right) => hashUnit(`${generation}:${left.id}`) - hashUnit(`${generation}:${right.id}`))
        .slice(0, forkCount)
        .map((node) => node.id),
    );
    const candidates = [];
    for (const parent of frontier) {
      const rules = forkedIds.has(parent.id)
        ? [{ name: "A", turn: turnA }, { name: "B", turn: turnB }]
        : [{ name: "C", turn: 0 }];
      for (const rule of rules) {
        // Stable, per-rewrite variations keep slider gestures deterministic.
        // The same mutated turn and length feed both the drawing and audio.
        const identity = `${parent.id}/${rule.name}`;
        const turnVariation = (hashUnit(`${identity}:turn`) * 2 - 1)
          * turn * mutationAmount * 0.5;
        // Mutated timing may fold earlier, never beyond the selected Time
        // Fold × Child Time Ratio envelope, so the 12-generation safety cap
        // always fits the bounded audio history.
        const lengthVariation = hashUnit(`${identity}:length`)
          * mutationAmount * 0.3;
        const mutatedTurn = rule.turn + turnVariation;
        const headingDegrees = parent.headingDegrees + mutatedTurn;
        const heading = headingDegrees * Math.PI / 180;
        const length = Math.max(0.02, taper ** generation * (1 - lengthVariation));
        candidates.push({
          id: identity,
          parentId: parent.id,
          generation,
          index: candidates.length,
          rule: rule.name,
          turnDegrees: mutatedTurn,
          headingDegrees,
          length,
          startX: parent.x,
          startY: parent.y,
          x: parent.x + Math.cos(heading) * length,
          y: parent.y + Math.sin(heading) * length,
        });
      }
    }
    frontier = evenlyBounded(candidates, maximum).map((node, index) => ({ ...node, index }));
    nodes.push(...frontier);
  }
  return nodes;
}

/** Build inherited audio voices from the exact same L-system as the preview. */
export function generationVoiceSpecs({
  generations = 8,
  interval = 240,
  depth = 0.72,
  branching = 0.84,
  spread = 0.9,
  mutation = 0,
  timeRatio = 0.5,
  angle = 30,
  asymmetry = 0,
  pitchScale = 1,
} = {}) {
  const octaveScale = clamp(pitchScale, 0, 4);
  const layout = generationTopology({
    generations,
    branching,
    mutation,
    timeRatio,
    angle,
    asymmetry,
  });
  const perGeneration = new Map();
  for (const node of layout.slice(1)) {
    const group = perGeneration.get(node.generation) ?? [];
    group.push(node);
    perGeneration.set(node.generation, group);
  }
  const baseInterval = clamp(interval, 0.2, 2_400) / 1000;
  const lineage = new Map([["trunk", { delay: 0, interval: baseInterval, semitones: 0 }]]);
  const voices = [];
  const count = Math.max(...layout.map((node) => node.generation));
  const maximumY = Math.max(0.001, ...layout.map((node) => Math.abs(node.y)));
  for (let generation = 1; generation <= count; generation += 1) {
    const nodes = perGeneration.get(generation) ?? [];
    const generationGain = 0.5 * Math.pow(clamp(depth, 0, MAX_RECURSION_FEEDBACK), generation * 0.72);
    for (const node of nodes) {
      const parent = lineage.get(node.parentId) ?? lineage.get("trunk");
      const branchTurn = node.turnDegrees;
      const nextInterval = baseInterval * node.length;
      const cumulativeDelay = parent.delay + nextInterval;
      const cumulativeSemitones = parent.semitones + branchTurn / 180 * 12 * octaveScale;
      lineage.set(node.id, { delay: cumulativeDelay, interval: nextInterval, semitones: cumulativeSemitones });
      voices.push({
        key: `generation:${node.id}`,
        generation,
        rule: node.rule,
        parentId: node.parentId,
        turnDegrees: branchTurn,
        interval: nextInterval,
        delay: cumulativeDelay,
        rate: clamp(2 ** (cumulativeSemitones / 12), 0.125, 8),
        gain: generationGain / Math.sqrt(Math.max(1, nodes.length)),
        pan: clamp(node.y / maximumY * clamp(spread), -1, 1),
      });
    }
  }
  if (voices.length <= MAX_GENERATION_VOICES) return voices;
  const groups = Array.from({ length: count }, (_, index) => (
    voices.filter((voice) => voice.generation === index + 1)
  ));
  const quota = Math.max(1, Math.ceil(MAX_GENERATION_VOICES / groups.length));
  return groups.flatMap((group) => evenlyBounded(group, quota)).slice(0, MAX_GENERATION_VOICES);
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
