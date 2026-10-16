import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';

const file = 'scripts/site/runtime-files.tsv';
export const quadrupedAudioQueueRuntimeRow = 'copy+require\tsrc/instruments/quadruped/quadruped-audio-queue.js\n';

/** Preserve historical manifest guards by peeling only this reviewed row. */
export function restoreQuadrupedAudioQueueRuntime(source, relative, { allowRestored = false } = {}) {
  source = restoreMicInputBatchSite(source, relative, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, relative, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, relative, { allowRestored: true });
  if (typeof source !== 'string' || relative !== file) return source;
  const count = source.split(quadrupedAudioQueueRuntimeRow).length - 1;
  if (allowRestored && count === 0) return source;
  assert.equal(count, 1, `${file}: exact Quadruped audio queue runtime addition`);
  return source.replace(quadrupedAudioQueueRuntimeRow, '');
}
