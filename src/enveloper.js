/**
 * Pure model for Enveloper's fixed three-generation score.
 *
 * One root envelope partitions the cycle into three branch intervals. Each
 * branch envelope partitions its inherited interval into three leaf notes:
 *
 *     1 root -> 3 branches -> 9 FM leaves
 *
 * Envelope node time is normalized to 0..1 in its parent's interval. Node
 * level is also normalized to 0..1. The two interior times are movable splits;
 * the first and last times remain anchored at 0 and 1.
 */

export const ENVELOPER_STRUCTURE = Object.freeze({
  rootCount: 1,
  branchCount: 3,
  leavesPerBranch: 3,
  leafCount: 9,
  nodesPerEnvelope: 4,
});

// Eight percent keeps every nested leaf at least 25.6 ms long at the UI's
// four-second minimum cycle (0.08 × 0.08 × 4). This matches the click-safe FM
// renderer's minimum gate instead of allowing inaudible sub-millisecond slivers.
export const ENVELOPER_MIN_SPLIT_GAP = 0.08;

export const ENVELOPER_LIMITS = Object.freeze({
  cycleSeconds: Object.freeze({ minimum: 0.75, maximum: 120 }),
  frequencyHz: Object.freeze({ minimum: 20, maximum: 20_000 }),
  modulationIndex: Object.freeze({ minimum: 0, maximum: 14 }),
  modulationRatio: Object.freeze({ minimum: 0.5, maximum: 8 }),
  brightness: Object.freeze({ minimum: 0.18, maximum: 1 }),
  pan: Object.freeze({ minimum: -1, maximum: 1 }),
});

export const ENVELOPER_SOUND_DEFAULTS = Object.freeze({
  minimumFrequencyHz: 55,
  maximumFrequencyHz: 1_760,
  maximumModulationIndex: 14,
  minimumModulationRatio: 0.5,
  maximumModulationRatio: 8,
  minimumBrightness: 0.18,
  maximumBrightness: 1,
  stereoSpread: 0.72,
});

const FALLBACK_TIMES = Object.freeze([0, 1 / 3, 2 / 3, 1]);
const FALLBACK_LEVELS = Object.freeze([0.7, 1, 0.8, 0.6]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

function nodeTime(node, fallback) {
  if (Number.isFinite(Number(node?.time))) return Number(node.time);
  if (Number.isFinite(Number(node?.x))) return Number(node.x);
  return fallback;
}

function nodeLevel(node, fallback) {
  if (Number.isFinite(Number(node?.level))) return Number(node.level);
  if (Number.isFinite(Number(node?.y))) return Number(node.y);
  return fallback;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function presetEnvelope(times, levels) {
  return {
    nodes: FALLBACK_TIMES.map((_, index) => ({
      time: times[index],
      level: levels[index],
    })),
  };
}

function presetState({
  cycleSeconds,
  rootTimes,
  rootLevels,
  branchTimes,
  branchLevels,
  leaves,
}) {
  return {
    cycleSeconds,
    root: presetEnvelope(rootTimes, rootLevels),
    branches: branchTimes.map((times, index) => (
      presetEnvelope(times, branchLevels[index])
    )),
    leaves: leaves.map(([pitch, timbre]) => ({ pitch, timbre })),
  };
}

/** Four immutable starting points; call createEnveloperState() for an editable copy. */
export const ENVELOPER_PRESETS = deepFreeze([
  {
    id: "balanced",
    label: "Balanced canopy",
    state: presetState({
      cycleSeconds: 9,
      rootTimes: [0, 1 / 3, 2 / 3, 1],
      rootLevels: [0.72, 1, 0.82, 0.64],
      branchTimes: [
        [0, 1 / 3, 2 / 3, 1],
        [0, 1 / 3, 2 / 3, 1],
        [0, 1 / 3, 2 / 3, 1],
      ],
      branchLevels: [
        [0.28, 0.95, 0.58, 0.18],
        [0.42, 0.8, 1, 0.3],
        [0.2, 0.76, 0.5, 0.88],
      ],
      leaves: [
        [0.32, 0.18], [0.48, 0.42], [0.66, 0.7],
        [0.4, 0.3], [0.58, 0.62], [0.78, 0.86],
        [0.24, 0.12], [0.52, 0.54], [0.7, 0.78],
      ],
    }),
  },
  {
    id: "long-middle",
    label: "Long middle",
    state: presetState({
      cycleSeconds: 10.5,
      rootTimes: [0, 0.2, 0.76, 1],
      rootLevels: [0.34, 0.9, 1, 0.42],
      branchTimes: [
        [0, 0.24, 0.68, 1],
        [0, 0.18, 0.82, 1],
        [0, 0.42, 0.7, 1],
      ],
      branchLevels: [
        [0.18, 0.9, 0.5, 0.26],
        [0.52, 1, 0.72, 0.48],
        [0.24, 0.64, 0.96, 0.16],
      ],
      leaves: [
        [0.2, 0.78], [0.43, 0.34], [0.62, 0.58],
        [0.34, 0.2], [0.72, 0.88], [0.52, 0.44],
        [0.28, 0.68], [0.48, 0.24], [0.82, 0.94],
      ],
    }),
  },
  {
    id: "falling-glass",
    label: "Falling glass",
    state: presetState({
      cycleSeconds: 7.5,
      rootTimes: [0, 0.42, 0.72, 1],
      rootLevels: [1, 0.76, 0.48, 0.2],
      branchTimes: [
        [0, 0.46, 0.74, 1],
        [0, 0.3, 0.58, 1],
        [0, 0.2, 0.55, 1],
      ],
      branchLevels: [
        [1, 0.72, 0.4, 0.18],
        [0.84, 0.58, 0.3, 0.12],
        [0.68, 0.42, 0.2, 0.08],
      ],
      leaves: [
        [0.9, 0.88], [0.78, 0.7], [0.66, 0.56],
        [0.6, 0.82], [0.5, 0.62], [0.4, 0.42],
        [0.34, 0.72], [0.24, 0.48], [0.12, 0.24],
      ],
    }),
  },
  {
    id: "constellation",
    label: "Constellation",
    state: presetState({
      cycleSeconds: 12,
      rootTimes: [0, 0.16, 0.54, 1],
      rootLevels: [0.16, 1, 0.36, 0.84],
      branchTimes: [
        [0, 0.2, 0.78, 1],
        [0, 0.5, 0.68, 1],
        [0, 0.12, 0.36, 1],
      ],
      branchLevels: [
        [0.14, 0.9, 0.28, 0.74],
        [0.82, 0.2, 1, 0.38],
        [0.24, 0.72, 0.18, 0.94],
      ],
      leaves: [
        [0.16, 0.26], [0.74, 0.92], [0.42, 0.5],
        [0.88, 0.72], [0.3, 0.16], [0.58, 0.64],
        [0.22, 0.84], [0.68, 0.34], [0.96, 1],
      ],
    }),
  },
]);

export const DEFAULT_ENVELOPER_PRESET_ID = "balanced";
export const DEFAULT_ENVELOPER_STATE = ENVELOPER_PRESETS[0].state;

const PRESET_BY_ID = new Map(ENVELOPER_PRESETS.map((preset) => [preset.id, preset]));

/**
 * Repair an envelope into exactly four ordered time/level nodes.
 *
 * The return value is intentionally mutable for pointer-driven canvas editors.
 * Invalid values fall back by semantic node index; nodes are never re-sorted,
 * so the first split cannot silently become the second split.
 */
export function sanitizeEnveloperEnvelope(
  envelope,
  fallbackEnvelope = DEFAULT_ENVELOPER_STATE.root,
) {
  const sourceNodes = Array.isArray(envelope) ? envelope : envelope?.nodes;
  const fallbackNodes = Array.isArray(fallbackEnvelope)
    ? fallbackEnvelope
    : fallbackEnvelope?.nodes;
  const nodes = FALLBACK_TIMES.map((fallbackTime, index) => {
    const fallbackNode = fallbackNodes?.[index];
    const fallbackLevel = clamp(
      nodeLevel(fallbackNode, FALLBACK_LEVELS[index]),
      0,
      1,
      FALLBACK_LEVELS[index],
    );
    return {
      time: nodeTime(sourceNodes?.[index], nodeTime(fallbackNode, fallbackTime)),
      level: clamp(nodeLevel(sourceNodes?.[index], fallbackLevel), 0, 1, fallbackLevel),
    };
  });

  nodes[0].time = 0;
  nodes[3].time = 1;
  nodes[1].time = clamp(
    nodes[1].time,
    ENVELOPER_MIN_SPLIT_GAP,
    1 - 2 * ENVELOPER_MIN_SPLIT_GAP,
    FALLBACK_TIMES[1],
  );
  nodes[2].time = clamp(
    nodes[2].time,
    nodes[1].time + ENVELOPER_MIN_SPLIT_GAP,
    1 - ENVELOPER_MIN_SPLIT_GAP,
    Math.max(nodes[1].time + ENVELOPER_MIN_SPLIT_GAP, FALLBACK_TIMES[2]),
  );
  return { nodes };
}

/** Return a copied envelope with one node moved inside its legal neighbours. */
export function updateEnveloperNode(envelope, index, changes = {}) {
  const next = sanitizeEnveloperEnvelope(envelope);
  if (!Number.isInteger(index) || index < 0 || index >= ENVELOPER_STRUCTURE.nodesPerEnvelope) {
    return next;
  }

  const node = next.nodes[index];
  const requestedTime = Number.isFinite(Number(changes?.time))
    ? Number(changes.time)
    : Number.isFinite(Number(changes?.x)) ? Number(changes.x) : node.time;
  const requestedLevel = Number.isFinite(Number(changes?.level))
    ? Number(changes.level)
    : Number.isFinite(Number(changes?.y)) ? Number(changes.y) : node.level;

  node.level = clamp(requestedLevel, 0, 1, node.level);
  if (index === 1 || index === 2) {
    node.time = clamp(
      requestedTime,
      next.nodes[index - 1].time + ENVELOPER_MIN_SPLIT_GAP,
      next.nodes[index + 1].time - ENVELOPER_MIN_SPLIT_GAP,
      node.time,
    );
  }
  return next;
}

/** Clamp one leaf's editable XY pad coordinates. */
export function sanitizeEnveloperLeaf(leaf, fallback = { pitch: 0.5, timbre: 0.5 }) {
  const source = leaf && typeof leaf === "object" ? leaf : {};
  return {
    pitch: clamp(source.pitch ?? source.y, 0, 1, clamp(fallback?.pitch, 0, 1, 0.5)),
    timbre: clamp(source.timbre ?? source.x, 0, 1, clamp(fallback?.timbre, 0, 1, 0.5)),
  };
}

/** Repair arbitrary data into an editable fixed 1 -> 3 -> 9 state. */
export function sanitizeEnveloperState(
  candidate = {},
  fallbackState = DEFAULT_ENVELOPER_STATE,
) {
  const source = candidate?.state && typeof candidate.state === "object"
    ? candidate.state
    : candidate;
  const fallback = fallbackState?.state && typeof fallbackState.state === "object"
    ? fallbackState.state
    : fallbackState;
  const cycleSeconds = clamp(
    source?.cycleSeconds ?? source?.cycleDurationSeconds,
    ENVELOPER_LIMITS.cycleSeconds.minimum,
    ENVELOPER_LIMITS.cycleSeconds.maximum,
    clamp(
      fallback?.cycleSeconds,
      ENVELOPER_LIMITS.cycleSeconds.minimum,
      ENVELOPER_LIMITS.cycleSeconds.maximum,
      DEFAULT_ENVELOPER_STATE.cycleSeconds,
    ),
  );

  return {
    cycleSeconds,
    root: sanitizeEnveloperEnvelope(source?.root, fallback?.root),
    branches: Array.from({ length: ENVELOPER_STRUCTURE.branchCount }, (_, index) => (
      sanitizeEnveloperEnvelope(source?.branches?.[index], fallback?.branches?.[index])
    )),
    leaves: Array.from({ length: ENVELOPER_STRUCTURE.leafCount }, (_, index) => (
      sanitizeEnveloperLeaf(source?.leaves?.[index], fallback?.leaves?.[index])
    )),
  };
}

/** Return a fresh mutable state for a named preset (or the default preset). */
export function createEnveloperState(presetId = DEFAULT_ENVELOPER_PRESET_ID) {
  const preset = PRESET_BY_ID.get(presetId) ?? PRESET_BY_ID.get(DEFAULT_ENVELOPER_PRESET_ID);
  return sanitizeEnveloperState(preset.state, preset.state);
}

/** Return a fresh, sanitized mutable copy of an existing state. */
export function cloneEnveloperState(state = DEFAULT_ENVELOPER_STATE) {
  return sanitizeEnveloperState(state, DEFAULT_ENVELOPER_STATE);
}

/** Find immutable preset metadata by id. */
export function enveloperPresetById(id) {
  return PRESET_BY_ID.get(id) ?? PRESET_BY_ID.get(DEFAULT_ENVELOPER_PRESET_ID);
}

function sampleNodes(nodes, normalizedTime) {
  const time = clamp(normalizedTime, 0, 1, 0);
  if (time <= nodes[0].time) return nodes[0].level;
  for (let index = 1; index < nodes.length; index += 1) {
    const left = nodes[index - 1];
    const right = nodes[index];
    if (time > right.time) continue;
    const width = right.time - left.time;
    if (width <= 0) return right.level;
    const amount = (time - left.time) / width;
    return left.level + (right.level - left.level) * amount;
  }
  return nodes.at(-1).level;
}

/** Piecewise-linear level at a normalized envelope time. */
export function sampleEnveloperEnvelope(envelope, normalizedTime) {
  return sampleNodes(sanitizeEnveloperEnvelope(envelope).nodes, normalizedTime);
}

function frequencyBounds(options = {}) {
  const base = finite(options.baseFrequencyHz, ENVELOPER_SOUND_DEFAULTS.minimumFrequencyHz);
  const rangeOctaves = finite(options.pitchRangeOctaves, 5);
  const requestedMinimum = finite(options.minimumFrequencyHz, base);
  const requestedMaximum = finite(
    options.maximumFrequencyHz,
    base * 2 ** rangeOctaves,
  );
  const first = clamp(
    requestedMinimum,
    ENVELOPER_LIMITS.frequencyHz.minimum,
    ENVELOPER_LIMITS.frequencyHz.maximum,
    ENVELOPER_SOUND_DEFAULTS.minimumFrequencyHz,
  );
  const second = clamp(
    requestedMaximum,
    ENVELOPER_LIMITS.frequencyHz.minimum,
    ENVELOPER_LIMITS.frequencyHz.maximum,
    ENVELOPER_SOUND_DEFAULTS.maximumFrequencyHz,
  );
  return {
    minimum: Math.min(first, second),
    maximum: Math.max(first, second),
  };
}

/** Map normalized vertical position to logarithmic frequency. */
export function enveloperLeafFrequency(pitch, options = {}) {
  const amount = clamp(pitch, 0, 1, 0.5);
  const bounds = frequencyBounds(options);
  if (bounds.maximum <= bounds.minimum) return bounds.minimum;
  return bounds.minimum * (bounds.maximum / bounds.minimum) ** amount;
}

/** Map normalized horizontal position to a bounded FM timbre. */
export function enveloperLeafTimbre(timbre, options = {}) {
  const amount = clamp(timbre, 0, 1, 0.5);
  const maximumIndex = clamp(
    options.maximumModulationIndex,
    ENVELOPER_LIMITS.modulationIndex.minimum,
    ENVELOPER_LIMITS.modulationIndex.maximum,
    ENVELOPER_SOUND_DEFAULTS.maximumModulationIndex,
  );
  const minimumRatio = clamp(
    options.minimumModulationRatio,
    ENVELOPER_LIMITS.modulationRatio.minimum,
    ENVELOPER_LIMITS.modulationRatio.maximum,
    ENVELOPER_SOUND_DEFAULTS.minimumModulationRatio,
  );
  const maximumRatio = clamp(
    options.maximumModulationRatio,
    ENVELOPER_LIMITS.modulationRatio.minimum,
    ENVELOPER_LIMITS.modulationRatio.maximum,
    ENVELOPER_SOUND_DEFAULTS.maximumModulationRatio,
  );
  const minimumBrightness = clamp(
    options.minimumBrightness,
    0,
    1,
    ENVELOPER_SOUND_DEFAULTS.minimumBrightness,
  );
  const maximumBrightness = clamp(
    options.maximumBrightness,
    0,
    1,
    ENVELOPER_SOUND_DEFAULTS.maximumBrightness,
  );
  const lowRatio = Math.min(minimumRatio, maximumRatio);
  const highRatio = Math.max(minimumRatio, maximumRatio);
  const lowBrightness = Math.min(minimumBrightness, maximumBrightness);
  const highBrightness = Math.max(minimumBrightness, maximumBrightness);

  return {
    timbre: amount,
    modulationIndex: maximumIndex * amount ** 1.5,
    modulationRatio: lowRatio * (highRatio / lowRatio) ** amount,
    brightness: lowBrightness + (highBrightness - lowBrightness) * amount,
  };
}

/**
 * Derive the nine chronologically ordered FM events for one complete cycle.
 *
 * The root split owns each branch's total duration; the branch split allocates
 * that inherited duration among its three leaves. Parent and child envelope
 * levels are sampled at the leaf midpoint and multiplied for final amplitude.
 */
export function deriveEnveloperTimeline(candidate = DEFAULT_ENVELOPER_STATE, options = {}) {
  const state = sanitizeEnveloperState(candidate);
  const cycleSeconds = clamp(
    options.cycleSeconds ?? options.cycleDurationSeconds,
    ENVELOPER_LIMITS.cycleSeconds.minimum,
    ENVELOPER_LIMITS.cycleSeconds.maximum,
    state.cycleSeconds,
  );
  const stereoSpread = clamp(
    options.stereoSpread,
    0,
    1,
    ENVELOPER_SOUND_DEFAULTS.stereoSpread,
  );
  const events = [];

  for (let branchIndex = 0; branchIndex < ENVELOPER_STRUCTURE.branchCount; branchIndex += 1) {
    const branch = state.branches[branchIndex];
    const rootStart = state.root.nodes[branchIndex].time;
    const rootEnd = state.root.nodes[branchIndex + 1].time;
    const rootDuration = rootEnd - rootStart;

    for (
      let leafInBranch = 0;
      leafInBranch < ENVELOPER_STRUCTURE.leavesPerBranch;
      leafInBranch += 1
    ) {
      const index = branchIndex * ENVELOPER_STRUCTURE.leavesPerBranch + leafInBranch;
      const localStart = branch.nodes[leafInBranch].time;
      const localEnd = branch.nodes[leafInBranch + 1].time;
      const localMidpoint = (localStart + localEnd) * 0.5;
      const normalizedStart = rootStart + rootDuration * localStart;
      const normalizedEnd = rootStart + rootDuration * localEnd;
      const normalizedDuration = normalizedEnd - normalizedStart;
      const normalizedMidpoint = (normalizedStart + normalizedEnd) * 0.5;
      const leaf = state.leaves[index];
      const parentLevel = sampleNodes(state.root.nodes, normalizedMidpoint);
      const childLevel = sampleNodes(branch.nodes, localMidpoint);
      const timbre = enveloperLeafTimbre(leaf.timbre, options);

      events.push(Object.freeze({
        id: `leaf-${index + 1}`,
        index,
        branchIndex,
        leafInBranch,
        normalizedStart,
        normalizedEnd,
        normalizedDuration,
        startSeconds: normalizedStart * cycleSeconds,
        endSeconds: normalizedEnd * cycleSeconds,
        durationSeconds: normalizedDuration * cycleSeconds,
        pitch: leaf.pitch,
        timbre: timbre.timbre,
        frequencyHz: enveloperLeafFrequency(leaf.pitch, options),
        modulationIndex: timbre.modulationIndex,
        modulationRatio: timbre.modulationRatio,
        brightness: timbre.brightness,
        pan: ENVELOPER_STRUCTURE.leafCount === 1
          ? 0
          : (-1 + (2 * index) / (ENVELOPER_STRUCTURE.leafCount - 1)) * stereoSpread,
        parentLevel,
        childLevel,
        amplitude: clamp(parentLevel * childLevel, 0, 1, 0),
      }));
    }
  }

  return Object.freeze(events);
}
