import { SLIPPERY_RESYNTHESIS_DEFAULTS, SLIPPERY_RESYNTHESIS_PRESETS, sanitizeSlipperyResynthesisParams } from './slippery-resynthesis.js';
import { presetStateKey } from '../../site/header-presets.js';
import { presetRandom, randomParameterValues } from '../../site/preset-random.js';

export const SLIPPERY_PRESET_KEYS = Object.freeze(Object.keys(SLIPPERY_RESYNTHESIS_DEFAULTS).filter(key => !['inputGain', 'outputLevel'].includes(key)));

export function captureSlipperyPreset(parameters) {
  const settings = sanitizeSlipperyResynthesisParams(parameters);
  return { settings: Object.fromEntries(SLIPPERY_PRESET_KEYS.map(key => [key, settings[key]])) };
}

export function validateSlipperyPreset(snapshot) {
  if (!snapshot?.settings || presetStateKey(snapshot) !== presetStateKey(captureSlipperyPreset(snapshot.settings))) {
    throw new TypeError('Invalid complete Slippery Resynthesis preset');
  }
  return snapshot;
}

export const SLIPPERY_FULL_PRESETS = Object.freeze(SLIPPERY_RESYNTHESIS_PRESETS.map(preset => {
  const snapshot = captureSlipperyPreset({ ...SLIPPERY_RESYNTHESIS_DEFAULTS, ...preset.settings });
  Object.freeze(snapshot.settings);
  return Object.freeze({ id: preset.id, label: preset.label, snapshot: Object.freeze(snapshot) });
}));

export function randomizeSlipperyPreset(current, random = Math.random) {
  validateSlipperyPreset(current);
  const rng = presetRandom(random);
  const bankWidth = rng.integer(2, 8);
  const settings = randomParameterValues({
    slipRate: [0.015, 2.5], coherence: [0, 1], response: [0.008, 0.5],
    consonantDetail: [0, 1], transpose: [-1.5, 1.5], glideShape: [-0.85, 0.85],
    spectralTilt: [-6, 5], carrierColor: [0, 0.85], stereoWidth: [0, 1],
    gateDb: [-88, -50], highFrequency: [3500, 18000], dryWet: [0.45, 1],
  }, rng);
  return validateSlipperyPreset(captureSlipperyPreset({
    ...settings, bankWidth, bandCount: rng.integer(8, Math.min(64, Math.floor(256 / bankWidth))),
    direction: rng.pick([-1, 1]), hold: rng.unit() < 0.2,
  }));
}
