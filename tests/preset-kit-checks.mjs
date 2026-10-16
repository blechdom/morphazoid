import assert from "node:assert/strict";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

export const seeded = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

/** Shared bank/capture/dice contract checks for flat parameter-schema presets. */
export function checkParamModelContract(test, { name, model, bank, sessionState = {}, seeds = 96, minDistinct = 6 }) {
  test(`${name} bank is complete, valid and distinct`, () => {
    validateFullPresetBank(bank);
    assert.ok(bank.length >= 12);
    for (const preset of bank) {
      assert.equal(model.validate(preset.snapshot), preset.snapshot);
      assert.deepEqual(Object.keys(preset.snapshot).sort(), [...model.keys].sort());
      assert.deepEqual(model.sanitize(preset.snapshot), preset.snapshot);
      JSON.parse(JSON.stringify(preset.snapshot));
    }
    assert.throws(() => model.validate({}), TypeError);
    assert.throws(() => model.validate({ ...bank[0].snapshot, extra: 1 }), TypeError);
    const key = model.keys.find(k => model.fields[k].type === "range");
    assert.throws(() => model.validate({ ...bank[0].snapshot, [key]: model.fields[key].max + 1000 }), TypeError);
    assert.throws(() => model.validate({ ...bank[0].snapshot, [key]: Number.NaN }), TypeError);
  });

  test(`${name} capture round-trips and ignores session state`, () => {
    for (const preset of bank) {
      const state = { ...sessionState, ...preset.snapshot };
      assert.deepEqual(model.sanitize(state), preset.snapshot);
      assert.equal(presetStateKey(model.sanitize(state)), presetStateKey(preset.snapshot));
    }
    for (const key of Object.keys(sessionState)) assert.equal(model.keys.includes(key), false, `${key} is session state`);
  });

  test(`${name} dice is pure, reproducible, bounded and varies every field`, () => {
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(model.randomize(initial, seeded(5)), model.randomize(bank[3].snapshot, seeded(5)));
    assert.deepEqual(initial, before);
    const factory = new Set(bank.map(preset => presetStateKey(preset.snapshot)));
    const seen = new Map(model.keys.map(key => [key, new Set()]));
    const random = seeded(77);
    for (let i = 0; i < seeds; i++) {
      const result = model.randomize(initial, random);
      model.validate(result);
      assert.equal(factory.has(presetStateKey(result)), false);
      for (const key of model.keys) seen.get(key).add(result[key]);
    }
    for (const [key, values] of seen) assert.ok(values.size >= Math.min(minDistinct, 2), `${key} stays frozen`);
    for (const [key, values] of seen) {
      const field = model.fields[key];
      if (field.type === "range" && (field.max - field.min) / (field.step || 1) > 20) assert.ok(values.size >= minDistinct, `${key} barely varies`);
    }
    assert.throws(() => model.randomize(initial, () => Number.NaN), TypeError);
  });
}
