import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const rainVolumeMeterAmendments = JSON.parse(readFileSync(new URL('../../docs/rain-volume-meter-runtime-changes.json', import.meta.url), 'utf8'));
export function restoreRainVolumeMeters(source, file) {
  for (const change of rainVolumeMeterAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Rain Volume meter amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
