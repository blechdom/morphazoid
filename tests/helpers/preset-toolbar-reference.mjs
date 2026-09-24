import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export const toolbarAmendments = JSON.parse(readFileSync(new URL("../../docs/preset-toolbar-runtime-changes.json", import.meta.url), "utf8"));
export function restorePresetToolbar(source, file) {
  for (const change of toolbarAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact toolbar amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
