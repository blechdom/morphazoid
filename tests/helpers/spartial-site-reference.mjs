import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { restoreGraphDelayRustSite } from "./graph-delay-rust-site-reference.mjs";

export const spartialSiteChanges = JSON.parse(readFileSync(
  new URL("../../docs/spartial-site-changes.json", import.meta.url), "utf8",
));

/** Remove only SPARTIAL's exact records before checking older frozen evidence. */
export function restoreSpartialSite(source, file, { allowRestored = false } = {}) {
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreGraphDelayRustSite(source, file, { allowRestored: true });
  for (const change of spartialSiteChanges.changes.filter(change => change.file === file)) {
    // Older layered readers can visit this seam twice. Missing individual or
    // duplicated additions still fail; the direct integration proof is strict.
    if (allowRestored && change.additions.every(addition => !source.includes(addition))) continue;
    for (const addition of change.additions) {
      assert.equal(source.split(addition).length - 1, 1, `${file}: exact SPARTIAL addition`);
      source = source.replace(addition, "");
    }
  }
  return source;
}
