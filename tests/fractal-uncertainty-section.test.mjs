import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import { instrumentById } from "../src/instrument-catalog.js";

const root = new URL("../", import.meta.url);
const disclosure = "FINITE CLASSICAL FOURIER MODEL · NOT A PROOF · NOT QPU OUTPUT";
const instruments = Object.freeze([
  Object.freeze({
    id: "cantor-lock",
    label: "Cantor Lock",
    page: "cantor-lock.html",
    app: "cantor-lock-app.js",
    core: "src/cantor-lock.js",
  }),
  Object.freeze({
    id: "escape-dust",
    label: "Escape Dust",
    page: "escape-dust.html",
    app: "escape-dust-app.js",
    core: "src/escape-dust.js",
  }),
  Object.freeze({
    id: "linebreaker",
    label: "Linebreaker",
    page: "linebreaker.html",
    app: "linebreaker-app.js",
    core: "src/linebreaker.js",
  }),
]);

test("the three fractal uncertainty instruments live together in Experiments", () => {
  const group = TOOL_GROUPS.find(({ id }) => id === "experiments");
  assert.ok(group);
  assert.deepEqual(
    group.tools.slice(-instruments.length).map(({ id, label, href }) => ({ id, label, href })),
    instruments.map(({ id, label, page }) => ({ id, label, href: page })),
  );
});

test("fractal uncertainty pages share a playable, disclosed instrument shell", async () => {
  for (const instrument of instruments) {
    const [html, app, core] = await Promise.all([
      readFile(new URL(instrument.page, root), "utf8"),
      readFile(new URL(instrument.app, root), "utf8"),
      readFile(new URL(instrument.core, root), "utf8"),
    ]);

    assert.match(html, /<link rel="stylesheet" href="style\.css"\s*\/?>/);
    assert.match(html, /<link rel="stylesheet" href="fractal-uncertainty\.css"\s*\/?>/);
    assert.match(html, /class="[^"]*fractal-uncertainty-page/);
    assert.match(html, /<canvas[\s\S]*?id="stage"[\s\S]*?tabindex="0"/);
    assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
    assert.match(html, /id="audioState">off</);
    assert.match(html, /id="liveStatus"[^>]*aria-live="polite"/);
    assert.match(html, /class="[^"]*sound-anatomy[^"]*"/);
    assert.match(html, /class="sound-anatomy-grid"/);
    assert.match(html, /What you hear now/i);
    assert.match(html, /class="[^"]*sound-feedback-prompt[^"]*"/);
    assert.match(html, /To help tune/i);
    assert.ok(html.includes(disclosure), `${instrument.page} must keep the scope disclosure visible`);
    assert.match(html, new RegExp(`<h1[^>]*>${instrument.label}<\\/h1>`, "i"));
    assert.match(html, new RegExp(`<script type="module" src="${instrument.app.replace(".", "\\.")}">`));
    assert.match(app, new RegExp(`from ["']\\./${instrument.core.replace(".", "\\.")}["']`));
    assert.match(app, /audioState/);
    assert.match(app, /pagehide/);
    assert.doesNotMatch(core, /\bdocument\.|\bwindow\./, `${instrument.core} must stay import-safe`);
  }
});

test("catalogue and README describe finite models without claiming a proof", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  for (const { id, label, page } of instruments) {
    const entry = instrumentById(id);
    assert.equal(entry?.label, label);
    assert.equal(entry?.href, page);
    assert.match(entry?.kind ?? "", /experiment/i);
    assert.match(readme, new RegExp(`\\*\\*${label}\\*\\*`));
  }
  assert.match(readme, /without presenting browser numerics as a proof/i);
});

test("fractal uncertainty CSS preserves desktop, compact, and reduced-motion layouts", async () => {
  const css = await readFile(new URL("fractal-uncertainty.css", root), "utf8");
  assert.match(css, /\.fractal-uncertainty-page\s*\{/);
  assert.match(css, /\.fractal-uncertainty-shell\s*\{/);
  assert.match(css, /\.fractal-uncertainty-heading\s*\{/);
  assert.match(css, /\.sound-anatomy\s*\{/);
  assert.match(css, /\.sound-anatomy-grid\s*\{/);
  assert.match(css, /\.sound-anatomy-diagnosis\s*\{/);
  assert.match(css, /\.sound-control-guide\s*\{/);
  assert.match(css, /\.sound-feedback-prompt\s*\{/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
