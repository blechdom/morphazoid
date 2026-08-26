import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMBO_GEOMETRIES,
  COMBO_PLAYING_MODES,
  comboSelectionFor,
  sanitizeComboFocus,
} from "../src/combo-host.js";
import { resolveActiveTool, TOOL_GROUPS } from "../nav.js";

const repositoryRoot = new URL("../", import.meta.url);

test("Shapes routes dimensions and playing modes as state rather than pages", () => {
  assert.deepEqual(Object.keys(COMBO_GEOMETRIES), ["shape", "solid", "hyper"]);
  assert.deepEqual(
    Object.values(COMBO_GEOMETRIES).map(({ stateId, dimension }) => [stateId, dimension]),
    [["2d", "2D"], ["3d", "3D"], ["4d", "4D"]],
  );
  assert.deepEqual(COMBO_PLAYING_MODES.map(({ id }) => id), ["continuous", "notes", "triggers"]);
  assert.deepEqual(comboSelectionFor("solid", "drums"), { dimension: "3d", playingMode: "triggers" });
  assert.deepEqual(sanitizeComboFocus({ dimension: "4d", playingMode: "notes" }), {
    dimension: "4d",
    playingMode: "notes",
  });
  assert.deepEqual(sanitizeComboFocus({ geometry: "invalid", sound: "noise" }), {
    dimension: "2d",
    playingMode: "continuous",
  });
  assert.deepEqual(sanitizeComboFocus(null), {
    dimension: "2d",
    playingMode: "continuous",
  });
  for (const geometry of Object.values(COMBO_GEOMETRIES)) {
    assert.equal("href" in geometry, false);
    assert.equal("appModule" in geometry, false);
  }
});

test("Shapes is one native Morphazoid route with no embedded page dependencies", async () => {
  const [html, redirect, css, app, scene, state] = await Promise.all([
    readFile(new URL("shapes.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.css", repositoryRoot), "utf8"),
    readFile(new URL("combo-app.js", repositoryRoot), "utf8"),
    readFile(new URL("src/shapes-scene.js", repositoryRoot), "utf8"),
    readFile(new URL("src/shapes-state.js", repositoryRoot), "utf8"),
  ]);

  const comboTool = TOOL_GROUPS.flatMap(({ tools }) => tools).find(({ id }) => id === "combo");
  assert.equal(comboTool?.href, "shapes.html");
  assert.equal(comboTool?.label, "Shapes");
  assert.equal(TOOL_GROUPS.find(({ id }) => id === "apps")?.tools[0]?.id, "combo");
  assert.equal(resolveActiveTool(
    "https://example.test/morphazoid/shapes.html",
    "https://example.test/morphazoid/",
  )?.id, "combo");

  assert.match(redirect, /new URL\("shapes\.html", window\.location\.href\)/);
  assert.match(redirect, /window\.location\.replace\(destination\)/);
  assert.match(html, /<title>Shapes — Morphazoid<\/title>/);
  assert.match(html, /<header class="masthead">/);
  assert.match(html, /<a class="tab active" href="shapes\.html" aria-current="page">Shapes<\/a>/);
  assert.match(html, /<canvas id="stage"/);
  assert.match(html, /<aside class="shapes-panel"/);
  assert.doesNotMatch(html, /Shapes app|One form, three dimensions/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="combo-app\.js"><\/script>/);
  assert.doesNotMatch(html, /<(?:iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /(?:shape|solid|hyper)(?:-drums)?\.html/i);

  assert.doesNotMatch(app, /contentDocument|contentWindow|window\.frames|createElement\(["']iframe/);
  assert.doesNotMatch(app, /(?:^|["'/])(?:app|solid-app|hyper-app|shape-drums-app|solid-drums-app|hyper-drums-app)\.js/);
  assert.match(app, /from "\.\/src\/shapes-state\.js"/);
  assert.match(app, /from "\.\/src\/shapes-scene\.js"/);
  assert.match(app, /legacySound === "synth"[\s\S]*?"continuous"/);
  assert.match(app, /shapesEventIntervalMs\(state, scene\.contacts\.length\)/);
  assert.match(app, /lastEventTokens\[otherClock\] = shapesEventToken/);
  assert.match(app, /lastEventTokens\[clock\] === null/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.doesNotMatch(app, /synthAudio\.strike\(/);
  assert.match(scene, /from "\.\/geometry\.js"/);
  assert.match(scene, /from "\.\/solid\.js"/);
  assert.match(scene, /from "\.\/hyper\.js"/);
  assert.match(state, /playingMode:\s*"continuous"/);
  assert.match(state, /selection\.playingMode/);
});

test("Shapes owns the fixed application picker and local 2D, 3D, 4D submenu", async () => {
  const html = await readFile(new URL("shapes.html", repositoryRoot), "utf8");
  const dimensionOptions = [...html.matchAll(/<option value="(2d|3d|4d)">/g)].map((match) => match[1]);
  assert.deepEqual(dimensionOptions.slice(0, 3), ["2d", "3d", "4d"]);
  assert.match(html, /<select id="dimensionSelect" aria-label="Shapes dimension">/);
  assert.match(html, /data-playing-mode="continuous"/);
  assert.match(html, /data-playing-mode="notes"/);
  assert.match(html, /data-playing-mode="triggers"/);
  assert.match(html, /id="divisionsControl"[^>]*for="divisions"[^>]*hidden/);
  assert.equal((html.match(/id="divisions"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /id="(?:noteDivisions|triggerDivisions)"/);
  assert.match(html, /class="shapes-bank-tabs" role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 4);
  assert.ok(
    html.indexOf("id=\"playingMode\"") > html.indexOf("<aside class=\"shapes-panel\""),
    "playing modes live in the right-hand Shapes panel",
  );
  assert.ok(
    html.indexOf("id=\"divisionsControl\"") > html.indexOf("data-bank-panel=\"main\"")
      && html.indexOf("id=\"divisionsControl\"") < html.indexOf("data-bank-panel=\"form\""),
    "the mode-aware Divisions control lives on Main",
  );

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Shapes HTML IDs stay unique");
});

test("the preferred Twin Rack fills wide panels and collapses responsively", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("shapes.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.css", repositoryRoot), "utf8"),
  ]);
  assert.match(html, /class="shapes-twin-rack"/);
  assert.match(html, /Play &amp; voice/);
  assert.match(html, /Shape &amp; motion/);
  assert.match(html, /class="control shapes-primary-range shapes-speed-row"/);
  assert.match(css, /\.shapes-twin-rack\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(css, /@container shapes-panel \(max-width: 500px\)[\s\S]*\.shapes-twin-rack,[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.shapes-speed-row\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.shapes-panel-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.doesNotMatch(css, /\.shapes-panel-header\s*>\s*div/);
  assert.match(css, /\.shapes-divisions-row\s*\{/);
  assert.match(css, /\.shapes-bank-tabs button\s*\{[^}]*font-size:\s*11px/s);
  assert.match(css, /\.shapes-playing-mode \.choice-switch button\s*\{[^}]*font-size:\s*11px/s);
  assert.match(css, /\.shapes-knob-control > span\s*\{[^}]*font-size:\s*11px/s);
  assert.ok(html.indexOf("data-bank-panel=\"main\"") < html.indexOf("shapes-output-details"));
});
