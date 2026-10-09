import { CHAOTIC_AM_PRESETS } from "./presets.js";
export { CHAOTIC_AM_PRESETS } from "./presets.js";
import { unlockAudioContext } from "../../audio.js";
import { connectAudioOutput } from "../../audio-output-manager.js";

const PROCESSOR_NAME = "morphazoid-chaotic-am";
const DEFAULT_SAMPLE_RATE = 48_000;
const PARAMETER_SMOOTHING_SECONDS = 0.018;
const DEPTH_SMOOTHING_SECONDS = 0.009;
const MAX_AUDIBLE_FREQUENCY = 20_000;
const MAX_SATURATED_CHAOS_DRIVE = 32;
const MAX_SMOOTH_CHAOS_DRIVE = 9;
const TWO_PI = Math.PI * 2;

// Keep the family's output DC protection: matched AM sidebands can reach DC.
export const CHAOTIC_AM_DC_BLOCKER_HZ = 18;

export const CHAOTIC_AM_TRANSFER_MODES = Object.freeze({
  smooth: "smooth",
  saturated: "saturated",
});

export const CHAOTIC_AM_LIMITS = Object.freeze({
  minDepth: 0,
  maxDepth: 10,
  minCarrierHz: 40,
  maxCarrierHz: 2_000,
  minModFrequencyHz: 0.5,
  maxModFrequencyHz: 2_400,
  minFrequencyDivisor: 0.5,
  maxFrequencyDivisor: 4,
  minAmplitudeIndex: 0,
  maxAmplitudeIndex: 64,
  minIndexDivisor: 0.5,
  maxIndexDivisor: 2,
  minNonlinearity: 0,
  maxNonlinearity: 1,
  maxInternalAmplitudeIndex: 64,
});

export const CHAOTIC_AM_PERFORMANCE_LIMITS = Object.freeze({
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

// Drone remains the browser default so the existing Audio button still makes
// sound immediately. MIDI mode switches the same engine to note articulation.
export const CHAOTIC_AM_PERFORMANCE_DEFAULTS = Object.freeze({
  playMode: "drone",
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

export const CHAOTIC_AM_PARAMETER_IDS = Object.freeze({
  transferMode: "synthesis.transferMode",
  depth: "synthesis.depth",
  carrierHz: "synthesis.carrierHz",
  startModFrequencyHz: "synthesis.startModFrequencyHz",
  frequencyDivisor: "synthesis.frequencyDivisor",
  startAmplitudeIndex: "synthesis.startAmplitudeIndex",
  indexDivisor: "synthesis.indexDivisor",
  nonlinearity: "synthesis.nonlinearity",
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

// Keep the familiar default identity and master level with an AM-specific voice.
export const DEFAULT_CHAOTIC_AM_PRESET_ID = "forty-fold";
export const CHAOTIC_AM_DEFAULTS = Object.freeze({
  ...CHAOTIC_AM_PRESETS[1].settings,
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

function sanitizeChaoticAmTransferMode(value) {
  const mode = String(value ?? CHAOTIC_AM_TRANSFER_MODES.smooth).toLowerCase();
  return mode === "saturated"
    ? CHAOTIC_AM_TRANSFER_MODES.saturated
    : CHAOTIC_AM_TRANSFER_MODES.smooth;
}

/**
 * Bound UI and preset values before they enter the render thread.
 * Nonlinearity shapes the amplitude modulator; oscillator pitch is independent.
 */
export function sanitizeChaoticAmParams(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const maximumFrequencyHz = sampleRateLimit(sampleRate);
  return Object.freeze({
    transferMode: sanitizeChaoticAmTransferMode(
      settingValue(
        params,
        "transferMode",
        "mode",
        CHAOTIC_AM_DEFAULTS.transferMode,
      ),
    ),
    depth: Math.round(clamp(
      settingValue(params, "depth", "steps", CHAOTIC_AM_DEFAULTS.depth),
      CHAOTIC_AM_LIMITS.minDepth,
      CHAOTIC_AM_LIMITS.maxDepth,
      CHAOTIC_AM_DEFAULTS.depth,
    )),
    carrierHz: clamp(
      settingValue(
        params,
        "carrierHz",
        "carrierFreq",
        CHAOTIC_AM_DEFAULTS.carrierHz,
      ),
      CHAOTIC_AM_LIMITS.minCarrierHz,
      Math.min(CHAOTIC_AM_LIMITS.maxCarrierHz, maximumFrequencyHz),
      CHAOTIC_AM_DEFAULTS.carrierHz,
    ),
    startModFrequencyHz: clamp(
      settingValue(
        params,
        "startModFrequencyHz",
        "startModFreq",
        CHAOTIC_AM_DEFAULTS.startModFrequencyHz,
      ),
      CHAOTIC_AM_LIMITS.minModFrequencyHz,
      Math.min(CHAOTIC_AM_LIMITS.maxModFrequencyHz, maximumFrequencyHz),
      CHAOTIC_AM_DEFAULTS.startModFrequencyHz,
    ),
    frequencyDivisor: clamp(
      settingValue(
        params,
        "frequencyDivisor",
        "freqDiv",
        CHAOTIC_AM_DEFAULTS.frequencyDivisor,
      ),
      CHAOTIC_AM_LIMITS.minFrequencyDivisor,
      CHAOTIC_AM_LIMITS.maxFrequencyDivisor,
      CHAOTIC_AM_DEFAULTS.frequencyDivisor,
    ),
    startAmplitudeIndex: clamp(
      settingValue(
        params,
        "startAmplitudeIndex",
        "indexOfMod",
        CHAOTIC_AM_DEFAULTS.startAmplitudeIndex,
      ),
      CHAOTIC_AM_LIMITS.minAmplitudeIndex,
      CHAOTIC_AM_LIMITS.maxAmplitudeIndex,
      CHAOTIC_AM_DEFAULTS.startAmplitudeIndex,
    ),
    indexDivisor: clamp(
      settingValue(
        params,
        "indexDivisor",
        "indexDiv",
        CHAOTIC_AM_DEFAULTS.indexDivisor,
      ),
      CHAOTIC_AM_LIMITS.minIndexDivisor,
      CHAOTIC_AM_LIMITS.maxIndexDivisor,
      CHAOTIC_AM_DEFAULTS.indexDivisor,
    ),
    nonlinearity: clamp(
      settingValue(
        params,
        "nonlinearity",
        "filter",
        CHAOTIC_AM_DEFAULTS.nonlinearity,
      ),
      CHAOTIC_AM_LIMITS.minNonlinearity,
      CHAOTIC_AM_LIMITS.maxNonlinearity,
      CHAOTIC_AM_DEFAULTS.nonlinearity,
    ),
    maximumFrequencyHz,
  });
}

export function sanitizeChaoticAmPerformance(params = {}) {
  const playMode = String(
    params.playMode ?? CHAOTIC_AM_PERFORMANCE_DEFAULTS.playMode,
  ).toLowerCase();
  const glideMode = String(
    params.glideMode ?? CHAOTIC_AM_PERFORMANCE_DEFAULTS.glideMode,
  ).toLowerCase();
  return Object.freeze({
    playMode: PLAY_MODES.has(playMode)
      ? playMode
      : CHAOTIC_AM_PERFORMANCE_DEFAULTS.playMode,
    rootMidiNote: Math.round(clamp(
      params.rootMidiNote,
      CHAOTIC_AM_PERFORMANCE_LIMITS.minRootMidiNote,
      CHAOTIC_AM_PERFORMANCE_LIMITS.maxRootMidiNote,
      CHAOTIC_AM_PERFORMANCE_DEFAULTS.rootMidiNote,
    )),
    pitchBendRangeSemitones: clamp(
      params.pitchBendRangeSemitones,
      CHAOTIC_AM_PERFORMANCE_LIMITS.minPitchBendRangeSemitones,
      CHAOTIC_AM_PERFORMANCE_LIMITS.maxPitchBendRangeSemitones,
      CHAOTIC_AM_PERFORMANCE_DEFAULTS.pitchBendRangeSemitones,
    ),
    ampAttackMs: clamp(
      params.ampAttackMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.minAmpAttackMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.maxAmpAttackMs,
      CHAOTIC_AM_PERFORMANCE_DEFAULTS.ampAttackMs,
    ),
    ampDecayMs: clamp(
      params.ampDecayMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.minAmpDecayMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.maxAmpDecayMs,
      CHAOTIC_AM_PERFORMANCE_DEFAULTS.ampDecayMs,
    ),
    ampSustainLevel: clamp(
      params.ampSustainLevel,
      0,
      1,
      CHAOTIC_AM_PERFORMANCE_DEFAULTS.ampSustainLevel,
    ),
    ampReleaseMs: clamp(
      params.ampReleaseMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.minAmpReleaseMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.maxAmpReleaseMs,
      CHAOTIC_AM_PERFORMANCE_DEFAULTS.ampReleaseMs,
    ),
    glideTimeMs: clamp(
      params.glideTimeMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.minGlideTimeMs,
      CHAOTIC_AM_PERFORMANCE_LIMITS.maxGlideTimeMs,
      CHAOTIC_AM_PERFORMANCE_DEFAULTS.glideTimeMs,
    ),
    glideMode: GLIDE_MODES.has(glideMode)
      ? glideMode
      : CHAOTIC_AM_PERFORMANCE_DEFAULTS.glideMode,
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

/** Stable factory performance map shared with Chaotic FM. Algorithm controls
 * remain available for a future MIDI-learn layer instead of claiming fixed CCs.
 */
export function chaoticAmFactoryControlChange(controller, value) {
  const cc = midiByte([controller], 0);
  const safeValue = midiByte([value], 0);
  if (cc === 5) {
    return {
      type: "parameter",
      key: "glideTimeMs",
      parameterId: CHAOTIC_AM_PARAMETER_IDS.glideTimeMs,
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
      parameterId: CHAOTIC_AM_PARAMETER_IDS.ampReleaseMs,
      value: geometricMidiValue(safeValue, 2, 10_000),
    };
  }
  if (cc === 73) {
    return {
      type: "parameter",
      key: "ampAttackMs",
      parameterId: CHAOTIC_AM_PARAMETER_IDS.ampAttackMs,
      value: geometricMidiValue(safeValue, 0.5, 5_000, { zero: true }),
    };
  }
  if (cc === 75) {
    return {
      type: "parameter",
      key: "ampDecayMs",
      parameterId: CHAOTIC_AM_PARAMETER_IDS.ampDecayMs,
      value: geometricMidiValue(safeValue, 1, 5_000, { zero: true }),
    };
  }
  if (cc === 120) return { type: "allSoundOff" };
  if (cc === 121) return { type: "resetControllers" };
  if (cc === 123) return { type: "allNotesOff" };
  return null;
}

export function decodeChaoticAmMidiMessage(data) {
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

function dispatchChaoticAmMidiAction(target, action) {
  if (!target || !action) return;
  if (action.type === "noteOn") {
    if (action.sourceId === undefined) {
      target.noteOn?.(action.note, action.velocity, action.channel);
    } else {
      target.noteOn?.(action.note, action.velocity, action.channel, action.sourceId);
    }
  } else if (action.type === "noteOff") {
    if (action.sourceId === undefined) {
      target.noteOff?.(action.note, action.channel);
    } else {
      target.noteOff?.(action.note, action.channel, action.sourceId);
    }
  } else if (action.type === "pitchBend") {
    target.pitchBend?.(action.normalized);
  } else if (action.type === "controlChange") {
    target.controlChange?.(action.controller, action.value);
  }
}

/** Web MIDI permission is requested only by the explicit enable() call. */
export class ChaoticAmWebMidi {
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
    this.enablePromise = null;
    this.generation = 0;
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
    if (this.enablePromise) return this.enablePromise;
    const generation = this.generation;
    const request = this.runtime.navigator.requestMIDIAccess({ sysex: false });
    const pending = Promise.resolve(request).then((access) => {
      if (generation !== this.generation) return null;
      this.access = access;
      if (typeof this.access.addEventListener === "function") {
        this.access.addEventListener("statechange", this.boundStateChange);
      } else {
        this.access.onstatechange = this.boundStateChange;
      }
      this.refreshInputs();
      return this.access;
    });
    this.enablePromise = pending;
    try {
      return await pending;
    } finally {
      if (this.enablePromise === pending) this.enablePromise = null;
    }
  }

  refreshInputs() {
    const available = new Set();
    for (const input of this.access?.inputs?.values?.() ?? []) {
      if (input?.state !== "disconnected") available.add(input);
    }
    let disconnected = false;
    for (const input of this.inputs) {
      if (available.has(input)) continue;
      if (typeof input.removeEventListener === "function") {
        input.removeEventListener("midimessage", this.boundMessage);
      } else if (input.onmidimessage === this.boundMessage) {
        input.onmidimessage = null;
      }
      this.inputs.delete(input);
      disconnected = true;
    }
    for (const input of available) {
      if (this.inputs.has(input)) continue;
      if (typeof input.addEventListener === "function") {
        input.addEventListener("midimessage", this.boundMessage);
      } else {
        input.onmidimessage = this.boundMessage;
      }
      this.inputs.add(input);
    }
    if (disconnected) {
      const action = {
        type: "controlChange",
        controller: 120,
        value: 0,
        channel: 0,
        synthetic: true,
        reason: "inputDisconnected",
      };
      dispatchChaoticAmMidiAction(this.target, action);
      this.onAction?.(action, null);
    }
    this.notifyStatus();
  }

  handleMessage(event) {
    const decoded = decodeChaoticAmMidiMessage(event?.data);
    if (!decoded) return null;
    const action = event?.sourceId === undefined
      ? decoded
      : Object.freeze({ ...decoded, sourceId: String(event.sourceId) });
    dispatchChaoticAmMidiAction(this.target, action);
    this.onAction?.(action, event);
    return action;
  }

  close() {
    this.generation += 1;
    this.enablePromise = null;
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

function normalizedOutputGain() {
  // Every nested link is bounded by one. Depth does not turn down the carrier.
  return 0.52;
}

// Fade a modulator before its fundamental reaches the render ceiling. The
// carrier stays connected; even extreme expanding ladders cannot mute it.
function modulatorBandGain(frequencyHz, maximumFrequencyHz) {
  return clamp((maximumFrequencyHz - frequencyHz) / (maximumFrequencyHz * 0.15), 0, 1, 0);
}

/**
 * Reverse-nested AM: the audible carrier keeps its pitch while the divided
 * oscillators recursively modulate its gain. Starting index controls the
 * outermost link; index division shapes only the deeper modulation.
 * y[n] = sin(phase[n]) * (1 + d[n] * shape(y[n+1])) / (1 + d[n])
 * The innermost oscillator is a plain sine. Audio always comes from y[0].
 */
export function deriveChaoticAmStack(
  params = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const settings = sanitizeChaoticAmParams(params, { sampleRate });
  const operators = [{
    index: 0, turn: 0, kind: "carrier",
    sourceIndex: settings.depth > 0 ? 1 : null,
    frequencyHz: settings.carrierHz,
    amplitudeIndex: settings.depth > 0 ? settings.startAmplitudeIndex : 0,
    rawAmplitudeIndex: settings.startAmplitudeIndex,
    nonlinearity: settings.nonlinearity, drive: 0, gain: 1,
  }];
  let frequencyHz = settings.startModFrequencyHz;
  let rawAmplitudeIndex = settings.startAmplitudeIndex;
  let boundedByFrequency = false;
  let boundedByIndex = false;
  const saturated = settings.transferMode === CHAOTIC_AM_TRANSFER_MODES.saturated;
  const drive = 1 + settings.nonlinearity * (
    (saturated ? MAX_SATURATED_CHAOS_DRIVE : MAX_SMOOTH_CHAOS_DRIVE) - 1
  );
  operators[0].drive = drive;
  operators[0].modulationDepth = chaoticAmModulationDepth(operators[0].amplitudeIndex);
  for (let turn = 1; turn <= settings.depth; turn += 1) {
    rawAmplitudeIndex = turn < settings.depth ? rawAmplitudeIndex / settings.indexDivisor : 0;
    const amplitudeIndex = clamp(rawAmplitudeIndex, 0, CHAOTIC_AM_LIMITS.maxInternalAmplitudeIndex,
      CHAOTIC_AM_LIMITS.maxInternalAmplitudeIndex);
    if (amplitudeIndex !== rawAmplitudeIndex) boundedByIndex = true;
    const bandGain = modulatorBandGain(frequencyHz, settings.maximumFrequencyHz);
    if (bandGain < 1) boundedByFrequency = true;
    operators.push({
      index: turn, turn, kind: "chaotic-amplitude-operator",
      sourceIndex: turn < settings.depth ? turn + 1 : null,
      frequencyHz: Math.min(frequencyHz, settings.maximumFrequencyHz),
      rawFrequencyHz: frequencyHz, bandGain,
      amplitudeIndex, rawAmplitudeIndex,
      nonlinearity: settings.nonlinearity, drive,
      modulationDepth: chaoticAmModulationDepth(amplitudeIndex),
      amplitudeIndexUnit: "index", gain: 1,
    });
    frequencyHz /= settings.frequencyDivisor;
  }
  return Object.freeze({
    settings, operators: Object.freeze(operators.map(Object.freeze)),
    requestedDepth: settings.depth, actualDepth: settings.depth, audibleIndex: 0,
    boundedByFrequency, boundedByIndex, normalizedGain: normalizedOutputGain(),
  });
}

export function summarizeChaoticAmStack(stack) {
  const model = stack?.operators ? stack : deriveChaoticAmStack(stack);
  return Object.freeze({
    requestedDepth: model.requestedDepth, actualDepth: model.actualDepth,
    operatorCount: model.operators.length,
    label: `${model.actualDepth} ${model.actualDepth === 1 ? "modulator" : "modulators"}`
      + ` · carrier ${formatChaoticAmFrequency(model.settings.carrierHz)}`
      + (model.boundedByFrequency ? " · bandwidth limited" : ""),
  });
}

/** Map the inherited 0–64 index into bounded, carrier-preserving AM depth. */
export function chaoticAmModulationDepth(index) {
  const safe = clamp(index, 0, CHAOTIC_AM_LIMITS.maxInternalAmplitudeIndex, 0);
  return safe / (1 + safe);
}

function amplitudeTurnSample(previousSignal, basePhase, amplitudeIndex, nonlinearity, maximumDrive) {
  const previous = clamp(previousSignal, -1, 1, 0);
  const phase = finiteNumber(basePhase, 0) % 1;
  const depth = chaoticAmModulationDepth(amplitudeIndex);
  const chaos = clamp(nonlinearity, 0, 1, 0);
  const drive = 1 + chaos * (maximumDrive - 1);
  const shaped = Math.tanh(previous * drive) / Math.tanh(drive);
  const modulator = previous + (shaped - previous) * chaos;
  return Math.sin(TWO_PI * phase) * (1 + depth * modulator) / (1 + depth);
}

/** Smooth nonlinear amplitude shaping; zero chaos is ordinary recursive AM. */
export function smoothChaoticAmTurnSample(previousSignal, basePhase, _frequencyHz, amplitudeIndex, nonlinearity) {
  return amplitudeTurnSample(previousSignal, basePhase, amplitudeIndex, nonlinearity, MAX_SMOOTH_CHAOS_DRIVE);
}

/** A stronger continuous tanh transfer for the family's second transfer mode. */
export function saturatedChaoticAmTurnSample(previousSignal, basePhase, _frequencyHz, amplitudeIndex, nonlinearity) {
  return amplitudeTurnSample(previousSignal, basePhase, amplitudeIndex, nonlinearity, MAX_SATURATED_CHAOS_DRIVE);
}

export function logarithmicChaoticAmValue(position, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.001));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safePosition = clamp(position, 0, 1, 0);
  return safeMinimum * ((safeMaximum / safeMinimum) ** safePosition);
}

export function logarithmicChaoticAmPosition(value, minimum, maximum) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.001));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, safeMinimum));
  const safeValue = clamp(value, safeMinimum, safeMaximum, safeMinimum);
  if (safeMinimum === safeMaximum) return 0;
  return Math.log(safeValue / safeMinimum)
    / Math.log(safeMaximum / safeMinimum);
}

export function formatChaoticAmNumber(value, digits = 3) {
  return finiteNumber(value, 0)
    .toFixed(digits)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function formatChaoticAmFrequency(value) {
  const frequency = Math.max(0, finiteNumber(value, 0));
  if (frequency >= 1_000) {
    return `${formatChaoticAmNumber(frequency / 1_000, 2)} kHz`;
  }
  if (frequency >= 100) return `${formatChaoticAmNumber(frequency, 1)} Hz`;
  if (frequency >= 10) return `${formatChaoticAmNumber(frequency, 2)} Hz`;
  return `${formatChaoticAmNumber(frequency, 4)} Hz`;
}

export function createChaoticAmSoftCeilingCurve(
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
export class ChaoticAmAudio {
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
    this.releaseAudioOutput = null;
    this.waveform = null;
    this.nodes = [];
    this.stopping = false;
    this.startPromise = null;
    this.pendingSettings = { ...CHAOTIC_AM_DEFAULTS };
    this.pendingLevel = CHAOTIC_AM_DEFAULTS.output;
    this.performance = { ...CHAOTIC_AM_PERFORMANCE_DEFAULTS };
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

  async start(settings, level = CHAOTIC_AM_DEFAULTS.output) {
    if (this.context?.state === "closed") this.clearGraphReferences();
    this.updateSettings(settings);
    this.setLevel(level);
    if (this.running) {
      if (this.context.state === "suspended") {
        unlockAudioContext(this.context);
        await this.context.resume();
      }
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
      if (context.state !== "running") {
        unlockAudioContext(context);
        await context.resume();
      }
      await context.audioWorklet.addModule(
        new URL("./chaotic-am.js", import.meta.url),
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
      highpass.frequency.value = CHAOTIC_AM_DC_BLOCKER_HZ;
      highpass.Q.value = 0.707;
      normalizationGain.gain.value = 0;
      masterGain.gain.value = 0;
      configureCompressor(compressor);
      ceiling.curve = createChaoticAmSoftCeilingCurve();
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
        .connect(analyser);
      this.releaseAudioOutput = connectAudioOutput(context, analyser, { runtime: this.runtime });

      this.worklet = worklet;
      this.node = worklet;
      this.highpass = highpass;
      this.normalizationGain = normalizationGain;
      this.compressor = compressor;
      this.ceiling = ceiling;
      this.masterGain = masterGain;
      this.analyser = analyser;
      // Match Chaotic FM's 512-sample scope window. The analyser keeps its
      // 2048-point FFT for spectrum resolution while time-domain copy length
      // controls only the visible horizontal waveform window.
      this.waveform = new Uint8Array(512);
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
      this.setPerformanceParameters(this.performance);
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
    const stack = deriveChaoticAmStack(settings, { sampleRate: this.sampleRate });
    this.pendingSettings = {
      transferMode: stack.settings.transferMode,
      depth: stack.settings.depth,
      carrierHz: stack.settings.carrierHz,
      startModFrequencyHz: stack.settings.startModFrequencyHz,
      frequencyDivisor: stack.settings.frequencyDivisor,
      startAmplitudeIndex: stack.settings.startAmplitudeIndex,
      indexDivisor: stack.settings.indexDivisor,
      nonlinearity: stack.settings.nonlinearity,
    };
    if (!this.context || this.context.state === "closed" || !this.worklet) {
      return stack;
    }
    this.worklet.port.postMessage({
      type: "settings",
      settings: {
        transferMode: stack.settings.transferMode,
        carrierHz: stack.settings.carrierHz,
        startModFrequencyHz: stack.settings.startModFrequencyHz,
        frequencyDivisor: stack.settings.frequencyDivisor,
        startAmplitudeIndex: stack.settings.startAmplitudeIndex,
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
      CHAOTIC_AM_DEFAULTS.output,
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

  setPerformanceParameters(params = {}) {
    this.performance = { ...sanitizeChaoticAmPerformance({
      ...this.performance,
      ...params,
    }) };
    if (!this.context || this.context.state === "closed" || !this.worklet) {
      return this.performance;
    }
    this.worklet.port.postMessage({
      type: "performance",
      parameters: this.performance,
    });
    return this.performance;
  }

  postPerformanceAction(type, payload = {}) {
    if (!this.context || this.context.state === "closed" || !this.worklet) {
      return false;
    }
    this.worklet.port.postMessage({ type, ...payload });
    return true;
  }

  noteOn(note, velocity = 127, channel = 0, sourceId = "default") {
    return this.postPerformanceAction("noteOn", {
      note, velocity, channel, sourceId: String(sourceId),
    });
  }

  noteOff(note, channel = 0, sourceId = "default") {
    return this.postPerformanceAction("noteOff", {
      note, channel, sourceId: String(sourceId),
    });
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
    const action = chaoticAmFactoryControlChange(controller, value);
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

  readWaveform() {
    if (!this.running || !this.analyser || !this.waveform) return null;
    this.analyser.getByteTimeDomainData(this.waveform);
    return this.waveform;
  }

  clearGraphReferences() {
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
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

class ChaoticAmProcessor extends ProcessorBase {
  constructor() {
    super();
    const defaults = sanitizeChaoticAmParams();
    this.active = true;
    this.processorSampleRate = finiteNumber(globalThis.sampleRate, DEFAULT_SAMPLE_RATE);
    this.sustainCoefficient = 1 - Math.exp(-1 / (this.processorSampleRate * 0.008));
    this.carrierPhase = 0;
    this.operatorPhases = new Float64Array(CHAOTIC_AM_LIMITS.maxDepth);
    this.signals = new Float64Array(CHAOTIC_AM_LIMITS.maxDepth + 1);
    this.saturatedSignals = new Float64Array(CHAOTIC_AM_LIMITS.maxDepth + 1);
    this.depthGains = new Float64Array(CHAOTIC_AM_LIMITS.maxDepth + 1);
    this.depthMix = new Float64Array(CHAOTIC_AM_LIMITS.maxDepth + 1);
    this.oscillatorSamples = new Float64Array(CHAOTIC_AM_LIMITS.maxDepth + 1);
    this.linkDepths = new Float64Array(CHAOTIC_AM_LIMITS.maxDepth);
    this.current = {
      carrierHz: defaults.carrierHz,
      startModFrequencyHz: defaults.startModFrequencyHz,
      frequencyDivisor: defaults.frequencyDivisor,
      startAmplitudeIndex: defaults.startAmplitudeIndex,
      indexDivisor: defaults.indexDivisor,
      nonlinearity: defaults.nonlinearity,
      depth: defaults.depth,
      maximumFrequencyHz: sampleRateLimit(this.processorSampleRate),
    };
    this.target = { ...this.current };
    this.currentSaturatedMix = defaults.transferMode
      === CHAOTIC_AM_TRANSFER_MODES.saturated ? 1 : 0;
    this.targetSaturatedMix = this.currentSaturatedMix;
    this.depthGains[defaults.depth] = 1;

    const performance = sanitizeChaoticAmPerformance();
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
    this.noteHeld = new Uint32Array(128);
    this.noteSustained = new Uint32Array(128);
    this.noteChannel = new Uint8Array(128);
    this.noteVelocity = new Float64Array(128);
    this.noteOrder = new Uint32Array(128);
    this.noteOrderCounter = 0;
    this.noteEvents = [];
    this.selectedEventId = 0;
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

    this.port.onmessage = ({ data }) => {
      if (data?.type === "shutdown") {
        this.active = false;
        return;
      }
      if (data?.type === "performance") {
        this.setPerformance(data.parameters);
        return;
      }
      if (data?.type === "noteOn") {
        this.noteOn(data.note, data.velocity, data.channel, data.sourceId);
        return;
      }
      if (data?.type === "noteOff") {
        this.noteOff(data.note, data.channel, data.sourceId);
        return;
      }
      if (data?.type === "pitchBend") {
        this.setPitchBend(data.normalized);
        return;
      }
      if (data?.type === "expression") {
        this.targetExpression = clamp(data.value, 0, 1, 1);
        return;
      }
      if (data?.type === "sustain") {
        this.setSustain(data.down);
        return;
      }
      if (data?.type === "glideEnabled") {
        this.glideEnabled = Boolean(data.enabled);
        return;
      }
      if (data?.type === "allNotesOff") {
        this.allNotesOff(false);
        return;
      }
      if (data?.type === "allSoundOff") {
        this.allNotesOff(true);
        return;
      }
      if (data?.type === "resetControllers") {
        this.resetControllers();
        return;
      }
      if (data?.type !== "settings") return;
      const settings = data.settings;
      const requestedTransferMode = settings?.transferMode ?? settings?.mode;
      if (requestedTransferMode !== undefined) {
        this.targetSaturatedMix = sanitizeChaoticAmTransferMode(
          requestedTransferMode,
        ) === CHAOTIC_AM_TRANSFER_MODES.saturated ? 1 : 0;
      }
      this.target.carrierHz = clamp(
        settings?.carrierHz,
        CHAOTIC_AM_LIMITS.minCarrierHz,
        CHAOTIC_AM_LIMITS.maxCarrierHz,
        this.target.carrierHz,
      );
      this.target.startModFrequencyHz = clamp(
        settings?.startModFrequencyHz,
        CHAOTIC_AM_LIMITS.minModFrequencyHz,
        CHAOTIC_AM_LIMITS.maxModFrequencyHz,
        this.target.startModFrequencyHz,
      );
      this.target.frequencyDivisor = clamp(
        settings?.frequencyDivisor,
        CHAOTIC_AM_LIMITS.minFrequencyDivisor,
        CHAOTIC_AM_LIMITS.maxFrequencyDivisor,
        this.target.frequencyDivisor,
      );
      this.target.startAmplitudeIndex = clamp(
        settings?.startAmplitudeIndex,
        CHAOTIC_AM_LIMITS.minAmplitudeIndex,
        CHAOTIC_AM_LIMITS.maxAmplitudeIndex,
        this.target.startAmplitudeIndex,
      );
      this.target.indexDivisor = clamp(
        settings?.indexDivisor,
        CHAOTIC_AM_LIMITS.minIndexDivisor,
        CHAOTIC_AM_LIMITS.maxIndexDivisor,
        this.target.indexDivisor,
      );
      this.target.nonlinearity = clamp(
        settings?.nonlinearity,
        CHAOTIC_AM_LIMITS.minNonlinearity,
        CHAOTIC_AM_LIMITS.maxNonlinearity,
        this.target.nonlinearity,
      );
      this.target.depth = Math.round(clamp(
        settings?.depth,
        CHAOTIC_AM_LIMITS.minDepth,
        CHAOTIC_AM_LIMITS.maxDepth,
        this.target.depth,
      ));
      this.target.maximumFrequencyHz = clamp(
        settings?.maximumFrequencyHz,
        1,
        sampleRateLimit(this.processorSampleRate),
        this.target.maximumFrequencyHz,
      );
      if (data.immediate) {
        this.currentSaturatedMix = this.targetSaturatedMix;
        this.current.carrierHz = this.target.carrierHz;
        this.current.startModFrequencyHz = this.target.startModFrequencyHz;
        this.current.frequencyDivisor = this.target.frequencyDivisor;
        this.current.startAmplitudeIndex = this.target.startAmplitudeIndex;
        this.current.indexDivisor = this.target.indexDivisor;
        this.current.nonlinearity = this.target.nonlinearity;
        this.current.depth = this.target.depth;
        this.current.maximumFrequencyHz = this.target.maximumFrequencyHz;
        this.depthGains.fill(0);
        this.depthGains[this.target.depth] = 1;
      }
    };
  }

  sampleCount(milliseconds, minimum = 0) {
    return Math.max(
      minimum,
      Math.round(milliseconds * this.processorSampleRate / 1_000),
    );
  }

  setPerformance(parameters = {}) {
    const previousMode = this.playMode;
    const previousRootMidiNote = this.rootMidiNote;
    const previousPitchBendRange = this.pitchBendRangeSemitones;
    const safe = sanitizeChaoticAmPerformance({
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
    if (previousMode !== safe.playMode) this.allNotesOff(true);
    if (this.selectedNote >= 0 && safe.rootMidiNote !== previousRootMidiNote) {
      this.currentBaseSemitones = this.selectedNote - this.rootMidiNote;
      this.targetBaseSemitones = this.currentBaseSemitones;
      this.baseGlideDuration = 0;
    }
    if (safe.pitchBendRangeSemitones !== previousPitchBendRange) {
      this.beginBend(this.pitchBendNormalized * this.pitchBendRangeSemitones);
    }
  }

  newestEvent({ physicallyHeldOnly = false } = {}) {
    let newest = null;
    for (const event of this.noteEvents) {
      const eligible = event.held
        || (!physicallyHeldOnly && event.sustained);
      if (eligible && (!newest || event.order >= newest.order)) newest = event;
    }
    return newest;
  }

  newestNote({ physicallyHeldOnly = false } = {}) {
    return this.newestEvent({ physicallyHeldOnly })?.note ?? -1;
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

  selectNote(event, { legatoEligible = false, smoothVelocity = true } = {}) {
    this.selectedEventId = event.id;
    this.selectedNote = event.note;
    this.beginBasePitch(event.note, legatoEligible);
    this.targetVelocity = event.velocity;
    if (!smoothVelocity) this.currentVelocity = event.velocity;
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

  noteOn(noteValue, velocityValue, channelValue = 0, sourceIdValue = "default") {
    const note = Math.round(clamp(noteValue, 0, 127, 60));
    const velocity = Math.round(clamp(velocityValue, 0, 127, 0));
    const channel = Math.round(clamp(channelValue, 0, 15, 0));
    const sourceId = String(sourceIdValue ?? "default");
    if (velocity === 0) {
      this.noteOff(note, channel, sourceId);
      return;
    }
    const hadPhysicalNote = Boolean(this.newestEvent({ physicallyHeldOnly: true }));
    const voiceWasSustaining = this.selectedNote >= 0
      && this.envelopeStage !== 0
      && this.envelopeStage !== 4
      && this.envelopeStage !== 5;
    this.noteOrderCounter = (this.noteOrderCounter + 1) >>> 0;
    if (this.noteOrderCounter === 0) this.noteOrderCounter = 1;
    const event = {
      channel,
      held: true,
      id: this.noteOrderCounter,
      note,
      order: this.noteOrderCounter,
      sourceId,
      sustained: false,
      velocity: velocity / 127,
    };
    this.noteEvents.push(event);
    this.noteHeld[note] += 1;
    this.noteSustained[note] = 0;
    this.noteChannel[note] = channel;
    this.noteVelocity[note] = event.velocity;
    this.noteOrder[note] = event.order;
    this.selectNote(event, {
      legatoEligible: hadPhysicalNote,
      smoothVelocity: voiceWasSustaining,
    });
    if (!voiceWasSustaining) this.beginAttack();
  }

  noteOff(noteValue, channelValue = 0, sourceIdValue = "default") {
    const note = Math.round(clamp(noteValue, 0, 127, 60));
    const channel = Math.round(clamp(channelValue, 0, 15, 0));
    const sourceId = String(sourceIdValue ?? "default");
    const event = this.noteEvents.find((candidate) => (
      candidate.note === note
      && candidate.channel === channel
      && candidate.sourceId === sourceId
      && candidate.held
    ));
    if (!event) return;
    event.held = false;
    this.noteHeld[note] = Math.max(0, this.noteHeld[note] - 1);
    if (this.sustainDown) {
      event.sustained = true;
      this.noteSustained[note] += 1;
    } else {
      this.noteEvents = this.noteEvents.filter((candidate) => candidate !== event);
    }
    if (event.id !== this.selectedEventId) return;
    const fallback = this.newestEvent({ physicallyHeldOnly: true });
    if (fallback) {
      this.selectNote(fallback, { legatoEligible: true, smoothVelocity: true });
    } else if (!this.sustainDown) {
      this.selectedEventId = 0;
      this.selectedNote = -1;
      this.beginRelease();
    }
  }

  setSustain(down) {
    const next = Boolean(down);
    if (next === this.sustainDown) return;
    this.sustainDown = next;
    if (next) return;
    const selectedWasSustained = this.noteEvents.some(
      (event) => event.id === this.selectedEventId && event.sustained,
    );
    this.noteEvents = this.noteEvents.filter((event) => !event.sustained);
    this.noteSustained.fill(0);
    if (!selectedWasSustained && this.selectedNote >= 0) return;
    const fallback = this.newestEvent({ physicallyHeldOnly: true });
    if (fallback) {
      this.selectNote(fallback, { legatoEligible: true, smoothVelocity: true });
    } else if (this.selectedNote >= 0) {
      this.selectedEventId = 0;
      this.selectedNote = -1;
      this.beginRelease();
    }
  }

  clearNoteState() {
    this.noteHeld.fill(0);
    this.noteSustained.fill(0);
    this.noteEvents = [];
    this.selectedEventId = 0;
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
      // Preset and CC sustain edits must not step the gain of a held note.
      this.envelopeLevel += (this.ampSustainLevel - this.envelopeLevel) * this.sustainCoefficient;
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
    if (!this.active) return false;
    const channels = outputs[0] ?? [];
    const frameCount = channels[0]?.length ?? 128;
    const parameterCoefficient = 1 - Math.exp(
      -1 / (this.processorSampleRate * PARAMETER_SMOOTHING_SECONDS),
    );
    const depthCoefficient = 1 - Math.exp(
      -1 / (this.processorSampleRate * DEPTH_SMOOTHING_SECONDS),
    );
    const performanceCoefficient = 1 - Math.exp(
      -1 / (this.processorSampleRate * 0.006),
    );
    const modeStep = 1 / Math.max(
      1,
      this.processorSampleRate * DEPTH_SMOOTHING_SECONDS,
    );

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (this.currentSaturatedMix < this.targetSaturatedMix) {
        this.currentSaturatedMix = Math.min(
          this.targetSaturatedMix,
          this.currentSaturatedMix + modeStep,
        );
      } else if (this.currentSaturatedMix > this.targetSaturatedMix) {
        this.currentSaturatedMix = Math.max(
          this.targetSaturatedMix,
          this.currentSaturatedMix - modeStep,
        );
      }
      this.current.carrierHz += (
        this.target.carrierHz - this.current.carrierHz
      ) * parameterCoefficient;
      this.current.startModFrequencyHz += (
        this.target.startModFrequencyHz - this.current.startModFrequencyHz
      ) * parameterCoefficient;
      this.current.frequencyDivisor += (
        this.target.frequencyDivisor - this.current.frequencyDivisor
      ) * parameterCoefficient;
      this.current.startAmplitudeIndex += (
        this.target.startAmplitudeIndex - this.current.startAmplitudeIndex
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
      this.currentVelocity += (
        this.targetVelocity - this.currentVelocity
      ) * performanceCoefficient;
      this.currentExpression += (
        this.targetExpression - this.currentExpression
      ) * performanceCoefficient;
      const pitchRatio = this.playMode === "midi" ? this.advancePitch() : 1;
      const envelope = this.advanceEnvelope();
      this.carrierPhase += Math.min(
        this.current.maximumFrequencyHz,
        this.current.carrierHz * pitchRatio,
      ) / this.processorSampleRate;
      if (!Number.isFinite(this.carrierPhase)) this.carrierPhase = 0;
      this.carrierPhase -= Math.floor(this.carrierPhase);
      this.oscillatorSamples[0] = Math.sin(TWO_PI * this.carrierPhase);

      // Smooth the presence of each nested link rather than switching output
      // oscillators. All phases remain alive through depth and mode changes.
      let activeDepthWeight = 0;
      for (let depth = CHAOTIC_AM_LIMITS.maxDepth; depth >= 0; depth -= 1) {
        const targetGain = depth === this.target.depth ? 1 : 0;
        this.depthGains[depth] += (targetGain - this.depthGains[depth]) * depthCoefficient;
        activeDepthWeight += this.depthGains[depth];
        this.depthMix[depth] = activeDepthWeight;
      }
      let frequencyHz = this.current.startModFrequencyHz;
      let amplitudeIndex = this.current.startAmplitudeIndex;
      for (let turn = 0; turn < CHAOTIC_AM_LIMITS.maxDepth; turn += 1) {
        const pitchedFrequency = frequencyHz * pitchRatio;
        const safeFrequency = Math.min(this.current.maximumFrequencyHz, pitchedFrequency);
        this.operatorPhases[turn] += safeFrequency / this.processorSampleRate;
        this.operatorPhases[turn] -= Math.floor(this.operatorPhases[turn]);
        this.oscillatorSamples[turn + 1] = Math.sin(TWO_PI * this.operatorPhases[turn])
          * modulatorBandGain(pitchedFrequency, this.current.maximumFrequencyHz);
        this.linkDepths[turn] = chaoticAmModulationDepth(amplitudeIndex) * this.depthMix[turn + 1];
        frequencyHz /= this.current.frequencyDivisor;
        amplitudeIndex /= this.current.indexDivisor;
      }
      const warp = this.current.nonlinearity;
      const smoothDrive = 1 + warp * (MAX_SMOOTH_CHAOS_DRIVE - 1);
      const smoothNormalization = Math.tanh(smoothDrive);
      const saturatedDrive = 1 + warp * (MAX_SATURATED_CHAOS_DRIVE - 1);
      const saturatedNormalization = Math.tanh(saturatedDrive);
      const saturatedMix = this.currentSaturatedMix;
      this.signals[CHAOTIC_AM_LIMITS.maxDepth] = this.oscillatorSamples[CHAOTIC_AM_LIMITS.maxDepth];
      this.saturatedSignals[CHAOTIC_AM_LIMITS.maxDepth] = this.oscillatorSamples[CHAOTIC_AM_LIMITS.maxDepth];
      for (let turn = CHAOTIC_AM_LIMITS.maxDepth - 1; turn >= 0; turn -= 1) {
        const amount = this.linkDepths[turn];
        const carrier = this.oscillatorSamples[turn];
        if (saturatedMix < 1) {
          const next = this.signals[turn + 1];
          const shaped = Math.tanh(next * smoothDrive) / smoothNormalization;
          const modulator = next + (shaped - next) * warp;
          this.signals[turn] = carrier * (1 + amount * modulator) / (1 + amount);
        }
        if (saturatedMix > 0) {
          const next = this.saturatedSignals[turn + 1];
          const shaped = Math.tanh(next * saturatedDrive) / saturatedNormalization;
          const modulator = next + (shaped - next) * warp;
          this.saturatedSignals[turn] = carrier * (1 + amount * modulator) / (1 + amount);
        }
      }
      const mixed = saturatedMix <= 0 ? this.signals[0]
        : saturatedMix >= 1 ? this.saturatedSignals[0]
        : this.signals[0] + (this.saturatedSignals[0] - this.signals[0]) * saturatedMix;
      const performanceGain = this.playMode === "midi"
        ? envelope * this.currentVelocity * this.currentExpression
        : 1;
      const rendered = mixed * performanceGain;
      const sample = Number.isFinite(rendered) ? rendered : 0;
      for (let channel = 0; channel < channels.length; channel += 1) {
        channels[channel][frame] = sample;
      }
    }
    return true;
  }
}

if (typeof globalThis.registerProcessor === "function") {
  globalThis.registerProcessor(PROCESSOR_NAME, ChaoticAmProcessor);
}
