import { CASCADING_AM_PRESETS, sanitizeCascadingAmSettings } from "./cascading-am.js";
import { presetRandom } from "../../site/preset-random.js";

export const CASCADING_AM_FULL_PRESETS = Object.freeze(CASCADING_AM_PRESETS.map(preset => Object.freeze({
  id: preset.id, label: preset.label, description: preset.description,
  snapshot: Object.freeze({ settings: preset.settings, activePresetId: preset.id, level: preset.level }),
})));

export function randomizeCascadingAmPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const stages = rng.integer(2, 7), carrier = rng.between(45, 150);
  const rootHz = Math.max(rng.between(0.125, 3), stages === 2 ? carrier / 180 : 0);
  const strength = rng.between(1, 3.5);
  return { settings: sanitizeCascadingAmSettings({ stages, rootHz,
    cascadeRatio: (carrier / rootHz) ** (1 / (stages - 1)),
    modulationDepth: strength / (1 + strength), depthTaper: rng.between(0.9, 1.3),
  }), activePresetId: null, level: current.level };
}
