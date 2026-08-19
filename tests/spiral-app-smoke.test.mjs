import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MIDI_OUTPUT_PREVIEW_EVENT } from "../src/midi-output-preview.js";

test("spiral app renders intrinsic readers and plays tessellation contacts", async () => {
  const html = await readFile(new URL("../spiral.html", import.meta.url), "utf8");
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
      selectedOptions: [{ textContent: "Log radius" }],
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
      },
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 }; },
      setPointerCapture() {},
      focus() {},
      click() { listeners.get(`${id}:click`)?.(); },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);
  elements.get("timePath").querySelectorAll = () => [
    elements.get("radiusTime"), elements.get("angleTime"), elements.get("spiralTime"),
  ];
  elements.get("radiusTime").dataset.value = "radius";
  elements.get("angleTime").dataset.value = "angle";
  elements.get("spiralTime").dataset.value = "spiral";
  const playheadMotionButtons = [
    elements.get("loopMotion"),
    elements.get("pingPongMotion"),
  ];
  playheadMotionButtons[0].dataset.value = "loop";
  playheadMotionButtons[1].dataset.value = "pingpong";
  elements.get("playheadMotion").querySelectorAll = (selector) => (
    selector.includes("data-value") ? playheadMotionButtons : []
  );
  elements.get("pitchSource").value = "angleShape";
  elements.get("pitchSource").selectedOptions = [{ textContent: "Angle + tile shape" }];

  let drawnArcs = 0;
  const drawnLinePoints = [];
  const drawingContext = {
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo(x, y) {
      if (drawnLinePoints.length < 200) {
        drawnLinePoints.push([Number(x.toFixed(3)), Number(y.toFixed(3))]);
      }
    },
    moveTo() {},
    setTransform() {},
    stroke() {},
    arc() { drawnArcs += 1; },
  };
  elements.get("stage").getContext = () => drawingContext;
  elements.get("tileEditorCanvas").getContext = () => drawingContext;
  elements.get("tileEditorCanvas").getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 220 });
  elements.get("stageWrap").getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });

  let queuedFrame;
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
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
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
  let audioContextCount = 0;
  globalThis.AudioContext = class {
    constructor() {
      audioContextCount += 1;
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
        threshold: audioParam(0), knee: audioParam(0), ratio: audioParam(0),
        attack: audioParam(0), release: audioParam(0),
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

  await import(`../spiral-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  assert.equal(
    attributes.get("playButton:data-no-midi-preview"),
    "",
    "the app's semantic transport preview should replace generic capture",
  );
  assert.equal(attributes.get("loopPlayButton:data-no-midi-preview"), "");

  const startupNoteCount = midiPreviewEvents.filter(({ kind }) => kind === "note").length;
  const startupPhaseCount = midiPreviewEvents.filter((event) => (
    event.kind === "control" && event.sourceId === "spiral-reader-phase"
  )).length;
  await listeners.get("playButton:click")();
  let now = performance.now();
  for (const offset of [0, 5, 10, 15, 20, 25]) queuedFrame(now + offset);
  now += 25;
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    startupNoteCount,
    "Play before the startup RAF must not turn parked contacts into MIDI onsets",
  );
  assert.ok(
    midiPreviewEvents.filter((event) => (
      event.kind === "control" && event.sourceId === "spiral-reader-phase"
    )).length - startupPhaseCount <= 1,
    "reader phase telemetry should be coalesced to one update per 40 ms window",
  );
  await listeners.get("playButton:click")();

  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "control"
    && event.routeId === "spiral"
    && event.sourceId === "spiral-reader-phase"
  )));
  for (const sourceId of [
    "spiral-reader-path",
    "spiral-reader-mode",
    "spiral-reader-direction",
    "spiral-zoom-direction",
  ]) {
    assert.ok(midiPreviewEvents.some((event) => (
      event.kind === "control"
      && event.routeId === "spiral"
      && event.sourceId === sourceId
    )), `${sourceId} should publish an initial keyed control snapshot`);
  }
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "timebase"
    && event.sourceId === "spiral-reader-timebase"
    && event.unit === "cycles/s"
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "timebase"
    && event.sourceId === "spiral-zoom-timebase"
    && event.unit === "cycles/s"
    && event.running === false
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-reader-transport"
    && event.state === "stop"
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-zoom-transport"
    && event.state === "stop"
  )));
  assert.equal(elements.has("intersectionDecay"), false);
  assert.equal(elements.has("intersectionDecayControl"), false);
  assert.match(elements.get("amplitudeControl").innerHTML, /Release 1400 ms/);
  assert.match(elements.get("amplitudeControl").innerHTML, /Node positions are milliseconds/);

  assert.equal(elements.get("stage").width, 1800);
  assert.equal(elements.get("stage").height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^RADIUS .+ CONTACT/);
  assert.match(elements.get("formSummary").textContent, /Pentagon .+ IH20/);
  assert.equal(elements.get("windingSummary").textContent, "A1 · B5");
  assert.equal(elements.get("parameterCount").textContent, "2 parameters · guarded");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal((elements.get("tilingType").innerHTML.match(/<option /g) ?? []).length, 72);
  assert.equal(attributes.get("radiusTime:aria-pressed"), "true");
  assert.equal(attributes.get("sizeCoupling:aria-pressed"), "false");
  assert.equal(elements.get("mappingSummary").textContent, "Angle + tile shape → pitch");
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
  now += 1;
  queuedFrame(now);
  now += 1;
  queuedFrame(now);
  now = Math.max(now + 180, performance.now() + 185);
  queuedFrame(now);
  const silentTransportNotes = midiPreviewEvents
    .filter(({ kind }) => kind === "note")
    .slice(notesBeforeSilentTransport);
  assert.ok(
    silentTransportNotes.length > 0,
    "moving crossings must preview notes while Audio is off",
  );
  const pitchedPreview = silentTransportNotes[0];
  assert.equal(pitchedPreview.routeId, "spiral");
  assert.equal(pitchedPreview.channel, 1);
  assert.ok(pitchedPreview.voiceId);
  assert.ok(pitchedPreview.velocity >= 1 && pitchedPreview.velocity <= 127);
  assert.ok(pitchedPreview.durationMs > 0);
  assert.ok(pitchedPreview.frequencyHz > 0);
  assert.equal(
    pitchedPreview.note,
    Math.round(Math.min(127, Math.max(
      0,
      69 + 12 * Math.log2(pitchedPreview.frequencyHz / 440),
    ))),
    "the displayed MIDI note must be the nearest note to the exact rendered frequency",
  );
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-reader-transport"
    && event.state === "start"
  )));
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "timebase"
    && event.sourceId === "spiral-reader-timebase"
    && event.running === true
  )));
  const reflectedPhase = Number(elements.get("position").value);
  assert.ok(
    reflectedPhase < phaseBeforePingPong,
    "ping-pong motion should reflect at the upper phase boundary",
  );
  await listeners.get("playButton:click")();
  elements.get("speed").value = "0.12";
  listeners.get("speed:input")();
  now += 20;
  queuedFrame(now);

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
  now += 25;
  queuedFrame(now);
  assert.ok(
    Number(elements.get("position").value) < reflectedPhase,
    "a loop/ping-pong round trip should preserve the reflected descending leg",
  );
  await listeners.get("playButton:click")();
  elements.get("speed").value = "0.12";
  listeners.get("speed:input")();
  now += 20;
  queuedFrame(now);
  listeners.get("loopMotion:click")();
  elements.get("position").value = "0";
  listeners.get("position:input")({ isTrusted: false });
  now += 20;
  queuedFrame(now);

  const notesBeforeImmediateSyntheticPlay = midiPreviewEvents
    .filter(({ kind }) => kind === "note").length;
  elements.get("position").value = "0.62";
  listeners.get("position:input")({ isTrusted: false });
  await listeners.get("playButton:click")();
  now += 1;
  queuedFrame(now);
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeImmediateSyntheticPlay,
    "Play before a queued synthetic phase RAF must preserve MIDI onset suppression",
  );
  await listeners.get("playButton:click")();
  now += 1;
  queuedFrame(now);

  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(audioContextCount, 0, "Play must not create an AudioContext");
  await listeners.get("playButton:click")();
  await listeners.get("loopPlayButton:click")();
  assert.equal(attributes.get("loopPlayButton:aria-pressed"), "true");
  assert.ok(midiPreviewEvents.some((event) => (
    event.kind === "transport"
    && event.sourceId === "spiral-zoom-transport"
    && event.state === "start"
  )));
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
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
  now += 20;
  queuedFrame(now);
  assert.notEqual(Number(elements.get("position").value), silentPosition);
  assert.equal(oscillators.length, 0, "Audio off must keep a direct scrub silent");
  assert.ok(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length > notesBeforeSilentScrub,
    "a genuine Audio-off scrub still exposes its crossed notes in the monitor",
  );
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO OFF$/);
  listeners.get("stage:lostpointercapture")({ pointerId: 31 });

  await listeners.get("playButton:click")();
  now += 80;
  queuedFrame(now);
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
  assert.equal(oscillators.length, 16);
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  const parkedGains = gains.slice(1, 17);
  const notesBeforeParkedSlider = midiPreviewEvents.filter(({ kind }) => kind === "note").length;
  listeners.get("position:pointerdown")({ pointerId: 35, isTrusted: true });
  now += 20;
  queuedFrame(now);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · AUDIO ON$/);
  assert.ok(
    parkedGains.every((gain) => gain.gain.value === 0),
    "arming a parked phase slider must not voice its current intersections",
  );
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeParkedSlider,
    "arming a parked phase slider must not invent MIDI note onsets",
  );
  listeners.get("position:pointercancel")({ pointerId: 35 });
  now += 20;
  queuedFrame(now);
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
  now += 20;
  queuedFrame(now);
  now += 60;
  queuedFrame(now);
  const stoppedScrubGains = gains.slice(1, 17);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · \d+ VOICES?$/);
  assert.ok(
    stoppedScrubGains.some((gain) => gain.gain.value > 0),
    "an Audio-on scrub should voice reader intersections with Play stopped",
  );
  listeners.get("stage:lostpointercapture")({ pointerId: 32 });
  assert.ok(
    stoppedScrubGains.every((gain) => gain.gain.value === 0),
    "lost pointer capture must release stopped scrub voices",
  );
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);

  const keyboardPosition = Number(elements.get("position").value);
  listeners.get("stage:keydown")({
    key: "ArrowRight",
    shiftKey: false,
    isTrusted: true,
    preventDefault() {},
  });
  now += 20;
  queuedFrame(now);
  assert.ok(Number(elements.get("position").value) > keyboardPosition);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · \d+ VOICES?$/);
  listeners.get("stage:keyup")({ key: "ArrowRight" });
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);

  listeners.get("loopPhase:pointerdown")({ pointerId: 33, isTrusted: true });
  elements.get("loopPhase").value = "0.18";
  listeners.get("loopPhase:input")({ isTrusted: true });
  now += 20;
  queuedFrame(now);
  now += 60;
  queuedFrame(now);
  assert.equal(attributes.get("loopPlayButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUB · \d+ VOICES?$/);
  assert.ok(
    stoppedScrubGains.some((gain) => gain.gain.value > 0),
    "manual deep zoom should voice crossings with its transport stopped",
  );
  listeners.get("loopPhase:pointercancel")({ pointerId: 33 });
  assert.ok(stoppedScrubGains.every((gain) => gain.gain.value === 0));
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);

  const notesBeforeSyntheticMovement = midiPreviewEvents
    .filter(({ kind }) => kind === "note").length;
  elements.get("position").value = "0.62";
  listeners.get("position:input")({ isTrusted: false });
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);
  assert.ok(
    stoppedScrubGains.every((gain) => gain.gain.value === 0),
    "a synthetic phase update must not open stopped voices",
  );
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeSyntheticMovement,
    "a synthetic phase update must not masquerade as a MIDI note crossing",
  );

  elements.get("patternRotation").value = "35";
  listeners.get("patternRotation:input")({ isTrusted: true });
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /PAUSED · AUDIO ON$/);
  assert.ok(
    stoppedScrubGains.every((gain) => gain.gain.value === 0),
    "structural pattern edits remain onset-suppressed",
  );
  assert.equal(
    midiPreviewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeSyntheticMovement,
    "structural geometry changes must remain MIDI-onset suppressed",
  );

  const oscillatorsBeforePausedPercussion = oscillators.length;
  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")();
  now += 20;
  queuedFrame(now);
  assert.equal(
    oscillators.length,
    oscillatorsBeforePausedPercussion,
    "selecting percussion while paused must not create a passive strike",
  );
  listeners.get("stage:pointerdown")({
    clientX: 720,
    clientY: 390,
    pointerId: 34,
    isTrusted: true,
  });
  listeners.get("stage:pointermove")({
    clientX: 260,
    clientY: 170,
    pointerId: 34,
    isTrusted: true,
  });
  now += 100;
  queuedFrame(now);
  assert.ok(
    oscillators.length > oscillatorsBeforePausedPercussion,
    "percussion should strike crossings during a stopped direct scrub",
  );
  listeners.get("stage:pointerup")({ pointerId: 34 });
  elements.get("soundMode").value = "sine";
  listeners.get("soundMode:change")();

  listeners.get("spiralTime:click")();
  assert.equal(attributes.get("spiralTime:aria-pressed"), "true");
  assert.equal(elements.get("readerTurnsControl").hidden, false);
  assert.match(elements.get("coordinateReadout").textContent, /LOG R \+ THETA/);
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "←");
  assert.equal(elements.get("traversalDirectionText").textContent, "CCW");

  elements.get("spiralA").value = "2";
  listeners.get("spiralA:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(elements.get("windingSummary").textContent, "A2 · B5");
  const geometryBeforeLoop = drawnLinePoints.slice();
  drawnLinePoints.length = 0;

  elements.get("position").value = "0.45";
  listeners.get("position:input")();
  elements.get("loopPhase").value = "0.25";
  listeners.get("loopPhase:input")();
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("loopPhaseOut").textContent, /1\.59 · IN/);
  assert.notDeepEqual(drawnLinePoints, geometryBeforeLoop);
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.ok(oscillators.length >= 16, "the sixteen-voice continuous pool remains available");
  now += 60;
  queuedFrame(now);
  assert.equal(Number(elements.get("loopPhase").value), 0.25);
  assert.ok(Number(elements.get("position").value) < 0.45);
  const voiceGains = gains.slice(1, 17);
  assert.ok(voiceGains.some((gain) => gain.gain.value > 0));
  assert.ok(oscillators.some((oscillator) => oscillator.frequency.value !== 220));
  assert.ok(new Set(oscillators.map((oscillator) => (
    oscillator.frequency.value.toFixed(3)
  ))).size > 3);
  assert.match(elements.get("stageReadout").textContent, /VOICE/);

  elements.get("speed").value = "0";
  listeners.get("speed:input")();
  now += 1_500;
  queuedFrame(now);
  assert.ok(
    voiceGains.every((gain) => gain.gain.value === 0),
    "the timed Sustain envelope must be silent after its 1400 ms Release",
  );

  await listeners.get("playButton:click")();
  const stationaryPosition = Number(elements.get("position").value);
  await listeners.get("loopPlayButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(attributes.get("loopPlayButton:aria-pressed"), "true");
  now += 60;
  queuedFrame(now);
  assert.equal(Number(elements.get("position").value), stationaryPosition);
  assert.ok(Number(elements.get("loopPhase").value) > 0.25);

  listeners.get("radiusTime:click")();
  const uncoupledFrequencies = oscillators.map((oscillator) => oscillator.frequency.value);
  listeners.get("sizeCoupling:click")();
  assert.equal(attributes.get("sizeCoupling:aria-pressed"), "true");
  assert.match(elements.get("sizeCoupling").textContent, /on$/);
  assert.equal(elements.get("mappingSummary").textContent, "Angle + tile shape + size → pitch/time");
  assert.match(elements.get("coordinateReadout").textContent, /^R ·/);
  now += 20;
  queuedFrame(now);
  assert.ok(oscillators.some((oscillator, index) => (
    Math.abs(oscillator.frequency.value - uncoupledFrequencies[index]) > 1e-6
  )));

  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")();
  assert.equal(elements.get("amplitudeControl").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  elements.get("percussionDecay").value = "720";
  listeners.get("percussionDecay:input")();
  assert.equal(elements.get("percussionDecayOut").textContent, "720 ms");

  const beforeScrub = Number(elements.get("position").value);
  listeners.get("stage:pointerdown")({ clientX: 690, clientY: 260, pointerId: 4 });
  listeners.get("stage:pointermove")({ clientX: 610, clientY: 190, pointerId: 4 });
  listeners.get("stage:pointerup")({ pointerId: 4 });
  assert.notEqual(Number(elements.get("position").value), beforeScrub);
});
