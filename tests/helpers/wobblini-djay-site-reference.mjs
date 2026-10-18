import { restoreThroatSingerMetadata, restoreThroatSingerView } from "./throat-singer-reference.mjs";
import { restoreRezoidinatorModesSite } from './rezoidinator-modes-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const wobbliniDjaySiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/wobblini-djay-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the reviewed performance/recorder amendments for older proofs. */
export function restoreWobbliniDjaySite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  source = restoreRezoidinatorModesSite(source, file, { allowRestored: true });
  source = restoreThroatSingerView(source, file);
  source = restoreThroatSingerMetadata(source, file, { allowRestored: true });
  for (const change of wobbliniDjaySiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Wobblini djay site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
