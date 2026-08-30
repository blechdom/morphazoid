import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initializeGraphInstrument } from "../src/graph-instrument-app.js";

async function exerciseLiveEditRegression(mode, htmlFile) {
  const html = await readFile(new URL(`../${htmlFile}`, import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function element(id) {
    const classes = new Set();
    const node = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      dataset: {},
      style: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name, force) {
          if (force === undefined ? !classes.has(name) : force) classes.add(name);
          else classes.delete(name);
        },
      },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);

  const drawingContext = {
    arc() {},
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    fillText() {},
    lineTo() {},
    moveTo() {},
    rect() {},
    restore() {},
    rotate() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
    translate() {},
  };
  elements.get("stage").getContext = () => drawingContext;

  const rafQueue = [];
  let frameNow = 1_000;
  let nextFrameId = 1;
  const runtimeListeners = new Map();
  const runtime = {
    Math,
    devicePixelRatio: 1,
    document: null,
    localStorage: { getItem() { return null; } },
    matchMedia() { return { matches: false }; },
    performance: { now() { return frameNow; } },
    requestAnimationFrame(callback) {
      rafQueue.push(callback);
      const id = nextFrameId;
      nextFrameId += 1;
      return id;
    },
    setTimeout,
    addEventListener(type, listener) { runtimeListeners.set(type, listener); },
    removeEventListener(type) { runtimeListeners.delete(type); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback(); }
    },
  };
  const documentObject = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  runtime.document = documentObject;

  const audioTriggers = [];
  const audioEngine = {
    context: null,
    output: 0,
    async start() {
      this.context ??= { currentTime: 1, state: "running" };
      return this.context;
    },
    setOutput(value) { this.output = value; },
    async trigger(voice, options) {
      audioTriggers.push({ voice, options });
      return { voice, options };
    },
    silence() {},
    async close() { this.context = null; },
  };

  function flushAnimationFrames(timestamp = frameNow + 20) {
    frameNow = timestamp;
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(frameNow);
  }

  const controller = initializeGraphInstrument({
    mode,
    runtime,
    documentObject,
    audioEngine,
  });
  assert.ok(controller);
  assert.ok(rafQueue.length > 0, "initialization should request a render frame");
  flushAnimationFrames();

  await listeners.get("pulseButton:click")();
  flushAnimationFrames(frameNow + 20);
  assert.equal(controller.state.audio, true, "a cold Pulse click should arm audio");
  assert.equal(controller.pulseCount, 1, "Pulse should launch one graph run");
  assert.equal(controller.activeRunCount, 1);
  assert.ok(controller.soundedEventCount > 0, "Pulse should schedule audible graph attacks");
  assert.equal(audioTriggers.length, controller.soundedEventCount);

  const attacksAfterPulse = controller.soundedEventCount;
  await listeners.get("seedPulseButton:click")();
  flushAnimationFrames(frameNow + 20);
  assert.equal(controller.pulseCount, 2, "Seed pulse should launch another audible run");
  assert.ok(controller.soundedEventCount > attacksAfterPulse);

  const attacksAfterSeed = controller.soundedEventCount;
  let spacePrevented = false;
  listeners.get("stage:keydown")({
    key: " ",
    preventDefault() { spacePrevented = true; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(frameNow + 20);
  assert.equal(spacePrevented, true);
  assert.equal(controller.pulseCount, 3, "Space should launch another audible run");
  assert.ok(controller.soundedEventCount > attacksAfterSeed);

  const attacksBeforePlay = controller.soundedEventCount;
  await listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 20);
  assert.equal(controller.state.playing, true);
  assert.equal(controller.pulseCount, 4, "transport start should launch its first graph pulse");
  assert.equal(controller.activeRunCount, 4);
  assert.ok(controller.soundedEventCount > attacksBeforePlay, "Play should schedule audible attacks");

  const pulseCountBeforeTempo = controller.pulseCount;
  const activeRunsBeforeTempo = controller.activeRunCount;
  const scheduledPulseBeforeTempo = controller.scheduledPulseTime;
  const attackCountBeforeTempo = controller.soundedEventCount;
  elements.get("tempo").value = "35";
  listeners.get("tempo:input")({ currentTarget: elements.get("tempo") });
  flushAnimationFrames(frameNow + 10);
  assert.equal(controller.pulseCount, pulseCountBeforeTempo, "tempo input must not launch another pulse");
  assert.equal(controller.activeRunCount, activeRunsBeforeTempo, "tempo input must preserve the active run");
  assert.equal(controller.scheduledPulseTime, scheduledPulseBeforeTempo, "tempo input must preserve transport phase");
  assert.equal(controller.soundedEventCount, attackCountBeforeTempo, "tempo input must not add attacks");

  const node = controller.model.nodes[0];
  const nodeX = 63 + node.x * 774;
  const nodeY = 48 + node.y * 504;
  let pointerDownPrevented = false;
  listeners.get("stage:pointerdown")({
    clientX: nodeX,
    clientY: nodeY,
    pointerId: 7,
    preventDefault() { pointerDownPrevented = true; },
  });
  listeners.get("stage:pointermove")({
    clientX: nodeX + 24,
    clientY: nodeY + 12,
    pointerId: 7,
    preventDefault() {},
  });
  listeners.get("stage:pointerup")({ pointerId: 7 });
  flushAnimationFrames(frameNow + 10);

  assert.equal(pointerDownPrevented, true, "the test gesture should select a graph node");
  assert.equal(controller.pulseCount, pulseCountBeforeTempo, "node motion must not launch another pulse");
  assert.equal(controller.activeRunCount, activeRunsBeforeTempo, "node motion must preserve the active run");
  assert.equal(controller.soundedEventCount, attackCountBeforeTempo, "node motion must not add attacks");
  assert.match(elements.get("liveStatus").textContent, /edge times were recalculated/);

  elements.get("topology").value = "chain";
  listeners.get("topology:change")({ currentTarget: elements.get("topology") });
  elements.get("nodeCount").value = "512";
  listeners.get("nodeCount:input")({ currentTarget: elements.get("nodeCount") });
  elements.get("edgeSubdivisions").value = "16";
  listeners.get("edgeSubdivisions:input")({ currentTarget: elements.get("edgeSubdivisions") });
  elements.get("triggerScope").value = "leaves";
  listeners.get("triggerScope:change")({ currentTarget: elements.get("triggerScope") });

  const largeTemplate = controller.pulseTemplate;
  assert.equal(controller.model.nodes.length, 512);
  assert.equal(largeTemplate.reachedNodeCount, 512);
  assert.ok(largeTemplate.tailSeconds > 30, "the full long chain should outlive the old short horizon");
  assert.ok(
    largeTemplate.audioEvents.some(({ nodeId }) => nodeId === 511),
    "leaf audio must survive visual/subdivision decimation",
  );
  assert.ok(
    largeTemplate.events.some(({ nodeId }) => nodeId === 511),
    "every sounded leaf keeps a corresponding visual playhead",
  );

  if (mode === "synth") {
    elements.get("articulation").value = "edge";
    listeners.get("articulation:change")({ currentTarget: elements.get("articulation") });
    elements.get("triggerScope").value = "subdivisions";
    listeners.get("triggerScope:change")({ currentTarget: elements.get("triggerScope") });
    const continuousTemplate = controller.pulseTemplate;
    assert.equal(controller.state.triggerScope, "all");
    assert.equal(continuousTemplate.articulation, "edge");
    assert.equal(continuousTemplate.audioEvents.length, 511);
    assert.ok(continuousTemplate.audioEvents.every(({ gateSeconds }) => gateSeconds > 0));
  }

  controller.dispose({ persisted: false });
}

for (const [mode, label, htmlFile] of [
  ["drums", "Graph Drum Machine", "graph-drums.html"],
  ["synth", "Graph Synth", "graph-synth.html"],
]) {
  test(`cold sound triggers work and live edits preserve the current ${label} run`, () => (
    exerciseLiveEditRegression(mode, htmlFile)
  ));
}
