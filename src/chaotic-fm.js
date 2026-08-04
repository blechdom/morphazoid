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

export const CHAOTIC_FM_PERFORMANCE_LIMITS = Object.freeze({
  minRootMidiNote: 0,
  maxRootMidiNote: 127,
  minPitchBendRangeSemitones: 0,
  maxPitchBendRangeSemitones: 24,
  minAmpAttackMs: 0,
  maxAmpAttackMs: 5_000,
  minAmpDecayMs: 0,
  maxAmpDecayMs: 5_000,
  minAmpReleaseMs: 2,
  maxAmpReleaseMs: 10_000,
  minGlideTimeMs: 0,
  maxGlideTimeMs: 2_000,
});

export const CHAOTIC_FM_PARAMETER_IDS = Object.freeze({
  depth: "synthesis.depth",
  carrierHz: "synthesis.carrierHz",
  offsetHz: "synthesis.offsetHz",
  modulationAmount: "synthesis.modulationAmount",
  amountDivisor: "synthesis.amountDivisor",
  nonlinearityHz: "synthesis.nonlinearityHz",
  output: "output.level",
  playMode: "performance.playMode",
  rootMidiNote: "performance.rootMidiNote",
  pitchBendRangeSemitones: "performance.pitchBendRangeSemitones",
  ampAttackMs: "performance.ampAttackMs",
  ampDecayMs: "performance.ampDecayMs",
  ampSustainLevel: "performance.ampSustainLevel",
  ampReleaseMs: "performance.ampReleaseMs",
  glideTimeMs: "performance.glideTimeMs",
  glideMode: "performance.glideMode",
});

export const CHAOTIC_FM_PERFORMANCE_DEFAULTS = Object.freeze({
  playMode: "midi",
  rootMidiNote: 60,
  pitchBendRangeSemitones: 2,
  ampAttackMs: 8,
  ampDecayMs: 120,
  ampSustainLevel: 0.72,
  ampReleaseMs: 180,
  glideTimeMs: 0,
  glideMode: "off",
});

const PLAY_MODES = new Set(["drone", "midi"]);
const GLIDE_MODES = new Set(["off", "legato", "always"]);

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

export function sanitizeChaoticFmPerformance(params = {}) {
  const playMode = String(
    params.playMode ?? CHAOTIC_FM_PERFORMANCE_DEFAULTS.playMode,
  ).toLowerCase();
  const glideMode = String(
    params.glideMode ?? CHAOTIC_FM_PERFORMANCE_DEFAULTS.glideMode,
  ).toLowerCase();
  return Object.freeze({
    playMode: PLAY_MODES.has(playMode)
      ? playMode
      : CHAOTIC_FM_PERFORMANCE_DEFAULTS.playMode,
    rootMidiNote: Math.round(clamp(
      params.rootMidiNote,
      CHAOTIC_FM_PERFORMANCE_LIMITS.minRootMidiNote,
      CHAOTIC_FM_PERFORMANCE_LIMITS.maxRootMidiNote,
      CHAOTIC_FM_PERFORMANCE_DEFAULTS.rootMidiNote,
    )),
    pitchBendRangeSemitones: clamp(
      params.pitchBendRangeSemitones,
      CHAOTIC_FM_PERFORMANCE_LIMITS.minPitchBendRangeSemitones,
      CHAOTIC_FM_PERFORMANCE_LIMITS.maxPitchBendRangeSemitones,
      CHAOTIC_FM_PERFORMANCE_DEFAULTS.pitchBendRangeSemitones,
    ),
    ampAttackMs: clamp(
      params.ampAttackMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.minAmpAttackMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.maxAmpAttackMs,
      CHAOTIC_FM_PERFORMANCE_DEFAULTS.ampAttackMs,
    ),
    ampDecayMs: clamp(
      params.ampDecayMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.minAmpDecayMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.maxAmpDecayMs,
      CHAOTIC_FM_PERFORMANCE_DEFAULTS.ampDecayMs,
    ),
    ampSustainLevel: clamp(
      params.ampSustainLevel,
      0,
      1,
      CHAOTIC_FM_PERFORMANCE_DEFAULTS.ampSustainLevel,
    ),
    ampReleaseMs: clamp(
      params.ampReleaseMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.minAmpReleaseMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.maxAmpReleaseMs,
      CHAOTIC_FM_PERFORMANCE_DEFAULTS.ampReleaseMs,
    ),
    glideTimeMs: clamp(
      params.glideTimeMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.minGlideTimeMs,
      CHAOTIC_FM_PERFORMANCE_LIMITS.maxGlideTimeMs,
      CHAOTIC_FM_PERFORMANCE_DEFAULTS.glideTimeMs,
    ),
    glideMode: GLIDE_MODES.has(glideMode)
      ? glideMode
      : CHAOTIC_FM_PERFORMANCE_DEFAULTS.glideMode,
  });
}

function midiByte(data, index) {
  return Math.round(clamp(data?.[index], 0, 127, 0));
}

function geometricMidiValue(value, minimum, maximum, { zero = false } = {}) {
  const safeValue = midiByte([value], 0);
  if (zero && safeValue === 0) return 0;
  const position = zero ? (safeValue - 1) / 126 : safeValue / 127;
  return minimum * ((maximum / minimum) ** position);
}

export function chaoticFmFactoryControlChange(controller, value) {
  const cc = midiByte([controller], 0);
  const safeValue = midiByte([value], 0);
  if (cc === 5) {
    return {
      type: "parameter",
      key: "glideTimeMs",
      parameterId: CHAOTIC_FM_PARAMETER_IDS.glideTimeMs,
      value: geometricMidiValue(safeValue, 10, 2_000, { zero: true }),
    };
  }
  if (cc === 11) return { type: "expression", value: safeValue / 127 };
  if (cc === 64) return { type: "sustain", down: safeValue >= 64 };
  if (cc === 65) return { type: "glideEnabled", enabled: safeValue >= 64 };
  if (cc === 72) {
    return {
      type: "parameter",
      key: "ampReleaseMs",
      parameterId: CHAOTIC_FM_PARAMETER_IDS.ampReleaseMs,
      value: geometricMidiValue(safeValue, 2, 10_000),
    };
  }
  if (cc === 73) {
    return {
      type: "parameter",
      key: "ampAttackMs",
      parameterId: CHAOTIC_FM_PARAMETER_IDS.ampAttackMs,
      value: geometricMidiValue(safeValue, 0.5, 5_000, { zero: true }),
    };
  }
  if (cc === 75) {
    return {
      type: "parameter",
      key: "ampDecayMs",
      parameterId: CHAOTIC_FM_PARAMETER_IDS.ampDecayMs,
      value: geometricMidiValue(safeValue, 1, 5_000, { zero: true }),
    };
  }
  if (cc === 120) return { type: "allSoundOff" };
  if (cc === 121) return { type: "resetControllers" };
  if (cc === 123) return { type: "allNotesOff" };
  return null;
}

/**
 * Convert one MIDI 1.0 channel message into the platform-neutral actions used
 * by the worklet and later native implementations. System and SysEx messages
 * are intentionally ignored.
 */
export function decodeChaoticFmMidiMessage(data) {
  if (!data || data.length < 1) return null;
  const status = Math.round(clamp(data[0], 0, 255, 0));
  if (status < 0x80 || status >= 0xf0) return null;
  const command = status & 0xf0;
  const channel = status & 0x0f;
  const data1 = midiByte(data, 1);
  const data2 = midiByte(data, 2);

  if (command === 0x90 && data2 > 0) {
    return { type: "noteOn", note: data1, velocity: data2, channel };
  }
  if (command === 0x80 || command === 0x90) {
    return { type: "noteOff", note: data1, velocity: data2, channel };
  }
  if (command === 0xe0) {
    const raw = data1 | (data2 << 7);
    const distance = raw - 8_192;
    return {
      type: "pitchBend",
      normalized: distance < 0 ? distance / 8_192 : distance / 8_191,
      channel,
    };
  }
  if (command !== 0xb0) return null;
  return { type: "controlChange", controller: data1, value: data2, channel };
}

function dispatchChaoticFmMidiAction(target, action) {
  if (!target || !action) return;
  if (action.type === "noteOn") {
    target.noteOn?.(action.note, action.velocity, action.channel);
  } else if (action.type === "noteOff") {
    target.noteOff?.(action.note, action.channel);
  }
  else if (action.type === "pitchBend") target.pitchBend?.(action.normalized);
  else if (action.type === "controlChange") {
    target.controlChange?.(action.controller, action.value);
  }
}

/**
 * Permission-conscious Web MIDI adapter. Merely constructing it never prompts;
 * requestMIDIAccess is called only from enable(), which the UI binds to an
 * explicit user action.
 */
export class ChaoticFmWebMidi {
  constructor(runtime = globalThis, {
    target = null,
    onAction = null,
    onStatus = null,
  } = {}) {
    this.runtime = runtime;
    this.target = target;
    this.onAction = onAction;
    this.onStatus = onStatus;
    this.access = null;
    this.inputs = new Set();
    this.boundMessage = (event) => this.handleMessage(event);
    this.boundStateChange = () => this.refreshInputs();
  }

  get supported() {
    return typeof this.runtime.navigator?.requestMIDIAccess === "function";
  }

  get enabled() {
    return Boolean(this.access);
  }

  status() {
    return Object.freeze({
      supported: this.supported,
      enabled: this.enabled,
      inputCount: this.inputs.size,
    });
  }

  notifyStatus() {
    this.onStatus?.(this.status());
  }

  async enable() {
    if (!this.supported) {
      throw new Error("Web MIDI is not available in this browser.");
    }
    if (this.access) return this.access;
    this.access = await this.runtime.navigator.requestMIDIAccess({ sysex: false });
    if (typeof this.access.addEventListener === "function") {
      this.access.addEventListener("statechange", this.boundStateChange);
    } else {
      this.access.onstatechange = this.boundStateChange;
    }
    this.refreshInputs();
    return this.access;
  }

  refreshInputs() {
    const available = new Set();
    for (const input of this.access?.inputs?.values?.() ?? []) {
      if (input?.state !== "disconnected") available.add(input);
    }
    for (const input of this.inputs) {
      if (available.has(input)) continue;
      if (typeof input.removeEventListener === "function") {
        input.removeEventListener("midimessage", this.boundMessage);
      } else if (input.onmidimessage === this.boundMessage) {
        input.onmidimessage = null;
      }
      this.inputs.delete(input);
    }
    for (const input of available) {
      if (this.inputs.has(input) || input?.state === "disconnected") continue;
      if (typeof input.addEventListener === "function") {
        input.addEventListener("midimessage", this.boundMessage);
      } else {
        input.onmidimessage = this.boundMessage;
      }
      this.inputs.add(input);
    }
    this.notifyStatus();
  }

  handleMessage(event) {
    const action = decodeChaoticFmMidiMessage(event?.data);
    if (!action) return null;
    dispatchChaoticFmMidiAction(this.target, action);
    this.onAction?.(action, event);
    return action;
  }

  close() {
    for (const input of this.inputs) {
      if (typeof input.removeEventListener === "function") {
        input.removeEventListener("midimessage", this.boundMessage);
      } else if (input.onmidimessage === this.boundMessage) {
        input.onmidimessage = null;
      }
    }
    this.inputs.clear();
    if (typeof this.access?.removeEventListener === "function") {
      this.access.removeEventListener("statechange", this.boundStateChange);
    } else if (this.access?.onstatechange === this.boundStateChange) {
      this.access.onstatechange = null;
    }
    this.access = null;
    this.notifyStatus();
  }
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
      const performance = sanitizeChaoticFmPerformance(options.processorOptions);
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

      this.playMode = performance.playMode;
      this.rootMidiNote = performance.rootMidiNote;
      this.pitchBendRangeSemitones = performance.pitchBendRangeSemitones;
      this.ampAttackMs = performance.ampAttackMs;
      this.ampDecayMs = performance.ampDecayMs;
      this.ampSustainLevel = performance.ampSustainLevel;
      this.ampReleaseMs = performance.ampReleaseMs;
      this.glideTimeMs = performance.glideTimeMs;
      this.glideMode = performance.glideMode;
      this.glideEnabled = true;

      this.noteHeld = new Uint8Array(128);
      this.noteSustained = new Uint8Array(128);
      this.noteVelocity = new Float64Array(128);
      this.noteChannel = new Uint8Array(128);
      this.noteOrder = new Uint32Array(128);
      this.noteOrderCounter = 0;
      this.selectedNote = -1;
      this.hasEverNote = false;
      this.sustainDown = false;

      this.currentBaseSemitones = 0;
      this.targetBaseSemitones = 0;
      this.baseGlideStart = 0;
      this.baseGlideElapsed = 0;
      this.baseGlideDuration = 0;
      this.pitchBendNormalized = 0;
      this.currentBendSemitones = 0;
      this.targetBendSemitones = 0;
      this.bendStart = 0;
      this.bendElapsed = 0;
      this.bendDuration = 0;

      this.currentVelocity = 1;
      this.targetVelocity = 1;
      this.currentExpression = 1;
      this.targetExpression = 1;

      // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release, 5 hard fade.
      this.envelopeStage = 0;
      this.envelopeLevel = 0;
      this.envelopeStart = 0;
      this.envelopeTarget = 0;
      this.envelopeElapsed = 0;
      this.envelopeDuration = 0;

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
        } else if (message?.type === "performance") {
          this.setPerformance(message.parameters);
        } else if (message?.type === "noteOn") {
          this.noteOn(message.note, message.velocity, message.channel);
        } else if (message?.type === "noteOff") {
          this.noteOff(message.note);
        } else if (message?.type === "pitchBend") {
          this.setPitchBend(message.normalized);
        } else if (message?.type === "expression") {
          this.targetExpression = clamp(message.value, 0, 1, 1);
        } else if (message?.type === "sustain") {
          this.setSustain(message.down);
        } else if (message?.type === "glideEnabled") {
          this.glideEnabled = Boolean(message.enabled);
        } else if (message?.type === "allNotesOff") {
          this.allNotesOff(false);
        } else if (message?.type === "allSoundOff") {
          this.allNotesOff(true);
        } else if (message?.type === "resetControllers") {
          this.resetControllers();
        } else if (message?.type === "active") {
          this.activeTarget = message.value ? 1 : 0;
        }
      };
    }

    sampleCount(milliseconds, minimum = 0) {
      const workletSampleRate = Number(globalThis.sampleRate) || DEFAULT_SAMPLE_RATE;
      return Math.max(minimum, Math.round(milliseconds * workletSampleRate / 1_000));
    }

    setPerformance(parameters = {}) {
      const previousRootMidiNote = this.rootMidiNote;
      const previousPitchBendRange = this.pitchBendRangeSemitones;
      const safe = sanitizeChaoticFmPerformance({
        playMode: parameters.playMode ?? this.playMode,
        rootMidiNote: parameters.rootMidiNote ?? this.rootMidiNote,
        pitchBendRangeSemitones: (
          parameters.pitchBendRangeSemitones
          ?? this.pitchBendRangeSemitones
        ),
        ampAttackMs: parameters.ampAttackMs ?? this.ampAttackMs,
        ampDecayMs: parameters.ampDecayMs ?? this.ampDecayMs,
        ampSustainLevel: parameters.ampSustainLevel ?? this.ampSustainLevel,
        ampReleaseMs: parameters.ampReleaseMs ?? this.ampReleaseMs,
        glideTimeMs: parameters.glideTimeMs ?? this.glideTimeMs,
        glideMode: parameters.glideMode ?? this.glideMode,
      });
      this.playMode = safe.playMode;
      this.rootMidiNote = safe.rootMidiNote;
      this.pitchBendRangeSemitones = safe.pitchBendRangeSemitones;
      this.ampAttackMs = safe.ampAttackMs;
      this.ampDecayMs = safe.ampDecayMs;
      this.ampSustainLevel = safe.ampSustainLevel;
      this.ampReleaseMs = safe.ampReleaseMs;
      this.glideTimeMs = safe.glideTimeMs;
      this.glideMode = safe.glideMode;
      if (this.envelopeStage === 3) this.envelopeLevel = this.ampSustainLevel;
      if (this.selectedNote >= 0 && safe.rootMidiNote !== previousRootMidiNote) {
        this.currentBaseSemitones = this.selectedNote - this.rootMidiNote;
        this.targetBaseSemitones = this.currentBaseSemitones;
        this.baseGlideDuration = 0;
      }
      if (safe.pitchBendRangeSemitones !== previousPitchBendRange) {
        this.beginBend(this.pitchBendNormalized * this.pitchBendRangeSemitones);
      }
    }

    newestNote({ physicallyHeldOnly = false } = {}) {
      let newest = -1;
      let newestOrder = 0;
      for (let note = 0; note < 128; note += 1) {
        const eligible = this.noteHeld[note]
          || (!physicallyHeldOnly && this.noteSustained[note]);
        if (eligible && (newest < 0 || this.noteOrder[note] >= newestOrder)) {
          newest = note;
          newestOrder = this.noteOrder[note];
        }
      }
      return newest;
    }

    beginBasePitch(note, legatoEligible) {
      const target = note - this.rootMidiNote;
      const shouldGlide = this.hasEverNote
        && this.glideEnabled
        && this.glideTimeMs > 0
        && (
          this.glideMode === "always"
          || (this.glideMode === "legato" && legatoEligible)
        );
      this.targetBaseSemitones = target;
      if (shouldGlide) {
        this.baseGlideStart = this.currentBaseSemitones;
        this.baseGlideElapsed = 0;
        this.baseGlideDuration = this.sampleCount(this.glideTimeMs, 1);
      } else {
        this.currentBaseSemitones = target;
        this.baseGlideStart = target;
        this.baseGlideElapsed = 0;
        this.baseGlideDuration = 0;
      }
      this.hasEverNote = true;
    }

    selectNote(note, { legatoEligible = false, smoothVelocity = true } = {}) {
      this.selectedNote = note;
      this.beginBasePitch(note, legatoEligible);
      const velocity = this.noteVelocity[note];
      this.targetVelocity = velocity;
      if (!smoothVelocity) this.currentVelocity = velocity;
    }

    beginDecay() {
      this.envelopeLevel = 1;
      this.envelopeStart = 1;
      this.envelopeTarget = this.ampSustainLevel;
      this.envelopeElapsed = 0;
      this.envelopeDuration = this.sampleCount(this.ampDecayMs);
      if (this.envelopeDuration === 0) {
        this.envelopeLevel = this.envelopeTarget;
        this.envelopeStage = 3;
      } else {
        this.envelopeStage = 2;
      }
    }

    beginAttack() {
      this.envelopeStart = this.envelopeLevel;
      this.envelopeElapsed = 0;
      this.envelopeDuration = this.sampleCount(this.ampAttackMs);
      if (this.envelopeDuration === 0) this.beginDecay();
      else this.envelopeStage = 1;
    }

    beginRelease({ hard = false } = {}) {
      if (this.envelopeStage === 0 || this.envelopeLevel <= 0) {
        this.envelopeLevel = 0;
        this.envelopeStage = 0;
        return;
      }
      this.envelopeStart = this.envelopeLevel;
      this.envelopeTarget = 0;
      this.envelopeElapsed = 0;
      this.envelopeDuration = this.sampleCount(hard ? 2 : this.ampReleaseMs, 1);
      this.envelopeStage = hard ? 5 : 4;
    }

    noteOn(noteValue, velocityValue, channelValue = 0) {
      const note = Math.round(clamp(noteValue, 0, 127, 60));
      const velocity = Math.round(clamp(velocityValue, 0, 127, 0));
      if (velocity === 0) {
        this.noteOff(note);
        return;
      }
      const hadPhysicalNote = this.newestNote({ physicallyHeldOnly: true }) >= 0;
      const voiceWasSustaining = this.selectedNote >= 0
        && this.envelopeStage !== 0
        && this.envelopeStage !== 4
        && this.envelopeStage !== 5;
      this.noteHeld[note] = 1;
      this.noteSustained[note] = 0;
      this.noteVelocity[note] = velocity / 127;
      this.noteChannel[note] = Math.round(clamp(channelValue, 0, 15, 0));
      this.noteOrderCounter = (this.noteOrderCounter + 1) >>> 0;
      if (this.noteOrderCounter === 0) this.noteOrderCounter = 1;
      this.noteOrder[note] = this.noteOrderCounter;
      this.selectNote(note, {
        legatoEligible: hadPhysicalNote,
        smoothVelocity: voiceWasSustaining,
      });
      if (!voiceWasSustaining) this.beginAttack();
    }

    noteOff(noteValue) {
      const note = Math.round(clamp(noteValue, 0, 127, 60));
      if (!this.noteHeld[note] && !this.noteSustained[note]) return;
      this.noteHeld[note] = 0;
      this.noteSustained[note] = this.sustainDown ? 1 : 0;
      if (note !== this.selectedNote) return;
      const fallback = this.newestNote({ physicallyHeldOnly: true });
      if (fallback >= 0) {
        this.selectNote(fallback, { legatoEligible: true, smoothVelocity: true });
      } else if (this.sustainDown) {
        // The released current note is sustained only when no physical key is
        // available. Physical keys always retain monophonic last-note priority.
        return;
      } else {
        this.selectedNote = -1;
        this.beginRelease();
      }
    }

    setSustain(down) {
      const next = Boolean(down);
      if (next === this.sustainDown) return;
      this.sustainDown = next;
      if (next) return;
      for (let note = 0; note < 128; note += 1) this.noteSustained[note] = 0;
      if (this.selectedNote >= 0 && this.noteHeld[this.selectedNote]) return;
      const fallback = this.newestNote({ physicallyHeldOnly: true });
      if (fallback >= 0) {
        this.selectNote(fallback, { legatoEligible: true, smoothVelocity: true });
      } else if (this.selectedNote >= 0) {
        this.selectedNote = -1;
        this.beginRelease();
      }
    }

    clearNoteState() {
      this.noteHeld.fill(0);
      this.noteSustained.fill(0);
      this.selectedNote = -1;
    }

    allNotesOff(hard) {
      this.clearNoteState();
      if (hard) {
        this.sustainDown = false;
        this.beginRelease({ hard: true });
      } else {
        this.beginRelease();
      }
    }

    beginBend(targetSemitones) {
      this.bendStart = this.currentBendSemitones;
      this.targetBendSemitones = targetSemitones;
      this.bendElapsed = 0;
      this.bendDuration = this.sampleCount(8, 1);
    }

    setPitchBend(normalized) {
      this.pitchBendNormalized = clamp(normalized, -1, 1, 0);
      this.beginBend(
        this.pitchBendNormalized * this.pitchBendRangeSemitones,
      );
    }

    resetControllers() {
      this.targetExpression = 1;
      this.glideEnabled = true;
      this.setPitchBend(0);
      this.setSustain(false);
    }

    advanceEnvelope() {
      if (this.envelopeStage === 0) return 0;
      if (this.envelopeStage === 3) {
        this.envelopeLevel = this.ampSustainLevel;
        return this.envelopeLevel;
      }
      this.envelopeElapsed += 1;
      const progress = Math.min(
        1,
        this.envelopeElapsed / Math.max(1, this.envelopeDuration),
      );
      const remaining = 1 - progress;
      if (this.envelopeStage === 1) {
        this.envelopeLevel = this.envelopeStart
          + (1 - this.envelopeStart) * (1 - remaining * remaining);
        if (progress >= 1) this.beginDecay();
      } else if (this.envelopeStage === 2) {
        this.envelopeLevel = this.envelopeTarget
          + (1 - this.envelopeTarget) * remaining * remaining;
        if (progress >= 1) {
          this.envelopeLevel = this.envelopeTarget;
          this.envelopeStage = 3;
        }
      } else {
        this.envelopeLevel = this.envelopeStart * remaining * remaining;
        if (progress >= 1) {
          this.envelopeLevel = 0;
          this.envelopeStage = 0;
        }
      }
      return this.envelopeLevel;
    }

    advancePitch() {
      if (this.baseGlideDuration > 0) {
        this.baseGlideElapsed += 1;
        const progress = Math.min(1, this.baseGlideElapsed / this.baseGlideDuration);
        this.currentBaseSemitones = this.baseGlideStart
          + (this.targetBaseSemitones - this.baseGlideStart) * progress;
        if (progress >= 1) this.baseGlideDuration = 0;
      }
      if (this.bendDuration > 0) {
        this.bendElapsed += 1;
        const progress = Math.min(1, this.bendElapsed / this.bendDuration);
        this.currentBendSemitones = this.bendStart
          + (this.targetBendSemitones - this.bendStart) * progress;
        if (progress >= 1) this.bendDuration = 0;
      }
      return 2 ** ((this.currentBaseSemitones + this.currentBendSemitones) / 12);
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
      const performanceSlew = 1 - Math.exp(-1 / (workletSampleRate * 0.006));
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
        this.currentVelocity += (
          this.targetVelocity - this.currentVelocity
        ) * performanceSlew;
        this.currentExpression += (
          this.targetExpression - this.currentExpression
        ) * performanceSlew;
        const pitchRatio = this.playMode === "midi" ? this.advancePitch() : 1;
        const envelope = this.advanceEnvelope();

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
          this.phases[0] + Math.min(
            frequencyCeiling,
            this.currentCarrierHz * pitchRatio,
          ) * phaseScale,
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
          this.phases[1] + Math.min(
            frequencyCeiling,
            Math.max(-frequencyCeiling, entryFrequency * pitchRatio),
          ) * phaseScale,
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
            this.phases[depthIndex + 1] + Math.min(
              frequencyCeiling,
              Math.max(-frequencyCeiling, recursiveFrequency * pitchRatio),
            ) * phaseScale,
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
        const performanceGain = this.playMode === "midi"
          ? envelope * this.currentVelocity * this.currentExpression
          : 1;
        const sample = mixedSignal * this.activeGain * performanceGain * 0.5;
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
    this.performance = { ...CHAOTIC_FM_PERFORMANCE_DEFAULTS };
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
        processorOptions: {
          ...this.params,
          ...this.performance,
        },
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
      analyser.fftSize = 2_048;
      analyser.minDecibels = -90;
      analyser.maxDecibels = 0;
      analyser.smoothingTimeConstant = 0.45;

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
      this.setPerformanceParameters(this.performance);
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

  setPerformanceParameters(params = {}) {
    const safe = sanitizeChaoticFmPerformance({
      ...this.performance,
      ...params,
    });
    this.performance = { ...safe };
    if (!this.isInitialized) return;
    this.node.port.postMessage({
      type: "performance",
      parameters: this.performance,
    });
  }

  postPerformanceAction(type, payload = {}) {
    if (!this.isInitialized) return false;
    this.node.port.postMessage({ type, ...payload });
    return true;
  }

  noteOn(note, velocity = 127, channel = 0) {
    return this.postPerformanceAction("noteOn", { note, velocity, channel });
  }

  noteOff(note, channel = 0) {
    return this.postPerformanceAction("noteOff", { note, channel });
  }

  pitchBend(normalized) {
    return this.postPerformanceAction("pitchBend", { normalized });
  }

  setExpression(value) {
    return this.postPerformanceAction("expression", { value });
  }

  setSustain(down) {
    return this.postPerformanceAction("sustain", { down });
  }

  setGlideEnabled(enabled) {
    return this.postPerformanceAction("glideEnabled", { enabled });
  }

  allNotesOff() {
    return this.postPerformanceAction("allNotesOff");
  }

  allSoundOff() {
    return this.postPerformanceAction("allSoundOff");
  }

  resetControllers() {
    return this.postPerformanceAction("resetControllers");
  }

  controlChange(controller, value) {
    const action = chaoticFmFactoryControlChange(controller, value);
    if (!action) return false;
    if (action.type === "parameter") {
      this.setPerformanceParameters({ [action.key]: action.value });
      return true;
    }
    if (action.type === "expression") return this.setExpression(action.value);
    if (action.type === "sustain") return this.setSustain(action.down);
    if (action.type === "glideEnabled") {
      return this.setGlideEnabled(action.enabled);
    }
    if (action.type === "allSoundOff") return this.allSoundOff();
    if (action.type === "resetControllers") return this.resetControllers();
    if (action.type === "allNotesOff") return this.allNotesOff();
    return false;
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
