import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const lSystemsEnsembleChanges = JSON.parse(readFileSync(
  new URL("../../docs/l-systems-ensemble-runtime-changes.json", import.meta.url), "utf8",
)).changes;

/** Peel the recovered instrument edits before the older input/controller proofs. */
export function restoreLSystemsEnsemble(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  for (const change of lSystemsEnsembleChanges.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0 && source.split(before).length - 1 === 1) continue;
      assert.equal(count, 1, `${file}: exact L-Systems ensemble amendment`);
      source = source.replace(after, () => before);
    }
  }
  return source;
}
