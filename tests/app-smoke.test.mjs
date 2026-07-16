import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app.js initializes and draws one frame against browser APIs", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const initialTags = new Map(
    [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map((match) => [match[1], match[0]]),
  );
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function element(id) {
    const classes = new Set();
    const styleValues = new Map();
    const node = {
      id,
      value: "0",
      hidden: /\bhidden\b/.test(initialTags.get(id) ?? ""),
      disabled: false,
      textContent: "",
      innerHTML: "",
      title: "",
      dataset: {},
      style: {
        left: "",
        top: "",
        setProperty(name, value) {
          styleValues.set(name, String(value));
        },
        getPropertyValue(name) {
          return styleValues.get(name) ?? "";
        },
      },
      classList: {
        add(...names) { for (const name of names) classes.add(name); },
        remove(...names) { for (const name of names) classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const next = force === undefined ? !classes.has(name) : Boolean(force);
          if (next) classes.add(name);
          else classes.delete(name);
          return next;
        },
      },
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

  const groups = {
    playMethod: ["traceMode", "scanMode", "radialMode"],
    lineLayout: ["parallelLines", "crossedLines"],
    scanMotion: ["loopScan", "pingPongScan"],
    curvatureDirection: ["curvatureOutward", "curvatureIn"],
    shapeType: ["polygonShape", "starShape"],
  };
  const dataValues = {
    scanMode: "scan",
    traceMode: "trace",
    radialMode: "radial",
    parallelLines: "parallel",
    crossedLines: "crossed",
    pingPongScan: "pingpong",
    loopScan: "loop",
    curvatureIn: "-1",
    curvatureOutward: "1",
    polygonShape: "polygon",
    starShape: "star",
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
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });
  const stage = elements.get("stageWrap");
  stage.getBoundingClientRect = () => ({ width: 900, height: 600 });
  elements.get("headLayoutTrack").getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 52 });

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
  assert.equal(attributes.get("polygonShape:aria-pressed"), "true");
  assert.equal(attributes.get("curvatureOutward:aria-pressed"), "true");
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "false");
  assert.equal(elements.get("levelOut").textContent, "65%");
  assert.equal(elements.get("position").value, "0.5");
  assert.equal(elements.get("positionOut").textContent, "50.0%");
  assert.equal(elements.get("headsControl").hidden, false);
  assert.equal(elements.get("lineCountControl").hidden, true);
  assert.equal(elements.get("lineLayoutControl").hidden, true);
  assert.equal(elements.get("scanMotionControl").hidden, true);
  assert.equal(elements.get("probeType").textContent, "1 TRACE HEAD");
  assert.equal(elements.get("soundMode").value, "fm");
  assert.equal(elements.get("sineArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, true);
  assert.equal(elements.get("shepardArticulation").hidden, true);
  assert.equal(elements.get("fmArticulation").hidden, false);
  assert.equal(elements.get("pmArticulation").hidden, true);
  assert.equal(elements.get("hitMapping").hidden, true);
  assert.equal(elements.get("traversalDirection").hidden, true);
  assert.equal(elements.get("rotationDirection").hidden, true);
  assert.equal(elements.get("headMarker0").hidden, false);
  assert.equal(elements.get("headMarker0").style.left, "50%");
  assert.equal(elements.get("headMarker1").hidden, true);
  assert.equal(elements.get("playheadCountOut").textContent, "1 point");
  assert.equal(elements.get("removePlayhead").disabled, true);
  listeners.get("addPlayhead:click")();
  assert.equal(elements.get("playheadCountOut").textContent, "2 points");
  assert.equal(elements.get("headMarker1").hidden, false);
  listeners.get("removePlayhead:click")();
  assert.equal(elements.get("playheadCountOut").textContent, "1 point");
  assert.equal(elements.get("headMarker1").hidden, true);
  assert.equal(elements.get("outputVoiceLabel").textContent, "fm");
  assert.equal(elements.get("mappingSummary").textContent, "Height → pitch");
  assert.equal(elements.get("outputContactLabel").textContent, "Contact 1 of 1");
  assert.notEqual(elements.get("markFrequencyOut").textContent, "");
  assert.match(elements.get("contactStream").innerHTML, /contact-row/);

  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(audioOscillators.length, 32, "FM mode should allocate its continuous voice pool");
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
  assert.equal(elements.get("hitMapping").hidden, false);
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
  assert.equal(elements.get("levelRouteSource").textContent, "Corner distance + magnitude");
  assert.equal(elements.get("levelRouteCurve").textContent, "spatial amplitude envelope");
  elements.get("position").value = "0.6";
  listeners.get("position:input")();
  queuedFrame(1_110);
  assert.equal(audioOscillators.length, afterPercussionStrike, "sine mode must never trigger percussion voices");
  assert.equal(elements.get("hitMapping").hidden, true);

  elements.get("soundMode").value = "fm";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  assert.equal(elements.get("fmArticulation").hidden, false);
  assert.equal(elements.get("synthMapping").hidden, false);
  elements.get("fmIndex").value = "6";
  listeners.get("fmIndex:input")();
  elements.get("synthSource").value = "corner";
  listeners.get("synthSource:change")({ currentTarget: elements.get("synthSource") });
  queuedFrame(1_115);
  assert.equal(elements.get("outputVoiceLabel").textContent, "fm");
  assert.match(elements.get("markSynthValueOut").textContent, /index @/);
  assert.equal(audioOscillators.length, afterPercussionStrike, "FM fallback must reuse the continuous pool");

  elements.get("soundMode").value = "pm";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  queuedFrame(1_116);
  assert.equal(elements.get("pmArticulation").hidden, false);
  assert.match(elements.get("markSynthValueOut").textContent, /rad @/);

  elements.get("soundMode").value = "shepard";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  queuedFrame(1_117);
  assert.equal(elements.get("shepardArticulation").hidden, false);
  assert.match(elements.get("markSynthValueOut").textContent, /oct\/s/);

  elements.get("soundMode").value = "sine";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });

  elements.get("position").value = "0";
  listeners.get("position:input")();
  queuedFrame(1_120);

  elements.get("speed").value = "1";
  listeners.get("speed:input")();
  assert.equal(elements.get("speedOut").textContent, "4.000 cyc/s");
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(elements.get("traversalDirection").hidden, false);
  assert.equal(elements.get("traversalDirectionText").textContent, "CW");
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionText").textContent, "CCW");
  listeners.get("traversalDirection:click")();
  queuedFrame(1_220);
  assert.equal(elements.get("positionOut").textContent, "40.0%");
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(elements.get("traversalDirection").hidden, true);

  elements.get("rotationSpeed").value = "4";
  listeners.get("rotationSpeed:input")();
  assert.equal(elements.get("rotationSpeedOut").textContent, "4.00 rev/s");
  listeners.get("rotationPlayButton:click")();
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "true");
  assert.equal(elements.get("rotationDirection").hidden, false);
  assert.equal(elements.get("rotationDirectionText").textContent, "CW");
  listeners.get("rotationDirection:click")();
  assert.equal(elements.get("rotationDirectionText").textContent, "CCW");
  listeners.get("rotationDirection:click")();
  queuedFrame(1_320);
  assert.equal(elements.get("rotationOut").textContent, "144°");
  listeners.get("rotationPlayButton:click")();
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "false");
  assert.equal(elements.get("rotationDirection").hidden, true);

  listeners.get("scanMode:click")();
  assert.equal(elements.get("headsControl").hidden, true);
  assert.equal(elements.get("lineCountControl").hidden, false);
  assert.equal(elements.get("scanMotionControl").hidden, false);
  assert.equal(attributes.get("loopScan:aria-pressed"), "true");
  assert.equal(elements.get("playheadCountOut").textContent, "1 line");
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
  assert.equal(elements.get("headLayoutTrack").classList.contains("is-crossed"), true);
  assert.equal(elements.get("headMarker0").style.top, "28%");
  assert.equal(elements.get("headMarker1").style.top, "72%");
  queuedFrame(1_500);
  const longHorizontal = segments.filter((segment) => (
    Math.abs(segment.y2 - segment.y1) < 0.01 && Math.abs(segment.x2 - segment.x1) > 500
  ));
  const longVertical = segments.filter((segment) => (
    Math.abs(segment.x2 - segment.x1) < 0.01 && Math.abs(segment.y2 - segment.y1) > 500
  ));
  assert.ok(longHorizontal.length > 5, "crossed mode should draw horizontal scanners and trails");
  assert.ok(longVertical.length > 5, "crossed mode should draw vertical scanners and trails");

  listeners.get("radialMode:click")();
  assert.equal(attributes.get("radialMode:aria-pressed"), "true");
  assert.equal(elements.get("positionLabel").textContent, "Radar angle");
  assert.equal(elements.get("probeType").textContent, "1 RADAR RAY");
  queuedFrame(1_550);
  assert.match(elements.get("stageReadout").textContent, /1 RAY/);
  elements.get("pitchSource").value = "center";
  listeners.get("pitchSource:change")({ currentTarget: elements.get("pitchSource") });
  queuedFrame(1_560);
  assert.equal(elements.get("mappingSummary").textContent, "Center distance → pitch");
  assert.equal(elements.get("pitchRouteSource").textContent, "Distance from center");
  assert.ok(Number(elements.get("markCenterOut").textContent) > 0);

  listeners.get("traceMode:click")();
  assert.equal(elements.get("headLayoutTrack").classList.contains("is-crossed"), false);
  assert.equal(elements.get("headMarker0").style.top, "50%");
  assert.equal(elements.get("headsControl").hidden, false);
  assert.equal(elements.get("lineCountControl").hidden, true);
  assert.equal(elements.get("lineLayoutControl").hidden, true);
  assert.equal(elements.get("scanMotionControl").hidden, true);
  assert.equal(elements.get("probeType").textContent, "1 TRACE HEAD");
  queuedFrame(2_000);
  assert.match(elements.get("stageReadout").textContent, /1 POINT/);

  elements.get("heads").value = "3";
  listeners.get("heads:input")();
  assert.equal(elements.get("headMarker0").style.left, "50%");
  assert.ok(Math.abs(parseFloat(elements.get("headMarker1").style.left) - 83.333) < 0.01);
  assert.ok(Math.abs(parseFloat(elements.get("headMarker2").style.left) - 16.667) < 0.01);
  assert.equal(elements.get("headMarker3").hidden, true);

  listeners.get("headMarker1:pointerdown")({
    clientX: 75,
    pointerId: 7,
    preventDefault() {},
  });
  assert.equal(elements.get("headMarker1").style.left, "25%");
  listeners.get("headLayoutTrack:pointerup")({ pointerId: 7 });
  listeners.get("resetHeadSpacing:click")();
  assert.ok(Math.abs(parseFloat(elements.get("headMarker1").style.left) - 83.333) < 0.01);

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

  listeners.get("starShape:click")();
  assert.equal(attributes.get("starShape:aria-pressed"), "true");
  assert.equal(elements.get("starDepthControl").hidden, false);
  elements.get("sides").value = "7";
  listeners.get("sides:input")();
  assert.equal(elements.get("sidesOut").textContent, "7 · star points");
  elements.get("aspect").value = "0.5";
  listeners.get("aspect:input")();
  assert.equal(elements.get("aspectOut").textContent, "50% wide");
  elements.get("skew").value = "-0.35";
  listeners.get("skew:input")();
  assert.equal(elements.get("skewOut").textContent, "-35%");
  elements.get("asymmetry").value = "0.4";
  listeners.get("asymmetry:input")();
  assert.equal(elements.get("asymmetryOut").textContent, "40%");
  listeners.get("resetForm:click")();
  assert.equal(attributes.get("polygonShape:aria-pressed"), "true");
  assert.equal(elements.get("starDepthControl").hidden, true);
  assert.equal(elements.get("sidesOut").textContent, "4 · polygon");

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
  elements.get("pitchSource").value = "incidence";
  listeners.get("pitchSource:change")({ currentTarget: elements.get("pitchSource") });
  elements.get("pitchCurve").value = "logarithmic";
  listeners.get("pitchCurve:change")({ currentTarget: elements.get("pitchCurve") });
  elements.get("hitLevelSource").value = "incidence";
  listeners.get("hitLevelSource:change")({ currentTarget: elements.get("hitLevelSource") });
  elements.get("hitLevelCurve").value = "exponential";
  listeners.get("hitLevelCurve:change")({ currentTarget: elements.get("hitLevelCurve") });
  elements.get("synthSource").value = "phase";
  listeners.get("synthSource:change")({ currentTarget: elements.get("synthSource") });
  elements.get("fmIndex").value = "5.5";
  listeners.get("fmIndex:input")();
  elements.get("pmIndex").value = "3.25";
  listeners.get("pmIndex:input")();
  elements.get("shepardCycles").value = "1.75";
  listeners.get("shepardCycles:input")();
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
  assert.equal(elements.get("pitchSource").value, "incidence");
  assert.equal(elements.get("pitchCurve").value, "logarithmic");
  assert.equal(elements.get("hitLevelSource").value, "incidence");
  assert.equal(elements.get("hitLevelCurve").value, "exponential");
  assert.equal(elements.get("synthSource").value, "phase");
  assert.equal(elements.get("fmIndexOut").textContent, "5.50 max");
  assert.equal(elements.get("pmIndexOut").textContent, "3.25 rad");
  assert.equal(elements.get("shepardCyclesOut").textContent, "1.75 oct / loop");
  assert.equal(elements.get("soundMode").value, "percussion");
  assert.equal(elements.get("sineArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  assert.equal(elements.get("hitMapping").hidden, false);
  assert.ok(storage.has("morphazoid:shape:audio:v1"));

  queuedFrame(3_100);
  assert.equal(elements.get("outputVoiceLabel").textContent, "percussion");
  assert.equal(elements.get("pitchRouteSource").textContent, "Incidence");
  assert.match(elements.get("pitchRouteCurve").textContent, /expand lows/);
  assert.equal(elements.get("levelRouteSource").textContent, "Incidence");
  assert.equal(elements.get("levelRouteCurve").textContent, "expand highs");
  assert.notEqual(elements.get("markIncidenceOut").textContent, "");
  assert.match(elements.get("markDecayOut").textContent, /320 ms/);

  await import(`../app.js?smokeReload=${Date.now()}`);
  assert.equal(elements.get("levelOut").textContent, "73%");
  assert.equal(elements.get("sineAccentOut").textContent, "68%");
  assert.equal(elements.get("sineDecayOut").textContent, "41%");
  assert.equal(elements.get("cornerAccentOut").textContent, "84%");
  assert.equal(elements.get("cornerAttackOut").textContent, "12.5 ms");
  assert.equal(elements.get("cornerDecayOut").textContent, "320 ms");
  assert.equal(elements.get("mappingFrame").value, "shape");
  assert.equal(elements.get("pitchSource").value, "incidence");
  assert.equal(elements.get("pitchCurve").value, "logarithmic");
  assert.equal(elements.get("hitLevelSource").value, "incidence");
  assert.equal(elements.get("hitLevelCurve").value, "exponential");
  assert.equal(elements.get("synthSource").value, "phase");
  assert.equal(elements.get("fmIndexOut").textContent, "5.50 max");
  assert.equal(elements.get("pmIndexOut").textContent, "3.25 rad");
  assert.equal(elements.get("shepardCyclesOut").textContent, "1.75 oct / loop");
  assert.equal(elements.get("soundMode").value, "percussion");
  assert.equal(elements.get("sineArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  assert.equal(elements.get("hitMapping").hidden, false);
});
