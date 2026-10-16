import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { restoreSynthesaurusIcon } from './synthesaurus-icon-reference.mjs';

export const synthesaurusFavesOrderChanges = JSON.parse(readFileSync(
  new URL('../../docs/synthesaurus-faves-order-changes.json', import.meta.url), 'utf8',
)).changes;

/** Peel off the later Faves reorder before verifying older frozen catalogues. */
export function restoreSynthesaurusFavesOrder(source, file) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreSynthesaurusIcon(source, file);
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
