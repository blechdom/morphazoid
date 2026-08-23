import {
  KARPLUS_STRONG_DEFAULTS,
  KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS,
  KARPLUS_STRONG_PRESETS,
  KARPLUS_STRONG_TUNING_LIMITS,
  karplusStrongStringFrequencies,
  midiNoteFrequency,
  nearestKarplusStrongStringIndex,
  sanitizeKarplusStrongSettings,
} from "./src/karplus-strong.js";
import {
  KARPLUS_CARPET_DEFAULTS,
  KARPLUS_CARPET_LIMITS,
  KARPLUS_CARPET_TEXTURE_PRESETS,
  KarplusCarpetAudio,
  karplusCarpetEnvelopeTiming,
  mergeKarplusCarpetPresetSettings,
  karplusCarpetPointerEvent,
  karplusCarpetSpatialCellAtPosition,
  karplusCarpetSpatialCellSeed,
  karplusCarpetSpatialCrossings,
  karplusCarpetSpatialGrid,
  sanitizeKarplusCarpetSettings,
} from "./src/karplus-carpet.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const KEY_BINDINGS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k", "o", "l", ";"];
const TIMBRE_CONTROL_SPECS = Object.freeze([
  { id: "hardness", format: formatPercent },
  { id: "excitationColor", format: formatPercent },
  { id: "excitationShape", format: formatPercent },
  { id: "burstLength", format: formatRatio },
  { id: "pickPosition", format: formatPercent },
  { id: "damping", format: formatPercent },
  { id: "brightness", format: formatPercent },
  { id: "dispersion", format: formatPercent },
  { id: "roughness", format: formatPercent },
  { id: "body", format: formatPercent },
  { id: "bodyQ", format: (value) => value.toFixed(1) + " Q" },
  { id: "bodyTune", format: formatRatio },
]);
const CARPET_CONTROL_IDS = Object.freeze([
  "grainDuration",
  "attackDuration",
  "decayDuration",
  "sustainLevel",
  "releaseDuration",
  "timbreVariation",
  "velocityScatter",
  "stereoSpread",
]);
const BUFFER_DURATION_CONTROL_IDS = new Set([
  "grainDuration",
  "attackDuration",
  "decayDuration",
  "releaseDuration",
  "timbreVariation",
]);
const PRESET_BANKS = Object.freeze({
  materials: Object.freeze({
    id: "materials",
    name: "Materials",
    description: "Classic thread materials keep the current Carpet timing and cell variation.",
    items: KARPLUS_STRONG_PRESETS,
  }),
  textures: Object.freeze({
    id: "textures",
    name: "Textures",
    description: "Carpet-native textures change material, envelope, spread, and cell color together.",
    items: KARPLUS_CARPET_TEXTURE_PRESETS,
  }),
});

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const audio = new KarplusCarpetAudio(globalThis);
const firstPreset = KARPLUS_STRONG_PRESETS[0];
const state = {
  ...KARPLUS_STRONG_DEFAULTS,
  ...firstPreset.settings,
  ...KARPLUS_CARPET_DEFAULTS,
  selectedPresetId: firstPreset.id,
  presetBankId: "materials",
  pitchBendCents: 0,
  audioOn: false,
};

let pitchCells = karplusStrongStringFrequencies(state);
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let pointerActive = false;
let activePointerGesture = null;
let currentSpatialCell = null;
let audioClockAnchor = null;
let pulses = [];
const knobDials = new Map();
let activeKnobDrag = null;
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

function formatPercent(value) {
  return Math.round(Number(value) * 100) + "%";
}

function formatRatio(value) {
  return Number(value).toFixed(2) + "x";
}

function formatMilliseconds(value) {
  return Math.round(Number(value) * 1_000) + " ms";
}

function formatFrequency(frequency) {
  return frequency >= 1_000
    ? (frequency / 1_000).toFixed(2) + " kHz"
    : frequency.toFixed(frequency < 100 ? 2 : 1) + " Hz";
}

function formatStageFrequency(frequency) {
  if (frequency >= 1_000) return (frequency / 1_000).toFixed(2) + "k";
  return frequency < 100 ? frequency.toFixed(1) : String(Math.round(frequency));
}

function formatPitchBend(cents) {
  const rounded = Math.round(cents);
  return rounded === 0 ? "center" : (rounded > 0 ? "+" : "") + rounded + " ct";
}

function frequencySliderValue(frequency) {
  const minimum = KARPLUS_STRONG_TUNING_LIMITS.minimumFrequency;
  const maximum = KARPLUS_STRONG_TUNING_LIMITS.maximumFrequency;
  const safe = clamp(Number(frequency) || minimum, minimum, maximum);
  return Math.log(safe / minimum) / Math.log(maximum / minimum);
}

function frequencyFromSlider(value) {
  const minimum = KARPLUS_STRONG_TUNING_LIMITS.minimumFrequency;
  const maximum = KARPLUS_STRONG_TUNING_LIMITS.maximumFrequency;
  return minimum * ((maximum / minimum) ** clamp(Number(value) || 0, 0, 1));
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function currentCenterIndex() {
  return clamp(
    Math.round(state.centerPosition * Math.max(0, pitchCells.length - 1)),
    0,
    Math.max(0, pitchCells.length - 1),
  );
}

function currentCenterFrequency() {
  return pitchCells[currentCenterIndex()] ?? state.lowFrequency;
}

function displayedCenterFrequency() {
  return currentCenterFrequency() * (2 ** ((state.detune + state.pitchBendCents) / 1_200));
}

function carpetSettings(overrides = {}) {
  return sanitizeKarplusCarpetSettings({ ...state, ...overrides });
}

function currentSpatialGrid() {
  return karplusCarpetSpatialGrid(cssWidth, cssHeight, { pitchCount: pitchCells.length });
}

function synthSettings() {
  return sanitizeKarplusStrongSettings(state);
}

function paintAudioState() {
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function captureAudioClockAnchor(force = false) {
  if (!audio.context) return null;
  const performanceTime = performance.now();
  const audioTime = audio.context.currentTime;
  const expectedAudioTime = audioClockAnchor
    ? audioClockAnchor.audioTime
      + (performanceTime - audioClockAnchor.performanceTime) / 1_000
    : audioTime;
  if (
    force
    || audioClockAnchor?.context !== audio.context
    || Math.abs(audioTime - expectedAudioTime) > 0.05
  ) {
    audioClockAnchor = { context: audio.context, performanceTime, audioTime };
  }
  return audioClockAnchor;
}

function setAudioState(on) {
  state.audioOn = Boolean(on);
  audio.setOutput(state.audioOn ? state.level : 0);
  if (!state.audioOn) {
    audio.stopAll();
    audioClockAnchor = null;
  }
  paintAudioState();
  paintReadouts();
}

async function enableAudio() {
  $("audioError").hidden = true;
  try {
    await audio.start();
    captureAudioClockAnchor(true);
    audio.setOutput(state.level);
    state.audioOn = true;
    paintAudioState();
    paintReadouts();
    return true;
  } catch (error) {
    $("audioError").textContent = error?.message || "Unable to start Karplus Carpet audio.";
    $("audioError").hidden = false;
    return false;
  }
}

function markPresetCustom() {
  state.selectedPresetId = null;
  $("presetSummary").textContent = "Custom";
  $("presetDescription").textContent = "Custom sound · cross a new area to hear the change.";
  for (const button of $("presetGrid").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", "false");
  }
}

function knobStep(input) {
  const step = Number(input.step);
  return Number.isFinite(step) && step > 0 ? step : 0.01;
}

function commitKnobValue(input, value) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const step = knobStep(input);
  const steps = Math.round((clamp(value, minimum, maximum) - minimum) / step);
  input.value = String(Number(clamp(minimum + steps * step, minimum, maximum).toFixed(6)));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function paintKnob(input) {
  const dial = knobDials.get(input.id);
  if (!dial) return;
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const value = clamp(Number(input.value), minimum, maximum);
  const amount = (value - minimum) / Math.max(0.000001, maximum - minimum);
  const output = $(input.id + "Out");
  const label = dial.closest(".ks-knob")?.querySelector("b")?.textContent || input.id;
  dial.style.setProperty("--knob-angle", (-135 + amount * 270) + "deg");
  dial.style.setProperty("--knob-fill", (amount * 75) + "%");
  dial.setAttribute("aria-label", label);
  dial.setAttribute("aria-valuemin", String(minimum));
  dial.setAttribute("aria-valuemax", String(maximum));
  dial.setAttribute("aria-valuenow", String(value));
  dial.setAttribute("aria-valuetext", output?.textContent || String(value));
}

function initializeKnobs() {
  for (const wrapper of document.querySelectorAll(".ks-knob")) {
    const input = wrapper.querySelector('input[type="range"]');
    const dial = document.createElement("div");
    dial.className = "ks-knob-dial";
    dial.setAttribute("role", "slider");
    dial.setAttribute("aria-orientation", "vertical");
    dial.tabIndex = 0;
    input.hidden = true;
    wrapper.insertBefore(dial, input);
    knobDials.set(input.id, dial);

    dial.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      dial.focus();
      activeKnobDrag = {
        input,
        pointerId: event.pointerId,
        startValue: Number(input.value),
        startY: event.clientY,
      };
      dial.setPointerCapture?.(event.pointerId);
    });
    dial.addEventListener("pointermove", (event) => {
      if (!activeKnobDrag || activeKnobDrag.pointerId !== event.pointerId) return;
      const span = Number(input.max) - Number(input.min);
      commitKnobValue(input, activeKnobDrag.startValue
        + (activeKnobDrag.startY - event.clientY) / 150 * span);
    });
    const release = (event) => {
      if (!activeKnobDrag || activeKnobDrag.pointerId !== event.pointerId) return;
      activeKnobDrag = null;
      try { dial.releasePointerCapture?.(event.pointerId); } catch { /* released */ }
    };
    dial.addEventListener("pointerup", release);
    dial.addEventListener("pointercancel", release);
    dial.addEventListener("keydown", (event) => {
      const step = knobStep(input) * (event.shiftKey ? 10 : 1);
      if (["ArrowUp", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        commitKnobValue(input, Number(input.value) + step);
      } else if (["ArrowDown", "ArrowLeft"].includes(event.key)) {
        event.preventDefault();
        commitKnobValue(input, Number(input.value) - step);
      } else if (event.key === "Home") {
        event.preventDefault();
        commitKnobValue(input, Number(input.min));
      } else if (event.key === "End") {
        event.preventDefault();
        commitKnobValue(input, Number(input.max));
      }
    });
  }
}

function paintTimbreControl(specification) {
  const input = $(specification.id);
  input.value = String(state[specification.id]);
  $(specification.id + "Out").textContent = specification.format(state[specification.id]);
  paintKnob(input);
}

function syncCarpetControls() {
  for (const id of CARPET_CONTROL_IDS) $(id).value = String(state[id]);
  for (const id of ["grainDuration", "attackDuration", "decayDuration", "releaseDuration"]) {
    const label = formatMilliseconds(state[id]);
    $(id).setAttribute("aria-valuetext", label);
    $(id + "Out").textContent = label;
  }
  $("sustainLevelOut").textContent = formatPercent(state.sustainLevel);
  $("sustainLevel").setAttribute("aria-valuetext", formatPercent(state.sustainLevel));
  $("timbreVariationOut").textContent = formatPercent(state.timbreVariation);
  $("timbreVariation").setAttribute(
    "aria-valuetext",
    formatPercent(state.timbreVariation) + " cell color variation",
  );
  $("velocityScatterOut").textContent = formatPercent(state.velocityScatter);
  $("stereoSpreadOut").textContent = formatPercent(state.stereoSpread);

  for (const id of ["lowFrequency", "highFrequency"]) {
    const input = $(id);
    const label = formatFrequency(state[id]);
    input.value = String(frequencySliderValue(state[id]));
    input.setAttribute("aria-valuetext", label);
    $(id + "Out").textContent = label;
  }
  $("divisionsPerOctave").value = String(state.divisionsPerOctave);
  $("divisionsPerOctave").setAttribute(
    "aria-valuetext",
    state.divisionsPerOctave + " divisions per octave",
  );
  $("divisionsPerOctaveOut").textContent = state.divisionsPerOctave + " div/oct";
  for (const button of $("spacingMode").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.spacing === state.spacing));
  }
}

function paintReadouts() {
  const centerFrequency = displayedCenterFrequency();
  const firstFrequency = pitchCells[0] ?? state.lowFrequency;
  const lastFrequency = pitchCells.at(-1) ?? state.highFrequency;
  const grid = currentSpatialGrid();
  const envelope = karplusCarpetEnvelopeTiming(state, state.grainDuration);
  $("surfaceSummary").textContent = (grid.columns * grid.rows).toLocaleString()
    + " close areas \u00b7 drag to cross";
  $("pitchCellCountOut").textContent = pitchCells.length + " pitch cell"
    + (pitchCells.length === 1 ? "" : "s");
  $("frequencyRangeOut").textContent = formatFrequency(firstFrequency) + "\u2013"
    + formatFrequency(lastFrequency);
  $("stageSpacingLabel").textContent = state.spacing === "equal-hz"
    ? "EQUAL HZ" : state.divisionsPerOctave + " DIV / OCT";
  $("pitchBendOut").textContent = formatPitchBend(state.pitchBendCents);
  $("exciterSummary").textContent = formatPercent(state.hardness) + " hard \u00b7 "
    + formatPercent(state.excitationColor) + " noise";
  $("characterSummary").textContent = formatPercent(state.brightness) + " bright \u00b7 "
    + formatPercent(state.dispersion) + " disperse";
  $("levelOut").textContent = formatPercent(state.level);
  $("stageReadout").textContent = [
    grid.columns + "\u00d7" + grid.rows + " AREAS",
    Math.round(envelope.endOffset * 1_000) + " MS ENV",
    pointerActive ? "CROSSING" : state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" \u00b7 ");
  canvas.setAttribute("aria-valuenow", String(Math.round(state.centerPosition * 100)));
  canvas.setAttribute(
    "aria-valuetext",
    "Area pitch " + formatFrequency(centerFrequency)
      + "; each close area sounds once per gesture",
  );
  paintAudioState();
  scheduleFrame();
}

function rebuildPitchField() {
  Object.assign(state, sanitizeKarplusCarpetSettings(state));
  pitchCells = karplusStrongStringFrequencies(state);
  audio.clearBufferCache();
  syncCarpetControls();
  paintReadouts();
}

function setPitchBend(cents, options = {}) {
  state.pitchBendCents = audio.setPitchBend(cents, options);
  $("pitchBend").value = String(state.pitchBendCents);
  $("pitchBendOut").textContent = formatPitchBend(state.pitchBendCents);
  paintReadouts();
}

function renderPresets() {
  const bank = PRESET_BANKS[state.presetBankId] ?? PRESET_BANKS.materials;
  const fragment = document.createDocumentFragment();
  for (const item of bank.items) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.presetId = item.id;
    button.textContent = item.name;
    button.title = item.description ?? item.name + " thread material";
    button.setAttribute(
      "aria-label",
      item.description ? item.name + ": " + item.description : item.name,
    );
    button.setAttribute("aria-pressed", String(item.id === state.selectedPresetId));
    button.addEventListener("click", () => applyPreset(item));
    fragment.append(button);
  }
  $("presetGrid").setAttribute("aria-label", bank.name + " sound varieties");
  $("presetGrid").replaceChildren(fragment);
  for (const button of $("presetBank").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetBank === bank.id));
  }
  const selected = bank.items.find((item) => item.id === state.selectedPresetId);
  $("presetDescription").textContent = selected?.description ?? bank.description;
}

function selectPresetBank(bankId, options = {}) {
  const bank = PRESET_BANKS[bankId];
  if (!bank) return;
  state.presetBankId = bank.id;
  renderPresets();
  if (options.announce !== false) {
    announce(bank.name + " sound varieties shown. Selection remains silent.");
  }
}

function applyPreset(item) {
  const outputLevel = state.level;
  Object.assign(state, mergeKarplusCarpetPresetSettings(state, item.settings));
  state.level = outputLevel;
  state.selectedPresetId = item.id;
  $("presetSummary").textContent = item.name;
  $("presetDescription").textContent = item.description
    ?? item.name + " material · current Carpet timing and cell variation retained.";
  for (const specification of TIMBRE_CONTROL_SPECS) paintTimbreControl(specification);
  syncCarpetControls();
  for (const button of $("presetGrid").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetId === item.id));
  }
  audio.clearBufferCache();
  paintReadouts();
}

function pushPulse(event, startedAt) {
  pulses.push({ ...event, startedAt });
  if (pulses.length > 180) pulses = pulses.slice(-180);
  scheduleFrame();
}

function scheduleAudioGrain(event, startedAt) {
  if (!state.audioOn || !audio.context) return;
  const anchor = captureAudioClockAnchor();
  const when = anchor
    ? anchor.audioTime + (startedAt - anchor.performanceTime) / 1_000
    : audio.context.currentTime;
  const maximumGateDuration = clamp(
    state.grainDuration * 1.1,
    KARPLUS_CARPET_LIMITS.minimumGrainDuration,
    KARPLUS_CARPET_LIMITS.maximumGrainDuration,
  );
  const longestEnvelope = karplusCarpetEnvelopeTiming(state, maximumGateDuration);
  const pitchBendHeadroom = 2 ** (KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS / 1_200);
  void audio.scheduleGrain(event, synthSettings(), {
    when,
    density: KARPLUS_CARPET_LIMITS.defaultHeadroomDensity,
    renderDuration: clamp(
      longestEnvelope.endOffset * pitchBendHeadroom,
      KARPLUS_CARPET_LIMITS.minimumGrainDuration,
      KARPLUS_CARPET_LIMITS.maximumRenderDuration,
    ),
  }).catch((error) => {
    if (error?.name === "AbortError") return;
    $("audioError").textContent = error?.message || "Unable to synthesize a carpet grain.";
    $("audioError").hidden = false;
  });
}

function queueGrain(event, startedAt) {
  pushPulse(event, startedAt);
  scheduleAudioGrain(event, startedAt);
}

function setStagePosition(centerPosition) {
  state.centerPosition = clamp(centerPosition, 0, 1);
  paintReadouts();
}

function retainCrossings(cells) {
  const maximum = KARPLUS_CARPET_LIMITS.maximumCrossingsPerMove;
  if (cells.length <= maximum) return cells;
  const retained = [];
  for (let index = 0; index < maximum; index += 1) {
    retained.push(cells[Math.round(index * (cells.length - 1) / (maximum - 1))]);
  }
  return retained;
}

function setStageCell(cell) {
  if (!cell) return;
  currentSpatialCell = cell;
  setStagePosition(cell.position);
}

function spatialEvent(cell, options = {}) {
  const event = karplusCarpetPointerEvent(carpetSettings(), cell.index, {
    seed: karplusCarpetSpatialCellSeed(cell),
    frequencies: pitchCells,
    position: cell.position,
    visualY: cell.visualY,
    velocity: options.velocity,
  });
  const envelope = karplusCarpetEnvelopeTiming(event, event.duration);
  return Object.freeze({
    ...event,
    envelopeDuration: envelope.endOffset,
    spatialPosition: cell.position,
  });
}

function strikeSpatialCells(cells, options = {}) {
  if (!cells.length || !state.audioOn || !audio.context) return;
  captureAudioClockAnchor();
  const startedAt = performance.now() + 4;
  for (let index = 0; index < cells.length; index += 1) {
    queueGrain(spatialEvent(cells[index], options), startedAt + index * 1.5);
  }
}

async function flushPointerGesture(gesture) {
  if (gesture.flushing) return;
  gesture.flushing = true;
  if (!state.audioOn && !(await enableAudio())) {
    gesture.pending.length = 0;
    gesture.flushing = false;
    return;
  }
  while (gesture.pending.length) {
    strikeSpatialCells(gesture.pending.splice(0, KARPLUS_CARPET_LIMITS.maximumCrossingsPerMove));
  }
  gesture.flushing = false;
}

function enterGestureCells(gesture, cells) {
  const fresh = [];
  for (const cell of retainCrossings(cells)) {
    if (gesture.visited.has(cell.key)) continue;
    gesture.visited.add(cell.key);
    fresh.push(cell);
  }
  if (cells.length) setStageCell(cells.at(-1));
  if (!fresh.length) return;
  gesture.pending.push(...fresh);
  void flushPointerGesture(gesture);
}

function pointerPoint(event, gesture) {
  const bounds = canvas.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  return {
    ...point,
    cell: karplusCarpetSpatialCellAtPosition(
      gesture.width,
      gesture.height,
      point.x,
      point.y,
      { grid: gesture.grid },
    ),
  };
}

function processPointerSample(gesture, event) {
  const point = pointerPoint(event, gesture);
  if (!point.cell) {
    gesture.lastPoint = null;
    currentSpatialCell = null;
    scheduleFrame();
    return;
  }
  const cells = gesture.lastPoint
    ? karplusCarpetSpatialCrossings(gesture.lastPoint, point, {
      width: gesture.width,
      height: gesture.height,
      grid: gesture.grid,
    })
    : [point.cell];
  gesture.lastPoint = point;
  if (cells.length) enterGestureCells(gesture, cells);
  else setStageCell(point.cell);
}

async function strikeSpatialPosition(position, visualY = 0.5, options = {}) {
  const grid = currentSpatialGrid();
  const cell = karplusCarpetSpatialCellAtPosition(
    cssWidth,
    cssHeight,
    grid.left + clamp(position, 0, 1) * (grid.right - grid.left),
    grid.top + clamp(visualY, 0, 1) * (grid.bottom - grid.top),
    { grid },
  );
  if (!cell) return;
  setStageCell(cell);
  if (!state.audioOn && !(await enableAudio())) return;
  strikeSpatialCells([cell], options);
  if (options.announce !== false) {
    announce("Area struck at " + formatFrequency(displayedCenterFrequency()) + ".");
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  if (activePointerGesture && activePointerGesture.pointerId !== event.pointerId) return;
  event.preventDefault();
  canvas.focus();
  pointerActive = true;
  canvas.setPointerCapture?.(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const gesture = {
    pointerId: event.pointerId,
    width: bounds.width,
    height: bounds.height,
    grid: karplusCarpetSpatialGrid(bounds.width, bounds.height, { pitchCount: pitchCells.length }),
    lastPoint: null,
    visited: new Set(),
    pending: [],
    flushing: false,
  };
  activePointerGesture = gesture;
  processPointerSample(gesture, event);
  announce("Surface armed. Each close area sounds once; holding still is silent.");
});

canvas.addEventListener("pointermove", (event) => {
  const gesture = activePointerGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const samples = typeof event.getCoalescedEvents === "function"
    ? event.getCoalescedEvents()
    : [];
  for (const sample of samples) processPointerSample(gesture, sample);
  processPointerSample(gesture, event);
});

function releasePointer(event) {
  if (activePointerGesture?.pointerId !== event.pointerId) return;
  pointerActive = false;
  activePointerGesture = null;
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* released */ }
  paintReadouts();
  scheduleFrame();
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", () => {
  pointerActive = false;
  activePointerGesture = null;
  paintReadouts();
  scheduleFrame();
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const grid = currentSpatialGrid();
    void strikeSpatialPosition(state.centerPosition + direction / grid.columns, 0.5);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    void strikeSpatialPosition(state.centerPosition, 0.5);
  }
});

function bindControls() {
  for (const specification of TIMBRE_CONTROL_SPECS) {
    paintTimbreControl(specification);
    $(specification.id).addEventListener("input", (event) => {
      state[specification.id] = Number(event.currentTarget.value);
      $(specification.id + "Out").textContent = specification.format(state[specification.id]);
      paintKnob(event.currentTarget);
      audio.clearBufferCache();
      markPresetCustom();
      paintReadouts();
    });
  }

  $("level").addEventListener("input", (event) => {
    state.level = Number(event.currentTarget.value);
    $("levelOut").textContent = formatPercent(state.level);
    audio.setOutput(state.audioOn ? state.level : 0);
  });

  for (const id of CARPET_CONTROL_IDS) {
    $(id).addEventListener("input", (event) => {
      state[id] = Number(event.currentTarget.value);
      Object.assign(state, sanitizeKarplusCarpetSettings(state));
      syncCarpetControls();
      if (BUFFER_DURATION_CONTROL_IDS.has(id)) audio.clearBufferCache();
      markPresetCustom();
      paintReadouts();
    });
  }

  for (const button of $("presetBank").querySelectorAll("button")) {
    button.addEventListener("click", () => selectPresetBank(button.dataset.presetBank));
  }

  for (const id of ["lowFrequency", "highFrequency"]) {
    $(id).addEventListener("input", (event) => {
      state[id] = frequencyFromSlider(event.currentTarget.value);
      const crossingRatio = 2 ** (1 / 1_200);
      if (id === "lowFrequency" && state.lowFrequency >= state.highFrequency) {
        state.highFrequency = Math.min(
          KARPLUS_STRONG_TUNING_LIMITS.maximumFrequency,
          state.lowFrequency * crossingRatio,
        );
      } else if (id === "highFrequency" && state.highFrequency <= state.lowFrequency) {
        state.lowFrequency = Math.max(
          KARPLUS_STRONG_TUNING_LIMITS.minimumFrequency,
          state.highFrequency / crossingRatio,
        );
      }
      rebuildPitchField();
    });
  }

  $("divisionsPerOctave").addEventListener("input", (event) => {
    state.divisionsPerOctave = Number(event.currentTarget.value);
    rebuildPitchField();
  });

  for (const button of $("spacingMode").querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.spacing = button.dataset.spacing;
      rebuildPitchField();
      announce(button.textContent + " carpet spacing.");
    });
  }

  $("pitchBend").addEventListener("input", (event) => {
    setPitchBend(Number(event.currentTarget.value));
  });
  $("centerPitchBend").addEventListener("click", () => {
    setPitchBend(0);
    announce("Pitch bend centered.");
  });
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Karplus Carpet audio off.");
  } else if (await enableAudio()) {
    announce("Karplus Carpet audio on.");
  }
});

$("resetAll").addEventListener("click", () => {
  activePointerGesture = null;
  pointerActive = false;
  currentSpatialCell = null;
  audio.stopAll();
  Object.assign(state, KARPLUS_CARPET_DEFAULTS);
  state.level = KARPLUS_STRONG_DEFAULTS.level;
  $("level").value = String(state.level);
  audio.setOutput(state.audioOn ? state.level : 0);
  pitchCells = karplusStrongStringFrequencies(state);
  pulses = [];
  syncCarpetControls();
  setPitchBend(0, { immediate: true });
  selectPresetBank("materials", { announce: false });
  applyPreset(firstPreset);
  announce("Karplus Carpet parameters reset.");
});

window.addEventListener("morphazoid:midi-input", (event) => {
  const { message, routeId } = event.detail ?? {};
  if (routeId && routeId !== "karplus-carpet") return;
  if (message?.type === "pitchBend") {
    event.preventDefault();
    setPitchBend(
      clamp(Number(message.normalized) || 0, -1, 1)
        * KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS,
    );
    return;
  }
  if (message?.type !== "noteOn") return;
  event.preventDefault();
  const note = clamp(Math.round(Number(message.note) || 60), 0, 127);
  const index = nearestKarplusStrongStringIndex(pitchCells, midiNoteFrequency(note));
  const rawVelocity = Number(message.velocity);
  const normalizedVelocity = Number.isFinite(rawVelocity)
    ? clamp(rawVelocity > 1 ? rawVelocity / 127 : rawVelocity, 0, 1)
    : 0.5;
  void strikeSpatialPosition(
    index / Math.max(1, pitchCells.length - 1),
    0.5,
    { velocity: 0.2 + normalizedVelocity * 0.5, announce: false },
  );
  announce("MIDI note struck one Karplus Carpet area.");
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target?.matches?.("input, select, textarea, button, [role='slider']")) return;
  const index = KEY_BINDINGS.indexOf(event.key.toLowerCase());
  if (index < 0) return;
  event.preventDefault();
  void strikeSpatialPosition(index / Math.max(1, KEY_BINDINGS.length - 1), 0.5);
});

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(2_600_000 / Math.max(1, cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  currentSpatialCell = null;
  if (activePointerGesture) {
    activePointerGesture.width = cssWidth;
    activePointerGesture.height = cssHeight;
    activePointerGesture.grid = currentSpatialGrid();
    activePointerGesture.lastPoint = null;
  }
  paintReadouts();
  scheduleFrame();
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(drawStage);
}

function drawWovenGround(top, bottom, left, right, timestamp) {
  const width = right - left;
  const height = bottom - top;
  const rowCount = clamp(Math.round(height / 25), 10, 28);
  const columnCount = clamp(Math.round(width / 26), 18, 70);
  const drift = reducedMotion ? 0 : timestamp * 0.000035;
  context.lineWidth = 0.65;
  for (let row = 0; row <= rowCount; row += 1) {
    const y = top + row / rowCount * height;
    context.strokeStyle = row % 2
      ? "rgba(110, 217, 197, .075)"
      : "rgba(231, 165, 93, .065)";
    context.beginPath();
    for (let column = 0; column <= columnCount; column += 1) {
      const amount = column / columnCount;
      const x = left + amount * width;
      const weave = Math.sin((amount + drift) * Math.PI * 10 + row * 0.72) * 2.2;
      if (column === 0) context.moveTo(x, y + weave);
      else context.lineTo(x, y + weave);
    }
    context.stroke();
  }

  for (let column = 0; column <= columnCount; column += 1) {
    const x = left + column / columnCount * width;
    context.fillStyle = column % 2
      ? "rgba(119, 135, 216, .075)"
      : "rgba(231, 165, 93, .055)";
    for (let row = 0; row <= rowCount; row += 1) {
      const y = top + row / rowCount * height;
      const offset = row % 2 ? 3 : -3;
      context.fillRect(x + offset, y - 0.5, 4, 1);
    }
  }
}

function drawSpatialLattice(grid) {
  const total = grid.columns * grid.rows;
  const stride = Math.max(1, Math.ceil(Math.sqrt(total / 12_000)));
  for (let row = 0; row < grid.rows; row += stride) {
    context.fillStyle = row % 2
      ? "rgba(110, 217, 197, .12)"
      : "rgba(231, 165, 93, .1)";
    const y = grid.top + (row + 0.5) * grid.cellHeight;
    for (let column = 0; column < grid.columns; column += stride) {
      const x = grid.left + (column + 0.5) * grid.cellWidth;
      context.fillRect(x - 0.45, y - 0.45, 0.9, 0.9);
    }
  }
}

function drawPulse(pulse, timestamp, top, bottom, left, right) {
  if (timestamp < pulse.startedAt) return;
  const age = Math.max(0, (timestamp - pulse.startedAt) / 1_000);
  const life = clamp(
    1 - age / Math.max(0.08, pulse.envelopeDuration ?? pulse.duration + 0.34),
    0,
    1,
  );
  if (life <= 0) return;
  const x = left + (pulse.spatialPosition ?? pulse.fieldPosition) * (right - left);
  const y = top + pulse.visualY * (bottom - top);
  const shimmer = reducedMotion ? 0 : Math.sin(age * 38 + pulse.index) * 3 * life;
  const length = 7 + pulse.duration * 80 + life * 13;
  const alpha = Math.min(0.92, 0.15 + life * 0.78);
  const color = pulse.timbre > 0.25
    ? `rgba(110, 217, 197, ${alpha})`
    : pulse.timbre < -0.25
      ? `rgba(178, 156, 255, ${alpha})`
      : `rgba(231, 165, 93, ${alpha})`;

  context.strokeStyle = color;
  context.lineWidth = 0.8 + pulse.velocity * 2.2;
  context.beginPath();
  context.moveTo(x - length * 0.5, y - shimmer);
  context.quadraticCurveTo(x, y + shimmer * 1.4, x + length * 0.5, y - shimmer);
  context.stroke();
  context.beginPath();
  context.moveTo(x - shimmer, y - length * 0.24);
  context.lineTo(x + shimmer, y + length * 0.24);
  context.stroke();
  context.fillStyle = color;
  context.fillRect(x - 1.5, y - 1.5, 3, 3);
}

function drawStage(timestamp = performance.now()) {
  scheduledFrame = 0;
  context.fillStyle = "#07090b";
  context.fillRect(0, 0, cssWidth, cssHeight);
  const grid = currentSpatialGrid();
  const { top, bottom, left, right } = grid;
  drawWovenGround(top, bottom, left, right, timestamp);
  drawSpatialLattice(grid);

  const centerX = left + state.centerPosition * (right - left);
  if (currentSpatialCell) {
    context.fillStyle = pointerActive
      ? "rgba(110, 217, 197, .13)"
      : "rgba(231, 165, 93, .08)";
    context.fillRect(
      currentSpatialCell.left,
      currentSpatialCell.top,
      currentSpatialCell.right - currentSpatialCell.left,
      currentSpatialCell.bottom - currentSpatialCell.top,
    );
    context.strokeStyle = pointerActive
      ? "rgba(110, 217, 197, .66)"
      : "rgba(231, 165, 93, .38)";
    context.lineWidth = 0.8;
    context.strokeRect(
      currentSpatialCell.left + 0.4,
      currentSpatialCell.top + 0.4,
      Math.max(0, currentSpatialCell.right - currentSpatialCell.left - 0.8),
      Math.max(0, currentSpatialCell.bottom - currentSpatialCell.top - 0.8),
    );
    context.fillStyle = "rgba(110, 217, 197, .86)";
    context.beginPath();
    context.arc(currentSpatialCell.x, currentSpatialCell.y, 2.4, 0, Math.PI * 2);
    context.fill();
  }

  pulses = pulses.filter(({ startedAt, duration, envelopeDuration }) => (
    timestamp - startedAt < (envelopeDuration ?? duration) * 1_000 + 80
  ));
  for (const pulse of pulses) drawPulse(pulse, timestamp, top, bottom, left, right);

  context.font = "7px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textBaseline = "top";
  context.fillStyle = "rgba(183, 196, 190, .48)";
  context.textAlign = "left";
  context.fillText(formatStageFrequency(pitchCells[0] ?? state.lowFrequency), left, bottom + 13);
  context.textAlign = "center";
  context.fillStyle = "rgba(231, 165, 93, .82)";
  context.fillText(formatStageFrequency(currentCenterFrequency()), centerX, bottom + 13);
  context.textAlign = "right";
  context.fillStyle = "rgba(183, 196, 190, .48)";
  context.fillText(formatStageFrequency(pitchCells.at(-1) ?? state.highFrequency), right, bottom + 13);

  if (pulses.length) scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
renderPresets();
initializeKnobs();
syncCarpetControls();
bindControls();
for (const specification of TIMBRE_CONTROL_SPECS) paintTimbreControl(specification);
paintReadouts();
resizeCanvas();

window.addEventListener("pagehide", () => {
  void audio.close();
});
