import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, canonicalPerformance, buildFactoryModule } from '../scripts/calibrate-synthesis-performance-levels.mjs';

test('performance calibration options reject accidental or invalid command input', () => {
  assert.equal(parseOptions([]).sampleRate, 48000);
  assert.equal(parseOptions(['--sample-rate', '44100']).sampleRate, 44100);
  assert.equal(parseOptions(['--help']).help, true);
  assert.throws(() => parseOptions(['--output']), /Missing value/);
  assert.throws(() => parseOptions(['--root', '--report']), /Missing value/);
  assert.throws(() => parseOptions(['--cached']), /Unknown option/);
  for (const value of ['NaN', '0', '48000.5', '900000']) assert.throws(() => parseOptions(['--sample-rate', value]), /Sample rate/);
});

test('generated cache round-trips exact musical snapshots without owning master volume', async () => {
  const snapshot = { sound: { methodId: 'test', params: [.123456789012345], outputLevel: .5 },
    routing: { input: 'synthesis' }, sequence: { id: 'none', tempoBpm: 123 }, tuningId: 'continuous' };
  const result = { sourceTrimDb: 12.3456789012345, outputGain: 1,
    stats: { peak: .45, scoreDb: -16.5, nonfinite: 0, silent: false, reference: { peak: .0001 } } };
  const metadata = { sampleRate: 48000, wasmSha256: 'test-provenance', sourceHashes: { 'processor.js': 'test-source' } };
  const source = buildFactoryModule([{ snapshot, result }], metadata);
  const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const returned = module.factoryLevelMatch(snapshot);
  assert.equal(returned.sourceTrimDb, result.sourceTrimDb);
  assert.equal(returned.stats.calibration, 'factory');
  assert.equal(returned.stats.reference, undefined);
  assert.deepEqual(result.stats.reference, { peak: .0001 }, 'formatting leaves measurements intact');
  const muted = structuredClone(snapshot); muted.sound.outputLevel = 0;
  assert.deepEqual(module.factoryLevelMatch(muted), returned);
  muted.sequence.tempoBpm++;
  assert.equal(module.factoryLevelMatch(muted), null);
  assert.equal(module.factoryLevelMatch(snapshot, { sampleRate: 44100 }), null);
  assert.equal(module.FACTORY_LEVEL_MATCH_META.sceneCount, 1);
  assert.deepEqual(module.FACTORY_LEVEL_MATCH_META.sourceHashes, metadata.sourceHashes);
  assert.deepEqual(canonicalPerformance(snapshot).sound, { methodId: 'test', params: [.123456789012345] });
  assert.throws(() => buildFactoryModule([{ snapshot, result }, { snapshot, result }], metadata), /Duplicate/);
});
