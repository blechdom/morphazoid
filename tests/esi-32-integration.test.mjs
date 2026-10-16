import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { esi32SiteChanges, restoreEsi32Site } from './helpers/esi-32-site-reference.mjs';

const root = new URL('../', import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');

test('ESI-32 additions preserve the independently captured publication baseline', async () => {
  assert.equal(esi32SiteChanges.baseCommit, '958ff9aeda623b8580be0d041476d8e37c943309');
  assert.deepEqual(esi32SiteChanges.changes.map(({ file }) => file).sort(), [
    'README.md', 'scripts/site/runtime-files.tsv', 'scripts/wax/wax-universal-adapter.js',
    'src/pages/manifest.js', 'src/site/catalogue-taxonomy.js',
    'src/site/instrument-catalog.js', 'src/site/instrument-midi-capabilities.js',
    'src/site/instrument-registry.js',
  ]);
  for (const change of esi32SiteChanges.changes) {
    const source = await readFile(new URL(change.file, root), 'utf8');
    const restored = restoreEsi32Site(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    const reapplied = change.replacements.reduce((current, { before, after }) => {
      assert.equal(current.split(before).length - 1, 1, `${change.file}: unique insertion point`);
      return current.replace(before, () => after);
    }, restored);
    assert.equal(reapplied, source, `${change.file}: exact round trip`);
    assert.equal(restoreEsi32Site(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreEsi32Site(restored, change.file), /exact ESI-32 site amendment/);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restoreEsi32Site(source.replace(after, () => before), change.file), /exact ESI-32 site amendment/);
      assert.throws(() => restoreEsi32Site(source + after, change.file), /exact ESI-32 site amendment/);
      assert.throws(() => restoreEsi32Site(source.replace(after, () => after.replace('esi-32', 'unreviewed')), change.file), /exact ESI-32 site amendment/);
    }
    const drift = '\n// unrelated source drift\n';
    assert.equal(restoreEsi32Site(source + drift, change.file), restored + drift);
    assert.notEqual(digest(restoreEsi32Site(source + drift, change.file)), change.sha256);
    for (const file of change.regressionTests) assert.ok((await readFile(new URL(file, root))).length, file);
  }
  const binary = Buffer.from('raw bytes');
  assert.equal(restoreEsi32Site(binary, 'src/pages/manifest.js'), binary);
  assert.equal(restoreEsi32Site('untouched', 'unrelated.js'), 'untouched');
});
