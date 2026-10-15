import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSimdResonatorConfiguration } from '../src/simd-resonator.js';
import { DEFAULTS, MAX_MODES, COEFFICIENT_KEYS, createConfiguration, sanitizeSettings, kernelViews } from '../src/instruments/simd-resonator-rust/model.js';
import { PRESETS, validatePreset, randomizePreset } from '../src/instruments/simd-resonator-rust/presets.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/rust-resonator-simd.wasm', import.meta.url)));
function render(settings, cap = MAX_MODES) {
  const config = createConfiguration(settings), kernel = kernelViews(new WebAssembly.Instance(module).exports);
  for (const key of COEFFICIENT_KEYS) kernel[key].set(config[key]);
  if (cap < MAX_MODES) kernel.gain.fill(0, cap);
  const output = new Float32Array(24064);
  for (let start = 0; start < output.length; start += 128) {
    kernel.exports.process_resonator(128, config.modeCount, start === 0 ? .8 : 0, config.outputScale);
    output.set(kernel.outputLeft, start);
  }
  return output;
}
const rms = buffer => Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);

test('classic modal coefficients and scale match the original at original counts and sample rates', () => {
  for (const rate of [44100, 48000, 96000]) for (const count of [32, 80, 128]) {
    const settings = { ...DEFAULTS, modeCount: count, spectralSpan: count };
    const before = createSimdResonatorConfiguration(settings, rate), after = createConfiguration(settings, rate);
    for (const key of COEFFICIENT_KEYS) assert.deepEqual(after[key].slice(0, count), before[key].slice(0, count), key);
    assert.equal(after.outputScale, before.outputScale); assert.equal(after.audibleModes, before.audibleModes);
  }
});
test('all dense presets place every requested wave below the Nyquist guard', () => {
  for (const preset of PRESETS.filter(preset => preset.id.startsWith('rust:'))) {
    const configuration = createConfiguration(preset.snapshot);
    assert.equal(configuration.audibleModes, configuration.modeCount, preset.id);
    assert.ok(configuration.frequencies[configuration.modeCount - 1] < 48000 * .44);
    assert.ok(configuration.strike.slice(128, configuration.modeCount).some(value => value !== 0));
  }
});
test('extra waves contribute to the actual output with comparable raw levels', () => {
  const sparse = render({ ...DEFAULTS, modeCount: 128 });
  const dense = render({ ...DEFAULTS, modeCount: 4096 });
  const truncated = render({ ...DEFAULTS, modeCount: 4096 }, 128);
  const difference = dense.map((value, i) => value - truncated[i]);
  assert.ok(rms(difference) > .005);
  assert.ok(rms(dense) / rms(sparse) > .5); assert.ok(rms(dense) / rms(sparse) < 2);
  for (const buffer of [sparse, dense, truncated]) assert.ok(buffer.every(value => Number.isFinite(value) && Math.abs(value) < 1));
});
test('all twenty scenes render finite stereo-compatible output and useful strike levels', () => {
  assert.equal(PRESETS.length, 20);
  for (const preset of PRESETS) {
    assert.deepEqual(validatePreset(preset.snapshot), preset.snapshot);
    const audio = render(preset.snapshot);
    assert.ok(audio.every(value => Number.isFinite(value) && Math.abs(value) < 1), preset.id);
    assert.ok(rms(audio) > .001, preset.id);
  }
});
test('untrusted settings stay bounded; dice covers waves and span while retaining schema', () => {
  assert.equal(sanitizeSettings({ modeCount: Infinity }).modeCount, 512);
  assert.equal(sanitizeSettings({ modeCount: 1e9, spectralSpan: -1 }).modeCount, 4096);
  assert.equal(sanitizeSettings({ spectralSpan: -1 }).spectralSpan, 8);
  const counts = new Set(), spans = new Set();
  for (let i = 0; i < 30; i++) {
    const snapshot = randomizePreset(DEFAULTS);
    validatePreset(snapshot); counts.add(snapshot.modeCount); spans.add(snapshot.spectralSpan);
    assert.equal(snapshot.modeCount % 4, 0);
  }
  assert.ok(counts.size > 1); assert.ok(spans.size > 1);
});
