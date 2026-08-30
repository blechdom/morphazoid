import {
  COLONY_SYRINX_LUNG_COUNT,
  COLONY_SYRINX_MAX_PRESSURE,
  COLONY_SYRINX_MOUTH_COUNT,
  COLONY_SYRINX_PHONATOR_COUNT,
  COLONY_SYRINX_ROUTE_COUNT,
  COLONY_SYRINX_SEQUENCE_LENGTH,
  COLONY_SYRINX_TOPOLOGY,
  colonySyrinxRouteFromMidiNote,
  createColonySyrinxState,
  sanitizeColonySyrinxState,
} from "./src/colony-syrinx.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum))
);
const percent = (value) => `${Math.round(clamp(value) * 100)}%`;
const MIDI_BASE_NOTE = 48;
const KEY_ROUTES = Object.freeze({
  "1": 0,
  "2": 1,
  "3": 2,
  q: 3,
  w: 4,
  e: 5,
  a: 6,
  s: 7,
  d: 8,
  z: 9,
  x: 10,
  c: 11,
});
const SOURCE_BASE_FREQUENCIES = Object.freeze([86, 133, 219, 347]);
const SOURCE_DISPLAY_FREQUENCIES = Object.freeze([62, 326, 180, 1_284]);
const LANE_DEFAULTS = Object.freeze([
  { length: 13, rate: 1 },
  { length: 11, rate: 1.5 },
  { length: 7, rate: 2 },
]);

const lungButtons = Array.from(document.querySelectorAll("[data-lung]"));
const sourceCards = Array.from(document.querySelectorAll(".source-card[data-source]"));
const routeButtons = Array.from(document.querySelectorAll(".route-valve[data-source][data-mouth]"));
const mouthCards = Array.from(document.querySelectorAll(".mouth-card[data-mouth]"));
const laneElements = Array.from(document.querySelectorAll(".sequence-lane[data-lane]"));
const lungVessels = Array.from(
  { length: COLONY_SYRINX_LUNG_COUNT },
  (_, index) => document.querySelector(`[data-vessel-lung="${index + 1}"]`),
);
const sourceVessels = Array.from(
  { length: COLONY_SYRINX_PHONATOR_COUNT },
  (_, index) => document.querySelector(`[data-vessel-source="${index + 1}"]`),
);
const routeVessels = COLONY_SYRINX_TOPOLOGY.routes.map(({ phonatorIndex, mouthIndex }) => (
  document.querySelector(`[data-vessel-route="${phonatorIndex + 1}-${mouthIndex + 1}"]`)
));
const mouthVessels = Array.from(
  { length: COLONY_SYRINX_MOUTH_COUNT },
  (_, index) => document.querySelector(`[data-vessel-mouth="${index + 1}"]`),
);
const lungGardenMembranes = Array.from(document.querySelectorAll(".lung-garden-membranes use"));

let audioContext = null;
let graph = null;
let audioStarting = false;
let transportPlaying = false;
let breathActive = false;
let sustainActive = false;
let breathPointerHeld = false;
let breathKeyHeld = false;
let animationFrame = 0;
let midiLearnArmed = false;
let midiLearnNotes = [];
let midiBaseNote = MIDI_BASE_NOTE;
let telemetry = {
  reservoirs: Array(4).fill(0),
  lungs: Array(COLONY_SYRINX_LUNG_COUNT).fill(0),
  folds: Array(8).fill(0),
  routes: Array(COLONY_SYRINX_ROUTE_COUNT).fill(0),
  routeApertures: Array(COLONY_SYRINX_ROUTE_COUNT).fill(0),
  mouths: Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
  mouthPressures: Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
  exhales: Array(4).fill(0),
  sourceFrequenciesHz: Array(4).fill(0),
  sourceModels: ["collision-roar", "split-syrinx", "pulse-membrane", "needle-syrinx"],
  limiterGain: 1,
  limitedShare: 0,
  step: 0,
  laneSteps: [0, 0, 0],
  flow: 0,
  load: 0,
  peak: 0,
  rms: 0,
  mediumId: "air",
};

const lungEnabled = Array(COLONY_SYRINX_LUNG_COUNT).fill(true);
const sourceEnabled = Array(COLONY_SYRINX_PHONATOR_COUNT).fill(true);
const manualRoutes = routeButtons.map((button) => button.getAttribute("aria-pressed") === "true" ? 1 : 0);
const heldRoutes = new Map();
const deferredRouteReleases = new Set();
const keyOwners = new Set();

function laneStateFromDom(laneElement, laneIndex) {
  const steps = Array.from(laneElement.querySelectorAll("[data-step]")).map((button) => (
    button.getAttribute("aria-pressed") === "true"
      ? clamp(button.dataset.velocity ?? 0.72, 0.05, 1)
      : 0
  ));
  return {
    length: clamp($( `lane${laneIndex + 1}Length`)?.value ?? LANE_DEFAULTS[laneIndex].length, 1, 16),
    rate: clamp($( `lane${laneIndex + 1}Rate`)?.value ?? LANE_DEFAULTS[laneIndex].rate, 0.25, 4),
    muted: $( `lane${laneIndex + 1}Mute`)?.getAttribute("aria-pressed") === "true",
    steps,
  };
}

function routeMatrix() {
  const result = Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, () => (
    Array(COLONY_SYRINX_MOUTH_COUNT).fill(0)
  ));
  for (let index = 0; index < COLONY_SYRINX_ROUTE_COUNT; index += 1) {
    const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[index];
    const held = heldRoutes.get(index) ?? 0;
    result[phonatorIndex][mouthIndex] = sourceEnabled[phonatorIndex]
      ? Math.max(manualRoutes[index], held)
      : 0;
  }
  return result;
}

function stateFromControls() {
  const pressure = clamp($("lungPressure")?.value ?? 0.68);
  const performanceMode = $("performanceMode")?.value ?? "organ";
  const phonators = SOURCE_BASE_FREQUENCIES.map((frequencyHz, index) => ({
    frequencyHz,
    tension: clamp($( `source${index + 1}Tension`)?.value ?? [0.28, 0.43, 0.61, 0.78][index]),
    closure: sourceEnabled[index] ? 0.62 - index * 0.055 : 1,
    asymmetry: [-0.16, 0.1, -0.08, 0.18][index],
    roughness: [0.31, 0.24, 0.17, 0.12][index],
  }));
  const mouths = [0, 1, 2].map((index) => ({
    id: ["maw", "speech", "click"][index],
    label: ["Subharmonic maw", "Vowel biter", "Needle scream"][index],
    opening: clamp($( `mouth${index + 1}Aperture`)?.value ?? [0.74, 0.48, 0.48][index]),
    tongueSize: [0.92, 0.58, 0.2][index],
    tonguePosition: clamp($( `mouth${index + 1}Tongue`)?.value ?? [0.31, 0.58, 0.76][index]),
    lipSize: [0.96, 0.54, 0.18][index],
    lipTension: [0.28, 0.56, 0.84][index],
    cavity: [0.9, 0.56, 0.2][index],
    resonanceHz: [118, 420, 1480][index],
    pan: [-0.72, 0, 0.72][index],
    leak: [0.018, 0.012, 0.006][index],
    slewMs: [138, 62, 18][index],
  }));
  return sanitizeColonySyrinxState(createColonySyrinxState({
    mediumId: $("mediumSelect")?.value === "hydraulic"
      ? "water"
      : $("mediumSelect")?.value === "granular" ? "pellets" : "air",
    breath: pressure,
    breathRateBpm: 24 + pressure * 42,
    pressureGain: 0.48 + pressure * 1.72,
    crossCoupling: clamp($("coupling")?.value ?? 0.32),
    colonyAmount: performanceMode === "colony" ? 0.86 : performanceMode === "organ" ? 0.28 : 0,
    gateHysteresis: performanceMode === "colony" ? 0.68 : 0.32,
    leak: clamp($("reservoirLoss")?.value ?? 0.21, 0, 0.6),
    valveSlewMs: clamp($("valveSlew")?.value ?? 18, 2, 180),
    tempoBpm: clamp($("tempo")?.value ?? 118, 24, 260),
    stepsPerBeat: 4,
    swing: clamp($("swing")?.value ?? 0.14, 0, 0.48),
    sequencerEnabled: transportPlaying,
    midiBaseNote,
    midiMode: "add",
    level: 1,
    lungEnabled,
    phonators,
    routes: routeMatrix(),
    mouths,
    lanes: laneElements.map(laneStateFromDom),
    // The visible 4×3 matrix owns topology. The sequencer gates the three
    // mouths, so a played MIDI valve always reaches its branch immediately
    // even while a closed mouth stores the arriving pressure for a later burst.
    sequence: Array.from({ length: COLONY_SYRINX_SEQUENCE_LENGTH }, (_, index) => ({
      routeMask: (1 << COLONY_SYRINX_ROUTE_COUNT) - 1,
      mouthGates: [1, 1, 1],
      accent: index % 4 === 0 ? 1 : index % 2 === 0 ? 0.82 : 0.66,
    })),
  }));
}

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const amount = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(amount * 100).toFixed(2)}%`);
}

function setAudioPresentation(on, detail = "") {
  const button = $("audioButton");
  const state = $("audioState");
  if (button) {
    button.setAttribute("aria-pressed", String(Boolean(on)));
    button.dataset.audioState = on ? "on" : "off";
    button.disabled = audioStarting;
  }
  if (state) state.textContent = on ? "on" : "off";
  if ($("audioError")) {
    $("audioError").hidden = !detail;
    $("audioError").textContent = detail;
  }
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({
    type: "configure",
    configuration: stateFromControls(),
  });
}

function breathingNow() {
  return breathActive || sustainActive || transportPlaying;
}

function manualBreathingNow() {
  return breathActive || sustainActive;
}

function syncBreathPresentation() {
  const breathing = breathingNow();
  $("colonySyrinx")?.classList.toggle("is-breathing", breathing);
  if ($("breathReadout")) $("breathReadout").textContent = breathing
    ? transportPlaying && !manualBreathingNow() ? "hostile exhale chain" : "continuous pressure"
    : "resting";
}

function postBreath() {
  const value = clamp($("lungPressure")?.value ?? 0.68);
  graph?.sourceNode?.port.postMessage({
    type: "breath",
    // Transport charges the reservoirs internally, then releases four distinct
    // exhale envelopes. Manual pressure bypasses those gates and stays continuous.
    active: manualBreathingNow(),
    value,
  });
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  // Claim the transient user activation before module loading can outlive it
  // (notably on Safari), then resume once more after the graph is complete.
  await context.resume();
  await context.audioWorklet.addModule(new URL("./src/colony-syrinx-processor.js", import.meta.url));
  const sourceNode = new AudioWorkletNode(context, "colony-syrinx-pressure-network", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { configuration: stateFromControls() },
  });
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  masterGain.gain.value = clamp($("level")?.value ?? 0.46, 0, 0.82);
  compressor.threshold.value = -15;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.19;
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.56;
  sourceNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = ({ data }) => {
    if (data?.type === "telemetry") telemetry = { ...telemetry, ...data };
  };
  sourceNode.onprocessorerror = () => {
    setAudioPresentation(false, "The pressure network stopped unexpectedly. Reload to reset it.");
  };
  return { context, sourceNode, masterGain, compressor, analyser, releaseOutput };
}

async function ensureAudio() {
  if (audioStarting) return false;
  if (!graph) {
    audioStarting = true;
    setAudioPresentation(false);
    try {
      graph = await createAudioGraph();
      audioContext = graph.context;
    } catch (error) {
      console.error(error);
      audioStarting = false;
      setAudioPresentation(false, error?.message || "Unable to start Colony Syrinx audio.");
      return false;
    }
    audioStarting = false;
  }
  try {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    postConfiguration();
    postBreath();
    graph.sourceNode.port.postMessage({ type: "transport", playing: transportPlaying });
    setAudioPresentation(true);
    if ($("statusText")) $("statusText").textContent = transportPlaying
      ? "Four reservoir banks are exhaling in sequence. Open paths to reroute each event."
      : "Audio is awake. Release the freak for four hostile exhales, or hold B for continuous pressure.";
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation(false, error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    setBreath(false);
    graph.sourceNode.port.postMessage({ type: "panic" });
    await audioContext.suspend();
    setAudioPresentation(false);
    if ($("statusText")) $("statusText").textContent = "Audio sleeps. The valve map and anatomy remain editable.";
    announce("Colony Syrinx audio off");
    return;
  }
  if (await ensureAudio()) {
    if (!transportPlaying) setTransport(true, { reset: true });
    announce("Colony Syrinx audio on; four hostile exhale creatures running");
  }
}

function setTransport(playing, { reset = false } = {}) {
  transportPlaying = Boolean(playing);
  const button = $("playButton");
  button?.setAttribute("aria-pressed", String(transportPlaying));
  button?.classList.toggle("is-playing", transportPlaying);
  if ($("playState")) $("playState").textContent = transportPlaying
    ? "four hostile exhales · space / P"
    : "ready · space / P";
  $("colonySyrinx")?.classList.toggle("is-running", transportPlaying);
  graph?.sourceNode?.port.postMessage({ type: "transport", playing: transportPlaying, reset });
  postConfiguration();
  syncBreathPresentation();
  postBreath();
  if ($("statusText")) $("statusText").textContent = transportPlaying
    ? "Four pressure gardens are exhaling at different moments through the visible manifold."
    : "Clock stopped. Hold B or the breath organ for manual pressure.";
  announce(transportPlaying ? "Colony clocks running" : "Colony clocks stopped");
}

async function toggleTransport() {
  if (!(await ensureAudio())) return;
  setTransport(!transportPlaying, { reset: !transportPlaying });
}

function setBreath(active, value = null) {
  breathActive = Boolean(active);
  if (value != null && $("lungPressure")) $("lungPressure").value = String(clamp(value));
  $("breathButton")?.setAttribute("aria-pressed", String(breathActive));
  $("breathButton")?.classList.toggle("is-breathing", breathActive);
  syncBreathPresentation();
  postBreath();
}

async function beginBreath(value = null, stillHeld = null) {
  if (!(await ensureAudio())) return;
  if (typeof stillHeld === "function" && !stillHeld()) return;
  setBreath(true, value);
}

function routeButtonForIndex(index) {
  return routeButtons[index] ?? null;
}

function commandedRouteAperture(index) {
  return Math.max(manualRoutes[index] ?? 0, heldRoutes.get(index) ?? 0);
}

function renderRouteBase(index) {
  const button = routeButtonForIndex(index);
  const vessel = routeVessels[index];
  const aperture = commandedRouteAperture(index);
  const active = aperture > 0;
  button?.setAttribute("aria-pressed", String(active));
  button?.style.setProperty("--velocity", String(aperture));
  vessel?.setAttribute("aria-pressed", String(active));
  vessel?.classList.toggle("is-open", active);
}

function setManualRoute(index, aperture) {
  if (index < 0 || index >= COLONY_SYRINX_ROUTE_COUNT) return;
  manualRoutes[index] = clamp(aperture);
  renderRouteBase(index);
  postConfiguration();
}

function setHeldRoute(owner, index, velocity) {
  if (index < 0 || index >= COLONY_SYRINX_ROUTE_COUNT) return;
  heldRoutes.set(index, Math.max(heldRoutes.get(index) ?? 0, clamp(velocity, 0.01, 1)));
  if (owner) keyOwners.add(owner);
  renderRouteBase(index);
  postConfiguration();
}

function releaseHeldRoute(owner, index) {
  if (sustainActive) {
    deferredRouteReleases.add(index);
    return;
  }
  heldRoutes.delete(index);
  if (owner) keyOwners.delete(owner);
  renderRouteBase(index);
  postConfiguration();
}

function triggerRoute(index, velocity = 1, owner = "") {
  const mode = $("performanceMode")?.value ?? "organ";
  if (mode === "organ") {
    setManualRoute(index, manualRoutes[index] > 0 ? 0 : velocity);
    return;
  }
  setHeldRoute(owner, index, velocity);
}

function releaseRoute(index, owner = "") {
  if (($("performanceMode")?.value ?? "organ") === "organ") return;
  releaseHeldRoute(owner, index);
}

function panic({ announceState = true } = {}) {
  if (transportPlaying) setTransport(false);
  heldRoutes.clear();
  deferredRouteReleases.clear();
  keyOwners.clear();
  manualRoutes.fill(0);
  sustainActive = false;
  setBreath(false);
  routeButtons.forEach((__, index) => renderRouteBase(index));
  graph?.sourceNode?.port.postMessage({ type: "panic" });
  postConfiguration();
  if (announceState) announce("All twelve valves closed and pressure released");
}

function resetControllers() {
  heldRoutes.clear();
  deferredRouteReleases.clear();
  sustainActive = false;
  setBreath(false);
  postConfiguration();
}

function handleMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (!message || (routeId && routeId !== "colony-syrinx")) return;
  const bytes = message.data ?? message.raw ?? null;
  const rawStatus = Number(bytes?.[0]) || 0;
  const rawType = rawStatus & 0xf0;
  const channel = Number(message.channel) || (rawStatus & 0x0f);
  const note = Number(message.note ?? bytes?.[1]) || 0;
  const velocity = Number(message.velocity ?? bytes?.[2]) || 0;
  const controller = Number(message.controller ?? bytes?.[1]) || 0;
  const controlValue = Number(message.value ?? bytes?.[2]) || 0;
  const type = message.type ?? (
    rawType === 0x90 && velocity > 0 ? "noteOn"
      : rawType === 0x80 || rawType === 0x90 ? "noteOff"
        : rawType === 0xb0 ? "controlChange" : "unknown"
  );

  if (midiLearnArmed && type === "noteOn" && velocity > 0) {
    event.preventDefault();
    midiLearnNotes.push(note);
    if (midiLearnNotes.length === 1) {
      midiBaseNote = clamp(note, 0, 116);
      midiLearnArmed = false;
      $("midiLearnButton")?.classList.remove("is-learning");
      if ($("midiReadout")) $("midiReadout").textContent = `mapped ${midiBaseNote}–${midiBaseNote + 11}`;
      announce(`Valve map begins at MIDI note ${midiBaseNote}`);
      postConfiguration();
    }
    return;
  }

  const route = colonySyrinxRouteFromMidiNote(note, midiBaseNote);
  if ((type === "noteOn" || type === "noteOff") && route) {
    event.preventDefault();
    const owner = `midi:${channel}:${note}`;
    if (type === "noteOn" && velocity > 0) {
      ensureAudio().then((ready) => {
        if (!ready) return;
        if (!transportPlaying) setTransport(true, { reset: true });
        triggerRoute(route.routeIndex, velocity > 1 ? velocity / 127 : velocity, owner);
        if ($("midiReadout")) $("midiReadout").textContent = `note ${note} · valve ${route.routeIndex + 1}`;
      });
    } else {
      releaseRoute(route.routeIndex, owner);
    }
    return;
  }

  if (type !== "controlChange") return;
  if (controller === 64) {
    event.preventDefault();
    sustainActive = controlValue >= 64;
    if (sustainActive) {
      ensureAudio().then((ready) => {
        if (!ready || !sustainActive) return;
        if ($("lungPressure")) $("lungPressure").value = String(clamp(controlValue / 127));
        syncBreathPresentation();
        postConfiguration();
        postBreath();
      });
    }
    else {
      deferredRouteReleases.forEach((index) => heldRoutes.delete(index));
      deferredRouteReleases.clear();
      setBreath(false);
      postConfiguration();
    }
    return;
  }
  if (controller === 120 || controller === 123) {
    event.preventDefault();
    panic();
    return;
  }
  if (controller === 121) {
    event.preventDefault();
    resetControllers();
  }
}

function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
}

function handleKeyDown(event) {
  if (event.repeat || isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    breathKeyHeld = true;
    beginBreath(null, () => breathKeyHeld);
    return;
  }
  if (key === "p") {
    event.preventDefault();
    toggleTransport();
    return;
  }
  if (key === "escape") {
    event.preventDefault();
    panic();
    return;
  }
  const routeIndex = KEY_ROUTES[key];
  if (routeIndex == null) return;
  event.preventDefault();
  const owner = `key:${key}`;
  ensureAudio().then((ready) => {
    if (!ready) return;
    if (!transportPlaying) setTransport(true, { reset: true });
    triggerRoute(routeIndex, 0.82, owner);
  });
}

function handleKeyUp(event) {
  if (isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    breathKeyHeld = false;
    setBreath(false);
    return;
  }
  const routeIndex = KEY_ROUTES[key];
  if (routeIndex == null) return;
  event.preventDefault();
  releaseRoute(routeIndex, `key:${key}`);
}

function bindRange(id, formatter, onInput = postConfiguration) {
  const input = $(id);
  const output = $(`${id}Out`);
  if (!input) return;
  const render = () => {
    updateRangeFill(input);
    if (output) output.textContent = formatter(Number(input.value));
    onInput?.(Number(input.value));
  };
  input.addEventListener("input", render);
  render();
}

function bindControls() {
  $("audioButton")?.addEventListener("click", toggleAudio);
  $("playButton")?.addEventListener("click", toggleTransport);
  $("panicButton")?.addEventListener("click", () => panic());

  const breathButton = $("breathButton");
  breathButton?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    breathPointerHeld = true;
    breathButton.setPointerCapture?.(event.pointerId);
    beginBreath(
      event.pressure > 0 ? 0.34 + event.pressure * 0.66 : null,
      () => breathPointerHeld,
    );
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    breathButton?.addEventListener(type, () => {
      breathPointerHeld = false;
      setBreath(false);
    });
  }

  lungButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      lungEnabled[index] = !lungEnabled[index];
      button.setAttribute("aria-pressed", String(lungEnabled[index]));
      button.classList.toggle("is-disabled", !lungEnabled[index]);
      lungVessels[index]?.classList.toggle("is-enabled", lungEnabled[index]);
      lungVessels[index]?.classList.toggle("is-disabled", !lungEnabled[index]);
      postConfiguration();
      announce(`Lung ${index + 1} ${lungEnabled[index] ? "joined" : "isolated"}`);
    });
  });

  sourceCards.forEach((card, index) => {
    const enable = $( `source${index + 1}Enable`);
    enable?.addEventListener("click", () => {
      sourceEnabled[index] = !sourceEnabled[index];
      enable.setAttribute("aria-pressed", String(sourceEnabled[index]));
      card.classList.toggle("is-disabled", !sourceEnabled[index]);
      sourceVessels[index]?.classList.toggle("is-enabled", sourceEnabled[index]);
      sourceVessels[index]?.classList.toggle("is-disabled", !sourceEnabled[index]);
      postConfiguration();
    });
    bindRange(`source${index + 1}Tension`, percent);
  });

  routeButtons.forEach((button, index) => {
    button.addEventListener("click", () => setManualRoute(index, manualRoutes[index] > 0 ? 0 : 1));
    renderRouteBase(index);
  });
  routeVessels.forEach((vessel, index) => {
    if (!vessel) return;
    const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[index];
    vessel.setAttribute("role", "button");
    vessel.setAttribute("tabindex", "0");
    vessel.setAttribute("aria-label", `Toggle source ${phonatorIndex + 1} to mouth ${mouthIndex + 1}`);
    vessel.addEventListener("click", () => setManualRoute(index, manualRoutes[index] > 0 ? 0 : 1));
    vessel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setManualRoute(index, manualRoutes[index] > 0 ? 0 : 1);
    });
    renderRouteBase(index);
  });

  mouthCards.forEach((card, index) => {
    bindRange(`mouth${index + 1}Aperture`, percent);
    bindRange(`mouth${index + 1}Tongue`, percent);
    card.style.setProperty("--mouth-index", String(index));
  });

  laneElements.forEach((lane, laneIndex) => {
    const mute = $( `lane${laneIndex + 1}Mute`);
    mute?.addEventListener("click", () => {
      const muted = mute.getAttribute("aria-pressed") !== "true";
      mute.setAttribute("aria-pressed", String(muted));
      lane.classList.toggle("is-muted", muted);
      postConfiguration();
    });
    const length = $( `lane${laneIndex + 1}Length`);
    const rate = $( `lane${laneIndex + 1}Rate`);
    const updateLane = () => {
      const boundedLength = Math.round(clamp(length?.value ?? 16, 1, 16));
      lane.querySelectorAll("[data-step]").forEach((step) => {
        const outside = Number(step.dataset.step) > boundedLength;
        step.classList.toggle("is-outside-loop", outside);
        step.classList.toggle("is-loop-end", Number(step.dataset.step) === boundedLength);
      });
      postConfiguration();
    };
    length?.addEventListener("change", updateLane);
    rate?.addEventListener("change", updateLane);
    lane.querySelectorAll("[data-step]").forEach((step) => {
      step.addEventListener("click", (event) => {
        const wasOn = step.getAttribute("aria-pressed") === "true";
        let velocity = Number(step.dataset.velocity) || 0.72;
        if (event.shiftKey && wasOn) velocity = velocity > 0.8 ? 0.38 : velocity > 0.5 ? 1 : 0.7;
        else if (wasOn) velocity = 0;
        step.dataset.velocity = velocity > 0 ? String(velocity) : "";
        step.setAttribute("aria-pressed", String(velocity > 0));
        step.style.setProperty("--velocity", String(velocity));
        postConfiguration();
      });
    });
    updateLane();
  });

  bindRange("level", percent, (value) => {
    if (graph && audioContext) graph.masterGain.gain.setTargetAtTime(value, audioContext.currentTime, 0.015);
  });
  bindRange("lungPressure", percent, () => { postConfiguration(); postBreath(); });
  bindRange("tempo", (value) => `${Math.round(value)} BPM`);
  bindRange("swing", percent);
  bindRange("coupling", percent);
  bindRange("valveSlew", (value) => `${Math.round(value)} ms`);
  bindRange("reservoirLoss", percent);

  $("mediumSelect")?.addEventListener("change", () => {
    const value = $("mediumSelect").value;
    const engineLabel = value === "air"
      ? "AIR ENGINE 01"
      : value === "hydraulic" ? "HYDRAULIC ENGINE 02" : "GRANULAR ENGINE 03";
    if ($("engineStatus")) $("engineStatus").textContent = value === "air"
      ? "AIR ENGINE ONLINE"
      : value === "hydraulic" ? "HYDRAULIC ENGINE ONLINE" : "GRANULAR ENGINE ONLINE";
    if ($("engineTitle")) {
      $("engineTitle").textContent = `PRESSURE-OPERATED POLYPHONIC ECOLOGY / ${engineLabel}`;
    }
    postConfiguration();
    announce(`${$("mediumSelect").selectedOptions[0]?.textContent ?? value} loaded`);
  });
  $("performanceMode")?.addEventListener("change", postConfiguration);
  $("midiLearnButton")?.addEventListener("click", () => {
    midiLearnArmed = !midiLearnArmed;
    midiLearnNotes = [];
    $("midiLearnButton").classList.toggle("is-learning", midiLearnArmed);
    if ($("midiReadout")) $("midiReadout").textContent = midiLearnArmed ? "play lowest valve note" : "not connected";
  });

  globalThis.addEventListener("keydown", handleKeyDown);
  globalThis.addEventListener("keyup", handleKeyUp);
  globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
  globalThis.addEventListener("blur", () => {
    if (!sustainActive) {
      heldRoutes.clear();
      setBreath(false);
      postConfiguration();
    }
  });
}

function safeVector(value, length, maximum = 1) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : [];
  return Array.from({ length }, (_, index) => clamp(source[index] ?? 0, 0, maximum));
}

function normalizePressure(value) {
  return Math.sqrt(clamp(value, 0, COLONY_SYRINX_MAX_PRESSURE) / COLONY_SYRINX_MAX_PRESSURE);
}

function normalizeFlow(value) {
  return Math.sqrt(clamp(value, 0, 8) / 8);
}

function renderTelemetry() {
  const reservoirPressures = safeVector(telemetry.reservoirs, 4, COLONY_SYRINX_MAX_PRESSURE);
  const lungPressures = safeVector(telemetry.lungs, COLONY_SYRINX_LUNG_COUNT, COLONY_SYRINX_MAX_PRESSURE);
  const reservoirs = reservoirPressures.map(normalizePressure);
  const lungs = lungPressures.map(normalizePressure);
  const folds = safeVector(telemetry.folds, 8);
  const foldFrequencies = safeVector(telemetry.foldFrequenciesHz, 8, 20_000);
  const sourceFrequencies = safeVector(telemetry.sourceFrequenciesHz, 4, 20_000);
  const routeFlows = safeVector(telemetry.routes, COLONY_SYRINX_ROUTE_COUNT, 8);
  const routes = routeFlows.map(normalizeFlow);
  const routeApertures = safeVector(telemetry.routeApertures, COLONY_SYRINX_ROUTE_COUNT);
  const mouthFlows = safeVector(telemetry.mouths, COLONY_SYRINX_MOUTH_COUNT, 8);
  const mouthPressures = safeVector(
    telemetry.mouthPressures,
    COLONY_SYRINX_MOUTH_COUNT,
    COLONY_SYRINX_MAX_PRESSURE,
  );
  const mouths = mouthPressures.map(normalizePressure);
  const exhales = safeVector(telemetry.exhales, 4);
  const activeExhaleBank = exhales.findIndex((value) => value > 0.02);
  if (transportPlaying && !manualBreathingNow() && $("breathReadout")) {
    $("breathReadout").textContent = activeExhaleBank >= 0
      ? `garden ${activeExhaleBank + 1} exhale`
      : "breath-space";
  }
  if ($("colonySyrinx")) {
    $("colonySyrinx").dataset.exhaleBank = activeExhaleBank >= 0
      ? String(activeExhaleBank + 1)
      : "rest";
  }
  const laneSteps = safeVector(telemetry.laneSteps, 3, 15).map((value) => Math.max(0, Math.round(Number(value) || 0)));
  const meanPressure = reservoirPressures.reduce((sum, value) => sum + value, 0) / reservoirPressures.length;
  const pressureLevel = normalizePressure(meanPressure);
  const openPaths = routeApertures.filter((value, index) => (
    Math.max(value, commandedRouteAperture(index)) > 0.02
  )).length;

  lungButtons.forEach((button, index) => {
    button.style.setProperty("--pressure", String(lungs[index]));
    button.querySelector("b")?.style.setProperty("--fill", String(lungs[index]));
    button.classList.toggle("is-pressured", lungs[index] > 0.12);
    lungVessels[index]?.style.setProperty("--pressure", String(lungs[index]));
    lungVessels[index]?.style.setProperty("--exhale", String(exhales[Math.floor(index / 4)]));
    lungVessels[index]?.classList.toggle("is-exhaling", exhales[Math.floor(index / 4)] > 0.02);
    lungVessels[index]?.classList.toggle("is-enabled", lungEnabled[index]);
    lungVessels[index]?.classList.toggle("is-disabled", !lungEnabled[index]);
  });
  reservoirs.forEach((value, index) => {
    if ($( `bank${index + 1}Pressure`)) $( `bank${index + 1}Pressure`).textContent = percent(value);
    document.querySelector(`.lung-bank[data-bank="${index + 1}"]`)?.style.setProperty("--pressure", String(value));
    lungGardenMembranes[index]?.style.setProperty("--exhale", String(exhales[index]));
  });
  folds.forEach((value, index) => {
    $( `fold${index + 1}Meter`)?.style.setProperty("--activity", String(value));
  });
  SOURCE_DISPLAY_FREQUENCIES.forEach((fallback, index) => {
    const activity = Math.max(folds[index * 2], folds[index * 2 + 1]);
    sourceVessels[index]?.style.setProperty("--activity", String(activity));
    sourceVessels[index]?.style.setProperty("--exhale", String(exhales[index]));
    sourceVessels[index]?.classList.toggle("is-exhaling", exhales[index] > 0.02);
    sourceVessels[index]?.classList.toggle("is-enabled", sourceEnabled[index]);
    sourceVessels[index]?.classList.toggle("is-disabled", !sourceEnabled[index]);
    const first = foldFrequencies[index * 2];
    const second = foldFrequencies[index * 2 + 1];
    const frequency = sourceFrequencies[index] > 0
      ? sourceFrequencies[index]
      : first > 0 || second > 0 ? (first + second) * 0.5 : fallback;
    if ($( `source${index + 1}Frequency`)) {
      $( `source${index + 1}Frequency`).textContent = `${Math.round(frequency)} Hz`;
    }
  });
  routeButtons.forEach((button, index) => {
    button.style.setProperty("--flow", String(routes[index]));
    button.classList.toggle("is-flowing", routeFlows[index] > 0.02);
    const vessel = routeVessels[index];
    const aperture = Math.max(routeApertures[index], commandedRouteAperture(index));
    vessel?.style.setProperty("--flow", String(routes[index]));
    vessel?.classList.toggle("is-open", aperture > 0.02);
    vessel?.classList.toggle(
      "is-flowing",
      aperture > 0.02 && routeFlows[index] > 0.02,
    );
    vessel?.setAttribute("aria-pressed", String(aperture > 0.02));
  });
  mouthCards.forEach((card, index) => {
    card.style.setProperty("--pressure", String(mouths[index]));
    card.style.setProperty("--flow", String(normalizeFlow(mouthFlows[index])));
    card.classList.toggle("is-sounding", mouthFlows[index] > 0.02);
    mouthVessels[index]?.style.setProperty("--pressure", String(mouths[index]));
    mouthVessels[index]?.classList.toggle("is-sounding", mouthFlows[index] > 0.02);
    const state = $( `mouth${index + 1}State`);
    if (state) state.textContent = mouthFlows[index] > 0.32 ? "OPEN" : mouthFlows[index] > 0.02 ? "PULSE" : "SHUT";
  });
  laneElements.forEach((lane, index) => {
    const stepIndex = laneSteps[index] % COLONY_SYRINX_SEQUENCE_LENGTH;
    lane.querySelectorAll("[data-step]").forEach((step) => {
      step.classList.toggle("is-current", Number(step.dataset.step) - 1 === stepIndex);
    });
  });

  const pressureKpa = meanPressure * 10;
  if ($("lungPressureReadout")) $("lungPressureReadout").textContent = `${pressureKpa.toFixed(1)} kPa`;
  if ($("manifoldReadout")) $("manifoldReadout").textContent = `${pressureKpa.toFixed(1)} kPa`;
  if ($("flowReadout")) $("flowReadout").textContent = `${clamp(telemetry.flow, 0, 24).toFixed(2)} L/s`;
  if ($("routeCountReadout")) $("routeCountReadout").textContent = `${openPaths} / 12 open`;
  if ($("bodyRouteCount")) $("bodyRouteCount").textContent = `${openPaths} OPEN / 12 POSSIBLE`;
  if ($("activePathReadout")) $("activePathReadout").textContent = `${String(openPaths).padStart(2, "0")} / 12`;
  if ($("loadReadout")) $("loadReadout").textContent = percent(telemetry.load ?? 0);
  if ($("foldLockReadout")) {
    const activePairs = [0, 1, 2, 3].filter((index) => Math.max(folds[index * 2], folds[index * 2 + 1]) > 0.08).length;
    $("foldLockReadout").textContent = `${activePairs} × paired`;
  }
  if ($("stepReadout")) $("stepReadout").textContent = `STEP ${String((Number(telemetry.step) || 0) + 1).padStart(2, "0")} / 16`;
  if ($("phaseReadout")) $("phaseReadout").textContent = `PHASE ${String(Math.round(((performance.now() / 32) % 360))).padStart(3, "0")}°`;
  if ($("clockReadout")) $("clockReadout").textContent = `${Math.round(Number($("tempo")?.value) || 118)} BPM`;
  if ($("breathMeter")) {
    const breath = clamp(meanPressure * 0.76 + (breathingNow() ? 0.18 : 0));
    $("breathMeter").setAttribute("aria-valuenow", String(Math.round(breath * 100)));
    $("breathMeter").style.setProperty("--breath", String(breath));
  }
  document.documentElement.style.setProperty("--colony-pressure", String(pressureLevel));
  document.documentElement.style.setProperty("--colony-rms", String(clamp(telemetry.rms ?? 0) * 4));
  animationFrame = requestAnimationFrame(renderTelemetry);
}

function cleanup() {
  cancelAnimationFrame(animationFrame);
  globalThis.removeEventListener("keydown", handleKeyDown);
  globalThis.removeEventListener("keyup", handleKeyUp);
  globalThis.removeEventListener("morphazoid:midi-input", handleMidiInput);
  graph?.sourceNode?.port.postMessage({ type: "panic" });
  graph?.sourceNode?.disconnect();
  graph?.releaseOutput?.();
  audioContext?.close();
}

bindControls();
setAudioPresentation(false);
setTransport(false);
renderTelemetry();
globalThis.addEventListener("pagehide", cleanup, { once: true });
