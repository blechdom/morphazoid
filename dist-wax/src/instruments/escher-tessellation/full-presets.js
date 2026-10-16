import { ESCHER_TESSELLATION_PALETTES, ESCHER_TESSELLATION_PRESETS, escherTessellationPreset } from "./escher-tessellation.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const ESCHER_PLAYBACK_MODES = Object.freeze(["shape", "neighbors", "pattern"]);
const STRUCTURE_IDS = ESCHER_TESSELLATION_PRESETS.map(preset => preset.id);
const PALETTE_IDS = ESCHER_TESSELLATION_PALETTES.map(palette => palette.id);
const SPECS = Object.freeze({
  density: [0, 1, 0.01], deformation: [0, 1, 0.01], rotation: [-180, 180, 1], detail: [0, 1, 0.01], contrast: [0.2, 1, 0.01],
  travelSpeed: [0.08, 1.2, 0.01], neighborReach: [1, 4, 1], playheadSize: [0.2, 1, 0.01],
  baseFrequency: [36, 220, 0.5], tone: [0, 1, 0.01], pitchSpan: [0, 24, 1], timbreMotion: [0, 1, 0.01], stereoWidth: [0, 1, 0.01],
  orientationDepth: [0, 1, 0.01], colorAspectDepth: [0, 1, 0.01], positionDepth: [0, 1, 0.01], edgeArticulation: [0, 1, 0.01],
});
export const ESCHER_NUMERIC_KEYS = Object.freeze(Object.keys(SPECS));
export const ESCHER_PRESET_KEYS = Object.freeze(["presetId", "paletteId", "playbackMode", "showGeometry", "showOutlines", ...ESCHER_NUMERIC_KEYS]);

const snap = (key, value) => {
  const [min, max, step] = SPECS[key];
  const number = Number.isFinite(Number(value)) ? Number(value) : min;
  return Number((Math.round((Math.min(max, Math.max(min, number)) - min) / step) * step + min).toFixed(4));
};

function normalize(values) {
  return {
    presetId: STRUCTURE_IDS.includes(values.presetId) ? values.presetId : STRUCTURE_IDS[0],
    paletteId: PALETTE_IDS.includes(values.paletteId) ? values.paletteId : PALETTE_IDS[0],
    playbackMode: ESCHER_PLAYBACK_MODES.includes(values.playbackMode) ? values.playbackMode : "shape",
    showGeometry: values.showGeometry === true, showOutlines: values.showOutlines === true,
    ...Object.fromEntries(ESCHER_NUMERIC_KEYS.map(key => [key, snap(key, values[key])])),
  };
}

export function captureEscherPreset(state) {
  return normalize(state);
}

export function validateEscherPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== ESCHER_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(normalize(snapshot))) {
    throw new TypeError("Invalid complete Escher Tessellation preset");
  }
  return snapshot;
}

export function applyEscherPreset(state, snapshot) {
  validateEscherPreset(snapshot);
  const structureChanged = state.presetId !== snapshot.presetId;
  Object.assign(state, snapshot);
  return { structureChanged };
}

const BASE = {
  presetId: "counterform-current", paletteId: "day-night", playbackMode: "shape", showGeometry: true, showOutlines: true,
  density: 0.54, deformation: 0.72, rotation: 0, detail: 0.78, contrast: 0.76, travelSpeed: 0.32, neighborReach: 2, playheadSize: 0.65,
  baseFrequency: 82.5, tone: 0.58, pitchSpan: 14, timbreMotion: 0.72, stereoWidth: 0.82,
  orientationDepth: 0.68, colorAspectDepth: 0.76, positionDepth: 0.64, edgeArticulation: 0.72,
};
const scene = (id, label, changes) => Object.freeze({ id, label, snapshot: Object.freeze(normalize({ ...BASE, ...changes })) });
const structure = id => ({ presetId: id, paletteId: escherTessellationPreset(id).palette });

export const ESCHER_FULL_PRESETS = Object.freeze([
  scene("counterform-current", "Counterform current", {}),
  scene("night-flight", "Night flight", { ...structure("night-flight"), playbackMode: "neighbors", neighborReach: 3, baseFrequency: 110, pitchSpan: 19, tone: 0.45, travelSpeed: 0.5, density: 0.62 }),
  scene("triple-orbit", "Triple orbit", { ...structure("triple-orbit"), playbackMode: "pattern", baseFrequency: 98, pitchSpan: 12, timbreMotion: 0.9, edgeArticulation: 0.9, travelSpeed: 0.42, rotation: 30 }),
  scene("glide-parade", "Glide parade", { ...structure("glide-parade"), playbackMode: "neighbors", neighborReach: 4, baseFrequency: 130.5, pitchSpan: 7, tone: 0.7, travelSpeed: 0.8, stereoWidth: 1, density: 0.7 }),
  scene("metamorphosis-band", "Metamorphosis band", { ...structure("metamorphosis-band"), baseFrequency: 73.5, pitchSpan: 22, timbreMotion: 1, orientationDepth: 0.95, travelSpeed: 0.2, deformation: 0.95, detail: 0.92 }),
  scene("inward-infinity", "Inward infinity", { ...structure("inward-infinity"), baseFrequency: 55, pitchSpan: 24, tone: 0.3, travelSpeed: 0.12, positionDepth: 1, density: 0.8, rotation: -45 }),
  scene("hyperbolic-current", "Hyperbolic current", { ...structure("hyperbolic-current"), playbackMode: "pattern", baseFrequency: 164.5, pitchSpan: 10, tone: 0.8, travelSpeed: 0.6, colorAspectDepth: 1, density: 0.5 }),
  scene("dual-horizon", "Dual horizon", { ...structure("dual-horizon"), playbackMode: "neighbors", neighborReach: 2, baseFrequency: 90, pitchSpan: 16, tone: 0.35, timbreMotion: 0.4, travelSpeed: 0.28, rotation: 90, contrast: 0.9 }),
  scene("sky-water-bass", "Sky and water bass", { ...structure("counterform-current"), paletteId: "mineral", playbackMode: "neighbors", baseFrequency: 38, pitchSpan: 5, tone: 0.2, timbreMotion: 0.3, stereoWidth: 0.35, travelSpeed: 0.18, density: 0.3, deformation: 0.4 }),
  scene("reptile-march", "Reptile march", { ...structure("triple-orbit"), paletteId: "woodcut", playbackMode: "pattern", baseFrequency: 146.5, pitchSpan: 9, tone: 0.9, travelSpeed: 1.1, edgeArticulation: 1, orientationDepth: 0.3, density: 0.85, showGeometry: false }),
  scene("circle-limit-glass", "Circle limit glass", { ...structure("hyperbolic-current"), paletteId: "alhambra", baseFrequency: 208, pitchSpan: 3, tone: 1, timbreMotion: 0.15, stereoWidth: 0.9, travelSpeed: 0.38, density: 0.9, detail: 0.4, showOutlines: false }),
  scene("infinity-drone", "Infinity drone", { ...structure("inward-infinity"), paletteId: "day-night", playbackMode: "shape", baseFrequency: 41.5, pitchSpan: 2, tone: 0.1, timbreMotion: 0.55, stereoWidth: 0.6, travelSpeed: 0.08, positionDepth: 0.2, density: 0.35, contrast: 0.5 }),
]);

export function randomizeEscherPreset(current, random = Math.random) {
  validateEscherPreset(current);
  const rng = presetRandom(random);
  const values = {
    presetId: rng.pick(STRUCTURE_IDS), paletteId: rng.pick(PALETTE_IDS), playbackMode: rng.pick(ESCHER_PLAYBACK_MODES),
    showGeometry: rng.unit() < 0.7, showOutlines: rng.unit() < 0.8,
  };
  for (const key of ESCHER_NUMERIC_KEYS) {
    const [min, max] = SPECS[key];
    values[key] = key === "baseFrequency" ? 36 * (220 / 36) ** rng.unit()
      : key === "travelSpeed" ? 0.08 + rng.unit() ** 1.5 * 1.12 : rng.between(min, max);
  }
  return validateEscherPreset(normalize(values));
}
