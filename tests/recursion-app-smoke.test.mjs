import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SYSTEM_IDS = [
  "ouroboros-tape",
  "spectral-mobius",
  "filter-hydra",
  "cantor-delay",
  "convolution-maw",
  "phase-labyrinth",
];

const SYSTEM_TITLES = new Map([
  ["ouroboros-tape", "Ouroboros Tape"],
  ["spectral-mobius", "Spectral Möbius Furnace"],
  ["filter-hydra", "Filter-Bank Hydra"],
  ["cantor-delay", "Cantor Delay Weather"],
  ["convolution-maw", "Self-Convolution Maw"],
  ["phase-labyrinth", "Phase Labyrinth"],
]);

test("recursion app initializes, draws, switches systems, and drives bounded controls", async (t) => {
  const html = await readFile(new URL("../recursion.html", import.meta.url), "utf8");
  const tags = new Map(
    [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)]
      .map((match) => [match[1], match[0]]),
  );
  const elements = new Map();
  const listeners = new Map();

  function attribute(tag, name) {
    return tag?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
  }

  function classList() {
    const values = new Set();
    return {
      add(name) { values.add(name); },
      remove(name) { values.delete(name); },
      contains(name) { return values.has(name); },
      toggle(name, force) {
        const active = force === undefined ? !values.has(name) : Boolean(force);
        if (active) values.add(name);
        else values.delete(name);
        return active;
      },
    };
  }

  function element(id) {
    const tag = tags.get(id) ?? "";
    const attributes = new Map();
    const node = {
      id,
      value: attribute(tag, "value"),
      textContent: "",
      innerHTML: "",
      hidden: /\bhidden(?:\s|>)/.test(tag),
      disabled: /\bdisabled(?:\s|>)/.test(tag),
      files: [],
      dataset: {},
      style: {},
      attributes,
      classList: classList(),
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      focus() { this.focused = true; },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of tags.keys()) element(id);

  function delegatedButton(dataset) {
    const attributes = new Map();
    return {
      dataset,
      attributes,
      tabIndex: 0,
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      closest(selector) {
        if (selector === "[data-study]" && dataset.study) return this;
        if (selector === "[data-source]" && dataset.source) return this;
        return null;
      },
      focus() { this.focused = true; },
    };
  }

  const studyButtons = [
    ...html.matchAll(/<button\b[^>]*\bdata-study="([^"]+)"[^>]*>/g),
  ].map((match) => delegatedButton({ study: match[1] }));
  elements.get("studyButtons").querySelectorAll = (selector) => (
    selector === "[data-study]" ? studyButtons : []
  );
  elements.get("studyButtons").querySelector = (selector) => {
    const id = selector.match(/\[data-study="([^"]+)"\]/)?.[1];
    return studyButtons.find((button) => button.dataset.study === id) ?? null;
  };

  const sourceButtons = [
    ...html.matchAll(/<button\b[^>]*\bdata-source="([^"]+)"[^>]*>/g),
  ].map((match) => delegatedButton({ source: match[1] }));
  elements.get("sourceButtons").querySelectorAll = (selector) => (
    selector === "[data-source]" ? sourceButtons : []
  );

  const accumulateCopy = {
    b: { textContent: "" },
    small: { textContent: "" },
  };
  elements.get("accumulateButton").querySelector = (selector) => (
    accumulateCopy[selector] ?? null
  );

  let paths = 0;
  let fills = 0;
  const drawingContext = {
    arc() {},
    beginPath() { paths += 1; },
    clearRect() {},
    closePath() {},
    fill() { fills += 1; },
    fillRect() { fills += 1; },
    fillText() {},
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

  let queuedFrame = null;
  let frameId = 0;
  const documentListeners = new Map();
  const originalGlobals = new Map();
  for (const name of [
    "AudioContext",
    "ResizeObserver",
    "devicePixelRatio",
    "document",
    "requestAnimationFrame",
  ]) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  t.after(() => {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    frameId += 1;
    return frameId;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.devicePixelRatio = 2;
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };

  function audioParam(value = 0) {
    return {
      value,
      cancelScheduledValues() {},
      exponentialRampToValueAtTime(next) { this.value = next; },
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

  const contexts = [];
  const bufferSources = [];
  const filters = [];
  const delays = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 4_000;
      this.state = "running";
      this.destination = audioNode();
      contexts.push(this);
    }
    createGain() { return audioNode({ gain: audioParam(0) }); }
    createBiquadFilter() {
      const filter = audioNode({
        type: "lowpass",
        frequency: audioParam(0),
        Q: audioParam(0),
      });
      filters.push(filter);
      return filter;
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
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createDelay() {
      const delay = audioNode({ delayTime: audioParam(0) });
      delays.push(delay);
      return delay;
    }
    createBuffer(numberOfChannels, length, sampleRate) {
      const channels = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(length),
      );
      return {
        numberOfChannels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData(channel) { return channels[channel]; },
      };
    }
    createBufferSource() {
      const source = audioNode({
        buffer: null,
        onended: null,
        playbackRate: audioParam(1),
        start() { this.started = true; },
        stop() { this.stopped = true; },
      });
      bufferSources.push(source);
      return source;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  function flushFrame(now = performance.now()) {
    assert.equal(typeof queuedFrame, "function", "expected an animation frame");
    const callback = queuedFrame;
    queuedFrame = null;
    callback(now);
  }

  await import(`../recursion-app.js?smoke=${Date.now()}`);
  flushFrame();

  assert.equal(canvas.width, 1_800);
  assert.equal(canvas.height, 1_200);
  assert.ok(paths > 5, "the default Ouroboros score should draw");
  assert.ok(fills > 0, "the active generation marker should draw");
  assert.equal(elements.get("stageTitle").textContent, "Ouroboros Tape");
  assert.equal(elements.get("stageIndex").textContent, "SYSTEM 01 / 06");
  assert.match(elements.get("stageReadout").textContent, /TIME-DOMAIN AUTOPHAGY/);
  assert.match(elements.get("timelineTime").textContent, /^0:00 \/ 0:/);
  assert.match(elements.get("depthRail").innerHTML, /G0/);
  assert.equal(studyButtons[0].getAttribute("aria-selected"), "true");
  assert.equal(sourceButtons[0].getAttribute("aria-pressed"), "true");

  for (const id of [
    "spectral-mobius",
    "filter-hydra",
    "cantor-delay",
    "convolution-maw",
    "phase-labyrinth",
    "ouroboros-tape",
  ]) {
    const button = studyButtons.find((candidate) => candidate.dataset.study === id);
    listeners.get("studyButtons:click")({ target: button });
    assert.equal(elements.get("stageTitle").textContent, SYSTEM_TITLES.get(id));
    assert.equal(elements.get("studySelect").value, id);
    flushFrame();
  }
  assert.deepEqual(
    studyButtons.map((button) => button.dataset.study),
    SYSTEM_IDS,
  );

  elements.get("studySelect").value = "phase-labyrinth";
  listeners.get("studySelect:change")({
    currentTarget: elements.get("studySelect"),
  });
  flushFrame();

  elements.get("depth").value = "2";
  listeners.get("depth:input")({ currentTarget: elements.get("depth") });
  assert.equal(elements.get("depthOut").textContent, "2 levels");
  elements.get("pace").value = "2.25";
  listeners.get("pace:input")({ currentTarget: elements.get("pace") });
  assert.equal(elements.get("paceOut").textContent, "2.25 seconds");
  elements.get("transform").value = "14";
  listeners.get("transform:input")({ currentTarget: elements.get("transform") });
  assert.equal(elements.get("transformOut").textContent, "14 ms");
  elements.get("intensity").value = "0.9";
  listeners.get("intensity:input")({ currentTarget: elements.get("intensity") });
  assert.equal(elements.get("intensityOut").textContent, "90% · event horizon");
  elements.get("level").value = "0.33";
  listeners.get("level:input")({ currentTarget: elements.get("level") });
  assert.equal(elements.get("levelOut").textContent, "33%");

  listeners.get("accumulateButton:click")();
  assert.equal(elements.get("accumulateButton").getAttribute("aria-pressed"), "false");
  assert.equal(accumulateCopy.b.textContent, "Current generation only");
  assert.equal(accumulateCopy.small.textContent, "solo the active lineage");
  listeners.get("accumulateButton:click")();
  assert.equal(elements.get("accumulateButton").getAttribute("aria-pressed"), "true");

  listeners.get("overwhelmButton:click")();
  assert.equal(elements.get("depth").value, elements.get("depth").max);
  assert.equal(elements.get("transform").value, elements.get("transform").max);
  assert.match(elements.get("intensityOut").textContent, /^95% · event horizon$/);
  assert.match(elements.get("liveStatus").textContent, /Maximum finite structure/);

  // Bring the graph back to a small, fast phase lineage before exercising audio.
  elements.get("depth").value = "2";
  listeners.get("depth:input")({ currentTarget: elements.get("depth") });
  await listeners.get("listenButton:click")();
  assert.equal(contexts.length, 1);
  assert.equal(elements.get("audioState").textContent, "descending");
  assert.equal(elements.get("listenButton").getAttribute("aria-pressed"), "true");
  contexts[0].currentTime = 0.1;
  flushFrame();
  assert.ok(bufferSources.some((source) => source.started));

  await listeners.get("listenButton:click")();
  assert.equal(elements.get("audioState").textContent, "off");
  await listeners.get("stepButton:click")();
  await listeners.get("stepButton:click")();
  assert.ok(filters.length >= 3, "the first nested chamber should add an allpass filter");
  assert.ok(delays.length >= 1, "the first nested chamber should add a bounded delay");
  const scheduledRates = bufferSources
    .map((source) => source.playbackRate.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  assert.ok(bufferSources.length >= 24, "nested clock motion should schedule a busy grain field");
  assert.ok(
    new Set(scheduledRates.map((value) => value.toFixed(3))).size >= 8,
    "the pitch clock should produce many continuous playback rates",
  );
  assert.ok(
    Math.max(...scheduledRates) / Math.min(...scheduledRates) >= 1.5,
    "recursive pitch motion should span substantially more than one static rate",
  );
  const movingCutoffs = filters
    .map((filter) => filter.frequency.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  assert.ok(
    Math.max(...movingCutoffs) / Math.min(...movingCutoffs) >= 4,
    "the timbre clock should move filters across a broad spectral range",
  );
  assert.match(elements.get("liveStatus").textContent, /Output power normalized/);
});
