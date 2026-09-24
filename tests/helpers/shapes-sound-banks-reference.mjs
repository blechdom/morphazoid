import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export const shapesSoundBankChanges = JSON.parse(readFileSync(new URL("../../docs/shapes-sound-banks-runtime-changes.json", import.meta.url), "utf8")).changes;
/** Reverse this feature only; never update or loosen the frozen references. */
export function restoreShapesSoundBanks(source, file) {
  for (const change of shapesSoundBankChanges.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exactly one Shapes bank edit`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
