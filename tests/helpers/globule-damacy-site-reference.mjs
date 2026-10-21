import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { restoreRigLabSite } from "./rig-lab-site-reference.mjs";

export const globuleDamacySiteChanges = JSON.parse(readFileSync(
  new URL("../../docs/globule-damacy-site-changes.json", import.meta.url), "utf8",
));

/** The older Rig Lab and Rezoidinator proofs pin the first published Globule
 * copy. Reverse only this later copy refresh before comparing their old hashes. */
export function restorePreviousGlobuleCopy(source, file) {
  if (typeof source !== "string") return source;
  const change = [
    ...globuleDamacySiteChanges.changes,
    ...globuleDamacySiteChanges.sharedChanges,
  ].find(item => item.file === file);
  const replacement = change?.replacements?.find(item => item.previousAfter);
  const current = replacement?.after ?? change?.addition;
  const previous = replacement?.previousAfter ?? change?.previousAddition;
  if (!previous) return source;
  assert.equal(source.split(current).length - 1, 1, `${file}: exact refreshed Globule copy`);
  assert.equal(source.split(previous).length - 1, 0, `${file}: no duplicate prior Globule copy`);
  return source.replace(current, () => previous);
}

/** Peel exactly this instrument's additions before older frozen proofs. */
export function restoreGlobuleDamacySite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  source = restoreRigLabSite(source, file, { allowRestored: true });
  for (const change of [
    ...globuleDamacySiteChanges.changes,
    ...globuleDamacySiteChanges.sharedChanges,
  ].filter(change => change.file === file)) {
    if (allowRestored && !source.includes("globule-damacy")) return source;
    if (change.addition) {
      assert.equal(source.split(change.addition).length - 1, 1, `${file}: exact Globule Damacy addition`);
      source = source.replace(change.addition, "");
      continue;
    }
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Globule Damacy amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}

/** Read historical source without this newer instrument; binary files remain untouched. */
export async function readGlobuleDamacySiteReference(file, encoding) {
  const source = await readFile(file, encoding);
  if (typeof source !== "string") return source;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const name = relative(root, file instanceof URL ? fileURLToPath(file) : file);
  return restoreGlobuleDamacySite(source, name, { allowRestored: true });
}
