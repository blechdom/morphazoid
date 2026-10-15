import assert from "node:assert/strict";
import test from "node:test";
import {
  HOCKET_FULL_PRESETS, HOCKET_SCALAR_KEYS, captureHocketPreset, hocketStateFromPreset, randomizeHocketPreset,
  validateHocketPreset,
} from "../src/instruments/hocket-loom/full-presets.js";
import { createHocketState } from "../src/instruments/hocket-loom/hocket-loom.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Hocket Luigi bank is complete, valid and round-trips through the state model", () => {
  validateFullPresetBank(HOCKET_FULL_PRESETS);
  for (const preset of HOCKET_FULL_PRESETS) {
    const { snapshot } = preset;
    assert.equal(validateHocketPreset(snapshot), snapshot);
    const state = hocketStateFromPreset(snapshot, { presetId: "open-weave", variation: true, level: 0.2 });
    assert.deepEqual(captureHocketPreset({ ...state, direction: snapshot.settings.direction, motionMode: snapshot.settings.motionMode }), snapshot);
    assert.equal(Object.keys(snapshot.settings).length, HOCKET_SCALAR_KEYS.length);
  }
  assert.ok(new Set(HOCKET_FULL_PRESETS.map(p => p.snapshot.settings.length)).size >= 3);
  assert.ok(new Set(HOCKET_FULL_PRESETS.map(p => p.snapshot.settings.soundEngine)).size >= 5);
  assert.deepEqual(HOCKET_FULL_PRESETS[0].snapshot.patterns, createHocketState(HOCKET_FULL_PRESETS[0].id).patterns);
});

test("Hocket Luigi validation rejects damaged scenes and excludes session state", () => {
  const good = structuredClone(HOCKET_FULL_PRESETS[7].snapshot);
  for (const key of ["level", "playing", "position", "step"]) assert.equal(Object.hasOwn(good.settings, key), false);
  const state = hocketStateFromPreset(good, { presetId: "open-weave", variation: true, level: 0.11 });
  assert.equal(state.level, 0.11);
  const tempo = structuredClone(good); tempo.settings.tempoBpm = 9999;
  assert.throws(() => validateHocketPreset(tempo), TypeError);
  const ragged = structuredClone(good); ragged.patterns[0].pop();
  assert.throws(() => validateHocketPreset(ragged), TypeError);
  const engine = structuredClone(good); engine.settings.soundEngine = "missing";
  assert.throws(() => validateHocketPreset(engine), TypeError);
  assert.throws(() => validateHocketPreset({}), TypeError);
});

test("Hocket Luigi dice is pure, reproducible, bounded and varies every field", () => {
  const initial = HOCKET_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeHocketPreset(initial, seed(5)), randomizeHocketPreset(HOCKET_FULL_PRESETS[8].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(HOCKET_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(HOCKET_SCALAR_KEYS.map(key => [key, new Set()]));
  const tones = new Set(), phases = new Set(), random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeHocketPreset(initial, random);
    validateHocketPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    assert.ok(result.patterns.flat().some(Boolean));
    for (const key of HOCKET_SCALAR_KEYS) seen.get(key).add(result.settings[key]);
    for (const tone of result.patterns.flat()) tones.add(tone);
    for (const phase of result.phases) phases.add(phase);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.equal(tones.size, 9);
  assert.ok(phases.size > 8);
  assert.throws(() => randomizeHocketPreset(initial, () => NaN), TypeError);
});
