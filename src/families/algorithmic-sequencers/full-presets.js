import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";
import { SEQUENCER_VOICES } from "../../sequencer-voices.js";
import { SORT_ALGORITHM_PRESETS, sanitizeSortSequencerParams } from "./algorithmic-sequencers.js";

export const SORT_PRESET_KEYS = Object.freeze([
  "voice", "algorithmId", "dataSeed", "size", "tempo", "baseFrequencyHz", "pitchSpanOctaves", "noteSeconds",
]);
const VOICE_IDS = Object.freeze(["original", ...SEQUENCER_VOICES.map(({ id }) => id)]);

export function captureSortPreset(settings) {
  const safe = sanitizeSortSequencerParams(settings);
  return Object.fromEntries(SORT_PRESET_KEYS.map(key => [key, safe[key]]));
}

export function validateSortPreset(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || Object.keys(snapshot).length !== SORT_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(captureSortPreset(snapshot))
    || !VOICE_IDS.includes(snapshot.voice)) {
    throw new TypeError("Invalid complete Sorting Algorithms preset");
  }
  return captureSortPreset(snapshot);
}

const scene = (id, label, description, settings) => Object.freeze({
  id, label, description, snapshot: Object.freeze(captureSortPreset(settings)),
});

export const SORT_FULL_PRESETS = Object.freeze([
  scene("quick-classic", "Quick · Original tones", "Pivot calls and replies in the original sorting voice.",
    { voice: "original", algorithmId: "quick", dataSeed: 0x5eed1234, size: 48, tempo: 18, baseFrequencyHz: 180, pitchSpanOctaves: 3.2, noteSeconds: 0.065 }),
  scene("bubble-sweeps", "Bubble · Sine sweeps", "Rising adjacent sweeps on a pure sine over a small field.",
    { voice: "sine", algorithmId: "bubble", dataSeed: 11, size: 32, tempo: 30, baseFrequencyHz: 110, pitchSpanOctaves: 2.5, noteSeconds: 0.05 }),
  scene("insertion-lullaby", "Insertion · Plucked lullaby", "Slow backward runs on plucked strings, one value at a time.",
    { voice: "karplus-strong", algorithmId: "insertion", dataSeed: 20261015, size: 24, tempo: 8, baseFrequencyHz: 196, pitchSpanOctaves: 2, noteSeconds: 0.2 }),
  scene("selection-scans", "Selection · Modal scans", "Long minimum scans ring as modal percussion with cadence swaps.",
    { voice: "modal", algorithmId: "selection", dataSeed: 4242, size: 40, tempo: 14, baseFrequencyHz: 130, pitchSpanOctaves: 3.5, noteSeconds: 0.12 }),
  scene("merge-cathedral", "Merge · Mallet cathedral", "Layered split-and-join phrases across a wide register on mallets.",
    { voice: "pitched-morph", algorithmId: "merge", dataSeed: 777, size: 64, tempo: 22, baseFrequencyHz: 98, pitchSpanOctaves: 4, noteSeconds: 0.16 }),
  scene("quick-chiptune", "Quick · Chiptune sprint", "Fast pivot partitions on a bright square-wave chip voice.",
    { voice: "simd-chiptune", algorithmId: "quick", dataSeed: 31337, size: 56, tempo: 28, baseFrequencyHz: 261, pitchSpanOctaves: 3, noteSeconds: 0.04 }),
  scene("bubble-acid", "Bubble · Acid ladder", "Short bubble passes through a 303 line, low and squelchy.",
    { voice: "simd-303", algorithmId: "bubble", dataSeed: 909, size: 20, tempo: 40, baseFrequencyHz: 82, pitchSpanOctaves: 1.5, noteSeconds: 0.03 }),
  scene("merge-fm-bells", "Merge · FM bells", "Slow merges struck as soft FM bells with long decays.",
    { voice: "soft-fm", algorithmId: "merge", dataSeed: 5150, size: 32, tempo: 12, baseFrequencyHz: 330, pitchSpanOctaves: 2.2, noteSeconds: 0.24 }),
  scene("insertion-noise-rain", "Insertion · Noise rain", "A dense field of insertion steps becomes a rapid noise-kit patter.",
    { voice: "noise", algorithmId: "insertion", dataSeed: 8086, size: 96, tempo: 55, baseFrequencyHz: 200, pitchSpanOctaves: 3, noteSeconds: 0.02 }),
  scene("selection-rattle", "Selection · Rattlesnake", "Sparse, slow scans with rattling modal-plus-FM hits.",
    { voice: "rattlesnake", algorithmId: "selection", dataSeed: 1999, size: 16, tempo: 6, baseFrequencyHz: 150, pitchSpanOctaves: 1.2, noteSeconds: 0.3 }),
  scene("quick-deep-field", "Quick · Deep field", "A 128-value field at high speed on a SIMD synth, spanning five octaves.",
    { voice: "simd-synth", algorithmId: "quick", dataSeed: 65537, size: 128, tempo: 60, baseFrequencyHz: 80, pitchSpanOctaves: 5, noteSeconds: 0.018 }),
  scene("merge-analog-pulse", "Merge · Analog pulse", "Mid-sized merges as an analog drum kit pulse.",
    { voice: "analog", algorithmId: "merge", dataSeed: 303, size: 48, tempo: 16, baseFrequencyHz: 146, pitchSpanOctaves: 3.2, noteSeconds: 0.09 }),
  scene("bubble-slow-glass", "Bubble · Slow glass", "Twelve values in unhurried, glassy high sweeps with sustained tones.",
    { voice: "original", algorithmId: "bubble", dataSeed: 2718, size: 12, tempo: 3, baseFrequencyHz: 440, pitchSpanOctaves: 0.8, noteSeconds: 0.32 }),
  scene("quick-wide-gong", "Quick · Wide gong", "Eight values spread over five octaves: huge leaps, long pitched mallets.",
    { voice: "pitched-morph", algorithmId: "quick", dataSeed: 1618, size: 8, tempo: 4, baseFrequencyHz: 87, pitchSpanOctaves: 5, noteSeconds: 0.3 }),
]);

export function randomizeSortPreset(current, random = Math.random) {
  validateSortPreset(current);
  const rng = presetRandom(random);
  const size = rng.integer(8, 128);
  const tempo = Math.exp(rng.between(Math.log(Math.max(3, size / 8)), Math.log(60)));
  const noteSeconds = Math.exp(rng.between(Math.log(0.02), Math.log(Math.min(0.3, Math.max(0.03, 2.2 / tempo)))));
  return validateSortPreset(captureSortPreset({
    voice: rng.pick(VOICE_IDS),
    algorithmId: rng.pick(SORT_ALGORITHM_PRESETS).id,
    dataSeed: rng.integer(1, 0xffffffff),
    size, tempo, noteSeconds,
    baseFrequencyHz: Math.exp(rng.between(Math.log(80), Math.log(880))),
    pitchSpanOctaves: rng.between(0.8, 4.8),
  }));
}
