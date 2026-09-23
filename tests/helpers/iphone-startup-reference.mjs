import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readChanges = file => JSON.parse(readFileSync(new URL(`../../docs/${file}`, import.meta.url), "utf8")).changes;
const changes = [
  ...readChanges("iphone-audio-runtime-changes.json"),
  ...readChanges("iphone-navigation-runtime-changes.json"),
];

/** Reverse only main's explicitly recorded iPhone updates for older references. */
export function restoreIphoneStartup(source, file) {
  for (const change of changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact iPhone amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
