import {
  OUROBOROUSEL_DEFAULTS,
  OUROBOROUSEL_PHASE_SEED,
  OUROBOROUSEL_PRESETS,
  OuroborouselAudio,
  calculateOuroborouselLayers,
  sanitizeOuroborouselParams,
} from "./src/ourorourobouroboros.js";

const $ = (id) => document.getElementById(id);
const audio = new OuroborouselAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches ?? false;

const TAU = Math.PI * 2;
const START_ANGLE = -Math.PI * 0.5;
const DEFAULT_SAMPLE_RATE = 48_000;
const DRAW_INTERVAL = 1_000 / 30;
const REDUCED_DRAW_INTERVAL = 1_000 / 5;
const FLASH_LIFETIME = 0.72;
const MAX_FLASHES = 72;
const RAIL_END_POSITION = 1 - Number.EPSILON;
const BLUE = [86, 166, 255];
const ICE = [238, 247, 255];
const VIOLET = [139, 92, 246];

function clamp(value, minimum, maximum, fallback = minimum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function wrapUnit(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return ((numeric % 1) + 1) % 1;
}

function directionSign(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric < 0 ? -1 : 1;
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

function formatRate(value) {
  const rate = Math.max(0, Number(value) || 0);
  return `${compactNumber(rate, rate >= 100 ? 0 : rate >= 10 ? 1 : 2)} pulses/s`;
}

function createMemory(preset = OUROBOROUSEL_PRESETS[0] ?? OUROBOROUSEL_DEFAULTS) {
  const safe = sanitizeOuroborouselParams({
    ...OUROBOROUSEL_DEFAULTS,
    ...preset,
  });
  return {
    ...safe,
    direction: directionSign(safe.direction, OUROBOROUSEL_DEFAULTS.direction),
    presetId: preset?.id ?? null,
  };
}

const state = {
  parameters: createMemory(),
  audioOn: false,
  audioStarting: false,
  playing: false,
  visualPosition: 0.5,
  visualSeconds: 0,
};

let animationFrame = 0;
let lastAnimationTime = 0;
let lastAudioVisualTime = null;
let lastDrawTime = -Infinity;
let canvasWidth = 1;
let canvasHeight = 1;
let canvasScale = 1;
let visualizationDirty = true;
let disposed = false;
let audioStartPromise = null;
let audioStartGeneration = 0;
let activePointer = null;
let lastPointerPosition = null;
let lastPointerAuditionTime = -Infinity;
let flashes = [];

function currentParameters() {
  return sanitizeOuroborouselParams(state.parameters);
}

function currentFrame(position = state.visualPosition) {
  return calculateOuroborouselLayers({
    position,
    ...currentParameters(),
    sampleRate: audio.context?.sampleRate ?? DEFAULT_SAMPLE_RATE,
  });
}

function frameLayers(frame) {
  return Array.isArray(frame?.layers) ? frame.layers : [];
}

function layerMaterialWeight(layer, materialMode = "combo") {
  const noteWeight = Math.max(0, Number(layer?.weight ?? layer?.gain) || 0);
  const drumWeight = Math.max(0, Number(layer?.drumWeight) || 0);
  if (materialMode === "drums") return drumWeight;
  if (materialMode === "combo") return Math.max(noteWeight, drumWeight);
  return noteWeight;
}

function activeLayers(frame) {
  const materialMode = frame?.materialMode ?? "combo";
  return frameLayers(frame).filter((layer) => (
    layerMaterialWeight(layer, materialMode) > 1e-7
  ));
}

function selectedPreset() {
  return OUROBOROUSEL_PRESETS.find(({ id }) => (
    id === state.parameters.presetId
  )) ?? null;
}

function presetLabel(preset) {
  return preset?.label ?? preset?.name ?? preset?.id ?? "Preset";
}

function presetDetail(preset) {
  if (preset?.description) return preset.description;
  const safe = sanitizeOuroborouselParams({
    ...OUROBOROUSEL_DEFAULTS,
    ...preset,
  });
  return `${safe.direction > 0 ? "rising" : "falling"} · ${formatRate(safe.centerRate)}`;
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
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function renderPresetGrid() {
  const grid = $("presetGrid");
  grid.replaceChildren();
  for (const preset of OUROBOROUSEL_PRESETS) {
    const button = document.createElement("button");
    const label = document.createElement("b");
    const detail = document.createElement("small");
    button.type = "button";
    button.dataset.preset = preset.id;
    setPressed(button, preset.id === state.parameters.presetId);
    label.textContent = presetLabel(preset);
    detail.textContent = presetDetail(preset);
    button.append(label, detail);
    grid.append(button);
  }
}

function updateAudioParameters() {
  audio.setParameters(currentParameters());
}

function centralLayer(frame) {
  const layers = activeLayers(frame);
  if (!layers.length) return null;
  return layers.reduce((nearest, layer) => (
    Math.abs(Number(layer.octaveOffset) || 0)
      < Math.abs(Number(nearest.octaveOffset) || 0)
      ? layer
      : nearest
  ));
}

function fusionLabel(blend) {
  const amount = clamp(blend, 0, 1, 0);
  if (amount < 0.12) return "slow rhythm";
  if (amount > 0.88) return "continuous pitch";
  return "rhythm and pitch overlap";
}

function layerFusionAmount(layer, materialMode = "combo") {
  const note = clamp(layer?.toneGain ?? layer?.fusionBlend, 0, 1, 0);
  const drum = clamp(layer?.drumToneGain, 0, 1, 0);
  if (materialMode === "drums") return drum;
  if (materialMode === "combo") return Math.max(note, drum);
  return note;
}

function materialSourceCopy(layer, safe) {
  const hitRate = Math.max(0.0001, Number(layer?.hitRate ?? layer?.rate) || safe.centerRate);
  const noteHz = Math.max(
    0,
    Number(layer?.sourceHz ?? layer?.fundamentalHz) || hitRate * 2 ** safe.noteLift,
  );
  const directPitchHz = Math.max(
    0,
    Number(layer?.pitchHz) || hitRate,
  );
  const drumBodyHz = Math.max(
    0,
    Number(layer?.drumFundamentalHz) || 110 * 2 ** (Number(layer?.octaveOffset) || 0),
  );
  const drumToneAmount = clamp(layer?.drumToneGain, 0, 1, 0);
  const drumHz = drumToneAmount > 0.12
    ? Math.max(0, Number(layer?.drumFusionHz) || drumBodyHz)
    : drumBodyHz;
  const drumSourceName = drumToneAmount > 0.12
    ? "phase-locked Ouroboros drum pitch"
    : "Ouroboros drum body";
  if (safe.materialMode === "drums") {
    return {
      compact: formatFrequency(drumHz),
      aria: `${formatFrequency(drumHz)} ${drumSourceName}`,
    };
  }
  if (safe.materialMode === "combo") {
    return {
      compact: drumToneAmount > 0.12
        ? `${formatFrequency(directPitchHz)} direct pitch`
        : `${formatFrequency(noteHz)} + ${formatFrequency(drumHz)}`,
      aria: drumToneAmount > 0.12
        ? `${formatFrequency(directPitchHz)} direct-rate layered pitch`
        : `${formatFrequency(noteHz)} note bite plus ${formatFrequency(drumHz)} ${drumSourceName}`,
    };
  }
  return {
    compact: clamp(layer?.toneGain, 0, 1, 0) > 0.12
      ? formatFrequency(directPitchHz)
      : formatFrequency(noteHz),
    aria: clamp(layer?.toneGain, 0, 1, 0) > 0.12
      ? `${formatFrequency(directPitchHz)} direct-rate note-colored pitch`
      : `${formatFrequency(noteHz)} rhythmic note source`,
  };
}

function materialCopy(mode) {
  if (mode === "drums") {
    return {
      short: "drum-colored",
      aria: "drum-colored rhythm-to-pitch spectrum",
      sourceTitle: "Slow rhythm",
      chunkTitle: "Fusion overlap",
    };
  }
  if (mode === "combo") {
    return {
      short: "layered",
      aria: "layered rhythm-to-pitch spectrum",
      sourceTitle: "Slow rhythm",
      chunkTitle: "Fusion overlap",
    };
  }
  return {
    short: "note-colored",
    aria: "note-colored rhythm-to-pitch spectrum",
    sourceTitle: "Slow rhythm",
    chunkTitle: "Fusion overlap",
  };
}

function updateCanvasAccessibility(frame, safe) {
  const center = centralLayer(frame);
  const blend = layerFusionAmount(center, safe.materialMode);
  const positionPercent = Math.round(wrapUnit(state.visualPosition) * 100);
  const rate = Number(center?.hitRate) || safe.centerRate;
  const source = materialSourceCopy(center, safe);
  const material = materialCopy(safe.materialMode);
  const layers = activeLayers(frame).sort((left, right) => (
    (Number(left?.hitRate) || 0) - (Number(right?.hitRate) || 0)
  ));
  const slowest = Number(layers[0]?.hitRate) || rate;
  const highest = Number(layers.at(-1)?.pitchHz ?? layers.at(-1)?.hitRate) || rate;
  canvas.setAttribute("aria-valuenow", String(positionPercent));
  canvas.setAttribute(
    "aria-valuetext",
    `${positionPercent}% around the endless cycle · center lane ${formatRate(rate)} · ${material.aria} · ${source.aria} · ${fusionLabel(blend)} · whole bank ${formatRate(slowest)} to ${formatFrequency(highest)}`,
  );
  canvas.setAttribute(
    "aria-label",
    `Circular Ourorourobouroboros rail with ${layers.length} simultaneous octave lanes using ${material.aria}; slow rhythms overlap direct-rate pitch near ${formatFrequency(safe.fusionPoint)} and continue to ${formatFrequency(highest)}`,
  );
}

function updateInterface({ rebuildPresets = false } = {}) {
  const safe = currentParameters();
  const frame = currentFrame();
  const rising = safe.direction > 0;
  const cyclesPerChunk = 2 ** safe.noteLift;
  const material = materialCopy(safe.materialMode);
  const drumsOnly = safe.materialMode === "drums";

  $("directionRise").checked = rising;
  $("directionFall").checked = !rising;
  $("materialNotes").checked = safe.materialMode === "notes";
  $("materialDrums").checked = safe.materialMode === "drums";
  $("materialCombo").checked = safe.materialMode === "combo";
  for (const id of [
    "chunkDuty",
    "brightness",
  ]) {
    $(id).disabled = drumsOnly;
  }
  setPressed($("audioButton"), state.audioOn);
  setPressed($("transportButton"), state.playing);
  $("audioButton").disabled = state.audioStarting;
  $("transportButton").disabled = state.audioStarting;
  $("audioButton").dataset.audioState = state.audioStarting
    ? "starting"
    : state.audioOn ? "on" : "off";
  $("audioButton").setAttribute(
    "aria-label",
    state.audioOn ? "Turn Ourorourobouroboros audio off" : "Turn Ourorourobouroboros audio on",
  );
  $("audioAction").textContent = "Audio";
  // The masthead status intentionally remains binary, including while audio starts.
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("transportIcon").textContent = state.audioStarting ? "…" : state.playing ? "Ⅱ" : "▶";
  $("transportLabel").textContent = state.audioStarting
    ? "Starting"
    : state.playing ? "Pause" : "Play";
  $("transportButton").setAttribute(
    "aria-label",
    state.playing
      ? "Pause automatic Ourorourobouroboros motion"
      : "Play automatic Ourorourobouroboros motion",
  );

  for (const id of [
    "glissRate",
    "centerRate",
    "bankWidth",
    "noteLift",
    "chunkDuty",
    "fusionPoint",
    "fusionWidth",
    "fusionEmphasis",
    "nestedSilence",
    "audioMix",
    "spread",
    "brightness",
    "cutoff",
    "level",
  ]) {
    $(id).value = String(safe[id]);
  }

  $("glissRateOut").textContent = `${safe.glissRate.toFixed(2)} oct/s`;
  $("centerRateOut").textContent = formatRate(safe.centerRate);
  const ringCount = Math.round(safe.bankWidth);
  const nestedRhythmRate = safe.fusionPoint / cyclesPerChunk;
  $("bankWidthOut").textContent = `${ringCount} rings`;
  $("bankWidth").setAttribute("aria-valuetext", `${ringCount} Shepard rings`);
  $("bankWidthDown").disabled = ringCount <= Number($("bankWidth").min);
  $("bankWidthUp").disabled = ringCount >= Number($("bankWidth").max);
  $("noteLiftOut").textContent = `${safe.noteLift} oct · ${formatRate(nestedRhythmRate)} at ${formatFrequency(safe.fusionPoint)}`;
  $("noteLift").setAttribute(
    "aria-valuetext",
    `${safe.noteLift}-octave note lift and nested distance; ${formatRate(nestedRhythmRate)} interruptions below the ${formatFrequency(safe.fusionPoint)} pitch threshold`,
  );
  $("chunkDutyOut").textContent = `${Math.round(safe.chunkDuty * 100)}% of each turn`;
  $("fusionPointOut").textContent = `${formatFrequency(safe.fusionPoint)} · ${Math.round(safe.fusionPoint * 60)} BPM`;
  $("fusionWidthOut").textContent = `${safe.fusionWidth.toFixed(2)} oct above`;
  $("fusionWidth").setAttribute(
    "aria-valuetext",
    `rhythm continues ${safe.fusionWidth.toFixed(2)} octaves above the ${formatFrequency(safe.fusionPoint)} fusion center`,
  );
  const fusionEmphasisPercent = Math.round(safe.fusionEmphasis * 100);
  $("fusionEmphasisOut").textContent = `${fusionEmphasisPercent}%`;
  $("fusionEmphasis").setAttribute(
    "aria-valuetext",
    `${fusionEmphasisPercent}% fusion focus`,
  );
  const nestedSilencePercent = Math.round(safe.nestedSilence * 100);
  $("nestedSilenceOut").textContent = `${nestedSilencePercent}%`;
  $("nestedSilence").setAttribute(
    "aria-valuetext",
    `${nestedSilencePercent}% nested silence depth`,
  );
  const shepardPercent = Math.round(safe.audioMix * 100);
  const rhythmPercent = 100 - shepardPercent;
  const audioMixLabel = shepardPercent === 0
    ? "Rhythm only"
    : shepardPercent === 100
      ? "Shepard only"
      : shepardPercent === 50
        ? "Balanced"
        : `${shepardPercent}% Shepard`;
  $("audioMixOut").textContent = audioMixLabel;
  $("audioMix").setAttribute(
    "aria-valuetext",
    `${rhythmPercent}% rhythmic sound, ${shepardPercent}% sustained Shepard sound`,
  );
  $("spreadOut").textContent = `${Math.round(safe.spread * 100)}%`;
  $("brightnessOut").textContent = `${Math.round(safe.brightness * 100)}%`;
  $("cutoffOut").textContent = formatFrequency(safe.cutoff);
  $("levelOut").textContent = `${Math.round(safe.level * 100)}%`;

  $("playSummary").textContent = `${state.playing ? "playing" : "ready"} · ${material.short} · ${rising ? "rising" : "falling"} · ${formatRate(safe.centerRate)}`;
  $("materialModeHelp").textContent = drumsOnly
    ? "Drum attacks stay in front while their phase-locked bodies merge into the interrupted pitch rail. Note shape and brightness stay parked."
    : safe.materialMode === "combo"
      ? "Drums remain in front while one recursive pitch rail continues behind them and develops slower, phase-locked holes."
      : "One note-colored rail moves from separated pulses into high pitch, then slower phase-locked holes reveal the next rhythm.";
  $("recursionSectionTitle").textContent = "Shepard spread";
  $("recursionSummary").textContent = `${ringCount} rings · ${safe.noteLift}-oct nested rhythm`;
  $("recursionNote").textContent = drumsOnly
    ? `The authentic drum attacks remain audible. Above ${formatFrequency(safe.fusionPoint)}, a slower lane ${safe.noteLift} octaves below cuts smooth holes into the drum-colored pitch behind them.`
    : safe.materialMode === "combo"
      ? `Drum strikes remain audible while the high Shepard rail is interrupted at ${formatRate(nestedRhythmRate)} near the threshold. The next rhythm appears as silence inside the pitch.`
      : `The high Shepard rail is interrupted at ${formatRate(nestedRhythmRate)} near the threshold. The same spectrum becomes rhythmic through silence instead of being replaced by another sound.`;
  $("notesSummary").textContent = drumsOnly
    ? "parked · choose Notes or Layered"
    : `${Math.round(safe.chunkDuty * 100)}% chunks · ${Math.round(safe.brightness * 100)}% brightness`;
  $("notesSectionNote").textContent = drumsOnly
    ? "Note chunk length and brightness are parked in Drums mode. Choose Notes or Layered to hear and edit them."
    : "These shape the note-colored pulse edges and sustained rail; the shared rings and nested rhythm stay phase-locked around them.";
  const fusionPulseSummary = safe.fusionEmphasis > 0.001
    ? ` · ${fusionEmphasisPercent}% focus`
    : "";
  $("fusionSectionTitle").textContent = "Nested rhythm";
  $("fusionSummary").textContent = `${formatFrequency(safe.fusionPoint)} pitch → ${formatRate(nestedRhythmRate)} holes · ${nestedSilencePercent}% depth${fusionPulseSummary}`;
  const tonalBrightness = drumsOnly
    ? (safe.cutoff - 800) / (18_000 - 800)
    : safe.brightness;
  $("soundSummary").textContent = `${audioMixLabel.toLowerCase()} · ${safe.spread > 0.55 ? "wide" : safe.spread > 0.2 ? "open" : "centered"} · ${tonalBrightness > 0.66 ? "bright" : tonalBrightness > 0.33 ? "balanced" : "soft"}`;
  $("brightnessLabel").textContent = drumsOnly ? "Note brightness (parked)" : "Note brightness";
  $("signalSourceLabel").textContent = "Slow rhythm";
  $("signalChunkLabel").textContent = "Fuses into pitch";
  $("signalSourceDetail").textContent = safe.materialMode === "drums"
    ? "authentic drum attacks"
    : safe.materialMode === "combo"
      ? "drums + note pulses"
      : "separated note pulses";
  $("signalChunkDetail").textContent = `${formatFrequency(safe.fusionPoint)} threshold`;
  $("signalFusionLabel").textContent = "High pitch with slow holes";
  $("signalFusionDetail").textContent = `${formatRate(nestedRhythmRate)} · ${nestedSilencePercent}% depth`;
  const preset = selectedPreset();
  $("presetSummary").textContent = preset ? presetLabel(preset) : "Custom";
  if (rebuildPresets) renderPresetGrid();
  else {
    for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
      setPressed(button, button.dataset.preset === state.parameters.presetId);
    }
  }

  updateCanvasAccessibility(frame, safe);
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
  const preset = OUROBOROUSEL_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  synchronizeVisualClock();
  state.parameters = createMemory(preset);
  updateInterface({ rebuildPresets: true });
  announce(`${presetLabel(preset)} preset loaded.`);
}

function bindRange(id, transform = (value) => value) {
  $(id).addEventListener("input", (event) => {
    synchronizeVisualClock();
    state.parameters[id] = transform(Number(event.currentTarget.value));
    markCustom();
    updateInterface();
  });
}

$("presetGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (button) applyPreset(button.dataset.preset);
});

$("direction").addEventListener("change", (event) => {
  const input = event.target.closest('input[name="sweepDirection"]');
  if (!input) return;
  synchronizeVisualClock();
  state.parameters.direction = Number(input.value) < 0 ? -1 : 1;
  markCustom();
  updateInterface();
  announce(`Ourorourobouroboros now ${state.parameters.direction > 0 ? "rises" : "falls"} forever.`);
});

$("materialMode").addEventListener("change", (event) => {
  const input = event.target.closest('input[name="soundMaterial"]');
  if (!input) return;
  synchronizeVisualClock();
  state.parameters.materialMode = input.value;
  markCustom();
  updateInterface();
  announce(`Ourorourobouroboros sound source changed to ${materialCopy(input.value).aria}.`);
});

for (const id of [
  "glissRate",
  "centerRate",
  "bankWidth",
  "chunkDuty",
  "fusionPoint",
  "fusionWidth",
  "fusionEmphasis",
  "nestedSilence",
  "audioMix",
  "spread",
  "brightness",
  "cutoff",
  "level",
]) bindRange(id);
bindRange("noteLift", Math.round);

function stepRingCount(delta) {
  const input = $("bankWidth");
  const next = clamp(
    Math.round(Number(input.value) + delta),
    Number(input.min),
    Number(input.max),
    OUROBOROUSEL_DEFAULTS.bankWidth,
  );
  if (next === Number(input.value)) return;
  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  announce(`${next} Shepard rings.`);
}

$("bankWidthDown").addEventListener("click", () => stepRingCount(-1));
$("bankWidthUp").addEventListener("click", () => stepRingCount(1));

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
      announce("Ourorourobouroboros audio ready. The carousel remains paused for manual playing.");
      return true;
    } catch (error) {
      state.audioOn = false;
      state.playing = false;
      showAudioError(error);
      announce("Ourorourobouroboros audio could not start.");
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
    announce("Ourorourobouroboros audio off.");
    return;
  }
  await startAudio();
}

async function startTransport() {
  if (state.playing || state.audioStarting) return false;
  if (!await startAudio()) return false;
  state.playing = audio.setTransport(true);
  if (!state.playing) return false;
  lastAnimationTime = performance.now();
  lastAudioVisualTime = Number.isFinite(audio.context?.currentTime)
    ? audio.context.currentTime
    : null;
  updateInterface();
  scheduleAnimation();
  announce(`Ourorourobouroboros playing ${currentParameters().direction > 0 ? "up" : "down"}.`);
  return true;
}

function stopTransport({ announceStop = true } = {}) {
  if (!state.playing) return false;
  synchronizeVisualClock();
  audio.stopTransport();
  state.playing = false;
  updateInterface();
  if (announceStop) {
    announce("Automatic motion paused. Manual material audition remains ready.");
  }
  return true;
}

function toggleTransport() {
  if (state.playing) stopTransport();
  else void startTransport();
}

$("audioButton").addEventListener("click", toggleAudio);
$("transportButton").addEventListener("click", toggleTransport);

function addFlash(position, velocity = 0.8) {
  flashes.push({
    position: wrapUnit(position),
    velocity: clamp(velocity, 0, 1, 0.8),
    age: 0,
  });
  if (flashes.length > MAX_FLASHES) {
    flashes.splice(0, flashes.length - MAX_FLASHES);
  }
  visualizationDirty = true;
}

function setRailPosition(position) {
  const normalized = wrapUnit(position);
  state.visualPosition = normalized;
  if (state.audioOn) audio.setPosition(normalized);
  updateCanvasAccessibility(currentFrame(normalized), currentParameters());
  visualizationDirty = true;
  scheduleAnimation();
  return normalized;
}

async function auditionPosition(position, velocity = 0.82) {
  const normalized = setRailPosition(position);
  if (!await startAudio()) return false;
  audio.setPosition(normalized);
  // Moving the playhead transposes the octave bank. The manual strike itself
  // stays unpositioned so every active band sounds together under the mouse.
  const struck = audio.strike(velocity);
  if (struck === false) return false;
  addFlash(normalized, velocity);
  scheduleAnimation();
  const safe = currentParameters();
  const material = materialCopy(safe.materialMode);
  const lanes = activeLayers(currentFrame(normalized)).sort((left, right) => (
    (Number(left?.hitRate) || 0) - (Number(right?.hitRate) || 0)
  ));
  const slowest = Number(lanes[0]?.hitRate) || safe.centerRate;
  const highest = Number(lanes.at(-1)?.pitchHz ?? lanes.at(-1)?.hitRate)
    || safe.centerRate;
  announce(
    `Grabbed all ${lanes.length} ${material.aria} lanes at ${Math.round(normalized * 100)}%: ${formatRate(slowest)} through ${formatFrequency(highest)}.`,
  );
  return true;
}

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  stopTransport({ announceStop: false });
  state.parameters = createMemory();
  state.visualPosition = 0.5;
  state.visualSeconds = 0;
  flashes = [];
  audio.setPosition(state.visualPosition);
  clearAudioError();
  updateInterface({ rebuildPresets: true });
  announce("Ourorourobouroboros parameters reset.");
});

function geometry(width, height) {
  const minimum = Math.max(1, Math.min(width, height));
  const compact = minimum < 500 || width < 620;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  // Reserve enough room for the snake's head, playhead, audition rings, and
  // their antialiasing so the carousel reads wholly inside the stage border.
  const edgePadding = clamp(minimum * 0.12, 42, 54, 48);
  const outerRadius = Math.max(64, minimum * 0.5 - edgePadding);
  const snakeWidth = clamp(outerRadius * 0.14, 20, compact ? 34 : 46);
  const railOuter = outerRadius - snakeWidth * 0.88;
  const railInner = Math.max(54, outerRadius * (compact ? 0.32 : 0.29));
  return {
    centerX,
    centerY,
    outerRadius,
    snakeWidth,
    railOuter,
    railInner,
  };
}

function pointOnCircle(position, radius, layout) {
  const angle = START_ANGLE + wrapUnit(position) * TAU;
  return {
    x: layout.centerX + Math.cos(angle) * radius,
    y: layout.centerY + Math.sin(angle) * radius,
    angle,
  };
}

function positionFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const layout = geometry(
    Math.max(1, bounds.width),
    Math.max(1, bounds.height),
  );
  const x = clamp(event.clientX - bounds.left, 0, Math.max(1, bounds.width));
  const y = clamp(event.clientY - bounds.top, 0, Math.max(1, bounds.height));
  const angle = Math.atan2(y - layout.centerY, x - layout.centerX);
  return wrapUnit((angle - START_ANGLE) / TAU);
}

function pointerHitsCarousel(event) {
  const bounds = canvas.getBoundingClientRect();
  const layout = geometry(
    Math.max(1, bounds.width),
    Math.max(1, bounds.height),
  );
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const distance = Math.hypot(x - layout.centerX, y - layout.centerY);
  return distance >= layout.railInner - 18
    && distance <= layout.outerRadius + layout.snakeWidth * 0.65;
}

function circularDistance(first, second) {
  const direct = Math.abs(wrapUnit(first) - wrapUnit(second));
  return Math.min(direct, 1 - direct);
}

function releasePointer(event) {
  if (activePointer === null || event.pointerId !== activePointer) return;
  try {
    canvas.releasePointerCapture?.(event.pointerId);
  } catch {
    // Browsers may release capture before a cancellation reaches the page.
  }
  activePointer = null;
  lastPointerPosition = null;
  $("stageWrap").classList.remove("is-auditioning");
  visualizationDirty = true;
  scheduleAnimation();
}

function cancelPointerInteraction() {
  activePointer = null;
  lastPointerPosition = null;
  $("stageWrap").classList.remove("is-auditioning");
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || !pointerHitsCarousel(event)) return;
  event.preventDefault();
  canvas.focus?.();
  stopTransport({ announceStop: false });
  activePointer = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);
  $("stageWrap").classList.add("is-auditioning");
  const position = positionFromPointer(event);
  lastPointerPosition = position;
  lastPointerAuditionTime = performance.now();
  void auditionPosition(position, 0.84);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointer) return;
  event.preventDefault();
  const position = positionFromPointer(event);
  const movement = circularDistance(position, lastPointerPosition ?? position);
  setRailPosition(position);
  const now = performance.now();
  if (movement >= 0.009 && now - lastPointerAuditionTime >= 38) {
    const pressure = Number.isFinite(event.pressure) ? event.pressure : 0.5;
    const velocity = clamp(0.56 + movement * 3.8 + pressure * 0.17, 0.56, 0.96);
    lastPointerPosition = position;
    lastPointerAuditionTime = now;
    void auditionPosition(position, velocity);
  }
});

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    stopTransport({ announceStop: false });
    const step = event.shiftKey ? 0.05 : 0.01;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    void auditionPosition(state.visualPosition + direction * step, 0.72);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    stopTransport({ announceStop: false });
    void auditionPosition(
      event.key === "Home" ? 0 : RAIL_END_POSITION,
      0.72,
    );
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    state.parameters.direction = event.key === "ArrowUp" ? 1 : -1;
    markCustom();
    updateInterface();
    announce(`Ourorourobouroboros now ${state.parameters.direction > 0 ? "rises" : "falls"} forever.`);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) void auditionPosition(state.visualPosition, 0.9);
  } else if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    if (!event.repeat) toggleTransport();
  }
});

function handleMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (routeId !== "ourorourobouroboros" || message?.type !== "noteOn") return;
  event.preventDefault();
  stopTransport({ announceStop: false });
  const note = clamp(Math.round(Number(message.note) || 60), 0, 127, 60);
  const position = clamp(
    (note - 24) / 84,
    0,
    RAIL_END_POSITION,
    0.5,
  );
  const velocity = clamp((Number(message.velocity) || 100) / 127, 0.05, 1, 0.8);
  void auditionPosition(position, velocity);
}

globalThis.addEventListener?.("morphazoid:midi-input", handleMidiInput);

function rgba(channels, alpha) {
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${clamp(alpha, 0, 1, 1)})`;
}

function mixColor(first, second, amount, alpha = 1) {
  const mix = clamp(amount, 0, 1, 0);
  const channels = first.map((channel, index) => Math.round(
    channel + (second[index] - channel) * mix,
  ));
  return rgba(channels, alpha);
}

function drawBackdrop(ctx, layout) {
  ctx.save();
  const spokeCount = 24;
  for (let index = 0; index < spokeCount; index += 1) {
    const position = index / spokeCount;
    const inner = pointOnCircle(position, layout.railInner * 0.88, layout);
    const outer = pointOnCircle(position, layout.outerRadius, layout);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = index % 2 === 0
      ? "rgba(139, 92, 246, 0.1)"
      : "rgba(238, 247, 255, 0.055)";
    ctx.lineWidth = index % 6 === 0 ? 1.2 : 0.65;
    ctx.stroke();
  }

  for (const radius of [layout.railInner, layout.railOuter]) {
    ctx.beginPath();
    ctx.arc(layout.centerX, layout.centerY, radius, 0, TAU);
    ctx.strokeStyle = "rgba(86, 166, 255, 0.11)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function traceCoiledSnake(ctx, layout, radius) {
  const coilTurns = 3.15;
  const pathSteps = 240;
  const innerRadius = 3;
  ctx.beginPath();
  for (let step = 0; step <= pathSteps; step += 1) {
    const amount = step / pathSteps;
    const distance = innerRadius + (radius - innerRadius) * amount;
    const angle = START_ANGLE + amount * coilTurns * TAU;
    const x = layout.centerX + Math.cos(angle) * distance;
    const y = layout.centerY + Math.sin(angle) * distance;
    if (step === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawCoiledCandySnake(ctx, layout) {
  const radius = Math.max(42, layout.railInner * 0.86);
  const snakeWidth = clamp(radius * 0.18, 8, 12, 10);
  const stripeLength = snakeWidth * 0.82;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(BLUE, 0.48);
  ctx.shadowBlur = 14;
  traceCoiledSnake(ctx, layout, radius);
  ctx.strokeStyle = "rgba(11, 6, 29, 0.98)";
  ctx.lineWidth = snakeWidth + 6;
  ctx.stroke();

  ctx.shadowBlur = 0;
  traceCoiledSnake(ctx, layout, radius);
  ctx.strokeStyle = rgba(ICE, 0.98);
  ctx.lineWidth = snakeWidth;
  ctx.stroke();

  ctx.lineCap = "butt";
  ctx.setLineDash([stripeLength, stripeLength]);
  traceCoiledSnake(ctx, layout, radius);
  ctx.strokeStyle = rgba(VIOLET, 0.98);
  ctx.lineWidth = snakeWidth;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCandyCaneRing(ctx, layout) {
  const radius = layout.outerRadius;
  const width = layout.snakeWidth;
  ctx.save();
  ctx.lineCap = "butt";

  ctx.beginPath();
  ctx.arc(layout.centerX, layout.centerY, radius, 0, TAU);
  ctx.strokeStyle = "rgba(11, 6, 29, 0.96)";
  ctx.lineWidth = width + 9;
  ctx.stroke();

  const requestedScaleCount = Math.max(38, Math.round(radius * 0.34));
  const scaleCount = requestedScaleCount + requestedScaleCount % 2;
  const gap = 0.018;
  for (let index = 0; index < scaleCount; index += 1) {
    const start = START_ANGLE + index / scaleCount * TAU + gap;
    const end = START_ANGLE + (index + 1) / scaleCount * TAU - gap;
    ctx.beginPath();
    ctx.arc(layout.centerX, layout.centerY, radius, start, end);
    ctx.strokeStyle = index % 2 === 0
      ? rgba(VIOLET, 0.94)
      : rgba(ICE, 0.9);
    ctx.lineWidth = width;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(layout.centerX, layout.centerY, radius, 0, TAU);
  ctx.strokeStyle = "rgba(86, 166, 255, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function layerVisual(layer, safe) {
  const hitRate = Math.max(0.0001, Number(layer?.hitRate ?? layer?.rate) || safe.centerRate);
  const weight = layerMaterialWeight(layer, safe.materialMode);
  const fusion = layerFusionAmount(layer, safe.materialMode);
  const rhythm = clamp(layer?.rhythmShare ?? layer?.chunkGain, 0, 1, 1);
  const nestedMix = clamp(layer?.nestedMix, 0, 1, 0);
  const nestedRate = Math.max(
    0.0001,
    Number(layer?.nestedRhythmHz ?? layer?.interruptionRate) || hitRate,
  );
  const nestedPhase = wrapUnit(
    (Number(layer?.nestedRhythmPhase ?? layer?.interruptionPhase) || 0)
      + state.visualSeconds * nestedRate,
  );
  const pulsePhase = wrapUnit(
    (Number(layer?.pulsePhase) || OUROBOROUSEL_PHASE_SEED)
      + state.visualSeconds * hitRate,
  );
  return {
    hitRate,
    weight,
    fusion,
    rhythm,
    pulsePhase,
    nestedMix,
    nestedRate,
    nestedPhase,
  };
}

function drawChunkLane(ctx, layout, radius, layer, safe, laneIndex, laneCount) {
  const visual = layerVisual(layer, safe);
  const normalizedWeight = clamp(visual.weight * 2.4, 0.12, 1, 0.12);
  const drumAmount = safe.materialMode === "drums"
    ? 1
    : safe.materialMode === "combo" ? 0.72 : 0;
  const drumHitAmount = drumAmount * Math.sqrt(visual.rhythm);
  const noteAmount = safe.materialMode === "drums" ? 0 : 1;
  const chunkAlpha = Math.sqrt(visual.rhythm)
    * normalizedWeight
    * noteAmount;
  const toneAlpha = Math.sin(visual.fusion * Math.PI * 0.5)
    * normalizedWeight
    * (0.78 + noteAmount * 0.22);
  const transitionAlpha = Math.sqrt(
    visual.fusion * visual.rhythm,
  ) * normalizedWeight;
  const logarithmicRate = Math.max(0, Math.log2(visual.hitRate + 1));
  const eventCount = Math.round(clamp(4 + logarithmicRate * 3.2, 4, 38, 4));
  const slot = TAU / eventCount;
  const phaseAngle = visual.pulsePhase * slot * safe.direction;
  const laneWidth = clamp(
    (layout.railOuter - layout.railInner) / Math.max(8, laneCount + 2),
    2.2,
    7.5,
  );

  if (toneAlpha > 0.008) {
    ctx.save();
    ctx.shadowColor = rgba(BLUE, transitionAlpha * 0.7);
    ctx.shadowBlur = 5 + transitionAlpha * 12;
    ctx.strokeStyle = mixColor(BLUE, ICE, visual.fusion, toneAlpha * 0.96);
    ctx.lineWidth = laneWidth * (0.72 + visual.fusion * 0.36);
    if (visual.nestedMix > 0.02) {
      const gapCount = Math.round(clamp(
        3 + Math.log2(visual.nestedRate + 1) * 2.6,
        3,
        18,
        3,
      ));
      const gapSlot = TAU / gapCount;
      const gapWidth = gapSlot * (0.06 + visual.nestedMix * 0.22);
      const gapPhase = visual.nestedPhase * gapSlot * safe.direction;
      ctx.lineCap = "round";
      for (let gap = 0; gap < gapCount; gap += 1) {
        const start = START_ANGLE + gapPhase + gap * gapSlot + gapWidth;
        const end = START_ANGLE + gapPhase + (gap + 1) * gapSlot;
        ctx.beginPath();
        ctx.arc(layout.centerX, layout.centerY, radius, start, end);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.arc(layout.centerX, layout.centerY, radius, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (chunkAlpha > 0.008) {
    const arcLength = slot * clamp(safe.chunkDuty, 0.15, 1, 0.42) * 0.86;
    ctx.save();
    ctx.lineCap = "round";
    for (let chunk = 0; chunk < eventCount; chunk += 1) {
      const start = START_ANGLE + phaseAngle + chunk * slot;
      const end = start + arcLength;
      ctx.beginPath();
      ctx.arc(layout.centerX, layout.centerY, radius, start, end);
      ctx.strokeStyle = chunk % 2 === laneIndex % 2
        ? rgba(VIOLET, chunkAlpha)
        : rgba(ICE, chunkAlpha * 0.94);
      ctx.lineWidth = laneWidth;
      ctx.stroke();
    }
    ctx.restore();
  }

  if (drumHitAmount > 0.01) {
    ctx.save();
    ctx.shadowColor = rgba(BLUE, normalizedWeight * drumHitAmount);
    ctx.shadowBlur = 4 + 6 * drumHitAmount;
    for (let strike = 0; strike < eventCount; strike += 1) {
      const angle = START_ANGLE + phaseAngle + strike * slot;
      const x = layout.centerX + Math.cos(angle) * radius;
      const y = layout.centerY + Math.sin(angle) * radius;
      const size = Math.max(1.5, laneWidth * (0.42 + drumHitAmount * 0.2));
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fillStyle = strike % 2 === laneIndex % 2
        ? rgba(BLUE, normalizedWeight * drumHitAmount * 0.94)
        : rgba(ICE, normalizedWeight * drumHitAmount * 0.76);
      ctx.fill();
    }
    ctx.restore();
  }

  if (transitionAlpha > 0.03) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(layout.centerX, layout.centerY, radius, 0, TAU);
    ctx.strokeStyle = rgba(BLUE, transitionAlpha * 0.72);
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  const pulsePoint = pointOnCircle(
    wrapUnit(visual.pulsePhase + state.visualPosition),
    radius,
    layout,
  );
  ctx.save();
  ctx.shadowColor = visual.fusion > 0.5 ? rgba(ICE, 0.9) : rgba(VIOLET, 0.95);
  ctx.shadowBlur = 7;
  ctx.fillStyle = visual.fusion > 0.5
    ? rgba(ICE, normalizedWeight * 0.88)
    : rgba(VIOLET, normalizedWeight * 0.92);
  ctx.beginPath();
  ctx.arc(pulsePoint.x, pulsePoint.y, 1.4 + normalizedWeight * 1.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawFusionBand(ctx, layout, layers, safe, radii) {
  if (!layers.length) return;
  const overlapPoint = safe.fusionPoint;
  let closestIndex = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < layers.length; index += 1) {
    const rate = Math.max(0.0001, Number(layers[index]?.hitRate) || 0.0001);
    const distance = Math.abs(Math.log2(rate / overlapPoint));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  const emphasis = clamp(safe.fusionEmphasis, 0, 1, 0);
  const baseWidth = Math.max(
    5,
    (layout.railOuter - layout.railInner) / Math.max(7, layers.length),
  );
  ctx.save();
  ctx.shadowColor = rgba(BLUE, 0.72);
  ctx.shadowBlur = 10 + emphasis * 16;
  for (let index = 0; index < layers.length; index += 1) {
    const pitch = clamp(
      layers[index]?.pitchBlend ?? layers[index]?.toneGain,
      0,
      1,
      0,
    );
    const rhythm = clamp(
      layers[index]?.rhythmShare ?? layers[index]?.chunkGain,
      0,
      1,
      0,
    );
    const overlap = Math.sqrt(pitch * rhythm);
    if (overlap < 0.025) continue;
    ctx.beginPath();
    ctx.arc(layout.centerX, layout.centerY, radii[index], 0, TAU);
    ctx.strokeStyle = rgba(BLUE, overlap * (0.2 + emphasis * 0.2));
    ctx.lineWidth = baseWidth * (0.7 + overlap * (1.6 + emphasis * 0.55));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(layout.centerX, layout.centerY, radii[closestIndex], 0, TAU);
  ctx.strokeStyle = rgba(BLUE, 0.8 + emphasis * 0.16);
  ctx.lineWidth = 1 + emphasis * 0.75;
  ctx.setLineDash([1.5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawPlayhead(ctx, layout, safe) {
  const inner = pointOnCircle(state.visualPosition, layout.railInner - 7, layout);
  const outer = pointOnCircle(state.visualPosition, layout.outerRadius + layout.snakeWidth * 0.6, layout);
  const angle = outer.angle;
  const tangentX = -Math.sin(angle) * safe.direction;
  const tangentY = Math.cos(angle) * safe.direction;
  ctx.save();
  ctx.shadowColor = rgba(BLUE, 0.9);
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  ctx.lineTo(outer.x, outer.y);
  ctx.strokeStyle = rgba(BLUE, 0.88);
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = rgba(ICE, 0.98);
  ctx.beginPath();
  ctx.moveTo(outer.x + tangentX * 8, outer.y + tangentY * 8);
  ctx.lineTo(outer.x - tangentX * 4 + Math.cos(angle) * 5, outer.y - tangentY * 4 + Math.sin(angle) * 5);
  ctx.lineTo(outer.x - tangentX * 4 - Math.cos(angle) * 5, outer.y - tangentY * 4 - Math.sin(angle) * 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlashes(ctx, layout) {
  for (const flash of flashes) {
    const life = clamp(1 - flash.age / FLASH_LIFETIME, 0, 1, 0);
    const point = pointOnCircle(flash.position, layout.outerRadius, layout);
    ctx.save();
    ctx.shadowColor = rgba(BLUE, life);
    ctx.shadowBlur = 8 + flash.velocity * 16;
    ctx.strokeStyle = rgba(ICE, life * life);
    ctx.lineWidth = 1.2 + flash.velocity * 2.4;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3 + (1 - life) * 13, 0, TAU);
    ctx.stroke();
    ctx.restore();
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
  const frame = currentFrame();
  const layers = activeLayers(frame).sort((first, second) => (
    (Number(first.hitRate) || 0) - (Number(second.hitRate) || 0)
  ));
  const layout = geometry(canvasWidth, canvasHeight);
  const radii = layers.map((_, index) => {
    const amount = layers.length <= 1 ? 0.5 : index / (layers.length - 1);
    // Slow, separate chunks orbit outside; faster fused pitch coils inward.
    return layout.railOuter + (layout.railInner - layout.railOuter) * amount;
  });

  drawBackdrop(context2d, layout);
  drawCoiledCandySnake(context2d, layout);
  for (let index = 0; index < layers.length; index += 1) {
    drawChunkLane(
      context2d,
      layout,
      radii[index],
      layers[index],
      safe,
      index,
      layers.length,
    );
  }
  drawFusionBand(context2d, layout, layers, safe, radii);
  drawCandyCaneRing(context2d, layout);
  drawFlashes(context2d, layout);
  drawPlayhead(context2d, layout, safe);
}

function ageFlashes(elapsed) {
  for (const flash of flashes) flash.age += elapsed;
  flashes = flashes.filter(({ age }) => age <= FLASH_LIFETIME);
}

function advanceVisualState(elapsed) {
  if (!(elapsed > 0)) return;
  ageFlashes(elapsed);
  state.visualSeconds += elapsed;
  if (!state.playing) return;
  const safe = currentParameters();
  state.visualPosition = wrapUnit(
    state.visualPosition + safe.direction * safe.glissRate * elapsed,
  );
  updateCanvasAccessibility(currentFrame(), safe);
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
  if (state.playing || flashes.length > 0) {
    advanceVisualState(elapsed);
    visualizationDirty = true;
  }
  draw(timestamp);
  if (state.playing || flashes.length > 0 || activePointer !== null) {
    animationFrame = requestAnimationFrame(animate);
  }
}

function scheduleAnimation() {
  if (disposed || document.hidden || animationFrame) return;
  animationFrame = requestAnimationFrame(animate);
}

function resizeCanvas() {
  if (disposed) return;
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvasWidth = Math.max(1, bounds.width);
  canvasHeight = Math.max(1, bounds.height);
  canvasScale = dpr;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  visualizationDirty = true;
  draw(performance.now(), true);
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
  if (state.playing || flashes.length > 0) scheduleAnimation();
}

function handlePageHide(event) {
  audioStartGeneration += 1;
  cancelPointerInteraction();
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
updateInterface();
resizeCanvas();
