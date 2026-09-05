import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../crickets.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../crickets.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../crickets-app.js", import.meta.url), "utf8");

const ids = [
  "cricket-stage",
  "file-input",
  "source-preset",
  "use-demo",
  "play-input",
  "play-model",
  "stop-audio",
  "loop-toggle",
  "render-model",
  "export-wav",
  "export-json",
  "carrier-stat",
  "call-stat",
  "stroke-stat",
  "q-stat",
  "resonance-scale",
  "tooth-rate-ratio",
  "wing-q",
  "coupling",
  "wing-split",
  "plectrum-force",
  "tooth-irregularity",
  "closing-sweep",
  "mirror-mix",
];

test("Crickets ships as a named, local, accessible physical-model page", () => {
  assert.match(html, /<title>Crickets — Morphazoid<\/title>/);
  assert.match(html, /<h1>Crickets<\/h1>/);
  assert.match(html, /href="acoustic-manifold\.html">acoustic manifold<\/a>/);
  assert.match(html, /sample-free/i);
  assert.match(html, /Audio stays in this browser/i);
  assert.match(html, /not recovered anatomy/i);
  assert.match(html, /role="button"[^>]+aria-keyshortcuts="Space"/s);
  assert.match(html, /type="file"[^>]+accept="audio/i);
  assert.doesNotMatch(html, /src="nav\.js"/);
  assert.equal((html.match(/<option value="(?:field-chirps|slow-low-chirps|fast-high-trill)"/g) ?? []).length, 3);
  assert.equal((html.match(/<option value="recorded-(?:house-cricket|field-cricket|european-field-cricket)"/g) ?? []).length, 3);
  assert.match(html, /procedural choices are labeled synthetic/i);
  assert.match(app, /fetch\(source\.path\)/);
  assert.match(app, /assets\/bioacoustics\/house-cricket\.ogg/);
  assert.match(app, /Morray \(Wikimedia Commons\)/);
  assert.match(app, /Thatcher \(Wikimedia Commons\)/);
  assert.match(app, /Baudewijn Odé/);
  assert.match(app, /CC BY 3\.0/);
  assert.match(app, /CC BY-SA 3\.0/);
  assert.match(app, /CC BY-SA 4\.0/);

  for (const id of ids) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `${id} appears once`);
  }
});

test("the body controls use the physical model's supported units and bounds", () => {
  assert.match(html, /id="wing-split"[^>]+min="-360"[^>]+max="360"[^>]+value="28"/);
  assert.match(html, /id="closing-sweep"[^>]+min="-0\.24"[^>]+max="0\.24"[^>]+value="-0\.065"/);
  assert.match(html, /id="tooth-rate-ratio"[^>]+min="0\.72"[^>]+max="1\.28"[^>]+value="1"/);
  assert.match(html, /id="wing-q"[^>]+value="7\.9"/);
  assert.match(html, /Energy coupling · exploratory/);
  assert.match(html, /Implied tooth cadence/);
  assert.match(html, /Spectral focus/);
});

test("research provenance and inverse limits are visible beside the instrument", () => {
  assert.match(html, /https:\/\/doi\.org\/10\.1242\/jeb\.00281/);
  assert.match(html, /https:\/\/doi\.org\/10\.1098\/rsos\.251005/);
  assert.match(html, /https:\/\/doi\.org\/10\.5061\/dryad\.v15dv4266/);
  assert.match(html, /cannot uniquely[\s\S]+recover tooth contacts[\s\S]+coupling/i);
});

test("the stage has distinct non-pink wing colors and responsive touch behavior", () => {
  assert.match(css, /--cricket-left:\s*#63ddd0/);
  assert.match(css, /--cricket-right:\s*#f0c66e/);
  assert.match(css, /#cricket-stage[\s\S]+touch-action:\s*none/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.doesNotMatch(css, /#(?:f|e|d)[0-9a-f]*[89a-f][0-9a-f]*\b.*pink/i);
});

test("the browser controller is wired to analysis, synthesis, interaction, and export", () => {
  assert.match(app, /analyzeCricketSong\(sourceSamples, sourceSampleRate/);
  assert.match(app, /renderCricketModel\(analysis, modelOptions\(\)\)/);
  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /canvas\.addEventListener\("keydown"/);
  assert.match(app, /cricketGestureExport\(analysis, modelRender, sourceName\)/);
  assert.match(app, /encodeMonoWav/);
  assert.match(app, /\$\("source-preset"\)\.addEventListener\("change", loadSelectedSource\)/);
});
