const TWO_PI = Math.PI * 2;

const finiteOr = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, fallback)))
);

const clampInteger = (value, minimum, maximum, fallback = minimum) => (
  Math.round(clamp(value, minimum, maximum, fallback))
);

const wrap = (value, size) => {
  const integer = Math.trunc(finiteOr(value, 0));
  return ((integer % size) + size) % size;
};

const mix = (from, to, amount) => from + (to - from) * amount;
const fract = (value) => value - Math.floor(value);
const timeAlpha = (rate, seconds) => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, seconds));

const smoothstep = (edge0, edge1, value) => {
  const amount = clamp((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const COLONY_SYRINX_LUNG_COUNT = 16;
export const COLONY_SYRINX_BANK_COUNT = 4;
export const COLONY_SYRINX_LUNGS_PER_BANK = 4;
export const COLONY_SYRINX_PHONATOR_COUNT = 4;
export const COLONY_SYRINX_FOLD_COUNT = 8;
export const COLONY_SYRINX_MOUTH_COUNT = 3;
export const COLONY_SYRINX_LANE_COUNT = 6;
export const COLONY_SYRINX_LEGACY_LANE_COUNT = COLONY_SYRINX_MOUTH_COUNT;
export const COLONY_SYRINX_ROUTE_COUNT = 12;
export const COLONY_SYRINX_SEQUENCE_LENGTH = 16;
export const COLONY_SYRINX_CONTOUR_POINT_COUNT = 16;
export const COLONY_SYRINX_MAX_PRESSURE = 4;
export const COLONY_SYRINX_MAX_DELTA_SECONDS = 0.25;
export const COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR = 0.045;

export const COLONY_SYRINX_CONTOUR_IDS = Object.freeze([
  "breath",
  "tension",
  "routing",
  "maw",
  "speech",
  "click",
]);

export const COLONY_SYRINX_CONTOUR_SHAPES = Object.freeze([
  "smooth",
  "linear",
  "spline",
]);

const CONTOUR_PHASE_OFFSETS = Object.freeze([0, 0.11, 0.23, 0, 1 / 3, 2 / 3]);

export const COLONY_SYRINX_LIMITS = deepFreeze({
  breath: [0, 1],
  breathRateBpm: [2, 240],
  pressureGain: [0.1, 3],
  crossCoupling: [0, 1],
  colonyAmount: [0, 1],
  gateHysteresis: [0, 1],
  leak: [0, 0.6],
  valveSlewMs: [2, 500],
  tempoBpm: [20, 360],
  stepsPerBeat: [1, 8],
  swing: [-0.48, 0.48],
  laneLength: [1, COLONY_SYRINX_SEQUENCE_LENGTH],
  laneRate: [0.125, 8],
  contourDurationSeconds: [1, 120],
  contourRate: [0.125, 8],
  contourDepth: [0, 1],
  midiBaseNote: [0, 116],
  level: [0, 1],
});

const BANKS = Array.from({ length: COLONY_SYRINX_BANK_COUNT }, (_, index) => ({
  id: `bank-${index + 1}`,
  index,
  lungIndices: Array.from(
    { length: COLONY_SYRINX_LUNGS_PER_BANK },
    (__, lung) => index * COLONY_SYRINX_LUNGS_PER_BANK + lung,
  ),
  phonatorIndex: index,
  foldIndices: [index * 2, index * 2 + 1],
}));

const ROUTES = Array.from({ length: COLONY_SYRINX_ROUTE_COUNT }, (_, index) => ({
  id: `route-${Math.floor(index / COLONY_SYRINX_MOUTH_COUNT) + 1}-${(index % COLONY_SYRINX_MOUTH_COUNT) + 1}`,
  index,
  phonatorIndex: Math.floor(index / COLONY_SYRINX_MOUTH_COUNT),
  mouthIndex: index % COLONY_SYRINX_MOUTH_COUNT,
  midiOffset: index,
}));

export const COLONY_SYRINX_TOPOLOGY = deepFreeze({
  lungCount: COLONY_SYRINX_LUNG_COUNT,
  bankCount: COLONY_SYRINX_BANK_COUNT,
  lungsPerBank: COLONY_SYRINX_LUNGS_PER_BANK,
  phonatorCount: COLONY_SYRINX_PHONATOR_COUNT,
  foldCount: COLONY_SYRINX_FOLD_COUNT,
  mouthCount: COLONY_SYRINX_MOUTH_COUNT,
  laneCount: COLONY_SYRINX_LANE_COUNT,
  routeCount: COLONY_SYRINX_ROUTE_COUNT,
  sequenceLength: COLONY_SYRINX_SEQUENCE_LENGTH,
  banks: BANKS,
  routes: ROUTES,
});

// These are control-rate reductions, not claims that liquid or grains behave
// acoustically like a gas. The profiles deliberately expose different loading,
// release, impact, and jamming behavior to a downstream audio engine.
export const COLONY_SYRINX_MEDIA = deepFreeze({
  air: {
    id: "air",
    label: "Air",
    lungResponse: 2.8,
    transferRate: 5.4,
    routeConductance: 1.18,
    outletConductance: 1.24,
    pressureLeak: 0.06,
    phonationThreshold: 0.08,
    impactGain: 0.08,
    outputGain: 1,
    jamBuild: 0,
    jamRelease: 8,
  },
  water: {
    id: "water",
    label: "Water",
    lungResponse: 4.6,
    transferRate: 3.2,
    routeConductance: 0.72,
    outletConductance: 0.68,
    pressureLeak: 0.018,
    phonationThreshold: 0.24,
    impactGain: 0.82,
    outputGain: 0.86,
    jamBuild: 0,
    jamRelease: 5,
  },
  pellets: {
    id: "pellets",
    label: "Pellets",
    lungResponse: 1.65,
    transferRate: 1.42,
    routeConductance: 0.44,
    outletConductance: 0.4,
    pressureLeak: 0.025,
    phonationThreshold: 0.36,
    impactGain: 1.3,
    outputGain: 0.72,
    jamBuild: 4.8,
    jamRelease: 1.8,
  },
});

export const COLONY_SYRINX_LUNG_PHASES = Object.freeze(Array.from(
  { length: COLONY_SYRINX_LUNG_COUNT },
  (_, index) => fract((index % COLONY_SYRINX_LUNGS_PER_BANK) / COLONY_SYRINX_LUNGS_PER_BANK
    + Math.floor(index / COLONY_SYRINX_LUNGS_PER_BANK) / COLONY_SYRINX_LUNG_COUNT),
));

export const COLONY_SYRINX_MOUTH_ARCHETYPES = deepFreeze([
  {
    id: "maw",
    label: "Low tract / bass outlet",
    opening: 0.72,
    tongueSize: 0.92,
    tonguePosition: 0.28,
    lipSize: 0.96,
    lipTension: 0.28,
    cavity: 0.9,
    resonanceHz: 118,
    pan: -0.72,
    leak: 0.018,
    slewMs: 138,
  },
  {
    id: "speech",
    label: "Speech mouth",
    opening: 0.64,
    tongueSize: 0.58,
    tonguePosition: 0.62,
    lipSize: 0.54,
    lipTension: 0.56,
    cavity: 0.56,
    resonanceHz: 420,
    pan: 0,
    leak: 0.012,
    slewMs: 62,
  },
  {
    id: "click",
    label: "Click / whistle",
    opening: 0.52,
    tongueSize: 0.2,
    tonguePosition: 0.84,
    lipSize: 0.18,
    lipTension: 0.84,
    cavity: 0.2,
    resonanceHz: 1_480,
    pan: 0.72,
    leak: 0.006,
    slewMs: 18,
  },
]);

const maskForRoutes = (...routeIndices) => routeIndices.reduce(
  (mask, routeIndex) => mask | (1 << routeIndex),
  0,
);

const CONTINUOUS_LEGACY_STEPS = Object.freeze(
  Array(COLONY_SYRINX_SEQUENCE_LENGTH).fill(1),
);

export const DEFAULT_COLONY_SYRINX_LANES = deepFreeze([
  { id: "maw", length: 16, rate: 1, muted: false, steps: CONTINUOUS_LEGACY_STEPS },
  { id: "speech", length: 16, rate: 1, muted: false, steps: CONTINUOUS_LEGACY_STEPS },
  { id: "click", length: 16, rate: 1, muted: false, steps: CONTINUOUS_LEGACY_STEPS },
]);

const ALL_ROUTE_MASK = maskForRoutes(
  ...Array.from({ length: COLONY_SYRINX_ROUTE_COUNT }, (_, index) => index),
);

export const DEFAULT_COLONY_SYRINX_SEQUENCE = deepFreeze(Array.from(
  { length: COLONY_SYRINX_SEQUENCE_LENGTH },
  () => ({
    routeMask: ALL_ROUTE_MASK,
    // Legacy score callers remain supported, but the native score is an open
    // field. Continuous contour lanes now move the valves and mouths.
    mouthGates: [1, 1, 1],
    accent: 1,
  }),
));

const DEFAULT_BANKS = deepFreeze([
  { drive: 0.94, compliance: 1, leak: 0.025 },
  { drive: 0.88, compliance: 0.92, leak: 0.032 },
  { drive: 0.82, compliance: 0.84, leak: 0.04 },
  { drive: 0.76, compliance: 0.76, leak: 0.048 },
]);

const DEFAULT_PHONATORS = deepFreeze([
  { frequencyHz: 72, tension: 0.36, closure: 0.72, asymmetry: -0.18, roughness: 0.28 },
  { frequencyHz: 108, tension: 0.48, closure: 0.66, asymmetry: 0.12, roughness: 0.2 },
  { frequencyHz: 164, tension: 0.62, closure: 0.58, asymmetry: -0.08, roughness: 0.15 },
  { frequencyHz: 246, tension: 0.76, closure: 0.5, asymmetry: 0.2, roughness: 0.12 },
]);

const DEFAULT_ROUTES = deepFreeze([
  [0.94, 0.58, 0.38],
  [0.74, 0.9, 0.52],
  [0.6, 0.78, 0.94],
  [0.86, 0.66, 0.76],
]);

const DEFAULT_ALTERNATE_ROUTES = deepFreeze([
  [0.42, 0.88, 0.7],
  [0.92, 0.36, 0.76],
  [0.78, 0.84, 0.34],
  [0.56, 0.94, 0.82],
]);

const contour = (id, points, shape, rate, depth = 1) => ({
  id,
  points,
  shape,
  rate,
  depth,
  muted: false,
});

export const DEFAULT_COLONY_SYRINX_CONTOURS = deepFreeze([
  contour("breath", [
    0.58, 0.64, 0.72, 0.82, 0.9, 0.86, 0.76, 0.68,
    0.62, 0.7, 0.8, 0.88, 0.84, 0.74, 0.66, 0.6,
  ], "spline", 1, 0.72),
  contour("tension", [
    0.38, 0.44, 0.58, 0.7, 0.76, 0.68, 0.54, 0.46,
    0.34, 0.42, 0.62, 0.82, 0.72, 0.56, 0.48, 0.4,
  ], "spline", 1.25, 0.68),
  contour("routing", [
    0.12, 0.2, 0.36, 0.58, 0.82, 0.9, 0.76, 0.54,
    0.3, 0.18, 0.26, 0.48, 0.72, 0.86, 0.64, 0.32,
  ], "smooth", 0.75, 0.9),
  contour("maw", [
    0.82, 0.9, 0.84, 0.68, 0.46, 0.28, 0.36, 0.62,
    0.88, 0.94, 0.78, 0.54, 0.32, 0.24, 0.48, 0.72,
  ], "spline", 0.5, 0.86),
  contour("speech", [
    0.34, 0.56, 0.82, 0.7, 0.42, 0.22, 0.48, 0.88,
    0.66, 0.28, 0.52, 0.92, 0.74, 0.38, 0.2, 0.46,
  ], "smooth", 1, 0.92),
  contour("click", [
    0.22, 0.74, 0.38, 0.86, 0.28, 0.66, 0.18, 0.92,
    0.32, 0.78, 0.24, 0.62, 0.16, 0.84, 0.3, 0.7,
  ], "smooth", 2, 0.78),
]);

export const DEFAULT_COLONY_SYRINX_STATE = deepFreeze({
  seed: 0x436f6c6f,
  mediumId: "air",
  breath: 0.76,
  breathRateBpm: 24,
  contourDurationSeconds: 16,
  pressureGain: 1.12,
  crossCoupling: 0.34,
  colonyAmount: 0.38,
  gateHysteresis: 0.46,
  leak: 0.035,
  valveSlewMs: 34,
  tempoBpm: 112,
  stepsPerBeat: 4,
  swing: 0.08,
  sequencerEnabled: true,
  midiBaseNote: 48,
  midiMode: "add",
  level: 0.58,
  lungEnabled: Array(COLONY_SYRINX_LUNG_COUNT).fill(true),
  phonatorEnabled: Array(COLONY_SYRINX_PHONATOR_COUNT).fill(true),
  foldEnabled: Array(COLONY_SYRINX_FOLD_COUNT).fill(true),
  mouthEnabled: Array(COLONY_SYRINX_MOUTH_COUNT).fill(true),
  banks: DEFAULT_BANKS,
  phonators: DEFAULT_PHONATORS,
  routes: DEFAULT_ROUTES,
  alternateRoutes: DEFAULT_ALTERNATE_ROUTES,
  mouths: COLONY_SYRINX_MOUTH_ARCHETYPES,
  contours: DEFAULT_COLONY_SYRINX_CONTOURS,
  lanes: DEFAULT_COLONY_SYRINX_LANES,
  sequence: DEFAULT_COLONY_SYRINX_SEQUENCE,
});

const zeroes = (length) => Array(length).fill(0);

export const DEFAULT_COLONY_SYRINX_RUNTIME = deepFreeze({
  timeSeconds: 0,
  contourPhase: 0,
  continuousBreath: 0,
  tensionOffset: 0,
  stepIndex: 0,
  stepElapsedSeconds: 0,
  laneStepIndices: zeroes(COLONY_SYRINX_LEGACY_LANE_COUNT),
  laneStepElapsedSeconds: zeroes(COLONY_SYRINX_LEGACY_LANE_COUNT),
  lanePhases: zeroes(COLONY_SYRINX_LANE_COUNT),
  laneVelocities: zeroes(COLONY_SYRINX_LANE_COUNT),
  contourValues: zeroes(COLONY_SYRINX_LANE_COUNT),
  lungPressures: zeroes(COLONY_SYRINX_LUNG_COUNT),
  reservoirPressures: zeroes(COLONY_SYRINX_BANK_COUNT),
  routeTargets: zeroes(COLONY_SYRINX_ROUTE_COUNT),
  routeApertures: zeroes(COLONY_SYRINX_ROUTE_COUNT),
  routeFlows: zeroes(COLONY_SYRINX_ROUTE_COUNT),
  routeJams: zeroes(COLONY_SYRINX_ROUTE_COUNT),
  colonyGates: zeroes(COLONY_SYRINX_ROUTE_COUNT),
  mouthApertures: zeroes(COLONY_SYRINX_MOUTH_COUNT),
  mouthPressures: zeroes(COLONY_SYRINX_MOUTH_COUNT),
  mouthFlows: zeroes(COLONY_SYRINX_MOUTH_COUNT),
  phonatorLevels: zeroes(COLONY_SYRINX_PHONATOR_COUNT),
  phonatorTensions: zeroes(COLONY_SYRINX_PHONATOR_COUNT),
  phonatorFrequenciesHz: zeroes(COLONY_SYRINX_PHONATOR_COUNT),
  foldActivities: zeroes(COLONY_SYRINX_FOLD_COUNT),
  foldFrequenciesHz: zeroes(COLONY_SYRINX_FOLD_COUNT),
  meanPressure: 0,
  totalFlow: 0,
  outputLevel: 0,
  impact: 0,
  granularActivity: 0,
});

const boundedFrom = (source, fallback, defaults, key, minimum, maximum) => clamp(
  source?.[key],
  minimum,
  maximum,
  clamp(fallback?.[key], minimum, maximum, defaults[key]),
);

const sanitizeBooleanVector = (source, fallback, defaults, length) => {
  const values = Array.isArray(source) || ArrayBuffer.isView(source) ? source : [];
  const base = Array.isArray(fallback) || ArrayBuffer.isView(fallback) ? fallback : defaults;
  return Array.from({ length }, (_, index) => (
    values[index] == null ? Boolean(base[index] ?? defaults[index]) : Boolean(values[index])
  ));
};

const normalizedSeed = (value, fallback = DEFAULT_COLONY_SYRINX_STATE.seed) => {
  if (typeof value === "string" && value.trim()) {
    let hash = 0x811c9dc5;
    for (const character of value.trim()) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) >>> 0 : Math.trunc(fallback) >>> 0;
};

const contourSourceAt = (source, id, index) => {
  if (Array.isArray(source)) {
    const named = source.find((candidate) => candidate?.id === id);
    if (named) return named;
    const positional = source[index];
    return positional?.id == null ? positional : undefined;
  }
  return source && typeof source === "object" ? source[id] : undefined;
};

const sanitizeContour = (source, fallback, defaults) => {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : defaults;
  const sourcePoints = Array.isArray(value.points) || ArrayBuffer.isView(value.points)
    ? value.points
    : [];
  const fallbackPoints = Array.isArray(base.points) || ArrayBuffer.isView(base.points)
    ? base.points
    : defaults.points;
  const shapeFallback = COLONY_SYRINX_CONTOUR_SHAPES.includes(base.shape)
    ? base.shape
    : defaults.shape;
  return {
    id: defaults.id,
    points: Array.from({ length: COLONY_SYRINX_CONTOUR_POINT_COUNT }, (_, index) => clamp(
      sourcePoints[index],
      0,
      1,
      clamp(fallbackPoints[index], 0, 1, defaults.points[index]),
    )),
    shape: COLONY_SYRINX_CONTOUR_SHAPES.includes(value.shape) ? value.shape : shapeFallback,
    rate: clamp(
      value.rate,
      ...COLONY_SYRINX_LIMITS.contourRate,
      clamp(base.rate, ...COLONY_SYRINX_LIMITS.contourRate, defaults.rate),
    ),
    depth: clamp(
      value.depth,
      ...COLONY_SYRINX_LIMITS.contourDepth,
      clamp(base.depth, ...COLONY_SYRINX_LIMITS.contourDepth, defaults.depth),
    ),
    muted: value.muted == null ? Boolean(base.muted ?? defaults.muted) : Boolean(value.muted),
  };
};

const sanitizeBank = (source, fallback, defaults) => ({
  drive: boundedFrom(source, fallback, defaults, "drive", 0, 1.5),
  compliance: boundedFrom(source, fallback, defaults, "compliance", 0.2, 2.5),
  leak: boundedFrom(source, fallback, defaults, "leak", 0, 0.6),
});

const sanitizePhonator = (source, fallback, defaults) => ({
  frequencyHz: boundedFrom(source, fallback, defaults, "frequencyHz", 12, 12_000),
  tension: boundedFrom(source, fallback, defaults, "tension", 0, 1),
  closure: boundedFrom(source, fallback, defaults, "closure", 0, 1),
  asymmetry: boundedFrom(source, fallback, defaults, "asymmetry", -1, 1),
  roughness: boundedFrom(source, fallback, defaults, "roughness", 0, 1),
});

const sanitizeMouth = (source, fallback, defaults) => ({
  id: typeof source?.id === "string" && source.id.trim()
    ? source.id.trim()
    : (typeof fallback?.id === "string" && fallback.id.trim() ? fallback.id.trim() : defaults.id),
  label: typeof source?.label === "string" && source.label.trim()
    ? source.label.trim()
    : (typeof fallback?.label === "string" && fallback.label.trim() ? fallback.label.trim() : defaults.label),
  opening: boundedFrom(source, fallback, defaults, "opening", 0, 1),
  tongueSize: boundedFrom(source, fallback, defaults, "tongueSize", 0, 1),
  tonguePosition: boundedFrom(source, fallback, defaults, "tonguePosition", 0, 1),
  lipSize: boundedFrom(source, fallback, defaults, "lipSize", 0, 1),
  lipTension: boundedFrom(source, fallback, defaults, "lipTension", 0, 1),
  cavity: boundedFrom(source, fallback, defaults, "cavity", 0, 1),
  resonanceHz: boundedFrom(source, fallback, defaults, "resonanceHz", 20, 12_000),
  pan: boundedFrom(source, fallback, defaults, "pan", -1, 1),
  leak: boundedFrom(source, fallback, defaults, "leak", 0, 0.3),
  slewMs: boundedFrom(source, fallback, defaults, "slewMs", 2, 500),
});

const sanitizeLane = (source, fallback, defaults) => {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : defaults;
  const sourceSteps = Array.isArray(value.steps) || ArrayBuffer.isView(value.steps)
    ? value.steps
    : [];
  const fallbackSteps = Array.isArray(base.steps) || ArrayBuffer.isView(base.steps)
    ? base.steps
    : defaults.steps;
  return {
    id: typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : (typeof base.id === "string" && base.id.trim() ? base.id.trim() : defaults.id),
    length: clampInteger(
      value.length,
      ...COLONY_SYRINX_LIMITS.laneLength,
      clampInteger(base.length, ...COLONY_SYRINX_LIMITS.laneLength, defaults.length),
    ),
    rate: clamp(
      value.rate,
      ...COLONY_SYRINX_LIMITS.laneRate,
      clamp(base.rate, ...COLONY_SYRINX_LIMITS.laneRate, defaults.rate),
    ),
    muted: value.muted == null ? Boolean(base.muted ?? defaults.muted) : Boolean(value.muted),
    steps: Array.from({ length: COLONY_SYRINX_SEQUENCE_LENGTH }, (_, index) => clamp(
      sourceSteps[index],
      0,
      1,
      clamp(fallbackSteps[index], 0, 1, defaults.steps[index]),
    )),
  };
};

const routeValueAt = (routes, phonatorIndex, mouthIndex) => {
  if (!Array.isArray(routes)) return undefined;
  const row = routes[phonatorIndex];
  if (Array.isArray(row)) return row[mouthIndex];
  return routes[phonatorIndex * COLONY_SYRINX_MOUTH_COUNT + mouthIndex];
};

const routeAperture = (value, fallback, defaults) => {
  const unpack = (candidate) => {
    if (typeof candidate === "boolean") return candidate ? 1 : 0;
    if (candidate && typeof candidate === "object") {
      if (candidate.enabled === false || candidate.open === false) return 0;
      return candidate.aperture ?? candidate.value ?? candidate.gate;
    }
    return candidate;
  };
  return clamp(unpack(value), 0, 1, clamp(unpack(fallback), 0, 1, defaults));
};

const maskFromRouteList = (routes, fallback) => {
  if (!Array.isArray(routes)) return fallback;
  let mask = 0;
  for (let index = 0; index < Math.min(routes.length, COLONY_SYRINX_ROUTE_COUNT); index += 1) {
    if (clamp(routes[index], 0, 1, 0) > 0) mask |= 1 << index;
  }
  return mask;
};

const sanitizeSequenceStep = (source, fallback, defaults) => {
  const value = typeof source === "number" ? { routeMask: source } : (source ?? {});
  const base = typeof fallback === "number" ? { routeMask: fallback } : (fallback ?? {});
  const routeMaskFallback = clampInteger(
    base.routeMask,
    0,
    (1 << COLONY_SYRINX_ROUTE_COUNT) - 1,
    defaults.routeMask,
  );
  const routeMask = value.routeMask == null
    ? maskFromRouteList(value.routes, routeMaskFallback)
    : clampInteger(value.routeMask, 0, (1 << COLONY_SYRINX_ROUTE_COUNT) - 1, routeMaskFallback);
  const sourceGates = Array.isArray(value.mouthGates) ? value.mouthGates : [];
  const fallbackGates = Array.isArray(base.mouthGates) ? base.mouthGates : defaults.mouthGates;
  return {
    routeMask,
    mouthGates: Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (_, index) => clamp(
      sourceGates[index],
      0,
      1,
      clamp(fallbackGates[index], 0, 1, defaults.mouthGates[index]),
    )),
    accent: clamp(value.accent, 0, 1.5, clamp(base.accent, 0, 1.5, defaults.accent)),
  };
};

export function sanitizeColonySyrinxState(source = {}, fallback = DEFAULT_COLONY_SYRINX_STATE) {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_COLONY_SYRINX_STATE;
  const mediumFallback = Object.hasOwn(COLONY_SYRINX_MEDIA, base.mediumId)
    ? base.mediumId
    : DEFAULT_COLONY_SYRINX_STATE.mediumId;
  const mediumId = Object.hasOwn(COLONY_SYRINX_MEDIA, value.mediumId)
    ? value.mediumId
    : mediumFallback;
  const midiModeFallback = ["add", "replace"].includes(base.midiMode)
    ? base.midiMode
    : DEFAULT_COLONY_SYRINX_STATE.midiMode;
  const midiMode = ["add", "replace"].includes(value.midiMode)
    ? value.midiMode
    : midiModeFallback;
  const result = {
    seed: normalizedSeed(value.seed, normalizedSeed(base.seed)),
    mediumId,
    breath: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "breath", ...COLONY_SYRINX_LIMITS.breath),
    breathRateBpm: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "breathRateBpm", ...COLONY_SYRINX_LIMITS.breathRateBpm),
    contourDurationSeconds: boundedFrom(
      value,
      base,
      DEFAULT_COLONY_SYRINX_STATE,
      "contourDurationSeconds",
      ...COLONY_SYRINX_LIMITS.contourDurationSeconds,
    ),
    pressureGain: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "pressureGain", ...COLONY_SYRINX_LIMITS.pressureGain),
    crossCoupling: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "crossCoupling", ...COLONY_SYRINX_LIMITS.crossCoupling),
    colonyAmount: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "colonyAmount", ...COLONY_SYRINX_LIMITS.colonyAmount),
    gateHysteresis: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "gateHysteresis", ...COLONY_SYRINX_LIMITS.gateHysteresis),
    leak: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "leak", ...COLONY_SYRINX_LIMITS.leak),
    valveSlewMs: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "valveSlewMs", ...COLONY_SYRINX_LIMITS.valveSlewMs),
    tempoBpm: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "tempoBpm", ...COLONY_SYRINX_LIMITS.tempoBpm),
    stepsPerBeat: clampInteger(
      value.stepsPerBeat,
      ...COLONY_SYRINX_LIMITS.stepsPerBeat,
      clampInteger(base.stepsPerBeat, ...COLONY_SYRINX_LIMITS.stepsPerBeat, DEFAULT_COLONY_SYRINX_STATE.stepsPerBeat),
    ),
    swing: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "swing", ...COLONY_SYRINX_LIMITS.swing),
    sequencerEnabled: value.sequencerEnabled == null
      ? Boolean(base.sequencerEnabled ?? DEFAULT_COLONY_SYRINX_STATE.sequencerEnabled)
      : Boolean(value.sequencerEnabled),
    midiBaseNote: clampInteger(
      value.midiBaseNote,
      ...COLONY_SYRINX_LIMITS.midiBaseNote,
      clampInteger(base.midiBaseNote, ...COLONY_SYRINX_LIMITS.midiBaseNote, DEFAULT_COLONY_SYRINX_STATE.midiBaseNote),
    ),
    midiMode,
    level: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "level", ...COLONY_SYRINX_LIMITS.level),
  };

  result.lungEnabled = sanitizeBooleanVector(
    value.lungEnabled,
    base.lungEnabled,
    DEFAULT_COLONY_SYRINX_STATE.lungEnabled,
    COLONY_SYRINX_LUNG_COUNT,
  );
  result.phonatorEnabled = sanitizeBooleanVector(
    value.phonatorEnabled,
    base.phonatorEnabled,
    DEFAULT_COLONY_SYRINX_STATE.phonatorEnabled,
    COLONY_SYRINX_PHONATOR_COUNT,
  );
  result.foldEnabled = sanitizeBooleanVector(
    value.foldEnabled,
    base.foldEnabled,
    DEFAULT_COLONY_SYRINX_STATE.foldEnabled,
    COLONY_SYRINX_FOLD_COUNT,
  );
  result.mouthEnabled = sanitizeBooleanVector(
    value.mouthEnabled,
    base.mouthEnabled,
    DEFAULT_COLONY_SYRINX_STATE.mouthEnabled,
    COLONY_SYRINX_MOUTH_COUNT,
  );

  result.banks = Array.from({ length: COLONY_SYRINX_BANK_COUNT }, (_, index) => sanitizeBank(
    Array.isArray(value.banks) ? value.banks[index] : undefined,
    Array.isArray(base.banks) ? base.banks[index] : undefined,
    DEFAULT_BANKS[index],
  ));
  result.phonators = Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, (_, index) => sanitizePhonator(
    Array.isArray(value.phonators) ? value.phonators[index] : undefined,
    Array.isArray(base.phonators) ? base.phonators[index] : undefined,
    DEFAULT_PHONATORS[index],
  ));
  result.routes = Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, (_, phonatorIndex) => (
    Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (__, mouthIndex) => routeAperture(
      routeValueAt(value.routes, phonatorIndex, mouthIndex),
      routeValueAt(base.routes, phonatorIndex, mouthIndex),
      DEFAULT_ROUTES[phonatorIndex][mouthIndex],
    ))
  ));
  result.alternateRoutes = Array.from(
    { length: COLONY_SYRINX_PHONATOR_COUNT },
    (_, phonatorIndex) => Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      (__, mouthIndex) => routeAperture(
        routeValueAt(
          value.alternateRoutes,
          phonatorIndex,
          mouthIndex,
        ),
        routeValueAt(base.alternateRoutes, phonatorIndex, mouthIndex),
        DEFAULT_ALTERNATE_ROUTES[phonatorIndex][mouthIndex],
      ),
    ),
  );
  result.mouths = Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (_, index) => sanitizeMouth(
    Array.isArray(value.mouths) ? value.mouths[index] : undefined,
    Array.isArray(base.mouths) ? base.mouths[index] : undefined,
    COLONY_SYRINX_MOUTH_ARCHETYPES[index],
  ));
  const sourceContours = value.contours ?? value.contourLanes;
  const fallbackContours = base.contours ?? base.contourLanes;
  result.contours = COLONY_SYRINX_CONTOUR_IDS.map((id, index) => sanitizeContour(
    contourSourceAt(sourceContours, id, index),
    contourSourceAt(fallbackContours, id, index),
    DEFAULT_COLONY_SYRINX_CONTOURS[index],
  ));
  result.lanes = Array.from({ length: COLONY_SYRINX_LEGACY_LANE_COUNT }, (_, index) => sanitizeLane(
    Array.isArray(value.lanes) ? value.lanes[index] : undefined,
    Array.isArray(base.lanes) ? base.lanes[index] : undefined,
    DEFAULT_COLONY_SYRINX_LANES[index],
  ));
  result.sequence = Array.from({ length: COLONY_SYRINX_SEQUENCE_LENGTH }, (_, index) => (
    sanitizeSequenceStep(
      Array.isArray(value.sequence) ? value.sequence[index] : undefined,
      Array.isArray(base.sequence) ? base.sequence[index] : undefined,
      DEFAULT_COLONY_SYRINX_SEQUENCE[index],
    )
  ));
  return result;
}

export function createColonySyrinxState(overrides = {}) {
  return sanitizeColonySyrinxState(overrides, DEFAULT_COLONY_SYRINX_STATE);
}

/**
 * Sample an evenly spaced cyclic contour. Points describe a ring rather than
 * a finite envelope, so the final segment always interpolates back to point 0.
 */
export function sampleColonySyrinxContour(contourLane, normalizedPhase = 0) {
  const points = Array.isArray(contourLane?.points) || ArrayBuffer.isView(contourLane?.points)
    ? contourLane.points
    : [];
  const length = points.length;
  if (length === 0) return 0.5;
  if (length === 1) return clamp(points[0]);
  const phase = ((finiteOr(normalizedPhase, 0) % 1) + 1) % 1;
  const position = phase * length;
  const index = Math.floor(position) % length;
  const amount = position - Math.floor(position);
  const left = clamp(points[index]);
  const right = clamp(points[(index + 1) % length]);
  if (contourLane?.shape === "linear") return mix(left, right, amount);
  if (contourLane?.shape === "spline") {
    const before = clamp(points[(index - 1 + length) % length]);
    const after = clamp(points[(index + 2) % length]);
    const amountSquared = amount * amount;
    const amountCubed = amountSquared * amount;
    return clamp(0.5 * (
      2 * left
      + (-before + right) * amount
      + (2 * before - 5 * left + 4 * right - after) * amountSquared
      + (-before + 3 * left - 3 * right + after) * amountCubed
    ));
  }
  return mix(left, right, smoothstep(0, 1, amount));
}

const sanitizeVector = (source, fallback, length, minimum, maximum) => {
  const values = Array.isArray(source) || ArrayBuffer.isView(source) ? source : [];
  const base = Array.isArray(fallback) || ArrayBuffer.isView(fallback) ? fallback : [];
  return Array.from({ length }, (_, index) => clamp(
    values[index],
    minimum,
    maximum,
    clamp(base[index], minimum, maximum, 0),
  ));
};

export function sanitizeColonySyrinxRuntime(source = {}, fallback = DEFAULT_COLONY_SYRINX_RUNTIME) {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_COLONY_SYRINX_RUNTIME;
  return {
    timeSeconds: clamp(value.timeSeconds, 0, 1e9, clamp(base.timeSeconds, 0, 1e9, 0)),
    contourPhase: clamp(value.contourPhase, 0, 1, clamp(base.contourPhase, 0, 1, 0)),
    continuousBreath: clamp(
      value.continuousBreath,
      0,
      1,
      clamp(base.continuousBreath, 0, 1, 0),
    ),
    tensionOffset: clamp(
      value.tensionOffset,
      -1,
      1,
      clamp(base.tensionOffset, -1, 1, 0),
    ),
    stepIndex: wrap(value.stepIndex ?? base.stepIndex, COLONY_SYRINX_SEQUENCE_LENGTH),
    stepElapsedSeconds: clamp(value.stepElapsedSeconds, 0, 60, clamp(base.stepElapsedSeconds, 0, 60, 0)),
    laneStepIndices: sanitizeVector(
      value.laneStepIndices,
      base.laneStepIndices,
      COLONY_SYRINX_LEGACY_LANE_COUNT,
      0,
      COLONY_SYRINX_SEQUENCE_LENGTH - 1,
    ).map((index) => Math.round(index)),
    laneStepElapsedSeconds: sanitizeVector(
      value.laneStepElapsedSeconds,
      base.laneStepElapsedSeconds,
      COLONY_SYRINX_LEGACY_LANE_COUNT,
      0,
      60,
    ),
    laneVelocities: sanitizeVector(
      value.laneVelocities,
      base.laneVelocities,
      COLONY_SYRINX_LANE_COUNT,
      0,
      1,
    ),
    lanePhases: sanitizeVector(
      value.lanePhases,
      base.lanePhases,
      COLONY_SYRINX_LANE_COUNT,
      0,
      1,
    ),
    contourValues: sanitizeVector(
      value.contourValues,
      base.contourValues,
      COLONY_SYRINX_LANE_COUNT,
      0,
      1,
    ),
    lungPressures: sanitizeVector(value.lungPressures, base.lungPressures, COLONY_SYRINX_LUNG_COUNT, 0, COLONY_SYRINX_MAX_PRESSURE),
    reservoirPressures: sanitizeVector(value.reservoirPressures, base.reservoirPressures, COLONY_SYRINX_BANK_COUNT, 0, COLONY_SYRINX_MAX_PRESSURE),
    routeTargets: sanitizeVector(value.routeTargets, base.routeTargets, COLONY_SYRINX_ROUTE_COUNT, 0, 1),
    routeApertures: sanitizeVector(value.routeApertures, base.routeApertures, COLONY_SYRINX_ROUTE_COUNT, 0, 1),
    routeFlows: sanitizeVector(value.routeFlows, base.routeFlows, COLONY_SYRINX_ROUTE_COUNT, 0, 8),
    routeJams: sanitizeVector(value.routeJams, base.routeJams, COLONY_SYRINX_ROUTE_COUNT, 0, 1),
    colonyGates: sanitizeVector(value.colonyGates, base.colonyGates, COLONY_SYRINX_ROUTE_COUNT, 0, 1),
    mouthApertures: sanitizeVector(value.mouthApertures, base.mouthApertures, COLONY_SYRINX_MOUTH_COUNT, 0, 1),
    mouthPressures: sanitizeVector(value.mouthPressures, base.mouthPressures, COLONY_SYRINX_MOUTH_COUNT, 0, COLONY_SYRINX_MAX_PRESSURE),
    mouthFlows: sanitizeVector(value.mouthFlows, base.mouthFlows, COLONY_SYRINX_MOUTH_COUNT, 0, 8),
    phonatorLevels: sanitizeVector(value.phonatorLevels, base.phonatorLevels, COLONY_SYRINX_PHONATOR_COUNT, 0, 1),
    phonatorTensions: sanitizeVector(value.phonatorTensions, base.phonatorTensions, COLONY_SYRINX_PHONATOR_COUNT, 0, 1),
    phonatorFrequenciesHz: sanitizeVector(value.phonatorFrequenciesHz, base.phonatorFrequenciesHz, COLONY_SYRINX_PHONATOR_COUNT, 0, 20_000),
    foldActivities: sanitizeVector(value.foldActivities, base.foldActivities, COLONY_SYRINX_FOLD_COUNT, 0, 1),
    foldFrequenciesHz: sanitizeVector(value.foldFrequenciesHz, base.foldFrequenciesHz, COLONY_SYRINX_FOLD_COUNT, 0, 20_000),
    meanPressure: clamp(value.meanPressure, 0, COLONY_SYRINX_MAX_PRESSURE, clamp(base.meanPressure, 0, COLONY_SYRINX_MAX_PRESSURE, 0)),
    totalFlow: clamp(value.totalFlow, 0, 24, clamp(base.totalFlow, 0, 24, 0)),
    outputLevel: clamp(value.outputLevel, 0, 1, clamp(base.outputLevel, 0, 1, 0)),
    impact: clamp(value.impact, 0, 1, clamp(base.impact, 0, 1, 0)),
    granularActivity: clamp(value.granularActivity, 0, 1, clamp(base.granularActivity, 0, 1, 0)),
  };
}

export function createColonySyrinxRuntime(overrides = {}) {
  return sanitizeColonySyrinxRuntime(overrides, DEFAULT_COLONY_SYRINX_RUNTIME);
}

export function colonySyrinxRouteIndex(phonatorIndex, mouthIndex) {
  const phonator = Math.trunc(Number(phonatorIndex));
  const mouth = Math.trunc(Number(mouthIndex));
  if (!Number.isFinite(phonator) || !Number.isFinite(mouth)
    || phonator < 0 || phonator >= COLONY_SYRINX_PHONATOR_COUNT
    || mouth < 0 || mouth >= COLONY_SYRINX_MOUTH_COUNT) return -1;
  return phonator * COLONY_SYRINX_MOUTH_COUNT + mouth;
}

export function colonySyrinxRouteCoordinates(routeIndex) {
  const index = Math.trunc(Number(routeIndex));
  if (!Number.isFinite(index) || index < 0 || index >= COLONY_SYRINX_ROUTE_COUNT) return null;
  return Object.freeze({
    routeIndex: index,
    phonatorIndex: Math.floor(index / COLONY_SYRINX_MOUTH_COUNT),
    mouthIndex: index % COLONY_SYRINX_MOUTH_COUNT,
  });
}

export function colonySyrinxMidiNoteForRoute(phonatorIndex, mouthIndex, midiBaseNote = 48) {
  const routeIndex = colonySyrinxRouteIndex(phonatorIndex, mouthIndex);
  if (routeIndex < 0) return null;
  return clampInteger(midiBaseNote, 0, 116, 48) + routeIndex;
}

export function colonySyrinxRouteFromMidiNote(note, midiBaseNote = 48) {
  const noteNumber = Math.trunc(Number(note));
  if (!Number.isFinite(noteNumber)) return null;
  const baseNote = clampInteger(midiBaseNote, 0, 116, 48);
  const coordinates = colonySyrinxRouteCoordinates(noteNumber - baseNote);
  return coordinates && Object.freeze({ ...coordinates, note: noteNumber });
}

export function setColonySyrinxRoute(configuration, phonatorIndex, mouthIndex, aperture) {
  const state = sanitizeColonySyrinxState(configuration);
  const routeIndex = colonySyrinxRouteIndex(phonatorIndex, mouthIndex);
  if (routeIndex < 0) return state;
  const coordinates = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
  const routes = state.routes.map((row) => row.slice());
  routes[coordinates.phonatorIndex][coordinates.mouthIndex] = clamp(aperture);
  return { ...state, routes };
}

const normalizeMidiVelocity = (velocity) => {
  const value = finiteOr(velocity, 1);
  return clamp(value > 1 ? value / 127 : value);
};

const midiRouteVelocities = (entries, baseNote) => {
  const velocities = zeroes(COLONY_SYRINX_ROUTE_COUNT);
  if (!Array.isArray(entries) && !(entries instanceof Set)) return velocities;
  for (const entry of entries) {
    const note = typeof entry === "number" ? entry : (entry?.note ?? entry?.noteNumber);
    const route = colonySyrinxRouteFromMidiNote(note, baseNote);
    if (!route) continue;
    const velocity = typeof entry === "number" ? 1 : normalizeMidiVelocity(entry.velocity ?? entry.value ?? 1);
    velocities[route.routeIndex] = Math.max(velocities[route.routeIndex], velocity);
  }
  return velocities;
};

const gateValueAt = (gates, routeIndex) => {
  if (!Array.isArray(gates) && !ArrayBuffer.isView(gates)) return undefined;
  if (Array.isArray(gates[Math.floor(routeIndex / COLONY_SYRINX_MOUTH_COUNT)])) {
    return gates[Math.floor(routeIndex / COLONY_SYRINX_MOUTH_COUNT)][routeIndex % COLONY_SYRINX_MOUTH_COUNT];
  }
  return gates[routeIndex];
};

const evaluateSanitizedContours = (state, timeSeconds = 0, options = {}) => {
  const duration = Math.max(
    COLONY_SYRINX_LIMITS.contourDurationSeconds[0],
    state.contourDurationSeconds,
  );
  const absoluteCycles = Number.isFinite(Number(options.phase))
    ? Number(options.phase)
    : Math.max(0, finiteOr(timeSeconds, 0)) / duration;
  const contourPhase = ((absoluteCycles % 1) + 1) % 1;
  const lanePhases = state.contours.map((lane, index) => (
    ((absoluteCycles * lane.rate + CONTOUR_PHASE_OFFSETS[index]) % 1 + 1) % 1
  ));
  const sampled = state.contours.map((lane, index) => (
    sampleColonySyrinxContour(lane, lanePhases[index])
  ));
  const laneVelocities = sampled.map((sample, index) => {
    const lane = state.contours[index];
    if (lane.muted) return index === 2 ? 0 : 0.5;
    const neutral = index === 2 ? 0 : 0.5;
    return clamp(mix(neutral, sample, lane.depth));
  });
  const values = Object.freeze(Object.fromEntries(
    COLONY_SYRINX_CONTOUR_IDS.map((id, index) => [id, laneVelocities[index]]),
  ));

  const breathMultiplier = 0.45 + values.breath * 1.1;
  const breathFloor = state.breath > 0
    ? Math.min(state.breath, COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR)
    : 0;
  const continuousBreath = state.breath > 0
    ? clamp(Math.max(breathFloor, state.breath * breathMultiplier))
    : 0;
  const tensionOffset = (values.tension - 0.5) * 0.56;
  const routingMorph = values.routing;
  const midiEntries = options.activeMidiNotes ?? options.midiNotes;
  const midiSupplied = Array.isArray(midiEntries) || midiEntries instanceof Set;
  const midiMode = ["add", "replace"].includes(options.midiMode)
    ? options.midiMode
    : state.midiMode;
  const midiVelocities = midiRouteVelocities(midiEntries, state.midiBaseNote);
  const routes = Array.from(
    { length: COLONY_SYRINX_PHONATOR_COUNT },
    (_, phonatorIndex) => Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      (__, mouthIndex) => {
        if (!state.phonatorEnabled[phonatorIndex] || !state.mouthEnabled[mouthIndex]) return 0;
        const routeIndex = colonySyrinxRouteIndex(phonatorIndex, mouthIndex);
        let aperture = mix(
          state.routes[phonatorIndex][mouthIndex],
          state.alternateRoutes[phonatorIndex][mouthIndex],
          routingMorph,
        );
        if (midiSupplied) {
          const velocity = midiVelocities[routeIndex];
          aperture = midiMode === "replace"
            ? aperture * velocity
            : velocity > 0 ? mix(aperture, 1, velocity) : aperture;
        }
        const externalGate = gateValueAt(options.routeGates, routeIndex);
        if (externalGate != null) aperture *= clamp(externalGate);
        return clamp(aperture);
      },
    ),
  );
  const suppliedMouthGates = Array.isArray(options.mouthGates)
    || ArrayBuffer.isView(options.mouthGates)
    ? options.mouthGates
    : null;
  const mouthOpenings = Array.from(
    { length: COLONY_SYRINX_MOUTH_COUNT },
    (_, mouthIndex) => {
      if (!state.mouthEnabled[mouthIndex]) return 0;
      const mouthValue = laneVelocities[mouthIndex + 3];
      // This is an articulator, not a tremolo gain. Its low region must be
      // able to seal one mouth so stored pressure can reroute, while its upper
      // region can stretch beyond the mouth's configured resting aperture.
      const multiplier = smoothstep(0.18, 0.72, mouthValue) * 1.35;
      const externalGate = suppliedMouthGates
        ? clamp(suppliedMouthGates[mouthIndex], 0, 1, 1)
        : 1;
      return clamp(state.mouths[mouthIndex].opening * multiplier * externalGate);
    },
  );
  // Independent cyclic mouths can briefly converge on closure. Lift the
  // active outlets together only during that overlap so the network retains
  // one pressure-bearing exit; an individual mouth can still reach zero while
  // another carries the breath. The max-based correction is value-continuous.
  const maximumMouthOpening = Math.max(...mouthOpenings);
  const outletShortfall = Math.max(0, 0.035 - maximumMouthOpening);
  let rescueMouthIndex = -1;
  let rescueCapacity = -1;
  for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
    const externalGate = suppliedMouthGates
      ? clamp(suppliedMouthGates[mouthIndex])
      : 1;
    const capacity = state.mouths[mouthIndex].opening * externalGate;
    if (state.mouthEnabled[mouthIndex] && capacity > rescueCapacity && capacity > 0) {
      rescueMouthIndex = mouthIndex;
      rescueCapacity = capacity;
    }
  }
  if (rescueMouthIndex >= 0 && outletShortfall > 0) {
    mouthOpenings[rescueMouthIndex] = clamp(
      mouthOpenings[rescueMouthIndex] + outletShortfall,
    );
  }

  return Object.freeze({
    timeSeconds: Math.max(0, finiteOr(timeSeconds, 0)),
    phase: contourPhase,
    contourPhase,
    lanePhases: Object.freeze(lanePhases),
    laneVelocities: Object.freeze(laneVelocities),
    contourValues: Object.freeze(laneVelocities.slice()),
    values,
    breath: continuousBreath,
    continuousBreath,
    tensionOffset,
    routingMorph,
    routes: Object.freeze(routes.map((row) => Object.freeze(row))),
    mouthOpenings: Object.freeze(mouthOpenings),
  });
};

/** Resolve all six cyclic contours into one continuously moving body state. */
export function evaluateColonySyrinxContours(configuration, timeSeconds = 0, options = {}) {
  return evaluateSanitizedContours(sanitizeColonySyrinxState(configuration), timeSeconds, options);
}

export const evaluateColonySyrinxContinuousState = evaluateColonySyrinxContours;

const seededRandom = (seedValue) => {
  let state = normalizedSeed(seedValue) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

const shuffleWith = (values, random) => {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

const enabledSubset = (length, count, random) => {
  const chosen = new Set(shuffleWith(
    Array.from({ length }, (_, index) => index),
    random,
  ).slice(0, count));
  return Array.from({ length }, (_, index) => chosen.has(index));
};

const randomRange = (random, minimum, maximum) => minimum + random() * (maximum - minimum);

const randomContourPoints = (random, minimum, maximum, smoothingPasses = 1) => {
  let points = Array.from(
    { length: COLONY_SYRINX_CONTOUR_POINT_COUNT },
    () => randomRange(random, minimum, maximum),
  );
  for (let pass = 0; pass < smoothingPasses; pass += 1) {
    points = points.map((value, index) => (
      points[(index - 1 + points.length) % points.length] * 0.22
      + value * 0.56
      + points[(index + 1) % points.length] * 0.22
    ));
  }
  return points.map((value) => clamp(value));
};

const repairRouteMatrix = (matrix, phonatorEnabled, mouthEnabled, random) => {
  const activePhonators = phonatorEnabled
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
  const activeMouths = mouthEnabled
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
  const repaired = Array.from(
    { length: COLONY_SYRINX_PHONATOR_COUNT },
    (_, phonatorIndex) => Array.from(
      { length: COLONY_SYRINX_MOUTH_COUNT },
      (__, mouthIndex) => phonatorEnabled[phonatorIndex] && mouthEnabled[mouthIndex]
        ? clamp(matrix?.[phonatorIndex]?.[mouthIndex])
        : 0,
    ),
  );
  for (const phonatorIndex of activePhonators) {
    if (activeMouths.some((mouthIndex) => repaired[phonatorIndex][mouthIndex] > 0.04)) continue;
    const mouthIndex = activeMouths[Math.floor(random() * activeMouths.length)];
    repaired[phonatorIndex][mouthIndex] = randomRange(random, 0.32, 1);
  }
  for (const mouthIndex of activeMouths) {
    if (activePhonators.some((phonatorIndex) => repaired[phonatorIndex][mouthIndex] > 0.04)) continue;
    const phonatorIndex = activePhonators[Math.floor(random() * activePhonators.length)];
    repaired[phonatorIndex][mouthIndex] = randomRange(random, 0.32, 1);
  }
  return repaired;
};

const randomizedRouteMatrix = (phonatorEnabled, mouthEnabled, random) => (
  Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, (_, phonatorIndex) => (
    Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (__, mouthIndex) => {
      if (!phonatorEnabled[phonatorIndex] || !mouthEnabled[mouthIndex]) return 0;
      return random() < 0.44 ? 0 : randomRange(random, 0.16, 1);
    })
  ))
);

/**
 * Deterministically mutate anatomy, plumbing, motion, or the complete configuration.
 * The fixed arrays remain DSP maxima; enabled vectors define the active subset.
 */
export function randomizeColonySyrinxState(configuration, options = {}) {
  const base = sanitizeColonySyrinxState(configuration);
  const scope = ["anatomy", "plumbing", "motion", "all"].includes(options.scope)
    ? options.scope
    : "all";
  const seed = normalizedSeed(
    options.seed,
    (base.seed + 0x9e3779b9) >>> 0,
  );
  const random = seededRandom(seed);
  const next = {
    ...base,
    seed,
    lungEnabled: base.lungEnabled.slice(),
    phonatorEnabled: base.phonatorEnabled.slice(),
    foldEnabled: base.foldEnabled.slice(),
    mouthEnabled: base.mouthEnabled.slice(),
    banks: base.banks.map((bank) => ({ ...bank })),
    phonators: base.phonators.map((phonator) => ({ ...phonator })),
    routes: base.routes.map((row) => row.slice()),
    alternateRoutes: base.alternateRoutes.map((row) => row.slice()),
    mouths: base.mouths.map((mouth) => ({ ...mouth })),
    contours: base.contours.map((lane) => ({ ...lane, points: lane.points.slice() })),
    lanes: base.lanes.map((lane) => ({ ...lane, steps: lane.steps.slice() })),
    sequence: base.sequence.map((step) => ({ ...step, mouthGates: step.mouthGates.slice() })),
  };

  if (scope === "anatomy" || scope === "all") {
    const lungCount = 1 + Math.floor(random() * COLONY_SYRINX_LUNG_COUNT);
    const phonatorCount = 1 + Math.floor(random() * COLONY_SYRINX_PHONATOR_COUNT);
    const mouthCount = 1 + Math.floor(random() * COLONY_SYRINX_MOUTH_COUNT);
    next.lungEnabled = enabledSubset(COLONY_SYRINX_LUNG_COUNT, lungCount, random);
    next.phonatorEnabled = enabledSubset(
      COLONY_SYRINX_PHONATOR_COUNT,
      phonatorCount,
      random,
    );
    const eligibleFolds = next.phonatorEnabled.flatMap((enabled, phonatorIndex) => (
      enabled ? [phonatorIndex * 2, phonatorIndex * 2 + 1] : []
    ));
    const foldCount = Math.floor(random() * (eligibleFolds.length + 1));
    const selectedFolds = new Set(shuffleWith(eligibleFolds, random).slice(0, foldCount));
    next.foldEnabled = Array.from(
      { length: COLONY_SYRINX_FOLD_COUNT },
      (_, index) => selectedFolds.has(index),
    );
    next.mouthEnabled = enabledSubset(COLONY_SYRINX_MOUTH_COUNT, mouthCount, random);
    next.banks = next.banks.map(() => ({
      drive: randomRange(random, 0.48, 1.34),
      compliance: randomRange(random, 0.42, 2.2),
      leak: randomRange(random, 0.008, 0.16),
    }));
    next.phonators = next.phonators.map((phonator) => ({
      ...phonator,
      frequencyHz: 28 * 2 ** (random() * 6.9),
      tension: randomRange(random, 0.12, 0.9),
      closure: randomRange(random, 0.18, 0.94),
      asymmetry: randomRange(random, -0.82, 0.82),
      roughness: randomRange(random, 0.04, 0.94),
    }));
    next.mouths = next.mouths.map((mouth, index) => ({
      ...mouth,
      opening: randomRange(random, 0.18, 0.94),
      tongueSize: randomRange(random, 0.06, 0.98),
      tonguePosition: randomRange(random, 0.02, 0.98),
      lipSize: randomRange(random, 0.05, 1),
      lipTension: randomRange(random, 0.04, 0.98),
      cavity: randomRange(random, 0.04, 1),
      resonanceHz: 48 * 2 ** (random() * (index === 2 ? 7.4 : 5.8)),
      pan: randomRange(random, -1, 1),
      leak: randomRange(random, 0.002, 0.12),
      slewMs: randomRange(random, 8, 240),
    }));
  }

  if (scope === "plumbing" || scope === "all") {
    next.routes = randomizedRouteMatrix(next.phonatorEnabled, next.mouthEnabled, random);
    next.alternateRoutes = randomizedRouteMatrix(
      next.phonatorEnabled,
      next.mouthEnabled,
      random,
    );
    next.crossCoupling = randomRange(random, 0.04, 0.92);
    next.colonyAmount = randomRange(random, 0, 0.82);
    next.gateHysteresis = randomRange(random, 0.08, 0.9);
    next.leak = randomRange(random, 0.008, 0.24);
    next.valveSlewMs = randomRange(random, 8, 260);
  }

  if (scope === "motion" || scope === "all") {
    const ranges = {
      breath: [0.34, 0.94, 2],
      tension: [0.08, 0.92, 2],
      routing: [0.02, 0.98, 1],
      maw: [0.04, 0.98, 2],
      speech: [0.03, 0.99, 1],
      click: [0.02, 1, 0],
    };
    next.breath = randomRange(random, 0.38, 1);
    next.breathRateBpm = randomRange(random, 4, 72);
    next.contourDurationSeconds = 2 ** randomRange(random, 1.2, 5.7);
    next.contours = COLONY_SYRINX_CONTOUR_IDS.map((id) => {
      const [minimum, maximum, passes] = ranges[id];
      return {
        id,
        points: randomContourPoints(random, minimum, maximum, passes),
        shape: COLONY_SYRINX_CONTOUR_SHAPES[
          Math.floor(random() * COLONY_SYRINX_CONTOUR_SHAPES.length)
        ],
        rate: 2 ** randomRange(random, -2.2, 2.4),
        depth: randomRange(random, 0.36, 1),
        muted: id === "breath" ? false : random() < 0.1,
      };
    });
  }

  if (scope === "all") {
    const media = Object.keys(COLONY_SYRINX_MEDIA);
    next.mediumId = media[Math.floor(random() * media.length)];
    next.pressureGain = randomRange(random, 0.58, 2.2);
    next.level = randomRange(random, 0.28, 0.82);
  }

  if (!next.phonatorEnabled.some(Boolean)) {
    next.phonatorEnabled[Math.floor(random() * COLONY_SYRINX_PHONATOR_COUNT)] = true;
  }
  if (!next.lungEnabled.some(Boolean)) {
    next.lungEnabled[Math.floor(random() * COLONY_SYRINX_LUNG_COUNT)] = true;
  }
  if (!next.mouthEnabled.some(Boolean)) {
    next.mouthEnabled[Math.floor(random() * COLONY_SYRINX_MOUTH_COUNT)] = true;
  }
  next.foldEnabled = next.foldEnabled.map((enabled, foldIndex) => (
    enabled && next.phonatorEnabled[Math.floor(foldIndex / 2)]
  ));
  const pressurePathPhonator = next.phonatorEnabled.findIndex((enabled, phonatorIndex) => (
    enabled
      && next.lungEnabled
        .slice(
          phonatorIndex * COLONY_SYRINX_LUNGS_PER_BANK,
          (phonatorIndex + 1) * COLONY_SYRINX_LUNGS_PER_BANK,
        )
        .some(Boolean)
  ));
  if (pressurePathPhonator < 0) {
    const activePhonators = next.phonatorEnabled
      .map((enabled, index) => enabled ? index : -1)
      .filter((index) => index >= 0);
    const targetPhonator = activePhonators[Math.floor(random() * activePhonators.length)];
    const targetLung = targetPhonator * COLONY_SYRINX_LUNGS_PER_BANK
      + Math.floor(random() * COLONY_SYRINX_LUNGS_PER_BANK);
    if (!next.lungEnabled[targetLung]) {
      const sourceLung = next.lungEnabled.findIndex(Boolean);
      next.lungEnabled[sourceLung] = false;
      next.lungEnabled[targetLung] = true;
    }
  }
  if (scope === "anatomy" || scope === "plumbing" || scope === "all") {
    next.routes = repairRouteMatrix(
      next.routes,
      next.phonatorEnabled,
      next.mouthEnabled,
      random,
    );
    next.alternateRoutes = repairRouteMatrix(
      next.alternateRoutes,
      next.phonatorEnabled,
      next.mouthEnabled,
      random,
    );
  }
  next.breath = Math.max(COLONY_SYRINX_CONTINUOUS_BREATH_FLOOR, next.breath);
  return sanitizeColonySyrinxState(next, base);
}

const CALL_RECIPE_ROWS = [
  ["air-collision-bass-fall", "Air / collision source / bass outlet / falling pressure", "air", 1.2, 2, [0], 1, [0], 1, "fall"],
  ["air-split-speech-rise", "Air / split syrinx / speech outlet / rising aperture", "air", 1.8, 3, [1], 2, [1], 1, "rise"],
  ["air-pulse-click-opening", "Air / pulse membrane / click outlet / narrow opening", "air", 2.5, 1, [2], 1, [2], 1, "opening"],
  ["air-needle-click-bend", "Air / needle syrinx / click outlet / tension bend", "air", 3.3, 4, [3], 2, [2], 1, "bend"],
  ["air-crossed-bass-speech", "Air / crossed sources / bass-speech transfer", "air", 4.1, 5, [0, 1], 3, [0, 1], 4, "exchange"],
  ["air-three-source-mouth-exchange", "Air / three sources / mouth exchange", "air", 5.2, 6, [0, 1, 2], 4, [0, 1, 2], 7, "offset"],
  ["air-four-source-bass-descent", "Air / four sources / bass outlet / coupled descent", "air", 6.8, 9, [0, 1, 2, 3], 5, [0], 4, "descent"],
  ["air-full-dense-morph", "Air / maximum organ counts / dense route morph", "air", 9.5, 16, [0, 1, 2, 3], 8, [0, 1, 2], 12, "dense"],
  ["water-collision-bass-release", "Water / collision source / bass outlet / pressure release", "water", 1.4, 1, [0], 1, [0], 1, "fall"],
  ["water-split-speech-sweep", "Water / split syrinx / speech outlet / cavity sweep", "water", 2.1, 4, [1], 2, [1], 1, "rise"],
  ["water-pulse-dual-opening", "Water / pulse membrane / bass-click outlets / fast opening", "water", 2.9, 2, [2], 1, [0, 2], 2, "opening"],
  ["water-needle-click-jet", "Water / needle syrinx / click outlet / narrow jet", "water", 3.7, 3, [3], 2, [2], 1, "bend"],
  ["water-crossed-speech-routes", "Water / crossed sources / speech outlet / route exchange", "water", 4.6, 5, [0, 1], 3, [1], 2, "exchange"],
  ["water-three-source-reflection", "Water / three sources / bass-speech outlets / reflected load", "water", 5.8, 9, [0, 1, 2], 5, [0, 1], 5, "offset"],
  ["water-four-source-closure", "Water / four sources / three outlets / slow closure", "water", 7.4, 12, [0, 1, 2, 3], 6, [0, 1, 2], 9, "descent"],
  ["water-full-dense-morph", "Water / maximum organ counts / dense route morph", "water", 9.8, 16, [0, 1, 2, 3], 8, [0, 1, 2], 12, "dense"],
  ["pellets-collision-bass-release", "Pellets / collision source / bass outlet / granular release", "pellets", 1.1, 1, [0], 1, [0], 1, "fall"],
  ["pellets-split-click-aperture", "Pellets / split syrinx / click outlet / intermittent aperture", "pellets", 1.7, 2, [1], 2, [2], 1, "rise"],
  ["pellets-pulse-speech-sweep", "Pellets / pulse membrane / speech outlet / vowel sweep", "pellets", 2.4, 3, [2], 1, [1], 1, "opening"],
  ["pellets-needle-click-release", "Pellets / needle syrinx / click outlet / jam release", "pellets", 3.2, 2, [3], 2, [2], 1, "bend"],
  ["pellets-crossed-obstruction", "Pellets / crossed sources / bass-click outlets / route obstruction", "pellets", 4, 5, [0, 1], 3, [0, 2], 4, "exchange"],
  ["pellets-three-source-transfer", "Pellets / three sources / three outlets / migrating obstruction", "pellets", 5, 7, [0, 1, 2], 4, [0, 1, 2], 7, "offset"],
  ["pellets-four-source-pressure", "Pellets / four sources / speech-click outlets / pressure variation", "pellets", 6.5, 10, [0, 1, 2, 3], 7, [1, 2], 6, "descent"],
  ["pellets-full-dense-morph", "Pellets / maximum organ counts / dense route morph", "pellets", 8.8, 16, [0, 1, 2, 3], 8, [0, 1, 2], 12, "dense"],
];

export const COLONY_SYRINX_CALLS = deepFreeze(CALL_RECIPE_ROWS.map(([
  id,
  label,
  mediumId,
  durationSeconds,
  lungCount,
  phonatorIndices,
  foldCount,
  mouthIndices,
  routeCount,
  motionProfile,
]) => ({
  schemaVersion: 1,
  id,
  label,
  mediumId,
  durationSeconds,
  counts: {
    lungs: lungCount,
    phonators: phonatorIndices.length,
    folds: foldCount,
    mouths: mouthIndices.length,
    routes: routeCount,
  },
  phonatorIndices,
  mouthIndices,
  motionProfile,
  seed: normalizedSeed(id),
})));

export const COLONY_SYRINX_CALL_COUNT = COLONY_SYRINX_CALLS.length;

const maskFromIndices = (length, indices) => {
  const selected = new Set(indices);
  return Array.from({ length }, (_, index) => selected.has(index));
};

const callLungMask = (phonatorIndices, count, random) => {
  const eligible = phonatorIndices.flatMap((phonatorIndex) => Array.from(
    { length: COLONY_SYRINX_LUNGS_PER_BANK },
    (_, offset) => phonatorIndex * COLONY_SYRINX_LUNGS_PER_BANK + offset,
  ));
  const selected = new Set();
  for (const phonatorIndex of phonatorIndices) {
    selected.add(phonatorIndex * COLONY_SYRINX_LUNGS_PER_BANK + Math.floor(
      random() * COLONY_SYRINX_LUNGS_PER_BANK,
    ));
  }
  for (const index of shuffleWith(eligible, random)) {
    if (selected.size >= count) break;
    selected.add(index);
  }
  return maskFromIndices(COLONY_SYRINX_LUNG_COUNT, selected);
};

const callFoldMask = (phonatorIndices, count, random) => {
  const activePhonators = [...new Set(phonatorIndices)].filter((phonatorIndex) => (
    Number.isInteger(phonatorIndex)
      && phonatorIndex >= 0
      && phonatorIndex < COLONY_SYRINX_PHONATOR_COUNT
  ));
  const eligible = activePhonators.flatMap((phonatorIndex) => [
    phonatorIndex * 2,
    phonatorIndex * 2 + 1,
  ]);
  const targetCount = clampInteger(count, 0, eligible.length, 0);
  const selected = new Set();
  if (targetCount >= activePhonators.length) {
    for (const phonatorIndex of activePhonators) {
      selected.add(phonatorIndex * 2 + Math.floor(random() * 2));
    }
  }
  for (const foldIndex of shuffleWith(eligible, random)) {
    if (selected.size >= targetCount) break;
    selected.add(foldIndex);
  }
  return maskFromIndices(COLONY_SYRINX_FOLD_COUNT, selected);
};

const callRouteMatrices = (recipe, random) => {
  const eligible = shuffleWith(recipe.phonatorIndices.flatMap((phonatorIndex) => (
    recipe.mouthIndices.map((mouthIndex) => ({ phonatorIndex, mouthIndex }))
  )), random);
  const selected = [];
  const routeKey = ({ phonatorIndex, mouthIndex }) => `${phonatorIndex}:${mouthIndex}`;
  const selectedKeys = new Set();
  const add = (route) => {
    if (!route || selectedKeys.has(routeKey(route))) return;
    selected.push(route);
    selectedKeys.add(routeKey(route));
  };
  for (const phonatorIndex of recipe.phonatorIndices) {
    add(eligible.find((route) => route.phonatorIndex === phonatorIndex));
  }
  for (const mouthIndex of recipe.mouthIndices) {
    add(eligible.find((route) => route.mouthIndex === mouthIndex));
  }
  for (const route of eligible) {
    if (selected.length >= recipe.counts.routes) break;
    add(route);
  }
  const primary = Array.from(
    { length: COLONY_SYRINX_PHONATOR_COUNT },
    () => Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
  );
  const alternate = primary.map((row) => row.slice());
  selected.forEach(({ phonatorIndex, mouthIndex }, index) => {
    const amount = randomRange(random, 0.34, 1);
    primary[phonatorIndex][mouthIndex] = amount;
    alternate[phonatorIndex][mouthIndex] = clamp(
      1.18 - amount * 0.72 + (index % 2) * 0.14,
      0.24,
      1,
    );
  });
  return { primary, alternate };
};

const callMotionValue = (profile, laneIndex, phase, noise) => {
  const arch = Math.sin(Math.PI * phase) ** 0.72;
  const plateau = smoothstep(0, 0.18, phase) * (1 - smoothstep(0.72, 1, phase));
  const wave = 0.5 + Math.sin(TWO_PI * phase) * 0.5;
  const offsetWave = 0.5 + Math.sin(TWO_PI * phase + laneIndex * 1.74) * 0.5;
  if (profile === "fall") return laneIndex === 1 || laneIndex === 2 ? phase : 1 - phase * 0.92;
  if (profile === "rise") return laneIndex === 0 ? arch : phase * 0.92;
  if (profile === "opening") return laneIndex === 0 ? arch : laneIndex === 2 ? 0.18 : plateau;
  if (profile === "bend") return laneIndex === 0 ? plateau : laneIndex === 1 ? wave : 1 - phase * 0.74;
  if (profile === "exchange") {
    if (laneIndex === 2 || laneIndex === 4) return phase;
    if (laneIndex === 3) return 1 - phase;
    return laneIndex === 0 ? arch : wave;
  }
  if (profile === "offset") return laneIndex === 0 ? arch : offsetWave;
  if (profile === "descent") return laneIndex < 2 ? 1 - phase * 0.72 : offsetWave;
  return laneIndex === 0 ? 0.58 + plateau * 0.4 : mix(offsetWave, noise, 0.26);
};

const materializeCallContours = (state, recipe, random) => state.contours.map((contour, laneIndex) => ({
  ...contour,
  points: contour.points.map((noise, pointIndex) => clamp(mix(
    noise,
    callMotionValue(
      recipe.motionProfile,
      laneIndex,
      pointIndex / Math.max(1, COLONY_SYRINX_CONTOUR_POINT_COUNT - 1),
      random(),
    ),
    recipe.mediumId === "pellets" ? 0.72 : recipe.mediumId === "water" ? 0.86 : 0.8,
  ))),
  shape: recipe.mediumId === "water"
    ? "spline"
    : recipe.mediumId === "pellets" && laneIndex % 2 ? "linear" : contour.shape,
  rate: clamp(
    contour.rate * (recipe.motionProfile === "dense" ? 0.58 : 0.78),
    ...COLONY_SYRINX_LIMITS.contourRate,
  ),
  depth: clamp(0.68 + random() * 0.32),
  muted: false,
}));

export function colonySyrinxCallById(id) {
  return COLONY_SYRINX_CALLS.find((recipe) => recipe.id === id) ?? null;
}

/** Build one deterministic, continuous 1–10 second call state. */
export function createColonySyrinxCallState(reference = 0, fallback = DEFAULT_COLONY_SYRINX_STATE) {
  const requested = typeof reference === "string"
    ? colonySyrinxCallById(reference)
    : COLONY_SYRINX_CALLS[wrap(reference, COLONY_SYRINX_CALL_COUNT)];
  const recipe = requested ?? COLONY_SYRINX_CALLS[0];
  const random = seededRandom(recipe.seed ^ 0x43a11ced);
  const randomized = randomizeColonySyrinxState(fallback, {
    scope: "all",
    seed: recipe.seed,
  });
  const phonatorEnabled = maskFromIndices(
    COLONY_SYRINX_PHONATOR_COUNT,
    recipe.phonatorIndices,
  );
  const mouthEnabled = maskFromIndices(COLONY_SYRINX_MOUTH_COUNT, recipe.mouthIndices);
  const routes = callRouteMatrices(recipe, random);
  const materialControls = recipe.mediumId === "water"
    ? { pressureGain: 1.56, crossCoupling: 0.68, colonyAmount: 0.2, leak: 0.022 }
    : recipe.mediumId === "pellets"
      ? { pressureGain: 1.82, crossCoupling: 0.46, colonyAmount: 0.7, leak: 0.032 }
      : { pressureGain: 1.24, crossCoupling: 0.38, colonyAmount: 0.28, leak: 0.046 };
  const callState = {
    ...randomized,
    ...materialControls,
    mediumId: recipe.mediumId,
    contourDurationSeconds: recipe.durationSeconds,
    breath: recipe.mediumId === "air" ? 0.78 : 0.88,
    level: recipe.mediumId === "air" ? 0.72 : recipe.mediumId === "water" ? 0.76 : 0.8,
    valveSlewMs: recipe.mediumId === "water"
      ? randomRange(random, 48, 136)
      : recipe.mediumId === "pellets" ? randomRange(random, 6, 34) : randomRange(random, 12, 72),
    lungEnabled: callLungMask(recipe.phonatorIndices, recipe.counts.lungs, random),
    phonatorEnabled,
    foldEnabled: callFoldMask(recipe.phonatorIndices, recipe.counts.folds, random),
    mouthEnabled,
    routes: routes.primary,
    alternateRoutes: routes.alternate,
  };
  callState.contours = materializeCallContours(callState, recipe, random);
  return sanitizeColonySyrinxState(callState, fallback);
}

const evaluateSanitizedStep = (state, stepIndex, options = {}) => {
  const index = wrap(stepIndex, COLONY_SYRINX_SEQUENCE_LENGTH);
  const step = state.sequence[index];
  const sequenceEnabled = options.sequencerEnabled == null
    ? state.sequencerEnabled
    : Boolean(options.sequencerEnabled);
  const activeMidiNotes = options.activeMidiNotes ?? options.midiNotes;
  const midiSupplied = Array.isArray(activeMidiNotes) || activeMidiNotes instanceof Set;
  const midiMode = ["add", "replace"].includes(options.midiMode)
    ? options.midiMode
    : state.midiMode;
  const midiVelocities = midiRouteVelocities(activeMidiNotes, state.midiBaseNote);
  const routeTargets = zeroes(COLONY_SYRINX_ROUTE_COUNT);

  for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
    const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
    const baseAperture = state.routes[phonatorIndex][mouthIndex];
    const scoreGate = sequenceEnabled ? ((step.routeMask >> routeIndex) & 1) : 1;
    let target = baseAperture * scoreGate;
    if (midiSupplied) {
      const midiTarget = baseAperture * midiVelocities[routeIndex];
      target = midiMode === "replace" ? midiTarget : Math.max(target, midiTarget);
    }
    const externalGate = gateValueAt(options.routeGates, routeIndex);
    if (externalGate != null) target *= clamp(externalGate);
    routeTargets[routeIndex] = clamp(target);
  }

  const suppliedLaneIndices = Array.isArray(options.laneStepIndices)
    || ArrayBuffer.isView(options.laneStepIndices)
    ? options.laneStepIndices
    : null;
  const laneStepIndices = state.lanes.map((lane, laneIndex) => wrap(
    suppliedLaneIndices?.[laneIndex] ?? Math.floor(index * lane.rate),
    lane.length,
  ));
  const laneVelocities = state.lanes.map((lane, laneIndex) => (
    lane.muted ? 0 : lane.steps[laneStepIndices[laneIndex]]
  ));
  const mouthOverrides = Array.isArray(options.mouthGates)
    || ArrayBuffer.isView(options.mouthGates)
    ? options.mouthGates
    : [];
  const mouthGates = Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (_, mouthIndex) => {
    const scoreGate = sequenceEnabled
      ? step.mouthGates[mouthIndex] * laneVelocities[mouthIndex]
      : 1;
    return clamp(mouthOverrides[mouthIndex], 0, 1, scoreGate);
  });
  const routes = COLONY_SYRINX_TOPOLOGY.routes.map((route) => Object.freeze({
    ...route,
    midiNote: state.midiBaseNote + route.index,
    aperture: routeTargets[route.index],
    active: routeTargets[route.index] > 1e-6,
  }));
  return Object.freeze({
    index,
    accent: sequenceEnabled ? step.accent : 1,
    routeMask: sequenceEnabled ? step.routeMask : (1 << COLONY_SYRINX_ROUTE_COUNT) - 1,
    routeTargets: Object.freeze(routeTargets),
    routeGates: Object.freeze(Array.from(
      { length: COLONY_SYRINX_PHONATOR_COUNT },
      (_, phonatorIndex) => Object.freeze(routeTargets.slice(
        phonatorIndex * COLONY_SYRINX_MOUTH_COUNT,
        (phonatorIndex + 1) * COLONY_SYRINX_MOUTH_COUNT,
      )),
    )),
    laneStepIndices: Object.freeze(laneStepIndices),
    laneVelocities: Object.freeze(laneVelocities),
    mouthGates: Object.freeze(mouthGates),
    activeRouteIndices: Object.freeze(routes.filter(({ active }) => active).map(({ index: routeIndex }) => routeIndex)),
    routes: Object.freeze(routes),
  });
};

export function evaluateColonySyrinxStep(configuration, stepIndex = 0, options = {}) {
  return evaluateSanitizedStep(sanitizeColonySyrinxState(configuration), stepIndex, options);
}

export function colonySyrinxStepDurationSeconds(configuration, stepIndex = 0) {
  const state = sanitizeColonySyrinxState(configuration);
  const base = 60 / state.tempoBpm / state.stepsPerBeat;
  return base * (wrap(stepIndex, 2) === 0 ? 1 + state.swing : 1 - state.swing);
}

export function colonySyrinxLaneStepDurationSeconds(configuration, laneIndex, stepIndex = 0) {
  const state = sanitizeColonySyrinxState(configuration);
  const index = clampInteger(laneIndex, 0, COLONY_SYRINX_LEGACY_LANE_COUNT - 1, 0);
  const lane = state.lanes[index];
  const base = 60 / state.tempoBpm / state.stepsPerBeat / lane.rate;
  return base * (wrap(stepIndex, 2) === 0 ? 1 + state.swing : 1 - state.swing);
}

const advanceSequenceClock = (clock, state, deltaSeconds, explicitStepIndex) => {
  if (Number.isFinite(Number(explicitStepIndex))) {
    return { stepIndex: wrap(explicitStepIndex, COLONY_SYRINX_SEQUENCE_LENGTH), stepElapsedSeconds: 0 };
  }
  if (!state.sequencerEnabled || deltaSeconds <= 0) return clock;
  let stepIndex = clock.stepIndex;
  let stepElapsedSeconds = clock.stepElapsedSeconds + deltaSeconds;
  let guard = 0;
  let duration = 60 / state.tempoBpm / state.stepsPerBeat
    * (wrap(stepIndex, 2) === 0 ? 1 + state.swing : 1 - state.swing);
  while (stepElapsedSeconds + 1e-12 >= duration && guard < 64) {
    stepElapsedSeconds = Math.max(0, stepElapsedSeconds - duration);
    stepIndex = wrap(stepIndex + 1, COLONY_SYRINX_SEQUENCE_LENGTH);
    duration = 60 / state.tempoBpm / state.stepsPerBeat
      * (wrap(stepIndex, 2) === 0 ? 1 + state.swing : 1 - state.swing);
    guard += 1;
  }
  return { stepIndex, stepElapsedSeconds };
};

const advanceLaneClocks = (indices, elapsed, state, deltaSeconds, explicitIndices) => {
  const nextIndices = indices.slice();
  const nextElapsed = elapsed.slice();
  for (let laneIndex = 0; laneIndex < COLONY_SYRINX_LEGACY_LANE_COUNT; laneIndex += 1) {
    const lane = state.lanes[laneIndex];
    if (explicitIndices) {
      nextIndices[laneIndex] = wrap(explicitIndices[laneIndex], lane.length);
      nextElapsed[laneIndex] = 0;
      continue;
    }
    if (!state.sequencerEnabled || deltaSeconds <= 0) continue;
    nextElapsed[laneIndex] += deltaSeconds;
    let guard = 0;
    let duration = 60 / state.tempoBpm / state.stepsPerBeat / lane.rate
      * (wrap(nextIndices[laneIndex], 2) === 0 ? 1 + state.swing : 1 - state.swing);
    while (nextElapsed[laneIndex] + 1e-12 >= duration && guard < 64) {
      nextElapsed[laneIndex] = Math.max(0, nextElapsed[laneIndex] - duration);
      nextIndices[laneIndex] = wrap(nextIndices[laneIndex] + 1, lane.length);
      duration = 60 / state.tempoBpm / state.stepsPerBeat / lane.rate
        * (wrap(nextIndices[laneIndex], 2) === 0 ? 1 + state.swing : 1 - state.swing);
      guard += 1;
    }
  }
  return { laneStepIndices: nextIndices, laneStepElapsedSeconds: nextElapsed };
};

const freezeRuntime = (runtime) => Object.freeze({
  ...runtime,
  laneStepIndices: Object.freeze(runtime.laneStepIndices),
  laneStepElapsedSeconds: Object.freeze(runtime.laneStepElapsedSeconds),
  lanePhases: Object.freeze(runtime.lanePhases),
  laneVelocities: Object.freeze(runtime.laneVelocities),
  contourValues: Object.freeze(runtime.contourValues),
  lungPressures: Object.freeze(runtime.lungPressures),
  reservoirPressures: Object.freeze(runtime.reservoirPressures),
  routeTargets: Object.freeze(runtime.routeTargets),
  routeApertures: Object.freeze(runtime.routeApertures),
  routeFlows: Object.freeze(runtime.routeFlows),
  routeJams: Object.freeze(runtime.routeJams),
  colonyGates: Object.freeze(runtime.colonyGates),
  mouthApertures: Object.freeze(runtime.mouthApertures),
  mouthPressures: Object.freeze(runtime.mouthPressures),
  mouthFlows: Object.freeze(runtime.mouthFlows),
  phonatorLevels: Object.freeze(runtime.phonatorLevels),
  phonatorTensions: Object.freeze(runtime.phonatorTensions),
  phonatorFrequenciesHz: Object.freeze(runtime.phonatorFrequenciesHz),
  foldActivities: Object.freeze(runtime.foldActivities),
  foldFrequenciesHz: Object.freeze(runtime.foldFrequenciesHz),
});

export function stepColonySyrinx(
  previousRuntime = DEFAULT_COLONY_SYRINX_RUNTIME,
  configuration = DEFAULT_COLONY_SYRINX_STATE,
  deltaSeconds = 1 / 60,
  options = {},
) {
  const state = sanitizeColonySyrinxState(configuration);
  const medium = COLONY_SYRINX_MEDIA[state.mediumId];
  const previous = sanitizeColonySyrinxRuntime(previousRuntime);
  const delta = clamp(deltaSeconds, 0, COLONY_SYRINX_MAX_DELTA_SECONDS, 0);
  const substepCount = Math.max(1, Math.ceil(delta * 120));
  const substepSeconds = delta / substepCount;
  const explicitStepIndex = Number.isFinite(Number(options.stepIndex)) ? options.stepIndex : undefined;
  const optionLaneIndices = Array.isArray(options.laneStepIndices)
    || ArrayBuffer.isView(options.laneStepIndices)
    ? options.laneStepIndices
    : null;
  const explicitLaneIndices = optionLaneIndices ?? (explicitStepIndex == null
    ? null
    : state.lanes.map((lane) => Math.floor(explicitStepIndex * lane.rate)));
  const autonomousAmount = clamp(options.colonyAmount, 0, 1, state.colonyAmount);
  const suppliedBankExhaleGates = Array.isArray(options.bankExhaleGates)
    || ArrayBuffer.isView(options.bankExhaleGates)
    ? options.bankExhaleGates
    : null;
  const bankExhaleGates = Array.from(
    { length: COLONY_SYRINX_BANK_COUNT },
    (_, index) => clamp(suppliedBankExhaleGates?.[index], 0, 1, 1),
  );

  const runtime = {
    ...previous,
    laneStepIndices: previous.laneStepIndices.slice(),
    laneStepElapsedSeconds: previous.laneStepElapsedSeconds.slice(),
    lanePhases: previous.lanePhases.slice(),
    laneVelocities: previous.laneVelocities.slice(),
    contourValues: previous.contourValues.slice(),
    lungPressures: previous.lungPressures.slice(),
    reservoirPressures: previous.reservoirPressures.slice(),
    routeTargets: previous.routeTargets.slice(),
    routeApertures: previous.routeApertures.slice(),
    routeFlows: previous.routeFlows.slice(),
    routeJams: previous.routeJams.slice(),
    colonyGates: previous.colonyGates.slice(),
    mouthApertures: previous.mouthApertures.slice(),
    mouthPressures: previous.mouthPressures.slice(),
    mouthFlows: previous.mouthFlows.slice(),
    phonatorLevels: previous.phonatorLevels.slice(),
    phonatorTensions: previous.phonatorTensions.slice(),
    phonatorFrequenciesHz: previous.phonatorFrequenciesHz.slice(),
    foldActivities: previous.foldActivities.slice(),
    foldFrequenciesHz: previous.foldFrequenciesHz.slice(),
  };
  let clock = { stepIndex: runtime.stepIndex, stepElapsedSeconds: runtime.stepElapsedSeconds };
  let laneClock = {
    laneStepIndices: runtime.laneStepIndices,
    laneStepElapsedSeconds: runtime.laneStepElapsedSeconds,
  };
  for (let substep = 0; substep < substepCount; substep += 1) {
    const h = substepSeconds;
    clock = advanceSequenceClock(clock, state, h, explicitStepIndex);
    laneClock = advanceLaneClocks(
      laneClock.laneStepIndices,
      laneClock.laneStepElapsedSeconds,
      state,
      h,
      explicitLaneIndices,
    );
    runtime.timeSeconds = Math.min(1e9, runtime.timeSeconds + h);
    const contours = evaluateSanitizedContours(state, runtime.timeSeconds, options);
    runtime.contourPhase = contours.contourPhase;
    runtime.continuousBreath = contours.continuousBreath;
    runtime.tensionOffset = contours.tensionOffset;
    runtime.lanePhases = contours.lanePhases.slice();
    runtime.laneVelocities = contours.laneVelocities.slice();
    runtime.contourValues = contours.contourValues.slice();

    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      const pressure = runtime.reservoirPressures[route.phonatorIndex];
      const backPressure = runtime.mouthPressures[route.mouthIndex];
      const offset = ((routeIndex * 7) % COLONY_SYRINX_ROUTE_COUNT) / (COLONY_SYRINX_ROUTE_COUNT - 1) - 0.5;
      const openThreshold = 0.42 + offset * 0.22 + backPressure * 0.16;
      const transitionWidth = 0.08 + state.gateHysteresis * 0.24;
      const pressureValve = smoothstep(
        openThreshold - transitionWidth,
        openThreshold + transitionWidth,
        pressure,
      );
      runtime.colonyGates[routeIndex] += (
        pressureValve - runtime.colonyGates[routeIndex]
      ) * timeAlpha(9, h);
      const contourTarget = contours.routes[route.phonatorIndex][route.mouthIndex];
      const autonomousTarget = contourTarget > 0
        ? mix(contourTarget, 1, runtime.colonyGates[routeIndex] * 0.42)
        : 0;
      runtime.routeTargets[routeIndex] = clamp(
        mix(contourTarget, autonomousTarget, autonomousAmount)
          * bankExhaleGates[route.phonatorIndex],
      );
      runtime.routeApertures[routeIndex] += (
        runtime.routeTargets[routeIndex] - runtime.routeApertures[routeIndex]
      ) * timeAlpha(1_000 / state.valveSlewMs, h);
    }

    const mouthAperturesBefore = runtime.mouthApertures.slice();
    for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
      const mouth = state.mouths[mouthIndex];
      const target = contours.mouthOpenings[mouthIndex];
      runtime.mouthApertures[mouthIndex] += (
        target - runtime.mouthApertures[mouthIndex]
      ) * timeAlpha(1_000 / mouth.slewMs, h);
    }

    const transferByBank = zeroes(COLONY_SYRINX_BANK_COUNT);
    for (let lungIndex = 0; lungIndex < COLONY_SYRINX_LUNG_COUNT; lungIndex += 1) {
      const bankIndex = Math.floor(lungIndex / COLONY_SYRINX_LUNGS_PER_BANK);
      const bank = state.banks[bankIndex];
      const enabled = state.lungEnabled[lungIndex];
      const phase = fract(
        runtime.timeSeconds * state.breathRateBpm / 60 + COLONY_SYRINX_LUNG_PHASES[lungIndex],
      );
      const stroke = 0.56 + 0.44 * (0.5 - 0.5 * Math.cos(TWO_PI * phase));
      const target = enabled
        ? contours.continuousBreath * state.pressureGain * bank.drive * stroke
        : 0;
      let pressure = runtime.lungPressures[lungIndex];
      pressure += (target - pressure) * timeAlpha(medium.lungResponse, h);
      const gradient = Math.max(0, pressure - runtime.reservoirPressures[bankIndex] * 0.78);
      const transfer = enabled ? Math.min(pressure, gradient * medium.transferRate * h) : 0;
      runtime.lungPressures[lungIndex] = clamp(
        pressure - transfer - pressure * (0.012 + medium.pressureLeak * 0.08) * h,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
      transferByBank[bankIndex] += transfer;
    }

    for (let bankIndex = 0; bankIndex < COLONY_SYRINX_BANK_COUNT; bankIndex += 1) {
      const capacity = state.banks[bankIndex].compliance * COLONY_SYRINX_LUNGS_PER_BANK;
      runtime.reservoirPressures[bankIndex] = clamp(
        runtime.reservoirPressures[bankIndex] + transferByBank[bankIndex] / capacity,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
    }
    const activeReservoirIndices = state.phonatorEnabled
      .map((enabled, index) => (
        enabled || state.lungEnabled
          .slice(
            index * COLONY_SYRINX_LUNGS_PER_BANK,
            (index + 1) * COLONY_SYRINX_LUNGS_PER_BANK,
          )
          .some(Boolean)
          ? index
          : -1
      ))
      .filter((index) => index >= 0);
    const reservoirMean = activeReservoirIndices.length
      ? activeReservoirIndices.reduce(
        (sum, index) => sum + runtime.reservoirPressures[index],
        0,
      ) / activeReservoirIndices.length
      : 0;
    const couplingAlpha = timeAlpha(state.crossCoupling * 2.4, h);
    for (let bankIndex = 0; bankIndex < COLONY_SYRINX_BANK_COUNT; bankIndex += 1) {
      if (activeReservoirIndices.includes(bankIndex)) {
        runtime.reservoirPressures[bankIndex] += (
          reservoirMean - runtime.reservoirPressures[bankIndex]
        ) * couplingAlpha;
      } else {
        runtime.reservoirPressures[bankIndex] *= 1 - timeAlpha(8, h);
      }
    }

    const mouthInputVolumes = zeroes(COLONY_SYRINX_MOUTH_COUNT);
    const bankOutputVolumes = zeroes(COLONY_SYRINX_BANK_COUNT);
    runtime.routeFlows.fill(0);
    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      if (!state.phonatorEnabled[route.phonatorIndex]
        || !state.mouthEnabled[route.mouthIndex]) {
        runtime.routeJams[routeIndex] *= 1 - timeAlpha(medium.jamRelease, h);
        continue;
      }
      const phonator = state.phonators[route.phonatorIndex];
      const pressureDelta = Math.max(
        0,
        runtime.reservoirPressures[route.phonatorIndex] - runtime.mouthPressures[route.mouthIndex],
      );
      const firstFold = route.phonatorIndex * 2;
      const activeFoldFraction = (
        Number(state.foldEnabled[firstFold]) + Number(state.foldEnabled[firstFold + 1])
      ) * 0.5;
      const voicedFoldOpening = 0.08 + (1 - phonator.closure) ** 1.45 * 0.92;
      const foldOpening = mix(1, voicedFoldOpening, activeFoldFraction);
      const aperture = runtime.routeApertures[routeIndex];
      let jam = runtime.routeJams[routeIndex];
      if (medium.jamBuild > 0) {
        const packing = pressureDelta * aperture * (1 - aperture) * medium.jamBuild;
        const release = (0.08 + aperture ** 2) * medium.jamRelease;
        jam = clamp(jam + (packing * (1 - jam) - release * jam) * h);
      } else {
        jam *= 1 - timeAlpha(medium.jamRelease, h);
      }
      runtime.routeJams[routeIndex] = jam;
      const flow = clamp(
        aperture * foldOpening * medium.routeConductance * Math.sqrt(pressureDelta) * (1 - jam * 0.94),
        0,
        8,
      );
      runtime.routeFlows[routeIndex] = flow;
      const volume = flow * h;
      mouthInputVolumes[route.mouthIndex] += volume;
      bankOutputVolumes[route.phonatorIndex] += volume;
    }

    for (let bankIndex = 0; bankIndex < COLONY_SYRINX_BANK_COUNT; bankIndex += 1) {
      const bank = state.banks[bankIndex];
      const capacity = Math.max(0.2, bank.compliance);
      const leakage = runtime.reservoirPressures[bankIndex]
        * (state.leak + bank.leak + medium.pressureLeak) * h;
      runtime.reservoirPressures[bankIndex] = clamp(
        runtime.reservoirPressures[bankIndex] - bankOutputVolumes[bankIndex] / capacity - leakage,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
    }

    let impact = 0;
    let granularActivity = 0;
    runtime.mouthFlows.fill(0);
    for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
      const mouth = state.mouths[mouthIndex];
      if (!state.mouthEnabled[mouthIndex]) {
        runtime.mouthPressures[mouthIndex] *= 1 - timeAlpha(8, h);
        continue;
      }
      const capacity = 0.32 + mouth.cavity * 1.18 + mouth.tongueSize * 0.22;
      const pressureBeforeRelease = clamp(
        runtime.mouthPressures[mouthIndex] + mouthInputVolumes[mouthIndex] / capacity,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
      const aperture = runtime.mouthApertures[mouthIndex];
      const resistance = 1 + mouth.tongueSize * 0.34 + mouth.lipSize * 0.4 + mouth.lipTension * 0.18;
      const outlet = medium.outletConductance * aperture ** 1.35 / resistance;
      const leak = mouth.leak * (0.32 + medium.outletConductance * 0.18);
      const flow = clamp((outlet + leak) * Math.sqrt(pressureBeforeRelease), 0, 8);
      runtime.mouthFlows[mouthIndex] = flow;
      runtime.mouthPressures[mouthIndex] = clamp(
        pressureBeforeRelease - flow * h / capacity,
        0,
        COLONY_SYRINX_MAX_PRESSURE,
      );
      const apertureVelocity = h > 0
        ? Math.max(0, aperture - mouthAperturesBefore[mouthIndex]) / h
        : 0;
      impact += pressureBeforeRelease * apertureVelocity * medium.impactGain * 0.05;
      granularActivity += flow * (
        medium.jamBuild > 0 ? 0.34 + mouth.tongueSize * 0.66 : 0
      );
    }
    runtime.impact = clamp(mix(runtime.impact, impact, timeAlpha(18, h)));
    runtime.granularActivity = clamp(mix(
      runtime.granularActivity,
      granularActivity * 0.45 + runtime.routeJams.reduce((sum, jam) => sum + jam, 0) / 24,
      timeAlpha(10, h),
    ));
  }

  runtime.stepIndex = clock.stepIndex;
  runtime.stepElapsedSeconds = clock.stepElapsedSeconds;
  runtime.laneStepIndices = laneClock.laneStepIndices;
  runtime.laneStepElapsedSeconds = laneClock.laneStepElapsedSeconds;
  const activePhonatorIndices = state.phonatorEnabled
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
  runtime.meanPressure = activePhonatorIndices.length
    ? activePhonatorIndices.reduce(
      (sum, index) => sum + runtime.reservoirPressures[index],
      0,
    ) / activePhonatorIndices.length
    : 0;
  runtime.totalFlow = runtime.mouthFlows.reduce((sum, flow) => sum + flow, 0);
  runtime.outputLevel = clamp(runtime.totalFlow * state.level * medium.outputGain * 0.72);

  for (let phonatorIndex = 0; phonatorIndex < COLONY_SYRINX_PHONATOR_COUNT; phonatorIndex += 1) {
    const phonator = state.phonators[phonatorIndex];
    const firstFold = phonatorIndex * 2;
    if (!state.phonatorEnabled[phonatorIndex]) {
      runtime.phonatorLevels[phonatorIndex] = 0;
      runtime.phonatorTensions[phonatorIndex] = 0;
      runtime.phonatorFrequenciesHz[phonatorIndex] = 0;
      runtime.foldFrequenciesHz[firstFold] = 0;
      runtime.foldFrequenciesHz[firstFold + 1] = 0;
      runtime.foldActivities[firstFold] = 0;
      runtime.foldActivities[firstFold + 1] = 0;
      continue;
    }
    const pressure = runtime.reservoirPressures[phonatorIndex];
    const load = runtime.routeApertures
      .slice(
        phonatorIndex * COLONY_SYRINX_MOUTH_COUNT,
        (phonatorIndex + 1) * COLONY_SYRINX_MOUTH_COUNT,
      )
      .reduce((sum, aperture) => sum + aperture, 0) / COLONY_SYRINX_MOUTH_COUNT;
    const closureVoicing = Math.sin(Math.PI * clamp(phonator.closure)) ** 0.72;
    const pressureVoicing = smoothstep(
      medium.phonationThreshold,
      medium.phonationThreshold + 0.7,
      pressure,
    );
    const enabledFoldCount = Number(state.foldEnabled[firstFold])
      + Number(state.foldEnabled[firstFold + 1]);
    const foldScale = Math.sqrt(enabledFoldCount * 0.5);
    const level = clamp(
      pressureVoicing * closureVoicing * (0.18 + load * 0.82) * foldScale,
    );
    const couplingBend = (runtime.meanPressure - pressure) * state.crossCoupling * 2.4;
    const pressureBend = pressure * (state.mediumId === "air" ? 1.8 : 0.72);
    const tension = clamp(phonator.tension + runtime.tensionOffset);
    const semitones = (tension - 0.5) * 18 + couplingBend + pressureBend;
    const frequency = clamp(phonator.frequencyHz * 2 ** (semitones / 12), 8, 20_000);
    runtime.phonatorLevels[phonatorIndex] = level;
    runtime.phonatorTensions[phonatorIndex] = tension;
    runtime.phonatorFrequenciesHz[phonatorIndex] = enabledFoldCount > 0 ? frequency : 0;
    const flutterCents = Math.sin(
      runtime.timeSeconds * (1.7 + phonatorIndex * 0.37) * TWO_PI + phonatorIndex,
    ) * phonator.roughness * 18;
    const detuneCents = phonator.asymmetry * 52 + flutterCents;
    runtime.foldFrequenciesHz[firstFold] = state.foldEnabled[firstFold]
      ? clamp(frequency * 2 ** (-detuneCents / 1_200), 8, 20_000)
      : 0;
    runtime.foldFrequenciesHz[firstFold + 1] = state.foldEnabled[firstFold + 1]
      ? clamp(frequency * 2 ** (detuneCents / 1_200), 8, 20_000)
      : 0;
    runtime.foldActivities[firstFold] = state.foldEnabled[firstFold]
      ? clamp(level * (1 - phonator.asymmetry * 0.14))
      : 0;
    runtime.foldActivities[firstFold + 1] = state.foldEnabled[firstFold + 1]
      ? clamp(level * (1 + phonator.asymmetry * 0.14))
      : 0;
  }

  return freezeRuntime(runtime);
}

export const advanceColonySyrinx = stepColonySyrinx;
