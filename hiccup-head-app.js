import {
  HICCUP_HEAD_DEFAULTS,
  HICCUP_HEAD_LIMITS,
  HICCUP_HEAD_PATTERNS,
  HICCUP_HEAD_PRESETS,
  HICCUP_HEAD_SOUNDS,
  HICCUP_HEAD_STEP_COUNT,
  HICCUP_HEAD_TRACT_SECTION_COUNT,
  HICCUP_HEAD_VELOCITIES,
  HICCUP_HEAD_VOICE_CHARACTERS,
  HICCUP_HEAD_VOICE_MODULATION_SOURCES,
  HICCUP_HEAD_VOICE_MODULATION_TARGETS,
  clamp,
  clonePattern,
  cycleStepVelocity,
  hiccupHeadFaceEffectTargets,
  hiccupHeadGeometry,
  hiccupHeadPattern,
  hiccupHeadPreset,
  hiccupHeadPoseForSound,
  hiccupHeadSound,
  hiccupHeadState,
  hiccupHeadVoiceCharacter,
  mutateHiccupHeadVoice,
  patternEventsAtStep,
  randomizeHiccupHeadState,
  randomizePattern,
  sanitizeHiccupHeadState,
  sanitizeHiccupHeadVoice,
  sequenceStepIntervalSeconds,
} from "./src/hiccup-head.js?v=hiccup-head-model-20260831-7";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const drawing = canvas.getContext("2d", { alpha: false, desynchronized: true });
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const compactCanvasMedia = globalThis.matchMedia?.("(max-width: 680px), (pointer: coarse)");

const CONTROL_SPECS = Object.freeze([
  { key: "lungPressure", format: formatPercent },
  { key: "lipTension", format: formatPercent },
  { key: "lipRounding", format: formatPercent },
  { key: "cheekVolume", format: formatPercent },
  { key: "cheekTension", format: formatPercent },
  { key: "tonguePosition", format: formatTonguePosition },
  { key: "tongueCurl", format: formatPercent },
  { key: "tongueOut", format: formatPercent },
  { key: "mouthOpening", format: formatPercent },
  { key: "tractLengthM", format: (value) => `${(value * 100).toFixed(1)} cm` },
  { key: "nasalMix", format: formatPercent },
  { key: "dooPitch", format: formatSemitones },
  { key: "earSpread", format: formatPercent },
  { key: "leftHairLength", format: formatPercent },
  { key: "leftHairAngle", format: formatSignedPercent },
  { key: "rightHairLength", format: formatPercent },
  { key: "rightHairAngle", format: formatSignedPercent },
  { key: "eyeDivergence", format: formatEyeDivergence },
  { key: "eyeClosure", format: formatPercent },
  { key: "leftBrow", format: formatPercent },
  { key: "rightBrow", format: formatPercent },
  { key: "silliness", format: formatPercent },
  { key: "decay", format: formatPercent },
  { key: "humanize", format: formatPercent },
  { key: "tempo", format: (value) => `${Math.round(value)} BPM` },
  { key: "swing", format: formatPercent },
  { key: "level", format: formatPercent },
]);

// One defined polka-dot trigger for every sound. The explicit inventory keeps
// forehead, eye, cheek, and jaw dots on feature-clear skin while ensuring a newly
// added sequencer sound cannot quietly ship without a face trigger.
const FACE_SOUND_TRIGGER_LAYOUT = Object.freeze([
  { soundId: "eef", slot: 0, zone: "upper-breath" },
  { soundId: "hee", slot: 1, zone: "upper-voice" },
  { soundId: "haw", slot: 2, zone: "upper-voice" },
  { soundId: "doo", slot: 3, zone: "upper-voice" },
  { soundId: "aah", slot: 4, zone: "upper-voice" },
  { soundId: "ooh", slot: 5, zone: "upper-voice" },
  { soundId: "wail", slot: 6, zone: "upper-voice" },
  { soundId: "yodel", slot: 7, zone: "upper-voice" },
  { soundId: "smack", slot: 8, zone: "right-palm" },
  { soundId: "pop", slot: 9, zone: "right-cheek" },
  { soundId: "holler", slot: 10, zone: "right-throat" },
  { soundId: "moan", slot: 11, zone: "right-throat" },
  { soundId: "hum", slot: 12, zone: "right-throat" },
  { soundId: "rattle", slot: 13, zone: "lower-throat" },
  { soundId: "growl", slot: 14, zone: "lower-throat" },
  { soundId: "grunt", slot: 15, zone: "lower-throat" },
  { soundId: "hiccup", slot: 16, zone: "diaphragm-catch" },
  { soundId: "burp", slot: 17, zone: "lower-throat" },
  { soundId: "kick", slot: 18, zone: "lower-mouth" },
  { soundId: "bop", slot: 19, zone: "lower-mouth" },
  { soundId: "boop", slot: 20, zone: "lower-mouth" },
  { soundId: "pff", slot: 21, zone: "lower-mouth" },
  { soundId: "pbpb", slot: 22, zone: "lower-mouth" },
  { soundId: "mwah", slot: 23, zone: "lower-mouth" },
  { soundId: "slap", slot: 24, zone: "left-palm" },
  { soundId: "tlik", slot: 25, zone: "left-tongue" },
  { soundId: "drr", slot: 26, zone: "left-tongue" },
  { soundId: "lala", slot: 27, zone: "left-tongue" },
  { soundId: "slurp", slot: 28, zone: "left-tongue" },
  { soundId: "shack", slot: 29, zone: "left-mouth" },
  { soundId: "shh", slot: 30, zone: "left-mouth" },
  { soundId: "whistle", slot: 31, zone: "tooth-gap", label: "FWEE" },
  { soundId: "snare", slot: 32, zone: "forehead-drum" },
  { soundId: "snap", slot: 33, zone: "forehead-drum" },
  { soundId: "tomlo", slot: 34, zone: "jaw-drum" },
  { soundId: "tomhi", slot: 35, zone: "jaw-drum" },
  { soundId: "braap", slot: 36, zone: "jaw-drum" },
  { soundId: "kiss", slot: 37, zone: "kiss-cheek" },
  { soundId: "brush", slot: 38, zone: "tooth-brush" },
]);

const faceSoundTriggerIds = new Set(FACE_SOUND_TRIGGER_LAYOUT.map(({ soundId }) => soundId));
if (
  FACE_SOUND_TRIGGER_LAYOUT.length !== HICCUP_HEAD_SOUNDS.length
  || faceSoundTriggerIds.size !== HICCUP_HEAD_SOUNDS.length
  || HICCUP_HEAD_SOUNDS.some(({ id }) => !faceSoundTriggerIds.has(id))
) {
  throw new Error("FACE_SOUND_TRIGGER_LAYOUT must define exactly one trigger for every sound");
}
const faceSoundTriggerById = new Map(
  FACE_SOUND_TRIGGER_LAYOUT.map((trigger) => [trigger.soundId, trigger]),
);
const FACE_TRIGGER_DOT_POSITIONS = Object.freeze({
  // Eight forehead dots clear the thick brow paths and their drag handles.
  eef: Object.freeze({ x: -0.18, y: -0.87, region: "forehead" }),
  hee: Object.freeze({ x: 0, y: -0.87, region: "forehead" }),
  haw: Object.freeze({ x: 0.18, y: -0.87, region: "forehead" }),
  doo: Object.freeze({ x: -0.57, y: -0.7, region: "forehead" }),
  aah: Object.freeze({ x: 0.57, y: -0.7, region: "forehead" }),
  ooh: Object.freeze({ x: -0.73, y: -0.48, region: "forehead" }),
  wail: Object.freeze({ x: 0.73, y: -0.48, region: "forehead" }),
  yodel: Object.freeze({ x: 0, y: -0.65, region: "forehead" }),
  // Eight outside/below-eye and upper-cheek dots avoid eyes, nose, ears,
  // side hair, enlarged default hands, and every default parameter handle.
  smack: Object.freeze({ x: -0.7, y: -0.26, region: "eye-cheek" }),
  pop: Object.freeze({ x: -0.54, y: -0.18, region: "eye-cheek" }),
  holler: Object.freeze({ x: -0.36, y: -0.16, region: "eye-cheek" }),
  moan: Object.freeze({ x: -0.52, y: -0.04, region: "cheek" }),
  hum: Object.freeze({ x: 0.52, y: -0.04, region: "cheek" }),
  rattle: Object.freeze({ x: 0.36, y: -0.16, region: "eye-cheek" }),
  growl: Object.freeze({ x: 0.54, y: -0.18, region: "eye-cheek" }),
  grunt: Object.freeze({ x: 0.7, y: -0.26, region: "eye-cheek" }),
  // Loose left/right cheek constellations keep the chin clear.
  hiccup: Object.freeze({ x: 0.72, y: 0.18, region: "right-cheek" }),
  burp: Object.freeze({ x: 0.58, y: 0.12, region: "right-cheek" }),
  kick: Object.freeze({ x: -0.76, y: 0.12, region: "left-cheek" }),
  bop: Object.freeze({ x: 0.72, y: 0.32, region: "right-cheek" }),
  boop: Object.freeze({ x: 0.58, y: 0.26, region: "right-cheek" }),
  pff: Object.freeze({ x: -0.62, y: 0.22, region: "left-cheek" }),
  pbpb: Object.freeze({ x: -0.76, y: 0.34, region: "left-cheek" }),
  mwah: Object.freeze({ x: 0.72, y: 0.48, region: "right-cheek" }),
  slap: Object.freeze({ x: -0.62, y: 0.42, region: "left-cheek" }),
  tlik: Object.freeze({ x: 0.58, y: 0.4, region: "right-cheek" }),
  drr: Object.freeze({ x: 0.68, y: 0.66, region: "right-cheek" }),
  lala: Object.freeze({ x: -0.68, y: 0.52, region: "left-cheek" }),
  slurp: Object.freeze({ x: -0.54, y: 0.56, region: "left-cheek" }),
  shack: Object.freeze({ x: -0.62, y: 0.68, region: "left-cheek" }),
  shh: Object.freeze({ x: 0.58, y: 0.7, region: "right-cheek" }),
  whistle: Object.freeze({ x: 0.5, y: 0.6, region: "right-cheek" }),
  snare: Object.freeze({ x: 0.8, y: 0.04, region: "right-cheek" }),
  snap: Object.freeze({ x: 0.64, y: 0.02, region: "right-cheek" }),
  tomlo: Object.freeze({ x: -0.8, y: 0.04, region: "left-cheek" }),
  tomhi: Object.freeze({ x: -0.66, y: 0.06, region: "left-cheek" }),
  braap: Object.freeze({ x: 0.8, y: 0.4, region: "right-cheek" }),
  kiss: Object.freeze({ x: -0.5, y: 0.7, region: "left-cheek" }),
  brush: Object.freeze({ x: 0.46, y: 0.72, region: "right-cheek" }),
});
const faceTriggerDotIds = new Set(Object.keys(FACE_TRIGGER_DOT_POSITIONS));
if (
  faceTriggerDotIds.size !== HICCUP_HEAD_SOUNDS.length
  || HICCUP_HEAD_SOUNDS.some(({ id }) => !faceTriggerDotIds.has(id))
) {
  throw new Error("Hiccup Head requires exactly one safe-skin dot for every sound");
}

const FACE_TRIGGER_FRECKLE_COLORS = Object.freeze([
  "#55307d", "#214e83", "#276749", "#713b73", "#285f70", "#355c32",
]);
const TONGUE_STEP_COLORS = Object.freeze([
  "#b51f58", "#d34b31", "#7a3f91", "#176b63", "#c23867", "#9b4a24",
]);
const SKIN_CHECKER_PALETTE = Object.freeze([
  "rgb(255, 174, 199)", // pink
  "rgb(255, 218, 105)", // yellow
  "rgb(255, 164, 92)",  // orange
  "rgb(157, 218, 125)", // green
  "rgb(244, 126, 173)", // deep pink
  "rgb(205, 235, 116)", // yellow-green
  "rgb(129, 190, 235)", // soft blue
  "rgb(250, 246, 232)", // warm white
  "rgb(132, 82, 54)",   // brown
  "rgb(22, 20, 24)",    // soft black
  "rgb(53, 92, 66)",    // dark green
  "rgb(61, 66, 118)",   // dark blue
  "rgb(105, 54, 91)",   // dark berry
  "rgb(116, 75, 39)",   // dark ochre
]);
function seededCheckerIndex(step, salt) {
  let value = Math.imul((step + 1) ^ salt, 0x45d9f3b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0);
}

const STOPPED_SKIN_CHECKER_COLORS = Object.freeze([
  "rgb(22, 20, 24)",
  "rgb(250, 246, 232)",
]);

const SEQUENCE_SKIN_CHECKER_COLORS = Object.freeze(Array.from(
  { length: HICCUP_HEAD_STEP_COUNT },
  (_, step) => {
    // Choose both colors from independent seeded draws. Selecting the second
    // from a palette one item shorter, then skipping the first, guarantees
    // two different colors without a retry loop or frame-to-frame flicker.
    const firstIndex = seededCheckerIndex(step, 0x2c9277b5) % SKIN_CHECKER_PALETTE.length;
    const secondDraw = seededCheckerIndex(step, 0x6d2b79f5) % (SKIN_CHECKER_PALETTE.length - 1);
    const secondIndex = secondDraw >= firstIndex ? secondDraw + 1 : secondDraw;
    return Object.freeze([
      SKIN_CHECKER_PALETTE[firstIndex],
      SKIN_CHECKER_PALETTE[secondIndex],
    ]);
  },
));

function skinCheckerColorsForStep(step) {
  const numericStep = Number(step);
  if (!Number.isInteger(numericStep) || numericStep < 0) {
    return STOPPED_SKIN_CHECKER_COLORS;
  }
  return SEQUENCE_SKIN_CHECKER_COLORS[numericStep % HICCUP_HEAD_STEP_COUNT];
}

// These are performance-level bypasses, deliberately kept outside the face
// state so loading, mutating, or resetting a preset cannot change them.
const FACE_EFFECT_KEYS = Object.freeze(["delay", "reverb", "nasal", "stereo"]);
const PRESET_INDEPENDENT_EFFECT_PARAMETERS = Object.freeze([
  "leftHairLength",
  "leftHairAngle",
  "rightHairLength",
  "rightHairAngle",
  "eyeDivergence",
  "eyeClosure",
  "leftEyeClosure",
  "rightEyeClosure",
  "nasalMix",
  "earSpread",
]);
const faceEffectEnabled = Object.seal({
  delay: true,
  reverb: true,
  nasal: true,
  stereo: true,
});

let state = hiccupHeadState("rubber-face");
const DEFAULT_EYEBROW_EMPHASIS = 0.7;
let eyebrowEmphasis = DEFAULT_EYEBROW_EMPHASIS;
let pattern = normalizePatternColumns(clonePattern(hiccupHeadPattern(state.patternId)));
let currentPatternId = state.patternId;
let sequenceLength = Math.min(16, HICCUP_HEAD_STEP_COUNT);
let voiceCount = 4;
let voiceSelectionMode = "round-robin";
let voiceCursor = 0;
let activeVoiceSlot = -1;
let voiceSlots = createDefaultVoiceSlots();
let audioContext = null;
let graph = null;
let audioStartupPromise = null;
let audioGraphWarmed = false;
let sequencePlaying = false;
let schedulerTimer = 0;
let manualConfigurationResetTimer = 0;
let nextStepTime = 0;
let sequenceStep = 0;
let absoluteStep = 0;
const extraSequenceSoundIds = new Set();
let sequenceSoundOrder = HICCUP_HEAD_SOUNDS
  .filter(({ id }) => pattern[id].some((value) => value > 0))
  .map(({ id }) => id);
let visibleStep = -1;
let paintedGridStep = -1;
let gridCellsByStep = [];
let gridCellsByRow = [];
let gridHeadingsByStep = [];
let gridTabStop = null;
let gridRowTriggersBySound = new Map();
let padButtonsBySound = new Map();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let handles = [];
let hotspots = [];
let hoveredHotspotSoundId = "";
let hoveredHandleId = "";
let hoveredHandId = "";
let hands = [];
let toothGapGeometry = null;
let toothTines = [];
let toothTineHit = null;
let tongueTipGeometry = null;
let kissMarks = [];
let kissMarkCursor = 0;
let brushSweep = null;
let nextBrushDirection = 1;
let noseHonkStartedAt = -Infinity;
const handPlacements = {
  left: { x: -0.62, y: 0.1 },
  right: { x: 0.62, y: 0.14 },
};
let pointerDrag = null;
let animationFrame = 0;
let pendingCanvasStateUpdate = null;
let pendingCanvasStateFrame = 0;
let stageIsVisible = true;
let lastCanvasPaintAt = -Infinity;
let lastHudUpdateAt = -Infinity;
let visualQueue = [];
let soundAnimation = null;
let displayedPose = { ...state };
let lastDrawTime = performance.now();
let activeMouthSoundId = "";
let articulationTelemetryAvailable = false;
let articulationTelemetryAt = 0;
let lastTelemetryGestureSoundId = "";
let waveform = new Float32Array(1024);
let telemetry = {
  activeVoices: 0,
  queuedEvents: 0,
  lastSoundId: "",
  peak: 0,
  rms: 0,
};

function withPersistentFaceEffects(candidate, previous = state) {
  const preserved = Object.fromEntries(
    PRESET_INDEPENDENT_EFFECT_PARAMETERS.map((key) => [key, previous[key]]),
  );
  return sanitizeHiccupHeadState({ ...candidate, ...preserved }, candidate);
}

function createDefaultVoiceSlots() {
  return HICCUP_HEAD_VOICE_CHARACTERS.slice(0, 8).map((character, index) => ({
    id: `voice-${index + 1}`,
    solo: false,
    assignment: "all",
    voice: sanitizeHiccupHeadVoice({
      characterId: character.id,
      ...character.settings,
      modulation: {
        source: HICCUP_HEAD_VOICE_MODULATION_SOURCES[index % HICCUP_HEAD_VOICE_MODULATION_SOURCES.length],
        target: HICCUP_HEAD_VOICE_MODULATION_TARGETS[index % HICCUP_HEAD_VOICE_MODULATION_TARGETS.length],
        depth: 0.18 + (index % 4) * 0.08,
        rateHz: 2.4 + index * 0.53,
        phase: (index * 0.173) % 1,
      },
    }),
  }));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value) {
  const percent = Math.round(Number(value) * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function formatEyeDivergence(value) {
  const amount = Math.round(Math.abs(Number(value)) * 100);
  if (Number(value) < -0.005) return `${amount}% crossed`;
  if (Number(value) > 0.005) return `${amount}% reverb`;
  return "center";
}

function formatSemitones(value) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} st`;
}

function formatTonguePosition(value) {
  if (value < 0) return `${Math.round(Math.abs(value) * 100)}% past back`;
  if (value > 1) return `${Math.round((value - 1) * 100)}% past front`;
  return `${Math.round(value * 100)}% front`;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const amount = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(amount * 100).toFixed(2)}%`);
}

function soundLevelIndex(value) {
  const amount = clamp(value);
  let best = 0;
  let distance = Infinity;
  HICCUP_HEAD_VELOCITIES.forEach((candidate, index) => {
    if (Math.abs(candidate - amount) < distance) {
      best = index;
      distance = Math.abs(candidate - amount);
    }
  });
  return best;
}

function normalizePatternColumns(source) {
  for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
    let winner = null;
    for (const sound of HICCUP_HEAD_SOUNDS) {
      const amount = Number(source?.[sound.id]?.[step]) || 0;
      if (amount > 0 && (!winner || amount > winner.amount)) winner = { id: sound.id, amount };
    }
    for (const sound of HICCUP_HEAD_SOUNDS) {
      if (source?.[sound.id]) source[sound.id][step] = sound.id === winner?.id ? winner.amount : 0;
    }
  }
  return source;
}

function clearStepExcept(step, soundId) {
  for (const sound of HICCUP_HEAD_SOUNDS) {
    if (sound.id !== soundId) pattern[sound.id][step] = 0;
  }
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioButton").dataset.audioState = status;
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting" ? "starting" : on ? "on" : "off";
  $("audioError").hidden = !message;
  $("audioError").textContent = message;
}

function audioConfiguration(overrides = null) {
  const configuration = overrides
    ? sanitizeHiccupHeadState({ ...state, ...overrides }, state)
    : { ...state };
  if (!faceEffectEnabled.delay) {
    configuration.leftHairLength = 0;
    configuration.rightHairLength = 0;
  }
  if (!faceEffectEnabled.reverb) {
    configuration.eyeDivergence = 0;
  }
  if (!faceEffectEnabled.nasal) configuration.nasalMix = 0;
  if (!faceEffectEnabled.stereo) configuration.earSpread = 0;
  return configuration;
}

function syncFaceEffectButtons() {
  for (const key of FACE_EFFECT_KEYS) {
    const button = $(`${key}EffectButton`);
    const output = $(`${key}EffectState`);
    const enabled = faceEffectEnabled[key];
    if (button) {
      button.setAttribute("aria-pressed", String(enabled));
      button.setAttribute("aria-label", `${key} effect ${enabled ? "on" : "off"}`);
    }
    if (output) output.textContent = enabled ? "ON" : "OFF";
  }
}

function toggleFaceEffect(key) {
  if (!FACE_EFFECT_KEYS.includes(key)) return;
  faceEffectEnabled[key] = !faceEffectEnabled[key];
  syncFaceEffectButtons();
  postConfiguration();
  announce(`${key} effect ${faceEffectEnabled[key] ? "on" : "off"}`);
}

function postConfiguration(overrides = null) {
  const configuration = audioConfiguration(overrides);
  graph?.sourceNode?.port.postMessage({
    type: "configure",
    configuration,
  });
  graph?.facePostNode?.port.postMessage({
    type: "configure",
    configuration,
  });
  updateNativeFaceEffects(configuration);
}

function startOutputPrimer(context) {
  if (
    typeof context?.createOscillator !== "function"
    || typeof context?.createGain !== "function"
    || !context.destination
  ) return () => {};
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 23;
    // Non-zero audio wakes sleeping phone/Bluetooth routes; 23 Hz at -94 dB
    // remains inaudible and is removed before transport begins.
    gain.gain.value = 0.00002;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const stopTime = context.currentTime + 0.025;
      try {
        gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
        gain.gain.linearRampToValueAtTime(0, stopTime);
        oscillator.stop(stopTime + 0.005);
      } catch {
        try { oscillator.stop(); } catch { /* already stopped */ }
      }
      oscillator.onended = () => {
        try { oscillator.disconnect(); } catch { /* already disconnected */ }
        try { gain.disconnect(); } catch { /* already disconnected */ }
      };
    };
  } catch {
    return () => {};
  }
}

const WARM_ROOM_IMPULSE_URLS = Object.freeze({
  plate: new URL(
    "./assets/audio/hiccup-head-emt140-warm-plate.wav?v=hiccup-head-ir-20260831-2",
    import.meta.url,
  ),
  cathedral: new URL(
    "./assets/audio/hiccup-head-york-minster-warm-hall.wav?v=hiccup-head-ir-20260831-2",
    import.meta.url,
  ),
});

let warmRoomImpulseDataPromise = null;
const WARM_ROOM_FETCH_TIMEOUT_MS = 4_000;

async function fetchWarmRoomImpulse(roomId, url) {
  const controller = typeof globalThis.AbortController === "function"
    ? new globalThis.AbortController()
    : null;
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error(`${roomId} reverb took too long to load.`));
    }, WARM_ROOM_FETCH_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      fetch(url, controller ? { signal: controller.signal } : undefined),
      timeout,
    ]);
    if (!response.ok) throw new Error(`Could not load ${roomId} reverb (${response.status}).`);
    return [roomId, await response.arrayBuffer()];
  } finally {
    clearTimeout(timeoutId);
  }
}

function preloadWarmRoomImpulseData() {
  if (!warmRoomImpulseDataPromise) {
    const attempt = Promise.all(
      Object.entries(WARM_ROOM_IMPULSE_URLS).map(
        ([roomId, url]) => fetchWarmRoomImpulse(roomId, url),
      ),
    ).then((entries) => Object.fromEntries(entries));
    warmRoomImpulseDataPromise = attempt;
    // A transient cache/network failure must not poison audio for the whole
    // page lifetime. A later graph initialization gets a fresh bounded retry.
    void attempt.catch(() => {
      if (warmRoomImpulseDataPromise === attempt) warmRoomImpulseDataPromise = null;
    });
  }
  return warmRoomImpulseDataPromise;
}

async function decodeWarmRoomBuffers(context) {
  if (typeof context?.decodeAudioData !== "function" || typeof fetch !== "function") {
    return null;
  }
  try {
    const encoded = await preloadWarmRoomImpulseData();
    const [plate, cathedral] = await Promise.all([
      context.decodeAudioData(encoded.plate.slice(0)),
      context.decodeAudioData(encoded.cathedral.slice(0)),
    ]);
    return { cathedral, plate };
  } catch (error) {
    console.warn("Hiccup Head warm room impulses were unavailable; keeping the pupil room dry.", error);
    return null;
  }
}

function glideAudioParam(parameter, value, context, timeConstant = 0.025) {
  if (!parameter || !Number.isFinite(value) || !context) return;
  const now = context.currentTime;
  if (typeof parameter.cancelScheduledValues === "function") {
    parameter.cancelScheduledValues(now);
  }
  if (typeof parameter.setTargetAtTime === "function") {
    parameter.setTargetAtTime(value, now, timeConstant);
  } else {
    parameter.value = value;
  }
}

function updateNativeFaceEffects(configuration, targetGraph = graph) {
  const effects = targetGraph?.nativeFaceEffects;
  const context = targetGraph?.context;
  if (!effects || !context) return;
  const targets = hiccupHeadFaceEffectTargets(configuration, faceEffectEnabled);
  glideAudioParam(effects.roomDryGain?.gain, targets.roomDryGain, context, 0.025);
  glideAudioParam(effects.plateSendGain?.gain, targets.plateSendGain, context, 0.03);
  glideAudioParam(
    effects.cathedralSendGain?.gain,
    targets.cathedralSendGain,
    context,
    0.04,
  );
  glideAudioParam(effects.plateReturnGain?.gain, targets.roomWetGate, context, 0.02);
  glideAudioParam(effects.cathedralReturnGain?.gain, targets.roomWetGate, context, 0.02);
  // One in-series filter is the complete left-lid sweep. There is no parallel
  // dry copy to comb against it, so moving the lid cannot sound like a flange.
  glideAudioParam(effects.highpass?.frequency, targets.highpassCutoffHz, context, 0.016);
  glideAudioParam(effects.highpass?.Q, targets.highpassQ, context, 0.02);
  glideAudioParam(
    effects.highpassMakeupGain?.gain,
    targets.highpassMakeupGain,
    context,
    0.018,
  );
}

function clearNativeRoomHistory(targetGraph = graph) {
  const effects = targetGraph?.nativeFaceEffects;
  const context = targetGraph?.context;
  if (!effects || !context || typeof context.createConvolver !== "function") return;
  for (const roomId of ["plate", "cathedral"]) {
    const convolverKey = `${roomId}Convolver`;
    const sendGain = effects[`${roomId}SendGain`];
    const returnFilter = effects[`${roomId}ReturnHighpass`];
    const previous = effects[convolverKey];
    if (!sendGain || !returnFilter || !previous?.buffer) continue;
    const replacement = context.createConvolver();
    replacement.normalize = true;
    replacement.buffer = previous.buffer;
    try { sendGain.disconnect(previous); } catch { sendGain.disconnect(); }
    try { previous.disconnect(); } catch { /* already disconnected */ }
    sendGain.connect(replacement);
    replacement.connect(returnFilter);
    effects[convolverKey] = replacement;
  }
}

async function disposeAudioGraph() {
  const retiringGraph = graph;
  const retiringContext = audioContext;
  graph = null;
  audioContext = null;
  audioGraphWarmed = false;
  if (!retiringGraph && !retiringContext) return;
  retiringGraph?.sourceNode?.port.postMessage({ type: "silence" });
  retiringGraph?.facePostNode?.port.postMessage({ type: "silence" });
  retiringGraph?.outputPrimerStop?.();
  retiringGraph?.releaseOutput?.();
  try { await retiringContext?.close?.(); } catch { /* context is already closed */ }
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  const outputPrimerStop = startOutputPrimer(context);
  // Resume synchronously inside the click/keypress activation. Waiting for the
  // worklet module first can lose mobile Safari's user-activation window.
  const earlyResume = context.resume();
  let warmRoomBuffers = null;
  try {
    [, , warmRoomBuffers] = await Promise.all([
      earlyResume,
      context.audioWorklet.addModule(new URL(
        "./src/hiccup-head-processor.js?v=hiccup-head-tract-20260831-19",
        import.meta.url,
      )),
      decodeWarmRoomBuffers(context),
    ]);
  } catch (error) {
    outputPrimerStop();
    try { await context.close(); } catch { /* context never fully opened */ }
    throw error;
  }
  let releaseOutput = null;
  try {
  const nativeHighpassAvailable = typeof context.createBiquadFilter === "function";
  const nativeReverbAvailable = Boolean(
    warmRoomBuffers?.plate && warmRoomBuffers?.cathedral,
  ) && [
    "createBiquadFilter",
    "createConvolver",
    "createGain",
  ].every((method) => typeof context[method] === "function");
  const sourceNode = new AudioWorkletNode(context, "hiccup-head-physical-model", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: {
      configuration: audioConfiguration(),
      externalFuzz: true,
      // The dedicated post-room worklet owns the compatibility sweep when a
      // native Biquad is unavailable, so filtering never moves before fuzz.
      externalHighpass: true,
      // If captured IRs cannot load, stay clean and dry. The rejected
      // feedback/all-pass fallback sounded metallic and delay-like.
      externalReverb: true,
    },
  });
  const facePostNode = new AudioWorkletNode(context, "hiccup-head-face-post", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: {
      configuration: audioConfiguration(),
      externalHighpass: nativeHighpassAvailable,
    },
  });
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  masterGain.gain.value = state.level;
  compressor.threshold.value = -12;
  compressor.knee.value = 16;
  compressor.ratio.value = 4.5;
  compressor.attack.value = 0.0025;
  compressor.release.value = 0.16;
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  let nativeFaceEffects = {};
  let postRoomNode = sourceNode;
  if (nativeReverbAvailable) {
    const roomDryGain = context.createGain();
    const roomBus = context.createGain();
    const plateSendGain = context.createGain();
    const plateConvolver = context.createConvolver();
    const plateReturnHighpass = context.createBiquadFilter();
    const plateReturnLowpass = context.createBiquadFilter();
    const plateReturnGain = context.createGain();
    const cathedralSendGain = context.createGain();
    const cathedralConvolver = context.createConvolver();
    const cathedralReturnHighpass = context.createBiquadFilter();
    const cathedralReturnLowpass = context.createBiquadFilter();
    const cathedralReturnGain = context.createGain();

    roomDryGain.gain.value = 1;
    roomBus.gain.value = 1;
    plateSendGain.gain.value = 0;
    plateReturnGain.gain.value = 0;
    cathedralSendGain.gain.value = 0;
    cathedralReturnGain.gain.value = 0;
    plateConvolver.normalize = true;
    plateConvolver.buffer = warmRoomBuffers.plate;
    cathedralConvolver.normalize = true;
    cathedralConvolver.buffer = warmRoomBuffers.cathedral;
    plateReturnHighpass.type = "highpass";
    plateReturnHighpass.frequency.value = 120;
    plateReturnHighpass.Q.value = 0.45;
    plateReturnLowpass.type = "lowpass";
    plateReturnLowpass.frequency.value = 7_200;
    plateReturnLowpass.Q.value = 0.45;
    cathedralReturnHighpass.type = "highpass";
    cathedralReturnHighpass.frequency.value = 100;
    cathedralReturnHighpass.Q.value = 0.45;
    cathedralReturnLowpass.type = "lowpass";
    cathedralReturnLowpass.frequency.value = 5_800;
    cathedralReturnLowpass.Q.value = 0.45;

    sourceNode.connect(roomDryGain);
    roomDryGain.connect(roomBus);
    sourceNode.connect(plateSendGain);
    plateSendGain.connect(plateConvolver);
    plateConvolver.connect(plateReturnHighpass);
    plateReturnHighpass.connect(plateReturnLowpass);
    plateReturnLowpass.connect(plateReturnGain);
    plateReturnGain.connect(roomBus);
    sourceNode.connect(cathedralSendGain);
    cathedralSendGain.connect(cathedralConvolver);
    cathedralConvolver.connect(cathedralReturnHighpass);
    cathedralReturnHighpass.connect(cathedralReturnLowpass);
    cathedralReturnLowpass.connect(cathedralReturnGain);
    cathedralReturnGain.connect(roomBus);

    postRoomNode = roomBus;
    nativeFaceEffects = {
      cathedralConvolver,
      cathedralReturnGain,
      cathedralReturnHighpass,
      cathedralReturnLowpass,
      cathedralSendGain,
      plateConvolver,
      plateReturnGain,
      plateReturnHighpass,
      plateReturnLowpass,
      plateSendGain,
      roomBus,
      roomDryGain,
    };
  }
  // Fuzz belongs after the pupil room. Closing the right lid roughens the
  // complete dry + reverberant face, with no phase-offset parallel branch.
  postRoomNode.connect(facePostNode);
  postRoomNode = facePostNode;
  if (nativeHighpassAvailable) {
    const highpass = context.createBiquadFilter();
    const highpassMakeupGain = context.createGain();
    highpass.type = "highpass";
    highpass.frequency.value = 30;
    highpass.Q.value = 0.707;
    highpassMakeupGain.gain.value = 1;
    postRoomNode.connect(highpass);
    highpass.connect(highpassMakeupGain);
    highpassMakeupGain.connect(masterGain);
    nativeFaceEffects.highpass = highpass;
    nativeFaceEffects.highpassMakeupGain = highpassMakeupGain;
  } else {
    // The worklet owns a compact fallback sweep for older Web Audio engines.
    postRoomNode.connect(masterGain);
  }
  masterGain.connect(compressor);
  compressor.connect(analyser);
  releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  let warmupSerial = 0;
  const pendingWarmups = new Map();
  sourceNode.port.onmessage = (event) => {
    if (event.data?.type === "render-ready") {
      const pending = pendingWarmups.get(event.data.token);
      if (pending) {
        pendingWarmups.delete(event.data.token);
        pending.resolve(event.data);
      }
      return;
    }
    if (event.data?.type !== "telemetry") return;
    telemetry = { ...telemetry, ...event.data };
    if (
      Object.prototype.hasOwnProperty.call(event.data, "activeGesture")
      || Object.prototype.hasOwnProperty.call(event.data, "gestureProgress")
      || Object.prototype.hasOwnProperty.call(event.data, "lipDiameterCm")
    ) {
      articulationTelemetryAvailable = true;
      articulationTelemetryAt = performance.now();
    }
  };
  sourceNode.onprocessorerror = () => setAudioPresentation(
    "error",
    "The Hiccup Head physical model stopped unexpectedly. Reload the page to reset it.",
  );
  facePostNode.onprocessorerror = () => setAudioPresentation(
    "error",
    "The Hiccup Head face effects stopped unexpectedly. Reload the page to reset them.",
  );
  const awaitRenderReady = (timeoutMilliseconds = 2_500) => {
    const token = `hiccup-ready-${Date.now()}-${warmupSerial += 1}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingWarmups.delete(token);
        reject(new Error("The audio renderer did not become ready in time."));
      }, timeoutMilliseconds);
      pendingWarmups.set(token, {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
      });
      sourceNode.port.postMessage({ type: "warmup", token });
    });
  };
  context.addEventListener?.("statechange", () => {
    if (context.state !== "running") audioGraphWarmed = false;
  });
  const createdGraph = {
    context,
    sourceNode,
    facePostNode,
    masterGain,
    compressor,
    analyser,
    nativeFaceEffects,
    releaseOutput,
    outputPrimerStop,
    awaitRenderReady,
  };
  updateNativeFaceEffects(audioConfiguration(), createdGraph);
  return createdGraph;
  } catch (error) {
    outputPrimerStop();
    releaseOutput?.();
    try { await context.close(); } catch { /* failed graph is already closed */ }
    throw error;
  }
}

async function initializeAudio() {
  if (!graph) {
    setAudioPresentation("starting");
    try {
      graph = await createAudioGraph();
      audioContext = graph.context;
    } catch (error) {
      console.error(error);
      setAudioPresentation("error", error?.message || "Unable to start Hiccup Head audio.");
      return false;
    }
  }
  try {
    const needsWarmup = !audioGraphWarmed || audioContext.state !== "running";
    if (needsWarmup && !graph.outputPrimerStop) {
      graph.outputPrimerStop = startOutputPrimer(audioContext);
    }
    unlockAudioContext(audioContext);
    await audioContext.resume();
    postConfiguration();
    if (needsWarmup) {
      // A running state alone is not proof that the render thread has consumed
      // audio. The worklet acknowledges only after 40 ms of actual quanta.
      await graph.awaitRenderReady();
      if (audioContext.state !== "running") {
        throw new Error("The browser suspended audio while it was starting.");
      }
      const deviceLatency = Number(audioContext.baseLatency || 0)
        + Number(audioContext.outputLatency || 0);
      const outputSettleMilliseconds = clamp(deviceLatency * 1_250 + 45, 65, 420);
      await new Promise((resolve) => setTimeout(resolve, outputSettleMilliseconds));
      graph.outputPrimerStop?.();
      graph.outputPrimerStop = null;
      audioGraphWarmed = true;
    }
    setAudioPresentation("on");
    return true;
  } catch (error) {
    graph?.outputPrimerStop?.();
    if (graph) graph.outputPrimerStop = null;
    console.error(error);
    setAudioPresentation("error", error?.message || "The browser blocked audio startup.");
    return false;
  }
}

function ensureAudio() {
  // Audio button, play button, pads, and face triggers may arrive during the
  // same cold start. They all await one initialization instead of the later
  // request being discarded by a `startingAudio` boolean.
  if (audioStartupPromise) return audioStartupPromise;
  audioStartupPromise = initializeAudio().finally(() => {
    audioStartupPromise = null;
  });
  return audioStartupPromise;
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    stopSequence();
    await disposeAudioGraph();
    setAudioPresentation("off");
    announce("Hiccup Head audio off");
    return;
  }
  if (await ensureAudio()) announce("Hiccup Head audio on");
}

const VOICE_SOUND_IDS = new Set([
  "bop", "boop", "pff", "hee", "haw", "doo", "mwah", "drr", "burp",
  "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle",
  "grunt", "moan", "lala",
]);
const TEMPO_STRETCH_SOUND_IDS = new Set([
  "pff", "whistle", "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle",
  "grunt", "moan", "lala", "pbpb", "slurp",
]);
const TOOTH_TINE_PROFILES = Object.freeze([
  [130.81, 0.42], [146.83, 0.46], [164.81, 0.5], [196, 0.54],
  [220, 0.48], [261.63, 0.56], [293.66, 0.5], [329.63, 0.58],
  [392, 0.52], [440, 0.6], [523.25, 0.54], [587.33, 0.62],
].map(([frequencyHz, brightness]) => Object.freeze({ frequencyHz, brightness })));

function flashSound(soundId, velocity = 1, voiceChoice = null) {
  const sound = hiccupHeadSound(soundId);
  // Only the row trigger and playable pad have an is-hit presentation. The
  // old broad selector also touched every cell in a 64-step row and installed
  // one timer per cell, which could swamp a phone at fast tempos.
  for (const element of [
    gridRowTriggersBySound.get(sound.id),
    padButtonsBySound.get(sound.id),
  ]) {
    if (!element) continue;
    element.classList.add("is-hit");
    clearTimeout(element._hiccupHeadFlashTimer);
    element._hiccupHeadFlashTimer = setTimeout(
      () => element.classList.remove("is-hit"),
      70 + velocity * 90,
    );
  }
  if (voiceChoice?.slotIndex >= 0) {
    activeVoiceSlot = voiceChoice.slotIndex;
    const card = document.querySelector(`[data-voice-slot="${voiceChoice.slotIndex}"]`);
    card?.classList.add("is-active");
    clearTimeout(card?._hiccupHeadVoiceFlashTimer);
    if (card) {
      card._hiccupHeadVoiceFlashTimer = setTimeout(
        () => card.classList.remove("is-active"),
        140 + velocity * 180,
      );
    }
    $("soundReadout").textContent = `${sound.label} · ${voiceChoice.label}`;
  } else {
    activeVoiceSlot = -1;
    $("soundReadout").textContent = `${sound.label} · ${sound.subtitle}`;
  }
}

function seededVoiceRandom(seedValue) {
  let seed = (Math.trunc(Number(seedValue) || 0) ^ 0x766f6963) >>> 0;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967295;
  };
}

function availableVoiceSlots(soundId = null) {
  const active = voiceSlots.slice(0, voiceCount);
  const soloed = active.filter((slot) => slot.solo);
  if (!soundId) return soloed.length ? soloed : active;
  // Resolve sound assignments first so a solo aimed at another gesture cannot
  // erase this event's intended collection character. If no slot explicitly
  // accepts the sound, fall back deterministically instead of silently losing
  // collection identity and relying on the processor's generic Natural voice.
  const compatible = active.filter(
    (slot) => slot.assignment === "all" || slot.assignment === soundId,
  );
  const compatibleSoloed = compatible.filter((slot) => slot.solo);
  if (compatibleSoloed.length) return compatibleSoloed;
  if (compatible.length) return compatible;
  return soloed.length ? [soloed[0]] : active.length ? [active[0]] : [];
}

function voiceChoiceForSound(soundId, seed = performance.now()) {
  if (!VOICE_SOUND_IDS.has(hiccupHeadSound(soundId).id)) return null;
  const candidates = availableVoiceSlots(soundId);
  if (!candidates.length) return null;
  let slot = null;
  if (voiceSelectionMode === "random") {
    const draw = seededVoiceRandom(seed)();
    slot = candidates[Math.min(candidates.length - 1, Math.floor(draw * candidates.length))];
  } else {
    slot = candidates[voiceCursor % candidates.length];
    voiceCursor = (voiceCursor + 1) % Math.max(1, candidates.length);
  }
  const slotIndex = voiceSlots.indexOf(slot);
  const voice = sanitizeHiccupHeadVoice(slot.voice);
  return {
    slotIndex,
    voice,
    label: hiccupHeadVoiceCharacter(voice.characterId).label,
  };
}

function queueSoundVisual(
  soundId,
  velocity,
  delaySeconds = 0,
  step = null,
  configuration = null,
  voiceChoice = null,
  eventDetails = null,
) {
  visualQueue.push({
    type: "sound",
    soundId: hiccupHeadSound(soundId).id,
    velocity: clamp(velocity, 0.01, 1),
    step,
    configuration,
    voiceChoice,
    eventDetails,
    due: performance.now() + Math.max(0, delaySeconds) * 1000,
  });
}

function postStrike(
  soundId,
  velocity = 1,
  delaySeconds = 0,
  step = null,
  configuration = null,
  voiceChoice = null,
  eventDetails = null,
) {
  if (!graph || audioContext?.state !== "running") return false;
  const boundedDelay = clamp(delaySeconds, 0, 2);
  const strikeConfiguration = configuration ? audioConfiguration(configuration) : null;
  const rawToothTine = eventDetails?.toothTine;
  const toothTine = rawToothTine ? {
    frequencyHz: clamp(Number(rawToothTine.frequencyHz) || 440, 80, 4_000),
    position: clamp(Number(rawToothTine.position) || 0, 0, 1),
    brightness: clamp(Number(rawToothTine.brightness) || 0, 0, 1),
    toothIndex: Math.round(clamp(Number(rawToothTine.toothIndex) || 0, 0, 11)),
  } : null;
  const brushDirection = eventDetails?.brushDirection === -1 ? -1 : 1;
  const safeEventDetails = toothTine || soundId === "brush"
    ? { ...(toothTine ? { toothTine } : {}), ...(soundId === "brush" ? { brushDirection } : {}) }
    : null;
  graph.sourceNode.port.postMessage({
    type: "strike",
    soundId: hiccupHeadSound(soundId).id,
    velocity: clamp(velocity, 0.01, 1),
    delaySeconds: boundedDelay,
    ...(strikeConfiguration ? { configuration: strikeConfiguration } : {}),
    ...(voiceChoice?.voice ? { voice: voiceChoice.voice } : {}),
    ...(toothTine ? { toothTine } : {}),
  });
  queueSoundVisual(
    soundId,
    velocity,
    boundedDelay,
    step,
    strikeConfiguration,
    voiceChoice,
    safeEventDetails,
  );
  return true;
}

async function triggerSound(soundId, velocity = 1, configuration = null, eventDetails = null) {
  const sound = hiccupHeadSound(soundId);
  if (!(await ensureAudio())) return false;
  const transientConfiguration = configuration
    ?? (sound.id === "slap" ? handStrikeConfiguration("left") : null)
    ?? (sound.id === "smack" ? handStrikeConfiguration("right") : null);
  const strikeConfiguration = transientConfiguration ?? state;
  const voiceChoice = voiceChoiceForSound(sound.id, performance.now());
  const brushDirection = sound.id === "brush" ? nextBrushDirection : 1;
  if (sound.id === "brush") nextBrushDirection *= -1;
  const strikeEventDetails = sound.id === "brush"
    ? { ...(eventDetails ?? {}), brushDirection }
    : eventDetails;
  postStrike(sound.id, velocity, 0, null, strikeConfiguration, voiceChoice, strikeEventDetails);
  if (sound.id === "brush") {
    // The tooth contacts and visible brush alternate direction together.
    const traversal = TOOTH_TINE_PROFILES.map((profile, toothIndex) => ({ profile, toothIndex }));
    if (brushDirection < 0) traversal.reverse();
    for (let travelIndex = 0; travelIndex < traversal.length; travelIndex += 1) {
      const { profile, toothIndex } = traversal[travelIndex];
      graph.sourceNode.port.postMessage({
        type: "strike",
        soundId: "tlik",
        velocity: clamp(velocity * (0.5 + travelIndex * 0.008), 0.01, 0.72),
        delaySeconds: 0.025 + travelIndex * 0.044,
        configuration: audioConfiguration(strikeConfiguration),
        toothTine: {
          frequencyHz: profile.frequencyHz,
          position: 0.28 + (toothIndex % 4) * 0.13,
          brightness: profile.brightness,
          toothIndex,
        },
      });
    }
  }
  clearTimeout(manualConfigurationResetTimer);
  if (transientConfiguration) {
    manualConfigurationResetTimer = setTimeout(() => {
      manualConfigurationResetTimer = 0;
      if (!sequencePlaying) postConfiguration();
    }, 720);
  }
  announce(`${sound.label}: ${sound.description}`);
  return true;
}

async function triggerNoseHonk() {
  if (!(await ensureAudio())) return false;
  noseHonkStartedAt = performance.now();
  const duckConfiguration = sanitizeHiccupHeadState({
    ...state,
    lungPressure: 0.96,
    nasalMix: 0.82,
    mouthOpening: 0.09,
    lipRounding: 0.08,
    lipTension: 0.78,
    cheekVolume: 0.38,
    cheekTension: 0.82,
    tonguePosition: 1.2,
    tongueCurl: 0.38,
    tractLengthM: 0.125,
    silliness: 0.86,
    decay: 0.68,
  }, state);
  const duckVoice = sanitizeHiccupHeadVoice({
    characterId: "reed",
    pitchOffsetSemitones: 12,
    breathiness: 0.08,
    roughness: 0.52,
    subharmonicMix: 0.2,
    vibratoRateHz: 2.8,
    vibratoDepthSemitones: 0.06,
    tractScale: 0.82,
    modulation: {
      source: "triangle",
      target: "pitch",
      depth: 0.36,
      rateHz: 2.2,
      phase: 0.5,
    },
  });
  graph.sourceNode.port.postMessage({
    type: "strike",
    soundId: "hiccup",
    velocity: 0.78,
    delaySeconds: 0,
    configuration: audioConfiguration(duckConfiguration),
    voice: duckVoice,
  });
  clearTimeout(manualConfigurationResetTimer);
  manualConfigurationResetTimer = setTimeout(() => {
    manualConfigurationResetTimer = 0;
    postConfiguration();
  }, 320);
  announce("QUACK: one short nasal duck call");
  return true;
}

function toothTineAtPoint(point) {
  let closest = null;
  let closestDistance = Infinity;
  for (const tine of toothTines) {
    const padding = Math.max(4, Math.min(8, tine.width * 0.28));
    if (
      Math.abs(point.x - tine.x) > tine.width * 0.5 + padding
      || Math.abs(point.y - tine.y) > tine.height * 0.5 + padding
    ) continue;
    const distance = distanceSquared(point, tine);
    if (distance < closestDistance) {
      closest = tine;
      closestDistance = distance;
    }
  }
  return closest;
}

function toothWhistleGapAtPoint(point) {
  const whistleGap = toothGapGeometry ?? null;
  if (!whistleGap) return false;
  const gap = whistleGap;
  const horizontalPadding = Math.max(4, gap.width * 0.24);
  const verticalPadding = Math.max(5, gap.height * 0.62);
  return point.x >= gap.x - gap.width * 0.5 - horizontalPadding
    && point.x <= gap.x + gap.width * 0.5 + horizontalPadding
    && point.y >= gap.y - verticalPadding
    && point.y <= gap.y + gap.height + verticalPadding;
}

async function triggerToothTine(tine, point, velocity) {
  const position = clamp(
    (point.y - (tine.y - tine.height * 0.5)) / Math.max(1, tine.height),
    0,
    1,
  );
  toothTineHit = {
    toothIndex: tine.toothIndex,
    velocity,
    start: performance.now(),
    duration: prefersReducedMotion ? 90 : 230,
  };
  const toothTine = {
    frequencyHz: tine.frequencyHz,
    position,
    brightness: tine.brightness,
    toothIndex: tine.toothIndex,
  };
  if (await triggerSound("tlik", velocity, null, { toothTine })) {
    announce(
      `Dry wood tooth ${tine.toothIndex + 1}: ${Math.round(position * 100)}% down the crooked tine`,
    );
  }
}

function deterministicHumanize(step, salt) {
  let value = ((step + 1) * 0x45d9f3b + (salt + 17) * 0x119de1f3) | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 4294967295) * 2 - 1;
}

function normalizedBrowValue(value) {
  const numericValue = Number(value);
  const bounded = Number.isFinite(numericValue) ? clamp(numericValue, 0, 1) : 0.5;
  return Math.round(bounded * 4) / 4;
}

function browAccentPeriod(value) {
  return [0, 8, 6, 4, 2][Math.round(normalizedBrowValue(value) * 4)];
}

function browSequenceGain(step, leftBrow, rightBrow, amount = eyebrowEmphasis) {
  const oneBasedStep = Math.max(0, Math.round(Number(step) || 0)) + 1;
  const leftPeriod = browAccentPeriod(leftBrow);
  const rightPeriod = browAccentPeriod(rightBrow);
  const leftHit = leftPeriod > 0 && oneBasedStep % leftPeriod === 0;
  const rightOffset = rightPeriod * 0.5;
  const rightHit = rightPeriod > 0
    && ((oneBasedStep - rightOffset) % rightPeriod + rightPeriod) % rightPeriod === 0;
  // Brows change groove chiefly by ducking the spaces around their anchors.
  // This avoids clipping already-loud programmed cells while making the chosen
  // on/off-beat pulse unmistakable. Both brows down is a true unity bypass.
  const emphasis = clamp(amount, 0, 0.9);
  if (leftPeriod === 0 && rightPeriod === 0) return 1;
  // Count the two masks independently. A right-brow offbeat can land on a
  // left-brow anchor at several snapped period combinations; collapsing the
  // pair with `leftHit || rightHit` made the right brow audibly disappear.
  const hitCount = Number(leftHit) + Number(rightHit);
  return hitCount > 0
    ? (1 + emphasis * 0.32) ** hitCount
    : 10 ** (-12 * emphasis / 20);
}

function scheduleSequence() {
  scheduleSequenceAhead(usesCompactCanvas() ? 0.32 : 0.22);
}

function scheduleSequenceAhead(lookaheadSeconds) {
  if (!sequencePlaying || !graph || audioContext?.state !== "running") return;
  // Never dump a backlog onto one render quantum after the UI thread stalls.
  // Advance the musical clock to the first future subdivision; the worklet
  // then receives evenly spaced events instead of a burst of late notes.
  const recoveryFloor = audioContext.currentTime + 0.008;
  while (nextStepTime < audioContext.currentTime - 0.025) {
    nextStepTime += sequenceStepIntervalSeconds(state.tempo, state.swing, absoluteStep);
    sequenceStep = (sequenceStep + 1) % sequenceLength;
    absoluteStep += 1;
  }
  if (nextStepTime < recoveryFloor) nextStepTime = recoveryFloor;
  while (nextStepTime < audioContext.currentTime + lookaheadSeconds) {
    if (sequenceStep < 0 || sequenceStep >= sequenceLength) sequenceStep = 0;
    const step = sequenceStep % sequenceLength;
    const timeJitter = deterministicHumanize(absoluteStep, 5) * state.humanize * 0.014;
    const scheduledTime = Math.max(audioContext.currentTime + 0.004, nextStepTime + timeJitter);
    const delaySeconds = scheduledTime - audioContext.currentTime;
    const events = patternEventsAtStep(pattern, step);
    const event = events.reduce((winner, candidate) => (
      !winner || candidate.velocity > winner.velocity ? candidate : winner
    ), null);
    if (event) {
      const soundIndex = HICCUP_HEAD_SOUNDS.findIndex(({ id }) => id === event.soundId);
      const velocityMotion = 1 + deterministicHumanize(absoluteStep, soundIndex + 23)
        * state.humanize * 0.22;
      const sequencedVelocity = clamp(
        event.velocity * velocityMotion * browSequenceGain(
          step,
          state.leftBrow,
          state.rightBrow,
          eyebrowEmphasis,
        ),
        0.01,
        1,
      );
      const voiceChoice = voiceChoiceForSound(event.soundId, absoluteStep * 131 + soundIndex);
      const strikeConfiguration = event.soundId === "slap"
        ? handStrikeConfiguration("left")
        : event.soundId === "smack"
          ? handStrikeConfiguration("right")
          : state;
      postStrike(
        event.soundId,
        sequencedVelocity,
        delaySeconds,
        step,
        strikeConfiguration,
        voiceChoice,
      );
    }
    visualQueue.push({
      type: "step",
      step,
      due: performance.now() + delaySeconds * 1000,
    });
    // Swing follows absolute time so odd sequence lengths do not produce two
    // consecutive long (or short) subdivisions at the loop boundary.
    nextStepTime += sequenceStepIntervalSeconds(state.tempo, state.swing, absoluteStep);
    sequenceStep = (sequenceStep + 1) % sequenceLength;
    absoluteStep += 1;
  }
}

async function startSequence({ restart = false } = {}) {
  if (!(await ensureAudio())) return;
  if (restart || !sequencePlaying) {
    sequenceStep = 0;
    absoluteStep = 0;
    // The graph has already warmed in ensureAudio. This lead supplies the
    // first physical closure with its full preparation interval while keeping
    // the audible strike and painted step locked to the same timestamp.
    nextStepTime = audioContext.currentTime + 0.072;
  }
  sequencePlaying = true;
  $("playButton").setAttribute("aria-pressed", "true");
  $("playLabel").textContent = "Pause face";
  $("playState").textContent = `${Math.round(state.tempo)} BPM · playing`;
  clearInterval(schedulerTimer);
  scheduleSequence();
  schedulerTimer = setInterval(scheduleSequence, 18);
  announce("Hiccup Head sequence playing");
}

function stopSequence({ announceState = true } = {}) {
  if (!sequencePlaying && !schedulerTimer) return;
  sequencePlaying = false;
  clearInterval(schedulerTimer);
  clearTimeout(manualConfigurationResetTimer);
  manualConfigurationResetTimer = 0;
  schedulerTimer = 0;
  visualQueue = visualQueue.filter(({ type }) => type !== "step");
  postConfiguration();
  visibleStep = -1;
  updateGridPlayhead();
  $("playButton").setAttribute("aria-pressed", "false");
  $("playLabel").textContent = "Play face";
  $("playState").textContent = `space · ${sequenceLength} steps`;
  if (announceState) announce("Hiccup Head sequence paused");
}

function toggleSequence() {
  if (sequencePlaying) stopSequence();
  else startSequence({ restart: true });
}

function restartSequence() {
  sequenceStep = 0;
  absoluteStep = 0;
  visibleStep = -1;
  updateGridPlayhead();
  if (sequencePlaying && audioContext) {
    visualQueue = visualQueue.filter(({ type }) => type !== "step");
    nextStepTime = audioContext.currentTime + 0.05;
    scheduleSequence();
  }
  announce("Sequence restarted at step one");
}

function setCurrentPattern(id, { announceState = true } = {}) {
  const preset = hiccupHeadPattern(id);
  pattern = normalizePatternColumns(clonePattern(preset));
  currentPatternId = preset.id;
  state = sanitizeHiccupHeadState({ ...state, patternId: preset.id }, state);
  $("patternSelect").value = preset.id;
  extraSequenceSoundIds.clear();
  sequenceSoundOrder = HICCUP_HEAD_SOUNDS
    .filter(({ id: soundId }) => pattern[soundId].some((value) => value > 0))
    .map(({ id: soundId }) => soundId);
  buildSequenceGrid();
  if (announceState) announce(`${preset.label} pattern loaded`);
}

function cyclePatternPreset(direction = 1) {
  const currentIndex = HICCUP_HEAD_PATTERNS.findIndex(({ id }) => id === currentPatternId);
  const startIndex = currentIndex >= 0 ? currentIndex : (direction > 0 ? -1 : 0);
  const nextIndex = (startIndex + Math.sign(direction || 1) + HICCUP_HEAD_PATTERNS.length)
    % HICCUP_HEAD_PATTERNS.length;
  setCurrentPattern(HICCUP_HEAD_PATTERNS[nextIndex].id);
}

function markPatternCustom() {
  currentPatternId = "custom";
  $("patternSelect").value = "custom";
}

function scatterPattern() {
  pattern = normalizePatternColumns(randomizePattern(Math.random, 0.22 + state.silliness * 0.13));
  markPatternCustom();
  extraSequenceSoundIds.clear();
  sequenceSoundOrder = HICCUP_HEAD_SOUNDS
    .filter(({ id }) => pattern[id].some((value) => value > 0))
    .map(({ id }) => id);
  buildSequenceGrid();
  announce("A new full-face pattern was scattered across the grid");
}

function clearPattern() {
  pattern = clonePattern({});
  extraSequenceSoundIds.clear();
  sequenceSoundOrder = [];
  markPatternCustom();
  buildSequenceGrid();
  announce("Sequence grid cleared");
}

function cellLabel(sound, step, value) {
  const strength = ["off", "ghost", "medium", "accent"][soundLevelIndex(value)];
  return `${sound.label}, step ${step + 1}, ${strength}. One sound may occupy this step.`;
}

function renderCell(button, value) {
  const sound = hiccupHeadSound(button.dataset.soundId);
  const step = Number(button.dataset.step);
  const level = soundLevelIndex(value);
  button.dataset.level = String(level);
  button.setAttribute("aria-pressed", String(level > 0));
  button.setAttribute("aria-label", cellLabel(sound, step, value));
  button.title = cellLabel(sound, step, value);
}

function updateGridPlayhead() {
  if (paintedGridStep === visibleStep) return;
  if (paintedGridStep >= 0) {
    gridHeadingsByStep[paintedGridStep]?.classList.remove("is-current");
    for (const cell of gridCellsByStep[paintedGridStep] ?? []) {
      cell.classList.remove("is-current");
    }
  }
  if (visibleStep >= 0) {
    gridHeadingsByStep[visibleStep]?.classList.add("is-current");
    for (const cell of gridCellsByStep[visibleStep] ?? []) {
      cell.classList.add("is-current");
    }
  }
  paintedGridStep = visibleStep;
  if (sequencePlaying) {
    setTextIfChanged("playState", `${Math.round(state.tempo)} BPM · step ${visibleStep + 1 || 1}`);
  }
}

function renderPatternColumn(step) {
  for (const button of gridCellsByStep[step] ?? []) {
    renderCell(button, pattern[button.dataset.soundId][step]);
  }
}

function renderPattern() {
  for (let step = 0; step < sequenceLength; step += 1) {
    renderPatternColumn(step);
  }
  updateGridPlayhead();
}

function setGridTabStop(cell) {
  if (!cell || cell === gridTabStop) return;
  if (gridTabStop) gridTabStop.tabIndex = -1;
  cell.tabIndex = 0;
  gridTabStop = cell;
}

function focusGridCell(row, step) {
  const rowCount = Math.max(1, gridCellsByRow.length);
  const safeRow = (row + rowCount) % rowCount;
  const safeStep = (step + sequenceLength) % sequenceLength;
  const target = gridCellsByRow[safeRow]?.[safeStep];
  if (!target) return;
  setGridTabStop(target);
  target.focus();
}

function handleGridKeydown(event) {
  const button = event.target.closest?.(".hiccup-head-step-cell");
  if (!button || !$("sequenceGrid").contains(button)) return;
  const row = Number(button.dataset.row);
  const step = Number(button.dataset.step);
  let target = null;
  if (event.key === "ArrowLeft") target = [row, step - 1];
  if (event.key === "ArrowRight") target = [row, step + 1];
  if (event.key === "ArrowUp") target = [row - 1, step];
  if (event.key === "ArrowDown") target = [row + 1, step];
  if (event.key === "Home") target = [row, 0];
  if (event.key === "End") target = [row, sequenceLength - 1];
  if (!target) return;
  event.preventDefault();
  focusGridCell(target[0], target[1]);
}

function handleSequenceGridClick(event) {
  const grid = $("sequenceGrid");
  const cell = event.target.closest?.(".hiccup-head-step-cell");
  if (!cell || !grid.contains(cell)) return;
  const sound = hiccupHeadSound(cell.dataset.soundId);
  const step = Number(cell.dataset.step);
  const next = cycleStepVelocity(pattern[sound.id][step]);
  if (next > 0) clearStepExcept(step, sound.id);
  pattern[sound.id][step] = next;
  if (next > 0) extraSequenceSoundIds.delete(sound.id);
  setGridTabStop(cell);
  markPatternCustom();
  const rowStillVisible = pattern[sound.id].some((value) => value > 0)
    || extraSequenceSoundIds.has(sound.id);
  if (rowStillVisible) renderPatternColumn(step);
  else buildSequenceGrid();
  if (next > 0) triggerSound(sound.id, next);
  announce(cellLabel(sound, step, next));
}

function activeSequenceSounds() {
  const activeIds = new Set(HICCUP_HEAD_SOUNDS
    .filter(({ id }) => pattern[id].some((value) => value > 0) || extraSequenceSoundIds.has(id))
    .map(({ id }) => id));
  sequenceSoundOrder = sequenceSoundOrder.filter((id) => activeIds.has(id));
  for (const { id } of HICCUP_HEAD_SOUNDS) {
    if (activeIds.has(id) && !sequenceSoundOrder.includes(id)) sequenceSoundOrder.push(id);
  }
  return sequenceSoundOrder.map((id) => hiccupHeadSound(id));
}

function soundOptions(selectedId = "", placeholder = "", excludedIds = new Set()) {
  const options = [];
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    option.selected = !selectedId;
    options.push(option);
  }
  for (const sound of HICCUP_HEAD_SOUNDS) {
    if (excludedIds.has(sound.id) && sound.id !== selectedId) continue;
    const option = document.createElement("option");
    option.value = sound.id;
    option.textContent = `${sound.label} · ${sound.subtitle}`;
    option.selected = sound.id === selectedId;
    options.push(option);
  }
  return options;
}

function changeSequenceRowSound(previousId, nextId) {
  if (!nextId || previousId === nextId) return;
  for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
    pattern[nextId][step] = Math.max(pattern[nextId][step], pattern[previousId][step]);
    pattern[previousId][step] = 0;
  }
  extraSequenceSoundIds.delete(previousId);
  if (!pattern[nextId].some((value) => value > 0)) extraSequenceSoundIds.add(nextId);
  const rowIndex = sequenceSoundOrder.indexOf(previousId);
  if (rowIndex >= 0) sequenceSoundOrder[rowIndex] = nextId;
  markPatternCustom();
  buildSequenceGrid();
  announce(`${hiccupHeadSound(previousId).label} row changed to ${hiccupHeadSound(nextId).label}`);
}

function addSequenceSound(soundId) {
  if (!soundId) return;
  if (sequenceSoundOrder.includes(soundId)) return;
  extraSequenceSoundIds.add(soundId);
  sequenceSoundOrder.push(soundId);
  buildSequenceGrid();
  announce(`${hiccupHeadSound(soundId).label} row added`);
}

function buildSequenceGrid() {
  const grid = $("sequenceGrid");
  const fragment = document.createDocumentFragment();
  paintedGridStep = -1;
  gridCellsByStep = Array.from({ length: sequenceLength }, () => []);
  const visibleSounds = activeSequenceSounds();
  gridCellsByRow = Array.from({ length: visibleSounds.length }, () => []);
  gridHeadingsByStep = [];
  gridRowTriggersBySound = new Map();
  gridTabStop = null;
  grid.style.setProperty("--hiccup-head-sequence-steps", String(sequenceLength));
  grid.style.setProperty("--hiccup-head-sequence-sounds", String(visibleSounds.length));
  grid.setAttribute("aria-rowcount", String(visibleSounds.length));
  grid.setAttribute("aria-colcount", String(sequenceLength));
  const headerRow = document.createElement("div");
  headerRow.className = "hiccup-head-grid-header-row";
  headerRow.setAttribute("role", "row");
  headerRow.style.display = "contents";
  const corner = document.createElement("span");
  corner.className = "hiccup-head-grid-corner";
  const addSoundSelect = document.createElement("select");
  addSoundSelect.className = "hiccup-head-add-row-select";
  addSoundSelect.setAttribute("aria-label", "Add sound row");
  addSoundSelect.replaceChildren(...soundOptions("", "+ SOUND", new Set(visibleSounds.map(({ id }) => id))));
  addSoundSelect.addEventListener("change", () => addSequenceSound(addSoundSelect.value));
  corner.append(addSoundSelect);
  headerRow.append(corner);
  for (let step = 0; step < sequenceLength; step += 1) {
    const heading = document.createElement("span");
    heading.className = "hiccup-head-step-number";
    heading.setAttribute("role", "columnheader");
    heading.setAttribute("aria-label", `Step ${step + 1}`);
    heading.dataset.step = String(step);
    heading.textContent = String(step + 1).padStart(2, "0");
    gridHeadingsByStep[step] = heading;
    headerRow.append(heading);
  }
  fragment.append(headerRow);

  visibleSounds.forEach((sound, rowIndex) => {
    const row = document.createElement("div");
    row.className = "hiccup-head-grid-row";
    row.setAttribute("role", "row");
    row.style.display = "contents";
    const trigger = document.createElement("select");
    trigger.className = "hiccup-head-row-trigger";
    trigger.dataset.soundId = sound.id;
    trigger.setAttribute("aria-label", `Sound for row ${rowIndex + 1}`);
    trigger.style.setProperty("--row-color", sound.color);
    trigger.replaceChildren(...soundOptions(
      sound.id,
      "",
      new Set(visibleSounds.map(({ id }) => id)),
    ));
    trigger.addEventListener("change", () => changeSequenceRowSound(sound.id, trigger.value));
    gridRowTriggersBySound.set(sound.id, trigger);
    row.append(trigger);

    for (let step = 0; step < sequenceLength; step += 1) {
      const cell = document.createElement("button");
      cell.className = "hiccup-head-step-cell";
      cell.type = "button";
      cell.dataset.soundId = sound.id;
      cell.dataset.row = String(rowIndex);
      cell.dataset.step = String(step);
      cell.setAttribute("role", "gridcell");
      cell.style.setProperty("--row-color", sound.color);
      cell.tabIndex = rowIndex === 0 && step === 0 ? 0 : -1;
      gridCellsByStep[step].push(cell);
      gridCellsByRow[rowIndex][step] = cell;
      if (rowIndex === 0 && step === 0) gridTabStop = cell;
      row.append(cell);
    }
    fragment.append(row);
  });
  grid.replaceChildren(fragment);
  renderPattern();
}

function setSequenceLength(value, { announceState = true } = {}) {
  sequenceLength = clamp(
    Math.round(Number(value) || 32),
    1,
    HICCUP_HEAD_STEP_COUNT,
  );
  // Resizing the loop is a live performance gesture. Preserve transport,
  // absolute timing, and the nearest sensible playhead instead of stopping.
  sequenceStep %= sequenceLength;
  if (visibleStep >= 0) visibleStep %= sequenceLength;
  visualQueue = visualQueue.map((event) => event.type === "step"
    ? { ...event, step: event.step % sequenceLength }
    : event);
  // Prime nearly half a second of worklet events before replacing thousands
  // of grid cells. Slow phones can then rebuild the visual grid without
  // starving the realtime audio queue.
  if (sequencePlaying) scheduleSequenceAhead(0.42);
  const control = $("sequenceLength");
  if (control) {
    control.value = String(sequenceLength);
    control.parentElement?.style.setProperty(
      "--length-turn",
      `${-135 + ((sequenceLength - 1) / (HICCUP_HEAD_STEP_COUNT - 1)) * 270}deg`,
    );
  }
  const entry = $("sequenceLengthEntry");
  if (entry && document.activeElement !== entry) entry.value = String(sequenceLength);
  document.querySelectorAll("[data-sequence-length]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.sequenceLength) === sequenceLength);
  });
  buildSequenceGrid();
  $("sequenceGrid").setAttribute(
    "aria-label",
    `${activeSequenceSounds().length} programmed Hiccup Head sound rows by ${sequenceLength} sequence steps. Only one sound can occupy each step.`,
  );
  updateGridPlayhead();
  $("playState").textContent = sequencePlaying
    ? `${Math.round(state.tempo)} BPM · playing`
    : `space · ${sequenceLength} steps`;
  if (announceState) announce(`Sequence length: ${sequenceLength} steps`);
}

function buildPadGrid() {
  const padGrid = $("padGrid");
  if (!padGrid) return;
  padButtonsBySound = new Map();
  const pads = HICCUP_HEAD_SOUNDS.map((sound, index) => {
    const button = document.createElement("button");
    const label = document.createElement("b");
    const subtitle = document.createElement("small");
    const key = document.createElement("kbd");
    button.className = "hiccup-head-pad";
    button.type = "button";
    button.dataset.soundId = sound.id;
    button.dataset.padIndex = String(index);
    button.style.setProperty("--pad-color", sound.color);
    button.setAttribute("aria-label", `${sound.label}: ${sound.subtitle}. Keyboard ${sound.key}.`);
    label.textContent = sound.label;
    subtitle.textContent = sound.subtitle;
    key.textContent = sound.key.toUpperCase();
    button.append(label, subtitle, key);
    padButtonsBySound.set(sound.id, button);
    return button;
  });
  padGrid.replaceChildren(...pads);
}

function makeVoiceOption(value, label, selectedValue) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = value === selectedValue;
  return option;
}

function voiceParameterSummary(voice) {
  const pitch = Math.round(voice.pitchOffsetSemitones);
  return `${pitch >= 0 ? "+" : ""}${pitch} st · ${voice.vibratoRateHz.toFixed(1)} Hz · ${Math.round(voice.roughness * 100)}% rough`;
}

function voiceModulationLabel(value) {
  const labels = {
    sine: "Sine LFO",
    triangle: "Triangle LFO",
    random: "Organic random",
    pitch: "Fold pitch",
    vibratoDepth: "Vibrato depth",
    breathiness: "Breathiness",
    roughness: "Fold roughness",
    tractScale: "Tract length",
  };
  return labels[value] ?? value;
}

function setVoiceSlotCharacter(slot, characterId) {
  const character = hiccupHeadVoiceCharacter(characterId);
  slot.voice = sanitizeHiccupHeadVoice({
    characterId: character.id,
    ...character.settings,
    modulation: slot.voice.modulation,
  });
}

function setVoiceSlotModulation(slot, updates) {
  slot.voice = sanitizeHiccupHeadVoice({
    ...slot.voice,
    modulation: { ...slot.voice.modulation, ...updates },
  });
}

function buildVoiceRack({ preserveScroll = true } = {}) {
  const rack = $("voiceRack");
  if (!rack) return;
  const previousScroll = preserveScroll ? rack.scrollTop : 0;
  const cards = voiceSlots.slice(0, voiceCount).map((slot, index) => {
    const character = hiccupHeadVoiceCharacter(slot.voice.characterId);
    const modulation = slot.voice.modulation;
    const card = document.createElement("article");
    card.className = "hiccup-head-voice-card";
    card.dataset.voiceSlot = String(index);
    card.dataset.solo = String(slot.solo);
    card.setAttribute("role", "listitem");

    const header = document.createElement("header");
    header.className = "hiccup-head-voice-card-header";
    const name = document.createElement("b");
    name.className = "hiccup-head-voice-name";
    name.textContent = `${String(index + 1).padStart(2, "0")} · ${character.label}`;
    const summary = document.createElement("span");
    summary.textContent = voiceParameterSummary(slot.voice);
    header.append(name, summary);

    const controls = document.createElement("div");
    controls.className = "hiccup-head-voice-card-controls";
    const characterSelect = document.createElement("select");
    characterSelect.className = "hiccup-head-voice-character-select";
    characterSelect.setAttribute("aria-label", `Voice ${index + 1} character`);
    characterSelect.replaceChildren(...HICCUP_HEAD_VOICE_CHARACTERS.map((candidate) => (
      makeVoiceOption(candidate.id, candidate.label, character.id)
    )));
    characterSelect.addEventListener("change", () => {
      setVoiceSlotCharacter(slot, characterSelect.value);
      buildVoiceRack();
      announce(`Voice ${index + 1}: ${hiccupHeadVoiceCharacter(characterSelect.value).label}`);
    });
    const soloButton = document.createElement("button");
    soloButton.className = "hiccup-head-voice-solo";
    soloButton.type = "button";
    soloButton.textContent = "SOLO";
    soloButton.setAttribute("aria-pressed", String(slot.solo));
    soloButton.setAttribute("aria-label", `Solo voice ${index + 1}`);
    soloButton.addEventListener("click", () => {
      slot.solo = !slot.solo;
      voiceCursor = 0;
      buildVoiceRack();
      announce(`Voice ${index + 1} solo ${slot.solo ? "on" : "off"}`);
    });
    const mutateButton = document.createElement("button");
    mutateButton.className = "hiccup-head-voice-mutate";
    mutateButton.type = "button";
    mutateButton.textContent = "MUT";
    mutateButton.setAttribute("aria-label", `Mutate voice ${index + 1}`);
    mutateButton.addEventListener("click", () => {
      slot.voice = mutateHiccupHeadVoice(slot.voice, Math.random, 0.34);
      buildVoiceRack();
      announce(`Voice ${index + 1} mutated`);
    });
    controls.append(characterSelect, soloButton, mutateButton);

    const assignmentLabel = document.createElement("label");
    assignmentLabel.className = "hiccup-head-voice-assignment";
    const assignmentText = document.createElement("span");
    assignmentText.textContent = "Assign";
    const assignmentSelect = document.createElement("select");
    assignmentSelect.setAttribute("aria-label", `Voice ${index + 1} sound assignment`);
    assignmentSelect.replaceChildren(
      makeVoiceOption("all", "All vocal gestures", slot.assignment),
      ...HICCUP_HEAD_SOUNDS
        .filter((sound) => VOICE_SOUND_IDS.has(sound.id))
        .map((sound) => makeVoiceOption(sound.id, sound.label, slot.assignment)),
    );
    assignmentSelect.addEventListener("change", () => {
      slot.assignment = assignmentSelect.value;
      voiceCursor = 0;
      announce(`Voice ${index + 1} assigned to ${assignmentSelect.selectedOptions[0].textContent}`);
    });
    assignmentLabel.append(assignmentText, assignmentSelect);

    const modBlock = document.createElement("div");
    modBlock.className = "hiccup-head-voice-modulation";
    const modMatrix = document.createElement("div");
    modMatrix.className = "hiccup-head-voice-mod-matrix";
    const sourceSelect = document.createElement("select");
    sourceSelect.className = "hiccup-head-voice-mod-source";
    sourceSelect.setAttribute("aria-label", `Voice ${index + 1} modulation source`);
    sourceSelect.replaceChildren(...HICCUP_HEAD_VOICE_MODULATION_SOURCES.map((source) => (
      makeVoiceOption(source, voiceModulationLabel(source), modulation.source)
    )));
    sourceSelect.addEventListener("change", () => {
      setVoiceSlotModulation(slot, { source: sourceSelect.value });
      announce(`Voice ${index + 1} modulator: ${voiceModulationLabel(sourceSelect.value)}`);
    });
    const targetSelect = document.createElement("select");
    targetSelect.className = "hiccup-head-voice-mod-target";
    targetSelect.setAttribute("aria-label", `Voice ${index + 1} modulation target`);
    targetSelect.replaceChildren(...HICCUP_HEAD_VOICE_MODULATION_TARGETS.map((target) => (
      makeVoiceOption(target, voiceModulationLabel(target), modulation.target)
    )));
    targetSelect.addEventListener("change", () => {
      setVoiceSlotModulation(slot, { target: targetSelect.value });
      announce(`Voice ${index + 1} modulates ${voiceModulationLabel(targetSelect.value)}`);
    });
    modMatrix.append(sourceSelect, targetSelect);

    const depthLabel = document.createElement("label");
    depthLabel.className = "hiccup-head-voice-mod-depth-wrap";
    const depthText = document.createElement("span");
    depthText.textContent = "Depth";
    const depthInput = document.createElement("input");
    depthInput.className = "hiccup-head-voice-mod-depth";
    depthInput.type = "range";
    depthInput.min = "0";
    depthInput.max = "1";
    depthInput.step = "0.01";
    depthInput.value = String(modulation.depth);
    depthInput.setAttribute("aria-label", `Voice ${index + 1} modulation depth`);
    const depthOutput = document.createElement("output");
    depthOutput.className = "hiccup-head-voice-mod-depth-out";
    depthOutput.value = formatPercent(modulation.depth);
    depthOutput.textContent = depthOutput.value;
    depthInput.addEventListener("input", () => {
      setVoiceSlotModulation(slot, { depth: Number(depthInput.value) });
      depthOutput.value = formatPercent(slot.voice.modulation.depth);
      depthOutput.textContent = depthOutput.value;
    });
    depthInput.addEventListener("change", () => announce(
      `Voice ${index + 1} modulation depth: ${formatPercent(slot.voice.modulation.depth)}`,
    ));
    depthLabel.append(depthText, depthInput, depthOutput);

    const rateLabel = document.createElement("label");
    rateLabel.className = "hiccup-head-voice-mod-rate-wrap";
    const rateText = document.createElement("span");
    rateText.textContent = "Rate";
    const rateInput = document.createElement("input");
    rateInput.className = "hiccup-head-voice-mod-rate";
    rateInput.type = "range";
    rateInput.min = "0.05";
    rateInput.max = "20";
    rateInput.step = "0.05";
    rateInput.value = String(modulation.rateHz);
    rateInput.setAttribute("aria-label", `Voice ${index + 1} modulation rate`);
    const rateOutput = document.createElement("output");
    rateOutput.className = "hiccup-head-voice-mod-rate-out";
    rateOutput.value = `${modulation.rateHz.toFixed(1)} Hz`;
    rateOutput.textContent = rateOutput.value;
    rateInput.addEventListener("input", () => {
      setVoiceSlotModulation(slot, { rateHz: Number(rateInput.value) });
      rateOutput.value = `${slot.voice.modulation.rateHz.toFixed(1)} Hz`;
      rateOutput.textContent = rateOutput.value;
    });
    rateInput.addEventListener("change", () => announce(
      `Voice ${index + 1} modulation rate: ${slot.voice.modulation.rateHz.toFixed(1)} hertz`,
    ));
    rateLabel.append(rateText, rateInput, rateOutput);
    modBlock.append(modMatrix, depthLabel, rateLabel);
    card.append(header, controls, assignmentLabel, modBlock);
    return card;
  });
  rack.replaceChildren(...cards);
  rack.scrollTop = previousScroll;
}

function setTextIfChanged(id, value) {
  const element = $(id);
  if (element && element.textContent !== value) element.textContent = value;
}

function updateHud(pose = state, { force = true, now = performance.now() } = {}) {
  // The worklet can animate the face at display rate, but these readouts do
  // not need to rebuild text nodes (or sanitize geometry) sixty times a second.
  if (!force && now - lastHudUpdateAt < 80) return;
  lastHudUpdateAt = now;
  const geometry = hiccupHeadGeometry(pose);
  const livePressure = Number.isFinite(Number(pose.lungPressure))
    ? Number(pose.lungPressure)
    : state.lungPressure;
  setTextIfChanged("cavityReadout", `${Math.round(geometry.cheekVolumeMl)} ml · ${Math.round(geometry.cavityFrequencyHz)} Hz`);
  setTextIfChanged("tractReadout", `${(pose.tractLengthM * 100).toFixed(1)} cm`);
  setTextIfChanged("pressureReadout", formatPercent(livePressure));
  const activeSlot = activeVoiceSlot >= 0 ? voiceSlots[activeVoiceSlot] : null;
  const activeCharacter = activeSlot
    ? hiccupHeadVoiceCharacter(activeSlot.voice.characterId)
    : null;
  setTextIfChanged("voicesReadout", activeMouthSoundId
    ? activeCharacter
      ? `1 · ${activeCharacter.label}`
      : `1 · ${hiccupHeadSound(activeMouthSoundId).label}`
    : `${voiceCount} ready · 1 at a time`);
  setTextIfChanged("pressureSummary", `${formatPercent(livePressure)} pressure · ${pose.lipTension < 0.4 ? "soft" : pose.lipTension > 0.7 ? "tight" : "springy"} lips`);
  setTextIfChanged(
    "faceSummary",
    `${formatPercent(pose.cheekVolume)} puff · ${formatPercent(pose.cheekTension)} skin · A ${formatPercent(normalizedBrowValue(pose.leftBrow))} / B ${formatPercent(normalizedBrowValue(pose.rightBrow))}`,
  );
  setTextIfChanged("cavitySummary", `${(pose.tractLengthM * 100).toFixed(1)} cm · ${pose.nasalMix < 0.22 ? "mostly oral" : pose.nasalMix > 0.62 ? "nose open" : "oral + nasal"}`);
  if (sequencePlaying) {
    setTextIfChanged("playState", `${Math.round(state.tempo)} BPM · step ${visibleStep + 1 || 1}`);
  }
}

function syncControls() {
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    const output = $(`${spec.key}Out`);
    if (!input || !output) continue;
    input.value = String(state[spec.key]);
    output.value = spec.format(state[spec.key]);
    output.textContent = output.value;
    updateRangeFill(input);
  }
  graph?.masterGain?.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  updateHud();
}

function syncControlLimits() {
  for (const [key, limits] of Object.entries(HICCUP_HEAD_LIMITS)) {
    const input = $(key);
    if (!input || input.type !== "range") continue;
    input.min = String(limits[0]);
    input.max = String(limits[1]);
  }
}

function setStateValue(key, value, { fromCanvas = false } = {}) {
  const values = key === "eyeClosure"
    ? { eyeClosure: value, leftEyeClosure: value, rightEyeClosure: value }
    : { [key]: value };
  state = sanitizeHiccupHeadState({ ...state, ...values }, state);
  const spec = CONTROL_SPECS.find((candidate) => candidate.key === key);
  const input = $(key);
  const output = $(`${key}Out`);
  if (input) {
    input.value = String(state[key]);
    updateRangeFill(input);
  }
  if (output && spec) {
    output.value = spec.format(state[key]);
    output.textContent = output.value;
  }
  if (key === "level") {
    graph?.masterGain?.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
  } else {
    postConfiguration();
  }
  updateHud();
  if (fromCanvas && spec) announce(`${input?.previousElementSibling?.querySelector("b")?.textContent ?? key}: ${spec.format(state[key])}`);
}

function setStateValues(values) {
  state = sanitizeHiccupHeadState({ ...state, ...values }, state);
  let configurationChanged = false;
  for (const key of Object.keys(values)) {
    const spec = CONTROL_SPECS.find((candidate) => candidate.key === key);
    const input = $(key);
    const output = $(`${key}Out`);
    if (input) {
      input.value = String(state[key]);
      updateRangeFill(input);
    }
    if (output && spec) {
      output.value = spec.format(state[key]);
      output.textContent = output.value;
    }
    if (key === "level") {
      graph?.masterGain?.gain.setTargetAtTime(state.level, audioContext.currentTime, 0.012);
    } else {
      configurationChanged = true;
    }
  }
  if (configurationChanged) postConfiguration();
  updateHud();
}

function flushPendingCanvasStateUpdate() {
  if (!pendingCanvasStateUpdate) return;
  const update = pendingCanvasStateUpdate;
  pendingCanvasStateUpdate = null;
  if (pendingCanvasStateFrame) cancelAnimationFrame(pendingCanvasStateFrame);
  pendingCanvasStateFrame = 0;
  if (update.values) setStateValues(update.values);
  else setStateValue(update.key, update.value);
}

function queueCanvasStateUpdate(key, value) {
  pendingCanvasStateUpdate = { key, value };
  if (pendingCanvasStateFrame) return;
  // Pointer hardware can report much faster than either the canvas or audio
  // control rate. Keep the newest value and send at most one update per frame.
  pendingCanvasStateFrame = requestAnimationFrame(() => {
    pendingCanvasStateFrame = 0;
    flushPendingCanvasStateUpdate();
  });
}

function queueCanvasStateUpdates(values) {
  pendingCanvasStateUpdate = { values };
  if (pendingCanvasStateFrame) return;
  // A 2D gesture changes a related pair atomically and still sends no more
  // than one configuration message per animation frame.
  pendingCanvasStateFrame = requestAnimationFrame(() => {
    pendingCanvasStateFrame = 0;
    flushPendingCanvasStateUpdate();
  });
}

function setPreset(id, { announceState = true } = {}) {
  const preset = hiccupHeadPreset(id);
  const transport = {
    tempo: state.tempo,
    swing: state.swing,
    humanize: state.humanize,
    level: state.level,
  };
  state = withPersistentFaceEffects(hiccupHeadState(preset.id, transport), state);
  $("presetSelect").value = preset.id;
  $("presetDescription").textContent = preset.description;
  syncControls();
  postConfiguration();
  if (announceState) announce(`${preset.label} physical face loaded`);
}

function cycleFacePreset(direction = 1) {
  const currentIndex = HICCUP_HEAD_PRESETS.findIndex(({ id }) => id === state.presetId);
  const startIndex = currentIndex >= 0 ? currentIndex : (direction > 0 ? -1 : 0);
  const nextIndex = (startIndex + Math.sign(direction || 1) + HICCUP_HEAD_PRESETS.length)
    % HICCUP_HEAD_PRESETS.length;
  setPreset(HICCUP_HEAD_PRESETS[nextIndex].id);
}

function randomizeFace() {
  const extremeRandom = () => {
    const draw = Math.random();
    if (draw < 0.36) return Math.random() * 0.12;
    if (draw > 0.64) return 0.88 + Math.random() * 0.12;
    return Math.random();
  };
  state = withPersistentFaceEffects(randomizeHiccupHeadState(state, extremeRandom), state);
  // Preserve the extreme visible pose while keeping a viable singing tube.
  state = sanitizeHiccupHeadState({
    ...state,
    lungPressure: clamp(state.lungPressure, 0.5, 1),
    tractLengthM: clamp(state.tractLengthM, 0.07, 0.34),
    mouthOpening: clamp(state.mouthOpening, 0.06, HICCUP_HEAD_LIMITS.mouthOpening[1]),
    lipTension: clamp(state.lipTension, -0.18, 1.35),
    lipRounding: clamp(state.lipRounding, -0.2, 1.4),
    cheekVolume: clamp(state.cheekVolume, 0, 1.5),
    cheekTension: clamp(state.cheekTension, -0.12, 1.35),
    tonguePosition: clamp(state.tonguePosition, -0.25, 1.25),
    tongueCurl: clamp(state.tongueCurl, -0.2, 1.25),
    decay: clamp(state.decay, 0.58, HICCUP_HEAD_LIMITS.decay[1]),
  }, state);
  $("presetDescription").textContent = "A one-off mouth mutation: pressure, tissue, tongue, and cavity moved anywhere from human-ish to gleefully impossible.";
  syncControls();
  postConfiguration();
  announce("Hiccup Head face anatomy randomized");
}

function resetAll() {
  stopSequence({ announceState: false });
  clearTimeout(manualConfigurationResetTimer);
  manualConfigurationResetTimer = 0;
  state = withPersistentFaceEffects({ ...HICCUP_HEAD_DEFAULTS }, state);
  setPreset(HICCUP_HEAD_DEFAULTS.presetId, { announceState: false });
  state.leftBrow = HICCUP_HEAD_DEFAULTS.leftBrow;
  state.rightBrow = HICCUP_HEAD_DEFAULTS.rightBrow;
  eyebrowEmphasis = DEFAULT_EYEBROW_EMPHASIS;
  if ($("eyebrowEmphasis")) $("eyebrowEmphasis").value = String(eyebrowEmphasis);
  if ($("eyebrowEmphasisOut")) {
    $("eyebrowEmphasisOut").value = formatPercent(eyebrowEmphasis);
    $("eyebrowEmphasisOut").textContent = formatPercent(eyebrowEmphasis);
  }
  syncControls();
  postConfiguration();
  setCurrentPattern(HICCUP_HEAD_DEFAULTS.patternId, { announceState: false });
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  graph?.facePostNode?.port.postMessage({ type: "silence" });
  clearNativeRoomHistory();
  soundAnimation = null;
  kissMarks = [];
  brushSweep = null;
  displayedPose = { ...state };
  activeMouthSoundId = "";
  activeVoiceSlot = -1;
  voiceCount = 4;
  voiceSelectionMode = "round-robin";
  voiceCursor = 0;
  voiceSlots = createDefaultVoiceSlots();
  if ($("voiceCount")) $("voiceCount").value = String(voiceCount);
  if ($("voiceCountOut")) {
    $("voiceCountOut").value = String(voiceCount);
    $("voiceCountOut").textContent = String(voiceCount);
  }
  if ($("voiceSelectionMode")) $("voiceSelectionMode").value = "roundRobin";
  buildVoiceRack({ preserveScroll: false });
  Object.assign(handPlacements.left, { x: -0.62, y: 0.1 });
  Object.assign(handPlacements.right, { x: 0.62, y: 0.14 });
  lastTelemetryGestureSoundId = "";
  telemetry = { ...telemetry, activeGesture: false, tractPressure: 0 };
  visualQueue = [];
  visibleStep = -1;
  updateGridPlayhead();
  announce("Hiccup Head face and sequence reset");
}

function resetFaceEffects() {
  const neutral = HICCUP_HEAD_DEFAULTS;
  for (const key of PRESET_INDEPENDENT_EFFECT_PARAMETERS) state[key] = neutral[key];
  state.leftBrow = neutral.leftBrow;
  state.rightBrow = neutral.rightBrow;
  eyebrowEmphasis = DEFAULT_EYEBROW_EMPHASIS;
  if ($("eyebrowEmphasis")) $("eyebrowEmphasis").value = String(eyebrowEmphasis);
  if ($("eyebrowEmphasisOut")) {
    $("eyebrowEmphasisOut").value = formatPercent(eyebrowEmphasis);
    $("eyebrowEmphasisOut").textContent = formatPercent(eyebrowEmphasis);
  }
  // Reset returns the physical controls to useful neutral positions. Effects
  // remain enabled because this single reset button is also the only FX UI.
  state.leftHairLength = Math.max(state.leftHairLength, 0.34);
  state.rightHairLength = Math.max(state.rightHairLength, 0.34);
  state.earSpread = Math.max(state.earSpread, 0.28);
  for (const key of FACE_EFFECT_KEYS) faceEffectEnabled[key] = true;
  syncFaceEffectButtons();
  syncControls();
  postConfiguration();
  announce("Face effects reset to neutral and enabled");
}

function populateSelects() {
  $("presetSelect").replaceChildren(...HICCUP_HEAD_PRESETS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  }));
  const patternOptions = HICCUP_HEAD_PATTERNS.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  });
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom grid";
  custom.disabled = true;
  $("patternSelect").replaceChildren(...patternOptions, custom);
  $("presetSelect").value = state.presetId;
  $("patternSelect").value = currentPatternId;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function faceLayout(pose = state) {
  // The title is an overlay, never layout space. Keep the head centered in the
  // actual drawable pane at every desktop, splitter, and phone size.
  const availableWidth = Math.max(220, cssWidth);
  const cx = cssWidth * 0.5;
  const cy = cssHeight * 0.5;
  const tractWarp = clamp((pose.tractLengthM - 0.165) / 0.18, -0.72, 1.35);
  const widthScale = cssWidth > 720 ? 0.41 : 0.405;
  const boundaryScale = Math.min(cssHeight * 0.465, availableWidth * widthScale);
  const headScale = boundaryScale * clamp(1 + tractWarp * 0.12, 0.72, 1.2);
  const ry = headScale;
  const rx = headScale * clamp(
    0.76 + pose.cheekVolume * 0.25 - tractWarp * 0.05,
    0.48,
    1.48,
  );
  const featureY = cy + ry * 0.1;
  const mouthY = featureY + ry * 0.39;
  // A nonlinear jaw map keeps bilabial closures tight while letting the
  // ordinary human-ish pose open into an outsized rubber resonator.
  const opening = ry * clamp(
    0.018 + Math.pow(Math.max(0, pose.mouthOpening), 0.78) * 0.3,
    0.012,
    0.52,
  );
  return { cx, cy, rx, ry, featureY, mouthY, opening };
}

function telemetryNumber(key, fallback = Number.NaN) {
  const value = Number(telemetry[key]);
  return Number.isFinite(value) ? value : fallback;
}

function knownSoundId(id) {
  return HICCUP_HEAD_SOUNDS.some((sound) => sound.id === id) ? id : "";
}

function physicalTelemetryStatus(now) {
  if (!articulationTelemetryAvailable || now - articulationTelemetryAt > 500) return null;
  const soundId = knownSoundId(telemetry.lastSoundId);
  const active = Boolean(telemetry.activeGesture) && Boolean(soundId);
  const progress = clamp(telemetryNumber("gestureProgress", 0));
  const velocity = clamp(telemetryNumber("velocity", 1), 0.01, 1);
  const reportedAmount = telemetryNumber("gestureAmount");
  const fallbackAmount = Math.sin(Math.PI * progress);
  return {
    active,
    soundId,
    progress,
    velocity,
    amount: clamp(
      Math.abs(Number.isFinite(reportedAmount) ? reportedAmount : fallbackAmount)
        * (0.55 + velocity * 0.45),
    ),
  };
}

function limitedPoseValue(key, value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const limits = HICCUP_HEAD_LIMITS[key];
  return limits ? clamp(value, limits[0], limits[1]) : value;
}

function physicalTelemetryPose(articulation, basePose = state) {
  const pose = { ...basePose };
  const pressure = Math.abs(telemetryNumber("tractPressure", pose.lungPressure));
  const mouthOpening = telemetryNumber("mouthOpening");
  const tonguePosition = telemetryNumber("tonguePosition");
  const tongueCurl = telemetryNumber("tongueCurl");
  const tongueOut = telemetryNumber("tongueOut");
  const velumOpening = telemetryNumber("velumOpening");
  const dooPitch = telemetryNumber("dooPitch");
  const earSpread = telemetryNumber("earSpread");
  const leftHairLength = telemetryNumber("leftHairLength");
  const leftHairAngle = telemetryNumber("leftHairAngle");
  const rightHairLength = telemetryNumber("rightHairLength");
  const rightHairAngle = telemetryNumber("rightHairAngle");
  const eyeDivergence = telemetryNumber("eyeDivergence");
  const eyeClosure = telemetryNumber("eyeClosure");
  const cheekDisplacement = telemetryNumber("cheekDisplacement", 0);
  const lipDiameterCm = Math.max(0, telemetryNumber("lipDiameterCm", Number.NaN));
  const constrictionIndex = telemetryNumber("constrictionIndex");
  const oralSectionCount = Math.max(
    2,
    Math.round(telemetryNumber("oralSectionCount", HICCUP_HEAD_TRACT_SECTION_COUNT)),
  );
  const constrictionDiameterCm = Math.max(
    0,
    telemetryNumber("constrictionDiameterCm", Number.NaN),
  );
  const normalizedConstriction = Number.isFinite(constrictionIndex)
    ? clamp(
      constrictionIndex > 1.5
        ? constrictionIndex / Math.max(1, oralSectionCount - 1)
        : constrictionIndex,
    )
    : Number.NaN;
  const contact = Number.isFinite(constrictionDiameterCm)
    ? 1 - clamp(constrictionDiameterCm / 1.5)
    : 0;

  pose.lungPressure = limitedPoseValue("lungPressure", pressure, pose.lungPressure);
  pose.mouthOpening = limitedPoseValue("mouthOpening", mouthOpening, pose.mouthOpening);
  pose.tonguePosition = limitedPoseValue(
    "tonguePosition",
    tonguePosition,
    Number.isFinite(normalizedConstriction)
      ? normalizedConstriction * 1.25 - 0.12
      : pose.tonguePosition,
  );
  pose.tongueCurl = limitedPoseValue(
    "tongueCurl",
    Number.isFinite(tongueCurl) ? tongueCurl + contact * 0.12 : pose.tongueCurl + contact * 0.28,
    pose.tongueCurl,
  );
  pose.tongueOut = limitedPoseValue("tongueOut", tongueOut, pose.tongueOut ?? 0);
  pose.nasalMix = limitedPoseValue("nasalMix", velumOpening, pose.nasalMix);
  pose.dooPitch = limitedPoseValue("dooPitch", dooPitch, pose.dooPitch);
  pose.earSpread = limitedPoseValue("earSpread", earSpread, pose.earSpread);
  pose.leftHairLength = limitedPoseValue("leftHairLength", leftHairLength, pose.leftHairLength);
  pose.leftHairAngle = limitedPoseValue("leftHairAngle", leftHairAngle, pose.leftHairAngle);
  pose.rightHairLength = limitedPoseValue("rightHairLength", rightHairLength, pose.rightHairLength);
  pose.rightHairAngle = limitedPoseValue("rightHairAngle", rightHairAngle, pose.rightHairAngle);
  pose.eyeDivergence = limitedPoseValue("eyeDivergence", eyeDivergence, pose.eyeDivergence);
  pose.eyeClosure = limitedPoseValue("eyeClosure", eyeClosure, pose.eyeClosure);
  pose.cheekVolume = limitedPoseValue(
    "cheekVolume",
    pose.cheekVolume + cheekDisplacement,
    pose.cheekVolume,
  );
  pose.cheekTension = limitedPoseValue(
    "cheekTension",
    pose.cheekTension + Math.abs(cheekDisplacement) * 0.16,
    pose.cheekTension,
  );

  if (Number.isFinite(lipDiameterCm)) {
    const lipAperture = clamp(lipDiameterCm / 3.2, 0, 1.4);
    pose.lipRounding = limitedPoseValue(
      "lipRounding",
      pose.lipRounding + (0.52 - lipAperture) * 0.52,
      pose.lipRounding,
    );
    pose.lipDiameterCm = lipDiameterCm;
  }
  pose.constrictionIndex = constrictionIndex;
  pose.constrictionDiameterCm = constrictionDiameterCm;
  pose.gestureProgress = articulation.progress;
  pose.tractPressure = pressure;
  pose.velumOpening = velumOpening;
  pose.cheekDisplacement = cheekDisplacement;
  return pose;
}

function activeMotion(now, physicalStatus = physicalTelemetryStatus(now)) {
  const amounts = Object.fromEntries(HICCUP_HEAD_SOUNDS.map(({ id }) => [id, 0]));
  if (physicalStatus) {
    // A fresh worklet report is the single source of truth: never combine its
    // mouth with the timer-based fallback animation.
    soundAnimation = null;
    if (!physicalStatus.active) {
      if (lastTelemetryGestureSoundId) $("soundReadout").textContent = "resting pose";
      activeMouthSoundId = "";
      activeVoiceSlot = -1;
      lastTelemetryGestureSoundId = "";
      return amounts;
    }
    activeMouthSoundId = physicalStatus.soundId;
    amounts[physicalStatus.soundId] = physicalStatus.amount;
    if (lastTelemetryGestureSoundId !== physicalStatus.soundId) {
      const slot = voiceSlots[activeVoiceSlot];
      flashSound(
        physicalStatus.soundId,
        physicalStatus.velocity,
        slot ? {
          slotIndex: activeVoiceSlot,
          label: hiccupHeadVoiceCharacter(slot.voice.characterId).label,
        } : null,
      );
      lastTelemetryGestureSoundId = physicalStatus.soundId;
    }
    return amounts;
  }
  if (soundAnimation && now - soundAnimation.start >= soundAnimation.duration) {
    soundAnimation = null;
    activeVoiceSlot = -1;
    $("soundReadout").textContent = "resting pose";
  }
  const animation = soundAnimation;
  if (!animation) activeMouthSoundId = "";
  if (animation) {
    const phase = clamp((now - animation.start) / animation.duration);
    let envelope = Math.sin(Math.PI * phase);
    if (animation.soundId === "shh") {
      const burst = Math.min(1, phase * 12) * Math.pow(1 - phase, 0.72);
      envelope = burst * (0.78 + Math.sin(phase * 45) * 0.18);
    }
    if (animation.soundId === "shack") envelope = Math.max(
      Math.sin(Math.PI * Math.min(1, phase * 2.2)) * 0.55,
      Math.exp(-Math.abs(phase - 0.48) * 19),
    );
    if (animation.soundId === "pff") envelope *= 0.62 + Math.sin(phase * 44) * 0.28;
    if (animation.soundId === "whistle") {
      const attack = Math.min(1, phase * 13);
      const release = Math.min(1, (1 - phase) * 6);
      envelope = attack * release * (0.9 + Math.sin(phase * 54) * 0.06);
    }
    if (animation.soundId === "kick") envelope = Math.exp(-phase * 6.2);
    if (animation.soundId === "slap" || animation.soundId === "smack") {
      // Show the whole trip into and back out of the cheek. The acoustic
      // contact remains an impulse, but the hand is readable at a glance.
      envelope = Math.pow(Math.sin(Math.PI * phase), 0.72);
    }
    if (animation.soundId === "hee") envelope *= 0.74 + Math.sin(phase * 19) * 0.16;
    if (animation.soundId === "haw") envelope *= 0.8 + Math.sin(phase * 14) * 0.12;
    if (animation.soundId === "doo") envelope *= 0.88 + Math.sin(phase * 22) * 0.08;
    if (animation.soundId === "mwah" || animation.soundId === "kiss") {
      envelope *= 0.62 + phase * 0.55;
    }
    if (animation.soundId === "brush") envelope = Math.sin(Math.PI * phase) * 0.78;
    if (animation.soundId === "drr") envelope *= 0.68 + Math.sin(phase * 58) * 0.29;
    if (animation.soundId === "burp") envelope *= 0.58
      + Math.sin(phase * 23 + Math.sin(phase * 11) * 2.1) * 0.24;
    if (["aah", "ooh", "wail", "holler", "hum"].includes(animation.soundId)) {
      const rates = { aah: 31, ooh: 28, wail: 39, holler: 24, hum: 33 };
      const depths = { aah: 0.08, ooh: 0.1, wail: 0.2, holler: 0.07, hum: 0.12 };
      envelope *= 0.82 + Math.sin(phase * rates[animation.soundId]) * depths[animation.soundId];
    }
    if (animation.soundId === "yodel") envelope *= 0.72
      + (Math.sin(phase * 26) > -0.12 ? 0.22 : -0.12);
    if (animation.soundId === "growl") envelope *= 0.68
      + Math.sin(phase * 47 + Math.sin(phase * 13) * 2.4) * 0.26;
    if (animation.soundId === "rattle") envelope *= 0.64
      + Math.sin(phase * 71 + Math.sin(phase * 19)) * 0.3;
    if (animation.soundId === "grunt") envelope *= 0.7
      + Math.sin(phase * 38 + Math.sin(phase * 9)) * 0.22;
    if (animation.soundId === "moan") envelope *= 0.82 + Math.sin(phase * 24) * 0.12;
    if (animation.soundId === "lala") envelope *= 0.72
      + (Math.sin(phase * 34) > -0.18 ? 0.2 : -0.08);
    if (animation.soundId === "pbpb") envelope *= 0.56 + Math.sin(phase * 82) * 0.36;
    if (animation.soundId === "slurp") {
      envelope *= Math.min(1, phase * 7) * (0.72 + Math.sin(phase * 28) * 0.2);
    }
    amounts[animation.soundId] = envelope * animation.velocity;
  }
  return amounts;
}

function flushVisualQueue(now) {
  const waiting = [];
  for (const event of visualQueue) {
    if (event.due > now + 2) {
      waiting.push(event);
      continue;
    }
    if (event.type === "step") {
      visibleStep = event.step;
      updateGridPlayhead();
      continue;
    }
    const sound = hiccupHeadSound(event.soundId);
    const durations = {
      bop: 210,
      boop: 300,
      pop: 190,
      tlik: 150,
      shh: 250,
      shack: 340,
      slap: 270,
      pff: 520,
      whistle: 1080,
      kick: 360,
      smack: 285,
      hee: 430,
      haw: 440,
      doo: 390,
      mwah: 410,
      kiss: 460,
      drr: 470,
      burp: 620,
      aah: 760,
      ooh: 780,
      wail: 920,
      yodel: 820,
      growl: 840,
      holler: 720,
      hum: 760,
      rattle: 780,
      grunt: 680,
      moan: 920,
      lala: 780,
      pbpb: 540,
      slurp: 640,
      hiccup: 460,
      eef: 620,
      brush: 520,
    };
    const visualTempoScale = TEMPO_STRETCH_SOUND_IDS.has(sound.id)
      ? clamp(Math.sqrt(118 / state.tempo), 0.68, 1.8)
      : 1;
    soundAnimation = {
      soundId: sound.id,
      velocity: event.velocity,
      configuration: event.configuration,
      voiceChoice: event.voiceChoice,
      eventDetails: event.eventDetails,
      start: now,
      duration: prefersReducedMotion
        ? 90
        : (durations[sound.id] ?? 320) * visualTempoScale,
    };
    if (sound.id === "kiss") {
      const placements = [
        [-0.56, -0.08], [0.58, 0.08], [-0.42, 0.38], [0.46, -0.28],
        [0.18, 0.56], [-0.12, -0.58], [0.64, 0.42], [-0.66, 0.24],
      ];
      const [x, y] = placements[kissMarkCursor % placements.length];
      kissMarkCursor += 1;
      kissMarks.push({ x, y, born: now, hue: (kissMarkCursor * 47) % 110 });
      kissMarks = kissMarks.slice(-10);
    }
    if (sound.id === "brush") brushSweep = {
      born: now,
      duration: 520,
      direction: event.eventDetails?.brushDirection === -1 ? -1 : 1,
    };
    activeMouthSoundId = sound.id;
    flashSound(sound.id, event.velocity, event.voiceChoice);
  }
  visualQueue = waiting;
}

function morphDisplayedPose(target, now, isSpeaking) {
  const elapsed = clamp(now - lastDrawTime, 0, 80);
  const timeConstant = prefersReducedMotion ? 1 : isSpeaking ? 46 : 125;
  const amount = 1 - Math.exp(-elapsed / timeConstant);
  const next = { ...target };
  for (const [key, value] of Object.entries(target)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (key === "leftBrow" || key === "rightBrow") {
      next[key] = normalizedBrowValue(value);
      continue;
    }
    const previous = Number(displayedPose[key]);
    next[key] = Number.isFinite(previous) ? previous + (value - previous) * amount : value;
  }
  displayedPose = next;
  lastDrawTime = now;
  return displayedPose;
}

function drawBackground(context, width, height, now, motion) {
  context.fillStyle = "#080507";
  context.fillRect(0, 0, width, height);
  context.save();
  context.strokeStyle = "rgba(255, 111, 121, 0.035)";
  context.lineWidth = 1;
  const grid = 34;
  for (let x = (now * 0.002) % grid; x < width; x += grid) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += grid) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  const total = Object.values(motion).reduce((sum, amount) => sum + amount, 0);
  const glow = context.createRadialGradient(width * 0.56, height * 0.5, 0, width * 0.56, height * 0.5, Math.min(width, height) * 0.6);
  glow.addColorStop(0, `rgba(255, 111, 121, ${0.025 + Math.min(0.12, total * 0.025)})`);
  glow.addColorStop(0.52, "rgba(101, 223, 232, 0.018)");
  glow.addColorStop(1, "rgba(8, 5, 7, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawAirPlume(context, layout, motion, now) {
  const amount = Math.max(
    motion.shh,
    motion.shack * 0.62,
    motion.pff * 0.44,
    motion.haw * 0.54,
    motion.hee * 0.42,
    motion.aah * 0.36,
    motion.wail * 0.44,
    motion.holler * 0.58,
  );
  if (amount < 0.008) return;
  const { cx, rx, mouthY } = layout;
  context.save();
  context.lineCap = "round";
  for (let index = 0; index < 17; index += 1) {
    const phase = ((index * 0.173 + now * 0.00022) % 1);
    const x = cx + rx * (0.36 + phase * 1.15);
    const wave = Math.sin(phase * Math.PI * 3 + index * 1.7 + now * 0.009);
    const y = mouthY + wave * rx * (0.035 + phase * 0.13);
    const size = 1 + (1 - phase) * 2.2;
    context.strokeStyle = `rgba(101, 223, 232, ${amount * (0.12 + (1 - phase) * 0.5)})`;
    context.lineWidth = size;
    context.beginPath();
    context.moveTo(x - 8 - amount * 7, y);
    context.lineTo(x + 6, y + wave * 2);
    context.stroke();
  }
  context.restore();
}

function drawToothWhistleJet(context, layout, motion, now) {
  const amount = motion.whistle ?? 0;
  if (amount < 0.008 || !toothGapGeometry) return;
  const gap = toothGapGeometry;
  const sourceX = gap.x;
  const sourceY = gap.y + gap.height * 0.46;
  const jetLength = layout.rx * (0.92 + amount * 0.5);
  context.save();
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";

  const glowRadius = Math.max(9, gap.width * (0.82 + amount * 0.65));
  const glow = context.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, glowRadius);
  glow.addColorStop(0, `rgba(247, 220, 106, ${0.54 + amount * 0.38})`);
  glow.addColorStop(0.28, `rgba(101, 223, 232, ${0.24 + amount * 0.34})`);
  glow.addColorStop(1, "rgba(101, 223, 232, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(sourceX, sourceY, glowRadius, 0, Math.PI * 2);
  context.fill();

  for (let lane = -2; lane <= 2; lane += 1) {
    const laneOffset = lane * Math.max(0.8, gap.height * 0.085);
    const gradient = context.createLinearGradient(sourceX, sourceY, sourceX + jetLength, sourceY);
    gradient.addColorStop(0, `rgba(247, 220, 106, ${amount * (0.66 - Math.abs(lane) * 0.08)})`);
    gradient.addColorStop(0.32, `rgba(101, 223, 232, ${amount * (0.5 - Math.abs(lane) * 0.055)})`);
    gradient.addColorStop(1, "rgba(101, 223, 232, 0)");
    context.strokeStyle = gradient;
    context.lineWidth = Math.max(0.7, 2.6 - Math.abs(lane) * 0.48) * (0.72 + amount * 0.34);
    context.beginPath();
    context.moveTo(sourceX, sourceY + laneOffset);
    for (let segment = 1; segment <= 12; segment += 1) {
      const progress = segment / 12;
      const whistleWave = Math.sin(now * 0.034 + progress * 15 + lane * 0.9)
        * (0.6 + progress * 2.8) * amount;
      context.lineTo(
        sourceX + jetLength * progress,
        sourceY + laneOffset * (1 + progress * 0.38) + whistleWave,
      );
    }
    context.stroke();
  }

  for (let particle = 0; particle < 9; particle += 1) {
    const phase = (particle / 9 + now * 0.00068) % 1;
    const x = sourceX + jetLength * phase;
    const y = sourceY + Math.sin(now * 0.026 + phase * 17 + particle) * (1 + phase * 4);
    context.fillStyle = `rgba(247, 220, 106, ${amount * (1 - phase) * 0.58})`;
    context.beginPath();
    context.arc(x, y, 0.8 + (1 - phase) * 1.3, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function eyebrowGeometry(layout, pose, side) {
  const { cx, featureY, rx, ry } = layout;
  const leftEye = side < 0;
  const value = normalizedBrowValue(leftEye ? pose.leftBrow : pose.rightBrow);
  const eyeX = cx + side * rx * 0.34;
  const eyeY = featureY - ry * 0.43;
  const eyeRadius = Math.min(rx, ry) * 0.235 * (1 + clamp(pose.silliness) * 0.06);
  const eyeRx = eyeRadius;
  const eyeRy = eyeRadius;
  return {
    x: eyeX,
    y: eyeY - eyeRy * (1.42 + value * 1.13),
    eyeRx,
    eyeRy,
    value,
  };
}

function sideSpaghettiHairGeometry(layout, pose, side) {
  const { cx, cy, rx, ry } = layout;
  const lengthKey = side < 0 ? "leftHairLength" : "rightHairLength";
  const angleKey = side < 0 ? "leftHairAngle" : "rightHairAngle";
  const rawLengthAmount = Number(pose[lengthKey]);
  const rawAngleAmount = Number(pose[angleKey]);
  const lengthAmount = clamp(Number.isFinite(rawLengthAmount) ? rawLengthAmount : 0.14, 0.14, 1);
  const angleAmount = clamp(Number.isFinite(rawAngleAmount) ? rawAngleAmount : 0, -1, 1);
  const angleRadians = angleAmount * 0.62;
  const directionX = side * Math.cos(angleRadians);
  const directionY = Math.sin(angleRadians);
  const rawLength = rx * (0.08 + lengthAmount * 1.02);
  // Roots tuck behind the lower side silhouette. The paint pass clips
  // away the in-face portion, so the spaghetti appears to grow out from under
  // the skull edge without crossing the forehead or eye anatomy.
  const rootX = cx + side * rx * 0.8;
  const rootY = cy - ry * 0.34;
  const horizontalRoom = Math.max(28, side < 0 ? rootX - 10 : cssWidth - rootX - 10);
  const horizontalLimit = horizontalRoom / Math.max(0.28, Math.abs(directionX));
  const verticalRoom = directionY < 0 ? rootY - 10 : cssHeight - rootY - 10;
  const verticalLimit = Math.abs(directionY) > 0.04
    ? Math.max(28, verticalRoom) / Math.abs(directionY)
    : Infinity;
  const length = Math.min(rawLength, horizontalLimit, verticalLimit);
  return {
    rootX,
    rootY,
    length,
    lengthKey,
    angleKey,
    lengthAmount,
    angleAmount,
    angleRadians,
    directionX,
    directionY,
    tipX: rootX + directionX * length,
    tipY: rootY + directionY * length,
  };
}

function appendHeadSilhouette(context, layout, pop = 0, slap = 0) {
  const { cx, cy, rx, ry } = layout;
  context.moveTo(cx, cy - ry);
  context.bezierCurveTo(
    cx + rx * 0.78,
    cy - ry * 0.98,
    cx + rx * (1.02 + pop * 0.12),
    cy - ry * 0.32,
    cx + rx * (0.94 + pop * 0.16),
    cy + ry * 0.2,
  );
  context.bezierCurveTo(
    cx + rx * 0.88,
    cy + ry * 0.62,
    cx + rx * 0.42,
    cy + ry * 0.98,
    cx,
    cy + ry,
  );
  context.bezierCurveTo(
    cx - rx * 0.42,
    cy + ry * 0.98,
    cx - rx * 0.88,
    cy + ry * 0.62,
    cx - rx * (0.94 + slap * 0.16),
    cy + ry * 0.2,
  );
  context.bezierCurveTo(
    cx - rx * (1.02 + slap * 0.12),
    cy - ry * 0.32,
    cx - rx * 0.78,
    cy - ry * 0.98,
    cx,
    cy - ry,
  );
  context.closePath();
}

function drawFace(context, layout, pose, motion, now, checkerStep = -1) {
  const { cx, cy, rx, ry, featureY, mouthY, opening } = layout;
  const whistle = motion.whistle ?? 0;
  const slap = Math.max(motion.slap, motion.smack * 0.34);
  const smack = motion.smack;
  const pop = motion.pop;
  const shack = motion.shack;
  const grunt = motion.grunt ?? 0;
  const moan = motion.moan ?? 0;
  const lala = motion.lala ?? 0;
  const pbpb = motion.pbpb ?? 0;
  const slurp = motion.slurp ?? 0;
  const hiccup = motion.hiccup ?? 0;
  const eef = motion.eef ?? 0;
  const eefPull = eef * Math.sin(now * 0.038);
  const wobble = (slap * -1 + smack * 0.92 + pop * 0.38 + shack * 0.18)
    * (0.018 + state.silliness * 0.025);
  const goofballEnergy = clamp(pose.silliness, 0, 1);
  const idlePhase = prefersReducedMotion ? 0 : now * 0.00105;
  const idleBob = prefersReducedMotion
    ? 0
    : Math.sin(idlePhase * 1.67 + 0.4) * ry * (0.006 + goofballEnergy * 0.003);
  const idleTilt = prefersReducedMotion
    ? 0
    : (Math.sin(idlePhase) + Math.sin(idlePhase * 2.31 + 1.2) * 0.34)
      * (0.006 + goofballEnergy * 0.004);
  const idleSquash = prefersReducedMotion
    ? 0
    : Math.sin(idlePhase * 1.67 + Math.PI * 0.5) * (0.0035 + goofballEnergy * 0.0025);
  context.save();
  // Reset inherited paint state before drawing the intentional black-stage
  // negative-space head and its bright contour/features.
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.filter = "none";
  context.shadowColor = "rgba(0, 0, 0, 0)";
  context.shadowBlur = 0;
  // A tiny uneven bob and counter-squash makes the face feel rubbery while
  // keeping every control visually stable on a narrow phone. Reduced-motion
  // users get the exact resting pose.
  context.translate(cx, cy + idleBob - hiccup * ry * 0.028);
  context.rotate(wobble + idleTilt);
  context.scale(
    1 + idleSquash + hiccup * 0.035,
    1 - idleSquash * 0.72 - hiccup * 0.07,
  );
  context.translate(-cx, -cy);

  // Each ear has its own short elastic tether back to the adjacent head edge.
  // The two tethers remain independent and never cross the face.
  const earSpread = clamp(Math.max(HICCUP_HEAD_DEFAULTS.earSpread, pose.earSpread));
  const compactHair = usesCompactCanvas();
  for (const side of [-1, 1]) {
    context.save();
    const earX = cx + side * rx * (0.88 + earSpread * 0.64);
    const earY = cy + ry * 0.03;
    const earRx = rx * (0.12 + earSpread * 0.045);
    const earRy = ry * (0.19 + earSpread * 0.035);
    const tetherHeadX = cx + side * rx * 0.84;
    const tetherHeadY = earY;
    const tetherEarX = earX;
    const tetherEarY = earY;
    const tetherDx = tetherEarX - tetherHeadX;
    const tetherDy = tetherEarY - tetherHeadY;
    const tetherLength = Math.max(1, Math.hypot(tetherDx, tetherDy));
    const tetherNormalX = -tetherDy / tetherLength;
    const tetherNormalY = tetherDx / tetherLength;
    const tetherTurns = 3 + Math.round(earSpread * 3);
    const tetherAmplitude = clamp(2 + earSpread * 3.4, 2, 5.4);
    const tetherSegments = compactHair ? 18 : 24;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(tetherHeadX, tetherHeadY);
    for (let segment = 1; segment <= tetherSegments; segment += 1) {
      const progress = segment / tetherSegments;
      const coil = Math.sin(progress * tetherTurns * Math.PI * 2) * tetherAmplitude;
      context.lineTo(
        tetherHeadX + tetherDx * progress + tetherNormalX * coil,
        tetherHeadY + tetherDy * progress + tetherNormalY * coil,
      );
    }
    context.strokeStyle = "rgba(81, 38, 79, 0.9)";
    context.lineWidth = compactHair ? 3.6 : 4.4;
    context.stroke();
    context.strokeStyle = side < 0 ? "rgb(183, 116, 237)" : "rgb(120, 78, 194)";
    context.lineWidth = compactHair ? 1.4 : 1.8;
    context.stroke();
    context.restore();
  }

  // Each side owns its own polar spaghetti control: length changes radial
  // reach/feedback amount and angle rotates delay time. Neither side reads the
  // other side or earSpread. Light bezier bends keep the larger spaghetti
  // bundles organic without adding animated geometry or audio-thread work. An
  // exterior clip hides only the short root section tucked behind the skull.
  context.save();
  context.beginPath();
  context.rect(-cssWidth, -cssHeight, cssWidth * 3, cssHeight * 3);
  appendHeadSilhouette(context, layout, pop, slap);
  context.clip("evenodd");
  for (const side of [-1, 1]) {
    const hair = sideSpaghettiHairGeometry(layout, pose, side);
    const strandCount = compactHair ? 11 : 15;
    for (let strand = 0; strand < strandCount; strand += 1) {
      const fraction = strand / Math.max(1, strandCount - 1);
      const fan = fraction - 0.5;
      const strandLength = hair.length * (0.72 + ((strand * 7 + (side > 0 ? 2 : 0)) % 6) * 0.052);
      const rootX = hair.rootX + side * rx * fan * 0.15;
      const rootY = hair.rootY + fan * ry * 0.4;
      const irregular = Math.sin(strand * 2.37 + side * 0.91);
      const strandAngle = hair.angleRadians + irregular * 0.075;
      const directionX = side * Math.cos(strandAngle);
      const directionY = Math.sin(strandAngle);
      const normalX = -directionY;
      const normalY = directionX;
      const tipX = rootX + directionX * strandLength;
      const tipY = rootY + directionY * strandLength;
      const curveAmount = (fan * 0.62 + irregular * 0.38) * strandLength * 0.27;
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(rootX, rootY);
      context.bezierCurveTo(
        rootX + directionX * strandLength * 0.3 + normalX * curveAmount,
        rootY + directionY * strandLength * 0.3 + normalY * curveAmount,
        rootX + directionX * strandLength * 0.7 - normalX * curveAmount * 0.42,
        rootY + directionY * strandLength * 0.7 - normalY * curveAmount * 0.42,
        tipX,
        tipY,
      );
      context.strokeStyle = "rgba(64, 27, 62, 0.82)";
      context.lineWidth = (compactHair ? 6.2 : 7.4) + (strand % 3) * 0.55;
      context.stroke();
      context.strokeStyle = strand % 3 === 0
        ? "rgba(240, 127, 208, 0.96)"
        : strand % 3 === 1
          ? "rgba(187, 140, 255, 0.96)"
          : "rgba(101, 223, 232, 0.94)";
      context.lineWidth = (compactHair ? 3.8 : 4.8) + (strand % 3) * 0.42;
      context.stroke();
      context.restore();
    }
  }
  context.restore();

  const skinCheckerColors = skinCheckerColorsForStep(checkerStep);

  // Ears are stereo controls, not ornaments: pulling either ear outward
  // widens the binaural spacing and lengthens the tiny interaural delay.
  for (const side of [-1, 1]) {
    const earX = cx + side * rx * (0.88 + earSpread * 0.64);
    const earY = cy + ry * 0.03;
    const earRadius = Math.min(rx, ry) * (0.15 + earSpread * 0.04);
    context.fillStyle = skinCheckerColors[side < 0 ? 0 : 1];
    context.strokeStyle = side < 0
      ? `rgba(183, 116, 237, ${0.74 + earSpread * 0.22})`
      : `rgba(120, 78, 194, ${0.74 + earSpread * 0.22})`;
    context.lineWidth = 3.2;
    context.beginPath();
    context.arc(earX, earY, earRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.strokeStyle = side < 0
      ? `rgba(229, 188, 255, ${0.48 + earSpread * 0.28})`
      : `rgba(190, 153, 238, ${0.48 + earSpread * 0.28})`;
    context.lineWidth = 1.35;
    context.beginPath();
    context.arc(
      earX - side * earRadius * 0.04,
      earY,
      earRadius * 0.56,
      side < 0 ? -Math.PI * 0.58 : Math.PI * 0.42,
      side < 0 ? Math.PI * 0.67 : Math.PI * 1.67,
      side > 0,
    );
    context.stroke();
  }

  // An opaque two-color checkerboard supplies the skin. Both checker paths
  // share the deforming silhouette clip, while
  // batching each color into one fill keeps the phone paint cost bounded.
  context.save();
  context.beginPath();
  appendHeadSilhouette(context, layout, pop, slap);
  context.clip();
  const skinCheckerSize = clamp(Math.min(rx, ry) * 0.18, 22, 34);
  const skinCheckerLeft = Math.floor(
    (cx - rx * 1.24) / skinCheckerSize,
  ) * skinCheckerSize;
  const skinCheckerTop = Math.floor(
    (cy - ry * 1.08) / skinCheckerSize,
  ) * skinCheckerSize;
  const skinCheckerRight = cx + rx * 1.24;
  const skinCheckerBottom = cy + ry * 1.08;
  for (let colorIndex = 0; colorIndex < skinCheckerColors.length; colorIndex += 1) {
    context.beginPath();
    let rowIndex = 0;
    for (
      let checkerY = skinCheckerTop;
      checkerY < skinCheckerBottom;
      checkerY += skinCheckerSize
    ) {
      let columnIndex = 0;
      for (
        let checkerX = skinCheckerLeft;
        checkerX < skinCheckerRight;
        checkerX += skinCheckerSize
      ) {
        if ((rowIndex + columnIndex) % 2 === colorIndex) {
          context.rect(checkerX, checkerY, skinCheckerSize, skinCheckerSize);
        }
        columnIndex += 1;
      }
      rowIndex += 1;
    }
    context.fillStyle = skinCheckerColors[colorIndex];
    context.fill();
  }
  context.restore();

  // Restore the stroke state after the skin fill. The head remains one strong
  // contour over its opaque checkerboard.
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.strokeStyle = "rgba(151, 92, 220, 0.98)";
  const featureOutlineWidth = 3.2;
  context.lineWidth = featureOutlineWidth;
  context.beginPath();
  context.moveTo(cx, cy - ry);
  context.bezierCurveTo(cx + rx * 0.78, cy - ry * 0.98, cx + rx * (1.02 + pop * 0.12), cy - ry * 0.32, cx + rx * (0.94 + pop * 0.16), cy + ry * 0.2);
  context.bezierCurveTo(cx + rx * 0.88, cy + ry * 0.62, cx + rx * 0.42, cy + ry * 0.98, cx, cy + ry);
  context.bezierCurveTo(cx - rx * 0.42, cy + ry * 0.98, cx - rx * 0.88, cy + ry * 0.62, cx - rx * (0.94 + slap * 0.16), cy + ry * 0.2);
  context.bezierCurveTo(cx - rx * (1.02 + slap * 0.12), cy - ry * 0.32, cx - rx * 0.78, cy - ry * 0.98, cx, cy - ry);
  context.closePath();
  context.stroke();

  // Two large matched circular eyes and independently wandering pupils provide
  // the character above the translucent checker skin.
  const gazePhase = prefersReducedMotion ? 0.72 : now * 0.00125;
  for (const side of [-1, 1]) {
    const leftEye = side < 0;
    const independentEyeClosure = Number(
      leftEye ? pose.leftEyeClosure : pose.rightEyeClosure,
    );
    const eyeClosure = clamp(Number.isFinite(independentEyeClosure)
      ? independentEyeClosure
      : Number(pose.eyeClosure) || 0);
    const eyeX = cx + side * rx * 0.34;
    const eyeY = featureY - ry * 0.43;
    const eyeRadius = Math.min(rx, ry) * 0.235 * (1 + goofballEnergy * 0.06);
    const eyeRx = eyeRadius;
    const baseEyeRy = eyeRadius;
    const eyeRy = baseEyeRy;
    const eyeRotation = 0;
    context.save();
    context.translate(eyeX, eyeY);
    context.rotate(eyeRotation);
    context.fillStyle = "rgba(250, 243, 224, 0.91)";
    context.strokeStyle = "rgba(73, 38, 50, 0.74)";
    context.lineWidth = featureOutlineWidth;
    context.beginPath();
    context.ellipse(0, 0, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.save();
    context.beginPath();
    context.ellipse(0, 0, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    context.clip();
    const irisRadius = Math.max(5, eyeRadius * 0.38);
    // Pupils only move when the player moves the eyes. Automatic wandering
    // made the face controls look unstable and obscured the reverb position.
    const pupilDriftX = 0;
    const pupilDriftY = 0;
    const maxGazeX = Math.max(0, eyeRx - irisRadius * 1.14);
    const maxGazeY = Math.max(0, eyeRy - irisRadius * 1.14);
    const gazeX = clamp(
      side * eyeRx * pose.eyeDivergence * 0.78
        + pupilDriftX
        + wobble * 55,
      -maxGazeX,
      maxGazeX,
    );
    const gazeY = clamp(
      pupilDriftY + (leftEye ? -1 : 1) * eyeRy * 0.05,
      -maxGazeY,
      maxGazeY,
    );
    const irisGradient = context.createRadialGradient(
      gazeX - irisRadius * 0.22,
      gazeY - irisRadius * 0.24,
      irisRadius * 0.08,
      gazeX,
      gazeY,
      irisRadius,
    );
    irisGradient.addColorStop(0, "rgba(255, 255, 255, 0.96)");
    irisGradient.addColorStop(0.2, "rgba(187, 140, 255, 0.96)");
    irisGradient.addColorStop(1, "rgba(101, 223, 232, 0.92)");
    context.fillStyle = irisGradient;
    context.strokeStyle = "rgba(8, 5, 7, 0.86)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(gazeX, gazeY, irisRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(5, 3, 5, 0.96)";
    context.beginPath();
    context.arc(gazeX, gazeY, irisRadius * 0.46, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.beginPath();
    context.arc(gazeX - irisRadius * 0.24, gazeY - irisRadius * 0.28, Math.max(1.5, irisRadius * 0.13), 0, Math.PI * 2);
    context.fill();
    context.restore();

    // Each eye remains the same circular size. Opaque colored lid tissue
    // slides over its top and bottom independently instead of squeezing the
    // eyeball or drawing long lines outside it.
    const lidCover = 0.08 + eyeClosure * 0.44;
    const lidEdgeY = eyeRy * (-1 + lidCover * 2);
    context.save();
    context.beginPath();
    context.arc(0, 0, eyeRadius, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = leftEye ? "rgb(244, 126, 173)" : "rgb(157, 218, 125)";
    context.beginPath();
    context.moveTo(-eyeRx, -eyeRy);
    context.lineTo(eyeRx, -eyeRy);
    context.lineTo(eyeRx, lidEdgeY);
    context.quadraticCurveTo(0, lidEdgeY + eyeRy * 0.12, -eyeRx, lidEdgeY);
    context.closePath();
    context.fill();
    context.fillStyle = leftEye ? "rgb(255, 164, 92)" : "rgb(255, 218, 105)";
    context.beginPath();
    context.moveTo(-eyeRx, eyeRy);
    context.lineTo(eyeRx, eyeRy);
    context.lineTo(eyeRx, -lidEdgeY);
    context.quadraticCurveTo(0, -lidEdgeY - eyeRy * 0.08, -eyeRx, -lidEdgeY);
    context.closePath();
    context.fill();
    context.restore();
    context.strokeStyle = "rgba(76, 38, 92, 0.9)";
    context.lineWidth = featureOutlineWidth;
    context.beginPath();
    context.ellipse(0, 0, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    const brow = eyebrowGeometry(layout, pose, side);
    const browStartY = brow.y + brow.eyeRy * (leftEye ? 0.16 : -0.02);
    const browEndY = brow.y + brow.eyeRy * (leftEye ? 0.03 : 0.22);
    context.strokeStyle = "rgba(67, 31, 46, 0.9)";
    context.lineWidth = 13.2 + goofballEnergy * 2.8;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(brow.x - brow.eyeRx * 1.08, browStartY);
    context.quadraticCurveTo(
      brow.x + side * brow.eyeRx * (leftEye ? 0.08 : 0.2),
      brow.y - brow.eyeRy * (0.24 + brow.value * 0.16),
      brow.x + brow.eyeRx * 1.08,
      browEndY,
    );
    context.stroke();
    context.strokeStyle = leftEye
      ? "rgba(255, 79, 126, 0.96)"
      : "rgba(45, 203, 218, 0.96)";
    context.lineWidth = 8.2 + goofballEnergy * 1.7;
    context.stroke();
  }

  // One oversized glossy clown-red circle exposes the live nasal resonator.
  const noseX = cx + Math.sin(gazePhase * 0.7) * rx * goofballEnergy * 0.008;
  const noseHonkAge = now - noseHonkStartedAt;
  const noseHonkAmount = noseHonkAge >= 0 && noseHonkAge < 320
    ? Math.sin((noseHonkAge / 320) * Math.PI) ** 0.7
    : 0;
  // Lifting the red nose opens the nasal branch, whether changed by mutation,
  // a preset, or direct manipulation.
  const noseY = featureY + ry * 0.045 - ry * pose.nasalMix * 0.32
    - ry * noseHonkAmount * 0.14;
  const noseRadius = Math.min(rx, ry)
    * (0.135 + pose.nasalMix * 0.022)
    * (1 + noseHonkAmount * 0.28);
  context.strokeStyle = `rgba(101, 223, 232, ${0.22 + pose.nasalMix * 0.5})`;
  context.lineWidth = 1.35;
  context.beginPath();
  context.moveTo(cx - rx * 0.015, featureY - ry * 0.42);
  context.bezierCurveTo(
    cx + rx * 0.055,
    featureY - ry * 0.34,
    noseX - noseRadius * 0.42,
    noseY - noseRadius * 0.66,
    noseX,
    noseY - noseRadius * 0.35,
  );
  context.stroke();
  context.fillStyle = "#FF0000";
  context.strokeStyle = `rgba(105, 0, 0, ${0.84 + pose.nasalMix * 0.12})`;
  context.lineWidth = featureOutlineWidth;
  context.beginPath();
  context.arc(noseX, noseY, noseRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "rgba(255, 238, 230, 0.84)";
  context.beginPath();
  context.arc(
    noseX - noseRadius * 0.38,
    noseY - noseRadius * 0.4,
    noseRadius * 0.17,
    0,
    Math.PI * 2,
  );
  context.fill();
  const mouthPulse = Math.max(
    motion.bop * 0.48,
    motion.boop * 0.68,
    motion.shack,
    motion.pff * 0.5,
    motion.kick * 0.42,
    motion.smack * 0.3,
    motion.hee * 0.66,
    motion.haw * 0.82,
    motion.doo * 0.76,
    motion.mwah * 0.9,
    motion.drr * 0.58,
    motion.burp * 0.86,
    whistle * 0.34,
    motion.aah * 0.94,
    motion.ooh * 0.88,
    motion.wail,
    motion.yodel * 0.92,
    motion.growl * 0.86,
    motion.holler,
    motion.hum * 0.54,
    motion.rattle * 0.82,
    grunt * 0.82,
    moan * 0.94,
    lala * 0.9,
    pbpb * 0.7,
    slurp * 0.64,
  );
  const roundedGesture = motion.boop * 0.9
    + motion.pop * 0.46
    + motion.pff * 0.38
    + motion.doo * 0.8
    + motion.mwah * 0.95
    + motion.burp * 0.3
    + whistle * 0.72
    + motion.ooh * 1.05
    + motion.hum * 0.88
    + moan * 0.3
    + pbpb * 1.05
    + slurp * 0.84;
  const spreadGesture = motion.shh * 0.48
    + motion.tlik * 0.22
    + motion.shack * 0.16
    + motion.hee * 0.72
    + motion.haw * 0.38
    + motion.drr * 0.22
    + motion.aah * 0.44
    + motion.wail * 0.62
    + motion.yodel * 0.36
    + motion.growl * 0.3
    + motion.holler * 0.52
    + motion.rattle * 0.18
    + grunt * 0.22
    + lala * 0.76;
  const flutter = (motion.pff * Math.sin(now * 0.045)
    + motion.drr * Math.sin(now * 0.074)
    + motion.burp * Math.sin(now * 0.026 + Math.sin(now * 0.011))
    + motion.wail * Math.sin(now * 0.034)
    + motion.yodel * Math.sign(Math.sin(now * 0.022)) * 0.58
    + motion.growl * Math.sin(now * 0.058 + Math.sin(now * 0.017))
    + motion.rattle * Math.sin(now * 0.092)
    + grunt * Math.sin(now * 0.061 + Math.sin(now * 0.014))
    + moan * Math.sin(now * 0.028)
    + lala * Math.sin(now * 0.047)
    + pbpb * Math.sin(now * 0.12)
    + slurp * Math.sin(now * 0.039)
    + whistle * Math.sin(now * 0.052) * 0.1)
    * (0.08 + state.silliness * 0.06);
  const lipDiameterCm = Number(pose.lipDiameterCm);
  const physicalLipAperture = Number.isFinite(lipDiameterCm)
    ? clamp(lipDiameterCm / 3.2, 0, 1.4)
    : Number.NaN;
  // Anatomy warp is deliberately signed and nonlinear: projected/rounded
  // lips plus high silliness can collapse the resting mouth to a tiny valve,
  // while spread gestures still reopen that same one-mouth path.
  const mouthWidth = rx * clamp(
    0.68
      - pose.lipRounding * 0.18
      - Math.pow(goofballEnergy, 1.35) * 0.34
      + spreadGesture * 0.42
      - roundedGesture * 0.3
      + eefPull * 0.22
      + flutter * 0.42,
    0.1,
    0.96,
  );
  let liveOpening = opening * clamp(
    1 + mouthPulse * (0.75 + state.silliness * 0.45)
      + motion.tlik * 0.42
      + motion.haw * 0.28
      + motion.burp * 0.34
      + motion.aah * 0.46
      + motion.wail * 0.48
      + motion.yodel * 0.34
      + motion.growl * 0.28
      + motion.holler * 0.5
      + motion.rattle * 0.22
      + grunt * 0.26
      + moan * 0.42
      + lala * 0.38
      + pbpb * 0.3
      + slurp * 0.22
      - motion.shh * 0.18
      - motion.hee * 0.12
      - motion.ooh * 0.08
      - motion.hum * 0.64
      + flutter,
    0.12,
    3.2,
  );
  if (Number.isFinite(physicalLipAperture)) {
    // The actual lip valve can seal an otherwise open jaw, as in bilabial
    // pressure build-up, without inventing a second visual mouth layer.
    liveOpening *= clamp(0.06 + physicalLipAperture * 1.3, 0.06, 1.55);
  }
  // Mouth aperture follows only mouth/lip articulation. Nose size, nasal mix,
  // and the quack bounce never clamp or otherwise move the mouth.
  liveOpening = clamp(
    liveOpening,
    Math.max(1.2, ry * 0.004),
    ry * 0.56,
  );

  const lipRimWidth = clamp(Math.min(rx, ry) * 0.04, 5, 10);
  // Exactly one simple oral oval: the dark-green stroke is the lip, and the
  // black fill is the cavity. Sound gestures reshape this one path only.
  context.fillStyle = "rgba(4, 3, 4, 0.96)";
  context.strokeStyle = `rgba(34, 139, 79, ${0.9 + mouthPulse * 0.1})`;
  context.lineWidth = lipRimWidth;
  context.beginPath();
  context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  // These are discrete upper teeth, not a white strip with separator marks.
  // One entire front-incisor cell is never drawn: the actual cavity behind it
  // remains visible and becomes Hiccup Head's pressure-whistle nozzle.
  const teethWidth = mouthWidth * 1.34;
  const teethX = cx - teethWidth * 0.5;
  const teethY = mouthY - liveOpening * 0.82;
  const teethHeight = clamp(liveOpening * 0.52, 7, ry * 0.12);
  // Keep twelve tappable wood tines at every viewport size, plus one central
  // empty cell for the pressure-whistle gap.
  const toothCount = TOOTH_TINE_PROFILES.length + 1;
  const toothCellWidth = teethWidth / toothCount;
  const missingFrontIncisor = Math.floor(toothCount / 2);
  toothGapGeometry = {
    x: teethX + (missingFrontIncisor + 0.5) * toothCellWidth,
    y: teethY,
    width: toothCellWidth,
    height: teethHeight,
  };
  toothTines = [];
  if (toothTineHit && now - toothTineHit.start >= toothTineHit.duration) {
    toothTineHit = null;
  }

  if (liveOpening > 3) {
    // Tooth paint is clipped to the one oral cavity, so the surrounding lip
    // mass always occludes every tooth top at the gum boundary. Geometry for the
    // tappable tines and missing FWEE gap stays unchanged and fully live.
    context.save();
    context.beginPath();
    context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
    context.clip();

    const toothFill = context.createLinearGradient(0, teethY, 0, teethY + teethHeight);
    toothFill.addColorStop(0, "rgba(255, 252, 231, 0.94)");
    toothFill.addColorStop(1, "rgba(224, 210, 181, 0.84)");
    for (let tooth = 0; tooth < toothCount; tooth += 1) {
      if (tooth === missingFrontIncisor) continue;
      const progress = (tooth + 0.5) / toothCount;
      const profileIndex = tooth < missingFrontIncisor ? tooth : tooth - 1;
      const profile = TOOTH_TINE_PROFILES[profileIndex];
      const inset = clamp(toothCellWidth * 0.075, 0.65, 1.6);
      const toothX = teethX + tooth * toothCellWidth + inset;
      const width = toothCellWidth - inset * 2;
      const centrality = 1 - Math.min(1, Math.abs(progress - 0.5) * 2);
      const height = teethHeight * (0.86 + centrality * 0.14);
      const hitPhase = toothTineHit?.toothIndex === profileIndex
        ? clamp((now - toothTineHit.start) / toothTineHit.duration)
        : 1;
      const hitAmount = hitPhase < 1
        ? Math.sin(hitPhase * Math.PI) * toothTineHit.velocity
        : 0;
      const tineY = teethY - hitAmount * Math.max(1.5, height * 0.22);
      const lean = Math.sin(progress * Math.PI * 3 + goofballEnergy) * height * 0.06;
      const corner = Math.min(3.2, width * 0.16, height * 0.24);
      toothTines.push({
        type: "tooth-tine",
        toothIndex: profileIndex,
        x: toothX + width * 0.5,
        y: teethY + height * 0.5,
        width,
        height,
        frequencyHz: profile.frequencyHz,
        brightness: profile.brightness,
      });
      context.save();
      if (hitAmount > 0.01 && !usesCompactCanvas()) {
        context.shadowColor = "rgba(247, 220, 106, 0.92)";
        context.shadowBlur = 5 + hitAmount * 9;
      }
      context.beginPath();
      context.moveTo(toothX + lean, tineY);
      context.lineTo(toothX + width + lean, tineY);
      context.lineTo(toothX + width - lean, tineY + height - corner);
      context.quadraticCurveTo(
        toothX + width * 0.78 - lean,
        tineY + height + corner * 0.2,
        toothX + width * 0.5 - lean,
        tineY + height,
      );
      context.quadraticCurveTo(
        toothX + width * 0.22 - lean,
        tineY + height + corner * 0.2,
        toothX - lean,
        tineY + height - corner,
      );
      context.closePath();
      context.fillStyle = hitAmount > 0.01
        ? `rgba(247, 220, 106, ${0.72 + hitAmount * 0.28})`
        : toothFill;
      context.fill();
      context.strokeStyle = hitAmount > 0.01
        ? `rgba(101, 223, 232, ${0.62 + hitAmount * 0.35})`
        : "rgba(91, 34, 51, 0.5)";
      context.lineWidth = 0.85 + hitAmount * 0.9;
      context.stroke();
      context.restore();
    }

    // A small gum socket contour makes the missing incisor legible even when
    // the mouth is moving, while leaving the gap itself as untouched cavity.
    const gapLeft = toothGapGeometry.x - toothCellWidth * 0.42;
    const gapRight = toothGapGeometry.x + toothCellWidth * 0.42;
    context.strokeStyle = `rgba(255, 111, 121, ${0.56 + whistle * 0.36})`;
    context.lineWidth = 1.1 + whistle * 1.4;
    context.beginPath();
    context.moveTo(gapLeft, teethY + 0.5);
    context.quadraticCurveTo(
      toothGapGeometry.x,
      teethY + teethHeight * 0.22,
      gapRight,
      teethY + 0.5,
    );
    context.stroke();

    context.restore();

  }

  // One continuous tongue changes from an internal body into a protruding
  // flap. LALA, DRR, and SLURP add gesture motion to the live tongue-out
  // control; no second tongue layer is introduced.
  const tongueX = cx + (pose.tonguePosition - 0.5) * mouthWidth * 0.66;
  const constrictionDiameterCm = Number(pose.constrictionDiameterCm);
  const constrictionContact = Number.isFinite(constrictionDiameterCm)
    ? 1 - clamp(constrictionDiameterCm / 1.5)
    : 0;
  const tongueLift = motion.tlik * liveOpening * 0.55
    + pose.tongueCurl * liveOpening * 0.2
    + constrictionContact * liveOpening * 0.32;
  const tongueOut = clamp(Number(pose.tongueOut) || 0, 0, 1.6);
  const gestureTongueOut = lala * 0.62 + motion.drr * 0.4 + slurp * 0.82;
  const liveTongueOut = clamp(tongueOut + gestureTongueOut, 0, 1.9);
  const tongueTipX = tongueX + (slurp - lala * 0.18) * mouthWidth * 0.12;
  const tongueTipY = mouthY + liveOpening * 0.78
    + liveTongueOut * (ry * 0.15 + liveOpening * 0.15);
  const tongueTipWidth = mouthWidth * clamp(0.31 - pose.tongueCurl * 0.045, 0.18, 0.4);
  tongueTipGeometry = {
    x: tongueTipX,
    y: tongueTipY,
    width: tongueTipWidth,
    height: Math.max(8, liveOpening * 0.42),
  };
  // Paint the tongue as the final opaque oral layer in front of lips and face.
  // Its contrasting color rotates with the sequencer's changing face skin.
  const tongueColorIndex = checkerStep >= 0
    ? checkerStep % TONGUE_STEP_COLORS.length
    : 0;
  context.fillStyle = TONGUE_STEP_COLORS[tongueColorIndex];
  context.strokeStyle = "rgba(55, 16, 31, 0.72)";
  context.lineWidth = 1 + liveTongueOut * 0.3;
  context.beginPath();
  context.moveTo(cx - mouthWidth * 0.57, mouthY + liveOpening * 0.68);
  context.quadraticCurveTo(tongueX, mouthY + liveOpening * 0.24 - tongueLift, cx + mouthWidth * 0.58, mouthY + liveOpening * 0.7);
  context.bezierCurveTo(
    cx + mouthWidth * 0.42,
    mouthY + liveOpening * (0.88 + liveTongueOut * 0.08),
    tongueTipX + tongueTipWidth * 0.62,
    tongueTipY - tongueTipGeometry.height * 0.15,
    tongueTipX + tongueTipWidth * 0.48,
    tongueTipY,
  );
  context.quadraticCurveTo(
    tongueTipX,
    tongueTipY + tongueTipGeometry.height * (0.22 + pose.tongueCurl * 0.08),
    tongueTipX - tongueTipWidth * 0.48,
    tongueTipY,
  );
  context.bezierCurveTo(
    tongueTipX - tongueTipWidth * 0.62,
    tongueTipY - tongueTipGeometry.height * 0.15,
    cx - mouthWidth * 0.42,
    mouthY + liveOpening * (0.9 + liveTongueOut * 0.07),
    cx - mouthWidth * 0.57,
    mouthY + liveOpening * 0.68,
  );
  context.closePath();
  context.fill();
  context.stroke();

  // Pressure path and valve diagrams stay visible through the skin.
  const pressureAlpha = 0.14 + Math.min(0.52, pose.lungPressure * 0.24 + telemetry.rms * 2);
  context.strokeStyle = `rgba(255, 177, 93, ${pressureAlpha})`;
  context.lineWidth = 1.3;
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(cx, cy + ry * 0.92);
  context.bezierCurveTo(cx, cy + ry * 0.7, cx - rx * 0.08, mouthY + liveOpening, cx - mouthWidth * 0.65, mouthY);
  context.stroke();
  context.setLineDash([]);
  for (let bubble = 0; bubble < 6; bubble += 1) {
    const phase = (bubble / 6 + now * 0.00018 * Math.max(0.2, pose.lungPressure)) % 1;
    const bx = cx - Math.sin(phase * Math.PI) * rx * 0.05;
    const by = cy + ry * (0.88 - phase * 0.55);
    context.fillStyle = `rgba(255, 177, 93, ${pressureAlpha * (0.35 + phase * 0.45)})`;
    context.beginPath();
    context.arc(bx, by, 1.5 + pose.lungPressure * 1.2, 0, Math.PI * 2);
    context.fill();
  }

  // Chin/jaw impact mode.
  context.strokeStyle = `rgba(112, 169, 255, ${0.12 + shack * 0.65})`;
  context.lineWidth = 1 + shack * 2;
  context.beginPath();
  context.arc(cx, cy + ry * 0.64, rx * (0.3 + shack * 0.06), 0.12 * Math.PI, 0.88 * Math.PI);
  context.stroke();
  context.restore();
}

function drawWaveform(context, layout) {
  if (!graph?.analyser) return;
  graph.analyser.getFloatTimeDomainData(waveform);
  const { cx, cy, rx, ry } = layout;
  const width = rx * 1.35;
  const y = cy + ry * 0.84;
  context.save();
  context.strokeStyle = "rgba(124, 231, 189, 0.28)";
  context.lineWidth = 0.8;
  context.beginPath();
  for (let index = 0; index < waveform.length; index += 8) {
    const x = cx - width / 2 + index / (waveform.length - 1) * width;
    const sampleY = y + waveform[index] * ry * 0.09;
    if (index === 0) context.moveTo(x, sampleY);
    else context.lineTo(x, sampleY);
  }
  context.stroke();
  context.restore();
}

function labelWidth(context, label) {
  context.font = "650 7px ui-monospace, monospace";
  return Math.max(35, context.measureText(label).width + 14);
}

function drawHotspot(context, hotspot, active) {
  const compact = usesCompactCanvas();
  const amount = clamp(Number(active) || 0);
  const hovered = hoveredHotspotSoundId === hotspot.soundId;
  const emphasized = hovered || amount > 0.025;
  const visibleRadius = hotspot.r * (1 + (hovered ? 0.35 : 0) + amount * 0.22);
  context.save();
  context.shadowColor = hotspot.color;
  context.shadowBlur = !compact && emphasized ? 6 + amount * 7 : 0;
  context.fillStyle = colorWithAlpha(hotspot.color, emphasized ? 0.74 : 0.56);
  context.strokeStyle = colorWithAlpha(hotspot.color, emphasized ? 1 : 0.94);
  context.lineWidth = emphasized ? 1.8 + amount * 0.6 : 1.3;
  context.beginPath();
  context.arc(hotspot.x, hotspot.y, visibleRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;

  if (["slap", "smack", "kiss", "brush"].includes(hotspot.soundId)) {
    context.strokeStyle = "rgba(45, 17, 28, 0.92)";
    context.lineWidth = Math.max(1.2, hotspot.r * 0.16);
    context.lineCap = "round";
    context.beginPath();
    if (hotspot.soundId === "kiss") {
      context.moveTo(hotspot.x - hotspot.r * 0.58, hotspot.y);
      context.quadraticCurveTo(hotspot.x - hotspot.r * 0.2, hotspot.y - hotspot.r * 0.5, hotspot.x, hotspot.y - hotspot.r * 0.08);
      context.quadraticCurveTo(hotspot.x + hotspot.r * 0.2, hotspot.y - hotspot.r * 0.5, hotspot.x + hotspot.r * 0.58, hotspot.y);
      context.quadraticCurveTo(hotspot.x, hotspot.y + hotspot.r * 0.58, hotspot.x - hotspot.r * 0.58, hotspot.y);
    } else if (hotspot.soundId === "brush") {
      context.moveTo(hotspot.x - hotspot.r * 0.58, hotspot.y + hotspot.r * 0.34);
      context.lineTo(hotspot.x + hotspot.r * 0.54, hotspot.y - hotspot.r * 0.34);
      for (const offset of [-0.28, 0, 0.28]) {
        context.moveTo(hotspot.x - hotspot.r * (0.5 - offset), hotspot.y + hotspot.r * 0.17);
        context.lineTo(hotspot.x - hotspot.r * (0.34 - offset), hotspot.y + hotspot.r * 0.48);
      }
    } else {
      context.arc(hotspot.x, hotspot.y + hotspot.r * 0.08, hotspot.r * 0.34, 0, Math.PI * 2);
      for (const finger of [-0.3, 0, 0.3]) {
        context.moveTo(hotspot.x + hotspot.r * finger, hotspot.y - hotspot.r * 0.15);
        context.lineTo(hotspot.x + hotspot.r * finger, hotspot.y - hotspot.r * (0.56 + (finger === 0 ? 0.12 : 0)));
      }
    }
    context.stroke();
  }

  // Polka dots never carry resting words. Exact hover reveals one label at
  // the top-right stage edge, away from face anatomy and its drag handles.
  if (hovered) {
    context.font = `750 ${compact ? 6.5 : 7.2}px ui-monospace, monospace`;
    const labelWidthPx = clamp(context.measureText(hotspot.label).width + 13, 34, 86);
    const labelHeight = compact ? 16 : 18;
    const labelX = Math.max(4, cssWidth - labelWidthPx - 5);
    const labelY = 5;
    roundedRect(context, labelX, labelY, labelWidthPx, labelHeight, 5);
    context.fillStyle = "rgba(34, 14, 33, 0.92)";
    context.fill();
    context.strokeStyle = colorWithAlpha(hotspot.color, 0.88);
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = colorWithAlpha(hotspot.color, 1);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(hotspot.label, labelX + labelWidthPx / 2, labelY + labelHeight / 2 + 0.4);
  }
  context.restore();
}

function drawKissMarks(context, layout, now) {
  kissMarks = kissMarks.filter(({ born }) => now - born < 2_800);
  const { cx, cy, rx, ry } = layout;
  for (const mark of kissMarks) {
    const age = clamp((now - mark.born) / 2_800);
    const alpha = (1 - age) * 0.88;
    const x = cx + mark.x * rx;
    const y = cy + mark.y * ry;
    const width = Math.min(rx, ry) * 0.11;
    const height = width * 0.52;
    context.save();
    context.translate(x, y);
    context.rotate((mark.x + mark.y) * 0.22);
    context.fillStyle = `hsla(${338 + mark.hue * 0.12}, 92%, 48%, ${alpha})`;
    context.strokeStyle = `hsla(${340 + mark.hue * 0.1}, 96%, 32%, ${alpha})`;
    context.lineWidth = Math.max(1.4, width * 0.08);
    context.beginPath();
    context.moveTo(-width, 0);
    context.bezierCurveTo(-width * 0.68, -height * 1.25, -width * 0.24, -height * 1.16, 0, -height * 0.3);
    context.bezierCurveTo(width * 0.24, -height * 1.16, width * 0.68, -height * 1.25, width, 0);
    context.bezierCurveTo(width * 0.58, height * 1.15, width * 0.2, height * 1.22, 0, height * 0.42);
    context.bezierCurveTo(-width * 0.2, height * 1.22, -width * 0.58, height * 1.15, -width, 0);
    context.closePath();
    context.fill();
    context.stroke();
    context.strokeStyle = `rgba(255, 174, 199, ${alpha * 0.92})`;
    context.lineWidth = Math.max(1, width * 0.055);
    context.beginPath();
    context.moveTo(-width * 0.62, 0);
    context.quadraticCurveTo(0, height * 0.16, width * 0.62, 0);
    context.stroke();
    context.restore();
  }
}

function drawBrushSweep(context, now) {
  if (!brushSweep || toothTines.length < 2) return;
  const phase = clamp((now - brushSweep.born) / brushSweep.duration);
  if (phase >= 1) {
    brushSweep = null;
    return;
  }
  const first = toothTines[0];
  const last = toothTines.at(-1);
  const travelPhase = brushSweep.direction < 0 ? 1 - phase : phase;
  const x = first.x + (last.x - first.x) * travelPhase;
  const y = first.y - first.height * 0.72;
  const brushLength = Math.max(38, Math.abs(last.x - first.x) * 0.42);
  context.save();
  context.translate(x, y);
  context.rotate((brushSweep.direction < 0 ? Math.PI - 0.28 : -0.28)
    + Math.sin(phase * Math.PI) * 0.18);
  context.strokeStyle = "rgba(19, 76, 142, 0.98)";
  context.lineWidth = 9;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(brushLength, -10);
  context.stroke();
  context.fillStyle = "rgba(104, 218, 255, 0.98)";
  roundedRect(context, -14, -7, 27, 14, 5);
  context.fill();
  context.strokeStyle = "rgba(245, 248, 255, 0.96)";
  context.lineWidth = 2;
  for (let bristle = -10; bristle <= 10; bristle += 5) {
    context.beginPath();
    context.moveTo(bristle, 4);
    context.lineTo(bristle + 1.5, 13);
    context.stroke();
  }
  context.restore();
}

function nearestHotspotAtPoint(point, radiusKey = "hitR") {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const hotspot of hotspots) {
    const distance = distanceSquared(point, hotspot);
    const radius = hotspot[radiusKey] ?? hotspot.hitR;
    if (distance > radius ** 2 || distance >= nearestDistance) continue;
    nearest = hotspot;
    nearestDistance = distance;
  }
  return nearest;
}

function colorWithAlpha(color, alpha) {
  const clean = String(color).replace("#", "");
  const red = parseInt(clean.slice(0, 2), 16);
  const green = parseInt(clean.slice(2, 4), 16);
  const blue = parseInt(clean.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha)})`;
}

function buildHitGeometry(layout, pose) {
  const { cx, cy, rx, ry, featureY, mouthY, opening } = layout;
  const compact = usesCompactCanvas();
  const dotRadius = compact ? 5.8 : 6.7;
  const dotHitRadius = compact ? 11 : 13.5;
  hotspots = HICCUP_HEAD_SOUNDS.map((sound, fallbackSlot) => {
    const triggerLayout = faceSoundTriggerById.get(sound.id) ?? {
      slot: fallbackSlot,
      zone: "safe-skin-dot",
    };
    const dot = FACE_TRIGGER_DOT_POSITIONS[sound.id];
    return {
      soundId: sound.id,
      label: triggerLayout.label ?? sound.label,
      color: FACE_TRIGGER_FRECKLE_COLORS[fallbackSlot % FACE_TRIGGER_FRECKLE_COLORS.length],
      x: cx + rx * dot.x,
      y: cy + ry * dot.y,
      r: ["slap", "smack", "kiss"].includes(sound.id) ? dotRadius * 1.65 : dotRadius,
      hitR: ["slap", "smack", "kiss"].includes(sound.id) ? dotHitRadius * 1.35 : dotHitRadius,
      zone: `face-dot-${dot.region}`,
      sourceZone: triggerLayout.zone,
      kind: "dot",
      primary: true,
      slot: fallbackSlot,
    };
  });
  const nodeRadius = clamp(Math.min(rx, ry) * 0.035, 7, 10);
  const tractLimits = HICCUP_HEAD_LIMITS.tractLengthM;
  const tractProgress = (pose.tractLengthM - tractLimits[0]) / Math.max(0.001, tractLimits[1] - tractLimits[0]);
  const noseY = featureY + ry * 0.045 - ry * pose.nasalMix * 0.32;
  const noseRadius = Math.min(rx, ry) * (0.135 + pose.nasalMix * 0.022);
  const visibleEarSpread = Math.max(HICCUP_HEAD_DEFAULTS.earSpread, pose.earSpread);
  const earOffset = rx * (0.88 + visibleEarSpread * 0.64);
  const eyeRadius = Math.min(rx, ry) * 0.235 * (1 + clamp(pose.silliness) * 0.06);
  const leftEyeRx = eyeRadius;
  const rightEyeRx = eyeRadius;
  const leftEyeX = cx - rx * 0.34
    - leftEyeRx * pose.eyeDivergence * 0.78;
  const rightEyeX = cx + rx * 0.34
    + rightEyeRx * pose.eyeDivergence * 0.78;
  const leftBrow = eyebrowGeometry(layout, pose, -1);
  const rightBrow = eyebrowGeometry(layout, pose, 1);
  const leftSideHair = sideSpaghettiHairGeometry(layout, pose, -1);
  const rightSideHair = sideSpaghettiHairGeometry(layout, pose, 1);
  const tongueTip = tongueTipGeometry ?? {
    x: cx + (pose.tonguePosition - 0.5) * rx * 0.5,
    y: mouthY + opening * 0.78,
  };
  handles = [
    { id: "nose", key: "nasalMix", label: "NASAL ↑", color: "#FF0000", x: cx, y: noseY, r: Math.max(nodeRadius * 1.45, noseRadius * 0.72), hitR: noseRadius + (compact ? 8 : 10), axis: "y-invert", scale: ry * 0.34, feature: "nose", labelSide: 1 },
    { id: "left-ear", key: "earSpread", label: "STEREO ↔", color: "#65dfe8", x: cx - earOffset, y: cy + ry * 0.03, r: nodeRadius * 1.45, axis: "x-invert", scale: rx * 0.64, feature: "ear", labelSide: -1 },
    { id: "right-ear", key: "earSpread", label: "STEREO ↔", color: "#65dfe8", x: cx + earOffset, y: cy + ry * 0.03, r: nodeRadius * 1.45, axis: "x", scale: rx * 0.64, feature: "ear", labelSide: 1 },
    { id: "left-hair", key: "leftHairLength", lengthKey: "leftHairLength", angleKey: "leftHairAngle", label: "LEFT HAIR 2D", color: "#f07fd0", x: leftSideHair.tipX, y: leftSideHair.tipY, r: nodeRadius * 1.42, feature: "hair", hairSide: -1, labelSide: -1 },
    { id: "right-hair", key: "rightHairLength", lengthKey: "rightHairLength", angleKey: "rightHairAngle", label: "RIGHT HAIR 2D", color: "#bb8cff", x: rightSideHair.tipX, y: rightSideHair.tipY, r: nodeRadius * 1.42, feature: "hair", hairSide: 1, labelSide: 1 },
    { id: "left-eye", key: "eyeDivergence", label: "REVERB ↔", color: "#bb8cff", x: leftEyeX, y: featureY - ry * 0.43, r: nodeRadius * 1.35, axis: "x-invert", scale: leftEyeRx * 1.56, feature: "eye-gaze", labelSide: -1 },
    { id: "right-eye", key: "eyeDivergence", label: "REVERB ↔", color: "#bb8cff", x: rightEyeX, y: featureY - ry * 0.43, r: nodeRadius * 1.35, axis: "x", scale: rightEyeRx * 1.56, feature: "eye-gaze", labelSide: 1 },
    { id: "left-lid", key: "leftEyeClosure", label: "HPF ↓", color: "#f47ead", x: cx - rx * 0.34 - eyeRadius * 0.88, y: featureY - ry * 0.43 + eyeRadius * clamp(pose.leftEyeClosure) * 0.7, r: nodeRadius * 1.08, axis: "y", scale: eyeRadius * 0.7, feature: "lid", labelSide: -1 },
    { id: "right-lid", key: "rightEyeClosure", label: "FUZZ ↓", color: "#9d67d8", x: cx + rx * 0.34 + eyeRadius * 0.88, y: featureY - ry * 0.43 + eyeRadius * clamp(pose.rightEyeClosure) * 0.7, r: nodeRadius * 1.08, axis: "y", scale: eyeRadius * 0.7, feature: "lid", labelSide: 1 },
    { id: "left-brow", key: "leftBrow", label: "ACCENT L", color: "#ff4f7e", x: leftBrow.x, y: leftBrow.y, r: nodeRadius * 1.3, axis: "y-invert", scale: Math.max(24, leftBrow.eyeRy * 1.13), step: 0.25, feature: "brow", labelSide: -1 },
    { id: "right-brow", key: "rightBrow", label: "ACCENT R", color: "#2dcbda", x: rightBrow.x, y: rightBrow.y, r: nodeRadius * 1.3, axis: "y-invert", scale: Math.max(24, rightBrow.eyeRy * 1.13), step: 0.25, feature: "brow", labelSide: 1 },
    { id: "left-cheek", key: "cheekVolume", label: "cheek volume", color: hiccupHeadSound("slap").color, x: cx - rx * (0.48 + pose.cheekVolume * 0.32), y: cy - ry * 0.05, r: nodeRadius, axis: "x-invert", scale: rx * 0.5 },
    { id: "right-cheek", key: "cheekTension", label: "membrane tension", color: hiccupHeadSound("pop").color, x: cx + rx * 0.72, y: cy + ry * (0.23 - pose.cheekTension * 0.33), r: nodeRadius, axis: "y-invert", scale: ry * 0.42 },
    { id: "lip-tension", key: "lipTension", label: "lip tension", color: hiccupHeadSound("bop").color, x: cx - rx * 0.05, y: mouthY - opening - nodeRadius * 1.7, r: nodeRadius, axis: "y-invert", scale: ry * 0.34 },
    { id: "lip-projection", key: "lipRounding", label: "lip projection", color: hiccupHeadSound("boop").color, x: cx + rx * (0.27 + pose.lipRounding * 0.16), y: mouthY, r: nodeRadius, axis: "x", scale: rx * 0.42 },
    { id: "mouth-aperture", key: "mouthOpening", label: "mouth aperture", color: hiccupHeadSound("shack").color, x: cx + rx * 0.32, y: mouthY + opening, r: nodeRadius, axis: "y", scale: ry * 0.28 },
    { id: "tongue-position", key: "tonguePosition", label: "tongue position", color: hiccupHeadSound("tlik").color, x: cx + (pose.tonguePosition - 0.5) * rx * 0.62, y: mouthY + opening * 0.62, r: nodeRadius, axis: "x", scale: rx * 0.62 },
    { id: "tongue-curl", key: "tongueCurl", label: "tongue curl", color: hiccupHeadSound("pff").color, x: cx + (pose.tonguePosition - 0.5) * rx * 0.42, y: mouthY + opening * (0.8 - pose.tongueCurl * 0.62), r: nodeRadius * 0.82, axis: "y-invert", scale: ry * 0.2 },
    { id: "tongue-out", key: "tongueOut", label: "TONGUE OUT ↕", color: "#f07fd0", x: tongueTip.x, y: tongueTip.y, r: nodeRadius * 1.18, axis: "y", scale: ry * 0.3, feature: "tongue", labelSide: 1 },
    { id: "tract-length", key: "tractLengthM", label: "tract length", color: hiccupHeadSound("shh").color, x: cx, y: cy + ry * (0.55 + tractProgress * 0.3), r: nodeRadius, axis: "y", scale: ry * 0.31 },
  ];

  // Mutated anatomy can travel underneath the original freckle coordinates.
  // Project every trigger back onto clear skin after the live feature geometry
  // is known, so no sound dot is painted on an eyeball or another body part.
  const featureClearance = dotRadius + (compact ? 3 : 5);
  const forbiddenCircles = [
    { x: cx - rx * 0.34, y: featureY - ry * 0.43, r: eyeRadius + featureClearance },
    { x: cx + rx * 0.34, y: featureY - ry * 0.43, r: eyeRadius + featureClearance },
    { x: cx, y: noseY, r: noseRadius + featureClearance },
    { x: leftBrow.x, y: leftBrow.y, r: leftBrow.eyeRx * 0.72 + featureClearance },
    { x: rightBrow.x, y: rightBrow.y, r: rightBrow.eyeRx * 0.72 + featureClearance },
    { x: cx - earOffset, y: cy + ry * 0.03, r: nodeRadius * 2.5 + featureClearance },
    { x: cx + earOffset, y: cy + ry * 0.03, r: nodeRadius * 2.5 + featureClearance },
    { x: tongueTip.x, y: tongueTip.y, r: nodeRadius * 2.2 + featureClearance },
  ];
  for (const hotspot of hotspots) {
    for (let pass = 0; pass < 3; pass += 1) {
      for (const feature of forbiddenCircles) {
        let dx = hotspot.x - feature.x;
        let dy = hotspot.y - feature.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= feature.r) continue;
        if (distance < 0.001) {
          const angle = hotspot.slot / HICCUP_HEAD_SOUNDS.length * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        hotspot.x = feature.x + dx / distance * feature.r;
        hotspot.y = feature.y + dy / distance * feature.r;
      }
      const mouthRx = rx * 0.72 + featureClearance;
      const mouthRy = Math.max(opening * 1.65, ry * 0.12) + featureClearance;
      let mouthDx = (hotspot.x - cx) / mouthRx;
      let mouthDy = (hotspot.y - mouthY) / mouthRy;
      const mouthDistance = Math.hypot(mouthDx, mouthDy);
      if (mouthDistance < 1) {
        if (mouthDistance < 0.001) {
          const angle = hotspot.slot / HICCUP_HEAD_SOUNDS.length * Math.PI * 2;
          mouthDx = Math.cos(angle);
          mouthDy = Math.sin(angle);
        }
        const scale = 1 / Math.max(0.001, Math.hypot(mouthDx, mouthDy));
        hotspot.x = cx + mouthDx * scale * mouthRx;
        hotspot.y = mouthY + mouthDy * scale * mouthRy;
      }
    }
  }
  const handRadius = clamp(Math.min(rx, ry) * 0.175, 27, 57);
  const leftTargetX = cx + handPlacements.left.x * rx;
  const leftTargetY = cy + handPlacements.left.y * ry;
  const rightTargetX = cx + handPlacements.right.x * rx;
  const rightTargetY = cy + handPlacements.right.y * ry;
  const leftDragging = pointerDrag?.type === "hand" && pointerDrag.handId === "left";
  const rightDragging = pointerDrag?.type === "hand" && pointerDrag.handId === "right";
  hands = [
    {
      id: "left",
      soundId: "slap",
      label: "LEFT SLAP",
      color: "#4a9cff",
      x: leftTargetX - (leftDragging ? 0 : rx * 0.3),
      y: leftTargetY + (leftDragging ? 0 : ry * 0.03),
      r: handRadius,
      side: -1,
      targetX: leftTargetX,
      targetY: leftTargetY,
    },
    {
      id: "right",
      soundId: "smack",
      label: "RIGHT SMACK",
      color: "#4a9cff",
      x: rightTargetX + (rightDragging ? 0 : rx * 0.3),
      y: rightTargetY + (rightDragging ? 0 : ry * 0.03),
      r: handRadius,
      side: 1,
      targetX: rightTargetX,
      targetY: rightTargetY,
    },
  ];
  for (const point of [...hotspots, ...handles, ...hands]) {
    point.x = clamp(point.x, 12, Math.max(12, cssWidth - 12));
    point.y = clamp(point.y, 12, Math.max(12, cssHeight - 12));
  }
}

function drawHandles(context) {
  const compact = usesCompactCanvas();
  for (const handle of handles) {
    const selected = pointerDrag?.handleId === handle.id;
    const hovered = hoveredHandleId === handle.id;
    const revealed = selected || hovered;
    const labelSide = handle.labelSide ?? (handle.x < cssWidth * 0.5 ? -1 : 1);
    context.save();
    context.shadowColor = handle.color;
    context.shadowBlur = revealed ? (compact ? 5 : 10) : 0;
    context.strokeStyle = colorWithAlpha(
      handle.color,
      selected ? 1 : hovered ? 0.92 : handle.feature ? 0.68 : 0.46,
    );
    context.lineWidth = selected ? 2.4 : hovered ? 1.8 : 1.1;
    const handleRadius = handle.r + (selected ? 2 : 0) + (handle.feature ? 1.5 : 0);
    context.beginPath();
    context.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
    context.stroke();
    context.shadowBlur = 0;

    if (handle.feature) {
      context.setLineDash(revealed ? [] : [2.5, 3.5]);
      context.strokeStyle = colorWithAlpha(handle.color, revealed ? 0.78 : 0.4);
      context.lineWidth = revealed ? 1.3 : 0.8;
      context.beginPath();
      context.arc(handle.x, handle.y, handle.r * 1.55, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }

    if (revealed) {
      context.strokeStyle = colorWithAlpha(handle.color, 0.96);
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(handle.x - 2.5, handle.y);
      context.lineTo(handle.x + 2.5, handle.y);
      context.moveTo(handle.x, handle.y - 2.5);
      context.lineTo(handle.x, handle.y + 2.5);
      context.stroke();

      const labelWidthPx = Math.max(48, labelWidth(context, handle.label));
      const labelX = clamp(
        handle.x + labelSide * (handle.r * 1.8 + 7)
          - (labelSide < 0 ? labelWidthPx : 0),
        5,
        Math.max(5, cssWidth - labelWidthPx - 5),
      );
      const labelY = clamp(handle.y - 9, 5, Math.max(5, cssHeight - 23));
      roundedRect(context, labelX, labelY, labelWidthPx, 18, 4);
      context.strokeStyle = colorWithAlpha(handle.color, 0.9);
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = handle.color;
      context.font = "700 7px ui-monospace, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 2.8;
      context.strokeStyle = "rgba(8, 5, 7, 0.96)";
      context.strokeText(handle.label, labelX + labelWidthPx / 2, labelY + 9.5);
      context.fillText(handle.label, labelX + labelWidthPx / 2, labelY + 9.5);
    }
    context.restore();
  }
}

function drawHands(context, motion) {
  const compact = usesCompactCanvas();
  for (const hand of hands) {
    const active = motion[hand.soundId] ?? 0;
    const selected = pointerDrag?.type === "hand" && pointerDrag.handId === hand.id;
    const hovered = hoveredHandId === hand.id;
    // Hands are effects, not permanent face furniture. Reveal a mitt only
    // while its SLAP/SMACK dot is being dragged or while the strike animates.
    if (!selected && active <= 0.01) continue;
    const r = hand.r * (1 + active * 0.1);
    const travel = 1 - (1 - clamp(active)) ** 2;
    const palmX = hand.x + (hand.targetX - hand.x) * travel;
    const palmY = hand.y + (hand.targetY - hand.y) * travel;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    if (travel > 0.08) {
      context.strokeStyle = colorWithAlpha(hand.color, 0.2 + travel * 0.56);
      context.lineWidth = 1.2 + travel * 1.8;
      for (let streak = -1; streak <= 1; streak += 1) {
        const offsetY = streak * r * 0.34;
        context.beginPath();
        context.moveTo(
          hand.x + (palmX - hand.x) * 0.08,
          hand.y + offsetY,
        );
        context.lineTo(
          hand.x + (palmX - hand.x) * 0.68,
          palmY + offsetY * 0.32,
        );
        context.stroke();
      }
    }

    // An outlined candy-colored tube and bulbous mitt read as absurd rubber
    // props rather than realistic skin, without changing their drag targets.
    const mittHighlight = "rgb(201, 232, 255)";
    const mittShade = "rgb(55, 133, 225)";
    const mittOutline = "rgba(65, 31, 50, 0.94)";
    context.strokeStyle = mittOutline;
    context.lineWidth = r * 0.64;
    context.beginPath();
    context.moveTo(palmX + hand.side * r * 0.32, palmY + r * 0.42);
    context.lineTo(hand.x + hand.side * r * 2.15, hand.y + r * 1.25);
    context.stroke();
    context.strokeStyle = mittShade;
    context.lineWidth = r * 0.48;
    context.stroke();

    context.translate(palmX, palmY);
    context.rotate(hand.side * (-0.2 + travel * 0.34));
    context.scale(1 + travel * 0.08, 1 - travel * 0.045);
    context.shadowColor = hand.color;
    context.shadowBlur = compact
      ? (selected ? 8 : active > 0.08 ? 5 : 0)
      : (selected ? 22 : 8 + active * 12);
    const mittGradient = context.createRadialGradient(
      -hand.side * r * 0.18,
      -r * 0.28,
      r * 0.04,
      0,
      r * 0.06,
      r * 0.88,
    );
    mittGradient.addColorStop(0, "rgb(255, 248, 220)");
    mittGradient.addColorStop(0.34, mittHighlight);
    mittGradient.addColorStop(0.72, colorWithAlpha(hand.color, 0.98));
    mittGradient.addColorStop(1, mittShade);
    context.fillStyle = mittGradient;
    context.strokeStyle = colorWithAlpha(hand.color, 0.88);
    context.lineWidth = selected ? 3.4 : 2.6;
    context.beginPath();
    context.ellipse(0, r * 0.03, r * 0.66, r * 0.76, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    const fingerHeights = [0.92, 1.2, 1.29, 1.04];
    for (let finger = 0; finger < 4; finger += 1) {
      const fingerX = (finger - 1.5) * r * 0.28;
      context.beginPath();
      context.moveTo(fingerX, -r * 0.36);
      context.lineTo(fingerX + hand.side * r * 0.035, -r * fingerHeights[finger]);
      context.strokeStyle = mittOutline;
      context.lineWidth = r * 0.3;
      context.stroke();
      context.strokeStyle = finger % 2 === 0 ? mittHighlight : colorWithAlpha(hand.color, 0.98);
      context.lineWidth = r * 0.22;
      context.stroke();
    }
    context.beginPath();
    context.moveTo(-hand.side * r * 0.43, -r * 0.05);
    context.lineTo(-hand.side * r * 0.94, -r * 0.36);
    context.strokeStyle = mittOutline;
    context.lineWidth = r * 0.34;
    context.stroke();
    context.strokeStyle = mittHighlight;
    context.lineWidth = r * 0.25;
    context.stroke();
    context.shadowBlur = 0;
    context.restore();

    if (travel > 0.54) {
      const impact = clamp((travel - 0.54) / 0.46);
      context.save();
      context.translate(hand.targetX, hand.targetY);
      context.strokeStyle = colorWithAlpha(hand.color, 0.34 + impact * 0.58);
      context.lineWidth = 1.2 + impact * 1.8;
      context.beginPath();
      context.arc(0, 0, r * (0.55 + impact * 0.9), 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = ray * Math.PI / 4;
        const inner = r * (0.52 + impact * 0.2);
        const outer = r * (0.78 + impact * 0.7);
        context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      }
      context.stroke();
      context.restore();
    }

    // The mitt itself is the resting affordance. Its label appears only on
    // hover/drag and stays outline-only so no black badge covers the face.
    if (selected || hovered) {
      const label = `${travel > 0.35 ? "SLAP!" : hand.label} · DRAG`;
      const labelWidthPx = Math.max(62, labelWidth(context, label));
      const labelX = clamp(hand.x - labelWidthPx / 2, 6, Math.max(6, cssWidth - labelWidthPx - 6));
      const labelY = clamp(hand.y + r * 0.92, 6, Math.max(6, cssHeight - 26));
      context.save();
      roundedRect(context, labelX, labelY, labelWidthPx, 19, 4);
      context.strokeStyle = colorWithAlpha(hand.color, selected ? 1 : 0.84);
      context.lineWidth = selected ? 2 : 1;
      context.stroke();
      context.fillStyle = hand.color;
      context.strokeStyle = "rgba(8, 5, 7, 0.96)";
      context.lineWidth = 2.8;
      context.font = "700 7px ui-monospace, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.strokeText(label, labelX + labelWidthPx / 2, labelY + 10);
      context.fillText(label, labelX + labelWidthPx / 2, labelY + 10);
      context.restore();
    }
  }
}

function usesCompactCanvas() {
  return compactCanvasMedia?.matches ?? cssWidth <= 680;
}

function drawStage(now = performance.now()) {
  // Keep the queue/playhead synchronized even when the canvas is scrolled out
  // of view, but do not spend any paint work on invisible pixels.
  animationFrame = requestAnimationFrame(drawStage);
  flushVisualQueue(now);
  if (!stageIsVisible || cssWidth <= 1 || cssHeight <= 1) return;
  // Audio owns the realtime budget. Compact/coarse canvases deliberately
  // repaint at 24fps so dense sequencing cannot starve the worklet.
  if (usesCompactCanvas() && now - lastCanvasPaintAt < 1000 / 24) return;
  lastCanvasPaintAt = now;
  // The nose quack uses the tract for audio, but its performance animation is
  // deliberately nose-only: suppress physical telemetry while the nose bobs.
  const noseHonkVisualActive = now - noseHonkStartedAt >= 0
    && now - noseHonkStartedAt < 360;
  const physicalStatus = noseHonkVisualActive ? null : physicalTelemetryStatus(now);
  const motion = activeMotion(now, physicalStatus);
  if (noseHonkVisualActive) {
    motion.doo = 0;
    motion.hum = 0;
  }
  let strongestId = HICCUP_HEAD_SOUNDS[0].id;
  let strongestAmount = -Infinity;
  for (const sound of HICCUP_HEAD_SOUNDS) {
    const amount = motion[sound.id] ?? 0;
    if (amount > strongestAmount) {
      strongestId = sound.id;
      strongestAmount = amount;
    }
  }
  const isSpeaking = Boolean(physicalStatus?.active) || strongestAmount > 0.01;
  const visualOverrides = soundAnimation?.configuration ?? null;
  const visualState = visualOverrides ? { ...state, ...visualOverrides } : state;
  const targetPose = physicalStatus
    ? physicalTelemetryPose(physicalStatus, visualState)
    : isSpeaking
      ? hiccupHeadPoseForSound(strongestId, visualState, Math.min(0.82, strongestAmount * 0.72))
      : visualState;
  const pose = morphDisplayedPose(targetPose, now, isSpeaking);
  const layout = faceLayout(pose);
  drawBackground(drawing, cssWidth, cssHeight, now, motion);
  drawAirPlume(drawing, layout, motion, now);
  // `visibleStep` is advanced by the existing visual queue at its scheduled
  // playhead time. Sampling it after queue flushing changes paint only; the
  // scheduler may continue looking ahead without pulling colors ahead too.
  const checkerStep = sequencePlaying && visibleStep >= 0
    ? visibleStep % sequenceLength
    : -1;
  drawFace(drawing, layout, pose, motion, now, checkerStep);
  drawKissMarks(drawing, layout, now);
  drawBrushSweep(drawing, now);
  drawToothWhistleJet(drawing, layout, motion, now);
  drawWaveform(drawing, layout);
  buildHitGeometry(layout, pose);
  drawHands(drawing, motion);
  drawHandles(drawing);
  // Tiny primary trigger cores and their transient labels paint last so no
  // hand, hair handle, or anatomical control can visually occlude them.
  for (const hotspot of hotspots) drawHotspot(drawing, hotspot, motion[hotspot.soundId] ?? 0);
  updateHud(pose, { force: false, now });
}

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, rect.width);
  cssHeight = Math.max(1, rect.height);
  const compact = usesCompactCanvas();
  const requestedRatio = Math.min(compact ? 1.5 : 2, globalThis.devicePixelRatio || 1);
  const pixelBudget = compact ? 650_000 : 2_800_000;
  pixelRatio = Math.min(requestedRatio, Math.sqrt(pixelBudget / Math.max(1, cssWidth * cssHeight)));
  const nextWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
  const nextHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * cssWidth / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * cssHeight / Math.max(1, rect.height),
  };
}

function distanceSquared(point, target) {
  return (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
}

function handStrikeConfiguration(handId) {
  const placement = handPlacements[handId] ?? { x: 0, y: 0 };
  const horizontal = clamp(placement.x, -1.2, 1.2);
  const vertical = clamp(placement.y, -0.76, 0.78);
  const cheekCenter = clamp(1 - Math.abs(horizontal) * 0.62);
  const height = clamp((placement.y + 0.72) / 1.46);
  const upperFace = clamp((-vertical + 0.08) / 0.8);
  const lowerFace = clamp((vertical + 0.02) / 0.8);
  const mouthZone = clamp(
    1 - Math.hypot(horizontal / 0.86, (vertical - 0.28) / 0.64),
  );
  const outerCheek = clamp(Math.abs(horizontal) / 1.05);
  return {
    cheekVolume: clamp(
      state.cheekVolume * 0.46 + cheekCenter * 0.82 - upperFace * 0.16,
      HICCUP_HEAD_LIMITS.cheekVolume[0],
      HICCUP_HEAD_LIMITS.cheekVolume[1],
    ),
    cheekTension: clamp(
      state.cheekTension * 0.44 + (1 - height) * 0.72 + outerCheek * 0.28,
      HICCUP_HEAD_LIMITS.cheekTension[0],
      HICCUP_HEAD_LIMITS.cheekTension[1],
    ),
    nasalMix: clamp(state.nasalMix * 0.54 + upperFace * 0.76, 0, 1),
    mouthOpening: clamp(
      state.mouthOpening * 0.68 + mouthZone * 0.72 + lowerFace * 0.16,
      HICCUP_HEAD_LIMITS.mouthOpening[0],
      HICCUP_HEAD_LIMITS.mouthOpening[1],
    ),
    lipRounding: clamp(
      state.lipRounding + mouthZone * 0.48 - outerCheek * 0.22,
      HICCUP_HEAD_LIMITS.lipRounding[0],
      HICCUP_HEAD_LIMITS.lipRounding[1],
    ),
    tonguePosition: clamp(
      state.tonguePosition + horizontal * 0.16 - lowerFace * 0.08,
      HICCUP_HEAD_LIMITS.tonguePosition[0],
      HICCUP_HEAD_LIMITS.tonguePosition[1],
    ),
    tractLengthM: clamp(
      state.tractLengthM * (0.86 + lowerFace * 0.28 + cheekCenter * 0.08),
      HICCUP_HEAD_LIMITS.tractLengthM[0],
      HICCUP_HEAD_LIMITS.tractLengthM[1],
    ),
    earSpread: clamp(state.earSpread * 0.7 + outerCheek * 0.46, 0, 1),
    eyeDivergence: clamp(
      state.eyeDivergence * 0.68 + upperFace * 0.38,
      HICCUP_HEAD_LIMITS.eyeDivergence[0],
      HICCUP_HEAD_LIMITS.eyeDivergence[1],
    ),
  };
}

function beginHandDragFromSound(soundId, event, point) {
  if (soundId !== "slap" && soundId !== "smack") return false;
  const handId = soundId === "slap" ? "left" : "right";
  const layout = faceLayout(displayedPose);
  const placement = handPlacements[handId];
  placement.x = clamp((point.x - layout.cx) / Math.max(1, layout.rx), -1.1, 1.1);
  placement.y = clamp((point.y - layout.cy) / Math.max(1, layout.ry), -0.72, 0.74);
  pointerDrag = {
    type: "hand",
    pointerId: event.pointerId,
    handId,
    soundId,
    startX: point.x,
    startY: point.y,
    lastX: point.x,
    lastY: point.y,
    distance: 0,
  };
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture?.(event.pointerId);
  return true;
}

function handlePointerDown(event) {
  const point = canvasPoint(event);
  const toothTine = toothTineAtPoint(point);
  if (toothTine) {
    const velocity = clamp(0.58 + state.lungPressure * 0.25, 0.52, 1);
    triggerToothTine(toothTine, point, velocity);
    event.preventDefault();
    return;
  }
  if (toothWhistleGapAtPoint(point)) {
    triggerSound("whistle", clamp(0.62 + state.lungPressure * 0.28, 0.55, 1));
    event.preventDefault();
    return;
  }
  const nearestHotspotCore = nearestHotspotAtPoint(point, "r");
  const nearestHotspot = nearestHotspotAtPoint(point, "hitR");
  // A visible trigger core always remains tappable, even if an extremely
  // mutated ear, tongue, or hand crosses a polka dot. Anatomy keeps
  // priority elsewhere inside the generous invisible hitR.
  if (nearestHotspotCore) {
    if (beginHandDragFromSound(nearestHotspotCore.soundId, event, point)) {
      event.preventDefault();
      return;
    }
    triggerSound(nearestHotspotCore.soundId, clamp(0.62 + state.lungPressure * 0.28, 0.55, 1));
    event.preventDefault();
    return;
  }
  const handle = [...handles]
    .sort((left, right) => distanceSquared(point, left) - distanceSquared(point, right))
    .find((candidate) => distanceSquared(point, candidate) <= (candidate.r + 12) ** 2);
  if (handle) {
    if (handle.feature === "hair") {
      pointerDrag = {
        type: "hair-2d",
        pointerId: event.pointerId,
        handleId: handle.id,
        side: handle.hairSide,
        lengthKey: handle.lengthKey,
        angleKey: handle.angleKey,
      };
    } else {
      pointerDrag = {
        type: "parameter",
        pointerId: event.pointerId,
        handleId: handle.id,
        key: handle.key,
        axis: handle.axis,
        scale: handle.scale,
        startX: point.x,
        startY: point.y,
        startValue: state[handle.key],
        step: handle.step ?? 0,
      };
    }
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  const hand = [...hands]
    .sort((left, right) => distanceSquared(point, left) - distanceSquared(point, right))
    .find((candidate) => distanceSquared(point, candidate) <= (candidate.r + 8) ** 2);
  if (hand) {
    pointerDrag = {
      type: "hand",
      pointerId: event.pointerId,
      handId: hand.id,
      soundId: hand.soundId,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      distance: 0,
    };
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  if (nearestHotspot) {
    if (beginHandDragFromSound(nearestHotspot.soundId, event, point)) {
      event.preventDefault();
      return;
    }
    triggerSound(nearestHotspot.soundId, clamp(0.62 + state.lungPressure * 0.28, 0.55, 1));
    event.preventDefault();
  }
}

function handlePointerMove(event) {
  const point = canvasPoint(event);
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) {
    const nearestHoveredHotspot = nearestHotspotAtPoint(point, "hitR");
    const nearestHotspotCore = nearestHotspotAtPoint(point, "r");
    const nearestHoveredHandle = [...handles]
      .sort((left, right) => distanceSquared(point, left) - distanceSquared(point, right))
      .find((candidate) => distanceSquared(point, candidate) <= (candidate.r + 10) ** 2);
    const overToothTine = Boolean(toothTineAtPoint(point));
    const overToothWhistleGap = toothWhistleGapAtPoint(point);
    const overHandle = Boolean(nearestHoveredHandle);
    const nearestHoveredHand = [...hands]
      .sort((left, right) => distanceSquared(point, left) - distanceSquared(point, right))
      .find((candidate) => distanceSquared(point, candidate) <= (candidate.r + 8) ** 2);
    const overHand = Boolean(nearestHoveredHand);
    // A painted trigger core wins; elsewhere anatomical controls suppress the
    // invisible trigger halo so only one tooltip or action is suggested.
    hoveredHandleId = nearestHotspotCore ? "" : nearestHoveredHandle?.id ?? "";
    hoveredHandId = nearestHotspotCore || overHandle ? "" : nearestHoveredHand?.id ?? "";
    hoveredHotspotSoundId = nearestHotspotCore?.soundId
      ?? (!overHandle && !overHand ? nearestHoveredHotspot?.soundId : "")
      ?? "";
    const overHotspot = Boolean(nearestHoveredHotspot);
    const overHotspotCore = Boolean(nearestHotspotCore);
    canvas.style.cursor = overToothTine || overToothWhistleGap || overHotspotCore
      ? "pointer"
      : overHandle || overHand
        ? "grab"
        : overHotspot
          ? "pointer"
          : "default";
    return;
  }
  hoveredHotspotSoundId = "";
  hoveredHandleId = "";
  hoveredHandId = "";
  if (pointerDrag.type === "hand") {
    const layout = faceLayout(displayedPose);
    const placement = handPlacements[pointerDrag.handId];
    const minimumX = pointerDrag.handId === "left" ? -1.22 : -0.18;
    const maximumX = pointerDrag.handId === "left" ? 0.18 : 1.22;
    placement.x = clamp((point.x - layout.cx) / Math.max(1, layout.rx), minimumX, maximumX);
    placement.y = clamp((point.y - layout.cy) / Math.max(1, layout.ry), -0.76, 0.78);
    pointerDrag.distance += Math.hypot(point.x - pointerDrag.lastX, point.y - pointerDrag.lastY);
    pointerDrag.lastX = point.x;
    pointerDrag.lastY = point.y;
    canvas.style.cursor = "grabbing";
    event.preventDefault();
    return;
  }
  if (pointerDrag.type === "hair-2d") {
    const layout = faceLayout(displayedPose);
    const hair = sideSpaghettiHairGeometry(layout, state, pointerDrag.side);
    const outward = (point.x - hair.rootX) * pointerDrag.side;
    const vertical = point.y - hair.rootY;
    const radialLength = Math.hypot(outward, vertical);
    const angleAmount = clamp(
      Math.atan2(vertical, Math.max(1, outward)) / 0.62,
      -1,
      1,
    );
    // Screen-edge limiting shortens the visible ray at steep angles. Map the
    // pointer across that visible min/max span so a tip can still reach the
    // full audio range on a 390px canvas.
    const minimumHair = sideSpaghettiHairGeometry(layout, {
      ...state,
      [pointerDrag.lengthKey]: 0,
      [pointerDrag.angleKey]: angleAmount,
    }, pointerDrag.side);
    const maximumHair = sideSpaghettiHairGeometry(layout, {
      ...state,
      [pointerDrag.lengthKey]: 1,
      [pointerDrag.angleKey]: angleAmount,
    }, pointerDrag.side);
    const lengthAmount = clamp(
      (radialLength - minimumHair.length)
        / Math.max(1, maximumHair.length - minimumHair.length),
      HICCUP_HEAD_DEFAULTS[pointerDrag.lengthKey],
      1,
    );
    queueCanvasStateUpdates({
      [pointerDrag.lengthKey]: lengthAmount,
      [pointerDrag.angleKey]: angleAmount,
    });
    canvas.style.cursor = "grabbing";
    event.preventDefault();
    return;
  }
  const dx = point.x - pointerDrag.startX;
  const dy = point.y - pointerDrag.startY;
  const [minimum, maximum] = HICCUP_HEAD_LIMITS[pointerDrag.key] ?? [
    Number($(pointerDrag.key)?.min) || 0,
    Number($(pointerDrag.key)?.max) || 1,
  ];
  let delta = 0;
  if (pointerDrag.axis === "x") delta = dx / pointerDrag.scale * (maximum - minimum);
  if (pointerDrag.axis === "x-invert") delta = -dx / pointerDrag.scale * (maximum - minimum);
  if (pointerDrag.axis === "y") delta = dy / pointerDrag.scale * (maximum - minimum);
  if (pointerDrag.axis === "y-invert") delta = -dy / pointerDrag.scale * (maximum - minimum);
  const rawValue = pointerDrag.startValue + delta;
  let nextValue = pointerDrag.step > 0
    ? Math.round(rawValue / pointerDrag.step) * pointerDrag.step
    : rawValue;
  if (["leftHairLength", "rightHairLength"].includes(pointerDrag.key)) {
    nextValue = Math.max(HICCUP_HEAD_DEFAULTS[pointerDrag.key], nextValue);
  }
  if (pointerDrag.key === "earSpread") {
    nextValue = Math.max(HICCUP_HEAD_DEFAULTS.earSpread, nextValue);
  }
  queueCanvasStateUpdate(pointerDrag.key, nextValue);
  event.preventDefault();
}

function handlePointerLeave() {
  if (pointerDrag) return;
  hoveredHotspotSoundId = "";
  hoveredHandleId = "";
  hoveredHandId = "";
  canvas.style.cursor = "default";
}

function endPointerDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  if (["parameter", "hair-2d"].includes(pointerDrag.type)) {
    flushPendingCanvasStateUpdate();
  }
  const drag = pointerDrag;
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  canvas.style.cursor = "grab";
  canvas.releasePointerCapture?.(event.pointerId);
  if (drag.type === "hand") {
    if (event.type !== "pointercancel") {
      const layout = faceLayout(displayedPose);
      const velocity = clamp(0.58 + drag.distance / Math.max(40, Math.min(layout.rx, layout.ry)) * 0.34, 0.58, 1);
      triggerSound(drag.soundId, velocity, handStrikeConfiguration(drag.handId));
      announce(`${drag.handId === "left" ? "Left slap" : "Right smack"}: ${Math.round(velocity * 100)}% impact through the mouth resonator`);
    }
    return;
  }
  if (drag.type === "hair-2d") {
    const sideLabel = drag.side < 0 ? "Left" : "Right";
    announce(
      `${sideLabel} hair: ${formatPercent(state[drag.lengthKey])} feedback, ${formatSignedPercent(state[drag.angleKey])} delay angle`,
    );
    return;
  }
  if (drag.type === "parameter" && drag.handleId === "nose") {
    const endPoint = canvasPoint(event);
    const clickTravel = Math.hypot(endPoint.x - drag.startX, endPoint.y - drag.startY);
    if (event.type !== "pointercancel" && clickTravel < 10) {
      triggerNoseHonk();
      return;
    }
  }
  const key = drag.key;
  const spec = CONTROL_SPECS.find((candidate) => candidate.key === key);
  announce(`${$(key)?.previousElementSibling?.querySelector("b")?.textContent ?? key}: ${spec?.format(state[key]) ?? state[key]}`);
}

function bindControls() {
  for (const spec of CONTROL_SPECS) {
    const input = $(spec.key);
    if (!input) continue;
    input.addEventListener("input", () => setStateValue(spec.key, Number(input.value)));
  }
  $("eyebrowEmphasis")?.addEventListener("input", () => {
    eyebrowEmphasis = clamp(Number($("eyebrowEmphasis").value), 0, 0.9);
    $("eyebrowEmphasisOut").value = formatPercent(eyebrowEmphasis);
    $("eyebrowEmphasisOut").textContent = formatPercent(eyebrowEmphasis);
  });
  $("audioButton").addEventListener("click", toggleAudio);
  $("playButton").addEventListener("click", toggleSequence);
  $("restartButton").addEventListener("click", restartSequence);
  $("randomPatternButton").addEventListener("click", scatterPattern);
  $("clearPatternButton").addEventListener("click", clearPattern);
  $("randomizeButton").addEventListener("click", randomizeFace);
  $("resetButton").addEventListener("click", resetAll);
  $("resetEffectsButton")?.addEventListener("click", resetFaceEffects);
  const workspace = document.querySelector(".hiccup-head-workspace");
  const splitter = $("workspaceSplitter");
  let splitterPointerId = null;
  const resizeWorkspace = (clientY) => {
    if (!workspace) return;
    const bounds = workspace.getBoundingClientRect();
    const stageHeight = clamp(clientY - bounds.top, 220, Math.max(220, bounds.height - 218));
    workspace.style.setProperty("--hiccup-head-stage-height", `${stageHeight}px`);
    workspace.style.setProperty("--hiccup-head-grid-height", `${Math.max(210, bounds.height - stageHeight - 8)}px`);
    resizeCanvas();
  };
  splitter?.addEventListener("pointerdown", (event) => {
    splitterPointerId = event.pointerId;
    splitter.setPointerCapture?.(event.pointerId);
    resizeWorkspace(event.clientY);
  });
  splitter?.addEventListener("pointermove", (event) => {
    if (event.pointerId === splitterPointerId) resizeWorkspace(event.clientY);
  });
  splitter?.addEventListener("pointerup", (event) => {
    if (event.pointerId === splitterPointerId) splitterPointerId = null;
  });
  splitter?.addEventListener("dblclick", () => {
    workspace?.style.removeProperty("--hiccup-head-stage-height");
    workspace?.style.removeProperty("--hiccup-head-grid-height");
    resizeCanvas();
  });
  for (const key of FACE_EFFECT_KEYS) {
    $(`${key}EffectButton`)?.addEventListener("click", () => toggleFaceEffect(key));
  }
  $("sequenceLength")?.addEventListener("input", () => {
    const previewLength = clamp(
      Math.round(Number($("sequenceLength").value) || 1),
      1,
      HICCUP_HEAD_STEP_COUNT,
    );
    $("sequenceLength").parentElement?.style.setProperty(
      "--length-turn",
      `${-135 + ((previewLength - 1) / (HICCUP_HEAD_STEP_COUNT - 1)) * 270}deg`,
    );
    if ($("sequenceLengthEntry")) $("sequenceLengthEntry").value = String(previewLength);
  });
  $("sequenceLength")?.addEventListener("change", () => (
    setSequenceLength($("sequenceLength").value)
  ));
  $("sequenceLengthEntry")?.addEventListener("change", () => (
    setSequenceLength($("sequenceLengthEntry").value)
  ));
  $("sequenceLengthEntry")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setSequenceLength($("sequenceLengthEntry").value);
    $("sequenceLengthEntry").blur();
  });
  document.querySelectorAll("[data-sequence-length]").forEach((button) => {
    button.addEventListener("click", () => setSequenceLength(button.dataset.sequenceLength));
  });
  $("voiceCount")?.addEventListener("input", () => {
    voiceCount = clamp(Math.round(Number($("voiceCount").value) || 1), 1, voiceSlots.length);
    $("voiceCountOut").value = String(voiceCount);
    $("voiceCountOut").textContent = String(voiceCount);
    activeVoiceSlot = -1;
    voiceCursor = 0;
    buildVoiceRack();
  });
  $("voiceCount")?.addEventListener("change", () => announce(
    `${voiceCount} voice character${voiceCount === 1 ? "" : "s"}; one plays per event`,
  ));
  $("voiceSelectionMode")?.addEventListener("change", () => {
    voiceSelectionMode = $("voiceSelectionMode").value === "random" ? "random" : "round-robin";
    voiceCursor = 0;
    announce(`Voice choice: ${voiceSelectionMode === "random" ? "random per event" : "round robin"}`);
  });
  $("mutateVoicesButton")?.addEventListener("click", () => {
    for (const slot of voiceSlots.slice(0, voiceCount)) {
      slot.voice = mutateHiccupHeadVoice(slot.voice, Math.random, 0.4);
    }
    buildVoiceRack();
    announce(`${voiceCount} voice characters mutated`);
  });
  $("presetSelect").addEventListener("change", () => setPreset($("presetSelect").value));
  $("nextFacePresetButton")?.addEventListener("click", () => cycleFacePreset(1));
  $("patternSelect").addEventListener("change", () => {
    if ($("patternSelect").value !== "custom") setCurrentPattern($("patternSelect").value);
  });
  $("nextPatternButton")?.addEventListener("click", () => cyclePatternPreset(1));
  for (const button of $("padGrid").querySelectorAll("button[data-sound-id]")) {
    const sound = hiccupHeadSound(button.dataset.soundId);
    button.style.setProperty("--pad-color", sound.color);
    button.addEventListener("click", () => triggerSound(sound.id, 0.9));
  }

  $("sequenceGrid").addEventListener("click", handleSequenceGridClick);
  $("sequenceGrid").addEventListener("keydown", handleGridKeydown);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  canvas.addEventListener("pointerup", endPointerDrag);
  canvas.addEventListener("pointercancel", endPointerDrag);

  globalThis.addEventListener("keydown", (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target?.matches?.("input, select, textarea, button, [contenteditable='true']")) return;
    if (event.code === "Space") {
      event.preventDefault();
      toggleSequence();
      return;
    }
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault();
      cycleFacePreset(event.code === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.code === "ArrowUp" || event.code === "ArrowDown") {
      event.preventDefault();
      cyclePatternPreset(event.code === "ArrowDown" ? 1 : -1);
      return;
    }
    const pressedKey = String(event.key).toLowerCase();
    const sound = HICCUP_HEAD_SOUNDS.find(({ key }) => String(key).toLowerCase() === pressedKey);
    if (!sound) return;
    event.preventDefault();
    triggerSound(sound.id, 0.9);
  });
}

function initialize() {
  // Begin the two small local IR requests before the first user gesture so
  // audio activation does not wait on storage or network latency.
  void preloadWarmRoomImpulseData().catch(() => {});
  canvas.setAttribute(
    "aria-description",
    "Tap any colored face dot for its sound, any visible upper tooth for its short irregular dry-wood knock, or the missing front-tooth gap to whistle FWEE. Drag either pupil horizontally to move both pupils in mirrored directions and shape reverb. Drag the left lid down for a post-effects high-pass sweep or the right lid down for stable-volume fuzz. Drag either eyebrow among five rhythmic accent positions. Drag each side-hair tip in two dimensions.",
  );
  syncControlLimits();
  populateSelects();
  buildPadGrid();
  buildVoiceRack({ preserveScroll: false });
  setSequenceLength(Number($("sequenceLength")?.value) || sequenceLength, { announceState: false });
  bindControls();
  syncFaceEffectButtons();
  syncControls();
  setAudioPresentation("off");
  resizeCanvas();
  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(stageWrap);
  const stageVisibilityObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(([entry]) => {
      stageIsVisible = Boolean(entry?.isIntersecting);
      if (stageIsVisible) lastCanvasPaintAt = -Infinity;
    }, { threshold: 0.01 })
    : null;
  stageVisibilityObserver?.observe(stageWrap);
  animationFrame = requestAnimationFrame(drawStage);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopSequence({ announceState: false });
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      graph?.facePostNode?.port.postMessage({ type: "silence" });
      clearNativeRoomHistory();
    }
  });
  globalThis.addEventListener("pagehide", () => {
    stopSequence({ announceState: false });
    cancelAnimationFrame(animationFrame);
    if (pendingCanvasStateFrame) cancelAnimationFrame(pendingCanvasStateFrame);
    pendingCanvasStateFrame = 0;
    pendingCanvasStateUpdate = null;
    resizeObserver.disconnect();
    stageVisibilityObserver?.disconnect();
    graph?.sourceNode?.port.postMessage({ type: "silence" });
    graph?.facePostNode?.port.postMessage({ type: "silence" });
    graph?.releaseOutput?.();
    audioContext?.close?.();
  }, { once: true });
}

initialize();
