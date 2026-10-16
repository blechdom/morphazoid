import { presetRandom } from "../../site/preset-random.js";

export const SPLICE_RING_PRESET_KEYS = Object.freeze(["splices", "chords", "speed", "crossfade", "useChords", "alternate"]);
export const SPLICE_RING_LIMITS = Object.freeze({ maxSplices: 12, maxPosition: 0.999, speed: [0.25, 2.5], crossfade: [0.002, 0.12] });

export function captureSpliceRingPreset({ splices, chords, params }) {
  return {
    splices: [...splices],
    chords: [...chords].map(([from, to]) => [from, to]).sort((a, b) => a[0] - b[0]),
    speed: params.speed, crossfade: params.crossfade, useChords: params.useChords, alternate: params.alternate,
  };
}

export function validateSpliceRingPreset(snapshot) {
  const { maxSplices, maxPosition, speed, crossfade } = SPLICE_RING_LIMITS;
  const ok = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length === SPLICE_RING_PRESET_KEYS.length
    && Array.isArray(snapshot.splices) && snapshot.splices.length >= 1 && snapshot.splices.length <= maxSplices
    && snapshot.splices.every((value, index) => Number.isFinite(value) && value >= 0 && value <= maxPosition
      && (index === 0 || value > snapshot.splices[index - 1]))
    && Array.isArray(snapshot.chords)
    && snapshot.chords.every((chord, index) => Array.isArray(chord) && chord.length === 2
      && chord.every(i => Number.isInteger(i) && i >= 0 && i < snapshot.splices.length) && chord[0] !== chord[1]
      && (index === 0 || chord[0] > snapshot.chords[index - 1][0]))
    && Number.isFinite(snapshot.speed) && snapshot.speed >= speed[0] && snapshot.speed <= speed[1]
    && Number.isFinite(snapshot.crossfade) && snapshot.crossfade >= crossfade[0] && snapshot.crossfade <= crossfade[1]
    && typeof snapshot.useChords === "boolean" && typeof snapshot.alternate === "boolean";
  if (!ok) throw new TypeError("Invalid complete Splice Ring preset");
  return snapshot;
}

const scene = (id, label, splices, chords, speed, crossfade, useChords = true, alternate = true) =>
  Object.freeze({ id, label, snapshot: Object.freeze(validateSpliceRingPreset({ splices, chords, speed, crossfade, useChords, alternate })) });

export const SPLICE_RING_FULL_PRESETS = Object.freeze([
  scene("four-way-ring", "Four-way ring", [0, 0.25, 0.55, 0.78], [], 1, 0.02),
  scene("plain-loop", "Plain loop", [0], [], 1, 0.02),
  scene("eight-step-stutter", "Eight-step stutter", [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], [[1, 0], [5, 4]], 1, 0.01),
  scene("tape-flip", "Tape flip", [0, 0.5], [], 0.5, 0.06),
  scene("chipmunk-shuffle", "Chipmunk shuffle", [0, 0.2, 0.4, 0.6, 0.8], [[0, 3], [2, 4], [4, 1]], 2, 0.005, true, false),
  scene("slow-drift", "Slow drift", [0, 0.3, 0.7], [[0, 2]], 0.35, 0.1),
  scene("pendulum", "Pendulum", [0, 0.25, 0.5, 0.75], [[1, 3], [3, 1]], 1.25, 0.02, true, false),
  scene("polymeter-five", "Polymeter five", [0, 0.2, 0.4, 0.6, 0.8], [[4, 2]], 1, 0.015),
  scene("glitch-confetti", "Glitch confetti", [0, 0.06, 0.11, 0.2, 0.33, 0.41, 0.58, 0.7, 0.83, 0.91], [[2, 0], [5, 1], [8, 6]], 1.6, 0.002),
  scene("chords-muted", "Chords muted", [0, 0.25, 0.5, 0.75], [[1, 3]], 1.5, 0.03, false, true),
  scene("hiccup", "Hiccup", [0, 0.45, 0.5, 0.95], [[1, 0], [3, 2]], 0.8, 0.03, true, false),
  scene("long-breath", "Long breath", [0, 0.7, 0.85], [[2, 1]], 0.6, 0.12),
]);

export function randomizeSpliceRingPreset(current, random = Math.random) {
  validateSpliceRingPreset(current);
  const rng = presetRandom(random);
  const count = rng.integer(2, 10);
  const splices = [];
  for (let i = 0; i < count; i++) {
    const cell = 1 / count;
    splices.push(Number(Math.min(SPLICE_RING_LIMITS.maxPosition, i * cell + rng.between(0.05, 0.85) * cell).toFixed(3)));
  }
  const chordCount = rng.integer(0, Math.min(4, count));
  const froms = [];
  while (froms.length < chordCount) {
    const from = rng.integer(0, count - 1);
    if (!froms.includes(from)) froms.push(from);
  }
  const chords = froms.sort((a, b) => a - b).map(from => {
    const to = (from + rng.integer(1, count - 1)) % count;
    return [from, to];
  });
  const [s0, s1] = SPLICE_RING_LIMITS.speed, [c0, c1] = SPLICE_RING_LIMITS.crossfade;
  return validateSpliceRingPreset({
    splices, chords,
    speed: Number(Math.exp(rng.between(Math.log(s0), Math.log(s1))).toFixed(2)),
    crossfade: Number(Math.exp(rng.between(Math.log(c0), Math.log(c1))).toFixed(3)),
    useChords: rng.unit() < 0.8, alternate: rng.unit() < 0.6,
  });
}
