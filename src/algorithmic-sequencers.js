const TAU = Math.PI * 2;

const DEFAULT_SIZE = 48;
const DEFAULT_TARGET_RATIO = 0.72;
const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_DATA_SEED = 0x5eed1234;

export const SEARCH_SEQUENCE_LIMITS = Object.freeze({
  minSize: 8,
  maxSize: 128,
  minTempo: 0.5,
  maxTempo: 28,
  minBaseFrequencyHz: 80,
  maxBaseFrequencyHz: 880,
  minPitchSpanOctaves: 0.5,
  maxPitchSpanOctaves: 5,
  minNoteSeconds: 0.025,
  maxNoteSeconds: 0.42,
  maxOutput: 0.82,
});

export const SEARCH_DATA_CURVES = Object.freeze([
  Object.freeze({
    id: "linear",
    label: "Linear",
    description: "Evenly spaced values make position and pitch climb together.",
  }),
  Object.freeze({
    id: "clustered",
    label: "Clustered",
    description: "Dense low and high shelves expose how interpolation can overshoot.",
  }),
  Object.freeze({
    id: "sine-bend",
    label: "Sine Bend",
    description: "A gently warped monotone field keeps the target searchable but less regular.",
  }),
  Object.freeze({
    id: "random",
    label: "Random",
    description: "Fresh random values are sorted into an irregular searchable field.",
  }),
]);

export const SEARCH_ALGORITHM_PRESETS = Object.freeze([
  Object.freeze({
    id: "linear",
    label: "Linear Sweep",
    shortLabel: "Linear",
    description: "A single reader walks every cell until the target answers.",
    signature: "steady pulse train",
  }),
  Object.freeze({
    id: "binary",
    label: "Binary Partition",
    shortLabel: "Binary",
    description: "The search window folds in half, turning uncertainty into octave-sized leaps.",
    signature: "wide interval jumps",
  }),
  Object.freeze({
    id: "jump",
    label: "Jump Blocks",
    shortLabel: "Jump",
    description: "Block probes make a coarse rhythm before a small local scan resolves the target.",
    signature: "skip-and-fill rhythm",
  }),
  Object.freeze({
    id: "interpolation",
    label: "Interpolation Probe",
    shortLabel: "Interp",
    description: "A value-based estimate aims near the target, so uneven data becomes audible bias.",
    signature: "rubbery estimate bends",
  }),
  Object.freeze({
    id: "exponential",
    label: "Exponential Gate",
    shortLabel: "Expo",
    description: "The boundary doubles outward, then a binary search locks into the discovered range.",
    signature: "opening fanfare to click-lock",
  }),
]);

export const SONIFIABLE_ALGORITHM_CANDIDATES = Object.freeze([
  Object.freeze({
    family: "Search",
    algorithms: Object.freeze([
      "linear search",
      "binary search",
      "jump search",
      "interpolation search",
      "exponential search",
      "ternary search",
      "hash lookup",
      "Boyer-Moore / KMP string search",
      "BFS / DFS",
      "Dijkstra / A*",
      "bidirectional search",
      "minimax with alpha-beta pruning",
      "Monte Carlo tree search",
    ]),
  }),
  Object.freeze({
    family: "Sorting",
    algorithms: Object.freeze([
      "bubble sort",
      "insertion sort",
      "selection sort",
      "merge sort",
      "quick sort",
      "heap sort",
      "radix sort",
      "shell sort",
      "cocktail shaker sort",
      "bitonic sort",
      "timsort",
      "cycle sort",
      "bogo sort",
    ]),
  }),
  Object.freeze({
    family: "Graphs",
    algorithms: Object.freeze([
      "connected components",
      "Tarjan strongly connected components",
      "topological sort",
      "Prim minimum spanning tree",
      "Kruskal minimum spanning tree",
      "Bellman-Ford",
      "Floyd-Warshall",
      "Edmonds-Karp / Ford-Fulkerson",
      "minimum cut",
      "maze generation and solving",
    ]),
  }),
  Object.freeze({
    family: "Recursive / Constraint",
    algorithms: Object.freeze([
      "N-Queens backtracking",
      "Sudoku constraint propagation",
      "knapsack dynamic programming",
      "edit distance",
      "longest common subsequence",
      "fast exponentiation",
      "FFT / Cooley-Tukey",
      "cellular automata",
      "Turing machine tapes",
    ]),
  }),
]);

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

function objectById(collection, id, fallbackIndex = 0) {
  return collection.find((item) => item.id === id) ?? collection[fallbackIndex];
}

function normalizeCurveValue(value) {
  return clamp(value, 0, 1, 0);
}

function clusteredCurve(t) {
  const shaped = 0.5 + Math.tanh((t - 0.5) * 2.8) / (2 * Math.tanh(1.4));
  return normalizeCurveValue(shaped);
}

function sineBendCurve(t) {
  return normalizeCurveValue(t + 0.024 * Math.sin(TAU * t * 2));
}

function normalizeDataSeed(value, fallback = DEFAULT_DATA_SEED) {
  const seed = Math.trunc(finiteNumber(value, fallback)) >>> 0;
  return seed || fallback;
}

function createSeededRandom(seed) {
  let state = normalizeDataSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function createSearchArray(
  size = DEFAULT_SIZE,
  curveId = "linear",
  dataSeed = DEFAULT_DATA_SEED,
) {
  const safeSize = clampInteger(
    size,
    SEARCH_SEQUENCE_LIMITS.minSize,
    SEARCH_SEQUENCE_LIMITS.maxSize,
    DEFAULT_SIZE,
  );
  const curve = objectById(SEARCH_DATA_CURVES, curveId);
  if (curve.id === "random") {
    const random = createSeededRandom(dataSeed);
    const interior = Array.from(
      { length: Math.max(0, safeSize - 2) },
      () => random(),
    ).sort((left, right) => left - right);
    return Object.freeze([0, ...interior, 1]);
  }

  const values = Array.from({ length: safeSize }, (_, index) => {
    const t = safeSize === 1 ? 0 : index / (safeSize - 1);
    if (curve.id === "clustered") return clusteredCurve(t);
    if (curve.id === "sine-bend") return sineBendCurve(t);
    return t;
  });

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      values[index] = Math.min(1, values[index - 1] + 1e-6);
    }
  }
  values[0] = 0;
  values[values.length - 1] = 1;
  return Object.freeze(values);
}

export function sanitizeSearchSequencerParams(params = {}) {
  const size = clampInteger(
    params.size,
    SEARCH_SEQUENCE_LIMITS.minSize,
    SEARCH_SEQUENCE_LIMITS.maxSize,
    DEFAULT_SIZE,
  );
  const defaultTarget = Math.round((size - 1) * DEFAULT_TARGET_RATIO);
  return Object.freeze({
    algorithmId: objectById(SEARCH_ALGORITHM_PRESETS, params.algorithmId, 1).id,
    curveId: objectById(SEARCH_DATA_CURVES, params.curveId).id,
    dataSeed: normalizeDataSeed(params.dataSeed),
    size,
    targetIndex: clampInteger(params.targetIndex, 0, size - 1, defaultTarget),
    tempo: clamp(
      params.tempo,
      SEARCH_SEQUENCE_LIMITS.minTempo,
      SEARCH_SEQUENCE_LIMITS.maxTempo,
      8,
    ),
    baseFrequencyHz: clamp(
      params.baseFrequencyHz,
      SEARCH_SEQUENCE_LIMITS.minBaseFrequencyHz,
      SEARCH_SEQUENCE_LIMITS.maxBaseFrequencyHz,
      180,
    ),
    pitchSpanOctaves: clamp(
      params.pitchSpanOctaves,
      SEARCH_SEQUENCE_LIMITS.minPitchSpanOctaves,
      SEARCH_SEQUENCE_LIMITS.maxPitchSpanOctaves,
      3.2,
    ),
    noteSeconds: clamp(
      params.noteSeconds,
      SEARCH_SEQUENCE_LIMITS.minNoteSeconds,
      SEARCH_SEQUENCE_LIMITS.maxNoteSeconds,
      0.11,
    ),
    output: clamp(params.output, 0, SEARCH_SEQUENCE_LIMITS.maxOutput, 0.48),
  });
}

function compareSearchValue(value, targetValue) {
  if (Math.abs(value - targetValue) < 1e-12) return "eq";
  return value < targetValue ? "lt" : "gt";
}

function createStep(values, targetIndex, {
  index,
  low,
  high,
  phase,
  operation = "compare",
}) {
  const size = values.length;
  const safeIndex = clampInteger(index, 0, size - 1, 0);
  const safeLow = clampInteger(low, 0, size - 1, 0);
  const safeHigh = clampInteger(high, 0, size - 1, size - 1);
  const targetValue = values[targetIndex];
  const value = values[safeIndex];
  const compare = compareSearchValue(value, targetValue);
  const found = compare === "eq";
  return Object.freeze({
    operation: found ? "found" : operation,
    phase,
    index: safeIndex,
    value,
    targetIndex,
    targetValue,
    low: Math.min(safeLow, safeHigh),
    high: Math.max(safeLow, safeHigh),
    compare,
    found,
    distance: size <= 1 ? 0 : Math.abs(safeIndex - targetIndex) / (size - 1),
    rangeWidth: size <= 1 ? 1 : (Math.abs(safeHigh - safeLow) + 1) / size,
  });
}

function linearSearchSteps(values, targetIndex) {
  const steps = [];
  for (let index = 0; index < values.length; index += 1) {
    const step = createStep(values, targetIndex, {
      index,
      low: index,
      high: values.length - 1,
      phase: "scan",
    });
    steps.push(step);
    if (step.found) break;
  }
  return steps;
}

function binarySearchSteps(values, targetIndex, {
  low = 0,
  high = values.length - 1,
  phase = "partition",
} = {}) {
  const steps = [];
  const targetValue = values[targetIndex];
  let lo = low;
  let hi = high;
  while (lo <= hi) {
    const index = Math.floor((lo + hi) / 2);
    const step = createStep(values, targetIndex, {
      index,
      low: lo,
      high: hi,
      phase,
    });
    steps.push(step);
    if (step.found) break;
    if (values[index] < targetValue) lo = index + 1;
    else hi = index - 1;
  }
  return steps;
}

function jumpSearchSteps(values, targetIndex) {
  const steps = [];
  const targetValue = values[targetIndex];
  const block = Math.max(1, Math.floor(Math.sqrt(values.length)));
  let low = 0;
  let high = Math.min(block - 1, values.length - 1);

  while (values[high] < targetValue && high < values.length - 1) {
    steps.push(createStep(values, targetIndex, {
      index: high,
      low,
      high,
      phase: "jump",
    }));
    low = high + 1;
    high = Math.min(low + block - 1, values.length - 1);
  }

  for (let index = low; index <= high; index += 1) {
    const step = createStep(values, targetIndex, {
      index,
      low,
      high,
      phase: "local scan",
    });
    steps.push(step);
    if (step.found) break;
  }

  return steps;
}

function interpolationSearchSteps(values, targetIndex) {
  const steps = [];
  const targetValue = values[targetIndex];
  let low = 0;
  let high = values.length - 1;
  let guard = 0;

  while (
    low <= high
    && targetValue >= values[low]
    && targetValue <= values[high]
    && guard < values.length * 2
  ) {
    guard += 1;
    const denominator = values[high] - values[low];
    const estimate = denominator === 0
      ? low
      : low + ((targetValue - values[low]) / denominator) * (high - low);
    const index = clampInteger(Math.floor(estimate), low, high, low);
    const step = createStep(values, targetIndex, {
      index,
      low,
      high,
      phase: "estimate",
    });
    steps.push(step);
    if (step.found) break;
    if (values[index] < targetValue) low = index + 1;
    else high = index - 1;
  }

  if (!steps.some((step) => step.found)) {
    steps.push(...binarySearchSteps(values, targetIndex, { low, high, phase: "fallback" }));
  }
  return steps;
}

function exponentialSearchSteps(values, targetIndex) {
  const steps = [];
  if (targetIndex === 0) {
    return [createStep(values, targetIndex, {
      index: 0,
      low: 0,
      high: 0,
      phase: "first",
    })];
  }

  const targetValue = values[targetIndex];
  let bound = 1;
  while (bound < values.length && values[bound] < targetValue) {
    steps.push(createStep(values, targetIndex, {
      index: bound,
      low: Math.floor(bound / 2),
      high: Math.min(bound, values.length - 1),
      phase: "expand",
    }));
    bound *= 2;
  }

  if (bound < values.length) {
    const gate = createStep(values, targetIndex, {
      index: bound,
      low: Math.floor(bound / 2),
      high: bound,
      phase: "gate",
    });
    steps.push(gate);
    if (gate.found) return steps;
  }

  const low = Math.floor(bound / 2) + 1;
  const high = Math.min(bound - 1, values.length - 1);
  steps.push(...binarySearchSteps(values, targetIndex, { low, high, phase: "binary lock" }));
  return steps;
}

const SEARCH_RUNNERS = Object.freeze({
  linear: linearSearchSteps,
  binary: binarySearchSteps,
  jump: jumpSearchSteps,
  interpolation: interpolationSearchSteps,
  exponential: exponentialSearchSteps,
});

export function generateSearchSequence(params = {}) {
  const settings = sanitizeSearchSequencerParams(params);
  const algorithm = objectById(SEARCH_ALGORITHM_PRESETS, settings.algorithmId, 1);
  const values = createSearchArray(settings.size, settings.curveId, settings.dataSeed);
  const runner = SEARCH_RUNNERS[algorithm.id] ?? SEARCH_RUNNERS.binary;
  const steps = runner(values, settings.targetIndex).map((step, stepIndex) => Object.freeze({
    ...step,
    stepIndex,
  }));
  const foundStep = steps.find((step) => step.found) ?? null;

  return Object.freeze({
    settings,
    algorithm,
    curve: objectById(SEARCH_DATA_CURVES, settings.curveId),
    values,
    steps: Object.freeze(steps),
    targetIndex: settings.targetIndex,
    targetValue: values[settings.targetIndex],
    foundStepIndex: foundStep?.stepIndex ?? -1,
    comparisons: steps.length,
  });
}

export function deriveSearchStepTone(step, params = {}) {
  const settings = sanitizeSearchSequencerParams(params);
  const valueNorm = clamp(step?.value, 0, 1, 0);
  const targetNorm = clamp(step?.targetValue, 0, 1, valueNorm);
  const indexNorm = settings.size <= 1 ? 0.5 : clamp(step?.index, 0, settings.size - 1, 0) / (settings.size - 1);
  const found = Boolean(step?.found);
  const compareOffset = step?.compare === "gt" ? 1.012 : step?.compare === "lt" ? 0.988 : 1;
  const maximumFrequencyHz = Math.min(18_000, DEFAULT_SAMPLE_RATE * 0.42);
  const frequencyHz = Math.min(
    maximumFrequencyHz,
    settings.baseFrequencyHz * (2 ** (valueNorm * settings.pitchSpanOctaves)) * compareOffset,
  );
  const targetFrequencyHz = Math.min(
    maximumFrequencyHz,
    settings.baseFrequencyHz * (2 ** (targetNorm * settings.pitchSpanOctaves)),
  );
  return Object.freeze({
    frequencyHz,
    targetFrequencyHz,
    pan: clamp(indexNorm * 2 - 1, -1, 1, 0),
    gain: found ? 0.26 : 0.12 + (1 - clamp(step?.distance, 0, 1, 1)) * 0.06,
    durationSeconds: found
      ? Math.min(SEARCH_SEQUENCE_LIMITS.maxNoteSeconds, settings.noteSeconds * 2.2)
      : settings.noteSeconds,
    compare: step?.compare ?? "eq",
  });
}

export function formatSearchComparison(step) {
  if (!step) return "waiting";
  if (step.compare === "eq") return `hit index ${step.index}`;
  const relation = step.compare === "lt" ? "below target" : "above target";
  return `index ${step.index} ${relation}`;
}
