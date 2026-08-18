import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const DEFAULT_SAMPLE_RATE = 48_000;
const PARAMETER_SMOOTHING_SECONDS = 0.018;
const DEPTH_SMOOTHING_SECONDS = 0.009;
const PITCH_BEND_DEZIPPER_SECONDS = 0.008;
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
    this.articulationGain = null;
    this.velocityGain = null;
    this.masterGain = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.waveform = null;
    this.nodes = [];
    this.stopping = false;
    this.playMode = "drone";
    this.performanceNotePitchRatio = 1;
    this.performancePitchBendSemitones = 0;
    this.performancePitchRatio = 1;
    this.hasPlayedMidiNote = false;
    this.gateActive = false;
    this.sustainReachedAt = -Infinity;
    this.currentSustainLevel = 0.72;
    this.outputLevel = 0.58;
    this.expression = 1;
  }

  get running() {
    return Boolean(this.context) && !this.stopping;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  async start(settings, level = 0.58) {
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
      const articulationGain = context.createGain();
      const velocityGain = context.createGain();
      const masterGain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      const ceilingGain = context.createGain();
      const analyser = context.createAnalyser();

      normalizationGain.gain.value = 0;
      articulationGain.gain.value = this.playMode === "midi" ? 0 : 1;
      velocityGain.gain.value = 1;
      masterGain.gain.value = 0;
      ceilingGain.gain.value = 0.82;
      configureCompressor(compressor);
      analyser.fftSize = 2_048;
      analyser.minDecibels = -90;
      analyser.maxDecibels = 0;
      analyser.smoothingTimeConstant = 0.45;

      worklet.connect(normalizationGain);
      normalizationGain.connect(articulationGain);
      articulationGain.connect(velocityGain);
      velocityGain.connect(masterGain);
      masterGain.connect(compressor);
      compressor.connect(ceilingGain);
      ceilingGain.connect(analyser);
      this.releaseAudioOutput = connectAudioOutput(context, analyser, { runtime: this.runtime });

      this.worklet = worklet;
      this.normalizationGain = normalizationGain;
      this.articulationGain = articulationGain;
      this.velocityGain = velocityGain;
      this.masterGain = masterGain;
      this.analyser = analyser;
      // Match Chaotic FM's 512-sample oscilloscope window independently from
      // the 2048-point FFT used by the live spectrum.
      this.waveform = new Uint8Array(512);
      this.nodes = [
        worklet,
        normalizationGain,
        articulationGain,
        velocityGain,
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
    const safeLevel = clamp(finiteNumber(level, 0), 0, 1);
    this.outputLevel = safeLevel;
    if (!this.context || !this.masterGain) return;
    smoothAudioParam(
      this.masterGain.gain,
      safeLevel * this.expression,
      this.context,
      immediate ? 0.001 : 0.012,
    );
  }

  setExpression(expression, { immediate = false } = {}) {
    this.expression = clamp(finiteNumber(expression, 1), 0, 1);
    this.setLevel(this.outputLevel, { immediate });
  }

  setPlayMode(mode, { immediate = false } = {}) {
    this.playMode = mode === "midi" ? "midi" : "drone";
    if (this.playMode === "drone") {
      this.hasPlayedMidiNote = false;
      this.gateActive = false;
      this.setPitchRatio(1, { immediate });
      this.setPitchBend(0, { immediate });
    }
    if (!this.context || !this.articulationGain) return;
    smoothAudioParam(
      this.articulationGain.gain,
      this.playMode === "midi" ? 0 : 1,
      this.context,
      immediate ? 0.001 : 0.008,
    );
    smoothAudioParam(
      this.velocityGain?.gain,
      1,
      this.context,
      immediate ? 0.001 : 0.008,
    );
  }

  setPitchRatio(
    pitchRatio,
    { glideSeconds = 0, immediate = false } = {},
  ) {
    this.performanceNotePitchRatio = clamp(
      finiteNumber(pitchRatio, 1),
      1 / 256,
      256,
    );
    this.performancePitchRatio = this.performanceNotePitchRatio
      * (2 ** (this.performancePitchBendSemitones / 12));
    if (!this.worklet) return;
    this.worklet.port.postMessage({
      type: "note-pitch",
      pitchRatio: this.performanceNotePitchRatio,
      glideSeconds: clamp(finiteNumber(glideSeconds, 0), 0, 2),
      immediate,
    });
  }

  setPitchBend(bendSemitones, { immediate = false } = {}) {
    this.performancePitchBendSemitones = clamp(
      finiteNumber(bendSemitones, 0),
      -24,
      24,
    );
    this.performancePitchRatio = this.performanceNotePitchRatio
      * (2 ** (this.performancePitchBendSemitones / 12));
    if (!this.worklet) return;
    this.worklet.port.postMessage({
      type: "pitch-bend",
      bendSemitones: this.performancePitchBendSemitones,
      dezipperSeconds: PITCH_BEND_DEZIPPER_SECONDS,
      immediate,
    });
  }

  noteOn(
    pitchRatio,
    velocityGain,
    {
      attackMs = 8,
      decayMs = 120,
      sustainLevel = 0.72,
      glideTimeMs = 0,
      glide = false,
      retrigger = true,
      bendSemitones = this.performancePitchBendSemitones,
    } = {},
  ) {
    const canGlide = glide && this.hasPlayedMidiNote && Boolean(this.worklet);
    this.setPitchRatio(pitchRatio, {
      glideSeconds: canGlide
        ? clamp(glideTimeMs, 0, 2_000, 0) / 1_000
        : 0,
    });
    this.setPitchBend(bendSemitones);
    if (this.worklet) this.hasPlayedMidiNote = true;
    this.currentSustainLevel = clamp(
      finiteNumber(sustainLevel, 0.72),
      0,
      1,
    );
    if (this.playMode !== "midi"
      || !this.context
      || !this.articulationGain
      || !this.velocityGain) return;
    smoothAudioParam(
      this.velocityGain.gain,
      clamp(finiteNumber(velocityGain, 0), 0, 1),
      this.context,
      0.008,
    );
    const shouldRetrigger = retrigger || !this.gateActive;
    if (!shouldRetrigger) return;
    const gain = this.articulationGain.gain;
    const now = this.context.currentTime;
    const attack = clamp(finiteNumber(attackMs, 8), 0, 5_000) / 1_000;
    const decay = clamp(finiteNumber(decayMs, 120), 0, 5_000) / 1_000;
    this.gateActive = true;
    this.sustainReachedAt = now + attack + decay;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    if (attack === 0) gain.setValueAtTime(1, now);
    else gain.linearRampToValueAtTime(1, now + attack);
    if (decay === 0) {
      gain.setValueAtTime(this.currentSustainLevel, now + attack);
    } else {
      gain.linearRampToValueAtTime(
        this.currentSustainLevel,
        this.sustainReachedAt,
      );
    }
  }

  setSustainLevel(sustainLevel) {
    this.currentSustainLevel = clamp(
      finiteNumber(sustainLevel, 0.72),
      0,
      1,
    );
    if (!this.gateActive
      || !this.context
      || !this.articulationGain
      || this.context.currentTime < this.sustainReachedAt) return;
    smoothAudioParam(
      this.articulationGain.gain,
      this.currentSustainLevel,
      this.context,
      0.008,
    );
  }

  noteOff(releaseMs = 180, { immediate = false } = {}) {
    this.gateActive = false;
    this.sustainReachedAt = -Infinity;
    if (!this.context || !this.articulationGain) return;
    const gain = this.articulationGain.gain;
    const now = this.context.currentTime;
    const release = immediate
      ? 0
      : clamp(finiteNumber(releaseMs, 180), 2, 10_000) / 1_000;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    if (release === 0) gain.setValueAtTime(0, now);
    else gain.linearRampToValueAtTime(0, now + release);
  }

  allSoundOff() {
    this.noteOff(2);
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
      if (immediate) this.masterGain.gain.setValueAtTime(0, now);
      else this.masterGain.gain.linearRampToValueAtTime(0, now + 0.025);
    }

    if (!immediate) {
      const delay = this.runtime.setTimeout?.bind(this.runtime)
        ?? globalThis.setTimeout;
      await new Promise((resolve) => delay(resolve, 32));
    }

    releaseAudioOutput?.();
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
      this.articulationGain = null;
      this.velocityGain = null;
      this.masterGain = null;
      this.analyser = null;
      this.waveform = null;
      this.nodes = [];
      this.stopping = false;
      this.gateActive = false;
      this.sustainReachedAt = -Infinity;
      this.hasPlayedMidiNote = false;
    }
  }
}

const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {
  constructor() {
    this.port = { onmessage: null };
  }
};

export class RecursivePmProcessor extends ProcessorBase {
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
    this.currentNoteSemitones = 0;
    this.targetNoteSemitones = 0;
    this.noteGlideStartSemitones = 0;
    this.noteGlideTotalSamples = 0;
    this.noteGlideRemainingSamples = 0;
    this.currentBendSemitones = 0;
    this.targetBendSemitones = 0;
    this.bendStartSemitones = 0;
    this.bendDezipperTotalSamples = 0;
    this.bendDezipperRemainingSamples = 0;
    this.currentPitchRatio = 1;

    this.port.onmessage = ({ data }) => {
      if (data?.type === "shutdown") {
        this.active = false;
        return;
      }
      if (data?.type === "note-pitch" || data?.type === "pitch-ratio") {
        const pitchRatio = clamp(
          finiteNumber(data.pitchRatio, 1),
          1 / 256,
          256,
        );
        this.noteGlideStartSemitones = this.currentNoteSemitones;
        this.targetNoteSemitones = 12 * Math.log2(pitchRatio);
        const glideSeconds = clamp(
          finiteNumber(data.glideSeconds, 0),
          0,
          2,
        );
        const glideSamples = data.immediate
          ? 0
          : Math.round(glideSeconds * this.processorSampleRate);
        this.noteGlideTotalSamples = glideSamples;
        this.noteGlideRemainingSamples = glideSamples;
        if (glideSamples === 0) {
          this.currentNoteSemitones = this.targetNoteSemitones;
        }
        return;
      }
      if (data?.type === "pitch-bend") {
        this.bendStartSemitones = this.currentBendSemitones;
        this.targetBendSemitones = clamp(
          finiteNumber(data.bendSemitones, this.targetBendSemitones),
          -24,
          24,
        );
        const dezipperSeconds = clamp(
          finiteNumber(
            data.dezipperSeconds,
            PITCH_BEND_DEZIPPER_SECONDS,
          ),
          0,
          0.1,
        );
        const dezipperSamples = data.immediate
          ? 0
          : Math.max(1, Math.round(
            dezipperSeconds * this.processorSampleRate,
          ));
        this.bendDezipperTotalSamples = dezipperSamples;
        this.bendDezipperRemainingSamples = dezipperSamples;
        if (dezipperSamples === 0) {
          this.currentBendSemitones = this.targetBendSemitones;
        }
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
      if (this.noteGlideRemainingSamples > 0) {
        const progress = (
          this.noteGlideTotalSamples - this.noteGlideRemainingSamples + 1
        ) / this.noteGlideTotalSamples;
        this.currentNoteSemitones = this.noteGlideStartSemitones
          + (this.targetNoteSemitones - this.noteGlideStartSemitones)
            * progress;
        this.noteGlideRemainingSamples -= 1;
      } else {
        this.currentNoteSemitones = this.targetNoteSemitones;
      }
      if (this.bendDezipperRemainingSamples > 0) {
        const progress = (
          this.bendDezipperTotalSamples
            - this.bendDezipperRemainingSamples
            + 1
        ) / this.bendDezipperTotalSamples;
        this.currentBendSemitones = this.bendStartSemitones
          + (this.targetBendSemitones - this.bendStartSemitones) * progress;
        this.bendDezipperRemainingSamples -= 1;
      } else {
        this.currentBendSemitones = this.targetBendSemitones;
      }
      this.currentPitchRatio = 2 ** ((
        this.currentNoteSemitones + this.currentBendSemitones
      ) / 12);

      const scaledCarrierHz = clamp(
        this.current.carrierHz * this.currentPitchRatio,
        RECURSIVE_PM_LIMITS.minCarrierHz,
        this.current.maximumFrequencyHz,
      );
      this.carrierPhase += scaledCarrierHz / this.processorSampleRate;
      this.carrierPhase -= Math.floor(this.carrierPhase);
      signals[0] = Math.sin(TWO_PI * this.carrierPhase);

      let modFrequencyHz = this.current.startModFrequencyHz
        * this.currentPitchRatio;
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
