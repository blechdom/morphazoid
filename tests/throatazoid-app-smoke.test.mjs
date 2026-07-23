import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Throatazoid renders, awakens mic and glottis sources, and mutates specimens", async (t) => {
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
      getAttribute(name) { return attributes.get(`${id}:${name}`) ?? null; },
      removeAttribute(name) {
        attributes.delete(`${id}:${name}`);
        if (name === "href") this.href = "";
      },
      closest() { return null; },
      querySelector() { return null; },
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

  const sourceButtons = [...html.matchAll(/<button[^>]+data-source="([^"]+)"[^>]*>/g)]
    .map((match) => {
      const source = match[1];
      return {
        dataset: { source },
        addEventListener(type, listener) {
          listeners.set(`source-${source}:${type}`, listener);
        },
        setAttribute(name, value) {
          attributes.set(`source-${source}:${name}`, String(value));
        },
        getAttribute(name) {
          return attributes.get(`source-${source}:${name}`) ?? null;
        },
        closest(selector) {
          return selector === "[data-source]" ? this : null;
        },
      };
    });
  elements.get("sourceButtons").querySelectorAll = (selector) => (
    selector === "[data-source]" ? sourceButtons : []
  );

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
  const originalGlobals = new Map();
  for (const name of [
    "AudioContext",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "ResizeObserver",
    "cancelAnimationFrame",
    "document",
    "navigator",
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
      exponentialRampToValueAtTime(next) { this.value = next; },
      linearRampToValueAtTime(next) { this.value = next; },
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
  const bufferSources = [];
  const periodicWaves = [];
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
        detune: audioParam(0),
        setPeriodicWave(wave) { this.periodicWave = wave; },
        start() {},
        stop() {},
      });
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
        loop: false,
        playbackRate: audioParam(1),
        start() { this.started = true; },
        stop() { this.stopped = true; },
      });
      bufferSources.push(source);
      return source;
    }
    createPeriodicWave(real, imaginary, options = {}) {
      const wave = { real, imaginary, options };
      periodicWaves.push(wave);
      return wave;
    }
    createMediaStreamDestination() { return audioNode({ stream: { id: "processed" } }); }
    createMediaStreamSource() { return audioNode(); }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  };

  let requestedConstraints = null;
  let getUserMediaCalls = 0;
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
          getUserMediaCalls += 1;
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
  assert.deepEqual(sourceButtons.map((button) => button.dataset.source), [
    "mic",
    "glottis",
    "hybrid",
  ]);

  function selectSource(source) {
    const button = sourceButtons.find((candidate) => candidate.dataset.source === source);
    assert.ok(button, `missing ${source} source button`);
    const direct = listeners.get(`source-${source}:click`);
    const delegated = listeners.get("sourceButtons:click");
    assert.ok(direct || delegated, `missing source listener for ${source}`);
    if (direct) direct({ currentTarget: button, target: button });
    else delegated({ currentTarget: elements.get("sourceButtons"), target: button });
  }

  selectSource("glottis");
  listeners.get("awakenButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(contexts.length, 1);
  assert.equal(getUserMediaCalls, 0, "the internal glottis must not request microphone access");
  assert.equal(requestedConstraints, null);
  assert.ok(periodicWaves.length >= 1, "the glottis should build a periodic vocal waveform");
  assert.ok(bufferSources.length >= 1, "the glottis should build its breath-noise source");
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("stateMetric").textContent, "awake");
  assert.ok(analysers.length >= 3);

  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(stopped, 0, "stopping the internal glottis should not touch a media track");

  selectSource("mic");
  listeners.get("awakenButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getUserMediaCalls, 1);
  const constraintValue = (value) => (
    typeof value === "object" && value !== null ? value.ideal : value
  );
  assert.equal(constraintValue(requestedConstraints.audio.echoCancellation), false);
  assert.equal(constraintValue(requestedConstraints.audio.noiseSuppression), false);
  assert.equal(constraintValue(requestedConstraints.audio.autoGainControl), false);
  assert.equal(elements.get("audioState").textContent, "on");

  listeners.get("specimen-hive:click")();
  assert.equal(elements.get("throatCount").value, "5");
  assert.equal(elements.get("anatomySummary").textContent, "Hive · 5 throats");
  assert.equal(attributes.get("specimen-hive:aria-pressed"), "true");

  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.ok(stopped >= 1);
});
