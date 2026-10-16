import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreEsi32Site } from './esi-32-site-reference.mjs';

export const wobbliniSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/wobblini-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the reviewed Wobblini additions; preserve unrelated source drift. */
export function restoreWobbliniSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreEsi32Site(source, file, { allowRestored: true });
  for (const change of wobbliniSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Wobblini site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
