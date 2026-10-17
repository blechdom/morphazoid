import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const spartialOrganRuntimeChanges = JSON.parse(readFileSync(
  new URL('../fixtures/spartial-organ-runtime-addition.json', import.meta.url), 'utf8',
));

/** Peel only the reviewed organ helper and research document before older evidence. */
export function restoreSpartialOrganRuntime(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const change = spartialOrganRuntimeChanges;
  if (typeof source !== 'string' || file !== change.file) return source;
  const counts = change.replacements.map(({ addition }) => source.split(addition).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  const error = `${file}: exact SPARTIAL organ runtime addition`;
  for (const count of counts) assert.equal(count, 1, error);
  for (const { before, after } of change.replacements) {
    assert.equal(source.split(after).length - 1, 1, error);
    source = source.replace(after, before);
  }
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}
