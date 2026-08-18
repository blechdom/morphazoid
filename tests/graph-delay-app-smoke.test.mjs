import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GRAPH_DELAY_PATCHES } from "../src/graph-delay.js";

test("graph-delay keeps live settings safe, coalesces transitions, and rolls back failed builds", async () => {
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
  const audioContexts = [];
  let nextTimerId = 1;
  const timers = new Map();
  globalThis.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const advanceAudioTime = (delay) => {
    for (const context of audioContexts) context.currentTime += delay / 1_000;
  };
  const runNextTimer = (delay) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `expected a ${delay} ms timer`);
    timers.delete(entry[0]);
    advanceAudioTime(entry[1].delay);
    entry[1].callback();
  };
  const runAllTimers = () => {
    while (timers.size) {
      const [id, timer] = [...timers]
        .sort((first, second) => first[1].delay - second[1].delay)[0];
      timers.delete(id);
      advanceAudioTime(timer.delay);
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
      audioContexts.push(this);
    }
    createGain() { return audioNode({ gain: audioParam(1) }); }
    createDelay() { return audioNode({ kind: "delay", delayTime: audioParam(0) }); }
    createBiquadFilter() {
      return audioNode({ frequency: audioParam(0), Q: audioParam(0), type: "lowpass" });
    }
    createStereoPanner() { return audioNode({ kind: "panner", pan: audioParam(0) }); }
    createAnalyser() {
      return audioNode({
        kind: "analyser",
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
      audioNodes.filter((node) => node.kind === "analyser").length,
      2,
      "the graph analyser and shared final-output meter should both be present",
    );
    assert.equal(
      audioNodes.filter((node) => node.kind === "delay").length,
      13,
      "default graph should allocate edge and microphone-entry delays, but no speaker delay",
    );
    const initialPans = audioNodes
      .filter((node) => node.kind === "panner")
      .slice(0, 10)
      .map((node) => node.pan.value);
    assert.ok(initialPans.every((pan) => pan === 0));
    assert.match(
      elements.get("structureReadout").textContent,
      /12\/12 routes open · 1 sink tap · 1 speaker route/,
    );
    assert.match(elements.get("graphInfoSummary").textContent, /1 taps?/);

    const delaysBeforeSwitch = audioNodes.filter((node) => node.kind === "delay").length;
    const workletsBeforeSwitch = worklets.length;
    const timersBeforeSwitch = timers.size;
    let switchPrevented = false;
    listeners.get("stage:pointerdown")({
      clientX: 152,
      clientY: 233,
      pointerId: 40,
      preventDefault() { switchPrevented = true; },
    });
    assert.equal(switchPrevented, true);
    assert.match(elements.get("liveStatus").textContent, /Connection 1 → 2 closed/);
    assert.match(elements.get("structureReadout").textContent, /11\/12 routes open/);
    assert.equal(audioNodes.filter((node) => node.kind === "delay").length, delaysBeforeSwitch);
    assert.equal(worklets.length, workletsBeforeSwitch);
    assert.equal(timers.size, timersBeforeSwitch);
    assert.equal(elements.get("audioState").textContent, "live");
    listeners.get("stage:pointerdown")({
      clientX: 152,
      clientY: 326,
      pointerId: 41,
      preventDefault() {},
    });
    assert.match(elements.get("structureReadout").textContent, /10\/12 routes open/);
    assert.equal(elements.get("openAllSwitchesButton").disabled, false);
    listeners.get("openAllSwitchesButton:click")();
    assert.match(elements.get("structureReadout").textContent, /12\/12 routes open/);
    assert.equal(elements.get("openAllSwitchesButton").disabled, true);
    assert.match(elements.get("liveStatus").textContent, /Every graph connection opened/);
    listeners.get("stage:pointerdown")({
      clientX: 152,
      clientY: 233,
      pointerId: 42,
      preventDefault() {},
    });
    assert.match(elements.get("structureReadout").textContent, /11\/12 routes open/);

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
    assert.match(
      elements.get("structureReadout").textContent,
      /11\/12 routes open/,
      "node motion and parameter updates should preserve the played gate state",
    );
    elements.get("graphPatch").value = "layeredGlass";
    listeners.get("graphPatch:change")({ currentTarget: elements.get("graphPatch") });
    runNextTimer(120);
    assert.equal(
      elements.get("selectedTimeOut").textContent,
      initialSelectedTime,
      "reloading a preset should restore its geometry even when its edge routing is unchanged",
    );
    assert.match(
      elements.get("structureReadout").textContent,
      /12\/12 routes open/,
      "loading a graph should reset its connection gates",
    );
    runAllTimers();

    listeners.get("graphPatch-glassCanopy:click")();
    runNextTimer(120);
    assert.equal(elements.get("graphPatch").value, "glassCanopy");
    assert.equal(elements.get("baseDelay").value, String(GRAPH_DELAY_PATCHES.glassCanopy.baseDelay));
    const workletsDuringTransition = worklets.length;
    listeners.get("graphPatch-haloRing:click")();
    assert.equal(worklets.length, workletsDuringTransition);
    assert.match(elements.get("topologySummary").textContent, /updating/);
    runAllTimers();
    assert.equal(elements.get("graphPatch").value, "haloRing");

    listeners.get("graphPatch-hubScatter:click")();
    runNextTimer(120);
    runAllTimers();
    elements.get("nodeCount").value = "24";
    listeners.get("nodeCount:input")({ currentTarget: elements.get("nodeCount") });
    listeners.get("nodeCount:change")();
    assert.match(
      elements.get("structureReadout").textContent,
      /24 nodes · 30 edges · 30\/30 routes open · 23 sink taps · 23 speaker routes · 191 turns/,
    );
    assert.equal(elements.get("audioError").hidden, true);
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

    listeners.get("stage:keydown")({ key: "]", preventDefault() {} });
    listeners.get("stage:keydown")({ key: " ", preventDefault() {} });
    assert.match(elements.get("liveStatus").textContent, /closed/);
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
    assert.match(elements.get("topologySummary").textContent, /previous graph still live/);
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
    assert.match(elements.get("structureReadout").textContent, /24 nodes/);
    assert.match(elements.get("structureReadout").textContent, /density auto-limited from 100%/);
    assert.ok(Number(elements.get("density").value) < 1);
    assert.equal(elements.get("topology").value, "random");
    assert.equal(elements.get("audioError").hidden, true);
    assert.equal(elements.get("audioState").textContent, "live");
    runAllTimers();

    listeners.get("graphResetButton:click")();
    runAllTimers();
    assert.equal(elements.get("graphPatch").value, "layeredGlass");
    assert.equal(elements.get("topology").value, "dag");
    assert.equal(elements.get("audioState").textContent, "live");
    assert.ok(tracks.every((track) => !track.stopped));

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
