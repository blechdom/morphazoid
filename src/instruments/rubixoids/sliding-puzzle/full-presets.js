import {
  appendSlidingMoveHistory, applySlidingMoves, createSlidingPuzzleScramble, createSolvedSlidingPuzzle,
  invertSlidingMoves, isSlidingPuzzleSolved, slidePuzzleTile, slidingPuzzleMoveTileIds,
} from "./sliding-puzzle.js";
import { presetStateKey } from "../../../site/header-presets.js";
import { presetRandom } from "../../../site/preset-random.js";

export const SLIDING_SOUND_BANKS = Object.freeze([
  "soft-fm", "analog", "modal", "noise", "acid-303", "shared-soft-fm", "shared-analog", "shared-modal", "shared-noise",
  "shared-rattlesnake", "shared-pitched-morph", "shared-karplus-strong", "shared-sine",
]);
export const SLIDING_SCALES = Object.freeze(["dorian", "minor-pentatonic", "whole-tone", "chromatic"]);
export const SLIDING_PLAYBACK_MODE_IDS = Object.freeze(["parallel", "serial"]);
export const SLIDING_PLAYBACK_DIRECTIONS = Object.freeze(["forward", "reverse", "pendulum", "random"]);
export const SLIDING_PATH_IDS = Object.freeze(["rows", "snake", "spiral"]);
export const SLIDING_PULSE_DIVISIONS = Object.freeze([4, 8, 16, 32, 64]);
export const SLIDING_NUMBER_SPECS = Object.freeze({
  tempo: [30, 300, 1], swing: [0, 0.42, 0.01], brightness: [0, 1, 0.01], decay: [0.08, 0.9, 0.01], colorDepth: [0, 1, 0.01],
  stereoWidth: [0, 1, 0.01], pitchSpan: [12, 48, 1], positionInfluence: [0, 2, 0.01], filterInfluence: [0, 2, 0.01],
  neighborResponse: [0, 2, 0.01], disorderInfluence: [0, 2, 0.01], microStrum: [0, 0.04, 0.001], autoSlideSpeed: [0, 100, 1],
});
export const SLIDING_PRESET_KEYS = Object.freeze([
  "rows", "columns", "squareLock", "tiles", "history", "rotationTurns", "autoSlide", "pulseDivision", "playbackMode",
  "playbackDirection", "pathId", "soundBank", "scale", ...Object.keys(SLIDING_NUMBER_SPECS),
]);
const MAX_HISTORY = 2_000;

const snap = (key, value) => {
  const [min, max, step] = SLIDING_NUMBER_SPECS[key];
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
};

/** The same move/inverse bookkeeping the app performs for every click. */
export function replaySlidingMoves(rows, columns, moves) {
  let puzzle = createSolvedSlidingPuzzle(rows, columns);
  let history = Object.freeze([]);
  for (const tileId of moves) {
    const moved = slidingPuzzleMoveTileIds(puzzle, tileId);
    puzzle = slidePuzzleTile(puzzle, tileId);
    history = appendSlidingMoveHistory(history, tileId, moved[0]);
  }
  return { tiles: [...puzzle.tiles], history: [...history] };
}

export function captureSlidingPreset(state) {
  const { rows, columns, tiles } = state.puzzle;
  return {
    rows, columns, squareLock: Boolean(state.squareLock), tiles: [...tiles], history: [...state.history],
    rotationTurns: state.rotationTurns, autoSlide: Boolean(state.autoSlide), pulseDivision: state.pulseDivision,
    playbackMode: state.playbackMode, playbackDirection: state.playbackDirection, pathId: state.pathId,
    soundBank: state.soundBank, scale: state.scale,
    ...Object.fromEntries(Object.keys(SLIDING_NUMBER_SPECS).map(key => [key, state[key]])),
  };
}

export function validateSlidingPreset(snapshot) {
  const bad = () => { throw new TypeError("Invalid complete Sliding Puzzle preset"); };
  presetStateKey(snapshot);
  if (Object.keys(snapshot).length !== SLIDING_PRESET_KEYS.length) bad();
  const { rows, columns } = snapshot;
  for (const dimension of [rows, columns]) if (!Number.isInteger(dimension) || dimension < 2 || dimension > 8) bad();
  const cells = rows * columns;
  if (!Array.isArray(snapshot.tiles) || snapshot.tiles.length !== cells
    || new Set(snapshot.tiles).size !== cells || snapshot.tiles.some(tile => !Number.isInteger(tile) || tile < 0 || tile >= cells)) bad();
  if (!Array.isArray(snapshot.history) || snapshot.history.length > MAX_HISTORY
    || snapshot.history.some(tile => !Number.isInteger(tile) || tile < 1 || tile >= cells)) bad();
  const puzzle = { rows, columns, tiles: snapshot.tiles };
  if (!isSlidingPuzzleSolved(applySlidingMoves(puzzle, invertSlidingMoves(snapshot.history)))) bad();
  if (!Number.isInteger(snapshot.rotationTurns) || Math.abs(snapshot.rotationTurns) > 100_000) bad();
  for (const key of ["squareLock", "autoSlide"]) typeof snapshot[key] === "boolean" || bad();
  const oneOf = (value, list) => list.includes(value) || bad();
  oneOf(snapshot.pulseDivision, SLIDING_PULSE_DIVISIONS);
  oneOf(snapshot.playbackMode, SLIDING_PLAYBACK_MODE_IDS);
  oneOf(snapshot.playbackDirection, SLIDING_PLAYBACK_DIRECTIONS);
  oneOf(snapshot.pathId, SLIDING_PATH_IDS);
  oneOf(snapshot.soundBank, SLIDING_SOUND_BANKS);
  oneOf(snapshot.scale, SLIDING_SCALES);
  for (const [key, [min, max]] of Object.entries(SLIDING_NUMBER_SPECS)) {
    if (typeof snapshot[key] !== "number" || snapshot[key] < min || snapshot[key] > max) bad();
  }
  return snapshot;
}

const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);

const DEFAULTS = Object.freeze({
  rows: 4, columns: 4, squareLock: true, scramble: 0, rotationTurns: 0, autoSlide: false, pulseDivision: 8,
  playbackMode: "parallel", playbackDirection: "forward", pathId: "rows", soundBank: "soft-fm", scale: "dorian",
  tempo: 124, swing: 0, brightness: 0.62, decay: 0.42, colorDepth: 0.74, stereoWidth: 0.68, pitchSpan: 36,
  positionInfluence: 0.72, filterInfluence: 0.72, neighborResponse: 0.65, disorderInfluence: 0.6, microStrum: 0.012,
  autoSlideSpeed: 36,
});

const scene = (id, label, patch = {}, seed = 1) => {
  const { scramble, ...merged } = { ...DEFAULTS, ...patch };
  const solved = createSolvedSlidingPuzzle(merged.rows, merged.columns);
  const moves = scramble ? createSlidingPuzzleScramble(solved, { moves: scramble, random: seeded(seed) }).moves : [];
  const snapshot = {
    ...merged, ...replaySlidingMoves(merged.rows, merged.columns, moves),
    ...Object.fromEntries(Object.keys(SLIDING_NUMBER_SPECS).map(key => [key, snap(key, merged[key])])),
  };
  validateSlidingPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const SLIDING_FULL_PRESETS = Object.freeze([
  scene("soft-fm-classic", "Soft FM classic"),
  scene("pentatonic-garden", "Pentatonic garden", { rows: 5, columns: 5, scramble: 24, scale: "minor-pentatonic", soundBank: "analog", tempo: 96, brightness: 0.5, playbackMode: "serial", pathId: "snake" }, 3),
  scene("whole-tone-drift", "Whole-tone drift", { scramble: 18, scale: "whole-tone", soundBank: "modal", playbackMode: "serial", pathId: "spiral", playbackDirection: "pendulum", tempo: 84, decay: 0.6, stereoWidth: 0.9 }, 5),
  scene("chromatic-scramble", "Chromatic scramble", { rows: 6, columns: 6, scramble: 40, scale: "chromatic", soundBank: "noise", tempo: 140, pulseDivision: 16, colorDepth: 1, pitchSpan: 44, disorderInfluence: 1.4 }, 7),
  scene("acid-ladder", "Acid ladder", { scramble: 20, soundBank: "acid-303", tempo: 132, pulseDivision: 16, brightness: 0.82, decay: 0.3, rotationTurns: 1, filterInfluence: 1.5, pitchSpan: 24 }, 11),
  scene("rattlesnake-rows", "Rattlesnake rows", { rows: 3, columns: 5, squareLock: false, scramble: 16, soundBank: "shared-rattlesnake", tempo: 108, swing: 0.12, positionInfluence: 1.2 }, 13),
  scene("harp-snake", "Harp snake", { rows: 5, columns: 5, scramble: 22, soundBank: "shared-karplus-strong", playbackMode: "serial", pathId: "snake", tempo: 90, decay: 0.78, brightness: 0.7, scale: "minor-pentatonic" }, 17),
  scene("mallet-spiral", "Mallet spiral", { rows: 6, columns: 6, scramble: 30, soundBank: "shared-pitched-morph", playbackMode: "serial", pathId: "spiral", tempo: 100, pitchSpan: 30, neighborResponse: 1.4 }, 19),
  scene("sine-fog", "Sine fog", { rows: 8, columns: 8, scramble: 56, soundBank: "shared-sine", scale: "whole-tone", tempo: 60, pulseDivision: 4, stereoWidth: 1, decay: 0.85, colorDepth: 0.3, positionInfluence: 0.3 }, 23),
  scene("swing-shuffle", "Swing shuffle", { scramble: 14, soundBank: "shared-analog", tempo: 112, swing: 0.32, pulseDivision: 16, microStrum: 0.03, decay: 0.3 }, 29),
  scene("reverse-waterfall", "Reverse waterfall", { rows: 4, columns: 6, squareLock: false, scramble: 26, soundBank: "shared-modal", playbackDirection: "reverse", rotationTurns: 2, pulseDivision: 32, tempo: 76, decay: 0.7 }, 31),
  scene("random-pass-maze", "Random pass maze", { rows: 7, columns: 7, scramble: 50, soundBank: "shared-noise", playbackDirection: "random", tempo: 150, pulseDivision: 16, neighborResponse: 1.9, brightness: 0.9 }, 37),
  scene("auto-slide-ambient", "Auto slide ambient", { rows: 5, columns: 5, scramble: 10, soundBank: "shared-soft-fm", autoSlide: true, autoSlideSpeed: 22, tempo: 72, decay: 0.8, stereoWidth: 0.95, scale: "dorian" }, 41),
  scene("tiny-ticks", "Tiny ticks", { rows: 2, columns: 3, squareLock: false, scramble: 6, soundBank: "shared-sine", tempo: 180, pulseDivision: 32, pitchSpan: 20, decay: 0.15, brightness: 0.9 }, 43),
]);

export function randomizeSlidingPreset(current, random = Math.random) {
  presetStateKey(current);
  const rng = presetRandom(random);
  const rows = rng.integer(2, 8);
  const columns = rng.unit() < 0.5 ? rows : rng.integer(2, 8);
  const cells = rows * columns;
  const moveCount = Math.min(64, Math.max(6, Math.round(cells * rng.between(0.6, 2.4))));
  const moves = createSlidingPuzzleScramble(createSolvedSlidingPuzzle(rows, columns), { moves: moveCount, random: rng.unit }).moves;
  const next = {
    rows, columns, squareLock: rows === columns && rng.unit() < 0.6, ...replaySlidingMoves(rows, columns, moves),
    rotationTurns: rng.integer(-3, 3), autoSlide: rng.unit() < 0.2, pulseDivision: rng.pick(SLIDING_PULSE_DIVISIONS),
    playbackMode: rng.pick(SLIDING_PLAYBACK_MODE_IDS), playbackDirection: rng.pick(SLIDING_PLAYBACK_DIRECTIONS),
    pathId: rng.pick(SLIDING_PATH_IDS), soundBank: rng.pick(SLIDING_SOUND_BANKS), scale: rng.pick(SLIDING_SCALES),
    tempo: snap("tempo", rng.between(60, 170)), swing: snap("swing", rng.unit() < 0.4 ? 0 : rng.between(0, 0.38)),
    brightness: snap("brightness", rng.between(0.2, 1)), decay: snap("decay", rng.between(0.12, 0.85)),
    colorDepth: snap("colorDepth", rng.unit()), stereoWidth: snap("stereoWidth", rng.unit()),
    pitchSpan: snap("pitchSpan", rng.between(16, 46)), positionInfluence: snap("positionInfluence", rng.between(0, 2)),
    filterInfluence: snap("filterInfluence", rng.between(0, 2)), neighborResponse: snap("neighborResponse", rng.between(0, 2)),
    disorderInfluence: snap("disorderInfluence", rng.between(0, 2)), microStrum: snap("microStrum", rng.between(0, 0.04)),
    autoSlideSpeed: snap("autoSlideSpeed", rng.between(8, 70)),
  };
  return validateSlidingPreset(next);
}
