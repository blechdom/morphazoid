import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { relativeReference } from "../scripts/site/reference-paths.mjs";

const root = new URL("../", import.meta.url);

const migratedPages = [
  {
    id: "shepard-risset",
    html: "shepard-risset.html",
    app: "src/instruments/shepard-risset/shepard-risset-app.js",
    source: "src/instruments/shepard-risset/shepard-risset.js",
    requiredCopy: ["Shepard", "Risset"],
  },
  {
    id: "drum-roll-please",
    html: "drum-roll-please.html",
    app: "src/instruments/drum-roll-please/drum-roll-please-app.js",
    source: "src/instruments/drum-roll-please/drum-roll-please.js",
    requiredCopy: ["Drum", "Roll", "Rattlesnake"],
  },
  {
    id: "ouroborousel",
    html: "ouroborousel.html",
    app: "src/instruments/ouroborousel/ouroborousel-app.js",
    source: "src/instruments/ouroborousel/ouroborousel.js",
    requiredCopy: ["Ouroborousel", "rhythm", "pitch", "chunks"],
  },
  {
    id: "ourorourobouroboros",
    html: "ourorourobouroboros.html",
    app: "src/instruments/ourorourobouroboros/ourorourobouroboros-app.js",
    source: "src/instruments/ourorourobouroboros/ourorourobouroboros.js",
    requiredCopy: ["Ourorourobouroboros", "rhythm", "pitch", "rings"],
  },
  {
    id: "ouroboros",
    html: "ouroboros.html",
    app: "src/instruments/ouroboros/ouroboros-app.js",
    source: "src/instruments/ouroboros/ouroboros.js",
    requiredCopy: ["Ouroboros", "Rattlesnake", "Shepard"],
  },
  {
    id: "ouroboros-borealis",
    html: "ouroboros-borealis.html",
    app: "src/instruments/ouroboros-borealis/ouroboros-borealis-app.js",
    source: "src/instruments/ouroboros-borealis/ouroboros-borealis.js",
    requiredCopy: ["Ouroboros", "Borealis", "pitch", "rhythm"],
  },
  {
    id: "candy-coil-delay",
    html: "candy-coil-delay.html",
    app: "src/families/barber-delay/barber-delay-app.js",
    source: "src/families/barber-delay/barber-delay.js",
    sourceImport: "barber-delay",
    requiredCopy: ["Candy", "Coil", "Delay"],
  },
  {
    id: "sandy-syrup-delay",
    html: "sandy-syrup-delay.html",
    app: "src/families/barber-delay/barber-delay-app.js",
    source: "src/families/barber-delay/barber-delay.js",
    sourceImport: "barber-delay",
    requiredCopy: ["Sandy", "Syrup", "Delay"],
  },
  {
    id: "recursive-fm",
    html: "recursive-fm.html",
    app: "src/instruments/recursive-fm/recursive-fm-app.js",
    source: "src/instruments/recursive-fm/recursive-fm.js",
    requiredCopy: ["Recursive", "FM"],
  },
  {
    id: "cascading-fm",
    html: "cascading-fm.html",
    app: "src/instruments/cascading-fm/cascading-fm-app.js",
    source: "src/instruments/cascading-fm/cascading-fm.js",
    requiredCopy: ["Cascading", "FM", "frequency"],
  },
  {
    id: "recursive-pm",
    html: "recursive-pm.html",
    app: "src/instruments/recursive-pm/recursive-pm-app.js",
    source: "src/instruments/recursive-pm/recursive-pm.js",
    requiredCopy: ["Recursive", "PM"],
  },
  {
    id: "cascading-pm",
    html: "cascading-pm.html",
    app: "src/instruments/cascading-pm/cascading-pm-app.js",
    source: "src/instruments/cascading-pm/cascading-pm.js",
    requiredCopy: ["Cascading", "PM", "phase"],
  },
  {
    id: "chaotic-fm",
    html: "chaotic-fm.html",
    app: "src/instruments/chaotic-fm/chaotic-fm-app.js",
    source: "src/instruments/chaotic-fm/chaotic-fm.js",
    requiredCopy: ["Chaotic", "FM"],
  },
  {
    id: "chaotic-pm",
    html: "chaotic-pm.html",
    app: "src/instruments/chaotic-pm/chaotic-pm-app.js",
    source: "src/instruments/chaotic-pm/chaotic-pm.js",
    requiredCopy: ["Chaotic", "PM"],
  },
  {
    id: "weierstrass",
    html: "weierstrass.html",
    app: "src/instruments/weierstrass/weierstrass-app.js",
    source: "src/instruments/weierstrass/weierstrass.js",
    requiredCopy: ["Weierstrass", "Wave", "FM"],
  },
  {
    id: "algorithmic-sequencers",
    html: "algorithmic-sequencers.html",
    app: "src/families/algorithmic-sequencers/algorithmic-sequencers-app.js",
    source: "src/families/algorithmic-sequencers/algorithmic-sequencers.js",
    requiredCopy: ["Algorithmic", "Sequencers", "Sorting"],
  },
  {
    id: "dijkstra",
    html: "dijkstra.html",
    app: "src/families/algorithmic-scores/algorithmic-scores-app.js",
    source: "src/families/algorithmic-scores/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["Dijkstra", "Pathfinder"],
  },
  {
    id: "hanoi",
    html: "hanoi.html",
    app: "src/families/algorithmic-scores/algorithmic-scores-app.js",
    source: "src/families/algorithmic-scores/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["Hanoi", "Carillon"],
  },
  {
    id: "minimax",
    html: "minimax.html",
    app: "src/families/algorithmic-scores/algorithmic-scores-app.js",
    source: "src/families/algorithmic-scores/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["Alpha-Beta", "Minimax"],
  },
  {
    id: "nqueens",
    html: "nqueens.html",
    app: "src/families/algorithmic-scores/algorithmic-scores-app.js",
    source: "src/families/algorithmic-scores/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["N-Queens", "Backtracker"],
  },
  {
    id: "euclid",
    html: "euclid.html",
    app: "src/families/algorithmic-scores/algorithmic-scores-app.js",
    source: "src/families/algorithmic-scores/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["Euclidean", "Pulse"],
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
    assert.ok(app.includes(relativeReference(page.app, page.source)), `${page.id}: direct model import`);
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
