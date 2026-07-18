import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Lumber renders, records new rings, and explicitly replaces", async () => {
  const html = await readFile(new URL("../lumber.html", import.meta.url), "utf8");
  const tags = new Map(
    [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map((match) => [match[1], match[0]]),
  );
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
      hidden: /\bhidden\b/.test(tags.get(id) ?? ""),
      disabled: /\bdisabled\b/.test(tags.get(id) ?? ""),
      dataset: {},
      style: {},
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        toggle(name, force) {
          const next = force === undefined ? !classes.has(name) : Boolean(force);
          if (next) classes.add(name);
          else classes.delete(name);
          return next;
        },
      },
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
      setPointerCapture() {},
      focus() {},
    };
    elements.set(id, node);
    return node;
  }

  for (const id of tags.keys()) element(id);
  const groups = {
    shapePreset: ["circlePreset", "trianglePreset", "squarePreset"],
    ringDirection: ["rotateLeft", "rotateRight"],
    recordBacking: ["backingOff", "backingOn"],
    timeMode: ["timeNative", "timeLocal"],
    viewMode: ["viewFlat", "viewThreeD"],
  };
  const values = {
    circlePreset: "circle",
    trianglePreset: "triangle",
    squarePreset: "square",
    rotateLeft: "-1",
    rotateRight: "1",
    backingOff: "off",
    backingOn: "on",
    timeNative: "native",
    timeLocal: "local",
    viewFlat: "flat",
    viewThreeD: "3d",
  };
  for (const [id, value] of Object.entries(values)) elements.get(id).dataset.value = value;
  for (const [id, children] of Object.entries(groups)) {
    elements.get(id).querySelectorAll = () => children.map((child) => elements.get(child));
  }

  let arcs = 0;
  const drawingContext = {
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    fillText() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
    arc() { arcs += 1; },
  };
  elements.get("stage").getContext = () => drawingContext;
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 900, height: 600 });

  let queuedFrame;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    return 1;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  const documentListeners = new Map();
  globalThis.document = {
    hidden: false,
    body: { dataset: { lumberMode: "expanded" } },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const windowListeners = new Map();
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };

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

  const processors = [];
  const sources = [];
  const gains = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "running";
      this.destination = audioNode();
    }
    createGain() {
      const gain = audioNode({ gain: audioParam(0) });
      gains.push(gain);
      return gain;
    }
    createMediaStreamSource() { return audioNode(); }
    createScriptProcessor() {
      const processor = audioNode({ onaudioprocess: null });
      processors.push(processor);
      return processor;
    }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        duration: length / sampleRate,
        sampleRate,
        copyToChannel(input, channel) { data[channel].set(input); },
      };
    }
    createBufferSource() {
      const source = audioNode({
        buffer: null,
        loop: false,
        playbackRate: audioParam(1),
        startCalls: [],
        start(...args) { this.startCalls.push(args); },
        stop() {},
        onended: null,
      });
      sources.push(source);
      return source;
    }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  };

  let stoppedTracks = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          const track = { stop() { stoppedTracks += 1; }, addEventListener() {} };
          return { getTracks: () => [track] };
        },
      },
    },
  });
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };

  await import(`../lumber-app.js?smoke=${Date.now()}`);
  queuedFrame(performance.now() + 16);
  assert.ok(arcs >= 12, "the empty default contour and vertices must render");
  assert.equal(elements.get("vertexCountOut").textContent, "12 vertices");
  assert.match(elements.get("stageReadout").textContent, /EMPTY RING/);

  const input = Float32Array.from(
    { length: 2_048 },
    (_, index) => Math.sin(index / 17) * 0.5,
  );
  async function recordWith(processorIndex, trigger = "recordButton") {
    listeners.get(`${trigger}:click`)();
    await new Promise((resolve) => setImmediate(resolve));
    for (let index = 0; index < 4; index += 1) {
      processors[processorIndex].onaudioprocess({
        inputBuffer: { getChannelData: () => input },
      });
    }
    listeners.get("recordButton:click")();
    await new Promise((resolve) => setImmediate(resolve));
  }

  await recordWith(0);
  assert.equal(elements.get("activeRingOut").textContent, "Ring 1 of 1");
  assert.equal(elements.get("durationOut").textContent, "0.17 s");
  assert.equal(sources[0].playbackRate.value, 1);

  await recordWith(1);
  assert.equal(elements.get("activeRingOut").textContent, "Ring 2 of 2");
  assert.match(elements.get("ringList").innerHTML, /#e8c46b/i);
  assert.match(elements.get("ringList").innerHTML, /#5fe8c4/i);
  assert.ok(sources.every((source) => source.playbackRate.value === 1));

  const ringCountBeforeReplace = elements.get("activeRingOut").textContent;
  await recordWith(2, "replaceRing");
  assert.equal(elements.get("activeRingOut").textContent, ringCountBeforeReplace);
  assert.equal(stoppedTracks, 3);

  listeners.get("timeLocal:click")();
  assert.match(elements.get("advancedSummary").textContent, /stretch/);
  elements.get("pitchShift").value = "7";
  listeners.get("pitchShift:input")();
  assert.ok(Math.abs(sources.at(-1).playbackRate.value - 2 ** (7 / 12)) < 1e-12);
  elements.get("pitchShift").value = "0";
  listeners.get("pitchShift:input")();
  listeners.get("timeNative:click")();
  assert.equal(elements.get("advancedSummary").textContent, "native");
  listeners.get("viewThreeD:click")();
  assert.match(elements.get("depthSummary").textContent, /3D/);
  assert.equal(elements.get("ringDepth").disabled, false);
  queuedFrame(performance.now() + 32);
  listeners.get("viewFlat:click")();

  const gesture = (x, y) => ({
    clientX: x,
    clientY: y,
    pointerId: 7,
    button: 0,
    isPrimary: true,
    preventDefault() {},
  });
  listeners.get("playButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  const sourcesBeforeScrub = sources.length;
  listeners.get("stage:pointerdown")(gesture(450, 117));
  listeners.get("stage:pointermove")(gesture(480, 142));
  listeners.get("stage:pointerup")(gesture(480, 142));
  assert.match(elements.get("liveStatus").textContent, /two dimensions/);

  await new Promise((resolve) => setTimeout(resolve, 30));
  listeners.get("stage:pointerdown")(gesture(497, 123));
  listeners.get("stage:pointermove")(gesture(579, 171));
  listeners.get("stage:pointerup")(gesture(579, 171));
  assert.ok(sources.length > sourcesBeforeScrub, "paused contour drag must create scrub audio");

  const ringAction = (action, ringId = 2) => listeners.get("ringList:click")({
    target: {
      closest() {
        return { disabled: false, dataset: { ringAction: action, ringId: String(ringId) } };
      },
    },
  });
  ringAction("mute");
  assert.match(elements.get("ringList").innerHTML, /muted/);
  ringAction("mute");
  ringAction("solo");
  assert.match(elements.get("ringList").innerHTML, /solo/);
  ringAction("solo");
  ringAction("delete");
  assert.equal(elements.get("activeRingOut").textContent, "Ring 1 of 1");
  listeners.get("clearAllRings:click")();
  assert.equal(elements.get("playButton").disabled, true);
  assert.match(elements.get("stageReadout").textContent, /EMPTY RING/);
  assert.ok(documentListeners.has("visibilitychange"));
  assert.ok(windowListeners.has("pagehide"));
  assert.ok(gains[1].gain.value === 0, "microphone input must remain unmonitored");
});
