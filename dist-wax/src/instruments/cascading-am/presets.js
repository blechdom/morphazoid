import { CASCADING_PM_RHYTHM_PRESETS } from "../../families/cascading/rhythm-presets.js";

const descriptions = {
  "slow-steps": "Start here. A two-second swell shapes quicker pulses into a soft bass rhythm. Listen for the slower layer changing the faster layer's depth.",
  "simple-sway": "The simplest example: one 3 Hz LFO changes a low sine's loudness. A repeated tremolo with no extra operators hiding the relationship.",
  "nested-sway": "A slow layer shapes the depth of a faster ripple before it reaches the bass. Compare this nested amplitude motion with Simple Sway.",
};

// Preserve the PM bank's names, time scales, frequency spans and output levels.
// Map its unbounded index strength to bounded depth, keeping taper expressive.
export const CASCADING_AM_RHYTHM_PRESETS = Object.freeze(CASCADING_PM_RHYTHM_PRESETS.map(preset => {
  const { phaseIndex, indexTaper, ...settings } = preset.settings;
  return Object.freeze({ ...preset,
    description: descriptions[preset.id] ?? preset.description,
    settings: Object.freeze({ ...settings,
      modulationDepth: phaseIndex / (1 + phaseIndex), depthTaper: indexTaper }),
  });
}));
