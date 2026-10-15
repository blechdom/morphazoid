import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const rubixColorKitChanges = JSON.parse(readFileSync(new URL("../../docs/rubix-color-kit-runtime-changes.json", import.meta.url), "utf8")).changes;

/** Reverse only this reviewed bank addition; all original relocation hashes stay frozen. */
export function restoreRubixColorKit(source, file) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of rubixColorKitChanges.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Color kit amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
