import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Throatazoid is a first-class mic-driven Morphazoid instrument", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("throatazoid.html", root), "utf8"),
    readFile(new URL("throatazoid.css", root), "utf8"),
    readFile(new URL("throatazoid-app.js", root), "utf8"),
  ]);

  assert.match(html, /<title>THROATAZOID<\/title>/);
  assert.match(html, /<body class="throatazoid-page">/);
  assert.match(
    html,
    /class="tab throatazoid-tab active"[\s\S]*?aria-current="page"[\s\S]*?>throatazoid<\/a>/,
  );
  assert.match(html, /<option value="throatazoid\.html" selected>throatazoid<\/option>/);
  assert.match(html, /id="stage"[\s\S]*?aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="awakenButton"[\s\S]*?aria-pressed="false"/);
  assert.match(html, /<b id="awakenLabel">Awaken<\/b>/);
  assert.match(html, /Use headphones\./);
  assert.match(html, /Microphone audio stays in this browser\./);
  assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="throatazoid-app\.js"/);
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /class="[^"]*(?:subtitle|tagline)[^"]*"/i);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every Throatazoid id must be unique");

  for (const control of [
    "level", "inputTrim", "throatCount", "bodyLength", "tension", "mutation",
    "selectedAperture", "selectedLength", "wet", "dry", "growl", "coupling", "spread",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a label`);
  }

  assert.match(css, /--xeno-black:\s*#020302/);
  assert.match(css, /\.throatazoid-word/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /echoCancellation:\s*\{\s*ideal:\s*true\s*\}/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeCeilingCurve/);
  assert.match(app, /createMediaStreamDestination/);
  assert.match(app, /throatVoiceParameters/);
  assert.match(app, /pointerdown/);
  assert.match(app, /Emergency sever complete/);
});
