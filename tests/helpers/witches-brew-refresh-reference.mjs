import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { restoreWitchesBrewFaves } from "./witches-brew-faves-reference.mjs";

export const witchesBrewRefreshAmendments = JSON.parse(readFileSync(
  new URL("../fixtures/witches-brew-refresh-amendments.json", import.meta.url), "utf8",
));

/** Older post-Witch baselines keep the original instrument and copy. This is
 * deliberately separate from restoreWitchSite, which removes its first addition. */
export function restoreWitchesBrewRefresh(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  const change = witchesBrewRefreshAmendments.changes.find(change => change.file === file);
  if (!change) return source;
  source = restoreWitchesBrewFaves(source, file, { allowRestored: true });
  const counts = change.replacements.map(({ after }) => source.split(after).length - 1);
  if (allowRestored && counts.every(count => count === 0)) return source;
  for (const count of counts) assert.equal(count, 1, `${file}: exact Witches Brew refresh amendment`);
  for (const { before, after } of [...change.replacements].reverse()) source = source.replace(after, () => before);
  return source;
}
