import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export const shapesSoundBankChanges = JSON.parse(readFileSync(new URL("../../docs/shapes-sound-banks-runtime-changes.json", import.meta.url), "utf8")).changes;
/** Reverse this feature only; never update or loosen the frozen references. */
export function restoreShapesSoundBanks(source, file) {
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of shapesSoundBankChanges.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exactly one Shapes bank edit`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
