import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const timeLoomSiteChanges = JSON.parse(readFileSync(new URL('../fixtures/time-loom-site-amendments.json', import.meta.url), 'utf8'));

/** Remove only this instrument's additive registration for historical integrity checks. */
export function restoreTimeLoomSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  for (const change of timeLoomSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Time Loom registration amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
