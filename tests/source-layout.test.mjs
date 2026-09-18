import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

import { localPath, referencesIn, inspectInstrument } from "../scripts/inspect-instrument.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { runtimeSourceFiles } from "../scripts/check-runtime-source.mjs";
import { relocatedSources } from "./helpers/relocated-sources.mjs";

const root = new URL("../", import.meta.url);

test("relocated controllers are real source files, required build inputs and syntax targets", async () => {
  const inventory = await readRuntimeManifest();
  const syntax = await runtimeSourceFiles();
  for (const [former, current] of Object.entries(relocatedSources)) {
    assert.ok((await stat(new URL(current, root))).isFile(), current);
    await assert.rejects(stat(new URL(former, root)), { code: "ENOENT" }, former);
    assert.ok(inventory.worktreeFiles.includes(current), `${current}: pre-commit inclusion`);
    assert.ok(inventory.requiredFiles.includes(current), `${current}: required artifact path`);
    assert.ok(syntax.includes(current), `${current}: syntax coverage`);
    const source = await readFile(new URL(current, root), "utf8");
    for (const reference of referencesIn(source, current)) {
      if (!["module", "module-url"].includes(reference.kind)) continue;
      const target = localPath(reference.reference, current);
      if (target === null) continue;
      assert.ok((await stat(new URL(target, root))).isFile(), `${current} -> ${target}`);
    }
  }
});

test("authored pages reference existing relocated controllers/styles rather than removed root files", async () => {
  const inventory = await readRuntimeManifest();
  const encountered = new Set();
  for (const filename of (await readdir(root)).filter(name => name.endsWith(".html"))) {
    const html = await readFile(new URL(filename, root), "utf8");
    for (const reference of referencesIn(html, filename)) {
      if (!["entry-script", "page-asset"].includes(reference.kind)) continue;
      const target = localPath(reference.reference, filename);
      if (target === null) continue;
      assert.equal(Object.hasOwn(relocatedSources, target), false, `${filename}: stale ${target}`);
      if (!target.startsWith("src/instruments/") && !target.startsWith("src/families/")) continue;
      assert.ok((await stat(new URL(target, root))).isFile(), `${filename}: ${target}`);
      assert.ok(inventory.requiredFiles.includes(target), `${target}: required shipped resource`);
      encountered.add(target);
    }
  }
  for (const current of Object.values(relocatedSources)) assert.ok(encountered.has(current), current);
});

test("read-only instrument inspection follows nested entries and retains family test suggestions", async () => {
  const report = await inspectInstrument("moebius");
  assert.ok(report.entries.includes(relocatedSources["nonorientable-app.js"]));
  assert.ok(report.files.some(file => file.path === relocatedSources["nonorientable-app.js"] && file.present));
  assert.ok(report.tests.candidates.some(file => file.includes("nonorientable")));
});
