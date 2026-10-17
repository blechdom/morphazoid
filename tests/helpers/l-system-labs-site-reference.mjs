import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreMidiphoriaSite } from './midiphoria-site-reference.mjs';
export const labSiteAdditions = JSON.parse(readFileSync(new URL('../fixtures/l-system-labs-site-additions.json', import.meta.url), 'utf8'));
export function restoreLSystemLabSite(source, file) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreMidiphoriaSite(source, file, { allowRestored: true });
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
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}
