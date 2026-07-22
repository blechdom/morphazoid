const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_MAX_SYMBOLS = 180_000;

export const L_SYSTEM_PRESETS = Object.freeze([
  Object.freeze({
    id: "pythagorean",
    name: "Pythagorean tree",
    axiom: "FX",
    rules: Object.freeze({ X: ">[-FX]+FX<" }),
    iterations: 7,
    maxIterations: 11,
    angle: 45,
    lengthScale: 0.72,
  }),
  Object.freeze({
    id: "plant",
    name: "Branching plant",
    axiom: "X",
    rules: Object.freeze({ X: "F+[[X]-X]-F[-FX]+X", F: "FF" }),
    iterations: 5,
    maxIterations: 6,
    angle: 22.5,
    lengthScale: 1,
  }),
  Object.freeze({
    id: "coral",
    name: "Coral",
    axiom: "F",
    rules: Object.freeze({ F: ">FF+[+F-F-F]-[-F+F+F]<" }),
    iterations: 4,
    maxIterations: 5,
    angle: 22.5,
    lengthScale: 0.72,
  }),
  Object.freeze({
    id: "dragon",
    name: "Dragon curve",
    axiom: "FX",
    rules: Object.freeze({ X: "X+YF+", Y: "-FX-Y" }),
    iterations: 12,
    maxIterations: 15,
    angle: 90,
    lengthScale: 1,
  }),
  Object.freeze({
    id: "koch",
    name: "Koch snowflake",
    axiom: "F--F--F",
    rules: Object.freeze({ F: "F+F--F+F" }),
    iterations: 4,
    maxIterations: 5,
    angle: 60,
    lengthScale: 1,
  }),
  Object.freeze({
    id: "sierpinski",
    name: "Sierpiński triangle",
    axiom: "F-G-G",
    rules: Object.freeze({ F: "F-G+F+G-F", G: "GG" }),
    iterations: 5,
    maxIterations: 6,
    angle: 120,
    lengthScale: 1,
    drawSymbols: "FG",
  }),
  Object.freeze({
    id: "hilbert",
    name: "Hilbert curve",
    axiom: "X",
    rules: Object.freeze({ X: "-YF+XFX+FY-", Y: "+XF-YFY-FX+" }),
    iterations: 5,
    maxIterations: 7,
    angle: 90,
    lengthScale: 1,
  }),
  Object.freeze({
    id: "gosper",
    name: "Gosper curve",
    axiom: "X",
    rules: Object.freeze({
      X: "X+Y++Y-X--XX-Y+",
      Y: "-X+YY++Y+X--X-Y",
    }),
    iterations: 4,
    maxIterations: 5,
    angle: 60,
    lengthScale: 1,
    drawSymbols: "XY",
  }),
  Object.freeze({
    id: "cantor",
    name: "Cantor set",
    axiom: "F",
    rules: Object.freeze({ F: "FfF", f: "fff" }),
    iterations: 6,
    maxIterations: 11,
    angle: 0,
    lengthScale: 1,
    moveSymbols: "f",
  }),
  Object.freeze({
    id: "levy",
    name: "Lévy C curve",
    axiom: "F",
    rules: Object.freeze({ F: "+F--F+" }),
    iterations: 12,
    maxIterations: 15,
    angle: 45,
    lengthScale: 1,
  }),
  Object.freeze({
    id: "terdragon",
    name: "Terdragon",
    axiom: "F",
    rules: Object.freeze({ F: "F-F+F" }),
    iterations: 7,
    maxIterations: 10,
    angle: 120,
    lengthScale: 1,
  }),
]);

export function expandLSystem(axiom, rules, iterations, maxSymbols = DEFAULT_MAX_SYMBOLS) {
  let result = String(axiom ?? "");
  const passes = Math.max(0, Math.floor(Number(iterations) || 0));
  const limit = Math.max(1, Math.floor(Number(maxSymbols) || DEFAULT_MAX_SYMBOLS));
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [];
    let length = 0;
    for (const symbol of result) {
      const replacement = Object.prototype.hasOwnProperty.call(rules, symbol)
        ? String(rules[symbol])
        : symbol;
      length += replacement.length;
      if (length > limit) throw new RangeError(`L-system exceeds ${limit} symbols.`);
      next.push(replacement);
    }
    result = next.join("");
  }
  return result;
}

function safeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/**
 * Interpret drawing and pen-up moves, +/- as turns, [] as branch state, and
 * >/< as local step scaling. The turtle starts toward +X by default so growth
 * reads naturally from left to right on the instrument canvas.
 */
export function traceLSystem({
  axiom = "F",
  rules = {},
  iterations = 0,
  angle = 25,
  lengthScale = 1,
  step = 1,
  drawSymbols = "F",
  moveSymbols = "",
  turnAsymmetry = 0,
  maxSymbols = DEFAULT_MAX_SYMBOLS,
} = {}) {
  const instructions = expandLSystem(axiom, rules, iterations, maxSymbols);
  const turn = safeNumber(angle, 25) * DEG_TO_RAD;
  const taper = Math.max(0.05, safeNumber(lengthScale, 1));
  const turnSkew = Math.min(0.8, Math.max(-0.8, safeNumber(turnAsymmetry, 0)));
  const forwardSymbols = new Set(String(drawSymbols ?? "F"));
  const penUpSymbols = new Set(String(moveSymbols ?? ""));
  let distance = Math.max(0.0001, safeNumber(step, 1));
  let state = {
    x: 0,
    y: 0,
    heading: 0,
    turnTotal: 0,
    pathDistance: 0,
    depth: 0,
    parentIndex: null,
  };
  const stack = [];
  const segments = [];
  const generations = [];
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let maxPathDistance = 0;

  for (let instructionIndex = 0; instructionIndex < instructions.length; instructionIndex += 1) {
    const command = instructions[instructionIndex];
    const paintable = forwardSymbols.has(command) || command === "B";
    if (paintable || penUpSymbols.has(command)) {
      const signedDistance = command === "B" ? -distance : distance;
      const start = { x: state.x, y: state.y };
      state.x += Math.cos(state.heading) * signedDistance;
      state.y += Math.sin(state.heading) * signedDistance;
      const end = { x: state.x, y: state.y };
      const startDistance = state.pathDistance;
      state.pathDistance += Math.abs(signedDistance);
      maxPathDistance = Math.max(maxPathDistance, state.pathDistance);
      bounds.minX = Math.min(bounds.minX, state.x);
      bounds.maxX = Math.max(bounds.maxX, state.x);
      bounds.minY = Math.min(bounds.minY, state.y);
      bounds.maxY = Math.max(bounds.maxY, state.y);
      if (!paintable) {
        const parent = state.parentIndex === null ? null : segments[state.parentIndex];
        if (parent) parent.subtreeEndDistance = Math.max(parent.subtreeEndDistance, state.pathDistance);
        continue;
      }
      const parent = state.parentIndex === null ? null : segments[state.parentIndex];
      const generation = parent ? parent.generation + 1 : 0;
      const index = segments.length;
      const localTurn = parent ? state.turnTotal - parent.turnTotal : 0;
      const segment = {
        start,
        end,
        depth: state.depth,
        heading: state.heading,
        turnTotal: state.turnTotal,
        turn: localTurn,
        cumulativeTurn: (parent?.cumulativeTurn ?? 0) + localTurn,
        parentIndex: state.parentIndex,
        children: [],
        generation,
        startDistance,
        endDistance: state.pathDistance,
        subtreeEndDistance: state.pathDistance,
        forkDepth: 0,
        powerShare: 1,
        voiceKey: "",
        instructionIndex,
        index,
      };
      segments.push(segment);
      if (parent) parent.children.push(index);
      (generations[generation] ??= []).push(segment);
      state.parentIndex = index;
    } else if (command === "+") {
      const amount = turn * (1 + turnSkew);
      state.heading += amount;
      state.turnTotal += amount;
    } else if (command === "-") {
      const amount = turn * (1 - turnSkew);
      state.heading -= amount;
      state.turnTotal -= amount;
    } else if (command === "[") {
      stack.push({ ...state, distance });
      state.depth += 1;
    } else if (command === "]") {
      const restored = stack.pop();
      if (restored) {
        ({ distance, ...state } = restored);
      }
    } else if (command === ">") {
      distance *= taper;
    } else if (command === "<") {
      distance /= taper;
    }
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    for (const childIndex of segment.children) {
      segment.subtreeEndDistance = Math.max(
        segment.subtreeEndDistance,
        segments[childIndex].subtreeEndDistance,
      );
    }
  }

  const rootIndices = segments
    .filter((segment) => segment.parentIndex === null)
    .map((segment) => segment.index);
  rootIndices.forEach((rootIndex, rootOrdinal) => {
    const root = segments[rootIndex];
    root.powerShare = 1 / Math.max(1, rootIndices.length);
    root.voiceKey = `root:${rootOrdinal}`;
  });
  for (const segment of segments) {
    const childCount = segment.children.length;
    segment.children.forEach((childIndex, childOrdinal) => {
      const child = segments[childIndex];
      child.powerShare = segment.powerShare / Math.max(1, childCount);
      child.forkDepth = segment.forkDepth + (childCount > 1 ? 1 : 0);
      child.voiceKey = childOrdinal === 0
        ? segment.voiceKey
        : `${segment.voiceKey}/branch:${childIndex}`;
    });
  }
  const duration = Math.max(maxPathDistance, rootIndices.reduce(
    (maximum, index) => Math.max(maximum, segments[index].subtreeEndDistance),
    0,
  ));

  return {
    instructions,
    segments,
    generations,
    maxGeneration: Math.max(0, generations.length - 1),
    maxForkDepth: segments.reduce((maximum, segment) => Math.max(maximum, segment.forkDepth), 0),
    rootIndices,
    duration,
    bounds,
  };
}

/**
 * Move one synchronous frontier through the tree by cumulative path distance.
 * At a fork the parent disappears and its children begin together. Screen X
 * never participates, so a fold can travel left without reversing time.
 */
export function branchingSnapshotAtPhase(trace, phase) {
  const segments = trace?.segments ?? [];
  const duration = Math.max(0, safeNumber(trace?.duration, 0));
  const wrapped = ((safeNumber(phase, 0) % 1) + 1) % 1;
  const distance = wrapped * duration;
  if (!segments.length || duration <= 0) return { phase: wrapped, distance, heads: [] };
  const epsilon = Math.max(1e-12, duration * 1e-12);
  const heads = [];
  const pending = [...(trace.rootIndices ?? [])].reverse();
  while (pending.length) {
    const segment = segments[pending.pop()];
    if (
      !segment
      || distance < segment.startDistance - epsilon
      || distance - epsilon >= segment.subtreeEndDistance
    ) continue;
    if (distance < segment.endDistance - epsilon) {
      const segmentLength = Math.max(1e-9, segment.endDistance - segment.startDistance);
      const progress = Math.min(1, Math.max(0, (distance - segment.startDistance) / segmentLength));
      heads.push({
        x: segment.start.x + (segment.end.x - segment.start.x) * progress,
        y: segment.start.y + (segment.end.y - segment.start.y) * progress,
        depth: segment.forkDepth,
        stackDepth: segment.depth,
        heading: segment.heading,
        turn: segment.turn,
        cumulativeTurn: segment.cumulativeTurn,
        generation: segment.generation,
        progress,
        index: segment.index,
        powerShare: segment.powerShare,
        voiceKey: segment.voiceKey,
        segment,
      });
      continue;
    }
    for (let index = segment.children.length - 1; index >= 0; index -= 1) {
      pending.push(segment.children[index]);
    }
  }
  return { phase: wrapped, distance, heads };
}

export function branchingPlayheadsAtPhase(trace, phase) {
  return branchingSnapshotAtPhase(trace, phase).heads;
}

const STRUCTURE_MODES = new Set(["final", "sequence", "together", "accumulate", "canon"]);

/** Convert per-iteration traversal speed to the normalized UI phase rate. */
export function iterationPlaybackPhaseRate(mode, iterationCount, traversalsPerSecond) {
  const count = Math.max(1, Math.floor(safeNumber(iterationCount, 1)));
  const speed = safeNumber(traversalsPerSecond, 0);
  return mode === "sequence" || mode === "accumulate" ? speed / count : speed;
}

/**
 * Schedule complete expansion stages with equal normalized duration.
 * Sequence assigns every iteration one equal block; Together phase-locks all
 * stages; Accumulate adds one phase-locked layer per block; Canon keeps every
 * stage sounding with evenly staggered phases.
 */
export function iterationPlaybackAtPhase(traces, phase, mode = "final") {
  const available = Array.isArray(traces) ? traces.filter(Boolean) : [];
  const wrapped = ((safeNumber(phase, 0) % 1) + 1) % 1;
  const playbackMode = STRUCTURE_MODES.has(mode) ? mode : "final";
  if (!available.length) return { mode: playbackMode, phase: wrapped, entries: [] };

  const entryFor = (trace, index, localPhase) => ({
    iteration: Number.isInteger(trace.iteration) ? trace.iteration : index + 1,
    trace,
    localPhase,
    snapshot: branchingSnapshotAtPhase(trace, localPhase),
  });

  if (playbackMode === "sequence") {
    const scaled = wrapped * available.length;
    const index = Math.min(available.length - 1, Math.floor(scaled));
    return {
      mode: playbackMode,
      phase: wrapped,
      activeIteration: Number.isInteger(available[index].iteration)
        ? available[index].iteration
        : index + 1,
      entries: [entryFor(available[index], index, scaled - index)],
    };
  }

  if (playbackMode === "accumulate") {
    const scaled = wrapped * available.length;
    const index = Math.min(available.length - 1, Math.floor(scaled));
    const localPhase = scaled - index;
    return {
      mode: playbackMode,
      phase: wrapped,
      activeIteration: Number.isInteger(available[index].iteration)
        ? available[index].iteration
        : index + 1,
      entries: available
        .slice(0, index + 1)
        .map((trace, entryIndex) => entryFor(trace, entryIndex, localPhase)),
    };
  }

  if (playbackMode === "together" || playbackMode === "canon") {
    return {
      mode: playbackMode,
      phase: wrapped,
      entries: available.map((trace, index) => entryFor(
        trace,
        index,
        playbackMode === "canon" ? (wrapped + index / available.length) % 1 : wrapped,
      )),
    };
  }

  const index = available.length - 1;
  return {
    mode: "final",
    phase: wrapped,
    activeIteration: Number.isInteger(available[index].iteration)
      ? available[index].iteration
      : index + 1,
    entries: [entryFor(available[index], index, wrapped)],
  };
}

/**
 * Pick progressively finer samples without replacing earlier selections.
 * Raising a voice cap therefore adds branch keys instead of churning the
 * voices already sounding at the previous cap.
 */
export function progressiveSampleIndices(length, count) {
  const total = Math.max(0, Math.floor(safeNumber(length, 0)));
  const requested = Math.min(total, Math.max(0, Math.floor(safeNumber(count, 0))));
  if (requested === 0) return [];
  if (requested === total) return Array.from({ length: total }, (_, index) => index);

  const order = [0];
  if (total > 1) order.push(total - 1);
  const intervals = total > 2 ? [[0, total - 1]] : [];
  let cursor = 0;
  while (order.length < requested && cursor < intervals.length) {
    const [low, high] = intervals[cursor];
    cursor += 1;
    const middle = Math.floor((low + high) / 2);
    if (middle <= low || middle >= high) continue;
    order.push(middle);
    if (middle - low > 1) intervals.push([low, middle]);
    if (high - middle > 1) intervals.push([middle, high]);
  }

  // Defensive fill for very small or uneven intervals.
  if (order.length < requested) {
    const selected = new Set(order);
    for (let index = 0; index < total && order.length < requested; index += 1) {
      if (!selected.has(index)) order.push(index);
    }
  }
  return order.slice(0, requested).sort((left, right) => left - right);
}

/** Reserve representation for every sounding iteration before filling voices. */
export function allocateIterationVoiceHeads(playheads, maxVoices = 128) {
  const source = Array.isArray(playheads) ? playheads : [];
  const limit = Math.max(0, Math.floor(safeNumber(maxVoices, 128)));
  if (source.length <= limit) return [...source];
  if (limit === 0) return [];
  const groups = [];
  const byIteration = new Map();
  for (const head of source) {
    const key = head?.iteration ?? "unknown";
    if (!byIteration.has(key)) {
      const group = [];
      byIteration.set(key, group);
      groups.push(group);
    }
    byIteration.get(key).push(head);
  }

  const selectedGroups = groups.length <= limit
    ? groups
    : Array.from({ length: limit }, (_, index) => groups[
      limit === 1 ? groups.length - 1 : Math.round(index * (groups.length - 1) / (limit - 1))
    ]);
  const quotas = selectedGroups.map(() => 1);
  let remaining = limit - selectedGroups.length;
  while (remaining > 0) {
    let candidate = -1;
    let candidateNeed = -1;
    selectedGroups.forEach((group, index) => {
      if (quotas[index] >= group.length) return;
      const need = group.length / (quotas[index] + 1);
      if (need > candidateNeed) {
        candidate = index;
        candidateNeed = need;
      }
    });
    if (candidate < 0) break;
    quotas[candidate] += 1;
    remaining -= 1;
  }

  return selectedGroups.flatMap((group, groupIndex) => {
    const count = quotas[groupIndex];
    if (count >= group.length) return group;
    return progressiveSampleIndices(group.length, count).map((index) => group[index]);
  });
}

/** Keep the summed power constant as one oscillator bifurcates into many. */
export function bifurcatingVoiceGain(voiceCount, combinedGain = 0.38) {
  const count = Math.max(1, Math.floor(safeNumber(voiceCount, 1)));
  const total = Math.max(0, safeNumber(combinedGain, 0.38));
  return total / Math.sqrt(count);
}

export function branchVoiceGain(powerShare, activePower = 1, combinedGain = 0.38) {
  const share = Math.max(0, safeNumber(powerShare, 0));
  const requestedPower = safeNumber(activePower, 1);
  const totalPower = requestedPower > 0 ? requestedPower : 1;
  return Math.max(0, safeNumber(combinedGain, 0.38)) * Math.sqrt(share / totalPower);
}

/** Map inherited turtle heading to pitch without treating screen X as time. */
export function branchAngleFrequency(
  headingRadians,
  trunkFrequency = 110,
  octavesPerTurn = 2,
) {
  const heading = safeNumber(headingRadians, 0);
  const base = Math.max(0.0001, safeNumber(trunkFrequency, 110));
  const scale = safeNumber(octavesPerTurn, 2);
  return Math.min(20_000, Math.max(20, base * 2 ** (heading / (Math.PI * 2) * scale)));
}

export function pointOnLSystem(trace, phase) {
  const segments = trace?.segments ?? [];
  if (!segments.length) return null;
  const wrapped = ((safeNumber(phase, 0) % 1) + 1) % 1;
  const scaled = wrapped * segments.length;
  const index = Math.min(segments.length - 1, Math.floor(scaled));
  const progress = scaled - index;
  const segment = segments[index];
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * progress,
    y: segment.start.y + (segment.end.y - segment.start.y) * progress,
    depth: segment.depth,
    index,
    progress,
    segment,
  };
}

export function normalizeLSystemPoint(point, bounds) {
  const width = Math.max(1e-9, bounds.maxX - bounds.minX);
  const height = Math.max(1e-9, bounds.maxY - bounds.minY);
  return {
    x: (point.x - bounds.minX) / width,
    y: (point.y - bounds.minY) / height,
  };
}
