const DEFAULT_SIZE = 48;
const DEFAULT_DATA_SEED = 0x5eed1234;
const DEFAULT_SAMPLE_RATE = 48_000;

export const SORT_SEQUENCE_LIMITS = Object.freeze({
  minSize: 8,
  maxSize: 128,
  minTempo: 0.5,
  maxTempo: 60,
  minBaseFrequencyHz: 80,
  maxBaseFrequencyHz: 880,
  minPitchSpanOctaves: 0.5,
  maxPitchSpanOctaves: 5,
  minNoteSeconds: 0.018,
  maxNoteSeconds: 0.32,
  maxOutput: 0.82,
});

export const SORT_ALGORITHM_PRESETS = Object.freeze([
  Object.freeze({
    id: "bubble",
    label: "Bubble Sort",
    shortLabel: "Bubble",
    description: "Adjacent comparisons push larger values toward the end in repeated passes.",
    signature: "rising adjacent sweeps",
  }),
  Object.freeze({
    id: "insertion",
    label: "Insertion Sort",
    shortLabel: "Insertion",
    description: "Each new value walks backward until it settles into the ordered prefix.",
    signature: "backward runs and drops",
  }),
  Object.freeze({
    id: "selection",
    label: "Selection Sort",
    shortLabel: "Selection",
    description: "A scanning voice finds each minimum before swapping it into place.",
    signature: "long scans with cadences",
  }),
  Object.freeze({
    id: "merge",
    label: "Merge Sort",
    shortLabel: "Merge",
    description: "Small ordered phrases combine into progressively longer merged sections.",
    signature: "layered split-and-join",
  }),
  Object.freeze({
    id: "quick",
    label: "Quick Sort",
    shortLabel: "Quick",
    description: "Pivot comparisons divide the field into recursively smaller partitions.",
    signature: "pivot calls and replies",
  }),
]);

export const NEXT_ALGORITHM_TRIALS = Object.freeze([
  Object.freeze({
    id: "dijkstra",
    href: "dijkstra.html",
    label: "DJ Dijkstra",
    family: "Graph search",
    sonification: "Distance sets pitch, graph position sets stereo, and frontier growth builds the chord.",
  }),
  Object.freeze({
    id: "hanoi",
    href: "hanoi.html",
    label: "Towers of Hanoi",
    family: "Recursion",
    sonification: "Disk size sets pitch, each peg has a stereo position, and recursive depth shapes timing.",
  }),
  Object.freeze({
    id: "minimax",
    href: "minimax.html",
    label: "Minimax + Alpha-Beta",
    family: "Tree search",
    sonification: "Evaluation sets pitch, depth sets register, and pruned branches become sudden rests.",
  }),
  Object.freeze({
    id: "nqueens",
    href: "nqueens.html",
    label: "N-Queens Backtracking",
    family: "Constraint search",
    sonification: "Placements build a chord while conflicts and backtracks reverse its motion.",
  }),
  Object.freeze({
    id: "euclid",
    href: "euclid.html",
    label: "Euclidean GCD",
    family: "Number theory",
    sonification: "Successive remainders descend in pitch while each quotient controls pulse repetition.",
  }),
]);

export const SONIFIABLE_ALGORITHM_CANDIDATES = Object.freeze([
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
      "Towers of Hanoi",
      "Euclidean GCD",
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

export function createOrderedSortValues(size = DEFAULT_SIZE) {
  const safeSize = clampInteger(
    size,
    SORT_SEQUENCE_LIMITS.minSize,
    SORT_SEQUENCE_LIMITS.maxSize,
    DEFAULT_SIZE,
  );
  return Object.freeze(Array.from(
    { length: safeSize },
    (_, index) => index / (safeSize - 1),
  ));
}

export function shuffleSortValues(size = DEFAULT_SIZE, dataSeed = DEFAULT_DATA_SEED) {
  const values = [...createOrderedSortValues(size)];
  const random = createSeededRandom(dataSeed);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  if (values.every((value, index) => index === 0 || value > values[index - 1])) {
    values.push(values.shift());
  }
  return Object.freeze(values);
}

export function sanitizeSortSequencerParams(params = {}) {
  return Object.freeze({
    algorithmId: objectById(SORT_ALGORITHM_PRESETS, params.algorithmId, 4).id,
    dataSeed: normalizeDataSeed(params.dataSeed),
    size: clampInteger(
      params.size,
      SORT_SEQUENCE_LIMITS.minSize,
      SORT_SEQUENCE_LIMITS.maxSize,
      DEFAULT_SIZE,
    ),
    tempo: clamp(
      params.tempo,
      SORT_SEQUENCE_LIMITS.minTempo,
      SORT_SEQUENCE_LIMITS.maxTempo,
      18,
    ),
    baseFrequencyHz: clamp(
      params.baseFrequencyHz,
      SORT_SEQUENCE_LIMITS.minBaseFrequencyHz,
      SORT_SEQUENCE_LIMITS.maxBaseFrequencyHz,
      180,
    ),
    pitchSpanOctaves: clamp(
      params.pitchSpanOctaves,
      SORT_SEQUENCE_LIMITS.minPitchSpanOctaves,
      SORT_SEQUENCE_LIMITS.maxPitchSpanOctaves,
      3.2,
    ),
    noteSeconds: clamp(
      params.noteSeconds,
      SORT_SEQUENCE_LIMITS.minNoteSeconds,
      SORT_SEQUENCE_LIMITS.maxNoteSeconds,
      0.065,
    ),
    output: clamp(params.output, 0, SORT_SEQUENCE_LIMITS.maxOutput, 0.48),
  });
}

function compareValues(leftValue, rightValue) {
  if (Math.abs(leftValue - rightValue) < 1e-12) return "eq";
  return leftValue < rightValue ? "lt" : "gt";
}

function appendSortStep(steps, values, {
  operation = "compare",
  leftIndex = 0,
  rightIndex = leftIndex,
  leftValue = values[leftIndex],
  rightValue = values[rightIndex],
  low = 0,
  high = values.length - 1,
  phase = "sort",
  comparison = false,
}) {
  const lastIndex = values.length - 1;
  const safeLeft = clampInteger(leftIndex, 0, lastIndex, 0);
  const safeRight = clampInteger(rightIndex, 0, lastIndex, safeLeft);
  const safeLow = clampInteger(low, 0, lastIndex, 0);
  const safeHigh = clampInteger(high, 0, lastIndex, lastIndex);
  steps.push(Object.freeze({
    operation,
    phase,
    leftIndex: safeLeft,
    rightIndex: safeRight,
    leftValue,
    rightValue,
    low: Math.min(safeLow, safeHigh),
    high: Math.max(safeLow, safeHigh),
    relation: compareValues(leftValue, rightValue),
    comparison,
    values: Object.freeze([...values]),
  }));
}

function appendCompleteStep(steps, values) {
  appendSortStep(steps, values, {
    operation: "complete",
    leftIndex: 0,
    rightIndex: values.length - 1,
    leftValue: values[0],
    rightValue: values.at(-1),
    phase: "sorted",
  });
}

function bubbleSortSteps(input) {
  const values = [...input];
  const steps = [];
  for (let high = values.length - 1; high > 0; high -= 1) {
    let moved = false;
    for (let index = 0; index < high; index += 1) {
      const leftValue = values[index];
      const rightValue = values[index + 1];
      if (leftValue > rightValue) {
        [values[index], values[index + 1]] = [rightValue, leftValue];
        moved = true;
        appendSortStep(steps, values, {
          operation: "swap",
          leftIndex: index,
          rightIndex: index + 1,
          leftValue,
          rightValue,
          low: 0,
          high,
          phase: "bubble pass",
          comparison: true,
        });
      } else {
        appendSortStep(steps, values, {
          leftIndex: index,
          rightIndex: index + 1,
          leftValue,
          rightValue,
          low: 0,
          high,
          phase: "bubble pass",
          comparison: true,
        });
      }
    }
    if (!moved) break;
  }
  appendCompleteStep(steps, values);
  return steps;
}

function insertionSortSteps(input) {
  const values = [...input];
  const steps = [];
  for (let index = 1; index < values.length; index += 1) {
    const key = values[index];
    let cursor = index - 1;
    let moved = false;
    while (cursor >= 0) {
      const compared = values[cursor];
      if (compared > key) {
        values[cursor + 1] = compared;
        moved = true;
        appendSortStep(steps, values, {
          operation: "shift",
          leftIndex: cursor,
          rightIndex: cursor + 1,
          leftValue: compared,
          rightValue: key,
          low: 0,
          high: index,
          phase: "ordered prefix",
          comparison: true,
        });
        cursor -= 1;
      } else {
        appendSortStep(steps, values, {
          leftIndex: cursor,
          rightIndex: cursor + 1,
          leftValue: compared,
          rightValue: key,
          low: 0,
          high: index,
          phase: "ordered prefix",
          comparison: true,
        });
        break;
      }
    }
    values[cursor + 1] = key;
    if (moved) {
      appendSortStep(steps, values, {
        operation: "write",
        leftIndex: cursor + 1,
        rightIndex: index,
        leftValue: key,
        rightValue: key,
        low: 0,
        high: index,
        phase: "insert",
      });
    }
  }
  appendCompleteStep(steps, values);
  return steps;
}

function selectionSortSteps(input) {
  const values = [...input];
  const steps = [];
  for (let start = 0; start < values.length - 1; start += 1) {
    let minimum = start;
    for (let scan = start + 1; scan < values.length; scan += 1) {
      appendSortStep(steps, values, {
        leftIndex: minimum,
        rightIndex: scan,
        low: start,
        high: values.length - 1,
        phase: "minimum scan",
        comparison: true,
      });
      if (values[scan] < values[minimum]) minimum = scan;
    }
    if (minimum !== start) {
      const leftValue = values[start];
      const rightValue = values[minimum];
      [values[start], values[minimum]] = [rightValue, leftValue];
      appendSortStep(steps, values, {
        operation: "swap",
        leftIndex: start,
        rightIndex: minimum,
        leftValue,
        rightValue,
        low: start,
        high: values.length - 1,
        phase: "place minimum",
      });
    }
  }
  appendCompleteStep(steps, values);
  return steps;
}

function mergeSortSteps(input) {
  const values = [...input];
  const steps = [];

  function merge(low, middle, high) {
    const left = values.slice(low, middle + 1);
    const right = values.slice(middle + 1, high + 1);
    let leftCursor = 0;
    let rightCursor = 0;
    let writeIndex = low;

    while (leftCursor < left.length && rightCursor < right.length) {
      const leftValue = left[leftCursor];
      const rightValue = right[rightCursor];
      appendSortStep(steps, values, {
        leftIndex: low + leftCursor,
        rightIndex: middle + 1 + rightCursor,
        leftValue,
        rightValue,
        low,
        high,
        phase: "merge compare",
        comparison: true,
      });
      if (leftValue <= rightValue) {
        values[writeIndex] = leftValue;
        leftCursor += 1;
      } else {
        values[writeIndex] = rightValue;
        rightCursor += 1;
      }
      appendSortStep(steps, values, {
        operation: "write",
        leftIndex: writeIndex,
        rightIndex: writeIndex,
        leftValue: values[writeIndex],
        rightValue: values[writeIndex],
        low,
        high,
        phase: "merge write",
      });
      writeIndex += 1;
    }

    while (leftCursor < left.length) {
      values[writeIndex] = left[leftCursor];
      appendSortStep(steps, values, {
        operation: "write",
        leftIndex: writeIndex,
        rightIndex: low + leftCursor,
        leftValue: values[writeIndex],
        rightValue: values[writeIndex],
        low,
        high,
        phase: "merge tail",
      });
      leftCursor += 1;
      writeIndex += 1;
    }

    while (rightCursor < right.length) {
      values[writeIndex] = right[rightCursor];
      appendSortStep(steps, values, {
        operation: "write",
        leftIndex: writeIndex,
        rightIndex: middle + 1 + rightCursor,
        leftValue: values[writeIndex],
        rightValue: values[writeIndex],
        low,
        high,
        phase: "merge tail",
      });
      rightCursor += 1;
      writeIndex += 1;
    }
  }

  function sort(low, high) {
    if (low >= high) return;
    const middle = Math.floor((low + high) / 2);
    sort(low, middle);
    sort(middle + 1, high);
    merge(low, middle, high);
  }

  sort(0, values.length - 1);
  appendCompleteStep(steps, values);
  return steps;
}

function quickSortSteps(input) {
  const values = [...input];
  const steps = [];

  function partition(low, high) {
    const pivotValue = values[high];
    appendSortStep(steps, values, {
      operation: "pivot",
      leftIndex: high,
      rightIndex: high,
      leftValue: pivotValue,
      rightValue: pivotValue,
      low,
      high,
      phase: "choose pivot",
    });
    let store = low;
    for (let scan = low; scan < high; scan += 1) {
      const scanValue = values[scan];
      appendSortStep(steps, values, {
        leftIndex: scan,
        rightIndex: high,
        leftValue: scanValue,
        rightValue: pivotValue,
        low,
        high,
        phase: "partition",
        comparison: true,
      });
      if (scanValue <= pivotValue) {
        if (store !== scan) {
          const storeValue = values[store];
          [values[store], values[scan]] = [values[scan], values[store]];
          appendSortStep(steps, values, {
            operation: "swap",
            leftIndex: store,
            rightIndex: scan,
            leftValue: storeValue,
            rightValue: scanValue,
            low,
            high,
            phase: "partition swap",
          });
        }
        store += 1;
      }
    }
    if (store !== high) {
      const storeValue = values[store];
      [values[store], values[high]] = [pivotValue, storeValue];
      appendSortStep(steps, values, {
        operation: "swap",
        leftIndex: store,
        rightIndex: high,
        leftValue: storeValue,
        rightValue: pivotValue,
        low,
        high,
        phase: "place pivot",
      });
    }
    return store;
  }

  function sort(low, high) {
    if (low >= high) return;
    const pivot = partition(low, high);
    sort(low, pivot - 1);
    sort(pivot + 1, high);
  }

  sort(0, values.length - 1);
  appendCompleteStep(steps, values);
  return steps;
}

const SORT_RUNNERS = Object.freeze({
  bubble: bubbleSortSteps,
  insertion: insertionSortSteps,
  selection: selectionSortSteps,
  merge: mergeSortSteps,
  quick: quickSortSteps,
});

export function generateSortSequence(params = {}) {
  const settings = sanitizeSortSequencerParams(params);
  const algorithm = objectById(SORT_ALGORITHM_PRESETS, settings.algorithmId, 4);
  const initialValues = shuffleSortValues(settings.size, settings.dataSeed);
  const runner = SORT_RUNNERS[algorithm.id] ?? SORT_RUNNERS.quick;
  const steps = runner(initialValues).map((step, stepIndex) => Object.freeze({
    ...step,
    stepIndex,
  }));
  const finalValues = steps.at(-1)?.values ?? initialValues;
  const comparisons = steps.filter((step) => step.comparison).length;
  const swaps = steps.filter((step) => step.operation === "swap").length;
  const writes = steps.reduce((total, step) => {
    if (step.operation === "swap") return total + 2;
    if (step.operation === "shift" || step.operation === "write") return total + 1;
    return total;
  }, 0);

  return Object.freeze({
    settings,
    algorithm,
    initialValues,
    finalValues,
    steps: Object.freeze(steps),
    comparisons,
    swaps,
    writes,
  });
}

export function deriveSortStepTone(step, params = {}) {
  const settings = sanitizeSortSequencerParams(params);
  const leftNorm = clamp(step?.leftValue, 0, 1, 0);
  const rightNorm = clamp(step?.rightValue, 0, 1, leftNorm);
  const denominator = Math.max(1, settings.size - 1);
  const leftIndexNorm = clamp(step?.leftIndex, 0, settings.size - 1, 0) / denominator;
  const rightIndexNorm = clamp(step?.rightIndex, 0, settings.size - 1, 0) / denominator;
  const maximumFrequencyHz = Math.min(18_000, DEFAULT_SAMPLE_RATE * 0.42);
  const operationGain = step?.operation === "complete"
    ? 0.24
    : step?.operation === "swap"
      ? 0.18
      : step?.operation === "write" || step?.operation === "shift"
        ? 0.14
        : 0.11;

  return Object.freeze({
    frequencyHz: Math.min(
      maximumFrequencyHz,
      settings.baseFrequencyHz * (2 ** (leftNorm * settings.pitchSpanOctaves)),
    ),
    partnerFrequencyHz: Math.min(
      maximumFrequencyHz,
      settings.baseFrequencyHz * (2 ** (rightNorm * settings.pitchSpanOctaves)),
    ),
    leftPan: clamp(leftIndexNorm * 2 - 1, -1, 1, 0),
    rightPan: clamp(rightIndexNorm * 2 - 1, -1, 1, 0),
    gain: operationGain,
    durationSeconds: step?.operation === "complete"
      ? Math.min(SORT_SEQUENCE_LIMITS.maxNoteSeconds, settings.noteSeconds * 2.6)
      : settings.noteSeconds,
    operation: step?.operation ?? "compare",
  });
}

export function formatSortOperation(step) {
  if (!step) return "waiting";
  if (step.operation === "complete") return "sorted";
  if (step.operation === "pivot") return `pivot at index ${step.leftIndex}`;
  if (step.operation === "swap") return `swap indices ${step.leftIndex} and ${step.rightIndex}`;
  if (step.operation === "shift") return `shift index ${step.leftIndex} right`;
  if (step.operation === "write") return `write index ${step.leftIndex}`;
  const relation = step.relation === "lt" ? "<" : step.relation === "gt" ? ">" : "=";
  return `index ${step.leftIndex} ${relation} index ${step.rightIndex}`;
}
