import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const outputRecordingAmendments = JSON.parse(readFileSync(new URL("../../docs/output-recording-runtime-changes.json", import.meta.url), "utf8"));
export const voiceControlAmendments = JSON.parse(readFileSync(new URL("./l-system-voice-control-amendments.json", import.meta.url), "utf8"));
const sha256 = source => createHash("sha256").update(source).digest("hex");

/** Independently reverse recording hooks on either approved UI baseline. */
export function restoreOutputRecordingHooks(source, file) {
  for (const change of outputRecordingAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact output recording amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}

/** Retain the original proof: accept only its exact baseline or approved UI. */
export function restoreVoiceControls(source, file) {
  for (const change of voiceControlAmendments.changes.filter(change => change.file === file)) {
    const digest = sha256(source);
    if (digest === change.baseSha256) continue;
    assert.equal(digest, change.approvedSha256, `${file}: exact approved voice control amendment source`);
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact voice control amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
    assert.equal(sha256(source), change.baseSha256, `${file}: original voice control amendment baseline`);
  }
  return source;
}

/** Compose approved UI and recording amendments without changing old hashes. */
export function restoreOutputRecording(source, file) {
  return restoreVoiceControls(restoreOutputRecordingHooks(source, file), file);
}
