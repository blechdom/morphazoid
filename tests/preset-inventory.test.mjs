import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CATALOGUE_ITEMS } from "../src/instrument-catalog.js";
import { collectPresetInventory, inventoryMarkdown, localDependency, presetMarkupCandidates } from "../scripts/presets/inventory.mjs";

test("preset inventory follows local source references without evaluating page code", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "morphazoid-preset-inventory-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "example.html"), `<script src="nav.js"></script><script type="module" src="src/app.js"></script>
      <select id="bodyPreset"></select><select id="patternSelect"></select><div id="presetGrid"></div>
      <!-- <select id="oldPreset"></select> --><select id="midiInput"></select>`);
    await writeFile(path.join(root, "src/app.js"), `import { EXAMPLE_PRESETS } from "./model.js?v=1";
      throw new Error("An inventory must never execute me");
      const foreign = import("https://not-local.invalid/foreign.js");`);
    await writeFile(path.join(root, "src/model.js"), "export const EXAMPLE_PRESETS = [];");
    const report = await collectPresetInventory({ root, items: [{ id: "example", label: "Example", href: "example.html" }] });
    assert.deepEqual(report.rows[0].entries, ["src/app.js"]);
    assert.deepEqual(report.rows[0].markupCandidates.map(c => c.id), ["bodyPreset", "patternSelect", "presetGrid"]);
    assert.equal(report.rows[0].sourceCandidates.some(c => c.file === "src/model.js"), true);
    assert.equal(report.rows[0].fullPresetCount, null);
    assert.equal(report.rows[0].headerMigrated, false);
    assert.match(inventoryMarkdown(report), /Not migrated/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preset discovery does not guess from navigation fields or non-local URLs", () => {
  assert.deepEqual(presetMarkupCandidates('<select id="midiOutput"></select><button id="playButton">Play</button>'), []);
  assert.equal(localDependency("https://example.invalid/presets.js", "index.html"), null);
  assert.equal(localDependency("some-package", "src/app.js"), null);
  assert.equal(localDependency("./bad%2fpath.js", "src/app.js"), null);
  assert.equal(localDependency("../../model.js?v=1", "src/instruments/demo/app.js"), "src/model.js");
});

test("the inventory accounts for every current entry without claiming completed preset work", async () => {
  const report = await collectPresetInventory();
  assert.deepEqual(report.rows.map(row => row.id), CATALOGUE_ITEMS.map(item => item.id));
  assert.equal(report.rows.every(row => row.fullPresetCount === null && !row.headerMigrated), true);
  for (const row of report.rows) {
    assert.deepEqual(row.missingSources, [], `${row.id}: missing source candidate`);
  }
});
