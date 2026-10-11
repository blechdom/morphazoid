import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readTrackazoidSiteReference as readFile } from './helpers/trackazoid-site-reference.mjs';
import test from 'node:test';
import { creativeTempoRuntimeChanges, restoreMidiophiliaCreativeTempo } from './helpers/midiophilia-creative-tempo-reference.mjs';
import { fractalMotionRuntimeChanges, restoreFractalMotionRuntime } from './helpers/fractal-delay-motion-runtime-reference.mjs';
import { midiMixerRuntimeChanges, restoreMidiMixerRuntime } from './helpers/midi-mixer-runtime-reference.mjs';
import { vectorFractalsSiteChanges, restoreVectorFractalsSite, readVectorFractalsSiteReference } from './helpers/vector-fractals-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const file = 'src/site/tap-tempo-targets.js';
const url = new URL(`../${file}`, import.meta.url);
const historical = [[fractalMotionRuntimeChanges, restoreFractalMotionRuntime], [midiMixerRuntimeChanges, restoreMidiMixerRuntime], [vectorFractalsSiteChanges, restoreVectorFractalsSite]];

test('creative tempo normalization restores captured main and every prior tempo-target hash', async () => {
  assert.equal(creativeTempoRuntimeChanges.baseCommit, '3c1ff07a1672112882574057d29a9739c02844e5');
  assert.deepEqual(creativeTempoRuntimeChanges.changes.map(change => change.file), [file]);
  const change = creativeTempoRuntimeChanges.changes[0], source = await readFile(url, 'utf8');
  const restored = restoreMidiophiliaCreativeTempo(source, file);
  assert.equal(digest(restored), change.sha256);
  assert.equal(source.split(change.addition).length - 1, 1);
  assert.equal(restoreMidiophiliaCreativeTempo(restored, file, { allowRestored: true }), restored);
  for (const [fixture, normalize] of historical) {
    const hash = fixture.changes.find(change => change.file === file).sha256;
    assert.equal(digest(normalize(source, file)), hash);
    assert.equal(normalize(source, file), normalize(restored, file));
  }
  assert.equal(digest(await readVectorFractalsSiteReference(url, 'utf8')), vectorFractalsSiteChanges.changes.find(change => change.file === file).sha256);
});

test('creative tempo guards reject missing, duplicate and tampered additions while optional peeling exposes drift', async () => {
  const { addition } = creativeTempoRuntimeChanges.changes[0], source = await readFile(url, 'utf8');
  const missing = source.replace(addition, ''), tampered = source.replace(addition, addition.replace('#creativeTempo', '#unreviewedTempo'));
  const error = /exact Midiophilia creative tempo addition/;
  assert.throws(() => restoreMidiophiliaCreativeTempo(missing, file), error);
  assert.throws(() => restoreMidiophiliaCreativeTempo(tampered, file), error);
  for (const options of [{}, { allowRestored: true }]) assert.throws(() => restoreMidiophiliaCreativeTempo(source + addition, file, options), error);
  assert.equal(restoreMidiophiliaCreativeTempo(missing, file, { allowRestored: true }), missing);
  assert.equal(restoreMidiophiliaCreativeTempo(tampered, file, { allowRestored: true }), tampered);
  for (const [fixture, normalize] of historical) {
    assert.throws(() => normalize(source + addition, file), error);
    assert.notEqual(digest(normalize(tampered, file)), fixture.changes.find(change => change.file === file).sha256);
  }
});

test('unreviewed targets and other files remain visible; binary buffers remain identical', async () => {
  const source = await readFile(url, 'utf8'), binary = await readFile(url);
  const drift = '\n// unrelated runtime drift\n', extra = '  {"route":"midiphoria.html","selector":"#unreviewedTempo","mapping":{"unit":"bpm"}},\n';
  for (const suffix of [drift, extra]) {
    const restored = restoreMidiophiliaCreativeTempo(source + suffix, file);
    assert.ok(restored.endsWith(suffix));
    assert.notEqual(digest(restored), creativeTempoRuntimeChanges.changes[0].sha256);
    for (const [fixture, normalize] of historical) assert.notEqual(digest(normalize(source + suffix, file)), fixture.changes.find(change => change.file === file).sha256);
  }
  assert.equal(restoreMidiophiliaCreativeTempo(source, 'unrelated.js'), source);
  assert.equal(restoreMidiophiliaCreativeTempo(binary, file), binary);
  assert.equal(restoreMidiophiliaCreativeTempo(binary, file, { allowRestored: true }), binary);
  assert.equal(restoreFractalMotionRuntime(binary, file), binary);
  assert.deepEqual(await readVectorFractalsSiteReference(url), binary);
});
