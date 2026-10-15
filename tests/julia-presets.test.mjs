import assert from "node:assert/strict";
import test from "node:test";
import { generateJuliaBoundary } from "../src/instruments/julia/julia.js";
import {
  JULIA_FULL_PRESETS, JULIA_PRESET_KEYS, captureJuliaPreset, juliaSetIsConnected, randomizeJuliaPreset, validateJuliaPreset,
} from "../src/instruments/julia/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = snapshot => ({ ...snapshot, position: 0.4, playing: true, audio: true, level: 0.9, viewZoom: 2, viewCenterX: 0.3 });

test("Julia bank is complete, valid and every constant has a closed boundary", () => {
  validateFullPresetBank(JULIA_FULL_PRESETS);
  for (const { snapshot } of JULIA_FULL_PRESETS) {
    assert.equal(validateJuliaPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...JULIA_PRESET_KEYS].sort());
    const built = generateJuliaBoundary({
      cReal: snapshot.cReal, cImag: snapshot.cImag, maxIterations: snapshot.maxIterations,
      resolution: snapshot.resolution, simplifyTolerance: snapshot.simplify,
    });
    assert.ok(built.boundary, `${snapshot.presetId} ${snapshot.cReal},${snapshot.cImag} has no boundary`);
  }
  assert.throws(() => validateJuliaPreset({ ...JULIA_FULL_PRESETS[0].snapshot, synthMode: "other" }), TypeError);
  assert.throws(() => validateJuliaPreset({ ...JULIA_FULL_PRESETS[0].snapshot, presetId: "circle" }), TypeError);
  assert.throws(() => validateJuliaPreset({ ...JULIA_FULL_PRESETS[0].snapshot, cReal: 0.4, cImag: 0.9, presetId: "custom" }), TypeError);
});

test("Julia capture round-trips and excludes session and view state", () => {
  for (const { snapshot } of JULIA_FULL_PRESETS) {
    const captured = captureJuliaPreset(toState(snapshot));
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["position", "playing", "audio", "level", "viewZoom", "viewCenterX"]) assert.equal(key in captured, false);
  }
});

test("Julia dice is pure, reproducible, connected and varies every musical field", () => {
  const initial = JULIA_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeJuliaPreset(initial, seed(5)), randomizeJuliaPreset(JULIA_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(JULIA_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(JULIA_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 120; i++) {
    const result = randomizeJuliaPreset(initial, random);
    validateJuliaPreset(result);
    assert.ok(juliaSetIsConnected(result.cReal, result.cImag));
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of JULIA_PRESET_KEYS) seen.get(key).add(JSON.stringify(result[key]));
    if (i < 60) assert.ok(generateJuliaBoundary({
      cReal: result.cReal, cImag: result.cImag, maxIterations: result.maxIterations, resolution: result.resolution,
      simplifyTolerance: result.simplify,
    }).boundary);
  }
  seen.delete("presetId");
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(seen.get("cReal").size > 50);
});
