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
import { WebGpu303Audio } from "../src/webgpu-303.js";
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

  createBuffer(channels, length, sampleRate = this.sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate,
      length,
      getChannelData: (channel) => data[channel],
    };
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

function runtimeFixture({ webGpu = false } = {}) {
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
    "playbackPreset", "playbackPresetHelp", "playbackScopeReadout", "playbackCells", "playbackCount",
    "tone", "toneOut", "decay", "decayOut", "decayLink", "decayLinkHelp", "resetAll", "rotationReadout",
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
    "restartLoop", "reseedPattern", "rattleButton",
  ]) elements.get(id).tagName = "BUTTON";
  for (const id of [
    "output", "tempo", "swing", "twistDensity", "rotationSpeed", "projectionDepth",
    "cellSeparation", "stickerScale", "tone", "decay", "rattleLevel", "shapeInfluence",
    "topologyLevel", "topologySpan", "topologyStrum", "topologyRing", "topologyWarp",
    "pitchInfluence", "filterInfluence", "stereoInfluence", "neighborResponse",
    "wInfluence", "disorderInfluence",
  ]) elements.get(id).tagName = "INPUT";
  for (const id of [
    "voice", "playbackPreset", "decayLink", "sequenceMethod", "sequencePattern", "playbackMode",
    "twistRate", "twistMotion", "rattleRate", "puzzleSize", "topologyMode",
  ]) {
    elements.get(id).tagName = "SELECT";
  }
  elements.get("voice").value = "pulse";
  elements.get("playbackPreset").value = "view-facing";
  elements.get("decayLink").value = "linked";
  elements.get("puzzleSize").value = "3";
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
  elements.get("topologyRing").value = "0.58";
  elements.get("topologyWarp").value = "1";
  elements.get("stage").tagName = "CANVAS";
  elements.get("stage").getContext = () => drawingContext();
  elements.get("audioButton").setAttribute("aria-pressed", "false");
  elements.get("playButton").setAttribute("aria-pressed", "false");
  elements.get("rattleButton").setAttribute("aria-pressed", "false");
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
    navigator: webGpu ? { gpu: { requestAdapter() {} } } : {},
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
    "document", "window", "navigator", "AudioContext", "webkitAudioContext", "ResizeObserver",
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
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: fixture.windowObject.navigator,
  });
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

function installFakeWebGpu303Engine(t) {
  const prototype = WebGpu303Audio.prototype;
  const methodNames = [
    "start", "stop", "pauseTimeline", "restartTimeline", "currentPlaybackTime", "updateParams",
  ];
  const originals = new Map(methodNames.map((name) => [name, prototype[name]]));
  const instances = [];

  prototype.start = async function start(params, options = {}) {
    this.context = options.context;
    this.destination = options.destination;
    this.input = audioNode("webgpu-input");
    this.master = audioNode("webgpu-master", { gain: audioParam(0) });
    this.device = {};
    this.params = { ...params };
    this.running = false;
    this.__phaseWrites = [this.params.sequencePhase];
    this.__restartCalls = [];
    instances.push(this);
    return this.context;
  };
  prototype.updateParams = function updateParams(params) {
    originals.get("updateParams").call(this, params);
    this.__phaseWrites ??= [];
    this.__phaseWrites.push(this.params.sequencePhase);
  };
  prototype.restartTimeline = async function restartTimeline({ startAt, offset = 0 } = {}) {
    this.__restartCalls ??= [];
    this.__restartCalls.push({
      offset,
      sequencePhase: this.params.sequencePhase,
      startAt,
    });
    this.renderOffset = offset;
    this.nextStartTime = startAt;
    this.running = true;
    return startAt;
  };
  prototype.currentPlaybackTime = function currentPlaybackTime() {
    return this.running ? 0 : null;
  };
  prototype.pauseTimeline = function pauseTimeline() {
    this.running = false;
    return this.renderOffset;
  };
  prototype.stop = async function stop() {
    this.running = false;
    this.context = null;
    this.input = null;
    this.master = null;
    this.device = null;
  };

  t.after(() => {
    for (const [name, method] of originals) prototype[name] = method;
  });
  return { instances };
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function activeOneShotSources(audioContext) {
  return [
    ...audioContext.oscillators.filter(({ stops, disconnected }) => stops.length && !disconnected),
    ...audioContext.bufferSources.filter(({ loop, disconnected }) => !loop && !disconnected),
  ];
}

function currentStickerPosition(fixture) {
  const match = fixture.elements.get("sequenceNow").textContent.match(
    /^STICKER\s+(\d+)\s+\/\s+(\d+)/,
  );
  assert.ok(match, "the timeline should expose its exact sticker position");
  return { index: Number(match[1]) - 1, length: Number(match[2]) };
}

function gridButtons(fixture) {
  return fixture.elements.get("hyperbarGrid").children.flatMap((row) => (
    row.children.filter(({ tagName }) => tagName === "BUTTON")
  ));
}

function gridRows(fixture) {
  return fixture.elements.get("hyperbarGrid").children;
}

function inScopeGridButtons(fixture) {
  return gridButtons(fixture).filter(({ dataset }) => dataset.inPlayback === "true");
}

async function setControl(fixture, id, value, eventType = "change") {
  const control = fixture.elements.get(id);
  control.value = String(value);
  await control.emit(eventType);
}

test("view-facing projection changes cancel old lookahead without resetting the shape clock", async (t) => {
  const fixture = runtimeFixture();
  const clock = new FakeClock(20_000);
  const runtime = installRuntimeEnvironment(t, fixture, clock);

  await import("../hyper-rubix-app.js?projection-lookahead=" + Date.now());
  runtime.runFrame();
  await fixture.elements.get("audioButton").emit("click");
  await setControl(fixture, "tempo", 300, "input");
  await setControl(fixture, "twistRate", 16);
  await setControl(fixture, "swing", 0, "input");
  await fixture.elements.get("playButton").emit("click");
  clock.advanceBy(55);

  const audioContext = FakeAudioContext.instances[0];
  const oldScope = fixture.elements.get("stage").dataset.audibleCellIds;
  const oldPosition = currentStickerPosition(fixture);
  const oldSources = activeOneShotSources(audioContext);
  const oldTimerHandles = [...clock.timers.keys()];
  assert.ok(oldSources.length > 0, "the fast loop should have future Web Audio notes queued");
  assert.ok(oldTimerHandles.length > 1, "the fast loop should have future visual pulses queued");

  const stage = fixture.elements.get("stage");
  await stage.emit("pointerdown", { pointerId: 31, clientX: 100, clientY: 100 });
  await stage.emit("pointermove", { pointerId: 31, clientX: 1_000, clientY: 100 });
  await stage.emit("pointerup", { pointerId: 31, clientX: 1_000, clientY: 100 });
  runtime.runFrame(clock.now + 1);

  assert.notEqual(stage.dataset.audibleCellIds, oldScope, "the orbit must actually remap the score");
  assert.deepEqual(currentStickerPosition(fixture), oldPosition, "projection remaps preserve the visible phase");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(
    oldSources.every(({ disconnected, stops }) => (
      disconnected && stops.at(-1) === audioContext.currentTime
    )),
    true,
    "notes queued from cells that left the view-facing score must be canceled",
  );
  assert.equal(
    oldTimerHandles.every((handle) => !clock.timers.has(handle)),
    true,
    "visual pulses captured from the old view-facing score must be canceled",
  );
});

test("a completed manual twist cancels old-score lookahead without resetting the shape clock", async (t) => {
  const fixture = runtimeFixture();
  const clock = new FakeClock(30_000);
  const runtime = installRuntimeEnvironment(t, fixture, clock);

  await import("../hyper-rubix-app.js?twist-lookahead=" + Date.now());
  runtime.runFrame();
  await fixture.elements.get("audioButton").emit("click");
  await setControl(fixture, "tempo", 300, "input");
  await setControl(fixture, "twistRate", 16);
  await setControl(fixture, "swing", 0, "input");
  await fixture.elements.get("playButton").emit("click");
  clock.advanceBy(55);

  const audioContext = FakeAudioContext.instances[0];
  const oldPosition = currentStickerPosition(fixture);
  const oldSources = activeOneShotSources(audioContext);
  const oldTimerHandles = [...clock.timers.keys()];
  assert.ok(oldSources.length > 0, "the fast loop should have old-puzzle notes queued");
  assert.ok(oldTimerHandles.length > 1, "the fast loop should have old-puzzle visuals queued");

  await fixture.elements.get("turnClockwise").emit("click");
  runtime.runFrame(clock.now + 1);
  runtime.runFrame(clock.now + 501);

  assert.equal(fixture.elements.get("moveCount").textContent, "01");
  assert.deepEqual(currentStickerPosition(fixture), oldPosition, "a turn preserves the visible phase");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(
    oldSources.every(({ disconnected, stops }) => (
      disconnected && stops.at(-1) === audioContext.currentTime
    )),
    true,
    "future notes derived from the pre-turn sticker configuration must be canceled",
  );
  assert.equal(
    oldTimerHandles.every((handle) => !clock.timers.has(handle)),
    true,
    "future visual pulses derived from the pre-turn configuration must be canceled",
  );
});

test("manual twists never layer the Web Audio acid fallback over a live WebGPU 303 preset", async (t) => {
  const fixture = runtimeFixture({ webGpu: true });
  const clock = new FakeClock(40_000);
  const runtime = installRuntimeEnvironment(t, fixture, clock);
  const webGpu = installFakeWebGpu303Engine(t);

  await import("../hyper-rubix-app.js?webgpu-exclusive=" + Date.now());
  runtime.runFrame();
  await fixture.elements.get("audioButton").emit("click");
  await setControl(fixture, "voice", "webgpu-303");
  await flushMicrotasks();
  assert.equal(webGpu.instances.length, 1, "the supported WebGPU engine should start");

  await fixture.elements.get("playButton").emit("click");
  await flushMicrotasks();
  clock.advanceBy(55);
  const audioContext = FakeAudioContext.instances[0];
  const sourcesBeforeTurn = {
    buffers: audioContext.bufferSources.length,
    oscillators: audioContext.oscillators.length,
  };

  await fixture.elements.get("turnClockwise").emit("click");
  runtime.runFrame(clock.now + 1);

  assert.deepEqual({
    buffers: audioContext.bufferSources.length,
    oscillators: audioContext.oscillators.length,
  }, sourcesBeforeTurn, "manual turns may excite topology but must not instantiate fallback voices");
  assert.equal(fixture.elements.get("voice").value, "webgpu-303");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
});

test("a WebGPU scope restart keeps the single phase calculated for its scheduled start", async (t) => {
  const fixture = runtimeFixture({ webGpu: true });
  const clock = new FakeClock(50_000);
  const runtime = installRuntimeEnvironment(t, fixture, clock);
  const webGpu = installFakeWebGpu303Engine(t);

  await import("../hyper-rubix-app.js?webgpu-scope-phase=" + Date.now());
  runtime.runFrame();
  await fixture.elements.get("audioButton").emit("click");
  await setControl(fixture, "voice", "webgpu-303");
  await flushMicrotasks();
  await setControl(fixture, "tempo", 300, "input");
  await setControl(fixture, "twistRate", 16);
  await setControl(fixture, "swing", 0, "input");
  await fixture.elements.get("playButton").emit("click");
  await flushMicrotasks();
  clock.advanceBy(55);

  const engine = webGpu.instances[0];
  const restartCount = engine.__restartCalls.length;
  await setControl(fixture, "playbackPreset", "selected-cell");
  await flushMicrotasks();
  clock.advanceBy(0);
  await flushMicrotasks();

  assert.equal(engine.__restartCalls.length, restartCount + 1);
  const scopeRestart = engine.__restartCalls.at(-1);
  assert.ok(scopeRestart.sequencePhase > 1, "the scheduled start should project several fast steps ahead");
  assert.equal(
    engine.params.sequencePhase,
    scopeRestart.sequencePhase,
    "no immediate second alignment may overwrite the phase used by restartTimeline",
  );
  assert.equal(fixture.elements.get("playbackCount").textContent, "1 CELL · 27 NOTES");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
});

test("Hyper Rubix keeps projection gestures silent, auditions twists, and survives BFCache", async (t) => {
  const fixture = runtimeFixture();
  const runtime = installRuntimeEnvironment(t, fixture);

  await import("../hyper-rubix-app.js?manual-runtime=" + Date.now());
  const baseTime = performance.now();
  runtime.runFrame(baseTime);

  assert.equal(fixture.elements.get("autoRotate").getAttribute("aria-pressed"), "false");
  assert.equal(fixture.elements.get("motionSummary").textContent, "manual projection");
  assert.equal(fixture.elements.get("sequenceMethod").value, "sticker-stream");
  assert.equal(fixture.elements.get("twistMotion").value, "off");
  assert.equal(fixture.elements.get("playbackPreset").value, "view-facing");
  assert.equal(fixture.elements.get("playbackCount").textContent, "4 CELLS · 108 NOTES");
  assert.equal(fixture.elements.get("playLabel").textContent, "Play shape loop");
  assert.equal(fixture.elements.get("hyperbarPanel").hidden, false);
  assert.equal(gridButtons(fixture).length, HYPER_RUBIX_STICKER_STREAM_LENGTH);
  assert.equal(inScopeGridButtons(fixture).length, 108);
  assert.equal(
    gridRows(fixture).filter(({ className }) => !className.includes("is-outside-score")).length,
    4,
    "the default score exposes exactly four view-facing cell rows",
  );
  assert.equal(
    gridButtons(fixture).filter((cell) => cell.getAttribute("aria-selected") === "true").length,
    HYPER_RUBIX_STICKER_STREAM_LENGTH,
    "all 216 stickers remain editable even when only 108 are in the score",
  );

  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1);
  const audioContext = FakeAudioContext.instances[0];
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "true");
  assert.equal(audioContext.compressors[0].connections.includes(audioContext.destination), true);
  const persistentTopology = audioContext.oscillators.filter(({ stops }) => stops.length === 0);
  assert.equal(persistentTopology.length, 48, "only the bounded topology strings stay persistent");
  assert.equal(audioContext.oscillators.length, 48, "there is no separate fold or orbit oscillator");
  const topologyGains = persistentTopology.map((oscillator) => oscillator.connections[0].connections[0]);
  assert.equal(topologyGains.every(({ kind }) => kind === "gain"), true);

  const stage = fixture.elements.get("stage");
  const sourceCounts = () => ({
    oscillators: audioContext.oscillators.length,
    buffers: audioContext.bufferSources.length,
  });
  const gestureSourceCounts = sourceCounts();
  const initialViewFacingCells = stage.dataset.audibleCellIds;
  await stage.emit("pointerdown", {
    pointerId: 10, clientX: 100, clientY: 100, shiftKey: false, timeStamp: 100,
  });
  await stage.emit("pointermove", {
    pointerId: 10, clientX: 1_000, clientY: 100, shiftKey: false, timeStamp: 150,
  });
  await stage.emit("pointerup", {
    pointerId: 10, clientX: 1_000, clientY: 100, shiftKey: false, timeStamp: 160,
  });
  runtime.runFrame(baseTime + 1);
  assert.notEqual(
    stage.dataset.audibleCellIds,
    initialViewFacingCells,
    "a real orbit drag changes which four cells face the view",
  );
  assert.deepEqual(sourceCounts(), gestureSourceCounts, "orbit pointer motion creates no audio source");

  await stage.emit("keydown", { key: "ArrowRight", shiftKey: false });
  runtime.runFrame(baseTime + 2);
  assert.deepEqual(sourceCounts(), gestureSourceCounts, "orbit keyboard motion creates no audio source");

  await fixture.elements.get("resetView").emit("click");
  runtime.runFrame(baseTime + 3);
  const resetViewFacingCells = stage.dataset.audibleCellIds;
  await stage.emit("pointerdown", {
    pointerId: 11, clientX: 100, clientY: 100, shiftKey: true, timeStamp: 100,
  });
  await stage.emit("pointermove", {
    pointerId: 11, clientX: 100, clientY: -340, shiftKey: true, timeStamp: 150,
  });
  await stage.emit("pointerup", {
    pointerId: 11, clientX: 100, clientY: -340, timeStamp: 160,
  });
  runtime.runFrame(baseTime + 4);
  assert.notEqual(
    stage.dataset.audibleCellIds,
    resetViewFacingCells,
    "a real fourth-axis fold changes the view-facing cell set",
  );
  assert.deepEqual(sourceCounts(), gestureSourceCounts, "fold pointer motion creates no audio source");

  await stage.emit("keydown", { key: "ArrowRight", shiftKey: true });
  runtime.runFrame(baseTime + 5);
  assert.deepEqual(sourceCounts(), gestureSourceCounts, "fold keyboard motion creates no audio source");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");

  const oscillatorCountBeforeTurn = audioContext.oscillators.length;
  const topologyEventsBeforeTurn = persistentTopology
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
    persistentTopology
      .reduce((count, oscillator) => count + oscillator.frequency.events.length, 0)
      > topologyEventsBeforeTurn,
    "the same turn excites the bounded neighbor-topology strings",
  );
  assert.match(fixture.elements.get("liveStatus").textContent, /plus 90 degrees complete/i);

  assert.equal(fixture.elements.get("decayLink").value, "linked");
  assert.equal(fixture.elements.get("topologyRing").disabled, true);
  await setControl(fixture, "decay", 0.31, "input");
  assert.equal(fixture.elements.get("topologyRing").value, "0.31");
  assert.equal(fixture.elements.get("topologyRingOut").textContent, "0.31 s");
  await setControl(fixture, "decayLink", "independent");
  assert.equal(fixture.elements.get("topologyRing").disabled, false);
  const topologyEventsBeforeShorterRing = topologyGains.map(({ gain }) => gain.events.length);
  await setControl(fixture, "topologyRing", 0.12, "input");
  topologyGains.forEach(({ gain }, index) => {
    assert.ok(
      gain.events.length > topologyEventsBeforeShorterRing[index],
      "lowering an independent ring silences already-ringing topology lanes",
    );
    assert.deepEqual(gain.events.at(-1).slice(0, 2), ["set", 0]);
  });

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
  assert.equal(fixture.elements.get("playbackPreset").value, "view-facing");
  assert.equal(fixture.elements.get("decayLink").value, "linked");
  assert.equal(fixture.elements.get("topologyRing").disabled, true);
  assert.equal(fixture.elements.get("sequenceMethod").value, "sticker-stream");
  assert.equal(fixture.elements.get("autoRotate").getAttribute("aria-pressed"), "false");

  fixture.documentObject.hidden = true;
  fixture.documentObject.visibilityState = "hidden";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "suspended");
  assert.equal(
    topologyGains.every(({ gain }) => gain.events.at(-1)?.[0] === "set" && gain.events.at(-1)?.[1] === 0),
    true,
    "visibility suspension silences every persistent topology lane",
  );
  fixture.documentObject.hidden = false;
  fixture.documentObject.visibilityState = "visible";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "running");

  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: true });
  assert.equal(audioContext.state, "suspended");
  assert.equal(
    persistentTopology.every(({ stops }) => stops.length === 0),
    true,
    "BFCache preserves the reusable topology oscillators",
  );
  await emitRuntime(fixture.windowListeners, "pageshow", { persisted: true });
  assert.equal(audioContext.state, "running");

  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: false });
  assert.equal(audioContext.state, "closed");
  assert.equal(persistentTopology.every(({ stops }) => stops.length === 1), true);
  assert.equal(persistentTopology.every(({ disconnected }) => disconnected), true);
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
  assert.equal(fixture.elements.get("playbackPreset").value, "view-facing");
  assert.equal(
    fixture.elements.get("playState").textContent,
    "108 stickers · View-facing cells · one note each",
  );
  assert.equal(fixture.elements.get("hyperbarReadout").textContent, "STICKER 001 / 108");
  assert.equal(fixture.elements.get("playbackCount").textContent, "4 CELLS · 108 NOTES");
  assert.equal(gridButtons(fixture).length, 216);
  assert.equal(inScopeGridButtons(fixture).length, 108);
  assert.equal(
    gridRows(fixture).filter(({ className }) => !className.includes("is-outside-score")).length,
    4,
  );
  assert.equal(gridButtons(fixture).filter(({ disabled }) => disabled).length, 0);
  assert.equal(gridButtons(fixture).every((cell) => cell.getAttribute("role") === "gridcell"), true);

  assert.equal(fixture.elements.get("sequencePattern").disabled, true);
  assert.equal(fixture.elements.get("twistMotion").disabled, true);
  assert.equal(fixture.elements.get("twistDensity").disabled, true);
  await setControl(fixture, "sequenceMethod", "sticker-hyperbar");
  assert.equal(fixture.elements.get("sequencePattern").disabled, false);
  assert.equal(fixture.elements.get("twistMotion").disabled, false);
  assert.equal(fixture.elements.get("twistDensity").disabled, false);
  assert.equal(fixture.elements.get("twistMotion").value, "auto");
  assert.equal(fixture.elements.get("playbackPreset").disabled, true);
  assert.equal(fixture.elements.get("playbackScopeReadout").hidden, true);
  assert.equal(fixture.elements.get("playLabel").textContent, "Play sticker hyperbar");
  assert.match(fixture.elements.get("sequenceMethodHelp").textContent, /automated twists/i);
  await setControl(fixture, "sequenceMethod", "sticker-stream");
  assert.equal(fixture.elements.get("twistMotion").value, "off");
  assert.equal(fixture.elements.get("twistMotion").disabled, true);
  assert.equal(fixture.elements.get("playbackPreset").disabled, false);
  assert.equal(fixture.elements.get("playbackScopeReadout").hidden, false);

  await fixture.elements.get("audioButton").emit("click");
  const audioContext = FakeAudioContext.instances[0];
  const persistentTopology = audioContext.oscillators.slice(0, 48);
  assert.equal(persistentTopology.length, 48);
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
  assert.equal(currentStickerPosition().length, 108);
  assert.notEqual(currentStickerId(), "");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  const initialTransportSources = [
    ...audioContext.oscillators.slice(48),
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

  const unchangedInstrument = fixture.elements.get("voice").value;
  assert.equal(unchangedInstrument, "pulse");
  await setControl(fixture, "playbackPreset", "selected-cell");
  assert.equal(fixture.elements.get("playbackCount").textContent, "1 CELL · 27 NOTES");
  assert.equal(fixture.elements.get("stage").dataset.audibleCellIds, "w+");
  assert.equal(inScopeGridButtons(fixture).length, 27);
  assert.equal(fixture.elements.get("voice").value, unchangedInstrument);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");

  const xPositive = fixture.faceButtons.find(({ dataset }) => dataset.face === "x+");
  await xPositive.emit("click");
  assert.equal(fixture.elements.get("stage").dataset.audibleCellIds, "x+");
  assert.equal(fixture.elements.get("playbackCount").textContent, "1 CELL · 27 NOTES");
  assert.equal(inScopeGridButtons(fixture).length, 27, "selected-cell playback follows the face picker");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");

  await setControl(fixture, "playbackPreset", "whole-shape");
  assert.equal(fixture.elements.get("playbackCount").textContent, "8 CELLS · 216 NOTES");
  assert.equal(inScopeGridButtons(fixture).length, 216);
  assert.equal(
    gridRows(fixture).filter(({ className }) => !className.includes("is-outside-score")).length,
    8,
  );
  assert.equal(fixture.elements.get("voice").value, unchangedInstrument);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  clock.advanceBy(40);
  assert.equal(currentStickerPosition().length, 216);

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
  const topologyEventsBeforeRattlesnake = persistentTopology
    .reduce((count, oscillator) => count + oscillator.frequency.events.length, 0);
  await setControl(fixture, "voice", "rattlesnake");
  assert.equal(fixture.elements.get("voice").value, "rattlesnake");
  assert.equal(fixture.elements.get("playbackPreset").value, "whole-shape");
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
    persistentTopology
      .reduce((count, oscillator) => count + oscillator.frequency.events.length, 0)
      > topologyEventsBeforeRattlesnake,
    "Rattlesnake also excites the visible neighbor-resonator mapping",
  );

  await setControl(fixture, "voice", "glass");
  assert.equal(fixture.elements.get("playbackPreset").value, "whole-shape");
  assert.equal(fixture.elements.get("rattleButton").getAttribute("aria-pressed"), "false");
  assert.equal(fixture.elements.get("rattlesnakeControls").hidden, true);
  assert.match(fixture.elements.get("soundSummary").textContent, /Prism kit/);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");

  const sourcesBeforeFallback = audioContext.oscillators.length + audioContext.bufferSources.length;
  await setControl(fixture, "voice", "webgpu-303");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.elements.get("voice").value, "webgpu-303");
  assert.equal(fixture.elements.get("playbackPreset").value, "whole-shape");
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
  assert.equal(fixture.elements.get("playState").textContent, "64 stickers · Whole shape · one note each");
  assert.match(fixture.elements.get("puzzleSizeHelp").textContent, /64 stickers · 8 spatial pulses/);
  await setControl(fixture, "puzzleSize", 4);
  assert.equal(gridButtons(fixture).length, 512);
  assert.equal(fixture.elements.get("playState").textContent, "512 stickers · Whole shape · one note each");
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
