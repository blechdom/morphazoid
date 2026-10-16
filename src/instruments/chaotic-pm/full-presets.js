import { presetRandom } from "../../site/preset-random.js";
import { createChaoticPresetAdapter, logBetween } from "../../families/chaotic/chaotic-full-presets.js";
import {
  CHAOTIC_PM_PERFORMANCE_DEFAULTS, CHAOTIC_PM_PRESETS,
  sanitizeChaoticPmParams, sanitizeChaoticPmPerformance,
} from "./chaotic-pm.js";

export const CHAOTIC_PM_SETTINGS_KEYS = Object.freeze([
  "transferMode", "depth", "carrierHz", "startModFrequencyHz", "frequencyDivisor",
  "startPhaseIndex", "indexDivisor", "nonlinearity",
]);
export const CHAOTIC_PM_PRESET_PERFORMANCE_KEYS = Object.freeze([
  "rootMidiNote", "pitchBendRangeSemitones", "ampAttackMs", "ampDecayMs", "ampSustainLevel",
  "ampReleaseMs", "glideTimeMs", "glideMode",
]);

const adapter = createChaoticPresetAdapter({
  label: "Chaotic PM",
  settingsKeys: CHAOTIC_PM_SETTINGS_KEYS,
  performanceKeys: CHAOTIC_PM_PRESET_PERFORMANCE_KEYS,
  sanitizeSettings: settings => sanitizeChaoticPmParams(settings),
  sanitizePerformance: sanitizeChaoticPmPerformance,
  performanceDefaults: CHAOTIC_PM_PERFORMANCE_DEFAULTS,
});

const factory = id => CHAOTIC_PM_PRESETS.find(preset => preset.id === id);
const fromFactory = (id, performance) => ({ ...factory(id), performance });

export const CHAOTIC_PM_FULL_PRESETS = adapter.makeBank([
  fromFactory("subzero-thread", { rootMidiNote: 40, ampAttackMs: 40, ampDecayMs: 400, ampSustainLevel: 0.8, ampReleaseMs: 700 }),
  fromFactory("forty-fold", { rootMidiNote: 60, ampAttackMs: 8, ampDecayMs: 120, ampSustainLevel: 0.72, ampReleaseMs: 180 }),
  fromFactory("still-glass", { rootMidiNote: 69, ampAttackMs: 2, ampDecayMs: 900, ampSustainLevel: 0.15, ampReleaseMs: 1200 }),
  fromFactory("runaway-stair", { rootMidiNote: 48, ampAttackMs: 15, ampDecayMs: 200, ampSustainLevel: 0.6, ampReleaseMs: 250, glideMode: "legato", glideTimeMs: 120 }),
  fromFactory("braided-orbit", { rootMidiNote: 64, ampAttackMs: 90, ampDecayMs: 500, ampSustainLevel: 0.85, ampReleaseMs: 800 }),
  fromFactory("low-ember", { rootMidiNote: 43, ampAttackMs: 25, ampDecayMs: 350, ampSustainLevel: 0.65, ampReleaseMs: 500, glideMode: "always", glideTimeMs: 80 }),
  fromFactory("kilohertz-veil", { rootMidiNote: 76, ampAttackMs: 400, ampDecayMs: 1200, ampSustainLevel: 0.9, ampReleaseMs: 2200, pitchBendRangeSemitones: 7 }),
  fromFactory("chrome-cascade", { rootMidiNote: 57, ampAttackMs: 1, ampDecayMs: 110, ampSustainLevel: 0.4, ampReleaseMs: 160, pitchBendRangeSemitones: 12 }),
  {
    id: "raw-forty", label: "Raw Forty",
    description: "The recovered discontinuous transfer at audio rate: a rough, buzzing phase fold.",
    settings: { transferMode: "legacy", depth: 3, carrierHz: 110, startModFrequencyHz: 200, frequencyDivisor: 2, startPhaseIndex: 4, indexDivisor: 3, nonlinearity: 0.55 },
    performance: { rootMidiNote: 45, ampAttackMs: 6, ampDecayMs: 220, ampSustainLevel: 0.7, ampReleaseMs: 260 },
  },
  {
    id: "glass-marimba", label: "Glass Marimba",
    description: "Two bright phase turns with a quick strike and a long woody ring.",
    settings: { transferMode: "smooth", depth: 2, carrierHz: 220, startModFrequencyHz: 440, frequencyDivisor: 2, startPhaseIndex: 5, indexDivisor: 2.5, nonlinearity: 0.15 },
    performance: { rootMidiNote: 72, ampAttackMs: 1, ampDecayMs: 600, ampSustainLevel: 0.1, ampReleaseMs: 900 },
  },
  {
    id: "soft-pad", label: "Soft Pad",
    description: "Gentle low-index phase layers bloom slowly into a warm sustained pad.",
    settings: { transferMode: "smooth", depth: 3, carrierHz: 130, startModFrequencyHz: 65, frequencyDivisor: 1, startPhaseIndex: 1.2, indexDivisor: 1.5, nonlinearity: 0.05 },
    performance: { rootMidiNote: 55, ampAttackMs: 700, ampDecayMs: 1500, ampSustainLevel: 0.9, ampReleaseMs: 2500 },
  },
  {
    id: "metal-wire", label: "Metal Wire",
    description: "Seven tightly spaced turns at high index twist into a taut, inharmonic wire.",
    settings: { transferMode: "smooth", depth: 7, carrierHz: 90, startModFrequencyHz: 390, frequencyDivisor: 1.12, startPhaseIndex: 28, indexDivisor: 1.8, nonlinearity: 0.85 },
    performance: { rootMidiNote: 50, ampAttackMs: 3, ampDecayMs: 450, ampSustainLevel: 0.3, ampReleaseMs: 600, pitchBendRangeSemitones: 5 },
  },
  {
    id: "slow-wobble", label: "Slow Wobble",
    description: "A sub-10 Hz first turn gives the phase stack a slow, seasick tremor.",
    settings: { transferMode: "smooth", depth: 4, carrierHz: 70, startModFrequencyHz: 7.5, frequencyDivisor: 3, startPhaseIndex: 12, indexDivisor: 2, nonlinearity: 0.3 },
    performance: { rootMidiNote: 47, ampAttackMs: 150, ampDecayMs: 600, ampSustainLevel: 0.8, ampReleaseMs: 900, glideMode: "legato", glideTimeMs: 200 },
  },
]);

export const captureChaoticPmPreset = adapter.capture;
export const validateChaoticPmPreset = adapter.validate;

export function randomizeChaoticPmPreset(current, random = Math.random) {
  adapter.validate(current);
  const rng = presetRandom(random);
  const legacy = rng.unit() < 0.25;
  return adapter.validate({
    settings: {
      transferMode: legacy ? "legacy" : "smooth",
      depth: rng.integer(1, 8),
      carrierHz: logBetween(rng, 30, 600),
      startModFrequencyHz: logBetween(rng, 8, 400),
      frequencyDivisor: logBetween(rng, 0.8, 4),
      startPhaseIndex: legacy ? logBetween(rng, 0.2, 8) : logBetween(rng, 0.3, 24),
      indexDivisor: logBetween(rng, 1, 8),
      nonlinearity: rng.between(0.05, 0.95),
    },
    performance: {
      rootMidiNote: rng.integer(36, 80),
      pitchBendRangeSemitones: rng.integer(1, 12),
      ampAttackMs: rng.unit() ** 2 * 700,
      ampDecayMs: logBetween(rng, 40, 1800),
      ampSustainLevel: rng.between(0.1, 0.95),
      ampReleaseMs: logBetween(rng, 60, 2500),
      glideTimeMs: rng.between(0, 400),
      glideMode: rng.pick(["off", "legato", "always"]),
    },
  });
}
