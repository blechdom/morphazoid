import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { selectedInstrumentRecoveryChanges, restoreSelectedInstrumentRecovery } from "./helpers/selected-instrument-recovery-reference.mjs";
import { restoreGlobuleDamacySite } from "./helpers/globule-damacy-site-reference.mjs";
import { restoreWitchesBrewRefresh } from "./helpers/witches-brew-refresh-reference.mjs";
import { restoreOculoidSite } from "./helpers/oculoid-site-reference.mjs";

test("selected instrument recovery preserves exact pre-recovery sources and frozen historical fixtures", () => {
  for (const change of selectedInstrumentRecoveryChanges) {
    const current = restoreWitchesBrewRefresh(restoreOculoidSite(
      readFileSync(new URL(`../${change.file}`, import.meta.url), "utf8"),
      change.file, { allowRestored: true },
    ), change.file);
    let source = restoreGlobuleDamacySite(current, change.file, { allowRestored: true });
    if (change.file === "scripts/site/runtime-files.tsv") {
      // Witch's later hand adapter is independently checked by its exact site
      // amendment. The frozen recovery baseline already contains original Witch.
      const handAdapter = "copy+require\tsrc/instruments/witch/witch-hand.js\n";
      assert.equal(source.split(handAdapter).length - 1, 1);
      source = source.replace(handAdapter, "");
    }
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
