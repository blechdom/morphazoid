const MIDI_MAX = 127;

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(
    minimum,
    Number.isFinite(number) ? number : fallback,
  ));
}

function midiByte(data, index) {
  return Math.round(clamp(data?.[index], 0, MIDI_MAX, 0));
}

function geometricMidiValue(value, minimum, maximum, { zero = false } = {}) {
  const safeValue = midiByte([value], 0);
  if (zero && safeValue === 0) return 0;
  const position = zero ? (safeValue - 1) / 126 : safeValue / MIDI_MAX;
  return minimum * ((maximum / minimum) ** position);
}

export const RECURSIVE_PM_PERFORMANCE_DEFAULTS = Object.freeze({
  playMode: "drone",
  ampAttackMs: 8,
  ampDecayMs: 120,
  ampSustainLevel: 0.72,
  ampReleaseMs: 180,
  glideMode: "off",
  glideTimeMs: 0,
  rootMidiNote: 60,
  pitchBendRangeSemitones: 2,
});

export function sanitizeRecursivePmPerformance(values = {}) {
  const glideMode = String(values.glideMode ?? "off");
  const playMode = String(values.playMode ?? "drone");
  return Object.freeze({
    playMode: playMode === "midi" ? "midi" : "drone",
    ampAttackMs: clamp(values.ampAttackMs, 0, 5_000, 8),
    ampDecayMs: clamp(values.ampDecayMs, 0, 5_000, 120),
    ampSustainLevel: clamp(values.ampSustainLevel, 0, 1, 0.72),
    ampReleaseMs: clamp(values.ampReleaseMs, 2, 10_000, 180),
    glideMode: ["off", "legato", "always"].includes(glideMode)
      ? glideMode
      : "off",
    glideTimeMs: clamp(values.glideTimeMs, 0, 2_000, 0),
    rootMidiNote: Math.round(clamp(values.rootMidiNote, 0, MIDI_MAX, 60)),
    pitchBendRangeSemitones: clamp(
      values.pitchBendRangeSemitones,
      0,
      24,
      2,
    ),
  });
}

export function recursivePmMidiPitchRatio(
  note,
  rootMidiNote = 60,
  bendSemitones = 0,
) {
  const safeNote = clamp(note, 0, MIDI_MAX, 60);
  const safeRoot = clamp(rootMidiNote, 0, MIDI_MAX, 60);
  const safeBend = clamp(bendSemitones, -24, 24, 0);
  return 2 ** ((safeNote - safeRoot + safeBend) / 12);
}

export function recursivePmVelocityGain(velocity) {
  return clamp(velocity, 0, MIDI_MAX, 0) / MIDI_MAX;
}

/**
 * The fixed map follows the same portable performance CCs as Chaotic FM.
 * Algorithm parameters stay free for DAW/browser MIDI learn instead of being
 * assigned arbitrary factory meanings.
 */
export function recursivePmFactoryControlChange(controller, value) {
  const cc = midiByte([controller], 0);
  const safeValue = midiByte([value], 0);
  if (cc === 5) {
    return {
      type: "parameter",
      key: "glideTimeMs",
      parameterId: "performance.glideTimeMs",
      value: geometricMidiValue(safeValue, 10, 2_000, { zero: true }),
    };
  }
  if (cc === 11) return { type: "expression", value: safeValue / MIDI_MAX };
  if (cc === 64) return { type: "sustain", down: safeValue >= 64 };
  if (cc === 65) return { type: "glideEnabled", enabled: safeValue >= 64 };
  if (cc === 72) {
    return {
      type: "parameter",
      key: "ampReleaseMs",
      parameterId: "performance.ampReleaseMs",
      value: geometricMidiValue(safeValue, 2, 10_000),
    };
  }
  if (cc === 73) {
    return {
      type: "parameter",
      key: "ampAttackMs",
      parameterId: "performance.ampAttackMs",
      value: geometricMidiValue(safeValue, 0.5, 5_000, { zero: true }),
    };
  }
  if (cc === 75) {
    return {
      type: "parameter",
      key: "ampDecayMs",
      parameterId: "performance.ampDecayMs",
      value: geometricMidiValue(safeValue, 1, 5_000, { zero: true }),
    };
  }
  if (cc === 120) return { type: "allSoundOff" };
  if (cc === 121) return { type: "resetControllers" };
  if (cc === 123) return { type: "allNotesOff" };
  return null;
}

export function decodeRecursivePmMidiMessage(data) {
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
  if (command === 0xb0) {
    return { type: "controlChange", controller: data1, value: data2, channel };
  }
  return null;
}

function frozenEvents(events) {
  return Object.freeze(events.map((event) => Object.freeze(event)));
}

/**
 * Platform-neutral mono note stack. A repeated/new note moves to the end of
 * the Map, so the most recently pressed physical key always has priority.
 */
export class RecursivePmMidiPerformance {
  constructor({ rootMidiNote = 60, pitchBendRangeSemitones = 2 } = {}) {
    this.heldNotes = new Map();
    this.currentVoiceKey = null;
    this.currentNote = null;
    this.currentVelocity = 0;
    this.sustain = false;
    this.expression = 1;
    this.bendNormalized = 0;
    this.rootMidiNote = Math.round(clamp(rootMidiNote, 0, MIDI_MAX, 60));
    this.pitchBendRangeSemitones = clamp(
      pitchBendRangeSemitones,
      0,
      24,
      2,
    );
    this.glideOverride = null;
  }

  setPitchBendRange(semitones) {
    this.pitchBendRangeSemitones = clamp(semitones, 0, 24, 2);
    return this.currentNote === null ? frozenEvents([]) : frozenEvents([
      this.pitchBendEvent(),
    ]);
  }

  setRootMidiNote(note) {
    this.rootMidiNote = Math.round(clamp(note, 0, MIDI_MAX, 60));
    return this.currentNote === null ? frozenEvents([]) : frozenEvents([
      this.retuneEvent(),
    ]);
  }

  currentPitchRatio() {
    if (this.currentNote === null) return null;
    return recursivePmMidiPitchRatio(
      this.currentNote,
      this.rootMidiNote,
      this.bendNormalized * this.pitchBendRangeSemitones,
    );
  }

  currentNotePitchRatio() {
    if (this.currentNote === null) return null;
    return recursivePmMidiPitchRatio(
      this.currentNote,
      this.rootMidiNote,
    );
  }

  currentBendSemitones() {
    return this.bendNormalized * this.pitchBendRangeSemitones;
  }

  pitchBendEvent() {
    return {
      type: "pitchBend",
      normalized: this.bendNormalized,
      bendSemitones: this.currentBendSemitones(),
    };
  }

  retuneEvent() {
    return {
      type: "retune",
      note: this.currentNote,
      notePitchRatio: this.currentNotePitchRatio(),
      bendSemitones: this.currentBendSemitones(),
      pitchRatio: this.currentPitchRatio(),
    };
  }

  voiceKey(note, channel = 0, sourceId = "default") {
    const safeChannel = Math.round(clamp(channel, 0, 15, 0));
    return `${String(sourceId)}\u0000${safeChannel}\u0000${note}`;
  }

  gateOnEvent(entry, legato) {
    return {
      type: "gateOn",
      note: entry.note,
      velocity: entry.velocity,
      velocityGain: recursivePmVelocityGain(entry.velocity),
      notePitchRatio: this.currentNotePitchRatio(),
      bendSemitones: this.currentBendSemitones(),
      pitchRatio: this.currentPitchRatio(),
      channel: entry.channel,
      sourceId: entry.sourceId,
      legato,
    };
  }

  noteOn(note, velocity, channel = 0, sourceId = "default") {
    const safeNote = midiByte([note], 0);
    const safeVelocity = midiByte([velocity], 0);
    const safeChannel = Math.round(clamp(channel, 0, 15, 0));
    const safeSourceId = String(sourceId ?? "default");
    if (safeVelocity === 0) {
      return this.noteOff(safeNote, safeChannel, safeSourceId);
    }
    const legato = this.currentNote !== null;
    const key = this.voiceKey(safeNote, safeChannel, safeSourceId);
    const entry = {
      note: safeNote,
      velocity: safeVelocity,
      channel: safeChannel,
      sourceId: safeSourceId,
    };
    this.heldNotes.delete(key);
    this.heldNotes.set(key, entry);
    this.currentVoiceKey = key;
    this.currentNote = safeNote;
    this.currentVelocity = safeVelocity;
    return frozenEvents([this.gateOnEvent(entry, legato)]);
  }

  noteOff(note, channel = 0, sourceId = "default") {
    const safeNote = midiByte([note], 0);
    const key = this.voiceKey(safeNote, channel, sourceId);
    if (!this.heldNotes.delete(key)) return frozenEvents([]);
    if (key !== this.currentVoiceKey) return frozenEvents([]);

    const previous = [...this.heldNotes.entries()].at(-1);
    if (previous) {
      const [nextKey, next] = previous;
      this.currentVoiceKey = nextKey;
      this.currentNote = next.note;
      this.currentVelocity = next.velocity;
      return frozenEvents([this.gateOnEvent(next, true)]);
    }
    if (this.sustain) return frozenEvents([]);
    this.currentVoiceKey = null;
    this.currentNote = null;
    this.currentVelocity = 0;
    return frozenEvents([{ type: "gateOff" }]);
  }

  setSustain(down) {
    const wasDown = this.sustain;
    this.sustain = Boolean(down);
    const events = [{ type: "sustain", down: this.sustain }];
    if (wasDown && !this.sustain
      && this.heldNotes.size === 0
      && this.currentNote !== null) {
      this.currentVoiceKey = null;
      this.currentNote = null;
      this.currentVelocity = 0;
      events.push({ type: "gateOff" });
    }
    return frozenEvents(events);
  }

  resetControllers() {
    const events = [
      { type: "expression", value: 1 },
      { type: "glideEnabled", enabled: null },
    ];
    this.expression = 1;
    this.bendNormalized = 0;
    this.glideOverride = null;
    const sustainWasDown = this.sustain;
    this.sustain = false;
    events.push({ type: "sustain", down: false });
    if (sustainWasDown && this.heldNotes.size === 0 && this.currentNote !== null) {
      this.currentVoiceKey = null;
      this.currentNote = null;
      this.currentVelocity = 0;
      events.push({ type: "gateOff" });
    } else if (this.currentNote !== null) {
      events.push(this.pitchBendEvent());
    }
    return frozenEvents(events);
  }

  clearNotes(type) {
    this.heldNotes.clear();
    this.currentVoiceKey = null;
    this.currentNote = null;
    this.currentVelocity = 0;
    this.sustain = false;
    return frozenEvents([{ type }]);
  }

  handle(action) {
    if (!action) return frozenEvents([]);
    if (action.type === "noteOn") {
      return this.noteOn(
        action.note,
        action.velocity,
        action.channel,
        action.sourceId,
      );
    }
    if (action.type === "noteOff") {
      return this.noteOff(action.note, action.channel, action.sourceId);
    }
    if (action.type === "pitchBend") {
      this.bendNormalized = clamp(action.normalized, -1, 1, 0);
      return frozenEvents([this.pitchBendEvent()]);
    }
    if (action.type !== "controlChange") return frozenEvents([]);

    const semantic = recursivePmFactoryControlChange(
      action.controller,
      action.value,
    );
    if (!semantic) return frozenEvents([]);
    if (semantic.type === "sustain") return this.setSustain(semantic.down);
    if (semantic.type === "expression") {
      this.expression = semantic.value;
      return frozenEvents([semantic]);
    }
    if (semantic.type === "glideEnabled") {
      this.glideOverride = semantic.enabled;
      return frozenEvents([semantic]);
    }
    if (semantic.type === "resetControllers") return this.resetControllers();
    if (semantic.type === "allSoundOff") return this.clearNotes("allSoundOff");
    if (semantic.type === "allNotesOff") return this.clearNotes("gateOff");
    return frozenEvents([semantic]);
  }
}

/** Web MIDI permission is requested only by enable(), never by construction. */
export class RecursivePmWebMidi {
  constructor(runtime = globalThis, { onAction = null, onStatus = null } = {}) {
    this.runtime = runtime;
    this.onAction = onAction;
    this.onStatus = onStatus;
    this.access = null;
    this.inputs = new Set();
    this.inputListeners = new Map();
    this.inputSourceIds = new Map();
    this.nextInputSourceId = 1;
    this.lifecycleToken = 0;
    this.pendingEnable = null;
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

  sourceIdFor(input) {
    if (!input) return "web-midi";
    if (!this.inputSourceIds.has(input)) {
      const explicitId = String(input.id ?? "").trim();
      this.inputSourceIds.set(
        input,
        explicitId || `web-midi-input-${this.nextInputSourceId++}`,
      );
    }
    return this.inputSourceIds.get(input);
  }

  async enable() {
    if (!this.supported) {
      throw new Error("Web MIDI is not available in this browser.");
    }
    if (this.access) return this.access;
    if (this.pendingEnable) return this.pendingEnable;
    const token = this.lifecycleToken;
    const operation = (async () => {
      const access = await this.runtime.navigator.requestMIDIAccess({ sysex: false });
      if (token !== this.lifecycleToken) return null;
      this.access = access;
      if (typeof access.addEventListener === "function") {
        access.addEventListener("statechange", this.boundStateChange);
      } else {
        access.onstatechange = this.boundStateChange;
      }
      this.refreshInputs();
      return access;
    })();
    this.pendingEnable = operation;
    try {
      return await operation;
    } finally {
      if (this.pendingEnable === operation) this.pendingEnable = null;
    }
  }

  refreshInputs() {
    const available = new Set();
    let disconnected = false;
    for (const input of this.access?.inputs?.values?.() ?? []) {
      if (input?.state !== "disconnected") available.add(input);
    }
    for (const input of this.inputs) {
      if (available.has(input)) continue;
      const listener = this.inputListeners.get(input);
      if (typeof input.removeEventListener === "function") {
        input.removeEventListener("midimessage", listener);
      } else if (input.onmidimessage === listener) {
        input.onmidimessage = null;
      }
      this.inputListeners.delete(input);
      this.inputSourceIds.delete(input);
      this.inputs.delete(input);
      disconnected = true;
    }
    for (const input of available) {
      if (this.inputs.has(input)) continue;
      const listener = (event) => this.handleMessage(event, input);
      if (typeof input.addEventListener === "function") {
        input.addEventListener("midimessage", listener);
      } else {
        input.onmidimessage = listener;
      }
      this.inputListeners.set(input, listener);
      this.sourceIdFor(input);
      this.inputs.add(input);
    }
    if (disconnected) {
      this.onAction?.({
        type: "controlChange",
        controller: 120,
        value: 0,
        channel: 0,
        reason: "input-disconnected",
      });
    }
    this.notifyStatus();
  }

  handleMessage(event, input = null) {
    const decoded = decodeRecursivePmMidiMessage(event?.data);
    if (!decoded) return null;
    const action = {
      ...decoded,
      sourceId: this.sourceIdFor(input),
    };
    this.onAction?.(action, event);
    return Object.freeze(action);
  }

  close() {
    this.lifecycleToken += 1;
    this.pendingEnable = null;
    for (const input of this.inputs) {
      const listener = this.inputListeners.get(input);
      if (typeof input.removeEventListener === "function") {
        input.removeEventListener("midimessage", listener);
      } else if (input.onmidimessage === listener) {
        input.onmidimessage = null;
      }
    }
    this.inputs.clear();
    this.inputListeners.clear();
    this.inputSourceIds.clear();
    if (typeof this.access?.removeEventListener === "function") {
      this.access.removeEventListener("statechange", this.boundStateChange);
    } else if (this.access?.onstatechange === this.boundStateChange) {
      this.access.onstatechange = null;
    }
    this.access = null;
    this.notifyStatus();
  }
}
