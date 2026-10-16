import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readMicInputBatchSiteReference, restoreMicInputBatchSite } from './helpers/mic-input-batch-site-reference.mjs';
import { graphonicCalculatorSiteChanges } from './helpers/graphonic-calculator-site-reference.mjs';
import { headerPresetsBatchSiteChanges, restoreHeaderPresetsBatchSite } from './helpers/header-presets-batch-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const root = new URL('../', import.meta.url);

test('header preset rollout amendments restore the exact preceding main source and reject missing or duplicate additions', async () => {
  assert.ok(headerPresetsBatchSiteChanges.changes.length > 100);
  for (const change of headerPresetsBatchSiteChanges.changes) {
    const url = new URL(change.file, root);
    const source = restoreMicInputBatchSite(await readFile(url, 'utf8'), change.file);
    const restored = restoreHeaderPresetsBatchSite(source, change.file);
    assert.equal(digest(restored), change.sha256, `${change.file}: pre-rollout source preserved`);
    assert.equal(restoreHeaderPresetsBatchSite(source, 'unrelated.js'), source);
    assert.equal(restoreHeaderPresetsBatchSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreHeaderPresetsBatchSite(restored, change.file), /exact header presets batch amendment/);
    const { after } = change.replacements[0];
    assert.throws(() => restoreHeaderPresetsBatchSite(source + after, change.file), /exact header presets batch amendment/);
    assert.notEqual(digest(restoreHeaderPresetsBatchSite(source + '\n// unrelated drift\n', change.file)), change.sha256);
  }
});

test('the shared reader normalizes text and leaves binary reads untouched', async () => {
  const owned = new Set(graphonicCalculatorSiteChanges.changes.map(change => change.file));
  const change = headerPresetsBatchSiteChanges.changes.find(change => !owned.has(change.file));
  const url = new URL(change.file, root);
  assert.equal(digest(await readMicInputBatchSiteReference(url, 'utf8')), change.sha256);
  assert.deepEqual(await readMicInputBatchSiteReference(url), await readFile(url));
});
