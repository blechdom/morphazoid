import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Julia app builds, draws, scrubs, and advances its boundary", async () => {
  const html = await readFile(new URL("../julia.html", import.meta.url), "utf8");
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
      hidden: false,
      disabled: false,
      dataset: {},
      style: {},
      classList: {
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
        contains(name) { return classes.has(name); },
      },
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
      setPointerCapture() {},
    };
    elements.set(id, node);
    return node;
  }
  for (const id of ids) element(id);
  const turnMeta = element("turnMeta");
  elements.get("turnReadout").parentElement = turnMeta;
  elements.get("leftRises").dataset.value = "1";
  elements.get("rightRises").dataset.value = "-1";

  let strokes = 0;
  let arcs = 0;
  const drawingContext = {
    arc() { arcs += 1; },
    beginPath() {},
    clearRect() {},
    closePath() {},
    drawImage() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() { strokes += 1; },
  };
  const textureContext = {
    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {},
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 900, height: 600 });

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

  const documentListeners = new Map();
  globalThis.document = {
    hidden: false,
    createElement(name) {
      assert.equal(name, "canvas");
      return { width: 0, height: 0, getContext: () => textureContext };
    },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
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
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
    }
    createGain() { return audioNode({ gain: audioParam(0) }); }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0), knee: audioParam(0), ratio: audioParam(0),
        attack: audioParam(0), release: audioParam(0),
      });
    }
    createOscillator() {
      return audioNode({ type: "sine", frequency: audioParam(220), start() {} });
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  await import(`../julia-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  let now = performance.now() + 20;
  queuedFrame(now);

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^SPIRAL · \d+ LOOPS? · \d+ TURNS · 1\.00× · AUDIO OFF$/);
  assert.equal(elements.get("mappingSummary").textContent, "left rises · 1.00 oct/turn");
  assert.equal(elements.get("resolutionOut").textContent, "224²");
  assert.equal(elements.get("simplifyOut").textContent, "0.75 px");
  assert.equal(elements.get("viewZoomOut").textContent, "1.00×");
  assert.ok(strokes >= 6, "the boundary, turn groups, and playhead trail should be drawn");
  assert.ok(arcs >= 2, "the boundary playhead should be visible");

  listeners.get("rightRises:click")();
  assert.equal(attributes.get("rightRises:aria-pressed"), "true");
  assert.match(elements.get("mappingSummary").textContent, /^right rises/);
  listeners.get("directionButton:click")();
  assert.equal(elements.get("directionButton").textContent, "Direction · reverse");

  listeners.get("stage:wheel")({ clientX: 450, clientY: 300, deltaY: -300, preventDefault() {} });
  assert.notEqual(elements.get("viewZoomOut").textContent, "1.00×");
  listeners.get("stage:pointerdown")({ pointerId: 3, clientX: 450, clientY: 300, shiftKey: true, preventDefault() {} });
  listeners.get("stage:pointermove")({ pointerId: 3, clientX: 490, clientY: 320 });
  listeners.get("stage:pointerup")({ pointerId: 3 });
  assert.notEqual(elements.get("viewCenterOut").textContent, "0.000 + 0.000i");
  listeners.get("resetView:click")();
  assert.equal(elements.get("viewZoomOut").textContent, "1.00×");
  assert.equal(elements.get("viewCenterOut").textContent, "0.000 + 0.000i");

  listeners.get("analyzeSimilarity:click")();
  assert.equal(elements.get("auditionSimilarity").disabled, false);
  assert.equal(elements.get("jumpSimilarity").disabled, false);
  assert.match(elements.get("similarityMatch").textContent, /d1 r=/);
  assert.match(elements.get("similarityLocation").textContent, /nearest periodic target q[12]/);
  listeners.get("similarityExperiment:change")({ currentTarget: { value: "wavelet" } });
  assert.match(elements.get("similaritySummary").textContent, /^wavelet orchestra/);
  listeners.get("jumpSimilarity:click")();
  assert.notEqual(elements.get("viewZoomOut").textContent, "1.00×");
  listeners.get("resetView:click")();

  listeners.get("stage:pointerdown")({ pointerId: 4, clientX: 450, clientY: 80 });
  listeners.get("stage:pointerup")({ pointerId: 4 });
  assert.ok(Number(elements.get("position").value) >= 0);
  const before = Number(elements.get("position").value);
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  now = performance.now() + 100;
  queuedFrame(now);
  assert.notEqual(Number(elements.get("position").value), before);

  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(elements.get("audioState").textContent, "sine fallback");
  await listeners.get("auditionSimilarity:click")();
  assert.equal(attributes.get("auditionSimilarity:aria-pressed"), "true");
  now += 80;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /WAVELET ORCHESTRA LAB$/);
  await listeners.get("auditionSimilarity:click")();
  assert.equal(attributes.get("auditionSimilarity:aria-pressed"), "false");
  windowListeners.get("pagehide")({ persisted: true });
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(elements.get("audioState").textContent, "off");
  windowListeners.get("pageshow")({ persisted: true });
});
