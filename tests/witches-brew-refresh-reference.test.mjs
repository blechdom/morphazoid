import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { restoreOculoidSite } from "./helpers/oculoid-site-reference.mjs";
import { restoreWitchesBrewRefresh, witchesBrewRefreshAmendments } from "./helpers/witches-brew-refresh-reference.mjs";

const root = new URL("../", import.meta.url);
const digest = source => createHash("sha256").update(source).digest("hex");

// The captured Witch baseline predates Rig-a-Jig's procedural-rig removal.
// Restore that one reviewed row only for this historical hash comparison;
// shared restoration helpers continue to see the current mocap-only inventory.
function capturedInventory(source, file) {
  if (file !== "scripts/site/runtime-files.tsv") return source;
  const viewer = "copy+require\tsrc/instruments/rig-a-jig/rig-a-jig-viewer.js\n";
  const audio = "copy+require\tsrc/instruments/rig-a-jig/rig-a-jig-audio.js\n";
  const retired = "copy+require\tsrc/instruments/rig-a-jig/rig-a-jig-rigs.js\n";
  assert.equal(source.split(viewer + audio).length - 1, 1, "exact mocap-only Rig-a-Jig inventory");
  assert.equal(source.includes(retired), false, "procedural rigs remain retired");
  return source.replace(viewer + audio, viewer + retired + audio);
}

test("Witches Brew refresh restores the complete preceding source while retaining the original Witch", () => {
  assert.match(witchesBrewRefreshAmendments.baseCommit, /^[0-9a-f]{40}$/);
  for (const change of witchesBrewRefreshAmendments.changes) {
    const source = readFileSync(new URL(change.file, root), "utf8");
    const restored = restoreWitchesBrewRefresh(source, change.file);
    assert.equal(digest(capturedInventory(restoreOculoidSite(
      restored, change.file, { allowRestored: true },
    ), change.file)), change.sha256, change.file);
    assert.match(restored, /witch\.html|witch: define|src\/instruments\/witch\/witch-app\.js/);
    assert.equal(restoreWitchesBrewRefresh(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreWitchesBrewRefresh(restored, change.file), /exact Witches Brew refresh amendment/);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreWitchesBrewRefresh(source.replace(after, ""), change.file), /exact Witches Brew/);
      assert.throws(() => restoreWitchesBrewRefresh(source + after, change.file), /exact Witches Brew/);
    }
    const drift = "\n// unrelated source drift\n";
    assert.equal(restoreWitchesBrewRefresh(source + drift, change.file), restored + drift);
    assert.notEqual(digest(capturedInventory(restoreOculoidSite(
      restoreWitchesBrewRefresh(source + drift, change.file),
      change.file, { allowRestored: true },
    ), change.file)), change.sha256);
  }
  const binary = Buffer.from("raw bytes");
  assert.equal(restoreWitchesBrewRefresh(binary, "README.md"), binary);
  assert.equal(restoreWitchesBrewRefresh("untouched", "unrelated.js"), "untouched");
});
