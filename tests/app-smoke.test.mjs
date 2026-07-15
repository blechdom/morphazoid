import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app.js initializes and draws one frame against browser APIs", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function element(id) {
    const node = {
      id,
      value: "0",
      hidden: false,
      disabled: false,
      textContent: "",
      title: "",
      dataset: {},
      classList: { add() {} },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelectorAll() {
        return [];
      },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);

  const groups = {
    playMethod: ["scanMode", "traceMode"],
    lineLayout: ["parallelLines", "crossedLines"],
    scanMotion: ["pingPongScan", "loopScan"],
    curvatureDirection: ["curvatureIn", "curvatureOutward"],
  };
  const dataValues = {
    scanMode: "scan",
    traceMode: "trace",
    parallelLines: "parallel",
    crossedLines: "crossed",
    pingPongScan: "pingpong",
    loopScan: "loop",
    curvatureIn: "-1",
    curvatureOutward: "1",
  };
  for (const [id, value] of Object.entries(dataValues)) elements.get(id).dataset.value = value;
  for (const [id, childIds] of Object.entries(groups)) {
    elements.get(id).querySelectorAll = () => childIds.map((childId) => elements.get(childId));
  }

  const segments = [];
  let currentPoint = null;
  const drawingContext = {
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo(x, y) {
      if (currentPoint) segments.push({ x1: currentPoint.x, y1: currentPoint.y, x2: x, y2: y });
      currentPoint = { x, y };
    },
    moveTo(x, y) {
      currentPoint = { x, y };
    },
    arc() {},
    restore() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({ left: 0, width: 900, height: 600 });
  canvas.setPointerCapture = () => {};
  canvas.focus = () => {};
  const stage = elements.get("stageWrap");
  stage.getBoundingClientRect = () => ({ width: 900, height: 600 });

  let queuedFrame;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    return 1;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback();
    }
  };
  globalThis.document = {
    activeElement: null,
    hidden: false,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    addEventListener() {},
  };
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
    matchMedia() {
      return { matches: false };
    },
  };
  function audioParam(value = 0) {
    return {
      value,
      setTargetAtTime(next) { this.value = next; },
      setValueAtTime(next) { this.value = next; },
      exponentialRampToValueAtTime(next) { this.value = next; },
      cancelScheduledValues() {},
    };
  }
  function audioNode(properties = {}) {
    return {
      ...properties,
      connect(destination) { return destination; },
      disconnect() {},
    };
  }
  const audioOscillators = [];
  const audioGains = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
    }
    createGain() {
      const gain = audioNode({ gain: audioParam(0) });
      audioGains.push(gain);
      return gain;
    }
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
      const oscillator = audioNode({
        type: "sine",
        frequency: audioParam(220),
        onended: null,
        start() {},
        stop() {},
      });
      audioOscillators.push(oscillator);
      return oscillator;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
  };

  await import(`../app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  queuedFrame(1_000);

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(elements.get("stageReadout").textContent, /1 POINT/);
  assert.match(elements.get("stageReadout").textContent, /1 CONTACT/);
  assert.equal(attributes.get("traceMode:aria-pressed"), "true");
  assert.equal(attributes.get("loopScan:aria-pressed"), "true");
  assert.equal(attributes.get("traversalForward:aria-pressed"), "true");
  assert.equal(attributes.get("rotationForward:aria-pressed"), "true");
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "false");
  assert.equal(elements.get("levelOut").textContent, "65%");
  assert.equal(elements.get("headsControl").hidden, false);
  assert.equal(elements.get("lineCountControl").hidden, true);
  assert.equal(elements.get("lineLayoutControl").hidden, true);
  assert.equal(elements.get("scanMotionControl").hidden, true);
  assert.equal(elements.get("probeType").textContent, "1 TRACE HEAD");
  assert.equal(elements.get("soundMode").value, "sine");
  assert.equal(elements.get("sineArticulation").hidden, false);
  assert.equal(elements.get("percussionArticulation").hidden, true);

  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(audioOscillators.length, 32, "sine mode should allocate its continuous voice pool");
  queuedFrame(1_020);
  assert.match(elements.get("stageReadout").textContent, /1 VOICE/);
  const continuousGains = audioGains.slice(1, 33);
  assert.equal(continuousGains.filter((gain) => gain.gain.value > 0).length, 1);
  elements.get("position").value = "0.6";
  listeners.get("position:input")();
  queuedFrame(1_050);
  assert.equal(audioOscillators.length, 32, "sine corner envelopes must not add a second oscillator layer");
  assert.ok(audioOscillators.every((oscillator) => oscillator.type === "sine"));
  elements.get("position").value = "0";
  listeners.get("position:input")();
  queuedFrame(1_075);

  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  assert.equal(elements.get("sineArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  queuedFrame(1_085);
  assert.ok(
    continuousGains.every((gain) => gain.gain.value === 0),
    "percussion mode must silence every continuous sine voice",
  );
  elements.get("position").value = "0.3";
  listeners.get("position:input")();
  queuedFrame(1_095);
  assert.ok(audioOscillators.length > 32, "percussion mode should create a corner strike");
  assert.ok(audioOscillators.every((oscillator) => oscillator.type === "sine"));
  const afterPercussionStrike = audioOscillators.length;

  elements.get("soundMode").value = "sine";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  queuedFrame(1_100);
  elements.get("position").value = "0.6";
  listeners.get("position:input")();
  queuedFrame(1_110);
  assert.equal(audioOscillators.length, afterPercussionStrike, "sine mode must never trigger percussion voices");

  listeners.get("traversalReverse:click")();
  assert.equal(attributes.get("traversalReverse:aria-pressed"), "true");
  listeners.get("traversalForward:click")();

  elements.get("position").value = "0";
  listeners.get("position:input")();
  queuedFrame(1_120);

  elements.get("speed").value = "1";
  listeners.get("speed:input")();
  assert.equal(elements.get("speedOut").textContent, "1.200 cyc/s");
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  queuedFrame(1_220);
  assert.equal(elements.get("positionOut").textContent, "12.0%");
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");

  elements.get("rotationSpeed").value = "2";
  listeners.get("rotationSpeed:input")();
  assert.equal(elements.get("rotationSpeedOut").textContent, "2.00 rev/s");
  listeners.get("rotationPlayButton:click")();
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "true");
  queuedFrame(1_320);
  assert.equal(elements.get("rotationOut").textContent, "72°");
  listeners.get("rotationPlayButton:click")();
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "false");

  listeners.get("scanMode:click")();
  assert.equal(elements.get("headsControl").hidden, true);
  assert.equal(elements.get("lineCountControl").hidden, false);
  assert.equal(elements.get("scanMotionControl").hidden, false);
  assert.equal(attributes.get("loopScan:aria-pressed"), "true");
  elements.get("position").value = "1";
  listeners.get("position:input")();
  queuedFrame(1_330);
  assert.match(elements.get("stageReadout").textContent, /CONTACT/);
  listeners.get("pingPongScan:click")();
  assert.equal(attributes.get("pingPongScan:aria-pressed"), "true");
  listeners.get("loopScan:click")();
  assert.equal(attributes.get("loopScan:aria-pressed"), "true");

  elements.get("lineCount").value = "4";
  listeners.get("lineCount:input")();
  queuedFrame(1_250);
  assert.match(elements.get("stageReadout").textContent, /4 LINES/);
  assert.equal(elements.get("lineLayoutControl").hidden, false);

  segments.length = 0;
  listeners.get("crossedLines:click")();
  assert.equal(attributes.get("crossedLines:aria-pressed"), "true");
  queuedFrame(1_500);
  const longHorizontal = segments.filter((segment) => (
    Math.abs(segment.y2 - segment.y1) < 0.01 && Math.abs(segment.x2 - segment.x1) > 500
  ));
  const longVertical = segments.filter((segment) => (
    Math.abs(segment.x2 - segment.x1) < 0.01 && Math.abs(segment.y2 - segment.y1) > 500
  ));
  assert.ok(longHorizontal.length > 5, "crossed mode should draw horizontal scanners and trails");
  assert.ok(longVertical.length > 5, "crossed mode should draw vertical scanners and trails");

  listeners.get("traceMode:click")();
  assert.equal(elements.get("headsControl").hidden, false);
  assert.equal(elements.get("lineCountControl").hidden, true);
  assert.equal(elements.get("lineLayoutControl").hidden, true);
  assert.equal(elements.get("scanMotionControl").hidden, true);
  assert.equal(elements.get("probeType").textContent, "1 TRACE HEAD");
  queuedFrame(2_000);
  assert.match(elements.get("stageReadout").textContent, /1 POINT/);

  elements.get("heads").value = "12";
  listeners.get("heads:input")();
  queuedFrame(2_500);
  assert.equal(elements.get("probeType").textContent, "12 TRACE HEADS");
  assert.match(elements.get("stageReadout").textContent, /12 POINTS/);

  listeners.get("scanMode:click")();
  queuedFrame(3_000);
  assert.equal(elements.get("headsControl").hidden, true);
  assert.equal(elements.get("lineCountControl").hidden, false);
  assert.equal(elements.get("lineLayoutControl").hidden, false);
  assert.equal(elements.get("scanMotionControl").hidden, false);
  assert.match(elements.get("stageReadout").textContent, /4 LINES/);
  assert.doesNotMatch(elements.get("stageReadout").textContent, /12 POINTS/);

  elements.get("curvature").value = "0.4";
  listeners.get("curvature:input")();
  assert.equal(elements.get("curvatureOut").textContent, "40% outward");
  listeners.get("curvatureIn:click")();
  assert.equal(elements.get("curvatureOut").textContent, "40% inward");
  assert.equal(elements.get("curvature").value, "0.4");
  elements.get("curvature").value = "0";
  listeners.get("curvature:input")();
  assert.equal(elements.get("curvatureOut").textContent, "straight");

  elements.get("level").value = "0.73";
  listeners.get("level:input")();
  elements.get("sineAccent").value = "0.68";
  listeners.get("sineAccent:input")();
  elements.get("sineDecay").value = "0.41";
  listeners.get("sineDecay:input")();
  elements.get("cornerAccent").value = "0.84";
  listeners.get("cornerAccent:input")();
  elements.get("cornerDecay").value = "320";
  listeners.get("cornerDecay:input")();
  elements.get("cornerAttack").value = "12.5";
  listeners.get("cornerAttack:input")();
  elements.get("stereoWidth").value = "0.42";
  listeners.get("stereoWidth:input")();
  elements.get("mappingFrame").value = "shape";
  listeners.get("mappingFrame:change")({ currentTarget: elements.get("mappingFrame") });
  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });

  listeners.get("traceMode:click")();
  elements.get("sides").value = "7";
  listeners.get("sides:input")();
  assert.equal(elements.get("levelOut").textContent, "73%");
  assert.equal(elements.get("sineAccentOut").textContent, "68%");
  assert.equal(elements.get("sineDecayOut").textContent, "41%");
  assert.equal(elements.get("cornerAccentOut").textContent, "84%");
  assert.equal(elements.get("cornerDecayOut").textContent, "320 ms");
  assert.equal(elements.get("cornerAttackOut").textContent, "12.5 ms");
  assert.equal(elements.get("stereoWidthOut").textContent, "42%");
  assert.equal(elements.get("mappingFrame").value, "shape");
  assert.equal(elements.get("soundMode").value, "percussion");
  assert.equal(elements.get("sineArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  assert.ok(storage.has("morphazoid:shape:audio:v1"));

  await import(`../app.js?smokeReload=${Date.now()}`);
  assert.equal(elements.get("levelOut").textContent, "73%");
  assert.equal(elements.get("sineAccentOut").textContent, "68%");
  assert.equal(elements.get("sineDecayOut").textContent, "41%");
  assert.equal(elements.get("cornerAccentOut").textContent, "84%");
  assert.equal(elements.get("cornerAttackOut").textContent, "12.5 ms");
  assert.equal(elements.get("cornerDecayOut").textContent, "320 ms");
  assert.equal(elements.get("mappingFrame").value, "shape");
  assert.equal(elements.get("soundMode").value, "percussion");
  assert.equal(elements.get("sineArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
});
