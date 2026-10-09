import { presetRandom } from "../../site/preset-random.js";

export const RECURSIVE_PRESET_PERFORMANCE_KEYS = Object.freeze([
  "ampAttackMs", "ampDecayMs", "ampSustainLevel", "ampReleaseMs",
  "glideMode", "glideTimeMs", "rootMidiNote", "pitchBendRangeSemitones",
]);
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));

function completeRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) {
    throw new TypeError(`Incomplete recursive ${label}`);
  }
}

/** Shared preset mechanics; the three instruments retain their own DSP owners. */
export function createRecursiveFullPresets({
  kind, originals, additions, performanceDefaults, sanitizeSettings, sanitizePerformance,
}) {
  const settingsKeys = Object.freeze(Object.keys(originals[0].settings));
  const performanceKeys = RECURSIVE_PRESET_PERFORMANCE_KEYS;
  const capture = state => ({
    version: 1,
    settings: pick(state.settings, settingsKeys),
    performance: pick(state.performance, performanceKeys),
    activePresetId: state.activePresetId ?? null,
  });
  const bank = Object.freeze([...originals, ...additions].map(preset => {
    const snapshot = capture({
      settings: sanitizeSettings(preset.settings),
      performance: sanitizePerformance({ ...performanceDefaults, ...preset.performance }),
      activePresetId: preset.id,
    });
    return Object.freeze({ id: preset.id, label: preset.label, description: preset.description,
      snapshot: Object.freeze({ ...snapshot,
        settings: Object.freeze(snapshot.settings), performance: Object.freeze(snapshot.performance),
      }),
    });
  }));
  const validate = snapshot => {
    completeRecord(snapshot, ["version", "settings", "performance", "activePresetId"], "snapshot");
    if (snapshot.version !== 1 || (snapshot.activePresetId !== null
      && !bank.some(preset => preset.id === snapshot.activePresetId))) {
      throw new TypeError("Unsupported recursive preset identity or version");
    }
    completeRecord(snapshot.settings, settingsKeys, "synthesis state");
    completeRecord(snapshot.performance, performanceKeys, "performance state");
    const safeSettings = sanitizeSettings(snapshot.settings);
    const safePerformance = sanitizePerformance(snapshot.performance);
    for (const [source, safe, keys] of [
      [snapshot.settings, safeSettings, settingsKeys],
      [snapshot.performance, safePerformance, performanceKeys],
    ]) {
      if (keys.some(key => source[key] !== safe[key])) throw new TypeError("Recursive preset value is outside its bounds");
    }
    return capture(snapshot);
  };
  const randomize = (_current, random = Math.random) => {
    const rng = presetRandom(random);
    let settings;
    if (kind === "fm") {
      const depth = rng.integer(0, 10);
      const initialExcursion = rng.between(250, 1500);
      const finalExcursion = rng.between(200, 1500);
      settings = {
        depth, carrierHz: rng.between(35, 700), offsetHz: rng.between(0, 900),
        modulationHz: initialExcursion * 2,
        divisor: depth >= 2 ? (initialExcursion / finalExcursion) ** (1 / (depth - 1)) : rng.between(0.7, 1.8),
      };
    } else {
      const depth = rng.integer(0, 10);
      const finalHz = rng.between(220, depth === 1 ? 400 : 1000);
      const startModFrequencyHz = depth === 1 ? finalHz : rng.between(40, 400);
      const frequencyDivisor = depth < 2 ? rng.between(0.65, 1.6)
        : (startModFrequencyHz / finalHz) ** (1 / (depth - 1));
      const initialIndex = rng.between(kind === "am" ? 1.5 : 0.15, kind === "am" ? 12 : 1.2);
      const finalIndex = kind === "am" ? rng.between(2.5, 12) : rng.between(0.15, 1.2);
      settings = {
        depth, carrierHz: depth === 0 ? rng.between(220, 1200)
          : kind === "am" && depth === 1 && rng.unit() < 0.4 ? rng.between(2, 14) : rng.between(35, 700),
        startModFrequencyHz, frequencyDivisor,
        [kind === "am" ? "startAmplitudeIndex" : "startPhaseIndex"]: initialIndex,
        indexDivisor: depth < 2 ? rng.between(0.8, 1.6) : (initialIndex / finalIndex) ** (1 / (depth - 1)),
      };
    }
    return capture({ settings: sanitizeSettings(settings), activePresetId: null,
      performance: sanitizePerformance({
        ampAttackMs: rng.between(1, 60), ampDecayMs: rng.between(50, 650),
        ampSustainLevel: rng.between(0.35, 0.95), ampReleaseMs: rng.between(40, 850),
        glideMode: rng.pick(["off", "legato", "always"]), glideTimeMs: rng.between(0, 240),
        rootMidiNote: rng.integer(48, 72), pitchBendRangeSemitones: rng.integer(1, 12),
      }),
    });
  };
  return Object.freeze({ bank, capture, validate, randomize });
}
