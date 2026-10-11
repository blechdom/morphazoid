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

test('network drive defaults feed the delay with direct input muted and sanitize older sessions', () => {
  assert.equal(DEFAULT_PERFORMANCE.inputDriveDb, 12);
  assert.equal(DEFAULT_PERFORMANCE.dry, 0);
  assert.equal(NETWORK_PERFORMANCE.inputDriveDb, DEFAULT_PERFORMANCE.inputDriveDb);
  assert.equal(NETWORK_PERFORMANCE.dry, DEFAULT_PERFORMANCE.dry);
  assert.equal(sanitizePerformance({ wet: 1 }).inputDriveDb, 12);
  assert.equal(sanitizePerformance({ wet: 1 }).dry, 0);
  for (const inputDriveDb of [NaN, Infinity]) assert.equal(sanitizePerformance({ inputDriveDb }).inputDriveDb, 12);
  assert.equal(sanitizePerformance({ inputDriveDb: -90 }).inputDriveDb, -12);
  assert.equal(sanitizePerformance({ inputDriveDb: 90 }).inputDriveDb, 24);
  assert.equal(sanitizePerformance({ inputDriveDb: 7.5 }).inputDriveDb, 7.5);
  const legacy = recallMix({ inputDriveDb: 24, dry: 1, wet: .9 },
    { inputGain: .4, delayGainDb: 31, outputLevel: .7, outputBoostDb: 2 });
  assert.equal(legacy.inputDriveDb, 12, 'old sessions acquire the default live network drive');
  assert.equal(legacy.dry, 0, 'old sessions without a direct level start muted');
  assert.equal(legacy.inputGain, .4); assert.equal(legacy.delayGainDb, 31);
  assert.equal(legacy.outputLevel, .7); assert.equal(legacy.wet, .9);
});

test('musical recall and mastering retain independently chosen delay and source levels', () => {
  const current = sanitizePerformance({ ...DEFAULT_PERFORMANCE, inputGain: .42,
    inputDriveDb: 9.5, dry: .11, delayGainDb: 37.5, outputLevel: .73, outputBoostDb: 2.5 });
  const scene = musicalMix({ ...DEFAULT_PERFORMANCE, wet: .95, dry: .05 });
  for (const key of ['delayGainDb', 'inputDriveDb', 'dry'])
    assert(!Object.hasOwn(scene, key), `the preset does not own the live ${key} level`);
  const recalled = recallMix({ ...scene, delayGainDb: -12, inputDriveDb: 24, dry: 1, inputGain: 4 }, current);
  assert.equal(recalled.delayGainDb, 37.5);
  assert.equal(recalled.inputGain, .42);
  assert.equal(recalled.outputLevel, .73);
  assert.equal(recalled.outputBoostDb, 2.5);
  assert.equal(recalled.wet, .95);
  assert.equal(recalled.dry, .11); assert.equal(recalled.inputDriveDb, 9.5);
  for (const preset of MASTERING_PRESETS) {
    const mastered = sanitizePerformance({ ...current, ...preset.mix });
    assert.equal(mastered.delayGainDb, 37.5);
    assert.equal(mastered.inputDriveDb, 9.5); assert.equal(mastered.dry, .11);
    assert.equal(mastered.inputGain, .42);
    assert.equal(mastered.outputLevel, .73);
  }
});

test('old saved sounds restore the legacy law while new complete scenes recall path controls', async () => {
  const { PRESETS, recallParameters } = await import('../src/instruments/fractal-delay/presets.js');
  const legacy = recallParameters({ mode:'orbits', cReal:-.122561, cImag:.744862, timeMs:280, pitchOffset:4.2 });
  assert.equal(legacy.propagation,'resonance');
  for(const key of ['geometryPitch','tapCoverage','turnTone']) assert.equal(legacy[key],0);
  assert.equal(legacy.pitchOffset,4.2); assert.equal(legacy.timeMs,280);
  const rabbit=PRESETS.find(preset=>preset.id==='rabbit-cycle');
  assert.equal(rabbit.parameters.propagation,'paths'); assert.equal(rabbit.parameters.pitchOffset,0);
  assert.deepEqual(recallParameters(rabbit.parameters),rabbit.parameters);
  assert(PRESETS.some(preset=>preset.parameters.propagation==='resonance'),'original resonator scenes remain available');
  assert(PRESETS.some(preset=>preset.parameters.propagation==='paths'),'echo scenes use the geometric path law');
  for(const preset of PRESETS) assert.deepEqual(recallParameters(preset.parameters),preset.parameters);
});
