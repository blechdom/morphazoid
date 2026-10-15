import { presetStateKey } from "../../site/header-presets.js";

const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));

export const logBetween = (rng, minimum, maximum) => (
  Math.exp(rng.between(Math.log(minimum), Math.log(maximum)))
);

function completeRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) {
    throw new TypeError(`Incomplete ${label} preset state`);
  }
}

/** Shared complete-state adapter for the chaotic synths; Audio, level and play mode stay with the performer. */
export function createChaoticPresetAdapter({
  label, settingsKeys, performanceKeys, sanitizeSettings, sanitizePerformance, performanceDefaults,
}) {
  const capture = state => ({
    settings: pick(state.settings, settingsKeys),
    performance: pick(state.performance, performanceKeys),
  });

  function validate(snapshot) {
    completeRecord(snapshot, ["settings", "performance"], label);
    completeRecord(snapshot.settings, settingsKeys, label);
    completeRecord(snapshot.performance, performanceKeys, label);
    const safeSettings = sanitizeSettings(snapshot.settings);
    const safePerformance = sanitizePerformance({ ...performanceDefaults, ...snapshot.performance });
    for (const [source, safe, keys] of [
      [snapshot.settings, safeSettings, settingsKeys],
      [snapshot.performance, safePerformance, performanceKeys],
    ]) {
      if (keys.some(key => source[key] !== safe[key])) throw new TypeError(`${label} preset value is outside its bounds`);
    }
    presetStateKey(snapshot);
    return capture(snapshot);
  }

  const makeBank = definitions => Object.freeze(definitions.map(({ id, label: name, description, settings, performance }) => {
    const snapshot = capture({
      settings: sanitizeSettings(settings),
      performance: sanitizePerformance({ ...performanceDefaults, ...performance }),
    });
    return Object.freeze({
      id, label: name, description,
      snapshot: Object.freeze({
        settings: Object.freeze(snapshot.settings), performance: Object.freeze(snapshot.performance),
      }),
    });
  }));

  return Object.freeze({ capture, validate, makeBank });
}
