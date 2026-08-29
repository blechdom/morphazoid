const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

export const JAW_HARP_LIMITS = Object.freeze({
  reedFrequencyHz: Object.freeze([38, 180]),
  reedDecaySeconds: Object.freeze([0.35, 8]),
  reedStiffness: Object.freeze([0, 1]),
  pluckForce: Object.freeze([0.005, 4]),
  pluckPosition: Object.freeze([0.08, 0.92]),
  tonguePosition: Object.freeze([-2, 3]),
  tongueHeight: Object.freeze([-2, 3]),
  jawOpening: Object.freeze([-2, 3]),
  lipRounding: Object.freeze([-2, 3]),
  glottisOpening: Object.freeze([-2, 3]),
  cavityCoupling: Object.freeze([0, 2]),
  frameCoupling: Object.freeze([0, 1]),
  breathDepth: Object.freeze([0, 3]),
  breathRateBpm: Object.freeze([1, 1_200]),
  breathBalance: Object.freeze([0.02, 0.98]),
  breathFlow: Object.freeze([-3, 3]),
  formantFocus: Object.freeze([-2, 3]),
  repeatRateBpm: Object.freeze([36, 480]),
  repeatSwing: Object.freeze([-0.42, 0.42]),
  breathsPerLoop: Object.freeze([0.125, 16]),
  dryResonance: Object.freeze([0, 1]),
  level: Object.freeze([0, 0.82]),
});

// Randomize explores a deliberately playable subset of the much wider manual
// ranges. The full limits remain available from the controls for intentional
// sub-audio, near-silent, overblown, and anatomically impossible sounds.
export const JAW_HARP_RANDOM_LIMITS = Object.freeze({
  reedFrequencyHz: Object.freeze([50, 155]),
  reedDecaySeconds: Object.freeze([0.7, 6]),
  reedStiffness: Object.freeze([0.12, 0.92]),
  pluckForce: Object.freeze([0.48, 1.65]),
  pluckPosition: Object.freeze([0.14, 0.86]),
  mouthArticulation: Object.freeze([-1.2, 2.2]),
  glottisOpening: Object.freeze([-1, 2]),
  cavityCoupling: Object.freeze([0.18, 1.45]),
  frameCoupling: Object.freeze([0.16, 0.82]),
  breathDepth: Object.freeze([0.42, 1.65]),
  breathRateBpm: Object.freeze([10, 280]),
  breathBalance: Object.freeze([0.14, 0.86]),
  formantFocus: Object.freeze([-0.75, 2.25]),
  dryResonance: Object.freeze([0.12, 0.72]),
  dryResonanceWithoutBreath: Object.freeze([0.2, 0.72]),
  effectiveBreathRateBpm: Object.freeze([8, 360]),
});

export const JAW_HARP_MODE_COUNT = 96;
export const MAX_TINE_PULL = 2.5;

// Material constants are representative longitudinal values, rather than exact
// measurements of any one instrument. Geometry still sets the tuned fundamental.
const REFERENCE_STEEL_SPECIFIC_MODULUS = 200e9 / 7_800;

export const JAW_HARP_DEFAULTS = Object.freeze({
  presetId: "khomus",
  vowelId: "a",
  reedFrequencyHz: 74,
  reedDecaySeconds: 3.8,
  reedStiffness: 0.68,
  pluckForce: 0.72,
  pluckPosition: 0.32,
  pluckDirection: 1,
  tonguePosition: 0.48,
  tongueHeight: 0.22,
  jawOpening: 0.72,
  lipRounding: 0.08,
  glottisOpening: 0.42,
  cavityCoupling: 0.82,
  frameCoupling: 0.36,
  breathDepth: 0.72,
  breathRateBpm: 42,
  breathBalance: 0.46,
  breathFlow: 0,
  autoBreath: true,
  formantFocus: 0.48,
  repeatRateBpm: 148,
  repeatSwing: 0.08,
  repeat: false,
  rhythmId: "quarter-eighths",
  breathLinked: true,
  breathsPerLoop: 1,
  dryResonance: 0.06,
  level: 0.52,
});

function freezeSettings(settings) {
  return Object.freeze({ ...settings });
}

export const JAW_HARP_PRESETS = Object.freeze([
  Object.freeze({
    id: "khomus",
    label: "Temir khomus",
    family: "forged steel",
    description: "Low, elastic steel tongue with a long bloom and a strong, dark harmonic ladder.",
    settings: freezeSettings({
      reedFrequencyHz: 74,
      reedDecaySeconds: 3.8,
      reedStiffness: 0.68,
      pluckForce: 0.72,
      pluckPosition: 0.32,
      frameCoupling: 0.36,
    }),
    material: freezeSettings({
      brightness: 0.72, inharmonicity: 1.25, lossTilt: 0.72,
      frameRatio: 0.78, frameBandwidth: 0.72, contact: 0.86, airResponse: 0.88,
      youngsModulusGPa: 200, densityKgM3: 7_800,
      internalLossFactor: 0.0001, elasticLimitStrain: 0.009,
    }),
  }),
  Object.freeze({
    id: "munnharpe",
    label: "Munnharpe",
    family: "tempered steel",
    description: "A taut, bright Nordic steel reed with a focused attack and clearly separated partials.",
    settings: freezeSettings({
      reedFrequencyHz: 92,
      reedDecaySeconds: 2.7,
      reedStiffness: 0.82,
      pluckForce: 0.66,
      pluckPosition: 0.24,
      frameCoupling: 0.48,
    }),
    material: freezeSettings({
      brightness: 1.34, inharmonicity: 1.12, lossTilt: 1.18,
      frameRatio: 1.32, frameBandwidth: 0.58, contact: 1.2, airResponse: 1.08,
      youngsModulusGPa: 210, densityKgM3: 7_800,
      internalLossFactor: 0.00008, elasticLimitStrain: 0.0095,
    }),
  }),
  Object.freeze({
    id: "marranzanu",
    label: "Marranzanu",
    family: "iron frame",
    description: "A compact Sicilian profile: dry frame knock, firm mid reed, and a quick speaking response.",
    settings: freezeSettings({
      reedFrequencyHz: 108,
      reedDecaySeconds: 1.9,
      reedStiffness: 0.76,
      pluckForce: 0.78,
      pluckPosition: 0.2,
      frameCoupling: 0.62,
    }),
    material: freezeSettings({
      brightness: 1.08, inharmonicity: 0.92, lossTilt: 1.46,
      frameRatio: 1.72, frameBandwidth: 1.34, contact: 1.52, airResponse: 0.82,
      youngsModulusGPa: 200, densityKgM3: 7_850,
      internalLossFactor: 0.00024, elasticLimitStrain: 0.0065,
    }),
  }),
  Object.freeze({
    id: "kubing",
    label: "Kubing",
    family: "split bamboo",
    description: "A light bamboo lamella with a soft fundamental, short decay, and woody frame radiation.",
    settings: freezeSettings({
      reedFrequencyHz: 56,
      reedDecaySeconds: 0.62,
      reedStiffness: 0.28,
      pluckForce: 0.58,
      pluckPosition: 0.46,
      frameCoupling: 0.74,
    }),
    material: freezeSettings({
      brightness: 0.48, inharmonicity: 0.38, lossTilt: 2.08,
      frameRatio: 0.58, frameBandwidth: 0.92, contact: 0.54, airResponse: 0.68,
      youngsModulusGPa: 10.6, densityKgM3: 630,
      internalLossFactor: 0.015, elasticLimitStrain: 0.006,
    }),
  }),
  Object.freeze({
    id: "dan-moi",
    label: "Dan moi",
    family: "brass lamella",
    description: "A light brass lip harp with a fast, bright reed and intimate mouth coupling.",
    settings: freezeSettings({
      reedFrequencyHz: 126,
      reedDecaySeconds: 2.25,
      reedStiffness: 0.56,
      pluckForce: 0.48,
      pluckPosition: 0.4,
      frameCoupling: 0.24,
    }),
    material: freezeSettings({
      brightness: 1.62, inharmonicity: 0.74, lossTilt: 0.94,
      frameRatio: 1.08, frameBandwidth: 0.5, contact: 0.62, airResponse: 1.34,
      youngsModulusGPa: 105, densityKgM3: 8_500,
      internalLossFactor: 0.0015, elasticLimitStrain: 0.0035,
    }),
  }),
]);

export const VOWEL_PRESETS = Object.freeze([
  Object.freeze({ id: "a", label: "A", phoneme: "/ɑ/", settings: freezeSettings({
    tonguePosition: 0.48, tongueHeight: 0.22, jawOpening: 0.72, lipRounding: 0.08,
  }) }),
  Object.freeze({ id: "e", label: "E", phoneme: "/e/", settings: freezeSettings({
    tonguePosition: 0.73, tongueHeight: 0.58, jawOpening: 0.38, lipRounding: 0.05,
  }) }),
  Object.freeze({ id: "i", label: "I", phoneme: "/i/", settings: freezeSettings({
    tonguePosition: 0.9, tongueHeight: 0.84, jawOpening: 0.2, lipRounding: 0.01,
  }) }),
  Object.freeze({ id: "o", label: "O", phoneme: "/o/", settings: freezeSettings({
    tonguePosition: 0.26, tongueHeight: 0.48, jawOpening: 0.46, lipRounding: 0.76,
  }) }),
  Object.freeze({ id: "u", label: "U", phoneme: "/u/", settings: freezeSettings({
    tonguePosition: 0.12, tongueHeight: 0.84, jawOpening: 0.18, lipRounding: 0.94,
  }) }),
]);

export const JAW_HARP_RHYTHMS = Object.freeze([
  Object.freeze({ id: "quarter-eighths", label: "Quarter · eighth · eighth", steps: Object.freeze([1, 0, 0.82, 0.72]) }),
  Object.freeze({ id: "tresillo", label: "Tresillo 3–3–2", steps: Object.freeze([1, 0, 0, 0.78, 0, 0, 0.88, 0]) }),
  Object.freeze({ id: "two-one", label: "Two close · one far", steps: Object.freeze([1, 0.7, 0, 0, 0.86, 0, 0, 0]) }),
  Object.freeze({ id: "five-step", label: "Five-step lilt", steps: Object.freeze([1, 0, 0.62, 0, 0.83]) }),
  Object.freeze({ id: "soft-machine", label: "Soft / hard / ghost", steps: Object.freeze([0.42, 0, 1, 0, 0.2, 0.72, 0, 0]) }),
  Object.freeze({ id: "sparse-seven", label: "Sparse seven", steps: Object.freeze([1, 0, 0, 0.58, 0, 0.8, 0]) }),
]);

export function jawHarpPreset(id) {
  return JAW_HARP_PRESETS.find((preset) => preset.id === id) ?? JAW_HARP_PRESETS[0];
}

export function reedMaterialProperties(source = JAW_HARP_DEFAULTS) {
  const presetId = typeof source === "string" ? source : source?.presetId;
  const preset = jawHarpPreset(presetId);
  const material = preset.material;
  const youngsModulusPa = material.youngsModulusGPa * 1e9;
  const specificModulusM2S2 = youngsModulusPa / material.densityKgM3;
  const waveSpeedMps = Math.sqrt(specificModulusM2S2);
  const dampingRatio = material.internalLossFactor * 0.5;
  const intrinsicCycleRetention = Math.exp(-Math.PI * material.internalLossFactor);
  return Object.freeze({
    presetId: preset.id,
    youngsModulusPa,
    densityKgM3: material.densityKgM3,
    specificModulusM2S2,
    specificModulusRatio: specificModulusM2S2 / REFERENCE_STEEL_SPECIFIC_MODULUS,
    waveSpeedMps,
    internalLossFactor: material.internalLossFactor,
    dampingRatio,
    intrinsicCycleRetention,
    elasticLimitStrain: material.elasticLimitStrain,
  });
}

export function vowelPreset(id) {
  return VOWEL_PRESETS.find((preset) => preset.id === id) ?? VOWEL_PRESETS[0];
}

export function sanitizeJawHarpState(source = {}, fallback = JAW_HARP_DEFAULTS) {
  const state = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : JAW_HARP_DEFAULTS;
  const result = {};
  for (const [key, limits] of Object.entries(JAW_HARP_LIMITS)) {
    result[key] = clamp(
      finiteOr(state[key], finiteOr(base[key], JAW_HARP_DEFAULTS[key])),
      limits[0],
      limits[1],
    );
  }
  const direction = finiteOr(state.pluckDirection, finiteOr(base.pluckDirection, 1));
  result.pluckDirection = direction < 0 ? -1 : 1;
  result.repeat = Boolean(state.repeat ?? base.repeat ?? false);
  result.autoBreath = Boolean(state.autoBreath ?? base.autoBreath ?? true);
  result.breathLinked = Boolean(state.breathLinked ?? base.breathLinked ?? true);
  result.rhythmId = jawHarpRhythm(state.rhythmId ?? base.rhythmId).id;
  result.presetId = jawHarpPreset(state.presetId ?? base.presetId).id;
  result.vowelId = VOWEL_PRESETS.some(({ id }) => id === state.vowelId)
    ? state.vowelId
    : (VOWEL_PRESETS.some(({ id }) => id === base.vowelId) ? base.vowelId : "a");
  return result;
}

export function jawHarpState(presetId = "khomus", overrides = {}) {
  const preset = jawHarpPreset(presetId);
  return sanitizeJawHarpState({
    ...JAW_HARP_DEFAULTS,
    ...preset.settings,
    ...overrides,
    presetId: preset.id,
  });
}

export function applyVowel(state, vowelId) {
  const vowel = vowelPreset(vowelId);
  return sanitizeJawHarpState({
    ...state,
    ...vowel.settings,
    vowelId: vowel.id,
  }, state);
}

export function mouthGeometry(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  const front = state.tonguePosition;
  const height = state.tongueHeight;
  const jaw = state.jawOpening;
  const rounding = state.lipRounding;
  const glottis = state.glottisOpening;

  const lengthM = clamp(
    0.095 + (1 - front) * 0.075 + rounding * 0.038 + glottis * 0.018,
    0.012,
    0.65,
  );
  const volumeMl = clamp(
    28 + jaw * 72 + (1 - height) * 42 + glottis * 28,
    0.5,
    1_200,
  );
  const apertureCm2 = clamp(0.35 + jaw * 3.3 - rounding * 1.15, 0.002, 24);
  return Object.freeze({ lengthM, volumeMl, apertureCm2 });
}

export function mouthFormants(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  const front = state.tonguePosition;
  const height = state.tongueHeight;
  const jaw = state.jawOpening;
  const rounding = state.lipRounding;
  const glottis = state.glottisOpening;
  const first = clamp(
    235 + jaw * 510 + (1 - height) * 280 - rounding * 55 - glottis * 34,
    30,
    4_200,
  );
  const second = clamp(
    610 + front * 1_890 - rounding * 520 - (1 - height) * 80 - glottis * 42,
    first + 30,
    8_200,
  );
  const third = clamp(
    1_930 + front * 720 + jaw * 235 - rounding * 245 - glottis * 95,
    second + 40,
    9_400,
  );
  const focus = state.formantFocus;
  let focusFrequencyHz;
  if (focus < 0) {
    focusFrequencyHz = first * Math.pow(2, focus);
  } else if (focus <= 1) {
    focusFrequencyHz = first + (second - first) * focus;
  } else if (focus <= 2) {
    focusFrequencyHz = second + (third - second) * (focus - 1);
  } else {
    focusFrequencyHz = third * Math.pow(2, (focus - 2) * 0.7);
  }
  focusFrequencyHz = clamp(focusFrequencyHz, 30, 9_400);
  return Object.freeze({
    frequenciesHz: Object.freeze([first, second, third]),
    bandwidthsHz: Object.freeze([
      clamp(80 + jaw * 92 + glottis * 70, 8, 2_400),
      clamp(105 + (1 - height) * 135 + glottis * 85, 8, 2_800),
      clamp(170 + rounding * 145 + glottis * 110, 8, 3_200),
    ]),
    focusFrequencyHz,
    focusBandwidthHz: clamp(34 + Math.sqrt(focusFrequencyHz) * 2.8, 24, 420),
  });
}

export function dominantHarmonic(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  const { focusFrequencyHz } = mouthFormants(state);
  const index = clamp(Math.round(focusFrequencyHz / state.reedFrequencyHz), 1, JAW_HARP_MODE_COUNT);
  return Object.freeze({
    index,
    frequencyHz: index * state.reedFrequencyHz,
    centsOffset: 1_200 * Math.log2(focusFrequencyHz / (index * state.reedFrequencyHz)),
  });
}

export function reedModeFrequencies(source = JAW_HARP_DEFAULTS, count = 24) {
  const state = sanitizeJawHarpState(source);
  const physics = reedMaterialProperties(state);
  const amount = Math.max(1, Math.min(128, Math.round(finiteOr(count, 24))));
  return Object.freeze(Array.from({ length: amount }, (_, index) => {
    const harmonic = index + 1;
    const specificStiffness = clamp(Math.sqrt(physics.specificModulusRatio), 0.45, 1.35);
    const stretch = 1 + state.reedStiffness
      * (0.000023 + specificStiffness * 0.000012)
      * harmonic * harmonic;
    return state.reedFrequencyHz * harmonic * stretch;
  }));
}

export function tineDisplayFrequencyHz(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  return clamp(Math.sqrt(state.reedFrequencyHz) * 0.95, 5.5, 12);
}

// A time-expanded view of the same underdamped release. Actual jaw-harp reeds
// oscillate too quickly for a 60 Hz display, so one visual cycle represents one
// physical cycle while preserving the modeled loss per cycle.
export function tineReleaseMotion(
  source = JAW_HARP_DEFAULTS,
  elapsedSeconds = 0,
  force = source?.pluckForce,
  direction = source?.pluckDirection,
) {
  const state = sanitizeJawHarpState(source);
  const physics = reedMaterialProperties(state);
  const time = Math.max(0, finiteOr(elapsedSeconds, 0));
  const displayFrequencyHz = tineDisplayFrequencyHz(state);
  const cycles = time * displayFrequencyHz;
  const strength = clamp(
    finiteOr(force, state.pluckForce),
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
  const normalizedForce = Math.log1p(strength * 1.5)
    / Math.log1p(JAW_HARP_LIMITS.pluckForce[1] * 1.5);
  const systemCycleRetention = Math.exp(
    -1 / Math.max(1e-6, state.reedFrequencyHz * state.reedDecaySeconds),
  );
  const cycleRetention = systemCycleRetention
    * Math.pow(physics.intrinsicCycleRetention, 0.12);
  const dampedCycles = cycles * Math.sqrt(Math.max(0, 1 - physics.dampingRatio ** 2));
  const presentationFade = cycles <= 5.25
    ? 1
    : Math.exp(-Math.pow((cycles - 5.25) / 1.15, 2));
  const side = finiteOr(direction, state.pluckDirection) < 0 ? -1 : 1;
  return side * normalizedForce
    * Math.pow(cycleRetention, cycles)
    * Math.cos(Math.PI * 2 * dampedCycles)
    * presentationFade;
}

export function repeatIntervalMs(rateBpm, step = 0, swing = 0) {
  const bpm = clamp(rateBpm, JAW_HARP_LIMITS.repeatRateBpm[0], JAW_HARP_LIMITS.repeatRateBpm[1]);
  const amount = clamp(swing, JAW_HARP_LIMITS.repeatSwing[0], JAW_HARP_LIMITS.repeatSwing[1]);
  const base = 60_000 / bpm;
  return base * (step % 2 === 0 ? 1 + amount : 1 - amount);
}

export function jawHarpRhythm(id) {
  return JAW_HARP_RHYTHMS.find((rhythm) => rhythm.id === id) ?? JAW_HARP_RHYTHMS[0];
}

export function repeatStepIntervalMs(rateBpm) {
  const bpm = clamp(rateBpm, JAW_HARP_LIMITS.repeatRateBpm[0], JAW_HARP_LIMITS.repeatRateBpm[1]);
  return 30_000 / bpm;
}

export function jawHarpRhythmHit(source = JAW_HARP_DEFAULTS, step = 0) {
  const state = sanitizeJawHarpState(source);
  const steps = jawHarpRhythm(state.rhythmId).steps;
  const index = ((Math.trunc(finiteOr(step, 0)) % steps.length) + steps.length) % steps.length;
  return Object.freeze({ index, velocity: steps[index], active: steps[index] > 0 });
}

export function jawHarpRhythmLoopMs(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  return jawHarpRhythm(state.rhythmId).steps.length * repeatStepIntervalMs(state.repeatRateBpm);
}

export function linkedBreathIntervalMs(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  return jawHarpRhythmLoopMs(state) / state.breathsPerLoop;
}

export function effectiveBreathRateBpm(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  if (!state.breathLinked) return state.breathRateBpm;
  const clockRate = 60_000 / linkedBreathIntervalMs(state);
  const performerMultiplier = state.breathRateBpm / JAW_HARP_DEFAULTS.breathRateBpm;
  return clamp(clockRate * performerMultiplier, 0.1, 7_200);
}

export function breathCycleFlow(source = JAW_HARP_DEFAULTS, phase = 0) {
  const state = sanitizeJawHarpState(source);
  const wrapped = ((finiteOr(phase, 0) % 1) + 1) % 1;
  if (wrapped < state.breathBalance) {
    const inhalePhase = wrapped / state.breathBalance;
    return -state.breathDepth * Math.sin(Math.PI * inhalePhase);
  }
  const exhalePhase = (wrapped - state.breathBalance) / (1 - state.breathBalance);
  return state.breathDepth * Math.sin(Math.PI * exhalePhase);
}

export function breathCycleIntervalMs(rateBpm) {
  const bpm = clamp(rateBpm, JAW_HARP_LIMITS.breathRateBpm[0], JAW_HARP_LIMITS.breathRateBpm[1]);
  return 60_000 / bpm;
}

export function pluckForceFromPull(pull, scale = JAW_HARP_DEFAULTS.pluckForce) {
  const tension = clamp(Math.abs(finiteOr(pull, 0)), 0, MAX_TINE_PULL);
  if (tension < 0.012) return 0;
  const forceScale = clamp(
    scale,
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
  const rawForce = forceScale * Math.pow(tension, 1.55);
  return clamp(
    -JAW_HARP_LIMITS.pluckForce[1]
      * Math.expm1(-rawForce / JAW_HARP_LIMITS.pluckForce[1]),
    JAW_HARP_LIMITS.pluckForce[0],
    JAW_HARP_LIMITS.pluckForce[1],
  );
}

function randomRange(unitValue, limits, curve = 1) {
  const [minimum, maximum] = limits;
  return minimum + (maximum - minimum) * Math.pow(clamp(unitValue), curve);
}

function centeredRandomRange(unitValue, limits, curve = 1.55) {
  const [minimum, maximum] = limits;
  const signed = clamp(unitValue) * 2 - 1;
  const curved = Math.sign(signed) * Math.pow(Math.abs(signed), curve);
  return (minimum + maximum) * 0.5 + curved * (maximum - minimum) * 0.5;
}

function logarithmicRandomRange(unitValue, limits, curve = 1) {
  const [minimum, maximum] = limits;
  return minimum * Math.pow(maximum / minimum, Math.pow(clamp(unitValue), curve));
}

function randomizedRhythmId(unitValue) {
  const value = clamp(unitValue);
  if (value < 0.24) return "sparse-seven";
  if (value < 0.44) return "tresillo";
  if (value < 0.62) return "two-one";
  if (value < 0.79) return "soft-machine";
  if (value < 0.93) return "five-step";
  return "quarter-eighths";
}

function randomizedBreathsPerLoop(unitValue) {
  const value = clamp(unitValue);
  if (value < 0.12) return 0.125;
  if (value < 0.25) return 0.25;
  if (value < 0.42) return 0.5;
  if (value < 0.72) return 1;
  if (value < 0.86) return 2;
  if (value < 0.93) return 3;
  if (value < 0.97) return 4;
  if (value < 0.99) return 8;
  return 16;
}

export function randomizeJawHarpState(source = JAW_HARP_DEFAULTS, random = Math.random) {
  const state = sanitizeJawHarpState(source);
  const unit = () => clamp(typeof random === "function" ? random() : Math.random());
  const presetId = JAW_HARP_PRESETS[
    Math.min(JAW_HARP_PRESETS.length - 1, Math.floor(unit() * JAW_HARP_PRESETS.length))
  ].id;
  const vowelId = VOWEL_PRESETS[
    Math.min(VOWEL_PRESETS.length - 1, Math.floor(unit() * VOWEL_PRESETS.length))
  ].id;
  const rhythmId = randomizedRhythmId(unit());
  const repeat = unit() < 0.22;
  const autoBreath = unit() < 0.68;
  const breathLinked = unit() < 0.28;
  const pluckDirection = unit() < 0.5 ? -1 : 1;
  const breathsPerLoop = randomizedBreathsPerLoop(unit());
  const randomized = sanitizeJawHarpState({
    ...state,
    presetId,
    vowelId,
    rhythmId,
    repeat,
    autoBreath,
    breathLinked,
    pluckDirection,
    breathsPerLoop,
    reedFrequencyHz: logarithmicRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.reedFrequencyHz, 1.1),
    reedDecaySeconds: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.reedDecaySeconds, 1.15),
    reedStiffness: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.reedStiffness, 1.35),
    pluckForce: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.pluckForce, 1.45),
    pluckPosition: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.pluckPosition, 1.3),
    tonguePosition: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    tongueHeight: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    jawOpening: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    lipRounding: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.mouthArticulation, 1.4),
    glottisOpening: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.glottisOpening, 1.4),
    cavityCoupling: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.cavityCoupling, 1.35),
    frameCoupling: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.frameCoupling, 1.25),
    breathDepth: randomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathDepth, 1.3),
    breathRateBpm: logarithmicRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathRateBpm, 1.2),
    breathBalance: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.breathBalance, 1.65),
    breathFlow: 0,
    formantFocus: centeredRandomRange(unit(), JAW_HARP_RANDOM_LIMITS.formantFocus, 1.4),
    repeatRateBpm: logarithmicRandomRange(unit(), JAW_HARP_LIMITS.repeatRateBpm, 1.7),
    repeatSwing: centeredRandomRange(unit(), JAW_HARP_LIMITS.repeatSwing, 1.8),
    dryResonance: randomRange(
      unit(),
      autoBreath
        ? JAW_HARP_RANDOM_LIMITS.dryResonance
        : JAW_HARP_RANDOM_LIMITS.dryResonanceWithoutBreath,
      1.6,
    ),
  }, state);
  const [minimumBreathRate, maximumBreathRate] = JAW_HARP_RANDOM_LIMITS.effectiveBreathRateBpm;
  const linkedRate = effectiveBreathRateBpm(randomized);
  return randomized.breathLinked
    && (linkedRate < minimumBreathRate || linkedRate > maximumBreathRate)
    ? sanitizeJawHarpState({ ...randomized, breathLinked: false }, randomized)
    : randomized;
}
