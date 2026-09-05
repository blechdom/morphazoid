import { connectAudioOutput } from "./src/audio-output-manager.js?v=8c29d9375e9d";
import {
  PHYSICAL_SOUND_LIMITS,
  buildPhysicalModalBank,
  physicalSoundDefinition,
  physicalSoundPreset,
  sanitizePhysicalSoundState,
  serializePhysicalModalJson,
  tuneAirflowStateToFrequency,
} from "./src/physical-sounds.js?v=26242d8891c6";
import {
  DENTAPHONE_BRUSH_ROUTE,
  DENTAPHONE_DEFAULT_PITCH_STATE,
  DENTAPHONE_TEETH,
  buildDentaphonePitchMap,
  dentaphonePitchRange,
  dentaphoneToothLabel,
  sanitizeDentaphonePitchState,
} from "./src/dentaphone.js?v=482770e9db32";

const root = document.getElementById("physicalSoundRoot");
const canvas = document.getElementById("stage");
const kind = document.body.dataset.physicalSound;
const physicalInterface = document.body.dataset.physicalInterface ?? kind;
const isDentaphone = physicalInterface === "dentaphone";
if (!root || !canvas || !kind) throw new Error("Physical-sounds page contract is incomplete.");

const definition = physicalSoundDefinition(kind);
const $ = (id) => document.getElementById(id);
const clamp = (value, minimum = 0, maximum = 1) => Math.min(
  maximum,
  Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum),
);
const midiFrequency = (note) => 440 * (2 ** ((Number(note) - 69) / 12));
const NOTE_KEYS = Object.freeze({
  KeyA: 48,
  KeyS: 50,
  KeyD: 52,
  KeyF: 53,
  KeyG: 55,
  KeyH: 57,
  KeyJ: 59,
  KeyK: 60,
});
const DENTAPHONE_KEY_INDEX = Object.freeze({
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyG: 4,
  KeyH: 5,
  KeyJ: 6,
  KeyK: 7,
});
const HOLD_ACTIONS = new Set(["shake", "bow", "gust"]);
const MINIMUM_UI_GATE_MS = 180;
const UI_TAP_PULSE_MS = 280;
const DENTAPHONE_STRIKE_INTERVAL_MS = 12;
const DENTAPHONE_CHOMP_MS = 640;
const DENTAPHONE_REDUCED_CHOMP_MS = 220;
const DENTAPHONE_HIT_PROXIMITY_PX = 18;
const DENTAPHONE_CHEW_CYCLE_MS = 760;
const DENTAPHONE_REDUCED_CHEW_CYCLE_MS = 420;
const DENTAPHONE_FOOD_DRAG_THRESHOLD_PX = 6;
const DENTAPHONE_FOOD_VOICE_COUNT = 4;
const DENTAPHONE_FOOD_VOICE_GAIN = 0.28;
const DENTAPHONE_CHOMP_VOICE_COUNT = DENTAPHONE_TEETH.length;
const DENTAPHONE_CHOMP_VOICE_GAIN = (
  DENTAPHONE_FOOD_VOICE_COUNT * DENTAPHONE_FOOD_VOICE_GAIN
) / DENTAPHONE_CHOMP_VOICE_COUNT;
const DENTAPHONE_BRUSH_STEP_MS = 118;
const DENTAPHONE_REDUCED_BRUSH_STEP_MS = 150;
const DENTAPHONE_BRUSH_RETRIGGER_MS = 82;
const DENTAPHONE_BRUSH_RETRIGGER_PX = 14;
const DENTAPHONE_WEBGL_LOAD_TIMEOUT_MS = 12_000;
const DENTAPHONE_3D_READY_STATUS_MS = 1_400;
const DENTAPHONE_DEFAULT_VIEW = Object.freeze({ open: 0.58, yaw: -4, pitch: 3 });
const DENTAPHONE_VIEW_LIMITS = Object.freeze({ yaw: 26, pitch: 14 });
const DENTAPHONE_FOODS = Object.freeze({
  apple: Object.freeze({
    label: "Crisp apple",
    glyph: "🍎",
    bites: Object.freeze([
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-08", "lower-08"]), strength: 0.94 }),
        Object.freeze({ delay: 78, teeth: Object.freeze(["upper-09", "lower-09"]), strength: 0.72 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-07", "lower-07"]), strength: 0.98 }),
        Object.freeze({ delay: 68, teeth: Object.freeze(["upper-10", "lower-10"]), strength: 0.76 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-06", "lower-06", "upper-11", "lower-11"]), strength: 1.02 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-08", "upper-09", "lower-08", "lower-09"]), strength: 1.08 }),
        Object.freeze({ delay: 112, teeth: Object.freeze(["upper-05", "lower-12"]), strength: 0.62 }),
      ]),
    ]),
  }),
  crystal: Object.freeze({
    label: "Resonant crystal",
    glyph: "◆",
    bites: Object.freeze([
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-03", "upper-08", "upper-14"]), strength: 0.74 }),
        Object.freeze({ delay: 42, teeth: Object.freeze(["upper-09"]), strength: 0.52 }),
        Object.freeze({ delay: 91, teeth: Object.freeze(["upper-07", "upper-10"]), strength: 0.46 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-05", "upper-12"]), strength: 0.82 }),
        Object.freeze({ delay: 48, teeth: Object.freeze(["upper-02", "upper-15"]), strength: 0.58 }),
        Object.freeze({ delay: 104, teeth: Object.freeze(["upper-08", "upper-09"]), strength: 0.68 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-04", "upper-07", "upper-10", "upper-13"]), strength: 0.9 }),
        Object.freeze({ delay: 126, teeth: Object.freeze(["lower-08", "lower-09"]), strength: 0.48 }),
      ]),
    ]),
  }),
  gear: Object.freeze({
    label: "Clockwork gear",
    glyph: "⚙",
    bites: Object.freeze([
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-01", "lower-01"]), strength: 0.88 }),
        Object.freeze({ delay: 126, teeth: Object.freeze(["upper-16", "lower-16"]), strength: 0.7 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-15", "lower-15"]), strength: 0.82 }),
        Object.freeze({ delay: 94, teeth: Object.freeze(["upper-02", "lower-02"]), strength: 0.64 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-03", "lower-14"]), strength: 0.92 }),
        Object.freeze({ delay: 118, teeth: Object.freeze(["upper-14", "lower-03"]), strength: 0.68 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-04", "lower-13"]), strength: 0.86 }),
        Object.freeze({ delay: 72, teeth: Object.freeze(["upper-13", "lower-04"]), strength: 0.64 }),
        Object.freeze({ delay: 144, teeth: Object.freeze(["upper-04", "lower-13"]), strength: 0.54 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-01", "upper-16", "lower-01", "lower-16"]), strength: 1.04 }),
        Object.freeze({ delay: 138, teeth: Object.freeze(["lower-08"]), strength: 0.48 }),
      ]),
    ]),
  }),
  seedpod: Object.freeze({
    label: "Rattle seedpod",
    glyph: "✺",
    bites: Object.freeze([
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["lower-03"]), strength: 0.54 }),
        Object.freeze({ delay: 56, teeth: Object.freeze(["upper-12"]), strength: 0.48 }),
        Object.freeze({ delay: 119, teeth: Object.freeze(["lower-07", "upper-15"]), strength: 0.62 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-05"]), strength: 0.5 }),
        Object.freeze({ delay: 73, teeth: Object.freeze(["lower-14", "upper-08"]), strength: 0.66 }),
        Object.freeze({ delay: 151, teeth: Object.freeze(["lower-10"]), strength: 0.46 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["lower-02", "upper-10"]), strength: 0.58 }),
        Object.freeze({ delay: 47, teeth: Object.freeze(["lower-12"]), strength: 0.44 }),
        Object.freeze({ delay: 113, teeth: Object.freeze(["upper-06", "lower-16"]), strength: 0.64 }),
        Object.freeze({ delay: 181, teeth: Object.freeze(["upper-02"]), strength: 0.42 }),
      ]),
      Object.freeze([
        Object.freeze({ delay: 0, teeth: Object.freeze(["upper-04", "lower-06"]), strength: 0.7 }),
        Object.freeze({ delay: 63, teeth: Object.freeze(["upper-11", "lower-13"]), strength: 0.62 }),
        Object.freeze({ delay: 132, teeth: Object.freeze(["upper-08", "lower-09"]), strength: 0.76 }),
      ]),
    ]),
  }),
});
const OUTPUT_MAKEUP_GAIN = 1.25;
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false };

let state = sanitizePhysicalSoundState(kind, definition?.defaults ?? {});
let graph = null;
let audioStartupPromise = null;
let audioDesiredOn = false;
let audioGeneration = 0;
let pageActive = true;
let dentaphoneWebGLModule = null;
let dentaphoneWebGLLoadPromise = null;
let dentaphoneWebGLLoadGeneration = 0;
let dentaphone3dStatusTimer = 0;
let animationFrameId = 0;
let telemetry = {
  peak: 0,
  rms: 0,
  activity: 0,
  eventCount: 0,
  modeCount: 0,
  fundamentalHz: 0,
};
let announcementTimer = 0;
let activePointer = null;
let pointerPrevious = null;
let pointerEnergy = 0;
let lastPlayedNote = 60;
let visualTime = 0;
let customBank = null;
let customBankName = "";
let lastPointerExcitationAt = 0;
let dentaphonePitchState = DENTAPHONE_DEFAULT_PITCH_STATE;
let dentaphonePitchMap = [];
let selectedDentaphoneToothId = "lower-01";
let dentaphoneView = { ...DENTAPHONE_DEFAULT_VIEW };
let dentaphoneViewMode = "2d";
let dentaphoneViewModeGeneration = 0;
let dentaphoneViewPointer = null;
let dentaphoneChompGeneration = 0;
let dentaphoneChompEndTimer = 0;
let dentaphonePendingChompContact = null;
let dentaphoneFoodGeneration = 0;
let dentaphoneActiveFood = null;
let dentaphoneFoodPointer = null;
let dentaphoneFoodSuppressClickUntil = 0;
let dentaphoneFoodVoiceIndex = 0;
let dentaphoneFoodVoices = [];
let dentaphoneBrushMode = "off";
let dentaphoneBrushState = "parked";
let dentaphoneBrushGeneration = 0;
let dentaphoneBrushTimer = 0;
let dentaphoneBrushRouteIndex = 0;
let dentaphoneBrushPointer = null;
let dentaphoneBrushPosition = null;
let dentaphoneBrushLastStrike = null;
let dentaphoneBrushViewSyncFrame = 0;
let dentaphoneBrushViewSyncUntil = 0;
const dentaphoneFoodTimers = new Set();
const gateOwners = new Map();
const gateOwnerGestures = new Map();
const heldPitches = new Map();
const dentaphonePointerTeeth = new Map();
const dentaphoneFlashTimers = new Map();
let dentaphonePlayQueue = Promise.resolve();
let dentaphonePlayGeneration = 0;
const DEFAULT_GATE_OWNER = Symbol("default-gate-owner");

const visual = {
  particles: [],
  fragments: [],
  ripples: [],
  airSeeds: [],
  bowOffset: 0,
  bowVelocity: 0,
  impactFlash: 0,
  eventType: "bounce",
};

function presetList() {
  const presets = definition?.presets ?? [];
  if (Array.isArray(presets)) return presets;
  return Object.entries(presets).map(([id, preset]) => ({ id, ...preset }));
}

function presetSettings(preset) {
  if (!preset || typeof preset !== "object") return {};
  return preset.settings ?? preset.state ?? preset.values ?? preset;
}

function currentMaterialName() {
  if (customBank) return customBankName || customBank.name || "Custom modal body";
  return presetList().find((preset) => preset.id === state.presetId)?.label
    ?? String(state.presetId ?? "Modal body").replaceAll("-", " ");
}

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  globalThis.clearTimeout(announcementTimer);
  live.textContent = "";
  announcementTimer = globalThis.setTimeout(() => { live.textContent = message; }, 15);
}

function formatValue(key, value) {
  if (typeof value === "string") return value.replaceAll("-", " ");
  if (key === "objectCount" || key === "modeCount") return String(Math.round(value));
  if (key === "baseFrequencyHz") return `${Math.round(value)} Hz`;
  if (key === "airSpeed") return `${Number(value).toFixed(1)} m/s`;
  if (key === "diameter" || key === "cavityDepth") return `${Math.round(value * 1000)} mm`;
  if (key === "listenerAngle") return `${Math.round(value)}°`;
  if (key === "size") return `${Number(value).toFixed(2)}×`;
  if (key === "gravity") return `${Number(value).toFixed(2)} g`;
  if (key === "eventDensity") return `${Number(value).toFixed(1)} / s`;
  if (key === "restitution") return Number(value).toFixed(2);
  if ([
    "damping", "brightness", "energy", "stereoWidth", "particleSize",
    "roughness", "hardness", "chaos", "strikePosition",
    "stiffness", "pickupPosition", "bowPressure", "bowVelocity", "bowPosition",
    "rosin", "aperture", "turbulence",
  ].includes(key)) return `${Math.round(value * 100)}%`;
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(2);
}

function valueFromControl(control) {
  if (control.type === "checkbox") return control.checked;
  if (control.tagName === "SELECT") return control.value;
  const value = Number(control.value);
  return Number.isFinite(value) ? value : control.value;
}

function outputFor(key) {
  return root.querySelector(`[data-output="${CSS.escape(key)}"]`) ?? $(`${key}Out`);
}

function updateControlPresentation() {
  for (const control of root.querySelectorAll("[data-param]")) {
    const key = control.dataset.param;
    if (!(key in state)) continue;
    if (control.type === "checkbox") control.checked = Boolean(state[key]);
    else if (document.activeElement !== control) control.value = String(state[key]);
    const output = outputFor(key);
    if (output) output.textContent = formatValue(key, state[key]);
    if (control.type === "range") {
      control.setAttribute("aria-valuetext", formatValue(key, state[key]));
    }
  }
  if (kind === "airflow-objects") {
    const aeolian = state.airflowMode === "aeolian";
    for (const key of ["cavityDepth", "aperture"]) {
      const control = $(key);
      if (!control) continue;
      control.disabled = aeolian;
      control.closest(".control")?.classList.toggle("is-inactive", aeolian);
      if (aeolian && outputFor(key)) outputFor(key).textContent = "N/A";
    }
  }
  const presetControl = $("preset");
  if (presetControl && document.activeElement !== presetControl) {
    const customOptionValue = "__custom_modal_bank__";
    let customOption = presetControl.querySelector(`[value="${customOptionValue}"]`);
    if (kind === "object-forge" && customBank) {
      if (!customOption) {
        customOption = document.createElement("option");
        customOption.value = customOptionValue;
        customOption.disabled = true;
        presetControl.append(customOption);
      }
      customOption.textContent = `Custom · ${customBankName || customBank.name || "modal body"}`;
      presetControl.value = customOptionValue;
    } else {
      customOption?.remove();
      presetControl.value = state.presetId;
    }
  }
  if ($("level")) {
    const level = clamp($("level").value, 0, 1);
    if ($("levelOut")) $("levelOut").textContent = `${Math.round(level * 100)}%`;
    $("level").setAttribute("aria-valuetext", `${Math.round(level * 100)}%`);
  }
  const selectedPreset = customBank
    ? null
    : presetList().find((preset) => preset.id === state.presetId);
  if ($("presetSummary")) {
    $("presetSummary").textContent = customBank
      ? `${customBankName || customBank.name || "Custom modal body"} · ${customBank.modeCount} mode${customBank.modeCount === 1 ? "" : "s"}`
      : selectedPreset?.label
        ? `${selectedPreset.label} · ${definition?.modelFamily ?? "physical model"}`
        : definition?.summary ?? "live physical model";
  }
  if ($("presetDescription")) {
    $("presetDescription").textContent = customBank
      ? "Imported modal data is active. Reference pitch, material, position, and damping controls transform this custom body."
      : selectedPreset?.description
        ?? definition?.summary
        ?? "A live, sample-free physical model.";
  }
  if (isDentaphone) {
    document.body.dataset.dentaphoneMaterial = customBank ? "custom" : state.presetId;
    updateDentaphoneKeyboardPresentation();
  }
  updateStageReadout();
  if (reducedMotion.matches) startAnimation();
}

function updateStageReadout() {
  if ($("stageReadout")) {
    const selectedTooth = dentaphonePitchMap.find(({ id }) => id === selectedDentaphoneToothId);
    const label = isDentaphone ? "Dentaphone" : definition?.label ?? kind.replaceAll("-", " ");
    const detail = isDentaphone
      ? `32 TEETH · ${selectedTooth?.note ?? "READY"}`
      : kind === "particle-cabinet"
      ? `${Math.round(state.objectCount)} OBJECTS`
      : kind === "impact-ecology"
        ? String(state.eventType).toUpperCase()
        : kind === "object-forge"
          ? `${Math.round(telemetry.modeCount || state.modeCount)} MODES`
          : kind === "bowed-things"
            ? `${Math.round(state.baseFrequencyHz / state.size)} HZ`
            : `${String(state.airflowMode).toUpperCase()} · ${state.airSpeed.toFixed(1)} M/S`;
    $("stageReadout").textContent = `${label.toUpperCase()} · ${detail} · AUDIO ${audioDesiredOn ? "ON" : "OFF"}`;
  }
  const metrics = $("modelMetrics");
  if (metrics) {
    const activity = Math.round(clamp(telemetry.activity, 0, 1) * 100);
    const frequency = Math.round(telemetry.fundamentalHz || 0);
    const values = kind === "particle-cabinet"
      ? [`${Math.round(telemetry.eventRate || 0)} / s`, `${frequency || "—"} Hz`, `${activity}%`]
      : kind === "impact-ecology"
        ? [String(telemetry.eventCount || 0), telemetry.impactIntervalMs > 0 ? `${Math.round(telemetry.impactIntervalMs)} ms` : "— ms", `${activity}%`]
        : kind === "object-forge"
          ? [String(telemetry.modeCount || state.modeCount || 0), `${frequency || "—"} Hz`, `${activity}%`]
          : kind === "bowed-things"
            ? [`${Math.round(frequency * (0.93 + state.bowVelocity * 0.14)) || "—"} Hz`, `${frequency || "—"} Hz`, telemetry.gateLevel > 0.01 ? "bowing" : "open"]
            : [
                `${state.airSpeed.toFixed(1)} m/s`,
                `${frequency || "—"} Hz`,
                telemetry.gateLevel > 0.01 ? telemetry.airRegime ?? "sounding" : "silent",
              ];
    for (const [index, name] of ["primary", "secondary", "tertiary"].entries()) {
      const metric = metrics.querySelector(`[data-metric="${name}"]`);
      if (metric) metric.textContent = values[index];
    }
  }
}

function populatePresets() {
  const select = $("preset");
  if (!select) return;
  const presets = presetList();
  if (!presets.length) return;
  select.replaceChildren(...presets.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label ?? preset.id.replaceAll("-", " ");
    return option;
  }));
  select.value = state.presetId;
}

function dentaphoneToothById(id) {
  return dentaphonePitchMap.find((tooth) => tooth.id === id) ?? null;
}

function dentaphoneStateForTooth(currentState, tooth) {
  if (!tooth) return currentState;
  return sanitizePhysicalSoundState(kind, {
    ...currentState,
    baseFrequencyHz: midiFrequency(tooth.midi),
  }, currentState);
}

function updateDentaphoneHud(tooth = dentaphoneToothById(selectedDentaphoneToothId)) {
  if (!isDentaphone) return;
  if ($("dentaphoneHudArch")) {
    $("dentaphoneHudArch").textContent = tooth
      ? `${tooth.arch === "upper" ? "Maxillary" : "Mandibular"} · tooth ${tooth.universalNumber} · ${tooth.anatomicalName}`
      : "32-key dental atlas";
  }
  if ($("dentaphoneHudNote")) $("dentaphoneHudNote").textContent = tooth?.note ?? "Ready";
  if ($("dentaphoneHudMaterial")) $("dentaphoneHudMaterial").textContent = currentMaterialName();
  if ($("dentaphoneSelectionSummary")) {
    $("dentaphoneSelectionSummary").textContent = tooth
      ? `Selected ${dentaphoneToothLabel(tooth, currentMaterialName())}.`
      : "No Dentaphone tooth selected.";
  }
}

function updateDentaphoneKeyboardPresentation() {
  if (!isDentaphone || !dentaphonePitchMap.length) return;
  const material = currentMaterialName();
  for (const tooth of dentaphonePitchMap) {
    const button = root.querySelector(`[data-tooth-id="${tooth.id}"]`);
    if (!button) continue;
    button.dataset.midi = String(tooth.midi);
    button.dataset.note = tooth.note;
    button.setAttribute("aria-label", dentaphoneToothLabel(tooth, material));
    button.tabIndex = tooth.id === selectedDentaphoneToothId ? 0 : -1;
    button.classList.toggle("is-selected", tooth.id === selectedDentaphoneToothId);
    if (tooth.id === selectedDentaphoneToothId) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
    const note = button.querySelector(".dentaphone-tooth-note");
    if (note) note.textContent = tooth.note;
  }
  if ($("upperPitchRange")) {
    $("upperPitchRange").textContent = dentaphonePitchRange(dentaphonePitchMap, "upper");
  }
  if ($("lowerPitchRange")) {
    $("lowerPitchRange").textContent = dentaphonePitchRange(dentaphonePitchMap, "lower");
  }
  updateDentaphoneHud();
}

function selectDentaphoneTooth(id, { focus = false } = {}) {
  const tooth = dentaphoneToothById(id);
  if (!tooth) return null;
  selectedDentaphoneToothId = tooth.id;
  state = dentaphoneStateForTooth(state, tooth);
  syncModalReadout(null, state);
  updateControlPresentation();
  if (dentaphoneBrushMode === "manual" && !dentaphoneBrushPointer) {
    positionDentaphoneBrushAtTooth(tooth.id);
  }
  if (focus) root.querySelector(`[data-tooth-id="${tooth.id}"]`)?.focus({ preventScroll: true });
  return tooth;
}

function flashDentaphoneTeeth(ids) {
  const targets = [...new Set(ids)].map((id) => ({
    id,
    button: root.querySelector(`[data-tooth-id="${id}"]`),
  })).filter(({ button }) => button);
  if (!targets.length) return;
  for (const { id, button } of targets) {
    if (dentaphoneViewMode === "3d") dentaphoneWebGLModule?.pulseDentaphoneWebGLTooth(id);
    globalThis.clearTimeout(dentaphoneFlashTimers.get(id));
    button.classList.remove("is-struck");
  }
  // One shared style flush makes a chord's tooth vibrations begin together.
  void $("dentaphoneKeyboard")?.offsetWidth;
  for (const { id, button } of targets) {
    button.classList.add("is-struck");
    const timer = globalThis.setTimeout(() => {
      button.classList.remove("is-struck");
      dentaphoneFlashTimers.delete(id);
    }, reducedMotion.matches ? 220 : 320);
    dentaphoneFlashTimers.set(id, timer);
  }
}

function flashDentaphoneTooth(id) {
  flashDentaphoneTeeth([id]);
}

async function initializeDentaphoneRenderer() {
  if (!isDentaphone) return null;
  if (dentaphoneWebGLLoadPromise) return dentaphoneWebGLLoadPromise;
  const artboard = $("dentaphoneArtboard");
  if (dentaphoneViewMode === "3d" && artboard) artboard.dataset.dentaphoneRenderer = "loading";
  const loadGeneration = ++dentaphoneWebGLLoadGeneration;
  let loadedModule = null;
  let loadPromise = null;
  loadPromise = import("./src/dentaphone-webgl.js?v=3533693c07e9")
    .then(async (module) => {
      loadedModule = module;
      if (
        loadGeneration !== dentaphoneWebGLLoadGeneration
        || dentaphoneWebGLLoadPromise !== loadPromise
      ) return null;
      dentaphoneWebGLModule = module;
      const renderer = await module.initializeDentaphoneWebGL();
      if (
        loadGeneration !== dentaphoneWebGLLoadGeneration
        || dentaphoneWebGLLoadPromise !== loadPromise
      ) return null;
      if (!renderer || !module.dentaphoneWebGLIsReady()) {
        resetDentaphoneWebGLLoadState({ expectedGeneration: loadGeneration, module });
        return null;
      }
      globalThis.__dentaphoneWebGL = Object.freeze({
        snapshot: () => module.dentaphoneWebGLSnapshot(),
        pick: (clientX, clientY) => module.dentaphoneWebGLToothAtPoint(clientX, clientY),
      });
      return renderer;
    })
    .catch((error) => {
      console.warn("Dentaphone could not load its WebGL module.", error);
      resetDentaphoneWebGLLoadState({
        expectedGeneration: loadGeneration,
        module: loadedModule,
      });
      return null;
    });
  dentaphoneWebGLLoadPromise = loadPromise;
  return loadPromise;
}

function resetDentaphoneWebGLLoadState({
  expectedGeneration = null,
  module = dentaphoneWebGLModule,
} = {}) {
  if (
    expectedGeneration !== null
    && expectedGeneration !== dentaphoneWebGLLoadGeneration
  ) return false;
  dentaphoneWebGLLoadGeneration += 1;
  dentaphoneWebGLLoadPromise = null;
  dentaphoneWebGLModule = null;
  delete globalThis.__dentaphoneWebGL;
  try {
    module?.disposeDentaphoneWebGL();
  } catch (error) {
    console.warn("Dentaphone could not dispose its WebGL module cleanly.", error);
  }
  return true;
}

function setDentaphone3dStatus(state, message = "") {
  if (!isDentaphone) return;
  const panel = $("dentaphone3dStatus");
  const messageNode = $("dentaphone3dStatusMessage");
  const retry = $("dentaphone3dRetry");
  const tab = $("dentaphoneView3d");
  globalThis.clearTimeout(dentaphone3dStatusTimer);
  dentaphone3dStatusTimer = 0;
  if (!panel || !messageNode) return;

  const nextState = ["loading", "ready", "error"].includes(state) ? state : "idle";
  panel.dataset.state = nextState;
  panel.hidden = nextState === "idle";
  messageNode.textContent = nextState === "idle" ? "" : message;
  if (retry) retry.hidden = nextState !== "error";
  if (nextState === "loading") tab?.setAttribute("aria-busy", "true");
  else tab?.removeAttribute("aria-busy");

  if (nextState === "ready") {
    dentaphone3dStatusTimer = globalThis.setTimeout(() => {
      if (panel.dataset.state === "ready") setDentaphone3dStatus("idle");
    }, DENTAPHONE_3D_READY_STATUS_MS);
  }
}

function cancelDentaphonePlayQueue() {
  if (isDentaphone) dentaphonePlayGeneration += 1;
}

function dentaphoneAngleLabel(value, negativeLabel, positiveLabel, zeroLabel) {
  const degrees = Math.round(Number(value) || 0);
  if (degrees === 0) return zeroLabel;
  return `${Math.abs(degrees)}° ${degrees < 0 ? negativeLabel : positiveLabel}`;
}

function updateDentaphoneViewModePresentation() {
  if (!isDentaphone) return;
  const isThreeD = dentaphoneViewMode === "3d";
  const threeDReady = Boolean(isThreeD && dentaphoneWebGLModule?.dentaphoneWebGLIsReady());
  const artboard = $("dentaphoneArtboard");
  document.body.dataset.dentaphoneViewMode = dentaphoneViewMode;
  if (artboard) artboard.dataset.dentaphoneViewMode = dentaphoneViewMode;
  for (const tab of root.querySelectorAll("[data-dentaphone-view-tab]")) {
    const selected = tab.dataset.dentaphoneViewTab === dentaphoneViewMode;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const selectedTab = $(`dentaphoneView${isThreeD ? "3d" : "2d"}`);
  if (selectedTab) $("stageWrap")?.setAttribute("aria-labelledby", selectedTab.id);
  if ($("dentaphone3dControls")) $("dentaphone3dControls").hidden = !isThreeD;
  if ($("dentaphoneFoodCard")) $("dentaphoneFoodCard").hidden = !isThreeD;
  if ($("dentaphoneMotionCard")) $("dentaphoneMotionCard").hidden = !isThreeD;
  if ($("dentaphoneChomp")) $("dentaphoneChomp").disabled = !threeDReady;
  if ($("dentaphoneJawOpen")) $("dentaphoneJawOpen").disabled = !threeDReady;
  if ($("dentaphoneResetView")) $("dentaphoneResetView").disabled = !threeDReady;
  for (const button of root.querySelectorAll("[data-dentaphone-food], #dentaphoneClearFood")) {
    button.disabled = !threeDReady;
  }
  if ($("dentaphoneMotionHelp")) {
    $("dentaphoneMotionHelp").textContent = isThreeD
      ? "Drag empty space around the teeth to rotate the mouth. Drag across teeth to keep playing a glissando."
      : "The 2D anatomy stays fixed. Tap or drag directly across teeth to play a glissando.";
  }
  if ($("dentaphoneViewHint")) {
    $("dentaphoneViewHint").textContent = isThreeD
      ? threeDReady ? "Drag empty space to rotate · tap teeth to play" : "Loading the 3D chomper…"
      : "Tap or drag teeth to play · switch to 3D to chomp";
  }
  updateDentaphoneViewPresentation();
}

async function setDentaphoneViewMode(mode, { announceChange = true } = {}) {
  if (!isDentaphone) return false;
  const viewModeGeneration = ++dentaphoneViewModeGeneration;
  const nextMode = mode === "3d" ? "3d" : "2d";
  if (nextMode !== dentaphoneViewMode) {
    cancelDentaphoneOrbit();
    if (dentaphoneBrushPointer) {
      finishDentaphoneManualBrush(
        { pointerId: dentaphoneBrushPointer.id },
        { cancelled: true },
      );
    }
    if (nextMode === "2d") {
      cancelDentaphoneFoodDrag();
      const hadFood = cancelDentaphoneFood();
      if (hadFood) setDentaphoneChewStatus("Chewing stopped. Switch to 3D to feed the mouth.");
      cancelDentaphoneChomp();
      dentaphoneView.open = DENTAPHONE_DEFAULT_VIEW.open;
    }
  }
  dentaphoneViewMode = nextMode;
  updateDentaphoneViewModePresentation();
  const artboard = $("dentaphoneArtboard");

  if (nextMode === "2d") {
    setDentaphone3dStatus("idle");
    dentaphoneWebGLModule?.setDentaphoneWebGLActive(false);
    restoreDentaphoneImageToothLayout();
    if (artboard) artboard.dataset.dentaphoneRenderer = "image";
    clearDentaphoneHover();
    if (dentaphoneBrushMode !== "off") {
      positionDentaphoneBrushAtTooth(
        $("dentaphoneKeyboard")?.dataset.brushTooth ?? selectedDentaphoneToothId,
      );
    }
    if (announceChange) announce("2D anatomy view. All 32 illustrated teeth are playable.");
    return true;
  }

  const rendererWasReady = Boolean(dentaphoneWebGLModule?.dentaphoneWebGLIsReady());
  if (!rendererWasReady) {
    setDentaphone3dStatus("loading", "Loading the 3D tooth model…");
  }
  if (announceChange && !rendererWasReady) {
    announce("Loading the 3D chomper.");
  }
  const rendererPromise = initializeDentaphoneRenderer();
  const rendererLoadGeneration = dentaphoneWebGLLoadGeneration;
  let loadTimedOut = false;
  let loadTimeout = 0;
  const renderer = rendererWasReady
    ? await rendererPromise
    : await Promise.race([
      rendererPromise,
      new Promise((resolve) => {
        loadTimeout = globalThis.setTimeout(() => {
          loadTimedOut = true;
          resolve(null);
        }, DENTAPHONE_WEBGL_LOAD_TIMEOUT_MS);
      }),
    ]);
  globalThis.clearTimeout(loadTimeout);
  if (loadTimedOut) {
    resetDentaphoneWebGLLoadState({ expectedGeneration: rendererLoadGeneration });
  }
  if (
    viewModeGeneration !== dentaphoneViewModeGeneration
    || dentaphoneViewMode !== "3d"
  ) return false;
  if (!renderer || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()) {
    const viewTabList = $("dentaphoneView2d")?.closest('[role="tablist"]');
    const restoreViewTabFocus = Boolean(viewTabList?.contains(document.activeElement));
    resetDentaphoneWebGLLoadState();
    dentaphoneViewMode = "2d";
    restoreDentaphoneImageToothLayout();
    if (artboard) artboard.dataset.dentaphoneRenderer = "image";
    updateDentaphoneViewModePresentation();
    if (restoreViewTabFocus) $("dentaphoneView2d")?.focus({ preventScroll: true });
    const failureMessage = loadTimedOut
      ? "The 3D model took too long to load. The 2D instrument still works."
      : "The 3D model couldn’t load. The 2D instrument still works.";
    setDentaphone3dStatus("error", failureMessage);
    announce(`${failureMessage} Use Retry 3D to try again.`);
    return false;
  }
  dentaphoneWebGLModule.setDentaphoneWebGLActive(true);
  if (artboard) artboard.dataset.dentaphoneRenderer = "webgl";
  updateDentaphoneViewModePresentation();
  if (dentaphoneBrushMode !== "off") {
    globalThis.requestAnimationFrame?.(() => {
      positionDentaphoneBrushAtTooth(
        $("dentaphoneKeyboard")?.dataset.brushTooth ?? selectedDentaphoneToothId,
      );
    });
  }
  setDentaphone3dStatus("ready", "3D model ready · drag empty space to rotate");
  if (announceChange) announce("3D chomper view. Drag empty space to rotate; every tooth remains playable.");
  return true;
}

function setDentaphoneView(changes = {}) {
  if (!isDentaphone) return;
  dentaphoneView = {
    open: clamp(changes.open ?? dentaphoneView.open),
    yaw: clamp(
      changes.yaw ?? dentaphoneView.yaw,
      -DENTAPHONE_VIEW_LIMITS.yaw,
      DENTAPHONE_VIEW_LIMITS.yaw,
    ),
    pitch: clamp(
      changes.pitch ?? dentaphoneView.pitch,
      -DENTAPHONE_VIEW_LIMITS.pitch,
      DENTAPHONE_VIEW_LIMITS.pitch,
    ),
  };
  updateDentaphoneViewPresentation();
  synchronizeDentaphoneBrushToView();
}

function updateDentaphoneViewPresentation() {
  if (!isDentaphone) return;
  const artboard = $("dentaphoneArtboard");
  if (!artboard) return;
  const separation = dentaphoneView.open * 10 - 5.8;
  artboard.style.setProperty("--dentaphone-upper-shift", `${(-separation).toFixed(2)}%`);
  artboard.style.setProperty("--dentaphone-lower-shift", `${separation.toFixed(2)}%`);
  artboard.dataset.jawOpen = dentaphoneView.open.toFixed(2);
  artboard.dataset.viewYaw = dentaphoneView.yaw.toFixed(2);
  artboard.dataset.viewPitch = dentaphoneView.pitch.toFixed(2);
  artboard.dataset.jawState = dentaphoneView.open < 0.18
    ? "closed"
    : dentaphoneView.open > 0.82 ? "wide" : "open";

  const openPercent = Math.round(dentaphoneView.open * 100);
  const yawLabel = dentaphoneAngleLabel(dentaphoneView.yaw, "left", "right", "centered");
  const pitchLabel = dentaphoneAngleLabel(dentaphoneView.pitch, "down", "up", "level");
  const controls = {
    dentaphoneJawOpen: dentaphoneView.open,
    dentaphoneYaw: dentaphoneView.yaw,
    dentaphonePitch: dentaphoneView.pitch,
  };
  for (const [id, value] of Object.entries(controls)) {
    const control = $(id);
    if (control) control.value = String(value);
  }
  if ($("dentaphoneJawOpenOut")) $("dentaphoneJawOpenOut").textContent = `${openPercent}% open`;
  if ($("dentaphoneYawOut")) $("dentaphoneYawOut").textContent = yawLabel;
  if ($("dentaphonePitchOut")) $("dentaphonePitchOut").textContent = pitchLabel;
  $("dentaphoneJawOpen")?.setAttribute("aria-valuetext", `${openPercent}% open`);
  $("dentaphoneYaw")?.setAttribute("aria-valuetext", yawLabel);
  $("dentaphonePitch")?.setAttribute("aria-valuetext", pitchLabel);
  if ($("dentaphoneViewSummary")) {
    $("dentaphoneViewSummary").textContent = dentaphoneViewMode === "3d"
      ? `3D · ${openPercent}% · ${yawLabel} · ${pitchLabel}`
      : "2D · fixed anatomy";
  }
}

function setDentaphoneChewStatus(message) {
  const status = $("dentaphoneChewStatus");
  if (status) status.textContent = message;
}

function setDentaphoneFoodButtonPresentation(foodId = null) {
  for (const button of root.querySelectorAll(".dentaphone-food-button[data-dentaphone-food]")) {
    const active = Boolean(foodId && button.dataset.dentaphoneFood === foodId);
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function scheduleDentaphoneFoodTimer(generation, callback, delayMs) {
  let timer = 0;
  timer = globalThis.setTimeout(() => {
    dentaphoneFoodTimers.delete(timer);
    if (generation !== dentaphoneFoodGeneration) return;
    callback();
  }, Math.max(0, delayMs));
  dentaphoneFoodTimers.add(timer);
  return timer;
}

function clearDentaphoneFoodTimers() {
  for (const timer of dentaphoneFoodTimers) globalThis.clearTimeout(timer);
  dentaphoneFoodTimers.clear();
}

function silenceDentaphoneFoodVoices() {
  for (const voice of dentaphoneFoodVoices) {
    try {
      voice.gain.gain.setValueAtTime(0, voice.context.currentTime);
    } catch {
      voice.gain.gain.value = 0;
    }
    voice.node?.port.postMessage({ type: "silence" });
  }
}

function activateDentaphoneFoodVoices(voices, voiceGain = DENTAPHONE_FOOD_VOICE_GAIN) {
  for (const voice of voices) {
    try {
      voice.gain.gain.setValueAtTime(voiceGain, voice.context.currentTime);
    } catch {
      voice.gain.gain.value = voiceGain;
    }
  }
}

function discardDentaphoneFoodVoices() {
  for (const voice of dentaphoneFoodVoices) {
    voice.node.onprocessorerror = null;
    voice.node.port.onmessage = null;
    try { voice.node.disconnect(); } catch { /* Its context may already be closed. */ }
    try { voice.gain.disconnect(); } catch { /* Its context may already be closed. */ }
  }
  dentaphoneFoodVoices = [];
  dentaphoneFoodVoiceIndex = 0;
}

function ensureDentaphoneFoodVoices(requiredCount = DENTAPHONE_FOOD_VOICE_COUNT) {
  if (!isDentaphone || !graph?.context || !graph?.makeup) return [];
  const targetCount = Math.max(1, Math.round(requiredCount));
  if (dentaphoneFoodVoices.some(({ context }) => context !== graph.context)) {
    discardDentaphoneFoodVoices();
  }
  for (const voice of dentaphoneFoodVoices.filter(({ failed }) => failed)) {
    try { voice.gain.disconnect(); } catch { /* The failed voice is already detached. */ }
  }
  dentaphoneFoodVoices = dentaphoneFoodVoices.filter((voice) => !voice.failed);
  try {
    while (dentaphoneFoodVoices.length < targetCount) {
      const node = new AudioWorkletNode(graph.context, "morphazoid-physical-sounds", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        processorOptions: {
          kind,
          configuration: state,
          fundamentalOverrideHz: state.baseFrequencyHz,
        },
      });
      const gain = graph.context.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(graph.makeup);
      const voice = { context: graph.context, node, gain, failed: false };
      node.port.onmessage = () => {};
      node.onprocessorerror = () => {
        voice.failed = true;
        try { node.disconnect(); } catch { /* The voice has already stopped. */ }
      };
      dentaphoneFoodVoices.push(voice);
    }
  } catch (error) {
    console.error("Unable to create a Dentaphone auxiliary voice.", error);
  }
  return dentaphoneFoodVoices.filter((voice) => !voice.failed).slice(0, targetCount);
}

function renderDentaphoneFood(foodId, food) {
  const layer = $("dentaphoneFoodLayer");
  if (!layer) return null;
  layer.querySelector(".dentaphone-mouth-food, .dentaphone-food-object")?.remove();
  layer.dataset.activeFood = foodId;
  layer.dataset.state = "entering";
  layer.dataset.chewState = "waiting";
  layer.dataset.bite = "0";
  const sourceImage = root.querySelector(
    `.dentaphone-food-button[data-dentaphone-food="${foodId}"] img`,
  );
  const object = sourceImage?.cloneNode(false) ?? document.createElement("span");
  object.className = `dentaphone-mouth-food dentaphone-food-object dentaphone-mouth-food--${foodId}`;
  object.dataset.food = foodId;
  object.dataset.state = "waiting";
  object.dataset.bite = "0";
  object.style.setProperty("--dentaphone-food-scale", "1");
  object.style.setProperty("--food-damage", "0");
  object.classList.add("is-entering");
  if (!sourceImage) object.textContent = food.glyph;
  object.setAttribute("aria-hidden", "true");
  object.setAttribute("alt", "");
  object.setAttribute("draggable", "false");
  layer.append(object);
  return object;
}

function cancelDentaphoneFoodDrag() {
  const pointer = dentaphoneFoodPointer;
  if (!pointer) return false;
  // Clear first so a synchronous lostpointercapture event cannot re-enter cleanup.
  dentaphoneFoodPointer = null;
  pointer.ghost?.remove();
  pointer.button?.classList.remove("is-dragging");
  pointer.button?.setAttribute("aria-grabbed", "false");
  try { pointer.button?.releasePointerCapture?.(pointer.id); } catch { /* already released */ }
  $("dentaphoneArtboard")?.classList.remove("is-food-drop-target");
  $("dentaphoneFoodLayer")?.removeAttribute("data-drop-ready");
  return true;
}

function cancelDentaphoneFood({ statusMessage = null } = {}) {
  if (!isDentaphone) return false;
  const hadFood = Boolean(dentaphoneActiveFood || $("dentaphoneFoodLayer")?.querySelector(
    ".dentaphone-mouth-food, .dentaphone-food-object",
  ));
  dentaphoneFoodGeneration += 1;
  clearDentaphoneFoodTimers();
  cancelDentaphonePlayQueue();
  silenceDentaphoneFoodVoices();
  const rig = $("dentaphoneKeyboard");
  rig?.classList.remove("is-chewing", "is-chomping");
  if (rig) {
    delete rig.dataset.chewBite;
    delete rig.dataset.chewFood;
  }
  const layer = $("dentaphoneFoodLayer");
  layer?.querySelector(".dentaphone-mouth-food, .dentaphone-food-object")?.remove();
  if (layer) {
    delete layer.dataset.activeFood;
    delete layer.dataset.bite;
    layer.dataset.state = "empty";
    layer.dataset.chewState = "empty";
  }
  dentaphoneActiveFood = null;
  setDentaphoneFoodButtonPresentation();
  if (statusMessage !== null) setDentaphoneChewStatus(statusMessage);
  return hadFood;
}

function clearDentaphoneFood() {
  cancelDentaphoneFoodDrag();
  cancelDentaphoneFood({ statusMessage: "Mouth empty. Choose something else to eat." });
  cancelDentaphoneChomp();
  graph?.source.port.postMessage({ type: "silence" });
}

function setDentaphoneBrushStatus(message) {
  const status = $("dentaphoneBrushStatus");
  if (status) status.textContent = message;
}

function updateDentaphoneBrushPresentation() {
  if (!isDentaphone) return;
  const active = dentaphoneBrushMode !== "off";
  const rig = $("dentaphoneKeyboard");
  const brush = $("dentaphoneToothbrush");
  const automatic = $("dentaphoneBrushAuto");
  const manual = $("dentaphoneBrushManual");
  const stop = $("dentaphoneBrushStop");

  automatic?.setAttribute("aria-pressed", String(dentaphoneBrushMode === "auto"));
  manual?.setAttribute("aria-pressed", String(dentaphoneBrushMode === "manual"));
  if (stop) stop.disabled = !active;
  if (rig) {
    rig.dataset.brushMode = dentaphoneBrushMode;
    rig.dataset.brushState = dentaphoneBrushState;
    rig.classList.toggle("is-brushing", active);
    rig.classList.toggle("is-brush-dragging", dentaphoneBrushState === "brushing");
    if (!active) {
      delete rig.dataset.brushTooth;
      delete rig.dataset.brushDirection;
      delete rig.dataset.brushArch;
    }
  }
  if (brush) {
    brush.hidden = !active;
    brush.dataset.mode = dentaphoneBrushMode;
    brush.dataset.state = dentaphoneBrushState;
    if (!active) {
      delete brush.dataset.tooth;
      delete brush.dataset.direction;
      delete brush.dataset.arch;
    }
  }
  const artboard = $("dentaphoneArtboard");
  artboard?.classList.toggle("is-brush-manual", dentaphoneBrushMode === "manual");
  artboard?.classList.toggle("is-brush-active", active);
}

function positionDentaphoneBrush(clientX, clientY, { direction = null, arch = null } = {}) {
  const artboard = $("dentaphoneArtboard");
  const brush = $("dentaphoneToothbrush");
  const bounds = artboard?.getBoundingClientRect();
  if (!brush || !bounds?.width || !bounds?.height) return false;
  const x = clamp((clientX - bounds.left) / bounds.width);
  const y = clamp((clientY - bounds.top) / bounds.height);
  const deltaX = dentaphoneBrushPosition ? clientX - dentaphoneBrushPosition.clientX : 0;
  const deltaY = dentaphoneBrushPosition ? clientY - dentaphoneBrushPosition.clientY : 0;
  const travelDirection = direction ?? (
    Math.abs(deltaX) < 0.5 ? "stationary" : deltaX > 0 ? "forward" : "backward"
  );
  const travelTilt = travelDirection === "backward" ? 8 : travelDirection === "forward" ? -8 : 0;
  const slopeTilt = clamp(deltaY * 0.13, -9, 9);
  const archTilt = arch === "lower" ? 4 : arch === "upper" ? -3 : 0;
  const angle = clamp(travelTilt + slopeTilt + archTilt, -24, 24);
  brush.style.setProperty("--brush-x", `${(x * 100).toFixed(3)}%`);
  brush.style.setProperty("--brush-y", `${(y * 100).toFixed(3)}%`);
  brush.style.setProperty("--brush-angle", `${angle.toFixed(2)}deg`);
  brush.dataset.direction = travelDirection;
  if (arch) brush.dataset.arch = arch;
  const rig = $("dentaphoneKeyboard");
  if (rig) {
    rig.dataset.brushDirection = travelDirection;
    if (arch) rig.dataset.brushArch = arch;
  }
  dentaphoneBrushPosition = { clientX, clientY };
  return true;
}

function positionDentaphoneBrushAtTooth(toothId, { direction = null } = {}) {
  const target = root.querySelector(`[data-tooth-id="${toothId}"]`);
  const bounds = target?.getBoundingClientRect();
  if (!bounds?.width || !bounds?.height) return false;
  return positionDentaphoneBrush(
    (bounds.left + bounds.right) * 0.5,
    (bounds.top + bounds.bottom) * 0.5,
    { direction, arch: target.dataset.arch },
  );
}

function synchronizeDentaphoneBrushToView(durationMs = 220) {
  if (dentaphoneBrushMode === "off" || dentaphoneBrushPointer) return;
  const requestFrame = globalThis.requestAnimationFrame;
  const targetTooth = () => (
    $("dentaphoneKeyboard")?.dataset.brushTooth ?? selectedDentaphoneToothId
  );
  if (typeof requestFrame !== "function") {
    positionDentaphoneBrushAtTooth(targetTooth());
    return;
  }
  dentaphoneBrushViewSyncUntil = Math.max(
    dentaphoneBrushViewSyncUntil,
    performance.now() + durationMs,
  );
  if (dentaphoneBrushViewSyncFrame) return;
  const synchronize = () => {
    dentaphoneBrushViewSyncFrame = 0;
    if (dentaphoneBrushMode === "off" || dentaphoneBrushPointer) return;
    positionDentaphoneBrushAtTooth(targetTooth());
    if (performance.now() < dentaphoneBrushViewSyncUntil) {
      dentaphoneBrushViewSyncFrame = requestFrame(synchronize);
    }
  };
  dentaphoneBrushViewSyncFrame = requestFrame(synchronize);
}

function clearDentaphoneBrushContact() {
  dentaphoneBrushLastStrike = null;
  const rig = $("dentaphoneKeyboard");
  const brush = $("dentaphoneToothbrush");
  if (rig) delete rig.dataset.brushTooth;
  if (brush) delete brush.dataset.tooth;
}

function triggerDentaphoneBrushTooth(
  toothId,
  strength,
  { clientX = null, clientY = null, force = false } = {},
) {
  const tooth = dentaphoneToothById(toothId);
  if (!tooth || dentaphoneBrushMode === "off") return false;
  const now = performance.now();
  const pointIsFinite = Number.isFinite(clientX) && Number.isFinite(clientY);
  const travelled = pointIsFinite && dentaphoneBrushLastStrike
    ? Math.hypot(
      clientX - dentaphoneBrushLastStrike.clientX,
      clientY - dentaphoneBrushLastStrike.clientY,
    )
    : Infinity;
  if (
    !force
    && dentaphoneBrushLastStrike?.toothId === toothId
    && (
      now - dentaphoneBrushLastStrike.time < DENTAPHONE_BRUSH_RETRIGGER_MS
      || travelled < DENTAPHONE_BRUSH_RETRIGGER_PX
    )
  ) return false;

  dentaphoneBrushLastStrike = {
    toothId,
    time: now,
    clientX: pointIsFinite ? clientX : dentaphoneBrushPosition?.clientX ?? 0,
    clientY: pointIsFinite ? clientY : dentaphoneBrushPosition?.clientY ?? 0,
  };
  const rig = $("dentaphoneKeyboard");
  const brush = $("dentaphoneToothbrush");
  if (rig) {
    rig.dataset.brushTooth = toothId;
    rig.dataset.brushArch = tooth.arch;
  }
  if (brush) {
    brush.dataset.tooth = toothId;
    brush.dataset.arch = tooth.arch;
  }
  void playDentaphoneTooth(toothId, strength, {
    scripted: true,
    announceStrike: false,
  });
  return true;
}

function stopDentaphoneBrush({
  statusMessage = "Brush parked.",
  announceChange = false,
} = {}) {
  if (!isDentaphone) return false;
  const hadBrush = dentaphoneBrushMode !== "off" || Boolean(dentaphoneBrushPointer);
  dentaphoneBrushGeneration += 1;
  globalThis.clearTimeout(dentaphoneBrushTimer);
  dentaphoneBrushTimer = 0;
  if (dentaphoneBrushPointer) {
    try {
      $("dentaphoneArtboard")?.releasePointerCapture?.(dentaphoneBrushPointer.id);
    } catch { /* already released */ }
  }
  dentaphoneBrushPointer = null;
  dentaphoneBrushMode = "off";
  dentaphoneBrushState = "parked";
  dentaphoneBrushRouteIndex = 0;
  dentaphoneBrushPosition = null;
  globalThis.cancelAnimationFrame?.(dentaphoneBrushViewSyncFrame);
  dentaphoneBrushViewSyncFrame = 0;
  dentaphoneBrushViewSyncUntil = 0;
  clearDentaphoneBrushContact();
  if (hadBrush) cancelDentaphonePlayQueue();
  updateDentaphoneBrushPresentation();
  setDentaphoneBrushStatus(statusMessage);
  if (announceChange && hadBrush) announce(statusMessage);
  return hadBrush;
}

function prepareDentaphoneBrush() {
  stopDentaphoneBrush({ announceChange: false });
  cancelDentaphoneFoodDrag();
  const hadFood = cancelDentaphoneFood();
  if (hadFood) setDentaphoneChewStatus("Mouth cleared for brushing.");
  cancelDentaphoneChomp();
  cancelDentaphoneOrbit();
  dentaphonePointerTeeth.clear();
  graph?.source.port.postMessage({ type: "silence" });
}

function dentaphoneBrushTravelDirection(routeIndex) {
  const currentId = DENTAPHONE_BRUSH_ROUTE[routeIndex];
  const nextId = DENTAPHONE_BRUSH_ROUTE[(routeIndex + 1) % DENTAPHONE_BRUSH_ROUTE.length];
  const current = dentaphoneToothById(currentId);
  const next = dentaphoneToothById(nextId);
  if (!current || !next || current.arch !== next.arch) return "forward";
  return next.archIndex >= current.archIndex ? "forward" : "backward";
}

function runDentaphoneAutomaticBrush(generation) {
  if (
    generation !== dentaphoneBrushGeneration
    || dentaphoneBrushMode !== "auto"
    || !pageActive
  ) return;
  const routeIndex = dentaphoneBrushRouteIndex % DENTAPHONE_BRUSH_ROUTE.length;
  const toothId = DENTAPHONE_BRUSH_ROUTE[routeIndex];
  const direction = dentaphoneBrushTravelDirection(routeIndex);
  dentaphoneBrushState = "sweeping";
  positionDentaphoneBrushAtTooth(toothId, { direction });
  updateDentaphoneBrushPresentation();
  triggerDentaphoneBrushTooth(toothId, 0.56, { force: true });
  dentaphoneBrushRouteIndex = (routeIndex + 1) % DENTAPHONE_BRUSH_ROUTE.length;
  if (dentaphoneBrushRouteIndex === 0) {
    setDentaphoneBrushStatus("Automatic brush completed both arches and is continuing.");
  }
  dentaphoneBrushTimer = globalThis.setTimeout(
    () => runDentaphoneAutomaticBrush(generation),
    reducedMotion.matches ? DENTAPHONE_REDUCED_BRUSH_STEP_MS : DENTAPHONE_BRUSH_STEP_MS,
  );
}

async function startDentaphoneAutomaticBrush() {
  if (!isDentaphone) return false;
  if (dentaphoneBrushMode === "auto") {
    stopDentaphoneBrush({ statusMessage: "Automatic brush stopped.", announceChange: true });
    return false;
  }
  prepareDentaphoneBrush();
  const generation = ++dentaphoneBrushGeneration;
  dentaphoneBrushMode = "auto";
  dentaphoneBrushState = "starting";
  dentaphoneBrushRouteIndex = 0;
  positionDentaphoneBrushAtTooth(DENTAPHONE_BRUSH_ROUTE[0], { direction: "forward" });
  updateDentaphoneBrushPresentation();
  setDentaphoneBrushStatus("Starting the automatic brush…");
  announce("Starting the automatic toothbrush across both arches.");
  const ready = await ensureAudio();
  if (generation !== dentaphoneBrushGeneration || dentaphoneBrushMode !== "auto") return false;
  if (!ready) {
    stopDentaphoneBrush({
      statusMessage: "The toothbrush could not start because audio is unavailable.",
      announceChange: true,
    });
    return false;
  }
  dentaphoneBrushState = "sweeping";
  setDentaphoneBrushStatus("Automatic brush sweeping back and forth across both arches.");
  updateDentaphoneBrushPresentation();
  runDentaphoneAutomaticBrush(generation);
  return true;
}

function startDentaphoneManualBrush() {
  if (!isDentaphone) return false;
  if (dentaphoneBrushMode === "manual") {
    stopDentaphoneBrush({ statusMessage: "Manual brush parked.", announceChange: true });
    return false;
  }
  prepareDentaphoneBrush();
  dentaphoneBrushGeneration += 1;
  dentaphoneBrushMode = "manual";
  dentaphoneBrushState = "armed";
  positionDentaphoneBrushAtTooth(selectedDentaphoneToothId);
  updateDentaphoneBrushPresentation();
  setDentaphoneBrushStatus("Manual brush armed. Drag the bristles over the teeth.");
  announce("Manual toothbrush armed. Drag over the mouth to scrub and play teeth.");
  return true;
}

function manualDentaphoneBrushSample(sample, { force = false } = {}) {
  positionDentaphoneBrush(sample.clientX, sample.clientY);
  const tooth = dentaphoneToothAtPoint(sample, { preferCoordinates: true });
  if (!tooth) {
    clearDentaphoneBrushContact();
    return false;
  }
  return triggerDentaphoneBrushTooth(
    tooth.dataset.toothId,
    clamp(dentaphonePointerStrength(sample) * 0.76, 0.34, 0.82),
    { clientX: sample.clientX, clientY: sample.clientY, force },
  );
}

function moveDentaphoneManualBrush(event, { force = false } = {}) {
  const pointer = dentaphoneBrushPointer;
  if (!pointer || event.pointerId !== pointer.id) return false;
  event.preventDefault();
  event.stopPropagation();
  const samples = event.getCoalescedEvents?.() ?? [event];
  for (const sample of samples.length ? samples : [event]) {
    const distance = Math.hypot(sample.clientX - pointer.lastX, sample.clientY - pointer.lastY);
    const steps = Math.max(1, Math.ceil(distance / 9));
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      manualDentaphoneBrushSample({
        target: null,
        isTrusted: sample.isTrusted,
        pointerType: sample.pointerType || event.pointerType,
        pressure: sample.pressure ?? event.pressure,
        clientX: pointer.lastX + (sample.clientX - pointer.lastX) * progress,
        clientY: pointer.lastY + (sample.clientY - pointer.lastY) * progress,
      }, { force: force && step === steps });
    }
    pointer.lastX = sample.clientX;
    pointer.lastY = sample.clientY;
  }
  return true;
}

function beginDentaphoneManualBrush(event) {
  if (
    dentaphoneBrushMode !== "manual"
    || dentaphoneBrushPointer
    || event.isPrimary === false
    || (event.pointerType === "mouse" && event.button !== 0)
  ) return false;
  event.preventDefault();
  event.stopPropagation();
  cancelDentaphoneOrbit();
  const artboard = $("dentaphoneArtboard");
  dentaphoneBrushPointer = {
    id: event.pointerId,
    lastX: event.clientX,
    lastY: event.clientY,
  };
  dentaphoneBrushState = "brushing";
  clearDentaphoneBrushContact();
  updateDentaphoneBrushPresentation();
  try { artboard?.setPointerCapture?.(event.pointerId); } catch { /* capture is optional */ }
  manualDentaphoneBrushSample(event, { force: true });
  return true;
}

function finishDentaphoneManualBrush(event, { cancelled = false } = {}) {
  const pointer = dentaphoneBrushPointer;
  if (!pointer || event.pointerId !== pointer.id) return false;
  dentaphoneBrushPointer = null;
  try { $("dentaphoneArtboard")?.releasePointerCapture?.(pointer.id); } catch { /* already released */ }
  clearDentaphoneBrushContact();
  if (dentaphoneBrushMode === "manual") {
    dentaphoneBrushState = "armed";
    updateDentaphoneBrushPresentation();
    if (cancelled) setDentaphoneBrushStatus("Manual brush armed. Drag over the teeth when ready.");
  }
  return true;
}

function isDentaphoneFoodDropPoint(clientX, clientY) {
  const inRect = (bounds) => Boolean(
    bounds
    && bounds.width > 0
    && bounds.height > 0
    && clientX >= bounds.left
    && clientX <= bounds.right
    && clientY >= bounds.top
    && clientY <= bounds.bottom
  );
  const artboardBounds = $("dentaphoneArtboard")?.getBoundingClientRect();
  if (!artboardBounds?.width || !artboardBounds?.height) return false;
  return inRect({
    left: artboardBounds.left + artboardBounds.width * 0.18,
    right: artboardBounds.right - artboardBounds.width * 0.18,
    top: artboardBounds.top + artboardBounds.height * 0.21,
    bottom: artboardBounds.bottom - artboardBounds.height * 0.21,
    width: artboardBounds.width * 0.64,
    height: artboardBounds.height * 0.58,
  });
}

function createDentaphoneFoodDragGhost(pointer) {
  if (pointer.ghost) return pointer.ghost;
  const sourceImage = pointer.button.querySelector("img");
  const ghost = sourceImage?.cloneNode(false) ?? document.createElement("span");
  ghost.className = `dentaphone-food-drag-ghost dentaphone-food-drag-ghost--${pointer.foodId}`;
  ghost.dataset.food = pointer.foodId;
  if (!sourceImage) ghost.textContent = pointer.food.glyph;
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("alt", "");
  ghost.setAttribute("draggable", "false");
  // Inline positioning is a resilient fallback if the decorative stylesheet is late.
  ghost.style.position = "fixed";
  ghost.style.pointerEvents = "none";
  ghost.style.left = `${pointer.lastX}px`;
  ghost.style.top = `${pointer.lastY}px`;
  document.body.append(ghost);
  pointer.ghost = ghost;
  pointer.button.classList.add("is-dragging");
  pointer.button.setAttribute("aria-grabbed", "true");
  setDentaphoneChewStatus(`Dragging ${pointer.food.label}. Release it over the mouth to feed.`);
  return ghost;
}

function moveDentaphoneFoodDrag(event) {
  const pointer = dentaphoneFoodPointer;
  if (!pointer || event.pointerId !== pointer.id) return;
  event.preventDefault();
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
  if (!pointer.moved && Math.hypot(
    event.clientX - pointer.startX,
    event.clientY - pointer.startY,
  ) >= DENTAPHONE_FOOD_DRAG_THRESHOLD_PX) {
    pointer.moved = true;
  }
  if (!pointer.moved) return;
  const ghost = createDentaphoneFoodDragGhost(pointer);
  ghost.style.left = `${event.clientX}px`;
  ghost.style.top = `${event.clientY}px`;
  const overMouth = isDentaphoneFoodDropPoint(event.clientX, event.clientY);
  ghost.classList.toggle("is-over-mouth", overMouth);
  $("dentaphoneArtboard")?.classList.toggle("is-food-drop-target", overMouth);
  const layer = $("dentaphoneFoodLayer");
  if (layer) layer.dataset.dropReady = String(overMouth);
}

function beginDentaphoneFoodDrag(event, button, foodId, food) {
  if (
    dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
    || event.isPrimary === false
    || (event.pointerType === "mouse" && event.button !== 0)
  ) return;
  // On touch, the picture is the drag handle; the label/padding remains a
  // vertical-scroll and tap region in the compact control panel.
  if (event.pointerType === "touch" && !event.target?.closest?.("img")) return;
  event.preventDefault();
  stopDentaphoneBrush({ statusMessage: "Brush parked for food." });
  cancelDentaphoneFoodDrag();
  if (event.pointerType !== "touch") button.focus({ preventScroll: true });
  dentaphoneFoodPointer = {
    id: event.pointerId,
    button,
    foodId,
    food,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
    ghost: null,
  };
  button.setAttribute("aria-grabbed", "true");
  try { button.setPointerCapture?.(event.pointerId); } catch { /* capture is optional */ }
}

function finishDentaphoneFoodDrag(event, { cancelled = false } = {}) {
  const pointer = dentaphoneFoodPointer;
  if (!pointer || event.pointerId !== pointer.id) return;
  event.preventDefault();
  const wasDrag = pointer.moved;
  const accepted = !cancelled && (
    !wasDrag || isDentaphoneFoodDropPoint(event.clientX, event.clientY)
  );
  const { foodId, food } = pointer;
  dentaphoneFoodSuppressClickUntil = performance.now() + 500;
  cancelDentaphoneFoodDrag();
  if (accepted) {
    void feedDentaphoneFood(foodId);
  } else if (wasDrag && !cancelled) {
    setDentaphoneChewStatus(`${food.label} returned. Drop it over the mouth to feed.`);
  } else if (cancelled) {
    setDentaphoneChewStatus(`${food.label} drag cancelled.`);
  }
}

function strikeDentaphoneFoodCluster(cluster, generation) {
  if (
    generation !== dentaphoneFoodGeneration
    || !dentaphoneActiveFood
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
  ) return;
  const teeth = cluster.teeth.map(dentaphoneToothById).filter(Boolean);
  if (!teeth.length) return;
  const voices = ensureDentaphoneFoodVoices(DENTAPHONE_FOOD_VOICE_COUNT);
  if (!voices.length) {
    // A normal Web Audio implementation reaches the independent voice path.
    // This preserves a playable sequence if an implementation rejects extra nodes.
    for (const tooth of teeth) {
      void playDentaphoneTooth(tooth.id, cluster.strength, {
        announceStrike: false,
        scripted: true,
      });
    }
    return;
  }
  for (const tooth of teeth) {
    if (generation !== dentaphoneFoodGeneration || !dentaphoneActiveFood) return;
    const excitationPosition = clamp(
      state.strikePosition * 0.35 + tooth.strikePosition * 0.65,
      0.03,
      0.97,
    );
    const configuration = sanitizePhysicalSoundState(kind, {
      ...state,
      baseFrequencyHz: midiFrequency(tooth.midi),
      strikePosition: excitationPosition,
    }, state);
    const voice = voices[dentaphoneFoodVoiceIndex % voices.length];
    dentaphoneFoodVoiceIndex = (dentaphoneFoodVoiceIndex + 1) % voices.length;
    voice.node.port.postMessage(configurationMessage(configuration));
    voice.node.port.postMessage(excitationDefaults("strike", {
      x: excitationPosition,
      energy: cluster.strength,
    }, configuration));
    flashDentaphoneTooth(tooth.id);
  }
  visual.impactFlash = 1;
  visual.eventType = "chew chord";
}

function beginDentaphoneFoodBite(foodId, food, biteIndex, generation) {
  if (generation !== dentaphoneFoodGeneration || dentaphoneActiveFood !== foodId) return;
  const rig = $("dentaphoneKeyboard");
  const layer = $("dentaphoneFoodLayer");
  const object = layer?.querySelector(".dentaphone-mouth-food, .dentaphone-food-object");
  if (!rig || !object) return;
  const duration = reducedMotion.matches ? DENTAPHONE_REDUCED_CHOMP_MS : DENTAPHONE_CHOMP_MS;
  const impactDelay = reducedMotion.matches ? 45 : Math.round(DENTAPHONE_CHOMP_MS * 0.42);
  const biteNumber = biteIndex + 1;
  rig.classList.remove("is-chomping");
  void rig.offsetWidth;
  rig.classList.add("is-chewing", "is-chomping");
  rig.dataset.chewFood = foodId;
  rig.dataset.chewBite = String(biteNumber);
  layer.dataset.state = "chewing";
  layer.dataset.chewState = "biting";
  object.classList.remove("is-entering");
  object.classList.add("is-chewing");
  object.dataset.state = "biting";
  setDentaphoneChewStatus(`Chewing ${food.label.toLowerCase()}, bite ${biteNumber} of ${food.bites.length}.`);

  scheduleDentaphoneFoodTimer(generation, () => {
    const progress = biteNumber / food.bites.length;
    layer.dataset.bite = String(biteNumber);
    object.dataset.bite = String(biteNumber);
    object.dataset.state = "damaged";
    object.classList.remove("is-bitten");
    void object.offsetWidth;
    object.classList.add("is-bitten");
    object.style.setProperty("--dentaphone-food-scale", Math.max(0.18, 1 - progress * 0.76).toFixed(3));
    object.style.setProperty("--food-damage", progress.toFixed(3));
  }, impactDelay);
  for (const cluster of food.bites[biteIndex]) {
    scheduleDentaphoneFoodTimer(
      generation,
      () => strikeDentaphoneFoodCluster(cluster, generation),
      impactDelay + cluster.delay,
    );
  }
  scheduleDentaphoneFoodTimer(generation, () => {
    rig.classList.remove("is-chomping");
    if (biteNumber < food.bites.length) {
      layer.dataset.chewState = "between-bites";
      object.dataset.state = "waiting";
    }
  }, duration);
}

function finishDentaphoneMeal(foodId, food, generation) {
  if (generation !== dentaphoneFoodGeneration || dentaphoneActiveFood !== foodId) return;
  const rig = $("dentaphoneKeyboard");
  const layer = $("dentaphoneFoodLayer");
  const object = layer?.querySelector(".dentaphone-mouth-food, .dentaphone-food-object");
  rig?.classList.remove("is-chewing", "is-chomping");
  if (rig) {
    delete rig.dataset.chewBite;
    delete rig.dataset.chewFood;
  }
  if (layer) layer.dataset.chewState = "swallowed";
  if (object) {
    object.dataset.state = "swallowed";
    object.classList.remove("is-chewing", "is-entering");
    object.classList.add("is-swallowed");
    object.style.setProperty("--dentaphone-food-scale", "0.04");
    object.style.setProperty("--food-damage", "1");
  }
  if (layer) layer.dataset.state = "swallowed";
  const biteWord = food.bites.length === 1 ? "bite" : "bites";
  setDentaphoneChewStatus(
    `${food.label} swallowed after ${food.bites.length} ${biteWord}.`,
  );
  setDentaphoneFoodButtonPresentation();
  scheduleDentaphoneFoodTimer(generation, () => {
    object?.remove();
    if (layer) {
      delete layer.dataset.activeFood;
      delete layer.dataset.bite;
      layer.dataset.state = "empty";
      layer.dataset.chewState = "empty";
    }
    dentaphoneActiveFood = null;
  }, reducedMotion.matches ? 80 : 280);
}

async function feedDentaphoneFood(foodId) {
  if (
    !isDentaphone
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
  ) return;
  const food = DENTAPHONE_FOODS[foodId];
  if (!food || !$("dentaphoneKeyboard") || !$("dentaphoneFoodLayer")) return;
  stopDentaphoneBrush({ statusMessage: "Brush parked while the mouth eats." });
  cancelDentaphoneFoodDrag();
  cancelDentaphoneChomp();
  cancelDentaphoneFood();
  // Meals and manual playing use exclusive voice groups. This leaves
  // deterministic headroom for a coherent four-tooth bite chord.
  graph?.source.port.postMessage({ type: "silence" });
  const generation = dentaphoneFoodGeneration;
  dentaphoneActiveFood = foodId;
  renderDentaphoneFood(foodId, food);
  setDentaphoneFoodButtonPresentation(foodId);
  setDentaphoneChewStatus(`${food.label} is in the mouth. Preparing to chew.`);
  const presentedAt = performance.now();

  // Audio starts under the feed gesture. Waiting before the first visible bite
  // keeps every impact aligned even on a cold AudioWorklet startup.
  const ready = await ensureAudio();
  if (
    generation !== dentaphoneFoodGeneration
    || dentaphoneActiveFood !== foodId
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
  ) return;
  if (!ready) {
    cancelDentaphoneFood({ statusMessage: `${food.label} could not be chewed because audio is unavailable.` });
    return;
  }
  activateDentaphoneFoodVoices(
    ensureDentaphoneFoodVoices(DENTAPHONE_FOOD_VOICE_COUNT),
    DENTAPHONE_FOOD_VOICE_GAIN,
  );
  const cycle = reducedMotion.matches ? DENTAPHONE_REDUCED_CHEW_CYCLE_MS : DENTAPHONE_CHEW_CYCLE_MS;
  const entryDuration = reducedMotion.matches ? 80 : 340;
  const entryDelay = Math.max(0, entryDuration - (performance.now() - presentedAt));
  food.bites.forEach((_, biteIndex) => {
    scheduleDentaphoneFoodTimer(
      generation,
      () => beginDentaphoneFoodBite(foodId, food, biteIndex, generation),
      entryDelay + biteIndex * cycle,
    );
  });
  const duration = reducedMotion.matches ? DENTAPHONE_REDUCED_CHOMP_MS : DENTAPHONE_CHOMP_MS;
  scheduleDentaphoneFoodTimer(
    generation,
    () => finishDentaphoneMeal(foodId, food, generation),
    entryDelay + (food.bites.length - 1) * cycle + duration + 90,
  );
}

function cancelDentaphoneChomp() {
  if (!isDentaphone) return;
  dentaphoneChompGeneration += 1;
  globalThis.clearTimeout(dentaphoneChompEndTimer);
  dentaphoneChompEndTimer = 0;
  dentaphonePendingChompContact = null;
  silenceDentaphoneFoodVoices();
  const rig = $("dentaphoneKeyboard");
  rig?.classList.remove("is-chomping");
  if (rig) {
    delete rig.dataset.chompKind;
    delete rig.dataset.chompGeneration;
    delete rig.dataset.chompId;
  }
  const button = $("dentaphoneChomp");
  button?.classList.remove("is-active");
  button?.setAttribute("aria-pressed", "false");
}

function strikeDentaphoneEmptyChomp(event) {
  const rig = $("dentaphoneKeyboard");
  const eventGeneration = Number(event.detail?.chompGeneration);
  const pendingContact = dentaphonePendingChompContact;
  if (
    !isDentaphone
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
    || !rig?.classList.contains("is-chomping")
    || rig.dataset.chompKind !== "empty"
    || dentaphoneActiveFood
    || pendingContact === null
    || eventGeneration !== pendingContact.generation
    || eventGeneration !== dentaphoneChompGeneration
  ) return false;

  // Claim this contact before posting any messages. A duplicate renderer frame
  // can never create a second 32-note strike.
  dentaphonePendingChompContact = null;
  if (
    pendingContact.strikes.length !== DENTAPHONE_CHOMP_VOICE_COUNT
    || pendingContact.strikes.some(({ voice }) => voice.failed || voice.context !== graph?.context)
  ) {
    cancelDentaphoneChomp();
    announce("The full-mouth chomp could not start all 32 tooth voices.");
    return false;
  }

  for (const { configuration, excitationPosition, voice } of pendingContact.strikes) {
    voice.node.port.postMessage(excitationDefaults("strike", {
      x: excitationPosition,
      energy: 1.02,
    }, configuration));
  }
  flashDentaphoneTeeth(dentaphonePitchMap.map(({ id }) => id));
  visual.impactFlash = 1;
  visual.eventType = "full-mouth chomp";
  announce("All 32 teeth struck together.");
  return true;
}

async function chompDentaphone() {
  if (
    !isDentaphone
    || !$("dentaphoneKeyboard")
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
  ) return false;
  stopDentaphoneBrush({ statusMessage: "Brush parked for a manual chomp." });
  if (dentaphoneActiveFood) {
    cancelDentaphoneFood({ statusMessage: "Food cleared for a manual chomp." });
  }
  cancelDentaphoneChomp();
  const generation = dentaphoneChompGeneration;
  const rig = $("dentaphoneKeyboard");
  const button = $("dentaphoneChomp");
  const duration = reducedMotion.matches ? DENTAPHONE_REDUCED_CHOMP_MS : DENTAPHONE_CHOMP_MS;
  graph?.source.port.postMessage({ type: "silence" });
  const ready = await ensureAudio({ syncConfiguration: false });
  if (
    generation !== dentaphoneChompGeneration
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
    || !ready
  ) return false;
  const voices = ensureDentaphoneFoodVoices(DENTAPHONE_CHOMP_VOICE_COUNT);
  if (
    generation !== dentaphoneChompGeneration
    || dentaphoneViewMode !== "3d"
    || voices.length !== DENTAPHONE_CHOMP_VOICE_COUNT
  ) {
    silenceDentaphoneFoodVoices();
    if (generation === dentaphoneChompGeneration) {
      announce("The full-mouth chomp could not start all 32 tooth voices.");
    }
    return false;
  }
  graph?.source.port.postMessage({ type: "silence" });
  activateDentaphoneFoodVoices(voices, DENTAPHONE_CHOMP_VOICE_GAIN);
  const strikes = dentaphonePitchMap.map((tooth, index) => {
    const excitationPosition = clamp(
      state.strikePosition * 0.35 + tooth.strikePosition * 0.65,
      0.03,
      0.97,
    );
    const configuration = sanitizePhysicalSoundState(kind, {
      ...state,
      baseFrequencyHz: midiFrequency(tooth.midi),
      strikePosition: excitationPosition,
    }, state);
    const voice = voices[index];
    voice.node.port.postMessage(configurationMessage(configuration));
    return { configuration, excitationPosition, tooth, voice };
  });
  dentaphonePendingChompContact = { generation, strikes };
  rig.dataset.chompKind = "empty";
  rig.dataset.chompGeneration = String(generation);
  rig.dataset.chompId = `${generation}-${Math.round(performance.now())}`;
  void rig.offsetWidth;
  rig.classList.add("is-chomping");
  button?.classList.add("is-active");
  button?.setAttribute("aria-pressed", "true");
  dentaphoneChompEndTimer = globalThis.setTimeout(() => {
    if (generation !== dentaphoneChompGeneration) return;
    rig.classList.remove("is-chomping");
    delete rig.dataset.chompKind;
    delete rig.dataset.chompGeneration;
    delete rig.dataset.chompId;
    dentaphonePendingChompContact = null;
    button?.classList.remove("is-active");
    button?.setAttribute("aria-pressed", "false");
    dentaphoneChompEndTimer = 0;
  }, duration);
  announce("Full-mouth Dentaphone chomp.");
  return true;
}

function resetDentaphoneView({ announceChange = true } = {}) {
  if (!isDentaphone) return;
  stopDentaphoneBrush({ statusMessage: "Brush parked." });
  cancelDentaphoneFoodDrag();
  const hadFood = cancelDentaphoneFood();
  if (hadFood) setDentaphoneChewStatus("Mouth empty. Choose something else to eat.");
  cancelDentaphoneChomp();
  graph?.source.port.postMessage({ type: "silence" });
  setDentaphoneView(DENTAPHONE_DEFAULT_VIEW);
  if (announceChange) announce("Dentaphone view reset.");
}

function resetDentaphoneOrientation() {
  if (
    !isDentaphone
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
  ) return;
  cancelDentaphoneOrbit();
  setDentaphoneView({
    yaw: DENTAPHONE_DEFAULT_VIEW.yaw,
    pitch: DENTAPHONE_DEFAULT_VIEW.pitch,
  });
  announce("3D view centered.");
}

function beginDentaphoneOrbit(event) {
  if (
    !isDentaphone
    || dentaphoneViewMode !== "3d"
    || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
    || dentaphoneViewPointer
    || event.isPrimary === false
  ) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (event.target?.closest?.(".dentaphone-tooth")) return;
  event.preventDefault();
  const artboard = $("dentaphoneArtboard");
  dentaphoneViewPointer = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    yaw: dentaphoneView.yaw,
    pitch: dentaphoneView.pitch,
    moved: false,
  };
  try { artboard?.setPointerCapture?.(event.pointerId); } catch { /* capture is optional */ }
  $("stageWrap")?.classList.add("is-rotating");
}

function moveDentaphoneOrbit(event) {
  const pointer = dentaphoneViewPointer;
  if (!pointer || event.pointerId !== pointer.id) return;
  event.preventDefault();
  const deltaX = event.clientX - pointer.startX;
  const deltaY = event.clientY - pointer.startY;
  if (Math.hypot(deltaX, deltaY) > 3) pointer.moved = true;
  setDentaphoneView({
    yaw: pointer.yaw + deltaX * 0.09,
    pitch: pointer.pitch - deltaY * 0.075,
  });
}

function endDentaphoneOrbit(event, { announceChange = true } = {}) {
  const pointer = dentaphoneViewPointer;
  if (!pointer || event.pointerId !== pointer.id) return;
  const artboard = $("dentaphoneArtboard");
  try { artboard?.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  dentaphoneViewPointer = null;
  $("stageWrap")?.classList.remove("is-rotating");
  if (announceChange && pointer.moved) {
    const yaw = dentaphoneAngleLabel(dentaphoneView.yaw, "left", "right", "centered");
    const pitch = dentaphoneAngleLabel(dentaphoneView.pitch, "down", "up", "level");
    announce(`3D view ${yaw}, ${pitch}.`);
  }
}

function cancelDentaphoneOrbit() {
  if (!dentaphoneViewPointer) return;
  endDentaphoneOrbit({ pointerId: dentaphoneViewPointer.id }, { announceChange: false });
}

async function playDentaphoneTooth(
  id,
  strength = 0.78,
  { focus = false, announceStrike = true, scripted = false } = {},
) {
  if (!scripted) {
    if (
      dentaphonePendingChompContact !== null
      || $("dentaphoneKeyboard")?.classList.contains("is-chomping")
    ) cancelDentaphoneChomp();
    if (dentaphoneBrushMode === "auto") {
      stopDentaphoneBrush({ statusMessage: "Automatic brush stopped for direct tooth play." });
    }
    if (dentaphoneActiveFood) {
      cancelDentaphoneFood({ statusMessage: "Chewing stopped for manual tooth play." });
    } else {
      silenceDentaphoneFoodVoices();
    }
  }
  const tooth = selectDentaphoneTooth(id, { focus });
  if (!tooth) return;
  lastPlayedNote = tooth.midi;
  // The panel control remains a playable bias, while every pictured tooth
  // contributes its own modal excitation point and therefore its own color.
  const excitationPosition = clamp(state.strikePosition * 0.35 + tooth.strikePosition * 0.65, 0.03, 0.97);
  const configuration = sanitizePhysicalSoundState(kind, {
    ...state,
    strikePosition: excitationPosition,
  }, state);
  flashDentaphoneTooth(tooth.id);
  const point = {
    x: excitationPosition,
    visualX: tooth.x,
    visualY: tooth.y,
    energy: clamp(strength, 0.18, 1.2),
  };
  const material = currentMaterialName();
  const playGeneration = dentaphonePlayGeneration;
  dentaphonePlayQueue = dentaphonePlayQueue
    .catch(() => {})
    .then(async () => {
      if (playGeneration !== dentaphonePlayGeneration) return;
      await excite("strike", point, {
        configuration,
        isCurrent: () => playGeneration === dentaphonePlayGeneration,
        announceExcitation: announceStrike,
      });
      if (playGeneration !== dentaphonePlayGeneration) return;
      if (announceStrike) {
        announce(`${tooth.note}, ${tooth.arch} ${tooth.anatomicalName.toLowerCase()}, ${material}.`);
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, DENTAPHONE_STRIKE_INTERVAL_MS));
    });
  return dentaphonePlayQueue;
}

function dentaphonePointerStrength(event) {
  const pressure = Number(event.pressure);
  if (Number.isFinite(pressure) && pressure > 0) return clamp(0.28 + pressure * 1.25, 0.34, 1.2);
  return event.pointerType === "mouse" ? 0.82 : 0.72;
}

function handleDentaphoneToothKey(event, toothId) {
  const tooth = dentaphoneToothById(toothId);
  if (!tooth) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) {
      if (dentaphoneBrushMode === "manual") {
        positionDentaphoneBrushAtTooth(tooth.id);
        triggerDentaphoneBrushTooth(tooth.id, 0.64, { force: true });
      } else {
        void playDentaphoneTooth(tooth.id, 0.82);
      }
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (dentaphoneBrushMode !== "off") {
      stopDentaphoneBrush({ statusMessage: "Brush parked.", announceChange: true });
      return;
    }
    cancelDentaphonePlayQueue();
    graph?.source.port.postMessage({ type: "silence" });
    announce("Dentaphone silenced.");
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  let targetArch = tooth.arch;
  let targetIndex = tooth.archIndex;
  if (event.key === "ArrowLeft") targetIndex = Math.max(0, targetIndex - 1);
  else if (event.key === "ArrowRight") targetIndex = Math.min(15, targetIndex + 1);
  else if (event.key === "Home") targetIndex = 0;
  else if (event.key === "End") targetIndex = 15;
  else if (event.key === "ArrowUp") targetArch = "upper";
  else if (event.key === "ArrowDown") targetArch = "lower";
  selectDentaphoneTooth(`${targetArch}-${String(targetIndex + 1).padStart(2, "0")}`, { focus: true });
}

function dentaphoneToothAtPoint(event, { preferCoordinates = false } = {}) {
  const direct = preferCoordinates ? null : event.target?.closest?.(".dentaphone-tooth");
  // Keyboard and synthetic button activation should always preserve the exact
  // semantic tooth. Trusted 3D pointers use the depth-aware mesh raycast.
  if (direct && event.isTrusted === false) return direct;
  if (dentaphoneViewMode === "3d" && dentaphoneWebGLModule?.dentaphoneWebGLIsReady()) {
    const toothId = dentaphoneWebGLModule.dentaphoneWebGLToothAtPoint(
      event.clientX,
      event.clientY,
    );
    return toothId ? root.querySelector(`[data-tooth-id="${toothId}"]`) : null;
  }
  if (direct) return direct;
  const stackedHits = document.elementsFromPoint?.(event.clientX, event.clientY);
  const hits = stackedHits ?? [document.elementFromPoint?.(event.clientX, event.clientY)].filter(Boolean);
  const candidates = [];
  const seen = new Set();
  for (const hit of hits) {
    const tooth = hit?.closest?.(".dentaphone-tooth");
    if (tooth && !seen.has(tooth)) {
      seen.add(tooth);
      candidates.push(tooth);
    }
  }
  if (candidates.length) {
    return candidates.reduce((nearest, tooth) => {
      const bounds = tooth.getBoundingClientRect();
      const distance = Math.hypot(
        event.clientX - (bounds.left + bounds.right) * 0.5,
        event.clientY - (bounds.top + bounds.bottom) * 0.5,
      );
      return !nearest || distance < nearest.distance ? { tooth, distance } : nearest;
    }, null)?.tooth ?? null;
  }
  if (direct) return direct;

  let nearest = null;
  for (const tooth of root.querySelectorAll(".dentaphone-tooth")) {
    const bounds = tooth.getBoundingClientRect();
    const distance = Math.hypot(
      event.clientX - (bounds.left + bounds.right) * 0.5,
      event.clientY - (bounds.top + bounds.bottom) * 0.5,
    );
    if (distance <= DENTAPHONE_HIT_PROXIMITY_PX && (!nearest || distance < nearest.distance)) {
      nearest = { tooth, distance };
    }
  }
  return nearest?.tooth ?? null;
}

function dragAcrossDentaphone(event) {
  const previous = dentaphonePointerTeeth.get(event.pointerId);
  if (!previous) return;
  const target = dentaphoneToothAtPoint(event, { preferCoordinates: true });
  const toothId = target?.dataset.toothId;
  if (!toothId || toothId === previous) return;
  dentaphonePointerTeeth.set(event.pointerId, toothId);
  void playDentaphoneTooth(toothId, dentaphonePointerStrength(event));
}

function handleDentaphoneSurfacePointerDown(event) {
  if (dentaphoneBrushMode === "manual") {
    beginDentaphoneManualBrush(event);
    return;
  }
  const tooth = dentaphoneToothAtPoint(event);
  if (!tooth) {
    beginDentaphoneOrbit(event);
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const artboard = $("dentaphoneArtboard");
  try { artboard?.setPointerCapture?.(event.pointerId); } catch { /* capture is optional */ }
  dentaphonePointerTeeth.set(event.pointerId, tooth.dataset.toothId);
  void playDentaphoneTooth(
    tooth.dataset.toothId,
    dentaphonePointerStrength(event),
    { focus: true },
  );
}

function handleDentaphoneSurfacePointerMove(event) {
  if (dentaphoneBrushPointer?.id === event.pointerId) moveDentaphoneManualBrush(event);
  else if (dentaphoneBrushMode === "manual") {
    if (event.pointerType === "mouse") positionDentaphoneBrush(event.clientX, event.clientY);
  }
  else if (dentaphonePointerTeeth.has(event.pointerId)) dragAcrossDentaphone(event);
  else moveDentaphoneOrbit(event);
}

function updateDentaphoneHover(event) {
  if (
    dentaphoneBrushMode === "manual"
    || event.pointerType === "touch"
    || dentaphonePointerTeeth.has(event.pointerId)
  ) return;
  const tooth = dentaphoneToothAtPoint(event, { preferCoordinates: true });
  for (const button of root.querySelectorAll(".dentaphone-tooth.is-hovered")) {
    if (button !== tooth) button.classList.remove("is-hovered");
  }
  tooth?.classList.add("is-hovered");
}

function clearDentaphoneHover() {
  for (const button of root.querySelectorAll(".dentaphone-tooth.is-hovered")) {
    button.classList.remove("is-hovered");
  }
}

function positionDentaphoneImageTooth(button, tooth) {
  if (!button || !tooth) return;
  button.style.setProperty("--tooth-x", `${(tooth.x * 100).toFixed(3)}%`);
  button.style.setProperty("--tooth-y", `${(tooth.y * 100).toFixed(3)}%`);
  button.style.setProperty("--tooth-width", `${tooth.width}%`);
  button.style.setProperty("--tooth-height", `${tooth.height}%`);
  button.style.setProperty("--tooth-angle", `${tooth.rotation.toFixed(2)}deg`);
  button.style.setProperty("--tooth-counter-angle", `${(-tooth.rotation).toFixed(2)}deg`);
  button.style.removeProperty("z-index");
  button.removeAttribute("data-webgl-hidden");
}

function restoreDentaphoneImageToothLayout() {
  if (!isDentaphone) return;
  for (const tooth of DENTAPHONE_TEETH) {
    positionDentaphoneImageTooth(
      root.querySelector(`[data-tooth-id="${tooth.id}"]`),
      tooth,
    );
  }
}

function createDentaphoneKeyboard() {
  if (!isDentaphone || !$("dentaphoneKeyboard")) return;
  dentaphonePitchMap = buildDentaphonePitchMap(dentaphonePitchState);
  const keyboard = $("dentaphoneKeyboard");
  const archTargets = new Map(
    [...keyboard.querySelectorAll("[data-dentaphone-arch]")]
      .map((target) => [target.dataset.dentaphoneArch, target]),
  );
  const buttons = DENTAPHONE_TEETH.map((tooth) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dentaphone-tooth dentaphone-tooth--${tooth.type}`;
    button.dataset.toothId = tooth.id;
    button.dataset.arch = tooth.arch;
    button.dataset.archIndex = String(tooth.archIndex);
    button.dataset.toothType = tooth.type;
    button.dataset.toothNumber = String(tooth.universalNumber);
    button.dataset.effectPosition = tooth.strikePosition.toFixed(4);
    positionDentaphoneImageTooth(button, tooth);
    const performanceShortcut = tooth.arch === "lower" && tooth.archIndex < 8
      ? ` ${Object.keys(DENTAPHONE_KEY_INDEX)[tooth.archIndex].replace("Key", "")}`
      : "";
    button.setAttribute(
      "aria-keyshortcuts",
      `Enter Space ArrowLeft ArrowRight ArrowUp ArrowDown Home End Escape${performanceShortcut}`,
    );

    const crown = document.createElement("span");
    crown.className = "dentaphone-tooth-crown";
    crown.setAttribute("aria-hidden", "true");
    const note = document.createElement("span");
    note.className = "dentaphone-tooth-note";
    note.setAttribute("aria-hidden", "true");
    const number = document.createElement("span");
    number.className = "dentaphone-tooth-number";
    number.textContent = String(tooth.universalNumber);
    number.setAttribute("aria-hidden", "true");
    button.append(crown, note, number);

    button.addEventListener("focus", () => selectDentaphoneTooth(tooth.id));
    button.addEventListener("click", (event) => {
      if (event.detail === 0) void playDentaphoneTooth(tooth.id, 0.82);
    });
    button.addEventListener("keydown", (event) => handleDentaphoneToothKey(event, tooth.id));
    return button;
  });
  for (const [arch, target] of archTargets) {
    target.replaceChildren(...buttons.filter((button) => button.dataset.arch === arch));
  }
  state = dentaphoneStateForTooth(state, dentaphoneToothById(selectedDentaphoneToothId));
  updateDentaphoneKeyboardPresentation();
}

function rebuildDentaphonePitchMap({ announceChange = true } = {}) {
  if (!isDentaphone) return;
  cancelDentaphonePlayQueue();
  dentaphonePitchState = sanitizeDentaphonePitchState({
    layout: $("pitchLayout")?.value,
    root: $("rootPitch")?.value,
    octave: $("pitchOctave")?.value,
  }, dentaphonePitchState);
  dentaphonePitchMap = buildDentaphonePitchMap(dentaphonePitchState);
  const tooth = dentaphoneToothById(selectedDentaphoneToothId);
  state = dentaphoneStateForTooth(state, tooth);
  postConfiguration();
  updateControlPresentation();
  if (announceChange) {
    const label = $("pitchLayout")?.selectedOptions?.[0]?.textContent ?? "Pitch map";
    announce(`${label} loaded. Upper ${dentaphonePitchRange(dentaphonePitchMap, "upper")}; lower ${dentaphonePitchRange(dentaphonePitchMap, "lower")}.`);
  }
}

function bindDentaphoneFoodControls() {
  if (!isDentaphone) return;
  for (const button of root.querySelectorAll(".dentaphone-food-button[data-dentaphone-food]")) {
    const foodId = button.dataset.dentaphoneFood;
    const food = DENTAPHONE_FOODS[foodId];
    if (!food) {
      button.disabled = true;
      continue;
    }
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-grabbed", "false");
    button.addEventListener("pointerdown", (event) => beginDentaphoneFoodDrag(event, button, foodId, food));
    button.addEventListener("pointermove", moveDentaphoneFoodDrag);
    button.addEventListener("pointerup", (event) => finishDentaphoneFoodDrag(event));
    button.addEventListener("pointercancel", (event) => finishDentaphoneFoodDrag(event, { cancelled: true }));
    button.addEventListener("lostpointercapture", (event) => {
      if (dentaphoneFoodPointer?.id === event.pointerId) {
        finishDentaphoneFoodDrag(event, { cancelled: true });
      }
    });
    button.addEventListener("click", (event) => {
      if (performance.now() < dentaphoneFoodSuppressClickUntil) {
        event.preventDefault();
        return;
      }
      void feedDentaphoneFood(foodId);
    });
  }
  // Pointer capture normally keeps the button as the target. Window listeners
  // are the fallback for older touch implementations that reject capture.
  globalThis.addEventListener("pointermove", moveDentaphoneFoodDrag);
  globalThis.addEventListener("pointerup", (event) => finishDentaphoneFoodDrag(event));
  globalThis.addEventListener("pointercancel", (event) => {
    finishDentaphoneFoodDrag(event, { cancelled: true });
  });
  $("dentaphoneClearFood")?.addEventListener("click", () => clearDentaphoneFood());
  if (!$("dentaphoneChewStatus")?.textContent?.trim()) {
    setDentaphoneChewStatus("Mouth empty. Tap food to feed, or drag it into the mouth.");
  }
}

function bindDentaphoneControls() {
  if (!isDentaphone) return;
  const viewTabs = [...root.querySelectorAll("[data-dentaphone-view-tab]")];
  for (const [index, tab] of viewTabs.entries()) {
    tab.addEventListener("click", () => {
      void setDentaphoneViewMode(tab.dataset.dentaphoneViewTab);
    });
    tab.addEventListener("keydown", (event) => {
      let targetIndex = null;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) targetIndex = (index - 1 + viewTabs.length) % viewTabs.length;
      else if (["ArrowRight", "ArrowDown"].includes(event.key)) targetIndex = (index + 1) % viewTabs.length;
      else if (event.key === "Home") targetIndex = 0;
      else if (event.key === "End") targetIndex = viewTabs.length - 1;
      if (targetIndex === null) return;
      event.preventDefault();
      viewTabs[targetIndex].focus();
      void setDentaphoneViewMode(viewTabs[targetIndex].dataset.dentaphoneViewTab);
    });
  }
  for (const control of root.querySelectorAll("[data-dentaphone-pitch]")) {
    control.addEventListener("change", () => rebuildDentaphonePitchMap());
  }
  for (const control of root.querySelectorAll("[data-dentaphone-view]")) {
    const key = control.dataset.dentaphoneView;
    control.addEventListener("input", () => {
      if (
        dentaphoneViewMode !== "3d"
        || !dentaphoneWebGLModule?.dentaphoneWebGLIsReady()
      ) {
        updateDentaphoneViewPresentation();
        return;
      }
      if (key === "open") {
        if (dentaphoneActiveFood) {
          cancelDentaphoneFood({ statusMessage: "Food cleared while the jaw was adjusted." });
        }
        cancelDentaphoneChomp();
      }
      setDentaphoneView({ [key]: Number(control.value) });
    });
    control.addEventListener("change", () => {
      if (key === "open") announce(`Jaw ${Math.round(dentaphoneView.open * 100)}% open.`);
      else {
        const yaw = dentaphoneAngleLabel(dentaphoneView.yaw, "left", "right", "centered");
        const pitch = dentaphoneAngleLabel(dentaphoneView.pitch, "down", "up", "level");
        announce(`3D view ${yaw}, ${pitch}.`);
      }
    });
  }
  $("dentaphoneChomp")?.addEventListener("click", chompDentaphone);
  $("dentaphoneResetView")?.addEventListener("click", resetDentaphoneOrientation);
  $("dentaphoneBrushAuto")?.addEventListener("click", () => {
    void startDentaphoneAutomaticBrush();
  });
  $("dentaphoneBrushManual")?.addEventListener("click", startDentaphoneManualBrush);
  $("dentaphoneBrushStop")?.addEventListener("click", () => {
    stopDentaphoneBrush({ statusMessage: "Brush parked.", announceChange: true });
  });
  $("dentaphone3dRetry")?.addEventListener("click", () => {
    resetDentaphoneWebGLLoadState();
    void setDentaphoneViewMode("3d");
  });
  const artboard = $("dentaphoneArtboard");
  artboard?.addEventListener("pointerdown", handleDentaphoneSurfacePointerDown, { capture: true });
  artboard?.addEventListener("pointermove", handleDentaphoneSurfacePointerMove, { capture: true });
  artboard?.addEventListener("pointermove", updateDentaphoneHover);
  artboard?.addEventListener("pointerup", (event) => {
    if (!finishDentaphoneManualBrush(event)) endDentaphoneOrbit(event);
  });
  artboard?.addEventListener("pointercancel", (event) => {
    if (!finishDentaphoneManualBrush(event, { cancelled: true })) {
      endDentaphoneOrbit(event, { announceChange: false });
    }
  });
  artboard?.addEventListener("lostpointercapture", (event) => {
    if (!finishDentaphoneManualBrush(event, { cancelled: true })) {
      endDentaphoneOrbit(event, { announceChange: false });
    }
  });
  artboard?.addEventListener("pointerleave", clearDentaphoneHover);
  artboard?.addEventListener("dentaphone-webgl-chomp-contact", strikeDentaphoneEmptyChomp);
  artboard?.addEventListener("dentaphone-webgl-context-lost", () => {
    if (dentaphoneViewMode !== "3d") return;
    void setDentaphoneViewMode("2d", { announceChange: false });
    const message = "The 3D graphics context stopped. The 2D instrument still works.";
    setDentaphone3dStatus("error", message);
    announce(`${message} Use Retry 3D to try again.`);
  });
  const clearPointer = (event) => {
    finishDentaphoneManualBrush(event, { cancelled: event.type !== "pointerup" });
    const toothId = dentaphonePointerTeeth.get(event.pointerId);
    dentaphonePointerTeeth.delete(event.pointerId);
    try { artboard?.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    if (toothId) {
      root.querySelector(`[data-tooth-id="${toothId}"]`)?.focus({ preventScroll: true });
    }
  };
  globalThis.addEventListener("pointerup", clearPointer);
  globalThis.addEventListener("pointercancel", clearPointer);
  bindDentaphoneFoodControls();
  updateDentaphoneBrushPresentation();
  if (!$("dentaphoneBrushStatus")?.textContent?.trim()) {
    setDentaphoneBrushStatus("Brush parked.");
  }
  updateDentaphoneViewModePresentation();
}

function modalBuildOptions(configuration = state) {
  return {
    sampleRate: 48_000,
    maxModes: 64,
    ...(isDentaphone
      ? { fundamentalOverrideHz: configuration.baseFrequencyHz }
      : {}),
  };
}

function configurationMessage(configuration = state) {
  return {
    type: "configure",
    configuration,
    ...(isDentaphone
      ? { fundamentalOverrideHz: configuration.baseFrequencyHz }
      : {}),
  };
}

function syncModalReadout(bank = customBank, configuration = state) {
  const snapshot = bank ?? buildPhysicalModalBank(
    kind,
    configuration,
    modalBuildOptions(configuration),
  );
  telemetry.modeCount = snapshot.modeCount;
  telemetry.fundamentalHz = snapshot.fundamentalHz;
}

function postConfiguration() {
  if (customBank) {
    customBank = buildPhysicalModalBank(kind, state, modalBuildOptions());
  }
  syncModalReadout();
  graph?.source.port.postMessage(configurationMessage());
}

function setParameters(values) {
  cancelDentaphonePlayQueue();
  state = sanitizePhysicalSoundState(kind, { ...state, ...values }, state);
  postConfiguration();
  updateControlPresentation();
}

function setParameter(key, value) {
  setParameters({ [key]: value });
}

function tuneToFrequency(targetHz) {
  const target = clamp(targetHz, 20, 4_000);
  if (kind !== "airflow-objects") {
    setParameter("baseFrequencyHz", target * (isDentaphone ? 1 : state.size));
    return;
  }
  state = tuneAirflowStateToFrequency(state, target);
  postConfiguration();
  updateControlPresentation();
}

function applyPreset(id, { announceChange = true } = {}) {
  cancelDentaphonePlayQueue();
  const preset = physicalSoundPreset(kind, id);
  if (!preset) return;
  state = sanitizePhysicalSoundState(kind, {
    ...state,
    ...presetSettings(preset),
    presetId: preset.id ?? id,
  }, state);
  customBank = null;
  customBankName = "";
  if (isDentaphone) {
    state = dentaphoneStateForTooth(state, dentaphoneToothById(selectedDentaphoneToothId));
  }
  postConfiguration();
  updateControlPresentation();
  if (announceChange) announce(`${preset.label ?? id} physical model loaded.`);
}

function setAudioPresentation(status, detail = "") {
  const button = $("audioButton");
  if (button) {
    button.setAttribute("aria-pressed", String(status === "on"));
    button.classList.toggle("is-on", status === "on");
    button.disabled = status === "starting";
  }
  if ($("audioState")) $("audioState").textContent = detail || status;
  updateStageReadout();
}

async function createAudioGraph() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser does not provide Web Audio.");
  const context = new AudioContextClass({ latencyHint: "interactive", sampleRate: 48_000 });
  let releaseOutput = null;
  try {
    await context.audioWorklet.addModule(
      new URL("./src/physical-sounds-processor.js?v=9c3153a0b49a", import.meta.url),
    );
    const source = new AudioWorkletNode(context, "morphazoid-physical-sounds", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: {
        kind,
        configuration: state,
        ...(isDentaphone ? { fundamentalOverrideHz: state.baseFrequencyHz } : {}),
      },
    });
    const makeup = context.createGain();
    makeup.gain.value = OUTPUT_MAKEUP_GAIN;
    const master = context.createGain();
    master.gain.value = clamp($("level")?.value ?? 0.36, 0, 1);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.62;
    source.connect(makeup);
    makeup.connect(master);
    master.connect(analyser);
    releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
    source.port.onmessage = (event) => {
      if (event.data?.type === "telemetry") {
        telemetry = { ...telemetry, ...event.data };
        updateStageReadout();
      } else if (event.data?.type === "custom-bank-loaded") {
        telemetry.modeCount = event.data.modeCount;
        announce(`Custom modal body loaded with ${event.data.modeCount} modes.`);
      }
    };
    source.onprocessorerror = () => {
      source.onprocessorerror = null;
      audioDesiredOn = false;
      audioGeneration += 1;
      endAllGates();
      discardDentaphoneFoodVoices();
      releaseOutput?.();
      releaseOutput = null;
      void context.close();
      if (graph?.source === source) graph = null;
      setAudioPresentation("error", "processor stopped");
      announce("The physical model stopped unexpectedly. Audio can be restarted.");
    };
    return { context, source, makeup, master, analyser, releaseOutput };
  } catch (error) {
    releaseOutput?.();
    try { await context.close(); } catch { /* Preserve the startup error. */ }
    throw error;
  }
}

async function ensureAudio({ syncConfiguration = true } = {}) {
  const generation = audioGeneration;
  audioDesiredOn = true;
  if (!graph) {
    if (!audioStartupPromise) {
      setAudioPresentation("starting");
      audioStartupPromise = createAudioGraph()
        .then((created) => {
          if (!pageActive || !audioDesiredOn) {
            created.releaseOutput?.();
            void created.context.close();
            return null;
          }
          graph = created;
          return graph;
        })
        .catch((error) => {
          console.error(error);
          audioDesiredOn = false;
          setAudioPresentation("error", "unavailable");
          announce(error?.message || "Unable to start the physical model.");
          return null;
        })
        .finally(() => { audioStartupPromise = null; });
    }
    await audioStartupPromise;
  }
  if (!graph || !audioDesiredOn || generation !== audioGeneration || !pageActive) return false;
  try {
    await graph.context.resume();
  } catch (error) {
    if (generation !== audioGeneration) return false;
    console.error(error);
    audioDesiredOn = false;
    setAudioPresentation("error", "unavailable");
    announce(error?.message || "Unable to resume the physical model.");
    return false;
  }
  if (!audioDesiredOn || generation !== audioGeneration || !pageActive) {
    if (graph.context.state === "running") {
      try { await graph.context.suspend(); } catch { /* The graph is already inactive. */ }
    }
    return false;
  }
  if (syncConfiguration) postConfiguration();
  setAudioPresentation("on");
  return true;
}

async function disableAudio() {
  audioDesiredOn = false;
  audioGeneration += 1;
  endAllGates();
  graph?.source.port.postMessage({ type: "silence" });
  if (graph?.context.state === "running") await graph.context.suspend();
  setAudioPresentation("off");
}

async function toggleAudio() {
  if (audioDesiredOn && graph?.context.state === "running") await disableAudio();
  else await ensureAudio();
}

function excitationDefaults(action = "strike", point = null, sourceState = state) {
  const position = point?.x ?? sourceState.strikePosition ?? sourceState.bowPosition ?? 0.5;
  const velocity = clamp(
    point?.energy ?? (pointerEnergy || 1),
    0.05,
    1.3,
  );
  const eventType = action === "strike"
    ? "strike"
    : ["bounce", "shatter", "crumple", "roll", "scrape"].includes(action)
      ? action
      : sourceState.eventType ?? "strike";
  return {
    type: "excite",
    eventType,
    strength: velocity,
    position: clamp(position),
    hardness: clamp(sourceState.hardness ?? sourceState.brightness ?? 0.55),
  };
}

async function excite(
  action = "strike",
  point = null,
  { configuration = null, isCurrent = null, announceExcitation = true } = {},
) {
  if (isCurrent && !isCurrent()) return;
  if (!(await ensureAudio({ syncConfiguration: !configuration }))) return;
  if (isCurrent && !isCurrent()) return;
  if (configuration) graph.source.port.postMessage(configurationMessage(configuration));
  graph.source.port.postMessage(excitationDefaults(action, point, configuration ?? state));
  visual.impactFlash = 1;
  visual.eventType = ["bounce", "shatter", "crumple", "roll", "scrape"].includes(action)
    ? action
    : action === "strike" ? "single strike" : state.eventType ?? action;
  if (!isDentaphone) {
    visual.ripples.push({
      x: point?.visualX ?? point?.x ?? state.strikePosition ?? 0.5,
      y: point?.visualY ?? 0.52,
      age: 0,
      strength: point?.energy ?? 0.8,
    });
    if (visual.ripples.length > 20) visual.ripples.shift();
  }
  if (action === "shatter") seedFragments(point?.x ?? 0.5, 18);
  else if (action === "crumple") seedFragments(point?.x ?? 0.5, 8);
  if (announceExcitation) {
    announce(`${String(visual.eventType).replaceAll("-", " ")} excitation.`);
  }
}

async function beginGate(action, strength = 0.8, point = null, owner = DEFAULT_GATE_OWNER) {
  if (!HOLD_ACTIONS.has(action)) return false;
  const owners = gateOwners.get(action) ?? new Set();
  owners.add(owner);
  gateOwners.set(action, owners);
  gateOwnerGestures.set(owner, {
    strength: clamp(strength, 0.05, 1.5),
    deliveredAt: null,
  });
  root.dataset.activeAction = action;
  if (reducedMotion.matches) startAnimation();
  for (const button of root.querySelectorAll(`[data-action="${action}"]`)) {
    button.setAttribute("aria-pressed", "true");
  }
  if (!(await ensureAudio())) {
    endGate(action, owner);
    return false;
  }
  if (!gateOwners.get(action)?.has(owner)) return false;
  graph.source.port.postMessage({
    type: "gate",
    action,
    active: true,
    strength: clamp(strength, 0.05, 1.5),
    position: point?.x ?? state.bowPosition ?? 0.5,
    hardness: state.roughness ?? state.rosin ?? state.turbulence ?? 0.5,
  });
  const gesture = gateOwnerGestures.get(owner);
  if (gesture) gesture.deliveredAt = performance.now();
  return true;
}

function endGate(action, owner = null, { audition = false } = {}) {
  if (!action) return;
  const owners = gateOwners.get(action);
  const gesture = owner === null ? null : gateOwnerGestures.get(owner);
  const deliveredFor = Number.isFinite(gesture?.deliveredAt)
    ? performance.now() - gesture.deliveredAt
    : 0;
  const needsAudition = Boolean(
    audition
    && gesture
    && (!Number.isFinite(gesture.deliveredAt) || deliveredFor < MINIMUM_UI_GATE_MS),
  );
  if (owner === null) {
    for (const activeOwner of owners ?? []) gateOwnerGestures.delete(activeOwner);
    owners?.clear();
  } else {
    gateOwnerGestures.delete(owner);
    owners?.delete(owner);
  }
  if (owners?.size) return;
  gateOwners.delete(action);
  if (root.dataset.activeAction === action) root.dataset.activeAction = "";
  if (reducedMotion.matches) startAnimation();
  for (const button of root.querySelectorAll(`[data-action="${action}"]`)) {
    button.setAttribute("aria-pressed", "false");
  }
  graph?.source.port.postMessage({ type: "gate", action, active: false });
  if (needsAudition && pageActive && audioDesiredOn) {
    void pulseGate(action, gesture.strength, UI_TAP_PULSE_MS);
  }
}

function endAllGates() {
  cancelDentaphonePlayQueue();
  const stoppedBrush = stopDentaphoneBrush({ statusMessage: "Brush parked." });
  const cancelledFoodDrag = cancelDentaphoneFoodDrag();
  const cancelledFood = cancelDentaphoneFood();
  if (cancelledFood || cancelledFoodDrag) {
    setDentaphoneChewStatus("Chewing stopped. Mouth empty.");
  }
  cancelDentaphoneChomp();
  cancelDentaphoneOrbit();
  for (const action of HOLD_ACTIONS) endGate(action);
  heldPitches.clear();
  dentaphonePointerTeeth.clear();
  activePointer = null;
  pointerPrevious = null;
  return stoppedBrush || cancelledFood || cancelledFoodDrag;
}

async function pulseGate(action, strength = 0.72, durationMs = UI_TAP_PULSE_MS) {
  const owner = Symbol("gate-pulse");
  if (await beginGate(action, strength, null, owner)) {
    globalThis.setTimeout(() => endGate(action, owner), durationMs);
  }
}

function holdPitch(owner, note) {
  heldPitches.delete(owner);
  heldPitches.set(owner, note);
  lastPlayedNote = note;
  tuneToFrequency(midiFrequency(note));
}

function nearestDentaphoneTooth(note) {
  if (!dentaphonePitchMap.length) return null;
  return dentaphonePitchMap.reduce((best, tooth) => (
    Math.abs(tooth.midi - note) < Math.abs(best.midi - note) ? tooth : best
  ));
}

function releasePitch(owner) {
  const latestOwner = [...heldPitches.keys()].at(-1);
  heldPitches.delete(owner);
  if (latestOwner !== owner || heldPitches.size === 0) return;
  lastPlayedNote = [...heldPitches.values()].at(-1);
  tuneToFrequency(midiFrequency(lastPlayedNote));
}

function midiNoteOwner(detail, message) {
  const source = detail?.sourceId ?? message?.sourceId ?? "default";
  const channel = Math.round(clamp(message?.channel, 0, 15));
  const note = Math.round(clamp(message?.note, 0, 127));
  return `midi:${source}:${channel}:${note}`;
}

async function loadModalJson() {
  cancelDentaphonePlayQueue();
  const textarea = $("modalJson");
  if (!textarea) return;
  try {
    const decoded = JSON.parse(textarea.value);
    const decodedModeCount = Number(decoded?.modeCount);
    const decodedModes = Array.isArray(decoded) ? decoded : decoded?.modes;
    const requestedModes = Number.isFinite(decodedModeCount)
      ? decodedModeCount
      : Array.isArray(decodedModes) ? decodedModes.length : 0;
    const candidateState = sanitizePhysicalSoundState(kind, {
      ...state,
      modalJson: textarea.value,
      modeCount: requestedModes,
    }, state);
    const candidateBank = buildPhysicalModalBank(kind, candidateState, {
      ...modalBuildOptions(candidateState),
    });
    if (candidateBank.source !== "custom") {
      throw new Error("Expected at least one mode with finite positive ratio and decay plus a finite gain.");
    }
    state = sanitizePhysicalSoundState(kind, {
      ...candidateState,
      modeCount: candidateBank.modeCount,
    }, candidateState);
    customBank = buildPhysicalModalBank(kind, state, modalBuildOptions());
    customBankName = customBank.name || "Custom modal body";
    postConfiguration();
    updateControlPresentation();
    announce(`Loaded ${customBank.modeCount} custom mode${customBank.modeCount === 1 ? "" : "s"}.`);
  } catch (error) {
    announce(`Modal JSON was not loaded: ${error.message}`);
  }
}

async function copyModalJson() {
  const json = serializePhysicalModalJson(state);
  if ($("modalJson")) $("modalJson").value = json;
  try {
    await navigator.clipboard.writeText(json);
    announce("Modal body JSON copied.");
  } catch {
    $("modalJson")?.select();
    announce("Modal JSON selected; copy it from the editor.");
  }
}

function resetAll() {
  if (isDentaphone) {
    endAllGates();
    graph?.source.port.postMessage({ type: "silence" });
  } else {
    cancelDentaphonePlayQueue();
  }
  const preset = presetList()[0];
  state = sanitizePhysicalSoundState(kind, {
    ...(definition?.defaults ?? {}),
    ...presetSettings(preset),
    presetId: preset?.id ?? definition?.defaults?.presetId,
  });
  customBank = null;
  customBankName = "";
  if (isDentaphone) {
    dentaphonePitchState = DENTAPHONE_DEFAULT_PITCH_STATE;
    if ($("pitchLayout")) $("pitchLayout").value = dentaphonePitchState.layout;
    if ($("rootPitch")) $("rootPitch").value = String(dentaphonePitchState.root);
    if ($("pitchOctave")) $("pitchOctave").value = String(dentaphonePitchState.octave);
    dentaphonePitchMap = buildDentaphonePitchMap(dentaphonePitchState);
    selectedDentaphoneToothId = "lower-01";
    state = dentaphoneStateForTooth(state, dentaphoneToothById(selectedDentaphoneToothId));
    resetDentaphoneView({ announceChange: false });
  }
  postConfiguration();
  updateControlPresentation();
  announce(`${isDentaphone ? "Dentaphone" : definition?.label ?? "Physical model"} reset.`);
}

function primaryAction() {
  if (kind === "particle-cabinet") return "shake";
  if (kind === "impact-ecology") return state.eventType ?? "bounce";
  if (kind === "object-forge") return "strike";
  if (kind === "bowed-things") return "bow";
  return "gust";
}

function actionForButton(button) {
  return button?.dataset.action ?? "";
}

function bindControls() {
  $("audioButton")?.addEventListener("click", () => { void toggleAudio(); });
  $("level")?.addEventListener("input", (event) => {
    const level = clamp(event.target.value, 0, 1);
    if (graph) graph.master.gain.setTargetAtTime(level, graph.context.currentTime, 0.015);
    if ($("levelOut")) $("levelOut").textContent = `${Math.round(level * 100)}%`;
    event.target.setAttribute("aria-valuetext", `${Math.round(level * 100)}%`);
  });
  $("preset")?.addEventListener("change", (event) => applyPreset(event.target.value));
  for (const control of root.querySelectorAll("[data-param]")) {
    control.addEventListener("input", () => setParameter(control.dataset.param, valueFromControl(control)));
    if (control.tagName === "SELECT") {
      control.addEventListener("change", () => setParameter(control.dataset.param, valueFromControl(control)));
    }
  }

  for (const button of root.querySelectorAll("[data-action]")) {
    const action = actionForButton(button);
    if (HOLD_ACTIONS.has(action)) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        void beginGate(action, 1, null, `button:${action}:pointer:${event.pointerId}`);
      });
      const release = (event, audition) => {
        event.preventDefault();
        endGate(action, `button:${action}:pointer:${event.pointerId}`, { audition });
        try { button.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
      };
      button.addEventListener("pointerup", (event) => release(event, true));
      button.addEventListener("pointercancel", (event) => release(event, false));
      button.addEventListener("lostpointercapture", (event) => release(event, false));
      button.addEventListener("keydown", (event) => {
        if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
          event.preventDefault();
          void beginGate(action, 1, null, `button:${action}:key:${event.code}`);
        }
      });
      button.addEventListener("keyup", (event) => {
        if (event.code === "Space" || event.code === "Enter") {
          endGate(action, `button:${action}:key:${event.code}`);
        }
      });
      button.addEventListener("click", (event) => {
        if (event.detail === 0) void pulseGate(action, 1, UI_TAP_PULSE_MS);
      });
      continue;
    }
    button.addEventListener("click", () => {
      if (action === "reset" || action === "reset-all") resetAll();
      else if (action === "stop" || action === "silence") {
        endAllGates();
        graph?.source.port.postMessage({ type: "silence" });
        announce("Physical model silenced.");
      } else if (action === "load-modal-json" || action === "loadModalJson") void loadModalJson();
      else if (action === "copy-modal-json" || action === "copyModalJson") void copyModalJson();
      else if (isDentaphone && (action === "strike" || action === "trigger")) {
        void playDentaphoneTooth(selectedDentaphoneToothId, action === "trigger" ? 0.34 : 0.92);
      }
      else if (action === "trigger") {
        const primary = primaryAction();
        if (HOLD_ACTIONS.has(primary)) void pulseGate(primary);
        else void excite(primary, {
          x: state.strikePosition ?? 0.5,
          energy: kind === "object-forge" ? 0.34 : 1,
        });
      }
      else void excite(action || "strike");
    });
  }

  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointermove", handleCanvasPointerMove);
  canvas.addEventListener("pointerup", handleCanvasPointerUp);
  canvas.addEventListener("pointercancel", handleCanvasPointerCancel);
  canvas.addEventListener("lostpointercapture", handleCanvasPointerCancel);
  canvas.addEventListener("keydown", handleCanvasKey);
  canvas.addEventListener("keyup", handleCanvasKey);

  document.addEventListener("keydown", handleDocumentKeyDown);
  document.addEventListener("keyup", handleDocumentKeyUp);
  globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
  globalThis.addEventListener("blur", endAllGates);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) endAllGates();
  });
  bindDentaphoneControls();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)),
    y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height)),
    time: performance.now(),
    energy: clamp(0.12 + (1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height))) * 1.08, 0.12, 1.2),
  };
}

function airflowGestureParameters(point) {
  const [minimumAir, maximumAir] = PHYSICAL_SOUND_LIMITS[kind].airSpeed;
  const airSpeed = minimumAir + point.x * (maximumAir - minimumAir);
  if (state.airflowMode === "aeolian") {
    const [minimumDiameter, maximumDiameter] = PHYSICAL_SOUND_LIMITS[kind].diameter;
    return {
      airSpeed,
      diameter: minimumDiameter * (maximumDiameter / minimumDiameter) ** point.y,
    };
  }
  const [minimumAperture, maximumAperture] = PHYSICAL_SOUND_LIMITS[kind].aperture;
  return {
    airSpeed,
    aperture: minimumAperture + (1 - point.y) * (maximumAperture - minimumAperture),
  };
}

function handleCanvasPointerDown(event) {
  event.preventDefault();
  const point = canvasPoint(event);
  activePointer = event.pointerId;
  pointerPrevious = point;
  pointerEnergy = 0.65;
  lastPointerExcitationAt = point.time;
  canvas.setPointerCapture?.(event.pointerId);
  const pointerOwner = `canvas:pointer:${event.pointerId}`;
  if (kind === "particle-cabinet") void beginGate("shake", 0.72, point, pointerOwner);
  else if (kind === "bowed-things") {
    setParameter("bowPosition", point.x);
    void beginGate("bow", 0.75, point, pointerOwner);
  } else if (kind === "airflow-objects") {
    const values = airflowGestureParameters(point);
    const maximumAir = PHYSICAL_SOUND_LIMITS[kind].airSpeed[1];
    setParameters(values);
    void beginGate("gust", 0.18 + values.airSpeed / maximumAir, point, pointerOwner);
  } else {
    setParameters({
      strikePosition: point.x,
      ...(kind === "impact-ecology" ? { hardness: clamp(1 - point.y) } : {}),
    });
    void excite(kind === "impact-ecology" ? state.eventType : "strike", point);
  }
}

function handleCanvasPointerMove(event) {
  if (event.pointerId !== activePointer || !pointerPrevious) return;
  const point = canvasPoint(event);
  const elapsed = Math.max(8, point.time - pointerPrevious.time);
  const dx = point.x - pointerPrevious.x;
  const dy = point.y - pointerPrevious.y;
  pointerEnergy = clamp(Math.hypot(dx, dy) * 680 / elapsed, 0.08, 1.25);
  if (kind === "particle-cabinet") {
    graph?.source.port.postMessage({ type: "gate", action: "shake", active: true, strength: pointerEnergy, position: point.x });
  } else if (kind === "bowed-things") {
    setParameters({
      bowVelocity: clamp(Math.abs(dx) * 900 / elapsed, 0.02, 1),
      bowPressure: clamp(1 - point.y, 0.02, 1),
      bowPosition: point.x,
    });
    visual.bowVelocity = dx / (elapsed / 1000);
  } else if (kind === "airflow-objects") {
    const values = airflowGestureParameters(point);
    const maximumAir = PHYSICAL_SOUND_LIMITS[kind].airSpeed[1];
    setParameters(values);
    graph?.source.port.postMessage({
      type: "gate",
      action: "gust",
      active: true,
      strength: clamp(0.18 + values.airSpeed / maximumAir, 0.18, 1.18),
      position: point.x,
    });
  } else if (kind === "impact-ecology" || kind === "object-forge") {
    const changes = { strikePosition: point.x };
    if (kind === "impact-ecology") changes.hardness = clamp(1 - point.y);
    setParameters(changes);
    if (point.time - lastPointerExcitationAt >= 65) {
      void excite(kind === "impact-ecology" ? state.eventType : "strike", point);
      lastPointerExcitationAt = point.time;
    }
  }
  pointerPrevious = point;
}

function handleCanvasPointerUp(event) {
  if (event.pointerId !== activePointer) return;
  endGate(primaryAction(), `canvas:pointer:${event.pointerId}`, { audition: true });
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  activePointer = null;
  pointerPrevious = null;
}

function handleCanvasPointerCancel(event) {
  if (event.pointerId !== activePointer) return;
  endGate(primaryAction(), `canvas:pointer:${event.pointerId}`);
  activePointer = null;
  pointerPrevious = null;
}

function handleCanvasKey(event) {
  if (!["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  if (kind === "particle-cabinet" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Enter" || event.key === " ") {
    const action = primaryAction();
    const owner = `canvas:key:${event.code}`;
    if (event.type === "keydown" && !event.repeat) {
      if (HOLD_ACTIONS.has(action)) {
        void beginGate(action, 1, null, owner);
      } else void excite(action);
    } else if (event.type === "keyup" && HOLD_ACTIONS.has(action)) {
      endGate(action, owner);
    }
    return;
  }
  if (event.type !== "keydown") return;
  const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  const vertical = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  if (kind === "impact-ecology") {
    setParameters({
      strikePosition: clamp(state.strikePosition + horizontal * 0.04),
      hardness: clamp(state.hardness + vertical * 0.05),
    });
  } else if (kind === "object-forge") {
    setParameters({
      strikePosition: clamp(state.strikePosition + horizontal * 0.04),
      energy: clamp(state.energy + vertical * 0.05),
    });
  } else if (kind === "bowed-things") {
    setParameters({
      bowPosition: clamp(state.bowPosition + horizontal * 0.04),
      bowPressure: clamp(state.bowPressure + vertical * 0.05),
    });
  } else if (kind === "airflow-objects") {
    const [minimum, maximum] = PHYSICAL_SOUND_LIMITS[kind].airSpeed;
    const values = { airSpeed: clamp(state.airSpeed + horizontal * 2, minimum, maximum) };
    if (state.airflowMode === "aeolian") {
      const [minimumDiameter, maximumDiameter] = PHYSICAL_SOUND_LIMITS[kind].diameter;
      values.diameter = clamp(
        state.diameter * 2 ** (-vertical / 12),
        minimumDiameter,
        maximumDiameter,
      );
    } else {
      const [minimumAperture, maximumAperture] = PHYSICAL_SOUND_LIMITS[kind].aperture;
      values.aperture = clamp(
        state.aperture + vertical * 0.04,
        minimumAperture,
        maximumAperture,
      );
    }
    setParameters(values);
  } else if (kind === "particle-cabinet") {
    setParameter("energy", clamp(state.energy + vertical * 0.05));
  }
}

function targetIsEditable(target) {
  if (isDentaphone && target?.closest?.(".dentaphone-tooth")) return false;
  return target?.matches?.("input, select, textarea, button, [contenteditable='true']");
}

function handleDocumentKeyDown(event) {
  if (isDentaphone && event.key === "Escape" && dentaphoneBrushMode !== "off") {
    event.preventDefault();
    stopDentaphoneBrush({ statusMessage: "Brush parked.", announceChange: true });
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || targetIsEditable(event.target)) return;
  const note = NOTE_KEYS[event.code];
  if (isDentaphone && note !== undefined) {
    event.preventDefault();
    if (event.repeat) return;
    const tooth = dentaphonePitchMap.find(({ arch, archIndex }) => (
      arch === "lower" && archIndex === DENTAPHONE_KEY_INDEX[event.code]
    ));
    if (tooth) {
      void playDentaphoneTooth(tooth.id, 0.78, {
        focus: Boolean(event.target?.closest?.(".dentaphone-tooth")),
      });
    }
    return;
  }
  if (note !== undefined && ["object-forge", "bowed-things", "airflow-objects"].includes(kind)) {
    event.preventDefault();
    if (event.repeat) return;
    const owner = `computer:key:${event.code}`;
    holdPitch(owner, note);
    const action = primaryAction();
    if (HOLD_ACTIONS.has(action)) {
      void beginGate(action, 0.78, null, owner);
    } else void excite(action);
    return;
  }
  if (event.code !== "Space") return;
  event.preventDefault();
  if (event.repeat) return;
  const action = primaryAction();
  if (HOLD_ACTIONS.has(action)) {
    void beginGate(action, 1, null, "computer:key:Space");
  } else void excite(action);
}

function handleDocumentKeyUp(event) {
  const note = NOTE_KEYS[event.code];
  if (isDentaphone && note !== undefined) return;
  if (note !== undefined) {
    const owner = `computer:key:${event.code}`;
    releasePitch(owner);
    if (HOLD_ACTIONS.has(primaryAction())) endGate(primaryAction(), owner);
  } else if (event.code === "Space" && HOLD_ACTIONS.has(primaryAction())) {
    endGate(primaryAction(), "computer:key:Space");
  }
}

function handleMidiInput(event) {
  const detail = event.detail ?? {};
  const { routeId, message } = detail;
  if (routeId !== kind || !message) return;
  const owner = midiNoteOwner(detail, message);
  if (message.type === "noteOn") {
    event.preventDefault();
    const velocity = clamp((Number(message.velocity) || 100) / 127, 0.04, 1);
    if (isDentaphone) {
      const tooth = nearestDentaphoneTooth(Number(message.note));
      if (tooth) {
        void playDentaphoneTooth(tooth.id, velocity, {
          focus: Boolean(document.activeElement?.closest?.(".dentaphone-tooth")),
        });
      }
      return;
    }
    if (["object-forge", "bowed-things", "airflow-objects"].includes(kind)) {
      holdPitch(owner, Number(message.note));
    }
    const action = primaryAction();
    if (HOLD_ACTIONS.has(action)) void beginGate(action, velocity, null, owner);
    else void excite(action, { x: state.strikePosition ?? 0.5, energy: velocity });
  } else if (message.type === "noteOff") {
    event.preventDefault();
    if (isDentaphone) return;
    releasePitch(owner);
    if (HOLD_ACTIONS.has(primaryAction())) endGate(primaryAction(), owner);
  } else if (message.type === "pitchBend" && "baseFrequencyHz" in state) {
    event.preventDefault();
    const bend = clamp(message.normalized, -1, 1);
    tuneToFrequency(midiFrequency(lastPlayedNote) * (2 ** (bend * 2 / 12)));
  } else if (message.type === "pitchBend" && kind === "airflow-objects") {
    event.preventDefault();
    const bend = clamp(message.normalized, -1, 1);
    tuneToFrequency(midiFrequency(lastPlayedNote) * (2 ** (bend * 2 / 12)));
  }
}

function seedFragments(center, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / Math.max(1, count)) * Math.PI * 1.6 + Math.PI * 0.7;
    const speed = 0.12 + Math.random() * 0.36;
    visual.fragments.push({
      x: center,
      y: 0.48,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.22,
      spin: Math.random() * Math.PI,
      age: 0,
      size: 0.008 + Math.random() * 0.02,
    });
  }
  if (visual.fragments.length > 80) visual.fragments.splice(0, visual.fragments.length - 80);
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(320, Math.round(bounds.width * ratio));
  const height = Math.max(260, Math.round(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function stageContext() {
  resizeCanvas();
  const context = canvas.getContext("2d");
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return {
    context,
    width: canvas.width / ratio,
    height: canvas.height / ratio,
  };
}

function drawBackdrop(context, width, height) {
  const gradient = context.createRadialGradient(width * 0.5, height * 0.42, 8, width * 0.5, height * 0.5, width * 0.75);
  gradient.addColorStop(0, "rgba(28, 39, 44, .98)");
  gradient.addColorStop(0.55, "rgba(8, 13, 16, .98)");
  gradient.addColorStop(1, "#040607");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(255,255,255,.045)";
  context.lineWidth = 1;
  const spacing = Math.max(24, Math.min(width, height) / 12);
  for (let x = spacing; x < width; x += spacing) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = spacing; y < height; y += spacing) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
}

function ensureParticles(count) {
  const requested = Math.min(128, Math.max(6, Math.round(Math.sqrt(count) * 5)));
  while (visual.particles.length < requested) {
    const index = visual.particles.length;
    visual.particles.push({
      x: 0.18 + ((index * 0.61803398875) % 1) * 0.64,
      y: 0.2 + ((index * 0.41421356237) % 1) * 0.58,
      vx: 0,
      vy: 0,
    });
  }
  visual.particles.length = requested;
}

function drawParticleCabinet(context, width, height, dt) {
  ensureParticles(state.objectCount);
  const left = width * 0.14;
  const top = height * 0.14;
  const bodyWidth = width * 0.72;
  const bodyHeight = height * 0.68;
  const active = root.dataset.activeAction === "shake" ? 1 : telemetry.activity;
  context.save();
  context.translate(Math.sin(visualTime * 22) * active * 5, Math.cos(visualTime * 17) * active * 3);
  context.fillStyle = "rgba(83, 255, 196, .055)";
  context.strokeStyle = "rgba(83, 255, 196, .78)";
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(left, top, bodyWidth, bodyHeight, 24);
  context.fill(); context.stroke();
  const radius = 2.5 + state.particleSize * 7;
  for (const particle of visual.particles) {
    particle.vx += (Math.sin(visualTime * 19 + particle.y * 8) * active * 0.65) * dt;
    particle.vy += (state.gravity * 0.48 + Math.cos(visualTime * 23 + particle.x * 9) * active * 0.5) * dt;
    particle.vx *= Math.exp(-dt * (1.8 + state.damping * 5));
    particle.vy *= Math.exp(-dt * (1.2 + state.damping * 4));
    particle.x += particle.vx;
    particle.y += particle.vy;
    if (particle.x < 0.04 || particle.x > 0.96) { particle.x = clamp(particle.x, 0.04, 0.96); particle.vx *= -0.82; }
    if (particle.y < 0.05 || particle.y > 0.95) { particle.y = clamp(particle.y, 0.05, 0.95); particle.vy *= -0.72; }
    const x = left + particle.x * bodyWidth;
    const y = top + particle.y * bodyHeight;
    context.fillStyle = `rgba(255, ${150 + Math.round(state.brightness * 90)}, 92, ${0.55 + active * 0.35})`;
    context.beginPath(); context.arc(x, y, radius, 0, TWO_PI); context.fill();
  }
  context.restore();
}

const TWO_PI = Math.PI * 2;

function drawImpactEcology(context, width, height, dt) {
  const ground = height * 0.79;
  const progress = (visualTime * (0.8 + state.restitution)) % 1;
  const bounceHeight = Math.abs(Math.sin(progress * Math.PI)) * height * 0.42 * (0.3 + state.restitution * 0.7);
  context.strokeStyle = "rgba(255, 222, 96, .78)";
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(width * 0.1, ground); context.lineTo(width * 0.9, ground); context.stroke();
  if (visual.eventType === "bounce" || state.eventType === "bounce") {
    context.fillStyle = "rgba(255, 101, 79, .9)";
    context.beginPath();
    context.arc(width * (state.strikePosition ?? 0.5), ground - 18 - bounceHeight, 13 + state.size * 22, 0, TWO_PI);
    context.fill();
  } else {
    context.strokeStyle = "rgba(255, 101, 79, .88)";
    context.lineWidth = 2;
    const centerX = width * (state.strikePosition ?? 0.5);
    const centerY = height * 0.45;
    for (let spoke = 0; spoke < 16; spoke += 1) {
      const angle = spoke / 16 * TWO_PI + Math.sin(spoke * 31.7) * state.chaos;
      const length = (35 + (spoke % 5) * 18) * (0.6 + state.size);
      context.beginPath(); context.moveTo(centerX, centerY);
      context.lineTo(centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length); context.stroke();
    }
  }
  for (const fragment of visual.fragments) {
    fragment.age += dt;
    fragment.vy += dt * 0.55;
    fragment.x += fragment.vx * dt;
    fragment.y += fragment.vy * dt;
    context.save();
    context.translate(fragment.x * width, fragment.y * height);
    context.rotate(fragment.spin + fragment.age * 2);
    context.fillStyle = `rgba(255, 205, 100, ${Math.max(0, 1 - fragment.age * 0.7)})`;
    context.fillRect(-fragment.size * width, -fragment.size * width, fragment.size * width * 2, fragment.size * width * 2);
    context.restore();
  }
  visual.fragments = visual.fragments.filter((fragment) => fragment.age < 1.45);
}

function drawObjectForge(context, width, height) {
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const objectWidth = width * (0.38 + state.size * 0.34);
  const objectHeight = height * (0.12 + (1 - state.stiffness) * 0.18);
  const label = String(state.presetId);
  context.fillStyle = `rgba(${110 + state.brightness * 120}, ${145 + state.stiffness * 90}, 208, .12)`;
  context.strokeStyle = "rgba(123, 219, 255, .92)";
  context.lineWidth = 3;
  context.beginPath();
  if (/bowl|bell|glass/.test(label)) {
    context.ellipse(centerX, centerY, objectWidth * 0.42, objectHeight * 1.3, 0, 0, TWO_PI);
  } else if (/plate|ceramic/.test(label)) {
    context.ellipse(centerX, centerY, objectWidth * 0.5, objectHeight * 1.55, 0, 0, TWO_PI);
  } else {
    context.roundRect(centerX - objectWidth * 0.5, centerY - objectHeight * 0.5, objectWidth, objectHeight, objectHeight * 0.28);
  }
  context.fill(); context.stroke();
  const modes = Math.min(18, telemetry.modeCount || state.modeCount || 12);
  for (let index = 1; index <= modes; index += 1) {
    const x = centerX - objectWidth * 0.5 + objectWidth * index / (modes + 1);
    context.strokeStyle = `rgba(255, 211, 91, ${0.08 + (index % 3) * 0.06})`;
    context.beginPath(); context.moveTo(x, centerY - objectHeight * 0.48); context.lineTo(x, centerY + objectHeight * 0.48); context.stroke();
  }
  context.fillStyle = "#ff6757";
  context.beginPath(); context.arc(centerX - objectWidth * 0.5 + objectWidth * state.strikePosition, centerY, 7 + visual.impactFlash * 9, 0, TWO_PI); context.fill();
  context.fillStyle = "#ffe07d";
  context.beginPath(); context.arc(centerX - objectWidth * 0.5 + objectWidth * state.pickupPosition, centerY - objectHeight * 0.7, 5, 0, TWO_PI); context.fill();
}

function drawBowedThings(context, width, height) {
  const centerY = height * 0.52;
  const left = width * 0.12;
  const right = width * 0.88;
  const amplitude = 3 + telemetry.activity * 18;
  context.strokeStyle = "rgba(125, 222, 255, .92)";
  context.lineWidth = 5 + state.size * 7;
  context.beginPath();
  for (let index = 0; index <= 100; index += 1) {
    const x = left + (right - left) * index / 100;
    const envelope = Math.sin(Math.PI * index / 100);
    const y = centerY + Math.sin(index * 0.24 + visualTime * state.baseFrequencyHz / state.size * 0.08) * amplitude * envelope;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  const bowX = left + (right - left) * state.bowPosition;
  visual.bowOffset += visual.bowVelocity * 0.002;
  visual.bowVelocity *= 0.93;
  context.save();
  context.translate(bowX, centerY);
  context.rotate(-0.16 + Math.sin(visualTime * 3) * 0.04);
  context.strokeStyle = root.dataset.activeAction === "bow" ? "#ff6657" : "rgba(255, 206, 91, .72)";
  context.lineWidth = 4;
  context.beginPath(); context.moveTo(-width * 0.2, -28); context.lineTo(width * 0.2, 28); context.stroke();
  context.strokeStyle = "rgba(255,255,255,.74)";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(-width * 0.2, -23); context.lineTo(width * 0.2, 33); context.stroke();
  context.restore();
}

function ensureAirSeeds() {
  while (visual.airSeeds.length < 72) {
    const index = visual.airSeeds.length;
    visual.airSeeds.push({
      x: (index * 0.61803398875) % 1,
      y: 0.14 + ((index * 0.41421356237) % 1) * 0.72,
      phase: index * 0.73,
    });
  }
}

function drawAirflowObjects(context, width, height, dt) {
  ensureAirSeeds();
  const speed = 0.04 + state.airSpeed * 0.006;
  const active = root.dataset.activeAction === "gust" ? 1 : telemetry.activity;
  const objectX = width * 0.58;
  const objectY = height * 0.5;
  for (const seed of visual.airSeeds) {
    seed.x += speed * dt * (0.4 + active * 0.9);
    if (seed.x > 1.05) seed.x = -0.05;
    const dx = seed.x * width - objectX;
    const wake = Math.exp(-Math.abs(dx) / (width * 0.2)) * state.turbulence;
    const y = seed.y * height + Math.sin(seed.phase + visualTime * 5 + dx * 0.035) * wake * 34;
    context.strokeStyle = `rgba(109, 226, 255, ${0.08 + active * 0.28})`;
    context.beginPath(); context.moveTo(seed.x * width - 15, y); context.lineTo(seed.x * width + 15, y); context.stroke();
  }
  context.fillStyle = "rgba(255, 102, 87, .15)";
  context.strokeStyle = "rgba(255, 164, 91, .95)";
  context.lineWidth = 3;
  if (state.airflowMode === "aeolian") {
    context.beginPath(); context.arc(objectX, objectY, 5 + state.diameter * width * 0.35, 0, TWO_PI); context.fill(); context.stroke();
  } else if (state.airflowMode === "bottle") {
    const bottleWidth = 36 + state.diameter * width * 0.3;
    const bottleHeight = 90 + state.cavityDepth * height * 0.5;
    context.beginPath();
    context.moveTo(objectX - bottleWidth * 0.18, objectY - bottleHeight * 0.5);
    context.lineTo(objectX + bottleWidth * 0.18, objectY - bottleHeight * 0.5);
    context.lineTo(objectX + bottleWidth * 0.28, objectY - bottleHeight * 0.3);
    context.lineTo(objectX + bottleWidth * 0.5, objectY + bottleHeight * 0.5);
    context.lineTo(objectX - bottleWidth * 0.5, objectY + bottleHeight * 0.5);
    context.lineTo(objectX - bottleWidth * 0.28, objectY - bottleHeight * 0.3);
    context.closePath(); context.fill(); context.stroke();
  } else {
    const cavityWidth = width * (0.14 + state.aperture * 0.25);
    const cavityHeight = height * (0.08 + state.cavityDepth * 0.45);
    context.strokeRect(objectX - cavityWidth * 0.5, objectY - cavityHeight * 0.5, cavityWidth, cavityHeight);
    context.fillRect(objectX - cavityWidth * 0.5, objectY - cavityHeight * 0.5, cavityWidth, cavityHeight);
  }
  const vortexCount = 5;
  for (let index = 0; index < vortexCount; index += 1) {
    const progress = (visualTime * speed * 0.5 + index / vortexCount) % 1;
    const x = objectX + progress * width * 0.36;
    const y = objectY + Math.sin(progress * TWO_PI * 2) * 32 * state.turbulence;
    context.strokeStyle = `rgba(255, 218, 105, ${0.55 * (1 - progress)})`;
    context.beginPath(); context.arc(x, y, 5 + progress * 18, 0, TWO_PI); context.stroke();
  }
}

function drawRipples(context, width, height, dt) {
  for (const ripple of visual.ripples) {
    ripple.age += dt;
    const radius = ripple.age * Math.min(width, height) * 0.48;
    context.strokeStyle = `rgba(255, 225, 116, ${Math.max(0, 0.72 - ripple.age)})`;
    context.lineWidth = 2;
    context.beginPath(); context.arc(ripple.x * width, (ripple.y ?? 0.52) * height, radius, 0, TWO_PI); context.stroke();
  }
  visual.ripples = visual.ripples.filter((ripple) => ripple.age < 0.75);
}

function animate(timestamp) {
  animationFrameId = 0;
  if (!pageActive) return;
  if (isDentaphone) return;
  const seconds = timestamp / 1000;
  const dt = Math.min(0.05, Math.max(0.001, seconds - (visualTime || seconds)));
  visualTime = seconds;
  visual.impactFlash *= Math.exp(-dt * 8);
  const { context, width, height } = stageContext();
  context.clearRect(0, 0, width, height);
  drawBackdrop(context, width, height);
  if (kind === "particle-cabinet") drawParticleCabinet(context, width, height, dt);
  else if (kind === "impact-ecology") drawImpactEcology(context, width, height, dt);
  else if (kind === "object-forge") drawObjectForge(context, width, height);
  else if (kind === "bowed-things") drawBowedThings(context, width, height);
  else drawAirflowObjects(context, width, height, dt);
  drawRipples(context, width, height, dt);
  if (!reducedMotion.matches) animationFrameId = requestAnimationFrame(animate);
}

function startAnimation() {
  if (!animationFrameId) animationFrameId = requestAnimationFrame(animate);
}

function initialize() {
  populatePresets();
  const initialPreset = physicalSoundPreset(kind, state.presetId);
  if (initialPreset) {
    state = sanitizePhysicalSoundState(kind, {
      ...state,
      ...presetSettings(initialPreset),
      presetId: initialPreset.id ?? state.presetId,
    }, state);
  }
  if (isDentaphone) createDentaphoneKeyboard();
  if ($("level")) $("level").value = String(definition?.level ?? $("level").value);
  bindControls();
  syncModalReadout();
  updateControlPresentation();
  setAudioPresentation("off");
  if (typeof globalThis.ResizeObserver === "function") {
    new globalThis.ResizeObserver(resizeCanvas).observe(canvas);
  } else {
    globalThis.addEventListener("resize", resizeCanvas);
  }
  startAnimation();
}

globalThis.addEventListener("pagehide", () => {
  pageActive = false;
  dentaphoneViewModeGeneration += 1;
  globalThis.clearTimeout(dentaphone3dStatusTimer);
  dentaphone3dStatusTimer = 0;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = 0;
  endAllGates();
  discardDentaphoneFoodVoices();
  audioDesiredOn = false;
  audioGeneration += 1;
  graph?.source.port.postMessage({ type: "silence" });
  graph?.releaseOutput?.();
  void graph?.context.close?.();
  graph = null;
  resetDentaphoneWebGLLoadState();
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted || pageActive) return;
  pageActive = true;
  visualTime = 0;
  resizeCanvas();
  setAudioPresentation("off");
  startAnimation();
  if (dentaphoneViewMode === "3d") void setDentaphoneViewMode("3d", { announceChange: false });
});

reducedMotion.addEventListener?.("change", () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animationFrameId = 0;
  startAnimation();
});

initialize();
