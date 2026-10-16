import {
  MORPHISMA_SWEEP_DEFAULTS, MORPHISMA_SWEEP_PRESETS, SHEPARD_DEFAULTS, SHEPARD_MODES, SHEPARD_PRESETS,
  sanitizeMorphismaSweepParams, sanitizeShepardParams,
} from "./shepard-risset.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const SHEPARD_OCTAVE_KEYS = Object.freeze(["direction", "speed", "centerFrequency", "width", "spread", "cutoff"]);
export const SHEPARD_MORPHISMA_KEYS = Object.freeze(["direction", "voices", "sweepRate", "startFrequency", "sweepRange", "cutoff"]);
const MORPHISMA_CUTOFF_DEFAULT = MORPHISMA_SWEEP_DEFAULTS.cutoff;

const octaveMemory = (input = {}) => {
  const safe = sanitizeShepardParams({ ...SHEPARD_DEFAULTS, ...input, rate: input.rate ?? (input.speed ?? SHEPARD_DEFAULTS.rate) * (input.direction < 0 ? -1 : 1) });
  return { direction: safe.rate < 0 ? -1 : 1, speed: Math.abs(safe.rate), centerFrequency: safe.centerFrequency, width: safe.width, spread: safe.spread, cutoff: safe.cutoff };
};
const morphismaMemory = (input = {}) => {
  const safe = sanitizeMorphismaSweepParams({ ...MORPHISMA_SWEEP_DEFAULTS, ...input });
  const cutoff = sanitizeShepardParams({ cutoff: input.cutoff ?? MORPHISMA_CUTOFF_DEFAULT }).cutoff;
  return { direction: safe.direction, voices: safe.voices, sweepRate: safe.sweepRate, startFrequency: safe.startFrequency, sweepRange: safe.sweepRange, cutoff };
};

export function captureShepardPreset(state) {
  return {
    mode: state.mode === SHEPARD_MODES.MORPHISMA ? SHEPARD_MODES.MORPHISMA : SHEPARD_MODES.OCTAVE,
    octave: octaveMemory(state.octave),
    morphisma: morphismaMemory(state.morphisma),
  };
}

export function validateShepardPreset(snapshot) {
  if (!snapshot || ![SHEPARD_MODES.OCTAVE, SHEPARD_MODES.MORPHISMA].includes(snapshot.mode)
    || presetStateKey(snapshot) !== presetStateKey(captureShepardPreset(snapshot))) {
    throw new TypeError("Invalid complete Shepard-Risset preset");
  }
  return snapshot;
}

const octave = (label, mode, octaveInput, morphInput = {}) => ({ label, mode, octave: octaveInput, morphisma: morphInput });
const SCENES = [
  ...SHEPARD_PRESETS.map(p => ["octave-" + p.id, octave(`Octave · ${p.label}`, "octave", p)]),
  ["octave-glass-ladder", octave("Octave · Glass ladder", "octave", { centerFrequency: 880, rate: 0.3, width: 4, spread: 0.7, cutoff: 17_000 })],
  ["octave-slow-tide", octave("Octave · Slow tide", "octave", { centerFrequency: 110, rate: -0.03, width: 8.5, spread: 0.1, cutoff: 5_000 })],
  ["octave-whirl", octave("Octave · Whirl", "octave", { centerFrequency: 440, rate: 1.1, width: 3, spread: 0.9, cutoff: 16_000 })],
  ["octave-cavern", octave("Octave · Cavern", "octave", { centerFrequency: 55, rate: 0.05, width: 9, spread: 0.35, cutoff: 3_200 })],
  ...MORPHISMA_SWEEP_PRESETS.map(p => ["morphisma-" + p.id, octave(`Sweep · ${p.label}`, "morphisma", {}, p)]),
];

const deepFreeze = value => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
export const SHEPARD_FULL_PRESETS = Object.freeze(SCENES.map(([id, scene]) => Object.freeze({
  id, label: scene.label,
  snapshot: deepFreeze(captureShepardPreset({ mode: scene.mode, octave: scene.octave, morphisma: scene.morphisma })),
})));

const logBetween = (rng, low, high) => Math.exp(rng.between(Math.log(low), Math.log(high)));
const round = (value, digits = 3) => Number(value.toFixed(digits));

export function randomizeShepardPreset(current, random = Math.random) {
  validateShepardPreset(current);
  const rng = presetRandom(random);
  const direction = () => rng.pick([-1, 1]);
  return validateShepardPreset(captureShepardPreset({
    mode: rng.pick([SHEPARD_MODES.OCTAVE, SHEPARD_MODES.MORPHISMA]),
    octave: {
      direction: direction(), speed: round(logBetween(rng, 0.03, 1.6)), centerFrequency: round(logBetween(rng, 55, 1_100), 1),
      width: round(rng.between(3, 9), 2), spread: round(rng.between(0, 1), 2), cutoff: Math.round(logBetween(rng, 2_500, 18_000)),
    },
    morphisma: {
      direction: direction(), voices: rng.integer(1, 64), sweepRate: round(logBetween(rng, 0.02, 8)),
      startFrequency: round(logBetween(rng, 25, 2_400), 1), sweepRange: round(rng.between(0.1, 7), 2),
      cutoff: Math.round(logBetween(rng, 4_000, 18_000)),
    },
  }));
}
