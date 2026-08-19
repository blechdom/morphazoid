import assert from "node:assert/strict";
import test from "node:test";

import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";
import {
  HYPER_RUBIX_BOUNDARY_CELLS,
  HYPER_RUBIX_CORNER_STREAM_LENGTH,
  HYPER_RUBIX_HYPERBAR_LENGTH,
  HYPER_RUBIX_STICKER_STREAM_LENGTH,
  HYPER_RUBIX_TECHNO_VOICES,
  createHyperRubixHyperbarSnapshot,
  createHyperRubixStickerStream,
  createSolvedHyperRubix,
  hyperRubixTechnoVoiceParameters,
  turnHyperRubixBoundaryCell,
} from "../src/hyper-rubix.js";
import { WAX_ROLE_IDS, waxSupportForId } from "../src/wax-instrument-roles.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeNode {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.tabIndex = this.tagName === "BUTTON" ? 0 : -1;
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value)),
      getPropertyValue: (name) => this.style.values.get(name) ?? "",
    };
    this.scrollLeft = 0;
    this.scrollWidth = 0;
    this.scrollIntoViewCalls = [];
    this.isFragment = false;
    this.ownerDocument = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node?.isFragment) this.children.push(...node.children);
      else this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  querySelector(selector) {
    const tagName = String(selector).toUpperCase();
    return this.children.find((child) => child.tagName === tagName) ?? null;
  }

  dispatchEvent(event) {
    const delivered = {
      type: event.type,
      target: this,
      currentTarget: this,
      preventDefault() {},
    };
    for (const listener of this.listeners.get(event.type) ?? []) listener(delivered);
    return true;
  }

  click() {
    this.dispatchEvent({ type: "click" });
  }

  async emit(type, properties = {}) {
    let defaultPrevented = false;
    const event = {
      type,
      target: this,
      currentTarget: this,
      isPrimary: true,
      button: 0,
      preventDefault() { defaultPrevented = true; },
      ...properties,
    };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
    return { ...event, defaultPrevented };
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 900, height: 680 };
  }

  setPointerCapture() {}

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    this.dispatchEvent({ type: "focus" });
  }

  scrollIntoView(options) {
    this.scrollIntoViewCalls.push(options);
  }
}

function audioParam(value = 0) {
  return {
    value,
    events: [],
    cancelScheduledValues(time) { this.events.push(["cancel", time]); },
    setValueAtTime(next, time) {
      this.value = next;
      this.events.push(["set", next, time]);
    },
    setTargetAtTime(next, time, constant) {
      this.value = next;
      this.events.push(["target", next, time, constant]);
    },
    exponentialRampToValueAtTime(next, time) {
      this.value = next;
      this.events.push(["exponential", next, time]);
    },
    linearRampToValueAtTime(next, time) {
      this.value = next;
      this.events.push(["linear", next, time]);
    },
    setValueCurveAtTime(values, time, duration) {
      this.value = values.at(-1) ?? this.value;
      this.events.push(["curve", [...values], time, duration]);
    },
  };
}

function audioNode(kind, properties = {}) {
  return {
    kind,
    connections: [],
    disconnected: false,
    ...properties,
    connect(destination) {
      this.connections.push(destination);
      return destination;
    },
    disconnect(destination) {
      this.disconnected = true;
      if (destination) {
        this.connections = this.connections.filter((candidate) => candidate !== destination);
      } else {
        this.connections = [];
      }
    },
  };
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48_000;
    this.state = "running";
    this.destination = audioNode("destination");
    this.gains = [];
    this.compressors = [];
    this.oscillators = [];
    this.bufferSources = [];
    this.filters = [];
    this.panners = [];
    this.waveShapers = [];
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const node = audioNode("gain", { gain: audioParam(1) });
    this.gains.push(node);
    return node;
  }

  createDynamicsCompressor() {
    const node = audioNode("compressor", {
      threshold: audioParam(),
      knee: audioParam(),
      ratio: audioParam(),
      attack: audioParam(),
      release: audioParam(),
    });
    this.compressors.push(node);
    return node;
  }

  createStereoPanner() {
    const node = audioNode("panner", { pan: audioParam() });
    this.panners.push(node);
    return node;
  }

  createOscillator() {
    const ended = [];
    const node = audioNode("oscillator", {
      type: "sine",
      frequency: audioParam(),
      detune: audioParam(),
      starts: [],
      stops: [],
      addEventListener(type, listener) {
        if (type === "ended") ended.push(listener);
      },
      start(time) { this.starts.push(time); },
      stop(time) { this.stops.push(time); },
    });
    this.oscillators.push(node);
    return node;
  }

  createBiquadFilter() {
    const node = audioNode("filter", {
      type: "lowpass",
      frequency: audioParam(),
      Q: audioParam(),
    });
    this.filters.push(node);
    return node;
  }

  createWaveShaper() {
    const node = audioNode("waveshaper", {
      curve: null,
      oversample: "none",
    });
    this.waveShapers.push(node);
    return node;
  }

  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel) => data[channel] };
  }

  createBufferSource() {
    const node = audioNode("buffer-source", {
      buffer: null,
      loop: false,
      playbackRate: audioParam(1),
      addEventListener() {},
      starts: [],
      stops: [],
      start(time) { this.starts.push(time); },
      stop(time) { this.stops.push(time); },
    });
    this.bufferSources.push(node);
    return node;
  }

  async suspend() {
    this.state = "suspended";
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }
}

class FakeClock {
  constructor(now = 10_000) {
    this.now = now;
    this.nextId = 0;
    this.timers = new Map();
    this.schedules = [];
  }

  setTimeout(callback, delay = 0) {
    const handle = {
      id: ++this.nextId,
      unref() { return this; },
    };
    const timer = {
      callback,
      dueAt: this.now + Math.max(0, Number(delay) || 0),
      order: handle.id,
    };
    this.timers.set(handle, timer);
    this.schedules.push({
      callbackName: callback.name,
      delay: Math.max(0, Number(delay) || 0),
      dueAt: timer.dueAt,
    });
    return handle;
  }

  clearTimeout(handle) {
    this.timers.delete(handle);
  }

  advanceBy(milliseconds) {
    const target = this.now + milliseconds;
    let callbacks = 0;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((first, second) => (
          first[1].dueAt - second[1].dueAt || first[1].order - second[1].order
        ))[0];
      if (!due) break;
      const [handle, timer] = due;
      this.timers.delete(handle);
      this.now = timer.dueAt;
      timer.callback();
      callbacks += 1;
      assert.ok(callbacks < 2_000, "fake timer callbacks should settle");
    }
    this.now = target;
  }

  get pendingCount() {
    return this.timers.size;
  }
}

function drawingContext() {
  return {
    arc() {},
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    fillRect() {},
    fillText() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
    translate() {},
  };
}

function runtimeFixture() {
  const elementIds = [
    "stage", "stageWrap", "audioButton", "audioState", "audioError", "output", "outputOut",
    "puzzleState", "disorderState", "moveCount", "stageReadout", "liveStatus", "moveTrace",
    "puzzleSize", "puzzleSizeHelp", "puzzleOrderHeading",
    "stickerStreamMethodOption", "cornerStreamMethodOption", "stickerHyperbarMethodOption",
    "hybridCoilMethodOption", "hyperbarMatrixLabel", "hyperbarMatrixSummary",
    "rattleVoiceLabel", "puzzleGeometryGuide", "hyperbarGeometryGuide", "streamGeometryGuide",
    "serializationInstructions",
    "planePicker", "planeHelp", "twistSummary", "turnPlaneDiagram", "turnCellDiagram",
    "turnCounterclockwise", "turnClockwise", "scramblePuzzle", "undoMove", "unwindPuzzle",
    "autoRotate", "autoRotateState", "motionSummary", "rotationSpeed", "rotationSpeedOut",
    "projectionDepth", "projectionDepthOut", "cellSeparation", "cellSeparationOut",
    "stickerScale", "stickerScaleOut", "resetView", "randomView", "voice", "voiceHelp", "soundSummary",
    "tone", "toneOut", "decay", "decayOut", "resetAll", "rotationReadout",
    "foldSound", "foldLevel", "foldLevelOut", "hearAutoDrift", "hearAutoDriftState",
    "rattleButton", "rattleState", "rattlesnakeControls", "rattleLevel", "rattleLevelOut", "rattleRate",
    "shapeInfluence", "shapeInfluenceOut",
    "topologyMode", "topologyLevel", "topologyLevelOut", "topologySpan", "topologySpanOut",
    "topologyStrum", "topologyStrumOut", "topologyRing", "topologyRingOut",
    "topologyWarp", "topologyWarpOut",
    "pitchInfluence", "pitchInfluenceOut", "filterInfluence", "filterInfluenceOut",
    "stereoInfluence", "stereoInfluenceOut", "neighborResponse", "neighborResponseOut",
    "wInfluence", "wInfluenceOut", "disorderInfluence", "disorderInfluenceOut",
    "clockSummary", "playButton", "playLabel", "playState", "restartLoop", "restartInstructions", "stepStrip",
    "sequenceNow", "sequenceVoice", "sequenceMethod", "sequenceMethodHelp", "sequencePattern",
    "playbackMode", "twistRate", "twistMotion", "hyperbarPanel", "hyperbarGrid", "hyperbarReadout",
    "tempo", "tempoOut", "reseedPattern", "swing", "swingOut", "twistDensity",
    "twistDensityOut",
  ];
  const elements = new Map(elementIds.map((id) => [id, new FakeNode("div", id)]));
  for (const id of [
    "audioButton", "turnCounterclockwise", "turnClockwise", "scramblePuzzle", "undoMove",
    "unwindPuzzle", "autoRotate", "resetView", "randomView", "resetAll", "playButton",
    "restartLoop", "reseedPattern", "rattleButton", "hearAutoDrift",
  ]) elements.get(id).tagName = "BUTTON";
  for (const id of [
    "output", "tempo", "swing", "twistDensity", "rotationSpeed", "projectionDepth",
    "cellSeparation", "stickerScale", "tone", "decay", "foldLevel", "rattleLevel", "shapeInfluence",
    "topologyLevel", "topologySpan", "topologyStrum", "topologyRing", "topologyWarp",
    "pitchInfluence", "filterInfluence", "stereoInfluence", "neighborResponse",
    "wInfluence", "disorderInfluence",
  ]) elements.get(id).tagName = "INPUT";
  for (const id of [
    "voice", "foldSound", "sequenceMethod", "sequencePattern", "playbackMode", "twistRate", "twistMotion", "rattleRate", "puzzleSize", "topologyMode",
  ]) {
    elements.get(id).tagName = "SELECT";
  }
  elements.get("voice").value = "pulse";
  elements.get("puzzleSize").value = "3";
  elements.get("foldSound").value = "glide";
  elements.get("foldLevel").value = "0.12";
  elements.get("sequenceMethod").value = "sticker-stream";
  elements.get("sequencePattern").value = "axis-break";
  elements.get("playbackMode").value = "forward";
  elements.get("twistRate").value = "2";
  elements.get("twistMotion").value = "off";
  elements.get("rattleRate").value = "4";
  elements.get("shapeInfluence").value = "0.72";
  elements.get("topologyMode").value = "mesh";
  elements.get("topologyLevel").value = "0.22";
  elements.get("topologySpan").value = "12";
  elements.get("topologyStrum").value = "0.018";
  elements.get("topologyRing").value = "0.48";
  elements.get("topologyWarp").value = "1";
  elements.get("stage").tagName = "CANVAS";
  elements.get("stage").getContext = () => drawingContext();
  elements.get("audioButton").setAttribute("aria-pressed", "false");
  elements.get("playButton").setAttribute("aria-pressed", "false");
  elements.get("rattleButton").setAttribute("aria-pressed", "false");
  elements.get("hearAutoDrift").setAttribute("aria-pressed", "false");
  elements.get("autoRotate").setAttribute("aria-pressed", "false");
  elements.get("audioError").hidden = true;
  elements.get("hyperbarPanel").hidden = false;
  elements.get("undoMove").disabled = true;
  elements.get("unwindPuzzle").disabled = true;

  const faceButtons = ["x-", "x+", "y-", "y+", "z-", "z+", "w-", "w+"].map((face) => {
    const button = new FakeNode("button");
    button.dataset.face = face;
    button.setAttribute("aria-pressed", String(face === "w+"));
    return button;
  });
  const dragButtons = ["orbit", "fold"].map((mode) => {
    const button = new FakeNode("button");
    button.dataset.dragMode = mode;
    button.setAttribute("aria-pressed", String(mode === "orbit"));
    return button;
  });
  const documentListeners = new Map();
  const windowListeners = new Map();
  const addListener = (listeners, type, listener) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  };
  const removeListener = (listeners, type, listener) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  };
  const documentObject = {
    activeElement: null,
    hidden: false,
    visibilityState: "visible",
    getElementById(id) { return elements.get(id) ?? null; },
    querySelectorAll(selector) {
      if (selector === "[data-face]") return faceButtons;
      if (selector === "[data-drag-mode]") return dragButtons;
      return [];
    },
    createElement(tagName) {
      const node = new FakeNode(tagName);
      node.ownerDocument = this;
      return node;
    },
    createDocumentFragment() {
      const fragment = new FakeNode("fragment");
      fragment.isFragment = true;
      fragment.ownerDocument = this;
      return fragment;
    },
    addEventListener(type, listener) { addListener(documentListeners, type, listener); },
    removeEventListener(type, listener) { removeListener(documentListeners, type, listener); },
  };
  const windowObject = {
    AudioContext: FakeAudioContext,
    devicePixelRatio: 2,
    matchMedia() { return { matches: true }; },
    addEventListener(type, listener) { addListener(windowListeners, type, listener); },
    removeEventListener(type, listener) { removeListener(windowListeners, type, listener); },
  };
  return {
    documentListeners,
    documentObject,
    dragButtons,
    elements,
    faceButtons,
    windowListeners,
    windowObject,
  };
}

async function emitRuntime(listeners, type, event = {}) {
  for (const listener of listeners.get(type) ?? []) await listener({ type, ...event });
  await Promise.resolve();
}

function installRuntimeEnvironment(t, fixture, clock = null) {
  const propertyNames = [
    "document", "window", "AudioContext", "webkitAudioContext", "ResizeObserver",
    "requestAnimationFrame", "cancelAnimationFrame",
    ...(clock ? ["performance", "setTimeout", "clearTimeout"] : []),
  ];
  const originals = new Map(propertyNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]));
  const originalWarn = console.warn;
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    console.warn = originalWarn;
  });

  let nextFrameId = 0;
  let queuedFrame = null;
  globalThis.document = fixture.documentObject;
  globalThis.window = fixture.windowObject;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.webkitAudioContext = undefined;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.requestAnimationFrame = (callback) => {
    nextFrameId += 1;
    queuedFrame = callback;
    return nextFrameId;
  };
  globalThis.cancelAnimationFrame = () => {};
  console.warn = () => {};

  if (clock) {
    Object.defineProperty(globalThis, "performance", {
      configurable: true,
      value: { now: () => clock.now },
    });
    globalThis.setTimeout = clock.setTimeout.bind(clock);
    globalThis.clearTimeout = clock.clearTimeout.bind(clock);
  }

  FakeAudioContext.instances.length = 0;
  return {
    hasQueuedFrame: () => typeof queuedFrame === "function",
    runFrame(time = clock?.now ?? performance.now()) {
      assert.equal(typeof queuedFrame, "function", "an animation frame should be queued");
      const callback = queuedFrame;
      queuedFrame = null;
      callback(time);
    },
    drainFrames(time = (clock?.now ?? performance.now()) + 700) {
      let nextTime = time;
      let count = 0;
      while (typeof queuedFrame === "function") {
        const callback = queuedFrame;
        queuedFrame = null;
        callback(nextTime);
        nextTime += 700;
        count += 1;
        assert.ok(count < 10, "animation frames should settle");
      }
    },
  };
}

function gridButtons(fixture) {
  return fixture.elements.get("hyperbarGrid").children.flatMap((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
}

async function setControl(fixture, id, value, eventType = "change") {
  const control = fixture.elements.get(id);
  control.value = String(value);
  await control.emit(eventType);
}

test("Hyper Rubix runtime keeps projection manual, auditions folds and twists, and survives BFCache", async (t) => {
  const fixture = runtimeFixture();
  const runtime = installRuntimeEnvironment(t, fixture);

  await import("../hyper-rubix-app.js?manual-runtime=" + Date.now());
  const baseTime = performance.now();
  runtime.runFrame(baseTime);

  assert.equal(fixture.elements.get("autoRotate").getAttribute("aria-pressed"), "false");
  assert.equal(fixture.elements.get("motionSummary").textContent, "manual projection");
  assert.equal(fixture.elements.get("sequenceMethod").value, "sticker-stream");
  assert.equal(fixture.elements.get("twistMotion").value, "off");
  assert.equal(fixture.elements.get("playLabel").textContent, "Play shape loop");
  assert.equal(fixture.elements.get("hyperbarPanel").hidden, false);
  assert.equal(gridButtons(fixture).length, HYPER_RUBIX_STICKER_STREAM_LENGTH);
  assert.equal(
    gridButtons(fixture).filter((cell) => cell.getAttribute("aria-selected") === "true").length,
    HYPER_RUBIX_STICKER_STREAM_LENGTH,
    "every sticker starts audible",
  );

  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1);
  const audioContext = FakeAudioContext.instances[0];
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "true");
  assert.equal(audioContext.compressors[0].connections.includes(audioContext.destination), true);
  assert.equal(
    audioContext.oscillators.filter(({ stops }) => stops.length === 0).length,
    49,
    "Fold W plus the bounded forty-eight-string topology graph stay reusable",
  );
  const persistentFold = audioContext.oscillators.find(({ stops }) => stops.length === 0);
  const foldFilter = persistentFold.connections[0];
  const foldPanner = foldFilter.connections[0];
  const foldGain = foldPanner.connections[0];
  assert.deepEqual(
    [foldFilter.kind, foldPanner.kind, foldGain.kind],
    ["filter", "panner", "gain"],
  );

  const stage = fixture.elements.get("stage");
  const foldEventsBefore = foldGain.gain.events.length;
  await stage.emit("pointerdown", {
    pointerId: 11, clientX: 100, clientY: 100, shiftKey: true, timeStamp: 100,
  });
  await stage.emit("pointermove", {
    pointerId: 11, clientX: 190, clientY: 168, shiftKey: true, timeStamp: 150,
  });
  assert.equal(
    foldGain.gain.events.slice(foldEventsBefore).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    true,
    "a manual fourth-axis fold opens the continuous fold voice",
  );
  await stage.emit("pointerup", {
    pointerId: 11, clientX: 190, clientY: 168, timeStamp: 160,
  });
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["target", 0]);

  const oscillatorCountBeforeTurn = audioContext.oscillators.length;
  const topologyEventsBeforeTurn = audioContext.oscillators.slice(1, 49)
    .reduce((count, oscillator) => count + oscillator.frequency.events.length, 0);
  await fixture.elements.get("turnClockwise").emit("click");
  runtime.runFrame(baseTime + 10);
  assert.match(fixture.elements.get("puzzleState").textContent, /Turning W\+/i);
  runtime.runFrame(baseTime + 12);
  assert.equal(fixture.elements.get("puzzleState").textContent, "Unsolved");
  assert.equal(fixture.elements.get("moveCount").textContent, "01");
  assert.ok(
    audioContext.oscillators.length > oscillatorCountBeforeTurn,
    "a manual shape turn auditions affected sticker voices",
  );
  assert.ok(
    audioContext.oscillators.slice(1, 49)
      .reduce((count, oscillator) => count + oscillator.frequency.events.length, 0)
      > topologyEventsBeforeTurn,
    "the same turn excites the bounded neighbor-topology strings",
  );
  assert.match(fixture.elements.get("liveStatus").textContent, /plus 90 degrees complete/i);

  const turnSources = audioContext.oscillators.slice(oscillatorCountBeforeTurn);
  audioContext.currentTime = 0.025;
  await fixture.elements.get("audioButton").emit("click");
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "false");
  assert.equal(
    turnSources.every(({ stops, disconnected }) => (
      stops.at(-1) === audioContext.currentTime && disconnected
    )),
    true,
    "Audio Off hard-cancels and disconnects sounding manual one-shots",
  );
  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1, "Audio On reuses the existing graph");
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "true");

  await fixture.elements.get("undoMove").emit("click");
  runtime.runFrame(baseTime + 20);
  runtime.runFrame(baseTime + 22);
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");

  await fixture.elements.get("scramblePuzzle").emit("click");
  assert.match(fixture.elements.get("liveStatus").textContent, /twelve four-dimensional quarter turns queued/i);
  await fixture.elements.get("resetAll").emit("click");
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(fixture.elements.get("voice").value, "pulse");
  assert.equal(fixture.elements.get("sequenceMethod").value, "sticker-stream");
  assert.equal(fixture.elements.get("autoRotate").getAttribute("aria-pressed"), "false");

  fixture.documentObject.hidden = true;
  fixture.documentObject.visibilityState = "hidden";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "suspended");
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["set", 0]);
  fixture.documentObject.hidden = false;
  fixture.documentObject.visibilityState = "visible";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "running");

  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: true });
  assert.equal(audioContext.state, "suspended");
  assert.equal(persistentFold.stops.length, 0, "BFCache preserves reusable audio nodes");
  await emitRuntime(fixture.windowListeners, "pageshow", { persisted: true });
  assert.equal(audioContext.state, "running");

  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: false });
  assert.equal(audioContext.state, "closed");
  assert.equal(persistentFold.stops.length, 1);
  assert.equal(persistentFold.disconnected, true);
});

test("the single Shape loop traverses every sticker, stays running through edits, and hot-swaps presets", async (t) => {
  const fixture = runtimeFixture();
  const clock = new FakeClock(40_000);
  const runtime = installRuntimeEnvironment(t, fixture, clock);

  await import("../hyper-rubix-app.js?shape-loop-runtime=" + Date.now());
  runtime.runFrame();

  const currentStickerId = () => fixture.elements.get("stage").dataset.currentSoundingStickerId;
  const currentStickerPosition = () => {
    const match = fixture.elements.get("sequenceNow").textContent.match(/^STICKER\s+(\d+)\s+\/\s+(\d+)/);
    assert.ok(match, "the timeline should expose its exact sticker position");
    return { index: Number(match[1]) - 1, length: Number(match[2]) };
  };

  assert.equal(fixture.elements.get("sequenceMethod").value, "sticker-stream");
  assert.equal(fixture.elements.get("playbackMode").value, "forward");
  assert.equal(fixture.elements.get("twistMotion").value, "off");
  assert.equal(fixture.elements.get("playState").textContent, "216 stickers · one note each");
  assert.equal(fixture.elements.get("hyperbarReadout").textContent, "STICKER 001 / 216");
  assert.equal(gridButtons(fixture).length, 216);
  assert.equal(gridButtons(fixture).filter(({ disabled }) => disabled).length, 0);
  assert.equal(gridButtons(fixture).every((cell) => cell.getAttribute("role") === "gridcell"), true);

  await fixture.elements.get("audioButton").emit("click");
  const audioContext = FakeAudioContext.instances[0];
  await setControl(fixture, "tempo", 30, "input");
  await setControl(fixture, "twistRate", 1);
  await setControl(fixture, "swing", 0, "input");
  await fixture.elements.get("playButton").emit("click");
  clock.advanceBy(55);
  const slowPosition = currentStickerPosition().index;
  await setControl(fixture, "tempo", 300, "input");
  clock.advanceBy(80);
  assert.notEqual(
    currentStickerPosition().index,
    slowPosition,
    "raising tempo retimes the next unscheduled pulse instead of waiting out the old two-second interval",
  );
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  await fixture.elements.get("playButton").emit("click");

  await setControl(fixture, "tempo", 300, "input");
  await setControl(fixture, "twistRate", 16);
  await setControl(fixture, "swing", 0, "input");
  await fixture.elements.get("playButton").emit("click");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(fixture.elements.get("playLabel").textContent, "Pause shape loop");

  clock.advanceBy(55);
  assert.equal(currentStickerPosition().length, 216);
  assert.notEqual(currentStickerId(), "");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  const initialTransportSources = [
    ...audioContext.oscillators.slice(49),
    ...audioContext.bufferSources.filter(({ loop }) => !loop),
  ];
  assert.ok(initialTransportSources.length > 0);
  const firstSix = [];
  for (let index = 0; index < 6; index += 1) {
    if (index > 0) clock.advanceBy(12.5);
    const id = currentStickerId();
    firstSix.push(id);
    const currentCells = gridButtons(fixture).filter((cell) => cell.classList.contains("is-current"));
    assert.equal(currentCells.length, 1, "each tick has one exact sticker playhead");
    assert.equal(currentCells[0].dataset.stickerId, id);
    assert.equal(currentCells[0].getAttribute("aria-current"), "step");
  }
  assert.equal(new Set(firstSix).size, 6, "successive fast pulses address separate stickers");

  await setControl(fixture, "tempo", 196, "input");
  assert.equal(
    fixture.elements.get("playButton").getAttribute("aria-pressed"),
    "true",
    "tempo edits never stop the running loop",
  );
  assert.equal(fixture.elements.get("tempoOut").textContent, "196 BPM");
  assert.ok(clock.pendingCount > 0);

  const solved = createSolvedHyperRubix();
  const turned = turnHyperRubixBoundaryCell(solved, {
    cell: "x+",
    plane: "yz",
    quarterTurns: 1,
  });
  const turnedIds = createHyperRubixStickerStream(turned).map(({ stickerId }) => stickerId);
  const xPositive = fixture.faceButtons.find(({ dataset }) => dataset.face === "x+");
  const positionBeforeTurn = currentStickerPosition().index;
  await xPositive.emit("click");
  const yzPlane = fixture.elements.get("planePicker").children.find(({ dataset }) => (
    dataset.plane === "yz"
  ));
  assert.ok(yzPlane);
  await yzPlane.emit("click");
  await fixture.elements.get("turnClockwise").emit("click");
  runtime.runFrame(clock.now);
  runtime.runFrame(clock.now + 2);
  runtime.drainFrames(clock.now + 702);
  assert.equal(fixture.elements.get("moveCount").textContent, "01");
  assert.equal(
    currentStickerPosition().index,
    positionBeforeTurn,
    "rebuilding a turned score preserves the visible transport position",
  );
  assert.equal(
    fixture.elements.get("playButton").getAttribute("aria-pressed"),
    "true",
    "a manual quarter-turn keeps transport running",
  );

  clock.advanceBy(240);
  const remapped = currentStickerPosition();
  assert.equal(
    currentStickerId(),
    turnedIds[remapped.index],
    "future notes follow the newly turned sticker configuration without resetting time",
  );
  assert.equal(fixture.elements.get("moveCount").textContent, "01", "the clock itself never turns the puzzle");

  const positionBeforePreset = currentStickerPosition().index;
  const topologyEventsBeforeRattlesnake = audioContext.oscillators.slice(1, 49)
    .reduce((count, oscillator) => count + oscillator.frequency.events.length, 0);
  await setControl(fixture, "voice", "rattlesnake");
  assert.equal(fixture.elements.get("voice").value, "rattlesnake");
  assert.equal(fixture.elements.get("rattleButton").getAttribute("aria-pressed"), "true");
  assert.equal(fixture.elements.get("rattlesnakeControls").hidden, false);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(currentStickerPosition().index, positionBeforePreset);
  const rattleSource = audioContext.bufferSources.find(({ loop }) => loop);
  assert.ok(rattleSource, "Rattlesnake reuses one continuous seed source");
  const rattleGain = rattleSource.connections[0].connections[0].connections[0];
  const rattleEventsBefore = rattleGain.gain.events.length;
  clock.advanceBy(80);
  assert.ok(
    rattleGain.gain.events.length > rattleEventsBefore,
    "sticker pulses excite the exclusive Rattlesnake preset",
  );
  assert.ok(
    audioContext.oscillators.slice(1, 49)
      .reduce((count, oscillator) => count + oscillator.frequency.events.length, 0)
      > topologyEventsBeforeRattlesnake,
    "Rattlesnake also excites the visible neighbor-resonator mapping",
  );

  await setControl(fixture, "voice", "glass");
  assert.equal(fixture.elements.get("rattleButton").getAttribute("aria-pressed"), "false");
  assert.equal(fixture.elements.get("rattlesnakeControls").hidden, true);
  assert.match(fixture.elements.get("soundSummary").textContent, /Prism kit/);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");

  const sourcesBeforeFallback = audioContext.oscillators.length + audioContext.bufferSources.length;
  await setControl(fixture, "voice", "webgpu-303");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.elements.get("voice").value, "webgpu-303");
  assert.match(fixture.elements.get("voiceHelp").textContent, /audible Web Audio acid fallback/i);
  assert.equal(
    fixture.elements.get("playButton").getAttribute("aria-pressed"),
    "true",
    "an unavailable GPU never silences or stops the shape loop",
  );
  clock.advanceBy(90);
  assert.ok(
    audioContext.oscillators.length + audioContext.bufferSources.length > sourcesBeforeFallback,
    "WebGPU 303 falls back to scheduled Web Audio acid notes",
  );

  await fixture.elements.get("restartLoop").emit("click");
  assert.match(fixture.elements.get("liveStatus").textContent, /first sticker/i);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  await fixture.elements.get("playButton").emit("click");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(clock.pendingCount, 0, "Pause clears scheduler and visual clocks");
  assert.equal(
    initialTransportSources.every(({ disconnected }) => disconnected),
    true,
    "Pause disconnects lookahead-scheduled transport sources",
  );

  await setControl(fixture, "puzzleSize", 2);
  assert.equal(gridButtons(fixture).length, 64);
  assert.equal(fixture.elements.get("playState").textContent, "64 stickers · one note each");
  assert.match(fixture.elements.get("puzzleSizeHelp").textContent, /64 stickers · 8 spatial pulses/);
  await setControl(fixture, "puzzleSize", 4);
  assert.equal(gridButtons(fixture).length, 512);
  assert.equal(fixture.elements.get("playState").textContent, "512 stickers · one note each");
  assert.match(fixture.elements.get("puzzleSizeHelp").textContent, /512 stickers · 64 spatial pulses/);

  await setControl(fixture, "puzzleSize", 3);
  await fixture.elements.get("playButton").emit("click");
  clock.advanceBy(90);
  const positionBeforeHide = currentStickerPosition().index;
  assert.ok(positionBeforeHide > 0);
  fixture.documentObject.hidden = true;
  fixture.documentObject.visibilityState = "hidden";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(clock.pendingCount, 0);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  fixture.documentObject.hidden = false;
  fixture.documentObject.visibilityState = "visible";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.ok(clock.pendingCount > 0);
  clock.advanceBy(55);
  assert.equal(
    currentStickerPosition().index,
    (positionBeforeHide + 1) % 216,
    "visibility resume continues after the last audible sticker instead of resetting the loop",
  );

  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: false });
  assert.equal(audioContext.state, "closed");
  assert.equal(clock.pendingCount, 0);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
});

test("Hyper Rubix publishes a sequence/WAX contract without generic computer-note capture", () => {
  const capability = instrumentMidiCapabilityForId("hyper-rubix");
  assert.deepEqual(capability, {
    id: "hyper-rubix",
    midiInput: true,
    midiInputMode: "universal-control",
    noteMode: "sequence",
    audioInput: false,
    midiOutput: true,
    startsAudio: true,
    computerKeyboardMode: "none",
  });

  const wax = waxSupportForId("hyper-rubix");
  assert.equal(wax.recommended, WAX_ROLE_IDS.instrument);
  assert.deepEqual(wax.roles, [WAX_ROLE_IDS.instrument, WAX_ROLE_IDS.midiFx]);
  assert.equal(wax.computerKeyboardMode, "none");
  assert.equal(wax.noteMode, "sequence");
  assert.equal(wax.hostSync, true);
});

test("Hyper Rubix publishes one immutable techno voice for each colored boundary cell", () => {
  const expected = {
    "x+": ["red", "kick"],
    "x-": ["orange", "sub"],
    "y+": ["white", "clap"],
    "y-": ["yellow", "snare"],
    "z+": ["green", "open-hat"],
    "z-": ["blue", "closed-hat"],
    "w+": ["violet", "stab"],
    "w-": ["cyan", "rim"],
  };

  assert.equal(Object.isFrozen(HYPER_RUBIX_TECHNO_VOICES), true);
  assert.deepEqual(Object.keys(HYPER_RUBIX_TECHNO_VOICES), Object.keys(expected));
  for (const [cell, [color, voiceId]] of Object.entries(expected)) {
    const voice = HYPER_RUBIX_TECHNO_VOICES[cell];
    assert.equal(Object.isFrozen(voice), true);
    assert.equal(voice.cell, cell);
    assert.equal(voice.color, color);
    assert.equal(voice.color, HYPER_RUBIX_BOUNDARY_CELLS[cell].color);
    assert.equal(voice.id, voiceId);
    assert.equal(voice.family, voiceId);
    for (const key of ["baseMidi", "baseFilterHz", "baseDecaySeconds", "baseDrive", "baseRattle"]) {
      assert.equal(Number.isFinite(voice[key]), true, `${cell} should publish finite ${key}`);
    }
  }
});

test("Hyper Rubix techno controls respond relationally to projected 4D geometry", () => {
  const move = { cell: "x+", plane: "yz", quarterTurns: 1 };
  const left = hyperRubixTechnoVoiceParameters(move, { pan: -1 });
  const right = hyperRubixTechnoVoiceParameters(move, { pan: 1 });
  assert.ok(left.pan < right.pan, "projected screen X should pan from left to right");

  const far = hyperRubixTechnoVoiceParameters(move, { depth: 0 });
  const near = hyperRubixTechnoVoiceParameters(move, { depth: 1 });
  assert.ok(far.filterHz < near.filterHz, "near geometry should brighten the filter");
  assert.ok(far.decaySeconds > near.decaySeconds, "far geometry should leave a longer tail");

  const flat = hyperRubixTechnoVoiceParameters(move, { angle: 0 });
  const angled = hyperRubixTechnoVoiceParameters(move, { angle: 0.25 });
  assert.notEqual(flat.pitchHz, angled.pitchHz);
  assert.ok(angled.filterHz > flat.filterHz);
  assert.ok(angled.drive > flat.drive);
  assert.ok(angled.decaySeconds > flat.decaySeconds);

  const clean = hyperRubixTechnoVoiceParameters(move, { disorder: 0 });
  const disordered = hyperRubixTechnoVoiceParameters(move, { disorder: 1 });
  assert.ok(disordered.pitchHz > clean.pitchHz);
  assert.ok(disordered.filterHz > clean.filterHz);
  assert.ok(disordered.decaySeconds > clean.decaySeconds);
  assert.ok(disordered.drive > clean.drive);
  assert.ok(disordered.rattle > clean.rattle, "disorder should fray the rattle layer");

  const shapeOff = hyperRubixTechnoVoiceParameters(move, {
    position: { y: 1, z: 1, w: -1 },
    pan: 1,
    angle: 0.125,
    depth: 1,
    shapeInfluence: 0,
  });
  const shapeOn = hyperRubixTechnoVoiceParameters(move, {
    position: { y: 1, z: 1, w: -1 },
    pan: 1,
    angle: 0.125,
    depth: 1,
    shapeInfluence: 1,
  });
  for (const key of ["pitchHz", "filterHz", "filterQ", "decaySeconds", "pan", "drive", "rattle"]) {
    assert.notEqual(shapeOff[key], shapeOn[key], `shape influence should modulate ${key}`);
  }

  const ordinaryPlane = hyperRubixTechnoVoiceParameters(move);
  const fourthAxisPlane = hyperRubixTechnoVoiceParameters({
    cell: "x+",
    plane: "yw",
    quarterTurns: 1,
  });
  assert.equal(ordinaryPlane.voice, fourthAxisPlane.voice, "the cell owns the main voice family");
  assert.notEqual(fourthAxisPlane.filterHz, ordinaryPlane.filterHz, "the turn plane tilts the filter");
  assert.notEqual(fourthAxisPlane.filterQ, ordinaryPlane.filterQ, "the turn plane changes resonance");
  assert.ok(fourthAxisPlane.drive > ordinaryPlane.drive, "the turn plane modulates timbre");
});

test("the sticker hyperbar addresses eight colored events across 27 sparse steps", () => {
  const snapshot = createHyperRubixHyperbarSnapshot(createSolvedHyperRubix());
  assert.equal(HYPER_RUBIX_HYPERBAR_LENGTH, 27);
  assert.equal(snapshot.length, 27);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.flatMap(({ events }) => events).length, 216);
  for (const [index, step] of snapshot.entries()) {
    assert.equal(step.index, index);
    assert.equal(step.events.length, 8);
    assert.equal(new Set(step.events.map(({ cell }) => cell)).size, 8);
    const gated = step.events.filter(({ gate }) => gate);
    assert.ok(gated.length >= 1 && gated.length <= 8, `step ${index + 1} should stay sparse`);
  }
  assert.equal(snapshot[0].events.filter(({ gate }) => gate).length, 8);
  assert.ok(snapshot.some(({ events }) => {
    const count = events.filter(({ gate }) => gate).length;
    return count > 1 && count < 8;
  }), "the authored hyperbar includes multi-voice syncopation without filling every lane");
});
