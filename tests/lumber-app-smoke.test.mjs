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
    recordBacking: ["backingOff", "backingOn"],
    ringTiming: ["timingFree", "timingSync"],
    ringLength: ["lengthQuarter", "lengthHalf", "lengthFull", "lengthDouble"],
    viewMode: ["viewFlat", "viewThreeD"],
    brushMode: ["brushOff", "brushPaint", "brushErase"],
  };
  const values = {
    circlePreset: "circle",
    trianglePreset: "triangle",
    squarePreset: "square",
    backingOff: "off",
    backingOn: "on",
    timingFree: "free",
    timingSync: "sync",
    lengthQuarter: "0.25",
    lengthHalf: "0.5",
    lengthFull: "1",
    lengthDouble: "2",
    viewFlat: "flat",
    viewThreeD: "3d",
    brushOff: "off",
    brushPaint: "paint",
    brushErase: "erase",
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
  assert.match(elements.get("ringList").innerHTML, /data-ring-action="direction"/);
  assert.match(elements.get("ringList").innerHTML, /data-ring-volume="2"/);
  assert.ok(sources.every((source) => source.playbackRate.value === 1));
  listeners.get("timingSync:click")();
  listeners.get("lengthHalf:click")();
  assert.equal(sources.at(-1).playbackRate.value, 2);
  assert.match(elements.get("advancedSummary").textContent, /sync · 0\.5×/);
  listeners.get("lengthFull:click")();
  listeners.get("timingFree:click")();
  const sourcesBeforeSyncAll = sources.length;
  listeners.get("syncAllRings:click")();
  assert.equal(sources.length, sourcesBeforeSyncAll + 2);
  assert.equal(
    sources.at(-1).startCalls[0][1],
    sources.at(-2).startCalls[0][1],
    "sync all should align every ring to the same phase",
  );
  assert.match(elements.get("advancedSummary").textContent, /sync · 1×/);
  listeners.get("timingFree:click")();
  const sourcesBeforeHeads = sources.length;
  listeners.get("addLoopHead:click")();
  assert.equal(elements.get("headCountOut").textContent, "2 heads");
  assert.equal(elements.get("headOffsetControls").hidden, false);
  assert.equal(elements.get("headOffset1Out").textContent, "50%");
  assert.equal(sources.length, sourcesBeforeHeads + 2);
  assert.notEqual(
    sources.at(-1).startCalls[0][1],
    sources.at(-2).startCalls[0][1],
    "playback heads need distinct phase offsets",
  );
  elements.get("headOffset1").value = "25";
  listeners.get("headOffset1:input")();
  assert.equal(elements.get("headOffset1Out").textContent, "25%");
  const sourcesBeforeHeadMove = sources.length;
  listeners.get("headOffset1:change")();
  assert.equal(sources.length, sourcesBeforeHeadMove + 2);
  assert.notEqual(sources.at(-1).startCalls[0][1], sources.at(-2).startCalls[0][1]);
  listeners.get("removeLoopHead:click")();
  assert.equal(elements.get("headOffsetControls").hidden, true);
  const selectRingWhilePlaying = (ringId) => listeners.get("ringList:pointerdown")({
    target: {
      closest() {
        return { disabled: false, dataset: { ringId: String(ringId) } };
      },
    },
  });
  selectRingWhilePlaying(1);
  assert.equal(elements.get("activeRingOut").textContent, "Ring 1 of 2");
  selectRingWhilePlaying(2);
  assert.equal(elements.get("activeRingOut").textContent, "Ring 2 of 2");

  const ringCountBeforeReplace = elements.get("activeRingOut").textContent;
  await recordWith(2, "replaceRing");
  assert.equal(elements.get("activeRingOut").textContent, ringCountBeforeReplace);
  assert.equal(stoppedTracks, 3);

  assert.match(elements.get("advancedSummary").textContent, /pitch 65%/);
  elements.get("shapePitchDepth").value = "0.8";
  listeners.get("shapePitchDepth:input")();
  listeners.get("shapePitchDepth:change")();
  assert.match(elements.get("advancedSummary").textContent, /pitch 80%/);
  listeners.get("trianglePreset:click")();
  assert.equal(elements.get("vertexCountOut").textContent, "3 vertices");
  listeners.get("squarePreset:click")();
  assert.equal(elements.get("vertexCountOut").textContent, "4 vertices");
  listeners.get("circlePreset:click")();
  assert.equal(elements.get("vertexCountOut").textContent, "12 vertices");
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
  listeners.get("stage:pointerdown")(gesture(450, 143));
  listeners.get("stage:pointermove")(gesture(450, 110));
  listeners.get("stage:pointerup")(gesture(450, 110));
  assert.match(elements.get("liveStatus").textContent, /radially/);

  await new Promise((resolve) => setTimeout(resolve, 30));
  listeners.get("stage:pointerdown")(gesture(497, 123));
  listeners.get("stage:pointermove")(gesture(579, 171));
  listeners.get("stage:pointerup")(gesture(579, 171));
  assert.ok(sources.length > sourcesBeforeScrub, "paused contour drag must create scrub audio");

  listeners.get("brushPaint:click")();
  listeners.get("stage:pointerdown")(gesture(579, 171));
  listeners.get("stage:pointermove")(gesture(565, 155));
  listeners.get("stage:pointerup")(gesture(565, 155));
  assert.match(elements.get("effectsSummary").textContent, /painted/);
  assert.equal(elements.get("stage").style.cursor, "none");
  assert.equal(elements.get("clearAllDelayPaint").disabled, false);
  listeners.get("clearAllDelayPaint:click")();
  assert.match(elements.get("effectsSummary").textContent, /clear/);
  assert.equal(elements.get("clearAllDelayPaint").disabled, true);
  listeners.get("brushOff:click")();
  elements.get("filterTone").value = "0.5";
  listeners.get("filterTone:input")();
  assert.match(elements.get("filterToneOut").textContent, /kHz/);
  elements.get("ringPan").value = "-0.5";
  listeners.get("ringPan:input")();
  assert.equal(elements.get("ringPanOut").textContent, "50% left");
  assert.equal(elements.get("effectsRingOut").textContent, "Ring 2");
  selectRingWhilePlaying(1);
  assert.equal(elements.get("effectsRingOut").textContent, "Ring 1");
  assert.equal(elements.get("ringPanOut").textContent, "center");
  selectRingWhilePlaying(2);
  assert.equal(elements.get("ringPanOut").textContent, "50% left");

  const ringAction = (action, ringId = 2) => listeners.get("ringList:click")({
    target: {
      closest() {
        return { disabled: false, dataset: { ringAction: action, ringId: String(ringId) } };
      },
    },
  });
  const directionMarkup = elements.get("ringList").innerHTML;
  ringAction("direction");
  assert.notEqual(elements.get("ringList").innerHTML, directionMarkup);
  assert.match(elements.get("liveStatus").textContent, /Ring 2 (?:reversed|forward)/);
  ringAction("direction");
  const knobValues = [];
  const volumeLabel = {
    title: "",
    querySelector() {
      return { style: { setProperty(name, value) { knobValues.push([name, value]); } } };
    },
  };
  const volumeInput = {
    value: "0.4",
    dataset: { ringVolume: "2" },
    parentElement: volumeLabel,
    closest(selector) { return selector === "[data-ring-volume]" ? this : null; },
  };
  listeners.get("ringList:input")({ target: volumeInput });
  assert.equal(volumeLabel.title, "Ring 2 volume 40%");
  assert.equal(knobValues.at(-1)[0], "--ring-volume-angle");
  listeners.get("ringList:change")({ target: volumeInput });
  assert.match(elements.get("liveStatus").textContent, /volume 40 percent/);
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
