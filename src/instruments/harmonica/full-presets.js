import {
  HARMONICA_BLUES_RHYTHMS, HARMONICA_DEFAULTS, HARMONICA_HOLE_COUNT, HARMONICA_KEYS, HARMONICA_LIMITS,
  HARMONICA_PERFORMANCE_CUSTOM_ID, HARMONICA_PERFORMANCE_PRESETS, HARMONICA_PRESETS, HARMONICA_TECHNIQUES,
  applyHarmonicaPerformancePreset, applyHarmonicaTechnique, bendRangeSemitones, harmonicaState,
  harmonicaTechniqueAllowed, sanitizeHarmonicaState,
} from "./harmonica.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const SESSION_NUMERIC_KEYS = new Set(["breathFlow", "level"]);
export const HARMONICA_NUMERIC_PRESET_KEYS = Object.freeze(
  Object.keys(HARMONICA_LIMITS).filter(key => !SESSION_NUMERIC_KEYS.has(key)),
);
export const HARMONICA_PRESET_KEYS = Object.freeze([
  "presetId", "keyId", "bluesTechniqueId", "bluesRhythmId", "breathDirection", ...HARMONICA_NUMERIC_PRESET_KEYS,
]);

export function captureHarmonicaPreset(state) {
  const clean = sanitizeHarmonicaState(state, HARMONICA_DEFAULTS);
  return Object.fromEntries(HARMONICA_PRESET_KEYS.map(key => [key, clean[key]]));
}

export function validateHarmonicaPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length !== HARMONICA_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(captureHarmonicaPreset(snapshot))) {
    throw new TypeError("Invalid complete Harmonicazoid preset");
  }
  return snapshot;
}

export function harmonicaStateFromPreset(snapshot, session) {
  validateHarmonicaPreset(snapshot);
  return sanitizeHarmonicaState({
    ...session, ...snapshot, performancePresetId: HARMONICA_PERFORMANCE_CUSTOM_ID,
    level: session.level, autoBreath: session.autoBreath, breathFlow: session.breathFlow,
  }, session);
}

const performance = (id, presetId, keyId, overrides = {}) => {
  const base = harmonicaState(presetId, { keyId });
  const state = sanitizeHarmonicaState({ ...applyHarmonicaPerformancePreset(base, id), ...overrides }, base);
  return state;
};
const technique = (presetId, keyId, techniqueId, rhythmId, overrides = {}) => {
  const base = harmonicaState(presetId, { keyId });
  return sanitizeHarmonicaState({
    ...applyHarmonicaTechnique(base, techniqueId), bluesRhythmId: rhythmId, ...overrides,
  }, base);
};
const entry = (id, label, state) => Object.freeze({ id, label, snapshot: Object.freeze(captureHarmonicaPreset(state)) });
const performanceLabel = id => HARMONICA_PERFORMANCE_PRESETS.find(item => item.id === id).label;
const fromPerformance = (id, presetId, keyId, overrides) => entry(id, performanceLabel(id), performance(id, presetId, keyId, overrides));

export const HARMONICA_FULL_PRESETS = Object.freeze([
  fromPerformance("front-porch-shuffle", "c-richter", "c"),
  fromPerformance("freight-train-hands", "g-richter", "a"),
  fromPerformance("cross-harp-moaner", "low-c", "g"),
  fromPerformance("tongue-block-boogie", "a-richter", "d"),
  fromPerformance("hill-country-stomp", "low-c", "low-c"),
  fromPerformance("backwoods-waltz", "a-richter", "e-flat"),
  fromPerformance("smoky-warble", "c-richter", "b-flat"),
  fromPerformance("church-house-octaves", "g-richter", "f"),
  fromPerformance("fox-chase", "g-richter", "e"),
  fromPerformance("midnight-growl", "low-c", "c"),
  fromPerformance("high-lonesome-cry", "a-richter", "d-flat"),
  fromPerformance("bent-triplet-cry", "c-richter", "a-flat"),
  fromPerformance("hand-fan-tremolo", "a-richter", "f-sharp"),
  fromPerformance("overblow-sparks", "g-richter", "b"),
  entry("clean-reference", "Clean bronze reference", technique("c-richter", "c", "clean", "free", { hole: 4, breathPressure: 1, bend: 0 })),
  entry("low-octave-dip", "Low weighted dip", technique("low-c", "low-c", "dip", "slow-drag", { hole: 3, breathPressure: 1.05, breathRateBpm: 30, bend: .9 })),
]);

const RANGES = Object.freeze({
  breathRateBpm: [20, 110], breathBalance: [.38, .8], reedGap: [.34, 1.2], reedStiffness: [.62, 1.5],
  airLeak: [.015, .27], embouchure: [-.1, 1.05], tonguePosition: [0, 1], tongueHeight: [0, 1],
  throatOpening: [0, 1], vocalTractCoupling: [.58, 1.92], brightness: [.38, 1.5], vibratoRateHz: [2.2, 8.8],
  vibratoDepth: [.03, .62], tremoloRateHz: [1.4, 9.5], tremoloDepth: [.02, .34], stereoSpread: [.12, .78],
  techniqueAmount: [.52, 1.5], techniqueRateHz: [.8, 24], breathAttackMs: [1, 40], breathReleaseMs: [24, 210],
  breathShiftSlop: [.08, .98], handCup: [.18, .96], cupMotionDepth: [.12, 1], growl: [.04, 1.62],
  tongueMotionDepth: [.1, 1], rhythmSwing: [-.18, .36],
});

export function randomizeHarmonicaPreset(current, random = Math.random) {
  validateHarmonicaPreset(current);
  const rng = presetRandom(random);
  const values = Object.fromEntries(Object.entries(RANGES).map(([key, [lo, hi]]) => [key, rng.between(lo, hi)]));
  const chosen = rng.pick(HARMONICA_TECHNIQUES);
  const base = sanitizeHarmonicaState({ ...HARMONICA_DEFAULTS, bluesTechniqueId: chosen.id });
  const placements = [];
  for (let hole = 1; hole <= HARMONICA_HOLE_COUNT; hole++) {
    for (const direction of [-1, 1]) if (harmonicaTechniqueAllowed(base, hole, direction)) placements.push({ hole, direction });
  }
  const { hole, direction } = rng.pick(placements);
  const overbending = chosen.id === "overblow" || chosen.id === "overdraw";
  const bendable = bendRangeSemitones(hole, direction) > 0;
  const bending = ["draw-bend", "blow-bend", "draw-scoop", "blow-scoop", "dip", "fall"].includes(chosen.id);
  const chordWidth = chosen.id === "octave-tongue-block" ? 1
    : ["double-stop", "train-chug"].includes(chosen.id) ? rng.integer(2, 4) : rng.integer(1, 4);
  const tongueBlock = chosen.id === "octave-tongue-block" ? 1
    : chosen.id === "tongue-slap" ? rng.between(.5, 1) : rng.between(0, .6);
  const state = sanitizeHarmonicaState({
    ...values,
    presetId: rng.pick(HARMONICA_PRESETS).id,
    keyId: rng.pick(HARMONICA_KEYS).id,
    bluesTechniqueId: chosen.id,
    bluesRhythmId: rng.pick(HARMONICA_BLUES_RHYTHMS).id,
    hole, chordWidth, tongueBlock, breathDirection: direction,
    breathPressure: overbending ? rng.between(1.68, 2.4) : rng.between(.72, 1.62),
    bend: !bendable ? 0 : bending ? rng.between(.38, 1.35) : rng.between(0, 1.1),
    overbend: overbending ? rng.between(1.04, 1.32) : rng.between(0, .28),
  }, HARMONICA_DEFAULTS);
  return validateHarmonicaPreset(captureHarmonicaPreset(state));
}
