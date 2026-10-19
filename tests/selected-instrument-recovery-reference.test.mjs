import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { selectedInstrumentRecoveryChanges, restoreSelectedInstrumentRecovery } from "./helpers/selected-instrument-recovery-reference.mjs";

test("selected instrument recovery preserves exact pre-recovery sources and frozen historical fixtures", () => {
  for (const change of selectedInstrumentRecoveryChanges) {
    const source = readFileSync(new URL(`../${change.file}`, import.meta.url), "utf8");
    for (const file of change.regressionTests) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
    const restored = restoreSelectedInstrumentRecovery(source, change.file);
    assert.equal(createHash("sha256").update(restored).digest("hex"), change.baselineSha256, change.file);
    assert.equal(restoreSelectedInstrumentRecovery(restored, change.file, { allowRestored: true }), restored);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreSelectedInstrumentRecovery(source.replace(after, ""), change.file), /exact selected instrument recovery amendment/);
      assert.throws(() => restoreSelectedInstrumentRecovery(source + after, change.file), /exact selected instrument recovery amendment/);
    }
  }
});
