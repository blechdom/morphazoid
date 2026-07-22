export const MAX_RECURSION_FEEDBACK = 0.86;

export const FRACTAPHONE_PRESETS = Object.freeze({
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
    interval: 82,
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
  const interval = clamp(values.interval ?? 240, 70, 900);
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

export function echoTreeLayout(generationCount, branching = 1, maximumPerGeneration = 8) {
  const generations = Math.max(0, Math.min(8, Math.round(Number(generationCount) || 0)));
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
