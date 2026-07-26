const DEFAULT_SAMPLE_RATE = 48_000;

export const RECURSIVE_FM_LIMITS = Object.freeze({
  minDepth: 0,
  maxDepth: 10,
  minCarrierHz: 0.01,
  maxCarrierHz: 4_800,
  maxOffsetHz: 12_000,
  maxModulationHz: 12_000,
  minDivisor: 0.001,
  maxDivisor: 8,
});

const freezePreset = (preset) => Object.freeze({
  ...preset,
  settings: Object.freeze({ ...preset.settings }),
});

/**
 * The six parameter sets from the original Morphisma Recursive FM experiment.
 * Names and descriptions are new; the synthesis values are preserved exactly.
 */
export const RECURSIVE_FM_PRESETS = Object.freeze([
  freezePreset({
    id: "seed-pulse",
    label: "Seed Pulse",
    description: "The unrolled seed: one slow carrier and one wide frequency sweep.",
    settings: {
      depth: 0,
      carrierHz: 1,
      offsetHz: 0,
      modulationHz: 500,
      divisor: 2,
    },
  }),
  freezePreset({
    id: "deep-well",
    label: "Deep Well",
    description: "The original default: three descending layers around a 3.32 Hz seed.",
    settings: {
      depth: 3,
      carrierHz: 3.32,
      offsetHz: 0,
      modulationHz: 7_307,
      divisor: 3.68,
    },
  }),
  freezePreset({
    id: "glass-lattice",
    label: "Glass Lattice",
    description: "A high offset turns the recursive stack into a bright, close-spaced lattice.",
    settings: {
      depth: 3,
      carrierHz: 5.25,
      offsetHz: 5_057,
      modulationHz: 6_508,
      divisor: 5.56,
    },
  }),
  freezePreset({
    id: "undertow",
    label: "Undertow",
    description: "A near-static seed and a divisor below one make each inner turn wider.",
    settings: {
      depth: 3,
      carrierHz: 0.06,
      offsetHz: 0,
      modulationHz: 1_650,
      divisor: 0.18,
    },
  }),
  freezePreset({
    id: "high-window",
    label: "High Window",
    description: "A 4 kHz offset with slowly unfolding recursive sidebands.",
    settings: {
      depth: 3,
      carrierHz: 0.18,
      offsetHz: 4_000,
      modulationHz: 4_236,
      divisor: 1.53,
    },
  }),
  freezePreset({
    id: "bent-brass",
    label: "Bent Brass",
    description: "A rising recursive amount gives this preset its dense metallic bend.",
    settings: {
      depth: 3,
      carrierHz: 7,
      offsetHz: 2_000,
      modulationHz: 2_340,
      divisor: 0.75,
    },
  }),
]);

export const DEFAULT_RECURSIVE_FM_PRESET_ID = "deep-well";

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sampleRateLimit(sampleRate) {
  const safeSampleRate = clamp(
    finiteNumber(sampleRate, DEFAULT_SAMPLE_RATE),
    8_000,
    192_000,
  );
  return Math.min(20_000, safeSampleRate * 0.45);
}

function legacyValue(settings, currentName, legacyName, fallback) {
  return settings?.[currentName] ?? settings?.[legacyName] ?? fallback;
}

/**
 * Sanitize UI, preset, or legacy values before they reach an AudioParam.
 * The first modulated oscillator spans offset → offset + modulation, so its
 * modulation range is also restricted by the available frequency headroom.
 */
export function sanitizeRecursiveFmSettings(
  settings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const maximumFrequencyHz = sampleRateLimit(sampleRate);
  const depth = clamp(
    Math.round(finiteNumber(
      legacyValue(settings, "depth", "steps", 3),
      3,
    )),
    RECURSIVE_FM_LIMITS.minDepth,
    RECURSIVE_FM_LIMITS.maxDepth,
  );
  const carrierHz = clamp(
    finiteNumber(
      legacyValue(settings, "carrierHz", "carrierFreq", 3.32),
      3.32,
    ),
    RECURSIVE_FM_LIMITS.minCarrierHz,
    Math.min(RECURSIVE_FM_LIMITS.maxCarrierHz, maximumFrequencyHz),
  );
  const offsetHz = clamp(
    finiteNumber(
      legacyValue(settings, "offsetHz", "offset", 0),
      0,
    ),
    0,
    Math.min(RECURSIVE_FM_LIMITS.maxOffsetHz, maximumFrequencyHz),
  );
  const modulationCeiling = Math.min(
    RECURSIVE_FM_LIMITS.maxModulationHz,
    Math.max(0, maximumFrequencyHz - offsetHz),
  );
  const modulationHz = clamp(
    finiteNumber(
      legacyValue(settings, "modulationHz", "modAmp", 7_307),
      7_307,
    ),
    0,
    modulationCeiling,
  );
  const divisor = clamp(
    finiteNumber(
      legacyValue(settings, "divisor", "modAmpDiv", 3.68),
      3.68,
    ),
    RECURSIVE_FM_LIMITS.minDivisor,
    RECURSIVE_FM_LIMITS.maxDivisor,
  );

  return Object.freeze({
    depth,
    carrierHz,
    offsetHz,
    modulationHz,
    divisor,
    maximumFrequencyHz,
  });
}

function normalizedOutputGain(settings) {
  const depthPressure = 1 + settings.depth * 0.055;
  const frequencyPressure = 1 + (
    settings.modulationHz / Math.max(1, settings.maximumFrequencyHz)
  ) * 0.18;
  return clamp(0.38 / Math.sqrt(depthPressure * frequencyPressure), 0.2, 0.38);
}

function freezeOperator(operator) {
  return Object.freeze(operator);
}

/**
 * Derive the bounded operator graph corresponding to the legacy Elementary
 * Audio expression:
 *
 *   carrier → cycle(offset + amount/2 + carrier × amount/2)
 *           → cycle(previous × amount/2)
 *           → cycle(previous × amount/2/divisor) …
 *
 * Only the final selected operator is audible; earlier operators modulate it.
 */
export function deriveRecursiveFmStack(
  settings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const safe = sanitizeRecursiveFmSettings(settings, { sampleRate });
  const operators = [
    freezeOperator({
      index: 0,
      sourceIndex: null,
      kind: "carrier",
      biasHz: safe.carrierHz,
      modulationHz: 0,
    }),
    freezeOperator({
      index: 1,
      sourceIndex: 0,
      kind: "offset-operator",
      biasHz: safe.offsetHz + safe.modulationHz / 2,
      modulationHz: safe.modulationHz / 2,
    }),
  ];

  let recursiveAmount = safe.modulationHz / 2;
  for (let turn = 0; turn < safe.depth; turn += 1) {
    operators.push(freezeOperator({
      index: operators.length,
      sourceIndex: operators.length - 1,
      kind: "recursive-operator",
      biasHz: 0,
      modulationHz: Math.min(safe.maximumFrequencyHz, recursiveAmount),
      turn: turn + 1,
    }));
    recursiveAmount = Math.min(
      safe.maximumFrequencyHz,
      recursiveAmount / safe.divisor,
    );
  }

  return Object.freeze({
    settings: safe,
    operators: Object.freeze(operators),
    audibleIndex: operators.length - 1,
    normalizedGain: normalizedOutputGain(safe),
  });
}

export function summarizeRecursiveFmStack(stack) {
  const model = stack?.operators ? stack : deriveRecursiveFmStack(stack);
  const recursiveTurns = model.settings.depth;
  return Object.freeze({
    recursiveTurns,
    operatorCount: model.operators.length,
    audibleIndex: model.audibleIndex,
    label: `${recursiveTurns} ${recursiveTurns === 1 ? "recursion" : "recursions"} · ${model.operators.length} operators`,
  });
}

export function logarithmicSliderValue(
  position,
  minimum = RECURSIVE_FM_LIMITS.minCarrierHz,
  maximum = RECURSIVE_FM_LIMITS.maxCarrierHz,
) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.01));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, 4_800));
  const safePosition = clamp(finiteNumber(position, 0), 0, 1);
  return safeMinimum * ((safeMaximum / safeMinimum) ** safePosition);
}

export function logarithmicSliderPosition(
  value,
  minimum = RECURSIVE_FM_LIMITS.minCarrierHz,
  maximum = RECURSIVE_FM_LIMITS.maxCarrierHz,
) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.01));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, 4_800));
  const safeValue = clamp(finiteNumber(value, safeMinimum), safeMinimum, safeMaximum);
  if (safeMinimum === safeMaximum) return 0;
  return Math.log(safeValue / safeMinimum) / Math.log(safeMaximum / safeMinimum);
}

export function quadraticSliderValue(position, maximum = 12_000) {
  const safePosition = clamp(finiteNumber(position, 0), 0, 1);
  return safePosition * safePosition * Math.max(0, finiteNumber(maximum, 12_000));
}

export function quadraticSliderPosition(value, maximum = 12_000) {
  const safeMaximum = Math.max(Number.EPSILON, finiteNumber(maximum, 12_000));
  return Math.sqrt(clamp(finiteNumber(value, 0), 0, safeMaximum) / safeMaximum);
}

export function formatRecursiveFmFrequency(value) {
  const frequency = Math.max(0, finiteNumber(value, 0));
  if (frequency >= 1_000) {
    const digits = frequency >= 10_000 ? 1 : 2;
    return `${(frequency / 1_000).toFixed(digits).replace(/\.0+$/, "")} kHz`;
  }
  if (frequency >= 100) return `${Math.round(frequency)} Hz`;
  if (frequency >= 10) return `${frequency.toFixed(1).replace(/\.0$/, "")} Hz`;
  return `${frequency.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} Hz`;
}
