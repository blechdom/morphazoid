import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rewriteModulePaths, rewriteRepositoryPaths, relocateReference } from "../scripts/architecture/module-paths.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { restorePointerExtraction } from "./helpers/pointer-extraction-reference.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const plan = JSON.parse(await readFile(new URL("../docs/source-module-layout.json", import.meta.url)));
const siteMoves = JSON.parse(await readFile(new URL("../docs/site-metadata-layout.json", import.meta.url))).moves;
const proof = JSON.parse(await readFile(new URL("fixtures/module-hierarchy-runtime.json", import.meta.url)));
const ioChanges = JSON.parse(await readFile(new URL("../docs/io-settings-runtime-changes.json", import.meta.url))).changes;
const iphoneChanges = JSON.parse(await readFile(new URL("../docs/iphone-audio-runtime-changes.json", import.meta.url))).changes;
const inverse = Object.fromEntries(Object.entries({ ...plan.moves, ...siteMoves }).map(([before, after]) => [after, before]));
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
  for (const file of plan.retainedSharedModules) assert.ok((await stat(path.join(root, siteMoves[file] ?? file))).isFile(), file);
});

test("runtime modules reverse exactly after explicit runtime fixes, stereo-input and iPhone startup additions", async () => {
  assert.deepEqual(plan.reviewedRuntimeFixes.map(fix => fix.file), [
    "src/instruments/shepard-risset/shepard-risset-app.js",
    "src/instruments/spider-synth/spider-synth-app.js",
    "src/instruments/spider-synth/spider-synth-viewer.js",
    "src/families/proto-graph/proto-shell.js",
  ]);
  for (const record of proof.files) {
    let current = restorePointerExtraction(
      await readFile(path.join(root, record.after), "utf8"), record.after,
    );
    for (const change of iphoneChanges.filter(change => change.file === record.after)) {
      for (const testFile of change.regressionTests) assert.ok(existsSync(path.join(root, testFile)), testFile);
      for (const replacement of [...change.replacements].reverse()) {
        assert.equal(current.split(replacement.after).length - 1, 1, `exactly one iPhone startup edit: ${change.file}`);
        current = current.replace(replacement.after, replacement.before);
      }
    }
    // Keep the relocation baseline frozen. Reverse only the exact, separately
    // documented feature edits, whose behavior has focused DSP/browser tests.
    for (const change of ioChanges.filter(change => change.file === record.after)) {
      for (const testFile of change.regressionTests) assert.ok(existsSync(path.join(root, testFile)), testFile);
      for (const replacement of [...change.replacements].reverse()) {
        assert.equal(current.split(replacement.after).length - 1, 1, `exactly one reviewed I/O edit: ${change.file}`);
        current = current.replace(replacement.after, replacement.before);
      }
    }
    for (const fix of plan.reviewedRuntimeFixes.filter(fix => fix.file === record.after)) {
      assert.equal(current.split(fix.after).length - 1, 1, `exactly one reviewed fix: ${fix.file}`);
      assert.ok(existsSync(path.join(root, fix.regressionTest)), fix.regressionTest);
      current = current.replace(fix.after, fix.before);
    }
    const restored = rewriteRepositoryPaths(rewriteModulePaths(current, record.after, inverse), inverse);
    assert.equal(sha(restored), record.sha256, record.after);
  }
});

test("iPhone amendments are scoped to the four startup controllers, with regression evidence", () => {
  assert.deepEqual(iphoneChanges.map(change => change.file).sort(), [
    "src/families/syrinx/syrinx-app.js",
    "src/instruments/julie-saw/julie-saw-app.js",
    "src/instruments/morphynx/morphynx-app.js",
    "src/instruments/shapes/shapes-app.js",
  ]);
  for (const change of iphoneChanges) {
    assert.ok(proof.files.some(record => record.after === change.file));
    assert.match(change.reason, /iPhone/);
    assert.ok(change.replacements.length > 0);
    assert.deepEqual(change.regressionTests, ["tests/audio-startup.test.mjs", "e2e/iphone-audio-startup.spec.mjs"]);
  }
});
test("stereo-input amendments identify existing modules and focused regression evidence", () => {
  assert.equal(new Set(ioChanges.map(change => change.file)).size, ioChanges.length);
  for (const change of ioChanges) {
    assert.ok(proof.files.some(record => record.after === change.file), change.file);
    assert.match(change.reason, /stereo/);
    assert.ok(change.replacements.length > 0, change.file);
    assert.deepEqual(change.regressionTests, ["tests/stereo-audio-input.test.mjs", "e2e/io-settings.spec.mjs"]);
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
