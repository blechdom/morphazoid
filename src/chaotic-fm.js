const PROCESSOR_NAME = "morphazoid-chaotic-fm";
const TAU = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MAX_AUDIBLE_FREQUENCY = 20_000;
const MAX_SHAPER_INPUT = 64;

export const CHAOTIC_FM_LIMITS = Object.freeze({
  minDepth: 0,
  maxDepth: 10,
  minCarrierHz: 0.01,
  maxCarrierHz: 4_800,
  maxOffsetHz: 4_800,
  maxModulationAmount: 4_800,
  minAmountDivisor: 0.001,
  maxAmountDivisor: 8,
  minNonlinearityHz: 0.001,
  maxNonlinearityHz: 4_000,
  maxOutput: 0.82,
});

const freezePreset = (preset) => Object.freeze({
  ...preset,
  settings: Object.freeze({ ...preset.settings }),
});

/**
 * The five parameter sets in Morphisma's original ChaoticFMAudio experiment.
 * Only the names and descriptions are new. The synthesis values are exact.
 */
export const CHAOTIC_FM_PRESETS = Object.freeze([
  freezePreset({
    id: "feedback-nest",
    label: "Feedback Nest",
    description: "A fast 10.5 Hz seed drives one broad, unstable nonlinear turn.",
    settings: {
      depth: 1,
      carrierHz: 10.5,
      offsetHz: 0,
      modulationAmount: 350,
      amountDivisor: 0.4,
      nonlinearityHz: 256,
    },
  }),
  freezePreset({
    id: "slow-furnace",
    label: "Slow Furnace",
    description: "Four progressively smaller turns unfold around a 1.798 Hz carrier.",
    settings: {
      depth: 4,
      carrierHz: 1.798,
      offsetHz: 100,
      modulationAmount: 4_200,
      amountDivisor: 4,
      nonlinearityHz: 375,
    },
  }),
  freezePreset({
    id: "glass-hive",
    label: "Glass Hive",
    description: "Five narrow recursive layers produce a brittle, animated harmonic cloud.",
    settings: {
      depth: 5,
      carrierHz: 0.129,
      offsetHz: 637,
      modulationAmount: 2_737,
      amountDivisor: 5.8,
      nonlinearityHz: 531,
    },
  }),
  freezePreset({
    id: "cut-current",
    label: "Cut Current",
    description: "A wide entry sweep collapses through two sharp nonlinear oscillators.",
    settings: {
      depth: 2,
      carrierHz: 0.143,
      offsetHz: 637,
      modulationAmount: 4_762,
      amountDivisor: 7.611,
      nonlinearityHz: 1_024,
    },
  }),
  freezePreset({
    id: "brass-moth",
    label: "Brass Moth",
    description: "A compact one-turn patch with an 11 Hz flutter and bright offset.",
    settings: {
      depth: 1,
      carrierHz: 11,
      offsetHz: 787,
      modulationAmount: 125,
      amountDivisor: 4.3,
      nonlinearityHz: 725,
    },
  }),
]);

export const DEFAULT_CHAOTIC_FM_PRESET_ID = "feedback-nest";

export const CHAOTIC_FM_DEFAULTS = Object.freeze({
  ...CHAOTIC_FM_PRESETS[0].settings,
  output: 0.42,
});

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

/**
 * Contain values before they enter the render thread. Negative recursive
 * frequencies remain valid (they reverse phase direction), but their
 * magnitude is bounded below the current sample rate's Nyquist frequency.
 */
export function sanitizeChaoticFmParams(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const maximumFrequencyHz = sampleRateCeiling(sampleRate);
  return Object.freeze({
    depth: Math.round(clamp(
      legacyValue(params, "depth", "steps", CHAOTIC_FM_DEFAULTS.depth),
      CHAOTIC_FM_LIMITS.minDepth,
      CHAOTIC_FM_LIMITS.maxDepth,
      CHAOTIC_FM_DEFAULTS.depth,
    )),
    carrierHz: clamp(
      legacyValue(params, "carrierHz", "carrierFreq", CHAOTIC_FM_DEFAULTS.carrierHz),
      CHAOTIC_FM_LIMITS.minCarrierHz,
      Math.min(CHAOTIC_FM_LIMITS.maxCarrierHz, maximumFrequencyHz),
      CHAOTIC_FM_DEFAULTS.carrierHz,
    ),
    offsetHz: clamp(
      legacyValue(params, "offsetHz", "offset", CHAOTIC_FM_DEFAULTS.offsetHz),
      0,
      Math.min(CHAOTIC_FM_LIMITS.maxOffsetHz, maximumFrequencyHz),
      CHAOTIC_FM_DEFAULTS.offsetHz,
    ),
    modulationAmount: clamp(
      legacyValue(
        params,
        "modulationAmount",
        "modAmp",
        CHAOTIC_FM_DEFAULTS.modulationAmount,
      ),
      0,
      CHAOTIC_FM_LIMITS.maxModulationAmount,
      CHAOTIC_FM_DEFAULTS.modulationAmount,
    ),
    amountDivisor: clamp(
      legacyValue(
        params,
        "amountDivisor",
        "modAmpDiv",
        CHAOTIC_FM_DEFAULTS.amountDivisor,
      ),
      CHAOTIC_FM_LIMITS.minAmountDivisor,
      CHAOTIC_FM_LIMITS.maxAmountDivisor,
      CHAOTIC_FM_DEFAULTS.amountDivisor,
    ),
    nonlinearityHz: clamp(
      legacyValue(
        params,
        "nonlinearityHz",
        "filter",
        CHAOTIC_FM_DEFAULTS.nonlinearityHz,
      ),
      CHAOTIC_FM_LIMITS.minNonlinearityHz,
      Math.min(CHAOTIC_FM_LIMITS.maxNonlinearityHz, maximumFrequencyHz),
      CHAOTIC_FM_DEFAULTS.nonlinearityHz,
    ),
    output: clamp(
      params.output,
      0,
      CHAOTIC_FM_LIMITS.maxOutput,
      CHAOTIC_FM_DEFAULTS.output,
    ),
    maximumFrequencyHz,
  });
}

function boundedRecursiveAmount(value) {
  return clamp(value, 0, 1e12, 0);
}

/**
 * Describe the exact legacy stack:
 *
 * carrier = sin(phase(carrierHz))
 * entryHz = offset + amount/2 + carrier * amount/2
 * entry = sin(phase(entryHz))
 * turn[n]Hz = nonlinearityHz * tanh(previous * recursively-divided amount)
 *
 * A depth of zero returns the entry oscillator. Each additional depth adds
 * one independently phase-integrated sine oscillator.
 */
export function deriveChaoticFmStack(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const settings = sanitizeChaoticFmParams(params, { sampleRate });
  const entryHalfAmount = settings.modulationAmount * 0.5;
  const turns = [];
  let recursiveAmount = entryHalfAmount;

  for (let index = 0; index < settings.depth; index += 1) {
    turns.push(Object.freeze({
      index: index + 1,
      amount: recursiveAmount,
      amountDivisor: settings.amountDivisor,
      nonlinearityHz: settings.nonlinearityHz,
      minimumFrequencyHz: -settings.nonlinearityHz,
      maximumFrequencyHz: settings.nonlinearityHz,
    }));
    recursiveAmount = boundedRecursiveAmount(
      recursiveAmount / settings.amountDivisor,
    );
  }

  return Object.freeze({
    settings,
    carrier: Object.freeze({
      frequencyHz: settings.carrierHz,
    }),
    entry: Object.freeze({
      offsetHz: settings.offsetHz,
      centerFrequencyHz: settings.offsetHz + entryHalfAmount,
      modulationAmount: entryHalfAmount,
      minimumFrequencyHz: Math.max(0, settings.offsetHz),
      maximumFrequencyHz: Math.min(
        settings.maximumFrequencyHz,
        settings.offsetHz + settings.modulationAmount,
      ),
    }),
    turns: Object.freeze(turns),
    operatorCount: settings.depth + 2,
    audibleOperator: settings.depth + 1,
  });
}

/**
 * The recursive transfer itself. Its signed result is intentional: a
 * negative oscillator frequency runs phase backwards without producing an
 * invalid or unbounded phase increment.
 */
export function chaoticFmFrequency(
  previousSignal,
  recursiveAmount,
  nonlinearityHz,
  maximumFrequencyHz = MAX_AUDIBLE_FREQUENCY,
) {
  const signal = clamp(previousSignal, -1, 1, 0);
  const amount = boundedRecursiveAmount(recursiveAmount);
  const rate = clamp(
    nonlinearityHz,
    0,
    Math.max(0, finiteNumber(maximumFrequencyHz, MAX_AUDIBLE_FREQUENCY)),
    0,
  );
  const shapedInput = clamp(
    signal * amount,
    -MAX_SHAPER_INPUT,
    MAX_SHAPER_INPUT,
    0,
  );
  return clamp(
    rate * Math.tanh(shapedInput),
    -rate,
    rate,
    0,
  );
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

export function quadraticSliderValue(position, maximum = 4_800) {
  const safeMaximum = Math.max(0, finiteNumber(maximum, 4_800));
  const safePosition = clamp(position, 0, 1, 0);
  return safePosition * safePosition * safeMaximum;
}

export function quadraticSliderPosition(value, maximum = 4_800) {
  const safeMaximum = Math.max(Number.EPSILON, finiteNumber(maximum, 4_800));
  return Math.sqrt(clamp(value, 0, safeMaximum, 0) / safeMaximum);
}

export function formatChaoticFrequency(value) {
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
  drive = 1.45,
  ceiling = 0.91,
) {
  const size = Math.round(clamp(length, 33, 65_537, 2_049));
  const safeDrive = clamp(drive, 0.5, 4, 1.45);
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
  return class MorphazoidChaoticFmProcessor extends AudioWorkletBase {
    constructor(options = {}) {
      super();
      const initial = sanitizeChaoticFmParams(options.processorOptions);
      this.targetDepth = initial.depth;
      this.targetCarrierHz = initial.carrierHz;
      this.targetOffsetHz = initial.offsetHz;
      this.targetModulationAmount = initial.modulationAmount;
      this.targetAmountDivisor = initial.amountDivisor;
      this.targetNonlinearityHz = initial.nonlinearityHz;
      this.currentCarrierHz = initial.carrierHz;
      this.currentOffsetHz = initial.offsetHz;
      this.currentModulationAmount = initial.modulationAmount;
      this.currentAmountDivisor = initial.amountDivisor;
      this.currentNonlinearityHz = initial.nonlinearityHz;
      this.phases = new Float64Array(CHAOTIC_FM_LIMITS.maxDepth + 2);
      this.depthSignals = new Float64Array(CHAOTIC_FM_LIMITS.maxDepth + 1);
      this.depthGains = new Float64Array(CHAOTIC_FM_LIMITS.maxDepth + 1);
      this.depthGains[initial.depth] = 1;
      for (let index = 0; index < this.phases.length; index += 1) {
        this.phases[index] = (index * 0.618033988749895 % 1) * TAU;
      }
      this.activeTarget = 0;
      this.activeGain = 0;
      this.port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "parameters") {
          const safe = sanitizeChaoticFmParams({
            depth: message.parameters?.depth ?? this.targetDepth,
            carrierHz: message.parameters?.carrierHz ?? this.targetCarrierHz,
            offsetHz: message.parameters?.offsetHz ?? this.targetOffsetHz,
            modulationAmount: (
              message.parameters?.modulationAmount
              ?? this.targetModulationAmount
            ),
            amountDivisor: (
              message.parameters?.amountDivisor
              ?? this.targetAmountDivisor
            ),
            nonlinearityHz: (
              message.parameters?.nonlinearityHz
              ?? this.targetNonlinearityHz
            ),
          }, { sampleRate: Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE });
          this.targetDepth = safe.depth;
          this.targetCarrierHz = safe.carrierHz;
          this.targetOffsetHz = safe.offsetHz;
          this.targetModulationAmount = safe.modulationAmount;
          this.targetAmountDivisor = safe.amountDivisor;
          this.targetNonlinearityHz = safe.nonlinearityHz;
        } else if (message?.type === "active") {
          this.activeTarget = message.value ? 1 : 0;
        }
      };
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
      const parameterSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.028));
      const depthSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.018));
      const activeSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.008));
      const phaseScale = TAU / workletSampleRate;

      for (let sampleIndex = 0; sampleIndex < left.length; sampleIndex += 1) {
        this.currentCarrierHz += (
          this.targetCarrierHz - this.currentCarrierHz
        ) * parameterSlew;
        this.currentOffsetHz += (
          this.targetOffsetHz - this.currentOffsetHz
        ) * parameterSlew;
        this.currentModulationAmount += (
          this.targetModulationAmount - this.currentModulationAmount
        ) * parameterSlew;
        this.currentAmountDivisor += (
          this.targetAmountDivisor - this.currentAmountDivisor
        ) * parameterSlew;
        this.currentNonlinearityHz += (
          this.targetNonlinearityHz - this.currentNonlinearityHz
        ) * parameterSlew;
        this.activeGain += (
          this.activeTarget - this.activeGain
        ) * activeSlew;

        for (
          let depthIndex = 0;
          depthIndex <= CHAOTIC_FM_LIMITS.maxDepth;
          depthIndex += 1
        ) {
          const targetGain = depthIndex === this.targetDepth ? 1 : 0;
          this.depthGains[depthIndex] += (
            targetGain - this.depthGains[depthIndex]
          ) * depthSlew;
        }

        this.phases[0] = wrapPhase(
          this.phases[0] + this.currentCarrierHz * phaseScale,
        );
        const carrierSignal = Math.sin(this.phases[0]);
        const halfAmount = this.currentModulationAmount * 0.5;
        const entryFrequency = Math.min(
          frequencyCeiling,
          Math.max(
            -frequencyCeiling,
            this.currentOffsetHz + halfAmount + carrierSignal * halfAmount,
          ),
        );
        this.phases[1] = wrapPhase(
          this.phases[1] + entryFrequency * phaseScale,
        );
        let previousSignal = Math.sin(this.phases[1]);
        this.depthSignals[0] = previousSignal;
        let recursiveAmount = halfAmount;

        for (
          let depthIndex = 1;
          depthIndex <= CHAOTIC_FM_LIMITS.maxDepth;
          depthIndex += 1
        ) {
          const shapedInput = Math.min(
            MAX_SHAPER_INPUT,
            Math.max(-MAX_SHAPER_INPUT, previousSignal * recursiveAmount),
          );
          const recursiveFrequency = Math.min(
            frequencyCeiling,
            Math.max(
              -frequencyCeiling,
              this.currentNonlinearityHz * Math.tanh(shapedInput),
            ),
          );
          this.phases[depthIndex + 1] = wrapPhase(
            this.phases[depthIndex + 1] + recursiveFrequency * phaseScale,
          );
          previousSignal = Math.sin(this.phases[depthIndex + 1]);
          this.depthSignals[depthIndex] = previousSignal;
          recursiveAmount = Math.min(
            1e12,
            Math.max(
              0,
              recursiveAmount / Math.max(
                CHAOTIC_FM_LIMITS.minAmountDivisor,
                this.currentAmountDivisor,
              ),
            ),
          );
        }

        let mixedSignal = 0;
        for (
          let depthIndex = 0;
          depthIndex <= CHAOTIC_FM_LIMITS.maxDepth;
          depthIndex += 1
        ) {
          mixedSignal += (
            this.depthSignals[depthIndex] * this.depthGains[depthIndex]
          );
        }
        const sample = mixedSignal * this.activeGain * 0.5;
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
 * An inert-until-started Web Audio graph. The AudioContext is created only
 * after the page's Audio button supplies a user gesture.
 */
export class ChaoticFmAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.node = null;
    this.highpass = null;
    this.compressor = null;
    this.ceiling = null;
    this.master = null;
    this.analyser = null;
    this.params = { ...CHAOTIC_FM_DEFAULTS };
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
      await context.audioWorklet.addModule(
        new URL("./chaotic-fm.js", import.meta.url),
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
      compressor.knee.value = 10;
      compressor.ratio.value = 10;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.16;
      ceiling.curve = createSoftCeilingCurve();
      ceiling.oversample = "2x";
      master.gain.value = 0;
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.62;

      node
        .connect(highpass)
        .connect(compressor)
        .connect(ceiling)
        .connect(master)
        .connect(analyser)
        .connect(context.destination);

      this.context = context;
      this.node = node;
      this.highpass = highpass;
      this.compressor = compressor;
      this.ceiling = ceiling;
      this.master = master;
      this.analyser = analyser;
      this.setParameters(this.params);
    } catch (error) {
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
    const safe = sanitizeChaoticFmParams({
      ...this.params,
      ...params,
    }, { sampleRate: this.context?.sampleRate ?? DEFAULT_SAMPLE_RATE });
    this.params = {
      depth: safe.depth,
      carrierHz: safe.carrierHz,
      offsetHz: safe.offsetHz,
      modulationAmount: safe.modulationAmount,
      amountDivisor: safe.amountDivisor,
      nonlinearityHz: safe.nonlinearityHz,
      output: safe.output,
    };
    if (!this.isInitialized) return;
    this.node.port.postMessage({
      type: "parameters",
      parameters: {
        depth: safe.depth,
        carrierHz: safe.carrierHz,
        offsetHz: safe.offsetHz,
        modulationAmount: safe.modulationAmount,
        amountDivisor: safe.amountDivisor,
        nonlinearityHz: safe.nonlinearityHz,
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
