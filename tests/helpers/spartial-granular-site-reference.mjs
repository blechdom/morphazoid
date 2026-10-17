import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreTrackazoidSite } from './trackazoid-site-reference.mjs';
import { restoreBlechMidiSite } from './blech-midi-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreSpartialRecordingRuntime } from './spartial-recording-runtime-reference.mjs';

export const spartialGranularSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/spartial-granular-site-amendment.json', import.meta.url), 'utf8',
));

/** Reverse only SPARTIAL's reviewed granular catalogue and runtime rows before older evidence. */
export function restoreSpartialGranularSite(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreTrackazoidSite(source, file, { allowRestored: true });
  source = restoreBlechMidiSite(source, file, { allowRestored: true });
  source = restoreSpartialRecordingRuntime(source, file, { allowRestored: true });
  for (const change of spartialGranularSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      if (allowRestored && !source.includes(after) && source.split(before).length - 1 === 1) continue;
      assert.equal(source.split(after).length - 1, 1, `${file}: exact SPARTIAL granular amendment`);
      source = source.replace(after, before);
    }
  }
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}
