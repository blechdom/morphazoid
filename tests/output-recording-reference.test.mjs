import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { borrowedContextAmendments, restoreBorrowedAudioContext } from "./helpers/borrowed-audio-context-reference.mjs";
import { outputRecordingAmendments, restoreOutputRecording, restoreOutputRecordingHooks,
  restoreVoiceControls, voiceControlAmendments } from "./helpers/output-recording-reference.mjs";

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

test("L-system recording hooks reverse independently on the historical and approved voice-control UIs", async () => {
  const change = voiceControlAmendments.changes[0];
  const recording = outputRecordingAmendments.changes.find(candidate => candidate.file === change.file);
  assert.equal(change.baseSha256, recording.baseSha256, "the independently recorded historical hash stays unchanged");
  const current = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
  const approved = restoreOutputRecordingHooks(current, change.file);
  const historical = restoreVoiceControls(approved, change.file);
  const hash = source => createHash("sha256").update(source).digest("hex");
  assert.equal(hash(approved), change.approvedSha256);
  assert.equal(hash(historical), recording.baseSha256);
  assert.equal(restoreVoiceControls(historical, change.file), historical);

  let reapplied = historical;
  for (const replacement of change.replacements) {
    assert.equal(reapplied.split(replacement.before).length - 1, 1, "approved UI patch has one historical owner");
    reapplied = reapplied.replace(replacement.before, replacement.after);
  }
  assert.equal(reapplied, approved, "the five exact approved UI hunks reconstruct the independent commit hash");

  for (const source of [historical, approved]) {
    let recorded = source;
    for (const replacement of recording.replacements) {
      assert.equal(recorded.split(replacement.before).length - 1, 1);
      recorded = recorded.replace(replacement.before, replacement.after);
    }
    assert.equal(restoreOutputRecordingHooks(recorded, change.file), source,
      "recording inverse does not consume voice-control changes");
    assert.equal(restoreOutputRecording(recorded, change.file), historical);
    for (const replacement of recording.replacements) {
      assert.throws(() => restoreOutputRecordingHooks(recorded.replace(replacement.after, ""), change.file), /exact output recording amendment/);
      assert.throws(() => restoreOutputRecordingHooks(recorded + replacement.after, change.file), /exact output recording amendment/);
    }
  }
});

test("L-system approved UI preservation rejects missing, duplicated, and unrelated changes", async () => {
  const change = voiceControlAmendments.changes[0];
  const current = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
  const approved = restoreOutputRecordingHooks(current, change.file);
  for (const replacement of change.replacements) {
    assert.throws(() => restoreVoiceControls(approved.replace(replacement.after, ""), change.file), /exact approved voice control amendment/);
    assert.throws(() => restoreVoiceControls(approved + replacement.after, change.file), /exact approved voice control amendment/);
  }
  assert.throws(() => restoreVoiceControls(approved + "\n// unrelated runtime change\n", change.file), /exact approved voice control amendment/);
  assert.equal(restoreVoiceControls("unrelated source", "unrelated.js"), "unrelated source");
});
