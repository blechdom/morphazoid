const DEFAULT_SAMPLE_RATE = 48_000;
const PARAMETER_SMOOTHING_SECONDS = 0.018;
const DEPTH_SMOOTHING_SECONDS = 0.009;
const MAX_INTERNAL_PHASE_INDEX = 64;
const TWO_PI = Math.PI * 2;

export const RECURSIVE_PM_LIMITS = Object.freeze({
  minDepth: 0,
  maxDepth: 10,
  minCarrierHz: 0.01,
  maxCarrierHz: 1_200,
  minModFrequencyHz: 0.01,
  maxModFrequencyHz: 400,
  minFrequencyDivisor: 0.01,
  maxFrequencyDivisor: 8,
  minPhaseIndex: 0,
  maxPhaseIndex: 20,
  minIndexDivisor: 0.01,
  maxIndexDivisor: 8,
  maxInternalPhaseIndex: MAX_INTERNAL_PHASE_INDEX,
});

const freezePreset = (preset) => Object.freeze({
  ...preset,
  settings: Object.freeze({ ...preset.settings }),
});

/**
 * The five exact factory settings from Morphisma's RecursivePMAudio demo.
 * The labels and descriptions are new; every synthesis value is unchanged.
 */
export const RECURSIVE_PM_PRESETS = Object.freeze([
  freezePreset({
    id: "low-orbit",
    label: "Low Orbit",
    description: "A 22 Hz carrier circles through three slow, gently shrinking phase turns.",
    settings: {
      depth: 3,
      carrierHz: 22,
      startModFrequencyHz: 0.16,
      frequencyDivisor: 1.4,
      startPhaseIndex: 3,
      indexDivisor: 1.46,
    },
  }),
  freezePreset({
    id: "chromium-swarm",
    label: "Chromium Swarm",
    description: "The original default: a sub-audio carrier folded by a fast 372.64 Hz phase orbit.",
    settings: {
      depth: 3,
      carrierHz: 7.29,
      startModFrequencyHz: 372.64,
      frequencyDivisor: 4.98,
      startPhaseIndex: 5.14,
      indexDivisor: 6.25,
    },
  }),
  freezePreset({
    id: "glass-rotor",
    label: "Glass Rotor",
    description: "Four widely divided operators turn a slow seed into a brittle rotating contour.",
    settings: {
      depth: 4,
      carrierHz: 1.82,
      startModFrequencyHz: 10.94,
      frequencyDivisor: 7.16,
      startPhaseIndex: 4.29,
      indexDivisor: 2.44,
    },
  }),
  freezePreset({
    id: "brass-fold",
    label: "Brass Fold",
    description: "A 182 Hz carrier and pi-like frequency division form a compact metallic voice.",
    settings: {
      depth: 4,
      carrierHz: 182,
      startModFrequencyHz: 12,
      frequencyDivisor: 3.14,
      startPhaseIndex: 1.5,
      indexDivisor: 2.67,
    },
  }),
  freezePreset({
    id: "slow-fracture",
    label: "Slow Fracture",
    description: "An expanding frequency series rises from 0.488 Hz while its phase index collapses.",
    settings: {
      depth: 4,
      carrierHz: 3,
      startModFrequencyHz: 0.488,
      frequencyDivisor: 0.34,
      startPhaseIndex: 7.18,
      indexDivisor: 5.26,
    },
  }),
]);

export const DEFAULT_RECURSIVE_PM_PRESET_ID = "chromium-swarm";

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

function settingValue(settings, modernName, legacyName, fallback) {
  return settings?.[modernName] ?? settings?.[legacyName] ?? fallback;
}

export function sanitizeRecursivePmSettings(
  settings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const maximumFrequencyHz = sampleRateLimit(sampleRate);
  return Object.freeze({
    depth: clamp(
      Math.round(finiteNumber(
        settingValue(settings, "depth", "steps", 3),
        3,
      )),
      RECURSIVE_PM_LIMITS.minDepth,
      RECURSIVE_PM_LIMITS.maxDepth,
    ),
    carrierHz: clamp(
      finiteNumber(
        settingValue(settings, "carrierHz", "carrierFreq", 7.29),
        7.29,
      ),
      RECURSIVE_PM_LIMITS.minCarrierHz,
      Math.min(RECURSIVE_PM_LIMITS.maxCarrierHz, maximumFrequencyHz),
    ),
    startModFrequencyHz: clamp(
      finiteNumber(
        settingValue(settings, "startModFrequencyHz", "startModFreq", 372.64),
        372.64,
      ),
      RECURSIVE_PM_LIMITS.minModFrequencyHz,
      Math.min(RECURSIVE_PM_LIMITS.maxModFrequencyHz, maximumFrequencyHz),
    ),
    frequencyDivisor: clamp(
      finiteNumber(
        settingValue(settings, "frequencyDivisor", "freqDiv", 4.98),
        4.98,
      ),
      RECURSIVE_PM_LIMITS.minFrequencyDivisor,
      RECURSIVE_PM_LIMITS.maxFrequencyDivisor,
    ),
    startPhaseIndex: clamp(
      finiteNumber(
        settingValue(settings, "startPhaseIndex", "indexOfMod", 5.14),
        5.14,
      ),
      RECURSIVE_PM_LIMITS.minPhaseIndex,
      RECURSIVE_PM_LIMITS.maxPhaseIndex,
    ),
    indexDivisor: clamp(
      finiteNumber(
        settingValue(settings, "indexDivisor", "indexDiv", 6.25),
        6.25,
      ),
      RECURSIVE_PM_LIMITS.minIndexDivisor,
      RECURSIVE_PM_LIMITS.maxIndexDivisor,
    ),
    maximumFrequencyHz,
  });
}

function normalizedOutputGain(settings, actualDepth) {
  const phasePressure = Math.log2(2 + settings.startPhaseIndex);
  const depthPressure = Math.sqrt(1 + actualDepth * 0.12);
  return clamp(0.52 / (phasePressure * 0.32 + depthPressure * 0.68), 0.24, 0.52);
}

/**
 * Unroll the Recursive PM expression into a bounded operator ledger.
 *
 * carrier = sin(phasor(carrierHz))
 * next    = sin(phasor(modFrequency) + previous * phaseIndex)
 *
 * Each turn divides modFrequency and phaseIndex by their independent divisors.
 * A turn at or above the sample-rate ceiling is omitted, matching the guard in
 * the original recursive expression while keeping custom settings click-safe.
 */
export function deriveRecursivePmStack(
  settings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const safe = sanitizeRecursivePmSettings(settings, { sampleRate });
  const operators = [{
    index: 0,
    turn: 0,
    kind: "carrier",
    sourceIndex: null,
    frequencyHz: safe.carrierHz,
    phaseIndex: 0,
    rawPhaseIndex: 0,
  }];

  let modFrequencyHz = safe.startModFrequencyHz;
  let rawPhaseIndex = safe.startPhaseIndex;
  let boundedByFrequency = false;
  let boundedByIndex = false;

  for (let turn = 1; turn <= safe.depth; turn += 1) {
    if (!Number.isFinite(modFrequencyHz)
      || modFrequencyHz >= safe.maximumFrequencyHz) {
      boundedByFrequency = true;
      break;
    }
    const phaseIndex = clamp(
      finiteNumber(rawPhaseIndex, MAX_INTERNAL_PHASE_INDEX),
      0,
      MAX_INTERNAL_PHASE_INDEX,
    );
    if (phaseIndex !== rawPhaseIndex) boundedByIndex = true;
    operators.push({
      index: operators.length,
      turn,
      kind: "phase-operator",
      sourceIndex: operators.length - 1,
      frequencyHz: modFrequencyHz,
      phaseIndex,
      rawPhaseIndex,
    });
    modFrequencyHz /= safe.frequencyDivisor;
    rawPhaseIndex /= safe.indexDivisor;
  }

  const actualDepth = operators.length - 1;
  return Object.freeze({
    settings: safe,
    operators: Object.freeze(operators.map((operator) => Object.freeze(operator))),
    requestedDepth: safe.depth,
    actualDepth,
    audibleIndex: actualDepth,
    boundedByFrequency,
    boundedByIndex,
    normalizedGain: normalizedOutputGain(safe, actualDepth),
  });
}

export function summarizeRecursivePmStack(stack) {
  const model = stack?.operators ? stack : deriveRecursivePmStack(stack);
  const suffix = model.actualDepth === model.requestedDepth ? "" : " · frequency bounded";
  return Object.freeze({
    requestedDepth: model.requestedDepth,
    actualDepth: model.actualDepth,
    operatorCount: model.operators.length,
    label: `${model.actualDepth} ${model.actualDepth === 1 ? "turn" : "turns"} · ${model.operators.length} operators${suffix}`,
  });
}

export function logarithmicRecursivePmValue(position, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.01));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safePosition = clamp(finiteNumber(position, 0), 0, 1);
  return safeMinimum * ((safeMaximum / safeMinimum) ** safePosition);
}

export function logarithmicRecursivePmPosition(value, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.01));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safeValue = clamp(finiteNumber(value, safeMinimum), safeMinimum, safeMaximum);
  if (safeMinimum === safeMaximum) return 0;
  return Math.log(safeValue / safeMinimum) / Math.log(safeMaximum / safeMinimum);
}

export function formatRecursivePmNumber(value, digits = 2) {
  return finiteNumber(value, 0)
    .toFixed(digits)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function formatRecursivePmFrequency(value) {
  const frequency = Math.max(0, finiteNumber(value, 0));
  if (frequency >= 1_000) {
    return `${formatRecursivePmNumber(frequency / 1_000, 2)} kHz`;
  }
  if (frequency >= 100) return `${formatRecursivePmNumber(frequency, 1)} Hz`;
  return `${formatRecursivePmNumber(frequency, 3)} Hz`;
}

function smoothAudioParam(param, value, context, timeConstant) {
  if (!param || !context) return;
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, timeConstant);
}

function configureCompressor(compressor) {
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
}

/**
 * Gesture-started Web Audio owner. The class is runtime-injectable so lifecycle
 * behavior can be verified without constructing a browser AudioContext.
 */
export class RecursivePmAudioEngine {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.worklet = null;
    this.normalizationGain = null;
    this.masterGain = null;
    this.analyser = null;
    this.waveform = null;
    this.nodes = [];
    this.stopping = false;
  }

  get running() {
    return Boolean(this.context) && !this.stopping;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  async start(settings, level = 0.58) {
    if (this.running) {
      if (this.context.state === "suspended") await this.context.resume();
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
      await context.audioWorklet.addModule(
        new URL("./recursive-pm.js", import.meta.url),
      );

      const worklet = new AudioWorkletNodeConstructor(
        context,
        "morphazoid-recursive-pm",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
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
      analyser.fftSize = 1_024;
      analyser.smoothingTimeConstant = 0.62;

      worklet.connect(normalizationGain);
      normalizationGain.connect(masterGain);
      masterGain.connect(compressor);
      compressor.connect(ceilingGain);
      ceilingGain.connect(analyser);
      analyser.connect(context.destination);

      this.worklet = worklet;
      this.normalizationGain = normalizationGain;
      this.masterGain = masterGain;
      this.analyser = analyser;
      this.waveform = new Uint8Array(analyser.fftSize);
      this.nodes = [
        worklet,
        normalizationGain,
        masterGain,
        compressor,
        ceilingGain,
        analyser,
      ];

      this.updateSettings(settings, { immediate: true });
      if (context.state === "suspended") await context.resume();
      this.setLevel(level, { immediate: true });
    } catch (error) {
      await this.stop({ immediate: true });
      throw error;
    }
  }

  updateSettings(settings, { immediate = false } = {}) {
    const stack = deriveRecursivePmStack(
      settings,
      { sampleRate: this.sampleRate },
    );
    if (!this.context || !this.worklet) return stack;

    this.worklet.port.postMessage({
      type: "settings",
      settings: {
        carrierHz: stack.settings.carrierHz,
        startModFrequencyHz: stack.settings.startModFrequencyHz,
        frequencyDivisor: stack.settings.frequencyDivisor,
        startPhaseIndex: stack.settings.startPhaseIndex,
        indexDivisor: stack.settings.indexDivisor,
        depth: stack.actualDepth,
        maximumFrequencyHz: stack.settings.maximumFrequencyHz,
      },
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
    if (!this.context || !this.masterGain) return;
    const safeLevel = clamp(finiteNumber(level, 0), 0, 1);
    smoothAudioParam(
      this.masterGain.gain,
      safeLevel,
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
    const nodes = [...this.nodes];

    if (this.masterGain) {
      const now = context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      if (immediate) this.masterGain.gain.setValueAtTime(0, now);
      else this.masterGain.gain.linearRampToValueAtTime(0, now + 0.025);
    }

    if (!immediate) {
      const delay = this.runtime.setTimeout?.bind(this.runtime)
        ?? globalThis.setTimeout;
      await new Promise((resolve) => delay(resolve, 32));
    }

    try {
      this.worklet?.port.postMessage({ type: "shutdown" });
    } catch {
      // The port can already be gone during page dismissal.
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Best-effort cleanup.
      }
    }
    if (context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Some browsers abandon close() while a page is being discarded.
      }
    }

    if (this.context === context) {
      this.context = null;
      this.worklet = null;
      this.normalizationGain = null;
      this.masterGain = null;
      this.analyser = null;
      this.waveform = null;
      this.nodes = [];
      this.stopping = false;
    }
  }
}

const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {
  constructor() {
    this.port = { onmessage: null };
  }
};

class RecursivePmProcessor extends ProcessorBase {
  constructor() {
    super();
    this.active = true;
    this.processorSampleRate = finiteNumber(globalThis.sampleRate, DEFAULT_SAMPLE_RATE);
    this.carrierPhase = 0;
    this.operatorPhases = new Float64Array(RECURSIVE_PM_LIMITS.maxDepth);
    this.signals = new Float64Array(RECURSIVE_PM_LIMITS.maxDepth + 1);
    this.current = {
      carrierHz: 7.29,
      startModFrequencyHz: 372.64,
      frequencyDivisor: 4.98,
      startPhaseIndex: 5.14,
      indexDivisor: 6.25,
      depth: 3,
      maximumFrequencyHz: sampleRateLimit(this.processorSampleRate),
    };
    this.target = { ...this.current };

    this.port.onmessage = ({ data }) => {
      if (data?.type === "shutdown") {
        this.active = false;
        return;
      }
      if (data?.type !== "settings") return;
      this.target = {
        ...this.target,
        ...data.settings,
      };
      if (data.immediate) this.current = { ...this.target };
    };
  }

  process(_inputs, outputs) {
    if (!this.active) return false;
    const channels = outputs[0] ?? [];
    const frameCount = channels[0]?.length ?? 128;
    const parameterCoefficient = 1 - Math.exp(
      -1 / (this.processorSampleRate * PARAMETER_SMOOTHING_SECONDS),
    );
    const depthCoefficient = 1 - Math.exp(
      -1 / (this.processorSampleRate * DEPTH_SMOOTHING_SECONDS),
    );
    const signals = this.signals;

    for (let frame = 0; frame < frameCount; frame += 1) {
      this.current.carrierHz += (
        this.target.carrierHz - this.current.carrierHz
      ) * parameterCoefficient;
      this.current.startModFrequencyHz += (
        this.target.startModFrequencyHz - this.current.startModFrequencyHz
      ) * parameterCoefficient;
      this.current.frequencyDivisor += (
        this.target.frequencyDivisor - this.current.frequencyDivisor
      ) * parameterCoefficient;
      this.current.startPhaseIndex += (
        this.target.startPhaseIndex - this.current.startPhaseIndex
      ) * parameterCoefficient;
      this.current.indexDivisor += (
        this.target.indexDivisor - this.current.indexDivisor
      ) * parameterCoefficient;
      this.current.maximumFrequencyHz += (
        this.target.maximumFrequencyHz - this.current.maximumFrequencyHz
      ) * parameterCoefficient;
      this.current.depth += (
        this.target.depth - this.current.depth
      ) * depthCoefficient;

      this.carrierPhase += this.current.carrierHz / this.processorSampleRate;
      this.carrierPhase -= Math.floor(this.carrierPhase);
      signals[0] = Math.sin(TWO_PI * this.carrierPhase);

      let modFrequencyHz = this.current.startModFrequencyHz;
      let phaseIndex = this.current.startPhaseIndex;
      let availableDepth = 0;
      for (
        let turn = 0;
        turn < RECURSIVE_PM_LIMITS.maxDepth;
        turn += 1
      ) {
        if (!Number.isFinite(modFrequencyHz)
          || modFrequencyHz >= this.current.maximumFrequencyHz) {
          break;
        }
        const safeFrequency = Math.max(0, modFrequencyHz);
        this.operatorPhases[turn] += safeFrequency / this.processorSampleRate;
        this.operatorPhases[turn] -= Math.floor(this.operatorPhases[turn]);
        const safeIndex = clamp(
          finiteNumber(phaseIndex, MAX_INTERNAL_PHASE_INDEX),
          0,
          MAX_INTERNAL_PHASE_INDEX,
        );
        const wrappedPhase = this.operatorPhases[turn]
          + signals[turn] * safeIndex;
        signals[turn + 1] = Math.sin(TWO_PI * wrappedPhase);
        availableDepth = turn + 1;
        modFrequencyHz /= Math.max(
          RECURSIVE_PM_LIMITS.minFrequencyDivisor,
          this.current.frequencyDivisor,
        );
        phaseIndex /= Math.max(
          RECURSIVE_PM_LIMITS.minIndexDivisor,
          this.current.indexDivisor,
        );
      }

      const smoothDepth = clamp(this.current.depth, 0, availableDepth);
      const lowerDepth = Math.floor(smoothDepth);
      const upperDepth = Math.min(availableDepth, lowerDepth + 1);
      const mix = smoothDepth - lowerDepth;
      const sample = signals[lowerDepth] * (1 - mix)
        + signals[upperDepth] * mix;
      for (const channel of channels) channel[frame] = sample;
    }
    return true;
  }
}

if (typeof globalThis.registerProcessor === "function") {
  globalThis.registerProcessor(
    "morphazoid-recursive-pm",
    RecursivePmProcessor,
  );
}
