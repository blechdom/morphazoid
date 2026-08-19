import {
  OUROBOROS_DEFAULTS,
  OUROBOROS_PRESETS,
  OuroborosAudio,
  calculateOuroborosLayers,
  sanitizeOuroborosParams,
} from "./src/ouroboros.js";

const $ = (id) => document.getElementById(id);
const audio = new OuroborosAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches ?? false;
const DEFAULT_SAMPLE_RATE = 48_000;
const DRAW_INTERVAL = 1_000 / 30;
const REDUCED_DRAW_INTERVAL = 1_000 / 5;
const STRIKE_HISTORY_SECONDS = 2.4;
const VISUAL_PARAMETER_SLEW = 0.035;
const MAX_STRIKE_EVENTS = 96;
const TAU = Math.PI * 2;
const HEAD_ANGLE = -0.42;
const HEAD_GAP = 0.24;
const FAMILY_COLORS = Object.freeze([
  [241, 200, 111],
  [255, 142, 114],
  [133, 228, 183],
  [114, 213, 229],
]);

function directionSign(value, fallback = 1) {
  if (value === false || value === "false") return -1;
  if (value === true || value === "true") return 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric < 0 ? -1 : 1;
}

function createMemory(preset = OUROBOROS_PRESETS[0] ?? OUROBOROS_DEFAULTS) {
  const safe = sanitizeOuroborosParams({
    ...OUROBOROS_DEFAULTS,
    ...preset,
  });
  return {
    direction: directionSign(safe.direction, directionSign(OUROBOROS_DEFAULTS.direction)),
    glissRate: safe.glissRate,
    hitRate: safe.hitRate,
    centerPitch: safe.centerPitch,
    bankWidth: safe.bankWidth,
    voiceInterval: clamp(
      safe.voiceInterval ?? preset?.voiceInterval ?? OUROBOROS_DEFAULTS.voiceInterval ?? 1,
      0.5,
      2,
    ),
    spread: safe.spread,
    decay: safe.decay,
    character: safe.character,
    morphDepth: safe.morphDepth,
    noiseMix: safe.noiseMix,
    cutoff: safe.cutoff,
    presetId: preset?.id ?? null,
  };
}

const initialSafe = sanitizeOuroborosParams(OUROBOROS_DEFAULTS);
const state = {
  coil: createMemory(),
  level: initialSafe.level,
  audioOn: false,
  audioStarting: false,
  visualPosition: 0,
  visualTravel: 0,
  visualHitPhase: 0.31,
  pointerTrackPosition: null,
};
const visualMotion = {
  direction: initialSafe.direction,
  glissRate: initialSafe.glissRate,
  hitRate: initialSafe.hitRate,
};

let animationFrame = 0;
let lastAnimationTime = 0;
let lastAudioVisualTime = null;
let lastDrawTime = -Infinity;
let canvasWidth = 1;
let canvasHeight = 1;
let canvasScale = 1;
let disposed = false;
let visualizationDirty = true;
let audioStartPromise = null;
let audioStartGeneration = 0;
let strikeEvents = [];
let activeTrackPointer = null;
let lastPointerPosition = null;
let lastPointerStrikeTime = -Infinity;
let pendingTrackStrike = null;
let trackStrikePromise = null;

function clamp(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

function compactNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toFixed(digits).replace(/\.?0+$/, "");
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  if (frequency >= 1_000) {
    return `${compactNumber(frequency / 1_000, frequency >= 10_000 ? 1 : 2)} kHz`;
  }
  return `${compactNumber(frequency, frequency >= 100 ? 0 : 1)} Hz`;
}

function registerBounds(centerPitch, bankWidth) {
  const halfWidth = Math.max(0, Number(bankWidth) || 0) * 0.5;
  const center = Math.max(0, Number(centerPitch) || 0);
  return {
    low: center * 2 ** -halfWidth,
    high: center * 2 ** halfWidth,
  };
}

function formatRegister(centerPitch, bankWidth) {
  const { low, high } = registerBounds(centerPitch, bankWidth);
  return `${formatFrequency(low)}–${formatFrequency(high)}`;
}

function formatDecay(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 1) return `${Math.round(seconds * 1_000)} ms`;
  return `${compactNumber(seconds, 2)} s`;
}

function formatHitRate(value) {
  const rate = Math.max(0, Number(value) || 0);
  return `${compactNumber(rate, rate % 1 ? 2 : 0)} hits/s · ${compactNumber(rate * 60, 0)} BPM`;
}

function formatGlissRate(value, voiceInterval = 1) {
  const rate = Math.max(0.0001, Number(value) || 0.0001);
  const interval = clamp(voiceInterval, 0.5, 2);
  return `${rate.toFixed(2)} oct/s · wraps in ${compactNumber(interval / rate, 1)} s`;
}

function formatVoiceInterval(value) {
  const octaves = clamp(value, 0.5, 2);
  return `${octaves.toFixed(2)} oct · ${(2 ** octaves).toFixed(2)}:1`;
}

function characterLabel(value) {
  const amount = clamp(value, 0, 1);
  if (amount < 0.18) return "Deep skin";
  if (amount < 0.42) return "Kick / tom";
  if (amount < 0.68) return "Tom / hand";
  if (amount < 0.88) return "Dry rattle";
  return "Bright air";
}

function morphDepthLabel(value) {
  const amount = clamp(value, 0, 1);
  if (amount < 0.08) return "Fixed";
  if (amount > 0.92) return "Full";
  return "Partial";
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

function currentParameters() {
  const safe = sanitizeOuroborosParams({
    direction: state.coil.direction,
    glissRate: state.coil.glissRate,
    hitRate: state.coil.hitRate,
    centerPitch: state.coil.centerPitch,
    bankWidth: state.coil.bankWidth,
    voiceInterval: state.coil.voiceInterval,
    spread: state.coil.spread,
    decay: state.coil.decay,
    character: state.coil.character,
    morphDepth: state.coil.morphDepth,
    noiseMix: state.coil.noiseMix,
    cutoff: state.coil.cutoff,
    level: state.level,
  });
  return {
    ...safe,
    voiceInterval: clamp(safe.voiceInterval ?? state.coil.voiceInterval ?? 1, 0.5, 2),
  };
}

function snapVisualMotion(parameters = currentParameters()) {
  visualMotion.direction = parameters.direction;
  visualMotion.glissRate = parameters.glissRate;
  visualMotion.hitRate = parameters.hitRate;
}

function currentLayerFrame(position = state.visualPosition) {
  return calculateOuroborosLayers({
    position,
    ...currentParameters(),
    sampleRate: audio.context?.sampleRate ?? DEFAULT_SAMPLE_RATE,
  });
}

function frameLayers(frame) {
  return Array.isArray(frame?.layers) ? frame.layers : [];
}

function layerWeight(layer) {
  const weight = Number(layer?.weight ?? layer?.gain);
  return Number.isFinite(weight) ? Math.max(0, weight) : 0;
}

function layerIsActive(layer) {
  if (typeof layer?.active === "boolean") return layer.active;
  return layerWeight(layer) > 1e-7;
}

function activeLayerCount(frame) {
  for (const key of ["activeLayers", "audibleLayers", "activeLayerCount"]) {
    const count = Number(frame?.[key]);
    if (Number.isFinite(count)) return Math.max(0, Math.round(count));
  }
  return frameLayers(frame).filter(layerIsActive).length;
}

function presetLabel(preset) {
  return preset?.label ?? preset?.name ?? preset?.id ?? "Preset";
}

function presetDetail(preset) {
  if (preset?.description) return preset.description;
  const safe = sanitizeOuroborosParams({ ...OUROBOROS_DEFAULTS, ...preset });
  return `${safe.direction > 0 ? "rise" : "fall"} · ${safe.glissRate.toFixed(2)} oct/s`;
}

function selectedPreset() {
  return OUROBOROS_PRESETS.find(({ id }) => id === state.coil.presetId) ?? null;
}

function renderPresetGrid() {
  const grid = $("presetGrid");
  grid.replaceChildren();
  for (const preset of OUROBOROS_PRESETS) {
    const button = document.createElement("button");
    const label = document.createElement("b");
    const detail = document.createElement("small");
    button.type = "button";
    button.dataset.preset = preset.id;
    setPressed(button, preset.id === state.coil.presetId);
    label.textContent = presetLabel(preset);
    detail.textContent = presetDetail(preset);
    button.append(label, detail);
    grid.append(button);
  }
}

function updateAudioParameters() {
  audio.setParameters(currentParameters());
}

function updateInterface({ rebuildPresets = false } = {}) {
  const safe = currentParameters();
  if (!state.audioOn) snapVisualMotion(safe);
  const rising = safe.direction > 0;
  const frame = currentLayerFrame();
  const active = activeLayerCount(frame);
  const register = formatRegister(safe.centerPitch, safe.bankWidth);

  setPressed($("directionRise"), rising);
  setPressed($("directionFall"), !rising);
  setPressed($("audioButton"), state.audioOn);
  setPressed($("transportButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("transportButton").disabled = state.audioStarting;
  $("strikeButton").disabled = state.audioStarting;
  $("audioButton").dataset.audioState = state.audioStarting
    ? "starting"
    : state.audioOn
      ? "on"
      : "off";
  $("audioButton").setAttribute(
    "aria-label",
    state.audioOn ? "Stop Ouroboros" : "Start Ouroboros",
  );
  $("audioAction").textContent = state.audioOn ? "Stop" : "Start";
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("transportIcon").textContent = state.audioStarting ? "…" : state.audioOn ? "■" : "▶";
  $("transportLabel").textContent = state.audioStarting
    ? "Starting"
    : state.audioOn
      ? "Stop"
      : "Start";
  $("transportButton").setAttribute(
    "aria-label",
    state.audioOn
      ? "Stop automatic Ouroboros motion and strikes"
      : "Start automatic Ouroboros motion and strikes",
  );

  for (const id of [
    "glissRate",
    "hitRate",
    "centerPitch",
    "bankWidth",
    "voiceInterval",
    "spread",
    "decay",
    "character",
    "morphDepth",
    "noiseMix",
    "cutoff",
    "level",
  ]) {
    const value = id === "level" ? safe.level : safe[id];
    $(id).value = String(value);
  }

  $("glissRateOut").textContent = formatGlissRate(safe.glissRate, safe.voiceInterval);
  $("hitRateOut").textContent = formatHitRate(safe.hitRate);
  $("centerPitchOut").textContent = formatFrequency(safe.centerPitch);
  $("bankWidthOut").textContent = `${safe.bankWidth.toFixed(1)} octaves`;
  $("voiceIntervalOut").textContent = formatVoiceInterval(safe.voiceInterval);
  $("spreadOut").textContent = `${Math.round(safe.spread * 100)}%`;
  $("decayOut").textContent = formatDecay(safe.decay);
  $("characterOut").textContent = characterLabel(safe.character);
  $("morphDepthOut").textContent = `${morphDepthLabel(safe.morphDepth)} · ${Math.round(safe.morphDepth * 100)}%`;
  $("noiseMixOut").textContent = `${Math.round(safe.noiseMix * 100)}%`;
  $("cutoffOut").textContent = formatFrequency(safe.cutoff);
  $("levelOut").textContent = `${Math.round(safe.level * 100)}%`;

  $("engineSummary").textContent = `${active} active parallel bodies`;
  $("motionSummary").textContent = `${rising ? "rise" : "fall"} · ${safe.glissRate.toFixed(2)} oct/s · ${compactNumber(safe.hitRate, 2)} hits/s`;
  $("shepardSummary").textContent = `${register} · ${safe.voiceInterval.toFixed(2)} oct voices`;
  $("soundSummary").textContent = `${morphDepthLabel(safe.morphDepth).toLowerCase()} morph · ${characterLabel(safe.character).toLowerCase()}`;
  $("directionMarker").textContent = rising ? "↻" : "↺";
  $("directionMarkerText").textContent = `endlessly ${rising ? "rising" : "falling"}`;
  $("signalBankDetail").textContent = `${(2 ** safe.voiceInterval).toFixed(2)}:1 · edge faded`;
  $("stageReadout").textContent = [
    "SHEPARD RATTLE",
    rising ? "RISING" : "FALLING",
    `${safe.glissRate.toFixed(2)} OCT/S`,
    `${compactNumber(safe.hitRate, 2)} HITS/S`,
    `${register.toUpperCase()} REGISTER`,
    `${safe.voiceInterval.toFixed(2)} OCT VOICES`,
    `${active} BODIES`,
    state.audioOn ? "PLAYING" : "STOPPED",
  ].join(" · ");
  canvas.setAttribute(
    "aria-label",
    `A wide interactive ${active}-body serpent racetrack carries persistent Rattlesnake strikes through an endlessly ${rising ? "rising" : "falling"} Shepard glissando at ${safe.glissRate.toFixed(2)} octaves per second and ${compactNumber(safe.hitRate, 2)} hits per second. Parallel voices are ${safe.voiceInterval.toFixed(2)} octaves apart and the calculated register spans ${register}. Drag around the track to audition its pitch and timbre space.`,
  );

  const preset = selectedPreset();
  $("presetSummary").textContent = preset ? presetLabel(preset) : "Custom";
  if (rebuildPresets) renderPresetGrid();
  else {
    for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
      setPressed(button, button.dataset.preset === state.coil.presetId);
    }
  }

  updateAudioParameters();
  visualizationDirty = true;
  scheduleAnimation();
}

function markCustom() {
  state.coil.presetId = null;
}

function applyPreset(id) {
  const preset = OUROBOROS_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  synchronizeVisualClock();
  const safe = sanitizeOuroborosParams({ ...OUROBOROS_DEFAULTS, ...preset });
  state.coil = createMemory(preset);
  state.level = safe.level;
  updateInterface({ rebuildPresets: true });
  announce(`${presetLabel(preset)} preset loaded.`);
}

$("presetGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (button) applyPreset(button.dataset.preset);
});

$("direction").addEventListener("click", (event) => {
  const button = event.target.closest("[data-value]");
  if (!button) return;
  synchronizeVisualClock();
  state.coil.direction = Number(button.dataset.value) < 0 ? -1 : 1;
  markCustom();
  updateInterface();
  announce(`Ouroboros pitch now ${state.coil.direction > 0 ? "rises" : "falls"} endlessly.`);
});

function bindRange(id, onInput) {
  $(id).addEventListener("input", (event) => {
    synchronizeVisualClock();
    onInput(Number(event.currentTarget.value));
    updateInterface();
  });
}

for (const id of [
  "glissRate",
  "hitRate",
  "centerPitch",
  "bankWidth",
  "voiceInterval",
  "spread",
  "decay",
  "character",
  "morphDepth",
  "noiseMix",
  "cutoff",
]) {
  bindRange(id, (value) => {
    state.coil[id] = value;
    markCustom();
  });
}

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
      announce("Ouroboros started.");
      return true;
    } catch (error) {
      state.audioOn = false;
      showAudioError(error);
      announce("Ouroboros audio could not start.");
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
    announce("Ouroboros stopped.");
    return;
  }
  await startAudio();
}

$("audioButton").addEventListener("click", toggleAudio);
$("transportButton").addEventListener("click", toggleAudio);

function visualStrike(
  position,
  velocity = 0.86,
  age = 0,
  travelAtStrike = state.visualTravel,
) {
  const safe = currentParameters();
  const frame = currentLayerFrame(position);
  const layers = frameLayers(frame).filter(layerIsActive);
  const maximumWeight = Math.max(1e-7, ...layers.map(layerWeight));
  const marks = layers.map((layer) => ({
    normalized: clamp(
      0.5 + Number(layer.octaveOffset || 0) / Math.max(3, safe.bankWidth),
      0,
      1,
    ),
    morph: clamp(layer.morphPosition, 0, 1),
    strength: clamp(layerWeight(layer) / maximumWeight, 0, 1),
    bankWidth: safe.bankWidth,
  }));
  strikeEvents.push({
    age,
    velocity: clamp(velocity, 0, 1),
    direction: safe.direction,
    travelAtStrike,
    marks,
  });
  if (strikeEvents.length > MAX_STRIKE_EVENTS) {
    strikeEvents.splice(0, strikeEvents.length - MAX_STRIKE_EVENTS);
  }
  visualizationDirty = true;
}

function visualTrackStrike(position, velocity = 0.8) {
  const safe = currentParameters();
  const normalized = wrapUnit(position);
  strikeEvents.push({
    age: 0,
    velocity: clamp(velocity, 0, 1),
    direction: safe.direction,
    travelAtStrike: state.visualTravel,
    marks: [{
      normalized,
      morph: normalized,
      strength: 1,
      bankWidth: safe.bankWidth,
    }],
  });
  if (strikeEvents.length > MAX_STRIKE_EVENTS) {
    strikeEvents.splice(0, strikeEvents.length - MAX_STRIKE_EVENTS);
  }
  visualizationDirty = true;
}

function flashStrikeButton() {
  const button = $("strikeButton");
  button.classList.add("is-striking");
  globalThis.setTimeout?.(() => button.classList.remove("is-striking"), 80);
}

async function strikeCurrentBank(velocity = 0.9) {
  if (!await startAudio()) return false;
  const struck = audio.strike(velocity);
  if (!struck) return false;
  visualStrike(state.visualPosition, velocity);
  flashStrikeButton();
  scheduleAnimation();
  announce(`Ouroboros struck at ${formatFrequency(currentParameters().centerPitch)} center pitch.`);
  return true;
}

function strikeTrackPosition(position, velocity = 0.8) {
  pendingTrackStrike = {
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
        visualTrackStrike(audition.position, audition.velocity);
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
  strikeCurrentBank();
});

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  synchronizeVisualClock();
  state.coil = createMemory();
  state.level = initialSafe.level;
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce("Ouroboros parameters reset.");
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    state.coil.direction = event.key === "ArrowUp" ? 1 : -1;
    markCustom();
    updateInterface();
    announce(`Ouroboros pitch now ${state.coil.direction > 0 ? "rises" : "falls"} endlessly.`);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) strikeCurrentBank();
  } else if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    if (!event.repeat) toggleAudio();
  }
});

function trackPositionFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = clamp(event.clientX - bounds.left, 0, Math.max(1, bounds.width));
  const y = clamp(event.clientY - bounds.top, 0, Math.max(1, bounds.height));
  const geometry = coilGeometry(
    Math.max(1, bounds.width),
    Math.max(1, bounds.height),
  );
  let closestPosition = 0;
  let closestDistance = Infinity;
  const sampleCount = 192;
  for (let index = 0; index <= sampleCount; index += 1) {
    const position = index / sampleCount;
    const point = pointOnCoil(position, geometry);
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPosition = position;
    }
  }
  return wrapUnit(closestPosition);
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
    // Pointer capture can already be released by the browser during cancellation.
  }
  activeTrackPointer = null;
  lastPointerPosition = null;
  state.pointerTrackPosition = null;
  $("stageWrap").classList.remove("is-auditioning");
  visualizationDirty = true;
  scheduleAnimation();
}

function cancelTrackInteraction() {
  activeTrackPointer = null;
  lastPointerPosition = null;
  pendingTrackStrike = null;
  state.pointerTrackPosition = null;
  $("stageWrap").classList.remove("is-auditioning");
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false) return;
  event.preventDefault();
  canvas.focus?.();
  activeTrackPointer = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);
  $("stageWrap").classList.add("is-auditioning");
  const position = trackPositionFromPointer(event);
  state.pointerTrackPosition = position;
  lastPointerPosition = position;
  lastPointerStrikeTime = performance.now();
  visualizationDirty = true;
  scheduleAnimation();
  void strikeTrackPosition(position, 0.84);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activeTrackPointer) return;
  event.preventDefault();
  const position = trackPositionFromPointer(event);
  const movement = trackDistance(position, lastPointerPosition ?? position);
  state.pointerTrackPosition = position;
  visualizationDirty = true;
  scheduleAnimation();
  const now = performance.now();
  if (movement >= 0.008 && now - lastPointerStrikeTime >= 32) {
    const pressure = Number.isFinite(event.pressure) ? event.pressure : 0.5;
    const velocity = clamp(0.55 + movement * 4 + pressure * 0.18, 0.55, 0.96);
    lastPointerPosition = position;
    lastPointerStrikeTime = now;
    void strikeTrackPosition(position, velocity);
  }
});

canvas.addEventListener("pointerup", releaseTrackPointer);
canvas.addEventListener("pointercancel", releaseTrackPointer);

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

function coilGeometry(width, height) {
  const compact = width < 640;
  const centerX = width * 0.5;
  const centerY = height * (compact ? 0.45 : 0.46);
  const availableWidth = Math.max(120, width - (compact ? 48 : 92));
  const availableHeight = Math.max(90, height - (compact ? 112 : 134));
  const radiusX = Math.max(58, availableWidth * 0.44);
  const radiusY = Math.max(
    38,
    Math.min(availableHeight * 0.31, radiusX * (compact ? 0.42 : 0.48)),
  );
  const bodyWidth = clamp(radiusY * 0.17, 12, 29);
  return { centerX, centerY, radiusX, radiusY, bodyWidth };
}

function signedSuperellipsePower(value, power) {
  return Math.sign(value) * Math.abs(value) ** power;
}

function superellipsePoint(angle, radiusX, radiusY) {
  const power = 2 / 3.4;
  return {
    x: signedSuperellipsePower(Math.cos(angle), power) * radiusX,
    y: signedSuperellipsePower(Math.sin(angle), power) * radiusY,
  };
}

function pointOnCoil(normalized, geometry, radialOffset = 0) {
  const amount = clamp(normalized, 0, 1);
  const angle = HEAD_ANGLE + HEAD_GAP + amount * (TAU - HEAD_GAP * 2);
  const radiusX = geometry.radiusX + radialOffset;
  const radiusY = geometry.radiusY + radialOffset * 0.78;
  const point = superellipsePoint(angle, radiusX, radiusY);
  const before = superellipsePoint(angle - 0.001, radiusX, radiusY);
  const after = superellipsePoint(angle + 0.001, radiusX, radiusY);
  return {
    x: geometry.centerX + point.x,
    y: geometry.centerY + point.y,
    angle,
    tangentAngle: Math.atan2(after.y - before.y, after.x - before.x),
  };
}

function mixFamilyColor(position, alpha = 1) {
  const amount = clamp(position, 0, 1) * (FAMILY_COLORS.length - 1);
  const lower = Math.min(FAMILY_COLORS.length - 1, Math.floor(amount));
  const upper = Math.min(FAMILY_COLORS.length - 1, lower + 1);
  const mix = amount - lower;
  const channels = FAMILY_COLORS[lower].map((channel, index) => Math.round(
    channel + (FAMILY_COLORS[upper][index] - channel) * mix,
  ));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function drawPitchGuides(ctx, geometry, safe) {
  ctx.save();
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const guideCount = Math.max(
    3,
    Math.min(16, Math.round(safe.bankWidth / safe.voiceInterval)),
  );
  for (let index = 0; index <= guideCount; index += 1) {
    const point = pointOnCoil(index / guideCount, geometry, geometry.bodyWidth * 0.95);
    const inner = pointOnCoil(index / guideCount, geometry, geometry.bodyWidth * 0.68);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = "rgba(214, 232, 226, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(214, 232, 226, 0.34)";
  ctx.fillText(
    safe.direction > 0 ? "LOWER OCTAVES" : "HIGHER OCTAVES",
    geometry.centerX,
    geometry.centerY + geometry.radiusY + geometry.bodyWidth * 1.7,
  );
  ctx.fillStyle = "rgba(133, 228, 183, 0.78)";
  ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(
    `${(2 ** safe.voiceInterval).toFixed(2)} : 1`,
    geometry.centerX,
    geometry.centerY - 7,
  );
  ctx.fillStyle = "rgba(214, 232, 226, 0.38)";
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText("PARALLEL VOICE INTERVAL", geometry.centerX, geometry.centerY + 9);
  ctx.restore();
}

function drawSerpent(ctx, geometry, safe) {
  const segmentCount = 112;
  ctx.save();
  ctx.lineCap = "butt";
  for (let index = 0; index < segmentCount; index += 1) {
    const start = index / segmentCount;
    const end = (index + 1.08) / segmentCount;
    const first = pointOnCoil(start, geometry);
    const second = pointOnCoil(Math.min(1, end), geometry);
    const familyPosition = clamp(start, 0, 1);
    const edgeFade = Math.sin(Math.PI * clamp(start, 0, 1)) ** 0.32;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    ctx.strokeStyle = "rgba(2, 5, 6, 0.92)";
    ctx.lineWidth = geometry.bodyWidth + 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    ctx.strokeStyle = mixFamilyColor(familyPosition, 0.2 + edgeFade * 0.47);
    ctx.lineWidth = geometry.bodyWidth;
    ctx.stroke();
  }

  const scaleCount = Math.max(24, Math.round((geometry.radiusX + geometry.radiusY) / 11));
  const scaleTravel = reducedMotion
    ? 0
    : state.visualTravel / Math.max(3, safe.bankWidth);
  for (let index = 0; index < scaleCount; index += 1) {
    const normalized = wrapUnit(index / scaleCount + scaleTravel);
    const point = pointOnCoil(normalized, geometry);
    const normalX = -Math.sin(point.tangentAngle);
    const normalY = Math.cos(point.tangentAngle);
    const half = geometry.bodyWidth * 0.28;
    ctx.beginPath();
    ctx.moveTo(point.x - normalX * half, point.y - normalY * half);
    ctx.lineTo(point.x + normalX * half, point.y + normalY * half);
    ctx.strokeStyle = mixFamilyColor(normalized, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const headPoint = pointOnCoil(0, geometry);
  const nextPoint = pointOnCoil(0.035, geometry);
  const tangentAngle = Math.atan2(nextPoint.y - headPoint.y, nextPoint.x - headPoint.x);
  const headLength = geometry.bodyWidth * 1.65;
  const headHalf = geometry.bodyWidth * 0.72;
  ctx.translate(headPoint.x, headPoint.y);
  ctx.rotate(tangentAngle);
  ctx.fillStyle = mixFamilyColor(0.12, 0.94);
  ctx.strokeStyle = "rgba(3, 7, 8, 0.92)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(headLength * 0.62, 0);
  ctx.lineTo(-headLength * 0.42, -headHalf);
  ctx.lineTo(-headLength * 0.72, 0);
  ctx.lineTo(-headLength * 0.42, headHalf);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(4, 8, 9, 0.95)";
  ctx.beginPath();
  ctx.arc(headLength * 0.08, -headHalf * 0.4, Math.max(1.4, geometry.bodyWidth * 0.09), 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(headLength * 0.56, 0);
  ctx.lineTo(headLength * 0.14, headHalf * 0.16);
  ctx.strokeStyle = "rgba(3, 7, 8, 0.86)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawLayerNodes(ctx, geometry, safe, frame) {
  const layers = frameLayers(frame).filter(layerIsActive);
  const maximumWeight = Math.max(1e-7, ...layers.map(layerWeight));
  ctx.save();
  for (const layer of layers) {
    const normalized = clamp(
      0.5 + Number(layer.octaveOffset || 0) / Math.max(3, safe.bankWidth),
      0,
      1,
    );
    const point = pointOnCoil(normalized, geometry);
    const strength = clamp(layerWeight(layer) / maximumWeight, 0, 1);
    const radius = 2 + strength * 3.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, TAU);
    ctx.fillStyle = mixFamilyColor(layer.morphPosition, 0.35 + strength * 0.6);
    ctx.fill();
    ctx.strokeStyle = "rgba(5, 9, 10, 0.92)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawStrikeGlyph(ctx, point, size, morph, alpha, direction) {
  const stage = Math.max(0, Math.min(3, Math.floor(clamp(morph, 0, 0.9999) * 4)));
  const tangent = point.tangentAngle;
  ctx.save();
  ctx.translate(Math.round(point.x) + 0.5, Math.round(point.y) + 0.5);
  ctx.rotate(tangent * direction);
  ctx.globalAlpha = clamp(alpha, 0.12, 1);
  ctx.fillStyle = mixFamilyColor(morph, 1);
  ctx.strokeStyle = mixFamilyColor(morph, 1);
  ctx.lineWidth = Math.max(1, Math.min(2.2, size * 0.22));

  if (stage === 0) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.58, 0, TAU);
    ctx.fill();
  } else if (stage === 1) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.64, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, size * 0.18), 0, TAU);
    ctx.fill();
  } else if (stage === 2) {
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.3);
    ctx.lineTo(size, -size * 0.3);
    ctx.moveTo(-size * 0.72, size * 0.45);
    ctx.lineTo(size * 0.72, size * 0.45);
    ctx.stroke();
  } else {
    for (let line = -1; line <= 1; line += 1) {
      const offset = line * size * 0.52;
      ctx.beginPath();
      ctx.moveTo(offset - size * 0.36, -size * 0.8);
      ctx.lineTo(offset + size * 0.36, size * 0.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPlayhead(ctx, geometry, safe) {
  const normalized = wrapUnit(state.visualPosition);
  const point = pointOnCoil(normalized, geometry);
  const normalX = -Math.sin(point.tangentAngle);
  const normalY = Math.cos(point.tangentAngle);
  const tangentX = Math.cos(point.tangentAngle) * safe.direction;
  const tangentY = Math.sin(point.tangentAngle) * safe.direction;
  const half = geometry.bodyWidth * 1.08;
  const arrowLength = Math.max(7, geometry.bodyWidth * 0.62);

  ctx.save();
  ctx.shadowColor = "rgba(133, 228, 183, 0.82)";
  ctx.shadowBlur = 13;
  ctx.strokeStyle = "rgba(222, 255, 239, 0.96)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(point.x - normalX * half, point.y - normalY * half);
  ctx.lineTo(point.x + normalX * half, point.y + normalY * half);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(133, 228, 183, 0.98)";
  ctx.beginPath();
  ctx.moveTo(point.x + tangentX * arrowLength, point.y + tangentY * arrowLength);
  ctx.lineTo(
    point.x - tangentX * arrowLength * 0.45 + normalX * arrowLength * 0.52,
    point.y - tangentY * arrowLength * 0.45 + normalY * arrowLength * 0.52,
  );
  ctx.lineTo(
    point.x - tangentX * arrowLength * 0.45 - normalX * arrowLength * 0.52,
    point.y - tangentY * arrowLength * 0.45 - normalY * arrowLength * 0.52,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (state.pointerTrackPosition === null) return;
  const audition = pointOnCoil(state.pointerTrackPosition, geometry);
  ctx.save();
  ctx.strokeStyle = mixFamilyColor(state.pointerTrackPosition, 0.98);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(
    audition.x,
    audition.y,
    geometry.bodyWidth * 0.92,
    0,
    TAU,
  );
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(214, 232, 226, 0.72)";
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    "AUDITION",
    audition.x,
    audition.y - geometry.bodyWidth * 1.25,
  );
  ctx.restore();
}

function drawStrikeHistory(ctx, geometry) {
  for (const strike of strikeEvents) {
    const life = clamp(1 - strike.age / STRIKE_HISTORY_SECONDS, 0, 1);
    for (const mark of strike.marks) {
      const travel = (state.visualTravel - strike.travelAtStrike)
        / Math.max(3, mark.bankWidth);
      const normalized = wrapUnit(mark.normalized + travel);
      const point = pointOnCoil(normalized, geometry, geometry.bodyWidth * 0.05);
      const size = 3.8 + mark.strength * 5.4 + strike.velocity * 1.5;
      drawStrikeGlyph(
        ctx,
        point,
        size,
        mark.morph,
        (0.2 + life * 0.8) * (0.45 + mark.strength * 0.55),
        strike.direction,
      );
    }
  }
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
  const frame = currentLayerFrame();
  const geometry = coilGeometry(canvasWidth, canvasHeight);
  drawPitchGuides(context2d, geometry, safe);
  drawSerpent(context2d, geometry, safe);
  drawLayerNodes(context2d, geometry, safe, frame);
  drawStrikeHistory(context2d, geometry);
  drawPlayhead(context2d, geometry, safe);
}

function ageStrikeEvents(elapsed) {
  for (const strike of strikeEvents) strike.age += elapsed;
  strikeEvents = strikeEvents.filter(({ age }) => age <= STRIKE_HISTORY_SECONDS);
}

function advanceVisualState(elapsed) {
  if (!(elapsed > 0)) return;
  const safe = currentParameters();
  ageStrikeEvents(elapsed);

  const decay = Math.exp(-elapsed / VISUAL_PARAMETER_SLEW);
  const integratedDecay = VISUAL_PARAMETER_SLEW * (1 - decay);
  const integratedDoubleDecay = VISUAL_PARAMETER_SLEW * 0.5
    * (1 - decay * decay);
  const directionDelta = visualMotion.direction - safe.direction;
  const glissDelta = visualMotion.glissRate - safe.glissRate;
  const motionDelta = safe.direction * safe.glissRate * elapsed
    + (
      safe.direction * glissDelta
      + safe.glissRate * directionDelta
    ) * integratedDecay
    + directionDelta * glissDelta * integratedDoubleDecay;
  const hitCycles = safe.hitRate * elapsed
    + (visualMotion.hitRate - safe.hitRate) * integratedDecay;

  visualMotion.direction = safe.direction + directionDelta * decay;
  visualMotion.glissRate = safe.glissRate + glissDelta * decay;
  visualMotion.hitRate = safe.hitRate
    + (visualMotion.hitRate - safe.hitRate) * decay;

  const phaseMotionDelta = motionDelta / safe.voiceInterval;
  const nextPosition = wrapUnit(state.visualPosition + phaseMotionDelta);
  state.visualTravel += motionDelta;
  const rawHitPhase = state.visualHitPhase + hitCycles;
  const hitCount = Math.max(0, Math.floor(rawHitPhase));
  const nextHitPhase = rawHitPhase - hitCount;
  state.visualPosition = nextPosition;
  state.visualHitPhase = nextHitPhase;

  const averageHitRate = hitCycles / elapsed;
  const averageMotionRate = motionDelta / elapsed;
  const averagePhaseRate = phaseMotionDelta / elapsed;
  const retainedHitCount = Math.min(
    hitCount,
    Math.ceil(Math.max(averageHitRate, safe.hitRate) * STRIKE_HISTORY_SECONDS) + 1,
  );
  for (let recentIndex = retainedHitCount - 1; recentIndex >= 0; recentIndex -= 1) {
    const age = (nextHitPhase + recentIndex) / Math.max(0.001, averageHitRate);
    if (age > STRIKE_HISTORY_SECONDS) continue;
    const hitPosition = wrapUnit(
      nextPosition - age * averagePhaseRate,
    );
    visualStrike(
      hitPosition,
      0.76,
      age,
      state.visualTravel - age * averageMotionRate,
    );
  }
}

function synchronizeVisualClock() {
  if (!state.audioOn) return;
  const audioTime = Number(audio.context?.currentTime);
  if (!Number.isFinite(audioTime) || lastAudioVisualTime === null) return;
  advanceVisualState(Math.max(0, audioTime - lastAudioVisualTime));
  lastAudioVisualTime = audioTime;
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
  audio.close();
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
