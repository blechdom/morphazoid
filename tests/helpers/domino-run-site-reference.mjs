import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const dominoRunSiteAmendments = JSON.parse(readFileSync(new URL("../../docs/domino-run-site-runtime-changes.json", import.meta.url), "utf8"));

/** Reverse only Domino Run's exact additions before the older metadata proofs. */
export function restoreDominoRunSite(source, file) {
  for (const change of dominoRunSiteAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Domino Run site amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
