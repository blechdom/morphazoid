import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { blechMidiOutputSiteAmendments, restoreBlechMidiOutputSite } from './helpers/blech-midi-output-site-reference.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const navigationAmendments = JSON.parse(await readFile(new URL('./fixtures/blech-midi-output-navigation-amendments.json', import.meta.url), 'utf8'));

test('native MIDI output amendments retain the exact previous shared-site baseline', async () => {
  for (const change of [...blechMidiOutputSiteAmendments.changes, navigationAmendments]) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    const restored = restoreBlechMidiOutputSite(source, change.file);
    assert.equal(digest(restored), change.sha256, change.file);
    assert.equal(restoreBlechMidiOutputSite(restored, change.file, { allowRestored: true }), restored);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreBlechMidiOutputSite(source.replace(after, ''), change.file), /exact BLECH MIDI output (?:site|navigation) amendment/);
      assert.throws(() => restoreBlechMidiOutputSite(source + after, change.file), /exact BLECH MIDI output (?:site|navigation) amendment/);
    }
    assert.notEqual(digest(restoreBlechMidiOutputSite(source + '\n// unrelated drift\n', change.file)), change.sha256);
  }
});
