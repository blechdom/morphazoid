import assert from "node:assert/strict";
import test from "node:test";
import {
  SLIDING_PUZZLE_FULL_PRESETS, SLIDING_PUZZLE_PRESET_KEYS, captureSlidingPuzzlePreset,
  randomizeSlidingPuzzlePreset, validateSlidingPuzzlePreset,
} from "../src/instruments/sliding-puzzle/full-presets.js";
import { applySlidingMoves, createSolvedSlidingPuzzle } from "../src/instruments/sliding-puzzle/sliding-puzzle.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flat = snapshot => ({ ...snapshot.settings, puzzle: snapshot.puzzle });

test("Sliding Puzzle bank is complete, valid and round-trips", () => {
  validateFullPresetBank(SLIDING_PUZZLE_FULL_PRESETS);
  for (const preset of SLIDING_PUZZLE_FULL_PRESETS) {
    assert.equal(validateSlidingPuzzlePreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureSlidingPuzzlePreset(flat(preset.snapshot)), preset.snapshot);
    assert.equal(Object.keys(preset.snapshot.settings).length, SLIDING_PUZZLE_PRESET_KEYS.length);
    const { rows, columns, tiles, moves } = preset.snapshot.puzzle;
    assert.deepEqual([...applySlidingMoves(createSolvedSlidingPuzzle(rows, columns), moves).tiles], tiles);
  }
  const sizes = new Set(SLIDING_PUZZLE_FULL_PRESETS.map(p => `${p.snapshot.puzzle.rows}x${p.snapshot.puzzle.columns}`));
  assert.ok(sizes.size >= 6);
});

test("Sliding Puzzle validation rejects damaged scenes and excludes session state", () => {
  const good = structuredClone(SLIDING_PUZZLE_FULL_PRESETS[2].snapshot);
  for (const key of ["output", "audioOn", "playing", "currentStep"]) assert.equal(Object.hasOwn(good.settings, key), false);
  assert.throws(() => validateSlidingPuzzlePreset({ settings: {}, puzzle: good.puzzle }), TypeError);
  const badTempo = structuredClone(good); badTempo.settings.tempo = 999;
  assert.throws(() => validateSlidingPuzzlePreset(badTempo), TypeError);
  const badTiles = structuredClone(good); badTiles.puzzle.tiles[0] = badTiles.puzzle.tiles[1];
  assert.throws(() => validateSlidingPuzzlePreset(badTiles), TypeError);
  const badMoves = structuredClone(good); badMoves.puzzle.moves = [1, 1, 1];
  assert.throws(() => validateSlidingPuzzlePreset(badMoves), TypeError);
  assert.throws(() => validateSlidingPuzzlePreset(null), TypeError);
});

test("Sliding Puzzle dice is pure, reproducible, bounded and varies every field", () => {
  const initial = SLIDING_PUZZLE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSlidingPuzzlePreset(initial, seed(5)), randomizeSlidingPuzzlePreset(SLIDING_PUZZLE_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(SLIDING_PUZZLE_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(SLIDING_PUZZLE_PRESET_KEYS.map(key => [key, new Set()]));
  const boards = new Set(), random = seed(77);
  for (let i = 0; i < 200; i++) {
    const result = randomizeSlidingPuzzlePreset(initial, random);
    validateSlidingPuzzlePreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const key of SLIDING_PUZZLE_PRESET_KEYS) seen.get(key).add(result.settings[key]);
    boards.add(`${result.puzzle.rows}x${result.puzzle.columns}:${result.puzzle.tiles}`);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(boards.size > 150);
  assert.throws(() => randomizeSlidingPuzzlePreset(initial, () => NaN), TypeError);
});
