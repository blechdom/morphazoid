import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const esi32SiteChanges = JSON.parse(readFileSync(new URL('../../docs/esi-32-site-changes.json', import.meta.url), 'utf8'));

/** Peel only the ESI-32 additions before checking earlier frozen metadata. */
export function restoreEsi32Site(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  for (const change of esi32SiteChanges.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      const count = source.split(replacement.after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact ESI-32 site amendment`);
      source = source.replace(replacement.after, () => replacement.before);
    }
  }
  return source;
}
