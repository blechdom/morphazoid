import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FACTORY_LEVEL_MATCH_META, factoryLevelMatch, performanceLevelKey } from '../src/instruments/synthesis/performance-level-factories.js';

// Like the DSP harness, permit isolated QA against the integrating checkout.
const root = process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT
  ? pathToFileURL(resolve(process.env.MORPHAZOID_SYNTHESIS_TEST_ROOT) + '/') : new URL('../', import.meta.url);
const { INSTRUMENT_PRESETS } = await import(new URL('src/instruments/synthesis/instrument-presets.js', root));
const factories = INSTRUMENT_PRESETS.filter(preset => ['synthesis', 'percussion'].includes(preset.snapshot.routing.input));
const hash = value => createHash('sha256').update(value).digest('hex');

test('every current synthesis/drum factory has an immediate measured level with exact source provenance', async () => {
  assert.equal(FACTORY_LEVEL_MATCH_META.sceneCount, factories.length);
  assert.equal(FACTORY_LEVEL_MATCH_META.wasmSha256, hash(await readFile(new URL('assets/wasm/synthesis.wasm', root))),
    'WASM changes require fresh whole-performance measurements');
  assert.equal(FACTORY_LEVEL_MATCH_META.snapshotsSha256,
    hash(factories.map(preset => performanceLevelKey(preset.snapshot)).sort().join('\n')),
    'musical recipe changes require fresh measurements, not a stale matching ID');
  for (const preset of factories) {
    const result = factoryLevelMatch(preset.snapshot);
    assert.ok(result, preset.id);
    assert.equal(result.stats.nonfinite, 0, preset.id);
    assert.equal(result.stats.silent, false, preset.id);
    assert.equal(result.stats.calibration, 'factory');
    assert.ok(result.outputGain > 0 && result.outputGain <= 16, preset.id);
    assert.ok(result.stats.peak * result.outputGain <= .7, preset.id);
    assert.ok(result.stats.scoreDb + 20 * Math.log10(result.outputGain) <= -15, preset.id);
    if (preset.snapshot.routing.input === 'synthesis') assert.ok(result.sourceTrimDb >= -36 && result.sourceTrimDb <= 48, preset.id);
    else assert.equal(result.sourceTrimDb, null, preset.id);
  }
});

test('factory cache ignores user master and object insertion order, but never musical edits or device rate', () => {
  const source = factories.find(preset => preset.id === 'performance:small-vowel-orchestra').snapshot;
  const reversed = Object.fromEntries(Object.entries(structuredClone(source)).reverse());
  reversed.sound.outputLevel = 0;
  reversed.outputLevel = 0;
  assert.deepEqual(factoryLevelMatch(reversed), factoryLevelMatch(source));
  const expected = factoryLevelMatch(source);
  expected.stats.peak = 100;
  assert.notEqual(factoryLevelMatch(source).stats.peak, 100, 'cached results cannot be changed by consumers');
  for (const mutate of [
    value => { value.sound.params[0] += .000001; },
    value => { value.sequence.tempoBpm += 1; },
    value => { value.sequence.parameters.gate -= .01; },
    value => { value.tuningId = 'edo-19'; },
    value => { value.routing.effectEnabled = !value.routing.effectEnabled; },
  ]) {
    const value = structuredClone(source); mutate(value);
    assert.equal(factoryLevelMatch(value), null);
  }
  assert.equal(factoryLevelMatch(source, { sampleRate: 44100 }), null);
  assert.equal(factoryLevelMatch({ routing: { input: 'microphone' } }), null);
  const vowel = factoryLevelMatch(source);
  assert.ok(vowel.sourceTrimDb > 12 && vowel.sourceTrimDb < 14, 'polyphonic tail retirement is not mistaken for gain compression');
  assert.ok(vowel.stats.scoreDb > -19);
});
