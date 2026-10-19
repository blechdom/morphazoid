import { restoreWitchSite } from "./helpers/witch-site-reference.mjs";
import { test } from 'node:test';
import { restoreRezoidinatorModesSite } from './helpers/rezoidinator-modes-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mobileMenubarAmendments, restoreMobileMenubar } from './helpers/mobile-menubar-reference.mjs';
test('mobile presentation reverses exactly without changing historical navigation or audio', () => {
  for (const change of mobileMenubarAmendments.changes) {
    const source = restoreWitchSite(readFileSync(new URL(`../${change.file}`, import.meta.url), 'utf8'), change.file, { allowRestored: true });
    const digest = text => createHash('sha256').update(text).digest('hex');
    // Rezoidinator landed independently after this amendment's frozen base.
    const restored = restoreRezoidinatorModesSite(restoreMobileMenubar(source, change.file), change.file, { allowRestored: true });
    assert.equal(digest(restored), change.sha256);
    assert.equal(restoreMobileMenubar(restored, change.file, { allowRestored: true }), restored);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreMobileMenubar(source.replace(after, ''), change.file), /exact mobile menubar amendment/);
      assert.throws(() => restoreMobileMenubar(source + after, change.file), /exact mobile menubar amendment/);
      assert.throws(() => restoreMobileMenubar(source.replace(after, after.replace(/initializeMobileMenubars|mobile-menubar/, 'changedMenubar')), change.file), /exact mobile menubar amendment/);
    }
    const drift = '\n// unrelated drift\n';
    const drifted = restoreRezoidinatorModesSite(restoreMobileMenubar(source + drift, change.file), change.file, { allowRestored: true });
    assert.equal(drifted, restored + drift);
    assert.notEqual(digest(drifted), change.sha256);
  }
});
