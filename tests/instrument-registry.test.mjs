import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as registry from "../src/site/instrument-registry.js";
import { FAVE_TOOL_IDS, TOOL_GROUPS, SITE_LINKS, NAVIGATION_BASE_URL } from "../nav.js";
import { INSTRUMENTS, INSTRUMENT_GROUPS } from "../src/instrument-catalog.js";

const snapshot = JSON.parse(await readFile(new URL("./fixtures/instrument-registry-v1.json", import.meta.url)));

test("catalogue renaming preserves existing musical descriptions, features, and assets", async () => {
  const before = JSON.parse(await readFile(new URL("./fixtures/catalogue-before-20260918.json", import.meta.url)));
  const { instrumentById } = await import("../src/instrument-catalog.js");
  for (const previous of before.INSTRUMENTS) {
    const current = instrumentById(previous.id);
    assert.ok(current, previous.id);
    for (const key of ["description", "start", "kind", "features", "pluginHref", "imageHref"]) {
      assert.deepEqual(current[key], previous[key], `${previous.id}: ${key}`);
    }
  }
  assert.deepEqual(SITE_LINKS, before.registry.SITE_LINKS);
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
  const catalogueUrl = new URL("../src/instrument-catalog.js", import.meta.url).href;
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
