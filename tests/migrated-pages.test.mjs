import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const migratedPages = [
  {
    id: "analyzer",
    html: "analyzer.html",
    app: "analyzer-app.js",
    source: "src/analyzer.js",
    requiredCopy: ["Oscilloscope", "Spectrum", "Spectrogram"],
  },
  {
    id: "shepard-risset",
    html: "shepard-risset.html",
    app: "shepard-risset-app.js",
    source: "src/shepard-risset.js",
    requiredCopy: ["Shepard", "Risset"],
  },
  {
    id: "recursive-fm",
    html: "recursive-fm.html",
    app: "recursive-fm-app.js",
    source: "src/recursive-fm.js",
    requiredCopy: ["Recursive", "FM"],
  },
];

test("migrated demos are native internal Morphazoid pages", async () => {
  for (const page of migratedPages) {
    const [html, app, source] = await Promise.all([
      readFile(new URL(page.html, root), "utf8"),
      readFile(new URL(page.app, root), "utf8"),
      readFile(new URL(page.source, root), "utf8"),
    ]);

    assert.match(html, /<link rel="stylesheet" href="style\.css"/);
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
    assert.match(html, new RegExp(`<script type="module" src="${page.app.replace(".", "\\.")}"></script>`));
    assert.match(html, /id="audioButton"/);
    assert.match(html, /id="audioState">off</);
    assert.match(html, /class="header-level"/);
    assert.match(html, /class="brand-mark"/);
    assert.match(html, /(?:data-reset-all|id="reset[^"]*")/i);
    for (const copy of page.requiredCopy) assert.match(html, new RegExp(copy, "i"));

    assert.doesNotMatch(html, /https?:\/\//i);
    assert.doesNotMatch(html, /target\s*=\s*["']_blank/i);
    assert.doesNotMatch(html, /<iframe\b/i);
    assert.doesNotMatch(
      `${html}\n${app}\n${source}`,
      /(?:from\s+["']react["']|react-dom|next\/|@storybook)/i,
    );
    assert.match(app, new RegExp(`\\.\\/src\\/${page.id}\\.js`));
    assert.match(app, /pagehide/);
  }
});

test("migrated pages retain one static current destination before nav enhancement", async () => {
  for (const page of migratedPages) {
    const html = await readFile(new URL(page.html, root), "utf8");
    const desktop = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const mobile = html.match(
      /<select class="mobile-instrument-select"[\s\S]*?<\/select>/,
    )?.[0] ?? "";
    assert.equal(
      (desktop.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? []).length,
      1,
      `${page.html} should have one current desktop destination`,
    );
    assert.equal(
      (mobile.match(/<option\b[^>]*\sselected(?:\s|>)/g) ?? []).length,
      1,
      `${page.html} should have one selected mobile destination`,
    );
  }
});
