import assert from "node:assert/strict";
import test from "node:test";
import {
  ALIEN_LARYNX_FULL_PRESETS, captureAlienLarynxPreset, randomizeAlienLarynxPreset, validateAlienLarynxPreset,
} from "../src/instruments/alien-larynx/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const leaves = (value, path = "", out = new Map()) => {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) leaves(v, `${path}.${k}`, out);
  else (out.get(path) ?? out.set(path, new Set()).get(path)).add(value);
  return out;
};

test("Alien Larynx bank is complete, valid and input-free", () => {
  validateFullPresetBank(ALIEN_LARYNX_FULL_PRESETS);
  assert.ok(ALIEN_LARYNX_FULL_PRESETS.length >= 12);
  for (const preset of ALIEN_LARYNX_FULL_PRESETS) {
    assert.equal(validateAlienLarynxPreset(preset.snapshot), preset.snapshot);
    for (const key of ["sourceMode", "inputTrim", "inputStability", "level", "awake", "mic"]) assert.equal(key in preset.snapshot, false);
  }
  assert.ok(ALIEN_LARYNX_FULL_PRESETS.some(p => Object.values(p.snapshot.alien).some(m => m.enabled)));
  assert.throws(() => validateAlienLarynxPreset({}), TypeError);
  const bad = structuredClone(ALIEN_LARYNX_FULL_PRESETS[3].snapshot);
  bad.alien.wormhole.topology = "nope";
  assert.throws(() => validateAlienLarynxPreset(bad), TypeError);
  assert.deepEqual(captureAlienLarynxPreset(ALIEN_LARYNX_FULL_PRESETS[5].snapshot), ALIEN_LARYNX_FULL_PRESETS[5].snapshot);
});

test("Alien Larynx dice is pure, reproducible and varies the alien layer", () => {
  const initial = ALIEN_LARYNX_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeAlienLarynxPreset(initial, seed(5)), randomizeAlienLarynxPreset(ALIEN_LARYNX_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(ALIEN_LARYNX_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(77);
  for (let i = 0; i < 80; i++) {
    const result = randomizeAlienLarynxPreset(initial, random);
    validateAlienLarynxPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    for (const [k, set] of leaves(result)) { const s = seen.get(k) ?? seen.set(k, new Set()).get(k); set.forEach(v => s.add(v)); }
  }
  for (const [key, values] of seen) if (key.startsWith(".alien") || key === ".phoneme") assert.ok(values.size >= 2, `${key} stays frozen`);
});
