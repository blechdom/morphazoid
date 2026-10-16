import assert from "node:assert/strict";
import test from "node:test";
import { ACOUSTIC_PROFILES } from "../src/instruments/acoustic-manifold/acoustic-manifold.js";
import {
  ACOUSTIC_FULL_PRESETS, ACOUSTIC_PRESET_ANALYSIS_KEYS, ACOUSTIC_PRESET_RESYNTHESIS_KEYS,
  acousticAnalysisBudgetIssue, canonicalAcousticAnalysis, canonicalAcousticPreset,
  captureAcousticPreset, randomizeAcousticPreset, validateAcousticPreset,
} from "../src/instruments/acoustic-manifold/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Acoustic Manifold bank is complete, valid, finite JSON and budget-safe", () => {
  validateFullPresetBank(ACOUSTIC_FULL_PRESETS);
  assert.ok(ACOUSTIC_FULL_PRESETS.length >= 12);
  for (const preset of ACOUSTIC_FULL_PRESETS) {
    assert.equal(validateAcousticPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(JSON.parse(presetStateKey(preset.snapshot)), preset.snapshot);
    assert.equal(captureAcousticPreset(preset.snapshot).profile, preset.snapshot.profile);
    assert.notEqual(preset.snapshot.route.rule, "manual");
    const { analysis } = preset.snapshot;
    assert.ok(analysis.analysisTargetRate * 0.48 >= analysis.maximumSpectralHz * 0.995, `${preset.id} band uncovered`);
    assert.ok(analysis.maximumSpectralHz <= 48_000 * 0.48, `${preset.id} needs a wider source than 48 kHz`);
    for (const source of [{}, { sampleRate: 48_000, sampleCount: 48_000 * 60 }, { sampleRate: 22_050, sampleCount: 22_050 * 120 }]) {
      assert.equal(acousticAnalysisBudgetIssue(preset.snapshot.profile, analysis, source), null, preset.id);
    }
  }
  assert.equal(new Set(ACOUSTIC_FULL_PRESETS.map(preset => preset.snapshot.profile)).size >= 10, true);
  assert.equal(ACOUSTIC_FULL_PRESETS[0].snapshot.profile, "songbird");
});

test("Acoustic Manifold validation rejects incomplete, extra and out-of-range state", () => {
  const good = structuredClone(ACOUSTIC_FULL_PRESETS[1].snapshot);
  assert.throws(() => validateAcousticPreset(null), TypeError);
  assert.throws(() => validateAcousticPreset({}), TypeError);
  for (const mutate of [
    s => { s.profile = "nope"; },
    s => { s.analysis.frameSize = 100; },
    s => { s.analysis.neighborCount = 99; },
    s => { s.route.rule = "bogus"; },
    s => { s.route.length = 40; },
    s => { s.listenMode = "both"; },
    s => { s.resynthesis.gestureSpeed = 9; },
    s => { s.resynthesis.pitchShift = "3"; },
    s => { s.extra = 1; },
    s => { delete s.route; },
  ]) {
    const bad = structuredClone(good);
    mutate(bad);
    assert.throws(() => validateAcousticPreset(bad), Error);
  }
  assert.throws(() => validateAcousticPreset({ ...good, resynthesis: { ...good.resynthesis, gapMs: NaN } }), Error);
});

test("canonical analysis is idempotent and valid for every profile", () => {
  for (const id of Object.keys(ACOUSTIC_PROFILES)) {
    const first = canonicalAcousticAnalysis(id, {});
    if (!["delphinid-click", "harbor-porpoise-click", "kogia-click", "snapping-shrimp", "beaked-whale-click", "bat-echolocation"].includes(id)) {
      assert.deepEqual(canonicalAcousticAnalysis(id, first), first, id);
    }
    assert.ok(first.minimumSpectralHz < first.maximumSpectralHz);
  }
  assert.deepEqual(canonicalAcousticAnalysis("passerine-window", { fixedWindowSeconds: 0, minimumEventSeconds: 50 }).fixedWindowSeconds, 0.001);
});

test("Acoustic Manifold dice is pure, reproducible, bounded and varies every field", () => {
  const initial = ACOUSTIC_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeAcousticPreset(initial, seed(5)), randomizeAcousticPreset(ACOUSTIC_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(ACOUSTIC_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const analysisSeen = new Map(ACOUSTIC_PRESET_ANALYSIS_KEYS.map(key => [key, new Set()]));
  const resynthSeen = new Map(ACOUSTIC_PRESET_RESYNTHESIS_KEYS.map(key => [key, new Set()]));
  const seenOther = { profile: new Set(), rule: new Set(), length: new Set(), surprise: new Set(), listenMode: new Set() };
  const random = seed(77);
  for (let i = 0; i < 160; i++) {
    const sampleRate = [22_050, 44_100, 48_000, 96_000][i % 4];
    const context = { sampleRate, sampleCount: i % 2 ? sampleRate * 90 : null };
    const result = randomizeAcousticPreset(initial, random, context);
    validateAcousticPreset(result);
    assert.deepEqual(canonicalAcousticPreset(result), result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.notEqual(result.route.rule, "manual");
    const { analysis } = result;
    assert.ok(analysis.maximumSpectralHz <= sampleRate * 0.48 / 0.995, "band exceeds source rate");
    assert.ok(analysis.analysisTargetRate * 0.48 >= analysis.maximumSpectralHz * 0.995, "analysis rate hides band");
    assert.equal(acousticAnalysisBudgetIssue(result.profile, analysis, context), null);
    for (const key of ACOUSTIC_PRESET_ANALYSIS_KEYS) analysisSeen.get(key).add(analysis[key]);
    for (const key of ACOUSTIC_PRESET_RESYNTHESIS_KEYS) resynthSeen.get(key).add(result.resynthesis[key]);
    seenOther.profile.add(result.profile);
    seenOther.rule.add(result.route.rule);
    seenOther.length.add(result.route.length);
    seenOther.surprise.add(result.route.surprise);
    seenOther.listenMode.add(result.listenMode);
  }
  for (const [key, values] of analysisSeen) {
    if (["fixedWindowSeconds", "fixedWindowOverlapPercent", "minimumActiveRatioPercent"].includes(key)) {
      assert.ok(values.size > 1, `${key} stays frozen`);
    } else assert.ok(values.size > 5 || key === "sequenceGapSeconds" || key === "hopRatio" || key === "frameSize", `${key} stays frozen`);
  }
  assert.ok(analysisSeen.get("sequenceGapSeconds").has(null) && analysisSeen.get("sequenceGapSeconds").size > 5);
  assert.equal(analysisSeen.get("frameSize").size, 6);
  assert.equal(analysisSeen.get("hopRatio").size >= 4, true);
  for (const [key, values] of resynthSeen) assert.ok(values.size > 30, `${key} stays frozen`);
  assert.ok(seenOther.profile.size > 10);
  assert.ok(seenOther.rule.size >= 9);
  assert.ok(seenOther.length.size > 10);
  assert.ok(seenOther.surprise.size > 50);
  assert.equal(seenOther.listenMode.size, 2);
});

test("Acoustic Manifold dice never creates a snapshot touching input or transport state", () => {
  const keys = Object.keys(randomizeAcousticPreset(ACOUSTIC_FULL_PRESETS[0].snapshot, seed(3))).sort();
  assert.deepEqual(keys, ["analysis", "listenMode", "profile", "resynthesis", "route"]);
});

test("Acoustic Manifold dice accepts a manual-route custom state", () => {
  const manual = structuredClone(ACOUSTIC_FULL_PRESETS[0].snapshot);
  manual.route.rule = "manual";
  validateAcousticPreset(manual);
  assert.notEqual(randomizeAcousticPreset(manual, seed(9)).route.rule, "manual");
});
