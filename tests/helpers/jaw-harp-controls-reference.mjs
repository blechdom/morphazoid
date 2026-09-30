import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const changes = JSON.parse(readFileSync(new URL("../../docs/jaw-harp-controls-runtime-changes.json", import.meta.url), "utf8")).changes;

assert.deepEqual(changes.map(change => change.file), ["src/instruments/jaw-harp/jaw-harp-app.js"]);
assert.deepEqual(changes[0].regressionTests, ["tests/jaw-harp.test.mjs", "e2e/jaw-harp.spec.mjs"]);
for (const file of changes[0].regressionTests) {
  assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), file);
}

/** Reverse only the documented UI wiring; keep the historical DSP/gesture references frozen. */
export function restoreJawHarpControls(source, file) {
  for (const change of changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exactly one Jaw Harp controls amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
