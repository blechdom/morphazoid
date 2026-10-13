import {
  SIMD_RESONATOR_DEFAULTS, SIMD_RESONATOR_FFT_SIZES, SIMD_RESONATOR_LIMITS,
  presetsForSimdEngine,
} from "../../simd-resonator.js";
import { createPresetSchema } from "../../site/preset-schema.js";

// Only the body and its FFT resynthesis are recalled. Input selection, sample
// transport, device, input-strip trim and output level belong to the session.
const laneChoices = (minimum, maximum) => Array.from({ length: (maximum - minimum) / 4 + 1 }, (_, index) => minimum + index * 4);
export const simdResonatorPresetSchema = createPresetSchema({
  ...Object.fromEntries(Object.entries(SIMD_RESONATOR_LIMITS).map(([key, [min, max]]) => [key, { min, max }])),
  modeCount: { choices: laneChoices(32, 128) },
  fftSize: { choices: SIMD_RESONATOR_FFT_SIZES },
  fftWindow: { choices: [0, 1, 2, 3] },
  fftHopRatio: { choices: [.125, .25, .375, .5, .625, .75, .875, 1] },
  fftBandCount: { choices: laneChoices(16, 128) },
});

const scenes = [
  ["vowel-glass", "Vowel glass", { baseFrequency: 110, decaySeconds: 3.8, spread: .12, hardness: .78, fftSize: 2048, fftBandCount: 128, fftResponseMs: 65, fftLowFrequency: 90, fftHighFrequency: 8500, fftDetail: .98, fftMix: .97 }],
  ["low-chamber", "Low chamber", { modeCount: 96, baseFrequency: 44, decaySeconds: 5.6, spread: .28, strikePosition: .65, hardness: .32, fftSize: 4096, fftWindow: 1, fftBandCount: 64, fftResponseMs: 250, fftLowFrequency: 35, fftHighFrequency: 3500, fftDetail: .56, fftMix: .78, fftInputGain: 1.1 }],
  ["clockwork", "Clockwork", { modeCount: 64, baseFrequency: 164, decaySeconds: .55, spread: .7, strikePosition: .21, hardness: .96, fftSize: 256, fftBandCount: 32, fftResponseMs: 8, fftLowFrequency: 200, fftHighFrequency: 14500, fftDetail: .32, fftMix: .55, fftInputGain: 1.7, fftGateDb: -58 }],
  ["spectral-fog", "Spectral fog", { modeCount: 112, baseFrequency: 62, decaySeconds: 4.9, spread: .58, strikePosition: .72, hardness: .4, fftSize: 4096, fftWindow: 1, fftHopRatio: .125, fftBandCount: 80, fftResponseMs: 620, fftLowFrequency: 50, fftHighFrequency: 7500, fftDetail: .2, fftMix: 1, fftInputGain: 1.25, fftGateDb: -88 }],
  ["pocket-radio", "Pocket radio", { modeCount: 48, baseFrequency: 188, decaySeconds: 1.15, spread: .44, strikePosition: .56, hardness: .55, fftSize: 512, fftWindow: 3, fftHopRatio: .5, fftBandCount: 24, fftResponseMs: 20, fftLowFrequency: 550, fftHighFrequency: 3750, fftDetail: .72, fftMix: .92, fftInputGain: 1.8, fftGateDb: -64 }],
  ["air-bars", "Air bars", { modeCount: 80, baseFrequency: 132, decaySeconds: 2.2, spread: .06, strikePosition: .15, hardness: .82, fftSize: 2048, fftWindow: 2, fftBandCount: 112, fftResponseMs: 110, fftLowFrequency: 360, fftHighFrequency: 17500, fftDetail: .85, fftMix: .82, fftInputGain: 1.2, fftGateDb: -80 }],
  ["quick-sparks", "Quick sparks", { modeCount: 96, baseFrequency: 212, decaySeconds: .4, spread: .92, strikePosition: .84, hardness: 1, fftSize: 512, fftWindow: 2, fftHopRatio: .125, fftBandCount: 48, fftResponseMs: 4, fftLowFrequency: 120, fftHighFrequency: 15500, fftDetail: .48, fftMix: .66, fftInputGain: 1.5, fftGateDb: -56 }],
  ["long-choir", "Long choir", { baseFrequency: 74, decaySeconds: 6, spread: .18, strikePosition: .46, hardness: .25, fftSize: 4096, fftWindow: 1, fftBandCount: 128, fftResponseMs: 390, fftLowFrequency: 55, fftHighFrequency: 11000, fftDetail: 1, fftMix: .99, fftInputGain: 1.35, fftGateDb: -84 }],
];

export const SIMD_RESONATOR_FULL_PRESETS = simdResonatorPresetSchema.bank([
  ...presetsForSimdEngine("resonator").map(({ id, label, settings }) => [id, label, settings]),
  ...scenes.map(([id, label, settings]) => [`resonator:${id}`, label, { ...SIMD_RESONATOR_DEFAULTS, ...settings }]),
]);

export const captureSimdResonatorPreset = simdResonatorPresetSchema.capture;
export const validateSimdResonatorPreset = simdResonatorPresetSchema.validate;
export const randomizeSimdResonatorPreset = simdResonatorPresetSchema.randomize;
