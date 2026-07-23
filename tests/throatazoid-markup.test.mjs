import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Throatazoid is a first-class mic and glottis-driven Morphazoid instrument", async () => {
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
  assert.match(html, /Headphones recommended\./);
  assert.match(html, /Glottis mode needs no microphone\./);
  assert.match(html, /Audio is synthesized and processed in this browser\./);
  assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="throatazoid-app\.js"/);
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /class="[^"]*(?:subtitle|tagline)[^"]*"/i);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every Throatazoid id must be unique");

  assert.match(html, /\bid="sourceButtons"/);
  const sources = [...html.matchAll(
    /<button\b[^>]*\bdata-source="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(sources, ["mic", "glottis", "hybrid"]);

  for (const control of [
    "level",
    "inputTrim",
    "inputStability",
    "exciterPitch",
    "exciterIntensity",
    "exciterTenseness",
    "exciterBreath",
    "exciterVibrato",
    "exciterWobble",
    "throatCount",
    "bodyLength",
    "tension",
    "mutation",
    "selectedAperture",
    "selectedLength",
    "wet",
    "dry",
    "growl",
    "coupling",
    "spread",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a label`);
  }

  assert.match(css, /--xeno-black:\s*#020302/);
  assert.match(css, /\.throatazoid-word/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /echoCancellation:\s*(?:false|\{\s*ideal:\s*false\s*\})/);
  assert.match(app, /noiseSuppression:\s*(?:false|\{\s*ideal:\s*false\s*\})/);
  assert.match(app, /autoGainControl:\s*(?:false|\{\s*ideal:\s*false\s*\})/);
  assert.match(app, /createPeriodicWave/);
  assert.match(app, /createBufferSource/);
  assert.match(app, /glottalHarmonics/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeCeilingCurve/);
  assert.match(app, /createMediaStreamDestination/);
  assert.match(app, /throatVoiceParameters/);
  assert.match(app, /pointerdown/);
  assert.match(app, /Emergency sever complete/);
});
