import assert from "node:assert/strict";
import test from "node:test";
import {
  SHADER_SYNTH_FULL_PRESETS, captureShaderSynthPreset, randomizeShaderSynthPreset,
  shaderSynthSnapshotPatch, validateShaderSynthPreset,
} from "../src/instruments/shader-synth-playground/full-presets.js";
import {
  SHADER_PLAYGROUND_PRESETS, validateShaderPlaygroundPatch,
} from "../src/instruments/shader-synth-playground/shader-synth-playground.js?v=20260902-monotonic-play-note";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Modular Shader Synth bank reuses the starting points and authored scenes", () => {
  validateFullPresetBank(SHADER_SYNTH_FULL_PRESETS);
  const ids = SHADER_SYNTH_FULL_PRESETS.map(preset => preset.id);
  for (const preset of SHADER_PLAYGROUND_PRESETS) assert.ok(ids.includes(preset.id));
  assert.ok(SHADER_SYNTH_FULL_PRESETS.length >= 12);
  for (const preset of SHADER_SYNTH_FULL_PRESETS) {
    assert.equal(validateShaderSynthPreset(preset.snapshot), preset.snapshot);
    assert.equal(validateShaderPlaygroundPatch(shaderSynthSnapshotPatch(preset.snapshot)).valid, true, preset.id);
  }
  assert.throws(() => validateShaderSynthPreset({}), TypeError);
  const bad = structuredClone(SHADER_SYNTH_FULL_PRESETS[0].snapshot);
  bad.nodes[0].params.nonsense = 1;
  assert.throws(() => validateShaderSynthPreset(bad), TypeError);
});

test("Modular Shader Synth capture ignores layout and generated cable ids", () => {
  const snapshot = SHADER_SYNTH_FULL_PRESETS[2].snapshot;
  const patch = shaderSynthSnapshotPatch(snapshot);
  patch.nodes.forEach((node, index) => Object.assign(node, { x: 900 - index * 7, y: 15 + index }));
  patch.connections.forEach((connection, index) => { connection.id = `c-random-${index}`; });
  patch.name = "Renamed";
  assert.deepEqual(captureShaderSynthPreset({ patch, organRanks: snapshot.organRanks }), snapshot);
});

test("Modular Shader Synth dice is pure, reproducible, valid and varies every parameter", () => {
  const initial = SHADER_SYNTH_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeShaderSynthPreset(initial, seed(5)), randomizeShaderSynthPreset(structuredClone(initial), seed(5)));
  assert.deepEqual(initial, before);
  const bank = new Set(SHADER_SYNTH_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(404), seen = new Map(), counts = new Map();
  for (let i = 0; i < 300; i++) {
    const result = randomizeShaderSynthPreset(initial, random);
    validateShaderSynthPreset(result);
    assert.equal(bank.has(presetStateKey(result)), false);
    assert.equal(validateShaderPlaygroundPatch(shaderSynthSnapshotPatch(result)).valid, true);
    const note = (key, value) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(JSON.stringify(value));
    };
    note("nodeCount", result.nodes.length);
    for (const node of result.nodes) {
      if (node.type === "output") continue;
      for (const [key, value] of Object.entries(node.params)) note(`${node.type}.${key}`, value);
    }
    result.organRanks.forEach((rank, index) => { for (const [key, value] of Object.entries(rank)) note(`rank${index}.${key}`, value); });
  }
  assert.ok(seen.size > 200);
  for (const [key, values] of seen) if (counts.get(key) >= 10) assert.ok(values.size > 1, `${key} stays frozen`);
});

test("Modular Shader Synth dice preserves the current output stage", () => {
  const current = structuredClone(SHADER_SYNTH_FULL_PRESETS[0].snapshot);
  const output = current.nodes.find(node => node.type === "output");
  output.params.level = 0.31;
  for (let i = 0; i < 20; i++) {
    const result = randomizeShaderSynthPreset(current, seed(i + 1));
    assert.equal(result.nodes.find(node => node.type === "output").params.level, 0.31);
  }
});
