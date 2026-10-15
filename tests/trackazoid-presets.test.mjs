import assert from "node:assert/strict";
import test from "node:test";
import {
  TRACKAZOID_DECK_KEYS, TRACKAZOID_FULL_PRESETS, captureTrackazoidPreset, randomizeTrackazoidPreset, validateTrackazoidPreset,
} from "../src/instruments/trackazoid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Trackazoid bank is complete, valid and slider-aligned", () => {
  validateFullPresetBank(TRACKAZOID_FULL_PRESETS);
  for (const { snapshot } of TRACKAZOID_FULL_PRESETS) {
    assert.equal(validateTrackazoidPreset(snapshot), snapshot);
    assert.deepEqual(captureTrackazoidPreset(structuredClone(snapshot)), snapshot);
    assert.equal(snapshot.decks.length, 2);
    for (const deck of snapshot.decks) assert.deepEqual(Object.keys(deck).sort(), [...TRACKAZOID_DECK_KEYS].sort());
  }
  assert.ok(TRACKAZOID_FULL_PRESETS.some(p => p.snapshot.decks.every(deck => !deck.keyLock)));
  assert.ok(TRACKAZOID_FULL_PRESETS.some(p => p.snapshot.crossfader > 0.5) && TRACKAZOID_FULL_PRESETS.some(p => p.snapshot.crossfader < -0.5));
});

test("Trackazoid validation rejects damaged scenes and excludes session state", () => {
  const good = structuredClone(TRACKAZOID_FULL_PRESETS[1].snapshot);
  for (const key of ["level", "cueLevel", "routing", "rate", "sync", "tracks"]) {
    assert.equal(Object.hasOwn(good, key), false);
    assert.equal(Object.hasOwn(good.decks[0], key), false);
  }
  const gain = structuredClone(good); gain.decks[0].gain = 3;
  assert.throws(() => validateTrackazoidPreset(gain), TypeError);
  const off = structuredClone(good); off.decks[1].eqLow = -3.3;
  assert.throws(() => validateTrackazoidPreset(off), TypeError);
  const one = structuredClone(good); one.decks.pop();
  assert.throws(() => validateTrackazoidPreset(one), TypeError);
  assert.throws(() => validateTrackazoidPreset({}), TypeError);
});

test("Trackazoid dice is pure, reproducible, bounded and varies every field", () => {
  const initial = TRACKAZOID_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeTrackazoidPreset(initial, seed(5)), randomizeTrackazoidPreset(TRACKAZOID_FULL_PRESETS[5].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(TRACKAZOID_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map([["crossfader", new Set()], ...TRACKAZOID_DECK_KEYS.flatMap(key => [`a.${key}`, `b.${key}`]).map(key => [key, new Set()])]);
  const random = seed(77);
  for (let i = 0; i < 200; i++) {
    const result = randomizeTrackazoidPreset(initial, random);
    validateTrackazoidPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    seen.get("crossfader").add(result.crossfader);
    result.decks.forEach((deck, index) => { for (const key of TRACKAZOID_DECK_KEYS) seen.get(`${index ? "b" : "a"}.${key}`).add(deck[key]); });
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.throws(() => randomizeTrackazoidPreset(initial, () => NaN), TypeError);
});
