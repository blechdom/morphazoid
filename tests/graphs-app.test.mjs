import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initializeGraphs } from "../src/instruments/graphs/graphs-app.js";

const root = new URL("../", import.meta.url);

async function pageSources() {
  const [html, css, app] = await Promise.all([
    readFile(new URL("graphs.html", root), "utf8"),
    readFile(new URL("src/instruments/graphs/graphs.css", root), "utf8"),
    readFile(new URL("src/instruments/graphs/graphs-app.js", root), "utf8"),
  ]);
  return { html, css, app };
}

test("Graphs is one native instrument with three accessible playing-mode banks", async () => {
  const { html, app } = await pageSources();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "every Graphs DOM id must be unique");
  assert.equal((html.match(/<canvas\b/gi) ?? []).length, 1, "the modes share one canvas");
  assert.doesNotMatch(html, /<(?:iframe|embed|object)\b/i);
  assert.match(html, /<script type="module" src="src\/instruments\/graphs\/graphs-app\.js"><\/script>/);
  assert.doesNotMatch(
    app,
    /(?:from\s+["'].+\/(?:graph-instrument-app|graph-synth-app|graph-drums-app|graph-delay-app)\.js|import\s*["'].+\/(?:graph-synth-app|graph-drums-app|graph-delay-app)\.js)/,
    "the combined controller must not boot or embed a source page controller",
  );

  for (const [mode, label, bank] of [
    ["synth", "Synth", "synthBank"],
    ["drums", "Drums", "drumsBank"],
    ["mic", "Mic", "micBank"],
  ]) {
    assert.match(
      html,
      new RegExp(`<button[^>]+role="tab"[^>]+data-playing-mode="${mode}"[^>]+aria-controls="${bank}"[^>]*>${label}<\\/button>`),
    );
    assert.match(
      html,
      new RegExp(`<section[^>]+id="${bank}"[^>]+data-mode-bank="${mode}"[^>]+role="tabpanel"`),
    );
  }
});

test("Graphs keeps its controls compact and its graph stage sticky on small screens", async () => {
  const { css } = await pageSources();

  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(370px,\s*420px\)/);
  assert.match(css, /\.graphs-mode-switch button\s*\{[^}]*min-height:\s*32px/s);
  assert.match(css, /\.graphs-page \.select-shell select\s*\{[^}]*height:\s*30px/s);
  assert.match(css, /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.graphs-stage\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.graphs-stage canvas\s*\{[^}]*touch-action:\s*none/s);
});

test("Graphs exposes the shared graph gestures and each mode's essential controls", async () => {
  const { html, app } = await pageSources();
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  for (const id of [
    "stage", "audioButton", "output", "playButton", "pulseButton", "graphPatchSelect",
    "resetAll", "tempo", "pulseDivision", "seedNote", "topology", "nodeCount",
    "density", "seed", "newGraphButton", "randomGraphButton", "arrangeGraphButton",
    "randomizeNodePositionsButton", "openAllSwitchesButton", "baseDelay", "distanceRatio",
    "timeCurve", "nodePass", "feedback", "nodeMotionPlayButton", "nodeMotionMode",
    "nodeMotionSpeed", "nodeMotionAmount", "mappingMode", "triggerScope",
    "attackLaneCount", "soundMode", "tuningMode", "turnPitchScale", "pitchRange",
    "edoDivisions", "modulationIndex", "modulationRatio", "articulation", "attack",
    "decay", "sustain", "release", "percussionStyle", "drumMap", "pitchDepth",
    "turnPitchDepth", "characterDepth", "inputTrim", "pitchScale", "pitchAsymmetry",
    "pitchCurve", "pitchSlew", "damping", "wet", "dry", "spread",
    "panicButton", "micState",
  ]) {
    assert.equal(ids.has(id), true, `missing Graphs control #${id}`);
  }

  assert.match(html, /aria-keyshortcuts="Space Enter ArrowUp ArrowDown ArrowLeft ArrowRight BracketLeft BracketRight Escape"/);
  assert.match(html, /Drag any node or the source marker/i);
  assert.match(html, /Click a small edge switch/i);
  assert.match(html, />Node path</);
  assert.match(html, />Node speed</);
  assert.match(html, />Node travel</);
  assert.doesNotMatch(html, /Source path|Source speed|Path size/);
  assert.match(html, /id="randomizeNodePositionsButton"[^>]*>Randomize positions<\/button>/);
  assert.match(html, /<b>Route density<\/b>/);
  assert.match(html, /id="openAllSwitchesButton"[^>]+does not add new connections/);
  assert.match(html, /<b>Minimum edge time<\/b>/);
  assert.match(html, /<b>Distance-time ratio<\/b>/);
  assert.match(
    html,
    /id="pulseButton"[\s\S]*id="baseDelay"[\s\S]*id="distanceRatio"[\s\S]*id="playButton"[\s\S]*id="tempo"/,
    "edge timing belongs between Send pulse and the Play/Tempo row",
  );
  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /canvas\.addEventListener\("pointermove"/);
  assert.match(app, /canvas\.addEventListener\("pointerup"/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /edgeSwitchStates\.set/);
  assert.match(app, /event\.key === " "/);
  assert.match(app, /\["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"\]/);
});

test("Graphs preserves Graph Synth's full envelope and FM ranges", async () => {
  const { html } = await pageSources();
  const input = (id) => html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] ?? "";

  assert.match(input("modulationIndex"), /step="0\.05"/);
  assert.match(input("noteDuration"), /min="20"[^>]+max="4000"[^>]+step="10"/);
  assert.match(input("attack"), /min="1"[^>]+max="2000"[^>]+step="1"/);
  assert.match(input("decay"), /min="5"[^>]+max="2400"[^>]+step="1"/);
  assert.match(input("release"), /min="2"[^>]+max="5000"[^>]+step="1"/);
});

function createGraphsFixture({ failingMode = null } = {}) {
  const htmlIds = [];
  const listeners = new Map();
  const attributes = new Map();
  const elements = new Map();

  function createElement(id) {
    const classes = new Set();
    const localListeners = new Map();
    const styleValues = new Map();
    const node = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      tabIndex: 0,
      dataset: {},
      style: {
        setProperty(name, value) { styleValues.set(name, String(value)); },
        getPropertyValue(name) { return styleValues.get(name) ?? ""; },
      },
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
      },
      addEventListener(type, listener) {
        const callbacks = localListeners.get(type) ?? [];
        callbacks.push(listener);
        localListeners.set(type, callbacks);
        listeners.set(`${id}:${type}`, callbacks);
      },
      removeEventListener(type, listener) {
        const callbacks = (localListeners.get(type) ?? []).filter((item) => item !== listener);
        localListeners.set(type, callbacks);
        listeners.set(`${id}:${type}`, callbacks);
      },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      getAttribute(name) { return attributes.get(`${id}:${name}`) ?? null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 860, height: 540 }; },
      setPointerCapture() {},
      releasePointerCapture() {},
      focus() { node.focused = true; },
    };
    elements.set(id, node);
    return node;
  }

  const fixtureReady = readFile(new URL("graphs.html", root), "utf8").then((html) => {
    htmlIds.push(...[...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    for (const id of htmlIds) createElement(id);

    const modeButtons = ["synth", "drums", "mic"].map((mode) => {
      const button = elements.get(`mode${mode[0].toUpperCase()}${mode.slice(1)}`);
      button.dataset.playingMode = mode;
      return button;
    });
    const modeBanks = ["synth", "drums", "mic"].map((mode) => {
      const bank = elements.get(`${mode}Bank`);
      bank.dataset.modeBank = mode;
      return bank;
    });
    elements.get("playingMode").querySelectorAll = (selector) => (
      selector === "[data-playing-mode]" ? modeButtons : []
    );
    elements.get("playingMode").querySelector = (selector) => {
      const match = selector.match(/data-playing-mode="([^"]+)"/);
      return modeButtons.find(({ dataset }) => dataset.playingMode === match?.[1]) ?? null;
    };
    elements.get("graphPatchGrid").querySelectorAll = () => [];
    elements.get("drumMap").querySelectorAll = () => [];
    elements.get("stage").getContext = () => ({});
    return modeBanks;
  });

  const runtimeListeners = new Map();
  const documentListeners = new Map();
  const mediaListeners = new Map();
  const reducedMotionQuery = {
    matches: false,
    addEventListener(type, listener) { mediaListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (mediaListeners.get(type) === listener) mediaListeners.delete(type);
    },
  };
  let animationFrameId = 0;
  const runtime = {
    Math,
    crypto: {
      getRandomValues(values) {
        values[0] = 0x8badf00d;
        return values;
      },
    },
    devicePixelRatio: 1,
    localStorage: { getItem() { return null; } },
    matchMedia() { return reducedMotionQuery; },
    performance: { now() { return 1_000; } },
    requestAnimationFrame() {
      animationFrameId += 1;
      return animationFrameId;
    },
    setTimeout,
    addEventListener(type, listener) { runtimeListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (runtimeListeners.get(type) === listener) runtimeListeners.delete(type);
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback(); }
    },
  };
  const bodyAttributes = new Map();
  const documentObject = {
    hidden: false,
    body: {
      setAttribute(name, value) { bodyAttributes.set(name, String(value)); },
      getAttribute(name) { return bodyAttributes.get(name) ?? null; },
    },
    getElementById(id) { return elements.get(id) ?? null; },
    querySelectorAll(selector) {
      if (selector !== "[data-mode-bank]") return [];
      return ["synth", "drums", "mic"].map((mode) => elements.get(`${mode}Bank`));
    },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
  };
  runtime.document = documentObject;

  function createEngine(mode) {
    return {
      mode,
      context: null,
      inputLevel: 0.25,
      output: 0,
      startCount: 0,
      closeCount: 0,
      silenceCount: 0,
      updateCalls: [],
      startArguments: [],
      failStart: mode === failingMode,
      async start(configuration) {
        this.startCount += 1;
        this.startArguments.push(configuration);
        if (this.failStart) throw new Error(`${mode} engine unavailable`);
        this.context = {
          currentTime: 1,
          state: "running",
          async resume() { this.state = "running"; },
        };
        return this.context;
      },
      setOutput(value) { this.output = value; },
      silence() { this.silenceCount += 1; },
      update(...arguments_) { this.updateCalls.push(arguments_); },
      trigger() { return Promise.resolve({ scheduled: true }); },
      async close() {
        this.closeCount += 1;
        this.context = null;
      },
    };
  }
  const engines = Object.fromEntries(
    ["synth", "drums", "mic"].map((mode) => [mode, createEngine(mode)]),
  );

  async function dispatch(id, type, event = {}) {
    const callbacks = listeners.get(`${id}:${type}`) ?? [];
    const currentTarget = elements.get(id);
    let result;
    for (const callback of callbacks) {
      result = callback({
        currentTarget,
        target: currentTarget,
        preventDefault() {},
        ...event,
      });
      await result;
    }
    await Promise.resolve();
    return result;
  }

  return {
    fixtureReady,
    runtime,
    documentObject,
    elements,
    attributes,
    listeners,
    runtimeListeners,
    documentListeners,
    mediaListeners,
    engines,
    dispatch,
  };
}

test("initializeGraphs switches banks while preserving one graph and per-mode state", async () => {
  const fixture = createGraphsFixture();
  await fixture.fixtureReady;
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });
  assert.ok(controller);
  assert.equal(controller.mode, "synth");

  fixture.elements.get("seed").value = "29";
  await fixture.dispatch("seed", "input");
  fixture.elements.get("soundMode").value = "square";
  await fixture.dispatch("soundMode", "change");
  fixture.elements.get("modulationIndex").value = "5.2";
  await fixture.dispatch("modulationIndex", "input");
  const sharedGraph = controller.model;

  await fixture.dispatch("modeDrums", "click");
  assert.equal(controller.mode, "drums");
  assert.strictEqual(controller.model, sharedGraph, "mode switching must not regenerate the graph");
  assert.equal(controller.state.seed, 29, "shared graph parameters survive mode switching");
  assert.equal(fixture.elements.get("drumsBank").hidden, false);
  assert.equal(fixture.elements.get("synthBank").hidden, true);
  assert.equal(fixture.attributes.get("modeDrums:aria-selected"), "true");

  fixture.elements.get("percussionStyle").value = "karplus-tines";
  await fixture.dispatch("percussionStyle", "change");
  await controller.setMode("synth");
  assert.equal(controller.state.soundMode, "square");
  assert.equal(controller.state.modulationIndex, 5.2);
  assert.equal(controller.state.seed, 29);
  assert.strictEqual(controller.model, sharedGraph);

  await controller.setMode("drums");
  assert.equal(controller.state.percussionStyle, "karplus-tines");
  await controller.setMode("mic");
  assert.equal(fixture.elements.get("micBank").hidden, false);
  assert.equal(fixture.elements.get("drumsBank").hidden, true);
  assert.equal(fixture.documentObject.body.getAttribute("data-graphs-mode"), "mic");
  assert.strictEqual(controller.model, sharedGraph);

  controller.dispose({ persisted: false });
  await Promise.resolve();
  assert.equal(fixture.runtimeListeners.has("morphazoid:midi-input"), false);
  assert.equal(fixture.documentListeners.has("visibilitychange"), false);
  assert.equal(fixture.mediaListeners.has("change"), false);
  assert.ok(Object.values(fixture.engines).every(({ closeCount }) => closeCount >= 1));
});

test("node count and route density edits preserve every retained node position", async () => {
  const fixture = createGraphsFixture();
  await fixture.fixtureReady;
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });

  await fixture.dispatch("randomizeNodePositionsButton", "click");
  const editedPositions = controller.model.nodes.map(({ x, y }) => ({ x, y }));

  fixture.elements.get("density").value = "0.72";
  await fixture.dispatch("density", "input");
  assert.deepEqual(
    controller.model.nodes.map(({ x, y }) => ({ x, y })),
    editedPositions,
    "changing route density must not rearrange the played geometry",
  );

  fixture.elements.get("nodeCount").value = "13";
  await fixture.dispatch("nodeCount", "input");
  assert.deepEqual(
    controller.model.nodes.slice(0, editedPositions.length).map(({ x, y }) => ({ x, y })),
    editedPositions,
    "adding nodes must retain every existing node coordinate",
  );
  assert.ok(
    controller.model.nodes.slice(editedPositions.length).every((node) => (
      Number.isFinite(node.x)
      && Number.isFinite(node.y)
      && node.x >= 0
      && node.x <= 1
      && node.y >= 0
      && node.y <= 1
      && controller.model.nodes
        .filter((other) => other.id < node.id)
        .every((other) => Math.hypot(node.x - other.x, node.y - other.y) >= 0.04)
    )),
    "new nodes receive clear, non-overlapping initial positions",
  );

  fixture.elements.get("nodeCount").value = "7";
  await fixture.dispatch("nodeCount", "input");
  assert.deepEqual(
    controller.model.nodes.map(({ x, y }) => ({ x, y })),
    editedPositions.slice(0, 7),
    "removing nodes must retain every surviving node coordinate",
  );

  controller.dispose({ persisted: false });
});

test("the primary round control starts and stops microphone input in Mic mode", async () => {
  const fixture = createGraphsFixture();
  await fixture.fixtureReady;
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });

  await controller.setMode("mic");
  assert.equal(fixture.attributes.get("playButton:aria-label"), "Start microphone input");
  assert.equal(fixture.elements.get("pulseButton").textContent, "Trace graph");

  await fixture.dispatch("playButton", "click");
  assert.equal(controller.state.audio, true);
  assert.equal(fixture.engines.mic.startCount, 1);
  assert.equal(fixture.attributes.get("playButton:aria-pressed"), "true");
  assert.equal(fixture.attributes.get("playButton:aria-label"), "Stop microphone input");
  assert.equal(fixture.elements.get("micState").textContent, "mic live");

  await fixture.dispatch("playButton", "click");
  assert.equal(controller.state.audio, false);
  assert.equal(fixture.engines.mic.context, null);
  assert.equal(fixture.attributes.get("playButton:aria-pressed"), "false");
  assert.equal(fixture.attributes.get("playButton:aria-label"), "Start microphone input");
  assert.equal(fixture.elements.get("micState").textContent, "mic off");

  controller.dispose({ persisted: false });
});

test("the primary round control arms audio before starting Synth or Drums playback", async () => {
  const fixture = createGraphsFixture();
  await fixture.fixtureReady;
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });

  await fixture.dispatch("playButton", "click");
  assert.equal(controller.state.audio, true);
  assert.equal(controller.state.playing, true);
  assert.equal(fixture.engines.synth.startCount, 1);
  assert.equal(fixture.attributes.get("playButton:aria-pressed"), "true");

  await fixture.dispatch("playButton", "click");
  assert.equal(controller.state.playing, false);
  assert.equal(controller.state.audio, true, "pause leaves the already-armed engine available");
  assert.equal(fixture.engines.synth.startCount, 1);

  await controller.setMode("drums");
  await fixture.dispatch("audioButton", "click");
  assert.equal(controller.state.audio, false);
  await fixture.dispatch("playButton", "click");
  assert.equal(controller.state.audio, true);
  assert.equal(controller.state.playing, true);
  assert.equal(fixture.engines.drums.startCount, 2, "mode handoff and Play each arm the Drums engine");

  controller.dispose({ persisted: false });
});

test("a blocked microphone reports a useful retry action", async () => {
  const fixture = createGraphsFixture();
  await fixture.fixtureReady;
  fixture.engines.mic.start = async function start() {
    this.startCount += 1;
    const error = new Error("Permission denied");
    error.name = "NotAllowedError";
    throw error;
  };
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });

  await controller.setMode("mic");
  await fixture.dispatch("playButton", "click");

  assert.equal(controller.state.audio, false);
  assert.equal(fixture.attributes.get("playButton:aria-pressed"), "false");
  assert.equal(fixture.elements.get("micState").textContent, "mic off");
  assert.match(fixture.elements.get("audioError").textContent, /allow microphone access.*press the round microphone button again/i);

  controller.dispose({ persisted: false });
});

test("initializeGraphs rolls back a failed live engine handoff without losing the graph", async () => {
  const fixture = createGraphsFixture({ failingMode: "drums" });
  await fixture.fixtureReady;
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });
  assert.ok(controller);

  fixture.elements.get("soundMode").value = "sawtooth";
  await fixture.dispatch("soundMode", "change");
  const sharedGraph = controller.model;
  await fixture.dispatch("audioButton", "click");
  assert.equal(controller.state.audio, true);
  assert.equal(fixture.engines.synth.startCount, 1);

  const switched = await controller.setMode("drums");
  assert.equal(switched, false);
  assert.equal(controller.mode, "synth");
  assert.equal(controller.state.audio, true, "the restored engine should be re-armed");
  assert.equal(controller.state.soundMode, "sawtooth");
  assert.strictEqual(controller.model, sharedGraph);
  assert.equal(fixture.engines.drums.startCount, 1);
  assert.equal(fixture.engines.drums.closeCount, 1);
  assert.equal(fixture.engines.synth.startCount, 2);
  assert.match(fixture.elements.get("audioError").textContent, /drums engine unavailable/);
  assert.match(fixture.elements.get("liveStatus").textContent, /could not start.*restored/i);

  fixture.engines.drums.failStart = false;
  assert.equal(await controller.setMode("mic"), true);
  assert.equal(controller.mode, "mic");
  assert.equal(controller.state.audio, true);
  assert.strictEqual(fixture.engines.mic.startArguments[0].graph, sharedGraph);
  assert.equal(fixture.engines.mic.startArguments[0].switches.length, sharedGraph.edges.length);

  controller.dispose({ persisted: false });
  await Promise.resolve();
  assert.equal(controller.state.audio, false);
  assert.equal(fixture.engines.mic.context, null);
});

test("initializeGraphs cancels a stale pending engine when another mode wins", async () => {
  const fixture = createGraphsFixture();
  await fixture.fixtureReady;
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });
  await fixture.dispatch("audioButton", "click");
  assert.equal(controller.state.audio, true);

  let resolveMicStart;
  const pendingContext = {
    currentTime: 2,
    state: "running",
    async resume() { this.state = "running"; },
  };
  fixture.engines.mic.start = function start(configuration) {
    this.startCount += 1;
    this.startArguments.push(configuration);
    this.context = pendingContext;
    this.startPromise = new Promise((resolve) => { resolveMicStart = resolve; });
    return this.startPromise.finally(() => { this.startPromise = null; });
  };

  const micTransition = controller.setMode("mic");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.mode, "mic");
  assert.ok(fixture.engines.mic.startPromise, "the Mic permission-like start is pending");

  const drumTransition = controller.setMode("drums");
  assert.equal(await drumTransition, true);
  assert.equal(controller.mode, "drums");
  assert.equal(controller.state.audio, true, "the latest mode inherits the user's armed Audio intent");
  assert.equal(fixture.engines.drums.startCount, 1);
  assert.ok(fixture.engines.mic.closeCount >= 1, "leaving Mic closes its pending engine");

  resolveMicStart(pendingContext);
  assert.equal(await micTransition, false);
  await Promise.resolve();
  assert.equal(controller.mode, "drums");
  assert.equal(controller.state.audio, true, "the stale Mic completion cannot disarm the winning mode");
  assert.equal(fixture.engines.mic.context, null);

  controller.dispose({ persisted: false });
});

test("initializeGraphs MIDI panic cancels a pending Mic handoff and synchronizes Audio UI", async () => {
  const fixture = createGraphsFixture();
  await fixture.fixtureReady;
  const controller = initializeGraphs({
    runtime: fixture.runtime,
    documentObject: fixture.documentObject,
    audioEngines: fixture.engines,
  });
  await fixture.dispatch("audioButton", "click");

  let resolveMicStart;
  const pendingContext = {
    currentTime: 3,
    state: "running",
    async resume() { this.state = "running"; },
  };
  fixture.engines.mic.start = function start(configuration) {
    this.startCount += 1;
    this.startArguments.push(configuration);
    this.context = pendingContext;
    this.startPromise = new Promise((resolve) => { resolveMicStart = resolve; });
    return this.startPromise.finally(() => { this.startPromise = null; });
  };

  const transition = controller.setMode("mic");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.elements.get("audioState").textContent, "requesting mic");
  assert.equal(fixture.attributes.get("audioButton:aria-busy"), "true");

  let prevented = false;
  fixture.runtimeListeners.get("morphazoid:midi-input")({
    detail: { message: { type: "controlChange", controller: 123 } },
    preventDefault() { prevented = true; },
  });
  await Promise.resolve();
  resolveMicStart(pendingContext);
  assert.equal(await transition, false);
  await Promise.resolve();

  assert.equal(prevented, true);
  assert.equal(controller.mode, "mic");
  assert.equal(controller.state.audio, false);
  assert.equal(fixture.elements.get("audioState").textContent, "off");
  assert.equal(fixture.attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(fixture.attributes.get("audioButton:aria-busy"), "false");
  assert.equal(fixture.engines.mic.context, null);
  controller.dispose({ persisted: false });
});
