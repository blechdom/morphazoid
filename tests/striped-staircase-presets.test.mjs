import assert from "node:assert/strict";
import test from "node:test";
import { cameraFromView, viewById } from "../src/instruments/striped-staircase/striped-staircase.js";
import {
  STAIRCASE_FULL_PRESETS, STAIRCASE_PRESET_KEYS, captureStaircasePreset, randomizeStaircasePreset, validateStaircasePreset,
} from "../src/instruments/striped-staircase/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const toState = snapshot => ({
  selectedViewId: snapshot.viewId, camera: snapshot.timingMode === "dive" ? { centerX: 9, centerY: 9, scale: 0.001 } : snapshot.camera,
  motionMode: snapshot.motionMode, timingMode: snapshot.timingMode, palette: snapshot.palette, playbackMode: snapshot.playbackMode,
  soundPolarity: snapshot.soundPolarity, colorSoundMode: snapshot.colorSoundMode, speed: snapshot.speed, diveOctaves: snapshot.diveOctaves,
  settings: {
    startIteration: snapshot.startIteration, maxIterations: snapshot.maxIterations, steps: snapshot.steps, spacingCurve: 1.7,
    stripePeriod: snapshot.stripePeriod, edgeSoftness: snapshot.edgeSoftness,
  },
  baseFrequency: snapshot.baseFrequency, pitchRange: snapshot.pitchRange, noiseAmount: snapshot.noiseAmount,
  durationScale: snapshot.durationScale, stereoSpread: snapshot.stereoSpread, massLevel: snapshot.massLevel,
  contourLevel: snapshot.contourLevel, rhythmLevel: snapshot.rhythmLevel, microLevel: snapshot.microLevel,
  progress: 0.7, direction: -1, playing: true, audio: true, level: 0.9,
});

test("Striped Staircase bank is complete, valid and uses real views", () => {
  validateFullPresetBank(STAIRCASE_FULL_PRESETS);
  const views = new Set();
  for (const { snapshot } of STAIRCASE_FULL_PRESETS) {
    assert.equal(validateStaircasePreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...STAIRCASE_PRESET_KEYS].sort());
    assert.deepEqual(snapshot.camera, { ...cameraFromView(viewById(snapshot.viewId)) });
    views.add(snapshot.viewId);
  }
  assert.ok(views.size >= 12);
  assert.throws(() => validateStaircasePreset({ ...STAIRCASE_FULL_PRESETS[0].snapshot, palette: "neon" }), TypeError);
  assert.throws(() => validateStaircasePreset({ ...STAIRCASE_FULL_PRESETS[0].snapshot, camera: { centerX: 0, centerY: 0, scale: 9 } }), TypeError);
  assert.throws(() => validateStaircasePreset({ ...STAIRCASE_FULL_PRESETS[0].snapshot, startIteration: 48, maxIterations: 80, steps: 90 }), TypeError);
});

test("Striped Staircase capture round-trips, uses the dive anchor and excludes session state", () => {
  for (const { snapshot } of STAIRCASE_FULL_PRESETS) {
    const anchor = snapshot.camera;
    const captured = captureStaircasePreset(toState(snapshot), anchor);
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["progress", "direction", "playing", "audio", "level"]) assert.equal(key in captured, false);
  }
});

test("Striped Staircase dice is pure, reproducible, valid and varies every musical field", () => {
  const initial = STAIRCASE_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeStaircasePreset(initial, seed(5)), randomizeStaircasePreset(STAIRCASE_FULL_PRESETS[5].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(STAIRCASE_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(STAIRCASE_PRESET_KEYS.map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeStaircasePreset(initial, random);
    validateStaircasePreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of STAIRCASE_PRESET_KEYS) seen.get(key).add(JSON.stringify(result[key]));
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(seen.get("camera").size > 100);
});
