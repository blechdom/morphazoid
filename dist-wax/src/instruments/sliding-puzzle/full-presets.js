import {
  SLIDING_PLAYBACK_MODES, SLIDING_READ_PATHS, applySlidingMoves, createSlidingPuzzleFromTiles,
  createSlidingPuzzleScramble, createSolvedSlidingPuzzle, normalizeSlidingRotation,
} from "./sliding-puzzle.js";
import { SEQUENCER_VOICES } from "../../sequencer-voice-renderer.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const SLIDING_PUZZLE_SOUND_BANKS = Object.freeze([
  ...SEQUENCER_VOICES.map(({ id }) => `shared-${id}`), "soft-fm", "analog", "modal", "noise", "acid-303",
]);
export const SLIDING_PUZZLE_SCALES = Object.freeze(["dorian", "minor-pentatonic", "whole-tone", "chromatic"]);
const DIRECTIONS = Object.freeze(["forward", "reverse", "pendulum", "random"]);
const DIVISIONS = Object.freeze([4, 8, 16, 32, 64]);
const MODES = Object.freeze(Object.keys(SLIDING_PLAYBACK_MODES));
const PATHS = Object.freeze(Object.keys(SLIDING_READ_PATHS));

const NUMERIC = Object.freeze({
  tempo: [36, 260], swing: [0, 0.42], brightness: [0, 1], decay: [0.08, 0.9], colorDepth: [0, 1],
  stereoWidth: [0, 1], pitchSpan: [12, 48], positionInfluence: [0, 2], filterInfluence: [0, 2],
  neighborResponse: [0, 2], disorderInfluence: [0, 2], microStrum: [0, 0.04], autoSlideSpeed: [0, 100],
});
export const SLIDING_PUZZLE_PRESET_KEYS = Object.freeze([
  ...Object.keys(NUMERIC), "pulseDivision", "playbackMode", "playbackDirection", "soundBank", "scale",
  "pathId", "rotationTurns", "squareLock", "autoSlide",
]);
export const SLIDING_PUZZLE_DEFAULT_SETTINGS = Object.freeze({
  tempo: 124, swing: 0, pulseDivision: 8, playbackMode: "parallel", playbackDirection: "forward",
  soundBank: "soft-fm", scale: "dorian", brightness: 0.62, decay: 0.42, colorDepth: 0.74,
  stereoWidth: 0.68, pitchSpan: 36, positionInfluence: 0.72, filterInfluence: 0.72, neighborResponse: 0.65,
  disorderInfluence: 0.6, microStrum: 0.012, autoSlideSpeed: 36, pathId: "rows", rotationTurns: 0,
  squareLock: true, autoSlide: false,
});

const clamp = (value, [min, max], fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const choice = (value, values, fallback) => (values.includes(value) ? value : fallback);

function sanitizePuzzle(source) {
  const rows = source?.rows, columns = source?.columns;
  const solved = createSolvedSlidingPuzzle(rows, columns);
  const puzzle = createSlidingPuzzleFromTiles(rows, columns, source.tiles);
  const out = { rows: solved.rows, columns: solved.columns, tiles: [...puzzle.tiles] };
  if (Array.isArray(source.moves)) {
    try {
      const replay = applySlidingMoves(solved, source.moves);
      if (presetStateKey([...replay.tiles]) === presetStateKey(out.tiles)) out.moves = [...source.moves];
    } catch { /* a history that does not reproduce the board is simply not recorded */ }
  }
  return out;
}

export function captureSlidingPuzzlePreset(source) {
  const settings = {};
  for (const key of SLIDING_PUZZLE_PRESET_KEYS) {
    const fallback = SLIDING_PUZZLE_DEFAULT_SETTINGS[key];
    const value = source[key];
    if (key in NUMERIC) settings[key] = clamp(value, NUMERIC[key], fallback);
    else if (key === "pulseDivision") settings[key] = choice(value, DIVISIONS, fallback);
    else if (key === "playbackMode") settings[key] = choice(value, MODES, fallback);
    else if (key === "playbackDirection") settings[key] = choice(value, DIRECTIONS, fallback);
    else if (key === "soundBank") settings[key] = choice(value, SLIDING_PUZZLE_SOUND_BANKS, fallback);
    else if (key === "scale") settings[key] = choice(value, SLIDING_PUZZLE_SCALES, fallback);
    else if (key === "pathId") settings[key] = choice(value, PATHS, fallback);
    else if (key === "rotationTurns") settings[key] = Number.isFinite(value) ? normalizeSlidingRotation(value) : fallback;
    else settings[key] = typeof value === "boolean" ? value : fallback;
  }
  return { settings, puzzle: sanitizePuzzle({ ...source.puzzle, moves: source.puzzle?.moves ?? source.history }) };
}

export function validateSlidingPuzzlePreset(snapshot) {
  let canonical;
  try {
    canonical = captureSlidingPuzzlePreset({ ...snapshot?.settings, puzzle: snapshot?.puzzle });
  } catch (error) { throw new TypeError(`Invalid complete Sliding Puzzle preset: ${error.message}`); }
  if (!snapshot?.settings || presetStateKey(snapshot) !== presetStateKey(canonical)) {
    throw new TypeError("Invalid complete Sliding Puzzle preset");
  }
  return snapshot;
}

const lcg = seed => { let value = seed >>> 0; return () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000; };

function scene(id, label, { rows = 4, columns = rows, moves = 0, seed = 1, ...settings }) {
  const solved = createSolvedSlidingPuzzle(rows, columns);
  const scramble = moves ? createSlidingPuzzleScramble(solved, { moves, random: lcg(seed) }) : { puzzle: solved, moves: [] };
  const snapshot = captureSlidingPuzzlePreset({
    ...SLIDING_PUZZLE_DEFAULT_SETTINGS, ...settings,
    puzzle: { rows, columns, tiles: [...scramble.puzzle.tiles], moves: [...scramble.moves] },
  });
  validateSlidingPuzzlePreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
}

export const SLIDING_PUZZLE_FULL_PRESETS = Object.freeze([
  scene("factory", "Factory · Soft FM dorian", {}),
  scene("pentatonic-bells", "Pentatonic bells · 3×3", { rows: 3, moves: 16, seed: 3, soundBank: "modal", scale: "minor-pentatonic", tempo: 92, pulseDivision: 8, decay: 0.68, brightness: 0.8, playbackMode: "serial", pathId: "snake" }),
  scene("acid-spiral", "Acid spiral · 4×4", { moves: 38, seed: 7, soundBank: "acid-303", scale: "dorian", tempo: 132, swing: 0.16, pulseDivision: 16, playbackMode: "serial", pathId: "spiral", decay: 0.3, filterInfluence: 1.5, brightness: 0.7 }),
  scene("whole-tone-drift", "Whole-tone drift · 5×5", { rows: 5, moves: 60, seed: 11, soundBank: "modal", scale: "whole-tone", tempo: 68, pulseDivision: 8, playbackMode: "serial", pathId: "rows", decay: 0.85, stereoWidth: 1, pitchSpan: 44, playbackDirection: "pendulum" }),
  scene("noise-grid-march", "Noise grid march · 4×6", { rows: 4, columns: 6, moves: 44, seed: 13, soundBank: "noise", scale: "chromatic", tempo: 148, pulseDivision: 16, decay: 0.16, positionInfluence: 1.6, neighborResponse: 1.3, squareLock: false }),
  scene("analog-lines", "Analog lines · 6×3", { rows: 6, columns: 3, moves: 30, seed: 17, soundBank: "analog", scale: "dorian", tempo: 112, swing: 0.22, microStrum: 0.03, brightness: 0.35, squareLock: false, rotationTurns: 1 }),
  scene("two-by-two-pulse", "Tiny pulse · 2×2", { rows: 2, moves: 5, seed: 5, soundBank: "soft-fm", scale: "minor-pentatonic", tempo: 210, pulseDivision: 16, playbackMode: "serial", decay: 0.2, pitchSpan: 24 }),
  scene("reverse-slow-burn", "Slow burn · Reverse", { rows: 4, moves: 24, seed: 19, soundBank: "shared-" + SEQUENCER_VOICES[0].id, scale: "dorian", tempo: 58, pulseDivision: 4, playbackDirection: "reverse", playbackMode: "serial", pathId: "snake", decay: 0.8, rotationTurns: 2 }),
  scene("wide-chromatic", "Wide chromatic · 8×2", { rows: 8, columns: 2, moves: 50, seed: 23, soundBank: "analog", scale: "chromatic", tempo: 176, pulseDivision: 32, decay: 0.12, pitchSpan: 48, colorDepth: 1, squareLock: false, rotationTurns: 3 }),
  scene("random-walk", "Random walk · Auto slide", { rows: 5, moves: 20, seed: 29, soundBank: "soft-fm", scale: "whole-tone", tempo: 100, playbackDirection: "random", playbackMode: "serial", pathId: "spiral", autoSlide: true, autoSlideSpeed: 62, disorderInfluence: 1.4 }),
  scene("glass-quartet", "Glass quartet · 3×4", { rows: 3, columns: 4, moves: 22, seed: 31, soundBank: "modal", scale: "minor-pentatonic", tempo: 84, swing: 0.1, brightness: 1, colorDepth: 0.3, stereoWidth: 1, decay: 0.75, squareLock: false }),
  scene("heavy-swing", "Heavy swing · 4×4", { moves: 32, seed: 37, soundBank: "analog", scale: "dorian", tempo: 96, swing: 0.4, pulseDivision: 8, decay: 0.5, brightness: 0.25, positionInfluence: 0.3, filterInfluence: 0.3 }),
  scene("fast-sixes", "Fast sixes · 6×6", { rows: 6, moves: 70, seed: 41, soundBank: "noise", scale: "whole-tone", tempo: 240, pulseDivision: 32, decay: 0.1, playbackMode: "serial", pathId: "rows", pitchSpan: 20 }),
]);

export function randomizeSlidingPuzzlePreset(current, random = Math.random) {
  validateSlidingPuzzlePreset(current);
  const rng = presetRandom(random);
  const rows = rng.integer(2, 6);
  const columns = rng.unit() < 0.55 ? rows : rng.integer(2, 6);
  const solved = createSolvedSlidingPuzzle(rows, columns);
  const scramble = createSlidingPuzzleScramble(solved, { moves: rng.integer(4, 12 + rows * columns * 2), random: rng.unit });
  const ranges = { ...NUMERIC, tempo: [56, 200], swing: [0, 0.38], pitchSpan: [14, 48], decay: [0.1, 0.88] };
  const numbers = Object.fromEntries(Object.keys(NUMERIC).map(key => [key, rng.between(...ranges[key])]));
  return validateSlidingPuzzlePreset(captureSlidingPuzzlePreset({
    ...numbers,
    pulseDivision: rng.pick([4, 8, 8, 16, 16, 32]), playbackMode: rng.pick(MODES), playbackDirection: rng.pick(DIRECTIONS),
    soundBank: rng.pick(SLIDING_PUZZLE_SOUND_BANKS), scale: rng.pick(SLIDING_PUZZLE_SCALES), pathId: rng.pick(PATHS),
    rotationTurns: rng.integer(0, 3), squareLock: rows === columns && rng.unit() < 0.8, autoSlide: rng.unit() < 0.25,
    puzzle: { rows, columns, tiles: [...scramble.puzzle.tiles], moves: [...scramble.moves] },
  }));
}
