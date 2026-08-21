import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

// Cascading phase modulation (PM).
//
// N sine operators form a feed-forward phase chain:
//   signal[0] = sin(phase[0])
//   signal[i] = sin(phase[i] + signal[i - 1] * phaseIndex[i - 1])
//
// Only signal[N - 1] reaches the output. Unlike Cascading FM, modulation
// amounts are angles in radians and never alter an operator's phase increment.
// That distinction keeps every oscillator on its requested centre frequency
// and makes the complete cascade mathematically bounded to -1…1.

export const CASCADING_PM_PROCESSOR_NAME = "morphazoid-cascading-pm";

const DEFAULT_SAMPLE_RATE = 48_000;
const TWO_PI = Math.PI * 2;
const PARAMETER_SMOOTHING_SECONDS = 0.018;
const INDEX_SMOOTHING_SECONDS = 0.012;
const OUTPUT_CROSSFADE_SECONDS = 0.014;

export const CASCADING_PM_LIMITS = Object.freeze({
  minStages: 2,
  maxStages: 12,
  minRootHz: 0.02,
  maxRootHz: 110,
  minCascadeRatio: 0.25,
  maxCascadeRatio: 200,
  minPhaseIndex: 0,
  maxPhaseIndex: 16,
  minIndexTaper: 0.05,
  maxIndexTaper: 4,
  maxInternalPhaseIndex: 32,
  audioCeiling: 20_000,
  baseFrequencySampleRateRatio: 0.4,
  bandwidthSampleRateRatio: 0.45,
});

export const CASCADING_PM_DEFAULTS = Object.freeze({
  stages: 4,
  rootHz: 0.05,
  cascadeRatio: 11.3,
  phaseIndex: 2,
  indexTaper: 0.58,
});

const freezePreset = (preset) => Object.freeze({
  ...preset,
  settings: Object.freeze({ ...preset.settings }),
});

// Keep the ids parallel with Cascading FM, but give each PM preset a different
// structural job. Fewer stages and deliberately varied index contours prevent
// every patch from collapsing into the same dense, low growl.
export const CASCADING_PM_PRESETS = Object.freeze([
  freezePreset({
    id: "slow-cascade",
    label: "Long Bloom",
    motion: "evolving",
    description: "Four widely spaced stages open around a 72 Hz bass over a calm 20-second cycle.",
    settings: {
      stages: 4,
      rootHz: 0.05,
      cascadeRatio: 11.3,
      phaseIndex: 2,
      indexTaper: 0.58,
    },
  }),
  freezePreset({
    id: "dense-wave",
    label: "Low Lantern",
    motion: "drone",
    description: "Two audio-rate operators hold a warm 54 Hz drone with a light phase halo and no deep-chain growl.",
    settings: {
      stages: 2,
      rootHz: 36,
      cascadeRatio: 1.5,
      phaseIndex: 0.24,
      indexTaper: 1,
    },
  }),
  freezePreset({
    id: "wide-steps",
    label: "Soft Alloy",
    motion: "drone",
    description: "Three golden-ratio stages sustain a clear 99 Hz drone with a fine, inharmonic shimmer.",
    settings: {
      stages: 3,
      rootHz: 38,
      cascadeRatio: 1.618,
      phaseIndex: 0.55,
      indexTaper: 0.7,
    },
  }),
  freezePreset({
    id: "bright-shimmer",
    label: "Glass Current",
    motion: "evolving",
    description: "Five stages brighten and recede around 132 Hz, completing the slowest turn every 3.6 seconds.",
    settings: {
      stages: 5,
      rootHz: 0.28,
      cascadeRatio: 4.66,
      phaseIndex: 1.2,
      indexTaper: 1.05,
    },
  }),
  freezePreset({
    id: "deep-strata",
    label: "Quickening Coil",
    motion: "evolving",
    description: "Six strengthening hand-offs swell around 107 Hz on a quicker 1.1-second cycle.",
    settings: {
      stages: 6,
      rootHz: 0.88,
      cascadeRatio: 2.61,
      phaseIndex: 0.9,
      indexTaper: 1.2,
    },
  }),
  freezePreset({
    id: "harmonic-rain",
    label: "Clockwork Lace",
    motion: "rhythmic",
    description: "One deliberate nine-stage chain interlocks at 2.8 Hz around a rounded 64 Hz rhythmic bass.",
    settings: {
      stages: 9,
      rootHz: 2.8,
      cascadeRatio: 1.48,
      phaseIndex: 1.5,
      indexTaper: 0.95,
    },
  }),
]);

export const DEFAULT_CASCADING_PM_PRESET_ID = "slow-cascade";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeSampleRateValue(sampleRate) {
  return clamp(
    finiteOr(sampleRate, DEFAULT_SAMPLE_RATE),
    8_000,
    192_000,
  );
}

export function cascadingPmBaseFrequencyCeiling(sampleRate) {
  const safeSampleRate = safeSampleRateValue(sampleRate);
  return Math.min(
    CASCADING_PM_LIMITS.audioCeiling,
    safeSampleRate * CASCADING_PM_LIMITS.baseFrequencySampleRateRatio,
  );
}

export function cascadingPmBandwidthCeiling(sampleRate) {
  return safeSampleRateValue(sampleRate)
    * CASCADING_PM_LIMITS.bandwidthSampleRateRatio;
}

/**
 * Conservatively limit a phase offset so its destination and the preceding
 * operator's estimated upper sideband remain below the bandwidth ceiling.
 * All arguments and the result are scalars so the AudioWorklet can share this
 * exact guard without allocating on a settings message.
 */
export function bandwidthSafePhaseIndex(
  rawPhaseIndex,
  destinationFrequencyHz,
  priorEstimatedBandwidthHz,
  maximumBandwidthHz,
) {
  const internallyBounded = clamp(
    finiteOr(rawPhaseIndex, CASCADING_PM_LIMITS.maxInternalPhaseIndex),
    0,
    CASCADING_PM_LIMITS.maxInternalPhaseIndex,
  );
  const destination = Math.max(0, finiteOr(destinationFrequencyHz, 0));
  const priorBandwidth = Math.max(0, finiteOr(priorEstimatedBandwidthHz, 0));
  const bandwidthCeiling = Math.max(
    destination,
    finiteOr(maximumBandwidthHz, destination),
  );
  if (priorBandwidth === 0) return internallyBounded;
  const maximumIndex = Math.max(
    0,
    (bandwidthCeiling - destination) / priorBandwidth,
  );
  return Math.min(internallyBounded, maximumIndex);
}

export function estimateCascadingPmBandwidth(
  destinationFrequencyHz,
  effectivePhaseIndex,
  priorEstimatedBandwidthHz,
  maximumBandwidthHz,
) {
  const destination = Math.max(0, finiteOr(destinationFrequencyHz, 0));
  const phaseIndex = Math.max(0, finiteOr(effectivePhaseIndex, 0));
  const priorBandwidth = Math.max(0, finiteOr(priorEstimatedBandwidthHz, 0));
  const bandwidthCeiling = Math.max(
    destination,
    finiteOr(maximumBandwidthHz, destination),
  );
  return Math.min(
    bandwidthCeiling,
    destination + phaseIndex * priorBandwidth,
  );
}

export function sanitizeCascadingPmSettings(raw = {}) {
  const limits = CASCADING_PM_LIMITS;
  const defaults = CASCADING_PM_DEFAULTS;
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.freeze({
    stages: clamp(
      Math.round(finiteOr(source.stages, defaults.stages)),
      limits.minStages,
      limits.maxStages,
    ),
    rootHz: clamp(
      finiteOr(source.rootHz, defaults.rootHz),
      limits.minRootHz,
      limits.maxRootHz,
    ),
    cascadeRatio: clamp(
      finiteOr(source.cascadeRatio, defaults.cascadeRatio),
      limits.minCascadeRatio,
      limits.maxCascadeRatio,
    ),
    phaseIndex: clamp(
      finiteOr(source.phaseIndex, defaults.phaseIndex),
      limits.minPhaseIndex,
      limits.maxPhaseIndex,
    ),
    indexTaper: clamp(
      finiteOr(source.indexTaper, defaults.indexTaper),
      limits.minIndexTaper,
      limits.maxIndexTaper,
    ),
  });
}

/** Preserve the first-to-last frequency span when inserting/removing stages. */
export function cascadeRatioForStageCount(ratio, previousStages, nextStages) {
  const limits = CASCADING_PM_LIMITS;
  const safeRatio = clamp(
    finiteOr(ratio, CASCADING_PM_DEFAULTS.cascadeRatio),
    limits.minCascadeRatio,
    limits.maxCascadeRatio,
  );
  const safePreviousStages = clamp(
    Math.round(finiteOr(previousStages, CASCADING_PM_DEFAULTS.stages)),
    limits.minStages,
    limits.maxStages,
  );
  const safeNextStages = clamp(
    Math.round(finiteOr(nextStages, safePreviousStages)),
    limits.minStages,
    limits.maxStages,
  );
  return clamp(
    Math.pow(safeRatio, (safePreviousStages - 1) / (safeNextStages - 1)),
    limits.minCascadeRatio,
    limits.maxCascadeRatio,
  );
}

function phasePressureGain(connections) {
  let squaredPressure = 0;
  for (const connection of connections) {
    squaredPressure += connection.phaseIndex * connection.phaseIndex;
  }
  // PM is already amplitude-bounded. This modest spectral-pressure trim leaves
  // quiet patches useful while allowing high-index presets compressor headroom.
  return clamp(0.7 / (1 + Math.sqrt(squaredPressure) * 0.06), 0.3, 0.7);
}

/**
 * Build the operator ledger used by the diagram, AudioWorklet and tests.
 * Base frequencies stay below 0.4 × sample rate. Each phase index is first
 * bounded in radians, then reduced only if its conservative inherited PM
 * bandwidth would cross 0.45 × sample rate. No Hz-to-index conversion is
 * performed because this is true PM; the bandwidth calculation is a guard.
 */
export function deriveCascadeStack(
  rawSettings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const settings = sanitizeCascadingPmSettings(rawSettings);
  const maximumFrequencyHz = cascadingPmBaseFrequencyCeiling(sampleRate);
  const maximumBandwidthHz = cascadingPmBandwidthCeiling(sampleRate);
  const oscillators = [];
  let boundedByFrequency = false;

  for (let index = 0; index < settings.stages; index += 1) {
    const rawFrequencyHz = settings.rootHz * (settings.cascadeRatio ** index);
    const frequencyHz = Math.min(rawFrequencyHz, maximumFrequencyHz);
    if (frequencyHz !== rawFrequencyHz) boundedByFrequency = true;
    oscillators.push({
      freq: frequencyHz,
      frequencyHz,
      rawFrequencyHz,
      estimatedBandwidthHz: frequencyHz,
      stageIndex: index,
      isLfo: index === 0,
      isCarrier: index === settings.stages - 1,
      wasLimited: frequencyHz !== rawFrequencyHz,
    });
  }

  const connections = [];
  let boundedByIndex = false;
  let boundedByInternalIndex = false;
  let boundedByBandwidth = false;
  let priorEstimatedBandwidthHz = oscillators[0].frequencyHz;
  for (let index = 0; index < settings.stages - 1; index += 1) {
    const rawPhaseIndex = settings.phaseIndex * (settings.indexTaper ** index);
    const internallyBoundedPhaseIndex = clamp(
      finiteOr(rawPhaseIndex, CASCADING_PM_LIMITS.maxInternalPhaseIndex),
      0,
      CASCADING_PM_LIMITS.maxInternalPhaseIndex,
    );
    const destinationFrequencyHz = oscillators[index + 1].frequencyHz;
    const maximumBandwidthPhaseIndex = priorEstimatedBandwidthHz > 0
      ? Math.max(
        0,
        (maximumBandwidthHz - destinationFrequencyHz)
          / priorEstimatedBandwidthHz,
      )
      : CASCADING_PM_LIMITS.maxInternalPhaseIndex;
    const phaseIndex = bandwidthSafePhaseIndex(
      rawPhaseIndex,
      destinationFrequencyHz,
      priorEstimatedBandwidthHz,
      maximumBandwidthHz,
    );
    const estimatedBandwidthHz = estimateCascadingPmBandwidth(
      destinationFrequencyHz,
      phaseIndex,
      priorEstimatedBandwidthHz,
      maximumBandwidthHz,
    );
    const limitedByIndex = internallyBoundedPhaseIndex !== rawPhaseIndex;
    const limitedByBandwidth = phaseIndex < internallyBoundedPhaseIndex;
    if (limitedByIndex || limitedByBandwidth) boundedByIndex = true;
    if (limitedByIndex) boundedByInternalIndex = true;
    if (limitedByBandwidth) boundedByBandwidth = true;
    oscillators[index + 1].estimatedBandwidthHz = estimatedBandwidthHz;
    connections.push(Object.freeze({
      from: index,
      to: index + 1,
      phaseIndex,
      effectivePhaseIndex: phaseIndex,
      rawPhaseIndex,
      internallyBoundedPhaseIndex,
      maximumBandwidthPhaseIndex,
      priorEstimatedBandwidthHz,
      estimatedBandwidthHz,
      limitedByIndex,
      limitedByInternalIndex: limitedByIndex,
      limitedByBandwidth,
      wasLimited: limitedByIndex || limitedByBandwidth,
    }));
    priorEstimatedBandwidthHz = estimatedBandwidthHz;
  }

  return Object.freeze({
    settings,
    oscillators: Object.freeze(
      oscillators.map((oscillator) => Object.freeze(oscillator)),
    ),
    connections: Object.freeze(connections),
    outputIndex: settings.stages - 1,
    maximumFrequencyHz,
    maximumBandwidthHz,
    boundedByFrequency,
    boundedByIndex,
    boundedByInternalIndex,
    boundedByBandwidth,
    normalizedGain: phasePressureGain(connections),
  });
}

export const deriveCascadingPmStack = deriveCascadeStack;

/** Evaluate one feed-forward PM cascade without mutating the supplied phases. */
export function evaluatePhaseCascade(phases, stackOrSettings = {}) {
  const stack = stackOrSettings?.oscillators && stackOrSettings?.connections
    ? stackOrSettings
    : deriveCascadeStack(stackOrSettings);
  const stageOutputs = new Array(stack.oscillators.length);
  let signal = Math.sin(finiteOr(phases?.[0], 0));
  stageOutputs[0] = signal;

  for (let index = 1; index < stack.oscillators.length; index += 1) {
    const phase = finiteOr(phases?.[index], 0);
    const phaseIndex = stack.connections[index - 1]?.phaseIndex ?? 0;
    signal = Math.sin(phase + signal * phaseIndex);
    stageOutputs[index] = signal;
  }

  return Object.freeze({
    output: signal,
    stageOutputs: Object.freeze(stageOutputs),
  });
}

/** Return the next phase vector. This pure helper intentionally does not mutate. */
export function advanceCascadePhases(
  phases,
  stackOrSettings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const stack = stackOrSettings?.oscillators && stackOrSettings?.connections
    ? stackOrSettings
    : deriveCascadeStack(stackOrSettings, { sampleRate });
  const safeSampleRate = clamp(
    finiteOr(sampleRate, DEFAULT_SAMPLE_RATE),
    8_000,
    192_000,
  );
  return Object.freeze(stack.oscillators.map((oscillator, index) => {
    const phase = finiteOr(phases?.[index], 0);
    const next = phase + TWO_PI * oscillator.frequencyHz / safeSampleRate;
    return next - Math.floor(next / TWO_PI) * TWO_PI;
  }));
}

/**
 * Deterministic offline renderer for regression tests and visual previews.
 * It uses the same nested expression as the worklet, with no parameter ramps.
 */
export function renderCascadingPmSamples(
  rawSettings = {},
  {
    sampleRate = DEFAULT_SAMPLE_RATE,
    frameCount = 128,
    initialPhases = [],
  } = {},
) {
  const safeSampleRate = clamp(
    finiteOr(sampleRate, DEFAULT_SAMPLE_RATE),
    8_000,
    192_000,
  );
  const safeFrameCount = clamp(
    Math.round(finiteOr(frameCount, 128)),
    0,
    Math.round(safeSampleRate * 10),
  );
  const stack = deriveCascadeStack(rawSettings, { sampleRate: safeSampleRate });
  const stages = stack.oscillators.length;
  const phases = new Float64Array(stages);
  const increments = new Float64Array(stages);
  const stageOutputs = new Float64Array(stages);
  const result = new Float32Array(safeFrameCount);

  for (let index = 0; index < stages; index += 1) {
    phases[index] = finiteOr(initialPhases?.[index], 0);
    phases[index] -= Math.floor(phases[index] / TWO_PI) * TWO_PI;
    increments[index] = TWO_PI
      * stack.oscillators[index].frequencyHz
      / safeSampleRate;
  }

  for (let frame = 0; frame < safeFrameCount; frame += 1) {
    let signal = Math.sin(phases[0]);
    stageOutputs[0] = signal;
    for (let index = 1; index < stages; index += 1) {
      signal = Math.sin(
        phases[index]
        + stageOutputs[index - 1] * stack.connections[index - 1].phaseIndex,
      );
      stageOutputs[index] = signal;
    }
    result[frame] = Number.isFinite(signal) ? signal : 0;

    for (let index = 0; index < stages; index += 1) {
      const next = phases[index] + increments[index];
      phases[index] = next >= TWO_PI ? next - TWO_PI : next;
    }
  }
  return result;
}

export function formatCascadeFrequency(hz) {
  const value = Number(hz);
  if (!Number.isFinite(value) || value <= 0) return "0 Hz";
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")} kHz`;
  }
  if (value >= 10) return `${Math.round(value)} Hz`;
  if (value >= 1) return `${value.toFixed(2).replace(/\.?0+$/, "")} Hz`;
  if (value >= 0.001) {
    return `${value.toFixed(3).replace(/\.?0+$/, "")} Hz`;
  }
  if (value >= 0.000001) {
    const microhertz = value * 1_000_000;
    const digits = microhertz >= 10 ? 1 : 2;
    return `${microhertz.toFixed(digits).replace(/\.?0+$/, "")} µHz`;
  }
  const nanohertz = value * 1_000_000_000;
  const digits = nanohertz >= 10 ? 1 : 2;
  return `${nanohertz.toFixed(digits).replace(/\.?0+$/, "")} nHz`;
}

export const formatCascadingPmFrequency = formatCascadeFrequency;

export function formatPhaseIndex(value) {
  const safe = clamp(
    finiteOr(value, 0),
    CASCADING_PM_LIMITS.minPhaseIndex,
    CASCADING_PM_LIMITS.maxInternalPhaseIndex,
  );
  return `${safe.toFixed(safe >= 10 ? 1 : 2).replace(/\.?0+$/, "")} rad`;
}

const ROOT_SLIDER_MIN = CASCADING_PM_LIMITS.minRootHz;
const ROOT_SLIDER_MAX = CASCADING_PM_LIMITS.maxRootHz;
const RATIO_SLIDER_MIN = CASCADING_PM_LIMITS.minCascadeRatio;
const RATIO_SLIDER_MAX = CASCADING_PM_LIMITS.maxCascadeRatio;
const RATIO_SLIDER_MUSICAL_MAX = 5;
const RATIO_SLIDER_MUSICAL_WIDTH = 0.4;
const RATIO_SLIDER_UNITY_POSITION = RATIO_SLIDER_MUSICAL_WIDTH
  * Math.log(1 / RATIO_SLIDER_MIN)
  / Math.log(RATIO_SLIDER_MUSICAL_MAX);
const RATIO_SLIDER_MUSICAL_END = RATIO_SLIDER_UNITY_POSITION
  + RATIO_SLIDER_MUSICAL_WIDTH;

function logarithmicSliderValue(position, minimum, maximum) {
  const safe = clamp(finiteOr(position, 0), 0, 1);
  return minimum * ((maximum / minimum) ** safe);
}

function logarithmicSliderPosition(value, minimum, maximum) {
  const safe = clamp(finiteOr(value, minimum), minimum, maximum);
  return Math.log(safe / minimum) / Math.log(maximum / minimum);
}

export function rootHzSliderValue(position) {
  return logarithmicSliderValue(position, ROOT_SLIDER_MIN, ROOT_SLIDER_MAX);
}

export function rootHzSliderPosition(value) {
  return logarithmicSliderPosition(value, ROOT_SLIDER_MIN, ROOT_SLIDER_MAX);
}

export function ratioSliderValue(position) {
  const safe = clamp(finiteOr(position, 0), 0, 1);
  if (safe <= RATIO_SLIDER_UNITY_POSITION) {
    return logarithmicSliderValue(
      safe / RATIO_SLIDER_UNITY_POSITION,
      RATIO_SLIDER_MIN,
      1,
    );
  }
  if (safe <= RATIO_SLIDER_MUSICAL_END) {
    return logarithmicSliderValue(
      (safe - RATIO_SLIDER_UNITY_POSITION) / RATIO_SLIDER_MUSICAL_WIDTH,
      1,
      RATIO_SLIDER_MUSICAL_MAX,
    );
  }
  return logarithmicSliderValue(
    (safe - RATIO_SLIDER_MUSICAL_END) / (1 - RATIO_SLIDER_MUSICAL_END),
    RATIO_SLIDER_MUSICAL_MAX,
    RATIO_SLIDER_MAX,
  );
}

export function ratioSliderPosition(value) {
  const safe = clamp(
    finiteOr(value, RATIO_SLIDER_MIN),
    RATIO_SLIDER_MIN,
    RATIO_SLIDER_MAX,
  );
  if (safe <= 1) {
    return logarithmicSliderPosition(safe, RATIO_SLIDER_MIN, 1)
      * RATIO_SLIDER_UNITY_POSITION;
  }
  if (safe <= RATIO_SLIDER_MUSICAL_MAX) {
    return RATIO_SLIDER_UNITY_POSITION
      + logarithmicSliderPosition(safe, 1, RATIO_SLIDER_MUSICAL_MAX)
        * RATIO_SLIDER_MUSICAL_WIDTH;
  }
  return RATIO_SLIDER_MUSICAL_END
    + logarithmicSliderPosition(safe, RATIO_SLIDER_MUSICAL_MAX, RATIO_SLIDER_MAX)
      * (1 - RATIO_SLIDER_MUSICAL_END);
}

// Quadratic mapping leaves useful precision around subtle, sub-radian PM.
export function phaseIndexSliderValue(position) {
  const safe = clamp(finiteOr(position, 0), 0, 1);
  return CASCADING_PM_LIMITS.maxPhaseIndex * safe * safe;
}

export function phaseIndexSliderPosition(value) {
  const safe = clamp(
    finiteOr(value, 0),
    CASCADING_PM_LIMITS.minPhaseIndex,
    CASCADING_PM_LIMITS.maxPhaseIndex,
  );
  return Math.sqrt(safe / CASCADING_PM_LIMITS.maxPhaseIndex);
}

// ---------------------------------------------------------------------------
// AudioWorklet: persistent phase accumulators, no allocation in process().
// ---------------------------------------------------------------------------

const AudioWorkletProcessorBase = globalThis.AudioWorkletProcessor ?? class {
  constructor() {
    this.port = { onmessage: null };
  }
};

export class CascadingPmProcessor extends AudioWorkletProcessorBase {
  constructor(options = {}) {
    super();
    this.active = true;
    this._sampleRate = clamp(
      finiteOr(globalThis.sampleRate, DEFAULT_SAMPLE_RATE),
      8_000,
      192_000,
    );
    const maxStages = CASCADING_PM_LIMITS.maxStages;
    this._phases = new Float64Array(maxStages);
    this._frequencies = new Float64Array(maxStages);
    this._targetFrequencies = new Float64Array(maxStages);
    this._phaseIndices = new Float64Array(maxStages - 1);
    this._targetPhaseIndices = new Float64Array(maxStages - 1);
    this._stageOutputs = new Float64Array(maxStages);
    this._tapGains = new Float64Array(maxStages);
    this._tapStarts = new Float64Array(maxStages);
    this._tapTargets = new Float64Array(maxStages);
    this._frequencySmoothing = 1 - Math.exp(
      -1 / (this._sampleRate * PARAMETER_SMOOTHING_SECONDS),
    );
    this._indexSmoothing = 1 - Math.exp(
      -1 / (this._sampleRate * INDEX_SMOOTHING_SECONDS),
    );
    this._crossfadeStep = 1
      / Math.max(1, this._sampleRate * OUTPUT_CROSSFADE_SECONDS);
    this._outputIndex = CASCADING_PM_DEFAULTS.stages - 1;
    this._tapMix = 1;
    this._applySettings(
      options?.processorOptions?.settings ?? CASCADING_PM_DEFAULTS,
      true,
    );

    if (this.port) {
      this.port.onmessage = ({ data }) => {
        if (data?.type === "shutdown") {
          this.active = false;
          return;
        }
        if (data?.type === "settings") {
          this._applySettings(data.settings, Boolean(data.immediate));
        }
      };
    }
  }

  _applySettings(rawSettings, immediate = false) {
    // This path runs on the audio rendering thread. Keep it entirely scalar:
    // no sanitizer/ledger calls and no temporary arrays or objects.
    const source = rawSettings && typeof rawSettings === "object"
      ? rawSettings
      : CASCADING_PM_DEFAULTS;
    const stages = clamp(
      Math.round(finiteOr(source.stages, CASCADING_PM_DEFAULTS.stages)),
      CASCADING_PM_LIMITS.minStages,
      CASCADING_PM_LIMITS.maxStages,
    );
    const rootHz = clamp(
      finiteOr(source.rootHz, CASCADING_PM_DEFAULTS.rootHz),
      CASCADING_PM_LIMITS.minRootHz,
      CASCADING_PM_LIMITS.maxRootHz,
    );
    const cascadeRatio = clamp(
      finiteOr(source.cascadeRatio, CASCADING_PM_DEFAULTS.cascadeRatio),
      CASCADING_PM_LIMITS.minCascadeRatio,
      CASCADING_PM_LIMITS.maxCascadeRatio,
    );
    const startingPhaseIndex = clamp(
      finiteOr(source.phaseIndex, CASCADING_PM_DEFAULTS.phaseIndex),
      CASCADING_PM_LIMITS.minPhaseIndex,
      CASCADING_PM_LIMITS.maxPhaseIndex,
    );
    const indexTaper = clamp(
      finiteOr(source.indexTaper, CASCADING_PM_DEFAULTS.indexTaper),
      CASCADING_PM_LIMITS.minIndexTaper,
      CASCADING_PM_LIMITS.maxIndexTaper,
    );
    const maximumFrequencyHz = cascadingPmBaseFrequencyCeiling(
      this._sampleRate,
    );
    const maximumBandwidthHz = cascadingPmBandwidthCeiling(this._sampleRate);
    this._maximumBandwidthHz = maximumBandwidthHz;

    const previousOutputIndex = this._outputIndex;
    const nextOutputIndex = stages - 1;
    let highestAudibleOutputIndex = previousOutputIndex;
    if (!immediate) {
      highestAudibleOutputIndex = -1;
      for (let index = 0; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
        if (this._tapGains[index] > 0 || this._tapTargets[index] > 0) {
          highestAudibleOutputIndex = index;
        }
      }
    }

    for (let index = 0; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
      const rawFrequency = rootHz * (cascadeRatio ** index);
      const requestedFrequency = Math.min(rawFrequency, maximumFrequencyHz);
      if (immediate) {
        const activeFrequency = index < stages ? requestedFrequency : 0;
        this._targetFrequencies[index] = activeFrequency;
        this._frequencies[index] = activeFrequency;
      } else if (index < stages) {
        this._targetFrequencies[index] = requestedFrequency;
        // A newly introduced tail is still silent, so tune it before its tap
        // fades in. During an interrupted fade, preserve any stages feeding a
        // still-audible older tap and let their normal smoothing stay continuous.
        if (
          index > previousOutputIndex
          && index > highestAudibleOutputIndex
        ) {
          this._frequencies[index] = requestedFrequency;
        }
      }
      // On a non-immediate shrink, inactive targets deliberately remain at
      // their outgoing tuning until the old tap has fully faded to silence.
    }
    let priorEstimatedBandwidthHz = this._targetFrequencies[0];
    for (let index = 0; index < CASCADING_PM_LIMITS.maxStages - 1; index += 1) {
      const rawIndex = startingPhaseIndex * (indexTaper ** index);
      let requestedPhaseIndex = 0;
      if (index < stages - 1) {
        const destinationFrequencyHz = this._targetFrequencies[index + 1];
        requestedPhaseIndex = bandwidthSafePhaseIndex(
          rawIndex,
          destinationFrequencyHz,
          priorEstimatedBandwidthHz,
          maximumBandwidthHz,
        );
        priorEstimatedBandwidthHz = estimateCascadingPmBandwidth(
          destinationFrequencyHz,
          requestedPhaseIndex,
          priorEstimatedBandwidthHz,
          maximumBandwidthHz,
        );
      }
      if (immediate) {
        this._targetPhaseIndices[index] = requestedPhaseIndex;
        this._phaseIndices[index] = requestedPhaseIndex;
      } else if (index < stages - 1) {
        this._targetPhaseIndices[index] = requestedPhaseIndex;
        if (
          index >= previousOutputIndex
          && index >= highestAudibleOutputIndex
        ) {
          this._phaseIndices[index] = requestedPhaseIndex;
        }
      }
    }

    if (immediate) {
      this._outputIndex = nextOutputIndex;
      for (let index = 0; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
        const gain = index === nextOutputIndex ? 1 : 0;
        this._tapGains[index] = gain;
        this._tapStarts[index] = gain;
        this._tapTargets[index] = gain;
      }
      this._tapMix = 1;
    } else if (nextOutputIndex !== this._outputIndex) {
      this._outputIndex = nextOutputIndex;
      for (let index = 0; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
        this._tapStarts[index] = this._tapGains[index];
        this._tapTargets[index] = index === nextOutputIndex ? 1 : 0;
      }
      this._tapMix = 0;
    }
  }

  process(_inputs, outputs) {
    if (!this.active) return false;
    const channels = outputs[0];
    if (!channels?.length || !channels[0]) return true;
    const frameCount = channels[0].length;

    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let index = 0; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
        this._frequencies[index] += (
          this._targetFrequencies[index] - this._frequencies[index]
        ) * this._frequencySmoothing;
      }
      for (let index = 0; index < CASCADING_PM_LIMITS.maxStages - 1; index += 1) {
        this._phaseIndices[index] += (
          this._targetPhaseIndices[index] - this._phaseIndices[index]
        ) * this._indexSmoothing;
      }

      let signal = Math.sin(this._phases[0]);
      this._stageOutputs[0] = signal;
      let priorEstimatedBandwidthHz = this._frequencies[0];
      for (let index = 1; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
        const effectivePhaseIndex = bandwidthSafePhaseIndex(
          this._phaseIndices[index - 1],
          this._frequencies[index],
          priorEstimatedBandwidthHz,
          this._maximumBandwidthHz,
        );
        signal = Math.sin(
          this._phases[index]
          + this._stageOutputs[index - 1] * effectivePhaseIndex,
        );
        this._stageOutputs[index] = signal;
        priorEstimatedBandwidthHz = estimateCascadingPmBandwidth(
          this._frequencies[index],
          effectivePhaseIndex,
          priorEstimatedBandwidthHz,
          this._maximumBandwidthHz,
        );
      }

      if (this._tapMix < 1) {
        this._tapMix = Math.min(1, this._tapMix + this._crossfadeStep);
      }
      const completedTapFade = this._tapMix === 1
        && this._tapTargets[this._outputIndex] !== this._tapGains[this._outputIndex];
      let output = 0;
      for (let index = 0; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
        const gain = this._tapStarts[index]
          + (this._tapTargets[index] - this._tapStarts[index]) * this._tapMix;
        this._tapGains[index] = gain;
        output += this._stageOutputs[index] * gain;
      }
      const boundedOutput = Number.isFinite(output)
        ? clamp(output, -1, 1)
        : 0;

      for (let channel = 0; channel < channels.length; channel += 1) {
        channels[channel][frame] = boundedOutput;
      }

      if (completedTapFade) {
        // The outgoing tap is now exactly silent. Clear its unused tail in one
        // step so future expansions can be tuned before they fade in, without
        // leaving ultrasonic inactive targets running in the background.
        for (
          let index = this._outputIndex + 1;
          index < CASCADING_PM_LIMITS.maxStages;
          index += 1
        ) {
          this._frequencies[index] = 0;
          this._targetFrequencies[index] = 0;
        }
        for (
          let index = this._outputIndex;
          index < CASCADING_PM_LIMITS.maxStages - 1;
          index += 1
        ) {
          this._phaseIndices[index] = 0;
          this._targetPhaseIndices[index] = 0;
        }
      }

      for (let index = 0; index < CASCADING_PM_LIMITS.maxStages; index += 1) {
        let phase = this._phases[index]
          + TWO_PI * this._frequencies[index] / this._sampleRate;
        if (phase >= TWO_PI) phase -= TWO_PI;
        this._phases[index] = phase;
      }
    }
    return true;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor(CASCADING_PM_PROCESSOR_NAME, CascadingPmProcessor);
}

// ---------------------------------------------------------------------------
// Main-thread AudioWorklet owner. Kept here so the UI never duplicates DSP.
// ---------------------------------------------------------------------------

function smoothAudioParam(param, value, context, timeConstant) {
  if (!param || !context) return;
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, timeConstant);
}

function configureCompressor(compressor) {
  compressor.threshold.value = -16;
  compressor.knee.value = 18;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
}

export class CascadingPmAudioEngine {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.worklet = null;
    this.normalizationGain = null;
    this.masterGain = null;
    this.compressor = null;
    this.ceilingGain = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.waveform = null;
    this.nodes = [];
    this.stopping = false;
    this.settings = sanitizeCascadingPmSettings();
    this.outputLevel = 0.58;
  }

  get running() {
    return Boolean(this.context) && !this.stopping;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  async start(settings, level = this.outputLevel) {
    if (this.running) {
      if (this.context.state === "suspended") {
        unlockAudioContext(this.context);
        await this.context.resume();
      }
      this.updateSettings(settings);
      this.setLevel(level);
      return;
    }

    const AudioContextConstructor = this.runtime.AudioContext
      || this.runtime.webkitAudioContext;
    const AudioWorkletNodeConstructor = this.runtime.AudioWorkletNode;
    if (!AudioContextConstructor || !AudioWorkletNodeConstructor) {
      throw new Error("AudioWorklet is not available in this browser.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.context = context;
    this.stopping = false;

    try {
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./cascading-pm.js", import.meta.url),
      );

      const worklet = new AudioWorkletNodeConstructor(
        context,
        CASCADING_PM_PROCESSOR_NAME,
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: {
            settings: deriveCascadeStack(
              settings,
              { sampleRate: context.sampleRate },
            ).settings,
          },
        },
      );
      const normalizationGain = context.createGain();
      const masterGain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      const ceilingGain = context.createGain();
      const analyser = context.createAnalyser();

      normalizationGain.gain.value = 0;
      masterGain.gain.value = 0;
      ceilingGain.gain.value = 0.82;
      configureCompressor(compressor);
      analyser.fftSize = 2_048;
      analyser.minDecibels = -90;
      analyser.maxDecibels = 0;
      analyser.smoothingTimeConstant = 0.45;

      worklet.connect(normalizationGain);
      normalizationGain.connect(masterGain);
      masterGain.connect(compressor);
      compressor.connect(ceilingGain);
      ceilingGain.connect(analyser);
      this.releaseAudioOutput = connectAudioOutput(context, analyser, { runtime: this.runtime });

      this.worklet = worklet;
      this.normalizationGain = normalizationGain;
      this.masterGain = masterGain;
      this.compressor = compressor;
      this.ceilingGain = ceilingGain;
      this.analyser = analyser;
      this.waveform = new Uint8Array(512);
      this.nodes = [
        worklet,
        normalizationGain,
        masterGain,
        compressor,
        ceilingGain,
        analyser,
      ];

      this.updateSettings(settings, { immediate: true });
      this.setLevel(level, { immediate: true });
    } catch (error) {
      await this.stop({ immediate: true });
      throw error;
    }
  }

  updateSettings(settings, { immediate = false } = {}) {
    const stack = deriveCascadeStack(
      settings,
      { sampleRate: this.sampleRate },
    );
    this.settings = stack.settings;
    if (!this.context || !this.worklet) return stack;

    this.worklet.port.postMessage({
      type: "settings",
      settings: stack.settings,
      immediate,
    });
    smoothAudioParam(
      this.normalizationGain?.gain,
      stack.normalizedGain,
      this.context,
      immediate ? 0.001 : PARAMETER_SMOOTHING_SECONDS,
    );
    return stack;
  }

  setLevel(level, { immediate = false } = {}) {
    this.outputLevel = clamp(finiteOr(level, 0), 0, 1);
    if (!this.context || !this.masterGain) return;
    smoothAudioParam(
      this.masterGain.gain,
      this.outputLevel,
      this.context,
      immediate ? 0.001 : 0.012,
    );
  }

  readWaveform() {
    if (!this.running || !this.analyser || !this.waveform) return null;
    this.analyser.getByteTimeDomainData(this.waveform);
    return this.waveform;
  }

  async stop({ immediate = false } = {}) {
    if (!this.context || this.stopping) return;
    this.stopping = true;
    const context = this.context;
    const releaseAudioOutput = this.releaseAudioOutput;
    const nodes = [...this.nodes];
    this.releaseAudioOutput = null;

    if (this.masterGain) {
      const now = context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      if (immediate) {
        this.masterGain.gain.setValueAtTime(0, now);
      } else {
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.025);
      }
    }
    if (!immediate) {
      const setTimeoutFunction = this.runtime.setTimeout ?? globalThis.setTimeout;
      await new Promise((resolve) => setTimeoutFunction(resolve, 32));
    }
    releaseAudioOutput?.();
    try {
      this.worklet?.port.postMessage({ type: "shutdown" });
    } catch {
      // The worklet port may already be gone during page dismissal.
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Disconnection is best-effort while the page is being discarded.
      }
    }
    if (context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // A browser may abandon close() during navigation.
      }
    }
    if (this.context === context) {
      this.context = null;
      this.worklet = null;
      this.normalizationGain = null;
      this.masterGain = null;
      this.compressor = null;
      this.ceilingGain = null;
      this.analyser = null;
      this.waveform = null;
      this.nodes = [];
      this.stopping = false;
    }
  }
}
