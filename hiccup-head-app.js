import {
  HICCUP_HEAD_DEFAULTS,
  HICCUP_HEAD_LIMITS,
  HICCUP_HEAD_PATTERNS,
  HICCUP_HEAD_PRESETS,
  HICCUP_HEAD_SOUNDS,
  HICCUP_HEAD_SOUND_BANKS,
  HICCUP_HEAD_STEP_COUNT,
  HICCUP_HEAD_TOOTH_TINE_PROFILES,
  HICCUP_HEAD_TRACT_SECTION_COUNT,
  HICCUP_HEAD_VELOCITIES,
  HICCUP_HEAD_VOICE_CHARACTERS,
  HICCUP_HEAD_VOICE_LIMITS,
  HICCUP_HEAD_VOICE_MODULATION_SOURCES,
  HICCUP_HEAD_VOICE_MODULATION_TARGETS,
  HICCUP_HEAD_VOICE_SOUND_IDS,
  applyHiccupHeadSoundBank,
  clamp,
  clonePattern,
  hiccupHeadFaceEffectTargets,
  hiccupHeadGeometry,
  hiccupHeadPattern,
  hiccupHeadPreset,
  hiccupHeadPoseForSound,
  hiccupHeadSound,
  hiccupHeadSoundBank,
  hiccupHeadSoundBankOutputGain,
  hiccupHeadState,
  hiccupHeadVoiceCharacter,
  mutateHiccupHeadVoice,
  patternEventsAtStep,
  randomizeHiccupHeadState,
  randomizePattern,
  sanitizeHiccupHeadState,
  sanitizeHiccupHeadVoice,
  sequenceStepIntervalSeconds,
} from "./src/hiccup-head.js?v=hiccup-head-model-20260902-4";
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
  { soundId: "huff", slot: 39, zone: "upper-breath" },
  { soundId: "waow", slot: 40, zone: "upper-voice" },
  { soundId: "whoop", slot: 41, zone: "upper-voice" },
  { soundId: "doodoo", slot: 42, zone: "upper-voice" },
  { soundId: "llll", slot: 43, zone: "left-cheek" },
  { soundId: "purr", slot: 44, zone: "right-cheek" },
  { soundId: "klikklak", slot: 45, zone: "left-tongue" },
  { soundId: "rrrr", slot: 46, zone: "left-tongue" },
  { soundId: "lrroll", slot: 47, zone: "right-tongue" },
  { soundId: "lalatrip", slot: 48, zone: "left-tongue" },
  { soundId: "hiccuplong", slot: 49, zone: "diaphragm-catch" },
  { soundId: "zzzz", slot: 50, zone: "anterior-fricative" },
  { soundId: "ehyeah", slot: 51, zone: "upper-voice" },
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
  // Twelve forehead dots clear the thick brow paths and their drag handles.
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
  pbpb: Object.freeze({ x: -0.86, y: -0.12, region: "left-cheek" }),
  mwah: Object.freeze({ x: 0.72, y: 0.48, region: "right-cheek" }),
  slap: Object.freeze({ x: -0.62, y: 0.42, region: "left-cheek" }),
  tlik: Object.freeze({ x: 0.58, y: 0.4, region: "right-cheek" }),
  drr: Object.freeze({ x: 0.68, y: 0.66, region: "right-cheek" }),
  lala: Object.freeze({ x: -0.68, y: 0.52, region: "left-cheek" }),
  slurp: Object.freeze({ x: -0.54, y: 0.56, region: "left-cheek" }),
  shack: Object.freeze({ x: -0.62, y: 0.68, region: "left-cheek" }),
  shh: Object.freeze({ x: 0.58, y: 0.7, region: "right-cheek" }),
  whistle: Object.freeze({ x: 0.86, y: -0.12, region: "right-cheek" }),
  snare: Object.freeze({ x: 0.8, y: 0.04, region: "right-cheek" }),
  snap: Object.freeze({ x: 0.64, y: 0.02, region: "right-cheek" }),
  tomlo: Object.freeze({ x: -0.8, y: 0.04, region: "left-cheek" }),
  tomhi: Object.freeze({ x: -0.66, y: 0.06, region: "left-cheek" }),
  braap: Object.freeze({ x: 0.8, y: 0.4, region: "right-cheek" }),
  kiss: Object.freeze({ x: -0.5, y: 0.7, region: "left-cheek" }),
  brush: Object.freeze({ x: 0.46, y: 0.72, region: "right-cheek" }),
  huff: Object.freeze({ x: -0.32, y: -0.8, region: "forehead" }),
  waow: Object.freeze({ x: 0.32, y: -0.8, region: "forehead" }),
  whoop: Object.freeze({ x: -0.42, y: -0.62, region: "forehead" }),
  doodoo: Object.freeze({ x: 0.42, y: -0.62, region: "forehead" }),
  llll: Object.freeze({ x: -0.86, y: 0.24, region: "left-cheek" }),
  purr: Object.freeze({ x: 0.86, y: 0.24, region: "right-cheek" }),
  klikklak: Object.freeze({ x: 0, y: -0.27, region: "forehead" }),
  rrrr: Object.freeze({ x: -0.22, y: 0.2, region: "left-cheek" }),
  lrroll: Object.freeze({ x: 0.22, y: 0.2, region: "right-cheek" }),
  lalatrip: Object.freeze({ x: -0.32, y: 0.02, region: "left-cheek" }),
  hiccuplong: Object.freeze({ x: 0.32, y: 0.02, region: "right-cheek" }),
  zzzz: Object.freeze({ x: -0.22, y: -0.7, region: "forehead" }),
  ehyeah: Object.freeze({ x: 0.22, y: -0.7, region: "forehead" }),
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

// Visual skins are deliberately presentation-only. They never enter the
// physical-model state, presets, sequence, or AudioWorklet configuration.
const HICCUP_HEAD_VISUAL_SKINS = Object.freeze([
  Object.freeze({
    id: "checker",
    label: "Checkerboard goofball",
    description: "The original pastel checkerboard Hiccup Head.",
    mode: "checker",
  }),
  Object.freeze({
    id: "cutout-collage",
    label: "Cutout collage",
    description: "Torn anatomy over six beat-switched vintage magazine photographs.",
    mode: "atlas",
    asset: "./assets/hiccup-head/skins/cut-paper-collage.webp",
    fieldAsset: "./assets/hiccup-head/skins/vintage-magazine-face-fields.webp",
  }),
  Object.freeze({
    id: "photo-1904",
    label: "1904 photograph",
    description: "An anonymous black-and-white studio portrait with restrained darkroom exposure pulses.",
    mode: "atlas",
    asset: "./assets/hiccup-head/skins/portrait-1904.webp",
  }),
  Object.freeze({
    id: "food-portrait",
    label: "Food portrait",
    description: "A painted composite head whose ingredient colors turn and glint on the beat.",
    mode: "atlas",
    asset: "./assets/hiccup-head/skins/pantry-portrait.webp",
  }),
  Object.freeze({
    id: "ascii",
    label: "ASCII terminal",
    description: "A density-shaded text-mode face with beat-scanned phosphor and glitch color.",
    mode: "ascii",
  }),
  Object.freeze({
    id: "wild-ink",
    label: "Zombie Zoid",
    description: "A vicious alien-zombie skull cycling through photographic blood, guts, maggots, and pizza.",
    mode: "ink",
    fieldAsset: "./assets/hiccup-head/skins/wild-ink-decay-fields.webp",
  }),
]);
const WEBCAM_CUTUP_VISUAL_SKIN = Object.freeze({
  id: "webcam-cutup",
  label: "Webcam cut-up (this tab)",
  description: "A private session-only photobooth face assembled from your captured feature crops.",
  mode: "atlas",
  sessionOnly: true,
});
const VISUAL_SKIN_STORAGE_KEY = "morphazoid:hiccup-head:visual-skin:v1";
const visualSkinById = new Map(HICCUP_HEAD_VISUAL_SKINS.map((skin) => [skin.id, skin]));
const visualSkinAssets = new Map();
const visualSkinFieldAssets = new Map();
const asciiGlyphPatterns = new Map();
let lowFiPhotoGrainPattern = null;

// Each non-checker face gets its own deterministic print/lighting language.
// Colorways advance from the scheduled step, so the result is repeatable and
// never needs randomness in the animation loop.
const WILD_INK_DECAY_PALETTES = Object.freeze([
  Object.freeze({
    id: "bloody",
    base: "#731827",
    tissue: "#e34d4b",
    bruise: "#310912",
    parasite: "#ffd0a3",
  }),
  Object.freeze({
    id: "visceral",
    base: "#87516d",
    tissue: "#f08fb3",
    bruise: "#36203d",
    parasite: "#dfc8ef",
  }),
  Object.freeze({
    id: "maggoty",
    base: "#727b35",
    tissue: "#c4cf62",
    bruise: "#243019",
    parasite: "#fff2ad",
  }),
]);
function wildInkDecayPaletteForStep(step) {
  const numericStep = Number(step);
  const safeStep = Number.isFinite(numericStep) ? Math.trunc(numericStep) : 0;
  return WILD_INK_DECAY_PALETTES[
    ((safeStep % WILD_INK_DECAY_PALETTES.length) + WILD_INK_DECAY_PALETTES.length)
      % WILD_INK_DECAY_PALETTES.length
  ];
}

const VISUAL_SKIN_BEAT_COLORWAYS = Object.freeze({
  "wild-ink": Object.freeze(WILD_INK_DECAY_PALETTES.map(
    ({ base, tissue, parasite }) => Object.freeze([base, tissue, parasite]),
  )),
  "cutout-collage": Object.freeze([
    Object.freeze(["#ff315f", "#21c8f6", "#ffe13b"]),
    Object.freeze(["#7cff65", "#ff5fcc", "#ff8438"]),
    Object.freeze(["#2a6dff", "#ffca2d", "#ff496c"]),
    Object.freeze(["#00e0a4", "#994cff", "#ffec56"]),
  ]),
  "photo-1904": Object.freeze([
    Object.freeze(["#e7d9b8", "#7c705e", "#2c2924"]),
    Object.freeze(["#d6cfbd", "#82745d", "#25231f"]),
    Object.freeze(["#eadfca", "#70695e", "#332d25"]),
  ]),
  "food-portrait": Object.freeze([
    Object.freeze(["#ffb000", "#d92f24", "#6cbf32"]),
    Object.freeze(["#e95d20", "#8ecb36", "#ffe04d"]),
    Object.freeze(["#c5275a", "#ff9b21", "#57a938"]),
    Object.freeze(["#f3d33b", "#cf3d28", "#75c945"]),
  ]),
  ascii: Object.freeze([
    Object.freeze(["#65ff9d", "#00d8ff", "#f2ff4d"]),
    Object.freeze(["#ff4fd8", "#72ffb3", "#4de7ff"]),
    Object.freeze(["#fff05a", "#31ff8b", "#a875ff"]),
    Object.freeze(["#55ffe0", "#ff5ea8", "#8cff52"]),
  ]),
  "webcam-cutup": Object.freeze([
    Object.freeze(["#ffca45", "#45e0cc", "#ff4f93"]),
    Object.freeze(["#5fd0ff", "#ef62d2", "#8ee85a"]),
    Object.freeze(["#ff7548", "#65e0a1", "#9c72ff"]),
  ]),
});

const WEBCAM_GUIDE_DEFAULTS = Object.freeze({
  head: Object.freeze({ x: 0.5, y: 0.52, width: 0.64, height: 0.86 }),
  hair: Object.freeze({ x: 0.5, y: 0.17, width: 0.58, height: 0.2 }),
  leftEye: Object.freeze({ x: 0.37, y: 0.4, width: 0.19, height: 0.13 }),
  rightEye: Object.freeze({ x: 0.63, y: 0.4, width: 0.19, height: 0.13 }),
  nose: Object.freeze({ x: 0.5, y: 0.54, width: 0.14, height: 0.2 }),
  mouth: Object.freeze({ x: 0.5, y: 0.7, width: 0.34, height: 0.15 }),
});

function freshWebcamGuideCrops() {
  return Object.fromEntries(Object.entries(WEBCAM_GUIDE_DEFAULTS).map(
    ([key, value]) => [key, { ...value }],
  ));
}

let webcamGuideCrops = freshWebcamGuideCrops();
let webcamSelectedGuide = "head";
let webcamStream = null;
let webcamRequestGeneration = 0;
let webcamPhase = "idle";
let webcamGuideDrag = null;
let webcamAppliedAtlas = null;

function visualSkinBeatSeed(soundId) {
  let seed = 0;
  for (const character of String(soundId || "")) {
    seed = (Math.imul(seed, 31) + character.charCodeAt(0)) >>> 0;
  }
  return seed;
}

function visualSkinBeatFrame(
  now,
  step,
  ordinal,
  stepStartedAt,
  hitStartedAt,
  hitVelocity = 0,
  hitSoundId = "",
  reducedMotion = false,
) {
  const numericStep = Number(step);
  const scheduledStep = Number.isInteger(numericStep) && numericStep >= 0 ? numericStep : -1;
  const stepAge = Math.max(0, now - Number(stepStartedAt));
  const hitAge = Math.max(0, now - Number(hitStartedAt));
  const stepPulse = scheduledStep >= 0 && Number.isFinite(stepAge) && stepAge < 520
    ? Math.exp(-Math.max(0, stepAge - 8) / 82)
    : 0;
  const hitPulse = Number.isFinite(hitAge) && hitAge < 720
    ? clamp(Number(hitVelocity) || 0) * Math.exp(-Math.max(0, hitAge - 10) / 148)
    : 0;
  const seededStep = scheduledStep >= 0
    ? scheduledStep
    : visualSkinBeatSeed(hitSoundId) % HICCUP_HEAD_STEP_COUNT;
  const numericOrdinal = Number(ordinal);
  const seededOrdinal = Number.isInteger(numericOrdinal) && numericOrdinal >= 0
    ? numericOrdinal
    : seededStep;
  const pulse = reducedMotion
    ? clamp((stepPulse > 0 ? 0.46 : 0) + (hitPulse > 0 ? Math.min(0.54, hitPulse) : 0))
    : clamp(stepPulse * 0.42 + hitPulse * 0.92);
  return {
    active: pulse > 0.004,
    step: seededStep,
    ordinal: seededOrdinal,
    pulse,
    stepPulse,
    hitPulse,
    downbeat: seededStep % 4 === 0,
  };
}

function visualSkinBeatColors(skinId, step) {
  if (skinId === "checker") return skinCheckerColorsForStep(step);
  const colorways = VISUAL_SKIN_BEAT_COLORWAYS[skinId]
    ?? VISUAL_SKIN_BEAT_COLORWAYS["cutout-collage"];
  return colorways[((step % colorways.length) + colorways.length) % colorways.length];
}

function validVisualSkinId(id) {
  return visualSkinById.has(id) ? id : "checker";
}

function storedVisualSkinId() {
  try {
    const stored = validVisualSkinId(globalThis.localStorage?.getItem(VISUAL_SKIN_STORAGE_KEY));
    // Webcam pixels and their skin selection are intentionally session-only.
    return stored === "webcam-cutup" ? "checker" : stored;
  } catch {
    return "checker";
  }
}

let visualSkinId = storedVisualSkinId();
let lastBuiltInVisualSkinId = visualSkinId;

function currentVisualSkin() {
  return visualSkinById.get(visualSkinId) ?? HICCUP_HEAD_VISUAL_SKINS[0];
}

function primeVisualSkinImage(cache, id, url) {
  if (!url || cache.has(id) || typeof Image !== "function") return;
  const image = new Image();
  const entry = { image, ready: false };
  cache.set(id, entry);
  image.decoding = "async";
  image.addEventListener("load", () => {
    entry.ready = true;
    lastCanvasPaintAt = -Infinity;
  }, { once: true });
  image.addEventListener("error", () => cache.delete(id), { once: true });
  image.src = url;
}

function primeVisualSkinAsset(id) {
  const skin = visualSkinById.get(id);
  if (!skin) return;
  primeVisualSkinImage(visualSkinAssets, id, skin.asset);
  primeVisualSkinImage(visualSkinFieldAssets, id, skin.fieldAsset);
}

function currentVisualSkinAsset() {
  const entry = visualSkinAssets.get(visualSkinId);
  return entry?.ready ? entry.image : null;
}

function currentVisualSkinFieldAsset() {
  const entry = visualSkinFieldAssets.get(visualSkinId);
  return entry?.ready ? entry.image : null;
}

function syncVisualSkinPresentation() {
  const skin = currentVisualSkin();
  const select = $("visualSkinSelect");
  if (select) select.value = skin.id;
  canvas.dataset.visualSkin = skin.id;
  const description = $("visualSkinDescription");
  if (description) {
    description.textContent = `${skin.description} Visual only; changing this skin does not change sound, sequence, presets, or controls.`;
  }
  canvas.setAttribute(
    "aria-label",
    `Playable Hiccup Head using the ${skin.label} visual skin. Fifty-two sound dots, twelve pitched teeth, a whistle gap, and the same movable face controls remain active. Click the nose to quack or drag it to change nasality.`,
  );
}

function setVisualSkin(id, { announceChange = true, persist = true } = {}) {
  const nextId = validVisualSkinId(id);
  visualSkinId = nextId;
  if (nextId !== "webcam-cutup") lastBuiltInVisualSkinId = nextId;
  primeVisualSkinAsset(nextId);
  syncVisualSkinPresentation();
  if (persist && nextId !== "webcam-cutup") {
    try {
      globalThis.localStorage?.setItem(VISUAL_SKIN_STORAGE_KEY, nextId);
    } catch {
      // Visual preference storage may be unavailable in private/embedded pages.
    }
  }
  lastCanvasPaintAt = -Infinity;
  // ASCII's cached glyph texture needs fewer physical pixels than a photo.
  // Recompute the backing store on skin changes so that its lower raster budget
  // actually applies instead of inheriting a 2× photographic canvas.
  resizeCanvas();
  if (announceChange) announce(`${currentVisualSkin().label} visual skin selected; sound is unchanged`);
}

const WEBCAM_GUIDE_LABELS = Object.freeze({
  head: "Head field",
  hair: "Hair",
  leftEye: "Left eye",
  rightEye: "Right eye",
  nose: "Nose",
  mouth: "Mouth",
});

function webcamDialogIsOpen() {
  return Boolean($("webcamSkinDialog")?.open);
}

function setWebcamStatus(message) {
  const status = $("webcamSkinStatus");
  if (status) status.textContent = message;
}

function setWebcamError(message = "") {
  const error = $("webcamSkinError");
  if (!error) return;
  error.hidden = !message;
  error.textContent = message;
}

function stopMediaTracks(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function stopWebcamStream({ invalidateRequest = true } = {}) {
  if (invalidateRequest) webcamRequestGeneration += 1;
  stopMediaTracks(webcamStream);
  webcamStream = null;
  const video = $("webcamSkinVideo");
  if (video) {
    stopMediaTracks(video.srcObject);
    video.pause?.();
    video.srcObject = null;
  }
}

function clearWebcamFrame() {
  const frame = $("webcamSkinFrame");
  if (!frame) return;
  const frameContext = frame.getContext("2d");
  frameContext?.clearRect(0, 0, frame.width, frame.height);
  frame.width = 1;
  frame.height = 1;
  frame.hidden = true;
}

function friendlyWebcamError(error) {
  switch (error?.name) {
    case "NotAllowedError":
      return "Camera access was not allowed. You can retry after enabling camera permission for this page.";
    case "NotFoundError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy or could not start. Close other camera apps and retry.";
    case "SecurityError":
      return "The browser blocked camera access. Open Hiccup Head from localhost or a secure HTTPS page.";
    default:
      return "The camera could not start. Check its permission and try again.";
  }
}

function syncWebcamGuides() {
  for (const crop of Object.values(webcamGuideCrops)) clampWebcamGuide(crop);
  const guideSelect = $("webcamGuideSelect");
  if (guideSelect) guideSelect.value = webcamSelectedGuide;
  const selectedDefault = WEBCAM_GUIDE_DEFAULTS[webcamSelectedGuide];
  const selectedCrop = webcamGuideCrops[webcamSelectedGuide];
  const size = $("webcamGuideSize");
  if (size && selectedDefault && selectedCrop) {
    const scale = selectedCrop.width / selectedDefault.width;
    size.value = String(Math.round(clamp(scale, 0.6, 1.6) * 100));
    const output = $("webcamGuideSizeOut");
    if (output) {
      output.value = `${size.value}%`;
      output.textContent = `${size.value}%`;
    }
  }
  document.querySelectorAll("[data-webcam-guide]").forEach((guide) => {
    const name = guide.dataset.webcamGuide;
    const crop = webcamGuideCrops[name];
    if (!crop) return;
    guide.style.left = `${(crop.x - crop.width * 0.5) * 100}%`;
    guide.style.top = `${(crop.y - crop.height * 0.5) * 100}%`;
    guide.style.width = `${crop.width * 100}%`;
    guide.style.height = `${crop.height * 100}%`;
    guide.classList.toggle("is-selected", name === webcamSelectedGuide);
    guide.setAttribute("aria-pressed", String(name === webcamSelectedGuide));
    guide.setAttribute("aria-label", `${WEBCAM_GUIDE_LABELS[name]} crop; drag to position`);
  });
}

function syncWebcamSkinUi() {
  const hasLivePreview = webcamPhase === "live" || webcamPhase === "requesting";
  const hasFrozenFrame = webcamPhase === "frozen";
  const video = $("webcamSkinVideo");
  const frame = $("webcamSkinFrame");
  const guides = $("webcamSkinGuides");
  if (video) video.hidden = !hasLivePreview;
  if (frame) frame.hidden = !hasFrozenFrame;
  if (guides) guides.hidden = !(webcamPhase === "live" || hasFrozenFrame);

  const start = $("startWebcamButton");
  const freeze = $("freezeWebcamButton");
  const retake = $("retakeWebcamButton");
  const use = $("useWebcamSkinButton");
  const forget = $("forgetWebcamSkinButton");
  if (start) {
    start.hidden = webcamPhase === "live" || hasFrozenFrame || webcamPhase === "requesting";
    start.disabled = webcamPhase === "requesting";
    start.textContent = webcamAppliedAtlas ? "Retake picture" : "Start camera";
  }
  if (freeze) {
    freeze.hidden = webcamPhase !== "live";
    freeze.disabled = webcamPhase !== "live";
  }
  if (retake) retake.hidden = !hasFrozenFrame;
  if (use) {
    use.hidden = !hasFrozenFrame;
    use.disabled = !hasFrozenFrame;
  }
  if (forget) forget.hidden = !webcamAppliedAtlas;
  const adjustment = $("webcamGuideControls");
  if (adjustment) adjustment.hidden = !(webcamPhase === "live" || hasFrozenFrame);

  if (webcamPhase === "idle") {
    setWebcamStatus("Camera is off. Start it when you are ready.");
  } else if (webcamPhase === "requesting") {
    setWebcamStatus("Waiting for camera permission…");
  } else if (webcamPhase === "live") {
    setWebcamStatus("Move the outlines over your features, then freeze the picture.");
  } else if (webcamPhase === "frozen") {
    setWebcamStatus("Picture frozen and camera off. Fine-tune the crops, then use this face.");
  } else if (webcamPhase === "applied") {
    setWebcamStatus("Webcam cut-up is active for this tab. Retake it or remove it whenever you like.");
  } else if (webcamPhase === "error") {
    setWebcamStatus("Camera is off. Fix the camera issue or close this window.");
  }
  syncWebcamGuides();
}

function selectWebcamGuide(name) {
  if (!Object.hasOwn(WEBCAM_GUIDE_DEFAULTS, name)) return;
  webcamSelectedGuide = name;
  syncWebcamGuides();
}

function clampWebcamGuide(crop) {
  const previewBounds = $("webcamSkinPreview")?.getBoundingClientRect?.();
  const previewWidth = Math.max(1, Number(previewBounds?.width) || 320);
  const previewHeight = Math.max(1, Number(previewBounds?.height) || 320);
  const minimumWidth = Math.max(0.04, 44 / previewWidth);
  const minimumHeight = Math.max(0.04, 44 / previewHeight);
  crop.width = clamp(Number(crop.width) || 0.1, minimumWidth, 0.96);
  crop.height = clamp(Number(crop.height) || 0.1, minimumHeight, 0.96);
  crop.x = clamp(Number(crop.x) || 0.5, crop.width * 0.5, 1 - crop.width * 0.5);
  crop.y = clamp(Number(crop.y) || 0.5, crop.height * 0.5, 1 - crop.height * 0.5);
  return crop;
}

function setWebcamGuideScale(name, scale) {
  const base = WEBCAM_GUIDE_DEFAULTS[name];
  const crop = webcamGuideCrops[name];
  if (!base || !crop) return;
  crop.width = base.width * clamp(scale, 0.6, 1.6);
  crop.height = base.height * clamp(scale, 0.6, 1.6);
  clampWebcamGuide(crop);
  syncWebcamGuides();
}

function moveWebcamGuide(name, deltaX, deltaY) {
  const crop = webcamGuideCrops[name];
  if (!crop) return;
  crop.x += deltaX;
  crop.y += deltaY;
  clampWebcamGuide(crop);
  syncWebcamGuides();
}

async function requestWebcamPreview() {
  await silenceHiccupHeadForWebcam();
  if (!webcamDialogIsOpen()) return;
  const generation = ++webcamRequestGeneration;
  setWebcamError("");
  stopWebcamStream({ invalidateRequest: false });
  if (webcamPhase === "frozen") clearWebcamFrame();
  if (!navigator.mediaDevices?.getUserMedia) {
    webcamPhase = "error";
    setWebcamError("This browser does not offer webcam capture. You can keep using every built-in skin.");
    syncWebcamSkinUi();
    return;
  }
  webcamPhase = "requesting";
  syncWebcamSkinUi();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 960, max: 1280 },
        height: { ideal: 960, max: 1280 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    if (generation !== webcamRequestGeneration || !webcamDialogIsOpen()) {
      stopMediaTracks(stream);
      return;
    }
    webcamStream = stream;
    const video = $("webcamSkinVideo");
    if (!video) {
      stopWebcamStream();
      return;
    }
    video.srcObject = stream;
    await video.play?.().catch(() => {});
    if (generation !== webcamRequestGeneration || !webcamDialogIsOpen()) {
      stopMediaTracks(stream);
      video.srcObject = null;
      return;
    }
    webcamPhase = "live";
    syncWebcamSkinUi();
  } catch (error) {
    if (generation !== webcamRequestGeneration) return;
    stopWebcamStream({ invalidateRequest: false });
    webcamPhase = "error";
    setWebcamError(friendlyWebcamError(error));
    syncWebcamSkinUi();
  }
}

function freezeWebcamFrame() {
  const video = $("webcamSkinVideo");
  const frame = $("webcamSkinFrame");
  const sourceWidth = Number(video?.videoWidth);
  const sourceHeight = Number(video?.videoHeight);
  if (!frame || !sourceWidth || !sourceHeight || webcamPhase !== "live") {
    setWebcamError("The camera is still warming up. Wait for the picture, then freeze it again.");
    return;
  }
  const size = usesCompactCanvas() ? 640 : 720;
  frame.width = size;
  frame.height = size;
  const frameContext = frame.getContext("2d", { alpha: false });
  const sourceSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = (sourceWidth - sourceSize) * 0.5;
  const sourceY = (sourceHeight - sourceSize) * 0.5;
  frameContext.save();
  frameContext.fillStyle = "#080507";
  frameContext.fillRect(0, 0, size, size);
  frameContext.translate(size, 0);
  frameContext.scale(-1, 1);
  frameContext.drawImage(
    video,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    size,
    size,
  );
  frameContext.restore();
  stopWebcamStream();
  webcamPhase = "frozen";
  setWebcamError("");
  syncWebcamSkinUi();
}

function normalizedWebcamSourceRect(source, crop) {
  return {
    x: clamp(crop.x - crop.width * 0.5) * source.width,
    y: clamp(crop.y - crop.height * 0.5) * source.height,
    width: clamp(crop.width, 0.01, 1) * source.width,
    height: clamp(crop.height, 0.01, 1) * source.height,
  };
}

function drawWebcamCrop(
  context,
  source,
  crop,
  x,
  y,
  width,
  height,
  { preserveWholeCrop = false } = {},
) {
  const sourceRect = normalizedWebcamSourceRect(source, crop);
  if (preserveWholeCrop) {
    // Wide mouth/hair guides are packed whole into their square atlas cells.
    // The stage expands those cells back to wide destinations, so cover-crop
    // here would permanently throw away most of the selected feature.
    context.drawImage(
      source,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      x,
      y,
      width,
      height,
    );
    return;
  }
  const sourceRatio = sourceRect.width / sourceRect.height;
  const destinationRatio = width / height;
  let sx = sourceRect.x;
  let sy = sourceRect.y;
  let sw = sourceRect.width;
  let sh = sourceRect.height;
  if (sourceRatio > destinationRatio) {
    sw = sh * destinationRatio;
    sx += (sourceRect.width - sw) * 0.5;
  } else {
    sh = sw / destinationRatio;
    sy += (sourceRect.height - sh) * 0.5;
  }
  context.drawImage(source, sx, sy, sw, sh, x, y, width, height);
}

function derivedWebcamCrop(base, xOffset, yOffset, widthScale, heightScale) {
  return clampWebcamGuide({
    x: base.x + base.width * xOffset,
    y: base.y + base.height * yOffset,
    width: base.width * widthScale,
    height: base.height * heightScale,
  });
}

function paintWebcamAtlasPart(
  context,
  atlasSize,
  part,
  source,
  crop,
  mask,
  options,
) {
  const cell = atlasSize / SKIN_ATLAS_COLUMNS;
  const x = (part % SKIN_ATLAS_COLUMNS) * cell;
  const y = Math.floor(part / SKIN_ATLAS_COLUMNS) * cell;
  const padding = cell * 0.035;
  context.save();
  context.translate(x, y);
  mask(context, cell);
  context.clip();
  drawWebcamCrop(
    context,
    source,
    crop,
    padding,
    padding,
    cell - padding * 2,
    cell - padding * 2,
    options,
  );
  context.restore();
}

function paintWebcamHeadMosaic(context, atlasSize, source, crop) {
  const cell = atlasSize / SKIN_ATLAS_COLUMNS;
  const sourceRect = normalizedWebcamSourceRect(source, crop);
  const divisions = 4;
  const tileSize = cell / divisions;
  const sourceTileWidth = sourceRect.width / divisions;
  const sourceTileHeight = sourceRect.height / divisions;
  // Shuffle within horizontal facial bands only. Forehead/hair stays high,
  // eyes remain central, and the selected mouth region stays near the jaw.
  const permutation = [1, 0, 3, 2, 5, 7, 4, 6, 10, 8, 11, 9, 13, 15, 12, 14];
  context.save();
  context.beginPath();
  context.rect(0, 0, cell, cell);
  context.clip();
  context.fillStyle = "#17101a";
  context.fillRect(0, 0, cell, cell);
  for (let target = 0; target < permutation.length; target += 1) {
    const sourceIndex = permutation[target];
    const sourceColumn = sourceIndex % divisions;
    const sourceRow = Math.floor(sourceIndex / divisions);
    const targetColumn = target % divisions;
    const targetRow = Math.floor(target / divisions);
    context.save();
    const dx = targetColumn * tileSize;
    const dy = targetRow * tileSize;
    context.translate(dx + tileSize * 0.5, dy + tileSize * 0.5);
    if ((target + sourceIndex) % 3 === 0) context.scale(-1, 1);
    context.drawImage(
      source,
      sourceRect.x + sourceColumn * sourceTileWidth,
      sourceRect.y + sourceRow * sourceTileHeight,
      sourceTileWidth,
      sourceTileHeight,
      -tileSize * 0.51,
      -tileSize * 0.51,
      tileSize * 1.02,
      tileSize * 1.02,
    );
    context.restore();
  }
  context.restore();
}

function buildWebcamSkinAtlas() {
  const source = $("webcamSkinFrame");
  if (!source || webcamPhase !== "frozen" || source.width <= 1 || source.height <= 1) {
    throw new Error("Freeze a webcam picture before building the cut-up face.");
  }
  const atlasSize = usesCompactCanvas() ? 768 : 1024;
  const atlas = document.createElement("canvas");
  atlas.width = atlasSize;
  atlas.height = atlasSize;
  const context = atlas.getContext("2d");
  context.clearRect(0, 0, atlasSize, atlasSize);

  const ellipse = (ctx, cell) => {
    ctx.beginPath();
    ctx.ellipse(cell * 0.5, cell * 0.5, cell * 0.43, cell * 0.33, 0, 0, Math.PI * 2);
  };
  const roundFeature = (ctx, cell) => roundedRect(ctx, cell * 0.07, cell * 0.25, cell * 0.86, cell * 0.5, cell * 0.22);
  const mouthFeature = (ctx, cell) => roundedRect(ctx, cell * 0.025, cell * 0.16, cell * 0.95, cell * 0.68, cell * 0.3);
  const tallFeature = (ctx, cell) => roundedRect(ctx, cell * 0.27, cell * 0.06, cell * 0.46, cell * 0.88, cell * 0.2);
  const fullFeature = (ctx, cell) => roundedRect(ctx, cell * 0.035, cell * 0.035, cell * 0.93, cell * 0.93, cell * 0.13);
  const hairFeature = (ctx, cell) => {
    ctx.beginPath();
    ctx.moveTo(cell * 0.04, cell * 0.8);
    for (let point = 0; point <= 10; point += 1) {
      const x = cell * (0.04 + point * 0.092);
      const y = cell * (point % 2 === 0 ? 0.16 : 0.38);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cell * 0.96, cell * 0.86);
    ctx.closePath();
  };

  const head = webcamGuideCrops.head;
  const mouth = webcamGuideCrops.mouth;
  const hair = webcamGuideCrops.hair;
  paintWebcamHeadMosaic(context, atlasSize, source, head);
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.leftEye, source, webcamGuideCrops.leftEye, ellipse);
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.rightEye, source, webcamGuideCrops.rightEye, ellipse);
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.brow, source, hair, roundFeature);
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.nose, source, webcamGuideCrops.nose, ellipse);
  paintWebcamAtlasPart(
    context,
    atlasSize,
    SKIN_ATLAS_PART.lips,
    source,
    mouth,
    mouthFeature,
    { preserveWholeCrop: true },
  );
  paintWebcamAtlasPart(
    context,
    atlasSize,
    SKIN_ATLAS_PART.tongue,
    source,
    mouth,
    ellipse,
    { preserveWholeCrop: true },
  );
  paintWebcamAtlasPart(
    context,
    atlasSize,
    SKIN_ATLAS_PART.tooth,
    source,
    derivedWebcamCrop(mouth, 0, -0.18, 0.28, 0.52),
    tallFeature,
  );
  paintWebcamAtlasPart(
    context,
    atlasSize,
    SKIN_ATLAS_PART.leftEar,
    source,
    derivedWebcamCrop(head, -0.43, 0, 0.2, 0.48),
    ellipse,
  );
  paintWebcamAtlasPart(
    context,
    atlasSize,
    SKIN_ATLAS_PART.rightEar,
    source,
    derivedWebcamCrop(head, 0.43, 0, 0.2, 0.48),
    ellipse,
  );
  paintWebcamAtlasPart(
    context,
    atlasSize,
    SKIN_ATLAS_PART.hair,
    source,
    hair,
    hairFeature,
    { preserveWholeCrop: true },
  );
  paintWebcamAtlasPart(
    context,
    atlasSize,
    SKIN_ATLAS_PART.hand,
    source,
    derivedWebcamCrop(head, 0, 0.28, 0.56, 0.34),
    fullFeature,
  );
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.kiss, source, mouth, ellipse);
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.brush, source, hair, roundFeature);
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.tether, source, hair, roundFeature);
  paintWebcamAtlasPart(context, atlasSize, SKIN_ATLAS_PART.swatch, source, head, fullFeature);
  return atlas;
}

function ensureWebcamSkinOption() {
  const select = $("visualSkinSelect");
  if (!select || select.querySelector('option[value="webcam-cutup"]')) return;
  const option = document.createElement("option");
  option.value = WEBCAM_CUTUP_VISUAL_SKIN.id;
  option.textContent = WEBCAM_CUTUP_VISUAL_SKIN.label;
  select.append(option);
}

function applyWebcamSkin() {
  try {
    const atlas = buildWebcamSkinAtlas();
    // Replace the previous session atlas only after the complete new atlas has
    // been built, so a failed retake can never destroy a working skin.
    webcamAppliedAtlas = atlas;
    visualSkinById.set(WEBCAM_CUTUP_VISUAL_SKIN.id, WEBCAM_CUTUP_VISUAL_SKIN);
    visualSkinAssets.set(WEBCAM_CUTUP_VISUAL_SKIN.id, { image: atlas, ready: true });
    ensureWebcamSkinOption();
    setVisualSkin(WEBCAM_CUTUP_VISUAL_SKIN.id, { persist: false });
    clearWebcamFrame();
    webcamPhase = "applied";
    syncWebcamSkinUi();
    $("webcamSkinDialog")?.close();
    announce("Private webcam cut-up skin applied for this tab; sound is unchanged");
  } catch (error) {
    setWebcamError(error?.message || "The frozen picture could not be cut into a face.");
  }
}

function forgetWebcamSkin({ announceChange = true } = {}) {
  stopWebcamStream();
  if (visualSkinId === WEBCAM_CUTUP_VISUAL_SKIN.id) {
    setVisualSkin(lastBuiltInVisualSkinId, { announceChange: false });
  }
  visualSkinAssets.delete(WEBCAM_CUTUP_VISUAL_SKIN.id);
  visualSkinFieldAssets.delete(WEBCAM_CUTUP_VISUAL_SKIN.id);
  visualSkinById.delete(WEBCAM_CUTUP_VISUAL_SKIN.id);
  $("visualSkinSelect")?.querySelector('option[value="webcam-cutup"]')?.remove();
  webcamAppliedAtlas = null;
  clearWebcamFrame();
  webcamPhase = "idle";
  webcamGuideCrops = freshWebcamGuideCrops();
  webcamSelectedGuide = "head";
  syncWebcamSkinUi();
  if (announceChange) announce("Webcam cut-up removed from this tab");
}

function closeWebcamSkinDialog() {
  stopWebcamStream();
  if (webcamPhase === "frozen") {
    clearWebcamFrame();
    webcamPhase = webcamAppliedAtlas ? "applied" : "idle";
  } else if (webcamPhase !== "applied") {
    webcamPhase = webcamAppliedAtlas ? "applied" : "idle";
  }
  $("webcamSkinDialog")?.close();
  syncWebcamSkinUi();
}

function openWebcamSkinDialog() {
  const dialog = $("webcamSkinDialog");
  if (!dialog) return;
  void silenceHiccupHeadForWebcam();
  webcamPhase = webcamAppliedAtlas ? "applied" : "idle";
  setWebcamError("");
  syncWebcamSkinUi();
  if (!dialog.open) dialog.showModal();
  $("startWebcamButton")?.focus();
}

function bindWebcamPhotoBooth() {
  const dialog = $("webcamSkinDialog");
  const preview = $("webcamSkinPreview");
  if (!dialog || !preview) return;
  $("openWebcamSkinButton")?.addEventListener("click", openWebcamSkinDialog);
  $("closeWebcamSkinButton")?.addEventListener("click", closeWebcamSkinDialog);
  $("startWebcamButton")?.addEventListener("click", requestWebcamPreview);
  $("freezeWebcamButton")?.addEventListener("click", freezeWebcamFrame);
  $("retakeWebcamButton")?.addEventListener("click", requestWebcamPreview);
  $("useWebcamSkinButton")?.addEventListener("click", applyWebcamSkin);
  $("forgetWebcamSkinButton")?.addEventListener("click", () => forgetWebcamSkin());
  $("webcamGuideSelect")?.addEventListener("change", (event) => {
    selectWebcamGuide(event.target.value);
  });
  $("webcamGuideSize")?.addEventListener("input", (event) => {
    setWebcamGuideScale(webcamSelectedGuide, Number(event.target.value) / 100);
  });

  document.querySelectorAll("[data-webcam-guide]").forEach((guide) => {
    guide.addEventListener("click", () => {
      if (webcamPhase === "live" || webcamPhase === "frozen") {
        selectWebcamGuide(guide.dataset.webcamGuide);
      }
    });
    guide.addEventListener("pointerdown", (event) => {
      if (!(webcamPhase === "live" || webcamPhase === "frozen")) return;
      const name = guide.dataset.webcamGuide;
      const crop = webcamGuideCrops[name];
      if (!crop) return;
      event.preventDefault();
      selectWebcamGuide(name);
      const bounds = preview.getBoundingClientRect();
      webcamGuideDrag = {
        pointerId: event.pointerId,
        name,
        startX: event.clientX,
        startY: event.clientY,
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
        x: crop.x,
        y: crop.y,
      };
      guide.setPointerCapture?.(event.pointerId);
    });
    guide.addEventListener("pointermove", (event) => {
      if (!webcamGuideDrag || webcamGuideDrag.pointerId !== event.pointerId) return;
      const crop = webcamGuideCrops[webcamGuideDrag.name];
      crop.x = webcamGuideDrag.x + (event.clientX - webcamGuideDrag.startX) / webcamGuideDrag.width;
      crop.y = webcamGuideDrag.y + (event.clientY - webcamGuideDrag.startY) / webcamGuideDrag.height;
      clampWebcamGuide(crop);
      syncWebcamGuides();
    });
    const endDrag = (event) => {
      if (!webcamGuideDrag || webcamGuideDrag.pointerId !== event.pointerId) return;
      guide.releasePointerCapture?.(event.pointerId);
      webcamGuideDrag = null;
    };
    guide.addEventListener("pointerup", endDrag);
    guide.addEventListener("pointercancel", endDrag);
    guide.addEventListener("keydown", (event) => {
      const movement = event.shiftKey ? 0.025 : 0.008;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      selectWebcamGuide(guide.dataset.webcamGuide);
      if (event.shiftKey) {
        const base = WEBCAM_GUIDE_DEFAULTS[webcamSelectedGuide];
        const crop = webcamGuideCrops[webcamSelectedGuide];
        const currentScale = crop.width / base.width;
        const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
        setWebcamGuideScale(webcamSelectedGuide, currentScale + direction * movement);
      } else {
        moveWebcamGuide(
          webcamSelectedGuide,
          event.key === "ArrowLeft" ? -movement : event.key === "ArrowRight" ? movement : 0,
          event.key === "ArrowUp" ? -movement : event.key === "ArrowDown" ? movement : 0,
        );
      }
    });
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeWebcamSkinDialog();
  });
  dialog.addEventListener("close", () => {
    stopWebcamStream();
    if (webcamPhase === "frozen") {
      clearWebcamFrame();
      webcamPhase = webcamAppliedAtlas ? "applied" : "idle";
    }
  });
  syncWebcamSkinUi();
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
const DEFAULT_SEQUENCE_STEP_VELOCITY = 0.72;
let eyebrowEmphasis = DEFAULT_EYEBROW_EMPHASIS;
let pattern = normalizePatternColumns(clonePattern(hiccupHeadPattern(state.patternId)));
let currentPatternId = state.patternId;
let sequenceLength = Math.min(16, HICCUP_HEAD_STEP_COUNT);
let voiceCount = 4;
let voiceSelectionMode = "round-robin";
let voiceCursor = 0;
let activeVoiceSlot = -1;
let voiceSlots = createDefaultVoiceSlots();
let currentSoundBankId = HICCUP_HEAD_SOUND_BANKS[0].id;
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
let lastSequenceSoundId = firstPatternSoundId(pattern) ?? HICCUP_HEAD_SOUNDS[0].id;
let visibleStep = -1;
let visualBeatOrdinal = -1;
// Scheduled visual timestamps stay entirely on the canvas side of the app.
// They let every skin react to the exact playhead/hit that the audio scheduler
// already queued without adding timers or work to the sound graph.
let visualBeatStartedAt = -Infinity;
let visualHitStartedAt = -Infinity;
let visualHitVelocity = 0;
let visualHitSoundId = "";
let paintedGridStep = -1;
let gridCellsByStep = [];
let gridSelectorsByStep = [];
let gridTabStop = null;
let sequenceStepMetadata = createSequenceStepMetadata();
let sequenceStepOwnership = Array(HICCUP_HEAD_STEP_COUNT).fill(null);
let selectedSequenceStep = -1;
let sequenceVelocityPointer = null;
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
let lastAuditionSoundId = "aah";
let noseHonkStartedAt = -Infinity;
const handPlacements = {
  left: { x: -0.62, y: 0.1 },
  right: { x: 0.62, y: 0.14 },
};
const SOUND_BANK_AUDITION_IDS = Object.freeze({
  "natural-mouth": "aah",
  "wet-rubber": "pbpb",
  "tongue-workshop": "zzzz",
  "open-throat": "ehyeah",
  "rough-cellar": "grunt",
  "tiny-cartoon": "doodoo",
  "air-pockets": "eef",
});
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

function bankedSoundConfiguration(source = state) {
  return applyHiccupHeadSoundBank(
    sanitizeHiccupHeadState({ ...state, ...(source ?? {}) }, state),
    currentSoundBankId,
  );
}

function retuneVoiceSlotsForBank(bankId, { mutate = false } = {}) {
  const bank = hiccupHeadSoundBank(bankId);
  voiceSlots.forEach((slot, index) => {
    const character = hiccupHeadVoiceCharacter(
      bank.characterIds[index % bank.characterIds.length],
    );
    const base = sanitizeHiccupHeadVoice({
      characterId: character.id,
      ...character.settings,
      modulation: slot.voice.modulation,
    });
    slot.voice = mutate
      ? mutateHiccupHeadVoice(base, Math.random, 0.64)
      : base;
  });
  voiceCursor = 0;
  activeVoiceSlot = -1;
}

function setSoundBank(bankId, { mutate = false, audition = true } = {}) {
  const bank = hiccupHeadSoundBank(bankId);
  currentSoundBankId = bank.id;
  retuneVoiceSlotsForBank(bank.id, { mutate });
  if ($("soundBankSelect")) $("soundBankSelect").value = bank.id;
  if ($("soundBankDescription")) $("soundBankDescription").textContent = bank.description;
  buildVoiceRack();
  announce(`${bank.label} sound bank${mutate ? " mutated" : " loaded"}`);
  if (audition) {
    void auditionCurrentSoundBank(null, SOUND_BANK_AUDITION_IDS[bank.id] ?? "aah");
  }
}

function cycleSoundBank(direction = 1, options = {}) {
  const currentIndex = HICCUP_HEAD_SOUND_BANKS.findIndex(({ id }) => id === currentSoundBankId);
  const nextIndex = (currentIndex + Math.sign(direction || 1) + HICCUP_HEAD_SOUND_BANKS.length)
    % HICCUP_HEAD_SOUND_BANKS.length;
  setSoundBank(HICCUP_HEAD_SOUND_BANKS[nextIndex].id, options);
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

function createSequenceStepMetadata() {
  return Array.from(
    { length: HICCUP_HEAD_STEP_COUNT },
    () => ({ spanSteps: 1, mode: "hold" }),
  );
}

function resetSequenceStepMetadata() {
  sequenceStepMetadata = createSequenceStepMetadata();
  rebuildSequenceStepOwnership();
}

function normalizedSequenceStepMetadata(step) {
  const source = sequenceStepMetadata[step];
  return {
    spanSteps: clamp(Math.round(Number(source?.spanSteps) || 1), 1, 8),
    mode: source?.mode === "repeat" ? "repeat" : "hold",
  };
}

function maximumSequenceSpanForAnchor(anchorStep) {
  if (!Number.isInteger(anchorStep) || anchorStep < 0 || anchorStep >= sequenceLength) return 1;
  const boundary = Math.min(sequenceLength, anchorStep + 8);
  let spanSteps = 1;
  for (let step = anchorStep + 1; step < boundary; step += 1) {
    if (patternEventForStep(step)) break;
    spanSteps += 1;
  }
  return spanSteps;
}

// Spans own only empty steps to their right. This cache is rebuilt atomically
// after edits, so the realtime lookahead loop never searches the DOM or has to
// resolve overlapping anchors while it is scheduling audio.
function rebuildSequenceStepOwnership() {
  const nextOwnership = Array(HICCUP_HEAD_STEP_COUNT).fill(null);
  for (let anchorStep = 0; anchorStep < sequenceLength; anchorStep += 1) {
    if (!patternEventForStep(anchorStep)) continue;
    const metadata = normalizedSequenceStepMetadata(anchorStep);
    const spanSteps = Math.min(
      metadata.spanSteps,
      maximumSequenceSpanForAnchor(anchorStep),
      sequenceLength - anchorStep,
    );
    sequenceStepMetadata[anchorStep] = { ...metadata, spanSteps };
    for (let offset = 0; offset < spanSteps; offset += 1) {
      nextOwnership[anchorStep + offset] = {
        anchorStep,
        offset,
        spanSteps,
        mode: metadata.mode,
      };
    }
  }
  sequenceStepOwnership = nextOwnership;
}

function sequenceAnchorForStep(step) {
  const safeStep = clamp(Math.round(Number(step) || 0), 0, Math.max(0, sequenceLength - 1));
  return sequenceStepOwnership[safeStep]?.anchorStep ?? safeStep;
}

function releaseOwnedContinuation(step) {
  const ownership = sequenceStepOwnership[step];
  if (!ownership || ownership.offset === 0) return;
  const metadata = normalizedSequenceStepMetadata(ownership.anchorStep);
  sequenceStepMetadata[ownership.anchorStep] = {
    ...metadata,
    spanSteps: Math.max(1, ownership.offset),
  };
}

function setAudioPresentation(status = "off", message = "") {
  const on = status === "on";
  const photoPaused = status === "photo-paused";
  $("audioButton").setAttribute("aria-pressed", String(on));
  $("audioButton").dataset.audioState = status;
  $("audioButton").disabled = status === "starting";
  $("audioState").textContent = status === "starting"
    ? "starting"
    : photoPaused
      ? "photo pause"
      : on
        ? "on"
        : "off";
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

async function silenceHiccupHeadForWebcam() {
  // The camera and audio renderer never need to compete. Entering the booth
  // pauses the transport, clears every tail, then suspends the otherwise warm
  // context. Play/Audio will resume that same graph through ensureAudio later.
  stopSequence({ announceState: false });
  graph?.sourceNode?.port.postMessage({ type: "silence" });
  graph?.facePostNode?.port.postMessage({ type: "silence" });
  clearNativeRoomHistory();
  if (audioContext?.state !== "running") return;
  const contextToPause = audioContext;
  try {
    await contextToPause.suspend();
    if (audioContext === contextToPause && contextToPause.state === "suspended") {
      setAudioPresentation("photo-paused");
    }
  } catch {
    // The explicit silence messages above still prevent sound if a browser
    // declines to suspend while a device transition is in progress.
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
        "./src/hiccup-head-processor.js?v=hiccup-head-tract-20260902-4",
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
    // A Play/pad request may have begun just before the photobooth opened.
    // Re-check after asynchronous graph warmup so that late startup cannot
    // sneak sound or an active render context underneath the camera modal.
    if (webcamDialogIsOpen()) {
      await silenceHiccupHeadForWebcam();
      return false;
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

const VOICE_SOUND_IDS = new Set(HICCUP_HEAD_VOICE_SOUND_IDS);
const TEMPO_STRETCH_SOUND_IDS = new Set([
  "pff", "whistle", "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle",
  "grunt", "moan", "lala", "pbpb", "slurp", "mwah", "huff", "waow", "whoop",
  "doodoo", "llll", "purr", "rrrr", "lrroll", "lalatrip", "hiccuplong",
  "zzzz", "ehyeah",
]);
const TOOTH_TINE_PROFILES = HICCUP_HEAD_TOOTH_TINE_PROFILES;

function flashSound(soundId, velocity = 1, voiceChoice = null) {
  const sound = hiccupHeadSound(soundId);
  // Keep playback flashes off the sequencer DOM. At fast tempos, touching all
  // matching steps and installing a timer per cell can swamp a phone's main
  // thread even though the audio worklet itself remains healthy.
  for (const element of [padButtonsBySound.get(sound.id)]) {
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
  if (webcamDialogIsOpen() || !graph || audioContext?.state !== "running") return false;
  const boundedDelay = clamp(delaySeconds, 0, 2);
  const strikeConfiguration = configuration ? audioConfiguration(configuration) : null;
  const rawToothTine = eventDetails?.toothTine;
  const toothTine = rawToothTine ? {
    frequencyHz: clamp(Number(rawToothTine.frequencyHz) || 440, 80, 4_000),
    position: clamp(Number(rawToothTine.position) || 0, 0, 1),
    brightness: clamp(Number(rawToothTine.brightness) || 0, 0, 1),
    toothIndex: Math.round(clamp(Number(rawToothTine.toothIndex) || 0, 0, 11)),
  } : null;
  let brushDirection = 1;
  if (soundId === "brush") {
    if (eventDetails?.brushDirection === -1 || eventDetails?.brushDirection === 1) {
      brushDirection = eventDetails.brushDirection;
    } else {
      brushDirection = nextBrushDirection;
      nextBrushDirection *= -1;
    }
  }
  const requestedGestureDuration = Number(eventDetails?.gestureDurationSeconds);
  const gestureDurationSeconds = Number.isFinite(requestedGestureDuration)
    ? clamp(requestedGestureDuration, 0.018, 2.2)
    : null;
  const bankOutputGain = hiccupHeadSoundBankOutputGain(currentSoundBankId, soundId);
  const safeEventDetails = toothTine || soundId === "brush" || gestureDurationSeconds || bankOutputGain !== 1
    ? {
      ...(toothTine ? { toothTine } : {}),
      ...(soundId === "brush" ? { brushDirection } : {}),
      ...(gestureDurationSeconds ? { gestureDurationSeconds } : {}),
      ...(bankOutputGain !== 1 ? { bankOutputGain } : {}),
    }
    : null;
  graph.sourceNode.port.postMessage({
    type: "strike",
    soundId: hiccupHeadSound(soundId).id,
    velocity: clamp(velocity, 0.01, 1),
    delaySeconds: boundedDelay,
    ...(strikeConfiguration ? { configuration: strikeConfiguration } : {}),
    ...(voiceChoice?.voice ? { voice: voiceChoice.voice } : {}),
    ...(toothTine ? { toothTine } : {}),
    ...(soundId === "brush" ? { brushDirection } : {}),
    ...(gestureDurationSeconds ? { gestureDurationSeconds } : {}),
    ...(bankOutputGain !== 1 ? { bankOutputGain } : {}),
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
  if (webcamDialogIsOpen()) return false;
  const sound = hiccupHeadSound(soundId);
  if (!(await ensureAudio())) return false;
  const transientConfiguration = configuration
    ?? (sound.id === "slap" ? handStrikeConfiguration("left") : null)
    ?? (sound.id === "smack" ? handStrikeConfiguration("right") : null);
  const strikeConfiguration = bankedSoundConfiguration(transientConfiguration ?? state);
  const voiceChoice = voiceChoiceForSound(sound.id, performance.now());
  postStrike(sound.id, velocity, 0, null, strikeConfiguration, voiceChoice, eventDetails);
  lastAuditionSoundId = sound.id;
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

async function auditionCurrentSoundBank(preferredSlotIndex = null, preferredSoundId = null) {
  if (sequencePlaying) return false;
  const requestedSound = hiccupHeadSound(preferredSoundId ?? lastAuditionSoundId);
  // Voice mutation cannot reveal itself through a tooth, hand, or other
  // unvoiced event. Fall back to a sustained vowel for a guaranteed audible
  // before/after comparison.
  const sound = VOICE_SOUND_IDS.has(requestedSound.id)
    ? requestedSound
    : hiccupHeadSound("aah");
  if (!(await ensureAudio())) return false;
  const transientConfiguration = sound.id === "slap"
    ? handStrikeConfiguration("left")
    : sound.id === "smack"
      ? handStrikeConfiguration("right")
      : state;
  const preferredSlot = Number.isInteger(preferredSlotIndex)
    ? voiceSlots[clamp(preferredSlotIndex, 0, voiceSlots.length - 1)]
    : null;
  const slot = preferredSlot
    ?? voiceSlots.find((candidate) => candidate.solo)
    ?? voiceSlots.find((candidate) => candidate.assignment === sound.id)
    ?? voiceSlots[0];
  const slotIndex = Math.max(0, voiceSlots.indexOf(slot));
  const voice = sanitizeHiccupHeadVoice(slot.voice);
  postStrike(
    sound.id,
    0.86,
    0,
    null,
    bankedSoundConfiguration(transientConfiguration),
    { slotIndex, voice, label: hiccupHeadVoiceCharacter(voice.characterId).label },
  );
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

function scheduledSequenceEventAtStep(step) {
  const ownership = sequenceStepOwnership[step];
  if (!ownership) return null;
  if (ownership.mode === "hold" && ownership.offset > 0) return null;
  const event = patternEventForStep(ownership.anchorStep);
  if (!event) return null;
  return {
    soundId: event.sound.id,
    velocity: event.velocity,
    ownership,
  };
}

function availableGestureSecondsUntilNextNote(step, absoluteStepIndex) {
  let stepDistance = sequenceLength;
  for (let offset = 1; offset <= sequenceLength; offset += 1) {
    const candidateStep = (step + offset) % sequenceLength;
    if (scheduledSequenceEventAtStep(candidateStep)) {
      stepDistance = offset;
      break;
    }
  }
  let seconds = 0;
  for (let offset = 0; offset < stepDistance; offset += 1) {
    seconds += sequenceStepIntervalSeconds(
      state.tempo,
      state.swing,
      absoluteStepIndex + offset,
    );
  }
  return seconds;
}

function sequenceSpanDurationSeconds(spanSteps, absoluteStepIndex) {
  let seconds = 0;
  for (let offset = 0; offset < spanSteps; offset += 1) {
    seconds += sequenceStepIntervalSeconds(
      state.tempo,
      state.swing,
      absoluteStepIndex + offset,
    );
  }
  return seconds;
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
    const event = scheduledSequenceEventAtStep(step);
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
      const strikeConfigurationBase = event.soundId === "slap"
        ? handStrikeConfiguration("left")
        : event.soundId === "smack"
          ? handStrikeConfiguration("right")
          : state;
      const strikeConfiguration = bankedSoundConfiguration(strikeConfigurationBase);
      const spanSteps = event.ownership?.spanSteps ?? 1;
      let eventDetails = null;
      // A held span remains one worklet strike and gets a swing-aware gesture
      // duration. Span one intentionally follows the old sound path exactly.
      if (event.ownership?.mode === "hold" && spanSteps > 1) {
        eventDetails = {
          gestureDurationSeconds: clamp(
            sequenceSpanDurationSeconds(spanSteps, absoluteStep) * 0.92,
            0.018,
            2.2,
          ),
        };
      } else if (event.ownership?.mode === "repeat" || spanSteps === 1) {
        // BRUSH is one mouth gesture containing twelve tooth contacts. In
        // repeat mode the derived next strike is the next owned physical step.
        eventDetails = event.soundId === "brush"
          ? {
            gestureDurationSeconds: clamp(
              availableGestureSecondsUntilNextNote(step, absoluteStep) * 0.78,
              0.018,
              0.54,
            ),
          }
          : null;
      }
      postStrike(
        event.soundId,
        sequencedVelocity,
        delaySeconds,
        step,
        strikeConfiguration,
        voiceChoice,
        eventDetails,
      );
    }
    visualQueue.push({
      type: "step",
      step,
      ordinal: absoluteStep,
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
    visualBeatOrdinal = -1;
    // The graph has already warmed in ensureAudio. This lead supplies the
    // first physical closure with its full preparation interval while keeping
    // the audible strike and painted step locked to the same timestamp.
    nextStepTime = audioContext.currentTime + 0.072;
  }
  sequencePlaying = true;
  $("playButton").setAttribute("aria-pressed", "true");
  $("playButton").setAttribute("aria-label", "Pause sequence");
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
  visualBeatOrdinal = -1;
  visualBeatStartedAt = -Infinity;
  updateGridPlayhead();
  $("playButton").setAttribute("aria-pressed", "false");
  $("playButton").setAttribute("aria-label", "Play sequence");
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
  visualBeatOrdinal = -1;
  visualBeatStartedAt = -Infinity;
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
  resetSequenceStepMetadata();
  currentPatternId = preset.id;
  state = sanitizeHiccupHeadState({ ...state, patternId: preset.id }, state);
  $("patternSelect").value = preset.id;
  lastSequenceSoundId = firstPatternSoundId(pattern) ?? lastSequenceSoundId;
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
  resetSequenceStepMetadata();
  markPatternCustom();
  lastSequenceSoundId = firstPatternSoundId(pattern) ?? lastSequenceSoundId;
  buildSequenceGrid();
  announce("A new full-face pattern was scattered across the grid");
}

function clearPattern() {
  pattern = clonePattern({});
  resetSequenceStepMetadata();
  markPatternCustom();
  buildSequenceGrid();
  announce("Sequence grid cleared");
}

const sequenceSoundNumberById = new Map(HICCUP_HEAD_SOUNDS.map(
  ({ id }, index) => [id, String(index + 1).padStart(2, "0")],
));

function sequenceSoundLabel(sound) {
  return `${sequenceSoundNumberById.get(sound.id)} · ${sound.label}`;
}

function patternEventForStep(step, source = pattern) {
  for (const sound of HICCUP_HEAD_SOUNDS) {
    const velocity = Number(source?.[sound.id]?.[step]) || 0;
    if (velocity > 0) return { sound, velocity };
  }
  return null;
}

function firstPatternSoundId(source = pattern) {
  for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
    const event = patternEventForStep(step, source);
    if (event) return event.sound.id;
  }
  return null;
}

function cellLabel(sound, step, value) {
  const velocity = clamp(Number(value) || 0, 0, 1);
  if (velocity <= 0) {
    return `Step ${step + 1}, empty. Click or drag vertically to add ${sequenceSoundLabel(sound)}; zero volume is off.`;
  }
  return `${sequenceSoundLabel(sound)}, step ${step + 1}, ${Math.round(velocity * 100)} percent volume. Drag vertically to change it; drag to zero to remove it.`;
}

function renderCell(button, event, ownership = null) {
  const step = Number(button.dataset.step);
  const sound = event?.sound ?? hiccupHeadSound(lastSequenceSoundId);
  const velocity = event?.velocity ?? 0;
  const level = soundLevelIndex(velocity);
  const active = velocity > 0;
  button.dataset.soundId = event?.sound.id ?? "";
  button.dataset.level = String(level);
  button.dataset.active = String(active);
  button.style.setProperty("--step-velocity", String(clamp(velocity, 0, 1)));
  button.style.setProperty(
    "--step-marker-position",
    `${(clamp(velocity, 0.04, 0.96) * 100).toFixed(2)}%`,
  );
  button.setAttribute("aria-pressed", String(active));
  const hitMark = button.querySelector(".hiccup-head-step-hit-mark");
  if (hitMark) hitMark.hidden = !active;
  const number = button.querySelector(".hiccup-head-step-sound-number");
  if (number) number.textContent = event ? sequenceSoundNumberById.get(sound.id) : "—";
  const velocityLabel = button.querySelector(".hiccup-head-step-velocity-number");
  if (velocityLabel) velocityLabel.textContent = String(Math.round(velocity * 100));
  const previewButton = button.closest(".hiccup-head-step-slot")
    ?.querySelector(".hiccup-head-step-audition");
  if (previewButton) {
    previewButton.disabled = !event;
    previewButton.setAttribute(
      "aria-label",
      event
        ? `Hear ${sequenceSoundLabel(sound)} on step ${step + 1} without changing it`
        : `Step ${step + 1} has no sound to hear`,
    );
    previewButton.title = event ? `Hear ${sequenceSoundLabel(sound)}` : "No sound on this step";
  }
  const continuation = ownership?.offset > 0;
  const label = continuation
    ? `${sequenceSoundLabel(sound)}, step ${step + 1}, ${ownership.mode === "repeat" ? "repeated" : "held"} from step ${ownership.anchorStep + 1}. Activate to edit the anchor velocity.`
    : event
      ? cellLabel(sound, step, velocity)
      : cellLabel(sound, step, 0);
  button.setAttribute("aria-label", label);
  button.title = label;
}

function updateGridPlayhead() {
  if (paintedGridStep === visibleStep) return;
  if (paintedGridStep >= 0) {
    gridCellsByStep[paintedGridStep]?.classList.remove("is-current");
  }
  if (visibleStep >= 0) {
    gridCellsByStep[visibleStep]?.classList.add("is-current");
  }
  paintedGridStep = visibleStep;
  if (sequencePlaying) {
    setTextIfChanged("playState", `${Math.round(state.tempo)} BPM · step ${visibleStep + 1 || 1}`);
  }
}

function renderPatternColumn(step) {
  const button = gridCellsByStep[step];
  const selector = gridSelectorsByStep[step];
  if (!button || !selector) return;
  const ownership = sequenceStepOwnership[step];
  const event = ownership ? patternEventForStep(ownership.anchorStep) : null;
  const directEvent = patternEventForStep(step);
  const rowColor = event?.sound.color ?? "var(--hiccup-head-muted)";
  const selectedId = event?.sound.id ?? "";
  renderCell(button, event, ownership);
  if (selector.dataset.expanded !== "true") {
    selector.replaceChildren(...compactSoundOptions(selectedId));
  }
  selector.value = selectedId;
  selector.style.setProperty("--row-color", rowColor);
  const slot = selector.closest(".hiccup-head-step-slot");
  slot?.style.setProperty("--row-color", rowColor);
  if (slot) {
    slot.dataset.anchorStep = String(ownership?.anchorStep ?? step);
    slot.dataset.continuation = String(Boolean(ownership?.offset));
    slot.dataset.mode = ownership?.mode ?? "hold";
    slot.classList.toggle("is-selected", step === selectedSequenceStep);
    slot.classList.toggle(
      "is-selected-span",
      Boolean(ownership && ownership.anchorStep === selectedSequenceStep),
    );
  }
  selector.setAttribute(
    "aria-label",
    `Sound for step ${step + 1}: ${event ? sequenceSoundLabel(event.sound) : "empty"}${ownership?.offset ? `, owned by step ${ownership.anchorStep + 1}` : ""}`,
  );
  selector.title = event
    ? `${sequenceSoundLabel(event.sound)} — ${event.sound.subtitle}${ownership?.offset ? ` · span from step ${ownership.anchorStep + 1}` : ""}`
    : `Choose a sound for step ${step + 1}`;
  selector.dataset.directSoundId = directEvent?.sound.id ?? "";
}

function renderPattern() {
  rebuildSequenceStepOwnership();
  if (selectedSequenceStep >= 0) {
    selectedSequenceStep = sequenceAnchorForStep(selectedSequenceStep);
  }
  for (let step = 0; step < sequenceLength; step += 1) {
    renderPatternColumn(step);
  }
  updateGridPlayhead();
  updateSelectedStepContext();
}

function setGridTabStop(cell) {
  if (!cell || cell === gridTabStop) return;
  if (gridTabStop) gridTabStop.tabIndex = -1;
  cell.tabIndex = 0;
  gridTabStop = cell;
}

function selectSequenceStep(step) {
  selectedSequenceStep = sequenceAnchorForStep(step);
  for (let physicalStep = 0; physicalStep < sequenceLength; physicalStep += 1) {
    const slot = gridCellsByStep[physicalStep]?.closest(".hiccup-head-step-slot");
    const ownership = sequenceStepOwnership[physicalStep];
    slot?.classList.toggle("is-selected", physicalStep === selectedSequenceStep);
    slot?.classList.toggle(
      "is-selected-span",
      Boolean(ownership && ownership.anchorStep === selectedSequenceStep),
    );
  }
  updateSelectedStepContext();
}

function focusGridCell(step) {
  const safeStep = (step + sequenceLength) % sequenceLength;
  const target = gridCellsByStep[safeStep];
  if (!target) return;
  setGridTabStop(target);
  target.focus();
}

function setSequenceStepVelocity(
  rawStep,
  rawVelocity,
  { soundId = "", audition = false, announceState = false } = {},
) {
  const step = sequenceAnchorForStep(rawStep);
  const previousEvent = patternEventForStep(step);
  const previousMetadata = normalizedSequenceStepMetadata(step);
  const sound = hiccupHeadSound(soundId || previousEvent?.sound.id || lastSequenceSoundId);
  const numericVelocity = Number(rawVelocity);
  const velocity = Number.isFinite(numericVelocity)
    ? clamp(numericVelocity, 0, 1)
    : previousEvent?.velocity ?? DEFAULT_SEQUENCE_STEP_VELOCITY;
  const active = velocity > 0;

  if (active) {
    clearStepExcept(step, sound.id);
    pattern[sound.id][step] = velocity;
    lastSequenceSoundId = sound.id;
  } else {
    clearStepExcept(step, "");
    sequenceStepMetadata[step] = { spanSteps: 1, mode: "hold" };
  }

  markPatternCustom();
  rebuildSequenceStepOwnership();
  if (Boolean(previousEvent) !== active || previousMetadata.spanSteps > 1) {
    renderPattern();
  } else {
    renderPatternColumn(step);
    updateSelectedStepContext();
  }
  if (audition && active) triggerSound(sound.id, velocity);
  if (announceState) announce(cellLabel(sound, step, velocity));
  return { active, sound, step, velocity };
}

function sequenceVelocityFromPointer(cell, clientY) {
  const rect = cell.getBoundingClientRect();
  if (!rect.height) return 0;
  const normalized = clamp((rect.bottom - clientY) / rect.height, 0, 1);
  // A small bottom landing zone makes an exact rest practical on touchscreens.
  if (normalized <= 0.025) return 0;
  return Math.round(normalized * 100) / 100;
}

function applySequenceVelocityPointer(event) {
  const edit = sequenceVelocityPointer;
  if (!edit || event.pointerId !== edit.pointerId) return;
  const velocity = sequenceVelocityFromPointer(edit.cell, event.clientY);
  if (velocity === edit.velocity) return;
  edit.velocity = velocity;
  setSequenceStepVelocity(edit.step, velocity);
}

function handleSequenceVelocityPointerDown(event) {
  const grid = $("sequenceGrid");
  const cell = event.target.closest?.(".hiccup-head-step-cell");
  if (!cell || !grid.contains(cell)) return;
  if (event.button !== undefined && event.button !== 0) return;
  if (event.isPrimary === false) return;
  event.preventDefault();
  const step = sequenceAnchorForStep(Number(cell.dataset.step));
  selectSequenceStep(step);
  setGridTabStop(cell);
  cell.focus({ preventScroll: true });
  cell.classList.add("is-velocity-editing");
  cell.setPointerCapture?.(event.pointerId);
  sequenceVelocityPointer = {
    cell,
    pointerId: event.pointerId,
    step,
    velocity: -1,
  };
  applySequenceVelocityPointer(event);
}

function handleSequenceVelocityPointerMove(event) {
  if (!sequenceVelocityPointer || event.pointerId !== sequenceVelocityPointer.pointerId) return;
  event.preventDefault();
  applySequenceVelocityPointer(event);
}

function handleSequenceVelocityPointerEnd(event) {
  const edit = sequenceVelocityPointer;
  if (!edit || event.pointerId !== edit.pointerId) return;
  sequenceVelocityPointer = null;
  edit.cell.classList.remove("is-velocity-editing");
  if (edit.cell.hasPointerCapture?.(event.pointerId)) {
    edit.cell.releasePointerCapture?.(event.pointerId);
  }
  const finalEvent = patternEventForStep(edit.step);
  if (event.type !== "pointercancel" && finalEvent) {
    triggerSound(finalEvent.sound.id, finalEvent.velocity);
  }
  const sound = finalEvent?.sound ?? hiccupHeadSound(lastSequenceSoundId);
  announce(cellLabel(sound, edit.step, finalEvent?.velocity ?? 0));
}

function handleGridKeydown(event) {
  const button = event.target.closest?.(".hiccup-head-step-cell");
  if (!button || !$("sequenceGrid").contains(button)) return;
  const step = Number(button.dataset.step);
  const anchorStep = sequenceAnchorForStep(step);
  const currentEvent = patternEventForStep(anchorStep);
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const increment = event.shiftKey ? 0.1 : 0.05;
    const nextVelocity = event.key === "ArrowUp"
      ? currentEvent
        ? clamp(currentEvent.velocity + increment, 0, 1)
        : DEFAULT_SEQUENCE_STEP_VELOCITY
      : clamp((currentEvent?.velocity ?? 0) - increment, 0, 1);
    setSequenceStepVelocity(anchorStep, nextVelocity, { announceState: true });
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace" || event.key === "0") {
    event.preventDefault();
    setSequenceStepVelocity(anchorStep, 0, { announceState: true });
    return;
  }
  let targetStep = null;
  if (event.key === "ArrowLeft") targetStep = step - 1;
  if (event.key === "ArrowRight") targetStep = step + 1;
  if (event.key === "Home") targetStep = 0;
  if (event.key === "End") targetStep = sequenceLength - 1;
  if (targetStep === null) return;
  event.preventDefault();
  focusGridCell(targetStep);
}

function handleSequenceGridFocus(event) {
  // Hearing a sound is deliberately selection-neutral: previewing must not
  // open the contextual editor or visually alter the lane.
  const control = event.target.closest?.(".hiccup-head-step-cell, .hiccup-head-step-sound-select");
  if (!control || !$("sequenceGrid").contains(control)) return;
  selectSequenceStep(Number(control.dataset.step));
}

function handleSequenceGridClick(event) {
  const grid = $("sequenceGrid");
  const cell = event.target.closest?.(".hiccup-head-step-cell");
  if (!cell || !grid.contains(cell)) return;
  // Pointer clicks have already written their exact vertical value. A
  // zero-detail activation comes from the keyboard or assistive technology.
  if (event.detail > 0) return;
  const step = sequenceAnchorForStep(Number(cell.dataset.step));
  selectSequenceStep(step);
  const currentEvent = patternEventForStep(step);
  const sound = currentEvent?.sound ?? hiccupHeadSound(lastSequenceSoundId);
  setGridTabStop(cell);
  setSequenceStepVelocity(step, currentEvent?.velocity ?? DEFAULT_SEQUENCE_STEP_VELOCITY, {
    soundId: sound.id,
    audition: true,
    announceState: true,
  });
}

function soundOptions(selectedId = "") {
  const options = [];
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "—";
  emptyOption.selected = !selectedId;
  options.push(emptyOption);
  HICCUP_HEAD_SOUNDS.forEach((sound) => {
    const option = document.createElement("option");
    option.value = sound.id;
    option.textContent = sequenceSoundLabel(sound);
    option.title = sound.subtitle;
    option.selected = sound.id === selectedId;
    options.push(option);
  });
  return options;
}

function compactSoundOptions(selectedId = "") {
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "—";
  emptyOption.selected = !selectedId;
  if (!selectedId || !sequenceSoundNumberById.has(selectedId)) return [emptyOption];
  const sound = hiccupHeadSound(selectedId);
  const selectedOption = document.createElement("option");
  selectedOption.value = sound.id;
  selectedOption.textContent = sequenceSoundNumberById.get(sound.id);
  selectedOption.title = sound.subtitle;
  selectedOption.selected = true;
  return [emptyOption, selectedOption];
}

function expandStepSoundSelector(selector) {
  if (!selector || selector.dataset.expanded === "true") return;
  const selectedId = selector.value;
  selector.replaceChildren(...soundOptions(selectedId));
  selector.value = selectedId;
  selector.dataset.expanded = "true";
}

function compactStepSoundSelector(selector) {
  if (!selector || selector.dataset.expanded !== "true") return;
  const selectedId = selector.value;
  selector.replaceChildren(...compactSoundOptions(selectedId));
  selector.value = selectedId;
  delete selector.dataset.expanded;
}

function setStepSound(step, nextSoundId, { audition = false } = {}) {
  if (!Number.isInteger(step) || step < 0 || step >= sequenceLength) return;
  const previousOwnership = sequenceStepOwnership[step];
  const currentEvent = previousOwnership
    ? patternEventForStep(previousOwnership.anchorStep)
    : patternEventForStep(step);
  const validNextId = sequenceSoundNumberById.has(nextSoundId) ? nextSoundId : "";
  const nextVelocity = currentEvent?.velocity ?? 0.72;
  if (previousOwnership?.offset > 0) releaseOwnedContinuation(step);
  clearStepExcept(step, validNextId);
  if (validNextId) {
    pattern[validNextId][step] = nextVelocity;
    lastSequenceSoundId = validNextId;
    if (previousOwnership?.offset > 0) {
      sequenceStepMetadata[step] = { spanSteps: 1, mode: "hold" };
    }
  } else {
    sequenceStepMetadata[step] = { spanSteps: 1, mode: "hold" };
  }
  markPatternCustom();
  rebuildSequenceStepOwnership();
  if (validNextId) selectedSequenceStep = step;
  renderPattern();
  if (!validNextId) {
    announce(`Step ${step + 1} cleared`);
    return;
  }
  const sound = hiccupHeadSound(validNextId);
  if (audition) triggerSound(sound.id, nextVelocity);
  announce(`${sequenceSoundLabel(sound)} selected for step ${step + 1}`);
}

function handleSequenceGridChange(event) {
  const selector = event.target.closest?.(".hiccup-head-step-sound-select");
  if (!selector || !$("sequenceGrid").contains(selector)) return;
  setStepSound(Number(selector.dataset.step), selector.value);
}

function handleSequenceGridPickerOpen(event) {
  const selector = event.target.closest?.(".hiccup-head-step-sound-select");
  if (!selector || !$("sequenceGrid").contains(selector)) return;
  expandStepSoundSelector(selector);
}

function handleSequenceGridPickerClose(event) {
  const selector = event.target.closest?.(".hiccup-head-step-sound-select");
  if (!selector || !$("sequenceGrid").contains(selector)) return;
  compactStepSoundSelector(selector);
}

function updateSelectedStepContext() {
  const context = $("selectedStepContext");
  if (!context) return;
  if (selectedSequenceStep < 0) {
    context.hidden = true;
    $("sequenceGrid")?.classList.remove("has-step-context");
    return;
  }
  $("sequenceGrid")?.classList.add("has-step-context");
  selectedSequenceStep = sequenceAnchorForStep(selectedSequenceStep);
  const event = patternEventForStep(selectedSequenceStep);
  const metadata = normalizedSequenceStepMetadata(selectedSequenceStep);
  const maximumSpan = event ? maximumSequenceSpanForAnchor(selectedSequenceStep) : 1;
  const effectiveSpan = event
    ? Math.min(metadata.spanSteps, maximumSpan)
    : 1;
  const selectedSlot = gridCellsByStep[selectedSequenceStep]?.closest(".hiccup-head-step-slot");
  if (selectedSlot && context.parentElement !== selectedSlot) selectedSlot.append(context);
  context.hidden = false;
  const row = selectedSlot?.parentElement;
  if (row?.clientWidth) {
    const contextWidth = Math.min(344, Math.max(240, row.clientWidth - 8));
    const slotLeft = selectedSlot.offsetLeft;
    const desiredLeft = clamp(slotLeft, 4, Math.max(4, row.clientWidth - contextWidth - 4));
    context.style.width = `${contextWidth}px`;
    context.style.right = "auto";
    context.style.left = `${desiredLeft - slotLeft}px`;
  }
  context.setAttribute(
    "aria-label",
    `Controls for selected step ${selectedSequenceStep + 1}${event ? `, ${sequenceSoundLabel(event.sound)}` : ", empty"}`,
  );
  $("selectedStepVelocity").value = String(event?.velocity ?? 0);
  $("selectedStepVelocity").disabled = false;
  $("selectedStepVelocityOut").value = `${Math.round((event?.velocity ?? 0) * 100)}%`;
  $("selectedStepVelocityOut").textContent = $("selectedStepVelocityOut").value;
  updateRangeFill($("selectedStepVelocity"));
  $("selectedStepSpan").max = String(maximumSpan);
  $("selectedStepSpan").value = String(effectiveSpan);
  $("selectedStepSpan").disabled = !event;
  $("selectedStepSpanOut").value = String(effectiveSpan);
  $("selectedStepSpanOut").textContent = String(effectiveSpan);
  updateRangeFill($("selectedStepSpan"));
  $("selectedStepMode").value = metadata.mode;
  $("selectedStepMode").disabled = !event;
  $("selectedStepClear").disabled = !event;
  $("extendStepLeftButton").disabled = !event
    || selectedSequenceStep <= 0
    || effectiveSpan >= 8
    || Boolean(patternEventForStep(selectedSequenceStep - 1))
    || Boolean(sequenceStepOwnership[selectedSequenceStep - 1]);
  $("extendStepRightButton").disabled = !event || effectiveSpan >= maximumSpan;
}

function setSelectedStepVelocity(value, { announceState = false } = {}) {
  if (selectedSequenceStep < 0) return;
  setSequenceStepVelocity(selectedSequenceStep, value, { announceState });
}

function setSelectedStepSpan(value) {
  const event = patternEventForStep(selectedSequenceStep);
  if (!event) return;
  const metadata = normalizedSequenceStepMetadata(selectedSequenceStep);
  const spanSteps = clamp(
    Math.round(Number(value) || 1),
    1,
    maximumSequenceSpanForAnchor(selectedSequenceStep),
  );
  sequenceStepMetadata[selectedSequenceStep] = { ...metadata, spanSteps };
  markPatternCustom();
  renderPattern();
  announce(`Step ${selectedSequenceStep + 1} spans ${spanSteps} step${spanSteps === 1 ? "" : "s"}`);
}

function setSelectedStepMode(value) {
  const event = patternEventForStep(selectedSequenceStep);
  if (!event) return;
  const metadata = normalizedSequenceStepMetadata(selectedSequenceStep);
  const mode = value === "repeat" ? "repeat" : "hold";
  sequenceStepMetadata[selectedSequenceStep] = { ...metadata, mode };
  markPatternCustom();
  renderPattern();
  announce(`${sequenceSoundLabel(event.sound)} will ${mode === "repeat" ? "repeat on" : "hold across"} its span`);
}

function extendSelectedStepLeft() {
  const anchorStep = selectedSequenceStep;
  const event = patternEventForStep(anchorStep);
  const metadata = normalizedSequenceStepMetadata(anchorStep);
  const previousStep = anchorStep - 1;
  if (
    !event
    || previousStep < 0
    || metadata.spanSteps >= 8
    || patternEventForStep(previousStep)
    || sequenceStepOwnership[previousStep]
  ) return;
  clearStepExcept(previousStep, event.sound.id);
  pattern[event.sound.id][previousStep] = event.velocity;
  pattern[event.sound.id][anchorStep] = 0;
  sequenceStepMetadata[previousStep] = {
    spanSteps: metadata.spanSteps + 1,
    mode: metadata.mode,
  };
  sequenceStepMetadata[anchorStep] = { spanSteps: 1, mode: "hold" };
  selectedSequenceStep = previousStep;
  markPatternCustom();
  renderPattern();
  announce(`Extended ${sequenceSoundLabel(event.sound)} left to step ${previousStep + 1}`);
}

function extendSelectedStepRight() {
  const event = patternEventForStep(selectedSequenceStep);
  if (!event) return;
  const metadata = normalizedSequenceStepMetadata(selectedSequenceStep);
  setSelectedStepSpan(metadata.spanSteps + 1);
}

function clearSelectedStep() {
  setStepSound(selectedSequenceStep, "", { audition: false });
}

function previewSequenceStep(step) {
  // Every `.hiccup-head-step-audition` routes here and never edits pattern state.
  const anchorStep = sequenceAnchorForStep(step);
  const event = patternEventForStep(anchorStep);
  if (!event) return;
  triggerSound(event.sound.id, event.velocity);
}

function bindSequenceStepContextControls() {
  $("selectedStepVelocity").addEventListener("input", () => {
    setSelectedStepVelocity($("selectedStepVelocity").value);
  });
  $("selectedStepVelocity").addEventListener("change", () => {
    setSelectedStepVelocity($("selectedStepVelocity").value, { announceState: true });
  });
  $("selectedStepSpan").addEventListener("input", () => {
    setSelectedStepSpan($("selectedStepSpan").value);
  });
  $("selectedStepMode").addEventListener("change", () => {
    setSelectedStepMode($("selectedStepMode").value);
  });
  $("selectedStepClear").addEventListener("click", clearSelectedStep);
  $("extendStepLeftButton").addEventListener("click", extendSelectedStepLeft);
  $("extendStepRightButton").addEventListener("click", extendSelectedStepRight);
}

function sequenceColumnsForLength(length) {
  const safeLength = clamp(Math.round(Number(length) || 1), 1, HICCUP_HEAD_STEP_COUNT);
  return safeLength;
}

function buildSequenceGrid() {
  const grid = $("sequenceGrid");
  const stepContext = $("selectedStepContext");
  const fragment = document.createDocumentFragment();
  paintedGridStep = -1;
  rebuildSequenceStepOwnership();
  if (selectedSequenceStep >= 0) {
    selectedSequenceStep = sequenceAnchorForStep(selectedSequenceStep);
  }
  gridCellsByStep = Array(sequenceLength).fill(null);
  gridSelectorsByStep = Array(sequenceLength).fill(null);
  gridTabStop = null;
  const columns = sequenceColumnsForLength(sequenceLength);
  grid.style.setProperty("--hiccup-head-sequence-steps", String(sequenceLength));
  grid.style.setProperty("--hiccup-head-sequence-columns", String(columns));
  grid.style.setProperty("--hiccup-head-sequence-sounds", "1");
  grid.dataset.sequenceDensity = columns > 32 ? "micro" : columns > 16 ? "dense" : "roomy";
  grid.setAttribute("aria-rowcount", "1");
  grid.setAttribute("aria-colcount", String(sequenceLength));
  for (let bankStart = 0; bankStart < sequenceLength; bankStart += columns) {
    const row = document.createElement("div");
    row.className = "hiccup-head-grid-row hiccup-head-grid-single-lane";
    row.setAttribute("role", "presentation");
    row.style.setProperty("--hiccup-head-sequence-columns", String(columns));
    row.dataset.bank = String(Math.floor(bankStart / columns));
    const bankEnd = Math.min(sequenceLength, bankStart + columns);
    for (let step = bankStart; step < bankEnd; step += 1) {
      const slot = document.createElement("div");
      slot.className = "hiccup-head-step-slot";
      slot.dataset.step = String(step);
      slot.setAttribute("role", "gridcell");
      slot.setAttribute("aria-colindex", String(step + 1));
      slot.setAttribute("aria-rowindex", "1");
      const cell = document.createElement("button");
      cell.className = "hiccup-head-step-cell";
      cell.type = "button";
      cell.dataset.row = "0";
      cell.dataset.step = String(step);
      cell.tabIndex = step === 0 ? 0 : -1;
      cell.setAttribute("aria-describedby", "sequenceStepHelp");
      const volumeLane = document.createElement("span");
      volumeLane.className = "hiccup-head-step-volume-lane";
      volumeLane.setAttribute("aria-hidden", "true");
      const hitMark = document.createElement("span");
      hitMark.className = "hiccup-head-step-hit-mark";
      hitMark.setAttribute("aria-hidden", "true");
      hitMark.textContent = "×";
      volumeLane.append(hitMark);
      const soundNumber = document.createElement("span");
      soundNumber.className = "hiccup-head-step-sound-number";
      soundNumber.setAttribute("aria-hidden", "true");
      const velocityNumber = document.createElement("span");
      velocityNumber.className = "hiccup-head-step-velocity-number";
      velocityNumber.setAttribute("aria-hidden", "true");
      const preview = document.createElement("button");
      preview.className = "hiccup-head-step-audition";
      preview.type = "button";
      preview.dataset.step = String(step);
      preview.textContent = "▶";
      preview.addEventListener("click", (event) => {
        event.stopPropagation();
        previewSequenceStep(step);
      });
      cell.append(volumeLane, soundNumber, velocityNumber);
      const selector = document.createElement("select");
      selector.className = "hiccup-head-step-sound-select";
      selector.dataset.step = String(step);
      const ownership = sequenceStepOwnership[step];
      const event = ownership ? patternEventForStep(ownership.anchorStep) : null;
      selector.replaceChildren(...compactSoundOptions(event?.sound.id ?? ""));
      // Match keyboard focus order to the visible stack: hit, hear, then choose.
      // Preview stays a sibling because nesting a button inside the hit button
      // would be invalid interactive markup.
      slot.append(cell, preview, selector);
      gridCellsByStep[step] = cell;
      gridSelectorsByStep[step] = selector;
      if (step === 0) gridTabStop = cell;
      row.append(slot);
    }
    fragment.append(row);
  }
  grid.replaceChildren(fragment);
  if (stepContext && selectedSequenceStep >= 0) {
    gridCellsByStep[selectedSequenceStep]
      ?.closest(".hiccup-head-step-slot")
      ?.append(stepContext);
  }
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
  if (selectedSequenceStep >= 0) {
    selectedSequenceStep = clamp(selectedSequenceStep, 0, sequenceLength - 1);
  }
  visualQueue = visualQueue.map((event) => event.type === "step"
    ? { ...event, step: event.step % sequenceLength }
    : event);
  rebuildSequenceStepOwnership();
  // Prime nearly half a second of worklet events before rebuilding the lane.
  // Slow phones can then update its visible steps without starving audio.
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
    `One-lane Hiccup Head sequencer with ${sequenceLength} steps. Each step has one velocity trigger and one sound selector.`,
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
    const number = document.createElement("span");
    const label = document.createElement("b");
    const subtitle = document.createElement("small");
    const key = document.createElement("kbd");
    button.className = "hiccup-head-pad";
    button.type = "button";
    button.dataset.soundId = sound.id;
    button.dataset.padIndex = String(index);
    button.style.setProperty("--pad-color", sound.color);
    button.setAttribute("aria-label", `${sequenceSoundNumberById.get(sound.id)}, ${sound.label}: ${sound.subtitle}. Keyboard ${sound.key}.`);
    number.className = "hiccup-head-pad-number";
    number.textContent = sequenceSoundNumberById.get(sound.id);
    label.textContent = sound.label;
    subtitle.textContent = sound.subtitle;
    key.textContent = sound.key.toUpperCase();
    button.append(number, label, subtitle, key);
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

const VOICE_BASE_PARAMETER_SPECS = Object.freeze([
  Object.freeze({
    key: "pitchOffsetSemitones",
    label: "Pitch offset",
    step: 0.1,
    format: (value) => `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)} st`,
  }),
  Object.freeze({
    key: "vibratoRateHz",
    label: "Base vibrato rate",
    step: 0.05,
    format: (value) => `${Number(value).toFixed(2)} Hz`,
  }),
  Object.freeze({
    key: "vibratoDepthSemitones",
    label: "Base vibrato depth",
    step: 0.01,
    format: (value) => `${Number(value).toFixed(2)} st`,
  }),
  Object.freeze({
    key: "breathiness",
    label: "Breathiness",
    step: 0.01,
    format: formatPercent,
  }),
  Object.freeze({
    key: "roughness",
    label: "Roughness",
    step: 0.01,
    format: formatPercent,
  }),
  Object.freeze({
    key: "subharmonicMix",
    label: "Subharmonics",
    step: 0.01,
    format: formatPercent,
  }),
  Object.freeze({
    key: "tractScale",
    label: "Tract scale",
    step: 0.001,
    format: (value) => `${Number(value).toFixed(3)}×`,
  }),
]);

function voiceParameterSummary(voice) {
  const pitch = Math.round(voice.pitchOffsetSemitones);
  return `${pitch >= 0 ? "+" : ""}${pitch} st · base vib ${voice.vibratoRateHz.toFixed(1)} Hz/${voice.vibratoDepthSemitones.toFixed(2)} st · ${Math.round(voice.roughness * 100)}% rough`;
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

function setVoiceSlotParameters(slot, updates) {
  slot.voice = sanitizeHiccupHeadVoice({
    ...slot.voice,
    ...updates,
    modulation: slot.voice.modulation,
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
      slot.voice = mutateHiccupHeadVoice(slot.voice, Math.random, 0.64);
      voiceCursor = 0;
      buildVoiceRack();
      announce(`Voice ${index + 1} mutated`);
      void auditionCurrentSoundBank(index);
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

    const baseDetails = document.createElement("details");
    baseDetails.className = "hiccup-head-voice-base";
    const baseSummary = document.createElement("summary");
    const baseSummaryTitle = document.createElement("b");
    const baseSummaryHint = document.createElement("span");
    baseSummaryTitle.textContent = "Base voice";
    baseSummaryHint.textContent = "starting pitch · timbre · vibrato";
    baseSummary.append(baseSummaryTitle, baseSummaryHint);
    const baseGrid = document.createElement("div");
    baseGrid.className = "hiccup-head-voice-base-grid";
    for (const spec of VOICE_BASE_PARAMETER_SPECS) {
      const [minimum, maximum] = HICCUP_HEAD_VOICE_LIMITS[spec.key];
      const parameterLabel = document.createElement("label");
      parameterLabel.className = "hiccup-head-voice-base-control";
      const parameterText = document.createElement("span");
      parameterText.textContent = spec.label;
      const parameterInput = document.createElement("input");
      const parameterId = `voice-${index + 1}-${spec.key}`;
      parameterInput.id = parameterId;
      parameterInput.type = "range";
      parameterInput.min = String(minimum);
      parameterInput.max = String(maximum);
      parameterInput.step = String(spec.step);
      parameterInput.value = String(slot.voice[spec.key]);
      parameterInput.setAttribute("aria-label", `Voice ${index + 1} ${spec.label.toLowerCase()}`);
      const parameterOutput = document.createElement("output");
      parameterOutput.setAttribute("for", parameterId);
      parameterOutput.value = spec.format(slot.voice[spec.key]);
      parameterOutput.textContent = parameterOutput.value;
      parameterInput.addEventListener("input", () => {
        setVoiceSlotParameters(slot, { [spec.key]: Number(parameterInput.value) });
        parameterOutput.value = spec.format(slot.voice[spec.key]);
        parameterOutput.textContent = parameterOutput.value;
        summary.textContent = voiceParameterSummary(slot.voice);
      });
      parameterInput.addEventListener("change", () => announce(
        `Voice ${index + 1} ${spec.label.toLowerCase()}: ${spec.format(slot.voice[spec.key])}`,
      ));
      parameterLabel.append(parameterText, parameterInput, parameterOutput);
      baseGrid.append(parameterLabel);
    }
    baseDetails.append(baseSummary, baseGrid);

    const modBlock = document.createElement("div");
    modBlock.className = "hiccup-head-voice-modulation";
    const modTitle = document.createElement("b");
    modTitle.className = "hiccup-head-voice-mod-title";
    modTitle.textContent = "Assignable LFO";
    const modMatrix = document.createElement("div");
    modMatrix.className = "hiccup-head-voice-mod-matrix";
    const sourceSelect = document.createElement("select");
    sourceSelect.className = "hiccup-head-voice-mod-source";
    sourceSelect.setAttribute("aria-label", `Voice ${index + 1} assignable LFO source`);
    sourceSelect.replaceChildren(...HICCUP_HEAD_VOICE_MODULATION_SOURCES.map((source) => (
      makeVoiceOption(source, voiceModulationLabel(source), modulation.source)
    )));
    sourceSelect.addEventListener("change", () => {
      setVoiceSlotModulation(slot, { source: sourceSelect.value });
      announce(`Voice ${index + 1} modulator: ${voiceModulationLabel(sourceSelect.value)}`);
    });
    const targetSelect = document.createElement("select");
    targetSelect.className = "hiccup-head-voice-mod-target";
    targetSelect.setAttribute("aria-label", `Voice ${index + 1} assignable LFO target`);
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
    depthText.textContent = "LFO depth";
    const depthInput = document.createElement("input");
    depthInput.className = "hiccup-head-voice-mod-depth";
    depthInput.type = "range";
    depthInput.min = "0";
    depthInput.max = "1";
    depthInput.step = "0.01";
    depthInput.value = String(modulation.depth);
    depthInput.setAttribute("aria-label", `Voice ${index + 1} assignable LFO depth`);
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
      `Voice ${index + 1} assignable LFO depth: ${formatPercent(slot.voice.modulation.depth)}`,
    ));
    depthLabel.append(depthText, depthInput, depthOutput);

    const rateLabel = document.createElement("label");
    rateLabel.className = "hiccup-head-voice-mod-rate-wrap";
    const rateText = document.createElement("span");
    rateText.textContent = "LFO rate";
    const rateInput = document.createElement("input");
    rateInput.className = "hiccup-head-voice-mod-rate";
    rateInput.type = "range";
    rateInput.min = "0.05";
    rateInput.max = "20";
    rateInput.step = "0.05";
    rateInput.value = String(modulation.rateHz);
    rateInput.setAttribute("aria-label", `Voice ${index + 1} assignable LFO rate`);
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
      `Voice ${index + 1} assignable LFO rate: ${slot.voice.modulation.rateHz.toFixed(1)} hertz`,
    ));
    rateLabel.append(rateText, rateInput, rateOutput);
    modBlock.append(modTitle, modMatrix, depthLabel, rateLabel);
    card.append(header, controls, assignmentLabel, baseDetails, modBlock);
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
  nextBrushDirection = 1;
  displayedPose = { ...state };
  activeMouthSoundId = "";
  activeVoiceSlot = -1;
  voiceCount = 4;
  voiceSelectionMode = "round-robin";
  voiceCursor = 0;
  voiceSlots = createDefaultVoiceSlots();
  currentSoundBankId = HICCUP_HEAD_SOUND_BANKS[0].id;
  retuneVoiceSlotsForBank(currentSoundBankId);
  if ($("voiceCount")) $("voiceCount").value = String(voiceCount);
  if ($("voiceCountOut")) {
    $("voiceCountOut").value = String(voiceCount);
    $("voiceCountOut").textContent = String(voiceCount);
  }
  if ($("voiceSelectionMode")) $("voiceSelectionMode").value = "roundRobin";
  if ($("soundBankSelect")) $("soundBankSelect").value = currentSoundBankId;
  if ($("soundBankDescription")) {
    $("soundBankDescription").textContent = hiccupHeadSoundBank(currentSoundBankId).description;
  }
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
  $("visualSkinSelect")?.replaceChildren(...HICCUP_HEAD_VISUAL_SKINS.map((skin) => {
    const option = document.createElement("option");
    option.value = skin.id;
    option.textContent = skin.label;
    return option;
  }));
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
  $("soundBankSelect")?.replaceChildren(...HICCUP_HEAD_SOUND_BANKS.map((bank) => {
    const option = document.createElement("option");
    option.value = bank.id;
    option.textContent = bank.label;
    return option;
  }));
  if ($("soundBankSelect")) $("soundBankSelect").value = currentSoundBankId;
  if ($("soundBankDescription")) {
    $("soundBankDescription").textContent = hiccupHeadSoundBank(currentSoundBankId).description;
  }
  if ($("visualSkinSelect")) $("visualSkinSelect").value = visualSkinId;
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
    if (animation.soundId === "huff") envelope *= 0.76 + Math.sin(phase * Math.PI) * 0.18;
    if (animation.soundId === "waow") envelope *= 0.72 + phase * 0.24;
    if (animation.soundId === "whoop") envelope *= 0.76 + Math.sin(phase * Math.PI) * 0.22;
    if (animation.soundId === "doodoo") envelope *= phase < 0.47 ? 0.94 : 0.78;
    if (animation.soundId === "llll") envelope *= 0.82 + Math.sin(phase * 18) * 0.08;
    if (animation.soundId === "purr") envelope *= 0.62 + Math.sin(phase * 36) * 0.28;
    if (animation.soundId === "klikklak") envelope *= 0.5
      + (Math.sin(phase * Math.PI * 8 - 0.7) > 0.35 ? 0.48 : -0.2);
    if (animation.soundId === "rrrr") envelope *= 0.64 + Math.sin(phase * 76) * 0.3;
    if (animation.soundId === "lrroll") envelope *= 0.7
      + Math.sin(phase * Math.PI * 8) * 0.2;
    if (animation.soundId === "lalatrip") envelope *= 0.68
      + (Math.sin(phase * Math.PI * 6 - 0.5) > -0.15 ? 0.24 : -0.08);
    if (animation.soundId === "hiccuplong") envelope *= 0.66
      + Math.sin(phase * Math.PI * 4 - 0.8) * 0.26;
    if (animation.soundId === "zzzz") envelope *= 0.78
      + Math.sin(phase * 92) * 0.08;
    if (animation.soundId === "ehyeah") envelope *= 0.74
      + Math.sin(phase * 34) * 0.16 + phase * 0.08;
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
      visualBeatOrdinal = Number.isInteger(event.ordinal)
        ? event.ordinal
        : visualBeatOrdinal + 1;
      // Preserve the scheduler's due time. If the canvas misses a frame, the
      // visual pulse resumes at the correct age instead of restarting late.
      visualBeatStartedAt = event.due;
      updateGridPlayhead();
      continue;
    }
    const sound = hiccupHeadSound(event.soundId);
    visualHitStartedAt = event.due;
    visualHitVelocity = event.velocity;
    visualHitSoundId = sound.id;
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
      huff: 620,
      waow: 980,
      whoop: 1120,
      doodoo: 860,
      llll: 980,
      purr: 1180,
      klikklak: 520,
      rrrr: 920,
      lrroll: 900,
      lalatrip: 880,
      hiccuplong: 1180,
      zzzz: 940,
      ehyeah: 1180,
    };
    const visualTempoScale = TEMPO_STRETCH_SOUND_IDS.has(sound.id)
      ? clamp(Math.sqrt(118 / state.tempo), 0.68, 1.8)
      : 1;
    const scheduledGestureSeconds = Number(event.eventDetails?.gestureDurationSeconds);
    const scheduledGestureMilliseconds = Number.isFinite(scheduledGestureSeconds)
      ? scheduledGestureSeconds * 1000
      : null;
    soundAnimation = {
      soundId: sound.id,
      velocity: event.velocity,
      configuration: event.configuration,
      voiceChoice: event.voiceChoice,
      eventDetails: event.eventDetails,
      start: event.due,
      duration: prefersReducedMotion
        ? 90
        : scheduledGestureMilliseconds
          ?? (durations[sound.id] ?? 320) * visualTempoScale,
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
      born: event.due,
      duration: scheduledGestureMilliseconds ?? 520,
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

const SKIN_ATLAS_COLUMNS = 4;
const SKIN_ATLAS_ROWS = 4;
const SKIN_ATLAS_PART = Object.freeze({
  head: 0,
  leftEye: 1,
  rightEye: 2,
  brow: 3,
  nose: 4,
  lips: 5,
  tongue: 6,
  tooth: 7,
  leftEar: 8,
  rightEar: 9,
  hair: 10,
  hand: 11,
  kiss: 12,
  brush: 13,
  tether: 14,
  swatch: 15,
});

// The generated component sheets contain a few disconnected border scraps in
// otherwise transparent padding. Crop only those contaminated margins while
// preserving the component's original destination scale and anchor.
const SKIN_ATLAS_SOURCE_INSETS = Object.freeze({
  "cutout-collage": Object.freeze({
    [SKIN_ATLAS_PART.nose]: Object.freeze({ top: 0.17 }),
    [SKIN_ATLAS_PART.hair]: Object.freeze({ top: 0.08 }),
  }),
  "food-portrait": Object.freeze({
    [SKIN_ATLAS_PART.nose]: Object.freeze({ top: 0.13 }),
    [SKIN_ATLAS_PART.hair]: Object.freeze({ bottom: 0.025 }),
  }),
});

// Generated parts are normally centered in their 256px atlas cells. The 1904
// head's visible oval sits 7px right and 4.5px down, so use its measured visual
// center as the draw anchor instead of centering transparent cell padding.
const SKIN_ATLAS_PART_ANCHORS = Object.freeze({
  "photo-1904": Object.freeze({
    [SKIN_ATLAS_PART.head]: Object.freeze({ x: 135 / 256, y: 132.5 / 256 }),
  }),
});

function drawSkinAtlasPart(
  context,
  image,
  part,
  x,
  y,
  width,
  height,
  { rotation = 0, mirrorX = false, alpha = 1 } = {},
) {
  const imageWidth = Number(image?.naturalWidth || image?.videoWidth || image?.width);
  const imageHeight = Number(image?.naturalHeight || image?.videoHeight || image?.height);
  if (!imageWidth || !imageHeight || width <= 0 || height <= 0) return false;
  const sourceWidth = imageWidth / SKIN_ATLAS_COLUMNS;
  const sourceHeight = imageHeight / SKIN_ATLAS_ROWS;
  const column = part % SKIN_ATLAS_COLUMNS;
  const row = Math.floor(part / SKIN_ATLAS_COLUMNS);
  const sourceInsets = SKIN_ATLAS_SOURCE_INSETS[visualSkinId]?.[part] ?? {};
  const partAnchor = SKIN_ATLAS_PART_ANCHORS[visualSkinId]?.[part] ?? { x: 0.5, y: 0.5 };
  const insetLeft = clamp(Number(sourceInsets.left) || 0, 0, 0.45);
  const insetTop = clamp(Number(sourceInsets.top) || 0, 0, 0.45);
  const insetRight = clamp(Number(sourceInsets.right) || 0, 0, 0.45);
  const insetBottom = clamp(Number(sourceInsets.bottom) || 0, 0, 0.45);
  const visibleWidth = Math.max(0.1, 1 - insetLeft - insetRight);
  const visibleHeight = Math.max(0.1, 1 - insetTop - insetBottom);
  context.save();
  context.translate(
    x - (partAnchor.x - 0.5) * width,
    y - (partAnchor.y - 0.5) * height,
  );
  context.rotate(rotation);
  context.scale(mirrorX ? -1 : 1, 1);
  context.globalAlpha *= alpha;
  context.drawImage(
    image,
    (column + insetLeft) * sourceWidth,
    (row + insetTop) * sourceHeight,
    sourceWidth * visibleWidth,
    sourceHeight * visibleHeight,
    -width * 0.5 + width * insetLeft,
    -height * 0.5 + height * insetTop,
    width * visibleWidth,
    height * visibleHeight,
  );
  context.restore();
  return true;
}

const MAGAZINE_FACE_FIELD_COLUMNS = 3;
const MAGAZINE_FACE_FIELD_ROWS = 2;
const MAGAZINE_FACE_FIELD_COUNT = 6;
const MAGAZINE_FACE_FIELD_ORDER = Object.freeze([0, 3, 1, 5, 2, 4]);
const WILD_INK_DECAY_FIELD_COLUMNS = 4;
const WILD_INK_DECAY_FIELD_ROWS = 1;
const WILD_INK_DECAY_FIELD_COUNT = 4;

function drawCutoutCollageBeatField(context, image, layout, beat) {
  if (!image?.naturalWidth) return false;
  const ordinal = Number.isInteger(beat?.ordinal) ? beat.ordinal : 0;
  const orderedIndex = MAGAZINE_FACE_FIELD_ORDER[
    ((ordinal % MAGAZINE_FACE_FIELD_COUNT) + MAGAZINE_FACE_FIELD_COUNT)
      % MAGAZINE_FACE_FIELD_COUNT
  ];
  const sourceWidth = image.naturalWidth / MAGAZINE_FACE_FIELD_COLUMNS;
  const sourceHeight = image.naturalHeight / MAGAZINE_FACE_FIELD_ROWS;
  const sourceX = (orderedIndex % MAGAZINE_FACE_FIELD_COLUMNS) * sourceWidth;
  const sourceY = Math.floor(orderedIndex / MAGAZINE_FACE_FIELD_COLUMNS) * sourceHeight;
  const { cx, cy, rx, ry } = layout;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    cx - rx * 1.12,
    cy - ry * 1.12,
    rx * 2.24,
    ry * 2.24,
  );
  return true;
}

function drawWildInkDecayPhotoField(context, image, layout, beat) {
  if (!image?.naturalWidth) return false;
  const step = Number.isInteger(beat?.step) ? beat.step : 0;
  const fieldIndex = ((step % WILD_INK_DECAY_FIELD_COUNT) + WILD_INK_DECAY_FIELD_COUNT)
    % WILD_INK_DECAY_FIELD_COUNT;
  const sourceWidth = image.naturalWidth / WILD_INK_DECAY_FIELD_COLUMNS;
  const sourceHeight = image.naturalHeight / WILD_INK_DECAY_FIELD_ROWS;
  const sourceX = (fieldIndex % WILD_INK_DECAY_FIELD_COLUMNS) * sourceWidth;
  const sourceY = Math.floor(fieldIndex / WILD_INK_DECAY_FIELD_COLUMNS) * sourceHeight;
  const { cx, cy, rx, ry } = layout;
  context.save();
  context.globalAlpha = 0.82;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    cx - rx * 1.12,
    cy - ry * 1.12,
    rx * 2.24,
    ry * 2.24,
  );
  context.restore();
  return true;
}

function visualSkinPalette() {
  switch (visualSkinId) {
    case "wild-ink":
      return {
        outline: "rgba(28, 8, 15, 0.98)", head: "rgb(115, 31, 45)",
        eye: "rgb(30, 23, 25)", irisA: "rgb(224, 230, 82)", irisB: "rgb(151, 35, 47)",
        leftLid: "rgb(130, 35, 57)", rightLid: "rgb(103, 119, 48)",
        browA: "rgb(39, 13, 22)", browB: "rgb(24, 21, 20)", nose: "rgb(133, 22, 35)",
        lip: "rgb(44, 8, 26)", tongue: "rgb(176, 50, 77)",
        hairA: "rgb(25, 13, 17)", hairB: "rgb(116, 39, 51)",
        earA: "rgb(120, 54, 71)", earB: "rgb(103, 112, 54)",
      };
    case "ascii":
      return {
        outline: "rgba(89, 255, 155, 0.96)", head: "rgb(2, 18, 10)",
        eye: "rgb(1, 11, 6)", irisA: "rgb(129, 255, 177)", irisB: "rgb(34, 203, 105)",
        leftLid: "rgb(100, 25, 73)", rightLid: "rgb(13, 78, 88)",
        browA: "rgb(102, 255, 164)", browB: "rgb(65, 211, 127)", nose: "rgb(32, 214, 104)",
        lip: "rgb(83, 255, 148)", tongue: "rgb(57, 196, 105)",
        hairA: "rgb(23, 129, 67)", hairB: "rgb(95, 255, 158)",
        earA: "rgb(7, 41, 22)", earB: "rgb(10, 57, 31)",
      };
    case "webcam-cutup":
      return {
        outline: "rgba(246, 239, 220, 0.94)", head: "rgb(28, 19, 34)",
        eye: "rgb(10, 8, 12)", irisA: "rgb(255, 185, 69)", irisB: "rgb(64, 224, 184)",
        leftLid: "rgb(244, 92, 145)", rightLid: "rgb(78, 208, 220)",
        browA: "rgb(255, 204, 65)", browB: "rgb(100, 226, 154)", nose: "#ff314f",
        lip: "rgb(32, 175, 95)", tongue: "rgb(236, 91, 135)",
        hairA: "rgb(248, 178, 61)", hairB: "rgb(216, 91, 193)",
        earA: "rgb(79, 168, 221)", earB: "rgb(162, 95, 215)",
      };
    case "photo-1904":
      return {
        outline: "rgba(220, 210, 187, 0.78)", head: "rgb(153, 145, 128)",
        eye: "rgb(211, 205, 190)", irisA: "rgb(93, 86, 72)", irisB: "rgb(61, 58, 51)",
        leftLid: "rgb(128, 120, 105)", rightLid: "rgb(112, 106, 94)",
        browA: "rgb(57, 52, 44)", browB: "rgb(47, 43, 37)", nose: "rgb(144, 134, 117)",
        lip: "rgb(79, 69, 62)", tongue: "rgb(126, 112, 99)",
        hairA: "rgb(48, 43, 37)", hairB: "rgb(104, 94, 79)",
        earA: "rgb(146, 137, 119)", earB: "rgb(129, 121, 106)",
      };
    case "food-portrait":
      return {
        outline: "rgba(74, 44, 24, 0.96)", head: "rgb(202, 183, 111)",
        eye: "rgb(235, 219, 174)", irisA: "rgb(114, 82, 38)", irisB: "rgb(74, 105, 42)",
        leftLid: "rgb(119, 150, 59)", rightLid: "rgb(151, 82, 67)",
        browA: "rgb(65, 106, 37)", browB: "rgb(86, 123, 44)", nose: "rgb(207, 58, 35)",
        lip: "rgb(91, 142, 35)", tongue: "rgb(216, 105, 104)",
        hairA: "rgb(168, 111, 36)", hairB: "rgb(220, 164, 65)",
        earA: "rgb(181, 151, 109)", earB: "rgb(153, 124, 89)",
      };
    case "cutout-collage":
      return {
        outline: "rgba(245, 238, 220, 0.9)", head: "rgb(198, 170, 133)",
        eye: "rgb(225, 217, 191)", irisA: "rgb(67, 133, 168)", irisB: "rgb(42, 104, 145)",
        leftLid: "rgb(205, 72, 99)", rightLid: "rgb(89, 133, 69)",
        browA: "rgb(53, 34, 26)", browB: "rgb(38, 28, 23)", nose: "rgb(205, 48, 38)",
        lip: "rgb(48, 105, 57)", tongue: "rgb(199, 95, 106)",
        hairA: "rgb(45, 31, 25)", hairB: "rgb(98, 66, 46)",
        earA: "rgb(190, 143, 106)", earB: "rgb(164, 119, 88)",
      };
    default:
      return {
        outline: "rgba(151, 92, 220, 0.98)", head: "rgb(250, 246, 232)",
        eye: "rgba(250, 243, 224, 0.91)", irisA: "rgba(187, 140, 255, 0.96)",
        irisB: "rgba(101, 223, 232, 0.92)", leftLid: "rgb(244, 126, 173)",
        rightLid: "rgb(157, 218, 125)", browA: "rgba(255, 79, 126, 0.96)",
        browB: "rgba(45, 203, 218, 0.96)", nose: "#FF0000", lip: "rgba(34, 139, 79, 0.98)",
        tongue: null, hairA: "rgba(240, 127, 208, 0.96)",
        hairB: "rgba(187, 140, 255, 0.96)", earA: "rgba(183, 116, 237, 0.96)",
        earB: "rgba(120, 78, 194, 0.96)",
      };
  }
}

const ASCII_GLYPH_STYLES = Object.freeze({
  head: Object.freeze({ glyphs: ".:-=+*#%@", density: 0.92, colors: ["#0c4527", "#218a50", "#63e99b", "#d0ffe0"] }),
  "ear-left": Object.freeze({ glyphs: "()oO@", density: 0.72, colors: ["#38205d", "#7648a8", "#c38cff"] }),
  "ear-right": Object.freeze({ glyphs: "()oO@", density: 0.72, colors: ["#0a4552", "#168aa1", "#66e9f3"] }),
  "eye-white": Object.freeze({ glyphs: ".:oO@", density: 0.84, colors: ["#37634a", "#91d5a9", "#effff3"] }),
  "iris-left": Object.freeze({ glyphs: ".o0O@", density: 0.88, colors: ["#664019", "#df9840", "#ffe47b"] }),
  "iris-right": Object.freeze({ glyphs: ".o0O@", density: 0.88, colors: ["#183b68", "#2f8bd4", "#78eaff"] }),
  pupil: Object.freeze({ glyphs: "0O@", density: 1, colors: ["#42b978", "#92ffba", "#effff5"] }),
  "lid-left": Object.freeze({ glyphs: "._-=#", density: 0.8, colors: ["#641f49", "#c04787", "#ff8fc7"] }),
  "lid-right": Object.freeze({ glyphs: "._-=#", density: 0.8, colors: ["#154c55", "#2894a3", "#7eeef1"] }),
  "brow-left": Object.freeze({ glyphs: "=+*#@", density: 0.92, colors: ["#711943", "#db427f", "#ff9fc6"] }),
  "brow-right": Object.freeze({ glyphs: "=+*#@", density: 0.92, colors: ["#0b5865", "#18b2c5", "#8ef5ff"] }),
  nose: Object.freeze({ glyphs: ".o0O@", density: 0.94, colors: ["#6f1c1f", "#e54843", "#ff9b68"] }),
  lips: Object.freeze({ glyphs: "()<>O", density: 0.88, colors: ["#174b31", "#37b46e", "#a3ffc4"] }),
  tooth: Object.freeze({ glyphs: "I1|!#", density: 0.96, colors: ["#7b7045", "#d4c984", "#fff9d1"] }),
  "tooth-hit": Object.freeze({ glyphs: "I1|!@", density: 1, colors: ["#7c5e13", "#f0c934", "#fff19a"] }),
  tongue: Object.freeze({ glyphs: "~LRr@", density: 0.84, colors: ["#67234d", "#d25391", "#ff9ccb"] }),
  "hair-left": Object.freeze({ glyphs: "/~^<", density: 0.86, colors: ["#51206f", "#ad5ddd", "#e6a0ff"] }),
  "hair-right": Object.freeze({ glyphs: "~^>/", density: 0.86, colors: ["#0c5668", "#2cb9ca", "#8cf7ff"] }),
  "tether-left": Object.freeze({ glyphs: "~=-+", density: 0.82, colors: ["#613378", "#c675dd", "#f2bdff"] }),
  "tether-right": Object.freeze({ glyphs: "~=-+", density: 0.82, colors: ["#14596b", "#41bdce", "#a2f8ff"] }),
  hand: Object.freeze({ glyphs: "[]{}#@", density: 0.9, colors: ["#183b72", "#367fd2", "#9bd8ff"] }),
  kiss: Object.freeze({ glyphs: "<3xX@", density: 0.88, colors: ["#771d55", "#df4f91", "#ffabd0"] }),
  brush: Object.freeze({ glyphs: "[=|]>", density: 0.9, colors: ["#1c4f85", "#49a9e8", "#bcecff"] }),
});

function asciiSeedForRole(role) {
  let seed = 2166136261;
  for (const character of role) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function getAsciiGlyphPattern(context, role) {
  const compact = usesCompactCanvas();
  const cacheKey = `${role}:${compact ? "compact" : "full"}`;
  if (asciiGlyphPatterns.has(cacheKey)) return asciiGlyphPatterns.get(cacheKey);
  const style = ASCII_GLYPH_STYLES[role] ?? ASCII_GLYPH_STYLES.head;
  const fontSize = compact ? 7 : 8.5;
  const cellWidth = compact ? 6 : 7;
  const cellHeight = compact ? 8 : 10;
  const columns = 12;
  const rows = 8;
  const tile = document.createElement("canvas");
  tile.width = columns * cellWidth;
  tile.height = rows * cellHeight;
  const tileContext = tile.getContext("2d");
  tileContext.clearRect(0, 0, tile.width, tile.height);
  tileContext.font = `800 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  tileContext.textAlign = "center";
  tileContext.textBaseline = "middle";
  const seed = asciiSeedForRole(role);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let hash = seed ^ Math.imul(column + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca77);
      hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
      hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
      const unit = ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
      if (unit > style.density) continue;
      const verticalShade = rows <= 1 ? 0 : row / (rows - 1);
      const shade = clamp(unit * 0.64 + verticalShade * 0.36);
      const glyphIndex = Math.min(style.glyphs.length - 1, Math.floor(shade * style.glyphs.length));
      const colorIndex = Math.min(style.colors.length - 1, Math.floor(shade * style.colors.length));
      tileContext.globalAlpha = 0.58 + shade * 0.42;
      tileContext.fillStyle = style.colors[colorIndex];
      tileContext.fillText(
        style.glyphs[glyphIndex],
        column * cellWidth + cellWidth * 0.5,
        row * cellHeight + cellHeight * 0.5,
      );
    }
  }
  tileContext.globalAlpha = 1;
  const pattern = context.createPattern(tile, "repeat") ?? style.colors.at(-1);
  asciiGlyphPatterns.set(cacheKey, pattern);
  return pattern;
}

function asciiPaint(context, role, fallback) {
  return visualSkinId === "ascii" ? getAsciiGlyphPattern(context, role) : fallback;
}

function drawAsciiEyeShutters(context, {
  eyeRx,
  eyeRy,
  closure,
  side,
}) {
  const leftEye = side < 0;
  const lidRole = leftEye ? "lid-left" : "lid-right";
  const lidBase = leftEye ? "rgb(100, 25, 73)" : "rgb(13, 78, 88)";
  const lidEdge = leftEye ? "rgb(255, 112, 200)" : "rgb(91, 239, 255)";
  // Even a fully open terminal eye retains a visible hardware shutter. As
  // either closure control moves, its own upper and lower slabs meet without
  // borrowing the other eye's color or state.
  const depth = eyeRy * (0.2 + clamp(closure) * 0.34);

  context.save();
  context.beginPath();
  context.ellipse(0, 0, eyeRx, eyeRy, 0, 0, Math.PI * 2);
  context.clip();
  context.lineCap = "square";
  context.lineJoin = "miter";

  for (const verticalSide of [-1, 1]) {
    const outerY = verticalSide * eyeRy;
    const edgeY = verticalSide * (eyeRy - depth);
    const edgeBite = verticalSide * depth * 0.1;
    context.beginPath();
    context.moveTo(-eyeRx, outerY);
    context.lineTo(eyeRx, outerY);
    context.lineTo(eyeRx, edgeY + edgeBite);
    context.lineTo(eyeRx * 0.58, edgeY);
    context.lineTo(eyeRx * 0.18, edgeY - edgeBite);
    context.lineTo(-eyeRx * 0.24, edgeY - edgeBite * 0.45);
    context.lineTo(-eyeRx * 0.66, edgeY + edgeBite * 0.25);
    context.lineTo(-eyeRx, edgeY + edgeBite);
    context.closePath();
    context.fillStyle = lidBase;
    context.fill();
    context.globalAlpha = 0.94;
    context.fillStyle = asciiPaint(context, lidRole, lidBase);
    context.fill();
    context.globalAlpha = 1;

    // Parallel terminal rails make the lid unmistakable at its open stop.
    context.strokeStyle = lidEdge;
    context.lineWidth = 1.35;
    context.beginPath();
    context.moveTo(-eyeRx, edgeY + edgeBite);
    context.lineTo(-eyeRx * 0.66, edgeY + edgeBite * 0.25);
    context.lineTo(-eyeRx * 0.24, edgeY - edgeBite * 0.45);
    context.lineTo(eyeRx * 0.18, edgeY - edgeBite);
    context.lineTo(eyeRx * 0.58, edgeY);
    context.lineTo(eyeRx, edgeY + edgeBite);
    context.stroke();
    for (let rail = 1; rail <= 2; rail += 1) {
      const railY = outerY - verticalSide * depth * (rail / 3);
      context.globalAlpha = 0.52;
      context.beginPath();
      context.moveTo(-eyeRx, railY);
      context.lineTo(eyeRx, railY);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  context.restore();
}

function getLowFiPhotoGrainPattern(context) {
  if (lowFiPhotoGrainPattern) return lowFiPhotoGrainPattern;
  const tile = document.createElement("canvas");
  tile.width = 72;
  tile.height = 72;
  const tileContext = tile.getContext("2d");
  tileContext.clearRect(0, 0, tile.width, tile.height);

  // Ordered halftone dots and deterministic dust make a cheap photocopy/old
  // emulsion texture. The tile is built once, then reused by both low-fi skins.
  for (let row = 0; row < 9; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const shade = ((row * 7 + column * 11) % 5) / 4;
      tileContext.fillStyle = `rgba(43, 34, 27, ${0.08 + shade * 0.13})`;
      tileContext.beginPath();
      tileContext.arc(column * 8 + 4, row * 8 + 4, 0.65 + shade * 0.75, 0, Math.PI * 2);
      tileContext.fill();
    }
  }
  for (let dust = 0; dust < 34; dust += 1) {
    const x = (dust * 29 + 13) % tile.width;
    const y = (dust * 47 + 7) % tile.height;
    tileContext.fillStyle = dust % 4 === 0
      ? "rgba(247, 235, 202, 0.14)"
      : "rgba(31, 25, 21, 0.13)";
    tileContext.fillRect(x, y, dust % 3 === 0 ? 1.4 : 0.7, dust % 5 === 0 ? 4 : 1.1);
  }
  lowFiPhotoGrainPattern = context.createPattern(tile, "repeat") ?? "rgba(42, 34, 28, 0.16)";
  return lowFiPhotoGrainPattern;
}

function drawWildInkMarks(context, layout, now) {
  const { cx, cy, rx, ry } = layout;
  context.save();
  context.beginPath();
  appendWildInkSkullSilhouette(context, layout);
  context.clip();
  context.strokeStyle = "rgba(51, 39, 31, 0.2)";
  context.lineWidth = 1.15;
  for (let mark = 0; mark < 12; mark += 1) {
    const angle = mark * 2.399 + 0.4;
    const radius = 0.35 + ((mark * 37) % 53) / 100;
    const x = cx + Math.cos(angle) * rx * radius;
    const y = cy + Math.sin(angle) * ry * radius;
    const twitch = prefersReducedMotion ? 0 : Math.sin(now * 0.004 + mark) * 1.2;
    context.beginPath();
    context.moveTo(x - 4 + twitch, y - 2);
    context.quadraticCurveTo(x + 1, y + 4, x + 6 - twitch, y - 1);
    context.stroke();
  }
  context.restore();
}

function drawWildInkAlienZombieDecay(context, layout, beat) {
  const { cx, cy, rx, ry } = layout;
  const stepPhase = Number.isInteger(beat?.step) ? beat.step : 0;
  const markPhase = Number.isInteger(beat?.ordinal)
    ? beat.ordinal
    : stepPhase;
  const palette = wildInkDecayPaletteForStep(beat?.step ?? 0);
  const pulse = clamp(Number(beat?.pulse) || 0);
  const compact = usesCompactCanvas();
  const phaseOffset = ((markPhase % 7) + 7) % 7;

  context.save();
  context.beginPath();
  appendWildInkSkullSilhouette(context, layout);
  context.clip();
  context.lineCap = "round";
  context.lineJoin = "round";

  // Black torn tissue losses at the temple and jaw turn the silhouette hostile;
  // their wet edges use the current bloody/visceral/maggoty state.
  context.fillStyle = "rgba(20, 7, 12, 0.93)";
  context.strokeStyle = colorWithAlpha(palette.tissue, 0.88);
  context.lineWidth = compact ? 2 : 2.7;
  context.beginPath();
  context.moveTo(cx - rx * 0.93, cy - ry * 0.25);
  context.lineTo(cx - rx * 0.68, cy - ry * 0.12);
  context.lineTo(cx - rx * 0.91, cy + ry * 0.09);
  context.closePath();
  context.moveTo(cx + rx * 0.88, cy + ry * 0.31);
  context.lineTo(cx + rx * 0.57, cy + ry * 0.47);
  context.lineTo(cx + rx * 0.76, cy + ry * 0.67);
  context.closePath();
  context.moveTo(cx - rx * 0.47, cy + ry * 0.71);
  context.lineTo(cx - rx * 0.18, cy + ry * 0.83);
  context.lineTo(cx - rx * 0.4, cy + ry * 0.91);
  context.closePath();
  context.fill();
  context.stroke();

  // Pulled dark sinew cords bridge the temples and jaw over the photo field.
  context.strokeStyle = "rgba(38, 7, 16, 0.96)";
  context.lineWidth = compact ? 4 : 5.2;
  context.beginPath();
  const sinewCount = compact ? 3 : 5;
  for (let cord = 0; cord < sinewCount; cord += 1) {
    const side = cord % 2 === 0 ? -1 : 1;
    const startX = cx + side * rx * (0.28 + cord * 0.055);
    const startY = cy - ry * (0.59 - cord * 0.035);
    const endX = cx + side * rx * (0.67 + (cord % 3) * 0.075);
    const endY = cy + ry * (0.21 + cord * 0.105);
    context.moveTo(startX, startY);
    context.quadraticCurveTo(cx + side * rx * 0.61, cy - ry * 0.08, endX, endY);
  }
  context.stroke();
  context.strokeStyle = colorWithAlpha(palette.tissue, 0.94);
  context.lineWidth = compact ? 1.7 : 2.35;
  context.stroke();

  // The maggot state blooms into deterministic crawling larva marks. Other
  // states retain a few worms so the rot does not become friendly between beats.
  const maggotCount = palette.id === "maggoty" ? (compact ? 9 : 14) : (compact ? 5 : 8);
  context.strokeStyle = "rgba(31, 22, 13, 0.9)";
  context.lineWidth = compact ? 4.1 : 5.2;
  context.beginPath();
  for (let maggot = 0; maggot < maggotCount; maggot += 1) {
    const upperCluster = maggot < Math.ceil(maggotCount * 0.65);
    const xUnit = ((maggot * 37 + phaseOffset * 19) % 101) / 100;
    const yUnit = ((maggot * 61 + phaseOffset * 13) % 97) / 96;
    const x = upperCluster
      ? cx + rx * (-0.45 + xUnit * 0.72)
      : cx + rx * (-0.58 + xUnit * 1.15);
    const y = upperCluster
      ? cy - ry * (0.62 + yUnit * 0.25)
      : cy + ry * (0.53 + yUnit * 0.28);
    const bend = (maggot % 2 === 0 ? -1 : 1) * ry * 0.025;
    context.moveTo(x - rx * 0.027, y);
    context.quadraticCurveTo(x, y + bend, x + rx * 0.035, y - bend * 0.22);
  }
  context.stroke();
  context.strokeStyle = colorWithAlpha(palette.parasite, 0.98);
  context.lineWidth = compact ? 2.05 : 2.7;
  context.stroke();

  // Wet, uneven drips intensify on the bloody phase and kick slightly on hits.
  const dripCount = palette.id === "bloody" ? 6 : 3;
  context.strokeStyle = colorWithAlpha(
    palette.id === "bloody" ? palette.tissue : "#7b1324",
    0.74 + pulse * 0.22,
  );
  context.lineWidth = compact ? 2.2 : 3.1;
  context.beginPath();
  for (let drip = 0; drip < dripCount; drip += 1) {
    const x = cx + rx * (-0.66 + drip * (1.22 / Math.max(1, dripCount - 1)));
    const y = cy + ry * (0.2 + ((drip * 3 + phaseOffset) % 5) * 0.105);
    context.moveTo(x, y);
    context.quadraticCurveTo(x + rx * 0.025, y + ry * 0.08, x - rx * 0.008, y + ry * (0.14 + pulse * 0.035));
  }
  context.stroke();
  context.restore();
}

function drawWildInkSkullDetails(context, layout, now) {
  const { cx, cy, rx, ry, featureY } = layout;
  const eyeY = featureY - ry * 0.43;
  const eyeRadius = Math.min(rx, ry) * 0.235;
  const twitch = prefersReducedMotion ? 0 : Math.sin(now * 0.005) * 1.2;
  context.save();
  context.beginPath();
  appendWildInkSkullSilhouette(context, layout);
  context.clip();
  context.lineCap = "round";
  context.lineJoin = "round";

  // Oversized, angular orbital cavities remain behind the draggable eyeballs.
  // Jagged sockets make the skull predatory without changing eye hitboxes.
  for (const side of [-1, 1]) {
    const eyeX = cx + side * rx * 0.34;
    const socket = eyeRadius;
    context.fillStyle = "rgba(17, 5, 11, 0.9)";
    context.strokeStyle = "rgba(48, 9, 21, 0.98)";
    context.lineWidth = 4.1;
    context.beginPath();
    context.moveTo(eyeX - socket * 1.35 + side * twitch, eyeY - socket * 0.34);
    context.lineTo(eyeX - socket * 0.88, eyeY - socket * 1.18);
    context.lineTo(eyeX - socket * 0.08, eyeY - socket * 1.4);
    context.lineTo(eyeX + socket * 0.82, eyeY - socket * 1.02);
    context.lineTo(eyeX + socket * 1.38, eyeY - socket * 0.14);
    context.lineTo(eyeX + socket * 1.08, eyeY + socket * 0.83);
    context.lineTo(eyeX + socket * 0.2, eyeY + socket * 1.3);
    context.lineTo(eyeX - socket * 0.91, eyeY + socket * 0.88);
    context.closePath();
    context.fill();
    context.stroke();

    // Hollow temples and blade-like cheekbones exaggerate the skull planes.
    context.fillStyle = "rgba(29, 8, 16, 0.65)";
    context.beginPath();
    context.moveTo(cx + side * rx * 0.94, cy - ry * 0.22);
    context.lineTo(cx + side * rx * 0.66, cy - ry * 0.08);
    context.lineTo(cx + side * rx * 0.75, cy + ry * 0.2);
    context.lineTo(cx + side * rx * 0.98, cy + ry * 0.08);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(39, 8, 18, 0.9)";
    context.lineWidth = 3.25;
    context.beginPath();
    context.moveTo(cx + side * rx * 0.88, cy + ry * 0.17);
    context.quadraticCurveTo(
      cx + side * rx * 0.69,
      cy + ry * 0.27,
      cx + side * rx * 0.49,
      cy + ry * 0.34,
    );
    context.stroke();

    // A separate lower-jaw seam frames the live mouth rather than replacing it.
    context.strokeStyle = "rgba(53, 43, 36, 0.5)";
    context.lineWidth = 2.45;
    context.beginPath();
    context.moveTo(cx + side * rx * 0.7, cy + ry * 0.51);
    context.quadraticCurveTo(
      cx + side * rx * 0.59,
      cy + ry * 0.76,
      cx + side * rx * 0.18,
      cy + ry * 0.87,
    );
    context.stroke();
  }

  // The movable clown nose rides over a long ink-black nasal cavity.
  context.fillStyle = "rgba(29, 25, 22, 0.58)";
  context.strokeStyle = "rgba(58, 46, 38, 0.66)";
  context.lineWidth = 2.35;
  context.beginPath();
  context.moveTo(cx, featureY - ry * 0.18);
  context.bezierCurveTo(
    cx + rx * 0.15,
    featureY - ry * 0.02,
    cx + rx * 0.12,
    featureY + ry * 0.2,
    cx,
    featureY + ry * 0.24,
  );
  context.bezierCurveTo(
    cx - rx * 0.12,
    featureY + ry * 0.2,
    cx - rx * 0.15,
    featureY - ry * 0.02,
    cx,
    featureY - ry * 0.18,
  );
  context.fill();
  context.stroke();

  // Crooked sutures and hatch marks preserve the manic hand-inked character.
  context.strokeStyle = "rgba(55, 44, 36, 0.55)";
  context.lineWidth = 2.15;
  context.beginPath();
  context.moveTo(cx - rx * 0.04, cy - ry * 0.95);
  context.lineTo(cx + rx * 0.055, cy - ry * 0.83);
  context.lineTo(cx - rx * 0.025, cy - ry * 0.72);
  context.lineTo(cx + rx * 0.08, cy - ry * 0.59);
  context.lineTo(cx + rx * 0.015, cy - ry * 0.48);
  context.stroke();
  context.lineWidth = 1.25;
  for (const side of [-1, 1]) {
    for (let hatch = 0; hatch < 4; hatch += 1) {
      const y = cy + ry * (0.47 + hatch * 0.075);
      context.beginPath();
      context.moveTo(cx + side * rx * (0.48 + hatch * 0.018), y);
      context.lineTo(cx + side * rx * (0.6 + hatch * 0.012), y + ry * 0.035);
      context.stroke();
    }
  }
  context.restore();
}

function drawVisualSkinBeatField(context, layout, skinId, beat) {
  if (!beat?.active) return;
  const { cx, cy, rx, ry } = layout;
  const pulse = clamp(beat.pulse);
  const step = Math.max(0, Math.trunc(beat.step));
  const colors = visualSkinBeatColors(skinId, step);
  const faceLeft = cx - rx * 1.18;
  const faceTop = cy - ry * 1.12;
  const faceWidth = rx * 2.36;
  const faceHeight = ry * 2.24;
  context.save();

  switch (skinId) {
    case "checker": { // A quick glossy color-pop makes the original goofball hit harder.
      const flareX = cx + ((step % 3) - 1) * rx * 0.3;
      const flareY = cy - ry * (0.34 - (step % 2) * 0.45);
      const sheen = context.createRadialGradient(flareX, flareY, 0, flareX, flareY, ry * 1.1);
      sheen.addColorStop(0, `rgba(255, 255, 255, ${0.07 + pulse * 0.18})`);
      sheen.addColorStop(0.42, `rgba(255, 244, 190, ${pulse * 0.07})`);
      sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.globalCompositeOperation = "screen";
      context.fillStyle = sheen;
      context.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
      break;
    }

    case "wild-ink": { // Decay registration flashes through bloody, visceral, and maggoty tones.
      const decay = wildInkDecayPaletteForStep(beat.step ?? step);
      context.globalCompositeOperation = "multiply";
      context.globalAlpha = 0.2 + pulse * 0.22;
      context.fillStyle = getLowFiPhotoGrainPattern(context);
      context.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
      context.globalAlpha = 1;
      context.fillStyle = colorWithAlpha(decay.tissue, 0.12 + pulse * 0.25);
      context.beginPath();
      context.moveTo(cx - rx * 1.08, cy - ry * 0.72);
      context.lineTo(cx + rx * 0.34, cy - ry * 0.42);
      context.lineTo(cx + rx * 0.14, cy - ry * 0.24);
      context.lineTo(cx - rx * 1.02, cy - ry * 0.47);
      context.closePath();
      context.moveTo(cx + rx * 1.04, cy + ry * 0.05);
      context.lineTo(cx - rx * 0.38, cy + ry * 0.43);
      context.lineTo(cx - rx * 0.17, cy + ry * 0.61);
      context.lineTo(cx + rx * 0.94, cy + ry * 0.3);
      context.closePath();
      context.fill();
      context.globalCompositeOperation = "screen";
      context.fillStyle = colorWithAlpha(decay.parasite, 0.04 + pulse * 0.16);
      context.beginPath();
      context.moveTo(cx - rx * 0.72, cy + ry * 0.11);
      context.lineTo(cx + rx * 0.78, cy - ry * 0.2);
      context.lineTo(cx + rx * 0.84, cy - ry * 0.08);
      context.lineTo(cx - rx * 0.68, cy + ry * 0.23);
      context.closePath();
      context.fill();
      if (beat.downbeat) {
        context.globalCompositeOperation = "source-over";
        context.fillStyle = colorWithAlpha(decay.base, 0.06 + pulse * 0.14);
        context.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
      }
      break;
    }

    case "cutout-collage": { // CMYK-like registration bands turn the paper head into a moving poster.
      context.globalCompositeOperation = "screen";
      context.fillStyle = colorWithAlpha(colors[0], 0.07 + pulse * 0.15);
      context.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
      context.translate(cx, cy);
      context.rotate((step % 2 === 0 ? -1 : 1) * (0.42 + (step % 4) * 0.045));
      const span = Math.max(rx, ry) * 3.2;
      const stripeWidth = Math.max(15, Math.min(rx, ry) * 0.14);
      for (let stripe = -5; stripe <= 5; stripe += 1) {
        context.fillStyle = colorWithAlpha(
          colors[(stripe + step + 12) % colors.length],
          0.08 + pulse * (stripe % 2 === 0 ? 0.27 : 0.18),
        );
        context.fillRect(-span, stripe * stripeWidth * 1.42, span * 2, stripeWidth);
      }
      context.globalCompositeOperation = "multiply";
      context.fillStyle = colorWithAlpha(colors[1], 0.06 + pulse * 0.12);
      for (let bar = -3; bar <= 3; bar += 1) {
        context.fillRect(bar * stripeWidth * 2.15, -span, stripeWidth * 0.4, span * 2);
      }
      break;
    }

    case "photo-1904": { // A small darkroom exposure breath keeps the photograph quiet and believable.
      const exposureX = cx + ((step % 5) - 2) * rx * 0.13;
      const exposure = context.createRadialGradient(
        exposureX,
        cy - ry * 0.22,
        ry * 0.08,
        cx,
        cy,
        ry * 1.18,
      );
      exposure.addColorStop(0, colorWithAlpha(colors[0], 0.025 + pulse * 0.085));
      exposure.addColorStop(0.58, colorWithAlpha(colors[1], 0.012 + pulse * 0.035));
      exposure.addColorStop(1, "rgba(18, 16, 13, 0.055)");
      context.globalCompositeOperation = "screen";
      context.fillStyle = exposure;
      context.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
      if (beat.downbeat) {
        const gateX = faceLeft + ((step * 37) % 100) / 100 * faceWidth;
        context.fillStyle = colorWithAlpha(colors[0], 0.025 + pulse * 0.045);
        context.fillRect(gateX, faceTop, Math.max(1, rx * 0.012), faceHeight);
      }
      break;
    }

    case "food-portrait": { // Rotating produce-color wedges and a varnish glint wake up the pantry face.
      context.globalCompositeOperation = "overlay";
      const start = (step % 8) * Math.PI * 0.25;
      for (let wedge = 0; wedge < 6; wedge += 1) {
        context.beginPath();
        context.moveTo(cx, cy);
        context.arc(
          cx,
          cy,
          Math.max(rx, ry) * 1.42,
          start + wedge * Math.PI / 3,
          start + (wedge + 0.72) * Math.PI / 3,
        );
        context.closePath();
        context.fillStyle = colorWithAlpha(colors[wedge % colors.length], 0.08 + pulse * 0.22);
        context.fill();
      }
      const quadrant = step % 4;
      const glintX = cx + (quadrant === 0 || quadrant === 3 ? -1 : 1) * rx * 0.43;
      const glintY = cy + (quadrant < 2 ? -1 : 1) * ry * 0.38;
      const glint = context.createRadialGradient(glintX, glintY, 0, glintX, glintY, ry * 0.68);
      glint.addColorStop(0, `rgba(255, 247, 176, ${0.08 + pulse * 0.25})`);
      glint.addColorStop(1, "rgba(255, 247, 176, 0)");
      context.globalCompositeOperation = "screen";
      context.fillStyle = glint;
      context.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
      break;
    }

    case "ascii": { // Phosphor scan and deterministic glitch blocks animate the glyph-built solids.
      context.globalCompositeOperation = "screen";
      context.fillStyle = colorWithAlpha(colors[0], 0.035 + pulse * 0.09);
      context.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
      const scanY = faceTop + ((step % 12) + 0.5) / 12 * faceHeight;
      context.fillStyle = colorWithAlpha(colors[1], 0.16 + pulse * 0.4);
      context.fillRect(faceLeft, scanY, faceWidth, Math.max(3, ry * (0.025 + pulse * 0.025)));
      const glitchCount = usesCompactCanvas() ? 3 : 5;
      for (let glitch = 0; glitch < glitchCount; glitch += 1) {
        const unitX = ((step * 17 + glitch * 29 + 11) % 97) / 97;
        const unitY = ((step * 31 + glitch * 19 + 7) % 89) / 89;
        context.fillStyle = colorWithAlpha(
          colors[(glitch + step) % colors.length],
          0.1 + pulse * (glitch % 2 === 0 ? 0.32 : 0.2),
        );
        context.fillRect(
          faceLeft + unitX * faceWidth * 0.78,
          faceTop + unitY * faceHeight,
          rx * (0.14 + (glitch % 3) * 0.1),
          Math.max(2, ry * 0.018),
        );
      }
      break;
    }
    default:
      break;
  }
  context.restore();
}

function drawBackground(context, width, height, now, motion, skinBeat = null) {
  const skin = currentVisualSkin();
  const background = skin.id === "photo-1904"
    ? "#090908"
    : skin.id === "food-portrait"
      ? "#0d0803"
      : skin.id === "ascii"
        ? "#010704"
        : skin.id === "cutout-collage"
          ? "#100b0b"
          : skin.id === "wild-ink"
            ? "#130b09"
            : "#080507";
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.save();
  context.strokeStyle = skin.id === "ascii"
    ? "rgba(82, 255, 151, 0.055)"
    : skin.id === "photo-1904"
      ? "rgba(238, 226, 196, 0.026)"
      : "rgba(255, 111, 121, 0.035)";
  context.lineWidth = 1;
  // ASCII already spends its paint budget on cached glyph tiles. A static,
  // double-size terminal grid preserves the look while cutting background
  // line work by roughly three quarters on phones.
  const grid = skin.id === "ascii" ? 68 : 34;
  const gridOffset = skin.id === "ascii" ? 0 : (now * 0.002) % grid;
  for (let x = gridOffset; x < width; x += grid) {
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
  const beatPulse = clamp(Number(skinBeat?.pulse) || 0);
  const beatColors = visualSkinBeatColors(skin.id, skinBeat?.step ?? -1);
  const beatGlowStrength = skin.id === "photo-1904" || skin.id === "wild-ink"
    ? beatPulse * 0.045
    : beatPulse * (skin.id === "checker" ? 0.11 : 0.14);
  const glowX = width * (0.49 + (((skinBeat?.step ?? 0) % 3) - 1) * 0.035);
  const glow = context.createRadialGradient(glowX, height * 0.5, 0, glowX, height * 0.5, Math.min(width, height) * 0.6);
  const staticGlow = skin.id === "ascii"
    ? 0.022 + Math.min(0.1, total * 0.02)
    : skin.id === "food-portrait"
      ? 0.026 + Math.min(0.1, total * 0.02)
      : skin.id === "photo-1904"
        ? 0.018 + Math.min(0.08, total * 0.018)
        : 0.025 + Math.min(0.12, total * 0.025);
  const glowColor = colorWithAlpha(beatColors[0], staticGlow + beatGlowStrength);
  glow.addColorStop(0, glowColor);
  glow.addColorStop(0.52, skin.id === "ascii" ? "rgba(38, 166, 99, 0.02)" : "rgba(101, 223, 232, 0.018)");
  glow.addColorStop(1, "rgba(8, 5, 7, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  if (skin.id === "photo-1904") {
    context.globalAlpha = 0.12;
    context.fillStyle = "#d7c9a8";
    for (let scratch = 0; scratch < 11; scratch += 1) {
      const x = ((scratch * 97 + 31) % Math.max(1, width));
      context.fillRect(x, 0, scratch % 3 === 0 ? 1 : 0.45, height);
    }
  }
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

function appendWildInkSkullSilhouette(context, layout, pop = 0, slap = 0) {
  const { cx, cy, rx, ry } = layout;
  // An original alien-zombie profile: broken dome, pinched temples, projecting
  // cheek spikes, ripped jaw corners, and an off-center chin. It stays inside
  // the normal head bounds so all established controls keep their hit geometry.
  context.moveTo(cx, cy - ry);
  context.lineTo(cx + rx * 0.18, cy - ry * 0.96);
  context.quadraticCurveTo(cx + rx * 0.62, cy - ry * 1.02, cx + rx * 0.77, cy - ry * 0.78);
  context.lineTo(cx + rx * 0.94, cy - ry * 0.66);
  context.lineTo(cx + rx * 0.86, cy - ry * 0.42);
  context.lineTo(cx + rx * (0.98 + pop * 0.06), cy - ry * 0.3);
  context.lineTo(cx + rx * 0.76, cy - ry * 0.11);
  context.lineTo(cx + rx * (0.84 + pop * 0.08), cy + ry * 0.035);
  context.lineTo(cx + rx * (1.04 + pop * 0.12), cy + ry * 0.16);
  context.lineTo(cx + rx * 0.72, cy + ry * 0.4);
  context.lineTo(cx + rx * 0.68, cy + ry * 0.66);
  context.lineTo(cx + rx * 0.46, cy + ry * 0.88);
  context.lineTo(cx + rx * 0.1, cy + ry * 0.92);
  context.lineTo(cx - rx * 0.04, cy + ry * 0.99);
  context.lineTo(cx - rx * 0.37, cy + ry * 0.9);
  context.lineTo(cx - rx * 0.62, cy + ry * 0.69);
  context.lineTo(cx - rx * 0.75, cy + ry * 0.42);
  context.lineTo(cx - rx * (1.02 + slap * 0.13), cy + ry * 0.24);
  context.lineTo(cx - rx * (0.86 + slap * 0.07), cy + ry * 0.045);
  context.lineTo(cx - rx * 0.77, cy - ry * 0.12);
  context.lineTo(cx - rx * (0.99 + slap * 0.07), cy - ry * 0.31);
  context.lineTo(cx - rx * 0.88, cy - ry * 0.5);
  context.lineTo(cx - rx * 0.96, cy - ry * 0.73);
  context.quadraticCurveTo(cx - rx * 0.63, cy - ry * 1.01, cx - rx * 0.24, cy - ry * 0.94);
  context.closePath();
}

function drawZombieZoidSawBlade(context, x, y, radius, side) {
  const toothCount = 18;
  const bladeRadius = radius * 1.18;
  const rootRadius = bladeRadius * 0.82;
  context.save();
  context.translate(x, y);
  context.rotate(side * Math.PI / toothCount);
  context.lineJoin = "miter";
  context.beginPath();
  for (let tooth = 0; tooth < toothCount; tooth += 1) {
    const toothAngle = tooth / toothCount * Math.PI * 2;
    const nextAngle = (tooth + 0.72) / toothCount * Math.PI * 2;
    const rootAngle = (tooth + 0.9) / toothCount * Math.PI * 2;
    const command = tooth === 0 ? "moveTo" : "lineTo";
    context[command](Math.cos(toothAngle) * rootRadius, Math.sin(toothAngle) * rootRadius);
    context.lineTo(Math.cos(nextAngle) * bladeRadius, Math.sin(nextAngle) * bladeRadius);
    context.lineTo(Math.cos(rootAngle) * rootRadius, Math.sin(rootAngle) * rootRadius);
  }
  context.closePath();
  const steel = context.createRadialGradient(
    -bladeRadius * 0.28,
    -bladeRadius * 0.32,
    bladeRadius * 0.08,
    0,
    0,
    bladeRadius,
  );
  steel.addColorStop(0, "rgb(205, 197, 176)");
  steel.addColorStop(0.48, "rgb(112, 111, 99)");
  steel.addColorStop(1, "rgb(48, 42, 42)");
  context.fillStyle = steel;
  context.strokeStyle = "rgba(35, 14, 24, 0.98)";
  context.lineWidth = Math.max(2.2, radius * 0.12);
  context.fill();
  context.stroke();

  // The fixed hub and stamped holes sell the saw-blade silhouette while the
  // existing ear center remains the unchanged stereo drag target.
  context.fillStyle = "rgba(39, 24, 30, 0.96)";
  context.beginPath();
  context.arc(0, 0, bladeRadius * 0.24, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(191, 177, 143, 0.82)";
  context.lineWidth = Math.max(1.2, radius * 0.055);
  context.stroke();
  context.fillStyle = "rgba(27, 17, 22, 0.88)";
  for (let hole = 0; hole < 5; hole += 1) {
    const angle = hole / 5 * Math.PI * 2;
    context.beginPath();
    context.arc(
      Math.cos(angle) * bladeRadius * 0.52,
      Math.sin(angle) * bladeRadius * 0.52,
      bladeRadius * 0.075,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.restore();
}

function drawFace(context, layout, pose, motion, now, checkerStep = -1, skinBeat = null) {
  const { cx, cy, rx, ry, featureY, mouthY, opening } = layout;
  const visualSkin = currentVisualSkin();
  const skinPalette = visualSkinPalette();
  const skinAtlas = visualSkin.mode === "atlas" ? currentVisualSkinAsset() : null;
  const skinFieldAsset = currentVisualSkinFieldAsset();
  const atlasReady = Boolean(skinAtlas);
  const wildInk = visualSkin.id === "wild-ink";
  const asciiSkin = visualSkin.id === "ascii";
  const webcamSkin = visualSkin.id === "webcam-cutup";
  const wildInkDecay = wildInk
    ? wildInkDecayPaletteForStep(skinBeat?.step ?? checkerStep)
    : null;
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
  const huff = motion.huff ?? 0;
  const waow = motion.waow ?? 0;
  const whoop = motion.whoop ?? 0;
  const doodoo = motion.doodoo ?? 0;
  const llll = motion.llll ?? 0;
  const purr = motion.purr ?? 0;
  const klikklak = motion.klikklak ?? 0;
  const rrrr = motion.rrrr ?? 0;
  const lrroll = motion.lrroll ?? 0;
  const lalatrip = motion.lalatrip ?? 0;
  const hiccuplong = motion.hiccuplong ?? 0;
  const zzzz = motion.zzzz ?? 0;
  const ehyeah = motion.ehyeah ?? 0;
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
  context.translate(cx, cy + idleBob - (hiccup + hiccuplong * 0.86) * ry * 0.028);
  context.rotate(wobble + idleTilt);
  context.scale(
    1 + idleSquash + (hiccup + hiccuplong * 0.8) * 0.035,
    1 - idleSquash * 0.72 - (hiccup + hiccuplong * 0.8) * 0.07,
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
    context.strokeStyle = skinPalette.outline;
    context.lineWidth = compactHair ? 3.6 : 4.4;
    context.stroke();
    context.strokeStyle = asciiPaint(
      context,
      side < 0 ? "tether-left" : "tether-right",
      side < 0 ? skinPalette.earA : skinPalette.earB,
    );
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
  if (wildInk) appendWildInkSkullSilhouette(context, layout, pop, slap);
  else appendHeadSilhouette(context, layout, pop, slap);
  context.clip("evenodd");
  for (const side of [-1, 1]) {
    const hair = sideSpaghettiHairGeometry(layout, pose, side);
    if (atlasReady) {
      const atlasHeight = hair.length * 1.42;
      const centerX = hair.rootX + hair.directionX * atlasHeight * 0.42;
      const centerY = hair.rootY + hair.directionY * atlasHeight * 0.42;
      drawSkinAtlasPart(
        context,
        skinAtlas,
        SKIN_ATLAS_PART.hair,
        centerX,
        centerY,
        ry * 0.76,
        atlasHeight,
        {
          rotation: Math.atan2(hair.directionX, -hair.directionY),
          mirrorX: side > 0,
        },
      );
      continue;
    }
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
      if (wildInk) {
        // The zombie skull grows electrical bolt hair. The established root,
        // angle, and tip still follow the same delay-control geometry.
        const boltSegments = compactHair ? 4 : 6;
        context.beginPath();
        context.moveTo(rootX, rootY);
        for (let segment = 1; segment <= boltSegments; segment += 1) {
          const progress = segment / boltSegments;
          const zig = segment === boltSegments
            ? 0
            : (segment % 2 === 0 ? -1 : 1) * strandLength * (0.035 + Math.abs(fan) * 0.026);
          context.lineTo(
            rootX + directionX * strandLength * progress + normalX * zig,
            rootY + directionY * strandLength * progress + normalY * zig,
          );
        }
        context.strokeStyle = skinPalette.outline;
        context.lineWidth = (compactHair ? 6.4 : 8) + (strand % 3) * 0.5;
        context.stroke();
        context.strokeStyle = strand % 2 === 0
          ? wildInkDecay?.parasite ?? "#fff2ad"
          : wildInkDecay?.tissue ?? "#e34d4b";
        context.lineWidth = compactHair ? 2.7 : 3.5;
        context.stroke();
        context.restore();
        continue;
      }
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
      context.strokeStyle = skinPalette.outline;
      context.lineWidth = (compactHair ? 6.2 : 7.4) + (strand % 3) * 0.55;
      context.stroke();
      context.strokeStyle = asciiPaint(
        context,
        side < 0 ? "hair-left" : "hair-right",
        strand % 2 === 0 ? skinPalette.hairA : skinPalette.hairB,
      );
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
    if (wildInk) {
      drawZombieZoidSawBlade(context, earX, earY, earRadius, side);
    } else if (atlasReady) {
      drawSkinAtlasPart(
        context,
        skinAtlas,
        side < 0 ? SKIN_ATLAS_PART.leftEar : SKIN_ATLAS_PART.rightEar,
        earX,
        earY,
        earRadius * 3.45,
        earRadius * 2.65,
      );
      context.strokeStyle = skinPalette.outline;
      context.lineWidth = 2.2;
      context.beginPath();
      context.arc(earX, earY, earRadius, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.fillStyle = skinCheckerColors[side < 0 ? 0 : 1];
      if (visualSkin.id !== "checker") {
        context.fillStyle = side < 0 ? skinPalette.earA : skinPalette.earB;
      }
      if (asciiSkin) {
        context.fillStyle = asciiPaint(context, side < 0 ? "ear-left" : "ear-right", context.fillStyle);
      }
      context.strokeStyle = skinPalette.outline;
      context.lineWidth = wildInk ? 3.4 : asciiSkin ? 2.2 : 3.2;
      context.beginPath();
      context.arc(earX, earY, earRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.strokeStyle = asciiPaint(
        context,
        side < 0 ? "ear-right" : "ear-left",
        side < 0 ? skinPalette.earB : skinPalette.earA,
      );
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
  }

  // An opaque two-color checkerboard supplies the skin. Both checker paths
  // share the deforming silhouette clip, while
  // batching each color into one fill keeps the phone paint cost bounded.
  context.save();
  context.beginPath();
  if (wildInk) appendWildInkSkullSilhouette(context, layout, pop, slap);
  else appendHeadSilhouette(context, layout, pop, slap);
  context.clip();
  if (atlasReady) {
    context.fillStyle = visualSkin.id === "cutout-collage" ? "#132a32" : skinPalette.head;
    context.fillRect(cx - rx * 1.08, cy - ry * 1.08, rx * 2.16, ry * 2.16);
    if (visualSkin.id === "cutout-collage" && skinFieldAsset) {
      drawCutoutCollageBeatField(context, skinFieldAsset, layout, skinBeat);
    } else {
      drawSkinAtlasPart(context, skinAtlas, SKIN_ATLAS_PART.head, cx, cy, rx * 3.05, ry * 2.48);
    }
    if (visualSkin.id === "photo-1904") {
      context.save();
      context.globalAlpha = 0.13;
      context.globalCompositeOperation = "multiply";
      context.fillStyle = getLowFiPhotoGrainPattern(context);
      context.fillRect(cx - rx * 1.1, cy - ry * 1.1, rx * 2.2, ry * 2.2);
      context.restore();
    }
  } else if (wildInk) {
    context.fillStyle = wildInkDecay?.base ?? skinPalette.head;
    context.fillRect(cx - rx * 1.1, cy - ry * 1.1, rx * 2.2, ry * 2.2);
    if (skinFieldAsset) drawWildInkDecayPhotoField(context, skinFieldAsset, layout, skinBeat);
    context.save();
    context.globalAlpha = 0.48;
    context.globalCompositeOperation = "multiply";
    context.fillStyle = getLowFiPhotoGrainPattern(context);
    context.fillRect(cx - rx * 1.1, cy - ry * 1.1, rx * 2.2, ry * 2.2);
    context.restore();
  } else if (asciiSkin) {
    context.fillStyle = asciiPaint(context, "head", skinPalette.head);
    context.fillRect(cx - rx * 1.1, cy - ry * 1.1, rx * 2.2, ry * 2.2);
  } else {
    const skinCheckerSize = clamp(Math.min(rx, ry) * 0.18, 22, 34);
    const skinCheckerLeft = Math.floor((cx - rx * 1.24) / skinCheckerSize) * skinCheckerSize;
    const skinCheckerTop = Math.floor((cy - ry * 1.08) / skinCheckerSize) * skinCheckerSize;
    const skinCheckerRight = cx + rx * 1.24;
    const skinCheckerBottom = cy + ry * 1.08;
    for (let colorIndex = 0; colorIndex < skinCheckerColors.length; colorIndex += 1) {
      context.beginPath();
      let rowIndex = 0;
      for (let checkerY = skinCheckerTop; checkerY < skinCheckerBottom; checkerY += skinCheckerSize) {
        let columnIndex = 0;
        for (let checkerX = skinCheckerLeft; checkerX < skinCheckerRight; checkerX += skinCheckerSize) {
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
  }
  drawVisualSkinBeatField(context, layout, visualSkin.id, skinBeat);
  context.restore();

  if (wildInk) {
    drawWildInkMarks(context, layout, now);
    drawWildInkAlienZombieDecay(context, layout, skinBeat);
    drawWildInkSkullDetails(context, layout, now);
  }

  // Restore the stroke state after the skin fill. The head remains one strong
  // contour over its opaque checkerboard.
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.strokeStyle = "rgba(151, 92, 220, 0.98)";
  if (visualSkin.id !== "checker") context.strokeStyle = skinPalette.outline;
  const featureOutlineWidth = 3.2;
  const skinFeatureOutlineWidth = wildInk ? 3.4 : asciiSkin ? 2.2 : atlasReady ? 2.5 : featureOutlineWidth;
  context.lineWidth = skinFeatureOutlineWidth;
  context.beginPath();
  if (wildInk) appendWildInkSkullSilhouette(context, layout, pop, slap);
  else appendHeadSilhouette(context, layout, pop, slap);
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
    context.fillStyle = asciiPaint(context, "eye-white", skinPalette.eye);
    context.strokeStyle = skinPalette.outline;
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
    if (atlasReady) {
      // Move each photographic eye cutout inside the canonical circular eye.
      // The shared mirrored gaze value therefore still exposes the reverb drag.
      drawSkinAtlasPart(
        context,
        skinAtlas,
        leftEye ? SKIN_ATLAS_PART.leftEye : SKIN_ATLAS_PART.rightEye,
        gazeX * 0.52,
        gazeY * 0.3,
        eyeRx * 2.75,
        eyeRy * 3.15,
      );
    } else {
      if (asciiSkin) {
        context.fillStyle = asciiPaint(
          context,
          leftEye ? "iris-left" : "iris-right",
          leftEye ? skinPalette.irisA : skinPalette.irisB,
        );
      } else {
        const irisGradient = context.createRadialGradient(
          gazeX - irisRadius * 0.22,
          gazeY - irisRadius * 0.24,
          irisRadius * 0.08,
          gazeX,
          gazeY,
          irisRadius,
        );
        irisGradient.addColorStop(0, "rgba(255, 255, 255, 0.96)");
        irisGradient.addColorStop(0.2, skinPalette.irisA);
        irisGradient.addColorStop(1, skinPalette.irisB);
        context.fillStyle = irisGradient;
      }
      context.strokeStyle = skinPalette.outline;
      context.lineWidth = wildInk ? 2.4 : 1.4;
      context.beginPath();
      context.arc(gazeX, gazeY, irisRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = asciiPaint(context, "pupil", "rgba(5, 3, 5, 0.96)");
      context.beginPath();
      context.arc(gazeX, gazeY, irisRadius * 0.46, 0, Math.PI * 2);
      context.fill();
      if (!asciiSkin && !wildInk) {
        context.fillStyle = "rgba(255, 255, 255, 0.92)";
        context.beginPath();
        context.arc(gazeX - irisRadius * 0.24, gazeY - irisRadius * 0.28, Math.max(1.5, irisRadius * 0.13), 0, Math.PI * 2);
        context.fill();
      }
      if (wildInk) {
        context.strokeStyle = "rgba(161, 48, 43, 0.48)";
        context.lineWidth = 1;
        for (let vein = 0; vein < 7; vein += 1) {
          const veinAngle = vein * 0.91 + side;
          context.beginPath();
          context.moveTo(Math.cos(veinAngle) * eyeRx * 0.96, Math.sin(veinAngle) * eyeRy * 0.96);
          context.lineTo(Math.cos(veinAngle) * eyeRx * 0.72, Math.sin(veinAngle) * eyeRy * 0.72);
          context.stroke();
        }
      }
    }
    context.restore();

    // Each eye remains the same circular size. Opaque colored lid tissue
    // slides over its top and bottom independently instead of squeezing the
    // eyeball or drawing long lines outside it.
    if (asciiSkin) {
      drawAsciiEyeShutters(context, {
        eyeRx,
        eyeRy,
        closure: eyeClosure,
        side,
      });
    } else {
      const lidCover = 0.08 + eyeClosure * 0.44;
      const lidEdgeY = eyeRy * (-1 + lidCover * 2);
      const lidFill = leftEye ? skinPalette.leftLid : skinPalette.rightLid;
      context.save();
      context.beginPath();
      context.arc(0, 0, eyeRadius, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = lidFill;
      context.beginPath();
      context.moveTo(-eyeRx, -eyeRy);
      context.lineTo(eyeRx, -eyeRy);
      context.lineTo(eyeRx, lidEdgeY);
      context.quadraticCurveTo(0, lidEdgeY + eyeRy * 0.12, -eyeRx, lidEdgeY);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(-eyeRx, eyeRy);
      context.lineTo(eyeRx, eyeRy);
      context.lineTo(eyeRx, -lidEdgeY);
      context.quadraticCurveTo(0, -lidEdgeY - eyeRy * 0.08, -eyeRx, -lidEdgeY);
      context.closePath();
      context.fill();
      context.restore();
    }
    context.strokeStyle = skinPalette.outline;
    context.lineWidth = featureOutlineWidth;
    context.beginPath();
    context.ellipse(0, 0, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    const brow = eyebrowGeometry(layout, pose, side);
    const browStartY = brow.y + brow.eyeRy * (leftEye ? 0.16 : -0.02);
    const browEndY = brow.y + brow.eyeRy * (leftEye ? 0.03 : 0.22);
    if (atlasReady) {
      const browAngle = Math.atan2(browEndY - browStartY, brow.eyeRx * 2.16);
      drawSkinAtlasPart(
        context,
        skinAtlas,
        SKIN_ATLAS_PART.brow,
        brow.x,
        (browStartY + browEndY) * 0.5,
        brow.eyeRx * 3.05,
        brow.eyeRy * 1.72,
        { rotation: browAngle, mirrorX: !leftEye },
      );
    } else {
      context.strokeStyle = skinPalette.outline;
      context.lineWidth = 13.2 + goofballEnergy * 2.8 + (wildInk ? 3 : 0);
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
      context.strokeStyle = asciiPaint(
        context,
        leftEye ? "brow-left" : "brow-right",
        leftEye ? skinPalette.browA : skinPalette.browB,
      );
      context.lineWidth = 8.2 + goofballEnergy * 1.7;
      context.stroke();
    }
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
  context.strokeStyle = visualSkin.id === "checker"
    ? `rgba(101, 223, 232, ${0.22 + pose.nasalMix * 0.5})`
    : skinPalette.outline;
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
  if (atlasReady) {
    drawSkinAtlasPart(
      context,
      skinAtlas,
      SKIN_ATLAS_PART.nose,
      noseX,
      noseY,
      noseRadius * 3.05,
      noseRadius * 3.05,
    );
    context.strokeStyle = skinPalette.outline;
    context.lineWidth = featureOutlineWidth;
    context.beginPath();
    context.arc(noseX, noseY, noseRadius, 0, Math.PI * 2);
    context.stroke();
  } else {
    context.fillStyle = asciiPaint(context, "nose", skinPalette.nose);
    context.strokeStyle = skinPalette.outline;
    context.lineWidth = featureOutlineWidth;
    context.beginPath();
    context.arc(noseX, noseY, noseRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (!asciiSkin) {
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
    } else {
      context.fillStyle = "rgba(1, 8, 4, 0.95)";
      context.font = `700 ${Math.max(12, noseRadius * 1.15)}px ui-monospace, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("@", noseX, noseY + 1);
    }
  }
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
    huff * 0.34,
    waow * 0.94,
    whoop,
    doodoo * 0.8,
    llll * 0.72,
    purr * 0.62,
    klikklak * 0.34,
    rrrr * 0.66,
    lrroll * 0.72,
    lalatrip * 0.9,
    hiccuplong * 0.9,
    zzzz * 0.42,
    ehyeah,
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
    + slurp * 0.84
    + huff * 0.62
    + waow * 0.72
    + whoop * 0.66
    + doodoo * 0.96
    + purr * 0.48
    + hiccuplong * 0.34;
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
    + lala * 0.76
    + waow * 0.54
    + whoop * 0.42
    + llll * 0.74
    + klikklak * 0.36
    + rrrr * 0.34
    + lrroll * 0.5
    + lalatrip * 0.78
    + zzzz * 0.52
    + ehyeah * 0.58;
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
    + whistle * Math.sin(now * 0.052) * 0.1
    + purr * Math.sin(now * 0.036) * 0.7
    + klikklak * Math.sin(now * 0.12) * 0.45
    + rrrr * Math.sin(now * 0.09) * 0.8
    + lrroll * Math.sin(now * 0.072) * 0.58
    + lalatrip * Math.sin(now * 0.05) * 0.42
    + hiccuplong * Math.sin(now * 0.034) * 0.22
    + zzzz * Math.sin(now * 0.11) * 0.18
    + ehyeah * Math.sin(now * 0.036) * 0.34
    + doodoo * Math.sign(Math.sin(now * 0.022)) * 0.18)
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
      + ehyeah * 0.52
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
      - zzzz * 0.12
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
  // Keep the ASCII cavity absolutely black. Patterning this large, deforming
  // oval both weakened the mouth silhouette and caused an avoidable patterned
  // fill on every animation frame.
  context.fillStyle = asciiSkin ? "#000000" : "rgba(4, 3, 4, 0.96)";
  context.beginPath();
  context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
  context.fill();
  if (webcamSkin && atlasReady && liveOpening > 3.5) {
    // The user's photographed mouth owns the entire live oval. A smaller,
    // translucent cavity preserves articulation and tooth contrast without
    // swallowing the crop inside the generic oversized black opening.
    context.save();
    context.beginPath();
    context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
    context.clip();
    drawSkinAtlasPart(
      context,
      skinAtlas,
      SKIN_ATLAS_PART.lips,
      cx,
      mouthY,
      mouthWidth * 2.18,
      Math.max(lipRimWidth * 2.4, liveOpening * 2.3),
    );
    context.fillStyle = "rgba(4, 2, 4, 0.58)";
    context.beginPath();
    context.ellipse(
      cx,
      mouthY,
      mouthWidth * 0.46,
      Math.max(1, liveOpening * 0.42),
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
    context.strokeStyle = skinPalette.outline;
    context.lineWidth = Math.max(1.4, featureOutlineWidth * 0.64);
    context.beginPath();
    context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (atlasReady && liveOpening > 3.5) {
    const innerMouthWidth = Math.max(1, mouthWidth - lipRimWidth * 0.62);
    const innerMouthOpening = Math.max(0.8, liveOpening - lipRimWidth * 0.62);
    // Clip the photograph to one canonical oval rim. This prevents an atlas's
    // source padding or asymmetry from ever reading as a second mouth.
    context.save();
    context.beginPath();
    context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
    context.ellipse(cx, mouthY, innerMouthWidth, innerMouthOpening, 0, 0, Math.PI * 2);
    context.fillStyle = skinPalette.lip;
    context.fill("evenodd");
    context.clip("evenodd");
    drawSkinAtlasPart(
      context,
      skinAtlas,
      SKIN_ATLAS_PART.lips,
      cx,
      mouthY - Math.max(2, liveOpening * 0.42),
      mouthWidth * 2.76,
      Math.max(lipRimWidth * 3, liveOpening * 4.15),
    );
    context.restore();
    context.strokeStyle = skinPalette.outline;
    context.lineWidth = Math.max(1, featureOutlineWidth * 0.52);
    context.beginPath();
    context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
    context.stroke();
  } else {
    context.strokeStyle = asciiPaint(context, "lips", skinPalette.lip);
    context.lineWidth = wildInk ? lipRimWidth * 1.24 : lipRimWidth;
    context.beginPath();
    context.ellipse(cx, mouthY, mouthWidth, liveOpening, 0, 0, Math.PI * 2);
    context.stroke();
  }

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
      if (atlasReady) {
        drawSkinAtlasPart(
          context,
          skinAtlas,
          SKIN_ATLAS_PART.tooth,
          toothX + width * 0.5,
          tineY + height * 0.5,
          width * 2.3,
          height * 1.62,
          { rotation: lean / Math.max(1, height) },
        );
        if (hitAmount > 0.01) {
          context.strokeStyle = `rgba(101, 223, 232, ${0.62 + hitAmount * 0.35})`;
          context.lineWidth = 0.85 + hitAmount * 0.9;
          roundedRect(context, toothX, tineY, width, height, corner);
          context.stroke();
        }
      } else {
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
        context.fillStyle = asciiSkin
          ? asciiPaint(context, hitAmount > 0.01 ? "tooth-hit" : "tooth", toothFill)
          : hitAmount > 0.01
            ? `rgba(247, 220, 106, ${0.72 + hitAmount * 0.28})`
            : toothFill;
        context.fill();
        context.strokeStyle = hitAmount > 0.01
          ? `rgba(101, 223, 232, ${0.62 + hitAmount * 0.35})`
          : skinPalette.outline;
        context.lineWidth = 0.85 + hitAmount * 0.9;
        context.stroke();
      }
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
  const tongueLift = (motion.tlik + klikklak * 0.82) * liveOpening * 0.55
    + pose.tongueCurl * liveOpening * 0.2
    + constrictionContact * liveOpening * 0.32;
  const tongueOut = clamp(Number(pose.tongueOut) || 0, 0, 1.6);
  const gestureTongueOut = lala * 0.62
    + motion.drr * 0.4
    + rrrr * 0.5
    + lrroll * 0.58
    + lalatrip * 0.72
    + slurp * 0.82;
  const liveTongueOut = clamp(tongueOut + gestureTongueOut, 0, 1.9);
  const tongueTipX = tongueX + (
    slurp - lala * 0.18 + lrroll * Math.sin(now * 0.014) * 0.24
  ) * mouthWidth * 0.12;
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
  context.fillStyle = asciiPaint(
    context,
    "tongue",
    skinPalette.tongue ?? TONGUE_STEP_COLORS[tongueColorIndex],
  );
  context.strokeStyle = skinPalette.outline;
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
  if (atlasReady) {
    context.save();
    context.clip();
    const tongueTop = mouthY + liveOpening * 0.18 - tongueLift;
    const tongueBottom = tongueTipY + tongueTipGeometry.height * 0.28;
    drawSkinAtlasPart(
      context,
      skinAtlas,
      SKIN_ATLAS_PART.tongue,
      tongueTipX,
      (tongueTop + tongueBottom) * 0.5,
      Math.max(mouthWidth * 2.15, tongueTipWidth * 2.4),
      Math.max(18, (tongueBottom - tongueTop) * 1.65),
    );
    context.restore();
  } else {
    context.fill();
  }
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
  context.fillStyle = asciiPaint(
    context,
    "head",
    colorWithAlpha(hotspot.color, emphasized ? 0.74 : 0.56),
  );
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
  const visualSkin = currentVisualSkin();
  const atlas = visualSkin.mode === "atlas" ? currentVisualSkinAsset() : null;
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
    if (atlas) {
      drawSkinAtlasPart(
        context,
        atlas,
        SKIN_ATLAS_PART.kiss,
        0,
        0,
        width * 2.7,
        height * 4.2,
        { alpha },
      );
      context.restore();
      continue;
    }
    context.globalAlpha = visualSkin.id === "ascii" ? alpha : 1;
    context.fillStyle = asciiPaint(
      context,
      "kiss",
      `hsla(${338 + mark.hue * 0.12}, 92%, 48%, ${alpha})`,
    );
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
  // The brush traverses the pitches in both directions while the bristles
  // visibly scrub up and down across every tooth contact.
  const scrub = Math.sin(phase * Math.PI * 24);
  const y = first.y - first.height * (0.72 + scrub * 0.22);
  const brushLength = Math.max(38, Math.abs(last.x - first.x) * 0.42);
  context.save();
  context.translate(x, y);
  const rotation = (brushSweep.direction < 0 ? Math.PI - 0.28 : -0.28)
    + Math.sin(phase * Math.PI) * 0.18 + scrub * 0.045;
  context.rotate(rotation);
  const visualSkin = currentVisualSkin();
  const atlas = visualSkin.mode === "atlas" ? currentVisualSkinAsset() : null;
  if (atlas) {
    drawSkinAtlasPart(
      context,
      atlas,
      SKIN_ATLAS_PART.brush,
      brushLength * 0.35,
      0,
      brushLength * 1.55,
      Math.max(38, brushLength * 0.56),
      { mirrorX: brushSweep.direction < 0 },
    );
    context.restore();
    return;
  }
  context.strokeStyle = asciiPaint(context, "brush", "rgba(19, 76, 142, 0.98)");
  context.lineWidth = 9;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(brushLength, -10);
  context.stroke();
  context.fillStyle = asciiPaint(context, "brush", "rgba(104, 218, 255, 0.98)");
  roundedRect(context, -14, -7, 27, 14, 5);
  context.fill();
  context.strokeStyle = asciiPaint(context, "brush", "rgba(245, 248, 255, 0.96)");
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
  const source = String(color).trim();
  const functional = source.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (functional) {
    return `rgba(${Number(functional[1])}, ${Number(functional[2])}, ${Number(functional[3])}, ${clamp(alpha)})`;
  }
  let clean = source.replace("#", "");
  if (clean.length === 3) clean = clean.split("").map((character) => character.repeat(2)).join("");
  const red = parseInt(clean.slice(0, 2), 16);
  const green = parseInt(clean.slice(2, 4), 16);
  const blue = parseInt(clean.slice(4, 6), 16);
  if (![red, green, blue].every(Number.isFinite)) return source;
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
      // Feature avoidance can push a dot past the circular outline. Pull it
      // back onto visible skin after every pass so all sounds stay usable by
      // mouse or touch even at extreme face mutations.
      const skinRx = Math.max(1, rx - hotspot.r - 2);
      const skinRy = Math.max(1, ry - hotspot.r - 2);
      const skinX = (hotspot.x - cx) / skinRx;
      const skinY = (hotspot.y - cy) / skinRy;
      const skinDistance = Math.hypot(skinX, skinY);
      if (skinDistance > 1) {
        hotspot.x = cx + skinX / skinDistance * skinRx;
        hotspot.y = cy + skinY / skinDistance * skinRy;
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

function drawZombieZoidIceCreamCone(
  context,
  hand,
  r,
  palmX,
  palmY,
  travel,
  selected,
  active,
  compact,
) {
  const tailX = hand.x + hand.side * r * 2.15;
  const tailY = hand.y + r * 1.22;
  const coneLength = Math.max(r * 2.7, Math.hypot(tailX - palmX, tailY - palmY));
  const coneOutline = "rgba(48, 19, 28, 0.98)";
  const coneBase = "rgb(184, 128, 72)";
  const coneGroove = "rgba(92, 51, 39, 0.72)";
  const scoopBase = hand.side < 0 ? "rgb(166, 67, 91)" : "rgb(126, 130, 67)";
  const scoopLight = hand.side < 0 ? "rgb(225, 146, 154)" : "rgb(188, 182, 105)";

  context.save();
  context.translate(palmX, palmY);
  context.rotate(Math.atan2(tailY - palmY, tailX - palmX));
  context.scale(1 - travel * 0.055, 1 + travel * 0.075);
  context.shadowColor = "rgba(73, 27, 42, 0.82)";
  context.shadowBlur = compact
    ? (selected ? 7 : active > 0.08 ? 4 : 0)
    : (selected ? 18 : 6 + active * 9);

  // The waffle cone points back offstage while its oversized scoop is the
  // exact former palm center that travels into the selected face strike.
  context.beginPath();
  context.moveTo(r * 0.38, -r * 0.7);
  context.lineTo(coneLength, 0);
  context.lineTo(r * 0.38, r * 0.7);
  context.closePath();
  context.fillStyle = coneBase;
  context.strokeStyle = coneOutline;
  context.lineWidth = Math.max(2.4, r * 0.1);
  context.fill();
  context.stroke();

  context.save();
  context.beginPath();
  context.moveTo(r * 0.38, -r * 0.7);
  context.lineTo(coneLength, 0);
  context.lineTo(r * 0.38, r * 0.7);
  context.closePath();
  context.clip();
  context.strokeStyle = coneGroove;
  context.lineWidth = Math.max(1, r * 0.045);
  for (let groove = -3; groove <= 3; groove += 1) {
    context.beginPath();
    context.moveTo(r * 0.28, groove * r * 0.3 - r * 0.78);
    context.lineTo(coneLength, groove * r * 0.3 + r * 0.78);
    context.stroke();
    context.beginPath();
    context.moveTo(r * 0.28, groove * r * 0.3 + r * 0.78);
    context.lineTo(coneLength, groove * r * 0.3 - r * 0.78);
    context.stroke();
  }
  context.restore();

  const scoop = context.createRadialGradient(
    -r * 0.28,
    -r * 0.38,
    r * 0.08,
    0,
    0,
    r * 1.08,
  );
  scoop.addColorStop(0, scoopLight);
  scoop.addColorStop(0.62, scoopBase);
  scoop.addColorStop(1, "rgb(75, 43, 51)");
  context.fillStyle = scoop;
  context.strokeStyle = coneOutline;
  context.lineWidth = Math.max(2.8, r * 0.11);
  context.beginPath();
  context.ellipse(-r * 0.08, 0, r * 1.04, r * 0.9, -0.04, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  // A few melting lobes make the weapon read as ice cream even when it is
  // squashed against a cheek at the end of the slap animation.
  for (const [dripX, dripY, dripRadius] of [
    [-0.62, 0.62, 0.3],
    [-0.06, 0.78, 0.24],
    [0.54, 0.57, 0.28],
  ]) {
    context.beginPath();
    context.ellipse(
      dripX * r,
      dripY * r,
      dripRadius * r,
      dripRadius * r * (1 + travel * 0.34),
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.stroke();
  }
  context.shadowBlur = 0;
  context.restore();
}

function drawHands(context, motion) {
  const compact = usesCompactCanvas();
  const visualSkin = currentVisualSkin();
  const atlas = visualSkin.mode === "atlas" ? currentVisualSkinAsset() : null;
  const asciiSkin = visualSkin.id === "ascii";
  const zombieZoid = visualSkin.id === "wild-ink";
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

    if (zombieZoid) {
      drawZombieZoidIceCreamCone(
        context,
        hand,
        r,
        palmX,
        palmY,
        travel,
        selected,
        active,
        compact,
      );
    } else {
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
      context.strokeStyle = asciiPaint(context, "hand", mittShade);
      context.lineWidth = r * 0.48;
      context.stroke();

      context.translate(palmX, palmY);
      context.rotate(hand.side * (-0.2 + travel * 0.34));
      context.scale(1 + travel * 0.08, 1 - travel * 0.045);
      context.shadowColor = hand.color;
      context.shadowBlur = compact
        ? (selected ? 8 : active > 0.08 ? 5 : 0)
        : (selected ? 22 : 8 + active * 12);
      if (atlas) {
        drawSkinAtlasPart(
          context,
          atlas,
          SKIN_ATLAS_PART.hand,
          0,
          -r * 0.16,
          r * 3.1,
          r * 3.45,
          { mirrorX: hand.side > 0 },
        );
      } else {
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
        context.fillStyle = asciiSkin ? asciiPaint(context, "hand", mittGradient) : mittGradient;
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
          context.strokeStyle = asciiPaint(
            context,
            "hand",
            finger % 2 === 0 ? mittHighlight : colorWithAlpha(hand.color, 0.98),
          );
          context.lineWidth = r * 0.22;
          context.stroke();
        }
        context.beginPath();
        context.moveTo(-hand.side * r * 0.43, -r * 0.05);
        context.lineTo(-hand.side * r * 0.94, -r * 0.36);
        context.strokeStyle = mittOutline;
        context.lineWidth = r * 0.34;
        context.stroke();
        context.strokeStyle = asciiPaint(context, "hand", mittHighlight);
        context.lineWidth = r * 0.25;
        context.stroke();
      }
    }
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
  // Camera preview owns the graphics budget while the modal is open. Audio
  // scheduling and its visual queue continue above, but the hidden stage does
  // not compete with a phone's camera compositor.
  if (webcamDialogIsOpen()) return;
  if (!stageIsVisible || cssWidth <= 1 || cssHeight <= 1) return;
  // Audio owns the realtime budget. Compact/coarse canvases repaint at 24fps;
  // the glyph-heavy ASCII skin uses a steady 36fps even on a large display.
  const paintRate = usesCompactCanvas()
    ? 24
    : currentVisualSkin().id === "ascii"
      ? 36
      : 0;
  if (paintRate && now - lastCanvasPaintAt < 1000 / paintRate) return;
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
  // `visibleStep` is advanced by the existing visual queue at its scheduled
  // playhead time. All skin animation below is paint-only; the scheduler may
  // continue looking ahead without pulling colors or exposure ahead too.
  const checkerStep = sequencePlaying && visibleStep >= 0
    ? visibleStep % sequenceLength
    : -1;
  const skinBeat = visualSkinBeatFrame(
    now,
    checkerStep,
    visualBeatOrdinal,
    visualBeatStartedAt,
    visualHitStartedAt,
    visualHitVelocity,
    visualHitSoundId,
    prefersReducedMotion,
  );
  drawBackground(drawing, cssWidth, cssHeight, now, motion, skinBeat);
  drawAirPlume(drawing, layout, motion, now);
  drawFace(drawing, layout, pose, motion, now, checkerStep, skinBeat);
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
  const asciiSkin = currentVisualSkin().id === "ascii";
  const requestedRatio = Math.min(compact ? 1.5 : asciiSkin ? 1.6 : 2, globalThis.devicePixelRatio || 1);
  const pixelBudget = compact ? 650_000 : asciiSkin ? 1_600_000 : 2_800_000;
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
  bindSequenceStepContextControls();
  $("randomPatternButton").addEventListener("click", scatterPattern);
  $("clearPatternButton").addEventListener("click", clearPattern);
  $("randomizeButton").addEventListener("click", randomizeFace);
  $("resetButton").addEventListener("click", resetAll);
  $("resetEffectsButton")?.addEventListener("click", resetFaceEffects);
  $("visualSkinSelect")?.addEventListener("change", () => {
    setVisualSkin($("visualSkinSelect").value);
  });
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
    const alternatives = HICCUP_HEAD_SOUND_BANKS.filter(({ id }) => id !== currentSoundBankId);
    const nextBank = alternatives[Math.floor(Math.random() * alternatives.length)]
      ?? HICCUP_HEAD_SOUND_BANKS[0];
    setSoundBank(nextBank.id, { mutate: true, audition: true });
  });
  $("soundBankSelect")?.addEventListener("change", () => (
    setSoundBank($("soundBankSelect").value, { audition: true })
  ));
  $("nextSoundBankButton")?.addEventListener("click", () => cycleSoundBank(1));
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
  $("sequenceGrid").addEventListener("change", handleSequenceGridChange);
  $("sequenceGrid").addEventListener("pointerdown", handleSequenceGridPickerOpen);
  $("sequenceGrid").addEventListener("pointerdown", handleSequenceVelocityPointerDown);
  $("sequenceGrid").addEventListener("pointermove", handleSequenceVelocityPointerMove);
  $("sequenceGrid").addEventListener("pointerup", handleSequenceVelocityPointerEnd);
  $("sequenceGrid").addEventListener("pointercancel", handleSequenceVelocityPointerEnd);
  $("sequenceGrid").addEventListener("focusin", handleSequenceGridPickerOpen);
  $("sequenceGrid").addEventListener("focusin", handleSequenceGridFocus);
  $("sequenceGrid").addEventListener("focusout", handleSequenceGridPickerClose);
  $("sequenceGrid").addEventListener("keydown", handleGridKeydown);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  canvas.addEventListener("pointerup", endPointerDrag);
  canvas.addEventListener("pointercancel", endPointerDrag);

  globalThis.addEventListener("keydown", (event) => {
    if (webcamDialogIsOpen()) return;
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
  setVisualSkin(visualSkinId, { announceChange: false, persist: false });
  buildPadGrid();
  buildVoiceRack({ preserveScroll: false });
  setSequenceLength(Number($("sequenceLength")?.value) || sequenceLength, { announceState: false });
  bindControls();
  bindWebcamPhotoBooth();
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
      if (webcamPhase === "live" || webcamPhase === "requesting") {
        stopWebcamStream();
        webcamPhase = webcamAppliedAtlas ? "applied" : "idle";
        syncWebcamSkinUi();
      }
      stopSequence({ announceState: false });
      graph?.sourceNode?.port.postMessage({ type: "silence" });
      graph?.facePostNode?.port.postMessage({ type: "silence" });
      clearNativeRoomHistory();
    }
  });
  globalThis.addEventListener("pagehide", () => {
    forgetWebcamSkin({ announceChange: false });
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
