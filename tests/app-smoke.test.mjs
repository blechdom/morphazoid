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
    playheadMotion: ["loopMotion", "pingPongMotion"],
    rotationMotion: ["rotationLoopMotion", "rotationPingPongMotion"],
    closedShapeType: ["polygonShape", "starShape"],
    pitchDimension: ["pitchVertical", "pitchHorizontal", "pitchCenter"],
    stereoDimension: ["stereoHorizontal", "stereoVertical", "stereoCenter"],
    pitchCurvePresets: [
      "pitchCurveLinear", "pitchCurveExponential", "pitchCurveLogarithmic",
      "pitchCurveSmooth", "pitchCurveInverted",
    ],
    amplitudeEnvelopePresets: [
      "amplitudePresetPluck", "amplitudePresetNote", "amplitudePresetSustain", "amplitudePresetPad",
    ],
    percussionEnvelopePresets: [
      "percussionPresetPluck", "percussionPresetNote", "percussionPresetSustain", "percussionPresetPad",
    ],
  };
  const dataValues = {
    scanMode: "scan",
    traceMode: "trace",
    radialMode: "radial",
    pingPongMotion: "pingpong",
    loopMotion: "loop",
    rotationPingPongMotion: "pingpong",
    rotationLoopMotion: "loop",
    polygonShape: "polygon",
    starShape: "star",
    pitchVertical: "vertical",
    pitchHorizontal: "horizontal",
    pitchCenter: "center",
    stereoHorizontal: "horizontal",
    stereoVertical: "vertical",
    stereoCenter: "center",
    pitchCurveLinear: "linear",
    pitchCurveExponential: "exponential",
    pitchCurveLogarithmic: "logarithmic",
    pitchCurveSmooth: "smooth",
    pitchCurveInverted: "inverted",
    amplitudePresetPluck: "pluck",
    amplitudePresetNote: "note",
    amplitudePresetSustain: "sustain",
    amplitudePresetPad: "pad",
    percussionPresetPluck: "pluck",
    percussionPresetNote: "note",
    percussionPresetSustain: "sustain",
    percussionPresetPad: "pad",
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
  elements.get("pitchCurveEditor").getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 96 });
  elements.get("amplitudeCurveEditor").getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 96 });
  elements.get("percussionCurveEditor").getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 96 });

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
  const audioWorkletMessages = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
      this.audioWorklet = { async addModule() {} };
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
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = {
        postMessage(message) { audioWorkletMessages.push(message); },
      };
      this.onprocessorerror = null;
    }
    connect(destination) { return destination; }
    disconnect() {}
  };
  const storage = new Map();
  const sessionStorage = new Map();
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
  };
  globalThis.sessionStorage = {
    getItem(key) { return sessionStorage.get(key) ?? null; },
    setItem(key, value) { sessionStorage.set(key, String(value)); },
    removeItem(key) { sessionStorage.delete(key); },
  };

  await import(`../app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  queuedFrame(1_000);

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(elements.get("stageReadout").textContent, /1 POINT/);
  assert.match(elements.get("stageReadout").textContent, /1 CONTACT/);
  assert.equal(attributes.get("traceMode:aria-pressed"), "true");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(elements.get("sides").value, "4");
  assert.equal(elements.get("sidesOut").textContent, "4 · polygon");
  assert.equal(elements.get("formSummary").textContent, "4-point polygon");
  for (const removedId of [
    "shapeType", "circleShape", "asymmetry", "curvatureDirection", "curvatureOutward", "curvatureIn",
  ]) assert.equal(elements.has(removedId), false, `obsolete Form control #${removedId} should be absent`);
  assert.equal(attributes.get("polygonShape:aria-pressed"), "true");
  assert.equal(attributes.get("starShape:aria-pressed"), "false");
  assert.equal(elements.get("closedShapeControl").hidden, false);
  assert.equal(elements.get("starDepthControl").hidden, true);
  assert.equal(elements.get("starDepthOut").textContent, "48%");
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "false");
  assert.equal(attributes.get("rotationLoopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("rotationPingPongMotion:aria-pressed"), "false");
  assert.equal(elements.get("levelOut").textContent, "65%");
  assert.equal(elements.get("position").value, "0");
  assert.equal(elements.get("positionOut").textContent, "0.0%");
  assert.equal(attributes.get("speed:aria-valuetext"), "0.060 cyc/s");
  assert.equal(elements.get("headsControl").hidden, false);
  assert.equal(elements.get("lineCountControl").hidden, true);
  assert.equal(elements.get("playheadMotion").hidden, false);
  assert.equal(elements.has("scanMotionControl"), false);
  assert.equal(elements.get("headOption0").hidden, false);
  assert.equal(elements.get("headOption0").textContent, "→");
  assert.equal(attributes.get("headOption0:aria-pressed"), "false");
  assert.equal(elements.get("headOption1").hidden, true);
  assert.equal(elements.get("soundMode").value, "sine");
  assert.equal(elements.get("amplitudeArticulation").hidden, false);
  assert.equal(attributes.get("amplitudeEnvelopeToggle:aria-pressed"), "true");
  assert.equal(elements.get("amplitudeEnvelopeToggleText").textContent, "On");
  assert.equal(attributes.get("cornerSwellToggle:aria-pressed"), "false");
  assert.equal(elements.get("cornerSwellToggleText").textContent, "Swell off");
  assert.equal(attributes.get("amplitudePresetPluck:aria-pressed"), "true");
  assert.equal(attributes.get("amplitudePresetNote:aria-pressed"), "false");
  assert.equal(elements.get("amplitudeCurveState").textContent, "Pluck");
  assert.equal(elements.get("amplitudeIntervalHelp").textContent, "Corner trigger 0% → next corner 100%");
  assert.equal(
    elements.get("amplitudeNodeReadout").textContent,
    "A @ 83 ms · D @ 250 ms · S @ 417 ms · R @ 667 ms",
  );
  assert.equal(
    elements.get("amplitudeTimingBasis").textContent,
    "Point · 0.060 cyc/s current contour timing · endpoints from trigger",
  );
  assert.match(attributes.get("amplitudeNode2:aria-valuetext"), /250 milliseconds from the trigger/);
  listeners.get("amplitudeNode2:pointerdown")({ pointerId: 9, preventDefault() {} });
  listeners.get("amplitudeCurveEditor:pointermove")({ pointerId: 9, clientX: 19.2, clientY: 48 });
  assert.equal(
    elements.get("amplitudeNodeReadout").textContent,
    "A @ 83 ms · D @ 333 ms · S @ 417 ms · R @ 667 ms",
  );
  assert.match(attributes.get("amplitudeNode2:aria-valuetext"), /333 milliseconds from the trigger/);
  assert.equal(elements.get("amplitudeNode2").title, "Decay · 333 ms · 50% level");
  listeners.get("amplitudeCurveEditor:pointerup")({ pointerId: 9 });
  listeners.get("resetAmplitudeCurve:click")();
  listeners.get("cornerSwellToggle:click")();
  assert.equal(attributes.get("cornerSwellToggle:aria-pressed"), "true");
  assert.equal(elements.get("cornerSwellToggleText").textContent, "Swell on");
  assert.equal(elements.get("amplitudeCurveState").textContent, "Pluck · mirrored");
  assert.equal(elements.get("amplitudeIntervalHelp").textContent, "Midpoint → corner peak → midpoint");
  assert.equal(
    elements.get("amplitudeNodeReadout").textContent,
    "A 0 ms peak · D ±85 ms · S ±170 ms · R ±298 ms",
  );
  assert.match(elements.get("amplitudeTimingBasis").textContent, /± from corner/);
  assert.match(attributes.get("amplitudeNode2:aria-valuetext"), /plus or minus 85 milliseconds from the corner/);
  listeners.get("cornerSwellToggle:click")();
  assert.equal(attributes.get("cornerSwellToggle:aria-pressed"), "false");
  assert.equal(elements.get("cornerSwellToggleText").textContent, "Swell off");
  listeners.get("cornerSwellToggle:click")();
  assert.match(elements.get("amplitudeReleaseBehavior").textContent, /rests until next trigger/);
  listeners.get("amplitudeEnvelopeToggle:click")();
  assert.equal(attributes.get("amplitudeEnvelopeToggle:aria-pressed"), "false");
  assert.equal(elements.get("amplitudeEnvelopeToggleText").textContent, "Off");
  assert.equal(elements.get("amplitudeCurveState").textContent, "Bypassed");
  assert.match(elements.get("amplitudeReleaseBehavior").textContent, /constant per-synth level/);
  assert.equal(attributes.get("amplitudeCurveEditor:aria-disabled"), "true");
  assert.equal(elements.get("amplitudeNode2").disabled, true);
  assert.equal(elements.get("amplitudePresetPluck").disabled, true);
  assert.equal(elements.get("cornerSwellToggle").disabled, true);
  assert.equal(attributes.get("cornerSwellToggle:aria-pressed"), "false");
  assert.equal(elements.get("cornerSwellToggleText").textContent, "Swell off");
  listeners.get("amplitudeEnvelopeToggle:click")();
  assert.equal(attributes.get("amplitudeEnvelopeToggle:aria-pressed"), "true");
  assert.equal(attributes.get("amplitudeCurveEditor:aria-disabled"), "false");
  assert.equal(elements.get("amplitudeNode2").disabled, false);
  assert.equal(elements.get("cornerSwellToggle").disabled, false);
  assert.equal(elements.get("percussionArticulation").hidden, true);
  assert.equal(elements.get("shepardArticulation").hidden, true);
  assert.equal(elements.get("fmArticulation").hidden, true);
  assert.equal(elements.get("pmArticulation").hidden, true);
  assert.equal(elements.get("percussionStrikeLevelOut").textContent, "90%");
  assert.equal(elements.get("percussionAttackNoiseOut").textContent, "0%");
  assert.equal(elements.get("percussionEnvelopeState").textContent, "Pluck");
  assert.equal(attributes.get("percussionPresetPluck:aria-pressed"), "true");
  assert.equal(
    elements.get("percussionNodeReadout").textContent,
    "A 3 ms · D 25 ms · S 55 ms · R 100 ms",
  );
  assert.match(attributes.get("percussionNode2:aria-valuetext"), /25 milliseconds from the trigger/);
  listeners.get("percussionNode2:pointerdown")({ pointerId: 11, preventDefault() {} });
  listeners.get("percussionCurveEditor:pointermove")({ pointerId: 11, clientX: 96, clientY: 48 });
  assert.equal(elements.get("percussionEnvelopeState").textContent, "Custom");
  assert.match(elements.get("percussionNodeReadout").textContent, /D 27 ms/);
  assert.match(attributes.get("percussionNode2:aria-valuetext"), /27 milliseconds from the trigger/);
  listeners.get("percussionCurveEditor:pointerup")({ pointerId: 11 });
  listeners.get("resetPercussionCurve:click")();
  assert.equal(elements.get("percussionEnvelopeState").textContent, "Pluck");
  assert.equal(elements.get("percussionMapping").hidden, true);
  assert.equal(elements.get("timbreMapping").hidden, true);
  assert.equal(elements.get("timbreSourceHelp").textContent, "0 is smooth · 1 is the sharpest turn");
  assert.equal(elements.get("percussionSourceHelp").textContent, "0 is smooth · 1 is the sharpest turn");
  assert.equal(elements.get("traversalDirection").hidden, false);
  assert.equal(elements.get("rotationDirection").hidden, false);
  assert.equal(elements.get("headMarker0").hidden, false);
  assert.equal(elements.get("headMarker0").style.left, "0%");
  assert.equal(elements.get("headMarker0").style.top, "58%");
  assert.equal(attributes.get("headMarker0:aria-label"), "Point 1 relative phase");
  assert.equal(attributes.get("headMarker0:aria-valuetext"), "0.0 percent relative phase");
  assert.equal(elements.get("headMarker1").hidden, true);
  assert.equal(elements.get("playheadCountOut").textContent, "1 point");
  assert.equal(elements.get("removePlayhead").disabled, true);
  listeners.get("addPlayhead:click")();
  assert.equal(elements.get("playheadCountOut").textContent, "2 points");
  assert.equal(elements.get("headMarker1").hidden, false);
  listeners.get("removePlayhead:click")();
  assert.equal(elements.get("playheadCountOut").textContent, "1 point");
  assert.equal(elements.get("headMarker1").hidden, true);
  assert.equal(elements.get("headOption1").hidden, true);
  listeners.get("pingPongMotion:click")();
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  listeners.get("loopMotion:click")();
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(elements.get("soundSummary").textContent, "Sine Oscillators");
  assert.equal(elements.get("outputVoiceLabel").textContent, "Sine Oscillators");
  assert.equal(elements.get("mappingSummary").textContent, "Vertical → pitch");
  assert.equal(attributes.get("pitchVertical:aria-pressed"), "true");
  assert.equal(attributes.get("pitchHorizontal:aria-pressed"), "false");
  assert.equal(attributes.get("pitchCenter:aria-pressed"), "false");
  assert.equal(elements.get("pitchCurveState").textContent, "Linear");
  assert.equal(attributes.get("pitchCurveLinear:aria-pressed"), "true");
  assert.match(attributes.get("pitchCurvePath:d"), /^M0\.00 96\.00/);
  assert.equal(elements.get("pitchRouteSource").textContent, "Vertical position ↑");
  assert.equal(elements.get("markPitchValueOut").textContent, "1.000");
  const topFrequency = Number.parseFloat(elements.get("markFrequencyOut").textContent);
  elements.get("position").value = "0.5";
  listeners.get("position:input")();
  queuedFrame(1_005);
  assert.equal(elements.get("markPitchValueOut").textContent, "0.000");
  assert.ok(Number.parseFloat(elements.get("markFrequencyOut").textContent) < topFrequency);
  elements.get("position").value = "0";
  listeners.get("position:input")();
  queuedFrame(1_006);
  assert.equal(elements.get("markPitchValueOut").textContent, "1.000");
  assert.equal(attributes.get("stereoHorizontal:aria-pressed"), "true");
  assert.equal(attributes.get("stereoVertical:aria-pressed"), "false");
  assert.equal(attributes.get("stereoCenter:aria-pressed"), "false");
  assert.equal(attributes.get("stereoInvert:aria-pressed"), "false");
  assert.match(elements.get("stereoMappingNote").textContent, /Stage left → audio left/);
  assert.equal(elements.get("panRouteSource").textContent, "Horizontal position");
  assert.equal(elements.get("panRouteCurve").textContent, "normal · 100% width");
  assert.equal(elements.has("mappingFrame"), false);
  listeners.get("stereoVertical:click")();
  assert.match(elements.get("stereoMappingNote").textContent, /Stage top → audio left · stage bottom → audio right/);
  listeners.get("stereoHorizontal:click")();
  assert.equal(elements.get("outputContactLabel").textContent, "Contact 1 of 1");
  assert.equal(Number(elements.get("markIncidenceOut").textContent), 0);
  assert.notEqual(elements.get("markFrequencyOut").textContent, "");
  assert.match(elements.get("contactStream").innerHTML, /contact-row/);

  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(audioOscillators.length, 32, "Sine mode should allocate its continuous voice pool");
  queuedFrame(1_020);
  assert.match(elements.get("stageReadout").textContent, /0 SYNTHS/);
  const continuousGains = audioGains.slice(1, 33);
  assert.ok(continuousGains.every((gain) => gain.gain.value === 0));
  elements.get("position").value = "0.6";
  listeners.get("position:input")();
  queuedFrame(1_050);
  assert.equal(audioOscillators.length, 32, "sine corner envelopes must not add a second oscillator layer");
  assert.ok(audioOscillators.every((oscillator) => oscillator.type === "sine"));
  assert.ok(continuousGains.every((gain) => gain.gain.value === 0));
  elements.get("position").value = "0";
  listeners.get("position:input")();
  queuedFrame(1_075);

  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  assert.equal(elements.get("soundSummary").textContent, "Percussion");
  assert.equal(elements.get("amplitudeArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  assert.equal(elements.get("percussionMapping").hidden, false);
  queuedFrame(1_085);
  assert.ok(
    continuousGains.every((gain) => gain.gain.value === 0),
    "percussion mode must silence every continuous sine voice",
  );
  elements.get("position").value = "0.3";
  listeners.get("position:input")();
  queuedFrame(1_095);
  assert.equal(audioOscillators.length, 32, "paused percussion must not create corner strikes");
  assert.ok(audioOscillators.every((oscillator) => oscillator.type === "sine"));
  const afterPercussionStrike = audioOscillators.length;

  elements.get("soundMode").value = "sine";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  queuedFrame(1_100);
  assert.equal(elements.get("levelRouteSource").textContent, "Directed corner interval");
  assert.equal(elements.get("levelRouteCurve").textContent, "Pluck ADSR");
  elements.get("position").value = "0.6";
  listeners.get("position:input")();
  queuedFrame(1_110);
  assert.equal(audioOscillators.length, afterPercussionStrike, "sine mode must never trigger percussion voices");
  assert.equal(elements.get("percussionMapping").hidden, true);

  elements.get("soundMode").value = "fm";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  assert.equal(elements.get("amplitudeArticulation").hidden, false);
  assert.equal(elements.get("fmArticulation").hidden, false);
  assert.equal(elements.get("timbreMapping").hidden, false);
  elements.get("fmIndex").value = "6";
  listeners.get("fmIndex:input")();
  elements.get("timbreSource").value = "corner";
  listeners.get("timbreSource:change")({ currentTarget: elements.get("timbreSource") });
  assert.equal(elements.get("timbreMappingNote").textContent, "Corner sharpness → FM index · 0–6.00 index");
  assert.equal(elements.get("timbreSourceHelp").textContent, "0 is smooth · 1 is the sharpest turn");
  queuedFrame(1_115);
  assert.equal(elements.get("soundSummary").textContent, "FM Synthesis");
  assert.equal(elements.get("outputVoiceLabel").textContent, "FM Synthesis");
  assert.match(elements.get("markSynthValueOut").textContent, /index @/);
  assert.equal(elements.get("timbreRouteSource").textContent, "Corner sharpness");
  assert.equal(elements.get("timbreRouteTarget").textContent, "FM index");
  assert.equal(audioOscillators.length, afterPercussionStrike, "FM worklet must not allocate native oscillators");

  elements.get("soundMode").value = "pm";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  queuedFrame(1_116);
  assert.equal(elements.get("pmArticulation").hidden, false);
  assert.equal(elements.get("timbreMapping").hidden, false);
  assert.match(elements.get("timbreMappingNote").textContent, /Corner sharpness → Phase depth/);
  assert.match(elements.get("markSynthValueOut").textContent, /rad @/);

  elements.get("soundMode").value = "shepard";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  listeners.get("rotationPlayButton:click")();
  queuedFrame(1_180);
  assert.equal(elements.get("amplitudeArticulation").hidden, false);
  assert.equal(elements.get("shepardArticulation").hidden, false);
  assert.equal(elements.get("timbreMapping").hidden, true);
  assert.equal(elements.get("mappingSummary").textContent, "Base → Shepard glide");
  assert.equal(elements.get("pitchRouteSource").textContent, "Base frequency");
  assert.match(elements.get("pitchRouteCurve").textContent, /fixed spectral anchor/);
  assert.equal(elements.get("markFrequencyOut").textContent, "110 Hz");
  assert.equal(elements.get("markSynthDriveOut").textContent, "-");
  assert.match(elements.get("markSynthValueOut").textContent, /oct\/s/);

  const latestWorkletVoice = (mode) => audioWorkletMessages
    .toReversed()
    .flatMap((message) => message.voices ?? [])
    .find((voice) => voice.mode === mode);
  let shepardVoice = latestWorkletVoice("shepard");
  assert.ok(shepardVoice, `missing Shepard worklet spec: ${JSON.stringify(audioWorkletMessages)}`);
  assert.equal(shepardVoice.frequency, 110, "Shepard must use a fixed spectral anchor");
  assert.equal(shepardVoice.shepardWidth, 4, "the width slider directly controls the bank");
  assert.equal(shepardVoice.synthDrive, 1, "geometry must not collapse the Shepard bank");

  elements.get("shepardCycles").value = "1.25";
  listeners.get("shepardCycles:input")();
  elements.get("sides").value = "1";
  listeners.get("sides:input")();
  elements.get("position").value = "0.99";
  listeners.get("position:input")();
  queuedFrame(1_210);
  const beforeCircuitSeam = latestWorkletVoice("shepard").shepardPosition;
  const previousSpeedSlider = elements.get("speed").value;
  elements.get("speed").value = "0.47717299738597074";
  listeners.get("speed:input")();
  listeners.get("playButton:click")();
  queuedFrame(1_240);
  const afterCircuitSeam = latestWorkletVoice("shepard").shepardPosition;
  assert.ok(
    afterCircuitSeam > beforeCircuitSeam && afterCircuitSeam - beforeCircuitSeam < 0.05,
    `fractional Shepard cycles should cross the contour seam continuously (${beforeCircuitSeam} → ${afterCircuitSeam})`,
  );
  listeners.get("playButton:click")();
  elements.get("speed").value = previousSpeedSlider;
  listeners.get("speed:input")();
  elements.get("shepardCycles").value = "1";
  listeners.get("shepardCycles:input")();
  elements.get("sides").value = "4";
  listeners.get("sides:input")();
  elements.get("position").value = "0.6";
  listeners.get("position:input")();
  listeners.get("rotationPlayButton:click")();
  listeners.get("resetRotation:click")();

  elements.get("soundMode").value = "sine";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  listeners.get("amplitudePresetNote:click")();
  assert.equal(attributes.get("amplitudePresetNote:aria-pressed"), "true");
  assert.equal(elements.get("amplitudeCurveState").textContent, "Note");

  elements.get("position").value = "0";
  listeners.get("position:input")();
  queuedFrame(1_120);

  elements.get("speed").value = "0";
  listeners.get("speed:input")();
  assert.equal(elements.get("speedOut").textContent, "0.000 cyc/s");
  assert.equal(attributes.get("speed:aria-valuetext"), "0.000 cyc/s");
  assert.equal(elements.get("amplitudeNodeReadout").textContent, "A @ — ms · D @ — ms · S @ — ms · R @ — ms");
  assert.equal(elements.get("amplitudeTimingBasis").textContent, "Point · stopped at 0.000 cyc/s");
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
  assert.ok(
    audioWorkletMessages.at(-1).voices.some((voice) => voice.gain > 0),
    "continuous playback must send audible voices to the worklet",
  );
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(elements.get("traversalDirection").hidden, false);
  queuedFrame(1_225);
  assert.deepEqual(audioWorkletMessages.at(-1).voices, []);
  assert.ok(continuousGains.every((gain) => gain.gain.value === 0));

  elements.get("rotationSpeed").value = "4";
  listeners.get("rotationSpeed:input")();
  assert.equal(elements.get("rotationSpeedOut").textContent, "4.00 rev/s");
  listeners.get("rotationPlayButton:click")();
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "true");
  assert.equal(elements.get("rotationDirection").hidden, false);
  assert.equal(elements.get("rotationDirectionText").textContent, "CW");
  assert.equal(elements.get("rotationDirectionGlyph").textContent, "→");
  listeners.get("rotationDirection:click")();
  assert.equal(elements.get("rotationDirectionText").textContent, "CCW");
  assert.equal(elements.get("rotationDirectionGlyph").textContent, "←");
  listeners.get("rotationDirection:click")();
  queuedFrame(1_320);
  assert.equal(elements.get("rotationOut").textContent, "144°");
  listeners.get("rotationPlayButton:click")();
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "false");
  assert.equal(elements.get("rotationDirection").hidden, false);

  // Reset keeps the angle slider/readout synchronized. Rotation ping-pong
  // preserves zero on selection, then reverses after its +180-degree limit.
  listeners.get("resetRotation:click")();
  assert.equal(elements.get("rotation").value, "0");
  assert.equal(elements.get("rotationOut").textContent, "0°");
  listeners.get("rotationPingPongMotion:click")();
  assert.equal(attributes.get("rotationPingPongMotion:aria-pressed"), "true");
  assert.equal(attributes.get("rotationLoopMotion:aria-pressed"), "false");
  assert.equal(elements.get("rotationOut").textContent, "0°");
  listeners.get("rotationPlayButton:click")();
  queuedFrame(1_420);
  const rotationBeforeTurnaround = Number.parseFloat(elements.get("rotationOut").textContent);
  queuedFrame(1_520);
  const rotationAfterTurnaround = Number.parseFloat(elements.get("rotationOut").textContent);
  assert.ok(rotationBeforeTurnaround > rotationAfterTurnaround);
  listeners.get("rotationPlayButton:click")();
  assert.equal(elements.get("rotationDirection").hidden, false);
  listeners.get("rotationLoopMotion:click")();
  assert.equal(attributes.get("rotationLoopMotion:aria-pressed"), "true");
  listeners.get("resetRotation:click")();
  assert.equal(elements.get("rotationOut").textContent, "0°");

  listeners.get("scanMode:click")();
  assert.equal(elements.get("headsControl").hidden, true);
  assert.equal(elements.get("lineCountControl").hidden, false);
  assert.equal(elements.get("playheadMotion").hidden, false);
  assert.equal(elements.get("headOption0").hidden, false);
  assert.equal(elements.get("headOption0").textContent, "│");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(elements.get("playheadCountOut").textContent, "1 line");
  elements.get("position").value = "1";
  listeners.get("position:input")();
  queuedFrame(1_330);
  assert.match(elements.get("stageReadout").textContent, /CONTACT/);
  elements.get("position").value = "0.94";
  listeners.get("position:input")();
  queuedFrame(1_331);
  const oneSidedApproachGain = Number(elements.get("markGainOut").textContent);
  listeners.get("cornerSwellToggle:click")();
  queuedFrame(1_332);
  const symmetricApproachGain = Number(elements.get("markGainOut").textContent);
  assert.ok(symmetricApproachGain > oneSidedApproachGain, "Line swell should rise before a corner only when enabled");
  assert.equal(elements.get("levelRouteSource").textContent, "Mirrored corner interval");
  assert.match(elements.get("levelRouteCurve").textContent, /swell/);
  listeners.get("cornerSwellToggle:click")();
  assert.equal(attributes.get("cornerSwellToggle:aria-pressed"), "false");
  queuedFrame(1_333);
  const restoredApproachGain = Number(elements.get("markGainOut").textContent);
  assert.equal(restoredApproachGain, oneSidedApproachGain, "turning Swell off must restore directed gain");
  assert.equal(elements.get("levelRouteSource").textContent, "Directed corner interval");
  assert.doesNotMatch(elements.get("levelRouteCurve").textContent, /swell/);
  elements.get("position").value = "1";
  listeners.get("position:input")();
  listeners.get("pingPongMotion:click")();
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  listeners.get("loopMotion:click")();
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");

  elements.get("lineCount").value = "4";
  listeners.get("lineCount:input")();
  queuedFrame(1_250);
  assert.match(elements.get("stageReadout").textContent, /4 LINES/);
  assert.equal(elements.get("headOption3").hidden, false);

  segments.length = 0;
  listeners.get("headOption1:click")();
  assert.equal(attributes.get("headOption1:aria-pressed"), "true");
  assert.equal(elements.get("headOption1").textContent, "—");
  assert.equal(elements.get("headLayoutTrack").classList.contains("has-head-options"), true);
  assert.equal(elements.get("headMarker0").style.top, "58%");
  assert.equal(elements.get("headMarker1").style.top, "58%");
  queuedFrame(1_500);
  const longHorizontal = segments.filter((segment) => (
    Math.abs(segment.y2 - segment.y1) < 0.01 && Math.abs(segment.x2 - segment.x1) > 500
  ));
  const longVertical = segments.filter((segment) => (
    Math.abs(segment.x2 - segment.x1) < 0.01 && Math.abs(segment.y2 - segment.y1) > 500
  ));
  assert.ok(longHorizontal.length > 5, "a rotated line should draw horizontal scanners and trails");
  assert.ok(longVertical.length > 5, "unchanged lines should remain vertical scanners");

  listeners.get("radialMode:click")();
  assert.equal(attributes.get("radialMode:aria-pressed"), "true");
  assert.equal(elements.get("playheadMotion").hidden, false);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(elements.get("headOption0").hidden, false);
  assert.equal(elements.get("headOption0").textContent, "→");
  listeners.get("pingPongMotion:click")();
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  listeners.get("loopMotion:click")();
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(elements.get("positionLabel").textContent, "Radar angle");
  assert.equal(elements.get("speedLabel").textContent, "Radar speed");
  assert.equal(elements.get("positionOut").textContent, "360.0°");
  assert.equal(elements.get("speedOut").textContent, "4.000 rev/s");
  assert.equal(attributes.get("speed:aria-valuetext"), "4.000 rev/s");
  queuedFrame(1_565);
  assert.match(elements.get("amplitudeNodeReadout").textContent, /@ ≈ /);
  assert.match(elements.get("amplitudeTimingBasis").textContent, /^≈ Radar ·/);
  assert.match(elements.get("amplitudeTimingBasis").textContent, /even-corner nominal estimate/);
  elements.get("speed").value = "0";
  listeners.get("speed:input")();
  elements.get("rotationSpeed").value = "0.5";
  listeners.get("rotationSpeed:input")();
  listeners.get("rotationPlayButton:click")();
  assert.equal(attributes.get("rotationPlayButton:aria-pressed"), "true");
  queuedFrame(1_566);
  assert.equal(
    elements.get("amplitudeTimingBasis").textContent,
    "Radar · rotation-only motion · no stable ms estimate",
  );
  assert.equal(elements.get("amplitudeNodeReadout").textContent, "A @ — ms · D @ — ms · S @ — ms · R @ — ms");
  assert.match(attributes.get("amplitudeNode2:aria-valuetext"), /no stable millisecond estimate during rotation-only motion/);
  listeners.get("rotationPlayButton:click")();
  elements.get("speed").value = "1";
  listeners.get("speed:input")();
  assert.equal(attributes.get("position:aria-label"), "Radar angle from 0 to 360 degrees");
  queuedFrame(1_550);
  assert.match(elements.get("stageReadout").textContent, /1 RAY/);
  listeners.get("pitchCenter:click")();
  queuedFrame(1_560);
  assert.equal(elements.get("mappingSummary").textContent, "Center distance → pitch");
  assert.equal(elements.get("pitchRouteSource").textContent, "Distance from center");
  assert.ok(Number(elements.get("markCenterOut").textContent) > 0);

  listeners.get("stereoCenter:click")();
  queuedFrame(1_561);
  assert.equal(attributes.get("stereoCenter:aria-pressed"), "true");
  assert.equal(elements.get("panRouteSource").textContent, "Distance from center");
  const outwardPan = Number(elements.get("markPanOut").textContent);
  listeners.get("stereoInvert:click")();
  queuedFrame(1_562);
  assert.equal(attributes.get("stereoInvert:aria-pressed"), "true");
  assert.ok(Math.abs(Number(elements.get("markPanOut").textContent) + outwardPan) < 0.002);
  assert.match(elements.get("panRouteCurve").textContent, /reversed/);
  listeners.get("stereoInvert:click")();
  listeners.get("stereoHorizontal:click")();

  listeners.get("pitchCurveExponential:click")();
  assert.equal(elements.get("pitchCurveState").textContent, "Exponential");
  assert.equal(attributes.get("pitchCurveExponential:aria-pressed"), "true");
  listeners.get("pitchCurveNode2:keydown")({
    key: "ArrowUp",
    shiftKey: false,
    preventDefault() {},
  });
  assert.equal(elements.get("pitchCurveState").textContent, "Custom");
  assert.equal(attributes.get("pitchCurveExponential:aria-pressed"), "false");
  assert.match(attributes.get("pitchCurveNode2:aria-valuetext"), /21 percent output/);
  assert.equal(attributes.get("pitchCurveNode2:aria-valuenow"), "21");
  listeners.get("resetPitchCurve:click")();
  assert.equal(elements.get("pitchCurveState").textContent, "Linear");

  elements.get("sides").value = "2";
  listeners.get("sides:input")();
  elements.get("rotation").value = "0";
  listeners.get("rotation:input")();
  elements.get("position").value = "0.5";
  listeners.get("position:input")();
  assert.equal(elements.get("positionOut").textContent, "180.0°");
  queuedFrame(1_570);
  assert.match(elements.get("stageReadout").textContent, /0 CONTACTS/);
  elements.get("position").value = "0.25";
  listeners.get("position:input")();
  assert.equal(elements.get("positionOut").textContent, "90.0°");
  queuedFrame(1_580);
  assert.match(elements.get("stageReadout").textContent, /1 CONTACT/);
  elements.get("sides").value = "4";
  listeners.get("sides:input")();

  // Radar direction settings stay separate from Point direction settings.
  listeners.get("headOption0:click")();
  assert.equal(elements.get("headOption0").textContent, "←");
  assert.equal(attributes.get("headOption0:aria-pressed"), "true");

  listeners.get("traceMode:click")();
  assert.equal(elements.get("headLayoutTrack").classList.contains("has-head-options"), true);
  assert.equal(elements.get("headMarker0").style.top, "58%");
  assert.equal(elements.get("headOption0").hidden, false);
  assert.equal(elements.get("headOption0").textContent, "→");
  assert.equal(attributes.get("headOption0:aria-pressed"), "false");
  assert.equal(elements.get("headsControl").hidden, false);
  assert.equal(elements.get("lineCountControl").hidden, true);
  assert.equal(elements.get("playheadMotion").hidden, false);
  queuedFrame(2_000);
  assert.match(elements.get("stageReadout").textContent, /1 POINT/);

  elements.get("heads").value = "3";
  listeners.get("heads:input")();
  assert.equal(elements.get("headMarker0").style.left, "0%");
  assert.ok(Math.abs(parseFloat(elements.get("headMarker1").style.left) - 33.333) < 0.01);
  assert.ok(Math.abs(parseFloat(elements.get("headMarker2").style.left) - 66.667) < 0.01);
  assert.equal(elements.get("headMarker3").hidden, true);
  assert.equal(elements.get("headOption2").hidden, false);
  assert.equal(elements.get("headOption3").hidden, true);
  listeners.get("headOption1:click")();
  assert.equal(elements.get("headOption0").textContent, "→");
  assert.equal(elements.get("headOption1").textContent, "←");
  assert.equal(attributes.get("headOption1:aria-pressed"), "true");

  // Opposite arrows move Point heads in opposite directions without jumping
  // when the direction is changed.
  queuedFrame(2_050);
  const contactPhases = () => [...elements.get("contactStream").innerHTML.matchAll(/u ([\d.]+)/g)]
    .map((match) => Number(match[1]));
  const beforeDirectionStep = contactPhases();
  elements.get("position").value = "0.35";
  listeners.get("position:input")();
  queuedFrame(2_060);
  const afterDirectionStep = contactPhases();
  const signedPhaseDelta = (before, after) => ((after - before + 1.5) % 1) - 0.5;
  assert.ok(Math.abs(signedPhaseDelta(beforeDirectionStep[0], afterDirectionStep[0]) - 0.1) < 0.002);
  assert.ok(Math.abs(signedPhaseDelta(beforeDirectionStep[1], afterDirectionStep[1]) + 0.1) < 0.002);

  listeners.get("headMarker1:pointerdown")({
    clientX: 75,
    pointerId: 7,
    preventDefault() {},
  });
  assert.equal(elements.get("headMarker1").style.left, "25%");
  listeners.get("headLayoutTrack:pointerup")({ pointerId: 7 });
  listeners.get("resetHeadSpacing:click")();
  assert.ok(Math.abs(parseFloat(elements.get("headMarker1").style.left) - 33.333) < 0.01);

  elements.get("heads").value = "12";
  listeners.get("heads:input")();
  queuedFrame(2_500);
  assert.match(elements.get("stageReadout").textContent, /12 POINTS/);

  listeners.get("scanMode:click")();
  queuedFrame(3_000);
  assert.equal(elements.get("headsControl").hidden, true);
  assert.equal(elements.get("lineCountControl").hidden, false);
  assert.equal(elements.get("playheadMotion").hidden, false);
  assert.equal(elements.get("headOption3").hidden, false);
  assert.match(elements.get("stageReadout").textContent, /4 LINES/);
  assert.doesNotMatch(elements.get("stageReadout").textContent, /12 POINTS/);

  // Side count selects a continuous circle, open line, or a closed polygon /
  // star. The closed topology and star depth survive a temporary 1/2 choice.
  elements.get("sides").value = "1";
  listeners.get("sides:input")();
  assert.equal(elements.get("sidesOut").textContent, "1 · circle");
  assert.equal(elements.get("sidesControl").hidden, false);
  assert.equal(elements.get("closedShapeControl").hidden, true);
  assert.equal(elements.get("starDepthControl").hidden, true);
  assert.equal(elements.get("curvatureControl").hidden, true);
  assert.equal(elements.get("formSummary").textContent, "circle · no corners");
  assert.equal(elements.get("curvatureOut").textContent, "continuous contour");
  assert.equal(elements.get("amplitudeArticulation").hidden, true);
  assert.equal(elements.get("sineModeOption").textContent, "Sine Oscillators · continuous contour");
  queuedFrame(3_010);
  assert.equal(elements.get("levelRouteSource").textContent, "Continuous contour");
  assert.equal(elements.get("levelRouteCurve").textContent, "constant continuous level");
  assert.equal(elements.get("markDecayOut").textContent, "none");

  elements.get("sides").value = "2";
  listeners.get("sides:input")();
  assert.equal(elements.get("sidesOut").textContent, "2 · open line");
  assert.equal(elements.get("formSummary").textContent, "open line");
  assert.equal(elements.get("closedShapeControl").hidden, true);
  assert.equal(elements.get("curvatureControl").hidden, false);
  listeners.get("traceMode:click")();
  queuedFrame(3_011);
  assert.match(elements.get("amplitudeNodeReadout").textContent, /^A @ 7\.5 ms/);
  listeners.get("pingPongMotion:click")();
  queuedFrame(3_012);
  assert.match(elements.get("amplitudeNodeReadout").textContent, /^A @ 15 ms/);
  listeners.get("loopMotion:click")();
  listeners.get("scanMode:click")();
  queuedFrame(3_013);
  elements.get("sides").value = "3";
  listeners.get("sides:input")();
  assert.equal(elements.get("sidesOut").textContent, "3 · polygon");
  assert.equal(elements.get("formSummary").textContent, "3-point polygon");
  assert.equal(elements.get("closedShapeControl").hidden, false);

  listeners.get("starShape:click")();
  assert.equal(attributes.get("starShape:aria-pressed"), "true");
  assert.equal(attributes.get("polygonShape:aria-pressed"), "false");
  assert.equal(elements.get("sidesOut").textContent, "3 · star");
  assert.equal(elements.get("formSummary").textContent, "3-point star");
  assert.equal(elements.get("starDepthControl").hidden, false);
  elements.get("starDepth").value = "0.7";
  listeners.get("starDepth:input")();
  assert.equal(elements.get("starDepthOut").textContent, "70%");

  elements.get("sides").value = "1";
  listeners.get("sides:input")();
  assert.equal(elements.get("closedShapeControl").hidden, true);
  assert.equal(elements.get("starDepthControl").hidden, true);
  elements.get("sides").value = "2";
  listeners.get("sides:input")();
  assert.equal(elements.get("closedShapeControl").hidden, true);
  elements.get("sides").value = "7";
  listeners.get("sides:input")();
  assert.equal(attributes.get("starShape:aria-pressed"), "true");
  assert.equal(elements.get("sidesOut").textContent, "7 · star");
  assert.equal(elements.get("formSummary").textContent, "7-point star");
  assert.equal(elements.get("starDepthControl").hidden, false);
  assert.equal(elements.get("starDepthOut").textContent, "70%");

  elements.get("curvature").value = "-0.4";
  listeners.get("curvature:input")();
  assert.equal(elements.get("curvatureOut").textContent, "40% inward");
  elements.get("curvature").value = "0.4";
  listeners.get("curvature:input")();
  assert.equal(elements.get("curvatureOut").textContent, "40% outward");
  listeners.get("resetCurvature:click")();
  assert.equal(elements.get("curvature").value, "0");
  assert.equal(elements.get("curvatureOut").textContent, "straight");

  elements.get("aspect").value = "0.5";
  listeners.get("aspect:input")();
  assert.equal(elements.get("aspectOut").textContent, "50% wide");
  listeners.get("resetAspect:click")();
  assert.equal(elements.get("aspect").value, "0");
  assert.equal(elements.get("aspectOut").textContent, "even");

  elements.get("skew").value = "-0.35";
  listeners.get("skew:input")();
  assert.equal(elements.get("skewOut").textContent, "-35%");
  listeners.get("resetSkew:click")();
  assert.equal(elements.get("skew").value, "0");
  assert.equal(elements.get("skewOut").textContent, "0%");

  elements.get("curvature").value = "-0.25";
  listeners.get("curvature:input")();
  elements.get("aspect").value = "0.5";
  listeners.get("aspect:input")();
  elements.get("skew").value = "-0.35";
  listeners.get("skew:input")();
  listeners.get("resetForm:click")();
  assert.equal(elements.get("sidesOut").textContent, "7 · polygon");
  assert.equal(elements.get("sides").value, "7");
  assert.equal(attributes.get("polygonShape:aria-pressed"), "true");
  assert.equal(attributes.get("starShape:aria-pressed"), "false");
  assert.equal(elements.get("starDepth").value, "0.48");
  assert.equal(elements.get("starDepthOut").textContent, "48%");
  assert.equal(elements.get("starDepthControl").hidden, true);
  assert.equal(elements.get("curvature").value, "0");
  assert.equal(elements.get("curvatureOut").textContent, "straight");
  assert.equal(elements.get("aspect").value, "0");
  assert.equal(elements.get("aspectOut").textContent, "even");
  assert.equal(elements.get("skew").value, "0");
  assert.equal(elements.get("skewOut").textContent, "0%");

  elements.get("level").value = "0.73";
  listeners.get("level:input")();
  listeners.get("amplitudePresetSustain:click")();
  listeners.get("amplitudeNode4:keydown")({ key: "ArrowUp", shiftKey: true, preventDefault() {} });
  listeners.get("cornerSwellToggle:click")();
  elements.get("percussionStrikeLevel").value = "0.84";
  listeners.get("percussionStrikeLevel:input")();
  elements.get("percussionAttackNoise").value = "0.36";
  listeners.get("percussionAttackNoise:input")();
  listeners.get("percussionPresetPad:click")();
  elements.get("stereoWidth").value = "0.42";
  listeners.get("stereoWidth:input")();
  listeners.get("stereoVertical:click")();
  listeners.get("stereoInvert:click")();
  listeners.get("pitchHorizontal:click")();
  listeners.get("pitchCurveLogarithmic:click")();
  elements.get("percussionLevelSource").value = "incidence";
  listeners.get("percussionLevelSource:change")({ currentTarget: elements.get("percussionLevelSource") });
  elements.get("percussionLevelCurve").value = "exponential";
  listeners.get("percussionLevelCurve:change")({ currentTarget: elements.get("percussionLevelCurve") });
  elements.get("timbreSource").value = "phase";
  listeners.get("timbreSource:change")({ currentTarget: elements.get("timbreSource") });
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
  assert.equal(elements.get("amplitudeCurveState").textContent, "Custom · mirrored");
  assert.match(elements.get("amplitudeReleaseBehavior").textContent, /holds 5%/);
  assert.equal(attributes.get("cornerSwellToggle:aria-pressed"), "true");
  assert.equal(elements.get("percussionStrikeLevelOut").textContent, "84%");
  assert.equal(elements.get("percussionAttackNoiseOut").textContent, "36%");
  assert.equal(elements.get("percussionEnvelopeState").textContent, "Pad");
  assert.equal(elements.get("percussionNodeReadout").textContent, "A 350 ms · D 900 ms · S 2200 ms · R 3500 ms");
  assert.equal(elements.get("stereoWidthOut").textContent, "42%");
  assert.equal(attributes.get("stereoVertical:aria-pressed"), "true");
  assert.equal(attributes.get("stereoInvert:aria-pressed"), "true");
  assert.equal(elements.get("panRouteSource").textContent, "Vertical position");
  assert.equal(elements.get("panRouteCurve").textContent, "reversed · 42% width");
  assert.equal(elements.has("mappingFrame"), false);
  assert.equal(attributes.get("pitchHorizontal:aria-pressed"), "true");
  assert.equal(attributes.get("pitchCurveLogarithmic:aria-pressed"), "true");
  assert.equal(elements.get("percussionLevelSource").value, "incidence");
  assert.equal(elements.get("percussionLevelCurve").value, "exponential");
  assert.equal(elements.get("timbreSource").value, "phase");
  assert.equal(elements.get("fmIndexOut").textContent, "5.50 max");
  assert.equal(elements.get("pmIndexOut").textContent, "3.25 rad max");
  assert.equal(elements.get("shepardCyclesOut").textContent, "1.75 oct / circuit");
  assert.equal(elements.get("soundMode").value, "percussion");
  assert.equal(elements.get("amplitudeArticulation").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  assert.equal(elements.get("percussionMapping").hidden, false);
  assert.equal(storage.size, 0, "Shape settings should not persist across loads");

  queuedFrame(3_100);
  assert.equal(elements.get("outputVoiceLabel").textContent, "Percussion");
  assert.equal(elements.get("pitchRouteSource").textContent, "Horizontal position");
  assert.match(elements.get("pitchRouteCurve").textContent, /Logarithmic response/);
  assert.equal(elements.get("levelRouteSource").textContent, "Crossing angle");
  assert.equal(elements.get("levelRouteCurve").textContent, "expand highs");
  assert.notEqual(elements.get("markIncidenceOut").textContent, "");
  assert.match(elements.get("markDecayOut").textContent, /3500 ms ADSR/);

  sessionStorage.set("morphazoid:shape:reset:sides", "7");
  await import(`../app.js?smokeReload=${Date.now()}`);
  assert.equal(elements.get("sides").value, "7");
  assert.equal(elements.get("sidesOut").textContent, "7 · polygon");
  assert.equal(sessionStorage.size, 0, "the reset-only side count should be consumed once");
  assert.equal(elements.get("levelOut").textContent, "65%");
  assert.equal(elements.get("amplitudeCurveState").textContent, "Pluck");
  assert.equal(attributes.get("amplitudeEnvelopeToggle:aria-pressed"), "true");
  assert.equal(attributes.get("cornerSwellToggle:aria-pressed"), "false");
  assert.match(elements.get("amplitudeReleaseBehavior").textContent, /rests until next trigger/);
  assert.equal(elements.get("percussionStrikeLevelOut").textContent, "90%");
  assert.equal(elements.get("percussionAttackNoiseOut").textContent, "0%");
  assert.equal(elements.get("percussionEnvelopeState").textContent, "Pluck");
  assert.equal(elements.get("percussionNodeReadout").textContent, "A 3 ms · D 25 ms · S 55 ms · R 100 ms");
  assert.equal(elements.has("mappingFrame"), false);
  assert.equal(attributes.get("pitchVertical:aria-pressed"), "true");
  assert.equal(attributes.get("pitchHorizontal:aria-pressed"), "false");
  assert.equal(attributes.get("pitchCurveLinear:aria-pressed"), "true");
  assert.equal(attributes.get("stereoHorizontal:aria-pressed"), "true");
  assert.equal(attributes.get("stereoInvert:aria-pressed"), "false");
  assert.equal(elements.get("stereoWidthOut").textContent, "100%");
  assert.equal(elements.get("percussionLevelSource").value, "corner");
  assert.equal(elements.get("percussionLevelCurve").value, "linear");
  assert.equal(elements.get("timbreSource").value, "corner");
  assert.equal(elements.get("fmIndexOut").textContent, "3.00 max");
  assert.equal(elements.get("pmIndexOut").textContent, "2.00 rad max");
  assert.equal(elements.get("shepardCyclesOut").textContent, "1.00 oct / circuit");
  assert.equal(elements.get("soundMode").value, "sine");
  assert.equal(elements.get("amplitudeArticulation").hidden, false);
  assert.equal(elements.get("percussionArticulation").hidden, true);
  assert.equal(elements.get("percussionMapping").hidden, true);
  assert.equal(elements.get("timbreMapping").hidden, true);
});
