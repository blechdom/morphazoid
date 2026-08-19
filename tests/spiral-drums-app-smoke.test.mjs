import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPrototile, tilingInfo } from "../src/lattice.js";
import { MIDI_OUTPUT_PREVIEW_EVENT } from "../src/midi-output-preview.js";

test("spiral drum app starts and keeps its complete geometry editor interactive", async () => {
  const html = await readFile(new URL("../spiral-drums.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
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
      hidden: false,
      disabled: false,
      dataset: {},
      style: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      setPointerCapture() {},
      focus() {},
      click() {
        listeners.get(`${id}:click`)?.();
      },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);
  elements.get("timePath").querySelectorAll = () => [
    elements.get("radiusTime"),
    elements.get("angleTime"),
    elements.get("spiralTime"),
  ];
  elements.get("radiusTime").dataset.value = "radius";
  elements.get("radiusTime").textContent = "Radius";
  elements.get("angleTime").dataset.value = "angle";
  elements.get("angleTime").textContent = "Angle";
  elements.get("spiralTime").dataset.value = "spiral";
  elements.get("spiralTime").textContent = "Spiral";
  const playheadMotionButtons = [
    elements.get("loopMotion"),
    elements.get("pingPongMotion"),
  ];
  playheadMotionButtons[0].dataset.value = "loop";
  playheadMotionButtons[1].dataset.value = "pingpong";
  elements.get("playheadMotion").querySelectorAll = (selector) => (
    selector.includes("data-value") ? playheadMotionButtons : []
  );

  let drawnArcs = 0;
  const drawingContext = {
    arc() { drawnArcs += 1; },
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    setTransform() {},
    stroke() {},
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });
  const tileEditorCanvas = elements.get("tileEditorCanvas");
  tileEditorCanvas.getContext = () => drawingContext;
  tileEditorCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 320,
    height: 220,
  });
  elements.get("stageWrap").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });

  const rafQueue = [];
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
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
  globalThis.document = {
    hidden: false,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    addEventListener() {},
  };
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
  };
  const midiPreviewEvents = [];
  globalThis.dispatchEvent = (event) => {
    if (event.type === MIDI_OUTPUT_PREVIEW_EVENT) midiPreviewEvents.push(event.detail);
    return true;
  };

  function audioParam(value = 0) {
    return {
      value,
      setTargetAtTime(next) { this.value = next; },
      setValueAtTime(next) { this.value = next; },
      exponentialRampToValueAtTime(next) { this.value = next; },
      linearRampToValueAtTime(next) { this.value = next; },
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
  let audioContextCount = 0;
  globalThis.AudioContext = class {
    constructor() {
      audioContextCount += 1;
      this.currentTime = 0;
      this.sampleRate = 1_000;
      this.state = "running";
      this.destination = audioNode();
    }
    createAnalyser() {
      return audioNode({ fftSize: 0 });
    }
    createBiquadFilter() {
      return audioNode({
        type: "lowpass",
        frequency: audioParam(0),
        Q: audioParam(0),
      });
    }
    createBuffer(_channels, frameCount) {
      const samples = new Float32Array(frameCount);
      return { getChannelData() { return samples; } };
    }
    createBufferSource() {
      return audioNode({
        buffer: null,
        start() {},
        stop() {},
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
    createGain() {
      return audioNode({ gain: audioParam(0) });
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
    async resume() {
      this.state = "running";
    }
    async close() {
      this.state = "closed";
    }
  };

  let frameNow = performance.now();
  function flushAnimationFrames(now = frameNow + 20) {
    frameNow = Math.max(frameNow + 1, Number(now) || frameNow + 20);
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(frameNow);
  }

  await import(`../spiral-drums-app.js?smoke=${Date.now()}`);
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  assert.equal(
    attributes.get("playButton:data-no-midi-preview"),
    "",
    "the app's semantic transport preview should replace generic capture",
  );
  assert.equal(attributes.get("loopPlayButton:data-no-midi-preview"), "");

  const startupNoteCount = midiPreviewEvents.filter(({ kind }) => kind === "note").length;
  const startupPhaseCount = midiPreviewEvents.filter((event) => (
    event.kind === "control" && event.sourceId === "spiral-drums-reader-phase"
  )).length;
  await listeners.get("playButton:click")();
  const startupFrameNow = frameNow;
  for (const offset of [1, 6, 11, 16, 21, 26]) {
    flushAnimationFrames(startupFrameNow + offset);
  }
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    startupNoteCount,
    "Play before the startup RAF must not turn parked drum contacts into MIDI onsets",
  );
  assert.ok(
    midiPreviewEvents.filter((event) => (
      event.kind === "control" && event.sourceId === "spiral-drums-reader-phase"
    )).length - startupPhaseCount <= 1,
    "drum reader phase telemetry should be coalesced to one update per 40 ms window",
  );
  await listeners.get("playButton:click")();

  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "control"
    && event.routeId === "spiral-drums"
    && event.sourceId === "spiral-drums-reader-phase"
  )));
  for (const sourceId of [
    "spiral-drums-reader-path",
    "spiral-drums-reader-mode",
    "spiral-drums-reader-direction",
    "spiral-drums-zoom-direction",
  ]) {
    assert.ok(midiPreviewEvents.some((event) => (
      event.kind === "control"
      && event.routeId === "spiral-drums"
      && event.sourceId === sourceId
    )), `${sourceId} should publish an initial keyed control snapshot`);
  }
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "timebase"
    && event.sourceId === "spiral-drums-reader-timebase"
    && event.unit === "cycles/s"
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "timebase"
    && event.sourceId === "spiral-drums-zoom-timebase"
    && event.unit === "cycles/s"
    && event.running === false
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-drums-reader-transport"
    && event.state === "stop"
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-drums-zoom-transport"
    && event.state === "stop"
  )));
  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.equal(tileEditorCanvas.width, 640);
  assert.equal(tileEditorCanvas.height, 440);
  assert.match(elements.get("stageReadout").textContent, /^RADIUS · \d+ CONTACT/);
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);
  assert.equal(elements.get("windingSummary").textContent, "A1 · B5");
  assert.equal(elements.get("parameterCount").textContent, "2 parameters · guarded");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal(
    (elements.get("tilingType").innerHTML.match(/<option /g) ?? []).length,
    72,
  );
  assert.equal(
    (elements.get("drumMap").innerHTML.match(/class="spiral-drum-cell"/g) ?? []).length,
    16,
  );
  assert.equal(attributes.get("radiusTime:aria-pressed"), "true");
  assert.ok(drawnArcs > 0);
  for (const id of [
    "playheadMotion",
    "traversalDirection",
    "loopMotion",
    "pingPongMotion",
  ]) {
    assert.equal(elements.has(id), true, `primary transport should expose #${id}`);
  }
  assert.equal(elements.has("timeDirection"), false, "the legacy primary direction ID should be gone");
  assert.equal(elements.has("loopDirection"), true, "the secondary zoom direction remains separate");
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "→");
  assert.equal(elements.get("traversalDirectionText").textContent, "OUT→IN");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");

  const phaseBeforeDirectionToggle = Number(elements.get("position").value);
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "←");
  assert.equal(elements.get("traversalDirectionText").textContent, "IN→OUT");
  assert.equal(Number(elements.get("position").value), phaseBeforeDirectionToggle);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "→");
  assert.equal(elements.get("traversalDirectionText").textContent, "OUT→IN");

  elements.get("position").value = "0.999";
  listeners.get("position:input")({ isTrusted: false });
  const phaseBeforePingPong = Number(elements.get("position").value);
  listeners.get("pingPongMotion:click")();
  assert.equal(Number(elements.get("position").value), phaseBeforePingPong);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "false");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");

  const notesBeforeSilentTransport = midiPreviewEvents.filter(({ kind }) => kind === "note").length;
  elements.get("speed").value = "4";
  listeners.get("speed:input")();
  await listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 1);
  flushAnimationFrames(frameNow + 1);
  flushAnimationFrames(Math.max(frameNow + 180, performance.now() + 185));
  const silentTransportNotes = midiPreviewEvents
    .filter(({ kind }) => kind === "note")
    .slice(notesBeforeSilentTransport);
  assert.ok(
    silentTransportNotes.length > 0,
    "moving drum crossings must preview notes while Audio is off",
  );
  const drumPreview = silentTransportNotes[0];
  assert.equal(drumPreview.routeId, "spiral-drums");
  assert.equal(drumPreview.channel, 10);
  assert.ok(drumPreview.note >= 36 && drumPreview.note <= 51);
  assert.ok(drumPreview.voiceId);
  assert.ok(drumPreview.velocity >= 1 && drumPreview.velocity <= 127);
  assert.ok(drumPreview.durationMs > 0);
  assert.equal(drumPreview.frequencyHz, null, "drum routing uses its mapped pad note");
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-drums-reader-transport"
    && event.state === "start"
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "timebase"
    && event.sourceId === "spiral-drums-reader-timebase"
    && event.running === true
  )));
  const reflectedPhase = Number(elements.get("position").value);
  assert.ok(
    reflectedPhase < phaseBeforePingPong,
    "ping-pong motion should reflect at the upper phase boundary",
  );
  await listeners.get("playButton:click")();
  elements.get("speed").value = ".12";
  listeners.get("speed:input")();
  flushAnimationFrames(frameNow + 20);

  listeners.get("loopMotion:click")();
  assert.equal(Number(elements.get("position").value), reflectedPhase);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  listeners.get("pingPongMotion:click")();
  assert.equal(Number(elements.get("position").value), reflectedPhase);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "false");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  elements.get("speed").value = "4";
  listeners.get("speed:input")();
  await listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 25);
  assert.ok(
    Number(elements.get("position").value) < reflectedPhase,
    "a loop/ping-pong round trip should preserve the reflected descending leg",
  );
  await listeners.get("playButton:click")();
  elements.get("speed").value = ".12";
  listeners.get("speed:input")();
  flushAnimationFrames(frameNow + 20);
  listeners.get("loopMotion:click")();
  elements.get("position").value = "0";
  listeners.get("position:input")({ isTrusted: false });

  const notesBeforeImmediateSyntheticPlay = midiPreviewEvents
    .filter(({ kind }) => kind === "note").length;
  await listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 1);
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeImmediateSyntheticPlay,
    "Play before a queued synthetic phase RAF must preserve MIDI drum-onset suppression",
  );
  await listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 1);

  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.notEqual(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(audioContextCount, 0, "Play must not create an AudioContext");
  await listeners.get("playButton:click")();
  await listeners.get("loopPlayButton:click")();
  assert.equal(attributes.get("loopPlayButton:aria-pressed"), "true");
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-drums-zoom-transport"
    && event.state === "start"
  )));
  assert.notEqual(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(audioContextCount, 0, "Loop Play must not create an AudioContext");
  await listeners.get("loopPlayButton:click")();

  const silentPosition = Number(elements.get("position").value);
  const notesBeforeSilentScrub = midiPreviewEvents.filter(({ kind }) => kind === "note").length;
  listeners.get("stage:pointerdown")({
    clientX: 690,
    clientY: 260,
    pointerId: 31,
    isTrusted: true,
  });
  listeners.get("stage:pointermove")({
    clientX: 610,
    clientY: 190,
    pointerId: 31,
    isTrusted: true,
  });
  flushAnimationFrames(frameNow + 80);
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(Number(elements.get("position").value), silentPosition);
  assert.equal(oscillators.length, 0, "Audio off must keep a direct scrub silent");
  assert.ok(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length > notesBeforeSilentScrub,
    "a genuine Audio-off scrub still exposes its mapped drum notes",
  );
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO OFF$/);
  listeners.get("stage:lostpointercapture")({ pointerId: 31 });

  await listeners.get("playButton:click")();
  flushAnimationFrames(performance.now() + 120);
  const positionBeforeAudioTap = Number(elements.get("position").value);
  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(audioContextCount, 1, "only the explicit Audio action should create audio");
  assert.equal(
    Number(elements.get("position").value),
    positionBeforeAudioTap,
    "enabling Audio must not restart spiral motion",
  );
  assert.equal(oscillators.length, 0, "arming Audio must not strike existing contacts");
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  const strikesBeforeParkedSlider = oscillators.length;
  const notesBeforeParkedSlider = midiPreviewEvents.filter(({ kind }) => kind === "note").length;
  listeners.get("position:pointerdown")({ pointerId: 35, isTrusted: true });
  flushAnimationFrames(performance.now() + 140);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · AUDIO ON$/);
  assert.equal(
    oscillators.length,
    strikesBeforeParkedSlider,
    "arming a parked phase slider must not strike its current contacts",
  );
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeParkedSlider,
    "arming a parked phase slider must not invent MIDI drum onsets",
  );
  listeners.get("position:pointercancel")({ pointerId: 35 });
  flushAnimationFrames(performance.now() + 160);
  listeners.get("stage:pointerdown")({
    clientX: 310,
    clientY: 430,
    pointerId: 32,
    isTrusted: true,
  });
  listeners.get("stage:pointermove")({
    clientX: 790,
    clientY: 150,
    pointerId: 32,
    isTrusted: true,
  });
  flushAnimationFrames(performance.now() + 180);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · AUDIO ON$/);
  assert.ok(
    oscillators.length > 0,
    "an Audio-on scrub should strike newly crossed contacts with Play stopped",
  );
  const stoppedScrubOscillators = oscillators.length;
  flushAnimationFrames(performance.now() + 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    oscillators.length,
    stoppedScrubOscillators,
    "a stationary scrub must not retrigger an already-held contact",
  );
  listeners.get("stage:lostpointercapture")({ pointerId: 32 });
  flushAnimationFrames(performance.now() + 220);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);

  const keyboardPosition = Number(elements.get("position").value);
  listeners.get("stage:keydown")({
    key: "ArrowRight",
    shiftKey: false,
    isTrusted: true,
    preventDefault() {},
  });
  flushAnimationFrames(performance.now() + 240);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(Number(elements.get("position").value) > keyboardPosition);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · AUDIO ON$/);
  listeners.get("stage:keyup")({ key: "ArrowRight" });
  flushAnimationFrames(performance.now() + 260);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);

  const strikesBeforeManualZoom = oscillators.length;
  listeners.get("loopPhase:pointerdown")({ pointerId: 33, isTrusted: true });
  elements.get("loopPhase").value = ".18";
  listeners.get("loopPhase:input")({ isTrusted: true });
  flushAnimationFrames(frameNow + 400);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("loopPlayButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · AUDIO ON$/);
  assert.ok(
    oscillators.length > strikesBeforeManualZoom,
    "manual deep zoom should strike crossings with its transport stopped",
  );
  listeners.get("loopPhase:pointercancel")({ pointerId: 33 });
  flushAnimationFrames(performance.now() + 420);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);

  const strikesBeforeSyntheticMovement = oscillators.length;
  const notesBeforeSyntheticMovement = midiPreviewEvents
    .filter(({ kind }) => kind === "note").length;
  elements.get("position").value = ".62";
  listeners.get("position:input")({ isTrusted: false });
  flushAnimationFrames(performance.now() + 440);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    oscillators.length,
    strikesBeforeSyntheticMovement,
    "a synthetic phase update must not strike stopped drums",
  );
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeSyntheticMovement,
    "a synthetic phase update must not masquerade as a MIDI drum crossing",
  );

  elements.get("patternRotation").value = "35";
  listeners.get("patternRotation:input")({ isTrusted: true });
  flushAnimationFrames(performance.now() + 460);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    oscillators.length,
    strikesBeforeSyntheticMovement,
    "structural pattern edits remain onset-suppressed",
  );
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeSyntheticMovement,
    "structural geometry changes must remain MIDI-onset suppressed",
  );
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);

  const strikesBeforePlay = oscillators.length;
  listeners.get("playButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(performance.now() + 580);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.ok(
    oscillators.length > strikesBeforePlay,
    "starting Spiral time should still trigger FM drums after manual audition",
  );
  listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");

  listeners.get("spiralTime:click")();
  assert.equal(attributes.get("spiralTime:aria-pressed"), "true");
  assert.equal(elements.get("readerTurnsControl").hidden, false);
  assert.match(elements.get("coordinateReadout").textContent, /LOG R \+ THETA/);
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "←");
  assert.equal(elements.get("traversalDirectionText").textContent, "CCW");

  elements.get("spiralA").value = "2";
  listeners.get("spiralA:input")();
  flushAnimationFrames();
  assert.equal(elements.get("windingSummary").textContent, "A2 · B5");
  elements.get("spiralA").value = "0";
  listeners.get("spiralA:input")();
  elements.get("spiralB").value = "0";
  listeners.get("spiralB:input")();
  assert.equal(elements.get("spiralA").value, "1", "A and B may not both be zero");

  elements.get("loopPhase").value = ".25";
  listeners.get("loopPhase:input")();
  flushAnimationFrames();
  assert.match(elements.get("loopPhaseOut").textContent, /1\.59 · IN/);

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
  const parametersBeforeDrag = [
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
  ], parametersBeforeDrag);
  listeners.get("tileEditorCanvas:pointerup")({ pointerId: 2 });
  listeners.get("resetTileVertices:click")();
  assert.equal(elements.get("parameter0Out").textContent, "0.105");
  assert.equal(elements.get("parameter1Out").textContent, "0.650");

  elements.get("tilingType").value = "1";
  listeners.get("tilingType:change")();
  flushAnimationFrames();
  assert.match(elements.get("formSummary").textContent, /IH01/);
  assert.equal(elements.get("parameterCount").textContent, "4 parameters · guarded");
  elements.get("edgeCurve1").value = ".7";
  listeners.get("edgeCurve1:input")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "70% forward");
  listeners.get("straightenEdges:click")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "straight");

  elements.get("tilingType").value = "31";
  listeners.get("tilingType:change")();
  assert.equal(elements.get("edgeCount").textContent, "0 bendable classes");
  assert.equal(elements.get("edgeControl0").hidden, true);
  assert.equal(elements.get("resetTileVertices").disabled, true);
  assert.equal(elements.get("tileEditorLegend").textContent, "symmetry-locked corners");

  elements.get("mappingMode").value = "reader-incidence";
  listeners.get("mappingMode:change")();
  assert.equal(elements.get("mappingSummary").textContent, "reader path × incidence");

  const positionBeforeScrub = Number(elements.get("position").value);
  listeners.get("stage:pointerdown")({
    clientX: 690,
    clientY: 260,
    pointerId: 4,
  });
  listeners.get("stage:pointermove")({
    clientX: 610,
    clientY: 190,
    pointerId: 4,
  });
  listeners.get("stage:pointerup")({ pointerId: 4 });
  assert.notEqual(Number(elements.get("position").value), positionBeforeScrub);

  listeners.get("pingPongMotion:click")();
  assert.equal(attributes.get("loopMotion:aria-pressed"), "false");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  assert.equal(elements.get("traversalDirectionText").textContent, "REV");
  listeners.get("resetSpiralDrums:click")();
  flushAnimationFrames();
  assert.equal(elements.get("tilingType").value, "20");
  assert.equal(elements.get("spiralA").value, "1");
  assert.equal(elements.get("spiralB").value, "5");
  assert.equal(elements.get("position").value, "0");
  assert.equal(elements.get("loopPhase").value, "0");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "→");
  assert.equal(elements.get("traversalDirectionText").textContent, "OUT→IN");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Time direction: Out → In");
  assert.equal(elements.get("mappingMode").value, "radius-angle");
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);

  for (const legacyId of [
    "soundMode",
    "amplitudeControl",
    "percussionArticulation",
    "pitchSource",
    "voiceCap",
  ]) {
    assert.equal(elements.has(legacyId), false);
  }
});
