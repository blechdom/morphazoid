import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const labSiteAdditions = JSON.parse(readFileSync(new URL('../fixtures/l-system-labs-site-additions.json', import.meta.url), 'utf8'));
export function restoreLSystemLabSite(source, file) {
  for (const change of labSiteAdditions.filter(change => change.file === file)) {
    for (const replacement of change.replacements ?? []) {
      if (!source.includes(replacement.after)) continue;
      assert.equal(source.split(replacement.after).length - 1, replacement.count, `${file}: exact L-system lab replacement`);
      source = source.replaceAll(replacement.after, replacement.before);
    }
    for (const addition of new Set(change.additions)) {
      const escaped = addition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp('^' + escaped, 'gm');
      const count = [...source.matchAll(pattern)].length;
      if (!count) continue;
      assert.equal(count, change.additions.filter(value => value === addition).length, `${file}: exact L-system lab addition`);
      source = source.replace(pattern, '');
    }
  }
  return source;
}
