import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const graphDelayRustSiteAdditions = JSON.parse(readFileSync(
  new URL("../fixtures/graph-delay-rust-site-additions.json", import.meta.url), "utf8",
));

// Remove this route's exact additions before older historical source assertions.
export function restoreGraphDelayRustSite(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of graphDelayRustSiteAdditions.filter(change => change.file === file)) {
    if (allowRestored && change.replacements.every(({ after }) => !source.includes(after))) continue;
    for (const { before, after, count = 1 } of [...change.replacements].reverse()) {
      assert.equal(source.split(after).length - 1, count, `${file}: exact Graph Delay Rust amendment`);
      source = source.replaceAll(after, before);
    }
  }
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}
