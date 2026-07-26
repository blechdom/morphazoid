import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sliderFromTimeFold } from "../src/micmic.js";

test("L-mic renders and drives a recursive microphone graph", async () => {
  const html = await readFile(new URL("../l-mic.html", import.meta.url), "utf8");
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
      connections: [],
      connect(destination) {
        this.connections.push(destination);
        return destination;
      },
      disconnect() {},
    };
  }

  const gains = [];
  const delays = [];
  const analysers = [];
  const audioContexts = [];
  const generationMessages = [];
  const workletNodes = [];
  const renderCapacities = [];
  const pendingSignalsmithNodes = [];
  let signalsmithReadyEnabled = false;
  const signalsmithRemoteMethods = {
    configure: 1,
    latency: 1,
    setUpdateInterval: 1,
    stop: 1,
    start: 5,
    schedule: 2,
  };
  const readySignalsmithNode = (node) => {
    queueMicrotask(() => node.port.emit(["ready", signalsmithRemoteMethods]));
  };
  globalThis.AudioWorkletNode = class {
    constructor(context, name, options = {}) {
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = {
        onmessage: null,
        messages: [],
        postMessage: (message) => {
          this.port.messages.push(message);
          if (
            name !== "signalsmith-stretch"
            && name !== "morphazoid-signalsmith-generation-mixer"
          ) generationMessages.push(message);
          if (name === "signalsmith-stretch" && Array.isArray(message)) {
            const [messageId, method] = message;
            const result = method === "latency" ? 0.08 : undefined;
            queueMicrotask(() => this.port.emit([messageId, result]));
          }
        },
        start() {},
        close() {},
        emit: (data) => this.port.onmessage?.({ data }),
      };
      workletNodes.push(this);
      if (name === "morphazoid-micmic-generations") {
        queueMicrotask(() => this.port.emit({
          type: "renderer-ready",
          renderer: options.processorOptions?.renderer ?? "granular-fallback",
        }));
      }
      if (name === "signalsmith-stretch") {
        if (signalsmithReadyEnabled) readySignalsmithNode(this);
        else pendingSignalsmithNodes.push(this);
      }
    }
    connections = [];
    connect(destination) {
      this.connections.push(destination);
      return destination;
    }
    disconnect() {}
  };
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "running";
      this.destination = audioNode();
      this.audioWorklet = { async addModule() {} };
      this.renderCapacity = {
        onupdate: null,
        start() {},
        stop() {},
      };
      renderCapacities.push(this.renderCapacity);
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
  let microphoneRequests = 0;
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
          microphoneRequests += 1;
          requestedConstraints = constraints;
          return { getTracks: () => [track] };
        },
      },
    },
  });
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
  assert.equal(elements.get("stageReadout").textContent, "MIC OFF · PYTHAGOREAN PINE · 13 GENERATIONS");
  assert.equal(elements.get("presetSummary").textContent, "Pythagorean Pine · Maximum");
  assert.equal(elements.get("recursionSummary").textContent, "Pythagorean Pine · 13 generations");
  assert.equal(elements.get("mixSummary").textContent, "76% descendants · root muted");
  assert.equal(elements.get("depthOut").textContent, "72%");
  assert.equal(elements.get("generationsOut").textContent, "13 / 13");
  assert.equal(elements.get("mutationOut").textContent, "0% rule variance");
  assert.equal(elements.get("timeRatioOut").textContent, "0.72× per generation");
  assert.equal(elements.get("pruningBias").value, "0");
  assert.equal(elements.get("pruningBiasOut").textContent, "breadth first");
  assert.equal(attributes.get("pruningBias:aria-valuetext"), "breadth first");
  assert.match(elements.get("generationPresetDescription").textContent, /full reference canopy/);
  assert.equal(attributes.get("generationPreset-pythagorean:aria-pressed"), "true");
  assert.equal(elements.get("pitchDetail").value, "24");
  assert.equal(elements.get("pitchDetail").disabled, false);
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(listeners.has("recordButton:click"), false);
  assert.equal(seedButtonLabel.textContent, "Start input");
  const initialSeedLeft = Number.parseFloat(elements.get("seedControl").style.left);
  const initialSeedTop = Number.parseFloat(elements.get("seedControl").style.top);
  assert.ok(initialSeedLeft > 0 && initialSeedLeft < 900);
  assert.ok(initialSeedTop > 0 && initialSeedTop < 600);
  assert.equal(elements.get("seedControl").style.width, elements.get("seedControl").style.height);
  assert.match(elements.get("treeDescription").textContent, /13 generations and 1023 connected segments; 48 of 48 breadth first delayed descendant paths carry audible gain/);
  assert.match(elements.get("generationCapacityInline").textContent, /48 of 1,022 branches ready · breadth first pruning · device-adjusted/);
  assert.equal(elements.get("currentSettingsSummary").textContent, "13 gen · 240 ms root fold");
  assert.equal(
    elements.get("generationCountReadout").textContent,
    "1 → 2 → 4 → 8 → 16 → 32 → … → 128 at G13",
  );
  assert.equal(
    elements.get("generationTimingReadout").textContent,
    "240 ms → 173 ms → 124 ms → 90 ms … 3.35 ms at G13",
  );
  assert.equal(
    elements.get("generationPitchReadout").textContent,
    "-45° → -25% octave · +45° → +25% octave",
  );
  assert.equal(elements.get("generationPitchScaleOut").textContent, "100% / 180°");
  listeners.get("resetGenerationRules:click")();
  assert.equal(
    elements.get("pitchDetail").value,
    "24",
    "reloading a growth preset must preserve renderer pitch detail",
  );
  listeners.get("generationPreset-moss:click")();
  assert.equal(elements.get("timeRatio").value, "2");
  assert.equal(elements.get("timeRatioOut").textContent, "2.00× per generation");
  assert.match(elements.get("generationPresetDescription").textContent, /doubles its spacing/);
  queuedFrame(performance.now() + 125);
  const [trunkStart, trunkEnd] = framePoints;
  assert.ok(
    Math.hypot(trunkEnd[0] - trunkStart[0], trunkEnd[1] - trunkStart[1]) >= 20,
    "compressed 2× drawing should keep the trunk visible",
  );
  elements.get("interval").value = String(sliderFromTimeFold(3_000));
  listeners.get("interval:input")();
  assert.equal(elements.get("intervalOut").textContent, "3000 ms");
  assert.equal(elements.get("timeRatio").value, "2");
  assert.equal(
    attributes.has("timeRatio:max"),
    false,
    "Time Fold must not rewrite the Child Time Ratio ceiling",
  );
  assert.equal(elements.get("timeRatioOut").textContent, "2.00× per generation");
  listeners.get("generationPreset-pythagorean:click")();
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
  listeners.get("generationPreset-pythagorean:click")();
  elements.get("depth").value = "0.96";
  listeners.get("depth:input")();
  assert.match(elements.get("treeDescription").textContent, /13 generations and 1023 connected segments/);
  elements.get("depth").value = "0.72";
  listeners.get("depth:input")();
  elements.get("generations").value = "7";
  listeners.get("generations:input")();
  assert.match(elements.get("treeDescription").textContent, /7 generations/);
  elements.get("generations").value = "13";
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
  assert.equal(elements.get("pitchDetail").disabled, true);
  assert.equal(attributes.get("seedMicButton:aria-pressed"), "true");
  assert.equal(attributes.get("micButton:aria-pressed"), "true");
  const directNode = workletNodes.find((node) => (
    node.name === "morphazoid-micmic-generations"
  ));
  assert.equal(directNode.options.processorOptions.renderer, "granular-economy");
  assert.equal(directNode.options.processorOptions.historySeconds, 40);
  assert.equal(
    workletNodes.filter((node) => node.name === "signalsmith-stretch").length,
    0,
    "the default Economy renderer must not allocate Signalsmith lanes",
  );
  const currentRendererGain = directNode.connections[0];
  assert.equal(currentRendererGain.gain.value, 1, "the current renderer must own startup audio");
  assert.equal(gains[0].gain.value, 0.85, "input trim should reach the live graph");
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

  queuedFrame(performance.now() + 145);
  const breadthFirstFrame = framePoints.slice();
  const presetBeforePruning = elements.get("recursionSummary").textContent;
  elements.get("pruningBias").value = "1";
  listeners.get("pruningBias:input")();
  const depthGenerations = generationMessages
    .filter((message) => message.type === "voices")
    .at(-1);
  const depthIds = new Set(depthGenerations.voices.map((voice) => (
    voice.key.replace(/^generation:/, "")
  )));
  assert.equal(Math.max(...depthGenerations.voices.map((voice) => voice.generation)), 13);
  assert.ok(depthGenerations.voices.every((voice) => (
    voice.parentId === "trunk" || depthIds.has(voice.parentId)
  )));
  assert.equal(elements.get("pruningBiasOut").textContent, "depth first");
  assert.equal(attributes.get("pruningBias:aria-valuetext"), "depth first");
  assert.equal(elements.get("recursionSummary").textContent, presetBeforePruning);
  assert.match(elements.get("treeDescription").textContent, /depth first delayed descendant paths/);
  queuedFrame(performance.now() + 148);
  assert.notDeepEqual(framePoints, breadthFirstFrame, "pruning must recolor the live graph immediately");

  elements.get("pruningBias").value = "0";
  listeners.get("pruningBias:input")();
  const restoredBreadthGenerations = generationMessages
    .filter((message) => message.type === "voices")
    .at(-1);
  assert.equal(Math.max(...restoredBreadthGenerations.voices.map((voice) => voice.generation)), 5);
  assert.deepEqual(
    restoredBreadthGenerations.voices.map(({ key }) => key),
    initialGenerations.voices.map(({ key }) => key),
  );

  elements.get("depth").value = "0";
  listeners.get("depth:input")();
  assert.match(elements.get("treeDescription").textContent, /0 of 48 breadth first delayed descendant paths carry audible gain/);
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

  elements.get("generations").value = "13";
  listeners.get("generations:input")();
  const cappedGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  assert.ok(cappedGenerations.voices.length <= 48);
  assert.equal(cappedGenerations.requestedVoiceCount, 1_022);
  assert.equal(Math.max(...cappedGenerations.voices.map((voice) => voice.generation)), 5);

  elements.get("generationAngle").value = "60";
  listeners.get("generationAngle:input")();
  const pitchedGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  assert.ok(pitchedGenerations.voices.find((voice) => voice.generation === 1 && voice.rule === "A").rate < 1);
  assert.ok(pitchedGenerations.voices.find((voice) => voice.generation === 1 && voice.rule === "B").rate > 1);
  assert.match(elements.get("generationPitchReadout").textContent, /-60° → -33\.33% octave · \+60° → \+33\.33% octave/);

  listeners.get("generationPreset-pythagorean:click")();
  const forkedGenerations = generationMessages.filter((message) => message.type === "voices").at(-1);
  const firstFork = forkedGenerations.voices.filter((voice) => voice.generation === 1);
  assert.deepEqual(firstFork.map((voice) => voice.rule), ["A", "B"]);
  assert.equal(elements.get("timeRatioOut").textContent, "0.72× per generation");
  assert.equal(elements.get("generationAngleOut").textContent, "45°");
  assert.equal(elements.get("generationsOut").textContent, "13 / 13");
  assert.equal(elements.get("mutationOut").textContent, "0% rule variance");
  assert.equal(elements.get("depthOut").textContent, "72%");
  assert.equal(elements.get("intervalOut").textContent, "240 ms");

  assert.equal(renderCapacities.length, 1);
  for (let index = 0; index < 4; index += 1) {
    renderCapacities[0].onupdate({
      averageLoad: 0.2,
      peakLoad: 0.3,
      underrunRatio: 0,
    });
  }
  const expandedGenerations = generationMessages
    .filter((message) => message.type === "voices")
    .at(-1);
  assert.equal(expandedGenerations.voiceLimit, 64);
  assert.equal(expandedGenerations.voices.length, 64);
  assert.match(elements.get("generationCapacityInline").textContent, /64 of 1,022 branches active · breadth first pruning · device-adjusted/);
  assert.doesNotMatch(elements.get("generationCapacityInline").textContent, /AUTO|CAP|underrun|guard|load/i);

  for (let index = 0; index < 4; index += 1) {
    renderCapacities[0].onupdate({
      averageLoad: 0.18,
      peakLoad: 0.28,
      underrunRatio: 0,
    });
  }
  const beyondFormerCeiling = generationMessages
    .filter((message) => message.type === "voices")
    .at(-1);
  assert.equal(beyondFormerCeiling.voiceLimit, 80);
  assert.equal(beyondFormerCeiling.voices.length, 80);

  for (let index = 0; index < 2; index += 1) {
    renderCapacities[0].onupdate({
      averageLoad: 0.72,
      peakLoad: 0.9,
      underrunRatio: 0,
    });
  }
  const rolledBackGenerations = generationMessages
    .filter((message) => message.type === "voices")
    .at(-1);
  assert.equal(rolledBackGenerations.voiceLimit, 64);
  assert.equal(rolledBackGenerations.voices.length, 64);
  assert.match(elements.get("generationCapacityInline").textContent, /64 of 1,022 branches active · breadth first pruning · device-adjusted/);

  assert.equal(
    workletNodes.some((node) => node.name === "morphazoid-mic-branches"),
    false,
    "Recursive Bounce is no longer part of L-mic",
  );

  listeners.get("generationPreset-binary:click")();
  assert.equal(elements.get("generationsOut").textContent, "9 / 13");
  assert.equal(elements.get("depthOut").textContent, "68%");
  assert.equal(elements.get("intervalOut").textContent, "85 ms");
  assert.equal(elements.get("generationAngleOut").textContent, "30°");
  assert.match(elements.get("generationPresetDescription").textContent, /halves its timing/);
  assert.equal(attributes.get("generationPreset-binary:aria-pressed"), "true");

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
  elements.get("interval").value = String(sliderFromTimeFold(500));
  listeners.get("interval:input")();
  assert.equal(elements.get("intervalOut").textContent, "500 ms");
  assert.equal(elements.get("generationTimingReadout").textContent, "500 ms → 250 ms → 125 ms → 63 ms … 0.98 ms at G9");
  assert.equal(attributes.get("generationPreset-binary:aria-pressed"), "false");
  assert.equal(elements.get("presetSummary").textContent, "Custom growth · Maximum");
  assert.equal(elements.get("recursionSummary").textContent, "Custom growth · 9 generations");
  assert.ok(Math.abs(delays[0].delayTime.value - 0.5) < 1e-9);
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

  audioContexts[0].playbackStats = {
    underrunEvents: 1,
    underrunDuration: 0.01,
  };
  audioContexts[0].currentTime = 2;
  queuedFrame(performance.now() + 230);
  const underrunRollback = directNode.port.messages
    .filter((message) => message.type === "voices")
    .at(-1);
  assert.ok(underrunRollback.voiceLimit <= 48);
  assert.equal(underrunRollback.voices.length, underrunRollback.voiceLimit);
  assert.match(elements.get("generationCapacityInline").textContent, /\d+ of 510 branches active · breadth first pruning · device-adjusted/);
  assert.doesNotMatch(elements.get("generationCapacityInline").textContent, /underrun|rollback|rechecking/i);

  listeners.get("audioButton:click")();
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(stoppedTracks, 1);
  assert.equal(elements.get("pitchDetail").disabled, false);
  const firstAudioContext = audioContexts[0];
  assert.equal(firstAudioContext.state, "running");
  signalsmithReadyEnabled = true;
  pendingSignalsmithNodes.splice(0).forEach(readySignalsmithNode);
  elements.get("pitchDetail").value = "16";
  listeners.get("pitchDetail:change")({
    currentTarget: elements.get("pitchDetail"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements.get("pitchDetailStatus").textContent, /16 shifted lanes/i);
  assert.equal(
    firstAudioContext.state,
    "closed",
    "changing a stopped fixed pitch pool must retire its old AudioContext",
  );
  const firstSignalsmithNodes = workletNodes.filter((node) => (
    node.context === firstAudioContext && node.name === "signalsmith-stretch"
  ));
  assert.equal(
    firstSignalsmithNodes.length,
    0,
    "the retired default Economy context must not contain Signalsmith lanes",
  );
  assert.equal(audioContexts.length, 1, "Pitch Detail should wait for Start before creating a new graph");
  assert.equal(microphoneRequests, 1, "changing a stopped renderer must not request the microphone");
  assert.equal(stoppedTracks, 1, "changing a stopped renderer must not implicitly stop the microphone again");

  listeners.get("audioButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audioContexts.length, 2, "the next Start should create the selected pitch-detail graph");
  assert.equal(microphoneRequests, 2);
  assert.equal(stoppedTracks, 1, "starting the replacement graph must not add an implicit microphone stop");
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("pitchDetail").value, "16");
  assert.equal(elements.get("pitchDetail").disabled, true);

  listeners.get("audioButton:click")();
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(stoppedTracks, 2);

  const secondAudioContext = audioContexts[1];
  const signalsmithCountBeforeEconomy = workletNodes.filter((node) => (
    node.name === "signalsmith-stretch"
  )).length;
  elements.get("pitchDetail").value = "24";
  listeners.get("pitchDetail:change")({
    currentTarget: elements.get("pitchDetail"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondAudioContext.state, "closed");
  const retiredSignalsmithNodes = workletNodes.filter((node) => (
    node.context === secondAudioContext && node.name === "signalsmith-stretch"
  ));
  assert.equal(retiredSignalsmithNodes.length, 16);
  assert.ok(retiredSignalsmithNodes.every((node) => (
    node.port.messages.some((message) => Array.isArray(message) && message[1] === "stop")
  )), "every stopped Silky lane must be explicitly released");
  assert.equal(elements.get("pitchDetail").value, "24");
  assert.match(elements.get("pitchDetailStatus").textContent, /Maximum economy.*0 active shifted pitches/i);
  assert.equal(audioContexts.length, 2, "selecting Economy must wait for the next Start");
  assert.equal(microphoneRequests, 2);

  listeners.get("audioButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audioContexts.length, 3);
  assert.equal(microphoneRequests, 3);
  const economyContext = audioContexts[2];
  const economyNodes = workletNodes.filter((node) => (
    node.context === economyContext
    && node.name === "morphazoid-micmic-generations"
  ));
  assert.equal(economyNodes.length, 1, "Economy must use one fused granular worklet");
  assert.equal(economyNodes[0].options.numberOfOutputs, 1);
  assert.equal(
    economyNodes[0].options.processorOptions.renderer,
    "granular-economy",
  );
  assert.equal(
    workletNodes.filter((node) => (
      node.context === economyContext && node.name === "signalsmith-stretch"
    )).length,
    0,
    "Economy must not allocate any Signalsmith pitch processors",
  );
  assert.equal(
    workletNodes.filter((node) => node.name === "signalsmith-stretch").length,
    signalsmithCountBeforeEconomy,
  );
  assert.equal(
    workletNodes.filter((node) => (
      node.context === economyContext
      && node.name === "morphazoid-signalsmith-generation-mixer"
    )).length,
    0,
    "Economy must not allocate the long per-pitch history mixer",
  );
  const economyVoiceMessage = economyNodes[0].port.messages
    .filter((message) => message.type === "voices" && message.voices.length > 0)
    .at(-1);
  assert.ok(economyVoiceMessage);
  assert.ok(
    economyVoiceMessage.voices.length > 24,
    "24 pitch classes must still carry more than 24 audible branches",
  );
  assert.ok(
    new Set(
      economyVoiceMessage.voices
        .filter((voice) => Math.abs(voice.rate - 1) > 0.0001)
        .map((voice) => voice.rate),
    ).size <= 24,
  );
  assert.match(elements.get("pitchDetailStatus").textContent, /Maximum economy.*\d+ active shifted pitches/i);
  economyNodes[0].port.emit({
    type: "render-load",
    supported: true,
    timing: "high-res",
    averageLoad: 0.16,
    peakLoad: 0.28,
    renderer: "granular-economy",
    activeVoices: economyVoiceMessage.voices.length,
    renderedVoices: economyVoiceMessage.voices.length,
    requestedVoices: economyVoiceMessage.requestedVoiceCount,
    voiceLimit: economyVoiceMessage.voiceLimit,
  });
  assert.match(elements.get("generationCapacityInline").textContent, /\d+ of 510 branches active · breadth first pruning · device-adjusted/);

  economyNodes[0].onprocessorerror();
  assert.match(elements.get("pitchDetailStatus").textContent, /bounded audio fallback/i);

  listeners.get("audioButton:click")();
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(stoppedTracks, 3);
});
