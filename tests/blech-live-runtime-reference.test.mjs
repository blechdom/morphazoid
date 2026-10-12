import { restoreTrackazoidBeatmatchingSite } from './helpers/trackazoid-beatmatching-site-reference.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFractalImpulseRuntimeReference as readRawFile } from './helpers/fractal-delay-impulse-runtime-reference.mjs';
import test from 'node:test';
import { parseRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { blechLiveRuntimeChange as change, restoreBlechLiveRuntime } from './helpers/blech-live-runtime-reference.mjs';
import { restoreTrackazoidSite, readTrackazoidSiteReference } from './helpers/trackazoid-site-reference.mjs';
import { readMidiNoteEffectsRuntimeReference } from './helpers/midi-note-effects-runtime-reference.mjs';
import { restoreFractalMotionRuntime } from './helpers/fractal-delay-motion-runtime-reference.mjs';
import { restoreMidiMixerRuntime } from './helpers/midi-mixer-runtime-reference.mjs';
import { restoreVectorFractalsSite } from './helpers/vector-fractals-site-reference.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const url = new URL(`../${change.file}`, import.meta.url);
const historical = [restoreTrackazoidSite, restoreFractalMotionRuntime, restoreMidiMixerRuntime, restoreVectorFractalsSite];
// The captured main includes Trackazoid's original MVP. Peel its independent
// beatmatching delta without discarding that app or the live-automata guards.
const readFile = async (file, encoding) => restoreTrackazoidBeatmatchingSite(
  await readRawFile(file, encoding), change.file, { allowRestored: true },
);

test('live automata adds one explicit copy-and-require path and reverses to captured main bytes', async () => {
  assert.equal(change.baseCommit, '80a6196093de65feaa64ce0945b85601d88dd2e5');
  assert.equal(change.file, 'scripts/site/runtime-files.tsv');
  const path = 'src/instruments/midi-mixer/midi-mixer-automata.js';
  assert.deepEqual(change.rows, [`copy+require\t${path}\n`]);
  const source = await readFile(url, 'utf8'), restored = restoreBlechLiveRuntime(source, change.file);
  assert.equal(digest(restored), change.sha256);
  const current = parseRuntimeManifest(source), baseline = parseRuntimeManifest(restored);
  assert.deepEqual(current.entries.filter(entry => !baseline.entries.some(old => old.path === entry.path)),
    [{ path, policy: 'copy+require', copy: true, required: true }]);
  assert.equal(restoreBlechLiveRuntime(restored, change.file, { allowRestored: true }), restored);
  for (const normalize of historical) assert.equal(normalize(source, change.file), normalize(restored, change.file));
  assert.equal(await readTrackazoidSiteReference(url, 'utf8'), restoreTrackazoidSite(restored, change.file));
  const noteReference = await readMidiNoteEffectsRuntimeReference(url, 'utf8');
  assert.ok(!noteReference.includes(path));
});

test('live runtime guards reject missing, duplicate, altered and misplaced reviewed additions', async () => {
  const source = await readFile(url, 'utf8'), row = change.rows[0], error = /exact Blech live automata runtime addition/;
  const restored = restoreBlechLiveRuntime(source, change.file);
  assert.throws(() => restoreBlechLiveRuntime(restored, change.file), error);
  for (const options of [{}, { allowRestored: true }]) {
    for (const malformed of [source + row, row + source.replace(row, ''), source.replace('continuous automata source', 'unreviewed source')]) {
      assert.throws(() => restoreBlechLiveRuntime(malformed, change.file, options), error);
      for (const normalize of historical) assert.throws(() => normalize(malformed, change.file), error);
    }
  }
  for (const malformed of [source.replace(row, ''), source.replace(row, row.replace('copy+require', 'copy')),
    source.replace(row, row.replace('midi-mixer-automata', 'unreviewed-automata'))]) {
    assert.throws(() => restoreBlechLiveRuntime(malformed, change.file), error);
    assert.equal(restoreBlechLiveRuntime(malformed, change.file, { allowRestored: true }), malformed);
    assert.notEqual(digest(malformed), change.sha256, 'optional restoration leaves unknown drift for historical hash guards');
    for (const normalize of historical) assert.notEqual(normalize(malformed, change.file), normalize(restored, change.file));
  }
});

test('restoration preserves unrelated runtime rows and byte identity for non-text reads', async () => {
  const source = await readFile(url, 'utf8');
  for (const suffix of ['\n# independent change\n', 'copy+require\tsrc/unreviewed-automata.js\n']) {
    const restored = restoreBlechLiveRuntime(source + suffix, change.file);
    assert.ok(restored.endsWith(suffix)); assert.notEqual(digest(restored), change.sha256);
    for (const normalize of historical) assert.ok(normalize(source + suffix, change.file).endsWith(suffix));
  }
  const buffer = await readFile(url);
  assert.equal(restoreBlechLiveRuntime(buffer, change.file), buffer);
  assert.deepEqual(await readTrackazoidSiteReference(url), buffer);
  assert.deepEqual(await readMidiNoteEffectsRuntimeReference(url), buffer);
  assert.equal(restoreBlechLiveRuntime(source, 'unrelated.js'), source);
});
