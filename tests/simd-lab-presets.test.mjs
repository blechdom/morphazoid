import assert from "node:assert/strict";
import test from "node:test";
import { SIMD_LAB_ENGINES, SIMD_LAB_FULL_PRESETS, captureSimdLabPreset, randomizeSimdLabPreset, validateSimdLabPreset } from "../src/families/simd-resonator/simd-lab-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("SIMD Lab bank covers every example with at least eight complete scenes each", () => {
  validateFullPresetBank(SIMD_LAB_FULL_PRESETS);
  for (const preset of SIMD_LAB_FULL_PRESETS) assert.equal(validateSimdLabPreset(preset.snapshot), preset.snapshot);
  for (const engine of Object.keys(SIMD_LAB_ENGINES)) {
    assert.ok(SIMD_LAB_FULL_PRESETS.filter(preset => preset.snapshot.engine === engine).length >= 8, engine);
  }
  assert.throws(() => validateSimdLabPreset({ engine: "resonator", settings: {} }), TypeError);
  assert.throws(() => validateSimdLabPreset({ engine: "swarm", settings: { voiceCount: 130, centerFrequency: 100, detuneCents: 10, stereoWidth: 0.5 } }), TypeError);
  assert.throws(() => validateSimdLabPreset({ engine: "swarm", settings: { voiceCount: 64 } }), TypeError);
});

test("capture ignores session fields, and dice stays in the current example and varies every field", () => {
  const session = { ...SIMD_LAB_FULL_PRESETS[0].snapshot.settings, audioOn: true, inputGain: 2, source: "mic" };
  assert.deepEqual(captureSimdLabPreset("granular", session), SIMD_LAB_FULL_PRESETS[0].snapshot);
  const known = new Set(SIMD_LAB_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  for (const engine of Object.keys(SIMD_LAB_ENGINES)) {
    const initial = SIMD_LAB_FULL_PRESETS.find(preset => preset.snapshot.engine === engine).snapshot, before = structuredClone(initial);
    assert.deepEqual(randomizeSimdLabPreset(initial, seed(5)), randomizeSimdLabPreset(initial, seed(5)));
    const random = seed(77), seen = new Map();
    for (let i = 0; i < 64; i++) {
      const result = randomizeSimdLabPreset(initial, random);
      assert.equal(result.engine, engine);
      validateSimdLabPreset(result);
      assert.equal(known.has(presetStateKey(result)), false);
      for (const [key, value] of Object.entries(result.settings)) (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(value);
    }
    assert.deepEqual(initial, before);
    assert.equal(seen.size, Object.keys(SIMD_LAB_ENGINES[engine].defaults).length);
    for (const [key, values] of seen) assert.ok(values.size > 1, `${engine}.${key} stays frozen`);
  }
});
