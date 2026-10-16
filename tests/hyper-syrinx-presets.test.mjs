import assert from "node:assert/strict";
import test from "node:test";
import {
  HYPER_SYRINX_FULL_PRESETS, HYPER_SYRINX_SPECIES, HYPER_SYRINX_STAGES, captureHyperSyrinxPreset,
  hyperSyrinxEquation, randomizeHyperSyrinxPreset, validateHyperSyrinxPreset,
} from "../src/instruments/hyper-syrinx/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Hyper-Syrinx bank is complete, valid and distinct", () => {
  validateFullPresetBank(HYPER_SYRINX_FULL_PRESETS);
  assert.ok(HYPER_SYRINX_FULL_PRESETS.length >= 12);
  for (const preset of HYPER_SYRINX_FULL_PRESETS) {
    assert.equal(validateHyperSyrinxPreset(preset.snapshot), preset.snapshot);
    assert.equal("level" in preset.snapshot, false);
    assert.match(hyperSyrinxEquation(preset.snapshot), /→/);
  }
  assert.throws(() => validateHyperSyrinxPreset({}), TypeError);
  const bad = structuredClone(HYPER_SYRINX_FULL_PRESETS[1].snapshot);
  bad.modules.air = [];
  assert.throws(() => validateHyperSyrinxPreset(bad), TypeError);
  bad.modules.air = [{ species: "dragon", value: .5 }];
  assert.throws(() => validateHyperSyrinxPreset(bad), TypeError);
});

test("Hyper-Syrinx dice is pure, reproducible and varies every musical field", () => {
  const initial = HYPER_SYRINX_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeHyperSyrinxPreset(initial, seed(5)), randomizeHyperSyrinxPreset(HYPER_SYRINX_FULL_PRESETS[5].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(HYPER_SYRINX_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const note = (key, value) => (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(value);
  const random = seed(77);
  for (let i = 0; i < 80; i++) {
    const result = randomizeHyperSyrinxPreset(initial, random);
    validateHyperSyrinxPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const key of ["route", "metabolism", "crossCoupling", "breathTexture", "wetness"]) note(key, result[key]);
    for (const stage of HYPER_SYRINX_STAGES) {
      note(`${stage}.count`, result.modules[stage].length);
      for (const item of result.modules[stage]) { note(`${stage}.value`, item.value); note(`${stage}.species`, item.species); }
    }
  }
  for (const [key, values] of seen) assert.ok(values.size >= 3, `${key} stays frozen`);
  assert.equal(new Set([...seen.keys()].filter(k => k.endsWith(".species"))).size, HYPER_SYRINX_STAGES.length);
  assert.ok(HYPER_SYRINX_SPECIES.length === 7);
});
