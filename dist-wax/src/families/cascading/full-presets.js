import { CASCADING_FM_PRESETS, sanitizeCascadingFmSettings } from "../../instruments/cascading-fm/cascading-fm.js";
import { CASCADING_PM_PRESETS, sanitizeCascadingPmSettings } from "../../instruments/cascading-pm/cascading-pm.js";
import { presetRandom } from "../../site/preset-random.js";

// One bank per engine: default, Reset and the header cannot disagree.
function compile(presets) {
  return Object.freeze(presets.map(preset => Object.freeze({
    id: preset.id, label: preset.label, description: preset.description,
    snapshot: Object.freeze({ settings: preset.settings, activePresetId: preset.id, level: preset.level }),
  })));
}
export const CASCADING_FM_FULL_PRESETS = compile(CASCADING_FM_PRESETS);
export const CASCADING_PM_FULL_PRESETS = compile(CASCADING_PM_PRESETS);

function randomizeCascade(current, random, sanitize, kind) {
  const rng = presetRandom(random);
  const stages = rng.integer(2, 7), carrier = rng.between(45, 150);
  const rootHz = Math.max(rng.between(0.125, 3), stages === 2 ? carrier / 180 : 0);
  // Randomize stage count, root and frequency span jointly rather than
  // choosing a factory hierarchy or multiplying unrelated extremes.
  const settings = { stages, rootHz, cascadeRatio: (carrier / rootHz) ** (1 / (stages - 1)) };
  if (kind === "fm") {
    settings.depthTaper = Math.min(4, settings.cascadeRatio) * rng.between(0.8, 1);
    settings.modDepth = carrier * rng.between(0.2, 0.85) / settings.depthTaper ** (stages - 2);
  } else {
    settings.phaseIndex = rng.between(1, 3.5);
    settings.indexTaper = rng.between(0.9, 1.3);
  }
  return { settings: sanitize(settings), activePresetId: null, level: current.level };
}

export const randomizeCascadingFmPreset = (current, random = Math.random) =>
  randomizeCascade(current, random, sanitizeCascadingFmSettings, "fm");
export const randomizeCascadingPmPreset = (current, random = Math.random) =>
  randomizeCascade(current, random, sanitizeCascadingPmSettings, "pm");
