import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("spiral app renders intrinsic readers and plays tessellation contacts", async () => {
  const html = await readFile(new URL("../spiral.html", import.meta.url), "utf8");
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
      selectedOptions: [{ textContent: "Log radius" }],
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
      },
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
      setPointerCapture() {},
      focus() {},
      click() { listeners.get(`${id}:click`)?.(); },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);
  elements.get("timePath").querySelectorAll = () => [
    elements.get("radiusTime"), elements.get("angleTime"), elements.get("spiralTime"),
  ];
  elements.get("radiusTime").dataset.value = "radius";
  elements.get("angleTime").dataset.value = "angle";
  elements.get("spiralTime").dataset.value = "spiral";

  let drawnArcs = 0;
  const drawnLinePoints = [];
  const drawingContext = {
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo(x, y) {
      if (drawnLinePoints.length < 200) {
        drawnLinePoints.push([Number(x.toFixed(3)), Number(y.toFixed(3))]);
      }
    },
    moveTo() {},
    setTransform() {},
    stroke() {},
    arc() { drawnArcs += 1; },
  };
  elements.get("stage").getContext = () => drawingContext;
  elements.get("tileEditorCanvas").getContext = () => drawingContext;
  elements.get("tileEditorCanvas").getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 220 });
  elements.get("stageWrap").getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });

  let queuedFrame;
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
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
  };

  function audioParam(value = 0) {
    return {
      value,
      setTargetAtTime(next) { this.value = next; },
      setValueAtTime(next) { this.value = next; },
      exponentialRampToValueAtTime(next) { this.value = next; },
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
  const gains = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
    }
    createGain() {
      const gain = audioNode({ gain: audioParam(0) });
      gains.push(gain);
      return gain;
    }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0), knee: audioParam(0), ratio: audioParam(0),
        attack: audioParam(0), release: audioParam(0),
      });
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
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  await import(`../spiral-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  let now = performance.now() + 20;
  queuedFrame(now);

  assert.equal(elements.get("stage").width, 1800);
  assert.equal(elements.get("stage").height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^RADIUS .+ CONTACT/);
  assert.match(elements.get("formSummary").textContent, /Pentagon .+ IH20/);
  assert.equal(elements.get("windingSummary").textContent, "A1 · B5");
  assert.equal(elements.get("parameterCount").textContent, "2 parameters · guarded");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal((elements.get("tilingType").innerHTML.match(/<option /g) ?? []).length, 72);
  assert.equal(attributes.get("radiusTime:aria-pressed"), "true");
  assert.equal(attributes.get("sizeCoupling:aria-pressed"), "false");
  assert.equal(elements.get("mappingSummary").textContent, "Log radius → pitch");
  assert.ok(drawnArcs > 0);

  listeners.get("spiralTime:click")();
  assert.equal(attributes.get("spiralTime:aria-pressed"), "true");
  assert.equal(elements.get("readerTurnsControl").hidden, false);
  assert.match(elements.get("coordinateReadout").textContent, /LOG R \+ THETA/);
  listeners.get("timeDirection:click")();
  assert.equal(elements.get("timeDirection").textContent, "Counterclockwise");

  elements.get("spiralA").value = "2";
  listeners.get("spiralA:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(elements.get("windingSummary").textContent, "A2 · B5");
  const geometryBeforeLoop = drawnLinePoints.slice();
  drawnLinePoints.length = 0;

  elements.get("position").value = "0.45";
  listeners.get("position:input")();
  elements.get("loopPhase").value = "0.25";
  listeners.get("loopPhase:input")();
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("loopPhaseOut").textContent, /25\.0% · \+1\.20/);
  assert.notDeepEqual(drawnLinePoints, geometryBeforeLoop);
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(oscillators.length, 16);
  now += 60;
  queuedFrame(now);
  assert.equal(Number(elements.get("loopPhase").value), 0.25);
  assert.ok(Number(elements.get("position").value) < 0.45);
  const voiceGains = gains.slice(1, 17);
  assert.ok(voiceGains.some((gain) => gain.gain.value > 0));
  assert.ok(oscillators.some((oscillator) => oscillator.frequency.value !== 220));
  assert.match(elements.get("stageReadout").textContent, /VOICE/);

  await listeners.get("playButton:click")();
  const stationaryPosition = Number(elements.get("position").value);
  await listeners.get("loopPlayButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(attributes.get("loopPlayButton:aria-pressed"), "true");
  now += 60;
  queuedFrame(now);
  assert.equal(Number(elements.get("position").value), stationaryPosition);
  assert.ok(Number(elements.get("loopPhase").value) > 0.25);

  listeners.get("radiusTime:click")();
  const uncoupledFrequencies = oscillators.map((oscillator) => oscillator.frequency.value);
  listeners.get("sizeCoupling:click")();
  assert.equal(attributes.get("sizeCoupling:aria-pressed"), "true");
  assert.match(elements.get("sizeCoupling").textContent, /on$/);
  assert.equal(elements.get("mappingSummary").textContent, "Log radius + size → pitch/time");
  assert.match(elements.get("coordinateReadout").textContent, /^R ·/);
  now += 20;
  queuedFrame(now);
  assert.ok(oscillators.some((oscillator, index) => (
    Math.abs(oscillator.frequency.value - uncoupledFrequencies[index]) > 1e-6
  )));

  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")();
  assert.equal(elements.get("amplitudeControl").hidden, true);
  assert.equal(elements.get("intersectionDecayControl").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  elements.get("percussionDecay").value = "720";
  listeners.get("percussionDecay:input")();
  assert.equal(elements.get("percussionDecayOut").textContent, "720 ms");

  const beforeScrub = Number(elements.get("position").value);
  listeners.get("stage:pointerdown")({ clientX: 690, clientY: 260, pointerId: 4 });
  listeners.get("stage:pointermove")({ clientX: 610, clientY: 190, pointerId: 4 });
  listeners.get("stage:pointerup")({ pointerId: 4 });
  assert.notEqual(Number(elements.get("position").value), beforeScrub);
});
