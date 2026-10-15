import assert from "node:assert/strict";
import test from "node:test";
import { WEBGPU_303_PARAM_ORDER } from "../src/webgpu-303.js";
import { SIMD_303_XL_DEFAULTS } from "../src/simd-303.js";
import { FULL_SIMD_303, FULL_WEBGPU_303 } from "../src/instruments/webgpu-303/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

for (const [name, kit] of [["WebGPU 303", FULL_WEBGPU_303], ["SIMD 303", FULL_SIMD_303]]) {
  test(`${name} bank is complete, valid and distinct`, () => {
    validateFullPresetBank(kit.presets);
    assert.ok(kit.presets.length >= 12);
    for (const preset of kit.presets) {
      assert.equal(kit.validate(preset.snapshot), preset.snapshot);
      assert.equal(presetStateKey(kit.capture(preset.snapshot)), presetStateKey(preset.snapshot));
      assert.equal(preset.snapshot.sequence.length, 512);
      assert.equal("xlParams" in preset.snapshot, kit.simd);
    }
    assert.throws(() => kit.validate({ params: {}, sequence: [] }), TypeError);
    const bad = structuredClone(kit.presets[1].snapshot);
    bad.params.res = 99;
    assert.throws(() => kit.validate(bad), TypeError);
  });

  test(`${name} capture ignores state outside the musical preset`, () => {
    const base = kit.presets[2].snapshot;
    const state = { ...structuredClone(base), presetId: "x", audioOn: true, output: 0.2, params: { ...base.params, swing: 0.3, sequencePhase: 4 } };
    assert.deepEqual(kit.capture(state), base);
  });

  test(`${name} dice is pure, reproducible, bounded and varies every field`, () => {
    const initial = kit.presets[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(kit.randomize(initial, seed(5)), kit.randomize(kit.presets[3].snapshot, seed(5)));
    assert.deepEqual(initial, before);
    const factory = new Set(kit.presets.map(preset => presetStateKey(preset.snapshot)));
    const seen = new Map();
    const note = (path, value) => (seen.get(path) ?? seen.set(path, new Set()).get(path)).add(value);
    const random = seed(77);
    for (let i = 0; i < 64; i++) {
      const result = kit.randomize(initial, random);
      kit.validate(result);
      assert.equal(factory.has(presetStateKey(result)), false);
      assert.ok(result.params.timeMod >= 8 && result.params.timeMod <= 64);
      for (const key of WEBGPU_303_PARAM_ORDER) note(`params.${key}`, result.params[key]);
      for (const [key, value] of Object.entries(result.xlParams ?? {})) note(`xl.${key}`, value);
      note("sequence", presetStateKey(result.sequence));
      if (kit.simd) note("expression", presetStateKey(result.stepExpression));
    }
    for (const key of WEBGPU_303_PARAM_ORDER) assert.ok(seen.get(`params.${key}`).size > 5, `${key} stays frozen`);
    for (const key of Object.keys(SIMD_303_XL_DEFAULTS)) {
      if (kit.simd) assert.ok(seen.get(`xl.${key}`).size > 5, `${key} stays frozen`);
    }
    assert.equal(seen.get("sequence").size, 64);
    if (kit.simd) assert.equal(seen.get("expression").size, 64);
  });
}
