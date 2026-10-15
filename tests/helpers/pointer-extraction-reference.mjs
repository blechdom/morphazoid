import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const pointerReference = JSON.parse(readFileSync(
  new URL("../fixtures/pointer-coordinates-v1.json", import.meta.url), "utf8",
));

/** Reverse only this checked, behavior-equivalent extraction for older proofs. */
export function restorePointerExtraction(source, file) {
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  const entry = pointerReference.entries.find(entry => entry.file === file);
  if (!entry) return source;
  assert.equal(source.split(entry.importLine).length - 1, 1, `${file}: exact helper import`);
  assert.equal(source.split(entry.after).length - 1, 1, `${file}: exact migrated callback`);
  return source.replace(entry.importLine, "").replace(entry.after, entry.before);
}
