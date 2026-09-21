const DEFAULT_SEED = 0x51c0ffee;
const DEFAULT_SAMPLE_RATE = 48_000;

export const ALGORITHMIC_SCORE_LIMITS = Object.freeze({
  minComplexity: 1,
  maxComplexity: 8,
  minTempoBpm: 40,
  maxTempoBpm: 240,
  minBaseFrequencyHz: 45,
  maxBaseFrequencyHz: 440,
  minPitchSpanOctaves: 1,
  maxPitchSpanOctaves: 6,
  maxOutput: 0.82,
});

export const ALGORITHMIC_SCORE_PRESETS = Object.freeze([
  Object.freeze({
    id: "dijkstra",
    label: "Dijkstra",
    shortLabel: "Path",
    family: "Weighted graph search",
    accent: "#69e7ff",
    description: "A weighted frontier spreads across the graph until its cheapest path locks in.",
    signature: "frontier chords and distance pulses",
  }),
  Object.freeze({
    id: "hanoi",
    label: "Towers of Hanoi",
    shortLabel: "Hanoi",
    family: "Recursive movement",
    accent: "#e8c46b",
    description: "Recursive disk transfers ring between three spatially separated pegs.",
    signature: "metallic recursive bells",
  }),
  Object.freeze({
    id: "minimax",
    label: "Minimax + Alpha-Beta",
    shortLabel: "Minimax",
    family: "Adversarial tree search",
    accent: "#ff826f",
    description: "Competing evaluations climb the tree while alpha-beta cuts whole branches silent.",
    signature: "tense calls, answers, and cuts",
  }),
  Object.freeze({
    id: "nqueens",
    label: "N-Queens",
    shortLabel: "Queens",
    family: "Constraint backtracking",
    accent: "#75ef9d",
    description: "Queens accumulate as harmony, collide as noise, and unwind through backtracking.",
    signature: "building chords and reverse falls",
  }),
  Object.freeze({
    id: "euclid",
    label: "Euclidean GCD",
    shortLabel: "Euclid",
    family: "Number theory",
    accent: "#c79bff",
    description: "Remainders descend while each quotient stamps out a compact rhythmic cell.",
    signature: "remainder bass and quotient drums",
  }),
]);

const defineInstrument = (
  id,
  href,
  title,
  eyebrow,
  mutationLabel,
  defaults,
  audio,
) => Object.freeze({
  id,
  href,
  title,
  eyebrow,
  mutationLabel,
  defaults: Object.freeze({ algorithmId: id, ...defaults }),
  audio: Object.freeze(audio),
});

export const ALGORITHMIC_INSTRUMENTS = Object.freeze([
  defineInstrument(
    "dijkstra",
    "dijkstra.html",
    "DJ Dijkstra",
    "WEIGHTED GRAPH SYNTH",
    "Rewire graph",
    {
      complexity: 5,
      tempoBpm: 144,
      swing: 0.13,
      intensity: 0.84,
      brightness: 0.72,
      roughness: 0.3,
      space: 0.38,
      baseFrequencyHz: 82,
      pitchSpanOctaves: 4.8,
      output: 0.5,
      loop: true,
    },
    {
      dry: 0.82,
      delayBase: 0.07,
      delayRange: 0.34,
      feedbackScale: 0.72,
      wetScale: 0.58,
      filterBase: 1_000,
      filterRange: 9_000,
      compressorThreshold: -18,
      compressorRatio: 6,
      compressorRelease: 0.2,
    },
  ),
  defineInstrument(
    "hanoi",
    "hanoi.html",
    "Hanoi Carillon",
    "RECURSIVE BELL SYNTH",
    "Recast tower",
    {
      complexity: 4,
      tempoBpm: 116,
      swing: 0.21,
      intensity: 0.77,
      brightness: 0.84,
      roughness: 0.25,
      space: 0.62,
      baseFrequencyHz: 96,
      pitchSpanOctaves: 3.6,
      output: 0.48,
      loop: true,
    },
    {
      dry: 0.72,
      delayBase: 0.16,
      delayRange: 0.62,
      feedbackScale: 0.82,
      wetScale: 0.78,
      filterBase: 1_500,
      filterRange: 10_000,
      compressorThreshold: -20,
      compressorRatio: 4,
      compressorRelease: 0.42,
    },
  ),
  defineInstrument(
    "minimax",
    "minimax.html",
    "Alpha-Beta Minimax",
    "ADVERSARIAL SEARCH SYNTH",
    "Reseed contest",
    {
      complexity: 6,
      tempoBpm: 168,
      swing: 0.08,
      intensity: 0.9,
      brightness: 0.76,
      roughness: 0.68,
      space: 0.2,
      baseFrequencyHz: 73,
      pitchSpanOctaves: 4.5,
      output: 0.47,
      loop: true,
    },
    {
      dry: 0.92,
      delayBase: 0.045,
      delayRange: 0.2,
      feedbackScale: 0.58,
      wetScale: 0.4,
      filterBase: 800,
      filterRange: 10_500,
      compressorThreshold: -22,
      compressorRatio: 9,
      compressorRelease: 0.11,
    },
  ),
  defineInstrument(
    "nqueens",
    "nqueens.html",
    "N-Queens Backtracker",
    "CONSTRAINT HARMONY SYNTH",
    "Shuffle columns",
    {
      complexity: 5,
      tempoBpm: 152,
      swing: 0.24,
      intensity: 0.86,
      brightness: 0.66,
      roughness: 0.53,
      space: 0.48,
      baseFrequencyHz: 110,
      pitchSpanOctaves: 4,
      output: 0.48,
      loop: true,
    },
    {
      dry: 0.78,
      delayBase: 0.12,
      delayRange: 0.46,
      feedbackScale: 0.77,
      wetScale: 0.72,
      filterBase: 1_200,
      filterRange: 8_800,
      compressorThreshold: -20,
      compressorRatio: 6,
      compressorRelease: 0.28,
    },
  ),
  defineInstrument(
    "euclid",
    "euclid.html",
    "Euclidean Pulse",
    "NUMBER THEORY RHYTHM SYNTH",
    "Choose new ratio",
    {
      complexity: 6,
      tempoBpm: 136,
      swing: 0.29,
      intensity: 0.92,
      brightness: 0.58,
      roughness: 0.72,
      space: 0.27,
      baseFrequencyHz: 55,
      pitchSpanOctaves: 3.3,
      output: 0.49,
      loop: true,
    },
    {
      dry: 0.9,
      delayBase: 0.06,
      delayRange: 0.28,
      feedbackScale: 0.64,
      wetScale: 0.46,
      filterBase: 700,
      filterRange: 7_400,
      compressorThreshold: -24,
      compressorRatio: 10,
      compressorRelease: 0.14,
    },
  ),
]);

export function algorithmicInstrumentById(id) {
  return ALGORITHMIC_INSTRUMENTS.find((instrument) => instrument.id === id)
    ?? ALGORITHMIC_INSTRUMENTS[0];
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
  return Math.round(clamp(value, minimum, maximum, fallback));
}

function presetById(id) {
  return ALGORITHMIC_SCORE_PRESETS.find((preset) => preset.id === id)
    ?? ALGORITHMIC_SCORE_PRESETS[0];
}

function normalizeSeed(value, fallback = DEFAULT_SEED) {
  const seed = Math.trunc(finiteNumber(value, fallback)) >>> 0;
  return seed || fallback;
}

function createRandom(seed) {
  let state = normalizeSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function createEvent(algorithmId, stepIndex, event) {
  return deepFreeze({
    ...event,
    algorithmId,
    stepIndex,
    kind: event.kind ?? "step",
    phase: event.phase ?? event.kind ?? "step",
    beat: clamp(event.beat, 0.0625, 2, 0.25),
    primary: clamp(event.primary, 0, 1, 0.5),
    secondary: clamp(event.secondary, 0, 1, event.primary ?? 0.5),
    x: clamp(event.x, 0, 1, 0.5),
    y: clamp(event.y, 0, 1, 0.5),
    energy: clamp(event.energy, 0, 1, 0.5),
    accent: Boolean(event.accent),
  });
}

function finalizeEvents(algorithmId, events) {
  return Object.freeze(events.map((event, stepIndex) => createEvent(
    algorithmId,
    stepIndex,
    event,
  )));
}

export function sanitizeAlgorithmicScoreParams(params = {}) {
  return Object.freeze({
    algorithmId: presetById(params.algorithmId).id,
    seed: normalizeSeed(params.seed),
    complexity: clampInteger(
      params.complexity,
      ALGORITHMIC_SCORE_LIMITS.minComplexity,
      ALGORITHMIC_SCORE_LIMITS.maxComplexity,
      4,
    ),
    tempoBpm: clamp(
      params.tempoBpm,
      ALGORITHMIC_SCORE_LIMITS.minTempoBpm,
      ALGORITHMIC_SCORE_LIMITS.maxTempoBpm,
      132,
    ),
    swing: clamp(params.swing, 0, 0.46, 0.16),
    intensity: clamp(params.intensity, 0, 1, 0.82),
    brightness: clamp(params.brightness, 0, 1, 0.68),
    roughness: clamp(params.roughness, 0, 1, 0.46),
    space: clamp(params.space, 0, 0.88, 0.34),
    baseFrequencyHz: clamp(
      params.baseFrequencyHz,
      ALGORITHMIC_SCORE_LIMITS.minBaseFrequencyHz,
      ALGORITHMIC_SCORE_LIMITS.maxBaseFrequencyHz,
      110,
    ),
    pitchSpanOctaves: clamp(
      params.pitchSpanOctaves,
      ALGORITHMIC_SCORE_LIMITS.minPitchSpanOctaves,
      ALGORITHMIC_SCORE_LIMITS.maxPitchSpanOctaves,
      4.2,
    ),
    output: clamp(params.output, 0, ALGORITHMIC_SCORE_LIMITS.maxOutput, 0.52),
    loop: params.loop === undefined ? true : Boolean(params.loop),
  });
}

function gridNeighbors(node, width, height) {
  const x = node % width;
  const y = Math.floor(node / width);
  const result = [];
  if (x > 0) result.push(node - 1);
  if (x < width - 1) result.push(node + 1);
  if (y > 0) result.push(node - width);
  if (y < height - 1) result.push(node + width);
  return result;
}

export function generateDijkstraScore(params = {}) {
  const settings = sanitizeAlgorithmicScoreParams({ ...params, algorithmId: "dijkstra" });
  const random = createRandom(settings.seed);
  const width = 7 + settings.complexity;
  const height = 5 + Math.floor(settings.complexity * 0.65);
  const nodeCount = width * height;
  const start = (height - 1) * width;
  const goal = width - 1;
  const weights = Array.from({ length: nodeCount }, () => 1 + Math.floor(random() * 9));
  weights[start] = 1;
  weights[goal] = 1;
  const distances = Array(nodeCount).fill(Infinity);
  const previous = Array(nodeCount).fill(-1);
  const settled = Array(nodeCount).fill(false);
  const frontier = new Set([start]);
  const settledOrder = [];
  const events = [];
  distances[start] = 0;

  while (frontier.size > 0) {
    let current = -1;
    let currentDistance = Infinity;
    for (const node of frontier) {
      if (distances[node] < currentDistance) {
        current = node;
        currentDistance = distances[node];
      }
    }
    if (current < 0) break;
    frontier.delete(current);
    if (settled[current]) continue;
    settled[current] = true;
    settledOrder.push(current);

    for (const neighbor of gridNeighbors(current, width, height)) {
      if (settled[neighbor]) continue;
      const candidate = currentDistance + weights[neighbor];
      if (candidate < distances[neighbor]) {
        distances[neighbor] = candidate;
        previous[neighbor] = current;
      }
      frontier.add(neighbor);
    }

    const x = (current % width) / Math.max(1, width - 1);
    const y = Math.floor(current / width) / Math.max(1, height - 1);
    events.push({
      kind: current === goal ? "goal" : "settle",
      phase: current === goal ? "goal reached" : "settle cheapest",
      beat: current === goal ? 1 : 0.25 + (frontier.size % 3) * 0.0625,
      primary: clamp(currentDistance / ((width + height) * 5), 0, 1, 0),
      secondary: weights[current] / 9,
      x,
      y,
      energy: clamp(frontier.size / (width + height), 0.18, 1, 0.4),
      accent: current === goal,
      node: current,
      distance: currentDistance,
      weight: weights[current],
      settled: [...settledOrder],
      frontier: [...frontier].sort((left, right) => distances[left] - distances[right]),
    });
    if (current === goal) break;
  }

  const path = [];
  for (let node = goal; node >= 0; node = previous[node]) {
    path.push(node);
    if (node === start) break;
  }
  path.reverse();
  events.push({
    kind: "path",
    phase: "shortest path",
    beat: 1.5,
    primary: clamp(distances[goal] / ((width + height) * 5), 0, 1, 0.5),
    secondary: path.length / nodeCount,
    x: 1,
    y: 0,
    energy: 1,
    accent: true,
    node: goal,
    distance: distances[goal],
    settled: [...settledOrder],
    frontier: [],
    path: [...path],
  });

  return deepFreeze({
    settings,
    preset: presetById("dijkstra"),
    scene: {
      type: "dijkstra",
      width,
      height,
      weights,
      start,
      goal,
      path,
    },
    events: finalizeEvents("dijkstra", events),
    summary: `${nodeCount} nodes / cost ${distances[goal]} / ${path.length} path nodes`,
    complexityLabel: `${width} x ${height} weighted grid`,
    metrics: {
      nodeCount,
      settledCount: settledOrder.length,
      pathCost: distances[goal],
      pathLength: path.length,
    },
  });
}

export function generateHanoiScore(params = {}) {
  const settings = sanitizeAlgorithmicScoreParams({ ...params, algorithmId: "hanoi" });
  const disks = 3 + Math.floor(((settings.complexity - 1) * 5) / 7);
  const target = settings.seed % 2 === 0 ? 2 : 1;
  const auxiliary = target === 2 ? 1 : 2;
  const stacks = [
    Array.from({ length: disks }, (_, index) => disks - index),
    [],
    [],
  ];
  const initialStacks = stacks.map((stack) => [...stack]);
  const events = [];

  function move(count, from, to, spare, depth) {
    if (count <= 0) return;
    move(count - 1, from, spare, to, depth + 1);
    const disk = stacks[from].pop();
    stacks[to].push(disk);
    const pitch = 1 - (disk - 1) / Math.max(1, disks - 1);
    events.push({
      kind: "move",
      phase: `disk ${disk} / peg ${from + 1} to ${to + 1}`,
      beat: disk === disks ? 1 : disk > disks * 0.55 ? 0.5 : 0.25,
      primary: pitch,
      secondary: depth / disks,
      x: to / 2,
      y: pitch,
      energy: 0.35 + (disk / disks) * 0.65,
      accent: disk === disks,
      disk,
      from,
      to,
      depth,
      stacks: stacks.map((stack) => [...stack]),
    });
    move(count - 1, spare, to, from, depth + 1);
  }

  move(disks, 0, target, auxiliary, 0);
  events.push({
    kind: "complete",
    phase: "tower complete",
    beat: 1.5,
    primary: 0.5,
    secondary: 1,
    x: target / 2,
    y: 1,
    energy: 1,
    accent: true,
    disk: disks,
    from: 0,
    to: target,
    depth: 0,
    stacks: stacks.map((stack) => [...stack]),
  });

  return deepFreeze({
    settings,
    preset: presetById("hanoi"),
    scene: {
      type: "hanoi",
      disks,
      target,
      initialStacks,
      finalStacks: stacks.map((stack) => [...stack]),
    },
    events: finalizeEvents("hanoi", events),
    summary: `${disks} disks / ${events.length - 1} legal moves / peg ${target + 1}`,
    complexityLabel: `${disks} recursive disks`,
    metrics: {
      disks,
      moveCount: events.length - 1,
      target,
    },
  });
}

function minimaxNodeDepth(node) {
  return Math.floor(Math.log2(node + 1));
}

function minimaxNodeX(node) {
  const depth = minimaxNodeDepth(node);
  const first = (2 ** depth) - 1;
  return (node - first + 0.5) / (2 ** depth);
}

export function generateMinimaxScore(params = {}) {
  const settings = sanitizeAlgorithmicScoreParams({ ...params, algorithmId: "minimax" });
  const random = createRandom(settings.seed);
  const depth = 3 + Math.floor(((settings.complexity - 1) * 3) / 7);
  const nodeCount = (2 ** (depth + 1)) - 1;
  const leafStart = (2 ** depth) - 1;
  const leafValues = Array(nodeCount).fill(null);
  for (let node = leafStart; node < nodeCount; node += 1) {
    leafValues[node] = Math.round((random() * 2 - 1) * 12) / 12;
  }
  const states = Array(nodeCount).fill(0);
  const resolvedValues = Array(nodeCount).fill(null);
  const events = [];

  function subtreeLeafAverage(node) {
    const nodeDepth = minimaxNodeDepth(node);
    if (nodeDepth === depth) return leafValues[node];
    return (subtreeLeafAverage(node * 2 + 1) + subtreeLeafAverage(node * 2 + 2)) / 2;
  }

  function collectSubtree(node, result) {
    if (node >= nodeCount) return;
    result.push(node);
    collectSubtree(node * 2 + 1, result);
    collectSubtree(node * 2 + 2, result);
  }

  function emit(kind, node, value, alpha, beta, extras = {}) {
    const nodeDepth = minimaxNodeDepth(node);
    events.push({
      kind,
      phase: kind === "prune" ? "alpha-beta cut" : `${kind} depth ${nodeDepth}`,
      beat: kind === "prune" ? 0.75 : kind === "leaf" ? 0.5 : 0.25,
      primary: value === null ? 0.5 : (value + 1) / 2,
      secondary: nodeDepth / depth,
      x: minimaxNodeX(node),
      y: nodeDepth / depth,
      energy: kind === "prune" ? 1 : 0.35 + nodeDepth / (depth * 1.8),
      accent: kind === "prune" || (kind === "resolve" && node === 0),
      node,
      depth: nodeDepth,
      value,
      alpha: Number.isFinite(alpha) ? alpha : null,
      beta: Number.isFinite(beta) ? beta : null,
      states: [...states],
      resolvedValues: [...resolvedValues],
      ...extras,
    });
  }

  function search(node, alpha, beta) {
    const nodeDepth = minimaxNodeDepth(node);
    const maximizing = nodeDepth % 2 === 0;
    states[node] = 1;
    emit("enter", node, null, alpha, beta);
    if (nodeDepth === depth) {
      const value = leafValues[node];
      resolvedValues[node] = value;
      states[node] = 2;
      emit("leaf", node, value, alpha, beta);
      return value;
    }

    const children = [node * 2 + 1, node * 2 + 2].sort((left, right) => {
      const difference = subtreeLeafAverage(left) - subtreeLeafAverage(right);
      return maximizing ? -difference : difference;
    });
    let best = maximizing ? -Infinity : Infinity;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const value = search(child, alpha, beta);
      best = maximizing ? Math.max(best, value) : Math.min(best, value);
      resolvedValues[node] = best;
      if (maximizing) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      emit("update", node, best, alpha, beta, { child });
      if (beta <= alpha && index < children.length - 1) {
        const pruned = [];
        for (const skipped of children.slice(index + 1)) collectSubtree(skipped, pruned);
        for (const skipped of pruned) states[skipped] = 3;
        emit("prune", node, best, alpha, beta, { pruned });
        break;
      }
    }
    states[node] = 2;
    emit("resolve", node, best, alpha, beta);
    return best;
  }

  const rootValue = search(0, -Infinity, Infinity);
  const prunedCount = states.filter((state) => state === 3).length;
  events.push({
    kind: "complete",
    phase: "root resolved",
    beat: 1.5,
    primary: (rootValue + 1) / 2,
    secondary: prunedCount / nodeCount,
    x: 0.5,
    y: 0,
    energy: 1,
    accent: true,
    node: 0,
    depth: 0,
    value: rootValue,
    alpha: rootValue,
    beta: rootValue,
    states: [...states],
    resolvedValues: [...resolvedValues],
  });

  return deepFreeze({
    settings,
    preset: presetById("minimax"),
    scene: {
      type: "minimax",
      depth,
      nodeCount,
      leafValues,
    },
    events: finalizeEvents("minimax", events),
    summary: `depth ${depth} / root ${rootValue.toFixed(2)} / ${prunedCount} nodes pruned`,
    complexityLabel: `binary tree / depth ${depth}`,
    metrics: {
      depth,
      nodeCount,
      rootValue,
      prunedCount,
    },
  });
}

function nQueensConflict(queens, row, column) {
  for (let previousRow = 0; previousRow < row; previousRow += 1) {
    const previousColumn = queens[previousRow];
    if (
      previousColumn === column
      || Math.abs(previousColumn - column) === Math.abs(previousRow - row)
    ) {
      return previousRow;
    }
  }
  return -1;
}

export function generateNQueensScore(params = {}) {
  const settings = sanitizeAlgorithmicScoreParams({ ...params, algorithmId: "nqueens" });
  const random = createRandom(settings.seed);
  const size = 4 + Math.floor(((settings.complexity - 1) * 6) / 7);
  const columnOrders = Array.from({ length: size }, () => shuffled(
    Array.from({ length: size }, (_, column) => column),
    random,
  ));
  const queens = Array(size).fill(-1);
  const events = [];
  let conflictCount = 0;
  let backtrackCount = 0;

  function emit(kind, row, column, conflictRow = -1) {
    const conflictColumn = conflictRow >= 0 ? queens[conflictRow] : column;
    events.push({
      kind,
      phase: kind === "conflict" ? `conflict row ${conflictRow + 1}` : `${kind} row ${row + 1}`,
      beat: kind === "solution" ? 1.5 : kind === "place" ? 0.375 : kind === "backtrack" ? 0.25 : 0.125,
      primary: column / Math.max(1, size - 1),
      secondary: conflictColumn / Math.max(1, size - 1),
      x: column / Math.max(1, size - 1),
      y: row / Math.max(1, size - 1),
      energy: kind === "conflict" ? 0.9 : kind === "solution" ? 1 : 0.55,
      accent: kind === "solution" || kind === "backtrack",
      row,
      column,
      conflictRow,
      conflictColumn,
      queens: [...queens],
    });
  }

  function solve(row) {
    if (row === size) {
      emit("solution", size - 1, queens[size - 1]);
      return true;
    }
    for (const column of columnOrders[row]) {
      const conflictRow = nQueensConflict(queens, row, column);
      if (conflictRow >= 0) {
        conflictCount += 1;
        if (events.length < 12_000) emit("conflict", row, column, conflictRow);
        continue;
      }
      queens[row] = column;
      emit("place", row, column);
      if (solve(row + 1)) return true;
      queens[row] = -1;
      backtrackCount += 1;
      emit("backtrack", row, column);
    }
    return false;
  }

  const solved = solve(0);
  return deepFreeze({
    settings,
    preset: presetById("nqueens"),
    scene: {
      type: "nqueens",
      size,
      columnOrders,
      solution: [...queens],
    },
    events: finalizeEvents("nqueens", events),
    summary: `${size} queens / ${conflictCount} conflicts / ${backtrackCount} backtracks`,
    complexityLabel: `${size} x ${size} constraint board`,
    metrics: {
      size,
      solved,
      conflictCount,
      backtrackCount,
    },
  });
}

export function generateEuclideanScore(params = {}) {
  const settings = sanitizeAlgorithmicScoreParams({ ...params, algorithmId: "euclid" });
  const random = createRandom(settings.seed);
  const divisionCount = 4 + settings.complexity;
  const quotients = Array.from({ length: divisionCount }, (_, index) => (
    index === divisionCount - 1
      ? 2 + Math.floor(random() * 4)
      : 1 + Math.floor(random() * 4)
  ));
  const gcd = 1 + Math.floor(random() * 9);
  let nextRemainder = 0;
  let remainder = gcd;
  for (let index = quotients.length - 1; index >= 0; index -= 1) {
    const previousRemainder = quotients[index] * remainder + nextRemainder;
    nextRemainder = remainder;
    remainder = previousRemainder;
  }
  const initialA = remainder;
  const initialB = nextRemainder;
  const events = [];
  const history = [];
  let a = initialA;
  let b = initialB;
  let division = 0;

  while (b !== 0) {
    const quotient = Math.floor(a / b);
    const next = a % b;
    const record = { a, b, quotient, remainder: next };
    history.push(record);
    events.push({
      kind: "divide",
      phase: `${a} = ${quotient} x ${b} + ${next}`,
      beat: 0.5,
      primary: b / initialA,
      secondary: next / initialA,
      x: division / Math.max(1, divisionCount - 1),
      y: b / initialA,
      energy: clamp(quotient / 5, 0.25, 1, 0.5),
      accent: division === 0,
      a,
      b,
      quotient,
      remainder: next,
      division,
      pulse: -1,
      history: history.map((entry) => ({ ...entry })),
    });
    const pulseCount = Math.min(12, quotient);
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      events.push({
        kind: "quotient",
        phase: `quotient ${quotient} / pulse ${pulse + 1}`,
        beat: 0.125,
        primary: quotient / 12,
        secondary: pulse / Math.max(1, pulseCount - 1),
        x: division / Math.max(1, divisionCount - 1),
        y: (pulse + 1) / pulseCount,
        energy: 0.45 + (pulse === 0 ? 0.35 : 0),
        accent: pulse === 0,
        a,
        b,
        quotient,
        remainder: next,
        division,
        pulse,
        history: history.map((entry) => ({ ...entry })),
      });
    }
    events.push({
      kind: "remainder",
      phase: `remainder ${next}`,
      beat: next === 0 ? 1 : 0.5,
      primary: next / initialA,
      secondary: b / initialA,
      x: (division + 0.5) / divisionCount,
      y: next / initialA,
      energy: next === 0 ? 1 : 0.65,
      accent: next === 0,
      a,
      b,
      quotient,
      remainder: next,
      division,
      pulse: pulseCount,
      history: history.map((entry) => ({ ...entry })),
    });
    a = b;
    b = next;
    division += 1;
  }

  events.push({
    kind: "complete",
    phase: `gcd ${a}`,
    beat: 1.5,
    primary: a / initialA,
    secondary: 1,
    x: 1,
    y: a / initialA,
    energy: 1,
    accent: true,
    a,
    b: 0,
    quotient: 0,
    remainder: a,
    division,
    pulse: -1,
    history: history.map((entry) => ({ ...entry })),
  });

  return deepFreeze({
    settings,
    preset: presetById("euclid"),
    scene: {
      type: "euclid",
      initialA,
      initialB,
      gcd: a,
      quotients,
      history,
    },
    events: finalizeEvents("euclid", events),
    summary: `${initialA} / ${initialB} / gcd ${a} / ${history.length} divisions`,
    complexityLabel: `${history.length} remainder divisions`,
    metrics: {
      initialA,
      initialB,
      gcd: a,
      divisionCount: history.length,
      quotientPulseCount: events.filter((event) => event.kind === "quotient").length,
    },
  });
}

const SCORE_GENERATORS = Object.freeze({
  dijkstra: generateDijkstraScore,
  hanoi: generateHanoiScore,
  minimax: generateMinimaxScore,
  nqueens: generateNQueensScore,
  euclid: generateEuclideanScore,
});

export function generateAlgorithmicScore(params = {}) {
  const settings = sanitizeAlgorithmicScoreParams(params);
  return SCORE_GENERATORS[settings.algorithmId](settings);
}

function boundedFrequency(frequencyHz) {
  return clamp(
    frequencyHz,
    24,
    Math.min(18_000, DEFAULT_SAMPLE_RATE * 0.42),
    110,
  );
}

export function deriveAlgorithmicEventVoices(event, params = {}) {
  const settings = sanitizeAlgorithmicScoreParams(params);
  const primary = clamp(event?.primary, 0, 1, 0.5);
  const secondary = clamp(event?.secondary, 0, 1, primary);
  const energy = clamp(event?.energy, 0, 1, 0.5);
  const intensity = settings.intensity;
  const accent = Boolean(event?.accent);
  const secondsPerBeat = 60 / settings.tempoBpm;
  const durationSeconds = clamp(
    (event?.beat ?? 0.25) * secondsPerBeat * (0.72 + settings.space * 0.9),
    0.025,
    1.8,
    0.12,
  );
  const filterHz = 480 + settings.brightness * 11_500;
  const baseGain = clamp(
    (0.045 + intensity * 0.07) * (0.72 + energy * 0.4) * (accent ? 1.16 : 1),
    0.02,
    0.16,
    0.08,
  );
  const pan = clamp((event?.x ?? 0.5) * 2 - 1, -1, 1, 0);
  const partnerPan = clamp((event?.y ?? 0.5) * 2 - 1, -1, 1, 0);
  const detune = ((event?.stepIndex ?? 0) % 2 === 0 ? -1 : 1) * settings.roughness * 15;
  const frequency = boundedFrequency(
    settings.baseFrequencyHz * (2 ** (primary * settings.pitchSpanOctaves)),
  );
  const partnerFrequency = boundedFrequency(
    settings.baseFrequencyHz * (2 ** (secondary * settings.pitchSpanOctaves)),
  );
  const voices = [];
  const algorithmId = event?.algorithmId ?? settings.algorithmId;
  const oscillatorConfig = {
    dijkstra: { wave: "sine", partnerWave: "triangle", modulationRatio: 2, modulationIndex: 0.8 },
    hanoi: { wave: "triangle", partnerWave: "sine", modulationRatio: 3.01, modulationIndex: 5.5 },
    minimax: { wave: "sawtooth", partnerWave: "square", modulationRatio: 1.5, modulationIndex: 2.5 },
    nqueens: { wave: "triangle", partnerWave: "sine", modulationRatio: 2.01, modulationIndex: 1.6 },
    euclid: { wave: "square", partnerWave: "triangle", modulationRatio: 0.5, modulationIndex: 1.2 },
  }[algorithmId] ?? { wave: "sine", partnerWave: "triangle", modulationRatio: 2, modulationIndex: 1 };

  voices.push(deepFreeze({
    type: "oscillator",
    wave: oscillatorConfig.wave,
    frequencyHz: frequency,
    gain: baseGain,
    pan,
    detuneCents: detune,
    durationSeconds,
    attackSeconds: event?.kind === "prune" || event?.kind === "conflict" ? 0.001 : 0.006,
    filterHz,
    modulationRatio: oscillatorConfig.modulationRatio,
    modulationIndex: oscillatorConfig.modulationIndex * (0.35 + settings.roughness * 0.95),
    delaySend: settings.space * 0.42,
  }));

  if (intensity > 0.28 || accent) {
    voices.push(deepFreeze({
      type: "oscillator",
      wave: oscillatorConfig.partnerWave,
      frequencyHz: partnerFrequency,
      gain: baseGain * (0.42 + intensity * 0.28),
      pan: partnerPan,
      detuneCents: -detune,
      durationSeconds: durationSeconds * 0.82,
      attackSeconds: 0.004,
      filterHz: filterHz * 0.82,
      modulationRatio: oscillatorConfig.modulationRatio + 0.5,
      modulationIndex: oscillatorConfig.modulationIndex * settings.roughness * 0.55,
      delaySend: settings.space * 0.5,
    }));
  }

  if (intensity > 0.72 || accent) {
    voices.push(deepFreeze({
      type: "oscillator",
      wave: algorithmId === "euclid" ? "sine" : "triangle",
      frequencyHz: boundedFrequency(frequency * (algorithmId === "nqueens" ? 1.5 : 0.5)),
      gain: baseGain * 0.46,
      pan: clamp(pan * 0.55, -1, 1, 0),
      detuneCents: 0,
      durationSeconds: durationSeconds * 1.25,
      attackSeconds: 0.008,
      filterHz: filterHz * 0.66,
      modulationRatio: 2,
      modulationIndex: settings.roughness * 1.5,
      delaySend: settings.space * 0.58,
    }));
  }

  const noisyKinds = new Set(["settle", "prune", "conflict", "backtrack", "quotient"]);
  if (noisyKinds.has(event?.kind) && (settings.roughness > 0.18 || intensity > 0.65)) {
    voices.push(deepFreeze({
      type: "noise",
      wave: "noise",
      frequencyHz: boundedFrequency(420 + primary * 7_000),
      gain: clamp(baseGain * (0.24 + settings.roughness * 0.38), 0.01, 0.09, 0.03),
      pan,
      detuneCents: 0,
      durationSeconds: clamp(durationSeconds * 0.28, 0.018, 0.16, 0.04),
      attackSeconds: 0.001,
      filterHz: clamp(filterHz * (0.5 + primary), 300, 16_000, 2_000),
      modulationRatio: 0,
      modulationIndex: 0,
      delaySend: settings.space * 0.28,
    }));
  }

  return Object.freeze(voices);
}

export function describeAlgorithmicEvent(event) {
  if (!event) return "score ready";
  if (event.algorithmId === "dijkstra") {
    if (event.kind === "path") return `shortest path / cost ${event.distance}`;
    return `settle node ${event.node} / distance ${event.distance}`;
  }
  if (event.algorithmId === "hanoi") {
    if (event.kind === "complete") return "tower complete";
    return `disk ${event.disk} / peg ${event.from + 1} to ${event.to + 1}`;
  }
  if (event.algorithmId === "minimax") {
    if (event.kind === "prune") return `${event.pruned.length} nodes pruned`;
    if (event.value === null) return `enter node ${event.node}`;
    return `${event.kind} node ${event.node} / ${event.value.toFixed(2)}`;
  }
  if (event.algorithmId === "nqueens") {
    if (event.kind === "solution") return "constraint solution complete";
    return `${event.kind} / row ${event.row + 1} / column ${event.column + 1}`;
  }
  if (event.algorithmId === "euclid") {
    if (event.kind === "complete") return `gcd ${event.remainder}`;
    if (event.kind === "quotient") return `quotient ${event.quotient} / pulse ${event.pulse + 1}`;
    return `${event.a} = ${event.quotient} x ${event.b} + ${event.remainder}`;
  }
  return event.phase ?? "algorithm event";
}
