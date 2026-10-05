import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

export const synthesaurusIconChanges = JSON.parse(readFileSync(
  new URL('../../docs/synthesaurus-icon-changes.json', import.meta.url), 'utf8',
)).changes;

/** Preserve the frozen catalogue references while allowing the reviewed icon. */
export function restoreSynthesaurusIcon(source, file) {
  for (const change of synthesaurusIconChanges.filter(change => change.file === file)) {
    for (const testFile of change.regressionTests)
      assert.ok(existsSync(new URL('../../' + testFile, import.meta.url)), testFile);
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, file + ': exact Synthesaurus icon amendment');
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
