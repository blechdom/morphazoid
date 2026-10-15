import assert from "node:assert/strict";
import test from "node:test";
import {
  SPIRAL_FULL_PRESETS, SPIRAL_PRESET_KEYS, captureSpiralPreset, randomizeSpiralPreset, validateSpiralPreset,
} from "../src/instruments/spiral/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const amplitudeFor = envelope => ({ captureState: () => structuredClone(envelope) });
const toState = snapshot => ({ ...snapshot, position: 0.4, loopPhase: 0.2, playing: true, loopPlaying: true, audio: true, level: 0.9 });

test("Spiral bank is complete, valid and distinct", () => {
  validateFullPresetBank(SPIRAL_FULL_PRESETS);
  for (const { snapshot } of SPIRAL_FULL_PRESETS) {
    assert.equal(validateSpiralPreset(snapshot), snapshot);
    assert.deepEqual(Object.keys(snapshot).sort(), [...SPIRAL_PRESET_KEYS].sort());
  }
  const sounds = new Set(SPIRAL_FULL_PRESETS.map(preset => preset.snapshot.soundMode));
  assert.ok(sounds.size >= 4);
  const bad = structuredClone(SPIRAL_FULL_PRESETS[1].snapshot);
  bad.spiralA = 0; bad.spiralB = 0;
  assert.throws(() => validateSpiralPreset(bad), TypeError);
  assert.throws(() => validateSpiralPreset({ ...SPIRAL_FULL_PRESETS[0].snapshot, soundMode: "granular" }), TypeError);
  const badEnvelope = structuredClone(SPIRAL_FULL_PRESETS[0].snapshot);
  badEnvelope.envelope.points.pop();
  assert.throws(() => validateSpiralPreset(badEnvelope), TypeError);
});

test("Spiral capture round-trips and excludes session state", () => {
  for (const { snapshot } of SPIRAL_FULL_PRESETS) {
    const captured = captureSpiralPreset(toState(snapshot), amplitudeFor(snapshot.envelope));
    assert.equal(presetStateKey(captured), presetStateKey(snapshot));
    for (const key of ["position", "loopPhase", "playing", "loopPlaying", "audio", "level"]) assert.equal(key in captured, false);
  }
});

test("Spiral dice is pure, reproducible, valid and varies every musical field", () => {
  const initial = SPIRAL_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeSpiralPreset(initial, seed(5)), randomizeSpiralPreset(SPIRAL_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(SPIRAL_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map([...SPIRAL_PRESET_KEYS, "envelope.enabled", "envelope.level"].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 150; i++) {
    const result = randomizeSpiralPreset(initial, random);
    validateSpiralPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const key of SPIRAL_PRESET_KEYS) seen.get(key).add(JSON.stringify(result[key]));
    seen.get("envelope.enabled").add(result.envelope.enabled);
    seen.get("envelope.level").add(result.envelope.level);
  }
  for (const [key, values] of seen) assert.ok(values.size >= 2, `${key} stays frozen`);
  assert.ok(seen.get("tilingType").size > 30);
  assert.ok(seen.get("baseFrequency").size > 30);
});
