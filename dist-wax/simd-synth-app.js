import {
  SIMD_SYNTH_COMBINERS,
  SIMD_SYNTH_DEFAULT_MOD_ROUTES,
  SIMD_SYNTH_DEFAULT_SEQUENCE,
  SIMD_SYNTH_FILTER_ROUTES,
  SIMD_SYNTH_FILTERS,
  SIMD_SYNTH_FX,
  SIMD_SYNTH_LIMITS,
  SIMD_SYNTH_MOD_DESTINATIONS,
  SIMD_SYNTH_MOD_SOURCES,
  SIMD_SYNTH_PARAM_ORDER,
  SIMD_SYNTH_SCALES,
  SIMD_SYNTH_SHAPERS,
  SIMD_SYNTH_SOURCE_MODELS,
  SimdSynthAudio,
  createSimdSynthConfiguration,
  createSimdSynthSequence,
} from "./src/simd-synth.js";
import {
  SIMD_SYNTH_INIT_PRESET,
  SIMD_SYNTH_PRESETS,
  simdSynthPresetById,
} from "./src/simd-synth-presets.js";
import {
  createSimdSynthUserPreset,
  loadSimdSynthUserPresets,
  persistSimdSynthUserPresets,
} from "./src/simd-synth-user-presets.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const percent = (value) => `${Math.round(value * 100)}%`;
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const BLACK_NOTES = new Set([1, 3, 6, 8, 10]);
const SEQUENCE_LANES = Object.freeze({
  pitch: Object.freeze({ component: 0, label: "Pitch", min: -12, max: 24, step: 1 }),
  gate: Object.freeze({ component: 1, label: "Gate", min: 0, max: 1, step: 1 }),
  accent: Object.freeze({ component: 2, label: "Accent", min: 0.05, max: 1, step: 0.01 }),
  slide: Object.freeze({ component: 3, label: "Slide", min: 0, max: 0.95, step: 0.01 }),
});
const COMPUTER_PIANO_KEYS = Object.freeze([
  ["KeyZ", "Z", 0], ["KeyS", "S", 1], ["KeyX", "X", 2], ["KeyD", "D", 3],
  ["KeyC", "C", 4], ["KeyV", "V", 5], ["KeyG", "G", 6], ["KeyB", "B", 7],
  ["KeyH", "H", 8], ["KeyN", "N", 9], ["KeyJ", "J", 10], ["KeyM", "M", 11],
  ["KeyQ", "Q", 12], ["Digit2", "2", 13], ["KeyW", "W", 14], ["Digit3", "3", 15],
  ["KeyE", "E", 16], ["KeyR", "R", 17], ["Digit5", "5", 18], ["KeyT", "T", 19],
  ["Digit6", "6", 20], ["KeyY", "Y", 21], ["Digit7", "7", 22], ["KeyU", "U", 23],
].map(([code, label, offset]) => Object.freeze({ code, label, offset })));
const COMPUTER_PIANO_KEY_BY_CODE = new Map(COMPUTER_PIANO_KEYS.map((entry) => [entry.code, entry]));
const engine = new SimdSynthAudio(globalThis);

function midiNoteName(noteValue) {
  const note = clamp(Math.round(finite(noteValue, 60)), 0, 127);
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function patchFrom(value) {
  const configuration = createSimdSynthConfiguration(value);
  return {
    params: { ...configuration.params },
    sequence: configuration.sequence.map((step) => [...step]),
    modRoutes: configuration.modRoutes.map((route) => [...route]),
  };
}

function clonePatch(value = state.patch) {
  return {
    params: { ...value.params },
    sequence: value.sequence.map((step) => [...step]),
    modRoutes: value.modRoutes.map((route) => [...route]),
  };
}

const firstPreset = SIMD_SYNTH_PRESETS[0];
const state = {
  patch: patchFrom(firstPreset),
  activePresetId: firstPreset.id,
  audioOn: false,
  audioBusy: false,
  playing: false,
  transportOffset: 0,
  transportStartedAt: 0,
  history: [],
  userPresets: loadSimdSynthUserPresets(globalThis.localStorage),
  activeNotes: new Map(),
  xyPointer: null,
  xyNote: null,
  scopeFrame: 0,
  patchFrame: 0,
  currentStep: -1,
  sequenceLane: "pitch",
};

const editBaselines = new WeakMap();

function announce(message) {
  $("liveStatus").textContent = message;
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function transportTime(now = performance.now()) {
  return state.transportOffset + (state.playing ? Math.max(0, now - state.transportStartedAt) / 1000 : 0);
}

function pushHistory(snapshot = clonePatch()) {
  state.history.push(snapshot);
  if (state.history.length > 24) state.history.shift();
  $("undoPatch").disabled = state.history.length === 0;
}

function schedulePatchUpdate() {
  if (state.patchFrame) return;
  state.patchFrame = requestAnimationFrame(() => {
    state.patchFrame = 0;
    engine.updatePatch(state.patch);
  });
}

function selectOptions(select, entries) {
  select.replaceChildren(...entries.map((entry) => {
    const option = document.createElement("option");
    option.value = String(entry.id);
    option.textContent = entry.label;
    return option;
  }));
}

function populateAlgorithmSelects() {
  selectOptions($("sourceA"), SIMD_SYNTH_SOURCE_MODELS);
  selectOptions($("sourceB"), SIMD_SYNTH_SOURCE_MODELS);
  selectOptions($("combine"), SIMD_SYNTH_COMBINERS);
  selectOptions($("shaper"), SIMD_SYNTH_SHAPERS);
  selectOptions($("filter1"), SIMD_SYNTH_FILTERS);
  selectOptions($("filter2"), SIMD_SYNTH_FILTERS);
  selectOptions($("filterRoute"), SIMD_SYNTH_FILTER_ROUTES);
  selectOptions($("fx1"), SIMD_SYNTH_FX);
  selectOptions($("fx2"), SIMD_SYNTH_FX);
  selectOptions($("scale"), SIMD_SYNTH_SCALES);
}

function renderPresetSelect() {
  const select = $("presetSelect");
  const selected = state.activePresetId;
  const groups = new Map();
  for (const preset of [...SIMD_SYNTH_PRESETS, ...state.userPresets]) {
    if (!groups.has(preset.category)) groups.set(preset.category, []);
    groups.get(preset.category).push(preset);
  }
  const fragments = [];
  if (selected === "custom") {
    const custom = document.createElement("optgroup");
    custom.label = "Current";
    const option = document.createElement("option");
    option.value = "custom";
    option.textContent = "Custom patch";
    custom.append(option);
    fragments.push(custom);
  }
  for (const [category, presets] of groups) {
    const group = document.createElement("optgroup");
    group.label = category;
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      option.title = preset.description;
      group.append(option);
    }
    fragments.push(group);
  }
  select.replaceChildren(...fragments);
  const exists = selected === "custom" || [...SIMD_SYNTH_PRESETS, ...state.userPresets].some(({ id }) => id === selected);
  state.activePresetId = exists ? selected : firstPreset.id;
  select.value = state.activePresetId;
  $("deletePreset").disabled = !state.activePresetId.startsWith("user:");
}

function logControlPosition(key, value) {
  const [minimum, maximum] = SIMD_SYNTH_LIMITS[key];
  return Math.log(value / minimum) / Math.log(maximum / minimum);
}

function valueFromControl(control) {
  const key = control.dataset.param;
  if (control.tagName === "SELECT") return Number(control.value);
  if (control.hasAttribute("data-log")) {
    const [minimum, maximum] = SIMD_SYNTH_LIMITS[key];
    return minimum * ((maximum / minimum) ** clamp(Number(control.value), 0, 1));
  }
  return Number(control.value);
}

function setDialPosition(control) {
  const dial = control.closest(".simd-dial");
  if (!dial) return;
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const turn = (Number(control.value) - minimum) / Math.max(0.000001, maximum - minimum);
  const normalized = clamp(turn, 0, 1);
  dial.style.setProperty("--knob-angle", `${-135 + normalized * 270}deg`);
  dial.style.setProperty("--knob-fill", `${normalized * 75}%`);
}

function commitKnobControl(control, rawValue) {
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const step = Math.max(0.000001, finite(control.step, 0.01));
  const stepCount = Math.round((clamp(rawValue, minimum, maximum) - minimum) / step);
  const value = clamp(minimum + stepCount * step, minimum, maximum);
  control.value = String(Number(value.toFixed(6)));
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

function formatTime(value) {
  if (value < 0.95) return `${Math.round(value * 1000)} ms`;
  return `${value.toFixed(value < 3 ? 2 : 1)} s`;
}

function formatFrequency(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`;
}

function formatParam(key, value) {
  if (["colorA", "colorB", "motionA", "motionB", "combineMix", "shaperAmount", "filterBlend", "resonance1", "resonance2", "sustain", "glide", "stereo", "drift", "fx1Amount", "fx1Feedback", "fx2Amount", "fx2Feedback", "swing", "gateLength"].includes(key)) return percent(value);
  if (key === "tuneA" || key === "tuneB") return `${value > 0 ? "+" : ""}${Math.round(value)} st`;
  if (key === "combineDrive") return `${value.toFixed(2)}×`;
  if (key === "cutoff1" || key === "cutoff2") return formatFrequency(value);
  if (["attack", "decay", "release", "fx1Time", "fx2Time"].includes(key)) return formatTime(value);
  if (key === "lfo1Rate" || key === "lfo2Rate") return `${value.toFixed(value < 1 ? 2 : 1)} Hz`;
  if (key === "bpm") return `${Math.round(value)} BPM`;
  if (key === "rootNote") return midiNoteName(value);
  return String(Math.round(value));
}

function syncParamControl(key) {
  const control = document.querySelector(`[data-param="${key}"]`);
  if (!control) return;
  const value = state.patch.params[key];
  if (control.hasAttribute("data-log")) control.value = String(logControlPosition(key, value));
  else control.value = String(value);
  setDialPosition(control);
  const output = $(`${key}Out`);
  const valueText = formatParam(key, value);
  if (output) output.textContent = valueText;
  if (control.tagName !== "SELECT") control.setAttribute("aria-valuetext", valueText);
}

function algorithm(entries, value) {
  return entries.find(({ id }) => id === Math.round(value)) ?? entries[0];
}

function syncSignalPath() {
  const params = state.patch.params;
  const sourceA = algorithm(SIMD_SYNTH_SOURCE_MODELS, params.sourceA);
  const sourceB = algorithm(SIMD_SYNTH_SOURCE_MODELS, params.sourceB);
  const combine = algorithm(SIMD_SYNTH_COMBINERS, params.combine);
  const filterRoute = algorithm(SIMD_SYNTH_FILTER_ROUTES, params.filterRoute);
  const fx1 = algorithm(SIMD_SYNTH_FX, params.fx1);
  const fx2 = algorithm(SIMD_SYNTH_FX, params.fx2);
  $("sourceAHint").textContent = sourceA.hint;
  $("sourceBHint").textContent = sourceB.hint;
  $("combineHint").textContent = combine.hint;
  $("sourceSummary").textContent = `${sourceA.label} + ${sourceB.label}`;
  $("combineSummary").textContent = combine.label;
  $("toneSummary").textContent = params.toneOrder ? "filters → shape" : "shape → filters";
  $("filterSummary").textContent = filterRoute.label;
  $("effectsSummary").textContent = params.fxOrder ? "2 → 1" : "1 → 2";
  $("toneOrderFirst").textContent = params.toneOrder ? "Filters" : "Shaper";
  $("toneOrderSecond").textContent = params.toneOrder ? "Shaper" : "Filters";
  $("fxOrderButton").replaceChildren();
  const first = document.createElement("span");
  const arrow = document.createElement("i");
  const second = document.createElement("span");
  first.textContent = params.fxOrder ? "FX 2" : "FX 1";
  second.textContent = params.fxOrder ? "FX 1" : "FX 2";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");
  $("fxOrderButton").append(first, arrow, second);
  const scale = algorithm(SIMD_SYNTH_SCALES, params.scale);
  $("clockSummary").textContent = `${scale.label} · ${Math.round(params.steps)} steps`;
}

function syncXY() {
  const x = state.patch.params.xyX;
  const y = state.patch.params.xyY;
  $("xyPad").style.setProperty("--x", String(x));
  $("xyPad").style.setProperty("--y", String(y));
  $("xyPad").style.setProperty("--y-inverse", String(1 - y));
  $("xyReadout").textContent = `${Math.round(x * 100)} · ${Math.round(y * 100)}`;
}

function syncAllControls() {
  for (const key of SIMD_SYNTH_PARAM_ORDER) syncParamControl(key);
  syncSignalPath();
  syncXY();
  renderSequence();
  renderModMatrix();
}

function setPatch(nextPatch, { presetId = "custom", history = true, message = "Patch loaded." } = {}) {
  if (history) pushHistory();
  state.patch = patchFrom(nextPatch);
  state.activePresetId = presetId;
  renderPresetSelect();
  syncAllControls();
  engine.updatePatch(state.patch);
  announce(message);
}

function findPreset(id) {
  return state.userPresets.find((entry) => entry.id === id) ?? simdSynthPresetById(id);
}

function bindParameterControls() {
  for (const control of document.querySelectorAll("[data-param]")) {
    if (control.tagName === "SELECT") {
      control.addEventListener("change", () => {
        pushHistory();
        state.patch.params[control.dataset.param] = valueFromControl(control);
        state.activePresetId = "custom";
        renderPresetSelect();
        syncParamControl(control.dataset.param);
        syncSignalPath();
        schedulePatchUpdate();
      });
      continue;
    }
    const captureBaseline = () => {
      if (!editBaselines.has(control)) editBaselines.set(control, clonePatch());
    };
    control.addEventListener("pointerdown", captureBaseline);
    control.addEventListener("keydown", captureBaseline);
    control.addEventListener("input", () => {
      state.patch.params[control.dataset.param] = valueFromControl(control);
      state.activePresetId = "custom";
      syncParamControl(control.dataset.param);
      syncSignalPath();
      schedulePatchUpdate();
    });
    control.addEventListener("change", () => {
      const baseline = editBaselines.get(control);
      if (baseline) pushHistory(baseline);
      editBaselines.delete(control);
      renderPresetSelect();
    });

    const dial = control.closest(".simd-dial");
    if (!dial) continue;
    control.title = "Drag vertically or use the arrow keys";
    let drag = null;
    control.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      control.focus({ preventScroll: true });
      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startValue: Number(control.value),
        changed: false,
      };
      dial.classList.add("is-dragging");
      try { control.setPointerCapture?.(event.pointerId); } catch {}
    });
    control.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const range = Number(control.max) - Number(control.min);
      const nextValue = drag.startValue + ((drag.startY - event.clientY) / 120) * range;
      const previousValue = control.value;
      commitKnobControl(control, nextValue);
      drag.changed ||= control.value !== previousValue;
    });
    const finishDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const changed = drag.changed;
      drag = null;
      dial.classList.remove("is-dragging");
      try {
        if (control.hasPointerCapture?.(event.pointerId)) control.releasePointerCapture(event.pointerId);
      } catch {}
      if (changed) control.dispatchEvent(new Event("change", { bubbles: true }));
      else editBaselines.delete(control);
    };
    control.addEventListener("pointerup", finishDrag);
    control.addEventListener("pointercancel", finishDrag);
    control.addEventListener("lostpointercapture", (event) => {
      if (drag?.pointerId === event.pointerId) finishDrag(event);
    });
  }
}

function bindPanelAccordion() {
  const sections = [...document.querySelectorAll(".simd-synth-panel details.control-section")];
  for (const section of sections) {
    section.addEventListener("toggle", () => {
      if (!section.open) return;
      for (const sibling of sections) {
        if (sibling !== section) sibling.open = false;
      }
    });
  }
}

function renderModMatrix() {
  const container = $("modMatrix");
  container.replaceChildren(...state.patch.modRoutes.map((route, index) => {
    const row = document.createElement("div");
    row.className = "simd-mod-row";
    const number = document.createElement("b");
    number.textContent = String(index + 1);
    const source = document.createElement("select");
    source.setAttribute("aria-label", `Modulation ${index + 1} source`);
    selectOptions(source, SIMD_SYNTH_MOD_SOURCES);
    source.value = String(route[0]);
    const destination = document.createElement("select");
    destination.setAttribute("aria-label", `Modulation ${index + 1} destination`);
    selectOptions(destination, SIMD_SYNTH_MOD_DESTINATIONS);
    destination.value = String(route[1]);
    const depthWrap = document.createElement("label");
    depthWrap.className = "simd-mod-depth";
    const depth = document.createElement("input");
    depth.type = "range";
    depth.min = "-1";
    depth.max = "1";
    depth.step = "0.01";
    depth.value = String(route[2]);
    depth.setAttribute("aria-label", `Modulation ${index + 1} bipolar depth`);
    const output = document.createElement("output");
    output.textContent = `${route[2] >= 0 ? "+" : ""}${Math.round(route[2] * 100)}`;
    depthWrap.append(depth, output);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "simd-mod-clear";
    clear.textContent = "×";
    clear.title = `Clear modulation route ${index + 1}`;
    clear.setAttribute("aria-label", clear.title);
    source.addEventListener("change", () => {
      pushHistory();
      state.patch.modRoutes[index][0] = Number(source.value);
      state.activePresetId = "custom";
      renderPresetSelect();
      schedulePatchUpdate();
    });
    destination.addEventListener("change", () => {
      pushHistory();
      state.patch.modRoutes[index][1] = Number(destination.value);
      state.activePresetId = "custom";
      renderPresetSelect();
      schedulePatchUpdate();
    });
    let baseline = null;
    const remember = () => { baseline ??= clonePatch(); };
    depth.addEventListener("pointerdown", remember);
    depth.addEventListener("keydown", remember);
    depth.addEventListener("input", () => {
      state.patch.modRoutes[index][2] = Number(depth.value);
      output.textContent = `${Number(depth.value) >= 0 ? "+" : ""}${Math.round(Number(depth.value) * 100)}`;
      state.activePresetId = "custom";
      schedulePatchUpdate();
    });
    depth.addEventListener("change", () => {
      if (baseline) pushHistory(baseline);
      baseline = null;
      renderPresetSelect();
    });
    clear.addEventListener("click", () => {
      pushHistory();
      state.patch.modRoutes[index] = [0, 0, 0, 0];
      state.activePresetId = "custom";
      renderPresetSelect();
      renderModMatrix();
      schedulePatchUpdate();
      announce(`Modulation route ${index + 1} cleared.`);
    });
    row.append(number, source, destination, depthWrap, clear);
    return row;
  }));
}

function formatSequenceLaneValue(lane, value) {
  if (lane === "pitch") return `${value >= 0 ? "+" : ""}${Math.round(value)} degrees`;
  if (lane === "gate") return value >= 0.5 ? "on" : "off";
  return percent(value);
}

function setSequenceLane(nextLane) {
  const lane = SEQUENCE_LANES[nextLane] ? nextLane : "pitch";
  state.sequenceLane = lane;
  for (const button of document.querySelectorAll("[data-sequence-lane]")) {
    button.setAttribute("aria-pressed", String(button.dataset.sequenceLane === lane));
  }
  $("sequenceLaneState").textContent = `${SEQUENCE_LANES[lane].label.toLowerCase()} lane`;
  renderSequence();
  announce(`${SEQUENCE_LANES[lane].label} lane selected. Drag a bar or use the arrow keys.`);
}

function renderSequence() {
  const container = $("sequencer");
  const activeLength = state.patch.params.steps;
  const lane = state.sequenceLane;
  const laneSpec = SEQUENCE_LANES[lane];
  container.replaceChildren(...state.patch.sequence.map((step, index) => {
    const cell = document.createElement("div");
    cell.className = "simd-step";
    cell.dataset.lane = lane;
    cell.dataset.stepIndex = String(index);
    cell.classList.toggle("is-outside", index >= activeLength);
    cell.classList.toggle("is-current", index === state.currentStep && state.playing);
    const number = document.createElement("b");
    number.textContent = String(index + 1).padStart(2, "0");

    const track = document.createElement("div");
    track.className = "simd-step-track";
    const bar = document.createElement("span");
    bar.className = "simd-step-bar";
    bar.setAttribute("aria-hidden", "true");
    const control = document.createElement("input");
    control.className = "simd-step-control";
    control.type = "range";
    control.min = String(laneSpec.min);
    control.max = String(laneSpec.max);
    control.step = String(laneSpec.step);
    control.value = String(step[laneSpec.component]);
    control.setAttribute("aria-label", lane === "pitch" ? `Step ${index + 1} scale degree` : `Step ${index + 1} ${lane.toLowerCase()}`);
    control.title = `Step ${index + 1} ${laneSpec.label.toLowerCase()}`;

    const paint = () => {
      const value = Number(control.value);
      const normalized = clamp((value - laneSpec.min) / Math.max(0.000001, laneSpec.max - laneSpec.min), 0, 1);
      const hue = Math.round((index * 47 + normalized * 220) % 360);
      cell.style.setProperty("--step-level", `${Math.round(5 + normalized * 95)}%`);
      cell.style.setProperty("--step-hue", String(hue));
      cell.style.setProperty("--step-hue-b", String((hue + 130) % 360));
      cell.style.setProperty("--step-hue-c", String((hue + 260) % 360));
      control.setAttribute("aria-valuetext", formatSequenceLaneValue(lane, value));
    };

    let baseline = null;
    const remember = () => { baseline ??= clonePatch(); };
    control.addEventListener("keydown", remember);
    control.addEventListener("input", () => {
      state.patch.sequence[index][laneSpec.component] = Number(control.value);
      state.activePresetId = "custom";
      paint();
      schedulePatchUpdate();
    });
    control.addEventListener("change", () => {
      if (baseline) pushHistory(baseline);
      baseline = null;
      renderPresetSelect();
    });
    paint();
    track.append(bar, control);
    cell.append(number, track);
    return cell;
  }));
}

function quantizedSequenceValue(laneSpec, normalized) {
  const rawValue = laneSpec.min + clamp(normalized, 0, 1) * (laneSpec.max - laneSpec.min);
  const ticks = Math.round((rawValue - laneSpec.min) / laneSpec.step);
  return Number(clamp(laneSpec.min + ticks * laneSpec.step, laneSpec.min, laneSpec.max).toFixed(6));
}

function sequencePoint(clientX, clientY, laneSpec) {
  const cells = [...$("sequencer").querySelectorAll(".simd-step")];
  if (!cells.length) return null;
  const firstRect = cells[0].getBoundingClientRect();
  const lastRect = cells.at(-1).getBoundingClientRect();
  const width = Math.max(1, lastRect.right - firstRect.left);
  const x = clamp((clientX - firstRect.left) / width, 0, 0.999999);
  const index = Math.min(cells.length - 1, Math.floor(x * cells.length));
  const trackRect = cells[index].querySelector(".simd-step-track").getBoundingClientRect();
  const normalized = clamp((trackRect.bottom - clientY) / Math.max(1, trackRect.height), 0, 1);
  return { index, normalized, value: quantizedSequenceValue(laneSpec, normalized) };
}

function bindSequencePainter() {
  const container = $("sequencer");
  let gesture = null;

  const applyPoint = (point) => {
    if (!gesture || !point) return;
    const distance = Math.abs(point.index - gesture.lastIndex);
    const direction = Math.sign(point.index - gesture.lastIndex) || 1;
    for (let offset = 0; offset <= distance; offset += 1) {
      const index = gesture.lastIndex + offset * direction;
      const progress = distance ? offset / distance : 1;
      const normalized = gesture.lastNormalized + (point.normalized - gesture.lastNormalized) * progress;
      const value = quantizedSequenceValue(gesture.laneSpec, normalized);
      const control = container.querySelector(`.simd-step[data-step-index="${index}"] .simd-step-control`);
      if (!control || Number(control.value) === value) continue;
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      gesture.changed = true;
    }
    gesture.lastIndex = point.index;
    gesture.lastNormalized = point.normalized;
  };

  const finish = (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const completed = gesture;
    gesture = null;
    container.removeAttribute("data-painting");
    try {
      if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId);
    } catch {}
    if (!completed.changed) return;
    pushHistory(completed.baseline);
    renderPresetSelect();
    announce(`${completed.laneSpec.label} pattern painted.`);
  };

  container.addEventListener("pointerdown", (event) => {
    if ((event.button !== undefined && event.button !== 0) || event.isPrimary === false) return;
    const laneSpec = SEQUENCE_LANES[state.sequenceLane];
    const point = sequencePoint(event.clientX, event.clientY, laneSpec);
    if (!point) return;
    event.preventDefault();
    gesture = {
      pointerId: event.pointerId,
      laneSpec,
      baseline: clonePatch(),
      changed: false,
      lastIndex: point.index,
      lastNormalized: point.normalized,
    };
    container.setAttribute("data-painting", "");
    container.querySelector(`.simd-step[data-step-index="${point.index}"] .simd-step-control`)?.focus({ preventScroll: true });
    try { container.setPointerCapture?.(event.pointerId); } catch {}
    applyPoint(point);
  });
  container.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    applyPoint(sequencePoint(event.clientX, event.clientY, gesture.laneSpec));
  });
  container.addEventListener("pointerup", finish);
  container.addEventListener("pointercancel", finish);
  container.addEventListener("lostpointercapture", finish);
}

function mutateSequence() {
  pushHistory();
  const sequence = state.patch.sequence.map((step, index) => {
    if (Math.random() > 0.34) return [...step];
    const pitch = clamp(step[0] + [-3, -2, 2, 3, 5][Math.floor(Math.random() * 5)], -12, 24);
    return [pitch, Math.random() < 0.14 ? 1 - step[1] : step[1], clamp(step[2] + (Math.random() - 0.5) * 0.3, 0.05, 1), Math.random() < 0.22 ? Math.random() * 0.75 : step[3]];
  });
  state.patch.sequence = sequence;
  state.activePresetId = "custom";
  renderPresetSelect();
  renderSequence();
  schedulePatchUpdate();
  announce("Step expression mutated.");
}

function randomPatch() {
  pushHistory();
  const randomChoice = (length) => Math.floor(Math.random() * length);
  const params = {
    ...state.patch.params,
    sourceA: randomChoice(SIMD_SYNTH_SOURCE_MODELS.length),
    sourceB: randomChoice(SIMD_SYNTH_SOURCE_MODELS.length),
    tuneA: [-12, -7, 0, 0, 0, 7, 12][randomChoice(7)],
    tuneB: [-12, -5, 0, 7, 12, 19][randomChoice(6)],
    colorA: Math.random(), colorB: Math.random(), motionA: Math.random(), motionB: Math.random(),
    detailA: 3 + randomChoice(22), detailB: 3 + randomChoice(22),
    combine: randomChoice(SIMD_SYNTH_COMBINERS.length), combineMix: 0.14 + Math.random() * 0.7,
    combineDrive: 0.55 + Math.random() * 2.1,
    shaper: randomChoice(SIMD_SYNTH_SHAPERS.length), shaperAmount: Math.random() * 0.48,
    toneOrder: randomChoice(2),
    filter1: 1 + randomChoice(SIMD_SYNTH_FILTERS.length - 1), filter2: randomChoice(SIMD_SYNTH_FILTERS.length),
    cutoff1: 280 * (48 ** Math.random()), cutoff2: 340 * (38 ** Math.random()),
    resonance1: Math.random() * 0.78, resonance2: Math.random() * 0.78,
    filterRoute: randomChoice(SIMD_SYNTH_FILTER_ROUTES.length), filterBlend: Math.random(),
    attack: 0.002 * (120 ** Math.random()), decay: 0.08 * (24 ** Math.random()), sustain: 0.12 + Math.random() * 0.78,
    release: 0.08 * (40 ** Math.random()), stereo: 0.25 + Math.random() * 0.75, drift: Math.random() * 0.34,
    fx1: randomChoice(SIMD_SYNTH_FX.length), fx2: randomChoice(SIMD_SYNTH_FX.length),
    fx1Amount: Math.random() * 0.48, fx2Amount: Math.random() * 0.48,
    fx1Time: 0.003 * (100 ** Math.random()), fx2Time: 0.003 * (100 ** Math.random()),
    fx1Feedback: Math.random() * 0.62, fx2Feedback: Math.random() * 0.62, fxOrder: randomChoice(2),
    seed: 1 + randomChoice(65_534),
  };
  const sources = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const destinations = SIMD_SYNTH_MOD_DESTINATIONS.map(({ id }) => id);
  state.patch = patchFrom({
    params,
    sequence: createSimdSynthSequence(params.seed, 0.42 + Math.random() * 0.48),
    modRoutes: Array.from({ length: 4 }, (_, index) => [sources[randomChoice(sources.length)], destinations[randomChoice(destinations.length)], (index > 1 ? 1 : Math.sign(Math.random() - 0.5)) * (0.18 + Math.random() * 0.7), 0]),
  });
  state.activePresetId = "custom";
  renderPresetSelect();
  syncAllControls();
  engine.updatePatch(state.patch);
  announce("A bounded random rack was built. Init is always one tap away.");
}

function syncTransport() {
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause SIMD SYNTH sequence" : "Play SIMD SYNTH sequence");
  $("playLabel").textContent = state.playing ? "Pause sequence" : "Play sequence";
  $("playState").textContent = `${state.playing ? "running" : "paused"} · ${state.audioOn ? "audible" : "Audio off"}`;
}

function toggleTransport() {
  if (state.playing) {
    state.transportOffset = transportTime();
    state.playing = false;
    engine.setTransport(false, state.transportOffset);
    announce("Sequence paused.");
  } else {
    state.transportStartedAt = performance.now();
    state.playing = true;
    engine.setTransport(true, state.transportOffset);
    announce(state.audioOn ? "Sequence playing." : "Sequence running silently. Turn Audio on when ready.");
  }
  syncTransport();
}

function syncAudioState() {
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioButton").disabled = state.audioBusy;
  $("audioState").textContent = state.audioBusy ? "loading" : state.audioOn ? engine.backend : "off";
  $("scopeState").textContent = state.audioOn ? "live" : "audio off";
  syncTransport();
}

async function enableAudio() {
  if (state.audioOn || state.audioBusy) return state.audioOn;
  state.audioBusy = true;
  clearError();
  syncAudioState();
  try {
    engine.setOutput(Number($("outputLevel").value));
    await engine.start(state.patch, {
      transportEnabled: state.playing,
      sequenceTime: transportTime(),
    });
    state.audioOn = true;
    for (const { note, velocity } of state.activeNotes.values()) engine.noteOn(note, velocity);
    announce(`${engine.backend === "simd" ? "Four-lane Wasm SIMD" : "Scalar Wasm fallback"} audio is on.`);
    return true;
  } catch (error) {
    state.audioOn = false;
    showError(error);
    announce("SIMD SYNTH could not start audio.");
    return false;
  } finally {
    state.audioBusy = false;
    syncAudioState();
  }
}

async function disableAudio({ quiet = false } = {}) {
  if (state.audioBusy) return;
  state.audioBusy = true;
  state.audioOn = false;
  syncAudioState();
  await engine.stop().catch(() => {});
  state.audioBusy = false;
  syncAudioState();
  if (!quiet) announce("Audio off. The transport state is preserved.");
}

function noteTokensFor(note) {
  return [...state.activeNotes.values()].filter((voice) => voice.note === note);
}

function syncKeyboard() {
  for (const key of $("keyboard").querySelectorAll(".simd-key")) {
    key.classList.toggle("is-active", noteTokensFor(Number(key.dataset.note)).length > 0);
  }
  const held = [...new Set([...state.activeNotes.values()].map(({ note, label }) => label || midiNoteName(note)))];
  $("noteReadout").textContent = held.length ? held.join(" · ") : "Z–M · Q–U";
}

function startNote(token, noteValue, velocityValue = 0.82, label = "") {
  const note = clamp(Math.round(noteValue), 0, 127);
  const velocity = clamp(finite(velocityValue, 0.82), 0.01, 1);
  if (state.activeNotes.has(token)) stopNote(token);
  state.activeNotes.set(token, { note, velocity, label });
  if (state.audioOn) engine.noteOn(note, velocity);
  syncKeyboard();
  announce(state.audioOn ? `${midiNoteName(note)} on.` : `${midiNoteName(note)} held. Audio is off.`);
}

function stopNote(token) {
  const voice = state.activeNotes.get(token);
  if (!voice) return;
  state.activeNotes.delete(token);
  if (state.audioOn && noteTokensFor(voice.note).length === 0) engine.noteOff(voice.note);
  syncKeyboard();
}

function panic() {
  state.activeNotes.clear();
  state.xyNote = null;
  engine.panic();
  syncKeyboard();
  announce("All voices released.");
}

function renderKeyboard() {
  const root = 48;
  const makeButton = ({ code, label, offset }) => {
    const note = root + offset;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `simd-key${BLACK_NOTES.has(note % 12) ? " is-black" : ""}`;
    button.dataset.note = String(note);
    button.dataset.keyCode = code;
    const keycap = document.createElement("kbd");
    keycap.textContent = label;
    button.append(keycap);
    button.setAttribute("aria-label", `${label} key, ${midiNoteName(note)}`);
    const token = `screen:${note}`;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      const rect = button.getBoundingClientRect();
      startNote(token, note, 0.45 + clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1) * 0.5, label);
    });
    const release = (event) => {
      if (event.pointerId !== undefined && button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      stopNote(token);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", () => stopNote(token));
    button.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        startNote(`key:${note}`, note, 0.82, label);
      }
    });
    button.addEventListener("keyup", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        stopNote(`key:${note}`);
      }
    });
    return button;
  };
  const upper = document.createElement("div");
  upper.className = "simd-key-row simd-key-row-upper";
  upper.append(...COMPUTER_PIANO_KEYS.slice(12).map(makeButton));
  const lower = document.createElement("div");
  lower.className = "simd-key-row simd-key-row-lower";
  lower.append(...COMPUTER_PIANO_KEYS.slice(0, 12).map(makeButton));
  $("keyboard").replaceChildren(upper, lower);
}

function xyNote() {
  const scale = algorithm(SIMD_SYNTH_SCALES, state.patch.params.scale);
  const position = clamp(state.patch.params.xyX, 0, 1);
  const degree = Math.round(position * (scale.intervals.length * 2 - 1));
  const octave = Math.floor(degree / scale.intervals.length);
  return clamp(state.patch.params.rootNote + scale.intervals[degree % scale.intervals.length] + octave * 12, 0, 127);
}

function setXYFromPoint(clientX, clientY, { play = false } = {}) {
  const rect = $("xyPad").getBoundingClientRect();
  state.patch.params.xyX = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  state.patch.params.xyY = clamp(1 - (clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  state.activePresetId = "custom";
  syncXY();
  schedulePatchUpdate();
  if (play) {
    const nextNote = xyNote();
    if (nextNote !== state.xyNote) {
      if (state.xyNote !== null) stopNote("xy");
      state.xyNote = nextNote;
      startNote("xy", nextNote, 0.28 + state.patch.params.xyY * 0.7);
    }
  }
}

function bindXY() {
  const pad = $("xyPad");
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pushHistory();
    state.xyPointer = event.pointerId;
    pad.setPointerCapture?.(event.pointerId);
    setXYFromPoint(event.clientX, event.clientY, { play: true });
  });
  pad.addEventListener("pointermove", (event) => {
    if (state.xyPointer !== event.pointerId) return;
    setXYFromPoint(event.clientX, event.clientY, { play: true });
  });
  const release = (event) => {
    if (state.xyPointer !== event.pointerId) return;
    state.xyPointer = null;
    state.xyNote = null;
    stopNote("xy");
    renderPresetSelect();
  };
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
  pad.addEventListener("lostpointercapture", () => {
    state.xyPointer = null;
    state.xyNote = null;
    stopNote("xy");
  });
  pad.addEventListener("keydown", (event) => {
    const movement = event.shiftKey ? 0.1 : 0.025;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat) pushHistory();
      if (event.key === "ArrowLeft") state.patch.params.xyX = clamp(state.patch.params.xyX - movement, 0, 1);
      if (event.key === "ArrowRight") state.patch.params.xyX = clamp(state.patch.params.xyX + movement, 0, 1);
      if (event.key === "ArrowDown") state.patch.params.xyY = clamp(state.patch.params.xyY - movement, 0, 1);
      if (event.key === "ArrowUp") state.patch.params.xyY = clamp(state.patch.params.xyY + movement, 0, 1);
      state.activePresetId = "custom";
      syncXY();
      schedulePatchUpdate();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
      event.preventDefault();
      state.xyNote = xyNote();
      startNote("xy-key", state.xyNote, 0.28 + state.patch.params.xyY * 0.7);
    }
  });
  pad.addEventListener("keyup", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      state.xyNote = null;
      stopNote("xy-key");
    }
  });
}

function resizeScope() {
  const canvas = $("scopeCanvas");
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(320, Math.round(rect.width * ratio));
  const height = Math.max(140, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawScope() {
  const canvas = $("scopeCanvas");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#070b11";
  context.fillRect(0, 0, width, height);
  context.lineWidth = 1;
  context.strokeStyle = "rgba(117, 239, 255, 0.08)";
  for (let index = 1; index < 8; index += 1) {
    context.beginPath();
    context.moveTo((width * index) / 8, 0);
    context.lineTo((width * index) / 8, height);
    context.stroke();
  }
  for (let index = 1; index < 4; index += 1) {
    context.beginPath();
    context.moveTo(0, (height * index) / 4);
    context.lineTo(width, (height * index) / 4);
    context.stroke();
  }
  context.strokeStyle = "rgba(201, 255, 105, 0.16)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  const data = state.audioOn ? engine.timeDomainData() : null;
  if (data?.length) {
    let start = 0;
    for (let index = 1; index < Math.min(data.length / 2, 700); index += 1) {
      if (data[index - 1] <= 0 && data[index] > 0) { start = index; break; }
    }
    let rms = 0;
    context.beginPath();
    for (let pixel = 0; pixel < width; pixel += 1) {
      const index = Math.min(data.length - 1, start + Math.floor((pixel / width) * (data.length - start - 1)));
      const sample = data[index];
      rms += sample * sample;
      const y = height * 0.5 - sample * height * 0.43;
      if (pixel === 0) context.moveTo(pixel, y); else context.lineTo(pixel, y);
    }
    context.lineWidth = Math.max(1.25, width / 900);
    context.strokeStyle = "#75efff";
    context.shadowBlur = 9;
    context.shadowColor = "rgba(117, 239, 255, 0.65)";
    context.stroke();
    context.shadowBlur = 0;
    $("scopeState").textContent = "live";
  }
}

function swingClock(straightTime, swing) {
  const amount = clamp(swing, 0, 0.42);
  const pair = Math.floor(straightTime / 2);
  const within = straightTime - pair * 2;
  const evenDuration = 1 + amount;
  return within < evenDuration
    ? pair * 2 + within / evenDuration
    : pair * 2 + 1 + (within - evenDuration) / (1 - amount);
}

function updatePerformanceFrame(now) {
  if (state.playing) {
    const straight = transportTime(now) * state.patch.params.bpm / 60 * 4;
    const step = Math.floor(swingClock(straight, state.patch.params.swing)) % state.patch.params.steps;
    if (step !== state.currentStep) {
      state.currentStep = step;
      for (const [index, element] of [...$("sequencer").children].entries()) element.classList.toggle("is-current", index === step);
    }
  } else if (state.currentStep !== -1) {
    state.currentStep = -1;
    for (const element of $("sequencer").children) element.classList.remove("is-current");
  }
  const lamps = [...$("voiceLamps").children];
  lamps.forEach((lamp, index) => {
    const sequenceVoice = index === 0 && state.playing && Boolean(state.patch.sequence[Math.max(0, state.currentStep)]?.[1]);
    const manualVoice = index > 0 && index <= state.activeNotes.size;
    lamp.classList.toggle("is-active", sequenceVoice || manualVoice);
  });
  drawScope();
  state.scopeFrame = requestAnimationFrame(updatePerformanceFrame);
}

function normalizeMidiVelocity(value) {
  const velocity = finite(value, 100);
  return clamp(velocity > 1 ? velocity / 127 : velocity, 0.01, 1);
}

function midiToken(message) {
  return `midi:${message.sourceId ?? "input"}:${message.channel ?? 0}:${message.note ?? 60}`;
}

function handleMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (!message || (routeId && routeId !== "simd-synth")) return;
  let handled = true;
  if (message.type === "noteOn" && finite(message.velocity, 1) > 0) {
    startNote(midiToken(message), message.note, normalizeMidiVelocity(message.velocity));
  } else if (message.type === "noteOff" || (message.type === "noteOn" && finite(message.velocity, 0) <= 0)) {
    stopNote(midiToken(message));
  } else if (message.type === "controlChange" && Number(message.controller) === 1) {
    pushHistory();
    state.patch.params.xyY = clamp(finite(message.normalized, finite(message.value, 0) / 127), 0, 1);
    state.activePresetId = "custom";
    syncXY();
    schedulePatchUpdate();
  } else if (message.type === "controlChange" && Number(message.controller) === 74) {
    pushHistory();
    state.patch.params.xyX = clamp(finite(message.normalized, finite(message.value, 0) / 127), 0, 1);
    state.activePresetId = "custom";
    syncXY();
    schedulePatchUpdate();
  } else if (message.type === "programChange") {
    const presets = [...SIMD_SYNTH_PRESETS, ...state.userPresets];
    const preset = presets[Math.abs(Math.round(finite(message.program, 0))) % presets.length];
    setPatch(preset, { presetId: preset.id, message: `${preset.label} loaded from MIDI program change.` });
  } else if (message.type === "allNotesOff") {
    panic();
  } else handled = false;
  if (handled) event.preventDefault();
}

function keyTargetOwnsTyping(target) {
  return Boolean(target?.closest?.("input, select, textarea, button, [contenteditable='true']"));
}

function handleComputerKeyDown(event) {
  const entry = COMPUTER_PIANO_KEY_BY_CODE.get(event.code);
  if (!entry || event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (keyTargetOwnsTyping(event.target)) return false;
  event.preventDefault();
  startNote(`computer:${entry.code}`, 48 + entry.offset, 0.82, entry.label);
  return true;
}

function handleComputerKeyUp(event) {
  const entry = COMPUTER_PIANO_KEY_BY_CODE.get(event.code);
  if (!entry) return false;
  const token = `computer:${entry.code}`;
  if (!state.activeNotes.has(token)) return false;
  event.preventDefault();
  stopNote(token);
  return true;
}

engine.setErrorHandler(showError);

populateAlgorithmSelects();
renderPresetSelect();
renderKeyboard();
$("voiceLamps").replaceChildren(...Array.from({ length: 8 }, (_, index) => {
  const lamp = document.createElement("span");
  lamp.className = "simd-voice-lamp";
  lamp.title = `Voice ${index + 1}`;
  return lamp;
}));
bindParameterControls();
bindPanelAccordion();
bindXY();
syncAllControls();
bindSequencePainter();
syncAudioState();
engine.setOutput(Number($("outputLevel").value));

$("audioButton").addEventListener("click", () => state.audioOn ? void disableAudio() : void enableAudio());
$("playButton").addEventListener("click", toggleTransport);
$("outputLevel").addEventListener("input", () => {
  const value = clamp(Number($("outputLevel").value), 0, 1);
  $("outputLevelOut").textContent = percent(value);
  engine.setOutput(value);
});
$("presetSelect").addEventListener("change", () => {
  const preset = findPreset($("presetSelect").value);
  setPatch(preset, { presetId: preset.id, message: `${preset.label} loaded. ${preset.description}` });
});
$("initPatch").addEventListener("click", () => setPatch(SIMD_SYNTH_INIT_PRESET, { presetId: SIMD_SYNTH_INIT_PRESET.id, message: "Clean Init restored." }));
$("undoPatch").addEventListener("click", () => {
  const previous = state.history.pop();
  if (!previous) return;
  state.patch = patchFrom(previous);
  state.activePresetId = "custom";
  renderPresetSelect();
  syncAllControls();
  engine.updatePatch(state.patch);
  $("undoPatch").disabled = state.history.length === 0;
  announce("Previous patch state restored.");
});
$("randomPatch").addEventListener("click", randomPatch);
$("panicButton").addEventListener("click", panic);
$("toneOrderButton").addEventListener("click", () => {
  pushHistory();
  state.patch.params.toneOrder = state.patch.params.toneOrder ? 0 : 1;
  state.activePresetId = "custom";
  renderPresetSelect();
  syncSignalPath();
  schedulePatchUpdate();
  announce(`Tone path is now ${state.patch.params.toneOrder ? "filters into shaper" : "shaper into filters"}.`);
});
$("fxOrderButton").addEventListener("click", () => {
  pushHistory();
  state.patch.params.fxOrder = state.patch.params.fxOrder ? 0 : 1;
  state.activePresetId = "custom";
  renderPresetSelect();
  syncSignalPath();
  schedulePatchUpdate();
  announce(`Effects now run ${state.patch.params.fxOrder ? "slot 2 into slot 1" : "slot 1 into slot 2"}.`);
});
$("savePreset").addEventListener("click", () => {
  try {
    const preset = createSimdSynthUserPreset(state.patch, $("presetName").value);
    const next = [preset, ...state.userPresets].slice(0, 64);
    if (!persistSimdSynthUserPresets(globalThis.localStorage, next)) throw new Error("This browser did not allow local preset storage.");
    state.userPresets = next;
    state.activePresetId = preset.id;
    $("presetName").value = "";
    renderPresetSelect();
    announce(`${preset.label} saved in this browser.`);
  } catch (error) {
    showError(error);
  }
});

$("deletePreset").addEventListener("click", () => {
  const preset = state.userPresets.find(({ id }) => id === state.activePresetId);
  if (!preset) return;
  if (!globalThis.confirm?.(`Delete the browser preset “${preset.label}”?`)) return;
  const next = state.userPresets.filter(({ id }) => id !== preset.id);
  if (!persistSimdSynthUserPresets(globalThis.localStorage, next)) {
    showError("This browser did not allow the preset to be removed.");
    return;
  }
  state.userPresets = next;
  state.activePresetId = firstPreset.id;
  renderPresetSelect();
  setPatch(firstPreset, { presetId: firstPreset.id, history: false, message: `${preset.label} removed from this browser.` });
});

for (const button of document.querySelectorAll("[data-sequence-lane]")) {
  button.addEventListener("click", () => setSequenceLane(button.dataset.sequenceLane));
}

$("randomSequence").addEventListener("click", () => {
  pushHistory();
  state.patch.sequence = createSimdSynthSequence(Date.now() & 0xffff, 0.66);
  state.activePresetId = "custom";
  renderPresetSelect();
  renderSequence();
  schedulePatchUpdate();
  announce("Sequence randomized.");
});
$("mutateSequence").addEventListener("click", mutateSequence);
$("rotateSequence").addEventListener("click", () => {
  pushHistory();
  state.patch.sequence = [state.patch.sequence.at(-1), ...state.patch.sequence.slice(0, -1)].map((step) => [...step]);
  state.activePresetId = "custom";
  renderPresetSelect();
  renderSequence();
  schedulePatchUpdate();
  announce("Sequence rotated one step.");
});
$("resetSequence").addEventListener("click", () => {
  pushHistory();
  state.patch.sequence = SIMD_SYNTH_DEFAULT_SEQUENCE.map((step) => [...step]);
  state.activePresetId = "custom";
  renderPresetSelect();
  renderSequence();
  schedulePatchUpdate();
  announce("Sequence reset without changing the sound patch.");
});

globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
document.addEventListener("keydown", (event) => {
  if (handleComputerKeyDown(event)) return;
  if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (keyTargetOwnsTyping(event.target)) return;
  event.preventDefault();
  toggleTransport();
});
document.addEventListener("keyup", handleComputerKeyUp);
globalThis.addEventListener("blur", () => {
  for (const token of [...state.activeNotes.keys()]) {
    if (!token.startsWith("midi:")) stopNote(token);
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  for (const token of [...state.activeNotes.keys()]) {
    if (!token.startsWith("midi:")) stopNote(token);
  }
});

const scopeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resizeScope) : null;
scopeObserver?.observe($("scopeCanvas"));
resizeScope();
state.scopeFrame = requestAnimationFrame(updatePerformanceFrame);

globalThis.addEventListener("pagehide", () => {
  if (state.patchFrame) cancelAnimationFrame(state.patchFrame);
  if (state.scopeFrame) cancelAnimationFrame(state.scopeFrame);
  scopeObserver?.disconnect();
  globalThis.removeEventListener("morphazoid:midi-input", handleMidiInput);
  void disableAudio({ quiet: true });
}, { once: true });
