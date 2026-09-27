import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const hybrinxVolumeMeterChanges = JSON.parse(readFileSync(new URL('../../docs/hybrinx-volume-meter-runtime-changes.json', import.meta.url), 'utf8')).changes;
export function restoreHybrinxVolumeMeter(source, file) {
  for (const change of hybrinxVolumeMeterChanges.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Hybrinx volume/meter amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
