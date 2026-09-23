import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { rewriteModulePaths, rewriteRepositoryPaths } from "../scripts/architecture/module-paths.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { runtimeSourceFiles } from "../scripts/check-runtime-source.mjs";
import { localPath, referencesIn } from "../scripts/inspect-instrument.mjs";
import { currentSourcePath } from "./helpers/relocated-sources.mjs";

const root = new URL("../", import.meta.url);
const plan = JSON.parse(await readFile(new URL("../docs/prototype-family-layout.json", import.meta.url)));
const proof = JSON.parse(await readFile(new URL("fixtures/prototype-family-layout.json", import.meta.url)));
const inverse = Object.fromEntries(Object.entries(plan.moves).map(([before, after]) => [after, before]));
const sha = source => createHash("sha256").update(source).digest("hex");

test("the prototype family has one new home and retains its exact packaging policies", async () => {
  const manifest = await readRuntimeManifest();
  const syntax = await runtimeSourceFiles();
  assert.equal(new Set(Object.values(plan.moves)).size, Object.keys(plan.moves).length);
  assert.equal(existsSync(new URL("src/families/starting-instruments/", root)), false);
  for (const [before, after] of Object.entries(plan.moves)) {
    assert.equal(existsSync(new URL(before, root)), false, before);
    assert.ok(existsSync(new URL(after, root)), after);
    const original = proof.files.find(record => record.before === before && record.after === after);
    assert.ok(original, before);
    assert.equal(manifest.entries.find(entry => entry.path === after)?.policy, original.manifestPolicy, after);
    if (after.endsWith(".js")) assert.ok(syntax.includes(after), after);
  }
});

test("all runtime/styles/page bytes reverse exactly except the two requested group labels", async () => {
  assert.equal(proof.baseCommit, plan.baseCommit);
  for (const record of proof.files) {
    const current = await readFile(new URL(record.after, root), "utf8");
    let restored = rewriteRepositoryPaths(rewriteModulePaths(current, record.after, inverse), inverse);
    if (plan.pages.includes(record.after)) {
      for (const change of plan.visibleTextChanges) {
        assert.equal(restored.split(change.after).length - 1, 1, `${record.after}: ${change.after}`);
        restored = restored.replace(change.after, change.before);
      }
    }
    assert.equal(sha(restored), record.sha256, record.after);
    for (const reference of referencesIn(current, record.after)) {
      if (!["module", "module-url", "entry-script", "page-asset"].includes(reference.kind)) continue;
      const target = localPath(reference.reference, record.after);
      if (target) assert.ok(existsSync(new URL(target, root)), `${record.after} -> ${target}`);
    }
  }
});

test("public routes and legacy audio/DOM identities stay stable while group labels change", async () => {
  for (const page of plan.pages) {
    const html = await readFile(new URL(page, root), "utf8");
    const id = page.replace(/\.html$/, "");
    assert.ok(html.includes(`data-starting-instrument="${id}"`), page);
    assert.ok(html.includes('href="docs/starting-instruments.md"'), page);
    assert.ok(html.includes("About this work-in-progress instrument"), page);
    assert.ok(html.includes('aria-label="Other work-in-progress instruments"'), page);
    assert.ok(html.includes("src/families/work-in-progress/"), page);
  }
  const processor = await readFile(new URL("src/families/work-in-progress/processor.js", root), "utf8");
  assert.ok(processor.includes('registerProcessor("morphazoid-starting-instrument"'));
  const audio = await readFile(new URL("src/families/work-in-progress/audio.js", root), "utf8");
  assert.ok(audio.includes("export class StartingAudio"));
});

test("historical source lookup composes both directory moves without rewriting old fixtures", () => {
  for (const file of ["src/starting-instruments/audio.js", "src/families/starting-instruments/audio.js"]) {
    assert.equal(currentSourcePath(file), "src/families/work-in-progress/audio.js");
  }
  assert.equal(currentSourcePath("loop-network-app.js"), "src/families/work-in-progress/loop-network-app.js");
  assert.equal(currentSourcePath("src/families/starting-instruments/starting-instruments-app.js"),
    "src/families/work-in-progress/work-in-progress-app.js");
});

test("every authored root page uses the renamed resource paths, including stylesheet consumers", async () => {
  for (const filename of (await readdir(root)).filter(name => name.endsWith(".html"))) {
    const html = await readFile(new URL(filename, root), "utf8");
    assert.ok(!html.includes("src/families/starting-instruments/"), filename);
  }
  for (const filename of plan.dependentPages) {
    const html = await readFile(new URL(filename, root), "utf8");
    assert.ok(html.includes("src/families/work-in-progress/work-in-progress.css"), filename);
    assert.ok(proof.files.some(record => record.after === filename), filename);
  }
});
