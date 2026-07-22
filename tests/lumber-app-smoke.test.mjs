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
      querySelector() { return { textContent: "", style: { setProperty() {} } }; },
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
    reverbMode: ["reverbOff", "reverbOn"],
    reverbDirection: ["reverbLeft", "reverbRight"],
    fuzzMode: ["fuzzOff", "fuzzOn"],
    fuzzDirection: ["fuzzLeft", "fuzzRight"],
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
    reverbOff: "off",
    reverbOn: "on",
    reverbLeft: "left",
    reverbRight: "right",
    fuzzOff: "off",
    fuzzOn: "on",
    fuzzLeft: "left",
    fuzzRight: "right",
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
    const connections = [];
    return {
      ...properties,
      connections,
      connect(destination) {
        connections.push(destination);
        return destination;
      },
      disconnect() {},
    };
  }

  const processors = [];
  const sources = [];
  const gains = [];
  const panners = [];
  const delays = [];
  const convolvers = [];
  const shapers = [];
  const captureGains = [];
  let nextGainIsCapture = false;
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
      if (nextGainIsCapture) {
        captureGains.push(gain);
        nextGainIsCapture = false;
      }
      return gain;
    }
    createMediaStreamSource() { return audioNode(); }
    createScriptProcessor() {
      const processor = audioNode({ onaudioprocess: null });
      processors.push(processor);
      nextGainIsCapture = true;
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
    createStereoPanner() {
      const panner = audioNode({ pan: audioParam(0) });
      panners.push(panner);
      return panner;
    }
    createDelay() {
      const delay = audioNode({ delayTime: audioParam(0) });
      delays.push(delay);
      return delay;
    }
    createConvolver() {
      const convolver = audioNode({ buffer: null });
      convolvers.push(convolver);
      return convolver;
    }
    createWaveShaper() {
      const shaper = audioNode({ curve: null, oversample: "none" });
      shapers.push(shaper);
      return shaper;
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
  assert.equal(attributes.get("backingOff:aria-pressed"), "false");
  assert.equal(attributes.get("backingOn:aria-pressed"), "true");

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
  assert.match(elements.get("ringList").innerHTML, /data-ring-pan="2"/);
  assert.match(elements.get("ringList").innerHTML, /Ring 2 pan center/);
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
  const sourceBeforeTriangle = sources.at(-1);
  listeners.get("trianglePreset:click")();
  assert.equal(elements.get("vertexCountOut").textContent, "3 vertices");
  assert.notEqual(
    sources.at(-1).buffer,
    sourceBeforeTriangle.buffer,
    "a preset change must restart playback with its newly pitch-shaped buffer",
  );
  listeners.get("squarePreset:click")();
  assert.equal(elements.get("vertexCountOut").textContent, "4 vertices");
  listeners.get("circlePreset:click")();
  assert.equal(elements.get("vertexCountOut").textContent, "12 vertices");
  listeners.get("viewThreeD:click")();
  assert.match(elements.get("depthSummary").textContent, /3D/);
  assert.equal(elements.get("ringDepth").disabled, false);
  assert.equal(elements.get("reverbOn").disabled, false);
  assert.equal(elements.get("fuzzLevel").disabled, true);
  assert.equal(elements.get("fuzzLevelOut").textContent, "20%");
  assert.equal(convolvers.length, 1, "3D reverb should share one room convolver");
  assert.ok(shapers.length >= 2, "each sounding ring should have a fuzz path");
  listeners.get("reverbOn:click")();
  assert.equal(attributes.get("reverbOn:aria-pressed"), "true");
  assert.match(elements.get("reverbIntensityOut").textContent, /%/);
  const rightReverbIntensity = elements.get("reverbIntensityOut").textContent;
  listeners.get("reverbLeft:click")();
  assert.notEqual(elements.get("reverbIntensityOut").textContent, rightReverbIntensity);
  assert.match(elements.get("depthSummary").textContent, /reverb/);
  listeners.get("fuzzOn:click")();
  assert.equal(attributes.get("fuzzOn:aria-pressed"), "true");
  assert.match(elements.get("fuzzIntensityOut").textContent, /%/);
  assert.equal(elements.get("fuzzRight").disabled, false);
  assert.equal(elements.get("fuzzLevel").disabled, false);
  assert.match(elements.get("depthSummary").textContent, /fuzz/);
  const fuzzOutputGains = shapers.map((shaper) => shaper.connections[0]?.gain?.value ?? 0);
  assert.ok(Math.abs(Math.max(...fuzzOutputGains) - 0.016) < 1e-12);
  elements.get("fuzzLevel").value = "0.6";
  listeners.get("fuzzLevel:input")();
  assert.equal(elements.get("fuzzLevelOut").textContent, "60%");
  assert.ok(Math.abs(Math.max(...fuzzOutputGains.map((_, index) => (
    shapers[index].connections[0]?.gain?.value ?? 0
  ))) - 0.048) < 1e-12);
  queuedFrame(performance.now() + 32);
  listeners.get("viewFlat:click")();
  assert.equal(elements.get("reverbIntensityOut").textContent, "flat");
  assert.equal(elements.get("fuzzIntensityOut").textContent, "flat");
  assert.equal(elements.get("reverbOn").disabled, true);
  assert.equal(elements.get("fuzzLevel").disabled, true);
  assert.equal(Math.max(...shapers.map((shaper) => shaper.connections[0]?.gain?.value ?? 0)), 0);

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

  assert.equal(elements.get("mixDelayWetOut").textContent, "dry");
  assert.equal(attributes.get("delayRingToggle:aria-pressed"), "false");
  listeners.get("delayRingToggle:click")();
  assert.match(elements.get("effectsSummary").textContent, /0% wet/);
  assert.equal(attributes.get("delayRingToggle:aria-pressed"), "true");
  assert.equal(elements.get("resetDelayRing").disabled, false);
  listeners.get("stage:pointerdown")(gesture(508, 84));
  listeners.get("stage:pointermove")(gesture(514, 62));
  listeners.get("stage:pointerup")(gesture(514, 62));
  assert.doesNotMatch(elements.get("mixDelayWetOut").textContent, /dry/);
  assert.match(elements.get("liveStatus").textContent, /full mix/);
  assert.ok(gains[1].gain.value > 0, "dragging outside the delay contour must open the mix send");
  elements.get("delaySpread").value = "0.8";
  listeners.get("delaySpread:input")();
  assert.equal(elements.get("delaySpreadOut").textContent, "80%");
  assert.equal(panners[0].pan.value, -0.8);
  assert.equal(panners[1].pan.value, 0.8);
  assert.notEqual(delays[0].delayTime.value, delays[1].delayTime.value);
  elements.get("delayRotationSpeed").value = "0.2";
  listeners.get("delayRotationSpeed:input")();
  assert.equal(elements.get("delayRotationSpeedOut").textContent, "+0.20 rev/s");
  listeners.get("delayRotationPlay:click")();
  assert.equal(attributes.get("delayRotationPlay:aria-pressed"), "true");
  assert.match(elements.get("effectsSummary").textContent, /rotating/);
  listeners.get("resetDelayRing:click")();
  assert.equal(elements.get("mixDelayWetOut").textContent, "dry");
  assert.equal(elements.get("delaySpreadOut").textContent, "65%");
  assert.equal(attributes.get("delayRotationPlay:aria-pressed"), "false");
  listeners.get("delayRingToggle:click")();
  assert.match(elements.get("effectsSummary").textContent, /off/);
  elements.get("filterTone").value = "0.5";
  listeners.get("filterTone:input")();
  assert.match(elements.get("filterToneOut").textContent, /kHz/);
  const panValues = [];
  const panLabel = {
    title: "",
    querySelector() {
      return { style: { setProperty(name, value) { panValues.push([name, value]); } } };
    },
  };
  const panInput = {
    value: "-0.5",
    dataset: { ringPan: "2" },
    parentElement: panLabel,
    closest(selector) { return selector === "[data-ring-pan]" ? this : null; },
  };
  listeners.get("playButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  listeners.get("ringList:input")({ target: panInput });
  assert.equal(panLabel.title, "Ring 2 pan 50% left");
  assert.equal(panValues.at(-1)[0], "--ring-pan-angle");
  assert.equal(panners.at(-1).pan.value, -0.5);
  listeners.get("ringList:change")({ target: panInput });
  assert.match(elements.get("liveStatus").textContent, /pan 50 percent left/);

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
  assert.ok(captureGains.length >= 3);
  assert.ok(captureGains.every((gain) => gain.gain.value === 0), "microphone input must remain unmonitored");
});
