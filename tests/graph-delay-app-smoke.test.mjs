import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GRAPH_DELAY_PATCHES } from "../src/graph-delay.js";

test("graph-delay safely coalesces presets, rolls back failed builds, and rejects unsafe graphs", async () => {
  const html = await readFile(new URL("../graph-delay.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();

  for (const id of ids) {
    elements.set(id, {
      id,
      value: "",
      textContent: "",
      hidden: id === "audioError",
      disabled: false,
      style: {},
      classList: { add() {}, remove() {} },
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
      focus() {},
    });
  }
  elements.get("stage").getContext = () => ({ setTransform() {} });

  let queuedFrame = null;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    return 1;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = (type, listener) => windowListeners.set(type, listener);
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let nextTimerId = 1;
  const timers = new Map();
  globalThis.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const runNextTimer = (delay) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `expected a ${delay} ms timer`);
    timers.delete(entry[0]);
    entry[1].callback();
  };
  const runAllTimers = () => {
    while (timers.size) {
      const [id, timer] = [...timers][0];
      timers.delete(id);
      timer.callback();
    }
  };

  const audioParam = (value = 0) => ({
    value,
    cancelAndHoldAtTime() {},
    cancelScheduledValues() {},
    linearRampToValueAtTime(next) { this.value = next; },
    setTargetAtTime(next) { this.value = next; },
    setValueAtTime(next) { this.value = next; },
  });
  const audioNodes = [];
  const audioNode = (properties = {}) => {
    const node = {
      ...properties,
      disconnected: false,
      connect(destination) { return destination; },
      disconnect() { this.disconnected = true; },
    };
    audioNodes.push(node);
    return node;
  };
  const worklets = [];
  let workletConstructionCount = 0;
  let failAtWorklet = Infinity;
  globalThis.AudioWorkletNode = class {
    constructor() {
      workletConstructionCount += 1;
      if (workletConstructionCount === failAtWorklet) {
        throw new Error("injected worklet construction failure");
      }
      this.disconnected = false;
      this.port = {
        closed: false,
        postMessage() {},
        close() { this.closed = true; },
      };
      worklets.push(this);
    }
    connect(destination) { return destination; }
    disconnect() { this.disconnected = true; }
  };

  const tracks = [];
  const stream = {
    getTracks() { return tracks; },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          const track = { stopped: false, stop() { this.stopped = true; } };
          tracks.push(track);
          return stream;
        },
      },
    },
  });

  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
      this.audioWorklet = { async addModule() {} };
    }
    createGain() { return audioNode({ gain: audioParam(1) }); }
    createDelay() { return audioNode({ kind: "delay", delayTime: audioParam(0) }); }
    createBiquadFilter() {
      return audioNode({ frequency: audioParam(0), Q: audioParam(0), type: "lowpass" });
    }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createAnalyser() {
      return audioNode({
        fftSize: 1024,
        getFloatTimeDomainData(array) { array.fill(0); },
      });
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
    createWaveShaper() { return audioNode({ curve: null, oversample: "none" }); }
    createMediaStreamSource() { return audioNode(); }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  try {
    await import(`../graph-delay-app.js?smoke=${Date.now()}`);
    assert.equal(typeof queuedFrame, "function");

    listeners.get("audioButton:click")();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(elements.get("audioState").textContent, "live");
    assert.ok(worklets.length > 0);
    assert.equal(
      audioNodes.filter((node) => node.kind === "delay").length,
      13,
      "default graph should allocate edge and microphone-entry delays, but no speaker delay",
    );
    let speakerPrevented = false;
    listeners.get("stage:pointerdown")({
      clientX: 826,
      clientY: 300,
      pointerId: 1,
      preventDefault() { speakerPrevented = true; },
    });
    assert.equal(speakerPrevented, false, "the fixed speaker terminal must not begin a drag");

    const initialSelectedTime = elements.get("selectedTimeOut").textContent;
    listeners.get("stage:pointerdown")({
      clientX: 152,
      clientY: 207,
      pointerId: 2,
      preventDefault() {},
    });
    listeners.get("stage:pointermove")({
      clientX: 450,
      clientY: 300,
      pointerId: 2,
      preventDefault() {},
    });
    listeners.get("stage:pointerup")({ pointerId: 2 });
    assert.notEqual(elements.get("selectedTimeOut").textContent, initialSelectedTime);
    elements.get("graphPatch").value = "layeredGlass";
    listeners.get("graphPatch:change")({ currentTarget: elements.get("graphPatch") });
    runNextTimer(120);
    assert.equal(
      elements.get("selectedTimeOut").textContent,
      initialSelectedTime,
      "reloading a preset should restore its geometry even when its edge routing is unchanged",
    );
    runAllTimers();

    const patchNames = Object.keys(GRAPH_DELAY_PATCHES);
    for (let index = 0; index < 40; index += 1) {
      const name = patchNames[index % patchNames.length];
      elements.get("graphPatch").value = name;
      listeners.get("graphPatch:change")({ currentTarget: elements.get("graphPatch") });
    }
    assert.equal([...timers.values()].filter((timer) => timer.delay === 120).length, 1);
    runNextTimer(120);
    runAllTimers();
    const finalPatch = GRAPH_DELAY_PATCHES[patchNames[(40 - 1) % patchNames.length]];
    assert.equal(elements.get("graphPatch").value, patchNames[(40 - 1) % patchNames.length]);
    assert.match(elements.get("topologySummary").textContent, new RegExp(finalPatch.label));
    assert.equal(elements.get("audioError").hidden, true);

    const stableStructure = elements.get("structureReadout").textContent;
    const stableTopology = elements.get("topology").value;
    const stablePatchName = elements.get("graphPatch").value;
    const stableBaseDelay = elements.get("baseDelay").value;
    const stablePitchScale = elements.get("pitchScale").value;
    const stableNodePass = elements.get("nodePass").value;
    const workletsBeforeFailure = worklets.length;
    failAtWorklet = workletConstructionCount + 3;
    elements.get("graphPatch").value = "branchChoir";
    listeners.get("graphPatch:change")({ currentTarget: elements.get("graphPatch") });
    runNextTimer(120);
    assert.equal(elements.get("graphPatch").value, stablePatchName);
    assert.equal(elements.get("topology").value, stableTopology);
    assert.equal(elements.get("baseDelay").value, stableBaseDelay);
    assert.equal(elements.get("pitchScale").value, stablePitchScale);
    assert.equal(elements.get("nodePass").value, stableNodePass);
    assert.equal(elements.get("structureReadout").textContent, stableStructure);
    assert.match(elements.get("audioError").textContent, /injected worklet construction failure/);
    assert.equal(elements.get("audioError").hidden, false);
    assert.ok(
      worklets.slice(workletsBeforeFailure).every(
        (worklet) => worklet.disconnected && worklet.port.closed,
      ),
      "partially built worklets should be disconnected and closed",
    );

    failAtWorklet = Infinity;
    elements.get("topology").value = "random";
    listeners.get("topology:change")({ currentTarget: elements.get("topology") });
    elements.get("nodeCount").value = "24";
    listeners.get("nodeCount:input")({ currentTarget: elements.get("nodeCount") });
    elements.get("density").value = "1";
    listeners.get("density:input")({ currentTarget: elements.get("density") });
    listeners.get("density:change")();
    assert.equal(elements.get("structureReadout").textContent, stableStructure);
    assert.match(elements.get("audioError").textContent, /exceed the live safety limit of 192/);
    assert.equal(elements.get("topology").value, stableTopology);

    listeners.get("panicButton:click")();
    assert.equal(elements.get("audioState").textContent, "off");
    assert.ok(tracks.every((track) => track.stopped));

    let resolveLateStream;
    const lateTrack = { stopped: false, stop() { this.stopped = true; } };
    const lateStream = { getTracks() { return [lateTrack]; } };
    globalThis.navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
      resolveLateStream = resolve;
    });
    listeners.get("audioButton:click")();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(elements.get("audioState").textContent, "starting");
    listeners.get("panicButton:click")();
    resolveLateStream(lateStream);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lateTrack.stopped, true, "a permission result arriving after panic must be stopped");
    assert.equal(elements.get("audioState").textContent, "off");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
