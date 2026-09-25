import { RUBIX_TWIST_SPEED_DEFAULT_POSITION } from "./rubix.js";
import { rubixSimdPreset, DEFAULT_RUBIX_SIMD_PRESET } from "./rubix-simd-presets.js";
const DEFAULT_ACID_ENGINE = "simd-303";
const DEFAULT_STICKER_MODULATION = 0.68;
export const RUBIX_DEFAULTS = Object.freeze({
  ...rubixSimdPreset().controls,
  tempo: 126,
  swing: 0,
  acidLevel: 0.58,
  drumLevel: 0.54,
  soundBank: "soft-fm",
  acidEngine: DEFAULT_ACID_ENGINE,
  simdPreset: DEFAULT_RUBIX_SIMD_PRESET,
  simdPresetCustom: false,
  stickerModulation: DEFAULT_STICKER_MODULATION,
  visibilityDynamics: 1,
  output: 0.56,
  randomTwists: false,
  randomTwistSpeed: RUBIX_TWIST_SPEED_DEFAULT_POSITION,
});
const DEFAULTS = RUBIX_DEFAULTS;
export const RUBIX_FACTORY_PRESETS = Object.freeze({
  classic: Object.freeze({
    id: "classic",
    label: "Classic cube",
    shapeId: "cube",
    size: 3,
    readingMode: "parallel",
    settings: Object.freeze({ ...DEFAULTS, soundBank: "soft-fm" }),
  }),
  "pocket-funk": Object.freeze({
    id: "pocket-funk",
    label: "Pocket funk",
    shapeId: "cube",
    size: 2,
    readingMode: "snake",
    settings: Object.freeze({
      tempo: 108, swing: 0.16, visibilityDynamics: 1,
      cutoff: 720, resonance: 8.8, acidDecay: 0.24, drive: 1.6,
      soundBank: "analog", randomTwists: true, randomTwistSpeed: 48,
    }),
  }),
  "modal-sphere": Object.freeze({
    id: "modal-sphere",
    label: "Modal orb",
    shapeId: "orb",
    size: 3,
    readingMode: "face",
    settings: Object.freeze({
      tempo: 112, swing: 0.2, visibilityDynamics: 1,
      cutoff: 620, resonance: 7.5, acidDecay: 0.28, drive: 1.35,
      soundBank: "modal", randomTwists: true, randomTwistSpeed: 42,
    }),
  }),
  "noise-grid": Object.freeze({
    id: "noise-grid",
    label: "Noise grid",
    shapeId: "cube",
    size: 4,
    readingMode: "face",
    settings: Object.freeze({
      tempo: 138, swing: 0.04, visibilityDynamics: 1,
      cutoff: 1860, resonance: 9, acidDecay: 0.11, drive: 1.7,
      soundBank: "noise", randomTwists: true, randomTwistSpeed: 70,
    }),
  }),
  "pyramid-drift": Object.freeze({
    id: "pyramid-drift",
    label: "Morphix drift",
    shapeId: "morphix",
    size: 3,
    readingMode: "snake",
    settings: Object.freeze({
      ...rubixSimdPreset("morphix-bloom").controls,
      tempo: 94, swing: 0.12, visibilityDynamics: 1,
      soundBank: "acid-303", acidEngine: "simd-303", simdPreset: "morphix-bloom",
      randomTwists: true, randomTwistSpeed: 32,
    }),
  }),
});
