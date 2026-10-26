import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const oculoidSiteChanges = JSON.parse(readFileSync(
  new URL("../../docs/oculoid-site-changes.json", import.meta.url), "utf8",
));

/** Peel off exactly Oculoid's reviewed additions before older frozen proofs. */
export function restoreOculoidSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  for (const change of oculoidSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Oculoid amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}
