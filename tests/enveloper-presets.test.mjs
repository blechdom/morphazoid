import assert from "node:assert/strict";
import test from "node:test";
import {
  ENVELOPER_FULL_PRESETS, captureEnveloperPreset, randomizeEnveloperPreset, validateEnveloperPreset,
} from "../src/instruments/enveloper/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const leaves = result => result.tree.leaves;

test("Enveloper bank is complete, valid and round-trips", () => {
  validateFullPresetBank(ENVELOPER_FULL_PRESETS);
  for (const preset of ENVELOPER_FULL_PRESETS) {
    assert.equal(validateEnveloperPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureEnveloperPreset(structuredClone(preset.snapshot)), preset.snapshot);
    assert.equal(preset.snapshot.tree.leaves.length, 9);
    assert.equal(preset.snapshot.tree.branches.length, 3);
  }
  assert.ok(new Set(ENVELOPER_FULL_PRESETS.map(p => p.snapshot.voice)).size >= 6);
  assert.ok(new Set(ENVELOPER_FULL_PRESETS.map(p => p.snapshot.tree.cycleSeconds)).size >= 10);
});

test("Enveloper validation rejects damaged scenes and excludes level/transport", () => {
  const good = structuredClone(ENVELOPER_FULL_PRESETS[5].snapshot);
  for (const key of ["level", "playing", "scoreSeconds", "audioOn"]) assert.equal(Object.hasOwn(good, key), false);
  const bad = structuredClone(good); bad.baseMidi = 100;
  assert.throws(() => validateEnveloperPreset(bad), TypeError);
  const unordered = structuredClone(good); unordered.tree.root.nodes[1].time = 0.99;
  assert.throws(() => validateEnveloperPreset(unordered), TypeError);
  const voice = structuredClone(good); voice.voice = "nope";
  assert.throws(() => validateEnveloperPreset(voice), TypeError);
  assert.throws(() => validateEnveloperPreset({}), TypeError);
});

test("Enveloper dice is pure, reproducible, bounded and varies every field", () => {
  const initial = ENVELOPER_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeEnveloperPreset(initial, seed(5)), randomizeEnveloperPreset(ENVELOPER_FULL_PRESETS[6].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(ENVELOPER_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = { cycle: new Set(), baseMidi: new Set(), pitchSpan: new Set(), fmAmount: new Set(), voice: new Set(), pitch: new Set(),
    timbre: new Set(), rootLevel: new Set(), branchTime: new Set(), pitchEnv: new Set(), indexEnv: new Set() };
  const random = seed(77);
  for (let i = 0; i < 100; i++) {
    const result = randomizeEnveloperPreset(initial, random);
    validateEnveloperPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    seen.cycle.add(result.tree.cycleSeconds); seen.baseMidi.add(result.baseMidi); seen.pitchSpan.add(result.pitchSpan);
    seen.fmAmount.add(result.fmAmount); seen.voice.add(result.voice); seen.rootLevel.add(result.tree.root.nodes[1].level);
    seen.branchTime.add(result.tree.branches[1].nodes[1].time);
    for (const leaf of leaves(result)) {
      seen.pitch.add(leaf.pitch); seen.timbre.add(leaf.timbre);
      seen.pitchEnv.add(leaf.pitchEnvelope.nodes[2].level); seen.indexEnv.add(leaf.indexEnvelope.nodes[1].time);
    }
  }
  for (const [key, values] of Object.entries(seen)) assert.ok(values.size >= 5, `${key} stays frozen`);
  assert.ok(seen.voice.size >= 8);
  assert.throws(() => randomizeEnveloperPreset(initial, () => Infinity), TypeError);
});
