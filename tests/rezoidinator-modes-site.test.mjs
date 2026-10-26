import { restoreWitchSite } from "./helpers/witch-site-reference.mjs";
import { restoreTimeLoomSite } from "./helpers/time-loom-site-reference.mjs";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readGlobuleDamacySiteReference as readFile } from './helpers/globule-damacy-site-reference.mjs';
import test from 'node:test';
import { restoreMobileMenubar } from './helpers/mobile-menubar-reference.mjs';
import { restoreOculoidSite } from './helpers/oculoid-site-reference.mjs';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { rezoidinatorModesSiteChanges, restoreRezoidinatorModesSite } from './helpers/rezoidinator-modes-site-reference.mjs';
import { restoreRezoidinatorSite } from './helpers/rezoidinator-site-reference.mjs';
import { restoreRustResonatorSite } from './helpers/simd-resonator-rust-site-reference.mjs';

const file = 'scripts/site/runtime-files.tsv';
// The reader has peeled Tapezoid; remove Oculoid, Time Loom, Witch and mobile additions.
const source = restoreMobileMenubar(restoreWitchSite(restoreTimeLoomSite(
  restoreOculoidSite(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), file),
  file, { allowRestored: true },
), file), file);
const digest = value => createHash('sha256').update(value).digest('hex');

test('Rezoidinator ships its complete signal path exactly once and preserves prior manifest bytes', () => {
  const change = rezoidinatorModesSiteChanges.changes[0];
  assert.match(rezoidinatorModesSiteChanges.baseCommit, /^aacc4c90[0-9a-f]{32}$/);
  assert.deepEqual(rezoidinatorModesSiteChanges.changes.map(item => item.file), [file]);
  const entries = parseRuntimeManifest(source).entries;
  assert.deepEqual(entries.filter(entry => entry.path === change.marker).map(entry => entry.policy), ['copy+require']);
  const restored = restoreRezoidinatorModesSite(source, file);
  assert.equal(digest(source), change.approvedSha256);
  assert.equal(digest(restored), change.sha256);
  assert.equal(restoreRezoidinatorModesSite(restored, file, { allowRestored: true }), restored);
  assert.throws(() => restoreRezoidinatorModesSite(restored, file), /exact Rezoidinator modes/);
  for (const restore of [restoreRezoidinatorSite, restoreRustResonatorSite]) {
    assert.equal(restore(source, file), restore(restored, file), 'existing history guards peel this addition first');
  }
});

test('runtime guards reject partial, relocated, repeated or weakened signal-path declarations', () => {
  const change = rezoidinatorModesSiteChanges.changes[0];
  const { before, after } = change.replacements[0];
  for (const mutation of [source + after, after + source.replace(after, before),
    source.replace(`copy+require\t${change.marker}`, `copy\t${change.marker}`),
    source.replace(`copy+require\t${change.marker}`, `require\t${change.marker}`)]) {
    for (const restore of [restoreRezoidinatorModesSite, restoreRezoidinatorSite, restoreRustResonatorSite]) {
      for (const options of [{}, { allowRestored: true }]) {
        assert.throws(() => restore(mutation, file, options), /exact Rezoidinator modes/);
      }
    }
  }
  const drift = '\ncopy+require\tsrc/unreviewed-audio.js\n';
  const restored = restoreRezoidinatorModesSite(source, file);
  assert.equal(restoreRezoidinatorModesSite(source + drift, file), restored + drift);
  assert.notEqual(digest(restored + drift), change.sha256);
  const bytes = Buffer.from(source);
  assert.equal(restoreRezoidinatorModesSite(bytes, file), bytes);
  assert.equal(restoreRezoidinatorModesSite(source, 'unrelated.js'), source);
});
