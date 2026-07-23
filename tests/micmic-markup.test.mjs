import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("mic(mic) exposes live recursion, capture, safety, and an echo-tree stage", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("micmic.html", root), "utf8"),
    readFile(new URL("micmic-app.js", root), "utf8"),
    readFile(new URL("micmic.css", root), "utf8"),
  ]);

  assert.match(html, /<body class="micmic-page">/);
  assert.match(html, /class="tab micmic-tab active"[^>]*aria-current="page">mic\(mic\)/);
  assert.match(html, /<option value="micmic\.html" selected>mic\(mic\)<\/option>/);
  assert.match(html, /<span class="audio-copy"><b>Audio<\/b>/);
  assert.match(html, /src="micmic-app\.js(?:\?[^"]+)?"/);
  assert.match(html, /href="micmic\.css"/);
  for (const id of [
    "stage", "seedControl", "seedMicButton", "panicButton", "audioButton", "micButton",
    "freezeButton", "inputMeterBar", "inputTrim", "depth", "interval", "branching",
    "mutation", "wet", "dry", "spread", "recordButton", "downloadTake", "clearTake",
    "generationPreset", "generations", "timeRatio", "generationAngle", "generationAsymmetry",
    "generationPitchScale", "generationTimingReadout", "generationPitchReadout", "resetGenerationRules",
    "generationShapePreview", "generationShapeTrunk", "generationShapePath", "generationShapeAudiblePath",
    "generationShapeRoot", "generationShapeSummary",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  for (const section of ["listenSection", "recursionSection", "mixSection", "captureSection"]) {
    assert.match(html, new RegExp(`<details[^>]*id="${section}"`));
  }
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /LIVE RECURSIVE MICROPHONE|Speak once\. Let every echo become the parent of another\.|<strong>mic/);
  assert.match(html, /Recording does not mute monitoring/);
  assert.match(html, /Use headphones/);
  assert.match(html, /<b id="micButtonLabel">Start input<\/b>/);
  assert.match(html, /<b id="freezeLabel">Stop audio<\/b>/);
  assert.match(html, /Press Escape for an immediate panic stop/);
  assert.match(html, /id="generations"[^>]*min="1"[^>]*max="12"/);
  assert.doesNotMatch(html, /Starting topology|id="presetButtons"|data-preset=/);
  assert.doesNotMatch(html, /id="stateMetric"|id="depthMetric"|id="outputMetric"/);
  assert.doesNotMatch(html, /The interval is inherited and multiplied once per generation/);

  assert.match(app, /getUserMedia/);
  assert.match(app, /echoCancellation:\s*\{ ideal: false \}/);
  assert.match(app, /createDelay\(6\)/);
  assert.match(app, /micmic-generation-processor/);
  assert.match(app, /generationVoiceSpecs/);
  assert.match(app, /feedbackAA/);
  assert.match(app, /feedbackAB/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeSoftClipCurve/);
  assert.match(app, /makeCeilingCurve/);
  assert.match(app, /MediaRecorder/);
  assert.match(app, /createMediaStreamDestination/);
  assert.match(app, /function panic/);
  assert.match(app, /visibilitychange/);

  assert.match(css, /\.micmic-page\s*\{/);
  assert.match(css, /\.fracta-seed-control/);
  assert.match(css, /#seedMicButton/);
  assert.match(css, /\.fracta-panic/);
  assert.match(css, /\.generation-shape-preview/);
  assert.match(css, /@media \(max-width: 650px\)/);
});

test("mic(mic) markup has unique ids and labelled controls", async () => {
  const html = await readFile(new URL("micmic.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["level", "inputTrim", "generations", "depth", "interval", "timeRatio", "generationAngle", "generationAsymmetry", "generationPitchScale", "branching", "mutation", "wet", "dry", "spread"]) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
    assert.match(html, new RegExp(`<input id="${id}"`));
  }
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
});
