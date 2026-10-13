import assert from "node:assert/strict";
import test from "node:test";
import { SIMD_RESONATOR_DEFAULTS, presetsForSimdEngine, sanitizeSimdResonatorSettings } from "../src/simd-resonator.js";
import {
  SIMD_RESONATOR_FULL_PRESETS, captureSimdResonatorPreset,
  validateSimdResonatorPreset, randomizeSimdResonatorPreset,
} from "../src/families/simd-resonator/simd-resonator-presets.js";
import { validateFullPresetBank, presetStateKey } from "../src/site/header-presets.js";

function seeded(seed) { let value = seed >>> 0; return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296); }

test("full Resonator bank retains every material and recalls all 17 DSP parameters", () => {
  validateFullPresetBank(SIMD_RESONATOR_FULL_PRESETS);
  for (const preset of SIMD_RESONATOR_FULL_PRESETS) {
    assert.deepEqual(Object.keys(preset.snapshot).sort(), Object.keys(SIMD_RESONATOR_DEFAULTS).sort());
    assert.deepEqual(validateSimdResonatorPreset(preset.snapshot), sanitizeSimdResonatorSettings(preset.snapshot));
  }
  for (const material of presetsForSimdEngine("resonator")) {
    assert.deepEqual(SIMD_RESONATOR_FULL_PRESETS.find(preset => preset.id === material.id).snapshot, material.settings);
  }
});

test("capture excludes live source, levels and transport; recall rejects incomplete scenes", () => {
  const session = { ...SIMD_RESONATOR_DEFAULTS, audioOn: true, inputGain: 2, outputLevel: .1, source: "samples", loop: true, playing: true };
  assert.deepEqual(captureSimdResonatorPreset(session), SIMD_RESONATOR_DEFAULTS);
  assert.throws(() => validateSimdResonatorPreset(session), /Incomplete/);
  assert.throws(() => validateSimdResonatorPreset({ baseFrequency: 90 }), /Incomplete/);
  assert.throws(() => validateSimdResonatorPreset({ ...SIMD_RESONATOR_DEFAULTS, fftSize: 1000 }), /fftSize/);
  assert.throws(() => validateSimdResonatorPreset({ ...SIMD_RESONATOR_DEFAULTS, modeCount: 127 }), /modeCount/);
});

test("seeded dice varies every owned field without copying factory scenes or touching its input", () => {
  const previous = Object.freeze({ ...SIMD_RESONATOR_DEFAULTS });
  const random = seeded(93), values = Object.fromEntries(Object.keys(previous).map(key => [key, new Set()]));
  const factory = new Set(SIMD_RESONATOR_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const results = [];
  for (let index = 0; index < 256; index++) {
    const next = randomizeSimdResonatorPreset(previous, random);
    assert.deepEqual(next, sanitizeSimdResonatorSettings(next));
    assert(!factory.has(presetStateKey(next)));
    for (const [key, value] of Object.entries(next)) values[key].add(value);
    results.push(next);
  }
  for (const [key, set] of Object.entries(values)) assert(set.size > 1, `${key} must vary`);
  assert.deepEqual(randomizeSimdResonatorPreset(previous, seeded(93)), results[0]);
  assert.deepEqual(previous, SIMD_RESONATOR_DEFAULTS);
  assert.throws(() => randomizeSimdResonatorPreset(previous, () => NaN), /finite/);
});
