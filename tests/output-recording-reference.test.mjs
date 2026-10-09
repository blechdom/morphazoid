import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { borrowedContextAmendments, restoreBorrowedAudioContext } from "./helpers/borrowed-audio-context-reference.mjs";
import { outputRecordingAmendments, restoreOutputRecording } from "./helpers/output-recording-reference.mjs";

for (const [name, amendments, restore] of [
  ["borrowed audio contexts", borrowedContextAmendments, restoreBorrowedAudioContext],
  ["output recording hooks", outputRecordingAmendments, restoreOutputRecording],
]) {
  test(`${name} reverse to the independently hashed pre-change sources`, async () => {
    for (const change of amendments.changes) {
      const current = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
      assert.equal(createHash("sha256").update(restore(current, change.file)).digest("hex"), change.baseSha256, change.file);
      const first = change.replacements[0];
      assert.throws(() => restore(current.replace(first.after, ""), change.file), /exact .* amendment/);
      assert.throws(() => restore(current + first.after, change.file), /exact .* amendment/);
    }
  });
}
