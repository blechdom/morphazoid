import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";

const root = new URL("../", import.meta.url);

test("About is a complete linked guide to the public tool registry", async () => {
  const html = await readFile(new URL("about.html", root), "utf8");

  assert.match(html, /<title>About — Morphazoid<\/title>/);
  assert.match(html, /href="about\.html" aria-current="page">about<\/a>/);
  assert.match(html, /class="mobile-instrument-select"/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.equal((html.match(/class="page-entry"/g) ?? []).length, 57);

  for (const group of TOOL_GROUPS) {
    assert.match(html, new RegExp(`>${group.label.replace("&", "&amp;")}<\\/h2>`));
    for (const tool of group.tools) {
      const escapedHref = tool.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(html, new RegExp(`href="${escapedHref}"`), `missing ${tool.label}`);
    }
  }

  assert.match(html, /href="morphazoidical\/atlas\.html">Feature Atlas<\/a>/);
  assert.match(html, /https:\/\/github\.com\/blechdom\/morphazoid/);
  assert.match(html, /https:\/\/github\.com\/blechdom\/morphazoid\/blob\/main\/LICENSE/);
  assert.match(html, /Kristin Galvin/);
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

  for (const html of pages) assert.match(html, /href="\.\.\/about\.html">About<\/a>/);
});
