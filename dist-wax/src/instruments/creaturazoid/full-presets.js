import {
  creaturazoidState, creaturazoidBodyPreset, creaturazoidSequencePreset,
  sanitizeCreaturazoidPattern, sanitizeCreaturazoidState,
  CREATURAZOID_LIMITS, CREATURAZOID_SHAPE_LIMITS, CREATURAZOID_EAR_TYPES, CREATURAZOID_TAIL_TYPES,
  CREATURAZOID_MORPH_CONTROLS, CREATURAZOID_MODULATION_SHAPES, CREATURAZOID_ANATOMY_DESIGNS, CREATURAZOID_SOUNDS,
  CREATURAZOID_BODY_PRESETS,
} from "../../creaturazoid.js";
import { CONTROL_LIMITS } from "../../syrinx.js";
import { presetRandom, randomParameterValues, randomMonophonicRows } from "../../site/preset-random.js";

// Deliberate complete performances using every original body and rhythm.
// The state constructor fills ALL acoustic, anatomy and modulation parameters;
// no preset inherits leftover body/sequence values from the prior performance.
const scenes = [
  ["barrel-house", "Colossal Barrel · Hoof House", "colossal-barrel", "hoof-and-hiss", 126, 0.08, {}],
  ["pocket-lullaby", "Pocket Needle · Sweet Birdbath", "pocket-needle", "nervous-comet", 64, 0.03, { pitchSemitones: 5, modulationDepth: 0.22, timbre: -0.2 }],
  ["hollow-owl", "Long Hollow · Owl Relay", "long-hollow", "owl-blinks", 84, 0.02, { morphTimeMs: 240, earSpread: 0.65 }],
  ["dense-funk", "Dense Squat · Feeding Funk", "dense-squat", "feeding-frenzy", 116, 0.22, {}],
  ["elastic-garage", "Elastic Tower · Ruffle Garage", "elastic-tower", "murmuration", 132, 0.16, {}],
  ["swamp-bladder", "Wide Bladder · Swamp Skip", "wide-bladder", "swamp-skip", 146, 0.12, {}],
  ["split-fangs", "Split Chamber · Fang & Feather", "split-chamber", "fang-and-feather", 124, 0.08, {}],
  ["paper-migration", "Paper-Thin Giant · Antler Migration", "paper-giant", "rose-migration", 108, 0.04, {}],
  ["hyena-breaks", "Pocket Needle · Hyena Breaks", "pocket-needle", "creature-parade", 174, 0.08, { morphTimeMs: 12, attackMs: 12 }],
  ["heavy-stampede", "Colossal Barrel · Nasty Stampede", "colossal-barrel", "stampede-signal", 180, 0, { timbre: 0.85, morphBias: { roughness: 0.75 }, pitchSemitones: -16 }],
  ["menagerie-sprint", "Split Chamber · Menagerie Sprint", "split-chamber", "whole-menagerie", 280, 0.03, { morphTimeMs: 10, attackMs: 8, modulationRateHz: 9 }],
  ["rubber-moon", "Elastic Tower · Very Weird Birdbath", "elastic-tower", "nervous-comet", 52, 0.36, { morphTimeMs: 600, vibratoDepthSemitones: 2.4, modulationDepth: 0.96, pitchSemitones: -12 }],
];

export const CREATURAZOID_FULL_PRESETS = Object.freeze(scenes.map(([id, label, bodyId, rhythmId, tempo, swing, overrides]) => {
  const rhythm = creaturazoidSequencePreset(rhythmId);
  const state = creaturazoidState(bodyId, {
    ...overrides, tempo, swing, level: 0.48,
    sequencePresetId: rhythm.id, patternLength: rhythm.length,
  });
  return Object.freeze({
    id, label,
    description: `${creaturazoidBodyPreset(bodyId).label} anatomy and modulation, ${rhythm.label}, ${tempo} BPM. Audio and transport remain yours.`,
    snapshot: {
      state,
      pattern: sanitizeCreaturazoidPattern(rhythm, rhythm.length),
      currentPatternId: rhythm.id,
      modulationTarget: state.modulationTarget,
    },
  });
}));

export function randomizeCreaturazoidPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const patternLength = rng.integer(8, 64);
  const state = sanitizeCreaturazoidState({
    ...current.state,
    // This ID also selects body-motion envelopes/palette and reference scaling;
    // roll that categorical parameter, but do not copy the preset's settings.
    bodyPresetId: rng.pick(CREATURAZOID_BODY_PRESETS).id,
    ...randomParameterValues({
      ...CREATURAZOID_LIMITS, pitchSemitones: [-18, 18], vibratoRateHz: [0, 12], vibratoDepthSemitones: [0, 3],
      modulationRateHz: [0, 12], modulationDepth: [0, 0.8],
    }, rng),
    level: current.state.level, tempo: rng.integer(60, 220), patternLength,
    bodyShape: {
      ...randomParameterValues(CREATURAZOID_SHAPE_LIMITS, rng),
      earType: rng.pick(CREATURAZOID_EAR_TYPES), tailType: rng.pick(CREATURAZOID_TAIL_TYPES),
      tongueAnatomy: rng.pick(["human", "macaque", "canine", "avian"]),
    },
    bodyState: {
      ...randomParameterValues(Object.fromEntries(CREATURAZOID_MORPH_CONTROLS.map(key => [key, CONTROL_LIMITS[key]])), rng),
      pressure: rng.between(0.2, 0.85), roughness: rng.between(0, 0.7), tractLengthM: rng.between(0.06, 0.5),
      tractDiameterProfile: Array.from({ length: 8 }, () => rng.between(0.25, 1.8)),
      tractDiameterScale: rng.between(0.45, 1.6), cavityFrequencyHz: rng.between(120, 1800),
    },
    morphBias: Object.fromEntries(CREATURAZOID_MORPH_CONTROLS.map(key => [key, rng.between(-0.65, 0.65)])),
    anatomyDesignId: rng.pick(CREATURAZOID_ANATOMY_DESIGNS).id,
    modulationShape: rng.pick(CREATURAZOID_MODULATION_SHAPES),
    modulationTarget: rng.pick(["cavity", "roughness", "beak", "pressure", "split", "balance"]),
  });
  return {
    state, currentPatternId: "custom", modulationTarget: state.modulationTarget,
    pattern: sanitizeCreaturazoidPattern({
      length: patternLength,
      rows: randomMonophonicRows(CREATURAZOID_SOUNDS.map(sound => sound.id), 64, patternLength, rng),
    }, patternLength),
  };
}
