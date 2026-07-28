import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Hyper Drum Machine starts, renders sixteen voices, and strikes on motion", async () => {
  const html = await readFile(new URL("../hyper-drums.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function element(id) {
    const classes = new Set();
    const nestedSpan = { textContent: "" };
    const node = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      dataset: {},
      style: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
      },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector(selector) {
        return selector === "span" ? nestedSpan : null;
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

  const gradient = { addColorStop() {} };
  let drawnArcs = 0;
  const drawingContext = {
    arc() { drawnArcs += 1; },
    beginPath() {},
    clearRect() {},
    createLinearGradient() { return gradient; },
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;
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

  await import(`../hyper-drums-app.js?smoke=${Date.now()}`);
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  flushAnimationFrames();

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(
    elements.get("stageReadout").textContent,
    /^TESSERACT · AXIS × DEPTH · 2 SEG\/SIDE · \d+ CONTACT/,
  );
  assert.equal(
    (elements.get("drumMap").innerHTML.match(/class="hyper-drum-cell"/g) ?? []).length,
    16,
  );
  assert.equal(
    (elements.get("mappingMode").innerHTML.match(/<option /g) ?? []).length,
    3,
  );
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(attributes.get("rotationXWPlay:aria-pressed"), "false");
  assert.equal(elements.get("subdivisions").value, "2");
  assert.equal(elements.get("subdivisionsOut").textContent, "2");
  assert.match(elements.get("subdivisionsHelp").textContent, /2 equal trigger regions/);
  assert.match(elements.get("mappingSummary").textContent, /edge axis × depth · 2\/side/);
  assert.equal(elements.get("mappingLegendLabel0").textContent, "4D edge axis");
  assert.equal(elements.get("mappingLegendLabel1").textContent, "Projected depth");

  const arcsInDefaultFrame = drawnArcs;
  drawnArcs = 0;
  elements.get("subdivisions").value = "4";
  listeners.get("subdivisions:input")();
  flushAnimationFrames();
  assert.equal(elements.get("subdivisionsOut").textContent, "4");
  assert.match(elements.get("subdivisionsHelp").textContent, /4 equal trigger regions/);
  assert.match(elements.get("mappingSummary").textContent, /4\/side/);
  assert.ok(
    drawnArcs > arcsInDefaultFrame,
    "a subdivided frame should include additional boundary markers",
  );

  elements.get("mappingMode").value = "w-incidence";
  listeners.get("mappingMode:change")();
  flushAnimationFrames();
  assert.match(elements.get("mappingSummary").textContent, /w depth × incidence · 4\/side/);
  assert.equal(elements.get("mappingLegendLabel0").textContent, "W-plane depth");
  assert.equal(elements.get("mappingLegendLabel1").textContent, "Edge W incidence");
  assert.match(
    elements.get("mappingSource").querySelector("span").textContent,
    /W-plane depth.*drum row/,
  );
  assert.match(elements.get("liveStatus").textContent, /W depth × incidence mapping/);

  listeners.get("playButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(performance.now() + 240);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.ok(oscillators.length > 0, "starting the W plane should trigger FM drums");
  assert.match(elements.get("mappingReadout").textContent, /SEGMENT \d\/4/);

  elements.get("hyperShape").value = "klein";
  listeners.get("hyperShape:change")();
  flushAnimationFrames();
  assert.equal(elements.get("formSummary").textContent, "Klein bottle");

  listeners.get("rotationZWPlay:click")();
  assert.equal(attributes.get("rotationZWPlay:aria-pressed"), "true");
  assert.equal(elements.get("rotationSummary").textContent, "ZW");

  listeners.get("resetHyperDrums:click")();
  flushAnimationFrames();
  assert.equal(elements.get("subdivisions").value, "2");
  assert.equal(elements.get("subdivisionsOut").textContent, "2");
  assert.match(elements.get("subdivisionsHelp").textContent, /2 equal trigger regions/);
  assert.match(elements.get("mappingSummary").textContent, /edge axis × depth · 2\/side/);
});
