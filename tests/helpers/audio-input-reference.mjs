import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import { restoreOutputRecording } from "./output-recording-reference.mjs";
import { restoreBorrowedAudioContext } from "./borrowed-audio-context-reference.mjs";
import { restoreSharedInstrumentContext } from "./shared-instrument-context-reference.mjs";
import { restoreNativeDelaySite } from './native-delay-site-reference.mjs';
import { restoreMainOutputRouting } from './main-output-routing-reference.mjs';
import { restoreLSystemLabSite } from './l-system-labs-site-reference.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readProcessorSamplesSiteReference as readFileAsync } from "./processor-samples-site-reference.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const audioInputAmendments = JSON.parse(readFileSync(new URL("../../docs/audio-input-runtime-changes.json", import.meta.url), "utf8"));

export function restoreAudioInput(source, file) {
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of audioInputAmendments.changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exact shared input amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}

/** Historical layout proofs read the exact pre-input bytes; fixtures stay frozen. */
export async function readAudioInputReference(file, encoding) {
  let source = await readFileAsync(file, encoding);
  const relative = path.relative(root, file instanceof URL ? fileURLToPath(file) : file);
  if (typeof source === "string") source = restoreBorrowedAudioContext(restoreSharedInstrumentContext(source, relative), relative);
  return typeof source === "string" ? restoreAudioInput(restoreNativeDelaySite(restoreLSystemLabSite(restoreMainOutputRouting(relative === "nav.js" ? source : restoreOutputRecording(source, relative), relative), relative), relative), relative) : source;
}
