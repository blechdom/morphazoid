import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../birdsong-lab.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../birdsong-lab-app.js", import.meta.url), "utf8");
const analysis = fs.readFileSync(new URL("../src/birdsong-analysis.js", import.meta.url), "utf8");

test("Strophe Lab exposes the complete local analysis-by-synthesis workflow", () => {
  assert.match(html, /href="acoustic-manifold\.html">acoustic manifold<\/a>/);
  for (const id of [
    "audioFile",
    "source-preset",
    "loadDemo",
    "analysisCanvas",
    "playOriginal",
    "playModel",
    "pitchShift",
    "drive",
    "roughness",
    "resonance",
    "renderModel",
    "downloadWav",
    "downloadJson",
    "labStatus",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
    assert.match(app, new RegExp(`\\$\\(["']${id}["']\\)`), `app does not bind #${id}`);
  }
  assert.match(html, /Local analysis-by-synthesis POC · nothing sent off-device/);
  assert.match(html, /acoustic proxies—not measurements of the bird/);
  assert.equal((html.match(/<option value="(?:mixed-songbird|high-whistles|low-coos)"/g) ?? []).length, 3);
  assert.equal((html.match(/<option value="recorded-(?:thrush-nightingale|common-blackbird|chaffinch)"/g) ?? []).length, 3);
  assert.match(html, /procedural choices are labeled synthetic/i);
  assert.doesNotMatch(html, /<script[^>]+https?:/i);
  assert.match(app, /fetch\(source\.path\)/);
  assert.match(app, /assets\/bioacoustics\/thrush-nightingale\.ogg/);
  assert.match(app, /Oona Räisänen \(Mysid\)/);
  assert.match(app, /public-domain dedication/);
  assert.match(app, /sourceLink\("source page", source\.sourceUrl\)/);
});

test("the analysis path reuses Morphazoid's nonlinear syrinx rather than an oscillator stand-in", () => {
  assert.match(analysis, /from "\.\/syrinx-source-models\.js"/);
  assert.match(analysis, /new SyrinxSourceEngine/);
  assert.match(analysis, /model:\s*"syrinx"/);
  assert.match(analysis, /pressureProxy/);
  assert.match(analysis, /tensionProxy/);
  assert.match(analysis, /effective-bilateral-syrinx-v0/);
});
