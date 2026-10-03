import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const changes = JSON.parse(readFileSync(new URL("../../docs/tap-tempo-runtime-changes.json", import.meta.url), "utf8")).changes;

/** Reverse only the documented owner hooks for frozen historical layout proofs. */
export function restoreTapTempo(source, file) {
  for (const change of changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Tap owner hook`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
