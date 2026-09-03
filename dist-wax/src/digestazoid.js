/**
 * Digestazoid's control-rate physical model.
 *
 * Quantities are deliberately expressed as normalized bolus-volume units,
 * rather than pretending that a browser synth knows the listener's anatomy.
 * The important invariants are physical: material is conserved while it moves
 * between chambers, gas is compressible, compliant walls lag pressure, and a
 * pressure valve has a lower closing threshold than opening threshold.
 */

const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

const freezeObject = (value) => Object.freeze({ ...value });
const freezeArray = (values) => Object.freeze(values.map((value) => (
  value && typeof value === "object" ? freezeObject(value) : value
)));

export const DIGESTAZOID_MAX_DELTA_SECONDS = 0.1;
export const DIGESTAZOID_AMOUNT_LIMIT = 3;

export const DIGESTAZOID_LIMITS = Object.freeze({
  // Canonical UI/performance controls. The longer physical names below remain
  // accepted migration aliases for model patches and recorded sessions.
  gas: Object.freeze([0, 1.8]),
  liquid: Object.freeze([0, 1.5]),
  sludge: Object.freeze([0, 1.5]),
  bubbleSizeMm: Object.freeze([1, 40]),
  peristalsisRate: Object.freeze([1, 72]),
  gutTension: Object.freeze([0, 1]),
  bodyPulse: Object.freeze([0, 1]),
  upperValve: Object.freeze([0, 1]),
  pyloricValve: Object.freeze([0, 1]),
  lowerValve: Object.freeze([0, 1]),
  outletStretch: Object.freeze([0, 1]),
  turbulence: Object.freeze([0, 1]),
  wetness: Object.freeze([0, 1]),
  bodyResonance: Object.freeze([0, 1]),
  motilityRateBpm: Object.freeze([1, 72]),
  peristalsisDepth: Object.freeze([0, 0.98]),
  peristalsisSharpness: Object.freeze([0.5, 9]),
  stomachCompliance: Object.freeze([0.08, 2.5]),
  intestineCompliance: Object.freeze([0.08, 2.5]),
  colonCompliance: Object.freeze([0.08, 2.5]),
  wallDamping: Object.freeze([0.08, 1]),
  gasProduction: Object.freeze([0, 0.12]),
  bubbleRate: Object.freeze([0, 16]),
  hydration: Object.freeze([0, 1]),
  viscosity: Object.freeze([0, 1]),
  stomachFill: Object.freeze([0.02, 1.45]),
  intestinalFill: Object.freeze([0.02, 1.45]),
  colonFill: Object.freeze([0.02, 1.45]),
  gasLoad: Object.freeze([0, 1.8]),
  esophagealTension: Object.freeze([0, 1.5]),
  pyloricTension: Object.freeze([0, 1.5]),
  ileocecalTension: Object.freeze([0, 1.5]),
  analTension: Object.freeze([0, 1.5]),
  upperRubberiness: Object.freeze([0, 1]),
  lowerRubberiness: Object.freeze([0, 1]),
  upperOutletHz: Object.freeze([55, 520]),
  lowerOutletHz: Object.freeze([70, 680]),
  mouthRadiation: Object.freeze([0, 1]),
  bodyPulseBpm: Object.freeze([30, 180]),
  bodyPulseDepth: Object.freeze([0, 0.3]),
  bodyCoupling: Object.freeze([0, 1]),
  slosh: Object.freeze([0, 1]),
  stereoWidth: Object.freeze([0, 1]),
  level: Object.freeze([0, 0.82]),
  noiseSeed: Object.freeze([1, 0xffff_ffff]),
});

export const DIGESTAZOID_DEFAULTS = Object.freeze({
  presetId: "after-lunch",
  gas: 0.42,
  liquid: 0.58,
  sludge: 0.44,
  bubbleSizeMm: 8,
  peristalsisRate: 9.5,
  gutTension: 0.58,
  bodyPulse: 0.52,
  upperValve: 0.48,
  pyloricValve: 0.64,
  lowerValve: 0.55,
  outletStretch: 0.36,
  turbulence: 0.54,
  listeningMode: "room",
  wetness: 0.54,
  bodyResonance: 0.56,
  performing: false,
  motilityRateBpm: 9.5,
  peristalsisDepth: 0.56,
  peristalsisSharpness: 3.2,
  stomachCompliance: 0.88,
  intestineCompliance: 0.62,
  colonCompliance: 0.52,
  wallDamping: 0.58,
  gasProduction: 0.006,
  bubbleRate: 0.72,
  hydration: 0.54,
  viscosity: 0.52,
  stomachFill: 0.7,
  intestinalFill: 0.48,
  colonFill: 0.58,
  gasLoad: 0.42,
  esophagealTension: 0.78,
  pyloricTension: 0.54,
  ileocecalTension: 0.62,
  analTension: 0.68,
  upperRubberiness: 0.46,
  lowerRubberiness: 0.78,
  upperOutletHz: 131,
  lowerOutletHz: 328,
  mouthRadiation: 0.62,
  bodyPulseBpm: 61,
  bodyPulseDepth: 0.052,
  bodyCoupling: 0.36,
  slosh: 0.48,
  stereoWidth: 0.66,
  level: 0.58,
  noiseSeed: 0x4469675a,
});

const definePreset = ({ settings, ...metadata }) => Object.freeze({
  ...metadata,
  settings: Object.freeze({ ...settings }),
});

export const DIGESTAZOID_PRESETS = Object.freeze([
  definePreset({
    id: "after-lunch",
    label: "Deep Gut",
    color: "#8f5525",
    description: "A pressurized wet abdomen: heavy wall groans, gas slugs, bile wash, and an unstable lower seal.",
    settings: {},
  }),
  definePreset({
    id: "empty-growler",
    label: "Abyssal Hunger",
    color: "#a47724",
    description: "A hollow, contracting cavity with long tectonic rumbles and dry folds scraping past trapped gas.",
    settings: {
      peristalsisRate: 13.5, peristalsisDepth: 0.82,
      liquid: 0.2, sludge: 0.23, gas: 0.32,
      stomachCompliance: 1.18, bubbleSizeMm: 11, turbulence: 0.34,
      bodyResonance: 0.78,
    },
  }),
  definePreset({
    id: "fizzy-belly",
    label: "Septic Simmer",
    color: "#9a8c21",
    description: "A thin, infected-looking broth seethes into dense chains of small rings, ruptures, and wet crackles.",
    settings: {
      gas: 1.08, liquid: 0.75, sludge: 0.24, bubbleSizeMm: 4.5,
      turbulence: 0.9, wetness: 0.78, viscosity: 0.28,
      peristalsisDepth: 0.66, upperValve: 0.62,
    },
  }),
  definePreset({
    id: "sludge-bog",
    label: "Sludge Bog",
    color: "#59602b",
    description: "Yielding muck holds large pockets until they tear free as broad burples and irregular pressure releases.",
    settings: {
      peristalsisRate: 5.4, peristalsisDepth: 0.72,
      liquid: 0.38, sludge: 1.08, wetness: 0.18, viscosity: 0.93,
      gas: 0.74, bubbleSizeMm: 18, turbulence: 0.62,
      gutTension: 0.8, lowerValve: 0.64, outletStretch: 0.28,
    },
  }),
  definePreset({
    id: "rubber-laboratory",
    label: "Gas Bladder",
    color: "#87433b",
    description: "Loose wet membranes chatter, choke, squeal, burp, and rupture under an overcharged gas pocket.",
    settings: {
      gas: 1.28, upperValve: 0.78, lowerValve: 0.82,
      outletStretch: 0.66, turbulence: 0.94, wetness: 0.7,
      bodyResonance: 0.62,
    },
  }),
  definePreset({
    id: "quiet-clinic",
    label: "Cold Stethoscope",
    color: "#687048",
    description: "Restrained motion exposes short internal knocks, fluid ticks, and distant subcutaneous bubbling.",
    settings: {
      peristalsisRate: 7.2, peristalsisDepth: 0.35, gas: 0.24,
      bubbleSizeMm: 6, turbulence: 0.22, bodyPulse: 0.36,
      bodyResonance: 0.28, wetness: 0.3, level: 0.46,
    },
  }),
]);

const presetById = new Map(DIGESTAZOID_PRESETS.map((preset) => [preset.id, preset]));

/**
 * Event measurements used as synthesis constraints, not prerecorded audio.
 * SB/MB/CRS/HS are the four bowel-sound classes used by the medical recording
 * analysis: single burst, multiple burst, continuous random sound, and
 * harmonic sound. SFX profiles preserve measured active windows and F0.
 */
export const DIGESTAZOID_EVENT_PROFILES = Object.freeze({
  SB: Object.freeze({
    id: "SB", label: "short bowel burst", family: "medical",
    durationSeconds: 0.12, durationRangeSeconds: Object.freeze([0.08, 0.18]),
    peakFrequencyHz: 78, bandwidthHz: 74, attackSeconds: 0.009, releaseSeconds: 0.085,
  }),
  MB: Object.freeze({
    id: "MB", label: "multiple bowel burst", family: "medical",
    durationSeconds: 1.45, durationRangeSeconds: Object.freeze([0.9, 2.1]),
    peakFrequencyHz: 50, bandwidthHz: 42, attackSeconds: 0.16, releaseSeconds: 0.62,
  }),
  CRS: Object.freeze({
    id: "CRS", label: "continuous random bowel sound", family: "medical",
    durationSeconds: 0.66, durationRangeSeconds: Object.freeze([0.42, 0.96]),
    peakFrequencyHz: 252, bandwidthHz: 210, attackSeconds: 0.018, releaseSeconds: 0.31,
  }),
  HS: Object.freeze({
    id: "HS", label: "harmonic bowel sound", family: "medical",
    durationSeconds: 0.255, durationRangeSeconds: Object.freeze([0.19, 0.32]),
    peakFrequencyHz: 322, bandwidthHz: 160, attackSeconds: 0.012, releaseSeconds: 0.16,
  }),
  BURP: Object.freeze({
    id: "BURP", label: "pressure burp", family: "reference-sfx",
    durationSeconds: 0.22, activeDurationSeconds: 0.18,
    peakFrequencyHz: 131, bandwidthHz: 420, attackSeconds: 0.008, releaseSeconds: 0.12,
    mouthRadiation: "broadband",
  }),
  WHOOPEE: Object.freeze({
    id: "WHOOPEE", label: "whoopee cushion flutter", family: "reference-sfx",
    durationSeconds: 0.9, activeDurationSeconds: 0.85,
    peakFrequencyHz: 390, fundamentalRangeHz: Object.freeze([328, 453]),
    bandwidthHz: 250, attackSeconds: 0.014, releaseSeconds: 0.2,
  }),
  QUICK_FART: Object.freeze({
    id: "QUICK_FART", label: "quick pressure fart", family: "reference-sfx",
    durationSeconds: 0.28, activeDurationSeconds: 0.22,
    peakFrequencyHz: 297, bandwidthHz: 260, attackSeconds: 0.006, releaseSeconds: 0.17,
  }),
  HEART: Object.freeze({
    id: "HEART", label: "transmitted body pulse", family: "medical",
    durationSeconds: 60 / 61, rateBpm: 61,
    peakFrequencyHz: 26, bandwidthHz: 58, attackSeconds: 0.018, releaseSeconds: 0.18,
  }),
});

const defineGesture = (gesture) => Object.freeze({ ...gesture });

export const DIGESTAZOID_GESTURES = Object.freeze([
  defineGesture({ id: "growl", label: "GROWL", key: "1", durationMs: 1450, target: "stomach", eventProfileId: "MB", description: "Torque the empty stomach wall into a slow subterranean double groan." }),
  defineGesture({ id: "burble", label: "BURBLE", key: "2", durationMs: 660, target: "jejunum", eventProfileId: "SB", description: "Drive a ragged train of gas slugs through wet intestinal slurry." }),
  defineGesture({ id: "bubble", label: "BUBBLE", key: "3", durationMs: 255, target: "duodenum", eventProfileId: "HS", description: "Grow, pinch off, ring, and rupture a gas pocket against the liquid surface." }),
  defineGesture({ id: "slosh", label: "SLOSH", key: "4", durationMs: 660, target: "stomach", eventProfileId: "CRS", description: "Throw bile and bolus across the stomach folds and compliant gut wall." }),
  defineGesture({ id: "burp", label: "BURP", key: "5", durationMs: 220, target: "esophageal", eventProfileId: "BURP", description: "Crack the sour upper valve and shove a rough gas pulse through the throat." }),
  defineGesture({ id: "burple", label: "BURPLE", key: "6", durationMs: 660, target: "stomach", eventProfileId: "CRS", description: "Lift viscous muck and trapped gas into an irregular wet upper release." }),
  defineGesture({ id: "fart", label: "FART", key: "7", durationMs: 280, target: "anal", eventProfileId: "QUICK_FART", description: "Force the charged rectal chamber through a sticking paired membrane." }),
  defineGesture({ id: "long-fart", label: "LONG ONE", key: "8", durationMs: 900, target: "anal", eventProfileId: "WHOOPEE", description: "Overinflate, stretch, and sustain a filthy whoopee-cushion pressure flutter." }),
]);

// Swallow remains a worklet/API gesture for feeding the reservoir, but is not
// one of the page's eight numbered sound pads.
const SWALLOW_GESTURE = defineGesture({
  id: "swallow", label: "SWALLOW", key: "", durationMs: 120,
  target: "esophageal", eventProfileId: "SB",
  description: "Send a small liquid bolus through the upper tract into the stomach.",
});

const gestureById = new Map([
  ...DIGESTAZOID_GESTURES.map((gesture) => [gesture.id, gesture]),
  [SWALLOW_GESTURE.id, SWALLOW_GESTURE],
]);

export const DIGESTAZOID_COMPARTMENTS = freezeArray([
  { id: "stomach", label: "stomach", family: "stomach", capacity: 1.16, x: 0.38, y: 0.27, rx: 0.17, ry: 0.145, phase: 0 },
  { id: "duodenum", label: "duodenum", family: "intestine", capacity: 0.48, x: 0.53, y: 0.38, rx: 0.092, ry: 0.07, phase: 0.13 },
  { id: "jejunum", label: "jejunum", family: "intestine", capacity: 0.62, x: 0.39, y: 0.5, rx: 0.15, ry: 0.085, phase: 0.3 },
  { id: "ileum", label: "ileum", family: "intestine", capacity: 0.58, x: 0.55, y: 0.59, rx: 0.15, ry: 0.08, phase: 0.5 },
  { id: "cecum", label: "cecum", family: "colon", capacity: 0.5, x: 0.69, y: 0.66, rx: 0.085, ry: 0.105, phase: 0.65 },
  { id: "colon", label: "colon", family: "colon", capacity: 0.84, x: 0.51, y: 0.73, rx: 0.205, ry: 0.075, phase: 0.78 },
  { id: "rectum", label: "rectum", family: "colon", capacity: 0.42, x: 0.5, y: 0.865, rx: 0.065, ry: 0.085, phase: 0.92 },
]);

export const DIGESTAZOID_VALVES = freezeArray([
  { id: "esophageal", label: "esophageal valve", upstream: null, downstream: "stomach", outlet: "upper", x: 0.4, y: 0.115 },
  { id: "pyloric", label: "pyloric valve", upstream: "stomach", downstream: "duodenum", x: 0.5, y: 0.35 },
  { id: "ileocecal", label: "ileocecal valve", upstream: "ileum", downstream: "cecum", x: 0.655, y: 0.635 },
  { id: "anal", label: "anal valve", upstream: "rectum", downstream: null, outlet: "lower", x: 0.5, y: 0.965 },
]);

const compartmentById = new Map(DIGESTAZOID_COMPARTMENTS.map((part, index) => [part.id, { ...part, index }]));
const valveById = new Map(DIGESTAZOID_VALVES.map((part) => [part.id, part]));
const validTargets = new Set([
  ...DIGESTAZOID_COMPARTMENTS.map(({ id }) => id),
  ...DIGESTAZOID_VALVES.map(({ id }) => id),
  "upper", "lower", "body",
]);

const TARGET_ALIASES = Object.freeze({
  gasPocket: "stomach",
  upperValve: "esophageal",
  pyloricValve: "pyloric",
  smallIntestine: "jejunum",
  ileocecalValve: "ileocecal",
  lowerValve: "anal",
  outlet: "lower",
});

const normalizeTarget = (target) => {
  const requested = String(target ?? "");
  const normalized = TARGET_ALIASES[requested] ?? requested;
  return validTargets.has(normalized) ? normalized : null;
};

export function digestazoidPreset(id) {
  return presetById.get(String(id ?? "")) ?? DIGESTAZOID_PRESETS[0];
}

export function sanitizeDigestazoidState(source = {}, fallback = DIGESTAZOID_DEFAULTS) {
  const state = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : DIGESTAZOID_DEFAULTS;
  const result = {};
  for (const [key, limits] of Object.entries(DIGESTAZOID_LIMITS)) {
    const defaultValue = DIGESTAZOID_DEFAULTS[key];
    let value = finiteOr(state[key], finiteOr(base[key], defaultValue));
    value = clamp(value, limits[0], limits[1]);
    result[key] = key === "noiseSeed" ? Math.round(value) >>> 0 : value;
  }
  const canonical = (key, alias, limits = DIGESTAZOID_LIMITS[key]) => clamp(
    finiteOr(
      state[key],
      finiteOr(state[alias], finiteOr(base[key], finiteOr(base[alias], DIGESTAZOID_DEFAULTS[key]))),
    ),
    limits[0],
    limits[1],
  );
  // Normalize old physical-control names into the compact names consumed by
  // the page, then derive the physical coefficients used by the solver. This
  // keeps both saved patches and live UI updates round-trippable.
  result.gas = canonical("gas", "gasLoad");
  result.liquid = canonical("liquid", "intestinalFill");
  result.sludge = canonical("sludge", "colonFill");
  result.bubbleSizeMm = canonical("bubbleSizeMm", "bubbleRate");
  result.peristalsisRate = canonical("peristalsisRate", "motilityRateBpm");
  result.gutTension = canonical("gutTension", "wallDamping");
  result.bodyPulse = canonical("bodyPulse", "bodyPulseDepth");
  result.upperValve = canonical("upperValve", "esophagealTension");
  result.pyloricValve = canonical("pyloricValve", "pyloricTension");
  result.lowerValve = canonical("lowerValve", "analTension");
  result.outletStretch = canonical("outletStretch", "lowerRubberiness");
  result.turbulence = canonical("turbulence", "bubbleRate");
  result.wetness = canonical("wetness", "hydration");
  result.bodyResonance = canonical("bodyResonance", "bodyCoupling");

  result.motilityRateBpm = result.peristalsisRate;
  result.gasLoad = result.gas;
  result.hydration = result.wetness;
  result.slosh = result.wetness;
  result.bubbleRate = clamp(
    0.08 + result.turbulence * 5.6 + 18 / Math.max(1, result.bubbleSizeMm) * 0.12,
    ...DIGESTAZOID_LIMITS.bubbleRate,
  );
  result.gasProduction = clamp(result.turbulence * result.gas * 0.018, ...DIGESTAZOID_LIMITS.gasProduction);
  result.stomachFill = clamp((result.liquid + result.sludge) * 0.62, ...DIGESTAZOID_LIMITS.stomachFill);
  result.intestinalFill = clamp((result.liquid * 0.72 + result.sludge * 0.28), ...DIGESTAZOID_LIMITS.intestinalFill);
  result.colonFill = clamp((result.liquid * 0.24 + result.sludge * 0.82), ...DIGESTAZOID_LIMITS.colonFill);
  result.intestineCompliance = clamp(0.22 + (1 - result.gutTension) * 1.18, ...DIGESTAZOID_LIMITS.intestineCompliance);
  result.colonCompliance = clamp(0.16 + (1 - result.gutTension) * 0.92, ...DIGESTAZOID_LIMITS.colonCompliance);
  result.wallDamping = clamp(0.2 + result.gutTension * 0.68, ...DIGESTAZOID_LIMITS.wallDamping);
  // Valve controls describe openness in the UI, while solver tensions are the
  // inverse cracking pressure. Ileocecal tone follows the surrounding gut.
  result.esophagealTension = clamp((1 - result.upperValve) * 1.5, ...DIGESTAZOID_LIMITS.esophagealTension);
  result.pyloricTension = clamp((1 - result.pyloricValve) * 1.5, ...DIGESTAZOID_LIMITS.pyloricTension);
  result.ileocecalTension = clamp(0.32 + result.gutTension * 0.76, ...DIGESTAZOID_LIMITS.ileocecalTension);
  result.analTension = clamp((1 - result.lowerValve) * 1.5, ...DIGESTAZOID_LIMITS.analTension);
  result.upperRubberiness = clamp(0.18 + result.outletStretch * 0.76);
  result.lowerRubberiness = clamp(0.34 + result.outletStretch * 0.66);
  result.upperOutletHz = clamp(94 + result.outletStretch * 194, ...DIGESTAZOID_LIMITS.upperOutletHz);
  result.lowerOutletHz = clamp(254 + result.outletStretch * 206, ...DIGESTAZOID_LIMITS.lowerOutletHz);
  result.mouthRadiation = clamp(0.3 + result.wetness * 0.34 + result.turbulence * 0.28);
  result.bodyPulseDepth = clamp(result.bodyPulse * 0.1, ...DIGESTAZOID_LIMITS.bodyPulseDepth);
  result.bodyCoupling = result.bodyResonance;
  const requestedPreset = state.presetId ?? base.presetId;
  result.presetId = digestazoidPreset(requestedPreset).id;
  const requestedMode = state.listeningMode ?? base.listeningMode;
  result.listeningMode = ["room", "stethoscope", "inside"].includes(requestedMode)
    ? requestedMode : "room";
  result.performing = typeof state.performing === "boolean"
    ? state.performing : typeof base.performing === "boolean" ? base.performing : false;
  return result;
}

export function digestazoidState(presetId = DIGESTAZOID_DEFAULTS.presetId, overrides = {}) {
  if (presetId && typeof presetId === "object") {
    overrides = presetId;
    presetId = overrides.presetId ?? DIGESTAZOID_DEFAULTS.presetId;
  }
  const preset = digestazoidPreset(presetId);
  return sanitizeDigestazoidState({
    ...DIGESTAZOID_DEFAULTS,
    ...preset.settings,
    ...(overrides && typeof overrides === "object" ? overrides : {}),
    presetId: preset.id,
  });
}

export function digestazoidGesture(id, force = 1, target = null) {
  const gesture = gestureById.get(String(id ?? "")) ?? DIGESTAZOID_GESTURES[0];
  return Object.freeze({
    ...gesture,
    force: clamp(finiteOr(force, 1), 0, 1.5),
    target: normalizeTarget(target) ?? gesture.target,
  });
}

function compartmentCompliance(descriptor, configuration) {
  if (descriptor.family === "stomach") return configuration.stomachCompliance;
  if (descriptor.family === "colon") return configuration.colonCompliance;
  return configuration.intestineCompliance;
}

function xorshift32(seed) {
  let value = (finiteOr(seed, DIGESTAZOID_DEFAULTS.noiseSeed) >>> 0) || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function initialAmounts(descriptor, configuration) {
  const fill = descriptor.family === "stomach"
    ? configuration.stomachFill
    : descriptor.family === "colon" ? configuration.colonFill : configuration.intestinalFill;
  const familyGas = descriptor.family === "stomach" ? 0.29 : descriptor.family === "colon" ? 0.21 : 0.24;
  const gas = descriptor.capacity * fill * familyGas * configuration.gasLoad;
  const wetFraction = descriptor.family === "colon" ? 0.33 + configuration.hydration * 0.28 : 0.48 + configuration.hydration * 0.31;
  const nonGas = descriptor.capacity * fill * (1 - familyGas * Math.min(1, configuration.gasLoad));
  return {
    gas: clamp(gas, 0, DIGESTAZOID_AMOUNT_LIMIT),
    liquid: clamp(nonGas * wetFraction, 0, DIGESTAZOID_AMOUNT_LIMIT),
    sludge: clamp(nonGas * (1 - wetFraction), 0, DIGESTAZOID_AMOUNT_LIMIT),
  };
}

function sanitizeCompartment(source, descriptor, configuration) {
  const initial = initialAmounts(descriptor, configuration);
  return {
    id: descriptor.id,
    gas: clamp(finiteOr(source?.gas, initial.gas), 0, DIGESTAZOID_AMOUNT_LIMIT),
    liquid: clamp(finiteOr(source?.liquid, initial.liquid), 0, DIGESTAZOID_AMOUNT_LIMIT),
    sludge: clamp(finiteOr(source?.sludge, initial.sludge), 0, DIGESTAZOID_AMOUNT_LIMIT),
    pressure: clamp(finiteOr(source?.pressure, 0.02), 0, 6),
    wallDisplacement: clamp(finiteOr(source?.wallDisplacement, 0), -1, 2),
    wallVelocity: clamp(finiteOr(source?.wallVelocity, 0), -8, 8),
    constriction: clamp(finiteOr(source?.constriction, 0), 0, 1),
    compression: clamp(finiteOr(source?.compression, 0), 0, 1.5),
  };
}

function initialValve(descriptor) {
  return {
    id: descriptor.id,
    open: false,
    aperture: 0,
    differential: 0,
    flow: 0,
    manualPinch: 0,
    kick: 0,
  };
}

function sanitizeValve(source, descriptor) {
  return {
    id: descriptor.id,
    open: Boolean(source?.open),
    aperture: clamp(finiteOr(source?.aperture, 0)),
    differential: clamp(finiteOr(source?.differential, 0), -6, 6),
    flow: clamp(finiteOr(source?.flow, 0), -4, 4),
    manualPinch: clamp(finiteOr(source?.manualPinch, 0)),
    kick: clamp(finiteOr(source?.kick, 0), 0, 1.5),
  };
}

export function createDigestazoidRuntime(source = {}, seed) {
  const configuration = sanitizeDigestazoidState(source);
  const noiseSeed = Math.round(clamp(
    finiteOr(seed, configuration.noiseSeed),
    DIGESTAZOID_LIMITS.noiseSeed[0],
    DIGESTAZOID_LIMITS.noiseSeed[1],
  )) >>> 0;
  return {
    timeSeconds: 0,
    seed: noiseSeed || 1,
    compartments: DIGESTAZOID_COMPARTMENTS.map((descriptor) => (
      sanitizeCompartment(null, descriptor, configuration)
    )),
    valves: Object.fromEntries(DIGESTAZOID_VALVES.map((descriptor) => [
      descriptor.id,
      initialValve(descriptor),
    ])),
    peristalsis: { phase: 0, strength: 0, leadingCompartmentId: "stomach" },
    bodyPulse: { phase: 0, pressure: 0 },
    slosh: { x: 0, y: 0, energy: 0 },
    outlets: { upperDrive: 0, lowerDrive: 0, upperFlow: 0, lowerFlow: 0 },
    vented: { gas: 0, liquid: 0, sludge: 0 },
    event: null,
    eventSerial: 0,
    bubbleClock: 0,
  };
}

export function sanitizeDigestazoidRuntime(source = {}, configuration = DIGESTAZOID_DEFAULTS) {
  const state = sanitizeDigestazoidState(configuration);
  const fallback = createDigestazoidRuntime(state, source?.seed);
  const sourceCompartments = Array.isArray(source?.compartments) ? source.compartments : [];
  const sourceById = new Map(sourceCompartments.map((part) => [part?.id, part]));
  const valves = {};
  for (const descriptor of DIGESTAZOID_VALVES) {
    valves[descriptor.id] = sanitizeValve(source?.valves?.[descriptor.id], descriptor);
  }
  const eventProfile = DIGESTAZOID_EVENT_PROFILES[source?.event?.profileId];
  const event = eventProfile ? {
    id: String(source.event.id || "natural"),
    profileId: eventProfile.id,
    compartmentId: compartmentById.has(source.event.compartmentId)
      ? source.event.compartmentId : "stomach",
    strength: clamp(finiteOr(source.event.strength, 0.5), 0, 1.5),
    ageSeconds: clamp(finiteOr(source.event.ageSeconds, 0), 0, 20),
    durationSeconds: clamp(
      finiteOr(source.event.durationSeconds, eventProfile.durationSeconds),
      0.02,
      20,
    ),
    serial: Math.max(0, Math.round(finiteOr(source.event.serial, 0))),
  } : null;
  return {
    timeSeconds: clamp(finiteOr(source?.timeSeconds, fallback.timeSeconds), 0, 1e9),
    seed: (Math.round(finiteOr(source?.seed, fallback.seed)) >>> 0) || 1,
    compartments: DIGESTAZOID_COMPARTMENTS.map((descriptor) => sanitizeCompartment(
      sourceById.get(descriptor.id) ?? sourceCompartments[compartmentById.get(descriptor.id).index],
      descriptor,
      state,
    )),
    valves,
    peristalsis: {
      phase: ((finiteOr(source?.peristalsis?.phase, 0) % 1) + 1) % 1,
      strength: clamp(finiteOr(source?.peristalsis?.strength, 0)),
      leadingCompartmentId: compartmentById.has(source?.peristalsis?.leadingCompartmentId)
        ? source.peristalsis.leadingCompartmentId : "stomach",
    },
    bodyPulse: {
      phase: ((finiteOr(source?.bodyPulse?.phase, 0) % 1) + 1) % 1,
      pressure: clamp(finiteOr(source?.bodyPulse?.pressure, 0), 0, 1),
    },
    slosh: {
      x: clamp(finiteOr(source?.slosh?.x, 0), -2, 2),
      y: clamp(finiteOr(source?.slosh?.y, 0), -2, 2),
      energy: clamp(finiteOr(source?.slosh?.energy, 0), 0, 2),
    },
    outlets: {
      upperDrive: clamp(finiteOr(source?.outlets?.upperDrive, 0), 0, 2),
      lowerDrive: clamp(finiteOr(source?.outlets?.lowerDrive, 0), 0, 2),
      upperFlow: clamp(finiteOr(source?.outlets?.upperFlow, 0), 0, 4),
      lowerFlow: clamp(finiteOr(source?.outlets?.lowerFlow, 0), 0, 4),
    },
    vented: {
      gas: clamp(finiteOr(source?.vented?.gas, 0), 0, 1e9),
      liquid: clamp(finiteOr(source?.vented?.liquid, 0), 0, 1e9),
      sludge: clamp(finiteOr(source?.vented?.sludge, 0), 0, 1e9),
    },
    event,
    eventSerial: Math.max(0, Math.round(finiteOr(source?.eventSerial, event?.serial ?? 0))),
    bubbleClock: clamp(finiteOr(source?.bubbleClock, 0), 0, 10),
  };
}

const roundedRectanglePath = (x, y, rx, ry, points = 24) => Object.freeze(
  Array.from({ length: points }, (_, index) => {
    const angle = Math.PI * 2 * index / points;
    const warp = 1 + 0.08 * Math.sin(angle * 3 + x * 11);
    return Object.freeze({ x: x + Math.cos(angle) * rx * warp, y: y + Math.sin(angle) * ry / warp });
  }),
);

/** Return normalized (default) or pixel-scaled anatomy for a canvas layer. */
export function digestiveGeometry(source = DIGESTAZOID_DEFAULTS, width = 1, height = 1) {
  if (typeof source === "number") {
    height = width;
    width = source;
    source = DIGESTAZOID_DEFAULTS;
  }
  const safeWidth = clamp(width, 1e-6, 1e6);
  const safeHeight = clamp(height, 1e-6, 1e6);
  const runtimeById = new Map((Array.isArray(source?.compartments) ? source.compartments : []).map((part) => [part?.id, part]));
  const compartments = DIGESTAZOID_COMPARTMENTS.map((descriptor) => {
    const live = runtimeById.get(descriptor.id);
    const expansion = 1 + clamp(finiteOr(live?.wallDisplacement, 0), -0.5, 1.5) * 0.1;
    const x = descriptor.x * safeWidth;
    const y = descriptor.y * safeHeight;
    const rx = descriptor.rx * safeWidth * expansion;
    const ry = descriptor.ry * safeHeight * expansion;
    return Object.freeze({
      id: descriptor.id,
      label: descriptor.label,
      family: descriptor.family,
      x, y, rx, ry,
      pressure: clamp(finiteOr(live?.pressure, 0), 0, 6),
      fill: clamp((finiteOr(live?.gas, 0) + finiteOr(live?.liquid, 0) + finiteOr(live?.sludge, 0)) / descriptor.capacity, 0, 3),
      constriction: clamp(finiteOr(live?.constriction, 0)),
      path: roundedRectanglePath(x, y, rx, ry),
    });
  });
  const valves = DIGESTAZOID_VALVES.map((descriptor) => Object.freeze({
    ...descriptor,
    x: descriptor.x * safeWidth,
    y: descriptor.y * safeHeight,
    radius: Math.max(6e-3 * Math.min(safeWidth, safeHeight), 0.018 * Math.min(safeWidth, safeHeight)),
    aperture: clamp(finiteOr(source?.valves?.[descriptor.id]?.aperture, 0)),
  }));
  const point = (x, y) => Object.freeze({ x: x * safeWidth, y: y * safeHeight });
  const tracts = Object.freeze([
    Object.freeze({ id: "esophagus", from: "upper", to: "stomach", points: Object.freeze([point(0.47, 0), point(0.42, 0.12), point(0.38, 0.2)]) }),
    Object.freeze({ id: "gastric-outlet", from: "stomach", to: "duodenum", points: Object.freeze([point(0.45, 0.31), point(0.5, 0.35), point(0.54, 0.38)]) }),
    Object.freeze({ id: "small-bowel", from: "duodenum", to: "ileum", points: Object.freeze([point(0.54, 0.4), point(0.36, 0.47), point(0.59, 0.55), point(0.55, 0.61)]) }),
    Object.freeze({ id: "large-bowel", from: "cecum", to: "rectum", points: Object.freeze([point(0.69, 0.66), point(0.72, 0.76), point(0.49, 0.78), point(0.5, 0.93), point(0.5, 1)]) }),
  ]);
  return Object.freeze({ width: safeWidth, height: safeHeight, compartments: Object.freeze(compartments), valves: Object.freeze(valves), tracts });
}

export function interactionTargetAtPoint(x, y, geometryOrState = DIGESTAZOID_DEFAULTS) {
  const geometry = geometryOrState?.compartments?.[0]?.path
    ? geometryOrState
    : digestiveGeometry(geometryOrState);
  const px = finiteOr(x, -1);
  const py = finiteOr(y, -1);
  let nearest = null;
  let nearestScore = Infinity;
  for (const valve of geometry.valves) {
    const distance = Math.hypot(px - valve.x, py - valve.y) / Math.max(1e-9, valve.radius);
    if (distance <= 1.35 && distance < nearestScore) {
      nearest = valve.id;
      nearestScore = distance;
    }
  }
  if (nearest) return nearest;
  for (const part of geometry.compartments) {
    const distance = Math.hypot(
      (px - part.x) / Math.max(1e-9, part.rx),
      (py - part.y) / Math.max(1e-9, part.ry),
    );
    if (distance <= 1.3 && distance < nearestScore) {
      nearest = part.id;
      nearestScore = distance;
    }
  }
  if (py < geometry.height * 0.08) return "upper";
  if (py > geometry.height * 0.94) return "lower";
  return nearest ?? "body";
}

export function mapDigestazoidInteraction(source = {}, geometryOrState = DIGESTAZOID_DEFAULTS) {
  const interaction = source && typeof source === "object" ? source : {};
  const requestedType = interaction.interactionType ?? interaction.kind
    ?? interaction.action ?? interaction.type;
  const actionAlias = requestedType === "knead" ? "drag"
    : requestedType === "stretch" ? "drag"
      : requestedType === "release-all" ? "release"
        : requestedType;
  const type = ["start", "poke", "squeeze", "inflate", "deflate", "drag", "pinch", "release"]
    .includes(actionAlias) ? actionAlias : "poke";
  const x = clamp(finiteOr(interaction.x, 0.5));
  const y = clamp(finiteOr(interaction.y, 0.5));
  const geometry = geometryOrState?.compartments?.[0]?.path
    ? geometryOrState
    : digestiveGeometry(geometryOrState);
  const scaledX = x * geometry.width;
  const scaledY = y * geometry.height;
  const inferred = interactionTargetAtPoint(scaledX, scaledY, geometry);
  const target = requestedType === "release-all"
    ? "body" : normalizeTarget(interaction.target) ?? inferred;
  const force = clamp(finiteOr(interaction.force, 0.5), 0, 1.5);
  const dx = clamp(finiteOr(interaction.dx, finiteOr(interaction.dragX, 0)), -1, 1);
  const dy = clamp(finiteOr(interaction.dy, finiteOr(interaction.dragY, 0)), -1, 1);
  const effects = {
    compression: 0,
    wallImpulse: 0,
    gasDelta: 0,
    liquidDelta: 0,
    sloshX: 0,
    sloshY: 0,
    valvePinch: 0,
    release: false,
    outletDrive: 0,
  };
  if (type === "poke") {
    effects.compression = force * 0.32;
    effects.wallImpulse = force * 1.4;
  } else if (type === "squeeze") {
    effects.compression = force * 0.86;
    effects.wallImpulse = force * 2.2;
  } else if (type === "inflate") {
    effects.gasDelta = force * 0.24;
    effects.wallImpulse = force * 0.5;
  } else if (type === "deflate") {
    effects.gasDelta = -force * 0.28;
  } else if (type === "drag") {
    effects.sloshX = (Math.abs(dx) > 1e-6 ? dx : x - 0.5) * force * 1.4;
    effects.sloshY = (Math.abs(dy) > 1e-6 ? dy : y - 0.5) * force * 1.4;
    effects.wallImpulse = force * 0.38;
    if (requestedType === "stretch") effects.outletDrive = force;
  } else if (type === "pinch") {
    effects.valvePinch = force;
    effects.compression = force * 0.15;
  } else if (type === "release") {
    effects.release = true;
  }
  return Object.freeze({
    type, x, y, force, target, dx, dy,
    effects: Object.freeze(effects),
  });
}

function copyRuntime(runtime, configuration) {
  return sanitizeDigestazoidRuntime(runtime, configuration);
}

function targetCompartmentId(target) {
  if (compartmentById.has(target)) return target;
  if (target === "esophageal" || target === "upper") return "stomach";
  if (target === "pyloric") return "duodenum";
  if (target === "ileocecal") return "cecum";
  if (target === "anal" || target === "lower") return "rectum";
  return "stomach";
}

function startRuntimeEvent(runtime, profileId, compartmentId, strength, id = "event", durationScale = 1) {
  const profile = DIGESTAZOID_EVENT_PROFILES[profileId] ?? DIGESTAZOID_EVENT_PROFILES.SB;
  runtime.eventSerial += 1;
  runtime.event = {
    id,
    profileId: profile.id,
    compartmentId: compartmentById.has(compartmentId) ? compartmentId : "stomach",
    strength: clamp(strength, 0, 1.5),
    ageSeconds: 0,
    durationSeconds: clamp(profile.durationSeconds * durationScale, 0.02, 20),
    serial: runtime.eventSerial,
  };
}

export function applyDigestazoidInteraction(runtime, interaction, configuration = DIGESTAZOID_DEFAULTS) {
  const state = sanitizeDigestazoidState(configuration);
  const next = copyRuntime(runtime, state);
  const mapped = interaction?.effects ? interaction : mapDigestazoidInteraction(interaction, next);
  const target = mapped.target;
  const compartmentId = targetCompartmentId(target);
  const part = next.compartments[compartmentById.get(compartmentId).index];
  const effects = mapped.effects;

  if (effects.release) {
    if (valveById.has(target)) next.valves[target].manualPinch = 0;
    else if (target === "body") {
      for (const chamber of next.compartments) chamber.compression = 0;
      for (const valve of Object.values(next.valves)) valve.manualPinch = 0;
    } else part.compression = 0;
    return next;
  }

  part.compression = clamp(part.compression + effects.compression, 0, 1.5);
  part.wallVelocity = clamp(part.wallVelocity + effects.wallImpulse, -8, 8);
  if (effects.gasDelta >= 0) {
    part.gas = clamp(part.gas + effects.gasDelta, 0, DIGESTAZOID_AMOUNT_LIMIT);
  } else {
    const removed = Math.min(part.gas, -effects.gasDelta);
    part.gas -= removed;
    next.vented.gas += removed;
  }
  if (effects.liquidDelta) part.liquid = clamp(part.liquid + effects.liquidDelta, 0, DIGESTAZOID_AMOUNT_LIMIT);
  next.slosh.x = clamp(next.slosh.x + effects.sloshX, -2, 2);
  next.slosh.y = clamp(next.slosh.y + effects.sloshY, -2, 2);
  const contactEnergy = mapped.type === "drag" ? mapped.force * 0.35
    : ["poke", "squeeze", "inflate"].includes(mapped.type) ? mapped.force * 0.08 : 0;
  next.slosh.energy = clamp(next.slosh.energy
    + Math.hypot(effects.sloshX, effects.sloshY) + contactEnergy, 0, 2);
  if (effects.outletDrive > 0) {
    next.valves.anal.kick = clamp(next.valves.anal.kick + effects.outletDrive * 0.65, 0, 1.5);
    next.outlets.lowerDrive = clamp(next.outlets.lowerDrive + effects.outletDrive, 0, 2);
  }

  if (valveById.has(target)) next.valves[target].manualPinch = clamp(effects.valvePinch);
  if (mapped.type === "pinch" && !valveById.has(target)) {
    const nearestValve = compartmentId === "stomach" ? "pyloric"
      : compartmentId === "rectum" ? "anal"
        : compartmentId === "ileum" || compartmentId === "cecum" ? "ileocecal" : "pyloric";
    next.valves[nearestValve].manualPinch = clamp(effects.valvePinch);
  }

  if (mapped.force > 0.03 && ["poke", "squeeze", "inflate", "drag"].includes(mapped.type)) {
    const profileId = mapped.type === "squeeze" && compartmentId === "stomach" ? "MB"
      : mapped.type === "drag" ? "HS" : mapped.force > 0.9 ? "CRS" : "SB";
    startRuntimeEvent(next, profileId, compartmentId, mapped.force, mapped.type);
  }
  return next;
}

export function applyDigestazoidGesture(runtime, id, force = 1, target = null, configuration = DIGESTAZOID_DEFAULTS) {
  const state = sanitizeDigestazoidState(configuration);
  const next = copyRuntime(runtime, state);
  const gesture = digestazoidGesture(id, force, target);
  const partId = targetCompartmentId(gesture.target);
  const part = next.compartments[compartmentById.get(partId).index];
  const amount = gesture.force;
  let profileId = gesture.eventProfileId;
  let durationScale = 0.82 + amount * 0.28;

  switch (gesture.id) {
    case "growl":
      part.compression = clamp(part.compression + 0.5 * amount, 0, 1.5);
      part.wallVelocity = clamp(part.wallVelocity + 2.4 * amount, -8, 8);
      break;
    case "burble":
      part.gas = clamp(part.gas + 0.08 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      part.wallVelocity = clamp(part.wallVelocity + 1.1 * amount, -8, 8);
      profileId = amount > 1.05 ? "CRS" : "SB";
      break;
    case "bubble":
      part.gas = clamp(part.gas + (0.035 + state.bubbleSizeMm / 500) * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      part.wallVelocity = clamp(part.wallVelocity + 1.5 * amount, -8, 8);
      next.slosh.energy = clamp(next.slosh.energy + 0.24 * amount, 0, 2);
      profileId = "HS";
      break;
    case "burp":
      next.compartments[0].gas = clamp(next.compartments[0].gas + 0.16 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      next.valves.esophageal.kick = clamp(next.valves.esophageal.kick + amount, 0, 1.5);
      next.outlets.upperDrive = clamp(next.outlets.upperDrive + amount * 1.2, 0, 2);
      break;
    case "burple":
      part.gas = clamp(part.gas + 0.1 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      part.sludge = clamp(part.sludge + 0.035 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      part.compression = clamp(part.compression + 0.62 * amount, 0, 1.5);
      next.slosh.energy = clamp(next.slosh.energy + 0.8 * amount, 0, 2);
      next.valves.esophageal.kick = clamp(next.valves.esophageal.kick + amount * 0.72, 0, 1.5);
      next.outlets.upperDrive = clamp(next.outlets.upperDrive + amount * 0.78, 0, 2);
      break;
    case "fart":
      next.compartments.at(-1).gas = clamp(next.compartments.at(-1).gas + 0.2 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      next.valves.anal.kick = clamp(next.valves.anal.kick + amount, 0, 1.5);
      next.outlets.lowerDrive = clamp(next.outlets.lowerDrive + amount * 1.25, 0, 2);
      if (amount > 0.96) {
        profileId = "WHOOPEE";
        durationScale = 0.86 + amount * 0.12;
      }
      break;
    case "long-fart":
      next.compartments.at(-1).gas = clamp(next.compartments.at(-1).gas + 0.28 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      next.valves.anal.kick = clamp(next.valves.anal.kick + amount * 1.25, 0, 1.5);
      next.outlets.lowerDrive = clamp(next.outlets.lowerDrive + amount * 1.5, 0, 2);
      profileId = "WHOOPEE";
      durationScale = 0.94 + amount * 0.08;
      break;
    case "slosh":
      part.liquid = clamp(part.liquid + 0.04 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      next.slosh.x = clamp(next.slosh.x + (next.eventSerial % 2 ? -1 : 1) * amount, -2, 2);
      next.slosh.y = clamp(next.slosh.y + amount * 0.38, -2, 2);
      next.slosh.energy = clamp(next.slosh.energy + 1.1 * amount, 0, 2);
      break;
    case "swallow":
      next.compartments[0].liquid = clamp(next.compartments[0].liquid + 0.12 * amount, 0, DIGESTAZOID_AMOUNT_LIMIT);
      next.compartments[0].wallVelocity = clamp(next.compartments[0].wallVelocity + 0.65 * amount, -8, 8);
      next.valves.esophageal.kick = clamp(next.valves.esophageal.kick + amount * 0.3, 0, 1.5);
      break;
    default:
      break;
  }
  startRuntimeEvent(next, profileId, partId, amount, gesture.id, durationScale);
  return next;
}

function materialTotal(part) {
  return part.gas + part.liquid + part.sludge;
}

function materialPressure(part, descriptor, configuration, pulse) {
  const compliance = compartmentCompliance(descriptor, configuration);
  const constrictedCapacity = descriptor.capacity * clamp(
    1 - part.constriction * 0.43 - part.compression * 0.48 + part.wallDisplacement * compliance * 0.13,
    0.18,
    2.3,
  );
  const occupied = part.liquid + part.sludge * (1.04 + configuration.viscosity * 0.08) + part.gas * 1.16;
  const stretch = Math.max(0, occupied / constrictedCapacity - 0.34);
  const gasCompression = part.gas / Math.max(0.05, constrictedCapacity - Math.min(constrictedCapacity * 0.92, part.liquid + part.sludge));
  return clamp(
    0.012 + stretch * stretch / Math.max(0.06, compliance) + gasCompression * 0.07
      + pulse * (0.55 + descriptor.phase * 0.3) + part.compression * 0.13,
    0,
    6,
  );
}

function moveMaterial(from, to, amount, gasBias = 1) {
  const available = materialTotal(from);
  const transfer = clamp(amount, 0, Math.min(available, 0.24));
  if (transfer <= 0 || available <= 1e-12) return { gas: 0, liquid: 0, sludge: 0, total: 0 };
  const gasWeight = from.gas * gasBias;
  const liquidWeight = from.liquid;
  const sludgeWeight = from.sludge;
  const weighted = gasWeight + liquidWeight + sludgeWeight;
  const gas = Math.min(from.gas, transfer * gasWeight / Math.max(1e-12, weighted));
  const liquid = Math.min(from.liquid, transfer * liquidWeight / Math.max(1e-12, weighted));
  const sludge = Math.min(from.sludge, Math.max(0, transfer - gas - liquid));
  from.gas -= gas;
  from.liquid -= liquid;
  from.sludge -= sludge;
  if (to) {
    to.gas = clamp(to.gas + gas, 0, DIGESTAZOID_AMOUNT_LIMIT);
    to.liquid = clamp(to.liquid + liquid, 0, DIGESTAZOID_AMOUNT_LIMIT);
    to.sludge = clamp(to.sludge + sludge, 0, DIGESTAZOID_AMOUNT_LIMIT);
  }
  return { gas, liquid, sludge, total: gas + liquid + sludge };
}

function valveTone(configuration, id) {
  if (id === "esophageal") return configuration.esophagealTension;
  if (id === "pyloric") return configuration.pyloricTension;
  if (id === "ileocecal") return configuration.ileocecalTension;
  return configuration.analTension;
}

function advanceValve(runtime, descriptor, configuration, deltaSeconds) {
  const valve = runtime.valves[descriptor.id];
  const upstream = descriptor.upstream ? runtime.compartments[compartmentById.get(descriptor.upstream).index] : null;
  const downstream = descriptor.downstream ? runtime.compartments[compartmentById.get(descriptor.downstream).index] : null;
  // Esophageal flow is modelled outward for burping; swallowing is a gesture
  // which adds its bolus explicitly. The other three valves follow anatomy.
  const differential = descriptor.id === "esophageal"
    ? (downstream?.pressure ?? 0) - 0.012
    : (upstream?.pressure ?? 0.012) - (downstream?.pressure ?? 0.012);
  const tone = valveTone(configuration, descriptor.id);
  const pinch = valve.manualPinch;
  const openThreshold = 0.055 + tone * 0.22 + pinch * 0.34 - valve.kick * 0.34;
  const closeThreshold = openThreshold * 0.42 - valve.kick * 0.08;
  if (!valve.open && differential > openThreshold) valve.open = true;
  else if (valve.open && differential < closeThreshold) valve.open = false;
  const targetAperture = valve.open
    ? clamp((differential - closeThreshold) * (2.8 + valve.kick * 2.5) + 0.1, 0, 1) * (1 - pinch * 0.96)
    : 0;
  const apertureAlpha = 1 - Math.exp(-deltaSeconds * (valve.open ? 35 : 22));
  valve.aperture += (targetAperture - valve.aperture) * apertureAlpha;
  valve.differential = clamp(differential, -6, 6);
  const viscosityLoss = 0.32 + (1 - configuration.viscosity) * 0.86;
  valve.flow = valve.aperture * Math.sqrt(Math.max(0, differential)) * viscosityLoss;
  valve.kick *= Math.exp(-deltaSeconds * 7.5);

  const flowAmount = valve.flow * deltaSeconds * (descriptor.outlet ? 0.72 : 0.34);
  let moved;
  if (descriptor.id === "esophageal") moved = moveMaterial(downstream, null, flowAmount, 7.5);
  else moved = moveMaterial(upstream, downstream, flowAmount, descriptor.outlet ? 8 : 1.8);
  if (descriptor.outlet) {
    runtime.vented.gas += moved.gas;
    runtime.vented.liquid += moved.liquid;
    runtime.vented.sludge += moved.sludge;
    if (descriptor.outlet === "upper") {
      runtime.outlets.upperFlow = valve.flow;
      runtime.outlets.upperDrive = clamp(runtime.outlets.upperDrive + moved.gas * 5 + valve.flow * 0.04, 0, 2);
    } else {
      runtime.outlets.lowerFlow = valve.flow;
      runtime.outlets.lowerDrive = clamp(runtime.outlets.lowerDrive + moved.gas * 5 + valve.flow * 0.04, 0, 2);
    }
  }
  return moved;
}

function internalFlow(runtime, fromIndex, toIndex, configuration, deltaSeconds) {
  const from = runtime.compartments[fromIndex];
  const to = runtime.compartments[toIndex];
  const pressureDrive = from.pressure - to.pressure * 0.72;
  const waveDrive = Math.max(0, from.constriction - to.constriction * 0.46);
  const mobility = 0.08 + (1 - configuration.viscosity) * 0.15 + configuration.hydration * 0.04;
  const amount = Math.max(0, pressureDrive * mobility + waveDrive * 0.095) * deltaSeconds;
  return moveMaterial(from, to, amount, 1.15 + waveDrive * 1.8);
}

function chooseNaturalProfile(runtime, strongestFlow, configuration) {
  const gas = runtime.compartments.reduce((sum, part) => sum + part.gas, 0);
  const random = runtime.seed / 0xffff_ffff;
  if (strongestFlow > 0.12 && configuration.viscosity > 0.66) return "CRS";
  if (gas > 1.1 && random > 0.72) return "HS";
  if (runtime.compartments[0].pressure > 0.23 && random < 0.18) return "MB";
  return "SB";
}

function stepOnce(runtime, configuration, deltaSeconds) {
  runtime.timeSeconds += deltaSeconds;
  runtime.seed = xorshift32(runtime.seed);
  runtime.peristalsis.phase = (runtime.peristalsis.phase + configuration.motilityRateBpm / 60 * deltaSeconds) % 1;
  runtime.bodyPulse.phase = (runtime.bodyPulse.phase + configuration.bodyPulseBpm / 60 * deltaSeconds) % 1;
  const cardiacAngle = runtime.bodyPulse.phase * Math.PI * 2;
  const systolic = Math.max(0, Math.sin(cardiacAngle));
  const secondSound = Math.max(0, Math.sin(cardiacAngle - 0.72));
  runtime.bodyPulse.pressure = configuration.bodyPulseDepth * (systolic ** 10 + 0.42 * secondSound ** 18);

  let leading = 0;
  let leadingValue = -1;
  for (let index = 0; index < runtime.compartments.length; index += 1) {
    const descriptor = DIGESTAZOID_COMPARTMENTS[index];
    const part = runtime.compartments[index];
    const phaseDistance = ((runtime.peristalsis.phase - descriptor.phase) % 1 + 1) % 1;
    const wave = Math.max(0, Math.sin(phaseDistance * Math.PI * 2));
    const constrictionTarget = configuration.peristalsisDepth * wave ** configuration.peristalsisSharpness;
    const contractionAlpha = 1 - Math.exp(-deltaSeconds * (constrictionTarget > part.constriction ? 14 : 5.5));
    part.constriction += (constrictionTarget - part.constriction) * contractionAlpha;
    part.compression *= Math.exp(-deltaSeconds * 4.6);

    const compliance = compartmentCompliance(descriptor, configuration);
    const preliminaryPressure = materialPressure(part, descriptor, configuration, runtime.bodyPulse.pressure);
    const wallTarget = clamp(preliminaryPressure * compliance * 0.34, -0.2, 1.5);
    const spring = 18 / Math.max(0.15, compliance);
    const damping = 3.2 + configuration.wallDamping * 8.5;
    part.wallVelocity += (wallTarget - part.wallDisplacement) * spring * deltaSeconds;
    part.wallVelocity *= Math.exp(-damping * deltaSeconds);
    part.wallDisplacement = clamp(part.wallDisplacement + part.wallVelocity * deltaSeconds, -1, 2);
    part.pressure = materialPressure(part, descriptor, configuration, runtime.bodyPulse.pressure);
    if (part.constriction > leadingValue) {
      leadingValue = part.constriction;
      leading = index;
    }
  }
  runtime.peristalsis.strength = clamp(leadingValue);
  runtime.peristalsis.leadingCompartmentId = DIGESTAZOID_COMPARTMENTS[leading].id;

  // Fermentation is slow, but a deliberately wide control permits cartoon
  // inflation while retaining bounded per-step production.
  runtime.compartments[0].gas = clamp(runtime.compartments[0].gas + configuration.gasProduction * deltaSeconds * 0.22, 0, DIGESTAZOID_AMOUNT_LIMIT);
  runtime.compartments[4].gas = clamp(runtime.compartments[4].gas + configuration.gasProduction * deltaSeconds * 0.38, 0, DIGESTAZOID_AMOUNT_LIMIT);
  runtime.compartments[5].gas = clamp(runtime.compartments[5].gas + configuration.gasProduction * deltaSeconds * 0.4, 0, DIGESTAZOID_AMOUNT_LIMIT);

  const moved = [];
  moved.push(advanceValve(runtime, DIGESTAZOID_VALVES[0], configuration, deltaSeconds));
  moved.push(advanceValve(runtime, DIGESTAZOID_VALVES[1], configuration, deltaSeconds));
  moved.push(internalFlow(runtime, 1, 2, configuration, deltaSeconds));
  moved.push(internalFlow(runtime, 2, 3, configuration, deltaSeconds));
  moved.push(advanceValve(runtime, DIGESTAZOID_VALVES[2], configuration, deltaSeconds));
  moved.push(internalFlow(runtime, 4, 5, configuration, deltaSeconds));
  moved.push(internalFlow(runtime, 5, 6, configuration, deltaSeconds));
  moved.push(advanceValve(runtime, DIGESTAZOID_VALVES[3], configuration, deltaSeconds));
  const strongestFlow = moved.reduce((maximum, transfer) => Math.max(maximum, transfer.total), 0) / Math.max(1e-9, deltaSeconds);

  const sloshDecay = Math.exp(-deltaSeconds * (1.4 + configuration.viscosity * 2.2));
  runtime.slosh.x *= sloshDecay;
  runtime.slosh.y *= sloshDecay;
  runtime.slosh.energy *= Math.exp(-deltaSeconds * (0.8 + configuration.viscosity * 1.8));
  runtime.outlets.upperDrive *= Math.exp(-deltaSeconds * (4.2 - configuration.upperRubberiness * 1.5));
  runtime.outlets.lowerDrive *= Math.exp(-deltaSeconds * (3.8 - configuration.lowerRubberiness * 1.6));
  runtime.outlets.upperFlow *= Math.exp(-deltaSeconds * 14);
  runtime.outlets.lowerFlow *= Math.exp(-deltaSeconds * 14);

  if (runtime.event) {
    runtime.event.ageSeconds += deltaSeconds;
    if (runtime.event.ageSeconds >= runtime.event.durationSeconds) runtime.event = null;
  }
  runtime.bubbleClock += deltaSeconds * configuration.bubbleRate
    * (0.12 + strongestFlow * 1.8 + runtime.slosh.energy * 0.24);
  const randomThreshold = 0.82 + (runtime.seed / 0xffff_ffff) * 0.36;
  if (!runtime.event && runtime.bubbleClock >= randomThreshold) {
    runtime.bubbleClock -= randomThreshold;
    const profileId = chooseNaturalProfile(runtime, strongestFlow, configuration);
    const destination = runtime.peristalsis.leadingCompartmentId;
    const strength = clamp(0.24 + strongestFlow * 2.1 + runtime.slosh.energy * 0.18, 0.2, 1.15);
    startRuntimeEvent(runtime, profileId, destination, strength, "natural");
  }
}

export function stepDigestazoid(runtime, configuration = DIGESTAZOID_DEFAULTS, deltaSeconds = 1 / 120, actions = []) {
  const state = sanitizeDigestazoidState(configuration);
  let next = copyRuntime(runtime, state);
  const commands = Array.isArray(actions) ? actions : [actions];
  for (const action of commands) {
    if (!action || typeof action !== "object") continue;
    if (action.type === "gesture") {
      next = applyDigestazoidGesture(next, action.gesture ?? action.id, action.force, action.target, state);
    } else {
      next = applyDigestazoidInteraction(next, action, state);
    }
  }
  const total = clamp(deltaSeconds, 0, DIGESTAZOID_MAX_DELTA_SECONDS);
  const substepCount = Math.max(1, Math.ceil(total / (1 / 240)));
  const step = total / substepCount;
  for (let index = 0; index < substepCount; index += 1) stepOnce(next, state, step);
  return next;
}

export function digestazoidTelemetry(runtime, configuration = DIGESTAZOID_DEFAULTS) {
  const state = sanitizeDigestazoidState(configuration);
  const model = sanitizeDigestazoidRuntime(runtime, state);
  const pressures = {};
  const fills = {};
  let gasTotal = 0;
  let liquidTotal = 0;
  let sludgeTotal = 0;
  for (let index = 0; index < model.compartments.length; index += 1) {
    const descriptor = DIGESTAZOID_COMPARTMENTS[index];
    const part = model.compartments[index];
    pressures[part.id] = part.pressure;
    fills[part.id] = {
      gas: part.gas,
      liquid: part.liquid,
      sludge: part.sludge,
      total: materialTotal(part),
      fraction: clamp(materialTotal(part) / descriptor.capacity, 0, 3),
    };
    gasTotal += part.gas;
    liquidTotal += part.liquid;
    sludgeTotal += part.sludge;
  }
  const valves = Object.fromEntries(DIGESTAZOID_VALVES.map(({ id }) => [id, {
    open: model.valves[id].open,
    aperture: model.valves[id].aperture,
    differential: model.valves[id].differential,
    flow: model.valves[id].flow,
    pinched: model.valves[id].manualPinch,
  }]));
  return {
    timeSeconds: model.timeSeconds,
    pressures,
    fills,
    gas: { total: gasTotal, vented: model.vented.gas },
    liquid: { total: liquidTotal, vented: model.vented.liquid },
    sludge: { total: sludgeTotal, vented: model.vented.sludge },
    valves,
    peristalsis: {
      phase: model.peristalsis.phase,
      strength: model.peristalsis.strength,
      leadingCompartmentId: model.peristalsis.leadingCompartmentId,
      constrictions: Object.fromEntries(model.compartments.map((part) => [part.id, part.constriction])),
    },
    bodyPulse: { ...model.bodyPulse },
    outlets: { ...model.outlets },
    event: model.event ? { ...model.event } : null,
  };
}
