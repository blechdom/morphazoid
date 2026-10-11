import { restoreTrackazoidSite } from './trackazoid-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const spartialGranularSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/spartial-granular-site-amendment.json', import.meta.url), 'utf8',
));

/** Reverse only SPARTIAL's reviewed granular catalogue and runtime rows before older evidence. */
export function restoreSpartialGranularSite(source, file, { allowRestored = false } = {}) {
  source = restoreTrackazoidSite(source, file, { allowRestored: true });
  for (const change of spartialGranularSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      if (allowRestored && !source.includes(after) && source.split(before).length - 1 === 1) continue;
      assert.equal(source.split(after).length - 1, 1, `${file}: exact SPARTIAL granular amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}
