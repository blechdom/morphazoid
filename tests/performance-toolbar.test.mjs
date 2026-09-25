import { restoreRubixoidsSite } from "./helpers/rubixoids-site-reference.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { restorePresetToolbar, toolbarAmendments } from "./helpers/preset-toolbar-reference.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("every implemented full-preset owner declares exactly one explicit preset host", async () => {
  const rollout = JSON.parse(await read("docs/preset-rollout-status.json"));
  for (const entry of rollout.entries.filter(entry => entry.status.startsWith("implemented-"))) {
    const html = await read(entry.href);
    assert.equal((html.match(/data-instrument-preset-host/g) ?? []).length, 1, entry.id);
    assert.match(html, entry.id === "shapes" ? /<header class="shapes-panel-header" data-instrument-preset-host/
      : entry.id === "puggler" ? /<div class="puggler-preset-host" data-instrument-preset-host/ // Owner-requested mobile reparenting.
      : /<aside[^>]+data-instrument-preset-host/, entry.id);
  }
});

test("navigation reverses only the exact requested UI changes to independently captured fresh main", async () => {
  const source = restoreRubixoidsSite(await read("nav.js"), "nav.js");
  const restored = restorePresetToolbar(source, "nav.js");
  assert.equal(createHash("sha256").update(restored).digest("hex"), toolbarAmendments.baseSha256);
  const block = toolbarAmendments.changes[0].replacements[0].after;
  assert.throws(() => restorePresetToolbar(source.replace(block, ""), "nav.js"));
  assert.throws(() => restorePresetToolbar(source + block, "nav.js"));
  for (const file of toolbarAmendments.changes[0].regressionTests) await read(file);
});

test("knob source and styles are explicitly shipped before commit", async () => {
  const manifest = await readRuntimeManifest();
  for (const file of ["src/ui/primitives/range-knob.js", "src/ui/primitives/range-knob.css"]) {
    assert.ok(manifest.worktreeFiles.includes(file), file);
    assert.ok(manifest.requiredFiles.includes(file), file);
  }
});
