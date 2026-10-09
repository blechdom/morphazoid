import { presetRandom } from "../../site/preset-random.js";
import {
  CHAOTIC_AM_PRESETS, CHAOTIC_AM_PERFORMANCE_DEFAULTS,
  sanitizeChaoticAmParams, sanitizeChaoticAmPerformance,
} from "./chaotic-am.js";

const SETTINGS_KEYS = Object.freeze([
  "transferMode", "depth", "carrierHz", "startModFrequencyHz",
  "frequencyDivisor", "startAmplitudeIndex", "indexDivisor", "nonlinearity",
]);
export const CHAOTIC_AM_PRESET_PERFORMANCE_KEYS = Object.freeze([
  "ampAttackMs", "ampDecayMs", "ampSustainLevel", "ampReleaseMs",
  "glideMode", "glideTimeMs", "rootMidiNote", "pitchBendRangeSemitones",
]);
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));

// Audio, output, playing mode and live MIDI controllers belong to the performer.
function capture(state) {
  return {
    version: 1,
    settings: pick(state.settings, SETTINGS_KEYS),
    performance: pick(state.performance, CHAOTIC_AM_PRESET_PERFORMANCE_KEYS),
    activePresetId: state.activePresetId ?? null,
  };
}

export const CHAOTIC_AM_FULL_PRESETS = Object.freeze(CHAOTIC_AM_PRESETS.map(preset => {
  const snapshot = capture({
    settings: sanitizeChaoticAmParams(preset.settings),
    performance: sanitizeChaoticAmPerformance({
      ...CHAOTIC_AM_PERFORMANCE_DEFAULTS, ...preset.performance,
    }),
    activePresetId: preset.id,
  });
  return Object.freeze({
    id: preset.id, label: preset.label, description: preset.description,
    snapshot: Object.freeze({
      ...snapshot,
      settings: Object.freeze(snapshot.settings),
      performance: Object.freeze(snapshot.performance),
    }),
  });
}));

function completeRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) {
    throw new TypeError("Incomplete Chaotic AM preset state");
  }
}

function validate(snapshot) {
  completeRecord(snapshot, ["version", "settings", "performance", "activePresetId"]);
  if (snapshot.version !== 1 || (snapshot.activePresetId !== null
    && !CHAOTIC_AM_FULL_PRESETS.some(preset => preset.id === snapshot.activePresetId))) {
    throw new TypeError("Unsupported Chaotic AM preset identity or version");
  }
  completeRecord(snapshot.settings, SETTINGS_KEYS);
  completeRecord(snapshot.performance, CHAOTIC_AM_PRESET_PERFORMANCE_KEYS);
  const safeSettings = sanitizeChaoticAmParams(snapshot.settings);
  const safePerformance = sanitizeChaoticAmPerformance(snapshot.performance);
  for (const [source, safe, keys] of [
    [snapshot.settings, safeSettings, SETTINGS_KEYS],
    [snapshot.performance, safePerformance, CHAOTIC_AM_PRESET_PERFORMANCE_KEYS],
  ]) {
    if (keys.some(key => source[key] !== safe[key])) {
      throw new TypeError("Chaotic AM preset value is outside its bounds");
    }
  }
  return capture(snapshot);
}

export function randomizeChaoticAmPreset(_current, random = Math.random) {
  const rng = presetRandom(random);
  const depth = rng.pick([0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10]);
  const rhythmic = rng.unit() < 0.35;
  const startModFrequencyHz = rhythmic ? rng.between(3, 16) : rng.between(80, 1400);
  const finalModFrequencyHz = rhythmic ? rng.between(0.5, 30) : rng.between(20, 2200);
  const startAmplitudeIndex = rng.between(1.5, 12);
  const finalIndex = rng.between(0.8, 12);
  // Correlated endpoints keep every nested oscillator in a useful frequency span.
  const frequencyDivisor = depth < 2 ? rng.between(0.5, 4)
    : Math.min(4, Math.max(0.5,
      (startModFrequencyHz / finalModFrequencyHz) ** (1 / (depth - 1))));
  const indexDivisor = depth < 2 ? rng.between(0.5, 2)
    : Math.min(2, Math.max(0.5, (startAmplitudeIndex / finalIndex) ** (1 / (depth - 1))));
  return capture({
    settings: sanitizeChaoticAmParams({
      transferMode: rng.pick(["smooth", "saturated"]), depth,
      carrierHz: rng.between(140, 1000), startModFrequencyHz, frequencyDivisor,
      startAmplitudeIndex, indexDivisor, nonlinearity: rng.between(0.08, 1),
    }),
    performance: sanitizeChaoticAmPerformance({
      ampAttackMs: rng.between(1, 50), ampDecayMs: rng.between(50, 600),
      ampSustainLevel: rng.between(0.4, 0.95), ampReleaseMs: rng.between(40, 800),
      glideMode: rng.pick(["off", "legato", "always"]), glideTimeMs: rng.between(0, 240),
      rootMidiNote: rng.integer(48, 72), pitchBendRangeSemitones: rng.integer(1, 12),
    }),
    activePresetId: null,
  });
}

export const chaoticAmPresets = Object.freeze({
  bank: CHAOTIC_AM_FULL_PRESETS, capture, validate, randomize: randomizeChaoticAmPreset,
});
