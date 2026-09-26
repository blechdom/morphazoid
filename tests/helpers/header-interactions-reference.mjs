import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const headerInteractionAmendments = JSON.parse(readFileSync(new URL("../../docs/header-interactions-runtime-changes.json", import.meta.url), "utf8"));

export function restoreHeaderInteractions(source, file) {
  for (const change of headerInteractionAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact header-interaction amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
