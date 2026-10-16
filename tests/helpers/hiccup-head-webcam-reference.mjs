import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const changes = JSON.parse(readFileSync(new URL("../../docs/hiccup-head-webcam-runtime-changes.json", import.meta.url), "utf8")).changes;
assert.deepEqual(changes.map(change => change.file), ["src/instruments/hiccup-head/hiccup-head-app.js"]);
for (const file of changes[0].regressionTests) assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), file);

/** Reverse the documented UI/capture amendment without changing the frozen references. */
export function restoreHiccupHeadWebcam(source, file) {
  source = restoreWipRolloutSite(source, file, { allowRestored: true });
  source = restoreMicInputBatchSite(source, file, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  for (const change of changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exactly one webcam controls amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
