import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const mainOutputRoutingAmendments = JSON.parse(readFileSync(
  new URL("../../docs/main-output-routing-runtime-changes.json", import.meta.url), "utf8",
));

/** Restore exact pre-recording bytes before the older input/layout proofs. */
export function restoreMainOutputRouting(source, file) {
  for (const change of mainOutputRoutingAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact main output routing amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
