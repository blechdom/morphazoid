/**
 * Wave Pool: deterministic control-rate water and event model.
 *
 * The gravity wave is intentionally kept below the audio band. It transports
 * energy and schedules paddle, breaker, wall, bubble, and vortex excitations;
 * a worklet turns those excitations into audible pressure fluctuations. This
 * is a compact lumped/free-surface model, not a CFD solver or a material-note
 * lookup table.
 */

const GRAVITY_MPS2 = 9.80665;
const WATER_DENSITY_KG_M3 = 998;
const ATMOSPHERIC_PRESSURE_PA = 101_325;
const WATER_SOUND_SPEED_MPS = 1_480;
const AIR_HEAT_CAPACITY_RATIO = 1.4;
const TWO_PI = Math.PI * 2;
const MAX_DELTA_SECONDS = 0.5;
const MAX_SUBSTEP_SECONDS = 1 / 120;
const MAX_EVENTS_PER_STEP = 96;
const DEFAULT_RANDOM_SEED = 0x77617665;

const finiteOr = (value, fallback = 0) => {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
};

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, fallback)))
);

const clampInteger = (value, minimum, maximum, fallback = minimum) => (
  Math.round(clamp(value, minimum, maximum, fallback))
);

const wrapUnit = (value) => {
  const number = finiteOr(value, 0);
  return ((number % 1) + 1) % 1;
};

const wrapIndex = (value, length) => {
  const integer = Math.trunc(finiteOr(value, 0));
  return ((integer % length) + length) % length;
};

const mix = (from, to, amount) => from + (to - from) * amount;
const timeAlpha = (rate, seconds) => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, seconds));

const smoothstep = (edge0, edge1, value) => {
  const amount = clamp(
    (finiteOr(value) - edge0) / Math.max(1e-12, edge1 - edge0),
    0,
    1,
  );
  return amount * amount * (3 - 2 * amount);
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const sanitizeSeed = (value, fallback = DEFAULT_RANDOM_SEED) => {
  const numeric = finiteOr(value, fallback);
  return (Math.trunc(numeric) >>> 0) || (Math.trunc(fallback) >>> 0) || DEFAULT_RANDOM_SEED;
};

const nextRandomState = (source) => {
  let state = sanitizeSeed(source);
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0 || 1;
};

export const WAVE_POOL_SEQUENCE_LENGTH = 16;
export const WAVE_POOL_LANE_IDS = Object.freeze([
  "paddle",
  "breaker",
  "wall",
  "vortex",
]);

export const WAVE_POOL_LIMITS = deepFreeze({
  tempoBpm: [35, 160],
  swing: [0, 0.35],
  depthM: [0.5, 3],
  waveHeightM: [0.05, 1.2],
  wavePeriodSeconds: [1.5, 8],
  paddleForce: [0, 1],
  paddleCount: [1, 8],
  phaseSpread: [0, 1],
  breaking: [0, 1],
  bubbleDensity: [0, 1],
  // Bubble size is an equivalent spherical radius in millimetres.
  bubbleSize: [0.2, 12],
  splash: [0, 1],
  wallImpact: [0, 1],
  whirlpool: [0, 1],
  aeration: [0, 1],
  damping: [0, 1],
  panelTone: [0, 1],
  machinery: [0, 1],
  widthM: [8, 40],
  level: [0, 0.7],
});

const freezeDefinition = (definition) => deepFreeze({ ...definition });

export const WAVE_POOL_GENERATORS = Object.freeze([
  freezeDefinition({
    id: "piston",
    label: "Piston paddles",
    description: "Rigid paddles displace a repeatable water volume with a firm reversal at each end of travel.",
    displacementGain: 1,
    velocityGain: 1,
    harmonicSkew: 0.18,
    pressureLag: 0.04,
    machineryScale: 0.72,
  }),
  freezeDefinition({
    id: "pneumatic",
    label: "Pneumatic chambers",
    description: "Air chambers load and release more softly, adding pressure lag and a broader crest.",
    displacementGain: 0.86,
    velocityGain: 0.78,
    harmonicSkew: -0.12,
    pressureLag: 0.24,
    machineryScale: 1,
  }),
]);

export const WAVE_POOL_BOUNDARIES = Object.freeze([
  freezeDefinition({
    id: "concrete",
    label: "Concrete basin",
    description: "A massive pool shell with a broad water-pressure return and only a brief, water-loaded structural trace.",
    impedanceRatio: 5.8,
    reflectionCoefficient: 0.82,
    modalRatios: [1, 1.58, 2.31, 3.46],
    damping: 0.34,
    panelCoupling: 0.18,
    brightness: 0.42,
  }),
  freezeDefinition({
    id: "tile-acrylic",
    label: "Tile / acrylic wall",
    description: "A rigid wet face that sharpens spray contact while keeping panel response behind the water impact.",
    impedanceRatio: 3.4,
    reflectionCoefficient: 0.73,
    modalRatios: [1, 1.84, 2.76, 4.12],
    damping: 0.25,
    panelCoupling: 0.4,
    brightness: 0.72,
  }),
  freezeDefinition({
    id: "steel",
    label: "Steel flume",
    description: "A highly reflective flume; water loading keeps its structural color short and subordinate to the wash.",
    impedanceRatio: 11.6,
    reflectionCoefficient: 0.9,
    modalRatios: [1, 1.43, 2.08, 3.17, 4.61],
    damping: 0.14,
    panelCoupling: 0.62,
    brightness: 0.88,
  }),
  freezeDefinition({
    id: "liner",
    label: "Compliant liner",
    description: "A lossy wet membrane that absorbs the hit and leaves a dark, diffuse water return.",
    impedanceRatio: 1.7,
    reflectionCoefficient: 0.38,
    modalRatios: [1, 1.36, 2.04],
    damping: 0.7,
    panelCoupling: 0.28,
    brightness: 0.2,
  }),
]);

export const WAVE_POOL_RECEIVERS = Object.freeze([
  freezeDefinition({
    id: "waterline",
    label: "Waterline listener",
    description: "Favors crest wash, foam, and wet-wall pressure with a diffuse underwater bubble path.",
    directMix: 0.86,
    bubbleMix: 0.46,
    impactMix: 1,
    vortexMix: 0.72,
    machineryMix: 0.42,
    airCoupling: 0.48,
    lowpassHz: 15_000,
  }),
  freezeDefinition({
    id: "underwater",
    label: "Underwater receiver",
    description: "Favors bubble-cloud texture, submerged turbulence, and the water-borne pressure return.",
    directMix: 0.72,
    bubbleMix: 0.74,
    impactMix: 0.9,
    vortexMix: 1,
    machineryMix: 0.32,
    airCoupling: 0.08,
    lowpassHz: 12_500,
  }),
  freezeDefinition({
    id: "deck",
    label: "Pool-deck listener",
    description: "Favors airborne spray and breaker wash while attenuating submerged bubbles and flow.",
    directMix: 0.64,
    bubbleMix: 0.22,
    impactMix: 0.82,
    vortexMix: 0.3,
    machineryMix: 0.48,
    airCoupling: 1,
    lowpassHz: 10_500,
  }),
]);

const generatorById = new Map(WAVE_POOL_GENERATORS.map((definition) => [definition.id, definition]));
const boundaryById = new Map(WAVE_POOL_BOUNDARIES.map((definition) => [definition.id, definition]));
const receiverById = new Map(WAVE_POOL_RECEIVERS.map((definition) => [definition.id, definition]));

export const WAVE_POOL_GENERATOR_LOOKUP = Object.freeze(Object.fromEntries(generatorById));
export const WAVE_POOL_BOUNDARY_LOOKUP = Object.freeze(Object.fromEntries(boundaryById));
export const WAVE_POOL_RECEIVER_LOOKUP = Object.freeze(Object.fromEntries(receiverById));

export function wavePoolGenerator(id, fallbackId = "piston") {
  return generatorById.get(String(id)) ?? generatorById.get(String(fallbackId)) ?? WAVE_POOL_GENERATORS[0];
}

export function wavePoolBoundary(id, fallbackId = "concrete") {
  return boundaryById.get(String(id)) ?? boundaryById.get(String(fallbackId)) ?? WAVE_POOL_BOUNDARIES[0];
}

export function wavePoolReceiver(id, fallbackId = "waterline") {
  return receiverById.get(String(id)) ?? receiverById.get(String(fallbackId)) ?? WAVE_POOL_RECEIVERS[0];
}

const emptyPattern = () => Object.fromEntries(
  WAVE_POOL_LANE_IDS.map((laneId) => [laneId, Array(WAVE_POOL_SEQUENCE_LENGTH).fill(0)]),
);

const patternFromHits = (hits = {}) => {
  const pattern = emptyPattern();
  WAVE_POOL_LANE_IDS.forEach((laneId) => {
    for (const entry of hits[laneId] ?? []) {
      const step = Array.isArray(entry) ? entry[0] : entry;
      const amount = Array.isArray(entry) ? entry[1] : 1;
      pattern[laneId][wrapIndex(step, WAVE_POOL_SEQUENCE_LENGTH)] = clamp(amount);
    }
  });
  return deepFreeze(pattern);
};

const FAMILY_SURGE_PATTERN = patternFromHits({
  paddle: [[0, 1], [4, 0.76], [8, 1], [12, 0.82]],
  breaker: [[2, 0.72], [6, 0.88], [10, 0.74], [14, 0.96]],
  wall: [[7, 0.22], [15, 0.3]],
  vortex: [[0, 0.42], [8, 0.52]],
});

export const WAVE_POOL_PRESETS = Object.freeze([
  freezeDefinition({
    id: "family-surge",
    label: "Family surge",
    description: "Broad piston surges collapse into foam, concrete wash, and a slow aerated whirlpool; structure stays below the water.",
    state: {
      generatorId: "piston", boundaryId: "concrete", receiverId: "waterline",
      tempoBpm: 72, swing: 0.08, depthM: 1.45, waveHeightM: 0.42,
      wavePeriodSeconds: 3.6, paddleForce: 0.68, paddleCount: 4, phaseSpread: 0.08,
      breaking: 0.72, bubbleDensity: 0.52, bubbleSize: 5.2, splash: 0.78,
      wallImpact: 0.18, whirlpool: 0.38, aeration: 0.42, damping: 0.72,
      panelTone: 0.08, machinery: 0.08, widthM: 22, level: 0.3,
      pattern: FAMILY_SURGE_PATTERN,
    },
  }),
  freezeDefinition({
    id: "pneumatic-break",
    label: "Pneumatic break",
    description: "Lagging air chambers build dense foamy crests and spray across a wet tile face.",
    state: {
      generatorId: "pneumatic", boundaryId: "tile-acrylic", receiverId: "waterline",
      tempoBpm: 92, swing: 0.14, depthM: 1.15, waveHeightM: 0.5,
      wavePeriodSeconds: 2.45, paddleForce: 0.78, paddleCount: 6, phaseSpread: 0.24,
      breaking: 0.9, bubbleDensity: 0.78, bubbleSize: 3.4, splash: 0.9,
      wallImpact: 0.2, whirlpool: 0.24, aeration: 0.78, damping: 0.72,
      panelTone: 0.1, machinery: 0.18, widthM: 18, level: 0.28,
      pattern: patternFromHits({
        paddle: [[0, 1], [3, 0.5], [6, 0.78], [8, 0.88], [11, 0.58], [14, 0.82]],
        breaker: [[1, 0.72], [4, 1], [7, 0.64], [9, 0.82], [12, 1], [15, 0.78]],
        wall: [[5, 0.24], [13, 0.32]],
        vortex: [[7, 0.32], [15, 0.42]],
      }),
    },
  }),
  freezeDefinition({
    id: "cross-chop",
    label: "Cross chop",
    description: "Spread piston phases make intersecting crests, torn foam, and irregular water-on-liner wash.",
    state: {
      generatorId: "piston", boundaryId: "liner", receiverId: "waterline",
      tempoBpm: 118, swing: 0.2, depthM: 1.7, waveHeightM: 0.34,
      wavePeriodSeconds: 2.1, paddleForce: 0.74, paddleCount: 7, phaseSpread: 0.78,
      breaking: 0.76, bubbleDensity: 0.62, bubbleSize: 4.2, splash: 0.82,
      wallImpact: 0.24, whirlpool: 0.52, aeration: 0.52, damping: 0.8,
      panelTone: 0.06, machinery: 0.1, widthM: 28, level: 0.27,
      pattern: patternFromHits({
        paddle: [[0, 1], [2, 0.52], [5, 0.78], [7, 0.44], [8, 0.9], [11, 0.7], [13, 0.48]],
        breaker: [[1, 0.48], [4, 0.82], [6, 0.58], [9, 0.72], [12, 0.9], [15, 0.64]],
        wall: [[3, 0.26], [10, 0.32]],
        vortex: [[5, 0.42], [13, 0.58]],
      }),
    },
  }),
  freezeDefinition({
    id: "vortex-hour",
    label: "Vortex hour",
    description: "A deep, slow pool centers submerged flow, aerated drain gulp, and restrained liner returns.",
    state: {
      generatorId: "pneumatic", boundaryId: "liner", receiverId: "underwater",
      tempoBpm: 48, swing: 0.04, depthM: 2.65, waveHeightM: 0.24,
      wavePeriodSeconds: 6.2, paddleForce: 0.38, paddleCount: 2, phaseSpread: 0.46,
      breaking: 0.32, bubbleDensity: 0.72, bubbleSize: 7, splash: 0.28,
      wallImpact: 0.1, whirlpool: 0.96, aeration: 0.8, damping: 0.85,
      panelTone: 0.03, machinery: 0.12, widthM: 34, level: 0.3,
      pattern: patternFromHits({
        paddle: [[0, 0.68], [8, 0.56]],
        breaker: [[6, 0.34], [14, 0.42]],
        wall: [[4, 0.16], [12, 0.2]],
        vortex: [[0, 1], [3, 0.5], [6, 0.68], [8, 0.88], [11, 0.54], [14, 0.72]],
      }),
    },
  }),
  freezeDefinition({
    id: "steel-flume",
    label: "Flume wash",
    description: "Fast shallow surges chatter through a reflective flume while the water-loaded steel remains a secondary color.",
    state: {
      generatorId: "piston", boundaryId: "steel", receiverId: "waterline",
      tempoBpm: 132, swing: 0.1, depthM: 0.82, waveHeightM: 0.31,
      wavePeriodSeconds: 1.72, paddleForce: 0.86, paddleCount: 3, phaseSpread: 0.05,
      breaking: 0.78, bubbleDensity: 0.55, bubbleSize: 3.8, splash: 0.8,
      wallImpact: 0.28, whirlpool: 0.18, aeration: 0.46, damping: 0.72,
      panelTone: 0.12, machinery: 0.12, widthM: 11, level: 0.24,
      pattern: patternFromHits({
        paddle: [[0, 1], [4, 0.72], [6, 0.5], [8, 0.92], [12, 0.78], [14, 0.58]],
        breaker: [[3, 0.4], [7, 0.48], [11, 0.44], [15, 0.52]],
        wall: [[1, 0.24], [5, 0.32], [9, 0.26], [13, 0.36]],
        vortex: [[7, 0.2], [15, 0.24]],
      }),
    },
  }),
]);

const presetById = new Map(WAVE_POOL_PRESETS.map((preset) => [preset.id, preset]));
export const WAVE_POOL_PRESET_LOOKUP = Object.freeze(Object.fromEntries(presetById));

export function wavePoolPreset(id, fallbackId = "family-surge") {
  return presetById.get(String(id)) ?? presetById.get(String(fallbackId)) ?? WAVE_POOL_PRESETS[0];
}

const BASE_DEFAULTS = {
  presetId: "family-surge",
  generatorId: "piston",
  boundaryId: "concrete",
  receiverId: "waterline",
  tempoBpm: 72,
  swing: 0.08,
  sequencerEnabled: true,
  depthM: 1.45,
  waveHeightM: 0.42,
  wavePeriodSeconds: 3.6,
  paddleForce: 0.68,
  paddleCount: 4,
  phaseSpread: 0.08,
  breaking: 0.72,
  bubbleDensity: 0.52,
  bubbleSize: 5.2,
  splash: 0.78,
  wallImpact: 0.18,
  whirlpool: 0.38,
  aeration: 0.42,
  damping: 0.72,
  panelTone: 0.08,
  machinery: 0.08,
  widthM: 22,
  level: 0.3,
  pattern: FAMILY_SURGE_PATTERN,
};

function patternRow(source, laneId, laneIndex) {
  if (Array.isArray(source) || ArrayBuffer.isView(source)) return source[laneIndex];
  if (source && typeof source === "object") return source[laneId];
  return null;
}

function sanitizePattern(source, fallback = FAMILY_SURGE_PATTERN) {
  return Object.fromEntries(WAVE_POOL_LANE_IDS.map((laneId, laneIndex) => {
    const values = patternRow(source, laneId, laneIndex);
    const base = patternRow(fallback, laneId, laneIndex) ?? FAMILY_SURGE_PATTERN[laneId];
    return [laneId, Array.from({ length: WAVE_POOL_SEQUENCE_LENGTH }, (_, step) => (
      clamp(values?.[step], 0, 1, clamp(base?.[step], 0, 1, 0))
    ))];
  }));
}

export function sanitizeWavePoolPattern(source, fallback = FAMILY_SURGE_PATTERN) {
  return deepFreeze(sanitizePattern(source, fallback));
}

function sanitizedState(source = {}, fallback = BASE_DEFAULTS) {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : BASE_DEFAULTS;
  const boundedFallback = (key) => clamp(
    base[key],
    WAVE_POOL_LIMITS[key][0],
    WAVE_POOL_LIMITS[key][1],
    BASE_DEFAULTS[key],
  );
  const preset = wavePoolPreset(value.presetId, base.presetId);
  const generator = wavePoolGenerator(value.generatorId, base.generatorId);
  const boundary = wavePoolBoundary(value.boundaryId, base.boundaryId);
  const receiver = wavePoolReceiver(value.receiverId, base.receiverId);
  const depthM = clamp(
    value.depthM,
    ...WAVE_POOL_LIMITS.depthM,
    clamp(base.depthM, ...WAVE_POOL_LIMITS.depthM, BASE_DEFAULTS.depthM),
  );
  const heightMaximum = Math.min(WAVE_POOL_LIMITS.waveHeightM[1], depthM * 0.78);
  const fallbackHeight = clamp(
    base.waveHeightM,
    WAVE_POOL_LIMITS.waveHeightM[0],
    heightMaximum,
    BASE_DEFAULTS.waveHeightM,
  );
  const state = {
    presetId: preset.id,
    generatorId: generator.id,
    boundaryId: boundary.id,
    receiverId: receiver.id,
    tempoBpm: clamp(value.tempoBpm, ...WAVE_POOL_LIMITS.tempoBpm, boundedFallback("tempoBpm")),
    swing: clamp(value.swing, ...WAVE_POOL_LIMITS.swing, boundedFallback("swing")),
    sequencerEnabled: value.sequencerEnabled == null
      ? Boolean(base.sequencerEnabled ?? true)
      : Boolean(value.sequencerEnabled),
    depthM,
    waveHeightM: clamp(
      value.waveHeightM,
      WAVE_POOL_LIMITS.waveHeightM[0],
      heightMaximum,
      fallbackHeight,
    ),
    wavePeriodSeconds: clamp(
      value.wavePeriodSeconds,
      ...WAVE_POOL_LIMITS.wavePeriodSeconds,
      boundedFallback("wavePeriodSeconds"),
    ),
    paddleForce: clamp(value.paddleForce, ...WAVE_POOL_LIMITS.paddleForce, boundedFallback("paddleForce")),
    paddleCount: clampInteger(value.paddleCount, ...WAVE_POOL_LIMITS.paddleCount, boundedFallback("paddleCount")),
    phaseSpread: clamp(value.phaseSpread, ...WAVE_POOL_LIMITS.phaseSpread, boundedFallback("phaseSpread")),
    breaking: clamp(value.breaking, ...WAVE_POOL_LIMITS.breaking, boundedFallback("breaking")),
    bubbleDensity: clamp(value.bubbleDensity, ...WAVE_POOL_LIMITS.bubbleDensity, boundedFallback("bubbleDensity")),
    bubbleSize: clamp(value.bubbleSize, ...WAVE_POOL_LIMITS.bubbleSize, boundedFallback("bubbleSize")),
    splash: clamp(value.splash, ...WAVE_POOL_LIMITS.splash, boundedFallback("splash")),
    wallImpact: clamp(value.wallImpact, ...WAVE_POOL_LIMITS.wallImpact, boundedFallback("wallImpact")),
    whirlpool: clamp(value.whirlpool, ...WAVE_POOL_LIMITS.whirlpool, boundedFallback("whirlpool")),
    aeration: clamp(value.aeration, ...WAVE_POOL_LIMITS.aeration, boundedFallback("aeration")),
    damping: clamp(value.damping, ...WAVE_POOL_LIMITS.damping, boundedFallback("damping")),
    panelTone: clamp(value.panelTone, ...WAVE_POOL_LIMITS.panelTone, boundedFallback("panelTone")),
    machinery: clamp(value.machinery, ...WAVE_POOL_LIMITS.machinery, boundedFallback("machinery")),
    widthM: clamp(value.widthM, ...WAVE_POOL_LIMITS.widthM, boundedFallback("widthM")),
    level: clamp(value.level, ...WAVE_POOL_LIMITS.level, boundedFallback("level")),
    pattern: sanitizePattern(value.pattern, base.pattern),
  };
  return deepFreeze(state);
}

export const DEFAULT_WAVE_POOL_STATE = sanitizedState(BASE_DEFAULTS, BASE_DEFAULTS);

export function sanitizeWavePoolState(source = {}, fallback = DEFAULT_WAVE_POOL_STATE) {
  return sanitizedState(source, fallback);
}

export function createWavePoolState(presetIdOrOverrides = "family-surge", overrides = {}) {
  const firstIsObject = presetIdOrOverrides && typeof presetIdOrOverrides === "object";
  const patch = firstIsObject ? presetIdOrOverrides : (overrides ?? {});
  const requestedId = firstIsObject ? patch.presetId : presetIdOrOverrides;
  const preset = wavePoolPreset(requestedId);
  return sanitizedState({
    ...BASE_DEFAULTS,
    ...preset.state,
    ...patch,
    presetId: preset.id,
    pattern: patch.pattern ?? preset.state.pattern,
  }, DEFAULT_WAVE_POOL_STATE);
}

/** Long-wave approximation c = sqrt(g h), useful as an upper shallow-water cue. */
export function shallowWaterSpeed(depthM) {
  const depth = clamp(depthM, 0.001, 100, 1);
  return Math.sqrt(GRAVITY_MPS2 * depth);
}

/** Solve omega^2 = g k tanh(k h) for the finite-depth gravity-wave number. */
export function gravityWaveNumber(periodSeconds, depthM) {
  const period = clamp(periodSeconds, 0.05, 120, 3);
  const depth = clamp(depthM, 0.001, 100, 1);
  const omega = TWO_PI / period;
  const deepGuess = omega * omega / GRAVITY_MPS2;
  const shallowGuess = omega / shallowWaterSpeed(depth);
  let waveNumberPerM = Math.max(1e-8, Math.max(deepGuess, shallowGuess));
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const kh = waveNumberPerM * depth;
    const tanh = Math.tanh(kh);
    const sechSquared = 1 - tanh * tanh;
    const functionValue = GRAVITY_MPS2 * waveNumberPerM * tanh - omega * omega;
    const derivative = GRAVITY_MPS2 * (tanh + kh * sechSquared);
    if (!Number.isFinite(derivative) || derivative < 1e-12) break;
    const next = waveNumberPerM - functionValue / derivative;
    waveNumberPerM = Number.isFinite(next) && next > 1e-9
      ? next
      : waveNumberPerM * 0.5;
  }
  return clamp(waveNumberPerM, 1e-8, 1_000, deepGuess);
}

export const waveNumber = gravityWaveNumber;

export function gravityWaveDispersion(periodSeconds, depthM) {
  const period = clamp(periodSeconds, 0.05, 120, 3);
  const waveNumberPerM = gravityWaveNumber(period, depthM);
  const angularFrequency = TWO_PI / period;
  const phaseSpeedMps = angularFrequency / waveNumberPerM;
  return deepFreeze({
    periodSeconds: period,
    frequencyHz: 1 / period,
    angularFrequency,
    waveNumberPerM,
    wavelengthM: TWO_PI / waveNumberPerM,
    phaseSpeedMps,
    shallowWaterSpeedMps: shallowWaterSpeed(depthM),
  });
}

/**
 * Minnaert small-amplitude bubble resonance with hydrostatic pressure. The
 * result is an acoustic bubble mode; it is separate from the sub-audio surface
 * gravity wave that schedules entrainment.
 */
export function bubbleResonanceHz(radiusMm, depthM = 0) {
  const radiusM = clamp(radiusMm, 0.05, 100, 1) * 0.001;
  const depth = clamp(depthM, 0, 100, 0);
  const absolutePressure = ATMOSPHERIC_PRESSURE_PA
    + WATER_DENSITY_KG_M3 * GRAVITY_MPS2 * depth;
  const frequency = 1 / (TWO_PI * radiusM) * Math.sqrt(
    3 * AIR_HEAT_CAPACITY_RATIO * absolutePressure / WATER_DENSITY_KG_M3,
  );
  return clamp(frequency, 20, 96_000, 3_200);
}

export function deriveWavePoolPhysics(source = DEFAULT_WAVE_POOL_STATE) {
  const state = sanitizeWavePoolState(source);
  const generator = wavePoolGenerator(state.generatorId);
  const boundary = wavePoolBoundary(state.boundaryId);
  const receiver = wavePoolReceiver(state.receiverId);
  const dispersion = gravityWaveDispersion(state.wavePeriodSeconds, state.depthM);
  const relativeWaveHeight = state.waveHeightM / state.depthM;
  const steepness = Math.PI * state.waveHeightM / dispersion.wavelengthM;
  const depthBreaking = smoothstep(0.52, 0.78, relativeWaveHeight);
  const steepnessBreaking = smoothstep(0.18, 0.44, steepness);
  const breakSeverity = clamp(
    state.breaking * (0.16 + depthBreaking * 0.54 + steepnessBreaking * 0.54),
  );
  const coherence = clamp(
    1 - state.phaseSpread * (0.3 + (state.paddleCount - 1) / 7 * 0.48),
    0.18,
    1,
  );
  const travelSeconds = state.widthM / dispersion.phaseSpeedMps;
  const acousticReturnMs = 2 * state.widthM / WATER_SOUND_SPEED_MPS * 1_000;
  // This is an effective water-loaded boundary coefficient. Definitions are
  // boundary systems; modal ratios intentionally are not treated as exact notes.
  const reflectionCoefficient = clamp(
    boundary.reflectionCoefficient * (1 - state.damping * 0.46),
    0.05,
    0.98,
  );
  const bubbleRadiusMm = state.bubbleSize;
  const bubbleDepthM = clamp(state.depthM * (0.18 + (1 - state.aeration) * 0.42), 0, state.depthM);
  const bubbleFrequencyHz = bubbleResonanceHz(bubbleRadiusMm, bubbleDepthM);
  return deepFreeze({
    generator,
    boundary,
    receiver,
    generatorId: generator.id,
    boundaryId: boundary.id,
    receiverId: receiver.id,
    gravityWaveFrequencyHz: dispersion.frequencyHz,
    waveFrequencyHz: dispersion.frequencyHz,
    angularFrequency: dispersion.angularFrequency,
    waveNumberPerM: dispersion.waveNumberPerM,
    waveNumber: dispersion.waveNumberPerM,
    shallowWaterSpeedMps: dispersion.shallowWaterSpeedMps,
    waveSpeedMps: dispersion.phaseSpeedMps,
    phaseSpeedMps: dispersion.phaseSpeedMps,
    wavelengthM: dispersion.wavelengthM,
    relativeWaveHeight,
    steepness,
    depthBreaking,
    steepnessBreaking,
    breakSeverity,
    breakingSeverity: breakSeverity,
    paddleCoherence: coherence,
    travelSeconds,
    wallTravelSeconds: travelSeconds,
    acousticReturnMs,
    acousticReturnSeconds: acousticReturnMs / 1_000,
    waterSoundSpeedMps: WATER_SOUND_SPEED_MPS,
    reflectionCoefficient,
    boundaryReflection: reflectionCoefficient,
    bubbleRadiusMm,
    bubbleDepthM,
    bubbleFrequencyHz,
    materialModalRatios: boundary.modalRatios,
    boundaryDamping: boundary.damping,
    receiverLowpassHz: receiver.lowpassHz,
  });
}

function stepDurationForState(state, stepIndex) {
  const straightSixteenth = 15 / state.tempoBpm;
  return straightSixteenth * (
    wrapIndex(stepIndex, 2) === 0 ? 1 + state.swing : 1 - state.swing
  );
}

export function wavePoolStepDurationSeconds(source, stepIndex = 0) {
  return stepDurationForState(sanitizeWavePoolState(source), stepIndex);
}

const ENERGY_KEYS = Object.freeze([
  "paddleEnergy",
  "waveEnergy",
  "breakerEnergy",
  "wallEnergy",
  "bubbleEnergy",
  "vortexEnergy",
  "splashEnergy",
  "machineryEnergy",
  "foam",
]);

const DEFAULT_RUNTIME = deepFreeze({
  timeSeconds: 0,
  generatorPhase: 0,
  wallPhase: 0,
  stepIndex: 0,
  stepElapsedSeconds: 0,
  stepSerial: 0,
  pendingInitialStep: true,
  sequencerWasEnabled: false,
  surfaceDisplacementM: 0,
  surfaceVelocityMps: 0,
  paddleEnergy: 0,
  waveEnergy: 0,
  breakerEnergy: 0,
  wallEnergy: 0,
  bubbleEnergy: 0,
  vortexEnergy: 0,
  splashEnergy: 0,
  machineryEnergy: 0,
  foam: 0,
  randomState: DEFAULT_RANDOM_SEED,
  eventSerial: 0,
  laneValues: [0, 0, 0, 0],
  emissions: {
    paddle: 0,
    breaker: 0,
    wall: 0,
    bubbles: 0,
    vortex: 0,
    splash: 0,
    machinery: 0,
    total: 0,
  },
  events: [],
});

function sanitizedRuntime(source = {}, fallback = DEFAULT_RUNTIME) {
  const value = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_RUNTIME;
  const result = {
    timeSeconds: clamp(value.timeSeconds, 0, 1e12, base.timeSeconds),
    generatorPhase: wrapUnit(finiteOr(value.generatorPhase, base.generatorPhase)),
    wallPhase: wrapUnit(finiteOr(value.wallPhase, base.wallPhase)),
    stepIndex: wrapIndex(finiteOr(value.stepIndex, base.stepIndex), WAVE_POOL_SEQUENCE_LENGTH),
    stepElapsedSeconds: clamp(value.stepElapsedSeconds, 0, 60, base.stepElapsedSeconds),
    stepSerial: clampInteger(value.stepSerial, 0, Number.MAX_SAFE_INTEGER, base.stepSerial),
    pendingInitialStep: value.pendingInitialStep == null
      ? Boolean(base.pendingInitialStep)
      : Boolean(value.pendingInitialStep),
    sequencerWasEnabled: value.sequencerWasEnabled == null
      ? Boolean(base.sequencerWasEnabled)
      : Boolean(value.sequencerWasEnabled),
    surfaceDisplacementM: clamp(value.surfaceDisplacementM, -2, 2, base.surfaceDisplacementM),
    surfaceVelocityMps: clamp(value.surfaceVelocityMps, -12, 12, base.surfaceVelocityMps),
    randomState: sanitizeSeed(value.randomState, base.randomState),
    eventSerial: clampInteger(value.eventSerial, 0, Number.MAX_SAFE_INTEGER, base.eventSerial),
    laneValues: Array.from({ length: WAVE_POOL_LANE_IDS.length }, (_, index) => (
      clamp(value.laneValues?.[index], 0, 1, clamp(base.laneValues?.[index], 0, 1, 0))
    )),
    emissions: {
      paddle: 0,
      breaker: 0,
      wall: 0,
      bubbles: 0,
      vortex: 0,
      splash: 0,
      machinery: 0,
      total: 0,
    },
    events: [],
  };
  for (const key of ENERGY_KEYS) result[key] = clamp(value[key], 0, 1.5, base[key]);
  return result;
}

export function createWavePoolRuntime(overrides = {}) {
  return deepFreeze(sanitizedRuntime(overrides, DEFAULT_RUNTIME));
}

function eventPan(type, serial, randomValue = 0.5) {
  if (type === "paddle" || type === "machinery") return -0.72 + (serial % 5) * 0.1;
  if (type === "wall") return 0.5 + (serial % 4) * 0.12;
  if (type === "vortex") return serial % 2 === 0 ? -0.3 : 0.3;
  return clamp(randomValue * 2 - 1, -0.9, 0.9);
}

/**
 * Advance the persistent pool. Gravity displacement remains sub-audio; only
 * bounded source energies and discrete acoustic events leave this function.
 * The returned frozen runtime carries `emissions`, plus events shaped as
 * { type, energy, timeOffsetSeconds, stepIndex, serial, pan, ...typeDetails }.
 */
export function stepWavePool(
  source = DEFAULT_WAVE_POOL_STATE,
  previousRuntime = DEFAULT_RUNTIME,
  deltaSeconds = 1 / 60,
) {
  const state = sanitizeWavePoolState(source);
  const physics = deriveWavePoolPhysics(state);
  const runtime = sanitizedRuntime(previousRuntime, DEFAULT_RUNTIME);
  const delta = clamp(deltaSeconds, 0, MAX_DELTA_SECONDS, 0);
  const events = [];
  const emissionSums = {
    paddle: 0,
    breaker: 0,
    wall: 0,
    bubbles: 0,
    vortex: 0,
    splash: 0,
    machinery: 0,
  };

  const random = () => {
    runtime.randomState = nextRandomState(runtime.randomState);
    return runtime.randomState / 0x1_0000_0000;
  };

  const emit = (type, energy, timeOffsetSeconds, extra = {}) => {
    const boundedEnergy = clamp(energy, 0, 1.5, 0);
    if (boundedEnergy <= 1e-8) return;
    const emissionKey = type === "bubble" ? "bubbles" : type;
    if (Object.hasOwn(emissionSums, emissionKey)) {
      emissionSums[emissionKey] = clamp(emissionSums[emissionKey] + boundedEnergy, 0, 2);
    }
    const serial = runtime.eventSerial;
    runtime.eventSerial = Math.min(Number.MAX_SAFE_INTEGER, runtime.eventSerial + 1);
    if (events.length >= MAX_EVENTS_PER_STEP) return;
    const randomPan = random();
    events.push({
      type,
      energy: boundedEnergy,
      timeOffsetSeconds: clamp(timeOffsetSeconds, 0, delta, 0),
      stepIndex: runtime.stepIndex,
      serial,
      pan: eventPan(type, serial, randomPan),
      ...extra,
    });
  };

  const fireSequenceStep = (timeOffsetSeconds) => {
    runtime.laneValues = WAVE_POOL_LANE_IDS.map(
      (laneId) => state.pattern[laneId][runtime.stepIndex],
    );
    const [paddle, breaker, wall, vortex] = runtime.laneValues;
    if (paddle > 0) {
      const energy = paddle * state.paddleForce * physics.paddleCoherence;
      runtime.paddleEnergy = clamp(runtime.paddleEnergy + energy * 0.72, 0, 1.5);
      runtime.waveEnergy = clamp(runtime.waveEnergy + energy * 0.36, 0, 1.5);
      runtime.machineryEnergy = clamp(
        runtime.machineryEnergy + energy * state.machinery * 0.38,
        0,
        1.5,
      );
      emit("paddle", energy, timeOffsetSeconds, { generatorId: state.generatorId });
    }
    if (breaker > 0) {
      const energy = breaker * (0.22 + physics.breakSeverity * 0.78) * state.breaking;
      runtime.breakerEnergy = clamp(runtime.breakerEnergy + energy * 0.84, 0, 1.5);
      runtime.splashEnergy = clamp(runtime.splashEnergy + energy * state.splash * 0.8, 0, 1.5);
      runtime.foam = clamp(runtime.foam + energy * (0.28 + state.aeration * 0.56), 0, 1.5);
      emit("breaker", energy, timeOffsetSeconds);
    }
    if (wall > 0) {
      const energy = wall * state.wallImpact * physics.reflectionCoefficient;
      runtime.wallEnergy = clamp(runtime.wallEnergy + energy * 0.86, 0, 1.5);
      runtime.splashEnergy = clamp(runtime.splashEnergy + energy * state.splash * 0.42, 0, 1.5);
      emit("wall", energy, timeOffsetSeconds, { boundaryId: state.boundaryId });
    }
    if (vortex > 0) {
      const energy = vortex * state.whirlpool * (0.62 + state.aeration * 0.28);
      runtime.vortexEnergy = clamp(runtime.vortexEnergy + energy * 0.72, 0, 1.5);
      runtime.bubbleEnergy = clamp(runtime.bubbleEnergy + energy * state.aeration * 0.32, 0, 1.5);
      emit("vortex", energy, timeOffsetSeconds);
    }
  };

  if (state.sequencerEnabled && !runtime.sequencerWasEnabled) {
    runtime.pendingInitialStep = true;
  }
  runtime.sequencerWasEnabled = state.sequencerEnabled;
  if (!state.sequencerEnabled) runtime.laneValues.fill(0);
  if (delta <= 0) {
    const emissions = deepFreeze({ ...emissionSums, total: 0 });
    return deepFreeze({ ...runtime, emissions, events });
  }

  const substepCount = Math.max(1, Math.ceil(delta / MAX_SUBSTEP_SECONDS));
  const h = delta / substepCount;
  let elapsed = 0;

  for (let substep = 0; substep < substepCount; substep += 1) {
    if (state.sequencerEnabled && runtime.pendingInitialStep) {
      fireSequenceStep(elapsed);
      runtime.pendingInitialStep = false;
    }

    const previousGeneratorPhase = runtime.generatorPhase;
    runtime.generatorPhase = wrapUnit(runtime.generatorPhase + h / state.wavePeriodSeconds);
    const generatorWrapped = runtime.generatorPhase < previousGeneratorPhase;
    const delayedWallPhase = wrapUnit(
      runtime.generatorPhase - physics.travelSeconds / state.wavePeriodSeconds,
    );
    const wallWrapped = delayedWallPhase < runtime.wallPhase;
    runtime.wallPhase = delayedWallPhase;

    const fundamental = Math.sin(TWO_PI * runtime.generatorPhase);
    const second = Math.sin(TWO_PI * runtime.generatorPhase * 2);
    const generatorShape = fundamental + second * physics.generator.harmonicSkew;
    const targetDisplacement = state.waveHeightM * 0.5
      * state.paddleForce
      * physics.paddleCoherence
      * physics.generator.displacementGain
      * generatorShape;
    const previousDisplacement = runtime.surfaceDisplacementM;
    const responseRate = mix(14, 4.5, physics.generator.pressureLag);
    runtime.surfaceDisplacementM += (
      targetDisplacement - runtime.surfaceDisplacementM
    ) * timeAlpha(responseRate, h);
    runtime.surfaceVelocityMps = clamp(
      (runtime.surfaceDisplacementM - previousDisplacement) / Math.max(1e-9, h),
      -12,
      12,
    );
    const coherentVelocity = Math.abs(runtime.surfaceVelocityMps)
      / Math.max(0.08, state.waveHeightM / state.wavePeriodSeconds * TWO_PI);
    const paddleDrive = clamp(
      coherentVelocity * state.paddleForce * physics.generator.velocityGain * 0.34,
      0,
      1.25,
    );

    runtime.paddleEnergy += (paddleDrive - runtime.paddleEnergy) * timeAlpha(8, h);
    const waveTarget = clamp(
      (Math.abs(runtime.surfaceDisplacementM) / Math.max(0.01, state.waveHeightM * 0.5))
        * state.paddleForce * physics.paddleCoherence,
      0,
      1.25,
    );
    runtime.waveEnergy += (waveTarget - runtime.waveEnergy) * timeAlpha(3.2, h);
    const vortexTarget = state.whirlpool * (
      0.22 + runtime.waveEnergy * 0.28 + state.aeration * 0.24
    );
    runtime.vortexEnergy += (vortexTarget - runtime.vortexEnergy) * timeAlpha(2.8, h);
    const machineryTarget = state.machinery * physics.generator.machineryScale
      * (0.18 + paddleDrive * 0.7);
    runtime.machineryEnergy += (
      machineryTarget - runtime.machineryEnergy
    ) * timeAlpha(6, h);

    if (generatorWrapped) {
      const crestEnergy = state.paddleForce * physics.paddleCoherence
        * (0.35 + state.waveHeightM / state.depthM * 0.65);
      emit("paddle", crestEnergy, elapsed, { generatorId: state.generatorId });
      if (state.machinery > 0.02) {
        emit(
          "machinery",
          crestEnergy * state.machinery * physics.generator.machineryScale * 0.42,
          elapsed,
          { generatorId: state.generatorId },
        );
      }
      if (physics.breakSeverity > 0.03) {
        const energy = crestEnergy * physics.breakSeverity;
        runtime.breakerEnergy = clamp(runtime.breakerEnergy + energy * 0.68, 0, 1.5);
        runtime.splashEnergy = clamp(runtime.splashEnergy + energy * state.splash * 0.58, 0, 1.5);
        runtime.foam = clamp(runtime.foam + energy * (0.22 + state.aeration * 0.54), 0, 1.5);
        emit("breaker", energy, elapsed);
      }
    }

    if (wallWrapped) {
      const incident = state.wallImpact * physics.reflectionCoefficient
        * (0.24 + runtime.waveEnergy * 0.76);
      runtime.wallEnergy = clamp(runtime.wallEnergy + incident * 0.72, 0, 1.5);
      runtime.splashEnergy = clamp(
        runtime.splashEnergy + incident * state.splash * 0.34,
        0,
        1.5,
      );
      emit("wall", incident, elapsed, { boundaryId: state.boundaryId });
    }

    const bubbleRate = (
      state.bubbleDensity * (1.2 + runtime.breakerEnergy * 11)
      + state.aeration * (0.4 + runtime.vortexEnergy * 7)
    );
    if (bubbleRate > 0 && random() < Math.min(0.82, bubbleRate * h)) {
      const radiusMm = clamp(
        state.bubbleSize * mix(0.62, 1.42, random()),
        ...WAVE_POOL_LIMITS.bubbleSize,
      );
      const depthM = clamp(
        physics.bubbleDepthM * mix(0.45, 1.15, random()),
        0,
        state.depthM,
      );
      const energy = clamp(
        (0.16 + random() * 0.34)
          * (state.bubbleDensity + state.aeration * 0.7)
          * (0.35 + runtime.breakerEnergy * 0.65),
        0,
        1,
      );
      runtime.bubbleEnergy = clamp(runtime.bubbleEnergy + energy * 0.82, 0, 1.5);
      emit("bubble", energy, elapsed, {
        radiusMm,
        depthM,
        frequencyHz: bubbleResonanceHz(radiusMm, depthM),
      });
    }

    runtime.breakerEnergy *= Math.exp(-h * (2.4 + state.damping * 3.4));
    runtime.wallEnergy *= Math.exp(-h * (
      1.8 + physics.boundary.damping * 5 + state.damping * 2.2
    ));
    runtime.bubbleEnergy *= Math.exp(-h * (3.2 + state.damping * 2.1));
    runtime.splashEnergy *= Math.exp(-h * (4.8 + state.damping * 3));
    runtime.foam *= Math.exp(-h * (0.48 + state.damping * 0.72));

    if (state.sequencerEnabled) {
      runtime.stepElapsedSeconds += h;
      let duration = stepDurationForState(state, runtime.stepIndex);
      let guard = 0;
      while (runtime.stepElapsedSeconds + 1e-12 >= duration && guard < 16) {
        runtime.stepElapsedSeconds = Math.max(0, runtime.stepElapsedSeconds - duration);
        runtime.stepIndex = wrapIndex(runtime.stepIndex + 1, WAVE_POOL_SEQUENCE_LENGTH);
        runtime.stepSerial = Math.min(Number.MAX_SAFE_INTEGER, runtime.stepSerial + 1);
        fireSequenceStep(elapsed + h);
        duration = stepDurationForState(state, runtime.stepIndex);
        guard += 1;
      }
    }

    runtime.timeSeconds = Math.min(1e12, runtime.timeSeconds + h);
    elapsed += h;
  }

  for (const key of ENERGY_KEYS) runtime[key] = clamp(runtime[key], 0, 1.5, 0);
  runtime.surfaceDisplacementM = clamp(runtime.surfaceDisplacementM, -2, 2, 0);
  runtime.surfaceVelocityMps = clamp(runtime.surfaceVelocityMps, -12, 12, 0);
  const emissions = {
    paddle: clamp(Math.max(emissionSums.paddle, runtime.paddleEnergy * 0.3), 0, 1.5),
    breaker: clamp(Math.max(emissionSums.breaker, runtime.breakerEnergy), 0, 1.5),
    wall: clamp(Math.max(emissionSums.wall, runtime.wallEnergy), 0, 1.5),
    bubbles: clamp(Math.max(emissionSums.bubbles, runtime.bubbleEnergy), 0, 1.5),
    vortex: clamp(Math.max(emissionSums.vortex, runtime.vortexEnergy), 0, 1.5),
    splash: clamp(Math.max(emissionSums.splash, runtime.splashEnergy), 0, 1.5),
    machinery: clamp(Math.max(emissionSums.machinery, runtime.machineryEnergy), 0, 1.5),
  };
  emissions.total = clamp(
    Math.sqrt(
      emissions.paddle ** 2
      + emissions.breaker ** 2
      + emissions.wall ** 2
      + emissions.bubbles ** 2
      + emissions.vortex ** 2
      + emissions.splash ** 2
      + emissions.machinery ** 2,
    ) / Math.sqrt(3),
    0,
    1.5,
  );
  runtime.emissions = emissions;
  runtime.events = events;
  return deepFreeze(runtime);
}
