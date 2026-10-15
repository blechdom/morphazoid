import {
  WEBGPU_SYNTHS_LANE_TARGETS,
  WEBGPU_SYNTHS_MAX_LANES,
  WEBGPU_SYNTHS_MAX_MODEL_LAYERS,
  WEBGPU_SYNTHS_MIN_LANES,
  WEBGPU_SYNTHS_MODELS,
  WEBGPU_SYNTHS_ORGAN_RANK_COUNT,
  WEBGPU_SYNTHS_PARAM_ORDER,
  WEBGPU_SYNTHS_SCALES,
  createWebGpuSynthSequence,
  sanitizeWebGpuSynthLaneRoutes,
  sanitizeWebGpuSynthModelLayers,
  sanitizeWebGpuSynthOrganRanks,
  sanitizeWebGpuSynthParams,
  sanitizeWebGpuSynthSequence,
} from "./webgpu-synths.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const WEBGPU_SYNTHS_TECHNIQUE_IDS = Object.freeze(["euclid", "brownian", "cellular", "recurrence", "orbit", "noise"]);
const GENERATOR_IDS = Object.freeze([...WEBGPU_SYNTHS_TECHNIQUE_IDS, "custom"]);
const RANK_RATIOS = Object.freeze([0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12]);
const NON_CORE_TARGETS = Object.freeze(WEBGPU_SYNTHS_LANE_TARGETS.filter(({ core }) => !core).map(({ id }) => id));

export function captureWebGpuSynthsPreset(source) {
  const modelLayers = sanitizeWebGpuSynthModelLayers(source.modelLayers);
  const params = sanitizeWebGpuSynthParams({
    ...source.params, topology: modelLayers[0].model,
  });
  return {
    params,
    sequence: sanitizeWebGpuSynthSequence(source.sequence),
    laneRoutes: sanitizeWebGpuSynthLaneRoutes(source.laneRoutes),
    modelLayers,
    organRanks: sanitizeWebGpuSynthOrganRanks(source.organRanks),
    techniqueId: GENERATOR_IDS.includes(source.techniqueId) ? source.techniqueId : "custom",
  };
}

export function validateWebGpuSynthsPreset(snapshot) {
  const complete = snapshot?.params && Array.isArray(snapshot.sequence) && Array.isArray(snapshot.laneRoutes)
    && Array.isArray(snapshot.modelLayers) && Array.isArray(snapshot.organRanks)
    && snapshot.organRanks.length === WEBGPU_SYNTHS_ORGAN_RANK_COUNT
    && snapshot.modelLayers.length === WEBGPU_SYNTHS_MAX_MODEL_LAYERS
    && snapshot.laneRoutes.length === WEBGPU_SYNTHS_MAX_LANES
    && WEBGPU_SYNTHS_PARAM_ORDER.every(key => Number.isFinite(snapshot.params[key]));
  if (!complete || presetStateKey(snapshot) !== presetStateKey(captureWebGpuSynthsPreset(snapshot))) {
    throw new TypeError("Invalid complete GPU Synths preset");
  }
  return snapshot;
}

export function webGpuSynthsPresetEntry(definition, organRanks = undefined) {
  const params = sanitizeWebGpuSynthParams(definition.params);
  const sequence = createWebGpuSynthSequence(definition.technique, {
    steps: params.steps, seed: params.seed, variation: definition.variation,
  });
  return Object.freeze({
    id: definition.id, label: definition.label,
    snapshot: Object.freeze(validateWebGpuSynthsPreset(captureWebGpuSynthsPreset({
      params, sequence, laneRoutes: undefined, organRanks,
      modelLayers: [{ model: params.topology, level: 1, detune: 0, pan: 0 }],
      techniqueId: definition.technique,
    }))),
  });
}

const logBetween = (rng, minimum, maximum) => minimum * (maximum / minimum) ** rng.unit();

export function randomizeWebGpuSynthsPreset(current, random = Math.random) {
  validateWebGpuSynthsPreset(current);
  const rng = presetRandom(random);
  const layerCount = rng.pick([1, 1, 2, 2, 3]);
  const modelLayers = Array.from({ length: WEBGPU_SYNTHS_MAX_MODEL_LAYERS }, (_, index) => ({
    model: rng.integer(0, WEBGPU_SYNTHS_MODELS.length - 1),
    level: index === 0 ? rng.between(0.7, 1) : rng.between(0.25, 1),
    detune: index === 0 ? rng.between(-3, 3) : rng.between(-12, 12),
    pan: index === 0 ? rng.between(-0.3, 0.3) : rng.between(-0.8, 0.8),
  }));
  const steps = rng.pick([8, 12, 16, 16, 20, 24, 32]);
  const seed = rng.integer(1, 65_535);
  const technique = rng.pick(WEBGPU_SYNTHS_TECHNIQUE_IDS);
  const params = sanitizeWebGpuSynthParams({
    topology: modelLayers[0].model, modelMix: rng.unit(), layerCount, layerMode: rng.integer(0, 1),
    baseNote: rng.integer(24, 60), clock: logBetween(rng, 0.6, 12), steps,
    laneCount: rng.integer(3, WEBGPU_SYNTHS_MAX_LANES), glide: rng.between(0, 0.8),
    complexity: rng.between(0.3, 1), color: rng.unit(), motion: rng.unit(), decay: logBetween(rng, 0.08, 1.6),
    fold: rng.between(0, 0.6), space: rng.between(0.2, 1), chaos: rng.between(0, 0.7), swing: rng.between(0, 0.3),
    gain: rng.between(0.06, 0.105), seed, scale: rng.integer(0, WEBGPU_SYNTHS_SCALES.length - 1),
    acidPartials: rng.integer(4, 40), fmOperators: rng.integer(1, 6), foldLayers: rng.integer(1, 8),
    modalModes: rng.integer(4, 24), grainCount: rng.integer(2, 14), organRanks: rng.integer(3, WEBGPU_SYNTHS_ORGAN_RANK_COUNT),
    wavetableHarmonics: rng.integer(4, 48), formantVoices: rng.integer(2, 10),
    filterCutoff: logBetween(rng, 600, 16_000), filterTaps: rng.integer(2, 12) * 2 + 1, filterMix: rng.between(0, 0.6),
    delayTime: logBetween(rng, 0.03, 0.7), delayRepeats: rng.integer(1, 4), delayDecay: rng.between(0.1, 0.75),
    delayMix: rng.between(0, 0.4), shaperDrive: logBetween(rng, 1, 6), shaperFold: rng.between(0, 0.8),
    shaperMix: rng.between(0, 0.5), reverbSize: rng.between(0.3, 3), reverbDecay: rng.between(0.2, 0.9),
    reverbTaps: rng.pick([8, 16, 24, 32, 48, 64]), reverbMix: rng.between(0, 0.4),
  });
  const targets = [...NON_CORE_TARGETS];
  const laneRoutes = [0, 1, ...Array.from({ length: WEBGPU_SYNTHS_MAX_LANES - WEBGPU_SYNTHS_MIN_LANES }, () => (
    targets.splice(rng.integer(0, targets.length - 1), 1)[0]))];
  const organRanks = Array.from({ length: WEBGPU_SYNTHS_ORGAN_RANK_COUNT }, (_, index) => ({
    ratio: rng.pick(RANK_RATIOS), level: index === 2 ? rng.between(0.7, 1) : rng.between(0, 0.9),
    amRate: rng.between(0, 6), amDepth: rng.between(0, 0.3),
  }));
  const sequence = createWebGpuSynthSequence(technique, { steps, seed, variation: rng.between(0.1, 0.9) });
  return validateWebGpuSynthsPreset(captureWebGpuSynthsPreset({
    params, sequence, laneRoutes, modelLayers, organRanks, techniqueId: technique,
  }));
}
