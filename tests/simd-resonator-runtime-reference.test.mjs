import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { simdResonatorRuntimeChange as change, restoreSimdResonatorRuntime, readSimdResonatorRuntimeReference } from './helpers/simd-resonator-runtime-reference.mjs';
import { restoreVectorMotifRuntime, readVectorMotifRuntimeReference } from './helpers/vector-motif-runtime-reference.mjs';
import { restoreBlechNoteHistoryRuntime } from './helpers/blech-note-history-runtime-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');

test('SIMD preset packaging restores the exact prior manifest and preserves historical guards', async () => {
  const source = await readFile(url, 'utf8'), restored = restoreSimdResonatorRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restored, await readSimdResonatorRuntimeReference(url, 'utf8'));
  const current = parseRuntimeManifest(source).entries, previous = parseRuntimeManifest(restored).entries;
  const added = current.filter(entry => !previous.some(old => old.path === entry.path));
  assert.deepEqual(added.map(entry => entry.path), [change.path]);
  assert.ok(added.every(entry => entry.copy && entry.required));
  assert.equal(restoreSimdResonatorRuntime(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreSimdResonatorRuntime(restored, change.file), /exact SIMD Resonator preset runtime addition/);
  for (const normalize of [restoreVectorMotifRuntime, restoreBlechNoteHistoryRuntime]) {
    assert.equal(normalize(source, change.file), normalize(restored, change.file));
  }
  assert.equal(await readVectorMotifRuntimeReference(url, 'utf8'), restoreVectorMotifRuntime(restored, change.file));
});

test('duplicate, moved, policy-altered and malformed SIMD preset rows fail before normalization', async () => {
  const source = await readFile(url, 'utf8');
  const mutations = [source + change.row, change.row + source.replace(change.row, ''),
    source.replace(change.row, change.row.replace('copy+require', 'copy')),
    source.replace(change.row, change.row.replace('.js', '.js-unreviewed')),
    source.replace(change.after, change.after.replace('simd-resonator-app.js', 'unreviewed-app.js'))];
  for (const mutated of mutations) for (const options of [{}, { allowRestored: true }]) {
    for (const normalize of [restoreSimdResonatorRuntime, restoreVectorMotifRuntime, restoreBlechNoteHistoryRuntime]) {
      assert.throws(() => normalize(mutated, change.file, options), /exact SIMD Resonator preset runtime addition/);
    }
  }
});

test('SIMD restoration leaves unrelated edits, unknown replacements and binary reads visible', async () => {
  const source = await readFile(url, 'utf8'), extra = '\ncopy+require\tsrc/unreviewed-simd.js\n';
  const restored = restoreSimdResonatorRuntime(source + extra, change.file);
  assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
  const unknown = source.replace(change.row, extra);
  assert.equal(restoreSimdResonatorRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreSimdResonatorRuntime(binary, change.file), binary);
  assert.deepEqual(await readSimdResonatorRuntimeReference(url), binary);
  assert.equal(restoreSimdResonatorRuntime(source, 'unrelated.js'), source);
});
