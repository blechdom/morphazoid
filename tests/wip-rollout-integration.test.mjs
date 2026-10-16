import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readWipRolloutSiteReference, restoreWipRolloutSite, wipRolloutSiteChanges } from './helpers/wip-rollout-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const root = new URL('../', import.meta.url);

test('work-in-progress rollout amendments restore the exact preceding main source and reject missing or duplicate additions', async () => {
  assert.ok(wipRolloutSiteChanges.changes.length > 100);
  for (const change of wipRolloutSiteChanges.changes) {
    const source = await readFile(new URL(change.file, root), 'utf8');
    const restored = restoreWipRolloutSite(source, change.file);
    assert.equal(digest(restored), change.sha256, `${change.file}: pre-rollout source preserved`);
    assert.equal(restoreWipRolloutSite(source, 'unrelated.js'), source);
    assert.equal(restoreWipRolloutSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreWipRolloutSite(restored, change.file), /exact wip rollout amendment/);
    assert.throws(() => restoreWipRolloutSite(source + change.replacements[0].after, change.file), /exact wip rollout amendment/);
    assert.notEqual(digest(restoreWipRolloutSite(source + '\n// unrelated drift\n', change.file)), change.sha256);
  }
});

test('the shared reader leaves binary reads untouched', async () => {
  const [change] = wipRolloutSiteChanges.changes;
  const url = new URL(change.file, root);
  assert.ok((await readWipRolloutSiteReference(url, 'utf8')).length > 0);
  assert.deepEqual(await readWipRolloutSiteReference(url), await readFile(url));
});
