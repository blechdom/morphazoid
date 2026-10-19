import { SIMD_RESONATOR_FULL_PRESETS } from '../../families/simd-resonator/simd-resonator-presets.js';
import { SIMD_RESONATOR_FFT_SIZES } from '../../simd-resonator.js';
import { createPresetSchema } from '../../site/preset-schema.js';
import { DEFAULTS, LIMITS, sanitizeSettings } from './model.js';
import { sanitizeSpatialSettings } from './spatial-model.js';
import {
  SIGNAL_DEFAULTS, SIGNAL_LIMITS, FILTER_TYPES, sanitizeSignalSettings,
  EXCITATION_DEFAULTS, EXCITATION_LIMITS, EXCITATION_TYPES, sanitizeExcitation,
} from './signal-path.js';

export const SPATIAL_PRESET_DEFAULTS = Object.freeze({
  spaceTarget: 'both', spacePattern: 'ascending', spaceSpan: 1,
  spaceOffset: 0, spaceMotion: false, spaceRate: .05,
});
const signalDefaults = Object.fromEntries(Object.entries(SIGNAL_DEFAULTS).filter(([key]) => key !== 'resynthesisMix'));
const excitationDefaults = {
  excitationType: EXCITATION_DEFAULTS.kind,
  excitationStrength: EXCITATION_DEFAULTS.strength,
  excitationDurationMs: EXCITATION_DEFAULTS.durationMs,
};
export const DEFAULT_PRESET_SETTINGS = Object.freeze({
  ...DEFAULTS, ...SPATIAL_PRESET_DEFAULTS, ...signalDefaults, ...excitationDefaults,
  fftMix: SIGNAL_DEFAULTS.resynthesisMix,
});
const stageKeys = Object.freeze(['bodyEnabled', 'processingEnabled', 'resynthesisEnabled', 'reverbEnabled']);
const modeFlags = (body, processing, resynthesis, reverb) => Object.fromEntries(
  stageKeys.map((key, index) => [key, [body, processing, resynthesis, reverb][index]]),
);
const focusedBank = rows => Object.freeze(rows.map(([id, label, settings]) => Object.freeze({
  id, label, settings: Object.freeze(settings),
})));

// Focused menu patches leave the body's tuning, exciter and other layer timbres
// alone. Their balances provide an audible starting point for the chosen use.
export const APPLICATION_MODES = focusedBank([
  ['body', 'Instrument body modeling', { ...modeFlags(true, false, false, false), bodyMix: 1, wetMix: 1 }],
  ['processing', 'Audio processing', { ...modeFlags(false, true, false, false), wetMix: 1 }],
  ['reverb', 'Reverberation', { ...modeFlags(false, false, false, true), reverbMix: .5, wetMix: 1 }],
  ['resynthesis', 'Resynthesis', { ...modeFlags(false, false, true, false), fftMix: .94, wetMix: 1 }],
  ['body-reverb', 'Body + reverb', { ...modeFlags(true, false, false, true), bodyMix: .8, reverbMix: .38, wetMix: 1 }],
  ['body-resynthesis', 'Body + resynthesis', { ...modeFlags(true, false, true, false), bodyMix: .65, fftMix: .8, wetMix: 1 }],
  ['resynthesis-reverb', 'Resynthesis + reverb', { ...modeFlags(false, false, true, true), fftMix: .9, reverbMix: .4, wetMix: 1 }],
  ['all', 'Body + processing + resynthesis + reverb', { ...modeFlags(true, true, true, true), bodyMix: .45, fftMix: .7, reverbMix: .3, wetMix: 1 }],
]);
export function applicationForSettings(settings = DEFAULT_PRESET_SETTINGS) {
  return APPLICATION_MODES.find(mode => stageKeys.every(key => mode.settings[key] === settings[key]))?.id ?? 'custom';
}

export const REVERB_CHARACTERS = focusedBank([
  ['short', 'Short room', { reverbTime: .35, reverbDamping: .55, reverbMix: .3 }],
  ['chamber', 'Dark chamber', { reverbTime: 1.8, reverbDamping: .72, reverbMix: .4 }],
  ['bright', 'Bright tail', { reverbTime: 3.2, reverbDamping: .18, reverbMix: .45 }],
  ['hall', 'Long hall', { reverbTime: 5.5, reverbDamping: .46, reverbMix: .5 }],
  ['cloud', 'Dark cloud', { reverbTime: 10, reverbDamping: .85, reverbMix: .7 }],
]);
export const RESYNTHESIS_CHARACTERS = focusedBank([
  ['clear', 'Clear detail', { fftSize: 2048, fftWindow: 0, fftHopRatio: .25, fftBandCount: 128, fftResponseMs: 12, fftLowFrequency: 30, fftHighFrequency: 18000, fftDetail: 1, fftGateDb: -84 }],
  ['transients', 'Fast transients', { fftSize: 256, fftWindow: 2, fftHopRatio: .125, fftBandCount: 96, fftResponseMs: 4, fftLowFrequency: 70, fftHighFrequency: 17000, fftDetail: .9, fftGateDb: -72 }],
  ['bands', 'Broad bands', { fftSize: 1024, fftWindow: 0, fftHopRatio: .25, fftBandCount: 16, fftResponseMs: 70, fftLowFrequency: 45, fftHighFrequency: 14000, fftDetail: .18, fftGateDb: -80 }],
  ['fog', 'Spectral fog', { fftSize: 4096, fftWindow: 1, fftHopRatio: .125, fftBandCount: 80, fftResponseMs: 620, fftLowFrequency: 35, fftHighFrequency: 10000, fftDetail: .2, fftGateDb: -88 }],
  ['radio', 'Narrow radio', { fftSize: 512, fftWindow: 3, fftHopRatio: .5, fftBandCount: 24, fftResponseMs: 20, fftLowFrequency: 550, fftHighFrequency: 3750, fftDetail: .72, fftGateDb: -64 }],
]);

const modalFields = {
  ...Object.fromEntries(Object.entries(LIMITS).map(([key, [min, max]]) => [key, { min, max }])),
  modeCount: { choices: Array.from({ length: 1017 }, (_, i) => 32 + i * 4) },
  fftSize: { choices: SIMD_RESONATOR_FFT_SIZES }, fftWindow: { choices: [0, 1, 2, 3] },
  fftBandCount: { choices: Array.from({ length: 29 }, (_, i) => 16 + i * 4) },
};
const spatialFields = {
  spaceTarget: { choices: ['both', 'modes', 'fft'] },
  spacePattern: { choices: ['ascending', 'descending', 'alternate', 'scatter'] },
  spaceSpan: { min: 0, max: 4 }, spaceOffset: { min: 0, max: 1 },
  spaceMotion: { choices: [false, true] }, spaceRate: { min: -1, max: 1 },
};
const signalFields = {
  ...Object.fromEntries(Object.entries(SIGNAL_LIMITS).filter(([key]) => key !== 'resynthesisMix').map(([key, [min, max]]) => [key, { min, max }])),
  ...Object.fromEntries(stageKeys.map(key => [key, { choices: [false, true] }])),
  filterType: { choices: FILTER_TYPES }, excitationType: { choices: EXCITATION_TYPES },
  excitationStrength: { min: EXCITATION_LIMITS.strength[0], max: EXCITATION_LIMITS.strength[1] },
  excitationDurationMs: { min: EXCITATION_LIMITS.durationMs[0], max: EXCITATION_LIMITS.durationMs[1] },
};
const modalSchema = createPresetSchema(modalFields);
const legacySchema = createPresetSchema({ ...modalFields, ...spatialFields });
const schema = createPresetSchema({ ...modalFields, ...spatialFields, ...signalFields });

/** Bounded complete state for live control edits. Preset imports use the strict
 * validator below, so corrupt or incomplete saved scenes never partly apply. */
export function sanitizePresetSettings(value = {}) {
  const source = { ...DEFAULT_PRESET_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  const modal = sanitizeSettings(source);
  const signal = sanitizeSignalSettings({ ...source, resynthesisMix: modal.fftMix });
  const excitation = sanitizeExcitation({ kind: source.excitationType, strength: source.excitationStrength, durationMs: source.excitationDurationMs });
  const spatial = sanitizeSpatialSettings({ target: source.spaceTarget, pattern: source.spacePattern,
    span: source.spaceSpan, offset: source.spaceOffset, motion: source.spaceMotion, rate: source.spaceRate });
  return Object.freeze({
    ...modal,
    spaceTarget: spatial.target, spacePattern: spatial.pattern, spaceSpan: spatial.span,
    spaceOffset: spatial.offset, spaceMotion: spatial.motion, spaceRate: spatial.rate,
    ...Object.fromEntries(Object.keys(signalDefaults).map(key => [key, signal[key]])),
    excitationType: excitation.kind, excitationStrength: excitation.strength, excitationDurationMs: excitation.durationMs,
  });
}

const legacyRoute = Object.freeze({ bodyEnabled: true, processingEnabled: false,
  resynthesisEnabled: true, reverbEnabled: false, excitationType: 'impulse' });
export function validatePreset(value) {
  if (!value || Object.keys(signalFields).some(key => Object.hasOwn(value, key))) return schema.validate(value);
  // Before surround, snapshots contained only the modal/FFT controls. Afterwards
  // all six musical spatial fields were stored. Only those complete versions
  // migrate; absent or unknown fields in any other shape remain an error.
  const hasSpatial = Object.keys(spatialFields).some(key => Object.hasOwn(value, key));
  const legacy = (hasSpatial ? legacySchema : modalSchema).validate(value);
  return schema.validate({ ...DEFAULT_PRESET_SETTINGS, ...legacy, ...legacyRoute });
}
export function capturePreset(state) {
  if (state && Object.keys(signalFields).some(key => Object.hasOwn(state, key))) return schema.capture(state);
  const keys = state && Object.keys(spatialFields).some(key => Object.hasOwn(state, key)) ? legacySchema.keys : modalSchema.keys;
  return validatePreset(Object.fromEntries(keys.map(key => [key, state?.[key]])));
}
export function randomizePreset(previous, random = Math.random) {
  const next = schema.randomize(previous, random);
  if (!stageKeys.some(key => next[key])) next.bodyEnabled = true;
  return schema.validate(next);
}

const application = id => APPLICATION_MODES.find(mode => mode.id === id).settings;
const dense = [
  ['silk-512', 'Silk · 512 waves', { modeCount: 512, spectralSpan: 128 }],
  ['bronze-haze', 'Bronze haze', { ...application('body-reverb'), modeCount: 1024, spectralSpan: 96, baseFrequency: 60, decaySeconds: 5.2, spread: .7, hardness: .8, excitationType: 'hard-mallet', excitationDurationMs: 3, reverbTime: 4.6, reverbDamping: .38, spacePattern: 'descending', spaceMotion: true, spaceRate: -.04 }],
  ['glass-rain', 'Glass rain', { ...application('body-resynthesis'), modeCount: 2048, spectralSpan: 72, baseFrequency: 164, decaySeconds: 2.2, spread: .18, hardness: .96, strikePosition: .73, excitationType: 'impulse', spacePattern: 'scatter', spaceSpan: 2 }],
  ['close-choir', 'Close choir', { ...application('resynthesis-reverb'), modeCount: 1024, spectralSpan: 16, baseFrequency: 96, decaySeconds: 6, spread: .04, hardness: .4, fftSize: 4096, fftResponseMs: 320, excitationType: 'pink-noise', excitationDurationMs: 180, reverbTime: 3.8, reverbDamping: .68, spaceSpan: .35, spaceMotion: true, spaceRate: .025 }],
  ['copper-spray', 'Copper spray', { ...application('processing'), modeCount: 4096, spectralSpan: 128, baseFrequency: 82, decaySeconds: 1.6, spread: .58, hardness: 1, strikePosition: .19, excitationType: 'white-noise', excitationDurationMs: 45, filterType: 'bandpass', filterFrequency: 3200, drive: 4.5, spacePattern: 'alternate', spaceSpan: 2, spaceMotion: true, spaceRate: .12 }],
  ['low-continuum', 'Low continuum', { ...application('reverb'), modeCount: 4096, spectralSpan: 192, baseFrequency: 42, decaySeconds: 5.8, spread: .12, hardness: .72, fftLowFrequency: 35, fftMix: .6, excitationType: 'pink-noise', excitationDurationMs: 160, reverbTime: 8.4, reverbDamping: .78, reverbMix: .8, spaceMotion: true, spaceRate: -.02 }],
  ['wire-cluster', 'Wire cluster', { modeCount: 256, spectralSpan: 32, baseFrequency: 180, decaySeconds: .7, spread: .9, hardness: .9, excitationType: 'pluck', excitationDurationMs: 7, spaceTarget: 'modes', spacePattern: 'alternate', spaceSpan: .5, spaceOffset: .5 }],
  ['voice-chamber', 'Voice chamber', { ...application('all'), modeCount: 2048, spectralSpan: 128, baseFrequency: 68, decaySeconds: 3.6, spread: .3, fftSize: 2048, fftBandCount: 128, fftMix: .72, fftResponseMs: 90, excitationType: 'soft-mallet', excitationDurationMs: 8, filterFrequency: 6000, drive: 1.4, reverbTime: 2.8, spaceTarget: 'fft', spaceMotion: true, spaceRate: .07 }],
];
const classicExciters = Object.freeze({
  'resonator:glass': { ...application('body'), excitationType: 'hard-mallet', excitationDurationMs: 2 },
  'resonator:wood': { ...application('body'), excitationType: 'soft-mallet', excitationDurationMs: 28 },
  'resonator:metal': { ...application('body-reverb'), excitationType: 'impulse', reverbTime: 2.6, reverbDamping: .32 },
  'resonator:pin': { ...application('body'), excitationType: 'pluck', excitationDurationMs: 5 },
});
export const PRESETS = schema.bank([
  ...dense.map(([id, label, settings]) => ['rust:' + id, label, { ...DEFAULT_PRESET_SETTINGS, ...settings }]),
  ...SIMD_RESONATOR_FULL_PRESETS.map(preset => ['classic:' + preset.id, 'Classic · ' + preset.label,
    { ...DEFAULT_PRESET_SETTINGS, ...preset.snapshot, spectralSpan: preset.snapshot.modeCount,
      ...legacyRoute, ...classicExciters[preset.id] }]),
]);
