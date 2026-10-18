import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const mobileMenubarAmendments = JSON.parse(readFileSync(new URL('../../docs/mobile-menubar-runtime-changes.json', import.meta.url), 'utf8'));
export function restoreMobileMenubar(source, file, { allowRestored = false } = {}) {
  for (const change of mobileMenubarAmendments.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      // Older proof layers may already have removed these additive hooks.
      // Their independent frozen hashes still reject missing/tampered runtime bytes.
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact mobile menubar amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
