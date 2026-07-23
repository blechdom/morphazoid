import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Throatazoid renders, awakens the mic graph, and mutates specimens", async () => {
  const html = await readFile(new URL("../throatazoid.html", import.meta.url), "utf8");
  const tags = new Map(
    [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map((match) => [match[1], match[0]]),
  );
  const elements = new Map();
  const listeners = new Map();
  const documentListeners = new Map();
  const attributes = new Map();

  function classList() {
    const classes = new Set();
    return {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains(name) { return classes.has(name); },
    };
  }

  function initialValue(tag) {
    return tag?.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
  }

  function element(id) {
    const tag = tags.get(id) ?? "";
    const node = {
      id,
      value: initialValue(tag),
      textContent: "",
      hidden: /\bhidden\b/.test(tag),
      disabled: /\bdisabled\b/.test(tag),
      open: false,
      href: "",
      download: "",
      dataset: {},
      style: {},
      classList: classList(),
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      removeAttribute(name) {
        attributes.delete(`${id}:${name}`);
        if (name === "href") this.href = "";
      },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 940, height: 610 }; },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
    elements.set(id, node);
    return node;
  }

  for (const id of tags.keys()) element(id);

  const specimenButtons = [...html.matchAll(/<button[^>]+data-specimen="([^"]+)"[^>]*>/g)]
    .map((match) => {
      const button = {
        dataset: { specimen: match[1] },
        addEventListener(type, listener) {
          listeners.set(`specimen-${match[1]}:${type}`, listener);
        },
        setAttribute(name, value) {
          attributes.set(`specimen-${match[1]}:${name}`, String(value));
        },
      };
      return button;
    });
  elements.get("specimenButtons").querySelectorAll = () => specimenButtons;

  let strokes = 0;
  let fills = 0;
  const context = {
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() { fills += 1; },
    lineTo() {},
    moveTo() {},
    restore() {},
    rotate() {},
    save() {},
    setTransform() {},
    stroke() { strokes += 1; },
    translate() {},
  };
  elements.get("stage").getContext = () => context;
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 940, height: 610 });

  let queuedFrame = null;
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    frameId += 1;
    return frameId;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
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

  const contexts = [];
  const analysers = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "running";
      this.destination = audioNode();
      contexts.push(this);
    }
    addEventListener() {}
    createGain() { return audioNode({ gain: audioParam(0) }); }
    createBiquadFilter() {
      return audioNode({
        type: "lowpass",
        frequency: audioParam(0),
        Q: audioParam(0),
        gain: audioParam(0),
      });
    }
    createWaveShaper() { return audioNode({ curve: null, oversample: "none" }); }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createAnalyser() {
      const analyser = audioNode({
        fftSize: 2048,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(samples) { samples.fill(0.02); },
      });
      analysers.push(analyser);
      return analyser;
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
    createOscillator() {
      return audioNode({
        type: "sine",
        frequency: audioParam(0),
        start() {},
        stop() {},
      });
    }
    createMediaStreamDestination() { return audioNode({ stream: { id: "processed" } }); }
    createMediaStreamSource() { return audioNode(); }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  };

  let requestedConstraints = null;
  let stopped = 0;
  const track = {
    addEventListener() {},
    stop() { stopped += 1; },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          requestedConstraints = constraints;
          return {
            getAudioTracks: () => [track],
            getTracks: () => [track],
          };
        },
      },
    },
  });

  await import(`../throatazoid-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  queuedFrame(performance.now() + 100);
  assert.ok(strokes > 15, "the dormant alien anatomy should have visible structure");
  assert.ok(fills > 5, "the organism should render solid black chambers");
  assert.equal(elements.get("stageReadout").textContent, "DORMANT · TRIUNE · 3 THROATS");
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(elements.get("stage").width, 940);
  assert.equal(elements.get("stage").height, 610);

  listeners.get("awakenButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(contexts.length, 1);
  assert.equal(requestedConstraints.audio.echoCancellation.ideal, true);
  assert.equal(requestedConstraints.audio.noiseSuppression.ideal, false);
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("stateMetric").textContent, "awake");
  assert.ok(analysers.length >= 3);

  listeners.get("specimen-hive:click")();
  assert.equal(elements.get("throatCount").value, "5");
  assert.equal(elements.get("anatomySummary").textContent, "Hive · 5 throats");
  assert.equal(attributes.get("specimen-hive:aria-pressed"), "true");

  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.ok(stopped >= 1);
});
