import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const fractalDelaySiteChanges = JSON.parse(readFileSync(
  new URL('./fractal-delay-site-amendments.json', import.meta.url), 'utf8',
));

/** Undo only the exact reviewed Fractal Delay registration. Historical hashes
 * and their original negative guards remain authoritative for all other bytes.
 */
export function restoreFractalDelaySite(source, file) {
  for (const change of fractalDelaySiteChanges.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1,
        `${file}: exact Fractal Delay site amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
