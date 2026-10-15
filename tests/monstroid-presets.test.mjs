import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COLONY_SYRINX_STATE, createColonySyrinxCallState } from "../src/instruments/monstroid/monstroid.js";
import { colonySyrinxGraphLayoutFromOrganLayout, colonySyrinxOrganLayoutFromGraph } from "../src/instruments/monstroid/monstroid-graph.js";
import {
  MONSTROID_FULL_PRESETS, MONSTROID_PRESET_KEYS, captureMonstroidPreset, monstroidCallIdForSnapshot,
  monstroidStateFromPreset, randomizeMonstroidPreset, validateMonstroidPreset,
} from "../src/instruments/monstroid/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flatten = (value, prefix = "") => (value && typeof value === "object"
  ? Object.entries(value).flatMap(([key, child]) => flatten(child, `${prefix}${key}.`))
  : [[prefix, value]]);

test("Monstroid bank is the base call set as complete, distinct scenes", () => {
  validateFullPresetBank(MONSTROID_FULL_PRESETS);
  assert.ok(MONSTROID_FULL_PRESETS.length >= 12);
  assert.ok(MONSTROID_FULL_PRESETS.every(preset => !/forked|migrating/.test(preset.id)));
  for (const preset of MONSTROID_FULL_PRESETS) {
    assert.equal(validateMonstroidPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(Object.keys(preset.snapshot).sort(), [...MONSTROID_PRESET_KEYS].sort());
    assert.equal(monstroidCallIdForSnapshot(preset.snapshot), preset.id);
  }
  assert.throws(() => validateMonstroidPreset({}), TypeError);
  const bad = structuredClone(MONSTROID_FULL_PRESETS[0].snapshot);
  bad.breath = 7;
  assert.throws(() => validateMonstroidPreset(bad), TypeError);
});

test("Monstroid recall leaves output level, MIDI mapping, score and transport flag alone", () => {
  for (const key of ["level", "midiBaseNote", "midiMode", "sequencerEnabled", "lanes", "sequence"]) {
    assert.equal(MONSTROID_PRESET_KEYS.includes(key), false, key);
  }
  const session = { ...DEFAULT_COLONY_SYRINX_STATE, level: .31, midiBaseNote: 60, midiMode: "replace", sequencerEnabled: false };
  const next = monstroidStateFromPreset(MONSTROID_FULL_PRESETS[4].snapshot, session);
  assert.equal(next.level, .31);
  assert.equal(next.midiBaseNote, 60);
  assert.equal(next.midiMode, "replace");
  assert.equal(next.sequencerEnabled, false);
  assert.deepEqual(captureMonstroidPreset(next), MONSTROID_FULL_PRESETS[4].snapshot);
  assert.deepEqual(captureMonstroidPreset(createColonySyrinxCallState(MONSTROID_FULL_PRESETS[4].id)), MONSTROID_FULL_PRESETS[4].snapshot);
});

test("Monstroid dice is pure, reproducible, bounded and varies every field", () => {
  const initial = MONSTROID_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeMonstroidPreset(initial, seed(5)), randomizeMonstroidPreset(MONSTROID_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(MONSTROID_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(77);
  for (let i = 0; i < 80; i++) {
    const result = randomizeMonstroidPreset(initial, random);
    validateMonstroidPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(result.phonatorEnabled.some(Boolean) && result.mouthEnabled.some(Boolean) && result.lungEnabled.some(Boolean));
    assert.ok(result.contours[0].muted === false);
    assert.ok(result.contourDurationSeconds >= 1 && result.contourDurationSeconds <= 40);
    assert.equal(
      presetStateKey(colonySyrinxOrganLayoutFromGraph(colonySyrinxGraphLayoutFromOrganLayout(result.organLayout))),
      presetStateKey(result.organLayout),
    );
    for (const [path, value] of flatten(result)) {
      if (!seen.has(path)) seen.set(path, new Set());
      seen.get(path).add(value);
    }
  }
  const frozen = [...seen].filter(([, values]) => values.size < 2).map(([path]) => path);
  const allowed = /(^|\.)(id|loop|index|label)\.$|^contours\.0\.muted\.$|^articulation\.prechargeMs\.$/;
  assert.deepEqual(frozen.filter(path => !allowed.test(path)), []);
});
