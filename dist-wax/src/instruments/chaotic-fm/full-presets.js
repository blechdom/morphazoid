import { presetRandom } from "../../site/preset-random.js";
import { createChaoticPresetAdapter, logBetween } from "../../families/chaotic/chaotic-full-presets.js";
import {
  CHAOTIC_FM_PERFORMANCE_DEFAULTS, CHAOTIC_FM_PRESETS,
  sanitizeChaoticFmParams, sanitizeChaoticFmPerformance,
} from "./chaotic-fm.js";

export const CHAOTIC_FM_SETTINGS_KEYS = Object.freeze([
  "depth", "carrierHz", "offsetHz", "modulationAmount", "amountDivisor", "nonlinearityHz",
]);
export const CHAOTIC_FM_PRESET_PERFORMANCE_KEYS = Object.freeze([
  "rootMidiNote", "pitchBendRangeSemitones", "ampAttackMs", "ampDecayMs", "ampSustainLevel",
  "ampReleaseMs", "glideTimeMs", "glideMode",
]);

const adapter = createChaoticPresetAdapter({
  label: "Chaotic FM",
  settingsKeys: CHAOTIC_FM_SETTINGS_KEYS,
  performanceKeys: CHAOTIC_FM_PRESET_PERFORMANCE_KEYS,
  sanitizeSettings: settings => sanitizeChaoticFmParams(settings),
  sanitizePerformance: sanitizeChaoticFmPerformance,
  performanceDefaults: CHAOTIC_FM_PERFORMANCE_DEFAULTS,
});

const factory = id => CHAOTIC_FM_PRESETS.find(preset => preset.id === id);
const fromFactory = (id, performance) => ({ ...factory(id), performance });

export const CHAOTIC_FM_FULL_PRESETS = adapter.makeBank([
  fromFactory("feedback-nest", { rootMidiNote: 60, ampAttackMs: 4, ampDecayMs: 160, ampSustainLevel: 0.6, ampReleaseMs: 220 }),
  fromFactory("slow-furnace", {
    rootMidiNote: 48, ampAttackMs: 120, ampDecayMs: 800, ampSustainLevel: 0.8, ampReleaseMs: 1200,
    glideMode: "legato", glideTimeMs: 90,
  }),
  fromFactory("glass-hive", { rootMidiNote: 67, ampAttackMs: 2, ampDecayMs: 90, ampSustainLevel: 0.35, ampReleaseMs: 300 }),
  fromFactory("cut-current", {
    rootMidiNote: 55, ampAttackMs: 1, ampDecayMs: 60, ampSustainLevel: 0.5, ampReleaseMs: 120,
    pitchBendRangeSemitones: 12,
  }),
  fromFactory("brass-moth", {
    rootMidiNote: 52, ampAttackMs: 35, ampDecayMs: 200, ampSustainLevel: 0.8, ampReleaseMs: 260,
    glideMode: "always", glideTimeMs: 60,
  }),
  {
    id: "bell-tree", label: "Bell Tree",
    description: "Three gentle turns over a slow carrier ring like struck metal with a long tail.",
    settings: { depth: 3, carrierHz: 0.5, offsetHz: 220, modulationAmount: 1800, amountDivisor: 2.2, nonlinearityHz: 880 },
    performance: { rootMidiNote: 72, ampAttackMs: 1, ampDecayMs: 1500, ampSustainLevel: 0.2, ampReleaseMs: 2000 },
  },
  {
    id: "sub-rattle", label: "Sub Rattle",
    description: "A low, narrow stack that rattles under the root with a slight legato slur.",
    settings: { depth: 2, carrierHz: 3.2, offsetHz: 40, modulationAmount: 300, amountDivisor: 1.4, nonlinearityHz: 90 },
    performance: { rootMidiNote: 36, ampAttackMs: 5, ampDecayMs: 300, ampSustainLevel: 0.7, ampReleaseMs: 400, glideMode: "legato", glideTimeMs: 40 },
  },
  {
    id: "siren-fold", label: "Siren Fold",
    description: "Six wide turns sweep a slow pad through rising and falling harmonic bands.",
    settings: { depth: 6, carrierHz: 0.35, offsetHz: 300, modulationAmount: 3600, amountDivisor: 1.6, nonlinearityHz: 1500 },
    performance: { rootMidiNote: 55, ampAttackMs: 300, ampDecayMs: 1200, ampSustainLevel: 0.9, ampReleaseMs: 2500, pitchBendRangeSemitones: 7 },
  },
  {
    id: "dust-choir", label: "Dust Choir",
    description: "Eight shallow layers blur into a slow, breathing vocal haze.",
    settings: { depth: 8, carrierHz: 0.04, offsetHz: 120, modulationAmount: 900, amountDivisor: 1.25, nonlinearityHz: 420 },
    performance: { rootMidiNote: 57, ampAttackMs: 600, ampDecayMs: 1800, ampSustainLevel: 0.85, ampReleaseMs: 3000 },
  },
  {
    id: "needle-gate", label: "Needle Gate",
    description: "A single bright turn clipped into a percussive tick with no sustain.",
    settings: { depth: 1, carrierHz: 24, offsetHz: 1500, modulationAmount: 80, amountDivisor: 0.8, nonlinearityHz: 2800 },
    performance: { rootMidiNote: 74, ampAttackMs: 0, ampDecayMs: 40, ampSustainLevel: 0, ampReleaseMs: 60 },
  },
  {
    id: "hollow-reed", label: "Hollow Reed",
    description: "A mid-rate flutter and three soft turns give a woody, breathy reed.",
    settings: { depth: 3, carrierHz: 6.5, offsetHz: 180, modulationAmount: 260, amountDivisor: 3, nonlinearityHz: 340 },
    performance: { rootMidiNote: 62, ampAttackMs: 60, ampDecayMs: 240, ampSustainLevel: 0.75, ampReleaseMs: 350, glideMode: "legato", glideTimeMs: 70 },
  },
  {
    id: "chime-storm", label: "Chime Storm",
    description: "Seven fast, high turns scatter into a glittering, unstable shimmer.",
    settings: { depth: 7, carrierHz: 2.2, offsetHz: 900, modulationAmount: 3200, amountDivisor: 2.9, nonlinearityHz: 2200 },
    performance: { rootMidiNote: 79, ampAttackMs: 3, ampDecayMs: 700, ampSustainLevel: 0.25, ampReleaseMs: 900 },
  },
  {
    id: "tide-engine", label: "Tide Engine",
    description: "Four heavy turns churn a deep, slowly gliding bass drone.",
    settings: { depth: 4, carrierHz: 0.6, offsetHz: 55, modulationAmount: 2000, amountDivisor: 3.8, nonlinearityHz: 180 },
    performance: { rootMidiNote: 41, ampAttackMs: 80, ampDecayMs: 500, ampSustainLevel: 0.8, ampReleaseMs: 900, glideMode: "always", glideTimeMs: 400 },
  },
]);

export const captureChaoticFmPreset = adapter.capture;
export const validateChaoticFmPreset = adapter.validate;

export function randomizeChaoticFmPreset(current, random = Math.random) {
  adapter.validate(current);
  const rng = presetRandom(random);
  return adapter.validate({
    settings: {
      depth: rng.pick([0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8]),
      carrierHz: logBetween(rng, 0.03, 40),
      offsetHz: rng.between(0, 1500),
      modulationAmount: logBetween(rng, 60, 4000),
      amountDivisor: logBetween(rng, 0.4, 6),
      nonlinearityHz: logBetween(rng, 60, 3000),
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
