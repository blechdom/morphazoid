export const MAX_RECURSION_FEEDBACK = 0.96;
export const MAX_GENERATION_STAGES = 13;
export const MAX_GENERATION_VOICES = 48;
export const MAX_ADAPTIVE_GENERATION_VOICES = 1024;
export const MAX_BRANCHES_PER_GENERATION = 128;
export const FIXED_FORK_DENSITY = 1;
export const MIN_TIME_FOLD_MS = 1;
export const MAX_TIME_FOLD_MS = 3_000;
export const TIME_FOLD_SLIDER_STEPS = 1_000;
export const TIME_FOLD_LOW_MS = 50;
export const TIME_FOLD_HIGH_MS = 1_000;
export const TIME_FOLD_LOW_SLIDER = 150;
export const TIME_FOLD_HIGH_SLIDER = 900;
export const MIN_CHILD_TIME_RATIO = 0.2;
export const MAX_CHILD_TIME_RATIO = 2;
export const MAX_GENERATION_DELAY_SECONDS = 39;
const MAX_VISUAL_CHILD_TIME_RATIO = 1.08;
export const GENERATION_RULE_PRESETS = Object.freeze({
  clean: Object.freeze({
    label: "Bamboo Shoot",
    description: "Pure, unpitched repeats rise slowly at a long one-to-one interval.",
    generations: 5,
    branching: FIXED_FORK_DENSITY,
    depth: 0.55,
    interval: 1_650,
    mutation: 0,
    timeRatio: 1,
    angle: 0,
    asymmetry: 0,
    pitchScale: 0,
  }),
  binary: Object.freeze({
    label: "Silver Birch",
    description: "An 85 ms clockwork fork halves its timing cleanly at every crown.",
    generations: 9,
    branching: FIXED_FORK_DENSITY,
    depth: 0.68,
    interval: 85,
    mutation: 0.02,
    timeRatio: 0.5,
    angle: 30,
    asymmetry: 0,
    pitchScale: 0.9,
  }),
  pythagorean: Object.freeze({
    label: "Pythagorean Pine",
    description: "The full reference canopy: clear forks, tapering time, and mirrored pitch.",
    generations: MAX_GENERATION_STAGES,
    branching: FIXED_FORK_DENSITY,
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
    description: "A bouncing 420 ms organic rhythm grows gently biased, lightly varied leaflets.",
    generations: 10,
    branching: FIXED_FORK_DENSITY,
    depth: 0.76,
    interval: 420,
    mutation: 0.16,
    timeRatio: 0.78,
    angle: 23,
    asymmetry: 0.18,
    pitchScale: 1.05,
  }),
  willow: Object.freeze({
    label: "Weeping Willow",
    description: "A smooth 2.3 second fold droops into a long, dark, gently pitched cascade.",
    generations: 9,
    branching: FIXED_FORK_DENSITY,
    depth: 0.88,
    interval: 2_300,
    mutation: 0.12,
    timeRatio: 0.88,
    angle: 30,
    asymmetry: -0.42,
    pitchScale: 0.45,
  }),
  ivy: Object.freeze({
    label: "Midnight Ivy",
    description: "A tight 38 ms motor widens its spacing 1.35× through twelve skewed generations.",
    generations: 12,
    branching: FIXED_FORK_DENSITY,
    depth: 0.81,
    interval: 38,
    mutation: 0.55,
    timeRatio: 1.35,
    angle: 18,
    asymmetry: 0.6,
    pitchScale: 1.7,
  }),
  mangrove: Object.freeze({
    label: "Mangrove Roots",
    description: "Broad low forks emerge from a smooth 2.7 second submerged pulse.",
    generations: 8,
    branching: FIXED_FORK_DENSITY,
    depth: 0.86,
    interval: 2_700,
    mutation: 0.1,
    timeRatio: 0.76,
    angle: 55,
    asymmetry: -0.16,
    pitchScale: 0.35,
  }),
  sequoia: Object.freeze({
    label: "Giant Sequoia",
    description: "The longest smooth preset unfolds thirteen persistent generations over a 3 second fold.",
    generations: MAX_GENERATION_STAGES,
    branching: FIXED_FORK_DENSITY,
    depth: 0.94,
    interval: MAX_TIME_FOLD_MS,
    mutation: 0.02,
    timeRatio: 0.97,
    angle: 12,
    asymmetry: 0,
    pitchScale: 0.18,
  }),
  coral: Object.freeze({
    label: "Staghorn Coral",
    description: "A bright 160 ms ping lattice flickers with colorful mutation and a leftward bias.",
    generations: 9,
    branching: FIXED_FORK_DENSITY,
    depth: 0.71,
    interval: 160,
    mutation: 0.52,
    timeRatio: 0.66,
    angle: 44,
    asymmetry: -0.28,
    pitchScale: 1.55,
  }),
  dragon: Object.freeze({
    label: "Dragon Tree",
    description: "Measured 1.05 second pulses travel through dramatic right-angle limbs.",
    generations: 8,
    branching: FIXED_FORK_DENSITY,
    depth: 0.65,
    interval: 1_050,
    mutation: 0.08,
    timeRatio: Math.SQRT1_2,
    angle: 90,
    asymmetry: 0,
    pitchScale: 0.5,
  }),
  koch: Object.freeze({
    label: "Frosted Agave",
    description: "A 1.35 second geometric fold contracts into exact timing thirds.",
    generations: 7,
    branching: FIXED_FORK_DENSITY,
    depth: 0.62,
    interval: 1_350,
    mutation: 0.03,
    timeRatio: 1 / 3,
    angle: 60,
    asymmetry: 0,
    pitchScale: 1,
  }),
  orchid: Object.freeze({
    label: "Ghost Orchid",
    description: "A sparse 1.95 second bloom floats through wide, smooth harmonic turns.",
    generations: 6,
    branching: FIXED_FORK_DENSITY,
    depth: 0.6,
    interval: 1_950,
    mutation: 0.08,
    timeRatio: 0.68,
    angle: 80,
    asymmetry: -0.45,
    pitchScale: 1.2,
  }),
  kelp: Object.freeze({
    label: "Kelp Forest",
    description: "A rolling 750 ms smear expands gently through deep branches and broad pitch motion.",
    generations: 10,
    branching: FIXED_FORK_DENSITY,
    depth: 0.84,
    interval: 750,
    mutation: 0.55,
    timeRatio: 1.08,
    angle: 35,
    asymmetry: 0.48,
    pitchScale: 0.7,
  }),
  moss: Object.freeze({
    label: "Moss Carpet",
    description: "A metallic 1 ms micro-comb doubles its spacing into a long robotic canopy.",
    generations: MAX_GENERATION_STAGES,
    branching: FIXED_FORK_DENSITY,
    depth: 0.86,
    interval: MIN_TIME_FOLD_MS,
    mutation: 0.18,
    timeRatio: 2,
    angle: 6,
    asymmetry: -0.1,
    pitchScale: 0.2,
  }),
  bramble: Object.freeze({
    label: "Blackberry Bramble",
    description: "A shredded 4 ms robot swarm expands 1.65× through thorny, unruly forks.",
    generations: 11,
    branching: FIXED_FORK_DENSITY,
    depth: 0.74,
    interval: 4,
    mutation: 0.86,
    timeRatio: 1.65,
    angle: 72,
    asymmetry: 0.38,
    pitchScale: 2.4,
  }),
  venus: Object.freeze({
    label: "Venus Flytrap",
    description: "Hard 14 ms servo jaws double their spacing across an extreme pitch span.",
    generations: 7,
    branching: FIXED_FORK_DENSITY,
    depth: 0.62,
    interval: 14,
    mutation: 0.32,
    timeRatio: 2,
    angle: 135,
    asymmetry: 0.25,
    pitchScale: 3.6,
  }),
});

export const MICMIC_PRESETS = Object.freeze({
  tunnel: Object.freeze({
    label: "Tunnel",
    interval: 360,
    depth: 0.64,
    branching: FIXED_FORK_DENSITY,
    mutation: 0.18,
    spread: 0.56,
    wet: 0.78,
    dry: 0,
  }),
  bloom: Object.freeze({
    label: "Bloom",
    interval: 240,
    depth: 0.72,
    branching: FIXED_FORK_DENSITY,
    mutation: 0.3,
    spread: 0.9,
    wet: 0.76,
    dry: 0,
  }),
  choir: Object.freeze({
    label: "Choir",
    interval: 135,
    depth: 0.76,
    branching: FIXED_FORK_DENSITY,
    mutation: 0.56,
    spread: 0.7,
    wet: 0.68,
    dry: 0.08,
  }),
  fray: Object.freeze({
    label: "Fray",
    interval: 38,
    depth: 0.8,
    branching: FIXED_FORK_DENSITY,
    mutation: 0.9,
    spread: 1,
    wet: 0.7,
    dry: 0,
  }),
});

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function timeFoldFromSlider(position) {
  const slider = clamp(position, 0, TIME_FOLD_SLIDER_STEPS);
  if (slider <= TIME_FOLD_LOW_SLIDER) {
    const normalized = slider / TIME_FOLD_LOW_SLIDER;
    return Math.round(
      MIN_TIME_FOLD_MS
        + (TIME_FOLD_LOW_MS - MIN_TIME_FOLD_MS) * normalized,
    );
  }
  if (slider <= TIME_FOLD_HIGH_SLIDER) {
    const normalized = (slider - TIME_FOLD_LOW_SLIDER)
      / (TIME_FOLD_HIGH_SLIDER - TIME_FOLD_LOW_SLIDER);
    return Math.round(
      TIME_FOLD_LOW_MS
        + (TIME_FOLD_HIGH_MS - TIME_FOLD_LOW_MS) * normalized,
    );
  }
  const normalized = (slider - TIME_FOLD_HIGH_SLIDER)
    / (TIME_FOLD_SLIDER_STEPS - TIME_FOLD_HIGH_SLIDER);
  return Math.round(
    TIME_FOLD_HIGH_MS
      + (MAX_TIME_FOLD_MS - TIME_FOLD_HIGH_MS) * normalized,
  );
}

export function sliderFromTimeFold(milliseconds) {
  const value = Math.round(clamp(
    milliseconds,
    MIN_TIME_FOLD_MS,
    MAX_TIME_FOLD_MS,
  ));
  if (value <= TIME_FOLD_LOW_MS) {
    return (value - MIN_TIME_FOLD_MS)
      / (TIME_FOLD_LOW_MS - MIN_TIME_FOLD_MS)
      * TIME_FOLD_LOW_SLIDER;
  }
  if (value <= TIME_FOLD_HIGH_MS) {
    return TIME_FOLD_LOW_SLIDER
      + (value - TIME_FOLD_LOW_MS)
        / (TIME_FOLD_HIGH_MS - TIME_FOLD_LOW_MS)
        * (TIME_FOLD_HIGH_SLIDER - TIME_FOLD_LOW_SLIDER);
  }
  return TIME_FOLD_HIGH_SLIDER
    + (value - TIME_FOLD_HIGH_MS)
      / (MAX_TIME_FOLD_MS - TIME_FOLD_HIGH_MS)
      * (TIME_FOLD_SLIDER_STEPS - TIME_FOLD_HIGH_SLIDER);
}

export function generationTailSeconds({
  interval = 240,
  generations = 8,
  timeRatio = 0.5,
} = {}) {
  const baseInterval = clamp(
    interval,
    MIN_TIME_FOLD_MS,
    MAX_TIME_FOLD_MS,
  ) / 1000;
  const count = Math.max(
    1,
    Math.min(MAX_GENERATION_STAGES, Math.round(Number(generations) || 1)),
  );
  const ratio = clamp(
    timeRatio,
    MIN_CHILD_TIME_RATIO,
    MAX_CHILD_TIME_RATIO,
  );
  let tail = 0;
  for (let generation = 1; generation <= count; generation += 1) {
    tail += baseInterval * ratio ** generation;
  }
  return tail;
}

function visualChildTimeRatio(timeRatio) {
  const ratio = clamp(
    timeRatio,
    MIN_CHILD_TIME_RATIO,
    MAX_CHILD_TIME_RATIO,
  );
  if (ratio <= 1) return ratio;
  return 1 + Math.log2(ratio) * (MAX_VISUAL_CHILD_TIME_RATIO - 1);
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
  const interval = clamp(
    values.interval ?? 240,
    MIN_TIME_FOLD_MS,
    MAX_TIME_FOLD_MS,
  );
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

function deepestConnectedVoiceOrder(voices, deepestGeneration) {
  const voiceId = (voice) => voice.key.replace(/^generation:/, "");
  const byId = new Map(voices.map((voice) => [voiceId(voice), voice]));
  const selected = new Set();
  const ordered = [];
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
      if (!selected.has(id)) path.unshift(cursor);
      cursor = cursor.parentId === "trunk" ? null : byId.get(cursor.parentId);
    }
    for (const voice of path) {
      const id = voiceId(voice);
      if (selected.has(id)) continue;
      selected.add(id);
      ordered.push(voice);
    }
  }

  // Append any non-deep descendants in topological order. Because parents are
  // always admitted before children, every prefix is a valid connected tree.
  for (const voice of voices) {
    const id = voiceId(voice);
    if (selected.has(id)) continue;
    if (voice.parentId === "trunk" || selected.has(voice.parentId)) {
      selected.add(id);
      ordered.push(voice);
    }
  }
  return ordered;
}

function blendedConnectedVoiceOrder(voices, deepestGeneration, pruningBias) {
  const depthBias = clamp(pruningBias, 0, 1);
  if (depthBias <= 0) return voices;
  const depthOrder = deepestConnectedVoiceOrder(voices, deepestGeneration);
  if (depthBias >= 1) return depthOrder;

  const voiceId = (voice) => voice.key.replace(/^generation:/, "");
  const countScale = 1 / Math.max(1, voices.length - 1);
  const breadthRank = new Map(voices.map((voice, index) => [
    voice.key,
    index * countScale,
  ]));
  const depthRank = new Map(depthOrder.map((voice, index) => [
    voice.key,
    index * countScale,
  ]));
  const priority = new Map(voices.map((voice) => [
    voice.key,
    (breadthRank.get(voice.key) ?? 1) * (1 - depthBias)
      + (depthRank.get(voice.key) ?? 1) * depthBias,
  ]));
  const children = new Map();
  for (const voice of voices) {
    const siblings = children.get(voice.parentId) ?? [];
    siblings.push(voice);
    children.set(voice.parentId, siblings);
  }
  const compare = (left, right) => (
    (priority.get(left.key) ?? 1) - (priority.get(right.key) ?? 1)
    || (breadthRank.get(left.key) ?? 1) - (breadthRank.get(right.key) ?? 1)
  );
  const eligible = [];
  const push = (voice) => {
    eligible.push(voice);
    let index = eligible.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(eligible[parent], eligible[index]) <= 0) break;
      [eligible[parent], eligible[index]] = [eligible[index], eligible[parent]];
      index = parent;
    }
  };
  const pop = () => {
    const first = eligible[0];
    const last = eligible.pop();
    if (eligible.length && last) {
      eligible[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < eligible.length && compare(eligible[left], eligible[smallest]) < 0) {
          smallest = left;
        }
        if (right < eligible.length && compare(eligible[right], eligible[smallest]) < 0) {
          smallest = right;
        }
        if (smallest === index) break;
        [eligible[index], eligible[smallest]] = [eligible[smallest], eligible[index]];
        index = smallest;
      }
    }
    return first;
  };

  for (const root of children.get("trunk") ?? []) push(root);
  const ordered = [];
  while (eligible.length) {
    const voice = pop();
    ordered.push(voice);
    for (const child of children.get(voiceId(voice)) ?? []) push(child);
  }
  return ordered;
}

function boundedConnectedVoices(
  voices,
  maximum,
  deepestGeneration,
  pruningBias = 0,
) {
  if (voices.length <= maximum) return voices;
  return blendedConnectedVoiceOrder(
    voices,
    deepestGeneration,
    pruningBias,
  ).slice(0, maximum);
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
  const taper = clamp(
    timeRatio,
    MIN_CHILD_TIME_RATIO,
    MAX_CHILD_TIME_RATIO,
  );
  const visualTaper = visualChildTimeRatio(taper);
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
        // The same mutation feeds exact audio timing and its compressed drawing.
        const identity = `${parent.id}/${rule.name}`;
        const turnVariation = (hashUnit(`${identity}:turn`) * 2 - 1)
          * turn * mutationAmount * 0.5;
        // Mutation can shorten, but never lengthen, the exact timing rewrite.
        // Drawing compresses ratios above one so the fixed trunk stays visible;
        // audio retains the literal expanding ratio in `timeScale`.
        const lengthVariation = hashUnit(`${identity}:length`)
          * mutationAmount * 0.3;
        const mutatedTurn = rule.turn + turnVariation;
        const headingDegrees = parent.headingDegrees + mutatedTurn;
        const heading = headingDegrees * Math.PI / 180;
        const timeScale = taper ** generation * (1 - lengthVariation);
        const length = Math.max(
          0.02,
          visualTaper ** generation * (1 - lengthVariation),
        );
        candidates.push({
          id: identity,
          parentId: parent.id,
          generation,
          index: candidates.length,
          rule: rule.name,
          turnDegrees: mutatedTurn,
          headingDegrees,
          timeScale,
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
  pruningBias = 0,
  maximumVoices = MAX_GENERATION_VOICES,
} = {}) {
  const octaveScale = clamp(pitchScale, 0, 4);
  const exactTimeRatio = clamp(
    timeRatio,
    MIN_CHILD_TIME_RATIO,
    MAX_CHILD_TIME_RATIO,
  );
  const layout = generationTopology({
    generations,
    branching,
    mutation,
    timeRatio: exactTimeRatio,
    angle,
    asymmetry,
  });
  const perGeneration = new Map();
  for (const node of layout.slice(1)) {
    const group = perGeneration.get(node.generation) ?? [];
    group.push(node);
    perGeneration.set(node.generation, group);
  }
  const baseInterval = clamp(
    interval,
    MIN_TIME_FOLD_MS,
    MAX_TIME_FOLD_MS,
  ) / 1000;
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
      const nextInterval = baseInterval * (node.timeScale ?? node.length);
      const cumulativeDelay = parent.delay + nextInterval;
      const cumulativeSemitones = parent.semitones + branchTurn / 180 * 12 * octaveScale;
      lineage.set(node.id, { delay: cumulativeDelay, interval: nextInterval, semitones: cumulativeSemitones });
      if (cumulativeDelay > MAX_GENERATION_DELAY_SECONDS + 1e-9) continue;
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
  const voiceLimit = Math.max(1, Math.min(
    MAX_ADAPTIVE_GENERATION_VOICES,
    Math.round(Number(maximumVoices) || MAX_GENERATION_VOICES),
  ));
  const selected = boundedConnectedVoices(
    voices,
    voiceLimit,
    count,
    pruningBias,
  );
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
