import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateGraph } from "../src/graph-delay.js";
import { initializeGraphInstrument } from "../src/graph-instrument-app.js";
import {
  MAX_GRAPH_INSTRUMENT_NODES,
  graphSynthVoice,
} from "../src/graph-instruments.js";

async function exerciseLiveEditRegression(mode, htmlFile) {
  const html = await readFile(new URL(`../${htmlFile}`, import.meta.url), "utf8");
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
        toggle(name, force) {
          if (force === undefined ? !classes.has(name) : force) classes.add(name);
          else classes.delete(name);
        },
      },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);

  const graphPatchButtons = [];
  for (const match of html.matchAll(/<button\b[^>]*id="([^"]+)"[^>]*data-graph-patch="([^"]+)"/g)) {
    const button = elements.get(match[1]);
    button.dataset.graphPatch = match[2];
    graphPatchButtons.push(button);
  }
  elements.get("graphPatchGrid").querySelectorAll = (selector) => (
    selector === "[data-graph-patch]" ? graphPatchButtons : []
  );

  const arcCalls = [];
  let strokeCallCount = 0;
  const drawingContext = {
    arc(x, y, radius) { arcCalls.push({ x, y, radius }); },
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    fillText() {},
    lineTo() {},
    moveTo() {},
    rect() {},
    restore() {},
    rotate() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() { strokeCallCount += 1; },
    translate() {},
  };
  elements.get("stage").getContext = () => drawingContext;

  const rafQueue = [];
  let frameNow = 1_000;
  let nextFrameId = 1;
  const runtimeListeners = new Map();
  const documentListeners = new Map();
  const runtime = {
    Math,
    crypto: {
      getRandomValues(values) {
        values[0] = 0xffff_ffff;
        return values;
      },
    },
    devicePixelRatio: 1,
    document: null,
    localStorage: { getItem() { return null; } },
    matchMedia() { return { matches: false }; },
    performance: { now() { return frameNow; } },
    requestAnimationFrame(callback) {
      rafQueue.push(callback);
      const id = nextFrameId;
      nextFrameId += 1;
      return id;
    },
    setTimeout,
    addEventListener(type, listener) { runtimeListeners.set(type, listener); },
    removeEventListener(type) { runtimeListeners.delete(type); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback(); }
    },
  };
  const documentObject = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type) { documentListeners.delete(type); },
  };
  runtime.document = documentObject;

  const audioTriggers = [];
  const heldAudioTriggerResolvers = [];
  let holdAudioTriggers = false;
  let rejectAudioTriggers = false;
  let rejectedAudioErrorName = "Error";
  const audioEngine = {
    context: null,
    output: 0,
    closeCount: 0,
    silenceCount: 0,
    async start() {
      this.context ??= { currentTime: 1, state: "running" };
      return this.context;
    },
    setOutput(value) { this.output = value; },
    trigger(voice, options) {
      audioTriggers.push({ voice, options });
      if (rejectAudioTriggers) {
        const error = new Error("synthetic Web Audio overload");
        error.name = rejectedAudioErrorName;
        return Promise.reject(error);
      }
      if (holdAudioTriggers) {
        return new Promise((resolve) => heldAudioTriggerResolvers.push(() => (
          resolve({ voice, options })
        )));
      }
      return Promise.resolve({ voice, options });
    },
    silence() { this.silenceCount += 1; },
    async close() {
      this.closeCount += 1;
      this.context = null;
    },
  };

  function flushAnimationFrames(timestamp = frameNow + 20) {
    frameNow = timestamp;
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(frameNow);
  }

  const controller = initializeGraphInstrument({
    mode,
    runtime,
    documentObject,
    audioEngine,
  });
  assert.ok(controller);
  assert.ok(rafQueue.length > 0, "initialization should request a render frame");
  flushAnimationFrames();
  assert.equal(elements.get("baseDelayOut").textContent, "62 ms");
  assert.equal(
    attributes.get("baseDelay:aria-valuetext"),
    "62 milliseconds",
  );
  assert.equal(controller.state.attackLaneCount, 1);
  assert.equal(elements.get("attackLaneCount").value, "1");
  assert.ok(
    controller.pulseTemplate.audioEvents.every(({ attackLane, attackLaneCount }) => (
      attackLane === 0 && attackLaneCount === 1
    )),
    "natural polyphony should leave every event in the neutral lane",
  );
  elements.get("attackLaneCount").value = "4";
  listeners.get("attackLaneCount:change")({
    currentTarget: elements.get("attackLaneCount"),
  });
  const fourLaneTemplate = controller.pulseTemplate;
  assert.equal(controller.state.attackLaneCount, 4);
  assert.equal(elements.get("attackLaneCount").value, "4");
  assert.ok(fourLaneTemplate.audioEvents.length >= 4);
  assert.deepEqual(
    fourLaneTemplate.audioEvents.slice(0, 8).map(({ attackLane }) => attackLane),
    Array.from(
      { length: Math.min(8, fourLaneTemplate.audioEvents.length) },
      (_, index) => index % 4,
    ),
  );
  assert.equal(controller.pulseCount, 0, "lane selection must not launch a pulse");
  assert.equal(controller.activeRunCount, 0, "lane selection must not create a graph run");
  assert.equal(controller.soundedEventCount, 0, "lane selection must not add attacks");
  assert.equal(audioEngine.context, null, "lane selection must not start audio by itself");

  if (mode === "drums") {
    elements.get("percussionStyle").value = "karplus-tines";
    listeners.get("percussionStyle:change")({
      currentTarget: elements.get("percussionStyle"),
    });
    flushAnimationFrames(frameNow + 10);
    assert.equal(controller.state.percussionStyle, "karplus-tines");
    assert.equal(controller.pulseCount, 0, "style selection must not launch a pulse");
    assert.equal(controller.soundedEventCount, 0, "style selection must not add attacks");
    assert.equal(audioEngine.context, null, "style selection must not start audio by itself");
    assert.equal(elements.get("drumMap").dataset.percussionStyle, "karplus-tines");
    assert.match(elements.get("drumMap").innerHTML, /karplus/i);
    assert.match(elements.get("mappingSummary").textContent, /karplus tines/i);
  }

  if (mode === "synth") {
    const selectValue = (id, value) => {
      elements.get(id).value = value;
      listeners.get(`${id}:change`)({ currentTarget: elements.get(id) });
    };
    const rangeValue = (id, value) => {
      elements.get(id).value = String(value);
      listeners.get(`${id}:input`)({ currentTarget: elements.get(id) });
    };
    selectValue("soundMode", "pm");
    selectValue("mappingMode", "progress");
    selectValue("tuningMode", "just");
    selectValue("articulation", "edge");
    selectValue("triggerScope", "all");
    rangeValue("output", 0.71);
    rangeValue("pitchRange", 1.25);
    rangeValue("edoDivisions", 31);
    rangeValue("turnPitchScale", 0.83);
    rangeValue("modulationIndex", 5.4);
    rangeValue("modulationRatio", 3.25);
    rangeValue("noteDuration", 480);
    rangeValue("attack", 37);
    rangeValue("decay", 260);
    rangeValue("sustain", 0.67);
    rangeValue("release", 810);
    rangeValue("stereoSpread", 0.39);

    assert.equal(elements.get("pitchRange").disabled, false);
    assert.equal(elements.get("turnPitchScale").disabled, true);
    assert.equal(elements.get("turnPitchScaleOut").textContent, "0.83 oct / 360°");
    assert.match(elements.get("pitchRangeNote").textContent, /Node position/);

    selectValue("mappingMode", "turn");
    assert.equal(elements.get("pitchRange").disabled, true);
    assert.equal(elements.get("turnPitchScale").disabled, false);
    assert.match(elements.get("pitchRangeNote").textContent, /keep accumulating/);
    selectValue("soundMode", "shepard");
    assert.equal(elements.get("pitchRange").disabled, false);
    assert.match(elements.get("pitchRangeNote").textContent, /wraps inherited pitch/);
    selectValue("mappingMode", "progress");
    assert.match(elements.get("pitchRangeNote").textContent, /Node position/);
    selectValue("soundMode", "pm");

    const synthControlKeys = [
      "output", "seedNote", "triggerScope", "mappingMode", "characterDepth", "baseFrequency",
      "pitchRange", "tuningMode", "edoDivisions", "turnPitchScale", "soundMode",
      "modulationIndex", "modulationRatio", "articulation", "attackLaneCount", "noteDuration", "attack",
      "decay", "sustain", "release", "stereoSpread",
    ];
    const synthControlSnapshot = Object.fromEntries(
      synthControlKeys.map((key) => [key, controller.state[key]]),
    );
    for (const button of graphPatchButtons) {
      listeners.get(`${button.id}:click`)();
      assert.deepEqual(
        Object.fromEntries(synthControlKeys.map((key) => [key, controller.state[key]])),
        synthControlSnapshot,
        `${button.dataset.graphPatch} must preserve the current synth controls`,
      );
      assert.equal(controller.pulseCount, 0, "loading a graph preset must not launch a pulse");
      assert.equal(controller.soundedEventCount, 0, "loading a graph preset must not add attacks");
      assert.equal(audioEngine.context, null, "loading a graph preset must not start audio");
      assert.equal(
        controller.pulseTemplate.audioEvents[0]?.audioStartOffset,
        0,
        `${button.dataset.graphPatch} should retain an immediate source-node attack`,
      );
    }
  }

  elements.get("seedNote").value = "69";
  listeners.get("seedNote:input")({ currentTarget: elements.get("seedNote") });
  flushAnimationFrames(frameNow + 10);
  assert.equal(controller.state.seedNote, 69);
  assert.equal(elements.get("seedNote").value, "69");
  assert.match(elements.get("seedNoteOut").textContent, /A4.*69/);
  assert.equal(controller.pulseCount, 0, "seed-note input must not launch a graph run");
  assert.equal(controller.activeRunCount, 0, "seed-note input must not create an active run");
  assert.equal(controller.soundedEventCount, 0, "seed-note input must not add an attack");
  assert.equal(audioEngine.context, null, "seed-note input must not start audio");

  if (mode === "drums") {
    elements.get("percussionStyle").value = "rattlesnake";
    listeners.get("percussionStyle:change")({
      currentTarget: elements.get("percussionStyle"),
    });
    flushAnimationFrames(frameNow + 10);
    assert.equal(controller.state.percussionStyle, "rattlesnake");
    assert.equal(elements.get("pitchDepthLabel").textContent, "Progress → pitch");
    assert.equal(controller.pulseCount, 0, "Rattlesnake selection must not launch a pulse");
    assert.equal(controller.soundedEventCount, 0, "Rattlesnake selection must not add attacks");
  }

  const firstSeedTriggerIndex = audioTriggers.length;
  await listeners.get("pulseButton:click")();
  flushAnimationFrames(frameNow + 20);
  assert.equal(controller.state.audio, true, "a cold Pulse click should arm audio");
  assert.equal(controller.pulseCount, 1, "Pulse should launch one graph run");
  assert.equal(controller.activeRunCount, 1);
  assert.ok(controller.soundedEventCount > 0, "Pulse should schedule audible graph attacks");
  assert.equal(audioTriggers.length, controller.soundedEventCount);
  if (mode === "drums") {
    assert.ok(audioTriggers.every(({ voice }) => voice.percussionStyle === "rattlesnake"));
    assert.ok(audioTriggers.every(({ voice }) => voice.family === "rattle"));
  }
  assert.ok(
    controller.pulseTemplate.audioEvents.every(({ kind }) => kind === "node"),
    "instrument attacks should be node arrivals only",
  );
  const firstSeedVoice = audioTriggers[firstSeedTriggerIndex]?.voice;
  assert.ok(firstSeedVoice, "Send one must use the selected seed note for an audible run");
  assert.equal(firstSeedVoice.attackLaneCount, 4);
  assert.ok(firstSeedVoice.attackLane >= 0 && firstSeedVoice.attackLane < 4);

  const arcsBeforeActiveFrame = arcCalls.length;
  audioEngine.context.currentTime += 0.08;
  flushAnimationFrames(frameNow + 20);
  assert.equal(
    arcCalls.length - arcsBeforeActiveFrame,
    controller.model.nodes.length,
    "playback should reuse the fixed graph nodes instead of adding moving or expanding circles",
  );
  assert.equal(audioTriggers.length, controller.soundedEventCount);

  if (mode === "synth") {
    await new Promise((resolve) => setImmediate(resolve));
    const restore = controller.state;
    const changeControl = (id, value, eventType) => {
      elements.get(id).value = String(value);
      listeners.get(`${id}:${eventType}`)({ currentTarget: elements.get(id) });
    };
    changeControl("topology", "hub", "change");
    changeControl("nodeCount", 8, "input");
    changeControl("density", 1, "input");
    changeControl("baseDelay", 20, "input");
    changeControl("distanceRatio", 1, "input");
    changeControl("nodePass", 1, "input");
    changeControl("feedback", 0.74, "input");
    changeControl("triggerScope", "all", "change");
    changeControl("mappingMode", "turn", "change");
    changeControl("tuningMode", "pure", "change");
    changeControl("turnPitchScale", 4, "input");
    changeControl("soundMode", "fm", "change");
    changeControl("seedNote", 0, "input");

    const reentryTemplate = controller.pulseTemplate;
    const mappedReentryVoices = reentryTemplate.audioEvents.map((event) => graphSynthVoice(
      event,
      controller.model,
      {
        mappingMode: "turn",
        rootMidiNote: 0,
        tuningMode: "pure",
        soundMode: "fm",
      },
    ));
    assert.equal(mappedReentryVoices[0].inAudibleRange, false);
    assert.ok(
      mappedReentryVoices.slice(1).some(({ inAudibleRange }) => inAudibleRange),
      "a positive inherited turn must be able to bring a sub-audio seed back into range",
    );
    const triggersBeforeReentry = audioTriggers.length;
    const soundedBeforeReentry = controller.soundedEventCount;
    const shedBeforeReentry = controller.shedAudioEventCount;
    await controller.launchPulse();
    flushAnimationFrames(frameNow + 20);
    const reentryTriggers = audioTriggers.slice(triggersBeforeReentry);
    assert.ok(reentryTriggers.length > 0, "later in-range arrivals must survive silent seeds");
    assert.equal(
      controller.soundedEventCount - soundedBeforeReentry,
      reentryTriggers.length,
      "out-of-range arrivals must not consume the attack count",
    );
    assert.equal(
      controller.shedAudioEventCount,
      shedBeforeReentry,
      "intentional out-of-range arrivals are not overload drops",
    );
    assert.ok(reentryTriggers.every(({ voice }) => (
      voice.frequency >= 20 * (1 - 1e-12)
      && voice.frequency <= 20_000 * (1 + 1e-12)
    )));

    changeControl("topology", "bipartite", "change");
    changeControl("nodeCount", MAX_GRAPH_INSTRUMENT_NODES, "input");
    changeControl("density", 1, "input");
    changeControl("turnPitchScale", 0, "input");
    changeControl("seedNote", 69, "input");
    const triggersBeforeSilentFlood = audioTriggers.length;
    const soundedBeforeSilentFlood = controller.soundedEventCount;
    const olderAudibleRun = await controller.launchPulse();
    changeControl("seedNote", 0, "input");
    for (let index = 0; index < 7; index += 1) await controller.launchPulse();
    flushAnimationFrames(frameNow + 20);
    const fairShareTriggers = audioTriggers.slice(triggersBeforeSilentFlood);
    assert.ok(
      fairShareTriggers.length > 0,
      "newer silent floods must leave scan capacity for an older audible run",
    );
    assert.ok(fairShareTriggers.every(({ options }) => (
      options.graphRunId === olderAudibleRun.id
    )));
    assert.equal(
      controller.soundedEventCount - soundedBeforeSilentFlood,
      fairShareTriggers.length,
    );

    changeControl("topology", restore.topology, "change");
    changeControl("nodeCount", restore.nodeCount, "input");
    changeControl("density", restore.density, "input");
    changeControl("baseDelay", restore.baseDelay, "input");
    changeControl("distanceRatio", restore.distanceRatio, "input");
    changeControl("nodePass", restore.nodePass, "input");
    changeControl("feedback", restore.feedback, "input");
    changeControl("triggerScope", restore.triggerScope, "change");
    changeControl("mappingMode", restore.mappingMode, "change");
    changeControl("tuningMode", restore.tuningMode, "change");
    changeControl("turnPitchScale", restore.turnPitchScale, "input");
    changeControl("soundMode", restore.soundMode, "change");
    changeControl("seedNote", restore.seedNote, "input");
  }

  const runsBeforeSeedMove = controller.activeRunCount;
  const pulsesBeforeSeedMove = controller.pulseCount;
  const attacksBeforeSeedMove = controller.soundedEventCount;
  const contextBeforeSeedMove = audioEngine.context;
  elements.get("seedNote").value = "73";
  listeners.get("seedNote:input")({ currentTarget: elements.get("seedNote") });
  flushAnimationFrames(frameNow + 10);
  assert.equal(controller.state.seedNote, 73);
  assert.match(elements.get("seedNoteOut").textContent, /73/);
  assert.equal(controller.pulseCount, pulsesBeforeSeedMove, "moving Seed note must not launch another run");
  assert.equal(controller.activeRunCount, runsBeforeSeedMove, "moving Seed note must preserve active runs");
  assert.equal(controller.soundedEventCount, attacksBeforeSeedMove, "moving Seed note must not add attacks");
  assert.equal(audioEngine.context, contextBeforeSeedMove, "moving Seed note must not restart audio");

  const spaceSeedTriggerIndex = audioTriggers.length;
  let spacePrevented = false;
  listeners.get("stage:keydown")({
    key: " ",
    preventDefault() { spacePrevented = true; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(frameNow + 20);
  assert.equal(spacePrevented, true);
  assert.equal(controller.pulseCount, pulsesBeforeSeedMove + 1, "Space should launch another audible run");
  assert.ok(controller.soundedEventCount > attacksBeforeSeedMove);
  const spaceSeedVoice = audioTriggers[spaceSeedTriggerIndex]?.voice;
  assert.ok(spaceSeedVoice, "Space must use the selected seed note for an audible run");
  if (mode === "synth" || mode === "drums") {
    const expectedRatio = 2 ** (4 / 12);
    assert.ok(
      Math.abs(spaceSeedVoice.frequency / firstSeedVoice.frequency - expectedRatio) < 1e-9,
      "Send one and Space must derive pitched roots from the selected seed note",
    );
  }
  if (mode === "drums") {
    assert.notEqual(
      spaceSeedVoice.voiceIndex,
      firstSeedVoice.voiceIndex,
      "Send one and Space must rotate the drum mapping from the selected seed note",
    );
  }

  const midiHandler = runtimeListeners.get("morphazoid:midi-input");
  assert.equal(typeof midiHandler, "function");
  const midiPulseCount = controller.pulseCount;
  const midiRunCount = controller.activeRunCount;
  const midiAttackCount = controller.soundedEventCount;
  const midiPrevented = [];
  for (const note of [64, 76]) {
    let prevented = false;
    midiHandler({
      detail: { message: { type: "noteOn", note, velocity: 112 } },
      preventDefault() { prevented = true; },
    });
    midiPrevented.push(() => prevented);
  }
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(frameNow + 20);
  assert.ok(midiPrevented.every((wasPrevented) => wasPrevented()));
  assert.equal(controller.pulseCount, midiPulseCount + 2, "two MIDI notes must launch two graph runs");
  assert.equal(
    controller.activeRunCount,
    midiRunCount + 2,
    "simultaneous MIDI seeds must remain as separate polyphonic graph runs",
  );
  assert.ok(controller.soundedEventCount > midiAttackCount);
  assert.equal(controller.state.seedNote, 76, "the latest MIDI note must become the visible seed note");
  assert.equal(elements.get("seedNote").value, "76");
  assert.match(elements.get("seedNoteOut").textContent, /E5.*76/);

  const attacksBeforePlay = controller.soundedEventCount;
  const pulsesBeforePlay = controller.pulseCount;
  const runsBeforePlay = controller.activeRunCount;
  await listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 20);
  assert.equal(controller.state.playing, true);
  assert.equal(controller.pulseCount, pulsesBeforePlay + 1, "transport start should launch its first graph pulse");
  assert.equal(controller.activeRunCount, runsBeforePlay + 1);
  assert.ok(controller.soundedEventCount > attacksBeforePlay, "Play should schedule audible attacks");

  const pulseCountBeforeTempo = controller.pulseCount;
  const activeRunsBeforeTempo = controller.activeRunCount;
  const scheduledPulseBeforeTempo = controller.scheduledPulseTime;
  const attackCountBeforeTempo = controller.soundedEventCount;
  elements.get("tempo").value = "35";
  listeners.get("tempo:input")({ currentTarget: elements.get("tempo") });
  flushAnimationFrames(frameNow + 10);
  assert.equal(controller.pulseCount, pulseCountBeforeTempo, "tempo input must not launch another pulse");
  assert.equal(controller.activeRunCount, activeRunsBeforeTempo, "tempo input must preserve the active run");
  assert.equal(controller.scheduledPulseTime, scheduledPulseBeforeTempo, "tempo input must preserve transport phase");
  assert.equal(controller.soundedEventCount, attackCountBeforeTempo, "tempo input must not add attacks");

  const tailBeforeDistanceRatio = controller.pulseTemplate.tailSeconds;
  elements.get("distanceRatio").value = "4";
  listeners.get("distanceRatio:input")({ currentTarget: elements.get("distanceRatio") });
  flushAnimationFrames(frameNow + 10);
  assert.equal(controller.state.distanceRatio, 4);
  assert.equal(elements.get("distanceRatioOut").textContent, "4.00×");
  assert.notEqual(
    controller.pulseTemplate.tailSeconds,
    tailBeforeDistanceRatio,
    "distance ratio should retime the graph template",
  );
  assert.equal(controller.pulseCount, pulseCountBeforeTempo, "distance ratio input must not launch another pulse");
  assert.equal(controller.activeRunCount, activeRunsBeforeTempo, "distance ratio input must preserve the active run");
  assert.equal(controller.scheduledPulseTime, scheduledPulseBeforeTempo, "distance ratio input must preserve transport phase");
  assert.equal(controller.soundedEventCount, attackCountBeforeTempo, "distance ratio input must not add attacks");

  elements.get("attackLaneCount").value = "2";
  listeners.get("attackLaneCount:change")({
    currentTarget: elements.get("attackLaneCount"),
  });
  flushAnimationFrames(frameNow + 10);
  assert.equal(controller.state.attackLaneCount, 2);
  assert.deepEqual(
    controller.pulseTemplate.audioEvents.slice(0, 6).map(({ attackLane }) => attackLane),
    Array.from(
      { length: Math.min(6, controller.pulseTemplate.audioEvents.length) },
      (_, index) => index % 2,
    ),
  );
  assert.equal(controller.pulseCount, pulseCountBeforeTempo, "lane selection must not launch another pulse");
  assert.equal(controller.activeRunCount, activeRunsBeforeTempo, "lane selection must preserve active runs");
  assert.equal(controller.scheduledPulseTime, scheduledPulseBeforeTempo, "lane selection must preserve transport phase");
  assert.equal(controller.soundedEventCount, attackCountBeforeTempo, "lane selection must not add attacks");

  const node = controller.model.nodes[0];
  const nodeX = 63 + node.x * 774;
  const nodeY = 48 + node.y * 504;
  let pointerDownPrevented = false;
  listeners.get("stage:pointerdown")({
    clientX: nodeX,
    clientY: nodeY,
    pointerId: 7,
    preventDefault() { pointerDownPrevented = true; },
  });
  listeners.get("stage:pointermove")({
    clientX: nodeX + 24,
    clientY: nodeY + 12,
    pointerId: 7,
    preventDefault() {},
  });
  listeners.get("stage:pointerup")({ pointerId: 7 });
  flushAnimationFrames(frameNow + 10);

  assert.equal(pointerDownPrevented, true, "the test gesture should select a graph node");
  assert.equal(controller.pulseCount, pulseCountBeforeTempo, "node motion must not launch another pulse");
  assert.equal(controller.activeRunCount, activeRunsBeforeTempo, "node motion must preserve the active run");
  assert.equal(controller.soundedEventCount, attackCountBeforeTempo, "node motion must not add attacks");
  assert.match(elements.get("liveStatus").textContent, /edge times were recalculated/);

  const positionsBeforeRandomize = controller.model.nodes.map(({ x, y }) => [x, y]);
  const connectionsBeforeRandomize = controller.model.edges.map(({ from, to }) => [from, to]);
  const generatorBeforeRandomize = Object.fromEntries(
    ["topology", "nodeCount", "density", "seed"].map((key) => [key, controller.state[key]]),
  );
  const pulsesBeforePositionRandomize = controller.pulseCount;
  const runsBeforePositionRandomize = controller.activeRunCount;
  const attacksBeforePositionRandomize = controller.soundedEventCount;
  const clockBeforePositionRandomize = controller.scheduledPulseTime;
  listeners.get("randomizeNodePositionsButton:click")();
  const positionsAfterRandomize = controller.model.nodes.map(({ x, y }) => [x, y]);
  assert.notDeepEqual(positionsAfterRandomize, positionsBeforeRandomize);
  assert.ok(positionsAfterRandomize.every(([x, y]) => (
    x >= 0.02 && x <= 0.98 && y >= 0.02 && y <= 0.98
  )));
  assert.deepEqual(
    controller.model.edges.map(({ from, to }) => [from, to]),
    connectionsBeforeRandomize,
  );
  assert.deepEqual(
    Object.fromEntries(
      ["topology", "nodeCount", "density", "seed"].map((key) => [key, controller.state[key]]),
    ),
    generatorBeforeRandomize,
  );
  assert.equal(controller.pulseCount, pulsesBeforePositionRandomize);
  assert.equal(controller.activeRunCount, runsBeforePositionRandomize);
  assert.equal(controller.soundedEventCount, attacksBeforePositionRandomize);
  assert.equal(controller.scheduledPulseTime, clockBeforePositionRandomize);
  assert.match(elements.get("liveStatus").textContent, /Node positions randomized/);

  const pulsesBeforeRandom = controller.pulseCount;
  const attacksBeforeRandom = controller.soundedEventCount;
  listeners.get("randomGraphButton:click")();
  assert.equal(controller.state.topology, "random");
  assert.equal(controller.state.nodeCount, MAX_GRAPH_INSTRUMENT_NODES);
  assert.equal(controller.model.nodes.length, MAX_GRAPH_INSTRUMENT_NODES);
  assert.equal(elements.get("nodeCount").value, String(MAX_GRAPH_INSTRUMENT_NODES));
  const canonicalRandomGraph = generateGraph({
    type: controller.state.topology,
    nodeCount: controller.state.nodeCount,
    density: controller.state.density,
    seed: controller.state.seed,
    maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
  });
  assert.notDeepEqual(
    controller.model.nodes.map(({ x, y }) => [x, y]),
    canonicalRandomGraph.nodes.map(({ x, y }) => [x, y]),
    "Random graph must randomize node placement as well as graph topology",
  );
  assert.ok(controller.model.nodes.every(({ x, y }) => (
    x >= 0.02 && x <= 0.98 && y >= 0.02 && y <= 0.98
  )));
  assert.deepEqual(
    controller.model.edges.map(({ from, to }) => [from, to]),
    canonicalRandomGraph.edges.map(({ from, to }) => [from, to]),
    "Random placement must preserve the newly generated graph connections",
  );
  assert.equal(controller.pulseCount, pulsesBeforeRandom, "Random must not launch a graph run");
  assert.equal(controller.soundedEventCount, attacksBeforeRandom, "Random must not add attacks");
  assert.match(elements.get("liveStatus").textContent, /randomized node positions/);

  elements.get("topology").value = "chain";
  listeners.get("topology:change")({ currentTarget: elements.get("topology") });
  elements.get("nodeCount").value = "512";
  listeners.get("nodeCount:input")({ currentTarget: elements.get("nodeCount") });
  elements.get("triggerScope").value = "leaves";
  listeners.get("triggerScope:change")({ currentTarget: elements.get("triggerScope") });

  const largeTemplate = controller.pulseTemplate;
  assert.equal(controller.model.nodes.length, MAX_GRAPH_INSTRUMENT_NODES);
  assert.equal(controller.state.nodeCount, MAX_GRAPH_INSTRUMENT_NODES);
  assert.equal(elements.get("nodeCount").value, String(MAX_GRAPH_INSTRUMENT_NODES));
  assert.equal(largeTemplate.reachedNodeCount, MAX_GRAPH_INSTRUMENT_NODES);
  assert.ok(largeTemplate.tailSeconds > 1, "the complete 32-node route should retain its full tail");
  assert.ok(
    largeTemplate.audioEvents.some(({ nodeId }) => nodeId === MAX_GRAPH_INSTRUMENT_NODES - 1),
    "leaf-only audio must retain the end of a long route",
  );
  assert.ok(
    largeTemplate.events.some(({ nodeId }) => nodeId === MAX_GRAPH_INSTRUMENT_NODES - 1),
    "every sounded leaf keeps a corresponding route cue",
  );

  if (mode === "synth") {
    elements.get("triggerScope").value = "all";
    listeners.get("triggerScope:change")({ currentTarget: elements.get("triggerScope") });
    elements.get("articulation").value = "edge";
    listeners.get("articulation:change")({ currentTarget: elements.get("articulation") });
    const continuousTemplate = controller.pulseTemplate;
    assert.equal(controller.state.triggerScope, "all");
    assert.equal(continuousTemplate.articulation, "edge");
    assert.equal(continuousTemplate.audioEvents.length, MAX_GRAPH_INSTRUMENT_NODES - 1);
    assert.ok(continuousTemplate.audioEvents.every(({ gateSeconds }) => gateSeconds > 0));
  }

  if (controller.state.playing) await listeners.get("playButton:click")();
  const attacksBeforeMotionCadence = controller.soundedEventCount;
  const motionBuildsBefore = controller.motionTemplateBuildCount;
  listeners.get("nodeMotionPlayButton:click")();
  for (let index = 0; index < 10; index += 1) flushAnimationFrames(frameNow + 20);
  assert.equal(
    controller.motionTemplateBuildCount,
    motionBuildsBefore + 1,
    "moving nodes must not rebuild the expensive graph schedule every animation frame",
  );
  for (let index = 0; index < 4; index += 1) flushAnimationFrames(frameNow + 20);
  assert.equal(
    controller.motionTemplateBuildCount,
    motionBuildsBefore + 2,
    "moving-node schedule retiming should resume after its adaptive safety interval",
  );
  assert.ok(controller.motionTemplateIntervalMs >= 250);
  assert.equal(
    controller.soundedEventCount,
    attacksBeforeMotionCadence,
    "adaptive geometry retiming must not introduce attacks",
  );
  listeners.get("nodeMotionPlayButton:click")();

  elements.get("topology").value = "bipartite";
  listeners.get("topology:change")({ currentTarget: elements.get("topology") });
  elements.get("density").value = "1";
  listeners.get("density:input")({ currentTarget: elements.get("density") });
  elements.get("baseDelay").value = "20";
  listeners.get("baseDelay:input")({ currentTarget: elements.get("baseDelay") });
  assert.equal(controller.state.baseDelay, 20, "Edge speed must remain stored in milliseconds");
  assert.equal(elements.get("baseDelayOut").textContent, "20 ms");
  assert.equal(
    attributes.get("baseDelay:aria-valuetext"),
    "20 milliseconds",
  );
  elements.get("distanceRatio").value = "1";
  listeners.get("distanceRatio:input")({ currentTarget: elements.get("distanceRatio") });
  elements.get("triggerScope").value = "all";
  listeners.get("triggerScope:change")({ currentTarget: elements.get("triggerScope") });
  if (mode === "synth") {
    elements.get("articulation").value = "trigger";
    listeners.get("articulation:change")({ currentTarget: elements.get("articulation") });
  }
  const requestedDenseGraph = generateGraph({
    type: controller.state.topology,
    nodeCount: controller.state.nodeCount,
    density: controller.state.density,
    seed: controller.state.seed,
    maxNodes: MAX_GRAPH_INSTRUMENT_NODES,
  });
  assert.equal(controller.model.nodes.length, MAX_GRAPH_INSTRUMENT_NODES);
  assert.equal(
    controller.model.edges.length,
    requestedDenseGraph.edges.length,
    "audio protection must retain every route in the requested dense topology",
  );
  assert.ok(
    controller.model.edges.length > MAX_GRAPH_INSTRUMENT_NODES * 7,
    "the overload fixture must stay genuinely dense",
  );
  const strokesBeforeDenseFrame = strokeCallCount;
  flushAnimationFrames(frameNow + 20);
  const denseFrameStrokeCount = strokeCallCount - strokesBeforeDenseFrame;
  assert.ok(
    denseFrameStrokeCount <= controller.model.nodes.length + 4,
    `dense routes should be painted in batches rather than one canvas stroke per edge (${denseFrameStrokeCount} strokes for ${controller.model.edges.length} routes)`,
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.inFlightAudioTriggerCount, 0);
  holdAudioTriggers = true;
  const triggersBeforeHeldRuns = audioTriggers.length;
  const shedBeforeHeldRuns = controller.shedAudioEventCount;
  const olderDenseRun = await controller.launchPulse();
  const newerDenseRun = await controller.launchPulse();
  flushAnimationFrames(frameNow + 20);
  const heldRunTriggers = audioTriggers.slice(triggersBeforeHeldRuns);
  assert.ok(heldRunTriggers.length > 0, "the dense fixture must reach the audio scheduler");
  assert.ok(heldRunTriggers.length <= 64, "unsettled Web Audio requests must stay bounded");
  assert.ok(
    heldRunTriggers.every(({ options }) => options.graphRunId === newerDenseRun.id),
    "a new manual graph note must get audio priority over an older thick tail",
  );
  assert.equal(controller.lastAdmittedRunId, newerDenseRun.id);
  assert.notEqual(olderDenseRun.id, newerDenseRun.id);
  assert.equal(controller.inFlightAudioTriggerCount, heldRunTriggers.length);
  assert.ok(
    controller.shedAudioEventCount > shedBeforeHeldRuns,
    "excess due events must be skipped instead of accumulating as a backlog",
  );
  holdAudioTriggers = false;
  for (const resolveHeldTrigger of heldAudioTriggerResolvers.splice(0)) resolveHeldTrigger();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.inFlightAudioTriggerCount, 0);

  rejectAudioTriggers = true;
  const silenceBeforeProtection = audioEngine.silenceCount;
  await controller.launchPulse();
  flushAnimationFrames(frameNow + 20);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.audioProtected, true, "repeated renderer failures must trip protection");
  assert.ok(controller.audioProtectionLevel >= 1);
  assert.ok(audioEngine.silenceCount > silenceBeforeProtection);
  assert.match(elements.get("liveStatus").textContent, /Audio protected/);
  assert.equal(controller.inFlightAudioTriggerCount, 0);

  rejectAudioTriggers = false;
  const triggersBeforeRecovery = audioTriggers.length;
  await controller.launchPulse();
  flushAnimationFrames(frameNow + 20);
  assert.equal(controller.audioProtected, false, "a fresh user sound gesture must reset protection");
  assert.ok(audioTriggers.length > triggersBeforeRecovery, "audio must recover without reloading the page");
  await new Promise((resolve) => setImmediate(resolve));

  const damagedContext = audioEngine.context;
  const closesBeforeFatalError = audioEngine.closeCount;
  rejectedAudioErrorName = "InvalidStateError";
  rejectAudioTriggers = true;
  await controller.launchPulse();
  flushAnimationFrames(frameNow + 20);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.audioProtected, true, "fatal Web Audio errors must latch protection");
  assert.equal(controller.state.playing, false);
  assert.equal(controller.state.audio, false);
  assert.equal(controller.activeRunCount, 0);
  assert.equal(audioEngine.context, null, "the damaged context must be discarded");
  assert.equal(
    audioEngine.closeCount,
    closesBeforeFatalError + 1,
    "a fatal attack burst must close its shared damaged context only once",
  );
  assert.match(elements.get("liveStatus").textContent, /safely reset/);

  rejectAudioTriggers = false;
  rejectedAudioErrorName = "Error";
  await controller.launchPulse();
  flushAnimationFrames(frameNow + 20);
  assert.equal(controller.audioProtected, false);
  assert.equal(controller.state.audio, true);
  assert.notEqual(audioEngine.context, damagedContext, "the next gesture must build a fresh context");
  await new Promise((resolve) => setImmediate(resolve));

  elements.get("topology").value = "chain";
  listeners.get("topology:change")({ currentTarget: elements.get("topology") });
  elements.get("nodeCount").value = "8";
  listeners.get("nodeCount:input")({ currentTarget: elements.get("nodeCount") });
  flushAnimationFrames(frameNow + 20);

  const assertLifecycleStopped = (label) => {
    assert.equal(controller.state.playing, false, `${label} must stop the graph transport`);
    assert.equal(controller.state.audio, false, `${label} must mark graph audio off`);
    assert.equal(controller.activeRunCount, 0, `${label} must clear active graph runs`);
    assert.equal(controller.scheduledPulseTime, null, `${label} must clear the next clock pulse`);
    assert.equal(audioEngine.context, null, `${label} must close the Web Audio context`);
  };
  const armLifecyclePlayback = async (label) => {
    if (!controller.state.playing) await listeners.get("playButton:click")();
    await controller.launchPulse();
    flushAnimationFrames(frameNow + 20);
    assert.equal(controller.state.playing, true, `${label} setup must start the transport`);
    assert.equal(controller.state.audio, true, `${label} setup must start graph audio`);
    assert.ok(controller.activeRunCount > 0, `${label} setup must have an active run`);
    assert.notEqual(controller.scheduledPulseTime, null, `${label} setup must arm the graph clock`);
  };

  assert.equal(
    typeof documentListeners.get("visibilitychange"),
    "function",
    "graph instruments must observe page visibility so hidden tabs cannot keep sounding",
  );
  await armLifecyclePlayback("visibilitychange");
  const closesBeforeHidden = audioEngine.closeCount;
  documentObject.hidden = true;
  await documentListeners.get("visibilitychange")();
  assertLifecycleStopped("hidden visibilitychange");
  assert.ok(
    audioEngine.closeCount > closesBeforeHidden,
    "hiding a graph page must close or silence its audio engine",
  );
  const pulsesBeforeHiddenMidi = controller.pulseCount;
  let hiddenMidiPrevented = false;
  midiHandler({
    detail: { message: { type: "noteOn", note: 81, velocity: 118 } },
    preventDefault() { hiddenMidiPrevented = true; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(frameNow + 20);
  assert.equal(hiddenMidiPrevented, true, "a hidden graph page must claim and ignore MIDI note-on");
  assert.equal(
    controller.pulseCount,
    pulsesBeforeHiddenMidi,
    "hardware MIDI must not launch a graph pulse in a hidden tab",
  );
  let hiddenStartPrevented = false;
  midiHandler({
    detail: { message: { type: "start" } },
    preventDefault() { hiddenStartPrevented = true; },
  });
  assert.equal(hiddenStartPrevented, true, "a hidden graph page must reject MIDI transport start");
  assert.equal(controller.state.playing, false, "hidden MIDI Start must not restart the graph transport");
  assertLifecycleStopped("hidden MIDI note-on");

  documentObject.hidden = false;
  await armLifecyclePlayback("persisted pagehide");
  const closesBeforePersistedHide = audioEngine.closeCount;
  await runtimeListeners.get("pagehide")({ persisted: true });
  assertLifecycleStopped("persisted pagehide");
  assert.ok(
    audioEngine.closeCount > closesBeforePersistedHide,
    "a BFCache pagehide must close or silence its audio engine",
  );
  runtimeListeners.get("pageshow")({ persisted: true });
  flushAnimationFrames(frameNow + 20);
  assertLifecycleStopped("BFCache pageshow");

  await armLifecyclePlayback("non-persisted pagehide");
  const closesBeforeFinalHide = audioEngine.closeCount;
  await runtimeListeners.get("pagehide")({ persisted: false });
  assertLifecycleStopped("non-persisted pagehide");
  assert.ok(
    audioEngine.closeCount > closesBeforeFinalHide,
    "a final pagehide must close or silence its audio engine",
  );

  controller.dispose({ persisted: false });
}

for (const [mode, label, htmlFile] of [
  ["drums", "Graph Drum Machine", "graph-drums.html"],
  ["synth", "Graph Synth", "graph-synth.html"],
]) {
  test(`cold sound triggers work and live edits preserve the current ${label} run`, () => (
    exerciseLiveEditRegression(mode, htmlFile)
  ));
}
