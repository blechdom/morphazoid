import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

export const roachPerformanceChanges = JSON.parse(readFileSync(
  new URL("../../docs/roach-synth-performance-runtime-changes.json", import.meta.url), "utf8",
)).changes;

assert.deepEqual(roachPerformanceChanges.map(change => change.file), [
  "src/instruments/roach-synth/roach-synth-app.js",
  "src/instruments/roach-synth/roach-synth-audio.js",
  "src/instruments/roach-synth/roach-synth-body-engine.js",
  "src/instruments/roach-synth/roach-synth-body.js",
  "src/instruments/roach-synth/roach-synth-dsp.js",
  "src/instruments/roach-synth/roach-synth-midi-controls.js",
  "src/instruments/roach-synth/roach-synth-motion.js",
  "src/instruments/roach-synth/roach-synth-processor.js",
  "src/instruments/roach-synth/roach-synth-viewer.js",
  "src/site/instrument-catalog.js",
]);
for (const change of roachPerformanceChanges) {
  assert.match(change.reason, /^Owner-requested Roach Synth performance update:/);
  assert.ok(change.replacements.length > 0, change.file);
  assert.ok(change.regressionTests.length >= 2, change.file);
  for (const file of change.regressionTests) {
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), file);
  }
}

/** Reverse this exact performance update before older mobile/source migrations;
 * the relocation and independent instrument reference hashes remain frozen. */
export function restoreRoachPerformance(source, file) {
  for (const change of roachPerformanceChanges.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exactly one Roach performance amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
