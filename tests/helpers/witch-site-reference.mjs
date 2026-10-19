import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const witchSiteChanges = JSON.parse(readFileSync(
  new URL("../fixtures/witch-site-amendments.json", import.meta.url), "utf8",
));

/** Peel the exact Witch additions before older frozen-source comparisons. */
export function restoreWitchSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  for (const change of witchSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Witch site amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
