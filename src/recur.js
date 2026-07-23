// Pure recursion-tracer engine for the "recur" instrument.
//
// Executes a recursive program for real and emits an ordered event timeline —
// one array in execution order (pre-order calls, LIFO returns) — that the app
// plays back through time. DOM-free and audio-free so it unit-tests in Node.
//
// A frame emits exactly one `call` (on the way in) and one `return` (on the way
// out); a `base` marks the frame's terminal/atomic action (a base case, or a
// Hanoi disk move). A frame's `return` always follows its whole subtree, so the
// array already encodes the stack: iterate it and `call` pushes, `return` pops.

const DEFAULT_MAX_EVENTS = 6000;

// Linear programs share one descent/ascent shape; they differ only in the base
// value and how a level combines its child's returned value.
const LINEAR_KINDS = Object.freeze({
  factorial: Object.freeze({
    label: "n!",
    isBase: (n) => n <= 1,
    baseValue: () => 1,
    combine: (n, child) => n * child,
  }),
  countdown: Object.freeze({
    label: "countdown",
    isBase: (n) => n <= 0,
    baseValue: () => 0,
    combine: (_n, child) => child,
  }),
  sum: Object.freeze({
    label: "sum",
    isBase: (n) => n <= 0,
    baseValue: () => 0,
    combine: (n, child) => n + child,
  }),
});

export const RECUR_PROGRAMS = Object.freeze([
  Object.freeze({
    id: "factorial",
    label: "Factorial n!",
    kind: "linear",
    nMin: 1,
    nMax: 24,
    nDefault: 5,
    supportsMemo: false,
    blurb: "One call per level down, a single base case, cadences resolve in reverse.",
  }),
  Object.freeze({
    id: "countdown",
    label: "Countdown",
    kind: "linear",
    nMin: 1,
    nMax: 32,
    nDefault: 6,
    supportsMemo: false,
    blurb: "Descend to the base case, then climb back out the way you came in.",
  }),
  Object.freeze({
    id: "sum",
    label: "Sum 1..n",
    kind: "linear",
    nMin: 1,
    nMax: 32,
    nDefault: 6,
    supportsMemo: false,
    blurb: "Each return adds its own level to the total on the way up.",
  }),
  Object.freeze({
    id: "hanoi",
    label: "Towers of Hanoi",
    kind: "tree",
    nMin: 1,
    nMax: 10,
    nDefault: 3,
    supportsMemo: false,
    blurb: "Self-similar 'ruler' rhythm; every disk move is an audible tick.",
  }),
  Object.freeze({
    id: "fibonacci",
    label: "Fibonacci (naive)",
    kind: "tree",
    nMin: 1,
    nMax: 12,
    nDefault: 5,
    supportsMemo: true,
    blurb: "Hear identical subtrees recomputed; the memoize toggle erases the redundancy.",
  }),
]);

const PROGRAMS_BY_ID = new Map(RECUR_PROGRAMS.map((program) => [program.id, program]));

export function programById(id) {
  return PROGRAMS_BY_ID.get(String(id)) ?? null;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

/**
 * Execute `program` at argument `n` and return the event timeline plus summary.
 * @returns {{program, n, stepSeconds, events, frameCount, maxDepth, duration}}
 */
export function buildRecurTimeline(program, n, options = {}) {
  const spec = PROGRAMS_BY_ID.get(String(program));
  if (!spec) throw new RangeError(`Unknown recur program: ${program}`);

  const stepSeconds = Number(options.stepSeconds) > 0 ? Number(options.stepSeconds) : 1;
  const memoize = Boolean(options.memoize) && spec.supportsMemo;
  const maxEventCap = Math.max(1, Math.floor(Number(options.maxEventCap) || DEFAULT_MAX_EVENTS));
  const argument = clampInteger(n, spec.nMin, spec.nMax, spec.nDefault);

  const events = [];
  let frameCounter = 0;
  let maxDepth = 0;

  const makeFrame = (depth, parentId, branch, label) => ({
    frameId: frameCounter++,
    depth,
    parentId,
    branch,
    branchCount: 0,
    label,
  });

  const emit = (type, frame, extra = {}) => {
    if (events.length >= maxEventCap) {
      throw new RangeError(`recur timeline exceeds ${maxEventCap} events`);
    }
    const tIndex = events.length;
    events.push({
      type,
      depth: frame.depth,
      frameId: frame.frameId,
      parentId: frame.parentId,
      branch: frame.branch,
      branchCount: frame.branchCount,
      value: "value" in extra ? extra.value : null,
      memoHit: Boolean(extra.memoHit),
      label: frame.label,
      tIndex,
      tStart: tIndex * stepSeconds,
    });
    if (frame.depth > maxDepth) maxDepth = frame.depth;
  };

  const runLinear = (kind, value, depth, parentId, branch) => {
    const frame = makeFrame(depth, parentId, branch, `${kind.label}(${value})`);
    const base = kind.isBase(value);
    frame.branchCount = base ? 0 : 1;
    emit("call", frame, { value });
    let result;
    if (base) {
      result = kind.baseValue(value);
      emit("base", frame, { value: result });
    } else {
      const child = runLinear(kind, value - 1, depth + 1, frame.frameId, 0);
      result = kind.combine(value, child);
    }
    emit("return", frame, { value: result });
    return result;
  };

  // Hanoi with base case k === 0 (do nothing). The disk move between the two
  // recursive calls is the `base` event; its value is the disk number k, so the
  // move sequence is the ruler sequence (1,2,1,3,1,2,1,...).
  const runHanoi = (k, from, to, via, depth, parentId, branch) => {
    const frame = makeFrame(depth, parentId, branch, `hanoi(${k}: ${from}→${to})`);
    frame.branchCount = k === 0 ? 0 : 2;
    emit("call", frame, { value: k });
    if (k === 0) {
      emit("return", frame, { value: 0 });
      return;
    }
    runHanoi(k - 1, from, via, to, depth + 1, frame.frameId, 0);
    emit("base", frame, { value: k });
    runHanoi(k - 1, via, to, from, depth + 1, frame.frameId, 1);
    emit("return", frame, { value: k });
  };

  const runFib = (k, depth, parentId, branch, memo) => {
    if (memoize && memo.has(k)) {
      const frame = makeFrame(depth, parentId, branch, `fib(${k})`);
      frame.branchCount = 0;
      const cached = memo.get(k);
      emit("call", frame, { value: k, memoHit: true });
      emit("return", frame, { value: cached, memoHit: true });
      return cached;
    }
    const base = k < 2;
    const frame = makeFrame(depth, parentId, branch, `fib(${k})`);
    frame.branchCount = base ? 0 : 2;
    emit("call", frame, { value: k });
    let result;
    if (base) {
      result = k;
      emit("base", frame, { value: result });
    } else {
      const left = runFib(k - 1, depth + 1, frame.frameId, 0, memo);
      const right = runFib(k - 2, depth + 1, frame.frameId, 1, memo);
      result = left + right;
    }
    if (memoize) memo.set(k, result);
    emit("return", frame, { value: result });
    return result;
  };

  if (spec.kind === "linear") {
    runLinear(LINEAR_KINDS[spec.id], argument, 0, null, 0);
  } else if (spec.id === "hanoi") {
    runHanoi(argument, "A", "C", "B", 0, null, 0);
  } else if (spec.id === "fibonacci") {
    runFib(argument, 0, null, 0, new Map());
  }

  return {
    program: spec.id,
    n: argument,
    stepSeconds,
    events,
    frameCount: frameCounter,
    maxDepth,
    duration: events.length * stepSeconds,
  };
}

/**
 * Depth-vs-time signal, one normalized value in [0,1] per event. It drives the
 * canvas and, sped past audio rate, becomes the fused-tone waveform.
 */
export function stackDepthProfile(timeline) {
  const events = timeline && Array.isArray(timeline.events) ? timeline.events : [];
  const maxDepth = timeline && timeline.maxDepth > 0 ? timeline.maxDepth : 1;
  return events.map((event) => event.depth / maxDepth);
}
