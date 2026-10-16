import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeSyrinxState } from "../src/families/syrinx/syrinx.js";
import {
  SYRINX_FULL_PRESETS, TONGUED_BEASTS_FULL_PRESETS, applyVoiceHostState, captureSyrinxPreset, captureTonguedBeastsPreset,
  randomizeSyrinxPreset, randomizeTonguedBeastsPreset, validateSyrinxPreset, validateTonguedBeastsPreset,
} from "../src/families/syrinx/voice-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flatten = (value, path = "", out = new Map()) => {
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, `${path}.${k}`, out);
  else out.set(path, value);
  return out;
};
function frozenFields(randomize, initial, runs = 80) {
  const seen = new Map(), random = seed(31);
  for (let i = 0; i < runs; i++) for (const [key, value] of flatten(randomize(initial, random))) {
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(value);
  }
  return [...seen].filter(([, values]) => values.size < 2).map(([key]) => key);
}

test("Syrinx and Tongued Beasts banks are complete and distinct", () => {
  validateFullPresetBank(SYRINX_FULL_PRESETS);
  validateFullPresetBank(TONGUED_BEASTS_FULL_PRESETS);
  for (const preset of SYRINX_FULL_PRESETS) {
    assert.equal(validateSyrinxPreset(preset.snapshot), preset.snapshot);
    assert.equal(presetStateKey(captureSyrinxPreset(preset.snapshot.state, preset.snapshot.modulators)), presetStateKey(preset.snapshot));
  }
  for (const preset of TONGUED_BEASTS_FULL_PRESETS) {
    const { state, tongue, motion, wiggles } = preset.snapshot;
    assert.equal(validateTonguedBeastsPreset(preset.snapshot), preset.snapshot);
    assert.equal(presetStateKey(captureTonguedBeastsPreset(state, tongue, motion, wiggles)), presetStateKey(preset.snapshot));
  }
  assert.ok(new Set(SYRINX_FULL_PRESETS.map(p => p.snapshot.state.animalId)).size >= 10);
  assert.ok(new Set(TONGUED_BEASTS_FULL_PRESETS.map(p => p.snapshot.motion)).size >= 8);
});

test("scenes exclude session state and reject invalid snapshots", () => {
  for (const preset of [...SYRINX_FULL_PRESETS, ...TONGUED_BEASTS_FULL_PRESETS]) {
    for (const key of ["active", "level", "loop"]) assert.equal(key in preset.snapshot.state, false);
  }
  const live = sanitizeSyrinxState({ animalId: "dog", active: true, loop: true, level: 0.9 });
  const applied = applyVoiceHostState(SYRINX_FULL_PRESETS[1].snapshot.state, live);
  assert.deepEqual([applied.active, applied.loop, applied.level], [true, true, 0.9]);
  assert.equal(applied.animalId, "wolf");
  const bad = structuredClone(SYRINX_FULL_PRESETS[0].snapshot);
  bad.modulators[0].rateHz = 99;
  assert.throws(() => validateSyrinxPreset(bad), TypeError);
  const motion = structuredClone(TONGUED_BEASTS_FULL_PRESETS[4].snapshot);
  motion.tongue.tongueEnabled = false;
  assert.throws(() => validateTonguedBeastsPreset(motion), TypeError);
  assert.throws(() => validateTonguedBeastsPreset({ ...TONGUED_BEASTS_FULL_PRESETS[4].snapshot, wiggles: [] }), TypeError);
});

for (const [name, bank, randomize, validate] of [
  ["Syrinx", SYRINX_FULL_PRESETS, randomizeSyrinxPreset, validateSyrinxPreset],
  ["Tongued Beasts", TONGUED_BEASTS_FULL_PRESETS, randomizeTonguedBeastsPreset, validateTonguedBeastsPreset],
]) {
  test(`${name} dice is pure, reproducible, bounded and varies every field`, () => {
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(randomize(initial, seed(5)), randomize(bank[3].snapshot, seed(5)));
    assert.deepEqual(initial, before);
    const factory = new Set(bank.map(preset => presetStateKey(preset.snapshot)));
    const random = seed(9);
    for (let i = 0; i < 100; i++) {
      const result = randomize(initial, random);
      validate(result);
      assert.equal(factory.has(presetStateKey(result)), false);
    }
    assert.deepEqual(randomize(initial, () => 0), randomize(initial, () => 0));
    validate(randomize(initial, () => 1));
    assert.throws(() => randomize(initial, () => NaN), TypeError);
    // Some fields are legitimately conditional on animal bounds / lock; the rest must move.
    const frozen = frozenFields(randomize, initial).filter(key => !/\.(sourceModel)$/.test(key));
    assert.deepEqual(frozen, []);
  });
}
