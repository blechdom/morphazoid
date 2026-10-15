import assert from "node:assert/strict";
import test from "node:test";
import {
  SLIDING_FULL_PRESETS, SLIDING_PRESET_KEYS, captureSlidingPreset, randomizeSlidingPreset, replaySlidingMoves, validateSlidingPreset,
} from "../src/instruments/rubixoids/sliding-puzzle/full-presets.js";
import {
  applySlidingMoves, createSolvedSlidingPuzzle, invertSlidingMoves, isSlidingPuzzleSolved,
} from "../src/instruments/rubixoids/sliding-puzzle/sliding-puzzle.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = snapshot => ({
  ...structuredClone(snapshot), puzzle: { rows: snapshot.rows, columns: snapshot.columns, tiles: [...snapshot.tiles] },
  output: 0.9, playing: true, audioOn: true, currentStep: 3, busy: false,
});

test("Sliding Puzzle bank is complete, valid, unwindable and varied", () => {
  validateFullPresetBank(SLIDING_FULL_PRESETS);
  for (const { snapshot } of SLIDING_FULL_PRESETS) {
    assert.equal(validateSlidingPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...SLIDING_PRESET_KEYS].sort());
  }
  const bank = SLIDING_FULL_PRESETS.map(preset => preset.snapshot);
  assert.ok(new Set(bank.map(s => s.soundBank)).size >= 10);
  assert.ok(new Set(bank.map(s => `${s.rows}x${s.columns}`)).size >= 8);
  assert.deepEqual([...new Set(bank.map(s => s.scale))].sort(), ["chromatic", "dorian", "minor-pentatonic", "whole-tone"]);
  assert.ok(bank.some(s => !isSlidingPuzzleSolved({ rows: s.rows, columns: s.columns, tiles: s.tiles })));
  const bad = structuredClone(bank[1]);
  [bad.tiles[0], bad.tiles[1]] = [bad.tiles[1], bad.tiles[0]];
  assert.throws(() => validateSlidingPreset(bad), TypeError);
  assert.throws(() => validateSlidingPreset({ ...bank[1], soundBank: "shared-simd-303" }), TypeError);
  assert.throws(() => validateSlidingPreset({ ...bank[1], tiles: [1, 2] }), TypeError);
});

test("Sliding Puzzle capture round-trips and excludes session state", () => {
  for (const { snapshot } of SLIDING_FULL_PRESETS) {
    const captured = captureSlidingPreset(toState(snapshot));
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["output", "playing", "audioOn", "currentStep", "busy"]) assert.equal(key in captured, false);
  }
});

test("replaying moves keeps the arrangement unwindable", () => {
  const { tiles, history } = replaySlidingMoves(4, 4, [15, 14, 10, 11, 7, 6, 2]);
  assert.ok(isSlidingPuzzleSolved(applySlidingMoves({ rows: 4, columns: 4, tiles }, invertSlidingMoves(history))));
  assert.notDeepEqual(tiles, createSolvedSlidingPuzzle(4, 4).tiles);
});

test("Sliding Puzzle dice is pure, reproducible, valid and varies every musical field", () => {
  const initial = SLIDING_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSlidingPreset(initial, seed(5)), randomizeSlidingPreset(SLIDING_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(SLIDING_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(SLIDING_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeSlidingPreset(initial, random);
    validateSlidingPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of SLIDING_PRESET_KEYS) seen.get(key).add(JSON.stringify(result[key]));
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(seen.get("rows").size >= 6);
  assert.ok(seen.get("soundBank").size >= 10);
});
