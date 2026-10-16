import assert from "node:assert/strict";
import test from "node:test";
import { GRAPH_3D_FULL_PRESETS, captureGraph3DPreset, graph3DRestorePayload, GRAPH_3D_PRESET_KEYS, randomizeGraph3DPreset, validateGraph3DPreset } from "../src/instruments/graph-3d/full-presets.js";
import { GRAPH_3D_DEFAULTS, Graph3DModel } from "../src/instruments/graph-3d/graph-3d.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const flatten = snapshot => [...Object.entries(snapshot.settings), ['pins', snapshot.pins], ['enabled', snapshot.enabled]];

test("3D Graph bank is complete, valid and distinct", () => {
  validateFullPresetBank(GRAPH_3D_FULL_PRESETS);
  for (const preset of GRAPH_3D_FULL_PRESETS) assert.equal(validateGraph3DPreset(preset.snapshot), preset.snapshot);
  assert.throws(() => validateGraph3DPreset({}), TypeError);
  assert.throws(() => validateGraph3DPreset(null), TypeError);
});

test("3D Graph dice is pure, reproducible and varies every musical field", () => {
  const initial = GRAPH_3D_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeGraph3DPreset(initial, seed(5)), randomizeGraph3DPreset(GRAPH_3D_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const known = new Set(GRAPH_3D_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeGraph3DPreset(initial, random);
    validateGraph3DPreset(result);
    assert.equal(known.has(presetStateKey(result)), false);
    for (const [key, value] of flatten(result)) {
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(JSON.stringify(value));
    }
  }
  for (const key of Object.keys(GRAPH_3D_DEFAULTS)) assert.ok(seen.has(key), `${key} missing`);
  for (const [key, values] of seen) assert.ok(values.size > 1, `${key} stays frozen`);
});

test("3D Graph presets and dice results round-trip through the real model", () => {
  const random = seed(11), model = new Graph3DModel();
  const snapshots = [...GRAPH_3D_FULL_PRESETS.map(preset => preset.snapshot), ...Array.from({ length: 16 }, () => randomizeGraph3DPreset(GRAPH_3D_FULL_PRESETS[0].snapshot, random))];
  for (const snapshot of snapshots) {
    model.restore(graph3DRestorePayload(snapshot));
    assert.equal(presetStateKey(captureGraph3DPreset(model)), presetStateKey(snapshot));
    for (let i = 0; i < 20; i++) model.step(1 / 60);
    assert.equal(presetStateKey(captureGraph3DPreset(model)), presetStateKey(snapshot), "live force motion must not change the captured scene");
  }
});
