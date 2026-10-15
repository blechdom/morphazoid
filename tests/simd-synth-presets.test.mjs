import assert from "node:assert/strict";
import test from "node:test";
import { SIMD_SYNTH_PARAM_ORDER } from "../src/simd-synth.js";
import {
  SIMD_SYNTH_FULL_PRESETS, captureSimdSynthPreset, randomizeSimdSynthPreset, validateSimdSynthPreset,
} from "../src/instruments/simd-synth/full-presets.js";
import { SIMD_SYNTH_PRESETS } from "../src/simd-synth-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("SIMD Synth bank reuses every factory patch and is complete, valid and distinct", () => {
  validateFullPresetBank(SIMD_SYNTH_FULL_PRESETS);
  assert.equal(SIMD_SYNTH_FULL_PRESETS.length, SIMD_SYNTH_PRESETS.length);
  for (const preset of SIMD_SYNTH_FULL_PRESETS) {
    assert.equal(validateSimdSynthPreset(preset.snapshot), preset.snapshot);
    assert.equal(preset.snapshot.sequence.length, 16);
    assert.equal(preset.snapshot.modRoutes.length, 4);
  }
  assert.throws(() => validateSimdSynthPreset({ params: {} }), TypeError);
  const bad = structuredClone(SIMD_SYNTH_FULL_PRESETS[1].snapshot);
  bad.params.cutoff1 = 1e9;
  assert.throws(() => validateSimdSynthPreset(bad), TypeError);
});

test("SIMD Synth capture ignores non-musical patch wrappers", () => {
  const snapshot = SIMD_SYNTH_FULL_PRESETS[2].snapshot;
  assert.deepEqual(captureSimdSynthPreset({ ...snapshot, activePresetId: "x", paramArray: [1] }), snapshot);
});

test("SIMD Synth dice is pure, reproducible, bounded and varies every musical field", () => {
  const initial = SIMD_SYNTH_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSimdSynthPreset(initial, seed(5)), randomizeSimdSynthPreset(SIMD_SYNTH_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(SIMD_SYNTH_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const note = (path, value) => (seen.get(path) ?? seen.set(path, new Set()).get(path)).add(value);
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeSimdSynthPreset(initial, random);
    validateSimdSynthPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of SIMD_SYNTH_PARAM_ORDER) note(`params.${key}`, result.params[key]);
    result.sequence.forEach((step, index) => step.forEach((value, part) => note(`seq.${index}.${part}`, value)));
    result.modRoutes.forEach((route, index) => route.forEach((value, part) => note(`route.${index}.${part}`, value)));
  }
  for (const key of SIMD_SYNTH_PARAM_ORDER) assert.ok(seen.get(`params.${key}`).size > 1, `${key} stays frozen`);
  for (const [path, values] of seen) {
    if (path.endsWith(".3") && path.startsWith("route.")) continue;
    assert.ok(values.size > 1, `${path} stays frozen`);
  }
});
