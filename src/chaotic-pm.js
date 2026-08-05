const PROCESSOR_NAME = "morphazoid-chaotic-pm";
const DEFAULT_SAMPLE_RATE = 48_000;
const PARAMETER_SMOOTHING_SECONDS = 0.018;
const DEPTH_SMOOTHING_SECONDS = 0.009;
const MAX_AUDIBLE_FREQUENCY = 20_000;
const MAX_SHAPER_INPUT = 64;
const MAX_SMOOTH_CHAOS_DRIVE = 9;
const TWO_PI = Math.PI * 2;

// The legacy transfer is asymmetric and can carry a substantial DC offset.
// Once the final operators are in the audio band, 18 Hz removes that bias
// without materially attenuating the playable bank.
export const CHAOTIC_PM_DC_BLOCKER_HZ = 18;

export const CHAOTIC_PM_TRANSFER_MODES = Object.freeze({
  smooth: "smooth",
  legacy: "legacy",
});

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

export const CHAOTIC_PM_PERFORMANCE_LIMITS = Object.freeze({
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
export const CHAOTIC_PM_PERFORMANCE_DEFAULTS = Object.freeze({
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

export const CHAOTIC_PM_PARAMETER_IDS = Object.freeze({
  transferMode: "synthesis.transferMode",
  depth: "synthesis.depth",
  carrierHz: "synthesis.carrierHz",
  startModFrequencyHz: "synthesis.startModFrequencyHz",
  frequencyDivisor: "synthesis.frequencyDivisor",
  startPhaseIndex: "synthesis.startPhaseIndex",
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
      transferMode: "legacy",
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
      transferMode: "legacy",
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
      transferMode: "legacy",
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
      transferMode: "legacy",
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
      transferMode: "legacy",
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
      transferMode: "legacy",
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
      transferMode: "legacy",
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
      transferMode: "legacy",
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
 * Playable calibrations of the recovered WIP bank. Frequencies keep every
 * selected final turn at 40–390 Hz, while the source nonlinearities now drive
 * a bounded continuous phase control instead of `nonlinearity * frequency²`.
 * IDs stay stable for the existing UI and saved links.
 */
export const CHAOTIC_PM_PRESETS = Object.freeze([
  freezePreset({
    id: "subzero-thread",
    label: "Subzero Thread",
    description: "A 60 Hz seed passes through 330 and 110 Hz turns, leaving a taut nonlinear thread.",
    settings: {
      transferMode: "smooth",
      depth: 2,
      carrierHz: 60,
      startModFrequencyHz: 330,
      frequencyDivisor: 3,
      startPhaseIndex: 0.625,
      indexDivisor: 6,
      nonlinearity: 0.34,
    },
  }),
  freezePreset({
    id: "forty-fold",
    label: "Forty Fold",
    description: "A 40 Hz phase shaper folds a 66.6 Hz carrier through a wide 6.66-radian index.",
    settings: {
      transferMode: "smooth",
      depth: 1,
      carrierHz: 66.6,
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
    description: "Four matched 180 Hz turns polish a 120 Hz seed into a steady glassy contour.",
    settings: {
      transferMode: "smooth",
      depth: 4,
      carrierHz: 120,
      startModFrequencyHz: 180,
      frequencyDivisor: 1,
      startPhaseIndex: 0.365,
      indexDivisor: 5.75,
      nonlinearity: 0.246,
    },
  }),
  freezePreset({
    id: "runaway-stair",
    label: "Runaway Stair",
    description: "Eight expanding turns climb from 52 Hz to 389.6 Hz while the phase index holds steady.",
    settings: {
      transferMode: "smooth",
      depth: 8,
      carrierHz: 52,
      startModFrequencyHz: 52,
      frequencyDivisor: 0.75,
      startPhaseIndex: 0.625,
      indexDivisor: 1,
      nonlinearity: 0.666,
    },
  }),
  freezePreset({
    id: "braided-orbit",
    label: "Braided Orbit",
    description: "Five equal 114 Hz turns braid a 141 Hz seed through rapidly shrinking indices.",
    settings: {
      transferMode: "smooth",
      depth: 5,
      carrierHz: 141,
      startModFrequencyHz: 114,
      frequencyDivisor: 1,
      startPhaseIndex: 0.864,
      indexDivisor: 6.75,
      nonlinearity: 0.41,
    },
  }),
  freezePreset({
    id: "low-ember",
    label: "Low Ember",
    description: "Four descending turns fall from 320 Hz to a warm 40 Hz terminal ember.",
    settings: {
      transferMode: "smooth",
      depth: 4,
      carrierHz: 96,
      startModFrequencyHz: 320,
      frequencyDivisor: 2,
      startPhaseIndex: 0.5,
      indexDivisor: 7,
      nonlinearity: 0.9,
    },
  }),
  freezePreset({
    id: "kilohertz-veil",
    label: "Kilohertz Veil",
    description: "A 1 kHz seed hangs above four descending turns that resolve at 106.7 Hz.",
    settings: {
      transferMode: "smooth",
      depth: 4,
      carrierHz: 1_000,
      startModFrequencyHz: 360,
      frequencyDivisor: 1.5,
      startPhaseIndex: 13.5,
      indexDivisor: 6.75,
      nonlinearity: 0.13,
    },
  }),
  freezePreset({
    id: "chrome-cascade",
    label: "Chrome Cascade",
    description: "Six turns descend from 400 Hz to 131.1 Hz through a restrained 3.25-radian cascade.",
    settings: {
      transferMode: "smooth",
      depth: 6,
      carrierHz: 144,
      startModFrequencyHz: 400,
      frequencyDivisor: 1.25,
      startPhaseIndex: 3.25,
      indexDivisor: 1.5,
      nonlinearity: 0.279,
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

function sanitizeChaoticPmTransferMode(value) {
  const mode = String(value ?? CHAOTIC_PM_TRANSFER_MODES.smooth).toLowerCase();
  return mode === "legacy" || mode === "raw"
    ? CHAOTIC_PM_TRANSFER_MODES.legacy
    : CHAOTIC_PM_TRANSFER_MODES.smooth;
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
    transferMode: sanitizeChaoticPmTransferMode(
      settingValue(
        params,
        "transferMode",
        "mode",
        CHAOTIC_PM_DEFAULTS.transferMode,
      ),
    ),
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

export function sanitizeChaoticPmPerformance(params = {}) {
  const playMode = String(
    params.playMode ?? CHAOTIC_PM_PERFORMANCE_DEFAULTS.playMode,
  ).toLowerCase();
  const glideMode = String(
    params.glideMode ?? CHAOTIC_PM_PERFORMANCE_DEFAULTS.glideMode,
  ).toLowerCase();
  return Object.freeze({
    playMode: PLAY_MODES.has(playMode)
      ? playMode
      : CHAOTIC_PM_PERFORMANCE_DEFAULTS.playMode,
    rootMidiNote: Math.round(clamp(
      params.rootMidiNote,
      CHAOTIC_PM_PERFORMANCE_LIMITS.minRootMidiNote,
      CHAOTIC_PM_PERFORMANCE_LIMITS.maxRootMidiNote,
      CHAOTIC_PM_PERFORMANCE_DEFAULTS.rootMidiNote,
    )),
    pitchBendRangeSemitones: clamp(
      params.pitchBendRangeSemitones,
      CHAOTIC_PM_PERFORMANCE_LIMITS.minPitchBendRangeSemitones,
      CHAOTIC_PM_PERFORMANCE_LIMITS.maxPitchBendRangeSemitones,
      CHAOTIC_PM_PERFORMANCE_DEFAULTS.pitchBendRangeSemitones,
    ),
    ampAttackMs: clamp(
      params.ampAttackMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.minAmpAttackMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.maxAmpAttackMs,
      CHAOTIC_PM_PERFORMANCE_DEFAULTS.ampAttackMs,
    ),
    ampDecayMs: clamp(
      params.ampDecayMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.minAmpDecayMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.maxAmpDecayMs,
      CHAOTIC_PM_PERFORMANCE_DEFAULTS.ampDecayMs,
    ),
    ampSustainLevel: clamp(
      params.ampSustainLevel,
      0,
      1,
      CHAOTIC_PM_PERFORMANCE_DEFAULTS.ampSustainLevel,
    ),
    ampReleaseMs: clamp(
      params.ampReleaseMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.minAmpReleaseMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.maxAmpReleaseMs,
      CHAOTIC_PM_PERFORMANCE_DEFAULTS.ampReleaseMs,
    ),
    glideTimeMs: clamp(
      params.glideTimeMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.minGlideTimeMs,
      CHAOTIC_PM_PERFORMANCE_LIMITS.maxGlideTimeMs,
      CHAOTIC_PM_PERFORMANCE_DEFAULTS.glideTimeMs,
    ),
    glideMode: GLIDE_MODES.has(glideMode)
      ? glideMode
      : CHAOTIC_PM_PERFORMANCE_DEFAULTS.glideMode,
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
export function chaoticPmFactoryControlChange(controller, value) {
  const cc = midiByte([controller], 0);
  const safeValue = midiByte([value], 0);
  if (cc === 5) {
    return {
      type: "parameter",
      key: "glideTimeMs",
      parameterId: CHAOTIC_PM_PARAMETER_IDS.glideTimeMs,
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
      parameterId: CHAOTIC_PM_PARAMETER_IDS.ampReleaseMs,
      value: geometricMidiValue(safeValue, 2, 10_000),
    };
  }
  if (cc === 73) {
    return {
      type: "parameter",
      key: "ampAttackMs",
      parameterId: CHAOTIC_PM_PARAMETER_IDS.ampAttackMs,
      value: geometricMidiValue(safeValue, 0.5, 5_000, { zero: true }),
    };
  }
  if (cc === 75) {
    return {
      type: "parameter",
      key: "ampDecayMs",
      parameterId: CHAOTIC_PM_PARAMETER_IDS.ampDecayMs,
      value: geometricMidiValue(safeValue, 1, 5_000, { zero: true }),
    };
  }
  if (cc === 120) return { type: "allSoundOff" };
  if (cc === 121) return { type: "resetControllers" };
  if (cc === 123) return { type: "allNotesOff" };
  return null;
}

export function decodeChaoticPmMidiMessage(data) {
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

function dispatchChaoticPmMidiAction(target, action) {
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
export class ChaoticPmWebMidi {
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
      dispatchChaoticPmMidiAction(this.target, action);
      this.onAction?.(action, null);
    }
    this.notifyStatus();
  }

  handleMessage(event) {
    const decoded = decodeChaoticPmMidiMessage(event?.data);
    if (!decoded) return null;
    const action = event?.sourceId === undefined
      ? decoded
      : Object.freeze({ ...decoded, sourceId: String(event.sourceId) });
    dispatchChaoticPmMidiAction(this.target, action);
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

function normalizedOutputGain(settings, actualDepth) {
  if (settings.transferMode === CHAOTIC_PM_TRANSFER_MODES.smooth) {
    // Smooth mode is centered and already bounded by the final sine. A small
    // depth allowance leaves headroom while two depth taps crossfade.
    return clamp(0.52 / Math.sqrt(1 + actualDepth * 0.025), 0.4, 0.52, 0.48);
  }
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
 * Unroll either the continuous production graph or the recovered raw graph.
 *
 *   carrier = sin(TAU * carrierPhasor)
 *   smooth = sin(TAU * operatorPhasor[n]
 *                + phaseIndexRadians[n] * nonlinear(previous))
 *   legacy = sin(TAU * (1.2 - sqrt(nonlinearity))
 *                * tanh(((phasor + previous * indexCycles) % 1)
 *                  * nonlinearity * operatorFrequency[n]^2))
 *
 * Smooth mode is periodic at the phasor boundary. Legacy mode deliberately
 * preserves the source experiment's discontinuous signed remainder.
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
  const legacy = settings.transferMode === CHAOTIC_PM_TRANSFER_MODES.legacy;
  const gain = legacy ? 1.2 - Math.sqrt(settings.nonlinearity) : 1;
  const smoothDrive = 1
    + settings.nonlinearity * (MAX_SMOOTH_CHAOS_DRIVE - 1);

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
      drive: legacy
        ? settings.nonlinearity * frequencyHz * frequencyHz
        : smoothDrive,
      legacyDrive: settings.nonlinearity * frequencyHz * frequencyHz,
      phaseIndexUnit: legacy ? "cycles" : "radians",
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
 * Evaluate one continuous Chaotic PM turn. The previous operator is shaped as
 * a bounded control signal, then applied inside a conventional periodic PM
 * oscillator. At zero nonlinearity this is ordinary recursive PM.
 */
export function smoothChaoticPmTurnSample(
  previousSignal,
  basePhase,
  _modFrequencyHz,
  phaseIndexRadians,
  nonlinearity,
) {
  const previous = clamp(previousSignal, -1, 1, 0);
  const phase = finiteNumber(basePhase, 0);
  const indexRadians = clamp(
    phaseIndexRadians,
    0,
    CHAOTIC_PM_LIMITS.maxInternalPhaseIndex,
    0,
  );
  const chaos = clamp(
    nonlinearity,
    CHAOTIC_PM_LIMITS.minNonlinearity,
    CHAOTIC_PM_LIMITS.maxNonlinearity,
    0,
  );
  const drive = 1 + chaos * (MAX_SMOOTH_CHAOS_DRIVE - 1);
  const shaped = Math.tanh(previous * drive) / Math.tanh(drive);
  const modulator = previous + (shaped - previous) * chaos;
  const sample = Math.sin(TWO_PI * phase + indexRadians * modulator);
  return Number.isFinite(sample) ? sample : 0;
}

/**
 * Evaluate one exact Legacy/Raw turn. JavaScript remainder semantics are
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
    this.performance = { ...CHAOTIC_PM_PERFORMANCE_DEFAULTS };
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
    const stack = deriveChaoticPmStack(settings, { sampleRate: this.sampleRate });
    this.pendingSettings = {
      transferMode: stack.settings.transferMode,
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
        transferMode: stack.settings.transferMode,
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

  setPerformanceParameters(params = {}) {
    this.performance = { ...sanitizeChaoticPmPerformance({
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
    const action = chaoticPmFactoryControlChange(controller, value);
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
    this.legacySignals = new Float64Array(CHAOTIC_PM_LIMITS.maxDepth + 1);
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
    this.currentLegacyMix = defaults.transferMode
      === CHAOTIC_PM_TRANSFER_MODES.legacy ? 1 : 0;
    this.targetLegacyMix = this.currentLegacyMix;
    this.depthGains[defaults.depth] = 1;

    const performance = sanitizeChaoticPmPerformance();
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
        this.targetLegacyMix = sanitizeChaoticPmTransferMode(
          requestedTransferMode,
        ) === CHAOTIC_PM_TRANSFER_MODES.legacy ? 1 : 0;
      }
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
        this.currentLegacyMix = this.targetLegacyMix;
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
    const safe = sanitizeChaoticPmPerformance({
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
      if (this.currentLegacyMix < this.targetLegacyMix) {
        this.currentLegacyMix = Math.min(
          this.targetLegacyMix,
          this.currentLegacyMix + modeStep,
        );
      } else if (this.currentLegacyMix > this.targetLegacyMix) {
        this.currentLegacyMix = Math.max(
          this.targetLegacyMix,
          this.currentLegacyMix - modeStep,
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
      this.signals[0] = Math.sin(TWO_PI * this.carrierPhase);
      this.legacySignals[0] = this.signals[0];

      let frequencyHz = this.current.startModFrequencyHz;
      let phaseIndex = this.current.startPhaseIndex;
      let availableDepth = 0;
      const warp = clamp(this.current.nonlinearity, 0, 1, 0);
      const smoothDrive = 1 + warp * (MAX_SMOOTH_CHAOS_DRIVE - 1);
      const smoothNormalization = Math.tanh(smoothDrive);
      const legacyMix = this.currentLegacyMix;

      for (let turn = 0; turn < CHAOTIC_PM_LIMITS.maxDepth; turn += 1) {
        if (!Number.isFinite(frequencyHz)
          || frequencyHz >= this.current.maximumFrequencyHz) {
          break;
        }
        this.operatorPhases[turn] += Math.min(
          this.current.maximumFrequencyHz,
          Math.max(0, frequencyHz * pitchRatio),
        ) / this.processorSampleRate;
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
        let smoothNext = 0;
        if (legacyMix < 1) {
          const previous = this.signals[turn];
          const shaped = Math.tanh(previous * smoothDrive)
            / smoothNormalization;
          const modulator = previous + (shaped - previous) * warp;
          smoothNext = Math.sin(
            TWO_PI * this.operatorPhases[turn] + safeIndex * modulator,
          );
          this.signals[turn + 1] = Number.isFinite(smoothNext)
            ? smoothNext
            : 0;
        }
        if (legacyMix > 0) {
          const previous = this.legacySignals[turn];
          const wrappedPhase = (
            this.operatorPhases[turn] + previous * safeIndex
          ) % 1;
          const legacyDrive = warp * frequencyHz * frequencyHz;
          const shaperInput = clamp(
            wrappedPhase * legacyDrive,
            -MAX_SHAPER_INPUT,
            MAX_SHAPER_INPUT,
            0,
          );
          const legacyGain = 1.2 - Math.sqrt(warp);
          const legacyNext = Math.sin(
            TWO_PI * Math.tanh(shaperInput) * legacyGain,
          );
          this.legacySignals[turn + 1] = Number.isFinite(legacyNext)
            ? legacyNext
            : 0;
        }
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
        let depthSignal = this.signals[depth];
        if (legacyMix >= 1) {
          depthSignal = this.legacySignals[depth];
        } else if (legacyMix > 0) {
          depthSignal += (
            this.legacySignals[depth] - depthSignal
          ) * legacyMix;
        }
        mixed += depthSignal * this.depthGains[depth];
      }
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
  globalThis.registerProcessor(PROCESSOR_NAME, ChaoticPmProcessor);
}
