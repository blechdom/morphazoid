import { restoreRoachPerformance } from './roach-synth-performance-reference.mjs';
import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { restoreFractalNavigation } from './fractal-delay-navigation-reference.mjs';
import { restoreSoundFontsToolbar } from './sound-fonts-toolbar-reference.mjs';

export const outputRecordingAmendments = JSON.parse(readFileSync(new URL("../../docs/output-recording-runtime-changes.json", import.meta.url), "utf8"));
export const voiceControlAmendments = JSON.parse(readFileSync(new URL("./l-system-voice-control-amendments.json", import.meta.url), "utf8"));
export const liveFlowAmendments = JSON.parse(readFileSync(new URL("./l-system-live-flow-amendments.json", import.meta.url), "utf8"));
const sha256 = source => createHash("sha256").update(source).digest("hex");

/** Independently reverse recording hooks on either approved UI baseline. */
export function restoreOutputRecordingHooks(source, file) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreSoundFontsToolbar(source, file, { allowRestored: true });
  for (const change of outputRecordingAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact output recording amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  source = restoreRoachPerformance(source, file, { allowRestored: true });
  return source;
}

/** Retain the original proof: accept only its exact baseline or approved UI. */
export function restoreVoiceControls(source, file) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
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

/** Reverse only the exact live-flow extension; preserve both prior baselines. */
export function restoreLiveFlow(source, file) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of liveFlowAmendments.changes.filter(change => change.file === file)) {
    const digest = sha256(source), historical = voiceControlAmendments.changes.find(change => change.file === file)?.baseSha256;
    if (digest === change.baseSha256 || digest === historical) continue;
    assert.equal(digest, change.approvedSha256, `${file}: exact approved live flow amendment source`);
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact live flow amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
    assert.equal(sha256(source), change.baseSha256, `${file}: original live flow amendment baseline`);
  }
  return source;
}

/** Compose approved runtime extensions without changing historical hashes. */
export function restoreOutputRecording(source, file) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  source = restoreFractalNavigation(source, file, { allowRestored: true });
  return restoreVoiceControls(restoreLiveFlow(restoreOutputRecordingHooks(source, file), file), file);
}
