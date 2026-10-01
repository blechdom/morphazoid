import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export const voicesaurusAmendments = JSON.parse(readFileSync(
  new URL('../../docs/voicesaurus-runtime-changes.json', import.meta.url), 'utf8',
));
const readImplementation = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const sha = source => createHash('sha256').update(source).digest('hex');

/** Restore the pre-Voicesaurus source before applying earlier frozen amendments. */
export function restoreVoicesaurus(source, file, readShared = readImplementation) {
  for (const change of voicesaurusAmendments.changes.filter(change => change.file === file)) {
    for (const testFile of change.regressionTests) {
      assert.ok(existsSync(new URL(`../../${testFile}`, import.meta.url)), testFile);
    }
    if (change.implementation) {
      assert.equal(source, change.wrapper, `${file}: exact shared speech entry`);
      source = readShared(change.implementation);
    }
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Voicesaurus amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
    assert.equal(sha(source), change.sha256, `${file}: pre-Voicesaurus source preserved`);
  }
  return source;
}
