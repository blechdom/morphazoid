import {
  BREATH_ATLAS_LIMITS, BREATH_INSTRUMENTS, RHYTHM_PATTERNS, instrumentPreset, sanitizeBreathAtlasState,
  sourceNeedsGesture, sourceRequiresBreath, stateForInstrument,
} from "./breath-atlas.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const INSTRUMENT_IDS = BREATH_INSTRUMENTS.map(({ id }) => id);
const RHYTHM_IDS = RHYTHM_PATTERNS.map(({ id }) => id);
const STEP = Object.freeze({
  sourcePitchHz: 0.01, breathPressure: 0.01, breathRateBpm: 1, breathBalance: 0.01, damping: 0.01, brightness: 0.01, coupling: 0.01,
  tonguePosition: 0.01, tongueHeight: 0.01, jawOpening: 0.01, lipRounding: 0.01, glottisOpening: 0.01, boreLengthM: 0.01,
  gestureForce: 0.01, gestureRateBpm: 1, breathSyncRatio: 0.25, dryResonance: 0.01,
});
export const BREATH_NUMBER_KEYS = Object.freeze(Object.keys(STEP));
export const BREATH_PRESET_KEYS = Object.freeze([
  "instrumentId", ...BREATH_NUMBER_KEYS, "autoBreath", "autoGesture", "breathLinked", "rhythmId",
]);

const snap = (key, value) => {
  const [min, max] = BREATH_ATLAS_LIMITS[key];
  const step = STEP[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(4));
};

export function captureBreathAtlasPreset(state) {
  return Object.fromEntries(BREATH_PRESET_KEYS.map(key => [key, state[key]]));
}

export function validateBreathAtlasPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Mouthophones preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== BREATH_PRESET_KEYS.length) bad();
  if (!INSTRUMENT_IDS.includes(snapshot.instrumentId) || !RHYTHM_IDS.includes(snapshot.rhythmId)) bad();
  for (const key of BREATH_NUMBER_KEYS) {
    const [min, max] = BREATH_ATLAS_LIMITS[key];
    if (typeof snapshot[key] !== "number" || snapshot[key] < min || snapshot[key] > max) bad();
  }
  for (const key of ["autoBreath", "autoGesture", "breathLinked"]) if (typeof snapshot[key] !== "boolean") bad();
  return snapshot;
}

const scene = (id, label, instrumentId, overrides = {}) => {
  const full = stateForInstrument(instrumentId, overrides);
  const snapshot = captureBreathAtlasPreset(full);
  validateBreathAtlasPreset(snapshot);
  if (presetStateKey(captureBreathAtlasPreset(sanitizeBreathAtlasState(snapshot))) !== presetStateKey(snapshot)) {
    throw new Error(`Preset ${id} is not stable under sanitize`);
  }
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const BREATH_ATLAS_FULL_PRESETS = Object.freeze([
  scene("lesiba-slow-tide", "Lesiba slow tide", "lesiba"),
  scene("harmonica-train", "Harmonica train", "harmonica", { breathRateBpm: 44, breathPressure: 0.7, rhythmId: "tresillo", gestureRateBpm: 120, breathLinked: true }),
  scene("khaen-organ-hall", "Khaen organ hall", "khaen", { breathPressure: 0.9, breathRateBpm: 12, dryResonance: 0.25, brightness: 0.4, tonguePosition: 0.3, jawOpening: 0.8 }),
  scene("sheng-bright-cluster", "Sheng bright cluster", "sheng", { brightness: 0.9, breathRateBpm: 30, tongueHeight: 0.7, lipRounding: 0.5, rhythmId: "five-step", breathSyncRatio: 2 }),
  scene("sho-held-chord", "Sho held chord", "sho", { breathPressure: 0.55, breathRateBpm: 9, breathBalance: 0.6, damping: 0.2, dryResonance: 0.3, autoGesture: false }),
  scene("hulusi-reed-breath", "Hulusi reed breath", "hulusi", { breathPressure: 0.68, breathRateBpm: 26, glottisOpening: 0.7, lipRounding: 0.4 }),
  scene("didgeridoo-drone", "Didgeridoo drone", "didgeridoo", { breathRateBpm: 14, breathPressure: 0.85, lipRounding: 0.7, jawOpening: 0.4, boreLengthM: 1.8, rhythmId: "soft-machine" }),
  scene("pungi-charmer", "Pungi charmer", "pungi", { breathRateBpm: 36, brightness: 0.8, damping: 0.2, tonguePosition: 0.7, rhythmId: "sparse-seven" }),
  scene("nose-flute-mist", "Nose flute mist", "nose-flute", { breathPressure: 0.5, breathRateBpm: 18, brightness: 0.35, dryResonance: 0.2, glottisOpening: 0.3 }),
  scene("overtone-flute-glass", "Overtone flute glass", "overtone-flute", { breathPressure: 0.8, breathRateBpm: 24, brightness: 0.85, tongueHeight: 0.8, lipRounding: 0.6 }),
  scene("ukeke-pluck-pulse", "Ukeke pluck pulse", "ukeke", { gestureRateBpm: 150, rhythmId: "two-one", gestureForce: 0.9, tonguePosition: 0.4 }),
  scene("umrhubhe-rub-choir", "Umrhubhe rub choir", "umrhubhe", { gestureRateBpm: 70, gestureForce: 0.6, rhythmId: "quarter-eighths", jawOpening: 0.9, tongueHeight: 0.6, dryResonance: 0.2 }),
  scene("berimbau-mouth-swing", "Berimbau mouth swing", "berimbau-mouth", { gestureRateBpm: 110, rhythmId: "tresillo", gestureForce: 0.8, lipRounding: 0.5 }),
  scene("kni-bowed-hum", "Kni bowed hum", "kni", { gestureForce: 0.45, gestureRateBpm: 60, rhythmId: "soft-machine", damping: 0.4, dryResonance: 0.15 }),
  scene("makomako-twang", "Makomako twang", "makomako", { gestureRateBpm: 180, rhythmId: "sparse-seven", gestureForce: 1, breathRateBpm: 40, breathPressure: 0.6 }),
  scene("dan-moi-night", "Dan moi night", "dan-moi", { gestureRateBpm: 80, rhythmId: "five-step", brightness: 0.4, glottisOpening: 0.8, tongueHeight: 0.2, breathLinked: false, breathRateBpm: 15 }),
]);

export function randomizeBreathAtlasPreset(current, random = Math.random) {
  validateBreathAtlasPreset(current);
  const rng = presetRandom(random);
  const instrumentId = rng.pick(INSTRUMENT_IDS), preset = instrumentPreset(instrumentId);
  const octave = rng.between(-1, 1);
  const unit = key => snap(key, rng.between(...BREATH_ATLAS_LIMITS[key]));
  const needsBreath = sourceRequiresBreath(preset), needsGesture = sourceNeedsGesture(preset);
  return validateBreathAtlasPreset({
    instrumentId,
    sourcePitchHz: snap("sourcePitchHz", preset.pitchHz * 2 ** octave),
    boreLengthM: snap("boreLengthM", preset.lengthM * 2 ** rng.between(-0.6, 0.6)),
    breathPressure: snap("breathPressure", rng.between(0.35, 1)),
    breathRateBpm: snap("breathRateBpm", 8 * 8 ** rng.unit()),
    breathBalance: unit("breathBalance"),
    damping: snap("damping", rng.between(0.1, 0.7)),
    brightness: unit("brightness"), coupling: snap("coupling", rng.between(0.4, 1)),
    tonguePosition: unit("tonguePosition"), tongueHeight: unit("tongueHeight"), jawOpening: unit("jawOpening"),
    lipRounding: unit("lipRounding"), glottisOpening: unit("glottisOpening"),
    gestureForce: snap("gestureForce", rng.between(0.2, 1)), gestureRateBpm: snap("gestureRateBpm", 40 * 4 ** rng.unit()),
    breathSyncRatio: snap("breathSyncRatio", rng.pick([0.5, 1, 2, 3])), dryResonance: unit("dryResonance"),
    autoBreath: needsBreath ? true : rng.unit() < 0.5, autoGesture: needsGesture ? true : rng.unit() < 0.5,
    breathLinked: rng.unit() < 0.7, rhythmId: rng.pick(RHYTHM_IDS),
  });
}
