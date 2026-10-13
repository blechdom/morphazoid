import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readSimdResonatorRuntimeReference } from './helpers/simd-resonator-runtime-reference.mjs';
import { restoreBlechTextRuntime } from './helpers/blech-text-runtime-reference.mjs';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { vectorMotifRuntimeChange as change, restoreVectorMotifRuntime, readVectorMotifRuntimeReference } from './helpers/vector-motif-runtime-reference.mjs';
import { restoreBlechNoteHistoryRuntime, readBlechNoteHistoryRuntimeReference } from './helpers/blech-note-history-runtime-reference.mjs';
import { restoreVectorFractalsSite } from './helpers/vector-fractals-site-reference.mjs';

const url = new URL(`../${change.file}`, import.meta.url);
const digest = source => createHash('sha256').update(source).digest('hex');
const readFile = async (file, encoding) => restoreBlechTextRuntime(await readSimdResonatorRuntimeReference(file, encoding), change.file);

test('motif module packaging restores exact pre-feature bytes and preserves historical guards', async () => {
  assert.equal(change.baseCommit, '02760d94dd645855eb5abe30dd16d3f837eabc6f');
  const source = await readFile(url, 'utf8'), restored = restoreVectorMotifRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restored, await readVectorMotifRuntimeReference(url, 'utf8'));
  const current = parseRuntimeManifest(source).entries, previous = parseRuntimeManifest(restored).entries;
  const added = current.filter(entry => !previous.some(old => old.path === entry.path));
  assert.deepEqual(added.map(entry => entry.path), change.paths);
  assert.ok(added.every(entry => entry.copy && entry.required));
  assert.equal(restoreVectorMotifRuntime(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreVectorMotifRuntime(restored, change.file), /exact Vector Traveler motif runtime addition/);
  for (const normalize of [restoreBlechNoteHistoryRuntime, restoreVectorFractalsSite]) {
    assert.equal(normalize(source, change.file), normalize(restored, change.file));
  }
  assert.equal(await readBlechNoteHistoryRuntimeReference(url, 'utf8'), restoreBlechNoteHistoryRuntime(restored, change.file));
});

test('missing, duplicate, moved and policy-altered motif modules fail before historical normalization', async () => {
  const source = await readFile(url, 'utf8'), row = change.rows[0];
  const mutations = [source.replace(row, ''), source + row, row + source.replace(row, ''),
    source.replace(row, row.replace('copy+require', 'copy')),
    source.replace(row, row.replace('motif-state', 'unreviewed-state')),
    source.replace(change.after, change.before) + change.rows.join('')];
  for (const mutated of mutations) for (const options of [{}, { allowRestored: true }]) {
    for (const normalize of [restoreVectorMotifRuntime, restoreBlechNoteHistoryRuntime, restoreVectorFractalsSite]) {
      assert.throws(() => normalize(mutated, change.file, options), /exact Vector Traveler motif runtime addition/);
    }
  }
});

test('motif restoration leaves unknown edits and binary reads visible', async () => {
  const source = await readFile(url, 'utf8'), extra = '\ncopy+require\tsrc/unreviewed-motif.js\n';
  const restored = restoreVectorMotifRuntime(source + extra, change.file);
  assert.ok(restored.endsWith(extra)); assert.notEqual(digest(restored), change.sha256);
  const unknown = source.replace(change.after, change.before + extra);
  assert.equal(restoreVectorMotifRuntime(unknown, change.file, { allowRestored: true }), unknown);
  assert.notEqual(digest(unknown), change.sha256);
  const binary = await readFile(url);
  assert.equal(restoreVectorMotifRuntime(binary, change.file), binary);
  assert.deepEqual(await readVectorMotifRuntimeReference(url), binary);
  assert.equal(restoreVectorMotifRuntime(source, 'unrelated.js'), source);
});
