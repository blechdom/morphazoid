import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Fractaphone exposes live recursion, capture, safety, and an echo-tree stage", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("fractaphone.html", root), "utf8"),
    readFile(new URL("fractaphone-app.js", root), "utf8"),
    readFile(new URL("fractaphone.css", root), "utf8"),
  ]);

  assert.match(html, /<body class="fractaphone-page">/);
  assert.match(html, /class="tab fractaphone-tab active"[^>]*aria-current="page">mic\(mic\)/);
  assert.match(html, /<option value="fractaphone\.html" selected>mic\(mic\)<\/option>/);
  assert.match(html, /<span class="audio-copy"><b>Audio<\/b>/);
  assert.match(html, /src="fractaphone-app\.js"/);
  assert.match(html, /href="fractaphone\.css"/);
  for (const id of [
    "stage", "stageIntro", "stageStartButton", "panicButton", "audioButton", "micButton",
    "freezeButton", "inputMeterBar", "inputTrim", "depth", "interval", "branching",
    "mutation", "wet", "dry", "spread", "recordButton", "downloadTake", "clearTake",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  for (const section of ["listenSection", "recursionSection", "mixSection", "captureSection"]) {
    assert.match(html, new RegExp(`<details[^>]*id="${section}"`));
  }
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /LIVE RECURSIVE MICROPHONE|Speak once\. Let every echo become the parent of another\.|<strong>mic/);
  assert.match(html, /Recording does not mute monitoring/);
  assert.match(html, /Use headphones/);
  assert.match(html, /Press Escape for an immediate panic stop/);

  assert.match(app, /getUserMedia/);
  assert.match(app, /echoCancellation:\s*\{ ideal: false \}/);
  assert.match(app, /createDelay\(2\.5\)/);
  assert.match(app, /feedbackAA/);
  assert.match(app, /feedbackAB/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeSoftClipCurve/);
  assert.match(app, /makeCeilingCurve/);
  assert.match(app, /MediaRecorder/);
  assert.match(app, /createMediaStreamDestination/);
  assert.match(app, /function panic/);
  assert.match(app, /visibilitychange/);

  assert.match(css, /\.fractaphone-page\s*\{/);
  assert.match(css, /\.fracta-intro/);
  assert.match(css, /\.fracta-panic/);
  assert.match(css, /\.fracta-presets/);
  assert.match(css, /@media \(max-width: 650px\)/);
});

test("Fractaphone markup has unique ids and labelled controls", async () => {
  const html = await readFile(new URL("fractaphone.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["level", "inputTrim", "depth", "interval", "branching", "mutation", "wet", "dry", "spread"]) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
    assert.match(html, new RegExp(`<input id="${id}"`));
  }
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
});
