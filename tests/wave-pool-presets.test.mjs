import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WAVE_POOL_STATE, createWavePoolState } from "../src/instruments/wave-pool/wave-pool.js";
import { WavePoolPhysicalProcessor } from "../src/instruments/wave-pool/wave-pool-processor.js";
import {
  WAVE_POOL_FULL_PRESETS, WAVE_POOL_NUMERIC_KEYS, WAVE_POOL_PRESET_KEYS, captureWavePoolPreset, randomizeWavePoolPreset,
  validateWavePoolPreset, wavePoolStateFromPreset,
} from "../src/instruments/wave-pool/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Wave Pool bank is complete, valid and distinct", () => {
  validateFullPresetBank(WAVE_POOL_FULL_PRESETS);
  assert.deepEqual(WAVE_POOL_FULL_PRESETS[0].snapshot, captureWavePoolPreset(DEFAULT_WAVE_POOL_STATE));
  for (const preset of WAVE_POOL_FULL_PRESETS) assert.equal(validateWavePoolPreset(preset.snapshot), preset.snapshot);
  const bad = structuredClone(WAVE_POOL_FULL_PRESETS[1].snapshot);
  bad.depthM = 99;
  assert.throws(() => validateWavePoolPreset(bad), TypeError);
  assert.throws(() => validateWavePoolPreset({ ...WAVE_POOL_FULL_PRESETS[1].snapshot, boundaryId: "nope" }), TypeError);
  assert.throws(() => validateWavePoolPreset({ ...WAVE_POOL_FULL_PRESETS[1].snapshot, level: 0.3 }), TypeError);
});

test("Wave Pool apply round-trips and keeps session level", () => {
  for (const preset of WAVE_POOL_FULL_PRESETS) {
    const state = createWavePoolState("steel-flume", { level: 0.61 });
    const next = wavePoolStateFromPreset(state, preset.snapshot);
    assert.deepEqual(captureWavePoolPreset(next), preset.snapshot);
    assert.equal(next.level, 0.61);
    assert.equal(next.presetId, state.presetId);
  }
});

test("Wave Pool dice is pure, reproducible and varies every musical field", () => {
  const initial = WAVE_POOL_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeWavePoolPreset(initial, seed(5)), randomizeWavePoolPreset(WAVE_POOL_FULL_PRESETS[3].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(WAVE_POOL_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const seen = new Map(WAVE_POOL_PRESET_KEYS.filter(key => key !== "pattern").map(key => [key, new Set()]));
  const patterns = new Set();
  const random = seed(77);
  for (let i = 0; i < 64; i++) {
    const result = randomizeWavePoolPreset(initial, random);
    validateWavePoolPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    assert.ok(result.waveHeightM <= result.depthM * 0.78);
    for (const [key, values] of seen) values.add(result[key]);
    patterns.add(presetStateKey(result.pattern));
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "paddleCount" ? 6 : WAVE_POOL_NUMERIC_KEYS.includes(key) ? 15 : 2), `${key} stays frozen`);
  assert.equal(patterns.size, 64);
  assert.throws(() => randomizeWavePoolPreset(initial, () => NaN), TypeError);
});

const FRAME = 2048, SAMPLE_RATE = 48000;

function render(configuration) {
  const processor = new WavePoolPhysicalProcessor({ processorOptions: { configuration, seed: 123 } });
  processor.port.onmessage({ data: { type: "transport", playing: true, reset: true } });
  const samples = [];
  for (let block = 0; block < 1000; block++) {
    const left = new Float32Array(128), right = new Float32Array(128);
    processor.process([], [[left, right]]);
    for (let i = 0; i < 128; i++) {
      assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]) && Math.abs(left[i]) <= 1 && Math.abs(right[i]) <= 1);
      samples.push((left[i] + right[i]) / 2);
    }
  }
  return samples;
}

function strongestShare(samples, start) {
  const windowed = Float64Array.from({ length: FRAME }, (_, i) => samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1))));
  const powers = [];
  for (let bin = Math.ceil(80 * FRAME / SAMPLE_RATE); bin <= Math.floor(10000 * FRAME / SAMPLE_RATE); bin++) {
    const c = 2 * Math.cos(2 * Math.PI * bin / FRAME);
    let a = 0, b = 0;
    for (let i = 0; i < FRAME; i++) { const n = windowed[i] + c * a - b; b = a; a = n; }
    powers.push(Math.max(0, a * a + b * b - c * a * b));
  }
  const total = powers.reduce((x, y) => x + y, 0);
  return total > 0 ? powers.sort((x, y) => y - x).slice(0, 5).reduce((x, y) => x + y, 0) / total : 1;
}

test("Wave Pool bank and dice scenes render finite, water-first audio", () => {
  const random = seed(2024);
  const scenes = [
    ...WAVE_POOL_FULL_PRESETS.map(preset => [preset.id, preset.snapshot]),
    ...Array.from({ length: 12 }, (_, i) => [`dice-${i}`, randomizeWavePoolPreset(WAVE_POOL_FULL_PRESETS[0].snapshot, random)]),
  ];
  for (const [id, snapshot] of scenes) {
    const samples = render(wavePoolStateFromPreset(createWavePoolState("family-surge"), snapshot));
    const shares = [];
    for (let start = 0; start + FRAME <= samples.length; start += FRAME) {
      const frame = samples.slice(start, start + FRAME);
      if (Math.sqrt(frame.reduce((x, y) => x + y * y, 0) / FRAME) > 1e-4) shares.push(strongestShare(samples, start));
    }
    if (!shares.length) continue;
    const mean = shares.reduce((x, y) => x + y, 0) / shares.length;
    assert.ok(mean < 0.26, `${id} mean tonal share ${mean.toFixed(3)}`);
    assert.ok(Math.max(...shares) < 0.46, `${id} peak tonal share ${Math.max(...shares).toFixed(3)}`);
  }
});
