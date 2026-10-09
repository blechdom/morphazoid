import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chaoticAmRoutingAmendments, restoreChaoticAmRouting } from "./helpers/chaotic-am-routing-reference.mjs";

test("Chaotic AM routing reference preserves every unrelated byte and rejects partial or duplicated amendments", async () => {
  for (const change of chaoticAmRoutingAmendments.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
    const digest = value => createHash("sha256").update(restoreChaoticAmRouting(value, change.file)).digest("hex");
    assert.equal(digest(source), change.sha256, change.file);
    assert.notEqual(digest(source + "\n// unrelated drift\n"), change.sha256);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreChaoticAmRouting(source.replace(after, ""), change.file), /exact Chaotic AM routing amendment/);
      assert.throws(() => restoreChaoticAmRouting(source + after, change.file), /exact Chaotic AM routing amendment/);
    }
    const restored = restoreChaoticAmRouting(source, change.file);
    assert.equal(restoreChaoticAmRouting(restored, change.file, { allowRestored: true }), restored);
  }
});
