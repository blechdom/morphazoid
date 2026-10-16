import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const graphDelayRustSiteAdditions = JSON.parse(readFileSync(
  new URL("../fixtures/graph-delay-rust-site-additions.json", import.meta.url), "utf8",
));

// Remove this route's exact additions before older historical source assertions.
export function restoreGraphDelayRustSite(source, file, { allowRestored = false } = {}) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of graphDelayRustSiteAdditions.filter(change => change.file === file)) {
    if (allowRestored && change.replacements.every(({ after }) => !source.includes(after))) continue;
    for (const { before, after, count = 1 } of [...change.replacements].reverse()) {
      assert.equal(source.split(after).length - 1, count, `${file}: exact Graph Delay Rust amendment`);
      source = source.replaceAll(after, before);
    }
  }
  return source;
}
