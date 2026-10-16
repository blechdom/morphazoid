import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const sharedInstrumentContextAmendments = JSON.parse(readFileSync(
  new URL("../../docs/shared-instrument-context-runtime-changes.json", import.meta.url), "utf8",
));

export function restoreSharedInstrumentContext(source, file) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of sharedInstrumentContextAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact shared instrument context amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
