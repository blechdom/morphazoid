export const MAX_RECURSION_FEEDBACK = 0.86;
export const MAX_GENERATION_STAGES = 12;
export const MAX_GENERATION_VOICES = 48;
export const MAX_BRANCHES_PER_GENERATION = 128;
export const GENERATION_RULE_PRESETS = Object.freeze({
  clean: Object.freeze({
    label: "Bamboo Shoot",
    description: "A nearly straight stalk of spacious, one-to-one echoes.",
    generations: 5,
    branching: 0,
    depth: 0.56,
    interval: 480,
    mutation: 0.02,
    timeRatio: 1,
    angle: 0,
    asymmetry: 0,
    pitchScale: 0.2,
  }),
  binary: Object.freeze({
    label: "Silver Birch",
    description: "A crisp, even fork that halves its timing at every crown.",
    generations: 9,
    branching: 1,
    depth: 0.64,
    interval: 360,
    mutation: 0.02,
    timeRatio: 0.5,
    angle: 28,
    asymmetry: 0,
    pitchScale: 0.85,
  }),
  pythagorean: Object.freeze({
    label: "Pythagorean Pine",
    description: "The balanced reference tree: clear forks, tapering time, and mirrored pitch.",
    generations: 7,
    branching: 1,
    depth: 0.72,
    interval: 240,
    mutation: 0,
    timeRatio: 0.72,
    angle: 45,
    asymmetry: 0,
    pitchScale: 1,
  }),
  plant: Object.freeze({
    label: "Fern Frond",
    description: "Fine, gently biased leaflets with lively but controlled variation.",
    generations: 10,
    branching: 0.82,
    depth: 0.74,
    interval: 180,
    mutation: 0.18,
    timeRatio: 0.74,
    angle: 22.5,
    asymmetry: 0.18,
    pitchScale: 1.1,
  }),
  willow: Object.freeze({
    label: "Weeping Willow",
    description: "Long, dark cascades leaning to one side with a lingering tail.",
    generations: 9,
    branching: 0.72,
    depth: 0.79,
    interval: 520,
    mutation: 0.26,
    timeRatio: 0.84,
    angle: 32,
    asymmetry: -0.38,
    pitchScale: 0.6,
  }),
  ivy: Object.freeze({
    label: "Midnight Ivy",
    description: "Twelve generations of climbing, skewed tendrils and quick echoes.",
    generations: 12,
    branching: 0.62,
    depth: 0.76,
    interval: 88,
    mutation: 0.42,
    timeRatio: 0.9,
    angle: 18,
    asymmetry: 0.54,
    pitchScale: 1.65,
  }),
  mangrove: Object.freeze({
    label: "Mangrove Roots",
    description: "Broad, low forks with heavy overlap and a slow submerged pulse.",
    generations: 8,
    branching: 0.96,
    depth: 0.82,
    interval: 880,
    mutation: 0.31,
    timeRatio: 0.68,
    angle: 52,
    asymmetry: -0.14,
    pitchScale: 0.72,
  }),
  sequoia: Object.freeze({
    label: "Giant Sequoia",
    description: "A deep twelve-generation canopy unfolding in monumental slow motion.",
    generations: 12,
    branching: 0.88,
    depth: 0.84,
    interval: 1_400,
    mutation: 0.06,
    timeRatio: 0.81,
    angle: 15,
    asymmetry: 0,
    pitchScale: 0.32,
  }),
  coral: Object.freeze({
    label: "Staghorn Coral",
    description: "A bright, branching colony with a leftward bias and colorful pitch spread.",
    generations: 9,
    branching: 0.9,
    depth: 0.7,
    interval: 120,
    mutation: 0.28,
    timeRatio: 0.72,
    angle: 36,
    asymmetry: -0.22,
    pitchScale: 1.4,
  }),
  dragon: Object.freeze({
    label: "Dragon Tree",
    description: "Sparse right-angle limbs that turn dramatically without rushing.",
    generations: 8,
    branching: 0.7,
    depth: 0.67,
    interval: 640,
    mutation: 0.12,
    timeRatio: Math.SQRT1_2,
    angle: 90,
    asymmetry: 0,
    pitchScale: 0.5,
  }),
  koch: Object.freeze({
    label: "Frosted Agave",
    description: "Geometric sixty-degree blades with sharply folded child timing.",
    generations: 7,
    branching: 1,
    depth: 0.61,
    interval: 720,
    mutation: 0.05,
    timeRatio: 1 / 3,
    angle: 60,
    asymmetry: 0,
    pitchScale: 1,
  }),
  orchid: Object.freeze({
    label: "Ghost Orchid",
    description: "A sparse, delicate bloom with wide intervals and floating high turns.",
    generations: 6,
    branching: 0.78,
    depth: 0.59,
    interval: 960,
    mutation: 0.24,
    timeRatio: 0.63,
    angle: 76,
    asymmetry: -0.44,
    pitchScale: 2.7,
  }),
  kelp: Object.freeze({
    label: "Kelp Forest",
    description: "Deep, swaying branches with broad stereo-like pitch motion.",
    generations: 9,
    branching: 0.86,
    depth: 0.8,
    interval: 300,
    mutation: 0.48,
    timeRatio: 0.88,
    angle: 38,
    asymmetry: 0.46,
    pitchScale: 0.9,
  }),
  moss: Object.freeze({
    label: "Moss Carpet",
    description: "Tiny rapid folds accumulate into a low, diffuse recursive field.",
    generations: 12,
    branching: 0.58,
    depth: 0.69,
    interval: 16,
    mutation: 0.66,
    timeRatio: 0.93,
    angle: 12,
    asymmetry: -0.18,
    pitchScale: 0.22,
  }),
  bramble: Object.freeze({
    label: "Blackberry Bramble",
    description: "Fast, thorny forks with strong pitch turns and unruly mutation.",
    generations: 11,
    branching: 1,
    depth: 0.68,
    interval: 42,
    mutation: 0.74,
    timeRatio: 0.57,
    angle: 67,
    asymmetry: 0.28,
    pitchScale: 2.2,
  }),
  venus: Object.freeze({
    label: "Venus Flytrap",
    description: "Extreme folding jaws snap across a three-octave angle mapping.",
    generations: 7,
    branching: 0.9,
    depth: 0.69,
    interval: 210,
    mutation: 0.4,
    timeRatio: 0.61,
    angle: 110,
    asymmetry: 0.14,
    pitchScale: 3.2,
  }),
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

function boundedConnectedVoices(voices, maximum, deepestGeneration) {
  if (voices.length <= maximum) return voices;
  const voiceId = (voice) => voice.key.replace(/^generation:/, "");
  const byId = new Map(voices.map((voice) => [voiceId(voice), voice]));
  const selected = new Set();
  const deepest = voices
    .filter((voice) => voice.generation === deepestGeneration)
    .sort((left, right) => (
      hashUnit(`audible:${voiceId(left)}`) - hashUnit(`audible:${voiceId(right)}`)
    ));

  for (const target of deepest) {
    const path = [];
    let cursor = target;
    while (cursor) {
      const id = voiceId(cursor);
      if (!selected.has(id)) path.unshift(id);
      cursor = cursor.parentId === "trunk" ? null : byId.get(cursor.parentId);
    }
    if (selected.size + path.length > maximum) continue;
    for (const id of path) selected.add(id);
    if (selected.size === maximum) break;
  }

  // Spend any remaining budget only on children whose parent is already
  // audible. This keeps every highlighted buffer connected to the seed.
  for (const voice of voices) {
    if (selected.size >= maximum) break;
    const id = voiceId(voice);
    if (selected.has(id)) continue;
    if (voice.parentId === "trunk" || selected.has(voice.parentId)) selected.add(id);
  }
  return voices.filter((voice) => selected.has(voiceId(voice))).slice(0, maximum);
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
  const depthAmount = clamp(depth, 0, MAX_RECURSION_FEEDBACK);
  const lineage = new Map([["trunk", { delay: 0, interval: baseInterval, semitones: 0 }]]);
  const voices = [];
  const count = Math.max(...layout.map((node) => node.generation));
  const maximumY = Math.max(0.001, ...layout.map((node) => Math.abs(node.y)));
  for (let generation = 1; generation <= count; generation += 1) {
    const nodes = perGeneration.get(generation) ?? [];
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
        gain: 0,
        pan: clamp(node.y / maximumY * clamp(spread), -1, 1),
      });
    }
  }
  const selected = boundedConnectedVoices(voices, MAX_GENERATION_VOICES, count);
  const selectedPerGeneration = new Map();
  for (const voice of selected) {
    selectedPerGeneration.set(
      voice.generation,
      (selectedPerGeneration.get(voice.generation) ?? 0) + 1,
    );
  }
  return selected.map((voice) => ({
    ...voice,
    gain: 0.5
      * Math.pow(depthAmount, voice.generation * 0.72)
      / Math.sqrt(selectedPerGeneration.get(voice.generation) ?? 1),
  }));
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
