import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readTrackazoidSiteReference as readFile } from './helpers/trackazoid-site-reference.mjs';
import test from 'node:test';
import { readVectorFractalsSiteReference, restoreVectorFractalsSite, vectorFractalsSiteChanges } from './helpers/vector-fractals-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');

test('Vector Fractals additions restore the exact preceding main source and reject missing or duplicate amendments', async () => {
  assert.equal(vectorFractalsSiteChanges.baseCommit, 'eb39270a3af88e16fe8defc27d35ef96a2dd6dc4');
  assert.deepEqual(vectorFractalsSiteChanges.changes.map(change => change.file), [
    'src/pages/manifest.js', 'src/site/instrument-registry.js', 'src/site/instrument-catalog.js',
    'src/site/catalogue-taxonomy.js', 'src/site/instrument-midi-capabilities.js',
    'src/site/tap-tempo-targets.js', 'scripts/site/runtime-files.tsv',
  ]);
  for (const change of vectorFractalsSiteChanges.changes) {
    const url = new URL(`../${change.file}`, import.meta.url);
    const source = await readFile(url, 'utf8');
    const restored = restoreVectorFractalsSite(source, change.file);
    assert.equal(restoreVectorFractalsSite(source, 'unrelated.js'), source);
    assert.equal(digest(restored), change.sha256, `${change.file}: pre-Vector Fractals source preserved`);
    assert.equal(await readVectorFractalsSiteReference(url, 'utf8'), restored);
    assert.deepEqual(await readVectorFractalsSiteReference(url), await readFile(url), 'binary reads remain byte-for-byte');
    assert.notEqual(digest(restoreVectorFractalsSite(source + '\n// unrelated drift\n', change.file)), change.sha256);
    assert.throws(() => restoreVectorFractalsSite(restored, change.file), /exact Vector Fractals site amendment/);
    for (const { before, after } of change.replacements) {
      assert.match(after, /vector-fractals/);
      assert.throws(() => restoreVectorFractalsSite(source.replace(after, before), change.file), /exact Vector Fractals site amendment/);
      assert.throws(() => restoreVectorFractalsSite(source + after, change.file), /exact Vector Fractals site amendment/);
      assert.throws(() => restoreVectorFractalsSite(source.replace(after, after.replace('vector-fractals', 'unreviewed-fractals')), change.file), /exact Vector Fractals site amendment/);
    }
  }
  assert.equal(restoreVectorFractalsSite('untouched', 'unrelated.js'), 'untouched');
});

test('Vector Fractals normalization retains unknown runtime rows and unrelated registry edits', async () => {
  for (const [file, drift] of [
    ['scripts/site/runtime-files.tsv', 'copy+require\tsrc/instruments/vector-fractals/unreviewed.js\n'],
    ['src/site/instrument-registry.js', '    { id: "unreviewed", label: "Unreviewed", href: "unreviewed.html" },\n'],
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const restored = restoreVectorFractalsSite(source + drift, file);
    assert.ok(restored.endsWith(drift));
    assert.notEqual(digest(restored), vectorFractalsSiteChanges.changes.find(change => change.file === file).sha256);
  }
});
