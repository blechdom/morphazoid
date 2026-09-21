import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RUBIX_SIMD_PRESETS, rubixSimdPreset, rubixSimdVoiceParams, rubixSimdSurfaceTone, rubixPerformerLevels,
} from "../src/rubix-simd-presets.js";
import { createRubixSimdSurfacePatterns, rubixSimdConfigurations } from "../src/rubix-simd-surface.js";
import { createRubixSequenceSnapshot, createSolvedRubixCube, RUBIX_COLOR_ORDER } from "../src/rubix.js";

globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { postMessage() {} }; }
};
globalThis.registerProcessor = () => {};
const { RubixSimd303Processor } = await import("../src/rubix-simd-303-processor.js");
const scalarBytes = await readFile(new URL("../assets/wasm/simd-303-scalar.wasm", import.meta.url));
const simdBytes = await readFile(new URL("../assets/wasm/simd-303-simd.wasm", import.meta.url));

function setup(preset, color = "green", size = 3) {
  const snapshot = createRubixSequenceSnapshot(createSolvedRubixCube(size));
  const faceLanes = Object.fromEntries(Object.entries(snapshot.faceLanes).map(([face, lane]) => [
    face, lane.map((sticker) => ({ ...sticker, color })),
  ]));
  const patterns = createRubixSimdSurfacePatterns({ ...snapshot, faceLanes }, {
    presetId: preset.id, baseParams: rubixSimdVoiceParams({ simdPreset: preset.id }),
    amount: preset.controls.stickerModulation, tempo: 126,
  });
  const processor = new RubixSimd303Processor();
  processor.handleMessage({ type: "install", scalarBytes, simdBytes, faces: rubixSimdConfigurations(patterns) });
  const gains = Object.fromEntries(patterns.find((p) => p.face === "front").stickerIds.map((id) => [id, 1]));
  processor.handleMessage({ type: "visibility", gains });
  globalThis.currentTime = 0;
  processor.handleMessage({ type: "restart", startAt: 0 });
  processor.handleMessage({ type: "playback", enabled: true });
  return { processor, patterns, gains };
}
function render(processor, frames = 24000, offset = 0) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let start = 0; start < frames; start += 128) {
    globalThis.currentTime = (start + offset) / sampleRate;
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process([], [output]);
    left.set(output[0].subarray(0, Math.min(128, frames - start)), start);
    right.set(output[1].subarray(0, Math.min(128, frames - start)), start);
  }
  return { left, right };
}
const energy = (samples) => samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
function fingerprint(samples) {
  const rms = Math.sqrt(energy(samples));
  let crossings = 0;
  let differences = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i] * samples[i - 1] < 0) crossings += 1;
    differences += (samples[i] - samples[i - 1]) ** 2;
  }
  return { rms, crossings, brightness: Math.sqrt(differences / samples.length) / rms };
}

test("sound patches own timbre, never performer volume, cube state or clock", () => {
  assert.equal(RUBIX_SIMD_PRESETS.length, 9);
  assert.ok(Object.isFrozen(RUBIX_SIMD_PRESETS));
  for (const preset of RUBIX_SIMD_PRESETS) {
    assert.ok(Object.isFrozen(preset) && Object.isFrozen(preset.controls));
    for (const forbidden of ["output", "acidLevel", "drumLevel", "tempo", "swing", "camera", "shapeId", "size", "readingMode"]) {
      assert.ok(!Object.hasOwn(preset.controls, forbidden), `${preset.id}: ${forbidden}`);
    }
    assert.equal(preset.voice.lfo, preset.id === "original-sweep" ? 0.72 : 0);
    for (const value of Object.values(rubixSimdVoiceParams({ simdPreset: preset.id }))) assert.ok(Number.isFinite(value));
  }
  const muted = { output: 0, acidLevel: 0, drumLevel: 0.27 };
  assert.deepEqual(rubixPerformerLevels(muted), muted);
  assert.equal(rubixSimdPreset("invalid"), rubixSimdPreset());
});

test("all nine patches render bounded, non-silent and measurably distinct timbres in the actual SIMD kernel", () => {
  const features = [];
  for (const preset of RUBIX_SIMD_PRESETS) {
    const { processor, patterns } = setup(preset);
    const { left } = render(processor);
    assert.ok(left.every(Number.isFinite), preset.id);
    const feature = fingerprint(left);
    assert.ok(feature.rms > 0.002, `${preset.id} is silent`);
    assert.ok(left.every((value) => Math.abs(value) < 1), preset.id);
    if (preset.surface) {
      const config = rubixSimdConfigurations(patterns)[0].configuration;
      assert.deepEqual(config.partialFold, config.partialBase, "no transport-owned spectrum drift");
    }
    features.push({ id: preset.id, ...feature });
  }
  for (let i = 0; i < features.length; i += 1) {
    for (let j = i + 1; j < features.length; j += 1) {
      // Level is intentionally excluded: prove articulation/spectrum differs.
      assert.ok(Math.abs(features[i].brightness - features[j].brightness) > 0.001
        || Math.abs(features[i].crossings - features[j].crossings) > 5,
      `${features[i].id} and ${features[j].id} need more than different volume`);
    }
  }
});

test("each sticker color changes actual pitch and articulation at the same cell and view", () => {
  const signatures = [];
  for (const color of RUBIX_COLOR_ORDER) {
    const { processor, patterns } = setup(rubixSimdPreset(), color);
    const configuration = rubixSimdConfigurations(patterns)[0].configuration;
    signatures.push({
      frequency: configuration.stepFrequency[0],
      articulation: [...configuration.modulationArray.slice(1, 3), ...configuration.expressionArray.slice(0, 2)],
      ...fingerprint(render(processor).left),
    });
  }
  assert.equal(new Set(signatures.map((s) => s.frequency)).size, 6);
  assert.equal(new Set(signatures.map((s) => JSON.stringify(s.articulation))).size, 6);
  assert.equal(new Set(signatures.map((s) => s.crossings)).size, 6);
});

test("rendered surface position and warped shape change tone without changing score or area gain", () => {
  const item = (x, y, depth, radius) => ({
    sticker: { id: "front:0:0" }, projectedCenter: { x, y }, depth,
    center: { x: radius * 3, y: 0, z: 0 },
  });
  const viewport = { width: 1000, height: 800, size: 3 };
  const lower = rubixSimdSurfaceTone([item(300, 600, -1, 0.5)], viewport, 1);
  const upper = rubixSimdSurfaceTone([item(700, 200, 1, 1.2)], viewport, 1);
  assert.ok(upper["front:0:0"].filter > lower["front:0:0"].filter);
  assert.ok(lower["front:0:0"].pan < 0 && upper["front:0:0"].pan > 0);
  const a = setup(rubixSimdPreset());
  const b = setup(rubixSimdPreset());
  const forAll = (gains, tone) => Object.fromEntries(Object.keys(gains).map((id) => [id, tone]));
  a.processor.handleMessage({ type: "visibility", gains: a.gains, timbres: forAll(a.gains, { filter: -35, pan: -0.7 }) });
  b.processor.handleMessage({ type: "visibility", gains: b.gains, timbres: forAll(b.gains, { filter: 35, pan: 0.7 }) });
  const leftward = render(a.processor);
  const rightward = render(b.processor);
  assert.ok(energy(leftward.left) > energy(leftward.right) * 3);
  assert.ok(energy(rightward.right) > energy(rightward.left) * 3);
  assert.ok(Math.abs(fingerprint(leftward.left).brightness - fingerprint(rightward.left).brightness) > 0.01);
  a.processor.handleMessage({ type: "visibility", gains: {} });
  assert.ok(render(a.processor, 2048, 24000).left.subarray(1024).every((value) => value === 0));
});

test("cube-driven presets stay audible across every supported size", () => {
  for (const size of [2, 3, 4, 5, 6]) {
    const { processor } = setup(rubixSimdPreset("morphix-bloom"), "green", size);
    const { left } = render(processor);
    assert.ok(Math.sqrt(energy(left)) > 0.01, `${size}×${size}`);
  }
});
