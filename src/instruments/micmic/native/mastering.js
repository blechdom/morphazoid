/** Mastering settings use physical units shared with the native audio engine. */
export const DEFAULT_MASTERING = Object.freeze({ inputHighpassHz: 55, highpassHz: 0, lowpassHz: 0,
  compressorEnabled: true, thresholdDb: -12, kneeDb: 5, ratio: 18, attackMs: 3, releaseMs: 180,
  autoMakeup: true, makeupDb: 6 });
export const MASTERING_LIMITS = Object.freeze({ inputHighpassHz: [0, 2000], highpassHz: [0, 2000], lowpassHz: [0, 20000],
  thresholdDb: [-60, 0], kneeDb: [0, 40], ratio: [1, 20], attackMs: [.1, 100], releaseMs: [10, 1500], makeupDb: [-12, 24] });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = value => Number(value.toFixed(6));

export function sanitizeMastering(candidate = {}) {
  const input = candidate && typeof candidate === 'object' ? candidate : {}, next = {};
  for (const [key, fallback] of Object.entries(DEFAULT_MASTERING)) {
    if (typeof fallback === 'boolean') next[key] = typeof input[key] === 'boolean' ? input[key] : fallback;
    else {
      const value = Number(input[key]);
      next[key] = round(clamp(Number.isFinite(value) ? value : fallback, ...MASTERING_LIMITS[key]));
    }
  }
  return next;
}

/** Manual output boost belongs to the live gain controls, outside sound presets. */
export function captureMastering(settings) {
  const { makeupDb, ...musical } = sanitizeMastering(settings);
  return musical;
}

const profile = (id, label, settings) => Object.freeze({ id, label, settings: Object.freeze(captureMastering({ ...DEFAULT_MASTERING, ...settings })) });
export const MASTERING_PROFILES = Object.freeze([
  profile('original', 'Original', {}),
  profile('transparent', 'Transparent', { compressorEnabled: false, autoMakeup: false }),
  profile('gentle', 'Gentle', { highpassHz: 35, thresholdDb: -18, ratio: 2, attackMs: 20, releaseMs: 180, kneeDb: 9, autoMakeup: false }),
  profile('dense', 'Dense', { inputHighpassHz: 80, highpassHz: 80, lowpassHz: 14000, thresholdDb: -22, ratio: 4, attackMs: 8, releaseMs: 240, kneeDb: 6, autoMakeup: false }),
  profile('warm', 'Warm', { highpassHz: 35, lowpassHz: 6500, thresholdDb: -16, ratio: 2.5, attackMs: 25, releaseMs: 260, kneeDb: 10, autoMakeup: false }),
  profile('airy', 'Airy', { inputHighpassHz: 90, highpassHz: 120, lowpassHz: 18000, thresholdDb: -18, ratio: 2, attackMs: 15, releaseMs: 150, kneeDb: 6, autoMakeup: false }),
  profile('telephone', 'Telephone', { highpassHz: 350, lowpassHz: 3500, thresholdDb: -22, ratio: 4, attackMs: 5, releaseMs: 120, kneeDb: 6, autoMakeup: false }),
]);

export function masteringProfileId(settings) {
  const key = JSON.stringify(captureMastering(settings));
  return MASTERING_PROFILES.find(item => JSON.stringify(item.settings) === key)?.id ?? 'custom';
}

/** Bypass sits beside the open end of each logarithmic cutoff range. */
export function cutoffFromSlider(position, maximumHz, offAtHighEnd = false) {
  const value = clamp(Number(position) || 0, 0, 1000);
  if (offAtHighEnd) return value >= 1000 ? 0 : round(20 * (maximumHz / 20) ** (value / 999));
  return value < 1 ? 0 : round(20 * (maximumHz / 20) ** ((value - 1) / 999));
}
export function sliderFromCutoff(frequencyHz, maximumHz, offAtHighEnd = false) {
  const value = clamp(Number(frequencyHz) || 0, 0, maximumHz);
  if (offAtHighEnd) return value <= 0 ? 1000 : clamp(999 * Math.log(value / 20) / Math.log(maximumHz / 20), 0, 999);
  return value <= 0 ? 0 : clamp(1 + 999 * Math.log(value / 20) / Math.log(maximumHz / 20), 1, 1000);
}

/** Bounded variation covers every musical setting while preserving live state. */
export function randomMastering(random = Math.random) {
  const unit = () => clamp(Number(random()) || 0, 0, 1);
  const between = (low, high) => low + (high - low) * unit();
  const cutoff = (low, high) => unit() < .2 ? 0 : Math.exp(between(Math.log(low), Math.log(high)));
  return captureMastering({ inputHighpassHz: cutoff(20, 180), highpassHz: cutoff(20, 250), lowpassHz: cutoff(1800, 20000),
    compressorEnabled: unit() > .15, thresholdDb: between(-28, -8), kneeDb: between(0, 18), ratio: between(1, 8),
    attackMs: between(.5, 40), releaseMs: between(60, 600), autoMakeup: unit() > .5 });
}
