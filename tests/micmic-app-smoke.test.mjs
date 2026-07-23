import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mic(mic) renders and drives a recursive microphone graph", async () => {
  const html = await readFile(new URL("../micmic.html", import.meta.url), "utf8");
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

  let strokes = 0;
  let arcs = 0;
  let frameStrokes = 0;
  let framePoints = [];
  const rememberPoint = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) framePoints.push([x, y]);
  };
  const drawingContext = {
    arc() { arcs += 1; },
    beginPath() {},
    bezierCurveTo() {},
    clearRect() {
      frameStrokes = 0;
      framePoints = [];
    },
    clip() {},
    closePath() {},
    fill() {},
    fillText() {},
    lineTo(x, y) { rememberPoint(x, y); },
    moveTo(x, y) { rememberPoint(x, y); },
    quadraticCurveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() {
      strokes += 1;
      frameStrokes += 1;
    },
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
  const generationMessages = [];
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = { postMessage(message) { generationMessages.push(message); } };
    }
    connect(destination) { return destination; }
    disconnect() {}
  };
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "running";
      this.destination = audioNode();
      this.audioWorklet = { async addModule() {} };
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

  await import(`../micmic-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  queuedFrame(performance.now() + 120);

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.ok(strokes > 20, "the default echo tree should render");
  const idleFrameStrokes = frameStrokes;
  const xs = framePoints.map(([x]) => x);
  const ys = framePoints.map(([, y]) => y);
  const initialBounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  assert.ok(initialBounds.maxY - initialBounds.minY > 480, "the fitted tree should use nearly all available stage height");
  assert.ok(initialBounds.maxX - initialBounds.minX > 300, "the fitted tree should remain visibly wide");
  assert.ok(initialBounds.minX >= 0 && initialBounds.maxX <= 900);
  assert.ok(initialBounds.minY >= 0 && initialBounds.maxY <= 600);
  assert.equal(arcs, 0, "the unified tree should not draw detached travelling dots");
  assert.equal(elements.get("stageReadout").textContent, "MIC OFF · PYTHAGOREAN PINE · 7 GENERATIONS");
  assert.equal(elements.get("recursionSummary").textContent, "Pythagorean Pine · 7 generations");
  assert.equal(elements.get("mixSummary").textContent, "76% descendants · root muted");
  assert.equal(elements.get("depthOut").textContent, "72%");
  assert.equal(elements.get("generationsOut").textContent, "7 / 12");
  assert.equal(elements.get("branchingOut").textContent, "100% fork probability");
  assert.equal(elements.get("mutationOut").textContent, "0% rule variance");
  assert.match(elements.get("generationPresetDescription").textContent, /balanced reference tree/);
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(elements.get("recordButton").disabled, true);
  assert.equal(seedButtonLabel.textContent, "Start input");
  const initialSeedLeft = Number.parseFloat(elements.get("seedControl").style.left);
  const initialSeedTop = Number.parseFloat(elements.get("seedControl").style.top);
  assert.ok(initialSeedLeft > 0 && initialSeedLeft < 900);
  assert.ok(initialSeedTop > 0 && initialSeedTop < 600);
  assert.equal(elements.get("seedControl").style.width, elements.get("seedControl").style.height);
  assert.match(elements.get("treeDescription").textContent, /7 generations and 255 connected segments; 48 of 48 bounded delayed descendant paths carry audible gain/);
  elements.get("timeRatio").value = "0.2";
  listeners.get("timeRatio:input")();
  queuedFrame(performance.now() + 130);
  const compactXs = framePoints.map(([x]) => x);
  const compactYs = framePoints.map(([, y]) => y);
  const compactWidth = Math.max(...compactXs) - Math.min(...compactXs);
  const compactHeight = Math.max(...compactYs) - Math.min(...compactYs);
  assert.ok(
    compactWidth > 760 || compactHeight > 480,
    "even an aggressively folded tree should fill one available stage dimension",
  );
  elements.get("generationPreset").value = "pythagorean";
  listeners.get("generationPreset:change")({ currentTarget: elements.get("generationPreset") });
  elements.get("depth").value = "0.86";
  listeners.get("depth:input")();
  assert.match(elements.get("treeDescription").textContent, /7 generations and 255 connected segments/);
  elements.get("depth").value = "0.72";
  listeners.get("depth:input")();
  elements.get("generations").value = "12";
  listeners.get("generations:input")();
  assert.match(elements.get("treeDescription").textContent, /12 generations/);
  elements.get("generations").value = "7";
  listeners.get("generations:input")();

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
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(attributes.get("seedMicButton:aria-pressed"), "true");
  assert.equal(attributes.get("micButton:aria-pressed"), "true");
  assert.equal(gains[0].gain.value, 0.85, "input trim should reach the live graph");
  assert.equal(elements.get("recordButton").disabled, false);
  assert.equal(elements.get("recordHint").textContent, "records while you listen");
  assert.equal(elements.get("micButtonLabel").textContent, "Pause input");
  const initialGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  assert.ok(initialGenerations.voices.length > 8);
  assert.ok(initialGenerations.voices.every((voice) => (
    Number.isFinite(voice.delay) && Number.isFinite(voice.rate)
  )));
  const initiallyAudible = new Set(initialGenerations.voices.map((voice) => (
    voice.key.replace(/^generation:/, "")
  )));
  assert.ok(initialGenerations.voices.every((voice) => (
    voice.parentId === "trunk" || initiallyAudible.has(voice.parentId)
  )), "every audible branch should retain its parent");

  elements.get("depth").value = "0";
  listeners.get("depth:input")();
  assert.match(elements.get("treeDescription").textContent, /0 of 48 bounded delayed descendant paths carry audible gain/);
  queuedFrame(performance.now() + 150);
  assert.equal(
    frameStrokes,
    idleFrameStrokes + 1,
    "zero-gain descendants should stay still while the microphone trunk reacts",
  );
  elements.get("depth").value = "0.72";
  listeners.get("depth:input")();

  queuedFrame(performance.now() + 160);
  const geometryBeforeMutation = framePoints.slice(0, 510);
  elements.get("mutation").value = "0.9";
  listeners.get("mutation:input")();
  queuedFrame(performance.now() + 160);
  const mutatedGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  assert.notDeepEqual(framePoints.slice(0, 510), geometryBeforeMutation, "mutation should redraw the fitted grammar");
  assert.notDeepEqual(
    mutatedGenerations.voices.map((voice) => [voice.turnDegrees, voice.interval]),
    initialGenerations.voices.map((voice) => [voice.turnDegrees, voice.interval]),
  );
  elements.get("mutation").value = "0";
  listeners.get("mutation:input")();

  elements.get("generations").value = "12";
  listeners.get("generations:input")();
  const cappedGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  assert.ok(cappedGenerations.voices.length <= 48);
  assert.equal(Math.max(...cappedGenerations.voices.map((voice) => voice.generation)), 12);
  elements.get("generations").value = "7";
  listeners.get("generations:input")();

  elements.get("generationAngle").value = "60";
  listeners.get("generationAngle:input")();
  const pitchedGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  assert.ok(pitchedGenerations.voices.find((voice) => voice.generation === 1 && voice.rule === "A").rate < 1);
  assert.ok(pitchedGenerations.voices.find((voice) => voice.generation === 1 && voice.rule === "B").rate > 1);
  assert.match(elements.get("generationPitchReadout").textContent, /-60° → -4 st · \+60° → \+4 st/);

  elements.get("generationPreset").value = "pythagorean";
  listeners.get("generationPreset:change")({ currentTarget: elements.get("generationPreset") });
  const forkedGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  const firstFork = forkedGenerations.voices.filter((voice) => voice.generation === 1);
  assert.deepEqual(firstFork.map((voice) => voice.rule), ["A", "B"]);
  assert.equal(elements.get("timeRatioOut").textContent, "0.72× per generation");
  assert.equal(elements.get("generationAngleOut").textContent, "45°");
  assert.equal(elements.get("generationsOut").textContent, "7 / 12");
  assert.equal(elements.get("branchingOut").textContent, "100% fork probability");
  assert.equal(elements.get("mutationOut").textContent, "0% rule variance");
  assert.equal(elements.get("depthOut").textContent, "72%");
  assert.equal(elements.get("intervalOut").textContent, "240 ms");

  elements.get("generationPreset").value = "binary";
  listeners.get("generationPreset:change")({ currentTarget: elements.get("generationPreset") });
  assert.equal(elements.get("generationsOut").textContent, "9 / 12");
  assert.equal(elements.get("depthOut").textContent, "64%");
  assert.equal(elements.get("intervalOut").textContent, "360 ms");
  assert.equal(elements.get("generationAngleOut").textContent, "28°");
  assert.match(elements.get("generationPresetDescription").textContent, /halves its timing/);

  listeners.get("micButton:click")();
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("micButtonLabel").textContent, "Resume input");
  assert.match(elements.get("stageReadout").textContent, /^INPUT PAUSED/);
  listeners.get("micButton:click")();
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("micButtonLabel").textContent, "Pause input");

  elements.get("inputTrim").value = "0.4";
  listeners.get("inputTrim:input")();
  assert.equal(elements.get("inputTrimOut").textContent, "40%");
  assert.equal(gains[0].gain.value, 0.4);

  const intervalFrameTime = performance.now() + 220;
  queuedFrame(intervalFrameTime);
  const segmentCount = Number(elements.get("treeDescription").textContent.match(/and (\d+) connected segments/)?.[1]);
  const ghostGeometryBeforeInterval = framePoints.slice(0, segmentCount * 2);
  const seedBeforeInterval = {
    left: elements.get("seedControl").style.left,
    top: elements.get("seedControl").style.top,
  };
  elements.get("interval").value = "500";
  listeners.get("interval:input")();
  assert.equal(elements.get("intervalOut").textContent, "500 ms");
  assert.equal(elements.get("generationTimingReadout").textContent, "500 ms → 250 ms → 125 ms → 63 ms");
  assert.equal(elements.get("generationPreset").value, "custom");
  assert.equal(elements.get("recursionSummary").textContent, "Custom growth · 9 generations");
  assert.equal(delays[0].delayTime.value, 0.5);
  assert.ok(Math.abs(delays[1].delayTime.value - 0.809) < 1e-9);
  queuedFrame(intervalFrameTime);
  assert.deepEqual(
    framePoints.slice(0, segmentCount * 2),
    ghostGeometryBeforeInterval,
    "playback timing must not alter the fitted tree geometry",
  );
  assert.deepEqual(
    {
      left: elements.get("seedControl").style.left,
      top: elements.get("seedControl").style.top,
    },
    seedBeforeInterval,
  );
  assert.ok(frameStrokes > idleFrameStrokes, "live loudness should add localized vibrating branch strokes");
  assert.equal(arcs, 0, "live audio should remain embodied in branches rather than detached dots");
  assert.notEqual(elements.get("inputMeterOut").textContent, "silent");

  listeners.get("recordButton:click")();
  assert.equal(attributes.get("recordButton:aria-pressed"), "true");
  assert.equal(elements.get("recordingBadge").hidden, false);
  assert.equal(elements.get("audioState").textContent, "on", "recording should not stop monitoring");
  listeners.get("recordButton:click")();
  assert.equal(elements.get("recordingBadge").hidden, true);
  listeners.get("recordButton:click")();
  assert.equal(mediaRecorders.length, 2, "a new take may begin while the previous take finalizes");
  mediaRecorders[0].finishStop();
  assert.equal(attributes.get("recordButton:aria-pressed"), "true", "an older stop event must not stop the new take");
  listeners.get("recordButton:click")();
  mediaRecorders[1].finishStop();
  assert.equal(elements.get("lastTake").hidden, false);
  assert.match(elements.get("downloadTake").download, /^micmic-.+\.webm$/);

  listeners.get("audioButton:click")();
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(stoppedTracks, 1);
});
