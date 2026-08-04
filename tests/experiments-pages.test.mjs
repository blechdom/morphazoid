import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const experimentPages = [
  ["moire-organ.html", "moire", "Moire Organ", "moire-organ"],
  ["chladni-plate.html", "chladni", "Chladni Plate", "chladni-plate"],
  ["spring-choir.html", "springs", "Spring Choir", "spring-choir"],
  ["gear-ratio-drums.html", "gears", "Gear Ratio Drums", "gear-ratio-drums"],
  ["cellular-automata.html", "automata", "Cellular Automata", "cellular-automata"],
];

test("experiment pages are native Morphazoid pages with shared controls", async () => {
  for (const [file, mode, title, toolId] of experimentPages) {
    const html = await readFile(new URL(file, root), "utf8");
    assert.match(html, new RegExp(`<body[^>]*data-experiment="${mode}"`));
    assert.match(html, new RegExp(`<h1>${title}`));
    assert.match(html, /<link rel="stylesheet" href="style\.css"/);
    assert.match(html, /<link rel="stylesheet" href="experiments\.css"/);
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
    assert.match(html, /<script type="module" src="experiments-app\.js"><\/script>/);
    assert.match(html, /id="audioButton"/);
    assert.match(html, /id="level"/);
    assert.match(html, /id="stageReadout"/);
    assert.match(html, /id="metricPrimary"/);
    assert.match(html, /id="metricSecondary"/);
    assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
    assert.match(html, new RegExp(`href="${file}" aria-current="page"`));
    assert.match(html, new RegExp(`value="${file}" selected`));
    assert.match(html, new RegExp(toolId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("experiment runtime contains each simulation and audio mapping", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("experiments-app.js", root), "utf8"),
    readFile(new URL("experiments.css", root), "utf8"),
  ]);
  for (const key of ["moire", "chladni", "springs", "gears", "automata"]) {
    assert.match(app, new RegExp(`${key}: \\{`));
  }
  for (const name of [
    "moireFringeSpan",
    "chladniValue",
    "springModeAmplitudes",
    "drawGear",
    "stepAutomataRow",
  ]) {
    assert.match(app, new RegExp(name));
  }
  assert.match(app, /class ExperimentAudio/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /pagehide/);
  assert.match(css, /\.experiment-title/);
  assert.match(css, /\.experiment-meter-grid/);
});
