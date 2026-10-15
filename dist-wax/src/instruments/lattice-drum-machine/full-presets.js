import { tilingInfo } from "../lattice/lattice.js";
import { canonicalTileForm, choice, q, randomTileForm } from "../lattice/tile-form-presets.js";
import { LATTICE_DRUM_MAPPING_MODES } from "./lattice-drum-machine.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const LATTICE_DRUM_PRESET_KEYS = Object.freeze([
  "tilingType", "parameters", "edgeCurves", "density", "patternAngle", "lineAngle", "traversalDirection",
  "motionMode", "speed", "mappingMode", "drumEngine", "pitchDepth", "characterDepth", "strikeLimit",
]);
const MAPPING_IDS = LATTICE_DRUM_MAPPING_MODES.map(mode => mode.id);
const ENGINES = ["fm", "samples"];
const MOTIONS = ["loop", "pingpong"];

export function captureLatticeDrumPreset(source) {
  const info = tilingInfo(source?.tilingType);
  return {
    tilingType: info.type,
    ...canonicalTileForm(info.type, source?.parameters, source?.edgeCurves),
    density: q(source?.density, .01, 0, .8),
    patternAngle: q(source?.patternAngle, .1, 0, 90),
    lineAngle: q(source?.lineAngle, .1, 0, 179.9),
    traversalDirection: source?.traversalDirection < 0 ? -1 : 1,
    motionMode: choice(source?.motionMode, MOTIONS, "loop"),
    speed: q(source?.speed, .005, .01, .8),
    mappingMode: choice(source?.mappingMode, MAPPING_IDS, "edge-angle"),
    drumEngine: choice(source?.drumEngine, ENGINES, "fm"),
    pitchDepth: q(source?.pitchDepth, 1, 0, 24),
    characterDepth: q(source?.characterDepth, .01, 0, 1),
    strikeLimit: q(source?.strikeLimit, 1, 1, 16),
  };
}

export function validateLatticeDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureLatticeDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete Lattice Drum Machine preset");
  }
  return snapshot;
}

const scene = (id, label, tilingType, form, values) => {
  const info = tilingInfo(tilingType);
  const parameters = info.defaultParameters.map((value, index) => value + (form.shape?.[index] ?? 0));
  const snapshot = captureLatticeDrumPreset({ traversalDirection: -1, motionMode: "loop", ...values, tilingType, parameters, edgeCurves: form.bend ?? [] });
  Object.freeze(snapshot.parameters); Object.freeze(snapshot.edgeCurves);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const LATTICE_DRUM_FULL_PRESETS = Object.freeze([
  scene("factory", "Factory pentagon", 20, {}, {
    density: .52, patternAngle: 0, lineAngle: 90, speed: .36, mappingMode: "edge-angle", drumEngine: "fm", pitchDepth: 12, characterDepth: .7, strikeLimit: 6,
  }),
  scene("hex-sprawl", "Hex sprawl", 4, { shape: [.12, -.1, .08, 0, .1, -.06] }, {
    density: .28, patternAngle: 15, lineAngle: 60, speed: .2, mappingMode: "position-grid", pitchDepth: 7, characterDepth: .5, strikeLimit: 8,
  }),
  scene("triangle-chatter", "Triangle chatter", 77, { bend: [.55, -.35] }, {
    density: .72, patternAngle: 30, lineAngle: 135, speed: .6, mappingMode: "tile-color-pair", drumEngine: "samples", pitchDepth: 5, characterDepth: .85, strikeLimit: 10,
  }),
  scene("slow-curves", "Slow curves", 22, { bend: [.5, -.4, 0, .3] }, {
    density: .4, patternAngle: 8, lineAngle: 100, speed: .08, motionMode: "pingpong", mappingMode: "incidence-density", pitchDepth: 18, characterDepth: .9, strikeLimit: 4,
  }),
  scene("brick-walk", "Brick walk", 49, {}, {
    density: .62, patternAngle: 45, lineAngle: 0, speed: .45, mappingMode: "position-grid", drumEngine: "samples", pitchDepth: 3, characterDepth: .3, strikeLimit: 12,
  }),
  scene("rolling-pents", "Rolling pentagons", 26, { shape: [.15, -.12, .1], bend: [.7, 0, 0] }, {
    density: .46, patternAngle: 70, lineAngle: 20, traversalDirection: 1, speed: .3, mappingMode: "edge-angle", pitchDepth: 16, characterDepth: .6, strikeLimit: 5,
  }),
  scene("dense-grain", "Dense grain", 71, {}, {
    density: .8, patternAngle: 22, lineAngle: 90, speed: .75, mappingMode: "incidence-density", drumEngine: "samples", pitchDepth: 0, characterDepth: 1, strikeLimit: 16,
  }),
  scene("glacial-hex", "Glacial hexagons", 7, { shape: [.1, -.1], bend: [-.4, .6, -.2] }, {
    density: .1, patternAngle: 0, lineAngle: 90, speed: .03, motionMode: "pingpong", mappingMode: "tile-color-pair", pitchDepth: 24, characterDepth: .15, strikeLimit: 3,
  }),
  scene("diagonal-scan", "Diagonal scan", 44, { shape: [-.1, .1, -.1, .1] }, {
    density: .56, patternAngle: 90, lineAngle: 45, traversalDirection: 1, speed: .5, mappingMode: "edge-angle", drumEngine: "samples", pitchDepth: 10, characterDepth: .45, strikeLimit: 8,
  }),
  scene("warped-quads", "Warped quads", 46, { shape: [.2, -.15, .1], bend: [.8, -.8, .5, -.5] }, {
    density: .35, patternAngle: 60, lineAngle: 150, speed: .18, mappingMode: "position-grid", pitchDepth: 20, characterDepth: .8, strikeLimit: 6,
  }),
  scene("sparse-pulse", "Sparse pulse", 20, { bend: [.2, 0, 0] }, {
    density: .05, patternAngle: 0, lineAngle: 90, speed: .14, mappingMode: "edge-angle", pitchDepth: 12, characterDepth: .2, strikeLimit: 2,
  }),
  scene("pair-parade", "Pair parade", 36, { bend: [0, .6] }, {
    density: .66, patternAngle: 33, lineAngle: 120, speed: .42, motionMode: "pingpong", mappingMode: "tile-color-pair", pitchDepth: 8, characterDepth: .65, strikeLimit: 9,
  }),
  scene("tilted-weave", "Tilted weave", 13, { shape: [.1, .1, -.1], bend: [.3, -.6, .6] }, {
    density: .5, patternAngle: 12, lineAngle: 170, traversalDirection: 1, speed: .26, mappingMode: "incidence-density", drumEngine: "samples", pitchDepth: 14, characterDepth: .55, strikeLimit: 7,
  }),
]);

export function randomizeLatticeDrumPreset(current, random = Math.random) {
  validateLatticeDrumPreset(current);
  const rng = presetRandom(random);
  const form = randomTileForm(rng);
  return validateLatticeDrumPreset(captureLatticeDrumPreset({
    ...form,
    density: rng.between(.05, .78), patternAngle: rng.between(0, 90), lineAngle: rng.between(0, 179.9),
    traversalDirection: rng.pick([-1, 1]), motionMode: rng.pick(MOTIONS), speed: rng.between(.03, .75),
    mappingMode: rng.pick(MAPPING_IDS), drumEngine: rng.pick(ENGINES),
    pitchDepth: rng.between(0, 24), characterDepth: rng.between(0, 1), strikeLimit: rng.between(2, 14),
  }));
}
