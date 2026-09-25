import { ALGORITHMIC_INSTRUMENTS, sanitizeAlgorithmicScoreParams } from "./algorithmic-scores.js";
import { SEQUENCER_VOICES } from "../../sequencer-voices.js";
import { presetRandom } from "../../site/preset-random.js";

// Explicit score/sound studies, applied to each instrument's own algorithm and
// defaults. Seeds are deliberate and deterministic; no random slider filling.
const studies = [
  ["original", "Original study", {}],
  ["small", "Small clear steps", { complexity: 2, tempoBpm: 72, swing: 0, intensity: 0.5, roughness: 0, space: 0.12, seed: 0x10203040 }],
  ["sweet", "Sweet upper register", { complexity: 3, tempoBpm: 88, brightness: 0.38, roughness: 0, baseFrequencyHz: 220, pitchSpanOctaves: 2, intensity: 0.56, space: 0.4, seed: 0x24681357 }],
  ["low", "Slow dark procession", { complexity: 4, tempoBpm: 40, baseFrequencyHz: 45, pitchSpanOctaves: 2, brightness: 0.15, roughness: 0.22, space: 0.65, seed: 0x78563412 }],
  ["dry", "Dry articulated machine", { complexity: 5, tempoBpm: 160, swing: 0, space: 0, brightness: 0.8, intensity: 0.72, seed: 0x31415926 }],
  ["swing", "Crooked swinging steps", { complexity: 4, tempoBpm: 112, swing: 0.42, brightness: 0.6, roughness: 0.16, space: 0.28, seed: 0x65432109 }],
  ["glass", "Bright glass lattice", { complexity: 5, tempoBpm: 128, baseFrequencyHz: 330, pitchSpanOctaves: 3, brightness: 0.95, roughness: 0, space: 0.5, seed: 0x27182818 }],
  ["wide", "Wide-register journey", { complexity: 6, tempoBpm: 96, baseFrequencyHz: 65, pitchSpanOctaves: 6, space: 0.45, intensity: 0.62, seed: 0x12344321 }],
  ["rough", "Nasty clockwork", { complexity: 6, tempoBpm: 180, roughness: 0.95, brightness: 0.85, intensity: 0.88, space: 0.2, baseFrequencyHz: 55, seed: 0x10293847 }],
  ["sprint", "Virtuoso sprint", { complexity: 7, tempoBpm: 240, swing: 0, intensity: 0.62, brightness: 0.68, roughness: 0.1, space: 0.1, seed: 0x90817263 }],
  ["echo", "Long echo puzzle", { complexity: 3, tempoBpm: 56, space: 0.95, intensity: 0.55, brightness: 0.44, pitchSpanOctaves: 3, seed: 0xabcdef01 }],
  ["odd", "Weird skewed miniature", { complexity: 2, tempoBpm: 208, swing: 0.44, pitchSpanOctaves: 5.7, baseFrequencyHz: 73, roughness: 0.75, space: 0.72, seed: 0x13579bdf }],
];

export function algorithmicFullPresets(id) {
  const instrument = ALGORITHMIC_INSTRUMENTS.find(item => item.id === id);
  if (!instrument) throw new Error(`Unknown algorithmic instrument: ${id}`);
  return studies.map(([presetId, label, settings]) => ({
    id: presetId, label: `${instrument.title} · ${label}`,
    description: `${label} using ${instrument.title}'s own score generator, with complete timing, tone, space and deterministic seed.`,
    snapshot: {
      settings: sanitizeAlgorithmicScoreParams({
        ...instrument.defaults, seed: 0x51c0ffee, ...settings,
        algorithmId: id, output: Math.min(instrument.defaults.output, 0.5),
      }),
    },
  }));
}

export function randomizeAlgorithmicPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  return {
    settings: sanitizeAlgorithmicScoreParams({
      ...current.settings, // algorithm identity and master output are not dice.
      complexity: rng.integer(2, 7), tempoBpm: rng.integer(56, 208),
      swing: rng.between(0, 0.35), intensity: rng.between(0.45, 0.8),
      brightness: rng.between(0.15, 0.9), roughness: rng.between(0, 0.7),
      space: rng.between(0, 0.75), baseFrequencyHz: rng.between(55, 220),
      pitchSpanOctaves: rng.between(1.5, 4.5), seed: rng.integer(1, 0xffffffff),
      loop: rng.pick([true, false]),
      voice: rng.pick(["original", ...SEQUENCER_VOICES.map(({ id }) => id)]),
    }),
  };
}
