import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const gesticulesMetadataAmendments = JSON.parse(readFileSync(new URL("../../docs/gesticules-metadata-runtime-changes.json", import.meta.url), "utf8"));

/** Reverse only the declared instrument additions; retain the frozen move proof. */
export function restoreGesticulesMetadata(source, file) {
  for (const change of gesticulesMetadataAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact Gesticules metadata amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
