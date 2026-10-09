import { CASCADING_AM_PRESETS, sanitizeCascadingAmSettings } from "./cascading-am.js";
import { presetRandom } from "../../site/preset-random.js";

export const CASCADING_AM_FULL_PRESETS = Object.freeze(CASCADING_AM_PRESETS.map(preset => Object.freeze({
  id: preset.id, label: preset.label, description: preset.description,
  snapshot: Object.freeze({ settings: preset.settings, activePresetId: preset.id }),
})));

export function randomizeCascadingAmPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const rhythmic = rng.unit() < 0.4;
  const stages = rhythmic ? 2 : rng.integer(3, 7);
  const carrier = rng.between(240, rhythmic ? 650 : 1400);
  // Immediate chops or audio-rate AM textures; no sub-audio waiting scenes.
  const rootHz = rhythmic
    ? rng.between(Math.max(2, carrier / 200), 14)
    : rng.between(25, 110);
  const cascadeRatio = (carrier / rootHz) ** (1 / (stages - 1));
  return { settings: sanitizeCascadingAmSettings({ stages, rootHz,
    cascadeRatio,
    modulationDepth: rng.between(0.8, 1), depthTaper: rng.between(0.8, 1.6),
  }), activePresetId: null };
}
