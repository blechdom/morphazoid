import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const rigAJigSiteChanges = JSON.parse(readFileSync(
  new URL("../fixtures/rig-a-jig-site-amendments.json", import.meta.url), "utf8",
));

/** Peel only the reviewed Rig-a-Jig registrations before older frozen byte proofs. */
export function restoreRigAJigSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  const change = rigAJigSiteChanges.changes.find(item => item.file === file);
  if (!change) return source;
  if (allowRestored && !source.includes("rig-a-jig")) return source;
  for (const { before, after } of [...change.replacements].reverse()) {
    // When the newest amendment is already absent (e.g. an older frozen proof
    // running with allowRestored), there is nothing to peel.
    if (!source.includes(after)) return source;
    assert.equal(source.split(after).length - 1, 1, `${file}: exact Rig-a-Jig WIP amendment`);
    source = source.replace(after, () => before);
  }
  return source;
}
