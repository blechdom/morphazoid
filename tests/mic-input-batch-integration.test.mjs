import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { restoreBlechSpigotRuntime } from './helpers/blech-spigot-runtime-reference.mjs';
import { micInputBatchSiteChanges, readMicInputBatchSiteReference, restoreMicInputBatchSite } from './helpers/mic-input-batch-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const root = new URL('../', import.meta.url);

test('mic input rollout amendments restore the exact preceding main source and reject missing or duplicate additions', async () => {
  assert.ok(micInputBatchSiteChanges.changes.length > 20);
  for (const change of micInputBatchSiteChanges.changes) {
    const source = restoreBlechSpigotRuntime(await readFile(new URL(change.file, root), 'utf8'), change.file, { allowRestored: true });
    const restored = restoreMicInputBatchSite(source, change.file);
    assert.equal(digest(restored), change.sha256, `${change.file}: pre-rollout source preserved`);
    assert.equal(restoreMicInputBatchSite(source, 'unrelated.js'), source);
    assert.equal(restoreMicInputBatchSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreMicInputBatchSite(restored, change.file), /exact mic input batch amendment/);
    assert.throws(() => restoreMicInputBatchSite(source + change.replacements[0].after, change.file), /exact mic input batch amendment/);
    assert.notEqual(digest(restoreMicInputBatchSite(source + '\n// unrelated drift\n', change.file)), change.sha256);
  }
});

test('the shared reader normalizes text and leaves binary reads untouched', async () => {
  const [change] = micInputBatchSiteChanges.changes;
  const url = new URL(change.file, root);
  assert.ok((await readMicInputBatchSiteReference(url, 'utf8')).length > 0);
  assert.deepEqual(await readMicInputBatchSiteReference(url), await readFile(url));
});
