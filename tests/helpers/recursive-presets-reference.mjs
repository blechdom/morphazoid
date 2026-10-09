import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const recursivePresetAmendments = JSON.parse(readFileSync(
  new URL("../fixtures/recursive-presets-amendments.json", import.meta.url), "utf8",
));

// Peel only the reviewed preset UI and FM output-cleanup changes. Earlier
// preservation hashes continue to describe the exact historical source bytes.
export function restoreRecursivePresets(source, file, { allowRestored = false } = {}) {
  for (const change of recursivePresetAmendments.changes.filter(change => change.file === file)) {
    if (allowRestored && change.replacements.every(({ after }) => !source.includes(after))) continue;
    for (const { before, after } of [...change.replacements].reverse()) {
      assert.equal(source.split(after).length - 1, 1, `${file}: exact Recursive preset amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}
