import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as registry from "../src/site/instrument-registry.js";
import { FAVE_TOOL_IDS, TOOL_GROUPS, SITE_LINKS, NAVIGATION_BASE_URL } from "../nav.js";
import { INSTRUMENTS, INSTRUMENT_GROUPS } from "../src/site/instrument-catalog.js";
import { removedInstrumentIds } from "./helpers/catalogue-plan.mjs";
import { restoreSynthesaurusIcon, synthesaurusIconChanges } from "./helpers/synthesaurus-icon-reference.mjs";

const snapshot = JSON.parse(await readFile(new URL("./fixtures/instrument-registry-v1.json", import.meta.url)));

test("Synthesaurus uses its dedicated dinosaur / synth / compendium icon", async () => {
  const tool = TOOL_GROUPS.flatMap(group => group.tools).find(item => item.id === "synthesis");
  assert.equal(tool.imageHref, "assets/instruments/synthesis.webp");
  const bytes = await readFile(new URL(`../${tool.imageHref}`, import.meta.url));
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  const manifest = await readFile(new URL("../scripts/site/runtime-files.tsv", import.meta.url), "utf8");
  assert.ok(manifest.split("\n").includes(`copy+require\t${tool.imageHref}`));
});

test("the Synthesaurus icon amendment preserves older catalogue evidence exactly", async () => {
  assert.deepEqual(synthesaurusIconChanges.map(change => change.file), ["src/site/instrument-registry.js"]);
  for (const change of synthesaurusIconChanges) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
    const restored = restoreSynthesaurusIcon(source, change.file);
    assert.notEqual(restored, source);
    assert.equal(change.replacements.length, 1);
    const { before, after } = change.replacements[0];
    assert.equal(restored.replace(before, after), source);
    assert.throws(() => restoreSynthesaurusIcon(source.replace(after, ""), change.file), /exact Synthesaurus icon amendment/);
    assert.throws(() => restoreSynthesaurusIcon(source + after, change.file), /exact Synthesaurus icon amendment/);
  }
  assert.equal(restoreSynthesaurusIcon("untouched", "unrelated.js"), "untouched");
});

test("Shapes leads Faves and Shape/Solid/Hyper remain only in Geometric", () => {
  assert.equal(FAVE_TOOL_IDS[0], "shapes");
  for (const id of ["shape-synth", "solid-synth", "hyper-synth"]) {
    assert.equal(FAVE_TOOL_IDS.includes(id), false);
    assert.deepEqual(TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === id)).map(group => group.id), ["geometric"]);
    assert.equal(INSTRUMENTS.find(tool => tool.id === id).tags.some(tag => tag.id === "faves"), false);
  }
});

test("catalogue renaming preserves existing musical descriptions, features, and assets", async () => {
  const before = JSON.parse(await readFile(new URL("./fixtures/catalogue-before-20260918.json", import.meta.url)));
  // Main's loop-network update postdates the owner-sheet baseline. Preserve
  // its new descriptions without rewriting the historical fixture.
  const { updates } = JSON.parse(await readFile(new URL("./fixtures/catalogue-main-e042512.json", import.meta.url)));
  const main = JSON.parse(await readFile(new URL("./fixtures/catalogue-main-d96793a.json", import.meta.url)));
  const { instrumentById } = await import("../src/site/instrument-catalog.js");
  const spelling = JSON.parse(await readFile(new URL("./fixtures/catalogue-spelling-20260930.json", import.meta.url)));
  const voices = JSON.parse(await readFile(new URL("./fixtures/catalogue-voicesaurus.json", import.meta.url)));
  const fabric = JSON.parse(await readFile(new URL("./fixtures/catalogue-fabric-filter-input.json", import.meta.url)));
  for (const previous of before.INSTRUMENTS) {
    if (removedInstrumentIds.has(previous.id)) continue;
    const current = instrumentById(previous.id);
    const expected = { ...previous, ...updates[previous.id], ...main.updates[previous.id], ...spelling.updates[previous.id], ...voices.updates[previous.id], ...fabric.updates[previous.id] };
    assert.ok(current, previous.id);
    for (const key of ["description", "start", "kind", "features", "pluginHref", "imageHref"]) {
      assert.deepEqual(current[key], expected[key], `${previous.id}: ${key}`);
    }
  }
  assert.deepEqual(SITE_LINKS, before.registry.SITE_LINKS);
  for (const item of main.additions) {
    const current = instrumentById(item.id);
    assert.ok(current, `${item.id}: main addition survives`);
    for (const key of ["description", "start", "kind", "imageHref"]) assert.equal(current[key], item[key], `${item.id}: ${key}`);
    assert.equal(current.status, "Work in Progress");
  }
});

test("navigation retains its exports, immutable records, and published-root URL semantics", () => {
  assert.equal(FAVE_TOOL_IDS, registry.FAVE_TOOL_IDS);
  assert.equal(TOOL_GROUPS, registry.TOOL_GROUPS);
  assert.equal(SITE_LINKS, registry.SITE_LINKS);
  assert.equal(NAVIGATION_BASE_URL, new URL("../", import.meta.url).href);
  assert.ok(Object.isFrozen(FAVE_TOOL_IDS));
  assert.ok(Object.isFrozen(TOOL_GROUPS));
  for (const group of TOOL_GROUPS) {
    assert.ok(Object.isFrozen(group));
    assert.ok(Object.isFrozen(group.tools));
    assert.ok(group.tools.every(Object.isFrozen));
  }
});

test("cold registry/catalogue imports do not touch browser globals, storage, or audio", () => {
  const registryUrl = new URL("../src/site/instrument-registry.js", import.meta.url).href;
  const catalogueUrl = new URL("../src/site/instrument-catalog.js", import.meta.url).href;
  const script = `
    for (const name of ["document", "window", "navigator", "localStorage", "sessionStorage", "AudioContext", "AudioWorkletNode"]) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error("Data import accessed " + name); }
      });
    }
    await import(${JSON.stringify(registryUrl)});
    const { INSTRUMENTS } = await import(${JSON.stringify(catalogueUrl)});
    if (!INSTRUMENTS.length) throw new Error("Empty catalogue");
    console.log("pure");
  `;
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
  }).trim(), "pure");
});
