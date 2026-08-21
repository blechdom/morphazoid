import {
  KARPLUS_STRONG_DEFAULTS,
  KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS,
  KARPLUS_STRONG_PRESETS,
  KARPLUS_STRONG_TUNING_DEFAULTS,
  KARPLUS_STRONG_TUNING_LIMITS,
  KarplusStrongAudio,
  karplusStrongStringFrequencies,
  midiNoteFrequency,
  nearestKarplusStrongStringIndex,
  sanitizeKarplusStrongSettings,
  sanitizeKarplusStrongTuning,
} from "./src/karplus-strong.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const KEY_BINDINGS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k", "o", "l", ";"];
const CONTROL_SPECS = Object.freeze([
  { id: "hardness", format: formatPercent },
  { id: "excitationColor", format: formatPercent },
  { id: "excitationShape", format: formatPercent },
  { id: "burstLength", format: formatRatio },
  { id: "pickPosition", format: formatPercent },
  { id: "pickWidth", format: formatPercent },
  { id: "decay", format: (value) => value.toFixed(value < 1 ? 2 : 1) + " s" },
  { id: "damping", format: formatPercent },
  { id: "brightness", format: formatPercent },
  { id: "detune", format: formatCents },
  { id: "dispersion", format: formatPercent },
  { id: "polarity", format: (value) => (value >= 0 ? "+" : "") + value.toFixed(2) },
  { id: "lowCut", format: formatPercent },
  { id: "drive", format: formatPercent },
  { id: "chorusDepth", format: formatPercent },
  { id: "chorusRate", format: (value) => value.toFixed(2) + " Hz" },
  { id: "roughness", format: formatPercent },
  { id: "pickupPosition", format: formatPercent },
  { id: "pickupMix", format: formatPercent },
  { id: "body", format: formatPercent },
  { id: "bodyTune", format: formatRatio },
  { id: "bodyQ", format: (value) => value.toFixed(1) + " Q" },
  { id: "coupling", format: formatPercent },
  { id: "couplingRatio", format: formatRatio },
  { id: "couplingDetune", format: formatCents },
  { id: "spread", format: formatPercent },
]);

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const audio = new KarplusStrongAudio(globalThis);
const firstPreset = KARPLUS_STRONG_PRESETS[0];
const state = {
  ...KARPLUS_STRONG_DEFAULTS,
  ...firstPreset.settings,
  ...KARPLUS_STRONG_TUNING_DEFAULTS,
  pitchBendCents: 0,
  selectedIndex: 0,
  selectedPresetId: firstPreset.id,
  audioOn: false,
};
let stringFrequencies = karplusStrongStringFrequencies(state);

function formatRatio(value) {
  return value.toFixed(2) + "x";
}

function formatCents(value) {
  const rounded = Math.round(value * 10) / 10;
  return (rounded > 0 ? "+" : "") + rounded + " ct";
}

const knobDials = new Map();
let activeKnobDrag = null;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let pointerActive = false;
let lastPointerString = -1;
let lastPointerPluckAt = 0;
let pulses = [];

function formatPercent(value) {
  return Math.round(value * 100) + "%";
}

function formatFrequency(frequency) {
  return frequency >= 1_000
    ? (frequency / 1_000).toFixed(2) + " kHz"
    : frequency.toFixed(frequency < 100 ? 2 : 1) + " Hz";
}

function formatStageFrequency(frequency) {
  if (frequency >= 1_000) return (frequency / 1_000).toFixed(frequency >= 10_000 ? 1 : 2) + "k";
  return frequency < 100 ? frequency.toFixed(1) : String(Math.round(frequency));
}

function formatPitchBend(cents) {
  const rounded = Math.round(cents);
  return rounded === 0 ? "center" : (rounded > 0 ? "+" : "") + rounded + " ct";
}

function frequencySliderValue(frequency) {
  const minimum = KARPLUS_STRONG_TUNING_LIMITS.minimumFrequency;
  const maximum = KARPLUS_STRONG_TUNING_LIMITS.maximumFrequency;
  const safeFrequency = clamp(Number(frequency) || minimum, minimum, maximum);
  return Math.log(safeFrequency / minimum) / Math.log(maximum / minimum);
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

function stringLabel(index = state.selectedIndex) {
  const digits = Math.max(2, String(stringFrequencies.length).length);
  return "String " + String(index + 1).padStart(digits, "0");
}

function currentBaseFrequency() {
  return stringFrequencies[state.selectedIndex] ?? stringFrequencies[0];
}

function bentFrequency(frequency) {
  return frequency * (2 ** ((state.detune + state.pitchBendCents) / 1_200));
}

function currentFrequency() {
  return bentFrequency(currentBaseFrequency());
}

function synthSettings() {
  const settings = { level: state.level };
  for (const specification of CONTROL_SPECS) {
    settings[specification.id] = state[specification.id];
  }
  return sanitizeKarplusStrongSettings(settings);
}

function paintAudioState() {
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("stageReadout").textContent = [
    stringLabel().toUpperCase(),
    formatFrequency(currentFrequency()).toUpperCase(),
    (KARPLUS_STRONG_PRESETS.find(({ id }) => id === state.selectedPresetId)?.name ?? "Custom").toUpperCase(),
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" \u00b7 ");
}

function setAudioState(on) {
  state.audioOn = Boolean(on);
  audio.setOutput(state.audioOn ? state.level : 0);
  paintAudioState();
}

async function enableAudio() {
  $("audioError").hidden = true;
  try {
    await audio.start();
    audio.setOutput(state.level);
    state.audioOn = true;
    paintAudioState();
    return true;
  } catch (error) {
    $("audioError").textContent = error?.message || "Unable to start Karplus Strong audio.";
    $("audioError").hidden = false;
    return false;
  }
}

function markPresetCustom() {
  state.selectedPresetId = null;
  $("presetSummary").textContent = "Custom";
  for (const button of $("presetGrid").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", "false");
  }
}

function knobStep(input) {
  const step = Number(input.step);
  return Number.isFinite(step) && step > 0 ? step : .01;
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
  const amount = (value - minimum) / Math.max(.000001, maximum - minimum);
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
      if (activeKnobDrag?.input !== input || activeKnobDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const range = Number(input.max) - Number(input.min);
      commitKnobValue(
        input,
        activeKnobDrag.startValue + (activeKnobDrag.startY - event.clientY) / 140 * range,
      );
    });
    const endDrag = (event) => {
      if (activeKnobDrag?.input !== input || activeKnobDrag.pointerId !== event.pointerId) return;
      activeKnobDrag = null;
      dial.releasePointerCapture?.(event.pointerId);
    };
    dial.addEventListener("pointerup", endDrag);
    dial.addEventListener("pointercancel", endDrag);
    dial.addEventListener("keydown", (event) => {
      const step = knobStep(input);
      let value = Number(input.value);
      if (event.key === "ArrowUp" || event.key === "ArrowRight") value += step;
      else if (event.key === "ArrowDown" || event.key === "ArrowLeft") value -= step;
      else if (event.key === "PageUp") value += step * 8;
      else if (event.key === "PageDown") value -= step * 8;
      else if (event.key === "Home") value = Number(input.min);
      else if (event.key === "End") value = Number(input.max);
      else return;
      event.preventDefault();
      commitKnobValue(input, value);
    });
  }
}

function paintControl(specification) {
  const input = $(specification.id);
  input.value = String(state[specification.id]);
  $(specification.id + "Out").textContent = specification.format(state[specification.id]);
  paintKnob(input);
}

function bindControls() {
  for (const specification of CONTROL_SPECS) {
    paintControl(specification);
    $(specification.id).addEventListener("input", (event) => {
      state[specification.id] = Number(event.currentTarget.value);
      $(specification.id + "Out").textContent = specification.format(state[specification.id]);
      paintKnob(event.currentTarget);
      markPresetCustom();
      paintReadouts();
      scheduleFrame();
    });
  }

  $("level").addEventListener("input", (event) => {
    state.level = Number(event.currentTarget.value);
    $("levelOut").textContent = formatPercent(state.level);
    audio.setOutput(state.audioOn ? state.level : 0);
  });

  for (const id of ["lowFrequency", "highFrequency"]) {
    $(id).addEventListener("input", (event) => {
      const frequency = frequencyFromSlider(event.currentTarget.value);
      state[id] = frequency;
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
      rebuildStringField();
    });
  }

  $("divisionsPerOctave").addEventListener("input", (event) => {
    state.divisionsPerOctave = Number(event.currentTarget.value);
    rebuildStringField();
  });

  for (const button of $("spacingMode").querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.spacing = button.dataset.spacing;
      rebuildStringField();
      announce(button.textContent + " string spacing.");
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

function syncTuningControls() {
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

function rebuildStringField() {
  const previousFrequency = currentBaseFrequency();
  Object.assign(state, sanitizeKarplusStrongTuning(state));
  const nextFrequencies = karplusStrongStringFrequencies(state);
  state.selectedIndex = nearestKarplusStrongStringIndex(nextFrequencies, previousFrequency);
  stringFrequencies = nextFrequencies;
  pulses = [];
  syncTuningControls();
  paintReadouts();
  scheduleFrame();
}

function setPitchBend(cents, options = {}) {
  state.pitchBendCents = audio.setPitchBend(cents, options);
  $("pitchBend").value = String(state.pitchBendCents);
  $("pitchBendOut").textContent = formatPitchBend(state.pitchBendCents);
  paintReadouts();
  scheduleFrame();
}

function renderPresets() {
  const fragment = document.createDocumentFragment();
  for (const item of KARPLUS_STRONG_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.presetId = item.id;
    button.textContent = item.name;
    button.setAttribute("aria-pressed", String(item.id === state.selectedPresetId));
    button.addEventListener("click", () => applyPreset(item));
    fragment.append(button);
  }
  $("presetGrid").replaceChildren(fragment);
}

function applyPreset(item) {
  for (const specification of CONTROL_SPECS) {
    state[specification.id] = item.settings[specification.id];
    paintControl(specification);
  }
  state.selectedPresetId = item.id;
  $("presetSummary").textContent = item.name;

  for (const button of $("presetGrid").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetId === item.id));
  }
  paintReadouts();
  scheduleFrame();
  if (state.audioOn) void pluckString(state.selectedIndex);
  announce(item.name + " preset.");
}

function paintReadouts() {
  const name = stringLabel();
  const frequency = currentFrequency();
  const firstFrequency = stringFrequencies[0];
  const lastFrequency = stringFrequencies[stringFrequencies.length - 1];
  const requestedCount = Math.floor(
    Math.log2(state.highFrequency / state.lowFrequency) * state.divisionsPerOctave + 1e-9,
  ) + 1;
  const capped = requestedCount > KARPLUS_STRONG_TUNING_LIMITS.maximumStrings;
  $("selectedNote").textContent = name;
  $("selectedFrequency").textContent = formatFrequency(frequency);
  $("playSummary").textContent = name + " \u00b7 " + (state.audioOn ? "audio on" : "ready");
  $("fieldSummary").textContent = formatPercent(state.hardness) + " hard \u00b7 "
    + formatPercent(state.excitationColor) + " noise";
  $("loopSummary").textContent = state.decay.toFixed(1) + " s - "
    + formatPercent(state.brightness) + " bright";
  $("bodySummary").textContent = formatPercent(state.body) + " body - "
    + formatPercent(state.coupling) + " coupled";
  $("stringCountOut").textContent = stringFrequencies.length + " string"
    + (stringFrequencies.length === 1 ? "" : "s") + (capped ? " \u00b7 max" : "");
  $("frequencyRangeOut").textContent = formatFrequency(firstFrequency) + "\u2013"
    + formatFrequency(lastFrequency);
  $("stageSpacingLabel").textContent = state.spacing === "equal-hz"
    ? "EQUAL HZ" : state.divisionsPerOctave + " DIV / OCT";
  $("pitchBendOut").textContent = formatPitchBend(state.pitchBendCents);
  canvas.setAttribute("aria-valuemax", String(stringFrequencies.length));
  canvas.setAttribute("aria-valuenow", String(state.selectedIndex + 1));
  canvas.setAttribute(
    "aria-valuetext",
    name + ", " + formatFrequency(frequency) + ", "
      + stringFrequencies.length + " strings from " + formatFrequency(firstFrequency)
      + " to " + formatFrequency(lastFrequency),
  );
  $("levelOut").textContent = formatPercent(state.level);
  paintAudioState();
}

async function pluckString(index, options = {}) {
  const frequencyField = stringFrequencies;
  const stringCount = frequencyField.length;
  const nextIndex = clamp(Math.round(Number(index) || 0), 0, stringCount - 1);
  const frequency = frequencyField[nextIndex];
  state.selectedIndex = nextIndex;
  if (Number.isFinite(options.pickPosition)) {
    state.pickPosition = clamp(options.pickPosition, .04, .96);
    paintControl(CONTROL_SPECS.find(({ id }) => id === "pickPosition"));
    markPresetCustom();
  }
  paintReadouts();
  scheduleFrame();
  if (!state.audioOn && !(await enableAudio())) return;
  const pan = stringCount === 1 ? 0 : nextIndex / (stringCount - 1) * 2 - 1;
  await audio.pluck(frequency, synthSettings(), {
    velocity: clamp(Number(options.velocity) || .82, .05, 1),
    pan,
  });
  if (frequencyField === stringFrequencies) {
    pulses.push({
      index: nextIndex,
      pickPosition: state.pickPosition,
      startedAt: performance.now(),
      velocity: clamp(Number(options.velocity) || .82, .05, 1),
    });
  }
  if (pulses.length > 32) pulses = pulses.slice(-32);
  scheduleFrame();
  if (options.announceHit) {
    announce(stringLabel(nextIndex) + ", "
      + formatFrequency(bentFrequency(frequency)) + ", plucked.");
  }
}

function stagePoint(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
  const y = clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1);
  return {
    pickPosition: clamp(y, .04, .96),
    stringIndex: clamp(
      Math.floor(x * stringFrequencies.length),
      0,
      stringFrequencies.length - 1,
    ),
  };
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  pointerActive = true;
  canvas.setPointerCapture?.(event.pointerId);
  const point = stagePoint(event);
  lastPointerString = point.stringIndex;
  lastPointerPluckAt = performance.now();
  void pluckString(point.stringIndex, {
    pickPosition: point.pickPosition,
    velocity: .88,
  });
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerActive) return;
  const point = stagePoint(event);
  const now = performance.now();
  if (point.stringIndex === lastPointerString || now - lastPointerPluckAt < 42) return;
  const distance = Math.abs(point.stringIndex - lastPointerString);
  lastPointerString = point.stringIndex;
  lastPointerPluckAt = now;
  void pluckString(point.stringIndex, {
    pickPosition: point.pickPosition,
    velocity: clamp(.62 + distance * .08, .62, .96),
  });
});

function releasePointer(event) {
  pointerActive = false;
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

function handlePlayKey(event) {
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    state.selectedIndex = clamp(state.selectedIndex - 1, 0, stringFrequencies.length - 1);
    paintReadouts();
    scheduleFrame();
    announce(stringLabel() + ", " + formatFrequency(currentFrequency()) + ".");
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    state.selectedIndex = clamp(state.selectedIndex + 1, 0, stringFrequencies.length - 1);
    paintReadouts();
    scheduleFrame();
    announce(stringLabel() + ", " + formatFrequency(currentFrequency()) + ".");
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    void pluckString(state.selectedIndex, { announceHit: true });
  }
}

window.addEventListener("morphazoid:midi-input", (event) => {
  const { message, routeId } = event.detail ?? {};
  if (routeId !== "karplus-strong") return;
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
  const index = nearestKarplusStrongStringIndex(
    stringFrequencies,
    midiNoteFrequency(note),
  );
  void pluckString(index, {
    velocity: clamp((Number(message.velocity) || 100) / 127, .05, 1),
  });
});

canvas.addEventListener("keydown", handlePlayKey);
$("pluckButton").addEventListener("click", () => {
  void pluckString(state.selectedIndex, { announceHit: true });
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target?.matches?.("input, select, textarea, button, [role='slider']")) return;
  const index = KEY_BINDINGS.indexOf(event.key.toLowerCase());
  if (index < 0) return;
  event.preventDefault();
  const stringIndex = Math.round(
    index / Math.max(1, KEY_BINDINGS.length - 1) * (stringFrequencies.length - 1),
  );
  void pluckString(stringIndex, { velocity: .8 + (index % 3) * .05 });
});

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Karplus Strong audio off.");
  } else if (await enableAudio()) {
    announce("Karplus Strong audio on.");
  }
});

$("resetAll").addEventListener("click", () => {
  Object.assign(state, KARPLUS_STRONG_TUNING_DEFAULTS);
  stringFrequencies = karplusStrongStringFrequencies(state);
  state.selectedIndex = 0;
  pulses = [];
  syncTuningControls();
  setPitchBend(0, { immediate: true });
  applyPreset(firstPreset);
  announce("Karplus Strong parameters reset.");
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
  scheduleFrame();
}

function scheduleFrame() {
  if (scheduledFrame) return;
  scheduledFrame = requestAnimationFrame(drawStage);
}

function drawStage(timestamp = performance.now()) {
  scheduledFrame = 0;
  context.fillStyle = "#07090b";
  context.fillRect(0, 0, cssWidth, cssHeight);

  const top = Math.min(116, cssHeight * .2);
  const bottom = Math.max(top + 100, cssHeight - 74);
  const left = Math.min(62, cssWidth * .09);
  const right = Math.max(left + 120, cssWidth - 44);
  const stringCount = stringFrequencies.length;
  const columnWidth = (right - left) / Math.max(1, stringCount - 1);
  const bendAmount = state.pitchBendCents / KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS;
  const bendPixels = bendAmount * Math.min(24, Math.max(8, columnWidth * 1.5));
  const labelStride = Math.max(1, Math.ceil(44 / Math.max(1, columnWidth)));

  context.font = "7px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textBaseline = "top";
  for (let index = 0; index < stringCount; index += 1) {
    const x = left + index * columnWidth;
    const selected = index === state.selectedIndex;
    const frequencyAmount = index / Math.max(1, stringCount - 1);
    const color = selected ? "#e6c56e" : "rgba(183, 196, 190, .28)";
    context.strokeStyle = color;
    context.lineWidth = selected ? 1.5 : .75;
    context.beginPath();
    context.moveTo(x, top);
    context.quadraticCurveTo(x + bendPixels, (top + bottom) * .5, x, bottom);
    context.stroke();
    if (
      selected
      || index === 0
      || index === stringCount - 1
      || index % labelStride === 0
    ) {
      context.fillStyle = selected ? "#e6c56e" : "rgba(183, 196, 190, .48)";
      context.textAlign = "center";
      context.fillText(formatStageFrequency(stringFrequencies[index]), x, bottom + 12);
    }
    context.fillStyle = "rgba(115, 217, 210, " + (.18 + frequencyAmount * .28) + ")";
    context.fillRect(x - 1, top - 8 - frequencyAmount * 12, 2, 5 + frequencyAmount * 12);
  }

  pulses = pulses.filter(({ startedAt }) => timestamp - startedAt < state.decay * 1_000 + 500);
  for (const pulse of pulses) {
    const age = Math.max(0, (timestamp - pulse.startedAt) / 1_000);
    const x = left + pulse.index * columnWidth;
    const life = Math.exp(-age / Math.max(.16, state.decay * .34));
    const amplitude = Math.min(Math.max(2, columnWidth * .44), 4 + pulse.velocity * 15) * life;
    const frequencyAmount = pulse.index / Math.max(1, stringCount - 1);
    const cycles = 2.5 + frequencyAmount * 2 + state.dispersion * 3.5;
    context.strokeStyle = "rgba(230, 197, 110, " + Math.min(.9, life) + ")";
    context.lineWidth = 1.2;
    context.beginPath();
    for (let step = 0; step <= 96; step += 1) {
      const amount = step / 96;
      const y = top + amount * (bottom - top);
      const envelope = Math.sin(Math.PI * amount);
      const displacement = Math.sin(amount * Math.PI * 2 * cycles + age * 27)
        * envelope * amplitude + bendPixels * envelope;
      if (step === 0) context.moveTo(x + displacement, y);
      else context.lineTo(x + displacement, y);
    }
    context.stroke();
    const pickY = top + pulse.pickPosition * (bottom - top);
    const pickBend = bendPixels * Math.sin(Math.PI * pulse.pickPosition);
    context.fillStyle = "rgba(255, 143, 114, " + Math.min(.85, life) + ")";
    context.fillRect(x + pickBend - 5 - amplitude, pickY - 1, 10 + amplitude * 2, 2);
  }

  const markerY = top + state.pickPosition * (bottom - top);
  context.strokeStyle = "rgba(255, 143, 114, .48)";
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(left - 12, markerY);
  context.lineTo(right + 12, markerY);
  context.stroke();
  context.setLineDash([]);

  if (pulses.length) scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
renderPresets();
initializeKnobs();
syncTuningControls();
bindControls();
paintReadouts();
paintAudioState();
resizeCanvas();

window.addEventListener("pagehide", () => {
  void audio.close();
});
