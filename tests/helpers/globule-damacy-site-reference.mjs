import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

export const globuleDamacySiteChanges = JSON.parse(readFileSync(
  new URL("../../docs/globule-damacy-site-changes.json", import.meta.url), "utf8",
));

/** Peel exactly this instrument's additions before older frozen proofs. */
export function restoreGlobuleDamacySite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
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
