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
    "stickerScale", "stickerScaleOut", "resetView", "randomView", "voice", "soundSummary",
    "tone", "toneOut", "decay", "decayOut", "resetAll", "rotationReadout",
    "foldSound", "foldLevel", "foldLevelOut", "hearAutoDrift", "hearAutoDriftState",
    "rattleButton", "rattleState", "rattleLevel", "rattleLevelOut", "rattleRate",
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
  elements.get("sequenceMethod").value = "twist-tape";
  elements.get("sequencePattern").value = "axis-break";
  elements.get("playbackMode").value = "forward";
  elements.get("twistRate").value = "2";
  elements.get("twistMotion").value = "auto";
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
  elements.get("autoRotate").setAttribute("aria-pressed", "true");
  elements.get("audioError").hidden = true;
  elements.get("hyperbarPanel").hidden = true;
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

test("Hyper Rubix runtime queues audible turns, supports undo/reset, and survives BFCache", async (t) => {
  const fixture = runtimeFixture();
  const propertyNames = [
    "document", "window", "AudioContext", "webkitAudioContext", "ResizeObserver",
    "requestAnimationFrame", "cancelAnimationFrame",
  ];
  const originals = new Map(propertyNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]));
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
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
  FakeAudioContext.instances.length = 0;

  const runFrame = (time) => {
    assert.equal(typeof queuedFrame, "function", `a frame should be queued for ${time}`);
    const callback = queuedFrame;
    queuedFrame = null;
    callback(time);
  };

  await import(`../hyper-rubix-app.js?smoke=${Date.now()}`);
  const baseTime = performance.now();
  runFrame(baseTime);

  assert.deepEqual(
    fixture.elements.get("planePicker").children.map(({ dataset }) => dataset.plane),
    ["xy", "xz", "yz"],
    "W+ exposes only its three tangent turn planes",
  );
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("disorderState").textContent, "0%");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(
    fixture.elements.get("autoRotate").getAttribute("aria-pressed"),
    "false",
    "reduced motion disables automatic fourth-axis drift",
  );
  assert.equal(fixture.elements.get("foldSound").value, "glide");
  assert.equal(fixture.elements.get("foldLevel").value, "0.12");
  assert.equal(fixture.elements.get("foldLevelOut").textContent, "12%");
  assert.equal(fixture.elements.get("hearAutoDrift").getAttribute("aria-pressed"), "false");
  assert.match(fixture.elements.get("hearAutoDriftState").textContent, /^off\b/i);

  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1);
  const audioContext = FakeAudioContext.instances[0];
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "true");
  assert.equal(fixture.elements.get("audioState").textContent, "on");
  assert.equal(audioContext.compressors[0].connections.includes(audioContext.destination), true);
  assert.equal(
    audioContext.oscillators.filter(({ stops }) => stops.length === 0).length,
    49,
    "audio enable creates one Fold W source plus forty-eight bounded topology strings",
  );
  const persistentFoldOscillator = audioContext.oscillators.find(({ stops }) => stops.length === 0);
  assert.ok(persistentFoldOscillator, "audio enable creates one reusable fold oscillator");
  const foldFilter = persistentFoldOscillator.connections[0];
  const foldPanner = foldFilter.connections[0];
  const foldGain = foldPanner.connections[0];
  const foldBus = foldGain.connections[0];
  assert.deepEqual(
    [foldFilter.kind, foldPanner.kind, foldGain.kind, foldBus.kind],
    ["filter", "panner", "gain", "gain"],
    "fold glide owns a filtered and panned graph separate from one-shot drums",
  );
  assert.equal(foldGain.gain.value, 0, "the persistent fold graph is normally muted");
  assert.equal(foldBus.gain.value, 0.12);

  const autoSilentEventCount = foldGain.gain.events.length;
  await fixture.elements.get("autoRotate").emit("click");
  runFrame(baseTime + 1);
  assert.equal(
    foldGain.gain.events.slice(autoSilentEventCount).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    false,
    "automatic projection drift is silent until explicitly enabled",
  );
  await fixture.elements.get("hearAutoDrift").emit("click");
  runFrame(baseTime + 2);
  assert.equal(
    foldGain.gain.events.some(([kind, value]) => kind === "target" && value > 0),
    true,
    "the auto-drift opt-in opens the fold glide",
  );
  assert.ok(persistentFoldOscillator.frequency.events.some(([kind]) => kind === "target"));
  assert.ok(foldFilter.frequency.events.some(([kind]) => kind === "target"));
  assert.ok(foldPanner.pan.events.some(([kind]) => kind === "target"));
  await fixture.elements.get("autoRotate").emit("click");
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["target", 0]);
  runFrame(baseTime + 3);
  await fixture.elements.get("hearAutoDrift").emit("click");

  const stage = fixture.elements.get("stage");
  const glideEventsBefore = foldGain.gain.events.length;
  await stage.emit("pointerdown", {
    pointerId: 11, clientX: 100, clientY: 100, shiftKey: true, timeStamp: 100,
  });
  await stage.emit("pointermove", {
    pointerId: 11, clientX: 190, clientY: 168, shiftKey: true, timeStamp: 150,
  });
  assert.equal(
    foldGain.gain.events.slice(glideEventsBefore).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    true,
    "Shift-drag maps fourth-axis angular velocity to the glide envelope",
  );
  await stage.emit("pointerup", {
    pointerId: 11, clientX: 190, clientY: 168, timeStamp: 160,
  });
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["target", 0]);

  const thresholdEventsBefore = foldGain.gain.events.length;
  await stage.emit("pointerdown", {
    pointerId: 12, clientX: 220, clientY: 180, shiftKey: true, timeStamp: 200,
  });
  await stage.emit("pointermove", {
    pointerId: 12, clientX: 223, clientY: 184, shiftKey: true, timeStamp: 230,
  });
  await stage.emit("pointercancel", { pointerId: 12, timeStamp: 235 });
  assert.equal(
    foldGain.gain.events.slice(thresholdEventsBefore).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    false,
    "sub-threshold pointer motion never opens the fold graph",
  );

  const foldSound = fixture.elements.get("foldSound");
  foldSound.value = "ticks";
  await foldSound.emit("change");
  const tickOscillatorsBefore = audioContext.oscillators.length;
  const tickGainEventsBefore = foldGain.gain.events.length;
  await stage.emit("pointerdown", {
    pointerId: 13, clientX: 100, clientY: 100, shiftKey: true, timeStamp: 300,
  });
  await stage.emit("pointermove", {
    pointerId: 13, clientX: 190, clientY: 100, shiftKey: true, timeStamp: 360,
  });
  assert.equal(audioContext.oscillators.length, tickOscillatorsBefore + 1);
  assert.equal(audioContext.oscillators.at(-1).stops.length, 1);
  assert.equal(
    foldGain.gain.events.slice(tickGainEventsBefore).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    false,
    "ticks mode leaves the continuous oscillator muted",
  );
  await stage.emit("pointermove", {
    pointerId: 13, clientX: 260, clientY: 100, shiftKey: true, timeStamp: 370,
  });
  assert.equal(
    audioContext.oscillators.length,
    tickOscillatorsBefore + 1,
    "crossing ticks are rate-limited during fast bucket sweeps",
  );
  await stage.emit("pointermove", {
    pointerId: 13, clientX: 330, clientY: 100, shiftKey: true, timeStamp: 425,
  });
  assert.equal(audioContext.oscillators.length, tickOscillatorsBefore + 2);
  await stage.emit("pointercancel", { pointerId: 13, timeStamp: 430 });
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["target", 0]);

  foldSound.value = "both";
  await foldSound.emit("change");
  const bothOscillatorsBefore = audioContext.oscillators.length;
  const bothGainEventsBefore = foldGain.gain.events.length;
  await stage.emit("pointerdown", {
    pointerId: 14, clientX: 400, clientY: 120, shiftKey: true, timeStamp: 500,
  });
  await stage.emit("pointermove", {
    pointerId: 14, clientX: 400, clientY: 200, shiftKey: true, timeStamp: 560,
  });
  assert.equal(audioContext.oscillators.length, bothOscillatorsBefore + 1);
  assert.equal(
    foldGain.gain.events.slice(bothGainEventsBefore).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    true,
    "both mode layers a glide under its crossing tick",
  );
  await stage.emit("lostpointercapture", { pointerId: 14, timeStamp: 565 });
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["target", 0]);

  foldSound.value = "off";
  await foldSound.emit("change");
  const offOscillatorsBefore = audioContext.oscillators.length;
  const offGainEventsBefore = foldGain.gain.events.length;
  await stage.emit("pointerdown", {
    pointerId: 15, clientX: 100, clientY: 100, shiftKey: true, timeStamp: 600,
  });
  await stage.emit("pointermove", {
    pointerId: 15, clientX: 200, clientY: 170, shiftKey: true, timeStamp: 660,
  });
  await stage.emit("pointerup", {
    pointerId: 15, clientX: 200, clientY: 170, timeStamp: 670,
  });
  assert.equal(audioContext.oscillators.length, offOscillatorsBefore);
  assert.equal(
    foldGain.gain.events.slice(offGainEventsBefore).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    false,
    "off mode stays silent during Fold W gestures",
  );

  foldSound.value = "glide";
  await foldSound.emit("change");
  const orbitKeyEventsBefore = foldGain.gain.events.length;
  await stage.emit("keydown", { key: "ArrowLeft", timeStamp: 700 });
  assert.equal(
    foldGain.gain.events.slice(orbitKeyEventsBefore).some(([kind, value]) => (
      kind === "target" && value > 0
    )),
    false,
    "an unmodified Orbit arrow remains camera-only",
  );
  const foldKeyEventsBefore = foldGain.gain.events.length;
  await stage.emit("keydown", { key: "ArrowRight", shiftKey: true, timeStamp: 760 });
  const foldKeyEvents = foldGain.gain.events.slice(foldKeyEventsBefore);
  assert.equal(
    foldKeyEvents.some(([kind, value]) => kind === "target" && value > 0),
    true,
    "Shift+Arrow emits a finite keyboard fold gesture",
  );
  assert.deepEqual(foldKeyEvents.at(-1).slice(0, 2), ["target", 0]);

  const foldLevel = fixture.elements.get("foldLevel");
  foldLevel.value = "0.4";
  await foldLevel.emit("input");
  assert.equal(fixture.elements.get("foldLevelOut").textContent, "40%");
  assert.deepEqual(foldBus.gain.events.at(-1).slice(0, 2), ["target", 0.4]);
  const oscillatorCountBeforeTurn = audioContext.oscillators.length;

  await fixture.elements.get("turnClockwise").emit("click");
  assert.equal(fixture.elements.get("scramblePuzzle").disabled, true);
  runFrame(baseTime + 10);
  assert.equal(fixture.elements.get("puzzleState").textContent, "Turning W+");
  const turnOscillators = audioContext.oscillators.slice(oscillatorCountBeforeTurn);
  assert.equal(turnOscillators.length, 1, "the default Hyper kit maps the XY turn to one kick oscillator");
  assert.equal(turnOscillators.every(({ starts, stops }) => (
    starts.length === 1 && stops.length === 1
  )), true);
  assert.equal(
    turnOscillators[0].frequency.events.some(([kind]) => kind === "exponential"),
    true,
    "the kick sweeps its pitch through the turn onset",
  );
  runFrame(baseTime + 12);
  assert.equal(fixture.elements.get("puzzleState").textContent, "Unsolved");
  assert.equal(fixture.elements.get("disorderState").textContent, "17%");
  assert.equal(fixture.elements.get("moveCount").textContent, "01");
  assert.equal(fixture.elements.get("undoMove").disabled, false);
  assert.equal(fixture.elements.get("unwindPuzzle").disabled, false);
  assert.match(fixture.elements.get("liveStatus").textContent, /plus 90 degrees complete/i);
  runFrame(baseTime + 700);

  audioContext.currentTime = turnOscillators[0].starts[0] + 0.01;
  await fixture.elements.get("audioButton").emit("click");
  assert.equal(
    turnOscillators[0].stops.at(-1),
    audioContext.currentTime,
    "Audio Off hard-stops an already-started manual tail",
  );
  assert.equal(turnOscillators[0].disconnected, true);
  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1, "re-enable reuses the context without reviving the old tail");
  assert.equal(turnOscillators[0].disconnected, true);

  await fixture.elements.get("undoMove").emit("click");
  runFrame(baseTime + 710);
  runFrame(baseTime + 712);
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(fixture.elements.get("undoMove").disabled, true);
  runFrame(baseTime + 1_400);

  foldSound.value = "both";
  await foldSound.emit("change");
  await fixture.elements.get("hearAutoDrift").emit("click");
  await fixture.elements.get("scramblePuzzle").emit("click");
  assert.equal(fixture.elements.get("scramblePuzzle").disabled, true);
  assert.match(fixture.elements.get("liveStatus").textContent, /twelve four-dimensional quarter turns queued/i);
  await fixture.elements.get("resetAll").emit("click");
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(fixture.elements.get("scramblePuzzle").disabled, false);
  assert.equal(fixture.elements.get("foldSound").value, "glide");
  assert.equal(fixture.elements.get("foldLevel").value, "0.12");
  assert.equal(fixture.elements.get("foldLevelOut").textContent, "12%");
  assert.equal(fixture.elements.get("hearAutoDrift").getAttribute("aria-pressed"), "false");
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["target", 0]);

  foldSound.value = "both";
  await foldSound.emit("change");
  await stage.emit("pointerdown", {
    pointerId: 21, clientX: 120, clientY: 120, shiftKey: true, timeStamp: 800,
  });
  await stage.emit("pointermove", {
    pointerId: 21, clientX: 220, clientY: 190, shiftKey: true, timeStamp: 860,
  });
  const lifecycleTick = audioContext.oscillators.at(-1);
  assert.notEqual(lifecycleTick, persistentFoldOscillator);
  assert.equal(lifecycleTick.stops.length, 1);
  assert.equal(stage.classList.contains("is-dragging"), true);

  fixture.documentObject.hidden = true;
  fixture.documentObject.visibilityState = "hidden";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "suspended");
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["set", 0]);
  assert.equal(lifecycleTick.stops.at(-1), audioContext.currentTime);
  assert.equal(persistentFoldOscillator.stops.length, 0);
  assert.equal(stage.classList.contains("is-dragging"), false);
  const foldEventsAfterHidden = foldGain.gain.events.length;
  await stage.emit("pointermove", {
    pointerId: 21, clientX: 310, clientY: 240, shiftKey: true, timeStamp: 920,
  });
  assert.equal(foldGain.gain.events.length, foldEventsAfterHidden, "hidden-page cleanup drops the stale drag");
  fixture.documentObject.hidden = false;
  fixture.documentObject.visibilityState = "visible";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "running");

  await stage.emit("pointerdown", {
    pointerId: 22, clientX: 120, clientY: 120, shiftKey: true, timeStamp: 1_000,
  });
  await stage.emit("pointermove", {
    pointerId: 22, clientX: 220, clientY: 190, shiftKey: true, timeStamp: 1_060,
  });
  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: true });
  assert.equal(audioContext.state, "suspended", "BFCache exit suspends without disposing audio");
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["set", 0]);
  assert.equal(persistentFoldOscillator.stops.length, 0, "BFCache keeps the reusable fold source alive");
  await emitRuntime(fixture.windowListeners, "pageshow", { persisted: true });
  assert.equal(audioContext.state, "running", "BFCache restore resumes an enabled engine");

  foldSound.value = "glide";
  await foldSound.emit("change");
  await stage.emit("pointerdown", {
    pointerId: 23, clientX: 120, clientY: 120, shiftKey: true, timeStamp: 1_100,
  });
  await stage.emit("pointermove", {
    pointerId: 23, clientX: 220, clientY: 190, shiftKey: true, timeStamp: 1_160,
  });
  await fixture.elements.get("audioButton").emit("click");
  assert.deepEqual(foldGain.gain.events.at(-1).slice(0, 2), ["set", 0]);
  assert.equal(persistentFoldOscillator.stops.length, 0, "audio off mutes without rebuilding Fold W");
  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(audioContext.oscillators.filter(({ stops }) => stops.length === 0).length, 49);
  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: false });
  assert.equal(audioContext.state, "closed", "final exit closes the AudioContext");
  assert.equal(persistentFoldOscillator.stops.length, 1, "final disposal stops the persistent fold source once");
  assert.equal(persistentFoldOscillator.disconnected, true);
});

test("Hyper Rubix clock drives 16-step visual and absolute-time audio transport", async (t) => {
  const fixture = runtimeFixture();
  const clock = new FakeClock();
  const propertyNames = [
    "document", "window", "AudioContext", "webkitAudioContext", "ResizeObserver",
    "requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout",
  ];
  const originals = new Map(propertyNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]));
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  let nextFrameId = 0;
  let queuedFrame = null;
  globalThis.document = fixture.documentObject;
  globalThis.window = fixture.windowObject;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.webkitAudioContext = undefined;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => clock.now },
  });
  globalThis.setTimeout = clock.setTimeout.bind(clock);
  globalThis.clearTimeout = clock.clearTimeout.bind(clock);
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
  FakeAudioContext.instances.length = 0;

  const runFrame = (time = clock.now) => {
    assert.equal(typeof queuedFrame, "function", `a frame should be queued for ${time}`);
    const callback = queuedFrame;
    queuedFrame = null;
    callback(time);
  };

  await import(`../hyper-rubix-app.js?transport=${Date.now()}`);
  runFrame();

  const puzzleSize = fixture.elements.get("puzzleSize");
  const sizeSequenceMethod = fixture.elements.get("sequenceMethod");
  const gridButtons = () => fixture.elements.get("hyperbarGrid").children.flatMap((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
  assert.equal(puzzleSize.value, "3");
  assert.match(fixture.elements.get("puzzleSizeHelp").textContent, /216 stickers · 27 spatial pulses/);
  assert.equal(fixture.elements.get("stickerStreamMethodOption").textContent, "Sticker stream · 216");
  assert.equal(fixture.elements.get("stickerHyperbarMethodOption").textContent, "Sticker hyperbar · 27");

  await fixture.elements.get("playButton").emit("click");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.ok(clock.pendingCount > 0);
  puzzleSize.value = "2";
  await puzzleSize.emit("change");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(clock.pendingCount, 0, "changing puzzle order clears transport and visual clocks");
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(fixture.elements.get("puzzleOrderHeading").textContent, "2 × 2 × 2 × 2 / PUZZLE INSTRUMENT");
  assert.match(fixture.elements.get("stage").getAttribute("aria-label"), /64 colored hyper-stickers/);
  assert.equal(fixture.elements.get("hybridCoilMethodOption").textContent, "Hybrid coil · 16 × 8");
  assert.equal(fixture.elements.get("cornerStreamMethodOption").textContent, "Corner stream · 64");
  runFrame();

  sizeSequenceMethod.value = "sticker-hyperbar";
  await sizeSequenceMethod.emit("change");
  assert.equal(gridButtons().length, 64, "order two renders eight lanes by eight positions");
  assert.equal(fixture.elements.get("hyperbarGrid").getAttribute("aria-colcount"), "8");
  assert.equal(
    fixture.elements.get("hyperbarGrid").style.getPropertyValue("--hyperbar-columns"),
    "8",
  );
  assert.match(fixture.elements.get("clockSummary").textContent, /· 8$/);

  await fixture.elements.get("turnClockwise").emit("click");
  runFrame();
  assert.match(fixture.elements.get("puzzleState").textContent, /turning/i);
  puzzleSize.value = "4";
  await puzzleSize.emit("change");
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(gridButtons().length, 512, "order four renders eight lanes by sixty-four positions");
  assert.equal(fixture.elements.get("hyperbarGrid").getAttribute("aria-colcount"), "64");
  assert.equal(fixture.elements.get("stickerStreamMethodOption").textContent, "Sticker stream · 512");
  assert.equal(fixture.elements.get("stickerHyperbarMethodOption").textContent, "Sticker hyperbar · 64");
  assert.equal(fixture.elements.get("hybridCoilMethodOption").textContent, "Hybrid coil · 16 × 64");
  assert.equal(fixture.elements.get("rattleVoiceLabel").textContent, "Rattlesnake coil · voice 513");
  assert.match(fixture.elements.get("serializationInstructions").textContent, /all 512 stickers.+64 clock pulses/i);
  runFrame();

  sizeSequenceMethod.value = "sticker-stream";
  await sizeSequenceMethod.emit("change");
  assert.match(fixture.elements.get("clockSummary").textContent, /· 512 · STILL$/);
  sizeSequenceMethod.value = "corner-stream";
  await sizeSequenceMethod.emit("change");
  assert.match(fixture.elements.get("clockSummary").textContent, /· 64 · STILL$/);
  assert.equal(gridButtons().filter(({ disabled }) => !disabled).length, 64);

  puzzleSize.value = "3";
  await puzzleSize.emit("change");
  sizeSequenceMethod.value = "twist-tape";
  await sizeSequenceMethod.emit("change");
  assert.equal(fixture.elements.get("puzzleSizeHelp").textContent, "3 per axis · 216 stickers · 27 spatial pulses");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  runFrame();

  const stepStrip = fixture.elements.get("stepStrip");
  assert.equal(stepStrip.children.length, 16);
  assert.deepEqual(
    stepStrip.children.map(({ dataset }) => dataset.sequenceStep),
    Array.from({ length: 16 }, (_, index) => String(index)),
  );
  assert.equal(stepStrip.children[0].classList.contains("is-current"), true);
  assert.deepEqual(
    new Set(stepStrip.children.map((marker) => marker.children[0]?.textContent)),
    new Set(["XY", "XZ", "XW", "YZ", "YW", "ZW", "·"]),
    "the full-density Axis Break tape exposes all six plane drums",
  );
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(fixture.elements.get("playLabel").textContent, "Play auto-twists");
  assert.equal(fixture.elements.get("tempo").value, "112");
  assert.equal(fixture.elements.get("tempoOut").textContent, "112 BPM");
  assert.equal(fixture.elements.get("swing").value, "0.08");
  assert.equal(fixture.elements.get("twistRate").value, "2");
  assert.equal(fixture.elements.get("twistDensity").value, "1");
  assert.equal(fixture.elements.get("twistDensityOut").textContent, "100%");
  assert.equal(fixture.elements.get("sequenceMethod").value, "twist-tape");
  assert.equal(fixture.elements.get("hyperbarPanel").hidden, true);
  assert.equal(fixture.elements.get("hyperbarGrid").children.length, 0);
  assert.equal(fixture.elements.get("rattleButton").getAttribute("aria-pressed"), "false");
  assert.match(fixture.elements.get("rattleState").textContent, /^off\b/i);
  assert.equal(fixture.elements.get("rattleLevel").value, "0.34");
  assert.equal(fixture.elements.get("rattleRate").value, "4");
  assert.equal(fixture.elements.get("shapeInfluence").value, "0.72");
  assert.equal(fixture.elements.get("sequencePattern").value, "axis-break");
  assert.equal(fixture.elements.get("playbackMode").value, "forward");
  assert.equal(fixture.elements.get("reseedPattern").disabled, true);
  assert.equal(fixture.elements.get("stage").dataset.soundingStickerCount, "0");
  assert.equal(fixture.elements.get("stage").dataset.soundingStickerIds, "");
  assert.doesNotMatch(fixture.elements.get("stageReadout").textContent, /sounding/i);

  const silentStart = await fixture.elements.get("stage").emit("keydown", { key: " " });
  assert.equal(silentStart.defaultPrevented, true);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(fixture.elements.get("playLabel").textContent, "Pause auto-twists");
  assert.match(fixture.elements.get("liveStatus").textContent, /audio is off/i);
  assert.equal(FakeAudioContext.instances.length, 0, "silent visual playback must not create audio");
  assert.equal(clock.pendingCount, 2, "the scheduler owns one clock and one visual callback");

  clock.advanceBy(55);
  assert.equal(typeof queuedFrame, "function", "the first silent step should queue a visual turn");
  assert.equal(
    fixture.elements.get("stage").dataset.soundingStickerCount,
    "0",
    "legacy twist tape keeps its affected-slice animation instead of sticker-event pulses",
  );
  runFrame();
  assert.match(fixture.elements.get("puzzleState").textContent, /turning/i);
  runFrame(clock.now + 2);
  assert.equal(fixture.elements.get("moveCount").textContent, "01");
  assert.equal(fixture.elements.get("puzzleState").textContent, "Sequencing");
  assert.equal(FakeAudioContext.instances.length, 0);

  const restart = await fixture.elements.get("stage").emit("keydown", { key: "r" });
  assert.equal(restart.defaultPrevented, true);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(stepStrip.children[0].classList.contains("is-current"), true);
  assert.match(fixture.elements.get("liveStatus").textContent, /restarted at step one/i);
  assert.equal(clock.pendingCount, 2);

  const silentStop = await fixture.elements.get("stage").emit("keydown", { key: " " });
  assert.equal(silentStop.defaultPrevented, true);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(fixture.elements.get("playLabel").textContent, "Play auto-twists");
  assert.match(fixture.elements.get("liveStatus").textContent, /sequencer paused/i);
  assert.equal(clock.pendingCount, 0, "pause clears clock and pending visual callbacks");
  clock.advanceBy(1_000);
  assert.equal(fixture.elements.get("moveCount").textContent, "01");
  if (queuedFrame) runFrame(clock.now + 700);

  const pattern = fixture.elements.get("sequencePattern");
  pattern.value = "random-walk";
  await pattern.emit("change");
  assert.equal(fixture.elements.get("reseedPattern").disabled, false);
  assert.match(fixture.elements.get("liveStatus").textContent, /random walk twist tape loaded/i);
  const seededLabels = stepStrip.children.map((marker) => marker.getAttribute("aria-label"));
  await fixture.elements.get("reseedPattern").emit("click");
  const reseededLabels = stepStrip.children.map((marker) => marker.getAttribute("aria-label"));
  assert.notDeepEqual(reseededLabels, seededLabels, "reseed creates a new reproducible random walk");
  assert.match(fixture.elements.get("liveStatus").textContent, /random walk reseeded/i);

  const playback = fixture.elements.get("playbackMode");
  playback.value = "reverse";
  await playback.emit("change");
  assert.equal(stepStrip.children[15].classList.contains("is-current"), true);
  assert.match(fixture.elements.get("sequenceNow").textContent, /^STEP 16/);
  const rate = fixture.elements.get("twistRate");
  rate.value = "4";
  await rate.emit("change");
  assert.match(fixture.elements.get("clockSummary").textContent, /1\/16/);
  const tempo = fixture.elements.get("tempo");
  tempo.value = "300";
  await tempo.emit("input");
  assert.equal(fixture.elements.get("tempoOut").textContent, "300 BPM");
  assert.match(fixture.elements.get("clockSummary").textContent, /^300 BPM/);
  const swing = fixture.elements.get("swing");
  swing.value = "0.42";
  await swing.emit("input");
  assert.equal(fixture.elements.get("swingOut").textContent, "42%");
  const density = fixture.elements.get("twistDensity");
  density.value = "0.25";
  await density.emit("input");
  assert.equal(fixture.elements.get("twistDensityOut").textContent, "25%");
  assert.ok(
    stepStrip.children.some(({ className }) => className.includes("is-rest")),
    "lower density visibly gates optional steps",
  );

  await fixture.elements.get("resetAll").emit("click");
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(fixture.elements.get("sequencePattern").value, "axis-break");
  assert.equal(fixture.elements.get("playbackMode").value, "forward");
  assert.equal(fixture.elements.get("twistRate").value, "2");
  assert.equal(fixture.elements.get("tempo").value, "112");
  assert.equal(fixture.elements.get("swing").value, "0.08");
  assert.equal(fixture.elements.get("twistDensity").value, "1");
  assert.equal(clock.pendingCount, 0);
  if (queuedFrame) runFrame(clock.now + 700);

  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1);
  const audioContext = FakeAudioContext.instances[0];
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "true");
  assert.equal(audioContext.compressors[0].connections.includes(audioContext.destination), true);
  const persistentRattleSources = audioContext.bufferSources.filter(({ loop }) => loop);
  assert.equal(persistentRattleSources.length, 1, "audio enable creates one persistent noise loop");
  const rattleSource = persistentRattleSources[0];
  assert.deepEqual(rattleSource.starts, [0]);
  assert.deepEqual(rattleSource.stops, []);
  const rattleGain = audioContext.gains.find((node) => (
    node.gain.value === 0
    && node.connections.some(({ kind }) => kind === "panner")
  ));
  assert.ok(rattleGain, "the persistent noise loop has a dedicated silent gain stage");
  assert.deepEqual(
    audioContext.filters.slice(0, 2).map(({ type }) => type),
    ["highpass", "bandpass"],
    "the rattle loop is a permanently connected filtered noise layer",
  );
  audioContext.currentTime = 7.25;
  const oscillatorsBeforePlay = audioContext.oscillators.length;
  await fixture.elements.get("playButton").emit("click");
  assert.equal(audioContext.oscillators.length, oscillatorsBeforePlay + 1, "XY schedules one kick voice");
  const firstTransportOscillator = audioContext.oscillators.at(-1);
  const scheduledStart = firstTransportOscillator.starts[0];
  assert.ok(Math.abs(scheduledStart - 7.305) < 1e-9, "audio uses the absolute look-ahead clock");
  assert.equal(firstTransportOscillator.stops.length, 1);
  assert.equal(
    rattleGain.gain.events.some(([kind]) => kind === "set" || kind === "exponential"),
    false,
    "the original twist tape does not pulse the default-off rattle layer",
  );
  const transportTempo = fixture.elements.get("tempo");
  const oscillatorsBeforeTempoChange = audioContext.oscillators.length;
  const nonLoopSourcesBeforeTempoChange = audioContext.bufferSources.filter(({ loop }) => !loop).length;
  const pendingTimersBeforeTempoChange = clock.pendingCount;
  const firstNaturalStop = firstTransportOscillator.stops.at(-1);
  audioContext.currentTime = scheduledStart + 0.001;
  for (const tempoValue of ["80", "160", "300"]) {
    transportTempo.value = tempoValue;
    await transportTempo.emit("input");
  }
  assert.equal(fixture.elements.get("tempoOut").textContent, "300 BPM");
  assert.match(fixture.elements.get("clockSummary").textContent, /^300 BPM/);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(
    firstTransportOscillator.stops.at(-1),
    firstNaturalStop,
    "rapid tempo input leaves the sounding voice's natural tail intact",
  );
  assert.equal(firstTransportOscillator.disconnected, false);
  assert.equal(
    audioContext.oscillators.length,
    oscillatorsBeforeTempoChange,
    "tempo input does not synchronously replace or restart the look-ahead voice",
  );
  assert.equal(
    audioContext.bufferSources.filter(({ loop }) => !loop).length,
    nonLoopSourcesBeforeTempoChange,
  );
  assert.equal(clock.pendingCount, pendingTimersBeforeTempoChange, "the running clock stays armed");
  clock.advanceBy(700);
  const continuedTransportSources = [
    ...audioContext.oscillators.slice(oscillatorsBeforeTempoChange),
    ...audioContext.bufferSources.filter(({ loop }) => !loop).slice(nonLoopSourcesBeforeTempoChange),
  ];
  assert.ok(continuedTransportSources.length > 0, "new-tempo pulses continue on the existing clock");
  await fixture.elements.get("resetAll").emit("click");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(clock.pendingCount, 0, "reset stops and clears the transport");
  assert.equal(
    continuedTransportSources.every(({ stops, disconnected }) => (
      stops.at(-1) === audioContext.currentTime && disconnected
    )),
    true,
    "reset still cancels every later Web Audio onset after a live tempo change",
  );
  assert.equal(
    firstTransportOscillator.stops.at(-1),
    audioContext.currentTime,
    "hard reset terminates the currently sounding tail after a live tempo change",
  );
  assert.equal(firstTransportOscillator.disconnected, true);
  clock.advanceBy(500);
  assert.equal(fixture.elements.get("moveCount").textContent, "00", "reset cancels the visual move");

  if (queuedFrame) runFrame(clock.now + 700);

  const sequenceMethod = fixture.elements.get("sequenceMethod");
  sequenceMethod.value = "sticker-hyperbar";
  await sequenceMethod.emit("change");
  assert.equal(fixture.elements.get("hyperbarPanel").hidden, false);
  assert.match(fixture.elements.get("sequenceMethodHelp").textContent, /eight color voices/i);
  assert.match(fixture.elements.get("clockSummary").textContent, /· 27$/);
  const hyperbarRows = fixture.elements.get("hyperbarGrid").children;
  assert.equal(hyperbarRows.length, 8);
  assert.equal(hyperbarRows.every((row) => row.getAttribute("role") === "row"), true);
  assert.deepEqual(
    hyperbarRows.map((row) => row.getAttribute("aria-rowindex")),
    Array.from({ length: 8 }, (_, index) => String(index + 1)),
  );
  const hyperbarCells = hyperbarRows.flatMap((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
  assert.equal(hyperbarCells.length, 216, "the visualization renders eight lanes by 27 pulses");
  assert.equal(
    hyperbarCells.every((cell) => cell.getAttribute("role") === null),
    true,
    "editable pulses retain their native button semantics",
  );
  assert.equal(hyperbarCells.filter(({ tabIndex }) => tabIndex === 0).length, 1);
  assert.equal(
    hyperbarCells.filter((cell) => cell.dataset.hyperbarStep === "0").length,
    8,
    "each pulse addresses one slot in every color lane",
  );
  const gatedCells = hyperbarCells.filter((cell) => cell.getAttribute("aria-pressed") === "true");
  assert.ok(gatedCells.length >= 27 && gatedCells.length < 216);
  assert.equal(
    hyperbarCells.filter((cell) => (
      cell.dataset.hyperbarStep === "0" && cell.classList.contains("is-current")
    )).length,
    8,
  );
  const toggledGate = gatedCells[0];
  toggledGate.click();
  assert.equal(toggledGate.getAttribute("aria-pressed"), "false");
  assert.match(fixture.elements.get("liveStatus").textContent, /pulse \d+, off/i);
  toggledGate.click();
  assert.equal(toggledGate.getAttribute("aria-pressed"), "true");

  const rowButtons = hyperbarRows.map((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
  rowButtons[0][0].focus();
  let navigation = await rowButtons[0][0].emit("keydown", { key: "ArrowRight" });
  assert.equal(navigation.defaultPrevented, true);
  assert.equal(fixture.documentObject.activeElement, rowButtons[0][1]);
  navigation = await rowButtons[0][1].emit("keydown", { key: "ArrowDown" });
  assert.equal(navigation.defaultPrevented, true);
  assert.equal(fixture.documentObject.activeElement, rowButtons[1][1]);
  await rowButtons[1][1].emit("keydown", { key: "Home" });
  assert.equal(fixture.documentObject.activeElement, rowButtons[1][0]);
  await rowButtons[1][0].emit("keydown", { key: "End" });
  assert.equal(fixture.documentObject.activeElement, rowButtons[1][26]);
  await rowButtons[1][26].emit("keydown", { key: "Home", ctrlKey: true });
  assert.equal(fixture.documentObject.activeElement, rowButtons[0][0]);
  await rowButtons[0][0].emit("keydown", { key: "End", ctrlKey: true });
  assert.equal(fixture.documentObject.activeElement, rowButtons[7][26]);
  assert.deepEqual(rowButtons[7][26].scrollIntoViewCalls.at(-1), {
    block: "nearest",
    inline: "nearest",
  });
  assert.equal(hyperbarCells.filter(({ tabIndex }) => tabIndex === 0).length, 1);

  const focusedBeforeRender = rowButtons[3][11];
  focusedBeforeRender.focus();
  const focusedStickerId = focusedBeforeRender.dataset.stickerId;
  await sequenceMethod.emit("change");
  const focusedAfterRender = fixture.documentObject.activeElement;
  assert.notEqual(focusedAfterRender, focusedBeforeRender);
  assert.equal(focusedAfterRender.dataset.stickerId, focusedStickerId);
  assert.equal(focusedAfterRender.tabIndex, 0);
  const rerenderedHyperbarCells = fixture.elements.get("hyperbarGrid").children.flatMap((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
  assert.equal(rerenderedHyperbarCells.filter(({ tabIndex }) => tabIndex === 0).length, 1);

  const nonLoopSourceCount = () => audioContext.bufferSources.filter(({ loop }) => !loop).length;
  const topologyOscillators = audioContext.oscillators.filter(({ stops, connections }) => (
    stops.length === 0
      && connections[0]?.kind === "filter"
      && connections[0]?.connections[0]?.kind === "gain"
  ));
  assert.equal(
    topologyOscillators.length,
    48,
    "the neighbor graph owns six persistent strings for each of eight current cells",
  );
  const topologyLanes = topologyOscillators.map((oscillator) => {
    const filter = oscillator.connections[0];
    const gain = filter.connections[0];
    const panner = gain.connections[0];
    return { oscillator, filter, gain, panner };
  });
  const topologyBus = topologyLanes[0].panner.connections[0];
  assert.equal(topologyBus.gain.value, 0.22);
  const topologyControls = [
    ["topologyLevel", "0.6", "60%"],
    ["topologySpan", "24", "24 st"],
    ["topologyStrum", "0.08", "80 ms"],
    ["topologyRing", "3.5", "3.50 s"],
    ["topologyWarp", "2", "200%"],
  ];
  for (const [id, value, output] of topologyControls) {
    fixture.elements.get(id).value = value;
    await fixture.elements.get(id).emit("input");
    assert.equal(fixture.elements.get(`${id}Out`).textContent, output);
  }
  assert.deepEqual(topologyBus.gain.events.at(-1).slice(0, 2), ["target", 0.6]);
  const topologyEventOffsets = topologyLanes.map(({ gain }) => gain.gain.events.length);
  audioContext.currentTime = 8;
  let oscillatorsBefore = audioContext.oscillators.length;
  let noisesBefore = nonLoopSourceCount();
  await fixture.elements.get("playButton").emit("click");
  const stickerOscillators = audioContext.oscillators.slice(oscillatorsBefore);
  const stickerNoises = audioContext.bufferSources.filter(({ loop }) => !loop).slice(noisesBefore);
  assert.equal(stickerOscillators.length, 8, "the authored first hyperbar pulse gates eight color voices");
  assert.equal(stickerNoises.length, 7, "the eight voice families retain distinct synthesis structures");
  const excitedTopology = topologyLanes.map((lane, index) => ({
    ...lane,
    events: lane.gain.gain.events.slice(topologyEventOffsets[index]),
  })).filter(({ events }) => events.some(([kind, value]) => kind === "exponential" && value > 0.001));
  assert.equal(
    excitedTopology.length,
    24,
    "eight solved corner stickers expose all three real neighbor strings apiece",
  );
  const topologyOnsets = excitedTopology.flatMap(({ events }) => events
    .filter(([kind, value]) => kind === "exponential" && value > 0.001)
    .map(([, , when]) => when));
  assert.ok(
    Math.max(...topologyOnsets) - Math.min(...topologyOnsets) >= 0.08,
    "micro-strum spreads the forty-eight-lane mesh around the current cell order",
  );
  assert.ok(
    new Set(excitedTopology.map(({ oscillator }) => oscillator.frequency.value)).size > 8,
    "axis, direction, color, radial class, W, and order create a multi-interval zither field",
  );
  assert.equal(
    audioContext.oscillators.filter(({ stops }) => stops.length === 0).length,
    49,
    "topology density uses the fixed source bank rather than allocating per neighbor hit",
  );
  assert.ok(
    Math.abs(Math.min(...stickerOscillators.map(({ starts }) => starts[0])) - 8.055) < 1e-9,
    "sticker voices share the transport's absolute look-ahead time",
  );
  const expectedStickerPulseIds = new Set(rerenderedHyperbarCells.filter((cell) => (
    cell.dataset.hyperbarStep === "0" && cell.getAttribute("aria-pressed") === "true"
  )).map(({ dataset }) => dataset.stickerId));
  clock.advanceBy(55);
  const soundingStickerIds = fixture.elements.get("stage").dataset.soundingStickerIds.split(" ")
    .filter(Boolean);
  assert.deepEqual(
    new Set(soundingStickerIds),
    expectedStickerPulseIds,
    "the visual onset addresses the exact gated sticker IDs sent to the first audio pulse",
  );
  assert.equal(fixture.elements.get("stage").dataset.soundingStickerCount, "8");
  assert.match(fixture.elements.get("stageReadout").textContent, /08 sounding/i);
  assert.match(fixture.elements.get("sequenceVoice").textContent, /24 LINKS \/ 0 FAULTS/);
  assert.equal(typeof queuedFrame, "function", "a sounding sticker pulse schedules canvas paint");
  await fixture.elements.get("playButton").emit("click");
  assert.equal(clock.pendingCount, 0);
  assert.equal(fixture.elements.get("stage").dataset.soundingStickerCount, "0");
  assert.doesNotMatch(fixture.elements.get("stageReadout").textContent, /sounding/i);
  assert.equal(
    [...stickerOscillators, ...stickerNoises].every(({ stops }) => (
      stops.length === 2 && stops.at(-1) === audioContext.currentTime
    )),
    true,
    "pause stops every not-yet-started sticker voice at the current audio time",
  );
  if (queuedFrame) runFrame(clock.now + 700);

  const topologyMode = fixture.elements.get("topologyMode");
  const silenceOffsets = topologyLanes.map(({ gain }) => gain.gain.events.length);
  topologyMode.value = "cohesion";
  await topologyMode.emit("change");
  assert.equal(fixture.elements.get("soundSummary").textContent, "Hyper kit · matches");
  assert.equal(
    topologyLanes.every(({ gain }, index) => gain.gain.events.length > silenceOffsets[index]),
    true,
    "changing topology mode silences strings that the new graph excludes",
  );
  topologyMode.value = "faults";
  await topologyMode.emit("change");
  assert.equal(fixture.elements.get("soundSummary").textContent, "Hyper kit · faults");
  topologyMode.value = "off";
  await topologyMode.emit("change");
  assert.equal(fixture.elements.get("soundSummary").textContent, "Hyper kit");
  topologyMode.value = "mesh";
  await topologyMode.emit("change");
  assert.equal(fixture.elements.get("soundSummary").textContent, "Hyper kit · mesh");
  const topologyLevel = fixture.elements.get("topologyLevel");
  topologyLevel.value = "0";
  await topologyLevel.emit("input");
  assert.equal(fixture.elements.get("soundSummary").textContent, "Hyper kit");
  assert.equal(
    topologyLanes.every(({ gain }) => (
      gain.gain.events.at(-1)[0] === "set" && gain.gain.events.at(-1)[1] === 0
    )),
    true,
    "zero topology level hard-silences every lane so raising it cannot reveal an old tail",
  );
  topologyLevel.value = "0.6";
  await topologyLevel.emit("input");
  assert.equal(fixture.elements.get("soundSummary").textContent, "Hyper kit · mesh");

  sequenceMethod.value = "hybrid-coil";
  await sequenceMethod.emit("change");
  audioContext.currentTime = 9;
  oscillatorsBefore = audioContext.oscillators.length;
  noisesBefore = nonLoopSourceCount();
  await fixture.elements.get("playButton").emit("click");
  const hybridOscillators = audioContext.oscillators.slice(oscillatorsBefore);
  const hybridNoises = audioContext.bufferSources.filter(({ loop }) => !loop).slice(noisesBefore);
  assert.equal(
    hybridOscillators.length,
    9,
    "hybrid pulse adds the original XY plane kick to all eight first-pulse color voices",
  );
  assert.equal(hybridNoises.length, 7);
  const currentHyperbarCells = fixture.elements.get("hyperbarGrid").children.flatMap((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
  const expectedHybridPulseIds = new Set(currentHyperbarCells.filter((cell) => (
    cell.dataset.hyperbarStep === "0" && cell.getAttribute("aria-pressed") === "true"
  )).map(({ dataset }) => dataset.stickerId));
  clock.advanceBy(55);
  assert.deepEqual(
    new Set(fixture.elements.get("stage").dataset.soundingStickerIds.split(" ").filter(Boolean)),
    expectedHybridPulseIds,
    "hybrid visual time uses the same gated sticker IDs while retaining its legacy move layer",
  );
  runFrame(clock.now);
  assert.match(
    fixture.elements.get("puzzleState").textContent,
    /turning/i,
    "hybrid retains the legacy affected-slice turn animation beneath sticker glows",
  );
  runFrame(clock.now + 181);
  assert.equal(
    fixture.elements.get("stage").dataset.soundingStickerCount,
    "0",
    "sticker glow expires on the animation clock",
  );
  sequenceMethod.value = "twist-tape";
  await sequenceMethod.emit("change");
  assert.equal(fixture.elements.get("stage").dataset.soundingStickerCount, "0");
  assert.equal(
    [...hybridOscillators, ...hybridNoises].every(({ stops }) => stops.at(-1) === 9),
    true,
    "changing sequencer method cancels the previous method's future audio graph",
  );
  await fixture.elements.get("playButton").emit("click");
  if (queuedFrame) runFrame(clock.now + 700);

  let manualFrameTime = clock.now + 2_000;
  const performManualTurn = async (cell, method, plane) => {
    if (sequenceMethod.value !== method) {
      sequenceMethod.value = method;
      await sequenceMethod.emit("change");
    }
    const face = fixture.faceButtons.find((button) => button.dataset.face === cell);
    assert.ok(face, `${cell} should have a face selector`);
    await face.emit("click");
    if (plane) {
      const planeButton = fixture.elements.get("planePicker").children.find(
        (button) => button.dataset.plane === plane,
      );
      assert.ok(planeButton, `${plane} should be a legal plane for ${cell}`);
      await planeButton.emit("click");
    }
    const before = {
      oscillators: audioContext.oscillators.length,
      sources: audioContext.bufferSources.length,
      filters: audioContext.filters.length,
      panners: audioContext.panners.length,
    };
    await fixture.elements.get("turnClockwise").emit("click");
    manualFrameTime += 10;
    runFrame(manualFrameTime);
    const result = {
      oscillators: audioContext.oscillators.slice(before.oscillators),
      sources: audioContext.bufferSources.slice(before.sources).filter(({ loop }) => !loop),
      filters: audioContext.filters.slice(before.filters),
      panners: audioContext.panners.slice(before.panners),
    };
    manualFrameTime += 2;
    runFrame(manualFrameTime);
    manualFrameTime += 700;
    runFrame(manualFrameTime);
    return result;
  };

  const reachesOutput = (source, output, visited = new Set()) => {
    if (source === output) return true;
    if (visited.has(source)) return false;
    visited.add(source);
    return source.connections.some((destination) => reachesOutput(destination, output, visited));
  };
  const voiceGroups = (result) => result.panners.map((panner) => ({
    panner,
    oscillators: result.oscillators.filter((node) => reachesOutput(node, panner)),
    sources: result.sources.filter((node) => reachesOutput(node, panner)),
  }));
  const sourceFilterType = (source) => source.connections[0]?.type;
  const sourceDuration = (source) => source.stops[0] - source.starts[0];
  const selectedVoiceMatcher = {
    "x+": ({ oscillators, sources }) => (
      oscillators.length === 1 && sources.length === 1 && sourceFilterType(sources[0]) === "highpass"
    ),
    "x-": ({ oscillators, sources }) => oscillators.length === 1 && sources.length === 0,
    "y-": ({ oscillators, sources }) => (
      oscillators.length === 1 && sources.length === 1 && sourceFilterType(sources[0]) === "bandpass"
    ),
    "y+": ({ oscillators, sources }) => oscillators.length === 0 && sources.length === 3,
    "z-": ({ oscillators, sources }) => (
      oscillators.length === 0 && sources.length === 1 && sourceDuration(sources[0]) <= 0.095
    ),
    "z+": ({ oscillators, sources }) => (
      oscillators.length === 0 && sources.length === 1 && sourceDuration(sources[0]) > 0.095
    ),
    "w-": ({ oscillators, sources }) => oscillators.length === 2 && sources.length === 0,
    "w+": ({ oscillators, sources }) => oscillators.length === 3 && sources.length === 0,
  };
  for (const cell of Object.keys(selectedVoiceMatcher)) {
    await fixture.elements.get("resetAll").emit("click");
    if (queuedFrame) {
      manualFrameTime += 700;
      runFrame(manualFrameTime);
    }
    const result = await performManualTurn(cell, "sticker-hyperbar");
    const groups = voiceGroups(result);
    assert.ok(groups.length > 1 && groups.length <= 8, `${cell} should audition a bounded slice cluster`);
    assert.equal(
      groups.some(selectedVoiceMatcher[cell]),
      true,
      `${cell} includes its selected color voice among affected sticker representatives`,
    );
    assert.equal(
      groups.every(({ panner }) => panner.pan.value >= -0.8 && panner.pan.value <= 0.8),
      true,
      `${cell} cluster owns geometry-linked stereo outputs`,
    );
    assert.equal(
      result.filters.every(({ frequency, Q }) => frequency.value > 0 && Q.value > 0),
      true,
      `${cell} cluster applies geometry and plane filter controls`,
    );
    const onsets = [
      ...result.oscillators.map(({ starts }) => starts[0]),
      ...result.sources.map(({ starts }) => starts[0]),
    ];
    assert.ok(new Set(onsets).size > 1, `${cell} slice voices should form a staggered cluster`);
  }

  const rattlePulseEventsBeforeManualVoices = rattleGain.gain.events.filter(
    ([kind, value]) => (kind === "set" || kind === "exponential") && value > 0,
  ).length;
  assert.equal(rattlePulseEventsBeforeManualVoices, 0, "manual color turns leave an unarmed rattle silent");

  const turnFromSolved = async (method) => {
    await fixture.elements.get("resetAll").emit("click");
    if (queuedFrame) {
      manualFrameTime += 700;
      runFrame(manualFrameTime);
    }
    return performManualTurn("w+", method, "xy");
  };
  const twistOnly = await turnFromSolved("twist-tape");
  const stickerOnly = await turnFromSolved("sticker-hyperbar");
  const hybrid = await turnFromSolved("hybrid-coil");
  assert.deepEqual(
    [twistOnly.oscillators.length, twistOnly.sources.length, twistOnly.panners.length],
    [1, 0, 1],
    "twist tape manual turns retain exactly one legacy plane hit",
  );
  assert.ok(stickerOnly.panners.length > 1 && stickerOnly.panners.length <= 8);
  assert.equal(
    hybrid.oscillators.length,
    stickerOnly.oscillators.length + twistOnly.oscillators.length,
  );
  assert.equal(hybrid.sources.length, stickerOnly.sources.length + twistOnly.sources.length);
  assert.equal(
    hybrid.panners.length,
    stickerOnly.panners.length + twistOnly.panners.length,
    "hybrid manual turns add one legacy plane hit to the same bounded sticker cluster",
  );

  await fixture.elements.get("resetAll").emit("click");
  if (queuedFrame) runFrame(manualFrameTime + 700);
  assert.equal(fixture.elements.get("rattleButton").getAttribute("aria-pressed"), "false");
  assert.equal(audioContext.bufferSources.filter(({ loop }) => loop).length, 1);
  await fixture.elements.get("rattleButton").emit("click");
  assert.equal(fixture.elements.get("rattleButton").getAttribute("aria-pressed"), "true");
  assert.match(fixture.elements.get("rattleState").textContent, /^1\/16\b/);
  const rattleRate = fixture.elements.get("rattleRate");
  rattleRate.value = "2";
  await rattleRate.emit("change");
  assert.match(fixture.elements.get("rattleState").textContent, /^1\/8\b/);
  let rattleEventsBefore = rattleGain.gain.events.length;
  await performManualTurn("w+", "twist-tape", "xy");
  const eighthNoteRattle = rattleGain.gain.events.slice(rattleEventsBefore);
  const eighthNotePulses = eighthNoteRattle.filter(([kind]) => kind === "set");
  assert.ok(eighthNotePulses.length >= 3);
  assert.equal(
    eighthNoteRattle.filter(([kind]) => kind === "exponential").length,
    eighthNotePulses.length * 2,
    "every rattle grain blooms and returns to silence",
  );
  assert.equal(eighthNotePulses.every(([, , when]) => when >= audioContext.currentTime), true);
  rattleRate.value = "8";
  await rattleRate.emit("change");
  assert.equal(rattleRate.value, "8");
  assert.match(fixture.elements.get("rattleState").textContent, /^1\/32\b/);
  rattleEventsBefore = rattleGain.gain.events.length;
  await performManualTurn("w+", "twist-tape", "xy");
  const thirtySecondPulses = rattleGain.gain.events.slice(rattleEventsBefore)
    .filter(([kind]) => kind === "set");
  assert.ok(
    thirtySecondPulses.length > eighthNotePulses.length,
    "the 1/32 coil emits a denser continuous rattle than 1/8",
  );
  assert.ok(audioContext.filters[1].frequency.events.some(([kind]) => kind === "set"));
  assert.ok(audioContext.filters[1].Q.events.some(([kind]) => kind === "set"));
  assert.ok(audioContext.panners[0].pan.events.some(([kind]) => kind === "set"));

  await fixture.elements.get("playButton").emit("click");
  const silenceEventsBeforePause = rattleGain.gain.events.length;
  await fixture.elements.get("playButton").emit("click");
  assert.deepEqual(
    rattleGain.gain.events.slice(silenceEventsBeforePause).at(-1)?.slice(0, 2),
    ["target", 0],
    "transport pause ramps the continuous layer silent",
  );
  const silenceEventsBeforeAudioOff = rattleGain.gain.events.length;
  await fixture.elements.get("audioButton").emit("click");
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "false");
  assert.deepEqual(
    rattleGain.gain.events.slice(silenceEventsBeforeAudioOff).at(-1)?.slice(0, 2),
    ["set", 0],
    "global audio off hard-silences the rattle graph",
  );
  assert.equal(
    topologyLanes.every(({ gain }) => (
      gain.gain.events.at(-1)[0] === "set" && gain.gain.events.at(-1)[1] === 0
    )),
    true,
    "global audio off hard-silences topology before output can be re-enabled",
  );
  assert.equal(rattleSource.stops.length, 0, "audio off keeps the reusable seed loop alive");
  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(audioContext.bufferSources.filter(({ loop }) => loop).length, 1);

  sequenceMethod.value = "sticker-hyperbar";
  await sequenceMethod.emit("change");
  const oscillatorsBeforeHiddenPlay = audioContext.oscillators.length;
  const sourcesBeforeHiddenPlay = audioContext.bufferSources.length;
  await fixture.elements.get("playButton").emit("click");
  const hiddenTransportSources = [
    ...audioContext.oscillators.slice(oscillatorsBeforeHiddenPlay).filter(({ starts, stops }) => (
      starts.at(-1) > audioContext.currentTime && stops.length === 1
    )),
    ...audioContext.bufferSources.slice(sourcesBeforeHiddenPlay).filter(({ loop, starts, stops }) => (
      !loop && starts.at(-1) > audioContext.currentTime && stops.length === 1
    )),
  ];
  assert.ok(hiddenTransportSources.length > 0);
  clock.advanceBy(55);
  assert.ok(Number(fixture.elements.get("stage").dataset.soundingStickerCount) > 0);
  audioContext.currentTime = Math.min(...hiddenTransportSources.map(({ starts }) => starts[0])) + 0.001;
  const rattleEventsBeforeHidden = rattleGain.gain.events.length;
  fixture.documentObject.hidden = true;
  fixture.documentObject.visibilityState = "hidden";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "suspended");
  assert.equal(clock.pendingCount, 0, "a hidden page clears its scheduler callbacks");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(
    fixture.elements.get("stage").dataset.soundingStickerCount,
    "0",
    "visibility suspension clears sounding sticker highlights",
  );
  assert.equal(
    hiddenTransportSources.every(({ stops }) => stops.at(-1) === audioContext.currentTime),
    true,
    "visibility suspension hard-cancels future and already-started one-shots",
  );
  assert.equal(hiddenTransportSources.every(({ disconnected }) => disconnected), true);
  assert.deepEqual(
    rattleGain.gain.events.slice(rattleEventsBeforeHidden).at(-1)?.slice(0, 2),
    ["set", 0],
    "a hidden page hard-silences the rattle layer before suspension",
  );
  assert.equal(
    topologyLanes.every(({ gain }) => (
      gain.gain.events.at(-1)[0] === "set" && gain.gain.events.at(-1)[1] === 0
    )),
    true,
    "a hidden page hard-silences topology before suspending the audio clock",
  );
  fixture.documentObject.hidden = false;
  fixture.documentObject.visibilityState = "visible";
  const oscillatorsBeforeVisible = audioContext.oscillators.length;
  const sourcesBeforeVisible = audioContext.bufferSources.length;
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "running");
  assert.equal(clock.pendingCount, 2, "visible playback resumes from a fresh absolute clock");
  clock.advanceBy(55);
  assert.ok(Number(fixture.elements.get("stage").dataset.soundingStickerCount) > 0);

  const bfcacheTransportSources = [
    ...audioContext.oscillators.slice(oscillatorsBeforeVisible).filter(({ starts, stops }) => (
      starts.at(-1) > audioContext.currentTime && stops.length === 1
    )),
    ...audioContext.bufferSources.slice(sourcesBeforeVisible).filter(({ loop, starts, stops }) => (
      !loop && starts.at(-1) > audioContext.currentTime && stops.length === 1
    )),
  ];
  assert.ok(bfcacheTransportSources.length > 0);
  audioContext.currentTime = Math.min(...bfcacheTransportSources.map(({ starts }) => starts[0])) + 0.001;
  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: true });
  assert.equal(audioContext.state, "suspended", "BFCache exit preserves logical playback");
  assert.equal(clock.pendingCount, 0);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(
    fixture.elements.get("stage").dataset.soundingStickerCount,
    "0",
    "BFCache pagehide clears sounding sticker highlights",
  );
  assert.equal(
    bfcacheTransportSources.every(({ stops }) => stops.at(-1) === audioContext.currentTime),
    true,
    "BFCache pagehide hard-cancels future and already-started transport audio",
  );
  assert.equal(bfcacheTransportSources.every(({ disconnected }) => disconnected), true);
  await emitRuntime(fixture.windowListeners, "pageshow", { persisted: true });
  assert.equal(audioContext.state, "running");
  assert.equal(clock.pendingCount, 2);
  clock.advanceBy(55);
  assert.ok(Number(fixture.elements.get("stage").dataset.soundingStickerCount) > 0);
  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: false });
  assert.equal(audioContext.state, "closed");
  assert.equal(fixture.elements.get("stage").dataset.soundingStickerCount, "0");
  assert.equal(rattleSource.stops.length, 1, "final navigation stops the persistent noise source");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(clock.pendingCount, 0);
});

test("Hyper Rubix serial streams traverse exact sticker bags and keep fast motion coherent", async (t) => {
  const fixture = runtimeFixture();
  const clock = new FakeClock(40_000);
  const propertyNames = [
    "document", "window", "AudioContext", "webkitAudioContext", "ResizeObserver",
    "requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout",
  ];
  const originals = new Map(propertyNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]));
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  let nextFrameId = 0;
  let queuedFrame = null;
  globalThis.document = fixture.documentObject;
  globalThis.window = fixture.windowObject;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.webkitAudioContext = undefined;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => clock.now },
  });
  globalThis.setTimeout = clock.setTimeout.bind(clock);
  globalThis.clearTimeout = clock.clearTimeout.bind(clock);
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
  FakeAudioContext.instances.length = 0;

  const hasQueuedFrame = () => typeof queuedFrame === "function";
  const runFrame = (time = clock.now) => {
    assert.equal(typeof queuedFrame, "function", `a frame should be queued for ${time}`);
    const callback = queuedFrame;
    queuedFrame = null;
    callback(time);
  };
  const drainFrames = (time = clock.now + 700) => {
    let frameTime = time;
    let frames = 0;
    while (hasQueuedFrame()) {
      runFrame(frameTime);
      frameTime += 700;
      frames += 1;
      assert.ok(frames < 8, "animation frames should settle");
    }
  };
  const gridCells = () => fixture.elements.get("hyperbarGrid").children.flatMap((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
  const currentGridCells = () => gridCells().filter((cell) => (
    cell.classList.contains("is-current")
  ));
  const setSelect = async (id, value) => {
    const control = fixture.elements.get(id);
    control.value = String(value);
    await control.emit("change");
  };
  const setRange = async (id, value) => {
    const control = fixture.elements.get(id);
    control.value = String(value);
    await control.emit("input");
  };
  const configureFastClock = async ({ playback = "forward", swing = 0 } = {}) => {
    await setRange("tempo", 300);
    await setSelect("twistRate", 16);
    await setRange("swing", swing);
    await setSelect("playbackMode", playback);
  };
  const assertSerialVisual = (expectedLength) => {
    const currentId = fixture.elements.get("stage").dataset.currentSoundingStickerId;
    const trailIds = fixture.elements.get("stage").dataset.soundingStickerIds
      .split(" ")
      .filter(Boolean);
    const currentCells = currentGridCells();
    assert.equal(typeof currentId, "string");
    assert.notEqual(currentId, "", "a serial pulse exposes one exact canvas playhead");
    assert.equal(currentCells.length, 1, "the matrix has one exact serial playhead");
    assert.equal(currentCells[0].dataset.stickerId, currentId);
    assert.ok(trailIds.includes(currentId), "the current sticker belongs to the visible canvas trail");
    assert.ok(trailIds.length >= 1 && trailIds.length <= 4, "the serial canvas trail stays bounded");
    assert.match(
      fixture.elements.get("hyperbarReadout").textContent,
      new RegExp(`/ ${expectedLength}$`),
    );
    return currentId;
  };
  const collectStraightPulses = (count, length, firstDelay = 55, interval = 12.5) => {
    const ids = [];
    for (let index = 0; index < count; index += 1) {
      clock.advanceBy(index === 0 ? firstDelay : interval);
      ids.push(assertSerialVisual(length));
    }
    return ids;
  };

  await import(`../hyper-rubix-app.js?serial-runtime=${Date.now()}`);
  runFrame();
  await fixture.elements.get("audioButton").emit("click");
  const audioContext = FakeAudioContext.instances[0];
  assert.ok(audioContext);

  await setSelect("sequenceMethod", "sticker-stream");
  await configureFastClock();
  assert.equal(fixture.elements.get("playLabel").textContent, "Play sticker stream");
  assert.match(fixture.elements.get("sequenceNow").textContent, /^STICKER 001 \/ 216/);
  assert.equal(fixture.elements.get("hyperbarReadout").textContent, "STICKER 001 / 216");
  assert.equal(currentGridCells().length, 1, "the stopped stream has one method-aware idle playhead");
  const stickerCells = gridCells();
  assert.equal(stickerCells.length, HYPER_RUBIX_STICKER_STREAM_LENGTH);
  assert.equal(stickerCells.filter(({ disabled }) => disabled).length, 0);
  assert.equal(
    stickerCells.filter((cell) => cell.getAttribute("aria-pressed") === "true").length,
    HYPER_RUBIX_STICKER_STREAM_LENGTH,
    "Sticker Stream begins with no authored rests",
  );
  const idleStickerCell = currentGridCells()[0];
  idleStickerCell.click();
  assert.equal(idleStickerCell.getAttribute("aria-pressed"), "false");
  assert.match(fixture.elements.get("sequenceNow").textContent, /MUTED$/);
  assert.equal(fixture.elements.get("sequenceVoice").textContent, "MUTED STICKER");
  idleStickerCell.click();
  assert.equal(idleStickerCell.getAttribute("aria-pressed"), "true");
  assert.doesNotMatch(fixture.elements.get("sequenceNow").textContent, /MUTED$/);

  const solvedPuzzle = createSolvedHyperRubix();
  const solvedStickerIds = createHyperRubixStickerStream(solvedPuzzle).map(({ stickerId }) => stickerId);
  const turnedPuzzle = turnHyperRubixBoundaryCell(solvedPuzzle, {
    cell: "x+",
    plane: "yz",
    quarterTurns: 1,
  });
  const turnedStickerIds = createHyperRubixStickerStream(turnedPuzzle).map(({ stickerId }) => stickerId);
  assert.notEqual(turnedStickerIds[0], solvedStickerIds[0]);

  const timerScheduleStart = clock.schedules.length;
  const transportPannerStart = audioContext.panners.length;
  await fixture.elements.get("playButton").emit("click");
  const stickerIds = [collectStraightPulses(1, HYPER_RUBIX_STICKER_STREAM_LENGTH)[0]];
  assert.equal(fixture.elements.get("moveCount").textContent, "00", "serial playback never auto-twists");

  const xPositive = fixture.faceButtons.find(({ dataset }) => dataset.face === "x+");
  await xPositive.emit("click");
  const yzPlane = fixture.elements.get("planePicker").children.find(({ dataset }) => (
    dataset.plane === "yz"
  ));
  assert.ok(yzPlane);
  await yzPlane.emit("click");
  const manualPannerStart = audioContext.panners.length;
  await fixture.elements.get("turnClockwise").emit("click");
  runFrame(clock.now);
  runFrame(clock.now + 2);
  drainFrames(clock.now + 702);
  const manualPannerCount = audioContext.panners.length - manualPannerStart;
  assert.ok(manualPannerCount > 0, "the manual turn keeps its bounded audition while the stream runs");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(fixture.elements.get("moveCount").textContent, "01");

  stickerIds.push(...collectStraightPulses(
    HYPER_RUBIX_STICKER_STREAM_LENGTH - 1,
    HYPER_RUBIX_STICKER_STREAM_LENGTH,
    12.5,
  ));
  assert.deepEqual(stickerIds, solvedStickerIds, "a turn does not tear the in-flight 216-sticker bag");
  assert.equal(new Set(stickerIds).size, HYPER_RUBIX_STICKER_STREAM_LENGTH);
  assert.equal(fixture.elements.get("moveCount").textContent, "01", "only the manual turn changed the puzzle");

  clock.advanceBy(12.5);
  assert.equal(
    assertSerialVisual(HYPER_RUBIX_STICKER_STREAM_LENGTH),
    turnedStickerIds[0],
    "the completed turn reshapes the next complete sticker scan",
  );
  const transportPannerCount = audioContext.panners.length
    - transportPannerStart
    - manualPannerCount;
  const visualScheduleCount = clock.schedules.slice(timerScheduleStart)
    .filter(({ callbackName }) => callbackName !== "schedulerTick").length;
  assert.equal(
    transportPannerCount,
    visualScheduleCount,
    "every scheduled 1/64 serial pulse creates exactly one conceptual sticker hit",
  );
  await fixture.elements.get("playButton").emit("click");

  await setSelect("sequenceMethod", "corner-stream");
  const cornerCells = gridCells();
  assert.equal(cornerCells.length, HYPER_RUBIX_STICKER_STREAM_LENGTH);
  assert.equal(
    cornerCells.filter(({ disabled }) => !disabled).length,
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
  );
  assert.equal(cornerCells.filter(({ disabled }) => disabled).length, 152);
  assert.equal(
    cornerCells.filter((cell) => !cell.disabled && cell.getAttribute("aria-pressed") === "true").length,
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
    "all and only corner events begin enabled",
  );
  assert.equal(
    cornerCells.filter((cell) => cell.disabled && cell.getAttribute("aria-pressed") === "false").length,
    152,
  );
  assert.equal(currentGridCells().length, 1);
  assert.match(fixture.elements.get("sequenceNow").textContent, /^STICKER 001 \/ 64/);
  assert.equal(fixture.elements.get("hyperbarReadout").textContent, "STICKER 001 / 64");

  const turnedCornerIds = createHyperRubixStickerStream(turnedPuzzle, { cornersOnly: true })
    .map(({ stickerId }) => stickerId);
  assert.equal(turnedCornerIds.length, HYPER_RUBIX_CORNER_STREAM_LENGTH);
  await fixture.elements.get("playButton").emit("click");
  const cornerIds = collectStraightPulses(
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
  );
  assert.deepEqual(cornerIds, turnedCornerIds);
  assert.equal(new Set(cornerIds).size, HYPER_RUBIX_CORNER_STREAM_LENGTH);
  assert.equal(fixture.elements.get("moveCount").textContent, "01");
  await fixture.elements.get("playButton").emit("click");

  await fixture.elements.get("audioButton").emit("click");
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "false");
  await setSelect("playbackMode", "random");
  const randomIdleId = currentGridCells()[0].dataset.stickerId;
  const randomRestartLabel = fixture.elements.get("restartLoop").getAttribute("aria-label");
  assert.match(randomRestartLabel, /Corner stream.+seeded Random shuffle/);
  assert.equal(fixture.elements.get("restartLoop").getAttribute("title"), randomRestartLabel);
  assert.match(fixture.elements.get("restartInstructions").textContent, /Corner stream.+Random shuffle/);
  assert.doesNotMatch(randomRestartLabel, /step one/i);
  await fixture.elements.get("playButton").emit("click");
  clock.advanceBy(55);
  assert.equal(
    assertSerialVisual(HYPER_RUBIX_CORNER_STREAM_LENGTH),
    randomIdleId,
    "Random idle peeks at the same seeded shuffle the scheduler will play",
  );
  await fixture.elements.get("restartLoop").emit("click");
  assert.equal(currentGridCells()[0].dataset.stickerId, randomIdleId);
  assert.match(fixture.elements.get("liveStatus").textContent, /seeded Random shuffle/);
  assert.doesNotMatch(fixture.elements.get("liveStatus").textContent, /step one/i);
  const randomCornerIds = collectStraightPulses(
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
  );
  assert.equal(new Set(randomCornerIds).size, HYPER_RUBIX_CORNER_STREAM_LENGTH);
  assert.deepEqual(
    new Set(randomCornerIds),
    new Set(turnedCornerIds),
    "random playback is one shuffled bag without replacement",
  );
  await fixture.elements.get("playButton").emit("click");

  await setSelect("playbackMode", "reverse");
  const reverseRestartLabel = fixture.elements.get("restartLoop").getAttribute("aria-label");
  assert.match(reverseRestartLabel, /Corner stream.+Reverse playback start/);
  assert.doesNotMatch(reverseRestartLabel, /step one/i);
  assert.match(fixture.elements.get("restartInstructions").textContent, /Reverse playback start/);
  await fixture.elements.get("restartLoop").emit("click");
  assert.match(fixture.elements.get("liveStatus").textContent, /Reverse playback start/);
  assert.doesNotMatch(fixture.elements.get("liveStatus").textContent, /step one/i);
  await fixture.elements.get("playButton").emit("click");
  const reverseCornerIds = collectStraightPulses(
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
  );
  assert.deepEqual(reverseCornerIds, [...turnedCornerIds].reverse());
  await fixture.elements.get("playButton").emit("click");

  await setSelect("playbackMode", "pendulum");
  await fixture.elements.get("playButton").emit("click");
  const pendulumPeriod = 2 * (HYPER_RUBIX_CORNER_STREAM_LENGTH - 1);
  const pendulumIds = collectStraightPulses(
    pendulumPeriod + 1,
    HYPER_RUBIX_CORNER_STREAM_LENGTH,
  );
  const expectedPendulumIds = Array.from({ length: pendulumPeriod + 1 }, (_, position) => {
    const index = position < HYPER_RUBIX_CORNER_STREAM_LENGTH
      ? position
      : pendulumPeriod - position;
    return turnedCornerIds[index];
  });
  assert.deepEqual(pendulumIds, expectedPendulumIds, "pendulum changes bags only at its full period");
  await fixture.elements.get("playButton").emit("click");

  await fixture.elements.get("resetAll").emit("click");
  drainFrames();
  await configureFastClock({ swing: 0.42 });
  await setSelect("twistMotion", "auto");
  assert.match(fixture.elements.get("clockSummary").textContent, /÷32$/);
  await fixture.elements.get("playButton").emit("click");
  const motionTimes = [];
  let previousMoveCount = 0;
  for (let position = 0; position <= 160; position += 1) {
    const previousPosition = position - 1;
    const delay = position === 0
      ? 55
      : 12.5 * (previousPosition % 2 === 0 ? 1.42 : 0.58);
    clock.advanceBy(delay);
    if (hasQueuedFrame()) runFrame(clock.now);
    if (hasQueuedFrame()) runFrame(clock.now + 2);
    if (hasQueuedFrame()) runFrame(clock.now + 702);
    const moveCount = Number(fixture.elements.get("moveCount").textContent);
    if (moveCount > previousMoveCount) motionTimes.push(clock.now);
    previousMoveCount = moveCount;
  }
  assert.ok(motionTimes.length >= 5, "the high-rate tape still produces visible physical twists");
  assert.equal(
    motionTimes.slice(1).every((time, index) => time - motionTimes[index] >= 250 - 1e-6),
    true,
    "300 BPM 1/64 motion never exceeds four physical twists per second",
  );
  await fixture.elements.get("playButton").emit("click");

  const verifySuspensionRestart = async ({ bfcache = false } = {}) => {
    await fixture.elements.get("resetAll").emit("click");
    drainFrames();
    await fixture.elements.get("playButton").emit("click");
    if (bfcache) {
      await emitRuntime(fixture.windowListeners, "pagehide", { persisted: true });
      assert.equal(clock.pendingCount, 0);
      await emitRuntime(fixture.windowListeners, "pageshow", { persisted: true });
    } else {
      fixture.documentObject.hidden = true;
      fixture.documentObject.visibilityState = "hidden";
      await emitRuntime(fixture.documentListeners, "visibilitychange");
      assert.equal(clock.pendingCount, 0);
      fixture.documentObject.hidden = false;
      fixture.documentObject.visibilityState = "visible";
      await emitRuntime(fixture.documentListeners, "visibilitychange");
    }
    assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
    clock.advanceBy(55);
    assert.match(
      fixture.elements.get("sequenceNow").textContent,
      /^STEP 01/,
      `${bfcache ? "BFCache" : "visibility"} resume restarts from the real puzzle state`,
    );
    if (hasQueuedFrame()) runFrame(clock.now);
    if (hasQueuedFrame()) runFrame(clock.now + 2);
    assert.equal(fixture.elements.get("moveCount").textContent, "01");
    await fixture.elements.get("playButton").emit("click");
  };
  await verifySuspensionRestart();
  await verifySuspensionRestart({ bfcache: true });
  assert.equal(clock.pendingCount, 0);
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
