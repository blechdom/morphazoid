import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { rainVolumeMeterAmendments, restoreRainVolumeMeters } from './helpers/rain-volume-meter-reference.mjs';

test('the audio-only meter amendment preserves the independent navigation baseline exactly', async () => {
  assert.deepEqual(rainVolumeMeterAmendments.changes.map(change => change.file), ['nav.js']);
  const source = await readFile(new URL('../nav.js', import.meta.url), 'utf8');
  const restored = restoreRainVolumeMeters(source, 'nav.js');
  assert.equal(createHash('sha256').update(restored).digest('hex'), rainVolumeMeterAmendments.baseSha256);
  for (const change of rainVolumeMeterAmendments.changes) {
    for (const file of change.regressionTests) await readFile(new URL(`../${file}`, import.meta.url));
    for (const replacement of change.replacements) {
      assert.throws(() => restoreRainVolumeMeters(source.replace(replacement.after, ''), 'nav.js'), /exact Rain Volume meter amendment/);
      assert.throws(() => restoreRainVolumeMeters(source + replacement.after, 'nav.js'), /exact Rain Volume meter amendment/);
    }
  }
  assert.equal(restoreRainVolumeMeters('untouched', 'unrelated.js'), 'untouched');
});
