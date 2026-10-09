import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const borrowedContextAmendments = JSON.parse(readFileSync(new URL("../../docs/borrowed-audio-context-runtime-changes.json", import.meta.url), "utf8"));

/** Reverse only the shared-clock APIs before checking historical layouts. */
export function restoreBorrowedAudioContext(source, file) {
  for (const change of borrowedContextAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact borrowed audio context amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
