import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readProcessorSamplesSiteReference as readFile } from './helpers/processor-samples-site-reference.mjs';
import test from 'node:test';
import { fractalMotionRuntimeChanges, restoreFractalMotionRuntime } from './helpers/fractal-delay-motion-runtime-reference.mjs';
import { midiMixerRuntimeChanges, restoreMidiMixerRuntime } from './helpers/midi-mixer-runtime-reference.mjs';
import { readVectorFractalsSiteReference, vectorFractalsSiteChanges } from './helpers/vector-fractals-site-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
const read = (file, encoding = 'utf8') => readFile(new URL(`../${file}`, import.meta.url), encoding);

test('exact motion packaging restores fresh main without replacing historical fixture hashes', async () => {
  assert.equal(fractalMotionRuntimeChanges.baseCommit, '4950ee88097854e5b78cbd4f94749c6d4108044d');
  assert.deepEqual(fractalMotionRuntimeChanges.changes.map(({ file }) => file), [
    'scripts/site/runtime-files.tsv', 'src/site/tap-tempo-targets.js',
  ]);
  for (const change of fractalMotionRuntimeChanges.changes) {
    const source = await read(change.file);
    const restored = restoreFractalMotionRuntime(source, change.file);
    assert.equal(digest(restored), change.sha256, `${change.file}: exact fresh-main bytes`);
    assert.equal(source.split(change.addition).length - 1, 1);
    assert.equal(restoreFractalMotionRuntime(restored, change.file, { allowRestored: true }), restored);
    assert.equal(restoreMidiMixerRuntime(source, change.file), restoreMidiMixerRuntime(restored, change.file));
    assert.equal(digest(restoreMidiMixerRuntime(source, change.file)),
      midiMixerRuntimeChanges.changes.find(({ file }) => file === change.file).sha256);
    assert.equal(digest(await readVectorFractalsSiteReference(new URL(`../${change.file}`, import.meta.url), 'utf8')),
      vectorFractalsSiteChanges.changes.find(({ file }) => file === change.file).sha256);
  }
});

test('motion packaging guards reject missing, duplicated, tampered and partial additions', async () => {
  for (const change of fractalMotionRuntimeChanges.changes) {
    const source = await read(change.file);
    const error = /exact Fractal Delay motion runtime addition/;
    assert.throws(() => restoreFractalMotionRuntime(source.replace(change.addition, ''), change.file), error);
    assert.throws(() => restoreFractalMotionRuntime(source + change.addition, change.file), error);
    assert.throws(() => restoreFractalMotionRuntime(source + change.addition, change.file, { allowRestored: true }), error);
    assert.throws(() => restoreFractalMotionRuntime(source.replace(change.addition,
      change.addition.replace('fractal-delay', 'unreviewed-delay')), change.file), error);
    const tampered = source.replace(change.addition, change.addition.replace('fractal-delay', 'unreviewed-delay'));
    assert.notEqual(digest(restoreMidiMixerRuntime(tampered, change.file)),
      midiMixerRuntimeChanges.changes.find(({ file }) => file === change.file).sha256,
      'optional normalization must leave tampered bytes visible to older guards');
    const rows = change.addition.trimEnd().split('\n');
    if (rows.length > 1) {
      for (const row of rows) assert.throws(() => restoreFractalMotionRuntime(source.replace(`${row}\n`, ''), change.file), error);
    }
  }
});

test('motion normalization retains unrelated and unknown runtime changes for older hash guards', async () => {
  for (const change of fractalMotionRuntimeChanges.changes) {
    const source = await read(change.file);
    const drift = '\n// unrelated drift\n';
    const restored = restoreFractalMotionRuntime(source + drift, change.file);
    assert.ok(restored.endsWith(drift));
    assert.notEqual(digest(restored), change.sha256);
    const historical = restoreMidiMixerRuntime(source + drift, change.file);
    assert.ok(historical.endsWith(drift));
    assert.notEqual(digest(historical), midiMixerRuntimeChanges.changes.find(({ file }) => file === change.file).sha256);
    assert.equal(restoreFractalMotionRuntime(source, 'unrelated.js'), source);
  }
  const file = 'scripts/site/runtime-files.tsv', unknown = 'copy+require\tsrc/instruments/fractal-delay/unreviewed.js\n';
  const source = await read(file), restored = restoreFractalMotionRuntime(source + unknown, file);
  assert.ok(restored.endsWith(unknown));
  assert.notEqual(digest(restored), fractalMotionRuntimeChanges.changes.find(change => change.file === file).sha256);
  assert.equal(restoreFractalMotionRuntime('untouched', 'unrelated.js'), 'untouched');
});

test('motion normalization and the existing reader retain binary buffers byte-for-byte', async () => {
  for (const { file } of fractalMotionRuntimeChanges.changes) {
    const binary = await read(file, null);
    assert.equal(restoreFractalMotionRuntime(binary, file), binary);
    assert.equal(restoreFractalMotionRuntime(binary, file, { allowRestored: true }), binary);
    assert.deepEqual(await readVectorFractalsSiteReference(new URL(`../${file}`, import.meta.url)), binary);
  }
});
