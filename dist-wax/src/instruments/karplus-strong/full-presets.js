import {
  KARPLUS_STRONG_PRESETS, KARPLUS_STRONG_TUNING_DEFAULTS,
  sanitizeKarplusStrongSettings, sanitizeKarplusStrongTuning,
} from "../../karplus-strong.js";
import { presetRandom, randomParameterValues } from "../../site/preset-random.js";

// Keep all original materials, now paired with a complete tuning field.
const ranges = {
  bass: [55, 130.8127826502993], glass: [261.6255653005986, 622.2539674441618],
  frozen: [196, 466.1637615180899], ghost: [98, 233.08188075904496],
};
export const KARPLUS_STRONG_FULL_PRESETS = Object.freeze(KARPLUS_STRONG_PRESETS.map(preset => ({
  id: preset.id, label: preset.name,
  description: `${preset.name}: complete excitation, string, body, coupling, stereo and tuning settings.`,
  snapshot: {
    settings: { ...preset.settings },
    tuning: {
      ...KARPLUS_STRONG_TUNING_DEFAULTS,
      ...(ranges[preset.id] ? { lowFrequency: ranges[preset.id][0], highFrequency: ranges[preset.id][1] } : {}),
    },
    selectedPresetId: preset.id,
  },
})));

export function randomizeKarplusStrongPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const settings = randomParameterValues({
    frequency: [55, 440], decay: [0.25, 9], damping: [0.1, 0.9], brightness: [0.1, 0.95],
    hardness: [0.1, 0.9], excitationColor: [0.05, 0.95], excitationShape: [0, 1], burstLength: [0.15, 3],
    pickPosition: [0.05, 0.95], pickWidth: [0.1, 0.95], detune: [-24, 24], dispersion: [0, 0.75],
    lowCut: [0.03, 0.65], drive: [0, 0.5], chorusDepth: [0, 0.5], chorusRate: [0.1, 4],
    roughness: [0, 0.5], pickupPosition: [0.05, 0.95], pickupMix: [0, 0.8],
    body: [0, 0.85], bodyTune: [0.6, 6], bodyQ: [0.4, 6],
    coupling: [0, 0.35], couplingRatio: [0.3, 4], couplingDetune: [-24, 24], spread: [0, 1],
  }, rng);
  const lowFrequency = rng.between(55, 220);
  return {
    settings: sanitizeKarplusStrongSettings({
      ...settings, polarity: rng.pick([-1, 1]), level: current.settings.level,
    }),
    tuning: sanitizeKarplusStrongTuning({
      lowFrequency, highFrequency: lowFrequency * 2 ** rng.between(1, 1.75),
      divisionsPerOctave: rng.pick([5, 7, 12, 19, 24]), spacing: rng.pick(["octave", "equal-hz"]),
    }),
    selectedPresetId: null,
  };
}
