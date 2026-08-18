const DEFAULT_STORAGE_KEY = "morphazoid:midi:profile:v1";

const COMPUTER_KEYBOARD_INPUT = Object.freeze({
  id: "computer-keyboard",
  name: "Computer keyboard",
  manufacturer: "Morphazoid",
  state: "connected",
});

export const COMPUTER_KEYBOARD_LAYOUTS = deepFreeze({
  piano: {
    id: "piano",
    label: "Two-row piano",
    defaultBaseNote: 48,
    noteOffsets: {
      KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5,
      KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
      KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16,
      KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
      Digit7: 22, KeyU: 23,
    },
  },
  "pad-grid": {
    id: "pad-grid",
    label: "4 × 4 pad grid",
    defaultBaseNote: 36,
    noteOffsets: {
      Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
      KeyQ: 4, KeyW: 5, KeyE: 6, KeyR: 7,
      KeyA: 8, KeyS: 9, KeyD: 10, KeyF: 11,
      KeyZ: 12, KeyX: 13, KeyC: 14, KeyV: 15,
    },
  },
});

export const COMPUTER_KEYBOARD_DEFAULTS = deepFreeze({
  layout: "piano",
  baseNote: COMPUTER_KEYBOARD_LAYOUTS.piano.defaultBaseNote,
  channel: 0,
  velocity: 100,
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const range = (start, length) => Array.from({ length }, (_, index) => start + index);

const NI_TEMPLATE_NOTICE =
  "Morphazoid MIDI-mode template: assign the eight knobs to CC14–21. "
  + "These are Morphazoid conventions, not Native Instruments factory defaults.";

const profileDefinitions = [
  {
    id: "auto",
    label: "Auto (per device)",
    shortLabel: "Auto",
    kind: "automatic",
    description: "Match each connected MIDI input independently and fall back to General MIDI.",
    setupHint: "Recommended when more than one controller is connected.",
    macroCCs: [],
    padNotes: [],
    match: [],
  },
  {
    id: "generic",
    label: "General MIDI / Morphazoid",
    shortLabel: "General MIDI",
    kind: "generic",
    description: "Standard notes and performance CCs with Morphazoid macro slots on CC14–21.",
    setupHint: "Assign eight knobs to CC14–21 for the portable Morphazoid macro layout.",
    macroCCs: range(14, 8),
    padNotes: [],
    match: [],
  },
  {
    id: "ni-komplete-kontrol-s49-mk2",
    label: "NI Komplete Kontrol S49 MK2",
    shortLabel: "Kontrol S49 MK2",
    kind: "controller",
    description: "Keyboard, bend, pedals, and eight Morphazoid macro knobs.",
    setupHint: NI_TEMPLATE_NOTICE,
    macroCCs: range(14, 8),
    padNotes: [],
    match: [
      { manufacturer: ["native instruments"], name: ["s49 mk2", "s49 mkii", "komplete kontrol s49"] },
      { name: ["s49 mk2", "s49 mkii", "komplete kontrol s49"] },
      { name: ["kontrol 2 49"] },
    ],
  },
  {
    id: "ni-komplete-kontrol-a49-m32",
    label: "NI Komplete Kontrol A49 / M32",
    shortLabel: "Kontrol A49 / M32",
    kind: "controller",
    description: "Compact Komplete Kontrol keyboard profile with eight Morphazoid macro knobs.",
    setupHint: NI_TEMPLATE_NOTICE,
    macroCCs: range(14, 8),
    padNotes: [],
    match: [
      { manufacturer: ["native instruments"], name: ["a49", "m32", "komplete kontrol a", "komplete kontrol m"] },
    ],
  },
  {
    id: "ni-maschine-mikro-mk3",
    label: "NI Maschine Mikro MK3",
    shortLabel: "Maschine Mikro MK3",
    kind: "controller",
    description: "Sixteen chromatic pads in MIDI mode, plus optional Morphazoid macro CC slots.",
    setupHint: "Press Shift + Project for MIDI mode; pads use notes 36–51. CC14–21 remain available as optional Morphazoid macro slots.",
    macroCCs: range(14, 8),
    padNotes: range(36, 16),
    match: [
      { manufacturer: ["native instruments"], name: ["maschine mikro mk3", "maschine mikro"] },
      { name: ["maschine mikro"] },
    ],
  },
  {
    id: "akai-mpk-mini-mk3",
    label: "Akai MPK Mini MK3",
    shortLabel: "MPK Mini MK3",
    kind: "controller",
    description: "Eight knobs and two eight-pad banks in the common MPK MIDI layout.",
    setupHint: "Macros use CC70–77; pad banks use notes 36–51. Adjust the MPK program if yours differs.",
    macroCCs: range(70, 8),
    padNotes: range(36, 16),
    match: [
      { manufacturer: ["akai"], name: ["mpk mini mk3", "mpk mini"] },
      { name: ["mpk mini"] },
    ],
  },
  {
    id: "arturia-minilab-3",
    label: "Arturia MiniLab 3",
    shortLabel: "MiniLab 3",
    kind: "controller",
    description: "MiniLab knobs and pads normalized into Morphazoid macros and pad slots.",
    setupHint: "Macros use CC74, 71, 76, 77, 93, 18, 19, and 16; pads use notes 36–43.",
    macroCCs: [74, 71, 76, 77, 93, 18, 19, 16],
    padNotes: range(36, 8),
    match: [
      { manufacturer: ["arturia"], name: ["minilab 3", "minilab3"] },
      { name: ["minilab 3", "minilab3"] },
    ],
  },
  {
    id: "novation-launchkey",
    label: "Novation Launchkey",
    shortLabel: "Launchkey",
    kind: "controller",
    description: "Launchkey custom-mode knobs and sixteen pads.",
    setupHint: "Macros use CC21–28; pads use notes 36–51. Select a matching Custom Mode on the controller.",
    macroCCs: range(21, 8),
    padNotes: range(36, 16),
    match: [
      { manufacturer: ["novation"], name: ["launchkey"] },
      { name: ["launchkey"] },
    ],
  },
  {
    id: "custom",
    label: "Custom / Pass-through",
    shortLabel: "Custom",
    kind: "custom",
    description: "Pass through standard MIDI without assigning controller-specific macros or pads.",
    setupHint: "Standard notes and performance CCs remain active without controller-specific macro assignments.",
    macroCCs: [],
    padNotes: [],
    match: [],
  },
];

export const MIDI_PROFILE_STORAGE_KEY = DEFAULT_STORAGE_KEY;
export const MIDI_PROFILES = deepFreeze(profileDefinitions.map((profile) => ({ ...profile })));
export const MIDI_PROFILE_REGISTRY = deepFreeze(Object.fromEntries(
  MIDI_PROFILES.map((profile) => [profile.id, profile]),
));

const STANDARD_CONTROLLERS = deepFreeze({
  5: "portamentoTime",
  11: "expression",
  64: "sustain",
  65: "portamento",
  72: "release",
  73: "attack",
  75: "decay",
  120: "allSoundOff",
  121: "resetControllers",
  123: "allNotesOff",
});

function finiteByte(value, maximum = 127) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(maximum, Math.round(number)));
}

function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function includesOne(haystack, needles) {
  return needles.length === 0 || needles.some((needle) => haystack.includes(needle));
}

function ruleMatchesInput(rule, input) {
  const manufacturer = normalizedText(input?.manufacturer);
  const name = normalizedText(input?.name);
  const manufacturers = (rule.manufacturer ?? []).map(normalizedText);
  const names = (rule.name ?? []).map(normalizedText);
  return includesOne(manufacturer, manufacturers) && includesOne(name, names);
}

function autoProfileForInput(input) {
  for (const profile of MIDI_PROFILES) {
    if (profile.kind !== "controller") continue;
    if (profile.match.some((rule) => ruleMatchesInput(rule, input))) return profile;
  }
  return MIDI_PROFILE_REGISTRY.generic;
}

function safeStorage(runtime) {
  try {
    return runtime?.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredProfile(storage, storageKey) {
  try {
    const stored = storage?.getItem?.(storageKey);
    return MIDI_PROFILE_REGISTRY[stored] ? stored : "auto";
  } catch {
    return "auto";
  }
}

function storeProfile(storage, storageKey, profileId) {
  try {
    storage?.setItem?.(storageKey, profileId);
  } catch {
    // Profile selection remains active for this page when storage is blocked.
  }
}

function inputMetadata(input) {
  return deepFreeze({
    id: String(input?.id ?? ""),
    name: String(input?.name ?? "Unknown MIDI input"),
    manufacturer: String(input?.manufacturer ?? ""),
    state: String(input?.state ?? "connected"),
  });
}

function outputMetadata(output) {
  return deepFreeze({
    id: String(output?.id ?? ""),
    name: String(output?.name ?? "Unknown MIDI output"),
    manufacturer: String(output?.manufacturer ?? ""),
    state: String(output?.state ?? "connected"),
    connection: String(output?.connection ?? ""),
  });
}

function profileSummary(record) {
  const profile = record.profile;
  return deepFreeze({
    sourceId: record.sourceId,
    ...record.metadata,
    profileId: profile.id,
    profileLabel: profile.label,
  });
}

function standardControllerName(controller) {
  return STANDARD_CONTROLLERS[controller] ?? null;
}

function logicalForMessage(message, profile) {
  if (message.type === "noteOn" || message.type === "noteOff") {
    const padIndex = profile.padNotes.indexOf(message.note);
    if (padIndex >= 0) {
      return deepFreeze({
        type: "pad",
        index: padIndex,
        note: message.note,
        velocity: message.velocity,
        normalized: message.velocity / 127,
        gate: message.type === "noteOn",
      });
    }
    return deepFreeze({
      type: "note",
      note: message.note,
      velocity: message.velocity,
      normalized: message.velocity / 127,
      gate: message.type === "noteOn",
    });
  }
  if (message.type === "pitchBend") {
    return deepFreeze({ type: "pitchBend", normalized: message.normalized });
  }
  if (message.type === "polyPressure") {
    return deepFreeze({
      type: "polyPressure",
      note: message.note,
      pressure: message.pressure,
      normalized: message.normalized,
    });
  }
  if (message.type === "programChange") {
    return deepFreeze({ type: "programChange", program: message.program });
  }
  if (message.type === "channelPressure") {
    return deepFreeze({
      type: "channelPressure",
      pressure: message.pressure,
      normalized: message.normalized,
    });
  }
  if (["timingClock", "start", "continue", "stop"].includes(message.type)) {
    return deepFreeze({ type: message.type });
  }
  if (message.type === "songPosition") {
    return deepFreeze({
      type: "songPosition",
      position: message.position,
      sixteenths: message.sixteenths,
    });
  }
  const macroIndex = profile.macroCCs.indexOf(message.controller);
  if (macroIndex >= 0) {
    return deepFreeze({
      type: "macro",
      index: macroIndex,
      controller: message.controller,
      value: message.value,
      normalized: message.value / 127,
      standard: standardControllerName(message.controller),
    });
  }
  return deepFreeze({
    type: "cc",
    controller: message.controller,
    value: message.value,
    normalized: message.value / 127,
    standard: standardControllerName(message.controller),
  });
}

function parseMidiMessage(data) {
  if (!data || data.length < 1) return null;
  const raw = Object.freeze(Array.from(data, (value) => finiteByte(value, 255)));
  const status = raw[0] ?? 0;
  if (status === 0xf8) return { type: "timingClock", raw };
  if (status === 0xfa) return { type: "start", raw };
  if (status === 0xfb) return { type: "continue", raw };
  if (status === 0xfc) return { type: "stop", raw };
  if (status === 0xf2) {
    if (raw.length < 3) return null;
    const position = finiteByte(raw[1]) | (finiteByte(raw[2]) << 7);
    return {
      type: "songPosition",
      position,
      sixteenths: position,
      raw,
    };
  }
  if (status < 0x80 || status >= 0xf0) return null;
  const command = status & 0xf0;
  const channel = status & 0x0f;
  const data1 = finiteByte(raw[1]);
  const data2 = finiteByte(raw[2]);

  if ((command === 0xc0 || command === 0xd0) && raw.length < 2) return null;
  if (command !== 0xc0 && command !== 0xd0 && raw.length < 3) return null;

  if (command === 0x90 && data2 > 0) {
    return { type: "noteOn", channel, note: data1, velocity: data2, raw };
  }
  if (command === 0x80 || command === 0x90) {
    return { type: "noteOff", channel, note: data1, velocity: data2, raw };
  }
  if (command === 0xe0) {
    const value = data1 | (data2 << 7);
    const distance = value - 8_192;
    return {
      type: "pitchBend",
      channel,
      value,
      normalized: distance < 0 ? distance / 8_192 : distance / 8_191,
      raw,
    };
  }
  if (command === 0xb0) {
    return {
      type: "controlChange",
      channel,
      controller: data1,
      value: data2,
      raw,
    };
  }
  if (command === 0xa0) {
    return {
      type: "polyPressure",
      channel,
      note: data1,
      pressure: data2,
      normalized: data2 / 127,
      raw,
    };
  }
  if (command === 0xc0) {
    return {
      type: "programChange",
      channel,
      program: data1,
      raw,
    };
  }
  if (command === 0xd0) {
    return {
      type: "channelPressure",
      channel,
      pressure: data1,
      normalized: data1 / 127,
      raw,
    };
  }
  return null;
}

function outgoingBytes(data) {
  if (data == null || typeof data[Symbol.iterator] !== "function") {
    throw new TypeError("MIDI output data must be an iterable of bytes.");
  }
  const bytes = Array.from(data, (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 255) {
      throw new RangeError("MIDI output bytes must be finite values from 0 to 255.");
    }
    return Math.round(number);
  });
  if (bytes.length === 0 || bytes[0] < 0x80) {
    throw new RangeError("MIDI output data must begin with a status byte.");
  }
  if (bytes[0] === 0xf0) {
    throw new RangeError("SysEx output is unavailable because Morphazoid requests MIDI without SysEx.");
  }
  return bytes;
}

function eventTime(event) {
  const received = Number(event?.receivedTime);
  if (Number.isFinite(received)) return received;
  const timeStamp = Number(event?.timeStamp);
  return Number.isFinite(timeStamp) ? timeStamp : null;
}

function normalizeComputerKeyboardConfig(value) {
  if (value === false) return null;
  const options = value && typeof value === "object" ? value : {};
  const layout = COMPUTER_KEYBOARD_LAYOUTS[options.layout]
    ?? COMPUTER_KEYBOARD_LAYOUTS[COMPUTER_KEYBOARD_DEFAULTS.layout];
  return deepFreeze({
    layout: layout.id,
    baseNote: finiteByte(options.baseNote ?? layout.defaultBaseNote),
    channel: finiteByte(options.channel ?? COMPUTER_KEYBOARD_DEFAULTS.channel, 15),
    velocity: Math.max(1, finiteByte(options.velocity ?? COMPUTER_KEYBOARD_DEFAULTS.velocity)),
  });
}

function computerKeyboardTarget(runtime) {
  if (typeof runtime?.document?.addEventListener === "function") return runtime.document;
  if (typeof runtime?.addEventListener === "function") return runtime;
  return null;
}

function isComputerKeyboardEditableTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tagName = String(target.tagName ?? "").toUpperCase();
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) return true;
  if (target.isContentEditable) return true;
  const role = String(target.getAttribute?.("role") ?? "").toLowerCase();
  if (["textbox", "spinbutton", "slider", "combobox"].includes(role)) return true;
  return Boolean(target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='spinbutton'], [role='slider'], [role='combobox']"));
}

function callback(client, name, ...args) {
  try {
    client[name]?.(...args);
  } catch {
    // One page observer must not prevent MIDI delivery or cleanup for others.
  }
}

function consumeComputerKeyboardEvent(event) {
  event?.preventDefault?.();
  // MIDI-on owns its mapped QWERTY notes. Stopping the event in capture phase
  // prevents page-local letter shortcuts from sounding or acting a second time.
  event?.stopImmediatePropagation?.();
}

export class WebMidiManager {
  constructor(runtime = globalThis, { storageKey = MIDI_PROFILE_STORAGE_KEY } = {}) {
    this.runtime = runtime;
    this.storageKey = String(storageKey || MIDI_PROFILE_STORAGE_KEY);
    this.storage = safeStorage(runtime);
    this._selectedProfileId = readStoredProfile(this.storage, this.storageKey);
    this.active = false;
    this.access = null;
    this.enablePromise = null;
    this.hardwareError = null;
    this.lifecycleGeneration = 0;
    this.inputs = new Map();
    this.outputs = new Map();
    this._selectedOutputId = null;
    this.sourceIds = new WeakMap();
    this.sourceIdOwners = new Map();
    this.nextSourceId = 1;
    this.clients = new Map();
    this.statusSubscribers = new Set();
    this.boundStateChange = () => this.refreshInputs();
    this.computerKeyboardTarget = computerKeyboardTarget(runtime);
    this.computerKeyboardActive = false;
    this.computerKeyboardOctave = 0;
    this.computerKeyboardVelocity = COMPUTER_KEYBOARD_DEFAULTS.velocity;
    this.computerKeyboardHeld = new Map();
    this.boundComputerKeyDown = (event) => this.handleComputerKeyDown(event);
    this.boundComputerKeyUp = (event) => this.handleComputerKeyUp(event);
    this.boundComputerBlur = () => this.releaseComputerKeyboardNotes("keyboard-blur");
    this.boundComputerVisibility = () => {
      if (this.runtime?.document?.hidden) {
        this.releaseComputerKeyboardNotes("keyboard-hidden");
      }
    };
    this.lastProfileSignature = "";
  }

  get supported() {
    return this.computerKeyboardSupported || this.webMidiSupported;
  }

  get webMidiSupported() {
    return typeof this.runtime?.navigator?.requestMIDIAccess === "function";
  }

  get computerKeyboardSupported() {
    return Boolean(this.computerKeyboardTarget);
  }

  get enabled() {
    return this.active;
  }

  get selectedProfileId() {
    return this._selectedProfileId;
  }

  get selectedProfile() {
    return MIDI_PROFILE_REGISTRY[this._selectedProfileId];
  }

  get outputSelectionId() {
    return this._selectedOutputId;
  }

  get selectedOutput() {
    return this.selectedOutputRecord()?.metadata ?? null;
  }

  get selectedOutputId() {
    return this.selectedOutput?.id ?? null;
  }

  resolveProfile(input) {
    return this._selectedProfileId === "auto"
      ? autoProfileForInput(input)
      : this.selectedProfile;
  }

  status() {
    const computerClients = [...this.clients.values()]
      .filter(({ computerKeyboard }) => computerKeyboard)
      .map(({ id, computerKeyboard }) => deepFreeze({ id, ...computerKeyboard }));
    return deepFreeze({
      supported: this.supported,
      webMidiSupported: this.webMidiSupported,
      enabled: this.enabled,
      enabling: Boolean(this.enablePromise),
      hardwareError: this.hardwareError,
      inputCount: this.inputs.size,
      outputCount: this.outputs.size,
      outputSelectionId: this._selectedOutputId,
      selectedOutputId: this.selectedOutputId,
      selectedOutput: this.selectedOutput,
      clientCount: this.clients.size,
      clientIds: [...this.clients.keys()],
      computerKeyboard: {
        supported: this.computerKeyboardSupported,
        active: this.computerKeyboardActive,
        octave: this.computerKeyboardOctave,
        velocity: this.computerKeyboardVelocity,
        clients: computerClients,
      },
      selectedProfileId: this._selectedProfileId,
      selectedProfile: this.selectedProfile,
      inputs: [...this.inputs.values()].map(profileSummary),
      outputs: [...this.outputs.values()].map(({ metadata }) => metadata),
    });
  }

  profileStatus() {
    return deepFreeze({
      selectedProfileId: this._selectedProfileId,
      selectedProfile: this.selectedProfile,
      resolvedInputs: [...this.inputs.values()].map(profileSummary),
    });
  }

  subscribeStatus(listener, { immediate = true } = {}) {
    if (typeof listener !== "function") throw new TypeError("MIDI status listener must be a function.");
    this.statusSubscribers.add(listener);
    if (immediate) {
      try { listener(this.status()); } catch { /* Isolate observers. */ }
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.statusSubscribers.delete(listener);
    };
  }

  registerClient({
    id,
    computerKeyboard = COMPUTER_KEYBOARD_DEFAULTS,
    onMessage = null,
    onEnabledChange = null,
    onPrepareEnable = null,
    onProfileChange = null,
  } = {}) {
    const clientId = String(id ?? "").trim();
    if (!clientId) throw new TypeError("A MIDI client id is required.");
    if (this.clients.has(clientId)) throw new Error(`MIDI client already registered: ${clientId}`);
    for (const [name, value] of Object.entries({
      onMessage,
      onEnabledChange,
      onPrepareEnable,
      onProfileChange,
    })) {
      if (value !== null && typeof value !== "function") {
        throw new TypeError(`${name} must be a function or null.`);
      }
    }
    const client = {
      id: clientId,
      computerKeyboard: normalizeComputerKeyboardConfig(computerKeyboard),
      onMessage,
      onEnabledChange,
      onPrepareEnable,
      onProfileChange,
    };
    this.clients.set(clientId, client);
    if (this.active && client.computerKeyboard) this.attachComputerKeyboard();
    const status = this.status();
    callback(client, "onEnabledChange", status.enabled, status);
    callback(client, "onProfileChange", this.profileStatus(), status);
    this.notifyStatus();

    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.clients.get(clientId) === client) {
        this.releaseComputerKeyboardNotes("client-unregistered", clientId);
        this.clients.delete(clientId);
        if (![...this.clients.values()].some(({ computerKeyboard: config }) => config)) {
          this.detachComputerKeyboard();
        }
        this.notifyStatus();
      }
    };
  }

  setProfile(profileId) {
    const id = String(profileId ?? "").trim();
    const profile = MIDI_PROFILE_REGISTRY[id];
    if (!profile) throw new RangeError(`Unknown MIDI profile: ${id || "(empty)"}`);
    if (id === this._selectedProfileId) return profile;
    this._selectedProfileId = id;
    storeProfile(this.storage, this.storageKey, id);
    for (const [input, record] of this.inputs) record.profile = this.resolveProfile(input);
    this.notifyProfileChange(true);
    this.notifyStatus();
    return profile;
  }

  selectedOutputRecord() {
    if (this._selectedOutputId !== null) {
      for (const record of this.outputs.values()) {
        if (record.metadata.id === this._selectedOutputId) return record;
      }
      return null;
    }
    return this.outputs.values().next().value ?? null;
  }

  selectOutput(outputId = null) {
    const id = outputId == null || String(outputId).trim() === ""
      ? null
      : String(outputId).trim();
    let nextRecord = null;
    if (id !== null) {
      nextRecord = [...this.outputs.values()].find(({ metadata }) => metadata.id === id) ?? null;
      if (!nextRecord) throw new RangeError(`Unknown or disconnected MIDI output: ${id}`);
    }

    const previousRecord = this.selectedOutputRecord();
    const nextEffectiveRecord = nextRecord ?? this.outputs.values().next().value ?? null;
    if (this._selectedOutputId === id) return nextEffectiveRecord?.metadata ?? null;
    if (previousRecord && previousRecord !== nextEffectiveRecord) {
      this.silenceOutput(previousRecord.output);
    }
    this._selectedOutputId = id;
    this.notifyStatus();
    return nextEffectiveRecord?.metadata ?? null;
  }

  send(data, timestamp = undefined) {
    const record = this.selectedOutputRecord();
    if (!record || typeof record.output?.send !== "function") return false;
    const bytes = outgoingBytes(data);
    if (timestamp === undefined || timestamp === null) {
      record.output.send(bytes);
    } else {
      const scheduled = Number(timestamp);
      if (!Number.isFinite(scheduled)) {
        throw new TypeError("MIDI output timestamp must be finite.");
      }
      record.output.send(bytes, scheduled);
    }
    return true;
  }

  clearOutput() {
    const output = this.selectedOutputRecord()?.output;
    if (!output || typeof output.clear !== "function") return false;
    output.clear();
    return true;
  }

  silenceOutput(output, timestamp = undefined) {
    if (!output) return 0;
    try { output.clear?.(); } catch { /* Continue with immediate channel panic. */ }
    let sent = 0;
    for (let channel = 0; channel < 16; channel += 1) {
      for (const message of [
        [0xb0 | channel, 120, 0],
        [0xb0 | channel, 123, 0],
        [0xb0 | channel, 121, 0],
      ]) {
        try {
          if (typeof output.send !== "function") continue;
          if (timestamp === undefined || timestamp === null) output.send(message);
          else output.send(message, timestamp);
          sent += 1;
        } catch {
          // A disconnecting output may reject midway; panic remains best-effort.
        }
      }
    }
    return sent;
  }

  panic(timestamp = undefined) {
    const output = this.selectedOutputRecord()?.output;
    if (!output) return 0;
    const scheduled = timestamp === undefined || timestamp === null ? undefined : Number(timestamp);
    if (scheduled !== undefined && !Number.isFinite(scheduled)) {
      throw new TypeError("MIDI output timestamp must be finite.");
    }
    return this.silenceOutput(output, scheduled);
  }

  resetOutput(timestamp = undefined) {
    return this.panic(timestamp);
  }

  enable() {
    if (!this.supported) return Promise.reject(new Error("Web MIDI is not available in this browser."));
    if (this.enablePromise) return this.enablePromise;
    if (this.active) return Promise.resolve(this.access);

    const preparationStatus = this.status();
    try {
      for (const client of this.clients.values()) {
        client.onPrepareEnable?.(preparationStatus);
      }
    } catch (error) {
      return Promise.reject(error);
    }

    this.active = true;
    this.hardwareError = null;
    const keyboardStarted = this.attachComputerKeyboard();
    const activeStatus = this.status();
    for (const client of this.clients.values()) {
      callback(client, "onEnabledChange", true, activeStatus);
    }
    this.notifyStatus();

    if (!this.webMidiSupported) {
      this.hardwareError = "Hardware Web MIDI is unavailable in this browser.";
      this.notifyStatus();
      return Promise.resolve(null);
    }

    const generation = this.lifecycleGeneration;
    let request;
    try {
      request = this.runtime.navigator.requestMIDIAccess({ sysex: false });
    } catch (error) {
      if (keyboardStarted) {
        this.hardwareError = error instanceof Error ? error.message : String(error);
        this.notifyStatus();
        return Promise.resolve(null);
      }
      this.deactivateAfterFailedEnable();
      return Promise.reject(error);
    }

    let pending;
    pending = Promise.resolve(request).then((access) => {
      if (generation !== this.lifecycleGeneration) return null;
      this.access = access;
      if (typeof access?.addEventListener === "function") {
        access.addEventListener("statechange", this.boundStateChange);
      } else if (access) {
        access.onstatechange = this.boundStateChange;
      }
      this.refreshInputs({ notify: false });
      this.hardwareError = null;
      this.notifyProfileChange(true);
      this.notifyStatus();
      return access;
    }).catch((error) => {
      if (generation !== this.lifecycleGeneration) return null;
      if (this.computerKeyboardActive) {
        this.hardwareError = error instanceof Error ? error.message : String(error);
        this.notifyStatus();
        return null;
      }
      this.deactivateAfterFailedEnable();
      throw error;
    }).finally(() => {
      if (this.enablePromise === pending) {
        this.enablePromise = null;
        this.notifyStatus();
      }
    });
    this.enablePromise = pending;
    this.notifyStatus();
    return pending;
  }

  disable() {
    const hadState = Boolean(
      this.active || this.access || this.enablePromise || this.inputs.size || this.outputs.size,
    );
    const wasEnabled = this.active;
    this.lifecycleGeneration += 1;
    this.enablePromise = null;
    this.releaseComputerKeyboardNotes("manager-disabled");
    this.detachComputerKeyboard();
    this.panic();

    const records = [...this.inputs.values()];
    if (records.length === 0 && this.access) {
      this.dispatchSyntheticPanic(null, "manager-disabled");
    } else {
      for (const record of records) this.dispatchSyntheticPanic(record, "manager-disabled");
    }
    for (const [input, record] of this.inputs) this.detachInput(input, record);
    this.inputs.clear();
    this.outputs.clear();
    if (typeof this.access?.removeEventListener === "function") {
      this.access.removeEventListener("statechange", this.boundStateChange);
    } else if (this.access?.onstatechange === this.boundStateChange) {
      this.access.onstatechange = null;
    }
    this.access = null;
    this.active = false;
    this.hardwareError = null;
    if (wasEnabled) {
      const status = this.status();
      for (const client of this.clients.values()) {
        callback(client, "onEnabledChange", false, status);
      }
    }
    this.notifyProfileChange(true);
    this.notifyStatus();
    return hadState;
  }

  deactivateAfterFailedEnable() {
    const wasEnabled = this.active;
    this.releaseComputerKeyboardNotes("enable-failed");
    this.detachComputerKeyboard();
    this.active = false;
    if (wasEnabled) {
      const status = this.status();
      for (const client of this.clients.values()) {
        callback(client, "onEnabledChange", false, status);
      }
    }
    this.notifyStatus();
  }

  attachComputerKeyboard() {
    if (
      this.computerKeyboardActive
      || !this.computerKeyboardTarget
      || ![...this.clients.values()].some(({ computerKeyboard }) => computerKeyboard)
    ) return this.computerKeyboardActive;
    this.computerKeyboardTarget.addEventListener("keydown", this.boundComputerKeyDown, true);
    this.computerKeyboardTarget.addEventListener("keyup", this.boundComputerKeyUp, true);
    this.runtime?.addEventListener?.("blur", this.boundComputerBlur);
    this.runtime?.document?.addEventListener?.("visibilitychange", this.boundComputerVisibility);
    this.computerKeyboardActive = true;
    return true;
  }

  detachComputerKeyboard() {
    if (!this.computerKeyboardActive) return false;
    this.computerKeyboardTarget?.removeEventListener?.("keydown", this.boundComputerKeyDown, true);
    this.computerKeyboardTarget?.removeEventListener?.("keyup", this.boundComputerKeyUp, true);
    this.runtime?.removeEventListener?.("blur", this.boundComputerBlur);
    this.runtime?.document?.removeEventListener?.("visibilitychange", this.boundComputerVisibility);
    this.computerKeyboardActive = false;
    return true;
  }

  setComputerKeyboardOctave(value) {
    const octave = Math.max(-3, Math.min(3, Math.round(Number(value) || 0)));
    if (octave === this.computerKeyboardOctave) return octave;
    this.releaseComputerKeyboardNotes("keyboard-octave-changed");
    this.computerKeyboardOctave = octave;
    this.notifyStatus();
    return octave;
  }

  setComputerKeyboardVelocity(value) {
    const velocity = Math.max(1, Math.min(127, Math.round(Number(value) || 1)));
    if (velocity === this.computerKeyboardVelocity) return velocity;
    this.computerKeyboardVelocity = velocity;
    this.notifyStatus();
    return velocity;
  }

  computerKeyboardMessage(client, type, note, velocity, nativeEvent = null, extras = {}) {
    const config = client.computerKeyboard;
    if (!config) return null;
    const isNoteOn = type === "noteOn";
    const parsed = {
      type: isNoteOn ? "noteOn" : "noteOff",
      channel: config.channel,
      note: finiteByte(note),
      velocity: isNoteOn ? Math.max(1, finiteByte(velocity)) : 0,
      raw: Object.freeze([
        (isNoteOn ? 0x90 : 0x80) | config.channel,
        finiteByte(note),
        isNoteOn ? Math.max(1, finiteByte(velocity)) : 0,
      ]),
    };
    const profile = MIDI_PROFILE_REGISTRY.generic;
    const message = deepFreeze({
      ...parsed,
      sourceId: `computer-keyboard:${client.id}`,
      profileId: profile.id,
      input: COMPUTER_KEYBOARD_INPUT,
      timestamp: eventTime(nativeEvent),
      logical: logicalForMessage(parsed, profile),
      virtual: true,
      ...extras,
    });
    callback(client, "onMessage", message, nativeEvent);
    return message;
  }

  handleComputerKeyDown(event) {
    if (
      !this.active
      || !this.computerKeyboardActive
      || event?.isComposing
      || event?.defaultPrevented
      || event?.ctrlKey
      || event?.metaKey
      || event?.altKey
      || isComputerKeyboardEditableTarget(event?.target)
    ) return null;

    if (event?.repeat) {
      const repeatsOwnedNote = [...this.computerKeyboardHeld.values()].some(
        ({ code }) => code === event.code,
      );
      if (repeatsOwnedNote || ["BracketLeft", "BracketRight", "Minus", "Equal"].includes(event.code)) {
        consumeComputerKeyboardEvent(event);
      }
      return null;
    }

    if (["BracketLeft", "BracketRight", "Minus", "Equal"].includes(event?.code)) {
      if (event.code === "BracketLeft") {
        this.setComputerKeyboardOctave(this.computerKeyboardOctave - 1);
      } else if (event.code === "BracketRight") {
        this.setComputerKeyboardOctave(this.computerKeyboardOctave + 1);
      } else if (event.code === "Minus") {
        this.setComputerKeyboardVelocity(this.computerKeyboardVelocity - 8);
      } else {
        this.setComputerKeyboardVelocity(this.computerKeyboardVelocity + 8);
      }
      consumeComputerKeyboardEvent(event);
      return null;
    }

    let emitted = null;
    let claimed = false;
    for (const client of this.clients.values()) {
      const config = client.computerKeyboard;
      if (!config) continue;
      const layout = COMPUTER_KEYBOARD_LAYOUTS[config.layout];
      const offset = layout?.noteOffsets?.[event?.code];
      if (!Number.isInteger(offset)) continue;
      claimed = true;
      const heldKey = `${client.id}:${event.code}`;
      if (this.computerKeyboardHeld.has(heldKey)) continue;
      const note = finiteByte(config.baseNote + this.computerKeyboardOctave * 12 + offset);
      const velocity = Math.max(1, Math.min(
        127,
        config.velocity + this.computerKeyboardVelocity - COMPUTER_KEYBOARD_DEFAULTS.velocity,
      ));
      this.computerKeyboardHeld.set(heldKey, {
        clientId: client.id,
        code: event.code,
        note,
        velocity,
      });
      emitted = this.computerKeyboardMessage(client, "noteOn", note, velocity, event);
    }
    if (emitted || claimed) consumeComputerKeyboardEvent(event);
    return emitted;
  }

  handleComputerKeyUp(event) {
    let emitted = null;
    for (const [heldKey, held] of [...this.computerKeyboardHeld]) {
      if (held.code !== event?.code) continue;
      const client = this.clients.get(held.clientId);
      if (client) emitted = this.computerKeyboardMessage(client, "noteOff", held.note, 0, event);
      this.computerKeyboardHeld.delete(heldKey);
    }
    if (emitted) consumeComputerKeyboardEvent(event);
    return emitted;
  }

  releaseComputerKeyboardNotes(reason, clientId = null) {
    let released = 0;
    for (const [heldKey, held] of [...this.computerKeyboardHeld]) {
      if (clientId !== null && held.clientId !== clientId) continue;
      const client = this.clients.get(held.clientId);
      if (client) {
        this.computerKeyboardMessage(client, "noteOff", held.note, 0, null, {
          synthetic: true,
          reason,
        });
        released += 1;
      }
      this.computerKeyboardHeld.delete(heldKey);
    }
    return released;
  }

  sourceIdFor(input) {
    const existing = this.sourceIds.get(input);
    if (existing) return existing;
    const explicitId = String(input?.id ?? "").trim();
    const base = explicitId ? `web-midi:${explicitId}` : `web-midi:input-${this.nextSourceId++}`;
    let candidate = base;
    let suffix = 2;
    while (this.sourceIdOwners.has(candidate) && this.sourceIdOwners.get(candidate) !== input) {
      candidate = `${base}#${suffix++}`;
    }
    this.sourceIds.set(input, candidate);
    this.sourceIdOwners.set(candidate, input);
    return candidate;
  }

  refreshInputs({ notify = true } = {}) {
    if (!this.access) return;
    const available = new Set();
    for (const input of this.access.inputs?.values?.() ?? []) {
      if (input && input.state !== "disconnected") available.add(input);
    }

    for (const [input, record] of [...this.inputs]) {
      if (available.has(input)) continue;
      this.dispatchSyntheticPanic(record, "input-disconnected");
      this.detachInput(input, record);
      this.inputs.delete(input);
    }

    for (const input of available) {
      const current = this.inputs.get(input);
      if (current) {
        current.metadata = inputMetadata(input);
        current.profile = this.resolveProfile(input);
        continue;
      }
      const record = {
        sourceId: this.sourceIdFor(input),
        metadata: inputMetadata(input),
        profile: this.resolveProfile(input),
        listener: null,
      };
      record.listener = (event) => this.handleMessage(event, input);
      if (typeof input.addEventListener === "function") {
        input.addEventListener("midimessage", record.listener);
      } else {
        input.onmidimessage = record.listener;
      }
      this.inputs.set(input, record);
    }

    this.refreshOutputs();

    if (notify) {
      this.notifyProfileChange();
      this.notifyStatus();
    }
  }

  refreshOutputs() {
    if (!this.access) return;
    const available = new Set();
    for (const output of this.access.outputs?.values?.() ?? []) {
      if (output && output.state !== "disconnected") available.add(output);
    }

    for (const [output, record] of [...this.outputs]) {
      if (available.has(output)) continue;
      if (this.selectedOutputRecord() === record) this.silenceOutput(output);
      this.outputs.delete(output);
    }

    for (const output of available) {
      const current = this.outputs.get(output);
      if (current) {
        current.metadata = outputMetadata(output);
      } else {
        this.outputs.set(output, {
          output,
          metadata: outputMetadata(output),
        });
      }
    }
  }

  detachInput(input, record) {
    if (typeof input?.removeEventListener === "function") {
      input.removeEventListener("midimessage", record.listener);
    } else if (input?.onmidimessage === record.listener) {
      input.onmidimessage = null;
    }
  }

  handleMessage(event, input) {
    const parsed = parseMidiMessage(event?.data);
    if (!parsed) return null;
    const record = this.inputs.get(input);
    if (!record) return null;
    record.profile = this.resolveProfile(input);
    const message = deepFreeze({
      ...parsed,
      sourceId: record.sourceId,
      profileId: record.profile.id,
      input: record.metadata,
      timestamp: eventTime(event),
      logical: logicalForMessage(parsed, record.profile),
    });
    this.dispatchMessage(message, event);
    return message;
  }

  dispatchSyntheticPanic(record, reason) {
    const profile = record?.profile ?? this.selectedProfile;
    const parsed = {
      type: "controlChange",
      channel: 0,
      controller: 120,
      value: 0,
      raw: Object.freeze([]),
    };
    const message = deepFreeze({
      ...parsed,
      sourceId: record?.sourceId ?? "web-midi:manager",
      profileId: profile.id,
      input: record?.metadata ?? null,
      timestamp: null,
      logical: logicalForMessage(parsed, profile),
      synthetic: true,
      reason,
    });
    this.dispatchMessage(message, null);
    return message;
  }

  dispatchMessage(message, nativeEvent) {
    for (const client of this.clients.values()) {
      callback(client, "onMessage", message, nativeEvent);
    }
  }

  notifyStatus() {
    const status = this.status();
    for (const listener of this.statusSubscribers) {
      try { listener(status); } catch { /* Isolate observers. */ }
    }
  }

  notifyProfileChange(force = false) {
    const profileStatus = this.profileStatus();
    const signature = JSON.stringify({
      selectedProfileId: profileStatus.selectedProfileId,
      inputs: profileStatus.resolvedInputs.map(({ sourceId, profileId }) => [sourceId, profileId]),
    });
    if (!force && signature === this.lastProfileSignature) return;
    this.lastProfileSignature = signature;
    const status = this.status();
    for (const client of this.clients.values()) {
      callback(client, "onProfileChange", profileStatus, status);
    }
  }
}

const sharedManagers = new WeakMap();
let primitiveRuntimeManager = null;

export function getSharedMidiManager(runtime = globalThis) {
  if ((typeof runtime !== "object" && typeof runtime !== "function") || runtime === null) {
    primitiveRuntimeManager ??= new WebMidiManager(globalThis);
    return primitiveRuntimeManager;
  }
  let manager = sharedManagers.get(runtime);
  if (!manager) {
    manager = new WebMidiManager(runtime);
    sharedManagers.set(runtime, manager);
  }
  return manager;
}
