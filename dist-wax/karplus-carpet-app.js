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
  KarplusCarpetAudio,
  buildKarplusCarpetEvents,
  karplusCarpetEvent,
  karplusCarpetIntervalMs,
  karplusCarpetResumeTime,
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
  "hitCount",
  "hitDensity",
  "grainDuration",
  "timingJitter",
  "pitchSpread",
  "velocityScatter",
  "stereoSpread",
]);

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
  pitchBendCents: 0,
  audioOn: false,
  playing: false,
  looping: false,
  wovenHits: 0,
};

let pitchCells = karplusStrongStringFrequencies(state);
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let transportTimer = 0;
let nextHitAt = 0;
let hitIndex = 0;
let passSeed = 1;
let pointerActive = false;
let lastPointerGrainAt = 0;
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

function synthSettings() {
  return sanitizeKarplusStrongSettings(state);
}

function paintAudioState() {
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioState").textContent = state.audioOn ? "on" : "off";
}

function setAudioState(on) {
  state.audioOn = Boolean(on);
  audio.setOutput(state.audioOn ? state.level : 0);
  if (!state.audioOn) audio.stopAll();
  paintAudioState();
  paintReadouts();
}

async function enableAudio() {
  $("audioError").hidden = true;
  try {
    await audio.start();
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
  $("hitCountOut").textContent = state.hitCount + " hits";
  $("hitDensityOut").textContent = state.hitDensity + " /s";
  $("grainDurationOut").textContent = Math.round(state.grainDuration * 1_000) + " ms";
  $("timingJitterOut").textContent = formatPercent(state.timingJitter);
  $("pitchSpreadOut").textContent = formatPercent(state.pitchSpread);
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
  $("playSummary").textContent = state.hitCount + " hits \u00b7 "
    + (state.playing ? "weaving" : "ready");
  $("hitReadout").textContent = state.hitCount + " micro-attacks";
  $("densityReadout").textContent = state.hitDensity + " hits / second";
  $("progressOut").textContent = state.wovenHits + " / " + state.hitCount + " woven";
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
    state.hitCount + " HITS",
    state.hitDensity + " /S",
    Math.round(state.grainDuration * 1_000) + " MS",
    state.playing ? "WEAVING" : state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" \u00b7 ");
  canvas.setAttribute("aria-valuenow", String(Math.round(state.centerPosition * 100)));
  canvas.setAttribute(
    "aria-valuetext",
    "Center " + formatFrequency(centerFrequency) + ", "
      + formatPercent(state.pitchSpread) + " pitch spread",
  );
  $("carpetButton").setAttribute("aria-pressed", String(state.playing));
  $("carpetButton").setAttribute(
    "aria-label",
    state.playing ? "Stop Karplus Carpet" : "Start Karplus Carpet",
  );
  $("loopCarpet").setAttribute("aria-pressed", String(state.looping));
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

function applyPreset(item, options = {}) {
  const outputLevel = state.level;
  Object.assign(state, item.settings);
  state.level = outputLevel;
  state.selectedPresetId = item.id;
  $("presetSummary").textContent = item.name;
  for (const specification of TIMBRE_CONTROL_SPECS) paintTimbreControl(specification);
  for (const button of $("presetGrid").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetId === item.id));
  }
  audio.clearBufferCache();
  paintReadouts();
  if (options.audition !== false && state.audioOn) {
    void plantCloud({ count: 8, announceCloud: false });
  }
}

function pushPulse(event, startedAt) {
  pulses.push({ ...event, startedAt });
  if (pulses.length > 180) pulses = pulses.slice(-180);
  scheduleFrame();
}

function scheduleAudioGrain(event, startedAt) {
  if (!state.audioOn || !audio.context) return;
  const secondsAhead = Math.max(0, (startedAt - performance.now()) / 1_000);
  const when = audio.context.currentTime + secondsAhead;
  void audio.scheduleGrain(event, synthSettings(), {
    when,
    density: state.hitDensity,
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

function finishTransport() {
  if (transportTimer) window.clearTimeout(transportTimer);
  transportTimer = 0;
  if (!state.playing) return;
  state.playing = false;
  paintReadouts();
  announce("Karplus Carpet completed " + state.hitCount + " synthesized micro-attacks.");
}

function scheduleTransport() {
  transportTimer = 0;
  if (!state.playing) return;
  const now = performance.now();
  nextHitAt = karplusCarpetResumeTime(nextHitAt, now);
  const horizon = now + KARPLUS_CARPET_LIMITS.scheduleAheadSeconds * 1_000;
  let finalStartedAt = null;
  while (state.playing && nextHitAt <= horizon) {
    const settings = carpetSettings();
    const event = karplusCarpetEvent(settings, hitIndex, {
      seed: passSeed,
      frequencies: pitchCells,
    });
    queueGrain(event, nextHitAt);
    finalStartedAt = nextHitAt;
    nextHitAt += karplusCarpetIntervalMs(settings, hitIndex, { seed: passSeed });
    hitIndex += 1;
    state.wovenHits = hitIndex;

    if (hitIndex >= settings.hitCount) {
      if (state.looping) {
        hitIndex = 0;
        state.wovenHits = 0;
        passSeed = (passSeed + 0x9e3779b9) >>> 0;
      } else {
        const wait = Math.max(0, (finalStartedAt ?? now) - performance.now()) + 24;
        transportTimer = window.setTimeout(finishTransport, wait);
        paintReadouts();
        return;
      }
    }
  }
  paintReadouts();
  transportTimer = window.setTimeout(scheduleTransport, 24);
}

function startTransport(options = {}) {
  if (state.playing) stopTransport({ silence: true, announceStop: false });
  state.playing = true;
  state.wovenHits = 0;
  hitIndex = 0;
  passSeed = Math.trunc(Number(options.seed) || Date.now()) >>> 0;
  nextHitAt = performance.now() + 8;
  paintReadouts();
  scheduleTransport();
  if (options.announceStart !== false) {
    announce(state.audioOn
      ? "Karplus Carpet started."
      : "Karplus Carpet started silently. Turn Audio on to hear it.");
  }
}

function stopTransport(options = {}) {
  if (transportTimer) window.clearTimeout(transportTimer);
  transportTimer = 0;
  const wasPlaying = state.playing;
  state.playing = false;
  state.wovenHits = 0;
  if (options.silence !== false) {
    audio.stopAll();
    pulses = pulses.filter(({ startedAt }) => startedAt <= performance.now());
  }
  paintReadouts();
  if (wasPlaying && options.announceStop !== false) announce("Karplus Carpet stopped.");
}

async function plantCloud(options = {}) {
  if (!state.audioOn && !(await enableAudio())) return;
  const count = clamp(
    Math.round(Number(options.count) || Math.max(8, state.hitDensity * 0.5)),
    KARPLUS_CARPET_LIMITS.minimumHitCount,
    Math.min(state.hitCount, 16),
  );
  const settings = carpetSettings({ hitCount: count });
  const seed = Math.trunc(Number(options.seed) || Date.now()) >>> 0;
  const events = buildKarplusCarpetEvents(settings, { seed });
  const startedAt = performance.now() + 8;
  for (const event of events) queueGrain(event, startedAt + event.atMs);
  if (options.announceCloud !== false) {
    announce(count + " synthesized Karplus micro-attacks planted.");
  }
}

function setStagePosition(centerPosition, pitchSpread = state.pitchSpread) {
  state.centerPosition = clamp(centerPosition, 0, 1);
  state.pitchSpread = clamp(pitchSpread, 0.04, 1);
  $("pitchSpread").value = String(state.pitchSpread);
  $("pitchSpreadOut").textContent = formatPercent(state.pitchSpread);
  paintReadouts();
}

function stagePoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    centerPosition: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
    pitchSpread: clamp(
      0.04 + (event.clientY - bounds.top) / Math.max(1, bounds.height) * 0.96,
      0.04,
      1,
    ),
  };
}

function emitPointerGrain() {
  const event = karplusCarpetEvent(carpetSettings(), Date.now() & 0xffff, {
    seed: Date.now(),
    frequencies: pitchCells,
  });
  queueGrain(event, performance.now() + 4);
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  canvas.focus();
  pointerActive = true;
  canvas.setPointerCapture?.(event.pointerId);
  const point = stagePoint(event);
  setStagePosition(point.centerPosition, point.pitchSpread);
  lastPointerGrainAt = performance.now();
  void plantCloud();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerActive) return;
  const point = stagePoint(event);
  setStagePosition(point.centerPosition, point.pitchSpread);
  const now = performance.now();
  if (now - lastPointerGrainAt < 55 || !state.audioOn) return;
  lastPointerGrainAt = now;
  emitPointerGrain();
});

function releasePointer(event) {
  pointerActive = false;
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* released */ }
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setStagePosition(state.centerPosition + direction / Math.max(1, pitchCells.length - 1));
    announce("Carpet center " + formatFrequency(displayedCenterFrequency()) + ".");
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    void plantCloud();
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
      if (id === "grainDuration") audio.clearBufferCache();
      paintReadouts();
    });
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
  $("loopCarpet").addEventListener("click", () => {
    state.looping = !state.looping;
    paintReadouts();
    announce("Carpet loop " + (state.looping ? "on." : "off."));
  });
}

$("carpetButton").addEventListener("click", () => {
  if (state.playing) stopTransport();
  else startTransport();
});

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Karplus Carpet audio off.");
  } else if (await enableAudio()) {
    announce("Karplus Carpet audio on.");
  }
});

$("resetAll").addEventListener("click", () => {
  stopTransport({ silence: true, announceStop: false });
  Object.assign(state, KARPLUS_CARPET_DEFAULTS);
  state.level = KARPLUS_STRONG_DEFAULTS.level;
  $("level").value = String(state.level);
  audio.setOutput(state.audioOn ? state.level : 0);
  state.looping = false;
  state.wovenHits = 0;
  pitchCells = karplusStrongStringFrequencies(state);
  pulses = [];
  syncCarpetControls();
  setPitchBend(0, { immediate: true });
  applyPreset(firstPreset, { audition: false });
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
  state.centerPosition = index / Math.max(1, pitchCells.length - 1);
  paintReadouts();
  void (async () => {
    if (!state.audioOn && !(await enableAudio())) return;
    startTransport({ seed: note * 65_537 + Date.now(), announceStart: false });
    announce("MIDI note centered a " + state.hitCount + " hit Karplus Carpet.");
  })();
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target?.matches?.("input, select, textarea, button, [role='slider']")) return;
  const index = KEY_BINDINGS.indexOf(event.key.toLowerCase());
  if (index < 0) return;
  event.preventDefault();
  setStagePosition(index / Math.max(1, KEY_BINDINGS.length - 1));
  void plantCloud({ count: 8 });
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

function drawPulse(pulse, timestamp, top, bottom, left, right) {
  if (timestamp < pulse.startedAt) return;
  const age = Math.max(0, (timestamp - pulse.startedAt) / 1_000);
  const life = clamp(1 - age / Math.max(0.08, pulse.duration + 0.34), 0, 1);
  if (life <= 0) return;
  const x = left + pulse.fieldPosition * (right - left);
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
  const top = Math.min(118, cssHeight * 0.22);
  const bottom = Math.max(top + 100, cssHeight - 68);
  const left = Math.min(48, cssWidth * 0.07);
  const right = Math.max(left + 120, cssWidth - 42);
  drawWovenGround(top, bottom, left, right, timestamp);

  const centerX = left + state.centerPosition * (right - left);
  const halfWidth = Math.max(7, state.pitchSpread * (right - left) * 0.5);
  const gradient = context.createLinearGradient(centerX - halfWidth, 0, centerX + halfWidth, 0);
  gradient.addColorStop(0, "rgba(231, 165, 93, 0)");
  gradient.addColorStop(0.5, "rgba(231, 165, 93, .055)");
  gradient.addColorStop(1, "rgba(231, 165, 93, 0)");
  context.fillStyle = gradient;
  context.fillRect(centerX - halfWidth, top, halfWidth * 2, bottom - top);

  pulses = pulses.filter(({ startedAt, duration }) => (
    timestamp - startedAt < duration * 1_000 + 420
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

  if (pulses.length || state.playing) scheduleFrame();
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
  if (transportTimer) window.clearTimeout(transportTimer);
  void audio.close();
});
