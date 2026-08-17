const DEFAULT_SAMPLE_RATE = 48_000;

export const RECURSIVE_FM_LIMITS = Object.freeze({
  minDepth: 0,
  maxDepth: 10,
  minCarrierHz: 0.01,
  maxCarrierHz: 4_800,
  maxOffsetHz: 12_000,
  maxModulationHz: 12_000,
  minDivisor: 0.001,
  maxDivisor: 8,
});

export const RECURSIVE_FM_PERFORMANCE_LIMITS = Object.freeze({
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

export const RECURSIVE_FM_PARAMETER_IDS = Object.freeze({
  depth: "synthesis.depth",
  carrierHz: "synthesis.carrierHz",
  offsetHz: "synthesis.offsetHz",
  modulationHz: "synthesis.modulationHz",
  divisor: "synthesis.divisor",
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

export const RECURSIVE_FM_PERFORMANCE_DEFAULTS = Object.freeze({
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

const RECURSIVE_FM_PLAY_MODES = new Set(["drone", "midi"]);
const RECURSIVE_FM_GLIDE_MODES = new Set(["off", "legato", "always"]);

const freezePreset = (preset) => Object.freeze({
  ...preset,
  settings: Object.freeze({ ...preset.settings }),
});

/**
 * The six parameter sets from the original Morphisma Recursive FM experiment.
 * Names and descriptions are new; the synthesis values are preserved exactly.
 */
export const RECURSIVE_FM_PRESETS = Object.freeze([
  freezePreset({
    id: "seed-pulse",
    label: "Seed Pulse",
    description: "The unrolled seed: one slow carrier and one wide frequency sweep.",
    settings: {
      depth: 0,
      carrierHz: 1,
      offsetHz: 0,
      modulationHz: 500,
      divisor: 2,
    },
  }),
  freezePreset({
    id: "deep-well",
    label: "Deep Well",
    description: "The original default: three descending layers around a 3.32 Hz seed.",
    settings: {
      depth: 3,
      carrierHz: 3.32,
      offsetHz: 0,
      modulationHz: 7_307,
      divisor: 3.68,
    },
  }),
  freezePreset({
    id: "glass-lattice",
    label: "Glass Lattice",
    description: "A high offset turns the recursive stack into a bright, close-spaced lattice.",
    settings: {
      depth: 3,
      carrierHz: 5.25,
      offsetHz: 5_057,
      modulationHz: 6_508,
      divisor: 5.56,
    },
  }),
  freezePreset({
    id: "undertow",
    label: "Undertow",
    description: "A near-static seed and a divisor below one make each inner turn wider.",
    settings: {
      depth: 3,
      carrierHz: 0.06,
      offsetHz: 0,
      modulationHz: 1_650,
      divisor: 0.18,
    },
  }),
  freezePreset({
    id: "high-window",
    label: "High Window",
    description: "A 4 kHz offset with slowly unfolding recursive sidebands.",
    settings: {
      depth: 3,
      carrierHz: 0.18,
      offsetHz: 4_000,
      modulationHz: 4_236,
      divisor: 1.53,
    },
  }),
  freezePreset({
    id: "bent-brass",
    label: "Bent Brass",
    description: "A rising recursive amount gives this preset its dense metallic bend.",
    settings: {
      depth: 3,
      carrierHz: 7,
      offsetHz: 2_000,
      modulationHz: 2_340,
      divisor: 0.75,
    },
  }),
]);

export const DEFAULT_RECURSIVE_FM_PRESET_ID = "deep-well";

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safePerformanceNumber(value, fallback, minimum, maximum) {
  return clamp(finiteNumber(value, fallback), minimum, maximum);
}

export function sanitizeRecursiveFmPerformance(settings = {}) {
  const playMode = String(
    settings.playMode ?? RECURSIVE_FM_PERFORMANCE_DEFAULTS.playMode,
  ).toLowerCase();
  const glideMode = String(
    settings.glideMode ?? RECURSIVE_FM_PERFORMANCE_DEFAULTS.glideMode,
  ).toLowerCase();
  return Object.freeze({
    playMode: RECURSIVE_FM_PLAY_MODES.has(playMode)
      ? playMode
      : RECURSIVE_FM_PERFORMANCE_DEFAULTS.playMode,
    rootMidiNote: Math.round(safePerformanceNumber(
      settings.rootMidiNote,
      RECURSIVE_FM_PERFORMANCE_DEFAULTS.rootMidiNote,
      RECURSIVE_FM_PERFORMANCE_LIMITS.minRootMidiNote,
      RECURSIVE_FM_PERFORMANCE_LIMITS.maxRootMidiNote,
    )),
    pitchBendRangeSemitones: safePerformanceNumber(
      settings.pitchBendRangeSemitones,
      RECURSIVE_FM_PERFORMANCE_DEFAULTS.pitchBendRangeSemitones,
      RECURSIVE_FM_PERFORMANCE_LIMITS.minPitchBendRangeSemitones,
      RECURSIVE_FM_PERFORMANCE_LIMITS.maxPitchBendRangeSemitones,
    ),
    ampAttackMs: safePerformanceNumber(
      settings.ampAttackMs,
      RECURSIVE_FM_PERFORMANCE_DEFAULTS.ampAttackMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.minAmpAttackMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.maxAmpAttackMs,
    ),
    ampDecayMs: safePerformanceNumber(
      settings.ampDecayMs,
      RECURSIVE_FM_PERFORMANCE_DEFAULTS.ampDecayMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.minAmpDecayMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.maxAmpDecayMs,
    ),
    ampSustainLevel: safePerformanceNumber(
      settings.ampSustainLevel,
      RECURSIVE_FM_PERFORMANCE_DEFAULTS.ampSustainLevel,
      0,
      1,
    ),
    ampReleaseMs: safePerformanceNumber(
      settings.ampReleaseMs,
      RECURSIVE_FM_PERFORMANCE_DEFAULTS.ampReleaseMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.minAmpReleaseMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.maxAmpReleaseMs,
    ),
    glideTimeMs: safePerformanceNumber(
      settings.glideTimeMs,
      RECURSIVE_FM_PERFORMANCE_DEFAULTS.glideTimeMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.minGlideTimeMs,
      RECURSIVE_FM_PERFORMANCE_LIMITS.maxGlideTimeMs,
    ),
    glideMode: RECURSIVE_FM_GLIDE_MODES.has(glideMode)
      ? glideMode
      : RECURSIVE_FM_PERFORMANCE_DEFAULTS.glideMode,
  });
}

function midiByte(data, index) {
  return Math.round(clamp(finiteNumber(data?.[index], 0), 0, 127));
}

function geometricMidiValue(value, minimum, maximum, { zero = false } = {}) {
  const safeValue = midiByte([value], 0);
  if (zero && safeValue === 0) return 0;
  const position = zero ? (safeValue - 1) / 126 : safeValue / 127;
  return minimum * ((maximum / minimum) ** position);
}

export function recursiveFmFactoryControlChange(controller, value) {
  const cc = midiByte([controller], 0);
  const safeValue = midiByte([value], 0);
  if (cc === 5) {
    return {
      type: "parameter",
      key: "glideTimeMs",
      parameterId: RECURSIVE_FM_PARAMETER_IDS.glideTimeMs,
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
      parameterId: RECURSIVE_FM_PARAMETER_IDS.ampReleaseMs,
      value: geometricMidiValue(safeValue, 2, 10_000),
    };
  }
  if (cc === 73) {
    return {
      type: "parameter",
      key: "ampAttackMs",
      parameterId: RECURSIVE_FM_PARAMETER_IDS.ampAttackMs,
      value: geometricMidiValue(safeValue, 0.5, 5_000, { zero: true }),
    };
  }
  if (cc === 75) {
    return {
      type: "parameter",
      key: "ampDecayMs",
      parameterId: RECURSIVE_FM_PARAMETER_IDS.ampDecayMs,
      value: geometricMidiValue(safeValue, 1, 5_000, { zero: true }),
    };
  }
  if (cc === 120) return { type: "allSoundOff" };
  if (cc === 121) return { type: "resetControllers" };
  if (cc === 123) return { type: "allNotesOff" };
  return null;
}

export function decodeRecursiveFmMidiMessage(data) {
  if (!data || data.length < 1) return null;
  const status = Math.round(clamp(finiteNumber(data[0], 0), 0, 255));
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
  if (command === 0xb0) {
    return { type: "controlChange", controller: data1, value: data2, channel };
  }
  return null;
}

function dispatchRecursiveFmMidiAction(target, action) {
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

/**
 * Permission-conscious Web MIDI adapter. Construction is inert; only enable()
 * requests access, and it explicitly declines SysEx permission.
 */
export class RecursiveFmWebMidi {
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
    this.pendingEnable = null;
    this.lifecycleGeneration = 0;
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
    if (this.pendingEnable) return this.pendingEnable;
    const generation = this.lifecycleGeneration;
    const pending = this.runtime.navigator.requestMIDIAccess({ sysex: false })
      .then((access) => {
        if (generation !== this.lifecycleGeneration) return null;
        this.access = access;
        if (typeof access.addEventListener === "function") {
          access.addEventListener("statechange", this.boundStateChange);
        } else {
          access.onstatechange = this.boundStateChange;
        }
        this.refreshInputs();
        return access;
      });
    this.pendingEnable = pending;
    try {
      return await pending;
    } finally {
      if (this.pendingEnable === pending) this.pendingEnable = null;
    }
  }

  refreshInputs() {
    const available = new Set();
    let inputDisconnected = false;
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
      inputDisconnected = true;
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
    if (inputDisconnected) {
      const action = Object.freeze({
        type: "controlChange",
        controller: 120,
        value: 0,
        channel: 0,
        synthetic: true,
        reason: "input-disconnected",
      });
      dispatchRecursiveFmMidiAction(this.target, action);
      this.onAction?.(action, { synthetic: true });
    }
    this.notifyStatus();
  }

  handleMessage(event) {
    const decoded = decodeRecursiveFmMidiMessage(event?.data);
    if (!decoded) return null;
    const action = event?.sourceId === undefined
      ? decoded
      : Object.freeze({ ...decoded, sourceId: String(event.sourceId) });
    dispatchRecursiveFmMidiAction(this.target, action);
    this.onAction?.(action, event);
    return action;
  }

  close() {
    this.lifecycleGeneration += 1;
    this.pendingEnable = null;
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

/**
 * Platform-neutral monophonic last-note-priority state. Returned actions let
 * the browser engine schedule pitch and amplitude without embedding DOM or
 * AudioParam behavior in the MIDI contract.
 */
export class RecursiveFmMonophonicState {
  constructor() {
    this.noteHeld = new Uint32Array(128);
    this.noteSustained = new Uint32Array(128);
    this.noteVelocity = new Float64Array(128);
    this.noteOrder = new Uint32Array(128);
    this.noteOrderCounter = 0;
    this.noteEvents = [];
    this.selectedEventId = 0;
    this.selectedNote = -1;
    this.sustainDown = false;
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

  selection(event, { legatoEligible = false, retrigger = false } = {}) {
    this.selectedEventId = event.id;
    this.selectedNote = event.note;
    return Object.freeze({
      type: "select",
      note: event.note,
      velocity: event.velocity,
      legatoEligible,
      retrigger,
    });
  }

  noteOn(noteValue, velocityValue, ownerValue = 0) {
    const note = Math.round(clamp(finiteNumber(noteValue, 60), 0, 127));
    const velocity = Math.round(clamp(finiteNumber(velocityValue, 0), 0, 127));
    const owner = String(ownerValue ?? "default");
    if (velocity === 0) return this.noteOff(note, owner);
    const hadPhysicalNote = Boolean(this.newestEvent({ physicallyHeldOnly: true }));
    const voiceWasActive = this.selectedNote >= 0;
    this.noteOrderCounter = (this.noteOrderCounter + 1) >>> 0;
    if (this.noteOrderCounter === 0) this.noteOrderCounter = 1;
    const event = {
      held: true,
      id: this.noteOrderCounter,
      note,
      order: this.noteOrderCounter,
      owner,
      sustained: false,
      velocity: velocity / 127,
    };
    this.noteEvents.push(event);
    this.noteHeld[note] += 1;
    this.noteVelocity[note] = event.velocity;
    this.noteOrder[note] = this.noteOrderCounter;
    return this.selection(event, {
      legatoEligible: hadPhysicalNote,
      retrigger: !voiceWasActive,
    });
  }

  noteOff(noteValue, ownerValue = 0) {
    const note = Math.round(clamp(finiteNumber(noteValue, 60), 0, 127));
    const owner = String(ownerValue ?? "default");
    const event = this.noteEvents.find(
      (candidate) => (
        candidate.note === note
        && candidate.owner === owner
        && candidate.held
      ),
    );
    if (!event) return null;
    event.held = false;
    this.noteHeld[note] = Math.max(0, this.noteHeld[note] - 1);
    if (this.sustainDown) {
      event.sustained = true;
      this.noteSustained[note] += 1;
    } else {
      this.noteEvents = this.noteEvents.filter((candidate) => candidate !== event);
    }
    if (event.id !== this.selectedEventId) return null;
    const fallback = this.newestEvent({ physicallyHeldOnly: true });
    if (fallback) {
      return this.selection(fallback, { legatoEligible: true });
    }
    if (this.sustainDown) return null;
    this.selectedEventId = 0;
    this.selectedNote = -1;
    return Object.freeze({ type: "release", hard: false });
  }

  setSustain(down) {
    const next = Boolean(down);
    if (next === this.sustainDown) return null;
    this.sustainDown = next;
    if (next) return null;
    const selectedWasSustained = this.noteEvents.some(
      (event) => event.id === this.selectedEventId && event.sustained,
    );
    this.noteEvents = this.noteEvents.filter((event) => !event.sustained);
    this.noteSustained.fill(0);
    if (!selectedWasSustained && this.selectedNote >= 0) return null;
    const fallback = this.newestEvent({ physicallyHeldOnly: true });
    if (fallback) {
      return this.selection(fallback, { legatoEligible: true });
    }
    if (this.selectedNote < 0) return null;
    this.selectedEventId = 0;
    this.selectedNote = -1;
    return Object.freeze({ type: "release", hard: false });
  }

  allNotesOff({ hard = false } = {}) {
    this.noteHeld.fill(0);
    this.noteSustained.fill(0);
    this.noteEvents = [];
    this.selectedEventId = 0;
    this.selectedNote = -1;
    if (hard) this.sustainDown = false;
    return Object.freeze({ type: "release", hard: Boolean(hard) });
  }
}

export function recursiveFmPitchRatio(
  note,
  rootMidiNote = RECURSIVE_FM_PERFORMANCE_DEFAULTS.rootMidiNote,
  pitchBendNormalized = 0,
  pitchBendRangeSemitones = RECURSIVE_FM_PERFORMANCE_DEFAULTS.pitchBendRangeSemitones,
) {
  const safeNote = clamp(finiteNumber(note, rootMidiNote), 0, 127);
  const safeRoot = clamp(finiteNumber(rootMidiNote, 60), 0, 127);
  const safeBend = clamp(finiteNumber(pitchBendNormalized, 0), -1, 1);
  const safeRange = clamp(finiteNumber(pitchBendRangeSemitones, 2), 0, 24);
  return 2 ** ((safeNote - safeRoot + safeBend * safeRange) / 12);
}

/**
 * Bound MIDI transposition with one ratio for the complete operator graph.
 * Each oscillator can reach bias +/- modulation, so abs(bias) +
 * abs(modulation) is its conservative peak instantaneous frequency.
 */
export function deriveRecursiveFmSafePitchRatio(stack, requestedRatio = 1) {
  const model = stack?.operators ? stack : deriveRecursiveFmStack(stack);
  const desired = finiteNumber(requestedRatio, 1);
  const positiveRatio = desired > 0 ? desired : 1;
  const peakExcursionHz = model.operators.reduce(
    (peak, operator) => Math.max(
      peak,
      Math.abs(operator.biasHz) + Math.abs(operator.modulationHz),
    ),
    0,
  );
  if (peakExcursionHz <= 0) return positiveRatio;
  return Math.min(
    positiveRatio,
    model.settings.maximumFrequencyHz / peakExcursionHz,
  );
}

function sampleRateLimit(sampleRate) {
  const safeSampleRate = clamp(
    finiteNumber(sampleRate, DEFAULT_SAMPLE_RATE),
    8_000,
    192_000,
  );
  return Math.min(20_000, safeSampleRate * 0.45);
}

function legacyValue(settings, currentName, legacyName, fallback) {
  return settings?.[currentName] ?? settings?.[legacyName] ?? fallback;
}

/**
 * Sanitize UI, preset, or legacy values before they reach an AudioParam.
 * The first modulated oscillator spans offset → offset + modulation, so its
 * modulation range is also restricted by the available frequency headroom.
 */
export function sanitizeRecursiveFmSettings(
  settings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const maximumFrequencyHz = sampleRateLimit(sampleRate);
  const depth = clamp(
    Math.round(finiteNumber(
      legacyValue(settings, "depth", "steps", 3),
      3,
    )),
    RECURSIVE_FM_LIMITS.minDepth,
    RECURSIVE_FM_LIMITS.maxDepth,
  );
  const carrierHz = clamp(
    finiteNumber(
      legacyValue(settings, "carrierHz", "carrierFreq", 3.32),
      3.32,
    ),
    RECURSIVE_FM_LIMITS.minCarrierHz,
    Math.min(RECURSIVE_FM_LIMITS.maxCarrierHz, maximumFrequencyHz),
  );
  const offsetHz = clamp(
    finiteNumber(
      legacyValue(settings, "offsetHz", "offset", 0),
      0,
    ),
    0,
    Math.min(RECURSIVE_FM_LIMITS.maxOffsetHz, maximumFrequencyHz),
  );
  const modulationCeiling = Math.min(
    RECURSIVE_FM_LIMITS.maxModulationHz,
    Math.max(0, maximumFrequencyHz - offsetHz),
  );
  const modulationHz = clamp(
    finiteNumber(
      legacyValue(settings, "modulationHz", "modAmp", 7_307),
      7_307,
    ),
    0,
    modulationCeiling,
  );
  const divisor = clamp(
    finiteNumber(
      legacyValue(settings, "divisor", "modAmpDiv", 3.68),
      3.68,
    ),
    RECURSIVE_FM_LIMITS.minDivisor,
    RECURSIVE_FM_LIMITS.maxDivisor,
  );

  return Object.freeze({
    depth,
    carrierHz,
    offsetHz,
    modulationHz,
    divisor,
    maximumFrequencyHz,
  });
}

function normalizedOutputGain(settings) {
  const depthPressure = 1 + settings.depth * 0.055;
  const frequencyPressure = 1 + (
    settings.modulationHz / Math.max(1, settings.maximumFrequencyHz)
  ) * 0.18;
  return clamp(0.38 / Math.sqrt(depthPressure * frequencyPressure), 0.2, 0.38);
}

function freezeOperator(operator) {
  return Object.freeze(operator);
}

/**
 * Derive the bounded operator graph corresponding to the legacy Elementary
 * Audio expression:
 *
 *   carrier → cycle(offset + amount/2 + carrier × amount/2)
 *           → cycle(previous × amount/2)
 *           → cycle(previous × amount/2/divisor) …
 *
 * Only the final selected operator is audible; earlier operators modulate it.
 */
export function deriveRecursiveFmStack(
  settings = {},
  { sampleRate = DEFAULT_SAMPLE_RATE } = {},
) {
  const safe = sanitizeRecursiveFmSettings(settings, { sampleRate });
  const operators = [
    freezeOperator({
      index: 0,
      sourceIndex: null,
      kind: "carrier",
      biasHz: safe.carrierHz,
      modulationHz: 0,
    }),
    freezeOperator({
      index: 1,
      sourceIndex: 0,
      kind: "offset-operator",
      biasHz: safe.offsetHz + safe.modulationHz / 2,
      modulationHz: safe.modulationHz / 2,
    }),
  ];

  let recursiveAmount = safe.modulationHz / 2;
  for (let turn = 0; turn < safe.depth; turn += 1) {
    operators.push(freezeOperator({
      index: operators.length,
      sourceIndex: operators.length - 1,
      kind: "recursive-operator",
      biasHz: 0,
      modulationHz: Math.min(safe.maximumFrequencyHz, recursiveAmount),
      turn: turn + 1,
    }));
    recursiveAmount = Math.min(
      safe.maximumFrequencyHz,
      recursiveAmount / safe.divisor,
    );
  }

  return Object.freeze({
    settings: safe,
    operators: Object.freeze(operators),
    audibleIndex: operators.length - 1,
    normalizedGain: normalizedOutputGain(safe),
  });
}

export function summarizeRecursiveFmStack(stack) {
  const model = stack?.operators ? stack : deriveRecursiveFmStack(stack);
  const recursiveTurns = model.settings.depth;
  return Object.freeze({
    recursiveTurns,
    operatorCount: model.operators.length,
    audibleIndex: model.audibleIndex,
    label: `${recursiveTurns} ${recursiveTurns === 1 ? "recursion" : "recursions"} · ${model.operators.length} operators`,
  });
}

export function logarithmicSliderValue(
  position,
  minimum = RECURSIVE_FM_LIMITS.minCarrierHz,
  maximum = RECURSIVE_FM_LIMITS.maxCarrierHz,
) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.01));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, 4_800));
  const safePosition = clamp(finiteNumber(position, 0), 0, 1);
  return safeMinimum * ((safeMaximum / safeMinimum) ** safePosition);
}

export function logarithmicSliderPosition(
  value,
  minimum = RECURSIVE_FM_LIMITS.minCarrierHz,
  maximum = RECURSIVE_FM_LIMITS.maxCarrierHz,
) {
  const safeMinimum = Math.max(Number.EPSILON, finiteNumber(minimum, 0.01));
  const safeMaximum = Math.max(safeMinimum, finiteNumber(maximum, 4_800));
  const safeValue = clamp(finiteNumber(value, safeMinimum), safeMinimum, safeMaximum);
  if (safeMinimum === safeMaximum) return 0;
  return Math.log(safeValue / safeMinimum) / Math.log(safeMaximum / safeMinimum);
}

export function quadraticSliderValue(position, maximum = 12_000) {
  const safePosition = clamp(finiteNumber(position, 0), 0, 1);
  return safePosition * safePosition * Math.max(0, finiteNumber(maximum, 12_000));
}

export function quadraticSliderPosition(value, maximum = 12_000) {
  const safeMaximum = Math.max(Number.EPSILON, finiteNumber(maximum, 12_000));
  return Math.sqrt(clamp(finiteNumber(value, 0), 0, safeMaximum) / safeMaximum);
}

export function formatRecursiveFmFrequency(value) {
  const frequency = Math.max(0, finiteNumber(value, 0));
  if (frequency >= 1_000) {
    const digits = frequency >= 10_000 ? 1 : 2;
    return `${(frequency / 1_000).toFixed(digits).replace(/\.0+$/, "")} kHz`;
  }
  if (frequency >= 100) return `${Math.round(frequency)} Hz`;
  if (frequency >= 10) return `${frequency.toFixed(1).replace(/\.0$/, "")} Hz`;
  return `${frequency.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} Hz`;
}
