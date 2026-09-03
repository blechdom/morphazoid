/**
 * Pure control and geometry model for the Throat Singing instrument.
 *
 * The named presets are playable approximations, not measurements of an
 * individual singer and not instructions for producing these vocal techniques.
 * The focused-overtone geometry follows Bergevin et al. (2020): a persistent
 * oral constriction near the alveolar ridge brings F2 and F3 together, while a
 * variable uvular / upper-pharyngeal constriction moves that focus. Kargyraa's
 * period division follows the half-rate ventricular-fold vibration observed in
 * one singer by Lindestad et al. (2001). Named rhythmic characters are encoded
 * as modest performance modulation, not as claims of one canonical rendition.
 */

export const THROAT_SINGING_TRACT_SECTION_COUNT = 44;

const TAU = Math.PI * 2;
const FOCUS_MINIMUM_AREA_CM2 = 0.09;
const UVULAR_CENTER_CM = 7.5;
const ALVEOLAR_CENTER_CM = 13;
const FRONT_CAVITY_CENTER_CM = 14.75;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

const numericLimits = {
  trueFoldHz: [50, 360],
  falseFoldDivision: [1, 7],
  harmonicNumber: [4, 24],
  intensity: [0, 1],
  foldTenseness: [0, 1],
  creakAmount: [0, 1],
  roughness: [0, 1],
  falseFoldCoupling: [0, 1],
  formantConvergence: [0, 1],
  formantSeparationHz: [40, 900],
  focusBandwidthHz: [25, 500],
  uvularConstriction: [0, 1],
  alveolarConstriction: [0, 1],
  frontCavityExpansion: [0, 1],
  tractLengthCm: [13, 22],
  mouthOpening: [0.05, 1],
  lipRounding: [0, 1],
  vibratoRateHz: [0, 12],
  vibratoDepthCents: [0, 100],
  motionRateHz: [0, 12],
  motionDepth: [0, 1],
  amplitudeMotionDepth: [0, 1],
  level: [0, 0.8],
};

export const THROAT_SINGING_LIMITS = deepFreeze(numericLimits);

// Below this depth the divided component is mathematically present but is
// unlikely to dominate the perceived pitch. Keeping the threshold explicit
// prevents the readout from claiming an octave-down drone while all pulses are
// still effectively identical.
export const FALSE_FOLD_AUDIBILITY_THRESHOLD = 0.12;

export const THROAT_SINGING_MOTION_SHAPES = Object.freeze([
  "sine",
  "triangle",
  "pulse",
  "stirrup",
  "sample-hold",
]);

function settings(values) {
  return deepFreeze({ ...values });
}

function preset({
  id,
  label,
  culturalScope,
  role,
  description,
  approximation,
  values,
}) {
  return deepFreeze({
    id,
    label,
    culturalScope,
    isTuvan: culturalScope === "Tuvan",
    isExploration: culturalScope === "Synthetic exploration",
    role,
    description,
    evidence: {
      kind: "research-informed approximation",
      notice: approximation,
    },
    settings: settings(values),
  });
}

const COMMON_SOURCE_VALUES = Object.freeze({
  falseFoldDivision: 1,
  falseFoldCoupling: 0.04,
  creakAmount: 0,
  tractLengthCm: 17.2,
  lipRounding: 0.08,
  level: 0.36,
});

/**
 * These presets distinguish five Tuvan references, two comparisons, and one
 * neutral exploration state. Values are synthesis controls, not population averages.
 */
export const THROAT_SINGING_STYLE_PRESETS = Object.freeze([
  preset({
    id: "open-drone",
    label: "Open drone",
    culturalScope: "Synthetic exploration",
    role: "neutral overtone-discovery drone",
    description: "A gentler open drone with the tongue lowered and a broad focus; shape the airway to uncover upper harmonics.",
    approximation: "This synthetic orientation state is deliberately neutral and unfocused. It is a starting point for exploring the model, not a named singing tradition or a claim about vocal technique.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 110,
      harmonicNumber: 8,
      intensity: 0.62,
      foldTenseness: 0.56,
      roughness: 0.08,
      formantConvergence: 0.22,
      formantSeparationHz: 700,
      focusBandwidthHz: 300,
      uvularConstriction: 0.35,
      alveolarConstriction: 0.3,
      frontCavityExpansion: 0.38,
      tractLengthCm: 18,
      mouthOpening: 0.72,
      lipRounding: 0.12,
      vibratoRateHz: 4.4,
      vibratoDepthCents: 9,
      motionRateHz: 0.35,
      motionDepth: 0.025,
      amplitudeMotionDepth: 0.02,
      motionShape: "sine",
      level: 0.28,
    },
  }),
  preset({
    id: "sygyt",
    label: "Sygyt",
    culturalScope: "Tuvan",
    role: "bright focused-overtone style",
    description: "A bright, narrow upper harmonic over a steady modal drone.",
    approximation: "The 150 Hz source and twelfth-harmonic 1.8 kHz focus reproduce the worked model example in Bergevin et al.; the named-style timbre settings are a playable approximation.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 150,
      harmonicNumber: 12,
      intensity: 0.76,
      foldTenseness: 0.8,
      roughness: 0.08,
      formantConvergence: 0.97,
      formantSeparationHz: 520,
      focusBandwidthHz: 58,
      uvularConstriction: 0.14,
      alveolarConstriction: 0.98,
      frontCavityExpansion: 0.74,
      mouthOpening: 0.4,
      vibratoRateHz: 4.8,
      vibratoDepthCents: 10,
      motionRateHz: 0.72,
      motionDepth: 0.06,
      amplitudeMotionDepth: 0.025,
      motionShape: "sine",
    },
  }),
  preset({
    id: "xoomei",
    label: "Xöömei / Khöömei",
    culturalScope: "Tuvan",
    role: "warm focused-overtone style",
    description: "A rounder drone and gentler focused harmonic with more audible voice body.",
    approximation: "The dual-constriction topology is MRI-informed; control values describe a synthetic representative rather than one authoritative Xöömei production.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 145,
      harmonicNumber: 9,
      intensity: 0.72,
      foldTenseness: 0.65,
      roughness: 0.16,
      formantConvergence: 0.88,
      formantSeparationHz: 560,
      focusBandwidthHz: 105,
      uvularConstriction: 0.7,
      alveolarConstriction: 0.87,
      frontCavityExpansion: 0.62,
      mouthOpening: 0.5,
      lipRounding: 0.18,
      vibratoRateHz: 4.1,
      vibratoDepthCents: 14,
      motionRateHz: 0.58,
      motionDepth: 0.08,
      amplitudeMotionDepth: 0.04,
      motionShape: "sine",
    },
  }),
  preset({
    id: "kargyraa",
    label: "Kargyraa",
    culturalScope: "Tuvan",
    role: "ventricular-fold bass style",
    description: "A period-divided bass drone with strong ventricular-fold color and a broad overtone focus.",
    approximation: "Half-rate ventricular-fold closure is evidence-based from a single-singer imaging study; the remaining timbre and tract values are conservative synthesis approximations.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 120,
      falseFoldDivision: 2,
      harmonicNumber: 16,
      intensity: 0.8,
      foldTenseness: 0.5,
      roughness: 0.7,
      falseFoldCoupling: 0.92,
      formantConvergence: 0.7,
      formantSeparationHz: 620,
      focusBandwidthHz: 168,
      uvularConstriction: 0.76,
      alveolarConstriction: 0.64,
      frontCavityExpansion: 0.5,
      tractLengthCm: 18.2,
      mouthOpening: 0.7,
      lipRounding: 0.16,
      vibratoRateHz: 3.6,
      vibratoDepthCents: 18,
      motionRateHz: 0.9,
      motionDepth: 0.08,
      amplitudeMotionDepth: 0.05,
      motionShape: "sine",
      level: 0.32,
    },
  }),
  preset({
    id: "borbangnadyr",
    label: "Borbangnadyr",
    culturalScope: "Tuvan",
    role: "rolling / warbling ornament",
    description: "A rolling focus gesture carried by a warm drone rather than a stationary whistle.",
    approximation: "Borbangnadyr varies among performers and may ornament other style families; this preset represents its rolling character as bounded tract and level modulation.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 140,
      harmonicNumber: 9,
      intensity: 0.72,
      foldTenseness: 0.64,
      roughness: 0.2,
      formantConvergence: 0.86,
      formantSeparationHz: 570,
      focusBandwidthHz: 112,
      uvularConstriction: 0.67,
      alveolarConstriction: 0.85,
      frontCavityExpansion: 0.66,
      mouthOpening: 0.54,
      lipRounding: 0.14,
      vibratoRateHz: 5.2,
      vibratoDepthCents: 13,
      motionRateHz: 5.4,
      motionDepth: 0.42,
      amplitudeMotionDepth: 0.24,
      motionShape: "triangle",
    },
  }),
  preset({
    id: "ezengileer",
    label: "Ezengileer",
    culturalScope: "Tuvan",
    role: "rhythmic stirrup-associated ornament",
    description: "A gently asymmetric two-pulse motion in level and spectral focus.",
    approximation: "The stirrup association is cultural terminology, not a measured oscillator waveform; the two-pulse gesture is an intentionally labeled synthesis interpretation.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 132,
      harmonicNumber: 10,
      intensity: 0.7,
      foldTenseness: 0.62,
      roughness: 0.18,
      formantConvergence: 0.84,
      formantSeparationHz: 580,
      focusBandwidthHz: 122,
      uvularConstriction: 0.6,
      alveolarConstriction: 0.82,
      frontCavityExpansion: 0.64,
      mouthOpening: 0.56,
      lipRounding: 0.2,
      vibratoRateHz: 4.4,
      vibratoDepthCents: 11,
      motionRateHz: 2.6,
      motionDepth: 0.28,
      amplitudeMotionDepth: 0.34,
      motionShape: "stirrup",
    },
  }),
  preset({
    id: "western-overtone",
    label: "Western overtone — comparison",
    culturalScope: "Non-Tuvan comparison",
    role: "focused-overtone comparison",
    description: "A clean modal source with a wider, less extreme movable overtone focus.",
    approximation: "This broad comparison does not represent a single Western school or performer and is kept explicitly separate from the five Tuvan presets.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 140,
      harmonicNumber: 10,
      intensity: 0.68,
      foldTenseness: 0.6,
      roughness: 0.08,
      formantConvergence: 0.76,
      formantSeparationHz: 590,
      focusBandwidthHz: 142,
      uvularConstriction: 0.46,
      alveolarConstriction: 0.76,
      frontCavityExpansion: 0.54,
      mouthOpening: 0.56,
      lipRounding: 0.12,
      vibratoRateHz: 5,
      vibratoDepthCents: 22,
      motionRateHz: 0.45,
      motionDepth: 0.07,
      amplitudeMotionDepth: 0.03,
      motionShape: "sine",
    },
  }),
  preset({
    id: "low-chant",
    label: "Low chant — comparison",
    culturalScope: "Non-Tuvan comparison",
    role: "generic low-register chant comparison",
    description: "A low modal chant with broad resonances and no claimed Tuvan overtone focus.",
    approximation: "This deliberately generic comparison is not labeled Tibetan, Tuvan, Mongolian, or as any other culture-specific chant practice.",
    values: {
      ...COMMON_SOURCE_VALUES,
      trueFoldHz: 82,
      harmonicNumber: 8,
      intensity: 0.7,
      foldTenseness: 0.42,
      roughness: 0.24,
      creakAmount: 0.24,
      falseFoldCoupling: 0.04,
      formantConvergence: 0.24,
      formantSeparationHz: 680,
      focusBandwidthHz: 280,
      uvularConstriction: 0.5,
      alveolarConstriction: 0.3,
      frontCavityExpansion: 0.35,
      tractLengthCm: 19,
      mouthOpening: 0.78,
      lipRounding: 0.24,
      vibratoRateHz: 4.2,
      vibratoDepthCents: 24,
      motionRateHz: 0.32,
      motionDepth: 0.04,
      amplitudeMotionDepth: 0.035,
      motionShape: "sine",
      level: 0.34,
    },
  }),
]);

// Shorter alias for consumers that already use PRESETS naming elsewhere.
export const THROAT_SINGING_PRESETS = THROAT_SINGING_STYLE_PRESETS;

const presetById = new Map(
  THROAT_SINGING_STYLE_PRESETS.map((entry) => [entry.id, entry]),
);

export function throatSingingPreset(id = "open-drone") {
  return presetById.get(id) ?? presetById.get("open-drone");
}

export const THROAT_SINGING_DEFAULTS = deepFreeze({
  styleId: "open-drone",
  active: false,
  ...throatSingingPreset("open-drone").settings,
});

export const DEFAULT_THROAT_SINGING_STATE = THROAT_SINGING_DEFAULTS;

function requestedNumericValue(source, key) {
  if (key === "uvularConstriction") {
    return source.uvularConstriction ?? source.pharyngealConstriction;
  }
  if (key === "alveolarConstriction") {
    return source.alveolarConstriction ?? source.oralConstriction;
  }
  return source[key];
}

export function sanitizeThroatSingingState(
  candidate = {},
  fallback = THROAT_SINGING_DEFAULTS,
) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const base = fallback && typeof fallback === "object"
    ? fallback
    : THROAT_SINGING_DEFAULTS;
  const style = throatSingingPreset(source.styleId ?? base.styleId);
  const styleValues = style.settings;
  const result = { styleId: style.id, active: Boolean(source.active ?? base.active ?? false) };

  for (const [key, [minimum, maximum]] of Object.entries(THROAT_SINGING_LIMITS)) {
    const requested = requestedNumericValue(source, key);
    const fallbackValue = requestedNumericValue(base, key);
    result[key] = clamp(
      finiteOr(requested, finiteOr(fallbackValue, styleValues[key])),
      minimum,
      maximum,
    );
  }

  result.falseFoldDivision = Math.round(result.falseFoldDivision);
  result.harmonicNumber = Math.round(result.harmonicNumber);
  const requestedShape = source.motionShape ?? base.motionShape ?? styleValues.motionShape;
  result.motionShape = THROAT_SINGING_MOTION_SHAPES.includes(requestedShape)
    ? requestedShape
    : styleValues.motionShape;

  // Readable anatomical aliases avoid forcing UI/audio consumers to choose
  // between the research paper's regional and landmark terminology.
  result.pharyngealConstriction = result.uvularConstriction;
  result.oralConstriction = result.alveolarConstriction;
  return result;
}

export function throatSingingState(styleId = "open-drone", overrides = {}) {
  const selected = throatSingingPreset(styleId);
  return sanitizeThroatSingingState({
    ...THROAT_SINGING_DEFAULTS,
    ...selected.settings,
    ...overrides,
    styleId: selected.id,
  });
}

/** Resolve the true-vocal-fold repetition frequency represented by a state. */
export function trueFoldFrequencyHz(candidate = THROAT_SINGING_DEFAULTS) {
  if (typeof candidate === "number") {
    return clamp(candidate, ...THROAT_SINGING_LIMITS.trueFoldHz);
  }
  return sanitizeThroatSingingState(candidate).trueFoldHz;
}

/**
 * Resolve the frequency of the complete true/ventricular-fold closure pattern.
 * A division of two represents one ventricular closure for every two true-fold
 * cycles; it is not a second independent note.
 */
export function closurePatternFrequencyHz(
  candidate = THROAT_SINGING_DEFAULTS,
  requestedDivision,
) {
  if (typeof candidate === "number") {
    const division = Math.round(clamp(
      requestedDivision ?? 1,
      ...THROAT_SINGING_LIMITS.falseFoldDivision,
    ));
    return Math.max(1, finiteOr(candidate, THROAT_SINGING_DEFAULTS.trueFoldHz)) / division;
  }
  const state = sanitizeThroatSingingState(candidate);
  return state.trueFoldHz / state.falseFoldDivision;
}

/**
 * Resolve the most defensible low-drone readout. With negligible ventricular
 * coupling, identical pulses still repeat at the true-fold rate even when a
 * longer closure pattern is armed. Once pulse suppression is audible, the
 * pattern frequency becomes the low fundamental.
 */
export function heardDroneFrequencyHz(
  candidate = THROAT_SINGING_DEFAULTS,
  requestedDivision,
) {
  if (typeof candidate === "number") {
    return closurePatternFrequencyHz(candidate, requestedDivision);
  }
  const state = sanitizeThroatSingingState(candidate);
  return state.falseFoldDivision > 1
    && state.falseFoldCoupling >= FALSE_FOLD_AUDIBILITY_THRESHOLD
    ? closurePatternFrequencyHz(state)
    : state.trueFoldHz;
}

/**
 * Build one phase-locked laryngeal supercycle for Web Audio's PeriodicWave.
 * At zero coupling all pulses are identical, so only harmonics at multiples of
 * `division` survive and the source repeats at the true-fold rate. Coupling
 * progressively suppresses the last pulse in each pattern, exposing a genuine
 * f0/division component without adding an unrelated bass oscillator.
 */
export function ventricularFoldSupercycle(
  candidate = THROAT_SINGING_DEFAULTS,
  { harmonicCount = 48, sampleCount = 768 } = {},
) {
  const state = sanitizeThroatSingingState(candidate);
  const division = state.falseFoldDivision;
  let samples = Math.round(clamp(finiteOr(sampleCount, 768), 192, 2048));
  samples += (division - samples % division) % division;
  const harmonics = Math.round(clamp(
    finiteOr(harmonicCount, 48),
    8,
    Math.min(96, Math.floor(samples / 2) - 1),
  ));
  const real = new Float32Array(harmonics + 1);
  const imaginary = new Float32Array(harmonics + 1);
  const closure = new Float32Array(samples);
  const closureHalfWidth = 0.16 - 0.055 * state.foldTenseness;
  let closureSum = 0;
  let squaredClosureSum = 0;

  const smoothstep = (value) => {
    const amount = clamp(value);
    return amount * amount * (3 - 2 * amount);
  };

  for (let index = 0; index < samples; index += 1) {
    const phase = (index + 0.5) / samples;
    const pulsePosition = phase * division;
    const pulseIndex = Math.min(division - 1, Math.floor(pulsePosition));
    const pulsePhase = pulsePosition - pulseIndex;
    const distance = Math.min(
      Math.abs(pulsePhase - 0.72),
      1 - Math.abs(pulsePhase - 0.72),
    );
    const collisionWindow = distance < closureHalfWidth
      ? 0.5 + 0.5 * Math.cos(Math.PI * distance / closureHalfWidth)
      : 0;
    let amount = 0;
    if (division === 1) {
      amount = 0.9 * collisionWindow;
    } else if (pulseIndex === division - 1) {
      const edge = smoothstep(pulsePhase / 0.08)
        * smoothstep((1 - pulsePhase) / 0.08);
      amount = edge * (0.7 + 0.28 * collisionWindow);
    }
    closure[index] = amount;
    closureSum += amount;
    squaredClosureSum += amount * amount;
  }

  const meanClosure = closureSum / samples;
  const meanSquaredClosure = squaredClosureSum / samples;

  for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < samples; index += 1) {
      const phase = (index + 0.5) / samples;
      const centeredClosure = meanClosure - closure[index];
      const angle = TAU * harmonic * phase;
      cosine += centeredClosure * Math.cos(angle);
      sine += centeredClosure * Math.sin(angle);
    }
    real[harmonic] = cosine * 2 / samples;
    imaginary[harmonic] = sine * 2 / samples;
  }

  return Object.freeze({
    real,
    imaginary,
    division,
    meanClosure,
    meanSquaredClosure,
    baseFrequencyRatio: 1 / division,
  });
}

/**
 * Build a smooth five-cycle modulation pattern for a creaky / vocal-fry proxy.
 *
 * Vocal fry is not just noise: measured creak can contain irregular or
 * multiply pulsed glottal cycles with changing timing and amplitude. This
 * deterministic supercycle is applied to the true-fold source's detune and
 * gain at f0 / 5. The `creakAmount` control scales it smoothly in the audio
 * graph; it remains distinct from the ventricular-fold closure oscillator.
 */
export function vocalFryModulationSupercycle(
  { harmonicCount = 48, sampleCount = 960 } = {},
) {
  const cycleCount = 5;
  let samples = Math.round(clamp(finiteOr(sampleCount, 960), 240, 4096));
  samples += (cycleCount - samples % cycleCount) % cycleCount;
  const harmonics = Math.round(clamp(
    finiteOr(harmonicCount, 48),
    8,
    Math.min(96, Math.floor(samples / 2) - 1),
  ));
  const real = new Float32Array(harmonics + 1);
  const imaginary = new Float32Array(harmonics + 1);
  const contour = new Float32Array(samples);
  const pulsePattern = Object.freeze([0.62, -0.48, 0.16, -0.3, 0]);
  const smoothstep = (value) => {
    const amount = clamp(value);
    return amount * amount * (3 - 2 * amount);
  };
  let sum = 0;
  let minimum = Infinity;
  let maximum = -Infinity;

  for (let index = 0; index < samples; index += 1) {
    const position = (index + 0.5) / samples * cycleCount;
    const pulseIndex = Math.min(cycleCount - 1, Math.floor(position));
    const pulsePhase = position - pulseIndex;
    const from = pulsePattern[pulseIndex];
    const to = pulsePattern[(pulseIndex + 1) % cycleCount];
    const value = from + (to - from) * smoothstep(pulsePhase);
    contour[index] = value;
    sum += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  const mean = sum / samples;
  for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < samples; index += 1) {
      const phase = (index + 0.5) / samples;
      const value = contour[index] - mean;
      const angle = TAU * harmonic * phase;
      cosine += value * Math.cos(angle);
      sine += value * Math.sin(angle);
    }
    real[harmonic] = cosine * 2 / samples;
    imaginary[harmonic] = sine * 2 / samples;
  }

  return Object.freeze({
    real,
    imaginary,
    cycleCount,
    mean,
    minimum,
    maximum,
    baseFrequencyRatio: 1 / cycleCount,
  });
}

export function trueFoldFrequencyForDroneHz(droneHz, requestedDivision = 1) {
  const division = Math.round(clamp(
    requestedDivision,
    ...THROAT_SINGING_LIMITS.falseFoldDivision,
  ));
  return clamp(
    Math.max(1, finiteOr(droneHz, heardDroneFrequencyHz())) * division,
    ...THROAT_SINGING_LIMITS.trueFoldHz,
  );
}

/** Harmonic selection is counted from the heard drone, including period division. */
export function harmonicFrequencyHz(
  candidate = THROAT_SINGING_DEFAULTS,
  requestedHarmonic,
) {
  if (typeof candidate === "number") {
    const harmonic = Math.round(clamp(
      requestedHarmonic ?? THROAT_SINGING_DEFAULTS.harmonicNumber,
      ...THROAT_SINGING_LIMITS.harmonicNumber,
    ));
    return Math.max(1, finiteOr(candidate, heardDroneFrequencyHz())) * harmonic;
  }
  const state = sanitizeThroatSingingState(candidate);
  const harmonic = Math.round(clamp(
    requestedHarmonic ?? state.harmonicNumber,
    ...THROAT_SINGING_LIMITS.harmonicNumber,
  ));
  return heardDroneFrequencyHz(state) * harmonic;
}

function ordinal(value) {
  const integer = Math.abs(Math.trunc(value));
  const lastTwo = integer % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${integer}th`;
  if (integer % 10 === 1) return `${integer}st`;
  if (integer % 10 === 2) return `${integer}nd`;
  if (integer % 10 === 3) return `${integer}rd`;
  return `${integer}th`;
}

export function harmonicLabel(
  candidate = THROAT_SINGING_DEFAULTS,
  requestedHarmonic,
) {
  const state = typeof candidate === "number" ? null : sanitizeThroatSingingState(candidate);
  const harmonic = Math.round(clamp(
    requestedHarmonic ?? state?.harmonicNumber ?? THROAT_SINGING_DEFAULTS.harmonicNumber,
    ...THROAT_SINGING_LIMITS.harmonicNumber,
  ));
  const frequency = harmonicFrequencyHz(candidate, harmonic);
  const frequencyLabel = frequency >= 1_000
    ? `${(frequency / 1_000).toFixed(2)} kHz`
    : `${Math.round(frequency)} Hz`;
  return `H${harmonic} · ${ordinal(harmonic)} harmonic · ${frequencyLabel}`;
}

/**
 * Approximate the two resonances that create one focused spectral peak.
 * `formantConvergence=1` places F2 and F3 at the same target; lower values
 * restore a progressively wider split around the selected harmonic.
 */
export function dualFocusTargets(
  candidate = THROAT_SINGING_DEFAULTS,
  requestedTargetHz,
) {
  const state = sanitizeThroatSingingState(candidate);
  const targetHz = Math.max(
    80,
    finiteOr(requestedTargetHz, harmonicFrequencyHz(state)),
  );
  const separationHz = state.formantSeparationHz
    * Math.pow(1 - state.formantConvergence, 1.28);
  const uvularSkew = (state.uvularConstriction - 0.5) * separationHz * 0.08;
  const f2Hz = targetHz - separationHz * 0.5 + uvularSkew;
  const f3Hz = targetHz + separationHz * 0.5 + uvularSkew;
  return deepFreeze({
    targetHz,
    harmonicNumber: state.harmonicNumber,
    f2Hz,
    f3Hz,
    separationHz: f3Hz - f2Hz,
    bandwidthHz: state.focusBandwidthHz,
    formantConvergence: state.formantConvergence,
    merged: f3Hz - f2Hz <= state.focusBandwidthHz,
    relativeFocusGainDbApprox: 3 + state.formantConvergence * 13,
  });
}

function gaussian(position, center, radius) {
  const normalized = (position - center) / Math.max(0.0001, radius);
  return Math.exp(-0.5 * normalized * normalized);
}

function sectionForDistance(distanceCm, tractLengthCm) {
  return Math.round(
    clamp(distanceCm / tractLengthCm) * (THROAT_SINGING_TRACT_SECTION_COUNT - 1),
  );
}

function constrictionRecord({
  id,
  label,
  kind,
  centerCm,
  radiusCm,
  strength,
  minimumAreaCm2 = null,
  areaGainCm2 = null,
}, tractLengthCm) {
  const sectionScale = (THROAT_SINGING_TRACT_SECTION_COUNT - 1) / tractLengthCm;
  return deepFreeze({
    id,
    label,
    kind,
    centerCm,
    centerSection: sectionForDistance(centerCm, tractLengthCm),
    radiusCm,
    radiusSections: radiusCm * sectionScale,
    strength,
    minimumAreaCm2,
    areaGainCm2,
  });
}

export function throatSingingWaveguideDeformations(
  candidate = THROAT_SINGING_DEFAULTS,
) {
  const state = sanitizeThroatSingingState(candidate);
  return deepFreeze([
    constrictionRecord({
      id: "uvular-pharyngeal",
      label: "Uvula / upper pharynx",
      kind: "constriction",
      centerCm: UVULAR_CENTER_CM,
      radiusCm: 1.05,
      strength: state.uvularConstriction,
      minimumAreaCm2: 0.2,
    }, state.tractLengthCm),
    constrictionRecord({
      id: "alveolar-oral",
      label: "Alveolar ridge / oral cavity",
      kind: "constriction",
      centerCm: ALVEOLAR_CENTER_CM,
      radiusCm: 0.72,
      strength: state.alveolarConstriction,
      minimumAreaCm2: FOCUS_MINIMUM_AREA_CM2,
    }, state.tractLengthCm),
    constrictionRecord({
      id: "anterior-expansion",
      label: "Anterior oral expansion",
      kind: "expansion",
      centerCm: FRONT_CAVITY_CENTER_CM,
      radiusCm: 0.9,
      strength: state.frontCavityExpansion,
      areaGainCm2: 2.1,
    }, state.tractLengthCm),
  ]);
}

/**
 * Build a 44-section circular-equivalent tract. Areas are the useful acoustic
 * quantity; diameters are supplied for compatibility with the existing
 * Throatazoid travelling-wave tract.
 */
export function throatSingingTractProfile(
  candidate = THROAT_SINGING_DEFAULTS,
) {
  const state = sanitizeThroatSingingState(candidate);
  const sectionCount = THROAT_SINGING_TRACT_SECTION_COUNT;
  const lastSection = sectionCount - 1;
  const sectionLengthCm = state.tractLengthCm / lastSection;
  const deformations = throatSingingWaveguideDeformations(state);
  const [uvular, alveolar, anterior] = deformations;
  const areas = [];

  for (let index = 0; index < sectionCount; index += 1) {
    const progress = index / lastSection;
    const distanceCm = progress * state.tractLengthCm;
    let area = 1.45
      + 1.18 * gaussian(progress, 0.25, 0.18)
      + 1.9 * gaussian(progress, 0.57, 0.2)
      + 1.3 * gaussian(progress, 0.78, 0.15);

    // Keep the first section glottal-scale without closing the waveguide.
    area *= 0.46 + 0.54 * Math.min(1, progress / 0.1);

    const uvularWeight = uvular.strength * gaussian(
      index,
      uvular.centerSection,
      uvular.radiusSections,
    );
    area += (uvular.minimumAreaCm2 - area) * uvularWeight;

    const alveolarWeight = alveolar.strength * gaussian(
      index,
      alveolar.centerSection,
      alveolar.radiusSections,
    );
    area += (alveolar.minimumAreaCm2 - area) * alveolarWeight;

    area += anterior.areaGainCm2
      * anterior.strength
      * gaussian(index, anterior.centerSection, anterior.radiusSections);

    const lipProgress = clamp((progress - 0.88) / 0.12);
    const lipArea = (0.42 + state.mouthOpening * 2.25) * (1 - state.lipRounding * 0.42);
    area += (lipArea - area) * lipProgress;
    areas.push(clamp(area, 0.045, 12));
  }

  const diameters = areas.map((area) => 2 * Math.sqrt(area / Math.PI));
  return deepFreeze({
    sectionCount,
    tractLengthCm: state.tractLengthCm,
    sectionLengthCm,
    areasCm2: areas,
    diametersCm: diameters,
    diameters,
    deformations,
    constrictions: deformations.filter(({ kind }) => kind === "constriction"),
    expansions: deformations.filter(({ kind }) => kind === "expansion"),
  });
}

export function throatSingingTractDiameters(
  candidate = THROAT_SINGING_DEFAULTS,
) {
  return Float32Array.from(throatSingingTractProfile(candidate).diametersCm);
}

export function throatSingingWaveguideConfig(
  candidate = THROAT_SINGING_DEFAULTS,
  sampleRate = 48_000,
) {
  const state = sanitizeThroatSingingState(candidate);
  const profile = throatSingingTractProfile(state);
  const reflections = [];
  for (let index = 0; index < profile.areasCm2.length - 1; index += 1) {
    const left = profile.areasCm2[index];
    const right = profile.areasCm2[index + 1];
    reflections.push(clamp((left - right) / (left + right), -0.999, 0.999));
  }
  const safeSampleRate = clamp(sampleRate, 8_000, 384_000);
  const bodyLength = clamp(
    (state.tractLengthCm - THROAT_SINGING_LIMITS.tractLengthCm[0])
      / (THROAT_SINGING_LIMITS.tractLengthCm[1] - THROAT_SINGING_LIMITS.tractLengthCm[0]),
  );
  const mouthAperture = clamp(0.28 + state.mouthOpening * 0.72);
  const lipDiameter = clamp(
    0.35 + state.mouthOpening * 2.65 * (1 - state.lipRounding * 0.42),
    0.35,
    3,
  );
  const tongue = {
    // The dedicated deformations below carry the narrow uvular and alveolar
    // constrictions; this tongue supplies the tract processor's broad vowel
    // envelope without pretending one point control is a measured tongue pose.
    position: clamp(0.5 + state.alveolarConstriction * 0.14),
    height: clamp(0.18 + state.alveolarConstriction * 0.2),
    curl: clamp(0.42 + state.frontCavityExpansion * 0.24),
  };
  const tractDeformations = profile.deformations.map((deformation) => ({
    id: deformation.id,
    label: deformation.label,
    center: deformation.centerSection,
    radius: deformation.radiusSections,
    height: deformation.kind === "expansion"
      ? 1.12
      : deformation.id === "alveolar-oral"
        ? -1.42
        : -0.94,
    strength: deformation.strength,
  }));
  const mouth = {
    aperture: mouthAperture,
    length: bodyLength,
    closed: false,
    tongueIndex: 0,
    noseIndex: -1,
  };
  const nose = { openness: 0, length: bodyLength, resonance: 0.5 };
  const pressureSource = { open: true, level: state.intensity };
  return deepFreeze({
    // This block is intentionally shaped as a complete configuration for
    // throatazoid-tract-processor. Extra analysis fields later in the object
    // are ignored by the AudioWorklet and remain useful to visualizers.
    mouthCount: 1,
    throatCount: 1,
    selectedMouth: 0,
    articulateAll: true,
    classicTopology: true,
    voiceMode: "shared",
    bodyLength,
    tension: state.foldTenseness,
    mutation: state.roughness * 0.12,
    coupling: 0,
    spread: 0,
    oralClosure: 0,
    articulationPlace: tongue.position,
    articulationIndex: profile.deformations[1].centerSection,
    articulationAperture: 1,
    articulationVoicing: 1,
    articulationManner: "vowel",
    glottalClosure: 0,
    fricationGain: 0,
    burstGain: 0,
    performanceGate: state.active ? 1 : 0,
    exciterPitch: state.trueFoldHz,
    exciterIntensity: state.intensity,
    exciterTenseness: state.foldTenseness,
    exciterWobble: state.roughness,
    sourceMode: "glottis",
    pressureSourceCount: 1,
    pressureSource,
    pressureSources: [pressureSource],
    mouth,
    mouths: [mouth],
    throats: [mouth],
    tongueCount: 1,
    tongue,
    tongues: [tongue],
    // noseCount=0 is understood by the app's manifold model. The processor
    // also receives an explicitly closed first nasal airway, so its internal
    // one-airway fallback still has zero velopharyngeal opening.
    nasal: { enabled: false, coupling: 0 },
    nasalCoupling: 0,
    noseCount: 0,
    nose,
    noses: [nose],
    lip: {
      diameter: lipDiameter,
      opening: state.mouthOpening,
      rounding: state.lipRounding,
    },
    lipDiameter,
    tractDeformations,
    sectionCount: THROAT_SINGING_TRACT_SECTION_COUNT,
    sampleRate: safeSampleRate,
    tractLengthM: state.tractLengthCm / 100,
    sectionLengthM: state.tractLengthCm / 100 / THROAT_SINGING_TRACT_SECTION_COUNT,
    diametersCm: profile.diametersCm,
    areasCm2: profile.areasCm2,
    reflectionCoefficients: reflections,
    deformations: profile.deformations,
    glottalReflection: clamp(
      0.74 + state.foldTenseness * 0.08 + state.creakAmount * 0.03,
      0.68,
      0.86,
    ),
    lipReflection: -0.82 - state.lipRounding * 0.1,
    junctionLoss: clamp(0.9994 - state.roughness * 0.00045, 0.996, 0.9995),
    source: {
      trueFoldHz: state.trueFoldHz,
      heardDroneHz: heardDroneFrequencyHz(state),
      falseFoldDivision: state.falseFoldDivision,
      falseFoldCoupling: state.falseFoldCoupling,
      intensity: state.intensity,
      foldTenseness: state.foldTenseness,
      creakAmount: state.creakAmount,
      roughness: state.roughness,
    },
    focus: dualFocusTargets(state),
  });
}

export function sampleThroatSingingMotion(shape = "sine", phase = 0, seed = 0) {
  const numericPhase = finiteOr(phase, 0);
  const cycle = ((numericPhase % 1) + 1) % 1;
  if (shape === "triangle") return 1 - Math.abs(cycle - 0.5) * 4;
  if (shape === "pulse") return cycle < 0.24 ? 1 : -0.32;
  if (shape === "stirrup") {
    const first = gaussian(cycle, 0.18, 0.075);
    const second = gaussian(cycle, 0.62, 0.12) * 0.72;
    return clamp((first + second) * 1.6 - 0.54, -1, 1);
  }
  if (shape === "sample-hold") {
    const bucket = Math.floor(numericPhase);
    const noise = Math.sin((bucket + finiteOr(seed, 0) + 1) * 12.9898) * 43_758.5453;
    return (noise - Math.floor(noise)) * 2 - 1;
  }
  return Math.sin(cycle * TAU);
}

/**
 * Apply the named performance motion without mutating the authored state.
 * Returned telemetry lets the renderer and audio engine share one clock.
 */
export function modulateThroatSingingPerformance(
  candidate = THROAT_SINGING_DEFAULTS,
  elapsedSeconds = 0,
  gesture = {},
) {
  const base = sanitizeThroatSingingState(candidate);
  const requestedGesture = gesture && typeof gesture === "object" ? gesture : {};
  const elapsed = Math.max(0, finiteOr(elapsedSeconds, 0));
  const motionScale = clamp(finiteOr(requestedGesture.motionScale, 1), 0, 2);
  const motionPhase = elapsed * base.motionRateHz
    + finiteOr(requestedGesture.motionPhaseOffset, 0);
  const motionWave = sampleThroatSingingMotion(base.motionShape, motionPhase);
  const vibratoWave = Math.sin(elapsed * base.vibratoRateHz * TAU);
  const vibratoCents = vibratoWave * base.vibratoDepthCents * motionScale;
  const pitchCents = vibratoCents + finiteOr(requestedGesture.pitchCents, 0);
  const requestedFoldHz = finiteOr(
    requestedGesture.foldFrequencyHz ?? requestedGesture.trueFoldHz,
    base.trueFoldHz * Math.pow(2, pitchCents / 1_200),
  );
  const foldFrequencyHz = clamp(
    requestedFoldHz,
    ...THROAT_SINGING_LIMITS.trueFoldHz,
  );
  const harmonicNumber = Math.round(clamp(
    finiteOr(
      requestedGesture.harmonicNumber,
      base.harmonicNumber + finiteOr(requestedGesture.harmonicOffset, 0),
    ),
    ...THROAT_SINGING_LIMITS.harmonicNumber,
  ));
  const amplitudeScale = clamp(
    finiteOr(requestedGesture.amplitudeScale, 1)
      * (1 + motionWave * base.amplitudeMotionDepth * 0.42 * motionScale),
    0.5,
    1.42,
  );
  const sourcePressure = clamp(finiteOr(
    requestedGesture.sourcePressure,
    base.intensity * amplitudeScale,
  ));
  const focusAmount = clamp(finiteOr(
    requestedGesture.focusAmount,
    base.formantConvergence + motionWave * base.motionDepth * 0.045 * motionScale,
  ));
  const modulated = sanitizeThroatSingingState({
    ...base,
    trueFoldHz: foldFrequencyHz,
    harmonicNumber,
    intensity: sourcePressure,
    formantConvergence: focusAmount,
    uvularConstriction: base.uvularConstriction
      + motionWave * base.motionDepth * 0.2 * motionScale
      + finiteOr(requestedGesture.uvularOffset, 0),
    alveolarConstriction: base.alveolarConstriction
      - motionWave * base.motionDepth * 0.055 * motionScale
      + finiteOr(requestedGesture.alveolarOffset, 0),
    frontCavityExpansion: base.frontCavityExpansion
      + motionWave * base.motionDepth * 0.08 * motionScale,
  }, base);
  const selectedHarmonicHz = harmonicFrequencyHz(modulated);
  const focusFrequencyHz = selectedHarmonicHz * Math.pow(
    2,
    motionWave * base.motionDepth * 0.13 * motionScale
      + finiteOr(requestedGesture.focusOffsetSemitones, 0) / 12,
  );
  return deepFreeze({
    ...modulated,
    harmonicNumber,
    foldFrequencyHz,
    sourcePressure,
    focusAmount,
    elapsedSeconds: elapsed,
    motionPhase,
    motionWave,
    vibratoCents,
    amplitudeScale,
    heardDroneHz: heardDroneFrequencyHz(modulated),
    selectedHarmonicHz,
    focusFrequencyHz,
    focus: dualFocusTargets(modulated, focusFrequencyHz),
  });
}

export const throatSingingPerformance = modulateThroatSingingPerformance;
