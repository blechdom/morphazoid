import {
  HARMONICA_BLUES_RHYTHMS,
  HARMONICA_DEFAULTS,
  HARMONICA_LIMITS,
  HARMONICA_PRESETS,
  HARMONICA_TECHNIQUES,
  activeHoles,
  applyHarmonicaTechnique,
  bendRangeSemitones,
  clamp,
  harmonicaActiveReeds,
  harmonicaBluesRhythm,
  harmonicaBluesRhythmFlow,
  harmonicaBreathCycleFlow,
  harmonicaMaterialProperties,
  harmonicaMouthFormants,
  harmonicaOverbendTarget,
  harmonicaPreset,
  harmonicaReedFrequency,
  harmonicaReedPair,
  harmonicaState,
  harmonicaTechnique,
  randomizeHarmonicaState,
  sanitizeHarmonicaState,
} from "./src/harmonica.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const CONTROL_SPECS = Object.freeze([
  { key: "hole", format: (value) => String(Math.round(value)) },
  { key: "chordWidth", format: formatMouthAperture },
  { key: "embouchure", format: formatPercent },
  { key: "breathPressure", format: formatPercent },
  { key: "breathRateBpm", format: (value) => `${Math.round(value)} cycles/min` },
  { key: "breathBalance", format: (value) => `${Math.round(value * 100)} / ${Math.round((1 - value) * 100)}` },
  { key: "breathAttackMs", format: (value) => `${Math.round(value)} ms` },
  { key: "breathReleaseMs", format: (value) => `${Math.round(value)} ms` },
  { key: "bend", format: formatPercent },
  { key: "overbend", format: formatPercent },
  { key: "reedGap", format: formatPercent },
  { key: "reedStiffness", format: formatPercent },
  { key: "airLeak", format: formatPercent },
  { key: "brightness", format: formatPercent },
  { key: "techniqueAmount", format: formatPercent },
  { key: "techniqueRateHz", format: (value) => `${value.toFixed(1)} Hz` },
  { key: "handCup", format: formatPercent },
  { key: "growl", format: formatPercent },
  { key: "tongueBlock", format: formatPercent },
  { key: "rhythmSwing", format: formatPercent },
  { key: "tonguePosition", format: formatPercent },
  { key: "tongueHeight", format: formatPercent },
  { key: "throatOpening", format: formatPercent },
  { key: "vocalTractCoupling", format: formatPercent },
  { key: "vibratoRateHz", format: (value) => `${value.toFixed(1)} Hz` },
  { key: "vibratoDepth", format: formatPercent },
  { key: "tremoloRateHz", format: (value) => `${value.toFixed(1)} Hz` },
  { key: "tremoloDepth", format: formatPercent },
  { key: "stereoSpread", format: formatPercent },
]);

const VOWEL_SHAPES = Object.freeze({
  a: Object.freeze({ tonguePosition: 0.42, tongueHeight: 0.22, embouchure: 0.12, throatOpening: 0.62 }),
  e: Object.freeze({ tonguePosition: 0.72, tongueHeight: 0.58, embouchure: 0.05, throatOpening: 0.4 }),
  i: Object.freeze({ tonguePosition: 0.9, tongueHeight: 0.84, embouchure: -0.08, throatOpening: 0.25 }),
  o: Object.freeze({ tonguePosition: 0.25, tongueHeight: 0.46, embouchure: 0.82, throatOpening: 0.48 }),
  u: Object.freeze({ tonguePosition: 0.1, tongueHeight: 0.8, embouchure: 1.05, throatOpening: 0.32 }),
});

let state = harmonicaState("c-richter");
let audioContext = null;
let graph = null;
let audioDesiredOn = false;
let audioPresentationStatus = "off";
let audioStartupPromise = null;
let audioTransitionGeneration = 0;
let pageLifecycleGeneration = 0;
let pageIsActive = true;
let manualBreathDirection = 0;
let manualBreathOwner = null;
let manualBreathGeneration = 0;
let commandedBreathFlow = 0;
let visualBreathFlow = 0;
let lastBreathTelemetryAt = -Infinity;
let breathCycleStartedAt = performance.now();
let telemetry = {
  breathFlow: 0,
  direction: 1,
  displacement: 0,
  energy: 0,
  activeFrequencyHz: 0,
  peak: 0,
  rms: 0,
  formants: harmonicaMouthFormants(state).frequenciesHz,
  bendTargetHz: harmonicaMouthFormants(state).bendTargetHz,
  hole: state.hole,
  chordWidth: state.chordWidth,
};
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let animationFrame = 0;
let lastLiveReadoutAt = -Infinity;
let handles = [];
let holeRegions = [];
let pointerDrag = null;

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatMouthAperture(value) {
  const width = Math.round(clamp(value, HARMONICA_LIMITS.chordWidth[0], HARMONICA_LIMITS.chordWidth[1]));
  if (width === 1) return "1-hole single note";
  if (width === 2) return "2-hole double-stop";
  return `${width}-hole chord`;
}

function canvasMouthApertureLabel(compact = false) {
  const width = Math.round(state.chordWidth);
  if (!compact) return `HOLE / MOUTH · ${formatMouthAperture(width).toUpperCase()}`;
  if (width === 1) return "MOUTH · 1";
  if (width === 2) return "MOUTH · 2 STOP";
  return `MOUTH · ${width} CHORD`;
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  return frequency >= 1_000 ? `${(frequency / 1_000).toFixed(2)} kHz` : `${Math.round(frequency)} Hz`;
}

function rangeUnit(value, limits) {
  return clamp((value - limits[0]) / Math.max(1e-9, limits[1] - limits[0]));
}

function rangeValue(unit, limits) {
  return limits[0] + clamp(unit) * (limits[1] - limits[0]);
}

function logarithmicUnit(value, limits) {
  const safe = clamp(value, limits[0], limits[1]);
  return clamp(Math.log(safe / limits[0]) / Math.log(limits[1] / limits[0]));
}

function logarithmicValue(unit, limits) {
  return limits[0] * ((limits[1] / limits[0]) ** clamp(unit));
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const amount = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(amount * 100).toFixed(2)}%`);
}

function setAudioPresentation(status = "off", message = "") {
  audioPresentationStatus = status;
  const on = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  $("audioButton").disabled = status === "starting";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function requestAudioState(on) {
  if (audioDesiredOn !== on) {
    audioDesiredOn = on;
    audioTransitionGeneration += 1;
  }
  return audioTransitionGeneration;
}

function audioConfiguration() {
  return { ...state };
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({ type: "configure", configuration: audioConfiguration() });
}

function sendManualBreath(flow) {
  const next = clamp(flow, HARMONICA_LIMITS.breathFlow[0], HARMONICA_LIMITS.breathFlow[1]);
  commandedBreathFlow = next;
  graph?.sourceNode?.port.postMessage({ type: "breath", flow: next, manual: true });
}

function releaseManualBreath() {
  commandedBreathFlow = breathFlowAt();
  graph?.sourceNode?.port.postMessage({ type: "breath", manual: false });
}

function resetBreathCycle(phase = 0) {
  breathCycleStartedAt = performance.now();
  graph?.sourceNode?.port.postMessage({ type: "breath-cycle-reset", phase });
}

function breathFlowAt(time = performance.now()) {
  if (manualBreathDirection) return manualBreathDirection * state.breathPressure;
  if (!state.autoBreath) return 0;
  const elapsed = Math.max(0, time - breathCycleStartedAt);
  const phase = (elapsed / (60_000 / state.breathRateBpm)) % 1;
  return state.bluesRhythmId === "free"
    ? harmonicaBreathCycleFlow(state, phase)
    : harmonicaBluesRhythmFlow(state, phase);
}

function breathFlowForDisplay(time = performance.now()) {
  if (manualBreathDirection) return commandedBreathFlow;
  const telemetryIsFresh = graph
    && audioContext?.state === "running"
    && time - lastBreathTelemetryAt < 250;
  return telemetryIsFresh ? telemetry.breathFlow : commandedBreathFlow;
}

function breathLabel(flow = breathFlowForDisplay()) {
  const amount = Math.abs(flow);
  if (amount < 0.025) return "rest";
  return `${flow < 0 ? "draw" : "blow"} ${Math.round(amount * 100)}%`;
}

function updateBreathPresentation(flow = breathFlowForDisplay()) {
  const label = breathLabel(flow);
  const rhythm = harmonicaBluesRhythm(state.bluesRhythmId);
  $("breathReadout").textContent = label;
  $("breathSummary").textContent = manualBreathDirection
    ? `manual · ${label}`
    : state.autoBreath ? `auto · ${label}` : "manual · resting";
  $("drawButton").setAttribute("aria-pressed", String(manualBreathDirection < 0));
  $("blowButton").setAttribute("aria-pressed", String(manualBreathDirection > 0));
  $("breathCycleButton").setAttribute("aria-pressed", String(state.autoBreath));
  $("breathCycleButton").setAttribute(
    "aria-label",
    state.autoBreath
      ? `Automatic draw and blow is on with ${rhythm.label} rhythm; activate to stop`
      : `Start automatic draw and blow with the selected ${rhythm.label} rhythm`,
  );
  $("breathCycleState").textContent = state.autoBreath
    ? `${rhythm.label} ↔ ${Math.round(state.breathRateBpm)}/min`
    : "draw ↔ blow · off";
  const meters = [...$("breathMeter").querySelectorAll("i")];
  const amount = clamp(Math.abs(flow) / 3);
  const half = flow < 0 ? 0 : 4;
  const active = amount < 0.008 ? -1 : half + Math.min(3, Math.floor(amount * 4));
  meters.forEach((meter, index) => meter.classList.toggle("is-current", index === active));
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive" });
  let releaseOutput = null;
  try {
    await context.audioWorklet.addModule(new URL("./src/harmonica-processor.js", import.meta.url));
    const sourceNode = new AudioWorkletNode(context, "harmonica-physical-model", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { configuration: audioConfiguration() },
    });
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const analyser = context.createAnalyser();
    masterGain.gain.value = state.level;
    compressor.threshold.value = -14;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.58;
    sourceNode.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(analyser);
    releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
    sourceNode.port.onmessage = (event) => {
      if (event.data?.type !== "telemetry") return;
      telemetry = { ...telemetry, ...event.data };
      lastBreathTelemetryAt = performance.now();
    };
    sourceNode.onprocessorerror = () => setAudioPresentation(
      "error",
      "The harmonica physical model stopped unexpectedly. Reload the page to reset it.",
    );
    return { context, sourceNode, masterGain, compressor, analyser, releaseOutput };
  } catch (error) {
    releaseOutput?.();
    try { await context.close?.(); } catch { /* Preserve the original startup error. */ }
    throw error;
  }
}

async function ensureAudio() {
  const transitionGeneration = requestAudioState(true);
  if (!graph) {
    if (!audioStartupPromise) {
      setAudioPresentation("starting");
      const lifecycleGeneration = pageLifecycleGeneration;
      const startup = createAudioGraph()
        .then((createdGraph) => {
          if (!pageIsActive || !audioDesiredOn || lifecycleGeneration !== pageLifecycleGeneration) {
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
          if (pageIsActive && audioDesiredOn && lifecycleGeneration === pageLifecycleGeneration) {
            setAudioPresentation("error", error?.message || "Unable to start harmonica audio.");
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
      || transitionGeneration !== audioTransitionGeneration
      || activeGraph !== graph
      || activeContext !== audioContext
    ) return false;
    postConfiguration();
    if (manualBreathDirection) sendManualBreath(manualBreathDirection * state.breathPressure);
    else graph?.sourceNode?.port.postMessage({ type: "breath", manual: false });
    setAudioPresentation("on");
    return true;
  } catch (error) {
    console.error(error);
    if (pageIsActive && activeGraph === graph) {
      setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    }
    return false;
  }
}

async function toggleAudio() {
  if (audioDesiredOn && audioPresentationStatus === "on" && audioContext) {
    const transitionGeneration = requestAudioState(false);
    cancelManualBreath({ present: false });
    commandedBreathFlow = 0;
    visualBreathFlow = 0;
    lastBreathTelemetryAt = -Infinity;
    graph?.sourceNode?.port.postMessage({ type: "silence" });
    await audioContext.suspend();
    if (transitionGeneration !== audioTransitionGeneration || audioDesiredOn) return;
    setAudioPresentation("off");
    updateBreathPresentation(0);
    return;
  }
  await ensureAudio();
}

async function beginManualBreath(direction, owner) {
  const requestedDirection = direction < 0 ? -1 : 1;
  const generation = ++manualBreathGeneration;
  manualBreathOwner = owner;
  manualBreathDirection = requestedDirection;
  state = sanitizeHarmonicaState({ ...state, breathDirection: requestedDirection }, state);
  const flow = requestedDirection * state.breathPressure;
  commandedBreathFlow = flow;
  updatePresentation();
  if (!(await ensureAudio())) {
    if (generation === manualBreathGeneration && owner === manualBreathOwner) {
      manualBreathDirection = 0;
      manualBreathOwner = null;
      commandedBreathFlow = 0;
      updatePresentation();
    }
    return;
  }
  if (generation !== manualBreathGeneration || owner !== manualBreathOwner) return;
  sendManualBreath(manualBreathDirection * state.breathPressure);
  updateBreathPresentation(commandedBreathFlow);
}

function changeManualBreath(direction, owner) {
  if (!manualBreathDirection || owner !== manualBreathOwner) return;
  manualBreathDirection = direction < 0 ? -1 : 1;
  state = sanitizeHarmonicaState({ ...state, breathDirection: manualBreathDirection }, state);
  sendManualBreath(manualBreathDirection * state.breathPressure);
  updatePresentation();
}

function endManualBreath(direction, owner) {
  if (
    !manualBreathDirection
    || Math.sign(direction) !== manualBreathDirection
    || owner !== manualBreathOwner
  ) return;
  manualBreathGeneration += 1;
  manualBreathDirection = 0;
  manualBreathOwner = null;
  releaseManualBreath();
  updatePresentation();
}

function cancelManualBreath({ present = true } = {}) {
  manualBreathGeneration += 1;
  manualBreathDirection = 0;
  manualBreathOwner = null;
  releaseManualBreath();
  if (present) updatePresentation();
}

async function toggleBreathCycle() {
  const next = !state.autoBreath;
  if (next && !(await ensureAudio())) return;
  cancelManualBreath({ present: false });
  state = sanitizeHarmonicaState({ ...state, autoBreath: next }, state);
  resetBreathCycle();
  postConfiguration();
  updatePresentation();
  announce(`Automatic draw and blow cycle ${next ? "on" : "off"}`);
}

function updateHoleButtons(flow = breathFlowForDisplay()) {
  const covered = new Set(activeHoles(state));
  const technique = harmonicaTechnique(state.bluesTechniqueId);
  const techniqueHoles = new Set(technique.holes);
  for (const button of $("holeButtons").querySelectorAll("button[data-hole]")) {
    const hole = Number(button.dataset.hole);
    const pair = harmonicaReedPair(state, hole);
    const shortLabel = `${pair.blowName.replace(/\d+$/, "")} / ${pair.drawName.replace(/\d+$/, "")}`;
    const accessibleLabel = `Hole ${hole}; blow ${pair.blowName}; draw ${pair.drawName}`;
    if (button.querySelector("small").textContent !== shortLabel) button.querySelector("small").textContent = shortLabel;
    if (button.getAttribute("aria-label") !== accessibleLabel) button.setAttribute("aria-label", accessibleLabel);
    button.setAttribute("aria-pressed", String(hole === state.hole));
    button.classList.toggle("is-covered", covered.has(hole));
    button.classList.toggle(
      "is-technique-hole",
      technique.id !== "clean" && (techniqueHoles.size === 0 || techniqueHoles.has(hole)),
    );
    button.classList.toggle("is-sounding-draw", covered.has(hole) && flow < -0.025);
    button.classList.toggle("is-sounding-blow", covered.has(hole) && flow > 0.025);
  }
}

function updatePresentation() {
  for (const { key, format } of CONTROL_SPECS) {
    const input = $(key);
    const output = $(`${key}Out`);
    if (input) {
      input.value = String(state[key]);
      updateRangeFill(input);
    }
    if (output) output.textContent = format(state[key]);
  }
  $("level").value = String(state.level);
  $("levelOut").textContent = formatPercent(state.level);
  updateRangeFill($("level"));
  $("presetSelect").value = state.presetId;
  const preset = harmonicaPreset(state.presetId);
  const technique = harmonicaTechnique(state.bluesTechniqueId);
  const bluesRhythm = harmonicaBluesRhythm(state.bluesRhythmId);
  const material = harmonicaMaterialProperties(state);
  const pair = harmonicaReedPair(state, state.hole);
  const flow = breathFlowForDisplay();
  const direction = Math.abs(flow) > 0.025 ? Math.sign(flow) : state.breathDirection;
  const reed = harmonicaReedFrequency(state, state.hole, direction);
  const formants = harmonicaMouthFormants(state);
  $("presetDescription").textContent = preset.description;
  if ($("bluesTechniqueSelect")) $("bluesTechniqueSelect").value = technique.id;
  if ($("bluesRhythmSelect")) $("bluesRhythmSelect").value = bluesRhythm.id;
  if ($("techniqueDescription")) $("techniqueDescription").textContent = technique.description;
  if ($("rhythmDescription")) {
    $("rhythmDescription").textContent = `${bluesRhythm.description} Auto alternates draw and blow with this pattern; N cycles rhythms.`;
  }
  if ($("bluesSummary")) {
    const directionLabel = technique.direction < 0
      ? "draw"
      : technique.direction > 0 ? "blow" : "either direction";
    $("bluesSummary").textContent = `${technique.label} · ${directionLabel}`;
  }
  for (const button of $("bluesTechniqueButtons")?.querySelectorAll("button[data-technique]") ?? []) {
    const selected = button.dataset.technique === technique.id;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-active", selected);
  }
  for (const button of $("chordWidthButtons")?.querySelectorAll("button[data-chord-width]") ?? []) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.chordWidth) === state.chordWidth));
  }
  if ($("mouthApertureReadout")) $("mouthApertureReadout").textContent = formatMouthAperture(state.chordWidth);
  $("drawButton").classList.toggle("is-technique-direction", technique.direction < 0);
  $("blowButton").classList.toggle("is-technique-direction", technique.direction > 0);
  $("holeReadout").textContent = `${state.hole} · ${pair.blowName} / ${pair.drawName}`;
  $("noteReadout").textContent = Math.abs(flow) > 0.025
    ? `${direction < 0 ? "draw" : "blow"} ${reed.noteName} · ${formatFrequency(reed.frequencyHz)}`
    : `rest · ${pair.blowName} / ${pair.drawName}`;
  const availableBend = bendRangeSemitones(state.hole, direction);
  const overbendTarget = harmonicaOverbendTarget(state, state.hole, direction);
  $("bendReadout").textContent = state.overbend > 0.01 && overbendTarget.legal
    ? `${direction < 0 ? "overdraw" : "overblow"} ${overbendTarget.noteName} · ${Math.round(state.overbend * 100)}% choke`
    : availableBend > 0
      ? `${reed.bendSemitones.toFixed(2)} semitones · ${direction < 0 ? "draw" : "blow"}`
      : `no ${direction < 0 ? "draw" : "blow"} bend on hole ${state.hole}`;
  $("tractReadout").textContent = `${Math.round(state.vocalTractCoupling * 100)}% · ${formatFrequency(formants.bendTargetHz)}`;
  $("instrumentSummary").textContent = `hole ${state.hole} · ${formatMouthAperture(state.chordWidth)}`;
  $("reedSummary").textContent = `${preset.family} · ${Math.round(state.reedGap * 100)}% gap`;
  $("mouthSummary").textContent = `tongue ${Math.round(state.tonguePosition * 100)} / ${Math.round(state.tongueHeight * 100)} · throat ${Math.round(state.throatOpening * 100)}`;
  $("motionSummary").textContent = `${technique.label} · ${state.techniqueRateHz.toFixed(1)} Hz · ${Math.round(state.techniqueAmount * 100)}%`;
  $("presetDescription").dataset.material = `${Math.round(material.youngsModulusPa / 1e9)} GPa · ${Math.round(material.densityKgM3)} kg/m³`;
  updateHoleButtons(flow);
  updateBreathPresentation(flow);
}

function setControl(key, value, { announceChange = false } = {}) {
  state = sanitizeHarmonicaState({ ...state, [key]: value }, state);
  if (["breathRateBpm", "breathBalance", "rhythmSwing"].includes(key)) resetBreathCycle();
  updatePresentation();
  if (key === "level" && graph?.masterGain && audioContext) {
    graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
  } else postConfiguration();
  if (key === "breathPressure" && manualBreathDirection) {
    sendManualBreath(manualBreathDirection * state.breathPressure);
  }
  if (announceChange) {
    announce(key === "chordWidth"
      ? `Mouth aperture ${formatMouthAperture(state.chordWidth)}; covering holes ${activeHoles(state).join(", ")}`
      : `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()} changed`);
  }
}

function selectHole(hole, { announceChange = false } = {}) {
  const previous = state.hole;
  state = sanitizeHarmonicaState({ ...state, hole }, state);
  updatePresentation();
  postConfiguration();
  if (announceChange && state.hole !== previous) {
    const pair = harmonicaReedPair(state, state.hole);
    announce(`Hole ${state.hole}: blow ${pair.blowName}, draw ${pair.drawName}`);
  }
}

function loadPreset(presetId) {
  const retained = {
    hole: state.hole,
    chordWidth: state.chordWidth,
    breathDirection: state.breathDirection,
    breathPressure: state.breathPressure,
    breathRateBpm: state.breathRateBpm,
    breathBalance: state.breathBalance,
    autoBreath: state.autoBreath,
    bluesTechniqueId: state.bluesTechniqueId,
    bluesRhythmId: state.bluesRhythmId,
    techniqueAmount: state.techniqueAmount,
    techniqueRateHz: state.techniqueRateHz,
    breathAttackMs: state.breathAttackMs,
    breathReleaseMs: state.breathReleaseMs,
    handCup: state.handCup,
    growl: state.growl,
    tongueBlock: state.tongueBlock,
    overbend: state.overbend,
    rhythmSwing: state.rhythmSwing,
    bend: state.bend,
    embouchure: state.embouchure,
    tonguePosition: state.tonguePosition,
    tongueHeight: state.tongueHeight,
    throatOpening: state.throatOpening,
    vocalTractCoupling: state.vocalTractCoupling,
    vibratoRateHz: state.vibratoRateHz,
    vibratoDepth: state.vibratoDepth,
    tremoloRateHz: state.tremoloRateHz,
    tremoloDepth: state.tremoloDepth,
    stereoSpread: state.stereoSpread,
    level: state.level,
  };
  state = harmonicaState(presetId, retained);
  updatePresentation();
  postConfiguration();
  announce(`${harmonicaPreset(presetId).label} physical body loaded`);
}

function randomizeModel() {
  state = randomizeHarmonicaState(state);
  resetBreathCycle();
  if (manualBreathDirection) sendManualBreath(manualBreathDirection * state.breathPressure);
  updatePresentation();
  postConfiguration();
  announce("Harmonica technique, rhythm, reeds, breath, mouth, bend, and motion randomized");
}

function buildPresetOptions() {
  $("presetSelect").replaceChildren(...HARMONICA_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} · ${preset.family}`;
    return option;
  }));
}

function buildBluesControls() {
  $("bluesTechniqueSelect")?.replaceChildren(...HARMONICA_TECHNIQUES.map((technique) => {
    const option = document.createElement("option");
    option.value = technique.id;
    option.textContent = technique.label;
    return option;
  }));
  $("bluesRhythmSelect")?.replaceChildren(...HARMONICA_BLUES_RHYTHMS.map((rhythm) => {
    const option = document.createElement("option");
    option.value = rhythm.id;
    option.textContent = rhythm.label;
    return option;
  }));
  $("bluesTechniqueButtons")?.replaceChildren(...HARMONICA_TECHNIQUES.map((technique) => {
    const button = document.createElement("button");
    const label = document.createElement("b");
    const detail = document.createElement("small");
    button.type = "button";
    button.dataset.technique = technique.id;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute(
      "aria-label",
      `${technique.label}. ${technique.direction < 0 ? "Draw or inhale" : technique.direction > 0 ? "Blow or exhale" : "Blow or draw"}. ${technique.description}`,
    );
    label.textContent = technique.label;
    const directionLabel = technique.direction < 0
      ? "DRAW"
      : technique.direction > 0 ? "BLOW" : "BOTH";
    detail.textContent = technique.holes.length > 0
      ? `${directionLabel} · ${technique.holes.join(" ")}`
      : directionLabel;
    button.append(label, detail);
    button.addEventListener("click", () => loadBluesTechnique(technique.id));
    return button;
  }));
}

function loadBluesTechnique(techniqueId, { announceChange = true } = {}) {
  const technique = harmonicaTechnique(techniqueId);
  state = applyHarmonicaTechnique(state, technique.id);
  resetBreathCycle();
  if (manualBreathDirection && technique.direction) {
    changeManualBreath(technique.direction, manualBreathOwner);
  } else if (manualBreathDirection) {
    sendManualBreath(manualBreathDirection * state.breathPressure);
  }
  updatePresentation();
  postConfiguration();
  if (announceChange) {
    announce(`${technique.label} loaded. ${technique.direction < 0 ? "Draw or inhale" : technique.direction > 0 ? "Blow or exhale" : "Blow or draw"}.`);
  }
}

function setBluesRhythm(rhythmId, { announceChange = true } = {}) {
  const rhythm = harmonicaBluesRhythm(rhythmId);
  state = sanitizeHarmonicaState({ ...state, bluesRhythmId: rhythm.id }, state);
  resetBreathCycle();
  updatePresentation();
  postConfiguration();
  if (announceChange) announce(`${rhythm.label} breath rhythm loaded`);
}

function installHoldButton(button, direction) {
  let pointerOwner = null;
  let lastDirectHoldAt = -Infinity;
  const keyboardOwner = { type: "button-keyboard", id: button.id };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    lastDirectHoldAt = performance.now();
    pointerOwner = { type: "button-pointer", id: button.id, pointerId: event.pointerId };
    button.setPointerCapture?.(event.pointerId);
    void beginManualBreath(direction, pointerOwner);
  });
  const releasePointer = (event) => {
    if (!pointerOwner || pointerOwner.pointerId !== event.pointerId) return;
    const owner = pointerOwner;
    pointerOwner = null;
    endManualBreath(direction, owner);
  };
  button.addEventListener("pointerup", releasePointer);
  button.addEventListener("pointercancel", releasePointer);
  button.addEventListener("lostpointercapture", releasePointer);
  button.addEventListener("keydown", (event) => {
    if (![" ", "Enter"].includes(event.key) || event.repeat) return;
    event.preventDefault();
    lastDirectHoldAt = performance.now();
    void beginManualBreath(direction, keyboardOwner);
  });
  button.addEventListener("keyup", (event) => {
    if (![" ", "Enter"].includes(event.key)) return;
    event.preventDefault();
    endManualBreath(direction, keyboardOwner);
  });
  button.addEventListener("click", async () => {
    if (performance.now() - lastDirectHoldAt < 250) return;
    const owner = { type: "button-click", id: button.id, startedAt: performance.now() };
    await beginManualBreath(direction, owner);
    globalThis.setTimeout(() => endManualBreath(direction, owner), 180);
  });
}

function installControls() {
  $("audioButton").addEventListener("click", toggleAudio);
  $("breathCycleButton").addEventListener("click", toggleBreathCycle);
  installHoldButton($("drawButton"), -1);
  installHoldButton($("blowButton"), 1);
  for (const { key } of CONTROL_SPECS) {
    $(key).addEventListener("input", (event) => setControl(key, Number(event.currentTarget.value)));
  }
  $("level").addEventListener("input", (event) => setControl("level", Number(event.currentTarget.value)));
  $("presetSelect").addEventListener("change", (event) => loadPreset(event.currentTarget.value));
  $("bluesTechniqueSelect")?.addEventListener("change", (event) => {
    loadBluesTechnique(event.currentTarget.value);
  });
  $("bluesRhythmSelect")?.addEventListener("change", (event) => {
    setBluesRhythm(event.currentTarget.value);
  });
  $("randomizeButton").addEventListener("click", randomizeModel);
  for (const button of $("holeButtons").querySelectorAll("button[data-hole]")) {
    button.addEventListener("click", () => selectHole(Number(button.dataset.hole), { announceChange: true }));
  }
  for (const button of $("chordWidthButtons")?.querySelectorAll("button[data-chord-width]") ?? []) {
    button.addEventListener("click", () => {
      setControl("chordWidth", Number(button.dataset.chordWidth), { announceChange: true });
    });
  }
  $("resetAll").addEventListener("click", () => {
    cancelManualBreath({ present: false });
    state = { ...HARMONICA_DEFAULTS };
    resetBreathCycle();
    updatePresentation();
    postConfiguration();
    if (graph?.masterGain && audioContext) {
      graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
    }
    announce("Harmonica restored to C Richter, clean tone, free breath, hole four, and a single-note embouchure");
  });
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const maximumPixels = 2_800_000;
  const pixels = cssWidth * cssHeight * pixelRatio * pixelRatio;
  if (pixels > maximumPixels) pixelRatio *= Math.sqrt(maximumPixels / pixels);
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function articulationToVisual(value) {
  const amount = clamp(value, -2, 3);
  if (amount < 0) return -0.42 * (1 - Math.exp(amount));
  if (amount > 1) return 1 + 0.58 * (1 - Math.exp(1 - amount));
  return amount;
}

function layout() {
  const compact = cssHeight < 400 || cssWidth < 670;
  const combLeft = compact ? 16 : Math.max(148, cssWidth * 0.16);
  const combRight = compact ? cssWidth * 0.72 : cssWidth * 0.73;
  const combY = cssHeight * (compact ? 0.58 : 0.56);
  const combHeight = Math.min(compact ? 78 : 126, cssHeight * (compact ? 0.3 : 0.2));
  const combTop = combY - combHeight * 0.5;
  const combBottom = combY + combHeight * 0.5;
  const holeWidth = (combRight - combLeft) / 10;
  const holeCenter = combLeft + (state.hole - 0.5) * holeWidth;
  const airWidth = compact ? 60 : 112;
  const airHeight = compact ? 40 : 66;
  const airLeft = compact ? 16 : 34;
  const airTop = clamp(
    combTop - (compact ? 72 : 112),
    compact ? 82 : 164,
    Math.max(compact ? 82 : 164, combTop - airHeight - 26),
  );
  const airPad = {
    left: airLeft,
    right: airLeft + airWidth,
    top: airTop,
    bottom: airTop + airHeight,
  };
  airPad.x = airPad.left
    + logarithmicUnit(state.breathRateBpm, HARMONICA_LIMITS.breathRateBpm) * airWidth;
  airPad.y = airPad.bottom
    - rangeUnit(state.breathPressure, HARMONICA_LIMITS.breathPressure) * airHeight;
  const rhythmPad = {
    left: airPad.right + (compact ? 16 : 24),
    right: airPad.right + (compact ? 76 : 136),
    top: airPad.top,
    bottom: airPad.bottom,
  };
  rhythmPad.x = rhythmPad.left
    + logarithmicUnit(state.techniqueRateHz, HARMONICA_LIMITS.techniqueRateHz)
      * (rhythmPad.right - rhythmPad.left);
  rhythmPad.y = rhythmPad.bottom
    - rangeUnit(state.techniqueAmount, HARMONICA_LIMITS.techniqueAmount)
      * (rhythmPad.bottom - rhythmPad.top);
  const chamberWidth = compact ? 68 : 118;
  const chamberHeight = compact ? 54 : 88;
  const chamberLeft = combRight - chamberWidth;
  const chamber = {
    left: chamberLeft,
    right: chamberLeft + chamberWidth,
    top: combTop - (compact ? 70 : 132),
    bottom: combTop - (compact ? 16 : 34),
  };
  const bendPad = {
    left: chamber.left + 10,
    right: chamber.right - 10,
    top: chamber.top + 12,
    bottom: chamber.bottom - 10,
  };
  bendPad.x = bendPad.left + rangeUnit(state.bend, HARMONICA_LIMITS.bend) * (bendPad.right - bendPad.left);
  bendPad.y = bendPad.bottom - rangeUnit(state.reedGap, HARMONICA_LIMITS.reedGap) * (bendPad.bottom - bendPad.top);
  const lipX = combRight + 3;
  const throatX = cssWidth - (compact ? 17 : 34);
  const mouthTop = combY - (compact ? 42 : 66);
  const mouthBottom = combY + (compact ? 42 : 66);
  const tonguePad = {
    left: lipX + 8,
    right: Math.max(lipX + 38, throatX - (compact ? 8 : 28)),
    top: mouthTop + 8,
    bottom: mouthBottom - 8,
  };
  tonguePad.x = tonguePad.left
    + rangeUnit(state.tonguePosition, HARMONICA_LIMITS.tonguePosition) * (tonguePad.right - tonguePad.left);
  tonguePad.y = tonguePad.bottom
    - rangeUnit(state.tongueHeight, HARMONICA_LIMITS.tongueHeight) * (tonguePad.bottom - tonguePad.top);
  const tractPad = {
    left: Math.max(lipX + 20, throatX - (compact ? 34 : 66)),
    right: throatX,
    top: mouthTop - (compact ? 9 : 18),
    bottom: mouthBottom + (compact ? 9 : 18),
  };
  tractPad.x = tractPad.left
    + rangeUnit(state.throatOpening, HARMONICA_LIMITS.throatOpening) * (tractPad.right - tractPad.left);
  tractPad.y = tractPad.bottom
    - rangeUnit(state.vocalTractCoupling, HARMONICA_LIMITS.vocalTractCoupling) * (tractPad.bottom - tractPad.top);
  const coveredHoles = activeHoles(state);
  const apertureCenter = coveredHoles.reduce((sum, hole) => sum + hole, 0) / coveredHoles.length;
  const embouchureY = combTop - 12 - (state.chordWidth - 1) * (compact ? 2.5 : 4);
  const lipReach = articulationToVisual(state.embouchure) * (compact ? 12 : 20);
  const cupWidth = compact ? 56 : 94;
  const cupHeight = compact ? 34 : 54;
  const cupTop = combBottom + (compact ? 13 : 18);
  const cupPad = {
    left: combRight - cupWidth - (compact ? 3 : 12),
    right: combRight - (compact ? 3 : 12),
    top: cupTop,
    bottom: Math.max(cupTop + 12, Math.min(cssHeight - 18, cupTop + cupHeight)),
  };
  cupPad.x = cupPad.left
    + rangeUnit(state.handCup, HARMONICA_LIMITS.handCup) * (cupPad.right - cupPad.left);
  cupPad.y = cupPad.bottom
    - rangeUnit(state.growl, HARMONICA_LIMITS.growl) * (cupPad.bottom - cupPad.top);
  return {
    compact,
    combLeft,
    combRight,
    combY,
    combTop,
    combBottom,
    combHeight,
    holeWidth,
    holeCenter,
    airPad,
    rhythmPad,
    chamber,
    bendPad,
    lipX,
    throatX,
    mouthTop,
    mouthBottom,
    tonguePad,
    tractPad,
    cupPad,
    embouchureX: combLeft + (apertureCenter - 0.5) * holeWidth,
    embouchureY,
    lipsX: lipX + 13 + lipReach,
    lipsY: combY + 2,
  };
}

function strokePath(color, width = 1, alpha = 1) {
  drawing.strokeStyle = color;
  drawing.lineWidth = width;
  drawing.globalAlpha = alpha;
  drawing.stroke();
  drawing.globalAlpha = 1;
}

function drawNode(x, y, color, label, type, radius = 7) {
  drawing.save();
  drawing.shadowColor = color;
  drawing.shadowBlur = 12;
  drawing.fillStyle = "#050707";
  drawing.strokeStyle = color;
  drawing.lineWidth = 1.5;
  drawing.beginPath();
  drawing.arc(x, y, radius, 0, Math.PI * 2);
  drawing.fill();
  drawing.stroke();
  drawing.shadowBlur = 0;
  drawing.fillStyle = color;
  drawing.font = "650 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText(label, x, y - radius - 8);
  drawing.restore();
  handles.push({ type, x, y, radius: radius + 14 });
}

function drawParameterPad(pad, color, title, xAxis, yAxis) {
  drawing.save();
  drawing.fillStyle = color;
  drawing.globalAlpha = 0.025;
  drawing.fillRect(pad.left, pad.top, pad.right - pad.left, pad.bottom - pad.top);
  drawing.globalAlpha = 0.24;
  drawing.strokeStyle = color;
  drawing.lineWidth = 0.75;
  drawing.strokeRect(pad.left, pad.top, pad.right - pad.left, pad.bottom - pad.top);
  drawing.beginPath();
  drawing.moveTo(pad.left, (pad.top + pad.bottom) * 0.5);
  drawing.lineTo(pad.right, (pad.top + pad.bottom) * 0.5);
  drawing.moveTo((pad.left + pad.right) * 0.5, pad.top);
  drawing.lineTo((pad.left + pad.right) * 0.5, pad.bottom);
  drawing.stroke();
  drawing.globalAlpha = 0.72;
  drawing.fillStyle = color;
  drawing.font = "650 6px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText(title, pad.left, pad.top - 7);
  drawing.textAlign = "right";
  drawing.fillText(`${yAxis} ↑`, pad.right, pad.top - 7);
  drawing.textAlign = "center";
  drawing.globalAlpha = 0.48;
  drawing.fillText(`${xAxis} →`, (pad.left + pad.right) * 0.5, pad.bottom + 10);
  drawing.restore();
}

function drawMouth(model) {
  const { compact, lipX, throatX, combY, mouthTop, mouthBottom, tonguePad } = model;
  const cup = articulationToVisual(state.embouchure);
  const lipReach = cup < 0 ? cup * (compact ? 18 : 30) : cup * (compact ? 12 : 20);
  const topY = combY - (compact ? 88 : 142);
  const eyeFlow = clamp(visualBreathFlow / Math.max(0.2, state.breathPressure), -1, 1);
  const eyeOpen = 1 + Math.max(0, eyeFlow) * 0.28 - Math.max(0, -eyeFlow) * 0.08;
  drawing.save();

  drawing.beginPath();
  drawing.moveTo(lipX + 14, combY + 8 + lipReach * 0.2);
  drawing.bezierCurveTo(lipX + 5 + lipReach, combY + 18, lipX + 5 + lipReach, combY + 28, lipX + 24, combY + 31);
  drawing.bezierCurveTo(lipX + 7, combY + 65, throatX - 8, mouthBottom + 62, throatX, mouthBottom + 20);
  drawing.bezierCurveTo(throatX + 12, combY - 8, throatX + 9, topY + 24, lipX + 48, topY);
  drawing.bezierCurveTo(lipX + 20, topY - 3, lipX - 30, combY - 82, lipX - 38, combY - 61);
  drawing.bezierCurveTo(lipX - 49, combY - 48, lipX - 23, combY - 33, lipX + 3, combY - 34);
  drawing.bezierCurveTo(lipX + 10, combY - 18, lipX + 2 + lipReach, combY - 10, lipX + 13, combY - 7);
  strokePath("#77807b", 1.1, 0.68);

  drawing.beginPath();
  drawing.moveTo(throatX - 3, topY + 10);
  drawing.bezierCurveTo(throatX - 22, topY - 9, lipX + 43, topY - 12, lipX + 35, topY + 10);
  drawing.lineTo(lipX + 48, topY + 16);
  drawing.lineTo(lipX + 34, topY + 22);
  drawing.lineTo(lipX + 50, topY + 29);
  drawing.bezierCurveTo(throatX - 15, topY + 20, throatX - 4, combY - 45, throatX + 2, combY - 10);
  drawing.closePath();
  drawing.fillStyle = "rgba(72, 48, 43, 0.42)";
  drawing.fill();
  strokePath("#b86f60", 0.8, 0.45);

  drawing.beginPath();
  drawing.moveTo(lipX + 12 + lipReach, combY - 6);
  drawing.bezierCurveTo(lipX + 35, mouthTop, throatX - 28, mouthTop + 2, throatX - 5, combY - 10);
  drawing.bezierCurveTo(throatX - 18, combY + 20, lipX + 42, mouthBottom, lipX + 12 + lipReach, combY + 8);
  drawing.closePath();
  drawing.fillStyle = "rgba(105, 213, 221, 0.055)";
  drawing.fill();
  strokePath("#69d5dd", 1, 0.48);

  drawing.beginPath();
  drawing.moveTo(lipX + 17 + lipReach * 0.72, combY + 7);
  drawing.bezierCurveTo(tonguePad.x - 15, combY + 31, tonguePad.x + 18, tonguePad.y, tonguePad.x, tonguePad.y);
  drawing.bezierCurveTo(tonguePad.x - 22, tonguePad.y, throatX - 34, combY + 27, throatX - 9, combY + 18);
  strokePath("#a99bef", 1.35, 0.72);

  const eyeX = lipX + (compact ? 27 : 39);
  const eyeY = combY - (compact ? 61 : 93);
  const eyeWidth = compact ? 6.5 : 8.5;
  const eyeHeight = (compact ? 2.4 : 3.2) * eyeOpen;
  drawing.beginPath();
  drawing.moveTo(eyeX - eyeWidth, eyeY);
  drawing.quadraticCurveTo(eyeX, eyeY - eyeHeight, eyeX + eyeWidth, eyeY);
  drawing.quadraticCurveTo(eyeX, eyeY + eyeHeight, eyeX - eyeWidth, eyeY);
  drawing.closePath();
  drawing.fillStyle = "rgba(224, 231, 227, 0.76)";
  drawing.fill();
  strokePath("#9ea7a2", 0.7, 0.68);
  drawing.beginPath();
  drawing.arc(eyeX - 1, eyeY, Math.max(0.8, eyeHeight * 0.45), 0, Math.PI * 2);
  drawing.fillStyle = "#69d5dd";
  drawing.fill();
  drawing.restore();
}

function drawBluesCup(model) {
  const phase = prefersReducedMotion
    ? 0
    : (performance.now() / 1_000 * state.techniqueRateHz) % 1;
  const wahPhase = 0.5 + 0.5 * Math.sin(Math.PI * 2 * phase);
  const wahWet = state.bluesTechniqueId === "hand-wah"
    ? clamp(state.techniqueAmount)
    : 0;
  const effectiveCup = state.handCup * (1 - wahWet * 0.88 * (1 - wahPhase));
  const closure = rangeUnit(effectiveCup, HARMONICA_LIMITS.handCup);
  const growlAmount = rangeUnit(state.growl, HARMONICA_LIMITS.growl);
  const inset = closure * (model.compact ? 15 : 28);
  const left = model.combRight - (model.compact ? 46 : 82);
  const right = model.throatX - (model.compact ? 1 : 8);
  const top = model.combTop - (model.compact ? 8 : 16) + inset * 0.22;
  const bottom = model.combBottom + (model.compact ? 30 : 52) - inset * 0.35;
  drawing.save();
  drawing.beginPath();
  drawing.moveTo(left, top);
  drawing.bezierCurveTo(
    model.combRight + 18 - inset,
    top - 12,
    right - 5,
    model.combY - 38 + inset,
    right,
    model.combY,
  );
  drawing.bezierCurveTo(
    right - 4,
    model.combY + 42 - inset,
    model.combRight + 12 - inset,
    bottom + 10,
    left,
    bottom,
  );
  drawing.strokeStyle = `rgba(240, 189, 105, ${0.12 + closure * 0.58})`;
  drawing.lineWidth = 1 + closure * 2.2;
  drawing.stroke();
  drawing.beginPath();
  drawing.moveTo(left + 7, top + 5);
  drawing.bezierCurveTo(
    model.combRight + 7 - inset * 0.8,
    model.combY - 24,
    model.combRight + 8 - inset * 0.8,
    model.combY + 24,
    left + 7,
    bottom - 5,
  );
  drawing.strokeStyle = `rgba(227, 106, 93, ${0.08 + closure * 0.4})`;
  drawing.lineWidth = 0.8 + closure;
  drawing.stroke();
  if (growlAmount > 0.01) {
    drawing.strokeStyle = `rgba(169, 155, 239, ${0.18 + growlAmount * 0.52})`;
    drawing.lineWidth = 0.8 + growlAmount * 1.2;
    for (let line = 0; line < 3; line += 1) {
      drawing.beginPath();
      for (let point = 0; point <= 18; point += 1) {
        const unit = point / 18;
        const x = model.lipX + 22 + (model.throatX - model.lipX - 32) * unit;
        const y = model.combY + 12 + line * 5
          + Math.sin(unit * Math.PI * 5 + phase * Math.PI * 2 + line * 1.4) * growlAmount * 4;
        if (point === 0) drawing.moveTo(x, y);
        else drawing.lineTo(x, y);
      }
      drawing.stroke();
    }
  }
  drawing.restore();
}

function drawHarmonica(model) {
  const {
    compact, combLeft, combRight, combTop, combBottom, combY, holeWidth, chamber,
  } = model;
  const covered = new Set(activeHoles(state));
  const flow = visualBreathFlow;
  const soundingDirection = flow < -0.02 ? -1 : flow > 0.02 ? 1 : 0;
  const overbendSpeaking = Boolean(telemetry.overbendActive) && soundingDirection !== 0;
  const blowReedSpeaking = soundingDirection > 0
    ? !overbendSpeaking
    : soundingDirection < 0 && overbendSpeaking;
  const drawReedSpeaking = soundingDirection < 0
    ? !overbendSpeaking
    : soundingDirection > 0 && overbendSpeaking;
  const pairedMotionScale = clamp(
    Number.isFinite(telemetry.passiveReedGain)
      ? telemetry.passiveReedGain
      : state.bend * state.vocalTractCoupling * 0.34,
    0,
    0.62,
  );
  const metal = drawing.createLinearGradient(combLeft, combTop, combLeft, combBottom);
  metal.addColorStop(0, "rgba(228, 234, 231, 0.42)");
  metal.addColorStop(0.2, "rgba(95, 104, 99, 0.28)");
  metal.addColorStop(0.5, "rgba(15, 18, 17, 0.9)");
  metal.addColorStop(0.8, "rgba(95, 104, 99, 0.28)");
  metal.addColorStop(1, "rgba(228, 234, 231, 0.38)");
  drawing.fillStyle = metal;
  drawing.fillRect(combLeft - 7, combTop - 8, combRight - combLeft + 14, combBottom - combTop + 16);
  drawing.strokeStyle = "rgba(216, 223, 220, 0.72)";
  drawing.lineWidth = 1;
  drawing.strokeRect(combLeft - 7, combTop - 8, combRight - combLeft + 14, combBottom - combTop + 16);
  drawing.fillStyle = "rgba(151, 38, 35, 0.52)";
  drawing.fillRect(combLeft, combTop + 14, combRight - combLeft, combBottom - combTop - 28);

  holeRegions = [];
  for (let hole = 1; hole <= 10; hole += 1) {
    const left = combLeft + (hole - 1) * holeWidth + 2;
    const right = combLeft + hole * holeWidth - 2;
    const top = combTop + 18;
    const bottom = combBottom - 18;
    const pair = harmonicaReedPair(state, hole);
    const isCovered = covered.has(hole);
    const isCenter = hole === state.hole;
    const activeColor = overbendSpeaking
      ? "#a99bef"
      : soundingDirection < 0 ? "#69d5dd" : soundingDirection > 0 ? "#f0bd69" : "#e36a5d";
    drawing.fillStyle = isCovered ? "rgba(227, 106, 93, 0.16)" : "rgba(3, 5, 5, 0.92)";
    drawing.fillRect(left, top, right - left, bottom - top);
    drawing.strokeStyle = isCenter ? activeColor : "rgba(216, 223, 220, 0.24)";
    drawing.lineWidth = isCenter ? 1.6 : 0.7;
    drawing.strokeRect(left, top, right - left, bottom - top);
    const centerX = (left + right) * 0.5;
    const centerY = (top + bottom) * 0.5;
    const motion = isCovered ? clamp(telemetry.displacement, -1.4, 1.4) * (compact ? 2.5 : 5) : 0;
    const pairedMotion = motion * pairedMotionScale;
    drawing.beginPath();
    drawing.moveTo(left + 4, centerY - 9);
    drawing.lineTo(right - 4, centerY - 9 + (blowReedSpeaking ? motion : pairedMotion));
    strokePath(blowReedSpeaking && isCovered ? (overbendSpeaking ? "#a99bef" : "#f0bd69") : "#aab2ae", 1.1, isCovered ? 0.9 : 0.36);
    drawing.beginPath();
    drawing.moveTo(left + 4, centerY + 9);
    drawing.lineTo(right - 4, centerY + 9 + (drawReedSpeaking ? motion : pairedMotion));
    strokePath(drawReedSpeaking && isCovered ? (overbendSpeaking ? "#a99bef" : "#69d5dd") : "#aab2ae", 1.1, isCovered ? 0.9 : 0.36);
    drawing.fillStyle = isCenter ? "#e36a5d" : "rgba(216, 223, 220, 0.68)";
    drawing.font = `${compact ? 6 : 8}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    drawing.textAlign = "center";
    drawing.fillText(String(hole), centerX, centerY + 2);
    if (!compact || isCenter) {
      drawing.fillStyle = "rgba(240, 189, 105, 0.78)";
      drawing.fillText(pair.blowName, centerX, combTop + 10);
      drawing.fillStyle = "rgba(105, 213, 221, 0.78)";
      drawing.fillText(pair.drawName, centerX, combBottom - 5);
    }
    holeRegions.push({ type: "play-hole", hole, direction: 1, left, right, top, bottom: centerY });
    holeRegions.push({ type: "play-hole", hole, direction: -1, left, right, top: centerY, bottom });
  }

  const firstCovered = Math.min(...covered);
  const lastCovered = Math.max(...covered);
  const lipWindowLeft = combLeft + (firstCovered - 1) * holeWidth;
  const lipWindowRight = combLeft + lastCovered * holeWidth;
  drawing.fillStyle = "rgba(227, 106, 93, 0.08)";
  drawing.fillRect(lipWindowLeft, combTop - 12, lipWindowRight - lipWindowLeft, combBottom - combTop + 24);
  drawing.strokeStyle = "rgba(227, 106, 93, 0.72)";
  drawing.strokeRect(lipWindowLeft, combTop - 12, lipWindowRight - lipWindowLeft, combBottom - combTop + 24);

  const selectedPair = harmonicaReedPair(state, state.hole);
  drawing.fillStyle = "rgba(5, 7, 7, 0.9)";
  drawing.fillRect(chamber.left, chamber.top, chamber.right - chamber.left, chamber.bottom - chamber.top);
  drawing.strokeStyle = "rgba(216, 223, 220, 0.34)";
  drawing.strokeRect(chamber.left, chamber.top, chamber.right - chamber.left, chamber.bottom - chamber.top);
  drawing.beginPath();
  drawing.moveTo(model.holeCenter - holeWidth * 0.45, combTop);
  drawing.lineTo(chamber.left, chamber.bottom);
  drawing.moveTo(model.holeCenter + holeWidth * 0.45, combTop);
  drawing.lineTo(chamber.right, chamber.bottom);
  strokePath("#d8dfdc", 0.7, 0.25);
  drawing.fillStyle = "rgba(216, 223, 220, 0.62)";
  drawing.font = "650 6px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "center";
  drawing.fillText(
    compact
      ? `CH ${state.hole} · ${selectedPair.blowName.replace(/\d+$/, "")} / ${selectedPair.drawName.replace(/\d+$/, "")}`
      : `CHAMBER ${state.hole} · ${selectedPair.blowName} / ${selectedPair.drawName}`,
    (chamber.left + chamber.right) * 0.5,
    chamber.top - 7,
  );
  drawing.beginPath();
  drawing.moveTo(chamber.left + 12, chamber.top + 18);
  const primaryChamberMotion = clamp(telemetry.displacement, -1, 1) * 7;
  const pairedChamberMotion = primaryChamberMotion * pairedMotionScale;
  drawing.lineTo(chamber.right - 12, chamber.top + 18 + (blowReedSpeaking ? primaryChamberMotion : pairedChamberMotion));
  strokePath(blowReedSpeaking ? (overbendSpeaking ? "#a99bef" : "#f0bd69") : "#9da5a1", 2, blowReedSpeaking ? 0.94 : 0.42);
  drawing.beginPath();
  drawing.moveTo(chamber.left + 12, chamber.bottom - 17);
  drawing.lineTo(chamber.right - 12, chamber.bottom - 17 + (drawReedSpeaking ? primaryChamberMotion : pairedChamberMotion));
  strokePath(drawReedSpeaking ? (overbendSpeaking ? "#a99bef" : "#69d5dd") : "#9da5a1", 2, drawReedSpeaking ? 0.94 : 0.42);
}

function drawBreathFlow(model) {
  const flow = visualBreathFlow;
  const amount = Math.sqrt(clamp(Math.abs(flow) / 3));
  if (amount < 0.02) return;
  const blowing = flow > 0;
  const startX = model.combLeft - 24;
  const endX = model.throatX - 3;
  const direction = blowing ? -1 : 1;
  const color = blowing ? "#f0bd69" : "#69d5dd";
  const rateMotion = logarithmicUnit(state.breathRateBpm, HARMONICA_LIMITS.breathRateBpm);
  const time = prefersReducedMotion
    ? 0.42
    : performance.now() * (0.0006 + amount * 0.0015 + rateMotion * 0.003);
  drawing.save();
  drawing.lineCap = "round";
  for (let index = 0; index < 10; index += 1) {
    const travel = (time + index / 10) % 1;
    const position = blowing ? 1 - travel : travel;
    const x = startX + (endX - startX) * position;
    const y = model.combY + Math.sin(index * 1.9 + time * Math.PI * 2) * (3 + amount * 5);
    const length = 6 + amount * 10;
    drawing.beginPath();
    drawing.moveTo(x - direction * length * 0.5, y);
    drawing.lineTo(x + direction * length * 0.5, y);
    drawing.lineTo(x + direction * (length * 0.5 - 4), y - 3);
    drawing.moveTo(x + direction * length * 0.5, y);
    drawing.lineTo(x + direction * (length * 0.5 - 4), y + 3);
    strokePath(color, 1, 0.14 + amount * 0.5);
  }
  drawing.restore();
}

function drawPitchMap(model) {
  if (model.compact) return;
  const top = cssHeight - 92;
  const bottom = cssHeight - 48;
  const minimumMidi = harmonicaReedPair(state, 1).blowMidi;
  const maximumMidi = harmonicaReedPair(state, 10).blowMidi;
  drawing.fillStyle = "rgba(216, 223, 220, 0.5)";
  drawing.font = "6px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText("RICHTER MAP · BLOW ABOVE / DRAW BELOW", model.combLeft, top - 12);
  for (let hole = 1; hole <= 10; hole += 1) {
    const pair = harmonicaReedPair(state, hole);
    const x = model.combLeft + (hole - 0.5) * model.holeWidth;
    const blowY = bottom - (pair.blowMidi - minimumMidi) / Math.max(1, maximumMidi - minimumMidi) * (bottom - top);
    const drawY = bottom - (pair.drawMidi - minimumMidi) / Math.max(1, maximumMidi - minimumMidi) * (bottom - top);
    drawing.beginPath();
    drawing.arc(x, blowY, hole === state.hole ? 2.6 : 1.6, 0, Math.PI * 2);
    drawing.fillStyle = "#f0bd69";
    drawing.globalAlpha = hole === state.hole ? 0.95 : 0.4;
    drawing.fill();
    drawing.beginPath();
    drawing.arc(x, drawY, hole === state.hole ? 2.6 : 1.6, 0, Math.PI * 2);
    drawing.fillStyle = "#69d5dd";
    drawing.fill();
  }
  drawing.globalAlpha = 1;
}

function drawStage() {
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  drawing.fillStyle = "#050707";
  drawing.fillRect(0, 0, cssWidth, cssHeight);
  drawing.strokeStyle = "rgba(216, 223, 220, 0.022)";
  drawing.lineWidth = 1;
  for (let x = 0; x < cssWidth; x += 34) {
    drawing.beginPath(); drawing.moveTo(x, 0); drawing.lineTo(x, cssHeight); drawing.stroke();
  }
  for (let y = 0; y < cssHeight; y += 34) {
    drawing.beginPath(); drawing.moveTo(0, y); drawing.lineTo(cssWidth, y); drawing.stroke();
  }
  const model = layout();
  const technique = harmonicaTechnique(state.bluesTechniqueId);
  handles = [];
  drawParameterPad(
    model.airPad,
    "#69d5dd",
    model.compact ? "AIR" : `AIR ${Math.round(state.breathRateBpm)}/MIN · ${Math.round(state.breathPressure * 100)}%`,
    "RATE",
    "PRESS",
  );
  drawParameterPad(
    model.rhythmPad,
    "#f0bd69",
    model.compact ? "BLUES" : `${technique.label.toUpperCase()} · ${state.techniqueRateHz.toFixed(1)} HZ · ${Math.round(state.techniqueAmount * 100)}%`,
    "RATE",
    "AMOUNT",
  );
  drawParameterPad(
    model.cupPad,
    "#a99bef",
    model.compact ? "CUP" : `CUP FILTER ${Math.round(state.handCup * 100)}% · GROWL ${Math.round(state.growl * 100)}%`,
    "FILTER",
    "GROWL",
  );
  drawMouth(model);
  drawHarmonica(model);
  drawBluesCup(model);
  drawParameterPad(
    model.bendPad,
    "#e36a5d",
    model.compact ? "BEND" : `BEND ${Math.round(state.bend * 100)}% · GAP ${Math.round(state.reedGap * 100)}%`,
    "BEND",
    "GAP",
  );
  drawBreathFlow(model);
  drawPitchMap(model);
  drawNode(model.airPad.x, model.airPad.y, "#69d5dd", "AIR", "air", 8);
  drawNode(model.rhythmPad.x, model.rhythmPad.y, "#f0bd69", model.compact ? "BLUES" : "TECHNIQUE", "rhythm", 8);
  drawNode(model.cupPad.x, model.cupPad.y, "#a99bef", model.compact ? "CUP" : "CUP / GROWL", "cup", 7);
  drawNode(model.bendPad.x, model.bendPad.y, "#e36a5d", model.compact ? "BEND" : "BEND / GAP", "bend", 7);
  drawNode(model.embouchureX, model.embouchureY, "#e36a5d", canvasMouthApertureLabel(model.compact), "embouchure", 7);
  drawNode(model.tonguePad.x, model.tonguePad.y, "#a99bef", model.compact ? "TNG" : "TONGUE", "tongue", 7);
  drawNode(model.lipsX, model.lipsY, "#e36a5d", model.compact ? "LIP" : "LIPS", "lips", 7);
  drawNode(model.tractPad.x, model.tractPad.y, "#69d5dd", model.compact ? "TRCT" : "TRACT", "tract", 7);
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function nearestHandle(point) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const handle of handles) {
    const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (distance <= handle.radius && distance < nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function playableRegionAt(point) {
  const exact = holeRegions.find((region) => (
    point.x >= region.left
    && point.x <= region.right
    && point.y >= region.top
    && point.y <= region.bottom
  ));
  if (exact) return exact;
  const model = layout();
  if (
    point.x < model.combLeft
    || point.x > model.combRight
    || point.y < model.combTop + 12
    || point.y > model.combBottom - 12
  ) return null;
  return {
    type: "play-hole",
    hole: Math.round(clamp(
      Math.floor((point.x - model.combLeft) / Math.max(1, model.holeWidth)) + 1,
      1,
      10,
    )),
    direction: point.y < model.combY ? 1 : -1,
  };
}

function setFromPointer(type, point, drag) {
  const model = layout();
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  let patch = null;
  if (type === "air") {
    const width = Math.max(1, model.airPad.right - model.airPad.left);
    const height = Math.max(1, model.airPad.bottom - model.airPad.top);
    patch = {
      breathRateBpm: logarithmicValue(
        logarithmicUnit(drag.startValues.breathRateBpm, HARMONICA_LIMITS.breathRateBpm) + dx / width,
        HARMONICA_LIMITS.breathRateBpm,
      ),
      breathPressure: rangeValue(
        rangeUnit(drag.startValues.breathPressure, HARMONICA_LIMITS.breathPressure) - dy / height,
        HARMONICA_LIMITS.breathPressure,
      ),
    };
  } else if (type === "rhythm") {
    const width = Math.max(1, model.rhythmPad.right - model.rhythmPad.left);
    const height = Math.max(1, model.rhythmPad.bottom - model.rhythmPad.top);
    patch = {
      techniqueRateHz: logarithmicValue(
        logarithmicUnit(drag.startValues.techniqueRateHz, HARMONICA_LIMITS.techniqueRateHz) + dx / width,
        HARMONICA_LIMITS.techniqueRateHz,
      ),
      techniqueAmount: rangeValue(
        rangeUnit(drag.startValues.techniqueAmount, HARMONICA_LIMITS.techniqueAmount) - dy / height,
        HARMONICA_LIMITS.techniqueAmount,
      ),
    };
  } else if (type === "cup") {
    const width = Math.max(1, model.cupPad.right - model.cupPad.left);
    const height = Math.max(1, model.cupPad.bottom - model.cupPad.top);
    patch = {
      handCup: rangeValue(
        rangeUnit(drag.startValues.handCup, HARMONICA_LIMITS.handCup) + dx / width,
        HARMONICA_LIMITS.handCup,
      ),
      growl: rangeValue(
        rangeUnit(drag.startValues.growl, HARMONICA_LIMITS.growl) - dy / height,
        HARMONICA_LIMITS.growl,
      ),
    };
  } else if (type === "bend") {
    const width = Math.max(1, model.bendPad.right - model.bendPad.left);
    const height = Math.max(1, model.bendPad.bottom - model.bendPad.top);
    patch = {
      bend: rangeValue(
        rangeUnit(drag.startValues.bend, HARMONICA_LIMITS.bend) + dx / width,
        HARMONICA_LIMITS.bend,
      ),
      reedGap: rangeValue(
        rangeUnit(drag.startValues.reedGap, HARMONICA_LIMITS.reedGap) - dy / height,
        HARMONICA_LIMITS.reedGap,
      ),
    };
  } else if (type === "embouchure") {
    patch = {
      hole: drag.startValues.hole + dx / Math.max(1, model.holeWidth),
      chordWidth: drag.startValues.chordWidth - dy / Math.max(16, model.combHeight * 0.22),
    };
  } else if (type === "tongue") {
    const width = Math.max(42, model.tonguePad.right - model.tonguePad.left);
    const height = Math.max(42, model.tonguePad.bottom - model.tonguePad.top);
    patch = {
      tonguePosition: drag.startValues.tonguePosition
        + dx / width * (HARMONICA_LIMITS.tonguePosition[1] - HARMONICA_LIMITS.tonguePosition[0]),
      tongueHeight: drag.startValues.tongueHeight
        - dy / height * (HARMONICA_LIMITS.tongueHeight[1] - HARMONICA_LIMITS.tongueHeight[0]),
    };
  } else if (type === "tract") {
    const width = Math.max(30, model.tractPad.right - model.tractPad.left);
    const height = Math.max(42, model.tractPad.bottom - model.tractPad.top);
    patch = {
      throatOpening: drag.startValues.throatOpening
        + dx / width * (HARMONICA_LIMITS.throatOpening[1] - HARMONICA_LIMITS.throatOpening[0]),
      vocalTractCoupling: drag.startValues.vocalTractCoupling
        - dy / height * (HARMONICA_LIMITS.vocalTractCoupling[1] - HARMONICA_LIMITS.vocalTractCoupling[0]),
    };
  } else if (type === "lips") {
    patch = {
      embouchure: drag.startValues.embouchure
        + dx / Math.max(50, cssWidth * 0.09)
          * (HARMONICA_LIMITS.embouchure[1] - HARMONICA_LIMITS.embouchure[0]),
    };
  }
  if (!patch) return;
  state = sanitizeHarmonicaState({ ...state, ...patch }, state);
  updatePresentation();
  postConfiguration();
  if ("breathPressure" in patch && manualBreathDirection) {
    sendManualBreath(manualBreathDirection * state.breathPressure);
  }
}

function clearPointerInteraction() {
  if (!pointerDrag) return null;
  const drag = pointerDrag;
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture?.(drag.pointerId);
  return drag;
}

function installCanvasInteractions() {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (pointerDrag) return;
    const point = canvasPoint(event);
    const handle = nearestHandle(point);
    const playable = handle ? null : playableRegionAt(point);
    if (!handle && !playable) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    const owner = playable
      ? { type: "canvas-hole", pointerId: event.pointerId }
      : null;
    pointerDrag = {
      type: handle?.type ?? "play-hole",
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      owner,
      direction: playable?.direction ?? 0,
      hole: playable?.hole ?? state.hole,
      startValues: {
        hole: state.hole,
        chordWidth: state.chordWidth,
        embouchure: state.embouchure,
        breathPressure: state.breathPressure,
        breathRateBpm: state.breathRateBpm,
        bend: state.bend,
        reedGap: state.reedGap,
        tonguePosition: state.tonguePosition,
        tongueHeight: state.tongueHeight,
        throatOpening: state.throatOpening,
        vocalTractCoupling: state.vocalTractCoupling,
        techniqueRateHz: state.techniqueRateHz,
        techniqueAmount: state.techniqueAmount,
        handCup: state.handCup,
        growl: state.growl,
      },
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    if (playable) {
      selectHole(playable.hole);
      void beginManualBreath(playable.direction, owner);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = canvasPoint(event);
    if (pointerDrag.type !== "play-hole") {
      setFromPointer(pointerDrag.type, point, pointerDrag);
      return;
    }
    const playable = playableRegionAt(point);
    if (!playable) return;
    if (playable.hole !== pointerDrag.hole) {
      pointerDrag.hole = playable.hole;
      selectHole(playable.hole);
    }
    if (playable.direction !== pointerDrag.direction) {
      pointerDrag.direction = playable.direction;
      changeManualBreath(playable.direction, pointerDrag.owner);
    }
  });

  const releasePointer = (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const drag = clearPointerInteraction();
    if (drag?.type === "play-hole") endManualBreath(drag.direction, drag.owner);
  };
  const cancelPointer = (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const drag = clearPointerInteraction();
    if (drag?.type === "play-hole") endManualBreath(drag.direction, drag.owner);
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", cancelPointer);
  canvas.addEventListener("lostpointercapture", cancelPointer);
}

function loadVowel(vowelId) {
  const vowel = VOWEL_SHAPES[vowelId];
  if (!vowel) return;
  state = sanitizeHarmonicaState({ ...state, ...vowel }, state);
  updatePresentation();
  postConfiguration();
  announce(`${vowelId.toUpperCase()} mouth posture loaded`);
}

function installKeyboard() {
  const drawOwner = { type: "keyboard", key: "[" };
  const blowOwner = { type: "keyboard", key: "]" };
  const spaceOwner = { type: "keyboard", key: " " };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearPointerInteraction();
      cancelManualBreath({ present: false });
      state = sanitizeHarmonicaState({ ...state, autoBreath: false }, state);
      commandedBreathFlow = 0;
      visualBreathFlow = 0;
      lastBreathTelemetryAt = -Infinity;
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      midiBreath = null;
      postConfiguration();
      updatePresentation();
      announce("Harmonica stopped");
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.matches?.("input, select, textarea, button, [role='slider']")) return;
    const key = event.key.toLowerCase();
    if (/^[1-9]$/.test(event.key) && !event.repeat) {
      event.preventDefault();
      selectHole(Number(event.key), { announceChange: true });
    } else if (event.key === "0" && !event.repeat) {
      event.preventDefault();
      selectHole(10, { announceChange: true });
    } else if (["ArrowLeft", "ArrowDown"].includes(event.key) && event.target === canvas) {
      event.preventDefault();
      selectHole(state.hole - 1, { announceChange: true });
    } else if (["ArrowRight", "ArrowUp"].includes(event.key) && event.target === canvas) {
      event.preventDefault();
      selectHole(state.hole + 1, { announceChange: true });
    } else if (event.key === "-") {
      event.preventDefault();
      setControl("chordWidth", state.chordWidth - 1, { announceChange: true });
    } else if (["=", "+"].includes(event.key)) {
      event.preventDefault();
      setControl("chordWidth", state.chordWidth + 1, { announceChange: true });
    } else if ("aeiou".includes(key) && !event.repeat) {
      event.preventDefault();
      loadVowel(key);
    } else if (key === "r" && !event.repeat) {
      event.preventDefault();
      void toggleBreathCycle();
    } else if (key === "b" && !event.repeat) {
      event.preventDefault();
      const index = HARMONICA_TECHNIQUES.findIndex(({ id }) => id === state.bluesTechniqueId);
      loadBluesTechnique(HARMONICA_TECHNIQUES[(index + 1) % HARMONICA_TECHNIQUES.length].id);
    } else if (key === "n" && !event.repeat) {
      event.preventDefault();
      const index = HARMONICA_BLUES_RHYTHMS.findIndex(({ id }) => id === state.bluesRhythmId);
      setBluesRhythm(HARMONICA_BLUES_RHYTHMS[(index + 1) % HARMONICA_BLUES_RHYTHMS.length].id);
    } else if (event.key === "[" && !event.repeat) {
      event.preventDefault();
      void beginManualBreath(-1, drawOwner);
    } else if (event.key === "]" && !event.repeat) {
      event.preventDefault();
      void beginManualBreath(1, blowOwner);
    } else if (event.key === " " && event.target === canvas && !event.repeat) {
      event.preventDefault();
      void beginManualBreath(1, spaceOwner);
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "[") endManualBreath(-1, drawOwner);
    if (event.key === "]") endManualBreath(1, blowOwner);
    if (event.key === " ") endManualBreath(1, spaceOwner);
  });
}

let midiBreath = null;

function nearestReedForMidi(note) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (let hole = 1; hole <= 10; hole += 1) {
    const pair = harmonicaReedPair(state, hole);
    for (const candidate of [
      { hole, direction: 1, midi: pair.blowMidi },
      { hole, direction: -1, midi: pair.drawMidi },
    ]) {
      const distance = Math.abs(candidate.midi - note);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
  }
  return nearest;
}

function handleMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (!message || (routeId && routeId !== "harmonica")) return;
  if (message.type === "pitchBend") {
    event.preventDefault();
    const normalized = clamp(Number(message.normalized) || 0, -1, 1);
    state = sanitizeHarmonicaState({
      ...state,
      bend: Math.max(0, -normalized) * HARMONICA_LIMITS.bend[1],
      overbend: Math.max(0, normalized) * HARMONICA_LIMITS.overbend[1],
    }, state);
    updatePresentation();
    postConfiguration();
    return;
  }
  if (message.type === "programChange") {
    event.preventDefault();
    const program = Math.round(clamp(Number(message.program) || 0, 0, 127));
    loadBluesTechnique(HARMONICA_TECHNIQUES[program % HARMONICA_TECHNIQUES.length].id);
    return;
  }
  if (message.type === "controlChange") {
    const controller = Number(message.controller);
    if ([120, 123].includes(controller)) {
      event.preventDefault();
      midiBreath = null;
      cancelManualBreath();
      return;
    }
    if (![1, 2, 11, 12, 13, 71, 74].includes(controller)) return;
    event.preventDefault();
    const unit = clamp((Number(message.value) || 0) / 127);
    if (controller === 1) setControl("vibratoDepth", rangeValue(unit, HARMONICA_LIMITS.vibratoDepth));
    else if ([2, 11].includes(controller)) setControl("breathPressure", rangeValue(unit, HARMONICA_LIMITS.breathPressure));
    else if (controller === 12) setControl("techniqueAmount", rangeValue(unit, HARMONICA_LIMITS.techniqueAmount));
    else if (controller === 13) setControl("techniqueRateHz", logarithmicValue(unit, HARMONICA_LIMITS.techniqueRateHz));
    else if (controller === 71) setControl("growl", rangeValue(unit, HARMONICA_LIMITS.growl));
    else if (controller === 74) setControl("handCup", rangeValue(unit, HARMONICA_LIMITS.handCup));
    return;
  }
  const isNoteOn = message.type === "noteOn" && Number(message.velocity) > 0;
  const isNoteOff = message.type === "noteOff"
    || (message.type === "noteOn" && Number(message.velocity) <= 0);
  if (!isNoteOn && !isNoteOff) return;
  event.preventDefault();
  const note = Math.round(clamp(Number(message.note) || 60, 0, 127));
  const owner = `midi:${message.sourceId ?? "default"}:${Number(message.channel) || 0}:${note}`;
  if (isNoteOn) {
    const reed = nearestReedForMidi(note);
    if (!reed) return;
    if (midiBreath && midiBreath.owner !== owner) cancelManualBreath({ present: false });
    midiBreath = { owner, note, direction: reed.direction };
    const velocity = clamp((Number(message.velocity) || 1) / 127, 0.01, 1);
    state = sanitizeHarmonicaState({
      ...state,
      hole: reed.hole,
      breathPressure: rangeValue(Math.pow(velocity, 0.72), [0.06, 2.7]),
      breathDirection: reed.direction,
    }, state);
    updatePresentation();
    postConfiguration();
    void beginManualBreath(reed.direction, owner);
    return;
  }
  if (!midiBreath || midiBreath.owner !== owner) return;
  endManualBreath(midiBreath.direction, owner);
  midiBreath = null;
}

function updateLiveReadouts(flow) {
  const pair = harmonicaReedPair(state, state.hole);
  if (Math.abs(flow) <= 0.025) {
    $("noteReadout").textContent = `rest · ${pair.blowName} / ${pair.drawName}`;
  } else {
    const direction = Math.sign(flow);
    const reed = harmonicaReedFrequency(state, state.hole, direction);
    const telemetryMatches = graph
      && audioContext?.state === "running"
      && performance.now() - lastBreathTelemetryAt < 250
      && telemetry.direction === direction
      && telemetry.activeFrequencyHz > 0;
    const frequency = telemetryMatches ? telemetry.activeFrequencyHz : reed.frequencyHz;
    const availableBend = bendRangeSemitones(state.hole, direction);
    const overbendTarget = harmonicaOverbendTarget(state, state.hole, direction);
    const overbendSpeaking = telemetryMatches
      && telemetry.overbendActive
      && overbendTarget.legal;
    const effectiveBend = telemetryMatches && Number.isFinite(telemetry.bendSemitones)
      ? telemetry.bendSemitones
      : reed.bendSemitones;
    $("noteReadout").textContent = overbendSpeaking
      ? `${direction < 0 ? "overdraw" : "overblow"} ${overbendTarget.noteName} · ${formatFrequency(frequency)}`
      : state.chordWidth > 1
      ? `${state.chordWidth}-hole ${direction < 0 ? "draw" : "blow"} chord · ${formatFrequency(frequency)} centroid`
      : `${direction < 0 ? "draw" : "blow"} ${reed.noteName} · ${formatFrequency(frequency)}`;
    $("bendReadout").textContent = state.overbend > 0.01 && overbendTarget.legal
      ? `${overbendSpeaking ? "speaking" : "armed"} ${direction < 0 ? "overdraw" : "overblow"} ${overbendTarget.noteName} · ${Math.round(state.overbend * 100)}% choke`
      : availableBend > 0
        ? `${effectiveBend.toFixed(2)} semitones · ${direction < 0 ? "draw" : "blow"}`
        : `no ${direction < 0 ? "draw" : "blow"} bend on hole ${state.hole}`;
  }
  updateHoleButtons(flow);
  updateBreathPresentation(flow);
}

function tick(time) {
  const shouldPresentBreath = Boolean(manualBreathDirection)
    || (state.autoBreath && audioDesiredOn && audioPresentationStatus === "on");
  commandedBreathFlow = shouldPresentBreath ? breathFlowAt(time) : 0;
  const displayedFlow = breathFlowForDisplay(time);
  const response = prefersReducedMotion
    ? 1
    : 0.14 + logarithmicUnit(state.breathRateBpm, HARMONICA_LIMITS.breathRateBpm) * 0.56;
  visualBreathFlow += (displayedFlow - visualBreathFlow) * response;
  if (Math.abs(visualBreathFlow) < 1e-5 && Math.abs(displayedFlow) < 1e-5) visualBreathFlow = 0;
  if (time - lastLiveReadoutAt >= 80) {
    lastLiveReadoutAt = time;
    updateLiveReadouts(displayedFlow);
  }
  drawStage();
  animationFrame = requestAnimationFrame(tick);
}

function cancelTransientPerformance() {
  const drag = clearPointerInteraction();
  if (drag?.type === "play-hole") endManualBreath(drag.direction, drag.owner);
  else cancelManualBreath();
  midiBreath = null;
}

buildPresetOptions();
buildBluesControls();
installControls();
installCanvasInteractions();
installKeyboard();
updatePresentation();
resizeCanvas();
globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
globalThis.addEventListener("resize", resizeCanvas);
globalThis.addEventListener("blur", cancelTransientPerformance);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelTransientPerformance();
});
globalThis.ResizeObserver && new ResizeObserver(resizeCanvas).observe(stageWrap);
animationFrame = requestAnimationFrame(tick);

globalThis.addEventListener("pagehide", () => {
  pageIsActive = false;
  pageLifecycleGeneration += 1;
  requestAudioState(false);
  cancelTransientPerformance();
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  const closingGraph = graph;
  const closingContext = audioContext;
  graph = null;
  audioContext = null;
  audioStartupPromise = null;
  closingGraph?.sourceNode?.port.postMessage({ type: "silence" });
  if (closingGraph?.sourceNode?.port) closingGraph.sourceNode.port.onmessage = null;
  closingGraph?.releaseOutput?.();
  void closingContext?.close?.();
});

globalThis.addEventListener("pageshow", () => {
  if (pageIsActive) return;
  pageIsActive = true;
  manualBreathDirection = 0;
  manualBreathOwner = null;
  commandedBreathFlow = 0;
  visualBreathFlow = 0;
  lastBreathTelemetryAt = -Infinity;
  telemetry = {
    ...telemetry,
    breathFlow: 0,
    displacement: 0,
    energy: 0,
    activeFrequencyHz: 0,
    peak: 0,
    rms: 0,
  };
  setAudioPresentation("off");
  updatePresentation();
  resizeCanvas();
  animationFrame = requestAnimationFrame(tick);
});
