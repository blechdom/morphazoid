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
export const COLONY_SYRINX_LANE_COUNT = COLONY_SYRINX_MOUTH_COUNT;
export const COLONY_SYRINX_ROUTE_COUNT = 12;
export const COLONY_SYRINX_SEQUENCE_LENGTH = 16;
export const COLONY_SYRINX_MAX_PRESSURE = 4;
export const COLONY_SYRINX_MAX_DELTA_SECONDS = 0.25;

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
    label: "Maw / bass exhale",
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

const MAW_RHYTHM = Object.freeze([1, 0, 0, 0, 0.82, 0, 0, 0, 1, 0, 0, 0, 0.7, 0, 0, 0]);
const SPEECH_RHYTHM = Object.freeze([1, 0, 0, 0.82, 0, 0, 0.72, 0, 1, 0, 0, 0.82, 0, 0, 0.72, 0]);
const CLICK_RHYTHM = Object.freeze([1, 0, 0.7, 0.42, 1, 0, 0.7, 0, 1, 0.42, 0.7, 0, 1, 0, 0.7, 0.42]);

export const DEFAULT_COLONY_SYRINX_LANES = deepFreeze([
  { id: "maw", length: 13, rate: 1, muted: false, steps: MAW_RHYTHM },
  { id: "speech", length: 11, rate: 1.5, muted: false, steps: SPEECH_RHYTHM },
  { id: "click", length: 7, rate: 2, muted: false, steps: CLICK_RHYTHM },
]);

const DEFAULT_ROUTE_MASKS = Object.freeze([
  maskForRoutes(0, 4, 8, 9),
  maskForRoutes(2, 5, 11),
  maskForRoutes(1, 7, 8),
  maskForRoutes(2, 4, 11),
  maskForRoutes(3, 6, 10),
  maskForRoutes(2, 5, 8),
  maskForRoutes(1, 4, 10),
  maskForRoutes(2, 8, 11),
  maskForRoutes(0, 6, 7, 11),
  maskForRoutes(2, 5, 8),
  maskForRoutes(1, 4, 7),
  maskForRoutes(2, 8, 10),
  maskForRoutes(3, 6, 10),
  maskForRoutes(2, 5, 11),
  maskForRoutes(1, 7, 8),
  maskForRoutes(2, 5, 8, 11),
]);

export const DEFAULT_COLONY_SYRINX_SEQUENCE = deepFreeze(Array.from(
  { length: COLONY_SYRINX_SEQUENCE_LENGTH },
  (_, index) => ({
    routeMask: DEFAULT_ROUTE_MASKS[index],
    // Kept for compatibility with the original global score. Independent
    // polymetric mouth lanes now supply the default rhythmic gates.
    mouthGates: [1, 1, 1],
    accent: index % 4 === 0 ? 1 : (index % 2 === 0 ? 0.82 : 0.66),
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

export const DEFAULT_COLONY_SYRINX_STATE = deepFreeze({
  mediumId: "air",
  breath: 0.76,
  breathRateBpm: 24,
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
  banks: DEFAULT_BANKS,
  phonators: DEFAULT_PHONATORS,
  routes: DEFAULT_ROUTES,
  mouths: COLONY_SYRINX_MOUTH_ARCHETYPES,
  lanes: DEFAULT_COLONY_SYRINX_LANES,
  sequence: DEFAULT_COLONY_SYRINX_SEQUENCE,
});

const zeroes = (length) => Array(length).fill(0);

export const DEFAULT_COLONY_SYRINX_RUNTIME = deepFreeze({
  timeSeconds: 0,
  stepIndex: 0,
  stepElapsedSeconds: 0,
  laneStepIndices: zeroes(COLONY_SYRINX_LANE_COUNT),
  laneStepElapsedSeconds: zeroes(COLONY_SYRINX_LANE_COUNT),
  laneVelocities: zeroes(COLONY_SYRINX_LANE_COUNT),
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
    mediumId,
    breath: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "breath", ...COLONY_SYRINX_LIMITS.breath),
    breathRateBpm: boundedFrom(value, base, DEFAULT_COLONY_SYRINX_STATE, "breathRateBpm", ...COLONY_SYRINX_LIMITS.breathRateBpm),
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
  result.mouths = Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (_, index) => sanitizeMouth(
    Array.isArray(value.mouths) ? value.mouths[index] : undefined,
    Array.isArray(base.mouths) ? base.mouths[index] : undefined,
    COLONY_SYRINX_MOUTH_ARCHETYPES[index],
  ));
  result.lanes = Array.from({ length: COLONY_SYRINX_LANE_COUNT }, (_, index) => sanitizeLane(
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
    stepIndex: wrap(value.stepIndex ?? base.stepIndex, COLONY_SYRINX_SEQUENCE_LENGTH),
    stepElapsedSeconds: clamp(value.stepElapsedSeconds, 0, 60, clamp(base.stepElapsedSeconds, 0, 60, 0)),
    laneStepIndices: sanitizeVector(
      value.laneStepIndices,
      base.laneStepIndices,
      COLONY_SYRINX_LANE_COUNT,
      0,
      COLONY_SYRINX_SEQUENCE_LENGTH - 1,
    ).map((index) => Math.round(index)),
    laneStepElapsedSeconds: sanitizeVector(
      value.laneStepElapsedSeconds,
      base.laneStepElapsedSeconds,
      COLONY_SYRINX_LANE_COUNT,
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
    lungPressures: sanitizeVector(value.lungPressures, base.lungPressures, COLONY_SYRINX_LUNG_COUNT, 0, COLONY_SYRINX_MAX_PRESSURE),
    reservoirPressures: sanitizeVector(value.reservoirPressures, base.reservoirPressures, COLONY_SYRINX_BANK_COUNT, 0, COLONY_SYRINX_MAX_PRESSURE),
    routeTargets: sanitizeVector(value.routeTargets, base.routeTargets, COLONY_SYRINX_ROUTE_COUNT, 0, 1),
    routeApertures: sanitizeVector(value.routeApertures, base.routeApertures, COLONY_SYRINX_ROUTE_COUNT, 0, 1),
    routeFlows: sanitizeVector(value.routeFlows, base.routeFlows, COLONY_SYRINX_ROUTE_COUNT, 0, 8),
    routeJams: sanitizeVector(value.routeJams, base.routeJams, COLONY_SYRINX_ROUTE_COUNT, 0, 1),
    colonyGates: sanitizeVector(value.colonyGates, base.colonyGates, COLONY_SYRINX_ROUTE_COUNT, 0, 1)
      .map((gate) => (gate >= 0.5 ? 1 : 0)),
    mouthApertures: sanitizeVector(value.mouthApertures, base.mouthApertures, COLONY_SYRINX_MOUTH_COUNT, 0, 1),
    mouthPressures: sanitizeVector(value.mouthPressures, base.mouthPressures, COLONY_SYRINX_MOUTH_COUNT, 0, COLONY_SYRINX_MAX_PRESSURE),
    mouthFlows: sanitizeVector(value.mouthFlows, base.mouthFlows, COLONY_SYRINX_MOUTH_COUNT, 0, 8),
    phonatorLevels: sanitizeVector(value.phonatorLevels, base.phonatorLevels, COLONY_SYRINX_PHONATOR_COUNT, 0, 1),
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
  const mouthOverrides = Array.isArray(options.mouthGates) ? options.mouthGates : [];
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
  const index = clampInteger(laneIndex, 0, COLONY_SYRINX_LANE_COUNT - 1, 0);
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
  for (let laneIndex = 0; laneIndex < COLONY_SYRINX_LANE_COUNT; laneIndex += 1) {
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
  laneVelocities: Object.freeze(runtime.laneVelocities),
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
  const midiSupplied = Array.isArray(options.activeMidiNotes ?? options.midiNotes)
    || (options.activeMidiNotes ?? options.midiNotes) instanceof Set;
  const midiMode = ["add", "replace"].includes(options.midiMode) ? options.midiMode : state.midiMode;
  const autonomousAmount = midiSupplied && midiMode === "replace"
    ? 0
    : clamp(options.colonyAmount, 0, 1, state.colonyAmount);
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
    laneVelocities: previous.laneVelocities.slice(),
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
    phonatorFrequenciesHz: previous.phonatorFrequenciesHz.slice(),
    foldActivities: previous.foldActivities.slice(),
    foldFrequenciesHz: previous.foldFrequenciesHz.slice(),
  };
  let clock = { stepIndex: runtime.stepIndex, stepElapsedSeconds: runtime.stepElapsedSeconds };
  let laneClock = {
    laneStepIndices: runtime.laneStepIndices,
    laneStepElapsedSeconds: runtime.laneStepElapsedSeconds,
  };
  let finalAccent = 1;

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
    const score = evaluateSanitizedStep(state, clock.stepIndex, {
      ...options,
      laneStepIndices: laneClock.laneStepIndices,
    });
    runtime.laneVelocities = score.laneVelocities.slice();
    finalAccent = score.accent;
    runtime.timeSeconds = Math.min(1e9, runtime.timeSeconds + h);

    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      const pressure = runtime.reservoirPressures[route.phonatorIndex];
      const backPressure = runtime.mouthPressures[route.mouthIndex];
      const offset = ((routeIndex * 7) % COLONY_SYRINX_ROUTE_COUNT) / (COLONY_SYRINX_ROUTE_COUNT - 1) - 0.5;
      const openThreshold = 0.42 + offset * 0.22 + backPressure * 0.16;
      const closeThreshold = openThreshold - (0.06 + state.gateHysteresis * 0.2);
      if (pressure >= openThreshold) runtime.colonyGates[routeIndex] = 1;
      else if (pressure <= closeThreshold) runtime.colonyGates[routeIndex] = 0;
      const baseAperture = state.routes[route.phonatorIndex][route.mouthIndex];
      const autonomousTarget = baseAperture * runtime.colonyGates[routeIndex];
      runtime.routeTargets[routeIndex] = clamp(mix(
        score.routeTargets[routeIndex],
        Math.max(score.routeTargets[routeIndex], autonomousTarget),
        autonomousAmount,
      ) * bankExhaleGates[route.phonatorIndex]);
      runtime.routeApertures[routeIndex] += (
        runtime.routeTargets[routeIndex] - runtime.routeApertures[routeIndex]
      ) * timeAlpha(1_000 / state.valveSlewMs, h);
    }

    const mouthAperturesBefore = runtime.mouthApertures.slice();
    for (let mouthIndex = 0; mouthIndex < COLONY_SYRINX_MOUTH_COUNT; mouthIndex += 1) {
      const mouth = state.mouths[mouthIndex];
      const target = mouth.opening * score.mouthGates[mouthIndex];
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
        ? state.breath * state.pressureGain * bank.drive * stroke * finalAccent
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
    const reservoirMean = runtime.reservoirPressures.reduce((sum, pressure) => sum + pressure, 0)
      / COLONY_SYRINX_BANK_COUNT;
    const couplingAlpha = timeAlpha(state.crossCoupling * 2.4, h);
    for (let bankIndex = 0; bankIndex < COLONY_SYRINX_BANK_COUNT; bankIndex += 1) {
      runtime.reservoirPressures[bankIndex] += (
        reservoirMean - runtime.reservoirPressures[bankIndex]
      ) * couplingAlpha;
    }

    const mouthInputVolumes = zeroes(COLONY_SYRINX_MOUTH_COUNT);
    const bankOutputVolumes = zeroes(COLONY_SYRINX_BANK_COUNT);
    runtime.routeFlows.fill(0);
    for (let routeIndex = 0; routeIndex < COLONY_SYRINX_ROUTE_COUNT; routeIndex += 1) {
      const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
      const phonator = state.phonators[route.phonatorIndex];
      const pressureDelta = Math.max(
        0,
        runtime.reservoirPressures[route.phonatorIndex] - runtime.mouthPressures[route.mouthIndex],
      );
      const foldOpening = 0.08 + (1 - phonator.closure) ** 1.45 * 0.92;
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
  runtime.meanPressure = runtime.reservoirPressures.reduce((sum, pressure) => sum + pressure, 0)
    / COLONY_SYRINX_BANK_COUNT;
  runtime.totalFlow = runtime.mouthFlows.reduce((sum, flow) => sum + flow, 0);
  runtime.outputLevel = clamp(runtime.totalFlow * state.level * medium.outputGain * 0.72);

  for (let phonatorIndex = 0; phonatorIndex < COLONY_SYRINX_PHONATOR_COUNT; phonatorIndex += 1) {
    const phonator = state.phonators[phonatorIndex];
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
    const level = clamp(pressureVoicing * closureVoicing * (0.18 + load * 0.82));
    const couplingBend = (runtime.meanPressure - pressure) * state.crossCoupling * 2.4;
    const pressureBend = pressure * (state.mediumId === "air" ? 1.8 : 0.72);
    const semitones = (phonator.tension - 0.5) * 18 + couplingBend + pressureBend;
    const frequency = clamp(phonator.frequencyHz * 2 ** (semitones / 12), 8, 20_000);
    runtime.phonatorLevels[phonatorIndex] = level;
    runtime.phonatorFrequenciesHz[phonatorIndex] = frequency;
    const flutterCents = Math.sin(
      runtime.timeSeconds * (1.7 + phonatorIndex * 0.37) * TWO_PI + phonatorIndex,
    ) * phonator.roughness * 18;
    const detuneCents = phonator.asymmetry * 52 + flutterCents;
    const firstFold = phonatorIndex * 2;
    runtime.foldFrequenciesHz[firstFold] = clamp(frequency * 2 ** (-detuneCents / 1_200), 8, 20_000);
    runtime.foldFrequenciesHz[firstFold + 1] = clamp(frequency * 2 ** (detuneCents / 1_200), 8, 20_000);
    runtime.foldActivities[firstFold] = clamp(level * (1 - phonator.asymmetry * 0.14));
    runtime.foldActivities[firstFold + 1] = clamp(level * (1 + phonator.asymmetry * 0.14));
  }

  return freezeRuntime(runtime);
}

export const advanceColonySyrinx = stepColonySyrinx;
