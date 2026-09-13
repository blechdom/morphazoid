import {
  JULIE_SAW_BLADES,
  JULIE_SAW_DEFAULTS,
  JULIE_SAW_LIMITS,
  JULIE_SAW_PRESETS,
  JULIE_SAW_RHYTHMS,
  JULIE_SAW_TECHNIQUES,
  applyJulieSawPreset,
  applyJulieSawTechnique,
  bendToFrequency,
  clamp,
  contactAlignment,
  julieSawBlade,
  julieSawRhythm,
  julieSawTechnique,
  midiToFrequency,
  pitchName,
  randomizedJulieSawState,
  sanitizeJulieSawState,
  sweetSpotPosition,
  techniqueTracksSweetSpot,
} from "./src/julie-saw.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const formatPercent = (value) => `${Math.round(value * 100)}%`;
const CONTROL_SPECS = Object.freeze([
  { key: "bend", format: formatPercent },
  { key: "tipCurl", format: formatPercent },
  { key: "localization", format: formatPercent },
  { key: "bladeDamping", format: formatPercent },
  { key: "brightness", format: formatPercent },
  { key: "bowPressure", format: formatPercent },
  { key: "bowSpeed", format: formatPercent },
  { key: "bowContact", format: formatPercent },
  { key: "rosin", format: formatPercent },
  { key: "edgeRasp", format: formatPercent },
  { key: "vibratoDepthCents", format: (value) => `${Math.round(value)} ct` },
  { key: "vibratoRateHz", format: (value) => `${value.toFixed(1)} Hz` },
  { key: "vibratoDelaySeconds", format: (value) => `${value.toFixed(2)} s` },
  { key: "glideSeconds", format: (value) => `${value.toFixed(2)} s` },
  { key: "attackSeconds", format: (value) => `${value < .1 ? value.toFixed(3) : value.toFixed(2)} s` },
  { key: "decaySeconds", format: (value) => `${value.toFixed(2)} s` },
  { key: "sustain", format: formatPercent },
  { key: "releaseSeconds", format: (value) => `${value.toFixed(2)} s` },
  { key: "body", format: formatPercent },
  { key: "stereoWidth", format: formatPercent },
  { key: "tempoBpm", format: (value) => `${Math.round(value)}` },
  { key: "level", format: formatPercent },
]);

let state = applyJulieSawPreset(JULIE_SAW_DEFAULTS.presetId, JULIE_SAW_DEFAULTS);
state = sanitizeJulieSawState({ ...state, bowContact: sweetSpotPosition(state) }, state);
let audioContext = null;
let graph = null;
let audioStartupPromise = null;
let audioDesiredOn = false;
let audioStatus = "off";
let pageIsActive = true;
let lifecycleGeneration = 0;
let audioGeneration = 0;
let animationFrame = 0;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let waveform = new Float32Array(1024);
let telemetry = {
  frequencyHz: bendToFrequency(state),
  bend: state.bend,
  sweetSpot: sweetSpotPosition(state),
  bowContact: state.bowContact,
  alignment: contactAlignment(state),
  stick: 0,
  envelope: 0,
  activity: 0,
  peak: 0,
  rms: 0,
  step: -1,
  bowDirection: 1,
  autoPlaying: false,
};
let lastTelemetryAt = -Infinity;
let stageGeometry = null;
let visualBowOffset = 0;
let actionFlash = { gesture: "", amount: 0 };
let activePointers = new Map();
let activeBowOwners = new Set();
let currentBowDirection = 1;
let currentBowVelocityScale = 1;
let midiHeldNotes = new Map();
let activeMidiNote = null;
let transportStartedAt = performance.now();

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const progress = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(progress * 100).toFixed(2)}%`);
}

function setAudioPresentation(status = "off", errorMessage = "") {
  audioStatus = status;
  const isOn = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(isOn));
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting" ? "starting" : isOn ? "on" : "off";
  $("audioError").hidden = !errorMessage;
  $("audioError").textContent = errorMessage;
}

function buildSelects() {
  const option = (id, label) => {
    const element = document.createElement("option");
    element.value = id;
    element.textContent = label;
    return element;
  };
  for (const preset of JULIE_SAW_PRESETS) $("presetSelect").append(option(preset.id, preset.label));
  $("presetSelect").append(option("custom", "Custom position"));
  for (const blade of JULIE_SAW_BLADES) $("bladeSelect").append(option(blade.id, blade.label));
  for (const technique of JULIE_SAW_TECHNIQUES) $("techniqueSelect").append(option(technique.id, technique.label));
  for (const rhythm of JULIE_SAW_RHYTHMS) $("rhythmSelect").append(option(rhythm.id, rhythm.label));
}

function currentDisplayFrequency() {
  const telemetryIsFresh = graph && audioContext?.state === "running" && performance.now() - lastTelemetryAt < 250;
  return telemetryIsFresh ? telemetry.frequencyHz : bendToFrequency(state);
}

function renderRhythmScore(currentStep = telemetry.step) {
  const rhythm = julieSawRhythm(state.rhythmId);
  $("rhythmScore").style.setProperty("--score-steps", rhythm.steps.length);
  $("rhythmScore").replaceChildren(...rhythm.steps.map((rhythmStep, index) => {
    const marker = document.createElement("i");
    const active = rhythmStep.kind !== "rest";
    marker.classList.toggle("is-hit", active);
    marker.classList.toggle("is-current", state.autoPlay && index === currentStep);
    marker.style.height = active ? `${Math.round(5 + clamp(rhythmStep.velocity) * 17)}px` : "2px";
    marker.style.setProperty("--hit", clamp(rhythmStep.velocity || 0));
    marker.title = active ? `${index + 1}: ${rhythmStep.kind}` : `${index + 1}: rest`;
    return marker;
  }));
  $("rhythmScore").setAttribute("aria-label", `${rhythm.label}: ${rhythm.description}`);
}

function transportSnapshot(now = performance.now()) {
  if (!state.autoPlay) return { step: -1, phase: 0 };
  const rhythm = julieSawRhythm(state.rhythmId);
  const stepMilliseconds = 60_000 / state.tempoBpm / 4 / Math.max(1, rhythm.subdivision || 1);
  const elapsed = Math.max(0, now - transportStartedAt);
  const position = elapsed / Math.max(1, stepMilliseconds);
  return {
    step: Math.floor(position) % rhythm.steps.length,
    phase: position - Math.floor(position),
  };
}

function postAutomaticState({ triggerCurrent = false } = {}) {
  if (!audioGraphIsRunning()) return;
  const position = transportSnapshot();
  graph.sourceNode.port.postMessage({
    type: "auto",
    playing: state.autoPlay,
    step: position.step,
    phase: position.phase,
    triggerCurrent,
  });
}

function audioGraphIsRunning() {
  return Boolean(
    audioDesiredOn
    && audioStatus === "on"
    && graph
    && audioContext?.state === "running"
  );
}

function announceAudioOff() {
  announce("Audio is off — turn it on to hear playback");
}

function updatePresentation({ score = true } = {}) {
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    const output = $(`${spec.key}Out`);
    if (input) {
      input.value = String(state[spec.key]);
      updateRangeFill(input);
    }
    if (output) output.textContent = spec.format(state[spec.key]);
  }
  $("presetSelect").value = JULIE_SAW_PRESETS.some(({ id }) => id === state.presetId)
    ? state.presetId
    : "custom";
  $("bladeSelect").value = state.bladeId;
  $("techniqueSelect").value = state.techniqueId;
  $("rhythmSelect").value = state.rhythmId;
  $("playButton").setAttribute("aria-pressed", String(state.autoPlay));
  $("playButton").querySelector("span").textContent = state.autoPlay ? "■" : "▶";
  $("playButton").setAttribute("aria-label", state.autoPlay ? "Stop automatic saw phrase" : "Play automatic saw phrase");
  $("trackSweetSpot").setAttribute("aria-pressed", String(state.trackSweetSpot));
  const blade = julieSawBlade(state.bladeId);
  const technique = julieSawTechnique(state.techniqueId);
  $("bladeDescription").textContent = blade.description;
  $("techniqueName").textContent = technique.label;
  $("techniqueDescription").textContent = technique.description;
  $("bladeSummary").textContent = `${blade.label.toLowerCase()} · ${state.localization > .55 ? "S curve" : "loose curve"}`;
  const alignment = contactAlignment(state);
  $("bowSummary").textContent = alignment > .78
    ? "centered · stable slip"
    : alignment > .3 ? "edge of sweet spot" : "miss · scrape";
  $("motionSummary").textContent = state.vibratoDepthCents <= 1
    ? "straight tone"
    : `${state.vibratoDelaySeconds > .12 ? "delayed " : ""}${state.vibratoRateHz.toFixed(1)} Hz vibrato`;
  const frequency = currentDisplayFrequency();
  $("pitchReadout").textContent = `${pitchName(frequency)} · ${Math.round(frequency)} Hz`;
  $("contactReadout").textContent = alignment > .78
    ? "sweet spot"
    : alignment > .3 ? "near edge" : "scrape / weak";
  if (score) renderRhythmScore();
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", configuration: state });
  if (graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  }
}

function commitPatch(patch, {
  custom = true,
  followSweetSpot = false,
  announceText = "",
} = {}) {
  let next = sanitizeJulieSawState({
    ...state,
    ...patch,
    ...(custom ? { presetId: "custom" } : {}),
  }, state);
  if (followSweetSpot && next.trackSweetSpot) {
    next = sanitizeJulieSawState({ ...next, bowContact: sweetSpotPosition(next) }, next);
  }
  state = next;
  postConfiguration();
  updatePresentation();
  if (announceText) announce(announceText);
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  let releaseOutput = null;
  unlockAudioContext(context);
  try {
    await context.audioWorklet.addModule(new URL("./src/julie-saw-processor.js", import.meta.url));
    const sourceNode = new AudioWorkletNode(context, "julie-saw-physical-model", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { configuration: state },
    });
    const compressor = context.createDynamicsCompressor();
    const masterGain = context.createGain();
    const analyser = context.createAnalyser();
    compressor.threshold.value = -18;
    compressor.knee.value = 15;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.09;
    masterGain.gain.value = state.level;
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.38;
    sourceNode.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(analyser);
    releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
    sourceNode.port.onmessage = (event) => {
      if (event.data?.type !== "telemetry") return;
      const previousStep = telemetry.step;
      telemetry = { ...telemetry, ...event.data };
      lastTelemetryAt = performance.now();
      if (telemetry.step !== previousStep) renderRhythmScore(telemetry.step);
    };
    sourceNode.onprocessorerror = () => setAudioPresentation(
      "error",
      "The Julie Saw physical model stopped unexpectedly. Reload the page to reset it.",
    );
    return { context, sourceNode, compressor, masterGain, analyser, releaseOutput };
  } catch (error) {
    releaseOutput?.();
    try { await context.close?.(); } catch { /* Preserve the useful startup error. */ }
    throw error;
  }
}

async function ensureAudio() {
  audioDesiredOn = true;
  const requestGeneration = ++audioGeneration;
  if (!graph) {
    if (!audioStartupPromise) {
      setAudioPresentation("starting");
      const startupLifecycle = lifecycleGeneration;
      const startup = createAudioGraph()
        .then((createdGraph) => {
          if (!pageIsActive || !audioDesiredOn || startupLifecycle !== lifecycleGeneration) {
            createdGraph.releaseOutput?.();
            void createdGraph.context.close?.();
            return false;
          }
          graph = createdGraph;
          audioContext = createdGraph.context;
          return true;
        })
        .catch((error) => {
          console.error(error);
          if (pageIsActive && audioDesiredOn && startupLifecycle === lifecycleGeneration) {
            setAudioPresentation("error", error?.message || "Unable to start Julie Saw audio.");
          }
          return false;
        })
        .finally(() => {
          if (audioStartupPromise === startup) audioStartupPromise = null;
        });
      audioStartupPromise = startup;
    }
    if (!(await audioStartupPromise)) return false;
  }
  const activeGraph = graph;
  const activeContext = audioContext;
  try {
    unlockAudioContext(activeContext);
    await activeContext.resume();
    if (
      !pageIsActive
      || !audioDesiredOn
      || requestGeneration !== audioGeneration
      || activeGraph !== graph
    ) return false;
    postConfiguration();
    setAudioPresentation("on");
    postAutomaticState();
    if (activeBowOwners.size > 0) {
      activeGraph.sourceNode.port.postMessage({
        type: "bow",
        gate: true,
        direction: currentBowDirection,
        velocityScale: currentBowVelocityScale,
      });
    }
    if (activeMidiNote !== null && midiHeldNotes.has(activeMidiNote)) {
      activeGraph.sourceNode.port.postMessage({
        type: "note-on",
        note: activeMidiNote,
        frequencyHz: midiToFrequency(activeMidiNote),
        velocity: midiHeldNotes.get(activeMidiNote),
        direction: telemetry.bowDirection || 1,
      });
    }
    return true;
  } catch (error) {
    console.error(error);
    if (requestGeneration === audioGeneration) {
      setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    }
    return false;
  }
}

async function toggleAudio() {
  if (audioDesiredOn && audioStatus === "on" && audioContext) {
    audioDesiredOn = false;
    audioGeneration += 1;
    activeBowOwners.clear();
    midiHeldNotes.clear();
    activeMidiNote = null;
    graph.sourceNode.port.postMessage({ type: "silence" });
    await audioContext.suspend();
    setAudioPresentation("off");
    updateBowButton();
    return;
  }
  await ensureAudio();
}

function toggleAuto() {
  const autoPlay = !state.autoPlay;
  if (autoPlay) transportStartedAt = performance.now();
  state = sanitizeJulieSawState({ ...state, autoPlay }, state);
  postAutomaticState({ triggerCurrent: autoPlay });
  updatePresentation();
  announce(`Automatic ${julieSawRhythm(state.rhythmId).label} ${state.autoPlay ? "playing" : "stopped"}`);
}

function loadPreset(presetId) {
  state = applyJulieSawPreset(presetId, state);
  const trackSweetSpot = techniqueTracksSweetSpot(state.techniqueId);
  state = sanitizeJulieSawState({ ...state, trackSweetSpot }, state);
  if (state.trackSweetSpot) state = sanitizeJulieSawState({ ...state, bowContact: sweetSpotPosition(state) }, state);
  if (state.autoPlay) transportStartedAt = performance.now();
  postConfiguration();
  if (state.autoPlay) postAutomaticState({ triggerCurrent: true });
  updatePresentation();
  announce(`${JULIE_SAW_PRESETS.find(({ id }) => id === state.presetId)?.label ?? "Julie Saw"} loaded`);
}

function loadTechnique(techniqueId) {
  state = applyJulieSawTechnique(state, techniqueId);
  const technique = julieSawTechnique(techniqueId);
  const trackSweetSpot = techniqueTracksSweetSpot(technique.id);
  state = sanitizeJulieSawState({ ...state, trackSweetSpot }, state);
  if (state.trackSweetSpot) state = sanitizeJulieSawState({ ...state, bowContact: sweetSpotPosition(state) }, state);
  postConfiguration();
  updatePresentation();
  if (technique.action && graph && audioContext?.state === "running") void triggerGesture(technique.action);
  announce(`${technique.label}: ${technique.description}`);
}

function loadRhythm(rhythmId) {
  state = sanitizeJulieSawState({ ...state, rhythmId, presetId: "custom" }, state);
  if (state.autoPlay) transportStartedAt = performance.now();
  postConfiguration();
  if (state.autoPlay) postAutomaticState({ triggerCurrent: true });
  updatePresentation();
  const rhythm = julieSawRhythm(rhythmId);
  announce(`${rhythm.label}: ${rhythm.description}`);
}

function triggerGesture(gesture, velocity = 0.76) {
  actionFlash = { gesture, amount: 1 };
  if (audioGraphIsRunning()) {
    graph.sourceNode.port.postMessage({ type: "gesture", gesture, velocity });
  } else {
    announceAudioOff();
    return;
  }
  announce(`${gesture.replaceAll("-", " ")} on the saw`);
}

function updateBowButton() {
  const active = activeBowOwners.size > 0;
  $("bowButton").setAttribute("aria-pressed", String(active));
}

function beginBow(owner, { direction = 1, velocityScale = 1 } = {}) {
  activeBowOwners.add(owner);
  currentBowDirection = direction < 0 ? -1 : 1;
  currentBowVelocityScale = clamp(velocityScale, .08, 2.2);
  updateBowButton();
  if (!audioGraphIsRunning()) {
    announceAudioOff();
    return;
  }
  graph.sourceNode.port.postMessage({
    type: "bow",
    gate: true,
    direction: currentBowDirection,
    velocityScale: currentBowVelocityScale,
  });
  announce(`${direction < 0 ? "Up" : "Down"} bow at the ${contactAlignment(state) > .72 ? "sweet spot" : "blade edge"}`);
}

function updateBow({ direction = 1, velocityScale = 1 } = {}) {
  if (!activeBowOwners.size) return;
  currentBowDirection = direction < 0 ? -1 : 1;
  currentBowVelocityScale = clamp(velocityScale, .08, 2.2);
  if (!audioGraphIsRunning()) return;
  graph.sourceNode.port.postMessage({
    type: "bow",
    gate: true,
    direction: currentBowDirection,
    velocityScale: currentBowVelocityScale,
  });
}

function endBow(owner) {
  activeBowOwners.delete(owner);
  updateBowButton();
  if (activeBowOwners.size === 0) graph?.sourceNode?.port.postMessage({ type: "bow", gate: false });
}

function silencePerformance({ stopAuto = false } = {}) {
  activeBowOwners.clear();
  activePointers.clear();
  midiHeldNotes.clear();
  activeMidiNote = null;
  if (stopAuto) state = sanitizeJulieSawState({ ...state, autoPlay: false }, state);
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  updateBowButton();
  canvas.classList.remove("is-dragging");
  updatePresentation();
}

function cancelTransientPerformance() {
  activeBowOwners.clear();
  activePointers.clear();
  midiHeldNotes.clear();
  activeMidiNote = null;
  graph?.sourceNode?.port.postMessage({ type: "bow", gate: false });
  graph?.sourceNode?.port.postMessage({ type: "note-off" });
  updateBowButton();
  canvas.classList.remove("is-dragging");
}

function resetAll() {
  activeBowOwners.clear();
  activePointers.clear();
  midiHeldNotes.clear();
  activeMidiNote = null;
  state = applyJulieSawPreset(JULIE_SAW_DEFAULTS.presetId, JULIE_SAW_DEFAULTS);
  state = sanitizeJulieSawState({ ...state, bowContact: sweetSpotPosition(state) }, state);
  transportStartedAt = performance.now();
  graph?.sourceNode?.port.postMessage({ type: "reset", configuration: state });
  if (graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  }
  updateBowButton();
  canvas.classList.remove("is-dragging");
  updatePresentation();
  announce("Julie Saw reset to a centered, recoverable first note");
}

function installControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", toggleAuto);
  $("resetAll").addEventListener("click", resetAll);
  $("randomizeButton").addEventListener("click", () => {
    state = randomizedJulieSawState(state);
    state = sanitizeJulieSawState({ ...state, trackSweetSpot: Math.random() > .28 }, state);
    if (state.trackSweetSpot) state = sanitizeJulieSawState({ ...state, bowContact: sweetSpotPosition(state) }, state);
    if (state.autoPlay) transportStartedAt = performance.now();
    postConfiguration();
    if (state.autoPlay) postAutomaticState({ triggerCurrent: true });
    updatePresentation();
    announce("A playable new blade, bow, and movement combination is ready");
  });
  $("trackSweetSpot").addEventListener("click", () => {
    const trackSweetSpot = !state.trackSweetSpot;
    commitPatch({
      trackSweetSpot,
      ...(trackSweetSpot ? { bowContact: sweetSpotPosition(state) } : {}),
    }, { custom: false });
    announce(`Moving sweet-spot tracking ${trackSweetSpot ? "on" : "off"}`);
  });
  $("presetSelect").addEventListener("change", (event) => {
    if (event.target.value === "custom") return;
    loadPreset(event.target.value);
  });
  $("bladeSelect").addEventListener("change", (event) => commitPatch(
    { bladeId: event.target.value },
    { followSweetSpot: true, announceText: `${julieSawBlade(event.target.value).label} blade selected` },
  ));
  $("techniqueSelect").addEventListener("change", (event) => loadTechnique(event.target.value));
  $("rhythmSelect").addEventListener("change", (event) => loadRhythm(event.target.value));

  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    if (!input) continue;
    input.addEventListener("input", () => {
      const followSweetSpot = spec.key === "bend" || spec.key === "tipCurl";
      commitPatch({
        [spec.key]: Number(input.value),
        ...(spec.key === "bowContact" ? { trackSweetSpot: false } : {}),
      }, { followSweetSpot });
      if (spec.key === "tempoBpm" && state.autoPlay) postAutomaticState();
    });
  }

  for (const button of document.querySelectorAll("[data-gesture]")) {
    button.addEventListener("click", () => triggerGesture(button.dataset.gesture));
  }
  $("chokeButton").addEventListener("click", () => {
    actionFlash = { gesture: "choke", amount: 1 };
    if (!audioGraphIsRunning()) {
      announceAudioOff();
      return;
    }
    graph.sourceNode.port.postMessage({ type: "choke", duration: 0.24 });
    announce("Blade choked");
  });

  const buttonOwner = "bow-button";
  $("bowButton").addEventListener("pointerdown", (event) => {
    event.preventDefault();
    $("bowButton").setPointerCapture?.(event.pointerId);
    beginBow(buttonOwner, { direction: telemetry.bowDirection || 1 });
  });
  const releaseButton = () => endBow(buttonOwner);
  $("bowButton").addEventListener("pointerup", releaseButton);
  $("bowButton").addEventListener("pointercancel", releaseButton);
  $("bowButton").addEventListener("lostpointercapture", releaseButton);
  $("bowButton").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key) || event.repeat) return;
    event.preventDefault();
    beginBow(buttonOwner, { direction: telemetry.bowDirection || 1 });
  });
  $("bowButton").addEventListener("keyup", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    endBow(buttonOwner);
  });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function updateFlexPointer(pointer, point) {
  const dx = point.x - pointer.startPoint.x;
  const dy = point.y - pointer.startPoint.y;
  commitPatch({
    bend: pointer.startBend + dx / Math.max(160, cssWidth * .34),
    tipCurl: pointer.startCurl - dy / Math.max(120, cssHeight * .3),
  }, { followSweetSpot: true });
}

function contactFromY(y) {
  if (!stageGeometry) return state.bowContact;
  return clamp((stageGeometry.base.y - y) / Math.max(1, stageGeometry.base.y - stageGeometry.tip.y), 0, 1);
}

function updateBowPointer(pointer, point, event) {
  const time = performance.now();
  const elapsed = Math.max(8, time - pointer.lastTime);
  const dx = point.x - pointer.lastPoint.x;
  const instantSpeed = Math.abs(dx) / elapsed;
  pointer.speed = pointer.speed * .7 + instantSpeed * .3;
  if (Math.abs(dx) > 1) pointer.direction = dx < 0 ? -1 : 1;
  pointer.lastPoint = point;
  pointer.lastTime = time;
  const next = {
    bowContact: contactFromY(point.y),
    bowSpeed: clamp(.08 + pointer.speed * .92, ...JULIE_SAW_LIMITS.bowSpeed),
  };
  if (event.pointerType !== "mouse" && Number(event.pressure) > 0) {
    next.bowPressure = clamp(.12 + Number(event.pressure) * 1.15, ...JULIE_SAW_LIMITS.bowPressure);
  }
  next.trackSweetSpot = false;
  visualBowOffset = clamp((point.x - cssWidth * .5) / Math.max(1, cssWidth * .22), -1, 1);
  commitPatch(next);
  updateBow({
    direction: pointer.direction,
    velocityScale: clamp(next.bowSpeed / Math.max(.01, state.bowSpeed), .2, 2),
  });
}

function installCanvasInteractions() {
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    const point = pointFromEvent(event);
    const tip = stageGeometry?.tip ?? { x: cssWidth * .55, y: cssHeight * .2 };
    const bowHandle = stageGeometry?.bowHandle ?? { x: cssWidth * .72, y: cssHeight * .48 };
    const type = distance(point, tip) <= distance(point, bowHandle) ? "flex" : "bow";
    const pointer = {
      type,
      startPoint: point,
      lastPoint: point,
      lastTime: performance.now(),
      startBend: state.bend,
      startCurl: state.tipCurl,
      direction: telemetry.bowDirection || 1,
      speed: state.bowSpeed,
      owner: `canvas-${event.pointerId}`,
    };
    activePointers.set(event.pointerId, pointer);
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    if (type === "flex") updateFlexPointer(pointer, point);
    else {
      updateBowPointer(pointer, point, event);
      beginBow(pointer.owner, { direction: pointer.direction, velocityScale: 1 });
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    const pointer = activePointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (pointer.type === "flex") updateFlexPointer(pointer, point);
    else updateBowPointer(pointer, point, event);
  });
  const releasePointer = (event) => {
    const pointer = activePointers.get(event.pointerId);
    if (!pointer) return;
    activePointers.delete(event.pointerId);
    if (pointer.type === "bow") endBow(pointer.owner);
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId);
    if (activePointers.size === 0) canvas.classList.remove("is-dragging");
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      silencePerformance({ stopAuto: true });
      announce("Julie Saw silenced");
      return;
    }
    const movement = {
      ArrowLeft: { bend: state.bend - (event.shiftKey ? .05 : .0125) },
      ArrowRight: { bend: state.bend + (event.shiftKey ? .05 : .0125) },
      ArrowUp: { tipCurl: state.tipCurl + (event.shiftKey ? .05 : .0125) },
      ArrowDown: { tipCurl: state.tipCurl - (event.shiftKey ? .05 : .0125) },
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    commitPatch(movement, { followSweetSpot: true });
  });
}

function handleMidiInput(event) {
  const { message, routeId, source } = event.detail ?? {};
  if (!message || (routeId && routeId !== "julie-saw")) return;
  if (source === "wax" && document.documentElement.dataset.morphazoidWaxOutputMode === "midi") return;
  const noteNumber = Math.round(Number(message.note));
  if (message.type === "controlChange" && [120, 123].includes(Number(message.controller))) {
    event.preventDefault();
    midiHeldNotes.clear();
    activeMidiNote = null;
    graph?.sourceNode?.port.postMessage({ type: "note-off" });
    graph?.sourceNode?.port.postMessage({ type: "pitch-bend", semitones: 0 });
    announce("MIDI notes released");
    return;
  }
  if (message.type === "noteOn" && Number(message.velocity) > 0) {
    event.preventDefault();
    const note = clamp(Number.isFinite(noteNumber) ? noteNumber : 69, 0, 127);
    const velocity = clamp((Number(message.velocity) || 96) / 127, .02, 1);
    midiHeldNotes.delete(note);
    midiHeldNotes.set(note, velocity);
    activeMidiNote = note;
    if (audioGraphIsRunning()) {
      graph.sourceNode.port.postMessage({
        type: "note-on",
        note,
        frequencyHz: midiToFrequency(note),
        velocity,
        direction: telemetry.bowDirection || 1,
      });
    } else if (
      message.virtual !== true
      && !String(message.sourceId || "").startsWith("computer-keyboard:")
    ) {
      // Enabling hardware MIDI is an explicit opt-in gesture covered by the
      // repository's MIDI exception. ensureAudio() posts the current held note
      // after the graph is ready, and re-checks this stack at that time.
      void ensureAudio();
    } else {
      announceAudioOff();
    }
    return;
  }
  if (message.type === "noteOff" || (message.type === "noteOn" && Number(message.velocity) <= 0)) {
    event.preventDefault();
    const wasActive = activeMidiNote === noteNumber;
    midiHeldNotes.delete(noteNumber);
    if (!wasActive) return;
    if (midiHeldNotes.size === 0) {
      activeMidiNote = null;
      graph?.sourceNode?.port.postMessage({ type: "note-off" });
      return;
    }
    const [fallbackNote, fallbackVelocity] = [...midiHeldNotes.entries()].at(-1);
    activeMidiNote = fallbackNote;
    if (audioGraphIsRunning()) {
      graph.sourceNode.port.postMessage({
        type: "note-on",
        note: fallbackNote,
        frequencyHz: midiToFrequency(fallbackNote),
        velocity: fallbackVelocity,
        direction: telemetry.bowDirection || 1,
      });
    }
    return;
  }
  if (message.type === "pitchBend") {
    event.preventDefault();
    graph?.sourceNode?.port.postMessage({ type: "pitch-bend", semitones: clamp(message.normalized, -1, 1) * 2 });
    return;
  }
  if (message.type === "controlChange" && Number(message.controller) === 1) {
    event.preventDefault();
    commitPatch({ vibratoDepthCents: clamp(message.value, 0, 127) / 127 * 80 });
    return;
  }
  if (message.type === "controlChange" && Number(message.controller) === 74) {
    event.preventDefault();
    commitPatch({
      bowContact: clamp(message.value, 0, 127) / 127,
      trackSweetSpot: false,
    });
  }
}

function bladePoint(t, width = cssWidth, height = cssHeight, bend = state.bend) {
  const base = { x: width * .54, y: height * .84 };
  const tipY = height * .2;
  const normalized = clamp(t);
  const amplitude = width * (.035 + bend * .105);
  const taperMotion = .5 + normalized * .5;
  const tipLean = width * (state.tipCurl - .5) * .085 * normalized * normalized;
  return {
    x: base.x + Math.sin(normalized * TWO_PI) * amplitude * taperMotion + tipLean,
    y: base.y + (tipY - base.y) * normalized,
  };
}

const TWO_PI = Math.PI * 2;

function roundedLine(points, color, width, alpha = 1) {
  if (points.length < 2) return;
  drawing.save();
  drawing.globalAlpha = alpha;
  drawing.strokeStyle = color;
  drawing.lineWidth = width;
  drawing.lineCap = "round";
  drawing.lineJoin = "round";
  drawing.beginPath();
  drawing.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) drawing.lineTo(points[index].x, points[index].y);
  drawing.stroke();
  drawing.restore();
}

function drawWaveform(width, height) {
  if (!graph?.analyser) return;
  graph.analyser.getFloatTimeDomainData(waveform);
  drawing.save();
  drawing.strokeStyle = "rgba(239, 140, 154, 0.16)";
  drawing.lineWidth = 1;
  drawing.beginPath();
  for (let index = 0; index < waveform.length; index += 1) {
    const x = width * .08 + index / (waveform.length - 1) * width * .84;
    const y = height * .92 + waveform[index] * height * .055;
    if (index === 0) drawing.moveTo(x, y);
    else drawing.lineTo(x, y);
  }
  drawing.stroke();
  drawing.restore();
}

function drawChair(width, height) {
  drawing.save();
  drawing.strokeStyle = "rgba(220, 227, 223, 0.28)";
  drawing.lineWidth = Math.max(2, width * .0022);
  drawing.lineCap = "round";
  drawing.beginPath();
  drawing.moveTo(width * .32, height * .59);
  drawing.lineTo(width * .54, height * .59);
  drawing.lineTo(width * .51, height * .85);
  drawing.moveTo(width * .35, height * .59);
  drawing.lineTo(width * .31, height * .88);
  drawing.moveTo(width * .32, height * .59);
  drawing.lineTo(width * .3, height * .34);
  drawing.stroke();
  drawing.restore();
}

function drawJulie(width, height, tip, bowHandle) {
  const activity = clamp(telemetry.activity * 2.2);
  const kneeVibrato = state.vibratoDepthCents > 0
    ? Math.sin(performance.now() * .001 * state.vibratoRateHz * TWO_PI) * Math.min(4, state.vibratoDepthCents * .04) * activity
    : 0;
  const head = { x: width * .38, y: height * .29 };
  const shoulder = { x: width * .4, y: height * .39 };
  const hip = { x: width * .42, y: height * .58 };
  const leftKnee = { x: width * .47 + kneeVibrato, y: height * .72 };
  const rightKnee = { x: width * .59 - kneeVibrato, y: height * .72 };
  drawing.save();
  drawing.strokeStyle = "rgba(220, 227, 223, 0.74)";
  drawing.fillStyle = "rgba(220, 227, 223, 0.055)";
  drawing.lineWidth = Math.max(2, width * .0026);
  drawing.lineCap = "round";
  drawing.lineJoin = "round";
  drawing.beginPath();
  drawing.arc(head.x, head.y, Math.min(width, height) * .046, 0, TWO_PI);
  drawing.fill();
  drawing.stroke();
  drawing.beginPath();
  drawing.moveTo(head.x, head.y + height * .045);
  drawing.quadraticCurveTo(width * .36, height * .45, hip.x, hip.y);
  drawing.lineTo(width * .31, height * .58);
  drawing.moveTo(hip.x, hip.y);
  drawing.lineTo(leftKnee.x, leftKnee.y);
  drawing.lineTo(width * .39, height * .91);
  drawing.moveTo(hip.x + width * .02, hip.y);
  drawing.lineTo(rightKnee.x, rightKnee.y);
  drawing.lineTo(width * .66, height * .91);
  drawing.stroke();
  roundedLine([
    shoulder,
    { x: width * .46, y: height * .41 },
    { x: tip.x - width * .035, y: tip.y + height * .05 },
    tip,
  ], "#ef8c9a", Math.max(3, width * .0044), .86);
  roundedLine([
    { x: shoulder.x + width * .01, y: shoulder.y + height * .015 },
    { x: width * .53, y: height * .46 },
    { x: bowHandle.x - width * .04, y: bowHandle.y + height * .02 },
    bowHandle,
  ], "#efbd72", Math.max(3, width * .0044), .84);
  drawing.fillStyle = "#ef8c9a";
  drawing.beginPath();
  drawing.arc(tip.x, tip.y, Math.max(6, Math.min(width, height) * .012), 0, TWO_PI);
  drawing.fill();
  drawing.fillStyle = "#efbd72";
  drawing.beginPath();
  drawing.arc(bowHandle.x, bowHandle.y, Math.max(6, Math.min(width, height) * .011), 0, TWO_PI);
  drawing.fill();
  drawing.restore();
}

function drawSaw(width, height) {
  const telemetryIsFresh = graph
    && audioContext?.state === "running"
    && performance.now() - lastTelemetryAt < 250;
  const visualBend = telemetryIsFresh ? telemetry.bend ?? state.bend : state.bend;
  const visualContact = telemetryIsFresh ? telemetry.bowContact ?? state.bowContact : state.bowContact;
  const points = Array.from(
    { length: 61 },
    (_, index) => bladePoint(index / 60, width, height, visualBend),
  );
  const base = points[0];
  const tip = points.at(-1);
  const sweetIndex = Math.round(clamp(telemetry.sweetSpot ?? sweetSpotPosition(state)) * 60);
  const contactIndex = Math.round(clamp(visualContact) * 60);
  const sweet = points[sweetIndex];
  const contact = points[contactIndex];
  const alignment = clamp(telemetry.alignment ?? contactAlignment(state));
  drawing.save();
  const glow = drawing.createRadialGradient(sweet.x, sweet.y, 2, sweet.x, sweet.y, Math.min(width, height) * .12);
  glow.addColorStop(0, `rgba(239, 140, 154, ${.18 + alignment * .22})`);
  glow.addColorStop(1, "rgba(239, 140, 154, 0)");
  drawing.fillStyle = glow;
  drawing.beginPath();
  drawing.arc(sweet.x, sweet.y, Math.min(width, height) * .12, 0, TWO_PI);
  drawing.fill();
  drawing.shadowColor = "rgba(220, 227, 223, 0.22)";
  drawing.shadowBlur = 12 + telemetry.activity * 18;
  roundedLine(points, "rgba(220, 227, 223, 0.9)", Math.max(7, width * .009), 1);
  drawing.shadowBlur = 0;
  roundedLine(points, "rgba(65, 70, 68, 0.9)", Math.max(2, width * .002), .75);
  drawing.fillStyle = "rgba(220, 227, 223, 0.62)";
  for (let index = 5; index < points.length - 4; index += 4) {
    const point = points[index];
    const before = points[index - 1];
    const after = points[index + 1];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normal = { x: -dy / length, y: dx / length };
    const root = { x: point.x + normal.x * 4, y: point.y + normal.y * 4 };
    const tooth = { x: point.x + normal.x * (7 + visualBend * 2), y: point.y + normal.y * (7 + visualBend * 2) };
    drawing.beginPath();
    drawing.moveTo(root.x - dx / length * 3.2, root.y - dy / length * 3.2);
    drawing.lineTo(tooth.x, tooth.y);
    drawing.lineTo(root.x + dx / length * 3.2, root.y + dy / length * 3.2);
    drawing.closePath();
    drawing.fill();
  }
  drawing.fillStyle = "#32251b";
  drawing.strokeStyle = "#efbd72";
  drawing.lineWidth = 2;
  drawing.beginPath();
  drawing.roundRect(base.x - width * .035, base.y - height * .018, width * .07, height * .095, 7);
  drawing.fill();
  drawing.stroke();
  const bowTravel = visualBowOffset * width * .035
    + Math.sin(performance.now() * .006 * (telemetry.bowDirection || 1)) * telemetry.envelope * width * .018;
  const bowLength = width * .25;
  const bowY = contact.y;
  drawing.strokeStyle = alignment > .35 ? "rgba(239, 189, 114, 0.94)" : "rgba(239, 140, 154, 0.82)";
  drawing.lineWidth = Math.max(2, width * .0024);
  drawing.beginPath();
  drawing.moveTo(contact.x - bowLength * .52 + bowTravel, bowY - 3);
  drawing.lineTo(contact.x + bowLength * .48 + bowTravel, bowY + 3);
  drawing.stroke();
  drawing.strokeStyle = "rgba(225, 222, 205, 0.6)";
  drawing.lineWidth = 1;
  drawing.beginPath();
  drawing.moveTo(contact.x - bowLength * .5 + bowTravel, bowY + 1);
  drawing.lineTo(contact.x + bowLength * .46 + bowTravel, bowY + 7);
  drawing.stroke();
  const bowHandle = { x: contact.x + bowLength * .51 + bowTravel, y: bowY + 5 };
  drawing.fillStyle = "#efbd72";
  drawing.beginPath();
  drawing.roundRect(bowHandle.x - 8, bowHandle.y - 5, 24, 10, 4);
  drawing.fill();
  drawing.fillStyle = "rgba(239, 140, 154, 0.95)";
  drawing.beginPath();
  drawing.arc(sweet.x, sweet.y, 3 + alignment * 3, 0, TWO_PI);
  drawing.fill();
  drawing.fillStyle = "rgba(220, 227, 223, 0.62)";
  drawing.font = `${Math.max(7, width * .007)}px ui-monospace, SFMono-Regular, monospace`;
  drawing.textAlign = "center";
  drawing.fillText("SWEET", sweet.x - width * .045, sweet.y + 3);
  drawing.fillStyle = "rgba(239, 140, 154, 0.82)";
  drawing.fillText("FLEX", tip.x, tip.y - 14);
  drawing.fillStyle = "rgba(239, 189, 114, 0.82)";
  drawing.fillText("BOW", bowHandle.x + 10, bowHandle.y + 20);
  drawing.restore();
  stageGeometry = { points, base, tip, sweet, contact, bowHandle };
  return stageGeometry;
}

function drawStage() {
  const width = cssWidth;
  const height = cssHeight;
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.fillStyle = "#070708";
  drawing.fillRect(0, 0, width, height);
  drawing.save();
  drawing.strokeStyle = "rgba(220, 227, 223, 0.025)";
  drawing.lineWidth = 1;
  const grid = 32;
  for (let x = 0; x < width; x += grid) {
    drawing.beginPath(); drawing.moveTo(x, 0); drawing.lineTo(x, height); drawing.stroke();
  }
  for (let y = 0; y < height; y += grid) {
    drawing.beginPath(); drawing.moveTo(0, y); drawing.lineTo(width, y); drawing.stroke();
  }
  drawing.restore();
  drawWaveform(width, height);
  drawChair(width, height);
  const geometry = drawSaw(width, height);
  drawJulie(width, height, geometry.tip, geometry.bowHandle);
  if (actionFlash.amount > .01) {
    const center = actionFlash.gesture === "choke" ? geometry.base : geometry.sweet;
    drawing.save();
    drawing.strokeStyle = actionFlash.gesture === "choke"
      ? `rgba(239, 140, 154, ${actionFlash.amount})`
      : `rgba(239, 189, 114, ${actionFlash.amount})`;
    drawing.lineWidth = 2;
    drawing.beginPath();
    drawing.arc(center.x, center.y, 10 + (1 - actionFlash.amount) * 34, 0, TWO_PI);
    drawing.stroke();
    drawing.restore();
    actionFlash.amount *= prefersReducedMotion ? .5 : .91;
  }
}

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, rect.width);
  cssHeight = Math.max(1, rect.height);
  const nativeRatio = Math.max(1, globalThis.devicePixelRatio || 1);
  const pixelBudget = 1_800_000;
  pixelRatio = Math.min(nativeRatio, Math.sqrt(pixelBudget / Math.max(1, cssWidth * cssHeight)));
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  drawStage();
}

function tick(time) {
  const frequency = currentDisplayFrequency();
  $("pitchReadout").textContent = `${pitchName(frequency)} · ${Math.round(frequency)} Hz`;
  const alignment = graph && performance.now() - lastTelemetryAt < 250
    ? telemetry.alignment
    : contactAlignment(state);
  $("contactReadout").textContent = alignment > .78
    ? telemetry.activity > .002 ? "singing · sweet" : "sweet spot"
    : alignment > .3 ? "near sweet spot" : "scrape / weak";
  if (state.autoPlay && (!graph || audioContext?.state !== "running")) {
    const previewStep = transportSnapshot(time).step;
    if (previewStep !== telemetry.step) {
      telemetry.step = previewStep;
      renderRhythmScore(previewStep);
    }
  }
  drawStage();
  animationFrame = requestAnimationFrame(tick);
}

function installGlobalLifecycle() {
  globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
  globalThis.addEventListener("resize", resizeCanvas);
  globalThis.addEventListener("blur", cancelTransientPerformance);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelTransientPerformance();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    silencePerformance({ stopAuto: true });
    announce("Julie Saw silenced");
  });
  new ResizeObserver(resizeCanvas).observe(stageWrap);
  globalThis.addEventListener("pagehide", () => {
    pageIsActive = false;
    lifecycleGeneration += 1;
    audioDesiredOn = false;
    audioGeneration += 1;
    silencePerformance({ stopAuto: true });
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    const closingGraph = graph;
    const closingContext = audioContext;
    graph = null;
    audioContext = null;
    audioStartupPromise = null;
    closingGraph?.releaseOutput?.();
    void closingContext?.close?.();
  });
  globalThis.addEventListener("pageshow", () => {
    if (pageIsActive) return;
    pageIsActive = true;
    waveform.fill(0);
    setAudioPresentation("off");
    updatePresentation();
    resizeCanvas();
    animationFrame = requestAnimationFrame(tick);
  });
}

buildSelects();
installControls();
installCanvasInteractions();
installGlobalLifecycle();
updatePresentation();
resizeCanvas();
animationFrame = requestAnimationFrame(tick);
