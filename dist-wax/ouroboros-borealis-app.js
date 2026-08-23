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
const setText = (id, value) => {
  const element = $(id);
  if (element) element.textContent = value;
};
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
const RING_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "aurora", name: "Aurora", color: "#77e5e3", channel: "pitch", rateScale: 0.55, phase: 0.03 }),
  Object.freeze({ id: "verdant", name: "Verdant", color: "#9df09e", channel: "rhythm", rateScale: 0.9, phase: 0.21 }),
  Object.freeze({ id: "violet", name: "Violet", color: "#b498ff", channel: "pitch", rateScale: 1, phase: 0.43, invert: true }),
  Object.freeze({ id: "magenta", name: "Magenta", color: "#ff91cd", channel: "rhythm", rateScale: 1.5, phase: 0.64, invert: true }),
  Object.freeze({ id: "solar", name: "Solar", color: "#f5d878", channel: "pitch", rateScale: 1.75, phase: 0.82 }),
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

function createRings(parameters = OUROBOROS_BOREALIS_DEFAULTS) {
  const safe = sanitizeOuroborosBorealisParams(parameters);
  return RING_DEFINITIONS.map((definition, index) => {
    const baseDirection = definition.channel === "pitch"
      ? safe.pitchDirection
      : safe.rhythmDirection;
    const baseSpeed = definition.channel === "pitch"
      ? safe.pitchGlissRate
      : safe.rhythmGlissRate;
    return {
      ...definition,
      index,
      direction: definition.invert ? -baseDirection : baseDirection,
      speed: clamp(baseSpeed * definition.rateScale, 0.02, 1.2),
      phase: wrapUnit(definition.phase + seed),
      travel: 0,
    };
  });
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
  playing: false,
  pitchPosition: wrapUnit(seed),
  rhythmPosition: wrapUnit(seed),
  pitchTravel: 0,
  rhythmTravel: 0,
  pulsePhase: seed,
  rings: [],
  selectedRing: 0,
  pointerRing: null,
  pointerPosition: null,
};
state.rings = createRings(state.parameters);

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
let lastPointerTime = null;
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

function selectedRing() {
  return state.rings[state.selectedRing] ?? state.rings[0];
}

function ringDirectionLabel(ring, compact = false) {
  if (!ring) return "clockwise";
  if (compact) return ring.direction > 0 ? "RIGHT ↻" : "LEFT ↺";
  return ring.direction > 0 ? "right / clockwise" : "left / counterclockwise";
}

function renderRingControls() {
  const container = $("ringControls");
  if (!container) return;
  container.replaceChildren();
  for (const ring of state.rings) {
    const row = document.createElement("div");
    const selector = document.createElement("button");
    const swatch = document.createElement("i");
    const name = document.createElement("b");
    const direction = document.createElement("button");
    const speedLabel = document.createElement("label");
    const speed = document.createElement("input");
    const output = document.createElement("output");

    row.className = "borealis-ring-row";
    row.dataset.ringRow = String(ring.index);
    row.style.setProperty("--ring-color", ring.color);
    selector.type = "button";
    selector.className = "borealis-ring-select";
    selector.dataset.ringSelect = String(ring.index);
    selector.setAttribute("aria-label", `Select ${ring.name} ring`);
    swatch.style.setProperty("--ring-color", ring.color);
    name.textContent = ring.name;
    selector.append(swatch, name);

    direction.type = "button";
    direction.className = "borealis-ring-direction";
    direction.dataset.ringDirection = String(ring.index);
    direction.setAttribute("aria-label", `Reverse ${ring.name} ring`);

    speedLabel.className = "borealis-ring-speed";
    speedLabel.setAttribute("for", `ringSpeed${ring.index}`);
    speed.type = "range";
    speed.id = `ringSpeed${ring.index}`;
    speed.dataset.ringSpeed = String(ring.index);
    speed.min = "0.02";
    speed.max = "1.2";
    speed.step = "0.01";
    speed.setAttribute("aria-label", `${ring.name} ring speed`);
    output.id = `ringSpeedOut${ring.index}`;
    output.setAttribute("for", speed.id);
    speedLabel.append(speed, output);
    row.append(selector, direction, speedLabel);
    container.append(row);
  }
}

function updateRingControls() {
  const active = selectedRing();
  for (const ring of state.rings) {
    const row = document.querySelector(`[data-ring-row="${ring.index}"]`);
    row?.classList.toggle("is-selected", ring.index === state.selectedRing);
    const selector = document.querySelector(`[data-ring-select="${ring.index}"]`);
    setPressed(selector, ring.index === state.selectedRing);
    const direction = document.querySelector(`[data-ring-direction="${ring.index}"]`);
    if (direction) {
      direction.textContent = ring.direction > 0 ? "↻ Right" : "↺ Left";
      setPressed(direction, ring.direction > 0);
    }
    const speed = document.querySelector(`[data-ring-speed="${ring.index}"]`);
    if (speed && document.activeElement !== speed) speed.value = ring.speed.toFixed(2);
    setText(`ringSpeedOut${ring.index}`, `${ring.speed.toFixed(2)} rev/s`);
  }
  if (!active) return;
  setText("selectedRingName", `${active.name} ring`);
  setText("selectedRingMotion", `${ringDirectionLabel(active)} · ${active.speed.toFixed(2)} rev/s`);
  setText("ringSummary", `5 independent rings · ${active.name.toLowerCase()} selected`);
  setText("directionMarker", active.direction > 0 ? "↻" : "↺");
  setText("directionMarkerText", `${active.name.toLowerCase()} · ${ringDirectionLabel(active)}`);
}

function selectRing(index, { announceSelection = false } = {}) {
  state.selectedRing = Math.round(clamp(index, 0, state.rings.length - 1));
  updateRingControls();
  visualizationDirty = true;
  scheduleAnimation();
  if (announceSelection) {
    const ring = selectedRing();
    announce(`${ring.name} ring selected: ${ringDirectionLabel(ring)} at ${ring.speed.toFixed(2)} revolutions per second.`);
  }
}

function applyGlobalMotionToRings(channel) {
  for (const ring of state.rings) {
    if (ring.channel !== channel) continue;
    const baseDirection = channel === "pitch"
      ? state.parameters.pitchDirection
      : state.parameters.rhythmDirection;
    const baseSpeed = channel === "pitch"
      ? state.parameters.pitchGlissRate
      : state.parameters.rhythmGlissRate;
    ring.direction = ring.invert ? -baseDirection : baseDirection;
    ring.speed = clamp(baseSpeed * ring.rateScale, 0.02, 1.2);
  }
}

function projectRingMotionToEngine(ring) {
  if (!ring) return;
  if (ring.channel === "pitch") {
    state.parameters.pitchDirection = ring.direction;
    state.parameters.pitchGlissRate = ring.speed;
  } else {
    state.parameters.rhythmDirection = ring.direction;
    state.parameters.rhythmGlissRate = ring.speed;
  }
  markCustom();
}

$("ringControls")?.addEventListener("click", (event) => {
  const selector = event.target.closest("[data-ring-select]");
  if (selector) {
    selectRing(Number(selector.dataset.ringSelect), { announceSelection: true });
    return;
  }
  const directionButton = event.target.closest("[data-ring-direction]");
  if (!directionButton) return;
  const index = Number(directionButton.dataset.ringDirection);
  const ring = state.rings[index];
  if (!ring) return;
  ring.direction *= -1;
  selectRing(index);
  projectRingMotionToEngine(ring);
  updateInterface();
  announce(`${ring.name} ring now moves ${ringDirectionLabel(ring)}.`);
});

$("ringControls")?.addEventListener("input", (event) => {
  const speedControl = event.target.closest("[data-ring-speed]");
  if (!speedControl) return;
  const index = Number(speedControl.dataset.ringSpeed);
  const ring = state.rings[index];
  if (!ring) return;
  ring.speed = clamp(speedControl.value, 0.02, 1.2);
  state.selectedRing = index;
  projectRingMotionToEngine(ring);
  updateInterface();
});

function updateAudioParameters() {
  audio.setParameters(currentParameters());
}

function updateInterface({ rebuildPresets = false } = {}) {
  const safe = currentParameters();
  const pitchRising = safe.pitchDirection > 0;
  const rhythmAccelerating = safe.rhythmDirection > 0;

  setPressed($("pitchRise"), pitchRising);
  setPressed($("pitchFall"), !pitchRising);
  setPressed($("rhythmAccelerate"), rhythmAccelerating);
  setPressed($("rhythmDecelerate"), !rhythmAccelerating);
  setPressed($("audioButton"), state.audioOn);
  setPressed($("transportButton"), state.playing);

  $("audioButton").disabled = state.audioStarting;
  $("transportButton").disabled = state.audioStarting;
  $("audioButton").dataset.audioState = state.audioStarting ? "starting" : state.audioOn ? "on" : "off";
  $("audioButton").setAttribute("aria-label", state.audioOn ? "Turn Ouroboros Borealis audio off" : "Turn Ouroboros Borealis audio on");
  $("audioAction").textContent = "Audio";
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("transportIcon").textContent = state.audioStarting ? "…" : state.playing ? "Ⅱ" : "▶";
  $("transportLabel").textContent = state.audioStarting ? "Starting" : state.playing ? "Pause" : "Play";
  $("transportButton").setAttribute(
    "aria-label",
    state.playing
      ? "Pause the five Ouroboros Borealis rings"
      : "Play the five Ouroboros Borealis rings",
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

  $("engineSummary").textContent = `${state.rings.length} independent rings`;
  $("pitchSummary").textContent = `${pitchRising ? "rise" : "fall"} · ${safe.pitchGlissRate.toFixed(2)} oct/s · ${safe.pitchInterval.toFixed(2)} oct voices`;
  $("rhythmSummary").textContent = `${rhythmAccelerating ? "speed up" : "slow down"} · ${safe.rhythmGlissRate.toFixed(2)} oct/s · ${compactNumber(safe.centerRate, 2)} hits/s center`;
  $("relationshipSummary").textContent = `${couplingLabel(safe.coupling).toLowerCase()} · ${phaseLabel(safe.phaseOffset)}`;
  $("soundSummary").textContent = `${morphLabel(safe.morphDepth).toLowerCase()} morph · ${characterLabel(safe.character).toLowerCase()}`;
  setText("pitchLegend", pitchRising ? "rising" : "falling");
  setText("rhythmLegend", rhythmAccelerating ? "speeding" : "slowing");
  setText("playSummary", state.playing ? "five rings in motion" : "ready · drag any ring");
  $("stageReadout").textContent = [
    "5 NESTED OUROBOROS RINGS",
    `${selectedRing()?.name?.toUpperCase() ?? "AURORA"} ${ringDirectionLabel(selectedRing(), true)}`,
    `${selectedRing()?.speed.toFixed(2) ?? "0.09"} REV/S`,
    state.playing ? "PLAYING" : "PAUSED",
    `AUDIO ${state.audioOn ? "ON" : "OFF"}`,
  ].join(" · ");
  canvas.setAttribute(
    "aria-label",
    `Five nested circular Ouroboros rings rotate independently. ${selectedRing()?.name ?? "Aurora"} is selected, moving ${ringDirectionLabel(selectedRing())} at ${selectedRing()?.speed.toFixed(2) ?? "0.09"} revolutions per second. Drag around a ring slowly or quickly to change its speed; reverse your drag to reverse its direction.`,
  );
  updateRingControls();

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
  if (!state.playing) return;
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
  state.rings = createRings(state.parameters);
  state.selectedRing = 0;
  renderRingControls();
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
  applyGlobalMotionToRings(kind);
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
    if (key === "pitchGlissRate") applyGlobalMotionToRings("pitch");
    if (key === "rhythmGlissRate") applyGlobalMotionToRings("rhythm");
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
      await audio.enable();
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
      announce("Ouroboros Borealis audio is on.");
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
    state.playing = false;
    lastAudioVisualTime = null;
    updateInterface();
    announce("Ouroboros Borealis audio is off.");
    return;
  }
  await startAudio();
}

$("audioButton").addEventListener("click", toggleAudio);

async function toggleTransport() {
  if (state.audioStarting) return;
  if (state.playing) {
    synchronizeVisualClock();
    audio.stopTransport();
    state.playing = false;
    lastAudioVisualTime = null;
    updateInterface();
    announce("The five rings are paused.");
    return;
  }
  if (!await startAudio()) return;
  audio.setTransport(true);
  state.playing = true;
  lastAnimationTime = performance.now();
  lastAudioVisualTime = Number.isFinite(audio.context?.currentTime)
    ? audio.context.currentTime
    : null;
  updateInterface();
  scheduleAnimation();
  announce("The five rings are playing independently.");
}

$("transportButton").addEventListener("click", toggleTransport);

function addStrikeEvent(velocity = 0.86, position = null, lane = "both", age = 0, ringIndex = null) {
  const safePosition = position === null ? null : wrapUnit(position);
  strikeEvents.push({
    age,
    lane,
    ringIndex,
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

async function strikeCurrentField(velocity = 0.9) {
  if (!await startAudio()) return false;
  const struck = audio.strike(velocity);
  if (!struck) return false;
  addStrikeEvent(velocity);
  scheduleAnimation();
  announce("Ouroboros Borealis struck across its pitch and rhythm field.");
  return true;
}

function strikeTrackPosition(lane, position, velocity = 0.8, ringIndex = state.selectedRing) {
  pendingTrackStrike = {
    lane,
    ringIndex,
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
        addStrikeEvent(
          audition.velocity,
          audition.position,
          audition.lane,
          0,
          audition.ringIndex,
        );
        struck = true;
      }
    }
    if (struck) {
      scheduleAnimation();
    }
    return struck;
  })().finally(() => {
    if (trackStrikePromise === promise) trackStrikePromise = null;
  });
  trackStrikePromise = promise;
  return promise;
}

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  synchronizeVisualClock();
  const priorPhaseOffset = Number(state.parameters.phaseOffset) || 0;
  state.parameters = createMemory();
  state.rings = createRings(state.parameters);
  state.selectedRing = 0;
  renderRingControls();
  shiftRhythmVisualPhases(initialSafe.phaseOffset - priorPhaseOffset);
  state.level = initialSafe.level;
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce("Ouroboros Borealis parameters reset.");
});

function adjustSelectedRingSignedSpeed(amount) {
  const ring = selectedRing();
  let signedSpeed = ring.direction * ring.speed + amount;
  signedSpeed = clamp(signedSpeed, -1.2, 1.2);
  if (Math.abs(signedSpeed) < 0.02) signedSpeed = amount < 0 ? -0.02 : 0.02;
  ring.direction = signedSpeed < 0 ? -1 : 1;
  ring.speed = Math.abs(signedSpeed);
  projectRingMotionToEngine(ring);
  updateInterface();
  announce(`${ring.name} ring: ${ringDirectionLabel(ring)} at ${ring.speed.toFixed(2)} revolutions per second.`);
}

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const step = event.key === "ArrowUp" ? -1 : 1;
    selectRing(wrapUnit((state.selectedRing + step) / state.rings.length) * state.rings.length, {
      announceSelection: true,
    });
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    adjustSelectedRingSignedSpeed(event.key === "ArrowRight" ? 0.02 : -0.02);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) void strikeCurrentField();
  } else if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    if (!event.repeat) void toggleTransport();
  }
});

function handleMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (routeId !== "ouroboros-borealis" || message?.type !== "noteOn") return;
  event.preventDefault();
  const note = clamp(Math.round(Number(message.note) || 60), 0, 127);
  const velocity = clamp((Number(message.velocity) || 100) / 127, 0.05, 1);
  const ringIndex = note % state.rings.length;
  const position = clamp((note - 24) / 84, 0, 1);
  selectRing(ringIndex);
  const ring = selectedRing();
  void strikeTrackPosition(ring.channel, position, velocity, ringIndex);
  announce(`MIDI struck the ${ring.name} ring.`);
}

globalThis.addEventListener?.("morphazoid:midi-input", handleMidiInput);

function ringGeometry(width, height) {
  const compact = width < 640;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const horizontalRadius = Math.max(70, (width - (compact ? 42 : 72)) * 0.5);
  const verticalRadius = Math.max(70, (height - (compact ? 56 : 76)) * 0.5);
  const outerRadius = Math.max(70, Math.min(horizontalRadius, verticalRadius));
  const innerRadius = outerRadius * 0.43;
  const separation = (outerRadius - innerRadius) / Math.max(1, RING_DEFINITIONS.length - 1);
  const radii = RING_DEFINITIONS.map((_, index) => outerRadius - separation * index);
  return {
    centerX,
    centerY,
    outerRadius,
    innerRadius,
    separation,
    radii,
    trackWidth: clamp(separation * 0.36, 5, 11),
  };
}

function pointOnRing(ringIndex, normalized, geometry, radialOffset = 0) {
  const phase = wrapUnit(normalized);
  const angle = -Math.PI * 0.5 + phase * TAU;
  const radius = geometry.radii[ringIndex] + radialOffset;
  return {
    x: geometry.centerX + Math.cos(angle) * radius,
    y: geometry.centerY + Math.sin(angle) * radius,
    tangentAngle: angle + Math.PI * 0.5,
    angle,
    radius,
  };
}

function ringPositionFromPointer(event, lockedRing = null) {
  const bounds = canvas.getBoundingClientRect();
  const x = clamp(event.clientX - bounds.left, 0, Math.max(1, bounds.width));
  const y = clamp(event.clientY - bounds.top, 0, Math.max(1, bounds.height));
  const geometry = ringGeometry(Math.max(1, bounds.width), Math.max(1, bounds.height));
  const deltaX = x - geometry.centerX;
  const deltaY = y - geometry.centerY;
  const pointerRadius = Math.hypot(deltaX, deltaY);
  const position = wrapUnit((Math.atan2(deltaY, deltaX) + Math.PI * 0.5) / TAU);
  const ringIndex = lockedRing === null
    ? geometry.radii.reduce((closest, radius, index) => (
        Math.abs(radius - pointerRadius) < Math.abs(geometry.radii[closest] - pointerRadius)
          ? index
          : closest
      ), 0)
    : Math.round(clamp(lockedRing, 0, geometry.radii.length - 1));
  return {
    ringIndex,
    position,
    distance: Math.abs(geometry.radii[ringIndex] - pointerRadius),
  };
}

function signedRingDelta(next, previous) {
  let delta = wrapUnit(next) - wrapUnit(previous);
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
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
  lastPointerTime = null;
  state.pointerRing = null;
  state.pointerPosition = null;
  $("stageWrap").classList.remove("is-dragging-ring");
  visualizationDirty = true;
  scheduleAnimation();
}

function cancelTrackInteraction() {
  activeTrackPointer = null;
  lastPointerPosition = null;
  lastPointerTime = null;
  pendingTrackStrike = null;
  state.pointerRing = null;
  state.pointerPosition = null;
  $("stageWrap").classList.remove("is-dragging-ring");
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false) return;
  event.preventDefault();
  canvas.focus?.();
  activeTrackPointer = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);
  $("stageWrap").classList.add("is-dragging-ring");
  const target = ringPositionFromPointer(event);
  selectRing(target.ringIndex);
  const ring = selectedRing();
  ring.phase = target.position;
  state.pointerRing = target.ringIndex;
  state.pointerPosition = target.position;
  lastPointerPosition = target.position;
  lastPointerTime = performance.now();
  lastPointerStrikeTime = performance.now();
  visualizationDirty = true;
  scheduleAnimation();
  void strikeTrackPosition(ring.channel, target.position, 0.84, ring.index);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activeTrackPointer) return;
  event.preventDefault();
  const target = ringPositionFromPointer(event, state.pointerRing);
  const ring = state.rings[target.ringIndex];
  const delta = signedRingDelta(target.position, lastPointerPosition ?? target.position);
  const movement = Math.abs(delta);
  const now = performance.now();
  const elapsed = Math.max(8, now - (lastPointerTime ?? now));
  if (movement > 0.0002) {
    const gestureSpeed = clamp(movement / (elapsed / 1_000), 0.02, 1.2);
    ring.direction = delta > 0 ? 1 : -1;
    ring.speed = clamp(ring.speed * 0.28 + gestureSpeed * 0.72, 0.02, 1.2);
    ring.travel += delta;
    ring.phase = target.position;
    projectRingMotionToEngine(ring);
  }
  state.pointerRing = target.ringIndex;
  state.pointerPosition = target.position;
  visualizationDirty = true;
  lastPointerPosition = target.position;
  lastPointerTime = now;
  if (movement >= 0.008 && now - lastPointerStrikeTime >= 32) {
    const pressure = Number.isFinite(event.pressure) ? event.pressure : 0.5;
    const velocity = clamp(0.55 + movement * 4 + pressure * 0.18, 0.55, 0.96);
    lastPointerStrikeTime = now;
    void strikeTrackPosition(ring.channel, target.position, velocity, ring.index);
  }
  updateInterface();
});

canvas.addEventListener("pointerup", releaseTrackPointer);
canvas.addEventListener("pointercancel", releaseTrackPointer);

function layerArray(frame, lane) {
  const layers = lane === "pitch" ? frame?.pitchLayers : frame?.rhythmLayers;
  return Array.isArray(layers) ? layers : [];
}

function ringRgba(hex, alpha = 1) {
  const value = String(hex).replace("#", "");
  const numeric = Number.parseInt(value, 16);
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawNestedRing(ctx, ring, geometry) {
  const radius = geometry.radii[ring.index];
  const selected = ring.index === state.selectedRing;
  const width = geometry.trackWidth * (selected ? 1.08 : 0.78);
  ctx.save();

  ctx.beginPath();
  ctx.arc(geometry.centerX, geometry.centerY, radius, 0, TAU);
  ctx.strokeStyle = "rgba(1, 4, 6, 0.94)";
  ctx.lineWidth = width + (selected ? 7 : 5);
  ctx.stroke();

  ctx.shadowColor = ringRgba(ring.color, selected ? 0.72 : 0.46);
  ctx.shadowBlur = selected ? 18 : 10;
  ctx.beginPath();
  ctx.arc(geometry.centerX, geometry.centerY, radius, 0, TAU);
  ctx.strokeStyle = ringRgba(ring.color, selected ? 0.68 : 0.38);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.setLineDash([Math.max(2, radius * 0.035), Math.max(5, radius * 0.065)]);
  ctx.lineDashOffset = -ring.travel * radius * TAU;
  ctx.beginPath();
  ctx.arc(geometry.centerX, geometry.centerY, radius, 0, TAU);
  ctx.strokeStyle = ringRgba(ring.color, selected ? 0.92 : 0.66);
  ctx.lineWidth = Math.max(1, width * 0.34);
  ctx.stroke();
  ctx.setLineDash([]);

  const head = pointOnRing(ring.index, ring.phase, geometry);
  const trailLength = clamp(0.07 + ring.speed * 0.12, 0.08, 0.22) * TAU;
  ctx.beginPath();
  if (ring.direction > 0) {
    ctx.arc(geometry.centerX, geometry.centerY, radius, head.angle - trailLength, head.angle);
  } else {
    ctx.arc(geometry.centerX, geometry.centerY, radius, head.angle + trailLength, head.angle, true);
  }
  ctx.strokeStyle = ringRgba(ring.color, 0.96);
  ctx.lineWidth = width * 1.28;
  ctx.lineCap = "round";
  ctx.stroke();

  const tangentX = Math.cos(head.tangentAngle) * ring.direction;
  const tangentY = Math.sin(head.tangentAngle) * ring.direction;
  const normalX = -tangentY;
  const normalY = tangentX;
  const markerSize = clamp(geometry.separation * 0.24, 5, 9);
  ctx.shadowColor = ring.color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = ring.color;
  ctx.beginPath();
  ctx.moveTo(head.x + tangentX * markerSize, head.y + tangentY * markerSize);
  ctx.lineTo(
    head.x - tangentX * markerSize * 0.7 + normalX * markerSize * 0.62,
    head.y - tangentY * markerSize * 0.7 + normalY * markerSize * 0.62,
  );
  ctx.lineTo(
    head.x - tangentX * markerSize * 0.7 - normalX * markerSize * 0.62,
    head.y - tangentY * markerSize * 0.7 - normalY * markerSize * 0.62,
  );
  ctx.closePath();
  ctx.fill();

  if (selected) {
    ctx.shadowBlur = 0;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(geometry.centerX, geometry.centerY, radius + width + 4, 0, TAU);
    ctx.strokeStyle = ringRgba(ring.color, 0.42);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawRingStrikeHistory(ctx, geometry) {
  for (const strike of strikeEvents) {
    const life = clamp(1 - strike.age / STRIKE_HISTORY_SECONDS, 0, 1);
    const ringIndex = Number.isInteger(strike.ringIndex)
      ? Math.round(clamp(strike.ringIndex, 0, state.rings.length - 1))
      : state.selectedRing;
    const ring = state.rings[ringIndex];
    const point = pointOnRing(ringIndex, strike.pitchPosition, geometry);
    const size = 3 + strike.velocity * 8 + (1 - life) * 11;
    ctx.save();
    ctx.globalAlpha = life * (0.45 + strike.strength * 0.55);
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point.x - size * 0.45, point.y);
    ctx.lineTo(point.x + size * 0.45, point.y);
    ctx.moveTo(point.x, point.y - size * 0.45);
    ctx.lineTo(point.x, point.y + size * 0.45);
    ctx.stroke();
    ctx.restore();
  }
}

function drawRingPointer(ctx, geometry) {
  if (state.pointerRing === null || state.pointerPosition === null) return;
  const ring = state.rings[state.pointerRing];
  const point = pointOnRing(ring.index, state.pointerPosition, geometry);
  ctx.save();
  ctx.strokeStyle = ring.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, geometry.trackWidth * 1.75, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ringRgba(ring.color, 0.95);
  ctx.font = "600 7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    `${ringDirectionLabel(ring, true)} · ${ring.speed.toFixed(2)}`,
    point.x,
    point.y - geometry.trackWidth * 2.5,
  );
  ctx.restore();
}

function drawNestedRingField(ctx, geometry) {
  ctx.save();
  const glow = ctx.createRadialGradient(
    geometry.centerX,
    geometry.centerY,
    geometry.innerRadius * 0.2,
    geometry.centerX,
    geometry.centerY,
    geometry.outerRadius * 1.08,
  );
  glow.addColorStop(0, "rgba(119, 229, 227, 0.035)");
  glow.addColorStop(0.58, "rgba(180, 152, 255, 0.025)");
  glow.addColorStop(1, "rgba(245, 216, 120, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(geometry.centerX, geometry.centerY, geometry.outerRadius * 1.08, 0, TAU);
  ctx.fill();
  ctx.restore();
  for (const ring of state.rings) drawNestedRing(ctx, ring, geometry);
  drawRingStrikeHistory(ctx, geometry);
  drawRingPointer(ctx, geometry);
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

  const geometry = ringGeometry(canvasWidth, canvasHeight);
  drawNestedRingField(context2d, geometry);
}

function ageStrikeEvents(elapsed) {
  for (const strike of strikeEvents) strike.age += elapsed;
  strikeEvents = strikeEvents.filter(({ age }) => age <= STRIKE_HISTORY_SECONDS);
}

function advanceVisualState(elapsed) {
  if (!(elapsed > 0)) return;
  ageStrikeEvents(elapsed);
  if (!state.playing) return;
  const safe = currentParameters();
  for (const ring of state.rings) {
    const delta = ring.direction * ring.speed * elapsed;
    ring.phase = wrapUnit(ring.phase + delta);
    ring.travel += delta;
  }
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
  if (state.playing || strikeEvents.length > 0) {
    advanceVisualState(elapsed);
    visualizationDirty = true;
  }
  draw(timestamp);
  if (state.playing || strikeEvents.length > 0 || activeTrackPointer !== null) {
    animationFrame = requestAnimationFrame(animate);
  }
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
    state.playing = false;
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
renderRingControls();
updateInterface();
resizeCanvas();
