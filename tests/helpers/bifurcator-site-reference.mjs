import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreBlobsSite } from './blobs-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const bifurcatorSiteChanges = JSON.parse(readFileSync(new URL('../../docs/bifurcator-site-changes.json', import.meta.url), 'utf8'));

// Peel only this instrument's exact additions before checking earlier evidence.
export function restoreBifurcatorSite(source, file) {
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
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
