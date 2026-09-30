import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const changes = JSON.parse(readFileSync(new URL("../../docs/hiccup-head-webcam-runtime-changes.json", import.meta.url), "utf8")).changes;
assert.deepEqual(changes.map(change => change.file), ["src/instruments/hiccup-head/hiccup-head-app.js"]);
for (const file of changes[0].regressionTests) assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), file);

/** Reverse the documented UI/capture amendment without changing the frozen references. */
export function restoreHiccupHeadWebcam(source, file) {
  for (const change of changes.filter(change => change.file === file)) {
    for (const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length - 1, 1, `${file}: exactly one webcam controls amendment`);
      source = source.replace(replacement.after, replacement.before);
    }
  }
  return source;
}
