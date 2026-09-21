import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { presetStateKey } from "../src/site/header-presets.js";
import { presetRandom, clonePresetData, randomMonophonicRows } from "../src/site/preset-random.js";
import {
  SHAPE_FULL_PRESETS, randomizeShapePreset, validateShapePresetParameters,
  createShapeInitialState, applyShapePresetParameters,
} from "../src/instruments/shape-synth/full-presets.js";
import { HICCUP_HEAD_FULL_PRESETS, randomizeHiccupHeadPreset } from "../src/instruments/hiccup-head/full-presets.js";
import { CREATURAZOID_FULL_PRESETS, randomizeCreaturazoidPreset } from "../src/instruments/creaturazoid/full-presets.js";
import { KARPLUS_STRONG_FULL_PRESETS, randomizeKarplusStrongPreset } from "../src/instruments/karplus-strong/full-presets.js";
import { algorithmicFullPresets, randomizeAlgorithmicPreset } from "../src/families/algorithmic-scores/full-presets.js";
import {
  CASCADING_FM_FULL_PRESETS, CASCADING_PM_FULL_PRESETS,
  randomizeCascadingFmPreset, randomizeCascadingPmPreset,
} from "../src/families/cascading/full-presets.js";
import { sanitizeHiccupHeadState, sanitizeHiccupHeadVoice, clonePattern } from "../src/hiccup-head.js";
import { sanitizeCreaturazoidState, sanitizeCreaturazoidPattern } from "../src/creaturazoid.js";
import { sanitizeCascadingFmSettings, deriveCascadeStack as fmStack } from "../src/cascading-fm.js";
import { sanitizeCascadingPmSettings, deriveCascadeStack as pmStack } from "../src/cascading-pm.js";
import {
  sanitizeKarplusStrongSettings, sanitizeKarplusStrongTuning,
  karplusStrongStringFrequencies, generateKarplusStrongSamples,
} from "../src/karplus-strong.js";
import { sanitizeAlgorithmicScoreParams, generateAlgorithmicScore } from "../src/algorithmic-scores.js";
import { renderCascadeReference } from "../scripts/presets/cascade-rhythm-analysis.mjs";
import { parseRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function monophonic(rows, length) {
  let events = 0;
  for (let step = 0; step < length; step++) {
    const count = Object.values(rows).filter(row => row[step] > 0).length;
    assert.ok(count <= 1, `step ${step} contains overlapping voices`);
    events += count;
  }
  assert.ok(events > 0, "randomization must not empty the score");
  for (const row of Object.values(rows)) {
    assert.ok(row.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
}
const cases = [
  { id: "shape-synth", bank: SHAPE_FULL_PRESETS, randomize: randomizeShapePreset, level: s => s.parameters.level,
    validate(s) { validateShapePresetParameters(s.parameters); } },
  { id: "hiccup-head", bank: HICCUP_HEAD_FULL_PRESETS, randomize: randomizeHiccupHeadPreset, level: s => s.state.level,
    validate(s) {
      assert.deepEqual(s.state, sanitizeHiccupHeadState(s.state));
      assert.deepEqual(s.pattern, clonePattern(s.pattern));
      assert.equal(s.currentPatternId, "custom");
      assert.ok(HICCUP_HEAD_FULL_PRESETS.some(p => p.snapshot.visualSkinId === s.visualSkinId));
      for (const slot of s.voiceSlots) assert.deepEqual(slot.voice, sanitizeHiccupHeadVoice(slot.voice));
      monophonic(s.pattern, s.sequenceLength);
    } },
  { id: "creaturazoid", bank: CREATURAZOID_FULL_PRESETS, randomize: randomizeCreaturazoidPreset, level: s => s.state.level,
    validate(s) {
      assert.deepEqual(s.state, sanitizeCreaturazoidState(s.state));
      assert.deepEqual(s.pattern, sanitizeCreaturazoidPattern(s.pattern, s.pattern.length));
      assert.equal(s.state.patternLength, s.pattern.length);
      assert.equal(s.modulationTarget, s.state.modulationTarget);
      assert.equal(s.currentPatternId, "custom");
      monophonic(s.pattern.rows, s.pattern.length);
    } },
  { id: "karplus-strong", bank: KARPLUS_STRONG_FULL_PRESETS, randomize: randomizeKarplusStrongPreset, level: s => s.settings.level,
    validate(s) {
      assert.deepEqual(s.settings, sanitizeKarplusStrongSettings(s.settings));
      assert.deepEqual(s.tuning, sanitizeKarplusStrongTuning(s.tuning));
      assert.equal(s.selectedPresetId, null);
      const field = karplusStrongStringFrequencies(s.tuning);
      assert.ok(field.length > 1 && field.length <= 128);
    } },
  ...[
    ["cascading-fm", CASCADING_FM_FULL_PRESETS, randomizeCascadingFmPreset, sanitizeCascadingFmSettings, fmStack],
    ["cascading-pm", CASCADING_PM_FULL_PRESETS, randomizeCascadingPmPreset, sanitizeCascadingPmSettings, pmStack],
  ].map(([id, bank, randomize, sanitize, stack]) => ({ id, bank, randomize, level: s => s.level,
    validate(s) {
      assert.deepEqual(s.settings, sanitize(s.settings));
      assert.equal(s.activePresetId, null);
      const nodes = stack(s.settings).oscillators;
      assert.ok(s.settings.rootHz >= 0.09 && s.settings.rootHz < 4);
      assert.ok(nodes.at(-1).freq > 30 && nodes.at(-1).freq < 220, "retain low carrier, not an audio-rate drone bank");
      assert.ok(nodes[0].freq < 4);
    } })),
  ...["dijkstra", "hanoi", "minimax", "nqueens", "euclid"].map(id => ({
    id, bank: algorithmicFullPresets(id), randomize: randomizeAlgorithmicPreset, level: s => s.settings.output,
    validate(s) {
      assert.deepEqual(s.settings, sanitizeAlgorithmicScoreParams(s.settings));
      assert.equal(s.settings.algorithmId, id);
      assert.ok(generateAlgorithmicScore(s.settings).events.length > 0);
    },
  })),
];

for (const entry of cases) {
  test(`${entry.id}: 64 seeded rolls and RNG endpoints produce valid complete parameter states, not factory recalls`, () => {
    const originalBank = presetStateKey(entry.bank);
    const keys = new Set(entry.bank.map(p => presetStateKey(p.snapshot)));
    const results = new Set();
    for (let index = 0; index < 66; index++) {
      const current = freeze(clonePresetData(entry.bank[index % entry.bank.length].snapshot));
      const before = presetStateKey(current);
      const rng = () => index === 64 ? () => 0 : index === 65 ? () => 1 : seeded(index * 7919 + 101);
      const result = entry.randomize(current, rng());
      assert.deepEqual(result, entry.randomize(current, rng()), "deterministic injection");
      entry.validate(result);
      const key = presetStateKey(result);
      assert.notEqual(key, before);
      assert.ok(!keys.has(key), "dice must not just choose an existing preset");
      assert.equal(entry.level(result), entry.level(current), "output is not randomized");
      assert.equal(presetStateKey(current), before, "input is immutable");
      if (index < 64) results.add(key);
    }
    assert.equal(results.size, 64);
    assert.equal(presetStateKey(entry.bank), originalBank, "factory presets were not modified");
  });
}

test("randomization preserves zero output and does not serialize device/runtime state", () => {
  for (const entry of cases) {
    const current = clonePresetData(entry.bank[0].snapshot);
    if (current.parameters) current.parameters.level = 0;
    else if (current.state) current.state.level = 0;
    else if (current.settings && "output" in current.settings) current.settings.output = 0;
    else if (current.settings && "level" in current.settings) current.settings.level = 0;
    else current.level = 0;
    const result = entry.randomize(current, seeded(9001));
    assert.equal(entry.level(result), 0, entry.id);
    assert.deepEqual(Object.keys(result).sort(), Object.keys(current).sort());
    const key = presetStateKey(result);
    assert.doesNotMatch(key, /"(?:audio|audioOn|audioContext|sequencePlaying|midiEnabled|webcam|camera)":/);
  }
});

test("Shape randomizes its musical motion switches but preserves Audio/phase and percussion density", () => {
  const observed = new Set();
  for (const playing of [true, false]) for (const autoRotate of [true, false]) {
    for (let seed = 1; seed <= 120; seed++) {
      const current = clonePresetData(SHAPE_FULL_PRESETS[0].snapshot);
      Object.assign(current.parameters, { playing, autoRotate });
      const next = randomizeShapePreset(current, seeded(seed * 307));
      assert.ok(next.parameters.playing || next.parameters.autoRotate, "at least one motion makes the randomized scene playable");
      observed.add(`${next.parameters.playing}:${next.parameters.autoRotate}`);
      const live = { ...createShapeInitialState(), audio: true, position: 0.37, rotation: 32 };
      applyShapePresetParameters(live, next.parameters);
      assert.equal(live.audio, true);
      assert.equal(live.position, 0.37);
      assert.equal(live.rotation, 32);
      const p = next.parameters;
      if (p.soundMode === "percussion") {
        const crossings = p.sides * (p.closedShapeType === "star" ? 2 : 1) * p.heads * (
          (p.playing ? p.speed * (p.motionMode === "pingpong" ? 2 : 1) : 0)
          + (p.autoRotate && p.playMethod === "radial" ? p.rotationSpeed * (p.rotationMotionMode === "pingpong" ? 2 : 1) : 0));
        assert.ok(crossings <= 60 + 1e-9);
        assert.ok(p.percussionAttackNoise <= 0.03);
      }
    }
  }
  assert.deepEqual(observed, new Set(["true:true", "true:false", "false:true"]));
});

test("algorithmic loop is a randomized musical parameter, not frozen to the incoming preset", () => {
  for (const entry of cases.filter(p => p.id === "hanoi" || p.id === "dijkstra")) {
    const values = new Set(Array.from({ length: 32 }, (_, i) => entry.randomize(entry.bank[0].snapshot, seeded(i + 1)).settings.loop));
    assert.deepEqual(values, new Set([true, false]));
  }
});

test("representative randomized strings and FM/PM models render finite bounded non-silent reference samples", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const string = randomizeKarplusStrongPreset(KARPLUS_STRONG_FULL_PRESETS[0].snapshot, seeded(seed));
    const renders = [generateKarplusStrongSamples({ ...string.settings, duration: 0.2, random: seeded(seed) })];
    for (const entry of cases.filter(p => p.id.startsWith("cascading-"))) {
      const snapshot = entry.randomize(entry.bank[0].snapshot, seeded(seed * 711));
      renders.push(renderCascadeReference(entry.id.endsWith("-fm") ? "fm" : "pm", snapshot.settings,
        { seconds: 0.5, sampleRate: 48000 }).samples);
    }
    for (const samples of renders) {
      assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
      assert.ok(samples.some(value => Math.abs(value) > 0.01));
    }
  }
});

test("random utilities reject non-finite draws and generate new monophonic notes/rests/accents", () => {
  assert.equal(presetRandom(() => 1).pick(["a", "b"]), "b");
  assert.equal(presetRandom(() => -1).pick(["a", "b"]), "a");
  for (const value of [NaN, Infinity, undefined]) assert.throws(() => presetRandom(() => value).unit(), /finite/);
  const result = randomMonophonicRows(["a", "b"], 8, 4, presetRandom(() => 0.5));
  assert.equal(result.b.filter(value => value > 0).length, 1);
  assert.ok(result.b[0] > 0 && result.b[0] < 1);
  assert.ok(result.a.every(value => value === 0));
  assert.ok(result.b.slice(4).every(value => value === 0));
  monophonic(result, 4);
});

test("all seven production adapters opt into the common dice contract and the new runtime helper is declared", async () => {
  const paths = [
    ...["shape-synth", "hiccup-head", "creaturazoid", "karplus-strong", "cascading-fm", "cascading-pm"]
      .map(id => `src/instruments/${id}/${id}-app.js`),
    "src/families/algorithmic-scores/algorithmic-scores-app.js",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source.slice(source.lastIndexOf("registerHeaderPresets(")), /randomize: randomize\w+Preset/);
  }
  const inventory = parseRuntimeManifest(await readFile(new URL("../scripts/site/runtime-files.tsv", import.meta.url), "utf8"));
  assert.ok(inventory.worktreeFiles.includes("src/site/preset-random.js"));
  assert.ok(inventory.requiredFiles.includes("src/site/preset-random.js"));
});

function parameterLeaves(value, path = "", entries = []) {
  // A pattern/curve/layout is one compound control. Voice slots are checked
  // additionally below so their assignment/modulation fields cannot hide.
  if (Array.isArray(value) || value === null || typeof value !== "object") entries.push([path, presetStateKey(value)]);
  else for (const [key, child] of Object.entries(value)) parameterLeaves(child, path ? `${path}.${key}` : key, entries);
  return entries;
}
const intentionalConstants = new Set([
  "level", "settings.level", "settings.output", "parameters.level",
  "settings.algorithmId", "selectedPresetId", "activePresetId", "currentPatternId",
  "parameters.amplitudePreset", "parameters.percussionPreset", "parameters.pitchCurvePreset",
  "state.level", "state.presetId", "state.patternId",
  "state.sequencePresetId", "state.biologicalLock",
]);

for (const entry of cases) {
  test(`${entry.id}: every preset-owned parameter varies, except documented output/identity/derived labels`, () => {
    const seen = new Map();
    for (let seed = 1; seed <= 192; seed++) {
      const snapshot = entry.randomize(entry.bank[0].snapshot, seeded(seed * 15197));
      for (const [path, value] of parameterLeaves(snapshot)) {
        if (!seen.has(path)) seen.set(path, new Set());
        seen.get(path).add(value);
      }
    }
    const fixed = [...seen].filter(([path, values]) => values.size === 1 && !intentionalConstants.has(path)).map(([path]) => path);
    assert.deepEqual(fixed, [], `Unrandomized musical parameters: ${fixed.join(", ")}`);
  });
}

test("Hiccup randomizes every nested voice control, including formerly frozen assignments and modulation", () => {
  const seen = new Map();
  for (let seed = 1; seed <= 192; seed++) {
    const snapshot = randomizeHiccupHeadPreset(HICCUP_HEAD_FULL_PRESETS[0].snapshot, seeded(seed * 997));
    for (const slot of snapshot.voiceSlots) for (const [path, value] of parameterLeaves(slot)) {
      if (!seen.has(path)) seen.set(path, new Set());
      seen.get(path).add(value);
    }
    for (const slot of snapshot.voiceSlots) {
      assert.ok(slot.assignment === "all" || snapshot.pattern[slot.assignment]);
    }
  }
  assert.deepEqual([...seen].filter(([path, values]) => path !== "id" && values.size < 2).map(([path]) => path), []);
});

test("randomizers do not select or merge factory presets as their starting configurations", async () => {
  for (const path of [
    ...["shape-synth", "hiccup-head", "creaturazoid", "karplus-strong"].map(id => `src/instruments/${id}/full-presets.js`),
    "src/families/cascading/full-presets.js", "src/families/algorithmic-scores/full-presets.js",
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const randomPart = source.slice(source.indexOf("function randomize"));
    assert.doesNotMatch(randomPart, /(?:rng|random)\.pick\([^)]*(?:FULL_PRESETS|bank|presets)/);
    assert.doesNotMatch(randomPart, /clonePresetData|varyPresetRhythm/);
  }
});
