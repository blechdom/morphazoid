import assert from "node:assert/strict";
import test from "node:test";
import {
  DENTAPHONE_FULL_PRESETS, DENTAPHONE_MATERIALS, DENTAPHONE_PITCH_KEYS, DENTAPHONE_SOUND_KEYS, captureDentaphonePreset,
  randomizeDentaphonePreset, validateDentaphonePreset,
} from "../src/instruments/object-forge/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Dentaphone bank is complete, valid and covers every material and pitch layout", () => {
  validateFullPresetBank(DENTAPHONE_FULL_PRESETS);
  for (const preset of DENTAPHONE_FULL_PRESETS) {
    assert.equal(validateDentaphonePreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureDentaphonePreset(structuredClone(preset.snapshot)), preset.snapshot);
  }
  const materials = new Set(DENTAPHONE_FULL_PRESETS.map(p => p.snapshot.sound.presetId));
  assert.deepEqual([...materials].sort(), Object.keys(DENTAPHONE_MATERIALS).sort());
  assert.equal(new Set(DENTAPHONE_FULL_PRESETS.map(p => p.snapshot.pitch.layout)).size, 4);
});

test("Dentaphone validation rejects damaged scenes and excludes tooth frequency, JSON and level", () => {
  const good = structuredClone(DENTAPHONE_FULL_PRESETS[2].snapshot);
  for (const key of ["baseFrequencyHz", "modalJson", "level"]) assert.equal(Object.hasOwn(good.sound, key), false);
  const bad = structuredClone(good); bad.sound.size = 50;
  assert.throws(() => validateDentaphonePreset(bad), TypeError);
  const material = structuredClone(good); material.sound.presetId = "plastic";
  assert.throws(() => validateDentaphonePreset(material), TypeError);
  const layout = structuredClone(good); layout.pitch.layout = "random";
  assert.throws(() => validateDentaphonePreset(layout), TypeError);
  assert.throws(() => validateDentaphonePreset({}), TypeError);
});

test("Dentaphone dice is pure, reproducible, bounded and varies every field", () => {
  const initial = DENTAPHONE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeDentaphonePreset(initial, seed(5)), randomizeDentaphonePreset(DENTAPHONE_FULL_PRESETS[9].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(DENTAPHONE_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map([...DENTAPHONE_SOUND_KEYS, ...DENTAPHONE_PITCH_KEYS].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeDentaphonePreset(initial, random);
    validateDentaphonePreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    assert.ok(result.sound.modeCount <= DENTAPHONE_MATERIALS[result.sound.presetId]);
    for (const key of DENTAPHONE_SOUND_KEYS) seen.get(key).add(result.sound[key]);
    for (const key of DENTAPHONE_PITCH_KEYS) seen.get(key).add(result.pitch[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 3, `${key} stays frozen`);
  assert.throws(() => randomizeDentaphonePreset(initial, () => NaN), TypeError);
});
