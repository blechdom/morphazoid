import { restoreRezoidinatorRustDspSite } from './rezoidinator-rust-dsp-site-reference.mjs';
import { restoreRigAJigSite } from './rig-a-jig-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const rigLabSiteChanges = JSON.parse(readFileSync(
  new URL("../fixtures/rig-lab-site-amendments.json", import.meta.url), "utf8",
));

/** Peel only the reviewed Rig Lab registrations before older frozen byte proofs. */
export function restoreRigLabSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  // Rig-a-Jig is the newest WIP amendment on these shared files; peel it first.
  source = restoreRigAJigSite(source, file, { allowRestored: true });
  source = restoreRezoidinatorRustDspSite(source, file, { allowRestored: true });
  const change = rigLabSiteChanges.changes.find(item => item.file === file);
  if (!change) return source;
  if (allowRestored && !source.includes("rig-lab")) return source;
  for (const { before, after } of [...change.replacements].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `${file}: exact Rig Lab WIP amendment`);
    source = source.replace(after, () => before);
  }
  return source;
}
