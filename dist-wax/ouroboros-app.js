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
const STRIKE_HISTORY_SECONDS = 0.85;
const VISUAL_PARAMETER_SLEW = 0.035;
const MAX_STRIKE_EVENTS = 96;
const TAU = Math.PI * 2;
const COIL_START_ANGLE = -Math.PI * 0.5;
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
  sweeping: false,
  visualPosition: 0.5,
  visualHitPhase: 0.31,
  pluckPosition: 0.5,
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
  const precision = Math.max(0, Math.floor(digits));
  if (precision === 0) return Math.round(numeric).toString();
  return numeric.toFixed(precision).replace(/0+$/, "").replace(/\.$/, "");
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

function trackFrequencyAtPosition(position, parameters = currentParameters()) {
  const { low } = registerBounds(parameters.centerPitch, parameters.bankWidth);
  return low * 2 ** (clamp(position, 0, 1) * parameters.bankWidth);
}

function trackTimbreLabel(position) {
  const amount = clamp(position, 0, 1);
  if (amount < 0.16) return "deep body";
  if (amount < 0.34) return "kick / tom";
  if (amount < 0.58) return "tom / hand";
  if (amount < 0.8) return "hand / rattle";
  return "high air";
}

function formatDecay(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 1) return `${Math.round(seconds * 1_000)} ms`;
  return `${compactNumber(seconds, 2)} s`;
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

function paintPluckPosition(position = state.pluckPosition) {
  const safe = currentParameters();
  const normalized = clamp(position, 0, 1);
  const frequency = trackFrequencyAtPosition(normalized, safe);
  const valueText = `${formatFrequency(frequency)} · ${trackTimbreLabel(normalized)}`;
  state.pluckPosition = normalized;
  $("pluckPositionOut").textContent = valueText;
  canvas.setAttribute("aria-valuenow", String(Math.round(normalized * 100)));
  canvas.setAttribute("aria-valuetext", valueText);
}

function updateInterface({ rebuildPresets = false } = {}) {
  const safe = currentParameters();
  if (!state.sweeping) snapVisualMotion(safe);
  const rising = safe.direction > 0;
  const frame = currentLayerFrame();
  const active = activeLayerCount(frame);
  const register = formatRegister(safe.centerPitch, safe.bankWidth);

  $("directionRise").checked = rising;
  $("directionFall").checked = !rising;
  setPressed($("audioButton"), state.audioOn);
  setPressed($("transportButton"), state.sweeping);
  $("audioButton").disabled = state.audioStarting;
  $("transportButton").disabled = state.audioStarting;
  $("audioButton").dataset.audioState = state.audioStarting
    ? "starting"
    : state.audioOn
      ? "on"
      : "off";
  $("audioButton").setAttribute(
    "aria-label",
    state.audioOn ? "Turn Ouroboros audio off" : "Turn Ouroboros audio on",
  );
  $("audioAction").textContent = "Audio";
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("transportIcon").textContent = state.audioStarting ? "…" : state.sweeping ? "Ⅱ" : "▶";
  $("transportLabel").textContent = state.audioStarting
    ? "Starting"
    : state.sweeping
      ? "Pause"
      : "Play";
  $("transportButton").setAttribute(
    "aria-label",
    state.sweeping
      ? "Pause automatic Ouroboros motion"
      : "Play automatic Ouroboros motion",
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

  $("glissRateOut").textContent = `${safe.glissRate.toFixed(2)} oct/s`;
  $("hitRateOut").textContent = `${compactNumber(safe.hitRate, 2)} /s`;
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

  $("playSummary").textContent = `${state.sweeping ? "playing" : "ready"} · ${safe.glissRate.toFixed(2)} oct/s · ${compactNumber(safe.hitRate, 2)} hits/s`;
  $("shepardSummary").textContent = `${register} · ${safe.voiceInterval.toFixed(2)} oct voices`;
  $("soundSummary").textContent = `${morphDepthLabel(safe.morphDepth).toLowerCase()} morph · ${characterLabel(safe.character).toLowerCase()}`;
  $("directionMarker").textContent = rising ? "↻" : "↺";
  $("directionMarkerText").textContent = `endlessly ${rising ? "rising" : "falling"}`;
  $("signalBankDetail").textContent = `${(2 ** safe.voiceInterval).toFixed(2)}:1 · edge faded`;
  canvas.setAttribute(
    "aria-label",
    `Thick circular Ouroboros ring with a closed ${active}-body loop spanning the ${register} Shepard register`,
  );

  paintPluckPosition();

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

function setMotionDirection(direction, message = null) {
  const nextDirection = directionSign(direction, state.coil.direction);
  state.coil.direction = nextDirection;
  markCustom();
  updateInterface();
  announce(message ?? `Ouroboros pitch now ${nextDirection > 0 ? "rises" : "falls"} endlessly.`);
  return nextDirection;
}

function reverseMotionDirection() {
  synchronizeVisualClock();
  const nextDirection = setMotionDirection(
    state.coil.direction > 0 ? -1 : 1,
    `Ouroboros reversed; now ${state.coil.direction > 0 ? "falling" : "rising"}.`,
  );
  return nextDirection;
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

$("direction").addEventListener("change", (event) => {
  const input = event.target.closest('input[name="sweepDirection"]');
  if (!input) return;
  synchronizeVisualClock();
  setMotionDirection(Number(input.value) < 0 ? -1 : 1);
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
      await audio.enable();
      audio.setPosition(state.visualPosition);
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
      announce("Ouroboros audio ready for manual playing.");
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
    state.sweeping = false;
    state.audioOn = false;
    lastAudioVisualTime = null;
    updateInterface();
    announce("Ouroboros audio off.");
    return;
  }
  await startAudio();
}

$("audioButton").addEventListener("click", toggleAudio);

async function startSweep() {
  if (state.sweeping || state.audioStarting) return false;
  if (!await startAudio()) return false;
  state.sweeping = audio.setTransport(true);
  if (!state.sweeping) return false;
  lastAnimationTime = performance.now();
  lastAudioVisualTime = Number.isFinite(audio.context?.currentTime)
    ? audio.context.currentTime
    : null;
  updateInterface();
  scheduleAnimation();
  announce(`Ouroboros playing ${state.coil.direction > 0 ? "up" : "down"}.`);
  return true;
}

function stopSweep(options = null) {
  const announceStop = options?.announceStop ?? true;
  if (!state.sweeping) return false;
  synchronizeVisualClock();
  audio.stopTransport();
  state.sweeping = false;
  state.pluckPosition = state.visualPosition;
  updateInterface();
  if (announceStop) announce("Automatic motion paused. Manual playing remains active.");
  return true;
}

function toggleSweep() {
  if (state.sweeping) stopSweep();
  else void startSweep();
}

$("transportButton").addEventListener("click", toggleSweep);

function visualStrike(
  position,
  velocity = 0.86,
  age = 0,
) {
  strikeEvents.push({
    age,
    velocity: clamp(velocity, 0, 1),
    normalized: wrapUnit(position),
  });
  if (strikeEvents.length > MAX_STRIKE_EVENTS) {
    strikeEvents.splice(0, strikeEvents.length - MAX_STRIKE_EVENTS);
  }
  visualizationDirty = true;
}

async function strikeCurrentBank(velocity = 0.9) {
  if (!await startAudio()) return false;
  audio.setPosition(state.pluckPosition);
  const struck = audio.strike(velocity);
  if (!struck) return false;
  visualStrike(state.pluckPosition, velocity);
  scheduleAnimation();
  announce(`Ouroboros struck at ${formatFrequency(trackFrequencyAtPosition(state.pluckPosition))}.`);
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
      audio.setPosition(audition.position);
      if (audio.strike(audition.velocity)) {
        visualStrike(audition.position, audition.velocity);
        struck = true;
      }
    }
    if (struck) scheduleAnimation();
    return struck;
  })().finally(() => {
    if (trackStrikePromise === promise) trackStrikePromise = null;
  });
  trackStrikePromise = promise;
  return promise;
}

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  stopSweep({ announceStop: false });
  synchronizeVisualClock();
  state.coil = createMemory();
  state.level = initialSafe.level;
  state.visualPosition = 0.5;
  state.pluckPosition = 0.5;
  state.visualHitPhase = 0.31;
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce("Ouroboros parameters reset.");
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    if (state.sweeping) {
      const nextDirection = event.key === "ArrowRight" ? 1 : -1;
      synchronizeVisualClock();
      setMotionDirection(
        nextDirection,
        `Ouroboros now ${nextDirection > 0 ? "rising" : "falling"}.`,
      );
      return;
    }
    stopSweep({ announceStop: false });
    const step = event.shiftKey ? 0.05 : 0.01;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const position = setPluckPosition(wrapUnit(state.pluckPosition + direction * step));
    void strikeTrackPosition(position, 0.72);
    announce(`Ring touch at ${formatFrequency(trackFrequencyAtPosition(position))}.`);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    stopSweep({ announceStop: false });
    const position = setPluckPosition(event.key === "Home" ? 0 : 1);
    void strikeTrackPosition(position, 0.72);
    announce(`Ring touch at ${formatFrequency(trackFrequencyAtPosition(position))}.`);
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    synchronizeVisualClock();
    setMotionDirection(event.key === "ArrowUp" ? 1 : -1);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) strikeCurrentBank();
  } else if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    if (!event.repeat) toggleSweep();
  }
});

function canvasPointerSnapshot(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = clamp(event.clientX - bounds.left, 0, Math.max(1, bounds.width));
  const y = clamp(event.clientY - bounds.top, 0, Math.max(1, bounds.height));
  const geometry = coilGeometry(
    Math.max(1, bounds.width),
    Math.max(1, bounds.height),
  );
  const distance = Math.hypot(x - geometry.centerX, y - geometry.centerY);
  return { bounds, x, y, geometry, distance };
}

function trackPositionFromPointer(event) {
  const { x, y, geometry } = canvasPointerSnapshot(event);
  const angle = Math.atan2(y - geometry.centerY, x - geometry.centerX);
  return wrapUnit((angle - COIL_START_ANGLE) / TAU);
}

function pointerIsInsideCore(event) {
  const { distance, geometry } = canvasPointerSnapshot(event);
  return distance <= geometry.coreRadius;
}

function pointerIsOnInteractiveRing(event) {
  const { distance, geometry } = canvasPointerSnapshot(event);
  const hitSlop = Math.max(10, geometry.bodyWidth * 0.18);
  return distance >= geometry.innerRadius - hitSlop
    && distance <= geometry.outerRadius + hitSlop;
}

function pointerInteractionTarget(event) {
  if (pointerIsInsideCore(event)) return "core";
  if (pointerIsOnInteractiveRing(event)) return "ring";
  return null;
}

function trackDistance(first, second) {
  const direct = Math.abs(first - second);
  return Math.min(direct, 1 - direct);
}

function setPluckPosition(position) {
  const normalized = clamp(position, 0, 1);
  state.visualPosition = normalized;
  state.pluckPosition = normalized;
  if (state.audioOn) audio.setPosition(normalized);
  paintPluckPosition(normalized);
  visualizationDirty = true;
  scheduleAnimation();
  return normalized;
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
  $("stageWrap").classList.remove("is-auditioning");
  visualizationDirty = true;
  scheduleAnimation();
}

function cancelTrackInteraction() {
  activeTrackPointer = null;
  lastPointerPosition = null;
  pendingTrackStrike = null;
  $("stageWrap").classList.remove("is-auditioning");
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false) return;
  const target = pointerInteractionTarget(event);
  if (!target) return;
  event.preventDefault();
  canvas.focus?.();
  if (target === "core") {
    if (state.sweeping) reverseMotionDirection();
    else void toggleSweep();
    visualizationDirty = true;
    scheduleAnimation();
    return;
  }
  stopSweep({ announceStop: false });
  activeTrackPointer = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);
  $("stageWrap").classList.add("is-auditioning");
  const position = trackPositionFromPointer(event);
  setPluckPosition(position);
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
  setPluckPosition(position);
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

function handleMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (routeId !== "ouroboros" || message?.type !== "noteOn") return;
  event.preventDefault();
  stopSweep({ announceStop: false });
  const note = clamp(Math.round(Number(message.note) || 60), 0, 127);
  const position = setPluckPosition(clamp((note - 24) / 84, 0, 1));
  const velocity = clamp((Number(message.velocity) || 100) / 127, 0.05, 1);
  void strikeTrackPosition(position, velocity);
  announce(`MIDI pluck at ${formatFrequency(trackFrequencyAtPosition(position))}.`);
}

globalThis.addEventListener?.("morphazoid:midi-input", handleMidiInput);

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
  const minimumDimension = Math.max(1, Math.min(width, height));
  const compact = minimumDimension < 520 || width < 640;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const half = minimumDimension * 0.5;
  const edgePadding = Math.min(compact ? 20 : 28, half * 0.2);
  const outerRadius = Math.max(1, half - edgePadding);
  const minimumBody = Math.min(compact ? 44 : 54, outerRadius * 0.48);
  const maximumBody = Math.max(
    minimumBody,
    Math.min(compact ? 76 : 108, outerRadius * 0.64),
  );
  const bodyWidth = clamp(outerRadius * 0.36, minimumBody, maximumBody);
  const radius = Math.max(1, outerRadius - bodyWidth * 0.5);
  const innerRadius = Math.max(0, radius - bodyWidth * 0.5);
  const coreRadius = Math.max(0, innerRadius - Math.max(8, bodyWidth * 0.12));
  return { centerX, centerY, radius, outerRadius, innerRadius, coreRadius, bodyWidth };
}

function pointOnCoil(normalized, geometry, radialOffset = 0) {
  const amount = clamp(normalized, 0, 1);
  const angle = COIL_START_ANGLE + amount * TAU;
  const radius = Math.max(0, geometry.radius + radialOffset);
  return {
    x: geometry.centerX + Math.cos(angle) * radius,
    y: geometry.centerY + Math.sin(angle) * radius,
    angle,
    tangentAngle: angle + Math.PI * 0.5,
  };
}

function mixFamilyColor(position, alpha = 1) {
  const amount = wrapUnit(position) * FAMILY_COLORS.length;
  const lower = Math.floor(amount) % FAMILY_COLORS.length;
  const upper = (lower + 1) % FAMILY_COLORS.length;
  const mix = amount - lower;
  const channels = FAMILY_COLORS[lower].map((channel, index) => Math.round(
    channel + (FAMILY_COLORS[upper][index] - channel) * mix,
  ));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function traceCoilPath(ctx, geometry, radialOffset = 0, variation = null) {
  const segmentCount = 240;
  ctx.beginPath();
  for (let index = 0; index <= segmentCount; index += 1) {
    const position = index / segmentCount;
    const offset = radialOffset + (variation?.(position) ?? 0);
    const point = pointOnCoil(position, geometry, offset);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function drawPitchGuides(ctx, geometry) {
  ctx.save();
  const guideCount = geometry.radius > 300 ? 72 : 48;
  for (let index = 0; index < guideCount; index += 1) {
    const position = index / guideCount;
    const major = index % 6 === 0;
    const inner = pointOnCoil(
      position,
      geometry,
      -geometry.bodyWidth * (major ? 0.5 : 0.43),
    );
    const outer = pointOnCoil(
      position,
      geometry,
      geometry.bodyWidth * (major ? 0.5 : 0.43),
    );
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = major
      ? "rgba(222, 244, 235, 0.34)"
      : "rgba(214, 232, 226, 0.14)";
    ctx.lineWidth = major ? 1.15 : 0.7;
    ctx.stroke();
  }

  ctx.restore();
}

function drawSerpent(ctx, geometry, safe) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  traceCoilPath(ctx, geometry);
  ctx.strokeStyle = "rgba(2, 5, 6, 0.96)";
  ctx.lineWidth = geometry.bodyWidth + 10;
  ctx.stroke();

  traceCoilPath(ctx, geometry);
  ctx.strokeStyle = "rgba(12, 18, 18, 0.98)";
  ctx.lineWidth = geometry.bodyWidth;
  ctx.stroke();

  const segmentCount = 180;
  ctx.lineCap = "butt";
  for (let index = 0; index < segmentCount; index += 1) {
    const start = index / segmentCount;
    const end = (index + 1.15) / segmentCount;
    const first = pointOnCoil(start, geometry);
    const second = pointOnCoil(Math.min(1, end), geometry);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    ctx.strokeStyle = mixFamilyColor(start, 0.34);
    ctx.lineWidth = geometry.bodyWidth - 2;
    ctx.stroke();
  }

  const laneOffsets = [-0.34, -0.12, 0.12, 0.34];
  for (let lane = 0; lane < laneOffsets.length; lane += 1) {
    const phase = lane * 0.19;
    traceCoilPath(
      ctx,
      geometry,
      laneOffsets[lane] * geometry.bodyWidth,
      (position) => geometry.bodyWidth * (
        Math.sin(TAU * (position + phase)) * 0.045
        + Math.sin(TAU * 2 * (position - phase * 0.5)) * 0.022
      ),
    );
    ctx.strokeStyle = mixFamilyColor(lane / laneOffsets.length + 0.04, 0.84);
    ctx.lineWidth = lane === 0 || lane === laneOffsets.length - 1 ? 1.35 : 1.8;
    ctx.stroke();
  }

  const seamInner = pointOnCoil(0, geometry, -geometry.bodyWidth * 0.48);
  const seamOuter = pointOnCoil(0, geometry, geometry.bodyWidth * 0.48);
  ctx.beginPath();
  ctx.moveTo(seamInner.x, seamInner.y);
  ctx.lineTo(seamOuter.x, seamOuter.y);
  ctx.strokeStyle = "rgba(238, 255, 248, 0.82)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

function drawHitFlash(ctx, geometry, normalized, velocity, alpha) {
  const point = pointOnCoil(normalized, geometry);
  const normalX = -Math.sin(point.tangentAngle);
  const normalY = Math.cos(point.tangentAngle);
  const halfLength = geometry.bodyWidth * (0.34 + velocity * 0.2);
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.shadowColor = mixFamilyColor(normalized, 0.95);
  ctx.shadowBlur = 10 + velocity * 8;
  ctx.strokeStyle = "rgba(244, 255, 249, 0.98)";
  ctx.lineWidth = 1.2 + velocity * 1.8;
  ctx.beginPath();
  ctx.moveTo(
    point.x - normalX * halfLength,
    point.y - normalY * halfLength,
  );
  ctx.lineTo(
    point.x + normalX * halfLength,
    point.y + normalY * halfLength,
  );
  ctx.stroke();
  ctx.restore();
}

function drawPlayhead(ctx, geometry, safe) {
  const normalized = wrapUnit(state.visualPosition);
  const point = pointOnCoil(normalized, geometry);
  const normalX = -Math.sin(point.tangentAngle);
  const normalY = Math.cos(point.tangentAngle);
  const tangentX = Math.cos(point.tangentAngle) * safe.direction;
  const tangentY = Math.sin(point.tangentAngle) * safe.direction;
  const half = geometry.bodyWidth * 0.58;
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
}

function drawStrikeHistory(ctx, geometry) {
  for (const strike of strikeEvents) {
    const life = clamp(1 - strike.age / STRIKE_HISTORY_SECONDS, 0, 1);
    drawHitFlash(
      ctx,
      geometry,
      strike.normalized,
      strike.velocity,
      life * life,
    );
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
  const geometry = coilGeometry(canvasWidth, canvasHeight);
  drawSerpent(context2d, geometry, safe);
  drawPitchGuides(context2d, geometry);
  drawStrikeHistory(context2d, geometry);
  drawPlayhead(context2d, geometry, safe);
}

function ageStrikeEvents(elapsed) {
  for (const strike of strikeEvents) strike.age += elapsed;
  strikeEvents = strikeEvents.filter(({ age }) => age <= STRIKE_HISTORY_SECONDS);
}

function advanceVisualState(elapsed) {
  if (!(elapsed > 0)) return;
  ageStrikeEvents(elapsed);
  if (!state.sweeping) return;
  const safe = currentParameters();

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
  const rawHitPhase = state.visualHitPhase + hitCycles;
  const hitCount = Math.max(0, Math.floor(rawHitPhase));
  const nextHitPhase = rawHitPhase - hitCount;
  state.visualPosition = nextPosition;
  state.pluckPosition = nextPosition;
  state.visualHitPhase = nextHitPhase;
  paintPluckPosition(nextPosition);

  const averageHitRate = hitCycles / elapsed;
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
  if (state.sweeping || strikeEvents.length > 0) {
    advanceVisualState(elapsed);
    visualizationDirty = true;
  }
  draw(timestamp);
  if (state.sweeping || strikeEvents.length > 0 || activeTrackPointer !== null) {
    animationFrame = requestAnimationFrame(animate);
  }
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
    state.sweeping = false;
    lastAudioVisualTime = null;
    return;
  }
  disposed = true;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  resizeObserver?.disconnect();
  globalThis.removeEventListener("resize", resizeCanvas);
  globalThis.removeEventListener("morphazoid:midi-input", handleMidiInput);
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
