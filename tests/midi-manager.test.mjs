import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPUTER_KEYBOARD_DEFAULTS,
  COMPUTER_KEYBOARD_LAYOUTS,
  MIDI_PROFILES,
  MIDI_PROFILE_REGISTRY,
  MIDI_PROFILE_STORAGE_KEY,
  WebMidiManager,
  getSharedMidiManager,
} from "../src/midi-manager.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeMidiInput extends FakeEventTarget {
  constructor({ id = "input", name = "MIDI Input", manufacturer = "", state = "connected" } = {}) {
    super();
    this.id = id;
    this.name = name;
    this.manufacturer = manufacturer;
    this.state = state;
  }

  send(data, extras = {}) {
    this.emit("midimessage", {
      data: new Uint8Array(data),
      receivedTime: 123.5,
      ...extras,
    });
  }
}

class FakeMidiOutput {
  constructor({
    id = "output",
    name = "MIDI Output",
    manufacturer = "",
    state = "connected",
    connection = "open",
    clearSupported = true,
  } = {}) {
    this.id = id;
    this.name = name;
    this.manufacturer = manufacturer;
    this.state = state;
    this.connection = connection;
    this.sent = [];
    this.clearCalls = 0;
    if (clearSupported) {
      this.clear = () => { this.clearCalls += 1; };
    }
  }

  send(data, timestamp = undefined) {
    if (this.state === "disconnected") throw new Error("output disconnected");
    this.sent.push({ data: Array.from(data), timestamp });
  }
}

class FakeMidiAccess extends FakeEventTarget {
  constructor(inputs = [], outputs = []) {
    super();
    this.inputs = new Map(inputs.map((input, index) => [`port-${index}`, input]));
    this.outputs = new Map(outputs.map((output, index) => [`output-${index}`, output]));
  }

  disconnect(input) {
    input.state = "disconnected";
    for (const [key, candidate] of this.inputs) {
      if (candidate === input) this.inputs.delete(key);
    }
    this.emit("statechange", { port: input });
  }

  connect(input, key = `port-${this.inputs.size}`) {
    input.state = "connected";
    this.inputs.set(key, input);
    this.emit("statechange", { port: input });
  }

  disconnectOutput(output) {
    output.state = "disconnected";
    for (const [key, candidate] of this.outputs) {
      if (candidate === output) this.outputs.delete(key);
    }
    this.emit("statechange", { port: output });
  }

  connectOutput(output, key = `output-${this.outputs.size}`) {
    output.state = "connected";
    this.outputs.set(key, output);
    this.emit("statechange", { port: output });
  }
}

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    values,
    writes,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      values.set(String(key), String(value));
      writes.push([String(key), String(value)]);
    },
  };
}

function runtimeWithRequests(requests, storage = fakeStorage()) {
  const calls = [];
  let index = 0;
  const runtime = {
    localStorage: storage,
    navigator: {
      requestMIDIAccess(options) {
        calls.push(options);
        const result = requests[Math.min(index, requests.length - 1)];
        index += 1;
        if (result instanceof Error) throw result;
        return typeof result === "function" ? result() : result;
      },
    },
  };
  return { runtime, calls, storage };
}

function computerKeyboardRuntime({ requests = [], webMidi = true, storage = fakeStorage() } = {}) {
  const document = new FakeEventTarget();
  document.hidden = false;
  const runtimeEvents = new FakeEventTarget();
  const calls = [];
  let index = 0;
  const navigator = {};
  if (webMidi) {
    navigator.requestMIDIAccess = (options) => {
      calls.push(options);
      const result = requests[Math.min(index, requests.length - 1)];
      index += 1;
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result() : result;
    };
  }
  const runtime = {
    document,
    navigator,
    localStorage: storage,
    addEventListener: runtimeEvents.addEventListener.bind(runtimeEvents),
    removeEventListener: runtimeEvents.removeEventListener.bind(runtimeEvents),
  };
  return { runtime, document, runtimeEvents, calls, storage };
}

const plainKeyTarget = Object.freeze({
  tagName: "DIV",
  isContentEditable: false,
  getAttribute() { return null; },
  closest() { return null; },
});

function computerKey(code, extras = {}) {
  return {
    code,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: plainKeyTarget,
    timeStamp: 456.75,
    prevented: false,
    ...extras,
    preventDefault() {
      this.prevented = true;
      this.defaultPrevented = true;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const expectedProfileIds = [
  "auto",
  "generic",
  "ni-komplete-kontrol-s49-mk2",
  "ni-komplete-kontrol-a49-m32",
  "ni-maschine-mikro-mk3",
  "akai-mpk-mini-mk3",
  "arturia-minilab-3",
  "novation-launchkey",
  "custom",
];

test("profile registry is ordered, deeply frozen, and documents NI template conventions", () => {
  assert.deepEqual(MIDI_PROFILES.map(({ id }) => id), expectedProfileIds);
  assert.deepEqual(Object.keys(MIDI_PROFILE_REGISTRY), expectedProfileIds);
  assert.equal(new Set(expectedProfileIds).size, MIDI_PROFILES.length);
  assert.equal(Object.isFrozen(MIDI_PROFILES), true);
  assert.equal(Object.isFrozen(MIDI_PROFILE_REGISTRY), true);

  for (const profile of MIDI_PROFILES) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.macroCCs), true);
    assert.equal(Object.isFrozen(profile.padNotes), true);
    assert.equal(Object.isFrozen(profile.match), true);
    assert.equal(MIDI_PROFILE_REGISTRY[profile.id], profile);
    assert.equal(new Set(profile.macroCCs).size, profile.macroCCs.length);
    assert.equal(profile.macroCCs.length <= 8, true);
    assert.equal(profile.padNotes.length <= 16, true);
  }

  for (const id of [
    "ni-komplete-kontrol-s49-mk2",
    "ni-komplete-kontrol-a49-m32",
  ]) {
    const profile = MIDI_PROFILE_REGISTRY[id];
    assert.deepEqual(profile.macroCCs, [14, 15, 16, 17, 18, 19, 20, 21]);
    assert.match(profile.setupHint, /Morphazoid MIDI-mode template/);
    assert.match(profile.setupHint, /not Native Instruments factory defaults/);
  }
  assert.deepEqual(
    MIDI_PROFILE_REGISTRY["ni-maschine-mikro-mk3"].macroCCs,
    [14, 15, 16, 17, 18, 19, 20, 21],
  );
  assert.match(
    MIDI_PROFILE_REGISTRY["ni-maschine-mikro-mk3"].setupHint,
    /Shift \+ Project[\s\S]+notes 36–51[\s\S]+optional Morphazoid macro slots/,
  );
  assert.deepEqual(
    MIDI_PROFILE_REGISTRY["ni-maschine-mikro-mk3"].padNotes,
    Array.from({ length: 16 }, (_, index) => 36 + index),
  );
  assert.equal(MIDI_PROFILE_REGISTRY.custom.label, "Custom / Pass-through");
  assert.doesNotMatch(MIDI_PROFILE_REGISTRY.custom.setupHint, /learn/i);
});

test("construction is inert, singleton identity is runtime-scoped, and only profiles persist", () => {
  const access = new FakeMidiAccess();
  const storage = fakeStorage();
  const { runtime, calls } = runtimeWithRequests([access], storage);

  const first = getSharedMidiManager(runtime);
  const second = getSharedMidiManager(runtime);
  assert.equal(first, second);
  assert.equal(first.supported, true);
  assert.equal(first.enabled, false);
  assert.equal(first.selectedProfileId, "auto");
  assert.equal(calls.length, 0, "construction must never request MIDI permission");
  assert.equal(storage.writes.length, 0, "construction must not persist an enabled preference");

  first.setProfile("novation-launchkey");
  assert.deepEqual(storage.writes, [[MIDI_PROFILE_STORAGE_KEY, "novation-launchkey"]]);
  assert.deepEqual([...storage.values.keys()], [MIDI_PROFILE_STORAGE_KEY]);

  const restoredRuntime = runtimeWithRequests([new FakeMidiAccess()], storage).runtime;
  const restored = new WebMidiManager(restoredRuntime);
  assert.equal(restored.selectedProfileId, "novation-launchkey");
  assert.equal(restored.enabled, false);
  assert.equal(restoredRuntime.navigator.requestMIDIAccess.length >= 0, true);

  const otherRuntime = runtimeWithRequests([new FakeMidiAccess()]).runtime;
  assert.notEqual(getSharedMidiManager(otherRuntime), first);
});

test("client registration replays state, gates capability by clientCount, and unregisters idempotently", () => {
  const { runtime } = runtimeWithRequests([new FakeMidiAccess()]);
  const manager = new WebMidiManager(runtime);
  const statuses = [];
  const enabledChanges = [];
  const profileChanges = [];
  const unsubscribeStatus = manager.subscribeStatus((status) => statuses.push(status));

  const unregister = manager.registerClient({
    id: "test-client",
    onEnabledChange: (enabled, status) => enabledChanges.push([enabled, status.clientCount]),
    onProfileChange: (profile, status) => profileChanges.push([
      profile.selectedProfileId,
      status.clientCount,
    ]),
  });
  assert.deepEqual(enabledChanges, [[false, 1]]);
  assert.deepEqual(profileChanges, [["auto", 1]]);
  assert.equal(statuses.at(-1).clientCount, 1);
  assert.equal(Object.isFrozen(statuses.at(-1)), true);
  assert.throws(() => manager.registerClient({ id: "test-client" }), /already registered/);
  assert.throws(() => manager.registerClient({ id: "bad", onMessage: true }), /onMessage/);
  assert.throws(() => manager.registerClient({}), /client id/);

  unregister();
  unregister();
  assert.equal(statuses.at(-1).clientCount, 0);
  unsubscribeStatus();
  assert.equal(manager.status().clientCount, 0);
});

test("computer piano works without hardware Web MIDI and stays available after permission denial", async () => {
  assert.equal(Object.isFrozen(COMPUTER_KEYBOARD_LAYOUTS), true);
  assert.equal(Object.isFrozen(COMPUTER_KEYBOARD_LAYOUTS.piano.noteOffsets), true);
  assert.deepEqual(COMPUTER_KEYBOARD_DEFAULTS, {
    layout: "piano",
    baseNote: 48,
    channel: 0,
    velocity: 100,
  });

  const keyboardOnly = computerKeyboardRuntime({ webMidi: false });
  const keyboardMessages = [];
  const keyboardManager = new WebMidiManager(keyboardOnly.runtime);
  keyboardManager.setProfile("ni-maschine-mikro-mk3");
  keyboardManager.registerClient({
    id: "keyboard-only",
    onMessage: (message, nativeEvent) => keyboardMessages.push({ message, nativeEvent }),
  });

  assert.equal(await keyboardManager.enable(), null);
  assert.equal(keyboardOnly.calls.length, 0);
  assert.equal(keyboardManager.enabled, true);
  assert.equal(keyboardManager.status().webMidiSupported, false);
  assert.equal(keyboardManager.status().computerKeyboard.active, true);
  assert.match(keyboardManager.status().hardwareError, /unavailable/);
  assert.equal(keyboardOnly.document.listenerCount("keydown"), 1);
  assert.equal(keyboardOnly.document.listenerCount("keyup"), 1);

  const down = computerKey("KeyQ");
  keyboardOnly.document.emit("keydown", down);
  assert.equal(down.prevented, true);
  assert.deepEqual(keyboardMessages.at(-1), {
    message: {
      type: "noteOn",
      channel: 0,
      note: 60,
      velocity: 100,
      raw: [0x90, 60, 100],
      sourceId: "computer-keyboard:keyboard-only",
      profileId: "generic",
      input: {
        id: "computer-keyboard",
        name: "Computer keyboard",
        manufacturer: "Morphazoid",
        state: "connected",
      },
      timestamp: 456.75,
      logical: {
        type: "note",
        note: 60,
        velocity: 100,
        normalized: 100 / 127,
        gate: true,
      },
      virtual: true,
    },
    nativeEvent: down,
  });
  assert.equal(Object.isFrozen(keyboardMessages.at(-1).message), true);
  assert.equal(Object.isFrozen(keyboardMessages.at(-1).message.raw), true);
  assert.equal(Object.isFrozen(keyboardMessages.at(-1).message.logical), true);
  assert.equal(
    keyboardMessages.at(-1).message.profileId,
    "generic",
    "hardware controller profiles must not reinterpret computer keys as pads",
  );

  const up = computerKey("KeyQ");
  keyboardOnly.document.emit("keyup", up);
  assert.equal(up.prevented, true);
  assert.equal(keyboardMessages.at(-1).message.type, "noteOff");
  assert.equal(keyboardMessages.at(-1).message.note, 60);
  assert.equal(keyboardMessages.at(-1).message.velocity, 0);
  assert.deepEqual(keyboardMessages.at(-1).message.raw, [0x80, 60, 0]);
  assert.deepEqual(keyboardMessages.at(-1).message.logical, {
    type: "note",
    note: 60,
    velocity: 0,
    normalized: 0,
    gate: false,
  });
  keyboardManager.disable();

  const denied = computerKeyboardRuntime({
    requests: [() => Promise.reject(new Error("permission denied"))],
  });
  const deniedMessages = [];
  const deniedManager = new WebMidiManager(denied.runtime);
  deniedManager.registerClient({
    id: "permission-fallback",
    onMessage: (message) => deniedMessages.push(message),
  });
  assert.equal(await deniedManager.enable(), null);
  assert.equal(deniedManager.enabled, true);
  assert.equal(deniedManager.status().computerKeyboard.active, true);
  assert.equal(deniedManager.status().hardwareError, "permission denied");
  denied.document.emit("keydown", computerKey("KeyZ"));
  assert.equal(deniedMessages.at(-1).note, 48);
  deniedManager.disable();
});

test("computer keys ignore repeats, shortcuts, and editable targets while controls change future notes", async () => {
  const { runtime, document } = computerKeyboardRuntime({ requests: [new FakeMidiAccess()] });
  const manager = new WebMidiManager(runtime);
  const messages = [];
  manager.registerClient({ id: "piano", onMessage: (message) => messages.push(message) });
  await manager.enable();

  const editableTargets = [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "DIV", getAttribute: (name) => name === "role" ? "slider" : null },
    {
      tagName: "SPAN",
      getAttribute: () => null,
      closest: () => ({ tagName: "DIV", isContentEditable: true }),
    },
  ];
  for (const target of editableTargets) {
    document.emit("keydown", computerKey("KeyQ", { target }));
  }
  for (const extras of [
    { repeat: true },
    { isComposing: true },
    { defaultPrevented: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ]) {
    document.emit("keydown", computerKey("KeyQ", extras));
  }
  document.emit("keydown", computerKey("Escape"));
  assert.equal(messages.length, 0);

  const firstDown = computerKey("KeyQ");
  document.emit("keydown", firstDown);
  document.emit("keydown", computerKey("KeyQ"));
  document.emit("keydown", computerKey("KeyQ", { repeat: true }));
  assert.equal(messages.length, 1, "one physical key owns at most one held note");
  assert.equal(firstDown.prevented, true);

  const editableUp = computerKey("KeyQ", { target: { tagName: "INPUT" }, ctrlKey: true });
  document.emit("keyup", editableUp);
  assert.equal(messages.length, 2, "keyup must release a note after focus moves into a field");
  assert.equal(messages.at(-1).type, "noteOff");
  assert.equal(editableUp.prevented, true);
  document.emit("keyup", computerKey("KeyQ"));
  assert.equal(messages.length, 2, "an orphan keyup is inert");

  const octaveUp = computerKey("BracketRight");
  document.emit("keydown", octaveUp);
  assert.equal(octaveUp.prevented, true);
  assert.equal(manager.status().computerKeyboard.octave, 1);
  document.emit("keydown", computerKey("KeyQ"));
  assert.equal(messages.at(-1).note, 72);
  document.emit("keyup", computerKey("KeyQ"));

  const velocityUp = computerKey("Equal");
  document.emit("keydown", velocityUp);
  assert.equal(velocityUp.prevented, true);
  assert.equal(manager.status().computerKeyboard.velocity, 108);
  document.emit("keydown", computerKey("KeyZ"));
  assert.equal(messages.at(-1).velocity, 108);
  document.emit("keyup", computerKey("KeyZ"));

  assert.equal(manager.setComputerKeyboardOctave(99), 3);
  assert.equal(manager.setComputerKeyboardOctave(-99), -3);
  assert.equal(manager.setComputerKeyboardVelocity(999), 127);
  assert.equal(manager.setComputerKeyboardVelocity(-99), 1);
  document.emit("keydown", computerKey("KeyQ"));
  assert.equal(messages.at(-1).note, 24);
  assert.equal(messages.at(-1).velocity, 1);
  document.emit("keyup", computerKey("KeyQ"));
  manager.disable();
});

test("blur, visibility, disable, and unregister release computer notes and clean up listeners", async () => {
  const access = new FakeMidiAccess();
  const { runtime, document, runtimeEvents } = computerKeyboardRuntime({ requests: [access] });
  const manager = new WebMidiManager(runtime);
  const deliveries = [];
  const unregister = manager.registerClient({
    id: "lifecycle",
    onMessage: (message, nativeEvent) => deliveries.push({ message, nativeEvent }),
  });
  await manager.enable();

  document.emit("keydown", computerKey("KeyZ"));
  document.emit("keydown", computerKey("KeyQ"));
  runtimeEvents.emit("blur");
  const blurReleases = deliveries.filter(({ message }) => message.reason === "keyboard-blur");
  assert.deepEqual(blurReleases.map(({ message }) => message.note), [48, 60]);
  assert.equal(blurReleases.every(({ message, nativeEvent }) => (
    message.type === "noteOff"
    && message.synthetic === true
    && message.virtual === true
    && nativeEvent === null
  )), true);
  const afterBlur = deliveries.length;
  runtimeEvents.emit("blur");
  document.emit("keyup", computerKey("KeyZ"));
  document.emit("keyup", computerKey("KeyQ"));
  assert.equal(deliveries.length, afterBlur, "panic clears ownership exactly once");

  document.emit("keydown", computerKey("KeyX"));
  document.hidden = true;
  document.emit("visibilitychange");
  assert.equal(deliveries.at(-1).message.reason, "keyboard-hidden");
  assert.equal(deliveries.at(-1).message.note, 50);
  document.hidden = false;

  document.emit("keydown", computerKey("KeyC"));
  manager.disable();
  assert.equal(
    deliveries.some(({ message }) => message.reason === "manager-disabled" && message.note === 52),
    true,
  );
  assert.equal(document.listenerCount("keydown"), 0);
  assert.equal(document.listenerCount("keyup"), 0);
  assert.equal(document.listenerCount("visibilitychange"), 0);
  assert.equal(runtimeEvents.listenerCount("blur"), 0);
  const afterDisable = deliveries.length;
  document.emit("keydown", computerKey("KeyQ"));
  assert.equal(deliveries.length, afterDisable);

  await manager.enable();
  assert.equal(document.listenerCount("keydown"), 1, "re-enable attaches one listener");
  document.emit("keydown", computerKey("KeyV"));
  unregister();
  assert.equal(deliveries.at(-1).message.reason, "client-unregistered");
  assert.equal(deliveries.at(-1).message.note, 53);
  assert.equal(document.listenerCount("keydown"), 0);
  assert.equal(document.listenerCount("keyup"), 0);
  manager.disable();
});

test("per-client piano and pad layouts coexist with hardware and keep independent sources", async () => {
  const hardware = new FakeMidiInput({
    id: "maschine",
    name: "MASCHINE MIKRO MK3",
    manufacturer: "Native Instruments",
  });
  const access = new FakeMidiAccess([hardware]);
  const { runtime, document } = computerKeyboardRuntime({ requests: [access] });
  const manager = new WebMidiManager(runtime);
  manager.setProfile("ni-maschine-mikro-mk3");
  const pianoMessages = [];
  const padMessages = [];
  const unregisterPiano = manager.registerClient({
    id: "piano",
    onMessage: (message) => pianoMessages.push(message),
  });
  const unregisterPads = manager.registerClient({
    id: "fm-drums",
    computerKeyboard: { layout: "pad-grid", channel: 9, velocity: 72 },
    onMessage: (message) => padMessages.push(message),
  });
  await manager.enable();

  document.emit("keydown", computerKey("Digit1"));
  assert.equal(pianoMessages.length, 0);
  assert.deepEqual(padMessages.at(-1).raw, [0x99, 36, 72]);
  assert.equal(padMessages.at(-1).sourceId, "computer-keyboard:fm-drums");
  assert.equal(padMessages.at(-1).profileId, "generic");
  assert.equal(padMessages.at(-1).logical.type, "note");
  document.emit("keyup", computerKey("Digit1"));

  document.emit("keydown", computerKey("KeyQ"));
  assert.equal(pianoMessages.at(-1).note, 60);
  assert.equal(pianoMessages.at(-1).sourceId, "computer-keyboard:piano");
  assert.equal(padMessages.at(-1).note, 40);
  assert.equal(padMessages.at(-1).sourceId, "computer-keyboard:fm-drums");
  document.emit("keyup", computerKey("KeyQ"));

  hardware.send([0x90, 36, 127]);
  assert.equal(pianoMessages.at(-1).sourceId, "web-midi:maschine");
  assert.equal(padMessages.at(-1).sourceId, "web-midi:maschine");
  assert.equal(pianoMessages.at(-1).profileId, "ni-maschine-mikro-mk3");
  assert.deepEqual(pianoMessages.at(-1).logical, {
    type: "pad",
    index: 0,
    note: 36,
    velocity: 127,
    normalized: 1,
    gate: true,
  });

  document.emit("keydown", computerKey("Digit2"));
  unregisterPads();
  assert.equal(padMessages.at(-1).reason, "client-unregistered");
  assert.equal(padMessages.at(-1).note, 37);
  assert.equal(document.listenerCount("keydown"), 1, "the remaining piano client retains QWERTY");
  assert.equal(hardware.listenerCount("midimessage"), 1, "virtual cleanup does not detach hardware");
  unregisterPiano();
  assert.equal(document.listenerCount("keydown"), 0);
  assert.equal(hardware.listenerCount("midimessage"), 1);
  manager.disable();
});

test("explicit enable requests no SysEx, delivers compatible events, disables safely, and re-enables", async () => {
  const firstInput = new FakeMidiInput({ id: "keyboard-a", name: "Plain Keyboard" });
  const secondInput = new FakeMidiInput({ id: "keyboard-b", name: "Second Keyboard" });
  const firstAccess = new FakeMidiAccess([firstInput]);
  const secondAccess = new FakeMidiAccess([secondInput]);
  const { runtime, calls, storage } = runtimeWithRequests([firstAccess, secondAccess]);
  const manager = new WebMidiManager(runtime);
  const order = [];
  const enabledChanges = [];
  const messages = [];
  manager.registerClient({
    id: "instrument",
    onPrepareEnable: () => order.push("prepare"),
    onEnabledChange: (enabled) => enabledChanges.push(enabled),
    onMessage: (message, nativeEvent) => messages.push({ message, nativeEvent }),
  });
  runtime.navigator.requestMIDIAccess = ((request) => (options) => {
    order.push("request");
    return request(options);
  })(runtime.navigator.requestMIDIAccess);

  const firstEnable = manager.enable();
  assert.equal(manager.status().enabling, true);
  assert.deepEqual(order, ["prepare", "request"]);
  assert.equal(manager.enable(), firstEnable, "concurrent enable calls share one permission request");
  assert.equal(await firstEnable, firstAccess);
  assert.deepEqual(calls, [{ sysex: false }]);
  assert.equal(manager.enabled, true);
  assert.equal(firstInput.listenerCount("midimessage"), 1);
  assert.equal(firstAccess.listenerCount("statechange"), 1);
  assert.deepEqual(enabledChanges, [false, true]);

  firstInput.send([0x92, 60, 101]);
  const note = messages.at(-1);
  assert.equal(note.nativeEvent.receivedTime, 123.5);
  assert.deepEqual(note.message, {
    type: "noteOn",
    channel: 2,
    note: 60,
    velocity: 101,
    raw: [0x92, 60, 101],
    sourceId: "web-midi:keyboard-a",
    profileId: "generic",
    input: {
      id: "keyboard-a",
      name: "Plain Keyboard",
      manufacturer: "",
      state: "connected",
    },
    timestamp: 123.5,
    logical: {
      type: "note",
      note: 60,
      velocity: 101,
      normalized: 101 / 127,
      gate: true,
    },
  });
  assert.equal(Object.isFrozen(note.message), true);
  assert.equal(Object.isFrozen(note.message.raw), true);
  assert.equal(Object.isFrozen(note.message.logical), true);

  firstInput.send([0xe2, 0, 64]);
  assert.equal(messages.at(-1).message.type, "pitchBend");
  assert.equal(messages.at(-1).message.normalized, 0);
  assert.deepEqual(messages.at(-1).message.logical, { type: "pitchBend", normalized: 0 });

  assert.equal(manager.disable(), true);
  const panic = messages.at(-1);
  assert.equal(panic.nativeEvent, null);
  assert.equal(panic.message.type, "controlChange");
  assert.equal(panic.message.controller, 120);
  assert.equal(panic.message.synthetic, true);
  assert.equal(panic.message.reason, "manager-disabled");
  assert.equal(panic.message.logical.standard, "allSoundOff");
  assert.equal(firstInput.listenerCount("midimessage"), 0);
  assert.equal(firstAccess.listenerCount("statechange"), 0);
  assert.deepEqual(enabledChanges, [false, true, false]);
  assert.equal(manager.disable(), false);

  assert.equal(await manager.enable(), secondAccess);
  assert.equal(secondInput.listenerCount("midimessage"), 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { sysex: false });
  assert.equal(storage.values.has("morphazoid:midi:enabled"), false);
  manager.disable();
});

test("disable invalidates pending permission and an older result cannot replace a re-enabled access", async () => {
  const firstPermission = deferred();
  const secondPermission = deferred();
  const firstAccess = new FakeMidiAccess([
    new FakeMidiInput({ id: "late", name: "Late Input" }),
  ]);
  const secondAccess = new FakeMidiAccess([
    new FakeMidiInput({ id: "current", name: "Current Input" }),
  ]);
  const { runtime, calls } = runtimeWithRequests([
    firstPermission.promise,
    secondPermission.promise,
  ]);
  const manager = new WebMidiManager(runtime);
  let preparations = 0;
  manager.registerClient({ id: "instrument", onPrepareEnable: () => { preparations += 1; } });

  const staleEnable = manager.enable();
  assert.equal(manager.disable(), true);
  const currentEnable = manager.enable();
  assert.equal(calls.length, 2);
  assert.equal(preparations, 2);

  secondPermission.resolve(secondAccess);
  assert.equal(await currentEnable, secondAccess);
  assert.equal(manager.access, secondAccess);
  firstPermission.resolve(firstAccess);
  assert.equal(await staleEnable, null);
  assert.equal(manager.access, secondAccess);
  assert.equal(firstAccess.listenerCount("statechange"), 0);
  assert.equal(firstAccess.inputs.values().next().value.listenerCount("midimessage"), 0);
  manager.disable();
});

test("Auto resolves profiles per input, assigns distinct stable source IDs, and handles hotplug panic", async () => {
  const kontrol = new FakeMidiInput({
    id: "duplicate-id",
    name: "Komplete Kontrol S49 MK2",
    manufacturer: "",
  });
  const maschine = new FakeMidiInput({
    id: "duplicate-id",
    name: "MASCHINE MIKRO MK3",
    manufacturer: "Native Instruments",
  });
  const access = new FakeMidiAccess([kontrol, maschine]);
  const { runtime } = runtimeWithRequests([access]);
  const manager = new WebMidiManager(runtime);
  const messages = [];
  const profiles = [];
  manager.registerClient({
    id: "instrument",
    onMessage: (message) => messages.push(message),
    onProfileChange: (profile) => profiles.push(profile),
  });
  await manager.enable();

  const inputStatuses = manager.status().inputs;
  assert.equal(inputStatuses.length, 2);
  assert.equal(new Set(inputStatuses.map(({ sourceId }) => sourceId)).size, 2);
  assert.deepEqual(
    inputStatuses.map(({ profileId }) => profileId).sort(),
    ["ni-komplete-kontrol-s49-mk2", "ni-maschine-mikro-mk3"].sort(),
  );
  const kontrolSource = inputStatuses.find(({ name }) => name.includes("S49")).sourceId;

  kontrol.send([0xb0, 14, 64]);
  assert.deepEqual(messages.at(-1).logical, {
    type: "macro",
    index: 0,
    controller: 14,
    value: 64,
    normalized: 64 / 127,
    standard: null,
  });
  maschine.send([0x90, 36, 127]);
  assert.deepEqual(messages.at(-1).logical, {
    type: "pad",
    index: 0,
    note: 36,
    velocity: 127,
    normalized: 1,
    gate: true,
  });

  access.disconnect(kontrol);
  const disconnectPanic = messages.at(-1);
  assert.equal(disconnectPanic.synthetic, true);
  assert.equal(disconnectPanic.reason, "input-disconnected");
  assert.equal(disconnectPanic.sourceId, kontrolSource);
  assert.equal(kontrol.listenerCount("midimessage"), 0);
  assert.equal(manager.status().inputCount, 1);
  assert.equal(profiles.at(-1).resolvedInputs.length, 1);

  access.connect(kontrol, "reconnected-kontrol");
  assert.equal(kontrol.listenerCount("midimessage"), 1);
  assert.equal(
    manager.status().inputs.find(({ name }) => name.includes("S49")).sourceId,
    kontrolSource,
    "the same hot-plugged input object keeps its source identity",
  );
  manager.disable();
});

test("manual profiles override Auto, persist, and expose normalized macro and pad mappings", async () => {
  const input = new FakeMidiInput({
    id: "ni-input",
    name: "MASCHINE MIKRO MK3",
    manufacturer: "Native Instruments",
  });
  const access = new FakeMidiAccess([input]);
  const storage = fakeStorage();
  const { runtime } = runtimeWithRequests([access], storage);
  const manager = new WebMidiManager(runtime);
  const messages = [];
  const profileChanges = [];
  manager.registerClient({
    id: "instrument",
    onMessage: (message) => messages.push(message),
    onProfileChange: (profile) => profileChanges.push(profile),
  });
  await manager.enable();
  assert.equal(manager.status().inputs[0].profileId, "ni-maschine-mikro-mk3");

  const selected = manager.setProfile("novation-launchkey");
  assert.equal(selected, MIDI_PROFILE_REGISTRY["novation-launchkey"]);
  assert.equal(manager.status().inputs[0].profileId, "novation-launchkey");
  assert.equal(storage.values.get(MIDI_PROFILE_STORAGE_KEY), "novation-launchkey");
  assert.equal(profileChanges.at(-1).selectedProfileId, "novation-launchkey");
  input.send([0xb0, 21, 32]);
  assert.equal(messages.at(-1).logical.type, "macro");
  assert.equal(messages.at(-1).logical.index, 0);
  assert.equal(messages.at(-1).logical.normalized, 32 / 127);

  manager.setProfile("custom");
  input.send([0xb0, 21, 32]);
  assert.deepEqual(messages.at(-1).logical, {
    type: "cc",
    controller: 21,
    value: 32,
    normalized: 32 / 127,
    standard: null,
  });
  input.send([0x90, 36, 80]);
  assert.equal(messages.at(-1).logical.type, "note");
  assert.throws(() => manager.setProfile("does-not-exist"), /Unknown MIDI profile/);
  manager.disable();
});

test("all channel voice, transport realtime, and song-position messages are delivered semantically", async () => {
  const input = new FakeMidiInput({ id: "complete", name: "Complete Controller" });
  const access = new FakeMidiAccess([input]);
  const { runtime } = runtimeWithRequests([access]);
  const manager = new WebMidiManager(runtime);
  const messages = [];
  manager.registerClient({ id: "instrument", onMessage: (message) => messages.push(message) });
  await manager.enable();

  input.send([0xa3, 64, 96]);
  assert.deepEqual(messages.at(-1), {
    type: "polyPressure",
    channel: 3,
    note: 64,
    pressure: 96,
    normalized: 96 / 127,
    raw: [0xa3, 64, 96],
    sourceId: "web-midi:complete",
    profileId: "generic",
    input: {
      id: "complete",
      name: "Complete Controller",
      manufacturer: "",
      state: "connected",
    },
    timestamp: 123.5,
    logical: {
      type: "polyPressure",
      note: 64,
      pressure: 96,
      normalized: 96 / 127,
    },
  });

  input.send([0xc3, 17]);
  assert.equal(messages.at(-1).type, "programChange");
  assert.equal(messages.at(-1).channel, 3);
  assert.equal(messages.at(-1).program, 17);
  assert.deepEqual(messages.at(-1).logical, { type: "programChange", program: 17 });

  input.send([0xd3, 65]);
  assert.equal(messages.at(-1).type, "channelPressure");
  assert.equal(messages.at(-1).pressure, 65);
  assert.deepEqual(messages.at(-1).logical, {
    type: "channelPressure",
    pressure: 65,
    normalized: 65 / 127,
  });

  for (const [status, type] of [
    [0xf8, "timingClock"],
    [0xfa, "start"],
    [0xfb, "continue"],
    [0xfc, "stop"],
  ]) {
    input.send([status]);
    assert.equal(messages.at(-1).type, type);
    assert.equal("channel" in messages.at(-1), false);
    assert.deepEqual(messages.at(-1).raw, [status]);
    assert.deepEqual(messages.at(-1).logical, { type });
  }

  input.send([0xf2, 0x34, 0x12]);
  assert.equal(messages.at(-1).type, "songPosition");
  assert.equal(messages.at(-1).position, 0x934);
  assert.equal(messages.at(-1).sixteenths, 0x934);
  assert.deepEqual(messages.at(-1).logical, {
    type: "songPosition",
    position: 0x934,
    sixteenths: 0x934,
  });

  const beforeIgnored = messages.length;
  input.send([0xf1, 1]);
  input.send([0xa0, 60]);
  input.send([0xc0]);
  input.send([0xf2, 1]);
  assert.equal(messages.length, beforeIgnored, "unsupported or truncated messages are ignored");
  manager.disable();
});

test("standard expression, sustain, and panic CCs remain raw while profile logic is added", async () => {
  const input = new FakeMidiInput({ id: "standard", name: "Standard Controller" });
  const access = new FakeMidiAccess([input]);
  const { runtime } = runtimeWithRequests([access]);
  const manager = new WebMidiManager(runtime);
  manager.setProfile("custom");
  const messages = [];
  manager.registerClient({ id: "instrument", onMessage: (message) => messages.push(message) });
  await manager.enable();

  for (const [controller, standard] of [
    [11, "expression"],
    [64, "sustain"],
    [120, "allSoundOff"],
    [121, "resetControllers"],
    [123, "allNotesOff"],
  ]) {
    input.send([0xb4, controller, 99]);
    const message = messages.at(-1);
    assert.equal(message.type, "controlChange");
    assert.equal(message.channel, 4);
    assert.equal(message.controller, controller);
    assert.equal(message.value, 99);
    assert.deepEqual(message.raw, [0xb4, controller, 99]);
    assert.equal(message.logical.type, "cc");
    assert.equal(message.logical.standard, standard);
  }

  input.send([0x91, 48, 0]);
  assert.equal(messages.at(-1).type, "noteOff", "zero-velocity note-on is note-off");
  const beforeIgnored = messages.length;
  input.send([0xf1, 0]);
  input.send([0xf4]);
  assert.equal(messages.length, beforeIgnored, "unsupported system messages are ignored");
  manager.disable();
});

test("MIDI output selection, scheduling, hotplug, clear, and panic stay one-port and safe", async () => {
  const first = new FakeMidiOutput({
    id: "out-a",
    name: "WAX DAW MIDI",
    manufacturer: "Audio Fusion",
  });
  const second = new FakeMidiOutput({
    id: "out-b",
    name: "Hardware Synth",
    clearSupported: false,
  });
  const access = new FakeMidiAccess([], [first, second]);
  const { runtime } = runtimeWithRequests([access]);
  const manager = new WebMidiManager(runtime);
  const incoming = [];
  manager.registerClient({ id: "midi-fx", onMessage: (message) => incoming.push(message) });
  await manager.enable();

  const initial = manager.status();
  assert.equal(initial.outputCount, 2);
  assert.equal(initial.outputSelectionId, null);
  assert.equal(initial.selectedOutputId, "out-a");
  assert.deepEqual(initial.selectedOutput, {
    id: "out-a",
    name: "WAX DAW MIDI",
    manufacturer: "Audio Fusion",
    state: "connected",
    connection: "open",
  });
  assert.equal(Object.isFrozen(initial.outputs), true);
  assert.equal(Object.isFrozen(initial.outputs[0]), true);
  assert.doesNotThrow(() => JSON.stringify(initial));
  assert.equal(manager.clearOutput(), true);
  assert.equal(first.clearCalls, 1);

  assert.equal(manager.send([0x90, 60, 100], 500.25), true);
  assert.deepEqual(first.sent, [{ data: [0x90, 60, 100], timestamp: 500.25 }]);
  assert.deepEqual(second.sent, []);
  assert.deepEqual(incoming, [], "outgoing MIDI is never echoed to registered input clients");

  assert.deepEqual(manager.selectOutput("out-b"), initial.outputs[1]);
  assert.equal(first.clearCalls, 2, "changing outputs clears queued events on the old output");
  assert.equal(first.sent.length, 49, "changing outputs sends three panic CCs on all channels");
  assert.equal(manager.outputSelectionId, "out-b");
  assert.equal(manager.selectedOutputId, "out-b");
  assert.equal(manager.send(new Uint8Array([0xb4, 74, 99])), true);
  assert.deepEqual(second.sent, [{ data: [0xb4, 74, 99], timestamp: undefined }]);
  assert.equal(manager.clearOutput(), false);

  assert.throws(() => manager.selectOutput("missing"), /Unknown or disconnected/);
  assert.throws(() => manager.send([]), /status byte/);
  assert.throws(() => manager.send([0x40, 1]), /status byte/);
  assert.throws(() => manager.send([0x90, 256, 1]), /0 to 255/);
  assert.throws(() => manager.send([0xf0, 1, 0xf7]), /SysEx/);
  assert.throws(() => manager.send([0x90, 60, 1], Number.NaN), /timestamp/);

  access.disconnectOutput(second);
  assert.equal(manager.status().outputCount, 1);
  assert.equal(manager.status().outputSelectionId, "out-b", "explicit selection survives hot-unplug");
  assert.equal(manager.status().selectedOutputId, null, "an explicit disconnected port never falls through");
  assert.equal(manager.send([0x90, 62, 100]), false);
  assert.equal(first.sent.length, 49, "explicit selection never leaks to the default port");

  access.connectOutput(second, "reconnected-output");
  assert.equal(manager.selectedOutputId, "out-b");
  assert.equal(manager.send([0x90, 64, 100]), true);
  assert.deepEqual(second.sent.at(-1), { data: [0x90, 64, 100], timestamp: undefined });

  manager.selectOutput(null);
  assert.equal(manager.outputSelectionId, null);
  assert.equal(manager.selectedOutputId, "out-a");
  assert.equal(second.sent.length, 50, "leaving an output performs a complete channel panic");
  access.disconnectOutput(first);
  assert.equal(manager.selectedOutputId, "out-b", "auto mode advances to the next connected output");

  const beforePanic = second.sent.length;
  assert.equal(manager.panic(750), 48);
  assert.equal(second.sent.length, beforePanic + 48);
  assert.deepEqual(second.sent.at(-3), { data: [0xbf, 120, 0], timestamp: 750 });
  assert.deepEqual(second.sent.at(-2), { data: [0xbf, 123, 0], timestamp: 750 });
  assert.deepEqual(second.sent.at(-1), { data: [0xbf, 121, 0], timestamp: 750 });
  assert.equal(manager.resetOutput(), 48);

  const beforeDisable = second.sent.length;
  manager.disable();
  assert.equal(second.sent.length, beforeDisable + 48, "disable panics the active output");
  assert.equal(manager.status().outputCount, 0);
  assert.equal(manager.selectedOutputId, null);
  assert.equal(manager.send([0x90, 60, 100]), false);
});

test("permission failures recover, unsupported runtimes reject, and observers cannot break delivery", async () => {
  const unsupported = new WebMidiManager({ navigator: {} });
  await assert.rejects(unsupported.enable(), /not available/);
  assert.equal(unsupported.status().enabling, false);

  const input = new FakeMidiInput();
  const access = new FakeMidiAccess([input]);
  const { runtime, calls } = runtimeWithRequests([
    () => Promise.reject(new Error("permission denied")),
    access,
  ]);
  const manager = new WebMidiManager(runtime);
  manager.subscribeStatus(() => { throw new Error("status observer failure"); });
  manager.registerClient({
    id: "throwing-client",
    onMessage: () => { throw new Error("message observer failure"); },
  });
  const received = [];
  const unregister = manager.registerClient({
    id: "healthy-client",
    onMessage: (message) => received.push(message),
  });

  await assert.rejects(manager.enable(), /permission denied/);
  assert.equal(manager.enabled, false);
  assert.equal(manager.status().enabling, false);
  assert.equal(await manager.enable(), access);
  assert.equal(calls.length, 2);
  input.send([0x90, 60, 100]);
  assert.equal(received.length, 1, "a failing client cannot prevent delivery to another client");
  unregister();
  input.send([0x90, 62, 100]);
  assert.equal(received.length, 1);
  manager.disable();
});
