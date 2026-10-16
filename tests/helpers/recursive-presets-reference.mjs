import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const recursivePresetAmendments = JSON.parse(readFileSync(
  new URL("../fixtures/recursive-presets-amendments.json", import.meta.url), "utf8",
));

// Peel only the reviewed preset UI and FM output-cleanup changes. Earlier
// preservation hashes continue to describe the exact historical source bytes.
export function restoreRecursivePresets(source, file, { allowRestored = false } = {}) {
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of recursivePresetAmendments.changes.filter(change => change.file === file)) {
    if (allowRestored && change.replacements.every(({ after }) => !source.includes(after))) continue;
    for (const { before, after } of [...change.replacements].reverse()) {
      assert.equal(source.split(after).length - 1, 1, `${file}: exact Recursive preset amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}
