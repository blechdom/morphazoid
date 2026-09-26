import { SEQUENCER_VOICES } from "../../sequencer-voice-renderer.js";
import { RUBIX_DEFAULTS, RUBIX_FACTORY_PRESETS } from "./factory-presets.js";
import { createSolvedRubixCube, turnRubixLayer, rubixLayersForSize, DEFAULT_RUBIX_CAMERA, createRubixSequenceSnapshot } from "./rubix.js";
import { DEFAULT_FM_DRUM_VOICES, sanitizeFmDrumVoice } from "../fm-drums/fm-drums.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";
import { RUBIX_SIMD_PRESETS, rubixSimdPreset } from "./rubix-simd-presets.js";

// Main's performer levels are protected for complete scenes as well as patches.
export const RUBIX_PRESET_SETTING_KEYS = Object.freeze(Object.keys(RUBIX_DEFAULTS)
  .filter(key => !["output", "acidLevel", "drumLevel"].includes(key)));
const numeric = {
  tempo: [30, 300], swing: [0, 0.42], cutoff: [160, 4200], resonance: [0, 18],
  acidDecay: [0.06, 0.72], drive: [0.5, 6],
  stickerModulation: [0, 1], visibilityDynamics: [0, 1], randomTwistSpeed: [0, 100],
};
const shapes = ["cube", "morphix", "diamond", "stella", "orb"];
const banks = [...SEQUENCER_VOICES.map(({ id }) => `shared-${id}`), "soft-fm", "analog", "modal", "noise", "acid-303", "rattlesnake", "pitched-morph", "karplus-strong"];
function arrangedCube(size, count, seed) {
  const solved = createSolvedRubixCube(size);
  let cube = solved;
  const layers = rubixLayersForSize(size);
  for (let index = 0; index < count; index++) {
    cube = turnRubixLayer(cube, { axis: ["x", "y", "z"][(index + seed) % 3],
      layer: layers[(index * 3 + seed) % layers.length], direction: (index + seed) % 2 ? -1 : 1 });
  }
  // Factory scores predate movable middle-slice centers. Preserve their exact
  // original notes; live turns and randomization use the complete slice.
  return Object.freeze({ ...cube, stickers: Object.freeze(cube.stickers.map(
    (sticker, index) => sticker.isCenter ? solved.stickers[index] : sticker,
  )) });
}
function fullScene(id, label, shapeId, size, readingMode, settings, turns = 0, seed = 0, camera = DEFAULT_RUBIX_CAMERA) {
  const values = { ...RUBIX_DEFAULTS, ...settings };
  values.simdPresetCustom = Object.entries(rubixSimdPreset(values.simdPreset).controls)
    .some(([key, value]) => values[key] !== value);
  const snapshot = {
    settings: Object.fromEntries(RUBIX_PRESET_SETTING_KEYS.map(key => [key, values[key]])), shapeId, readingMode,
    cube: arrangedCube(size, turns, seed), camera: { ...camera },
    drumVoices: DEFAULT_FM_DRUM_VOICES.map(voice => sanitizeFmDrumVoice(voice)),
  };
  validateRubixFullPreset(snapshot);
  return { id, label, description: `${size}×${size} ${shapeId}, ${readingMode} read path, ${snapshot.settings.soundBank}, ${snapshot.settings.tempo} BPM; complete score, camera and sounds. Audio/Play stay yours.`, snapshot };
}
export const RUBIX_FULL_PRESETS = Object.freeze([
  ...Object.values(RUBIX_FACTORY_PRESETS).map(p => fullScene(p.id, p.label, p.shapeId, p.size, p.readingMode, p.settings)),
  fullScene("sweet-stella", "Stella · Sweet bells", "stella", 3, "snake",
    { tempo: 76, swing: 0.1, soundBank: "modal", drumLevel: 0.4, output: 0.44, randomTwists: false }, 5, 1),
  fullScene("acid-diamond", "Diamond · Acid conversation", "diamond", 3, "face",
    { tempo: 122, swing: 0.18, soundBank: "acid-303", cutoff: 750, resonance: 9, drive: 1.4, acidDecay: 0.28, acidLevel: 0.45, output: 0.45 }, 9, 3),
  fullScene("half-time-orb", "Orb · Half-time pocket", "orb", 4, "snake",
    { tempo: 62, swing: 0.23, soundBank: "analog", drumLevel: 0.45, output: 0.43 }, 7, 4, { x: -26, y: 52, z: 8 }),
  fullScene("tiny-machine", "Two by two · Fast machine", "cube", 2, "parallel",
    { tempo: 228, swing: 0, soundBank: "soft-fm", drumLevel: 0.4, output: 0.42 }, 11, 2),
  fullScene("acid-saw", "Morphix · Nasty acid saw", "morphix", 4, "snake",
    { tempo: 158, swing: 0.07, soundBank: "acid-303", cutoff: 2100, resonance: 14, drive: 4, acidDecay: 0.12, acidLevel: 0.34, output: 0.4 }, 13, 1),
  fullScene("six-layer-noise", "Six layers · Broken rain", "cube", 6, "face",
    { tempo: 94, swing: 0.28, soundBank: "noise", drumLevel: 0.3, output: 0.38, visibilityDynamics: 0.95 }, 15, 5),
  fullScene("reverse-view", "Diamond · Other side", "diamond", 3, "parallel",
    { tempo: 136, swing: 0.14, soundBank: "modal", drumLevel: 0.46, output: 0.43 }, 8, 2, { x: 25, y: -110, z: -12 }),
]);

export function validateRubixFullPreset(snapshot) {
  presetStateKey(snapshot);
  const { settings: s, cube, camera, drumVoices } = snapshot;
  if (!s || Object.keys(s).length !== RUBIX_PRESET_SETTING_KEYS.length
    || RUBIX_PRESET_SETTING_KEYS.some(key => !Object.hasOwn(s, key))) throw new TypeError("Incomplete Rubix settings");
  for (const [key, [min, max]] of Object.entries(numeric)) if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw new TypeError(`Invalid Rubix ${key}`);
  if (!banks.includes(s.soundBank) || !["web-audio", "simd-303"].includes(s.acidEngine) || typeof s.randomTwists !== "boolean"
    || !RUBIX_SIMD_PRESETS.some(preset => preset.id === s.simdPreset) || typeof s.simdPresetCustom !== "boolean"
    || !shapes.includes(snapshot.shapeId) || !["parallel", "snake", "face"].includes(snapshot.readingMode)) throw new TypeError("Invalid Rubix choices");
  if (!cube || !Number.isInteger(cube.size) || cube.size < 2 || cube.size > 6 || cube.stickers?.length !== 6 * cube.size ** 2
    || new Set(cube.stickers.map(sticker => sticker.id)).size !== cube.stickers.length) throw new TypeError("Invalid complete Rubix score");
  const layers = rubixLayersForSize(cube.size);
  for (const sticker of cube.stickers) {
    if (!["x", "y", "z"].every(axis => layers.includes(sticker.position?.[axis]) && [-1, 0, 1].includes(sticker.normal?.[axis]))
      || Object.values(sticker.normal).reduce((sum, value) => sum + Math.abs(value), 0) !== 1) throw new TypeError("Invalid Rubix sticker");
  }
  if (!camera || !["x", "y", "z"].every(axis => Number.isFinite(camera[axis]))) throw new TypeError("Invalid Rubix camera");
  if (!Array.isArray(drumVoices) || drumVoices.length !== DEFAULT_FM_DRUM_VOICES.length
    || drumVoices.some(voice => presetStateKey(sanitizeFmDrumVoice(voice)) !== presetStateKey(voice))) throw new TypeError("Invalid Rubix drum bank");
  createRubixSequenceSnapshot(cube, camera);
  return snapshot;
}
export function randomizeRubixPreset(current, random = Math.random) {
  const rng = presetRandom(random), size = rng.integer(2, 4);
  let cube = createSolvedRubixCube(size);
  const layers = rubixLayersForSize(size);
  for (let i = 0; i < 16; i++) cube = turnRubixLayer(cube, { axis: rng.pick(["x", "y", "z"]), layer: rng.pick(layers), direction: rng.pick([-1, 1]) });
  // Backend acquisition stays an explicit device action. Roll all portable
  // musical controls; keep a requested GPU backend only if already selected.
  const s = { ...randomParameterValues({
    ...numeric, tempo: [64, 210], cutoff: [220, 2800], resonance: [2, 14], drive: [0.7, 3.5],
    randomTwistSpeed: [15, 60],
  }, rng), acidEngine: current.settings.acidEngine,
  simdPreset: rng.pick(RUBIX_SIMD_PRESETS).id, simdPresetCustom: true,
  soundBank: rng.pick(banks), randomTwists: rng.pick([true, false]) };
  return validateRubixFullPreset({
    settings: s, cube: clonePresetData(cube), shapeId: rng.pick(shapes), readingMode: rng.pick(["parallel", "snake", "face"]),
    camera: { x: rng.between(-55, 55), y: rng.between(-180, 180), z: rng.between(-25, 25) },
    // Modify only the in-memory copies; never write over the user's saved bank.
    drumVoices: current.drumVoices.map(voice => sanitizeFmDrumVoice({
      ...voice, ...randomParameterValues({
        frequency: voice.family === "hat" ? [2400, 6200] : voice.family === "kick" ? [40, 110] : [90, 1200],
        attack: [0.008, 0.028], decay: [0.08, 0.7], modRatio: [0.5, 5], modIndex: [0, 8],
        pitchBend: [-0.25, 2], noise: [0, 0.4], tone: [0.15, 0.85], level: [0.2, 0.6],
      }, rng),
    })),
  });
}
