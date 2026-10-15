import {
  SIMD_SYNTH_FILTERS,
  SIMD_SYNTH_FX,
  SIMD_SYNTH_MOD_DESTINATIONS,
  SIMD_SYNTH_PARAM_ORDER,
  SIMD_SYNTH_SCALES,
  SIMD_SYNTH_SEQUENCE_LENGTH,
  SIMD_SYNTH_SOURCE_MODELS,
  createSimdSynthConfiguration,
  sanitizeSimdSynthModRoutes,
  sanitizeSimdSynthParams,
  sanitizeSimdSynthSequence,
} from "../../simd-synth.js";
import { SIMD_SYNTH_PRESETS } from "../../simd-synth-presets.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export function captureSimdSynthPreset(patch) {
  const { params, sequence, modRoutes } = createSimdSynthConfiguration(patch);
  return { params, sequence, modRoutes };
}

export function validateSimdSynthPreset(snapshot) {
  const complete = snapshot?.params && Array.isArray(snapshot.sequence) && Array.isArray(snapshot.modRoutes)
    && snapshot.sequence.length === SIMD_SYNTH_SEQUENCE_LENGTH && snapshot.modRoutes.length === 4
    && SIMD_SYNTH_PARAM_ORDER.every(key => Number.isFinite(snapshot.params[key]));
  if (!complete || presetStateKey(snapshot) !== presetStateKey(captureSimdSynthPreset(snapshot))) {
    throw new TypeError("Invalid complete SIMD Synth preset");
  }
  return snapshot;
}

export const SIMD_SYNTH_FULL_PRESETS = Object.freeze(SIMD_SYNTH_PRESETS.map(preset => Object.freeze({
  id: preset.id,
  label: preset.label,
  description: preset.description,
  snapshot: Object.freeze(validateSimdSynthPreset(captureSimdSynthPreset(preset))),
})));

const logBetween = (rng, minimum, maximum) => minimum * (maximum / minimum) ** rng.unit();

export function randomizeSimdSynthPreset(current, random = Math.random) {
  validateSimdSynthPreset(current);
  const rng = presetRandom(random);
  const scale = rng.integer(0, SIMD_SYNTH_SCALES.length - 1);
  const values = {
    sourceA: rng.integer(0, SIMD_SYNTH_SOURCE_MODELS.length - 1),
    sourceB: rng.integer(0, SIMD_SYNTH_SOURCE_MODELS.length - 1),
    tuneA: rng.pick([-12, -7, 0, 0, 0, 7, 12]), tuneB: rng.pick([-12, -5, 0, 7, 12, 19]),
    colorA: rng.unit(), colorB: rng.unit(), motionA: rng.unit(), motionB: rng.unit(),
    detailA: rng.integer(3, 24), detailB: rng.integer(3, 24),
    combine: rng.integer(0, 5), combineMix: rng.between(0.14, 0.84), combineDrive: rng.between(0.55, 2.65),
    shaper: rng.integer(0, 5), shaperAmount: rng.between(0, 0.58), toneOrder: rng.integer(0, 1),
    filter1: rng.integer(1, SIMD_SYNTH_FILTERS.length - 1), filter2: rng.integer(0, SIMD_SYNTH_FILTERS.length - 1),
    cutoff1: logBetween(rng, 280, 13_000), cutoff2: logBetween(rng, 340, 12_000),
    resonance1: rng.between(0, 0.82), resonance2: rng.between(0, 0.82),
    filterRoute: rng.integer(0, 5), filterBlend: rng.unit(),
    attack: logBetween(rng, 0.002, 0.6), decay: logBetween(rng, 0.08, 2), sustain: rng.between(0.08, 0.92),
    release: logBetween(rng, 0.08, 5), glide: rng.between(0, 0.4), stereo: rng.between(0.25, 1), drift: rng.between(0, 0.4),
    lfo1Rate: logBetween(rng, 0.05, 12), lfo2Rate: logBetween(rng, 0.05, 12),
    fx1: rng.integer(0, SIMD_SYNTH_FX.length - 1), fx2: rng.integer(0, SIMD_SYNTH_FX.length - 1),
    fx1Amount: rng.between(0, 0.58), fx2Amount: rng.between(0, 0.58),
    fx1Time: logBetween(rng, 0.003, 0.5), fx2Time: logBetween(rng, 0.003, 0.5),
    fx1Feedback: rng.between(0, 0.72), fx2Feedback: rng.between(0, 0.72), fxOrder: rng.integer(0, 1),
    bpm: rng.between(60, 170), swing: rng.between(0, 0.34), steps: rng.pick([8, 12, 16, 16, 16]),
    gateLength: rng.between(0.15, 1), rootNote: rng.integer(28, 62), scale,
    xyX: rng.unit(), xyY: rng.unit(), seed: rng.integer(1, 65_535),
  };
  const params = sanitizeSimdSynthParams(values);
  const intervals = SIMD_SYNTH_SCALES[scale].intervals;
  const pitches = [...intervals, ...intervals.map(step => step + 12)].filter(step => step <= 19);
  const motif = Array.from({ length: rng.pick([3, 4, 5, 8]) }, () => rng.pick(pitches));
  const density = rng.between(0.4, 0.9);
  const drift = rng.between(0.1, 0.45);
  const steps = Array.from({ length: SIMD_SYNTH_SEQUENCE_LENGTH }, (_, step) => [
    rng.unit() < drift ? rng.pick(pitches) : motif[step % motif.length],
    rng.unit() < (step % 4 === 0 ? 0.88 : density) ? 1 : 0,
    rng.between(0.4, 1) + (step % 4 === 0 ? 0.12 : 0),
    rng.unit() < 0.22 ? rng.between(0.15, 0.9) : 0,
  ]);
  if (!steps.some(step => step[1])) steps[0][1] = 1;
  const sequence = sanitizeSimdSynthSequence(steps);
  const destinations = SIMD_SYNTH_MOD_DESTINATIONS.map(({ id }) => id);
  const gestureDestination = rng.pick([6, 7, 10, 12]);
  const gestures = rng.pick([[8, 9], [9, 8]]);
  const modRoutes = sanitizeSimdSynthModRoutes([
    ...[0, 1].map(() => [rng.integer(1, 7), rng.pick(destinations), rng.pick([-1, 1]) * rng.between(0.18, 0.7), 0]),
    [gestures[0], gestureDestination, rng.between(0.4, 0.95), 0],
    [gestures[1], rng.pick([8, 9]), rng.between(0.6, 0.98), 0],
  ]);
  return validateSimdSynthPreset(captureSimdSynthPreset({ params, sequence, modRoutes }));
}
