import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const fabricFilterAmendments = JSON.parse(readFileSync(
  new URL("../../docs/fabric-filter-runtime-changes.json", import.meta.url), "utf8",
));

export function restoreFabricFilter(source, file) {
  for (const change of fabricFilterAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Fabric Filter amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
