import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const fractalNavigationAmendments = JSON.parse(readFileSync(new URL('../../docs/fractal-delay-navigation-runtime-changes.json', import.meta.url), 'utf8'));

export function restoreFractalNavigation(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of fractalNavigationAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      const count = source.split(replacement.after).length - 1;
      if (allowRestored && count === 0 && source.split(replacement.before).length - 1 === 1) continue;
      assert.equal(count, 1, `${file}: exact Fractal navigation amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
