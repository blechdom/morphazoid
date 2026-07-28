import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("solid drum app starts, renders sixteen voices, and plays plane intersections", async () => {
  const html = await readFile(new URL("../solid-drums.html", import.meta.url), "utf8");
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
      disabled: false,
      dataset: {},
      style: {
        setProperty() {},
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
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector(selector) {
        if (selector === "span") return nestedSpan;
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
        listeners.get(`${id}:click`)?.({ currentTarget: node });
      },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);
  const canvas = elements.get("stage");
  const drawingContext = {
    arc() {},
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
  };
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
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

  await import(`../solid-drums-app.js?smoke=${Date.now()}`);
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  flushAnimationFrames();

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^CUBE · \d+ CONTACT/);
  assert.equal(elements.get("formSummary").textContent, "cube");
  assert.equal(elements.get("mappingSummary").textContent, "edge × axis");
  assert.equal(
    (elements.get("mappingMode").innerHTML.match(/<option /g) ?? []).length,
    3,
  );
  assert.equal(
    (elements.get("drumMap").innerHTML.match(/class="solid-drum-cell"/g) ?? []).length,
    16,
  );
  assert.equal(attributes.get("selectSolid:aria-pressed"), "true");
  assert.equal(attributes.get("selectSurface:aria-pressed"), "false");

  listeners.get("playButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(performance.now() + 240);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.ok(oscillators.length > 0, "starting the surface should trigger FM drums");

  elements.get("mappingMode").value = "position-grid";
  listeners.get("mappingMode:change")();
  assert.equal(elements.get("mappingSummary").textContent, "3d position");

  elements.get("solidType").value = "octahedron";
  listeners.get("solidType:change")({ currentTarget: elements.get("solidType") });
  flushAnimationFrames(performance.now() + 400);
  assert.equal(elements.get("formSummary").textContent, "octahedron");
  assert.match(elements.get("stageReadout").textContent, /^OCTAHEDRON · \d+ CONTACT/);

  listeners.get("rotationYPlay:click")();
  assert.equal(attributes.get("rotationYPlay:aria-pressed"), "true");
  assert.equal(elements.get("rotationSummary").textContent, "Y");

  listeners.get("resetSolidDrums:click")();
  flushAnimationFrames();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(elements.get("rotationSummary").textContent, "paused");
  assert.equal(elements.get("mappingSummary").textContent, "edge × axis");
  assert.equal(elements.get("formSummary").textContent, "cube");
});
