import {
  DRUM_ROLL_DEFAULTS,
  DRUM_ROLL_PHASE_SEED,
  DRUM_ROLL_PRESETS,
  DrumRollPleaseAudio,
  calculateDrumRollLayers,
  sanitizeDrumRollParams,
} from "./src/drum-roll-please.js";

const $ = (id) => document.getElementById(id);
const audio = new DrumRollPleaseAudio(globalThis);
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
const TAU = Math.PI * 2;
const HIT_HISTORY_SECONDS = 2.4;
const MAX_HIT_HISTORY_PER_LAYER = 192;
const CHARACTER_COLORS = Object.freeze([
  "#f0c66e",
  "#ff936c",
  "#ece3d0",
  "#72d0dc",
]);

function directionSign(value, fallback = 1) {
  if (value === false || value === "false") return -1;
  if (value === true || value === "true") return 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric < 0 ? -1 : 1;
}

function createMemory(preset = DRUM_ROLL_PRESETS[0] ?? DRUM_ROLL_DEFAULTS) {
  const safe = sanitizeDrumRollParams({
    ...DRUM_ROLL_DEFAULTS,
    ...preset,
  });
  return {
    direction: directionSign(safe.direction, directionSign(DRUM_ROLL_DEFAULTS.direction)),
    driftRate: safe.driftRate,
    centerRate: safe.centerRate,
    width: safe.width,
    decay: safe.decay,
    character: safe.character,
    morphDepth: safe.morphDepth ?? DRUM_ROLL_DEFAULTS.morphDepth ?? 1,
    pitchFollow: Boolean(safe.pitchFollow),
    centerPitch: safe.centerPitch ?? DRUM_ROLL_DEFAULTS.centerPitch ?? 110,
    cutoff: safe.cutoff ?? DRUM_ROLL_DEFAULTS.cutoff ?? 8_000,
    stripeAngle: safe.stripeAngle ?? DRUM_ROLL_DEFAULTS.stripeAngle ?? 38,
    spread: safe.spread,
    presetId: preset?.id ?? null,
  };
}

const state = {
  roll: createMemory(),
  level: sanitizeDrumRollParams(DRUM_ROLL_DEFAULTS).level,
  audioOn: false,
  audioStarting: false,
  visualPosition: 0,
};

let animationFrame = 0;
let lastAnimationTime = 0;
let lastDrawTime = -Infinity;
let canvasWidth = 1;
let canvasHeight = 1;
let canvasScale = 1;
let disposed = false;
let visualizationDirty = true;
let visualPulsePhases = [];
let visualHitHistories = [];
let reducedVisualElapsed = 0;

function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

function compactNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  const fixed = numeric.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function formatPulseRate(value, digits = 2) {
  const rate = Math.max(0, Number(value) || 0);
  return `${compactNumber(rate, rate >= 10 ? Math.min(1, digits) : digits)} hits/s`;
}

function formatTempo(value) {
  const rate = Math.max(0, Number(value) || 0);
  return `${compactNumber(rate * 60, rate * 60 >= 100 ? 0 : 1)} BPM · ${formatPulseRate(rate)}`;
}

function formatGlissandoSpeed(value, direction) {
  const speed = Math.max(0.0001, Number(value) || 0.0001);
  const duration = compactNumber(1 / speed, speed > 0.2 ? 1 : 1);
  return `${speed.toFixed(2)} oct/s · ${direction > 0 ? "doubles" : "halves"} in ${duration} s`;
}

function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  if (frequency >= 1_000) {
    return `${compactNumber(frequency / 1_000, frequency >= 10_000 ? 1 : 2)} kHz`;
  }
  return `${compactNumber(frequency, frequency >= 100 ? 0 : 1)} Hz`;
}

function formatDecay(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 1) return `${Math.round(seconds * 1_000)} ms`;
  return `${compactNumber(seconds, 2)} s`;
}

function characterLabel(value) {
  const amount = Math.max(0, Math.min(1, Number(value) || 0));
  if (amount < 0.22) return "deep skin";
  if (amount < 0.46) return "tom body";
  if (amount < 0.7) return "hand drum";
  if (amount < 0.88) return "dry rattle";
  return "bright air";
}

function morphDepthLabel(value) {
  const amount = Math.max(0, Math.min(1, Number(value) || 0));
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
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function currentParameters() {
  const requested = {
    direction: state.roll.direction,
    driftRate: state.roll.driftRate,
    centerRate: state.roll.centerRate,
    width: state.roll.width,
    decay: state.roll.decay,
    character: state.roll.character,
    morphDepth: state.roll.morphDepth,
    pitchFollow: state.roll.pitchFollow,
    centerPitch: state.roll.centerPitch,
    cutoff: state.roll.cutoff,
    stripeAngle: state.roll.stripeAngle,
    spread: state.roll.spread,
    level: state.level,
  };
  const safe = sanitizeDrumRollParams(requested);
  return {
    ...requested,
    ...safe,
    morphDepth: safe.morphDepth ?? requested.morphDepth,
    pitchFollow: safe.pitchFollow ?? requested.pitchFollow,
    centerPitch: safe.centerPitch ?? requested.centerPitch,
    cutoff: safe.cutoff ?? requested.cutoff,
    stripeAngle: safe.stripeAngle ?? requested.stripeAngle,
  };
}

function currentLayerFrame() {
  return calculateDrumRollLayers({
    position: state.visualPosition,
    ...currentParameters(),
    sampleRate: audio.context?.sampleRate ?? DEFAULT_SAMPLE_RATE,
  });
}

function frameLayers(frame) {
  return Array.isArray(frame?.layers) ? frame.layers : [];
}

function layerRate(layer) {
  const rate = Number(layer?.rate ?? layer?.hitRate ?? layer?.frequency);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function layerWeight(layer) {
  const weight = Number(layer?.weight ?? layer?.gain ?? layer?.amplitude);
  return Number.isFinite(weight) ? Math.max(0, weight) : 0;
}

function layerPan(layer) {
  const pan = Number(layer?.pan);
  return Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
}

function layerIsActive(layer) {
  if (typeof layer?.active === "boolean") return layer.active;
  return layerRate(layer) > 0 && layerWeight(layer) > 1e-6;
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
  const safe = sanitizeDrumRollParams({ ...DRUM_ROLL_DEFAULTS, ...preset });
  const direction = directionSign(safe.direction) > 0 ? "speed up" : "slow down";
  return `${direction} · ${compactNumber(safe.driftRate, 2)} oct/s`;
}

function selectedPreset() {
  return DRUM_ROLL_PRESETS.find(({ id }) => id === state.roll.presetId) ?? null;
}

function renderPresetGrid() {
  const grid = $("presetGrid");
  grid.replaceChildren();
  grid.classList.toggle("is-dense", DRUM_ROLL_PRESETS.length > 6);

  for (const preset of DRUM_ROLL_PRESETS) {
    const button = document.createElement("button");
    const label = document.createElement("b");
    const detail = document.createElement("small");
    button.type = "button";
    button.dataset.preset = preset.id;
    setPressed(button, preset.id === state.roll.presetId);
    label.textContent = presetLabel(preset);
    detail.textContent = presetDetail(preset);
    button.append(label, detail);
    grid.append(button);
  }
}

function updateAudioParameters() {
  audio.setParameters(currentParameters());
}

function updateLayerReadouts(frame) {
  const active = activeLayerCount(frame);
  const total = frameLayers(frame).length;
  const detail = total > 0
    ? `${active} active of ${total}`
    : "power normalized";
  if ($("engineSummary").textContent !== `${active || total} active layers`) {
    $("engineSummary").textContent = `${active || total} active layers`;
  }
  if ($("layerCountDetail").textContent !== detail) {
    $("layerCountDetail").textContent = detail;
  }
}

function updateInterface({ rebuildPresets = false } = {}) {
  const safe = currentParameters();
  const accelerating = safe.direction > 0;

  setPressed($("directionAccelerate"), accelerating);
  setPressed($("directionDecelerate"), !accelerating);
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = state.audioOn ? "on" : "off";

  $("driftRate").value = String(safe.driftRate);
  $("centerRate").value = String(safe.centerRate);
  $("width").value = String(safe.width);
  $("decay").value = String(safe.decay);
  $("character").value = String(safe.character);
  $("morphDepth").value = String(safe.morphDepth);
  $("centerPitch").value = String(safe.centerPitch);
  $("cutoff").value = String(safe.cutoff);
  $("stripeAngle").value = String(safe.stripeAngle);
  $("spread").value = String(safe.spread);
  $("level").value = String(safe.level);

  $("driftRateOut").textContent = formatGlissandoSpeed(safe.driftRate, safe.direction);
  $("centerRateOut").textContent = formatTempo(safe.centerRate);
  $("widthOut").textContent = `${safe.width.toFixed(1)} octaves`;
  $("decayOut").textContent = formatDecay(safe.decay);
  $("characterOut").textContent = characterLabel(safe.character);
  $("morphDepthOut").textContent = `${morphDepthLabel(safe.morphDepth)} · ${Math.round(safe.morphDepth * 100)}%`;
  $("centerPitchOut").textContent = formatFrequency(safe.centerPitch);
  $("cutoffOut").textContent = formatFrequency(safe.cutoff);
  $("stripeAngleOut").textContent = `${Math.round(safe.stripeAngle)}°`;
  $("spreadOut").textContent = `${Math.round(safe.spread * 100)}%`;
  $("levelOut").textContent = `${Math.round(safe.level * 100)}%`;

  setPressed($("pitchFollow"), safe.pitchFollow);
  $("pitchFollowState").textContent = safe.pitchFollow
    ? "On · faster layers sound higher"
    : "Off · timbre changes only";
  $("pitchFollow").querySelector("i").textContent = safe.pitchFollow ? "ON" : "OFF";

  const directionWord = accelerating ? "speed up" : "slow down";
  const directionContinuous = accelerating ? "speeding up" : "slowing down";
  $("motionSummary").textContent = `${directionWord} · ${safe.driftRate.toFixed(2)} oct/s`;
  $("soundSummary").textContent = `${morphDepthLabel(safe.morphDepth).toLowerCase()} morph · pitch ${safe.pitchFollow ? "follows" : "fixed"}`;
  $("directionMarker").textContent = "→";
  $("directionMarker").style.setProperty(
    "--roll-angle",
    `${accelerating ? -safe.stripeAngle : safe.stripeAngle}deg`,
  );
  $("directionMarkerText").textContent = `endlessly ${directionContinuous}`;

  const frame = currentLayerFrame();
  updateLayerReadouts(frame);
  $("stageReadout").textContent = [
    "RHYTHM BANK",
    directionContinuous.toUpperCase(),
    `${safe.driftRate.toFixed(2)} OCT/S`,
    `${formatTempo(safe.centerRate).toUpperCase()} CENTER`,
    safe.pitchFollow ? "PITCH FOLLOWS" : "PITCH FIXED",
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  canvas.setAttribute(
    "aria-label",
    `Crisp diagonal tempo bands ${directionContinuous} endlessly around ${formatTempo(safe.centerRate)}, with ${activeLayerCount(frame)} active Rattlesnake waves morphing through kick, tom, hand, and air.`,
  );

  const preset = selectedPreset();
  $("presetSummary").textContent = preset ? presetLabel(preset) : "Custom";
  if (rebuildPresets) renderPresetGrid();
  else {
    for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
      setPressed(button, button.dataset.preset === state.roll.presetId);
    }
  }

  updateAudioParameters();
  visualizationDirty = true;
  scheduleAnimation();
}

function markCustom() {
  state.roll.presetId = null;
}

function applyPreset(id) {
  const preset = DRUM_ROLL_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  state.roll = createMemory(preset);
  state.level = sanitizeDrumRollParams({
    ...DRUM_ROLL_DEFAULTS,
    ...preset,
  }).level;
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
  state.roll.direction = Number(button.dataset.value) < 0 ? -1 : 1;
  markCustom();
  updateInterface();
  announce(`Tempo now ${state.roll.direction > 0 ? "speeds up" : "slows down"} endlessly.`);
});

$("pitchFollow").addEventListener("click", () => {
  state.roll.pitchFollow = !state.roll.pitchFollow;
  markCustom();
  updateInterface();
  announce(
    state.roll.pitchFollow
      ? "Pitch tracking on. Faster tempo layers now sound higher."
      : "Pitch tracking off. Tempo layers keep a fixed center pitch while timbre changes.",
  );
});

function bindRange(id, onInput) {
  $(id).addEventListener("input", (event) => {
    onInput(Number(event.currentTarget.value));
    updateInterface();
  });
}

bindRange("driftRate", (value) => {
  state.roll.driftRate = value;
  markCustom();
});
bindRange("centerRate", (value) => {
  state.roll.centerRate = value;
  markCustom();
});
bindRange("width", (value) => {
  state.roll.width = value;
  markCustom();
});
bindRange("decay", (value) => {
  state.roll.decay = value;
  markCustom();
});
bindRange("character", (value) => {
  state.roll.character = value;
  markCustom();
});
bindRange("morphDepth", (value) => {
  state.roll.morphDepth = value;
  markCustom();
});
bindRange("centerPitch", (value) => {
  state.roll.centerPitch = value;
  markCustom();
});
bindRange("cutoff", (value) => {
  state.roll.cutoff = value;
  markCustom();
});
bindRange("stripeAngle", (value) => {
  state.roll.stripeAngle = value;
  markCustom();
});
bindRange("spread", (value) => {
  state.roll.spread = value;
  markCustom();
});
bindRange("level", (value) => {
  state.level = value;
});

async function toggleAudio() {
  if (state.audioStarting) return;
  state.audioStarting = true;
  clearAudioError();
  updateInterface();
  try {
    if (state.audioOn) {
      audio.stop();
      state.audioOn = false;
    } else {
      updateAudioParameters();
      await audio.start();
      state.audioOn = true;
      lastAnimationTime = performance.now();
    }
    announce(`Audio ${state.audioOn ? "on" : "off"}.`);
  } catch (error) {
    state.audioOn = false;
    showAudioError(error);
    announce("Audio could not start.");
  } finally {
    state.audioStarting = false;
    updateInterface();
  }
}

$("audioButton").addEventListener("click", toggleAudio);

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  state.roll = createMemory();
  state.level = sanitizeDrumRollParams(DRUM_ROLL_DEFAULTS).level;
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce("Drum Roll Please parameters reset.");
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    state.roll.direction = event.key === "ArrowUp" ? 1 : -1;
    markCustom();
    updateInterface();
    announce(`Tempo now ${state.roll.direction > 0 ? "speeds up" : "slows down"} endlessly.`);
  } else if (event.key === " ") {
    if (event.repeat) return;
    event.preventDefault();
    toggleAudio();
  }
});

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

function ensureVisualPhases(count) {
  while (visualPulsePhases.length < count) {
    visualPulsePhases.push(wrapUnit(
      DRUM_ROLL_PHASE_SEED * 2 ** visualPulsePhases.length,
    ));
    visualHitHistories.push([]);
  }
  if (visualPulsePhases.length > count) {
    visualPulsePhases.length = count;
    visualHitHistories.length = count;
  }
}

function rotateVisualPhases(wraps) {
  if (visualPulsePhases.length < 2 || wraps === 0) return;
  if (wraps > 0) {
    for (let turn = 0; turn < wraps; turn += 1) {
      for (let index = visualPulsePhases.length - 1; index > 0; index -= 1) {
        visualPulsePhases[index] = visualPulsePhases[index - 1];
        visualHitHistories[index] = visualHitHistories[index - 1];
      }
      visualPulsePhases[0] = wrapUnit(visualPulsePhases[1] * 0.5);
      visualHitHistories[0] = [];
    }
  } else {
    for (let turn = 0; turn > wraps; turn -= 1) {
      for (let index = 0; index < visualPulsePhases.length - 1; index += 1) {
        visualPulsePhases[index] = visualPulsePhases[index + 1];
        visualHitHistories[index] = visualHitHistories[index + 1];
      }
      const last = visualPulsePhases.length - 1;
      visualPulsePhases[last] = wrapUnit(visualPulsePhases[last - 1] * 2);
      visualHitHistories[last] = [];
    }
  }
}

function layerMorphPosition(layer, safe) {
  const supplied = Number(layer?.morphPosition ?? layer?.timbrePosition);
  if (Number.isFinite(supplied)) return Math.max(0, Math.min(1, supplied));
  const offset = Number(layer?.octaveOffset);
  if (!Number.isFinite(offset)) return 0.5;
  return Math.max(0, Math.min(1, 0.5 + offset / Math.max(3, safe.width)));
}

function advanceHitHistories(elapsed, layers, safe) {
  for (let index = 0; index < layers.length; index += 1) {
    const history = visualHitHistories[index];
    for (const hit of history) hit.age += elapsed;
    while (history[0]?.age > HIT_HISTORY_SECONDS) history.shift();

    const layer = layers[index];
    const rate = Math.min(64, layerRate(layer));
    if (rate <= 0) continue;
    const rawPhase = visualPulsePhases[index] + elapsed * rate;
    const hitCount = Math.min(MAX_HIT_HISTORY_PER_LAYER, Math.floor(rawPhase));
    const nextPhase = wrapUnit(rawPhase);
    visualPulsePhases[index] = nextPhase;
    if (!layerIsActive(layer)) continue;

    for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
      const age = (hitCount - hitIndex - 1 + nextPhase) / rate;
      if (age > HIT_HISTORY_SECONDS) continue;
      history.push({
        age,
        rate,
        morph: layerMorphPosition(layer, safe),
        weight: layerWeight(layer),
      });
    }
    if (history.length > MAX_HIT_HISTORY_PER_LAYER) {
      history.splice(0, history.length - MAX_HIT_HISTORY_PER_LAYER);
    }
  }
}

function advanceVisualState(elapsed) {
  const safe = currentParameters();
  const rawPosition = (
    state.visualPosition + elapsed * safe.driftRate * safe.direction
  );
  const wraps = Math.floor(rawPosition);
  state.visualPosition = wrapUnit(rawPosition);

  const frame = currentLayerFrame();
  const layers = frameLayers(frame);
  ensureVisualPhases(layers.length);
  if (wraps !== 0) rotateVisualPhases(wraps);
  advanceHitHistories(elapsed, layers, safe);
}

function tempoBounds(_layers, safe) {
  const halfWidth = Math.max(1.5, safe.width * 0.5);
  const minimum = Math.max(0.0625, safe.centerRate * 2 ** -halfWidth);
  const maximum = Math.max(
    minimum * 2,
    Math.min(96, safe.centerRate * 2 ** halfWidth),
  );
  return { minimum, maximum };
}

function logTempoY(rate, top, bottom, bounds) {
  const clamped = Math.max(bounds.minimum, Math.min(bounds.maximum, rate));
  const normalized = (
    Math.log(clamped / bounds.minimum)
    / Math.log(bounds.maximum / bounds.minimum)
  );
  return bottom - normalized * (bottom - top);
}

function fieldGeometry(width, height) {
  const left = Math.max(44, width * 0.07);
  const right = width - Math.max(18, width * 0.035);
  const top = Math.max(58, height * 0.13);
  const bottom = Math.min(height - 82, height * 0.82);
  return { left, right, top, bottom };
}

function drawBarberField(ctx, width, height, safe) {
  const { left, right, top, bottom } = fieldGeometry(width, height);
  const fieldWidth = right - left;
  const fieldHeight = bottom - top;
  const stripePitch = Math.max(38, Math.min(74, fieldWidth / 9));
  const stripeHalfWidth = stripePitch * 0.26;
  const angle = Math.max(12, Math.min(78, safe.stripeAngle)) * Math.PI / 180;
  const diagonalRun = fieldHeight / Math.max(0.2, Math.tan(angle));
  const slopeDirection = safe.direction > 0 ? 1 : -1;
  const travel = state.visualPosition * stripePitch * 4 * safe.direction;
  const first = Math.floor((left - diagonalRun - travel) / stripePitch) - 2;
  const last = Math.ceil((right + diagonalRun - travel) / stripePitch) + 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, fieldWidth, fieldHeight);
  ctx.clip();
  ctx.fillStyle = "rgba(7, 9, 11, 0.72)";
  ctx.fillRect(left, top, fieldWidth, fieldHeight);

  for (let stripe = first; stripe <= last; stripe += 1) {
    const centerX = stripe * stripePitch + travel;
    const xTop = centerX + diagonalRun * 0.5 * slopeDirection;
    const xBottom = centerX - diagonalRun * 0.5 * slopeDirection;
    const colorIndex = ((stripe % CHARACTER_COLORS.length) + CHARACTER_COLORS.length)
      % CHARACTER_COLORS.length;
    ctx.globalAlpha = colorIndex === 2 ? 0.12 : 0.2;
    ctx.fillStyle = CHARACTER_COLORS[colorIndex];
    ctx.beginPath();
    ctx.moveTo(xTop - stripeHalfWidth, top);
    ctx.lineTo(xTop + stripeHalfWidth, top);
    ctx.lineTo(xBottom + stripeHalfWidth, bottom);
    ctx.lineTo(xBottom - stripeHalfWidth, bottom);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = CHARACTER_COLORS[colorIndex];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(xTop + stripeHalfWidth) + 0.5, top);
    ctx.lineTo(Math.round(xBottom + stripeHalfWidth) + 0.5, bottom);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(214, 232, 226, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(left) + 0.5,
    Math.round(top) + 0.5,
    Math.max(1, Math.round(fieldWidth) - 1),
    Math.max(1, Math.round(fieldHeight) - 1),
  );
  ctx.restore();
}

function drawHitGlyph(ctx, x, y, size, morph, alpha, stripeAngle, direction) {
  const stage = Math.max(0, Math.min(3, Math.floor(morph * 4)));
  const color = CHARACTER_COLORS[stage];
  const angle = stripeAngle * Math.PI / 180 * (direction > 0 ? -1 : 1);
  ctx.save();
  ctx.translate(Math.round(x) + 0.5, Math.round(y) + 0.5);
  ctx.globalAlpha = Math.max(0.14, Math.min(1, alpha));
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.min(2, size * 0.26));

  if (stage === 0) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.58, 0, TAU);
    ctx.fill();
  } else if (stage === 1) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.62, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(0.8, size * 0.18), 0, TAU);
    ctx.fill();
  } else if (stage === 2) {
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.3);
    ctx.lineTo(size, -size * 0.3);
    ctx.moveTo(-size * 0.72, size * 0.45);
    ctx.lineTo(size * 0.72, size * 0.45);
    ctx.stroke();
  } else {
    ctx.rotate(angle);
    for (let line = -1; line <= 1; line += 1) {
      const offset = line * size * 0.58;
      ctx.beginPath();
      ctx.moveTo(offset - size * 0.42, -size * 0.8);
      ctx.lineTo(offset + size * 0.42, size * 0.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRhythmField(ctx, width, height, safe, layers, bounds) {
  const { left, right, top, bottom } = fieldGeometry(width, height);
  const halfSteps = Math.max(2, Math.ceil(safe.width * 0.5));

  ctx.save();
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let octave = -halfSteps; octave <= halfSteps; octave += 1) {
    const rate = safe.centerRate * 2 ** octave;
    if (rate < bounds.minimum * 0.94 || rate > bounds.maximum * 1.06) continue;
    const y = Math.round(logTempoY(rate, top, bottom, bounds)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.strokeStyle = octave === 0
      ? "rgba(255, 214, 119, 0.17)"
      : "rgba(214, 232, 226, 0.07)";
    ctx.lineWidth = octave === 0 ? 1.2 : 1;
    ctx.stroke();
    ctx.fillStyle = octave === 0
      ? "rgba(255, 214, 119, 0.58)"
      : "rgba(214, 232, 226, 0.3)";
    ctx.fillText(`${compactNumber(rate * 60, 0)} BPM`, left - 7, y);
  }

  const active = layers.filter(layerIsActive);
  const maximumWeight = Math.max(1e-6, ...active.map(layerWeight));
  ensureVisualPhases(layers.length);
  ctx.lineCap = "butt";

  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const rate = layerRate(layer);
    if (rate <= 0) continue;
    const weight = layerWeight(layer);
    const strength = Math.min(1, weight / maximumWeight);
    const activeLayer = layerIsActive(layer);
    const y = Math.round(logTempoY(rate, top, bottom, bounds)) + 0.5;
    const panShift = layerPan(layer) * Math.min(20, width * 0.025);
    const laneLeft = left + panShift;
    const laneRight = right + panShift;

    ctx.beginPath();
    ctx.moveTo(laneLeft, y);
    ctx.lineTo(laneRight, y);
    ctx.strokeStyle = activeLayer
      ? `rgba(214, 232, 226, ${0.06 + strength * 0.12})`
      : "rgba(119, 131, 126, 0.035)";
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!activeLayer) continue;
    const history = visualHitHistories[index] ?? [];
    for (const hit of history) {
      const life = Math.max(0, 1 - hit.age / HIT_HISTORY_SECONDS);
      const x = laneRight - hit.age / HIT_HISTORY_SECONDS * (laneRight - laneLeft);
      const hitY = Math.max(top, Math.min(bottom, logTempoY(hit.rate, top, bottom, bounds)));
      const hitStrength = Math.min(1, hit.weight / maximumWeight);
      drawHitGlyph(
        ctx,
        x,
        hitY,
        3.5 + hitStrength * 4.5,
        hit.morph,
        (0.28 + life * 0.72) * (0.5 + hitStrength * 0.5),
        safe.stripeAngle,
        safe.direction,
      );
    }
  }

  ctx.fillStyle = CHARACTER_COLORS[0];
  ctx.globalAlpha = 0.66;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("SLOW · KICK", left, bottom + 18);
  ctx.fillStyle = CHARACTER_COLORS[3];
  ctx.textAlign = "right";
  ctx.fillText("FAST · AIR", right, top - 10);
  ctx.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || document.hidden || disposed) return;
  if (!force && !visualizationDirty && timestamp - lastDrawTime < DRAW_INTERVAL) return;
  if (!force && timestamp - lastDrawTime < DRAW_INTERVAL) return;
  lastDrawTime = timestamp;
  visualizationDirty = false;
  context2d.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);

  const safe = currentParameters();
  const frame = currentLayerFrame();
  const layers = frameLayers(frame);
  const bounds = tempoBounds(layers, safe);
  updateLayerReadouts(frame);
  drawBarberField(context2d, canvasWidth, canvasHeight, safe);
  drawRhythmField(context2d, canvasWidth, canvasHeight, safe, layers, bounds);
}

function animate(timestamp) {
  animationFrame = 0;
  if (disposed || document.hidden) return;
  const elapsed = lastAnimationTime > 0
    ? Math.min(0.1, (timestamp - lastAnimationTime) / 1_000)
    : 0;
  lastAnimationTime = timestamp;
  if (state.audioOn) {
    if (reducedMotion) {
      reducedVisualElapsed += elapsed;
      if (reducedVisualElapsed >= 0.2) {
        const safe = currentParameters();
        const layers = frameLayers(currentLayerFrame());
        ensureVisualPhases(layers.length);
        advanceHitHistories(reducedVisualElapsed, layers, safe);
        reducedVisualElapsed = 0;
        visualizationDirty = true;
      }
    } else {
      advanceVisualState(elapsed);
      visualizationDirty = true;
    }
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
  if (event.persisted) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    audio.stop();
    state.audioOn = false;
    state.audioStarting = false;
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
  reducedVisualElapsed = 0;
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
