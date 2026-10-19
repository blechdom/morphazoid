import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { lSystemsEnsembleChanges, restoreLSystemsEnsemble } from "./helpers/l-systems-ensemble-reference.mjs";

test("L-Systems recovery reverses to the exact fresh-main controller without changing frozen fixtures", () => {
  assert.deepEqual(lSystemsEnsembleChanges.map(change => change.file), ["src/instruments/l-systems/l-systems-app.js"]);
  for (const change of lSystemsEnsembleChanges) {
    const source = readFileSync(new URL(`../${change.file}`, import.meta.url), "utf8");
    const restored = restoreLSystemsEnsemble(source, change.file);
    assert.equal(createHash("sha256").update(restored).digest("hex"), change.baselineSha256);
    assert.equal(restoreLSystemsEnsemble(restored, change.file, { allowRestored: true }), restored);
    for (const replacement of change.replacements) {
      assert.throws(() => restoreLSystemsEnsemble(source.replace(replacement.after, ""), change.file), /exact L-Systems ensemble amendment/);
      assert.throws(() => restoreLSystemsEnsemble(source + replacement.after, change.file), /exact L-Systems ensemble amendment/);
    }
  }
});
