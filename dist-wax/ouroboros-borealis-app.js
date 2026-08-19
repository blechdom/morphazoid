import {
  OUROBOROS_BOREALIS_DEFAULTS,
  OUROBOROS_BOREALIS_PHASE_SEED,
  OUROBOROS_BOREALIS_PRESETS,
  OuroborosBorealisAudio,
  advanceOuroborosBorealisCoordinates,
  calculateOuroborosBorealisFrame,
  sanitizeOuroborosBorealisParams,
} from "./src/ouroboros-borealis.js";

const $ = (id) => document.getElementById(id);
const audio = new OuroborosBorealisAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const TAU = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const STRIKE_HISTORY_SECONDS = 2.8;
const MAX_STRIKE_EVENTS = 512;
const DRAW_INTERVAL = 1_000 / 30;
const REDUCED_DRAW_INTERVAL = 1_000 / 5;
const PARAMETER_KEYS = Object.freeze([
  "pitchDirection",
  "rhythmDirection",
  "pitchGlissRate",
  "rhythmGlissRate",
  "centerPitch",
  "centerRate",
  "pitchWidth",
  "rhythmWidth",
  "pitchInterval",
  "rhythmInterval",
  "phaseOffset",
  "coupling",
  "couplingFocus",
  "spread",
  "decay",
  "character",
  "morphDepth",
  "noiseMix",
  "cutoff",
]);

function clamp(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

function directionSign(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback < 0 ? -1 : 1;
  return numeric < 0 ? -1 : 1;
}

function compactNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toFixed(digits).replace(/\.?0+$/, "");
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  if (frequency >= 1_000) return `${compactNumber(frequency / 1_000, 2)} kHz`;
  return `${compactNumber(frequency, frequency >= 100 ? 0 : 1)} Hz`;
}

function formatDecay(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return seconds < 1 ? `${Math.round(seconds * 1_000)} ms` : `${compactNumber(seconds, 2)} s`;
}

function formatRate(value) {
  const rate = Math.max(0, Number(value) || 0);
  return `${compactNumber(rate, 2)} hits/s · ${Math.round(rate * 60)} BPM`;
}

function formatInterval(value, suffix) {
  const interval = clamp(value, 0.5, 2);
  return `${interval.toFixed(2)} oct · ${(2 ** interval).toFixed(2)}${suffix}`;
}

function characterLabel(value) {
  const amount = clamp(value, 0, 1);
  if (amount < 0.2) return "Deep skin";
  if (amount < 0.43) return "Kick / tom";
  if (amount < 0.68) return "Tom / hand";
  if (amount < 0.88) return "Dry rattle";
  return "Bright air";
}

function morphLabel(value) {
  const amount = clamp(value, 0, 1);
  if (amount < 0.08) return "Fixed";
  if (amount > 0.92) return "Full";
  return "Partial";
}

function couplingLabel(value) {
  const amount = clamp(value, -1, 1);
  if (amount < -0.78) return "Fast → low";
  if (amount < -0.18) return `${Math.round(Math.abs(amount) * 100)}% fast → low`;
  if (amount > 0.78) return "Fast → high";
  if (amount > 0.18) return `${Math.round(amount * 100)}% fast → high`;
  return "Independent";
}

function focusLabel(value) {
  const amount = clamp(value, 0, 1);
  if (amount < 0.35) return "Broad";
  if (amount > 0.65) return "Tight";
  return "Balanced";
}

function phaseLabel(value) {
  const phase = clamp(value, 0, 1);
  return `${phase.toFixed(2)} cycle · ${Math.round(phase * 360)}°`;
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function showAudioError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function createMemory(preset = OUROBOROS_BOREALIS_PRESETS[0] ?? OUROBOROS_BOREALIS_DEFAULTS) {
  const safe = sanitizeOuroborosBorealisParams({
    ...OUROBOROS_BOREALIS_DEFAULTS,
    ...preset,
  });
  const memory = { presetId: preset?.id ?? null };
  for (const key of PARAMETER_KEYS) memory[key] = safe[key];
  memory.pitchDirection = directionSign(safe.pitchDirection, 1);
  memory.rhythmDirection = directionSign(safe.rhythmDirection, -1);
  return memory;
}

const initialSafe = sanitizeOuroborosBorealisParams(OUROBOROS_BOREALIS_DEFAULTS);
const seed = Number.isFinite(OUROBOROS_BOREALIS_PHASE_SEED)
  ? OUROBOROS_BOREALIS_PHASE_SEED
  : 0.31;
const state = {
  parameters: createMemory(),
  level: initialSafe.level,
  audioOn: false,
  audioStarting: false,
  pitchPosition: wrapUnit(seed),
  rhythmPosition: wrapUnit(seed),
  pitchTravel: 0,
  rhythmTravel: 0,
  pulsePhase: seed,
  pointerLane: null,
  pointerPosition: null,
};

let disposed = false;
let animationFrame = 0;
let lastAnimationTime = 0;
let lastAudioVisualTime = null;
let lastDrawTime = -Infinity;
let visualizationDirty = true;
let canvasWidth = 1;
let canvasHeight = 1;
let canvasScale = 1;
let audioStartPromise = null;
let audioStartGeneration = 0;
let strikeEvents = [];
let activeTrackPointer = null;
let lastPointerPosition = null;
let lastPointerStrikeTime = -Infinity;
let pendingTrackStrike = null;
let trackStrikePromise = null;
const rhythmVisualPhases = new Map();

function shiftRhythmVisualPhases(delta) {
  const shift = Number(delta);
  if (!Number.isFinite(shift) || Math.abs(shift) < 1e-12) return;
  for (const [key, phase] of rhythmVisualPhases) {
    rhythmVisualPhases.set(key, wrapUnit(phase + shift));
  }
}

function rotateRhythmVisualPhases(wraps) {
  const offset = Math.trunc(Number(wraps) || 0);
  if (offset === 0 || rhythmVisualPhases.size === 0) return;
  const rotated = [];
  for (const [key, phase] of rhythmVisualPhases) {
    const nextKey = key + offset;
    if (nextKey >= 0 && nextKey < 21) rotated.push([nextKey, phase]);
  }
  rhythmVisualPhases.clear();
  for (const [key, phase] of rotated) rhythmVisualPhases.set(key, phase);
}

function currentParameters() {
  return sanitizeOuroborosBorealisParams({
    ...state.parameters,
    level: state.level,
  });
}

function currentFrame() {
  return calculateOuroborosBorealisFrame({
    ...currentParameters(),
    pitchPosition: state.pitchPosition,
    rhythmPosition: state.rhythmPosition,
    sampleRate: audio.context?.sampleRate ?? DEFAULT_SAMPLE_RATE,
  });
}

function selectedPreset() {
  return OUROBOROS_BOREALIS_PRESETS.find(({ id }) => id === state.parameters.presetId) ?? null;
}

function presetLabel(preset) {
  return preset?.label ?? preset?.name ?? preset?.id ?? "Preset";
}

function presetDetail(preset) {
  if (preset?.description) return preset.description;
  const safe = sanitizeOuroborosBorealisParams({ ...OUROBOROS_BOREALIS_DEFAULTS, ...preset });
  const pitch = safe.pitchDirection > 0 ? "pitch ↑" : "pitch ↓";
  const rhythm = safe.rhythmDirection > 0 ? "rhythm ↗" : "rhythm ↘";
  return `${pitch} · ${rhythm}`;
}

function renderPresetGrid() {
  const grid = $("presetGrid");
  grid.replaceChildren();
  for (const preset of OUROBOROS_BOREALIS_PRESETS) {
    const button = document.createElement("button");
    const title = document.createElement("b");
    const detail = document.createElement("small");
    button.type = "button";
    button.dataset.preset = preset.id;
    setPressed(button, preset.id === state.parameters.presetId);
    title.textContent = presetLabel(preset);
    detail.textContent = presetDetail(preset);
    button.append(title, detail);
    grid.append(button);
  }
}

function updateAudioParameters() {
  audio.setParameters(currentParameters());
}

function updateInterface({ rebuildPresets = false } = {}) {
  const safe = currentParameters();
  const pitchRising = safe.pitchDirection > 0;
  const rhythmAccelerating = safe.rhythmDirection > 0;
  let frame = null;
  try {
    frame = currentFrame();
  } catch {
    // Keep the interface usable while an unavailable AudioWorklet is initializing.
  }

  setPressed($("pitchRise"), pitchRising);
  setPressed($("pitchFall"), !pitchRising);
  setPressed($("rhythmAccelerate"), rhythmAccelerating);
  setPressed($("rhythmDecelerate"), !rhythmAccelerating);
  setPressed($("audioButton"), state.audioOn);
  setPressed($("transportButton"), state.audioOn);

  $("audioButton").disabled = state.audioStarting;
  $("transportButton").disabled = state.audioStarting;
  $("strikeButton").disabled = state.audioStarting;
  $("audioButton").dataset.audioState = state.audioStarting ? "starting" : state.audioOn ? "on" : "off";
  $("audioButton").setAttribute("aria-label", state.audioOn ? "Stop Ouroboros Borealis" : "Start Ouroboros Borealis");
  $("audioAction").textContent = state.audioOn ? "Stop" : "Start";
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("transportIcon").textContent = state.audioStarting ? "…" : state.audioOn ? "■" : "▶";
  $("transportLabel").textContent = state.audioStarting ? "Starting" : state.audioOn ? "Stop" : "Start";
  $("transportButton").setAttribute(
    "aria-label",
    state.audioOn
      ? "Stop automatic Ouroboros Borealis motion and strikes"
      : "Start automatic Ouroboros Borealis motion and strikes",
  );

  for (const key of PARAMETER_KEYS) {
    const control = $(key);
    if (control) control.value = String(safe[key]);
  }
  $("level").value = String(safe.level);

  $("pitchGlissRateOut").textContent = `${safe.pitchGlissRate.toFixed(2)} oct/s · wraps in ${compactNumber(safe.pitchInterval / safe.pitchGlissRate, 1)} s`;
  $("centerPitchOut").textContent = formatFrequency(safe.centerPitch);
  $("pitchWidthOut").textContent = `${safe.pitchWidth.toFixed(1)} octaves`;
  $("pitchIntervalOut").textContent = formatInterval(safe.pitchInterval, ":1");
  $("rhythmGlissRateOut").textContent = `${safe.rhythmGlissRate.toFixed(2)} oct/s · wraps in ${compactNumber(safe.rhythmInterval / safe.rhythmGlissRate, 1)} s`;
  $("centerRateOut").textContent = formatRate(safe.centerRate);
  $("rhythmWidthOut").textContent = `${safe.rhythmWidth.toFixed(1)} octaves`;
  $("rhythmIntervalOut").textContent = formatInterval(safe.rhythmInterval, "×");
  $("phaseOffsetOut").textContent = phaseLabel(safe.phaseOffset);
  $("couplingOut").textContent = couplingLabel(safe.coupling);
  $("couplingFocusOut").textContent = focusLabel(safe.couplingFocus);
  $("spreadOut").textContent = `${Math.round(safe.spread * 100)}%`;
  $("decayOut").textContent = formatDecay(safe.decay);
  $("characterOut").textContent = characterLabel(safe.character);
  $("morphDepthOut").textContent = `${morphLabel(safe.morphDepth)} · ${Math.round(safe.morphDepth * 100)}%`;
  $("noiseMixOut").textContent = `${Math.round(safe.noiseMix * 100)}%`;
  $("cutoffOut").textContent = formatFrequency(safe.cutoff);
  $("levelOut").textContent = `${Math.round(safe.level * 100)}%`;

  const activePitch = frameActiveCount(frame, "pitch");
  const activeRhythm = frameActiveCount(frame, "rhythm");
  $("engineSummary").textContent = activePitch > 0 && activeRhythm > 0
    ? `${activePitch} pitch bodies × ${activeRhythm} rhythm lanes`
    : "pitch × rhythm Shepard field";
  $("pitchSummary").textContent = `${pitchRising ? "rise" : "fall"} · ${safe.pitchGlissRate.toFixed(2)} oct/s · ${safe.pitchInterval.toFixed(2)} oct voices`;
  $("rhythmSummary").textContent = `${rhythmAccelerating ? "speed up" : "slow down"} · ${safe.rhythmGlissRate.toFixed(2)} oct/s · ${compactNumber(safe.centerRate, 2)} hits/s center`;
  $("relationshipSummary").textContent = `${couplingLabel(safe.coupling).toLowerCase()} · ${phaseLabel(safe.phaseOffset)}`;
  $("soundSummary").textContent = `${morphLabel(safe.morphDepth).toLowerCase()} morph · ${characterLabel(safe.character).toLowerCase()}`;
  $("pitchLegend").textContent = pitchRising ? "rising" : "falling";
  $("rhythmLegend").textContent = rhythmAccelerating ? "speeding" : "slowing";
  $("stageReadout").textContent = [
    `PITCH ${pitchRising ? "RISING" : "FALLING"}`,
    `RHYTHM ${rhythmAccelerating ? "SPEEDING UP" : "SLOWING DOWN"}`,
    couplingLabel(safe.coupling).toUpperCase(),
    `${safe.pitchInterval.toFixed(2)} / ${safe.rhythmInterval.toFixed(2)} OCT INTERVALS`,
    state.audioOn ? "PLAYING" : "STOPPED",
  ].join(" · ");
  canvas.setAttribute(
    "aria-label",
    `Two interactive endless racetracks. Pitch is ${pitchRising ? "rising" : "falling"} at ${safe.pitchGlissRate.toFixed(2)} octaves per second. Rhythm is ${rhythmAccelerating ? "speeding up" : "slowing down"} at ${safe.rhythmGlissRate.toFixed(2)} octaves per second around ${formatRate(safe.centerRate)}. ${couplingLabel(safe.coupling)}. Drag either racetrack to strike it.`,
  );

  const preset = selectedPreset();
  $("presetSummary").textContent = preset ? presetLabel(preset) : "Custom";
  if (rebuildPresets) renderPresetGrid();
  else {
    for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
      setPressed(button, button.dataset.preset === state.parameters.presetId);
    }
  }

  updateAudioParameters();
  visualizationDirty = true;
  scheduleAnimation();
}

function markCustom() {
  state.parameters.presetId = null;
}

function synchronizeVisualClock() {
  if (!state.audioOn) return;
  const audioTime = Number(audio.context?.currentTime);
  if (!Number.isFinite(audioTime) || lastAudioVisualTime === null) return;
  advanceVisualState(Math.max(0, audioTime - lastAudioVisualTime));
  lastAudioVisualTime = audioTime;
}

function applyPreset(id) {
  const preset = OUROBOROS_BOREALIS_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  synchronizeVisualClock();
  const priorPhaseOffset = Number(state.parameters.phaseOffset) || 0;
  const safe = sanitizeOuroborosBorealisParams({ ...OUROBOROS_BOREALIS_DEFAULTS, ...preset });
  state.parameters = createMemory(preset);
  shiftRhythmVisualPhases(safe.phaseOffset - priorPhaseOffset);
  state.level = safe.level;
  updateInterface({ rebuildPresets: true });
  announce(`${presetLabel(preset)} preset loaded.`);
}

$("presetGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (button) applyPreset(button.dataset.preset);
});

function setDirection(kind, value) {
  synchronizeVisualClock();
  const direction = directionSign(value, kind === "pitch" ? 1 : -1);
  state.parameters[`${kind}Direction`] = direction;
  markCustom();
  updateInterface();
  announce(
    kind === "pitch"
      ? `Pitch now ${direction > 0 ? "rises" : "falls"} endlessly.`
      : `Rhythm now ${direction > 0 ? "speeds up" : "slows down"} endlessly.`,
  );
}

$("pitchDirection").addEventListener("click", (event) => {
  const button = event.target.closest("[data-value]");
  if (button) setDirection("pitch", button.dataset.value);
});

$("rhythmDirection").addEventListener("click", (event) => {
  const button = event.target.closest("[data-value]");
  if (button) setDirection("rhythm", button.dataset.value);
});

function bindRange(id, onInput) {
  $(id).addEventListener("input", (event) => {
    synchronizeVisualClock();
    onInput(Number(event.currentTarget.value));
    updateInterface();
  });
}

for (const key of PARAMETER_KEYS.filter((key) => !key.endsWith("Direction") && key !== "phaseOffset")) {
  bindRange(key, (value) => {
    state.parameters[key] = value;
    markCustom();
  });
}

bindRange("phaseOffset", (value) => {
  const prior = Number(state.parameters.phaseOffset) || 0;
  state.parameters.phaseOffset = value;
  shiftRhythmVisualPhases(value - prior);
  markCustom();
});

bindRange("level", (value) => {
  state.level = value;
});

async function startAudio() {
  if (state.audioOn) return true;
  if (audioStartPromise) return audioStartPromise;
  state.audioStarting = true;
  clearAudioError();
  updateInterface();
  const generation = audioStartGeneration;
  const startPromise = (async () => {
    try {
      updateAudioParameters();
      await audio.start();
      if (disposed || generation !== audioStartGeneration) {
        if (disposed) await audio.close();
        else audio.stop();
        return false;
      }
      state.audioOn = true;
      lastAnimationTime = performance.now();
      lastAudioVisualTime = Number.isFinite(audio.context?.currentTime)
        ? audio.context.currentTime
        : null;
      announce("Ouroboros Borealis started.");
      return true;
    } catch (error) {
      state.audioOn = false;
      showAudioError(error);
      announce("Ouroboros Borealis audio could not start.");
      return false;
    } finally {
      if (audioStartPromise === startPromise) {
        state.audioStarting = false;
        audioStartPromise = null;
        updateInterface();
      }
    }
  })();
  audioStartPromise = startPromise;
  return startPromise;
}

async function toggleAudio() {
  if (state.audioStarting) return;
  if (state.audioOn) {
    synchronizeVisualClock();
    audio.stop();
    state.audioOn = false;
    lastAudioVisualTime = null;
    updateInterface();
    announce("Ouroboros Borealis stopped.");
    return;
  }
  await startAudio();
}

$("audioButton").addEventListener("click", toggleAudio);
$("transportButton").addEventListener("click", toggleAudio);

function addStrikeEvent(velocity = 0.86, position = null, lane = "both", age = 0) {
  const safePosition = position === null ? null : wrapUnit(position);
  strikeEvents.push({
    age,
    lane,
    velocity: clamp(velocity, 0, 1),
    strength: 1,
    pitchPosition: safePosition ?? state.pitchPosition,
    rhythmPosition: lane === "rhythm" && safePosition !== null
      ? safePosition
      : state.rhythmPosition,
    pitchTravelAtStrike: state.pitchTravel,
    rhythmTravelAtStrike: state.rhythmTravel,
  });
  if (strikeEvents.length > MAX_STRIKE_EVENTS) {
    strikeEvents.splice(0, strikeEvents.length - MAX_STRIKE_EVENTS);
  }
  visualizationDirty = true;
}

function addLayerStrike(layer, safe, age = 0) {
  const rhythmPosition = clamp(
    0.5 + Number(layer.normalizedPosition ?? 0) * 0.5,
    0,
    1,
  );
  const couplingPolarity = safe.coupling < 0 ? 1 - rhythmPosition : rhythmPosition;
  const pitchPositionNow = wrapUnit(
    state.pitchPosition
      + (couplingPolarity - 0.5) * Math.abs(safe.coupling),
  );
  const pitchPhaseRewind = safe.pitchDirection * safe.pitchGlissRate * age / safe.pitchInterval;
  const rhythmPhaseRewind = safe.rhythmDirection * safe.rhythmGlissRate * age / safe.rhythmInterval;
  const weight = clamp(Number(layer.weight ?? layer.gain) || 0, 0, 1);
  strikeEvents.push({
    age,
    lane: "both",
    velocity: 0.42 + Math.sqrt(weight) * 0.38,
    strength: 0.22 + Math.sqrt(weight) * 0.78,
    pitchPosition: wrapUnit(pitchPositionNow - pitchPhaseRewind),
    rhythmPosition: wrapUnit(rhythmPosition - rhythmPhaseRewind),
    pitchTravelAtStrike: state.pitchTravel - safe.pitchDirection * safe.pitchGlissRate * age,
    rhythmTravelAtStrike: state.rhythmTravel - safe.rhythmDirection * safe.rhythmGlissRate * age,
  });
  if (strikeEvents.length > MAX_STRIKE_EVENTS) {
    strikeEvents.splice(0, strikeEvents.length - MAX_STRIKE_EVENTS);
  }
  visualizationDirty = true;
}

function flashStrikeButton() {
  const button = $("strikeButton");
  button.classList.add("is-striking");
  globalThis.setTimeout?.(() => button.classList.remove("is-striking"), 85);
}

async function strikeCurrentField(velocity = 0.9) {
  if (!await startAudio()) return false;
  const struck = audio.strike(velocity);
  if (!struck) return false;
  addStrikeEvent(velocity);
  flashStrikeButton();
  scheduleAnimation();
  announce("Ouroboros Borealis struck across its pitch and rhythm field.");
  return true;
}

function strikeTrackPosition(lane, position, velocity = 0.8) {
  pendingTrackStrike = {
    lane,
    position: wrapUnit(position),
    velocity: clamp(velocity, 0, 1),
  };
  if (trackStrikePromise) return trackStrikePromise;
  const promise = (async () => {
    if (!await startAudio()) {
      pendingTrackStrike = null;
      return false;
    }
    let struck = false;
    while (pendingTrackStrike) {
      const audition = pendingTrackStrike;
      pendingTrackStrike = null;
      if (audio.strike(audition.velocity, audition.position)) {
        addStrikeEvent(audition.velocity, audition.position, audition.lane);
        struck = true;
      }
    }
    if (struck) {
      flashStrikeButton();
      scheduleAnimation();
    }
    return struck;
  })().finally(() => {
    if (trackStrikePromise === promise) trackStrikePromise = null;
  });
  trackStrikePromise = promise;
  return promise;
}

$("strikeButton").addEventListener("click", () => {
  void strikeCurrentField();
});

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  synchronizeVisualClock();
  const priorPhaseOffset = Number(state.parameters.phaseOffset) || 0;
  state.parameters = createMemory();
  shiftRhythmVisualPhases(initialSafe.phaseOffset - priorPhaseOffset);
  state.level = initialSafe.level;
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce("Ouroboros Borealis parameters reset.");
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    setDirection("pitch", event.key === "ArrowUp" ? 1 : -1);
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    setDirection("rhythm", event.key === "ArrowRight" ? 1 : -1);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) void strikeCurrentField();
  } else if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    if (!event.repeat) void toggleAudio();
  }
});

function signedSuperellipsePower(value, power) {
  return Math.sign(value) * Math.abs(value) ** power;
}

function trackGeometry(width, height) {
  const compact = width < 640;
  const centerX = width * 0.5;
  const centerY = height * (compact ? 0.44 : 0.46);
  const availableWidth = Math.max(160, width - (compact ? 54 : 100));
  const availableHeight = Math.max(112, height - (compact ? 114 : 142));
  const pitchRadiusX = Math.max(72, availableWidth * 0.45);
  const pitchRadiusY = Math.max(50, Math.min(availableHeight * 0.38, pitchRadiusX * 0.47));
  const separation = clamp(pitchRadiusY * 0.28, 20, 42);
  const rhythmRadiusX = Math.max(50, pitchRadiusX - separation * 1.28);
  const rhythmRadiusY = Math.max(29, pitchRadiusY - separation);
  const trackWidth = clamp(separation * 0.38, 9, 18);
  return {
    centerX,
    centerY,
    pitchRadiusX,
    pitchRadiusY,
    rhythmRadiusX,
    rhythmRadiusY,
    separation,
    trackWidth,
  };
}

function pointOnTrack(lane, normalized, geometry, radialOffset = 0) {
  const phase = wrapUnit(normalized);
  const angle = -Math.PI * 0.5 + phase * TAU;
  const radiusX = (lane === "pitch" ? geometry.pitchRadiusX : geometry.rhythmRadiusX) + radialOffset;
  const radiusY = (lane === "pitch" ? geometry.pitchRadiusY : geometry.rhythmRadiusY) + radialOffset * 0.68;
  const power = 2 / 3.5;
  const calculate = (sampleAngle) => ({
    x: signedSuperellipsePower(Math.cos(sampleAngle), power) * radiusX,
    y: signedSuperellipsePower(Math.sin(sampleAngle), power) * radiusY,
  });
  const point = calculate(angle);
  const before = calculate(angle - 0.001);
  const after = calculate(angle + 0.001);
  return {
    x: geometry.centerX + point.x,
    y: geometry.centerY + point.y,
    tangentAngle: Math.atan2(after.y - before.y, after.x - before.x),
  };
}

function trackPositionFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = clamp(event.clientX - bounds.left, 0, Math.max(1, bounds.width));
  const y = clamp(event.clientY - bounds.top, 0, Math.max(1, bounds.height));
  const geometry = trackGeometry(Math.max(1, bounds.width), Math.max(1, bounds.height));
  let closest = { lane: "pitch", position: 0, distance: Infinity };
  const sampleCount = 192;
  for (const lane of ["pitch", "rhythm"]) {
    for (let index = 0; index < sampleCount; index += 1) {
      const position = index / sampleCount;
      const point = pointOnTrack(lane, position, geometry);
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < closest.distance) closest = { lane, position, distance };
    }
  }
  return closest;
}

function trackDistance(first, second) {
  const direct = Math.abs(first - second);
  return Math.min(direct, 1 - direct);
}

function releaseTrackPointer(event) {
  if (activeTrackPointer === null || event.pointerId !== activeTrackPointer) return;
  try {
    canvas.releasePointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture may already be released during cancellation.
  }
  activeTrackPointer = null;
  lastPointerPosition = null;
  state.pointerLane = null;
  state.pointerPosition = null;
  $("stageWrap").classList.remove("is-auditioning");
  visualizationDirty = true;
  scheduleAnimation();
}

function cancelTrackInteraction() {
  activeTrackPointer = null;
  lastPointerPosition = null;
  pendingTrackStrike = null;
  state.pointerLane = null;
  state.pointerPosition = null;
  $("stageWrap").classList.remove("is-auditioning");
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false) return;
  event.preventDefault();
  canvas.focus?.();
  activeTrackPointer = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);
  $("stageWrap").classList.add("is-auditioning");
  const target = trackPositionFromPointer(event);
  state.pointerLane = target.lane;
  state.pointerPosition = target.position;
  lastPointerPosition = target.position;
  lastPointerStrikeTime = performance.now();
  visualizationDirty = true;
  scheduleAnimation();
  void strikeTrackPosition(target.lane, target.position, 0.84);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activeTrackPointer) return;
  event.preventDefault();
  const target = trackPositionFromPointer(event);
  const movement = trackDistance(target.position, lastPointerPosition ?? target.position);
  state.pointerLane = target.lane;
  state.pointerPosition = target.position;
  visualizationDirty = true;
  scheduleAnimation();
  const now = performance.now();
  if (movement >= 0.008 && now - lastPointerStrikeTime >= 32) {
    const pressure = Number.isFinite(event.pressure) ? event.pressure : 0.5;
    const velocity = clamp(0.55 + movement * 4 + pressure * 0.18, 0.55, 0.96);
    lastPointerPosition = target.position;
    lastPointerStrikeTime = now;
    void strikeTrackPosition(target.lane, target.position, velocity);
  }
});

canvas.addEventListener("pointerup", releaseTrackPointer);
canvas.addEventListener("pointercancel", releaseTrackPointer);

function mixColor(first, second, amount, alpha = 1) {
  const mix = clamp(amount, 0, 1);
  const channels = first.map((channel, index) => Math.round(channel + (second[index] - channel) * mix));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

const PITCH_LOW = Object.freeze([126, 231, 220]);
const PITCH_HIGH = Object.freeze([157, 240, 158]);
const RHYTHM_LOW = Object.freeze([180, 152, 255]);
const RHYTHM_HIGH = Object.freeze([255, 145, 205]);

function laneColor(lane, position, alpha = 1) {
  return lane === "pitch"
    ? mixColor(PITCH_LOW, PITCH_HIGH, position, alpha)
    : mixColor(RHYTHM_LOW, RHYTHM_HIGH, position, alpha);
}

function drawAurora(ctx, geometry, safe) {
  const ribbonCount = reducedMotion ? 2 : 4;
  ctx.save();
  ctx.lineCap = "round";
  for (const lane of ["pitch", "rhythm"]) {
    const travel = lane === "pitch" ? state.pitchTravel : state.rhythmTravel;
    for (let ribbon = 0; ribbon < ribbonCount; ribbon += 1) {
      ctx.beginPath();
      const segments = 128;
      for (let index = 0; index <= segments; index += 1) {
        const position = index / segments;
        const wave = Math.sin(TAU * (position * (2 + ribbon * 0.35) + travel * 0.13 + ribbon * 0.19));
        const offset = (ribbon - (ribbonCount - 1) * 0.5) * 3.5 + wave * (4 + ribbon * 1.2);
        const point = pointOnTrack(lane, position, geometry, offset);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.strokeStyle = laneColor(lane, ribbon / Math.max(1, ribbonCount - 1), 0.08 + ribbon * 0.022);
      ctx.lineWidth = geometry.trackWidth * (0.48 + ribbon * 0.16);
      ctx.stroke();
    }
  }

  if (Math.abs(safe.coupling) > 0.02) {
    const rayCount = Math.max(3, Math.round(3 + Math.abs(safe.coupling) * 9));
    for (let index = 0; index < rayCount; index += 1) {
      const position = wrapUnit(index / rayCount + state.pitchTravel * 0.03);
      const pitch = pointOnTrack("pitch", position, geometry);
      const rhythm = pointOnTrack(
        "rhythm",
        wrapUnit(position + safe.phaseOffset * Math.sign(safe.coupling || 1)),
        geometry,
      );
      ctx.beginPath();
      ctx.moveTo(pitch.x, pitch.y);
      ctx.lineTo(rhythm.x, rhythm.y);
      ctx.strokeStyle = `rgba(214, 232, 226, ${0.025 + Math.abs(safe.coupling) * 0.11})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawTrack(ctx, lane, geometry, travel) {
  const segments = 128;
  ctx.save();
  ctx.lineCap = "butt";
  for (let index = 0; index < segments; index += 1) {
    const start = index / segments;
    const end = (index + 1.07) / segments;
    const first = pointOnTrack(lane, start, geometry);
    const second = pointOnTrack(lane, end, geometry);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    ctx.strokeStyle = "rgba(2, 5, 7, 0.93)";
    ctx.lineWidth = geometry.trackWidth + 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    const pulse = 0.5 + Math.sin(TAU * (start * 7 - travel * 0.28)) * 0.5;
    ctx.strokeStyle = laneColor(lane, start, 0.25 + pulse * 0.35);
    ctx.lineWidth = geometry.trackWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function layerArray(frame, lane) {
  const layers = lane === "pitch" ? frame?.pitchLayers : frame?.rhythmLayers;
  return Array.isArray(layers) ? layers : [];
}

function frameActiveCount(frame, lane) {
  const candidates = lane === "pitch"
    ? [
        frame?.pitchActiveLayers,
        frame?.activePitchLayers,
        frame?.activePitchCount,
        frame?.pitchActiveCount,
      ]
    : [
        frame?.rhythmActiveLayers,
        frame?.activeRhythmLayers,
        frame?.activeRhythmCount,
        frame?.rhythmActiveCount,
      ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.length;
    const count = Number(candidate);
    if (Number.isFinite(count)) return Math.max(0, Math.round(count));
  }
  return layerArray(frame, lane).filter((layer) => layer.active !== false).length;
}

function drawLayerNodes(ctx, lane, geometry, frame) {
  const layers = layerArray(frame, lane).filter((layer) => layer.active !== false && Number(layer.weight ?? layer.gain) > 1e-7);
  const maximum = Math.max(1e-7, ...layers.map((layer) => Number(layer.weight ?? layer.gain) || 0));
  ctx.save();
  for (const layer of layers) {
    const normalized = clamp(
      0.5 + Number(layer.normalizedPosition ?? 0) * 0.5,
      0,
      1,
    );
    const point = pointOnTrack(lane, normalized, geometry);
    const strength = clamp(Number(layer.weight ?? layer.gain) / maximum, 0, 1);
    const radius = 1.4 + strength * 3.2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, TAU);
    ctx.fillStyle = laneColor(lane, normalized, 0.3 + strength * 0.65);
    ctx.fill();
    ctx.strokeStyle = "rgba(2, 5, 7, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawStrikeGlyph(ctx, lane, point, velocity, life, strength = 1) {
  const size = 3.5 + velocity * 5.5;
  ctx.save();
  ctx.translate(Math.round(point.x) + 0.5, Math.round(point.y) + 0.5);
  ctx.rotate(point.tangentAngle);
  ctx.globalAlpha = (0.16 + life * 0.84) * clamp(strength, 0.12, 1);
  ctx.strokeStyle = laneColor(lane, life, 1);
  ctx.fillStyle = laneColor(lane, 1 - life, 0.72);
  ctx.lineWidth = 1.4;
  if (lane === "pitch") {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.62, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.2, size * 0.18), 0, TAU);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.42);
    ctx.lineTo(size, -size * 0.42);
    ctx.moveTo(-size * 0.66, size * 0.42);
    ctx.lineTo(size * 0.66, size * 0.42);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStrikeHistory(ctx, geometry, safe) {
  for (const strike of strikeEvents) {
    const life = clamp(1 - strike.age / STRIKE_HISTORY_SECONDS, 0, 1);
    if (strike.lane !== "rhythm") {
      const movement = (state.pitchTravel - strike.pitchTravelAtStrike) / safe.pitchInterval;
      const point = pointOnTrack("pitch", wrapUnit(strike.pitchPosition + movement), geometry);
      drawStrikeGlyph(ctx, "pitch", point, strike.velocity, life, strike.strength);
    }
    if (strike.lane !== "pitch") {
      const movement = (state.rhythmTravel - strike.rhythmTravelAtStrike) / safe.rhythmInterval;
      const point = pointOnTrack("rhythm", wrapUnit(strike.rhythmPosition + movement), geometry);
      drawStrikeGlyph(ctx, "rhythm", point, strike.velocity, life, strike.strength);
    }
  }
}

function drawPlayhead(ctx, lane, position, direction, geometry) {
  const point = pointOnTrack(lane, position, geometry);
  const tangentX = Math.cos(point.tangentAngle) * direction;
  const tangentY = Math.sin(point.tangentAngle) * direction;
  const normalX = -Math.sin(point.tangentAngle);
  const normalY = Math.cos(point.tangentAngle);
  const size = Math.max(7, geometry.trackWidth * 0.72);
  ctx.save();
  ctx.shadowColor = laneColor(lane, 0.5, 0.86);
  ctx.shadowBlur = 13;
  ctx.fillStyle = laneColor(lane, 0.55, 1);
  ctx.strokeStyle = "rgba(232, 255, 250, 0.96)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (lane === "pitch") {
    ctx.moveTo(point.x + tangentX * size, point.y + tangentY * size);
    ctx.lineTo(point.x - tangentX * size * 0.55 + normalX * size * 0.68, point.y - tangentY * size * 0.55 + normalY * size * 0.68);
    ctx.lineTo(point.x - tangentX * size * 0.55 - normalX * size * 0.68, point.y - tangentY * size * 0.55 - normalY * size * 0.68);
  } else {
    ctx.moveTo(point.x + tangentX * size, point.y + tangentY * size);
    ctx.lineTo(point.x + normalX * size * 0.72, point.y + normalY * size * 0.72);
    ctx.lineTo(point.x - tangentX * size, point.y - tangentY * size);
    ctx.lineTo(point.x - normalX * size * 0.72, point.y - normalY * size * 0.72);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLabels(ctx, geometry, safe) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(214, 232, 226, 0.34)";
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText("PITCH SHEPARD COIL", geometry.centerX, geometry.centerY - 7);
  ctx.fillText("RHYTHM RISSET COIL", geometry.centerX, geometry.centerY + 8);
  ctx.fillStyle = "rgba(126, 231, 220, 0.74)";
  ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(`${safe.pitchInterval.toFixed(2)} OCT`, geometry.centerX - 54, geometry.centerY + 26);
  ctx.fillStyle = "rgba(180, 152, 255, 0.78)";
  ctx.fillText(`${safe.rhythmInterval.toFixed(2)} OCT`, geometry.centerX + 54, geometry.centerY + 26);
  ctx.restore();
}

function drawPointer(ctx, geometry) {
  if (state.pointerLane === null || state.pointerPosition === null) return;
  const point = pointOnTrack(state.pointerLane, state.pointerPosition, geometry);
  ctx.save();
  ctx.strokeStyle = laneColor(state.pointerLane, state.pointerPosition, 0.98);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, geometry.trackWidth * 1.18, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(214, 232, 226, 0.72)";
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${state.pointerLane.toUpperCase()} AUDITION`, point.x, point.y - geometry.trackWidth * 1.55);
  ctx.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || document.hidden || disposed) return;
  const interval = reducedMotion ? REDUCED_DRAW_INTERVAL : DRAW_INTERVAL;
  if (!force && !visualizationDirty && timestamp - lastDrawTime < interval) return;
  if (!force && timestamp - lastDrawTime < interval) return;
  lastDrawTime = timestamp;
  visualizationDirty = false;
  context2d.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);

  const safe = currentParameters();
  let frame = null;
  try {
    frame = currentFrame();
  } catch {
    // Static racetracks remain available even if the frame helper is unavailable.
  }
  const geometry = trackGeometry(canvasWidth, canvasHeight);
  drawAurora(context2d, geometry, safe);
  drawTrack(context2d, "pitch", geometry, state.pitchTravel);
  drawTrack(context2d, "rhythm", geometry, state.rhythmTravel);
  drawLayerNodes(context2d, "pitch", geometry, frame);
  drawLayerNodes(context2d, "rhythm", geometry, frame);
  drawStrikeHistory(context2d, geometry, safe);
  drawPlayhead(context2d, "pitch", state.pitchPosition, safe.pitchDirection, geometry);
  drawPlayhead(context2d, "rhythm", state.rhythmPosition, safe.rhythmDirection, geometry);
  drawLabels(context2d, geometry, safe);
  drawPointer(context2d, geometry);
}

function ageStrikeEvents(elapsed) {
  for (const strike of strikeEvents) strike.age += elapsed;
  strikeEvents = strikeEvents.filter(({ age }) => age <= STRIKE_HISTORY_SECONDS);
}

function advanceVisualState(elapsed) {
  if (!(elapsed > 0)) return;
  const safe = currentParameters();
  ageStrikeEvents(elapsed);
  const advanced = advanceOuroborosBorealisCoordinates(
    {
      pitchPosition: state.pitchPosition,
      rhythmPosition: state.rhythmPosition,
    },
    elapsed,
    safe,
  );
  state.pitchTravel += advanced.pitchOctaveDelta;
  state.rhythmTravel += advanced.rhythmOctaveDelta;
  state.pitchPosition = advanced.pitchPosition;
  state.rhythmPosition = advanced.rhythmPosition;
  rotateRhythmVisualPhases(advanced.rhythmWraps);

  let rhythmLayers = [];
  try {
    rhythmLayers = layerArray(currentFrame(), "rhythm");
  } catch {
    // Fall back to the center rhythm if the analysis frame is unavailable.
  }
  const activeLayers = rhythmLayers.filter((layer) => (
    layer.active !== false
      && Number(layer.hitRate ?? layer.rate) > 0
      && Number(layer.weight ?? layer.gain) > 0.002
  ));
  if (activeLayers.length === 0) {
    const pulseCycles = Math.min(32, safe.centerRate) * elapsed;
    const rawPhase = state.pulsePhase + pulseCycles;
    const hitCount = Math.max(0, Math.floor(rawPhase));
    state.pulsePhase = rawPhase - hitCount;
    const retained = Math.min(hitCount, Math.ceil(safe.centerRate * STRIKE_HISTORY_SECONDS) + 1);
    for (let index = retained - 1; index >= 0; index -= 1) {
      const age = (state.pulsePhase + index) / Math.max(0.001, safe.centerRate);
      if (age <= STRIKE_HISTORY_SECONDS) addStrikeEvent(0.64, null, "both", age);
    }
    return;
  }

  for (const layer of activeLayers) {
    const key = Number(layer.index) || 0;
    const rate = clamp(layer.hitRate ?? layer.rate, 0.001, 64);
    const priorPhase = rhythmVisualPhases.get(key)
      ?? wrapUnit(layer.pulsePhase ?? seed + key * 0.61803398875);
    const rawPhase = priorPhase + rate * elapsed;
    const hitCount = Math.max(0, Math.floor(rawPhase));
    const nextPhase = rawPhase - hitCount;
    rhythmVisualPhases.set(key, nextPhase);
    const retained = Math.min(hitCount, Math.ceil(rate * STRIKE_HISTORY_SECONDS) + 1);
    for (let index = retained - 1; index >= 0; index -= 1) {
      const age = (nextPhase + index) / rate;
      if (age <= STRIKE_HISTORY_SECONDS) addLayerStrike(layer, safe, age);
    }
  }
}

function animate(timestamp) {
  animationFrame = 0;
  if (disposed || document.hidden) return;
  const audioTime = Number(audio.context?.currentTime);
  const hasAudioClock = state.audioOn && Number.isFinite(audioTime);
  const elapsed = hasAudioClock
    ? lastAudioVisualTime === null
      ? 0
      : Math.max(0, audioTime - lastAudioVisualTime)
    : lastAnimationTime > 0
      ? Math.max(0, (timestamp - lastAnimationTime) / 1_000)
      : 0;
  lastAnimationTime = timestamp;
  if (hasAudioClock) lastAudioVisualTime = audioTime;
  if (state.audioOn) {
    advanceVisualState(elapsed);
    visualizationDirty = true;
  }
  draw(timestamp);
  if (state.audioOn) animationFrame = requestAnimationFrame(animate);
}

function scheduleAnimation() {
  if (disposed || document.hidden || animationFrame) return;
  animationFrame = requestAnimationFrame(animate);
}

function resizeCanvas() {
  if (disposed) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  canvasWidth = Math.max(1, rect.width);
  canvasHeight = Math.max(1, rect.height);
  canvasScale = dpr;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  visualizationDirty = true;
  scheduleAnimation();
}

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;

function handleVisibilityChange() {
  if (document.hidden) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    return;
  }
  lastAnimationTime = performance.now();
  visualizationDirty = true;
  resizeCanvas();
}

function handlePageHide(event) {
  audioStartGeneration += 1;
  cancelTrackInteraction();
  if (event.persisted) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    audio.stop();
    state.audioOn = false;
    lastAudioVisualTime = null;
    return;
  }
  disposed = true;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  resizeObserver?.disconnect();
  globalThis.removeEventListener("resize", resizeCanvas);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  globalThis.removeEventListener("pageshow", handlePageShow);
  void audio.close();
}

function handlePageShow(event) {
  if (!event.persisted) return;
  lastAnimationTime = performance.now();
  visualizationDirty = true;
  updateInterface();
  resizeCanvas();
}

resizeObserver?.observe(canvas);
globalThis.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", handleVisibilityChange);
globalThis.addEventListener("pagehide", handlePageHide);
globalThis.addEventListener("pageshow", handlePageShow);

renderPresetGrid();
updateInterface();
resizeCanvas();
