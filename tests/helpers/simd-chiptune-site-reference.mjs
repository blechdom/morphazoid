import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const simdChiptuneSiteAmendments = JSON.parse(readFileSync(new URL("../../docs/simd-chiptune-site-runtime-changes.json", import.meta.url), "utf8"));

/** Reverse only SIMD Chiptune's exact additions before the older metadata proofs. */
export function restoreSimdChiptuneSite(source, file) {
  for (const change of simdChiptuneSiteAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact SIMD Chiptune site amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
