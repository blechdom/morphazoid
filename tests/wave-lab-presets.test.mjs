import assert from "node:assert/strict";
import test from "node:test";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";
import {
  CRAB_LOOM_FULL_PRESETS, CRAB_LOOM_PRESET_KEYS, captureCrabLoomPreset, randomizeCrabLoomPreset, validateCrabLoomPreset,
} from "../src/instruments/crab-loom/full-presets.js";
import {
  FREEZE_POINT_FULL_PRESETS, FREEZE_POINT_PRESET_KEYS, captureFreezePointPreset, randomizeFreezePointPreset, validateFreezePointPreset,
} from "../src/instruments/freeze-point/full-presets.js";
import {
  SCATTER_GHOST_FULL_PRESETS, captureScatterGhostPreset, randomizeScatterGhostPreset, validateScatterGhostPreset,
} from "../src/instruments/scatter-ghost/full-presets.js";
import {
  EXCEPTIONAL_FULL_PRESETS, EXCEPTIONAL_PRESET_KEYS, captureExceptionalPreset, randomizeExceptionalPreset, validateExceptionalPreset,
} from "../src/instruments/exceptional/full-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const distinct = values => new Set(values).size;

const SUITES = [
  { name: "Crab Loom", bank: CRAB_LOOM_FULL_PRESETS, keys: CRAB_LOOM_PRESET_KEYS, capture: captureCrabLoomPreset, validate: validateCrabLoomPreset, randomize: randomizeCrabLoomPreset },
  { name: "Freeze Point", bank: FREEZE_POINT_FULL_PRESETS, keys: FREEZE_POINT_PRESET_KEYS, capture: captureFreezePointPreset, validate: validateFreezePointPreset, randomize: randomizeFreezePointPreset },
  { name: "Exceptional", bank: EXCEPTIONAL_FULL_PRESETS, keys: EXCEPTIONAL_PRESET_KEYS, capture: captureExceptionalPreset, validate: validateExceptionalPreset, randomize: randomizeExceptionalPreset },
];

for (const { name, bank, keys, capture, validate, randomize } of SUITES) {
  test(`${name} bank is complete, valid and distinct`, () => {
    validateFullPresetBank(bank);
    for (const preset of bank) {
      assert.equal(validate(preset.snapshot), preset.snapshot);
      assert.deepEqual(capture(preset.snapshot), preset.snapshot);
    }
    assert.throws(() => validate({ ...bank[1].snapshot, [keys[0]]: "bad" }), TypeError);
  });

  test(`${name} dice is pure, seedable, new and varies every owned field`, () => {
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(randomize(initial, seed(9)), randomize(bank[2].snapshot, seed(9)));
    assert.deepEqual(initial, before);
    const known = new Set(bank.map(preset => presetStateKey(preset.snapshot)));
    const random = seed(404), seen = Object.fromEntries(keys.map(key => [key, []]));
    for (let i = 0; i < 80; i++) {
      const result = validate(randomize(initial, random));
      assert.equal(known.has(presetStateKey(result)), false);
      for (const key of keys) seen[key].push(result[key]);
    }
    for (const [key, values] of Object.entries(seen)) assert.ok(distinct(values) > (key === "involution" ? 5 : key === "halfTwists" ? 5 : 25), `${key} stays frozen`);
  });
}

test("Crab Loom presets cover every involution and both band sidedness", () => {
  const snapshots = CRAB_LOOM_FULL_PRESETS.map(preset => preset.snapshot);
  assert.equal(distinct(snapshots.map(snapshot => snapshot.involution)), 7);
  assert.ok(snapshots.some(snapshot => snapshot.halfTwists % 2 === 0) && snapshots.some(snapshot => snapshot.halfTwists % 2 === 1));
});

test("Exceptional presets keep gain below the model's safe ceiling", () => {
  for (const preset of EXCEPTIONAL_FULL_PRESETS) assert.ok(preset.snapshot.gamma <= 1.9);
});

test("Scatter Ghost bank is complete, valid and distinct", () => {
  validateFullPresetBank(SCATTER_GHOST_FULL_PRESETS);
  for (const preset of SCATTER_GHOST_FULL_PRESETS) {
    assert.equal(validateScatterGhostPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureScatterGhostPreset(preset.snapshot), preset.snapshot);
  }
  assert.throws(() => validateScatterGhostPreset({ ...SCATTER_GHOST_FULL_PRESETS[0].snapshot, scatterers: [] }), TypeError);
  assert.throws(() => validateScatterGhostPreset({ ...SCATTER_GHOST_FULL_PRESETS[0].snapshot, size: 99 }), TypeError);
});

test("Scatter Ghost dice is pure and new, and varies layout, medium and markers", () => {
  const initial = SCATTER_GHOST_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeScatterGhostPreset(initial, seed(2)), randomizeScatterGhostPreset(SCATTER_GHOST_FULL_PRESETS[5].snapshot, seed(2)));
  assert.deepEqual(initial, before);
  const known = new Set(SCATTER_GHOST_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(66), seen = { size: [], wet: [], count: [], sx: [], sy: [], fx: [], fy: [], x: [], strength: [] };
  for (let i = 0; i < 64; i++) {
    const result = validateScatterGhostPreset(randomizeScatterGhostPreset(initial, random));
    assert.equal(known.has(presetStateKey(result)), false);
    assert.ok(Math.hypot(result.source.x - result.focus.x, result.source.y - result.focus.y) >= 0.27);
    seen.size.push(result.size); seen.wet.push(result.wet); seen.count.push(result.scatterers.length);
    seen.sx.push(result.source.x); seen.sy.push(result.source.y); seen.fx.push(result.focus.x); seen.fy.push(result.focus.y);
    for (const item of result.scatterers) { seen.x.push(item.x); seen.strength.push(item.strength); }
  }
  for (const [key, values] of Object.entries(seen)) assert.ok(distinct(values) > (key === "count" ? 8 : 20), `${key} stays frozen`);
  assert.doesNotThrow(() => randomizeScatterGhostPreset(initial, () => 0.5));
});
