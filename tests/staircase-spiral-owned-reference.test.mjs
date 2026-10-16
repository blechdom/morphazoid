import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { staircaseSpiralOwnedChanges, restoreStaircaseSpiralOwned as restore } from './helpers/staircase-spiral-owned-reference.mjs';
import { wipRolloutSiteChanges, restoreWipRolloutSite } from './helpers/wip-rollout-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const error = /exact Staircase spiral owned amendment/;

test('reviewed Staircase app and page hunks restore the exact main bytes and original WIP hashes', async () => {
  assert.equal(staircaseSpiralOwnedChanges.baseCommit, '2408a530a0c3d6a881f5e2c38ac27a9a736980a8');
  assert.deepEqual(staircaseSpiralOwnedChanges.changes.map(change => change.file), [
    'src/instruments/striped-staircase-rust/app.js', 'src/pages/striped-staircase-rust.html',
  ]);
  for (const change of staircaseSpiralOwnedChanges.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    const restored = restore(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    const priorWip = wipRolloutSiteChanges.changes.find(item => item.file === change.file);
    assert.equal(digest(restoreWipRolloutSite(restored, change.file)), priorWip.sha256, change.file);
    assert.throws(() => restore(restored, change.file), error);
  }
});

test('missing, duplicated, or altered owned hunks fail and unrelated edits remain visible', async () => {
  for (const change of staircaseSpiralOwnedChanges.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    const restored = restore(source, change.file);
    for (const { before, after } of change.replacements) {
      assert.throws(() => restore(source.replace(after, () => before), change.file), error);
      assert.throws(() => restore(source + after, change.file), error);
      assert.throws(() => restore(source.replace(after, () => after.replace('\n', '\n// unreviewed edit\n')), change.file), error);
    }
    const drift = '\n// unrelated source drift\n';
    assert.equal(restore(source + drift, change.file), restored + drift);
    assert.notEqual(digest(restore(source + drift, change.file)), change.sha256);
    const binary = Buffer.from(source);
    assert.equal(restore(binary, change.file), binary);
    assert.equal(restore(source, 'unrelated.js'), source);
  }
});
