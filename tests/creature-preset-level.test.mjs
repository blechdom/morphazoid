import assert from "node:assert/strict";
import test from "node:test";
import { CREATURAZOID_FULL_PRESETS, captureCreaturazoidPresetState, applyCreaturazoidPresetState, randomizeCreaturazoidPreset } from "../src/instruments/creaturazoid/full-presets.js";
import { HICCUP_HEAD_FULL_PRESETS, captureHiccupHeadPresetState, applyHiccupHeadPresetState, randomizeHiccupHeadPreset } from "../src/instruments/hiccup-head/full-presets.js";

for (const [name, bank, capture, apply, randomize, maxLevel] of [
  ["Creaturazoid", CREATURAZOID_FULL_PRESETS, captureCreaturazoidPresetState, applyCreaturazoidPresetState, randomizeCreaturazoidPreset, 1],
  ["Hiccup Head", HICCUP_HEAD_FULL_PRESETS, captureHiccupHeadPresetState, applyHiccupHeadPresetState, randomizeHiccupHeadPreset, 0.82],
]) {
  test(`${name}: factory, captured and randomized scenes exclude the master level`, () => {
    for (const { snapshot } of bank) {
      assert.equal(Object.hasOwn(snapshot.state, "level"), false);
      for (const level of [0, 0.23, maxLevel]) {
        const live = { ...snapshot.state, level };
        assert.deepEqual(capture(live), snapshot.state);
        assert.equal(live.level, level, "capture leaves the live level unchanged");
        assert.equal(Object.hasOwn(randomize({ ...snapshot, state: live }, () => 0.37).state, "level"), false);
      }
    }
  });

  test(`${name}: recall ignores legacy saved levels and retains a deliberate mute`, () => {
    for (const { snapshot } of bank) {
      for (const level of [0, 0.23, maxLevel]) {
        const legacy = Object.freeze({ ...snapshot.state, level: level === 0 ? 1 : 0 });
        const restored = apply(legacy, { level });
        assert.equal(restored.level, level);
        assert.deepEqual(capture(restored), snapshot.state, "all musical state still recalls");
        assert.notEqual(restored, legacy);
      }
    }
  });
}
