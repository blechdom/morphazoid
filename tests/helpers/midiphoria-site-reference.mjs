import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreBlechMidiSite } from './blech-midi-site-reference.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreSpartialSite } from './spartial-site-reference.mjs';
import { restoreAmInstrumentAdditions } from './am-instruments-reference.mjs';

export const midiphoriaSiteAdditions = JSON.parse(readFileSync(new URL('../fixtures/midiphoria-site-additions.json', import.meta.url), 'utf8'));

// Peel only the exact new lab records; retain every earlier catalogue byte.
export function restoreMidiphoriaSite(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreBlechMidiSite(source, file, { allowRestored: true });
  source = restoreSpartialSite(source, file, { allowRestored: true });
  source = restoreAmInstrumentAdditions(source, file, { allowRestored: true });
  for (const change of midiphoriaSiteAdditions.filter(change => change.file === file)) {
    // Historical reader layers may call this twice. Partial or duplicated
    // additions still fail; direct new-page checks always require every record.
    if (allowRestored && change.additions.every(addition => !source.includes(addition))) continue;
    for (const addition of change.additions) {
      assert.equal(source.split(addition).length - 1, 1, `${file}: exact Midiphoria addition`);
      source = source.replace(addition, '');
    }
  }
  return source;
}
