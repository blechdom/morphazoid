import { restoreBlobsSite } from './blobs-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const bifurcatorSiteChanges = JSON.parse(readFileSync(new URL('../../docs/bifurcator-site-changes.json', import.meta.url), 'utf8'));

// Peel only this instrument's exact additions before checking earlier evidence.
export function restoreBifurcatorSite(source, file) {
  source = restoreBlobsSite(source, file);
  for (const change of bifurcatorSiteChanges.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Bifurcator amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}

export const restoreBifurcatorBaseline = restoreBifurcatorSite;
