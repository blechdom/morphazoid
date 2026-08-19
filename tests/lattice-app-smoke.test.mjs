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
        const key = `${id}:${type}`;
        const existing = listeners.get(key);
        listeners.set(key, existing
          ? (...args) => {
            existing(...args);
            return listener(...args);
          }
          : listener);
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
  elements.get("playheadMotion").querySelectorAll = () => [
    elements.get("loopMotion"),
    elements.get("pingPongMotion"),
  ];
  elements.get("loopMotion").dataset.value = "loop";
  elements.get("pingPongMotion").dataset.value = "pingpong";

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
  const previewEvents = [];
  const previousCustomEvent = globalThis.CustomEvent;
  const previousDispatchEvent = globalThis.dispatchEvent;
  globalThis.CustomEvent = class {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.dispatchEvent = (event) => {
    previewEvents.push(event.detail);
    return true;
  };

  await import(`../lattice-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  let now = performance.now() + 20;
  queuedFrame(now);

  assert.equal(attributes.get("playButton:data-no-midi-preview"), "");
  assert.equal(attributes.get("position:data-no-midi-preview"), "");
  assert.equal(attributes.get("speed:data-no-midi-preview"), "");

  const parkedNoteCount = previewEvents.filter(({ kind }) => kind === "note").length;
  await listeners.get("playButton:click")();
  queuedFrame(performance.now());
  assert.equal(
    previewEvents.filter(({ kind }) => kind === "note").length,
    parkedNoteCount,
    "starting on parked lattice contacts must not publish a MIDI note burst",
  );
  await listeners.get("playButton:click")();

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^1 LINE .+ CONTACT/);
  assert.doesNotMatch(elements.get("stageReadout").textContent, /WALK/);
  assert.match(elements.get("formSummary").textContent, /Pentagon .+ IH20/);
  assert.equal(elements.get("angleOut").textContent, "90.0\u00b0");
  assert.equal(elements.get("parameterCount").textContent, "2 parameters · guarded");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal(elements.get("edgeCurve0Out").textContent, "straight");
  assert.equal(elements.get("contactLevelOut").textContent, "35%");
  assert.equal(elements.get("intersectionAccentOut").textContent, "75%");
  assert.equal(elements.has("intersectionDecay"), false);
  assert.equal(elements.has("intersectionDecayOut"), false);
  assert.equal(elements.get("voiceCapOut").textContent, "8 voices");
  assert.equal(
    (elements.get("tilingType").innerHTML.match(/<option /g) ?? []).length,
    72,
    "the selector should contain every Tactile isohedral family",
  );
  for (const id of [
    "playheadMotion",
    "traversalDirection",
    "loopMotion",
    "pingPongMotion",
  ]) {
    assert.ok(elements.has(id), `the Shape-style transport should expose #${id}`);
  }
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "\u2190");
  assert.equal(elements.get("traversalDirectionText").textContent, "REV");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Pattern direction: reverse");

  const phaseBeforeDirectionToggle = Number(elements.get("position").value);
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "\u2192");
  assert.equal(elements.get("traversalDirectionText").textContent, "FWD");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Pattern direction: forward");
  assert.equal(
    Number(elements.get("position").value),
    phaseBeforeDirectionToggle,
    "changing direction must not reset the pattern phase",
  );
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "\u2190");

  elements.get("position").value = "0.73";
  listeners.get("position:input")({ isTrusted: false });
  now += 20;
  queuedFrame(now);
  const phaseBeforeMotionSwitch = Number(elements.get("position").value);
  listeners.get("pingPongMotion:click")();
  assert.equal(attributes.get("loopMotion:aria-pressed"), "false");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  now += 20;
  queuedFrame(now);
  assert.equal(
    Number(elements.get("position").value),
    phaseBeforeMotionSwitch,
    "switching from Loop to Ping-pong must preserve physical phase",
  );
  listeners.get("loopMotion:click")();
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  now += 20;
  queuedFrame(now);
  assert.equal(
    Number(elements.get("position").value),
    phaseBeforeMotionSwitch,
    "switching back to Loop must preserve physical phase",
  );

  elements.get("position").value = "0.997";
  listeners.get("position:input")({ isTrusted: false });
  listeners.get("traversalDirection:click")();
  listeners.get("pingPongMotion:click")();
  await listeners.get("playButton:click")();
  const firstStartPreview = previewEvents
    .filter(({ kind }) => kind === "transport")
    .at(-1);
  assert.equal(firstStartPreview?.routeId, "lattice");
  assert.equal(firstStartPreview?.sourceId, "lattice-transport");
  assert.equal(firstStartPreview?.state, "start");
  // setPlaying() rebases the animation clock to the current wall clock. Rebase
  // this synthetic frame too so slower CI imports cannot leave it in the past.
  now = performance.now() + 500;
  queuedFrame(now);
  const reflectedPhase = Number(elements.get("position").value);
  assert.ok(
    reflectedPhase < 0.997,
    `Ping-pong must reverse after reaching the far endpoint (phase ${reflectedPhase})`,
  );
  assert.ok(reflectedPhase > 0.9, "Ping-pong must reflect at the endpoint instead of wrapping to zero");
  await listeners.get("playButton:click")();
  listeners.get("loopMotion:click")();
  listeners.get("traversalDirection:click")();
  elements.get("position").value = "0.5";
  listeners.get("position:input")({ isTrusted: false });
  now += 20;
  queuedFrame(now);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(elements.get("traversalDirectionText").textContent, "REV");

  assert.equal(elements.get("patternDirectionGlyph").textContent, "\u2190");
  assert.equal(elements.get("patternDirectionText").textContent, "R→L");
  assert.equal(elements.get("patternDirectionAngleOut").textContent, "R→L");
  listeners.get("patternDirection:click")();
  assert.equal(elements.get("patternDirectionAngle").value, "90");
  assert.equal(elements.get("patternDirectionGlyph").textContent, "\u2193");
  assert.equal(elements.get("patternDirectionAngleOut").textContent, "U→D");
  assert.equal(elements.get("angleOut").textContent, "90.0\u00b0");
  elements.get("patternDirectionAngle").value = "37.3";
  listeners.get("patternDirectionAngle:input")();
  assert.equal(elements.get("patternDirectionAngleOut").textContent, "37.3\u00b0");
  assert.equal(elements.get("angleOut").textContent, "90.0\u00b0");
  listeners.get("patternDirection:click")();
  listeners.get("patternDirection:click")();
  assert.equal(elements.get("patternDirectionAngleOut").textContent, "R→L");
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.ok(drawnArcs > 0, "line contacts should be drawn");
  assert.match(elements.get("outputContactLabel").textContent, /Contact 1 of/);
  assert.equal(elements.get("tileEditorPanel").hidden, false);
  assert.equal(tileEditorCanvas.width, 640);
  assert.equal(tileEditorCanvas.height, 440);
  assert.equal(elements.get("soundMode").value, "sine");
  assert.equal(elements.get("percussionArticulation").hidden, true);
  assert.equal(elements.get("shepardArticulation").hidden, true);
  assert.equal(elements.get("fmArticulation").hidden, true);
  assert.equal(elements.get("pmArticulation").hidden, true);
  assert.equal(elements.get("speedOut").textContent, "0.080 cyc/s");
  elements.get("density").value = "0.8";
  listeners.get("density:input")();
  now += 20;
  queuedFrame(now);
  assert.ok(Number.parseFloat(elements.get("speedOut").textContent) > 0.08);
  elements.get("density").value = "0.52";
  listeners.get("density:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(elements.get("speedOut").textContent, "0.080 cyc/s");
  assert.ok(previewEvents.some((event) => (
    event.kind === "control"
    && event.routeId === "lattice"
    && event.sourceId === "lattice-density"
  )));
  assert.ok(previewEvents.some((event) => (
    event.kind === "timebase"
    && event.routeId === "lattice"
    && event.sourceId === "lattice-timebase"
    && event.unit === "cycles/s"
  )));

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
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(audioContextCount, 0, "Play must not create an AudioContext");
  assert.equal(oscillators.length, 0);
  now += 50;
  queuedFrame(now);
  const positionBeforeAudioTap = Number(elements.get("position").value);
  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(audioContextCount, 1, "only the explicit Audio action should create audio");
  assert.equal(
    Number(elements.get("position").value),
    positionBeforeAudioTap,
    "enabling Audio must not restart the moving pattern",
  );
  assert.equal(oscillators.length, 16);
  assert.ok(oscillators.every((oscillator) => oscillator.type === "sine"));
  assert.ok(Math.abs(gains[0].gain.value - Math.sqrt(0.65)) < 1e-12);
  now += 50;
  queuedFrame(now);
  const voiceGains = gains.slice(1, 17);
  assert.ok(voiceGains.some((gain) => gain.gain.value > 0));
  const onsetCombinedGain = Math.hypot(...voiceGains.map((gain) => gain.gain.value));
  assert.ok(Number.isFinite(onsetCombinedGain));
  assert.ok(oscillators.some((oscillator) => oscillator.frequency.value !== 220));
  assert.ok(oscillators.every((oscillator) => (
    oscillator.frequency.value >= 110 && oscillator.frequency.value <= 1245
  )));
  const onsetFrequencies = oscillators.map((oscillator) => oscillator.frequency.value);
  now += 70;
  queuedFrame(now);
  assert.match(elements.get("stageReadout").textContent, /VOICE/);
  assert.ok(Number.isFinite(Math.hypot(...voiceGains.map((gain) => gain.gain.value))));
  now += 1500;
  queuedFrame(now);
  assert.ok(
    voiceGains.every((gain) => gain.gain.value === 0),
    "the editable envelope release must silence continuously tracked contacts",
  );
  assert.notDeepEqual(
    oscillators.map((oscillator) => oscillator.frequency.value),
    onsetFrequencies,
    "curve motion must keep steering pitch after the amplitude envelope ends",
  );
  elements.get("soundMode").value = "percussion";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  assert.equal(elements.get("amplitudeControl").hidden, true);
  assert.equal(elements.get("percussionArticulation").hidden, false);
  elements.get("percussionDecay").value = "650";
  listeners.get("percussionDecay:input")();
  assert.equal(elements.get("percussionDecayOut").textContent, "650 ms");

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
  assert.equal(oscillators.length, 16, "FM fallback must reuse the continuous pool");
  elements.get("parameter0").value = "0.15";
  listeners.get("parameter0:input")();
  now += 20;
  queuedFrame(now);
  assert.ok(
    voiceGains.every((gain) => gain.gain.value <= 0.1),
    "form edits must not reapply intersection accents to continuous synths",
  );

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
  for (let frameIndex = 0; frameIndex < 30 && oscillators.length === 16; frameIndex += 1) {
    now += 100;
    queuedFrame(now);
  }
  assert.ok(oscillators.length > 16, "new line intersections should trigger percussion strikes");
  const strikesBeforeFormEdit = oscillators.length;
  elements.get("parameter0").value = "0.18";
  listeners.get("parameter0:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(
    oscillators.length,
    strikesBeforeFormEdit,
    "form edits must not retrigger percussion contacts",
  );

  elements.get("soundMode").value = "sine";
  listeners.get("soundMode:change")({ currentTarget: elements.get("soundMode") });
  now += 80;
  queuedFrame(now);

  const activeCombinedGain = Math.hypot(...voiceGains.map((gain) => gain.gain.value));
  assert.ok(activeCombinedGain > 0);
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  now += 1000;
  queuedFrame(now);
  assert.ok(voiceGains.every((gain) => gain.gain.value === 0), "paused lattice must be silent");

  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.equal(gains[0].gain.value, 0, "audio off must mute the master bus");
  assert.ok(voiceGains.every((gain) => gain.gain.value === 0));
  const mutedNotesBeforeScan = previewEvents.filter(({ kind }) => kind === "note").length;
  elements.get("position").value = "0.68";
  listeners.get("position:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.ok(
    voiceGains.every((gain) => gain.gain.value === 0),
    "manual phase movement must respect Audio off as the master mute",
  );
  const mutedNotePreviews = previewEvents.filter(({ kind }) => kind === "note");
  assert.ok(
    mutedNotePreviews.length > mutedNotesBeforeScan,
    "a direct Audio-off scan should still publish physical crossing previews",
  );
  const mutedPreview = mutedNotePreviews.at(-1);
  assert.equal(mutedPreview.routeId, "lattice");
  assert.equal(mutedPreview.channel, 1);
  assert.ok(Number.isFinite(mutedPreview.frequencyHz));
  assert.equal(
    mutedPreview.note,
    Math.round(Math.min(127, Math.max(0, 69 + 12 * Math.log2(mutedPreview.frequencyHz / 440)))),
    "the preview note must be the nearest MIDI note to the exact rendered Hz",
  );
  const parkedPreviewCount = mutedNotePreviews.length;
  now += 40;
  queuedFrame(now);
  assert.equal(
    previewEvents.filter(({ kind }) => kind === "note").length,
    parkedPreviewCount,
    "a parked stopped playhead must remain preview-silent",
  );
  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  now += 20;
  queuedFrame(now);

  const scrubStart = Number(elements.get("position").value);
  elements.get("position").value = String((scrubStart + 0.19) % 1);
  listeners.get("position:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.match(elements.get("stageReadout").textContent, /SCRUBBING/);
  assert.ok(
    voiceGains.some((gain) => gain.gain.value > 0),
    "a stopped manual scan must voice newly crossed physical edges",
  );
  now += 120;
  queuedFrame(now);
  assert.ok(
    voiceGains.every((gain) => gain.gain.value === 0),
    "manual crossing voices must release instead of becoming a paused drone",
  );
  assert.match(elements.get("stageReadout").textContent, /PAUSED/);
  assert.equal(typeof listeners.get("stage:lostpointercapture"), "function");
  assert.equal(typeof listeners.get("position:lostpointercapture"), "function");

  listeners.get("stage:pointerdown")({ clientX: 450, clientY: 300, pointerId: 8 });
  const phaseBeforeUnrelatedPointer = elements.get("position").value;
  listeners.get("stage:pointermove")({ clientX: 620, clientY: 300, pointerId: 99 });
  now += 20;
  queuedFrame(now);
  assert.equal(elements.get("position").value, phaseBeforeUnrelatedPointer);
  assert.ok(voiceGains.every((gain) => gain.gain.value === 0));
  listeners.get("stage:lostpointercapture")({ pointerId: 99 });
  listeners.get("stage:pointermove")({ clientX: 620, clientY: 300, pointerId: 8 });
  now += 20;
  queuedFrame(now);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.ok(
    voiceGains.some((gain) => gain.gain.value > 0),
    "dragging the stopped lattice pattern must audition physical crossings",
  );
  listeners.get("stage:lostpointercapture")({ pointerId: 8 });
  now += 120;
  queuedFrame(now);
  assert.ok(voiceGains.every((gain) => gain.gain.value === 0));

  listeners.get("stage:pointerdown")({ clientX: 450, clientY: 300, pointerId: 10 });
  listeners.get("stage:pointermove")({ clientX: 610, clientY: 300, pointerId: 10 });
  now += 20;
  queuedFrame(now);
  assert.ok(voiceGains.some((gain) => gain.gain.value > 0));
  windowListeners.get("blur")();
  assert.ok(voiceGains.every((gain) => gain.gain.value === 0));
  const phaseAtBlur = elements.get("position").value;
  listeners.get("stage:pointermove")({ clientX: 700, clientY: 300, pointerId: 10 });
  now += 20;
  queuedFrame(now);
  assert.equal(elements.get("position").value, phaseAtBlur, "blur must clear the stage drag");

  windowListeners.get("keydown")({
    target: { tagName: "DIV" },
    key: "ArrowRight",
    shiftKey: true,
    preventDefault() {},
  });
  now += 20;
  queuedFrame(now);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.ok(
    voiceGains.some((gain) => gain.gain.value > 0),
    "Left/Right keyboard scans must share stopped crossing audition",
  );
  now += 120;
  queuedFrame(now);
  assert.ok(voiceGains.every((gain) => gain.gain.value === 0));

  const notesBeforeProgrammaticInput = previewEvents.filter(({ kind }) => kind === "note").length;
  listeners.get("position:pointerdown")({ pointerId: 11 });
  windowListeners.get("blur")();
  elements.get("position").value = String((Number(elements.get("position").value) + 0.2) % 1);
  listeners.get("position:input")({ isTrusted: false });
  now += 20;
  queuedFrame(now);
  assert.ok(
    voiceGains.every((gain) => gain.gain.value === 0),
    "programmatic range input must not masquerade as a direct stopped scrub",
  );
  assert.equal(
    previewEvents.filter(({ kind }) => kind === "note").length,
    notesBeforeProgrammaticInput,
    "synthetic phase input must not masquerade as a MIDI output crossing",
  );

  elements.get("voiceCap").value = "4";
  listeners.get("voiceCap:input")();
  now += 20;
  queuedFrame(now);
  assert.equal(voiceGains.filter((gain) => gain.gain.value > 0).length, 0);
  assert.match(elements.get("stageReadout").textContent, /0 VOICES/);

  const startPosition = Number(elements.get("position").value);
  listeners.get("pingPongMotion:click")();
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  await listeners.get("playButton:click")();
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  now += 100;
  queuedFrame(now);
  assert.notEqual(Number(elements.get("position").value), startPosition);
  assert.equal(voiceGains.filter((gain) => gain.gain.value > 0).length, 4);
  assert.match(elements.get("stageReadout").textContent, /4 VOICES/);
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

  elements.get("angle").value = "71.4";
  listeners.get("angle:input")();
  assert.equal(elements.get("angleOut").textContent, "71.4\u00b0");
  now += 20;
  queuedFrame(now);
  assert.ok(drawnArcs > 4);
  listeners.get("resetLineAngle:click")();
  assert.equal(elements.get("angle").value, "90");
  assert.equal(elements.get("angleOut").textContent, "90.0\u00b0");

  elements.get("tilingType").value = "1";
  listeners.get("tilingType:change")();
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("formSummary").textContent, /Hexagon .+ IH01/);
  assert.equal(elements.get("parameterCount").textContent, "4 parameters · guarded");
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
  assert.equal(elements.get("resetTileVertices").disabled, true);
  assert.equal(elements.get("tileEditorLegend").textContent, "symmetry-locked corners");

  elements.get("density").value = "0.8";
  listeners.get("density:input")();
  elements.get("tilingType").value = "71";
  listeners.get("tilingType:change")();
  now += 20;
  queuedFrame(now);
  assert.match(elements.get("densityOut").textContent, /limit/);
  assert.ok(Number(elements.get("density").value) < 0.8);

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
  assert.equal(elements.get("angleOut").textContent, "90.0\u00b0");
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
  assert.equal(storage.size, 0, "Lattice settings should not persist across loads");
  if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
  else globalThis.CustomEvent = previousCustomEvent;
  if (previousDispatchEvent === undefined) delete globalThis.dispatchEvent;
  else globalThis.dispatchEvent = previousDispatchEvent;
});
