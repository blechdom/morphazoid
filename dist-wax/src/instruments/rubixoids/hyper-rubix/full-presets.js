import { SEQUENCER_VOICES } from "../audio/sequencer-voice-renderer.js";
import { HYPER_RUBIX_PRESET_DEFAULTS as defaults } from "./preset-state.js";
import {
  createSolvedHyperRubix, createHyperRubixScramble, createSeededHyperRubixRandom, turnHyperRubixBoundaryCell,
  hyperRubixSizeMetrics, HYPER_RUBIX_CELL_ORDER, HYPER_RUBIX_SEQUENCE_PATTERNS,
  hyperRubixBoundaryCell,
} from "./hyper-rubix.js";
import { presetStateKey } from "../../../site/header-presets.js";
import { clonePresetData, presetRandom, randomParameterValues } from "../../../site/preset-random.js";

export const HYPER_RUBIX_PRESET_KEYS = Object.freeze(Object.keys(defaults).filter(key => !["puzzleSize", "rotation"].includes(key)));
const numeric = {
  tempo: [30, 300], swing: [0, 0.42], twistDensity: [0.25, 1], rotationSpeed: [0, 0.24],
  projectionDepth: [3.4, 7], cellSeparation: [0, 0.7], stickerScale: [0.36, 1], output: [0, 0.82],
  tone: [0, 1], decay: [0.02, 4], rattleLevel: [0, 0.8], shapeInfluence: [0, 2],
  pitchInfluence: [0, 2], filterInfluence: [0, 2], stereoInfluence: [0, 2], neighborResponse: [0, 2],
  wInfluence: [0, 2], disorderInfluence: [0, 2], topologyLevel: [0, 0.8], topologySpan: [0, 24],
  topologyStrum: [0, 0.08], topologyRing: [0.02, 4], topologyWarp: [0, 2],
  cameraPitch: [-90, 90], cameraYaw: [-180, 180], cameraRoll: [-180, 180],
};
const choices = {
  selectedCell: HYPER_RUBIX_CELL_ORDER, selectedPlane: ["xy", "xz", "xw", "yz", "yw", "zw"],
  dragMode: ["orbit", "fold"], subdivisionsPerBeat: [1, 2, 4, 8, 16],
  sequenceMethod: ["twist-tape", "sticker-hyperbar", "hybrid-coil", "sticker-stream", "corner-stream"],
  twistMotion: ["auto", "beat", "bar", "off"], patternId: Object.keys(HYPER_RUBIX_SEQUENCE_PATTERNS),
  playbackMode: ["forward", "reverse", "pendulum", "random"], voice: [...SEQUENCER_VOICES.map(({ id }) => `shared-${id}`), "pulse", "glass", "dust", "rattlesnake", "webgpu-303"],
  playbackPreset: ["view-facing", "selected-cell", "whole-shape"], decayLink: ["linked", "independent"],
  rattleRate: [2, 4, 8], topologyMode: ["mesh", "cohesion", "faults", "off"],
};
function puzzleFor(size, turns, seed) {
  return createHyperRubixScramble(turns, createSeededHyperRubixRandom(seed))
    .reduce((puzzle, move) => turnHyperRubixBoundaryCell(puzzle, move), createSolvedHyperRubix(size));
}
function scene(id, label, settings, size = 3, turns = 0, seed = 1, gateStride = 0) {
  const p = { ...defaults, ...settings };
  const planes = hyperRubixBoundaryCell(p.selectedCell).tangentPlanes;
  if (!planes.includes(p.selectedPlane)) p.selectedPlane = planes[0];
  const puzzle = puzzleFor(size, turns, seed);
  return { id, label, description: `${label}: complete puzzle, ${p.voice} voice, ${p.playbackPreset} scope, ${p.tempo} BPM and topology sound. Audio/Play and live rotation phase are retained.`,
    snapshot: validateHyperRubixPreset({
      settings: Object.fromEntries(HYPER_RUBIX_PRESET_KEYS.map(key => [key, p[key]])), puzzle, sequenceGeneration: seed,
      gateOverrides: Object.fromEntries(puzzle.stickers.filter((_, index) => gateStride && index % gateStride === 0).map(sticker => [sticker.id, false])),
    }),
  };
}
export const HYPER_RUBIX_FULL_PRESETS = Object.freeze([
  scene("original-hyperkit", "Hyper kit · Original cube", {}, 3, 0, 0),
  scene("prism-lullaby", "Prism · Slow lanterns", { voice: "glass", tempo: 68, decay: 1.1, topologyRing: 1.1, tone: 0.38, subdivisionsPerBeat: 1, topologyMode: "cohesion", output: 0.4, autoRotate: true, rotationSpeed: 0.025 }, 2, 4, 12),
  scene("corner-club", "Corners · Tight club", { sequenceMethod: "corner-stream", tempo: 138, subdivisionsPerBeat: 4, decay: 0.12, topologyRing: 0.12, tone: 0.6, topologyLevel: 0.1, twistMotion: "bar", output: 0.42 }, 3, 8, 21),
  scene("bit-faults", "Bits · Broken fault lines", { voice: "dust", tempo: 122, swing: 0.19, playbackMode: "pendulum", topologyMode: "faults", topologyLevel: 0.2, topologyWarp: 1.5, output: 0.38 }, 3, 11, 23, 7),
  scene("single-cell-bell", "One cell · Glass reply", { voice: "glass", playbackPreset: "selected-cell", selectedCell: "y-", tempo: 86, sequenceMethod: "sticker-stream", subdivisionsPerBeat: 2, topologyMode: "off", tone: 0.48, output: 0.42 }, 2, 3, 41),
  scene("seed-shell", "Rattlesnake · Seed shell", { voice: "rattlesnake", rattleEnabled: true, rattleRate: 2, rattleLevel: 0.35, tempo: 104, decay: 0.3, topologyRing: 0.3, tone: 0.48, output: 0.4 }, 2, 7, 51),
  scene("w-swerve", "Fourth axis · W swerve", { patternId: "w-pressure", sequenceMethod: "twist-tape", tempo: 124, subdivisionsPerBeat: 2, twistMotion: "beat", wInfluence: 1.6, topologyStrum: 0.04, output: 0.4 }, 3, 5, 61),
  scene("whole-cloud", "Whole shape · Prism cloud", { voice: "glass", playbackPreset: "whole-shape", tempo: 58, subdivisionsPerBeat: 1, topologyLevel: 0.14, decay: 1.4, topologyRing: 1.4, autoRotate: true, rotationSpeed: 0.03, output: 0.34 }, 4, 9, 71, 5),
  scene("bit-sprint", "Bits · Virtuoso sprint", { voice: "dust", tempo: 210, subdivisionsPerBeat: 4, sequenceMethod: "corner-stream", decay: 0.07, topologyRing: 0.07, topologyMode: "off", output: 0.34 }, 2, 12, 81),
  scene("reverse-web", "Reverse · Ringing network", { voice: "glass", playbackMode: "reverse", tempo: 96, decayLink: "independent", decay: 0.25, topologyRing: 1.8, topologySpan: 19, topologyStrum: 0.055, output: 0.36 }, 3, 10, 91),
  scene("nasty-swarm", "Rattlesnake · Nasty swarm", { voice: "rattlesnake", rattleEnabled: true, rattleRate: 8, rattleLevel: 0.42, tempo: 154, topologyMode: "faults", tone: 0.85, disorderInfluence: 1.65, topologyWarp: 1.6, output: 0.3 }, 3, 16, 101),
  scene("random-minuet", "Twist tape · Crooked minuet", { patternId: "random-walk", sequenceMethod: "twist-tape", playbackMode: "random", tempo: 112, swing: 0.28, twistDensity: 0.65, subdivisionsPerBeat: 2, topologyMode: "cohesion", output: 0.4 }, 2, 6, 111),
]);
export function validateHyperRubixPreset(s) {
  presetStateKey(s);
  const p = s.settings;
  if (!p || Object.keys(p).length !== HYPER_RUBIX_PRESET_KEYS.length || HYPER_RUBIX_PRESET_KEYS.some(key => !Object.hasOwn(p, key))) throw new TypeError("Incomplete Hyper Rubix settings");
  for (const [key, [min, max]] of Object.entries(numeric)) if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new TypeError(`Invalid Hyper Rubix ${key}`);
  for (const [key, values] of Object.entries(choices)) if (!values.includes(p[key])) throw new TypeError(`Invalid Hyper Rubix ${key}: ${p[key]}`);
  if (!hyperRubixBoundaryCell(p.selectedCell).tangentPlanes.includes(p.selectedPlane)) throw new TypeError("Selected plane must be tangent to the selected cell");
  if (typeof p.autoRotate !== "boolean" || typeof p.rattleEnabled !== "boolean" || !Number.isInteger(s.sequenceGeneration) || s.sequenceGeneration < 0) throw new TypeError("Invalid Hyper Rubix switches/seed");
  const metrics = hyperRubixSizeMetrics(s.puzzle);
  const ids = new Set(s.puzzle.stickers.map(sticker => sticker.id));
  if (s.puzzle.stickers.length !== metrics.stickerCount || ids.size !== metrics.stickerCount) throw new TypeError("Invalid complete Hyper Rubix puzzle");
  for (const [key, value] of Object.entries(s.gateOverrides)) if (!ids.has(key) || typeof value !== "boolean") throw new TypeError("Invalid Hyper Rubix gate");
  return s;
}
export function randomizeHyperRubixPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const settings = { ...current.settings, ...randomParameterValues({
    ...numeric, tempo: [64, 190], output: [0.3, 0.5], decay: [0.08, 1.4], topologyRing: [0.08, 1.8],
    topologyLevel: [0, 0.3], rattleLevel: [0.15, 0.45], cameraPitch: [-45, 45],
  }, rng) };
  for (const [key, values] of Object.entries(choices)) settings[key] = rng.pick(key === "voice" ? values.filter(value => value !== "webgpu-303") : values);
  settings.selectedPlane = rng.pick(hyperRubixBoundaryCell(settings.selectedCell).tangentPlanes);
  settings.output = current.settings.output;
  settings.autoRotate = rng.pick([false, true]);
  settings.rattleEnabled = settings.voice === "rattlesnake";
  if (settings.decayLink === "linked") settings.topologyRing = settings.decay;
  const puzzle = puzzleFor(rng.integer(2, 3), 12, rng.integer(1, 0xffffff));
  return validateHyperRubixPreset({ settings, puzzle: clonePresetData(puzzle), sequenceGeneration: rng.integer(0, 100000),
    gateOverrides: Object.fromEntries(puzzle.stickers.filter(() => rng.unit() < 0.12).map(sticker => [sticker.id, false])) });
}
