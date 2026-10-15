import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WEBGPU_SYNTHS_DEFAULTS, WEBGPU_SYNTHS_MODELS, WEBGPU_SYNTHS_PARAM_ORDER,
  sanitizeWebGpuSynthModelLayers, sanitizeWebGpuSynthParams,
} from "../src/instruments/webgpu-synths/webgpu-synths.js";
import {
  captureWebGpuSynthsPreset, randomizeWebGpuSynthsPreset, validateWebGpuSynthsPreset, webGpuSynthsPresetEntry,
} from "../src/instruments/webgpu-synths/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const app = await readFile(new URL("../src/instruments/webgpu-synths/webgpu-synths-app.js", import.meta.url), "utf8");
const librarySource = app.slice(app.indexOf("function presetParams("), app.indexOf("const PRESETS = shuffledPresetBank(PRESET_LIBRARY);"));
const library = new Function(
  "clamp", "WEBGPU_SYNTHS_DEFAULTS", "WEBGPU_SYNTHS_MODELS", "sanitizeWebGpuSynthParams", "sanitizeWebGpuSynthModelLayers",
  `${librarySource}\nreturn shuffledPresetBank(PRESET_LIBRARY);`,
)((value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0)),
  WEBGPU_SYNTHS_DEFAULTS, WEBGPU_SYNTHS_MODELS, sanitizeWebGpuSynthParams, sanitizeWebGpuSynthModelLayers);
const bank = library.map(definition => webGpuSynthsPresetEntry(definition));

test("GPU Synths bank reuses every shader preset and is complete, valid and distinct", () => {
  assert.equal(bank.length, 32);
  validateFullPresetBank(bank);
  for (const preset of bank) {
    assert.equal(validateWebGpuSynthsPreset(preset.snapshot), preset.snapshot);
    assert.equal(preset.snapshot.sequence.length, 64);
    assert.equal(preset.snapshot.params.topology, preset.snapshot.modelLayers[0].model);
  }
  assert.throws(() => validateWebGpuSynthsPreset({ params: {} }), TypeError);
  const bad = structuredClone(bank[1].snapshot);
  bad.params.filterCutoff = 1e9;
  assert.throws(() => validateWebGpuSynthsPreset(bad), TypeError);
});

test("GPU Synths capture ignores non-musical state and re-derives topology from layers", () => {
  const snapshot = bank[2].snapshot;
  assert.deepEqual(captureWebGpuSynthsPreset({ ...snapshot, presetId: "x", audioOn: true, activeLane: 3 }), snapshot);
  const drifted = captureWebGpuSynthsPreset({ ...snapshot, params: { ...snapshot.params, topology: 7 } });
  assert.equal(drifted.params.topology, snapshot.modelLayers[0].model);
});

test("GPU Synths dice is pure, reproducible, bounded and varies every musical field", () => {
  const initial = bank[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeWebGpuSynthsPreset(initial, seed(5)), randomizeWebGpuSynthsPreset(bank[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(bank.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map();
  const note = (path, value) => (seen.get(path) ?? seen.set(path, new Set()).get(path)).add(value);
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeWebGpuSynthsPreset(initial, random);
    validateWebGpuSynthsPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.equal(result.params.filterTaps % 2, 1);
    assert.equal(new Set(result.laneRoutes.slice(2)).size, 6);
    for (const key of WEBGPU_SYNTHS_PARAM_ORDER) note(`params.${key}`, result.params[key]);
    result.laneRoutes.forEach((value, index) => note(`route.${index}`, value));
    result.modelLayers.forEach((layer, index) => Object.entries(layer).forEach(([key, value]) => note(`layer.${index}.${key}`, value)));
    result.organRanks.forEach((rank, index) => Object.entries(rank).forEach(([key, value]) => note(`rank.${index}.${key}`, value)));
    note("sequence", presetStateKey(result.sequence));
    note("technique", result.techniqueId);
  }
  for (const [path, values] of seen) {
    if (path === "route.0" || path === "route.1") continue;
    assert.ok(values.size > 1, `${path} stays frozen`);
  }
  assert.equal(seen.get("sequence").size, 64);
});
