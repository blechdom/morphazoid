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
  pluckForce: Object.freeze([0.08, 1]),
  pluckPosition: Object.freeze([0.08, 0.92]),
  tonguePosition: Object.freeze([0, 1]),
  tongueHeight: Object.freeze([0, 1]),
  jawOpening: Object.freeze([0, 1]),
  lipRounding: Object.freeze([0, 1]),
  glottisOpening: Object.freeze([0, 1]),
  cavityCoupling: Object.freeze([0, 1]),
  frameCoupling: Object.freeze([0, 1]),
  breathDepth: Object.freeze([0, 1]),
  breathRateBpm: Object.freeze([12, 120]),
  breathBalance: Object.freeze([0.25, 0.75]),
  breathFlow: Object.freeze([-1, 1]),
  formantFocus: Object.freeze([0, 1]),
  repeatRateBpm: Object.freeze([36, 480]),
  repeatSwing: Object.freeze([-0.42, 0.42]),
  level: Object.freeze([0, 0.82]),
});

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
  }),
  Object.freeze({
    id: "kubing",
    label: "Kubing",
    family: "split bamboo",
    description: "A light bamboo lamella with a soft fundamental, short decay, and woody frame radiation.",
    settings: freezeSettings({
      reedFrequencyHz: 56,
      reedDecaySeconds: 1.45,
      reedStiffness: 0.28,
      pluckForce: 0.58,
      pluckPosition: 0.46,
      frameCoupling: 0.74,
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

export function jawHarpPreset(id) {
  return JAW_HARP_PRESETS.find((preset) => preset.id === id) ?? JAW_HARP_PRESETS[0];
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
    0.085,
    0.235,
  );
  const volumeMl = clamp(
    28 + jaw * 72 + (1 - height) * 42 + glottis * 28,
    24,
    170,
  );
  const apertureCm2 = clamp(0.35 + jaw * 3.3 - rounding * 1.15, 0.16, 4.2);
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
    185,
    1_050,
  );
  const second = clamp(
    610 + front * 1_890 - rounding * 520 - (1 - height) * 80 - glottis * 42,
    first + 170,
    2_850,
  );
  const third = clamp(
    1_930 + front * 720 + jaw * 235 - rounding * 245 - glottis * 95,
    second + 220,
    3_750,
  );
  const focus = clamp(state.formantFocus);
  const focusFrequencyHz = first + (second - first) * (0.2 + focus * 0.68);
  return Object.freeze({
    frequenciesHz: Object.freeze([first, second, third]),
    bandwidthsHz: Object.freeze([
      80 + jaw * 92 + glottis * 70,
      105 + (1 - height) * 135 + glottis * 85,
      170 + rounding * 145 + glottis * 110,
    ]),
    focusFrequencyHz,
  });
}

export function dominantHarmonic(source = JAW_HARP_DEFAULTS) {
  const state = sanitizeJawHarpState(source);
  const { focusFrequencyHz } = mouthFormants(state);
  const index = clamp(Math.round(focusFrequencyHz / state.reedFrequencyHz), 2, 48);
  return Object.freeze({
    index,
    frequencyHz: index * state.reedFrequencyHz,
    centsOffset: 1_200 * Math.log2(focusFrequencyHz / (index * state.reedFrequencyHz)),
  });
}

export function reedModeFrequencies(source = JAW_HARP_DEFAULTS, count = 24) {
  const state = sanitizeJawHarpState(source);
  const amount = Math.max(1, Math.min(64, Math.round(finiteOr(count, 24))));
  return Object.freeze(Array.from({ length: amount }, (_, index) => {
    const harmonic = index + 1;
    const stretch = 1 + state.reedStiffness * 0.000035 * harmonic * harmonic;
    return state.reedFrequencyHz * harmonic * stretch;
  }));
}

export function repeatIntervalMs(rateBpm, step = 0, swing = 0) {
  const bpm = clamp(rateBpm, JAW_HARP_LIMITS.repeatRateBpm[0], JAW_HARP_LIMITS.repeatRateBpm[1]);
  const amount = clamp(swing, JAW_HARP_LIMITS.repeatSwing[0], JAW_HARP_LIMITS.repeatSwing[1]);
  const base = 60_000 / bpm;
  return base * (step % 2 === 0 ? 1 + amount : 1 - amount);
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

export function randomizeJawHarpState(source = JAW_HARP_DEFAULTS, random = Math.random) {
  const state = sanitizeJawHarpState(source);
  const unit = () => clamp(typeof random === "function" ? random() : Math.random());
  return sanitizeJawHarpState({
    ...state,
    reedFrequencyHz: 46 + unit() * 92,
    reedDecaySeconds: 0.8 + unit() * 4.8,
    reedStiffness: 0.18 + unit() * 0.76,
    pluckForce: 0.28 + unit() * 0.68,
    pluckPosition: 0.12 + unit() * 0.72,
    tonguePosition: unit(),
    tongueHeight: unit(),
    jawOpening: 0.1 + unit() * 0.82,
    lipRounding: unit(),
    glottisOpening: unit(),
    cavityCoupling: 0.45 + unit() * 0.52,
    frameCoupling: unit() * 0.82,
    breathDepth: 0.42 + unit() * 0.56,
    breathRateBpm: 22 + unit() * 62,
    breathBalance: 0.34 + unit() * 0.3,
    breathFlow: 0,
    formantFocus: unit(),
    repeatRateBpm: 70 + unit() * 250,
    repeatSwing: (unit() * 2 - 1) * 0.26,
    presetId: state.presetId,
    vowelId: state.vowelId,
  }, state);
}
