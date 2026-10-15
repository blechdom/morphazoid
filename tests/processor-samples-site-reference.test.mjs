import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { processorSamplesSiteChanges, restoreProcessorSamplesSite } from './helpers/processor-samples-site-reference.mjs';
import { restoreVectorMotifRuntime } from './helpers/vector-motif-runtime-reference.mjs';
import { restoreRustResonatorSite } from './helpers/simd-resonator-rust-site-reference.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');

test('sample playback catalogue and required runtime additions reverse to exact main bytes', async () => {
  for (const change of processorSamplesSiteChanges.changes) {
    const current = restoreRustResonatorSite(await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8'), change.file, { allowRestored: true });
    const source = change.file === 'scripts/site/runtime-files.tsv'
      ? restoreVectorMotifRuntime(current, change.file) : current;
    const restored = restoreProcessorSamplesSite(source, change.file);
    assert.equal(digest(restored), change.sha256);
    assert.equal(restoreProcessorSamplesSite(restored, change.file, { allowRestored: true }), restored);
    assert.notEqual(digest(restoreProcessorSamplesSite(source + '\n// unrelated drift\n', change.file)), change.sha256);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreProcessorSamplesSite(source + after, change.file), /exact processor samples amendment/);
      assert.throws(() => restoreProcessorSamplesSite(source.replace(after, ''), change.file), /exact processor samples amendment/);
      assert.throws(() => restoreProcessorSamplesSite(source.replace(after, '!' + after.slice(1)), change.file), /exact processor samples amendment/);
    }
  }
});
