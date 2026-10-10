import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PERFORMANCE, sanitizePerformance, musicalMix, recallMix, MASTERING_PRESETS }
  from '../src/instruments/fractal-delay/performance.js';
import { NETWORK_PERFORMANCE } from '../src/instruments/fractal-delay/wasm-runtime.js';

test('delay receiver gain has matching defaults and finite bounds for old and new sessions', () => {
  assert.equal(DEFAULT_PERFORMANCE.delayGainDb, 24);
  assert.equal(NETWORK_PERFORMANCE.delayGainDb, DEFAULT_PERFORMANCE.delayGainDb);
  assert.equal(sanitizePerformance({ wet: 1, dry: 0 }).delayGainDb, 24);
  assert.equal(sanitizePerformance({ delayGainDb: Infinity }).delayGainDb, 24);
  assert.equal(sanitizePerformance({ delayGainDb: NaN }).delayGainDb, 24);
  assert.equal(sanitizePerformance({ delayGainDb: -90 }).delayGainDb, -12);
  assert.equal(sanitizePerformance({ delayGainDb: 90 }).delayGainDb, 48);
  assert.equal(sanitizePerformance({ delayGainDb: 31.5 }).delayGainDb, 31.5);
});

test('musical recall and mastering retain independently chosen delay and source levels', () => {
  const current = sanitizePerformance({ ...DEFAULT_PERFORMANCE, inputGain: .42,
    delayGainDb: 37.5, outputLevel: .73, outputBoostDb: 2.5 });
  const scene = musicalMix({ ...DEFAULT_PERFORMANCE, wet: .95, dry: .05 });
  assert(!Object.hasOwn(scene, 'delayGainDb'), 'the preset does not own the live delay level');
  const recalled = recallMix({ ...scene, delayGainDb: -12, inputGain: 4 }, current);
  assert.equal(recalled.delayGainDb, 37.5);
  assert.equal(recalled.inputGain, .42);
  assert.equal(recalled.outputLevel, .73);
  assert.equal(recalled.outputBoostDb, 2.5);
  assert.equal(recalled.wet, .95);
  assert.equal(recalled.dry, .05);
  for (const preset of MASTERING_PRESETS) {
    const mastered = sanitizePerformance({ ...current, ...preset.mix });
    assert.equal(mastered.delayGainDb, 37.5);
    assert.equal(mastered.inputGain, .42);
    assert.equal(mastered.outputLevel, .73);
  }
});
