import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const PENROSE_PRESET_PRESENTATIONS = Object.freeze(["p3", "pentagrid", "p2", "p1", "robinson"]);
export const PENROSE_PRESET_PALETTES = Object.freeze(["ultraviolet", "hot-orchid", "electric-rose", "plasma-violet"]);
export const PENROSE_PRESET_PITCH_SOURCES = Object.freeze(["family", "tile", "height", "along", "incidence"]);
export const PENROSE_PRESET_ENGINES = Object.freeze(["sine", "fm-perc"]);
export const PENROSE_PRESET_TOGGLES = Object.freeze(["showTriangles", "showHierarchy", "showDirections", "showOutlines", "showPaths", "showLookahead"]);
const SEAMLESS = new Set(["p3", "pentagrid", "p2", "robinson"]);
const SPECS = Object.freeze({
  generation: [1, 7, 1], variation: [0, 63, 1], orientation: [0, 324, 36], angleWarp: [-0.45, 0.45, 0.01],
  colorEnergy: [0.35, 1, 0.01], speed: [0.01, 0.3, 0.001], baseFrequency: [36, 220, 0.5], pitchRange: [0, 36, 1],
  decay: [35, 900, 5], pathLevel: [0, 1, 0.01], pathVoiceCap: [1, 16, 1], fmRatio: [0.5, 8, 0.05], fmIndex: [0, 18, 0.1],
});
export const PENROSE_NUMERIC_KEYS = Object.freeze(Object.keys(SPECS));
export const PENROSE_PRESET_KEYS = Object.freeze([
  "presentation", "coverage", "palette", "pitchSource", "soundEngine", ...PENROSE_PRESET_TOGGLES, ...PENROSE_NUMERIC_KEYS,
]);

const snap = (key, value) => {
  const [min, max, step] = SPECS[key];
  const number = Number.isFinite(Number(value)) ? Number(value) : min;
  return Number((Math.round((Math.min(max, Math.max(min, number)) - min) / step) * step + min).toFixed(4));
};
const oneOf = (list, value, fallback = list[0]) => (list.includes(value) ? value : fallback);

function normalize(values) {
  const presentation = oneOf(PENROSE_PRESET_PRESENTATIONS, values.presentation);
  const coverage = values.coverage === "infinite" && SEAMLESS.has(presentation) ? "infinite" : "patch";
  return {
    presentation, coverage, palette: oneOf(PENROSE_PRESET_PALETTES, values.palette),
    pitchSource: oneOf(PENROSE_PRESET_PITCH_SOURCES, values.pitchSource), soundEngine: oneOf(PENROSE_PRESET_ENGINES, values.soundEngine),
    ...Object.fromEntries(PENROSE_PRESET_TOGGLES.map(key => [key, key === "showHierarchy" ? values[key] === true && coverage === "patch" : values[key] === true])),
    ...Object.fromEntries(PENROSE_NUMERIC_KEYS.map(key => [key, snap(key, values[key])])),
  };
}

export function capturePenrosePreset(state) {
  return normalize(state);
}

export function validatePenrosePreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== PENROSE_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(normalize(snapshot))) {
    throw new TypeError("Invalid complete Penrose Tilings preset");
  }
  return snapshot;
}

export function applyPenrosePreset(state, snapshot) {
  validatePenrosePreset(snapshot);
  const geometryChanged = ["presentation", "coverage", "generation", "variation"].some(key => state[key] !== snapshot[key]);
  Object.assign(state, snapshot);
  return { geometryChanged };
}

const BASE = {
  presentation: "p3", coverage: "infinite", palette: "ultraviolet", pitchSource: "along", soundEngine: "sine",
  showTriangles: false, showHierarchy: false, showDirections: true, showOutlines: false, showPaths: true, showLookahead: true,
  generation: 6, variation: 0, orientation: 0, angleWarp: 0, colorEnergy: 0.78, speed: 0.06, baseFrequency: 82.5, pitchRange: 19,
  decay: 180, pathLevel: 0.38, pathVoiceCap: 10, fmRatio: 2, fmIndex: 5,
};
const scene = (id, label, changes) => Object.freeze({ id, label, snapshot: Object.freeze(normalize({ ...BASE, ...changes })) });

export const PENROSE_FULL_PRESETS = Object.freeze([
  scene("cartwheel-drift", "Cartwheel drift", {}),
  scene("pentagrid-glass", "Pentagrid glass", { presentation: "pentagrid", variation: 21, palette: "hot-orchid", soundEngine: "fm-perc", fmRatio: 3.5, fmIndex: 8, pitchSource: "height", baseFrequency: 165, decay: 120, speed: 0.08 }),
  scene("kite-dart-bells", "Kite and dart bells", { presentation: "p2", generation: 5, palette: "electric-rose", soundEngine: "fm-perc", fmRatio: 1.5, fmIndex: 11, pitchSource: "tile", baseFrequency: 220, decay: 500, pitchRange: 14 }),
  scene("robinson-halves", "Robinson halves", { presentation: "robinson", coverage: "patch", generation: 4, showTriangles: true, showHierarchy: true, pitchSource: "family", baseFrequency: 110, pitchRange: 12, speed: 0.04 }),
  scene("pentagonal-star", "Pentagonal star", { presentation: "p1", coverage: "patch", generation: 3, palette: "plasma-violet", showHierarchy: true, showOutlines: true, pathVoiceCap: 16, pitchRange: 36, baseFrequency: 73.5, pitchSource: "incidence" }),
  scene("sheared-cartwheel", "Sheared cartwheel", { angleWarp: 0.3, orientation: 144, baseFrequency: 55, pitchRange: 12, speed: 0.12, palette: "electric-rose", pathLevel: 0.55 }),
  scene("slow-drone-field", "Slow drone field", { presentation: "pentagrid", variation: 63, orientation: 72, speed: 0.01, pathLevel: 0.85, pathVoiceCap: 4, baseFrequency: 41.5, pitchRange: 7, colorEnergy: 0.5, showPaths: false }),
  scene("fast-rain", "Fast rain", { speed: 0.3, soundEngine: "fm-perc", decay: 40, fmIndex: 2, fmRatio: 6, pitchRange: 30, baseFrequency: 200, pitchSource: "incidence", palette: "hot-orchid", colorEnergy: 1 }),
  scene("wide-chord", "Wide chord", { pathVoiceCap: 16, pathLevel: 0.6, pitchRange: 24, pitchSource: "family", palette: "plasma-violet", baseFrequency: 98, orientation: 216, variation: 9 }),
  scene("low-thud", "Low thud", { presentation: "p2", soundEngine: "fm-perc", fmRatio: 0.5, fmIndex: 14, decay: 900, baseFrequency: 36, pitchRange: 3, pitchSource: "height", speed: 0.05, orientation: 108 }),
  scene("outlined-patch", "Outlined patch", { coverage: "patch", generation: 7, variation: 40, showOutlines: true, showDirections: false, showLookahead: false, palette: "hot-orchid", colorEnergy: 0.6, baseFrequency: 123.5, pitchRange: 17 }),
  scene("bright-shear", "Bright shear", { presentation: "p2", angleWarp: -0.4, orientation: 216, soundEngine: "fm-perc", fmRatio: 4.05, fmIndex: 7.5, baseFrequency: 146.5, speed: 0.09, decay: 260, pitchSource: "along", variation: 33, palette: "ultraviolet" }),
]);

export function randomizePenrosePreset(current, random = Math.random) {
  validatePenrosePreset(current);
  const rng = presetRandom(random);
  const presentation = rng.pick(PENROSE_PRESET_PRESENTATIONS);
  const values = {
    presentation, coverage: SEAMLESS.has(presentation) && rng.unit() < 0.7 ? "infinite" : "patch",
    palette: rng.pick(PENROSE_PRESET_PALETTES), pitchSource: rng.pick(PENROSE_PRESET_PITCH_SOURCES), soundEngine: rng.pick(PENROSE_PRESET_ENGINES),
  };
  for (const key of PENROSE_PRESET_TOGGLES) values[key] = rng.unit() < (key === "showTriangles" || key === "showOutlines" ? 0.3 : 0.65);
  for (const key of PENROSE_NUMERIC_KEYS) {
    const [min, max] = SPECS[key];
    values[key] = key === "baseFrequency" ? 36 * (220 / 36) ** rng.unit()
      : key === "speed" ? 0.01 + rng.unit() ** 2 * 0.29 : rng.between(min, max);
  }
  return validatePenrosePreset(normalize(values));
}
