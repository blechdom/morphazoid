import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPrototile, tilingInfo } from "../src/lattice.js";

test("lattice app renders and plays line contacts", async () => {
  const html = await readFile(new URL("../lattice.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function element(id) {
    const node = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      dataset: {},
      style: {},
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelectorAll() {
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      setPointerCapture() {},
      focus() {},
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);
  elements.get("scanMotion").querySelectorAll = () => [
    elements.get("loopScan"),
    elements.get("pingPongScan"),
  ];
  elements.get("loopScan").dataset.value = "loop";
  elements.get("pingPongScan").dataset.value = "pingpong";

  let drawnArcs = 0;
  const drawingContext = {
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    scale() {},
    setTransform() {},
    stroke() {},
    translate() {},
    arc() { drawnArcs += 1; },
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });
  const tileEditorCanvas = elements.get("tileEditorCanvas");
  tileEditorCanvas.getContext = () => drawingContext;
  tileEditorCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 220 });
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 900, height: 600 });

  let queuedFrame;
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    frameId += 1;
    return frameId;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback();
    }
  };

  const documentListeners = new Map();
  globalThis.document = {
    hidden: false,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  const windowListeners = new Map();
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLSelectElement = class {};

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

  const oscillators = [];
  const gains = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
    }
    createGain() {
      const gain = audioNode({ gain: audioParam(0) });
      gains.push(gain);
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
        start() {},
        stop() {},
      });
      oscillators.push(oscillator);
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

  await import(`../lattice-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  let now = performance.now() + 20;
  queuedFrame(now);

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^1 LINE .+ CONTACT/);
  assert.doesNotMatch(elements.get("stageReadout").textContent, /WALK/);
  assert.match(elements.get("formSummary").textContent, /Pentagon .+ IH20/);
  assert.equal(elements.get("angleOut").textContent, "90\u00b0");
  assert.equal(elements.get("parameterCount").textContent, "2 parameters");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal(elements.get("edgeCurve0Out").textContent, "straight");
  assert.equal(
    (elements.get("tilingType").innerHTML.match(/<option /g) ?? []).length,
    72,
    "the selector should contain every Tactile isohedral family",
  );
  assert.equal(attributes.get("loopScan:aria-pressed"), "true");
  assert.equal(attributes.get("playButton:aria-pressed"), undefined);
  assert.ok(drawnArcs > 0, "line contacts should be drawn");
  assert.match(elements.get("outputContactLabel").textContent, /Contact 1 of/);
  assert.equal(elements.get("tileEditorPanel").hidden, true);
  assert.equal(attributes.get("toggleTileEditor:aria-expanded"), "false");
  assert.equal(elements.get("soundMode").value, "sine");
  assert.equal(elements.get("percussionArticulation").hidden, true);
  assert.equal(elements.get("shepardArticulation").hidden, true);
  assert.equal(elements.get("fmArticulation").hidden, true);
  assert.equal(elements.get("pmArticulation").hidden, true);

  const arcsBeforeEditor = drawnArcs;
  listeners.get("toggleTileEditor:click")();
  assert.equal(elements.get("tileEditorPanel").hidden, false);
  assert.equal(attributes.get("toggleTileEditor:aria-expanded"), "true");
  assert.equal(tileEditorCanvas.width, 640);
  assert.equal(tileEditorCanvas.height, 440);
  assert.ok(drawnArcs > arcsBeforeEditor, "the editor should draw prototile corner handles");

  const editorModel = buildPrototile({
    type: 20,
    parameters: tilingInfo(20).defaultParameters,
  });
  const editorScale = Math.min(
    (320 - 54) / (editorModel.bounds.maxX - editorModel.bounds.minX),
    (220 - 54) / (editorModel.bounds.maxY - editorModel.bounds.minY),
  );
  const editorCenter = {
    x: (editorModel.bounds.minX + editorModel.bounds.maxX) / 2,
    y: (editorModel.bounds.minY + editorModel.bounds.maxY) / 2,
  };
  const draggableVertex = editorModel.vertices[1];
  const handle = {
    x: 160 + (draggableVertex.x - editorCenter.x) * editorScale,
    y: 110 - (draggableVertex.y - editorCenter.y) * editorScale,
  };
  const parameterBeforeDrag = [
    elements.get("parameter0Out").textContent,
    elements.get("parameter1Out").textContent,
  ];
  listeners.get("tileEditorCanvas:pointerdown")({
    clientX: handle.x,
    clientY: handle.y,
    pointerId: 2,
    preventDefault() {},
  });
  listeners.get("tileEditorCanvas:pointermove")({
    clientX: handle.x + 18,
    clientY: handle.y - 12,
    pointerId: 2,
    preventDefault() {},
  });
  assert.notDeepEqual([
    elements.get("parameter0Out").textContent,
    elements.get("parameter1Out").textContent,
  ], parameterBeforeDrag);
  listeners.get("tileEditorCanvas:pointerup")({ pointerId: 2 });
  listeners.get("resetTileVertices:click")();
  assert.equal(elements.get("parameter0Out").textContent, "0.105");
  assert.equal(elements.get("parameter1Out").textContent, "0.650");

  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(oscillators.length, 32);
  assert.ok(oscillators.every((oscillator) => oscillator.type === "sine"));
  assert.ok(Math.abs(gains[0].gain.value - Math.sqrt(0.65)) < 1e-12);
  now += 100;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /VOICE/);
  const voiceGains = gains.slice(1, 33);
  assert.ok(voiceGains.some((gain) => gain.gain.value > 0));
  assert.ok(
    Math.hypot(...voiceGains.map((gain) => gain.gain.value)) > 0.2,
    "the default line chord should have audible combined gain",
  );
  assert.ok(oscillators.some((oscillator) => oscillator.frequency.value !== 220));
  assert.ok(oscillators.every((oscillator) => (
    oscillator.frequency.value >= 110 && oscillator.frequency.value <= 1245
  )));

  elements.get("soundMode").value = "fm";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  elements.get("fmIndex").value = "5";
  listeners.get("fmIndex:input")();
  now += 80;
  queuedFrame(now);
  assert.equal(elements.get("fmArticulation").hidden, false);
  assert.equal(elements.get("synthMapping").hidden, false);
  assert.equal(elements.get("outputVoiceLabel").textContent, "fm");
  assert.match(elements.get("markSynthValueOut").textContent, /index @/);
  assert.equal(oscillators.length, 32, "FM fallback must reuse the continuous pool");

  elements.get("soundMode").value = "pm";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  now += 80;
  queuedFrame(now);
  assert.equal(elements.get("pmArticulation").hidden, false);
  assert.match(elements.get("markSynthValueOut").textContent, /rad @/);

  elements.get("soundMode").value = "shepard";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  now += 80;
  queuedFrame(now);
  assert.equal(elements.get("shepardArticulation").hidden, false);
  assert.match(elements.get("markSynthValueOut").textContent, /oct\/s/);

  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  now += 80;
  queuedFrame(now);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  assert.ok(oscillators.length > 32, "new line intersections should trigger percussion strikes");

  elements.get("soundMode").value = "sine";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  now += 80;
  queuedFrame(now);

  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  const accentedCombinedGain = Math.hypot(...voiceGains.map((gain) => gain.gain.value));
  now += 1000;
  queuedFrame(now);
  const settledCombinedGain = Math.hypot(...voiceGains.map((gain) => gain.gain.value));
  assert.ok(settledCombinedGain < accentedCombinedGain, "intersection accent should decay on the same voices");

  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(gains[0].gain.value, 0, "audio off must mute the master bus");
  assert.ok(voiceGains.every((gain) => gain.gain.value === 0));
  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  now += 20;
  queuedFrame(now);

  elements.get("voiceCap").value = "4";
  listeners.get("voiceCap:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(voiceGains.filter((gain) => gain.gain.value > 0).length, 4);
  assert.match(elements.get("stageReadout").textContent, /4 VOICES/);

  const startPosition = Number(elements.get("position").value);
  listeners.get("pingPongScan:click")();
  assert.equal(attributes.get("pingPongScan:aria-pressed"), "true");
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  now += 100;
  queuedFrame(now);
  assert.notEqual(Number(elements.get("position").value), startPosition);
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");

  windowListeners.get("keydown")({
    target: { tagName: "BUTTON" },
    code: "Space",
    key: " ",
    preventDefault() {},
  });
  assert.equal(
    attributes.get("playButton:aria-pressed"),
    "false",
    "global shortcuts must not double-activate focused controls",
  );

  elements.get("angle").value = "71";
  listeners.get("angle:input")();
  assert.equal(elements.get("angleOut").textContent, "71\u00b0");
  now += 20;
  queuedFrame(now);
  assert.ok(drawnArcs > 4);

  elements.get("tilingType").value = "1";
  listeners.get("tilingType:change")();
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("formSummary").textContent, /Hexagon .+ IH01/);
  assert.equal(elements.get("parameterCount").textContent, "4 parameters");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal(elements.get("parameterControl4").hidden, true);

  elements.get("parameter0").value = "0.2";
  listeners.get("parameter0:input")();
  assert.equal(elements.get("parameter0Out").textContent, "0.200");
  elements.get("edgeCurve1").value = "0.7";
  listeners.get("edgeCurve1:input")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "70% forward");
  listeners.get("straightenEdges:click")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "straight");

  elements.get("tilingType").value = "31";
  listeners.get("tilingType:change")();
  assert.equal(elements.get("edgeCount").textContent, "0 bendable classes");
  assert.equal(elements.get("edgeControl0").hidden, true);
  assert.equal(elements.get("edgeCurve0").disabled, true);
  assert.match(elements.get("edgeRuleNote").textContent, /no edge-shape parameters/);
  assert.equal(elements.get("resetTileVertices").disabled, true);
  assert.match(elements.get("tileEditorNote").textContent, /no movable vertex parameters/);

  elements.get("tilingType").value = "20";
  listeners.get("tilingType:change")();
  now += 20;
  queuedFrame(now);
  const phaseBeforeDrag = Number(elements.get("position").value);
  listeners.get("stage:pointerdown")({ clientX: 450, clientY: 300, pointerId: 1 });
  listeners.get("stage:pointermove")({ clientX: 550, clientY: 300, pointerId: 1 });
  now += 20;
  queuedFrame(now);
  assert.notEqual(Number(elements.get("position").value), phaseBeforeDrag);
  listeners.get("stage:pointerup")({ pointerId: 1 });

  listeners.get("resetForm:click")();
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("formSummary").textContent, /Pentagon .+ IH20/);
  assert.equal(elements.get("tilingType").value, "20");
  assert.equal(elements.get("angleOut").textContent, "90\u00b0");
  assert.equal(elements.get("positionOut").textContent, "50.0%");
  assert.equal(elements.get("edgeCurve0Out").textContent, "straight");

  elements.get("level").value = "0.72";
  listeners.get("level:input")();
  assert.equal(elements.get("levelOut").textContent, "72%");
  elements.get("intersectionAccent").value = "0.8";
  listeners.get("intersectionAccent:input")();
  assert.equal(elements.get("intersectionAccentOut").textContent, "80%");
  elements.get("synthSource").value = "orientation";
  listeners.get("synthSource:change")();
  elements.get("pmIndex").value = "3.5";
  listeners.get("pmIndex:input")();
  elements.get("shepardCycles").value = "2.25";
  listeners.get("shepardCycles:input")();
  assert.equal(elements.get("pmIndexOut").textContent, "3.50 rad");
  assert.equal(elements.get("shepardCyclesOut").textContent, "2.25 oct / loop");
  assert.ok(storage.has("morphazoid:lattice:audio:v1"));
  const persisted = JSON.parse(storage.get("morphazoid:lattice:audio:v1"));
  assert.equal(persisted.synthSource, "orientation");
  assert.equal(persisted.pmIndex, 3.5);
  assert.equal(persisted.shepardCycles, 2.25);
});
