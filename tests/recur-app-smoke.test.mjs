import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("recur app traces a recursion, plays it, and fuses at high speed", async () => {
  const html = await readFile(new URL("../recur.html", import.meta.url), "utf8");
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
      min: "",
      max: "",
      dataset: {},
      style: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
      },
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
      focus() {},
      click() { listeners.get(`${id}:click`)?.(); },
    };
    elements.set(id, node);
    return node;
  }
  for (const id of ids) element(id);
  const fire = (id, type, event = {}) => listeners.get(`${id}:${type}`)?.({
    currentTarget: elements.get(id),
    target: elements.get(id),
    ...event,
  });

  const drawn = { fillRect: 0, strokeRect: 0, arc: 0, stroke: 0, fill: 0 };
  const drawingContext = {
    beginPath() {}, closePath() {}, clearRect() {}, setTransform() {},
    moveTo() {}, lineTo() {},
    arc() { drawn.arc += 1; },
    fill() { drawn.fill += 1; },
    stroke() { drawn.stroke += 1; },
    fillRect() { drawn.fillRect += 1; },
    strokeRect() { drawn.strokeRect += 1; },
  };
  elements.get("stage").getContext = () => drawingContext;
  elements.get("stageWrap").getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });

  let queuedFrame;
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => { queuedFrame = callback; frameId += 1; return frameId; };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  globalThis.window = { devicePixelRatio: 2, addEventListener() {} };

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
    return { ...properties, connect(destination) { return destination; }, disconnect() {} };
  }
  const oscillators = [];
  const delays = [];
  const feedbackGains = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.sampleRate = 48_000;
      this.destination = audioNode();
    }
    createGain() { return audioNode({ gain: audioParam(1) }); }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0), knee: audioParam(0), ratio: audioParam(0),
        attack: audioParam(0), release: audioParam(0),
      });
    }
    createOscillator() {
      const oscillator = audioNode({ type: "sine", frequency: audioParam(220), start() {}, stop() {} });
      oscillators.push(oscillator);
      return oscillator;
    }
    createDelay() { const delay = audioNode({ delayTime: audioParam(0) }); delays.push(delay); return delay; }
    createBiquadFilter() { return audioNode({ type: "lowpass", frequency: audioParam(0), Q: audioParam(0) }); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  await import(`../recur-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");

  let now = performance.now() + 20;
  queuedFrame(now);
  assert.equal(elements.get("stage").width, 1800);
  assert.equal(elements.get("stage").height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^FACTORIAL\(5\)/);
  assert.match(elements.get("programBlurb").textContent, /base case/i);
  assert.ok(drawn.arc > 0, "progress head is drawn");

  // Turn audio on.
  await fire("audioButton", "click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");

  // Switch to Towers of Hanoi and play a while.
  elements.get("program").value = "hanoi";
  fire("program", "change");
  assert.equal(elements.get("programSummary").textContent, "hanoi");
  fire("playButton", "click");
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  for (let step = 0; step < 6; step += 1) { now += 120; queuedFrame(now); }
  assert.ok(Number(elements.get("position").value) > 0, "playhead advanced");
  assert.ok(oscillators.length > 0, "voices/events created oscillators");

  // Fibonacci with the memoize toggle available.
  elements.get("program").value = "fibonacci";
  fire("program", "change");
  assert.equal(elements.get("memoize").hidden, false);
  fire("memoize", "click");
  assert.equal(attributes.get("memoize:aria-pressed"), "true");

  // Return voicing → feedback should build the bounded delay and stay ≤ 0.86.
  elements.get("returnVoicing").value = "feedback";
  fire("returnVoicing", "change");
  fire("restartButton", "click");
  // Step through enough events to reach base/return firings (which feed the bus).
  for (let step = 0; step < 16; step += 1) fire("stepButton", "click");
  assert.ok(delays.length > 0, "feedback delay was built");
  assert.ok(delays.every((delay) => delay.delayTime.value <= 2), "delay time is bounded");

  // Sweep the time-scale past the fusion threshold.
  elements.get("timeScale").value = "0.97";
  fire("timeScale", "input");
  now += 200;
  queuedFrame(now);
  assert.equal(elements.get("timeScaleSummary").textContent, "fused tone");
  assert.match(elements.get("stageReadout").textContent, /FUSED/);

  // Toggle Shepard off without throwing.
  fire("shepardToggle", "click");
  assert.equal(attributes.get("shepardToggle:aria-pressed"), "false");
  now += 60;
  queuedFrame(now);
});
