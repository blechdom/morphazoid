import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const rubixoidsSiteAmendments = JSON.parse(readFileSync(new URL("../../docs/rubixoids-site-runtime-changes.json", import.meta.url), "utf8"));

/** Remove only Rubixoids' exact additions before applying older frozen proofs. */
export function restoreRubixoidsSite(source, file) {
  for (const change of rubixoidsSiteAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Rubixoids site amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
