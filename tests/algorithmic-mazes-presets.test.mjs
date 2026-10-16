import assert from "node:assert/strict";
import test from "node:test";
import { generateMaze, sanitizeMazeSettings } from "../src/instruments/algorithmic-mazes/algorithmic-mazes.js";
import {
  MAZE_FULL_PRESETS, MAZE_PRESET_KEYS, captureMazePreset, randomizeMazePreset, validateMazePreset,
} from "../src/instruments/algorithmic-mazes/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Algorithmic Mazes bank is complete, valid and generates real mazes", () => {
  validateFullPresetBank(MAZE_FULL_PRESETS);
  for (const { snapshot } of MAZE_FULL_PRESETS) {
    assert.equal(validateMazePreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...MAZE_PRESET_KEYS].sort());
    const settings = sanitizeMazeSettings(snapshot);
    for (const key of Object.keys(settings)) assert.equal(settings[key], snapshot[key]);
    assert.ok(generateMaze(settings).cells.length > 0);
  }
  for (const key of ["algorithm", "topology", "mode", "voiceEngine"]) {
    assert.ok(new Set(MAZE_FULL_PRESETS.map(p => p.snapshot[key])).size >= 3, key);
  }
  assert.throws(() => validateMazePreset({ ...MAZE_FULL_PRESETS[0].snapshot, mode: "dance" }), TypeError);
  assert.throws(() => validateMazePreset({ ...MAZE_FULL_PRESETS[0].snapshot, size: 99 }), TypeError);
  assert.throws(() => validateMazePreset({ ...MAZE_FULL_PRESETS[0].snapshot, mode: "solve", showSolution: false }), TypeError);
});

test("Algorithmic Mazes capture round-trips and excludes session state", () => {
  for (const { snapshot } of MAZE_FULL_PRESETS) {
    const state = { ...snapshot, level: 0.9, audio: true, playing: false, position: 0.4, startNode: 3, targetNode: 9, solution: [1] };
    const captured = captureMazePreset(state);
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["level", "audio", "playing", "position", "startNode", "targetNode", "solution"]) assert.equal(key in captured, false);
  }
});

test("Algorithmic Mazes dice is pure, reproducible, valid and varies every field", () => {
  const initial = MAZE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeMazePreset(initial, seed(5)), randomizeMazePreset(MAZE_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(MAZE_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(MAZE_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 300; i++) {
    const result = randomizeMazePreset(initial, random);
    validateMazePreset(result);
    assert.ok(result.passageHeads + result.wallHeads > 0);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of MAZE_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  for (const [key, count] of [["algorithm", 4], ["cycleBehavior", 3], ["voiceEngine", 4], ["passagePitch", 4], ["wallPitch", 4]]) assert.equal(seen.get(key).size, count);
  assert.equal(seen.get("mode").size, 4);
  assert.equal(seen.get("topology").size, 3);
});
