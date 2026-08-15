import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";

const root = new URL("../", import.meta.url);
const quantumPages = Object.freeze([
  Object.freeze({
    id: "order-tones",
    label: "Order Tones",
    page: "order-tones.html",
    app: "order-tones-app.js",
    core: "src/order-tones.js",
    number: "01",
  }),
  Object.freeze({
    id: "bell-square",
    label: "Bell Square",
    page: "bell-square.html",
    app: "bell-square-app.js",
    core: "src/bell-square.js",
    number: "02",
  }),
  Object.freeze({
    id: "annealogue",
    label: "Annealogue",
    page: "annealogue.html",
    app: "annealogue-app.js",
    core: "src/annealogue.js",
    number: "03",
  }),
]);

test("menu registry keeps the quantum simulators with Morphazoidical in Experiments", () => {
  const group = TOOL_GROUPS.find(({ id }) => id === "experiments");
  assert.ok(group);
  assert.equal(group.label, "Experiments (works-in-progress)");
  assert.deepEqual(
    group.tools.slice(0, 4).map(({ id }) => id),
    ["order-tones", "morphazoidical", "bell-square", "annealogue"],
  );
  assert.deepEqual(
    group.tools
      .filter(({ id }) => quantumPages.some((instrument) => instrument.id === id))
      .map(({ id, label, href }) => ({ id, label, href })),
    quantumPages.map(({ id, label, page }) => ({ id, label, href: page })),
  );
});

test("Quantum Synth pages share the instrument shell and disclose simulation scope", async () => {
  for (const instrument of quantumPages) {
    const [html, app, core] = await Promise.all([
      readFile(new URL(instrument.page, root), "utf8"),
      readFile(new URL(instrument.app, root), "utf8"),
      readFile(new URL(instrument.core, root), "utf8"),
    ]);

    assert.match(html, /<link rel="stylesheet" href="style\.css"\s*\/?>/);
    assert.match(html, /<link rel="stylesheet" href="quantum-synths\.css"\s*\/?>/);
    assert.match(html, /class="[^"]*quantum-page/);
    assert.match(html, /class="[^"]*quantum-shell/);
    assert.match(html, /<canvas[\s\S]*?id="stage"[\s\S]*?tabindex="0"/);
    assert.match(html, /id="stageReadout"/);
    assert.match(html, /id="liveStatus"[^>]*aria-live="polite"/);
    assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
    assert.match(html, /id="audioState">off</);
    assert.match(html, /class="[^"]*(?:simulation|disclaimer|quantum-note)/i);
    assert.match(html, /classical simulation/i);
    assert.match(html, new RegExp(`QUANTUM SYNTHS\\s*(?:&middot;|·)\\s*${instrument.number}`, "i"));
    assert.match(html, new RegExp(`<h1[^>]*>${instrument.label}<\\/h1>`, "i"));
    assert.match(html, new RegExp(`<script type="module" src="${instrument.app.replace(".", "\\.")}">`));
    assert.match(app, new RegExp(`from ["']\\./${instrument.core.replace("src/", "src/").replace(".", "\\.")}["']`));
    assert.match(app, /audioState/);
    assert.match(app, /pagehide/);
    assert.doesNotMatch(core, /\bdocument\.|\bwindow\./, `${instrument.core} must stay import-safe`);
  }
});

test("Quantum Synth family CSS preserves the responsive stage and reduced-motion contract", async () => {
  const css = await readFile(new URL("quantum-synths.css", root), "utf8");
  assert.match(css, /\.quantum-shell\s*\{/);
  assert.match(css, /\.quantum-heading\s*\{/);
  assert.match(css, /\.quantum-simulation-notice/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("About and README identify the simulations without claiming QPU execution", async () => {
  const [about, readme] = await Promise.all([
    readFile(new URL("about.html", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);
  assert.match(about, /id="quantum-synths"/);
  assert.match(about, />Quantum Synths<\/h2>/);
  assert.match(about, /not[\s\S]{0,80}quantum[-\s]hardware/i);
  for (const { label, page } of quantumPages) {
    assert.match(about, new RegExp(`href="${page.replace(".", "\\.")}">${label}<`));
    assert.match(readme, new RegExp(`\\*\\*${label}\\*\\*`));
  }
});
