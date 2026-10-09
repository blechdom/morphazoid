import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TOOL_GROUPS, FAVE_TOOL_IDS } from "../src/site/instrument-registry.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { CANONICAL_PAGE_ROUTES, pageSourcePath } from "../src/pages/manifest.js";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { spartialSiteChanges, restoreSpartialSite } from "./helpers/spartial-site-reference.mjs";
import { restoreAmInstrumentAdditions } from "./helpers/am-instruments-reference.mjs";

const root = new URL("../", import.meta.url);

test("SPARTIAL metadata additions preserve the independently captured published catalogue", async () => {
  assert.equal(spartialSiteChanges.baseCommit, "fde095d18c662e9f91d10de35934109b4c935d50");
  assert.deepEqual(spartialSiteChanges.changes.map(change => change.file), [
    "src/site/instrument-registry.js", "src/site/instrument-catalog.js",
    "src/site/catalogue-taxonomy.js", "src/site/instrument-midi-capabilities.js",
  ]);
  for (const change of spartialSiteChanges.changes) {
    const source = restoreAmInstrumentAdditions(
      await readFile(new URL(change.file, root), "utf8"), change.file,
    );
    const preserved = candidate => assert.equal(
      createHash("sha256").update(restoreSpartialSite(candidate, change.file)).digest("hex"),
      change.sha256, `${change.file}: pre-SPARTIAL source preserved`,
    );
    preserved(source);
    for (const addition of change.additions) {
      assert.match(addition, /spartial/);
      assert.throws(() => restoreSpartialSite(source.replace(addition, ""), change.file), /exact SPARTIAL addition/);
      assert.throws(() => restoreSpartialSite(source + addition, change.file), /exact SPARTIAL addition/);
    }
    assert.throws(() => preserved(source + "\n// unrelated drift\n"), /pre-SPARTIAL source preserved/);
    for (const filename of change.regressionTests) await readFile(new URL(filename, root));
  }
  assert.equal(restoreSpartialSite("untouched", "unrelated.js"), "untouched");
});

test("SPARTIAL is a pitched page-owned keyboard instrument beside Surround for Safety", async () => {
  const groups = TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === "spartial"));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "dispersion");
  const ids = groups[0].tools.map(tool => tool.id);
  assert.equal(ids.indexOf("spartial"), ids.indexOf("surround-field") + 1);
  assert.equal(FAVE_TOOL_IDS.includes("spartial"), false);
  assert.deepEqual(instrumentMidiCapabilityForId("spartial"), {
    id: "spartial", midiInput: true, midiInputMode: "universal-control",
    noteMode: "pitched", audioInput: false, midiOutput: false,
    startsAudio: true, computerKeyboardMode: "page",
  });
  const item = instrumentById("spartial");
  assert.deepEqual(item.tags.map(tag => tag.id), ["dispersion", "surround", "spatial", "synthesizer"]);
  assert.equal(item.status, null);
  assert.equal(item.href, "spartial.html");
  assert.ok(CANONICAL_PAGE_ROUTES.includes(item.href));
  const html = await readFile(new URL(pageSourcePath(item.href), root), "utf8");
  const inventory = await readRuntimeManifest();
  for (const file of [
    "src/instruments/spartial/spartial-app.js", "src/instruments/spartial/spartial.css",
  ]) {
    assert.ok(html.includes(file), `${file}: canonical page reference`);
    assert.ok(inventory.requiredFiles.includes(file), `${file}: required build input`);
  }
  assert.ok(inventory.worktreeFiles.includes(item.href));
  assert.ok(inventory.worktreeFiles.includes(item.imageHref));
});
