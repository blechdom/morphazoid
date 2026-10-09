import { CASCADING_AM_RHYTHM_PRESETS } from "./presets.js";
import { unlockAudioContext } from "../../audio.js";
import { connectAudioOutput } from "../../audio-output-manager.js";

// Cascading amplitude modulation (AM), using Synthesaurus's biased AM with
// bias fixed at 1 (synthesis/rust/core/src/conventional.rs, method 9):
//   signal[0] = sin(phase[0])
//   signal[i] = sin(phase[i]) * (1 + depth[i - 1] * signal[i - 1]) / (1 + depth[i - 1])
// Each nonnegative amplitude multiplier is bounded to 0…1. Only the final
// stage reaches the output; every oscillator keeps its own fixed phase rate.

export const CASCADING_AM_PROCESSOR_NAME = "morphazoid-cascading-am";

const DEFAULT_SAMPLE_RATE = 48_000;
const TWO_PI = Math.PI * 2;
const PARAMETER_SMOOTHING_SECONDS = 0.018;
const DEPTH_SMOOTHING_SECONDS = 0.012;
const OUTPUT_CROSSFADE_SECONDS = 0.014;

export const CASCADING_AM_LIMITS = Object.freeze({
  minStages: 2,
  maxStages: 12,
  minRootHz: 0.02,
  maxRootHz: 110,
  minCascadeRatio: 0.25,
  maxCascadeRatio: 200,
  minModulationDepth: 0,
  maxModulationDepth: 1,
  minDepthTaper: 0.05,
  maxDepthTaper: 4,
  maxInternalModulationDepth: 1,
  audioCeiling: 20_000,
  baseFrequencySampleRateRatio: 0.4,
  bandwidthSampleRateRatio: 0.45,
});

// Preset data is separate from DSP; the rhythmic bank is shared by startup,
// Reset and the header use this same complete bank.
export { CASCADING_AM_RHYTHM_PRESETS as CASCADING_AM_PRESETS };
export const CASCADING_AM_DEFAULTS = CASCADING_AM_RHYTHM_PRESETS[0].settings;
export const DEFAULT_CASCADING_AM_PRESET_ID = CASCADING_AM_RHYTHM_PRESETS[0].id;

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

export function cascadingAmBaseFrequencyCeiling(sampleRate) {
  const safeSampleRate = safeSampleRateValue(sampleRate);
  return Math.min(
    CASCADING_AM_LIMITS.audioCeiling,
    safeSampleRate * CASCADING_AM_LIMITS.baseFrequencySampleRateRatio,
  );
}

export function cascadingAmBandwidthCeiling(sampleRate) {
  return safeSampleRateValue(sampleRate)
    * CASCADING_AM_LIMITS.bandwidthSampleRateRatio;
}

/** Scale contrast before projecting it into a bounded AM depth. */
export function cascadeModulationDepth(depth, taper, stageIndex) {
  const d = clamp(finiteOr(depth, 0), 0, 1);
  const scale = clamp(finiteOr(taper, 1), 0.05, 4)
    ** clamp(Math.round(finiteOr(stageIndex, 0)), 0, 11);
  return d * scale / (1 - d + d * scale);
}

/**
 * AM sidebands extend to carrier + incoming bandwidth regardless of depth.
 * Fade modulation to zero over a headroom band before that sum reaches the
 * ceiling. The inherited ledger remains conservative even for bypassed links.
 */
export function bandwidthSafeModulationDepth(rawDepth, destinationFrequencyHz,
  priorEstimatedBandwidthHz, maximumBandwidthHz) {
  const depth = clamp(finiteOr(rawDepth, 0), 0, 1);
  const ceiling = Math.max(1, finiteOr(maximumBandwidthHz, 1));
  const headroom = ceiling - Math.max(0, finiteOr(destinationFrequencyHz, 0))
    - Math.max(0, finiteOr(priorEstimatedBandwidthHz, 0));
  const fade = clamp(headroom / (ceiling * 0.1), 0, 1);
  return depth * fade * fade * (3 - 2 * fade);
}

export function estimateCascadingAmBandwidth(destinationFrequencyHz,
  _effectiveDepth, priorEstimatedBandwidthHz, maximumBandwidthHz) {
  return Math.min(maximumBandwidthHz, destinationFrequencyHz + priorEstimatedBandwidthHz);
}

export function sanitizeCascadingAmSettings(raw = {}) {
  const limits = CASCADING_AM_LIMITS;
  const defaults = CASCADING_AM_DEFAULTS;
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
    modulationDepth: clamp(
      finiteOr(source.modulationDepth, defaults.modulationDepth),
      limits.minModulationDepth,
      limits.maxModulationDepth,
    ),
    depthTaper: clamp(
      finiteOr(source.depthTaper, defaults.depthTaper),
      limits.minDepthTaper,
      limits.maxDepthTaper,
    ),
  });
}

/** Preserve the first-to-last frequency span when inserting/removing stages. */
export function cascadeRatioForStageCount(ratio, previousStages, nextStages) {
  const limits = CASCADING_AM_LIMITS;
  const safeRatio = clamp(
    finiteOr(ratio, CASCADING_AM_DEFAULTS.cascadeRatio),
    limits.minCascadeRatio,
    limits.maxCascadeRatio,
  );
  const safePreviousStages = clamp(
    Math.round(finiteOr(previousStages, CASCADING_AM_DEFAULTS.stages)),
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

/** Operator ledger shared by the diagram, offline rendering and worklet. */
export function deriveCascadeStack(rawSettings = {}, { sampleRate = DEFAULT_SAMPLE_RATE } = {}) {
  const settings = sanitizeCascadingAmSettings(rawSettings);
  const maximumFrequencyHz = cascadingAmBaseFrequencyCeiling(sampleRate);
  const maximumBandwidthHz = cascadingAmBandwidthCeiling(sampleRate);
  const oscillators = [];
  let boundedByFrequency = false;
  for (let index = 0; index < settings.stages; index += 1) {
    const rawFrequencyHz = settings.rootHz * settings.cascadeRatio ** index;
    const frequencyHz = Math.min(rawFrequencyHz, maximumFrequencyHz);
    boundedByFrequency ||= frequencyHz !== rawFrequencyHz;
    oscillators.push({ freq: frequencyHz, frequencyHz, rawFrequencyHz,
      estimatedBandwidthHz: frequencyHz, stageIndex: index, isLfo: index === 0,
      isCarrier: index === settings.stages - 1, wasLimited: frequencyHz !== rawFrequencyHz });
  }
  const connections = [];
  let boundedByBandwidth = false;
  let priorEstimatedBandwidthHz = oscillators[0].frequencyHz;
  for (let index = 0; index < settings.stages - 1; index += 1) {
    const rawModulationDepth = cascadeModulationDepth(settings.modulationDepth, settings.depthTaper, index);
    const destination = oscillators[index + 1].frequencyHz;
    const modulationDepth = bandwidthSafeModulationDepth(rawModulationDepth,
      destination, priorEstimatedBandwidthHz, maximumBandwidthHz);
    const estimatedBandwidthHz = estimateCascadingAmBandwidth(destination,
      modulationDepth, priorEstimatedBandwidthHz, maximumBandwidthHz);
    const limitedByBandwidth = modulationDepth < rawModulationDepth;
    boundedByBandwidth ||= limitedByBandwidth;
    oscillators[index + 1].estimatedBandwidthHz = estimatedBandwidthHz;
    connections.push(Object.freeze({ from: index, to: index + 1, modulationDepth,
      rawModulationDepth, priorEstimatedBandwidthHz, estimatedBandwidthHz,
      limitedByBandwidth, wasLimited: limitedByBandwidth }));
    priorEstimatedBandwidthHz = estimatedBandwidthHz;
  }
  return Object.freeze({ settings,
    oscillators: Object.freeze(oscillators.map(Object.freeze)),
    connections: Object.freeze(connections), outputIndex: settings.stages - 1,
    maximumFrequencyHz, maximumBandwidthHz, boundedByFrequency, boundedByBandwidth,
    // Biased AM already bounds every stage, regardless of chain length.
    normalizedGain: 0.7 });
}

export const deriveCascadingAmStack = deriveCascadeStack;

/** Evaluate one feed-forward AM cascade without mutating the supplied phases. */
export function evaluateAmplitudeCascade(phases, stackOrSettings = {}) {
  const stack = stackOrSettings?.oscillators && stackOrSettings?.connections
    ? stackOrSettings
    : deriveCascadeStack(stackOrSettings);
  const stageOutputs = new Array(stack.oscillators.length);
  let signal = Math.sin(finiteOr(phases?.[0], 0));
  stageOutputs[0] = signal;

  for (let index = 1; index < stack.oscillators.length; index += 1) {
    const phase = finiteOr(phases?.[index], 0);
    const modulationDepth = stack.connections[index - 1]?.modulationDepth ?? 0;
    signal = Math.sin(phase) * (1 + signal * modulationDepth) / (1 + modulationDepth);
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
export function renderCascadingAmSamples(
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
      const depth = stack.connections[index - 1].modulationDepth;
      signal = Math.sin(phases[index]) * (1 + stageOutputs[index - 1] * depth) / (1 + depth);
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

export const formatCascadingAmFrequency = formatCascadeFrequency;

export function formatModulationDepth(value) {
  const safe = clamp(
    finiteOr(value, 0),
    CASCADING_AM_LIMITS.minModulationDepth,
    CASCADING_AM_LIMITS.maxInternalModulationDepth,
  );
  return `${(safe * 100).toFixed(1).replace(/\.?0+$/, "")}%`;
}

const ROOT_SLIDER_MIN = CASCADING_AM_LIMITS.minRootHz;
const ROOT_SLIDER_MAX = CASCADING_AM_LIMITS.maxRootHz;
const RATIO_SLIDER_MIN = CASCADING_AM_LIMITS.minCascadeRatio;
const RATIO_SLIDER_MAX = CASCADING_AM_LIMITS.maxCascadeRatio;
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

// Quadratic mapping leaves useful precision around shallow AM.
export function modulationDepthSliderValue(position) {
  const safe = clamp(finiteOr(position, 0), 0, 1);
  return CASCADING_AM_LIMITS.maxModulationDepth * safe * safe;
}

export function modulationDepthSliderPosition(value) {
  const safe = clamp(
    finiteOr(value, 0),
    CASCADING_AM_LIMITS.minModulationDepth,
    CASCADING_AM_LIMITS.maxModulationDepth,
  );
  return Math.sqrt(safe / CASCADING_AM_LIMITS.maxModulationDepth);
}

// ---------------------------------------------------------------------------
// AudioWorklet: persistent phase accumulators, no allocation in process().
// ---------------------------------------------------------------------------

const AudioWorkletProcessorBase = globalThis.AudioWorkletProcessor ?? class {
  constructor() {
    this.port = { onmessage: null };
  }
};

export class CascadingAmProcessor extends AudioWorkletProcessorBase {
  constructor(options = {}) {
    super();
    this.active = true;
    this._sampleRate = clamp(
      finiteOr(globalThis.sampleRate, DEFAULT_SAMPLE_RATE),
      8_000,
      192_000,
    );
    const maxStages = CASCADING_AM_LIMITS.maxStages;
    this._phases = new Float64Array(maxStages);
    this._frequencies = new Float64Array(maxStages);
    this._targetFrequencies = new Float64Array(maxStages);
    this._modulationDepths = new Float64Array(maxStages - 1);
    this._targetModulationDepths = new Float64Array(maxStages - 1);
    this._stageOutputs = new Float64Array(maxStages);
    this._tapGains = new Float64Array(maxStages);
    this._tapStarts = new Float64Array(maxStages);
    this._tapTargets = new Float64Array(maxStages);
    this._frequencySmoothing = 1 - Math.exp(
      -1 / (this._sampleRate * PARAMETER_SMOOTHING_SECONDS),
    );
    this._depthSmoothing = 1 - Math.exp(
      -1 / (this._sampleRate * DEPTH_SMOOTHING_SECONDS),
    );
    this._crossfadeStep = 1
      / Math.max(1, this._sampleRate * OUTPUT_CROSSFADE_SECONDS);
    this._outputIndex = CASCADING_AM_DEFAULTS.stages - 1;
    this._tapMix = 1;
    this._applySettings(
      options?.processorOptions?.settings ?? CASCADING_AM_DEFAULTS,
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
      : CASCADING_AM_DEFAULTS;
    const stages = clamp(
      Math.round(finiteOr(source.stages, CASCADING_AM_DEFAULTS.stages)),
      CASCADING_AM_LIMITS.minStages,
      CASCADING_AM_LIMITS.maxStages,
    );
    const rootHz = clamp(
      finiteOr(source.rootHz, CASCADING_AM_DEFAULTS.rootHz),
      CASCADING_AM_LIMITS.minRootHz,
      CASCADING_AM_LIMITS.maxRootHz,
    );
    const cascadeRatio = clamp(
      finiteOr(source.cascadeRatio, CASCADING_AM_DEFAULTS.cascadeRatio),
      CASCADING_AM_LIMITS.minCascadeRatio,
      CASCADING_AM_LIMITS.maxCascadeRatio,
    );
    const startingModulationDepth = clamp(
      finiteOr(source.modulationDepth, CASCADING_AM_DEFAULTS.modulationDepth),
      CASCADING_AM_LIMITS.minModulationDepth,
      CASCADING_AM_LIMITS.maxModulationDepth,
    );
    const depthTaper = clamp(
      finiteOr(source.depthTaper, CASCADING_AM_DEFAULTS.depthTaper),
      CASCADING_AM_LIMITS.minDepthTaper,
      CASCADING_AM_LIMITS.maxDepthTaper,
    );
    const maximumFrequencyHz = cascadingAmBaseFrequencyCeiling(
      this._sampleRate,
    );
    const maximumBandwidthHz = cascadingAmBandwidthCeiling(this._sampleRate);
    this._maximumBandwidthHz = maximumBandwidthHz;

    const previousOutputIndex = this._outputIndex;
    const nextOutputIndex = stages - 1;
    let highestAudibleOutputIndex = previousOutputIndex;
    if (!immediate) {
      highestAudibleOutputIndex = -1;
      for (let index = 0; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
        if (this._tapGains[index] > 0 || this._tapTargets[index] > 0) {
          highestAudibleOutputIndex = index;
        }
      }
    }

    for (let index = 0; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
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
    for (let index = 0; index < CASCADING_AM_LIMITS.maxStages - 1; index += 1) {
      // The sample loop guards the actual smoothed frequencies. Keep raw depth
      // here so a partially faded headroom guard is applied exactly once.
      const requestedModulationDepth = index < stages - 1
        ? cascadeModulationDepth(startingModulationDepth, depthTaper, index)
        : 0;
      if (immediate) {
        this._targetModulationDepths[index] = requestedModulationDepth;
        this._modulationDepths[index] = requestedModulationDepth;
      } else if (index < stages - 1) {
        this._targetModulationDepths[index] = requestedModulationDepth;
        if (
          index >= previousOutputIndex
          && index >= highestAudibleOutputIndex
        ) {
          this._modulationDepths[index] = requestedModulationDepth;
        }
      }
    }

    if (immediate) {
      this._outputIndex = nextOutputIndex;
      for (let index = 0; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
        const gain = index === nextOutputIndex ? 1 : 0;
        this._tapGains[index] = gain;
        this._tapStarts[index] = gain;
        this._tapTargets[index] = gain;
      }
      this._tapMix = 1;
    } else if (nextOutputIndex !== this._outputIndex) {
      this._outputIndex = nextOutputIndex;
      for (let index = 0; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
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
      for (let index = 0; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
        this._frequencies[index] += (
          this._targetFrequencies[index] - this._frequencies[index]
        ) * this._frequencySmoothing;
      }
      for (let index = 0; index < CASCADING_AM_LIMITS.maxStages - 1; index += 1) {
        this._modulationDepths[index] += (
          this._targetModulationDepths[index] - this._modulationDepths[index]
        ) * this._depthSmoothing;
      }

      let signal = Math.sin(this._phases[0]);
      this._stageOutputs[0] = signal;
      let priorEstimatedBandwidthHz = this._frequencies[0];
      for (let index = 1; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
        const effectiveModulationDepth = bandwidthSafeModulationDepth(
          this._modulationDepths[index - 1],
          this._frequencies[index],
          priorEstimatedBandwidthHz,
          this._maximumBandwidthHz,
        );
        signal = Math.sin(this._phases[index])
          * (1 + this._stageOutputs[index - 1] * effectiveModulationDepth)
          / (1 + effectiveModulationDepth);
        this._stageOutputs[index] = signal;
        priorEstimatedBandwidthHz = estimateCascadingAmBandwidth(
          this._frequencies[index],
          effectiveModulationDepth,
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
      for (let index = 0; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
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
          index < CASCADING_AM_LIMITS.maxStages;
          index += 1
        ) {
          this._frequencies[index] = 0;
          this._targetFrequencies[index] = 0;
        }
        for (
          let index = this._outputIndex;
          index < CASCADING_AM_LIMITS.maxStages - 1;
          index += 1
        ) {
          this._modulationDepths[index] = 0;
          this._targetModulationDepths[index] = 0;
        }
      }

      for (let index = 0; index < CASCADING_AM_LIMITS.maxStages; index += 1) {
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
  registerProcessor(CASCADING_AM_PROCESSOR_NAME, CascadingAmProcessor);
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

export class CascadingAmAudioEngine {
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
    this.settings = sanitizeCascadingAmSettings();
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
        new URL("./cascading-am.js", import.meta.url),
      );

      const worklet = new AudioWorkletNodeConstructor(
        context,
        CASCADING_AM_PROCESSOR_NAME,
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
