import assert from "node:assert/strict";
import test from "node:test";
import { BLOWHOLE_CALLS, sanitizeBlowholeState } from "../src/instruments/blowhole/blowhole.js";
import {
  BLOWHOLE_FULL_PRESETS, BLOWHOLE_PRESET_KEYS, applyBlowholePresetState, captureBlowholePreset, randomizeBlowholePreset, validateBlowholePreset,
} from "../src/instruments/blowhole/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Blowhole bank is complete, valid and covers every call", () => {
  validateFullPresetBank(BLOWHOLE_FULL_PRESETS);
  for (const preset of BLOWHOLE_FULL_PRESETS) {
    assert.equal(validateBlowholePreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...BLOWHOLE_PRESET_KEYS].sort());
  }
  assert.equal(new Set(BLOWHOLE_FULL_PRESETS.map(p => p.snapshot.callId)).size, BLOWHOLE_CALLS.length);
  assert.ok(new Set(BLOWHOLE_FULL_PRESETS.map(p => p.snapshot.propagationId)).size >= 3);
  const bad = { ...BLOWHOLE_FULL_PRESETS[0].snapshot, pressure: 7 };
  assert.throws(() => validateBlowholePreset(bad), TypeError);
  assert.throws(() => validateBlowholePreset({ callId: "humpback-moan" }), TypeError);
});

test("applying a scene keeps output level and monitor mode", () => {
  const live = sanitizeBlowholeState({ level: 0.91, monitorMode: "physical" });
  const next = applyBlowholePresetState(BLOWHOLE_FULL_PRESETS[4].snapshot, live);
  assert.equal(next.level, 0.91);
  assert.equal(next.monitorMode, "physical");
  assert.equal(next.callId, "bottlenose-signature-whistle");
  assert.deepEqual(captureBlowholePreset(next), BLOWHOLE_FULL_PRESETS[4].snapshot);
});

test("Blowhole dice is pure, reproducible, bounded and unfrozen", () => {
  const initial = BLOWHOLE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeBlowholePreset(initial, seed(5)), randomizeBlowholePreset(BLOWHOLE_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(BLOWHOLE_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(BLOWHOLE_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 120; i++) {
    const result = randomizeBlowholePreset(initial, random);
    validateBlowholePreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of BLOWHOLE_PRESET_KEYS) seen.get(key).add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "callId" ? BLOWHOLE_CALLS.length : key === "propagationId" ? 4 : 40), `${key} stays frozen`);
  validateBlowholePreset(randomizeBlowholePreset(initial, () => 0));
  validateBlowholePreset(randomizeBlowholePreset(initial, () => 1));
});
