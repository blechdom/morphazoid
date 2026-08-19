import assert from "node:assert/strict";
import test from "node:test";

import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";
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
    this.isFragment = false;
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

  focus() {}
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
    this.panners = [];
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
    return audioNode("filter", {
      type: "lowpass",
      frequency: audioParam(),
      Q: audioParam(),
    });
  }

  createBuffer(channels, length) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (channel) => data[channel] };
  }

  createBufferSource() {
    const node = audioNode("buffer-source", {
      buffer: null,
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
  }

  setTimeout(callback, delay = 0) {
    const handle = {
      id: ++this.nextId,
      unref() { return this; },
    };
    this.timers.set(handle, {
      callback,
      dueAt: this.now + Math.max(0, Number(delay) || 0),
      order: handle.id,
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
    "planePicker", "planeHelp", "twistSummary", "turnPlaneDiagram", "turnCellDiagram",
    "turnCounterclockwise", "turnClockwise", "scramblePuzzle", "undoMove", "unwindPuzzle",
    "autoRotate", "autoRotateState", "motionSummary", "rotationSpeed", "rotationSpeedOut",
    "projectionDepth", "projectionDepthOut", "cellSeparation", "cellSeparationOut",
    "stickerScale", "stickerScaleOut", "resetView", "randomView", "voice", "soundSummary",
    "tone", "toneOut", "decay", "decayOut", "resetAll", "rotationReadout",
    "clockSummary", "playButton", "playLabel", "playState", "restartLoop", "stepStrip",
    "sequenceNow", "sequenceVoice", "sequencePattern", "playbackMode", "twistRate",
    "tempo", "tempoOut", "reseedPattern", "swing", "swingOut", "twistDensity",
    "twistDensityOut",
  ];
  const elements = new Map(elementIds.map((id) => [id, new FakeNode("div", id)]));
  for (const id of [
    "audioButton", "turnCounterclockwise", "turnClockwise", "scramblePuzzle", "undoMove",
    "unwindPuzzle", "autoRotate", "resetView", "randomView", "resetAll", "playButton",
    "restartLoop", "reseedPattern",
  ]) elements.get(id).tagName = "BUTTON";
  for (const id of [
    "output", "tempo", "swing", "twistDensity", "rotationSpeed", "projectionDepth",
    "cellSeparation", "stickerScale", "tone", "decay",
  ]) elements.get(id).tagName = "INPUT";
  for (const id of ["voice", "sequencePattern", "playbackMode", "twistRate"]) {
    elements.get(id).tagName = "SELECT";
  }
  elements.get("voice").value = "pulse";
  elements.get("sequencePattern").value = "axis-break";
  elements.get("playbackMode").value = "forward";
  elements.get("twistRate").value = "2";
  elements.get("stage").tagName = "CANVAS";
  elements.get("stage").getContext = () => drawingContext();
  elements.get("audioButton").setAttribute("aria-pressed", "false");
  elements.get("playButton").setAttribute("aria-pressed", "false");
  elements.get("autoRotate").setAttribute("aria-pressed", "true");
  elements.get("audioError").hidden = true;
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
    hidden: false,
    visibilityState: "visible",
    getElementById(id) { return elements.get(id) ?? null; },
    querySelectorAll(selector) {
      if (selector === "[data-face]") return faceButtons;
      if (selector === "[data-drag-mode]") return dragButtons;
      return [];
    },
    createElement(tagName) { return new FakeNode(tagName); },
    createDocumentFragment() {
      const fragment = new FakeNode("fragment");
      fragment.isFragment = true;
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

  await fixture.elements.get("audioButton").emit("click");
  assert.equal(FakeAudioContext.instances.length, 1);
  const audioContext = FakeAudioContext.instances[0];
  assert.equal(fixture.elements.get("audioButton").getAttribute("aria-pressed"), "true");
  assert.equal(fixture.elements.get("audioState").textContent, "on");
  assert.equal(audioContext.compressors[0].connections.includes(audioContext.destination), true);

  await fixture.elements.get("turnClockwise").emit("click");
  assert.equal(fixture.elements.get("scramblePuzzle").disabled, true);
  runFrame(baseTime + 10);
  assert.equal(fixture.elements.get("puzzleState").textContent, "Turning W+");
  assert.equal(audioContext.oscillators.length, 1, "the default Hyper kit maps the XY turn to one kick oscillator");
  assert.equal(audioContext.oscillators.every(({ starts, stops }) => (
    starts.length === 1 && stops.length === 1
  )), true);
  assert.equal(
    audioContext.oscillators[0].frequency.events.some(([kind]) => kind === "exponential"),
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

  await fixture.elements.get("undoMove").emit("click");
  runFrame(baseTime + 710);
  runFrame(baseTime + 712);
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(fixture.elements.get("undoMove").disabled, true);
  runFrame(baseTime + 1_400);

  await fixture.elements.get("scramblePuzzle").emit("click");
  assert.equal(fixture.elements.get("scramblePuzzle").disabled, true);
  assert.match(fixture.elements.get("liveStatus").textContent, /twelve four-dimensional quarter turns queued/i);
  await fixture.elements.get("resetAll").emit("click");
  assert.equal(fixture.elements.get("puzzleState").textContent, "Solved");
  assert.equal(fixture.elements.get("moveCount").textContent, "00");
  assert.equal(fixture.elements.get("scramblePuzzle").disabled, false);

  fixture.documentObject.hidden = true;
  fixture.documentObject.visibilityState = "hidden";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "suspended");
  fixture.documentObject.hidden = false;
  fixture.documentObject.visibilityState = "visible";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "running");

  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: true });
  assert.equal(audioContext.state, "suspended", "BFCache exit suspends without disposing audio");
  await emitRuntime(fixture.windowListeners, "pageshow", { persisted: true });
  assert.equal(audioContext.state, "running", "BFCache restore resumes an enabled engine");
  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: false });
  assert.equal(audioContext.state, "closed", "final exit closes the AudioContext");
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
  assert.equal(fixture.elements.get("sequencePattern").value, "axis-break");
  assert.equal(fixture.elements.get("playbackMode").value, "forward");
  assert.equal(fixture.elements.get("reseedPattern").disabled, true);

  const silentStart = await fixture.elements.get("stage").emit("keydown", { key: " " });
  assert.equal(silentStart.defaultPrevented, true);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  assert.equal(fixture.elements.get("playLabel").textContent, "Pause auto-twists");
  assert.match(fixture.elements.get("liveStatus").textContent, /audio is off/i);
  assert.equal(FakeAudioContext.instances.length, 0, "silent visual playback must not create audio");
  assert.equal(clock.pendingCount, 2, "the scheduler owns one clock and one visual callback");

  clock.advanceBy(55);
  assert.equal(typeof queuedFrame, "function", "the first silent step should queue a visual turn");
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
  assert.match(fixture.elements.get("clockSummary").textContent, /1\/16$/);
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
  audioContext.currentTime = 7.25;
  const oscillatorsBeforePlay = audioContext.oscillators.length;
  await fixture.elements.get("playButton").emit("click");
  assert.equal(audioContext.oscillators.length, oscillatorsBeforePlay + 1, "XY schedules one kick voice");
  const scheduledStart = audioContext.oscillators.at(-1).starts[0];
  assert.ok(Math.abs(scheduledStart - 7.305) < 1e-9, "audio uses the absolute look-ahead clock");
  assert.equal(audioContext.oscillators.at(-1).stops.length, 1);
  await fixture.elements.get("resetAll").emit("click");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
  assert.equal(clock.pendingCount, 0, "reset stops and clears the transport");
  clock.advanceBy(500);
  assert.equal(fixture.elements.get("moveCount").textContent, "00", "reset cancels the visual move");

  await fixture.elements.get("playButton").emit("click");
  fixture.documentObject.hidden = true;
  fixture.documentObject.visibilityState = "hidden";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "suspended");
  assert.equal(clock.pendingCount, 0, "a hidden page clears its scheduler callbacks");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  fixture.documentObject.hidden = false;
  fixture.documentObject.visibilityState = "visible";
  await emitRuntime(fixture.documentListeners, "visibilitychange");
  assert.equal(audioContext.state, "running");
  assert.equal(clock.pendingCount, 2, "visible playback resumes from a fresh absolute clock");

  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: true });
  assert.equal(audioContext.state, "suspended", "BFCache exit preserves logical playback");
  assert.equal(clock.pendingCount, 0);
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "true");
  await emitRuntime(fixture.windowListeners, "pageshow", { persisted: true });
  assert.equal(audioContext.state, "running");
  assert.equal(clock.pendingCount, 2);
  await emitRuntime(fixture.windowListeners, "pagehide", { persisted: false });
  assert.equal(audioContext.state, "closed");
  assert.equal(fixture.elements.get("playButton").getAttribute("aria-pressed"), "false");
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
