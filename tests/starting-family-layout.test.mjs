import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rewriteModulePaths, rewriteRepositoryPaths } from "../scripts/architecture/module-paths.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { runtimeSourceFiles } from "../scripts/check-runtime-source.mjs";
import { localPath, referencesIn } from "../scripts/inspect-instrument.mjs";

const root = new URL("../", import.meta.url);
const plan = JSON.parse(await readFile(new URL("../docs/starting-family-layout.json", import.meta.url)));
const proof = JSON.parse(await readFile(new URL("fixtures/starting-family-layout.json", import.meta.url)));
const inverse = Object.fromEntries(Object.entries(plan.moves).map(([before, after]) => [after, before]));
const sha = source => createHash("sha256").update(source).digest("hex");

test("starting runtime has one family owner without changing optional copy policy", async () => {
  const manifest = await readRuntimeManifest();
  const syntax = await runtimeSourceFiles();
  assert.equal(new Set(Object.values(plan.moves)).size, Object.keys(plan.moves).length);
  for (const [before, after] of Object.entries(plan.moves)) {
    assert.equal(existsSync(new URL(before, root)), false, before);
    assert.ok(existsSync(new URL(after, root)), after);
    assert.equal(manifest.entries.find(entry => entry.path === after)?.policy, "copy", after);
    assert.ok(syntax.includes(after), after);
    assert.ok(proof.files.some(record => record.before === before && record.after === after), before);
  }
});

test("all family DSP, presets, worklet and controller bytes survive path reversal", async () => {
  assert.equal(proof.baseCommit, plan.baseCommit);
  for (const record of proof.files) {
    const current = await readFile(new URL(record.after, root), "utf8");
    const restored = rewriteRepositoryPaths(rewriteModulePaths(current, record.after, inverse), inverse);
    assert.equal(sha(restored), record.sha256, record.after);
    for (const reference of referencesIn(current, record.after)) {
      if (!["module", "module-url"].includes(reference.kind)) continue;
      const target = localPath(reference.reference, record.after);
      if (target) assert.ok(existsSync(new URL(target, root)), `${record.after} -> ${target}`);
    }
  }
});
