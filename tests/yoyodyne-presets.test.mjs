import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS, createYoyo } from "../src/instruments/yoyodyne/yoyodyne.js";
import {
  YOYODYNE_FULL_PRESETS, YOYODYNE_PRESET_KEYS, applyYoyodynePreset, captureYoyodynePreset, randomizeYoyodynePreset, validateYoyodynePreset,
} from "../src/instruments/yoyodyne/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Yoyodyne bank is complete, valid and distinct", () => {
  validateFullPresetBank(YOYODYNE_FULL_PRESETS);
  assert.deepEqual(YOYODYNE_FULL_PRESETS[0].snapshot, captureYoyodynePreset(createYoyo(DEFAULTS)));
  for (const preset of YOYODYNE_FULL_PRESETS) assert.equal(validateYoyodynePreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateYoyodynePreset({ ...YOYODYNE_FULL_PRESETS[1].snapshot, tempo: 999 }), TypeError);
  assert.throws(() => validateYoyodynePreset({ ...YOYODYNE_FULL_PRESETS[1].snapshot, trick: "nope" }), TypeError);
});

test("Yoyodyne apply round-trips and leaves session state alone", () => {
  for (const preset of YOYODYNE_FULL_PRESETS) {
    const world = createYoyo({ level: 0.7 });
    Object.assign(world, { mode: "sleeping", time: 3.5, omega: 400 });
    applyYoyodynePreset(world, preset.snapshot);
    assert.deepEqual(captureYoyodynePreset(world), preset.snapshot);
    assert.equal(world.settings.level, 0.7);
    assert.equal(world.mode, "sleeping");
    assert.equal(world.time, 3.5);
    assert.equal(world.omega, 400);
  }
});

test("Yoyodyne dice is pure, reproducible and varies every musical field", () => {
  const initial = YOYODYNE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeYoyodynePreset(initial, seed(5)), randomizeYoyodynePreset(YOYODYNE_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(YOYODYNE_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map([...YOYODYNE_PRESET_KEYS, "trick"].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeYoyodynePreset(initial, random);
    validateYoyodynePreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const [key, values] of seen) values.add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "trick" ? 4 : 20), `${key} stays frozen`);
  assert.throws(() => randomizeYoyodynePreset(initial, () => NaN), TypeError);
});
