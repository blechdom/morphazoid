import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const migratedPages = [
  {
    id: "shepard-risset",
    html: "shepard-risset.html",
    app: "shepard-risset-app.js",
    source: "src/shepard-risset.js",
    requiredCopy: ["Shepard", "Risset"],
  },
  {
    id: "drum-roll-please",
    html: "drum-roll-please.html",
    app: "drum-roll-please-app.js",
    source: "src/drum-roll-please.js",
    requiredCopy: ["Drum", "Roll", "Rattlesnake"],
  },
  {
    id: "ouroboros",
    html: "ouroboros.html",
    app: "ouroboros-app.js",
    source: "src/ouroboros.js",
    requiredCopy: ["Ouroboros", "Rattlesnake", "Shepard"],
  },
  {
    id: "ouroboros-borealis",
    html: "ouroboros-borealis.html",
    app: "ouroboros-borealis-app.js",
    source: "src/ouroboros-borealis.js",
    requiredCopy: ["Ouroboros", "Borealis", "pitch", "rhythm"],
  },
  {
    id: "candy-coil-delay",
    html: "candy-coil-delay.html",
    app: "barber-delay-app.js",
    source: "src/barber-delay.js",
    sourceImport: "barber-delay",
    requiredCopy: ["Candy", "Coil", "Delay"],
  },
  {
    id: "sandy-syrup-delay",
    html: "sandy-syrup-delay.html",
    app: "barber-delay-app.js",
    source: "src/barber-delay.js",
    sourceImport: "barber-delay",
    requiredCopy: ["Sandy", "Syrup", "Delay"],
  },
  {
    id: "recursive-fm",
    html: "recursive-fm.html",
    app: "recursive-fm-app.js",
    source: "src/recursive-fm.js",
    requiredCopy: ["Recursive", "FM"],
  },
  {
    id: "cascading-fm",
    html: "cascading-fm.html",
    app: "cascading-fm-app.js",
    source: "src/cascading-fm.js",
    requiredCopy: ["Cascading", "FM", "frequency"],
  },
  {
    id: "recursive-pm",
    html: "recursive-pm.html",
    app: "recursive-pm-app.js",
    source: "src/recursive-pm.js",
    requiredCopy: ["Recursive", "PM"],
  },
  {
    id: "cascading-pm",
    html: "cascading-pm.html",
    app: "cascading-pm-app.js",
    source: "src/cascading-pm.js",
    requiredCopy: ["Cascading", "PM", "phase"],
  },
  {
    id: "chaotic-fm",
    html: "chaotic-fm.html",
    app: "chaotic-fm-app.js",
    source: "src/chaotic-fm.js",
    requiredCopy: ["Chaotic", "FM"],
  },
  {
    id: "chaotic-pm",
    html: "chaotic-pm.html",
    app: "chaotic-pm-app.js",
    source: "src/chaotic-pm.js",
    requiredCopy: ["Chaotic", "PM"],
  },
  {
    id: "weierstrass",
    html: "weierstrass.html",
    app: "weierstrass-app.js",
    source: "src/weierstrass.js",
    requiredCopy: ["Weierstrass", "Wave", "FM"],
  },
  {
    id: "algorithmic-sequencers",
    html: "algorithmic-sequencers.html",
    app: "algorithmic-sequencers-app.js",
    source: "src/algorithmic-sequencers.js",
    requiredCopy: ["Algorithmic", "Sequencers", "Sorting"],
  },
  {
    id: "dijkstra",
    html: "dijkstra.html",
    app: "algorithmic-scores-app.js",
    source: "src/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["Dijkstra", "Pathfinder"],
  },
  {
    id: "hanoi",
    html: "hanoi.html",
    app: "algorithmic-scores-app.js",
    source: "src/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["Hanoi", "Carillon"],
  },
  {
    id: "minimax",
    html: "minimax.html",
    app: "algorithmic-scores-app.js",
    source: "src/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["Alpha-Beta", "Minimax"],
  },
  {
    id: "nqueens",
    html: "nqueens.html",
    app: "algorithmic-scores-app.js",
    source: "src/algorithmic-scores.js",
    sourceImport: "algorithmic-scores",
    requiredCopy: ["N-Queens", "Backtracker"],
  },
  {
    id: "euclid",
    html: "euclid.html",
    app: "algorithmic-scores-app.js",
    source: "src/algorithmic-scores.js",
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
    assert.match(app, new RegExp(`\\.\\/src\\/${page.sourceImport ?? page.id}\\.js`));
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
