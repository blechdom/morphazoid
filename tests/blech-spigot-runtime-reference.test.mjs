import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { blechSpigotRuntimeChange as change, restoreBlechSpigotRuntime as restore } from './helpers/blech-spigot-runtime-reference.mjs';
import { restoreGraphonicCalculatorSite } from './helpers/graphonic-calculator-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './helpers/header-presets-batch-site-reference.mjs';
import { restoreMicInputBatchSite } from './helpers/mic-input-batch-site-reference.mjs';
import { restoreWipRolloutSite } from './helpers/wip-rollout-site-reference.mjs';
import { restoreStaircaseSpiralRuntime } from './helpers/staircase-spiral-runtime-reference.mjs';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';

test('spigot runtime addition preserves the exact preceding manifest and historical guards', async () => {
  const source = restoreHeaderPresetsBatchSite(restoreMicInputBatchSite(restoreWipRolloutSite(await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8'), change.file), change.file), change.file);
  const previous = restore(source, change.file);
  assert.equal(createHash('sha256').update(restoreStaircaseSpiralRuntime(previous, change.file)).digest('hex'), change.sha256);
  assert.equal(restore(previous, change.file, { allowRestored: true }), previous);
  assert.equal(restoreGraphonicCalculatorSite(source, change.file), restoreGraphonicCalculatorSite(previous, change.file));
  const entries = parseRuntimeManifest(source).entries;
  for (const path of change.paths) {
    const matches = entries.filter(entry => entry.path === path);
    assert.equal(matches.length, 1);
    assert.ok(matches[0].copy && matches[0].required);
    await readFile(new URL(`../${path}`, import.meta.url));
  }
});

test('partial, relocated, duplicated or weakened spigot additions fail while unrelated changes remain visible', async () => {
  const source = restoreHeaderPresetsBatchSite(restoreMicInputBatchSite(restoreWipRolloutSite(await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8'), change.file), change.file), change.file);
  for (const modified of [source + change.addition, change.addition + source.replace(change.addition, ''),
    ...change.paths.map(path => source.replace(`copy+require\t${path}`, `copy\t${path}`)),
    ...change.paths.map(path => source.replace(path, 'unreviewed-spigot-path'))]) {
    for (const allowRestored of [true, false]) assert.throws(() => restore(modified, change.file, { allowRestored }), /exact BLECH MIDI spigot runtime addition/);
  }
  assert.ok(restore(source + '\n# unrelated drift\n', change.file).endsWith('\n# unrelated drift\n'));
  const binary = Buffer.from(source);
  assert.equal(restore(binary, change.file), binary);
  assert.equal(restore(source, 'unrelated.js'), source);
});
