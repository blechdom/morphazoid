import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Fractaphone renders and drives a recursive microphone graph", async () => {
  const html = await readFile(new URL("../fractaphone.html", import.meta.url), "utf8");
  const tags = new Map(
    [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map((match) => [match[1], match[0]]),
  );
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function classList() {
    const classes = new Set();
    return {
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    };
  }

  function element(id) {
    const node = {
      id,
      value: "",
      textContent: "",
      hidden: /\bhidden\b/.test(tags.get(id) ?? ""),
      disabled: /\bdisabled\b/.test(tags.get(id) ?? ""),
      dataset: {},
      style: {},
      classList: classList(),
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      removeAttribute(name) { attributes.delete(`${id}:${name}`); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of tags.keys()) element(id);

  const seedButtonLabel = { textContent: "" };
  elements.get("seedMicButton").querySelector = (selector) => (
    selector === "b" ? seedButtonLabel : null
  );
  const presetButtons = [...html.matchAll(/<button[^>]+data-preset="([^"]+)"[^>]*>/g)]
    .map((match) => ({
      dataset: { preset: match[1] },
      setAttribute(name, value) {
        attributes.set(`preset-${match[1]}:${name}`, String(value));
      },
    }));
  elements.get("presetButtons").querySelectorAll = () => presetButtons;

  let strokes = 0;
  let arcs = 0;
  const drawingContext = {
    arc() { arcs += 1; },
    beginPath() {},
    bezierCurveTo() {},
    clearRect() {},
    clip() {},
    closePath() {},
    fill() {},
    fillText() {},
    lineTo() {},
    moveTo() {},
    quadraticCurveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() { strokes += 1; },
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
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const windowListeners = new Map();
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLSelectElement = class {};
  globalThis.HTMLTextAreaElement = class {};

  function audioParam(value = 0) {
    return {
      value,
      cancelScheduledValues() {},
      setTargetAtTime(next) { this.value = next; },
      setValueAtTime(next) { this.value = next; },
    };
  }
  function audioNode(properties = {}) {
    return {
      ...properties,
      connect(destination) { return destination; },
      disconnect() {},
    };
  }

  const gains = [];
  const delays = [];
  const analysers = [];
  const audioContexts = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "running";
      this.destination = audioNode();
      audioContexts.push(this);
    }
    addEventListener() {}
    createGain() {
      const gain = audioNode({ gain: audioParam(0) });
      gains.push(gain);
      return gain;
    }
    createBiquadFilter() {
      return audioNode({ type: "lowpass", frequency: audioParam(0), Q: audioParam(0) });
    }
    createAnalyser() {
      const analyser = audioNode({
        fftSize: 2048,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(samples) { samples.fill(0.02); },
      });
      analysers.push(analyser);
      return analyser;
    }
    createDelay() {
      const delay = audioNode({ delayTime: audioParam(0) });
      delays.push(delay);
      return delay;
    }
    createWaveShaper() { return audioNode({ curve: null, oversample: "none" }); }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0),
        knee: audioParam(0),
        ratio: audioParam(0),
        attack: audioParam(0),
        release: audioParam(0),
      });
    }
    createMediaStreamDestination() { return audioNode({ stream: { id: "processed-output" } }); }
    createOscillator() {
      return audioNode({
        type: "sine",
        frequency: audioParam(0),
        start() {},
        stop() {},
      });
    }
    createMediaStreamSource() { return audioNode(); }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  let requestedConstraints = null;
  let stoppedTracks = 0;
  const track = {
    addEventListener() {},
    stop() { stoppedTracks += 1; },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          requestedConstraints = constraints;
          return { getTracks: () => [track] };
        },
      },
    },
  });
  const mediaRecorders = [];
  globalThis.MediaRecorder = class {
    static isTypeSupported(type) { return type.startsWith("audio/webm"); }
    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = options.mimeType || "audio/webm";
      this.state = "inactive";
      this.listeners = new Map();
      mediaRecorders.push(this);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.listeners.get("dataavailable")?.({
        data: new Blob(["recursive audio"], { type: this.mimeType }),
      });
    }
    finishStop() {
      this.listeners.get("stop")?.();
    }
  };

  await import(`../fractaphone-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  queuedFrame(performance.now() + 120);

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.ok(strokes > 20, "the default echo tree should render");
  assert.equal(arcs, 0, "an idle tree should not draw travelling audio pulses");
  assert.equal(elements.get("stageReadout").textContent, "MIC OFF · BLOOM · 10 GENERATIONS");
  assert.equal(elements.get("recursionSummary").textContent, "Bloom · 10 generations");
  assert.equal(elements.get("mixSummary").textContent, "76% descendants · root muted");
  assert.equal(elements.get("depthOut").textContent, "72% · 10 gen");
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(elements.get("recordButton").disabled, true);
  assert.equal(attributes.get("preset-bloom:aria-pressed"), "true");
  assert.equal(seedButtonLabel.textContent, "Start input");
  assert.equal(elements.get("seedControl").style.left, "108px");
  assert.equal(elements.get("seedControl").style.top, "301px");

  listeners.get("seedMicButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requestedConstraints, {
    video: false,
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    },
  });
  assert.equal(audioContexts.length, 1);
  assert.equal(elements.get("audioState").textContent, "listening");
  assert.equal(elements.get("stateMetric").textContent, "live");
  assert.equal(attributes.get("seedMicButton:aria-pressed"), "true");
  assert.equal(attributes.get("micButton:aria-pressed"), "true");
  assert.equal(gains[0].gain.value, 0.85, "input trim should reach the live graph");
  assert.equal(elements.get("recordButton").disabled, false);
  assert.equal(elements.get("recordHint").textContent, "records while you listen");
  assert.equal(elements.get("micButtonLabel").textContent, "Pause input");

  listeners.get("micButton:click")();
  assert.equal(elements.get("audioState").textContent, "input paused");
  assert.equal(elements.get("stateMetric").textContent, "paused");
  assert.equal(elements.get("micButtonLabel").textContent, "Resume input");
  assert.match(elements.get("stageReadout").textContent, /^INPUT PAUSED/);
  listeners.get("micButton:click")();
  assert.equal(elements.get("audioState").textContent, "listening");
  assert.equal(elements.get("micButtonLabel").textContent, "Pause input");

  elements.get("inputTrim").value = "0.4";
  listeners.get("inputTrim:input")();
  assert.equal(elements.get("inputTrimOut").textContent, "40%");
  assert.equal(gains[0].gain.value, 0.4);

  elements.get("interval").value = "500";
  listeners.get("interval:input")();
  assert.equal(elements.get("intervalOut").textContent, "500 ms");
  assert.equal(elements.get("recursionSummary").textContent, "Custom · 10 generations");
  assert.equal(delays[0].delayTime.value, 0.5);
  assert.ok(Math.abs(delays[1].delayTime.value - 0.75956) < 1e-9);

  const arcsBeforeLiveFrame = arcs;
  queuedFrame(performance.now() + 240);
  assert.ok(arcs > arcsBeforeLiveFrame, "live recursive branches should draw travelling pulses");
  assert.notEqual(elements.get("inputMeterOut").textContent, "silent");

  listeners.get("recordButton:click")();
  assert.equal(attributes.get("recordButton:aria-pressed"), "true");
  assert.equal(elements.get("recordingBadge").hidden, false);
  assert.equal(elements.get("audioState").textContent, "listening", "recording should not stop monitoring");
  listeners.get("recordButton:click")();
  assert.equal(elements.get("recordingBadge").hidden, true);
  listeners.get("recordButton:click")();
  assert.equal(mediaRecorders.length, 2, "a new take may begin while the previous take finalizes");
  mediaRecorders[0].finishStop();
  assert.equal(attributes.get("recordButton:aria-pressed"), "true", "an older stop event must not stop the new take");
  listeners.get("recordButton:click")();
  mediaRecorders[1].finishStop();
  assert.equal(elements.get("lastTake").hidden, false);
  assert.match(elements.get("downloadTake").download, /^fractaphone-.+\.webm$/);

  listeners.get("audioButton:click")();
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(stoppedTracks, 1);
});
