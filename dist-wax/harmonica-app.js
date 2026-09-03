import {
  HARMONICA_BLUES_RHYTHMS,
  HARMONICA_DEFAULTS,
  HARMONICA_HOLE_COUNT,
  HARMONICA_KEYS,
  HARMONICA_LIMITS,
  HARMONICA_PERFORMANCE_CUSTOM_ID,
  HARMONICA_PERFORMANCE_PRESETS,
  HARMONICA_PRESETS,
  HARMONICA_TECHNIQUES,
  activeHoles,
  applyHarmonicaPerformancePreset,
  applyHarmonicaTechnique,
  bendRangeSemitones,
  clamp,
  harmonicaActiveReeds,
  harmonicaBluesRhythm,
  harmonicaBluesRhythmFlow,
  harmonicaBreathCycleFlow,
  harmonicaKey,
  harmonicaMaterialProperties,
  harmonicaMouthFormants,
  harmonicaOverbendTarget,
  harmonicaPerformancePreset,
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
  { key: "breathShiftSlop", format: (value) => (
    value < 0.16 ? "pristine" : value > 0.78 ? "sloppy" : `${Math.round(value * 100)}% overlap`
  ) },
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
  { key: "cupMotionDepth", format: formatPercent },
  { key: "growl", format: formatPercent },
  { key: "tongueBlock", format: formatPercent },
  { key: "tongueMotionDepth", format: formatPercent },
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
let aperturePointerDrag = null;

const renderedHoleCount = Math.max(
  1,
  Math.min(HARMONICA_HOLE_COUNT, $("holeButtons")?.querySelectorAll("[data-hole]").length ?? HARMONICA_HOLE_COUNT),
);
$("holeButtons")?.style.setProperty("--harmonica-hole-count", String(renderedHoleCount));

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

function mouthApertureRange(source = state) {
  const holes = activeHoles(source);
  return {
    first: Math.min(...holes),
    last: Math.max(...holes),
    width: holes.length,
  };
}

function aperturePatch(first, last) {
  const maximumWidth = Math.min(5, HARMONICA_LIMITS.chordWidth[1]);
  const requestedWidth = Math.round(last) - Math.round(first) + 1;
  const width = Math.round(clamp(requestedWidth, 1, maximumWidth));
  const clampedFirst = Math.round(clamp(first, 1, renderedHoleCount - width + 1));
  const clampedLast = clampedFirst + width - 1;
  // A side tongue block exposes the right-most chamber. A pucker uses the
  // same slightly right-heavy centering convention as activeHoles().
  const hole = state.tongueBlock > 0.01
    ? clampedLast
    : clampedFirst + Math.floor((width - 1) / 2);
  return { hole, chordWidth: width };
}

function apertureDescription(source = state) {
  const holes = activeHoles(source);
  return `${formatMouthAperture(holes.length)}; covering holes ${holes.join(", ")}`;
}

function setApertureRange(first, last, { announceChange = false } = {}) {
  state = sanitizeHarmonicaState({
    ...state,
    ...aperturePatch(first, last),
    performancePresetId: HARMONICA_PERFORMANCE_CUSTOM_ID,
  }, state);
  updatePresentation();
  postConfiguration();
  if (announceChange) announce(`Mouth aperture ${apertureDescription()}`);
}

function updateHoleWindow() {
  const window = $("holeWindow");
  if (!window) return;
  const { first, last, width } = mouthApertureRange();
  window.style.left = `${((first - 1) / renderedHoleCount) * 100}%`;
  window.style.width = `${(width / renderedHoleCount) * 100}%`;
  window.dataset.firstHole = String(first);
  window.dataset.lastHole = String(last);
  window.title = `Mouth covers holes ${first}${last === first ? "" : `–${last}`}; pull either handle`;
  $("holeWindowLeft")?.setAttribute(
    "aria-label",
    `Left edge of mouth aperture at hole ${first}; use left and right arrow keys to resize`,
  );
  $("holeWindowRight")?.setAttribute(
    "aria-label",
    `Right edge of mouth aperture at hole ${last}; use left and right arrow keys to resize`,
  );
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
  const resetAt = performance.now();
  breathCycleStartedAt = resetAt
    - ((phase % 1 + 1) % 1) * (60_000 / state.breathRateBpm);
  graph?.sourceNode?.port.postMessage({ type: "breath-cycle-reset", phase });
}

function breathCyclePhaseAt(time = performance.now(), sourceState = state) {
  const elapsed = Math.max(0, time - breathCycleStartedAt);
  return (elapsed / (60_000 / sourceState.breathRateBpm)) % 1;
}

function retainBreathCyclePhase(phase, time = performance.now()) {
  const wrapped = ((phase % 1) + 1) % 1;
  breathCycleStartedAt = time - wrapped * (60_000 / state.breathRateBpm);
}

function breathFlowAt(time = performance.now()) {
  if (manualBreathDirection) return manualBreathDirection * state.breathPressure;
  if (!state.autoBreath) return 0;
  const phase = breathCyclePhaseAt(time);
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
    ? `Space · ${rhythm.label} ↔ ${Math.round(state.breathRateBpm)}/min`
    : "Space · draw ↔ blow · off";
  const meters = [...$("breathMeter").querySelectorAll("i")];
  const amount = clamp(Math.abs(flow) / 3);
  const half = flow < 0 ? 0 : 4;
  const active = amount < 0.008 ? -1 : half + Math.min(3, Math.floor(amount * 4));
  meters.forEach((meter, index) => meter.classList.toggle("is-current", index === active));
  updateBreathScore(rhythm);
}

function updateBreathScore(rhythm = harmonicaBluesRhythm(state.bluesRhythmId)) {
  const score = $("breathScore");
  if (!score) return;
  const steps = rhythm.steps.length > 0 ? rhythm.steps : [-1, 1];
  const signature = `${rhythm.id}:${steps.join(",")}`;
  if (score.dataset.signature !== signature) {
    score.dataset.signature = signature;
    score.replaceChildren(...steps.map((velocity, index) => {
      const cell = document.createElement("span");
      cell.className = velocity < 0
        ? "is-draw"
        : velocity > 0 ? "is-blow" : "is-rest";
      cell.dataset.step = String(index);
      cell.textContent = velocity < 0 ? "↓" : velocity > 0 ? "↑" : "·";
      cell.title = velocity < 0
        ? `Step ${index + 1}: draw ${Math.round(Math.abs(velocity) * 100)}%`
        : velocity > 0
          ? `Step ${index + 1}: blow ${Math.round(velocity * 100)}%`
          : `Step ${index + 1}: breath rest`;
      return cell;
    }));
  }
  let activeStep = -1;
  if (state.autoBreath && !manualBreathDirection) {
    const phase = breathCyclePhaseAt();
    const baseDuration = 1 / steps.length;
    let start = 0;
    for (let index = 0; index < steps.length; index += 1) {
      const duration = baseDuration
        * (1 + (index % 2 === 0 ? state.rhythmSwing : -state.rhythmSwing));
      if (phase < start + duration || index === steps.length - 1) {
        activeStep = index;
        break;
      }
      start += duration;
    }
  }
  for (const cell of score.children) {
    cell.classList.toggle("is-current", Number(cell.dataset.step) === activeStep);
  }
  score.setAttribute(
    "aria-label",
    `${rhythm.label}: ${steps.map((velocity) => (
      velocity < 0 ? "draw" : velocity > 0 ? "blow" : "rest"
    )).join(", ")}`,
  );
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
      "The Harmonicazoid physical model stopped unexpectedly. Reload the page to reset it.",
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
            setAudioPresentation("error", error?.message || "Unable to start Harmonicazoid audio.");
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
    const tongueBlocked = covered.has(hole)
      && hole !== state.hole
      && state.tongueBlock > 0.01
      && technique.id !== "octave-tongue-block";
    const transmitted = !tongueBlocked || state.tongueBlock < 0.94;
    button.classList.toggle("is-tongue-blocked", tongueBlocked);
    button.classList.toggle("is-sounding-draw", covered.has(hole) && transmitted && flow < -0.025);
    button.classList.toggle("is-sounding-blow", covered.has(hole) && transmitted && flow > 0.025);
  }
  updateHoleWindow();
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
  $("keySelect").value = state.keyId;
  if ($("performancePresetSelect")) $("performancePresetSelect").value = state.performancePresetId;
  const preset = harmonicaPreset(state.presetId);
  const key = harmonicaKey(state.keyId);
  const technique = harmonicaTechnique(state.bluesTechniqueId);
  const bluesRhythm = harmonicaBluesRhythm(state.bluesRhythmId);
  const performancePreset = state.performancePresetId === HARMONICA_PERFORMANCE_CUSTOM_ID
    ? null
    : harmonicaPerformancePreset(state.performancePresetId);
  const material = harmonicaMaterialProperties(state);
  const pair = harmonicaReedPair(state, state.hole);
  const flow = breathFlowForDisplay();
  const direction = Math.abs(flow) > 0.025 ? Math.sign(flow) : state.breathDirection;
  const reed = harmonicaReedFrequency(state, state.hole, direction);
  const formants = harmonicaMouthFormants(state);
  $("presetDescription").textContent = `${preset.description} Tuned independently to ${key.label}.`;
  if ($("bluesTechniqueSelect")) $("bluesTechniqueSelect").value = technique.id;
  if ($("bluesRhythmSelect")) $("bluesRhythmSelect").value = bluesRhythm.id;
  if ($("techniqueDescription")) $("techniqueDescription").textContent = technique.description;
  if ($("rhythmDescription")) {
    $("rhythmDescription").textContent = `${bluesRhythm.description} Auto alternates draw and blow with this pattern; N cycles rhythms.`;
  }
  if ($("performancePresetDescription")) {
    $("performancePresetDescription").textContent = performancePreset
      ? performancePreset.description
      : "Custom keeps your current hand, tongue, breath, bend, and gesture edits together.";
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
  $("instrumentSummary").textContent = `${key.label} · hole ${state.hole} · ${formatMouthAperture(state.chordWidth)}`;
  $("reedSummary").textContent = `${preset.family} · ${Math.round(state.reedGap * 100)}% gap`;
  $("mouthSummary").textContent = `tongue ${Math.round(state.tonguePosition * 100)} / ${Math.round(state.tongueHeight * 100)} · throat ${Math.round(state.throatOpening * 100)}`;
  $("motionSummary").textContent = `${technique.label} · ${state.techniqueRateHz.toFixed(1)} Hz · ${Math.round(state.techniqueAmount * 100)}%`;
  $("presetDescription").dataset.material = `${Math.round(material.youngsModulusPa / 1e9)} GPa · ${Math.round(material.densityKgM3)} kg/m³`;
  updateHoleButtons(flow);
  updateBreathPresentation(flow);
}

function setControl(key, value, { announceChange = false } = {}) {
  const changedAt = performance.now();
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = sanitizeHarmonicaState({
    ...state,
    [key]: value,
    performancePresetId: key === "level"
      ? state.performancePresetId
      : HARMONICA_PERFORMANCE_CUSTOM_ID,
  }, state);
  if (key === "breathRateBpm") retainBreathCyclePhase(previousPhase, changedAt);
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
    keyId: state.keyId,
    hole: state.hole,
    chordWidth: state.chordWidth,
    breathDirection: state.breathDirection,
    breathPressure: state.breathPressure,
    breathRateBpm: state.breathRateBpm,
    breathShiftSlop: state.breathShiftSlop,
    breathBalance: state.breathBalance,
    autoBreath: state.autoBreath,
    bluesTechniqueId: state.bluesTechniqueId,
    bluesRhythmId: state.bluesRhythmId,
    techniqueAmount: state.techniqueAmount,
    techniqueRateHz: state.techniqueRateHz,
    breathAttackMs: state.breathAttackMs,
    breathReleaseMs: state.breathReleaseMs,
    handCup: state.handCup,
    cupMotionDepth: state.cupMotionDepth,
    growl: state.growl,
    tongueBlock: state.tongueBlock,
    tongueMotionDepth: state.tongueMotionDepth,
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
    performancePresetId: state.performancePresetId,
    level: state.level,
  };
  state = harmonicaState(presetId, retained);
  updatePresentation();
  postConfiguration();
  announce(`${harmonicaPreset(presetId).label} physical body loaded`);
}

function loadKey(keyId) {
  const key = harmonicaKey(keyId);
  state = sanitizeHarmonicaState({ ...state, keyId: key.id }, state);
  updatePresentation();
  postConfiguration();
  announce(`${key.label} Harmonicazoid loaded; reed body retained`);
}

async function randomizeModel() {
  const randomizedAt = performance.now();
  const previousPhase = breathCyclePhaseAt(randomizedAt);
  state = randomizeHarmonicaState(state);
  retainBreathCyclePhase(previousPhase, randomizedAt);
  updatePresentation();
  postConfiguration();
  if (!(await ensureAudio())) return;
  if (manualBreathDirection) sendManualBreath(manualBreathDirection * state.breathPressure);
  announce(`${harmonicaPerformancePreset(state.performancePresetId).label} variation playing · breath, mouth, reeds, and motion randomized`);
}

function buildPresetOptions() {
  $("presetSelect").replaceChildren(...HARMONICA_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  }));
  $("keySelect").replaceChildren(...HARMONICA_KEYS.map((key) => {
    const option = document.createElement("option");
    option.value = key.id;
    option.textContent = key.label;
    return option;
  }));
}

function buildBluesControls() {
  $("performancePresetSelect")?.replaceChildren(
    Object.assign(document.createElement("option"), {
      value: HARMONICA_PERFORMANCE_CUSTOM_ID,
      textContent: "Custom performance",
    }),
    ...HARMONICA_PERFORMANCE_PRESETS.map((performancePreset) => Object.assign(
      document.createElement("option"),
      { value: performancePreset.id, textContent: performancePreset.label },
    )),
  );
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

function loadPerformancePreset(performancePresetId, { announceChange = true } = {}) {
  const performancePreset = harmonicaPerformancePreset(performancePresetId);
  const changedAt = performance.now();
  const previousPhase = breathCyclePhaseAt(changedAt);
  state = applyHarmonicaPerformancePreset(state, performancePreset.id);
  retainBreathCyclePhase(previousPhase, changedAt);
  if (manualBreathDirection) sendManualBreath(manualBreathDirection * state.breathPressure);
  updatePresentation();
  postConfiguration();
  if (announceChange) announce(`${performancePreset.label} performance playing`);
}

function loadBluesTechnique(techniqueId, { announceChange = true } = {}) {
  const technique = harmonicaTechnique(techniqueId);
  state = applyHarmonicaTechnique(state, technique.id);
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
  state = sanitizeHarmonicaState({
    ...state,
    bluesRhythmId: rhythm.id,
    performancePresetId: HARMONICA_PERFORMANCE_CUSTOM_ID,
  }, state);
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

function installApertureWindowInteractions() {
  const rail = $("holeButtons");
  const window = $("holeWindow");
  if (!rail || !window) return;

  const finishDrag = (event, handle) => {
    if (!aperturePointerDrag || aperturePointerDrag.pointerId !== event.pointerId) return;
    aperturePointerDrag = null;
    window.classList.remove("is-dragging");
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture?.(event.pointerId);
    announce(`Mouth aperture ${apertureDescription()}`);
  };

  for (const [edge, handle] of [
    ["left", $("holeWindowLeft")],
    ["right", $("holeWindowRight")],
  ]) {
    if (!handle) continue;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const range = mouthApertureRange();
      aperturePointerDrag = {
        edge,
        pointerId: event.pointerId,
        first: range.first,
        last: range.last,
      };
      handle.setPointerCapture?.(event.pointerId);
      window.classList.add("is-dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!aperturePointerDrag || aperturePointerDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const bounds = rail.getBoundingClientRect();
      const unit = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width));
      const maximumWidth = Math.min(5, HARMONICA_LIMITS.chordWidth[1]);
      if (edge === "left") {
        const boundary = Math.round(unit * renderedHoleCount) + 1;
        const first = clamp(
          boundary,
          Math.max(1, aperturePointerDrag.last - maximumWidth + 1),
          aperturePointerDrag.last,
        );
        setApertureRange(first, aperturePointerDrag.last);
      } else {
        const boundary = Math.round(unit * renderedHoleCount);
        const last = clamp(
          boundary,
          aperturePointerDrag.first,
          Math.min(renderedHoleCount, aperturePointerDrag.first + maximumWidth - 1),
        );
        setApertureRange(aperturePointerDrag.first, last);
      }
    });
    handle.addEventListener("pointerup", (event) => finishDrag(event, handle));
    handle.addEventListener("pointercancel", (event) => finishDrag(event, handle));
    handle.addEventListener("lostpointercapture", (event) => finishDrag(event, handle));
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const range = mouthApertureRange();
      const maximumWidth = Math.min(5, HARMONICA_LIMITS.chordWidth[1]);
      if (edge === "left") {
        const first = clamp(
          range.first + direction,
          Math.max(1, range.last - maximumWidth + 1),
          range.last,
        );
        setApertureRange(first, range.last, { announceChange: true });
      } else {
        const last = clamp(
          range.last + direction,
          range.first,
          Math.min(renderedHoleCount, range.first + maximumWidth - 1),
        );
        setApertureRange(range.first, last, { announceChange: true });
      }
    });
  }
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
  $("keySelect").addEventListener("change", (event) => loadKey(event.currentTarget.value));
  $("performancePresetSelect")?.addEventListener("change", (event) => {
    if (event.currentTarget.value === HARMONICA_PERFORMANCE_CUSTOM_ID) return;
    loadPerformancePreset(event.currentTarget.value);
  });
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
  installApertureWindowInteractions();
  $("resetAll").addEventListener("click", () => {
    cancelManualBreath({ present: false });
    state = harmonicaState(HARMONICA_DEFAULTS.presetId);
    resetBreathCycle();
    updatePresentation();
    postConfiguration();
    if (graph?.masterGain && audioContext) {
      graph.masterGain.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.025);
    }
    announce(`${harmonicaPerformancePreset(state.performancePresetId).label} restored on a C ${harmonicaPreset(state.presetId).label.toLowerCase()} harp`);
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
  const compact = cssHeight < 470 || cssWidth < 700;
  const margin = compact ? 9 : clamp(cssWidth * 0.035, 24, 42);
  const gap = compact ? 7 : 12;
  const stageTop = compact ? 9 : 24;
  const stageBottom = cssHeight - (compact ? 9 : 22);
  const availableHeight = Math.max(190, stageBottom - stageTop);
  const noteHeight = compact
    ? clamp(availableHeight * 0.31, 62, 88)
    : clamp(availableHeight * 0.24, 108, 146);
  const notePanel = {
    left: margin,
    right: cssWidth - margin,
    top: stageTop,
    bottom: stageTop + noteHeight,
  };
  const lowerTop = notePanel.bottom + gap;
  let mouthPanel;
  let bendPanel;
  let cupPanel;
  let breathPanel;
  if (compact) {
    const columnGap = gap;
    const rowGap = gap;
    const middle = margin + (cssWidth - margin * 2 - columnGap) * 0.53;
    const rowHeight = Math.max(52, (stageBottom - lowerTop - rowGap) * 0.5);
    mouthPanel = { left: margin, right: middle, top: lowerTop, bottom: lowerTop + rowHeight };
    bendPanel = { left: middle + columnGap, right: cssWidth - margin, top: lowerTop, bottom: lowerTop + rowHeight };
    cupPanel = { left: margin, right: middle, top: lowerTop + rowHeight + rowGap, bottom: stageBottom };
    breathPanel = { left: middle + columnGap, right: cssWidth - margin, top: lowerTop + rowHeight + rowGap, bottom: stageBottom };
  } else {
    const breathHeight = clamp(availableHeight * 0.17, 76, 102);
    const mainBottom = stageBottom - breathHeight - gap;
    const usableWidth = cssWidth - margin * 2 - gap * 2;
    const mouthWidth = usableWidth * 0.43;
    const bendWidth = usableWidth * 0.24;
    mouthPanel = { left: margin, right: margin + mouthWidth, top: lowerTop, bottom: mainBottom };
    bendPanel = { left: mouthPanel.right + gap, right: mouthPanel.right + gap + bendWidth, top: lowerTop, bottom: mainBottom };
    cupPanel = { left: bendPanel.right + gap, right: cssWidth - margin, top: lowerTop, bottom: mainBottom };
    breathPanel = { left: margin, right: cssWidth - margin, top: mainBottom + gap, bottom: stageBottom };
  }

  const combLeft = notePanel.left + (compact ? 7 : 14);
  const combRight = notePanel.right - (compact ? 7 : 14);
  const combTop = notePanel.top + (compact ? 17 : 27);
  const combBottom = notePanel.bottom - (compact ? 7 : 12);
  const combY = (combTop + combBottom) * 0.5;
  const combHeight = combBottom - combTop;
  const holeWidth = (combRight - combLeft) / renderedHoleCount;
  const holeCenter = combLeft + (state.hole - 0.5) * holeWidth;
  const breathInnerTop = breathPanel.top + (compact ? 26 : 30);
  const breathInnerBottom = breathPanel.bottom - (compact ? 6 : 10);
  const breathInnerWidth = breathPanel.right - breathPanel.left;
  const breathSplit = breathPanel.left + breathInnerWidth * (compact ? 0.48 : 0.5);
  const airPad = {
    left: breathPanel.left + (compact ? 5 : 12),
    right: breathSplit - gap * 0.5,
    top: breathInnerTop,
    bottom: breathInnerBottom,
  };
  airPad.x = airPad.left
    + logarithmicUnit(state.breathRateBpm, HARMONICA_LIMITS.breathRateBpm) * (airPad.right - airPad.left);
  airPad.y = airPad.bottom
    - rangeUnit(state.breathPressure, HARMONICA_LIMITS.breathPressure) * (airPad.bottom - airPad.top);
  const rhythmPad = {
    left: breathSplit + gap * 0.5,
    right: breathPanel.right - (compact ? 5 : 12),
    top: breathInnerTop,
    bottom: breathInnerBottom,
  };
  rhythmPad.x = rhythmPad.left
    + logarithmicUnit(state.techniqueRateHz, HARMONICA_LIMITS.techniqueRateHz)
      * (rhythmPad.right - rhythmPad.left);
  rhythmPad.y = rhythmPad.bottom
    - rangeUnit(state.techniqueAmount, HARMONICA_LIMITS.techniqueAmount)
      * (rhythmPad.bottom - rhythmPad.top);
  const chamber = { ...bendPanel };
  const bendPad = {
    left: bendPanel.left + (compact ? 15 : 28),
    right: bendPanel.right - (compact ? 12 : 26),
    top: bendPanel.top + (compact ? 20 : 34),
    bottom: bendPanel.bottom - (compact ? 11 : 24),
  };
  bendPad.x = bendPad.left + rangeUnit(state.reedGap, HARMONICA_LIMITS.reedGap) * (bendPad.right - bendPad.left);
  bendPad.y = bendPad.bottom - rangeUnit(state.bend, HARMONICA_LIMITS.bend) * (bendPad.bottom - bendPad.top);
  const lipX = mouthPanel.left + (compact ? 7 : 15);
  const throatX = mouthPanel.right - (compact ? 7 : 15);
  const mouthTop = mouthPanel.top + (compact ? 18 : 30);
  const mouthBottom = mouthPanel.bottom - (compact ? 7 : 18);
  const mouthWidth = throatX - lipX;
  const tonguePad = {
    left: lipX + (compact ? 8 : 18),
    right: lipX + mouthWidth * 0.7,
    top: mouthTop + (compact ? 8 : 15),
    bottom: mouthBottom - (compact ? 8 : 15),
  };
  tonguePad.x = tonguePad.left
    + rangeUnit(state.tongueBlock, HARMONICA_LIMITS.tongueBlock) * (tonguePad.right - tonguePad.left);
  tonguePad.y = tonguePad.bottom
    - rangeUnit(state.tongueHeight, HARMONICA_LIMITS.tongueHeight) * (tonguePad.bottom - tonguePad.top);
  const tractPad = {
    left: lipX + mouthWidth * 0.77,
    right: throatX - (compact ? 2 : 4),
    top: mouthTop + (compact ? 5 : 10),
    bottom: mouthBottom - (compact ? 5 : 10),
  };
  tractPad.x = tractPad.left
    + rangeUnit(state.throatOpening, HARMONICA_LIMITS.throatOpening) * (tractPad.right - tractPad.left);
  tractPad.y = tractPad.bottom
    - rangeUnit(state.vocalTractCoupling, HARMONICA_LIMITS.vocalTractCoupling) * (tractPad.bottom - tractPad.top);
  const coveredHoles = activeHoles(state);
  const apertureCenter = coveredHoles.reduce((sum, hole) => sum + hole, 0) / coveredHoles.length;
  const embouchureY = combTop - (compact ? 3 : 7);
  const lipReach = articulationToVisual(state.embouchure) * (compact ? 12 : 20);
  const cupPad = {
    left: cupPanel.left + (compact ? 9 : 22),
    right: cupPanel.right - (compact ? 9 : 22),
    top: cupPanel.top + (compact ? 20 : 38),
    bottom: cupPanel.bottom - (compact ? 9 : 25),
  };
  cupPad.x = cupPad.left
    + rangeUnit(state.handCup, HARMONICA_LIMITS.handCup) * (cupPad.right - cupPad.left);
  cupPad.y = cupPad.bottom
    - rangeUnit(state.growl, HARMONICA_LIMITS.growl) * (cupPad.bottom - cupPad.top);
  return {
    compact,
    notePanel,
    mouthPanel,
    bendPanel,
    cupPanel,
    breathPanel,
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
    lipsY: mouthPanel.top + (mouthPanel.bottom - mouthPanel.top) * (compact ? 0.58 : 0.55),
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

function drawViewFrame(rect, index, title, detail, color) {
  drawing.save();
  drawing.fillStyle = "rgba(5, 8, 8, 0.86)";
  drawing.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  drawing.strokeStyle = color;
  drawing.globalAlpha = 0.32;
  drawing.lineWidth = 0.8;
  drawing.strokeRect(rect.left + 0.5, rect.top + 0.5, rect.right - rect.left - 1, rect.bottom - rect.top - 1);
  drawing.globalAlpha = 0.88;
  drawing.fillStyle = color;
  drawing.font = "700 6px ui-monospace, SFMono-Regular, Consolas, monospace";
  drawing.textAlign = "left";
  drawing.fillText(`${index} · ${title}`, rect.left + 7, rect.top + 11);
  if (detail && rect.right - rect.left > 230) {
    drawing.globalAlpha = 0.52;
    drawing.textAlign = "right";
    drawing.fillText(detail, rect.right - 7, rect.top + 11);
  }
  drawing.restore();
}

function drawMouth(model) {
  const { compact, mouthPanel, tonguePad, tractPad } = model;
  const panelWidth = mouthPanel.right - mouthPanel.left;
  const panelHeight = mouthPanel.bottom - mouthPanel.top;
  const covered = new Set(activeHoles(state));
  const coveredList = [...covered];
  const lastCovered = Math.max(...coveredList);
  const lipProjection = articulationToVisual(state.embouchure);
  const telemetryIsLive = performance.now() - lastBreathTelemetryAt < 250;
  const visibleTongueBlock = telemetryIsLive && Number.isFinite(telemetry.effectiveTongueBlock)
    ? telemetry.effectiveTongueBlock
    : state.tongueBlock;
  const tongueAmount = rangeUnit(visibleTongueBlock, HARMONICA_LIMITS.tongueBlock);
  const tongueHeight = rangeUnit(state.tongueHeight, HARMONICA_LIMITS.tongueHeight);
  drawViewFrame(
    mouthPanel,
    "02",
    "LIP / TONGUE",
    `${state.chordWidth} COVERED · ${Math.round(visibleTongueBlock * 100)}% BLOCK`,
    "#e36a5d",
  );
  drawing.save();

  // A front-on cartoon mouth makes the relationship between lips, tongue and
  // holes readable at a glance. The earlier technical outline was too easy to
  // mistake for another parameter plot.
  const mouthLeft = mouthPanel.left + (compact ? 8 : 20);
  const mouthRight = tractPad.left - (compact ? 4 : 10);
  const mouthWidth = Math.max(24, mouthRight - mouthLeft);
  const mouthCenterX = (mouthLeft + mouthRight) * 0.5;
  const mouthCenterY = mouthPanel.top + panelHeight * (compact ? 0.58 : 0.55);
  const lipHalfHeight = clamp(
    panelHeight * (compact ? 0.21 : 0.19) + Math.abs(lipProjection) * (compact ? 1.5 : 5),
    compact ? 10 : 24,
    compact ? 22 : 62,
  );
  const lipPinch = clamp(0.78 - lipProjection * 0.12, 0.42, 1.12);

  // Cheeks / lower face silhouette.
  drawing.beginPath();
  drawing.moveTo(mouthLeft - mouthWidth * 0.035, mouthCenterY - lipHalfHeight * 0.58);
  drawing.bezierCurveTo(
    mouthLeft + mouthWidth * 0.08,
    mouthPanel.top + (compact ? 17 : 28),
    mouthRight - mouthWidth * 0.08,
    mouthPanel.top + (compact ? 17 : 28),
    mouthRight + mouthWidth * 0.035,
    mouthCenterY - lipHalfHeight * 0.58,
  );
  drawing.bezierCurveTo(
    mouthRight + mouthWidth * 0.02,
    mouthCenterY + lipHalfHeight * 1.45,
    mouthLeft - mouthWidth * 0.02,
    mouthCenterY + lipHalfHeight * 1.45,
    mouthLeft - mouthWidth * 0.035,
    mouthCenterY - lipHalfHeight * 0.58,
  );
  drawing.closePath();
  drawing.fillStyle = "rgba(211, 151, 111, 0.12)";
  drawing.fill();
  strokePath("#8d5848", compact ? 0.8 : 1.2, 0.45);

  // A simple nose anchors this as a face even in the smallest two-column view.
  const noseY = mouthCenterY - lipHalfHeight * 1.35;
  drawing.beginPath();
  drawing.moveTo(mouthCenterX, noseY - lipHalfHeight * 0.42);
  drawing.quadraticCurveTo(
    mouthCenterX - mouthWidth * 0.035,
    noseY + lipHalfHeight * 0.08,
    mouthCenterX - mouthWidth * 0.07,
    noseY + lipHalfHeight * 0.24,
  );
  drawing.quadraticCurveTo(
    mouthCenterX,
    noseY + lipHalfHeight * 0.38,
    mouthCenterX + mouthWidth * 0.07,
    noseY + lipHalfHeight * 0.24,
  );
  drawing.fillStyle = "rgba(211, 151, 111, 0.34)";
  drawing.fill();
  strokePath("#b36d55", compact ? 0.7 : 1.1, 0.62);
  drawing.fillStyle = "rgba(46, 20, 17, 0.72)";
  drawing.beginPath();
  drawing.ellipse(mouthCenterX - mouthWidth * 0.025, noseY + lipHalfHeight * 0.23, compact ? 1 : 1.8, compact ? 0.7 : 1.1, 0, 0, Math.PI * 2);
  drawing.ellipse(mouthCenterX + mouthWidth * 0.025, noseY + lipHalfHeight * 0.23, compact ? 1 : 1.8, compact ? 0.7 : 1.1, 0, 0, Math.PI * 2);
  drawing.fill();

  // Bold outer lips and a dark mouth cavity.
  drawing.beginPath();
  drawing.moveTo(mouthLeft, mouthCenterY);
  drawing.bezierCurveTo(
    mouthLeft + mouthWidth * 0.2,
    mouthCenterY - lipHalfHeight * 1.05,
    mouthLeft + mouthWidth * 0.38,
    mouthCenterY - lipHalfHeight * 0.8,
    mouthCenterX,
    mouthCenterY - lipHalfHeight * 0.58,
  );
  drawing.bezierCurveTo(
    mouthLeft + mouthWidth * 0.65,
    mouthCenterY - lipHalfHeight * 0.85,
    mouthRight - mouthWidth * 0.16,
    mouthCenterY - lipHalfHeight * 0.96,
    mouthRight,
    mouthCenterY,
  );
  drawing.bezierCurveTo(
    mouthRight - mouthWidth * 0.2,
    mouthCenterY + lipHalfHeight * 1.08,
    mouthLeft + mouthWidth * 0.2,
    mouthCenterY + lipHalfHeight * 1.08,
    mouthLeft,
    mouthCenterY,
  );
  drawing.closePath();
  const lipGradient = drawing.createLinearGradient(0, mouthCenterY - lipHalfHeight, 0, mouthCenterY + lipHalfHeight);
  lipGradient.addColorStop(0, "#f58b7f");
  lipGradient.addColorStop(0.5, "#b9474e");
  lipGradient.addColorStop(1, "#7d2939");
  drawing.fillStyle = lipGradient;
  drawing.fill();
  strokePath("#ffb0a2", compact ? 1.1 : 2, 0.85);

  const cavityLeft = mouthLeft + mouthWidth * 0.075;
  const cavityRight = mouthRight - mouthWidth * 0.075;
  const cavityWidth = cavityRight - cavityLeft;
  drawing.beginPath();
  drawing.moveTo(cavityLeft, mouthCenterY);
  drawing.bezierCurveTo(
    cavityLeft + cavityWidth * 0.22,
    mouthCenterY - lipHalfHeight * 0.52 * lipPinch,
    cavityRight - cavityWidth * 0.22,
    mouthCenterY - lipHalfHeight * 0.52 * lipPinch,
    cavityRight,
    mouthCenterY,
  );
  drawing.bezierCurveTo(
    cavityRight - cavityWidth * 0.2,
    mouthCenterY + lipHalfHeight * 0.6 * lipPinch,
    cavityLeft + cavityWidth * 0.2,
    mouthCenterY + lipHalfHeight * 0.6 * lipPinch,
    cavityLeft,
    mouthCenterY,
  );
  drawing.closePath();
  drawing.fillStyle = "#1a090d";
  drawing.fill();
  strokePath("#5b202d", compact ? 0.7 : 1.2, 0.95);

  // The tongue stays visible even at zero block so the anatomy remains clear;
  // its reach and height follow the same physical controls as the DSP.
  const tongueLeft = cavityLeft + cavityWidth * 0.08;
  const tongueRight = tongueLeft + cavityWidth * (0.24 + tongueAmount * 0.58);
  const tongueY = mouthCenterY - lipHalfHeight * (0.05 + tongueHeight * 0.22);
  const tongueThickness = clamp(lipHalfHeight * 0.42, compact ? 4 : 8, compact ? 8 : 18);
  drawing.beginPath();
  drawing.moveTo(tongueLeft, tongueY + tongueThickness * 0.45);
  drawing.bezierCurveTo(
    tongueLeft + cavityWidth * 0.15,
    tongueY - tongueThickness * 0.7,
    tongueRight - tongueThickness * 0.55,
    tongueY - tongueThickness * 0.72,
    tongueRight,
    tongueY,
  );
  drawing.bezierCurveTo(
    tongueRight - tongueThickness * 0.25,
    tongueY + tongueThickness * 0.65,
    tongueLeft + cavityWidth * 0.08,
    tongueY + tongueThickness * 0.85,
    tongueLeft,
    tongueY + tongueThickness * 0.45,
  );
  drawing.closePath();
  drawing.fillStyle = "#e8799b";
  drawing.fill();
  strokePath("#ffabc2", compact ? 0.7 : 1.2, 0.95);

  // A recognizable ten-hole harmonica sits between the lips.
  const railLeft = mouthLeft + mouthWidth * 0.025;
  const railRight = mouthRight - mouthWidth * 0.025;
  const railWidth = railRight - railLeft;
  const slotWidth = railWidth / renderedHoleCount;
  const railHeight = clamp(lipHalfHeight * 0.62, compact ? 7 : 12, compact ? 13 : 25);
  const railTop = mouthCenterY + lipHalfHeight * 0.02;
  const railBottom = railTop + railHeight;
  const metal = drawing.createLinearGradient(0, railTop, 0, railBottom);
  metal.addColorStop(0, "#f5efe0");
  metal.addColorStop(0.25, "#aaa79d");
  metal.addColorStop(0.52, "#4b4f4d");
  metal.addColorStop(1, "#d2a957");
  drawing.fillStyle = metal;
  drawing.fillRect(railLeft - 2, railTop - 2, railWidth + 4, railHeight + 4);
  drawing.strokeStyle = "#f0bd69";
  drawing.lineWidth = compact ? 0.8 : 1.4;
  drawing.strokeRect(railLeft - 2, railTop - 2, railWidth + 4, railHeight + 4);
  for (let hole = 1; hole <= renderedHoleCount; hole += 1) {
    const left = railLeft + (hole - 1) * slotWidth + 0.6;
    const isCovered = covered.has(hole);
    const isTongueBlocked = isCovered
      && hole !== state.hole
      && tongueAmount > 0.01;
    drawing.fillStyle = isCovered ? "#3f2518" : "#080a09";
    drawing.fillRect(left, railTop, Math.max(1, slotWidth - 1.2), railBottom - railTop);
    drawing.strokeStyle = hole === state.hole ? "#fff0c7" : "rgba(216, 223, 220, 0.42)";
    drawing.lineWidth = hole === state.hole ? (compact ? 0.8 : 1.3) : 0.6;
    drawing.strokeRect(left, railTop, Math.max(1, slotWidth - 1.2), railBottom - railTop);
    if (isTongueBlocked) {
      drawing.fillStyle = `rgba(232, 121, 155, ${0.2 + tongueAmount * 0.72})`;
      drawing.fillRect(left, railTop, Math.max(1, slotWidth - 1.2), railBottom - railTop);
    }
  }

  // Lip rims sit in front of the instrument so it visibly passes into a mouth.
  drawing.beginPath();
  drawing.moveTo(mouthLeft + mouthWidth * 0.03, mouthCenterY - 1);
  drawing.quadraticCurveTo(mouthCenterX, mouthCenterY - lipHalfHeight * 0.92, mouthRight - mouthWidth * 0.03, mouthCenterY - 1);
  strokePath("#ff9d91", compact ? 1.4 : 2.6, 0.96);
  drawing.beginPath();
  drawing.moveTo(mouthLeft + mouthWidth * 0.05, railBottom + 1);
  drawing.quadraticCurveTo(mouthCenterX, mouthCenterY + lipHalfHeight * 1.02, mouthRight - mouthWidth * 0.05, railBottom + 1);
  strokePath("#b94755", compact ? 1.4 : 2.6, 0.96);

  // Side cutaway for the throat / resonant tract.
  const throatCenterX = (tractPad.left + tractPad.right) * 0.5;
  const throatCenterY = (tractPad.top + tractPad.bottom) * 0.48;
  const throatRadiusX = Math.max(3, (tractPad.right - tractPad.left) * 0.34);
  const throatRadiusY = Math.max(6, (tractPad.bottom - tractPad.top) * 0.24);
  drawing.beginPath();
  drawing.ellipse(throatCenterX, throatCenterY, throatRadiusX, throatRadiusY, 0, 0, Math.PI * 2);
  drawing.fillStyle = "rgba(105, 213, 221, 0.13)";
  drawing.fill();
  strokePath("#69d5dd", compact ? 0.8 : 1.2, 0.78);
  const throatOpening = rangeUnit(state.throatOpening, HARMONICA_LIMITS.throatOpening);
  drawing.beginPath();
  drawing.moveTo(throatCenterX, throatCenterY + throatRadiusY * 0.75);
  drawing.lineTo(throatCenterX, tractPad.bottom - 2);
  strokePath("#69d5dd", 1 + throatOpening * (compact ? 2 : 4), 0.35 + throatOpening * 0.5);

  drawing.fillStyle = "rgba(255, 196, 189, 0.9)";
  drawing.font = `700 ${compact ? 4.5 : 6}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.textAlign = "left";
  drawing.fillText("LIPS", mouthLeft + 2, mouthCenterY - lipHalfHeight - (compact ? 2 : 5));
  drawing.fillStyle = "rgba(255, 171, 194, 0.92)";
  drawing.fillText("TONGUE", tongueLeft, Math.min(railTop - 3, tongueY - tongueThickness * 0.62));
  drawing.fillStyle = "rgba(105, 213, 221, 0.76)";
  drawing.textAlign = "center";
  drawing.fillText("THROAT", throatCenterX, tractPad.bottom - (compact ? 0 : 5));
  drawing.fillStyle = "rgba(216, 223, 220, 0.5)";
  drawing.fillText(state.hole === lastCovered ? "OPEN EDGE" : "OPEN ANCHOR", mouthCenterX, mouthPanel.bottom - 4);
  drawing.restore();
}

function drawBluesCup(model) {
  const phase = prefersReducedMotion
    ? 0
    : (performance.now() / 1_000 * state.techniqueRateHz) % 1;
  const wahWet = state.bluesTechniqueId === "hand-wah"
    ? clamp(state.techniqueAmount)
    : 0;
  const telemetryIsLive = performance.now() - lastBreathTelemetryAt < 250;
  const effectiveCup = telemetryIsLive && Number.isFinite(telemetry.effectiveHandCup)
    ? telemetry.effectiveHandCup
    : state.handCup;
  const closure = rangeUnit(effectiveCup, HARMONICA_LIMITS.handCup);
  const growlAmount = rangeUnit(state.growl, HARMONICA_LIMITS.growl);
  const { cupPanel, cupPad, compact } = model;
  const panelWidth = cupPanel.right - cupPanel.left;
  const panelHeight = cupPanel.bottom - cupPanel.top;
  const centerX = (cupPanel.left + cupPanel.right) * 0.5;
  const centerY = cupPanel.top + panelHeight * (compact ? 0.58 : 0.55);
  const harpWidth = panelWidth * (compact ? 0.49 : 0.5);
  const harpHeight = clamp(panelHeight * 0.105, compact ? 7 : 12, compact ? 12 : 22);
  const opening = (1 - closure) * panelWidth * (compact ? 0.25 : 0.31);
  const supportSkin = "#d79768";
  const cupSkin = "#c76f58";
  const skinLight = "#f2bd8c";
  const skinShadow = "#6e3c2c";
  const fallbackHandResonanceHz = 460 + Math.pow(1 - closure, 1.35) * 2_760;
  const reportedHandResonanceHz = Number(telemetry.handResonanceFrequencyHz);
  const handResonanceFrequencyHz = telemetryIsLive
    && Number.isFinite(reportedHandResonanceHz)
    && reportedHandResonanceHz > 0
    ? reportedHandResonanceHz
    : fallbackHandResonanceHz;
  const resonanceUnit = clamp((handResonanceFrequencyHz - 460) / 2_760);
  const digitWidth = clamp(harpHeight * 0.48, compact ? 3.5 : 5, compact ? 6.5 : 9);
  const supportPalmWidth = clamp(harpWidth * 0.56, compact ? 34 : 62, compact ? 58 : 96);
  const supportPalmHeight = clamp(harpHeight * 1.75, compact ? 14 : 24, compact ? 25 : 39);
  const cupPalmWidth = clamp(harpWidth * 0.38, compact ? 24 : 38, compact ? 44 : 70);
  const cupPalmHeight = clamp(harpHeight * 4.25, compact ? 34 : 56, compact ? 64 : 96);
  const cupPivotX = centerX + harpWidth * 0.54 + opening * 0.78;
  const cupPivotY = centerY + harpHeight * 0.6;
  const cupAngle = 0.03 + (1 - closure) * 0.18;
  drawViewFrame(
    cupPanel,
    "04",
    "HANDS / CUP",
    `${Math.round(closure * 100)}% CUP · HAND ${Math.round(handResonanceFrequencyHz)} HZ${wahWet > 0 ? " · WAH" : ""}`,
    "#f0bd69",
  );
  drawing.save();

  // The hand resonance lives in the asymmetric gap between the right cover
  // and the moving cup hand, rather than between two mirrored palms.
  const cavityPulse = prefersReducedMotion
    ? 0.35
    : (Math.sin(phase * Math.PI * 2) + 1) * 0.5;
  const cavityCenterX = centerX + harpWidth * 0.42 + opening * 0.35;
  drawing.save();
  drawing.setLineDash(compact ? [2, 3] : [3, 4]);
  for (let ring = 0; ring < 4; ring += 1) {
    const spread = (ring + cavityPulse) / 4;
    drawing.beginPath();
    drawing.ellipse(
      cavityCenterX,
      centerY,
      Math.max(3, harpHeight * (0.32 + spread * 0.54) + opening * 0.38),
      harpHeight * (0.66 + spread * (0.68 + resonanceUnit * 0.7)),
      0,
      0,
      Math.PI * 2,
    );
    drawing.strokeStyle = `rgba(${Math.round(105 + resonanceUnit * 64)}, ${Math.round(213 - resonanceUnit * 58)}, 221, ${0.08 + (1 - spread) * 0.2})`;
    drawing.lineWidth = compact ? 0.7 : 1.1;
    drawing.stroke();
  }
  drawing.restore();

  // A small filled core keeps the acoustic hand cavity visible when nearly shut.
  drawing.beginPath();
  drawing.ellipse(
    cavityCenterX,
    centerY,
    Math.max(2.5, opening * 0.34 + harpHeight * 0.22),
    harpHeight * 1.1,
    0,
    0,
    Math.PI * 2,
  );
  drawing.fillStyle = `rgba(105, 213, 221, ${0.04 + (1 - closure) * 0.14})`;
  drawing.fill();
  strokePath("#69d5dd", compact ? 0.8 : 1.2, 0.28 + (1 - closure) * 0.5);

  const drawSupportPalm = () => {
    const left = centerX - harpWidth * 0.62;
    const right = left + supportPalmWidth;
    const top = centerY + harpHeight * 0.42;
    const bottom = top + supportPalmHeight;
    const wristY = bottom + harpHeight * 1.28;
    drawing.beginPath();
    drawing.moveTo(left, top + supportPalmHeight * 0.3);
    drawing.bezierCurveTo(
      left + supportPalmWidth * 0.04,
      top,
      left + supportPalmWidth * 0.25,
      top - supportPalmHeight * 0.08,
      right - supportPalmHeight * 0.3,
      top,
    );
    drawing.quadraticCurveTo(
      right + supportPalmHeight * 0.22,
      top + supportPalmHeight * 0.34,
      right - supportPalmHeight * 0.02,
      bottom,
    );
    drawing.lineTo(left + supportPalmWidth * 0.4, bottom + supportPalmHeight * 0.08);
    drawing.lineTo(left + supportPalmWidth * 0.12, wristY);
    drawing.lineTo(left - supportPalmWidth * 0.15, wristY - harpHeight * 0.34);
    drawing.lineTo(left + supportPalmWidth * 0.03, bottom - supportPalmHeight * 0.08);
    drawing.quadraticCurveTo(left - supportPalmHeight * 0.16, top + supportPalmHeight * 0.68, left, top + supportPalmHeight * 0.3);
    drawing.closePath();
    const palmGradient = drawing.createRadialGradient(
      right - supportPalmWidth * 0.3,
      top + supportPalmHeight * 0.15,
      1,
      (left + right) * 0.5,
      (top + bottom) * 0.5,
      supportPalmWidth * 0.68,
    );
    palmGradient.addColorStop(0, skinLight);
    palmGradient.addColorStop(0.72, supportSkin);
    palmGradient.addColorStop(1, skinShadow);
    drawing.fillStyle = palmGradient;
    drawing.fill();
    strokePath("#f0bd69", compact ? 0.9 : 1.5, 0.92);
    drawing.beginPath();
    drawing.moveTo(left - supportPalmWidth * 0.11, wristY - harpHeight * 0.5);
    drawing.lineTo(left + supportPalmWidth * 0.18, wristY - harpHeight * 0.08);
    strokePath("#3e2823", compact ? 1.2 : 2, 0.78);
    drawing.beginPath();
    drawing.moveTo(left + supportPalmWidth * 0.32, bottom - supportPalmHeight * 0.24);
    drawing.quadraticCurveTo(
      left + supportPalmWidth * 0.53,
      bottom - supportPalmHeight * 0.43,
      right - supportPalmWidth * 0.08,
      bottom - supportPalmHeight * 0.34,
    );
    strokePath("#7c4635", compact ? 0.6 : 0.9, 0.72);
  };

  const drawCupPalm = () => {
    drawing.save();
    drawing.translate(cupPivotX, cupPivotY);
    drawing.rotate(cupAngle);
    const width = cupPalmWidth;
    const height = cupPalmHeight;
    drawing.beginPath();
    drawing.moveTo(-width * 0.3, -height * 0.48);
    drawing.bezierCurveTo(width * 0.04, -height * 0.67, width * 0.56, -height * 0.44, width * 0.62, -height * 0.08);
    drawing.bezierCurveTo(width * 0.68, height * 0.2, width * 0.46, height * 0.4, width * 0.3, height * 0.53);
    drawing.lineTo(width * 0.78, height * 0.78);
    drawing.lineTo(width * 0.38, height * 0.94);
    drawing.lineTo(-width * 0.04, height * 0.57);
    drawing.bezierCurveTo(-width * 0.4, height * 0.43, -width * 0.5, height * 0.17, -width * 0.34, height * 0.02);
    drawing.bezierCurveTo(-width * 0.52, -height * 0.13, -width * 0.5, -height * 0.36, -width * 0.3, -height * 0.48);
    drawing.closePath();
    const cupGradient = drawing.createRadialGradient(-width * 0.12, -height * 0.28, 1, width * 0.08, 0, height * 0.68);
    cupGradient.addColorStop(0, "#efa37f");
    cupGradient.addColorStop(0.7, cupSkin);
    cupGradient.addColorStop(1, "#63312d");
    drawing.fillStyle = cupGradient;
    drawing.fill();
    strokePath("#e36a5d", compact ? 0.9 : 1.5, 0.94);
    drawing.beginPath();
    drawing.moveTo(width * 0.16, height * 0.58);
    drawing.lineTo(width * 0.62, height * 0.81);
    strokePath("#4a2423", compact ? 1.2 : 2, 0.84);
    drawing.beginPath();
    drawing.moveTo(-width * 0.22, height * 0.28);
    drawing.quadraticCurveTo(width * 0.02, height * 0.12, width * 0.3, height * 0.2);
    strokePath("#7c3b34", compact ? 0.6 : 0.9, 0.76);
    drawing.restore();
  };

  const strokeFinger = (startX, startY, controlX, controlY, endX, endY, color = supportSkin, width = digitWidth) => {
    drawing.beginPath();
    drawing.moveTo(startX, startY);
    drawing.quadraticCurveTo(controlX, controlY, endX, endY);
    drawing.lineCap = "round";
    drawing.strokeStyle = skinShadow;
    drawing.lineWidth = width + (compact ? 1.5 : 2.5);
    drawing.globalAlpha = 0.96;
    drawing.stroke();
    drawing.strokeStyle = color;
    drawing.lineWidth = width;
    drawing.stroke();
    drawing.globalAlpha = 1;
  };

  drawSupportPalm();
  const visibleFingers = compact ? 3 : 4;
  for (let finger = 0; finger < visibleFingers; finger += 1) {
    const spread = finger / Math.max(1, visibleFingers - 1);
    strokeFinger(
      centerX - harpWidth * (0.54 - spread * 0.23),
      centerY + harpHeight * (0.78 + spread * 0.1),
      centerX - harpWidth * (0.5 - spread * 0.17),
      centerY - harpHeight * (1.26 - spread * 0.12),
      centerX - harpWidth * (0.43 - spread * 0.21),
      centerY - harpHeight * (0.66 - spread * 0.08),
      supportSkin,
      digitWidth * (0.9 - spread * 0.08),
    );
  }

  drawCupPalm();
  drawing.save();
  drawing.translate(cupPivotX, cupPivotY);
  drawing.rotate(cupAngle);
  for (let finger = 0; finger < visibleFingers; finger += 1) {
    const spread = finger / Math.max(1, visibleFingers - 1);
    strokeFinger(
      cupPalmWidth * (0.03 + spread * 0.08),
      -cupPalmHeight * (0.3 - spread * 0.17),
      -cupPalmWidth * (0.52 - spread * 0.08),
      -cupPalmHeight * (0.55 - spread * 0.09),
      -cupPalmWidth * (0.66 - spread * 0.12),
      -cupPalmHeight * (0.33 - spread * 0.11),
      cupSkin,
      digitWidth * (0.94 - spread * 0.08),
    );
  }
  drawing.restore();

  // Bright instrument body keeps the object legible between the two hands.
  const metal = drawing.createLinearGradient(0, centerY - harpHeight, 0, centerY + harpHeight);
  metal.addColorStop(0, "#fff8e7");
  metal.addColorStop(0.22, "#c9cdca");
  metal.addColorStop(0.5, "#4b504d");
  metal.addColorStop(1, "#d2a957");
  drawing.fillStyle = metal;
  drawing.fillRect(centerX - harpWidth * 0.5, centerY - harpHeight, harpWidth, harpHeight * 2);
  drawing.strokeStyle = "#f0bd69";
  drawing.lineWidth = compact ? 0.9 : 1.5;
  drawing.strokeRect(centerX - harpWidth * 0.5, centerY - harpHeight, harpWidth, harpHeight * 2);
  const holeWidth = harpWidth / renderedHoleCount;
  for (let hole = 0; hole < renderedHoleCount; hole += 1) {
    const x = centerX - harpWidth * 0.5 + hole * holeWidth + holeWidth * 0.19;
    drawing.fillStyle = hole + 1 === state.hole ? "#e36a5d" : "#0a0c0b";
    drawing.fillRect(x, centerY - harpHeight * 0.34, holeWidth * 0.62, harpHeight * 0.72);
  }

  // The fixed support thumb braces only the left third; it no longer meets a
  // mirrored thumb in the middle.
  strokeFinger(
    centerX - harpWidth * 0.5,
    centerY + harpHeight * 1.34,
    centerX - harpWidth * 0.36,
    centerY + harpHeight * 0.33,
    centerX - harpWidth * 0.13,
    centerY + harpHeight * 0.48,
    supportSkin,
    digitWidth * 1.16,
  );

  // The moving thumb hooks under the right cover in the cup hand's own
  // rotated coordinate space, stopping well before the support thumb.
  drawing.save();
  drawing.translate(cupPivotX, cupPivotY);
  drawing.rotate(cupAngle);
  strokeFinger(
    cupPalmWidth * 0.04,
    cupPalmHeight * 0.3,
    -cupPalmWidth * 0.46,
    cupPalmHeight * 0.16,
    -cupPalmWidth * 0.66,
    -cupPalmHeight * 0.01,
    cupSkin,
    digitWidth * 1.14,
  );
  drawing.restore();

  // A bold sweep beside the moving hand shows the open/close throw. Its
  // length follows the actual effective cup value coming back from the DSP.
  const motionLeft = centerX + harpWidth * 0.52;
  const motionRight = Math.min(cupPanel.right - 5, motionLeft + Math.max(8, opening * 0.92));
  const motionY = cupPanel.top + (compact ? 14 : 28);
  drawing.beginPath();
  drawing.moveTo(motionLeft, motionY);
  drawing.lineTo(motionRight, motionY);
  drawing.moveTo(motionLeft, motionY);
  drawing.lineTo(motionLeft + (compact ? 3 : 5), motionY - (compact ? 2 : 3));
  drawing.moveTo(motionLeft, motionY);
  drawing.lineTo(motionLeft + (compact ? 3 : 5), motionY + (compact ? 2 : 3));
  drawing.moveTo(motionRight, motionY);
  drawing.lineTo(motionRight - (compact ? 3 : 5), motionY - (compact ? 2 : 3));
  drawing.moveTo(motionRight, motionY);
  drawing.lineTo(motionRight - (compact ? 3 : 5), motionY + (compact ? 2 : 3));
  strokePath("#e36a5d", compact ? 0.8 : 1.2, 0.55 + (1 - closure) * 0.36);

  if (!compact) {
    drawing.font = "700 6px ui-monospace, SFMono-Regular, Consolas, monospace";
    drawing.textAlign = "center";
    drawing.fillStyle = "rgba(240, 189, 105, 0.82)";
    drawing.fillText("SUPPORT HAND", centerX - harpWidth * 0.34, cupPanel.bottom - 8);
    drawing.fillStyle = "rgba(227, 106, 93, 0.86)";
    drawing.fillText("MOVING CUP HAND", Math.min(cupPanel.right - 36, cupPivotX), cupPanel.bottom - 8);
    drawing.fillStyle = "rgba(105, 213, 221, 0.75)";
    drawing.fillText(closure > 0.72 ? "HAND CAVITY" : "OPEN AIR GAP", cavityCenterX, cupPanel.top + 25);
  }

  if (growlAmount > 0.01) {
    drawing.strokeStyle = `rgba(169, 155, 239, ${0.18 + growlAmount * 0.52})`;
    drawing.lineWidth = 0.8 + growlAmount * 1.2;
    for (let line = 0; line < 3; line += 1) {
      drawing.beginPath();
      for (let point = 0; point <= 18; point += 1) {
        const unit = point / 18;
        const x = centerX - harpWidth * 0.45 + harpWidth * 0.9 * unit;
        const y = centerY + line * (compact ? 2 : 4)
          + Math.sin(unit * Math.PI * 5 + phase * Math.PI * 2 + line * 1.4) * growlAmount * 4;
        if (point === 0) drawing.moveTo(x, y);
        else drawing.lineTo(x, y);
      }
      drawing.stroke();
    }
  }

  // Quiet axes retain the draggable control affordance without boxing the art.
  drawing.strokeStyle = "rgba(169, 155, 239, 0.13)";
  drawing.lineWidth = 0.7;
  drawing.beginPath();
  drawing.moveTo(cupPad.left, cupPad.bottom);
  drawing.lineTo(cupPad.right, cupPad.bottom);
  drawing.moveTo(cupPad.left, cupPad.top);
  drawing.lineTo(cupPad.left, cupPad.bottom);
  drawing.stroke();
  drawing.restore();
}

function drawHarmonica(model) {
  const {
    compact, notePanel, combLeft, combRight, combTop, combBottom, combY, holeWidth,
  } = model;
  const covered = new Set(activeHoles(state));
  const flow = visualBreathFlow;
  const soundingDirection = flow < -0.02 ? -1 : flow > 0.02 ? 1 : 0;
  const overbendSpeaking = Boolean(telemetry.overbendActive) && soundingDirection !== 0;
  const key = harmonicaKey(state.keyId);
  const preset = harmonicaPreset(state.presetId);
  drawViewFrame(
    notePanel,
    "01",
    "NOTE / HOLE",
    `${key.label} RICHTER · ${preset.label.toUpperCase()} · 3 OCTAVES`,
    "#d8dfdc",
  );

  const metal = drawing.createLinearGradient(0, combTop, 0, combBottom);
  metal.addColorStop(0, "rgba(236, 239, 232, 0.74)");
  metal.addColorStop(0.13, "rgba(67, 73, 70, 0.72)");
  metal.addColorStop(0.48, "rgba(8, 10, 10, 0.98)");
  metal.addColorStop(0.87, "rgba(80, 73, 60, 0.7)");
  metal.addColorStop(1, "rgba(232, 218, 184, 0.68)");
  drawing.fillStyle = metal;
  drawing.fillRect(combLeft - 5, combTop - 4, combRight - combLeft + 10, combBottom - combTop + 8);
  drawing.strokeStyle = "rgba(240, 229, 197, 0.64)";
  drawing.lineWidth = compact ? 0.7 : 1;
  drawing.strokeRect(combLeft - 5, combTop - 4, combRight - combLeft + 10, combBottom - combTop + 8);

  holeRegions = [];
  for (let hole = 1; hole <= renderedHoleCount; hole += 1) {
    const left = combLeft + (hole - 1) * holeWidth + 1;
    const right = combLeft + hole * holeWidth - 1;
    const pair = harmonicaReedPair(state, hole);
    const isCovered = covered.has(hole);
    const isSelected = hole === state.hole;
    const tongueBlocked = isCovered
      && hole !== state.hole
      && state.tongueBlock > 0.01
      && state.bluesTechniqueId !== "octave-tongue-block";
    const tongueTransmission = tongueBlocked ? 1 - state.tongueBlock * 0.94 : 1;
    const activeDirection = isCovered && tongueTransmission > 0.08 ? soundingDirection : 0;
    const selectedColor = activeDirection < 0
      ? "#69d5dd"
      : activeDirection > 0 ? "#f0bd69" : "#e36a5d";

    drawing.fillStyle = isCovered ? "rgba(227, 106, 93, 0.12)" : "rgba(2, 4, 4, 0.82)";
    drawing.fillRect(left, combTop, right - left, combBottom - combTop);
    drawing.strokeStyle = isSelected ? selectedColor : "rgba(216, 223, 220, 0.2)";
    drawing.lineWidth = isSelected ? (compact ? 1 : 1.5) : 0.6;
    drawing.strokeRect(left, combTop, right - left, combBottom - combTop);

    const motion = activeDirection && isCovered
      ? clamp(telemetry.displacement, -1.2, 1.2) * (compact ? 1.4 : 3.4)
      : 0;
    const centerX = (left + right) * 0.5;
    const topCenterY = combTop + (combY - combTop) * 0.52;
    const bottomCenterY = combY + (combBottom - combY) * 0.48;
    drawing.beginPath();
    drawing.moveTo(left + 3, topCenterY);
    drawing.lineTo(right - 3, topCenterY + (activeDirection > 0 ? motion : 0));
    strokePath(activeDirection > 0 ? (overbendSpeaking ? "#a99bef" : "#f0bd69") : "#9fa7a3", compact ? 0.75 : 1.1, isCovered ? 0.86 * tongueTransmission : 0.28);
    drawing.beginPath();
    drawing.moveTo(left + 3, bottomCenterY);
    drawing.lineTo(right - 3, bottomCenterY + (activeDirection < 0 ? motion : 0));
    strokePath(activeDirection < 0 ? (overbendSpeaking ? "#a99bef" : "#69d5dd") : "#9fa7a3", compact ? 0.75 : 1.1, isCovered ? 0.86 * tongueTransmission : 0.28);

    drawing.textAlign = "center";
    drawing.font = `700 ${compact ? 5 : 7}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    drawing.fillStyle = activeDirection > 0 && isCovered ? "#f0bd69" : "rgba(240, 189, 105, 0.68)";
    drawing.fillText(compact ? pair.blowName.replace(/\d+$/, "") : pair.blowName, centerX, combTop + (compact ? 7 : 11));
    drawing.fillStyle = isSelected ? "#e36a5d" : "rgba(216, 223, 220, 0.68)";
    drawing.fillText(String(hole), centerX, combY + (compact ? 2 : 3));
    drawing.fillStyle = activeDirection < 0 && isCovered ? "#69d5dd" : "rgba(105, 213, 221, 0.68)";
    drawing.fillText(compact ? pair.drawName.replace(/\d+$/, "") : pair.drawName, centerX, combBottom - (compact ? 3 : 5));

    if (tongueBlocked) {
      drawing.fillStyle = `rgba(169, 155, 239, ${0.08 + state.tongueBlock * 0.38})`;
      drawing.fillRect(left, combTop, right - left, combBottom - combTop);
    }
    holeRegions.push({ type: "play-hole", hole, direction: 1, left, right, top: combTop, bottom: combY });
    holeRegions.push({ type: "play-hole", hole, direction: -1, left, right, top: combY, bottom: combBottom });
  }

  const coveredList = [...covered];
  const firstCovered = Math.min(...coveredList);
  const lastCovered = Math.max(...coveredList);
  const bracketLeft = combLeft + (firstCovered - 1) * holeWidth;
  const bracketRight = combLeft + lastCovered * holeWidth;
  drawing.strokeStyle = "rgba(227, 106, 93, 0.86)";
  drawing.lineWidth = compact ? 1 : 1.4;
  drawing.beginPath();
  drawing.moveTo(bracketLeft, combTop - (compact ? 2 : 5));
  drawing.lineTo(bracketLeft, combTop - (compact ? 6 : 10));
  drawing.lineTo(bracketRight, combTop - (compact ? 6 : 10));
  drawing.lineTo(bracketRight, combTop - (compact ? 2 : 5));
  drawing.stroke();

  const bracketY = combTop - (compact ? 6 : 10);
  const edgeRadius = compact ? 3.5 : 5;
  for (const [type, x, direction] of [
    ["aperture-left", bracketLeft, 1],
    ["aperture-right", bracketRight, -1],
  ]) {
    drawing.beginPath();
    drawing.arc(x, bracketY, edgeRadius, 0, Math.PI * 2);
    drawing.fillStyle = "#e36a5d";
    drawing.fill();
    drawing.strokeStyle = "rgba(255, 235, 222, 0.92)";
    drawing.lineWidth = compact ? 0.7 : 1;
    drawing.stroke();
    drawing.beginPath();
    drawing.moveTo(x - direction * edgeRadius * 0.45, bracketY);
    drawing.lineTo(x + direction * edgeRadius * 0.4, bracketY);
    drawing.lineTo(x + direction * edgeRadius * 0.05, bracketY - edgeRadius * 0.35);
    drawing.moveTo(x + direction * edgeRadius * 0.4, bracketY);
    drawing.lineTo(x + direction * edgeRadius * 0.05, bracketY + edgeRadius * 0.35);
    strokePath("#050707", compact ? 0.65 : 0.9, 0.9);
    handles.push({ type, x, y: bracketY, radius: edgeRadius + (compact ? 8 : 10) });
  }

  drawing.save();
  drawing.font = `700 ${compact ? 4.5 : 6}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  drawing.textAlign = "left";
  drawing.fillStyle = "rgba(240, 189, 105, 0.78)";
  drawing.fillText("BLOW", combLeft, combTop + (compact ? 7 : 11));
  drawing.fillStyle = "rgba(105, 213, 221, 0.78)";
  drawing.fillText("DRAW", combLeft, combBottom - (compact ? 3 : 5));
  drawing.restore();
}

function drawBreathFlow(model) {
  const { breathPanel, compact } = model;
  const flow = visualBreathFlow;
  const amount = Math.sqrt(clamp(Math.abs(flow) / 3));
  const blowing = flow > 0;
  const startX = breathPanel.left + (compact ? 8 : 16);
  const endX = breathPanel.right - (compact ? 8 : 16);
  const direction = blowing ? -1 : 1;
  const color = blowing ? "#f0bd69" : "#69d5dd";
  const rateMotion = logarithmicUnit(state.breathRateBpm, HARMONICA_LIMITS.breathRateBpm);
  const time = prefersReducedMotion
    ? 0.42
    : performance.now() * (0.0006 + amount * 0.0015 + rateMotion * 0.003);
  drawViewFrame(
    breathPanel,
    "05",
    "BREATH / RHYTHM",
    `${breathLabel(flow).toUpperCase()} · ${harmonicaBluesRhythm(state.bluesRhythmId).label.toUpperCase()}`,
    "#69d5dd",
  );
  if (amount < 0.02) return;
  drawing.save();
  drawing.lineCap = "round";
  const centerY = (breathPanel.top + breathPanel.bottom) * 0.5;
  for (let index = 0; index < (compact ? 5 : 10); index += 1) {
    const travel = (time + index / (compact ? 5 : 10)) % 1;
    const position = blowing ? 1 - travel : travel;
    const x = startX + (endX - startX) * position;
    const y = centerY + Math.sin(index * 1.9 + time * Math.PI * 2) * (2 + amount * (compact ? 2 : 4));
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
  const { bendPanel, bendPad, compact } = model;
  const flow = visualBreathFlow;
  const direction = Math.abs(flow) > 0.025 ? Math.sign(flow) : state.breathDirection;
  const directionLabel = direction < 0 ? "DRAW" : "BLOW";
  const directionColor = direction < 0 ? "#69d5dd" : "#f0bd69";
  const available = bendRangeSemitones(state.hole, direction);
  const maximumSemitones = Math.max(1, available * HARMONICA_LIMITS.bend[1]);
  const requestedSemitones = available * state.bend;
  const overbendTarget = harmonicaOverbendTarget(state, state.hole, direction);
  drawViewFrame(
    bendPanel,
    "03",
    "BEND / REEDS",
    `H${state.hole} ${directionLabel} · ${available || 0} STOPS`,
    directionColor,
  );
  drawing.save();
  drawing.fillStyle = "rgba(227, 106, 93, 0.025)";
  drawing.fillRect(bendPad.left, bendPad.top, bendPad.right - bendPad.left, bendPad.bottom - bendPad.top);
  drawing.strokeStyle = "rgba(227, 106, 93, 0.22)";
  drawing.strokeRect(bendPad.left, bendPad.top, bendPad.right - bendPad.left, bendPad.bottom - bendPad.top);
  const railX = bendPad.left + (bendPad.right - bendPad.left) * 0.42;
  drawing.beginPath();
  drawing.moveTo(railX, bendPad.top);
  drawing.lineTo(railX, bendPad.bottom);
  strokePath(directionColor, compact ? 0.8 : 1.2, 0.5);

  if (available > 0) {
    const lastStop = Math.floor(maximumSemitones + 1e-6);
    for (let semitone = 0; semitone <= lastStop; semitone += 1) {
      const y = bendPad.bottom - semitone / maximumSemitones * (bendPad.bottom - bendPad.top);
      const normal = semitone <= available;
      const bendAmount = semitone / available;
      const target = harmonicaReedFrequency({ ...state, bend: bendAmount }, state.hole, direction);
      drawing.beginPath();
      drawing.moveTo(railX - (normal ? 6 : 3), y);
      drawing.lineTo(railX + (normal ? 7 : 4), y);
      strokePath(normal ? directionColor : "#a99bef", normal ? 1.1 : 0.8, normal ? 0.82 : 0.52);
      drawing.fillStyle = normal ? "rgba(216, 223, 220, 0.7)" : "rgba(169, 155, 239, 0.66)";
      drawing.font = `650 ${compact ? 4.5 : 6}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      drawing.textAlign = "left";
      drawing.fillText(`${semitone === 0 ? "OPEN" : `−${semitone}`} ${target.noteName}`, railX + (compact ? 8 : 10), y + 2);
    }
    const requestY = bendPad.bottom - requestedSemitones / maximumSemitones * (bendPad.bottom - bendPad.top);
    drawing.beginPath();
    drawing.arc(railX, requestY, compact ? 3 : 4, 0, Math.PI * 2);
    drawing.fillStyle = requestedSemitones > available ? "#a99bef" : "#e36a5d";
    drawing.fill();
    if (Math.abs(flow) > 0.025 && Number.isFinite(telemetry.bendSemitones)) {
      const actualY = bendPad.bottom - clamp(telemetry.bendSemitones / maximumSemitones) * (bendPad.bottom - bendPad.top);
      drawing.beginPath();
      drawing.moveTo(railX - (compact ? 10 : 15), actualY);
      drawing.lineTo(railX - (compact ? 3 : 5), actualY);
      strokePath("#d8dfdc", compact ? 1 : 1.5, 0.9);
    }
  } else {
    drawing.fillStyle = "rgba(216, 223, 220, 0.62)";
    drawing.font = `650 ${compact ? 5 : 7}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    drawing.textAlign = "center";
    drawing.fillText(`NO NORMAL ${directionLabel} BEND`, (bendPad.left + bendPad.right) * 0.5, (bendPad.top + bendPad.bottom) * 0.5);
  }

  const reedLeft = bendPad.left + 3;
  const reedRight = railX - (compact ? 9 : 14);
  const reedMotion = clamp(telemetry.displacement, -1, 1) * (compact ? 2 : 4);
  drawing.beginPath();
  drawing.moveTo(reedLeft, bendPad.top + (bendPad.bottom - bendPad.top) * 0.28);
  drawing.quadraticCurveTo((reedLeft + reedRight) * 0.5, bendPad.top + 4, reedRight, bendPad.top + (bendPad.bottom - bendPad.top) * 0.28 + reedMotion);
  strokePath("#f0bd69", compact ? 0.8 : 1.2, direction > 0 ? 0.9 : 0.38);
  drawing.beginPath();
  drawing.moveTo(reedLeft, bendPad.bottom - (bendPad.bottom - bendPad.top) * 0.28);
  drawing.quadraticCurveTo((reedLeft + reedRight) * 0.5, bendPad.bottom - 4, reedRight, bendPad.bottom - (bendPad.bottom - bendPad.top) * 0.28 - reedMotion);
  strokePath("#69d5dd", compact ? 0.8 : 1.2, direction < 0 ? 0.9 : 0.38);

  if (overbendTarget.legal) {
    drawing.fillStyle = "rgba(169, 155, 239, 0.72)";
    drawing.font = `650 ${compact ? 4.5 : 6}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    drawing.textAlign = "right";
    drawing.fillText(`OVER ${overbendTarget.noteName}`, bendPanel.right - 6, bendPanel.bottom - 4);
  }
  drawing.restore();
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
  drawHarmonica(model);
  drawMouth(model);
  drawPitchMap(model);
  drawBluesCup(model);
  drawBreathFlow(model);
  drawParameterPad(
    model.airPad,
    "#69d5dd",
    model.compact ? "" : `AIR · ${Math.round(state.breathRateBpm)}/MIN · ${Math.round(state.breathPressure * 100)}%`,
    "RATE",
    "PRESS",
  );
  drawParameterPad(
    model.rhythmPad,
    "#f0bd69",
    model.compact ? "" : `${technique.label.toUpperCase()} · ${state.techniqueRateHz.toFixed(1)} HZ · ${Math.round(state.techniqueAmount * 100)}%`,
    "RATE",
    "AMOUNT",
  );
  drawNode(model.airPad.x, model.airPad.y, "#69d5dd", "AIR", "air", 8);
  drawNode(model.rhythmPad.x, model.rhythmPad.y, "#f0bd69", model.compact ? "PULSE" : "RHYTHM", "rhythm", 8);
  drawNode(model.cupPad.x, model.cupPad.y, "#a99bef", model.compact ? "CUP" : "CLOSE / GROWL", "cup", 7);
  drawNode(model.bendPad.x, model.bendPad.y, "#e36a5d", model.compact ? "" : "BEND / GAP", "bend", 7);
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
      renderedHoleCount,
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
    let bendValue = rangeValue(
      rangeUnit(drag.startValues.bend, HARMONICA_LIMITS.bend) - dy / height,
      HARMONICA_LIMITS.bend,
    );
    const direction = Math.abs(visualBreathFlow) > 0.025
      ? Math.sign(visualBreathFlow)
      : state.breathDirection;
    const available = bendRangeSemitones(state.hole, direction);
    if (available > 0) {
      const semitones = bendValue * available;
      const nearestStop = Math.round(semitones);
      if (Math.abs(semitones - nearestStop) < 0.13) bendValue = nearestStop / available;
    }
    patch = {
      bend: bendValue,
      reedGap: rangeValue(
        rangeUnit(drag.startValues.reedGap, HARMONICA_LIMITS.reedGap) + dx / width,
        HARMONICA_LIMITS.reedGap,
      ),
    };
  } else if (type === "aperture-left" || type === "aperture-right") {
    const deltaHoles = Math.round(dx / Math.max(1, model.holeWidth));
    const maximumWidth = Math.min(5, HARMONICA_LIMITS.chordWidth[1]);
    if (type === "aperture-left") {
      const first = clamp(
        drag.startValues.apertureFirst + deltaHoles,
        Math.max(1, drag.startValues.apertureLast - maximumWidth + 1),
        drag.startValues.apertureLast,
      );
      patch = aperturePatch(first, drag.startValues.apertureLast);
    } else {
      const last = clamp(
        drag.startValues.apertureLast + deltaHoles,
        drag.startValues.apertureFirst,
        Math.min(renderedHoleCount, drag.startValues.apertureFirst + maximumWidth - 1),
      );
      patch = aperturePatch(drag.startValues.apertureFirst, last);
    }
  } else if (type === "embouchure") {
    patch = {
      hole: drag.startValues.hole + dx / Math.max(1, model.holeWidth),
      chordWidth: drag.startValues.chordWidth - dy / Math.max(16, model.combHeight * 0.22),
    };
  } else if (type === "tongue") {
    const width = Math.max(42, model.tonguePad.right - model.tonguePad.left);
    const height = Math.max(42, model.tonguePad.bottom - model.tonguePad.top);
    patch = {
      tongueBlock: drag.startValues.tongueBlock
        + dx / width * (HARMONICA_LIMITS.tongueBlock[1] - HARMONICA_LIMITS.tongueBlock[0]),
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
    const apertureRange = mouthApertureRange();
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
        apertureFirst: apertureRange.first,
        apertureLast: apertureRange.last,
        embouchure: state.embouchure,
        breathPressure: state.breathPressure,
        breathRateBpm: state.breathRateBpm,
        bend: state.bend,
        reedGap: state.reedGap,
        tonguePosition: state.tonguePosition,
        tongueHeight: state.tongueHeight,
        tongueBlock: state.tongueBlock,
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
    else if (drag?.type === "aperture-left" || drag?.type === "aperture-right") {
      announce(`Mouth aperture ${apertureDescription()}`);
    }
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
  const wasdDrawOwner = { type: "keyboard", key: "s" };
  const wasdBlowOwner = { type: "keyboard", key: "w" };
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
      announce("Harmonicazoid stopped");
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
    } else if ((key === "a" || event.key === "ArrowLeft") && !event.shiftKey && !event.repeat) {
      event.preventDefault();
      selectHole(state.hole - 1, { announceChange: true });
    } else if ((key === "d" || event.key === "ArrowRight") && !event.shiftKey && !event.repeat) {
      event.preventDefault();
      selectHole(state.hole + 1, { announceChange: true });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const direction = Math.abs(visualBreathFlow) > 0.025 ? Math.sign(visualBreathFlow) : state.breathDirection;
      const stops = Math.max(1, bendRangeSemitones(state.hole, direction));
      setControl("bend", state.bend + 1 / stops, { announceChange: true });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const direction = Math.abs(visualBreathFlow) > 0.025 ? Math.sign(visualBreathFlow) : state.breathDirection;
      const stops = Math.max(1, bendRangeSemitones(state.hole, direction));
      setControl("bend", state.bend - 1 / stops, { announceChange: true });
    } else if (event.key === "-") {
      event.preventDefault();
      setControl("chordWidth", state.chordWidth - 1, { announceChange: true });
    } else if (["=", "+"].includes(event.key)) {
      event.preventDefault();
      setControl("chordWidth", state.chordWidth + 1, { announceChange: true });
    } else if (event.shiftKey && "aeiou".includes(key) && !event.repeat) {
      event.preventDefault();
      loadVowel(key);
    } else if (["e", "i", "o", "u"].includes(key) && !event.repeat) {
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
    } else if (key === "s" && !event.repeat) {
      event.preventDefault();
      void beginManualBreath(-1, wasdDrawOwner);
    } else if (key === "w" && !event.repeat) {
      event.preventDefault();
      void beginManualBreath(1, wasdBlowOwner);
    } else if (key === "x" && !event.repeat) {
      event.preventDefault();
      cancelManualBreath({ present: false });
      state = sanitizeHarmonicaState({ ...state, autoBreath: false }, state);
      commandedBreathFlow = 0;
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      postConfiguration();
      updatePresentation();
      announce("Harmonicazoid air stopped");
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "[") endManualBreath(-1, drawOwner);
    if (event.key === "]") endManualBreath(1, blowOwner);
    if (event.key.toLowerCase() === "s") endManualBreath(-1, wasdDrawOwner);
    if (event.key.toLowerCase() === "w") endManualBreath(1, wasdBlowOwner);
  });
}

let midiBreath = null;

function nearestReedForMidi(note) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (let hole = 1; hole <= renderedHoleCount; hole += 1) {
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
    const chordNames = harmonicaActiveReeds(state, flow)
      .filter(({ hole }) => (
        hole === state.hole
        || state.tongueBlock < 0.94
        || state.bluesTechniqueId === "octave-tongue-block"
      ))
      .map(({ noteName }) => noteName)
      .join(" + ");
    $("noteReadout").textContent = overbendSpeaking
      ? `${direction < 0 ? "overdraw" : "overblow"} ${overbendTarget.noteName} · ${formatFrequency(frequency)}`
      : state.chordWidth > 1
      ? `${direction < 0 ? "draw" : "blow"} ${chordNames} · ${formatFrequency(frequency)} centroid`
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
