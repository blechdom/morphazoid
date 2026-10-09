import assert from "node:assert/strict";
import test from "node:test";
import { chaoticAmPresets } from "../src/instruments/chaotic-am/full-presets.js";

function seeded(seed = 731) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test("Chaotic AM full scenes round trip, preserve ownership boundaries and reject invalid recall", () => {
  const { bank, capture, validate } = chaoticAmPresets;
  assert.equal(bank.length, 12);
  assert.equal(new Set(bank.map(preset => preset.id)).size, 12);
  assert.equal(new Set(bank.map(preset => JSON.stringify(preset.snapshot.settings))).size, 12);
  for (const preset of bank) {
    assert.deepEqual(validate(preset.snapshot), preset.snapshot);
    assert.ok(Object.isFrozen(preset.snapshot.settings));
    const state = { ...preset.snapshot, output: 0, audio: true, notes: [60, 67],
      settings: { ...preset.snapshot.settings, maximumFrequencyHz: 20000 },
      performance: { ...preset.snapshot.performance, playMode: "midi", expression: 0.3 } };
    const snapshot = capture(state);
    assert.deepEqual(snapshot, preset.snapshot);
    snapshot.settings.carrierHz = 99;
    assert.equal(state.settings.carrierHz, preset.snapshot.settings.carrierHz, "capture must be detached");
  }
  const original = bank[0].snapshot;
  for (const group of ["settings", "performance"]) {
    for (const key of Object.keys(original[group])) {
      const missing = structuredClone(original);
      delete missing[group][key];
      assert.throws(() => validate(missing), TypeError);
      for (const bad of [NaN, Infinity, -Infinity, -99999, "invalid"]) {
        const invalid = structuredClone(original);
        invalid[group][key] = bad;
        const before = structuredClone(invalid);
        assert.throws(() => validate(invalid), TypeError, `${group}.${key}`);
        assert.deepEqual(invalid, before, "validation cannot partially mutate state");
      }
    }
  }
  assert.throws(() => validate({ ...original, version: 2 }), TypeError);
  assert.throws(() => validate({ ...original, activePresetId: "unknown" }), TypeError);
});

test("Chaotic AM dice is deterministic, bounded and varies every owned musical parameter", () => {
  const { bank, randomize, validate } = chaoticAmPresets;
  const current = structuredClone(bank[0].snapshot);
  const before = structuredClone(current);
  const rng = seeded(), replay = seeded();
  const scenes = Array.from({ length: 256 }, () => randomize(current, rng));
  assert.deepEqual(scenes, Array.from({ length: 256 }, () => randomize(current, replay)));
  assert.deepEqual(current, before);
  for (const scene of scenes) {
    assert.deepEqual(validate(scene), scene);
    assert.equal(scene.activePresetId, null);
    assert.ok(scene.performance.ampAttackMs <= 50);
    assert.ok(scene.settings.carrierHz >= 140 && scene.settings.carrierHz <= 1000);
  }
  for (const group of ["settings", "performance"]) {
    for (const key of Object.keys(current[group])) {
      assert.ok(new Set(scenes.map(scene => scene[group][key])).size > 1, `${group}.${key} is frozen`);
    }
  }
  for (const value of [-1, 0, 1, 2]) assert.deepEqual(validate(randomize(current, () => value)), randomize(current, () => value));
});
