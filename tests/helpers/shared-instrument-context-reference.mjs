import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const sharedInstrumentContextAmendments = JSON.parse(readFileSync(
  new URL("../../docs/shared-instrument-context-runtime-changes.json", import.meta.url), "utf8",
));

export function restoreSharedInstrumentContext(source, file) {
  for (const change of sharedInstrumentContextAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact shared instrument context amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
