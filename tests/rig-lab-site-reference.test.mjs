import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rigLabSiteChanges, restoreRigLabSite } from "./helpers/rig-lab-site-reference.mjs";

const root = new URL("../", import.meta.url);
const sha256 = source => createHash("sha256").update(source).digest("hex");

test("Rig Lab registrations reverse exactly to the preceding site and runtime inventory", async () => {
  assert.equal(rigLabSiteChanges.baseCommit, "24fb74c4426fcc1f598c5891878f12b397de7996");
  assert.deepEqual(rigLabSiteChanges.changes.map(change => change.file), [
    "README.md",
    "scripts/site/runtime-files.tsv",
    "docs/THIRD_PARTY_NOTICES.md",
    "src/pages/manifest.js",
    "src/site/catalogue-taxonomy.js",
    "src/site/instrument-registry.js",
  ]);
  for (const change of rigLabSiteChanges.changes) {
    const source = await readFile(new URL(change.file, root), "utf8");
    const restored = restoreRigLabSite(source, change.file);
    assert.equal(sha256(restored), change.sha256, change.file);
    assert.equal(restoreRigLabSite(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreRigLabSite(restored, change.file), /exact Rig Lab WIP amendment/);
    for (const { before, after } of change.replacements) {
      assert.equal(source.split(after).length - 1, 1, change.file);
      assert.throws(() => restoreRigLabSite(source + after, change.file), /exact Rig Lab WIP amendment/);
      assert.throws(
        () => restoreRigLabSite(source.replace(after, before), change.file),
        /exact Rig Lab WIP amendment/,
      );
    }
    const drift = "\n// unrelated site drift\n";
    assert.equal(restoreRigLabSite(source + drift, change.file), restored + drift);
    assert.notEqual(sha256(restoreRigLabSite(source + drift, change.file)), change.sha256);
  }
  const buffer = Buffer.from("opaque binary");
  assert.equal(restoreRigLabSite(buffer, "scripts/site/runtime-files.tsv"), buffer);
  assert.equal(restoreRigLabSite("unrelated", "another.js"), "unrelated");
});
