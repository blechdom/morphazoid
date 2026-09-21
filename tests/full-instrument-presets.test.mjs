import assert from "node:assert/strict";
import test from "node:test";
import { presetStateKey, validateFullPresetBank, presetArrowDirection } from "../src/site/header-presets.js";
import { CREATURAZOID_FULL_PRESETS } from "../src/instruments/creaturazoid/full-presets.js";
import { HICCUP_HEAD_FULL_PRESETS } from "../src/instruments/hiccup-head/full-presets.js";
import { KARPLUS_STRONG_FULL_PRESETS } from "../src/instruments/karplus-strong/full-presets.js";
import { algorithmicFullPresets } from "../src/families/algorithmic-scores/full-presets.js";
import { CASCADING_FM_FULL_PRESETS, CASCADING_PM_FULL_PRESETS } from "../src/families/cascading/full-presets.js";
import { CASCADING_FM_PRESETS, deriveCascadeStack as fmStack } from "../src/instruments/cascading-fm/cascading-fm.js";
import { CASCADING_PM_PRESETS, deriveCascadeStack as pmStack } from "../src/instruments/cascading-pm/cascading-pm.js";
import {
  CREATURAZOID_BODY_PRESETS, CREATURAZOID_SEQUENCE_PRESETS, sanitizeCreaturazoidState, sanitizeCreaturazoidPattern,
} from "../src/instruments/creaturazoid/creaturazoid.js";
import {
  HICCUP_HEAD_PRESETS, HICCUP_HEAD_PATTERNS, HICCUP_HEAD_SOUND_BANKS, sanitizeHiccupHeadState, sanitizeHiccupHeadVoice, clonePattern,
} from "../src/instruments/hiccup-head/hiccup-head.js";
import {
  KARPLUS_STRONG_PRESETS, sanitizeKarplusStrongSettings, sanitizeKarplusStrongTuning, generateKarplusStrongSamples,
} from "../src/instruments/karplus-strong/karplus-strong.js";
import {
  ALGORITHMIC_INSTRUMENTS, sanitizeAlgorithmicScoreParams, generateAlgorithmicScore,
} from "../src/families/algorithmic-scores/algorithmic-scores.js";
import { FAVE_TOOL_IDS } from "../src/site/instrument-registry.js";

const equalIds = (actual, records) => assert.deepEqual(new Set(actual), new Set(records.map(record => record.id)));

test("Shapes leads Faves while individual geometry instruments remain category-only", () => {
  assert.deepEqual(FAVE_TOOL_IDS, [
    "shapes", "rubix", "hiccup-head",
    "creaturazoid", "hybrinx", "jaw-harp", "hyper-rubix", "micmic",
    "l-system", "graph-delay", "graph-synth", "cellular-automata", "lattice",
  ]);
});

test("the shared bank validator rejects incomplete counts, duplicate IDs and unserializable state", () => {
  assert.throws(() => validateFullPresetBank([]), /12/);
  const valid = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, label: `Preset ${i}`, snapshot: { value: i } }));
  assert.doesNotThrow(() => validateFullPresetBank(valid));
  assert.throws(() => validateFullPresetBank(valid.map(p => ({ ...p, id: "same" }))), /unique/);
  assert.throws(() => validateFullPresetBank(valid.map(p => ({ ...p, snapshot: {} }))), /distinct/);
  for (const value of [NaN, Infinity, undefined, () => {}, new Float32Array(2)]) {
    assert.throws(() => presetStateKey({ value }), /finite JSON/);
  }
  assert.equal(presetStateKey({ a: 1, b: 2 }), presetStateKey({ b: 2, a: 1 }));
});

test("default preset arrows preserve focused controls and guard modified/repeated keys", () => {
  assert.equal(presetArrowDirection({ key: "ArrowRight" }), 1);
  assert.equal(presetArrowDirection({ key: "ArrowDown" }), 1);
  assert.equal(presetArrowDirection({ key: "ArrowLeft" }), -1);
  for (const field of ["defaultPrevented", "repeat", "isComposing", "altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(presetArrowDirection({ key: "ArrowRight", [field]: true }), 0, field);
  }
  assert.equal(presetArrowDirection({ key: "ArrowRight", target: { closest: () => ({}) } }), 0);
  assert.equal(presetArrowDirection({ key: "Space" }), 0);
});

test("Creaturazoid scenes restore full sanitized anatomy/modulation and all original rhythms", () => {
  validateFullPresetBank(CREATURAZOID_FULL_PRESETS);
  equalIds(CREATURAZOID_FULL_PRESETS.map(p => p.snapshot.state.bodyPresetId), CREATURAZOID_BODY_PRESETS);
  equalIds(CREATURAZOID_FULL_PRESETS.map(p => p.snapshot.currentPatternId), CREATURAZOID_SEQUENCE_PRESETS);
  for (const { snapshot } of CREATURAZOID_FULL_PRESETS) {
    assert.deepEqual(sanitizeCreaturazoidState(snapshot.state), snapshot.state);
    assert.deepEqual(sanitizeCreaturazoidPattern(snapshot.pattern, snapshot.pattern.length), snapshot.pattern);
    assert.equal(snapshot.state.patternLength, snapshot.pattern.length);
    assert.equal(snapshot.state.sequencePresetId, snapshot.currentPatternId);
    assert.equal(snapshot.state.modulationTarget, snapshot.modulationTarget);
  }
});

test("Hiccup Head scenes restore every face/rhythm/bank and complete voice/effect state", () => {
  validateFullPresetBank(HICCUP_HEAD_FULL_PRESETS);
  equalIds(HICCUP_HEAD_FULL_PRESETS.map(p => p.snapshot.state.presetId), HICCUP_HEAD_PRESETS);
  equalIds(HICCUP_HEAD_FULL_PRESETS.map(p => p.snapshot.currentPatternId), HICCUP_HEAD_PATTERNS);
  equalIds(HICCUP_HEAD_FULL_PRESETS.map(p => p.snapshot.currentSoundBankId), HICCUP_HEAD_SOUND_BANKS);
  for (const { snapshot } of HICCUP_HEAD_FULL_PRESETS) {
    assert.deepEqual(sanitizeHiccupHeadState(snapshot.state), snapshot.state);
    assert.deepEqual(clonePattern(snapshot.pattern), snapshot.pattern);
    assert.equal(snapshot.voiceSlots.length, 8);
    for (const slot of snapshot.voiceSlots) assert.deepEqual(sanitizeHiccupHeadVoice(slot.voice), slot.voice);
    assert.deepEqual(Object.keys(snapshot.faceEffectEnabled), ["delay", "reverb", "nasal", "stereo"]);
    assert.equal(snapshot.state.patternId, snapshot.currentPatternId);
  }
});

test("Karplus Strong keeps every original material and supplies a complete deterministic tuning field", () => {
  validateFullPresetBank(KARPLUS_STRONG_FULL_PRESETS);
  equalIds(KARPLUS_STRONG_FULL_PRESETS.map(p => p.id), KARPLUS_STRONG_PRESETS);
  for (const { id, snapshot } of KARPLUS_STRONG_FULL_PRESETS) {
    assert.deepEqual(snapshot.settings, KARPLUS_STRONG_PRESETS.find(p => p.id === id).settings);
    assert.deepEqual(sanitizeKarplusStrongTuning(snapshot.tuning), snapshot.tuning);
    assert.deepEqual(sanitizeKarplusStrongSettings(snapshot.settings), snapshot.settings);
  }
});

test("each algorithmic instrument has twelve complete reproducible score-and-sound studies", () => {
  for (const instrument of ALGORITHMIC_INSTRUMENTS) {
    const bank = algorithmicFullPresets(instrument.id);
    validateFullPresetBank(bank);
    for (const { snapshot } of bank) {
      assert.equal(snapshot.settings.algorithmId, instrument.id);
      assert.deepEqual(sanitizeAlgorithmicScoreParams(snapshot.settings), snapshot.settings);
      const a = generateAlgorithmicScore(snapshot.settings);
      assert.deepEqual(generateAlgorithmicScore(snapshot.settings), a);
      assert.ok(a.events.length > 0);
    }
  }
});

test("the replacement cascade banks match their single rhythm-first factory inventories", () => {
  for (const [bank, originals, stack] of [
    [CASCADING_FM_FULL_PRESETS, CASCADING_FM_PRESETS, fmStack],
    [CASCADING_PM_FULL_PRESETS, CASCADING_PM_PRESETS, pmStack],
  ]) {
    validateFullPresetBank(bank);
    for (const original of originals) {
      assert.deepEqual(bank.find(p => p.id === original.id).snapshot.settings, original.settings);
    }
    for (const preset of bank) {
      assert.doesNotThrow(() => presetStateKey(stack(preset.snapshot.settings)));
      assert.equal(preset.snapshot.level, originals.find(item => item.id === preset.id).level);
      assert.ok(preset.snapshot.level <= 0.48);
    }
  }
});
