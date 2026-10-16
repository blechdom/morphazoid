import { tilingInfo } from "../lattice/lattice.js";
import { canonicalTileForm, choice, q, randomTileForm } from "../lattice/tile-form-presets.js";
import { SPIRAL_DRUM_MAPPING_MODES } from "./spiral-drum-machine.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const SPIRAL_DRUM_PRESET_KEYS = Object.freeze([
  "tilingType", "parameters", "edgeCurves", "spiralA", "spiralB", "patternScale", "patternRotation", "timePath",
  "speed", "traversalDirection", "motionMode", "loopSpeed", "loopDirection", "readerTurns", "sizeCoupling",
  "mappingMode", "pitchDepth", "characterDepth", "strikeLimit",
]);
const MAPPING_IDS = SPIRAL_DRUM_MAPPING_MODES.map(mode => mode.id);
const TIME_PATHS = ["radius", "angle", "spiral"];
const MOTIONS = ["loop", "pingpong"];
const sign = value => (value < 0 ? -1 : 1);

export function captureSpiralDrumPreset(source) {
  const info = tilingInfo(source?.tilingType);
  let spiralA = q(source?.spiralA, 1, 0, 12);
  let spiralB = q(source?.spiralB, 1, 0, 12);
  if (spiralA === 0 && spiralB === 0) spiralB = 1;
  return {
    tilingType: info.type,
    ...canonicalTileForm(info.type, source?.parameters, source?.edgeCurves),
    spiralA, spiralB,
    patternScale: q(source?.patternScale, .01, -1.2, 1.2),
    patternRotation: q(source?.patternRotation, 1, -180, 180),
    timePath: choice(source?.timePath, TIME_PATHS, "radius"),
    speed: q(source?.speed, .001, .01, 1),
    traversalDirection: sign(source?.traversalDirection),
    motionMode: choice(source?.motionMode, MOTIONS, "loop"),
    loopSpeed: q(source?.loopSpeed, .001, .01, 1),
    loopDirection: sign(source?.loopDirection),
    readerTurns: q(source?.readerTurns, .05, .25, 6),
    sizeCoupling: source?.sizeCoupling === true,
    mappingMode: choice(source?.mappingMode, MAPPING_IDS, "radius-angle"),
    pitchDepth: q(source?.pitchDepth, 1, 0, 24),
    characterDepth: q(source?.characterDepth, .01, 0, 1),
    strikeLimit: q(source?.strikeLimit, 1, 1, 16),
  };
}

export function validateSpiralDrumPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || presetStateKey(snapshot) !== presetStateKey(captureSpiralDrumPreset(snapshot))) {
    throw new TypeError("Invalid complete Spiral Drum Machine preset");
  }
  return snapshot;
}

const BASE = {
  spiralA: 1, spiralB: 5, patternScale: 0, patternRotation: 0, timePath: "radius", speed: .12, traversalDirection: 1,
  motionMode: "loop", loopSpeed: .05, loopDirection: 1, readerTurns: 2, sizeCoupling: false,
  mappingMode: "radius-angle", pitchDepth: 12, characterDepth: .7, strikeLimit: 6,
};
const scene = (id, label, tilingType, form, values) => {
  const info = tilingInfo(tilingType);
  const parameters = info.defaultParameters.map((value, index) => value + (form.shape?.[index] ?? 0));
  const snapshot = captureSpiralDrumPreset({ ...BASE, ...values, tilingType, parameters, edgeCurves: form.bend ?? [] });
  Object.freeze(snapshot.parameters); Object.freeze(snapshot.edgeCurves);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const SPIRAL_DRUM_FULL_PRESETS = Object.freeze([
  scene("factory", "Factory spiral", 20, {}, {}),
  scene("tight-whorl", "Tight whorl", 4, { shape: [.1, -.08, .1, 0, 0, .05] }, {
    spiralA: 3, spiralB: 8, patternScale: .35, patternRotation: 25, timePath: "spiral", speed: .22, readerTurns: 3.5,
    mappingMode: "shape-angle", pitchDepth: 9, characterDepth: .5, strikeLimit: 10,
  }),
  scene("slow-bloom", "Slow bloom", 22, { bend: [.4, -.3, 0, .5] }, {
    spiralA: 1, spiralB: 2, patternScale: -.6, patternRotation: -40, speed: .04, loopSpeed: .02, loopDirection: -1,
    mappingMode: "reader-incidence", pitchDepth: 20, characterDepth: .9, strikeLimit: 4,
  }),
  scene("galaxy-arm", "Galaxy arm", 77, { bend: [.6, -.2] }, {
    spiralA: 0, spiralB: 7, patternScale: .8, patternRotation: 90, timePath: "angle", speed: .3, traversalDirection: -1,
    motionMode: "pingpong", loopSpeed: .12, mappingMode: "radius-angle", pitchDepth: 6, characterDepth: .6, strikeLimit: 8,
  }),
  scene("sized-pulse", "Size-driven pulse", 49, {}, {
    spiralA: 2, spiralB: 3, patternScale: .1, timePath: "radius", speed: .35, sizeCoupling: true,
    mappingMode: "shape-angle", pitchDepth: 14, characterDepth: .4, strikeLimit: 6,
  }),
  scene("outward-ring", "Outward ring", 36, { bend: [0, .5] }, {
    spiralA: 5, spiralB: 0, patternScale: -1, patternRotation: 150, timePath: "angle", speed: .18, traversalDirection: -1,
    readerTurns: 1, mappingMode: "radius-angle", pitchDepth: 3, characterDepth: .85, strikeLimit: 12,
  }),
  scene("wide-unwind", "Wide unwind", 26, { shape: [.14, -.1, .1], bend: [.6, 0, 0] }, {
    spiralA: 4, spiralB: 11, patternScale: .5, patternRotation: -120, timePath: "spiral", speed: .08, motionMode: "pingpong",
    loopSpeed: .3, readerTurns: 5.5, mappingMode: "reader-incidence", pitchDepth: 16, characterDepth: .3, strikeLimit: 5,
  }),
  scene("dense-vortex", "Dense vortex", 71, {}, {
    spiralA: 9, spiralB: 12, patternScale: 1, patternRotation: 60, timePath: "spiral", speed: .65, loopSpeed: .55,
    readerTurns: .75, mappingMode: "radius-angle", pitchDepth: 1, characterDepth: 1, strikeLimit: 16,
  }),
  scene("glass-conch", "Glass conch", 7, { shape: [.12, -.1], bend: [-.5, .6, -.2] }, {
    spiralA: 1, spiralB: 1, patternScale: -.3, patternRotation: 180, timePath: "radius", speed: .05, loopSpeed: .01,
    sizeCoupling: true, mappingMode: "shape-angle", pitchDepth: 24, characterDepth: .2, strikeLimit: 3,
  }),
  scene("counter-sweep", "Counter sweep", 44, { shape: [-.1, .1, -.1, .1] }, {
    spiralA: 6, spiralB: 2, patternScale: .2, patternRotation: -75, timePath: "angle", speed: .45, traversalDirection: -1,
    loopDirection: -1, loopSpeed: .25, mappingMode: "reader-incidence", pitchDepth: 10, characterDepth: .55, strikeLimit: 9,
  }),
  scene("ticker-coil", "Ticker coil", 13, { shape: [.1, .1, -.1], bend: [.3, -.6, .6] }, {
    spiralA: 7, spiralB: 4, patternScale: .65, patternRotation: 15, timePath: "spiral", speed: .9, motionMode: "pingpong",
    readerTurns: 1.25, mappingMode: "shape-angle", pitchDepth: 5, characterDepth: .75, strikeLimit: 14,
  }),
  scene("deep-well", "Deep well", 46, { shape: [.2, -.15, .1], bend: [.8, -.8, .5, -.5] }, {
    spiralA: 2, spiralB: 9, patternScale: -.9, patternRotation: 45, timePath: "radius", speed: .02, loopSpeed: .08,
    traversalDirection: -1, mappingMode: "radius-angle", pitchDepth: 22, characterDepth: .95, strikeLimit: 2,
  }),
  scene("quiet-sundial", "Quiet sundial", 20, { bend: [.2, 0, 0] }, {
    spiralA: 12, spiralB: 1, patternScale: .05, patternRotation: -10, timePath: "angle", speed: .1, loopSpeed: .03,
    readerTurns: 2.5, mappingMode: "reader-incidence", pitchDepth: 12, characterDepth: .15, strikeLimit: 3,
  }),
]);

export function randomizeSpiralDrumPreset(current, random = Math.random) {
  validateSpiralDrumPreset(current);
  const rng = presetRandom(random);
  return validateSpiralDrumPreset(captureSpiralDrumPreset({
    ...randomTileForm(rng),
    spiralA: rng.integer(0, 12), spiralB: rng.integer(0, 12),
    patternScale: rng.between(-1.1, 1.1), patternRotation: rng.between(-180, 180),
    timePath: rng.pick(TIME_PATHS), speed: rng.between(.02, .9), traversalDirection: rng.pick([-1, 1]),
    motionMode: rng.pick(MOTIONS), loopSpeed: rng.between(.01, .7), loopDirection: rng.pick([-1, 1]),
    readerTurns: rng.between(.5, 5.5), sizeCoupling: rng.unit() < .35,
    mappingMode: rng.pick(MAPPING_IDS),
    pitchDepth: rng.between(0, 24), characterDepth: rng.between(0, 1), strikeLimit: rng.between(2, 14),
  }));
}
