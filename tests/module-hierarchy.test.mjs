import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rewriteModulePaths, rewriteRepositoryPaths, relocateReference } from "../scripts/architecture/module-paths.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const plan = JSON.parse(await readFile(new URL("../docs/source-module-layout.json", import.meta.url)));
const proof = JSON.parse(await readFile(new URL("fixtures/module-hierarchy-runtime.json", import.meta.url)));
const inverse = Object.fromEntries(Object.entries(plan.moves).map(([before, after]) => [after, before]));
const sha = value => createHash("sha256").update(value).digest("hex");

test("all relocated instrument modules have one owner and explicit release inclusion", async () => {
  const inventory = await readRuntimeManifest();
  assert.equal(new Set(Object.values(plan.moves)).size, Object.keys(plan.moves).length);
  for (const [before, after] of Object.entries(plan.moves)) {
    assert.match(after, /^src\/(?:instruments|families)\/[^/]+\//);
    assert.equal(existsSync(path.join(root, before)), false, before);
    assert.ok((await stat(path.join(root, after))).isFile(), after);
    assert.ok(inventory.worktreeFiles.includes(after), `pre-commit build inclusion: ${after}`);
  }
  for (const file of plan.retainedSharedModules) assert.ok((await stat(path.join(root, file))).isFile(), file);
});

test("runtime modules reverse exactly apart from the reviewed Shepard selector and Spider asset-base/download fixes", async () => {
  assert.deepEqual(plan.reviewedRuntimeFixes.map(fix => fix.file), [
    "src/instruments/shepard-risset/shepard-risset-app.js",
    "src/instruments/spider-synth/spider-synth-app.js",
    "src/instruments/spider-synth/spider-synth-viewer.js",
  ]);
  for (const record of proof.files) {
    let current = await readFile(path.join(root, record.after), "utf8");
    for (const fix of plan.reviewedRuntimeFixes.filter(fix => fix.file === record.after)) {
      assert.equal(current.split(fix.after).length - 1, 1, `exactly one reviewed fix: ${fix.file}`);
      assert.ok(existsSync(path.join(root, fix.regressionTest)), fix.regressionTest);
      current = current.replace(fix.after, fix.before);
    }
    const restored = rewriteRepositoryPaths(rewriteModulePaths(current, record.after, inverse), inverse);
    assert.equal(sha(restored), record.sha256, record.after);
  }
});

test("path rewriting preserves queries, templates, resources and non-path slash characters", () => {
  const moves = { "src/voice.js": "src/instruments/example/voice.js" };
  const exists = file => ["src/voice.js", "assets/samples/", "src/audio.js"].includes(file);
  assert.equal(relocateReference("../src/voice.js?v=123", "tests/example.test.mjs", moves, { exists }), "../src/instruments/example/voice.js?v=123");
  assert.equal(rewriteModulePaths("import(`../src/voice.js?test=${Date.now()}`)", "tests/a.mjs", moves, { exists }),
    "import(`../src/instruments/example/voice.js?test=${Date.now()}`)");
  assert.equal(rewriteModulePaths("new URL(`../assets/samples/${id}.wav`, import.meta.url)", "src/voice.js", moves, { exists }),
    "new URL(`../../../assets/samples/${id}.wav`, import.meta.url)");
  assert.equal(rewriteModulePaths('const key = "/"; const text = `/${id}/`;', "src/voice.js", moves, { exists }),
    'const key = "/"; const text = `/${id}/`;');
  assert.equal(relocateReference("./audio.js", "src/voice.js", moves, { exists }), "../../audio.js");
});
