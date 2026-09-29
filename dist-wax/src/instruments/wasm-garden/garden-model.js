import { ORIGINAL_PITCH_SPREAD, sanitizeGardenSettings } from './dsp.js';
export const PRESETS = Object.freeze({
  original: Object.freeze({ model: 'bank', modes: 256, baseFrequency: 82, pitchSpread: ORIGINAL_PITCH_SPREAD, decay: 3.2, dispersion: 0.45, brightness: 0.65, rate: 3, exciter: 'impulse', pattern: 'random', pitchFocus: 0.5, chanceWidth: 1 }),
  originalGlass: Object.freeze({ model: 'bank', modes: 512, baseFrequency: 176, pitchSpread: ORIGINAL_PITCH_SPREAD, decay: 6.5, dispersion: 0.8, brightness: 0.84, rate: 2, exciter: 'impulse', pattern: 'random', pitchFocus: 0.5, chanceWidth: 1 }),
  originalWood: Object.freeze({ model: 'bank', modes: 64, baseFrequency: 58, pitchSpread: ORIGINAL_PITCH_SPREAD, decay: 0.5, dispersion: 0.15, brightness: 0.3, rate: 5, exciter: 'impulse', pattern: 'random', pitchFocus: 0.5, chanceWidth: 1 }),
  originalDense: Object.freeze({ model: 'bank', modes: 2048, baseFrequency: 110, pitchSpread: ORIGINAL_PITCH_SPREAD, decay: 9, dispersion: 0.68, brightness: 0.72, rate: 7, exciter: 'impulse', pattern: 'random', pitchFocus: 0.5, chanceWidth: 1 }),
  steel: Object.freeze({ model: 'tines', modes: 4096, baseFrequency: 82, pitchSpread: 2, pitchFocus: 0.5, chanceWidth: 0.5, decay: 4.5, dispersion: 1, brightness: 0.72, rate: 8, exciter: 'mallet', pattern: 'sweep' }),
  bronze: Object.freeze({ model: 'tines', modes: 8192, baseFrequency: 110, pitchSpread: 2, pitchFocus: 0.5, chanceWidth: 0.5, decay: 8, dispersion: 0.72, brightness: 0.88, rate: 24, exciter: 'pick', pattern: 'sweep' }),
  weighted: Object.freeze({ model: 'tines', modes: 8192, baseFrequency: 110, pitchSpread: 1.5, pitchFocus: 0.65, chanceWidth: 0.35, decay: 6, dispersion: 0.72, brightness: 0.88, rate: 24, exciter: 'pick', pattern: 'weighted' }),
  damped: Object.freeze({ model: 'tines', modes: 2048, baseFrequency: 65, pitchSpread: 2, pitchFocus: 0.5, chanceWidth: 0.5, decay: 0.5, dispersion: 0.9, brightness: 0.3, rate: 16, exciter: 'mallet', pattern: 'selected' }),
  scrape: Object.freeze({ model: 'tines', modes: 16384, baseFrequency: 58, pitchSpread: 2, pitchFocus: 0.5, chanceWidth: 0.5, decay: 2.5, dispersion: 1, brightness: 1, rate: 120, exciter: 'scraper', pattern: 'sweep' }),
});


export function unitParameter(value, fallback) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
}

/** Reweight the original rain's spectral range. The full XY endpoints can
 * align dense mode impulses and create disproportionately strong attacks. */
export function bankSpectralEmphasis(position) {
  return 0.2 + 0.7 * unitParameter(position, 0.5);
}

/** Normalize one distribution for both the display and the audio scheduler.
 * Focus is its peak, not its mean near an edge. Width 0 is exactly one tine;
 * width 1 gives exactly equal odds. No allocation is needed on the audio thread. */
export function fillPitchProbabilities(target, focus = 0.5, width = 0.5) {
  const center = unitParameter(focus, 0.5);
  const spread = unitParameter(width, 0.5);
  const count = target.length;
  if (!count) return target;
  if (count === 1 || spread <= 1e-6) {
    target.fill(0); target[Math.round(center * (count - 1))] = 1; return target;
  }
  if (spread === 1) { target.fill(1 / count); return target; }
  const sigma = 0.15 * spread / (1 - spread);
  const nearest = Math.round(center * (count - 1)) / (count - 1);
  const minimumDistance = (nearest - center) ** 2;
  let total = 0;
  for (let tine = 0; tine < count; tine++) {
    const distance = (tine / (count - 1) - center) ** 2;
    const weight = Math.exp(-Math.max(0, distance - minimumDistance) / (2 * sigma * sigma));
    target[tine] = weight; total += weight;
  }
  for (let tine = 0; tine < count; tine++) target[tine] /= total;
  return target;
}

export function choosePitch(probabilities, randomValue) {
  const draw = Math.min(1 - Number.EPSILON, unitParameter(randomValue, 0));
  let cumulative = 0, lastPossible = 0;
  for (let tine = 0; tine < probabilities.length; tine++) {
    cumulative += probabilities[tine];
    if (probabilities[tine] > 0) lastPossible = tine;
    if (draw < cumulative) return tine;
  }
  return lastPossible;
}

/** A fresh complete musical state; Audio, playback, Volume and contact gestures
 * belong to the performer and never enter preset randomization. */
export function randomizeGardenPreset(_current, random = Math.random) {
  const draw = () => unitParameter(random(), 0.5);
  const pick = values => values[Math.min(values.length - 1, Math.floor(draw() * values.length))];
  const model = pick(['bank', 'tines']);
  return {
    ...sanitizeGardenSettings({
      model,
      modes: pick([32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]),
      baseFrequency: 45 * 8 ** draw(),
      pitchSpread: (model === 'bank' ? 6 : 4) * draw(),
      decay: 0.2 * 60 ** draw(),
      dispersion: draw(), brightness: draw(),
    }),
    rate: Math.max(0.5, Math.round(0.5 * 4096 ** draw() * 2) / 2),
    exciter: model === 'bank' ? 'impulse' : pick(['mallet', 'pick', 'scraper']),
    pattern: pick(['random', 'sweep', 'selected', 'weighted']),
    pitchFocus: draw(), chanceWidth: draw(),
  };
}
