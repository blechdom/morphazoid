import { SIMD_RESONATOR_FULL_PRESETS } from '../../families/simd-resonator/simd-resonator-presets.js';
import { SIMD_RESONATOR_FFT_SIZES } from '../../simd-resonator.js';
import { createPresetSchema } from '../../site/preset-schema.js';
import { DEFAULTS, LIMITS } from './model.js';

export const SPATIAL_PRESET_DEFAULTS = Object.freeze({
  spaceTarget: 'both', spacePattern: 'ascending', spaceSpan: 1,
  spaceOffset: 0, spaceMotion: false, spaceRate: .05,
});
const schema = createPresetSchema({
  ...Object.fromEntries(Object.entries(LIMITS).map(([key, [min, max]]) => [key, { min, max }])),
  modeCount: { choices: Array.from({ length: 1017 }, (_, i) => 32 + i * 4) },
  fftSize: { choices: SIMD_RESONATOR_FFT_SIZES }, fftWindow: { choices: [0, 1, 2, 3] },
  fftHopRatio: { choices: [.125, .25, .375, .5, .625, .75, .875, 1] },
  fftBandCount: { choices: Array.from({ length: 29 }, (_, i) => 16 + i * 4) },
  spaceTarget: { choices: ['both', 'modes', 'fft'] },
  spacePattern: { choices: ['ascending', 'descending', 'alternate', 'scatter'] },
  spaceSpan: { min: 0, max: 4 }, spaceOffset: { min: 0, max: 1 },
  spaceMotion: { choices: [false, true] }, spaceRate: { min: -1, max: 1 },
});
const dense = [
  ['silk-512', 'Silk · 512 waves', { modeCount: 512, spectralSpan: 128 }],
  ['bronze-haze', 'Bronze haze', { modeCount: 1024, spectralSpan: 96, baseFrequency: 60, decaySeconds: 5.2, spread: .7, hardness: .8, spacePattern: 'descending', spaceMotion: true, spaceRate: -.04 }],
  ['glass-rain', 'Glass rain', { modeCount: 2048, spectralSpan: 72, baseFrequency: 164, decaySeconds: 2.2, spread: .18, hardness: .96, strikePosition: .73, spacePattern: 'scatter', spaceSpan: 2 }],
  ['close-choir', 'Close choir', { modeCount: 1024, spectralSpan: 16, baseFrequency: 96, decaySeconds: 6, spread: .04, hardness: .4, fftSize: 4096, fftResponseMs: 320, spaceSpan: .35, spaceMotion: true, spaceRate: .025 }],
  ['copper-spray', 'Copper spray', { modeCount: 4096, spectralSpan: 128, baseFrequency: 82, decaySeconds: 1.6, spread: .58, hardness: 1, strikePosition: .19, spacePattern: 'alternate', spaceSpan: 2, spaceMotion: true, spaceRate: .12 }],
  ['low-continuum', 'Low continuum', { modeCount: 4096, spectralSpan: 192, baseFrequency: 42, decaySeconds: 5.8, spread: .12, hardness: .72, fftLowFrequency: 35, fftMix: .6, spaceMotion: true, spaceRate: -.02 }],
  ['wire-cluster', 'Wire cluster', { modeCount: 256, spectralSpan: 32, baseFrequency: 180, decaySeconds: .7, spread: .9, hardness: .9, spaceTarget: 'modes', spacePattern: 'alternate', spaceSpan: .5, spaceOffset: .5 }],
  ['voice-chamber', 'Voice chamber', { modeCount: 2048, spectralSpan: 128, baseFrequency: 68, decaySeconds: 3.6, spread: .3, fftSize: 2048, fftBandCount: 128, fftMix: .72, fftResponseMs: 90, spaceTarget: 'fft', spaceMotion: true, spaceRate: .07 }],
];
export const PRESETS = schema.bank([
  ...dense.map(([id, label, settings]) => ['rust:' + id, label, { ...DEFAULTS, ...SPATIAL_PRESET_DEFAULTS, ...settings }]),
  ...SIMD_RESONATOR_FULL_PRESETS.map(preset => ['classic:' + preset.id, 'Classic · ' + preset.label,
    { ...preset.snapshot, spectralSpan: preset.snapshot.modeCount, ...SPATIAL_PRESET_DEFAULTS }]),
]);
export const capturePreset = schema.capture;
export const validatePreset = schema.validate;
export const randomizePreset = schema.randomize;
