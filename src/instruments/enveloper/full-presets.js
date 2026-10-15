import {
  ENVELOPER_LIMITS, ENVELOPER_MIN_SPLIT_GAP, ENVELOPER_PRESETS, createDefaultEnveloperLeafEnvelopes,
  sanitizeEnveloperState,
} from "./enveloper.js";
import { SEQUENCER_VOICES } from "../../sequencer-voice-renderer.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const ENVELOPER_VOICE_IDS = Object.freeze(["original", ...SEQUENCER_VOICES.map(({ id }) => id)]);
export const ENVELOPER_UI_RANGES = Object.freeze({ baseMidi: [24, 60], pitchSpan: [12, 48], fmAmount: [0.25, 1.5] });
const DEFAULT_SOUND = Object.freeze({ baseMidi: 47, pitchSpan: 30, fmAmount: 1, voice: "original" });

const clampNumber = (value, [min, max], fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);

export function captureEnveloperPreset(source) {
  return {
    tree: sanitizeEnveloperState(source.tree),
    baseMidi: Math.round(clampNumber(source.baseMidi, ENVELOPER_UI_RANGES.baseMidi, DEFAULT_SOUND.baseMidi)),
    pitchSpan: Math.round(clampNumber(source.pitchSpan, ENVELOPER_UI_RANGES.pitchSpan, DEFAULT_SOUND.pitchSpan)),
    fmAmount: clampNumber(source.fmAmount, ENVELOPER_UI_RANGES.fmAmount, DEFAULT_SOUND.fmAmount),
    voice: ENVELOPER_VOICE_IDS.includes(source.voice) ? source.voice : DEFAULT_SOUND.voice,
  };
}

export function validateEnveloperPreset(snapshot) {
  if (!snapshot?.tree || presetStateKey(snapshot) !== presetStateKey(captureEnveloperPreset(snapshot))) {
    throw new TypeError("Invalid complete Enveloper preset");
  }
  return snapshot;
}

const envelope = (times, levels) => ({ nodes: times.map((time, index) => ({ time, level: levels[index] })) });
const EVEN = [0, 1 / 3, 2 / 3, 1];

function scene(id, label, { cycle, root, branches, leaves, contour = 0, ...sound }) {
  const tree = {
    cycleSeconds: cycle,
    root: envelope(root[0] ?? EVEN, root[1]),
    branches: branches.map(([times, levels]) => envelope(times ?? EVEN, levels)),
    leaves: leaves.map(([pitch, timbre], index) => ({
      pitch, timbre, ...createDefaultEnveloperLeafEnvelopes((index + contour) % 9),
    })),
  };
  const snapshot = captureEnveloperPreset({ ...DEFAULT_SOUND, ...sound, tree });
  validateEnveloperPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
}

const legacy = ENVELOPER_PRESETS.map(preset => {
  const snapshot = captureEnveloperPreset({ ...DEFAULT_SOUND, tree: preset.state });
  return Object.freeze({ id: preset.id, label: preset.label, snapshot: Object.freeze(snapshot) });
});

export const ENVELOPER_FULL_PRESETS = Object.freeze([
  ...legacy,
  scene("sub-pulse", "Sub pulse", {
    cycle: 14, root: [[0, 0.3, 0.7, 1], [0.9, 1, 0.6, 0.4]], baseMidi: 28, pitchSpan: 20, fmAmount: 0.6, voice: "sine",
    branches: [[[0, 0.3, 0.6, 1], [0.8, 1, 0.5, 0.3]], [[0, 0.5, 0.75, 1], [1, 0.7, 0.9, 0.4]], [[0, 0.2, 0.5, 1], [0.6, 0.9, 0.7, 0.2]]],
    leaves: [[0.1, 0.1], [0.3, 0.2], [0.18, 0.3], [0.5, 0.15], [0.12, 0.25], [0.4, 0.1], [0.22, 0.2], [0.6, 0.3], [0.08, 0.12]],
  }),
  scene("bell-garden", "Bell garden", {
    cycle: 18, root: [[0, 0.25, 0.6, 1], [0.5, 1, 0.7, 0.9]], baseMidi: 52, pitchSpan: 30, fmAmount: 1.3, voice: "modal", contour: 3,
    branches: [[[0, 0.3, 0.55, 1], [0.7, 1, 0.5, 0.8]], [[0, 0.4, 0.7, 1], [0.9, 0.6, 1, 0.5]], [[0, 0.25, 0.5, 1], [0.5, 0.85, 0.65, 1]]],
    leaves: [[0.7, 0.9], [0.85, 0.6], [0.5, 0.75], [0.95, 0.5], [0.6, 0.95], [0.78, 0.7], [0.55, 0.85], [0.9, 0.4], [0.65, 0.8]],
  }),
  scene("slow-tide", "Slow tide", {
    cycle: 48, root: [[0, 0.4, 0.6, 1], [0.3, 1, 1, 0.3]], baseMidi: 36, pitchSpan: 36, fmAmount: 0.8, voice: "original", contour: 5,
    branches: [[[0, 0.4, 0.6, 1], [0.2, 0.9, 0.9, 0.2]], [[0, 0.4, 0.6, 1], [0.3, 1, 1, 0.3]], [[0, 0.4, 0.6, 1], [0.2, 0.8, 0.8, 0.1]]],
    leaves: [[0.3, 0.4], [0.42, 0.5], [0.55, 0.6], [0.48, 0.5], [0.62, 0.7], [0.75, 0.8], [0.4, 0.3], [0.5, 0.45], [0.35, 0.35]],
  }),
  scene("hard-stutter", "Hard stutter", {
    cycle: 4.5, root: [[0, 0.14, 0.3, 1], [1, 0.2, 1, 0.4]], baseMidi: 40, pitchSpan: 24, fmAmount: 1.5, voice: "analog", contour: 1,
    branches: [[[0, 0.12, 0.26, 1], [1, 0.1, 0.9, 0.2]], [[0, 0.1, 0.2, 1], [0.9, 0.2, 1, 0.1]], [[0, 0.16, 0.34, 1], [1, 0.3, 0.8, 0.3]]],
    leaves: [[0.4, 0.8], [0.4, 0.2], [0.6, 0.9], [0.3, 0.7], [0.3, 0.1], [0.5, 0.95], [0.35, 0.6], [0.7, 0.3], [0.2, 0.85]],
  }),
  scene("rising-stair", "Rising stair", {
    cycle: 8, root: [[0, 0.33, 0.66, 1], [0.3, 0.5, 0.75, 1]], baseMidi: 45, pitchSpan: 28, fmAmount: 0.9, voice: "pitched-morph", contour: 2,
    branches: [[[0, 0.33, 0.66, 1], [0.3, 0.6, 0.8, 1]], [[0, 0.33, 0.66, 1], [0.4, 0.7, 0.9, 1]], [[0, 0.33, 0.66, 1], [0.5, 0.8, 1, 1]]],
    leaves: [[0.1, 0.3], [0.2, 0.3], [0.3, 0.3], [0.4, 0.5], [0.5, 0.5], [0.6, 0.5], [0.7, 0.7], [0.8, 0.7], [0.9, 0.7]],
  }),
  scene("plucked-fog", "Plucked fog", {
    cycle: 22, root: [[0, 0.22, 0.58, 1], [0.4, 0.85, 0.6, 0.7]], baseMidi: 48, pitchSpan: 22, fmAmount: 0.7, voice: "karplus-strong", contour: 4,
    branches: [[[0, 0.18, 0.5, 1], [0.5, 0.9, 0.4, 0.6]], [[0, 0.36, 0.64, 1], [0.7, 0.5, 0.9, 0.3]], [[0, 0.3, 0.62, 1], [0.4, 0.7, 0.5, 0.9]]],
    leaves: [[0.45, 0.2], [0.65, 0.3], [0.35, 0.15], [0.7, 0.25], [0.5, 0.35], [0.8, 0.2], [0.4, 0.3], [0.6, 0.15], [0.55, 0.25]],
  }),
  scene("acid-ladder", "Acid ladder", {
    cycle: 6, root: [[0, 0.25, 0.5, 1], [0.8, 1, 0.7, 0.9]], baseMidi: 33, pitchSpan: 26, fmAmount: 1.2, voice: "simd-303", contour: 6,
    branches: [[[0, 0.25, 0.5, 1], [1, 0.6, 0.9, 0.4]], [[0, 0.25, 0.5, 1], [0.9, 0.5, 1, 0.5]], [[0, 0.25, 0.5, 1], [1, 0.7, 0.8, 0.3]]],
    leaves: [[0.2, 0.9], [0.5, 0.7], [0.35, 0.8], [0.6, 0.95], [0.25, 0.6], [0.7, 0.9], [0.3, 0.75], [0.8, 0.85], [0.45, 1]],
  }),
  scene("wide-chimes", "Wide chimes", {
    cycle: 30, root: [[0, 0.15, 0.85, 1], [0.2, 1, 1, 0.2]], baseMidi: 55, pitchSpan: 40, fmAmount: 1.1, voice: "rattlesnake", contour: 7,
    branches: [[[0, 0.2, 0.8, 1], [0.3, 1, 0.9, 0.3]], [[0, 0.15, 0.85, 1], [0.2, 0.9, 0.95, 0.2]], [[0, 0.25, 0.75, 1], [0.4, 1, 0.8, 0.4]]],
    leaves: [[0.98, 0.6], [0.6, 0.9], [0.2, 0.4], [0.9, 0.3], [0.5, 0.8], [0.1, 0.55], [0.8, 0.95], [0.4, 0.2], [0.7, 0.7]],
  }),
]);

const randomEnvelope = (rng, floor = 0) => {
  const first = rng.between(ENVELOPER_MIN_SPLIT_GAP, 0.55);
  const second = rng.between(first + ENVELOPER_MIN_SPLIT_GAP, 1 - ENVELOPER_MIN_SPLIT_GAP);
  return envelope([0, first, second, 1], [0, 1, 2, 3].map(() => rng.between(floor, 1)));
};

export function randomizeEnveloperPreset(current, random = Math.random) {
  validateEnveloperPreset(current);
  const rng = presetRandom(random);
  const { minimum, maximum } = ENVELOPER_LIMITS.cycleSeconds;
  const tree = {
    cycleSeconds: Math.exp(rng.between(Math.log(minimum), Math.log(Math.min(maximum, 60)))),
    root: randomEnvelope(rng, 0.1),
    branches: [0, 1, 2].map(() => randomEnvelope(rng, 0.05)),
    leaves: Array.from({ length: 9 }, () => ({
      pitch: rng.unit(), timbre: rng.unit(), pitchEnvelope: randomEnvelope(rng), indexEnvelope: randomEnvelope(rng),
    })),
  };
  return validateEnveloperPreset(captureEnveloperPreset({
    tree,
    baseMidi: rng.integer(...ENVELOPER_UI_RANGES.baseMidi),
    pitchSpan: rng.integer(...ENVELOPER_UI_RANGES.pitchSpan),
    fmAmount: rng.between(...ENVELOPER_UI_RANGES.fmAmount),
    voice: rng.pick(ENVELOPER_VOICE_IDS),
  }));
}
