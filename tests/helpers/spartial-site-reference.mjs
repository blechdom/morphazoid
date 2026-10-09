import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const spartialSiteChanges = JSON.parse(readFileSync(
  new URL("../../docs/spartial-site-changes.json", import.meta.url), "utf8",
));

/** Remove only SPARTIAL's exact records before checking older frozen evidence. */
export function restoreSpartialSite(source, file, { allowRestored = false } = {}) {
  for (const change of spartialSiteChanges.changes.filter(change => change.file === file)) {
    // Older layered readers can visit this seam twice. Missing individual or
    // duplicated additions still fail; the direct integration proof is strict.
    if (allowRestored && change.additions.every(addition => !source.includes(addition))) continue;
    for (const addition of change.additions) {
      assert.equal(source.split(addition).length - 1, 1, `${file}: exact SPARTIAL addition`);
      source = source.replace(addition, "");
    }
  }
  return source;
}
