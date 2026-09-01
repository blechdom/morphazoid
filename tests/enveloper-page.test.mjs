import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Enveloper exposes an explicit three-generation editor and separate transport", async () => {
  const html = await readFile(new URL("enveloper.html", root), "utf8");

  assert.match(html, /<body class="enveloper-page">/);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="playButton"[^>]*data-primary-transport[^>]*aria-pressed="false"/s);
  assert.match(html, /1\s*<i>→<\/i>\s*3\s*<i>→<\/i>\s*9/);
  assert.match(html, /parent curve[\s\S]*child curve[\s\S]*leaf strength/i);
  assert.equal((html.match(/data-leaf="[0-8]"/g) ?? []).length, 9);
  assert.match(html, /Leaf X · FM timbre/);
  assert.match(html, /Leaf Y · pitch/);
  assert.match(html, /script type="module" src="enveloper-app\.js"/);
});

test("Enveloper app keeps audio explicit and maps every stage interaction", async () => {
  const app = await readFile(new URL("enveloper-app.js", root), "utf8");

  assert.match(app, /deriveEnveloperTimeline/);
  assert.match(app, /new EnveloperAudio/);
  assert.match(app, /function drawEnvelope/);
  assert.match(app, /function drawLeaves/);
  assert.match(app, /function processAudioCrossings/);
  assert.match(app, /function joinCurrentLeaf/);
  assert.match(app, /if \(!state\.audioOn \|\| !audio\.engineRunning\) return/);
  assert.match(app, /pointerdown/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /pagehide[\s\S]*audio\.close/);
});

test("Enveloper keeps all three generations available in compact layouts", async () => {
  const [css, app] = await Promise.all([
    readFile(new URL("enveloper.css", root), "utf8"),
    readFile(new URL("enveloper-app.js", root), "utf8"),
  ]);

  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(max-width: 960px\) and \(max-height: 560px\)/);
  assert.match(app, /const usableHeight = Math\.max\(92,/);
  assert.doesNotMatch(css, /\.enveloper-page\s+\.enveloper-stage[^}]*display:\s*none/);
});
