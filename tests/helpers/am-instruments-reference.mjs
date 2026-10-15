import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreChaoticAmRouting } from "./chaotic-am-routing-reference.mjs";
import { restoreRecursivePresets } from "./recursive-presets-reference.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { restoreGraphDelayRustSite } from "./graph-delay-rust-site-reference.mjs";

export const amSharedAmendments = JSON.parse(readFileSync(
  new URL("../fixtures/am-shared-amendments.json", import.meta.url), "utf8",
));

// Reverse only reviewed AM additions; historical source hashes stay frozen.
export function restoreAmInstrumentAdditions(source, file, { allowRestored = false } = {}) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreGraphDelayRustSite(source, file, { allowRestored: true });
  source = restoreChaoticAmRouting(source, file, { allowRestored: true });
  source = restoreRecursivePresets(source, file, { allowRestored: true });
  for (const change of amSharedAmendments.changes.filter(change => change.file === file)) {
    if (allowRestored && change.replacements.every(({ after }) => !source.includes(after))) continue;
    for (const { before, after } of [...change.replacements].reverse()) {
      assert.equal(source.split(after).length - 1, 1, `${file}: exact AM instrument amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}
