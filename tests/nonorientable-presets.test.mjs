import assert from "node:assert/strict";
import test from "node:test";
import {
  KLEIN_FULL_PRESETS, MOEBIUS_FULL_PRESETS, captureNonorientablePreset, nonorientablePresetKeys,
  randomizeNonorientablePreset, validateNonorientablePreset,
} from "../src/families/nonorientable/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const banks = { moebius: MOEBIUS_FULL_PRESETS, klein: KLEIN_FULL_PRESETS };

for (const [kind, bank] of Object.entries(banks)) {
  test(`${kind} bank is complete, valid and distinct`, () => {
    validateFullPresetBank(bank);
    for (const { snapshot } of bank) {
      assert.equal(validateNonorientablePreset(kind, snapshot), snapshot);
      assert.deepEqual(Object.keys(snapshot).sort(), [...nonorientablePresetKeys(kind)].sort());
    }
    assert.throws(() => validateNonorientablePreset(kind, { ...bank[0].snapshot, soundMode: "saw" }), TypeError);
    assert.throws(() => validateNonorientablePreset(kind, { ...bank[0].snapshot, speed: 9 }), TypeError);
    assert.throws(() => validateNonorientablePreset(kind, { ...bank[0].snapshot, stray: 1 }), TypeError);
    assert.ok(new Set(bank.map(p => p.snapshot.soundMode)).size >= 4);
  });

  test(`${kind} capture round-trips and excludes session state`, () => {
    for (const { snapshot } of bank) {
      const state = { ...snapshot, level: 0.9, audio: true, playing: true, position: 0.3, continuousPosition: 2.3, presetId: "x" };
      const captured = captureNonorientablePreset(kind, state);
      assert.equal(presetStateKey(captured), presetStateKey(snapshot));
      for (const key of ["level", "audio", "playing", "position", "continuousPosition", "presetId"]) assert.equal(key in captured, false);
    }
  });

  test(`${kind} dice is pure, reproducible, valid and varies every field`, () => {
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(randomizeNonorientablePreset(kind, initial, seed(5)), randomizeNonorientablePreset(kind, bank[4].snapshot, seed(5)));
    assert.deepEqual(initial, before);
    const factory = new Set(bank.map(p => presetStateKey(p.snapshot)));
    const keys = nonorientablePresetKeys(kind);
    const seen = new Map(keys.map(key => [key, new Set()]));
    const random = seed(77);
    for (let i = 0; i < 300; i++) {
      const result = randomizeNonorientablePreset(kind, initial, random);
      validateNonorientablePreset(kind, result);
      assert.equal(factory.has(presetStateKey(result)), false);
      for (const key of keys) seen.get(key).add(result[key]);
    }
    for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
    assert.equal(seen.get("soundMode").size, 4);
    if (kind === "moebius") {
      assert.equal(seen.get("playMode").size, 2);
      assert.equal(seen.get("surfaceTwists").size, 3);
    }
  });
}
