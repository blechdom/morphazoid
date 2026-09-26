import { restoreHeaderInteractions, headerInteractionAmendments } from "./helpers/header-interactions-reference.mjs";
import { restoreRubixoidsSite, rubixoidsSiteAmendments } from "./helpers/rubixoids-site-reference.mjs";
import { restorePresetToolbar } from "./helpers/preset-toolbar-reference.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { rewriteModulePaths, rewriteRepositoryPaths } from "../scripts/architecture/module-paths.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { runtimeSourceFiles } from "../scripts/check-runtime-source.mjs";
import { localPath, referencesIn } from "../scripts/inspect-instrument.mjs";
import { restoreIphoneStartup } from "./helpers/iphone-startup-reference.mjs";
import { gesticulesMetadataAmendments, restoreGesticulesMetadata } from "./helpers/gesticules-metadata-reference.mjs";

const root = new URL("../", import.meta.url);
const plan = JSON.parse(await readFile(new URL("../docs/site-metadata-layout.json", import.meta.url)));
const proof = JSON.parse(await readFile(new URL("fixtures/site-metadata-layout.json", import.meta.url)));
const inverse = Object.fromEntries(Object.entries(plan.moves).map(([before, after]) => [after, before]));
const sha = source => createHash("sha256").update(source).digest("hex");

test("remaining flat JavaScript modules match the reviewed shared and toolchain boundaries", async () => {
  const previous = JSON.parse(await readFile(new URL("../docs/source-module-layout.json", import.meta.url)));
  const retained = [
    ...previous.retainedSharedModules.map(file => plan.moves[file] ?? file),
    ...plan.retainedRootAdditions,
  ].filter(file => /^src\/[^/]+\.js$/.test(file)).sort();
  assert.equal(new Set(retained).size, retained.length, "every retained root module has one declaration");
  const actual = (await readdir(new URL("src/", root), { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
    .map(entry => `src/${entry.name}`).sort();
  assert.deepEqual(actual, retained, "review ownership rather than adding instrument helpers to flat src/");
});

test("site metadata has one owner, with required pre-commit packaging and syntax coverage", async () => {
  const inventory = await readRuntimeManifest();
  const syntax = await runtimeSourceFiles();
  assert.equal(new Set(Object.values(plan.moves)).size, Object.keys(plan.moves).length);
  for (const [before, after] of Object.entries(plan.moves)) {
    assert.equal(existsSync(new URL(before, root)), false, `${before}: no duplicate or forwarding stub`);
    assert.ok(existsSync(new URL(after, root)), after);
    assert.ok(inventory.worktreeFiles.includes(after), `${after}: pre-commit inclusion`);
    assert.ok(inventory.requiredFiles.includes(after), `${after}: required artifact`);
    assert.ok(syntax.includes(after), `${after}: syntax coverage`);
  }
});

test("every changed runtime module reverses byte-for-byte to the fresh-main reference", async () => {
  assert.equal(proof.baseCommit, plan.baseCommit);
  for (const [before, after] of Object.entries(plan.moves)) {
    assert.ok(proof.files.some(record => record.before === before && record.after === after));
  }
  for (const record of proof.files) {
    const current = await readFile(new URL(record.after, root), "utf8");
    const beforeGesticules = restoreGesticulesMetadata(restoreRubixoidsSite(restoreHeaderInteractions(current, record.after), record.after), record.after);
    const beforeIphone = restoreIphoneStartup(restorePresetToolbar(beforeGesticules, record.after), record.after);
    const restored = rewriteRepositoryPaths(rewriteModulePaths(beforeIphone, record.after, inverse), inverse);
    assert.equal(sha(restored), record.sha256, record.after);
    for (const reference of referencesIn(current, record.after)) {
      if (!["module", "module-url"].includes(reference.kind)) continue;
      const target = localPath(reference.reference, record.after);
      if (target) assert.ok(existsSync(new URL(target, root)), `${record.after} -> ${target}`);
    }
  }
});


test("Gesticules metadata amendments are exact and limited to its catalogue and MIDI additions", async () => {
  assert.equal(gesticulesMetadataAmendments.baseCommit, proof.baseCommit);
  assert.deepEqual(gesticulesMetadataAmendments.changes.map(change => change.file), [
    "src/site/instrument-catalog.js", "src/site/instrument-midi-capabilities.js",
  ]);
  for (const change of gesticulesMetadataAmendments.changes) {
    assert.ok(proof.files.some(record => record.after === change.file));
    assert.equal(change.replacements.length, 1);
    assert.ok(change.regressionTests.length >= 2);
    for (const file of change.regressionTests) await readFile(new URL(file, root));
    const source = await readFile(new URL(change.file, root), "utf8");
    const restored = restoreGesticulesMetadata(source, change.file);
    assert.notEqual(restored, source);
    for (const replacement of change.replacements) {
      assert.ok(replacement.before.length && replacement.after.length);
      assert.doesNotMatch(replacement.before, /gesticulating-hand/);
      assert.match(replacement.after, /gesticulating-hand/);
      assert.throws(() => restoreGesticulesMetadata(source.replace(replacement.after, ""), change.file), /exact Gesticules metadata amendment/);
      assert.throws(() => restoreGesticulesMetadata(source + replacement.after, change.file), /exact Gesticules metadata amendment/);
    }
  }
  assert.equal(restoreGesticulesMetadata("untouched", "unrelated.js"), "untouched");
});


test("Rubixoids site amendments retain exact, independently checked metadata and navigation references", async () => {
  assert.deepEqual(rubixoidsSiteAmendments.changes.map(change => change.file), [
    "nav.js", "src/site/instrument-catalog.js", "src/site/instrument-midi-capabilities.js",
  ]);
  for (const change of rubixoidsSiteAmendments.changes) {
    assert.ok(proof.files.some(record => record.after === change.file), change.file);
    assert.ok(change.regressionTests.length >= 2);
    for (const file of change.regressionTests) await readFile(new URL(file, root));
    const source = await readFile(new URL(change.file, root), "utf8");
    assert.notEqual(restoreRubixoidsSite(source, change.file), source);
    for (const replacement of change.replacements) {
      assert.ok(replacement.before.length && replacement.after.length);
      assert.notEqual(replacement.before, replacement.after);
      assert.throws(() => restoreRubixoidsSite(source.replace(replacement.after, ""), change.file), /exact Rubixoids site amendment/);
      assert.throws(() => restoreRubixoidsSite(source + replacement.after, change.file), /exact Rubixoids site amendment/);
    }
  }
  assert.equal(restoreRubixoidsSite("untouched", "unrelated.js"), "untouched");
});

test("header-interaction amendments preserve the frozen navigation baseline with focused evidence", async () => {
  assert.deepEqual(headerInteractionAmendments.changes.map(change => change.file), ["nav.js"]);
  for (const change of headerInteractionAmendments.changes) {
    assert.ok(proof.files.some(record => record.after === change.file));
    assert.ok(change.replacements.length > 0);
    for (const file of change.regressionTests) await readFile(new URL(file, root));
    const current = await readFile(new URL(change.file, root), "utf8");
    assert.notEqual(restoreHeaderInteractions(current, change.file), current);
    const first = change.replacements[0];
    assert.throws(() => restoreHeaderInteractions(current.replace(first.after, ""), change.file), /exact header-interaction amendment/);
    assert.throws(() => restoreHeaderInteractions(current + first.after, change.file), /exact header-interaction amendment/);
  }
  assert.equal(restoreHeaderInteractions("untouched", "unrelated.js"), "untouched");
});
