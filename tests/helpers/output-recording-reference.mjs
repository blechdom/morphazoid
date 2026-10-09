import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const outputRecordingAmendments = JSON.parse(readFileSync(new URL("../../docs/output-recording-runtime-changes.json", import.meta.url), "utf8"));

/** Remove only the requested recorder hooks from historical layout proofs. */
export function restoreOutputRecording(source, file) {
  for (const change of outputRecordingAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact output recording amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
