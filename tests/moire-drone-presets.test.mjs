import assert from "node:assert/strict";
import test from "node:test";
import {
  FABRIC_IMPACT_BODIES,
  MOIRE_DRONE_DEFAULTS,
  MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  MOIRE_DRONE_NOISE_TYPES,
  MOIRE_DRONE_PRESETS,
  SPECTRAL_PROPAGATION_MODES,
  SPECTRAL_SCULPT_MODES,
  sanitizeMoireDroneParams,
} from "../src/instruments/moire-drone/moire-drone.js";
import {
  MOIRE_DRONE_FULL_PRESETS,
  MOIRE_DRONE_PRESET_KEYS,
  captureMoireDronePreset,
  randomizeMoireDronePreset,
  validateMoireDronePreset,
} from "../src/instruments/moire-drone/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const clone = value => JSON.parse(JSON.stringify(value));
const initial = captureMoireDronePreset(MOIRE_DRONE_DEFAULTS);

test("Fabric Filter full presets preserve the entire authored bank and its exact musical settings", () => {
  validateFullPresetBank(MOIRE_DRONE_FULL_PRESETS);
  assert.ok(MOIRE_DRONE_FULL_PRESETS.length >= 56);
  assert.equal(MOIRE_DRONE_FULL_PRESETS.length, MOIRE_DRONE_PRESETS.length);
  assert.ok(Object.isFrozen(MOIRE_DRONE_FULL_PRESETS));
  for (let index = 0; index < MOIRE_DRONE_PRESETS.length; index++) {
    const original = MOIRE_DRONE_PRESETS[index];
    const complete = MOIRE_DRONE_FULL_PRESETS[index];
    assert.equal(complete.id, original.id);
    assert.equal(complete.label, original.label);
    const { outputLevel, ...expected } = sanitizeMoireDroneParams({
      ...MOIRE_DRONE_DEFAULTS, ...original.settings,
    });
    assert.deepEqual(complete.snapshot, { settings: expected });
    assert.equal(validateMoireDronePreset(complete.snapshot), complete.snapshot);
    assert.ok(Object.isFrozen(complete));
    assert.ok(Object.isFrozen(complete.snapshot));
    assert.ok(Object.isFrozen(complete.snapshot.settings));
  }
});

test("Fabric Filter captures complete musical controls without output, devices or transient simulation", () => {
  const live = {
    ...MOIRE_DRONE_DEFAULTS,
    outputLevel: 0.17,
    source: "input", inputTrim: 1.75, deviceId: "performer-device",
    capture: { active: true }, audioOn: true, gridDensity: 35,
    fabric: new Float32Array([0.1, 0.2]),
    propagation: { runningTime: 92 },
  };
  const before = structuredClone(live);
  const snapshot = captureMoireDronePreset(live);
  assert.deepEqual(snapshot, initial);
  assert.deepEqual(live, before);
  assert.deepEqual(Object.keys(snapshot), ["settings"]);
  assert.deepEqual(new Set(MOIRE_DRONE_PRESET_KEYS), new Set(
    Object.keys(MOIRE_DRONE_DEFAULTS).filter(key => key !== "outputLevel"),
  ));
  assert.equal(snapshot.settings.seed, live.seed, "noise seed is part of the patch");
  snapshot.settings.resonance = 0.93;
  assert.equal(live.resonance, MOIRE_DRONE_DEFAULTS.resonance, "snapshot is detached");
});

test("Fabric Filter rejects partial, extra, unsanitized and automatically moving preset states", () => {
  const badSnapshots = [null, {}, { settings: {} }, { ...clone(initial), outputLevel: 0.1 }];
  const missing = clone(initial);
  delete missing.settings.combWidth;
  badSnapshots.push(missing);
  for (const [name, value] of [
    ["resonance", Infinity], ["resonance", -1], ["noiseType", "missing"],
    ["filterPairs", 6.25], ["phaseOffset", 1], ["seed", 0],
    ["highFrequency", 20], ["outputLevel", 0.7], ["source", "input"],
  ]) {
    const invalid = clone(initial);
    invalid.settings[name] = value;
    badSnapshots.push(invalid);
  }
  for (const [name, value] of Object.entries(MOIRE_DRONE_MANUAL_MOTION_SETTINGS)) {
    const invalid = clone(initial);
    invalid.settings[name] = typeof value === "boolean" ? !value : value + 0.1;
    badSnapshots.push(invalid);
  }
  const pebbles = clone(initial);
  pebbles.settings.impactBody = "pebbles";
  pebbles.settings.propagationVoices = 1;
  badSnapshots.push(pebbles);
  for (const snapshot of badSnapshots) {
    assert.throws(() => validateMoireDronePreset(snapshot), TypeError);
  }
});

test("Fabric Filter dice is deterministic, independent of factory choice and does not mutate its input", () => {
  const previous = clone(initial);
  const first = randomizeMoireDronePreset(initial, seededRandom(0x1badb002));
  const second = randomizeMoireDronePreset(initial, seededRandom(0x1badb002));
  assert.deepEqual(first, second);
  assert.deepEqual(initial, previous);
  assert.notDeepEqual(first, initial);
  assert.notDeepEqual(first, randomizeMoireDronePreset(initial, seededRandom(12)));
  assert.deepEqual(first, randomizeMoireDronePreset(
    MOIRE_DRONE_FULL_PRESETS.at(-1).snapshot, seededRandom(0x1badb002),
  ), "dice generates controls rather than mutating the current factory preset");
  const known = new Set(MOIRE_DRONE_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  assert.equal(known.has(presetStateKey(first)), false);
});

test("Fabric Filter dice varies every supported musical field and preserves the manual-motion contract", () => {
  const observed = new Map(MOIRE_DRONE_PRESET_KEYS.map(key => [key, new Set()]));
  const rng = seededRandom(0x53fae011);
  for (let index = 0; index < 512; index++) {
    const next = randomizeMoireDronePreset(initial, rng);
    for (const [name, value] of Object.entries(next.settings)) observed.get(name).add(value);
    const { outputLevel, ...sanitized } = sanitizeMoireDroneParams(next.settings);
    assert.deepEqual(next.settings, sanitized, "generated state already satisfies engine constraints");
    assert.ok(next.settings.highFrequency >= next.settings.lowFrequency * 1.25);
    assert.ok(next.settings.drive <= 0.35);
    assert.ok(next.settings.feedback <= 0.35);
    assert.ok(next.settings.filteredMix >= 0.75, "the random patch retains an audible filtering path");
    assert.ok(next.settings.gestureCoupling >= 0.5, "direct touch remains consequential");
    if (next.settings.impactBody === "pebbles") assert.ok(next.settings.propagationVoices >= 2);
  }
  for (const [name, values] of observed) {
    if (Object.hasOwn(MOIRE_DRONE_MANUAL_MOTION_SETTINGS, name)) {
      assert.deepEqual([...values], [MOIRE_DRONE_MANUAL_MOTION_SETTINGS[name]], name);
    } else {
      assert.ok(values.size > 1, `${name} must not be accidentally frozen`);
    }
  }
  for (const [name, values] of [
    ["noiseType", MOIRE_DRONE_NOISE_TYPES],
    ["collisionMode", ["multiply", "difference", "fold"]],
    ["impactBody", FABRIC_IMPACT_BODIES],
    ["propagationMode", SPECTRAL_PROPAGATION_MODES],
    ["spectralSculptMode", SPECTRAL_SCULPT_MODES],
  ]) assert.deepEqual(observed.get(name), new Set(values), `${name} covers every supported mode`);
});

test("Fabric Filter bounded RNG endpoints remain valid and malformed RNG values fail before apply", () => {
  for (const value of [-100, 0, 0.5, 1, 100]) {
    const snapshot = randomizeMoireDronePreset(initial, () => value);
    assert.equal(validateMoireDronePreset(snapshot), snapshot);
  }
  for (const value of [NaN, Infinity, -Infinity, undefined]) {
    assert.throws(() => randomizeMoireDronePreset(initial, () => value), /finite number/);
  }
});

test("complete recall and dice snapshots leave the performer's master and external input state intact", () => {
  const runtime = {
    outputLevel: 0.12, source: "input", inputTrim: 1.8,
    deviceId: "line-in", captureActive: true, audioOn: true, audioTime: 37,
  };
  const before = clone(runtime);
  for (const snapshot of [
    ...MOIRE_DRONE_FULL_PRESETS.map(preset => preset.snapshot),
    randomizeMoireDronePreset(initial, seededRandom(101)),
  ]) {
    const applied = sanitizeMoireDroneParams({
      ...validateMoireDronePreset(snapshot).settings,
      outputLevel: runtime.outputLevel,
    });
    assert.equal(applied.outputLevel, before.outputLevel);
    assert.deepEqual(captureMoireDronePreset(applied), snapshot,
      "app capture after the complete-state merge matches the transaction exactly");
    assert.deepEqual(runtime, before);
  }
});
