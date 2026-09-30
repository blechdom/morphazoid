import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const fractalSignalsSiteChanges = JSON.parse(readFileSync(new URL('../../docs/fractal-signals-site-changes.json', import.meta.url), 'utf8'));
// Account for exact new-instrument additions without relaxing the older refactor proofs.
export function restoreFractalSignalsSite(source, file) {
  for (const change of fractalSignalsSiteChanges.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Fractal Signals amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
