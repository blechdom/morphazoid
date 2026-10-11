import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { restoreSoundFontsSite, soundFontsSiteChanges } from './helpers/sound-fonts-site-reference.mjs';
import { readTrackazoidSiteReference, restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';
import { restoreSpartialOrganRuntime } from './helpers/spartial-organ-runtime-reference.mjs';

const digest = source => createHash('sha256').update(source).digest('hex');
// Keep the published Sound Fonts evidence intact after the independent organ
// registration; mutations below still exercise Sound Fonts' exact guards.
const read = async (file, encoding = 'utf8') => restoreSpartialOrganRuntime(
  await readFile(new URL(`../${file}`, import.meta.url), encoding), file, { allowRestored: true },
);

test('Sound Fonts amendments preserve exact shared files from the published parent', async () => {
  assert.equal(soundFontsSiteChanges.baseCommit, 'cedaf28dca962b0af0a885b7d301dc7211517ecd');
  assert.deepEqual(soundFontsSiteChanges.changes.map(({ file }) => file), [
    'README.md', 'docs/THIRD_PARTY_NOTICES.md', 'scripts/site/runtime-files.tsv',
    'src/pages/index.html', 'src/pages/manifest.js',
  ]);
  for (const change of soundFontsSiteChanges.changes) {
    const source = await read(change.file);
    const restored = restoreSoundFontsSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restoreSoundFontsSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreSoundFontsSite(restored, change.file), /exact Sound Fonts site amendment/);
    assert.equal(restoreTrackazoidSite(source, change.file, { allowRestored: true }),
      restoreTrackazoidSite(restored, change.file, { allowRestored: true }),
      'the existing historical reader peels Sound Fonts before Trackazoid');
    assert.equal(restoreSpartialOrganRuntime(
      await readTrackazoidSiteReference(new URL(`../${change.file}`, import.meta.url), 'utf8'),
      change.file, { allowRestored: true }),
      restoreTrackazoidSite(restored, change.file, { allowRestored: true }));
  }
});

test('Sound Fonts restoration rejects missing, duplicated, tampered and partial additions', async () => {
  for (const change of soundFontsSiteChanges.changes) {
    const source = await read(change.file), { addition, file } = change;
    const error = /exact Sound Fonts site amendment/;
    assert.throws(() => restoreSoundFontsSite(source.replace(addition, ''), file), error);
    assert.throws(() => restoreSoundFontsSite(source + addition, file), error);
    assert.throws(() => restoreSoundFontsSite(source + addition, file, { allowRestored: true }), error);
    const tampered = source.replace(addition, addition.replace('sound-fonts', 'unreviewed-fonts'));
    assert.notEqual(tampered, source);
    assert.throws(() => restoreSoundFontsSite(tampered, file), error);
    assert.equal(restoreSoundFontsSite(tampered, file, { allowRestored: true }), tampered,
      'optional passes leave changed bytes visible to older hashes');
    assert.notEqual(digest(tampered), change.sha256);
    const lines = addition.split('\n').filter(line => line.trim());
    if (lines.length > 1) for (const line of lines) {
      const partial = source.replace(addition, addition.replace(`${line}\n`, ''));
      assert.throws(() => restoreSoundFontsSite(partial, file), error);
      assert.notEqual(digest(restoreSoundFontsSite(partial, file, { allowRestored: true })), change.sha256);
    }
  }
});

test('Sound Fonts normalization preserves unrelated drift, unknown rows and binary identity', async () => {
  for (const change of soundFontsSiteChanges.changes) {
    const source = await read(change.file), drift = '\n// unrelated drift\n';
    const restored = restoreSoundFontsSite(source + drift, change.file);
    assert.ok(restored.endsWith(drift));
    assert.notEqual(digest(restored), change.sha256);
    assert.equal(restoreSoundFontsSite(source, 'unrelated.js'), source);
    const bytes = await read(change.file, null);
    assert.equal(restoreSoundFontsSite(bytes, change.file), bytes);
    assert.deepEqual(await readTrackazoidSiteReference(new URL(`../${change.file}`, import.meta.url)), bytes);
  }
  const file = 'scripts/site/runtime-files.tsv';
  const unknown = 'copy+require\tsrc/site/sound-fonts/unreviewed.js\n';
  const source = await read(file), restored = restoreSoundFontsSite(source + unknown, file);
  assert.ok(restored.endsWith(unknown));
  assert.notEqual(digest(restored), soundFontsSiteChanges.changes.find(change => change.file === file).sha256);
  assert.equal(restoreSoundFontsSite('untouched', 'unrelated.js'), 'untouched');
});
