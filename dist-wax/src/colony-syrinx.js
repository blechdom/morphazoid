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

// The editor stores organ positions with the sound rather than treating its
// anatomy drawing as disposable UI state. These bounds mirror the three broad
// anatomical regions in colony-syrinx-graph.js without making the DSP model
// depend on the SVG renderer.
export const COLONY_SYRINX_ORGAN_LAYOUT_REGIONS = deepFreeze({
  lung: { minX: 48, maxX: 380, minY: 58, maxY: 562 },
  source: { minX: 340, maxX: 690, minY: 70, maxY: 550 },
  mouth: { minX: 720, maxX: 904, minY: 88, maxY: 532 },
});

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
  contourDurationSeconds: [0.1, 120],
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

// Internal control-rate profiles expose different loading, release, impact,
// and jamming behavior without assigning a literal material to the sound.
export const COLONY_SYRINX_MEDIA = deepFreeze({
  air: {
    id: "air",
    label: "Open flow",
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
    label: "Loaded flow",
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
    label: "Impact flow",
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

export const COLONY_SYRINX_ARTICULATION_MODES = Object.freeze([
  "flow",
  "tone",
  "plosive",
  "lip-pop",
  "tongue-click",
  "puff",
  "impact",
  "pulse",
  "throb",
  "mouth-call",
  "sustained",
]);

export const DEFAULT_COLONY_SYRINX_ARTICULATION = deepFreeze({
  mode: "flow",
  strike: 0,
  attackMs: 35,
  releaseMs: 140,
  prechargeMs: 0,
  burst: 0,
  pulseRateHz: 0,
  pulseDepth: 0,
  pushPull: 0,
  brightness: 0.48,
  noise: 0.24,
});

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

export const DEFAULT_COLONY_SYRINX_ORGAN_LAYOUT = deepFreeze({
  seed: 0x436f6c6f,
  lungs: Array.from({ length: COLONY_SYRINX_LUNG_COUNT }, (_, index) => [
    82 + (index % 4) * 88,
    92 + Math.floor(index / 4) * 145,
  ]),
  sources: Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, (_, index) => [
    520,
    92 + index * 145,
  ]),
  mouths: Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (_, index) => [
    826,
    145 + index * 165,
  ]),
});

const contour = (id, points, shape, rate, depth = 1) => ({
  id,
  points,
  shape,
  rate,
  depth,
  muted: false,
  loop: true,
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
  organMotionEnabled: false,
  midiBaseNote: 48,
  midiMode: "add",
  level: 0.58,
  articulation: DEFAULT_COLONY_SYRINX_ARTICULATION,
  lungEnabled: Array(COLONY_SYRINX_LUNG_COUNT).fill(true),
  phonatorEnabled: Array(COLONY_SYRINX_PHONATOR_COUNT).fill(true),
  foldEnabled: Array(COLONY_SYRINX_FOLD_COUNT).fill(true),
  mouthEnabled: Array(COLONY_SYRINX_MOUTH_COUNT).fill(true),
  banks: DEFAULT_BANKS,
  phonators: DEFAULT_PHONATORS,
  routes: DEFAULT_ROUTES,
  alternateRoutes: DEFAULT_ALTERNATE_ROUTES,
  mouths: COLONY_SYRINX_MOUTH_ARCHETYPES,
  organLayout: DEFAULT_COLONY_SYRINX_ORGAN_LAYOUT,
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

const sanitizeOrganPositions = (source, fallback, defaults, count, region) => {
  const values = Array.isArray(source) ? source : [];
  const base = Array.isArray(fallback) ? fallback : defaults;
  return Array.from({ length: count }, (_, index) => {
    const point = Array.isArray(values[index]) ? values[index] : [];
    const fallbackPoint = Array.isArray(base[index]) ? base[index] : defaults[index];
    return [
      clamp(point[0], region.minX, region.maxX, fallbackPoint[0]),
      clamp(point[1], region.minY, region.maxY, fallbackPoint[1]),
    ];
  });
};

const sanitizeOrganLayout = (source, fallback, stateSeed) => {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object"
    ? fallback
    : DEFAULT_COLONY_SYRINX_ORGAN_LAYOUT;
  return {
    seed: normalizedSeed(value.seed, normalizedSeed(base.seed, stateSeed)),
    lungs: sanitizeOrganPositions(
      value.lungs,
      base.lungs,
      DEFAULT_COLONY_SYRINX_ORGAN_LAYOUT.lungs,
      COLONY_SYRINX_LUNG_COUNT,
      COLONY_SYRINX_ORGAN_LAYOUT_REGIONS.lung,
    ),
    sources: sanitizeOrganPositions(
      value.sources,
      base.sources,
      DEFAULT_COLONY_SYRINX_ORGAN_LAYOUT.sources,
      COLONY_SYRINX_PHONATOR_COUNT,
      COLONY_SYRINX_ORGAN_LAYOUT_REGIONS.source,
    ),
    mouths: sanitizeOrganPositions(
      value.mouths,
      base.mouths,
      DEFAULT_COLONY_SYRINX_ORGAN_LAYOUT.mouths,
      COLONY_SYRINX_MOUTH_COUNT,
      COLONY_SYRINX_ORGAN_LAYOUT_REGIONS.mouth,
    ),
  };
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
    loop: value.loop == null ? Boolean(base.loop ?? defaults.loop ?? true) : Boolean(value.loop),
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

const sanitizeArticulation = (
  source,
  fallback = DEFAULT_COLONY_SYRINX_ARTICULATION,
  defaults = DEFAULT_COLONY_SYRINX_ARTICULATION,
) => {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : defaults;
  const fallbackMode = COLONY_SYRINX_ARTICULATION_MODES.includes(base.mode)
    ? base.mode
    : defaults.mode;
  return {
    mode: COLONY_SYRINX_ARTICULATION_MODES.includes(value.mode) ? value.mode : fallbackMode,
    strike: boundedFrom(value, base, defaults, "strike", 0, 1),
    attackMs: boundedFrom(value, base, defaults, "attackMs", 0, 2_000),
    releaseMs: boundedFrom(value, base, defaults, "releaseMs", 0, 5_000),
    prechargeMs: boundedFrom(value, base, defaults, "prechargeMs", 0, 2_000),
    burst: boundedFrom(value, base, defaults, "burst", 0, 1),
    pulseRateHz: boundedFrom(value, base, defaults, "pulseRateHz", 0, 60),
    pulseDepth: boundedFrom(value, base, defaults, "pulseDepth", 0, 1),
    pushPull: boundedFrom(value, base, defaults, "pushPull", 0, 1),
    brightness: boundedFrom(value, base, defaults, "brightness", 0, 1),
    noise: boundedFrom(value, base, defaults, "noise", 0, 1),
  };
};

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
    organMotionEnabled: value.organMotionEnabled == null
      ? Boolean(base.organMotionEnabled ?? DEFAULT_COLONY_SYRINX_STATE.organMotionEnabled)
      : Boolean(value.organMotionEnabled),
    midiBaseNote: clampInteger(
      value.midiBaseNote,
      ...COLONY_SYRINX_LIMITS.midiBaseNote,
      clampInteger(base.midiBaseNote, ...COLONY_SYRINX_LIMITS.midiBaseNote, DEFAULT_COLONY_SYRINX_STATE.midiBaseNote),
    ),
    midiMode,
    level: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "level", ...COLONY_SYRINX_LIMITS.level),
    articulation: sanitizeArticulation(
      value.articulation,
      base.articulation,
      DEFAULT_COLONY_SYRINX_ARTICULATION,
    ),
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
  result.organLayout = sanitizeOrganLayout(
    value.organLayout,
    base.organLayout,
    result.seed,
  );
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

export const COLONY_SYRINX_PRESET_FORMAT_VERSION = 2;
export const COLONY_SYRINX_PRESET_HEADER = (
  `MORPHAZOID-PRESET monstrozoid v${COLONY_SYRINX_PRESET_FORMAT_VERSION}`
);
const COMPATIBLE_COLONY_SYRINX_PRESET_HEADERS = new Set([
  COLONY_SYRINX_PRESET_HEADER,
  `MORPHAZOID-PRESET monsterzoid v${COLONY_SYRINX_PRESET_FORMAT_VERSION}`,
  `MORPHAZOID-PRESET colony-syrinx v${COLONY_SYRINX_PRESET_FORMAT_VERSION}`,
]);
const LEGACY_COLONY_SYRINX_PRESET_HEADERS = new Set([
  "MORPHAZOID-PRESET monstrozoid v1",
  "MORPHAZOID-PRESET monsterzoid v1",
  "MORPHAZOID-PRESET colony-syrinx v1",
]);

const COLONY_SYRINX_PRESET_MAX_CHARACTERS = 64_000;

const presetTreeMatches = (candidate, canonical) => {
  if (Array.isArray(canonical)) {
    return Array.isArray(candidate)
      && candidate.length === canonical.length
      && canonical.every((value, index) => presetTreeMatches(candidate[index], value));
  }
  if (canonical && typeof canonical === "object") {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const candidateKeys = Object.keys(candidate);
    const canonicalKeys = Object.keys(canonical);
    return candidateKeys.length === canonicalKeys.length
      && canonicalKeys.every((key) => (
        Object.hasOwn(candidate, key) && presetTreeMatches(candidate[key], canonical[key])
      ));
  }
  return candidate === canonical;
};

/**
 * Format every sanitized configuration field as deterministic, shareable text.
 * The first line is deliberately readable so pasted presets identify both the
 * instrument and codec version without relying on a filename or binary wrapper.
 */
export function formatColonySyrinxPreset(configuration = DEFAULT_COLONY_SYRINX_STATE) {
  const state = sanitizeColonySyrinxState(configuration, DEFAULT_COLONY_SYRINX_STATE);
  return `${COLONY_SYRINX_PRESET_HEADER}\n${JSON.stringify(state)}`;
}

/**
 * Parse only complete Monstrozoid presets from this codec version. The former
 * Monsterzoid and Colony Syrinx headers remain readable so shared sounds do not break.
 * Invalid, truncated, foreign-instrument, or repairable payloads return null.
 */
export function parseColonySyrinxPreset(text) {
  if (typeof text !== "string" || text.length > COLONY_SYRINX_PRESET_MAX_CHARACTERS) return null;
  const source = text.trim();
  const lineBreak = source.indexOf("\n");
  const header = source.slice(0, lineBreak).trim();
  const legacy = LEGACY_COLONY_SYRINX_PRESET_HEADERS.has(header);
  if (lineBreak < 0 || (!COMPATIBLE_COLONY_SYRINX_PRESET_HEADERS.has(header) && !legacy)) {
    return null;
  }
  const payload = source.slice(lineBreak + 1).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // v1 predates draggable anatomy and its live-motion flag. Migrate only
    // those known omissions while retaining strict rejection of every other
    // incomplete or foreign tree.
    const candidate = legacy
      ? {
        ...parsed,
        organMotionEnabled: Object.hasOwn(parsed, "organMotionEnabled")
          ? parsed.organMotionEnabled
          : false,
        organLayout: Object.hasOwn(parsed, "organLayout")
          ? parsed.organLayout
          : {
            ...DEFAULT_COLONY_SYRINX_ORGAN_LAYOUT,
            seed: normalizedSeed(parsed.seed),
          },
      }
      : parsed;
    const state = sanitizeColonySyrinxState(candidate, DEFAULT_COLONY_SYRINX_STATE);
    return presetTreeMatches(candidate, state) ? state : null;
  } catch {
    return null;
  }
}

export const encodeColonySyrinxPreset = formatColonySyrinxPreset;
export const decodeColonySyrinxPreset = parseColonySyrinxPreset;

/**
 * Sample an evenly spaced contour. Continuous-performance contours are cyclic;
 * finite call contours opt out with `loop: false` so an onset can begin sealed
 * and a release can end at rest without interpolating across that seam.
 */
export function sampleColonySyrinxContour(contourLane, normalizedPhase = 0) {
  const points = Array.isArray(contourLane?.points) || ArrayBuffer.isView(contourLane?.points)
    ? contourLane.points
    : [];
  const length = points.length;
  if (length === 0) return 0.5;
  if (length === 1) return clamp(points[0]);
  const cyclic = contourLane?.loop !== false;
  const phase = cyclic
    ? ((finiteOr(normalizedPhase, 0) % 1) + 1) % 1
    : clamp(normalizedPhase, 0, 1, 0);
  const position = cyclic ? phase * length : phase * (length - 1);
  const index = cyclic
    ? Math.floor(position) % length
    : Math.min(length - 1, Math.floor(position));
  const amount = position - Math.floor(position);
  const left = clamp(points[index]);
  const rightIndex = cyclic ? (index + 1) % length : Math.min(length - 1, index + 1);
  const right = clamp(points[rightIndex]);
  if (contourLane?.shape === "linear") return mix(left, right, amount);
  if (contourLane?.shape === "spline") {
    const before = clamp(points[cyclic
      ? (index - 1 + length) % length
      : Math.max(0, index - 1)]);
    const after = clamp(points[cyclic
      ? (index + 2) % length
      : Math.min(length - 1, index + 2)]);
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
  const lanePhases = state.contours.map((lane, index) => {
    const position = absoluteCycles * lane.rate
      + (lane.loop === false ? 0 : CONTOUR_PHASE_OFFSETS[index]);
    return lane.loop === false
      ? clamp(position, 0, 1)
      : ((position % 1) + 1) % 1;
  });
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

const randomizedOrganPositions = (count, region, random, minimumSeparation) => {
  const placed = [];
  for (let index = 0; index < count; index += 1) {
    let best = null;
    let bestClearance = -Infinity;
    for (let attempt = 0; attempt < 2_048; attempt += 1) {
      const candidate = [
        randomRange(random, region.minX, region.maxX),
        randomRange(random, region.minY, region.maxY),
      ];
      const clearance = placed.reduce((nearest, point) => Math.min(
        nearest,
        Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) - minimumSeparation,
      ), Infinity);
      if (clearance > bestClearance) {
        best = candidate;
        bestClearance = clearance;
      }
      if (clearance >= 0) break;
    }
    placed.push(best);
  }
  return placed;
};

const randomizedOrganLayout = (seed, random) => ({
  seed,
  lungs: randomizedOrganPositions(
    COLONY_SYRINX_LUNG_COUNT,
    COLONY_SYRINX_ORGAN_LAYOUT_REGIONS.lung,
    random,
    68,
  ),
  sources: randomizedOrganPositions(
    COLONY_SYRINX_PHONATOR_COUNT,
    COLONY_SYRINX_ORGAN_LAYOUT_REGIONS.source,
    random,
    95,
  ),
  mouths: randomizedOrganPositions(
    COLONY_SYRINX_MOUTH_COUNT,
    COLONY_SYRINX_ORGAN_LAYOUT_REGIONS.mouth,
    random,
    143,
  ),
});

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
    organLayout: {
      ...base.organLayout,
      lungs: base.organLayout.lungs.map((point) => point.slice()),
      sources: base.organLayout.sources.map((point) => point.slice()),
      mouths: base.organLayout.mouths.map((point) => point.slice()),
    },
    articulation: { ...base.articulation },
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
      // Keep randomized tissue fundamentals inside a vocal/instrumental span.
      // The two syrinx source profiles multiply this value by as much as 3.7;
      // the previous 6.9-octave range could therefore turn a random body into
      // a sustained 10–12 kHz power-tool tone before the tract even shaped it.
      frequencyHz: 30 * 2 ** (random() * 4.35),
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
    next.organLayout = randomizedOrganLayout(seed, random);
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
    next.organMotionEnabled = random() < 0.68;
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
        loop: true,
      };
    });
    const safeModes = ["flow", "tone", "pulse", "throb", "mouth-call"];
    const mode = safeModes[Math.floor(random() * safeModes.length)];
    const pulsed = mode === "pulse" || mode === "throb" || mode === "mouth-call";
    next.articulation = {
      mode,
      strike: randomRange(random, 0, 0.38),
      attackMs: randomRange(random, 4, 90),
      releaseMs: randomRange(random, 80, 620),
      prechargeMs: 0,
      burst: randomRange(random, 0, 0.28),
      pulseRateHz: pulsed ? randomRange(random, 0.6, 12) : randomRange(random, 0, 1.5),
      pulseDepth: randomRange(random, 0, 1),
      pushPull: randomRange(random, 0, 1),
      brightness: randomRange(random, 0.04, 0.92),
      noise: randomRange(random, 0.01, 0.88),
    };
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

const callArticulation = (mode, overrides = {}) => ({
  ...DEFAULT_COLONY_SYRINX_ARTICULATION,
  mode,
  ...overrides,
});

const callSource = (index, frequencyHz, patch = {}) => {
  const { bank = {}, ...voice } = patch;
  return {
    index,
    frequencyHz,
    tension: 0.42,
    closure: 0.66,
    asymmetry: 0,
    roughness: 0.08,
    ...voice,
    bank: {
      drive: 0.82,
      compliance: 0.86,
      leak: 0.04,
      ...bank,
    },
  };
};

const callMouth = (index, resonanceHz, patch = {}) => ({
  ...COLONY_SYRINX_MOUTH_ARCHETYPES[index],
  index,
  resonanceHz,
  ...patch,
});

const callTimbre = (overrides = {}) => ({
  breath: 0.68,
  breathRateBpm: 32,
  pressureGain: 1.08,
  crossCoupling: 0.18,
  colonyAmount: 0.08,
  leak: 0.055,
  valveSlewMs: 18,
  level: 0.64,
  sources: [],
  mouths: [],
  ...overrides,
});

const BASE_CALL_RECIPE_DEFINITIONS = [
  {
    id: "air-lip-pop", label: "Lip pop", category: "plosive",
    gestureLabel: "sealed lips release into a rounded tail", mediumId: "air", durationSeconds: 1.4,
    lungCount: 1, phonatorIndices: [0], foldCount: 1, mouthIndices: [0], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("lip-pop", {
      strike: 0.96, attackMs: 0.8, releaseMs: 240, prechargeMs: 54, burst: 0.94,
      brightness: 0.28, noise: 0.16,
    }),
    timbre: callTimbre({
      breath: 0.72, pressureGain: 1.48, leak: 0.018, valveSlewMs: 2, level: 0.7,
      sources: [callSource(0, 66, { closure: 0.92, roughness: 0.02, bank: { drive: 1.2, compliance: 0.5, leak: 0.012 } })],
      mouths: [callMouth(0, 88, { opening: 0.9, tongueSize: 0.2, tonguePosition: 0.2, lipSize: 1, lipTension: 0.34, cavity: 0.42, leak: 0, slewMs: 2 })],
    }),
  },
  {
    id: "air-tongue-click", label: "Tongue click", category: "percussion",
    gestureLabel: "tongue seal snaps into a dry cavity tail", mediumId: "air", durationSeconds: 1.15,
    lungCount: 1, phonatorIndices: [2], foldCount: 0, mouthIndices: [2], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("tongue-click", {
      strike: 1, attackMs: 0.4, releaseMs: 180, prechargeMs: 32, burst: 0.9,
      brightness: 0.62, noise: 0.3,
    }),
    timbre: callTimbre({
      breath: 0.55, pressureGain: 1.34, leak: 0.014, valveSlewMs: 2, level: 0.68,
      sources: [callSource(2, 94, { closure: 0.9, roughness: 0.04, bank: { drive: 1.1, compliance: 0.44, leak: 0.01 } })],
      mouths: [callMouth(2, 1_180, { opening: 0.72, tongueSize: 0.9, tonguePosition: 0.78, lipSize: 0.18, lipTension: 0.58, cavity: 0.16, leak: 0, slewMs: 2 })],
    }),
  },
  {
    id: "air-clean-low-tone", label: "Rounded low tone", category: "tonal",
    gestureLabel: "rounded low utterance", mediumId: "air", durationSeconds: 2.4,
    lungCount: 2, phonatorIndices: [0], foldCount: 2, mouthIndices: [0], routeCount: 1,
    motionProfile: "short-tone",
    articulation: callArticulation("tone", {
      strike: 0.08, attackMs: 9, releaseMs: 84, prechargeMs: 42, burst: 0.01,
      brightness: 0.14, noise: 0.015,
    }),
    timbre: callTimbre({
      breath: 0.68, breathRateBpm: 18, pressureGain: 1.34, leak: 0.028, valveSlewMs: 6, level: 0.68,
      sources: [callSource(0, 74, { tension: 0.3, closure: 0.58, roughness: 0.025, asymmetry: -0.03, bank: { drive: 0.92, compliance: 0.72, leak: 0.025 } })],
      mouths: [callMouth(0, 96, { opening: 0.62, tongueSize: 0.34, tonguePosition: 0.24, lipSize: 0.9, lipTension: 0.2, cavity: 0.86, slewMs: 4 })],
    }),
  },
  {
    id: "air-clear-reed-tone", label: "Centered reed tone", category: "tonal",
    gestureLabel: "centered reed utterance", mediumId: "air", durationSeconds: 3.2,
    lungCount: 2, phonatorIndices: [1], foldCount: 1, mouthIndices: [1], routeCount: 1,
    motionProfile: "short-tone",
    articulation: callArticulation("tone", {
      strike: 0.12, attackMs: 7, releaseMs: 96, prechargeMs: 34, burst: 0.02,
      brightness: 0.38, noise: 0.02,
    }),
    timbre: callTimbre({
      breath: 0.58, pressureGain: 1.14, crossCoupling: 0.04, leak: 0.04, level: 0.62,
      sources: [callSource(1, 92, { tension: 0.38, closure: 0.62, roughness: 0.02, asymmetry: 0.02, bank: { drive: 0.9, compliance: 0.74, leak: 0.03 } })],
      mouths: [callMouth(1, 350, { opening: 0.54, tongueSize: 0.42, tonguePosition: 0.48, lipSize: 0.48, lipTension: 0.34, cavity: 0.66, slewMs: 10 })],
    }),
  },
  {
    id: "air-unvoiced-puffs", label: "Unvoiced pressure puffs", category: "breath",
    gestureLabel: "dry pressure puffs across one exhale", mediumId: "air", durationSeconds: 4.1,
    lungCount: 3, phonatorIndices: [2], foldCount: 0, mouthIndices: [1], routeCount: 1,
    motionProfile: "pulse-train",
    articulation: callArticulation("puff", {
      strike: 0.38, attackMs: 2, releaseMs: 105, prechargeMs: 16, burst: 0.24,
      pulseRateHz: 3.2, pulseDepth: 0.9, pushPull: 0.42, brightness: 0.24, noise: 0.82,
    }),
    timbre: callTimbre({
      breath: 0.62, breathRateBpm: 52, pressureGain: 1.18, leak: 0.09, valveSlewMs: 5, level: 0.62,
      sources: [callSource(2, 86, { closure: 0.3, roughness: 0.12, bank: { drive: 0.94, compliance: 0.68, leak: 0.08 } })],
      mouths: [callMouth(1, 290, { opening: 0.7, tongueSize: 0.55, tonguePosition: 0.66, lipSize: 0.38, lipTension: 0.28, cavity: 0.48, slewMs: 5 })],
    }),
  },
  {
    id: "air-dual-throb", label: "Dual pressure throb", category: "pulse",
    gestureLabel: "two reservoirs push and pull out of phase", mediumId: "air", durationSeconds: 5.7,
    lungCount: 6, phonatorIndices: [0, 1], foldCount: 4, mouthIndices: [0, 1], routeCount: 3,
    motionProfile: "push-pull",
    articulation: callArticulation("throb", {
      strike: 0.14, attackMs: 14, releaseMs: 170, prechargeMs: 46, burst: 0.04,
      pulseRateHz: 2.7, pulseDepth: 0.82, pushPull: 0.92, brightness: 0.25, noise: 0.08,
    }),
    timbre: callTimbre({
      breath: 0.74, breathRateBpm: 38, pressureGain: 1.34, crossCoupling: 0.54, colonyAmount: 0.18, leak: 0.03, level: 0.66,
      sources: [
        callSource(0, 68, { tension: 0.28, closure: 0.6, roughness: 0.08, bank: { drive: 1, compliance: 0.9, leak: 0.026 } }),
        callSource(1, 62, { tension: 0.34, closure: 0.56, roughness: 0.06, bank: { drive: 0.94, compliance: 0.82, leak: 0.03 } }),
      ],
      mouths: [
        callMouth(0, 104, { opening: 0.66, tonguePosition: 0.22, lipSize: 0.9, lipTension: 0.22, cavity: 0.9, slewMs: 22 }),
        callMouth(1, 330, { opening: 0.6, tonguePosition: 0.5, tongueSize: 0.52, lipSize: 0.46, cavity: 0.7, slewMs: 18 }),
      ],
    }),
  },
  {
    id: "air-crossed-bass-speech", label: "Low source with speech mouth", category: "articulation",
    gestureLabel: "rounded vowel opens into a spoken bend", mediumId: "air", durationSeconds: 7.3,
    lungCount: 5, phonatorIndices: [0, 1], foldCount: 3, mouthIndices: [0, 1], routeCount: 4,
    motionProfile: "mouth-phrase",
    articulation: callArticulation("mouth-call", {
      strike: 0.18, attackMs: 8, releaseMs: 160, prechargeMs: 12, burst: 0.12,
      pulseRateHz: 1.8, pulseDepth: 0.32, pushPull: 0.36, brightness: 0.32, noise: 0.1,
    }),
    timbre: callTimbre({
      breath: 0.62, pressureGain: 1.02, crossCoupling: 0.36, colonyAmount: 0.14, leak: 0.05, valveSlewMs: 14, level: 0.6,
      sources: [
        callSource(0, 72, { tension: 0.3, closure: 0.66, roughness: 0.1, asymmetry: -0.08, bank: { drive: 0.86, compliance: 1.08 } }),
        callSource(1, 78, { tension: 0.42, closure: 0.6, roughness: 0.07, asymmetry: 0.06, bank: { drive: 0.74, compliance: 0.9 } }),
      ],
      mouths: [
        callMouth(0, 108, { opening: 0.68, tongueSize: 0.66, tonguePosition: 0.2, lipSize: 0.92, lipTension: 0.24, cavity: 0.9, slewMs: 20 }),
        callMouth(1, 390, { opening: 0.62, tongueSize: 0.58, tonguePosition: 0.64, lipSize: 0.5, lipTension: 0.48, cavity: 0.62, slewMs: 12 }),
      ],
    }),
  },
  {
    id: "air-many-mouth-freak", label: "Many-mouth rough call", category: "complex",
    gestureLabel: "four sources crowd three changing mouths", mediumId: "air", durationSeconds: 9.1,
    lungCount: 12, phonatorIndices: [0, 1, 2, 3], foldCount: 7, mouthIndices: [0, 1, 2], routeCount: 10,
    motionProfile: "dense",
    articulation: callArticulation("sustained", {
      strike: 0.44, attackMs: 18, releaseMs: 240, prechargeMs: 18, burst: 0.2,
      pulseRateHz: 4.2, pulseDepth: 0.56, pushPull: 0.48, brightness: 0.72, noise: 0.58,
    }),
    timbre: callTimbre({
      breath: 0.8, breathRateBpm: 58, pressureGain: 1.42, crossCoupling: 0.68, colonyAmount: 0.64, leak: 0.034, valveSlewMs: 22, level: 0.62,
      sources: [
        callSource(0, 82, { roughness: 0.52, asymmetry: -0.42 }),
        callSource(1, 104, { roughness: 0.46, asymmetry: 0.36 }),
        callSource(2, 136, { roughness: 0.62, asymmetry: -0.3 }),
        callSource(3, 118, { roughness: 0.48, asymmetry: 0.52 }),
      ],
      mouths: [callMouth(0, 132), callMouth(1, 520), callMouth(2, 1_720)],
    }),
  },

  {
    id: "water-lip-slap", label: "Loaded lip slap", category: "plosive",
    gestureLabel: "loaded lips slap into a resonant body", mediumId: "water", durationSeconds: 1.7,
    lungCount: 1, phonatorIndices: [0], foldCount: 1, mouthIndices: [0], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("lip-pop", {
      strike: 0.94, attackMs: 0.8, releaseMs: 300, prechargeMs: 68, burst: 0.9,
      brightness: 0.2, noise: 0.38,
    }),
    timbre: callTimbre({
      breath: 0.74, pressureGain: 1.72, crossCoupling: 0.22, leak: 0.01, valveSlewMs: 3, level: 0.72,
      sources: [callSource(0, 58, { closure: 0.9, roughness: 0.03, bank: { drive: 1.26, compliance: 0.46, leak: 0.008 } })],
      mouths: [callMouth(0, 82, { opening: 0.88, tongueSize: 0.3, tonguePosition: 0.2, lipSize: 1, lipTension: 0.3, cavity: 0.5, leak: 0, slewMs: 3 })],
    }),
  },
  {
    id: "water-droplet-knock", label: "Small-cavity knock", category: "percussion",
    gestureLabel: "small cavity releases a weighted impact and tail", mediumId: "water", durationSeconds: 1.25,
    lungCount: 1, phonatorIndices: [2], foldCount: 0, mouthIndices: [2], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("impact", {
      strike: 1, attackMs: 0.5, releaseMs: 210, prechargeMs: 42, burst: 0.96,
      brightness: 0.46, noise: 0.42,
    }),
    timbre: callTimbre({
      breath: 0.64, pressureGain: 1.58, leak: 0.008, valveSlewMs: 2, level: 0.7,
      sources: [callSource(2, 112, { closure: 0.88, roughness: 0.02, bank: { drive: 1.18, compliance: 0.38, leak: 0.006 } })],
      mouths: [callMouth(2, 980, { opening: 0.68, tongueSize: 0.72, tonguePosition: 0.72, lipSize: 0.14, lipTension: 0.48, cavity: 0.08, leak: 0, slewMs: 2 })],
    }),
  },
  {
    id: "water-clean-hollow-tone", label: "Low hollow tone", category: "tonal",
    gestureLabel: "low hollow weighted resonance", mediumId: "water", durationSeconds: 2.8,
    lungCount: 2, phonatorIndices: [0], foldCount: 2, mouthIndices: [0], routeCount: 1,
    motionProfile: "short-tone",
    articulation: callArticulation("tone", {
      strike: 0.1, attackMs: 12, releaseMs: 130, prechargeMs: 54, burst: 0.03,
      brightness: 0.1, noise: 0.08,
    }),
    timbre: callTimbre({
      breath: 0.64, breathRateBpm: 14, pressureGain: 1.34, leak: 0.02, valveSlewMs: 16, level: 0.66,
      sources: [callSource(0, 62, { tension: 0.26, closure: 0.6, roughness: 0.035, bank: { drive: 0.98, compliance: 0.8, leak: 0.016 } })],
      mouths: [callMouth(0, 78, { opening: 0.5, tongueSize: 0.4, tonguePosition: 0.16, lipSize: 0.96, lipTension: 0.16, cavity: 1, slewMs: 18 })],
    }),
  },
  {
    id: "water-tongue-plosive", label: "Blunt tongue plosive", category: "plosive",
    gestureLabel: "tongue closure releases a blunt resonant consonant", mediumId: "water", durationSeconds: 2.1,
    lungCount: 2, phonatorIndices: [1], foldCount: 1, mouthIndices: [1], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("plosive", {
      strike: 0.82, attackMs: 1.2, releaseMs: 340, prechargeMs: 72, burst: 0.8,
      brightness: 0.3, noise: 0.3,
    }),
    timbre: callTimbre({
      breath: 0.68, pressureGain: 1.48, leak: 0.016, valveSlewMs: 4, level: 0.66,
      sources: [callSource(1, 68, { tension: 0.3, closure: 0.72, roughness: 0.08, bank: { drive: 1.02, compliance: 0.64, leak: 0.012 } })],
      mouths: [callMouth(1, 320, { opening: 0.76, tongueSize: 0.86, tonguePosition: 0.76, lipSize: 0.4, lipTension: 0.3, cavity: 0.38, leak: 0, slewMs: 4 })],
    }),
  },
  {
    id: "water-bubble-pulses", label: "Soft pressure pulses", category: "pulse",
    gestureLabel: "soft pressure pulses across one exhale", mediumId: "water", durationSeconds: 4.6,
    lungCount: 4, phonatorIndices: [2], foldCount: 0, mouthIndices: [0, 2], routeCount: 2,
    motionProfile: "pulse-train",
    articulation: callArticulation("pulse", {
      strike: 0.36, attackMs: 3, releaseMs: 130, prechargeMs: 22, burst: 0.24,
      pulseRateHz: 3.5, pulseDepth: 0.86, pushPull: 0.48, brightness: 0.22, noise: 0.52,
    }),
    timbre: callTimbre({
      breath: 0.66, breathRateBpm: 48, pressureGain: 1.32, crossCoupling: 0.28, leak: 0.04, valveSlewMs: 8, level: 0.64,
      sources: [callSource(2, 82, { closure: 0.38, roughness: 0.1, bank: { drive: 0.94, compliance: 0.72, leak: 0.032 } })],
      mouths: [
        callMouth(0, 92, { opening: 0.58, tonguePosition: 0.18, lipSize: 0.94, cavity: 0.82, slewMs: 10 }),
        callMouth(2, 860, { opening: 0.44, tongueSize: 0.7, tonguePosition: 0.74, lipTension: 0.42, cavity: 0.12, slewMs: 7 }),
      ],
    }),
  },
  {
    id: "water-dual-push-pull", label: "Dual push-pull", category: "pulse",
    gestureLabel: "paired reservoirs alternately press and recede", mediumId: "water", durationSeconds: 6.2,
    lungCount: 7, phonatorIndices: [0, 1], foldCount: 3, mouthIndices: [0, 1], routeCount: 4,
    motionProfile: "push-pull",
    articulation: callArticulation("throb", {
      strike: 0.2, attackMs: 18, releaseMs: 220, prechargeMs: 66, burst: 0.05,
      pulseRateHz: 2.2, pulseDepth: 0.9, pushPull: 1, brightness: 0.18, noise: 0.18,
    }),
    timbre: callTimbre({
      breath: 0.78, breathRateBpm: 34, pressureGain: 1.56, crossCoupling: 0.66, colonyAmount: 0.12, leak: 0.018, valveSlewMs: 22, level: 0.68,
      sources: [
        callSource(0, 56, { tension: 0.24, closure: 0.62, roughness: 0.07, bank: { drive: 1.06, compliance: 0.94, leak: 0.014 } }),
        callSource(1, 58, { tension: 0.32, closure: 0.58, roughness: 0.06, bank: { drive: 0.98, compliance: 0.84, leak: 0.016 } }),
      ],
      mouths: [callMouth(0, 86, { opening: 0.62, cavity: 0.94, slewMs: 24 }), callMouth(1, 300, { opening: 0.56, tonguePosition: 0.58, cavity: 0.72, slewMs: 20 })],
    }),
  },
  {
    id: "water-mouth-gliss", label: "Descending mouth gliss", category: "articulation",
    gestureLabel: "three cavities exchange a descending vowel", mediumId: "water", durationSeconds: 7.8,
    lungCount: 9, phonatorIndices: [1, 2, 3], foldCount: 5, mouthIndices: [0, 1, 2], routeCount: 6,
    motionProfile: "mouth-phrase",
    articulation: callArticulation("mouth-call", {
      strike: 0.2, attackMs: 16, releaseMs: 260, prechargeMs: 20, burst: 0.08,
      pulseRateHz: 1.4, pulseDepth: 0.4, pushPull: 0.5, brightness: 0.36, noise: 0.22,
    }),
    timbre: callTimbre({
      breath: 0.7, pressureGain: 1.3, crossCoupling: 0.52, colonyAmount: 0.18, leak: 0.032, valveSlewMs: 34, level: 0.62,
      sources: [callSource(1, 64, { roughness: 0.14 }), callSource(2, 102, { roughness: 0.18 }), callSource(3, 74, { roughness: 0.12 })],
      mouths: [
        callMouth(0, 94, { opening: 0.62, tonguePosition: 0.18, cavity: 0.96, slewMs: 30 }),
        callMouth(1, 360, { opening: 0.58, tonguePosition: 0.7, cavity: 0.64, slewMs: 22 }),
        callMouth(2, 1_120, { opening: 0.48, tonguePosition: 0.82, tongueSize: 0.46, cavity: 0.2, slewMs: 16 }),
      ],
    }),
  },
  {
    id: "water-full-pressure-freak", label: "Full-pressure rough call", category: "complex",
    gestureLabel: "all reservoirs load and distort three outlets", mediumId: "water", durationSeconds: 9.7,
    lungCount: 16, phonatorIndices: [0, 1, 2, 3], foldCount: 8, mouthIndices: [0, 1, 2], routeCount: 12,
    motionProfile: "dense",
    articulation: callArticulation("sustained", {
      strike: 0.5, attackMs: 24, releaseMs: 340, prechargeMs: 28, burst: 0.24,
      pulseRateHz: 3.6, pulseDepth: 0.62, pushPull: 0.64, brightness: 0.64, noise: 0.62,
    }),
    timbre: callTimbre({
      breath: 0.84, breathRateBpm: 64, pressureGain: 1.68, crossCoupling: 0.78, colonyAmount: 0.58, leak: 0.016, valveSlewMs: 42, level: 0.66,
      sources: [callSource(0, 76, { roughness: 0.58 }), callSource(1, 92, { roughness: 0.5 }), callSource(2, 128, { roughness: 0.68 }), callSource(3, 108, { roughness: 0.54 })],
      mouths: [callMouth(0, 122), callMouth(1, 480), callMouth(2, 1_580)],
    }),
  },

  {
    id: "pellets-single-click", label: "Single cavity click", category: "percussion",
    gestureLabel: "one hard strike rings through a small tract", mediumId: "pellets", durationSeconds: 1.1,
    lungCount: 1, phonatorIndices: [3], foldCount: 0, mouthIndices: [2], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("impact", {
      strike: 1, attackMs: 0.3, releaseMs: 170, prechargeMs: 26, burst: 1,
      brightness: 0.58, noise: 0.72,
    }),
    timbre: callTimbre({
      breath: 0.5, pressureGain: 1.52, leak: 0.012, valveSlewMs: 2, level: 0.68,
      sources: [callSource(3, 62, { closure: 0.9, roughness: 0.05, bank: { drive: 1.12, compliance: 0.36, leak: 0.008 } })],
      mouths: [callMouth(2, 1_060, { opening: 0.72, tongueSize: 0.78, tonguePosition: 0.82, lipSize: 0.12, lipTension: 0.66, cavity: 0.08, leak: 0, slewMs: 2 })],
    }),
  },
  {
    id: "pellets-lip-pop", label: "Broad lip pop", category: "plosive",
    gestureLabel: "broad lips eject a clustered impulse into a dry tail", mediumId: "pellets", durationSeconds: 1.55,
    lungCount: 1, phonatorIndices: [0], foldCount: 0, mouthIndices: [0], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("lip-pop", {
      strike: 0.92, attackMs: 0.6, releaseMs: 260, prechargeMs: 48, burst: 0.9,
      brightness: 0.24, noise: 0.76,
    }),
    timbre: callTimbre({
      breath: 0.66, pressureGain: 1.72, leak: 0.014, valveSlewMs: 2, level: 0.7,
      sources: [callSource(0, 58, { closure: 0.92, roughness: 0.04, bank: { drive: 1.2, compliance: 0.42, leak: 0.009 } })],
      mouths: [callMouth(0, 84, { opening: 0.86, tongueSize: 0.24, tonguePosition: 0.18, lipSize: 1, lipTension: 0.3, cavity: 0.46, leak: 0, slewMs: 2 })],
    }),
  },
  {
    id: "pellets-dry-knock", label: "Dry tract knock", category: "percussion",
    gestureLabel: "a blocked tract releases one blunt resonant knock", mediumId: "pellets", durationSeconds: 2.2,
    lungCount: 2, phonatorIndices: [2], foldCount: 0, mouthIndices: [1], routeCount: 1,
    motionProfile: "single-release",
    articulation: callArticulation("impact", {
      strike: 0.86, attackMs: 0.8, releaseMs: 300, prechargeMs: 60, burst: 0.84,
      brightness: 0.18, noise: 0.66,
    }),
    timbre: callTimbre({
      breath: 0.68, pressureGain: 1.8, leak: 0.018, valveSlewMs: 3, level: 0.68,
      sources: [callSource(2, 72, { closure: 0.86, roughness: 0.08, bank: { drive: 1.14, compliance: 0.5, leak: 0.012 } })],
      mouths: [callMouth(1, 250, { opening: 0.7, tongueSize: 0.82, tonguePosition: 0.7, lipSize: 0.52, lipTension: 0.22, cavity: 0.3, leak: 0, slewMs: 3 })],
    }),
  },
  {
    id: "pellets-pitched-tap", label: "Pitched dry tap", category: "tonal",
    gestureLabel: "solid resonant note with a dry edge", mediumId: "pellets", durationSeconds: 3.5,
    lungCount: 2, phonatorIndices: [1], foldCount: 1, mouthIndices: [1], routeCount: 1,
    motionProfile: "short-tone",
    articulation: callArticulation("tone", {
      strike: 0.3, attackMs: 3, releaseMs: 120, prechargeMs: 38, burst: 0.18,
      brightness: 0.34, noise: 0.18,
    }),
    timbre: callTimbre({
      breath: 0.62, pressureGain: 1.32, leak: 0.03, valveSlewMs: 7, level: 0.65,
      sources: [callSource(1, 76, { tension: 0.36, closure: 0.64, roughness: 0.06, bank: { drive: 0.92, compliance: 0.65, leak: 0.024 } })],
      mouths: [callMouth(1, 310, { opening: 0.5, tongueSize: 0.48, tonguePosition: 0.52, lipSize: 0.48, lipTension: 0.38, cavity: 0.56, slewMs: 8 })],
    }),
  },
  {
    id: "pellets-soft-rattle", label: "Soft irregular rattle", category: "breath",
    gestureLabel: "low pressure shakes an irregular resonant body", mediumId: "pellets", durationSeconds: 4.3,
    lungCount: 3, phonatorIndices: [0], foldCount: 2, mouthIndices: [0], routeCount: 1,
    motionProfile: "pulse-train",
    articulation: callArticulation("puff", {
      strike: 0.32, attackMs: 4, releaseMs: 145, prechargeMs: 24, burst: 0.18,
      pulseRateHz: 7.5, pulseDepth: 0.56, pushPull: 0.34, brightness: 0.16, noise: 0.58,
    }),
    timbre: callTimbre({
      breath: 0.74, breathRateBpm: 56, pressureGain: 1.72, leak: 0.028, valveSlewMs: 5, level: 0.76,
      sources: [callSource(0, 64, { tension: 0.28, closure: 0.5, roughness: 0.08, bank: { drive: 1.2, compliance: 0.5, leak: 0.018 } })],
      mouths: [callMouth(0, 92, { opening: 0.74, tongueSize: 0.3, tonguePosition: 0.22, lipSize: 0.76, lipTension: 0.16, cavity: 0.7, leak: 0.01, slewMs: 6 })],
    }),
  },
  {
    id: "pellets-tongue-ratchet", label: "Tongue ratchet", category: "pulse",
    gestureLabel: "tongue constriction meters a ratcheted exhale", mediumId: "pellets", durationSeconds: 5.2,
    lungCount: 5, phonatorIndices: [2, 3], foldCount: 2, mouthIndices: [2], routeCount: 2,
    motionProfile: "pulse-train",
    articulation: callArticulation("tongue-click", {
      strike: 0.58, attackMs: 1.5, releaseMs: 110, prechargeMs: 30, burst: 0.48,
      pulseRateHz: 9, pulseDepth: 0.88, pushPull: 0.28, brightness: 0.54, noise: 0.62,
    }),
    timbre: callTimbre({
      breath: 0.62, breathRateBpm: 68, pressureGain: 1.34, crossCoupling: 0.22, colonyAmount: 0.42, leak: 0.048, valveSlewMs: 5, level: 0.62,
      sources: [callSource(2, 96, { roughness: 0.24 }), callSource(3, 72, { roughness: 0.18 })],
      mouths: [callMouth(2, 1_240, { opening: 0.48, tongueSize: 0.92, tonguePosition: 0.86, lipSize: 0.16, lipTension: 0.68, cavity: 0.12, slewMs: 4 })],
    }),
  },
  {
    id: "pellets-mouth-transfer", label: "Three-mouth transfer", category: "articulation",
    gestureLabel: "attacks move between three cavities", mediumId: "pellets", durationSeconds: 7,
    lungCount: 8, phonatorIndices: [0, 1, 2], foldCount: 4, mouthIndices: [0, 1, 2], routeCount: 6,
    motionProfile: "mouth-phrase",
    articulation: callArticulation("mouth-call", {
      strike: 0.32, attackMs: 8, releaseMs: 210, prechargeMs: 18, burst: 0.18,
      pulseRateHz: 4.6, pulseDepth: 0.58, pushPull: 0.56, brightness: 0.42, noise: 0.54,
    }),
    timbre: callTimbre({
      breath: 0.68, breathRateBpm: 54, pressureGain: 1.38, crossCoupling: 0.46, colonyAmount: 0.54, leak: 0.04, valveSlewMs: 16, level: 0.62,
      sources: [callSource(0, 66, { roughness: 0.22 }), callSource(1, 72, { roughness: 0.2 }), callSource(2, 108, { roughness: 0.28 })],
      mouths: [callMouth(0, 102, { opening: 0.62 }), callMouth(1, 360, { opening: 0.58, tonguePosition: 0.68 }), callMouth(2, 1_180, { opening: 0.42, tonguePosition: 0.82 })],
    }),
  },
  {
    id: "pellets-swarm-freak", label: "Rough swarm call", category: "complex",
    gestureLabel: "four rough sources jam a crowded route field", mediumId: "pellets", durationSeconds: 8.6,
    lungCount: 14, phonatorIndices: [0, 1, 2, 3], foldCount: 6, mouthIndices: [0, 1, 2], routeCount: 11,
    motionProfile: "dense",
    articulation: callArticulation("sustained", {
      strike: 0.64, attackMs: 12, releaseMs: 260, prechargeMs: 24, burst: 0.36,
      pulseRateHz: 8.5, pulseDepth: 0.72, pushPull: 0.58, brightness: 0.7, noise: 0.82,
    }),
    timbre: callTimbre({
      breath: 0.84, breathRateBpm: 74, pressureGain: 1.78, crossCoupling: 0.62, colonyAmount: 0.82, leak: 0.026, valveSlewMs: 12, level: 0.68,
      sources: [callSource(0, 78, { roughness: 0.66 }), callSource(1, 98, { roughness: 0.58 }), callSource(2, 142, { roughness: 0.74 }), callSource(3, 116, { roughness: 0.62 })],
      mouths: [callMouth(0, 126), callMouth(1, 510), callMouth(2, 1_680)],
    }),
  },
];

const SHARP_CALL_CATEGORIES = new Set(["plosive", "percussion"]);

const roundCallValue = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/**
 * Derive two acoustic siblings from each hand-voiced recipe. These are not
 * randomized at playback: the family index, anatomy, onset, and chamber
 * changes are fixed data, so an id always recreates exactly the same animal.
 */
const deriveCallVariant = (definition, familyIndex, variantIndex) => {
  const baseSharp = SHARP_CALL_CATEGORIES.has(definition.category);
  const decisive = baseSharp || (
    variantIndex === 1 ? familyIndex % 2 === 0 : familyIndex % 2 === 1
  );
  const mediumId = definition.mediumId;
  const pitchFactor = variantIndex === 1
    ? (mediumId === "water" ? 0.84 : mediumId === "pellets" ? 1.16 : 1.07)
    : (mediumId === "water" ? 0.72 : mediumId === "pellets" ? 1.31 : 0.89);
  const chamberFactor = variantIndex === 1
    ? (mediumId === "water" ? 0.78 : mediumId === "pellets" ? 1.18 : 1.04)
    : (mediumId === "water" ? 0.64 : mediumId === "pellets" ? 1.42 : 0.82);
  const durationSeconds = baseSharp
    ? (variantIndex === 1
      ? 3.18 + (familyIndex % 7) * 0.34
      : 6.24 + (familyIndex % 7) * 0.43)
    : (variantIndex === 1
      ? definition.durationSeconds * 0.76 + 0.62
      : definition.durationSeconds * 1.04 + 0.31);
  const sourceRoughnessCeiling = mediumId === "pellets" ? 0.24 : 0.48;
  const sources = definition.timbre.sources.map((source, sourceIndex) => ({
    ...source,
    frequencyHz: roundCallValue(clamp(
      source.frequencyHz * pitchFactor * (1 + sourceIndex * 0.018),
      48,
      148,
      80,
    ), 2),
    tension: clamp(source.tension + (variantIndex === 1 ? 0.09 : -0.075)),
    closure: clamp(source.closure + (decisive ? 0.08 : -0.055)),
    asymmetry: clamp(
      source.asymmetry + (variantIndex === 1 ? 0.12 : -0.14),
      -1,
      1,
      0,
    ),
    roughness: clamp(
      source.roughness * (variantIndex === 1 ? 0.68 : 0.46)
        + (mediumId === "air" ? 0.012 : 0),
      0,
      sourceRoughnessCeiling,
      0.04,
    ),
    bank: {
      ...source.bank,
      drive: clamp(source.bank.drive * (decisive ? 1.12 : 0.92), 0, 1.6, 0.8),
      compliance: clamp(
        source.bank.compliance * (mediumId === "water" ? 1.16 : variantIndex === 2 ? 0.8 : 0.96),
        0.2,
        1.6,
        0.8,
      ),
      leak: clamp(
        source.bank.leak * (mediumId === "air" ? 1.3 : mediumId === "water" ? 0.66 : 0.48),
        0,
        0.25,
        0.03,
      ),
    },
  }));
  const mouths = definition.timbre.mouths.map((mouth, mouthIndex) => ({
    ...mouth,
    resonanceHz: roundCallValue(clamp(
      mouth.resonanceHz * chamberFactor * (1 + mouthIndex * 0.024),
      54,
      2_800,
      320,
    ), 2),
    opening: clamp(mouth.opening + (decisive ? 0.1 : -0.075)),
    tongueSize: clamp(mouth.tongueSize + (variantIndex === 1 ? 0.14 : -0.11)),
    tonguePosition: clamp(mouth.tonguePosition + (variantIndex === 1 ? -0.13 : 0.16)),
    lipSize: clamp(mouth.lipSize + (variantIndex === 1 ? -0.1 : 0.13)),
    lipTension: clamp(mouth.lipTension + (decisive ? 0.14 : -0.09)),
    cavity: clamp(mouth.cavity + (mediumId === "water" ? 0.14 : variantIndex === 2 ? -0.12 : 0.04)),
    slewMs: clamp(
      decisive ? Math.min(mouth.slewMs, 5) : mouth.slewMs * 1.7 + 8,
      2,
      500,
      24,
    ),
  }));
  const baseArticulation = definition.articulation;
  const articulation = {
    ...baseArticulation,
    strike: decisive
      ? Math.max(baseArticulation.strike, variantIndex === 1 ? 0.66 : 0.78)
      : Math.min(baseArticulation.strike, 0.2),
    attackMs: decisive
      ? Math.min(baseArticulation.attackMs, variantIndex === 1 ? 2.8 : 1.5)
      : Math.max(baseArticulation.attackMs, variantIndex === 1 ? 22 : 48),
    prechargeMs: decisive
      ? clamp(Math.max(baseArticulation.prechargeMs, 18), 18, 74, 28)
      : clamp(Math.max(baseArticulation.prechargeMs, 30), 30, 96, 46),
    burst: decisive
      ? Math.max(baseArticulation.burst, variantIndex === 1 ? 0.42 : 0.58)
      : Math.min(baseArticulation.burst, 0.12),
    releaseMs: clamp(
      baseArticulation.releaseMs * (variantIndex === 1 ? 1.08 : 1.32),
      90,
      620,
      180,
    ),
    pulseRateHz: clamp(
      baseArticulation.pulseRateHz * (variantIndex === 1 ? 1.28 : 0.72)
        + (mediumId === "pellets" ? (variantIndex === 1 ? 4.2 : 1.8) : 0),
      0,
      18,
      0,
    ),
    pulseDepth: clamp(baseArticulation.pulseDepth + (variantIndex === 1 ? 0.16 : -0.12)),
    pushPull: clamp(baseArticulation.pushPull + (variantIndex === 2 ? 0.22 : -0.06)),
    brightness: clamp(
      mediumId === "water"
        ? baseArticulation.brightness * 0.52
        : mediumId === "pellets"
          ? 0.32 + baseArticulation.brightness * 0.48
          : baseArticulation.brightness * (variantIndex === 1 ? 1.06 : 0.78),
    ),
    noise: clamp(
      mediumId === "air"
        ? baseArticulation.noise * (variantIndex === 1 ? 1.12 : 0.72)
        : mediumId === "water"
          ? 0.025 + baseArticulation.noise * 0.32
          : 0.36 + baseArticulation.noise * 0.48,
    ),
  };
  const timbre = {
    ...definition.timbre,
    breath: clamp(definition.timbre.breath + (decisive ? 0.09 : -0.045)),
    breathRateBpm: clamp(
      definition.timbre.breathRateBpm * (variantIndex === 1 ? 1.22 : 0.74),
      8,
      180,
      32,
    ),
    pressureGain: clamp(
      definition.timbre.pressureGain
        * (mediumId === "water" ? 1.18 : mediumId === "pellets" ? 1.26 : 0.94)
        * (decisive ? 1.07 : 0.92),
      0.4,
      2,
      1,
    ),
    crossCoupling: clamp(definition.timbre.crossCoupling + (variantIndex === 2 ? 0.24 : -0.06)),
    colonyAmount: clamp(
      definition.timbre.colonyAmount * (variantIndex === 1 ? 0.62 : 1.26),
    ),
    leak: clamp(
      definition.timbre.leak * (mediumId === "air" ? 1.45 : mediumId === "water" ? 0.58 : 0.42),
      0,
      0.35,
      0.04,
    ),
    valveSlewMs: clamp(
      decisive ? Math.min(definition.timbre.valveSlewMs, 5) : definition.timbre.valveSlewMs * 1.55,
      2,
      500,
      18,
    ),
    level: clamp(definition.timbre.level + (mediumId === "pellets" ? 0.045 : 0), 0.25, 0.82, 0.64),
    sources,
    mouths,
  };
  const suffix = variantIndex === 1 ? "forked" : "migrating";
  const labelSuffix = variantIndex === 1 ? "forked chamber" : "migrating mouths";
  return {
    ...definition,
    id: `${definition.id}-${suffix}`,
    label: `${definition.label} · ${labelSuffix}`,
    gestureLabel: `${definition.gestureLabel}; ${
      decisive ? "a pressure edge speaks before the body" : "the body gathers without a hard edge"
    }`,
    durationSeconds: roundCallValue(clamp(durationSeconds, 1.02, 9.96, 4), 2),
    articulation,
    timbre,
    familyId: definition.id,
    variantId: suffix,
    variantIndex,
    onsetProfile: decisive ? "decisive" : "soft",
  };
};

const baseCallsWithMetadata = BASE_CALL_RECIPE_DEFINITIONS.map((definition) => ({
  ...definition,
  familyId: definition.id,
  variantId: "original",
  variantIndex: 0,
  onsetProfile: SHARP_CALL_CATEGORIES.has(definition.category)
    || definition.articulation.strike >= 0.48
    || definition.articulation.burst >= 0.5
    ? "decisive"
    : "soft",
}));

const expandedCallDefinitions = [
  ...baseCallsWithMetadata,
  ...BASE_CALL_RECIPE_DEFINITIONS.flatMap((definition, familyIndex) => [
    deriveCallVariant(definition, familyIndex, 1),
    deriveCallVariant(definition, familyIndex, 2),
  ]),
];

// Preserve the hand-curated original durations and resolve derived collisions
// by hundredths of a second. Sharing a duration therefore identifies one call
// unambiguously while the atlas still spans terse noises through long phrases.
const usedCallDurations = new Set();
const reserveCallDuration = (requested) => {
  const start = Math.round(clamp(requested, 1.02, 9.96, 4) * 100);
  for (let radius = 0; radius < 900; radius += 1) {
    for (const candidate of radius === 0 ? [start] : [start + radius, start - radius]) {
      if (candidate < 102 || candidate > 996 || usedCallDurations.has(candidate)) continue;
      usedCallDurations.add(candidate);
      return candidate / 100;
    }
  }
  return 4;
};
const durationResolvedCalls = expandedCallDefinitions.map((definition) => ({
  ...definition,
  durationSeconds: reserveCallDuration(definition.durationSeconds),
}));

// Begin with a small tonal orientation, then alternate flowing and decisive
// entries. Sharp attacks are consequently encountered among long calls rather
// than sequestered in a percussion block.
const curateCallOrder = (definitions) => {
  const tonalOriginals = definitions.filter((definition) => (
    definition.category === "tonal" && definition.variantIndex === 0
  ));
  const used = new Set(tonalOriginals.map(({ id }) => id));
  const decisive = definitions.filter((definition) => (
    !used.has(definition.id) && definition.onsetProfile === "decisive"
  ));
  const flowing = definitions.filter((definition) => (
    !used.has(definition.id) && definition.onsetProfile !== "decisive"
  ));
  const ordered = [...tonalOriginals];
  let decisiveIndex = 0;
  let flowingIndex = 0;
  while (decisiveIndex < decisive.length || flowingIndex < flowing.length) {
    if (flowingIndex < flowing.length) ordered.push(flowing[flowingIndex++]);
    const flowingRemaining = flowing.length - flowingIndex;
    const decisiveRemaining = decisive.length - decisiveIndex;
    const decisiveThisTurn = Math.min(
      2,
      decisiveRemaining,
      Math.max(1, Math.ceil(decisiveRemaining / Math.max(1, flowingRemaining + 1))),
    );
    for (let index = 0; index < decisiveThisTurn; index += 1) {
      ordered.push(decisive[decisiveIndex++]);
    }
  }
  return ordered;
};

const CALL_RECIPE_DEFINITIONS = curateCallOrder(durationResolvedCalls);

export const COLONY_SYRINX_CALLS = deepFreeze(CALL_RECIPE_DEFINITIONS.map((definition) => {
  const { lungCount, foldCount, routeCount, ...recipe } = definition;
  return {
    schemaVersion: 2,
    ...recipe,
    counts: {
      lungs: lungCount,
      phonators: recipe.phonatorIndices.length,
      folds: foldCount,
      mouths: recipe.mouthIndices.length,
      routes: routeCount,
    },
    seed: normalizedSeed(recipe.id),
  };
}));

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

const TRANSIENT_CALL_MODES = new Set([
  "plosive",
  "lip-pop",
  "tongue-click",
  "impact",
]);

const callContourValue = (recipe, laneIndex, pointIndex) => {
  const articulation = recipe.articulation;
  const mode = articulation.mode;
  const phase = pointIndex / Math.max(1, COLONY_SYRINX_CONTOUR_POINT_COUNT - 1);
  const mouthIndex = laneIndex - 3;
  const mouthPhase = phase * TWO_PI + Math.max(0, mouthIndex) * 1.74;
  const attack = smoothstep(0, mode === "tone" ? 0.12 : 0.06, phase);
  const release = 1 - smoothstep(mode === "tone" ? 0.66 : 0.78, 1, phase);
  const body = attack * release;
  const pulseCycles = clamp(
    articulation.pulseRateHz * recipe.durationSeconds,
    1,
    5.5,
    1,
  );
  const pulse = 0.5 + Math.sin(phase * TWO_PI * pulseCycles - Math.PI * 0.5) * 0.5;
  const transientOnset = 1 / (COLONY_SYRINX_CONTOUR_POINT_COUNT - 1);
  const transientReady = pointIndex > 0;
  const transient = transientReady
    ? Math.exp(-(phase - transientOnset) * 7.5)
    : 0;
  const resonantTail = transientReady
    ? Math.exp(-(phase - transientOnset) * 1.7)
    : 0;
  const transientRelease = 1 - smoothstep(0.76, 1, phase);
  const transientBody = (transient * 0.45 + resonantTail * 0.55) * transientRelease;

  if (laneIndex === 0) {
    if (TRANSIENT_CALL_MODES.has(mode)) {
      return clamp((0.18 + (transient * 0.45 + resonantTail * 0.55) * 0.82) * transientRelease);
    }
    if (mode === "tone") return clamp((0.68 + body * 0.32) * release);
    if (mode === "puff" || mode === "pulse") {
      return clamp((0.08 + pulse ** 1.8 * 0.92) * release);
    }
    if (mode === "throb") {
      return clamp((0.12 + pulse * 0.88) * (0.72 + body * 0.28));
    }
    if (mode === "sustained") {
      return clamp((0.38 + Math.sin(phase * TWO_PI * 2.3) * 0.18 + body * 0.42) * release);
    }
    return clamp(body * (mode === "mouth-call" ? 0.9 : 1));
  }

  if (laneIndex === 1) {
    if (TRANSIENT_CALL_MODES.has(mode)) return clamp(0.72 - transient * 0.24);
    if (mode === "tone") return clamp(0.46 + phase * 0.08);
    return clamp(0.5 + Math.sin(phase * TWO_PI * (mode === "sustained" ? 2.1 : 1.15)) * 0.28);
  }

  if (laneIndex === 2) {
    if (TRANSIENT_CALL_MODES.has(mode)) return clamp(0.86 - phase * 0.38);
    if (mode === "mouth-call") return clamp(0.08 + phase * 0.84);
    if (mode === "throb" || mode === "pulse" || mode === "puff") {
      return clamp(0.16 + pulse * 0.72);
    }
    return clamp(0.34 + body * 0.34 + Math.sin(phase * TWO_PI * 0.75) * 0.08);
  }

  if (TRANSIENT_CALL_MODES.has(mode)) {
    if (!recipe.mouthIndices.includes(mouthIndex)) return 0;
    return clamp(transientBody * (0.9 + mouthIndex * 0.04));
  }
  if (mode === "tone") {
    return clamp((0.72 + Math.sin(mouthPhase * 0.35) * 0.035) * release);
  }
  if (mode === "puff" || mode === "pulse") {
    return clamp((0.08 + pulse ** 1.45 * 0.9) * release);
  }
  if (mode === "throb") {
    const opposingPulse = 0.5 + Math.sin(
      phase * TWO_PI * pulseCycles + mouthIndex * Math.PI,
    ) * 0.5;
    return clamp(0.1 + opposingPulse * 0.88);
  }
  if (mode === "mouth-call") {
    return clamp((0.46 + Math.sin(mouthPhase * 1.12) * 0.42) * (0.42 + body * 0.58));
  }
  return clamp((0.42 + Math.sin(mouthPhase * 1.7) * 0.38) * release);
};

const materializeCallContours = (state, recipe) => state.contours.map((contour, laneIndex) => ({
  ...contour,
  points: Array.from(
    { length: COLONY_SYRINX_CONTOUR_POINT_COUNT },
    (_, pointIndex) => callContourValue(recipe, laneIndex, pointIndex),
  ),
  shape: TRANSIENT_CALL_MODES.has(recipe.articulation.mode) ? "linear" : "smooth",
  rate: 1,
  depth: 1,
  muted: false,
  loop: false,
}));

export function colonySyrinxCallById(id) {
  return COLONY_SYRINX_CALLS.find((recipe) => recipe.id === id) ?? null;
}

/** Build one deterministic finite call from explicit articulation and timbre. */
export function createColonySyrinxCallState(reference = 0, fallback = DEFAULT_COLONY_SYRINX_STATE) {
  const requested = typeof reference === "string"
    ? colonySyrinxCallById(reference)
    : COLONY_SYRINX_CALLS[wrap(reference, COLONY_SYRINX_CALL_COUNT)];
  const recipe = requested ?? COLONY_SYRINX_CALLS[0];
  const random = seededRandom(recipe.seed ^ 0x43a11ced);
  const base = sanitizeColonySyrinxState(fallback);
  const phonatorEnabled = maskFromIndices(
    COLONY_SYRINX_PHONATOR_COUNT,
    recipe.phonatorIndices,
  );
  const mouthEnabled = maskFromIndices(COLONY_SYRINX_MOUTH_COUNT, recipe.mouthIndices);
  const routes = callRouteMatrices(recipe, random);
  const { sources, mouths: mouthPatches, ...globalTimbre } = recipe.timbre;
  const phonators = base.phonators.map((phonator) => ({ ...phonator }));
  const banks = base.banks.map((bank) => ({ ...bank }));
  const mouths = base.mouths.map((mouth) => ({ ...mouth }));
  for (const source of sources) {
    const { index, bank, ...phonator } = source;
    phonators[index] = { ...phonators[index], ...phonator };
    banks[index] = { ...banks[index], ...bank };
  }
  for (const mouthPatch of mouthPatches) {
    const { index, ...mouth } = mouthPatch;
    mouths[index] = { ...mouths[index], ...mouth };
  }
  const callState = {
    ...base,
    ...globalTimbre,
    seed: recipe.seed,
    mediumId: recipe.mediumId,
    contourDurationSeconds: recipe.durationSeconds,
    articulation: { ...recipe.articulation },
    lungEnabled: callLungMask(recipe.phonatorIndices, recipe.counts.lungs, random),
    phonatorEnabled,
    foldEnabled: callFoldMask(recipe.phonatorIndices, recipe.counts.folds, random),
    mouthEnabled,
    banks,
    phonators,
    routes: routes.primary,
    alternateRoutes: routes.alternate,
    mouths,
    organLayout: {
      ...base.organLayout,
      seed: recipe.seed,
      lungs: base.organLayout.lungs.map((point) => point.slice()),
      sources: base.organLayout.sources.map((point) => point.slice()),
      mouths: base.organLayout.mouths.map((point) => point.slice()),
    },
  };
  callState.contours = materializeCallContours(callState, recipe);
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
        ? contours.continuousBreath
          * state.pressureGain
          * bank.drive
          * stroke
          * bankExhaleGates[bankIndex]
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
