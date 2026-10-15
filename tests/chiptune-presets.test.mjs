import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chiptuneFullPresets } from "../src/families/chiptune/full-presets.js";
import { SIMD_CHIPTUNE_DEFAULTS } from "../src/instruments/simd-chiptune/audio.js";
import {
  WEBGPU_CHIPTUNE_DEFAULTS, WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE, WEBGPU_CHIPTUNE_PARAM_ORDER,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES, WEBGPU_CHIPTUNE_SEQUENCE_STEPS,
  createWebGpuChiptunePattern, sanitizeWebGpuChiptuneParams, sanitizeWebGpuChiptuneSequence,
} from "../src/instruments/webgpu-chiptune/webgpu-chiptune.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const appSource = await readFile(new URL("../src/families/chiptune/chiptune-app.js", import.meta.url), "utf8");
const presetSource = appSource.slice(appSource.indexOf("function patch("), appSource.indexOf("const SAFE_RANDOM_RANGES"));
const factoryPresets = simdBackend => new Function(
  "sanitizeWebGpuChiptuneParams", "WEBGPU_CHIPTUNE_DEFAULTS", "SIMD_CHIPTUNE_DEFAULTS", "simdBackend",
  "WEBGPU_CHIPTUNE_SEQUENCE_LANES", "WEBGPU_CHIPTUNE_SEQUENCE_STEPS", "sanitizeWebGpuChiptuneSequence",
  "WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE",
  `${presetSource}\nreturn presets;`,
)(sanitizeWebGpuChiptuneParams, simdBackend ? SIMD_CHIPTUNE_DEFAULTS : WEBGPU_CHIPTUNE_DEFAULTS, SIMD_CHIPTUNE_DEFAULTS, simdBackend,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES, WEBGPU_CHIPTUNE_SEQUENCE_STEPS, sanitizeWebGpuChiptuneSequence, WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE);

for (const simd of [false, true]) {
  const name = simd ? "SIMD Chiptune" : "WebGPU Chiptune";
  const kit = chiptuneFullPresets(simd);
  const bank = factoryPresets(simd).map(kit.entry);

  test(`${name} bank reuses every factory preset and is valid and distinct`, () => {
    assert.equal(bank.length, 24);
    validateFullPresetBank(bank);
    for (const preset of bank) {
      assert.equal(kit.validate(preset.snapshot), preset.snapshot);
      assert.equal(preset.snapshot.sequenceMode, "pattern");
    }
    assert.equal(new Set(bank.map(preset => presetStateKey(preset.snapshot))).size, 24);
    assert.throws(() => kit.validate({ params: {} }), TypeError);
    const bad = structuredClone(bank[1].snapshot);
    bad.params.tempo = 99;
    assert.throws(() => kit.validate(bad), TypeError);
  });

  test(`${name} capture round-trips through the snapshot shape and ignores non-musical state`, () => {
    const snapshot = bank[3].snapshot;
    const state = {
      params: snapshot.params, sequence: snapshot.patternSequence, songSequence: snapshot.songSequence,
      patternSequence: snapshot.patternSequence, patternBaseline: snapshot.patternBaseline,
      voicePerformance: snapshot.voicePerformance, drumMix: snapshot.drumMix,
      patternSection: 0, patternSections: { 0: { sequence: snapshot.patternSequence, baseline: snapshot.patternBaseline } },
      presetId: "x", audioOn: true, characterSkin: "worms", transportOffset: 9,
    };
    assert.equal(presetStateKey(kit.capture(state)), presetStateKey(snapshot));
    const song = { ...state, sequence: snapshot.songSequence };
    assert.equal(kit.capture(song).sequenceMode, "song");
  });

  test(`${name} dice is pure, reproducible, bounded and covers every musical field`, () => {
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.equal(presetStateKey(kit.randomize(initial, seed(5))), presetStateKey(kit.randomize(bank[4].snapshot, seed(5))));
    assert.deepEqual(JSON.parse(JSON.stringify(initial)), before);
    const factory = new Set(bank.map(preset => presetStateKey(preset.snapshot)));
    const seen = new Map();
    const note = (path, value) => (seen.get(path) ?? seen.set(path, new Set()).get(path)).add(value);
    const random = seed(77);
    for (let i = 0; i < 40; i++) {
      const result = kit.randomize(initial, random);
      kit.validate(result);
      assert.equal(factory.has(presetStateKey(result)), false);
      assert.equal(result.sequenceMode, initial.sequenceMode);
      for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) note(`params.${key}`, result.params[key]);
      for (const lane of WEBGPU_CHIPTUNE_SEQUENCE_LANES) note(`lane.${lane}`, presetStateKey(result.patternSequence.lanes[lane]));
      for (const [lane, voice] of Object.entries(result.voicePerformance)) { note(`perf.${lane}.x`, voice.x); note(`perf.${lane}.y`, voice.y); }
      assert.equal(Object.values(result.voicePerformance).some(voice => voice.solo), false);
      assert.deepEqual(result.songSequence.lanes, result.patternSequence.lanes);
      assert.equal(presetStateKey(result.patternBaseline), presetStateKey(result.patternSequence));
    }
    const settable = WEBGPU_CHIPTUNE_PARAM_ORDER.filter(key => !/^gate[AB][0-3]$/.test(key));
    for (const key of settable) assert.ok(seen.get(`params.${key}`).size > 1, `${key} stays frozen`);
    for (const key of ["gateA0", "gateB1", "gateA3"]) assert.ok(seen.get(`params.${key}`).size > 5, `${key} stays frozen`);
    for (const [path, values] of seen) if (path.startsWith("lane.") || path.startsWith("perf.")) assert.equal(values.size, 40, path);
  });
}

test("SIMD dice resets sections and keeps the chosen sequence mode", () => {
  const kit = chiptuneFullPresets(true);
  const entry = kit.entry({ id: "t", label: "t", params: SIMD_CHIPTUNE_DEFAULTS, sequence: WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE });
  const pattern = createWebGpuChiptunePattern(SIMD_CHIPTUNE_DEFAULTS, WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE);
  const withSections = { ...structuredClone(entry.snapshot), sequenceMode: "song", patternSection: 3,
    patternSections: { 0: { sequence: pattern, baseline: pattern } } };
  const valid = kit.validate(JSON.parse(presetStateKey(kit.validate(JSON.parse(presetStateKey(withSections))))));
  const result = kit.randomize(valid, seed(1));
  assert.equal(result.sequenceMode, "song");
  assert.equal(result.patternSection, 0);
  assert.deepEqual(result.patternSections, {});
});
