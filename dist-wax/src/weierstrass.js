import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const PROCESSOR_NAME = "morphazoid-weierstrass";
const TAU = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MAX_AUDIBLE_FREQUENCY = 20_000;
const MAX_TERMS = 48;
const ANTI_ALIAS_TAPER_START = 0.72;
const MATERIAL_WEIGHT_FLOOR = 0.001;
const DEFAULT_PM_CARRIER_FREQUENCY_HZ = 22;
const DEFAULT_PM_INDEX_CYCLES = 1;

export const WEIERSTRASS_LIMITS = Object.freeze({
  minTerms: 1,
  maxTerms: MAX_TERMS,
  minStartExponent: 0,
  maxStartExponent: 47,
  minAmplitudeRatio: 0,
  maxAmplitudeRatio: 2,
  minFrequencyRatio: 0.125,
  maxFrequencyRatio: 11,
  minBaseFrequencyHz: 0.001,
  maxBaseFrequencyHz: 2_000,
  maxFmDepthHz: 12_000,
  maxOffsetHz: 12_000,
  minPmCarrierFrequencyHz: 0.01,
  maxPmCarrierFrequencyHz: 1_200,
  maxPmIndexCycles: 20,
  maxOutput: 0.82,
});

/**
 * The legacy graph used cos(π · fundamental · b^n · t), so its labeled
 * fundamental ran at half the displayed number in hertz. Morphazoid stores
 * every source tuple unchanged, but makes the playable base-term rate honest.
 */
export const WEIERSTRASS_FREQUENCY_POLICY = Object.freeze({
  id: "legacy-pi-phasor-half-rate",
  label: "source fundamental ÷ 2",
  description: (
    "Playable base-term Hz equals the source tuple's fundamental divided by two; "
    + "continuous phases replace the old 60-second reset."
  ),
  convertLegacyFundamental(value) {
    return Number(value) / 2;
  },
});

/**
 * The PM source used a 240-second ramp multiplied by `fundamental * 60`
 * before its π phase term. Its continuous source-equivalent base rate is
 * therefore fundamental / 8, not the Wave/FM source's fundamental / 2.
 */
export const WEIERSTRASS_PM_FREQUENCY_POLICY = Object.freeze({
  id: "legacy-pm-240-second-phasor-eighth-rate",
  label: "PM source fundamental ÷ 8",
  description: (
    "Playable PM base-term Hz equals the source tuple's fundamental divided "
    + "by eight; continuous phases replace the old 240-second reset."
  ),
  convertLegacyFundamental(value) {
    return Number(value) / 8;
  },
});

const freezeTuple = (tuple) => Object.freeze([...tuple]);

export const WEIERSTRASS_LEGACY_WAVE_TUPLES = Object.freeze([
  freezeTuple([1.81, 9, 0.91, 7.07, 2]),
  freezeTuple([137, 13, 0.71, 1.41, 0]),
]);

export const WEIERSTRASS_LEGACY_FM_TUPLES = Object.freeze([
  freezeTuple([13.21, 28, 0.32, 5.01, 0, 700, 15.5]),
  freezeTuple([85.21, 18, 0.87, 7.56, 10, 1_800, 10]),
  freezeTuple([0.01, 23, 0.8, 5, 0, 500, 100]),
  freezeTuple([2.91, 2, 0.07, 6.55, 0, 640, 140]),
  freezeTuple([5, 33, 0.49, 2.96, 0, 3_000, 100]),
]);

export const WEIERSTRASS_LEGACY_PM_TUPLES = Object.freeze([
  freezeTuple([100, 4, 0.5, 0.5, 1, 22, 1]),
]);

const WEIERSTRASS_NATIVE_PM_TUPLES = Object.freeze([
  freezeTuple([72, 7, 0.68, 1.41, 0, 82, 0.22]),
  freezeTuple([36, 12, 0.74, 1.73, 0, 196, 0.68]),
]);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(
    maximum,
    Math.max(minimum, finiteNumber(value, fallback)),
  );
}

function sampleRateCeiling(sampleRate) {
  const safeSampleRate = clamp(
    sampleRate,
    8_000,
    192_000,
    DEFAULT_SAMPLE_RATE,
  );
  return Math.min(MAX_AUDIBLE_FREQUENCY, safeSampleRate * 0.45);
}

function legacyValue(params, currentName, legacyName, fallback) {
  return params?.[currentName] ?? params?.[legacyName] ?? fallback;
}

export function finiteAbsoluteWeightSum({
  terms,
  amplitudeRatio,
  startExponent,
}) {
  const safeTerms = Math.round(clamp(
    terms,
    WEIERSTRASS_LIMITS.minTerms,
    WEIERSTRASS_LIMITS.maxTerms,
    1,
  ));
  const safeRatio = clamp(
    amplitudeRatio,
    WEIERSTRASS_LIMITS.minAmplitudeRatio,
    WEIERSTRASS_LIMITS.maxAmplitudeRatio,
    0.5,
  );
  const safeStart = Math.round(clamp(
    startExponent,
    WEIERSTRASS_LIMITS.minStartExponent,
    WEIERSTRASS_LIMITS.maxStartExponent,
    0,
  ));
  let sum = 0;
  for (let index = 0; index < safeTerms; index += 1) {
    const weight = Math.abs(safeRatio ** (safeStart + index));
    if (Number.isFinite(weight)) sum += weight;
  }
  return sum;
}

function sourceSettingsFromTuple(tuple, mode, {
  playableStartExponent = tuple[4],
} = {}) {
  const sourceWeightSum = finiteAbsoluteWeightSum({
    terms: tuple[1],
    amplitudeRatio: tuple[2],
    startExponent: tuple[4],
  });
  return {
    settings: {
      mode,
      baseFrequencyHz: (
        mode === "pm"
          ? WEIERSTRASS_PM_FREQUENCY_POLICY
          : WEIERSTRASS_FREQUENCY_POLICY
      ).convertLegacyFundamental(tuple[0]),
      terms: tuple[1],
      amplitudeRatio: tuple[2],
      frequencyRatio: tuple[3],
      startExponent: playableStartExponent,
      fmDepthHz: mode === "fm" ? tuple[5] * sourceWeightSum : 0,
      offsetHz: mode === "fm" ? tuple[6] : 0,
      pmCarrierFrequencyHz: mode === "pm"
        ? tuple[5]
        : DEFAULT_PM_CARRIER_FREQUENCY_HZ,
      pmIndexCycles: mode === "pm"
        ? tuple[6]
        : DEFAULT_PM_INDEX_CYCLES,
    },
    sourceWeightSum,
  };
}

function freezePreset({
  id,
  label,
  description,
  tuple,
  mode,
  playableStartExponent,
  adaptation = null,
  origin = "legacy",
}) {
  const converted = sourceSettingsFromTuple(tuple, mode, {
    playableStartExponent,
  });
  return Object.freeze({
    id,
    label,
    description,
    mode,
    sourceTuple: tuple,
    source: Object.freeze({
      legacyFundamental: tuple[0],
      baseFrequencyHz: converted.settings.baseFrequencyHz,
      finiteAbsoluteWeightSum: converted.sourceWeightSum,
      legacyFmDepthHz: mode === "fm" ? tuple[5] : null,
      normalizedFmDepthHz: mode === "fm"
        ? converted.settings.fmDepthHz
        : null,
      legacyPmCarrierFrequencyHz: mode === "pm" && origin === "legacy"
        ? tuple[5]
        : null,
      legacyPmIndexCycles: mode === "pm" && origin === "legacy"
        ? tuple[6]
        : null,
      legacyStartExponent: tuple[4],
      playableStartExponent: converted.settings.startExponent,
      frequencyPolicy: mode === "pm"
        ? WEIERSTRASS_PM_FREQUENCY_POLICY.id
        : WEIERSTRASS_FREQUENCY_POLICY.id,
      origin,
      adaptation,
    }),
    settings: Object.freeze(converted.settings),
  });
}

export const WEIERSTRASS_WAVE_PRESETS = Object.freeze([
  freezePreset({
    id: "salt-lattice",
    label: "Salt Lattice",
    description: "Nine tapering terms climb through a steep, crystalline 7.07× lattice.",
    mode: "wave",
    tuple: WEIERSTRASS_LEGACY_WAVE_TUPLES[0],
  }),
  freezePreset({
    id: "silver-thicket",
    label: "Silver Thicket",
    description: "Thirteen close branches gather into a bright, slowly breathing waveform.",
    mode: "wave",
    tuple: WEIERSTRASS_LEGACY_WAVE_TUPLES[1],
  }),
]);

export const WEIERSTRASS_FM_PRESETS = Object.freeze([
  freezePreset({
    id: "copper-canopy",
    label: "Copper Canopy",
    description: "A low seed opens into a broad, normalized metallic frequency canopy.",
    mode: "fm",
    tuple: WEIERSTRASS_LEGACY_FM_TUPLES[0],
  }),
  freezePreset({
    id: "alias-ghost-recast",
    label: "Alias Ghost · Recast",
    description: (
      "The source exponent-10 alias cloud is disclosed and rebuilt from exponent 0 "
      + "as a portable audible lattice."
    ),
    mode: "fm",
    tuple: WEIERSTRASS_LEGACY_FM_TUPLES[1],
    playableStartExponent: 0,
    adaptation: (
      "Source start exponent 10 produced no portable below-Nyquist terms; "
      + "playable start exponent is 0."
    ),
  }),
  freezePreset({
    id: "slow-ember",
    label: "Slow Ember",
    description: "Twenty-three expanding terms turn a near-static seed into a warm FM drift.",
    mode: "fm",
    tuple: WEIERSTRASS_LEGACY_FM_TUPLES[2],
  }),
  freezePreset({
    id: "twin-flare",
    label: "Twin Flare",
    description: "Two sparse terms flare around a high offset with a compact, clear motion.",
    mode: "fm",
    tuple: WEIERSTRASS_LEGACY_FM_TUPLES[3],
  }),
  freezePreset({
    id: "prism-engine",
    label: "Prism Engine",
    description: "Thirty-three requested terms collapse safely into a vivid prismatic sweep.",
    mode: "fm",
    tuple: WEIERSTRASS_LEGACY_FM_TUPLES[4],
  }),
]);

export const WEIERSTRASS_PM_PRESETS = Object.freeze([
  freezePreset({
    id: "source-phase",
    label: "Source Phase",
    description: (
      "The exact original four-term PM tuple folds a descending lattice "
      + "around a 22 Hz phase oscillator."
    ),
    mode: "pm",
    tuple: WEIERSTRASS_LEGACY_PM_TUPLES[0],
  }),
  freezePreset({
    id: "phase-thread",
    label: "Phase Thread",
    description: (
      "A restrained native phase index draws the lattice into a clear, "
      + "slowly shifting harmonic thread."
    ),
    mode: "pm",
    tuple: WEIERSTRASS_NATIVE_PM_TUPLES[0],
    origin: "native",
    adaptation: "Native Morphazoid PM voicing; not an original source tuple.",
  }),
  freezePreset({
    id: "phase-bloom",
    label: "Phase Bloom",
    description: (
      "Twelve rising terms and a wider index open into a bright, bounded "
      + "phase-modulated bloom."
    ),
    mode: "pm",
    tuple: WEIERSTRASS_NATIVE_PM_TUPLES[1],
    origin: "native",
    adaptation: "Native Morphazoid PM voicing; not an original source tuple.",
  }),
]);

export const WEIERSTRASS_PRESETS = Object.freeze([
  ...WEIERSTRASS_WAVE_PRESETS,
  ...WEIERSTRASS_FM_PRESETS,
  ...WEIERSTRASS_PM_PRESETS,
]);

export const DEFAULT_WEIERSTRASS_PRESET_ID = "salt-lattice";

export const WEIERSTRASS_DEFAULTS = Object.freeze({
  ...WEIERSTRASS_WAVE_PRESETS[0].settings,
  output: 0.46,
});

export function sanitizeWeierstrassParams(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const maximumFrequencyHz = sampleRateCeiling(sampleRate);
  const mode = params.mode === "fm" || params.mode === "pm"
    ? params.mode
    : "wave";
  return Object.freeze({
    mode,
    terms: Math.round(clamp(
      legacyValue(params, "terms", "numVoices", WEIERSTRASS_DEFAULTS.terms),
      WEIERSTRASS_LIMITS.minTerms,
      WEIERSTRASS_LIMITS.maxTerms,
      WEIERSTRASS_DEFAULTS.terms,
    )),
    startExponent: Math.round(clamp(
      legacyValue(
        params,
        "startExponent",
        "lowestFormant",
        WEIERSTRASS_DEFAULTS.startExponent,
      ),
      WEIERSTRASS_LIMITS.minStartExponent,
      WEIERSTRASS_LIMITS.maxStartExponent,
      WEIERSTRASS_DEFAULTS.startExponent,
    )),
    amplitudeRatio: clamp(
      legacyValue(
        params,
        "amplitudeRatio",
        "varA",
        WEIERSTRASS_DEFAULTS.amplitudeRatio,
      ),
      WEIERSTRASS_LIMITS.minAmplitudeRatio,
      WEIERSTRASS_LIMITS.maxAmplitudeRatio,
      WEIERSTRASS_DEFAULTS.amplitudeRatio,
    ),
    frequencyRatio: clamp(
      legacyValue(
        params,
        "frequencyRatio",
        "varB",
        WEIERSTRASS_DEFAULTS.frequencyRatio,
      ),
      WEIERSTRASS_LIMITS.minFrequencyRatio,
      WEIERSTRASS_LIMITS.maxFrequencyRatio,
      WEIERSTRASS_DEFAULTS.frequencyRatio,
    ),
    baseFrequencyHz: clamp(
      legacyValue(
        params,
        "baseFrequencyHz",
        "fundamental",
        WEIERSTRASS_DEFAULTS.baseFrequencyHz,
      ),
      WEIERSTRASS_LIMITS.minBaseFrequencyHz,
      Math.min(
        WEIERSTRASS_LIMITS.maxBaseFrequencyHz,
        maximumFrequencyHz,
      ),
      WEIERSTRASS_DEFAULTS.baseFrequencyHz,
    ),
    fmDepthHz: clamp(
      legacyValue(params, "fmDepthHz", "modAmp", 700),
      0,
      Math.min(WEIERSTRASS_LIMITS.maxFmDepthHz, maximumFrequencyHz),
      700,
    ),
    offsetHz: clamp(
      legacyValue(params, "offsetHz", "startOffset", 100),
      0,
      Math.min(WEIERSTRASS_LIMITS.maxOffsetHz, maximumFrequencyHz),
      100,
    ),
    pmCarrierFrequencyHz: clamp(
      legacyValue(
        params,
        "pmCarrierFrequencyHz",
        "carrierFreq",
        DEFAULT_PM_CARRIER_FREQUENCY_HZ,
      ),
      WEIERSTRASS_LIMITS.minPmCarrierFrequencyHz,
      Math.min(
        WEIERSTRASS_LIMITS.maxPmCarrierFrequencyHz,
        maximumFrequencyHz,
      ),
      DEFAULT_PM_CARRIER_FREQUENCY_HZ,
    ),
    pmIndexCycles: clamp(
      legacyValue(
        params,
        "pmIndexCycles",
        "indexOfMod",
        DEFAULT_PM_INDEX_CYCLES,
      ),
      0,
      WEIERSTRASS_LIMITS.maxPmIndexCycles,
      DEFAULT_PM_INDEX_CYCLES,
    ),
    output: clamp(
      params.output,
      0,
      WEIERSTRASS_LIMITS.maxOutput,
      WEIERSTRASS_DEFAULTS.output,
    ),
    maximumFrequencyHz,
  });
}

export function antiAliasTaper(
  frequencyHz,
  maximumFrequencyHz = DEFAULT_SAMPLE_RATE * 0.45,
) {
  const frequency = Math.abs(finiteNumber(frequencyHz, 0));
  const ceiling = Math.max(
    WEIERSTRASS_LIMITS.minBaseFrequencyHz,
    finiteNumber(maximumFrequencyHz, DEFAULT_SAMPLE_RATE * 0.45),
  );
  if (frequency <= 0 || frequency >= ceiling) return 0;
  const taperStart = ceiling * ANTI_ALIAS_TAPER_START;
  if (frequency <= taperStart) return 1;
  const position = (frequency - taperStart) / (ceiling - taperStart);
  const smooth = position * position * (3 - 2 * position);
  return Math.max(0, 1 - smooth);
}

/**
 * Describe W = Σ a^n cos(2π fBase b^n t). Terms at/above the safe
 * sample-rate ceiling are removed, and the remaining bank is normalized only
 * after its anti-alias taper has been applied.
 */
export function deriveWeierstrassBank(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const settings = sanitizeWeierstrassParams(params, { sampleRate });
  const partials = [];
  let activeCount = 0;
  let activeAbsoluteWeightSum = 0;
  let finiteSourceWeightSum = 0;

  for (let index = 0; index < settings.terms; index += 1) {
    const exponent = settings.startExponent + index;
    const rawWeight = settings.amplitudeRatio ** exponent;
    const frequencyHz = (
      settings.baseFrequencyHz * settings.frequencyRatio ** exponent
    );
    const finiteWeight = Number.isFinite(rawWeight) ? rawWeight : 0;
    const finiteFrequency = Number.isFinite(frequencyHz) ? frequencyHz : Infinity;
    const taper = antiAliasTaper(
      finiteFrequency,
      settings.maximumFrequencyHz,
    );
    const effectiveWeight = finiteWeight * taper;
    const active = taper > 0 && Math.abs(effectiveWeight) > 1e-15;
    finiteSourceWeightSum += Math.abs(finiteWeight);
    if (active) {
      activeCount += 1;
      activeAbsoluteWeightSum += Math.abs(effectiveWeight);
    }
    partials.push({
      index,
      exponent,
      frequencyHz: finiteFrequency,
      rawWeight: finiteWeight,
      taper,
      effectiveWeight,
      active,
    });
  }

  const normalization = activeAbsoluteWeightSum > 1e-15
    ? 1 / activeAbsoluteWeightSum
    : 0;
  for (let index = 0; index < partials.length; index += 1) {
    const partial = partials[index];
    partial.normalizedWeight = partial.effectiveWeight * normalization;
    Object.freeze(partial);
  }

  return Object.freeze({
    settings,
    partials: Object.freeze(partials),
    requestedCount: settings.terms,
    activeCount,
    culledCount: settings.terms - activeCount,
    finiteSourceWeightSum,
    activeAbsoluteWeightSum,
    normalization,
    frequencyPolicy: WEIERSTRASS_FREQUENCY_POLICY,
  });
}

export function weierstrassWaveAtTime(
  params,
  timeSeconds,
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const bank = deriveWeierstrassBank(params, { sampleRate });
  const time = finiteNumber(timeSeconds, 0);
  let value = 0;
  for (let index = 0; index < bank.partials.length; index += 1) {
    const partial = bank.partials[index];
    if (!partial.active) continue;
    value += (
      partial.normalizedWeight
      * Math.cos(TAU * partial.frequencyHz * time)
    );
  }
  return value;
}

export function boundedWeierstrassFmFrequency(
  modulator,
  offsetHz,
  depthHz,
  maximumFrequencyHz = MAX_AUDIBLE_FREQUENCY,
) {
  const ceiling = Math.max(0, finiteNumber(
    maximumFrequencyHz,
    MAX_AUDIBLE_FREQUENCY,
  ));
  const normalizedModulator = clamp(modulator, -1, 1, 0);
  const offset = clamp(offsetHz, 0, ceiling, 0);
  const depth = clamp(depthHz, 0, ceiling, 0);
  return clamp(
    offset + normalizedModulator * depth,
    -ceiling,
    ceiling,
    0,
  );
}

/**
 * Reserve conservative spectral headroom for the highest partial whose
 * normalized amplitude is still material (at least -60 dB). The requested
 * legacy-compensated depth remains visible in presets and UI, while the
 * effective depth keeps offset + deviation + modulator edge below the current
 * render ceiling. The sample loop also retains a final signed-frequency clamp.
 */
function highestMaterialPartialFrequency(bank) {
  let highestMaterialPartialHz = 0;
  for (let index = 0; index < bank.partials.length; index += 1) {
    const partial = bank.partials[index];
    if (
      partial.active
      && Math.abs(partial.normalizedWeight) >= MATERIAL_WEIGHT_FLOOR
      && partial.frequencyHz > highestMaterialPartialHz
    ) {
      highestMaterialPartialHz = partial.frequencyHz;
    }
  }
  return highestMaterialPartialHz;
}

function fmHeadroomFromBank(bank) {
  const highestMaterialPartialHz = highestMaterialPartialFrequency(bank);
  const availableDepthHz = Math.max(
    0,
    bank.settings.maximumFrequencyHz
      - bank.settings.offsetHz
      - highestMaterialPartialHz,
  );
  const effectiveDepthHz = Math.min(
    bank.settings.fmDepthHz,
    availableDepthHz,
  );
  return Object.freeze({
    requestedDepthHz: bank.settings.fmDepthHz,
    effectiveDepthHz,
    availableDepthHz,
    highestMaterialPartialHz,
    maximumFrequencyHz: bank.settings.maximumFrequencyHz,
    limited: effectiveDepthHz + 1e-9 < bank.settings.fmDepthHz,
    materialWeightFloor: MATERIAL_WEIGHT_FLOOR,
  });
}

export function deriveWeierstrassFmHeadroom(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  return fmHeadroomFromBank(deriveWeierstrassBank(params, { sampleRate }));
}

/**
 * Bound the source PM grammar without replacing it. W(t) and the sine
 * oscillator are phase values in cycles, so their worst-case instantaneous
 * phase rates are 2πΣ|raw tapered weight|f and 2π·index·carrier respectively.
 * The source preset fits unmodified; only hostile/high-band settings reduce W
 * or index.
 */
function pmHeadroomFromBank(bank) {
  let requestedBankPhaseBandwidthHz = 0;
  for (let index = 0; index < bank.partials.length; index += 1) {
    const partial = bank.partials[index];
    if (!partial.active) continue;
    requestedBankPhaseBandwidthHz += (
      TAU
      * Math.abs(partial.effectiveWeight)
      * partial.frequencyHz
    );
  }
  const ceiling = bank.settings.maximumFrequencyHz;
  const bankScale = requestedBankPhaseBandwidthHz > ceiling
    ? ceiling / requestedBankPhaseBandwidthHz
    : 1;
  const effectiveBankPhaseBandwidthHz = (
    requestedBankPhaseBandwidthHz * bankScale
  );
  const availableCarrierPhaseBandwidthHz = Math.max(
    0,
    ceiling - effectiveBankPhaseBandwidthHz,
  );
  const carrierFrequencyHz = bank.settings.pmCarrierFrequencyHz;
  const maximumIndexCycles = carrierFrequencyHz > 0
    ? availableCarrierPhaseBandwidthHz / (TAU * carrierFrequencyHz)
    : 0;
  const requestedIndexCycles = bank.settings.pmIndexCycles;
  const effectiveIndexCycles = Math.min(
    requestedIndexCycles,
    maximumIndexCycles,
  );
  const estimatedPeakFrequencyHz = (
    effectiveBankPhaseBandwidthHz
    + TAU * effectiveIndexCycles * carrierFrequencyHz
  );
  return Object.freeze({
    requestedIndexCycles,
    effectiveIndexCycles,
    maximumIndexCycles,
    carrierFrequencyHz,
    requestedBankPhaseBandwidthHz,
    effectiveBankPhaseBandwidthHz,
    bankScale,
    estimatedPeakFrequencyHz,
    maximumFrequencyHz: ceiling,
    limited: (
      effectiveIndexCycles + 1e-12 < requestedIndexCycles
      || bankScale + 1e-12 < 1
    ),
  });
}

export function deriveWeierstrassPmHeadroom(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  return pmHeadroomFromBank(deriveWeierstrassBank(params, { sampleRate }));
}

/**
 * The authoritative source wraps phase cycles after adding its normalized
 * Weierstrass trajectory and a sine oscillator scaled by the PM index.
 */
export function weierstrassPmSample(
  bankPhaseCycles,
  carrierPhaseRadians,
  indexCycles,
  bankScale = 1,
) {
  const safeBankPhase = finiteNumber(bankPhaseCycles, 0);
  const safeCarrierPhase = finiteNumber(carrierPhaseRadians, 0);
  const safeIndex = clamp(
    indexCycles,
    0,
    WEIERSTRASS_LIMITS.maxPmIndexCycles,
    0,
  );
  const safeBankScale = clamp(bankScale, 0, 1, 1);
  const phaseCycles = (
    safeBankPhase * safeBankScale
    + Math.sin(safeCarrierPhase) * safeIndex
  );
  const wrappedPhaseCycles = phaseCycles - Math.floor(phaseCycles);
  return Math.sin(TAU * wrappedPhaseCycles);
}

export function logarithmicSliderValue(position, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.001));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safePosition = clamp(position, 0, 1, 0);
  return safeMinimum * ((safeMaximum / safeMinimum) ** safePosition);
}

export function logarithmicSliderPosition(value, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.001));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safeValue = clamp(value, safeMinimum, safeMaximum, safeMinimum);
  if (safeMinimum === safeMaximum) return 0;
  return Math.log(safeValue / safeMinimum)
    / Math.log(safeMaximum / safeMinimum);
}

export function quadraticSliderValue(position, maximum) {
  const safeMaximum = Math.max(0, finiteNumber(maximum, 1));
  const safePosition = clamp(position, 0, 1, 0);
  return safePosition * safePosition * safeMaximum;
}

export function quadraticSliderPosition(value, maximum) {
  const safeMaximum = Math.max(Number.EPSILON, finiteNumber(maximum, 1));
  return Math.sqrt(clamp(value, 0, safeMaximum, 0) / safeMaximum);
}

export function formatWeierstrassFrequency(value) {
  const frequency = Math.abs(finiteNumber(value, 0));
  if (frequency >= 1_000) {
    return `${(frequency / 1_000).toFixed(frequency >= 10_000 ? 1 : 2)
      .replace(/0+$/, "")
      .replace(/\.$/, "")} kHz`;
  }
  if (frequency >= 100) return `${Math.round(frequency)} Hz`;
  if (frequency >= 10) {
    return `${frequency.toFixed(1).replace(/\.0$/, "")} Hz`;
  }
  return `${frequency.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} Hz`;
}

export function createSoftCeilingCurve(
  length = 2_049,
  drive = 1.35,
  ceiling = 0.91,
) {
  const size = Math.round(clamp(length, 33, 65_537, 2_049));
  const safeDrive = clamp(drive, 0.5, 4, 1.35);
  const safeCeiling = clamp(ceiling, 0.5, 0.98, 0.91);
  const scale = Math.tanh(safeDrive);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(input * safeDrive) / scale * safeCeiling;
  }
  return curve;
}

function wrapPhase(phase) {
  if (phase > TAU || phase < -TAU) return phase % TAU;
  return phase;
}

function createProcessorClass(AudioWorkletBase) {
  return class MorphazoidWeierstrassProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      const initial = sanitizeWeierstrassParams(options.processorOptions, {
        sampleRate: Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
      });
      this.targetModeMix = initial.mode === "fm" ? 1 : 0;
      this.currentModeMix = this.targetModeMix;
      this.targetPmMix = initial.mode === "pm" ? 1 : 0;
      this.currentPmMix = this.targetPmMix;
      this.targetMode = initial.mode;
      this.targetFmDepthHz = initial.fmDepthHz;
      this.currentFmDepthHz = initial.fmDepthHz;
      this.targetOffsetHz = initial.offsetHz;
      this.currentOffsetHz = initial.offsetHz;
      this.targetPmCarrierFrequencyHz = initial.pmCarrierFrequencyHz;
      this.currentPmCarrierFrequencyHz = initial.pmCarrierFrequencyHz;
      this.requestedPmIndexCycles = initial.pmIndexCycles;
      this.targetPmIndexCycles = initial.pmIndexCycles;
      this.currentPmIndexCycles = initial.pmIndexCycles;
      this.targetPmBankScale = 1;
      this.currentPmBankScale = 1;
      this.targetPmBankGain = 0;
      this.currentPmBankGain = 0;
      this.targetFrequencies = new Float64Array(MAX_TERMS);
      this.currentFrequencies = new Float64Array(MAX_TERMS);
      this.targetWeights = new Float64Array(MAX_TERMS);
      this.currentWeights = new Float64Array(MAX_TERMS);
      this.phases = new Float64Array(MAX_TERMS);
      this.fmPhase = 0;
      this.pmCarrierPhase = 0;
      this.activeTarget = 0;
      this.activeGain = 0;
      this.configureBank(initial, true);
      this.port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "parameters") {
          const parameters = message.parameters;
          const safe = sanitizeWeierstrassParams({
            mode: parameters?.mode ?? this.targetMode,
            terms: parameters?.terms,
            startExponent: parameters?.startExponent,
            amplitudeRatio: parameters?.amplitudeRatio,
            frequencyRatio: parameters?.frequencyRatio,
            baseFrequencyHz: parameters?.baseFrequencyHz,
            fmDepthHz: parameters?.fmDepthHz ?? this.targetFmDepthHz,
            offsetHz: parameters?.offsetHz ?? this.targetOffsetHz,
            pmCarrierFrequencyHz: (
              parameters?.pmCarrierFrequencyHz
              ?? this.targetPmCarrierFrequencyHz
            ),
            pmIndexCycles: (
              parameters?.pmIndexCycles
              ?? this.requestedPmIndexCycles
            ),
          }, {
            sampleRate: Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
          });
          this.targetMode = safe.mode;
          this.targetModeMix = safe.mode === "fm" ? 1 : 0;
          this.targetPmMix = safe.mode === "pm" ? 1 : 0;
          this.targetFmDepthHz = safe.fmDepthHz;
          this.targetOffsetHz = safe.offsetHz;
          this.targetPmCarrierFrequencyHz = safe.pmCarrierFrequencyHz;
          this.requestedPmIndexCycles = safe.pmIndexCycles;
          this.configureBank(safe, false);
        } else if (message?.type === "active") {
          this.activeTarget = message.value ? 1 : 0;
        }
      };
    }

    configureBank(params, immediate) {
      const bank = deriveWeierstrassBank(params, {
        sampleRate: Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE,
      });
      const headroom = fmHeadroomFromBank(bank);
      const pmHeadroom = pmHeadroomFromBank(bank);
      this.targetFmDepthHz = headroom.effectiveDepthHz;
      this.targetPmIndexCycles = pmHeadroom.effectiveIndexCycles;
      this.targetPmBankScale = pmHeadroom.bankScale;
      this.targetPmBankGain = bank.activeAbsoluteWeightSum;
      if (immediate) this.currentFmDepthHz = headroom.effectiveDepthHz;
      if (immediate) {
        this.currentPmIndexCycles = pmHeadroom.effectiveIndexCycles;
        this.currentPmBankScale = pmHeadroom.bankScale;
        this.currentPmBankGain = bank.activeAbsoluteWeightSum;
      }
      for (let index = 0; index < MAX_TERMS; index += 1) {
        const partial = bank.partials[index];
        const frequency = partial?.active ? partial.frequencyHz : 0;
        const weight = partial?.active ? partial.normalizedWeight : 0;
        this.targetFrequencies[index] = frequency;
        this.targetWeights[index] = weight;
        if (immediate) {
          this.currentFrequencies[index] = frequency;
          this.currentWeights[index] = weight;
        }
      }
    }

    process(_inputs, outputs) {
      const output = outputs[0];
      if (!output?.length) return true;
      const left = output[0];
      const right = output[1] ?? left;
      left.fill(0);
      if (right !== left) right.fill(0);

      const workletSampleRate = Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE;
      const frequencyCeiling = Math.min(
        MAX_AUDIBLE_FREQUENCY,
        workletSampleRate * 0.45,
      );
      const frequencySlew = 1 - Math.exp(-1 / (workletSampleRate * 0.034));
      const weightSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.018));
      const parameterSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.025));
      const activeSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.008));
      const phaseScale = TAU / workletSampleRate;

      for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
        this.currentModeMix += (
          this.targetModeMix - this.currentModeMix
        ) * parameterSlew;
        this.currentPmMix += (
          this.targetPmMix - this.currentPmMix
        ) * parameterSlew;
        this.currentFmDepthHz += (
          this.targetFmDepthHz - this.currentFmDepthHz
        ) * parameterSlew;
        this.currentOffsetHz += (
          this.targetOffsetHz - this.currentOffsetHz
        ) * parameterSlew;
        this.currentPmCarrierFrequencyHz += (
          this.targetPmCarrierFrequencyHz
          - this.currentPmCarrierFrequencyHz
        ) * parameterSlew;
        this.currentPmIndexCycles += (
          this.targetPmIndexCycles - this.currentPmIndexCycles
        ) * parameterSlew;
        this.currentPmBankScale += (
          this.targetPmBankScale - this.currentPmBankScale
        ) * parameterSlew;
        this.currentPmBankGain += (
          this.targetPmBankGain - this.currentPmBankGain
        ) * weightSlew;
        this.activeGain += (
          this.activeTarget - this.activeGain
        ) * activeSlew;

        let wave = 0;
        let absoluteWeightSum = 0;
        for (let termIndex = 0; termIndex < MAX_TERMS; termIndex += 1) {
          this.currentFrequencies[termIndex] += (
            this.targetFrequencies[termIndex]
            - this.currentFrequencies[termIndex]
          ) * frequencySlew;
          this.currentWeights[termIndex] += (
            this.targetWeights[termIndex] - this.currentWeights[termIndex]
          ) * weightSlew;
          const frequency = Math.min(
            frequencyCeiling,
            Math.max(0, this.currentFrequencies[termIndex]),
          );
          this.phases[termIndex] = wrapPhase(
            this.phases[termIndex] + frequency * phaseScale,
          );
          const weight = this.currentWeights[termIndex];
          wave += Math.cos(this.phases[termIndex]) * weight;
          absoluteWeightSum += Math.abs(weight);
        }
        if (absoluteWeightSum > 1e-15) wave /= absoluteWeightSum;
        else wave = 0;

        const fmFrequency = Math.min(
          frequencyCeiling,
          Math.max(
            -frequencyCeiling,
            this.currentOffsetHz + wave * this.currentFmDepthHz,
          ),
        );
        this.fmPhase = wrapPhase(
          this.fmPhase + fmFrequency * phaseScale,
        );
        const fmSignal = Math.sin(this.fmPhase);
        this.pmCarrierPhase = wrapPhase(
          this.pmCarrierPhase
          + this.currentPmCarrierFrequencyHz * phaseScale,
        );
        const pmPhaseCycles = (
          wave * this.currentPmBankGain * this.currentPmBankScale
          + Math.sin(this.pmCarrierPhase) * this.currentPmIndexCycles
        );
        const wrappedPmPhaseCycles = (
          pmPhaseCycles - Math.floor(pmPhaseCycles)
        );
        const pmSignal = Math.sin(TAU * wrappedPmPhaseCycles);
        const waveFmSignal = (
          wave * (1 - this.currentModeMix)
          + fmSignal * this.currentModeMix
        );
        const modeSignal = (
          waveFmSignal * (1 - this.currentPmMix)
          + pmSignal * this.currentPmMix
        );
        const sample = modeSignal * this.activeGain * 0.48;
        left[sampleIndex] = Number.isFinite(sample) ? sample : 0;
        if (right !== left) right[sampleIndex] = left[sampleIndex];
      }
      return true;
    }
  };
}

const AudioWorkletBase = globalThis.AudioWorkletProcessor;
if (
  typeof AudioWorkletBase === "function"
  && typeof globalThis.registerProcessor === "function"
) {
  globalThis.registerProcessor(
    PROCESSOR_NAME,
    createProcessorClass(AudioWorkletBase),
  );
}

/**
 * Audio stays inert until start() is called from the page's Audio button.
 * The graph is bounded and entirely disposable on pagehide.
 */
export class WeierstrassAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.params = { ...WEIERSTRASS_DEFAULTS };
    this.enabled = false;
    this.suspendTimer = null;
  }

  get isInitialized() {
    return Boolean(this.context && this.context.state !== "closed");
  }

  async initialize() {
    if (this.isInitialized) return;
    const AudioContextConstructor = (
      this.runtime.AudioContext ?? this.runtime.webkitAudioContext
    );
    const AudioWorkletNodeConstructor = (
      this.runtime.AudioWorkletNode ?? globalThis.AudioWorkletNode
    );
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (typeof AudioWorkletNodeConstructor !== "function") {
      throw new Error("This instrument requires AudioWorklet support.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) {
      await context.close();
      throw new Error("This instrument requires AudioWorklet support.");
    }

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./weierstrass.js", import.meta.url),
      );
      const node = new AudioWorkletNodeConstructor(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: this.params,
      });
      const highpass = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const ceiling = context.createWaveShaper();
      const master = context.createGain();
      const analyser = context.createAnalyser();

      highpass.type = "highpass";
      highpass.frequency.value = 18;
      highpass.Q.value = 0.707;
      compressor.threshold.value = -15;
      compressor.knee.value = 12;
      compressor.ratio.value = 9;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.16;
      ceiling.curve = createSoftCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.58;

      node
        .connect(highpass)
        .connect(compressor)
        .connect(ceiling)
        .connect(master)
        .connect(analyser);
      this.releaseAudioOutput = connectAudioOutput(context, analyser, { runtime: this.runtime });

      this.context = context;
      this.node = node;
      this.highpass = highpass;
      this.compressor = compressor;
      this.ceiling = ceiling;
      this.master = master;
      this.analyser = analyser;
      this.setParameters(this.params);
    } catch (error) {
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      await context.close().catch(() => {});
      throw error;
    }
  }

  async start() {
    await this.initialize();
    if (this.suspendTimer !== null) {
      this.runtime.clearTimeout?.(this.suspendTimer);
      this.suspendTimer = null;
    }
    await this.context.resume();
    const now = this.context.currentTime;
    this.node.port.postMessage({ type: "active", value: true });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.params.output, now + 0.035);
    this.enabled = true;
  }

  stop() {
    if (!this.isInitialized || !this.enabled) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.035);
    this.node.port.postMessage({ type: "active", value: false });
    this.enabled = false;
    this.suspendTimer = this.runtime.setTimeout?.(() => {
      this.suspendTimer = null;
      if (!this.enabled && this.context?.state === "running") {
        this.context.suspend().catch(() => {});
      }
    }, 55) ?? null;
  }

  setParameters(params = {}) {
    const safe = sanitizeWeierstrassParams({
      ...this.params,
      ...params,
    }, {
      sampleRate: this.context?.sampleRate ?? DEFAULT_SAMPLE_RATE,
    });
    this.params = {
      mode: safe.mode,
      terms: safe.terms,
      startExponent: safe.startExponent,
      amplitudeRatio: safe.amplitudeRatio,
      frequencyRatio: safe.frequencyRatio,
      baseFrequencyHz: safe.baseFrequencyHz,
      fmDepthHz: safe.fmDepthHz,
      offsetHz: safe.offsetHz,
      pmCarrierFrequencyHz: safe.pmCarrierFrequencyHz,
      pmIndexCycles: safe.pmIndexCycles,
      output: safe.output,
    };
    if (!this.isInitialized) return;
    this.node.port.postMessage({
      type: "parameters",
      parameters: {
        mode: safe.mode,
        terms: safe.terms,
        startExponent: safe.startExponent,
        amplitudeRatio: safe.amplitudeRatio,
        frequencyRatio: safe.frequencyRatio,
        baseFrequencyHz: safe.baseFrequencyHz,
        fmDepthHz: safe.fmDepthHz,
        offsetHz: safe.offsetHz,
        pmCarrierFrequencyHz: safe.pmCarrierFrequencyHz,
        pmIndexCycles: safe.pmIndexCycles,
      },
    });
    if (this.enabled) {
      this.master.gain.setTargetAtTime(
        safe.output,
        this.context.currentTime,
        0.015,
      );
    }
  }

  getWaveform(target) {
    if (!this.analyser || !(target instanceof Float32Array)) return false;
    this.analyser.getFloatTimeDomainData(target);
    return true;
  }

  async close() {
    if (this.suspendTimer !== null) {
      this.runtime.clearTimeout?.(this.suspendTimer);
      this.suspendTimer = null;
    }
    this.enabled = false;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.node?.port.postMessage({ type: "active", value: false });
    this.node?.disconnect();
    this.highpass?.disconnect();
    this.compressor?.disconnect();
    this.ceiling?.disconnect();
    this.master?.disconnect();
    this.analyser?.disconnect();
    const context = this.context;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }
}
