import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("L-mic app draws and drives virtual microphone branches in one processor", async () => {
  const html = await readFile(new URL("../l-system.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  for (const id of ids) {
    elements.set(id, {
      id,
      value: "",
      textContent: "",
      hidden: false,
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      getBoundingClientRect() { return { width: 900, height: 600 }; },
    });
  }

  let strokes = 0;
  let arcs = 0;
  const drawingContext = {
    arc() { arcs += 1; },
    beginPath() {},
    clearRect() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() { strokes += 1; },
  };
  elements.get("stage").getContext = () => drawingContext;

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
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  const windowListeners = new Map();
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };

  const audioParam = (value = 0) => ({
    value,
    setTargetAtTime(next) { this.value = next; },
  });
  const audioNode = (properties = {}) => ({
    ...properties,
    connect(destination) { return destination; },
    disconnect() {},
  });
  const gainNodes = [];
  let oscillatorCount = 0;
  const workletMessages = [];
  let workletNode = null;
  let mediaTrackStopped = false;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          return { getTracks: () => [{ stop() { mediaTrackStopped = true; } }] };
        },
      },
    },
  });
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = { postMessage(message) { workletMessages.push(message); } };
      workletNode = this;
    }
    connect(destination) { return destination; }
    disconnect() {}
  };
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.sampleRate = 48_000;
      this.destination = audioNode();
      this.audioWorklet = { async addModule() {} };
    }
    createGain() {
      const node = audioNode({ gain: audioParam(0) });
      gainNodes.push(node);
      return node;
    }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0), knee: audioParam(0), ratio: audioParam(0),
        attack: audioParam(0), release: audioParam(0),
      });
    }
    createOscillator() {
      oscillatorCount += 1;
      return audioNode({ type: "sine", frequency: audioParam(220), start() {}, stop() {} });
    }
    createMediaStreamSource() { return audioNode(); }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };

  await import(`../l-system-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  let now = performance.now() + 20;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /PYTHAGOREAN TREE · FINAL I7 · 1 HEAD · AUDIO OFF/);
  assert.ok(strokes >= 255, "the complete tree skeleton should be drawn");
  assert.equal(arcs, 1, "the trunk should begin with one playhead");

  const additionalPresets = [
    ["koch", "KOCH SNOWFLAKE", "5"],
    ["sierpinski", "SIERPIŃSKI TRIANGLE", "6"],
    ["hilbert", "HILBERT CURVE", "7"],
    ["gosper", "GOSPER CURVE", "5"],
    ["cantor", "CANTOR SET", "11"],
    ["levy", "LÉVY C CURVE", "15"],
    ["terdragon", "TERDRAGON", "10"],
  ];
  for (const [id, readout, maxIterations] of additionalPresets) {
    elements.get("preset").value = id;
    listeners.get("preset:change")({ currentTarget: elements.get("preset") });
    queuedFrame(now + 4);
    assert.match(elements.get("stageReadout").textContent, new RegExp(`^${readout}`));
    assert.equal(elements.get("iterations").max, maxIterations);
    assert.equal(elements.get("systemError").hidden, true);
  }
  elements.get("preset").value = "hilbert";
  listeners.get("preset:change")({ currentTarget: elements.get("preset") });
  assert.equal(elements.get("lengthScale").disabled, true);
  assert.equal(elements.get("lengthScaleOut").textContent, "not used");
  assert.match(elements.get("taperNote").textContent, /no > or < length markers/);

  elements.get("preset").value = "pythagorean";
  listeners.get("preset:change")({ currentTarget: elements.get("preset") });
  queuedFrame(now + 8);
  assert.equal(elements.get("lengthScale").disabled, false);
  elements.get("turnAsymmetry").value = "0.5";
  listeners.get("turnAsymmetry:input")();
  elements.get("angle").value = "30";
  listeners.get("angle:input")();
  elements.get("lengthScale").value = "0.5";
  listeners.get("lengthScale:input")();
  assert.equal(elements.get("turnAsymmetryOut").textContent, "−15° / +45°");
  listeners.get("resetSystem:click")();
  assert.equal(elements.get("turnAsymmetry").value, "0");
  assert.equal(elements.get("turnAsymmetryOut").textContent, "−45° / +45°");
  assert.equal(elements.get("angle").value, "45");
  assert.equal(elements.get("lengthScale").value, "0.72");

  listeners.get("structureSequence:click")();
  elements.get("position").value = String(1.5 / 7);
  listeners.get("position:input")();
  queuedFrame(now + 10);
  assert.equal(elements.get("speedOut").textContent, "0.08 iter/s");
  assert.match(elements.get("structureSummary").textContent, /sequence · I2\/7/);
  assert.equal(elements.get("positionOut").textContent, "I2 · 50.0%");

  listeners.get("structureFinal:click")();

  elements.get("position").value = "0.99";
  listeners.get("position:input")();
  queuedFrame(now + 20);
  assert.match(elements.get("stageReadout").textContent, /FINAL I7 · 128 HEADS · AUDIO OFF/);

  listeners.get("structureTogether:click")();
  queuedFrame(now + 40);
  assert.match(elements.get("stageReadout").textContent, /7 ITERATIONS TOGETHER · 254 HEADS · AUDIO OFF/);
  assert.match(elements.get("structureReadout").textContent, /I1 \+ I2[\s\S]*I7 · phase locked/);

  await listeners.get("audioButton:click")();
  assert.equal(oscillatorCount, 0, "L-mic must not allocate an oscillator per branch");
  listeners.get("playButton:click")();
  now += 60;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /7 ITERATIONS TOGETHER · 254 HEADS · 128\/254 MIC BRANCHES/);
  assert.match(elements.get("polyphonyReadout").textContent, /AUTO CHECK · 128 \/ 254/);
  assert.match(elements.get("polyphonyDescription").textContent, /Measuring real playback load/);
  const branchMessage = workletMessages.filter((message) => message.type === "voices").at(-1);
  assert.equal(branchMessage.voices.length, 128);
  assert.equal(branchMessage.voiceLimit, 128);
  assert.equal(branchMessage.requestedVoiceCount, 254);
  assert.ok(branchMessage.voices.every((voice) => Number.isFinite(voice.rate)));
  assert.ok(branchMessage.voices.every((voice) => (
    typeof voice.sourceKey === "string" && typeof voice.bounceKey === "string"
  )));
  assert.ok(Math.hypot(...branchMessage.voices.map((voice) => voice.gain)) <= 0.38 + 1e-9);
  assert.equal(attributes.get("playButton:aria-pressed"), "true");

  for (let index = 0; index < 3; index += 1) {
    workletNode.port.onmessage({ data: {
      type: "render-load",
      supported: true,
      timing: "high-res",
      averageLoad: 0.2,
      peakLoad: 0.3,
      activeVoices: 128,
      renderedVoices: 128,
      requestedVoices: 254,
    } });
  }
  queuedFrame(now + 70);
  const expandedMessage = workletMessages.filter((message) => message.type === "voices").at(-1);
  assert.equal(expandedMessage.voices.length, 160);
  assert.match(elements.get("polyphonyReadout").textContent, /AUTO TEST · 160 \/ 254/);

  elements.get("preset").value = "cantor";
  listeners.get("preset:change")({ currentTarget: elements.get("preset") });
  elements.get("position").value = "0.5";
  listeners.get("position:input")();
  queuedFrame(now + 80);
  assert.equal(elements.get("angle").disabled, true);
  assert.equal(elements.get("turnAsymmetry").disabled, true);
  assert.match(elements.get("stageReadout").textContent, /^CANTOR SET · 6 ITERATIONS TOGETHER · 0 HEADS · 0 MIC BRANCHES/);
  assert.deepEqual(workletMessages.filter((message) => message.type === "voices").at(-1).voices, []);

  windowListeners.get("pagehide")({ persisted: true });
  assert.equal(mediaTrackStopped, true);
});
