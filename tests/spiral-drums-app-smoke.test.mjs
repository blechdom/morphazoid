import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPrototile, tilingInfo } from "../src/lattice.js";

test("spiral drum app starts and keeps its complete geometry editor interactive", async () => {
  const html = await readFile(new URL("../spiral-drums.html", import.meta.url), "utf8");
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
        contains(name) { return classes.has(name); },
      },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      setPointerCapture() {},
      focus() {},
      click() {
        listeners.get(`${id}:click`)?.();
      },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);
  elements.get("timePath").querySelectorAll = () => [
    elements.get("radiusTime"),
    elements.get("angleTime"),
    elements.get("spiralTime"),
  ];
  elements.get("radiusTime").dataset.value = "radius";
  elements.get("radiusTime").textContent = "Radius";
  elements.get("angleTime").dataset.value = "angle";
  elements.get("angleTime").textContent = "Angle";
  elements.get("spiralTime").dataset.value = "spiral";
  elements.get("spiralTime").textContent = "Spiral";

  let drawnArcs = 0;
  const drawingContext = {
    arc() { drawnArcs += 1; },
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    setTransform() {},
    stroke() {},
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });
  const tileEditorCanvas = elements.get("tileEditorCanvas");
  tileEditorCanvas.getContext = () => drawingContext;
  tileEditorCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 320,
    height: 220,
  });
  elements.get("stageWrap").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });

  const rafQueue = [];
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
    frameId += 1;
    return frameId;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback();
    }
  };
  globalThis.document = {
    hidden: false,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    addEventListener() {},
  };
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  function audioParam(value = 0) {
    return {
      value,
      setTargetAtTime(next) { this.value = next; },
      setValueAtTime(next) { this.value = next; },
      exponentialRampToValueAtTime(next) { this.value = next; },
      linearRampToValueAtTime(next) { this.value = next; },
      cancelScheduledValues() {},
    };
  }
  function audioNode(properties = {}) {
    return {
      ...properties,
      connect(destination) { return destination; },
      disconnect() {},
    };
  }
  const oscillators = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 1_000;
      this.state = "running";
      this.destination = audioNode();
    }
    createAnalyser() {
      return audioNode({ fftSize: 0 });
    }
    createBiquadFilter() {
      return audioNode({
        type: "lowpass",
        frequency: audioParam(0),
        Q: audioParam(0),
      });
    }
    createBuffer(_channels, frameCount) {
      const samples = new Float32Array(frameCount);
      return { getChannelData() { return samples; } };
    }
    createBufferSource() {
      return audioNode({
        buffer: null,
        start() {},
        stop() {},
      });
    }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0),
        knee: audioParam(0),
        ratio: audioParam(0),
        attack: audioParam(0),
        release: audioParam(0),
      });
    }
    createGain() {
      return audioNode({ gain: audioParam(0) });
    }
    createOscillator() {
      const oscillator = audioNode({
        type: "sine",
        frequency: audioParam(220),
        start() {},
        stop() {},
      });
      oscillators.push(oscillator);
      return oscillator;
    }
    async resume() {
      this.state = "running";
    }
    async close() {
      this.state = "closed";
    }
  };

  function flushAnimationFrames(now = performance.now() + 20) {
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(now);
  }

  await import(`../spiral-drums-app.js?smoke=${Date.now()}`);
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  flushAnimationFrames();

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.equal(tileEditorCanvas.width, 640);
  assert.equal(tileEditorCanvas.height, 440);
  assert.match(elements.get("stageReadout").textContent, /^RADIUS · \d+ CONTACT/);
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);
  assert.equal(elements.get("windingSummary").textContent, "A1 · B5");
  assert.equal(elements.get("parameterCount").textContent, "2 parameters · guarded");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal(
    (elements.get("tilingType").innerHTML.match(/<option /g) ?? []).length,
    72,
  );
  assert.equal(
    (elements.get("drumMap").innerHTML.match(/class="spiral-drum-cell"/g) ?? []).length,
    16,
  );
  assert.equal(attributes.get("radiusTime:aria-pressed"), "true");
  assert.ok(drawnArcs > 0);

  listeners.get("playButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(performance.now() + 240);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.ok(oscillators.length > 0, "starting Spiral time should trigger FM drums");
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");

  listeners.get("spiralTime:click")();
  assert.equal(attributes.get("spiralTime:aria-pressed"), "true");
  assert.equal(elements.get("readerTurnsControl").hidden, false);
  assert.match(elements.get("coordinateReadout").textContent, /LOG R \+ THETA/);
  listeners.get("timeDirection:click")();
  assert.equal(elements.get("timeDirection").textContent, "Counterclockwise");

  elements.get("spiralA").value = "2";
  listeners.get("spiralA:input")();
  flushAnimationFrames();
  assert.equal(elements.get("windingSummary").textContent, "A2 · B5");
  elements.get("spiralA").value = "0";
  listeners.get("spiralA:input")();
  elements.get("spiralB").value = "0";
  listeners.get("spiralB:input")();
  assert.equal(elements.get("spiralA").value, "1", "A and B may not both be zero");

  elements.get("loopPhase").value = ".25";
  listeners.get("loopPhase:input")();
  flushAnimationFrames();
  assert.match(elements.get("loopPhaseOut").textContent, /1\.59 · IN/);

  const editorModel = buildPrototile({
    type: 20,
    parameters: tilingInfo(20).defaultParameters,
  });
  const editorScale = Math.min(
    (320 - 54) / (editorModel.bounds.maxX - editorModel.bounds.minX),
    (220 - 54) / (editorModel.bounds.maxY - editorModel.bounds.minY),
  );
  const editorCenter = {
    x: (editorModel.bounds.minX + editorModel.bounds.maxX) / 2,
    y: (editorModel.bounds.minY + editorModel.bounds.maxY) / 2,
  };
  const draggableVertex = editorModel.vertices[1];
  const handle = {
    x: 160 + (draggableVertex.x - editorCenter.x) * editorScale,
    y: 110 - (draggableVertex.y - editorCenter.y) * editorScale,
  };
  const parametersBeforeDrag = [
    elements.get("parameter0Out").textContent,
    elements.get("parameter1Out").textContent,
  ];
  listeners.get("tileEditorCanvas:pointerdown")({
    clientX: handle.x,
    clientY: handle.y,
    pointerId: 2,
    preventDefault() {},
  });
  listeners.get("tileEditorCanvas:pointermove")({
    clientX: handle.x + 18,
    clientY: handle.y - 12,
    pointerId: 2,
    preventDefault() {},
  });
  assert.notDeepEqual([
    elements.get("parameter0Out").textContent,
    elements.get("parameter1Out").textContent,
  ], parametersBeforeDrag);
  listeners.get("tileEditorCanvas:pointerup")({ pointerId: 2 });
  listeners.get("resetTileVertices:click")();
  assert.equal(elements.get("parameter0Out").textContent, "0.105");
  assert.equal(elements.get("parameter1Out").textContent, "0.650");

  elements.get("tilingType").value = "1";
  listeners.get("tilingType:change")();
  flushAnimationFrames();
  assert.match(elements.get("formSummary").textContent, /IH01/);
  assert.equal(elements.get("parameterCount").textContent, "4 parameters · guarded");
  elements.get("edgeCurve1").value = ".7";
  listeners.get("edgeCurve1:input")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "70% forward");
  listeners.get("straightenEdges:click")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "straight");

  elements.get("tilingType").value = "31";
  listeners.get("tilingType:change")();
  assert.equal(elements.get("edgeCount").textContent, "0 bendable classes");
  assert.equal(elements.get("edgeControl0").hidden, true);
  assert.equal(elements.get("resetTileVertices").disabled, true);
  assert.equal(elements.get("tileEditorLegend").textContent, "symmetry-locked corners");

  elements.get("mappingMode").value = "reader-incidence";
  listeners.get("mappingMode:change")();
  assert.equal(elements.get("mappingSummary").textContent, "reader path × incidence");

  const positionBeforeScrub = Number(elements.get("position").value);
  listeners.get("stage:pointerdown")({
    clientX: 690,
    clientY: 260,
    pointerId: 4,
  });
  listeners.get("stage:pointermove")({
    clientX: 610,
    clientY: 190,
    pointerId: 4,
  });
  listeners.get("stage:pointerup")({ pointerId: 4 });
  assert.notEqual(Number(elements.get("position").value), positionBeforeScrub);

  listeners.get("resetSpiralDrums:click")();
  flushAnimationFrames();
  assert.equal(elements.get("tilingType").value, "20");
  assert.equal(elements.get("spiralA").value, "1");
  assert.equal(elements.get("spiralB").value, "5");
  assert.equal(elements.get("position").value, "0");
  assert.equal(elements.get("loopPhase").value, "0");
  assert.equal(elements.get("mappingMode").value, "radius-angle");
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);

  for (const legacyId of [
    "soundMode",
    "amplitudeControl",
    "percussionArticulation",
    "pitchSource",
    "voiceCap",
  ]) {
    assert.equal(elements.has(legacyId), false);
  }
});
