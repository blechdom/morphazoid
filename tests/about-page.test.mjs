import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import { INSTRUMENT_GROUPS, INSTRUMENTS } from "../src/instrument-catalog.js";

const root = new URL("../", import.meta.url);

test("Home page is the About guide", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");

  assert.match(html, /<body class="about-page">/);
  assert.match(html, /<title>Morphazoid<\/title>/);
  assert.match(html, /<h1>Morphazoid<\/h1>/);
  assert.doesNotMatch(html, /Project (?:reference|guide)/i);
  assert.match(html, /href="\.\/" aria-current="page">about<\/a>/);
  assert.match(html, /href="instruments\.html">catalogue<\/a>/);
  assert.match(html, /id="homeInstrumentCatalogue"[\s\S]*?data-instrument-catalog/);
  assert.match(html, /src="instrument-catalog-app\.js"/);
  assert.match(html, /<dt>Instruments<\/dt><dd>72<\/dd>/);
  assert.match(html, /vibed up with Codex 5\.6 Sol Ultra, mostly/);
  assert.doesNotMatch(html, /manual-section-label">\d+/);
  assert.doesNotMatch(html, /class="page-entry"/);
  assert.doesNotMatch(html, /<script type="module" src="app\.js"><\/script>/);
});

test("About mounts the complete menu-ordered catalogue", async () => {
  const html = await readFile(new URL("about.html", root), "utf8");
  const catalogueGroups = TOOL_GROUPS
    .filter((group) => group.catalogue !== false)
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) => tool.catalogue !== false),
    }))
    .filter((group) => group.tools.length > 0);

  assert.match(html, /<title>Morphazoid<\/title>/);
  assert.match(html, /href="\.\/" aria-current="page">about<\/a>/);
  assert.match(html, /class="mobile-instrument-select"/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /data-instrument-catalog/);
  assert.equal(INSTRUMENTS.length, 72);
  assert.equal(
    INSTRUMENTS.find(({ id }) => id === "escher-tessellation")?.label,
    "Escher",
  );
  assert.deepEqual(
    INSTRUMENT_GROUPS.map(({ id, label, tools }) => ({
      id,
      label,
      tools: tools.map(({ id: toolId, label: toolLabel, href }) => ({
        id: toolId,
        label: toolLabel,
        href,
      })),
    })),
    catalogueGroups.map(({ id, label, tools }) => ({
      id,
      label,
      tools: tools.map(({ id: toolId, label: toolLabel, href }) => ({
        id: toolId,
        label: toolLabel,
        href,
      })),
    })),
  );
  assert.match(html, /https:\/\/github\.com\/blechdom\/morphazoid/);
  assert.match(html, /https:\/\/github\.com\/blechdom\/morphazoid\/blob\/main\/LICENSE/);
  assert.match(html, /Kristin Galvin/);
  assert.match(html, /<dt>Instruments<\/dt><dd>72<\/dd>/);
});

test("dedicated catalogue page is available from the shared information menu", async () => {
  const html = await readFile(new URL("instruments.html", root), "utf8");
  assert.match(html, /<title>Instrument Catalogue \| Morphazoid<\/title>/);
  assert.match(html, /<body class="about-page catalogue-page">/);
  assert.match(html, /href="instruments\.html" aria-current="page">catalogue<\/a>/);
  assert.match(html, /id="fullInstrumentCatalogue"[\s\S]*?data-instrument-catalog/);
  assert.match(html, /<dt>Instruments<\/dt><dd>72<\/dd>/);
});

test("About document styles remain independently scrollable on instrument breakpoints", async () => {
  const css = await readFile(new URL("about.css", root), "utf8");

  assert.match(css, /\.about-shell\s*\{[^}]*overflow-y: auto;/);
  assert.match(css, /\.about-shell\s*\{[^}]*flex: 1 1 auto;/);
  assert.match(css, /\.about-header-label\s*\{[^}]*color: var\(--muted\);/);
  assert.match(css, /\.about-footer\s*\{[^}]*color: var\(--muted\);/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("repository declares Morphazoid's MIT license and keeps third-party terms separate", async () => {
  const [license, notices, signalsmithLicense, readme, packageText] = await Promise.all([
    readFile(new URL("LICENSE", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
    readFile(new URL("vendor/signalsmith-stretch/LICENSE", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Kristin Galvin/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(readme, /\[MIT License\]\(LICENSE\)/);
  assert.match(readme, /\[THIRD_PARTY_NOTICES\.md\]\(THIRD_PARTY_NOTICES\.md\)/);
  assert.match(notices, /## Pink Trombone/);
  assert.match(notices, /## Tactile/);
  assert.match(notices, /## Signalsmith Stretch/);
  assert.match(signalsmithLicense, /Copyright \(c\) 2022 Geraint Luff \/ Signalsmith Audio Ltd\./);
  assert.equal(JSON.parse(packageText).license, "MIT");
});

test("Morphazoidical's local menus link back to About", async () => {
  const pages = await Promise.all([
    readFile(new URL("morphazoidical/index.html", root), "utf8"),
    readFile(new URL("morphazoidical/atlas.html", root), "utf8"),
  ]);

  for (const html of pages) assert.match(html, /href="\.\.\/">About<\/a>/);
});
