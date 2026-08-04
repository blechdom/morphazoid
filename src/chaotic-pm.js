const PROCESSOR_NAME = "morphazoid-chaotic-pm";
const DEFAULT_SAMPLE_RATE = 48_000;
const PARAMETER_SMOOTHING_SECONDS = 0.018;
const DEPTH_SMOOTHING_SECONDS = 0.009;
const MAX_AUDIBLE_FREQUENCY = 20_000;
const MAX_SHAPER_INPUT = 64;
const TWO_PI = Math.PI * 2;

// The legacy transfer is asymmetric and can carry a substantial DC offset.
// Once the final operators are in the audio band, 18 Hz removes that bias
// without materially attenuating the playable bank.
export const CHAOTIC_PM_DC_BLOCKER_HZ = 18;

export const CHAOTIC_PM_LIMITS = Object.freeze({
  minDepth: 0,
  maxDepth: 10,
  minCarrierHz: 0.001,
  maxCarrierHz: 1_200,
  minModFrequencyHz: 0.001,
  maxModFrequencyHz: 400,
  minFrequencyDivisor: 0.001,
  maxFrequencyDivisor: 32,
  minPhaseIndex: 0,
  maxPhaseIndex: 64,
  minIndexDivisor: 0.001,
  maxIndexDivisor: 32,
  minNonlinearity: 0,
  maxNonlinearity: 1,
  maxInternalPhaseIndex: 64,
});

export const CHAOTIC_PM_PARAMETER_IDS = Object.freeze({
  depth: "synthesis.depth",
  carrierHz: "synthesis.carrierHz",
  startModFrequencyHz: "synthesis.startModFrequencyHz",
  frequencyDivisor: "synthesis.frequencyDivisor",
  startPhaseIndex: "synthesis.startPhaseIndex",
  indexDivisor: "synthesis.indexDivisor",
  nonlinearity: "synthesis.nonlinearity",
  output: "output.level",
});

const freezePreset = (preset) => Object.freeze({
  ...preset,
  settings: Object.freeze({ ...preset.settings }),
});

/**
 * The eight exact factory tuples recovered from Morphisma's unfinished
 * Chaotic PM experiment. Most terminate below audio rate; they remain public
 * reference material instead of masquerading as playable presets.
 * The legacy page did not name them, so labels and descriptions are new.
 */
export const CHAOTIC_PM_LEGACY_PRESETS = Object.freeze([
  freezePreset({
    id: "subzero-thread",
    label: "Subzero Thread",
    description: "Two almost-static phase turns leave a faint, slowly opening nonlinear thread.",
    settings: {
      depth: 2,
      carrierHz: 0.06,
      startModFrequencyHz: 0.035,
      frequencyDivisor: 22,
      startPhaseIndex: 0.625,
      indexDivisor: 6,
      nonlinearity: 0.34,
    },
  }),
  freezePreset({
    id: "forty-fold",
    label: "Forty Fold",
    description: "One 40 Hz phase shaper folds a slow carrier with a wide 6.66-cycle index.",
    settings: {
      depth: 1,
      carrierHz: 0.666,
      startModFrequencyHz: 40,
      frequencyDivisor: 10,
      startPhaseIndex: 6.66,
      indexDivisor: 6.5,
      nonlinearity: 0.512,
    },
  }),
  freezePreset({
    id: "still-glass",
    label: "Still Glass",
    description: "Four matched millihertz phasors make a nearly frozen, glassy phase contour.",
    settings: {
      depth: 4,
      carrierHz: 0.002,
      startModFrequencyHz: 0.002,
      frequencyDivisor: 1,
      startPhaseIndex: 0.365,
      indexDivisor: 5.75,
      nonlinearity: 0.246,
    },
  }),
  freezePreset({
    id: "runaway-stair",
    label: "Runaway Stair",
    description: "A divisor below one rockets the phase rate upward until the safety ceiling stops it.",
    settings: {
      depth: 8,
      carrierHz: 0.006,
      startModFrequencyHz: 0.05,
      frequencyDivisor: 0.001,
      startPhaseIndex: 0.625,
      indexDivisor: 4.75,
      nonlinearity: 0.666,
    },
  }),
  freezePreset({
    id: "braided-orbit",
    label: "Braided Orbit",
    description: "Five equal-rate turns braid a 1.41 Hz seed through shrinking phase indices.",
    settings: {
      depth: 5,
      carrierHz: 1.41,
      startModFrequencyHz: 1.14,
      frequencyDivisor: 1,
      startPhaseIndex: 0.864,
      indexDivisor: 6.75,
      nonlinearity: 0.41,
    },
  }),
  freezePreset({
    id: "low-ember",
    label: "Low Ember",
    description: "A strong phase warp smolders through four descending sub-audio turns.",
    settings: {
      depth: 4,
      carrierHz: 3,
      startModFrequencyHz: 0.08,
      frequencyDivisor: 2.6,
      startPhaseIndex: 0.5,
      indexDivisor: 7,
      nonlinearity: 0.9,
    },
  }),
  freezePreset({
    id: "kilohertz-veil",
    label: "Kilohertz Veil",
    description: "A 1 kHz carrier hangs above four extremely slow, high-index phase turns.",
    settings: {
      depth: 4,
      carrierHz: 1_000,
      startModFrequencyHz: 0.02,
      frequencyDivisor: 17.85,
      startPhaseIndex: 13.5,
      indexDivisor: 6.75,
      nonlinearity: 0.13,
    },
  }),
  freezePreset({
    id: "chrome-cascade",
    label: "Chrome Cascade",
    description: "A 400 Hz entry and the original 64-cycle index collapse into a bright cascade.",
    settings: {
      depth: 6,
      carrierHz: 0.144,
      startModFrequencyHz: 400,
      frequencyDivisor: 10.247,
      startPhaseIndex: 64,
      indexDivisor: 1.75,
      nonlinearity: 0.279,
    },
  }),
]);

/**
 * Playable calibrations of the recovered WIP bank. The recursion and transfer
 * are unchanged: these values move every selected final turn to 40–390 Hz and
 * balance `nonlinearity * frequency²` so tanh does not collapse into a nearly
 * constant result. IDs stay stable for the existing UI and saved links.
 */
export const CHAOTIC_PM_PRESETS = Object.freeze([
  freezePreset({
    id: "subzero-thread",
    label: "Subzero Thread",
    description: "A 60 Hz seed passes through 330 and 110 Hz turns, leaving a taut nonlinear thread.",
    settings: {
      depth: 2,
      carrierHz: 60,
      startModFrequencyHz: 330,
      frequencyDivisor: 3,
      startPhaseIndex: 0.625,
      indexDivisor: 6,
      nonlinearity: 0.004,
    },
  }),
  freezePreset({
    id: "forty-fold",
    label: "Forty Fold",
    description: "A 40 Hz phase shaper folds a 66.6 Hz carrier through a wide 6.66-cycle index.",
    settings: {
      depth: 1,
      carrierHz: 66.6,
      startModFrequencyHz: 40,
      frequencyDivisor: 10,
      startPhaseIndex: 6.66,
      indexDivisor: 6.5,
      nonlinearity: 0.016,
    },
  }),
  freezePreset({
    id: "still-glass",
    label: "Still Glass",
    description: "Four matched 180 Hz turns polish a 120 Hz seed into a steady glassy contour.",
    settings: {
      depth: 4,
      carrierHz: 120,
      startModFrequencyHz: 180,
      frequencyDivisor: 1,
      startPhaseIndex: 0.365,
      indexDivisor: 5.75,
      nonlinearity: 0.001,
    },
  }),
  freezePreset({
    id: "runaway-stair",
    label: "Runaway Stair",
    description: "Eight expanding turns climb from 52 Hz to 389.6 Hz while the phase index holds steady.",
    settings: {
      depth: 8,
      carrierHz: 52,
      startModFrequencyHz: 52,
      frequencyDivisor: 0.75,
      startPhaseIndex: 0.625,
      indexDivisor: 1,
      nonlinearity: 0.001,
    },
  }),
  freezePreset({
    id: "braided-orbit",
    label: "Braided Orbit",
    description: "Five equal 114 Hz turns braid a 141 Hz seed through rapidly shrinking indices.",
    settings: {
      depth: 5,
      carrierHz: 141,
      startModFrequencyHz: 114,
      frequencyDivisor: 1,
      startPhaseIndex: 0.864,
      indexDivisor: 6.75,
      nonlinearity: 0.001,
    },
  }),
  freezePreset({
    id: "low-ember",
    label: "Low Ember",
    description: "Four descending turns fall from 320 Hz to a warm 40 Hz terminal ember.",
    settings: {
      depth: 4,
      carrierHz: 96,
      startModFrequencyHz: 320,
      frequencyDivisor: 2,
      startPhaseIndex: 0.5,
      indexDivisor: 7,
      nonlinearity: 0.004,
    },
  }),
  freezePreset({
    id: "kilohertz-veil",
    label: "Kilohertz Veil",
    description: "A 1 kHz seed hangs above four descending turns that resolve at 106.7 Hz.",
    settings: {
      depth: 4,
      carrierHz: 1_000,
      startModFrequencyHz: 360,
      frequencyDivisor: 1.5,
      startPhaseIndex: 13.5,
      indexDivisor: 6.75,
      nonlinearity: 0.003,
    },
  }),
  freezePreset({
    id: "chrome-cascade",
    label: "Chrome Cascade",
    description: "Six turns descend from 400 Hz to 131.1 Hz with a bright but bounded phase cascade.",
    settings: {
      depth: 6,
      carrierHz: 144,
      startModFrequencyHz: 400,
      frequencyDivisor: 1.25,
      startPhaseIndex: 8,
      indexDivisor: 1.5,
      nonlinearity: 0.016,
    },
  }),
]);

// The legacy page initially displayed tuple two, then accidentally replaced it
// with the near-DC first tuple when Play was pressed. Keep the repaired version
// of tuple two as the default and expose every exact source tuple above.
export const DEFAULT_CHAOTIC_PM_PRESET_ID = "forty-fold";
export const CHAOTIC_PM_DEFAULTS = Object.freeze({
  ...CHAOTIC_PM_PRESETS[1].settings,
  output: 0.58,
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

function sampleRateLimit(sampleRate) {
  const safeSampleRate = clamp(
    sampleRate,
    8_000,
    192_000,
    DEFAULT_SAMPLE_RATE,
  );
  return Math.min(MAX_AUDIBLE_FREQUENCY, safeSampleRate * 0.45);
}

function settingValue(settings, modernName, legacyName, fallback) {
  return settings?.[modernName] ?? settings?.[legacyName] ?? fallback;
}

/**
 * Bound UI, preset, and legacy values before they enter the render thread.
 * The original `filter` parameter is a tanh phase-warp coefficient; there is
 * no filter in the synthesis expression, so its modern name is nonlinearity.
 */
export function sanitizeChaoticPmParams(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const maximumFrequencyHz = sampleRateLimit(sampleRate);
  return Object.freeze({
    depth: Math.round(clamp(
      settingValue(params, "depth", "steps", CHAOTIC_PM_DEFAULTS.depth),
      CHAOTIC_PM_LIMITS.minDepth,
      CHAOTIC_PM_LIMITS.maxDepth,
      CHAOTIC_PM_DEFAULTS.depth,
    )),
    carrierHz: clamp(
      settingValue(
        params,
        "carrierHz",
        "carrierFreq",
        CHAOTIC_PM_DEFAULTS.carrierHz,
      ),
      CHAOTIC_PM_LIMITS.minCarrierHz,
      Math.min(CHAOTIC_PM_LIMITS.maxCarrierHz, maximumFrequencyHz),
      CHAOTIC_PM_DEFAULTS.carrierHz,
    ),
    startModFrequencyHz: clamp(
      settingValue(
        params,
        "startModFrequencyHz",
        "startModFreq",
        CHAOTIC_PM_DEFAULTS.startModFrequencyHz,
      ),
      CHAOTIC_PM_LIMITS.minModFrequencyHz,
      Math.min(CHAOTIC_PM_LIMITS.maxModFrequencyHz, maximumFrequencyHz),
      CHAOTIC_PM_DEFAULTS.startModFrequencyHz,
    ),
    frequencyDivisor: clamp(
      settingValue(
        params,
        "frequencyDivisor",
        "freqDiv",
        CHAOTIC_PM_DEFAULTS.frequencyDivisor,
      ),
      CHAOTIC_PM_LIMITS.minFrequencyDivisor,
      CHAOTIC_PM_LIMITS.maxFrequencyDivisor,
      CHAOTIC_PM_DEFAULTS.frequencyDivisor,
    ),
    startPhaseIndex: clamp(
      settingValue(
        params,
        "startPhaseIndex",
        "indexOfMod",
        CHAOTIC_PM_DEFAULTS.startPhaseIndex,
      ),
      CHAOTIC_PM_LIMITS.minPhaseIndex,
      CHAOTIC_PM_LIMITS.maxPhaseIndex,
      CHAOTIC_PM_DEFAULTS.startPhaseIndex,
    ),
    indexDivisor: clamp(
      settingValue(
        params,
        "indexDivisor",
        "indexDiv",
        CHAOTIC_PM_DEFAULTS.indexDivisor,
      ),
      CHAOTIC_PM_LIMITS.minIndexDivisor,
      CHAOTIC_PM_LIMITS.maxIndexDivisor,
      CHAOTIC_PM_DEFAULTS.indexDivisor,
    ),
    nonlinearity: clamp(
      settingValue(
        params,
        "nonlinearity",
        "filter",
        CHAOTIC_PM_DEFAULTS.nonlinearity,
      ),
      CHAOTIC_PM_LIMITS.minNonlinearity,
      CHAOTIC_PM_LIMITS.maxNonlinearity,
      CHAOTIC_PM_DEFAULTS.nonlinearity,
    ),
    maximumFrequencyHz,
  });
}

function normalizedOutputGain(settings, actualDepth) {
  const gain = 1.2 - Math.sqrt(settings.nonlinearity);
  const depthPressure = Math.sqrt(1 + actualDepth * 0.14);
  const discontinuityPressure = 1 + settings.nonlinearity * 0.28;
  return clamp(
    0.52 / (Math.max(0.25, gain) * 0.28 + depthPressure * discontinuityPressure * 0.72),
    0.24,
    0.52,
    0.42,
  );
}

/**
 * Unroll the original nested graph without changing its unusual transfer:
 *
 *   carrier = sin(TAU * carrierPhasor)
 *   phase[n] = (operatorPhasor[n] + previous * phaseIndex[n]) % 1
 *   drive[n] = nonlinearity * operatorFrequency[n]^2
 *   next = sin(TAU * (1.2 - sqrt(nonlinearity))
 *                    * tanh(phase[n] * drive[n]))
 *
 * Frequency and phase index are divided independently after every turn.
 */
export function deriveChaoticPmStack(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const settings = sanitizeChaoticPmParams(params, { sampleRate });
  const operators = [{
    index: 0,
    turn: 0,
    kind: "carrier",
    sourceIndex: null,
    frequencyHz: settings.carrierHz,
    phaseIndex: 0,
    rawPhaseIndex: 0,
    nonlinearity: 0,
    drive: 0,
    gain: 1,
  }];
  let frequencyHz = settings.startModFrequencyHz;
  let rawPhaseIndex = settings.startPhaseIndex;
  let boundedByFrequency = false;
  let boundedByIndex = false;
  const gain = 1.2 - Math.sqrt(settings.nonlinearity);

  for (let turn = 1; turn <= settings.depth; turn += 1) {
    if (!Number.isFinite(frequencyHz)
      || frequencyHz >= settings.maximumFrequencyHz) {
      boundedByFrequency = true;
      break;
    }
    const phaseIndex = clamp(
      rawPhaseIndex,
      0,
      CHAOTIC_PM_LIMITS.maxInternalPhaseIndex,
      CHAOTIC_PM_LIMITS.maxInternalPhaseIndex,
    );
    if (phaseIndex !== rawPhaseIndex) boundedByIndex = true;
    operators.push({
      index: operators.length,
      turn,
      kind: "chaotic-phase-operator",
      sourceIndex: operators.length - 1,
      frequencyHz,
      phaseIndex,
      rawPhaseIndex,
      nonlinearity: settings.nonlinearity,
      drive: settings.nonlinearity * frequencyHz * frequencyHz,
      gain,
    });
    frequencyHz /= settings.frequencyDivisor;
    rawPhaseIndex /= settings.indexDivisor;
  }

  const frozenOperators = operators.map((operator) => Object.freeze(operator));
  const actualDepth = frozenOperators.length - 1;
  return Object.freeze({
    settings,
    operators: Object.freeze(frozenOperators),
    requestedDepth: settings.depth,
    actualDepth,
    audibleIndex: actualDepth,
    boundedByFrequency,
    boundedByIndex,
    normalizedGain: normalizedOutputGain(settings, actualDepth),
  });
}

export function summarizeChaoticPmStack(stack) {
  const model = stack?.operators ? stack : deriveChaoticPmStack(stack);
  const suffix = model.actualDepth === model.requestedDepth
    ? ""
    : " · frequency bounded";
  return Object.freeze({
    requestedDepth: model.requestedDepth,
    actualDepth: model.actualDepth,
    operatorCount: model.operators.length,
    label: `${model.actualDepth} ${model.actualDepth === 1 ? "turn" : "turns"}`
      + ` · ${model.operators.length} operators${suffix}`,
  });
}

/**
 * Evaluate one exact legacy turn. JavaScript remainder semantics are
 * intentional: negative phase modulation stays negative instead of wrapping
 * into [0, 1), which changes the asymmetric tanh result.
 */
export function chaoticPmTurnSample(
  previousSignal,
  basePhase,
  modFrequencyHz,
  phaseIndex,
  nonlinearity,
) {
  const previous = clamp(previousSignal, -1, 1, 0);
  const phase = finiteNumber(basePhase, 0);
  const frequency = clamp(
    modFrequencyHz,
    0,
    MAX_AUDIBLE_FREQUENCY,
    0,
  );
  const index = clamp(
    phaseIndex,
    0,
    CHAOTIC_PM_LIMITS.maxInternalPhaseIndex,
    0,
  );
  const warp = clamp(
    nonlinearity,
    CHAOTIC_PM_LIMITS.minNonlinearity,
    CHAOTIC_PM_LIMITS.maxNonlinearity,
    0,
  );
  const wrappedPhase = (phase + previous * index) % 1;
  const drive = warp * frequency * frequency;
  const shaperInput = clamp(
    wrappedPhase * drive,
    -MAX_SHAPER_INPUT,
    MAX_SHAPER_INPUT,
    0,
  );
  const gain = 1.2 - Math.sqrt(warp);
  const sample = Math.sin(TWO_PI * Math.tanh(shaperInput) * gain);
  return Number.isFinite(sample) ? sample : 0;
}

export function logarithmicChaoticPmValue(position, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.001));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safePosition = clamp(position, 0, 1, 0);
  return safeMinimum * ((safeMaximum / safeMinimum) ** safePosition);
}

export function logarithmicChaoticPmPosition(value, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.001));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safeValue = clamp(value, safeMinimum, safeMaximum, safeMinimum);
  if (safeMinimum === safeMaximum) return 0;
  return Math.log(safeValue / safeMinimum)
    / Math.log(safeMaximum / safeMinimum);
}

export function formatChaoticPmNumber(value, digits = 3) {
  return finiteNumber(value, 0)
    .toFixed(digits)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function formatChaoticPmFrequency(value) {
  const frequency = Math.max(0, finiteNumber(value, 0));
  if (frequency >= 1_000) {
    return `${formatChaoticPmNumber(frequency / 1_000, 2)} kHz`;
  }
  if (frequency >= 100) return `${formatChaoticPmNumber(frequency, 1)} Hz`;
  if (frequency >= 10) return `${formatChaoticPmNumber(frequency, 2)} Hz`;
  return `${formatChaoticPmNumber(frequency, 4)} Hz`;
}

export function createChaoticPmSoftCeilingCurve(
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

function smoothAudioParam(param, value, context, timeConstant) {
  if (!param || !context) return;
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, timeConstant);
}

function configureCompressor(compressor) {
  compressor.threshold.value = -16;
  compressor.knee.value = 12;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.16;
}

/**
 * Lazy Web Audio owner. Construction is inert; the user gesture that calls
 * start() creates the context and its one zero-allocation AudioWorklet.
 */
export class ChaoticPmAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.worklet = null;
    this.node = null;
    this.highpass = null;
    this.normalizationGain = null;
    this.compressor = null;
    this.ceiling = null;
    this.masterGain = null;
    this.analyser = null;
    this.waveform = null;
    this.nodes = [];
    this.stopping = false;
    this.startPromise = null;
    this.pendingSettings = { ...CHAOTIC_PM_DEFAULTS };
    this.pendingLevel = CHAOTIC_PM_DEFAULTS.output;
  }

  get running() {
    return Boolean(
      this.context
      && this.context.state !== "closed"
      && this.worklet
      && !this.stopping,
    );
  }

  get sampleRate() {
    return this.context?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  async start(settings, level = CHAOTIC_PM_DEFAULTS.output) {
    if (this.context?.state === "closed") this.clearGraphReferences();
    this.updateSettings(settings);
    this.setLevel(level);
    if (this.running) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.initialize();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async initialize() {
    const AudioContextConstructor = this.runtime.AudioContext
      || this.runtime.webkitAudioContext;
    const AudioWorkletNodeConstructor = this.runtime.AudioWorkletNode
      || globalThis.AudioWorkletNode;
    if (!AudioContextConstructor || !AudioWorkletNodeConstructor) {
      throw new Error("AudioWorklet is not available in this browser.");
    }

    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.context = context;
    this.stopping = false;
    try {
      if (!context.audioWorklet) {
        throw new Error("AudioWorklet is not available in this browser.");
      }
      await context.audioWorklet.addModule(
        new URL("./chaotic-pm.js", import.meta.url),
      );
      if (
        this.context !== context
        || this.stopping
        || context.state === "closed"
      ) {
        throw new Error("Audio initialization was cancelled.");
      }
      const worklet = new AudioWorkletNodeConstructor(
        context,
        PROCESSOR_NAME,
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        },
      );
      const highpass = context.createBiquadFilter();
      const normalizationGain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      const ceiling = context.createWaveShaper();
      const masterGain = context.createGain();
      const analyser = context.createAnalyser();

      highpass.type = "highpass";
      highpass.frequency.value = CHAOTIC_PM_DC_BLOCKER_HZ;
      highpass.Q.value = 0.707;
      normalizationGain.gain.value = 0;
      masterGain.gain.value = 0;
      configureCompressor(compressor);
      ceiling.curve = createChaoticPmSoftCeilingCurve();
      ceiling.oversample = "2x";
      analyser.fftSize = 2_048;
      analyser.minDecibels = -90;
      analyser.maxDecibels = 0;
      analyser.smoothingTimeConstant = 0.5;

      worklet
        .connect(highpass)
        .connect(normalizationGain)
        .connect(compressor)
        .connect(ceiling)
        .connect(masterGain)
        .connect(analyser)
        .connect(context.destination);

      this.worklet = worklet;
      this.node = worklet;
      this.highpass = highpass;
      this.normalizationGain = normalizationGain;
      this.compressor = compressor;
      this.ceiling = ceiling;
      this.masterGain = masterGain;
      this.analyser = analyser;
      this.waveform = new Uint8Array(analyser.fftSize);
      this.nodes = [
        worklet,
        highpass,
        normalizationGain,
        compressor,
        ceiling,
        masterGain,
        analyser,
      ];

      // These are the latest values, including updates that arrived while the
      // worklet module was loading.
      this.updateSettings(this.pendingSettings, { immediate: true });
      if (this.context !== context || this.stopping) {
        throw new Error("Audio initialization was cancelled.");
      }
      if (context.state === "suspended") await context.resume();
      if (this.context !== context || this.stopping || context.state === "closed") {
        throw new Error("Audio initialization was cancelled.");
      }
      this.setLevel(this.pendingLevel, { immediate: true });
    } catch (error) {
      await this.stop({ immediate: true });
      throw error;
    }
  }

  updateSettings(settings, { immediate = false } = {}) {
    const stack = deriveChaoticPmStack(settings, { sampleRate: this.sampleRate });
    this.pendingSettings = {
      depth: stack.settings.depth,
      carrierHz: stack.settings.carrierHz,
      startModFrequencyHz: stack.settings.startModFrequencyHz,
      frequencyDivisor: stack.settings.frequencyDivisor,
      startPhaseIndex: stack.settings.startPhaseIndex,
      indexDivisor: stack.settings.indexDivisor,
      nonlinearity: stack.settings.nonlinearity,
    };
    if (!this.context || this.context.state === "closed" || !this.worklet) {
      return stack;
    }
    this.worklet.port.postMessage({
      type: "settings",
      settings: {
        carrierHz: stack.settings.carrierHz,
        startModFrequencyHz: stack.settings.startModFrequencyHz,
        frequencyDivisor: stack.settings.frequencyDivisor,
        startPhaseIndex: stack.settings.startPhaseIndex,
        indexDivisor: stack.settings.indexDivisor,
        nonlinearity: stack.settings.nonlinearity,
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
    this.pendingLevel = clamp(
      level,
      0,
      0.82,
      CHAOTIC_PM_DEFAULTS.output,
    );
    if (!this.context || this.context.state === "closed" || !this.masterGain) {
      return;
    }
    smoothAudioParam(
      this.masterGain.gain,
      this.pendingLevel,
      this.context,
      immediate ? 0.001 : 0.012,
    );
  }

  readWaveform() {
    if (!this.running || !this.analyser || !this.waveform) return null;
    this.analyser.getByteTimeDomainData(this.waveform);
    return this.waveform;
  }

  clearGraphReferences() {
    for (const audioNode of this.nodes) {
      try {
        audioNode.disconnect();
      } catch {
        // A browser may already have detached a node from a closed context.
      }
    }
    this.context = null;
    this.worklet = null;
    this.node = null;
    this.highpass = null;
    this.normalizationGain = null;
    this.compressor = null;
    this.ceiling = null;
    this.masterGain = null;
    this.analyser = null;
    this.waveform = null;
    this.nodes = [];
    this.stopping = false;
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
      // The message port may already be gone during page dismissal.
    }
    for (const audioNode of nodes) {
      try {
        audioNode.disconnect();
      } catch {
        // Best-effort cleanup during navigation.
      }
    }
    if (context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Some browsers abandon close() while discarding the page.
      }
    }
    if (this.context === context) {
      this.clearGraphReferences();
    }
  }
}

const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {
  constructor() {
    this.port = { onmessage: null };
  }
};

class ChaoticPmProcessor extends ProcessorBase {
  constructor() {
    super();
    const defaults = sanitizeChaoticPmParams();
    this.active = true;
    this.processorSampleRate = finiteNumber(globalThis.sampleRate, DEFAULT_SAMPLE_RATE);
    this.carrierPhase = 0;
    this.operatorPhases = new Float64Array(CHAOTIC_PM_LIMITS.maxDepth);
    this.signals = new Float64Array(CHAOTIC_PM_LIMITS.maxDepth + 1);
    this.depthGains = new Float64Array(CHAOTIC_PM_LIMITS.maxDepth + 1);
    this.current = {
      carrierHz: defaults.carrierHz,
      startModFrequencyHz: defaults.startModFrequencyHz,
      frequencyDivisor: defaults.frequencyDivisor,
      startPhaseIndex: defaults.startPhaseIndex,
      indexDivisor: defaults.indexDivisor,
      nonlinearity: defaults.nonlinearity,
      depth: defaults.depth,
      maximumFrequencyHz: sampleRateLimit(this.processorSampleRate),
    };
    this.target = { ...this.current };
    this.depthGains[defaults.depth] = 1;

    this.port.onmessage = ({ data }) => {
      if (data?.type === "shutdown") {
        this.active = false;
        return;
      }
      if (data?.type !== "settings") return;
      const settings = data.settings;
      this.target.carrierHz = clamp(
        settings?.carrierHz,
        CHAOTIC_PM_LIMITS.minCarrierHz,
        CHAOTIC_PM_LIMITS.maxCarrierHz,
        this.target.carrierHz,
      );
      this.target.startModFrequencyHz = clamp(
        settings?.startModFrequencyHz,
        CHAOTIC_PM_LIMITS.minModFrequencyHz,
        CHAOTIC_PM_LIMITS.maxModFrequencyHz,
        this.target.startModFrequencyHz,
      );
      this.target.frequencyDivisor = clamp(
        settings?.frequencyDivisor,
        CHAOTIC_PM_LIMITS.minFrequencyDivisor,
        CHAOTIC_PM_LIMITS.maxFrequencyDivisor,
        this.target.frequencyDivisor,
      );
      this.target.startPhaseIndex = clamp(
        settings?.startPhaseIndex,
        CHAOTIC_PM_LIMITS.minPhaseIndex,
        CHAOTIC_PM_LIMITS.maxPhaseIndex,
        this.target.startPhaseIndex,
      );
      this.target.indexDivisor = clamp(
        settings?.indexDivisor,
        CHAOTIC_PM_LIMITS.minIndexDivisor,
        CHAOTIC_PM_LIMITS.maxIndexDivisor,
        this.target.indexDivisor,
      );
      this.target.nonlinearity = clamp(
        settings?.nonlinearity,
        CHAOTIC_PM_LIMITS.minNonlinearity,
        CHAOTIC_PM_LIMITS.maxNonlinearity,
        this.target.nonlinearity,
      );
      this.target.depth = Math.round(clamp(
        settings?.depth,
        CHAOTIC_PM_LIMITS.minDepth,
        CHAOTIC_PM_LIMITS.maxDepth,
        this.target.depth,
      ));
      this.target.maximumFrequencyHz = clamp(
        settings?.maximumFrequencyHz,
        1,
        sampleRateLimit(this.processorSampleRate),
        this.target.maximumFrequencyHz,
      );
      if (data.immediate) {
        this.current.carrierHz = this.target.carrierHz;
        this.current.startModFrequencyHz = this.target.startModFrequencyHz;
        this.current.frequencyDivisor = this.target.frequencyDivisor;
        this.current.startPhaseIndex = this.target.startPhaseIndex;
        this.current.indexDivisor = this.target.indexDivisor;
        this.current.nonlinearity = this.target.nonlinearity;
        this.current.depth = this.target.depth;
        this.current.maximumFrequencyHz = this.target.maximumFrequencyHz;
        this.depthGains.fill(0);
        this.depthGains[this.target.depth] = 1;
      }
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
      this.current.nonlinearity += (
        this.target.nonlinearity - this.current.nonlinearity
      ) * parameterCoefficient;
      this.current.maximumFrequencyHz += (
        this.target.maximumFrequencyHz - this.current.maximumFrequencyHz
      ) * parameterCoefficient;
      this.carrierPhase += this.current.carrierHz / this.processorSampleRate;
      if (!Number.isFinite(this.carrierPhase)) this.carrierPhase = 0;
      this.carrierPhase -= Math.floor(this.carrierPhase);
      this.signals[0] = Math.sin(TWO_PI * this.carrierPhase);

      let frequencyHz = this.current.startModFrequencyHz;
      let phaseIndex = this.current.startPhaseIndex;
      let availableDepth = 0;
      const warp = clamp(this.current.nonlinearity, 0, 1, 0);
      const shaperGain = 1.2 - Math.sqrt(warp);

      for (let turn = 0; turn < CHAOTIC_PM_LIMITS.maxDepth; turn += 1) {
        if (!Number.isFinite(frequencyHz)
          || frequencyHz >= this.current.maximumFrequencyHz) {
          break;
        }
        this.operatorPhases[turn] += Math.max(0, frequencyHz)
          / this.processorSampleRate;
        if (!Number.isFinite(this.operatorPhases[turn])) {
          this.operatorPhases[turn] = 0;
        }
        this.operatorPhases[turn] -= Math.floor(this.operatorPhases[turn]);
        const safeIndex = clamp(
          phaseIndex,
          0,
          CHAOTIC_PM_LIMITS.maxInternalPhaseIndex,
          CHAOTIC_PM_LIMITS.maxInternalPhaseIndex,
        );
        const wrappedPhase = (
          this.operatorPhases[turn] + this.signals[turn] * safeIndex
        ) % 1;
        const drive = warp * frequencyHz * frequencyHz;
        const shaperInput = clamp(
          wrappedPhase * drive,
          -MAX_SHAPER_INPUT,
          MAX_SHAPER_INPUT,
          0,
        );
        const next = Math.sin(
          TWO_PI * Math.tanh(shaperInput) * shaperGain,
        );
        this.signals[turn + 1] = Number.isFinite(next) ? next : 0;
        availableDepth = turn + 1;
        frequencyHz /= Math.max(
          CHAOTIC_PM_LIMITS.minFrequencyDivisor,
          this.current.frequencyDivisor,
        );
        phaseIndex /= Math.max(
          CHAOTIC_PM_LIMITS.minIndexDivisor,
          this.current.indexDivisor,
        );
      }

      const audibleDepth = Math.min(this.target.depth, availableDepth);
      let mixed = 0;
      for (let depth = 0; depth <= CHAOTIC_PM_LIMITS.maxDepth; depth += 1) {
        const targetGain = depth === audibleDepth ? 1 : 0;
        this.depthGains[depth] += (
          targetGain - this.depthGains[depth]
        ) * depthCoefficient;
        mixed += this.signals[depth] * this.depthGains[depth];
      }
      const sample = Number.isFinite(mixed) ? mixed : 0;
      for (let channel = 0; channel < channels.length; channel += 1) {
        channels[channel][frame] = sample;
      }
    }
    return true;
  }
}

if (typeof globalThis.registerProcessor === "function") {
  globalThis.registerProcessor(PROCESSOR_NAME, ChaoticPmProcessor);
}
