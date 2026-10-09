import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { recursivePresetAmendments, restoreRecursivePresets } from "./helpers/recursive-presets-reference.mjs";

test("Recursive preset migration preserves every unrelated byte and rejects partial or duplicated amendments", async () => {
  for (const change of recursivePresetAmendments.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
    const digest = value => createHash("sha256").update(restoreRecursivePresets(value, change.file)).digest("hex");
    assert.equal(digest(source), change.sha256, change.file);
    assert.notEqual(digest(source + "\n// unrelated drift\n"), change.sha256);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreRecursivePresets(source.replace(after, ""), change.file), /exact Recursive preset amendment/);
      assert.throws(() => restoreRecursivePresets(source + after, change.file), /exact Recursive preset amendment/);
    }
    const restored = restoreRecursivePresets(source, change.file);
    assert.equal(restoreRecursivePresets(restored, change.file, { allowRestored: true }), restored);
  }
});
