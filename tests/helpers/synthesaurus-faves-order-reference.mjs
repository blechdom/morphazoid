import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export const synthesaurusFavesOrderChanges = JSON.parse(readFileSync(
  new URL('../../docs/synthesaurus-faves-order-changes.json', import.meta.url), 'utf8',
)).changes;

/** Peel off the later Faves reorder before verifying older frozen catalogues. */
export function restoreSynthesaurusFavesOrder(source, file) {
  for (const change of synthesaurusFavesOrderChanges.filter(change => change.file === file)) {
    for (const testFile of change.regressionTests) {
      assert.ok(existsSync(new URL('../../' + testFile, import.meta.url)), testFile);
    }
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, file + ': exact Synthesaurus Faves reorder');
      source = source.replace(replacement.after, replacement.before);
    }
    assert.equal(createHash('sha256').update(source).digest('hex'), change.sha256,
      file + ': pre-Synthesaurus-reorder source preserved');
  }
  return source;
}
