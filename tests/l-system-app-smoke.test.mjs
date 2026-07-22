import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("L-system app draws and drives 128 scaled branch voices", async () => {
  const html = await readFile(new URL("../l-system.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  for (const id of ids) {
    elements.set(id, {
      id,
      value: "",
      textContent: "",
      hidden: false,
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      getBoundingClientRect() { return { width: 900, height: 600 }; },
    });
  }

  let strokes = 0;
  let arcs = 0;
  const drawingContext = {
    arc() { arcs += 1; },
    beginPath() {},
    clearRect() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() { strokes += 1; },
  };
  elements.get("stage").getContext = () => drawingContext;

  let queuedFrame = null;
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    frameId += 1;
    return frameId;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  const windowListeners = new Map();
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };

  const audioParam = (value = 0) => ({
    value,
    setTargetAtTime(next) { this.value = next; },
  });
  const audioNode = (properties = {}) => ({
    ...properties,
    connect(destination) { return destination; },
    disconnect() {},
  });
  const gainNodes = [];
  let oscillatorCount = 0;
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
    }
    createGain() {
      const node = audioNode({ gain: audioParam(0) });
      gainNodes.push(node);
      return node;
    }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0), knee: audioParam(0), ratio: audioParam(0),
        attack: audioParam(0), release: audioParam(0),
      });
    }
    createOscillator() {
      oscillatorCount += 1;
      return audioNode({ type: "sine", frequency: audioParam(220), start() {}, stop() {} });
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  await import(`../l-system-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  let now = performance.now() + 20;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /PYTHAGOREAN TREE · FINAL I7 · 1 HEAD · AUDIO OFF/);
  assert.ok(strokes >= 255, "the complete tree skeleton should be drawn");
  assert.equal(arcs, 1, "the trunk should begin with one playhead");

  listeners.get("structureSequence:click")();
  elements.get("position").value = String(1.5 / 7);
  listeners.get("position:input")();
  queuedFrame(now + 10);
  assert.equal(elements.get("speedOut").textContent, "0.08 iter/s");
  assert.match(elements.get("structureSummary").textContent, /sequence · I2\/7/);
  assert.equal(elements.get("positionOut").textContent, "I2 · 50.0%");

  listeners.get("structureFinal:click")();

  elements.get("position").value = "0.99";
  listeners.get("position:input")();
  queuedFrame(now + 20);
  assert.match(elements.get("stageReadout").textContent, /FINAL I7 · 128 HEADS · AUDIO OFF/);

  listeners.get("structureTogether:click")();
  queuedFrame(now + 40);
  assert.match(elements.get("stageReadout").textContent, /7 ITERATIONS TOGETHER · 254 HEADS · AUDIO OFF/);
  assert.match(elements.get("structureReadout").textContent, /I1 \+ I2[\s\S]*I7 · phase locked/);

  await listeners.get("audioButton:click")();
  assert.equal(oscillatorCount, 128);
  listeners.get("playButton:click")();
  now += 60;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /7 ITERATIONS TOGETHER · 254 HEADS · 128 SINE VOICES/);
  const voiceGains = gainNodes.slice(1).map((node) => node.gain.value);
  assert.equal(voiceGains.filter((gain) => gain > 0).length, 128);
  assert.ok(Math.abs(Math.hypot(...voiceGains) - 0.38) < 1e-9);
  assert.equal(attributes.get("playButton:aria-pressed"), "true");

  windowListeners.get("pagehide")({ persisted: true });
});
