import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { restoreSoundFontsToolbar, soundFontsToolbarAmendment as change } from './helpers/sound-fonts-toolbar-reference.mjs';
import { restoreSoundFontsSite } from './helpers/sound-fonts-site-reference.mjs';
import { restoreTrackazoidSite } from './helpers/trackazoid-site-reference.mjs';
import { restoreOutputRecording } from './helpers/output-recording-reference.mjs';

const source = await readFile(new URL('../nav.js', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const error = /exact Sound Fonts toolbar amendment/;

test('Sound Fonts toolbar reverses exactly to the independently captured navigation baseline', () => {
  assert.equal(change.baseCommit, 'd67c35c8938061bfbcd6b2f5463319cacf8a1327');
  assert.equal(change.file, 'nav.js');
  assert.equal(digest(source), change.approvedSha256);
  const restored = restoreSoundFontsToolbar(source, change.file);
  assert.equal(digest(restored), change.baseSha256);
  assert.equal(restoreSoundFontsToolbar(restored, change.file, { allowRestored: true }), restored);
  assert.throws(() => restoreSoundFontsToolbar(restored, change.file), error);
  for (const restore of [restoreSoundFontsSite, restoreTrackazoidSite, restoreOutputRecording]) {
    assert.equal(restore(source, change.file), restore(restored, change.file),
      'both historical entry points preserve their existing original-byte proofs');
  }
});

test('Sound Fonts toolbar rejects missing, duplicate, tampered and partial blocks', () => {
  assert.throws(() => restoreSoundFontsToolbar(source.replace(change.addition, ''), change.file), error);
  for (const options of [{}, { allowRestored: true }]) {
    assert.throws(() => restoreSoundFontsToolbar(source + change.addition, change.file, options), error);
    assert.throws(() => restoreSoundFontsToolbar(source.replace('routeId: null });', 'routeId: "shapes" });'), change.file, options), error);
    for (const line of change.addition.split('\n').filter(Boolean)) {
      const partial = source.replace(change.addition, change.addition.replace(`${line}\n`, ''));
      assert.throws(() => restoreSoundFontsToolbar(partial, change.file, options), error);
    }
    for (const marker of change.markers) {
      assert.throws(() => restoreSoundFontsToolbar(source + marker, change.file, options), error);
    }
  }
});

test('Sound Fonts toolbar restoration leaves unrelated drift and non-source data visible', () => {
  const drift = '\n// unreviewed navigation drift\n';
  const restored = restoreSoundFontsToolbar(source + drift, change.file);
  assert.ok(restored.endsWith(drift));
  assert.notEqual(digest(restored), change.baseSha256);
  assert.notEqual(digest(restoreSoundFontsToolbar(restored, change.file, { allowRestored: true })), change.baseSha256);
  assert.equal(restoreSoundFontsToolbar(source, 'unrelated.js'), source);
  const bytes = Buffer.from(source);
  assert.equal(restoreSoundFontsToolbar(bytes, change.file), bytes);
});
